-- Keep operational accountability separate from login/workflow authority.
-- A responsible employee and the executing crew come from the canonical HR
-- employee master; assigning them never grants application permissions.

CREATE TABLE work_order_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  work_order_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  participant_role TEXT NOT NULL CHECK(participant_role IN('responsible','executor')),
  assigned_by UUID NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_by UUID,
  removed_at TIMESTAMPTZ,
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,work_order_id)
    REFERENCES work_orders(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,employee_id)
    REFERENCES employees(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,assigned_by)
    REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,removed_by)
    REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  CHECK((removed_at IS NULL AND removed_by IS NULL)
     OR (removed_at IS NOT NULL AND removed_by IS NOT NULL))
);

CREATE UNIQUE INDEX work_order_participants_one_responsible_uidx
  ON work_order_participants(organization_id,work_order_id)
  WHERE participant_role='responsible' AND removed_at IS NULL;
CREATE UNIQUE INDEX work_order_participants_active_member_uidx
  ON work_order_participants(organization_id,work_order_id,employee_id,participant_role)
  WHERE removed_at IS NULL;
CREATE INDEX work_order_participants_employee_idx
  ON work_order_participants(organization_id,employee_id,assigned_at DESC)
  WHERE removed_at IS NULL;

CREATE TABLE work_order_participant_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  work_order_id UUID NOT NULL,
  participant_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  participant_role TEXT NOT NULL CHECK(participant_role IN('responsible','executor')),
  event_type TEXT NOT NULL CHECK(event_type IN('assigned','removed')),
  actor_user_id UUID NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(detail)='object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,work_order_id)
    REFERENCES work_orders(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,participant_id)
    REFERENCES work_order_participants(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,employee_id)
    REFERENCES employees(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,actor_user_id)
    REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX work_order_participant_events_order_idx
  ON work_order_participant_events(organization_id,work_order_id,created_at,id);

CREATE TRIGGER work_order_participant_events_append_only
  BEFORE UPDATE OR DELETE ON work_order_participant_events
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

CREATE POLICY work_order_participants_tenant_policy ON work_order_participants
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());
ALTER TABLE work_order_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY work_order_participant_events_tenant_policy ON work_order_participant_events
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());
ALTER TABLE work_order_participant_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE work_order_participants IS
  'Current operational responsible employee and executing crew; this does not grant login or workflow authority.';
COMMENT ON TABLE work_order_participant_events IS
  'Append-only evidence of operational Work participant assignment changes.';
