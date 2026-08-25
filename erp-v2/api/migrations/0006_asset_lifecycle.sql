ALTER TABLE assets
  ADD COLUMN serial_number TEXT,
  ADD COLUMN location TEXT NOT NULL DEFAULT '',
  ADD COLUMN responsible_user_id UUID,
  ADD COLUMN acquired_at DATE,
  ADD COLUMN notes TEXT NOT NULL DEFAULT '';

ALTER TABLE assets
  ADD CONSTRAINT assets_responsible_tenant_fk
  FOREIGN KEY (organization_id, responsible_user_id)
  REFERENCES users (organization_id, id)
  ON DELETE RESTRICT;

CREATE TABLE asset_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  asset_id UUID NOT NULL,
  actor_user_id UUID,
  event_type TEXT NOT NULL CHECK (event_type IN ('created', 'updated')),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT asset_events_asset_tenant_fk
    FOREIGN KEY (organization_id, asset_id)
    REFERENCES assets (organization_id, id)
    ON DELETE CASCADE,
  CONSTRAINT asset_events_actor_tenant_fk
    FOREIGN KEY (organization_id, actor_user_id)
    REFERENCES users (organization_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX asset_events_tenant_asset_time_idx
  ON asset_events (organization_id, asset_id, created_at DESC);
