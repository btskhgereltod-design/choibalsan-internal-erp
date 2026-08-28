-- Tenant-scoped OAuth connector accounts for OVERVA Connect V1.
-- Provider definitions remain source-controlled product metadata; this migration
-- stores only tenant authorization state, encrypted credentials and audit events.

CREATE TABLE connector_oauth_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL,
  provider_code TEXT NOT NULL CHECK(provider_code ~ '^[a-z0-9-]{2,60}$'),
  state_sha256 CHAR(64) NOT NULL UNIQUE,
  return_path TEXT NOT NULL DEFAULT '/?view=connectors'
    CHECK(return_path ~ '^/[A-Za-z0-9?&=_#%./-]*$'),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,user_id) REFERENCES users(organization_id,id) ON DELETE CASCADE
);
CREATE INDEX connector_oauth_states_expiry_idx ON connector_oauth_states(expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE connector_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  provider_code TEXT NOT NULL CHECK(provider_code ~ '^[a-z0-9-]{2,60}$'),
  status TEXT NOT NULL DEFAULT 'connected'
    CHECK(status IN('connected','attention','disconnected')),
  external_account_id TEXT NOT NULL,
  external_account_name TEXT NOT NULL DEFAULT '',
  granted_scopes TEXT[] NOT NULL DEFAULT '{}',
  token_ciphertext TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ,
  last_error_code TEXT NOT NULL DEFAULT '',
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,provider_code),
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,updated_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX connector_connections_tenant_status_idx
  ON connector_connections(organization_id,status,provider_code);

CREATE TABLE connector_connection_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  connection_id UUID NOT NULL,
  action TEXT NOT NULL CHECK(action IN('connected','reconnected','checked','attention','disconnected')),
  actor_user_id UUID,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,connection_id)
    REFERENCES connector_connections(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,actor_user_id)
    REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX connector_connection_events_tenant_idx
  ON connector_connection_events(organization_id,connection_id,created_at DESC,id DESC);
CREATE TRIGGER connector_connection_events_append_only BEFORE UPDATE OR DELETE ON connector_connection_events
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

INSERT INTO permission_catalog(code,name,module_code,description) VALUES
('connectors.manage','Холболт удирдах','core-work','Байгууллагын гадаад үйлчилгээний OAuth холболтыг холбох, шалгах, салгах')
ON CONFLICT(code) DO NOTHING;

INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
SELECT r.organization_id,r.id,'connectors.manage'
FROM organization_roles r
WHERE r.code IN('owner','administrator')
ON CONFLICT DO NOTHING;

-- Policies are defined now but intentionally remain disabled until the API's
-- transaction-scoped app.organization_id rollout is complete (see migration
-- 0032). Route queries and composite tenant foreign keys enforce V1 isolation.
CREATE POLICY connector_oauth_states_tenant_policy ON connector_oauth_states
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY connector_connections_tenant_policy ON connector_connections
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY connector_connection_events_tenant_policy ON connector_connection_events
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());

COMMENT ON TABLE connector_connections IS
  'One tenant-owned OAuth connection per provider; token_ciphertext must only be decrypted inside the API process.';
