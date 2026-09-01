"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const root=path.join(__dirname,".."),read=file=>fs.readFileSync(path.join(root,file),"utf8");
const sql=read("migrations/0086_choibalsan_hr_records_complaints_archive.sql"),service=read("src/services/bounded-domain-workflow.js"),workflow=read("src/services/workflow-coordination.js"),hr=read("src/routes/hr-workflows.js"),records=read("src/routes/records.js"),complaints=read("src/routes/complaints.js"),archive=read("src/routes/archive.js"),ui=read("../web/administration.js");

test("appointment requires checklist completion and final evidence without guessing employee number",()=>{
  assert.match(hr,/APPOINTMENT_DOCUMENTS_INCOMPLETE/);assert.match(hr,/APPOINTMENT_FINAL_EVIDENCE_REQUIRED/);
  assert.match(hr,/employee_no,job_role[\s\S]*NULL,'worker'/);assert.match(sql,/UNIQUE\(organization_id,person_key\)/);
  assert.match(ui,/data-hr-evidence-update/);
  assert.doesNotMatch(sql,/UPDATE employees SET employee_no/i);
});
test("leave preserves configurable routing, overlap rejection, return and cancellation",()=>{
  for(const token of ["routingPolicy","managerReviewRequired","LEAVE_OVERLAP","manager_approve","return","resubmit","cancel"])assert.match(hr,new RegExp(token));
  assert.match(service,/manager_approve:"routed"/);assert.match(service,/return:"returned"/);
});
test("employment exit requires handover, order evidence, explicit finalization and lifecycle evidence",()=>{
  for(const token of ["EXIT_HANDOVER_INCOMPLETE","EXIT_ORDER_DOCUMENT_REQUIRED","EMPLOYEE_LIFECYCLE_CONFLICT","employment_lifecycle_events","finalize"])assert.match(hr,new RegExp(token));
  assert.match(sql,/hr_exit_handover_items/);assert.match(sql,/ON DELETE RESTRICT/);
});
test("correspondence has collision-safe numbering, assignment and official response lifecycle",()=>{
  assert.match(records,/pg_advisory_xact_lock/);assert.match(sql,/UNIQUE\(organization_id,registration_no\)/);
  for(const token of ["assignAggregate","submit_response","approve_response","send_response","DELIVERY_EVIDENCE_REQUIRED","correspondence_delivery_events"])assert.match(records,new RegExp(token));
});
test("complaints implement derived overdue, return, approval, delivery and close",()=>{
  assert.match(complaints,/due_date<CURRENT_DATE/);assert.match(complaints,/returned_for_completion/);
  for(const token of ["approve_response","send_response","DELIVERY_EVIDENCE_REQUIRED","complaint_delivery_events","close_reason"])assert.match(complaints,new RegExp(token));
});
test("archive access and disposal enforce hold, commission, evidence and four eyes",()=>{
  for(const token of ["archive_access_requests","archive_destruction_proposals","archive_commission_decisions","archive_disposal_acts"])assert.match(sql,new RegExp(token));
  assert.match(archive,/access_\$\{req\.params\.command\}/);assert.match(archive,/"issue","return"/);
  for(const token of ["ARCHIVE_ACTIVE_LEGAL_HOLD","DISPOSAL_ITEM_SET_MISMATCH","DISPOSAL_ACT_EVIDENCE_REQUIRED","DISPOSAL_FOUR_EYES_REQUIRED"])assert.match(archive,new RegExp(token));
  assert.match(ui,/data-archive-access-command/);assert.match(ui,/data-archive-proposal-command/);
});
test("domain commands are atomic, retry-safe, version guarded and emit audit plus outbox",()=>{
  assert.match(service,/withTenantTransaction/);assert.match(service,/DOMAIN_VERSION_CONFLICT/);assert.match(service,/findCommandReplay/);
  assert.match(service,/transitionWorkflowCase/);assert.match(service,/writeAudit/);assert.match(workflow,/workflow_notification_outbox/);
});
test("restricted records require an explicit backend capability for consequential commands",()=>{
  assert.match(service,/RESTRICTED_DOCUMENT_FORBIDDEN/);assert.match(service,/documents\.restricted\.read/);
  assert.match(sql,/documents\.restricted\.read/);assert.match(complaints,/RESTRICTED_DOCUMENT_FORBIDDEN/);
});
test("production grants preserve Phase 2 evidence as append-only",()=>{
  const production=read("scripts/production-migrate.js");
  for(const table of ["correspondence_events","complaint_case_events","archive_events","archive_disposal_acts","domain_command_receipts"])assert.match(production,new RegExp(table));
  assert.match(sql,/overva_reject_audit_mutation/);
});
