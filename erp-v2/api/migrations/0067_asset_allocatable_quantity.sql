-- Asset-master capacity used by Operational Object component allocations.
-- Existing assets are discrete records unless an authorized user changes the
-- master quantity/unit (for example, a 2500 m cable lot).

ALTER TABLE assets
  ADD COLUMN allocatable_quantity NUMERIC(14,3) NOT NULL DEFAULT 1 CHECK(allocatable_quantity>0),
  ADD COLUMN allocation_unit TEXT NOT NULL DEFAULT 'ш' CHECK(length(trim(allocation_unit))>0);

CREATE INDEX operational_object_components_active_asset_quantity_idx
  ON operational_object_components(organization_id,asset_id)
  INCLUDE(quantity,unit) WHERE removed_at IS NULL;
