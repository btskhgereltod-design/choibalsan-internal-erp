-- OVERVA Smart Import: tenant-isolated staging, human approval and immutable history.
CREATE TABLE smart_import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  import_type TEXT NOT NULL CHECK(import_type IN('employee_master')),
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT '',
  size_bytes BIGINT NOT NULL CHECK(size_bytes BETWEEN 1 AND 10485760),
  content_sha256 CHAR(64) NOT NULL,
  status TEXT NOT NULL DEFAULT 'analyzing'
    CHECK(status IN('analyzing','needs_review','approved','importing','completed','failed')),
  source_columns JSONB NOT NULL DEFAULT '[]'::jsonb,
  proposed_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
  mapping_confidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  analysis_mode TEXT NOT NULL DEFAULT 'deterministic'
    CHECK(analysis_mode IN('deterministic','ai_assisted')),
  ai_model TEXT,
  provider_response_id TEXT,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  created_by UUID NOT NULL,
  approved_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,approved_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX smart_import_jobs_org_time_idx ON smart_import_jobs(organization_id,created_at DESC);

CREATE TABLE smart_import_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  job_id UUID NOT NULL,
  row_number INTEGER NOT NULL CHECK(row_number > 0),
  source_data JSONB NOT NULL,
  normalized_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  validation JSONB NOT NULL DEFAULT '{"errors":[],"warnings":[]}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','ready','warning','error','imported')),
  duplicate_employee_id UUID,
  imported_employee_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,job_id,row_number),
  FOREIGN KEY(organization_id,job_id) REFERENCES smart_import_jobs(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY(organization_id,duplicate_employee_id) REFERENCES employees(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,imported_employee_id) REFERENCES employees(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX smart_import_rows_job_status_idx ON smart_import_rows(organization_id,job_id,status,row_number);

CREATE TABLE smart_import_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL,
  job_id UUID NOT NULL,
  actor_user_id UUID,
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,job_id) REFERENCES smart_import_jobs(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,actor_user_id) REFERENCES users(organization_id,id) ON DELETE SET NULL
);
CREATE INDEX smart_import_events_job_time_idx ON smart_import_events(organization_id,job_id,created_at,id);
CREATE TRIGGER smart_import_events_immutable
BEFORE UPDATE OR DELETE ON smart_import_events
FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

INSERT INTO permission_catalog(code,name,module_code,description) VALUES
('hr.import.manage','Smart Import удирдах','hr','Ажилтны өгөгдлийг staging, хяналт, баталгаажуулалтаар импортлох')
ON CONFLICT(code) DO NOTHING;

INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
SELECT r.organization_id,r.id,'hr.import.manage'
FROM organization_roles r
WHERE r.code IN('owner','administrator','hr-officer')
ON CONFLICT DO NOTHING;

COMMENT ON TABLE smart_import_jobs IS 'Human-approved tenant import batches; AI advice never writes canonical records directly.';
COMMENT ON TABLE smart_import_rows IS 'Tenant-isolated parsed staging rows. Canonical employee IDs are assigned only after approval.';
COMMENT ON TABLE smart_import_events IS 'Append-only evidence for Smart Import analysis, review, approval and commit actions.';
