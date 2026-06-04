const mongoose = require('mongoose');

const adminAuditLogSchema = new mongoose.Schema({
  action: {
    type: String,
    required: true,
    index: true,
  },
  actorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  entityType: {
    type: String,
    required: true,
    index: true,
  },
  entityId: {
    type: String,
    required: true,
    index: true,
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
}, { timestamps: true });

adminAuditLogSchema.index({ createdAt: -1, action: 1 });

module.exports = mongoose.model('AdminAuditLog', adminAuditLogSchema);
