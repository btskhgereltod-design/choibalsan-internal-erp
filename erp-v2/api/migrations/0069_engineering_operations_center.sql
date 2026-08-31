-- Chief-engineer operational review reuses governed Work Orders as its source
-- of truth. Only the period commentary is stored separately.

CREATE TABLE engineering_monthly_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  review_year INTEGER NOT NULL CHECK(review_year BETWEEN 2000 AND 2200),
  review_month INTEGER NOT NULL CHECK(review_month BETWEEN 1 AND 12),
  summary_note TEXT NOT NULL DEFAULT '',
  issue_note TEXT NOT NULL DEFAULT '',
  resource_note TEXT NOT NULL DEFAULT '',
  next_plan_note TEXT NOT NULL DEFAULT '',
  conclusion_note TEXT NOT NULL DEFAULT '',
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,review_year,review_month),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,updated_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);

CREATE INDEX engineering_monthly_reviews_period_idx
  ON engineering_monthly_reviews(organization_id,review_year DESC,review_month DESC);
