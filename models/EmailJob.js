const mongoose = require('mongoose');

/**
 * EmailJob model — queues email deliveries for rate-controlled processing.
 *
 * Allows sending bulk announcement emails to 1k+ students without overwhelming
 * the SMTP provider. The emailQueue worker processes jobs at a controlled rate.
 *
 * TTL: Jobs are automatically removed after 3 days (successful or failed).
 */
const emailJobSchema = new mongoose.Schema({
  to: {
    type: String,
    required: true,
    trim: true,
  },
  subject: {
    type: String,
    required: true,
    trim: true,
  },
  html: {
    type: String,
    default: '',
  },
  text: {
    type: String,
    default: '',
  },
  /** The entity this email relates to (for deduplication / tracking) */
  refType: {
    type: String,
    default: '',
    trim: true,
  },
  refId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null,
  },
  status: {
    type: String,
    enum: ['queued', 'processing', 'sent', 'failed'],
    default: 'queued',
    index: true,
  },
  attempts: {
    type: Number,
    default: 0,
  },
  error: {
    type: String,
    default: '',
  },
  processedAt: {
    type: Date,
    default: null,
  },
}, {
  timestamps: true,
});

// TTL: remove email jobs after 3 days regardless of status
emailJobSchema.index({ createdAt: 1 }, { expireAfterSeconds: 3 * 24 * 60 * 60 });
emailJobSchema.index({ status: 1, createdAt: 1 });
emailJobSchema.index({ refType: 1, refId: 1 });

module.exports = mongoose.model('EmailJob', emailJobSchema);
