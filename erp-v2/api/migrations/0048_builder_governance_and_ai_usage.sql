-- Govern AI-assisted builds and externally accelerated module work without
-- allowing an AI provider to publish directly into a tenant environment.

ALTER TABLE ai_agent_sessions
  ADD COLUMN operation_mode TEXT NOT NULL DEFAULT 'advisory'
    CHECK(operation_mode IN ('advisory','build','repair'));

ALTER TABLE builder_builds
  ADD COLUMN build_kind TEXT NOT NULL DEFAULT 'build'
    CHECK(build_kind IN ('build','repair','restore'));

CREATE TABLE module_manifests (
  module_code TEXT PRIMARY KEY REFERENCES module_catalog(code) ON DELETE RESTRICT,
  manifest_version INTEGER NOT NULL DEFAULT 1 CHECK(manifest_version > 0),
  lifecycle_status TEXT NOT NULL DEFAULT 'draft'
    CHECK(lifecycle_status IN ('draft','pilot','verified','deprecated')),
  route_prefix TEXT NOT NULL UNIQUE CHECK(route_prefix LIKE '/api/%'),
  manifest JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK(jsonb_typeof(manifest)='object'),
  CHECK(jsonb_typeof(manifest->'permissions')='array'),
  CHECK(jsonb_typeof(manifest->'entities')='array'),
  CHECK(jsonb_typeof(manifest->'auditEvents')='array'),
  CHECK(jsonb_typeof(manifest->'navigation')='array'),
  CHECK(jsonb_typeof(manifest->'dependencies')='array')
);

CREATE TABLE platform_route_registry (
  route_prefix TEXT PRIMARY KEY CHECK(route_prefix LIKE '/%'),
  owner_type TEXT NOT NULL CHECK(owner_type IN ('platform','module','service')),
  owner_code TEXT NOT NULL,
  surface TEXT NOT NULL CHECK(surface IN ('web','api','admin','internal')),
  reserved BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO platform_route_registry(route_prefix,owner_type,owner_code,surface,reserved,description) VALUES
('/api/auth','platform','authentication','api',true,'Tenant authentication'),
('/api/platform','platform','platform-admin','admin',true,'Platform administration API'),
('/api/builder','platform','overva-builder','api',true,'Governed tenant builder API'),
('/health','service','health','internal',true,'Service health probe')
ON CONFLICT(route_prefix) DO NOTHING;

CREATE TABLE ai_usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE RESTRICT,
  session_id UUID,
  message_id UUID,
  provider TEXT NOT NULL CHECK(provider IN ('openai','hercules','other')),
  operation_mode TEXT NOT NULL CHECK(operation_mode IN ('advisory','build','repair','design','review')),
  model TEXT,
  provider_response_id TEXT,
  input_tokens BIGINT NOT NULL DEFAULT 0 CHECK(input_tokens >= 0),
  cached_input_tokens BIGINT NOT NULL DEFAULT 0 CHECK(cached_input_tokens >= 0),
  output_tokens BIGINT NOT NULL DEFAULT 0 CHECK(output_tokens >= 0),
  reasoning_tokens BIGINT NOT NULL DEFAULT 0 CHECK(reasoning_tokens >= 0),
  total_tokens BIGINT NOT NULL DEFAULT 0 CHECK(total_tokens >= 0),
  external_credits NUMERIC(18,4) CHECK(external_credits IS NULL OR external_credits >= 0),
  outcome TEXT NOT NULL DEFAULT 'success' CHECK(outcome IN ('success','error','accepted','rejected','partial')),
  scope TEXT NOT NULL DEFAULT '',
  artifact_reference TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(metadata)='object'),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,session_id) REFERENCES ai_agent_sessions(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,message_id) REFERENCES ai_agent_messages(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);

CREATE INDEX ai_usage_events_org_time_idx ON ai_usage_events(organization_id,created_at DESC);
CREATE INDEX ai_usage_events_provider_time_idx ON ai_usage_events(provider,created_at DESC);

CREATE OR REPLACE FUNCTION overva_reject_ai_usage_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AI usage events are immutable';
END $$;

CREATE TRIGGER ai_usage_events_immutable
BEFORE UPDATE OR DELETE ON ai_usage_events
FOR EACH ROW EXECUTE FUNCTION overva_reject_ai_usage_mutation();

