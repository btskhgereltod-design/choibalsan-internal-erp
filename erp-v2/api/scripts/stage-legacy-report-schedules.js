"use strict";

require("dotenv").config({ path: require("node:path").join(__dirname, "..", "..", ".env") });
const path = require("node:path");
const { Pool } = require("pg");

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function readLegacy(sqlite3, databasePath) {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(databasePath, sqlite3.OPEN_READONLY, error => {
      if (error) reject(error);
    });
    database.all(
      `SELECT id,name,frequency,next_due,responsible,recipient,warn_days,note,is_active,last_sent
         FROM report_schedules ORDER BY id`,
      (error, rows) => {
        database.close();
        if (error) reject(error); else resolve(rows);
      }
    );
  });
}

async function stage() {
  if (process.env.ALLOW_LEGACY_REPORT_SCHEDULE_DEMO_IMPORT !== "1") {
    throw new Error("ALLOW_LEGACY_REPORT_SCHEDULE_DEMO_IMPORT=1 is required");
  }
  if (process.env.NODE_ENV === "production") throw new Error("Production import is forbidden");
  const sqlite3 = require(required("LEGACY_SQLITE_MODULE_PATH"));
  const databasePath = path.resolve(required("LEGACY_DB_PATH"));
  const target = new URL(required("DATABASE_URL"));
  target.hostname = required("DEMO_DATABASE_HOST");
  target.port = required("DEMO_DATABASE_PORT");
  if (!["127.0.0.1", "localhost"].includes(target.hostname)) throw new Error("Loopback demo database required");
  if (!/^erp_v2[a-z0-9_]*$/i.test(target.pathname.slice(1))) throw new Error("Demo database name required");
  const organizationSlug = required("DEMO_ORGANIZATION_SLUG");
  const rows = await readLegacy(sqlite3, databasePath);
  if (!rows.length) throw new Error("Legacy report schedule source is empty");

  const frequency = new Map([
    ["Өдөр тутам", "daily"], ["7 хоног", "weekly"], ["Сар тутам", "monthly"],
    ["Улирал тутам", "quarterly"], ["Хагас жил", "semiannual"],
    ["Жил тутам", "annual"], ["Нэг удаа", "one_time"],
  ]);
  const pool = new Pool({ connectionString: target.toString() });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const organization = (await client.query(
      "SELECT id FROM organizations WHERE slug=$1", [organizationSlug]
    )).rows[0];
    if (!organization) throw new Error("Demo organization not found");
    await client.query("SELECT set_config('app.organization_id',$1,true)", [organization.id]);
    const existing = Number((await client.query(
      "SELECT count(*) AS count FROM report_schedules WHERE organization_id=$1", [organization.id]
    )).rows[0].count);
    if (existing !== 0) throw new Error("Demo report schedule target must be empty");
    const actor = (await client.query(
      `SELECT user_row.id FROM users user_row
         JOIN user_roles assignment ON assignment.organization_id=user_row.organization_id
          AND assignment.user_id=user_row.id
         JOIN organization_roles role ON role.organization_id=assignment.organization_id
          AND role.id=assignment.role_id
        WHERE user_row.organization_id=$1 AND role.code='owner' AND user_row.active=true
        ORDER BY user_row.created_at LIMIT 1`, [organization.id]
    )).rows[0];
    if (!actor) throw new Error("Demo owner not found");
    const users = (await client.query(
      "SELECT id,lower(trim(full_name)) AS key FROM users WHERE organization_id=$1 AND active=true",
      [organization.id]
    )).rows;
    const usersByName = new Map(users.map(user => [user.key, user.id]));

    for (const row of rows) {
      const mappedFrequency = frequency.get(String(row.frequency || "").trim());
      if (!mappedFrequency) throw new Error(`Unsupported legacy frequency: ${row.frequency}`);
      const responsible = String(row.responsible || "").trim();
      const responsibleUserId = usersByName.get(responsible.toLocaleLowerCase("mn-MN")) || null;
      const schedule = (await client.query(
        `INSERT INTO report_schedules(
           organization_id,name,frequency,next_due,responsible_user_id,responsible_label,
           recipient,warn_days,note,active,version,last_submitted_on,recurrence_anchor_day,created_by,updated_by
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,true,1,$10,extract(day FROM $4::date),$11,$11) RETURNING id`,
        [organization.id, String(row.name).trim(), mappedFrequency, row.next_due,
          responsibleUserId, responsible, String(row.recipient || "").trim(),
          Number(row.warn_days || 7), String(row.note || "").trim(), row.last_sent || null, actor.id]
      )).rows[0];
      await client.query(
        `INSERT INTO report_schedule_events(
           organization_id,report_schedule_id,event_type,to_version,due_on,next_due,actor_user_id,detail
         ) VALUES($1,$2,'created',1,$3,$3,$4,$5::jsonb)`,
        [organization.id, schedule.id, row.next_due, actor.id, JSON.stringify({
          source: "legacy_demo_import", sourceTable: "report_schedules", legacyId: row.id,
          legacyLastSent: row.last_sent || null,
          responsibilityMatch: responsibleUserId ? "exact_user_name" : "label_only",
        })]
      );
    }
    await client.query(
      `INSERT INTO audit_logs(organization_id,user_id,action,entity_type,entity_id,detail)
       VALUES($1::uuid,$2,'report_schedule.demo_import','report_schedule_import',$1::uuid::text,$3::jsonb)`,
      [organization.id, actor.id, JSON.stringify({ source: "legacy_read_only_snapshot", rowCount: rows.length })]
    );
    await client.query("COMMIT");
    console.log(`Imported demo report schedules: ${rows.length}`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  stage().catch(error => {
    console.error(`[legacy report schedule demo import] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { stage };
