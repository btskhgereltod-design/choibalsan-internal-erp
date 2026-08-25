ALTER TABLE users
  ADD COLUMN person_type TEXT NOT NULL DEFAULT 'employee'
  CHECK (person_type IN ('employee', 'external'));

CREATE INDEX users_employee_directory_idx
  ON users (organization_id, person_type, active, full_name);

COMMENT ON COLUMN users.person_type IS
  'Employee is an organization worker; external is a non-employee account. can_login independently controls OVERVA access.';
