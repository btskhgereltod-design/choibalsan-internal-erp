-- Align Market participation with action-driven marketplace behavior.
-- A registered identity becomes a customer by starting an order, while
-- provider capability requires a separate attributable application decision.

CREATE TABLE market_provider_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_identity_id UUID NOT NULL REFERENCES market_identities(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK(status IN ('submitted','under_review','approved','rejected')),
  professional_summary TEXT NOT NULL
    CHECK(char_length(professional_summary) BETWEEN 40 AND 2000),
  skill_tags TEXT[] NOT NULL
    CHECK(cardinality(skill_tags) BETWEEN 1 AND 12),
  portfolio_url TEXT CHECK(portfolio_url IS NULL OR char_length(portfolio_url) BETWEEN 10 AND 500),
  rules_accepted_at TIMESTAMPTZ NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  decided_at TIMESTAMPTZ,
  decided_by_identity_id UUID REFERENCES market_identities(id) ON DELETE RESTRICT,
  decision_reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK(
    (status IN ('submitted','under_review') AND decided_at IS NULL
      AND decided_by_identity_id IS NULL AND decision_reason IS NULL)
    OR
    (status IN ('approved','rejected') AND decided_at IS NOT NULL
      AND decided_by_identity_id IS NOT NULL
      AND char_length(decision_reason) BETWEEN 12 AND 1000)
  )
);
CREATE UNIQUE INDEX market_provider_applications_open_idx
  ON market_provider_applications(market_identity_id)
  WHERE status IN ('submitted','under_review');
CREATE INDEX market_provider_applications_identity_time_idx
  ON market_provider_applications(market_identity_id,submitted_at DESC);
CREATE TRIGGER market_provider_applications_no_delete
BEFORE DELETE ON market_provider_applications
FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

ALTER TABLE market_audit_events
  ADD COLUMN provider_application_id UUID
    REFERENCES market_provider_applications(id) ON DELETE RESTRICT;
CREATE INDEX market_audit_provider_application_time_idx
  ON market_audit_events(provider_application_id,created_at DESC);

COMMENT ON TABLE market_provider_applications IS
  'Provider capability applications. Submission grants no provider membership; only an attributable live Market operator decision can create that capacity.';
COMMENT ON COLUMN market_provider_applications.status IS
  'Application lifecycle only. It is never a participant view or Market operator authority.';
