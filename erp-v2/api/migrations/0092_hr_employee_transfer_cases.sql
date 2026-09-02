-- Authoritative HR employee transfer/rotation cases. This migration creates no
-- case or Assignment history for existing employees.

INSERT INTO permission_catalog(code,name,module_code,description) VALUES
('hr.transfer.read','Шилжилт хөдөлгөөн харах','hr','Шилжилт хөдөлгөөний хэрэг харах'),
('hr.transfer.manage','Шилжилт хөдөлгөөн хөтлөх','hr','Хэрэг нээх, бүрдэл болон зөвшөөрөл бүртгэх'),
('hr.transfer.review','Шилжилт хөдөлгөөн хянах','hr','ХН болон ачаалал, хэрэгцээний хяналт хийх'),
('hr.transfer.decide','Шилжилт хөдөлгөөн шийдвэрлэх','hr','Удирдлагын эцсийн шийдвэр гаргах'),
('hr.transfer.implement','Шилжилт хөдөлгөөн хэрэгжүүлэх','hr','Батлагдсан хүчинтэй өөрчлөлтийг Assignment-д хэрэгжүүлэх')
ON CONFLICT(code) DO NOTHING;

INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
SELECT r.organization_id,r.id,p.code FROM organization_roles r JOIN permission_catalog p ON
 (r.code IN('owner','administrator') AND p.code LIKE 'hr.transfer.%')
 OR (r.code='hr-officer' AND p.code IN('hr.transfer.read','hr.transfer.manage','hr.transfer.review','hr.transfer.implement'))
 OR (r.code IN('manager','unit-manager') AND p.code IN('hr.transfer.read','hr.transfer.review'))
 OR (r.code='executive' AND p.code IN('hr.transfer.read','hr.transfer.decide'))
ON CONFLICT DO NOTHING;

CREATE TABLE hr_transfer_cases (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  case_no TEXT NOT NULL,
  employee_id UUID NOT NULL,
  transfer_type TEXT NOT NULL CHECK(transfer_type IN('temporary_transfer','rotation')),
  source_assignment_id UUID NOT NULL,
  target_organization_unit_id UUID,
  target_position_id UUID,
  target_manager_employee_id UUID,
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 4000),
  legal_basis_reference TEXT NOT NULL CHECK(length(legal_basis_reference) BETWEEN 1 AND 500),
  effective_from DATE NOT NULL,
  effective_to DATE,
  consent_required BOOLEAN NOT NULL,
  consent_status TEXT NOT NULL DEFAULT 'pending'
    CHECK(consent_status IN('not_required','pending','provided','refused')),
  consent_document_id UUID,
  workload_assessment TEXT NOT NULL DEFAULT '',
  proposal_document_id UUID,
  decision_document_id UUID,
  acknowledgement_document_id UUID,
  policy_snapshot JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN(
    'draft','eligibility_review','consent_pending','hr_review','management_review',
    'approved','returned','rejected','implemented','monitoring','completed','cancelled'
  )),
  implemented_assignment_id UUID,
  workflow_case_id UUID,
  version BIGINT NOT NULL DEFAULT 0 CHECK(version>=0),
  idempotency_key UUID NOT NULL,
  payload_sha256 CHAR(64) NOT NULL,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  implemented_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,case_no),
  UNIQUE(organization_id,idempotency_key),
  FOREIGN KEY(organization_id,employee_id) REFERENCES employees(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,source_assignment_id) REFERENCES employee_assignments(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,target_organization_unit_id) REFERENCES departments(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,target_position_id) REFERENCES positions(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,target_manager_employee_id) REFERENCES employees(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,consent_document_id) REFERENCES documents(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,proposal_document_id) REFERENCES documents(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,decision_document_id) REFERENCES documents(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,acknowledgement_document_id) REFERENCES documents(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,implemented_assignment_id) REFERENCES employee_assignments(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,workflow_case_id) REFERENCES workflow_cases(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  CHECK(effective_to IS NULL OR effective_to>=effective_from),
  CHECK((consent_required AND consent_status<>'not_required') OR (NOT consent_required AND consent_status='not_required')),
  CHECK(jsonb_typeof(policy_snapshot)='object' AND policy_snapshot<>'{}'::jsonb),
  CHECK(target_organization_unit_id IS NOT NULL OR target_position_id IS NOT NULL)
);
CREATE UNIQUE INDEX hr_transfer_one_open_employee_idx ON hr_transfer_cases(organization_id,employee_id)
  WHERE status NOT IN('rejected','completed','cancelled');
CREATE INDEX hr_transfer_queue_idx ON hr_transfer_cases(organization_id,status,effective_from,updated_at DESC);

CREATE TABLE hr_transfer_case_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  transfer_case_id UUID NOT NULL,
  version BIGINT NOT NULL CHECK(version>=0),
  event_type TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT,
  actor_user_id UUID NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,transfer_case_id) REFERENCES hr_transfer_cases(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,actor_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  UNIQUE(organization_id,transfer_case_id,request_id)
);
CREATE INDEX hr_transfer_events_timeline_idx ON hr_transfer_case_events(organization_id,transfer_case_id,version,created_at,id);
CREATE TRIGGER hr_transfer_case_events_append_only BEFORE UPDATE OR DELETE ON hr_transfer_case_events
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();
CREATE POLICY hr_transfer_cases_tenant_policy ON hr_transfer_cases
  USING(organization_id=overva_current_organization_id()) WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY hr_transfer_case_events_tenant_policy ON hr_transfer_case_events
  USING(organization_id=overva_current_organization_id()) WITH CHECK(organization_id=overva_current_organization_id());
ALTER TABLE hr_transfer_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_transfer_case_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE hr_transfer_cases IS 'Authoritative employee transfer/rotation case; Assignment changes only through approved effective commands.';
COMMENT ON TABLE hr_transfer_case_events IS 'Append-only transfer evidence; existing Assignments receive no fabricated case history.';
