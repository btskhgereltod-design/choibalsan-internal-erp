-- Production security: append-only audit journals and database-enforced IoT priority.

CREATE TABLE security_audit_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID REFERENCES organizations(id) ON DELETE RESTRICT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('tenant_user','platform_admin','device','anonymous','system')),
  actor_id TEXT,
  action TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('success','failure','denied')),
  subject_hash CHAR(64),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX security_audit_tenant_time_idx ON security_audit_events(organization_id,created_at DESC);
CREATE INDEX security_audit_action_time_idx ON security_audit_events(action,created_at DESC);

CREATE OR REPLACE FUNCTION overva_reject_audit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'OVERVA audit journals are append-only';
END;
$$;

CREATE TRIGGER audit_logs_append_only
BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

CREATE TRIGGER platform_audit_logs_append_only
BEFORE UPDATE OR DELETE ON platform_audit_logs
FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

CREATE TRIGGER security_audit_events_append_only
BEFORE UPDATE OR DELETE ON security_audit_events
FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

ALTER TABLE iot_commands ADD CONSTRAINT iot_commands_priority_mapping_check CHECK (
  (priority='emergency' AND priority_level=100) OR
  (priority='manual' AND priority_level=80) OR
  (priority='weather' AND priority_level=60) OR
  (priority='schedule' AND priority_level=40) OR
  (priority='default' AND priority_level=20)
);

CREATE TABLE iot_device_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  device_id UUID NOT NULL,
  version TEXT NOT NULL,
  rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  fail_safe JSONB NOT NULL,
  checksum CHAR(64) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,device_id,version),
  FOREIGN KEY(organization_id,device_id) REFERENCES iot_devices(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX iot_device_policies_active_idx
  ON iot_device_policies(organization_id,device_id,active,valid_from DESC);
