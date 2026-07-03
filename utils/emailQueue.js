const EmailJob = require('../models/EmailJob');
const sendEmail = require('./sendEmail');
const logger = require('./logger');

/**
 * Bulk email queue — processes EmailJob documents at a controlled rate.
 *
 * Design mirrors certificateQueue.js so both queues follow the same pattern
 * and share the same operational understanding.
 *
 * Rate: processes up to BATCH_SIZE emails per cycle, with DELAY_MS between
 * each send to respect SMTP provider rate limits.
 *
 * Usage:
 *   // Enqueue a single email
 *   await enqueueEmail({ to, subject, html, text, refType, refId });
 *
 *   // Enqueue many emails (e.g. bulk announcement)
 *   await enqueueEmails(recipients.map(r => ({ to: r.email, subject, html })));
 */

const BATCH_SIZE = parseInt(process.env.EMAIL_QUEUE_BATCH_SIZE || '10', 10); // emails per cycle
const DELAY_MS = parseInt(process.env.EMAIL_QUEUE_DELAY_MS || '200', 10);    // ms between sends
const MAX_ATTEMPTS = parseInt(process.env.EMAIL_MAX_ATTEMPTS || '3', 10);
const STALE_PROCESSING_MS = 10 * 60 * 1000; // 10 minutes — job recovery threshold

let isProcessing = false;

// ---------------------------------------------------------------------------
// Queue entry points
// ---------------------------------------------------------------------------

/**
 * Adds a single email to the queue.
 * @param {object} params - { to, subject, html?, text?, refType?, refId? }
 * @returns {Promise<EmailJob>}
 */
const enqueueEmail = async ({ to, subject, html = '', text = '', refType = '', refId = null }) => {
  const job = await EmailJob.create({ to, subject, html, text, refType, refId });
  logger.info('EmailQueue: job enqueued', { jobId: job._id, to, subject });

  // Kick off processing without awaiting — fire and forget
  processNextBatch().catch((err) =>
    logger.error('EmailQueue: error starting processor', { error: err.message })
  );

  return job;
};

/**
 * Enqueue a bulk list of emails atomically.
 * @param {Array<{to, subject, html?, text?, refType?, refId?}>} emails
 * @returns {Promise<number>} Number of jobs inserted
 */
const enqueueEmails = async (emails) => {
  if (!emails?.length) return 0;

  const docs = emails.map(({ to, subject, html = '', text = '', refType = '', refId = null }) => ({
    to, subject, html, text, refType, refId,
    status: 'queued',
    attempts: 0,
  }));

  const result = await EmailJob.insertMany(docs, { ordered: false });
  logger.info('EmailQueue: bulk jobs enqueued', { count: result.length });

  // Kick off processing
  processNextBatch().catch((err) =>
    logger.error('EmailQueue: error starting bulk processor', { error: err.message })
  );

  return result.length;
};

// ---------------------------------------------------------------------------
// Processor
// ---------------------------------------------------------------------------

/**
 * Processes a batch of queued email jobs.
 * Re-entrant guard (isProcessing) prevents concurrent runs.
 * Recovers stale 'processing' jobs on each cycle.
 */
const processNextBatch = async () => {
  if (isProcessing) return;
  isProcessing = true;

  try {
    // Recover stale jobs from interrupted processing cycles
    await recoverStaleJobs();

    // Claim and process a batch atomically
    const jobs = await EmailJob.find({ status: 'queued' })
      .sort({ createdAt: 1 })
      .limit(BATCH_SIZE)
      .lean();

    if (!jobs.length) return;

    logger.info(`EmailQueue: processing ${jobs.length} job(s)`);

    for (const job of jobs) {
      await processJob(job._id);

      // Rate-limiting delay between sends
      if (DELAY_MS > 0) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      }
    }
  } catch (err) {
    logger.error('EmailQueue: batch processing error', { error: err.message });
  } finally {
    isProcessing = false;
  }
};

/**
 * Processes a single EmailJob by ID.
 * Atomically claims the job to prevent double-processing.
 */
const processJob = async (jobId) => {
  // Atomically mark as processing
  const job = await EmailJob.findOneAndUpdate(
    { _id: jobId, status: 'queued' },
    { $set: { status: 'processing', processedAt: new Date() } },
    { new: true }
  );

  if (!job) return; // Already claimed by another process

  try {
    await sendEmail({
      email: job.to,
      subject: job.subject,
      html: job.html,
      message: job.text,
    });

    await EmailJob.findByIdAndUpdate(job._id, {
      $set: { status: 'sent', processedAt: new Date() },
    });

    logger.info('EmailQueue: job sent', { jobId: job._id, to: job.to });
  } catch (err) {
    const attempts = (job.attempts || 0) + 1;
    const isFinalAttempt = attempts >= MAX_ATTEMPTS;

    await EmailJob.findByIdAndUpdate(job._id, {
      $set: {
        status: isFinalAttempt ? 'failed' : 'queued',
        error: err.message,
        attempts,
        processedAt: new Date(),
      },
    });

    logger.warn('EmailQueue: job failed', {
      jobId: job._id,
      to: job.to,
      attempt: attempts,
      maxAttempts: MAX_ATTEMPTS,
      final: isFinalAttempt,
      error: err.message,
    });
  }
};

/**
 * Moves jobs stuck in 'processing' for longer than STALE_PROCESSING_MS back to 'queued'.
 * Handles crashes / restarts that interrupt in-flight sends.
 */
const recoverStaleJobs = async () => {
  const cutoff = new Date(Date.now() - STALE_PROCESSING_MS);
  const result = await EmailJob.updateMany(
    { status: 'processing', processedAt: { $lt: cutoff } },
    { $set: { status: 'queued' } }
  );

  if (result.modifiedCount > 0) {
    logger.info(`EmailQueue: recovered ${result.modifiedCount} stale job(s)`);
  }
};

module.exports = {
  enqueueEmail,
  enqueueEmails,
  processNextBatch,
};
