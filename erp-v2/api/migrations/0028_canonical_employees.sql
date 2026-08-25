-- Canonical People Core: an employee is organization data; a user is optional login access.
CREATE TABLE employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  full_name TEXT NOT NULL,
  employee_no TEXT,
  job_role TEXT NOT NULL DEFAULT 'worker',
  active BOOLEAN NOT NULL DEFAULT true,
  department_id UUID,
  position_id UUID,
  manager_employee_id UUID,
  legacy_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, department_id) REFERENCES departments(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, position_id) REFERENCES positions(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, manager_employee_id) REFERENCES employees(organization_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX employees_org_employee_no_uidx ON employees(organization_id,employee_no) WHERE employee_no IS NOT NULL;
CREATE INDEX employees_org_directory_idx ON employees(organization_id,active,full_name);

INSERT INTO employees(id,organization_id,full_name,employee_no,job_role,active,department_id,position_id,manager_employee_id,legacy_user_id,created_at,updated_at)
SELECT u.id,u.organization_id,u.full_name,ep.employee_no,u.role,u.active,u.department_id,u.position_id,u.manager_user_id,u.id,u.created_at,u.updated_at
FROM users u LEFT JOIN employee_profiles ep ON ep.organization_id=u.organization_id AND ep.user_id=u.id
WHERE u.person_type='employee';

ALTER TABLE users ADD COLUMN employee_id UUID;
UPDATE users SET employee_id=id WHERE person_type='employee';
ALTER TABLE users ADD CONSTRAINT users_employee_tenant_fk FOREIGN KEY(organization_id,employee_id) REFERENCES employees(organization_id,id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX users_org_employee_account_uidx ON users(organization_id,employee_id) WHERE employee_id IS NOT NULL;

ALTER TABLE employee_profiles ADD COLUMN employee_id UUID;
UPDATE employee_profiles SET employee_id=user_id;
ALTER TABLE employee_profiles ALTER COLUMN employee_id SET NOT NULL;
ALTER TABLE employee_profiles ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE employee_profiles DROP CONSTRAINT employee_profiles_organization_id_user_id_fkey;
ALTER TABLE employee_profiles ADD CONSTRAINT employee_profiles_employee_tenant_fk FOREIGN KEY(organization_id,employee_id) REFERENCES employees(organization_id,id) ON DELETE CASCADE;
CREATE UNIQUE INDEX employee_profiles_org_employee_uidx ON employee_profiles(organization_id,employee_id);

ALTER TABLE employee_events ADD COLUMN employee_id UUID;
UPDATE employee_events SET employee_id=user_id;
ALTER TABLE employee_events ALTER COLUMN employee_id SET NOT NULL;
ALTER TABLE employee_events ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE employee_events DROP CONSTRAINT employee_events_organization_id_user_id_fkey;
ALTER TABLE employee_events ADD CONSTRAINT employee_events_employee_tenant_fk FOREIGN KEY(organization_id,employee_id) REFERENCES employees(organization_id,id) ON DELETE CASCADE;
CREATE INDEX employee_events_org_employee_date_idx ON employee_events(organization_id,employee_id,effective_date DESC);

ALTER TABLE attendance_records ADD COLUMN employee_id UUID;
UPDATE attendance_records SET employee_id=user_id;
ALTER TABLE attendance_records ALTER COLUMN employee_id SET NOT NULL;
ALTER TABLE attendance_records ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE attendance_records DROP CONSTRAINT attendance_records_organization_id_user_id_fkey;
ALTER TABLE attendance_records ADD CONSTRAINT attendance_employee_tenant_fk FOREIGN KEY(organization_id,employee_id) REFERENCES employees(organization_id,id) ON DELETE CASCADE;
CREATE UNIQUE INDEX attendance_org_employee_date_uidx ON attendance_records(organization_id,employee_id,attendance_date);
CREATE INDEX attendance_org_employee_date_idx ON attendance_records(organization_id,employee_id,attendance_date DESC);

COMMENT ON TABLE employees IS 'Tenant-owned workforce identity independent from optional application login accounts.';
COMMENT ON COLUMN users.employee_id IS 'Optional one-to-one login account link to the canonical employee record.';
