-- OVERVA customer journey: evidence-backed growth milestones.
-- Profiles hold the current reviewed facts; events are immutable evidence.

CREATE TABLE organization_growth_profiles (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE RESTRICT,
  acquisition_source TEXT NOT NULL DEFAULT 'self_service'
    CHECK (acquisition_source IN ('self_service','referral','sales','partner','import','platform_admin','other')),
  referral_source_organization_id UUID REFERENCES organizations(id) ON DELETE RESTRICT,
  internal_champion_user_id UUID,
  go_live_at TIMESTAMPTZ,
  champion_identified_at TIMESTAMPTZ,
  referral_recorded_at TIMESTAMPTZ,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id,internal_champion_user_id)
    REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  CHECK (referral_source_organization_id IS NULL OR referral_source_organization_id<>organization_id)
);

CREATE TABLE organization_growth_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'discovery_started','blueprint_ready','pilot_started','first_value',
    'go_live','paid_usage','champion_identified','referral_recorded','journey_note'
  )),
  source TEXT NOT NULL CHECK (source IN ('system','tenant','platform_admin','billing')),
  actor_user_id UUID,
  platform_admin_id UUID REFERENCES platform_admins(id) ON DELETE RESTRICT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id,actor_user_id)
    REFERENCES users(organization_id,id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX organization_growth_event_idempotency_idx
  ON organization_growth_events(organization_id,idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX organization_growth_event_stage_idx
  ON organization_growth_events(event_type,occurred_at DESC);
CREATE INDEX organization_growth_event_tenant_idx
  ON organization_growth_events(organization_id,occurred_at DESC);

CREATE TRIGGER organization_growth_events_append_only
BEFORE UPDATE OR DELETE ON organization_growth_events
FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

INSERT INTO organization_growth_profiles(organization_id,acquisition_source)
SELECT id,'import' FROM organizations ON CONFLICT DO NOTHING;

COMMENT ON TABLE organization_growth_events IS
  'Immutable evidence for Discovery -> Blueprint -> Pilot -> First Value -> Go-live -> Paid Usage -> Champion -> Referral.';
COMMENT ON COLUMN organization_growth_profiles.go_live_at IS
  'Explicitly confirmed operational go-live; never inferred from login or trial creation.';
