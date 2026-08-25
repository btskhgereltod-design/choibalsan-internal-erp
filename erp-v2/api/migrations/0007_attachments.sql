CREATE TABLE attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  asset_id UUID,
  work_order_id UUID,
  uploaded_by UUID NOT NULL,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT attachments_one_entity_check CHECK ((asset_id IS NOT NULL)::int + (work_order_id IS NOT NULL)::int = 1),
  CONSTRAINT attachments_asset_tenant_fk FOREIGN KEY (organization_id, asset_id)
    REFERENCES assets (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT attachments_work_order_tenant_fk FOREIGN KEY (organization_id, work_order_id)
    REFERENCES work_orders (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT attachments_uploader_tenant_fk FOREIGN KEY (organization_id, uploaded_by)
    REFERENCES users (organization_id, id) ON DELETE RESTRICT
);

CREATE INDEX attachments_asset_time_idx ON attachments (organization_id, asset_id, created_at DESC);
CREATE INDEX attachments_work_order_time_idx ON attachments (organization_id, work_order_id, created_at DESC);
