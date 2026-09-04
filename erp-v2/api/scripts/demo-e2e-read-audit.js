"use strict";
require("dotenv").config();
const assert=require("node:assert/strict");
const {getPool,closePool}=require("../src/db");
const {signAccessToken}=require("../src/security/token");
const base="http://127.0.0.1:4100";
async function get(path,token){const response=await fetch(base+path,{headers:{authorization:`Bearer ${token}`}});const body=await response.json();assert.equal(response.status,200,`${path}: ${response.status} ${JSON.stringify(body)}`);return body}
async function main(){
  const client=await getPool().connect();try{
    const state=(await client.query("select current_database() database,(select max(version) from schema_migrations) schema")).rows[0];assert.deepEqual(state,{database:"erp_v2",schema:"0111"});
    const owner=(await client.query(`SELECT user_row.id,user_row.organization_id FROM users user_row JOIN organizations organization ON organization.id=user_row.organization_id
      JOIN user_roles membership ON membership.organization_id=user_row.organization_id AND membership.user_id=user_row.id
      JOIN organization_roles role ON role.organization_id=membership.organization_id AND role.id=membership.role_id
      WHERE organization.slug='choibalsan-hugjil' AND role.code='owner' AND user_row.active AND user_row.can_login LIMIT 1`)).rows[0];
    const token=signAccessToken(owner.id),lighting=await get("/api/lighting/workspace",token),camera=await get("/api/camera/workspace",token);
    const categories={};
    for(const code of ["road-lighting","ger-area-lighting","tower-lighting"]){
      const item=lighting.assets.find(asset=>asset.service_area_code===code);assert.ok(item,`Missing lighting category ${code}`);
      const dossier=await get(`/api/lighting/objects/${item.id}/dossier`,token);assert.equal(dossier.item.id,item.id);
      categories[code]={id:item.id,code:item.code,historyEvents:(dossier.activity||dossier.events||[]).length};
    }
    const traffic=lighting.fixedAssets.find(asset=>asset.service_area_code==="traffic-signal");assert.ok(traffic,"Missing traffic signal fixed asset");
    const trafficDossier=await get(`/api/assets/${traffic.id}`,token);assert.equal(trafficDossier.item.id,traffic.id);categories["traffic-signal"]={id:traffic.id,code:traffic.code};
    const cameraObject=camera.assets[0];assert.ok(cameraObject,"Missing camera object");const cameraDossier=await get(`/api/camera/objects/${cameraObject.id}/dossier`,token);assert.equal(cameraDossier.item.id,cameraObject.id);categories.camera={id:cameraObject.id,code:cameraObject.code};
    const prefixCounts=(await client.query(`SELECT status,count(*)::int count,COALESCE(sum(affected_quantity),0)::numeric affected,COALESCE(sum(resolved_quantity),0)::numeric resolved
      FROM operational_incidents WHERE organization_id=$1 AND detail::text LIKE '%E2E-20260905-%' GROUP BY status ORDER BY status`,[owner.organization_id])).rows;
    const incomplete=(await client.query(`SELECT count(*)::int count FROM work_orders WHERE organization_id=$1 AND
      (title LIKE 'E2E-20260905-%' OR title LIKE '%E2E-20260905-%') AND status NOT IN('completed','cancelled')`,[owner.organization_id])).rows[0].count;
    assert.equal(incomplete,0,"No E2E work may remain unfinished");
    const lastRun=(await client.query(`SELECT count(*)::int works,count(*) FILTER(WHERE status='completed')::int completed
      FROM work_orders WHERE organization_id=$1 AND (title LIKE 'E2E-20260905-ROLE10%' OR title LIKE '%E2E-20260905-ROLE10%')`,[owner.organization_id])).rows[0];
    assert.equal(lastRun.works,lastRun.completed);assert.equal(lastRun.works,3);
    console.log(JSON.stringify({database:state.database,schema:state.schema,categories,workspaceSummary:{lighting:lighting.summary,camera:camera.summary},prefixCounts,lastRun,incomplete},null,2));
  }finally{client.release();await closePool()}
}
main().catch(async error=>{console.error(error.stack||error.message);await closePool().catch(()=>{});process.exitCode=1});
