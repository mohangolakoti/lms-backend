const mongoose = require('mongoose');

const certificateJobSchema = new mongoose.Schema({
  requestedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  payload: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
  },
  idempotencyKey: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  status: {
    type: String,
    enum: ['queued', 'processing', 'completed', 'failed'],
    default: 'queued',
    index: true,
  },
  result: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  error: {
    type: String,
    default: '',
  },
  startedAt: {
    type: Date,
    default: null,
  },
  finishedAt: {
    type: Date,
    default: null,
  },
}, { timestamps: true });

certificateJobSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });
certificateJobSchema.index({ status: 1, startedAt: 1 });
certificateJobSchema.index({ requestedBy: 1, createdAt: -1 });

module.exports = mongoose.model('CertificateJob', certificateJobSchema);
