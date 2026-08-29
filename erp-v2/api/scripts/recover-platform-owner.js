"use strict";

require("dotenv").config();
const { z } = require("zod");
const { getPool, closePool } = require("../src/db");

const inputSchema = z.object({
  BREAK_GLASS_CONFIRM: z.literal("RECOVER_PLATFORM_OWNER"),
  BREAK_GLASS_TARGET_EMAIL: z.string().trim().toLowerCase().email(),
  BREAK_GLASS_REASON: z.string().trim().min(20).max(1000),
});

async function main() {
  const parsed = inputSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error("BREAK_GLASS_CONFIRM, BREAK_GLASS_TARGET_EMAIL, and a 20+ character BREAK_GLASS_REASON are required");
  }
  if (process.env.NODE_ENV !== "production") throw new Error("Break-glass recovery is production-only");
  const value = parsed.data;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const admin = await client.query(
      "SELECT id,email,active FROM platform_admins WHERE lower(email)=lower($1) FOR UPDATE",
      [value.BREAK_GLASS_TARGET_EMAIL]
    );
    if (!admin.rowCount) throw new Error("Target Platform administrator does not exist");
    const adminId = admin.rows[0].id;
    await client.query("UPDATE platform_admins SET active=true,updated_at=now() WHERE id=$1", [adminId]);
    await client.query(
      `INSERT INTO platform_admin_role_assignments(platform_admin_id,role_id,assigned_by)
       SELECT $1,role.id,$1 FROM platform_admin_roles role WHERE role.code IN('platform-owner','founder-operator')
       ON CONFLICT(platform_admin_id,role_id) WHERE revoked_at IS NULL DO NOTHING`,
      [adminId]
    );
    await client.query(
      `INSERT INTO platform_audit_logs(platform_admin_id,action,entity_type,entity_id,detail)
       VALUES($1::uuid,'platform.break_glass.owner_recovered','platform_admin',$1::uuid::text,$2::jsonb)`,
      [adminId, JSON.stringify({ reason: value.BREAK_GLASS_REASON, source: "offline-recovery-script" })]
    );
    await client.query(
      `INSERT INTO security_audit_events(actor_type,actor_id,action,outcome,detail)
       VALUES('platform_admin',$1,'platform.break_glass.owner_recovered','success',$2::jsonb)`,
      [adminId, JSON.stringify({ reason: value.BREAK_GLASS_REASON, source: "offline-recovery-script" })]
    );
    await client.query("COMMIT");
    console.log("[break-glass] Platform owner access recovered and audited");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await closePool();
  }
}

main().catch(error => {
  console.error("[break-glass failed]", error.message);
  process.exitCode = 1;
});
