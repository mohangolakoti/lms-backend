const CertificateJob = require('../models/CertificateJob');
const logger = require('./logger');

let isRunning = false;
let processor = null;

const setProcessor = (fn) => {
  processor = fn;
};

const processNext = async () => {
  if (isRunning || !processor) return;

  isRunning = true;
  try {
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
