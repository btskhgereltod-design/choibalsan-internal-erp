const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const APP_PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_THIS_SECRET_2026_CHOIBALSAN";
const DB_FILE = path.join(__dirname, "data", "app.db");
const UPLOAD_DIR = path.join(__dirname, "uploads");

fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use("/uploads", express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, "public")));

const db = new sqlite3.Database(DB_FILE);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
  });
}
function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
  });
}

async function initDb() {
  await run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL,
    position TEXT,
    register_no TEXT,
    address TEXT,
    phone TEXT,
    department TEXT,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS work_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    department TEXT,
    location TEXT,
    description TEXT,
    status TEXT DEFAULT 'Явцтай',
    progress INTEGER DEFAULT 0,
    assigned_to INTEGER,
    created_by INTEGER NOT NULL,
    work_date TEXT NOT NULL,
    start_date TEXT,
    end_date TEXT,
    start_time TEXT,
    end_time TEXT,
    cost_amount REAL DEFAULT 0,
    material_note TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(created_by) REFERENCES users(id),
    FOREIGN KEY(assigned_to) REFERENCES users(id)
  )`);

  await run(`ALTER TABLE work_logs ADD COLUMN start_date TEXT`).catch(() => {});
await run(`ALTER TABLE work_logs ADD COLUMN end_date TEXT`).catch(() => {});

  await run(`CREATE TABLE IF NOT EXISTS work_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    work_log_id INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    stamp_text TEXT,
    uploaded_by INTEGER NOT NULL,
    uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(work_log_id) REFERENCES work_logs(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS material_moves (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    move_type TEXT NOT NULL,
    item_name TEXT NOT NULL,
    qty REAL NOT NULL,
    unit TEXT,
    unit_price REAL DEFAULT 0,
    related_work_id INTEGER,
    receiver TEXT,
    note TEXT,
    created_by INTEGER NOT NULL,
    move_date TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    expense_date TEXT NOT NULL,
    type TEXT NOT NULL,
    amount REAL NOT NULL,
    related_work_id INTEGER,
    note TEXT,
    created_by INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS hr_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    record_type TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT,
    note TEXT,
    created_by INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_type TEXT NOT NULL,
    doc_no TEXT,
    doc_date TEXT NOT NULL,
    source_org TEXT,
    subject TEXT NOT NULL,
    assigned_to INTEGER,
    due_date TEXT,
    status TEXT DEFAULT 'Шинэ',
    decision TEXT,
    created_by INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS safety_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_date TEXT NOT NULL,
    title TEXT NOT NULL,
    risk_level TEXT NOT NULL,
    location TEXT,
    risk_description TEXT,
    action_taken TEXT,
    status TEXT DEFAULT 'Нээлттэй',
    created_by INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_type TEXT NOT NULL,
    year INTEGER NOT NULL,
    month INTEGER,
    title TEXT NOT NULL,
    department TEXT,
    budget REAL DEFAULT 0,
    status TEXT DEFAULT 'Төлөвлөсөн',
    created_by INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS plan_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    target_qty REAL DEFAULT 1,
    unit TEXT,
    estimated_cost REAL DEFAULT 0,
    responsible_user INTEGER,
    due_date TEXT,
    status TEXT DEFAULT 'Төлөвлөсөн',
    performance_percent INTEGER DEFAULT 0,
    note TEXT,
    FOREIGN KEY(plan_id) REFERENCES plans(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL,
    entity TEXT,
    entity_id INTEGER,
    detail TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

await run(`ALTER TABLE users ADD COLUMN register_no TEXT`).catch(()=>{});
await run(`ALTER TABLE users ADD COLUMN address TEXT`).catch(()=>{});


  const count = await get("SELECT COUNT(*) as c FROM users");
  if (count.c === 0) {
    const users = [
      ["director", "1234", "Батсүх Гэрэлт-Од", "director", "Захирал", "ПЮ80061073", "10-р баг 26-54 тоот", "99582070", "Захиргаа"],
      ["engineer", "1234", "Ганболд Билгүүн", "chief_engineer", "Ерөнхий инженер", "ЖЮ97050218", "6-р баг 25-55", "89961997", "Инженер"],
      ["hr", "1234", "Болд Ундраа", "hr", "Хүний нөөцийн ажилтан", "ЖЗ86061607", "6-р баг 70-23 тоот", "88304224", "Хүний нөөц"],
      ["safety", "1234", "Батболд Энхболор", "safety", "ХАБЭА-н ажилтан", "ЖЬ87121868", "8-р баг 58-49 тоот", "80824303", "ХАБЭА"],
      ["accountant", "1234", "Цэрэнжав Тунгалаг", "accountant", "Нягтлан бодогч", "ЖЯ81050100", "9-р баг 17-23", "99006010", "Санхүү"],
      ["network", "1234", "Балданпүрэв Мөнх-Эрдэнэ", "engineer", "Сүлжээний инженер", "ЖЯ94051213", "7-р баг 31-10 тоот", "99588085", "Камер"],
      ["electric", "1234", "Амаржаргал Цэлмэг", "engineer", "Цахилгааны инженер", "ТБ99121004", "10-р баг, зангиат 1-25", "80990144", "Цахилгаан"],
      ["store", "1234", "Дамдинжав Пүрэвсүрэн", "storekeeper", "Нярав", "ЖЛ82031809", "7-р баг Гарден 217-4", "91111762", "Аж ахуй"]
    ];
    for (const u of users) {
      await run(`INSERT INTO users(username,password_hash,full_name,role,position,register_no,address,phone,department)
        VALUES(?,?,?,?,?,?,?,?,?)`, [u[0], bcrypt.hashSync(u[1], 10), u[2], u[3], u[4], u[5], u[6], u[7], u[8]]);
    }
  }
}

function auth(req, res, next) {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Нэвтрэх шаардлагатай" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Token буруу байна" });
  }
}
function canSeeAll(role) {
  return ["director", "chief_engineer"].includes(role);
}
async function audit(userId, action, entity, entityId, detail) {
  await run("INSERT INTO audit_logs(user_id, action, entity, entity_id, detail) VALUES(?,?,?,?,?)",
    [userId, action, entity, entityId, detail || ""]);
}

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname || ".jpg");
    cb(null, Date.now() + "-" + Math.round(Math.random() * 1e9) + ext);
  }
});
const upload = multer({ storage });

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  const user = await get("SELECT * FROM users WHERE username=? AND active=1", [username]);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Username эсвэл код буруу" });
  }
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role, full_name: user.full_name }, JWT_SECRET, { expiresIn: "12h" });
  res.json({ token, user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role, position: user.position, department: user.department } });
});

app.get("/api/me", auth, async (req, res) => {
  const user = await get("SELECT id,username,full_name,role,position,department FROM users WHERE id=?", [req.user.id]);
  res.json(user);
});

app.get("/api/users", auth, async (_, res) => {
  res.json(await all("SELECT id,username,full_name,role,position,department,phone FROM users WHERE active=1 ORDER BY id"));
});

app.delete("/api/users/:id", auth, async (req, res) => {
  try {
    await run("UPDATE users SET active=0 WHERE id= ?", [req.params.id]);

    await audit(
      req.user.id,
      "DELETE",
      "users",
      req.params.id,
      "Ажилтан жагсаалтаас устгасан"
    );

    res.json({ ok: true });
  } catch (e) {
    console.log(e);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/users", auth, async (req, res) => {
  if (!["director","hr"].includes(req.user.role)) {
    return res.status(403).json({ error: "Эрх хүрэхгүй" });
  }

  const b = req.body;
  const username = b.username || ("emp" + Date.now());
  const password = b.password || "1234";

  const r = await run(`
    INSERT INTO users(
      username,password_hash,full_name,role,position,
      register_no,address,phone,department,active
    )
    VALUES(?,?,?,?,?,?,?,?,?,1)
  `, [
    username,
    bcrypt.hashSync(password, 10),
    b.full_name,
    b.role || "engineer",
    b.position || "",
    b.register_no || "",
    b.address || "",
    b.phone || "",
    b.department || ""
  ]);

  await audit(req.user.id, "CREATE", "users", r.id, b.full_name);
  res.json({ id: r.id });
});

app.put("/api/users/:id", auth, async (req, res) => {
  if (!["director","hr"].includes(req.user.role)) {
    return res.status(403).json({ error: "Эрх хүрэхгүй" });
  }

  const b = req.body;

  await run(`
    UPDATE users SET
      full_name=?,
      role=?,
      position=?,
      register_no=?,
      address=?,
      phone=?,
      department=?,
      active=?
    WHERE id=?
  `, [
    b.full_name,
    b.role || "engineer",
    b.position || "",
    b.register_no || "",
    b.address || "",
    b.phone || "",
    b.department || "",
    b.active ? 1 : 0,
    req.params.id
  ]);

  await audit(req.user.id, "UPDATE", "users", req.params.id, b.full_name);
  res.json({ ok: true });
});

app.delete("/api/users/:id", auth, async (req, res) => {
  if (!["director","hr"].includes(req.user.role)) {
    return res.status(403).json({ error: "Эрх хүрэхгүй" });
  }

  const user = await get("SELECT id FROM users WHERE id=?", [req.params.id]);
  if (!user) {
    return res.status(404).json({ error: "Ажилтан олдсонгүй" });
  }

  await run("UPDATE users SET active=0 WHERE id=?", [req.params.id]);
  await audit(req.user.id, "DEACTIVATE", "users", req.params.id, "Ажилтан идэвхгүй болгосон");
  res.json({ ok: true });
});

app.get("/api/work-logs", auth, async (req, res) => {
  const where = canSeeAll(req.user.role) ? "" : "WHERE w.created_by=? OR w.assigned_to=?";
  const params = canSeeAll(req.user.role) ? [] : [req.user.id, req.user.id];
  res.json(await all(`SELECT w.*, u.full_name created_name, a.full_name assigned_name,
    (SELECT COUNT(*) FROM work_photos p WHERE p.work_log_id=w.id) photo_count
    FROM work_logs w
    LEFT JOIN users u ON u.id=w.created_by
    LEFT JOIN users a ON a.id=w.assigned_to
    ${where}
    ORDER BY w.work_date DESC, w.id DESC`, params));
});

app.post("/api/work-logs", auth, async (req, res) => {
  const b = req.body;
  const r = await run(`INSERT INTO work_logs(title, category, department, location, description, status, progress, assigned_to, created_by, work_date, start_time, end_time, cost_amount, material_note)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [b.title, b.category, b.department, b.location, b.description, b.status || "Явцтай", b.progress || 0, b.assigned_to || null, req.user.id, b.work_date, b.start_time || null, b.end_time || null, b.cost_amount || 0, b.material_note || ""]);
  await audit(req.user.id, "CREATE", "work_logs", r.id, b.title);
  res.json({ id: r.id });
});

app.post("/api/work-logs/:id/photos", auth, upload.single("photo"), async (req, res) => {
  const work = await get("SELECT * FROM work_logs WHERE id=?", [req.params.id]);
  if (!work) return res.status(404).json({ error: "Ажил олдсонгүй" });
  const stamp = req.body.stamp_text || `${work.title} | ${work.location || ""} | ${new Date().toLocaleString("mn-MN")}`;
  const relative = "/uploads/" + req.file.filename;
  const r = await run(`INSERT INTO work_photos(work_log_id,file_path,stamp_text,uploaded_by) VALUES(?,?,?,?)`,
    [work.id, relative, stamp, req.user.id]);
  await audit(req.user.id, "UPLOAD_PHOTO", "work_photos", r.id, stamp);
  res.json({ id: r.id, file_path: relative });
});

app.get("/api/work-logs/:id/photos", auth, async (req, res) => {
  res.json(await all(`SELECT p.*, u.full_name uploaded_name FROM work_photos p LEFT JOIN users u ON u.id=p.uploaded_by WHERE work_log_id=? ORDER BY id DESC`, [req.params.id]));
});

app.post("/api/materials", auth, async (req, res) => {
  const b = req.body;
  const r = await run(`INSERT INTO material_moves(move_type,item_name,qty,unit,unit_price,related_work_id,receiver,note,created_by,move_date)
    VALUES(?,?,?,?,?,?,?,?,?,?)`, [b.move_type, b.item_name, b.qty, b.unit, b.unit_price || 0, b.related_work_id || null, b.receiver || "", b.note || "", req.user.id, b.move_date]);
  await audit(req.user.id, "CREATE", "material_moves", r.id, b.item_name);
  res.json({ id: r.id });
});
app.get("/api/materials", auth, async (_, res) => {
  res.json(await all("SELECT m.*, u.full_name created_name FROM material_moves m LEFT JOIN users u ON u.id=m.created_by ORDER BY move_date DESC, id DESC"));
});

app.post("/api/expenses", auth, async (req, res) => {
  const b = req.body;
  const r = await run(`INSERT INTO expenses(expense_date,type,amount,related_work_id,note,created_by) VALUES(?,?,?,?,?,?)`,
    [b.expense_date, b.type, b.amount, b.related_work_id || null, b.note || "", req.user.id]);
  await audit(req.user.id, "CREATE", "expenses", r.id, b.type);
  res.json({ id: r.id });
});
app.get("/api/expenses", auth, async (_, res) => {
  res.json(await all("SELECT e.*, u.full_name created_name FROM expenses e LEFT JOIN users u ON u.id=e.created_by ORDER BY expense_date DESC, id DESC"));
});

app.post("/api/hr-records", auth, async (req, res) => {
  const b = req.body;
  const r = await run(`INSERT INTO hr_records(user_id,record_type,start_date,end_date,note,created_by) VALUES(?,?,?,?,?,?)`,
    [b.user_id, b.record_type, b.start_date, b.end_date || null, b.note || "", req.user.id]);
  await audit(req.user.id, "CREATE", "hr_records", r.id, b.record_type);
  res.json({ id: r.id });
});
app.get("/api/hr-records", auth, async (_, res) => {
  res.json(await all(`SELECT h.*, u.full_name employee_name, c.full_name created_name
    FROM hr_records h LEFT JOIN users u ON u.id=h.user_id LEFT JOIN users c ON c.id=h.created_by
    ORDER BY start_date DESC, id DESC`));
});

app.post("/api/documents", auth, async (req, res) => {
  const b = req.body;
  const r = await run(`INSERT INTO documents(doc_type,doc_no,doc_date,source_org,subject,assigned_to,due_date,status,decision,created_by)
    VALUES(?,?,?,?,?,?,?,?,?,?)`, [b.doc_type, b.doc_no || "", b.doc_date, b.source_org || "", b.subject, b.assigned_to || null, b.due_date || null, b.status || "Шинэ", b.decision || "", req.user.id]);
  await audit(req.user.id, "CREATE", "documents", r.id, b.subject);
  res.json({ id: r.id });
});
app.get("/api/documents", auth, async (_, res) => {
  res.json(await all(`SELECT d.*, a.full_name assigned_name, c.full_name created_name
    FROM documents d LEFT JOIN users a ON a.id=d.assigned_to LEFT JOIN users c ON c.id=d.created_by
    ORDER BY doc_date DESC, id DESC`));
});

app.post("/api/safety-reports", auth, async (req, res) => {
  const b = req.body;
  const r = await run(`INSERT INTO safety_reports(report_date,title,risk_level,location,risk_description,action_taken,status,created_by)
    VALUES(?,?,?,?,?,?,?,?)`, [b.report_date, b.title, b.risk_level, b.location || "", b.risk_description || "", b.action_taken || "", b.status || "Нээлттэй", req.user.id]);
  await audit(req.user.id, "CREATE", "safety_reports", r.id, b.title);
  res.json({ id: r.id });
});
app.get("/api/safety-reports", auth, async (_, res) => {
  res.json(await all("SELECT s.*, u.full_name created_name FROM safety_reports s LEFT JOIN users u ON u.id=s.created_by ORDER BY report_date DESC, id DESC"));
});

app.post("/api/plans", auth, async (req, res) => {
  const b = req.body;
  const r = await run(`INSERT INTO plans(plan_type,year,month,title,department,budget,status,created_by) VALUES(?,?,?,?,?,?,?,?)`,
    [b.plan_type, b.year, b.month || null, b.title, b.department || "", b.budget || 0, b.status || "Төлөвлөсөн", req.user.id]);
  await audit(req.user.id, "CREATE", "plans", r.id, b.title);
  res.json({ id: r.id });
});
app.get("/api/plans", auth, async (_, res) => {
  res.json(await all("SELECT p.*, u.full_name created_name FROM plans p LEFT JOIN users u ON u.id=p.created_by ORDER BY year DESC, month DESC, id DESC"));
});

app.get("/api/reports/summary", auth, async (req, res) => {
  const year = Number(req.query.year || new Date().getFullYear());
  const month = req.query.month ? Number(req.query.month) : null;
  const start = month ? `${year}-${String(month).padStart(2,"0")}-01` : `${year}-01-01`;
  const endMonth = month ? month + 1 : 13;
  const endYear = endMonth === 13 ? year + 1 : year;
  const end = month ? `${endYear}-${String(endMonth).padStart(2,"0")}-01` : `${year + 1}-01-01`;

  const work = await get(`SELECT COUNT(*) count, SUM(cost_amount) total_cost, AVG(progress) avg_progress FROM work_logs WHERE work_date>=? AND work_date<?`, [start, end]);
  const expenses = await get(`SELECT COUNT(*) count, SUM(amount) total FROM expenses WHERE expense_date>=? AND expense_date<?`, [start, end]);
  const materials = await all(`SELECT item_name, SUM(CASE WHEN move_type='Орлого' THEN qty ELSE -qty END) balance FROM material_moves GROUP BY item_name ORDER BY item_name`);
  const byCategory = await all(`SELECT category, COUNT(*) count, SUM(cost_amount) cost FROM work_logs WHERE work_date>=? AND work_date<? GROUP BY category ORDER BY count DESC`, [start, end]);
  const hr = await all(`SELECT record_type, COUNT(*) count FROM hr_records WHERE start_date>=? AND start_date<? GROUP BY record_type`, [start, end]);
  const docs = await all(`SELECT status, COUNT(*) count FROM documents WHERE doc_date>=? AND doc_date<? GROUP BY status`, [start, end]);
  const safety = await all(`SELECT risk_level, COUNT(*) count FROM safety_reports WHERE report_date>=? AND report_date<? GROUP BY risk_level`, [start, end]);

  res.json({ period: { year, month }, work, expenses, materials, byCategory, hr, docs, safety });
});

app.get("/api/reports/annual-plan-suggestion", auth, async (req, res) => {
  const baseYear = Number(req.query.baseYear || new Date().getFullYear());
  const rows = await all(`SELECT category, department, COUNT(*) work_count, SUM(cost_amount) total_cost, AVG(cost_amount) avg_cost
    FROM work_logs WHERE work_date>=? AND work_date<? GROUP BY category, department ORDER BY work_count DESC`,
    [`${baseYear}-01-01`, `${baseYear+1}-01-01`]);
  const suggestions = rows.map(r => ({
    title: `${r.department || "Ерөнхий"} - ${r.category} чиглэлийн давтамжит ажил`,
    reason: `${baseYear} онд ${r.work_count} удаа бүртгэгдсэн.`,
    estimated_budget: Math.round((r.total_cost || 0) * 1.12),
    suggested_frequency: r.work_count > 20 ? "Сар бүр" : r.work_count > 6 ? "Улирал бүр" : "Шаардлагатай үед"
  }));
  res.json({ baseYear, targetYear: baseYear + 1, suggestions });
});

app.get("/api/audit-logs", auth, async (req, res) => {
  if (req.user.role !== "director") return res.status(403).json({ error: "Зөвхөн захирал харна" });
  res.json(await all("SELECT a.*, u.full_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 300"));
});

app.get("*", (_, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

initDb().then(() => {
  app.listen(APP_PORT, "0.0.0.0", () => {
    console.log(`Choibalsan internal app running: http://0.0.0.0:${APP_PORT}`);
  });
});

app.post("/api/users", auth, async (req, res) => {
  try {
    const {
      full_name,
      position,
      department,
      register_no,
      phone,
      address,
      role
    } = req.body;

    const username =
      full_name.toLowerCase().replaceAll(" ", "") + Date.now();

    await run(
      `INSERT INTO users
      (username,password,full_name,role,position,department,phone,register_no,address,active)
      VALUES (?,?,?,?,?,?,?,?,?,1)`,
      [
        username,
        "123456",
        full_name,
        role,
        position,
        department,
        phone,
        register_no,
        address
      ]
    );

    res.json({ ok: true });
  } catch (e) {
    console.log(e);
    res.status(500).json({ error: e.message });
  }
});