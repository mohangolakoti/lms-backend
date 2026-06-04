const AdminAuditLog = require('../models/AdminAuditLog');
const logger = require('./logger');

const logAdminAction = async ({
  action,
  actorId,
  entityType,
  entityId,
  metadata = {},
}) => {
  try {
    if (!action || !actorId || !entityType || !entityId) return;
    await AdminAuditLog.create({
      action,
      actorId,
      entityType,
      entityId: String(entityId),
      metadata,
    });
  } catch (error) {
    logger.warn('Failed to write admin audit log', { action, error: error.message });
  }
};

module.exports = {
  logAdminAction,
};
