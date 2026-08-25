-- Organization Structure Smart Import extends the reviewed staging engine.
ALTER TABLE smart_import_jobs DROP CONSTRAINT smart_import_jobs_import_type_check;
ALTER TABLE smart_import_jobs ADD CONSTRAINT smart_import_jobs_import_type_check
  CHECK(import_type IN('employee_master','organization_structure'));
CREATE INDEX smart_import_jobs_org_type_time_idx
  ON smart_import_jobs(organization_id,import_type,created_at DESC);

INSERT INTO permission_catalog(code,name,module_code,description) VALUES
('structure.import.manage','Бүтцийн Smart Import удирдах','structure','Байгууллагын нэгж, албан тушаалын бүтцийг staging, хяналт, баталгаажуулалтаар импортлох')
ON CONFLICT(code) DO NOTHING;

INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
SELECT r.organization_id,r.id,'structure.import.manage'
FROM organization_roles r WHERE r.code='owner'
ON CONFLICT DO NOTHING;

COMMENT ON CONSTRAINT smart_import_jobs_import_type_check ON smart_import_jobs IS
  'Each import type has separate validation and commit policy; AI cannot bypass approval.';
