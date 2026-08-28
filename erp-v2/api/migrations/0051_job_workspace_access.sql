CREATE TABLE job_workspace_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  job_id UUID NOT NULL,
  workspace_code TEXT NOT NULL CHECK (workspace_code ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  access_level TEXT NOT NULL DEFAULT 'use'
    CHECK (access_level IN ('view', 'use', 'manage', 'approve')),
  source TEXT NOT NULL DEFAULT 'manual',
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, job_id, workspace_code),
  FOREIGN KEY (organization_id, job_id)
    REFERENCES jobs(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX job_workspace_access_org_job_idx
  ON job_workspace_access (organization_id, job_id)
  WHERE active = true;

COMMENT ON TABLE job_workspace_access IS
  'Tenant-scoped mapping from reusable job definitions to product workspaces. It does not replace RBAC.';
