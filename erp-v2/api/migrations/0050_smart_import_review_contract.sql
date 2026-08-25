-- Smart Import review contract v1.
-- Keeps machine proposals, validation, human decisions and commit outcomes separate.
ALTER TABLE smart_import_rows
  ADD COLUMN proposed_action TEXT NOT NULL DEFAULT 'create'
    CHECK(proposed_action IN('create','update','skip')),
  ADD COLUMN validation_state TEXT NOT NULL DEFAULT 'valid'
    CHECK(validation_state IN('valid','warning','error')),
  ADD COLUMN review_decision TEXT NOT NULL DEFAULT 'pending'
    CHECK(review_decision IN('pending','accepted','corrected','excluded')),
  ADD COLUMN reviewed_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN review_reason TEXT,
  ADD COLUMN reviewed_by UUID,
  ADD COLUMN reviewed_at TIMESTAMPTZ,
  ADD COLUMN commit_outcome TEXT NOT NULL DEFAULT 'not_applied'
    CHECK(commit_outcome IN('not_applied','created','updated','skipped','rejected','failed')),
  ADD CONSTRAINT smart_import_rows_reviewed_by_fk
    FOREIGN KEY(organization_id,reviewed_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT;

UPDATE smart_import_rows
SET validation_state = CASE status
      WHEN 'error' THEN 'error'
      WHEN 'warning' THEN 'warning'
      ELSE 'valid'
    END,
    -- Historical warnings are ambiguous (an existing unit may still contain a
    -- new position). Default to the safer human-reviewed create proposal.
    proposed_action = 'create',
    review_decision = CASE WHEN status='imported' THEN 'accepted' ELSE 'pending' END,
    commit_outcome = CASE WHEN status='imported' THEN 'created' ELSE 'not_applied' END;

CREATE INDEX smart_import_rows_review_queue_idx
  ON smart_import_rows(organization_id,job_id,review_decision,validation_state,proposed_action,row_number);

COMMENT ON COLUMN smart_import_rows.proposed_action IS
  'Machine proposal only: create, update or skip. It is not a human decision or commit result.';
COMMENT ON COLUMN smart_import_rows.validation_state IS
  'Validation result independent from proposed action and human review.';
COMMENT ON COLUMN smart_import_rows.review_decision IS
  'Human review state. Consequential writes require accepted or corrected rows.';
COMMENT ON COLUMN smart_import_rows.reviewed_data IS
  'Reviewer corrections only; original source_data remains separately preserved until commit.';
COMMENT ON COLUMN smart_import_rows.commit_outcome IS
  'Canonical write result, recorded separately from proposal and review.';
