"use strict";

require("dotenv").config();
const assert = require("node:assert/strict");
const { createApp } = require("../src/app");
const { getPool, closePool } = require("../src/db");
const { signPlatformToken } = require("../src/security/token");

async function main() {
  assert.equal(process.env.FOUNDER_CONTROL_TEST_ALLOW_DISPOSABLE, "true", "Disposable test opt-in is required");
  const database = await getPool().query("SELECT current_database() AS name");
  assert.equal(database.rows[0].name, "overva", "Expected disposable OVERVA database");
  const admin = await getPool().query("SELECT id FROM platform_admins WHERE active=true ORDER BY created_at LIMIT 1");
  assert.equal(admin.rowCount, 1, "Expected one disposable founder admin");
  const organization = await getPool().query(
    `INSERT INTO organizations(slug,name) VALUES('founder-control-test','Founder Control Test')
     ON CONFLICT(slug) DO UPDATE SET name=EXCLUDED.name RETURNING id`
  );
  const authorization = `Bearer ${signPlatformToken(admin.rows[0].id)}`;
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve,reject)=>{server.once("listening",resolve);server.once("error",reject);});
  const base = `http://127.0.0.1:${server.address().port}/api/platform`;
  const request = async(path,options={})=>{
    const response=await fetch(`${base}${path}`,{...options,headers:{authorization,"content-type":"application/json",...(options.headers||{})}});
    const body=await response.json();return {response,body};
  };
  try {
    const founder=await request("/founder/control");
    assert.equal(founder.response.status,200,JSON.stringify(founder.body));
    assert(founder.body.founder.roles.some(role=>role.code==="founder-operator"));
    assert.equal(founder.body.founder.permissions.length,15);
    assert.equal(founder.body.boundaries.tenantApiBypass,false);

    const issued=await request("/support-access",{method:"POST",body:JSON.stringify({
      organizationId:organization.rows[0].id,
      reason:"Disposable integration diagnostic verification",
      durationMinutes:5,
      scopes:["diagnostics","configuration","audit"],
    })});
    assert.equal(issued.response.status,201,JSON.stringify(issued.body));
    const grantId=issued.body.item.id;
    const snapshot=await request(`/support-access/${grantId}/snapshot`);
    assert.equal(snapshot.response.status,200,JSON.stringify(snapshot.body));
    assert.equal(snapshot.body.boundaries.rawTenantRows,false);
    assert.equal(snapshot.body.boundaries.mutationsAllowed,false);
    assert(Array.isArray(snapshot.body.snapshot.configuration));

    const revoked=await request(`/support-access/${grantId}/revoke`,{method:"POST",body:"{}"});
    assert.equal(revoked.response.status,200,JSON.stringify(revoked.body));
    const denied=await request(`/support-access/${grantId}/snapshot`);
    assert.equal(denied.response.status,403,JSON.stringify(denied.body));
    assert.equal(denied.body.code,"SUPPORT_ACCESS_INACTIVE");

    const evidence=await getPool().query(
      `SELECT event_type,count(*)::int AS events FROM platform_support_access_events
       WHERE grant_id=$1 GROUP BY event_type ORDER BY event_type`,[grantId]
    );
    assert.deepEqual(evidence.rows.map(row=>row.event_type),["expired_denied","issued","revoked","snapshot_read"]);
    console.log("Founder Control integration smoke passed: founder RBAC, issue, snapshot, revoke, deny, immutable evidence.");
  } finally {
    await new Promise(resolve=>server.close(resolve));
    await closePool();
  }
}

main().catch(error=>{console.error(error);process.exitCode=1;});
