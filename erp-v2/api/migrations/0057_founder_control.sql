-- Founder-led operations without a universal cross-business super-admin.
-- Apps and Market remain separate, unimplemented authorization boundaries.

INSERT INTO platform_permission_catalog(code,name,description) VALUES
('platform.founder.read','Founder control read','Read founder capability boundaries and recovery readiness'),
('platform.support-access.manage','Tenant support access manage','Issue, inspect, and revoke short-lived diagnostic support grants')
ON CONFLICT(code) DO NOTHING;

INSERT INTO platform_admin_roles(code,name,description,system) VALUES
('founder-operator','Founder operator','Founder-led Platform development and operations; never grants Apps or Market operator authority',true)
ON CONFLICT(code) DO NOTHING;

INSERT INTO platform_admin_role_permissions(role_id,permission_code)
SELECT role.id,permission.code
FROM platform_admin_roles role
CROSS JOIN platform_permission_catalog permission
WHERE role.code='founder-operator'
ON CONFLICT DO NOTHING;

INSERT INTO platform_admin_role_permissions(role_id,permission_code)
SELECT role.id,permission.code
FROM platform_admin_roles role
JOIN platform_permission_catalog permission ON permission.code IN(
  'platform.founder.read','platform.support-access.manage'
)
WHERE role.code='platform-owner'
ON CONFLICT DO NOTHING;

-- In the current founder-led deployment, the oldest active administrator is
-- the attributable founder operator. This does not assign future admins.
INSERT INTO platform_admin_role_assignments(platform_admin_id,role_id,assigned_by)
SELECT admin.id,role.id,admin.id
FROM platform_admins admin
JOIN platform_admin_roles role ON role.code='founder-operator'
WHERE admin.id=(SELECT id FROM platform_admins WHERE active=true ORDER BY created_at,id LIMIT 1)
ON CONFLICT(platform_admin_id,role_id) WHERE revoked_at IS NULL DO NOTHING;

CREATE TABLE platform_support_access_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_admin_id UUID NOT NULL REFERENCES platform_admins(id) ON DELETE RESTRICT,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK(char_length(reason) BETWEEN 12 AND 1000),
  scopes TEXT[] NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES platform_admins(id) ON DELETE RESTRICT,
  CHECK(cardinality(scopes) BETWEEN 1 AND 3),
  CHECK(scopes <@ ARRAY['diagnostics','configuration','audit']::text[]),
  CHECK(expires_at > issued_at AND expires_at <= issued_at + interval '60 minutes'),
  CHECK((revoked_at IS NULL AND revoked_by IS NULL) OR
        (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revoked_at >= issued_at))
);
CREATE INDEX platform_support_access_grants_admin_time_idx
  ON platform_support_access_grants(platform_admin_id,issued_at DESC);
CREATE INDEX platform_support_access_grants_org_time_idx
  ON platform_support_access_grants(organization_id,issued_at DESC);

CREATE TABLE platform_support_access_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  grant_id UUID NOT NULL REFERENCES platform_support_access_grants(id) ON DELETE RESTRICT,
  platform_admin_id UUID NOT NULL REFERENCES platform_admins(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK(event_type IN('issued','snapshot_read','revoked','expired_denied')),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX platform_support_access_events_grant_time_idx
  ON platform_support_access_events(grant_id,created_at DESC);
CREATE TRIGGER platform_support_access_events_append_only
BEFORE UPDATE OR DELETE ON platform_support_access_events
FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

COMMENT ON TABLE platform_support_access_grants IS
  'Short-lived, reason-bound Platform diagnostic grants. A grant never creates a tenant user or bypasses tenant APIs.';
COMMENT ON TABLE platform_support_access_events IS
  'Append-only evidence for every support grant lifecycle and diagnostic read.';
