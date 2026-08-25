-- Industry profiles configure OVERVA without coupling the core product to one
-- organization, profession or sector.

CREATE TABLE industry_templates (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE industry_template_modules (
  template_code TEXT NOT NULL REFERENCES industry_templates(code) ON DELETE CASCADE,
  module_code TEXT NOT NULL REFERENCES module_catalog(code) ON DELETE RESTRICT,
  recommended BOOLEAN NOT NULL DEFAULT true,
  enabled_by_default BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY(template_code,module_code)
);

CREATE TABLE organization_industry_profiles (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  template_code TEXT NOT NULL REFERENCES industry_templates(code) ON DELETE RESTRICT,
  primary_profile BOOLEAN NOT NULL DEFAULT false,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,template_code)
);
CREATE UNIQUE INDEX organization_primary_industry_uidx
  ON organization_industry_profiles(organization_id) WHERE primary_profile;

CREATE TABLE industry_template_asset_categories (
  template_code TEXT NOT NULL REFERENCES industry_templates(code) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(template_code,code)
);

CREATE TABLE organization_asset_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source_template_code TEXT REFERENCES industry_templates(code) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,code)
);

CREATE TABLE industry_template_work_types (
  template_code TEXT NOT NULL REFERENCES industry_templates(code) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(template_code,code)
);

CREATE TABLE organization_work_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source_template_code TEXT REFERENCES industry_templates(code) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,code)
);

CREATE TABLE organization_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  certification_required BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,code)
);

CREATE TABLE position_skill_requirements (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  position_id UUID NOT NULL,
  skill_id UUID NOT NULL,
  required_level SMALLINT NOT NULL DEFAULT 1 CHECK(required_level BETWEEN 1 AND 5),
  mandatory BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY(organization_id,position_id,skill_id),
  FOREIGN KEY(organization_id,position_id) REFERENCES positions(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY(organization_id,skill_id) REFERENCES organization_skills(organization_id,id) ON DELETE CASCADE
);

CREATE TABLE user_skills (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL,
  skill_id UUID NOT NULL,
  proficiency_level SMALLINT NOT NULL DEFAULT 1 CHECK(proficiency_level BETWEEN 1 AND 5),
  certificate_no TEXT NOT NULL DEFAULT '',
  issued_at DATE,
  expires_at DATE,
  verified_by UUID,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,user_id,skill_id),
  FOREIGN KEY(organization_id,user_id) REFERENCES users(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY(organization_id,skill_id) REFERENCES organization_skills(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY(organization_id,verified_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);

CREATE TABLE work_type_skill_requirements (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  work_type_id UUID NOT NULL,
  skill_id UUID NOT NULL,
  required_level SMALLINT NOT NULL DEFAULT 1 CHECK(required_level BETWEEN 1 AND 5),
  mandatory BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY(organization_id,work_type_id,skill_id),
  FOREIGN KEY(organization_id,work_type_id) REFERENCES organization_work_types(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY(organization_id,skill_id) REFERENCES organization_skills(organization_id,id) ON DELETE CASCADE
);

INSERT INTO permission_catalog(code,name,module_code,description)
VALUES ('industry.manage','Салбарын загвар удирдах','structure','Ажлын төрөл, хөрөнгийн ангилал, ур чадвар болон шаардлагыг тохируулах')
ON CONFLICT(code) DO NOTHING;

INSERT INTO organization_roles(organization_id,code,name,system)
SELECT id,'industry-manager','Салбарын тохиргоо хариуцагч',true FROM organizations
ON CONFLICT(organization_id,code) DO NOTHING;

INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
SELECT r.organization_id,r.id,'industry.manage' FROM organization_roles r
WHERE r.code IN('owner','administrator','industry-manager')
ON CONFLICT DO NOTHING;

INSERT INTO user_roles(organization_id,user_id,role_id)
SELECT u.organization_id,u.id,r.id FROM users u
JOIN organization_roles r ON r.organization_id=u.organization_id AND r.code='industry-manager'
WHERE u.role IN('chief_engineer','hr')
ON CONFLICT DO NOTHING;

INSERT INTO industry_templates(code,name,description) VALUES
('general','Ерөнхий байгууллага','Салбарын тусгай тохиргоогүй OVERVA Core загвар'),
('municipal-infrastructure','Хотын дэд бүтэц, нийтийн үйлчилгээ','Гэрэлтүүлэг, камер, гэрлэн дохио болон хотын инженерийн байгууламжийн ашиглалт, засвар үйлчилгээ')
ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,active=true;

INSERT INTO industry_template_modules(template_code,module_code,recommended,enabled_by_default) VALUES
('municipal-infrastructure','assets',true,true),
('municipal-infrastructure','work-orders',true,true),
('municipal-infrastructure','maintenance',true,true),
('municipal-infrastructure','map',true,true),
('municipal-infrastructure','inventory',true,true),
('municipal-infrastructure','field',true,true),
('municipal-infrastructure','safety',true,true),
('municipal-infrastructure','fleet',true,false),
('municipal-infrastructure','iot',true,false)
ON CONFLICT DO NOTHING;

INSERT INTO industry_template_asset_categories(template_code,code,name,description) VALUES
('municipal-infrastructure','street-lighting','Гудамжны гэрэлтүүлэг','Шон, гэрэлтүүлэгч, тэжээлийн самбар, кабель болон удирдлага'),
('municipal-infrastructure','surveillance','Хяналтын камер','Камер, бичигч, сүлжээ болон дамжуулах төхөөрөмж'),
('municipal-infrastructure','traffic-signal','Гэрлэн дохио','Дохионы толгой, удирдлагын шкаф, кабель болон уулзварын төхөөрөмж')
ON CONFLICT DO NOTHING;

INSERT INTO industry_template_work_types(template_code,code,name,category,description) VALUES
('municipal-infrastructure','lighting-inspection','Гэрэлтүүлгийн үзлэг','Гудамжны гэрэлтүүлэг','Гэрэлтүүлгийн цэг, шугам болон самбарын үзлэг'),
('municipal-infrastructure','lighting-repair','Гэрэлтүүлгийн засвар','Гудамжны гэрэлтүүлэг','Гэмтэл оношлох, засварлах, турших'),
('municipal-infrastructure','camera-repair','Камерын засвар','Хяналтын камер','Камер, сүлжээ, тэжээл болон бичлэгийн гэмтэл засах'),
('municipal-infrastructure','traffic-signal-repair','Гэрлэн дохионы засвар','Гэрлэн дохио','Удирдлага, дохионы толгой, тэжээл болон холбооны гэмтэл засах')
ON CONFLICT DO NOTHING;

INSERT INTO organization_industry_profiles(organization_id,template_code,primary_profile)
SELECT id,'municipal-infrastructure',true FROM organizations WHERE slug='choibalsan-hugjil'
ON CONFLICT(organization_id,template_code) DO UPDATE SET primary_profile=true;

INSERT INTO organization_asset_categories(organization_id,code,name,description,source_template_code)
SELECT o.id,c.code,c.name,c.description,c.template_code
FROM organizations o CROSS JOIN industry_template_asset_categories c
WHERE o.slug='choibalsan-hugjil' AND c.template_code='municipal-infrastructure'
ON CONFLICT(organization_id,code) DO NOTHING;

INSERT INTO organization_work_types(organization_id,code,name,category,description,source_template_code)
SELECT o.id,w.code,w.name,w.category,w.description,w.template_code
FROM organizations o CROSS JOIN industry_template_work_types w
WHERE o.slug='choibalsan-hugjil' AND w.template_code='municipal-infrastructure'
ON CONFLICT(organization_id,code) DO NOTHING;
