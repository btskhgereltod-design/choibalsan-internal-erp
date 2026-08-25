"use strict";

const { getPool } = require("../db");

async function writeLifecycleEvent(req, event, client = getPool()) {
  await client.query(
    `INSERT INTO data_lifecycle_events
       (organization_id,asset_code,record_key,event_type,actor_user_id,entity_type,entity_id,detail)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [req.user.organization_id, event.assetCode || null, event.recordKey || null,
      event.eventType, req.user.id, event.entityType, event.entityId || null,
      JSON.stringify(event.detail || {})]
  );
}

module.exports = { writeLifecycleEvent };
