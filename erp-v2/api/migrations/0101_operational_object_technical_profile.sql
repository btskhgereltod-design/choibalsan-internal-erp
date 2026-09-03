-- Versioned operational-object technical profile. A profile is a full,
-- immutable snapshot; editing creates a new version and keeps prior facts.

CREATE TABLE operational_object_specifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  operational_object_id UUID NOT NULL,
  version_no BIGINT NOT NULL CHECK(version_no > 0),
  pole_count INTEGER NOT NULL DEFAULT 0 CHECK(pole_count >= 0),
  note TEXT NOT NULL DEFAULT '',
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,operational_object_id,version_no),
  UNIQUE(organization_id,operational_object_id,id),
  FOREIGN KEY(organization_id,operational_object_id)
    REFERENCES operational_objects(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,created_by)
    REFERENCES users(organization_id,id) ON DELETE RESTRICT
);

CREATE TABLE operational_object_lamp_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  specification_id UUID NOT NULL,
  lamp_type TEXT NOT NULL DEFAULT '',
  wattage_w NUMERIC(10,2) NOT NULL CHECK(wattage_w > 0),
  head_count INTEGER NOT NULL CHECK(head_count > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,specification_id,lamp_type,wattage_w),
  FOREIGN KEY(organization_id,specification_id)
    REFERENCES operational_object_specifications(organization_id,id) ON DELETE RESTRICT
);

CREATE TABLE operational_object_supply_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  specification_id UUID NOT NULL,
  sequence_no INTEGER NOT NULL CHECK(sequence_no > 0),
  name TEXT NOT NULL,
  panel_asset_id UUID,
  panel_reference TEXT NOT NULL DEFAULT '',
  meter_asset_id UUID,
  meter_number TEXT NOT NULL DEFAULT '',
  latitude NUMERIC(9,6),
  longitude NUMERIC(10,6),
  location_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,specification_id,sequence_no),
  FOREIGN KEY(organization_id,specification_id)
    REFERENCES operational_object_specifications(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,panel_asset_id)
    REFERENCES assets(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,meter_asset_id)
    REFERENCES assets(organization_id,id) ON DELETE RESTRICT,
  CHECK((latitude IS NULL)=(longitude IS NULL)),
  CHECK(latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CHECK(longitude IS NULL OR longitude BETWEEN -180 AND 180)
);

ALTER TABLE operational_objects ADD COLUMN current_specification_id UUID;
ALTER TABLE operational_objects
  ADD CONSTRAINT operational_objects_current_specification_tenant_fk
  FOREIGN KEY(organization_id,id,current_specification_id)
  REFERENCES operational_object_specifications(organization_id,operational_object_id,id)
  ON DELETE RESTRICT;

CREATE INDEX operational_object_specifications_object_idx
  ON operational_object_specifications(organization_id,operational_object_id,version_no DESC);
CREATE INDEX operational_object_lamp_groups_spec_idx
  ON operational_object_lamp_groups(organization_id,specification_id);
CREATE INDEX operational_object_supply_points_spec_idx
  ON operational_object_supply_points(organization_id,specification_id,sequence_no);

CREATE TRIGGER operational_object_specifications_append_only
  BEFORE UPDATE OR DELETE ON operational_object_specifications
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();
CREATE TRIGGER operational_object_lamp_groups_append_only
  BEFORE UPDATE OR DELETE ON operational_object_lamp_groups
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();
CREATE TRIGGER operational_object_supply_points_append_only
  BEFORE UPDATE OR DELETE ON operational_object_supply_points
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

CREATE POLICY operational_object_specifications_tenant_policy
  ON operational_object_specifications
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY operational_object_lamp_groups_tenant_policy
  ON operational_object_lamp_groups
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY operational_object_supply_points_tenant_policy
  ON operational_object_supply_points
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());

ALTER TABLE operational_object_specifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_object_lamp_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_object_supply_points ENABLE ROW LEVEL SECURITY;

ALTER TABLE operational_object_events
  DROP CONSTRAINT operational_object_events_event_type_check;
ALTER TABLE operational_object_events
  ADD CONSTRAINT operational_object_events_event_type_check
  CHECK(event_type IN('component_assigned','component_removed','note','updated','retired','specification_changed','media_added'));

INSERT INTO permission_catalog(code,name,module_code,description) VALUES
('operational-objects.media.manage','Объектын зураг, схем удирдах','assets','Объектын байршлын схем болон ерөнхий фотог canonical баримтын хувилбар, холбоос, audit-тай нэмэх')
ON CONFLICT(code) DO UPDATE SET
  name=EXCLUDED.name,module_code=EXCLUDED.module_code,description=EXCLUDED.description;

INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
SELECT r.organization_id,r.id,'operational-objects.media.manage'
FROM organization_roles r WHERE r.code='work-order-manager'
ON CONFLICT DO NOTHING;

INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
SELECT r.organization_id,r.id,p.code
FROM organization_roles r CROSS JOIN permission_catalog p
WHERE r.code IN('owner','administrator')
ON CONFLICT DO NOTHING;

INSERT INTO data_catalog_assets(code,name,domain,source_object,description,classification_code,owner_role_code)
VALUES
('operational-object-specification','Ашиглалтын объектын техникийн үзүүлэлт','operations','operational_object_specifications','Шон, чадлаарх гэрлийн толгой болон тэжээлийн цэгийн append-only хувилбар','internal','chief_engineer'),
('operational-object-supply-point','Объектын тэжээлийн цэг','operations','operational_object_supply_points','Щит, тоолуур, GPS болон байршлын тайлбар бүхий техникийн цэг','internal','chief_engineer')
ON CONFLICT(code) DO NOTHING;
