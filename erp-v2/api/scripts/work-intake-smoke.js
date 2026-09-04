"use strict";

require("dotenv").config();
const assert=require("node:assert/strict");
const { getPool,closePool }=require("../src/db");
const { signAccessToken }=require("../src/security/token");
const base=String(process.env.SMOKE_API_BASE||"http://127.0.0.1:4100").replace(/\/$/,"");

(async()=>{
  const slug=String(process.env.SMOKE_TENANT_SLUG||"choibalsan-hugjil").trim();
  const privileged=await getPool().query(`SELECT u.id
    FROM users u JOIN organizations o ON o.id=u.organization_id
    JOIN user_roles ur ON ur.organization_id=u.organization_id AND ur.user_id=u.id
    JOIN organization_role_permissions rp ON rp.organization_id=ur.organization_id AND rp.role_id=ur.role_id
    WHERE o.slug=$1 AND u.active=true AND u.can_login=true
    GROUP BY u.id
    HAVING bool_or(rp.permission_code='work-orders.read-all')
       AND bool_or(rp.permission_code='work-orders.create')
    LIMIT 1`,[slug]);
  assert.ok(privileged.rowCount,"A tenant intake coordinator is required");
  const response=await fetch(`${base}/api/work-orders/intake`,{
    headers:{authorization:`Bearer ${signAccessToken(privileged.rows[0].id)}`},
  });
  const body=await response.json();
  assert.equal(response.status,200,JSON.stringify(body));
  assert.equal(body.capabilities.canTriage,true);
  assert.ok(Array.isArray(body.items));

  const ordinary=await getPool().query(`SELECT u.id
    FROM users u JOIN organizations o ON o.id=u.organization_id
    WHERE o.slug=$1 AND u.active=true AND u.can_login=true AND NOT EXISTS(
      SELECT 1 FROM user_roles ur
      JOIN organization_role_permissions rp
        ON rp.organization_id=ur.organization_id AND rp.role_id=ur.role_id
      WHERE ur.organization_id=u.organization_id AND ur.user_id=u.id
        AND rp.permission_code='work-orders.read-all'
    ) LIMIT 1`,[slug]);
  if(ordinary.rowCount){
    const denied=await fetch(`${base}/api/work-orders/intake`,{
      headers:{authorization:`Bearer ${signAccessToken(ordinary.rows[0].id)}`},
    });
    const deniedBody=await denied.json();
    assert.equal(denied.status,200,JSON.stringify(deniedBody));
    assert.equal(deniedBody.capabilities.canTriage,false);
    assert.equal(deniedBody.items.length,0);
  }
  console.log(`Work intake smoke passed: ${body.items.length} tenant items; ${ordinary.rowCount?"ordinary user receives 0":"no ordinary login fixture available"}.`);
  await closePool();
})().catch(async error=>{
  console.error(error);
  await closePool().catch(()=>{});
  process.exitCode=1;
});
