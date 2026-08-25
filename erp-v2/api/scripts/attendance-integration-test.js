"use strict";

require("dotenv").config();
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const { getPool, closePool } = require("../src/db");

const base = "http://127.0.0.1:4100";
const suffix = Date.now().toString(36);
const worker = { email:`attendance-${suffix}@test.local`, username:`attendance-${suffix}`, fullName:`Attendance Test ${suffix}`, password:`Attendance-${suffix}-Strong!` };
let orgId,workerId,workerUserId,recordId,directorToken,workerToken;

async function call(path, token, method="GET", body) {
  const response = await fetch(base+path,{method,headers:{"content-type":"application/json",...(token?{authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const data = response.headers.get("content-type")?.includes("application/json") ? await response.json() : await response.text();
  return { response, data };
}

async function login(identifier,password){
  const result=await call("/api/auth/login",null,"POST",{organization:process.env.BOOTSTRAP_ORG_SLUG,identifier,password});
  assert.equal(result.response.status,200,JSON.stringify(result.data));return result.data.token;
}

async function main(){
  const pool=getPool();
  try{
    const org=await pool.query("SELECT id FROM organizations WHERE slug=$1",[process.env.BOOTSTRAP_ORG_SLUG]);orgId=org.rows[0].id;
    const passwordHash=await bcrypt.hash(worker.password,12);
    const employee=await pool.query(`INSERT INTO employees(organization_id,full_name,job_role) VALUES($1,$2,'worker') RETURNING id`,[orgId,worker.fullName]);workerId=employee.rows[0].id;
    const inserted=await pool.query(`INSERT INTO users(organization_id,email,username,password_hash,full_name,role,active,can_login,employee_id) VALUES($1,$2,$3,$4,$5,'worker',true,true,$6) RETURNING id`,[orgId,worker.email,worker.username,passwordHash,worker.fullName,workerId]);workerUserId=inserted.rows[0].id;
    directorToken=await login(process.env.BOOTSTRAP_ADMIN_EMAIL,process.env.BOOTSTRAP_ADMIN_PASSWORD);
    let result=await call(`/api/attendance/${workerId}/2099-02-14`,directorToken,"PUT",{status:"late",workHours:7.5,leaveHours:0.5,overtimeHours:2,checkIn:"08:15",checkOut:"18:30",lateMinutes:15,note:"integration"});
    assert.equal(result.response.status,200,JSON.stringify(result.data));recordId=result.data.item.id;
    result=await call("/api/attendance?year=2099&month=2",directorToken);assert.equal(result.response.status,200);assert.ok(result.data.employees.some(item=>item.id===workerId));
    const record=result.data.records.find(item=>item.id===recordId);assert.equal(record.status,"late");assert.equal(Number(record.work_hours),7.5);assert.equal(Number(record.overtime_hours),2);
    result=await call("/api/attendance/export.csv?year=2099&month=2",directorToken);assert.equal(result.response.status,200);assert.ok(result.data.includes(worker.fullName));
    workerToken=await login(worker.username,worker.password);
    result=await call("/api/attendance?year=2099&month=2",workerToken);assert.equal(result.response.status,200);assert.equal(result.data.employees.length,1);assert.equal(result.data.employees[0].id,workerId);assert.equal(result.data.records.length,1);assert.equal(result.data.canEdit,false);
    result=await call(`/api/attendance/${workerId}/2099-02-15`,workerToken,"PUT",{status:"worked",workHours:8});assert.equal(result.response.status,403);
    result=await call(`/api/attendance/${workerId}/2099-02-14`,directorToken,"DELETE");assert.equal(result.response.status,200);
    recordId=null;
    console.log("Attendance integration passed: monthly matrix API, upsert, CSV, self-only access and editor permissions.");
  } finally {
    if(orgId&&workerId){
      await pool.query("DELETE FROM attendance_records WHERE organization_id=$1 AND employee_id=$2",[orgId,workerId]).catch(()=>{});
      await pool.query("DELETE FROM audit_logs WHERE organization_id=$1 AND (entity_id=$2 OR (entity_type='attendance_record' AND detail->>'userId'=$2))",[orgId,workerId]).catch(()=>{});
      await pool.query("DELETE FROM users WHERE organization_id=$1 AND id=$2",[orgId,workerUserId]).catch(()=>{});
      await pool.query("DELETE FROM employees WHERE organization_id=$1 AND id=$2",[orgId,workerId]).catch(()=>{});
    }
    await closePool();
  }
}

if(process.env.RUN_ATTENDANCE_INTEGRATION==="1")main().catch(error=>{console.error(error);process.exitCode=1});
module.exports={main};
