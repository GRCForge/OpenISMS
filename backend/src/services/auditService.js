const { AuditLog } = require('../models');

const auditFromReq = async (req, action, entityType, entityId, entityName, details = {}) => {
  try {
    await AuditLog.create({
      action,
      entity_type: entityType,
      entity_id: entityId,
      entity_name: entityName,
      actor_id: req.user?.id ?? null,
      actor_name: req.user?.name ?? 'System',
      details,
      ip_address: req.ip ?? null,
    });
  } catch (e) {
    console.error('[Audit] Failed to write log:', e.message);
  }
};

module.exports = { auditFromReq };
