-- Production-grade asynchronous delivery state for immutable workflow
-- notification intents. Business outbox rows remain append-only; mutable claim
-- coordination and append-only delivery evidence are separate concepts.

ALTER TABLE workflow_notification_outbox ADD COLUMN correlation_id UUID;
ALTER TABLE workflow_notification_outbox ADD COLUMN request_id TEXT
  CHECK(request_id IS NULL OR length(request_id) BETWEEN 1 AND 240);
ALTER TABLE workflow_notification_outbox ALTER COLUMN correlation_id SET DEFAULT gen_random_uuid();

CREATE TABLE workflow_notification_delivery_state (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  outbox_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN('pending','processing','retry_scheduled','delivered','dead_letter')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  last_error_code TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,outbox_id),
  FOREIGN KEY(organization_id,outbox_id)
    REFERENCES workflow_notification_outbox(organization_id,id) ON DELETE RESTRICT,
  CHECK(
    (status='processing' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status<>'processing' AND lease_token IS NULL AND lease_expires_at IS NULL)
  ),
  CHECK((status='delivered')=(delivered_at IS NOT NULL))
);
CREATE INDEX workflow_notification_delivery_due_idx
  ON workflow_notification_delivery_state(organization_id,next_attempt_at,outbox_id)
  WHERE status IN('pending','retry_scheduled','processing');

CREATE TABLE workflow_notification_delivery_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  outbox_id UUID NOT NULL,
  attempt_no INTEGER NOT NULL CHECK(attempt_no>0),
  event_type TEXT NOT NULL
    CHECK(event_type IN('claimed','lease_expired','delivered','retry_scheduled','dead_letter')),
  lease_token UUID NOT NULL,
  provider_code TEXT NOT NULL CHECK(length(provider_code) BETWEEN 1 AND 80),
  correlation_id UUID,
  response_code TEXT NOT NULL DEFAULT '',
  provider_message_id TEXT NOT NULL DEFAULT '',
  error_code TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,outbox_id)
    REFERENCES workflow_notification_delivery_state(organization_id,outbox_id) ON DELETE RESTRICT
);
CREATE INDEX workflow_notification_delivery_events_tenant_outbox_idx
  ON workflow_notification_delivery_events(organization_id,outbox_id,created_at,id);

CREATE OR REPLACE FUNCTION overva_initialize_workflow_notification_delivery()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO workflow_notification_delivery_state(organization_id,outbox_id)
  VALUES(NEW.organization_id,NEW.id)
  ON CONFLICT(organization_id,outbox_id) DO NOTHING;
  RETURN NEW;
END $$;

INSERT INTO workflow_notification_delivery_state(organization_id,outbox_id)
SELECT organization_id,id FROM workflow_notification_outbox
ON CONFLICT(organization_id,outbox_id) DO NOTHING;

CREATE TRIGGER workflow_notification_outbox_delivery_state
  AFTER INSERT ON workflow_notification_outbox
  FOR EACH ROW EXECUTE FUNCTION overva_initialize_workflow_notification_delivery();
CREATE TRIGGER workflow_notification_delivery_events_append_only
  BEFORE UPDATE OR DELETE ON workflow_notification_delivery_events
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

CREATE POLICY workflow_notification_delivery_state_tenant_policy
  ON workflow_notification_delivery_state
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY workflow_notification_delivery_events_tenant_policy
  ON workflow_notification_delivery_events
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());

COMMENT ON TABLE workflow_notification_delivery_state IS
  'Mutable delivery coordination projection. It never replaces or mutates the immutable workflow notification intent.';
COMMENT ON TABLE workflow_notification_delivery_events IS
  'Append-only claim, retry, delivery and dead-letter evidence for workflow notification intents.';
COMMENT ON COLUMN workflow_notification_outbox.request_id IS
  'Originating command idempotency/request identity when supplied; null remains honest for earlier intents.';
