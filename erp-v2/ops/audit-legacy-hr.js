const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const databasePath = path.resolve(__dirname, "../../data/app.db");
const db = new sqlite3.Database(databasePath, sqlite3.OPEN_READONLY);

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => (error ? reject(error) : resolve(rows)));
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => (error ? reject(error) : resolve(row)));
  });
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function main() {
  const tables = await all(
    `SELECT name
       FROM sqlite_master
      WHERE type = 'table'
        AND (
          name LIKE '%user%'
          OR name LIKE '%employee%'
          OR name LIKE '%hr%'
          OR name LIKE '%attendance%'
          OR name LIKE '%award%'
        )
      ORDER BY name`,
  );

  const report = { database: databasePath, tables: {} };
  for (const { name } of tables) {
    const columns = await all(`PRAGMA table_info(${quoteIdentifier(name)})`);
    const count = await get(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(name)}`);
    report.tables[name] = {
      rows: count.count,
      columns: columns.map((column) => column.name),
    };
  }

  const userColumns = new Set(report.tables.users?.columns || []);
  if (userColumns.size) {
    const activePredicate = userColumns.has("is_active")
      ? "COALESCE(is_active, 1) = 1"
      : userColumns.has("active")
        ? "COALESCE(active, 1) = 1"
        : "1 = 1";
    const exclusions = [];
    if (userColumns.has("username")) exclusions.push("COALESCE(username, '') <> 'ai_readonly'");
    if (userColumns.has("role")) exclusions.push("COALESCE(role, '') <> 'ai_readonly'");
    const excludedPredicate = exclusions.length ? exclusions.join(" AND ") : "1 = 1";
    const summaryExpressions = ["COUNT(*) AS total"];
    for (const column of [
      "username",
      "full_name",
      "email",
      "register_no",
      "phone",
      "department",
      "position",
      "hire_date",
      "contract_type",
      "contract_end",
    ]) {
      if (userColumns.has(column)) {
        summaryExpressions.push(
          `SUM(CASE WHEN NULLIF(TRIM(COALESCE(${quoteIdentifier(column)}, '')), '') IS NOT NULL THEN 1 ELSE 0 END) AS ${quoteIdentifier(`${column}_filled`)}`,
        );
      }
    }
    report.activeEmployees = await get(
      `SELECT ${summaryExpressions.join(", ")}
         FROM users
        WHERE ${activePredicate} AND ${excludedPredicate}`,
    );

    report.duplicates = {};
    for (const column of ["username", "email", "register_no"]) {
      if (userColumns.has(column)) {
        const duplicate = await get(
          `SELECT COUNT(*) AS groups
             FROM (
               SELECT LOWER(TRIM(${quoteIdentifier(column)})) AS value
                 FROM users
                WHERE ${activePredicate}
                  AND ${excludedPredicate}
                  AND NULLIF(TRIM(COALESCE(${quoteIdentifier(column)}, '')), '') IS NOT NULL
                GROUP BY LOWER(TRIM(${quoteIdentifier(column)}))
               HAVING COUNT(*) > 1
             ) duplicates`,
        );
        report.duplicates[column] = duplicate.groups;
      }
    }

    report.userStateCounts = {};
    for (const column of ["active", "status_hr", "can_login", "role"]) {
      if (userColumns.has(column)) {
        report.userStateCounts[column] = await all(
          `SELECT COALESCE(CAST(${quoteIdentifier(column)} AS TEXT), '(null)') AS value, COUNT(*) AS count
             FROM users
            WHERE ${excludedPredicate}
            GROUP BY ${quoteIdentifier(column)}
            ORDER BY count DESC, value`,
        );
      }
    }
  }

  if (report.tables.hr_records) {
    report.hrRecordTypes = await all(
      `SELECT COALESCE(record_type, '(empty)') AS type, COUNT(*) AS count
         FROM hr_records
        GROUP BY COALESCE(record_type, '(empty)')
        ORDER BY count DESC, type`,
    );
    report.hrRecords = await get(
      `SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE u.id IS NULL) AS orphaned,
              COUNT(*) FILTER (WHERE COALESCE(u.active, 0) <> 1 OR COALESCE(u.role, '') = 'ai_readonly') AS inactive_or_system,
              COUNT(*) FILTER (WHERE COALESCE(u.active, 0) = 1 AND COALESCE(u.role, '') <> 'ai_readonly') AS active_employees,
              MIN(r.start_date) AS first_date,
              MAX(COALESCE(r.end_date, r.start_date)) AS last_date,
              COUNT(*) FILTER (WHERE r.end_date IS NOT NULL AND r.end_date <> r.start_date) AS date_ranges
         FROM hr_records r
         LEFT JOIN users u ON u.id = r.user_id`,
    );
    report.hrDuplicateEmployeeDates = (
      await get(
        `SELECT COUNT(*) AS groups
           FROM (
             SELECT r.user_id, r.start_date
               FROM hr_records r
               JOIN users u ON u.id = r.user_id
              WHERE COALESCE(u.active, 0) = 1
                AND COALESCE(u.role, '') <> 'ai_readonly'
              GROUP BY r.user_id, r.start_date
             HAVING COUNT(*) > 1
           ) duplicates`,
      )
    ).groups;
    report.hrRecordCombinations = await all(
      `SELECT types, COUNT(*) AS count
         FROM (
           SELECT r.user_id, r.start_date,
                  GROUP_CONCAT(r.record_type, ' + ') AS types
             FROM hr_records r
             JOIN users u ON u.id = r.user_id
            WHERE COALESCE(u.active, 0) = 1
              AND COALESCE(u.role, '') <> 'ai_readonly'
            GROUP BY r.user_id, r.start_date
           HAVING COUNT(*) > 1
         ) grouped
        GROUP BY types
        ORDER BY count DESC, types
        LIMIT 20`,
    );
    report.hrGroupedLimits = await get(
      `SELECT COUNT(*) AS employee_days,
              MAX(work_hours) AS max_work_hours,
              MAX(leave_hours) AS max_leave_hours,
              MAX(overtime_hours) AS max_overtime_hours,
              MAX(work_hours + leave_hours) AS max_regular_hours
         FROM (
           SELECT r.user_id, r.start_date,
                  MAX(COALESCE(r.work_hours, 0)) AS work_hours,
                  MAX(COALESCE(r.leave_hours, 0)) AS leave_hours,
                  SUM(COALESCE(r.overtime_hours, 0)) AS overtime_hours
             FROM hr_records r
             JOIN users u ON u.id = r.user_id
            WHERE COALESCE(u.active, 0) = 1
              AND COALESCE(u.role, '') <> 'ai_readonly'
            GROUP BY r.user_id, r.start_date
         ) grouped`,
    );
  }

  if (report.tables.employee_profiles) {
    const profileColumns = new Set(report.tables.employee_profiles.columns);
    const profileExpressions = ["COUNT(*) AS total"];
    for (const column of [
      "family_status",
      "spouse_name",
      "children_names",
      "home_address",
      "diploma",
      "professional_cert",
      "id_card_no",
      "job_description",
      "contract_no",
      "contract_date",
      "contract_notes",
    ]) {
      if (profileColumns.has(column)) {
        profileExpressions.push(
          `SUM(CASE WHEN NULLIF(TRIM(COALESCE(${quoteIdentifier(column)}, '')), '') IS NOT NULL THEN 1 ELSE 0 END) AS ${quoteIdentifier(`${column}_filled`)}`,
        );
      }
    }
    report.extendedProfiles = await get(
      `SELECT ${profileExpressions.join(", ")} FROM employee_profiles`,
    );
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => db.close());
