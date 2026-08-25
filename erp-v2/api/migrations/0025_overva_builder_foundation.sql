-- OVERVA Builder composes approved catalog items. It never generates arbitrary
-- modules or mutates historical builds in place.

ALTER TABLE industry_templates
  ADD COLUMN maturity TEXT NOT NULL DEFAULT 'draft'
    CHECK(maturity IN ('draft','pilot','verified','deprecated')),
  ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE industry_templates SET maturity='verified' WHERE code='general';
UPDATE industry_templates SET maturity='pilot' WHERE code='municipal-infrastructure';

CREATE TABLE builder_questions (
  code TEXT PRIMARY KEY,
  section TEXT NOT NULL,
  prompt TEXT NOT NULL,
  help_text TEXT NOT NULL DEFAULT '',
  input_type TEXT NOT NULL CHECK(input_type IN ('single_choice','multi_choice','number','text','boolean')),
  options JSONB NOT NULL DEFAULT '[]'::jsonb,
  required BOOLEAN NOT NULL DEFAULT false,
  sequence INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE builder_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  rule_type TEXT NOT NULL CHECK(rule_type IN ('dependency','conflict','requires_approval','limit','recommendation')),
  subject_type TEXT NOT NULL CHECK(subject_type IN ('module','template','answer','build')),
  subject_code TEXT NOT NULL,
  condition JSONB NOT NULL DEFAULT '{}'::jsonb,
  effect JSONB NOT NULL DEFAULT '{}'::jsonb,
  message TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE builder_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','planned','applied','archived')),
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);

CREATE TABLE builder_builds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id UUID NOT NULL,
  version_no INTEGER NOT NULL CHECK(version_no > 0),
  based_on_build_id UUID,
  catalog_snapshot JSONB NOT NULL,
  configuration JSONB NOT NULL,
  validation JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','applied','rejected','superseded')),
  created_by UUID NOT NULL,
  applied_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at TIMESTAMPTZ,
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,project_id,version_no),
  FOREIGN KEY(organization_id,project_id) REFERENCES builder_projects(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,applied_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,based_on_build_id) REFERENCES builder_builds(organization_id,id) ON DELETE RESTRICT
);

CREATE TABLE builder_support_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id UUID,
  build_id UUID,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','reviewing','resolved','closed')),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,project_id) REFERENCES builder_projects(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,build_id) REFERENCES builder_builds(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);

CREATE INDEX builder_projects_org_status_idx ON builder_projects(organization_id,status,updated_at DESC);
CREATE INDEX builder_builds_org_project_idx ON builder_builds(organization_id,project_id,version_no DESC);
CREATE INDEX builder_support_org_status_idx ON builder_support_requests(organization_id,status,created_at DESC);

INSERT INTO builder_questions(code,section,prompt,help_text,input_type,options,required,sequence) VALUES
('organization_type','organization','Танай байгууллагын үндсэн чиглэл юу вэ?','Салбарын загвар болон эхний модулиудыг санал болгоход ашиглана.','single_choice','[{"value":"general","label":"Ерөнхий байгууллага"},{"value":"municipal-infrastructure","label":"Хотын дэд бүтэц, нийтийн үйлчилгээ"}]',true,10),
('employee_count','organization','Хэдэн ажилтантай вэ?','Хэрэглэгч, бүтэц болон нэвтрүүлэлтийн хэмжээг тооцно.','number','[]',true,20),
('manages_assets','operations','Хөрөнгө, тоног төхөөрөмж бүртгэдэг үү?','','boolean','[]',true,30),
('manages_inventory','operations','Агуулах, бараа материалын үлдэгдэл хөтөлдөг үү?','','boolean','[]',true,40),
('field_work','operations','Талбай дээр ажил гүйцэтгэдэг үү?','','boolean','[]',true,50),
('approval_workflow','governance','Хүсэлт, зардал эсвэл ажлыг шатлалтай баталдаг уу?','','boolean','[]',true,60),
('tracks_attendance','people','Ирц, чөлөөний бүртгэл хэрэгтэй юу?','','boolean','[]',true,70),
('manages_records','governance','Албан бичиг, архивын бүртгэл хэрэгтэй юу?','','boolean','[]',true,80)
ON CONFLICT(code) DO UPDATE SET section=EXCLUDED.section,prompt=EXCLUDED.prompt,
 help_text=EXCLUDED.help_text,input_type=EXCLUDED.input_type,options=EXCLUDED.options,
 required=EXCLUDED.required,sequence=EXCLUDED.sequence,active=true,updated_at=now();

INSERT INTO builder_rules(code,rule_type,subject_type,subject_code,effect,message,priority) VALUES
('maintenance-needs-assets','dependency','module','maintenance','{"requiresModules":["assets"]}','Засвар үйлчилгээ модуль хөрөнгийн бүртгэлтэй хамт ажиллана.',10),
('work-orders-recommends-assets','recommendation','module','work-orders','{"recommendsModules":["assets"]}','Ажлын удирдлагыг хөрөнгийн бүртгэлтэй холбовол ажлын түүх бүрэн хадгалагдана.',50),
('fleet-recommends-map','recommendation','module','fleet','{"recommendsModules":["map"]}','Fleet/GPS модулийг газрын зурагтай хамт ашиглахыг зөвлөж байна.',50),
('iot-platform-approval','requires_approval','module','iot','{"approval":"overva-platform"}','IoT төхөөрөмжийн холболт, аюулгүй ажиллагааг OVERVA баг баталгаажуулна.',5),
('integration-platform-approval','requires_approval','module','integration-lab','{"approval":"overva-platform"}','Гадаад системийн интеграцийг техникийн шалгалтын дараа идэвхжүүлнэ.',5),
('developer-platform-approval','requires_approval','module','developer','{"approval":"overva-platform"}','Open API болон webhook эрхийг техникийн шалгалтын дараа идэвхжүүлнэ.',5),
('automation-platform-approval','requires_approval','module','automation','{"approval":"overva-platform"}','Автомат үйлдлийн дүрмийг аюулгүй байдлын шалгалтын дараа идэвхжүүлнэ.',5),
('ai-platform-approval','requires_approval','module','ai-director','{"approval":"overva-platform"}','AI зөвлөмжийн модулийг өгөгдөл ба эрхийн тохиргоог шалгасны дараа идэвхжүүлнэ.',5)
ON CONFLICT(code) DO UPDATE SET rule_type=EXCLUDED.rule_type,subject_type=EXCLUDED.subject_type,
 subject_code=EXCLUDED.subject_code,effect=EXCLUDED.effect,message=EXCLUDED.message,
 priority=EXCLUDED.priority,active=true,updated_at=now();

INSERT INTO permission_catalog(code,name,module_code,description)
VALUES ('builder.manage','OVERVA Builder удирдах','structure','Байгууллагын загвар, модуль болон тохиргооны хувилбарыг төлөвлөж хэрэгжүүлэх')
ON CONFLICT(code) DO NOTHING;

INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
SELECT r.organization_id,r.id,'builder.manage' FROM organization_roles r
WHERE r.code IN('owner','administrator','industry-manager')
ON CONFLICT DO NOTHING;

-- Existing organizations start with an immutable baseline version, so Builder
-- onboarding is shown only to tenants created after this migration.
INSERT INTO builder_projects(organization_id,name,status,answers,created_by)
SELECT o.id,'Одоогийн тохиргоо','applied','{}'::jsonb,u.id
FROM organizations o
JOIN LATERAL (
  SELECT id FROM users WHERE organization_id=o.id AND active=true
  ORDER BY CASE WHEN role='director' THEN 0 ELSE 1 END,created_at LIMIT 1
) u ON true;

INSERT INTO builder_builds(
  organization_id,project_id,version_no,catalog_snapshot,configuration,validation,
  status,created_by,applied_by,created_at,applied_at
)
SELECT p.organization_id,p.id,1,
  jsonb_build_object('source','migration-0025','templatesVersion',1),
  jsonb_build_object(
    'profileCode',COALESCE((SELECT template_code FROM organization_industry_profiles
      WHERE organization_id=p.organization_id AND primary_profile=true LIMIT 1),'general'),
    'enabledModules',COALESCE((SELECT jsonb_agg(mc.code ORDER BY mc.code)
      FROM module_catalog mc LEFT JOIN organization_modules om
        ON om.organization_id=p.organization_id AND om.module_code=mc.code
      WHERE mc.active=true AND (mc.core=true OR om.enabled=true)),'[]'::jsonb),
    'answers','{}'::jsonb
  ),
  '{"valid":true,"warnings":[],"requiresApproval":[]}'::jsonb,
  'applied',p.created_by,p.created_by,p.created_at,p.created_at
FROM builder_projects p
WHERE p.name='Одоогийн тохиргоо';
