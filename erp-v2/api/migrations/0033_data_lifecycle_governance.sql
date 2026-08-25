-- OVERVA data lifecycle governance.
-- This migration creates approval and evidence records only. It deliberately
-- does not include an automatic or direct hard-delete executor.

CREATE TABLE data_lifecycle_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  asset_code TEXT NOT NULL REFERENCES data_catalog_assets(code) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  archive_after_days INTEGER CHECK(archive_after_days IS NULL OR archive_after_days > 0),
  retention_days INTEGER CHECK(retention_days IS NULL OR retention_days > 0),
  disposition_action TEXT NOT NULL DEFAULT 'review'
    CHECK(disposition_action IN ('review','archive','anonymize','delete')),
  requires_approval BOOLEAN NOT NULL DEFAULT true,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,asset_code),
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,updated_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  CHECK(archive_after_days IS NULL OR retention_days IS NULL OR archive_after_days <= retention_days),
  CHECK(requires_approval = true)
);
CREATE INDEX data_lifecycle_policies_tenant_idx
  ON data_lifecycle_policies(organization_id,active,asset_code);

CREATE TABLE data_legal_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  asset_code TEXT NOT NULL REFERENCES data_catalog_assets(code) ON DELETE RESTRICT,
  record_key TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','released')),
  placed_by UUID NOT NULL,
  released_by UUID,
  placed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at TIMESTAMPTZ,
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,placed_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,released_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  CHECK((status='active' AND released_by IS NULL AND released_at IS NULL)
     OR (status='released' AND released_by IS NOT NULL AND released_at IS NOT NULL))
);
CREATE UNIQUE INDEX data_legal_holds_one_active_uidx
  ON data_legal_holds(organization_id,asset_code,COALESCE(record_key,''))
  WHERE status='active';
CREATE INDEX data_legal_holds_tenant_idx
  ON data_legal_holds(organization_id,status,placed_at DESC);

CREATE TABLE data_disposition_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  policy_id UUID,
  asset_code TEXT NOT NULL REFERENCES data_catalog_assets(code) ON DELETE RESTRICT,
  record_key TEXT NOT NULL,
  requested_action TEXT NOT NULL CHECK(requested_action IN ('archive','anonymize','delete')),
  reason TEXT NOT NULL,
  policy_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','approved','rejected','cancelled')),
  requested_by UUID NOT NULL,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,policy_id) REFERENCES data_lifecycle_policies(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,requested_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,reviewed_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  CHECK((status='pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
     OR (status<>'pending' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE INDEX data_disposition_requests_tenant_idx
  ON data_disposition_requests(organization_id,status,created_at DESC);

CREATE TABLE data_lifecycle_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  asset_code TEXT REFERENCES data_catalog_assets(code) ON DELETE RESTRICT,
  record_key TEXT,
  event_type TEXT NOT NULL,
  actor_user_id UUID,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,actor_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX data_lifecycle_events_tenant_idx
  ON data_lifecycle_events(organization_id,created_at DESC,id DESC);
CREATE TRIGGER data_lifecycle_events_append_only
BEFORE UPDATE OR DELETE ON data_lifecycle_events
FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

CREATE OR REPLACE FUNCTION overva_guard_disposition_approval()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='approved' AND OLD.status IS DISTINCT FROM 'approved' AND EXISTS (
    SELECT 1 FROM data_legal_holds h
     WHERE h.organization_id=NEW.organization_id
       AND h.asset_code=NEW.asset_code
       AND h.status='active'
       AND (h.record_key IS NULL OR h.record_key=NEW.record_key)
  ) THEN
    RAISE EXCEPTION 'GOVERNANCE_ACTIVE_HOLD' USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER data_disposition_hold_guard
BEFORE UPDATE OF status ON data_disposition_requests
FOR EACH ROW EXECUTE FUNCTION overva_guard_disposition_approval();

COMMENT ON TABLE data_lifecycle_policies IS
  'Tenant retention and disposition policy metadata. Approval is mandatory and execution is intentionally external.';
COMMENT ON TABLE data_legal_holds IS
  'Legal or operational holds that prevent approval of matching disposition requests.';
COMMENT ON TABLE data_disposition_requests IS
  'Reviewable archive, anonymize or delete requests. Approval does not execute data destruction.';
COMMENT ON TABLE data_lifecycle_events IS
  'Append-only lifecycle evidence journal for governance decisions and state changes.';

-- Staged policies: RLS is enabled only after request-scoped tenant context is
-- rolled out across all routes (see DATA_GOVERNANCE.md).
CREATE POLICY data_lifecycle_policies_tenant_policy ON data_lifecycle_policies
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY data_legal_holds_tenant_policy ON data_legal_holds
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY data_disposition_requests_tenant_policy ON data_disposition_requests
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY data_lifecycle_events_tenant_policy ON data_lifecycle_events
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());
