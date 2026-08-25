"use strict";

const path = require("node:path");
const sqlite3 = require(path.resolve(__dirname, "../../node_modules/sqlite3")).verbose();
const databasePath = process.env.LEGACY_DB_PATH || path.resolve(__dirname, "../../data/app.db");
const db = new sqlite3.Database(databasePath, sqlite3.OPEN_READONLY);

const sql = `SELECT id, username, password_hash, full_name, role, position, register_no,
  address, phone, department, email, hire_date, contract_type, contract_end, salary,
  status_hr, job_category, education, gender, birthdate, nationality, emergency_contact,
  contract_scan_url, avatar_url, skill_allowance_rate, skill_allowance, meal_allowance,
  tenure_years, tenure_allowance_rate, tenure_allowance, can_login, haot_exempt,
  work_condition, created_at
FROM users
WHERE active=1 AND role <> 'ai_readonly'
ORDER BY id`;

db.all(sql, (error, rows) => {
  if (error) {
    console.error(error.message);
    process.exitCode = 1;
  } else {
    const payload = JSON.stringify({ source: "overva-legacy-employee-import-v1", employees: rows });
    process.stdout.write(process.argv.includes("--base64") ? Buffer.from(payload, "utf8").toString("base64") : payload);
  }
  db.close();
});
