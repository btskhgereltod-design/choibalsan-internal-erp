-- Tenant-scoped legacy provenance and human review foundation.
-- Additive only: this migration imports no domain data, creates no workflow
-- history, and does not modify employees, master data, or prior migrations.

INSERT INTO permission_catalog(code,name,module_code,description) VALUES
('legacy_migration.read','Legacy migration evidence: read','hr','View tenant-scoped legacy provenance and review evidence.'),
('legacy_migration.review','Legacy migration evidence: review','hr','Record an append-only human classification decision.'),
('legacy_migration.stage','Legacy migration evidence: stage','hr','Stage provenance evidence without importing domain records.')
ON CONFLICT(code) DO NOTHING;

INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
SELECT r.organization_id,r.id,p.code
FROM organization_roles r
JOIN permission_catalog p ON
  (r.code IN('owner','administrator') AND p.code IN('legacy_migration.read','legacy_migration.review','legacy_migration.stage'))
  OR (r.code IN('hr-officer','records-officer','archivist') AND p.code IN('legacy_migration.read','legacy_migration.review'))
  OR (r.code='auditor' AND p.code='legacy_migration.read')
ON CONFLICT DO NOTHING;

CREATE TABLE legacy_provenance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  legacy_source TEXT NOT NULL CHECK(length(btrim(legacy_source)) BETWEEN 1 AND 120),
  legacy_table TEXT NOT NULL CHECK(length(btrim(legacy_table)) BETWEEN 1 AND 120),
  legacy_id TEXT NOT NULL CHECK(length(btrim(legacy_id)) BETWEEN 1 AND 240),
  legacy_status TEXT,
  source_sha256 CHAR(64) NOT NULL CHECK(source_sha256 ~ '^[0-9a-f]{64}$'),
  payload_hash CHAR(64) NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$'),
  source_summary JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(source_summary)='object'),
  suggested_classification TEXT NOT NULL CHECK(suggested_classification IN('MATCH_EXISTING','IMPORT_NEW','REVIEW_REQUIRED','LEGACY_ONLY')),
  classification TEXT NOT NULL CHECK(classification IN('MATCH_EXISTING','IMPORT_NEW','REVIEW_REQUIRED','LEGACY_ONLY')),
  target_type TEXT,
  target_id UUID,
  match_candidate_type TEXT,
  match_candidate_id UUID,
  match_reason TEXT NOT NULL DEFAULT '',
  conflict_reason TEXT NOT NULL DEFAULT '',
  duplicate_signals JSONB NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(duplicate_signals)='array'),
  review_status TEXT NOT NULL DEFAULT 'PENDING' CHECK(review_status IN('NOT_REQUIRED','PENDING','APPROVED','REJECTED')),
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT NOT NULL DEFAULT '',
  imported_at TIMESTAMPTZ,
  version BIGINT NOT NULL DEFAULT 0 CHECK(version>=0),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,legacy_source,legacy_table,legacy_id),
  FOREIGN KEY(organization_id,reviewed_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  CHECK((target_type IS NULL)=(target_id IS NULL)),
  CHECK((match_candidate_type IS NULL)=(match_candidate_id IS NULL)),
  CHECK((reviewed_by IS NULL AND reviewed_at IS NULL) OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
  CHECK(imported_at IS NULL)
);

-- Target IDs may reference several domain tables. PostgreSQL cannot express a
-- polymorphic FK, so tenant-safe target validation is performed by the service.
CREATE INDEX legacy_provenance_review_queue_idx
  ON legacy_provenance_records(organization_id,review_status,classification,created_at,id);
CREATE INDEX legacy_provenance_target_idx
  ON legacy_provenance_records(organization_id,target_type,target_id) WHERE target_id IS NOT NULL;
CREATE INDEX legacy_provenance_payload_idx
  ON legacy_provenance_records(organization_id,payload_hash);

CREATE TABLE legacy_provenance_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  provenance_id UUID NOT NULL,
  decision_version BIGINT NOT NULL CHECK(decision_version>=0),
  action TEXT NOT NULL CHECK(action IN('REGISTERED','REVIEW_DECISION')),
  from_classification TEXT CHECK(from_classification IS NULL OR from_classification IN('MATCH_EXISTING','IMPORT_NEW','REVIEW_REQUIRED','LEGACY_ONLY')),
  to_classification TEXT NOT NULL CHECK(to_classification IN('MATCH_EXISTING','IMPORT_NEW','REVIEW_REQUIRED','LEGACY_ONLY')),
  from_review_status TEXT CHECK(from_review_status IS NULL OR from_review_status IN('NOT_REQUIRED','PENDING','APPROVED','REJECTED')),
  to_review_status TEXT NOT NULL CHECK(to_review_status IN('NOT_REQUIRED','PENDING','APPROVED','REJECTED')),
  from_target_type TEXT,
  from_target_id UUID,
  to_target_type TEXT,
  to_target_id UUID,
  reason TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  actor_user_id UUID NOT NULL,
  idempotency_key UUID NOT NULL,
  payload_hash CHAR(64) NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,provenance_id,decision_version),
  UNIQUE(organization_id,provenance_id,idempotency_key),
  FOREIGN KEY(organization_id,provenance_id) REFERENCES legacy_provenance_records(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,actor_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  CHECK((from_target_type IS NULL)=(from_target_id IS NULL)),
  CHECK((to_target_type IS NULL)=(to_target_id IS NULL))
);

CREATE INDEX legacy_provenance_decisions_timeline_idx
  ON legacy_provenance_decisions(organization_id,provenance_id,decision_version,created_at,id);

CREATE OR REPLACE FUNCTION overva_guard_legacy_provenance_projection()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'legacy provenance records cannot be deleted';
  END IF;
  IF NEW.organization_id<>OLD.organization_id
     OR NEW.legacy_source<>OLD.legacy_source
     OR NEW.legacy_table<>OLD.legacy_table
     OR NEW.legacy_id<>OLD.legacy_id
     OR NEW.source_sha256<>OLD.source_sha256
     OR NEW.payload_hash<>OLD.payload_hash
     OR NEW.source_summary<>OLD.source_summary
     OR NEW.suggested_classification<>OLD.suggested_classification
     OR NEW.legacy_status IS DISTINCT FROM OLD.legacy_status
     OR NEW.duplicate_signals<>OLD.duplicate_signals
     OR NEW.created_by<>OLD.created_by
     OR NEW.created_at<>OLD.created_at
     OR NEW.imported_at IS DISTINCT FROM OLD.imported_at THEN
    RAISE EXCEPTION 'legacy source evidence is immutable';
  END IF;
  IF NEW.version<>OLD.version+1 THEN
    RAISE EXCEPTION 'legacy provenance version must increment exactly once';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM legacy_provenance_decisions d
     WHERE d.organization_id=NEW.organization_id
       AND d.provenance_id=NEW.id
       AND d.decision_version=NEW.version
       AND d.to_classification=NEW.classification
       AND d.to_review_status=NEW.review_status
       AND d.to_target_type IS NOT DISTINCT FROM NEW.target_type
       AND d.to_target_id IS NOT DISTINCT FROM NEW.target_id
  ) THEN
    RAISE EXCEPTION 'legacy provenance change requires append-only decision evidence';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER legacy_provenance_projection_guard
  BEFORE UPDATE OR DELETE ON legacy_provenance_records
  FOR EACH ROW EXECUTE FUNCTION overva_guard_legacy_provenance_projection();
CREATE TRIGGER legacy_provenance_decisions_append_only
  BEFORE UPDATE OR DELETE ON legacy_provenance_decisions
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

ALTER TABLE legacy_provenance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE legacy_provenance_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY legacy_provenance_records_tenant_policy ON legacy_provenance_records
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY legacy_provenance_decisions_tenant_policy ON legacy_provenance_decisions
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());

COMMENT ON TABLE legacy_provenance_records IS
  'Current tenant-scoped review projection for immutable legacy source evidence; never authoritative domain data.';
COMMENT ON TABLE legacy_provenance_decisions IS
  'Append-only human and staging decisions. Legacy status is provenance only and never workflow history.';
