"use strict";

require("dotenv").config();
const { getPool, closePool } = require("../src/db");

const workOrderId = process.argv[2];
if (!/^[0-9a-f-]{36}$/i.test(workOrderId || "")) {
  throw new Error("A work-order UUID is required");
}

async function main() {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(`SELECT w.*,o.slug,
      (SELECT count(*)::int FROM work_order_approvals a
        WHERE a.organization_id=w.organization_id AND a.work_order_id=w.id) approval_count,
      (SELECT count(*)::int FROM source_import_records s
        WHERE s.organization_id=w.organization_id AND s.target_type='work_order' AND s.target_id=w.id::text) import_count,
      (SELECT count(*)::int FROM work_order_events e
        WHERE e.organization_id=w.organization_id AND e.work_order_id=w.id) event_count
      FROM work_orders w JOIN organizations o ON o.id=w.organization_id
      WHERE w.id=$1 FOR UPDATE`, [workOrderId]);
    const item = found.rows[0];
    if (!item) throw new Error("Work order not found");
    if (item.slug !== "choibalsan-hugjil") throw new Error("Refusing to touch another tenant");
    if (item.title !== "dsfsdfsfdfs" || item.import_count !== 0 || item.approval_count !== 0) {
      throw new Error("Safety check failed: this is not the identified disposable trial work order");
    }
    if (item.status === "completed") throw new Error("Refusing to retire a completed Work Order");
    let retired = item;
    if (item.status !== "cancelled") {
      retired = (await client.query(
        "UPDATE work_orders SET status='cancelled',updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *",
        [item.organization_id,item.id]
      )).rows[0];
      await client.query(
        `INSERT INTO work_order_events(
           organization_id,work_order_id,actor_user_id,event_type,from_status,to_status,note,detail
         ) VALUES($1,$2,$3,'status_changed',$4,'cancelled',$5,$6::jsonb)`,
        [item.organization_id,item.id,item.created_by,item.status,
          "Disposable trial record retired without deleting append-only evidence",
          JSON.stringify({reason:"Owner requested retirement of a disposable trial record",previousEventCount:item.event_count})]
      );
    }
    await client.query(`INSERT INTO audit_logs
      (organization_id,user_id,action,entity_type,entity_id,detail)
      VALUES($1,$2,'work_order.trial_record_retired','work_order',$3,$4::jsonb)`, [
      item.organization_id, item.created_by, item.id,
      JSON.stringify({title:item.title,fromStatus:item.status,toStatus:"cancelled",createdAt:item.created_at,eventCount:item.event_count,historyPreserved:true})
    ]);
    await client.query("COMMIT");
    console.log(JSON.stringify({retired:{id:retired.id,title:retired.title,status:retired.status},auditPreserved:true,eventsRemoved:0}, null, 2));
  } catch (error) {
    await client.query("ROLLBACK").catch(()=>{});
    throw error;
  } finally {
    client.release();
    await closePool();
  }
}

main().catch(error=>{console.error(error);process.exitCode=1;});
