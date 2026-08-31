"use strict";

if (process.env.RUN_PRODUCTION_RELEASE_CONTRACT_SMOKE !== "1") {
  module.exports = {};
} else {
  require("dotenv").config();
  const assert = require("node:assert/strict");
  const { getPool, closePool } = require("../src/db");
  const { activeAssignee, replayAssignment } = require("../src/services/work-order-assignment");

  async function main() {
    const pool = getPool();
    try {
      const schema = await pool.query("SELECT max(version) AS version FROM schema_migrations");
      assert.equal(schema.rows[0].version, "0080", "Release contract smoke requires schema 0080");

      const identities = await pool.query(
        `SELECT home.organization_id,foreign_user.id AS foreign_user_id
           FROM users home
           JOIN users foreign_user ON foreign_user.organization_id<>home.organization_id
          WHERE home.active=true AND foreign_user.active=true
          ORDER BY home.id,foreign_user.id LIMIT 1`
      );
      assert.ok(identities.rowCount, "Two tenant identities are required for isolation smoke");
      const foreign = await activeAssignee(
        pool,identities.rows[0].organization_id,identities.rows[0].foreign_user_id
      );
      assert.equal(foreign,null,"A foreign-tenant user must not resolve as an assignee");

      const event = {
        id:1,
        to_assignee_user_id:"00000000-0000-4000-8000-000000000001",
        assignment_reason:"release-contract",
        assignment_source:"api",
        actor_user_id:"00000000-0000-4000-8000-000000000002",
      };
      const mockClient = { query:async () => ({ rowCount:1,rows:[event] }) };
      const request = {
        organizationId:"00000000-0000-4000-8000-000000000003",
        workOrderId:"00000000-0000-4000-8000-000000000004",
        assigneeUserId:event.to_assignee_user_id,
        actorUserId:event.actor_user_id,
        source:"api",reason:"release-contract",
        idempotencyKey:"00000000-0000-4000-8000-000000000005",
      };
      const replay = await replayAssignment(mockClient,request);
      assert.equal(replay.id,event.id,"An exact assignment retry must replay the original event");
      await assert.rejects(
        replayAssignment(mockClient,{...request,reason:"different-payload"}),
        error => error.code === "ASSIGNMENT_IDEMPOTENCY_CONFLICT"
      );
      console.log("Production release contract smoke passed: schema 0080, cross-tenant assignee lookup denied, exact idempotency replay accepted, conflicting payload rejected.");
    } finally {
      await closePool();
    }
  }

  main().catch(async error => {
    console.error(error);
    await closePool().catch(() => {});
    process.exitCode = 1;
  });
}
