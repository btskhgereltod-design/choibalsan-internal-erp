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
    await client.query(`REVOKE UPDATE,DELETE,TRUNCATE ON audit_logs,platform_audit_logs,security_audit_events,platform_support_access_events,data_lifecycle_events,document_versions,document_lifecycle_events,integration_execution_events,document_links,data_quality_measurements,smart_import_events,data_quality_finding_events,work_order_events,work_order_approvals,workflow_transition_events,workflow_assignment_events,workflow_decision_events,workflow_comment_events,workflow_command_receipts,workflow_notification_outbox,workflow_notification_delivery_events,correspondence_events,correspondence_delivery_events,complaint_case_events,complaint_delivery_events,archive_events,archive_commission_decisions,archive_disposal_acts,domain_command_receipts,legacy_provenance_decisions,legacy_review_group_members,legacy_review_group_decisions,legacy_review_batch_commands,legacy_canonical_import_runs,legacy_canonical_import_mappings,legacy_canonical_import_events,ai_interview_answers,ai_recommendation_feedback,organization_evidence_sources,organization_evidence_findings,organization_capability_proposals,organization_capability_reviews,smart_import_dataset_sheets,smart_import_dataset_targets,smart_import_dataset_sheet_reviews,connector_connection_events,market_audit_events FROM ${role}`);
    await client.query(`REVOKE DELETE,TRUNCATE ON legacy_provenance_records,legacy_review_groups FROM ${role}`);
    await client.query(`REVOKE DELETE,TRUNCATE ON workflow_notification_delivery_state FROM ${role}`);
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
