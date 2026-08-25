"use strict";

require("dotenv").config();
const { getPool, closePool } = require("../src/db");

async function scalar(sql, params = []) {
  const result = await getPool().query(sql, params);
  return Number(result.rows[0]?.count || 0);
}

async function main() {
  const organization = await getPool().query(
    "SELECT id,slug FROM organizations WHERE slug=$1",
    [process.argv[2] || "choibalsan-hugjil"]
  );
  if (!organization.rowCount) throw new Error("Organization not found");
  const organizationId = organization.rows[0].id;
  const removedWorkOrderId = process.argv[3] || "d58572a4-1162-49f5-af03-2236cf99e997";
  const checks = {
    organization: organization.rows[0].slug,
    operationalObjects: await scalar("SELECT count(*) FROM operational_objects WHERE organization_id=$1", [organizationId]),
    reclassifiedLegacyAssets: await scalar("SELECT count(*) FROM assets WHERE organization_id=$1 AND metadata @> $2::jsonb", [organizationId, JSON.stringify({ excludedFromAssetMaster: true })]),
    workOrders: await scalar("SELECT count(*) FROM work_orders WHERE organization_id=$1", [organizationId]),
    removedTrialWorkRemaining: await scalar("SELECT count(*) FROM work_orders WHERE organization_id=$1 AND id=$2", [organizationId, removedWorkOrderId]),
    removedTrialAuditPreserved: await scalar("SELECT count(*) FROM audit_logs WHERE organization_id=$1 AND entity_id=$2", [organizationId, removedWorkOrderId]),
  };
  if (checks.removedTrialWorkRemaining !== 0) throw new Error("Trial work order still exists");
  if (checks.removedTrialAuditPreserved < 1) throw new Error("Trial deletion audit is missing");
  if (checks.operationalObjects < 1) throw new Error("Operational objects were not migrated");
  process.stdout.write(`${JSON.stringify(checks, null, 2)}\n`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(closePool);
