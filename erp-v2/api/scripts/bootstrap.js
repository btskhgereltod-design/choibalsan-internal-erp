"use strict";

require("dotenv").config();
const bcrypt = require("bcryptjs");
const { z } = require("zod");
const { getPool, closePool } = require("../src/db");

const schema = z.object({
  BOOTSTRAP_ORG_NAME: z.string().min(2),
  BOOTSTRAP_ORG_SLUG: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  BOOTSTRAP_ADMIN_NAME: z.string().min(2),
  BOOTSTRAP_ADMIN_EMAIL: z.string().email(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(12),
});

const platformSchema = z.object({
  BOOTSTRAP_PLATFORM_ADMIN_NAME: z.string().min(2),
  BOOTSTRAP_PLATFORM_ADMIN_EMAIL: z.string().email(),
  BOOTSTRAP_PLATFORM_ADMIN_PASSWORD: z.string().min(12),
});

async function bootstrap() {
  const parsed = schema.safeParse(process.env);
  const pool = getPool();
  if (parsed.success) {
    const values = parsed.data;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query("SELECT id FROM organizations WHERE slug = $1", [values.BOOTSTRAP_ORG_SLUG]);
      if (!existing.rowCount) {
        const organization = await client.query(
          "INSERT INTO organizations(slug, name) VALUES ($1, $2) RETURNING id",
          [values.BOOTSTRAP_ORG_SLUG, values.BOOTSTRAP_ORG_NAME]
        );
        const organizationId = organization.rows[0].id;
        const passwordHash = await bcrypt.hash(values.BOOTSTRAP_ADMIN_PASSWORD, 12);
        const user = await client.query(
          `INSERT INTO users(organization_id, email, username, password_hash, full_name, role)
           VALUES ($1, lower($2), 'admin', $3, $4, 'director') RETURNING id`,
          [organizationId, values.BOOTSTRAP_ADMIN_EMAIL, passwordHash, values.BOOTSTRAP_ADMIN_NAME]
        );
        await client.query("INSERT INTO subscriptions(organization_id,plan_code,status) VALUES ($1,'pilot','trial')", [organizationId]);
        await client.query(
          `INSERT INTO audit_logs(organization_id,user_id,action,entity_type,entity_id,detail)
           VALUES ($1::uuid,$2::uuid,'organization.bootstrap','organization',$1::uuid::text,'{"source":"bootstrap"}'::jsonb)`,
          [organizationId, user.rows[0].id]
        );
        console.log(`[bootstrap] created organization ${values.BOOTSTRAP_ORG_SLUG} and admin user`);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } else {
    console.log("[bootstrap] optional tenant bootstrap values are incomplete; skipped");
  }

  const platform = platformSchema.safeParse(process.env);
  if (platform.success) {
    const values = platform.data;
    const passwordHash = await bcrypt.hash(values.BOOTSTRAP_PLATFORM_ADMIN_PASSWORD, 12);
    const result = await pool.query(
      `INSERT INTO platform_admins(email,password_hash,full_name)
       VALUES (lower($1),$2,$3) ON CONFLICT (email) DO NOTHING RETURNING id`,
      [values.BOOTSTRAP_PLATFORM_ADMIN_EMAIL, passwordHash, values.BOOTSTRAP_PLATFORM_ADMIN_NAME]
    );
    if (result.rowCount) console.log(`[bootstrap] created platform administrator ${values.BOOTSTRAP_PLATFORM_ADMIN_EMAIL}`);
  } else {
    console.log("[bootstrap] optional platform bootstrap values are incomplete; skipped");
  }
}

if (require.main === module) {
  bootstrap().then(closePool).catch(error => {
    console.error("[bootstrap failed]", error);
    process.exitCode = 1;
  });
}

module.exports = { bootstrap };
