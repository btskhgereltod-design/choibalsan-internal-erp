-- Governed report obligations and submission history.
-- The legacy feature is preserved as a familiar schedule, but tenant scope,
-- typed responsibility, optimistic concurrency and append-only evidence are
-- enforced before this surface can be considered for production.

CREATE TABLE report_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 2 AND 240),
  frequency TEXT NOT NULL CHECK(frequency IN(
    'daily','weekly','monthly','quarterly','semiannual','annual','one_time'
  )),
  next_due DATE NOT NULL,
  responsible_user_id UUID,
  responsible_label TEXT NOT NULL DEFAULT '' CHECK(length(responsible_label)<=160),
  recipient TEXT NOT NULL DEFAULT '' CHECK(length(recipient)<=240),
  warn_days INTEGER NOT NULL DEFAULT 7 CHECK(warn_days BETWEEN 0 AND 365),
  note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=2000),
  active BOOLEAN NOT NULL DEFAULT true,
  version BIGINT NOT NULL DEFAULT 1 CHECK(version>0),
  last_submitted_on DATE,
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  retired_at TIMESTAMPTZ,
  retired_by UUID,
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,responsible_user_id)
    REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,created_by)
    REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,updated_by)
    REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,retired_by)
    REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  CHECK((active AND retired_at IS NULL AND retired_by IS NULL)
     OR (NOT active AND retired_at IS NOT NULL AND retired_by IS NOT NULL))
);

CREATE INDEX report_schedules_due_idx
  ON report_schedules(organization_id,next_due,id) WHERE active=true;

CREATE TABLE report_schedule_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  report_schedule_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN('created','updated','submitted','retired')),
  from_version BIGINT,
  to_version BIGINT NOT NULL CHECK(to_version>0),
  due_on DATE,
  submitted_on DATE,
  next_due DATE,
  actor_user_id UUID NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(detail)='object'),
  request_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,report_schedule_id)
    REFERENCES report_schedules(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,actor_user_id)
    REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  CHECK((from_version IS NULL AND event_type='created') OR from_version IS NOT NULL),
  CHECK(from_version IS NULL OR to_version=from_version+1)
);

CREATE INDEX report_schedule_events_schedule_idx
  ON report_schedule_events(organization_id,report_schedule_id,created_at,id);
CREATE TRIGGER report_schedule_events_append_only
  BEFORE UPDATE OR DELETE ON report_schedule_events
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

CREATE TABLE report_schedule_command_receipts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  report_schedule_id UUID NOT NULL,
  command_type TEXT NOT NULL CHECK(command_type IN('submit')),
  idempotency_key UUID NOT NULL,
  payload_sha256 CHAR(64) NOT NULL,
  actor_user_id UUID NOT NULL,
  result JSONB NOT NULL CHECK(jsonb_typeof(result)='object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,command_type,idempotency_key),
  FOREIGN KEY(organization_id,report_schedule_id)
    REFERENCES report_schedules(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,actor_user_id)
    REFERENCES users(organization_id,id) ON DELETE RESTRICT
);

CREATE TRIGGER report_schedule_command_receipts_append_only
  BEFORE UPDATE OR DELETE ON report_schedule_command_receipts
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

CREATE POLICY report_schedules_tenant_policy ON report_schedules
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY report_schedule_events_tenant_policy ON report_schedule_events
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY report_schedule_command_receipts_tenant_policy ON report_schedule_command_receipts
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());
ALTER TABLE report_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_schedules FORCE ROW LEVEL SECURITY;
ALTER TABLE report_schedule_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_schedule_events FORCE ROW LEVEL SECURITY;
ALTER TABLE report_schedule_command_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_schedule_command_receipts FORCE ROW LEVEL SECURITY;

INSERT INTO permission_catalog(code,name,module_code,description) VALUES
('report-schedules.read','Тайлангийн хуваарь харах','core-work','Байгууллагын тайлагнах үүрэг, хугацаа, хариуцагчийг харах'),
('report-schedules.manage','Тайлангийн хуваарь удирдах','core-work','Тайлангийн хуваарь үүсгэх, version-тэй засах, архивлах'),
('report-schedules.submit','Тайлан илгээснийг баталгаажуулах','core-work','Тайлангийн тухайн хугацааны илгээлтийг append-only баримтаар баталгаажуулах')
ON CONFLICT(code) DO UPDATE SET
  name=EXCLUDED.name,module_code=EXCLUDED.module_code,description=EXCLUDED.description;

INSERT INTO organization_roles(organization_id,code,name,system)
SELECT o.id,'report-schedule-manager','Тайлангийн хуваарь хариуцагч',true
FROM organizations o
ON CONFLICT(organization_id,code) DO UPDATE SET name=EXCLUDED.name,active=true;

INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
SELECT r.organization_id,r.id,p.code
FROM organization_roles r
JOIN permission_catalog p ON p.code IN(
  'report-schedules.read','report-schedules.manage','report-schedules.submit'
)
WHERE r.code='report-schedule-manager'
ON CONFLICT DO NOTHING;

INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
SELECT r.organization_id,r.id,p.code
FROM organization_roles r
JOIN permission_catalog p ON p.code IN(
  'report-schedules.read','report-schedules.manage','report-schedules.submit'
)
WHERE r.code IN('owner','administrator')
ON CONFLICT DO NOTHING;

-- Compatibility assignment only. Runtime authorization checks permissions,
-- never these fixed legacy job labels.
INSERT INTO user_roles(organization_id,user_id,role_id)
SELECT u.organization_id,u.id,r.id
FROM users u
JOIN organization_roles r ON r.organization_id=u.organization_id
  AND r.code='report-schedule-manager'
WHERE u.active=true AND u.role IN('director','chief_engineer','accountant')
ON CONFLICT DO NOTHING;

INSERT INTO data_catalog_assets(code,name,domain,source_object,description,classification_code,owner_role_code)
VALUES
('report-schedule','Тайлангийн хуваарь','reporting','report_schedules','Tenant-ийн тайлагнах үүрэг, давтамж, хугацаа ба хариуцлагын master бүртгэл','internal','report-schedule-manager'),
('report-schedule-event','Тайлангийн хуваарийн түүх','reporting','report_schedule_events','Хуваарь болон илгээлтийн өөрчлөх боломжгүй үйл явдлын баримт','restricted','report-schedule-manager')
ON CONFLICT(code) DO NOTHING;

COMMENT ON TABLE report_schedules IS
  'Tenant-owned report obligation schedule. Retirement preserves history; submission does not claim delivery by an external system.';
COMMENT ON TABLE report_schedule_events IS
  'Append-only report schedule lifecycle and human-confirmed submission evidence.';
