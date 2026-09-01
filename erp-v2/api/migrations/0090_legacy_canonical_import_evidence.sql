-- Import evidence for reviewer-approved legacy orders and correspondence.
-- This migration imports no source row and creates no canonical/domain record.

INSERT INTO permission_catalog(code,name,module_code,description) VALUES
('legacy_migration.import','Legacy migration: execute approved import','hr','Execute an explicitly approved, checksum-verified canonical legacy import.')
ON CONFLICT(code) DO NOTHING;

INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
SELECT r.organization_id,r.id,'legacy_migration.import'
  FROM organization_roles r
 WHERE r.code IN('owner','administrator')
ON CONFLICT DO NOTHING;

CREATE TABLE legacy_canonical_import_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  idempotency_key UUID NOT NULL,
  payload_hash CHAR(64) NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$'),
  source_database_sha256 CHAR(64) NOT NULL CHECK(source_database_sha256 ~ '^[0-9a-f]{64}$'),
  selected_group_ids JSONB NOT NULL CHECK(jsonb_typeof(selected_group_ids)='array'),
  result_summary JSONB NOT NULL CHECK(jsonb_typeof(result_summary)='object'),
  actor_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,idempotency_key),
  FOREIGN KEY(organization_id,actor_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);

CREATE TABLE legacy_canonical_import_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  import_run_id UUID NOT NULL,
  provenance_id UUID NOT NULL,
  target_role TEXT NOT NULL CHECK(length(btrim(target_role)) BETWEEN 1 AND 160),
  target_type TEXT NOT NULL CHECK(target_type IN('document','document_version','correspondence')),
  target_id UUID NOT NULL,
  source_sha256 CHAR(64) NOT NULL CHECK(source_sha256 ~ '^[0-9a-f]{64}$'),
  payload_hash CHAR(64) NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$'),
  provenance_metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(provenance_metadata)='object'),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,provenance_id,target_role),
  FOREIGN KEY(organization_id,import_run_id) REFERENCES legacy_canonical_import_runs(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,provenance_id) REFERENCES legacy_provenance_records(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);

CREATE TABLE legacy_canonical_import_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  import_run_id UUID NOT NULL,
  provenance_id UUID NOT NULL,
  provenance_version BIGINT NOT NULL CHECK(provenance_version>0),
  action TEXT NOT NULL CHECK(action='IMPORT_COMMITTED'),
  target_type TEXT NOT NULL CHECK(target_type IN('document','correspondence')),
  target_id UUID NOT NULL,
  actor_user_id UUID NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(evidence)='object'),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,provenance_id,provenance_version),
  UNIQUE(organization_id,provenance_id,import_run_id),
  FOREIGN KEY(organization_id,import_run_id) REFERENCES legacy_canonical_import_runs(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,provenance_id) REFERENCES legacy_provenance_records(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,actor_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);

CREATE INDEX legacy_canonical_import_mappings_target_idx
  ON legacy_canonical_import_mappings(organization_id,target_type,target_id);
CREATE INDEX legacy_canonical_import_events_timeline_idx
  ON legacy_canonical_import_events(organization_id,provenance_id,imported_at,id);

CREATE TRIGGER legacy_canonical_import_runs_append_only BEFORE UPDATE OR DELETE ON legacy_canonical_import_runs
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();
CREATE TRIGGER legacy_canonical_import_mappings_append_only BEFORE UPDATE OR DELETE ON legacy_canonical_import_mappings
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();
CREATE TRIGGER legacy_canonical_import_events_append_only BEFORE UPDATE OR DELETE ON legacy_canonical_import_events
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

ALTER TABLE legacy_canonical_import_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE legacy_canonical_import_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE legacy_canonical_import_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY legacy_canonical_import_runs_tenant_policy ON legacy_canonical_import_runs
  USING(organization_id=overva_current_organization_id()) WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY legacy_canonical_import_mappings_tenant_policy ON legacy_canonical_import_mappings
  USING(organization_id=overva_current_organization_id()) WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY legacy_canonical_import_events_tenant_policy ON legacy_canonical_import_events
  USING(organization_id=overva_current_organization_id()) WITH CHECK(organization_id=overva_current_organization_id());

ALTER TABLE legacy_provenance_records DROP CONSTRAINT legacy_provenance_records_imported_at_check;

CREATE OR REPLACE FUNCTION overva_guard_legacy_provenance_projection()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  import_only BOOLEAN;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'legacy provenance records cannot be deleted'; END IF;
  IF NEW.organization_id<>OLD.organization_id OR NEW.legacy_source<>OLD.legacy_source
     OR NEW.legacy_table<>OLD.legacy_table OR NEW.legacy_id<>OLD.legacy_id
     OR NEW.source_sha256<>OLD.source_sha256 OR NEW.payload_hash<>OLD.payload_hash
     OR NEW.source_summary<>OLD.source_summary OR NEW.suggested_classification<>OLD.suggested_classification
     OR NEW.legacy_status IS DISTINCT FROM OLD.legacy_status
     OR NEW.match_candidate_type IS DISTINCT FROM OLD.match_candidate_type
     OR NEW.match_candidate_id IS DISTINCT FROM OLD.match_candidate_id
     OR NEW.match_reason<>OLD.match_reason OR NEW.conflict_reason<>OLD.conflict_reason
     OR NEW.duplicate_signals<>OLD.duplicate_signals OR NEW.created_by<>OLD.created_by
     OR NEW.created_at<>OLD.created_at THEN
    RAISE EXCEPTION 'legacy source evidence is immutable';
  END IF;
  IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'legacy provenance version must increment exactly once'; END IF;

  import_only := OLD.imported_at IS NULL AND NEW.imported_at IS NOT NULL
    AND NEW.classification=OLD.classification AND NEW.review_status=OLD.review_status
    AND NEW.target_type IS NOT DISTINCT FROM OLD.target_type AND NEW.target_id IS NOT DISTINCT FROM OLD.target_id
    AND NEW.reviewed_by IS NOT DISTINCT FROM OLD.reviewed_by
    AND NEW.reviewed_at IS NOT DISTINCT FROM OLD.reviewed_at AND NEW.review_notes=OLD.review_notes;

  IF import_only THEN
    IF NOT EXISTS (
      SELECT 1 FROM legacy_canonical_import_events e
       WHERE e.organization_id=NEW.organization_id AND e.provenance_id=NEW.id
         AND e.provenance_version=NEW.version AND e.imported_at=NEW.imported_at
    ) THEN RAISE EXCEPTION 'legacy imported projection requires append-only import evidence'; END IF;
  ELSE
    IF NEW.imported_at IS DISTINCT FROM OLD.imported_at THEN
      RAISE EXCEPTION 'legacy imported projection is immutable';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM legacy_provenance_decisions d
       WHERE d.organization_id=NEW.organization_id AND d.provenance_id=NEW.id
         AND d.decision_version=NEW.version AND d.action='REVIEW_DECISION'
         AND d.from_classification=OLD.classification AND d.from_review_status=OLD.review_status
         AND d.from_target_type IS NOT DISTINCT FROM OLD.target_type AND d.from_target_id IS NOT DISTINCT FROM OLD.target_id
         AND d.to_classification=NEW.classification AND d.to_review_status=NEW.review_status
         AND d.to_target_type IS NOT DISTINCT FROM NEW.target_type AND d.to_target_id IS NOT DISTINCT FROM NEW.target_id
         AND d.actor_user_id=NEW.reviewed_by
    ) THEN RAISE EXCEPTION 'legacy provenance change requires matching append-only decision evidence'; END IF;
  END IF;
  RETURN NEW;
END $$;

COMMENT ON TABLE legacy_canonical_import_runs IS 'Append-only receipts for explicitly committed, approved legacy canonical imports. Dry-runs write nothing.';
COMMENT ON TABLE legacy_canonical_import_mappings IS 'Append-only source provenance to canonical target identity map; legacy status is evidence only.';
COMMENT ON TABLE legacy_canonical_import_events IS 'Append-only evidence authorizing the one-time imported_at projection; never domain workflow history.';
