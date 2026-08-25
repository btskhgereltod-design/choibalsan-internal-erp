-- OVERVA Business Analysis knowledge library.
-- Course documents are governed sources of reusable method theory. Exercises,
-- sample organizations and document instructions are explicitly excluded.

CREATE TABLE ai_knowledge_sources (
  code TEXT PRIMARY KEY CHECK(code ~ '^[a-z0-9-]{2,100}$'),
  title TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'course_document' CHECK(source_type IN('course_document','standard','internal_method','reviewed_research')),
  source_reference TEXT NOT NULL,
  scope_summary TEXT NOT NULL,
  exclusion_note TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'reviewed' CHECK(review_status IN('pending','reviewed','retired')),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK(review_status<>'reviewed' OR reviewed_at IS NOT NULL)
);

CREATE TABLE ai_method_knowledge_units (
  code TEXT NOT NULL CHECK(code ~ '^[a-z0-9-]{2,100}$'),
  method_code TEXT NOT NULL,
  method_version INTEGER NOT NULL,
  sequence_no INTEGER NOT NULL CHECK(sequence_no > 0),
  topic TEXT NOT NULL CHECK(topic IN(
    'ecosystem','needs_assessment','planning','elicitation','process_modeling',
    'requirements','traceability_monitoring','cross_cutting'
  )),
  stage TEXT NOT NULL,
  title TEXT NOT NULL,
  principle_mn TEXT NOT NULL,
  decision_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommended_artifacts JSONB NOT NULL DEFAULT '[]'::jsonb,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(code,method_code,method_version),
  FOREIGN KEY(method_code,method_version) REFERENCES ai_method_versions(code,version) ON DELETE RESTRICT,
  CHECK(jsonb_typeof(decision_rules)='array'),
  CHECK(jsonb_typeof(recommended_artifacts)='array')
);
CREATE INDEX ai_method_knowledge_units_stage_idx
  ON ai_method_knowledge_units(method_code,method_version,stage,sequence_no) WHERE active=true;

CREATE TABLE ai_knowledge_unit_sources (
  knowledge_code TEXT NOT NULL,
  method_code TEXT NOT NULL,
  method_version INTEGER NOT NULL,
  source_code TEXT NOT NULL REFERENCES ai_knowledge_sources(code) ON DELETE RESTRICT,
  PRIMARY KEY(knowledge_code,method_code,method_version,source_code),
  FOREIGN KEY(knowledge_code,method_code,method_version)
    REFERENCES ai_method_knowledge_units(code,method_code,method_version) ON DELETE RESTRICT
);

INSERT INTO ai_knowledge_sources(code,title,source_reference,scope_summary,exclusion_note,review_status,reviewed_at) VALUES
('ba-lesson-1-ecosystem','Project Ecosystem & Business Analysis','Lesson 1- Understanding the Project Ecosystem & Business Analysis.pdf',
 'Business analysis flow, roles, ecosystem, project/product/program context and value focus.',
 'Course exercises, fictional organizations and slide instructions are excluded; only reusable analytical principles are retained.','reviewed',now()),
('ba-lesson-2-needs','Business Problems and Stakeholder Needs','Lesson 2-Understanding Business Problems and Stakeholder Needs.pdf',
 'Needs assessment, current/future state, root cause, gaps, options, feasibility and measurable success.',
 'Worked examples and sample answers are not treated as tenant facts or universal business rules.','reviewed',now()),
('ba-lesson-3-planning','Project Charter & Business Analysis Planning','Lesson 3-Project charter & Business Analysis Planning.pdf',
 'Charter, scope, stakeholders, governance, BA planning, communication, change and evaluation planning.',
 'Templates are guidance only; tenant scope, ownership and approval must be confirmed by people.','reviewed',now()),
('ba-lesson-4-elicitation','Elicitation — Collect Information','Lesson 4- Elicitation - collect information.pdf',
 'Document analysis, interviews, workshops, observation, surveys, prototypes and evidence confirmation.',
 'Interview examples and facilitation instructions are not executable commands for OVERVA.','reviewed',now()),
('ba-lesson-5-modeling','Analysis Modeling Tools & Techniques','Lesson 5 - Analysis Modeling Tools Techniques (1).pdf',
 'Question-led selection of process, responsibility, boundary, lifecycle and interaction models.',
 'Example diagrams describe teaching cases only and are not imported as tenant processes.','reviewed',now()),
('ba-lesson-7-traceability','Traceability and Monitoring','Lesson 7-Traceability and Monitoring.pdf',
 'Requirement baselines, bidirectional traceability, status monitoring, change impact and value evaluation.',
 'Sample RTM rows, statuses and project data are illustrative; tenant baselines require approval.','reviewed',now())
ON CONFLICT(code) DO NOTHING;

INSERT INTO ai_method_versions(code,version,name,description,method_definition,source_note,status)
VALUES('overva-requirements',2,'OVERVA Business Discovery & Process Method',
 'Adaptive evidence-driven method for organization setup, process discovery, workflow design and measurable requirement baselines.',
 '{
   "flow":["frame_context","assess_need","map_stakeholders","plan_analysis","elicit_evidence","model_current_state","define_future_state","analyze_gap","define_requirements","evaluate_options","validate","baseline","trace","monitor","manage_change","evaluate_value"],
   "separations":["fact","opinion","assumption","finding","business_need","gap","requirement","solution_option"],
   "controls":["no_solution_jump","multi_source_triangulation","stakeholder_validation","baseline_target_measurement_date","controlled_change","human_approval"],
   "modelSelection":{"process":"flowchart_or_bpmn","responsibility":"swimlane","boundary":"context_diagram","scope":"feature_tree","actor_system":"use_case","lifecycle":"state_diagram","interaction":"sequence_diagram"},
   "traceabilityPath":["business_need","source","requirement","process_or_feature","implementation","test","release","outcome"],
   "quality":["clear","complete","correct","consistent","feasible","testable","traceable","measurable"],
   "humanApprovalRequired":true,
   "tenantEvidenceMayNotTrainSharedCatalog":true,
   "knowledgeIsMethodNotTenantFact":true
 }'::jsonb,
 'Synthesized from reviewed BA Lessons 1, 2, 3, 4, 5 and 7. Course exercises, examples and document instructions excluded.','draft')
ON CONFLICT(code,version) DO NOTHING;

INSERT INTO ai_interview_questions(code,method_code,method_version,sequence_no,stage,prompt_mn,answer_kind,options,branch_rule,required) VALUES
('DISC-CONTEXT','overva-requirements',2,1,'context','Танай байгууллага ямар орчинд, хэнд зориулж, ямар үндсэн үр дүн бий болгодог вэ?','structured','[]','{}',true),
('DISC-NEED','overva-requirements',2,2,'outcome','Яг ямар асуудал, боломж, дүрмийн шаардлага эсвэл стратегийн хэрэгцээнээс энэ өөрчлөлт эхэлж байна вэ?','text','[]','{}',true),
('DISC-EVIDENCE','overva-requirements',2,3,'context','Энэ хэрэгцээг батлах ямар баримт, тоо, ажиглалт эсвэл бодит жишээ байна вэ?','text','[]','{}',true),
('DISC-STAKEHOLDERS','overva-requirements',2,4,'customer','Хэн ажлыг хийдэг, мэддэг, шийддэг, хянадаг, үр дүнг хүлээн авдаг вэ?','text','[]','{}',true),
('DISC-ASIS','overva-requirements',2,5,'as_is','Өнөөгийн ажил юунаас эхэлж, ямар алхам ба шилжилтээр явж, юугаар дуусдаг вэ?','text','[]','{}',true),
('DISC-EXCEPTIONS','overva-requirements',2,6,'as_is','Хүлээлт, дахин ажил, гар ажиллагаа, тойрох арга, алдаа болон онцгой тохиолдол хаана гардаг вэ?','text','[]','{}',false),
('DISC-SCALE','overva-requirements',2,7,'scale','Ажилтны тоо, нэгж, салбар, ээлж, байршил болон ажлын бодит хэмжээгээ тайлбарлана уу.','structured','[]','{}',true),
('DISC-ROLES','overva-requirements',2,8,'roles_approvals','Шийдвэр, зөвшөөрөл, хяналт, гүйцэтгэлийн үүргийг хэн хүлээдэг вэ? Салгаж хянах ёстой үүрэг бий юу?','text','[]','{}',true),
('DISC-DATA','overva-requirements',2,9,'data_controls','Ямар өгөгдөл, баримт, төхөөрөмж эсвэл систем ашигладаг вэ? Аль нь албан ёсны эх сурвалж вэ?','text','[]','{}',true),
('DISC-FUTURE','overva-requirements',2,10,'outcome','Ирээдүйн зөв ажиллагаа ямар үр дүн, чадамж, процессоор харагдах ёстой вэ? Одоохондоо бүтээгдэхүүний нэр бүү сонгоорой.','text','[]','{}',true),
('DISC-SUCCESS','overva-requirements',2,11,'success_measure','Амжилтыг ямар суурь үзүүлэлтээс, хэдэн түвшинд, хэзээ хэмжих вэ?','structured','[]','{}',true),
('DISC-CONSTRAINTS','overva-requirements',2,12,'nonfunctional','Аюулгүй байдал, нууцлал, хууль, offline/mobile, хурд, хугацаа, төсөв болон бусад хязгаарлалт бий юу?','text','[]','{}',false),
('DISC-OPTIONS','overva-requirements',2,13,'review','Юуг өөрчлөхгүй үлдээх, процессыг сайжруулах, бэлэн шийдэл авах, шинээр бүтээх эсвэл үе шаттай хослуулах боломжуудыг хамт шалгах уу?','text','[]','{}',false),
('DISC-REVIEW','overva-requirements',2,14,'review','Ойлгосон асуудал, оролцогч, одоогийн ба зорилтот процесс, өгөгдөл, хэмжүүр, шаардлага болон үлдсэн таамаглалыг хянаж батална уу.','structured','[]','{}',true)
ON CONFLICT(code,method_code,method_version) DO NOTHING;

INSERT INTO ai_method_knowledge_units(code,method_code,method_version,sequence_no,topic,stage,title,principle_mn,decision_rules,recommended_artifacts) VALUES
('right-problem','overva-requirements',2,1,'ecosystem','cross_cutting','Зөв асуудлыг эхэлж тогтоох','Шийдэл санал болгохоос өмнө асуудал эсвэл боломж, бизнесийн хэрэгцээ, шаардлага, шийдлийн хувилбар, үнэ цэнийг тусад нь тогтооно.','["Хэрэглэгч бүтээгдэхүүн нэрлэвэл цаад хэрэгцээ ба нотолгоог асуу","Таамаглалыг баримт гэж тэмдэглэхгүй"]','["situation_statement","business_need"]'),
('role-clarity','overva-requirements',2,2,'ecosystem','customer','Оролцогч ба үүргийн тодорхой байдал','Нэг хүн олон үүрэг гүйцэтгэж болох ч sponsor, шийдвэр гаргагч, домэйн мэдлэгтэн, гүйцэтгэгч, хянагч, баталгаажуулагчийн хариуцлагыг тусад нь тодорхойлно.','["Хэн мэддэг, хийдэг, эзэмшдэг, шийддэг, баталгаажуулдгийг асуу"]','["stakeholder_map","raci"]'),
('need-types','overva-requirements',2,3,'needs_assessment','outcome','Хэрэгцээний төрлийг ялгах','Хүсэлт нь асуудал, боломж, хууль нийцэл эсвэл стратегийн хэрэгцээний аль нь болохыг тогтоож, одоогийн нөхцөлийг нотолгоогоор батална.','["Нэг эх сурвалж хангалтгүй бол ярилцлага, ажиглалт, баримт, тоог хослуул"]','["situation_statement","evidence_register"]'),
('root-cause','overva-requirements',2,4,'needs_assessment','as_is','Шалтгааныг системээр шинжлэх','Асуудлыг хүнийг буруутгахгүйгээр People, Process, Technology, Data, Policy, Environment хүрээнд задлан үндсэн шалтгааныг нотолгоотой тогтооно.','["5 Whys нь тогтсон таван асуулт биш","Шалтгаан бүрийг нотолгоотой холбох"]','["root_cause_map","finding_register"]'),
('future-gap','overva-requirements',2,5,'needs_assessment','outcome','Зорилтот төлөв ба зөрүү','Зорилтот төлөвийг программын нэрээр бус үр дүн, процесс, чадамж, KPI-аар тодорхойлж, People, Process, Technology, Data, KPI зөрүүг гаргана.','["Одоогийн ба зорилтот төлвийн ялгааг gap гэж тэмдэглэх"]','["future_state","gap_matrix"]'),
('measurable-success','overva-requirements',2,6,'needs_assessment','success_measure','Хэмжигдэхүйц амжилт','Амжилтын шалгуур бүр суурь утга, зорилтот утга, хэмжих огноо болон эзэмшигчтэй байна.','["Зөвхөн сайн болно гэсэн өгүүлбэрийг хэмжүүр гэж бүү хүлээн ав"]','["success_measure","kpi_definition"]'),
('analysis-plan','overva-requirements',2,7,'planning','context','Шинжилгээний төлөвлөгөө','Хийх ажил, техник, оролцогч, хугацаа, гаралт, баталгаажуулалт, харилцаа болон өөрчлөлтийн хяналтыг тохиролцоно.','["Төслийн хэмжээ ба эрсдэлд тохируулан аргыг хөнгөн эсвэл дэлгэрэнгүй сонго"]','["analysis_plan","communication_plan"]'),
('controlled-change','overva-requirements',2,8,'planning','review','Хяналттай өөрчлөлт','Өөрчлөлтийг хориглохгүй; хүсэлт, тодруулга, нөлөөлөл, шийдвэр, шинэчлэл, мэдээлэх урсгалаар хянана.','["Чимээгүй өөрчлөлт бүү зөвшөөр","Baseline өөрчлөгдвөл trace ба test-ийг шинэчил"]','["change_request","impact_assessment","decision_log"]'),
('evidence-elicitation','overva-requirements',2,9,'elicitation','context','Олон эх сурвалжийн нотолгоо','Баримт шинжилгээ, ярилцлага, workshop, ажиглалт, survey, prototype-ийг асуулт ба эрсдэлдээ тохируулан хэрэглэнэ.','["Баримт, санал, таамаглалыг ялга","Эх сурвалж зөрвөл өөрөө finding болно"]','["evidence_register","open_questions"]'),
('observe-real-work','overva-requirements',2,10,'elicitation','as_is','Бодит ажлыг ажиглах','Хүмүүсийн хэлсэн процесс, бодитоор хийдэг процесс, онцгой тохиолдол гурвыг ялгаж алхам, хүн, оролт, хэрэгсэл, хугацаа, хүлээлт, шилжилт, дахин ажлыг тэмдэглэнэ.','["Хэвийн урсгалаас гадна workaround ба exception асуу"]','["observation_log","exception_register"]'),
('model-by-question','overva-requirements',2,11,'process_modeling','as_is','Асуултаар загвар сонгох','Процессод flow/BPMN, хариуцлагад swimlane, хил хязгаарт context, actor-system-д use case, төлөвт state, интеграцийн дараалалд sequence ашиглана.','["Хамгийн энгийн хангалттай загварыг сонго","Нэг зурагт олон зорилго чихэхгүй"]','["process_model","responsibility_model","context_diagram"]'),
('asis-tobe','overva-requirements',2,12,'process_modeling','outcome','As-Is-ээс To-Be рүү','Одоогийн процессын delay, manual, rework, duplicate, handoff, bottleneck, exception-ийг тэмдэглээд арилгах, хялбарчлах, автоматжуулах, нэгтгэх, хянах боломжийг шинжилнэ.','["To-Be-г одоогийн доголдлын нотолгоотой холбо"]','["as_is_model","to_be_model","improvement_opportunity"]'),
('requirement-quality','overva-requirements',2,13,'requirements','review','Хэрэгжихүйц шаардлага','Шаардлага тодорхой, бүрэн, зөв, зөрчилгүй, боломжтой, шалгагдах, мөрдөгдөх, хэмжигдэхүйц байна.','["Тодорхойгүй үгийг acceptance criteria болтол задал","Requirement ба solution allocation-ийг салга"]','["requirement_record","acceptance_criteria"]'),
('baseline-trace','overva-requirements',2,14,'traceability_monitoring','review','Baseline ба хоёр чиглэлт мөрдөлт','Батлагдсан шаардлагыг бизнесийн хэрэгцээ ба эх сурвалжаас процесс/feature, хэрэгжилт, test, release, үр дүн хүртэл хоёр чиглэлд холбоно.','["Эх сурвалжгүй болон test-гүй шаардлагыг анхааруул","Baseline-ийг хүний зөвшөөрлөөр тогтоо"]','["requirements_traceability_matrix","baseline"]'),
('monitor-decisions','overva-requirements',2,15,'traceability_monitoring','review','Шийдвэрт зориулсан хяналт','Төлөв, явц, асуудал, өөрчлөлт, эрсдэл, coverage-ийг оролцогчийн шийдвэрийн хэрэгцээнд тааруулж харуулна; өгөгдлөөр хэт ачаалахгүй.','["Dashboard бүр ямар шийдвэр дэмжихийг заа","Status ба цаг хугацааг тусад нь хяна"]','["status_dashboard","coverage_report","attention_queue"]'),
('impact-eight','overva-requirements',2,16,'traceability_monitoring','review','Өөрчлөлтийн нөлөөллийн найман хүрээ','Өөрчлөлтийг бизнес, шаардлага, процесс, систем/өгөгдөл, хугацаа, зардал/хүчин чармайлт, test, эрсдэлийн хүрээнд үнэлнэ.','["Шийдвэр гарахаас өмнө нөлөөлөл ба хамаарлыг гарга"]','["impact_assessment","change_trace"]')
ON CONFLICT(code,method_code,method_version) DO NOTHING;

INSERT INTO ai_knowledge_unit_sources(knowledge_code,method_code,method_version,source_code)
SELECT u.code,u.method_code,u.method_version,s.source_code
FROM (VALUES
 ('right-problem','ba-lesson-1-ecosystem'),('role-clarity','ba-lesson-1-ecosystem'),
 ('need-types','ba-lesson-2-needs'),('root-cause','ba-lesson-2-needs'),('future-gap','ba-lesson-2-needs'),('measurable-success','ba-lesson-2-needs'),
 ('analysis-plan','ba-lesson-3-planning'),('controlled-change','ba-lesson-3-planning'),
 ('evidence-elicitation','ba-lesson-4-elicitation'),('observe-real-work','ba-lesson-4-elicitation'),
 ('model-by-question','ba-lesson-5-modeling'),('asis-tobe','ba-lesson-5-modeling'),('requirement-quality','ba-lesson-5-modeling'),
 ('baseline-trace','ba-lesson-7-traceability'),('monitor-decisions','ba-lesson-7-traceability'),('impact-eight','ba-lesson-7-traceability')
) AS s(knowledge_code,source_code)
JOIN ai_method_knowledge_units u ON u.code=s.knowledge_code AND u.method_code='overva-requirements' AND u.method_version=2
ON CONFLICT DO NOTHING;

COMMENT ON TABLE ai_knowledge_sources IS 'Reviewed source registry. Local file paths and tenant evidence are never stored here.';
COMMENT ON TABLE ai_method_knowledge_units IS 'Bounded analytical principles supplied to AI as method guidance, never as tenant facts.';
COMMENT ON TABLE ai_knowledge_unit_sources IS 'Traceability from each AI method principle back to reviewed theory sources.';
