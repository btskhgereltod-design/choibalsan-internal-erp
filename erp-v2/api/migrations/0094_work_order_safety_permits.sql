-- Reusable, tenant-scoped safety permits for governed Work Orders.
-- Organization-specific checklists are configuration data. The only pilot
-- templates seeded here are explicitly scoped to Choibalsan Hugjil.

-- Preserve every notification type accepted before this release while adding
-- the workflow queue and return notifications emitted by the Work Order API.
ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK(type IN(
  'work_assigned','review_requested','work_completed','automation_alert',
  'work_order_workflow','work_order_returned'
));

CREATE TABLE organization_work_safety_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  start_checklist JSONB NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(start_checklist)='array'),
  completion_checklist JSONB NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(completion_checklist)='array'),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,code,version)
);
CREATE INDEX organization_work_safety_templates_active_idx
  ON organization_work_safety_templates(organization_id,active,code,version DESC);

CREATE TABLE organization_work_safety_template_routes (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  work_type_id UUID NOT NULL,
  safety_template_id UUID NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,work_type_id),
  FOREIGN KEY(organization_id,work_type_id)
    REFERENCES organization_work_types(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,safety_template_id)
    REFERENCES organization_work_safety_templates(organization_id,id) ON DELETE RESTRICT
);

CREATE TABLE work_order_safety_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  work_order_id UUID NOT NULL,
  safety_template_id UUID NOT NULL,
  template_version INTEGER NOT NULL CHECK(template_version>0),
  review_type TEXT NOT NULL CHECK(review_type IN('start','completion')),
  decision TEXT NOT NULL CHECK(decision IN('approved','returned','revoked')),
  likelihood INTEGER CHECK(likelihood BETWEEN 1 AND 5),
  severity INTEGER CHECK(severity BETWEEN 1 AND 5),
  risk_score INTEGER GENERATED ALWAYS AS (likelihood*severity) STORED,
  hazards JSONB NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(hazards)='array'),
  controls JSONB NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(controls)='array'),
  ppe JSONB NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(ppe)='array'),
  checklist JSONB NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(checklist)='array'),
  note TEXT NOT NULL,
  valid_until TIMESTAMPTZ,
  work_snapshot JSONB NOT NULL CHECK(jsonb_typeof(work_snapshot)='object'),
  actor_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,work_order_id)
    REFERENCES work_orders(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,safety_template_id)
    REFERENCES organization_work_safety_templates(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,actor_user_id)
    REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  CHECK((likelihood IS NULL)=(severity IS NULL)),
  CHECK(review_type='start' OR valid_until IS NULL),
  CHECK(decision<>'approved' OR review_type<>'start' OR valid_until>created_at)
);
CREATE INDEX work_order_safety_reviews_timeline_idx
  ON work_order_safety_reviews(organization_id,work_order_id,review_type,created_at DESC,id);
CREATE TRIGGER work_order_safety_reviews_append_only
  BEFORE UPDATE OR DELETE ON work_order_safety_reviews
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

ALTER TABLE work_order_approvals
  ADD CONSTRAINT work_order_approvals_org_id_unique UNIQUE(organization_id,id),
  ADD COLUMN idempotency_key UUID,
  ADD COLUMN payload_sha256 CHAR(64),
  ADD COLUMN safety_review_id UUID,
  ADD CONSTRAINT work_order_approvals_idempotency_pair_check
    CHECK((idempotency_key IS NULL)=(payload_sha256 IS NULL)),
  ADD CONSTRAINT work_order_approvals_safety_review_tenant_fk
    FOREIGN KEY(organization_id,safety_review_id)
    REFERENCES work_order_safety_reviews(organization_id,id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX work_order_approvals_tenant_idempotency_idx
  ON work_order_approvals(organization_id,idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE POLICY organization_work_safety_templates_tenant_policy ON organization_work_safety_templates
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY organization_work_safety_template_routes_tenant_policy ON organization_work_safety_template_routes
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY work_order_safety_reviews_tenant_policy ON work_order_safety_reviews
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());
ALTER TABLE organization_work_safety_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_work_safety_template_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_safety_reviews ENABLE ROW LEVEL SECURITY;

INSERT INTO organization_work_safety_templates(
  organization_id,code,version,name,description,start_checklist,completion_checklist
)
SELECT tenant.id,v.code,1,v.name,v.description,v.start_checklist::jsonb,v.completion_checklist::jsonb
FROM (SELECT id FROM organizations WHERE slug='choibalsan-hugjil') tenant CROSS JOIN (VALUES
    ('choibalsan-lighting-field-work','Гэрэлтүүлгийн талбайн ажлын ХАБЭА шалгалт',
     'Чойбалсан Хөгжлийн гэрэлтүүлэг, гэрлэн дохионы ажлын туршилтын checklist.',
     '[{"code":"site-secured","label":"Ажлын талбайг тусгаарлаж, тэмдэг тэмдэглэгээ байрлуулсан","required":true},{"code":"power-isolated","label":"Цахилгааны эх үүсвэрийг салгаж, хүчдэлгүйг шалгасан","required":true},{"code":"height-protection","label":"Өндөрт ажиллах хамгаалалт, шат эсвэл өргүүрийг шалгасан","required":true},{"code":"traffic-control","label":"Замын хөдөлгөөнд нөлөөлөх бол хамгаалалтын зохицуулалт хийсэн","required":true},{"code":"ppe-ready","label":"PPE болон тусгаарлагч багаж хэрэгсэл бүрэн","required":true},{"code":"toolbox-briefing","label":"Бригад ажлын өмнөх зааварчилгаатай танилцсан","required":true}]',
     '[{"code":"power-safe","label":"Тэжээл, газардуулга болон холболтыг аюулгүй сэргээсэн","required":true},{"code":"site-restored","label":"Талбайн хаалт, хог хаягдлыг цэвэрлэж хэвийн болгосон","required":true},{"code":"quality-checked","label":"Гэрэлтүүлэг эсвэл дохионы ажиллагааг туршсан","required":true},{"code":"evidence-complete","label":"Гүйцэтгэл болон өмнөх/дараах нотлох зураг бүрэн","required":true}]'),
    ('choibalsan-camera-field-work','Камерын талбайн ажлын ХАБЭА шалгалт',
     'Чойбалсан Хөгжлийн камер, сүлжээний талбайн ажлын туршилтын checklist.',
     '[{"code":"site-secured","label":"Ажлын талбайг тусгаарлаж, орчны хөдөлгөөнийг хамгаалсан","required":true},{"code":"power-poe-isolated","label":"220V/PoE тэжээл болон төхөөрөмжийг аюулгүй тусгаарласан","required":true},{"code":"height-protection","label":"Шат, өргүүр, өндөрт ажиллах хамгаалалтыг шалгасан","required":true},{"code":"cabinet-network-safe","label":"Шкаф, кабель, шилэн кабель болон сүлжээний орчин аюулгүй","required":true},{"code":"ppe-ready","label":"PPE болон шаардлагатай багаж хэрэгсэл бүрэн","required":true},{"code":"toolbox-briefing","label":"Гүйцэтгэгчид ажлын өмнөх зааварчилгаа өгсөн","required":true}]',
     '[{"code":"power-network-safe","label":"Тэжээл, PoE, сүлжээний холболтыг аюулгүй сэргээсэн","required":true},{"code":"camera-tested","label":"Камерын дүрс, бичлэг, сүлжээний ажиллагааг туршсан","required":true},{"code":"site-restored","label":"Кабель, шкаф, талбайг аюулгүй хэвийн байдалд оруулсан","required":true},{"code":"evidence-complete","label":"Гүйцэтгэл болон өмнөх/дараах нотлох зураг бүрэн","required":true}]')
  ) AS v(code,name,description,start_checklist,completion_checklist)
ON CONFLICT(organization_id,code,version) DO UPDATE SET
  name=EXCLUDED.name,description=EXCLUDED.description,
  start_checklist=EXCLUDED.start_checklist,completion_checklist=EXCLUDED.completion_checklist,
  active=true,updated_at=now();

INSERT INTO organization_work_safety_template_routes(organization_id,work_type_id,safety_template_id,active)
SELECT wt.organization_id,wt.id,t.id,true
FROM organization_work_types wt
JOIN organizations o ON o.id=wt.organization_id AND o.slug='choibalsan-hugjil'
JOIN organization_work_safety_templates t ON t.organization_id=wt.organization_id AND t.version=1
  AND t.code=CASE WHEN wt.category='camera' THEN 'choibalsan-camera-field-work' ELSE 'choibalsan-lighting-field-work' END
WHERE wt.code IN('lighting-inspection','lighting-repair','traffic-signal-repair','camera-inspection','camera-repair','camera-maintenance','camera-network-repair')
ON CONFLICT(organization_id,work_type_id) DO UPDATE SET
  safety_template_id=EXCLUDED.safety_template_id,active=true,updated_at=now();

UPDATE organization_workflow_policies p
SET config=p.config || '{"startManagementRequired":false,"safetyReviewRequired":true}'::jsonb,
    updated_at=now()
FROM organizations o
WHERE p.organization_id=o.id AND o.slug='choibalsan-hugjil'
  AND p.code='safety-managed-field-work';

INSERT INTO data_catalog_assets(code,name,domain,source_object,description,classification_code,owner_role_code) VALUES
('work-order-safety-template','Ажлын ХАБЭА шалгалтын загвар','safety','organization_work_safety_templates','Байгууллага тус бүрийн хувилбарт checklist configuration','internal','safety'),
('work-order-safety-review','Ажлын ХАБЭА зөвшөөрөл, шалгалт','safety','work_order_safety_reviews','Work Order-той холбоотой өөрчлөх боломжгүй эхлэл ба дуусгалтын ХАБЭА нотолгоо','restricted','safety')
ON CONFLICT(code) DO NOTHING;

COMMENT ON TABLE organization_work_safety_templates IS 'Tenant-owned, versioned Work Order safety checklist configuration; no template is universal.';
COMMENT ON TABLE work_order_safety_reviews IS 'Append-only start permit and completion inspection evidence for one canonical Work Order.';
