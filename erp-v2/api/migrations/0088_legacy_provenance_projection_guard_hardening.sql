-- Forward-only hardening for 0087. Keep the applied 0087 checksum immutable.
-- Source-derived candidate/reason evidence is immutable, and every mutable
-- review projection value must agree with both sides and actor of its decision.

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
     OR NEW.match_candidate_type IS DISTINCT FROM OLD.match_candidate_type
     OR NEW.match_candidate_id IS DISTINCT FROM OLD.match_candidate_id
     OR NEW.match_reason<>OLD.match_reason
     OR NEW.conflict_reason<>OLD.conflict_reason
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
       AND d.action='REVIEW_DECISION'
       AND d.from_classification=OLD.classification
       AND d.from_review_status=OLD.review_status
       AND d.from_target_type IS NOT DISTINCT FROM OLD.target_type
       AND d.from_target_id IS NOT DISTINCT FROM OLD.target_id
       AND d.to_classification=NEW.classification
       AND d.to_review_status=NEW.review_status
       AND d.to_target_type IS NOT DISTINCT FROM NEW.target_type
       AND d.to_target_id IS NOT DISTINCT FROM NEW.target_id
       AND d.actor_user_id=NEW.reviewed_by
  ) THEN
    RAISE EXCEPTION 'legacy provenance change requires matching append-only decision evidence';
  END IF;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION overva_guard_legacy_provenance_projection() IS
  'Binds the mutable legacy review projection to an exact append-only from/to decision and actor; source evidence remains immutable.';
