ALTER TABLE users
  ADD CONSTRAINT users_organization_id_id_unique UNIQUE (organization_id, id);

ALTER TABLE work_orders
  DROP CONSTRAINT work_orders_assigned_to_fkey;

ALTER TABLE work_orders
  ADD CONSTRAINT work_orders_assignee_tenant_fk
  FOREIGN KEY (organization_id, assigned_to)
  REFERENCES users (organization_id, id)
  ON DELETE RESTRICT;

CREATE TABLE work_order_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  work_order_id UUID NOT NULL,
  actor_user_id UUID,
  event_type TEXT NOT NULL CHECK (event_type IN ('created', 'assigned', 'status_changed', 'note')),
  from_status TEXT,
  to_status TEXT,
  note TEXT,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT work_order_events_order_tenant_fk
    FOREIGN KEY (organization_id, work_order_id)
    REFERENCES work_orders (organization_id, id)
    ON DELETE CASCADE,
  CONSTRAINT work_order_events_actor_tenant_fk
    FOREIGN KEY (organization_id, actor_user_id)
    REFERENCES users (organization_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX work_order_events_tenant_order_time_idx
  ON work_order_events (organization_id, work_order_id, created_at DESC);
