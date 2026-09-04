"use strict";

require("dotenv").config();
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { getPool, closePool } = require("../src/db");
const { signAccessToken } = require("../src/security/token");

const baseUrl = String(process.env.DEMO_E2E_BASE_URL || "http://127.0.0.1:4200").replace(/\/$/, "");
const organizationSlug = String(process.env.DEMO_E2E_ORGANIZATION || "choibalsan-hugjil");
const runId = String(process.env.DEMO_E2E_RUN_ID || `E2E-20260905-${new Date().toISOString().slice(11, 16).replace(":", "")}`);
const writeEnabled = process.env.ALLOW_DEMO_E2E === "1";

const goals = Object.freeze({
  A: "Object registry and dossier history reconcile without replacing prior evidence",
  B: "Fault batch, repeat fault, cancellation, filters and counts reconcile",
  C: "Incident intake creates one routed Work Order with distinct owner and crew",
  D: "HSE start and completion reviews cannot be skipped and preserve evidence",
  E: "Measured execution supports partial outcome and explicit unresolved disposition",
  F: "Material request, approval, issue, consumption and retry protection reconcile",
  G: "Management acceptance closes only accepted quantity and preserves follow-up work",
  H: "Camera follows the same governed flow without lighting-domain leakage",
  I: "Dashboard projections reconcile after every consequential stage",
  J: "Role, tenant, API and audit negative tests fail closed",
});

const personas = Object.freeze([
  { key:"lightingReporter", role:"electric", department:"Цахилгааны тасаг", label:"Гэрэлтүүлгийн гэмтэл мэдээлэгч" },
  { key:"lightingCoordinator", role:"electric", department:"Цахилгааны тасаг", label:"Гэрэлтүүлгийн зохицуулагч" },
  { key:"electricEngineer", role:"engineer", department:"Цахилгааны тасаг", label:"Цахилгааны инженер" },
  { key:"electricWorker", role:"worker", department:"Цахилгааны тасаг", label:"Гүйцэтгэх ажилтан" },
  { key:"safety", role:"safety", department:"Захиргаа аж ахуй", label:"ХАБЭА ажилтан" },
  { key:"chiefEngineer", role:"chief_engineer", department:"Захиргаа аж ахуй", label:"Ерөнхий инженер" },
  { key:"storekeeper", role:"storekeeper", department:"Захиргаа аж ахуй", label:"Нярав" },
  { key:"accountant", role:"accountant", department:"Захиргаа аж ахуй", label:"Нягтлан" },
  { key:"management", role:"director", department:"Захиргаа аж ахуй", label:"Удирдлага" },
  { key:"cameraCoordinator", role:"camera_engineer", department:"Теле камерийн тасаг", label:"Камерын инженер" },
  { key:"cameraWorker", role:"worker", department:"Теле камерийн тасаг", label:"Камерын ажилтан" },
]);

function localGuard() {
  const url = new URL(baseUrl);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname), "Demo E2E must target localhost only");
  const expectedPort = process.env.DEMO_E2E_INSIDE_API === "1" ? "4100" : "4200";
  assert.equal(url.port, expectedPort, `Demo E2E must target localhost:${expectedPort}`);
  assert.ok(runId.startsWith("E2E-20260905-"), "Run id must use the required prefix");
}

async function request(path, token, { method="GET", body, expected=[200] }={}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers:{ authorization:`Bearer ${token}`, ...(body === undefined ? {} : { "content-type":"application/json" }) },
    body:body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { text }; }
  assert.ok(expected.includes(response.status), `${method} ${path}: expected ${expected.join("/")}, got ${response.status} ${JSON.stringify(payload)}`);
  return { status:response.status, body:payload };
}

async function loadOwner(client) {
  const result = await client.query(`SELECT u.id,u.organization_id
    FROM users u
    JOIN organizations o ON o.id=u.organization_id
    JOIN user_roles ur ON ur.organization_id=u.organization_id AND ur.user_id=u.id
    JOIN organization_roles r ON r.organization_id=ur.organization_id AND r.id=ur.role_id
    WHERE o.slug=$1 AND u.active=true AND u.can_login=true AND r.code='owner'
    ORDER BY u.created_at LIMIT 1`, [organizationSlug]);
  assert.equal(result.rowCount, 1, "An active demo tenant owner is required");
  return result.rows[0];
}

async function ensurePersona(client, ownerToken, departments, definition) {
  const employeeNo = `${runId}-${definition.key}`;
  let employee = (await client.query(`SELECT id,department_id FROM employees
    WHERE organization_id=(SELECT id FROM organizations WHERE slug=$1) AND employee_no=$2`,
  [organizationSlug,employeeNo])).rows[0];
  if (!employee) {
    assert.ok(writeEnabled, `Persona ${definition.key} is missing; set ALLOW_DEMO_E2E=1 for demo writes`);
    const departmentId = departments.get(definition.department);
    assert.ok(departmentId, `Department not found: ${definition.department}`);
    employee = (await request("/api/employees",ownerToken,{method:"POST",expected:[201],body:{
      fullName:`${runId} ${definition.label}`,employeeNo,role:definition.role,
      departmentId,positionId:null,managerUserId:null,
    }})).body.item;
  }
  let user = (await client.query(`SELECT id,username,role,active,can_login FROM users
    WHERE organization_id=(SELECT id FROM organizations WHERE slug=$1) AND employee_id=$2`,
  [organizationSlug,employee.id])).rows[0];
  if (!user?.can_login) {
    assert.ok(writeEnabled, `Access for ${definition.key} is missing; set ALLOW_DEMO_E2E=1 for demo writes`);
    const username = `${runId}-${definition.key}`.toLowerCase();
    const password = `${crypto.randomUUID()}-Aa1!`;
    user = (await request(`/api/employees/${employee.id}/access`,ownerToken,{method:"POST",body:{
      email:`${username}@example.invalid`,username,role:definition.role,password,
    }})).body.item;
  }
  if (process.env.DEMO_E2E_RESYNC_ROLES === "1") {
    user = (await request(`/api/users/${user.id}`,ownerToken,{method:"PATCH",body:{role:definition.role}})).body.item;
  }
  const token = signAccessToken(user.id);
  const me = (await request("/api/auth/me",token)).body.user;
  return { ...definition, employeeId:employee.id, userId:user.id, token,
    permissions:me.permissions || [], systemRoles:me.system_roles || [], departmentId:me.department_id };
}

const uid=()=>crypto.randomUUID();
const evidence=[];
function record(goal,check,detail={}){evidence.push({goal,check,ok:true,...detail});}

async function workflow(workId,actor,action,{reviewType,template,note=`${runId} ${action}`}={}){
  const body={action,note,idempotencyKey:uid()};
  if(reviewType){
    const required=reviewType==="start"?template.start_checklist:template.completion_checklist;
    const approved=!action.includes("return")&&!action.includes("suspend");
    body.safetyReview={templateId:template.id,reviewType,
      likelihood:reviewType==="start"&&approved?2:null,severity:reviewType==="start"&&approved?2:null,
      hazards:reviewType==="start"&&approved?["electrical contact","traffic"]:[],
      controls:reviewType==="start"&&approved?["isolate supply","mark work zone"]:[],
      ppe:reviewType==="start"&&approved?["insulated gloves","helmet"]:[],
      checklist:(required||[]).map(item=>({code:item.code,checked:approved||item.required===false,note:`${runId} checked`})),
      validUntil:reviewType==="start"&&approved?new Date(Date.now()+6*60*60*1000).toISOString():null,note};
  }
  return (await request(`/api/work-orders/${workId}/workflow-action`,actor.token,{method:"POST",body})).body;
}

async function completeGovernedWork({client,workId,assignee,safety,chief,template,scopeRows,authorizeStart=false}){
  for(const row of scopeRows){
    await request(`/api/work-orders/${workId}/scope-items/${row.id}`,assignee.token,{method:"PATCH",body:{
      completedQuantity:Number(row.planned_quantity),unresolvedQuantity:0,deferredQuantity:0,exceptionReason:"",requestException:false,
    }});
  }
  if(authorizeStart)await workflow(workId,safety,"safety_authorize_start",{reviewType:"start",template});
  await workflow(workId,assignee,"submit_completion");
  await workflow(workId,safety,"safety_accept_completion",{reviewType:"completion",template});
  return workflow(workId,chief,"management_close");
}

async function main() {
  localGuard();
  const client = await getPool().connect();
  try {
    const state = (await client.query("SELECT current_database() database,(SELECT max(version) FROM schema_migrations) schema")).rows[0];
    assert.equal(state.database,"erp_v2","Refusing to run against a non-demo database");
    assert.equal(state.schema,"0111","Demo schema 0111 is required");
    const owner = await loadOwner(client);
    const ownerToken = signAccessToken(owner.id);
    const employeeView = (await request("/api/employees",ownerToken)).body;
    const departments = new Map(employeeView.departments.map(item=>[item.name,item.id]));
    const participants = {};
    for (const definition of personas) participants[definition.key] = await ensurePersona(client,ownerToken,departments,definition);
    const cameraPosition=(await client.query(`SELECT position.id FROM positions position
      JOIN job_workspace_access access ON access.organization_id=position.organization_id AND access.job_id=position.job_id
      WHERE position.organization_id=$1 AND position.department_id=$2 AND position.active=true
        AND access.workspace_code='camera' AND access.active=true ORDER BY position.rank_level,position.title LIMIT 1`,
    [owner.organization_id,participants.cameraCoordinator.departmentId])).rows[0];
    assert.ok(cameraPosition,"An active camera workspace position is required");
    for(const key of ["cameraCoordinator","cameraWorker"]){
      await request(`/api/modules/structure/users/${participants[key].employeeId}`,ownerToken,{method:"PATCH",body:{
        departmentId:participants[key].departmentId,positionId:cameraPosition.id,managerUserId:null,
      }});
    }
    const permissionEvidence = Object.fromEntries(Object.entries(participants).map(([key,value])=>[key,{
      role:value.role,department:value.department,permissions:value.permissions.filter(permission=>
        /^(operational-incidents|work-orders|inventory|finance|safety)/.test(permission)),
    }]));
    assert.ok(participants.lightingReporter.permissions.includes("operational-incidents.report"));
    assert.ok(participants.storekeeper.permissions.includes("work-orders.material.issue"));
    assert.ok(!participants.accountant.permissions.includes("work-orders.material.issue"));
    assert.ok(!participants.electricWorker.permissions.includes("work-orders.workflow.safety"));
    record("J","persona permission matrix is least-privilege");

    const orgId=owner.organization_id;
    const lightingObject=(await client.query(`SELECT object_row.id,object_row.code,object_row.name
      FROM operational_objects object_row
      LEFT JOIN operational_object_specifications specification
        ON specification.organization_id=object_row.organization_id AND specification.id=object_row.current_specification_id
      LEFT JOIN LATERAL(SELECT COALESCE(sum(head_count),0)::int heads FROM operational_object_lamp_groups
        WHERE organization_id=object_row.organization_id AND specification_id=specification.id) lamps ON true
      WHERE object_row.organization_id=$1 AND object_row.domain='lighting' AND object_row.status<>'retired'
        AND COALESCE(NULLIF(lamps.heads,0),
          CASE WHEN object_row.metadata->>'totalHeadCount' ~ '^[0-9]+$' THEN (object_row.metadata->>'totalHeadCount')::int END,
          CASE WHEN object_row.metadata->>'headCount' ~ '^[0-9]+$' THEN (object_row.metadata->>'headCount')::int END,0)>=5
        ORDER BY COALESCE(NULLIF(lamps.heads,0),
          CASE WHEN object_row.metadata->>'headCount' ~ '^[0-9]+$' THEN (object_row.metadata->>'headCount')::int END,0) DESC LIMIT 1`,[orgId])).rows[0];
    const cameraObject=(await client.query(`SELECT object_row.id,object_row.code,object_row.name
      FROM operational_objects object_row WHERE object_row.organization_id=$1 AND object_row.domain='camera'
        AND object_row.status<>'retired' AND NOT EXISTS(SELECT 1 FROM operational_incidents incident
          WHERE incident.organization_id=object_row.organization_id AND incident.operational_object_id=object_row.id
            AND incident.status IN('open','in_progress')) ORDER BY object_row.created_at LIMIT 1`,[orgId])).rows[0];
    assert.ok(lightingObject,"A clean lighting object with measurable capacity is required");
    assert.ok(cameraObject,"A clean camera object is required");
    const workTypes=(await client.query(`SELECT work_type.id,work_type.code,work_type.category,route.workflow_policy_id
      FROM organization_work_types work_type JOIN organization_work_type_routes route
        ON route.organization_id=work_type.organization_id AND route.work_type_id=work_type.id AND route.active=true
      WHERE work_type.organization_id=$1 AND work_type.code=ANY($2::text[])`,[orgId,["lighting-repair","camera-repair"]])).rows;
    const lightingType=workTypes.find(item=>item.code==="lighting-repair"),cameraType=workTypes.find(item=>item.code==="camera-repair");
    assert.ok(lightingType&&cameraType,"Both governed repair work types are required");
    const templates=(await client.query(`SELECT template.*,route.work_type_id FROM organization_work_safety_template_routes route
      JOIN organization_work_safety_templates template ON template.organization_id=route.organization_id AND template.id=route.safety_template_id
      WHERE route.organization_id=$1 AND route.active=true AND template.active=true AND route.work_type_id=ANY($2::uuid[])`,
    [orgId,[lightingType.id,cameraType.id]])).rows;
    const lightingTemplate=templates.find(item=>item.work_type_id===lightingType.id),cameraTemplate=templates.find(item=>item.work_type_id===cameraType.id);
    assert.ok(lightingTemplate&&cameraTemplate,"Active HSE templates are required");

    await request(`/api/lighting/objects/${lightingObject.id}/dossier`,participants.lightingReporter.token);
    await request(`/api/camera/objects/${cameraObject.id}/dossier`,participants.cameraCoordinator.token);
    record("A","lighting and camera dossiers load from canonical object ids",{lightingObject,cameraObject});

    const reportedAt=new Date().toISOString(),batchKey=uid();
    const lightingBatch={idempotencyKey:batchKey,rows:[
      {rowKey:uid(),operationalObjectId:lightingObject.id,assetId:null,incidentType:"lamp_out",affectedQuantity:2,reportedAt,note:`${runId} batch lamp`},
      {rowKey:uid(),operationalObjectId:lightingObject.id,assetId:null,incidentType:"fixture_damage",affectedQuantity:1,reportedAt,note:`${runId} batch fixture`},
    ]};
    const batch=(await request("/api/lighting/incidents/batch",participants.lightingReporter.token,{method:"POST",expected:[201],body:lightingBatch})).body;
    const batchReplay=(await request("/api/lighting/incidents/batch",participants.lightingReporter.token,{method:"POST",body:lightingBatch})).body;
    assert.equal(batchReplay.replayed,true);
    await request("/api/lighting/incidents/batch",participants.lightingReporter.token,{method:"POST",expected:[409],body:{...lightingBatch,rows:[{...lightingBatch.rows[0],affectedQuantity:1},lightingBatch.rows[1]]}});
    const repeat=(await request("/api/lighting/incidents/batch",participants.lightingReporter.token,{method:"POST",expected:[201],body:{idempotencyKey:uid(),rows:[
      {rowKey:uid(),operationalObjectId:lightingObject.id,assetId:null,incidentType:"lamp_out",affectedQuantity:1,reportedAt,note:`${runId} repeat lamp`},
    ]}})).body.items[0];
    const wrong=(await request("/api/lighting/incidents/batch",participants.lightingReporter.token,{method:"POST",expected:[201],body:{idempotencyKey:uid(),rows:[
      {rowKey:uid(),operationalObjectId:lightingObject.id,assetId:null,incidentType:"cable_fault",affectedQuantity:1,reportedAt,note:`${runId} wrong entry`},
    ]}})).body.items[0];
    const cancelBody={reason:`${runId} verified mistaken report`,expectedVersion:Number(wrong.version),idempotencyKey:uid()};
    const cancelled=(await request(`/api/lighting/incidents/${wrong.id}/cancel`,participants.chiefEngineer.token,{method:"POST",body:cancelBody})).body;
    const cancelledReplay=(await request(`/api/lighting/incidents/${wrong.id}/cancel`,participants.chiefEngineer.token,{method:"POST",body:cancelBody})).body;
    assert.equal(cancelledReplay.replayed,true);assert.equal(cancelled.item.status,"cancelled");
    record("B","batch, retry, conflict, repeat and cancellation preserve exact incident records",{incidentIds:[...batch.items.map(x=>x.id),repeat.id,wrong.id]});

    const workBody={incidentId:batch.items[0].id,operationalObjectId:lightingObject.id,assetId:null,
      assignedTo:participants.electricEngineer.userId,responsibleEmployeeId:participants.electricEngineer.employeeId,
      executorEmployeeIds:[participants.electricWorker.employeeId],workTypeId:lightingType.id,
      title:`${runId} governed lighting repair`,description:`${runId} exact E2E flow`,category:"lighting",priority:"high",assignmentKind:"normal"};
    await request("/api/work-orders",participants.lightingCoordinator.token,{method:"POST",expected:[400,409],body:{...workBody,workTypeId:cameraType.id}});
    const work=(await request("/api/work-orders",participants.lightingCoordinator.token,{method:"POST",expected:[201],body:workBody})).body.item;
    await request("/api/work-orders",participants.lightingCoordinator.token,{method:"POST",expected:[409],body:workBody});
    for(const incident of [batch.items[1],repeat]){
      const attachBody={workOrderId:work.id,idempotencyKey:uid()};
      const attached=(await request(`/api/work-orders/intake/${incident.id}/attach`,participants.electricEngineer.token,{method:"POST",expected:[201],body:attachBody})).body;
      const replayed=(await request(`/api/work-orders/intake/${incident.id}/attach`,participants.electricEngineer.token,{method:"POST",body:attachBody})).body;
      assert.equal(attached.replayed,false);assert.equal(replayed.replayed,true);
    }
    let history=(await request(`/api/work-orders/${work.id}/history`,participants.electricEngineer.token)).body;
    assert.equal(history.scopeItems.length,3);assert.equal(history.participants.length,2);
    record("C","three incidents route to one assigned work with responsible and executor participants",{workOrderId:work.id});

    await request(`/api/work-orders/${work.id}/workflow-action`,participants.chiefEngineer.token,{method:"POST",expected:[403],body:{action:"safety_authorize_start",note:`${runId} forbidden`,idempotencyKey:uid()}});
    await workflow(work.id,participants.safety,"safety_return_start",{reviewType:"start",template:lightingTemplate,note:`${runId} return for missing isolation`});
    await workflow(work.id,participants.safety,"safety_authorize_start",{reviewType:"start",template:lightingTemplate,note:`${runId} safe to start`});
    record("D","HSE return and structured authorization gate execution; unauthorized actor denied");

    let warehouse=(await client.query("SELECT * FROM warehouses WHERE organization_id=$1 AND code=$2",[orgId,`${runId}-WH`.toUpperCase()])).rows[0];
    if(!warehouse)warehouse=(await request("/api/modules/inventory/warehouses",participants.storekeeper.token,{method:"POST",expected:[201],body:{code:`${runId}-WH`,name:`${runId} warehouse`,location:"Demo only"}})).body.item;
    let inventoryItem=(await client.query("SELECT * FROM inventory_items WHERE organization_id=$1 AND sku=$2",[orgId,`${runId}-LAMP`.toUpperCase()])).rows[0];
    if(!inventoryItem)inventoryItem=(await request("/api/modules/inventory/items",participants.storekeeper.token,{method:"POST",expected:[201],body:{sku:`${runId}-LAMP`,name:`${runId} LED lamp`,category:"E2E",unit:"piece",minimumStock:1}})).body.item;
    const currentBalance=Number((await client.query("SELECT quantity FROM inventory_balances WHERE organization_id=$1 AND warehouse_id=$2 AND item_id=$3",[orgId,warehouse.id,inventoryItem.id])).rows[0]?.quantity||0);
    if(currentBalance<10)await request("/api/modules/inventory/movements",participants.storekeeper.token,{method:"POST",expected:[201],body:{itemId:inventoryItem.id,type:"receipt",fromWarehouseId:null,toWarehouseId:warehouse.id,quantity:10-currentBalance,reference:`${runId}-OPENING`,note:"Demo opening stock"}});
    const materialBody={inventoryItemId:inventoryItem.id,quantity:3,reason:`${runId} planned repair`,idempotencyKey:uid()};
    const material=(await request(`/api/work-orders/${work.id}/materials`,participants.electricEngineer.token,{method:"POST",expected:[201],body:materialBody})).body.item;
    assert.equal((await request(`/api/work-orders/${work.id}/materials`,participants.electricEngineer.token,{method:"POST",body:materialBody})).body.replayed,true);
    await request(`/api/work-orders/${work.id}/materials/${material.id}/decision`,participants.chiefEngineer.token,{method:"POST",body:{decision:"approved",approvedQuantity:2,note:`${runId} partial approval`}});
    const beforeIssue=Number((await client.query("SELECT quantity FROM inventory_balances WHERE organization_id=$1 AND warehouse_id=$2 AND item_id=$3",[orgId,warehouse.id,inventoryItem.id])).rows[0].quantity),issueKey=uid();
    await request(`/api/work-orders/${work.id}/materials/${material.id}/issue`,participants.storekeeper.token,{method:"POST",expected:[201],body:{warehouseId:warehouse.id,idempotencyKey:issueKey}});
    assert.equal((await request(`/api/work-orders/${work.id}/materials/${material.id}/issue`,participants.storekeeper.token,{method:"POST",body:{warehouseId:warehouse.id,idempotencyKey:issueKey}})).body.replayed,true);
    const afterIssue=Number((await client.query("SELECT quantity FROM inventory_balances WHERE organization_id=$1 AND warehouse_id=$2 AND item_id=$3",[orgId,warehouse.id,inventoryItem.id])).rows[0].quantity);
    assert.equal(beforeIssue-afterIssue,2);
    await request(`/api/work-orders/${work.id}/materials/${material.id}/consume`,participants.electricEngineer.token,{method:"POST",body:{consumedQuantity:1}});
    const returnBody={warehouseId:warehouse.id,returnedQuantity:1,idempotencyKey:uid(),note:`${runId} unused lamp returned`};

    history=(await request(`/api/work-orders/${work.id}/history`,participants.electricEngineer.token)).body;
    const partialScope=history.scopeItems.find(item=>item.item_code===`incident:${batch.items[0].id}`);
    for(const item of history.scopeItems){
      const partial=item.id===partialScope.id;
      await request(`/api/work-orders/${work.id}/scope-items/${item.id}`,participants.electricEngineer.token,{method:"PATCH",body:{
        completedQuantity:partial?1:Number(item.planned_quantity),unresolvedQuantity:partial?1:0,deferredQuantity:0,
        exceptionReason:partial?`${runId} one lamp requires access permit`:"",requestException:partial,
      }});
    }
    const dispositionKey=uid(),dueAt=new Date(Date.now()+24*60*60*1000).toISOString();
    const exceptionBody={decision:"accepted",note:`${runId} follow-up approved`,disposition:{type:"follow_up",reasonCode:"access_blocked",reason:`${runId} access blocked`,dueAt,assignedTo:participants.electricEngineer.userId,idempotencyKey:dispositionKey}};
    const exception=(await request(`/api/work-orders/${work.id}/scope-items/${partialScope.id}/exception`,participants.chiefEngineer.token,{method:"POST",body:exceptionBody})).body;
    assert.equal((await request(`/api/work-orders/${work.id}/scope-items/${partialScope.id}/exception`,participants.chiefEngineer.token,{method:"POST",body:exceptionBody})).body.replayed,true);
    const followUpId=exception.disposition.follow_up_work_order_id;
    const followLinks=(await client.query("SELECT incident_id FROM operational_incident_work_orders WHERE organization_id=$1 AND work_order_id=$2",[orgId,followUpId])).rows.map(row=>row.incident_id);
    assert.deepEqual(followLinks,[batch.items[0].id]);
    record("E","partial measured outcome records one unresolved unit with evidence");
    record("G","accepted exception creates exact-quantity follow-up linked only to its source incident",{followUpId});

    await workflow(work.id,participants.safety,"safety_suspend_execution",{reviewType:"start",template:lightingTemplate,note:`${runId} permit invalidated after measured scope change`});
    await workflow(work.id,participants.safety,"safety_authorize_start",{reviewType:"start",template:lightingTemplate,note:`${runId} re-authorized against final measured scope`});
    await workflow(work.id,participants.electricEngineer,"submit_completion");
    await workflow(work.id,participants.safety,"safety_accept_completion",{reviewType:"completion",template:lightingTemplate});
    await request(`/api/work-orders/${work.id}/workflow-action`,participants.chiefEngineer.token,{method:"POST",expected:[409],body:{
      action:"management_close",note:`${runId} must not close before material return`,idempotencyKey:uid(),
    }});
    const returned=(await request(`/api/work-orders/${work.id}/materials/${material.id}/return`,participants.storekeeper.token,{method:"POST",expected:[201],body:returnBody})).body;
    assert.equal((await request(`/api/work-orders/${work.id}/materials/${material.id}/return`,participants.storekeeper.token,{method:"POST",body:returnBody})).body.replayed,true);
    const afterReturn=Number((await client.query("SELECT quantity FROM inventory_balances WHERE organization_id=$1 AND warehouse_id=$2 AND item_id=$3",[orgId,warehouse.id,inventoryItem.id])).rows[0].quantity);
    assert.equal(afterReturn,afterIssue+1);assert.equal(returned.item.status,"reconciled");
    record("F","request, partial approval, issue, partial consumption, blocked closure, unused return and retries reconcile once",{materialRequestId:material.id,beforeIssue,afterIssue,afterReturn});
    await workflow(work.id,participants.chiefEngineer,"management_close");
    let sourceStates=(await client.query("SELECT id,status,resolved_quantity,affected_quantity FROM operational_incidents WHERE organization_id=$1 AND id=ANY($2::uuid[]) ORDER BY id",[orgId,batch.items.map(x=>x.id).concat(repeat.id)])).rows;
    assert.equal(sourceStates.find(x=>x.id===batch.items[0].id).status,"in_progress");
    assert.ok(sourceStates.filter(x=>x.id!==batch.items[0].id).every(x=>x.status==="resolved"));
    const followHistory=(await request(`/api/work-orders/${followUpId}/history`,participants.electricEngineer.token)).body;
    assert.equal(followHistory.scopeItems.length,1);assert.equal(Number(followHistory.scopeItems[0].planned_quantity),1);
    await completeGovernedWork({client,workId:followUpId,assignee:participants.electricEngineer,safety:participants.safety,chief:participants.chiefEngineer,template:lightingTemplate,scopeRows:followHistory.scopeItems,authorizeStart:true});
    sourceStates=(await client.query("SELECT status,resolved_quantity,affected_quantity FROM operational_incidents WHERE organization_id=$1 AND id=$2",[orgId,batch.items[0].id])).rows;
    assert.equal(sourceStates[0].status,"resolved");assert.equal(Number(sourceStates[0].resolved_quantity),Number(sourceStates[0].affected_quantity));

    const cameraIncident=(await request("/api/camera/incidents/batch",participants.cameraCoordinator.token,{method:"POST",expected:[201],body:{idempotencyKey:uid(),rows:[
      {rowKey:uid(),operationalObjectId:cameraObject.id,incidentType:"network_fault",affectedQuantity:1,reportedAt:new Date().toISOString(),note:`${runId} camera flow`},
    ]}})).body.items[0];
    const cameraWork=(await request("/api/work-orders",participants.cameraCoordinator.token,{method:"POST",expected:[201],body:{incidentId:cameraIncident.id,operationalObjectId:cameraObject.id,assetId:null,
      assignedTo:participants.cameraCoordinator.userId,responsibleEmployeeId:participants.cameraCoordinator.employeeId,executorEmployeeIds:[participants.cameraWorker.employeeId],
      workTypeId:cameraType.id,title:`${runId} governed camera repair`,description:`${runId} camera E2E`,category:"camera",priority:"normal",assignmentKind:"normal"}})).body.item;
    const cameraHistory=(await request(`/api/work-orders/${cameraWork.id}/history`,participants.cameraCoordinator.token)).body;
    await completeGovernedWork({client,workId:cameraWork.id,assignee:participants.cameraCoordinator,safety:participants.safety,chief:participants.chiefEngineer,template:cameraTemplate,scopeRows:cameraHistory.scopeItems,authorizeStart:true});
    const finalCamera=(await client.query("SELECT status,resolved_quantity,affected_quantity FROM operational_incidents WHERE organization_id=$1 AND id=$2",[orgId,cameraIncident.id])).rows[0];
    assert.equal(finalCamera.status,"resolved");
    record("H","camera incident completes through the same HSE and acceptance controls",{cameraWorkId:cameraWork.id});

    await request("/api/dashboard/overview",participants.management.token);
    const randomId=uid();
    await request(`/api/work-orders/${randomId}/history`,participants.management.token,{expected:[404]});
    const audit=(await client.query(`SELECT action,user_id,organization_id,created_at FROM audit_logs
      WHERE organization_id=$1 AND (detail::text LIKE $2 OR entity_id=ANY($3::text[])) ORDER BY created_at`,
    [orgId,`%${runId}%`,[work.id,followUpId,cameraWork.id]])).rows;
    assert.ok(audit.length>=20);assert.ok(audit.every(row=>row.user_id&&row.organization_id===orgId&&row.created_at));
    record("I","management dashboard loads after reconciled closure");
    record("J","random cross-boundary identifiers fail closed and audit rows are attributable",{auditRows:audit.length});

    const final={runId,database:state.database,schema:state.schema,goals,personas:permissionEvidence,evidence,
      ids:{lightingObjectId:lightingObject.id,lightingWorkOrderId:work.id,followUpWorkOrderId:followUpId,cameraObjectId:cameraObject.id,cameraWorkOrderId:cameraWork.id,
        incidentIds:[...batch.items.map(x=>x.id),repeat.id,wrong.id,cameraIncident.id],materialRequestId:material.id,warehouseId:warehouse.id,inventoryItemId:inventoryItem.id},
      materialReturn:{status:"implemented_and_verified",schema:"0111"}};
    console.log(JSON.stringify(final,null,2));
  } finally {
    client.release();
    await closePool();
  }
}

main().catch(async error=>{
  console.error(error.stack || error.message);
  await closePool().catch(()=>{});
  process.exitCode=1;
});
