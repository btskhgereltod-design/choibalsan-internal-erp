-- Some legacy unit costs are calculated fractions; retain enough precision to reconcile total value.
ALTER TABLE inventory_items ALTER COLUMN unit_cost TYPE NUMERIC(24,12);
