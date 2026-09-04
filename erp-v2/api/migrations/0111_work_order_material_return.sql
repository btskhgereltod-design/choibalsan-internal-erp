-- Reconcile partially consumed Work Order material by returning the exact unused
-- quantity to a tenant-owned warehouse. Evidence and stock movements remain append-only.

INSERT INTO permission_catalog(code,name,module_code,description) VALUES
('work-orders.material.return','Ажлын материал буцаан авах','inventory','Зарцуулалгүй үлдсэн ажлын материалыг агуулахад буцаан авч үлдэгдэл нэмэх')
ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,module_code=EXCLUDED.module_code,description=EXCLUDED.description;

INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
SELECT organization_id,id,'work-orders.material.return' FROM organization_roles
WHERE code IN('work-order-material-custodian','owner','administrator')
ON CONFLICT DO NOTHING;

ALTER TABLE work_order_material_requests
  ADD COLUMN returned_quantity NUMERIC(16,3) NOT NULL DEFAULT 0 CHECK(returned_quantity>=0),
  ADD COLUMN returned_by UUID,
  ADD COLUMN returned_at TIMESTAMPTZ,
  ADD CONSTRAINT work_order_material_requests_returned_by_tenant_fk
    FOREIGN KEY(organization_id,returned_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT;

ALTER TABLE work_order_material_requests DROP CONSTRAINT work_order_material_requests_status_check;
ALTER TABLE work_order_material_requests ADD CONSTRAINT work_order_material_requests_status_check
  CHECK(status IN('requested','approved','rejected','issued','partially_consumed','consumed','reconciled','cancelled'));
ALTER TABLE work_order_material_requests ADD CONSTRAINT work_order_material_requests_reconciled_quantity_check
  CHECK(consumed_quantity+returned_quantity<=issued_quantity);

ALTER TABLE work_order_material_events DROP CONSTRAINT work_order_material_events_action_check;
ALTER TABLE work_order_material_events ADD CONSTRAINT work_order_material_events_action_check
  CHECK(action IN('requested','approved','rejected','issued','partially_consumed','consumed','returned','reconciled','cancelled'));
