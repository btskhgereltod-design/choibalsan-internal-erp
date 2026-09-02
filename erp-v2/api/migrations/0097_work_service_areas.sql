-- A service area says what kind of organizational service a need/work belongs
-- to. It is independent from the responsible department, Work Type and Kanban
-- workflow stage.

CREATE TABLE organization_work_service_areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  domain TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,domain,code),
  CHECK(domain~'^[a-z][a-z0-9_-]{1,79}$'),
  CHECK(code~'^[a-z][a-z0-9_-]{1,79}$')
);

CREATE POLICY organization_work_service_areas_tenant_policy ON organization_work_service_areas
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());
ALTER TABLE organization_work_service_areas ENABLE ROW LEVEL SECURITY;

ALTER TABLE operational_incidents ADD COLUMN service_area_id UUID;
ALTER TABLE operational_incidents ADD CONSTRAINT operational_incidents_service_area_tenant_fk
  FOREIGN KEY(organization_id,service_area_id)
  REFERENCES organization_work_service_areas(organization_id,id) ON DELETE RESTRICT;
CREATE INDEX operational_incidents_service_area_idx
  ON operational_incidents(organization_id,service_area_id,status,reported_at DESC);

ALTER TABLE work_orders ADD COLUMN service_area_id UUID;
ALTER TABLE work_orders ADD CONSTRAINT work_orders_service_area_tenant_fk
  FOREIGN KEY(organization_id,service_area_id)
  REFERENCES organization_work_service_areas(organization_id,id) ON DELETE RESTRICT;
CREATE INDEX work_orders_service_area_idx
  ON work_orders(organization_id,service_area_id,status,created_at DESC);

-- Choibalsan's five lighting service areas come from the reviewed legacy
-- operating view. They are tenant configuration, not universal OVERVA terms.
INSERT INTO organization_work_service_areas(
  organization_id,domain,code,name,icon,sort_order
)
SELECT o.id,'lighting',v.code,v.name,v.icon,v.sort_order
FROM organizations o
CROSS JOIN (VALUES
  ('road-lighting','Авто замын гэрэл','💡',10),
  ('ger-area-lighting','Гэр хорооллын гэрэл','🏘️',20),
  ('tower-lighting','Цамхагийн гэрэл','🗼',30),
  ('panel-board','Шит/Самбар','⚡',40),
  ('traffic-signal','Гэрлэн дохио','🚦',50)
) v(code,name,icon,sort_order)
WHERE o.slug='choibalsan-hugjil'
ON CONFLICT(organization_id,domain,code) DO UPDATE SET
  name=EXCLUDED.name,icon=EXCLUDED.icon,sort_order=EXCLUDED.sort_order,
  active=true,updated_at=now();

-- Exact source classifications are safe to project onto current incidents.
UPDATE operational_incidents i
SET service_area_id=area.id,updated_at=now()
FROM organization_work_service_areas area
WHERE i.organization_id=area.organization_id AND i.domain=area.domain
  AND i.service_area_id IS NULL
  AND area.code=CASE i.incident_type
    WHEN 'Авто замын гэрэл' THEN 'road-lighting'
    WHEN 'Гэр хорооллын гэрэл' THEN 'ger-area-lighting'
    WHEN 'Цамхагийн гэрэл' THEN 'tower-lighting'
    WHEN 'Шит/Самбар' THEN 'panel-board'
    WHEN 'Гэрлэн дохио' THEN 'traffic-signal'
  END;

-- A linked Work Order inherits the reviewed source classification.
UPDATE work_orders w
SET service_area_id=i.service_area_id,updated_at=now()
FROM operational_incident_work_orders link
JOIN operational_incidents i
  ON i.organization_id=link.organization_id AND i.id=link.incident_id
WHERE w.organization_id=link.organization_id AND w.id=link.work_order_id
  AND w.service_area_id IS NULL AND i.service_area_id IS NOT NULL;

-- Existing traffic-signal Work Types and legacy street-lighting source objects
-- are deterministic evidence for those two service areas.
UPDATE work_orders w
SET service_area_id=area.id,updated_at=now()
FROM organization_work_types wt,organization_work_service_areas area
WHERE wt.organization_id=w.organization_id AND wt.id=w.work_type_id
  AND area.organization_id=w.organization_id AND area.domain='lighting'
  AND area.code='traffic-signal' AND wt.code='traffic-signal-repair'
  AND w.service_area_id IS NULL;

UPDATE work_orders w
SET service_area_id=area.id,updated_at=now()
FROM operational_objects oo,organization_work_service_areas area
WHERE oo.organization_id=w.organization_id AND oo.id=w.operational_object_id
  AND area.organization_id=w.organization_id AND area.domain='lighting'
  AND area.code='road-lighting' AND oo.source_table='sl_points'
  AND w.service_area_id IS NULL;

-- The retained source snapshot is the authority for ger-area versus tower
-- inventory. The literal question-mark values cover the already-imported
-- legacy encoding evidence; clean source labels cover future rehearsals.
UPDATE work_orders w
SET service_area_id=area.id,updated_at=now()
FROM operational_objects oo
JOIN source_import_records source
  ON source.organization_id=oo.organization_id
  AND source.source_system=oo.source_system
  AND source.source_table=oo.source_table
  AND source.source_id=oo.source_id,
organization_work_service_areas area
WHERE oo.organization_id=w.organization_id AND oo.id=w.operational_object_id
  AND oo.source_table='sl_ger_inventory'
  AND area.organization_id=w.organization_id AND area.domain='lighting'
  AND area.code=CASE
    WHEN source.source_snapshot->>'category' IN(
      'Гэр хороолол','Гэр хорооллын гэрэл','??? ????????'
    ) THEN 'ger-area-lighting'
    WHEN source.source_snapshot->>'category' IN(
      'Цамхаг','Цамхагийн гэрэл','??????'
    ) THEN 'tower-lighting'
  END
  AND w.service_area_id IS NULL;

INSERT INTO data_catalog_assets(
  code,name,domain,source_object,description,classification_code,owner_role_code
)
VALUES(
  'work-service-area',
  'Байгууллагын ажлын үйлчилгээний чиглэл',
  'operations',
  'organization_work_service_areas',
  'Тасаг, Work Type болон workflow шатаас тусдаа tenant-owned үйлчилгээний ангилал',
  'internal',
  'chief_engineer'
)
ON CONFLICT(code) DO NOTHING;

COMMENT ON TABLE organization_work_service_areas IS
  'Tenant-owned presentation and reporting dimension for service queues; not a department, permission grant, Work Type or workflow state.';
COMMENT ON COLUMN operational_incidents.service_area_id IS
  'Reviewed service-area classification of the source need; nullable when evidence is incomplete.';
COMMENT ON COLUMN work_orders.service_area_id IS
  'Service-area snapshot used to keep one work visible through every Kanban stage.';
