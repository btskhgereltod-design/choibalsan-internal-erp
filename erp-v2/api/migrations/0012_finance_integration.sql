-- Tenant-isolated finance integration hub, accounts, imports and budgets.

CREATE TABLE finance_connectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  connector_type TEXT NOT NULL CHECK (connector_type IN ('csv','xlsx','api','bank','accounting')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','error')),
  field_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id),
  UNIQUE (organization_id,code),
  FOREIGN KEY (organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);

CREATE TABLE finance_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('cash','bank','receivable','payable','revenue','expense','asset','liability','equity')),
  currency CHAR(3) NOT NULL DEFAULT 'MNT',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id),
  UNIQUE (organization_id,code)
);

CREATE TABLE finance_import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  connector_id UUID NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','completed','partial','failed')),
  source_file_name TEXT NOT NULL,
  file_checksum CHAR(64) NOT NULL,
  rows_received INTEGER NOT NULL DEFAULT 0,
  rows_imported INTEGER NOT NULL DEFAULT 0,
  rows_rejected INTEGER NOT NULL DEFAULT 0,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (organization_id,id),
  UNIQUE (organization_id,file_checksum),
  FOREIGN KEY (organization_id,connector_id) REFERENCES finance_connectors(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);

CREATE TABLE finance_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  connector_id UUID NOT NULL,
  import_job_id UUID NOT NULL,
  account_id UUID NOT NULL,
  external_id TEXT NOT NULL,
  transaction_date DATE NOT NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('income','expense','receivable','payable','transfer','adjustment')),
  amount NUMERIC(18,2) NOT NULL CHECK (amount >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'MNT',
  counterparty TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  reference TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id),
  UNIQUE (organization_id,connector_id,external_id),
  FOREIGN KEY (organization_id,connector_id) REFERENCES finance_connectors(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,import_job_id) REFERENCES finance_import_jobs(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,account_id) REFERENCES finance_accounts(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX finance_transactions_date_idx ON finance_transactions(organization_id,transaction_date DESC);
CREATE INDEX finance_transactions_type_idx ON finance_transactions(organization_id,transaction_type,transaction_date DESC);

CREATE TABLE finance_budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  category TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  planned_amount NUMERIC(18,2) NOT NULL CHECK (planned_amount >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'MNT',
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id),
  CHECK (period_end >= period_start),
  FOREIGN KEY (organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);

INSERT INTO finance_connectors(organization_id,code,name,connector_type)
SELECT id,'FILE-IMPORT','Excel / CSV импорт','csv' FROM organizations
ON CONFLICT (organization_id,code) DO NOTHING;
