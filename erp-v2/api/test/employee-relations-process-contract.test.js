"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const root=path.join(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const migration=read("migrations/0091_complaint_resolution_and_hr_handoff.sql");
const transferMigration=read("migrations/0092_hr_employee_transfer_cases.sql");
const disciplineMigration=read("migrations/0093_hr_disciplinary_cases.sql");
const complaints=read("src/routes/complaints.js");
const handoffService=read("src/services/complaint-hr-handoff.js");
const hr=read("src/routes/hr-workflows.js");
const discipline=read("src/routes/hr-discipline.js");
const disciplineDeadline=read("src/services/discipline-deadline.js");
const documents=read("src/routes/documents.js");
const assignments=read("src/services/employee-assignment.js");
const ui=read("../web/administration.js");
const production=read("scripts/production-migrate.js");
const plan=read("../docs/EMPLOYEE_RELATIONS_PROCESS_IMPLEMENTATION_PLAN_V1.md");

test("employee-relations delivery is staged across separate domain authorities",()=>{
  for(const heading of ["Complaints extension","Employee transfer/rotation","Disciplinary case"])assert.match(plan,new RegExp(heading));
  assert.match(plan,/Shared workflow is coordination evidence only/);
  assert.match(plan,/must not\s+create a disciplinary case/);
});

test("0091 extends the authoritative complaint lifecycle without synthetic history",()=>{
  assert.match(migration,/ALTER TABLE complaint_cases/);
  assert.match(migration,/implementation_monitoring/);
  assert.doesNotMatch(migration,/CREATE TABLE complaint_cases/);
  assert.doesNotMatch(migration,/INSERT INTO complaint_cases/);
  assert.doesNotMatch(migration,/UPDATE complaint_cases/);
});

test("complaint to HR handoff is explicit tenant scoped and not a discipline case",()=>{
  for(const token of ["CREATE TABLE complaint_hr_handoffs","CREATE TABLE complaint_hr_handoff_events","complaints.handoff.create","hr.discipline.intake","ENABLE ROW LEVEL SECURITY","overva_reject_audit_mutation"])assert.match(migration,new RegExp(token));
  assert.match(migration,/target_discipline_case_id UUID/);
  assert.match(migration,/Acceptance must atomically create a separately authoritative disciplinary case/);
  assert.doesNotMatch(migration,/CREATE TABLE hr_discipline_cases/);
  assert.doesNotMatch(complaints,/INSERT INTO hr_discipline/);
});

test("complaint handoff command is versioned idempotent audited and links canonical evidence",()=>{
  for(const token of ["expectedVersion","idempotencyKey","request_discipline_handoff","transitionAggregate","recordDocumentLink","complaint_hr_handoff_events"])assert.match(handoffService,new RegExp(token));
  assert.match(handoffService,/entityType:"complaint_hr_handoff"/);
  assert.match(handoffService,/permissions:\["complaints\.handoff\.create"\]/);
  assert.match(handoffService,/IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD/);
  assert.match(complaints,/requestHrDisciplineAssessment/);
});

test("complaint resolution supports information request and optional implementation monitoring",()=>{
  for(const token of ["request_information","start_implementation_monitoring","complete_implementation","COMMAND_REASON_REQUIRED"])assert.match(complaints,new RegExp(token));
  assert.match(ui,/Нэмэлт мэдээлэл хүсэх/);
  assert.match(ui,/Хэрэгжилт хянах/);
  assert.match(ui,/HR хяналтад шилжүүлэх/);
});

test("handoff evidence remains append only under production runtime grants",()=>{
  assert.match(production,/complaint_hr_handoff_events/);
  assert.match(production,/REVOKE UPDATE,DELETE,TRUNCATE/);
});

test("legal references are treated as verified boundary rather than a Visio hard-code",()=>{
  for(const article of ["article 58","article 59","article 123","article 154"])assert.match(plan,new RegExp(article));
  assert.match(plan,/article 126 as disciplinary authority is not used/);
  assert.match(plan,/reviewed policy source and material\s+rules/);
});

test("0092 adds a separate tenant-scoped transfer authority without backfill",()=>{
  for(const token of ["CREATE TABLE hr_transfer_cases","CREATE TABLE hr_transfer_case_events","policy_snapshot","ENABLE ROW LEVEL SECURITY","hr.transfer.manage","hr.transfer.decide","hr.transfer.implement"])assert.match(transferMigration,new RegExp(token));
  assert.doesNotMatch(transferMigration,/INSERT INTO hr_transfer_cases/);
  assert.doesNotMatch(transferMigration,/UPDATE employee_assignments/);
});

test("transfer case distinguishes temporary transfer and rotation with explicit consent evidence",()=>{
  assert.match(transferMigration,/temporary_transfer','rotation/);
  assert.match(hr,/ROTATION_CONSENT_REQUIRED/);
  assert.match(hr,/TEMPORARY_TRANSFER_END_REQUIRED/);
  assert.match(hr,/TRANSFER_CONSENT_EVIDENCE_REQUIRED/);
  assert.match(hr,/consent_document_id/);
  assert.match(hr,/transferType==="rotation"&&!v\.consentRequired/);
  assert.doesNotMatch(hr,/transferType==="temporary_transfer"&&!v\.consentRequired/);
});

test("canonical assignment changes only at approved effective implementation",()=>{
  assert.match(hr,/command==="implement"/);
  assert.match(hr,/TRANSFER_DECISION_EVIDENCE_REQUIRED/);
  assert.match(hr,/applyPrimaryAssignmentChange/);
  assert.match(assignments,/ASSIGNMENT_EFFECTIVE_DATE_NOT_REACHED/);
  assert.match(assignments,/SET status='ended'/);
  assert.match(assignments,/INSERT INTO employee_assignments/);
  assert.doesNotMatch(assignments,/DELETE FROM employee_assignments/);
});

test("temporary transfer completion restores prior placement as a new assignment",()=>{
  assert.match(hr,/current\.transfer_type==="temporary_transfer"/);
  assert.match(hr,/TRANSFER_END_DATE_NOT_REACHED/);
  assert.match(hr,/Return from \$\{current\.case_no\}/);
  assert.match(hr,/expectedAssignmentId:current\.implemented_assignment_id/);
});

test("HR UI groups transfer under employment relations internal tabs",()=>{
  assert.match(ui,/transitions:"Хөдөлмөрийн харилцаа"/);
  assert.match(ui,/transfers:"Шилжилт хөдөлгөөн"/);
  assert.match(ui,/transferCaseForm/);
  assert.match(ui,/data-domain="transfer"/);
  assert.match(production,/hr_transfer_case_events/);
});

test("0093 creates a restricted discipline authority without inferred history",()=>{
  for(const token of ["CREATE TABLE hr_discipline_cases","CREATE TABLE hr_discipline_case_events","confidentiality='restricted'","policy_snapshot","ENABLE ROW LEVEL SECURITY","hr.discipline.confidential.read"])assert.match(disciplineMigration,new RegExp(token));
  assert.doesNotMatch(disciplineMigration,/INSERT INTO hr_discipline_cases/);
  assert.doesNotMatch(disciplineMigration,/UPDATE employees/);
  assert.match(disciplineMigration,/UNIQUE\(organization_id,employee_id,violation_key\)/);
});

test("Complaint handoff acceptance and discipline creation share one transaction",()=>{
  assert.match(discipline,/createAggregate\(\{req,domain:"discipline"/);
  assert.match(discipline,/after:v\.sourceHandoffId\?async\(client,ctx\)/);
  assert.match(discipline,/target_discipline_case_id=\$4/);
  assert.match(discipline,/complaint_hr_handoff_events/);
  assert.match(discipline,/complaint_hr_handoff\.declined/);
});

test("discipline detail is separately confidential and decision duties are split",()=>{
  assert.match(discipline,/canReadConfidential:confidential/);
  assert.match(discipline,/items=confidential\?/);
  assert.match(discipline,/authorizeAny\(req,\["hr\.discipline\.confidential\.read"\]\)/);
  for(const permission of ["hr.discipline.investigate","hr.discipline.recommend","hr.discipline.decide","hr.discipline.admin"])assert.match(discipline,new RegExp(permission.replaceAll(".","\\.")));
  assert.match(discipline,/DISCIPLINE_FOUR_EYES_REQUIRED/);
  assert.match(discipline,/coordinationReason:`Restricted discipline command/);
  assert.match(discipline,/const summary=confidential\?/);
  assert.match(discipline,/total:null,open:null,decision_pending:null,active_decisions:null,overdue:null,redacted:true/);
  assert.match(ui,/Сахилгын хэргийн мэдээлэл нууцлагдсан/);
  assert.match(ui,/delete body\.decisionDueOn/);
});

test("discipline lifecycle requires notice explanation decision and post-decision evidence",()=>{
  for(const token of ["DISCIPLINE_NOTICE_REQUIRED","DISCIPLINE_EXPLANATION_EVIDENCE_REQUIRED","DISCIPLINE_RECOMMENDATION_INCOMPLETE","DISCIPLINE_DECISION_DOCUMENT_REQUIRED","DISCIPLINE_SANCTION_TERMS_REQUIRED","DISCIPLINE_ACKNOWLEDGEMENT_EVIDENCE_REQUIRED","DISCIPLINE_EXPIRY_NOT_REACHED","DISCIPLINE_DISPUTE_EVIDENCE_REQUIRED"])assert.match(discipline,new RegExp(token));
  assert.match(discipline,/decision_due_on/);
  assert.match(production,/hr_discipline_case_events/);
  for(const token of ["mn-labour-law-123-2024","full_property_liability","suspensionPeriods","computeSanctionExpiry"])assert.match(disciplineDeadline,new RegExp(token));
  assert.match(discipline,/DISCIPLINE_DECISION_DUE_MISMATCH/);
  assert.match(discipline,/DISCIPLINE_SANCTION_EXPIRY_MISMATCH/);
});

test("discipline-linked canonical documents are hidden across list version and download paths",()=>{
  assert.match(documents,/entity_type='hr_discipline_case'/);
  assert.match(documents,/hr\.discipline\.confidential\.read/);
  assert.match(documents,/documents\.restricted\.read/);
  assert.match(documents,/accessPredicate\("d",3,4\)/);
  assert.match(documents,/accessPredicate\("d",4,5\)/);
  assert.match(documents,/DISCIPLINE_DOCUMENT_FORBIDDEN/);
});
