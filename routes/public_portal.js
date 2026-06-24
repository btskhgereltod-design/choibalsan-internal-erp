const express = require("express");
const crypto = require("crypto");
const { run, all, get, auth, upload, audit } = require("../db");

const router = express.Router();

async function ensureCitizenReportTable() {
  await run(`CREATE TABLE IF NOT EXISTS citizen_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tracking_code TEXT UNIQUE NOT NULL,
    issue_type TEXT NOT NULL,
    location TEXT NOT NULL,
    description TEXT NOT NULL,
    citizen_name TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    image_url TEXT DEFAULT '',
    gps_lat REAL,
    gps_lng REAL,
    status TEXT DEFAULT 'new',
    priority TEXT DEFAULT 'normal',
    assigned_to INTEGER,
    work_log_id INTEGER,
    resolution_note TEXT DEFAULT '',
    before_image_url TEXT DEFAULT '',
    after_image_url TEXT DEFAULT '',
    publish_public INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    closed_at TEXT
  )`);
  await run(`ALTER TABLE citizen_reports ADD COLUMN priority TEXT DEFAULT 'normal'`).catch(() => {});
  await run(`ALTER TABLE citizen_reports ADD COLUMN assigned_to INTEGER`).catch(() => {});
  await run(`ALTER TABLE citizen_reports ADD COLUMN work_log_id INTEGER`).catch(() => {});
  await run(`ALTER TABLE citizen_reports ADD COLUMN resolution_note TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE citizen_reports ADD COLUMN before_image_url TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE citizen_reports ADD COLUMN after_image_url TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE citizen_reports ADD COLUMN publish_public INTEGER DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE citizen_reports ADD COLUMN closed_at TEXT`).catch(() => {});
}

async function ensurePublicAlertTable() {
  await run(`CREATE TABLE IF NOT EXISTS public_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    level TEXT DEFAULT 'warning',
    location TEXT DEFAULT '',
    image_url TEXT DEFAULT '',
    active INTEGER DEFAULT 1,
    starts_at TEXT,
    ends_at TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`ALTER TABLE public_alerts ADD COLUMN location TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE public_alerts ADD COLUMN image_url TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE public_alerts ADD COLUMN starts_at TEXT`).catch(() => {});
  await run(`ALTER TABLE public_alerts ADD COLUMN ends_at TEXT`).catch(() => {});
}

async function ensurePublicPostTable() {
  await run(`CREATE TABLE IF NOT EXISTS public_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_type TEXT DEFAULT 'news',
    title TEXT NOT NULL,
    summary TEXT DEFAULT '',
    body TEXT DEFAULT '',
    image_url TEXT DEFAULT '',
    published INTEGER DEFAULT 1,
    featured INTEGER DEFAULT 0,
    deadline TEXT,
    contact_phone TEXT DEFAULT '',
    contact_email TEXT DEFAULT '',
    created_by INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`ALTER TABLE public_posts ADD COLUMN post_type TEXT DEFAULT 'news'`).catch(() => {});
  await run(`ALTER TABLE public_posts ADD COLUMN summary TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE public_posts ADD COLUMN body TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE public_posts ADD COLUMN image_url TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE public_posts ADD COLUMN published INTEGER DEFAULT 1`).catch(() => {});
  await run(`ALTER TABLE public_posts ADD COLUMN featured INTEGER DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE public_posts ADD COLUMN deadline TEXT`).catch(() => {});
  await run(`ALTER TABLE public_posts ADD COLUMN contact_phone TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE public_posts ADD COLUMN contact_email TEXT DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE public_posts ADD COLUMN created_by INTEGER`).catch(() => {});
}

function canManagePublicAlerts(user) {
  return ["director", "chief_engineer", "safety"].includes(user?.role);
}

function canManagePublicPosts(user) {
  return ["director", "chief_engineer", "hr", "safety"].includes(user?.role);
}

function normalizeAlert(row) {
  return {
    ...row,
    active: Number(row.active || 0),
  };
}

function normalizePost(row) {
  return {
    ...row,
    published: Number(row.published || 0),
    featured: Number(row.featured || 0),
  };
}

function makeTrackingCode() {
  const year = new Date().getFullYear();
  const random = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `CHD-${year}-${random}`;
}

function normalizeReport(row) {
  return {
    ...row,
    gps_lat: row.gps_lat == null ? null : Number(row.gps_lat),
    gps_lng: row.gps_lng == null ? null : Number(row.gps_lng),
    publish_public: Number(row.publish_public || 0),
  };
}

router.get("/public-portal/summary", async (_req, res) => {
  await ensureCitizenReportTable();
  const [reports, done, active, empRow, poleRow, camRow] = await Promise.all([
    get("SELECT COUNT(*) count FROM citizen_reports"),
    get("SELECT COUNT(*) count FROM citizen_reports WHERE status='done'"),
    get("SELECT COUNT(*) count FROM citizen_reports WHERE status IN ('new','accepted','working')"),
    get("SELECT COUNT(*) count FROM users WHERE active=1 AND role<>'ai_readonly'"),
    get("SELECT COUNT(*) count FROM sl_points").catch(() => ({ count: 0 })),
    get("SELECT COALESCE(SUM(COALESCE(camera_count,1)),0) count FROM assets WHERE category='Камер'").catch(() => ({ count: 0 })),
  ]);
  res.json({
    services: 4,
    reports: Number(reports?.count || 0),
    done:    Number(done?.count    || 0),
    active:  Number(active?.count  || 0),
    employees: Number(empRow?.count  || 0),
    poles:     Number(poleRow?.count || 0),
    cameras:   Number(camRow?.count  || 0),
  });
});

router.get("/public-portal/reports/:code", async (req, res) => {
  await ensureCitizenReportTable();
  const row = await get(
    `SELECT tracking_code,issue_type,location,description,image_url,status,resolution_note,
            after_image_url,created_at,updated_at,closed_at
       FROM citizen_reports WHERE tracking_code=?`,
    [String(req.params.code || "").trim().toUpperCase()]
  );
  if (!row) return res.status(404).json({ error: "Мэдээлэл олдсонгүй" });
  res.json(normalizeReport(row));
});

router.get("/public-portal/completed", async (_req, res) => {
  await ensureCitizenReportTable();
  const rows = await all(
    `SELECT tracking_code,issue_type,location,resolution_note,after_image_url,closed_at,created_at
       FROM citizen_reports
      WHERE status='done' AND publish_public=1
      ORDER BY COALESCE(closed_at, updated_at) DESC
      LIMIT 12`
  );
  res.json(rows.map(normalizeReport));
});

router.get("/public-portal/posts", async (req, res) => {
  await ensurePublicPostTable();
  const type = String(req.query.type || "").trim();
  const params = [];
  let where = "WHERE published=1";
  if (type) {
    where += " AND post_type=?";
    params.push(type);
  }
  const rows = await all(
    `SELECT id,post_type,title,summary,body,image_url,featured,deadline,contact_phone,contact_email,created_at,updated_at
       FROM public_posts
       ${where}
      ORDER BY featured DESC, COALESCE(updated_at, created_at) DESC
      LIMIT 12`,
    params
  );
  res.json(rows.map(normalizePost));
});

router.get("/public-portal/alerts", async (_req, res) => {
  await ensurePublicAlertTable();
  const rows = await all(
    `SELECT id,title,body,level,location,image_url,starts_at,ends_at,created_at,updated_at
       FROM public_alerts
      WHERE active=1
        AND (starts_at IS NULL OR starts_at='' OR starts_at <= CURRENT_TIMESTAMP)
        AND (ends_at IS NULL OR ends_at='' OR ends_at >= CURRENT_TIMESTAMP)
      ORDER BY
        CASE level WHEN 'danger' THEN 1 WHEN 'warning' THEN 2 WHEN 'info' THEN 3 ELSE 4 END,
        updated_at DESC
      LIMIT 5`
  );
  res.json(rows.map(normalizeAlert));
});

router.post("/public-portal/reports", upload.single("image"), async (req, res) => {
  await ensureCitizenReportTable();
  const issueType = String(req.body.issue_type || "").trim();
  const location = String(req.body.location || "").trim();
  const description = String(req.body.description || "").trim();
  const citizenName = String(req.body.citizen_name || "").trim();
  const phone = String(req.body.phone || "").trim();
  const gpsLat = req.body.gps_lat === "" ? null : Number(req.body.gps_lat);
  const gpsLng = req.body.gps_lng === "" ? null : Number(req.body.gps_lng);
  if (!issueType || !location || !description) {
    return res.status(400).json({ error: "Гэмтлийн төрөл, байршил, тайлбарыг бөглөнө үү" });
  }
  if ((req.body.gps_lat || req.body.gps_lng) && (!Number.isFinite(gpsLat) || !Number.isFinite(gpsLng))) {
    return res.status(400).json({ error: "GPS координат буруу байна" });
  }
  let tracking = makeTrackingCode();
  for (let i = 0; i < 5; i++) {
    const exists = await get("SELECT id FROM citizen_reports WHERE tracking_code=?", [tracking]);
    if (!exists) break;
    tracking = makeTrackingCode();
  }
  const imageUrl = req.file ? `/uploads/${req.file.filename}` : "";
  await run(
    `INSERT INTO citizen_reports
      (tracking_code,issue_type,location,description,citizen_name,phone,image_url,gps_lat,gps_lng)
     VALUES(?,?,?,?,?,?,?,?,?)`,
    [tracking, issueType, location, description, citizenName, phone, imageUrl, gpsLat, gpsLng]
  );
  res.json({ ok: true, tracking_code: tracking });
});

router.get("/citizen-reports", auth, async (req, res) => {
  await ensureCitizenReportTable();
  const status = String(req.query.status || "").trim();
  const params = [];
  let where = "";
  if (status) {
    where = "WHERE r.status=?";
    params.push(status);
  }
  const rows = await all(
    `SELECT r.*, u.full_name assigned_name
       FROM citizen_reports r
       LEFT JOIN users u ON u.id=r.assigned_to
       ${where}
      ORDER BY r.created_at DESC
      LIMIT 200`,
    params
  );
  await audit(req.user.id, "VIEW", "citizen_reports", null, "citizen report list").catch(() => {});
  res.json(rows.map(normalizeReport));
});

router.get("/public-alerts", auth, async (req, res) => {
  if (!canManagePublicAlerts(req.user)) return res.status(403).json({ error: "Эрх хүрэлцэхгүй байна" });
  await ensurePublicAlertTable();
  const rows = await all(
    `SELECT a.*, u.full_name created_name
       FROM public_alerts a
       LEFT JOIN users u ON u.id=a.created_by
      ORDER BY a.active DESC, a.updated_at DESC
      LIMIT 100`
  );
  await audit(req.user.id, "VIEW", "public_alerts", null, "public alert list").catch(() => {});
  res.json(rows.map(normalizeAlert));
});

router.get("/public-posts", auth, async (req, res) => {
  if (!canManagePublicPosts(req.user)) return res.status(403).json({ error: "Эрх хүрэлцэхгүй байна" });
  await ensurePublicPostTable();
  const rows = await all(
    `SELECT p.*, u.full_name created_name
       FROM public_posts p
       LEFT JOIN users u ON u.id=p.created_by
      ORDER BY p.published DESC, p.updated_at DESC
      LIMIT 100`
  );
  await audit(req.user.id, "VIEW", "public_posts", null, "public post list").catch(() => {});
  res.json(rows.map(normalizePost));
});

router.post("/public-posts", auth, upload.single("image"), async (req, res) => {
  if (!canManagePublicPosts(req.user)) return res.status(403).json({ error: "Эрх хүрэлцэхгүй байна" });
  await ensurePublicPostTable();
  const postType = ["news", "announcement", "job"].includes(req.body.post_type) ? req.body.post_type : "news";
  const title = String(req.body.title || "").trim();
  const summary = String(req.body.summary || "").trim();
  const body = String(req.body.body || "").trim();
  const published = Number(req.body.published) === 0 ? 0 : 1;
  const featured = Number(req.body.featured) === 1 ? 1 : 0;
  const deadline = String(req.body.deadline || "").trim() || null;
  const contactPhone = String(req.body.contact_phone || "").trim();
  const contactEmail = String(req.body.contact_email || "").trim();
  const imageUrl = req.file ? `/uploads/${req.file.filename}` : "";
  if (!title || !summary) return res.status(400).json({ error: "Гарчиг болон товч тайлбар оруулна уу" });
  await run(
    `INSERT INTO public_posts(post_type,title,summary,body,image_url,published,featured,deadline,contact_phone,contact_email,created_by)
     VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    [postType, title, summary, body, imageUrl, published, featured, deadline, contactPhone, contactEmail, req.user.id]
  );
  const row = await get("SELECT * FROM public_posts WHERE id=last_insert_rowid()");
  await audit(req.user.id, "CREATE", "public_posts", row.id, `${postType}: ${title}`);
  res.json(normalizePost(row));
});

router.patch("/public-posts/:id", auth, upload.single("image"), async (req, res) => {
  if (!canManagePublicPosts(req.user)) return res.status(403).json({ error: "Эрх хүрэлцэхгүй байна" });
  await ensurePublicPostTable();
  const row = await get("SELECT * FROM public_posts WHERE id=?", [req.params.id]);
  if (!row) return res.status(404).json({ error: "Мэдээ олдсонгүй" });
  const postType = ["news", "announcement", "job"].includes(req.body.post_type) ? req.body.post_type : row.post_type;
  const title = String(req.body.title ?? row.title).trim();
  const summary = String(req.body.summary ?? row.summary ?? "").trim();
  const body = String(req.body.body ?? row.body ?? "").trim();
  const published = req.body.published == null ? Number(row.published || 0) : (Number(req.body.published) === 0 ? 0 : 1);
  const featured = req.body.featured == null ? Number(row.featured || 0) : (Number(req.body.featured) === 1 ? 1 : 0);
  const deadline = String(req.body.deadline ?? row.deadline ?? "").trim() || null;
  const contactPhone = String(req.body.contact_phone ?? row.contact_phone ?? "").trim();
  const contactEmail = String(req.body.contact_email ?? row.contact_email ?? "").trim();
  const imageUrl = req.file ? `/uploads/${req.file.filename}` : (row.image_url || "");
  if (!title || !summary) return res.status(400).json({ error: "Гарчиг болон товч тайлбар оруулна уу" });
  await run(
    `UPDATE public_posts
        SET post_type=?, title=?, summary=?, body=?, image_url=?, published=?, featured=?,
            deadline=?, contact_phone=?, contact_email=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?`,
    [postType, title, summary, body, imageUrl, published, featured, deadline, contactPhone, contactEmail, req.params.id]
  );
  await audit(req.user.id, "UPDATE", "public_posts", req.params.id, `${postType}: ${title}`);
  const updated = await get("SELECT * FROM public_posts WHERE id=?", [req.params.id]);
  res.json(normalizePost(updated));
});

router.post("/public-alerts", auth, upload.single("image"), async (req, res) => {
  if (!canManagePublicAlerts(req.user)) return res.status(403).json({ error: "Эрх хүрэлцэхгүй байна" });
  await ensurePublicAlertTable();
  const title = String(req.body.title || "").trim();
  const body = String(req.body.body || "").trim();
  const level = ["info", "warning", "danger"].includes(req.body.level) ? req.body.level : "warning";
  const location = String(req.body.location || "").trim();
  const startsAt = String(req.body.starts_at || "").trim() || null;
  const endsAt = String(req.body.ends_at || "").trim() || null;
  const active = Number(req.body.active) === 0 ? 0 : 1;
  const imageUrl = req.file ? `/uploads/${req.file.filename}` : "";
  if (!title || !body) return res.status(400).json({ error: "Гарчиг болон сэрэмжлүүлгийн текст оруулна уу" });
  await run(
    `INSERT INTO public_alerts(title,body,level,location,image_url,active,starts_at,ends_at,created_by)
     VALUES(?,?,?,?,?,?,?,?,?)`,
    [title, body, level, location, imageUrl, active, startsAt, endsAt, req.user.id]
  );
  const row = await get("SELECT * FROM public_alerts WHERE id=last_insert_rowid()");
  await audit(req.user.id, "CREATE", "public_alerts", row.id, title);
  res.json(normalizeAlert(row));
});

router.patch("/public-alerts/:id", auth, upload.single("image"), async (req, res) => {
  if (!canManagePublicAlerts(req.user)) return res.status(403).json({ error: "Эрх хүрэлцэхгүй байна" });
  await ensurePublicAlertTable();
  const row = await get("SELECT * FROM public_alerts WHERE id=?", [req.params.id]);
  if (!row) return res.status(404).json({ error: "Сэрэмжлүүлэг олдсонгүй" });
  const title = String(req.body.title ?? row.title).trim();
  const body = String(req.body.body ?? row.body).trim();
  const level = ["info", "warning", "danger"].includes(req.body.level) ? req.body.level : row.level;
  const location = String(req.body.location ?? row.location ?? "").trim();
  const startsAt = String(req.body.starts_at ?? row.starts_at ?? "").trim() || null;
  const endsAt = String(req.body.ends_at ?? row.ends_at ?? "").trim() || null;
  const active = req.body.active == null ? Number(row.active || 0) : (Number(req.body.active) === 0 ? 0 : 1);
  const imageUrl = req.file ? `/uploads/${req.file.filename}` : (row.image_url || "");
  if (!title || !body) return res.status(400).json({ error: "Гарчиг болон сэрэмжлүүлгийн текст оруулна уу" });
  await run(
    `UPDATE public_alerts
        SET title=?, body=?, level=?, location=?, image_url=?, active=?, starts_at=?, ends_at=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?`,
    [title, body, level, location, imageUrl, active, startsAt, endsAt, req.params.id]
  );
  await audit(req.user.id, "UPDATE", "public_alerts", req.params.id, `${title} active=${active}`);
  const updated = await get("SELECT * FROM public_alerts WHERE id=?", [req.params.id]);
  res.json(normalizeAlert(updated));
});

router.patch("/citizen-reports/:id", auth, upload.fields([
  { name: "before_image", maxCount: 1 },
  { name: "after_image", maxCount: 1 },
]), async (req, res) => {
  await ensureCitizenReportTable();
  const row = await get("SELECT * FROM citizen_reports WHERE id=?", [req.params.id]);
  if (!row) return res.status(404).json({ error: "Мэдээлэл олдсонгүй" });
  const files = req.files || {};
  const status = String(req.body.status || row.status || "new").trim();
  const priority = String(req.body.priority || row.priority || "normal").trim();
  const resolutionNote = String(req.body.resolution_note ?? row.resolution_note ?? "").trim();
  const publishPublic = req.body.publish_public == null
    ? Number(row.publish_public || 0)
    : (String(req.body.publish_public) === "1" || String(req.body.publish_public) === "true" ? 1 : 0);
  const assignedTo = req.body.assigned_to ? Number(req.body.assigned_to) : row.assigned_to;
  const beforeImage = files.before_image?.[0] ? `/uploads/${files.before_image[0].filename}` : row.before_image_url;
  const afterImage = files.after_image?.[0] ? `/uploads/${files.after_image[0].filename}` : row.after_image_url;
  const closedAtExpr = status === "done" && !row.closed_at ? "CURRENT_TIMESTAMP" : "closed_at";
  await run(
    `UPDATE citizen_reports
        SET status=?, priority=?, assigned_to=?, resolution_note=?, before_image_url=?,
            after_image_url=?, publish_public=?, closed_at=${closedAtExpr}, updated_at=CURRENT_TIMESTAMP
      WHERE id=?`,
    [status, priority, assignedTo || null, resolutionNote, beforeImage || "", afterImage || "", publishPublic, req.params.id]
  );
  await audit(req.user.id, "UPDATE", "citizen_reports", req.params.id, `${row.tracking_code} -> ${status}`);
  const updated = await get("SELECT * FROM citizen_reports WHERE id=?", [req.params.id]);
  res.json(normalizeReport(updated));
});

module.exports = router;
