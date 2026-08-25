"use strict";

const path = require("node:path");
const appRoot = process.env.OVERVA_APP_ROOT || path.resolve(__dirname, "..");
const { getPool } = require(path.join(appRoot, "src", "db"));
const { provisionTenant } = require(path.join(appRoot, "src", "services", "tenant-provisioning"));

(async () => {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const stamp = Date.now();
    const result = await provisionTenant(client, {
      name: "Provisioning verification",
      slug: `verify-${stamp}`,
      adminName: "Verification Owner",
      adminEmail: `verify-${stamp}@example.invalid`,
      adminUsername: "verify-owner",
      adminPassword: "Verification-Password-2026",
      planCode: "pilot",
      trialDays: 14,
      enabledModules: ["assets", "work-orders", "inventory", "hr"],
    });
    if (!result.organization?.id || !result.owner?.id) throw new Error("Provisioning result incomplete");
    const permission = await client.query(
      `SELECT 1 FROM user_roles ur
       JOIN organization_role_permissions rp
         ON rp.organization_id=ur.organization_id AND rp.role_id=ur.role_id
       WHERE ur.organization_id=$1 AND ur.user_id=$2 AND rp.permission_code='builder.manage'`,
      [result.organization.id, result.owner.id]
    );
    if (!permission.rowCount) throw new Error("Provisioned owner is missing builder.manage");
    const build = await client.query("SELECT 1 FROM builder_builds WHERE organization_id=$1", [result.organization.id]);
    if (build.rowCount) throw new Error("New tenant must enter Builder before an applied build exists");
    await client.query("ROLLBACK");
    console.log("tenant-provisioning-builder-rollback=ok");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
