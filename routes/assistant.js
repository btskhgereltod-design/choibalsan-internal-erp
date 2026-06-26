"use strict";
const express = require("express");
const { auth, all, get, run } = require("../db");
const { cyrillize }                               = require("../services/assistant/normalize");
const { matchGuide }                              = require("../services/assistant/knowledge");
const { classifyIntent, classifyDevRequest, makeDevRequestTitle } = require("../services/assistant/intent");
const { fetchAssistantContext }                   = require("../services/assistant/fetchers");
const { askOpenAI }                               = require("../services/assistant/openai");
const { logQuery }                                = require("../services/assistant/audit");
const { handleIntent, buildAnswer }               = require("../services/assistant/handlers");

const router = express.Router();

// ── Rate limiter ─────────────────────────────────────────────────────────────
const ASK_RATE_WINDOW_MS = Math.max(10_000, Number(process.env.ASSISTANT_RATE_WINDOW_MS || 60_000));
const ASK_RATE_MAX = Math.max(3, Number(process.env.ASSISTANT_RATE_MAX || 30));
const askRateBuckets = new Map();

function checkAskRateLimit(req) {
  const now = Date.now();
  const key = `${req.user?.id || "anon"}:${req.ip || ""}`;
  const bucket = askRateBuckets.get(key) || { start: now, count: 0 };
  if (now - bucket.start > ASK_RATE_WINDOW_MS) { bucket.start = now; bucket.count = 0; }
  bucket.count += 1;
  askRateBuckets.set(key, bucket);
  if (askRateBuckets.size > 1000) {
    for (const [k, v] of askRateBuckets) {
      if (now - v.start > ASK_RATE_WINDOW_MS * 2) askRateBuckets.delete(k);
    }
  }
  return {
    allowed: bucket.count <= ASK_RATE_MAX,
    retryAfterSec: Math.ceil((ASK_RATE_WINDOW_MS - (now - bucket.start)) / 1000),
  };
}

// ── KB constants ─────────────────────────────────────────────────────────────
const KB_ROLES    = ["director", "chief_engineer"];
const KB_MODULES  = ["general","lighting","hr","assets","warehouse","operations","habea","finance","streetlights","reports"];
const KB_CATS     = ["FAQ","procedure","rule","glossary"];
const KB_ROLE_MINS = ["worker","engineer","storekeeper","accountant","hr","chief_engineer","director"];

// ── GET /api/assistant/status ─────────────────────────────────────────────────
router.get("/assistant/status", auth, (_req, res) => {
  res.json({
    ai_enabled: !!process.env.OPENAI_API_KEY,
    provider: "openai",
    model: process.env.OPENAI_MODEL || "gpt-4.1",
    rate_limit: { max: ASK_RATE_MAX, window_ms: ASK_RATE_WINDOW_MS },
  });
});

// ── GET /api/assistant/debug-normalize ───────────────────────────────────────
router.get("/assistant/debug-normalize", auth, async (req, res) => {
  if (!["director", "chief_engineer", "admin"].includes(req.user.role))
    return res.status(403).json({ error: "Эрх хүрэхгүй" });
  const text = String(req.query.text || "");
  const normalized = cyrillize(text);
  const classified = await classifyIntent(text);
  res.json({ input: text, normalized, classified });
});

// ── POST /api/assistant/ask ───────────────────────────────────────────────────
router.post("/assistant/ask", auth, async (req, res) => {
  const question      = String(req.body?.question || "").trim();
  const currentModule = String(req.body?.current_module || "").trim();
  const convHistory   = Array.isArray(req.body?.conv_history) ? req.body.conv_history.slice(-10) : [];
  if (!question) return res.status(400).json({ error: "Асуулт хоосон байна" });

  const rate = checkAskRateLimit(req);
  if (!rate.allowed) {
    return res.status(429).json({
      error: `ERP туслахаас хэт олон удаа асууж байна. ${rate.retryAfterSec} секундийн дараа дахин оролдоно уу.`,
      retry_after_sec: rate.retryAfterSec,
    });
  }

  const classified = await classifyIntent(question, convHistory);
  const intent = typeof classified === "string" ? classified : classified.intent;
  const ctx    = await fetchAssistantContext();

  // Local intent handler — returns unified schema
  const local = await handleIntent(intent, question, ctx, req.user, convHistory, classified).catch(() => null);
  if (local) {
    const logId = await logQuery(req.user.id, question, intent, "local");
    return res.json({ mode: "local", log_id: logId, ...local });
  }

  // OpenAI fallback
  const ai = await askOpenAI(question, ctx, req.user, currentModule, convHistory).catch(e => ({ text: null, error: e.message }));
  if (ai?.text) {
    const logId = await logQuery(req.user.id, question, "AI", "ai");
    const firstLine = ai.text.split(/\n/).find(l => l.trim()) || ai.text;
    return res.json({
      mode: "ai",
      log_id: logId,
      title: "AI туслах",
      short_answer: firstLine.slice(0, 220),
      answer: ai.text,
      sources: [],
      confidence: 0.6,
      data_found: true,
      suggestions: ["Алхам алхмаар заагаад өг", "Тайлангийн загвар гарга", "Гадны хүнд өгөх текст болго"],
    });
  }

  // Final fallback — KB or generic "not found"
  const guide = await matchGuide(question);
  const fallbackAnswer = guide
    ? `${guide.answer}${currentModule ? `\n\nОдоогийн дэлгэц: ${currentModule}.` : ""}`
    : `Энэ асуултад шууд хариулах ERP өгөгдлийн төрөл одоогоор туслахтай холбогдоогүй байна.${currentModule ? ` Одоогийн дэлгэц: ${currentModule}.` : ""}\n\nХэрэгтэй үзүүлэлт, огноо эсвэл бүртгэлийн нэрийг нэгээр нь хэлбэл яг тэр өгөгдлийг шалгана.${ai?.error ? `\n\n_(AI: ${ai.error})_` : ""}`;

  const logId = await logQuery(req.user.id, question, "fallback", "fallback");
  const fallbackFirstLine = fallbackAnswer.split(/\n/).find(l => l.trim()) || fallbackAnswer;
  return res.json({
    mode: "fallback",
    log_id: logId,
    title: guide ? guide.title : "Чойбалсан ERP зөвлөх",
    short_answer: fallbackFirstLine.slice(0, 220),
    answer: fallbackAnswer,
    sources: guide ? ["kb_articles"] : [],
    confidence: guide ? 0.65 : 0.3,
    data_found: !!guide,
    suggestions: [
      "Гэрлэн дохионы ослын цаг яаж шалгах вэ?",
      "Гэмтэл бүртгэлийг яаж хийх вэ?",
      "Өнөөдрийн ирц хэд вэ?",
    ],
  });
});

// ── POST /api/assistant/dev-request ──────────────────────────────────────────
router.post("/assistant/dev-request", auth, async (req, res) => {
  const description = String(req.body?.description || "").trim();
  const moduleName  = String(req.body?.module || "").trim().slice(0, 120);
  const pageUrl     = String(req.body?.page_url || "").trim().slice(0, 300);
  const userAgent   = String(req.body?.user_agent || req.headers["user-agent"] || "").trim().slice(0, 300);
  if (description.length < 8)
    return res.status(400).json({ error: "Санал/алдааны тайлбар арай богино байна" });

  const { requestType, severity } = classifyDevRequest(description);
  const result = await run(
    `INSERT INTO assistant_dev_requests
      (user_id,module,request_type,severity,title,description,page_url,user_agent,status,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?, 'Шинэ', datetime('now','localtime'), datetime('now','localtime'))`,
    [req.user.id, moduleName || "unknown", requestType, severity,
     makeDevRequestTitle(description, requestType), description.slice(0, 2000), pageUrl, userAgent]
  );
  res.json({ ok: true, id: result?.id || null, request_type: requestType, severity,
    message: "Санал/алдааг хөгжүүлэлтийн жагсаалтад хадгаллаа." });
});

// ── GET /api/assistant/dev-requests ──────────────────────────────────────────
router.get("/assistant/dev-requests", auth, async (req, res) => {
  const privileged = ["director", "chief_engineer", "admin"].includes(req.user.role);
  const rows = privileged
    ? await all(`
        SELECT r.*, u.full_name AS user_name, u.role AS user_role
        FROM assistant_dev_requests r
        LEFT JOIN users u ON u.id=r.user_id
        ORDER BY CASE r.status WHEN 'Шинэ' THEN 0 WHEN 'AI-д явуулсан' THEN 1
          WHEN 'Шалгаж байна' THEN 2 WHEN 'Хийхээр болсон' THEN 3
          WHEN 'Хийгдсэн' THEN 4 WHEN 'Хаасан' THEN 5 ELSE 5 END, r.created_at DESC LIMIT 200`)
    : await all(`SELECT r.* FROM assistant_dev_requests r WHERE r.user_id=? ORDER BY r.created_at DESC LIMIT 50`, [req.user.id]);
  res.json(rows);
});

// ── PUT /api/assistant/dev-requests/:id ──────────────────────────────────────
router.put("/assistant/dev-requests/:id", auth, async (req, res) => {
  if (!["director", "chief_engineer"].includes(req.user.role))
    return res.status(403).json({ error: "Зөвхөн захирал/ерөнхий инженер" });
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "id буруу" });

  const VALID_STATUS   = ["Шинэ", "AI-д явуулсан", "Шалгаж байна", "Хийхээр болсон", "Хийгдсэн", "Хаасан"];
  const VALID_PRIORITY = ["low", "medium", "high"];
  const { status, priority, admin_note } = req.body;
  const updates = [], params = [];

  if (status !== undefined) {
    if (!VALID_STATUS.includes(status)) return res.status(400).json({ error: "Статус буруу" });
    updates.push("status=?"); params.push(status);
    updates.push(status === "Хаасан" ? "closed_at=datetime('now','localtime')" : "closed_at=NULL");
  }
  if (priority !== undefined) {
    if (!VALID_PRIORITY.includes(priority)) return res.status(400).json({ error: "Чухалчлал буруу" });
    updates.push("priority=?"); params.push(priority);
  }
  if (admin_note !== undefined) { updates.push("admin_note=?"); params.push(String(admin_note).slice(0, 1000)); }
  if (!updates.length) return res.status(400).json({ error: "Өөрчлөх талбар байхгүй" });

  updates.push("updated_at=datetime('now','localtime')");
  params.push(id);
  try {
    const result = await run(`UPDATE assistant_dev_requests SET ${updates.join(",")} WHERE id=?`, params);
    if (!result?.changes) return res.status(404).json({ error: "Хүсэлт олдсонгүй" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Шинэчлэхэд алдаа гарлаа: " + (e.message || "") });
  }
});

// ── POST /api/assistant/feedback ─────────────────────────────────────────────
router.post("/assistant/feedback", auth, async (req, res) => {
  const { log_id, rating, comment } = req.body;
  if (!log_id || ![-1, 1].includes(Number(rating)))
    return res.status(400).json({ error: "log_id болон rating (1 эсвэл -1) шаардлагатай" });
  try {
    await run(
      `INSERT INTO assistant_feedback(log_id,user_id,rating,comment,created_at)
       VALUES(?,?,?,?,datetime('now','localtime'))
       ON CONFLICT(log_id,user_id) DO UPDATE SET
         rating=excluded.rating, comment=excluded.comment, created_at=datetime('now','localtime')`,
      [log_id, req.user.id, Number(rating), (comment || "").slice(0, 500)]
    );
    res.json({ ok: true });
  } catch (_) {
    res.status(500).json({ error: "Feedback хадгалахад алдаа гарлаа" });
  }
});

// ── GET /api/assistant/feedback-stats ────────────────────────────────────────
router.get("/assistant/feedback-stats", auth, async (req, res) => {
  if (!["director", "chief_engineer"].includes(req.user.role))
    return res.status(403).json({ error: "Эрх хүрэхгүй" });
  const [intentStats, topPositive, topNegative, recentNegative] = await Promise.all([
    all(`SELECT l.intent, COUNT(*) total,
          SUM(CASE WHEN f.rating=1  THEN 1 ELSE 0 END) positive,
          SUM(CASE WHEN f.rating=-1 THEN 1 ELSE 0 END) negative
         FROM assistant_logs l LEFT JOIN assistant_feedback f ON f.log_id=l.id
         GROUP BY l.intent ORDER BY total DESC LIMIT 20`).catch(() => []),
    all(`SELECT l.question, COUNT(*) cnt FROM assistant_feedback f JOIN assistant_logs l ON l.id=f.log_id
         WHERE f.rating=1 GROUP BY l.question ORDER BY cnt DESC LIMIT 10`).catch(() => []),
    all(`SELECT l.question, COUNT(*) cnt FROM assistant_feedback f JOIN assistant_logs l ON l.id=f.log_id
         WHERE f.rating=-1 GROUP BY l.question ORDER BY cnt DESC LIMIT 10`).catch(() => []),
    all(`SELECT l.question, f.comment, f.created_at
         FROM assistant_feedback f JOIN assistant_logs l ON l.id=f.log_id
         WHERE f.rating=-1 AND f.comment IS NOT NULL AND f.comment!=''
         ORDER BY f.created_at DESC LIMIT 10`).catch(() => []),
  ]);
  res.json({ intentStats, topPositive, topNegative, recentNegative });
});

// ── KB CRUD ───────────────────────────────────────────────────────────────────
router.get("/assistant/kb", auth, async (req, res) => {
  if (!KB_ROLES.includes(req.user.role)) return res.status(403).json({ error: "Эрх хүрэхгүй" });
  const module = req.query.module || "";
  const rows = await all(
    module
      ? `SELECT k.*, u.full_name created_by_name FROM kb_articles k
         LEFT JOIN users u ON u.id=k.id WHERE k.module=? ORDER BY k.sort_order,k.id DESC`
      : `SELECT * FROM kb_articles ORDER BY module,sort_order,id DESC`,
    module ? [module] : []
  );
  res.json(rows);
});

router.post("/assistant/kb", auth, async (req, res) => {
  if (!KB_ROLES.includes(req.user.role)) return res.status(403).json({ error: "Эрх хүрэхгүй" });
  const { title, body, keywords, module: mod, category, role_min, sort_order } = req.body;
  if (!title?.trim() || !body?.trim()) return res.status(400).json({ error: "Гарчиг болон агуулга шаардлагатай" });
  const result = await run(
    `INSERT INTO kb_articles(module,category,title,body,keywords,role_min,sort_order,active,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,1,datetime('now','localtime'),datetime('now','localtime'))`,
    [KB_MODULES.includes(mod) ? mod : "general", KB_CATS.includes(category) ? category : "FAQ",
     String(title).trim().slice(0,200), String(body).trim().slice(0,4000),
     String(keywords||"").slice(0,500), KB_ROLE_MINS.includes(role_min) ? role_min : "worker",
     Number(sort_order)||100]
  );
  res.json({ ok: true, id: result?.id });
});

router.put("/assistant/kb/:id", auth, async (req, res) => {
  if (!KB_ROLES.includes(req.user.role)) return res.status(403).json({ error: "Эрх хүрэхгүй" });
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "id буруу" });
  const { title, body, keywords, module: mod, category, role_min, sort_order, active } = req.body;
  const sets = [], params = [];
  if (title     !== undefined) { sets.push("title=?");      params.push(String(title).trim().slice(0,200)); }
  if (body      !== undefined) { sets.push("body=?");       params.push(String(body).trim().slice(0,4000)); }
  if (keywords  !== undefined) { sets.push("keywords=?");   params.push(String(keywords).slice(0,500)); }
  if (mod       !== undefined) { sets.push("module=?");     params.push(KB_MODULES.includes(mod) ? mod : "general"); }
  if (category  !== undefined) { sets.push("category=?");   params.push(KB_CATS.includes(category) ? category : "FAQ"); }
  if (role_min  !== undefined) { sets.push("role_min=?");   params.push(KB_ROLE_MINS.includes(role_min) ? role_min : "worker"); }
  if (sort_order!== undefined) { sets.push("sort_order=?"); params.push(Number(sort_order)||100); }
  if (active    !== undefined) { sets.push("active=?");     params.push(active ? 1 : 0); }
  if (!sets.length) return res.status(400).json({ error: "Өөрчлөх талбар байхгүй" });
  sets.push("updated_at=datetime('now','localtime')");
  params.push(id);
  const r = await run(`UPDATE kb_articles SET ${sets.join(",")} WHERE id=?`, params);
  if (!r?.changes) return res.status(404).json({ error: "Мэдлэгийн нийтлэл олдсонгүй" });
  res.json({ ok: true });
});

router.delete("/assistant/kb/:id", auth, async (req, res) => {
  if (!KB_ROLES.includes(req.user.role)) return res.status(403).json({ error: "Эрх хүрэхгүй" });
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "id буруу" });
  await run(`UPDATE kb_articles SET active=0,updated_at=datetime('now','localtime') WHERE id=?`, [id]);
  res.json({ ok: true });
});

// ── GET /api/assistant/dashboard-summary ─────────────────────────────────────
router.get("/assistant/dashboard-summary", auth, async (req, res) => {
  const { localDate } = require("../services/assistant/fetchers");
  const today = localDate();
  const [faults, work, trafficIssue, attendance, lowStock] = await Promise.all([
    get(`SELECT COUNT(*) count, COALESCE(SUM(broken_count),0) broken
         FROM sl_faults WHERE status IN ('Нээлттэй','Явцтай')`).catch(() => ({ count:0, broken:0 })),
    get(`SELECT COUNT(*) count FROM asset_events WHERE status NOT IN ('Дууссан','Цуцалсан')`).catch(() => ({ count:0 })),
    get(`SELECT COUNT(*) count FROM assets WHERE category='Гэрлэн дохио' AND status NOT IN ('Асаалтай','Идэвхтэй')`).catch(() => ({ count:0 })),
    get(`SELECT COUNT(DISTINCT user_id) count FROM hr_records
         WHERE start_date<=? AND COALESCE(end_date,start_date)>=?
           AND record_type IN ('Ажилласан','Хоцорсон','Илүү цаг')`, [today, today]).catch(() => ({ count:0 })),
    get(`SELECT COUNT(*) count FROM wh_materials m WHERE m.min_qty>0
         AND (m.opening_qty
           + COALESCE((SELECT SUM(CASE WHEN txn_type IN ('INCOME','INTERNAL_IN') THEN qty ELSE 0 END) FROM wh_transactions t WHERE t.material_id=m.id),0)
           - COALESCE((SELECT SUM(CASE WHEN txn_type IN ('EXPENSE','INTERNAL_OUT') THEN qty ELSE 0 END) FROM wh_transactions t WHERE t.material_id=m.id),0)) <= m.min_qty`).catch(() => ({ count:0 })),
  ]);
  res.json({
    today,
    open_light_faults: Number(faults.count||0),
    broken_heads:      Number(faults.broken||0),
    open_work:         Number(work.count||0),
    traffic_issues:    Number(trafficIssue.count||0),
    present_today:     Number(attendance.count||0),
    low_stock_items:   Number(lowStock.count||0),
  });
});

module.exports = router;
