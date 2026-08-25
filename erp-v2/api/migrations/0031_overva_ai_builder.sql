-- OVERVA AI assists analysis and proposes catalog configurations. It never
-- applies a build directly; deterministic validation and human approval remain mandatory.

CREATE TABLE IF NOT EXISTS ai_agent_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id UUID,
  agent_type TEXT NOT NULL CHECK(agent_type IN ('ba_builder','developer','design','data_analyst')),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','archived')),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,project_id) REFERENCES builder_projects(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS ai_agent_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  session_id UUID NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
  content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 12000),
  model TEXT,
  provider_response_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,session_id) REFERENCES ai_agent_sessions(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS ai_builder_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  session_id UUID NOT NULL,
  message_id UUID NOT NULL,
  proposal JSONB NOT NULL,
  deterministic_validation JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','accepted','rejected','expired')),
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,session_id) REFERENCES ai_agent_sessions(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,message_id) REFERENCES ai_agent_messages(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,reviewed_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS ai_agent_sessions_org_idx ON ai_agent_sessions(organization_id,agent_type,updated_at DESC);
CREATE INDEX IF NOT EXISTS ai_agent_messages_session_idx ON ai_agent_messages(organization_id,session_id,created_at);
CREATE INDEX IF NOT EXISTS ai_builder_proposals_session_idx ON ai_builder_proposals(organization_id,session_id,created_at DESC);

-- Conversation evidence and AI proposals are append-only. Status review fields
-- are the only allowed proposal mutation and are changed by a controlled API.
CREATE OR REPLACE FUNCTION overva_reject_ai_message_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AI conversation messages are immutable';
END $$;
DROP TRIGGER IF EXISTS ai_agent_messages_immutable ON ai_agent_messages;
CREATE TRIGGER ai_agent_messages_immutable
BEFORE UPDATE OR DELETE ON ai_agent_messages FOR EACH ROW EXECUTE FUNCTION overva_reject_ai_message_mutation();
