"use strict";

const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const { getPool } = require("../src/db");

async function main() {
  const email = String(process.env.RESET_PLATFORM_EMAIL || "").trim().toLowerCase();
  const generateTemporary = process.env.GENERATE_TEMPORARY_PASSWORD === "1";
  const password = generateTemporary
    ? `${crypto.randomBytes(15).toString("base64url")}!Aa7`
    : String(process.env.RESET_PLATFORM_PASSWORD || "");

  if (!email || password.length < 12) {
    throw new Error("RESET_PLATFORM_EMAIL and a 12+ character password are required");
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE platform_admins
          SET password_hash=$1, updated_at=now()
        WHERE lower(email)=lower($2) AND active=true
        RETURNING id,email`,
      [passwordHash, email]
    );
    if (result.rowCount !== 1) throw new Error(`Expected one active platform admin, updated ${result.rowCount}`);
    const admin = result.rows[0];
    await client.query(
      `INSERT INTO platform_audit_logs(platform_admin_id,action,entity_type,entity_id,detail)
       VALUES($1::uuid,'platform.admin.password.reset','platform_admin',$1::text,$2::jsonb)`,
      [admin.id, JSON.stringify({ temporary: generateTemporary })]
    );
    await client.query(
      `INSERT INTO security_audit_events(actor_type,actor_id,action,outcome,detail)
       VALUES('platform_admin',$1::uuid,'platform.admin.password.reset','success',$2::jsonb)`,
      [admin.id, JSON.stringify({ temporary: generateTemporary })]
    );
    await client.query("COMMIT");
    console.log(`Platform password reset completed for ${admin.email}.`);
    if (generateTemporary) console.log(`TEMPORARY_PASSWORD=${password}`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => getPool().end());
