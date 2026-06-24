# Migration System

## Товч танилцуулга

`server.js`-д байгаа 366 migration statement-ийг `db/migrations/` бүтэц рүү аюулгүй шилжүүлэх системийн 1-р алхам.

**Одоогийн байдал:** `server.js` migration block хэвээр ажилладаг. Энэ систем зэрэгцэн бэлтгэлийн горимд ажиллана.

---

## Файлын бүтэц

```
db/
├── migrate.js                  ← Runner + CLI + helpers
└── migrations/
    ├── 0017_skeleton.js        ← Шинэ migration-ийн загвар (rename before use)
    └── NNNN_module_name.js     ← Дараагийн migration-ууд энд
```

---

## CLI командууд

```bash
# Одоогийн production DB дээр baseline тохируулах (нэг удаа)
node db/migrate.js --baseline

# Одоогийн байдлыг шалгах
node db/migrate.js --status

# Pending migration-уудыг ажиллуулах (0017+)
node db/migrate.js
```

---

## Production-д cutover хийх дараалал

### Алхам 1 — Baseline (нэг удаа, production дээр)

```bash
# 1. Server ажиллаж байхад backup хий
cp data/app.db data/backups/app.db.pre-baseline-$(date +%Y%m%d-%H%M)

# 2. Baseline тохируулах (server ажиллаж байхад хийж болно)
node db/migrate.js --baseline

# 3. Шалгах
node db/migrate.js --status
# → 16 migration applied гэж харагдах ёстой
```

### Алхам 2 — Нэгтгэх (server.js migration block-ийг солих)

```javascript
// server.js initDb() дотор одоогийн 366 migration statement-ийн оронд:
const { runMigrations } = require("./db/migrate");
await runMigrations({ run, all, get });
```

Baseline хийсний дараа `runMigrations()` 0001–0016-г дахин ажиллуулахгүй — зөвхөн 0017+ ажиллана.

### Алхам 3 — Verification

```bash
node db/migrate.js --status
# → 16 baseline + шинэ migration-ууд харагдана
```

---

## Шинэ Migration бичих

`db/migrations/0017_skeleton.js`-г хуулж, өөрчил:

```javascript
module.exports = {
  version: "0017",           // дараагийн дугаар
  name:    "add_foo_table",  // тодорхой нэр
  module:  "operations",     // логик модуль

  async up({ run, tableExists, columnExists, indexExists }) {
    if (!await tableExists("foo")) {
      await run(`CREATE TABLE foo ( id INTEGER PRIMARY KEY ... )`);
    }
    if (!await columnExists("users", "foo_id")) {
      await run("ALTER TABLE users ADD COLUMN foo_id INTEGER");
    }
  },
};
```

**Дүрмүүд:**
- `.catch(() => {})` **ашиглахгүй** — helper ашигла
- `up()` нь error throw хийвэл server эхлэхгүй → migration амжилтгүй болсон
- `markApplied` нь `up()` амжилттай дууссаны дараа автоматаар дуудагдана
- Applied migration-г өөрчилж, устгаж болохгүй

---

## schema_migrations Table

```sql
CREATE TABLE schema_migrations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  version    TEXT NOT NULL UNIQUE,   -- "0001" … "0017" …
  name       TEXT NOT NULL,          -- "core_users", "streetlights" …
  module     TEXT NOT NULL,          -- бүлэглэлтийн нэр
  applied_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
```

Шалгах:
```sql
SELECT version, module, name, applied_at FROM schema_migrations ORDER BY version;
```

---

## Baseline болон 0001–0016-ийн тайлбар

`server.js`-д байгаа migration-ууд **idempotent** (`CREATE TABLE IF NOT EXISTS`, `.catch(() => {})`). Baseline нь тэдгээрийг дахин ажиллуулахгүйгээр "аль хэдийн хэрэгжсэн" гэж тэмдэглэнэ.

| Version | Module | Тайлбар |
|---|---|---|
| 0001 | core | users (22 col), hr_history, password_reset_tokens |
| 0002 | operations | asset_events (work_logs→), work_executions, photos |
| 0003 | safety | safety_reports (22 col), trainings, accidents |
| 0004 | vehicles | vehicles, daily/weekly/monthly inspections |
| 0005 | plans | plans, plan_items, plan_files |
| 0006 | finance | cash_journal (10 col), fixed_assets_ledger (25 col) |
| 0007 | warehouse | wh_materials, work_todos, material_moves |
| 0008 | assets | assets, asset_files, fiber_routes, inventory |
| 0009 | documents | correspondence (→renamed), archive_docs, legal_filter |
| 0010 | hr | employee_profiles, surveys, job_postings, trainings |
| 0011 | org | org_settings, org_contracts, notifications, audit_logs |
| 0012 | streetlights | sl_points (6 col), sl_network_routes (8 col), corridors |
| 0013 | meters | meter_points, electricity_bill_*, el_budget_plan |
| 0014 | iot | iot_meter_readings (9 col), lora_*, device_commands |
| 0015 | ai | assistant_logs, dev_requests (8 col), mcp_tool_audit |
| 0016 | chat | chat_messages, reactions, report_snapshots |
