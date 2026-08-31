-- Inventory quantities may arrive as measured fractions, not only three-decimal counts.
ALTER TABLE inventory_items ALTER COLUMN minimum_stock TYPE NUMERIC(20,6);
ALTER TABLE inventory_balances ALTER COLUMN quantity TYPE NUMERIC(20,6);
ALTER TABLE stock_movements ALTER COLUMN quantity TYPE NUMERIC(20,6);
