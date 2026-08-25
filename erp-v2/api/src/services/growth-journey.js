"use strict";

const EVENT_TYPES = new Set([
  "discovery_started", "blueprint_ready", "pilot_started", "first_value",
  "go_live", "paid_usage", "champion_identified", "referral_recorded", "journey_note",
]);
const SOURCES = new Set(["system", "tenant", "platform_admin", "billing"]);

async function ensureGrowthProfile(client, organizationId, acquisitionSource = "self_service") {
  await client.query(
    `INSERT INTO organization_growth_profiles(organization_id,acquisition_source)
     VALUES($1,$2) ON CONFLICT(organization_id) DO NOTHING`,
    [organizationId, acquisitionSource]
  );
}

async function recordGrowthEvent(client, event) {
  if (!EVENT_TYPES.has(event.eventType)) throw new Error(`Unsupported growth event: ${event.eventType}`);
  const source = event.source || "system";
  if (!SOURCES.has(source)) throw new Error(`Unsupported growth event source: ${source}`);
  const result = await client.query(
    `INSERT INTO organization_growth_events
       (organization_id,event_type,source,actor_user_id,platform_admin_id,occurred_at,detail,idempotency_key)
     VALUES($1,$2,$3,$4,$5,COALESCE($6::timestamptz,now()),$7::jsonb,$8)
     ON CONFLICT(organization_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
     RETURNING *`,
    [event.organizationId, event.eventType, source, event.actorUserId || null,
      event.platformAdminId || null, event.occurredAt || null, JSON.stringify(event.detail || {}),
      event.idempotencyKey || null]
  );
  return result.rows[0] || null;
}

module.exports = { EVENT_TYPES, SOURCES, ensureGrowthProfile, recordGrowthEvent };
