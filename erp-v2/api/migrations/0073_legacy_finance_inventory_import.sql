-- Reviewed legacy finance/inventory facts remain tenant scoped and retain immutable provenance.

ALTER TABLE inventory_items
  ADD COLUMN unit_cost NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK(unit_cost >= 0);

CREATE TABLE accounting_fixed_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  asset_code TEXT NOT NULL,
  asset_name TEXT NOT NULL,
  account_code TEXT NOT NULL DEFAULT '',
  acquisition_date DATE NOT NULL,
  unit TEXT NOT NULL DEFAULT 'ш',
  quantity NUMERIC(16,3) NOT NULL DEFAULT 1,
  initial_value NUMERIC(20,2) NOT NULL DEFAULT 0,
  accumulated_depreciation NUMERIC(20,2) NOT NULL DEFAULT 0,
  book_value NUMERIC(20,2) NOT NULL DEFAULT 0,
  useful_life_months INTEGER,
  depreciation_method TEXT NOT NULL DEFAULT '',
  last_depreciation_date DATE,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id)
);
CREATE INDEX accounting_fixed_assets_org_code_idx
  ON accounting_fixed_assets(organization_id,asset_code);

INSERT INTO data_catalog_assets(code,name,domain,source_object,description,classification_code,owner_role_code)
VALUES
('accounting-fixed-asset','Үндсэн хөрөнгийн санхүүгийн бүртгэл','finance','accounting_fixed_assets','Үндсэн өртөг, хуримтлагдсан элэгдэл, үлдэгдэл өртгийн нягтлан бодох бүртгэл','restricted','finance-accountant')
ON CONFLICT(code) DO NOTHING;
