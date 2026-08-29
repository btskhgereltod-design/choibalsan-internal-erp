-- Market identity assurance foundation. Authentication methods prove account
-- control; they never issue participant, operator, Platform, or tenant authority.

ALTER TABLE market_identities
  ALTER COLUMN password_hash DROP NOT NULL,
  ADD COLUMN email_verified_at TIMESTAMPTZ;

CREATE TABLE market_external_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_identity_id UUID NOT NULL REFERENCES market_identities(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK(provider IN ('google','facebook')),
  issuer TEXT NOT NULL CHECK(char_length(issuer) BETWEEN 8 AND 300),
  subject TEXT NOT NULL CHECK(char_length(subject) BETWEEN 3 AND 300),
  email_snapshot TEXT,
  email_verified BOOLEAN NOT NULL DEFAULT false,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  UNIQUE(provider,issuer,subject)
);
CREATE UNIQUE INDEX market_external_identities_owner_provider_idx
  ON market_external_identities(market_identity_id,provider) WHERE revoked_at IS NULL;

CREATE TABLE market_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_identity_id UUID NOT NULL REFERENCES market_identities(id) ON DELETE RESTRICT,
  auth_method TEXT NOT NULL CHECK(auth_method IN ('password','google','facebook','recovery')),
  user_agent_hash CHAR(64),
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revocation_reason TEXT,
  CHECK(expires_at > created_at),
  CHECK((revoked_at IS NULL AND revocation_reason IS NULL)
     OR (revoked_at IS NOT NULL AND char_length(revocation_reason) BETWEEN 4 AND 300))
);
CREATE INDEX market_sessions_active_owner_idx
  ON market_sessions(market_identity_id,expires_at) WHERE revoked_at IS NULL;

CREATE TABLE market_auth_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_identity_id UUID REFERENCES market_identities(id) ON DELETE RESTRICT,
  purpose TEXT NOT NULL CHECK(purpose IN
    ('email_verification','password_reset','google_login','google_link','login_exchange')),
  token_hash CHAR(64) NOT NULL UNIQUE,
  email_snapshot TEXT,
  secret_ciphertext TEXT,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  requested_ip INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  CHECK(expires_at > created_at),
  CHECK(jsonb_typeof(detail)='object')
);
CREATE INDEX market_auth_challenges_lookup_idx
  ON market_auth_challenges(purpose,token_hash,expires_at) WHERE consumed_at IS NULL;
CREATE UNIQUE INDEX market_auth_challenges_open_identity_idx
  ON market_auth_challenges(market_identity_id,purpose)
  WHERE market_identity_id IS NOT NULL AND consumed_at IS NULL;

CREATE TABLE market_identity_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_identity_id UUID NOT NULL REFERENCES market_identities(id) ON DELETE RESTRICT,
  verification_type TEXT NOT NULL CHECK(verification_type IN
    ('email','google_account','phone','person','business','billing')),
  status TEXT NOT NULL CHECK(status IN ('pending','verified','rejected','revoked')),
  source TEXT NOT NULL CHECK(char_length(source) BETWEEN 2 AND 80),
  evidence_hash CHAR(64),
  decided_by_identity_id UUID REFERENCES market_identities(id) ON DELETE RESTRICT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CHECK((status='pending' AND decided_at IS NULL)
     OR (status<>'pending' AND decided_at IS NOT NULL AND char_length(reason) BETWEEN 4 AND 1000))
);
CREATE UNIQUE INDEX market_identity_verifications_active_type_idx
  ON market_identity_verifications(market_identity_id,verification_type)
  WHERE status='verified' AND revoked_at IS NULL;
CREATE UNIQUE INDEX market_identity_verifications_unique_evidence_idx
  ON market_identity_verifications(verification_type,evidence_hash)
  WHERE status='verified' AND revoked_at IS NULL AND evidence_hash IS NOT NULL;

CREATE TABLE market_identity_risk_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_identity_id UUID REFERENCES market_identities(id) ON DELETE RESTRICT,
  related_identity_id UUID REFERENCES market_identities(id) ON DELETE RESTRICT,
  signal_type TEXT NOT NULL CHECK(signal_type IN
    ('email_collision','external_identity_conflict','verification_evidence_conflict','auth_velocity')),
  severity TEXT NOT NULL CHECK(severity IN ('low','medium','high','critical')),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','reviewed','dismissed','confirmed')),
  subject_hash CHAR(64),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by_identity_id UUID REFERENCES market_identities(id) ON DELETE RESTRICT,
  review_reason TEXT,
  CHECK(jsonb_typeof(detail)='object'),
  CHECK((status='open' AND reviewed_at IS NULL AND reviewed_by_identity_id IS NULL AND review_reason IS NULL)
     OR (status<>'open' AND reviewed_at IS NOT NULL AND reviewed_by_identity_id IS NOT NULL
         AND char_length(review_reason) BETWEEN 4 AND 1000))
);
CREATE INDEX market_identity_risk_signals_queue_idx
  ON market_identity_risk_signals(status,severity,detected_at);

CREATE FUNCTION enforce_market_identity_risk_signal_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'open' OR NEW.status NOT IN ('reviewed','dismissed','confirmed')
     OR NEW.market_identity_id IS DISTINCT FROM OLD.market_identity_id
     OR NEW.related_identity_id IS DISTINCT FROM OLD.related_identity_id
     OR NEW.signal_type IS DISTINCT FROM OLD.signal_type
     OR NEW.severity IS DISTINCT FROM OLD.severity
     OR NEW.subject_hash IS DISTINCT FROM OLD.subject_hash
     OR NEW.detail IS DISTINCT FROM OLD.detail
     OR NEW.detected_at IS DISTINCT FROM OLD.detected_at THEN
    RAISE EXCEPTION 'invalid market identity risk signal transition';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER market_identity_risk_signals_transition_guard
BEFORE UPDATE ON market_identity_risk_signals
FOR EACH ROW EXECUTE FUNCTION enforce_market_identity_risk_signal_transition();

ALTER TABLE market_audit_events
  ADD COLUMN external_identity_id UUID REFERENCES market_external_identities(id) ON DELETE RESTRICT,
  ADD COLUMN market_session_id UUID REFERENCES market_sessions(id) ON DELETE RESTRICT,
  ADD COLUMN auth_challenge_id UUID REFERENCES market_auth_challenges(id) ON DELETE RESTRICT,
  ADD COLUMN verification_id UUID REFERENCES market_identity_verifications(id) ON DELETE RESTRICT,
  ADD COLUMN risk_signal_id UUID REFERENCES market_identity_risk_signals(id) ON DELETE RESTRICT;

CREATE TRIGGER market_external_identities_no_delete BEFORE DELETE ON market_external_identities
FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();
CREATE TRIGGER market_sessions_no_delete BEFORE DELETE ON market_sessions
FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();
CREATE TRIGGER market_auth_challenges_no_delete BEFORE DELETE ON market_auth_challenges
FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();
CREATE TRIGGER market_identity_verifications_no_delete BEFORE DELETE ON market_identity_verifications
FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();
CREATE TRIGGER market_identity_risk_signals_no_delete BEFORE DELETE ON market_identity_risk_signals
FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

COMMENT ON TABLE market_external_identities IS
  'Login credentials linked to one canonical Market identity. Matching email alone never links identities.';
COMMENT ON TABLE market_sessions IS
  'Revocable Market sessions; session existence adds no membership or operator authority.';
COMMENT ON TABLE market_identity_verifications IS
  'Attributable assurance facts, not authorization grants. Raw identity documents are outside this slice.';
COMMENT ON TABLE market_identity_risk_signals IS
  'Review queue for possible duplicate or abusive identity use. A signal never grants or revokes authority by itself.';
