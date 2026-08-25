-- Generic operational incident model and immutable import provenance.
-- Lighting is a tenant workspace; the data model remains reusable for any industry.

INSERT INTO module_catalog(code,name,description,category,monthly_price,core,active)
VALUES(
  'lighting-operations',
  'Гэрэлтүүлгийн үйл ажиллагаа',
  'Гэрэлтүүлгийн объект, гэмтэл, ажлын захиалга, нотолгоо болон батлах урсгал',
  'Үйл ажиллагаа',0,false,true
)
ON CONFLICT(code) DO UPDATE SET
  name=EXCLUDED.name,description=EXCLUDED.description,category=EXCLUDED.category,
  core=EXCLUDED.core,active=EXCLUDED.active;

-- This is a tenant specialization, not a universal OVERVA sidebar item.
INSERT INTO organization_modules(organization_id,module_code,enabled)
SELECT id,'lighting-operations',true FROM organizations WHERE slug='choibalsan-hugjil'
ON CONFLICT(organization_id,module_code) DO UPDATE SET enabled=true,enabled_at=now();

CREATE TABLE operational_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  domain TEXT NOT NULL,
  asset_id UUID,
  incident_type TEXT NOT NULL,
  title TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  affected_quantity INTEGER NOT NULL DEFAULT 0 CHECK(affected_quantity >= 0),
  resolved_quantity INTEGER NOT NULL DEFAULT 0 CHECK(resolved_quantity >= 0 AND resolved_quantity <= affected_quantity),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','resolved','cancelled')),
  reported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reported_by UUID,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(detail)='object'),
  source_system TEXT,
  external_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,source_system,external_id),
  FOREIGN KEY(organization_id,asset_id) REFERENCES assets(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,reported_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX operational_incidents_org_domain_status_idx
  ON operational_incidents(organization_id,domain,status,reported_at DESC);

CREATE TABLE operational_incident_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  incident_id UUID NOT NULL,
  actor_user_id UUID,
  event_type TEXT NOT NULL CHECK(event_type IN ('reported','progress','resolved','note','legacy_import')),
  quantity INTEGER CHECK(quantity IS NULL OR quantity >= 0),
  note TEXT NOT NULL DEFAULT '',
  detail JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(detail)='object'),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,incident_id) REFERENCES operational_incidents(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,actor_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX operational_incident_events_org_incident_time_idx
  ON operational_incident_events(organization_id,incident_id,occurred_at,id);
CREATE TRIGGER operational_incident_events_append_only
  BEFORE UPDATE OR DELETE ON operational_incident_events
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

CREATE TABLE source_import_records (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  source_system TEXT NOT NULL,
  source_table TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  source_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(source_snapshot)='object'),
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(warnings)='array'),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,source_system,source_table,source_id)
);
CREATE INDEX source_import_records_org_target_idx
  ON source_import_records(organization_id,target_type,target_id);
CREATE TRIGGER source_import_records_append_only
  BEFORE UPDATE OR DELETE ON source_import_records
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

INSERT INTO data_catalog_assets(code,name,domain,source_object,description,classification_code,owner_role_code)
VALUES
('operational-incident','Үйл ажиллагааны зөрчил, гэмтэл','operations','operational_incidents','Хөрөнгө, байршил, гэмтэл болон шийдвэрлэлтийг холбосон үндсэн бүртгэл','internal','chief_engineer'),
('source-import-provenance','Импортын эх сурвалжийн мөр','governance','source_import_records','Хуучин системийн мөрийг OVERVA объекттой өөрчлөх боломжгүйгээр холбосон эх сурвалжийн бүртгэл','restricted','owner')
ON CONFLICT(code) DO NOTHING;
