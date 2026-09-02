-- Connect operational issues and needs to the canonical Work Order lifecycle.
-- Incidents remain the intake/source truth; Work Orders remain execution truth.

CREATE TABLE operational_incident_work_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  incident_id UUID NOT NULL,
  work_order_id UUID NOT NULL,
  link_role TEXT NOT NULL DEFAULT 'origin' CHECK(link_role IN('origin','related')),
  linked_by UUID NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(detail)='object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,incident_id,work_order_id),
  FOREIGN KEY(organization_id,incident_id)
    REFERENCES operational_incidents(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,work_order_id)
    REFERENCES work_orders(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,linked_by)
    REFERENCES users(organization_id,id) ON DELETE RESTRICT
);

CREATE INDEX operational_incident_work_orders_incident_idx
  ON operational_incident_work_orders(organization_id,incident_id,created_at DESC);
CREATE INDEX operational_incident_work_orders_work_idx
  ON operational_incident_work_orders(organization_id,work_order_id,created_at DESC);

CREATE TRIGGER operational_incident_work_orders_append_only
  BEFORE UPDATE OR DELETE ON operational_incident_work_orders
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

CREATE POLICY operational_incident_work_orders_tenant_policy ON operational_incident_work_orders
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());
ALTER TABLE operational_incident_work_orders ENABLE ROW LEVEL SECURITY;

INSERT INTO data_catalog_assets(code,name,domain,source_object,description,classification_code,owner_role_code)
VALUES(
  'operational-incident-work-order-link',
  'Асуудал, хэрэгцээ ба ажлын холбоос',
  'operations',
  'operational_incident_work_orders',
  'Анхны асуудал, хэрэгцээг гүйцэтгэх Work Order-той tenant дотор өөрчлөх боломжгүйгээр холбосон мөр',
  'internal',
  'chief_engineer'
)
ON CONFLICT(code) DO NOTHING;

COMMENT ON TABLE operational_incident_work_orders IS
  'Append-only tenant-scoped coordination link: incident is intake truth, Work Order is execution truth.';
