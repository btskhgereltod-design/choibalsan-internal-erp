"use strict";

if (process.env.RUN_WORK_ORDER_ASSIGNMENT_INTEGRATION !== "1") {
  module.exports = {};
} else {
  require("dotenv").config();
  const assert = require("node:assert/strict");
  const { randomUUID } = require("node:crypto");
  const { getPool, closePool } = require("../src/db");
  const {
    assignmentState, changeAssignment, recordInitialAssignment,
  } = require("../src/services/work-order-assignment");
  const {_loadWorkPeriod,_loadAssignmentQuality}=require("../src/routes/reports");

  async function main() {
    const client=await getPool().connect();
    try {
      await client.query("BEGIN");
      const suffix=randomUUID().slice(0,8);
      const orgA=(await client.query(
        "INSERT INTO organizations(name,slug) VALUES($1,$2) RETURNING id",
        [`Assignment test A ${suffix}`,`assignment-test-a-${suffix}`]
      )).rows[0];
      const orgB=(await client.query(
        "INSERT INTO organizations(name,slug) VALUES($1,$2) RETURNING id",
        [`Assignment test B ${suffix}`,`assignment-test-b-${suffix}`]
      )).rows[0];
      async function identity(org,label) {
        const employee=(await client.query(
          "INSERT INTO employees(organization_id,full_name,job_role) VALUES($1,$2,'worker') RETURNING id",
          [org.id,`Employee ${label}`]
        )).rows[0];
        const user=(await client.query(
          `INSERT INTO users(organization_id,email,username,password_hash,full_name,role,employee_id)
           VALUES($1,$2,$3,'integration-only',$4,'worker',$5) RETURNING id,full_name,employee_id`,
          [org.id,`${label}-${suffix}@assignment.test`,`${label}-${suffix}`,`User ${label}`,employee.id]
        )).rows[0];
        return user;
      }
      const creator=await identity(orgA,"creator");
      const userA=await identity(orgA,"a");
      const userB=await identity(orgA,"b");
      const foreignUser=await identity(orgB,"foreign");
      async function boundaryWork(title,createdAt,initialRecordedAt=null) {
        const boundaryWorkOrder=(await client.query(
          `INSERT INTO work_orders(organization_id,title,category,status,created_by,created_at,updated_at)
           VALUES($1,$2,'report-boundary','new',$3,$4,$4) RETURNING *`,
          [orgA.id,title,creator.id,createdAt]
        )).rows[0];
        await client.query(
          `INSERT INTO work_order_events(
             organization_id,work_order_id,actor_user_id,event_type,to_status,created_at
           ) VALUES($1,$2,$3,'created','new',$4)`,
          [orgA.id,boundaryWorkOrder.id,creator.id,createdAt]
        );
        if(initialRecordedAt)await recordInitialAssignment(client,{
          organizationId:orgA.id,workOrderId:boundaryWorkOrder.id,actorUserId:creator.id,
          assignee:null,status:"new",source:"api",createdAt:initialRecordedAt,
        });
        return boundaryWorkOrder;
      }
      await boundaryWork("Before Ulaanbaatar day","2025-12-31T15:59:59.000Z","2025-12-31T15:59:59.000Z");
      await boundaryWork("Known unassigned at start","2025-12-31T16:00:00.000Z","2025-12-31T16:00:00.000Z");
      await boundaryWork("Future evidence stays unknown","2026-01-01T15:59:59.000Z","2026-01-01T16:00:00.000Z");
      const boundaryReport=await _loadWorkPeriod(client,orgA.id,"2026-01-01","2026-01-01","Asia/Ulaanbaatar");
      assert.equal(boundaryReport.created,2);
      assert.equal(boundaryReport.unassigned_created,1);
      assert.equal(boundaryReport.opening_backlog,1);
      const boundaryQuality=await _loadAssignmentQuality(client,orgA.id,"2026-01-01","2026-01-01","Asia/Ulaanbaatar");
      assert.equal(boundaryQuality.rows[0].unknown_created_assignment,1);
      const work=(await client.query(
        `INSERT INTO work_orders(organization_id,title,category,status,assigned_to,created_by)
         VALUES($1,'Assignment integration','test','assigned',$2,$3) RETURNING *`,
        [orgA.id,userA.id,creator.id]
      )).rows[0];
      await client.query(
        `INSERT INTO work_order_events(organization_id,work_order_id,actor_user_id,event_type,to_status)
         VALUES($1,$2,$3,'created','assigned')`,
        [orgA.id,work.id,creator.id]
      );
      await recordInitialAssignment(client,{
        organizationId:orgA.id,workOrderId:work.id,actorUserId:creator.id,
        assignee:userA,status:"assigned",source:"api",
      });
      let current=await assignmentState(client,orgA.id,work.id);
      const key=randomUUID();
      const reassigned=await changeAssignment(client,{
        organizationId:orgA.id,current,assignee:userB,actorUserId:creator.id,
        source:"api",reason:"Integration handoff",idempotencyKey:key,
      });
      assert.equal(reassigned.changed,true);
      current=await assignmentState(client,orgA.id,work.id);
      const replay=await changeAssignment(client,{
        organizationId:orgA.id,current,assignee:userB,actorUserId:creator.id,
        source:"api",reason:"Integration handoff",idempotencyKey:key,
      });
      assert.equal(replay.changed,false);
      assert.equal(replay.replayed,true);
      let idempotencyConflict=false;
      try {
        await changeAssignment(client,{
          organizationId:orgA.id,current,assignee:userA,actorUserId:creator.id,
          source:"api",reason:"Different payload",idempotencyKey:key,
        });
      } catch (error) {
        idempotencyConflict=error.code==="ASSIGNMENT_IDEMPOTENCY_CONFLICT";
      }
      assert.equal(idempotencyConflict,true);
      const noOp=await changeAssignment(client,{
        organizationId:orgA.id,current,assignee:userB,actorUserId:creator.id,
      });
      assert.equal(noOp.changed,false);
      const unassigned=await changeAssignment(client,{
        organizationId:orgA.id,current,assignee:null,actorUserId:creator.id,reason:"Queue handoff",
      });
      assert.equal(unassigned.event.assignment_operation,"unassigned");
      const timeline=await client.query(
        `SELECT id,assignment_operation,from_assignee_user_id,to_assignee_user_id
           FROM work_order_events WHERE organization_id=$1 AND work_order_id=$2
            AND assignment_history_version=1 ORDER BY id`,
        [orgA.id,work.id]
      );
      assert.deepEqual(timeline.rows.map(row=>row.assignment_operation),["initial","reassigned","unassigned"]);

      await client.query("SAVEPOINT cross_tenant_assignment");
      let crossTenantBlocked=false;
      try {
        await client.query(
          `INSERT INTO work_order_events(
             organization_id,work_order_id,actor_user_id,event_type,assignment_history_version,
             assignment_operation,assignment_source,to_assignee_user_id,to_assignee_employee_id
           ) VALUES($1,$2,$3,'assigned',1,'assigned','api',$4,$5)`,
          [orgA.id,work.id,creator.id,foreignUser.id,foreignUser.employee_id]
        );
      } catch (error) {
        crossTenantBlocked=true;
        await client.query("ROLLBACK TO SAVEPOINT cross_tenant_assignment");
      }
      assert.equal(crossTenantBlocked,true);

      await client.query("SAVEPOINT mismatched_employee_pair");
      let mismatchedPairBlocked=false;
      try {
        await client.query(
          `INSERT INTO work_order_events(
             organization_id,work_order_id,actor_user_id,event_type,assignment_history_version,
             assignment_operation,assignment_source,to_assignee_user_id,to_assignee_employee_id
           ) VALUES($1,$2,$3,'assigned',1,'assigned','api',$4,$5)`,
          [orgA.id,work.id,creator.id,userA.id,userB.employee_id]
        );
      } catch (error) {
        mismatchedPairBlocked=true;
        await client.query("ROLLBACK TO SAVEPOINT mismatched_employee_pair");
      }
      assert.equal(mismatchedPairBlocked,true);

      const legacyTransition=await client.query(
        `INSERT INTO work_order_events(
           organization_id,work_order_id,actor_user_id,event_type,from_status,to_status,detail
         ) VALUES($1,$2,$3,'assigned','new','assigned',$4::jsonb) RETURNING id,assignment_history_version`,
        [orgA.id,work.id,creator.id,JSON.stringify({fromAssignee:null,toAssignee:userA.id})]
      );
      assert.equal(legacyTransition.rows[0].assignment_history_version,null);

      await client.query("SAVEPOINT hard_delete_work_order");
      let hardDeleteBlocked=false;
      try {
        await client.query("DELETE FROM work_orders WHERE organization_id=$1 AND id=$2",[orgA.id,work.id]);
      } catch (error) {
        hardDeleteBlocked=true;
        await client.query("ROLLBACK TO SAVEPOINT hard_delete_work_order");
      }
      assert.equal(hardDeleteBlocked,true);

      await client.query("SAVEPOINT append_only_update");
      let updateBlocked=false;
      try {
        await client.query("UPDATE work_order_events SET assignment_reason='tampered' WHERE id=$1",[timeline.rows[0].id]);
      } catch (error) {
        updateBlocked=true;
        await client.query("ROLLBACK TO SAVEPOINT append_only_update");
      }
      assert.equal(updateBlocked,true);
      await client.query("ROLLBACK");
      console.log("Work Order assignment integration passed: atomic timeline, payload idempotency, phased compatibility, tenant/pair isolation, and append-only history.");
    } catch (error) {
      await client.query("ROLLBACK").catch(()=>{});
      throw error;
    } finally {
      client.release();
      await closePool();
    }
  }
  main().catch(error=>{console.error(error);process.exitCode=1});
}
