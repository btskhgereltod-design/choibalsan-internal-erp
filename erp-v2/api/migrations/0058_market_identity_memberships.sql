-- First bounded OVERVA Market identity and participant-membership slice.
-- Market identities deliberately do not reference tenant users or Platform admins.

CREATE TABLE market_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL CHECK(char_length(display_name) BETWEEN 2 AND 120),
  active BOOLEAN NOT NULL DEFAULT true,
  selected_view TEXT CHECK(selected_view IN ('customer','provider')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX market_identities_email_idx ON market_identities(lower(email));

CREATE TABLE market_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_identity_id UUID NOT NULL REFERENCES market_identities(id) ON DELETE RESTRICT,
  membership_type TEXT NOT NULL CHECK(membership_type IN ('customer','provider')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
  issued_by_kind TEXT NOT NULL CHECK(issued_by_kind IN ('self','market_operator','system')),
  issued_by_identity_id UUID REFERENCES market_identities(id) ON DELETE RESTRICT,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  suspended_at TIMESTAMPTZ,
  suspension_reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(market_identity_id,membership_type),
  CHECK((status='active' AND suspended_at IS NULL AND suspension_reason IS NULL) OR
        (status='suspended' AND suspended_at IS NOT NULL AND char_length(suspension_reason) BETWEEN 12 AND 1000))
);
CREATE INDEX market_memberships_identity_status_idx
  ON market_memberships(market_identity_id,status,membership_type);

CREATE TABLE market_operator_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_identity_id UUID NOT NULL REFERENCES market_identities(id) ON DELETE RESTRICT,
  role_code TEXT NOT NULL DEFAULT 'market-operator' CHECK(role_code='market-operator'),
  assigned_by_identity_id UUID REFERENCES market_identities(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK(char_length(reason) BETWEEN 12 AND 1000),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  revoked_by_identity_id UUID REFERENCES market_identities(id) ON DELETE RESTRICT,
  revocation_reason TEXT,
  CHECK((revoked_at IS NULL AND revoked_by_identity_id IS NULL AND revocation_reason IS NULL) OR
        (revoked_at IS NOT NULL AND revoked_by_identity_id IS NOT NULL AND char_length(revocation_reason) BETWEEN 12 AND 1000))
);
CREATE UNIQUE INDEX market_operator_assignments_active_idx
  ON market_operator_assignments(market_identity_id,role_code)
  WHERE revoked_at IS NULL;

CREATE TABLE market_audit_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  market_identity_id UUID REFERENCES market_identities(id) ON DELETE RESTRICT,
  membership_id UUID REFERENCES market_memberships(id) ON DELETE RESTRICT,
  operator_assignment_id UUID REFERENCES market_operator_assignments(id) ON DELETE RESTRICT,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('anonymous','market_identity','market_operator','system')),
  actor_identity_id UUID REFERENCES market_identities(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('success','failure','denied')),
  subject_hash CHAR(64),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX market_audit_identity_time_idx
  ON market_audit_events(market_identity_id,created_at DESC);
CREATE INDEX market_audit_event_time_idx
  ON market_audit_events(event_type,created_at DESC);
CREATE TRIGGER market_audit_events_append_only
BEFORE UPDATE OR DELETE ON market_audit_events
FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

CREATE OR REPLACE FUNCTION overva_record_market_operator_assignment()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO market_audit_events
    (market_identity_id,operator_assignment_id,actor_type,actor_identity_id,event_type,outcome,detail)
  VALUES
    (NEW.market_identity_id,NEW.id,'system',
     CASE WHEN TG_OP='INSERT' THEN NEW.assigned_by_identity_id ELSE NEW.revoked_by_identity_id END,
     CASE WHEN TG_OP='INSERT' THEN 'market.operator.assigned' ELSE 'market.operator.assignment_changed' END,
     'success',jsonb_build_object(
       'roleCode',NEW.role_code,
       'reason',CASE WHEN TG_OP='INSERT' THEN NEW.reason ELSE NEW.revocation_reason END,
       'revoked',NEW.revoked_at IS NOT NULL
     ));
  RETURN NEW;
END;
$$;
CREATE TRIGGER market_operator_assignment_audit
AFTER INSERT OR UPDATE ON market_operator_assignments
FOR EACH ROW EXECUTE FUNCTION overva_record_market_operator_assignment();
CREATE TRIGGER market_operator_assignments_no_delete
BEFORE DELETE ON market_operator_assignments
FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

COMMENT ON TABLE market_identities IS
  'Market-owned login identities. No tenant-user or Platform-admin authority is inherited or linked in this slice.';
COMMENT ON TABLE market_memberships IS
  'Customer/provider participation capacities. A membership and selected view never grant Market operator authority.';
COMMENT ON TABLE market_operator_assignments IS
  'Separately attributable and deletion-protected Market operator authority; every assignment change creates Market audit evidence and is never derived from Platform, founder, tenant, or participant roles.';
COMMENT ON TABLE market_audit_events IS
  'Append-only Market identity, membership, operator, and participant-view evidence.';
