ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN ('work_assigned','review_requested','work_completed','automation_alert'));

CREATE TABLE automation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name TEXT NOT NULL, event_type TEXT NOT NULL, conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
  action_type TEXT NOT NULL CHECK(action_type IN ('notification','create_work_order')),
  action_config JSONB NOT NULL DEFAULT '{}'::jsonb, active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id), FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX automation_rules_event_idx ON automation_rules(organization_id,event_type,active);

CREATE TABLE automation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL, payload JSONB NOT NULL DEFAULT '{}'::jsonb, source_entity_type TEXT NOT NULL DEFAULT '',
  source_entity_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(organization_id,id)
);
CREATE INDEX automation_events_time_idx ON automation_events(organization_id,created_at DESC);

CREATE TABLE automation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  rule_id UUID NOT NULL, event_id UUID NOT NULL, status TEXT NOT NULL CHECK(status IN ('completed','failed','skipped')),
  result JSONB NOT NULL DEFAULT '{}'::jsonb, error_message TEXT NOT NULL DEFAULT '', executed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id), FOREIGN KEY(organization_id,rule_id) REFERENCES automation_rules(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY(organization_id,event_id) REFERENCES automation_events(organization_id,id) ON DELETE CASCADE
);
CREATE INDEX automation_runs_time_idx ON automation_runs(organization_id,executed_at DESC);
