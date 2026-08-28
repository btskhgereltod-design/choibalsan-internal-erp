-- Generic workbook discovery for unknown/multi-domain datasets.
-- This import type profiles and classifies data but deliberately has no
-- canonical commit path until a governed target contract exists.

ALTER TABLE smart_import_jobs DROP CONSTRAINT smart_import_jobs_import_type_check;
ALTER TABLE smart_import_jobs ADD CONSTRAINT smart_import_jobs_import_type_check
  CHECK(import_type IN('employee_master','organization_structure','dataset_discovery'));

CREATE TABLE smart_import_dataset_sheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  job_id UUID NOT NULL,
  sheet_index INTEGER NOT NULL CHECK(sheet_index > 0),
  sheet_name TEXT NOT NULL,
  proposed_role TEXT NOT NULL CHECK(proposed_role IN('source','master','derived','report','instruction','unknown')),
  header_row INTEGER,
  row_count INTEGER NOT NULL CHECK(row_count >= 0),
  column_count INTEGER NOT NULL CHECK(column_count >= 0),
  truncated BOOLEAN NOT NULL DEFAULT false,
  column_profile JSONB NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(column_profile)='array'),
  findings JSONB NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(findings)='array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,job_id,sheet_index),
  FOREIGN KEY(organization_id,job_id) REFERENCES smart_import_jobs(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX smart_import_dataset_sheets_job_idx
  ON smart_import_dataset_sheets(organization_id,job_id,sheet_index);

CREATE TABLE smart_import_dataset_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  job_id UUID NOT NULL,
  domain_code TEXT NOT NULL,
  domain_name TEXT NOT NULL,
  readiness TEXT NOT NULL CHECK(readiness IN('ready','partial_native','contract_missing','analysis_only')),
  source_sheets TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  rationale TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,job_id,domain_code),
  FOREIGN KEY(organization_id,job_id) REFERENCES smart_import_jobs(organization_id,id) ON DELETE RESTRICT
);

CREATE TABLE smart_import_dataset_sheet_reviews (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL,
  sheet_id UUID NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN('accepted','corrected','excluded')),
  selected_role TEXT CHECK(selected_role IN('source','master','derived','report','instruction','unknown')),
  note TEXT NOT NULL DEFAULT '',
  actor_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,sheet_id) REFERENCES smart_import_dataset_sheets(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,actor_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  CHECK((decision='excluded' AND selected_role IS NULL) OR (decision<>'excluded' AND selected_role IS NOT NULL))
);
CREATE INDEX smart_import_dataset_sheet_reviews_latest_idx
  ON smart_import_dataset_sheet_reviews(organization_id,sheet_id,created_at DESC,id DESC);

CREATE TRIGGER smart_import_dataset_sheets_append_only BEFORE UPDATE OR DELETE ON smart_import_dataset_sheets
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();
CREATE TRIGGER smart_import_dataset_targets_append_only BEFORE UPDATE OR DELETE ON smart_import_dataset_targets
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();
CREATE TRIGGER smart_import_dataset_sheet_reviews_append_only BEFORE UPDATE OR DELETE ON smart_import_dataset_sheet_reviews
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

ALTER TABLE smart_import_dataset_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE smart_import_dataset_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE smart_import_dataset_sheet_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY smart_import_dataset_sheets_tenant_policy ON smart_import_dataset_sheets
  USING(organization_id=overva_current_organization_id()) WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY smart_import_dataset_targets_tenant_policy ON smart_import_dataset_targets
  USING(organization_id=overva_current_organization_id()) WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY smart_import_dataset_sheet_reviews_tenant_policy ON smart_import_dataset_sheet_reviews
  USING(organization_id=overva_current_organization_id()) WITH CHECK(organization_id=overva_current_organization_id());

COMMENT ON TABLE smart_import_dataset_sheets IS 'Privacy-safe workbook metadata and quality findings; raw cell values are not persisted.';
COMMENT ON TABLE smart_import_dataset_targets IS 'Advisory target-domain readiness. contract_missing blocks canonical commit by design.';
COMMENT ON TABLE smart_import_dataset_sheet_reviews IS 'Append-only human classification of workbook sheet roles.';
