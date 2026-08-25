-- OVERVA data-management foundation.
-- Keeps the existing API-compatible table names while giving them explicit
-- organization-unit, job, position and effective-dated assignment semantics.

-- Repair the legacy 0026 version collision deterministically. A past release
-- used the same version for this terminology update and the AI schema.
UPDATE organization_roles
   SET name='Байгууллагын үндсэн админ'
 WHERE code='owner';
UPDATE organization_roles
   SET name='Байгууллагын админ'
 WHERE code='administrator';

CREATE TABLE reference_sets (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner_domain TEXT NOT NULL,
  value_type TEXT NOT NULL DEFAULT 'reference'
    CHECK (value_type IN ('reference','classification','status')),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reference_values (
  set_code TEXT NOT NULL REFERENCES reference_sets(code) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 100,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT true,
  valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_to DATE,
  PRIMARY KEY (set_code,code),
  CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

INSERT INTO reference_sets(code,name,description,owner_domain,value_type) VALUES
('organization_unit_type','Байгууллагын нэгжийн төрөл','Салбар, газар, хэлтэс, тасаг, баг болон талбайн нийтлэг ангилал','organization','classification'),
('assignment_type','Ажилтны томилгооны төрөл','Үндсэн, хавсран, түр орлон болон төслийн томилгоо','people','classification'),
('data_classification','Өгөгдлийн нууцлалын ангилал','Өгөгдлийн хандалт, хамгаалалт болон хадгалалтын ангилал','governance','classification')
ON CONFLICT(code) DO NOTHING;

INSERT INTO reference_values(set_code,code,name,sort_order) VALUES
('organization_unit_type','organization','Байгууллага',10),
('organization_unit_type','branch','Салбар',20),
('organization_unit_type','division','Газар / газар нэгж',30),
('organization_unit_type','department','Хэлтэс / алба',40),
('organization_unit_type','section','Тасаг',50),
('organization_unit_type','team','Баг',60),
('organization_unit_type','site','Талбай / байршил',70),
('organization_unit_type','store','Дэлгүүр / үйлчилгээний цэг',80),
('organization_unit_type','project','Төсөл / хөтөлбөр',90),
('organization_unit_type','facility','Үйлдвэр / уурхай / байгууламж',100),
('assignment_type','primary','Үндсэн томилгоо',10),
('assignment_type','additional','Хавсран ажиллах',20),
('assignment_type','acting','Түр орлон гүйцэтгэх',30),
('assignment_type','project','Төслийн томилгоо',40),
('data_classification','public','Нийтийн',10),
('data_classification','internal','Дотоод',20),
('data_classification','confidential','Нууц',30),
('data_classification','restricted','Онцгой хамгаалалттай',40)
ON CONFLICT(set_code,code) DO NOTHING;

ALTER TABLE departments
  ADD COLUMN unit_type_set_code TEXT NOT NULL DEFAULT 'organization_unit_type'
    CHECK(unit_type_set_code='organization_unit_type'),
  ADD COLUMN unit_type_code TEXT NOT NULL DEFAULT 'department',
  ADD COLUMN description TEXT NOT NULL DEFAULT '',
  ADD COLUMN valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN valid_to DATE,
  ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT departments_unit_type_fk
    FOREIGN KEY(unit_type_set_code,unit_type_code) REFERENCES reference_values(set_code,code) ON DELETE RESTRICT,
  ADD CONSTRAINT departments_valid_period_check
    CHECK(valid_to IS NULL OR valid_to >= valid_from);

COMMENT ON TABLE departments IS
  'Canonical tenant organization-unit master. The legacy table name is preserved for API compatibility.';
COMMENT ON COLUMN departments.unit_type_code IS
  'General unit type such as branch, division, department, team, site, store, project or facility.';

CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  job_family TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT true,
  valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_to DATE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,code),
  CHECK(valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX jobs_tenant_active_idx ON jobs(organization_id,active,name);

INSERT INTO jobs(organization_id,code,name)
SELECT organization_id,code,title FROM positions
ON CONFLICT(organization_id,code) DO NOTHING;

ALTER TABLE positions
  ADD COLUMN job_id UUID,
  ADD COLUMN headcount_limit INTEGER,
  ADD COLUMN valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN valid_to DATE,
  ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT positions_headcount_check
    CHECK(headcount_limit IS NULL OR headcount_limit > 0),
  ADD CONSTRAINT positions_valid_period_check
    CHECK(valid_to IS NULL OR valid_to >= valid_from),
  ADD CONSTRAINT positions_job_tenant_fk
    FOREIGN KEY(organization_id,job_id) REFERENCES jobs(organization_id,id) ON DELETE RESTRICT;

UPDATE positions p
   SET job_id=j.id
  FROM jobs j
 WHERE j.organization_id=p.organization_id AND j.code=p.code;
ALTER TABLE positions ALTER COLUMN job_id SET NOT NULL;

COMMENT ON TABLE jobs IS 'Reusable tenant job/profession catalog independent from approved headcount positions.';
COMMENT ON TABLE positions IS 'Approved organization position/headcount slot linked to a reusable job definition.';

CREATE TABLE employee_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  employee_id UUID NOT NULL,
  organization_unit_id UUID,
  position_id UUID,
  manager_employee_id UUID,
  assignment_type_set_code TEXT NOT NULL DEFAULT 'assignment_type'
    CHECK(assignment_type_set_code='assignment_type'),
  assignment_type_code TEXT NOT NULL DEFAULT 'primary',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('planned','active','ended','cancelled')),
  fte NUMERIC(5,4) NOT NULL DEFAULT 1 CHECK(fte > 0 AND fte <= 1),
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK(source IN ('manual','blueprint','import','system')),
  note TEXT NOT NULL DEFAULT '',
  created_by UUID,
  ended_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,employee_id) REFERENCES employees(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,organization_unit_id) REFERENCES departments(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,position_id) REFERENCES positions(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,manager_employee_id) REFERENCES employees(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,ended_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(assignment_type_set_code,assignment_type_code) REFERENCES reference_values(set_code,code) ON DELETE RESTRICT,
  CHECK(effective_to IS NULL OR effective_to >= effective_from),
  CHECK(manager_employee_id IS NULL OR manager_employee_id <> employee_id)
);
CREATE UNIQUE INDEX employee_assignments_one_active_primary_uidx
  ON employee_assignments(organization_id,employee_id)
  WHERE status='active' AND assignment_type_code='primary';
CREATE INDEX employee_assignments_unit_idx
  ON employee_assignments(organization_id,organization_unit_id,status);
CREATE INDEX employee_assignments_position_idx
  ON employee_assignments(organization_id,position_id,status);
CREATE INDEX employee_assignments_period_idx
  ON employee_assignments(organization_id,effective_from,effective_to);

INSERT INTO employee_assignments(
  organization_id,employee_id,organization_unit_id,position_id,manager_employee_id,
  assignment_type_code,status,effective_from,source
)
SELECT organization_id,id,department_id,position_id,manager_employee_id,
       'primary','active',created_at::date,'system'
  FROM employees
ON CONFLICT DO NOTHING;

COMMENT ON TABLE employee_assignments IS
  'Effective-dated employment placement; separates a person from organization unit, position and reporting line.';

ALTER TABLE departments
  ADD CONSTRAINT departments_source_blueprint_fk
  FOREIGN KEY(source_blueprint_code) REFERENCES organization_blueprint_catalog(code) ON DELETE SET NULL;
ALTER TABLE positions
  ADD CONSTRAINT positions_source_blueprint_fk
  FOREIGN KEY(source_blueprint_code) REFERENCES organization_blueprint_catalog(code) ON DELETE SET NULL;

CREATE TABLE data_catalog_assets (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  object_type TEXT NOT NULL DEFAULT 'table'
    CHECK(object_type IN ('table','view','api','event','file','report')),
  source_object TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  classification_set_code TEXT NOT NULL DEFAULT 'data_classification'
    CHECK(classification_set_code='data_classification'),
  classification_code TEXT NOT NULL DEFAULT 'internal',
  owner_role_code TEXT,
  contains_personal_data BOOLEAN NOT NULL DEFAULT false,
  retention_days INTEGER CHECK(retention_days IS NULL OR retention_days > 0),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(classification_set_code,classification_code) REFERENCES reference_values(set_code,code) ON DELETE RESTRICT
);

INSERT INTO data_catalog_assets(
  code,name,domain,source_object,description,classification_code,owner_role_code,contains_personal_data
) VALUES
('organization','Байгууллага','organization','organizations','Tenant болон байгууллагын үндсэн master data','internal','owner',false),
('organization-unit','Байгууллагын нэгж','organization','departments','Байгууллагын салбар, газар, хэлтэс, баг, талбайн master data','internal','owner',false),
('job','Ажил, мэргэжил','people','jobs','Дахин ашиглагдах ажил, мэргэжлийн master data','internal','owner',false),
('position','Орон тоо, албан тушаал','people','positions','Батлагдсан position болон headcount master data','internal','owner',false),
('employee','Ажилтан','people','employees','Ажилтны canonical master identity','confidential','hr-officer',true),
('employee-profile','Ажилтны хувийн хэрэг','people','employee_profiles','Хувийн болон хөдөлмөрийн дэлгэрэнгүй мэдээлэл','restricted','hr-officer',true),
('employee-assignment','Ажилтны томилгоо','people','employee_assignments','Хугацаатай томилгоо, харьяалал болон тайлагнах шугам','confidential','hr-officer',true),
('audit-log','Аудит журнал','governance','audit_logs','Хэрэглэгчийн өөрчлөх боломжгүй үйл ажиллагааны мөр','restricted','owner',true)
ON CONFLICT(code) DO NOTHING;

CREATE TABLE organization_data_stewards (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  domain TEXT NOT NULL,
  employee_id UUID NOT NULL,
  assigned_by UUID NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,domain),
  FOREIGN KEY(organization_id,employee_id) REFERENCES employees(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,assigned_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);

CREATE TABLE data_quality_rules (
  code TEXT PRIMARY KEY,
  asset_code TEXT NOT NULL REFERENCES data_catalog_assets(code) ON DELETE CASCADE,
  name TEXT NOT NULL,
  dimension TEXT NOT NULL
    CHECK(dimension IN ('completeness','uniqueness','validity','consistency','timeliness','integrity')),
  severity TEXT NOT NULL DEFAULT 'error' CHECK(severity IN ('info','warning','error','critical')),
  description TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO data_quality_rules(code,asset_code,name,dimension,severity,description) VALUES
('employee-number-unique','employee','Ажилтны дугаар давхардахгүй','uniqueness','error','Нэг байгууллагын employee_no давхардах ёсгүй.'),
('position-job-required','position','Position ажилтай холбогдсон','completeness','error','Position бүр reusable job master-тэй холбоотой байна.'),
('active-primary-assignment','employee-assignment','Нэг идэвхтэй үндсэн томилгоо','consistency','error','Ажилтан нэгэн зэрэг нэгээс олон active primary assignment-тай байж болохгүй.'),
('assignment-tenant-integrity','employee-assignment','Томилгооны tenant integrity','integrity','critical','Ажилтан, нэгж, position болон manager нэг organization-д харьяалагдана.')
ON CONFLICT(code) DO NOTHING;

-- Policies are created now but intentionally not enabled until every API request
-- uses a transaction-scoped app.organization_id context. Enabling RLS without
-- that rollout would interrupt the existing production application.
CREATE OR REPLACE FUNCTION overva_current_organization_id()
RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.organization_id',true),'')::uuid
$$;

CREATE POLICY employees_tenant_policy ON employees
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY employee_assignments_tenant_policy ON employee_assignments
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY departments_tenant_policy ON departments
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY jobs_tenant_policy ON jobs
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY positions_tenant_policy ON positions
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());
