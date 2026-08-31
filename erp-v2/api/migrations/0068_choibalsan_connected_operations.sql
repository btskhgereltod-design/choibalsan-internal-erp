-- Reconcile pilot capabilities that were originally seeded before the pilot
-- tenant existed. This remains explicitly scoped to Choibalsan Hugjil.

INSERT INTO organization_modules(organization_id,module_code,enabled)
SELECT o.id,m.code,true
FROM organizations o
JOIN module_catalog m ON m.code IN('camera-operations','safety','field')
WHERE o.slug='choibalsan-hugjil'
ON CONFLICT(organization_id,module_code) DO UPDATE SET enabled=true,enabled_at=now();

INSERT INTO organization_work_types(organization_id,code,name,category,description,active)
SELECT o.id,v.code,v.name,v.category,v.description,true
FROM organizations o
CROSS JOIN (VALUES
  ('lighting-inspection','Гэрэлтүүлгийн үзлэг','lighting','Гэрэлтүүлгийн объектын үзлэг, хэмжилт.'),
  ('lighting-repair','Гэрэлтүүлгийн засвар','lighting','Гэрэлтүүлгийн гэмтэл засварлах ажил.'),
  ('traffic-signal-repair','Гэрлэн дохионы засвар','lighting','Гэрлэн дохионы засвар, үйлчилгээ.'),
  ('camera-inspection','Камерын үзлэг','camera','Камер, сүлжээ, тэжээлийн төлөв шалгах ажил.'),
  ('camera-repair','Камерын засвар','camera','Камерын төхөөрөмжийн гэмтэл оношлох, засварлах ажил.'),
  ('camera-maintenance','Камерын урьдчилан сэргийлэх үйлчилгээ','camera','Камерын системийн төлөвлөгөөт үзлэг, үйлчилгээ.'),
  ('camera-network-repair','Камерын сүлжээний засвар','camera','Дамжуулах сүлжээ, холбоос, тохиргооны засвар.')
) v(code,name,category,description)
WHERE o.slug='choibalsan-hugjil'
ON CONFLICT(organization_id,code) DO UPDATE SET
  name=EXCLUDED.name,category=EXCLUDED.category,description=EXCLUDED.description,active=true;

INSERT INTO organization_workflow_policies(organization_id,code,name,config,active)
SELECT id,'safety-managed-field-work','ХАБЭА хяналттай талбайн ажлын урсгал',
  '{"startSafetyRole":"safety","startSafetyPermission":"work-orders.workflow.safety","startApprovalRole":"chief_engineer","startApprovalPermission":"work-orders.workflow.approve","completionSafetyRole":"safety","completionSafetyPermission":"work-orders.workflow.safety","completionApprovalRole":"chief_engineer","completionApprovalPermission":"work-orders.workflow.approve"}'::jsonb,true
FROM organizations WHERE slug='choibalsan-hugjil'
ON CONFLICT(organization_id,code) DO UPDATE SET
  name=EXCLUDED.name,config=EXCLUDED.config,active=true,updated_at=now();

INSERT INTO organization_work_type_routes(organization_id,work_type_id,organization_unit_id,workflow_policy_id,active)
SELECT wt.organization_id,wt.id,d.id,p.id,true
FROM organization_work_types wt
JOIN organizations o ON o.id=wt.organization_id AND o.slug='choibalsan-hugjil'
JOIN organization_workflow_policies p ON p.organization_id=wt.organization_id AND p.code='safety-managed-field-work'
LEFT JOIN LATERAL (
  SELECT id FROM departments d
  WHERE d.organization_id=wt.organization_id AND (
    (wt.category='camera' AND lower(d.name) LIKE '%камер%') OR
    (wt.category='lighting' AND lower(d.name) LIKE '%цахилгаан%')
  ) ORDER BY d.active DESC,d.created_at LIMIT 1
) d ON true
WHERE wt.code IN('lighting-inspection','lighting-repair','traffic-signal-repair','camera-inspection','camera-repair','camera-maintenance','camera-network-repair')
ON CONFLICT(organization_id,work_type_id) DO UPDATE SET
  organization_unit_id=EXCLUDED.organization_unit_id,workflow_policy_id=EXCLUDED.workflow_policy_id,
  active=true,updated_at=now();

-- Users imported after the role migrations receive the same governed roles;
-- login remains disabled until an administrator explicitly provisions access.
INSERT INTO user_roles(organization_id,user_id,role_id)
SELECT u.organization_id,u.id,r.id
FROM users u
JOIN organizations o ON o.id=u.organization_id AND o.slug='choibalsan-hugjil'
JOIN organization_roles r ON r.organization_id=u.organization_id AND r.code=CASE
  WHEN u.role IN('director','chief_engineer') THEN 'work-order-manager'
  WHEN u.role='safety' THEN 'work-order-safety-reviewer'
  WHEN u.role IN('engineer','electric','camera_engineer') THEN 'work-order-coordinator'
END
WHERE u.active AND u.role IN('director','chief_engineer','safety','engineer','electric','camera_engineer')
ON CONFLICT DO NOTHING;

CREATE TABLE operational_domain_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  domain TEXT NOT NULL,
  snapshot_date DATE NOT NULL,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(metrics)='object'),
  source_system TEXT,
  source_table TEXT,
  source_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,source_system,source_table,source_id)
);
CREATE INDEX operational_domain_snapshots_org_domain_date_idx
  ON operational_domain_snapshots(organization_id,domain,snapshot_date DESC);

CREATE TABLE safety_route_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  route_date DATE NOT NULL,
  title TEXT NOT NULL,
  route_type TEXT NOT NULL DEFAULT '',
  start_point TEXT NOT NULL DEFAULT '',
  end_point TEXT NOT NULL DEFAULT '',
  vehicle TEXT NOT NULL DEFAULT '',
  driver TEXT NOT NULL DEFAULT '',
  workers TEXT NOT NULL DEFAULT '',
  risk_points TEXT NOT NULL DEFAULT '',
  control_note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN('planned','approved','completed','cancelled')),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX safety_route_plans_org_date_idx ON safety_route_plans(organization_id,route_date DESC);

CREATE TABLE safety_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  document_type TEXT NOT NULL CHECK(document_type IN('instruction','training')),
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  effective_date DATE NOT NULL,
  audience TEXT NOT NULL DEFAULT '',
  facilitator TEXT NOT NULL DEFAULT '',
  participant_count INTEGER NOT NULL DEFAULT 0 CHECK(participant_count>=0),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN('planned','active','completed','archived')),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX safety_documents_org_type_date_idx ON safety_documents(organization_id,document_type,effective_date DESC);

CREATE TABLE safety_acknowledgements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  safety_document_id UUID NOT NULL,
  user_id UUID NOT NULL,
  acknowledged_at TIMESTAMPTZ NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  source_system TEXT,
  source_table TEXT,
  source_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,safety_document_id,user_id),
  UNIQUE(organization_id,source_system,source_table,source_id),
  FOREIGN KEY(organization_id,safety_document_id) REFERENCES safety_documents(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX safety_acknowledgements_document_idx ON safety_acknowledgements(organization_id,safety_document_id,acknowledged_at DESC);

CREATE TRIGGER safety_acknowledgements_append_only
  BEFORE UPDATE OR DELETE ON safety_acknowledgements
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

INSERT INTO data_catalog_assets(code,name,domain,source_object,description,classification_code,owner_role_code) VALUES
('operational-domain-snapshot','Үйл ажиллагааны өдрийн агшин','operations','operational_domain_snapshots','Домэйн бүрийн эх сурвалжтай өдрийн хэмжүүрийн өөрчлөгдөхгүй агшин','internal','chief_engineer'),
('safety-route-plan','ХАБЭА маршрут','safety','safety_route_plans','Ажилтан, тээврийн хэрэгслийн маршрутын эрсдэл ба хяналтын төлөвлөгөө','restricted','safety'),
('safety-document','ХАБЭА сургалт, зааварчилгаа','safety','safety_documents','Зааварчилгаа, сургалт болон ажилтны танилцсан нотолгоо','restricted','safety')
ON CONFLICT(code) DO NOTHING;
