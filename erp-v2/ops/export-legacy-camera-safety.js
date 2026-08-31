"use strict";

const path=require("node:path");
const sqlite3=require("sqlite3").verbose();
const source=process.env.LEGACY_DB_PATH||path.resolve(__dirname,"..","..","data","app.db");
const db=new sqlite3.Database(source,sqlite3.OPEN_READONLY);
const all=(sql,params=[])=>new Promise((resolve,reject)=>db.all(sql,params,(error,rows)=>error?reject(error):resolve(rows)));

async function main(){
  const work=await all("SELECT id,title,category,department,location,status,asset_id,assigned_to,created_by,created_at,updated_at,habea_pre_status,habea_pre_by,habea_pre_at,habea_pre_note,habea_pre_risks,habea_pre_measures,submitted_by,submitted_at,submit_note,habea_post_status,habea_post_by,habea_post_at,habea_post_note,confirm_status,confirmed_by,confirmed_at,confirm_note FROM asset_events WHERE category IN ('Камер','Камер засвар') ORDER BY id");
  const workIds=work.map(row=>row.id),placeholders=workIds.map(()=>"?").join(",")||"NULL";
  const data={
    format:"overva.legacy-camera-safety.v1",
    sourceSystem:"choibalsan-legacy-demo",
    exportedAt:new Date().toISOString(),
    cameraAssets:await all("SELECT * FROM assets WHERE category='Камер' ORDER BY id"),
    cameraSnapshots:await all("SELECT * FROM camera_daily_status ORDER BY snapshot_date,id"),
    cameraWork:work,
    workExecutions:await all(`SELECT id,work_log_id,title,note,status,progress,workers,start_date,end_date,created_by,created_at FROM work_executions WHERE work_log_id IN (${placeholders}) ORDER BY id`,workIds),
    safetyReports:await all("SELECT id,report_date,title,risk_level,location,risk_description,action_taken,status,created_by,created_at,risk_type,ppe_checklist,pre_work_note,assigned_to,risk_condition,possible_consequence,probability,consequence_score,risk_score,workflow_status,deadline,action_note,acknowledged_by,acknowledged_at,priority,action_plan,work_log_id,location_ref_type,location_ref_id FROM safety_reports ORDER BY id"),
    safetyRoutes:await all("SELECT * FROM safety_route_plans ORDER BY id"),
    safetyInstructions:await all("SELECT id,instruction_date,type,title,body,target_scope,status,created_by,created_at,updated_at FROM safety_instructions ORDER BY id"),
    safetyInstructionAcks:await all("SELECT id,instruction_id,user_id,acknowledged_at,note,created_at FROM safety_instruction_ack ORDER BY id"),
    safetyTrainings:await all("SELECT id,training_date,title,trainer,audience,participant_count,topic,result_note,status,created_by,created_at,updated_at FROM safety_trainings ORDER BY id"),
    safetyTrainingAcks:await all("SELECT id,training_id,user_id,acknowledged_at,note,created_at FROM safety_training_ack ORDER BY id"),
    users:await all("SELECT id,full_name,role FROM users ORDER BY id")
  };
  process.stdout.write(JSON.stringify(data));
}

main().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>db.close());
