-- Preserve reviewed source precision; presentation may still round monetary values for people.
ALTER TABLE inventory_items ALTER COLUMN unit_cost TYPE NUMERIC(18,6);
ALTER TABLE accounting_fixed_assets ALTER COLUMN initial_value TYPE NUMERIC(20,6);
ALTER TABLE accounting_fixed_assets ALTER COLUMN accumulated_depreciation TYPE NUMERIC(20,6);
ALTER TABLE accounting_fixed_assets ALTER COLUMN book_value TYPE NUMERIC(20,6);
