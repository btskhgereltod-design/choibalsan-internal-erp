-- Provider onboarding assurance: recent authentication and verified phone.
-- Assurance evidence never grants participant, operator, Platform, or tenant authority.

ALTER TABLE market_sessions ADD COLUMN reauthenticated_at TIMESTAMPTZ;
UPDATE market_sessions SET reauthenticated_at=created_at;
ALTER TABLE market_sessions
  ALTER COLUMN reauthenticated_at SET NOT NULL,
  ALTER COLUMN reauthenticated_at SET DEFAULT now();

ALTER TABLE market_auth_challenges
  DROP CONSTRAINT market_auth_challenges_purpose_check,
  ADD CONSTRAINT market_auth_challenges_purpose_check CHECK(purpose IN
    ('email_verification','password_reset','google_login','google_link','google_reauth','login_exchange'));

CREATE TABLE market_phone_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_identity_id UUID NOT NULL REFERENCES market_identities(id) ON DELETE RESTRICT,
  phone_ciphertext TEXT NOT NULL,
  phone_fingerprint CHAR(64) NOT NULL,
  country_code TEXT NOT NULL CHECK(country_code ~ '^\+[1-9][0-9]{0,2}$'),
  last_four CHAR(4) NOT NULL CHECK(last_four ~ '^[0-9]{4}$'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verified','revoked')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK((status='pending' AND verified_at IS NULL AND revoked_at IS NULL)
     OR (status='verified' AND verified_at IS NOT NULL AND revoked_at IS NULL)
     OR (status='revoked' AND revoked_at IS NOT NULL))
);
CREATE UNIQUE INDEX market_phone_contacts_open_owner_idx
  ON market_phone_contacts(market_identity_id) WHERE status IN ('pending','verified');
CREATE UNIQUE INDEX market_phone_contacts_verified_fingerprint_idx
  ON market_phone_contacts(phone_fingerprint) WHERE status='verified';

CREATE TABLE market_phone_verification_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_identity_id UUID NOT NULL REFERENCES market_identities(id) ON DELETE RESTRICT,
  phone_contact_id UUID NOT NULL REFERENCES market_phone_contacts(id) ON DELETE RESTRICT,
  otp_hash TEXT NOT NULL CHECK(char_length(otp_hash) BETWEEN 40 AND 200),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 5),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK(max_attempts=5),
  requested_ip INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  CHECK(expires_at > created_at)
);
CREATE UNIQUE INDEX market_phone_challenges_open_owner_idx
  ON market_phone_verification_challenges(market_identity_id)
  WHERE consumed_at IS NULL;
CREATE INDEX market_phone_challenges_rate_idx
  ON market_phone_verification_challenges(market_identity_id,created_at DESC);

ALTER TABLE market_provider_applications
  ADD COLUMN assurance_policy_version INTEGER NOT NULL DEFAULT 0 CHECK(assurance_policy_version IN (0,1)),
  ADD COLUMN phone_verification_id UUID REFERENCES market_identity_verifications(id) ON DELETE RESTRICT,
  ADD COLUMN step_up_at TIMESTAMPTZ;

ALTER TABLE market_audit_events
  ADD COLUMN phone_contact_id UUID REFERENCES market_phone_contacts(id) ON DELETE RESTRICT,
  ADD COLUMN phone_challenge_id UUID REFERENCES market_phone_verification_challenges(id) ON DELETE RESTRICT;

ALTER TABLE market_identity_risk_signals
  DROP CONSTRAINT market_identity_risk_signals_signal_type_check,
  ADD CONSTRAINT market_identity_risk_signals_signal_type_check CHECK(signal_type IN
    ('email_collision','external_identity_conflict','verification_evidence_conflict','auth_velocity','phone_collision'));

CREATE TRIGGER market_phone_contacts_no_delete BEFORE DELETE ON market_phone_contacts
FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();
CREATE TRIGGER market_phone_challenges_no_delete BEFORE DELETE ON market_phone_verification_challenges
FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

COMMENT ON TABLE market_phone_contacts IS
  'Encrypted Market phone contacts. A verified contact is assurance evidence only and grants no authority.';
COMMENT ON TABLE market_phone_verification_challenges IS
  'Short-lived bcrypt-protected OTP challenges with bounded attempts and immutable history.';
COMMENT ON COLUMN market_provider_applications.assurance_policy_version IS
  'Policy 0 preserves legacy applications; policy 1 requires recent step-up and a live verified phone fact.';
