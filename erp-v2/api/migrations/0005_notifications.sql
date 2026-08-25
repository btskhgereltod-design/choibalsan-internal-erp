CREATE TABLE notifications (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('work_assigned', 'review_requested', 'work_completed')),
  title TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  entity_type TEXT NOT NULL DEFAULT 'work_order',
  entity_id TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT notifications_user_tenant_fk
    FOREIGN KEY (organization_id, user_id)
    REFERENCES users (organization_id, id)
    ON DELETE CASCADE
);

CREATE INDEX notifications_user_unread_time_idx
  ON notifications (organization_id, user_id, read_at, created_at DESC);
