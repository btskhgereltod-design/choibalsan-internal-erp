"use strict";

require("dotenv").config();
const { migrate } = require("./migrate");
const { getPool, closePool } = require("../src/db");

function quoteIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]{2,62}$/.test(value)) throw new Error("Invalid APP_DATABASE_USER");
  return `"${value.replaceAll('"', '""')}"`;
}

async function grantRuntimeRole() {
  const role = quoteIdentifier(String(process.env.APP_DATABASE_USER || ""));
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const database = quoteIdentifier((await client.query("SELECT current_database() AS name")).rows[0].name);
    await client.query(`GRANT CONNECT ON DATABASE ${database} TO ${role}`);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await client.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
    await client.query(`GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO ${role}`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO ${role}`);
    await client.query(`REVOKE UPDATE,DELETE,TRUNCATE ON audit_logs,platform_audit_logs,security_audit_events,data_lifecycle_events,document_versions,document_lifecycle_events,integration_execution_events,data_quality_measurements,smart_import_events,data_quality_finding_events,work_order_approvals,ai_interview_answers,ai_recommendation_feedback,organization_evidence_sources,organization_evidence_findings,organization_capability_proposals,organization_capability_reviews,smart_import_dataset_sheets,smart_import_dataset_targets,smart_import_dataset_sheet_reviews,connector_connection_events FROM ${role}`);
    await client.query(`REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON ai_knowledge_sources,ai_method_knowledge_units,ai_knowledge_unit_sources FROM ${role}`);
    await client.query("COMMIT");
    console.log(`[migration] runtime grants refreshed for ${process.env.APP_DATABASE_USER}`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  await migrate();
  await grantRuntimeRole();
  await closePool();
}

main().catch(error => {
  console.error("[production migration failed]", error);
  process.exitCode = 1;
});
