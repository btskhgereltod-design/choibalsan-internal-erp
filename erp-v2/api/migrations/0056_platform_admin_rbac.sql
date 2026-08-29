-- Bounded RBAC for the existing OVERVA Platform control plane.
-- This migration does not create Group, OVERVA Apps, or Market permissions.

CREATE TABLE platform_permission_catalog (
  code TEXT PRIMARY KEY CHECK(code ~ '^platform\.[a-z0-9-]+\.[a-z0-9-]+$'),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE platform_admin_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE CHECK(code ~ '^[a-z0-9-]{2,80}$'),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  system BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE platform_admin_role_permissions (
  role_id UUID NOT NULL REFERENCES platform_admin_roles(id) ON DELETE RESTRICT,
  permission_code TEXT NOT NULL REFERENCES platform_permission_catalog(code) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(role_id,permission_code)
);

CREATE TABLE platform_admin_role_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_admin_id UUID NOT NULL REFERENCES platform_admins(id) ON DELETE RESTRICT,
  role_id UUID NOT NULL REFERENCES platform_admin_roles(id) ON DELETE RESTRICT,
  assigned_by UUID REFERENCES platform_admins(id) ON DELETE RESTRICT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_by UUID REFERENCES platform_admins(id) ON DELETE RESTRICT,
  revoked_at TIMESTAMPTZ,
  CHECK((revoked_at IS NULL AND revoked_by IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL))
);
CREATE UNIQUE INDEX platform_admin_role_assignments_active_idx
  ON platform_admin_role_assignments(platform_admin_id,role_id)
  WHERE revoked_at IS NULL;
CREATE INDEX platform_admin_role_assignments_admin_idx
  ON platform_admin_role_assignments(platform_admin_id,assigned_at DESC);

INSERT INTO platform_permission_catalog(code,name,description) VALUES
('platform.operations.read','Platform operations read','Read command-center and aggregate operational signals'),
('platform.system.read','Platform system read','Read service, database, backup, and governance health'),
('platform.organizations.read','Organization control read','Read tenant lifecycle and aggregate control state without tenant-private rows'),
('platform.organizations.manage','Organization control manage','Provision organizations and change organization/subscription lifecycle'),
('platform.adoption.read','Adoption read','Read aggregate customer-journey and time-to-value evidence'),
('platform.adoption.manage','Adoption manage','Record attributable customer-journey milestones'),
('platform.catalog.validate','Catalog validate','Validate governed module manifests without publishing them'),
('platform.ai-knowledge.read','AI knowledge read','Read governed methods, sources, coverage, and anonymized candidates'),
('platform.ai-knowledge.manage','AI knowledge manage','Approve methods and review anonymized knowledge candidates'),
('platform.ai-usage.read','AI usage read','Read governed Platform AI usage and external build-cost evidence'),
('platform.ai-usage.manage','AI usage manage','Record attributable external AI build-cost evidence'),
('platform.billing.read','Platform billing read','Read plan, invoice, receivable, and payment summaries'),
('platform.billing.manage','Platform billing manage','Issue invoices and record reconciled payments')
ON CONFLICT(code) DO NOTHING;

INSERT INTO platform_admin_roles(code,name,description,system) VALUES
('platform-owner','Platform owner','Backward-compatible full Platform control; never grants Apps or Market access',true),
('platform-observer','Platform observer','Read-only aggregate Platform operations, organizations, adoption, governance, AI usage, and billing',true),
('tenant-operator','Tenant operations','Operate organization lifecycle and adoption without system, AI-governance, or billing mutation',true),
('reliability-operator','Reliability operations','Read Platform command center, system health, and organization control state',true),
('ai-governance','AI governance','Review governed AI knowledge, usage, and module manifests',true),
('billing-operator','Platform billing','Read and operate Platform invoices and reconciled payments',true)
ON CONFLICT(code) DO NOTHING;

INSERT INTO platform_admin_role_permissions(role_id,permission_code)
SELECT role.id,permission.code
FROM platform_admin_roles role
CROSS JOIN platform_permission_catalog permission
WHERE role.code='platform-owner'
ON CONFLICT DO NOTHING;

INSERT INTO platform_admin_role_permissions(role_id,permission_code)
SELECT role.id,permission.code
FROM platform_admin_roles role
JOIN platform_permission_catalog permission ON permission.code IN(
  'platform.operations.read','platform.system.read','platform.organizations.read',
  'platform.adoption.read','platform.ai-knowledge.read','platform.ai-usage.read',
  'platform.billing.read'
)
WHERE role.code='platform-observer'
ON CONFLICT DO NOTHING;

INSERT INTO platform_admin_role_permissions(role_id,permission_code)
SELECT role.id,permission.code
FROM platform_admin_roles role
JOIN platform_permission_catalog permission ON permission.code IN(
  'platform.operations.read','platform.organizations.read','platform.organizations.manage',
  'platform.adoption.read','platform.adoption.manage'
)
WHERE role.code='tenant-operator'
ON CONFLICT DO NOTHING;

INSERT INTO platform_admin_role_permissions(role_id,permission_code)
SELECT role.id,permission.code
FROM platform_admin_roles role
JOIN platform_permission_catalog permission ON permission.code IN(
  'platform.operations.read','platform.system.read','platform.organizations.read'
)
WHERE role.code='reliability-operator'
ON CONFLICT DO NOTHING;

INSERT INTO platform_admin_role_permissions(role_id,permission_code)
SELECT role.id,permission.code
FROM platform_admin_roles role
JOIN platform_permission_catalog permission ON permission.code IN(
  'platform.ai-knowledge.read','platform.ai-knowledge.manage',
  'platform.ai-usage.read','platform.ai-usage.manage','platform.catalog.validate'
)
WHERE role.code='ai-governance'
ON CONFLICT DO NOTHING;

INSERT INTO platform_admin_role_permissions(role_id,permission_code)
SELECT role.id,permission.code
FROM platform_admin_roles role
JOIN platform_permission_catalog permission ON permission.code IN(
  'platform.billing.read','platform.billing.manage','platform.organizations.read'
)
WHERE role.code='billing-operator'
ON CONFLICT DO NOTHING;

-- Preserve all existing Platform admin access during the RBAC rollout.
INSERT INTO platform_admin_role_assignments(platform_admin_id,role_id,assigned_by)
SELECT admin.id,role.id,admin.id
FROM platform_admins admin
JOIN platform_admin_roles role ON role.code='platform-owner'
WHERE admin.active=true
ON CONFLICT(platform_admin_id,role_id) WHERE revoked_at IS NULL DO NOTHING;

COMMENT ON TABLE platform_admin_role_assignments IS
  'Platform-only attributable role assignments; Group, Apps, and Market identities remain separate boundaries.';
