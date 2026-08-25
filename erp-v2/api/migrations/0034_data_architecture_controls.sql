-- Tenant-scoped data architecture and recovery requirements.
-- These controls describe ownership and service expectations; they never let a
-- tenant alter the physical database schema or another tenant's configuration.

CREATE TABLE organization_data_asset_controls (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  asset_code TEXT NOT NULL REFERENCES data_catalog_assets(code) ON DELETE RESTRICT,
  authoritative_system TEXT NOT NULL,
  update_policy TEXT NOT NULL DEFAULT 'overva_only'
    CHECK(update_policy IN ('overva_only','source_only','bidirectional','manual_review')),
  history_strategy TEXT NOT NULL DEFAULT 'audit'
    CHECK(history_strategy IN ('audit','event','snapshot','archive','none')),
  criticality TEXT NOT NULL DEFAULT 'standard'
    CHECK(criticality IN ('standard','important','critical')),
  availability_class TEXT NOT NULL DEFAULT 'standard'
    CHECK(availability_class IN ('standard','high','mission_critical')),
  recovery_point_minutes INTEGER CHECK(recovery_point_minutes IS NULL OR recovery_point_minutes > 0),
  recovery_time_minutes INTEGER CHECK(recovery_time_minutes IS NULL OR recovery_time_minutes > 0),
  archive_tier TEXT NOT NULL DEFAULT 'standard'
    CHECK(archive_tier IN ('standard','warm','cold','offline')),
  notes TEXT NOT NULL DEFAULT '',
  updated_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,asset_code),
  FOREIGN KEY(organization_id,updated_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  CHECK(length(trim(authoritative_system)) BETWEEN 1 AND 200)
);

CREATE INDEX organization_data_asset_controls_risk_idx
  ON organization_data_asset_controls(organization_id,criticality,availability_class);

COMMENT ON TABLE organization_data_asset_controls IS
  'Tenant-specific system-of-record, update ownership, history, criticality and recovery requirements for catalog assets.';

CREATE POLICY organization_data_asset_controls_tenant_policy ON organization_data_asset_controls
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());
