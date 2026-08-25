-- Versioned HR lifecycle records linked to the canonical employee master.
-- Legacy employee_profiles columns remain available for API compatibility.

INSERT INTO reference_sets(code,name,description,owner_domain,value_type) VALUES
('employment_lifecycle_status','Employment lifecycle status','Controlled employee lifecycle states','people','status'),
('employment_contract_status','Employment contract status','Controlled contract-version states','people','status')
ON CONFLICT(code) DO NOTHING;

INSERT INTO reference_values(set_code,code,name,sort_order) VALUES
('employment_lifecycle_status','candidate','Candidate',10),
('employment_lifecycle_status','offered','Offer made',20),
('employment_lifecycle_status','onboarding','Onboarding',30),
('employment_lifecycle_status','active','Active',40),
('employment_lifecycle_status','on_leave','On leave',50),
('employment_lifecycle_status','suspended','Suspended',60),
('employment_lifecycle_status','terminated','Terminated',70),
('employment_lifecycle_status','retired','Retired',80),
('employment_contract_status','draft','Draft',10),
('employment_contract_status','active','Active',20),
('employment_contract_status','expired','Expired',30),
('employment_contract_status','terminated','Terminated',40),
('employment_contract_status','superseded','Superseded',50)
ON CONFLICT(set_code,code) DO NOTHING;

CREATE TABLE employment_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  employee_id UUID NOT NULL,
  contract_key UUID NOT NULL DEFAULT gen_random_uuid(),
  version_no INTEGER NOT NULL DEFAULT 1 CHECK(version_no > 0),
  contract_no TEXT NOT NULL,
  contract_type TEXT NOT NULL,
  status_set_code TEXT NOT NULL DEFAULT 'employment_contract_status'
    CHECK(status_set_code='employment_contract_status'),
  status TEXT NOT NULL DEFAULT 'draft',
  starts_on DATE NOT NULL,
  ends_on DATE,
  signed_on DATE,
  terms_summary TEXT NOT NULL DEFAULT '',
  document_id UUID,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,contract_key,version_no),
  FOREIGN KEY(organization_id,employee_id) REFERENCES employees(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,document_id) REFERENCES documents(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(status_set_code,status) REFERENCES reference_values(set_code,code) ON DELETE RESTRICT,
  CHECK(ends_on IS NULL OR ends_on >= starts_on)
);
CREATE INDEX employment_contracts_employee_idx ON employment_contracts(organization_id,employee_id,starts_on DESC,version_no DESC);
CREATE TRIGGER employment_contracts_append_only BEFORE UPDATE OR DELETE ON employment_contracts
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

CREATE TABLE employee_compensation_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  employee_id UUID NOT NULL,
  effective_from DATE NOT NULL,
  effective_to DATE,
  currency CHAR(3) NOT NULL DEFAULT 'MNT',
  base_salary NUMERIC(18,2) NOT NULL CHECK(base_salary >= 0),
  allowances JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason TEXT NOT NULL DEFAULT '',
  approved_by UUID,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,employee_id,effective_from),
  FOREIGN KEY(organization_id,employee_id) REFERENCES employees(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,approved_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  CHECK(effective_to IS NULL OR effective_to >= effective_from),
  CHECK(currency ~ '^[A-Z]{3}$')
);
CREATE INDEX employee_compensation_employee_idx ON employee_compensation_history(organization_id,employee_id,effective_from DESC);
CREATE TRIGGER employee_compensation_append_only BEFORE UPDATE OR DELETE ON employee_compensation_history
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

CREATE TABLE position_description_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  position_id UUID NOT NULL,
  version_no INTEGER NOT NULL,
  title TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT '',
  duties JSONB NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(duties)='array'),
  responsibilities JSONB NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(responsibilities)='array'),
  requirements JSONB NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(requirements)='array'),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN('draft','approved','retired')),
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  approved_by UUID,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,position_id,version_no),
  FOREIGN KEY(organization_id,position_id) REFERENCES positions(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,approved_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  CHECK((status='approved' AND approved_by IS NOT NULL) OR status<>'approved')
);
CREATE INDEX position_description_position_idx ON position_description_versions(organization_id,position_id,version_no DESC);
CREATE TRIGGER position_description_versions_append_only BEFORE UPDATE OR DELETE ON position_description_versions
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

CREATE TABLE employment_lifecycle_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  employee_id UUID NOT NULL,
  status_set_code TEXT NOT NULL DEFAULT 'employment_lifecycle_status'
    CHECK(status_set_code='employment_lifecycle_status'),
  status TEXT NOT NULL,
  effective_date DATE NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,employee_id) REFERENCES employees(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(status_set_code,status) REFERENCES reference_values(set_code,code) ON DELETE RESTRICT
);
CREATE INDEX employment_lifecycle_employee_idx ON employment_lifecycle_events(organization_id,employee_id,effective_date DESC,created_at DESC);
CREATE TRIGGER employment_lifecycle_events_append_only BEFORE UPDATE OR DELETE ON employment_lifecycle_events
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

-- Imported employees begin with one explicit lifecycle event.
INSERT INTO employment_lifecycle_events(organization_id,employee_id,status,effective_date,reason,created_by)
SELECT e.organization_id,e.id,CASE WHEN e.active THEN 'active' ELSE 'terminated' END,
       COALESCE(ep.hire_date,e.created_at::date),'Legacy HR baseline',u.id
  FROM employees e
  JOIN LATERAL (
    SELECT id FROM users WHERE organization_id=e.organization_id ORDER BY (employee_id=e.id) DESC,created_at LIMIT 1
  ) u ON true
  LEFT JOIN employee_profiles ep ON ep.organization_id=e.organization_id AND ep.employee_id=e.id
 WHERE NOT EXISTS (
   SELECT 1 FROM employment_lifecycle_events x WHERE x.organization_id=e.organization_id AND x.employee_id=e.id
 );

-- Preserve existing contract and salary values as version 1 history.
INSERT INTO employment_contracts(organization_id,employee_id,contract_no,contract_type,status,starts_on,ends_on,terms_summary,created_by)
SELECT ep.organization_id,ep.employee_id,ep.contract_no,COALESCE(NULLIF(ep.contract_type,''),'unspecified'),
       CASE WHEN ep.contract_end IS NOT NULL AND ep.contract_end<CURRENT_DATE THEN 'expired' ELSE 'active' END,
       COALESCE(ep.contract_date,ep.hire_date,CURRENT_DATE),ep.contract_end,COALESCE(ep.contract_notes,''),u.id
  FROM employee_profiles ep
  JOIN LATERAL (SELECT id FROM users WHERE organization_id=ep.organization_id ORDER BY (employee_id=ep.employee_id) DESC,created_at LIMIT 1) u ON true
 WHERE NULLIF(ep.contract_no,'') IS NOT NULL;

INSERT INTO employee_compensation_history(organization_id,employee_id,effective_from,base_salary,reason,created_by)
SELECT ep.organization_id,ep.employee_id,COALESCE(ep.hire_date,CURRENT_DATE),ep.salary,'Legacy HR baseline',u.id
  FROM employee_profiles ep
  JOIN LATERAL (SELECT id FROM users WHERE organization_id=ep.organization_id ORDER BY (employee_id=ep.employee_id) DESC,created_at LIMIT 1) u ON true
 WHERE ep.salary IS NOT NULL AND ep.salary>=0;

INSERT INTO data_catalog_assets(code,name,domain,source_object,description,classification_code,owner_role_code,contains_personal_data) VALUES
('employment-contract','Employment contract','people','employment_contracts','Immutable versioned employment contract record','restricted','hr-officer',true),
('employee-compensation','Employee compensation','people','employee_compensation_history','Effective-dated compensation history','restricted','hr-officer',true),
('position-description','Position description','people','position_description_versions','Versioned position-level job description','confidential','hr-officer',false),
('employment-lifecycle','Employment lifecycle','people','employment_lifecycle_events','Immutable employee lifecycle state history','restricted','hr-officer',true)
ON CONFLICT(code) DO NOTHING;

CREATE POLICY employment_contracts_tenant_policy ON employment_contracts USING(organization_id=overva_current_organization_id()) WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY employee_compensation_tenant_policy ON employee_compensation_history USING(organization_id=overva_current_organization_id()) WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY position_description_tenant_policy ON position_description_versions USING(organization_id=overva_current_organization_id()) WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY employment_lifecycle_tenant_policy ON employment_lifecycle_events USING(organization_id=overva_current_organization_id()) WITH CHECK(organization_id=overva_current_organization_id());

COMMENT ON TABLE employment_contracts IS 'Append-only employment contract versions; employee remains the canonical person master.';
COMMENT ON TABLE employee_compensation_history IS 'Append-only effective-dated compensation history.';
COMMENT ON TABLE position_description_versions IS 'Position-level job description versions, never copied into employee master.';
COMMENT ON TABLE employment_lifecycle_events IS 'Append-only employment lifecycle source of truth.';
