-- OVERVA AI requirements knowledge foundation.
-- Tenant evidence is append-only. Shared knowledge is reviewed, anonymized and versioned.

CREATE TABLE ai_method_versions (
  code TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version > 0),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  method_definition JSONB NOT NULL,
  source_note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN('draft','active','retired')),
  approved_by UUID REFERENCES platform_admins(id) ON DELETE RESTRICT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(code,version),
  CHECK(jsonb_typeof(method_definition)='object'),
  CHECK((status='active' AND approved_by IS NOT NULL AND approved_at IS NOT NULL) OR status<>'active')
);

CREATE UNIQUE INDEX ai_method_versions_one_active_idx
  ON ai_method_versions(code) WHERE status='active';

CREATE TABLE ai_interview_questions (
  code TEXT NOT NULL,
  method_code TEXT NOT NULL,
  method_version INTEGER NOT NULL,
  sequence_no INTEGER NOT NULL CHECK(sequence_no > 0),
  stage TEXT NOT NULL CHECK(stage IN(
    'context','outcome','customer','as_is','scale','roles_approvals',
    'data_controls','success_measure','nonfunctional','review'
  )),
  prompt_mn TEXT NOT NULL,
  answer_kind TEXT NOT NULL CHECK(answer_kind IN('text','number','boolean','single_choice','multi_choice','structured')),
  options JSONB NOT NULL DEFAULT '[]'::jsonb,
  branch_rule JSONB NOT NULL DEFAULT '{}'::jsonb,
  required BOOLEAN NOT NULL DEFAULT true,
  active BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY(code,method_code,method_version),
  FOREIGN KEY(method_code,method_version) REFERENCES ai_method_versions(code,version) ON DELETE RESTRICT,
  CHECK(jsonb_typeof(options)='array'),
  CHECK(jsonb_typeof(branch_rule)='object')
);

CREATE TABLE ai_interview_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  method_code TEXT NOT NULL,
  method_version INTEGER NOT NULL,
  prompt_version TEXT NOT NULL,
  catalog_version INTEGER NOT NULL DEFAULT 1 CHECK(catalog_version > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN('active','ready_for_review','completed','abandoned')),
  current_stage TEXT NOT NULL DEFAULT 'context',
  started_by UUID NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  FOREIGN KEY(method_code,method_version) REFERENCES ai_method_versions(code,version) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,started_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX ai_interview_sessions_tenant_time_idx ON ai_interview_sessions(organization_id,last_activity_at DESC);

CREATE TABLE ai_interview_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  session_id UUID NOT NULL,
  question_code TEXT NOT NULL,
  answer_text TEXT NOT NULL CHECK(length(answer_text) BETWEEN 1 AND 12000),
  normalized_answer JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence NUMERIC(4,3) CHECK(confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  confirmation_status TEXT NOT NULL DEFAULT 'pending' CHECK(confirmation_status IN('pending','confirmed','corrected','skipped')),
  supersedes_answer_id UUID,
  source TEXT NOT NULL DEFAULT 'user' CHECK(source IN('user','import','ai_assisted')),
  model TEXT,
  provider_response_id TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,session_id) REFERENCES ai_interview_sessions(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,supersedes_answer_id) REFERENCES ai_interview_answers(organization_id,id) ON DELETE RESTRICT,
  CHECK(jsonb_typeof(normalized_answer)='object')
);
CREATE INDEX ai_interview_answers_session_idx ON ai_interview_answers(organization_id,session_id,created_at,id);
CREATE TRIGGER ai_interview_answers_immutable BEFORE UPDATE OR DELETE ON ai_interview_answers
FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

CREATE TABLE ai_requirement_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  session_id UUID,
  requirement_key TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  parent_requirement_id UUID,
  finding TEXT NOT NULL DEFAULT '',
  business_need TEXT NOT NULL DEFAULT '',
  gap TEXT NOT NULL DEFAULT '',
  requirement_text TEXT NOT NULL,
  requirement_type TEXT NOT NULL CHECK(requirement_type IN('business','stakeholder','functional','nonfunctional','transition','data','compliance')),
  user_story JSONB NOT NULL DEFAULT '{}'::jsonb,
  acceptance_criteria JSONB NOT NULL DEFAULT '[]'::jsonb,
  quality_checks JSONB NOT NULL DEFAULT '{}'::jsonb,
  priority_dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
  moscow TEXT CHECK(moscow IS NULL OR moscow IN('must','should','could','wont_this_release')),
  allocation JSONB NOT NULL DEFAULT '{}'::jsonb,
  traceability JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN('draft','verified','validated','approved','baselined','superseded','rejected')),
  created_by UUID NOT NULL,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,requirement_key,version),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,session_id) REFERENCES ai_interview_sessions(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,parent_requirement_id) REFERENCES ai_requirement_records(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,approved_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  CHECK(jsonb_typeof(user_story)='object'),
  CHECK(jsonb_typeof(acceptance_criteria)='array'),
  CHECK(jsonb_typeof(quality_checks)='object'),
  CHECK(jsonb_typeof(priority_dimensions)='object'),
  CHECK(jsonb_typeof(allocation)='object'),
  CHECK(jsonb_typeof(traceability)='object'),
  CHECK((status IN('approved','baselined') AND approved_by IS NOT NULL AND approved_at IS NOT NULL) OR status NOT IN('approved','baselined'))
);
CREATE INDEX ai_requirement_records_tenant_status_idx ON ai_requirement_records(organization_id,status,created_at DESC);

CREATE TABLE ai_recommendation_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  session_id UUID,
  blueprint_id UUID,
  recommendation_type TEXT NOT NULL CHECK(recommendation_type IN('blueprint','department','position','module','workflow','requirement')),
  recommendation_code TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN('accepted','rejected','modified','deferred')),
  reason_code TEXT NOT NULL DEFAULT 'unspecified',
  reason_note TEXT NOT NULL DEFAULT '',
  proposed_value JSONB NOT NULL DEFAULT '{}'::jsonb,
  accepted_value JSONB NOT NULL DEFAULT '{}'::jsonb,
  decided_by UUID NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,session_id) REFERENCES ai_interview_sessions(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,blueprint_id) REFERENCES organization_blueprints(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,decided_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  CHECK(jsonb_typeof(proposed_value)='object'),
  CHECK(jsonb_typeof(accepted_value)='object')
);
CREATE INDEX ai_recommendation_feedback_learning_idx ON ai_recommendation_feedback(decision,recommendation_type,decided_at DESC);
CREATE TRIGGER ai_recommendation_feedback_immutable BEFORE UPDATE OR DELETE ON ai_recommendation_feedback
FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

CREATE TABLE ai_adoption_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  session_id UUID,
  measurement_window TEXT NOT NULL CHECK(measurement_window IN('immediate','day_7','day_30','day_90')),
  metric_code TEXT NOT NULL,
  metric_value NUMERIC,
  outcome TEXT NOT NULL CHECK(outcome IN('positive','neutral','negative','unknown')),
  evidence_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  measured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,session_id,measurement_window,metric_code),
  FOREIGN KEY(organization_id,session_id) REFERENCES ai_interview_sessions(organization_id,id) ON DELETE RESTRICT,
  CHECK(jsonb_typeof(evidence_summary)='object')
);

CREATE TABLE ai_knowledge_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  source_session_id UUID,
  candidate_type TEXT NOT NULL CHECK(candidate_type IN('question','branch_rule','blueprint_rule','requirement_pattern','quality_rule','warning')),
  generalized_content JSONB NOT NULL,
  anonymization_status TEXT NOT NULL DEFAULT 'pending' CHECK(anonymization_status IN('pending','verified','rejected')),
  evidence_count INTEGER NOT NULL DEFAULT 1 CHECK(evidence_count > 0),
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK(review_status IN('pending','approved','rejected','needs_more_evidence')),
  reviewed_by UUID REFERENCES platform_admins(id) ON DELETE RESTRICT,
  review_note TEXT NOT NULL DEFAULT '',
  reviewed_at TIMESTAMPTZ,
  promoted_catalog_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(source_organization_id,source_session_id) REFERENCES ai_interview_sessions(organization_id,id) ON DELETE RESTRICT,
  CHECK(jsonb_typeof(generalized_content)='object'),
  CHECK((review_status IN('approved','rejected') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL) OR review_status NOT IN('approved','rejected'))
);
CREATE INDEX ai_knowledge_candidates_review_idx ON ai_knowledge_candidates(review_status,anonymization_status,created_at);

CREATE TABLE ai_regression_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  case_type TEXT NOT NULL CHECK(case_type IN('interview','normalization','requirement','recommendation','privacy')),
  input_fixture JSONB NOT NULL,
  expected_assertions JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN('draft','active','retired')),
  approved_by UUID REFERENCES platform_admins(id) ON DELETE RESTRICT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(code,version),
  CHECK(jsonb_typeof(input_fixture)='object'),
  CHECK(jsonb_typeof(expected_assertions)='object'),
  CHECK((status='active' AND approved_by IS NOT NULL AND approved_at IS NOT NULL) OR status<>'active')
);

INSERT INTO ai_method_versions(code,version,name,description,method_definition,source_note,status)
VALUES('overva-requirements',1,'OVERVA Requirements Method',
 'Evidence-driven organization discovery and requirement baseline method.',
 '{"flow":["elicit","model","analyze","prioritize","allocate","verify","validate","approve","baseline"],"separations":["finding","business_need","gap","requirement","solution_option"],"quality":["clear","complete","correct","consistent","feasible","testable","traceable"],"priority":["business_value","customer_impact","risk","compliance","dependency","urgency","effort"],"humanApprovalRequired":true,"tenantEvidenceMayNotTrainSharedCatalog":true}'::jsonb,
 'Derived as reusable theory from BA learning material; exercises and example company data excluded.','draft')
ON CONFLICT(code,version) DO NOTHING;

INSERT INTO ai_interview_questions(code,method_code,method_version,sequence_no,stage,prompt_mn,answer_kind,options,branch_rule,required) VALUES
('ORG-CONTEXT','overva-requirements',1,1,'context','Танай байгууллага ямар хэлбэртэй, ямар орчинд үйл ажиллагаа явуулдаг вэ?','structured','[]','{}',true),
('ORG-OUTCOME','overva-requirements',1,2,'outcome','Танай байгууллага хэрэглэгч, иргэн эсвэл дотоод нэгжид ямар бүтээгдэхүүн, үйлчилгээ, үр дүн хүргэдэг вэ?','text','[]','{}',true),
('ORG-CUSTOMER','overva-requirements',1,3,'customer','Тэр үр дүнг хэн хүлээн авдаг вэ? Гол хэрэглэгч, харилцагч эсвэл үр шим хүртэгчээ тайлбарлана уу.','text','[]','{}',true),
('ORG-ASIS','overva-requirements',1,4,'as_is','Өнөөдөр тэр ажлыг эхнээс нь дуустал яаж хийдэг вэ? Гол алхам, хүлээлт, асуудлаа хэлнэ үү.','text','[]','{}',true),
('ORG-SCALE','overva-requirements',1,5,'scale','Ажилтны тоо, салбар/байршил, ээлж болон талбайн ажлын хэмжээгээ хэлнэ үү.','structured','[]','{}',true),
('ORG-APPROVAL','overva-requirements',1,6,'roles_approvals','Ямар шийдвэр, зөвшөөрөл, хяналт шаарддаг вэ? Нэг хүн давхар хийхэд болохгүй үүрэг бий юу?','text','[]','{}',true),
('ORG-DATA','overva-requirements',1,7,'data_controls','Одоогийн мэдээлэл хаана байдаг вэ? Excel, хуучин ERP, цаас, төхөөрөмж эсвэл өөр системээ нэрлэнэ үү.','text','[]','{}',true),
('ORG-VALUE','overva-requirements',1,8,'success_measure','OVERVA нэвтэрсний дараа хамгийн түрүүнд ямар бодит үр дүн гарвал амжилт гэж үзэх вэ?','text','[]','{}',true),
('ORG-NFR','overva-requirements',1,9,'nonfunctional','Аюулгүй байдал, нууцлал, offline/mobile, хурд, хууль дүрмийн зайлшгүй шаардлага бий юу?','text','[]','{}',false),
('ORG-REVIEW','overva-requirements',1,10,'review','Миний ойлгосон байгууллагын загвар, таамаглал, үлдсэн асуултыг хянаж батална уу.','structured','[]','{}',true)
ON CONFLICT(code,method_code,method_version) DO NOTHING;

COMMENT ON TABLE ai_interview_answers IS 'Append-only private tenant evidence. It is never shared training data.';
COMMENT ON TABLE ai_knowledge_candidates IS 'Only generalized, anonymized candidates may be reviewed for promotion to the shared catalog.';
COMMENT ON TABLE ai_requirement_records IS 'Finding, need, gap, requirement and solution allocation remain separate and versioned through baseline.';
