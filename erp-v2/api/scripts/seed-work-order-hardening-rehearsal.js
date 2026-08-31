"use strict";

require("dotenv").config();
const {getPool,closePool}=require("../src/db");

async function main(){
  if(process.env.MIGRATION_REHEARSAL_MODE!=="1")throw new Error("MIGRATION_REHEARSAL_MODE=1 is required");
  const pool=getPool(),client=await pool.connect();
  try{
    const databaseName=(await client.query("SELECT current_database() AS name")).rows[0].name;
    if(!/^overva_(test|rehearsal)_[a-z0-9_]+$/i.test(databaseName))throw new Error("A disposable overva_test_* or overva_rehearsal_* database is required");
    const version=(await client.query("SELECT max(version) version FROM schema_migrations")).rows[0].version;
    if(version!=="0077")throw new Error(`Rehearsal seed requires schema 0077, found ${version||"none"}`);
    await client.query("BEGIN");
    const organizationId=(await client.query(
      "INSERT INTO organizations(name,slug) VALUES('Hardening rehearsal','hardening-rehearsal') RETURNING id"
    )).rows[0].id;
    const employeeId=(await client.query(
      "INSERT INTO employees(organization_id,full_name,job_role) VALUES($1,'Rehearsal assignee','engineer') RETURNING id",
      [organizationId]
    )).rows[0].id;
    const userId=(await client.query(
      `INSERT INTO users(organization_id,email,username,password_hash,full_name,role,employee_id)
       VALUES($1,'rehearsal@test.invalid','rehearsal','rehearsal-only','Rehearsal assignee','engineer',$2) RETURNING id`,
      [organizationId,employeeId]
    )).rows[0].id;
    await client.query(
      `INSERT INTO work_orders(
         organization_id,title,category,status,assigned_to,created_by,created_at,updated_at
       ) SELECT $1,'Rehearsal Work Order '||n,'rehearsal','new',
                CASE WHEN n<=85 THEN $2::uuid ELSE NULL END,$2,
                now()-interval '200 days'+n*interval '1 minute',
                now()-interval '200 days'+n*interval '1 minute'
           FROM generate_series(1,106) n`,
      [organizationId,userId]
    );
    await client.query(
      `INSERT INTO work_order_events(organization_id,work_order_id,actor_user_id,event_type,to_status,created_at)
       SELECT organization_id,id,$2,'created','new',created_at
         FROM work_orders WHERE organization_id=$1`,
      [organizationId,userId]
    );
    await client.query(
      `WITH targets AS (
         SELECT w.organization_id,w.id,w.created_at,
                row_number() OVER(ORDER BY w.id,g.n) rn
           FROM work_orders w CROSS JOIN generate_series(1,3) g(n)
          WHERE w.organization_id=$1
       ) INSERT INTO work_order_events(organization_id,work_order_id,actor_user_id,event_type,note,created_at)
         SELECT organization_id,id,$2,'note','Rehearsal note',created_at+rn*interval '1 second'
           FROM targets WHERE rn<=316`,
      [organizationId,userId]
    );
    await client.query(
      `INSERT INTO work_order_events(organization_id,work_order_id,actor_user_id,event_type,from_status,to_status,created_at)
       SELECT organization_id,id,$2,'status_changed','new','assigned',created_at+interval '10 minutes'
         FROM work_orders WHERE organization_id=$1 ORDER BY id LIMIT 28`,
      [organizationId,userId]
    );
    await client.query(
      `WITH targets AS (
         SELECT w.organization_id,w.id,w.created_at,
                row_number() OVER(ORDER BY w.id,g.n) rn
           FROM work_orders w CROSS JOIN generate_series(1,2) g(n)
          WHERE w.organization_id=$1
       ) INSERT INTO work_order_events(organization_id,work_order_id,actor_user_id,event_type,detail,created_at)
         SELECT organization_id,id,$2,'workflow_action','{"action":"rehearsal"}'::jsonb,
                created_at+(rn+1000)*interval '1 second'
           FROM targets WHERE rn<=206`,
      [organizationId,userId]
    );
    await client.query("COMMIT");
    const counts=await pool.query(
      `SELECT (SELECT count(*)::int FROM work_orders WHERE organization_id=$1) work_orders,
              (SELECT count(*)::int FROM work_orders WHERE organization_id=$1 AND assigned_to IS NOT NULL) assigned,
              (SELECT count(*)::int FROM work_order_events WHERE organization_id=$1) events`,
      [organizationId]
    );
    console.log(JSON.stringify({databaseName,version,organizationId,...counts.rows[0]},null,2));
  }catch(error){
    await client.query("ROLLBACK").catch(()=>{});
    throw error;
  }finally{
    client.release();
    await closePool();
  }
}

main().catch(error=>{console.error(error);process.exitCode=1;});
