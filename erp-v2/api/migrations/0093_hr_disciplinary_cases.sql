-- Confidential disciplinary case authority. Existing employees, complaints and
-- handoffs receive no inferred cases or events.

INSERT INTO permission_catalog(code,name,module_code,description) VALUES
('hr.discipline.read','Discipline case summary','hr','Read non-detail disciplinary queue information'),
('hr.discipline.confidential.read','Discipline confidential detail','hr','Read restricted disciplinary case facts and evidence'),
('hr.discipline.intake','Discipline intake','hr','Create a case or respond to a Complaints handoff'),
('hr.discipline.investigate','Discipline investigation','hr','Record notice, explanation and investigated facts'),
('hr.discipline.recommend','Discipline recommendation','hr','Submit a reviewed finding and recommendation'),
('hr.discipline.decide','Discipline decision','hr','Return, close without action or impose a reviewed decision'),
('hr.discipline.admin','Discipline administration','hr','Record acknowledgement, expiry, removal and dispute evidence')
ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,module_code=EXCLUDED.module_code,description=EXCLUDED.description;

INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
SELECT r.organization_id,r.id,p.code FROM organization_roles r JOIN permission_catalog p ON
 (r.code IN('owner','administrator') AND p.code LIKE 'hr.discipline.%')
 OR (r.code='hr-officer' AND p.code IN(
   'hr.discipline.read','hr.discipline.confidential.read','hr.discipline.intake',
   'hr.discipline.investigate','hr.discipline.recommend','hr.discipline.admin'))
 OR (r.code='executive' AND p.code IN(
   'hr.discipline.read','hr.discipline.confidential.read','hr.discipline.decide'))
ON CONFLICT DO NOTHING;

CREATE TABLE hr_discipline_cases (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  case_no TEXT NOT NULL,
  employee_id UUID NOT NULL,
  source_handoff_id UUID,
  violation_key TEXT NOT NULL CHECK(length(violation_key) BETWEEN 1 AND 200),
  violation_reference TEXT NOT NULL CHECK(length(violation_reference) BETWEEN 1 AND 4000),
  occurred_on DATE NOT NULL,
  discovered_on DATE NOT NULL,
  legal_basis_reference TEXT NOT NULL CHECK(length(legal_basis_reference) BETWEEN 1 AND 1000),
  deadline_rule_code TEXT NOT NULL CHECK(deadline_rule_code IN('ordinary','full_property_liability')),
  deadline_suspensions JSONB NOT NULL DEFAULT '[]'::jsonb,
  deadline_calculation JSONB NOT NULL,
  decision_due_on DATE NOT NULL,
  policy_snapshot JSONB NOT NULL,
  confidentiality TEXT NOT NULL DEFAULT 'restricted' CHECK(confidentiality='restricted'),
  investigator_user_id UUID,
  notice_document_id UUID,
  notice_at TIMESTAMPTZ,
  explanation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK(explanation_status IN('pending','provided','refused')),
  explanation_document_id UUID,
  explanation_at TIMESTAMPTZ,
  investigation_summary TEXT NOT NULL DEFAULT '',
  finding TEXT NOT NULL DEFAULT 'pending'
    CHECK(finding IN('pending','substantiated','unsubstantiated','insufficient_evidence')),
  recommendation TEXT NOT NULL DEFAULT '',
  recommended_action_code TEXT,
  recommendation_document_id UUID,
  recommendation_by UUID,
  recommendation_at TIMESTAMPTZ,
  decision_outcome TEXT CHECK(decision_outcome IN('sanctioned','no_action','returned')),
  sanction_code TEXT,
  decision_reason TEXT NOT NULL DEFAULT '',
  decision_document_id UUID,
  decision_by UUID,
  decision_at TIMESTAMPTZ,
  effective_from DATE,
  sanction_expires_on DATE,
  acknowledgement_status TEXT NOT NULL DEFAULT 'pending'
    CHECK(acknowledgement_status IN('pending','provided','refused')),
  acknowledgement_document_id UUID,
  acknowledged_at TIMESTAMPTZ,
  removed_at TIMESTAMPTZ,
  removal_reason TEXT NOT NULL DEFAULT '',
  removal_document_id UUID,
  dispute_status TEXT NOT NULL DEFAULT 'none'
    CHECK(dispute_status IN('none','raised','resolved')),
  dispute_reference TEXT NOT NULL DEFAULT '',
  dispute_document_id UUID,
  dispute_resolution TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'intake' CHECK(status IN(
    'intake','investigation','explanation_pending','recommendation_review',
    'decision_pending','returned','no_action','sanctioned','acknowledged',
    'monitoring','expired','removed','disputed','closed','cancelled'
  )),
  workflow_case_id UUID,
  version BIGINT NOT NULL DEFAULT 0 CHECK(version>=0),
  idempotency_key UUID NOT NULL,
  payload_sha256 CHAR(64) NOT NULL,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,case_no),
  UNIQUE(organization_id,idempotency_key),
  UNIQUE(organization_id,employee_id,violation_key),
  UNIQUE(organization_id,source_handoff_id),
  FOREIGN KEY(organization_id,employee_id) REFERENCES employees(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,source_handoff_id) REFERENCES complaint_hr_handoffs(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,investigator_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,recommendation_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,decision_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,workflow_case_id) REFERENCES workflow_cases(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,notice_document_id) REFERENCES documents(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,explanation_document_id) REFERENCES documents(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,recommendation_document_id) REFERENCES documents(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,decision_document_id) REFERENCES documents(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,acknowledgement_document_id) REFERENCES documents(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,removal_document_id) REFERENCES documents(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,dispute_document_id) REFERENCES documents(organization_id,id) ON DELETE RESTRICT,
  CHECK(discovered_on>=occurred_on),
  CHECK(jsonb_typeof(deadline_suspensions)='array'),
  CHECK(jsonb_typeof(deadline_calculation)='object' AND deadline_calculation<>'{}'::jsonb),
  CHECK(sanction_expires_on IS NULL OR (effective_from IS NOT NULL AND sanction_expires_on>=effective_from)),
  CHECK(jsonb_typeof(policy_snapshot)='object' AND policy_snapshot<>'{}'::jsonb),
  CHECK((notice_document_id IS NULL AND notice_at IS NULL) OR (notice_document_id IS NOT NULL AND notice_at IS NOT NULL)),
  CHECK((explanation_status='pending' AND explanation_document_id IS NULL AND explanation_at IS NULL)
    OR (explanation_status IN('provided','refused') AND explanation_document_id IS NOT NULL AND explanation_at IS NOT NULL)),
  CHECK((decision_outcome IS NULL AND decision_by IS NULL AND decision_at IS NULL)
    OR (decision_outcome IS NOT NULL AND decision_by IS NOT NULL AND decision_at IS NOT NULL
      AND length(decision_reason)>0 AND decision_document_id IS NOT NULL)),
  CHECK((decision_outcome='sanctioned' AND sanction_code IS NOT NULL AND effective_from IS NOT NULL AND sanction_expires_on IS NOT NULL)
    OR decision_outcome IS DISTINCT FROM 'sanctioned')
);
CREATE INDEX hr_discipline_queue_idx ON hr_discipline_cases(organization_id,status,decision_due_on,updated_at DESC);

ALTER TABLE complaint_hr_handoffs ADD CONSTRAINT complaint_hr_handoff_target_discipline_fk
  FOREIGN KEY(organization_id,target_discipline_case_id)
  REFERENCES hr_discipline_cases(organization_id,id) ON DELETE RESTRICT;

CREATE TABLE hr_discipline_case_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  discipline_case_id UUID NOT NULL,
  version BIGINT NOT NULL CHECK(version>=0),
  event_type TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT,
  actor_user_id UUID NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,discipline_case_id) REFERENCES hr_discipline_cases(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,actor_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  UNIQUE(organization_id,discipline_case_id,request_id)
);
CREATE INDEX hr_discipline_events_timeline_idx ON hr_discipline_case_events(organization_id,discipline_case_id,version,created_at,id);
CREATE TRIGGER hr_discipline_case_events_append_only BEFORE UPDATE OR DELETE ON hr_discipline_case_events
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

CREATE POLICY hr_discipline_cases_tenant_policy ON hr_discipline_cases
  USING(organization_id=overva_current_organization_id()) WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY hr_discipline_case_events_tenant_policy ON hr_discipline_case_events
  USING(organization_id=overva_current_organization_id()) WITH CHECK(organization_id=overva_current_organization_id());
ALTER TABLE hr_discipline_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_discipline_case_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE hr_discipline_cases IS 'Restricted HR disciplinary case authority; policy/legal review is snapshotted per case.';
COMMENT ON TABLE hr_discipline_case_events IS 'Append-only confidential disciplinary lifecycle evidence; no inferred history.';
