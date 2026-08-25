-- Separate, optional HR, correspondence and archive modules.
-- The pilot tenant uses one officer for all three; other tenants can assign
-- the responsibilities independently.

INSERT INTO module_catalog(code,name,description,category,monthly_price,core,active) VALUES
('hr','Хүний нөөц','Ажилтны хувийн хэрэг, гэрээ, хөдөлгөөн ба хүний нөөцийн хяналт','Хүний нөөц',0,false,true),
('records','Бичиг хэрэг','Ирсэн, явсан болон дотоод албан бичгийн бүртгэл, шийдвэрлэлт','Захиргаа',0,false,true),
('archive','Архив','Баримтын хадгалалт, байршил, хадгалах хугацаа ба шилжилт хөдөлгөөн','Захиргаа',0,false,true)
ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,
 category=EXCLUDED.category,core=false,active=true;

INSERT INTO organization_modules(organization_id,module_code,enabled)
SELECT o.id,m.code,true FROM organizations o CROSS JOIN (VALUES('hr'),('records'),('archive')) m(code)
WHERE o.slug='choibalsan-hugjil'
ON CONFLICT(organization_id,module_code) DO UPDATE SET enabled=true,enabled_at=now();

ALTER TABLE employee_profiles ADD COLUMN employee_no TEXT;
ALTER TABLE employee_profiles ADD COLUMN family_status TEXT NOT NULL DEFAULT '';
ALTER TABLE employee_profiles ADD COLUMN contract_no TEXT NOT NULL DEFAULT '';
ALTER TABLE employee_profiles ADD COLUMN job_description TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX employee_profiles_org_employee_no_uidx
  ON employee_profiles(organization_id,employee_no) WHERE employee_no IS NOT NULL;

CREATE TABLE employee_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN('hired','contract_renewed','position_changed','department_changed','leave_started','leave_ended','suspended','terminated','note')),
  effective_date DATE NOT NULL,
  title TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,user_id) REFERENCES users(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX employee_events_org_user_date_idx ON employee_events(organization_id,user_id,effective_date DESC);

CREATE TABLE correspondence_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  registration_no TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN('incoming','outgoing','internal')),
  document_type TEXT NOT NULL DEFAULT 'official_letter',
  document_no TEXT NOT NULL DEFAULT '',
  document_date DATE NOT NULL,
  registered_at DATE NOT NULL DEFAULT CURRENT_DATE,
  counterparty TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN('low','normal','high','urgent')),
  due_date DATE,
  responsible_user_id UUID,
  status TEXT NOT NULL DEFAULT 'registered' CHECK(status IN('registered','assigned','in_progress','responded','closed','archived')),
  resolution TEXT NOT NULL DEFAULT '',
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,registration_no),
  FOREIGN KEY(organization_id,responsible_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX correspondence_org_status_due_idx ON correspondence_records(organization_id,status,due_date);

CREATE TABLE archive_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  archive_no TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  document_type TEXT NOT NULL DEFAULT '',
  document_no TEXT NOT NULL DEFAULT '',
  document_date DATE,
  archived_at DATE NOT NULL DEFAULT CURRENT_DATE,
  retention_years INTEGER CHECK(retention_years IS NULL OR retention_years BETWEEN 1 AND 100),
  permanent BOOLEAN NOT NULL DEFAULT false,
  location TEXT NOT NULL DEFAULT '',
  box_no TEXT NOT NULL DEFAULT '',
  shelf_no TEXT NOT NULL DEFAULT '',
  confidentiality TEXT NOT NULL DEFAULT 'internal' CHECK(confidentiality IN('public','internal','confidential','restricted')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN('active','transferred','due_for_disposal','disposed')),
  description TEXT NOT NULL DEFAULT '',
  source_correspondence_id UUID,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,archive_no),
  FOREIGN KEY(organization_id,source_correspondence_id) REFERENCES correspondence_records(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX archive_records_org_status_category_idx ON archive_records(organization_id,status,category);

INSERT INTO permission_catalog(code,name,module_code,description) VALUES
('hr.manage','Хүний нөөц удирдах','hr','Ажилтны хувийн хэрэг, гэрээ болон хөдөлгөөнийг удирдах'),
('records.manage','Бичиг хэрэг удирдах','records','Албан бичиг бүртгэх, хуваарилах болон шийдвэрлэлтийг хянах'),
('archive.manage','Архив удирдах','archive','Архивын баримт, байршил болон хадгалах хугацааг удирдах')
ON CONFLICT(code) DO NOTHING;

INSERT INTO organization_roles(organization_id,code,name,system)
SELECT o.id,r.code,r.name,true FROM organizations o CROSS JOIN (VALUES
 ('hr-officer','Хүний нөөцийн ажилтан'),
 ('records-officer','Бичиг хэргийн ажилтан'),
 ('archivist','Архивын ажилтан')
) r(code,name)
ON CONFLICT(organization_id,code) DO NOTHING;

INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
SELECT r.organization_id,r.id,p.code FROM organization_roles r CROSS JOIN permission_catalog p
WHERE (r.code IN('owner','administrator') AND p.code IN('hr.manage','records.manage','archive.manage'))
   OR (r.code='hr-officer' AND p.code='hr.manage')
   OR (r.code='records-officer' AND p.code='records.manage')
   OR (r.code='archivist' AND p.code='archive.manage')
ON CONFLICT DO NOTHING;

-- Pilot-specific combination: its current HR officer carries all three roles.
INSERT INTO user_roles(organization_id,user_id,role_id)
SELECT u.organization_id,u.id,r.id
FROM users u
JOIN organizations o ON o.id=u.organization_id AND o.slug='choibalsan-hugjil'
JOIN organization_roles r ON r.organization_id=u.organization_id
 AND r.code IN('hr-officer','records-officer','archivist')
WHERE u.role='hr'
ON CONFLICT DO NOTHING;
