const CertificateJob = require('../models/CertificateJob');
const logger = require('./logger');

let isRunning = false;
let processor = null;
let recoveryInProgress = false;
const STALE_PROCESSING_MS = 10 * 60 * 1000;

const setProcessor = (fn) => {
  processor = fn;
};

const recoverStaleJobs = async () => {
  if (recoveryInProgress) return;
  recoveryInProgress = true;
  try {
    const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS);
    const result = await CertificateJob.updateMany(
      {
        status: 'processing',
        startedAt: { $lte: staleBefore },
      },
      {
        $set: {
          status: 'queued',
          error: 'Recovered stale processing job',
          startedAt: null,
          finishedAt: null,
        },
      }
    );

    if (result.modifiedCount > 0) {
      logger.warn('Recovered stale certificate jobs', { count: result.modifiedCount });
    }
  } finally {
    recoveryInProgress = false;
  }
};

const processNext = async () => {
  if (isRunning || !processor) return;

  isRunning = true;
  try {
    await recoverStaleJobs();

    const job = await CertificateJob.findOneAndUpdate(
      { status: 'queued' },
      { $set: { status: 'processing', startedAt: new Date(), error: '' } },
      { sort: { createdAt: 1 }, new: true }
    );

    if (!job) {
      return;
    }

    try {
      const result = await processor(job.payload);
      await CertificateJob.findByIdAndUpdate(job._id, {
        $set: {
          status: 'completed',
          result,
          finishedAt: new Date(),
        },
      });
    } catch (error) {
      logger.error('Certificate job failed', { jobId: job._id.toString(), error: error.message });
      await CertificateJob.findByIdAndUpdate(job._id, {
        $set: {
          status: 'failed',
          error: error.message,
          finishedAt: new Date(),
        },
      });
    }
  } finally {
    isRunning = false;
    setImmediate(() => {
      processNext().catch((error) => {
        logger.error('Certificate queue failed', { error: error.message });
      });
    });
  }
};

const enqueue = async (job) => {
  const created = await CertificateJob.create(job);
  setImmediate(() => {
    processNext().catch((error) => {
      logger.error('Queue processing error', { error: error.message });
    });
  });
  return created;
};

module.exports = {
  setProcessor,
  enqueue,
  processNext,
};
