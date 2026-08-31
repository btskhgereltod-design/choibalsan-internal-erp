-- Stable automation delivery and per-rule execution identity.
-- Existing events remain valid and are not assigned synthetic delivery keys.

ALTER TABLE automation_events
  ADD COLUMN source_delivery_key TEXT,
  ADD CONSTRAINT automation_events_source_delivery_key_check CHECK(
    source_delivery_key IS NULL OR length(source_delivery_key) BETWEEN 1 AND 240
  );

CREATE UNIQUE INDEX automation_events_source_delivery_uidx
  ON automation_events(organization_id,source_delivery_key)
  WHERE source_delivery_key IS NOT NULL;

ALTER TABLE automation_runs
  ADD CONSTRAINT automation_runs_rule_event_unique
  UNIQUE(organization_id,rule_id,event_id);

COMMENT ON COLUMN automation_events.source_delivery_key IS
  'Stable tenant-scoped identity supplied by the source. NULL means the caller intentionally requested a new delivery.';
