-- Bounded Digital Storefront foundation. This stores Market service access,
-- not buyer/provider transaction payments, settlement, commission, or escrow.

CREATE TABLE market_storefront_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL CHECK(code ~ '^[a-z][a-z0-9-]{1,39}$'),
  version INTEGER NOT NULL CHECK(version > 0),
  name TEXT NOT NULL CHECK(char_length(name) BETWEEN 2 AND 80),
  description TEXT NOT NULL CHECK(char_length(description) BETWEEN 12 AND 1000),
  price_mnt BIGINT NOT NULL CHECK(price_mnt >= 0),
  billing_period_days INTEGER NOT NULL CHECK(billing_period_days BETWEEN 1 AND 366),
  entitlement_snapshot JSONB NOT NULL CHECK(jsonb_typeof(entitlement_snapshot)='object'),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','retired')),
  created_by_identity_id UUID NOT NULL REFERENCES market_identities(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  retired_at TIMESTAMPTZ,
  UNIQUE(code,version),
  CHECK((status='active' AND retired_at IS NULL) OR (status='retired' AND retired_at IS NOT NULL))
);
CREATE UNIQUE INDEX market_storefront_plans_active_code_idx
  ON market_storefront_plans(code) WHERE status='active';

CREATE TABLE market_storefronts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_identity_id UUID NOT NULL UNIQUE REFERENCES market_identities(id) ON DELETE RESTRICT,
  provider_membership_id UUID NOT NULL UNIQUE REFERENCES market_memberships(id) ON DELETE RESTRICT,
  slug TEXT NOT NULL CHECK(slug ~ '^[a-z0-9][a-z0-9-]{2,59}$'),
  display_name TEXT NOT NULL CHECK(char_length(display_name) BETWEEN 2 AND 120),
  tagline TEXT NOT NULL CHECK(char_length(tagline) BETWEEN 10 AND 180),
  description TEXT NOT NULL CHECK(char_length(description) BETWEEN 40 AND 3000),
  public_contact TEXT CHECK(public_contact IS NULL OR char_length(public_contact) BETWEEN 3 AND 300),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','expired','suspended','closed')),
  suspended_at TIMESTAMPTZ,
  suspension_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK((status='suspended' AND suspended_at IS NOT NULL AND char_length(suspension_reason) BETWEEN 12 AND 1000)
     OR (status<>'suspended' AND suspended_at IS NULL AND suspension_reason IS NULL))
);
CREATE UNIQUE INDEX market_storefronts_slug_idx ON market_storefronts(lower(slug));

CREATE TABLE market_storefront_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  storefront_id UUID NOT NULL REFERENCES market_storefronts(id) ON DELETE RESTRICT,
  plan_id UUID NOT NULL REFERENCES market_storefront_plans(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','expired','suspended','cancelled')),
  external_payment_reference TEXT NOT NULL CHECK(char_length(external_payment_reference) BETWEEN 4 AND 200),
  price_mnt_snapshot BIGINT NOT NULL CHECK(price_mnt_snapshot >= 0),
  billing_period_days_snapshot INTEGER NOT NULL CHECK(billing_period_days_snapshot BETWEEN 1 AND 366),
  entitlement_snapshot JSONB NOT NULL CHECK(jsonb_typeof(entitlement_snapshot)='object'),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  decided_by_identity_id UUID REFERENCES market_identities(id) ON DELETE RESTRICT,
  decision_reason TEXT,
  suspended_at TIMESTAMPTZ,
  suspension_reason TEXT,
  cancelled_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK(
    (status='pending' AND activated_at IS NULL AND expires_at IS NULL AND decided_by_identity_id IS NULL AND decision_reason IS NULL)
    OR
    (status IN ('active','expired','suspended') AND activated_at IS NOT NULL AND expires_at IS NOT NULL
      AND decided_by_identity_id IS NOT NULL AND char_length(decision_reason) BETWEEN 12 AND 1000)
    OR
    (status='cancelled' AND cancelled_at IS NOT NULL)
  ),
  CHECK((status='suspended' AND suspended_at IS NOT NULL AND char_length(suspension_reason) BETWEEN 12 AND 1000)
     OR (status<>'suspended' AND suspended_at IS NULL AND suspension_reason IS NULL))
);
CREATE UNIQUE INDEX market_storefront_subscriptions_open_idx
  ON market_storefront_subscriptions(storefront_id)
  WHERE status IN ('pending','active','suspended');
CREATE INDEX market_storefront_subscriptions_expiry_idx
  ON market_storefront_subscriptions(status,expires_at) WHERE status='active';

CREATE TABLE market_storefront_entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES market_storefront_subscriptions(id) ON DELETE RESTRICT,
  entitlement_code TEXT NOT NULL CHECK(entitlement_code ~ '^[a-z][a-z0-9._-]{1,79}$'),
  entitlement_value JSONB NOT NULL,
  valid_from TIMESTAMPTZ NOT NULL,
  valid_until TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  UNIQUE(subscription_id,entitlement_code),
  CHECK(valid_until > valid_from)
);

ALTER TABLE market_audit_events
  ADD COLUMN storefront_plan_id UUID REFERENCES market_storefront_plans(id) ON DELETE RESTRICT,
  ADD COLUMN storefront_id UUID REFERENCES market_storefronts(id) ON DELETE RESTRICT,
  ADD COLUMN storefront_subscription_id UUID REFERENCES market_storefront_subscriptions(id) ON DELETE RESTRICT;
CREATE INDEX market_audit_storefront_time_idx ON market_audit_events(storefront_id,created_at DESC);
CREATE INDEX market_audit_subscription_time_idx ON market_audit_events(storefront_subscription_id,created_at DESC);

CREATE OR REPLACE FUNCTION overva_validate_market_storefront_transition()
RETURNS trigger AS $$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF (OLD.status='draft' AND NEW.status IN ('active','suspended','closed'))
    OR (OLD.status='active' AND NEW.status IN ('expired','suspended','closed'))
    OR (OLD.status='expired' AND NEW.status IN ('active','suspended','closed'))
    OR (OLD.status='suspended' AND NEW.status IN ('active','closed')) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'invalid market storefront transition: % -> %', OLD.status, NEW.status;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION overva_validate_market_storefront_subscription_transition()
RETURNS trigger AS $$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF (OLD.status='pending' AND NEW.status IN ('active','cancelled'))
    OR (OLD.status='active' AND NEW.status IN ('expired','suspended','cancelled'))
    OR (OLD.status='suspended' AND NEW.status IN ('active','expired','cancelled')) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'invalid market storefront subscription transition: % -> %', OLD.status, NEW.status;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER market_storefronts_transition_guard BEFORE UPDATE OF status ON market_storefronts
FOR EACH ROW EXECUTE FUNCTION overva_validate_market_storefront_transition();
CREATE TRIGGER market_storefront_subscriptions_transition_guard BEFORE UPDATE OF status ON market_storefront_subscriptions
FOR EACH ROW EXECUTE FUNCTION overva_validate_market_storefront_subscription_transition();

CREATE TRIGGER market_storefront_plans_no_delete BEFORE DELETE ON market_storefront_plans
FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();
CREATE TRIGGER market_storefronts_no_delete BEFORE DELETE ON market_storefronts
FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();
CREATE TRIGGER market_storefront_subscriptions_no_delete BEFORE DELETE ON market_storefront_subscriptions
FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();
CREATE TRIGGER market_storefront_entitlements_no_delete BEFORE DELETE ON market_storefront_entitlements
FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

COMMENT ON TABLE market_storefront_subscriptions IS
  'Access to OVERVA Market storefront service only; never evidence of buyer/provider payment or settlement.';
COMMENT ON TABLE market_storefront_entitlements IS
  'Versioned subscription grants. Future listing usage must consume these grants without creating transaction-payment authority.';
