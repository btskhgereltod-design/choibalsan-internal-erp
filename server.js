require("express-async-errors");
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
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET is required. Configure it in .env.");
const UPLOAD_DIR = path.join(__dirname, "uploads");
const APP_URL    = process.env.APP_URL    || `http://localhost:${APP_PORT}`;
const EMAIL_FROM = process.env.EMAIL_FROM || '"Чойбалсан хөгжил ERP" <choibalsankhugjil@gmail.com>';
const ASSISTANT_LOG_RETENTION_DAYS = Math.max(7, Number(process.env.ASSISTANT_LOG_RETENTION_DAYS || 180));

fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// db.js opens the SQLite connection — require after directories exist
const { run, all, get, auth, upload } = require("./db");
const { saveLightingDailySnapshot } = require("./services/lighting_snapshots");
const { saveCameraDailySnapshot } = require("./services/camera_snapshots");
const { startCronJobs } = require("./services/cron");
const { reconcileIotLighting } = require("./services/iot_recovery");

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
app.use(express.static(path.join(__dirname, "public"), {
  index: false,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".html")) {
      // HTML хуучирахгүй байлгах — Cloudflare болон browser кэшлэхгүй
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Surrogate-Control", "no-store");
    } else if (filePath.endsWith(".js") || filePath.endsWith(".css")) {
      // JS/CSS-д version query байгаа тул browser кэшлэж болно, Cloudflare кэшлэхгүй
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Surrogate-Control", "no-store");
    }
  }
}));

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
    avatar_url    TEXT,
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
  await run(`ALTER TABLE users ADD COLUMN work_condition     TEXT`).catch(() => {});
  await run(`ALTER TABLE users ADD COLUMN birthdate          TEXT`).catch(() => {});
  await run(`ALTER TABLE users ADD COLUMN nationality        TEXT DEFAULT 'Монгол'`).catch(() => {});
  await run(`ALTER TABLE users ADD COLUMN emergency_contact  TEXT`).catch(() => {});
  await run(`ALTER TABLE users ADD COLUMN permissions        TEXT`).catch(() => {});
  await run(`ALTER TABLE users ADD COLUMN can_login          INTEGER DEFAULT 1`).catch(() => {});
  await run(`ALTER TABLE users ADD COLUMN avatar_url         TEXT`).catch(() => {});

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
  await run(`ALTER TABLE asset_events ADD COLUMN asset_ids       TEXT DEFAULT '[]'`).catch(() => {});
  await run(`ALTER TABLE asset_events ADD COLUMN asset_code      TEXT`).catch(() => {});
  await run(`ALTER TABLE asset_events ADD COLUMN confirm_status     TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE asset_events ADD COLUMN confirmed_by       INTEGER`).catch(() => {});
  await run(`ALTER TABLE asset_events ADD COLUMN confirmed_at       TEXT`).catch(() => {});
  await run(`ALTER TABLE asset_events ADD COLUMN reject_note        TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE asset_events ADD COLUMN confirm_note       TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE asset_events ADD COLUMN confirm_image_url  TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE asset_events ADD COLUMN confirm_signature_code TEXT DEFAULT ''`).catch(() => {});
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
  await run(`ALTER TABLE asset_events ADD COLUMN habea_post_signature_code TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE asset_events ADD COLUMN submitted_by       INTEGER`).catch(() => {});
  await run(`ALTER TABLE asset_events ADD COLUMN submitted_at       TEXT`).catch(() => {});
  await run(`ALTER TABLE asset_events ADD COLUMN submit_note        TEXT DEFAULT ''`).catch(() => {});

  await run(`CREATE TABLE IF NOT EXISTS engineer_monthly_reports (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    year            INTEGER NOT NULL,
    month           INTEGER NOT NULL,
    summary_note    TEXT DEFAULT '',
    issue_note      TEXT DEFAULT '',
    resource_note   TEXT DEFAULT '',
    next_plan_note  TEXT DEFAULT '',
    conclusion_note TEXT DEFAULT '',
    created_by      INTEGER NOT NULL,
    updated_by      INTEGER,
    created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at      TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(year, month, created_by),
    FOREIGN KEY(created_by) REFERENCES users(id),
    FOREIGN KEY(updated_by) REFERENCES users(id)
  )`);

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

  // Parent work progress is always the rounded average of its executions.
  await run(`UPDATE asset_events
    SET progress = COALESCE((
      SELECT ROUND(AVG(CASE
        WHEN e.progress < 0 THEN 0
        WHEN e.progress > 100 THEN 100
        ELSE e.progress
      END))
      FROM work_executions e
      WHERE e.work_log_id = asset_events.id
    ), 0)`);

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

  await run(`CREATE TABLE IF NOT EXISTS work_planned_materials (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    work_log_id INTEGER NOT NULL,
    material_id INTEGER NOT NULL,
    qty         REAL NOT NULL DEFAULT 0,
    unit        TEXT DEFAULT '',
    unit_price  REAL DEFAULT 0,
    note        TEXT DEFAULT '',
    status      TEXT DEFAULT 'Төлөвлөсөн',
    created_by  INTEGER,
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(work_log_id) REFERENCES asset_events(id),
    FOREIGN KEY(material_id) REFERENCES wh_materials(id),
    FOREIGN KEY(created_by) REFERENCES users(id)
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
    work_hours  REAL,
    leave_hours REAL,
    overtime_hours REAL,
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

  await run(`ALTER TABLE correspondence ADD COLUMN ai_summary TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE correspondence ADD COLUMN response_draft TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE correspondence ADD COLUMN response_type TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE correspondence ADD COLUMN response_sent_at TEXT DEFAULT ''`).catch(() => {});

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

  await run(`CREATE TABLE IF NOT EXISTS hse_report_snapshots (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    period_type  TEXT NOT NULL,
    year         INTEGER NOT NULL,
    month        INTEGER,
    title        TEXT NOT NULL,
    data_json    TEXT NOT NULL,
    source       TEXT DEFAULT 'manual',
    status       TEXT DEFAULT 'draft',
    created_by   INTEGER NOT NULL,
    created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at   TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(period_type, year, month)
  )`).catch(() => {});
  await run(`ALTER TABLE hse_report_snapshots ADD COLUMN source TEXT DEFAULT 'manual'`).catch(() => {});
  await run(`ALTER TABLE hse_report_snapshots ADD COLUMN status TEXT DEFAULT 'draft'`).catch(() => {});

  // ── Vehicles & Maintenance ─────────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS safety_trainings (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    training_date     TEXT NOT NULL,
    title             TEXT NOT NULL,
    trainer           TEXT DEFAULT '',
    audience          TEXT DEFAULT '',
    participant_count INTEGER DEFAULT 0,
    topic             TEXT DEFAULT '',
    result_note       TEXT DEFAULT '',
    file_url          TEXT DEFAULT '',
    status            TEXT DEFAULT 'Төлөвлөсөн',
    created_by        INTEGER,
    created_at        TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at        TEXT DEFAULT CURRENT_TIMESTAMP
  )`).catch(() => {});
  await run(`ALTER TABLE safety_trainings ADD COLUMN file_url TEXT DEFAULT ''`).catch(() => {});

  await run(`CREATE TABLE IF NOT EXISTS safety_training_ack (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    training_id    INTEGER NOT NULL,
    user_id        INTEGER NOT NULL,
    acknowledged_at TEXT,
    signature_code TEXT DEFAULT '',
    note           TEXT DEFAULT '',
    created_at     TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(training_id, user_id),
    FOREIGN KEY(training_id) REFERENCES safety_trainings(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`).catch(() => {});

  await run(`CREATE TABLE IF NOT EXISTS safety_procedures (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_no        TEXT DEFAULT '',
    title         TEXT NOT NULL,
    category      TEXT DEFAULT '',
    approved_date TEXT DEFAULT '',
    owner         TEXT DEFAULT '',
    version       TEXT DEFAULT '1.0',
    status        TEXT DEFAULT 'Идэвхтэй',
    file_url      TEXT DEFAULT '',
    note          TEXT DEFAULT '',
    created_by    INTEGER,
    created_at    TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at    TEXT DEFAULT CURRENT_TIMESTAMP
  )`).catch(() => {});

  await run(`CREATE TABLE IF NOT EXISTS safety_instructions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    instruction_date TEXT NOT NULL,
    type             TEXT NOT NULL DEFAULT 'Ээлжит',
    title            TEXT NOT NULL,
    body             TEXT DEFAULT '',
    file_url         TEXT DEFAULT '',
    target_scope     TEXT DEFAULT 'all',
    status           TEXT DEFAULT 'Идэвхтэй',
    created_by       INTEGER,
    created_at       TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at       TEXT DEFAULT CURRENT_TIMESTAMP
  )`).catch(() => {});

  await run(`CREATE TABLE IF NOT EXISTS safety_instruction_ack (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    instruction_id INTEGER NOT NULL,
    user_id        INTEGER NOT NULL,
    acknowledged_at TEXT,
    signature_code TEXT DEFAULT '',
    note           TEXT DEFAULT '',
    created_at     TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(instruction_id, user_id),
    FOREIGN KEY(instruction_id) REFERENCES safety_instructions(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`).catch(() => {});

  await run(`CREATE TABLE IF NOT EXISTS safety_route_plans (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    route_date     TEXT NOT NULL,
    title          TEXT NOT NULL,
    route_type     TEXT DEFAULT '',
    start_point    TEXT DEFAULT '',
    end_point      TEXT DEFAULT '',
    vehicle        TEXT DEFAULT '',
    driver         TEXT DEFAULT '',
    workers        TEXT DEFAULT '',
    risk_points    TEXT DEFAULT '',
    control_note   TEXT DEFAULT '',
    status         TEXT DEFAULT 'Батлагдсан',
    created_by     INTEGER,
    created_at     TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at     TEXT DEFAULT CURRENT_TIMESTAMP
  )`).catch(() => {});

  await run(`CREATE TABLE IF NOT EXISTS safety_accidents (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    accident_date    TEXT NOT NULL,
    accident_time    TEXT DEFAULT '',
    location         TEXT DEFAULT '',
    employee_id      INTEGER,
    employee_name    TEXT DEFAULT '',
    accident_type    TEXT DEFAULT '',
    severity         TEXT DEFAULT '',
    injury           TEXT DEFAULT '',
    cause            TEXT DEFAULT '',
    witness          TEXT DEFAULT '',
    immediate_action TEXT DEFAULT '',
    commission_note  TEXT DEFAULT '',
    status           TEXT DEFAULT 'Нээлттэй',
    created_by       INTEGER,
    created_at       TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at       TEXT DEFAULT CURRENT_TIMESTAMP
  )`).catch(() => {});

  await run(`CREATE TABLE IF NOT EXISTS safety_occupational_diseases (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    detected_date   TEXT NOT NULL,
    employee_id     INTEGER,
    employee_name   TEXT DEFAULT '',
    position        TEXT DEFAULT '',
    department      TEXT DEFAULT '',
    exposure_factor TEXT DEFAULT '',
    diagnosis       TEXT DEFAULT '',
    medical_note    TEXT DEFAULT '',
    disability      TEXT DEFAULT '',
    work_limit      TEXT DEFAULT '',
    prevention_note TEXT DEFAULT '',
    status          TEXT DEFAULT 'Хяналтад',
    created_by      INTEGER,
    created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at      TEXT DEFAULT CURRENT_TIMESTAMP
  )`).catch(() => {});

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
    note       TEXT DEFAULT '',
    created_by INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`ALTER TABLE plans ADD COLUMN note TEXT DEFAULT ''`).catch(() => {});

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

  await run(`CREATE TABLE IF NOT EXISTS plan_files (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id     INTEGER NOT NULL,
    file_type   TEXT NOT NULL DEFAULT 'document',
    file_path   TEXT NOT NULL,
    file_name   TEXT DEFAULT '',
    note        TEXT DEFAULT '',
    uploaded_by INTEGER,
    uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(plan_id) REFERENCES plans(id),
    FOREIGN KEY(uploaded_by) REFERENCES users(id)
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

  await run(`CREATE TABLE IF NOT EXISTS notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    type       TEXT NOT NULL,
    title      TEXT NOT NULL,
    body       TEXT DEFAULT '',
    user_id    INTEGER,
    dedupe_key TEXT,
    is_read    INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`ALTER TABLE notifications ADD COLUMN dedupe_key TEXT`).catch(() => {});
  await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe ON notifications(dedupe_key) WHERE dedupe_key IS NOT NULL`).catch(() => {});

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

  await run(`CREATE TABLE IF NOT EXISTS work_todos (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    module        TEXT NOT NULL DEFAULT 'general',
    title         TEXT NOT NULL,
    note          TEXT DEFAULT '',
    assigned_to   INTEGER NOT NULL,
    assigned_by   INTEGER,
    work_date     TEXT NOT NULL,
    work_time     TEXT DEFAULT '',
    due_date      TEXT,
    todo_type     TEXT NOT NULL DEFAULT 'work',
    privacy       TEXT NOT NULL DEFAULT 'private',
    priority      TEXT NOT NULL DEFAULT 'normal',
    status        TEXT NOT NULL DEFAULT 'todo',
    created_by    INTEGER NOT NULL,
    completed_at  TEXT,
    created_at    TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at    TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(assigned_to) REFERENCES users(id),
    FOREIGN KEY(assigned_by) REFERENCES users(id),
    FOREIGN KEY(created_by)  REFERENCES users(id)
  )`);
  await run(`ALTER TABLE work_todos ADD COLUMN todo_type TEXT NOT NULL DEFAULT 'work'`).catch(() => {});
  await run(`ALTER TABLE work_todos ADD COLUMN privacy TEXT NOT NULL DEFAULT 'private'`).catch(() => {});
  await run(`ALTER TABLE work_todos ADD COLUMN work_time TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE work_todos ADD COLUMN work_end_time TEXT DEFAULT ''`).catch(() => {});
  await run(`CREATE TABLE IF NOT EXISTS work_todo_notes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    todo_id     INTEGER NOT NULL,
    user_id     INTEGER NOT NULL,
    note        TEXT NOT NULL,
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(todo_id) REFERENCES work_todos(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);
  await run(`CREATE INDEX IF NOT EXISTS idx_work_todos_module_month ON work_todos(module, work_date)`).catch(() => {});
  await run(`CREATE INDEX IF NOT EXISTS idx_work_todos_assigned ON work_todos(assigned_to, work_date)`).catch(() => {});

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
    unit          TEXT DEFAULT '',
    unit_price    REAL DEFAULT 0,
    amount        REAL DEFAULT 0,
    doc_no        TEXT DEFAULT '',
    supplier      TEXT DEFAULT '',
    received_by   TEXT DEFAULT '',
    work_ref      TEXT DEFAULT '',
    asset_ref     TEXT DEFAULT '',
    work_log_id   INTEGER,
    notes         TEXT DEFAULT '',
    created_by    INTEGER,
    created_at    TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`ALTER TABLE wh_transactions ADD COLUMN unit TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE wh_transactions ADD COLUMN work_log_id INTEGER`).catch(() => {});
  await run(`ALTER TABLE wh_materials ADD COLUMN min_qty REAL DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE wh_materials ADD COLUMN custodian TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE assets ADD COLUMN bag_no INTEGER`).catch(() => {});
  await run(`ALTER TABLE assets ADD COLUMN camera_count INTEGER DEFAULT 1`).catch(() => {});
  await run(`ALTER TABLE assets ADD COLUMN camera_broken_count INTEGER DEFAULT 0`).catch(() => {});

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

  await run(`CREATE TABLE IF NOT EXISTS legal_filter_runs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_name       TEXT NOT NULL,
    source_type    TEXT DEFAULT 'text',
    source_ref     TEXT DEFAULT '',
    file_url       TEXT DEFAULT '',
    file_name      TEXT DEFAULT '',
    input_text     TEXT DEFAULT '',
    summary        TEXT DEFAULT '',
    result_json    TEXT DEFAULT '[]',
    risk_count     INTEGER DEFAULT 0,
    conflict_count INTEGER DEFAULT 0,
    unclear_count  INTEGER DEFAULT 0,
    duplicate_count INTEGER DEFAULT 0,
    suggestion_count INTEGER DEFAULT 0,
    status         TEXT DEFAULT 'Шинжилсэн',
    created_by     INTEGER NOT NULL,
    created_at     TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(created_by) REFERENCES users(id)
  )`);
  await run(`ALTER TABLE legal_filter_runs ADD COLUMN improved INTEGER DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE legal_filter_runs ADD COLUMN status TEXT DEFAULT 'Шинэ'`).catch(() => {});

  // Add status column to hr_records for leave approval tracking
  await run(`ALTER TABLE hr_records ADD COLUMN status TEXT DEFAULT 'Бүртгэсэн'`).catch(() => {});
  await run(`ALTER TABLE hr_records ADD COLUMN work_hours REAL`).catch(() => {});
  await run(`ALTER TABLE hr_records ADD COLUMN leave_hours REAL`).catch(() => {});
  await run(`ALTER TABLE hr_records ADD COLUMN overtime_hours REAL`).catch(() => {});
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
  await run(`ALTER TABLE cash_journal ADD COLUMN imported_balance REAL`).catch(() => {});

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

  await run(`CREATE TABLE IF NOT EXISTS iot_meter_readings (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    dev_eui          TEXT NOT NULL,
    device_name      TEXT,
    application_name TEXT,
    voltage          REAL,
    current          REAL,
    power            REAL,
    energy           REAL,
    frequency        REAL,
    power_factor     REAL,
    ua               REAL,
    ub               REAL,
    uc               REAL,
    ia               REAL,
    ib               REAL,
    ic               REAL,
    total_power      REAL,
    ep               REAL,
    pf               REAL,
    do_state         TEXT,
    di_state         TEXT,
    rssi             REAL,
    snr              REAL,
    gateway_id       TEXT,
    raw_payload      TEXT NOT NULL,
    received_at      TEXT NOT NULL,
    created_at       TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`ALTER TABLE iot_meter_readings ADD COLUMN ua REAL`).catch(() => {});
  await run(`ALTER TABLE iot_meter_readings ADD COLUMN ub REAL`).catch(() => {});
  await run(`ALTER TABLE iot_meter_readings ADD COLUMN uc REAL`).catch(() => {});
  await run(`ALTER TABLE iot_meter_readings ADD COLUMN ia REAL`).catch(() => {});
  await run(`ALTER TABLE iot_meter_readings ADD COLUMN ib REAL`).catch(() => {});
  await run(`ALTER TABLE iot_meter_readings ADD COLUMN ic REAL`).catch(() => {});
  await run(`ALTER TABLE iot_meter_readings ADD COLUMN total_power REAL`).catch(() => {});
  await run(`ALTER TABLE iot_meter_readings ADD COLUMN ep REAL`).catch(() => {});
  await run(`ALTER TABLE iot_meter_readings ADD COLUMN pf REAL`).catch(() => {});
  await run(`CREATE INDEX IF NOT EXISTS idx_iot_meter_readings_dev_seen
             ON iot_meter_readings(dev_eui, received_at DESC, id DESC)`).catch(() => {});

  await run(`CREATE TABLE IF NOT EXISTS iot_audit_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    dev_eui    TEXT,
    payload    TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    source     TEXT NOT NULL DEFAULT 'chirpstack_http_integration'
  )`);
  await run(`CREATE INDEX IF NOT EXISTS idx_iot_audit_logs_dev_created
             ON iot_audit_logs(dev_eui, created_at DESC)`).catch(() => {});
  await run(`CREATE TRIGGER IF NOT EXISTS trg_iot_audit_logs_no_update
             BEFORE UPDATE ON iot_audit_logs
             BEGIN
               SELECT RAISE(ABORT, 'iot_audit_logs is immutable');
             END`).catch(() => {});
  await run(`CREATE TRIGGER IF NOT EXISTS trg_iot_audit_logs_no_delete
             BEFORE DELETE ON iot_audit_logs
             BEGIN
               SELECT RAISE(ABORT, 'iot_audit_logs is immutable');
             END`).catch(() => {});

  await run(`CREATE TABLE IF NOT EXISTS iot_device_commands (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    dev_eui             TEXT NOT NULL,
    device_model        TEXT,
    action              TEXT NOT NULL,
    f_port              INTEGER NOT NULL,
    payload_hex         TEXT NOT NULL,
    status              TEXT NOT NULL,
    chirpstack_response TEXT,
    txack_response      TEXT,
    ack_response        TEXT,
    requested_by        INTEGER,
    requested_by_role   TEXT,
    requested_at        TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`ALTER TABLE iot_device_commands ADD COLUMN device_model TEXT`).catch(() => {});
  await run(`ALTER TABLE iot_device_commands ADD COLUMN txack_response TEXT`).catch(() => {});
  await run(`ALTER TABLE iot_device_commands ADD COLUMN ack_response TEXT`).catch(() => {});
  await run(`ALTER TABLE iot_device_commands ADD COLUMN requested_by INTEGER`).catch(() => {});
  await run(`ALTER TABLE iot_device_commands ADD COLUMN requested_by_role TEXT`).catch(() => {});
  await run(`CREATE INDEX IF NOT EXISTS idx_iot_device_commands_dev_requested
             ON iot_device_commands(dev_eui, requested_at DESC, id DESC)`).catch(() => {});

  await run(`CREATE TABLE IF NOT EXISTS iot_device_settings (
    dev_eui             TEXT PRIMARY KEY,
    auto_mode           INTEGER NOT NULL DEFAULT 1,
    updated_by          INTEGER,
    updated_at          TEXT DEFAULT CURRENT_TIMESTAMP,
    maintenance_mode    INTEGER NOT NULL DEFAULT 0,
    maintenance_reason  TEXT,
    maintenance_by      INTEGER,
    maintenance_at      TEXT
  )`);
  await run(`ALTER TABLE iot_device_settings ADD COLUMN updated_by INTEGER`).catch(() => {});
  await run(`ALTER TABLE iot_device_settings ADD COLUMN updated_at TEXT DEFAULT CURRENT_TIMESTAMP`).catch(() => {});
  await run(`ALTER TABLE iot_device_settings ADD COLUMN manual_off_reason TEXT`).catch(() => {});
  await run(`ALTER TABLE iot_device_settings ADD COLUMN manual_off_note TEXT`).catch(() => {});
  await run(`ALTER TABLE iot_device_settings ADD COLUMN manual_off_by INTEGER`).catch(() => {});
  await run(`ALTER TABLE iot_device_settings ADD COLUMN manual_off_at TEXT`).catch(() => {});
  await run(`ALTER TABLE iot_device_settings ADD COLUMN maintenance_mode INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE iot_device_settings ADD COLUMN maintenance_reason TEXT`).catch(() => {});
  await run(`ALTER TABLE iot_device_settings ADD COLUMN maintenance_by INTEGER`).catch(() => {});
  await run(`ALTER TABLE iot_device_settings ADD COLUMN maintenance_at TEXT`).catch(() => {});

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

  await run(`CREATE TABLE IF NOT EXISTS public_contents (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    section      TEXT NOT NULL DEFAULT 'news',
    content_key  TEXT DEFAULT '',
    title        TEXT NOT NULL,
    body         TEXT DEFAULT '',
    image_url    TEXT DEFAULT '',
    link_url     TEXT DEFAULT '',
    sort_order   INTEGER DEFAULT 99,
    published    INTEGER DEFAULT 1,
    created_by   INTEGER,
    updated_by   INTEGER,
    created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at   TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`CREATE INDEX IF NOT EXISTS idx_public_contents_section
             ON public_contents(section, published, sort_order, id)`).catch(() => {});

  await run(`CREATE TABLE IF NOT EXISTS public_hazard_reports (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_name   TEXT DEFAULT '',
    reporter_phone  TEXT DEFAULT '',
    location        TEXT NOT NULL,
    hazard_type     TEXT DEFAULT '',
    description     TEXT NOT NULL,
    status          TEXT DEFAULT 'Шинэ',
    source          TEXT DEFAULT 'public_site',
    tracking_code   TEXT DEFAULT '',
    image_url       TEXT DEFAULT '',
    created_at      TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`ALTER TABLE public_hazard_reports ADD COLUMN tracking_code TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE public_hazard_reports ADD COLUMN image_url TEXT DEFAULT ''`).catch(() => {});
  await run(`UPDATE public_hazard_reports
             SET tracking_code='CHD-OLD-' || printf('%06d', id)
             WHERE tracking_code IS NULL OR tracking_code=''`).catch(() => {});
  await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_public_hazard_tracking
             ON public_hazard_reports(tracking_code)`).catch(() => {});
  await run(`CREATE INDEX IF NOT EXISTS idx_public_hazard_reports_status
             ON public_hazard_reports(status, created_at DESC)`).catch(() => {});

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
    material_url TEXT DEFAULT '',
    description TEXT DEFAULT '',
    status      TEXT DEFAULT 'Төлөвлөгдсөн',
    created_by  INTEGER,
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`ALTER TABLE trainings ADD COLUMN material_url TEXT DEFAULT ''`).catch(() => {});

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
    bag_no            INTEGER,
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
    camera_count      INTEGER DEFAULT 1,
    camera_broken_count INTEGER DEFAULT 0,
    description       TEXT,
    specs             TEXT,
    notes             TEXT,
    created_by        INTEGER NOT NULL,
    created_at        TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at        TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(assigned_to) REFERENCES users(id),
    FOREIGN KEY(created_by)  REFERENCES users(id)
  )`);
  await run(`ALTER TABLE assets ADD COLUMN bag_no INTEGER`).catch(() => {});
  await run(`ALTER TABLE assets ADD COLUMN camera_count INTEGER DEFAULT 1`).catch(() => {});
  await run(`ALTER TABLE assets ADD COLUMN camera_broken_count INTEGER DEFAULT 0`).catch(() => {});

  const cameraBagBackfillRows = await all(
    `SELECT id,name,location FROM assets
     WHERE category='Камер' AND (bag_no IS NULL OR bag_no=0)`
  ).catch(() => []);
  for (const row of cameraBagBackfillRows) {
    const text = `${row.name || ""} ${row.location || ""}`.toLowerCase();
    const match = text.match(/(?:^|\D)(\d{1,2})\s*(?:-?\s*р|дугаар)?\s*баг\b/u);
    const bagNo = match ? Number(match[1]) : 0;
    if (bagNo >= 1 && bagNo <= 11) {
      await run("UPDATE assets SET bag_no=? WHERE id=?", [bagNo, row.id]).catch(() => {});
    }
  }

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

  await run(`CREATE TABLE IF NOT EXISTS fiber_routes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    route_type  TEXT DEFAULT '',
    core_count  INTEGER DEFAULT 0,
    color       TEXT DEFAULT '',
    status      TEXT DEFAULT 'Идэвхтэй',
    note        TEXT DEFAULT '',
    geojson     TEXT NOT NULL,
    length_m    REAL DEFAULT 0,
    created_by  INTEGER,
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(created_by) REFERENCES users(id)
  )`);
  await run(`ALTER TABLE fiber_routes ADD COLUMN core_count INTEGER DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE fiber_routes ADD COLUMN color TEXT DEFAULT ''`).catch(() => {});

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
    const initialPassword = process.env.INITIAL_USER_PASSWORD;
    if (!initialPassword || initialPassword.length < 12) {
      throw new Error("INITIAL_USER_PASSWORD (minimum 12 characters) is required when creating the first ERP users.");
    }
    const users = [
      ["director",   initialPassword, "Батсүх Гэрэлт-Од",        "director",      "Захирал",                 "ПЮ80061073", "10-р баг 26-54 тоот",    "99582070", "Захиргаа",   "btskhgereltod@gmail.com"],
      ["engineer",   initialPassword, "Ганболд Билгүүн",           "chief_engineer","Ерөнхий инженер",          "ЖЮ97050218", "6-р баг 25-55",          "89961997", "Инженер",    "engineer@choibalsan.mn"],
      ["hr",         initialPassword, "Болд Ундраа",               "hr",            "Хүний нөөцийн ажилтан",   "ЖЗ86061607", "6-р баг 70-23 тоот",     "88304224", "Хүний нөөц", "hr@choibalsan.mn"],
      ["safety",     initialPassword, "Батболд Энхболор",          "safety",        "ХАБЭА-н ажилтан",         "ЖЬ87121868", "8-р баг 58-49 тоот",     "80824303", "ХАБЭА",      "safety@choibalsan.mn"],
      ["accountant", initialPassword, "Цэрэнжав Тунгалаг",         "accountant",    "Нягтлан бодогч",          "ЖЯ81050100", "9-р баг 17-23",          "99006010", "Санхүү",     "accountant@choibalsan.mn"],
      ["network",    initialPassword, "Балданпүрэв Мөнх-Эрдэнэ",  "camera_engineer","Сүлжээний инженер",      "ЖЯ94051213", "7-р баг 31-10 тоот",     "99588085", "Камер",      "network@choibalsan.mn"],
      ["electric",   initialPassword, "Амаржаргал Цэлмэг",         "engineer",      "Цахилгааны инженер",      "ТБ99121004", "10-р баг, зангиат 1-25", "80990144", "Цахилгаан",  "electric@choibalsan.mn"],
      ["store",      initialPassword, "Дамдинжав Пүрэвсүрэн",     "storekeeper",   "Нярав",                   "ЖЛ82031809", "7-р баг Гарден 217-4",   "91111762", "Аж ахуй",    "store@choibalsan.mn"]
    ];
    for (const u of users) {
      await run(
        `INSERT INTO users(username,password_hash,full_name,role,position,register_no,address,phone,department,email)
         VALUES(?,?,?,?,?,?,?,?,?,?)`,
        [u[0], bcrypt.hashSync(u[1], 10), u[2], u[3], u[4], u[5], u[6], u[7], u[8], u[9]]);
    }
  }

  // ── Unified monthly report snapshots ─────────────────────
  await run(`CREATE TABLE IF NOT EXISTS unified_report_snapshots (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    year        INTEGER NOT NULL,
    month       INTEGER NOT NULL,
    title       TEXT,
    data_json   TEXT NOT NULL,
    created_by  INTEGER,
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(year, month)
  )`).catch(() => {});

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
  try { await run("ALTER TABLE sl_ger_inventory ADD COLUMN needs_poles INTEGER DEFAULT 0"); } catch(_) {}
  // Phase 2: Asset bridge — link sl_points and sl_ger_inventory to assets registry
  try { await run("ALTER TABLE sl_points ADD COLUMN asset_id INTEGER REFERENCES assets(id)"); } catch(_) {}
  try { await run("ALTER TABLE sl_ger_inventory ADD COLUMN asset_id INTEGER REFERENCES assets(id)"); } catch(_) {}
  try { await run("ALTER TABLE work_executions ADD COLUMN gps_lat REAL"); } catch(_) {}
  try { await run("ALTER TABLE work_executions ADD COLUMN gps_lng REAL"); } catch(_) {}

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

  await run(`CREATE TABLE IF NOT EXISTS sl_daily_status (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_date    TEXT NOT NULL,
    category         TEXT NOT NULL,
    total_count      INTEGER NOT NULL DEFAULT 0,
    broken_count     INTEGER NOT NULL DEFAULT 0,
    availability_pct REAL NOT NULL DEFAULT 100,
    fault_count      INTEGER NOT NULL DEFAULT 0,
    source           TEXT DEFAULT 'auto',
    created_at       TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at       TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(snapshot_date, category)
  )`);

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

  await run(`CREATE TABLE IF NOT EXISTS mcp_tool_audit (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER,
    role         TEXT NOT NULL DEFAULT '',
    tool_name    TEXT NOT NULL,
    query_params TEXT NOT NULL DEFAULT '{}',
    result_count INTEGER NOT NULL DEFAULT 0,
    success      INTEGER NOT NULL DEFAULT 0,
    error_code   TEXT,
    ip_address   TEXT,
    session_id   TEXT,
    duration_ms  INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);
  await run(`CREATE INDEX IF NOT EXISTS idx_mcp_tool_audit_created
             ON mcp_tool_audit(created_at)`).catch(() => {});
  await run(`CREATE INDEX IF NOT EXISTS idx_mcp_tool_audit_user_tool
             ON mcp_tool_audit(user_id,tool_name,created_at)`).catch(() => {});

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

  // ── Internal Chat ─────────────────────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS chat_messages (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id           INTEGER NOT NULL,
    recipient_id        INTEGER,
    message             TEXT,
    image_url           TEXT,
    tagged_work_log_id  INTEGER,
    tagged_execution_id INTEGER,
    created_at          TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(sender_id)    REFERENCES users(id),
    FOREIGN KEY(recipient_id) REFERENCES users(id)
  )`);
  await run(`CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at)`).catch(() => {});
  await run(`CREATE TABLE IF NOT EXISTS chat_message_reactions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    user_id    INTEGER NOT NULL,
    emoji      TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(message_id, user_id),
    FOREIGN KEY(message_id) REFERENCES chat_messages(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);
  await run(`CREATE INDEX IF NOT EXISTS idx_chat_reactions_message
             ON chat_message_reactions(message_id)`).catch(() => {});

  await run(`CREATE TABLE IF NOT EXISTS user_last_seen (
    user_id   INTEGER PRIMARY KEY,
    last_seen TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);
  const { runMigrations } = require("./db/migrate");
  await runMigrations({ run, all, get });
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
function compactPhone(value) {
  return String(value || "").replace(/\D/g, "");
}

app.post("/api/login", async (req, res) => {
  const loginRaw = ((req.body.email || req.body.username) || "").trim();
  const loginId = loginRaw.toLowerCase();
  const loginDigits = compactPhone(loginRaw);
  const { password } = req.body;
  if (!loginId || !password)
    return res.status(400).json({ error: "Мэдэлэл дутуу байна" });
  const user = await get(
    `SELECT * FROM users
     WHERE active=1 AND COALESCE(can_login,1)=1
       AND (
         LOWER(email)=?
         OR LOWER(username)=?
         OR REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(phone,''),' ',''),'-',''),'(',''),')',''),'+','')=?
       )`,
    [loginId, loginId, loginDigits]);
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: "Утасны дугаар эсвэл нууц үг буруу байна" });
  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role, full_name: user.full_name, permissions: user.permissions || null },
    JWT_SECRET, { expiresIn: "12h" });
  res.json({
    token,
    user: { id: user.id, username: user.username, full_name: user.full_name,
            role: user.role, position: user.position, department: user.department, email: user.email,
            avatar_url: user.avatar_url || null, permissions: user.permissions || null }
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
  const resetLink = `${APP_URL}/erp?reset_token=${token}`;
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

app.get("/api/public/home", async (_req, res) => {
  const safeCount = async (sql, params = []) => {
    try {
      const row = await get(sql, params);
      return Number(row?.count || 0);
    } catch (_e) {
      return 0;
    }
  };

  const safeRows = async (sql, params = []) => {
    try {
      return await all(sql, params);
    } catch (_e) {
      return [];
    }
  };

  const stats = {
    employees: await safeCount(`SELECT COUNT(*) count FROM users WHERE active=1`),
    lights: await safeCount(
      `SELECT COUNT(*) count FROM assets
       WHERE category LIKE '%гэрэл%' OR category LIKE '%Гэрэл%' OR sub_category LIKE '%гэрэл%' OR sub_category LIKE '%Гэрэл%'`
    ),
    cameras: await safeCount(
      `SELECT COALESCE(SUM(CASE WHEN camera_count IS NULL OR camera_count < 1 THEN 1 ELSE camera_count END), 0) count
       FROM assets
       WHERE category LIKE '%камер%' OR category LIKE '%Камер%' OR sub_category LIKE '%камер%' OR sub_category LIKE '%Камер%'`
    ),
    works: await safeCount(`SELECT COUNT(*) count FROM asset_events`),
    jobs: await safeCount(
      `SELECT COUNT(*) count FROM job_postings
       WHERE COALESCE(status,'Нээлттэй') NOT IN ('Хаасан','Цуцлагдсан')
         AND (deadline IS NULL OR deadline='' OR deadline>=date('now','localtime'))`
    ),
    documents: await safeCount(`SELECT COUNT(*) count FROM documents`)
  };
  stats.citizen_reports = await safeCount(`SELECT COUNT(*) count FROM public_hazard_reports`);
  const lighting = {
    poles: await safeCount(
      `SELECT COALESCE(SUM(lamp_count), 0) count FROM sl_points
       WHERE status='active' OR status='Идэвхтэй'`
    ),
    road_heads: await safeCount(
      `SELECT COALESCE(SUM(CASE WHEN total_heads > 0 THEN total_heads ELSE lamp_count END), 0) count
       FROM sl_points
       WHERE status='active' OR status='Идэвхтэй'`
    ),
    ger_heads: await safeCount(
      `SELECT COALESCE(SUM(total_count), 0) count
       FROM sl_ger_inventory
       WHERE category='Гэр хороолол' OR category='Гэр хорооллын гэрэл'`
    ),
    tower_heads: await safeCount(
      `SELECT COALESCE(SUM(total_count), 0) count
       FROM sl_ger_inventory
       WHERE category='Цамхаг' OR category='Цамхагийн гэрэл'`
    ),
    broken_heads: await safeCount(
      `SELECT COALESCE(SUM(broken_count), 0) count
       FROM sl_faults
       WHERE status!='Дууссан'`
    ),
    road_broken: await safeCount(
      `SELECT COALESCE(SUM(broken_count), 0) count FROM sl_faults
       WHERE status!='Дууссан' AND category='Авто замын гэрэл'`
    ),
    ger_broken: await safeCount(
      `SELECT COALESCE(SUM(broken_count), 0) count FROM sl_faults
       WHERE status!='Дууссан' AND category='Гэр хорооллын гэрэл'`
    ),
    tower_broken: await safeCount(
      `SELECT COALESCE(SUM(broken_count), 0) count FROM sl_faults
       WHERE status!='Дууссан' AND category='Цамхагийн гэрэл'`
    ),
    traffic_total: await safeCount(
      `SELECT COUNT(*) count FROM assets WHERE category='Гэрлэн дохио'`
    ),
    traffic_working: await safeCount(
      `SELECT COUNT(*) count FROM assets WHERE category='Гэрлэн дохио' AND status='Асаалтай'`
    )
  };
  lighting.total_heads = lighting.road_heads + lighting.ger_heads + lighting.tower_heads;
  lighting.working_heads = Math.max(0, lighting.total_heads - lighting.broken_heads);
  const availabilityPct = (total, broken) => total > 0
    ? Math.round((Math.max(0, total - broken) / total) * 1000) / 10
    : null;
  lighting.availability_pct = availabilityPct(lighting.total_heads, lighting.broken_heads);
  lighting.road_availability_pct = availabilityPct(lighting.road_heads, lighting.road_broken);
  lighting.ger_availability_pct = availabilityPct(lighting.ger_heads, lighting.ger_broken);
  lighting.tower_availability_pct = availabilityPct(lighting.tower_heads, lighting.tower_broken);
  lighting.traffic_availability_pct = availabilityPct(
    lighting.traffic_total,
    Math.max(0, lighting.traffic_total - lighting.traffic_working)
  );
  const hse = {
    open_public_reports: await safeCount(
      `SELECT COUNT(*) count FROM public_hazard_reports WHERE status!='Хаасан'`
    ),
    this_month_reports: await safeCount(
      `SELECT COUNT(*) count FROM public_hazard_reports
       WHERE substr(created_at,1,7)=strftime('%Y-%m','now','localtime')`
    ),
    internal_open_risks: await safeCount(
      `SELECT COUNT(*) count FROM safety_reports WHERE COALESCE(workflow_status,'Шинэ')!='Хаасан'`
    )
  };

  const contents = await safeRows(
    `SELECT id, section, content_key, title, body, image_url, link_url, sort_order, created_at, updated_at
     FROM public_contents
     WHERE published=1
     ORDER BY section, sort_order, id DESC`
  );
  const organization = Object.fromEntries((await safeRows(
    `SELECT key, value FROM org_settings
     WHERE key IN ('org_name','address','phone','email')`
  )).map(row => [row.key, row.value || ""]));

  const jobs = await safeRows(
    `SELECT id, title, department category, description, deadline date, created_at, 'job' type
     FROM job_postings
     WHERE COALESCE(status,'Нээлттэй') NOT IN ('Хаасан','Цуцлагдсан')
       AND (deadline IS NULL OR deadline='' OR deadline>=date('now','localtime'))
     ORDER BY COALESCE(deadline, created_at) DESC, id DESC
     LIMIT 3`
  );
  const contentNews = contents
    .filter(row => row.section === "news")
    .slice(0, 6)
    .map(row => ({
      id: row.id,
      title: row.title,
      category: "Мэдээ",
      description: row.body,
      date: row.updated_at || row.created_at,
      created_at: row.created_at,
      type: "news"
    }));

  const latest = [...contentNews, ...jobs]
    .sort((a, b) => String(b.date || b.created_at || "").localeCompare(String(a.date || a.created_at || "")))
    .slice(0, 6);

  res.json({ organization, stats, lighting, hse, contents, jobs, latest });
});

function publicTrackingCode() {
  const year = new Date().getFullYear();
  return `CHD-${year}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

app.post("/api/public/hazard-reports", upload.single("image"), async (req, res) => {
  const b = req.body || {};
  const location = String(b.location || "").trim();
  const description = String(b.description || "").trim();
  const removeRejectedFile = () => {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
  };
  if (req.file && !String(req.file.mimetype || "").startsWith("image/")) {
    removeRejectedFile();
    return res.status(400).json({ error: "Зөвхөн зураг файл хавсаргана уу" });
  }
  if (req.file && Number(req.file.size || 0) > 5 * 1024 * 1024) {
    removeRejectedFile();
    return res.status(400).json({ error: "Зургийн хэмжээ 5MB-аас бага байна" });
  }
  if (!location) {
    removeRejectedFile();
    return res.status(400).json({ error: "Байршил оруулна уу" });
  }
  if (!description) {
    removeRejectedFile();
    return res.status(400).json({ error: "Аюулын тайлбар оруулна уу" });
  }
  const trackingCode = publicTrackingCode();
  const imageUrl = req.file ? `/uploads/${req.file.filename}` : "";
  const result = await run(
    `INSERT INTO public_hazard_reports
      (reporter_name, reporter_phone, location, hazard_type, description, tracking_code, image_url)
     VALUES (?,?,?,?,?,?,?)`,
    [
      String(b.reporter_name || "").trim().slice(0, 120),
      String(b.reporter_phone || "").trim().slice(0, 40),
      location.slice(0, 240),
      String(b.hazard_type || "").trim().slice(0, 120),
      description.slice(0, 2000),
      trackingCode,
      imageUrl
    ]
  );
  res.json({ ok: true, id: result.id, tracking_code: trackingCode });
});

app.get("/api/public/hazard-reports/:trackingCode", async (req, res) => {
  const trackingCode = String(req.params.trackingCode || "").trim().toUpperCase();
  const row = await get(
    `SELECT tracking_code, hazard_type, location, status, created_at
     FROM public_hazard_reports WHERE tracking_code=?`,
    [trackingCode]
  );
  if (!row) return res.status(404).json({ error: "Мэдээлэл олдсонгүй" });
  res.json(row);
});

// ── Notifications ─────────────────────────────────────────────

app.get("/api/notifications", auth, async (req, res) => {
  const rows = await all(
    `SELECT * FROM notifications
     WHERE (user_id IS NULL OR user_id=?) AND is_read=0
     ORDER BY id DESC LIMIT 30`,
    [req.user.id]
  );
  res.json(rows);
});

app.patch("/api/notifications/:id/read", auth, async (req, res) => {
  await run("UPDATE notifications SET is_read=1 WHERE id=? AND (user_id IS NULL OR user_id=?)",
    [req.params.id, req.user.id]);
  res.json({ ok: true });
});

app.post("/api/notifications/read-all", auth, async (req, res) => {
  await run("UPDATE notifications SET is_read=1 WHERE user_id IS NULL OR user_id=?", [req.user.id]);
  res.json({ ok: true });
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
app.use("/api", require("./routes/iot"));
app.use("/api", require("./routes/hr_extended"));
app.use("/api", require("./routes/chat"));
app.use("/api", require("./routes/ai_test"));
app.use("/api", require("./routes/website"));
app.use("/api", require("./routes/public_portal"));
app.use("/api", require("./routes/ai_advisor"));
require("./services/mcp/server").installMcpRoutes(app);
// Public entry must stay separate from ERP login:
//   / and /portal -> citizen/public information site
//   /login and /erp -> internal ERP SPA
// Keep this protected with `npm run test:routes`.
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "public", "portal.html")));
app.get("/portal", (_req, res) => res.sendFile(path.join(__dirname, "public", "portal.html")));
app.get(["/login", "/erp"], (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

// ── /tools/code-export — ERP архитектур татах хуудас (director only) ─────────
app.get("/tools/code-export", (_req, res) => {
  res.send(`<!DOCTYPE html><html lang="mn"><head><meta charset="utf-8">
<title>ERP Архитектур татах</title>
<style>
  body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f5f5f5}
  .card{background:#fff;border-radius:12px;padding:40px 48px;box-shadow:0 2px 16px #0001;text-align:center;max-width:420px}
  h2{margin:0 0 8px;font-size:1.3rem}
  p{color:#666;margin:0 0 28px;font-size:.95rem}
  button{background:#1a56db;color:#fff;border:none;padding:14px 32px;border-radius:8px;font-size:1rem;cursor:pointer;width:100%}
  button:hover{background:#1447c0}
  button:disabled{background:#aaa;cursor:not-allowed}
  .msg{margin-top:16px;font-size:.9rem;color:#555}
  .err{color:#c0392b}
</style></head><body>
<div class="card">
  <h2>📦 ERP Архитектур татах</h2>
  <p>ChatGPT Project-д upload хийх <code>.md</code> файлыг бэлдэнэ.<br>Нэвтэрсэн байх шаардлагатай.</p>
  <button id="btn" onclick="dl()">Татах</button>
  <div class="msg" id="msg"></div>
</div>
<script>
async function dl(){
  const btn=document.getElementById('btn'), msg=document.getElementById('msg');
  const token=localStorage.getItem('token');
  if(!token){msg.innerHTML='<span class=err>ERP-д нэвтрээгүй байна. Эхлээд <a href="/login">нэвтрэх</a> хуудас руу орно уу.</span>';return;}
  btn.disabled=true; btn.textContent='Бэлдэж байна...'; msg.textContent='';
  try{
    const r=await fetch('/api/ai/code-export',{headers:{Authorization:'Bearer '+token}});
    if(!r.ok){const e=await r.json();msg.innerHTML='<span class=err>Алдаа: '+e.error+'</span>';btn.disabled=false;btn.textContent='Татах';return;}
    const blob=await r.blob();
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    const cd=r.headers.get('Content-Disposition')||'';
    const fn=cd.match(/filename="([^"]+)"/)?.[1]||'erp-architecture.md';
    a.href=url; a.download=fn; a.click();
    URL.revokeObjectURL(url);
    msg.textContent='✅ Татагдлаа! ChatGPT Project-д upload хийнэ үү.';
    btn.textContent='Дахин татах'; btn.disabled=false;
  }catch(e){msg.innerHTML='<span class=err>'+e.message+'</span>';btn.disabled=false;btn.textContent='Татах';}
}
</script></body></html>`);
});

// ── Global error handler ──────────────────────────────────────
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "public", "home.html")));
app.get(["/erp", "/erp/*"], (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.use((err, req, res, _next) => {
  console.error(`[server error] ${req.method} ${req.path}:`, err.message);
  if (res.headersSent) return;
  if (err?.name === "MulterError" || String(err?.message || "").includes("файлын төрөл")) {
    return res.status(400).json({ error: err.message || "Файл хүлээн авахад алдаа гарлаа" });
  }
  res.status(500).json({ error: "Серверийн алдаа гарлаа" });
});

// ── SPA fallback (must be last) ───────────────────────────────
app.get("*", (_, res) => res.sendFile(path.join(__dirname, "public", "home.html")));

function localDateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startDailySnapshotScheduler() {
  let lastLightingSnapshotDate = "";
  let lastCameraSnapshotDate = "";
  const capture = async (source = "daily_scheduler") => {
    const date = localDateKey();
    if (date !== lastLightingSnapshotDate || source !== "daily_scheduler") {
      await saveLightingDailySnapshot(date, source);
      lastLightingSnapshotDate = date;
    }
    if (date !== lastCameraSnapshotDate || source !== "daily_scheduler") {
      await saveCameraDailySnapshot(date, source);
      lastCameraSnapshotDate = date;
    }
  };
  capture("server_start").catch(e => console.warn("[snapshot] daily:", e.message));
  setInterval(() => {
    capture("daily_scheduler").catch(e => console.warn("[snapshot] daily:", e.message));
  }, 60 * 60 * 1000).unref();
}

process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});

initDb().then(async () => {
  cleanupAssistantLogs();
  startDailySnapshotScheduler();
  startCronJobs();
  setInterval(cleanupAssistantLogs, 24 * 60 * 60 * 1000).unref();
  try {
    const result = await reconcileIotLighting({ source: "startup" });
    if (result.attempted || result.failed) {
      console.log(`[startup] IoT recovery: checked=${result.checked} attempted=${result.attempted} failed=${result.failed}`);
    }
  } catch (e) {
    console.error("[startup] IoT recovery error:", e.message);
  }
  app.listen(APP_PORT, "0.0.0.0", () => {
    console.log(`Choibalsan internal app running: http://0.0.0.0:${APP_PORT}`);
  });
});
