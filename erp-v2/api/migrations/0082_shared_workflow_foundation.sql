-- Shared workflow coordination primitives.
-- Domain tables remain authoritative for HR, correspondence, archive and all
-- other business state. workflow_cases.coordination_state is only a current
-- coordination snapshot backed by immutable evidence.

CREATE TABLE workflow_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workflow_type TEXT NOT NULL CHECK(length(workflow_type) BETWEEN 1 AND 120),
  subject_type TEXT NOT NULL CHECK(length(subject_type) BETWEEN 1 AND 120),
  subject_id TEXT NOT NULL CHECK(length(subject_id) BETWEEN 1 AND 240),
  coordination_state TEXT NOT NULL CHECK(length(coordination_state) BETWEEN 1 AND 120),
  current_assignee_user_id UUID,
  version BIGINT NOT NULL DEFAULT 0 CHECK(version >= 0),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,workflow_type,subject_type,subject_id),
  FOREIGN KEY(organization_id,current_assignee_user_id)
    REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,created_by)
    REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX workflow_cases_tenant_assignee_idx
  ON workflow_cases(organization_id,current_assignee_user_id,updated_at DESC);
CREATE INDEX workflow_cases_tenant_type_state_idx
  ON workflow_cases(organization_id,workflow_type,coordination_state,updated_at DESC);

CREATE TABLE workflow_transition_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  case_id UUID NOT NULL,
  case_version BIGINT NOT NULL CHECK(case_version >= 0),
  transition_name TEXT NOT NULL CHECK(length(transition_name) BETWEEN 1 AND 120),
  from_coordination_state TEXT,
  to_coordination_state TEXT NOT NULL,
  domain_from_state TEXT,
  domain_to_state TEXT,
  decision TEXT CHECK(decision IS NULL OR decision IN('approved','rejected','returned')),
  reason TEXT NOT NULL DEFAULT '',
  comment TEXT NOT NULL DEFAULT '',
  actor_user_id UUID NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,case_id)
    REFERENCES workflow_cases(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,actor_user_id)
    REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX workflow_transition_events_tenant_case_idx
  ON workflow_transition_events(organization_id,case_id,case_version,created_at,id);

CREATE TABLE workflow_assignment_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  case_id UUID NOT NULL,
  case_version BIGINT NOT NULL CHECK(case_version > 0),
  operation TEXT NOT NULL CHECK(operation IN('assigned','reassigned','unassigned')),
  from_user_id UUID,
  to_user_id UUID,
  reason TEXT NOT NULL DEFAULT '',
  actor_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,case_id)
    REFERENCES workflow_cases(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,from_user_id)
    REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,to_user_id)
    REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,actor_user_id)
    REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  CHECK(
    (operation='assigned' AND from_user_id IS NULL AND to_user_id IS NOT NULL)
    OR (operation='reassigned' AND from_user_id IS NOT NULL AND to_user_id IS NOT NULL AND from_user_id<>to_user_id)
    OR (operation='unassigned' AND from_user_id IS NOT NULL AND to_user_id IS NULL)
  )
);
CREATE INDEX workflow_assignment_events_tenant_case_idx
  ON workflow_assignment_events(organization_id,case_id,case_version,created_at,id);

CREATE TABLE workflow_decision_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  case_id UUID NOT NULL,
  case_version BIGINT NOT NULL CHECK(case_version > 0),
  decision TEXT NOT NULL CHECK(decision IN('approved','rejected','returned')),
  step_code TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  comment TEXT NOT NULL DEFAULT '',
  actor_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,case_id)
    REFERENCES workflow_cases(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,actor_user_id)
    REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX workflow_decision_events_tenant_case_idx
  ON workflow_decision_events(organization_id,case_id,case_version,created_at,id);

CREATE TABLE workflow_comment_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  case_id UUID NOT NULL,
  case_version BIGINT NOT NULL CHECK(case_version > 0),
  comment TEXT NOT NULL CHECK(length(comment) BETWEEN 1 AND 4000),
  actor_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,case_id)
    REFERENCES workflow_cases(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,actor_user_id)
    REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX workflow_comment_events_tenant_case_idx
  ON workflow_comment_events(organization_id,case_id,case_version,created_at,id);

CREATE TABLE workflow_command_receipts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  case_id UUID NOT NULL,
  workflow_type TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  command_type TEXT NOT NULL CHECK(length(command_type) BETWEEN 1 AND 120),
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 240),
  payload_sha256 CHAR(64) NOT NULL,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,workflow_type,subject_type,subject_id,command_type,idempotency_key),
  FOREIGN KEY(organization_id,case_id)
    REFERENCES workflow_cases(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,actor_user_id)
    REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX workflow_command_receipts_tenant_case_idx
  ON workflow_command_receipts(organization_id,case_id,created_at,id);

CREATE TABLE workflow_notification_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  case_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK(length(event_type) BETWEEN 1 AND 160),
  dedupe_key TEXT NOT NULL CHECK(length(dedupe_key) BETWEEN 1 AND 300),
  recipient_user_id UUID,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,dedupe_key),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,case_id)
    REFERENCES workflow_cases(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,recipient_user_id)
    REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,actor_user_id)
    REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX workflow_notification_outbox_tenant_time_idx
  ON workflow_notification_outbox(organization_id,created_at,id);

CREATE TRIGGER workflow_transition_events_append_only BEFORE UPDATE OR DELETE ON workflow_transition_events
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();
CREATE TRIGGER workflow_assignment_events_append_only BEFORE UPDATE OR DELETE ON workflow_assignment_events
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();
CREATE TRIGGER workflow_decision_events_append_only BEFORE UPDATE OR DELETE ON workflow_decision_events
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();
CREATE TRIGGER workflow_comment_events_append_only BEFORE UPDATE OR DELETE ON workflow_comment_events
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();
CREATE TRIGGER workflow_command_receipts_append_only BEFORE UPDATE OR DELETE ON workflow_command_receipts
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();
CREATE TRIGGER workflow_notification_outbox_append_only BEFORE UPDATE OR DELETE ON workflow_notification_outbox
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

CREATE POLICY workflow_cases_tenant_policy ON workflow_cases
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY workflow_transition_events_tenant_policy ON workflow_transition_events
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY workflow_assignment_events_tenant_policy ON workflow_assignment_events
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY workflow_decision_events_tenant_policy ON workflow_decision_events
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY workflow_comment_events_tenant_policy ON workflow_comment_events
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY workflow_command_receipts_tenant_policy ON workflow_command_receipts
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY workflow_notification_outbox_tenant_policy ON workflow_notification_outbox
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());

INSERT INTO permission_catalog(code,name,module_code,description) VALUES
('workflow.coordinate','Workflow coordination','core-work',
 'Operate shared coordination/history primitives; domain permissions remain independently required by adapters.')
ON CONFLICT(code) DO NOTHING;

INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
SELECT r.organization_id,r.id,'workflow.coordinate'
  FROM organization_roles r
 WHERE r.code IN('owner','administrator')
ON CONFLICT DO NOTHING;

COMMENT ON TABLE workflow_cases IS
  'Tenant-scoped coordination snapshot. Never the authoritative HR, correspondence, archive, or other domain state.';
COMMENT ON TABLE workflow_transition_events IS
  'Immutable coordination transitions; domain_from_state and domain_to_state are evidence supplied by the domain transaction, not projections.';
COMMENT ON TABLE workflow_command_receipts IS
  'Immutable tenant-scoped idempotency receipts. Reuse with a different payload is rejected.';
COMMENT ON TABLE workflow_notification_outbox IS
  'Immutable notification/event intents. Delivery state belongs in a separate delivery journal.';
