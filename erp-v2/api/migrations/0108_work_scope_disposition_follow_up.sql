-- Account for every accepted unresolved/deferred scope outcome. A manager may
-- deliberately end it, or return the remaining quantity to the canonical Work
-- board as one traceable follow-up. The source result remains immutable history.

CREATE TABLE work_order_scope_dispositions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  source_work_order_id UUID NOT NULL,
  source_scope_item_id UUID NOT NULL,
  disposition_type TEXT NOT NULL CHECK(disposition_type IN('follow_up','accepted_end')),
  reason_code TEXT NOT NULL CHECK(reason_code IN(
    'material_shortage','access_blocked','weather','safety','equipment','technical_impossibility','out_of_scope','other'
  )),
  reason TEXT NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 2000),
  due_at TIMESTAMPTZ,
  follow_up_work_order_id UUID,
  follow_up_scope_item_id UUID,
  approved_by UUID NOT NULL,
  idempotency_key UUID NOT NULL,
  payload_sha256 CHAR(64) NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,source_scope_item_id),
  UNIQUE(organization_id,idempotency_key),
  FOREIGN KEY(organization_id,source_work_order_id)
    REFERENCES work_orders(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,source_scope_item_id)
    REFERENCES work_order_scope_items(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,follow_up_work_order_id)
    REFERENCES work_orders(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,follow_up_scope_item_id)
    REFERENCES work_order_scope_items(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,approved_by)
    REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  CHECK((disposition_type='follow_up' AND due_at IS NOT NULL
      AND follow_up_work_order_id IS NOT NULL AND follow_up_scope_item_id IS NOT NULL)
    OR (disposition_type='accepted_end' AND follow_up_work_order_id IS NULL
      AND follow_up_scope_item_id IS NULL))
);

CREATE INDEX work_order_scope_dispositions_follow_up_idx
  ON work_order_scope_dispositions(organization_id,follow_up_work_order_id,created_at DESC);

CREATE TRIGGER work_order_scope_dispositions_append_only
  BEFORE UPDATE OR DELETE ON work_order_scope_dispositions
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

CREATE POLICY work_order_scope_dispositions_tenant_policy ON work_order_scope_dispositions
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());
ALTER TABLE work_order_scope_dispositions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE work_order_scope_dispositions IS
  'Append-only approved disposition for unresolved/deferred measured work; optionally creates exactly one linked follow-up Work Order.';
