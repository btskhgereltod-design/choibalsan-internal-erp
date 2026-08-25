-- Operational objects are functional systems/segments made from one or more
-- accounting assets. They are deliberately not part of the fixed-asset master.

CREATE TABLE operational_objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  parent_object_id UUID,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  object_type TEXT NOT NULL,
  domain TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive','repair','retired')),
  linear_length_m NUMERIC(14,2) CHECK(linear_length_m IS NULL OR linear_length_m >= 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(metadata)='object'),
  source_system TEXT,
  source_table TEXT,
  source_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,code),
  UNIQUE(organization_id,source_system,source_table,source_id),
  FOREIGN KEY(organization_id,parent_object_id)
    REFERENCES operational_objects(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX operational_objects_org_domain_status_idx
  ON operational_objects(organization_id,domain,status,name);

CREATE TABLE operational_object_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  operational_object_id UUID NOT NULL,
  asset_id UUID NOT NULL,
  component_role TEXT NOT NULL DEFAULT 'component',
  quantity NUMERIC(14,3) NOT NULL DEFAULT 1 CHECK(quantity > 0),
  unit TEXT NOT NULL DEFAULT 'ш',
  installed_at DATE,
  removed_at DATE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(metadata)='object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,operational_object_id,asset_id,component_role),
  FOREIGN KEY(organization_id,operational_object_id)
    REFERENCES operational_objects(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,asset_id)
    REFERENCES assets(organization_id,id) ON DELETE RESTRICT,
  CHECK(removed_at IS NULL OR installed_at IS NULL OR removed_at >= installed_at)
);

ALTER TABLE operational_incidents ADD COLUMN operational_object_id UUID;
ALTER TABLE operational_incidents ADD CONSTRAINT operational_incidents_object_tenant_fk
  FOREIGN KEY(organization_id,operational_object_id)
  REFERENCES operational_objects(organization_id,id) ON DELETE RESTRICT;
ALTER TABLE work_orders ADD COLUMN operational_object_id UUID;
ALTER TABLE work_orders ADD CONSTRAINT work_orders_object_tenant_fk
  FOREIGN KEY(organization_id,operational_object_id)
  REFERENCES operational_objects(organization_id,id) ON DELETE RESTRICT;

-- An outcome is measured with quantities, not an editable "percent complete".
-- Unresolved/deferred quantities require an accepted exception before closure.
CREATE TABLE work_order_scope_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  work_order_id UUID NOT NULL,
  operational_object_id UUID,
  asset_id UUID,
  item_code TEXT NOT NULL,
  description TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'ш',
  planned_quantity NUMERIC(14,3) NOT NULL CHECK(planned_quantity > 0),
  completed_quantity NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK(completed_quantity >= 0),
  unresolved_quantity NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK(unresolved_quantity >= 0),
  deferred_quantity NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK(deferred_quantity >= 0),
  weight NUMERIC(8,3) NOT NULL DEFAULT 1 CHECK(weight > 0),
  outcome_status TEXT NOT NULL DEFAULT 'pending'
    CHECK(outcome_status IN ('pending','in_progress','completed','blocked','deferred','closed_with_exception')),
  exception_status TEXT NOT NULL DEFAULT 'none'
    CHECK(exception_status IN ('none','requested','accepted','rejected')),
  exception_reason TEXT NOT NULL DEFAULT '',
  exception_accepted_by UUID,
  exception_accepted_at TIMESTAMPTZ,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(evidence)='array'),
  created_by UUID,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,work_order_id,item_code),
  FOREIGN KEY(organization_id,work_order_id)
    REFERENCES work_orders(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,operational_object_id)
    REFERENCES operational_objects(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,asset_id)
    REFERENCES assets(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,exception_accepted_by)
    REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,created_by)
    REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,updated_by)
    REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  CHECK(completed_quantity + unresolved_quantity + deferred_quantity <= planned_quantity),
  CHECK((exception_status='accepted' AND exception_accepted_by IS NOT NULL AND exception_accepted_at IS NOT NULL)
     OR (exception_status<>'accepted' AND exception_accepted_by IS NULL AND exception_accepted_at IS NULL)),
  CHECK(outcome_status<>'completed' OR (completed_quantity=planned_quantity AND unresolved_quantity=0 AND deferred_quantity=0)),
  CHECK(outcome_status<>'closed_with_exception' OR (
    completed_quantity + unresolved_quantity + deferred_quantity=planned_quantity AND
    unresolved_quantity + deferred_quantity>0 AND exception_status='accepted'))
);
CREATE INDEX work_order_scope_items_order_idx
  ON work_order_scope_items(organization_id,work_order_id,item_code);

CREATE TABLE work_order_scope_item_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  work_order_id UUID NOT NULL,
  scope_item_id UUID NOT NULL,
  actor_user_id UUID,
  event_type TEXT NOT NULL CHECK(event_type IN ('created','progress','exception_requested','exception_decided','note')),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(detail)='object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,work_order_id)
    REFERENCES work_orders(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,scope_item_id)
    REFERENCES work_order_scope_items(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,actor_user_id)
    REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE TRIGGER work_order_scope_item_events_append_only
  BEFORE UPDATE OR DELETE ON work_order_scope_item_events
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

-- Reclassify the previous lighting import. Those rows represented functional
-- lighting objects, not accountant-owned fixed assets.
INSERT INTO operational_objects(
  organization_id,code,name,object_type,domain,location,status,metadata,
  source_system,source_table,source_id,created_at,updated_at
)
SELECT a.organization_id,a.code,a.name,
  CASE WHEN a.category='lighting.meter-point' THEN 'meter_point' ELSE 'lighting_group' END,
  'lighting',a.location,a.status,
  a.metadata || jsonb_build_object('migratedFromLegacyAssetId',a.id),
  s.source_system,s.source_table,s.source_id,a.created_at,a.updated_at
FROM assets a
JOIN source_import_records s ON s.organization_id=a.organization_id
  AND s.target_type='asset' AND s.target_id=a.id::text
WHERE a.category LIKE 'lighting.%'
ON CONFLICT(organization_id,source_system,source_table,source_id) DO NOTHING;

UPDATE operational_incidents i SET operational_object_id=o.id
FROM source_import_records s,operational_objects o
WHERE s.organization_id=i.organization_id AND s.target_type='asset' AND s.target_id=i.asset_id::text
  AND o.organization_id=s.organization_id AND o.source_system=s.source_system
  AND o.source_table=s.source_table AND o.source_id=s.source_id
  AND i.operational_object_id IS NULL;

UPDATE work_orders w SET operational_object_id=o.id
FROM source_import_records s,operational_objects o
WHERE s.organization_id=w.organization_id AND s.target_type='asset' AND s.target_id=w.asset_id::text
  AND o.organization_id=s.organization_id AND o.source_system=s.source_system
  AND o.source_table=s.source_table AND o.source_id=s.source_id
  AND w.operational_object_id IS NULL;

UPDATE assets a SET status='retired',updated_at=now(),metadata=a.metadata ||
  jsonb_build_object('recordClass','legacy_operational_object','excludedFromAssetMaster',true)
FROM source_import_records s
WHERE s.organization_id=a.organization_id AND s.target_type='asset' AND s.target_id=a.id::text
  AND a.category LIKE 'lighting.%';

INSERT INTO data_catalog_assets(code,name,domain,source_object,description,classification_code,owner_role_code)
VALUES
('operational-object','Ашиглалтын объект','operations','operational_objects','Олон үндсэн хөрөнгө, эд ангиас бүрдэх ашиглалтын систем, шугам, талбай эсвэл хэсэг','internal','chief_engineer'),
('operational-object-component','Объектын бүрэлдэхүүн','operations','operational_object_components','Ашиглалтын объект ба нягтлангийн үндсэн хөрөнгийн хугацаатай холбоос','internal','accountant'),
('measured-work-outcome','Ажлын хэмжигдэхүйц үр дүн','operations','work_order_scope_items','Төлөвлөсөн, гүйцэтгэсэн, шийдэгдээгүй, хойшлуулсан тоо хэмжээ болон зөвшөөрсөн үл хамаарах нөхцөл','internal','chief_engineer')
ON CONFLICT(code) DO NOTHING;
