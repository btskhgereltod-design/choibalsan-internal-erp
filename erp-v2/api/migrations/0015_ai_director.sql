CREATE TABLE executive_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  period_start DATE NOT NULL, period_end DATE NOT NULL, headline TEXT NOT NULL, health_score INTEGER NOT NULL CHECK(health_score BETWEEN 0 AND 100),
  snapshot JSONB NOT NULL, recommendations JSONB NOT NULL DEFAULT '[]'::jsonb, generated_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,generated_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX executive_briefs_time_idx ON executive_briefs(organization_id,created_at DESC);
