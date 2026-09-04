"use strict";

require("dotenv").config();
const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const {getPool,closePool}=require("../src/db");
const {signAccessToken}=require("../src/security/token");
const base="http://127.0.0.1:4100";
const id=()=>crypto.randomUUID();

async function call(path,token,{method="GET",body,expected=[200]}={}){
  const response=await fetch(base+path,{method,headers:{authorization:`Bearer ${token}`,...(body?{"content-type":"application/json"}:{})},body:body?JSON.stringify(body):undefined});
  const payload=await response.json();
  assert.ok(expected.includes(response.status),`${method} ${path} -> ${response.status} ${JSON.stringify(payload)}`);
  return payload;
}

function review(template,type,approved,note){
  const rows=type==="start"?template.start_checklist:template.completion_checklist;
  return {templateId:template.id,reviewType:type,likelihood:type==="start"&&approved?2:null,severity:type==="start"&&approved?2:null,
    hazards:type==="start"&&approved?["electrical contact"]:[],controls:type==="start"&&approved?["isolate supply"]:[],ppe:type==="start"&&approved?["helmet"]:[],
    checklist:(rows||[]).map(row=>({code:row.code,checked:approved||row.required===false,note})),validUntil:type==="start"&&approved?new Date(Date.now()+21600000).toISOString():null,note};
}

async function action(workId,token,actionCode,template,type){
  const approved=!actionCode.includes("return")&&!actionCode.includes("suspend");
  const note=`E2E-20260905 recovery ${actionCode}`;
  return call(`/api/work-orders/${workId}/workflow-action`,token,{method:"POST",body:{action:actionCode,note,idempotencyKey:id(),...(type?{safetyReview:review(template,type,approved,note)}:{})}});
}

async function main(){
  assert.equal(process.env.ALLOW_DEMO_E2E,"1","Demo recovery requires ALLOW_DEMO_E2E=1");
  const client=await getPool().connect();
  try{
    const state=(await client.query("select current_database() database,(select max(version) from schema_migrations) schema")).rows[0];
    assert.ok(state.database==="erp_v2"&&["0110","0111"].includes(state.schema));
    const works=(await client.query(`SELECT work.*,template.id template_id,template.start_checklist,template.completion_checklist
      FROM work_orders work JOIN organization_work_safety_template_routes route
        ON route.organization_id=work.organization_id AND route.work_type_id=work.work_type_id AND route.active=true
      JOIN organization_work_safety_templates template
        ON template.organization_id=route.organization_id AND template.id=route.safety_template_id AND template.active=true
      WHERE work.status NOT IN('completed','cancelled') AND (work.title LIKE 'E2E-20260905-ROLE01%'
        OR work.title LIKE '%E2E-20260905-ROLE01%' OR work.title LIKE '%E2E-20260905-ROLE02%')
      ORDER BY CASE WHEN work.title LIKE 'E2E-%' THEN 0 ELSE 1 END,work.created_at`)).rows;
    const recovered=[];
    for(const work of works){
      const run=(work.title.match(/E2E-20260905-ROLE\d+/)||[])[0];assert.ok(run);
      const people=(await client.query(`SELECT employee.employee_no,user_row.id FROM employees employee JOIN users user_row
        ON user_row.organization_id=employee.organization_id AND user_row.employee_id=employee.id
        WHERE employee.organization_id=$1 AND employee.employee_no=ANY($2::text[])`,[work.organization_id,
      [`${run}-electricEngineer`,`${run}-safety`,`${run}-chiefEngineer`]])).rows;
      const tokenFor=suffix=>signAccessToken(people.find(row=>row.employee_no===`${run}-${suffix}`).id);
      const engineer=tokenFor("electricEngineer"),safety=tokenFor("safety"),chief=tokenFor("chiefEngineer");
      const template={id:work.template_id,start_checklist:work.start_checklist,completion_checklist:work.completion_checklist};
      const history=await call(`/api/work-orders/${work.id}/history`,engineer);
      for(const scope of history.scopeItems){
        if(scope.outcome_status==="pending")await call(`/api/work-orders/${work.id}/scope-items/${scope.id}`,engineer,{method:"PATCH",body:{completedQuantity:Number(scope.planned_quantity),unresolvedQuantity:0,deferredQuantity:0,exceptionReason:"",requestException:false}});
      }
      let current=(await client.query("SELECT workflow_stage FROM work_orders WHERE id=$1",[work.id])).rows[0].workflow_stage;
      if(current==="execution")await action(work.id,safety,"safety_suspend_execution",template,"start");
      current=(await client.query("SELECT workflow_stage FROM work_orders WHERE id=$1",[work.id])).rows[0].workflow_stage;
      if(current==="awaiting_safety_start")await action(work.id,safety,"safety_authorize_start",template,"start");
      await action(work.id,engineer,"submit_completion",template);
      await action(work.id,safety,"safety_accept_completion",template,"completion");
      await action(work.id,chief,"management_close",template);
      recovered.push(work.id);
    }
    const closer=(await client.query(`SELECT user_row.id FROM users user_row JOIN employees employee
      ON employee.organization_id=user_row.organization_id AND employee.id=user_row.employee_id
      WHERE employee.employee_no='E2E-20260905-ROLE09-chiefEngineer'`)).rows[0];
    const cancelled=[];
    if(closer){
      const closerToken=signAccessToken(closer.id);
      const orphans=(await client.query(`SELECT incident.id,incident.domain,incident.version FROM operational_incidents incident
        WHERE incident.status='open' AND incident.detail::text LIKE '%E2E-20260905-%'
          AND NOT EXISTS(SELECT 1 FROM operational_incident_work_orders link WHERE link.organization_id=incident.organization_id AND link.incident_id=incident.id)`)).rows;
      for(const incident of orphans){
        await call(`/api/${incident.domain}/incidents/${incident.id}/cancel`,closerToken,{method:"POST",body:{
          reason:"E2E-20260905 abandoned retry artifact reconciled",expectedVersion:Number(incident.version),idempotencyKey:id(),
        }});cancelled.push(incident.id);
      }
    }
    const deactivated=[];
    if(process.env.DEACTIVATE_DEMO_E2E_USERS==="1"){
      const owner=(await client.query(`SELECT user_row.id FROM users user_row JOIN user_roles membership
        ON membership.organization_id=user_row.organization_id AND membership.user_id=user_row.id
        JOIN organization_roles role ON role.organization_id=membership.organization_id AND role.id=membership.role_id
        WHERE role.code='owner' AND user_row.active AND user_row.can_login LIMIT 1`)).rows[0];
      const ownerToken=signAccessToken(owner.id),testUsers=(await client.query(`SELECT DISTINCT user_row.id FROM users user_row JOIN employees employee
        ON employee.organization_id=user_row.organization_id AND employee.id=user_row.employee_id
        WHERE employee.employee_no LIKE 'E2E-20260905-%' AND user_row.active`)).rows;
      for(const user of testUsers){await call(`/api/users/${user.id}`,ownerToken,{method:"PATCH",body:{active:false}});deactivated.push(user.id)}
    }
    console.log(JSON.stringify({recovered,cancelled,deactivated},null,2));
  }finally{client.release();await closePool()}
}
main().catch(async error=>{console.error(error.stack||error.message);await closePool().catch(()=>{});process.exitCode=1});
