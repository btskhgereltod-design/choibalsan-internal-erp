"use strict";

const { getPool } = require("../db");

async function writeAudit(req, action, entityType, entityId, detail = {}, client = getPool()) {
  await client.query(
    `INSERT INTO audit_logs
       (organization_id, user_id, action, entity_type, entity_id, detail, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [req.user.organization_id, req.user.id, action, entityType, entityId || null,
      JSON.stringify(detail), req.ip || null]
  );
}

async function writeDeviceAudit(client, device, action, entityType, entityId, detail = {}) {
  await client.query(
    `INSERT INTO audit_logs
       (organization_id, user_id, action, entity_type, entity_id, detail)
     VALUES ($1, NULL, $2, $3, $4, $5::jsonb)`,
    [device.organization_id, action, entityType, entityId || null, JSON.stringify({ deviceUid: device.device_uid, ...detail })]
  );
}

async function writeSecurityAudit({ client = getPool(), organizationId = null, actorType, actorId = null,
  action, outcome, subjectHash = null, detail = {}, ipAddress = null }) {
  await client.query(
    `INSERT INTO security_audit_events
       (organization_id,actor_type,actor_id,action,outcome,subject_hash,detail,ip_address)
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
    [organizationId, actorType, actorId, action, outcome, subjectHash, JSON.stringify(detail), ipAddress]
  );
}

module.exports = { writeAudit, writeDeviceAudit, writeSecurityAudit };
