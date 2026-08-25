"use strict";

const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const databasePath = path.resolve(__dirname, "../../data/app.db");
const db = new sqlite3.Database(databasePath, sqlite3.OPEN_READONLY);

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => (error ? reject(error) : resolve(rows)));
  });
}

async function main() {
  const people = await all(`
    SELECT u.id AS legacy_user_id,
           u.register_no,u.address,u.phone,u.hire_date,u.contract_type,u.contract_end,
           u.salary,u.status_hr,u.job_category,u.education,u.gender,u.birthdate,
           u.nationality,u.emergency_contact,u.contract_scan_url,u.avatar_url,
           u.skill_allowance_rate,u.skill_allowance,u.meal_allowance,u.tenure_years,
           u.tenure_allowance_rate,u.tenure_allowance,u.haot_exempt,u.work_condition,
           ep.family_status,ep.spouse_name,ep.children_count,ep.children_names,
           ep.home_address,ep.diploma,ep.professional_cert,ep.id_card_no,
           ep.job_description,ep.contract_no,ep.contract_date,ep.contract_notes
      FROM users u
      LEFT JOIN employee_profiles ep ON ep.user_id=u.id
     WHERE u.active=1 AND COALESCE(u.role,'')<>'ai_readonly'
     ORDER BY u.id
  `);

  // The legacy attendance UI resolves duplicate employee/day entries by taking
  // the row with the greatest id. Export exactly the same effective record.
  const attendance = await all(`
    SELECT r.id AS legacy_record_id,r.user_id AS legacy_user_id,
           r.record_type,r.start_date,r.end_date,r.work_hours,r.leave_hours,
           r.overtime_hours,r.note,r.created_at
      FROM hr_records r
      JOIN users u ON u.id=r.user_id
     WHERE u.active=1
       AND COALESCE(u.role,'')<>'ai_readonly'
       AND r.id=(
         SELECT MAX(r2.id)
           FROM hr_records r2
          WHERE r2.user_id=r.user_id AND r2.start_date=r.start_date
       )
     ORDER BY r.user_id,r.start_date
  `);

  const json = JSON.stringify({
    source: "overva-legacy-hr-import-v1",
    exported_at: new Date().toISOString(),
    people,
    attendance,
  });
  process.stdout.write(process.argv.includes("--base64") ? Buffer.from(json, "utf8").toString("base64") : `${json}\n`);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => db.close());
