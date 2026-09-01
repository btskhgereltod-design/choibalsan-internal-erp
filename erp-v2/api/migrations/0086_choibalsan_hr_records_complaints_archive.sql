-- Choibalsan Hugjil bounded HR, correspondence, complaint and archive release.
-- This migration is additive except for widening existing CHECK constraints.
-- It deliberately creates no historical domain/workflow events and does not
-- infer employee numbers, appointments, correspondence or archive history.

INSERT INTO module_catalog(code,name,description,category,monthly_price,core,active) VALUES
('complaints','Өргөдөл, гомдол','Өргөдөл, гомдол, санал хүсэлтийг бүртгэх, хуваарилах, шийдвэрлэх, хариу хүргэх','Захиргаа',0,false,true)
ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,
 category=EXCLUDED.category,core=false,active=true;

INSERT INTO organization_modules(organization_id,module_code,enabled)
SELECT id,'complaints',true FROM organizations WHERE slug='choibalsan-hugjil'
ON CONFLICT(organization_id,module_code) DO UPDATE SET enabled=true,enabled_at=now();

INSERT INTO permission_catalog(code,name,module_code,description) VALUES
('hr.appointment.manage','Томилгооны хэрэг хөтлөх','hr','Томилгооны хэрэг бүртгэх, хянах, засварт буцаах'),
('hr.appointment.finalize','Томилгоог эцэслэх','hr','Батлагдсан томилгоогоор ажилтны үндсэн бүртгэл үүсгэх эсвэл холбох'),
('hr.leave.request','Чөлөө хүсэх','hr','Өөрийн чөлөөний хүсэлтийг бүртгэх'),
('hr.leave.manage','Чөлөөний хэрэг хөтлөх','hr','Чөлөөний хүсэлт хуваарилах, хянах'),
('hr.exit.manage','Ажлаас гарах хэрэг хөтлөх','hr','Ажил эрхлэлтийн гаралтын хэрэг, хүлээлцэх жагсаалт хөтлөх'),
('hr.exit.finalize','Ажил эрхлэлтийн гаралтыг эцэслэх','hr','Батлагдсан гаралтыг ажилтны lifecycle-д хүчин төгөлдөр болгох'),
('records.read','Албан бичиг харах','records','Эрхийн хүрээнд албан бичиг харах'),
('records.register','Албан бичиг бүртгэх','records','Ирсэн, явсан, дотоод албан бичиг бүртгэх'),
('records.assign','Албан бичиг хуваарилах','records','Албан бичиг хуваарилах, дахин хуваарилах'),
('records.process','Албан бичиг боловсруулах','records','Албан бичиг боловсруулах, хариу бэлтгэх'),
('records.response.approve','Албан хариу батлах','records','Гадагш хүргэх албан хариуг батлах'),
('records.response.send','Албан хариу илгээх','records','Батлагдсан албан хариуг серверээр хүргэгдсэнд бүртгэх'),
('complaints.read','Өргөдөл, гомдол харах','complaints','Эрхийн хүрээнд өргөдөл, гомдол харах'),
('complaints.register','Өргөдөл, гомдол бүртгэх','complaints','Өргөдөл, гомдол хүлээн авах, бүртгэх'),
('complaints.assign','Өргөдөл, гомдол хуваарилах','complaints','Хэрэг хуваарилах, дахин хуваарилах'),
('complaints.process','Өргөдөл, гомдол шийдвэрлэх','complaints','Хэрэг боловсруулах, хариу бэлтгэх'),
('complaints.response.approve','Өргөдөл, гомдлын хариу батлах','complaints','Хариуг батлах, татгалзах, засварт буцаах'),
('complaints.response.send','Өргөдөл, гомдлын хариу илгээх','complaints','Батлагдсан хариуг хүргэгдсэнд бүртгэх'),
('archive.read','Архив харах','archive','Эрхийн хүрээнд архивын бүртгэл харах'),
('archive.intake','Архив хүлээн авах','archive','Баримтыг архивт шилжүүлэн хүлээн авах'),
('archive.access.manage','Архив ашиглалт удирдах','archive','Архив ашиглах хүсэлт, олголт, буцаалтыг удирдах'),
('archive.retention.review','Хадгалалтын хугацаа хянах','archive','Хадгалалтын хугацаа болон устгах саналыг хянах'),
('archive.destruction.approve','Архив устгах санал батлах','archive','Комиссын шийдвэрийг бүртгэх'),
('archive.disposal.execute','Архивын устгал гүйцэтгэх','archive','Батлагдсан устгалын актыг гүйцэтгэгчээр бүртгэх'),
('archive.disposal.verify','Архивын устгал баталгаажуулах','archive','Гүйцэтгэгчээс тусдаа этгээд эцсийн устгалыг баталгаажуулах'),
('documents.restricted.read','Хязгаарлагдмал баримт харах','records','Нууц болон маш нууц баримтыг backend-ээр унших')
ON CONFLICT(code) DO NOTHING;

INSERT INTO organization_roles(organization_id,code,name,system)
SELECT o.id,r.code,r.name,true FROM organizations o CROSS JOIN (VALUES
 ('unit-manager','Нэгжийн удирдлага'),('executive','Удирдах албан тушаалтан'),('auditor','Аудитор')
) r(code,name)
ON CONFLICT(organization_id,code) DO NOTHING;

INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
SELECT r.organization_id,r.id,p.code
FROM organization_roles r
JOIN permission_catalog p ON
 (r.code IN('owner','administrator') AND p.code IN(
   'hr.appointment.manage','hr.appointment.finalize','hr.leave.request','hr.leave.manage','hr.exit.manage','hr.exit.finalize',
   'records.read','records.register','records.assign','records.process','records.response.approve','records.response.send',
   'complaints.read','complaints.register','complaints.assign','complaints.process','complaints.response.approve','complaints.response.send',
   'archive.read','archive.intake','archive.access.manage','archive.retention.review','archive.destruction.approve',
   'archive.disposal.execute','archive.disposal.verify','documents.restricted.read','workflow.coordinate'))
 OR (r.code='hr-officer' AND p.code IN('hr.appointment.manage','hr.leave.request','hr.leave.manage','hr.exit.manage','workflow.coordinate'))
 OR (r.code='records-officer' AND p.code IN('records.read','records.register','records.assign','records.process','complaints.read','complaints.register','complaints.assign','complaints.process','workflow.coordinate'))
 OR (r.code='archivist' AND p.code IN('archive.read','archive.intake','archive.access.manage','archive.retention.review','workflow.coordinate'))
 OR (r.code='manager' AND p.code IN('hr.leave.request','hr.leave.manage','hr.appointment.finalize','hr.exit.finalize','records.read','records.process','records.response.approve','complaints.read','complaints.process','complaints.response.approve','archive.destruction.approve','workflow.coordinate'))
 OR (r.code='unit-manager' AND p.code IN('hr.leave.request','hr.leave.manage','records.read','records.process','complaints.read','complaints.process','workflow.coordinate'))
 OR (r.code IN('executive') AND p.code IN('hr.appointment.finalize','hr.exit.finalize','records.response.approve','complaints.response.approve','archive.destruction.approve','workflow.coordinate'))
 OR (r.code='auditor' AND p.code IN('records.read','complaints.read','archive.read'))
 OR (r.code='member' AND p.code='hr.leave.request')
ON CONFLICT DO NOTHING;

CREATE TABLE hr_appointment_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  case_no TEXT NOT NULL,
  person_key TEXT,
  candidate_full_name TEXT NOT NULL,
  candidate_contact TEXT NOT NULL DEFAULT '',
  candidate_identity JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN('draft','documents_pending','hr_review','management_review','returned','approved','rejected','appointed','cancelled')),
  position_id UUID,
  organization_unit_id UUID,
  effective_date DATE,
  order_document_id UUID,
  employee_id UUID,
  workflow_case_id UUID,
  version BIGINT NOT NULL DEFAULT 0 CHECK(version>=0),
  idempotency_key TEXT NOT NULL,
  payload_sha256 CHAR(64) NOT NULL,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,case_no),
  UNIQUE(organization_id,idempotency_key),
  UNIQUE(organization_id,person_key),
  FOREIGN KEY(organization_id,position_id) REFERENCES positions(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,organization_unit_id) REFERENCES departments(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,order_document_id) REFERENCES documents(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,employee_id) REFERENCES employees(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,workflow_case_id) REFERENCES workflow_cases(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX hr_appointment_cases_queue_idx ON hr_appointment_cases(organization_id,status,updated_at DESC);

CREATE TABLE hr_appointment_document_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  appointment_case_id UUID NOT NULL,
  requirement_code TEXT NOT NULL,
  title TEXT NOT NULL,
  required BOOLEAN NOT NULL DEFAULT true,
  document_id UUID,
  verified_by UUID,
  verified_at TIMESTAMPTZ,
  note TEXT NOT NULL DEFAULT '',
  version BIGINT NOT NULL DEFAULT 0 CHECK(version>=0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,appointment_case_id,requirement_code),
  FOREIGN KEY(organization_id,appointment_case_id) REFERENCES hr_appointment_cases(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,document_id) REFERENCES documents(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,verified_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);

CREATE TABLE hr_employment_exit_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  case_no TEXT NOT NULL,
  employee_id UUID NOT NULL,
  exit_type TEXT NOT NULL CHECK(exit_type IN('voluntary','retirement','dismissal','other')),
  initiation_source TEXT NOT NULL CHECK(initiation_source IN('employee','management','hr','legal','other')),
  reason TEXT NOT NULL,
  legal_policy_reference TEXT NOT NULL DEFAULT '',
  effective_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'initiated' CHECK(status IN('initiated','hr_review','management_review','returned','approved','rejected','handover','finalized','cancelled')),
  order_document_id UUID,
  workflow_case_id UUID,
  version BIGINT NOT NULL DEFAULT 0 CHECK(version>=0),
  idempotency_key TEXT NOT NULL,
  payload_sha256 CHAR(64) NOT NULL,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,case_no),
  UNIQUE(organization_id,idempotency_key),
  FOREIGN KEY(organization_id,employee_id) REFERENCES employees(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,order_document_id) REFERENCES documents(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,workflow_case_id) REFERENCES workflow_cases(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX hr_exit_one_open_case_idx ON hr_employment_exit_cases(organization_id,employee_id)
  WHERE status NOT IN('rejected','finalized','cancelled');

CREATE TABLE hr_exit_handover_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  exit_case_id UUID NOT NULL,
  item_type TEXT NOT NULL CHECK(item_type IN('asset','document','access','work','other')),
  title TEXT NOT NULL,
  required BOOLEAN NOT NULL DEFAULT true,
  completed_at TIMESTAMPTZ,
  completed_by UUID,
  evidence_document_id UUID,
  note TEXT NOT NULL DEFAULT '',
  version BIGINT NOT NULL DEFAULT 0 CHECK(version>=0),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,exit_case_id) REFERENCES hr_employment_exit_cases(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,completed_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,evidence_document_id) REFERENCES documents(organization_id,id) ON DELETE RESTRICT
);

ALTER TABLE hr_leave_requests ADD COLUMN version BIGINT NOT NULL DEFAULT 0 CHECK(version>=0);
ALTER TABLE hr_leave_requests ADD COLUMN workflow_case_id UUID;
ALTER TABLE hr_leave_requests ADD COLUMN assigned_user_id UUID;
ALTER TABLE hr_leave_requests ADD COLUMN supporting_document_id UUID;
ALTER TABLE hr_leave_requests ADD COLUMN routing_policy JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE hr_leave_requests ADD COLUMN idempotency_key TEXT;
ALTER TABLE hr_leave_requests ADD COLUMN payload_sha256 CHAR(64);
ALTER TABLE hr_leave_requests DROP CONSTRAINT hr_leave_requests_status_check;
ALTER TABLE hr_leave_requests ADD CONSTRAINT hr_leave_requests_status_check
  CHECK(status IN('pending','manager_review','hr_review','returned','approved','rejected','cancelled'));
ALTER TABLE hr_leave_requests DROP CONSTRAINT hr_leave_requests_check1;
ALTER TABLE hr_leave_requests ADD CONSTRAINT hr_leave_requests_decision_evidence_check
  CHECK((status IN('approved','rejected') AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
    OR status IN('pending','manager_review','hr_review','returned','cancelled'));
ALTER TABLE hr_leave_events DROP CONSTRAINT hr_leave_events_event_type_check;
ALTER TABLE hr_leave_events ADD CONSTRAINT hr_leave_events_event_type_check
  CHECK(event_type IN('requested','routed','returned','resubmitted','approved','rejected','cancelled'));
ALTER TABLE hr_leave_requests ADD CONSTRAINT hr_leave_workflow_tenant_fk FOREIGN KEY(organization_id,workflow_case_id) REFERENCES workflow_cases(organization_id,id) ON DELETE RESTRICT;
ALTER TABLE hr_leave_requests ADD CONSTRAINT hr_leave_assignee_tenant_fk FOREIGN KEY(organization_id,assigned_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT;
ALTER TABLE hr_leave_requests ADD CONSTRAINT hr_leave_document_tenant_fk FOREIGN KEY(organization_id,supporting_document_id) REFERENCES documents(organization_id,id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX hr_leave_idempotency_uidx ON hr_leave_requests(organization_id,idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE correspondence_records ADD COLUMN version BIGINT NOT NULL DEFAULT 0 CHECK(version>=0);
ALTER TABLE correspondence_records ADD COLUMN workflow_case_id UUID;
ALTER TABLE correspondence_records ADD COLUMN channel TEXT NOT NULL DEFAULT 'paper' CHECK(channel IN('paper','electronic','both','email','web','hand_delivery','other'));
ALTER TABLE correspondence_records ADD COLUMN confidentiality TEXT NOT NULL DEFAULT 'internal' CHECK(confidentiality IN('public','internal','confidential','restricted'));
ALTER TABLE correspondence_records ADD COLUMN assigned_unit_id UUID;
ALTER TABLE correspondence_records ADD COLUMN response_document_id UUID;
ALTER TABLE correspondence_records ADD COLUMN management_resolution TEXT NOT NULL DEFAULT '';
ALTER TABLE correspondence_records ADD COLUMN closed_at TIMESTAMPTZ;
ALTER TABLE correspondence_records ADD COLUMN idempotency_key TEXT;
ALTER TABLE correspondence_records ADD COLUMN payload_sha256 CHAR(64);
ALTER TABLE correspondence_records DROP CONSTRAINT correspondence_records_status_check;
ALTER TABLE correspondence_records ADD CONSTRAINT correspondence_records_status_check
  CHECK(status IN('registered','assigned','in_progress','response_draft','response_review','response_approved','responded','closed','archived','returned','cancelled'));
ALTER TABLE correspondence_records ADD CONSTRAINT correspondence_workflow_tenant_fk FOREIGN KEY(organization_id,workflow_case_id) REFERENCES workflow_cases(organization_id,id) ON DELETE RESTRICT;
ALTER TABLE correspondence_records ADD CONSTRAINT correspondence_unit_tenant_fk FOREIGN KEY(organization_id,assigned_unit_id) REFERENCES departments(organization_id,id) ON DELETE RESTRICT;
ALTER TABLE correspondence_records ADD CONSTRAINT correspondence_response_document_tenant_fk FOREIGN KEY(organization_id,response_document_id) REFERENCES documents(organization_id,id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX correspondence_idempotency_uidx ON correspondence_records(organization_id,idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE correspondence_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  correspondence_id UUID NOT NULL,
  version BIGINT NOT NULL CHECK(version>=0),
  event_type TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT,
  actor_user_id UUID NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,correspondence_id) REFERENCES correspondence_records(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,actor_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  UNIQUE(organization_id,correspondence_id,request_id)
);
CREATE INDEX correspondence_events_timeline_idx ON correspondence_events(organization_id,correspondence_id,version,created_at,id);

CREATE TABLE correspondence_delivery_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  correspondence_id UUID NOT NULL,
  channel TEXT NOT NULL,
  recipient TEXT NOT NULL,
  delivery_reference TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL CHECK(outcome IN('sent','delivered','failed','returned')),
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,correspondence_id) REFERENCES correspondence_records(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,actor_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);

CREATE TABLE complaint_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  registration_no TEXT NOT NULL,
  case_type TEXT NOT NULL CHECK(case_type IN('request','complaint','suggestion','other')),
  requester_name TEXT NOT NULL,
  requester_contact TEXT NOT NULL DEFAULT '',
  source_channel TEXT NOT NULL CHECK(source_channel IN('paper','email','web','phone','in_person','other')),
  category TEXT NOT NULL,
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  confidentiality TEXT NOT NULL DEFAULT 'internal' CHECK(confidentiality IN('public','internal','confidential','restricted')),
  status TEXT NOT NULL DEFAULT 'received' CHECK(status IN('received','validating','registered','assigned','in_progress','under_review','response_approved','response_sent','closed','returned_for_completion','rejected','cancelled')),
  assigned_unit_id UUID,
  assigned_user_id UUID,
  due_date DATE,
  resolution TEXT NOT NULL DEFAULT '',
  response_document_id UUID,
  close_reason TEXT NOT NULL DEFAULT '',
  workflow_case_id UUID,
  version BIGINT NOT NULL DEFAULT 0 CHECK(version>=0),
  idempotency_key TEXT NOT NULL,
  payload_sha256 CHAR(64) NOT NULL,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,registration_no),
  UNIQUE(organization_id,idempotency_key),
  FOREIGN KEY(organization_id,assigned_unit_id) REFERENCES departments(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,assigned_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,response_document_id) REFERENCES documents(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,workflow_case_id) REFERENCES workflow_cases(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX complaint_cases_queue_idx ON complaint_cases(organization_id,status,due_date,updated_at DESC);

CREATE TABLE domain_command_receipts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  domain_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  command_type TEXT NOT NULL,
  idempotency_key UUID NOT NULL,
  payload_sha256 CHAR(64) NOT NULL,
  result JSONB NOT NULL,
  actor_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,domain_type,entity_id,command_type,idempotency_key),
  FOREIGN KEY(organization_id,actor_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);

CREATE TABLE complaint_case_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  complaint_case_id UUID NOT NULL,
  version BIGINT NOT NULL CHECK(version>=0),
  event_type TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT,
  actor_user_id UUID NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,complaint_case_id) REFERENCES complaint_cases(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,actor_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  UNIQUE(organization_id,complaint_case_id,request_id)
);
CREATE INDEX complaint_case_events_timeline_idx ON complaint_case_events(organization_id,complaint_case_id,version,created_at,id);

CREATE TABLE complaint_delivery_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  complaint_case_id UUID NOT NULL,
  channel TEXT NOT NULL,
  recipient TEXT NOT NULL,
  delivery_reference TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN('sent','delivered','failed','returned')),
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,complaint_case_id) REFERENCES complaint_cases(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,actor_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);

ALTER TABLE archive_records ADD COLUMN version BIGINT NOT NULL DEFAULT 0 CHECK(version>=0);
ALTER TABLE archive_records ADD COLUMN workflow_case_id UUID;
ALTER TABLE archive_records ADD COLUMN retention_class TEXT NOT NULL DEFAULT 'unclassified';
ALTER TABLE archive_records ADD COLUMN retention_starts_on DATE;
ALTER TABLE archive_records ADD COLUMN retention_ends_on DATE;
ALTER TABLE archive_records ADD COLUMN transferred_from_type TEXT;
ALTER TABLE archive_records ADD COLUMN transferred_from_id TEXT;
ALTER TABLE archive_records ADD COLUMN legal_hold_checked_at TIMESTAMPTZ;
ALTER TABLE archive_records ADD COLUMN idempotency_key TEXT;
ALTER TABLE archive_records ADD COLUMN payload_sha256 CHAR(64);
ALTER TABLE archive_records DROP CONSTRAINT archive_records_status_check;
ALTER TABLE archive_records ADD CONSTRAINT archive_records_status_check
  CHECK(status IN('intake_pending','active','checked_out','transferred','retention_review','due_for_disposal','destruction_proposed','destruction_approved','disposed','cancelled'));
ALTER TABLE archive_records ADD CONSTRAINT archive_workflow_tenant_fk FOREIGN KEY(organization_id,workflow_case_id) REFERENCES workflow_cases(organization_id,id) ON DELETE RESTRICT;
ALTER TABLE archive_records ADD CONSTRAINT archive_retention_dates_check CHECK(retention_ends_on IS NULL OR retention_starts_on IS NULL OR retention_ends_on>=retention_starts_on);
CREATE UNIQUE INDEX archive_idempotency_uidx ON archive_records(organization_id,idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE archive_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  archive_record_id UUID NOT NULL,
  version BIGINT NOT NULL CHECK(version>=0),
  event_type TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT,
  actor_user_id UUID NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,archive_record_id) REFERENCES archive_records(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,actor_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  UNIQUE(organization_id,archive_record_id,request_id)
);
CREATE INDEX archive_events_timeline_idx ON archive_events(organization_id,archive_record_id,version,created_at,id);

CREATE TABLE archive_access_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  archive_record_id UUID NOT NULL,
  requester_user_id UUID NOT NULL,
  purpose TEXT NOT NULL,
  access_type TEXT NOT NULL CHECK(access_type IN('view','copy','borrow','certified_reference')),
  status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN('requested','approved','rejected','issued','returned','cancelled','overdue')),
  due_back_at TIMESTAMPTZ,
  decided_by UUID,
  decided_at TIMESTAMPTZ,
  issued_by UUID,
  issued_at TIMESTAMPTZ,
  returned_to UUID,
  returned_at TIMESTAMPTZ,
  condition_note TEXT NOT NULL DEFAULT '',
  workflow_case_id UUID,
  version BIGINT NOT NULL DEFAULT 0 CHECK(version>=0),
  idempotency_key TEXT NOT NULL,
  payload_sha256 CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,idempotency_key),
  FOREIGN KEY(organization_id,archive_record_id) REFERENCES archive_records(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,requester_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,decided_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,issued_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,returned_to) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,workflow_case_id) REFERENCES workflow_cases(organization_id,id) ON DELETE RESTRICT
);

CREATE TABLE archive_destruction_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  archive_record_id UUID NOT NULL,
  proposal_no TEXT NOT NULL,
  reason TEXT NOT NULL,
  item_set_sha256 CHAR(64) NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN('proposed','commission_review','approved','rejected','executed','verified','cancelled')),
  external_approval_reference TEXT NOT NULL DEFAULT '',
  workflow_case_id UUID,
  version BIGINT NOT NULL DEFAULT 0 CHECK(version>=0),
  idempotency_key TEXT NOT NULL,
  payload_sha256 CHAR(64) NOT NULL,
  proposed_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,proposal_no),
  UNIQUE(organization_id,idempotency_key),
  FOREIGN KEY(organization_id,archive_record_id) REFERENCES archive_records(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,workflow_case_id) REFERENCES workflow_cases(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,proposed_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);

CREATE TABLE archive_commission_decisions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  proposal_id UUID NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN('approved','rejected','returned')),
  reason TEXT NOT NULL,
  actor_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,proposal_id) REFERENCES archive_destruction_proposals(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,actor_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);

CREATE TABLE archive_disposal_acts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  proposal_id UUID NOT NULL,
  act_no TEXT NOT NULL,
  act_document_id UUID NOT NULL,
  item_set_sha256 CHAR(64) NOT NULL,
  executed_by UUID NOT NULL,
  executed_at TIMESTAMPTZ NOT NULL,
  verified_by UUID,
  verified_at TIMESTAMPTZ,
  method TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,proposal_id),
  UNIQUE(organization_id,act_no),
  FOREIGN KEY(organization_id,proposal_id) REFERENCES archive_destruction_proposals(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,act_document_id) REFERENCES documents(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,executed_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,verified_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  CHECK(verified_by IS NULL OR verified_by<>executed_by)
);

-- Immutable domain evidence. Current-state aggregate rows above remain mutable
-- only through named server commands with version guards.
DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'correspondence_events','correspondence_delivery_events','complaint_case_events','complaint_delivery_events',
    'archive_events','archive_commission_decisions','archive_disposal_acts','domain_command_receipts'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation()',table_name,table_name);
  END LOOP;
END $$;

-- New tenant tables are safe to enforce immediately because their only writers
-- are transaction-scoped Phase 2 services. Existing aggregate tables retain
-- staged policies until every pre-Phase-2 compatibility route is retired.
DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'hr_appointment_cases','hr_appointment_document_requirements','hr_employment_exit_cases','hr_exit_handover_items',
    'correspondence_events','correspondence_delivery_events','complaint_cases','complaint_case_events','complaint_delivery_events',
    'archive_events','archive_access_requests','archive_destruction_proposals','archive_commission_decisions','archive_disposal_acts',
    'domain_command_receipts'
  ] LOOP
    EXECUTE format('CREATE POLICY %I_tenant_policy ON %I USING(organization_id=overva_current_organization_id()) WITH CHECK(organization_id=overva_current_organization_id())',table_name,table_name);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
  END LOOP;
END $$;

COMMENT ON TABLE complaint_cases IS 'Authoritative request/complaint case state. workflow_cases is coordination evidence only.';
COMMENT ON TABLE hr_appointment_cases IS 'Authoritative appointment case. Existing employees receive no fabricated appointment history.';
COMMENT ON TABLE hr_employment_exit_cases IS 'Authoritative governed employment-exit case; employee lifecycle changes only at explicit finalization.';
COMMENT ON TABLE archive_disposal_acts IS 'Immutable destruction evidence. Verification requires a different actor and server confirmation.';
