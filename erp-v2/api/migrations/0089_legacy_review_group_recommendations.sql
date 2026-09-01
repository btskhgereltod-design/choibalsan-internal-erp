-- Deterministic, tenant-scoped review grouping for staged legacy provenance.
-- Additive only: no legacy record is imported and no domain/workflow state is
-- created or changed by this migration.

CREATE TABLE legacy_review_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  category TEXT NOT NULL CHECK(category IN(
    'ATTENDANCE','INACTIVE_USER','ORDER_DECISION','CORRESPONDENCE','DOCUMENT_ATTACHMENT'
  )),
  group_key TEXT NOT NULL CHECK(length(btrim(group_key)) BETWEEN 1 AND 500),
  deterministic_version TEXT NOT NULL CHECK(length(btrim(deterministic_version)) BETWEEN 1 AND 80),
  group_hash CHAR(64) NOT NULL CHECK(group_hash ~ '^[0-9a-f]{64}$'),
  source_summary JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(source_summary)='object'),
  signals JSONB NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(signals)='array'),
  recommendation TEXT NOT NULL CHECK(recommendation IN(
    'IMPORT_NEW','LEGACY_ONLY','MANUAL_REVIEW','RECONCILE_REQUIRED'
  )),
  recommendation_reason TEXT NOT NULL,
  confidence TEXT NOT NULL CHECK(confidence IN('HIGH','MEDIUM','LOW')),
  requires_external_evidence BOOLEAN NOT NULL DEFAULT false,
  external_evidence_status TEXT NOT NULL CHECK(external_evidence_status IN('NOT_REQUIRED','MISSING','VERIFIED')),
  review_status TEXT NOT NULL DEFAULT 'PENDING' CHECK(review_status IN(
    'PENDING','APPROVED','LEGACY_ONLY','MANUAL_REVIEW'
  )),
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT NOT NULL DEFAULT '',
  version BIGINT NOT NULL DEFAULT 0 CHECK(version>=0),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,category,group_key),
  FOREIGN KEY(organization_id,reviewed_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  CHECK((reviewed_by IS NULL AND reviewed_at IS NULL) OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
  CHECK((requires_external_evidence AND external_evidence_status IN('MISSING','VERIFIED'))
    OR (NOT requires_external_evidence AND external_evidence_status='NOT_REQUIRED'))
);

CREATE TABLE legacy_review_group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  group_id UUID NOT NULL,
  provenance_id UUID NOT NULL,
  member_role TEXT NOT NULL CHECK(member_role IN('MEMBER','PRIMARY_CANDIDATE','SUPERSEDED_CANDIDATE')),
  recommended_classification TEXT CHECK(recommended_classification IS NULL OR recommended_classification IN(
    'MATCH_EXISTING','IMPORT_NEW','REVIEW_REQUIRED','LEGACY_ONLY'
  )),
  recommendation_reason TEXT NOT NULL DEFAULT '',
  source_order INTEGER NOT NULL DEFAULT 0 CHECK(source_order>=0),
  source_summary JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(source_summary)='object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,group_id,provenance_id),
  UNIQUE(organization_id,provenance_id),
  FOREIGN KEY(organization_id,group_id) REFERENCES legacy_review_groups(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,provenance_id) REFERENCES legacy_provenance_records(organization_id,id) ON DELETE RESTRICT
);

CREATE TABLE legacy_review_batch_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  idempotency_key UUID NOT NULL,
  action TEXT NOT NULL CHECK(action IN(
    'APPROVE_RECOMMENDATION','MARK_LEGACY_ONLY','SEND_MANUAL_REVIEW'
  )),
  payload_hash CHAR(64) NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$'),
  selected_group_ids JSONB NOT NULL CHECK(jsonb_typeof(selected_group_ids)='array'),
  selected_group_count INTEGER NOT NULL CHECK(selected_group_count BETWEEN 1 AND 200),
  affected_record_count INTEGER NOT NULL CHECK(affected_record_count>=0),
  note TEXT NOT NULL DEFAULT '',
  actor_user_id UUID NOT NULL,
  result_summary JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(result_summary)='object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,idempotency_key),
  FOREIGN KEY(organization_id,actor_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);

CREATE TABLE legacy_review_group_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  group_id UUID NOT NULL,
  decision_version BIGINT NOT NULL CHECK(decision_version>=0),
  action TEXT NOT NULL CHECK(action IN(
    'REGISTERED','APPROVE_RECOMMENDATION','MARK_LEGACY_ONLY','SEND_MANUAL_REVIEW'
  )),
  from_review_status TEXT CHECK(from_review_status IS NULL OR from_review_status IN(
    'PENDING','APPROVED','LEGACY_ONLY','MANUAL_REVIEW'
  )),
  to_review_status TEXT NOT NULL CHECK(to_review_status IN(
    'PENDING','APPROVED','LEGACY_ONLY','MANUAL_REVIEW'
  )),
  recommendation TEXT NOT NULL CHECK(recommendation IN(
    'IMPORT_NEW','LEGACY_ONLY','MANUAL_REVIEW','RECONCILE_REQUIRED'
  )),
  recommendation_hash CHAR(64) NOT NULL CHECK(recommendation_hash ~ '^[0-9a-f]{64}$'),
  reason TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  actor_user_id UUID NOT NULL,
  idempotency_key UUID NOT NULL,
  payload_hash CHAR(64) NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$'),
  batch_command_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,group_id,decision_version),
  UNIQUE(organization_id,group_id,idempotency_key),
  FOREIGN KEY(organization_id,group_id) REFERENCES legacy_review_groups(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,actor_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,batch_command_id) REFERENCES legacy_review_batch_commands(organization_id,id) ON DELETE RESTRICT
);

CREATE INDEX legacy_review_groups_queue_idx
  ON legacy_review_groups(organization_id,review_status,category,recommendation,created_at,id);
CREATE INDEX legacy_review_group_members_group_idx
  ON legacy_review_group_members(organization_id,group_id,source_order,id);
CREATE INDEX legacy_review_group_decisions_timeline_idx
  ON legacy_review_group_decisions(organization_id,group_id,decision_version,created_at,id);

CREATE OR REPLACE FUNCTION overva_guard_legacy_review_group_projection()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'legacy review groups cannot be deleted';
  END IF;
  IF NEW.organization_id<>OLD.organization_id
     OR NEW.category<>OLD.category
     OR NEW.group_key<>OLD.group_key
     OR NEW.deterministic_version<>OLD.deterministic_version
     OR NEW.group_hash<>OLD.group_hash
     OR NEW.source_summary<>OLD.source_summary
     OR NEW.signals<>OLD.signals
     OR NEW.recommendation<>OLD.recommendation
     OR NEW.recommendation_reason<>OLD.recommendation_reason
     OR NEW.confidence<>OLD.confidence
     OR NEW.requires_external_evidence<>OLD.requires_external_evidence
     OR NEW.external_evidence_status<>OLD.external_evidence_status
     OR NEW.created_by<>OLD.created_by
     OR NEW.created_at<>OLD.created_at THEN
    RAISE EXCEPTION 'legacy review group source and recommendation evidence is immutable';
  END IF;
  IF NEW.version<>OLD.version+1 THEN
    RAISE EXCEPTION 'legacy review group version must increment exactly once';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM legacy_review_group_decisions d
     WHERE d.organization_id=NEW.organization_id
       AND d.group_id=NEW.id
       AND d.decision_version=NEW.version
       AND d.action<>'REGISTERED'
       AND d.from_review_status=OLD.review_status
       AND d.to_review_status=NEW.review_status
       AND d.actor_user_id=NEW.reviewed_by
  ) THEN
    RAISE EXCEPTION 'legacy review group change requires matching append-only decision evidence';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER legacy_review_groups_projection_guard
  BEFORE UPDATE OR DELETE ON legacy_review_groups
  FOR EACH ROW EXECUTE FUNCTION overva_guard_legacy_review_group_projection();
CREATE TRIGGER legacy_review_group_members_append_only
  BEFORE UPDATE OR DELETE ON legacy_review_group_members
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();
CREATE TRIGGER legacy_review_group_decisions_append_only
  BEFORE UPDATE OR DELETE ON legacy_review_group_decisions
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();
CREATE TRIGGER legacy_review_batch_commands_append_only
  BEFORE UPDATE OR DELETE ON legacy_review_batch_commands
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

ALTER TABLE legacy_review_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE legacy_review_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE legacy_review_group_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE legacy_review_batch_commands ENABLE ROW LEVEL SECURITY;

CREATE POLICY legacy_review_groups_tenant_policy ON legacy_review_groups
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY legacy_review_group_members_tenant_policy ON legacy_review_group_members
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY legacy_review_group_decisions_tenant_policy ON legacy_review_group_decisions
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY legacy_review_batch_commands_tenant_policy ON legacy_review_batch_commands
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());

COMMENT ON TABLE legacy_review_groups IS
  'Immutable deterministic recommendation evidence plus a versioned human-review projection; never authoritative domain state.';
COMMENT ON TABLE legacy_review_group_members IS
  'Append-only mapping from a deterministic review case to staged provenance records.';
COMMENT ON TABLE legacy_review_group_decisions IS
  'Append-only reviewer decisions for grouped legacy evidence; not workflow history.';
COMMENT ON TABLE legacy_review_batch_commands IS
  'Append-only tenant-scoped idempotency receipts for atomic batch review actions.';
