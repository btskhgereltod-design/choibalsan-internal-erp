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
const { run, all, get, auth } = require("./db");
const { saveLightingDailySnapshot } = require("./services/lighting_snapshots");
const { saveCameraDailySnapshot } = require("./services/camera_snapshots");
const { startCronJobs } = require("./services/cron");

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
app.use((err, req, res, _next) => {
  console.error(`[server error] ${req.method} ${req.path}:`, err.message);
  if (res.headersSent) return;
  res.status(500).json({ error: "Серверийн алдаа гарлаа" });
});

// ── SPA fallback (must be last) ───────────────────────────────
app.get("*", (_, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

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

initDb().then(() => {
  cleanupAssistantLogs();
  startDailySnapshotScheduler();
  startCronJobs();
  setInterval(cleanupAssistantLogs, 24 * 60 * 60 * 1000).unref();
  app.listen(APP_PORT, "0.0.0.0", () => {
    console.log(`Choibalsan internal app running: http://0.0.0.0:${APP_PORT}`);
  });
});
