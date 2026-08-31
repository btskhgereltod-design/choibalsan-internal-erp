-- Connect requested, approved, issued, and consumed material to one Work Order.
-- Approval does not mutate inventory; issue is the only stock-decrement step.

INSERT INTO permission_catalog(code,name,module_code,description) VALUES
('work-orders.material.request','Ажлын материал хүсэх','work-orders','Холбогдох ажлын шаардлагатай материалыг хүсэх'),
('work-orders.material.approve','Ажлын материал батлах','work-orders','Материалын хүсэлтийн тоо хэмжээг батлах эсвэл татгалзах'),
('work-orders.material.issue','Ажлын материал олгох','inventory','Батлагдсан материалыг агуулахаас олгож үлдэгдэл хасах'),
('work-orders.material.consume','Материалын зарцуулалт батлах','work-orders','Олгосон материал ажилд зарцуулагдсаныг батлах')
ON CONFLICT(code) DO UPDATE SET
  name=EXCLUDED.name,module_code=EXCLUDED.module_code,description=EXCLUDED.description;

INSERT INTO organization_roles(organization_id,code,name,system)
SELECT id,'work-order-material-custodian','Ажлын материалын нярав',true FROM organizations
ON CONFLICT(organization_id,code) DO UPDATE SET name=EXCLUDED.name,active=true;

INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
SELECT r.organization_id,r.id,p.permission_code
FROM organization_roles r
JOIN LATERAL (VALUES
  ('work-order-manager','work-orders.material.request'),
  ('work-order-manager','work-orders.material.approve'),
  ('work-order-manager','work-orders.material.consume'),
  ('work-order-coordinator','work-orders.material.request'),
  ('work-order-coordinator','work-orders.material.consume'),
  ('work-order-material-custodian','work-orders.material.issue')
) p(role_code,permission_code) ON p.role_code=r.code
ON CONFLICT DO NOTHING;

INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
SELECT r.organization_id,r.id,p.code
FROM organization_roles r CROSS JOIN permission_catalog p
WHERE r.code IN ('owner','administrator')
ON CONFLICT DO NOTHING;

INSERT INTO user_roles(organization_id,user_id,role_id)
SELECT u.organization_id,u.id,r.id
FROM users u JOIN organization_roles r
  ON r.organization_id=u.organization_id AND r.code='work-order-material-custodian'
WHERE u.active=true AND u.role IN ('storekeeper','accountant')
ON CONFLICT DO NOTHING;

CREATE TABLE work_order_material_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  work_order_id UUID NOT NULL,
  inventory_item_id UUID NOT NULL,
  requested_quantity NUMERIC(16,3) NOT NULL CHECK(requested_quantity>0),
  approved_quantity NUMERIC(16,3) NOT NULL DEFAULT 0 CHECK(approved_quantity>=0),
  issued_quantity NUMERIC(16,3) NOT NULL DEFAULT 0 CHECK(issued_quantity>=0),
  consumed_quantity NUMERIC(16,3) NOT NULL DEFAULT 0 CHECK(consumed_quantity>=0),
  unit TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN('requested','approved','rejected','issued','consumed','cancelled')),
  reason TEXT NOT NULL DEFAULT '',
  decision_note TEXT NOT NULL DEFAULT '',
  request_idempotency_key UUID NOT NULL,
  requested_by UUID NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by UUID,
  decided_at TIMESTAMPTZ,
  issued_by UUID,
  issued_at TIMESTAMPTZ,
  consumed_by UUID,
  consumed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,request_idempotency_key),
  FOREIGN KEY(organization_id,work_order_id) REFERENCES work_orders(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,inventory_item_id) REFERENCES inventory_items(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,requested_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,decided_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,issued_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,consumed_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  CHECK(approved_quantity<=requested_quantity),
  CHECK(issued_quantity<=approved_quantity),
  CHECK(consumed_quantity<=issued_quantity)
);
CREATE INDEX work_order_material_requests_order_idx
  ON work_order_material_requests(organization_id,work_order_id,requested_at,id);
CREATE INDEX work_order_material_requests_issue_queue_idx
  ON work_order_material_requests(organization_id,status,requested_at) WHERE status='approved';

CREATE TABLE work_order_material_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  material_request_id UUID NOT NULL,
  work_order_id UUID NOT NULL,
  actor_user_id UUID NOT NULL,
  action TEXT NOT NULL CHECK(action IN('requested','approved','rejected','issued','consumed','cancelled')),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(detail)='object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,material_request_id) REFERENCES work_order_material_requests(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,work_order_id) REFERENCES work_orders(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,actor_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX work_order_material_events_request_idx
  ON work_order_material_events(organization_id,material_request_id,created_at,id);
CREATE TRIGGER work_order_material_events_append_only
  BEFORE UPDATE OR DELETE ON work_order_material_events
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

ALTER TABLE stock_movements
  ADD COLUMN work_order_id UUID,
  ADD COLUMN work_order_material_request_id UUID,
  ADD COLUMN idempotency_key UUID,
  ADD CONSTRAINT stock_movements_work_order_tenant_fk
    FOREIGN KEY(organization_id,work_order_id) REFERENCES work_orders(organization_id,id) ON DELETE RESTRICT,
  ADD CONSTRAINT stock_movements_material_request_tenant_fk
    FOREIGN KEY(organization_id,work_order_material_request_id)
    REFERENCES work_order_material_requests(organization_id,id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX stock_movements_tenant_idempotency_idx
  ON stock_movements(organization_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
