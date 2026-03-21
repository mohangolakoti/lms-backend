const mongoose = require('mongoose');

const certificateSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    batchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Batch',
      required: true,
      index: true,
    },
    certificateName: {
      type: String,
      required: true,
      trim: true,
      maxlength: [180, 'Certificate name cannot exceed 180 characters'],
      index: true,
    },
    duration: {
      type: String,
      required: true,
      trim: true,
      maxlength: [100, 'Duration cannot exceed 100 characters'],
    },
    completionDate: {
      type: Date,
      required: true,
      index: true,
    },
    templateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CertificateTemplate',
      required: true,
      index: true,
    },
    certificateNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    certificateUrl: {
      type: String,
      required: true,
      trim: true,
    },
    filePath: {
      type: String,
      required: true,
      trim: true,
    },
    issuedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'certificates',
  }
);

certificateSchema.index({ studentId: 1, batchId: 1, certificateName: 1 }, { unique: true });
certificateSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Certificate', certificateSchema);
