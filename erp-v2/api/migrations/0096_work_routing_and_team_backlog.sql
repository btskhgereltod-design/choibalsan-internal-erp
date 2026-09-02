-- Keep one Work Order engine while separating why work exists, how it is
-- governed, and who may pull it from a configured team backlog.

ALTER TABLE organization_work_types
  ADD COLUMN operational_stream TEXT,
  ADD CONSTRAINT organization_work_types_operational_stream_check
    CHECK(operational_stream IS NULL OR operational_stream IN('core_service','internal_operation'));

ALTER TABLE work_orders
  ADD COLUMN operational_stream TEXT,
  ADD COLUMN assignment_kind TEXT NOT NULL DEFAULT 'normal',
  ADD CONSTRAINT work_orders_operational_stream_check
    CHECK(operational_stream IS NULL OR operational_stream IN('core_service','internal_operation')),
  ADD CONSTRAINT work_orders_assignment_kind_check
    CHECK(assignment_kind IN('normal','special','emergency'));

CREATE INDEX work_orders_team_backlog_idx
  ON work_orders(organization_id,department_id,operational_stream,created_at)
  WHERE assigned_to IS NULL AND status NOT IN('completed','cancelled');

CREATE TABLE organization_work_intake_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  incident_domain TEXT NOT NULL,
  work_type_id UUID NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,incident_domain),
  FOREIGN KEY(organization_id,work_type_id)
    REFERENCES organization_work_types(organization_id,id) ON DELETE RESTRICT,
  CHECK(incident_domain~'^[a-z][a-z0-9_-]{1,79}$')
);

CREATE POLICY organization_work_intake_routes_tenant_policy ON organization_work_intake_routes
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());
ALTER TABLE organization_work_intake_routes ENABLE ROW LEVEL SECURITY;

-- Self-claim is still a canonical assignment event, but remains distinguishable
-- from a manager/API assignment in the immutable timeline.
ALTER TABLE work_order_events DROP CONSTRAINT work_order_events_assignment_source_check;
ALTER TABLE work_order_events ADD CONSTRAINT work_order_events_assignment_source_check CHECK(
  assignment_source IS NULL OR assignment_source IN('api','import','system','self_claim')
);

-- Pilot configuration only: public lighting/camera work is a core service.
-- Other tenant work types remain unclassified until their own onboarding review.
UPDATE organization_work_types wt
SET operational_stream='core_service'
FROM organizations o
WHERE wt.organization_id=o.id AND o.slug='choibalsan-hugjil'
  AND wt.code IN(
    'lighting-inspection','lighting-repair','traffic-signal-repair',
    'camera-inspection','camera-repair','camera-maintenance','camera-network-repair'
  );

INSERT INTO organization_work_intake_routes(organization_id,incident_domain,work_type_id)
SELECT wt.organization_id,v.incident_domain,wt.id
FROM (VALUES('lighting','lighting-repair'),('camera','camera-repair')) v(incident_domain,work_type_code)
JOIN organizations o ON o.slug='choibalsan-hugjil'
JOIN organization_work_types wt ON wt.organization_id=o.id AND wt.code=v.work_type_code
ON CONFLICT(organization_id,incident_domain) DO UPDATE SET
  work_type_id=EXCLUDED.work_type_id,active=true,updated_at=now();

UPDATE work_orders w
SET operational_stream=wt.operational_stream
FROM organization_work_types wt
WHERE wt.organization_id=w.organization_id AND wt.id=w.work_type_id
  AND wt.operational_stream IS NOT NULL AND w.operational_stream IS NULL;

-- These are the fifteen independently reviewed legacy fleet/facilities/general
-- records removed from the false lighting route by the preceding correction.
UPDATE work_orders w
SET operational_stream='internal_operation'
FROM organizations o
WHERE w.organization_id=o.id AND o.slug='choibalsan-hugjil'
  AND w.work_type_id IS NULL AND w.operational_stream IS NULL
  AND EXISTS(
    SELECT 1 FROM work_order_events we
    WHERE we.organization_id=w.organization_id AND we.work_order_id=w.id
      AND we.detail->>'sourceReconciliation'='legacy-workflow-v2'
  );

INSERT INTO data_catalog_assets(code,name,domain,source_object,description,classification_code,owner_role_code)
VALUES(
  'work-intake-route',
  'Асуудал, хэрэгцээний багийн чиглүүлэлт',
  'operations',
  'organization_work_intake_routes',
  'Байгууллагаас баталсан incident domain-ыг Work Type, хариуцах нэгж болон тусдаа workflow route-д санал болгох tenant тохиргоо',
  'internal',
  'chief_engineer'
)
ON CONFLICT(code) DO NOTHING;

COMMENT ON COLUMN work_orders.operational_stream IS
  'Why the work exists: organization core service or internal operation. Safety and technical workflow are separate dimensions.';
COMMENT ON COLUMN work_orders.assignment_kind IS
  'Normal, special assignment, or emergency context; not a workflow or safety decision.';
COMMENT ON TABLE organization_work_intake_routes IS
  'Tenant-owned deterministic intake suggestion. It proposes a Work Type but never creates or assigns work by itself.';
