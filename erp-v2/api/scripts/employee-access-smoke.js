"use strict";

require("dotenv").config();
const assert=require("node:assert/strict");
const {getPool,closePool}=require("../src/db");
const {signAccessToken}=require("../src/security/token");

(async()=>{
  const owner=await getPool().query(
    `SELECT u.id FROM users u
      JOIN user_roles ur ON ur.user_id=u.id AND ur.organization_id=u.organization_id
      JOIN organization_roles r ON r.id=ur.role_id AND r.organization_id=ur.organization_id
     WHERE r.code='owner' AND u.active=true AND u.can_login=true LIMIT 1`
  );
  assert.ok(owner.rowCount,"An active organization owner is required");
  const headers={authorization:`Bearer ${signAccessToken(owner.rows[0].id)}`};
  const response=await fetch("http://127.0.0.1:4100/api/employees",{headers});
  const body=await response.json();
  assert.equal(response.status,200);
  assert.ok(Array.isArray(body.items));
  assert.ok(Array.isArray(body.departments));
  assert.ok(Array.isArray(body.positions));
  const structureResponse=await fetch("http://127.0.0.1:4100/api/modules/structure",{headers});
  assert.equal(structureResponse.status,200);const structure=await structureResponse.json();assert.equal(structure.people.length,body.items.length);
  const now=new Date(),attendanceResponse=await fetch(`http://127.0.0.1:4100/api/attendance?year=${now.getUTCFullYear()}&month=${now.getUTCMonth()+1}`,{headers});
  assert.equal(attendanceResponse.status,200);const attendance=await attendanceResponse.json();assert.ok(Array.isArray(attendance.employees));
  const hrResponse=await fetch("http://127.0.0.1:4100/api/hr/overview",{headers});
  assert.equal(hrResponse.status,200);const hr=await hrResponse.json();assert.equal(hr.employees.length,body.items.length);
  console.log(`People Core smoke passed: ${body.items.length} employees, ${body.items.filter(item=>item.can_login).length} login accounts; structure, HR and attendance agree.`);
  await closePool();
})().catch(async error=>{console.error(error);await closePool().catch(()=>{});process.exitCode=1});
