-- OVERVA universal module catalog and permission foundation.
-- Existing tenants keep every currently available feature enabled; new tenants
-- start with core modules and can opt into the rest.

UPDATE module_catalog
   SET name='OVERVA Core',
       description='Байгууллага, хэрэглэгч, хяналтын самбар, мэдэгдэл, аудит ба тохиргоо',
       category='Үндсэн', core=true, active=true
 WHERE code='core-work';

UPDATE module_catalog SET core=false WHERE code='attendance';
UPDATE module_catalog SET active=false WHERE code='connected-ops';

-- Generic Mongolia-wide map defaults for future tenants. Existing tenant
-- coordinates remain untouched.
ALTER TABLE organization_settings ALTER COLUMN map_center_lat SET DEFAULT 46.862500;
ALTER TABLE organization_settings ALTER COLUMN map_center_lng SET DEFAULT 103.846700;
ALTER TABLE organization_settings ALTER COLUMN map_default_zoom SET DEFAULT 5;

INSERT INTO module_catalog(code,name,description,category,monthly_price,core,active) VALUES
('structure','Байгууллагын бүтэц','Хэлтэс, албан тушаал, удирдлагын шатлал','Үндсэн',0,true,true),
('assets','Хөрөнгийн удирдлага','Хөрөнгө, тоног төхөөрөмж, хариуцагч ба ашиглалтын бүртгэл','Үйл ажиллагаа',0,false,true),
('work-orders','Ажлын удирдлага','Ажлын захиалга, хуваарилалт, гүйцэтгэл ба түүх','Үйл ажиллагаа',0,false,true),
('inventory','Агуулах ба нөөц','Агуулах, бараа материал, үлдэгдэл ба хөдөлгөөн','Нөөц',0,false,true),
('procurement','Худалдан авалт','Хүсэлт, зөвшөөрөл, захиалга ба хүлээн авалт','Нөөц',0,false,true),
('maintenance','Засвар үйлчилгээ','Урьдчилан сэргийлэх засвар ба гүйцэтгэлийн түүх','Үйл ажиллагаа',0,false,true),
('map','OVERVA Map','Газрын зураг, байршил ба давхаргын удирдлага','Connected Operations',0,false,true),
('fleet','Fleet / GPS','Тээврийн хэрэгсэл, GPS, маршрут ба гео бүс','Connected Operations',0,false,true),
('iot','IoT / Devices','Төхөөрөмж, телеметри ба алсын команд','Connected Operations',0,false,true),
('executive','Удирдлагын тойм','Идэвхжүүлсэн модулиудын нэгтгэсэн үзүүлэлт','Удирдлага',0,false,true),
('integration-lab','Integration Lab','Гадаад системийн өгөгдөл тааруулах ба турших орчин','Интеграц',0,false,true),
('field','Талбарын апп','Гар утас болон талбарын ажилтны хялбаршуулсан орчин','Үйл ажиллагаа',0,false,true)
ON CONFLICT(code) DO UPDATE SET
 name=EXCLUDED.name,description=EXCLUDED.description,category=EXCLUDED.category,
 monthly_price=EXCLUDED.monthly_price,core=EXCLUDED.core,active=EXCLUDED.active;

-- Preserve every existing tenant's current experience during the migration.
INSERT INTO organization_modules(organization_id,module_code,enabled)
SELECT o.id,m.code,true FROM organizations o CROSS JOIN module_catalog m WHERE m.active
ON CONFLICT(organization_id,module_code) DO UPDATE SET enabled=true,enabled_at=now();

CREATE TABLE permission_catalog (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  module_code TEXT REFERENCES module_catalog(code) ON DELETE RESTRICT,
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE organization_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  system BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,code)
);

CREATE TABLE organization_role_permissions (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  role_id UUID NOT NULL,
  permission_code TEXT NOT NULL REFERENCES permission_catalog(code) ON DELETE CASCADE,
  PRIMARY KEY(organization_id,role_id,permission_code),
  FOREIGN KEY(organization_id,role_id) REFERENCES organization_roles(organization_id,id) ON DELETE CASCADE
);

CREATE TABLE user_roles (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL,
  role_id UUID NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,user_id,role_id),
  FOREIGN KEY(organization_id,user_id) REFERENCES users(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY(organization_id,role_id) REFERENCES organization_roles(organization_id,id) ON DELETE CASCADE
);

INSERT INTO permission_catalog(code,name,module_code,description) VALUES
('organization.manage','Байгууллагын тохиргоо','core-work','Байгууллагын мэдээлэл ба тохиргоог удирдах'),
('users.manage','Хэрэглэгч удирдах','core-work','Хэрэглэгч болон эрхийн тохиргоо удирдах'),
('audit.read','Аудит харах','core-work','Аудит журналыг харах'),
('structure.manage','Бүтэц удирдах','structure','Хэлтэс, албан тушаал, шатлал удирдах'),
('assets.read','Хөрөнгө харах','assets','Хөрөнгийн бүртгэл харах'),
('assets.manage','Хөрөнгө удирдах','assets','Хөрөнгө үүсгэх болон засах'),
('work-orders.read','Ажил харах','work-orders','Ажлын захиалга харах'),
('work-orders.manage','Ажил удирдах','work-orders','Ажил үүсгэх, хуваарилах, төлөв өөрчлөх'),
('attendance.manage','Ирц удирдах','attendance','Ирцийн мэдээлэл засах'),
('inventory.manage','Агуулах удирдах','inventory','Нөөц болон хөдөлгөөн удирдах'),
('procurement.approve','Худалдан авалт батлах','procurement','Худалдан авалтын шийдвэр гаргах'),
('finance.manage','Санхүү удирдах','finance','Санхүүгийн өгөгдөл ба импорт удирдах'),
('modules.manage','Модуль удирдах','developer','Байгууллагын нэмэлт модулийг идэвхжүүлэх')
ON CONFLICT(code) DO NOTHING;

INSERT INTO organization_roles(organization_id,code,name,system)
SELECT o.id,r.code,r.name,true
FROM organizations o CROSS JOIN (VALUES
 ('owner','Эзэмшигч'),('administrator','Администратор'),('manager','Менежер'),('member','Ажилтан')
) AS r(code,name)
ON CONFLICT(organization_id,code) DO NOTHING;

INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
SELECT r.organization_id,r.id,p.code
FROM organization_roles r CROSS JOIN permission_catalog p
WHERE r.code IN ('owner','administrator')
ON CONFLICT DO NOTHING;

INSERT INTO user_roles(organization_id,user_id,role_id)
SELECT u.organization_id,u.id,r.id
FROM users u JOIN organization_roles r ON r.organization_id=u.organization_id
 AND r.code=CASE
   WHEN u.role='director' THEN 'owner'
   WHEN u.role IN ('chief_engineer','accountant','hr') THEN 'manager'
   ELSE 'member' END
ON CONFLICT DO NOTHING;
