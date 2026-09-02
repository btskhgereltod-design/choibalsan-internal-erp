"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const source=fs.readFileSync(path.join(__dirname,"..","scripts","reconcile-legacy-work-order-flow.js"),"utf8");
test("legacy Work Order correction is evidence-bound, dry-run by default and tenant scoped",()=>{
  assert.match(source,/data\.work\.length!==106/);assert.match(source,/sourceSha256/);assert.match(source,/FOR UPDATE/);
  assert.match(source,/APPLY_LEGACY_WORK_ORDER_RECONCILIATION/);assert.match(source,/if\(apply\)await client\.query\("COMMIT"\);else await client\.query\("ROLLBACK"\)/);
  assert.match(source,/sourceReconciliation:"legacy-workflow-v2"/);assert.match(source,/INSERT INTO audit_logs/);
});
test("correction restores source states without fabricating safety decisions",()=>{
  assert.match(source,/Хаагдсан/);assert.match(source,/ХАБЭА шалгасан/);assert.match(source,/awaiting_management_completion/);
  assert.match(source,/awaiting_safety_completion/);assert.match(source,/awaiting_safety_start/);
  assert.doesNotMatch(source,/INSERT INTO work_order_approvals/);assert.doesNotMatch(source,/INSERT INTO work_order_safety_reviews/);
});
