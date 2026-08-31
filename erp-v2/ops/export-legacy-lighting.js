"use strict";

const path=require("node:path");
const sqlite3=require("sqlite3").verbose();
const source=process.env.LEGACY_DB_PATH||path.resolve(__dirname,"..","..","data","app.db");
const db=new sqlite3.Database(source,sqlite3.OPEN_READONLY);
const all=(sql,params=[])=>new Promise((resolve,reject)=>db.all(sql,params,(error,rows)=>error?reject(error):resolve(rows)));

async function main(){
  const includeAllWork=process.argv.includes("--all-work");
  const work=await all(includeAllWork
    ? "SELECT * FROM asset_events ORDER BY id"
    : `SELECT * FROM asset_events WHERE sl_point_id IS NOT NULL OR ger_inventory_id IS NOT NULL
      OR lower(COALESCE(category,'')) LIKE '%гэрэлт%' OR lower(COALESCE(department,'')) LIKE '%цахилгаан%'
      ORDER BY id`);
  const ids=work.map(x=>x.id);
  const placeholders=ids.map(()=>"?").join(",")||"NULL";
  const data={
    format:"overva.legacy-lighting.v1",sourceSystem:"choibalsan-legacy-erp",exportedAt:new Date().toISOString(),
    points:await all("SELECT * FROM sl_points ORDER BY id"),
    inventory:await all("SELECT * FROM sl_ger_inventory ORDER BY id"),
    faults:await all("SELECT * FROM sl_faults ORDER BY id"),
    repairs:await all("SELECT * FROM sl_fault_repairs ORDER BY id"),work,
    executions:await all(`SELECT * FROM work_executions WHERE work_log_id IN (${placeholders}) ORDER BY id`,ids),
    photos:await all(`SELECT * FROM work_photos WHERE work_log_id IN (${placeholders}) ORDER BY id`,ids),
    users:await all("SELECT id,full_name,role FROM users ORDER BY id")
  };
  process.stdout.write(JSON.stringify(data));
}
main().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>db.close());
