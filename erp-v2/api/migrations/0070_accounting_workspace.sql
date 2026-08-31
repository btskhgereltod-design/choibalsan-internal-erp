-- Accountant workspace. Legacy financial rows stay outside OVERVA until reviewed import.
INSERT INTO permission_catalog(code,name,module_code,description) VALUES
('finance.read','Санхүүгийн бүртгэл харах','finance','Санхүүгийн тойм, гүйлгээ, өглөг авлага болон тулгалт харах'),
('finance.reconcile','Санхүүгийн тулгалт хийх','finance','Няравын олголтыг ажлын захиалга болон санхүүгийн ангилалтай тулгах')
ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,module_code=EXCLUDED.module_code,description=EXCLUDED.description;

CREATE TABLE finance_obligations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  direction TEXT NOT NULL CHECK(direction IN('payable','receivable')), document_no TEXT NOT NULL,
  document_date DATE NOT NULL, due_date DATE, counterparty TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  total_amount NUMERIC(18,2) NOT NULL CHECK(total_amount>0), settled_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK(settled_amount>=0),
  currency CHAR(3) NOT NULL DEFAULT 'MNT', status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','partial','settled','cancelled')),
  created_by UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id), UNIQUE(organization_id,direction,document_no),
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  CHECK(due_date IS NULL OR due_date>=document_date), CHECK(settled_amount<=total_amount),
  CHECK((status='open' AND settled_amount=0) OR (status='partial' AND settled_amount>0 AND settled_amount<total_amount)
     OR (status='settled' AND settled_amount=total_amount) OR status='cancelled')
);
CREATE INDEX finance_obligations_status_idx ON finance_obligations(organization_id,direction,status,due_date,document_date DESC);

CREATE TABLE finance_obligation_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  obligation_id UUID NOT NULL, actor_user_id UUID NOT NULL,
  action TEXT NOT NULL CHECK(action IN('created','settlement_recorded','cancelled')), amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK(amount>=0),
  reference TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', detail JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(detail)='object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,obligation_id) REFERENCES finance_obligations(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,actor_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX finance_obligation_events_obligation_idx ON finance_obligation_events(organization_id,obligation_id,created_at,id);
CREATE TRIGGER finance_obligation_events_append_only BEFORE UPDATE OR DELETE ON finance_obligation_events
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

CREATE TABLE accounting_material_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  material_request_id UUID NOT NULL, stock_movement_id UUID NOT NULL,
  treatment TEXT NOT NULL CHECK(treatment IN('expense','asset','work_in_progress','no_charge')),
  amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK(amount>=0), currency CHAR(3) NOT NULL DEFAULT 'MNT', account_code TEXT NOT NULL DEFAULT '',
  document_reference TEXT NOT NULL DEFAULT '', status TEXT NOT NULL CHECK(status IN('matched','exception')), note TEXT NOT NULL DEFAULT '',
  reviewed_by UUID NOT NULL, reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id), UNIQUE(organization_id,material_request_id),
  FOREIGN KEY(organization_id,material_request_id) REFERENCES work_order_material_requests(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,stock_movement_id) REFERENCES stock_movements(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,reviewed_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX accounting_material_reviews_status_idx ON accounting_material_reviews(organization_id,status,reviewed_at DESC);

CREATE TABLE accounting_material_review_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  review_id UUID NOT NULL, actor_user_id UUID NOT NULL, action TEXT NOT NULL CHECK(action IN('reviewed','reclassified')),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(detail)='object'), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,review_id) REFERENCES accounting_material_reviews(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,actor_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX accounting_material_review_events_review_idx ON accounting_material_review_events(organization_id,review_id,created_at,id);
CREATE TRIGGER accounting_material_review_events_append_only BEFORE UPDATE OR DELETE ON accounting_material_review_events
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

INSERT INTO organization_roles(organization_id,code,name,system)
SELECT id,'finance-accountant','Нягтлан бодогч',true FROM organizations
ON CONFLICT(organization_id,code) DO UPDATE SET name=EXCLUDED.name,active=true;
INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
SELECT r.organization_id,r.id,p.permission_code FROM organization_roles r
JOIN LATERAL (VALUES ('finance-accountant','finance.read'),('finance-accountant','finance.manage'),('finance-accountant','finance.reconcile')) p(role_code,permission_code)
  ON p.role_code=r.code ON CONFLICT DO NOTHING;
INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
SELECT r.organization_id,r.id,p.code FROM organization_roles r CROSS JOIN permission_catalog p
WHERE r.code IN('owner','administrator') ON CONFLICT DO NOTHING;
INSERT INTO user_roles(organization_id,user_id,role_id)
SELECT u.organization_id,u.id,r.id FROM users u JOIN organization_roles r ON r.organization_id=u.organization_id AND r.code='finance-accountant'
WHERE u.active=true AND u.role='accountant' ON CONFLICT DO NOTHING;
DELETE FROM user_roles ur USING users u,organization_roles r
 WHERE ur.organization_id=u.organization_id AND ur.user_id=u.id AND r.organization_id=ur.organization_id AND r.id=ur.role_id
   AND u.role='accountant' AND r.code='work-order-material-custodian';
