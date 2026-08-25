"use strict";

require("dotenv").config();
const assert=require("node:assert/strict");
const {getPool,closePool}=require("../src/db");
const {signAccessToken}=require("../src/security/token");

(async()=>{
  const pilotSlug=process.env.SMOKE_ORG_SLUG||process.env.BOOTSTRAP_ORG_SLUG;
  assert.ok(pilotSlug,"SMOKE_ORG_SLUG or BOOTSTRAP_ORG_SLUG is required");
  const result=await getPool().query(
    `SELECT u.id,u.full_name,
            array_agg(DISTINCT r.code ORDER BY r.code) AS roles,
            array_agg(DISTINCT rp.permission_code ORDER BY rp.permission_code) AS permissions
       FROM organizations o
       JOIN users u ON u.organization_id=o.id AND u.role='hr'
       JOIN user_roles ur ON ur.organization_id=u.organization_id AND ur.user_id=u.id
       JOIN organization_roles r ON r.organization_id=ur.organization_id AND r.id=ur.role_id
       LEFT JOIN organization_role_permissions rp ON rp.organization_id=r.organization_id AND rp.role_id=r.id
      WHERE o.slug=$1
      GROUP BY u.id,u.full_name
      LIMIT 1`,
    [pilotSlug]
  );
  assert.ok(result.rowCount,"Pilot HR user is required");
  const user=result.rows[0];
  for(const role of ["hr-officer","records-officer","archivist"])assert.ok(user.roles.includes(role),`Missing ${role}`);
  for(const permission of ["hr.manage","records.manage","archive.manage"])assert.ok(user.permissions.includes(permission),`Missing ${permission}`);
  const headers={authorization:`Bearer ${signAccessToken(user.id)}`};
  for(const module of ["hr","records","archive"]){
    const response=await fetch(`http://127.0.0.1:4100/api/${module}/overview`,{headers});
    assert.equal(response.status,200,`${module} overview must respond for pilot HR officer`);
  }
  console.log(JSON.stringify({user:user.full_name,roles:user.roles,permissions:user.permissions,endpoints:["hr:200","records:200","archive:200"]},null,2));
  await closePool();
})().catch(async error=>{console.error(error);await closePool().catch(()=>{});process.exitCode=1});
