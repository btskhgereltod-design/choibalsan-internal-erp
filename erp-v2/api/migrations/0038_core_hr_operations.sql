-- Core HR operations built around the canonical employee master.
-- Current-state records may change only through audited workflows; event/history
-- tables are append-only and remain the authoritative history.

CREATE TABLE hr_leave_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  employee_id UUID NOT NULL,
  leave_type TEXT NOT NULL CHECK(leave_type IN('annual','sick','unpaid','family','maternity','paternity','training','other')),
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  requested_days NUMERIC(6,2) NOT NULL CHECK(requested_days>0),
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','rejected','cancelled')),
  decided_by UUID,
  decided_at TIMESTAMPTZ,
  decision_note TEXT NOT NULL DEFAULT '',
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,employee_id) REFERENCES employees(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,decided_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  CHECK(ends_on>=starts_on),
  CHECK((status IN('approved','rejected') AND decided_by IS NOT NULL AND decided_at IS NOT NULL) OR status IN('pending','cancelled'))
);
CREATE INDEX hr_leave_requests_employee_idx ON hr_leave_requests(organization_id,employee_id,starts_on DESC);

CREATE TABLE hr_leave_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  leave_request_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN('requested','approved','rejected','cancelled')),
  note TEXT NOT NULL DEFAULT '',
  actor_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,leave_request_id) REFERENCES hr_leave_requests(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,actor_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE TRIGGER hr_leave_events_append_only BEFORE UPDATE OR DELETE ON hr_leave_events
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

CREATE TABLE hr_work_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Ulaanbaatar',
  weekly_pattern JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(weekly_pattern)='object'),
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,code),
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);

CREATE TABLE employee_schedule_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  employee_id UUID NOT NULL,
  schedule_id UUID NOT NULL,
  effective_from DATE NOT NULL,
  effective_to DATE,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,employee_id) REFERENCES employees(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,schedule_id) REFERENCES hr_work_schedules(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  CHECK(effective_to IS NULL OR effective_to>=effective_from)
);
CREATE INDEX employee_schedule_assignments_idx ON employee_schedule_assignments(organization_id,employee_id,effective_from DESC);
CREATE TRIGGER employee_schedule_assignments_append_only BEFORE UPDATE OR DELETE ON employee_schedule_assignments
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

CREATE TABLE attendance_correction_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  employee_id UUID NOT NULL,
  attendance_date DATE NOT NULL,
  requested_values JSONB NOT NULL CHECK(jsonb_typeof(requested_values)='object'),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','rejected','cancelled')),
  requested_by UUID NOT NULL,
  decided_by UUID,
  decided_at TIMESTAMPTZ,
  decision_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,employee_id) REFERENCES employees(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,requested_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,decided_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX attendance_corrections_employee_idx ON attendance_correction_requests(organization_id,employee_id,attendance_date DESC);

CREATE TABLE attendance_correction_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  correction_request_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN('requested','approved','rejected','cancelled','applied')),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,correction_request_id) REFERENCES attendance_correction_requests(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,actor_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE TRIGGER attendance_correction_events_append_only BEFORE UPDATE OR DELETE ON attendance_correction_events
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

CREATE TABLE employee_skills (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  employee_id UUID NOT NULL,
  skill_id UUID NOT NULL,
  proficiency_level SMALLINT NOT NULL DEFAULT 1 CHECK(proficiency_level BETWEEN 1 AND 5),
  certificate_no TEXT NOT NULL DEFAULT '',
  issued_at DATE,
  expires_at DATE,
  verified_by UUID,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,employee_id,skill_id),
  FOREIGN KEY(organization_id,employee_id) REFERENCES employees(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,skill_id) REFERENCES organization_skills(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,verified_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  CHECK(expires_at IS NULL OR issued_at IS NULL OR expires_at>=issued_at)
);
INSERT INTO employee_skills(organization_id,employee_id,skill_id,proficiency_level,certificate_no,issued_at,expires_at,verified_by,verified_at,created_at)
SELECT s.organization_id,u.employee_id,s.skill_id,s.proficiency_level,s.certificate_no,s.issued_at,s.expires_at,s.verified_by,s.verified_at,s.created_at
FROM user_skills s JOIN users u ON u.organization_id=s.organization_id AND u.id=s.user_id
WHERE u.employee_id IS NOT NULL ON CONFLICT DO NOTHING;

CREATE TABLE employee_training_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  employee_id UUID NOT NULL,
  title TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT '',
  starts_on DATE,
  completed_on DATE,
  status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN('planned','in_progress','completed','cancelled')),
  result TEXT NOT NULL DEFAULT '',
  certificate_document_id UUID,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,employee_id) REFERENCES employees(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,certificate_document_id) REFERENCES documents(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);

CREATE TABLE employee_performance_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  employee_id UUID NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  goals JSONB NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(goals)='array'),
  score NUMERIC(5,2) CHECK(score IS NULL OR score BETWEEN 0 AND 100),
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN('draft','submitted','acknowledged','closed')),
  reviewer_user_id UUID NOT NULL,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,employee_id) REFERENCES employees(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,reviewer_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  CHECK(period_end>=period_start)
);

CREATE TABLE employee_transition_checklists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  employee_id UUID NOT NULL,
  checklist_type TEXT NOT NULL CHECK(checklist_type IN('onboarding','offboarding')),
  effective_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','completed','cancelled')),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,employee_id) REFERENCES employees(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE TABLE employee_transition_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  checklist_id UUID NOT NULL,
  item_code TEXT NOT NULL,
  title TEXT NOT NULL,
  responsible_user_id UUID,
  completed_at TIMESTAMPTZ,
  completed_by UUID,
  note TEXT NOT NULL DEFAULT '',
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,checklist_id,item_code),
  FOREIGN KEY(organization_id,checklist_id) REFERENCES employee_transition_checklists(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,responsible_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,completed_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);

ALTER TABLE attachments ADD COLUMN employee_id UUID;
ALTER TABLE attachments DROP CONSTRAINT attachments_one_entity_check;
ALTER TABLE attachments ADD CONSTRAINT attachments_one_entity_check CHECK(
  (asset_id IS NOT NULL)::int + (work_order_id IS NOT NULL)::int + (employee_id IS NOT NULL)::int = 1
);
ALTER TABLE attachments ADD CONSTRAINT attachments_employee_tenant_fk
  FOREIGN KEY(organization_id,employee_id) REFERENCES employees(organization_id,id) ON DELETE RESTRICT;
CREATE INDEX attachments_employee_time_idx ON attachments(organization_id,employee_id,created_at DESC);

INSERT INTO permission_catalog(code,name,module_code,description) VALUES
('hr.compensation.manage','Цалингийн мэдээлэл удирдах','hr','Цалин, нэмэгдэл болон цалингийн түүх удирдах'),
('hr.sensitive.read','Хүний нөөцийн нууц мэдээлэл харах','hr','Регистр, цалин, гэр бүл болон нууц баримт харах'),
('hr.leave.approve','Чөлөө амралт батлах','hr','Чөлөө, амралтын хүсэлтийг шийдвэрлэх'),
('hr.performance.manage','Гүйцэтгэлийн үнэлгээ удирдах','hr','Ажилтны үнэлгээ, зорилтыг удирдах')
ON CONFLICT(code) DO NOTHING;

INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
SELECT r.organization_id,r.id,p.code FROM organization_roles r CROSS JOIN permission_catalog p
WHERE (r.code IN('owner','administrator') AND p.code LIKE 'hr.%')
   OR (r.code='hr-officer' AND p.code IN('hr.manage','hr.compensation.manage','hr.sensitive.read','hr.leave.approve','hr.performance.manage'))
ON CONFLICT DO NOTHING;

INSERT INTO data_catalog_assets(code,name,domain,source_object,description,classification_code,owner_role_code,contains_personal_data) VALUES
('hr-leave','Employee leave','people','hr_leave_requests','Employee leave request and approval workflow','confidential','hr-officer',true),
('hr-schedule','Employee schedule','people','employee_schedule_assignments','Effective-dated employee work schedule assignments','internal','hr-officer',true),
('hr-attendance-correction','Attendance correction','people','attendance_correction_requests','Audited attendance correction workflow','confidential','hr-officer',true),
('employee-skill','Employee skills','people','employee_skills','Employee-linked skills and expiring certificates','confidential','hr-officer',true),
('hr-performance','Performance review','people','employee_performance_reviews','Employee performance review record','restricted','hr-officer',true),
('hr-transition','Employee transition checklist','people','employee_transition_checklists','Onboarding and offboarding control checklist','confidential','hr-officer',true)
ON CONFLICT(code) DO NOTHING;

CREATE POLICY hr_leave_requests_tenant_policy ON hr_leave_requests USING(organization_id=overva_current_organization_id()) WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY hr_leave_events_tenant_policy ON hr_leave_events USING(organization_id=overva_current_organization_id()) WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY hr_work_schedules_tenant_policy ON hr_work_schedules USING(organization_id=overva_current_organization_id()) WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY employee_schedule_assignments_tenant_policy ON employee_schedule_assignments USING(organization_id=overva_current_organization_id()) WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY attendance_correction_requests_tenant_policy ON attendance_correction_requests USING(organization_id=overva_current_organization_id()) WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY attendance_correction_events_tenant_policy ON attendance_correction_events USING(organization_id=overva_current_organization_id()) WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY employee_skills_tenant_policy ON employee_skills USING(organization_id=overva_current_organization_id()) WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY employee_training_records_tenant_policy ON employee_training_records USING(organization_id=overva_current_organization_id()) WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY employee_performance_reviews_tenant_policy ON employee_performance_reviews USING(organization_id=overva_current_organization_id()) WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY employee_transition_checklists_tenant_policy ON employee_transition_checklists USING(organization_id=overva_current_organization_id()) WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY employee_transition_checklist_items_tenant_policy ON employee_transition_checklist_items USING(organization_id=overva_current_organization_id()) WITH CHECK(organization_id=overva_current_organization_id());
