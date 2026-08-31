-- Operational Object dossier: preserve the accounting Asset master while
-- assigning dated, quantified portions/components to functional objects.

INSERT INTO permission_catalog(code,name,module_code,description) VALUES
('operational-objects.read','Объектын хувийн хэрэг харах','assets','Ашиглалтын объектын бүрэлдэхүүн, ажил, гэмтэл, түүхийг харах'),
('operational-objects.components.manage','Объектын бүрэлдэхүүн удирдах','assets','Хөрөнгийг ашиглалтын объектод тоо хэмжээгээр оноох ба холбоосыг дуусгах'),
('operational-objects.notes.create','Объектын тэмдэглэл үүсгэх','assets','Ашиглалтын объектын хувийн хэрэгт түүхэн тэмдэглэл нэмэх')
ON CONFLICT(code) DO UPDATE SET
  name=EXCLUDED.name,module_code=EXCLUDED.module_code,description=EXCLUDED.description;

INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
SELECT r.organization_id,r.id,p.permission_code
FROM organization_roles r
JOIN LATERAL (VALUES
  ('work-order-manager','operational-objects.read'),
  ('work-order-manager','operational-objects.components.manage'),
  ('work-order-manager','operational-objects.notes.create'),
  ('work-order-coordinator','operational-objects.read'),
  ('work-order-coordinator','operational-objects.notes.create'),
  ('work-order-material-custodian','operational-objects.read')
) p(role_code,permission_code) ON p.role_code=r.code
ON CONFLICT DO NOTHING;

INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
SELECT r.organization_id,r.id,p.code
FROM organization_roles r CROSS JOIN permission_catalog p
WHERE r.code IN ('owner','administrator')
ON CONFLICT DO NOTHING;

ALTER TABLE operational_object_components
  DROP CONSTRAINT operational_object_components_organization_id_operational_o_key;
CREATE UNIQUE INDEX operational_object_components_active_unique_idx
  ON operational_object_components(organization_id,operational_object_id,asset_id,component_role)
  WHERE removed_at IS NULL;
CREATE INDEX operational_object_components_asset_active_idx
  ON operational_object_components(organization_id,asset_id,operational_object_id)
  WHERE removed_at IS NULL;

-- Preserve only explicit legacy object-to-asset references. A quantity of one
-- means one linked master record; physical pole/cable quantities are entered
-- separately by an authorized user and are never inferred from lamp counts.
INSERT INTO operational_object_components(
  organization_id,operational_object_id,asset_id,component_role,quantity,unit,installed_at,metadata
)
SELECT o.organization_id,o.id,a.id,'legacy_master_reference',1,'ш',NULL,
  jsonb_build_object('source','choibalsan-legacy-demo','sourceObjectTable',o.source_table,'sourceObjectId',o.source_id)
FROM operational_objects o
JOIN source_import_records s ON s.organization_id=o.organization_id
  AND s.source_system='choibalsan-legacy-demo' AND s.source_table='assets'
  AND s.source_id=o.metadata->>'legacyAssetId' AND s.target_type='asset'
JOIN assets a ON a.organization_id=s.organization_id AND a.id::text=s.target_id
WHERE o.source_system='choibalsan-legacy-demo' AND o.metadata->>'legacyAssetId' IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE TABLE operational_object_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  operational_object_id UUID NOT NULL,
  actor_user_id UUID,
  event_type TEXT NOT NULL CHECK(event_type IN('component_assigned','component_removed','note')),
  note TEXT NOT NULL DEFAULT '',
  detail JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(detail)='object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,operational_object_id)
    REFERENCES operational_objects(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,actor_user_id)
    REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX operational_object_events_object_idx
  ON operational_object_events(organization_id,operational_object_id,created_at DESC,id DESC);
CREATE TRIGGER operational_object_events_append_only
  BEFORE UPDATE OR DELETE ON operational_object_events
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

INSERT INTO operational_object_events(
  organization_id,operational_object_id,actor_user_id,event_type,note,detail,created_at
)
SELECT c.organization_id,c.operational_object_id,NULL,'component_assigned',
  'Хуучин системийн тодорхой холбоосыг хадгалсан',
  jsonb_build_object('componentId',c.id,'assetId',c.asset_id,'quantity',c.quantity,'unit',c.unit,'source','choibalsan-legacy-demo'),
  c.created_at
FROM operational_object_components c
WHERE c.metadata->>'source'='choibalsan-legacy-demo';
