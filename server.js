const express = require("express");
const cors    = require("cors");
const bcrypt  = require("bcryptjs");
const jwt     = require("jsonwebtoken");
const crypto  = require("crypto");
const fs      = require("fs");
const path    = require("path");
const os      = require("os");

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvFile();

const APP_PORT   = process.env.PORT       || 4000;
const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_THIS_SECRET_2026_CHOIBALSAN";
const UPLOAD_DIR = path.join(__dirname, "uploads");
const APP_URL    = process.env.APP_URL    || `http://localhost:${APP_PORT}`;
const EMAIL_FROM = process.env.EMAIL_FROM || '"Чойбалсан хөгжил ERP" <choibalsankhugjil@gmail.com>';
const ASSISTANT_LOG_RETENTION_DAYS = Math.max(7, Number(process.env.ASSISTANT_LOG_RETENTION_DAYS || 180));

fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// db.js opens the SQLite connection — require after directories exist
const { run, all, get } = require("./db");

// ── Email / SMTP setup (optional — configure via .env) ───────
let _nm = null; try { _nm = require("nodemailer"); } catch(e) {}
const mailer = (_nm && process.env.SMTP_HOST && process.env.SMTP_USER)
  ? _nm.createTransport({
      host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_PORT === "465",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    })
  : null;

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use("/uploads", express.static(UPLOAD_DIR, {
  setHeaders: (res) => {
    res.setHeader("Content-Disposition", "inline");
  }
}));
app.use(express.static(path.join(__dirname, "public")));

function lanBaseUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, "");
  const nets = os.networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const net of list || []) {
      if (net.family === "IPv4" && !net.internal) {
        return `http://${net.address}:${APP_PORT}`;
      }
    }
  }
  return APP_URL.replace(/\/+$/, "");
}

async function initDb() {
  // ── Legacy renames ────────────────────────────────────────
  await run(`ALTER TABLE work_logs  RENAME TO asset_events`).catch(() => {});
  await run(`ALTER TABLE materials  RENAME TO warehouse_items`).catch(() => {});
  // Rename old correspondence-style documents table to free the name
  await run(`ALTER TABLE documents  RENAME TO correspondence`).catch(() => {});

  // ── Users ─────────────────────────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name     TEXT NOT NULL,
    role          TEXT NOT NULL,
    position      TEXT,
    register_no   TEXT,
    address       TEXT,
    phone         TEXT,
    department    TEXT,
    email         TEXT,
    active        INTEGER DEFAULT 1,
    created_at    TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`ALTER TABLE users ADD COLUMN register_no        TEXT`).catch(() => {});
  await run(`ALTER TABLE users ADD COLUMN address            TEXT`).catch(() => {});
  await run(`ALTER TABLE users ADD COLUMN email              TEXT`).catch(() => {});
  await run(`ALTER TABLE users ADD COLUMN hire_date          TEXT`).catch(() => {});
  await run(`ALTER TABLE users ADD COLUMN contract_type      TEXT DEFAULT 'Байнгын'`).catch(() => {});
  await run(`ALTER TABLE users ADD COLUMN contract_end       TEXT`).catch(() => {});
  await run(`ALTER TABLE users ADD COLUMN salary             REAL DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE users ADD COLUMN skill_allowance_rate REAL DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE users ADD COLUMN skill_allowance    REAL DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE users ADD COLUMN tenure_years       REAL DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE users ADD COLUMN tenure_allowance_rate REAL DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE users ADD COLUMN tenure_allowance   REAL DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE users ADD COLUMN meal_allowance     REAL DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE users ADD COLUMN status_hr          TEXT DEFAULT 'Идэвхтэй'`).catch(() => {});
  await run(`ALTER TABLE users ADD COLUMN job_category       TEXT DEFAULT 'Захиргааны ажилтан'`).catch(() => {});
  await run(`ALTER TABLE users ADD COLUMN education          TEXT`).catch(() => {});
  await run(`ALTER TABLE users ADD COLUMN gender             TEXT`).catch(() => {});
  await run(`ALTER TABLE users ADD COLUMN birthdate          TEXT`).catch(() => {});
  await run(`ALTER TABLE users ADD COLUMN nationality        TEXT DEFAULT 'Монгол'`).catch(() => {});
  await run(`ALTER TABLE users ADD COLUMN emergency_contact  TEXT`).catch(() => {});
  await run(`ALTER TABLE users ADD COLUMN permissions        TEXT`).catch(() => {});
  await run(`ALTER TABLE users ADD COLUMN can_login          INTEGER DEFAULT 1`).catch(() => {});

  await run(`CREATE TABLE IF NOT EXISTS hr_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    event_type  TEXT NOT NULL,
    event_date  TEXT NOT NULL,
    note        TEXT,
    created_by  INTEGER NOT NULL,
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id)    REFERENCES users(id),
    FOREIGN KEY(created_by) REFERENCES users(id)
  )`).catch(() => {});

  // ── Password reset tokens ─────────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL UNIQUE,
    token      TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // ── Asset events ──────────────────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS asset_events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    title         TEXT NOT NULL,
    category      TEXT NOT NULL,
    department    TEXT,
    location      TEXT,
    description   TEXT,
    status        TEXT DEFAULT 'Явцтай',
    progress      INTEGER DEFAULT 0,
    assigned_to   INTEGER,
    created_by    INTEGER NOT NULL,
    work_date     TEXT NOT NULL,
    start_date    TEXT,
    end_date      TEXT,
    start_time    TEXT,
    end_time      TEXT,
    cost_amount   REAL DEFAULT 0,
    material_note TEXT,
    asset_id      INTEGER,
    asset_code    TEXT,
    created_at    TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at    TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(created_by)  REFERENCES users(id),
    FOREIGN KEY(assigned_to) REFERENCES users(id)
  )`);
  await run(`ALTER TABLE asset_events ADD COLUMN start_date      TEXT`).catch(() => {});
  await run(`ALTER TABLE asset_events ADD COLUMN end_date        TEXT`).catch(() => {});
  await run(`ALTER TABLE asset_events ADD COLUMN asset_id        INTEGER`).catch(() => {});
  await run(`ALTER TABLE asset_events ADD COLUMN asset_code      TEXT`).catch(() => {});
  await run(`ALTER TABLE asset_events ADD COLUMN confirm_status     TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE asset_events ADD COLUMN confirmed_by       INTEGER`).catch(() => {});
  await run(`ALTER TABLE asset_events ADD COLUMN confirmed_at       TEXT`).catch(() => {});
  await run(`ALTER TABLE asset_events ADD COLUMN reject_note        TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE asset_events ADD COLUMN confirm_note       TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE asset_events ADD COLUMN confirm_image_url  TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE asset_events ADD COLUMN habea_pre_status   TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE asset_events ADD COLUMN habea_pre_by       INTEGER`).catch(() => {});
  await run(`ALTER TABLE asset_events ADD COLUMN habea_pre_at       TEXT`).catch(() => {});
  await run(`ALTER TABLE asset_events ADD COLUMN habea_pre_note     TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE asset_events ADD COLUMN habea_pre_risks    TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE asset_events ADD COLUMN habea_pre_measures TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE asset_events ADD COLUMN habea_post_status  TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE asset_events ADD COLUMN habea_post_by      INTEGER`).catch(() => {});
  await run(`ALTER TABLE asset_events ADD COLUMN habea_post_at      TEXT`).catch(() => {});
  await run(`ALTER TABLE asset_events ADD COLUMN habea_post_note    TEXT DEFAULT ''`).catch(() => {});

  await run(`CREATE TABLE IF NOT EXISTS work_executions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    work_log_id INTEGER NOT NULL,
    title       TEXT NOT NULL,
    start_date  TEXT NOT NULL,
    end_date    TEXT NOT NULL,
    status      TEXT DEFAULT 'Явцтай',
    progress    INTEGER DEFAULT 0,
    note        TEXT,
    workers     TEXT,
    safety_note TEXT,
    created_by  INTEGER NOT NULL,
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(work_log_id) REFERENCES asset_events(id),
    FOREIGN KEY(created_by)  REFERENCES users(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS execution_photos (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    execution_id INTEGER NOT NULL,
    file_path    TEXT NOT NULL,
    stamp_text   TEXT,
    uploaded_by  INTEGER NOT NULL,
    uploaded_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(execution_id) REFERENCES work_executions(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS work_photos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    work_log_id INTEGER NOT NULL,
    file_path   TEXT NOT NULL,
    stamp_text  TEXT,
    uploaded_by INTEGER NOT NULL,
    uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(work_log_id) REFERENCES asset_events(id)
  )`);

  // ── Warehouse ─────────────────────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS warehouse_items (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    item_name     TEXT NOT NULL,
    unit          TEXT,
    balance       REAL DEFAULT 0,
    warning_level REAL DEFAULT 5,
    price         REAL DEFAULT 0,
    note          TEXT,
    created_by    INTEGER,
    created_at    TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`ALTER TABLE warehouse_items ADD COLUMN balance       REAL DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE warehouse_items ADD COLUMN warning_level REAL DEFAULT 5`).catch(() => {});
  await run(`ALTER TABLE warehouse_items ADD COLUMN price         REAL DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE warehouse_items ADD COLUMN barcode       TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE fixed_assets_ledger ADD COLUMN account_code      TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE fixed_assets_ledger ADD COLUMN asset_code_manual TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE fixed_assets_ledger ADD COLUMN asset_model       TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE fixed_assets_ledger ADD COLUMN unit              TEXT DEFAULT 'ш'`).catch(() => {});
  await run(`ALTER TABLE fixed_assets_ledger ADD COLUMN unit_value        REAL DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE fixed_assets_ledger ADD COLUMN initial_qty       REAL DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE fixed_assets_ledger ADD COLUMN intake_qty        REAL DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE fixed_assets_ledger ADD COLUMN intake_amount     REAL DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE fixed_assets_ledger ADD COLUMN issue_qty_fa      REAL DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE fixed_assets_ledger ADD COLUMN issue_amount_fa   REAL DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE fixed_assets_ledger ADD COLUMN improve_income    REAL DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE fixed_assets_ledger ADD COLUMN improve_expense   REAL DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE fixed_assets_ledger ADD COLUMN final_qty         REAL DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE fixed_assets_ledger ADD COLUMN final_amount      REAL DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE fixed_assets_ledger ADD COLUMN reval_opening     REAL DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE fixed_assets_ledger ADD COLUMN reval_disposed    REAL DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE fixed_assets_ledger ADD COLUMN reval_diff        REAL DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE fixed_assets_ledger ADD COLUMN depr_year_opening REAL DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE fixed_assets_ledger ADD COLUMN depr_opening      REAL DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE fixed_assets_ledger ADD COLUMN depr_disposed     REAL DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE fixed_assets_ledger ADD COLUMN depr_m1  REAL DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE fixed_assets_ledger ADD COLUMN depr_m2  REAL DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE fixed_assets_ledger ADD COLUMN depr_m3  REAL DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE fixed_assets_ledger ADD COLUMN depr_m4  REAL DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE fixed_assets_ledger ADD COLUMN depr_m5  REAL DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE fixed_assets_ledger ADD COLUMN depr_m6  REAL DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE fixed_assets_ledger ADD COLUMN depr_m7  REAL DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE fixed_assets_ledger ADD COLUMN depr_m8  REAL DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE fixed_assets_ledger ADD COLUMN depr_m9  REAL DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE fixed_assets_ledger ADD COLUMN depr_m10 REAL DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE fixed_assets_ledger ADD COLUMN depr_m11 REAL DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE fixed_assets_ledger ADD COLUMN depr_m12 REAL DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE fixed_assets_ledger ADD COLUMN depr_total_added  REAL DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE fixed_assets_ledger ADD COLUMN depr_deducted     REAL DEFAULT 0`).catch(() => {});

  await run(`CREATE TABLE IF NOT EXISTS material_moves (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    move_type       TEXT NOT NULL,
    item_name       TEXT NOT NULL,
    qty             REAL NOT NULL,
    unit            TEXT,
    unit_price      REAL DEFAULT 0,
    related_work_id INTEGER,
    receiver        TEXT,
    note            TEXT,
    created_by      INTEGER NOT NULL,
    move_date       TEXT NOT NULL,
    created_at      TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS expenses (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    expense_date    TEXT NOT NULL,
    type            TEXT NOT NULL,
    amount          REAL NOT NULL,
    related_work_id INTEGER,
    note            TEXT,
    created_by      INTEGER NOT NULL,
    created_at      TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS hr_records (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    record_type TEXT NOT NULL,
    start_date  TEXT NOT NULL,
    end_date    TEXT,
    note        TEXT,
    created_by  INTEGER NOT NULL,
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  // ── Correspondence (old letters/complaints, renamed from documents) ──
  await run(`CREATE TABLE IF NOT EXISTS correspondence (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_type    TEXT NOT NULL,
    doc_no      TEXT,
    doc_date    TEXT NOT NULL,
    source_org  TEXT,
    subject     TEXT NOT NULL,
    assigned_to INTEGER,
    due_date    TEXT,
    status      TEXT DEFAULT 'Шинэ',
    decision    TEXT,
    created_by  INTEGER NOT NULL,
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  // ── Compliance documents (licenses, permits, certificates) ──
  await run(`CREATE TABLE IF NOT EXISTS documents (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_type           TEXT NOT NULL,
    title              TEXT NOT NULL,
    description        TEXT,
    issued_by          TEXT,
    issued_date        TEXT,
    valid_from         TEXT,
    valid_until        TEXT,
    notify_days_before INTEGER DEFAULT 30,
    file_path          TEXT,
    status             TEXT DEFAULT 'Хүчинтэй',
    created_by         INTEGER,
    created_at         TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS safety_reports (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    report_date      TEXT NOT NULL,
    title            TEXT NOT NULL,
    risk_level       TEXT NOT NULL,
    location         TEXT,
    risk_description TEXT,
    action_taken     TEXT,
    status           TEXT DEFAULT 'Нээлттэй',
    created_by       INTEGER NOT NULL,
    created_at       TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`ALTER TABLE safety_reports ADD COLUMN risk_type            TEXT`).catch(() => {});
  await run(`ALTER TABLE safety_reports ADD COLUMN ppe_checklist        TEXT`).catch(() => {});
  await run(`ALTER TABLE safety_reports ADD COLUMN pre_work_note        TEXT`).catch(() => {});
  await run(`ALTER TABLE safety_reports ADD COLUMN assigned_to          INTEGER`).catch(() => {});
  await run(`ALTER TABLE safety_reports ADD COLUMN image_url            TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE safety_reports ADD COLUMN risk_time            TEXT`).catch(() => {});
  await run(`ALTER TABLE safety_reports ADD COLUMN risk_condition       TEXT`).catch(() => {});
  await run(`ALTER TABLE safety_reports ADD COLUMN possible_consequence TEXT`).catch(() => {});
  await run(`ALTER TABLE safety_reports ADD COLUMN probability          INTEGER DEFAULT 1`).catch(() => {});
  await run(`ALTER TABLE safety_reports ADD COLUMN consequence_score    INTEGER DEFAULT 1`).catch(() => {});
  await run(`ALTER TABLE safety_reports ADD COLUMN risk_score           INTEGER DEFAULT 1`).catch(() => {});
  await run(`ALTER TABLE safety_reports ADD COLUMN workflow_status      TEXT DEFAULT 'Шинэ'`).catch(() => {});
  await run(`ALTER TABLE safety_reports ADD COLUMN deadline             TEXT`).catch(() => {});
  await run(`ALTER TABLE safety_reports ADD COLUMN action_note          TEXT`).catch(() => {});
  await run(`ALTER TABLE safety_reports ADD COLUMN gps_lat              REAL`).catch(() => {});
  await run(`ALTER TABLE safety_reports ADD COLUMN gps_lng              REAL`).catch(() => {});
  await run(`ALTER TABLE safety_reports ADD COLUMN acknowledged_by      INTEGER`).catch(() => {});
  await run(`ALTER TABLE safety_reports ADD COLUMN acknowledged_at      TEXT`).catch(() => {});
  await run(`ALTER TABLE safety_reports ADD COLUMN priority             TEXT DEFAULT 'Дунд'`).catch(() => {});
  await run(`ALTER TABLE safety_reports ADD COLUMN action_plan          TEXT`).catch(() => {});
  await run(`ALTER TABLE safety_reports ADD COLUMN before_image_url     TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE safety_reports ADD COLUMN after_image_url      TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE safety_reports ADD COLUMN work_log_id          INTEGER`).catch(() => {});
  await run(`ALTER TABLE safety_reports ADD COLUMN location_ref_type    TEXT`).catch(() => {});
  await run(`ALTER TABLE safety_reports ADD COLUMN location_ref_id      INTEGER`).catch(() => {});

  await run(`CREATE TABLE IF NOT EXISTS safety_comments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id  INTEGER NOT NULL,
    user_id    INTEGER NOT NULL,
    comment    TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`).catch(() => {});

  // ── Vehicles & Maintenance ─────────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plate_no TEXT NOT NULL,
    vehicle_type TEXT NOT NULL,
    brand TEXT DEFAULT '',
    model TEXT DEFAULT '',
    manufacture_year INTEGER DEFAULT 0,
    status TEXT DEFAULT 'Ажилд',
    driver_id INTEGER,
    last_daily_insp TEXT,
    last_monthly_insp TEXT,
    note TEXT DEFAULT '',
    created_by INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS vehicle_daily_inspections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id INTEGER NOT NULL,
    insp_date TEXT NOT NULL,
    inspector_id INTEGER,
    driver_id INTEGER,
    items_json TEXT DEFAULT '[]',
    overall_ok INTEGER DEFAULT 1,
    review_status TEXT DEFAULT 'ХАБЭА хүлээгдэж байна',
    reviewer_id INTEGER,
    reviewed_at TEXT,
    review_note TEXT DEFAULT '',
    work_permit INTEGER DEFAULT 0,
    note TEXT DEFAULT '',
    created_by INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`ALTER TABLE vehicle_daily_inspections ADD COLUMN driver_id INTEGER`).catch(() => {});
  await run(`ALTER TABLE vehicle_daily_inspections ADD COLUMN review_status TEXT DEFAULT 'ХАБЭА хүлээгдэж байна'`).catch(() => {});
  await run(`ALTER TABLE vehicle_daily_inspections ADD COLUMN reviewer_id INTEGER`).catch(() => {});
  await run(`ALTER TABLE vehicle_daily_inspections ADD COLUMN reviewed_at TEXT`).catch(() => {});
  await run(`ALTER TABLE vehicle_daily_inspections ADD COLUMN review_note TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE vehicle_daily_inspections ADD COLUMN work_permit INTEGER DEFAULT 0`).catch(() => {});

  await run(`CREATE TABLE IF NOT EXISTS vehicle_weekly_inspections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id INTEGER NOT NULL,
    week_start TEXT NOT NULL,
    hse_id INTEGER,
    items_json TEXT DEFAULT '[]',
    overall_ok INTEGER DEFAULT 1,
    note TEXT DEFAULT '',
    created_by INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS vehicle_monthly_inspections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id INTEGER NOT NULL,
    insp_year INTEGER NOT NULL,
    insp_month INTEGER NOT NULL,
    mechanic_id INTEGER,
    engineer_id INTEGER,
    items_json TEXT DEFAULT '[]',
    overall_ok INTEGER DEFAULT 1,
    approval_status TEXT DEFAULT 'Ерөнхий инженер хүлээгдэж байна',
    approved_by INTEGER,
    approved_at TEXT,
    approval_note TEXT DEFAULT '',
    note TEXT DEFAULT '',
    created_by INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`ALTER TABLE vehicle_monthly_inspections ADD COLUMN approval_status TEXT DEFAULT 'Ерөнхий инженер хүлээгдэж байна'`).catch(() => {});
  await run(`ALTER TABLE vehicle_monthly_inspections ADD COLUMN approved_by INTEGER`).catch(() => {});
  await run(`ALTER TABLE vehicle_monthly_inspections ADD COLUMN approved_at TEXT`).catch(() => {});
  await run(`ALTER TABLE vehicle_monthly_inspections ADD COLUMN approval_note TEXT DEFAULT ''`).catch(() => {});

  await run(`CREATE TABLE IF NOT EXISTS vehicle_repairs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id INTEGER NOT NULL,
    repair_date TEXT NOT NULL,
    repair_type TEXT NOT NULL,
    act_no TEXT DEFAULT '',
    technician_id INTEGER,
    engineer_id INTEGER,
    description TEXT DEFAULT '',
    parts_json TEXT DEFAULT '[]',
    cost REAL DEFAULT 0,
    repair_status TEXT DEFAULT 'Хийгдэж байна',
    created_by INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS plans (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_type  TEXT NOT NULL,
    year       INTEGER NOT NULL,
    month      INTEGER,
    title      TEXT NOT NULL,
    department TEXT,
    budget     REAL DEFAULT 0,
    status     TEXT DEFAULT 'Төлөвлөсөн',
    created_by INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS plan_items (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id             INTEGER NOT NULL,
    title               TEXT NOT NULL,
    target_qty          REAL DEFAULT 1,
    unit                TEXT,
    estimated_cost      REAL DEFAULT 0,
    responsible_user    INTEGER,
    due_date            TEXT,
    status              TEXT DEFAULT 'Төлөвлөсөн',
    performance_percent INTEGER DEFAULT 0,
    note                TEXT,
    FOREIGN KEY(plan_id) REFERENCES plans(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS audit_logs (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id   INTEGER,
    action    TEXT NOT NULL,
    entity    TEXT,
    entity_id INTEGER,
    detail    TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  // ── Finance / Нягтлан ─────────────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS cash_journal (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    txn_date       TEXT NOT NULL,
    doc_no         TEXT DEFAULT '',
    txn_type       TEXT NOT NULL,
    description    TEXT NOT NULL,
    debit_account  TEXT DEFAULT '',
    credit_account TEXT DEFAULT '',
    amount         REAL NOT NULL DEFAULT 0,
    currency       TEXT DEFAULT 'MNT',
    exchange_rate  REAL DEFAULT 1,
    cashier        TEXT DEFAULT '',
    note           TEXT DEFAULT '',
    created_by     INTEGER NOT NULL,
    created_at     TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at     TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS accounts_payable (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor_name  TEXT NOT NULL,
    invoice_no   TEXT DEFAULT '',
    invoice_date TEXT NOT NULL,
    due_date     TEXT DEFAULT '',
    amount       REAL NOT NULL DEFAULT 0,
    paid_amount  REAL DEFAULT 0,
    status       TEXT DEFAULT 'Төлөгдөөгүй',
    description  TEXT DEFAULT '',
    category     TEXT DEFAULT '',
    created_by   INTEGER NOT NULL,
    created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at   TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS accounts_receivable (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    debtor_name     TEXT NOT NULL,
    invoice_no      TEXT DEFAULT '',
    invoice_date    TEXT NOT NULL,
    due_date        TEXT DEFAULT '',
    amount          REAL NOT NULL DEFAULT 0,
    received_amount REAL DEFAULT 0,
    status          TEXT DEFAULT 'Хүлээгдэж буй',
    description     TEXT DEFAULT '',
    category        TEXT DEFAULT '',
    created_by      INTEGER NOT NULL,
    created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at      TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS payroll_timesheet (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER NOT NULL,
    year           INTEGER NOT NULL,
    month          INTEGER NOT NULL,
    work_days      REAL DEFAULT 0,
    overtime_hours REAL DEFAULT 0,
    absent_days    REAL DEFAULT 0,
    late_times     INTEGER DEFAULT 0,
    base_salary    REAL DEFAULT 0,
    overtime_pay   REAL DEFAULT 0,
    deductions     REAL DEFAULT 0,
    bonuses        REAL DEFAULT 0,
    net_salary     REAL DEFAULT 0,
    note           TEXT DEFAULT '',
    status         TEXT DEFAULT 'Тооцсон',
    approved_by    INTEGER,
    created_by     INTEGER NOT NULL,
    created_at     TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at     TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, year, month)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS fixed_assets_ledger (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id                 INTEGER,
    account_code             TEXT DEFAULT '',
    asset_code_manual        TEXT DEFAULT '',
    asset_name_manual        TEXT DEFAULT '',
    unit                     TEXT DEFAULT 'ш',
    unit_value               REAL DEFAULT 0,
    initial_qty              REAL DEFAULT 0,
    acquisition_date         TEXT NOT NULL,
    initial_value            REAL DEFAULT 0,
    useful_life_months       INTEGER DEFAULT 120,
    depreciation_method      TEXT DEFAULT 'Шулуун шугам',
    accumulated_depreciation REAL DEFAULT 0,
    book_value               REAL DEFAULT 0,
    last_depreciation_date   TEXT DEFAULT '',
    note                     TEXT DEFAULT '',
    created_by               INTEGER NOT NULL,
    created_at               TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at               TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  // ── Нярав ────────────────────────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS nyarav_orders (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    order_date      TEXT NOT NULL,
    item_name       TEXT NOT NULL,
    qty             REAL NOT NULL DEFAULT 0,
    unit            TEXT DEFAULT '',
    estimated_price REAL DEFAULT 0,
    purpose         TEXT DEFAULT '',
    requested_by    TEXT DEFAULT '',
    status          TEXT DEFAULT 'Хүлээгдэж буй',
    approved_by     INTEGER,
    approval_note   TEXT DEFAULT '',
    note            TEXT DEFAULT '',
    created_by      INTEGER NOT NULL,
    created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at      TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  // Extend material_moves with new columns
  await run(`ALTER TABLE material_moves ADD COLUMN item_id    INTEGER`).catch(() => {});
  await run(`ALTER TABLE material_moves ADD COLUMN supplier   TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE material_moves ADD COLUMN doc_no     TEXT DEFAULT ''`).catch(() => {});

  // ── БМ журнал — Warehouse (new schema) ───────────────────────
  await run(`CREATE TABLE IF NOT EXISTS wh_materials (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    barcode         TEXT UNIQUE,
    name            TEXT NOT NULL,
    category_code   TEXT DEFAULT '',
    category_name   TEXT DEFAULT '',
    unit            TEXT DEFAULT '',
    unit_price      REAL DEFAULT 0,
    opening_qty     REAL DEFAULT 0,
    opening_amount  REAL DEFAULT 0,
    min_qty         REAL DEFAULT 0,
    custodian       TEXT DEFAULT '',
    notes           TEXT DEFAULT '',
    created_by      INTEGER,
    created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at      TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS wh_transactions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    txn_no        TEXT,
    txn_date      TEXT NOT NULL,
    txn_type      TEXT NOT NULL,
    material_id   INTEGER NOT NULL REFERENCES wh_materials(id),
    qty           REAL NOT NULL,
    unit_price    REAL DEFAULT 0,
    amount        REAL DEFAULT 0,
    doc_no        TEXT DEFAULT '',
    supplier      TEXT DEFAULT '',
    received_by   TEXT DEFAULT '',
    work_ref      TEXT DEFAULT '',
    asset_ref     TEXT DEFAULT '',
    notes         TEXT DEFAULT '',
    created_by    INTEGER,
    created_at    TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`ALTER TABLE wh_materials ADD COLUMN min_qty REAL DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE wh_materials ADD COLUMN custodian TEXT DEFAULT ''`).catch(() => {});

  // ── Захиргаа / HR / Архив ─────────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS orders_decisions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_no       TEXT DEFAULT '',
    title        TEXT NOT NULL,
    doc_type     TEXT NOT NULL DEFAULT 'Тушаал',
    doc_date     TEXT NOT NULL,
    description  TEXT DEFAULT '',
    status       TEXT DEFAULT 'Хүчинтэй',
    related_user INTEGER,
    created_by   INTEGER NOT NULL,
    created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at   TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS archive_docs (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    title            TEXT NOT NULL,
    category         TEXT NOT NULL DEFAULT 'Бусад',
    doc_no           TEXT DEFAULT '',
    doc_date         TEXT DEFAULT '',
    date_archived    TEXT NOT NULL,
    box_no           TEXT DEFAULT '',
    shelf_no         TEXT DEFAULT '',
    retention_years  INTEGER DEFAULT 10,
    status           TEXT DEFAULT 'Идэвхтэй',
    description      TEXT DEFAULT '',
    created_by       INTEGER NOT NULL,
    created_at       TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at       TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  // ── Document scan attachments (multi-entity) ─────────────────
  await run(`CREATE TABLE IF NOT EXISTS doc_attachments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type  TEXT NOT NULL,
    entity_id    INTEGER NOT NULL,
    file_url     TEXT NOT NULL,
    file_name    TEXT DEFAULT '',
    note         TEXT DEFAULT '',
    uploaded_by  INTEGER NOT NULL,
    uploaded_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(uploaded_by) REFERENCES users(id)
  )`);

  // Add status column to hr_records for leave approval tracking
  await run(`ALTER TABLE hr_records ADD COLUMN status TEXT DEFAULT 'Бүртгэсэн'`).catch(() => {});
  // Add counterparty column to cash_journal for organization name
  await run(`ALTER TABLE cash_journal ADD COLUMN counterparty TEXT DEFAULT ''`).catch(() => {});
  // Add register_no column to cash_journal for org register/tax ID
  await run(`ALTER TABLE cash_journal ADD COLUMN register_no     TEXT DEFAULT ''`).catch(() => {});
  // Excel extended columns
  await run(`ALTER TABLE cash_journal ADD COLUMN corr_account    TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE cash_journal ADD COLUMN cash_flow_type  TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE cash_journal ADD COLUMN excess          TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE cash_journal ADD COLUMN purpose         TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE cash_journal ADD COLUMN source_fund     TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE cash_journal ADD COLUMN econ_category   TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE cash_journal ADD COLUMN transferor      TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE cash_journal ADD COLUMN receiver        TEXT DEFAULT ''`).catch(() => {});

  // ── Байгуулллагын тохиргоо (org settings) ─────────────────
  await run(`CREATE TABLE IF NOT EXISTS org_settings (
    key   TEXT PRIMARY KEY,
    value TEXT DEFAULT ''
  )`);
  // Seed defaults if empty
  await run(`INSERT OR IGNORE INTO org_settings(key,value) VALUES
    ('org_name','Чойбалсан хөгжил ОНӨҮГ'),
    ('director',''),
    ('address','Чойбалсан хот'),
    ('phone',''),
    ('register',''),
    ('email','choibalsankhugjil@gmail.com'),
    ('notice','')`);
  // Ensure email is set even if already seeded with empty value
  await run(`UPDATE org_settings SET value='choibalsankhugjil@gmail.com' WHERE key='email' AND value=''`);

  // ── Хөрөнгийн ангилал (динамик) ──────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS asset_categories (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT UNIQUE NOT NULL,
    icon       TEXT DEFAULT '📦',
    color      TEXT DEFAULT '#94a3b8',
    bg         TEXT DEFAULT '#f8fafc',
    border     TEXT DEFAULT '#e2e8f0',
    sort_order INTEGER DEFAULT 99,
    is_active  INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  const acCount = await get("SELECT COUNT(*) as cnt FROM asset_categories");
  if (acCount.cnt === 0) {
    const seeds = [
      ["Авто замын гэрэл",    "💡","#f59e0b","#fffbeb","#fde68a",1],
      ["Гэр хорооллын гэрэл", "🏘️","#0ea5e9","#f0f9ff","#bae6fd",2],
      ["Цамхагийн гэрэл",    "🗼","#d97706","#fff7ed","#fed7aa",3],
      ["Камер",               "🎥","#3b82f6","#eff6ff","#bfdbfe",4],
      ["Шилэн кабель",        "🧵","#8b5cf6","#f5f3ff","#ddd6fe",5],
      ["Шит/Самбар",          "⚡","#ef4444","#fef2f2","#fecaca",6],
      ["Гэрлэн дохио",        "🚦","#10b981","#f0fdf4","#bbf7d0",7],
      ["Техник",              "🚗","#6366f1","#eef2ff","#c7d2fe",8],
      ["Барилга",             "🏢","#64748b","#f8fafc","#e2e8f0",9],
      ["Бусад",               "📦","#94a3b8","#f8fafc","#e2e8f0",10],
    ];
    for (const s of seeds)
      await run(`INSERT INTO asset_categories(name,icon,color,bg,border,sort_order) VALUES(?,?,?,?,?,?)`, s);
  }

  // ── Хөрөнгийн буруу бүртгэл тэмдэглэгч ──────────────────────
  await run(`CREATE TABLE IF NOT EXISTS asset_flags (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name  TEXT NOT NULL,
    record_id   INTEGER NOT NULL,
    flag_note   TEXT DEFAULT '',
    flagged_by  INTEGER REFERENCES users(id),
    flagged_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    is_resolved INTEGER DEFAULT 0,
    resolved_by INTEGER REFERENCES users(id),
    resolved_at TEXT,
    UNIQUE(table_name, record_id)
  )`);

  // ── LoRa төхөөрөмжийн бүртгэл ───────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS lora_devices (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    device_eui     TEXT UNIQUE,
    device_name    TEXT NOT NULL,
    model          TEXT DEFAULT 'AWD300',
    sl_point_id    INTEGER REFERENCES sl_points(id),
    ger_inv_id     INTEGER REFERENCES sl_ger_inventory(id),
    location_desc  TEXT DEFAULT '',
    phase          TEXT DEFAULT '1Ф',
    is_active      INTEGER DEFAULT 1,
    last_seen      TEXT,
    last_voltage   REAL,
    last_current   REAL,
    last_power     REAL,
    last_status    TEXT DEFAULT 'unknown',
    notes          TEXT DEFAULT '',
    installed_date TEXT,
    created_at     TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  // ── LoRa өдрийн уншилт ───────────────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS lora_daily (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id    INTEGER NOT NULL REFERENCES lora_devices(id),
    date         TEXT NOT NULL,
    on_time      TEXT,
    off_time     TEXT,
    voltage_v    REAL,
    current_a    REAL,
    power_kw     REAL,
    energy_kwh   REAL,
    power_factor REAL,
    is_fault     INTEGER DEFAULT 0,
    fault_note   TEXT DEFAULT '',
    rssi         INTEGER,
    snr          REAL,
    entered_by   INTEGER REFERENCES users(id),
    source       TEXT DEFAULT 'manual',
    created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(device_id, date)
  )`);

  // ── LoRa хэмжилтийн түүх (raw readings) ─────────────────────
  await run(`CREATE TABLE IF NOT EXISTS lora_readings (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id    INTEGER NOT NULL REFERENCES lora_devices(id),
    received_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    voltage_v    REAL,
    current_a    REAL,
    power_kw     REAL,
    energy_kwh   REAL,
    power_factor REAL,
    is_on        INTEGER DEFAULT 1,
    is_fault     INTEGER DEFAULT 0,
    fault_code   INTEGER,
    rssi         INTEGER,
    snr          REAL,
    raw_payload  TEXT
  )`);

  // ── Гэрэлтүүлгийн цагийн тохируулгын түүх ───────────────────
  await run(`CREATE TABLE IF NOT EXISTS light_schedule_logs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    category       TEXT NOT NULL,
    adjusted_date  TEXT NOT NULL,
    valid_from     TEXT NOT NULL,
    on_time        TEXT,
    off_time       TEXT,
    is_always_off  INTEGER DEFAULT 0,
    adjusted_by    INTEGER REFERENCES users(id),
    notes          TEXT DEFAULT '',
    created_at     TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  // ── Ажлын категориуд (dynamic work categories) ───────────────
  await run(`CREATE TABLE IF NOT EXISTS work_categories (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT UNIQUE NOT NULL,
    icon       TEXT DEFAULT '📋',
    color      TEXT DEFAULT '#2563eb',
    department TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 99,
    is_active  INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  const catCount = await get("SELECT COUNT(*) as cnt FROM work_categories");
  if (catCount.cnt === 0) {
    await run(`INSERT INTO work_categories (name,icon,color,department,sort_order) VALUES (?,?,?,?,?)`,
      ["Гэрэлтүүлэг засвар","💡","#f59e0b","Гэрэлтүүлэг",1]);
    await run(`INSERT INTO work_categories (name,icon,color,department,sort_order) VALUES (?,?,?,?,?)`,
      ["Камер засвар","🎥","#8b5cf6","Камер",2]);
  };

  // ── Байгуулллагын гэрээ (org contracts) ───────────────────
  await run(`CREATE TABLE IF NOT EXISTS org_contracts (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    contract_no    TEXT DEFAULT '',
    title          TEXT NOT NULL,
    contract_type  TEXT DEFAULT 'Бусад',
    counterparty   TEXT DEFAULT '',
    start_date     TEXT DEFAULT '',
    end_date       TEXT DEFAULT '',
    amount         REAL DEFAULT 0,
    status         TEXT DEFAULT 'Хүчинтэй',
    description    TEXT DEFAULT '',
    created_by     INTEGER,
    created_at     TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at     TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  // ── org_contracts extended columns ───────────────────────
  await run(`ALTER TABLE org_contracts ADD COLUMN register_no TEXT DEFAULT ''`).catch(()=>{});
  await run(`ALTER TABLE org_contracts ADD COLUMN phone TEXT DEFAULT ''`).catch(()=>{});
  await run(`ALTER TABLE org_contracts ADD COLUMN email TEXT DEFAULT ''`).catch(()=>{});
  await run(`ALTER TABLE org_contracts ADD COLUMN signed_date TEXT DEFAULT ''`).catch(()=>{});
  await run(`ALTER TABLE org_contracts ADD COLUMN responsible_person TEXT DEFAULT ''`).catch(()=>{});
  await run(`ALTER TABLE org_contracts ADD COLUMN details TEXT DEFAULT '{}'`).catch(()=>{});
  await run(`UPDATE org_contracts SET contract_type='Түрээсийн гэрээ' WHERE contract_type='Авто машин түрээслэх гэрээ'`).catch(()=>{});

  // ── Contract scans (multiple per contract) ────────────────
  await run(`CREATE TABLE IF NOT EXISTS contract_scans (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    contract_id INTEGER NOT NULL,
    url         TEXT NOT NULL,
    filename    TEXT DEFAULT '',
    uploaded_by INTEGER,
    uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  // ── Recruitment ───────────────────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS job_postings (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT NOT NULL,
    department   TEXT DEFAULT '',
    position     TEXT DEFAULT '',
    requirements TEXT DEFAULT '',
    salary_range TEXT DEFAULT '',
    deadline     TEXT DEFAULT '',
    status       TEXT DEFAULT 'Нээлттэй',
    description  TEXT DEFAULT '',
    created_by   INTEGER,
    created_at   TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS job_applications (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    posting_id     INTEGER,
    full_name      TEXT NOT NULL,
    register_no    TEXT DEFAULT '',
    birthdate      TEXT DEFAULT '',
    phone          TEXT DEFAULT '',
    email          TEXT DEFAULT '',
    address        TEXT DEFAULT '',
    education      TEXT DEFAULT '',
    major          TEXT DEFAULT '',
    experience     TEXT DEFAULT '',
    skills         TEXT DEFAULT '',
    stage          TEXT DEFAULT 'Бүртгэгдсэн',
    interview_date TEXT DEFAULT '',
    interview_note TEXT DEFAULT '',
    cv_url         TEXT DEFAULT '',
    note           TEXT DEFAULT '',
    created_at     TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(posting_id) REFERENCES job_postings(id)
  )`);

  // ── Training ──────────────────────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS trainings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    type        TEXT DEFAULT 'Дотоод',
    category    TEXT DEFAULT '',
    trainer     TEXT DEFAULT '',
    location    TEXT DEFAULT '',
    start_date  TEXT DEFAULT '',
    end_date    TEXT DEFAULT '',
    hours       INTEGER DEFAULT 0,
    budget      REAL DEFAULT 0,
    description TEXT DEFAULT '',
    status      TEXT DEFAULT 'Төлөвлөгдсөн',
    created_by  INTEGER,
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS training_attendees (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    training_id     INTEGER NOT NULL,
    user_id         INTEGER NOT NULL,
    attended        INTEGER DEFAULT 0,
    score           REAL,
    certificate_url TEXT DEFAULT '',
    note            TEXT DEFAULT '',
    FOREIGN KEY(training_id) REFERENCES trainings(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // ── KPI Evaluation ────────────────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS kpi_evaluations (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL,
    evaluator_id INTEGER,
    period       TEXT DEFAULT '',
    period_type  TEXT DEFAULT 'Сар',
    items        TEXT DEFAULT '[]',
    total_score  REAL DEFAULT 0,
    grade        TEXT DEFAULT '',
    comment      TEXT DEFAULT '',
    status       TEXT DEFAULT 'Ноорог',
    created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // ── Surveys ───────────────────────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS surveys (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    description TEXT DEFAULT '',
    type        TEXT DEFAULT 'Сэтгэл ханамж',
    questions   TEXT DEFAULT '[]',
    deadline    TEXT DEFAULT '',
    status      TEXT DEFAULT 'Идэвхтэй',
    anonymous   INTEGER DEFAULT 1,
    public_token TEXT,
    created_by  INTEGER,
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`ALTER TABLE surveys ADD COLUMN public_token TEXT`).catch(() => {});
  await run(`UPDATE surveys SET public_token=lower(hex(randomblob(16))) WHERE public_token IS NULL OR public_token=''`).catch(() => {});

  await run(`CREATE TABLE IF NOT EXISTS survey_responses (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    survey_id    INTEGER NOT NULL,
    user_id      INTEGER,
    answers      TEXT DEFAULT '{}',
    submitted_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(survey_id) REFERENCES surveys(id)
  )`);

  // ── Assets ────────────────────────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS assets (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_code        TEXT UNIQUE,
    name              TEXT NOT NULL,
    category          TEXT NOT NULL,
    sub_category      TEXT,
    location          TEXT,
    gps_lat           REAL,
    gps_lng           REAL,
    status            TEXT DEFAULT 'Идэвхтэй',
    condition         TEXT DEFAULT 'Хэвийн',
    assigned_to       INTEGER,
    installed_date    TEXT,
    warranty_until    TEXT,
    purchase_price    REAL DEFAULT 0,
    current_value     REAL DEFAULT 0,
    useful_life_years INTEGER DEFAULT 10,
    description       TEXT,
    specs             TEXT,
    notes             TEXT,
    created_by        INTEGER NOT NULL,
    created_at        TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at        TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(assigned_to) REFERENCES users(id),
    FOREIGN KEY(created_by)  REFERENCES users(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS asset_files (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id    INTEGER NOT NULL,
    file_type   TEXT NOT NULL,
    file_path   TEXT NOT NULL,
    file_name   TEXT,
    description TEXT,
    uploaded_by INTEGER NOT NULL,
    uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(asset_id)    REFERENCES assets(id),
    FOREIGN KEY(uploaded_by) REFERENCES users(id)
  )`);

  // ── Улсын үзлэг, тооллого ────────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS asset_inventory_sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    year        INTEGER NOT NULL,
    start_date  TEXT,
    end_date    TEXT,
    status      TEXT DEFAULT 'Явцтай',
    notes       TEXT DEFAULT '',
    created_by  INTEGER NOT NULL,
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(created_by) REFERENCES users(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS asset_inventory_items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id   INTEGER NOT NULL,
    ledger_id    INTEGER NOT NULL,
    inv_status   TEXT DEFAULT 'Хүлээгдэж буй',
    actual_qty   REAL DEFAULT 1,
    note         TEXT DEFAULT '',
    checked_by   INTEGER,
    checked_at   TEXT,
    UNIQUE(session_id, ledger_id),
    FOREIGN KEY(session_id) REFERENCES asset_inventory_sessions(id),
    FOREIGN KEY(ledger_id)  REFERENCES fixed_assets_ledger(id),
    FOREIGN KEY(checked_by) REFERENCES users(id)
  )`);

  // ── Employee extended profiles ────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS employee_profiles (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER UNIQUE NOT NULL,
    family_status    TEXT DEFAULT '',
    spouse_name      TEXT DEFAULT '',
    children_count   INTEGER DEFAULT 0,
    children_names   TEXT DEFAULT '',
    home_address     TEXT DEFAULT '',
    diploma          TEXT DEFAULT '',
    professional_cert TEXT DEFAULT '',
    id_card_no       TEXT DEFAULT '',
    job_description  TEXT DEFAULT '',
    contract_no      TEXT DEFAULT '',
    contract_date    TEXT DEFAULT '',
    contract_notes   TEXT DEFAULT '',
    updated_at       TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS employee_awards (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    award_name TEXT NOT NULL,
    award_date TEXT DEFAULT '',
    awarded_by TEXT DEFAULT '',
    note       TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS employee_files (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    file_type   TEXT NOT NULL,
    file_path   TEXT NOT NULL,
    file_name   TEXT,
    uploaded_by INTEGER NOT NULL,
    uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id)     REFERENCES users(id),
    FOREIGN KEY(uploaded_by) REFERENCES users(id)
  )`);

  // ── Seed users (only on empty DB) ────────────────────────
  const count = await get("SELECT COUNT(*) as c FROM users");
  if (count.c === 0) {
    const users = [
      ["director",   "Choibalsan@2026!", "Батсүх Гэрэлт-Од",        "director",      "Захирал",                 "ПЮ80061073", "10-р баг 26-54 тоот",    "99582070", "Захиргаа",   "btskhgereltod@gmail.com"],
      ["engineer",   "Choibalsan@2026!", "Ганболд Билгүүн",           "chief_engineer","Ерөнхий инженер",          "ЖЮ97050218", "6-р баг 25-55",          "89961997", "Инженер",    "engineer@choibalsan.mn"],
      ["hr",         "Choibalsan@2026!", "Болд Ундраа",               "hr",            "Хүний нөөцийн ажилтан",   "ЖЗ86061607", "6-р баг 70-23 тоот",     "88304224", "Хүний нөөц", "hr@choibalsan.mn"],
      ["safety",     "Choibalsan@2026!", "Батболд Энхболор",          "safety",        "ХАБЭА-н ажилтан",         "ЖЬ87121868", "8-р баг 58-49 тоот",     "80824303", "ХАБЭА",      "safety@choibalsan.mn"],
      ["accountant", "Choibalsan@2026!", "Цэрэнжав Тунгалаг",         "accountant",    "Нягтлан бодогч",          "ЖЯ81050100", "9-р баг 17-23",          "99006010", "Санхүү",     "accountant@choibalsan.mn"],
      ["network",    "Choibalsan@2026!", "Балданпүрэв Мөнх-Эрдэнэ",  "engineer",      "Сүлжээний инженер",       "ЖЯ94051213", "7-р баг 31-10 тоот",     "99588085", "Камер",      "network@choibalsan.mn"],
      ["electric",   "Choibalsan@2026!", "Амаржаргал Цэлмэг",         "engineer",      "Цахилгааны инженер",      "ТБ99121004", "10-р баг, зангиат 1-25", "80990144", "Цахилгаан",  "electric@choibalsan.mn"],
      ["store",      "Choibalsan@2026!", "Дамдинжав Пүрэвсүрэн",     "storekeeper",   "Нярав",                   "ЖЛ82031809", "7-р баг Гарден 217-4",   "91111762", "Аж ахуй",    "store@choibalsan.mn"]
    ];
    for (const u of users) {
      await run(
        `INSERT INTO users(username,password_hash,full_name,role,position,register_no,address,phone,department,email)
         VALUES(?,?,?,?,?,?,?,?,?,?)`,
        [u[0], bcrypt.hashSync(u[1], 10), u[2], u[3], u[4], u[5], u[6], u[7], u[8], u[9]]);
    }
  }

  // ── Report schedules ──────────────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS report_schedules (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    frequency   TEXT NOT NULL,
    next_due    TEXT NOT NULL,
    responsible TEXT,
    recipient   TEXT,
    warn_days   INTEGER DEFAULT 7,
    note        TEXT,
    is_active   INTEGER DEFAULT 1,
    created_by  INTEGER,
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`ALTER TABLE report_schedules ADD COLUMN last_sent TEXT`).catch(() => {});

  // ── Street Lighting Electricity Management ─────────────────
  await run(`CREATE TABLE IF NOT EXISTS sl_organizations (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT NOT NULL,
    short_name     TEXT,
    contact_person TEXT,
    phone          TEXT,
    notes          TEXT,
    is_own         INTEGER DEFAULT 0,
    created_at     TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  const slOwnExists = await get("SELECT id FROM sl_organizations WHERE is_own=1");
  if (!slOwnExists) {
    const slOrgName = await get("SELECT value FROM org_settings WHERE key='org_name'");
    await run("INSERT INTO sl_organizations(name,short_name,is_own) VALUES(?,?,1)",
      [slOrgName?.value || "Чойбалсан хөгжил ОНӨҮГ", "Манай"]);
  }

  await run(`CREATE TABLE IF NOT EXISTS sl_points (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    code             TEXT UNIQUE NOT NULL,
    name             TEXT NOT NULL,
    location         TEXT,
    gps_lat          REAL,
    gps_lng          REAL,
    org_id           INTEGER,
    meter_no         TEXT,
    lamp_count       INTEGER DEFAULT 1,
    wattage_per_lamp REAL DEFAULT 0,
    status           TEXT DEFAULT 'active',
    install_date     TEXT,
    remove_date      TEXT,
    notes            TEXT,
    created_by       INTEGER,
    created_at       TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at       TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(org_id)     REFERENCES sl_organizations(id),
    FOREIGN KEY(created_by) REFERENCES users(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS sl_monthly_readings (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    point_id     INTEGER NOT NULL,
    year         INTEGER NOT NULL,
    month        INTEGER NOT NULL,
    prev_reading REAL DEFAULT 0,
    curr_reading REAL DEFAULT 0,
    kwh_used     REAL DEFAULT 0,
    rate         REAL DEFAULT 0,
    amount       REAL DEFAULT 0,
    in_our_bill  INTEGER DEFAULT 1,
    anomaly_flag INTEGER DEFAULT 0,
    anomaly_note TEXT,
    notes        TEXT,
    entered_by   INTEGER,
    entered_at   TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(point_id, year, month),
    FOREIGN KEY(point_id)   REFERENCES sl_points(id),
    FOREIGN KEY(entered_by) REFERENCES users(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS sl_bills (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_no        TEXT,
    bill_date      TEXT,
    year           INTEGER NOT NULL,
    month          INTEGER NOT NULL,
    supplier_name  TEXT,
    total_kwh      REAL DEFAULT 0,
    total_amount   REAL DEFAULT 0,
    our_kwh        REAL DEFAULT 0,
    our_amount     REAL DEFAULT 0,
    diff_kwh       REAL DEFAULT 0,
    diff_amount    REAL DEFAULT 0,
    foreign_kwh    REAL DEFAULT 0,
    foreign_amount REAL DEFAULT 0,
    status         TEXT DEFAULT 'pending',
    notes          TEXT,
    created_by     INTEGER,
    created_at     TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at     TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(year, month)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS sl_transfers (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    point_id      INTEGER NOT NULL,
    from_org_id   INTEGER,
    to_org_id     INTEGER,
    transfer_date TEXT NOT NULL,
    doc_no        TEXT,
    reason        TEXT,
    notes         TEXT,
    created_by    INTEGER,
    created_at    TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(point_id)    REFERENCES sl_points(id),
    FOREIGN KEY(from_org_id) REFERENCES sl_organizations(id),
    FOREIGN KEY(to_org_id)   REFERENCES sl_organizations(id),
    FOREIGN KEY(created_by)  REFERENCES users(id)
  )`);

  // ── Electricity billing ───────────────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS meter_points (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    meter_no          TEXT UNIQUE NOT NULL,
    name              TEXT,
    location          TEXT,
    owner_status      TEXT NOT NULL DEFAULT 'OURS',
    status            TEXT NOT NULL DEFAULT 'ACTIVE',
    lamp_count        INTEGER DEFAULT 1,
    wattage_per_lamp  REAL DEFAULT 0,
    gps_lat           REAL,
    gps_lng           REAL,
    install_date      TEXT,
    remove_date       TEXT,
    notes             TEXT,
    created_by        INTEGER,
    created_at        TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at        TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS electricity_bill_imports (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_no     TEXT,
    billing_year   INTEGER NOT NULL,
    billing_month  INTEGER NOT NULL,
    supplier_name  TEXT DEFAULT 'ДБЭХС ТӨХК ЭХБ хэлтэс',
    invoice_date   TEXT,
    total_kwh      REAL DEFAULT 0,
    total_amount   REAL DEFAULT 0,
    our_kwh        REAL DEFAULT 0,
    our_amount     REAL DEFAULT 0,
    diff_kwh       REAL DEFAULT 0,
    diff_amount    REAL DEFAULT 0,
    status         TEXT DEFAULT 'pending',
    notes          TEXT,
    created_by     INTEGER,
    created_at     TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at     TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(billing_year, billing_month)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS electricity_bill_raw_rows (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    import_id     INTEGER NOT NULL,
    row_seq       INTEGER,
    row_type      TEXT NOT NULL DEFAULT 'METERED',
    time_type     TEXT DEFAULT 'DAY',
    meter_no      TEXT,
    location      TEXT,
    prev_reading  REAL DEFAULT 0,
    curr_reading  REAL DEFAULT 0,
    usage_kwh     REAL DEFAULT 0,
    tariff        REAL DEFAULT 0,
    amount        REAL DEFAULT 0,
    raw_text      TEXT,
    FOREIGN KEY(import_id) REFERENCES electricity_bill_imports(id) ON DELETE CASCADE
  )`);

  await run(`CREATE TABLE IF NOT EXISTS electricity_bill_points (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    import_id        INTEGER NOT NULL,
    meter_no         TEXT NOT NULL,
    location         TEXT,
    prev_reading     REAL DEFAULT 0,
    curr_reading     REAL DEFAULT 0,
    usage_kwh        REAL DEFAULT 0,
    day_kwh          REAL DEFAULT 0,
    night_kwh        REAL DEFAULT 0,
    capacity_amount  REAL DEFAULT 0,
    tariff           REAL DEFAULT 0,
    amount           REAL DEFAULT 0,
    row_type         TEXT DEFAULT 'METERED',
    raw_row_count    INTEGER DEFAULT 1,
    meter_point_id   INTEGER,
    owner_status     TEXT,
    mp_status        TEXT,
    FOREIGN KEY(import_id)      REFERENCES electricity_bill_imports(id) ON DELETE CASCADE,
    FOREIGN KEY(meter_point_id) REFERENCES meter_points(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS electricity_bill_checks (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    import_id       INTEGER NOT NULL,
    bill_point_id   INTEGER,
    check_code      TEXT NOT NULL,
    check_name      TEXT NOT NULL,
    severity        TEXT NOT NULL DEFAULT 'WARNING',
    message         TEXT NOT NULL,
    meter_no        TEXT,
    is_resolved     INTEGER DEFAULT 0,
    resolved_by     INTEGER,
    resolved_at     TEXT,
    resolution_note TEXT,
    created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(import_id) REFERENCES electricity_bill_imports(id) ON DELETE CASCADE
  )`);

  await run(`CREATE TABLE IF NOT EXISTS el_budget_plan (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    year        INTEGER NOT NULL UNIQUE,
    budget_code TEXT DEFAULT '210301',
    name        TEXT DEFAULT 'Гэрэл цахилгаан',
    m1  REAL DEFAULT 0, m2  REAL DEFAULT 0, m3  REAL DEFAULT 0,
    m4  REAL DEFAULT 0, m5  REAL DEFAULT 0, m6  REAL DEFAULT 0,
    m7  REAL DEFAULT 0, m8  REAL DEFAULT 0, m9  REAL DEFAULT 0,
    m10 REAL DEFAULT 0, m11 REAL DEFAULT 0, m12 REAL DEFAULT 0,
    created_by  INTEGER,
    updated_at  TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS meter_transfers (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    meter_point_id   INTEGER NOT NULL,
    from_status      TEXT NOT NULL,
    to_status        TEXT NOT NULL,
    transfer_date    TEXT NOT NULL,
    doc_no           TEXT,
    reason           TEXT,
    notes            TEXT,
    created_by       INTEGER,
    created_at       TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(meter_point_id) REFERENCES meter_points(id)
  )`);

  // ── Гэр хорооллын гэрэлтүүлгийн бүртгэл ─────────────────────
  await run(`CREATE TABLE IF NOT EXISTS sl_ger_inventory (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    bag_no        INTEGER,
    location_name TEXT NOT NULL,
    category      TEXT NOT NULL DEFAULT 'Гэр хороолол',
    total_count   INTEGER DEFAULT 0,
    light_type    TEXT DEFAULT '',
    sl_point_id   INTEGER,
    notes         TEXT DEFAULT '',
    created_by    INTEGER,
    created_at    TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at    TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(sl_point_id) REFERENCES sl_points(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS sl_inspections (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    inventory_id  INTEGER NOT NULL,
    year          INTEGER NOT NULL,
    quarter       INTEGER NOT NULL,
    inspect_date  TEXT NOT NULL,
    total_count   INTEGER DEFAULT 0,
    broken_count  INTEGER DEFAULT 0,
    inspector_id  INTEGER,
    note          TEXT DEFAULT '',
    created_at    TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(inventory_id) REFERENCES sl_ger_inventory(id),
    FOREIGN KEY(inspector_id) REFERENCES users(id)
  )`);

  // Seed ger inventory from Excel data (one-time)
  const gerCount = await get("SELECT COUNT(*) as c FROM sl_ger_inventory");
  if (!gerCount || gerCount.c === 0) {
    try {
      const seedPath = path.join(__dirname, "db", "ger-lights-seed.json");
      if (fs.existsSync(seedPath)) {
        const gerSeed = JSON.parse(fs.readFileSync(seedPath, "utf8"));
        for (const r of gerSeed) {
          await run(
            `INSERT INTO sl_ger_inventory(bag_no,location_name,category,total_count,light_type,notes)
             VALUES(?,?,?,?,?,?)`,
            [r.bag_no||null, r.location_name, r.category, r.total_count||0,
             r.light_type||"", r.broken_count > 0 ? `Эвдэрсэн: ${r.broken_count}` : ""]
          );
        }
        // Seed first inspection record with broken counts from Excel
        const now = new Date().toISOString().slice(0,10);
        const invRows = await all("SELECT id,location_name,total_count FROM sl_ger_inventory");
        for (const inv of invRows) {
          const seed = gerSeed.find(r => r.location_name === inv.location_name);
          if (seed && seed.broken_count > 0) {
            await run(
              `INSERT INTO sl_inspections(inventory_id,year,quarter,inspect_date,total_count,broken_count,note)
               VALUES(?,?,?,?,?,?,?)`,
              [inv.id, 2026, 1, now, inv.total_count, seed.broken_count, "2026 оны 1-р улирлын тооллого"]
            );
          }
        }
        console.log(`[seed] sl_ger_inventory: ${gerSeed.length} байршил оруулав`);
      }
    } catch(e) { console.warn("[seed] ger-lights-seed.json уншихад алдаа:", e.message); }
  }

  // Migrations: add new columns if not present
  try { await run("ALTER TABLE meter_points ADD COLUMN verified INTEGER DEFAULT 0"); } catch(_) {}
  try { await run("ALTER TABLE meter_points ADD COLUMN auto_created INTEGER DEFAULT 0"); } catch(_) {}
  try { await run("ALTER TABLE meter_points ADD COLUMN panel_asset_id INTEGER REFERENCES assets(id)"); } catch(_) {}
  // Link asset_events (засвар) → ger inventory location
  try { await run("ALTER TABLE asset_events ADD COLUMN ger_inventory_id INTEGER"); } catch(_) {}
  try { await run("ALTER TABLE asset_events ADD COLUMN sl_point_id INTEGER"); } catch(_) {}
  try { await run("ALTER TABLE asset_events ADD COLUMN sl_sub_category TEXT"); } catch(_) {}
  // Цамхагийн толгойн тоо (heads per pole)
  try { await run("ALTER TABLE sl_ger_inventory ADD COLUMN head_count INTEGER DEFAULT 0"); } catch(_) {}
  try { await run("ALTER TABLE sl_ger_inventory ADD COLUMN gps_lat REAL"); } catch(_) {}
  try { await run("ALTER TABLE sl_ger_inventory ADD COLUMN gps_lng REAL"); } catch(_) {}
  try { await run("ALTER TABLE sl_ger_inventory ADD COLUMN meter_no TEXT"); } catch(_) {}
  try { await run("ALTER TABLE sl_ger_inventory ADD COLUMN meter_point_id INTEGER"); } catch(_) {}
  try { await run("ALTER TABLE sl_ger_inventory ADD COLUMN install_date TEXT"); } catch(_) {}

  await run(`CREATE TABLE IF NOT EXISTS sl_ger_photos (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    ger_id       INTEGER NOT NULL,
    file_path    TEXT NOT NULL,
    description  TEXT,
    uploaded_by  INTEGER,
    uploaded_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(ger_id) REFERENCES sl_ger_inventory(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS sl_ger_docs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    ger_id       INTEGER NOT NULL,
    file_path    TEXT NOT NULL,
    file_name    TEXT,
    description  TEXT,
    uploaded_by  INTEGER,
    uploaded_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(ger_id) REFERENCES sl_ger_inventory(id)
  )`);
  // sl_points: гудамжны гэрэлтүүлгийн дэлгэрэнгүй мэдээлэл (Excel-аас оруулсан)
  try { await run("ALTER TABLE sl_points ADD COLUMN head_count INTEGER DEFAULT 1"); } catch(_) {}
  try { await run("ALTER TABLE sl_points ADD COLUMN total_heads INTEGER DEFAULT 0"); } catch(_) {}
  try { await run("ALTER TABLE sl_points ADD COLUMN light_type TEXT"); } catch(_) {}
  try { await run("ALTER TABLE sl_points ADD COLUMN needs_poles INTEGER DEFAULT 0"); } catch(_) {}
  try { await run("ALTER TABLE sl_points ADD COLUMN meter_point_id INTEGER"); } catch(_) {}

  // Гэмтэл / засварын бүртгэл
  await run(`CREATE TABLE IF NOT EXISTS sl_faults (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    category     TEXT NOT NULL,
    location_id  INTEGER,
    location_name TEXT NOT NULL,
    total_heads  INTEGER NOT NULL DEFAULT 0,
    broken_count INTEGER NOT NULL DEFAULT 0,
    fixed_count  INTEGER NOT NULL DEFAULT 0,
    status       TEXT NOT NULL DEFAULT 'Нээлттэй',
    report_date  TEXT NOT NULL DEFAULT (date('now')),
    notes        TEXT,
    reported_by  INTEGER,
    created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at   TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(reported_by) REFERENCES users(id)
  )`);
  await run(`CREATE TABLE IF NOT EXISTS sl_fault_repairs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    fault_id     INTEGER NOT NULL,
    heads_fixed  INTEGER NOT NULL DEFAULT 0,
    repair_date  TEXT NOT NULL DEFAULT (date('now')),
    notes        TEXT,
    repaired_by  INTEGER,
    created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(fault_id) REFERENCES sl_faults(id),
    FOREIGN KEY(repaired_by) REFERENCES users(id)
  )`);
  try { await run("ALTER TABLE sl_faults ADD COLUMN location_type TEXT"); } catch(_) {}

  // Гэрлэн дохионы цагийн нарийвчлалтай төлөвийн журнал
  await run(`CREATE TABLE IF NOT EXISTS traffic_signal_status_logs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id       INTEGER NOT NULL,
    status         TEXT NOT NULL,
    started_at     TEXT NOT NULL,
    ended_at       TEXT,
    source         TEXT DEFAULT '',
    evidence_no    TEXT DEFAULT '',
    notes          TEXT DEFAULT '',
    recorded_by    INTEGER,
    created_at     TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at     TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(asset_id)    REFERENCES assets(id),
    FOREIGN KEY(recorded_by) REFERENCES users(id)
  )`);

  // Гудамжны гэрэлтүүлгийн паспорт баримт (PDF, зураг)
  await run(`CREATE TABLE IF NOT EXISTS sl_point_docs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    sl_point_id  INTEGER NOT NULL,
    file_path    TEXT NOT NULL,
    file_name    TEXT,
    description  TEXT,
    uploaded_by  INTEGER,
    uploaded_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(sl_point_id) REFERENCES sl_points(id),
    FOREIGN KEY(uploaded_by) REFERENCES users(id)
  )`);

  // Гудамжны гэрэлтүүлгийн зургийн бүртгэл
  await run(`CREATE TABLE IF NOT EXISTS sl_point_photos (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    sl_point_id  INTEGER NOT NULL,
    file_path    TEXT NOT NULL,
    description  TEXT,
    uploaded_by  INTEGER,
    uploaded_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(sl_point_id) REFERENCES sl_points(id),
    FOREIGN KEY(uploaded_by) REFERENCES users(id)
  )`);

  // Migrate existing sl_bills → electricity_bill_imports
  try {
    const slBills = await all("SELECT * FROM sl_bills");
    for (const b of slBills) {
      const exists = await get(
        "SELECT id FROM electricity_bill_imports WHERE billing_year=? AND billing_month=?",
        [b.year, b.month]
      );
      if (!exists) {
        await run(
          `INSERT INTO electricity_bill_imports
             (invoice_no,billing_year,billing_month,total_kwh,total_amount,our_kwh,our_amount,
              diff_kwh,diff_amount,status,notes,created_by)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
          [b.bill_no || null, b.year, b.month,
           b.total_kwh || 0, b.total_amount || 0,
           b.our_kwh || 0, b.our_amount || 0,
           b.diff_kwh || 0, b.diff_amount || 0,
           b.status || "confirmed",
           "Migrated from sl_bills" + (b.notes ? ": " + b.notes : ""),
           b.created_by || 1]
        );
      }
    }
  } catch (_) { /* sl_bills may not have data yet */ }

  // ── AI Туслахын лог ба feedback ───────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS assistant_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER,
    question   TEXT,
    intent     TEXT,
    mode       TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS assistant_feedback (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    log_id     INTEGER,
    user_id    INTEGER,
    rating     INTEGER,
    comment    TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(log_id)  REFERENCES assistant_logs(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);
  await run(`CREATE INDEX IF NOT EXISTS idx_assistant_logs_created ON assistant_logs(created_at)`).catch(() => {});
  await run(`DELETE FROM assistant_feedback
             WHERE id NOT IN (
               SELECT MAX(id) FROM assistant_feedback
               WHERE log_id IS NOT NULL AND user_id IS NOT NULL
               GROUP BY log_id,user_id
             )`).catch(() => {});
  await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_assistant_feedback_once ON assistant_feedback(log_id,user_id)`).catch(() => {});

  await run(`CREATE TABLE IF NOT EXISTS assistant_dev_requests (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER,
    module         TEXT,
    request_type   TEXT,
    severity       TEXT,
    title          TEXT,
    description    TEXT,
    page_url       TEXT,
    user_agent     TEXT,
    status         TEXT DEFAULT 'Шинэ',
    assigned_to    INTEGER,
    created_at     TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at     TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id)     REFERENCES users(id),
    FOREIGN KEY(assigned_to) REFERENCES users(id)
  )`);
  await run(`CREATE INDEX IF NOT EXISTS idx_assistant_dev_requests_status ON assistant_dev_requests(status,created_at)`).catch(() => {});

  // ── assistant_dev_requests column migrations ──────────────────
  for (const col of [
    `ALTER TABLE assistant_dev_requests ADD COLUMN priority TEXT DEFAULT 'medium'`,
    `ALTER TABLE assistant_dev_requests ADD COLUMN admin_note TEXT`,
    `ALTER TABLE assistant_dev_requests ADD COLUMN ai_impact TEXT`,
    `ALTER TABLE assistant_dev_requests ADD COLUMN ai_risk TEXT`,
    `ALTER TABLE assistant_dev_requests ADD COLUMN ai_effort TEXT`,
    `ALTER TABLE assistant_dev_requests ADD COLUMN suggested_files TEXT`,
    `ALTER TABLE assistant_dev_requests ADD COLUMN decision TEXT`,
    `ALTER TABLE assistant_dev_requests ADD COLUMN closed_at TEXT`,
  ]) { await run(col).catch(() => {}); }

  // ── Knowledge Base ────────────────────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS kb_articles (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    module     TEXT NOT NULL DEFAULT 'general',
    category   TEXT NOT NULL DEFAULT 'FAQ',
    title      TEXT NOT NULL,
    body       TEXT NOT NULL,
    keywords   TEXT,
    role_min   TEXT NOT NULL DEFAULT 'worker',
    active     INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 100,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`CREATE VIRTUAL TABLE IF NOT EXISTS kb_fts
    USING fts5(title, body, keywords, content='kb_articles', content_rowid='id')`).catch(() => {});
  await run(`CREATE TRIGGER IF NOT EXISTS kb_fts_insert AFTER INSERT ON kb_articles BEGIN
    INSERT INTO kb_fts(rowid,title,body,keywords) VALUES(new.id,new.title,new.body,COALESCE(new.keywords,''));
  END`).catch(() => {});
  await run(`CREATE TRIGGER IF NOT EXISTS kb_fts_delete AFTER DELETE ON kb_articles BEGIN
    INSERT INTO kb_fts(kb_fts,rowid,title,body,keywords) VALUES('delete',old.id,old.title,old.body,COALESCE(old.keywords,''));
  END`).catch(() => {});
  await run(`CREATE TRIGGER IF NOT EXISTS kb_fts_update AFTER UPDATE ON kb_articles BEGIN
    INSERT INTO kb_fts(kb_fts,rowid,title,body,keywords) VALUES('delete',old.id,old.title,old.body,COALESCE(old.keywords,''));
    INSERT INTO kb_fts(rowid,title,body,keywords) VALUES(new.id,new.title,new.body,COALESCE(new.keywords,''));
  END`).catch(() => {});
  try {
    const { seedKb } = require("./scripts/seed_kb");
    await seedKb();
    await run(`INSERT INTO kb_fts(kb_fts) VALUES('rebuild')`).catch(() => {});
  } catch (e) {
    console.error("[kb seed]", e.message);
  }
}

async function cleanupAssistantLogs() {
  const cutoff = `-${ASSISTANT_LOG_RETENTION_DAYS} days`;
  try {
    await run(
      `DELETE FROM assistant_feedback
       WHERE log_id IN (
         SELECT id FROM assistant_logs WHERE created_at < datetime('now','localtime',?)
       )`,
      [cutoff]
    );
    await run(
      `DELETE FROM assistant_logs
       WHERE created_at < datetime('now','localtime',?)`,
      [cutoff]
    );
  } catch (e) {
    console.error("[assistant cleanup]", e.message);
  }
}

// ── Request logger ───────────────────────────────────────────
app.use((req, _res, next) => {
  if (req.path.startsWith("/api"))
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ── Login ─────────────────────────────────────────────────────
app.post("/api/login", async (req, res) => {
  const loginId = ((req.body.email || req.body.username) || "").trim().toLowerCase();
  const { password } = req.body;
  if (!loginId || !password)
    return res.status(400).json({ error: "Мэдэлэл дутуу байна" });
  const user = await get(
    "SELECT * FROM users WHERE (LOWER(email)=? OR LOWER(username)=?) AND active=1 AND COALESCE(can_login,1)=1",
    [loginId, loginId]);
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: "И-мэйл эсвэл нууц үг буруу байна" });
  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role, full_name: user.full_name, permissions: user.permissions || null },
    JWT_SECRET, { expiresIn: "12h" });
  res.json({
    token,
    user: { id: user.id, username: user.username, full_name: user.full_name,
            role: user.role, position: user.position, department: user.department, email: user.email,
            permissions: user.permissions || null }
  });
});

// ── Forgot password ───────────────────────────────────────────
app.post("/api/forgot-password", async (req, res) => {
  const email = ((req.body.email) || "").trim().toLowerCase();
  if (!email) return res.status(400).json({ error: "И-мэйл хаяг оруулна уу" });
  const user = await get("SELECT * FROM users WHERE LOWER(email)=? AND active=1 AND COALESCE(can_login,1)=1", [email]);
  if (!user) return res.json({ ok: true }); // don't reveal existence
  const token   = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 3_600_000).toISOString();
  await run("DELETE FROM password_reset_tokens WHERE user_id=?", [user.id]);
  await run("INSERT INTO password_reset_tokens(user_id,token,expires_at) VALUES(?,?,?)",
    [user.id, token, expires]);
  const resetLink = `${APP_URL}/?reset_token=${token}`;
  let sent = false;
  if (mailer) {
    try {
      await mailer.sendMail({
        from: EMAIL_FROM, to: user.email,
        subject: "Нууц үг сэргээх — Чойбалсан хөгжил ERP",
        html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
          <h2 style="color:#1d2d4a">Нууц үг сэргээх</h2>
          <p>Сайн байна уу, <b>${user.full_name}</b>!</p>
          <p style="margin:24px 0">
            <a href="${resetLink}" style="padding:12px 28px;background:#2563eb;color:#fff;border-radius:8px;text-decoration:none;font-weight:700">
              Нууц үг сэргээх
            </a>
          </p>
          <p style="color:#888;font-size:12px">Холбоос 1 цагийн дотор хүчинтэй.</p>
        </div>`
      });
      sent = true;
    } catch(e) { console.error("[SMTP]", e.message); }
  }
  const resp = { ok: true };
  if (!sent) { console.log(`[RESET] ${user.email}: ${resetLink}`); resp.debug_link = resetLink; }
  res.json(resp);
});

// ── Reset password ────────────────────────────────────────────
app.post("/api/reset-password", async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password || password.length < 8)
    return res.status(400).json({ error: "Нууц үг хамгийн багадаа 8 тэмдэгт байх ёстой" });
  const rec = await get(
    "SELECT * FROM password_reset_tokens WHERE token=? AND expires_at > CURRENT_TIMESTAMP", [token]);
  if (!rec)
    return res.status(400).json({ error: "Холбоос хугацаа дууссан эсвэл буруу байна" });
  await run("UPDATE users SET password_hash=? WHERE id=?",
    [bcrypt.hashSync(password, 10), rec.user_id]);
  await run("DELETE FROM password_reset_tokens WHERE user_id=?", [rec.user_id]);
  res.json({ ok: true });
});

app.get("/api/public-base-url", (_req, res) => {
  res.json({ baseUrl: lanBaseUrl() });
});

// ── Route modules ─────────────────────────────────────────────
app.use("/api", require("./routes/assets"));
app.use("/api", require("./routes/operations"));
app.use("/api", require("./routes/warehouse"));
app.use("/api", require("./routes/hr"));
app.use("/api", require("./routes/documents"));
app.use("/api", require("./routes/safety"));
app.use("/api", require("./routes/finance"));
app.use("/api", require("./routes/nyarav"));
app.use("/api", require("./routes/admin_hub"));
app.use("/api", require("./routes/smart_import"));
app.use("/api", require("./routes/vehicle"));
app.use("/api", require("./routes/reports"));
app.use("/api", require("./routes/assistant"));
app.use("/api", require("./routes/streetlights"));
app.use("/api", require("./routes/electricity"));
app.use("/api", require("./routes/lighting_schedule"));
app.use("/api", require("./routes/lora"));
app.use("/api", require("./routes/hr_extended"));

// ── SPA fallback (must be last) ───────────────────────────────
app.get("*", (_, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

initDb().then(() => {
  cleanupAssistantLogs();
  setInterval(cleanupAssistantLogs, 24 * 60 * 60 * 1000).unref();
  app.listen(APP_PORT, "0.0.0.0", () => {
    console.log(`Choibalsan internal app running: http://0.0.0.0:${APP_PORT}`);
  });
});
