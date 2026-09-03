-- Governed lighting incident intake for the engineer-facing wide sheet.
-- This adds runtime capture authority without turning the lighting workspace
-- into a second Work Order engine.

ALTER TABLE operational_incidents
  ADD COLUMN version BIGINT NOT NULL DEFAULT 1 CHECK(version > 0);

ALTER TABLE operational_incident_events
  ADD COLUMN incident_version BIGINT CHECK(incident_version IS NULL OR incident_version > 0),
  ADD COLUMN request_id UUID;

ALTER TABLE operational_incident_events
  DROP CONSTRAINT operational_incident_events_event_type_check,
  ADD CONSTRAINT operational_incident_events_event_type_check
    CHECK(event_type IN('reported','progress','resolved','note','legacy_import','corrected','cancelled'));

CREATE TABLE organization_operational_incident_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  domain TEXT NOT NULL CHECK(length(domain) BETWEEN 1 AND 80),
  code TEXT NOT NULL CHECK(code ~ '^[a-z][a-z0-9_-]{1,79}$'),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  quantity_unit TEXT NOT NULL CHECK(length(quantity_unit) BETWEEN 1 AND 30),
  sort_order INTEGER NOT NULL DEFAULT 100,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,domain,code)
);

CREATE INDEX organization_operational_incident_types_active_idx
  ON organization_operational_incident_types(organization_id,domain,sort_order,code)
  WHERE active=true;

CREATE POLICY organization_operational_incident_types_tenant_policy
  ON organization_operational_incident_types
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());
ALTER TABLE organization_operational_incident_types ENABLE ROW LEVEL SECURITY;

INSERT INTO organization_operational_incident_types(
  organization_id,domain,code,name,quantity_unit,sort_order
)
SELECT om.organization_id,'lighting',item.code,item.name,item.quantity_unit,item.sort_order
FROM organization_modules om
CROSS JOIN (VALUES
  ('lamp_out','Гэрэл асахгүй','толгой',10),
  ('fixture_damage','Гэрлийн толгой гэмтсэн','толгой',20),
  ('pole_damage','Шон гэмтсэн','шон',30),
  ('cable_fault','Кабелийн гэмтэл','тохиолдол',40),
  ('feed_fault','Тэжээлийн гэмтэл','тохиолдол',50),
  ('panel_fault','Шит, самбарын гэмтэл','тохиолдол',60),
  ('traffic_signal_fault','Гэрлэн дохионы гэмтэл','тохиолдол',70),
  ('inspection_finding','Үзлэгийн зөрчил','тохиолдол',80)
) item(code,name,quantity_unit,sort_order)
WHERE om.module_code='lighting-operations' AND om.enabled=true
ON CONFLICT(organization_id,domain,code) DO NOTHING;

CREATE TABLE operational_incident_command_receipts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  command_type TEXT NOT NULL CHECK(length(command_type) BETWEEN 1 AND 120),
  idempotency_key UUID NOT NULL,
  payload_sha256 CHAR(64) NOT NULL,
  actor_user_id UUID NOT NULL,
  result JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(result)='object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,command_type,idempotency_key),
  FOREIGN KEY(organization_id,actor_user_id)
    REFERENCES users(organization_id,id) ON DELETE RESTRICT
);

CREATE INDEX operational_incident_command_receipts_tenant_time_idx
  ON operational_incident_command_receipts(organization_id,created_at,id);
CREATE TRIGGER operational_incident_command_receipts_append_only
  BEFORE UPDATE OR DELETE ON operational_incident_command_receipts
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();
CREATE POLICY operational_incident_command_receipts_tenant_policy
  ON operational_incident_command_receipts
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());
ALTER TABLE operational_incident_command_receipts ENABLE ROW LEVEL SECURITY;

INSERT INTO permission_catalog(code,name,module_code,description) VALUES
('operational-incidents.report','Гэрэлтүүлгийн гэмтэл мэдээлэх','lighting-operations','Объект дээр ажиглагдсан гэмтлийг batch хүснэгтээр бүртгэх'),
('operational-incidents.correct','Гэмтлийн бүртгэл залруулах','lighting-operations','Бүртгэгдсэн гэмтлийн лавлагаа, хэмжээг шалтгаантай залруулах'),
('operational-incidents.cancel','Гэмтлийн бүртгэл цуцлах','lighting-operations','Алдаатай гэмтлийн бүртгэлийг шалтгаантай хүчингүй болгох')
ON CONFLICT(code) DO UPDATE SET
  name=EXCLUDED.name,module_code=EXCLUDED.module_code,description=EXCLUDED.description;

INSERT INTO organization_roles(organization_id,code,name,system)
SELECT om.organization_id,role.code,role.name,true
FROM organization_modules om
CROSS JOIN (VALUES
  ('lighting-incident-reporter','Гэрэлтүүлгийн гэмтэл мэдээлэгч'),
  ('lighting-incident-supervisor','Гэрэлтүүлгийн гэмтлийн хянагч')
) role(code,name)
WHERE om.module_code='lighting-operations' AND om.enabled=true
ON CONFLICT(organization_id,code) DO UPDATE SET name=EXCLUDED.name,active=true;

INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
SELECT role.organization_id,role.id,grant_row.permission_code
FROM organization_roles role
JOIN LATERAL (VALUES
  ('lighting-incident-reporter','operational-incidents.report'),
  ('lighting-incident-supervisor','operational-incidents.report'),
  ('lighting-incident-supervisor','operational-incidents.correct'),
  ('lighting-incident-supervisor','operational-incidents.cancel')
) grant_row(role_code,permission_code) ON grant_row.role_code=role.code
ON CONFLICT DO NOTHING;

INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
SELECT role.organization_id,role.id,permission.code
FROM organization_roles role CROSS JOIN permission_catalog permission
WHERE role.code IN('owner','administrator')
ON CONFLICT DO NOTHING;

-- Compatibility assignment only: the legacy job label is translated once to
-- an explicit lighting-domain role. Runtime authorization never checks it.
INSERT INTO user_roles(organization_id,user_id,role_id)
SELECT user_row.organization_id,user_row.id,role.id
FROM users user_row
JOIN organization_modules om ON om.organization_id=user_row.organization_id
  AND om.module_code='lighting-operations' AND om.enabled=true
JOIN organization_roles role ON role.organization_id=user_row.organization_id
  AND role.code=CASE
    WHEN user_row.role IN('director','chief_engineer') THEN 'lighting-incident-supervisor'
    WHEN user_row.role IN('engineer','electric') THEN 'lighting-incident-reporter'
  END
WHERE user_row.active=true
  AND user_row.role IN('director','chief_engineer','engineer','electric')
ON CONFLICT DO NOTHING;

INSERT INTO data_catalog_assets(code,name,domain,source_object,description,classification_code,owner_role_code)
VALUES
('operational-incident-type','Үйл ажиллагааны гэмтлийн төрөл','operations','organization_operational_incident_types','Tenant-ийн үйл ажиллагааны гэмтлийн хязгаарлагдсан reference бүртгэл','internal','chief_engineer'),
('operational-incident-command-receipt','Гэмтлийн командын баримт','operations','operational_incident_command_receipts','Exact-payload idempotency болон давтан илгээлтийн өөрчлөх боломжгүй баримт','restricted','owner')
ON CONFLICT(code) DO NOTHING;

COMMENT ON TABLE organization_operational_incident_types IS
  'Tenant-owned bounded reference data for operational incident capture; not a free-form universal catalog.';
COMMENT ON TABLE operational_incident_command_receipts IS
  'Append-only exact-payload idempotency evidence for incident commands.';
