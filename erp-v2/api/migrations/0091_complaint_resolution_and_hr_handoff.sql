-- Extend the existing authoritative complaint lifecycle without creating a
-- second complaint model or fabricating prior case history. A handoff is only
-- a request for HR assessment; it is not a disciplinary case.

INSERT INTO permission_catalog(code,name,module_code,description) VALUES
('complaints.handoff.create','Сахилгын хяналтад шилжүүлэх хүсэлт','complaints',
 'Өргөдөл, гомдлын нотолгооноос HR-ийн тусдаа сахилгын хэрэг шаардлагатай эсэхийг шалгуулах хүсэлт үүсгэх'),
('hr.discipline.intake','Сахилгын хүсэлт хүлээн авах','hr',
 'Өргөдөл, гомдлын explicit handoff-ийг хүлээн авах эсвэл үндэслэлтэй буцаах')
ON CONFLICT(code) DO NOTHING;

INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
SELECT r.organization_id,r.id,p.code
FROM organization_roles r
JOIN permission_catalog p ON
 (r.code IN('owner','administrator') AND p.code IN('complaints.handoff.create','hr.discipline.intake'))
 OR (r.code='records-officer' AND p.code='complaints.handoff.create')
 OR (r.code='manager' AND p.code='complaints.handoff.create')
 OR (r.code='hr-officer' AND p.code='hr.discipline.intake')
ON CONFLICT DO NOTHING;

ALTER TABLE complaint_cases DROP CONSTRAINT complaint_cases_status_check;
ALTER TABLE complaint_cases ADD CONSTRAINT complaint_cases_status_check
  CHECK(status IN(
    'received','validating','registered','assigned','in_progress','under_review',
    'response_approved','response_sent','implementation_monitoring','closed',
    'returned_for_completion','rejected','cancelled'
  ));

CREATE TABLE complaint_hr_handoffs (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  handoff_no TEXT NOT NULL,
  complaint_case_id UUID NOT NULL,
  subject_reference TEXT NOT NULL CHECK(length(subject_reference) BETWEEN 1 AND 500),
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 4000),
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK(status IN('requested','accepted','declined','cancelled')),
  target_discipline_case_id UUID,
  version BIGINT NOT NULL DEFAULT 0 CHECK(version>=0),
  idempotency_key UUID NOT NULL,
  payload_sha256 CHAR(64) NOT NULL,
  requested_by UUID NOT NULL,
  responded_by UUID,
  response_reason TEXT NOT NULL DEFAULT '',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,handoff_no),
  UNIQUE(organization_id,idempotency_key),
  FOREIGN KEY(organization_id,complaint_case_id)
    REFERENCES complaint_cases(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,requested_by)
    REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,responded_by)
    REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  CHECK(
    (status='requested' AND responded_by IS NULL AND responded_at IS NULL
      AND target_discipline_case_id IS NULL)
    OR (status='accepted' AND responded_by IS NOT NULL AND responded_at IS NOT NULL
      AND target_discipline_case_id IS NOT NULL)
    OR (status IN('declined','cancelled') AND responded_by IS NOT NULL
      AND responded_at IS NOT NULL AND target_discipline_case_id IS NULL
      AND length(response_reason)>0)
  )
);
CREATE INDEX complaint_hr_handoffs_case_idx
  ON complaint_hr_handoffs(organization_id,complaint_case_id,requested_at,id);
CREATE INDEX complaint_hr_handoffs_intake_idx
  ON complaint_hr_handoffs(organization_id,status,requested_at,id);

CREATE TABLE complaint_hr_handoff_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  handoff_id UUID NOT NULL,
  version BIGINT NOT NULL CHECK(version>=0),
  event_type TEXT NOT NULL CHECK(event_type IN('requested','accepted','declined','cancelled')),
  actor_user_id UUID NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,handoff_id)
    REFERENCES complaint_hr_handoffs(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,actor_user_id)
    REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  UNIQUE(organization_id,handoff_id,request_id)
);
CREATE INDEX complaint_hr_handoff_events_timeline_idx
  ON complaint_hr_handoff_events(organization_id,handoff_id,version,created_at,id);

CREATE TRIGGER complaint_hr_handoff_events_append_only
  BEFORE UPDATE OR DELETE ON complaint_hr_handoff_events
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

CREATE POLICY complaint_hr_handoffs_tenant_policy ON complaint_hr_handoffs
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY complaint_hr_handoff_events_tenant_policy ON complaint_hr_handoff_events
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());
ALTER TABLE complaint_hr_handoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE complaint_hr_handoff_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE complaint_hr_handoffs IS
  'Explicit Complaints-to-HR assessment request. Acceptance must atomically create a separately authoritative disciplinary case.';
COMMENT ON COLUMN complaint_hr_handoffs.target_discipline_case_id IS
  'Reserved target identity populated only by the future atomic HR intake command; no disciplinary case is created by this migration.';
COMMENT ON TABLE complaint_hr_handoff_events IS
  'Immutable handoff lifecycle evidence. Existing complaints receive no synthetic handoff history.';
