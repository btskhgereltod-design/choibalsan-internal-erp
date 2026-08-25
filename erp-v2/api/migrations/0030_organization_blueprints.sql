-- Guided organization blueprint foundation. Catalog entries are global and
-- versioned; tenant drafts and applied structures always remain tenant-owned.

CREATE TABLE organization_blueprint_catalog (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sectors TEXT[] NOT NULL DEFAULT ARRAY['all']::TEXT[],
  signals TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  min_employees INTEGER NOT NULL DEFAULT 0 CHECK(min_employees >= 0),
  departments JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommended_modules TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK(jsonb_typeof(departments)='array')
);

CREATE TABLE organization_blueprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN('draft','applied','superseded')),
  profile JSONB NOT NULL,
  proposal JSONB NOT NULL,
  catalog_version INTEGER NOT NULL DEFAULT 1,
  created_by UUID NOT NULL,
  applied_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at TIMESTAMPTZ,
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,applied_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX organization_blueprints_tenant_time_idx
  ON organization_blueprints(organization_id,created_at DESC);

ALTER TABLE departments ADD COLUMN source_blueprint_code TEXT;
ALTER TABLE positions ADD COLUMN source_blueprint_code TEXT;

INSERT INTO organization_blueprint_catalog(code,name,category,description,sectors,signals,min_employees,departments,recommended_modules) VALUES
('core-governance','Удирдлага ба засаглал','Суурь','Байгууллагын шийдвэр, бодлого, хариуцлагын үндсэн бүтэц.',ARRAY['all'],ARRAY[]::TEXT[],0,
 '[{"code":"GOV","name":"Удирдлага","positions":[{"code":"HEAD","title":"Байгууллагын удирдлага","rank":1},{"code":"ADMIN-MGR","title":"Захиргаа, үйл ажиллагааны менежер","rank":3}]}]',ARRAY['executive']),
('core-finance','Санхүү ба бүртгэл','Суурь','Орлого, зарлага, төсөв, тайлагналын хяналт.',ARRAY['all'],ARRAY['finance','accounting'],0,
 '[{"code":"FIN","name":"Санхүү, бүртгэл","positions":[{"code":"FIN-MGR","title":"Санхүүгийн менежер","rank":3},{"code":"ACCOUNTANT","title":"Нягтлан бодогч","rank":5}]}]',ARRAY['finance']),
('core-people','Хүний нөөц ба захиргаа','Суурь','Ажилтан, хөдөлмөрийн харилцаа, хүний нөөцийн суурь бүтэц.',ARRAY['all'],ARRAY['hr','attendance'],5,
 '[{"code":"PEOPLE","name":"Хүний нөөц, захиргаа","positions":[{"code":"HR-MGR","title":"Хүний нөөцийн менежер","rank":4},{"code":"HR-OFFICER","title":"Хүний нөөцийн ажилтан","rank":6}]}]',ARRAY['hr','attendance']),
('sales-service','Борлуулалт ба харилцагч','Бизнес','Борлуулалт, захиалга, харилцагчийн үйлчилгээ.',ARRAY['retail','services','manufacturing','transport','construction','other'],ARRAY['sales','customers','service'],0,
 '[{"code":"SALES","name":"Борлуулалт, харилцагчийн үйлчилгээ","positions":[{"code":"SALES-MGR","title":"Борлуулалтын менежер","rank":4},{"code":"SALES-OFFICER","title":"Борлуулалт, үйлчилгээний ажилтан","rank":7}]}]',ARRAY['crm']),
('inventory-procurement','Агуулах ба худалдан авалт','Бизнес','Нөөц, агуулах, ханган нийлүүлэлт, худалдан авалт.',ARRAY['all'],ARRAY['inventory','procurement','warehouse'],0,
 '[{"code":"SUPPLY","name":"Хангамж, агуулах","positions":[{"code":"PROC-OFFICER","title":"Худалдан авалтын ажилтан","rank":6},{"code":"STOREKEEPER","title":"Нярав, агуулахын ажилтан","rank":7}]}]',ARRAY['inventory','procurement']),
('operations-field','Үйл ажиллагаа ба талбайн ажил','Үйл ажиллагаа','Өдөр тутмын ажил, даалгавар, талбайн багийн зохион байгуулалт.',ARRAY['all'],ARRAY['operations','field','maintenance','delivery'],0,
 '[{"code":"OPS","name":"Үйл ажиллагаа","positions":[{"code":"OPS-MGR","title":"Үйл ажиллагааны менежер","rank":3},{"code":"SUPERVISOR","title":"Ахлах ажилтан, багийн ахлагч","rank":5},{"code":"OPERATOR","title":"Мэргэжилтэн, гүйцэтгэгч","rank":8}]}]',ARRAY['work-orders','field']),
('safety-quality','ХАБЭА ба чанар','Хяналт','Эрсдэл, аюулгүй ажиллагаа, чанар, нийцлийн хяналт.',ARRAY['mining','construction','manufacturing','transport','agriculture','public-service'],ARRAY['safety','quality','compliance'],0,
 '[{"code":"HSEQ","name":"ХАБЭА, чанар","positions":[{"code":"HSEQ-MGR","title":"ХАБЭА, чанарын менежер","rank":4},{"code":"SAFETY-OFFICER","title":"ХАБЭА-н ажилтан","rank":6}]}]',ARRAY['safety']),
('technology','Мэдээллийн технологи','Дэмжлэг','Систем, мэдээллийн аюулгүй байдал, төхөөрөмжийн дэмжлэг.',ARRAY['all'],ARRAY['it','devices','digital'],20,
 '[{"code":"IT","name":"Мэдээллийн технологи","positions":[{"code":"IT-MGR","title":"Мэдээллийн технологийн менежер","rank":4},{"code":"IT-SPECIALIST","title":"Систем, сүлжээний мэргэжилтэн","rank":7}]}]',ARRAY[]::TEXT[]),
('healthcare-core','Эмнэлгийн тусламж үйлчилгээ','Салбар','Эмнэлгийн тусламж, сувилахуй, бүртгэл, чанарын бүтэц.',ARRAY['healthcare'],ARRAY[]::TEXT[],0,
 '[{"code":"CLINICAL","name":"Эмнэлгийн тусламж үйлчилгээ","positions":[{"code":"MEDICAL-DIRECTOR","title":"Эмчилгээ эрхэлсэн удирдлага","rank":2},{"code":"DOCTOR","title":"Их эмч","rank":6},{"code":"NURSE","title":"Сувилагч","rank":7}]},{"code":"PATIENT-SVC","name":"Үйлчлүүлэгчийн бүртгэл, үйлчилгээ","positions":[{"code":"REGISTRAR","title":"Бүртгэл, мэдээллийн ажилтан","rank":7}]}]',ARRAY['records','inventory']),
('education-core','Сургалт, боловсрол','Салбар','Сургалтын удирдлага, багш, суралцагчийн үйлчилгээ.',ARRAY['education'],ARRAY[]::TEXT[],0,
 '[{"code":"ACADEMIC","name":"Сургалт, хөтөлбөр","positions":[{"code":"ACADEMIC-HEAD","title":"Сургалтын менежер","rank":3},{"code":"TEACHER","title":"Багш, сургагч","rank":7}]},{"code":"STUDENT-SVC","name":"Суралцагчийн үйлчилгээ","positions":[{"code":"STUDENT-OFFICER","title":"Сургалтын албаны ажилтан","rank":7}]}]',ARRAY['records']),
('construction-core','Төсөл ба барилга угсралт','Салбар','Төслийн удирдлага, инженерчлэл, талбайн гүйцэтгэл.',ARRAY['construction','road'],ARRAY[]::TEXT[],0,
 '[{"code":"PROJECT","name":"Төсөл, инженерчлэл","positions":[{"code":"PROJECT-MGR","title":"Төслийн менежер","rank":3},{"code":"ENGINEER","title":"Инженер","rank":6},{"code":"SITE-SUPERVISOR","title":"Талбайн инженер, даамал","rank":6}]}]',ARRAY['work-orders','assets','procurement','field']),
('mining-core','Уурхайн үйл ажиллагаа','Салбар','Олборлолт, техникийн ашиглалт, засварын зохион байгуулалт.',ARRAY['mining'],ARRAY[]::TEXT[],0,
 '[{"code":"MINE-OPS","name":"Уурхайн үйл ажиллагаа","positions":[{"code":"MINE-MGR","title":"Уурхайн менежер","rank":2},{"code":"SHIFT-SUPERVISOR","title":"Ээлжийн мастер","rank":5},{"code":"MINE-OPERATOR","title":"Тоног төхөөрөмжийн оператор","rank":8}]},{"code":"MINE-MAINT","name":"Техник, засвар","positions":[{"code":"MAINT-ENGINEER","title":"Засварын инженер","rank":5},{"code":"MECHANIC","title":"Механик, засварчин","rank":8}]}]',ARRAY['assets','maintenance','inventory','safety','fleet']),
('transport-core','Тээвэр ба хүргэлт','Салбар','Тээврийн зохицуулалт, жолооч, маршрут, техникийн бэлэн байдал.',ARRAY['transport','delivery'],ARRAY[]::TEXT[],0,
 '[{"code":"TRANSPORT","name":"Тээвэр, хүргэлт","positions":[{"code":"DISPATCHER","title":"Тээврийн зохицуулагч","rank":5},{"code":"DRIVER","title":"Жолооч","rank":8},{"code":"FLEET-MECH","title":"Автын механик","rank":7}]}]',ARRAY['fleet','work-orders','maintenance']),
('retail-core','Дэлгүүр ба худалдаа','Салбар','Салбар дэлгүүр, касс, бараа материалын өдөр тутмын бүтэц.',ARRAY['retail'],ARRAY[]::TEXT[],0,
 '[{"code":"STORE","name":"Дэлгүүр, үйлчилгээ","positions":[{"code":"STORE-MGR","title":"Дэлгүүрийн эрхлэгч","rank":4},{"code":"CASHIER","title":"Касс, худалдааны ажилтан","rank":8},{"code":"MERCHANDISER","title":"Бараа хариуцсан ажилтан","rank":7}]}]',ARRAY['inventory','finance','crm']),
('manufacturing-core','Үйлдвэрлэл','Салбар','Үйлдвэрлэлийн төлөвлөлт, ээлж, тоног төхөөрөмж, чанар.',ARRAY['manufacturing','food-production'],ARRAY[]::TEXT[],0,
 '[{"code":"PRODUCTION","name":"Үйлдвэрлэл","positions":[{"code":"PROD-MGR","title":"Үйлдвэрлэлийн менежер","rank":3},{"code":"SHIFT-LEAD","title":"Ээлжийн ахлагч","rank":5},{"code":"PROD-OPERATOR","title":"Үйлдвэрлэлийн оператор","rank":8}]},{"code":"QUALITY","name":"Чанарын хяналт","positions":[{"code":"QC-OFFICER","title":"Чанарын хяналтын ажилтан","rank":6}]}]',ARRAY['inventory','assets','maintenance','safety']),
('agriculture-core','Хөдөө аж ахуй','Салбар','Ферм, мал аж ахуй, тариалан, техник, талбайн зохион байгуулалт.',ARRAY['agriculture'],ARRAY[]::TEXT[],0,
 '[{"code":"FARM-OPS","name":"Аж ахуйн үйл ажиллагаа","positions":[{"code":"FARM-MGR","title":"Аж ахуйн менежер","rank":3},{"code":"AGRI-SPECIALIST","title":"Хөдөө аж ахуйн мэргэжилтэн","rank":6},{"code":"FARM-WORKER","title":"Малчин, тариаланч, ажилтан","rank":8}]}]',ARRAY['assets','inventory','field']),
('public-service-core','Төр, нийтийн үйлчилгээ','Салбар','Бодлого хэрэгжүүлэх, иргэн/хэрэглэгчийн үйлчилгээ, бичиг хэрэг.',ARRAY['government','public-service','ngo'],ARRAY[]::TEXT[],0,
 '[{"code":"POLICY","name":"Бодлого, төлөвлөлт","positions":[{"code":"UNIT-HEAD","title":"Нэгжийн дарга","rank":3},{"code":"SPECIALIST","title":"Мэргэжилтэн","rank":7}]},{"code":"CITIZEN-SVC","name":"Иргэн, хэрэглэгчийн үйлчилгээ","positions":[{"code":"SERVICE-OFFICER","title":"Үйлчилгээний ажилтан","rank":8}]}]',ARRAY['records','archive','work-orders'])
ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,category=EXCLUDED.category,description=EXCLUDED.description,
 sectors=EXCLUDED.sectors,signals=EXCLUDED.signals,min_employees=EXCLUDED.min_employees,
 departments=EXCLUDED.departments,recommended_modules=EXCLUDED.recommended_modules,
 version=organization_blueprint_catalog.version+1,active=true,updated_at=now();

