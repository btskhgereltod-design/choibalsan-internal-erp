"use strict";

const assert=require("node:assert/strict");
const {getPool,closePool}=require("../src/db");
const {signAccessToken}=require("../src/security/token");

const base=String(process.env.SMOKE_API_BASE||"http://127.0.0.1:4100").replace(/\/$/,"");
const slug=String(process.env.SMOKE_TENANT_SLUG||"choibalsan-hugjil").trim();
const expectedPilotAreas=["road-lighting","ger-area-lighting","tower-lighting","panel-board","traffic-signal"];

function metric(data,code){
  const matches=item=>item.service_area_code===code;
  return {
    records:[...(data.assets||[]),...(data.fixedAssets||[])].filter(matches).length,
    issues:(data.incidents||[]).filter(item=>matches(item)&&["open","in_progress"].includes(item.status)).length,
    work:(data.workOrders||[]).filter(item=>matches(item)&&!["completed","cancelled"].includes(item.status)).length
  };
}

async function main(){
  const user=(await getPool().query(`SELECT u.id FROM users u
    JOIN organizations o ON o.id=u.organization_id
    JOIN user_roles ur ON ur.organization_id=u.organization_id AND ur.user_id=u.id
    JOIN organization_roles r ON r.organization_id=ur.organization_id AND r.id=ur.role_id
    WHERE o.slug=$1 AND u.active=true AND u.can_login=true AND r.code='owner'
    ORDER BY u.created_at LIMIT 1`,[slug])).rows[0];
  assert.ok(user,`Active owner not found for ${slug}`);
  const response=await fetch(`${base}/api/lighting/workspace`,{headers:{authorization:`Bearer ${signAccessToken(user.id)}`}});
  assert.equal(response.status,200,`Lighting workspace returned HTTP ${response.status}`);
  const data=await response.json();
  assert.equal(data.available,true,"Lighting workspace is unavailable");
  assert.ok(Array.isArray(data.serviceAreas));
  assert.ok(Array.isArray(data.assets));
  assert.ok(Array.isArray(data.fixedAssets));
  assert.ok(Array.isArray(data.incidents));
  assert.ok(Array.isArray(data.workOrders));
  if(slug==="choibalsan-hugjil")assert.deepEqual(data.serviceAreas.map(area=>area.code),expectedPilotAreas);
  const known=new Set(data.serviceAreas.map(area=>area.code));
  for(const item of [...data.assets,...data.fixedAssets,...data.incidents,...data.workOrders]){
    if(item.service_area_code)assert.ok(known.has(item.service_area_code),`Unknown area ${item.service_area_code}`);
  }
  const unclassified={
    records:[...data.assets,...data.fixedAssets].filter(item=>!item.service_area_code).length,
    issues:data.incidents.filter(item=>!item.service_area_code&&["open","in_progress"].includes(item.status)).length,
    work:data.workOrders.filter(item=>!item.service_area_code&&!["completed","cancelled"].includes(item.status)).length
  };
  console.log(JSON.stringify({tenant:slug,areas:data.serviceAreas.map(area=>({code:area.code,...metric(data,area.code)})),unclassified}));
}

main().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>closePool());
