-- ERP v2 business modules: organization, inventory, maintenance, procurement,
-- tenant branding and SaaS billing.

ALTER TABLE users ADD CONSTRAINT users_tenant_id_unique UNIQUE (organization_id, id);

CREATE TABLE departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  parent_id UUID,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id), UNIQUE (organization_id, code),
  FOREIGN KEY (organization_id, parent_id) REFERENCES departments(organization_id, id) ON DELETE RESTRICT
);

CREATE TABLE positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  department_id UUID,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  rank_level INTEGER NOT NULL DEFAULT 1 CHECK (rank_level BETWEEN 1 AND 20),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id), UNIQUE (organization_id, code),
  FOREIGN KEY (organization_id, department_id) REFERENCES departments(organization_id, id) ON DELETE RESTRICT
);

ALTER TABLE users ADD COLUMN department_id UUID;
ALTER TABLE users ADD COLUMN position_id UUID;
ALTER TABLE users ADD COLUMN manager_user_id UUID;
ALTER TABLE users ADD CONSTRAINT users_department_tenant_fk FOREIGN KEY (organization_id, department_id) REFERENCES departments(organization_id, id) ON DELETE RESTRICT;
ALTER TABLE users ADD CONSTRAINT users_position_tenant_fk FOREIGN KEY (organization_id, position_id) REFERENCES positions(organization_id, id) ON DELETE RESTRICT;
ALTER TABLE users ADD CONSTRAINT users_manager_tenant_fk FOREIGN KEY (organization_id, manager_user_id) REFERENCES users(organization_id, id) ON DELETE RESTRICT;

CREATE TABLE warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  code TEXT NOT NULL, name TEXT NOT NULL, location TEXT NOT NULL DEFAULT '', active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id), UNIQUE (organization_id, code)
);
CREATE TABLE inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  sku TEXT NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'Бусад', unit TEXT NOT NULL DEFAULT 'ш',
  minimum_stock NUMERIC(16,3) NOT NULL DEFAULT 0 CHECK (minimum_stock >= 0), active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id), UNIQUE (organization_id, sku)
);
CREATE TABLE inventory_balances (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  warehouse_id UUID NOT NULL, item_id UUID NOT NULL, quantity NUMERIC(16,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (organization_id, warehouse_id, item_id),
  FOREIGN KEY (organization_id, warehouse_id) REFERENCES warehouses(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, item_id) REFERENCES inventory_items(organization_id, id) ON DELETE RESTRICT
);
CREATE TABLE stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  item_id UUID NOT NULL, from_warehouse_id UUID, to_warehouse_id UUID,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('receipt','issue','transfer','adjustment_in','adjustment_out')),
  quantity NUMERIC(16,3) NOT NULL CHECK (quantity > 0), reference TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
  created_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, item_id) REFERENCES inventory_items(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, from_warehouse_id) REFERENCES warehouses(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, to_warehouse_id) REFERENCES warehouses(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by) REFERENCES users(organization_id, id) ON DELETE SET NULL
);
CREATE INDEX stock_movements_tenant_time_idx ON stock_movements(organization_id, created_at DESC);

CREATE TABLE maintenance_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  asset_id UUID NOT NULL, title TEXT NOT NULL, instructions TEXT NOT NULL DEFAULT '', frequency_days INTEGER NOT NULL CHECK (frequency_days BETWEEN 1 AND 3650),
  next_due_date DATE NOT NULL, assigned_to UUID, active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, asset_id) REFERENCES assets(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, assigned_to) REFERENCES users(organization_id, id) ON DELETE SET NULL,
  FOREIGN KEY (organization_id, created_by) REFERENCES users(organization_id, id) ON DELETE SET NULL
);
CREATE TABLE maintenance_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  plan_id UUID NOT NULL, work_order_id UUID, completed_by UUID, completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  meter_reading TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', next_due_date DATE NOT NULL,
  FOREIGN KEY (organization_id, plan_id) REFERENCES maintenance_plans(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, work_order_id) REFERENCES work_orders(organization_id, id) ON DELETE SET NULL,
  FOREIGN KEY (organization_id, completed_by) REFERENCES users(organization_id, id) ON DELETE SET NULL
);
CREATE INDEX maintenance_due_idx ON maintenance_plans(organization_id, active, next_due_date);

CREATE TABLE purchase_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  request_no TEXT NOT NULL, title TEXT NOT NULL, justification TEXT NOT NULL DEFAULT '', department_id UUID,
  requested_by UUID, status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected','ordered','received','cancelled')),
  total_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0), currency CHAR(3) NOT NULL DEFAULT 'MNT',
  needed_by DATE, submitted_at TIMESTAMPTZ, decided_at TIMESTAMPTZ, decided_by UUID, decision_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (organization_id, id), UNIQUE (organization_id, request_no),
  FOREIGN KEY (organization_id, department_id) REFERENCES departments(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, requested_by) REFERENCES users(organization_id, id) ON DELETE SET NULL,
  FOREIGN KEY (organization_id, decided_by) REFERENCES users(organization_id, id) ON DELETE SET NULL
);
CREATE TABLE purchase_request_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  request_id UUID NOT NULL, description TEXT NOT NULL, quantity NUMERIC(16,3) NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL DEFAULT 'ш', unit_price NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  FOREIGN KEY (organization_id, request_id) REFERENCES purchase_requests(organization_id, id) ON DELETE CASCADE
);
CREATE TABLE purchase_approval_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  request_id UUID NOT NULL, actor_user_id UUID, action TEXT NOT NULL CHECK (action IN ('created','submitted','approved','rejected','ordered','received','cancelled')),
  note TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, request_id) REFERENCES purchase_requests(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, actor_user_id) REFERENCES users(organization_id, id) ON DELETE SET NULL
);

CREATE TABLE organization_settings (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE RESTRICT,
  short_name TEXT NOT NULL DEFAULT '', logo_url TEXT NOT NULL DEFAULT '', primary_color TEXT NOT NULL DEFAULT '#246bea' CHECK (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  accent_color TEXT NOT NULL DEFAULT '#0f9f6e' CHECK (accent_color ~ '^#[0-9A-Fa-f]{6}$'), address TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
  registration_no TEXT NOT NULL DEFAULT '', updated_by UUID, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO organization_settings(organization_id, short_name) SELECT id, name FROM organizations ON CONFLICT DO NOTHING;

CREATE TABLE plan_catalog (
  code TEXT PRIMARY KEY, name TEXT NOT NULL, monthly_price NUMERIC(18,2) NOT NULL CHECK (monthly_price >= 0),
  user_limit INTEGER NOT NULL CHECK (user_limit > 0), storage_gb INTEGER NOT NULL CHECK (storage_gb > 0), features JSONB NOT NULL DEFAULT '[]'::jsonb, active BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO plan_catalog(code,name,monthly_price,user_limit,storage_gb,features) VALUES
 ('pilot','Туршилтын багц',0,10,2,'["Үндсэн модулиуд","Туршилтын дэмжлэг"]'),
 ('starter','Starter',290000,25,10,'["Бүх үндсэн модуль","10 GB хадгалалт"]'),
 ('business','Business',690000,100,50,'["Бүх модуль","50 GB хадгалалт","Тэргүүлэх дэмжлэг"]')
ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name,monthly_price=EXCLUDED.monthly_price,user_limit=EXCLUDED.user_limit,storage_gb=EXCLUDED.storage_gb,features=EXCLUDED.features;
CREATE TABLE billing_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  invoice_no TEXT NOT NULL UNIQUE, period_start DATE NOT NULL, period_end DATE NOT NULL, due_date DATE NOT NULL,
  amount NUMERIC(18,2) NOT NULL CHECK (amount >= 0), currency CHAR(3) NOT NULL DEFAULT 'MNT',
  status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('draft','issued','paid','overdue','void')),
  paid_at TIMESTAMPTZ, note TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (organization_id,id)
);
CREATE TABLE billing_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  invoice_id UUID NOT NULL, amount NUMERIC(18,2) NOT NULL CHECK (amount > 0), payment_method TEXT NOT NULL DEFAULT 'bank_transfer',
  reference TEXT NOT NULL DEFAULT '', received_at TIMESTAMPTZ NOT NULL DEFAULT now(), recorded_by UUID,
  FOREIGN KEY (organization_id, invoice_id) REFERENCES billing_invoices(organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX billing_invoice_org_due_idx ON billing_invoices(organization_id,due_date DESC);
