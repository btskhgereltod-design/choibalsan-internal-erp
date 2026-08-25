-- Optional, industry-neutral Occupational Health & Safety module.

INSERT INTO module_catalog(code,name,description,category,monthly_price,core,active)
VALUES ('safety','ХАБЭА','Эрсдэл, осол зөрчил, залруулах арга хэмжээ ба зааварчилгаа','Хүний нөөц',0,false,true)
ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,
 category=EXCLUDED.category,core=false,active=true;

-- Enable only the explicitly scoped pilot tenant. Every other current or future
-- tenant opts in through the module catalog.
INSERT INTO organization_modules(organization_id,module_code,enabled)
SELECT id,'safety',true FROM organizations WHERE slug='choibalsan-hugjil'
ON CONFLICT(organization_id,module_code) DO UPDATE SET enabled=true,enabled_at=now();

CREATE TABLE safety_risks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  reference_no TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL,
  existing_controls TEXT NOT NULL DEFAULT '',
  corrective_action TEXT NOT NULL DEFAULT '',
  likelihood SMALLINT NOT NULL CHECK(likelihood BETWEEN 1 AND 5),
  severity SMALLINT NOT NULL CHECK(severity BETWEEN 1 AND 5),
  risk_score SMALLINT GENERATED ALWAYS AS (likelihood * severity) STORED,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','in_progress','controlled','closed')),
  reported_by UUID NOT NULL,
  responsible_user_id UUID,
  due_date DATE,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,reference_no),
  FOREIGN KEY(organization_id,reported_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,responsible_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX safety_risks_org_status_idx ON safety_risks(organization_id,status,risk_score DESC);

CREATE TABLE safety_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  reference_no TEXT NOT NULL,
  incident_type TEXT NOT NULL CHECK(incident_type IN('unsafe_condition','near_miss','incident','injury','occupational_illness','property_damage','environmental')),
  severity TEXT NOT NULL CHECK(severity IN('low','medium','high','critical')),
  occurred_at TIMESTAMPTZ NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL,
  immediate_action TEXT NOT NULL DEFAULT '',
  root_cause TEXT NOT NULL DEFAULT '',
  corrective_action TEXT NOT NULL DEFAULT '',
  injured_count INTEGER NOT NULL DEFAULT 0 CHECK(injured_count BETWEEN 0 AND 10000),
  lost_time BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'reported' CHECK(status IN('reported','investigating','corrective_action','closed')),
  reported_by UUID NOT NULL,
  assigned_to UUID,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,reference_no),
  FOREIGN KEY(organization_id,reported_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,assigned_to) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX safety_incidents_org_status_idx ON safety_incidents(organization_id,status,occurred_at DESC);

CREATE TABLE safety_briefings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  briefing_type TEXT NOT NULL CHECK(briefing_type IN('induction','toolbox','refresher','emergency','other')),
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  conducted_at TIMESTAMPTZ NOT NULL,
  facilitator_user_id UUID,
  location TEXT NOT NULL DEFAULT '',
  attendee_count INTEGER NOT NULL DEFAULT 0 CHECK(attendee_count BETWEEN 0 AND 100000),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,facilitator_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX safety_briefings_org_date_idx ON safety_briefings(organization_id,conducted_at DESC);

INSERT INTO permission_catalog(code,name,module_code,description) VALUES
('safety.manage','ХАБЭА удирдах','safety','Эрсдэл, осол зөрчил, арга хэмжээ ба зааварчилгаа удирдах'),
('safety.investigate','Осол зөрчил шалгах','safety','Осол зөрчлийн шалтгаан, залруулах арга хэмжээг шинэчлэх')
ON CONFLICT(code) DO NOTHING;

INSERT INTO organization_roles(organization_id,code,name,system)
SELECT id,'safety-officer','ХАБЭА хариуцагч',true FROM organizations
ON CONFLICT(organization_id,code) DO NOTHING;

INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
SELECT r.organization_id,r.id,p.code
FROM organization_roles r CROSS JOIN permission_catalog p
WHERE (r.code IN('owner','administrator') AND p.code IN('safety.manage','safety.investigate'))
   OR (r.code='safety-officer' AND p.code IN('safety.manage','safety.investigate'))
ON CONFLICT DO NOTHING;

INSERT INTO user_roles(organization_id,user_id,role_id)
SELECT u.organization_id,u.id,r.id
FROM users u JOIN organization_roles r ON r.organization_id=u.organization_id AND r.code='safety-officer'
WHERE u.role='safety'
ON CONFLICT DO NOTHING;
