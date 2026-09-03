-- Camera object master profile. Reuses the operational-object specification
-- version/pointer introduced in 0101 and keeps camera mounting points and
-- device groups normalized instead of storing only aggregate JSON counters.

ALTER TABLE operational_object_specifications
  ADD COLUMN profile_kind TEXT NOT NULL DEFAULT 'lighting';
ALTER TABLE operational_object_specifications
  ADD CONSTRAINT operational_object_specifications_profile_kind_check
  CHECK(profile_kind IN('lighting','camera'));

CREATE TABLE operational_object_camera_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  specification_id UUID NOT NULL,
  sequence_no INTEGER NOT NULL CHECK(sequence_no > 0),
  name TEXT NOT NULL,
  pole_reference TEXT NOT NULL DEFAULT '',
  latitude NUMERIC(9,6),
  longitude NUMERIC(10,6),
  location_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,specification_id,sequence_no),
  UNIQUE(organization_id,specification_id,id),
  FOREIGN KEY(organization_id,specification_id)
    REFERENCES operational_object_specifications(organization_id,id) ON DELETE RESTRICT,
  CHECK((latitude IS NULL)=(longitude IS NULL)),
  CHECK(latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CHECK(longitude IS NULL OR longitude BETWEEN -180 AND 180)
);

CREATE TABLE operational_object_camera_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  specification_id UUID NOT NULL,
  camera_point_id UUID NOT NULL,
  sequence_no INTEGER NOT NULL CHECK(sequence_no > 0),
  device_type TEXT NOT NULL,
  manufacturer TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  resolution_mp NUMERIC(8,2) CHECK(resolution_mp IS NULL OR resolution_mp > 0),
  lens_mm NUMERIC(8,2) CHECK(lens_mm IS NULL OR lens_mm > 0),
  supports_ptz BOOLEAN NOT NULL DEFAULT false,
  night_vision BOOLEAN NOT NULL DEFAULT false,
  connectivity TEXT NOT NULL DEFAULT '',
  power_source TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(attributes)='object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,camera_point_id,sequence_no),
  FOREIGN KEY(organization_id,specification_id)
    REFERENCES operational_object_specifications(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,specification_id,camera_point_id)
    REFERENCES operational_object_camera_points(organization_id,specification_id,id) ON DELETE RESTRICT
);

CREATE INDEX operational_object_camera_points_spec_idx
  ON operational_object_camera_points(organization_id,specification_id,sequence_no);
CREATE INDEX operational_object_camera_devices_point_idx
  ON operational_object_camera_devices(organization_id,camera_point_id,sequence_no);

CREATE TRIGGER operational_object_camera_points_append_only
  BEFORE UPDATE OR DELETE ON operational_object_camera_points
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();
CREATE TRIGGER operational_object_camera_devices_append_only
  BEFORE UPDATE OR DELETE ON operational_object_camera_devices
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

CREATE POLICY operational_object_camera_points_tenant_policy
  ON operational_object_camera_points
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY operational_object_camera_devices_tenant_policy
  ON operational_object_camera_devices
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());
ALTER TABLE operational_object_camera_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_object_camera_devices ENABLE ROW LEVEL SECURITY;

-- Choibalsan review: panel/board is equipment inside a lighting object, not a
-- separate service-area card. Preserve the row and every historical foreign
-- key; only remove it from active selection/projection.
UPDATE organization_work_service_areas area
SET active=false,updated_at=now()
FROM organizations organization
WHERE organization.id=area.organization_id
  AND organization.slug='choibalsan-hugjil'
  AND area.domain='lighting' AND area.code='panel-board';

INSERT INTO data_catalog_assets(code,name,domain,source_object,description,classification_code,owner_role_code)
VALUES
('operational-object-camera-point','Камерын объектын шон, цэг','operations','operational_object_camera_points','Камер суурилуулсан шон эсвэл цэгийн хувилбартай GPS ба байршлын master','internal','chief_engineer'),
('operational-object-camera-device','Камерын төхөөрөмжийн бүлэг','operations','operational_object_camera_devices','Нэг шон, цэг дээрх төрөл ба техникийн үзүүлэлтээр бүлэглэсэн камерын master','internal','chief_engineer')
ON CONFLICT(code) DO NOTHING;
