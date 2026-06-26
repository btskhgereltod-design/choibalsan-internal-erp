"use strict";
const express = require("express");
const http    = require("http");
const https   = require("https");
const { all, get, auth } = require("../db");
const { requireRole }    = require("../middleware/roles");
const { extractOpenAIText } = require("../services/assistant/openai");

const router = express.Router();

// ── Helper: internal HTTP request ────────────────────────────
function httpReq(url, opts = {}) {
  return new Promise((resolve) => {
    const start = Date.now();
    const lib   = url.startsWith("https") ? https : http;
    const req   = lib.request(url, {
      method:  opts.method || "GET",
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
      timeout: 8000,
    }, (res) => {
      let body = "";
      res.on("data", d => body += d);
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(body); } catch(_) {}
        resolve({ status: res.statusCode, body: json, raw: body.slice(0, 500), ms: Date.now() - start });
      });
    });
    req.on("error", e => resolve({ status: 0, error: e.message, ms: Date.now() - start }));
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, error: "timeout", ms: 8000 }); });
    if (opts.body) req.write(JSON.stringify(opts.body));
    req.end();
  });
}

// ── Test suite ────────────────────────────────────────────────
async function runTests(baseUrl, token) {
  const H = { Authorization: `Bearer ${token}` };
  const results = [];

  function rec(group, name, pass, detail = "") {
    results.push({ group, name, pass, detail });
  }

  // ── 1. AUTH SECURITY ──────────────────────────────────────
  const authEndpoints = [
    "/api/users", "/api/work-logs", "/api/assets",
    "/api/warehouse", "/api/hr-records", "/api/cash-journal",
    "/api/chat/messages", "/api/audit-logs",
  ];
  for (const ep of authEndpoints) {
    const r = await httpReq(baseUrl + ep);
    const blocked = r.status === 401 || r.status === 403;
    rec("🔐 Auth хамгаалалт", ep, blocked,
      blocked ? `✓ ${r.status} — Зөв хаалттай` : `⚠ ${r.status} — Token шаардахгүй байна!`);
  }

  // ── 2. CORE API RESPONSE ──────────────────────────────────
  const coreEndpoints = [
    { url: "/api/users",                label: "Ажилтнуудын жагсаалт" },
    { url: "/api/work-logs",            label: "Ажлын явц" },
    { url: "/api/assets",               label: "Хөрөнгийн бүртгэл" },
    { url: "/api/warehouse",            label: "Агуулах" },
    { url: "/api/chat/users",           label: "Чат хэрэглэгчид" },
    { url: "/api/chat/messages",        label: "Чат мессежүүд" },
    { url: "/api/chat/work-logs",       label: "Чат ажлын жагсаалт" },
    { url: "/api/sl-faults",            label: "Гэрэлтүүлгийн гэмтэл" },
    { url: "/api/safety-reports",       label: "ХАБЭА тайлан" },
    { url: "/api/admin-hub/dashboard",  label: "Admin dashboard" },
  ];
  for (const ep of coreEndpoints) {
    const r = await httpReq(baseUrl + ep.url, { headers: H });
    const ok = r.status === 200 && (Array.isArray(r.body) || (r.body && typeof r.body === "object"));
    rec("📡 API хариулт", ep.label, ok,
      ok ? `✓ ${r.status} · ${Array.isArray(r.body) ? r.body.length + " мөр" : "object"} · ${r.ms}ms`
         : `✗ ${r.status} · ${r.error || r.raw?.slice(0,100) || "хариу алдаатай"}`);
  }

  // ── 3. POST VALIDATION ────────────────────────────────────
  const postTests = [
    { url: "/api/work-logs",      body: {},          label: "Ажил үүсгэх (хоосон)" },
    { url: "/api/chat/messages",  body: {},          label: "Чат мессеж (хоосон)" },
    { url: "/api/assets",         body: {},          label: "Хөрөнгө (хоосон)" },
  ];
  for (const pt of postTests) {
    const r = await httpReq(baseUrl + pt.url, { method: "POST", headers: H, body: pt.body });
    const validated = r.status === 400 || r.status === 422;
    rec("✅ Validation", pt.label, validated,
      validated ? `✓ ${r.status} — Validation ажиллаж байна`
                : `⚠ ${r.status} — Хоосон өгөгдөл зөвшөөрч байна!`);
  }

  // ── 4. DB DATA INTEGRITY ──────────────────────────────────
  try {
    // Orphaned work executions
    const orphaned = await all(`
      SELECT COUNT(*) as c FROM work_executions we
      WHERE NOT EXISTS (SELECT 1 FROM asset_events ae WHERE ae.id = we.work_log_id)
    `);
    rec("🗄 DB integrity", "Orphaned гүйцэтгэл", orphaned[0].c === 0,
      orphaned[0].c === 0 ? "✓ Холбоосгүй гүйцэтгэл байхгүй"
                          : `⚠ ${orphaned[0].c} гүйцэтгэл эзэн ажилгүй`);

    // Users with no department
    const noDept = await all("SELECT COUNT(*) as c FROM users WHERE (department IS NULL OR department='') AND active=1 AND role<>'ai_readonly'");
    rec("🗄 DB integrity", "Тасаггүй ажилтан", noDept[0].c === 0,
      noDept[0].c === 0 ? "✓ Бүх ажилтан тасагтай"
                        : `⚠ ${noDept[0].c} ажилтан тасаггүй байна`);

    // Overdue active work
    const today = new Date().toISOString().slice(0, 10);
    const overdue = await all(`
      SELECT COUNT(*) as c FROM asset_events
      WHERE end_date < ? AND status NOT IN ('Дууссан','Хаагдсан','Цуцалсан')
    `, [today]);
    rec("🗄 DB integrity", "Хугацаа хэтэрсэн ажил", overdue[0].c === 0,
      overdue[0].c === 0 ? "✓ Хугацаа хэтэрсэн ажил байхгүй"
                         : `⚠ ${overdue[0].c} ажил хугацаа хэтэрсэн`);

    // Chat messages with invalid sender
    const badChat = await all(`
      SELECT COUNT(*) as c FROM chat_messages cm
      WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = cm.sender_id)
    `);
    rec("🗄 DB integrity", "Чат мессежийн илгээгч", badChat[0].c === 0,
      badChat[0].c === 0 ? "✓ Бүх мессежийн илгээгч хүчинтэй"
                         : `⚠ ${badChat[0].c} мессежийн илгээгч устсан байна`);

    // Execution photos pointing to missing files
    const exPhotos = await all("SELECT file_path FROM execution_photos LIMIT 100");
    const fs = require("fs");
    const path = require("path");
    const UPLOAD_DIR = path.join(__dirname, "..", "uploads");
    let missingPhotos = 0;
    for (const p of exPhotos) {
      // file_path stored as "/uploads/filename.jpg" — use basename to avoid double "uploads/"
      const fullPath = path.join(UPLOAD_DIR, path.basename(p.file_path));
      if (!fs.existsSync(fullPath)) missingPhotos++;
    }
    rec("🗄 DB integrity", "Зургийн файл бүрэн эсэх", missingPhotos === 0,
      missingPhotos === 0 ? `✓ Бүх зураг (${exPhotos.length}) бүрэн байна`
                          : `⚠ ${missingPhotos} зургийн файл алга болсон байна`);

  } catch(e) { rec("🗄 DB integrity", "DB шалгалт", false, "Алдаа: " + e.message); }

  // ── 5. PERFORMANCE ────────────────────────────────────────
  const perfTests = [
    { url: "/api/work-logs",    label: "Work logs ачаалал" },
    { url: "/api/users",        label: "Хэрэглэгч ачаалал" },
    { url: "/api/assets",       label: "Хөрөнгө ачаалал" },
  ];
  for (const pt of perfTests) {
    const r = await httpReq(baseUrl + pt.url, { headers: H });
    const fast = r.ms < 500;
    rec("⚡ Гүйцэтгэл", pt.label, fast,
      `${r.ms}ms — ${fast ? "✓ Хурдан" : "⚠ Удаан (500ms+)"}`);
  }

  // ── 6. ROLE ISOLATION ────────────────────────────────────
  // Test that worker token can't access admin endpoints
  // Use worker role specifically — lowest privilege, no finance/HR access
  const workerUser = await get("SELECT * FROM users WHERE role='worker' AND active=1 LIMIT 1");
  if (workerUser) {
    const jwt = require("jsonwebtoken");
    const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_THIS_SECRET_2026_CHOIBALSAN";
    const workerToken = jwt.sign({ id: workerUser.id, role: workerUser.role, username: workerUser.username, full_name: workerUser.full_name }, JWT_SECRET, { expiresIn: "1m" });
    const WH = { Authorization: `Bearer ${workerToken}` };

    const adminOnlyEndpoints = [
      { url: "/api/cash-journal",  label: `Санхүүгийн дансны дэвтэр (${workerUser.role})` },
      { url: "/api/audit-logs",    label: `Audit log (${workerUser.role})` },
    ];
    for (const ep of adminOnlyEndpoints) {
      const r = await httpReq(baseUrl + ep.url, { headers: WH });
      const blocked = r.status === 401 || r.status === 403;
      rec("🛡 Эрхийн хяналт", ep.label, blocked,
        blocked ? `✓ ${workerUser.role} эрх хаалттай`
                : `⚠ ${workerUser.role} хэрэглэгч нэвтэрч байна — эрхийн алдаа!`);
    }
    // hr-records: worker зөвхөн өөрийнхөө ирцийг харах эрхтэй (зориудын тохиргоо)
    const hrR = await httpReq(baseUrl + "/api/hr-records", { headers: WH });
    if (hrR.status === 200) {
      const rows = Array.isArray(hrR.body) ? hrR.body : [];
      const onlyOwn = rows.every(r => r.user_id === workerUser.id);
      rec("🛡 Эрхийн хяналт", `HR ирц — зөвхөн өөрийнх (${workerUser.role})`, onlyOwn,
        onlyOwn ? `✓ ${rows.length} бичилт, бүгд өөрийнх` : `⚠ Бусдын ирцийн мэдээлэл харагдаж байна`);
    } else {
      rec("🛡 Эрхийн хяналт", `HR ирц — зөвхөн өөрийнх (${workerUser.role})`, false,
        `⚠ ${hrR.status} — ажилтан өөрийнхөө ирцийг харж чадахгүй байна`);
    }
  }

  return results;
}

// ── OpenAI analysis ───────────────────────────────────────────
async function analyzeWithAI(results, dbStats) {
  if (!process.env.OPENAI_API_KEY) return null;
  if (typeof fetch !== "function") return null;

  const failed  = results.filter(r => !r.pass);
  const passed  = results.filter(r => r.pass);
  const summary = results.map(r =>
    `[${r.pass ? "✓" : "✗"}] ${r.group} › ${r.name}: ${r.detail}`
  ).join("\n");

  const prompt = `Та ERP системийн автоматжуулсан тест тайланг шинжлэх ёстой.

ERP: Чойбалсан хөгжил ОНӨҮГ — дотоод удирдлагын систем (Node.js/Express/SQLite)

ТЕСТ ҮР ДҮН:
Нийт: ${results.length} тест · Амжилттай: ${passed.length} · Алдаатай: ${failed.length}

${summary}

DB СТАТИСТИК:
${JSON.stringify(dbStats, null, 2)}

Дараах форматаар шинжилгээ хий:

## 🔴 Яаралтай засах шаардлагатай
(Аюулгүй байдал, дата алдагдал гэх мэт)

## 🟡 Анхаарах асуудлууд
(Гүйцэтгэл, validation гэх мэт)

## ✅ Сайн ажиллаж байгаа зүйлс

## 💡 Саналууд (1-3 богино, хэрэгжүүлэх боломжтой)

Монгол хэлээр, товч байлга. Кодын жишээ бүү бич.`;

  try {
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-4.1", input: [{ role: "user", content: prompt }], store: false }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    return extractOpenAIText(data);
  } catch(_) { return null; }
}

// ── Route: POST /api/ai-test/run ─────────────────────────────
router.post("/ai-test/run", auth, requireRole("director"), async (req, res) => {
  const startedAt = Date.now();
  try {
    // Detect base URL
    const proto = req.headers["x-forwarded-proto"] || "http";
    const host  = req.headers.host || `localhost:${process.env.PORT || 4000}`;
    const baseUrl = `${proto}://${host}`;

    // DB stats for context
    const [userCount, workCount, assetCount, chatCount, execCount] = await Promise.all([
      get("SELECT COUNT(*) as c FROM users WHERE active=1 AND role<>'ai_readonly'"),
      get("SELECT COUNT(*) as c FROM asset_events"),
      get("SELECT COUNT(*) as c FROM assets"),
      get("SELECT COUNT(*) as c FROM chat_messages"),
      get("SELECT COUNT(*) as c FROM work_executions"),
    ]);
    const dbStats = {
      users: userCount.c, work_logs: workCount.c,
      assets: assetCount.c, chat_messages: chatCount.c, executions: execCount.c,
    };

    // Run tests
    const results = await runTests(baseUrl, req.headers.authorization?.replace("Bearer ", "") || "");

    // AI analysis
    const aiAnalysis = await analyzeWithAI(results, dbStats);

    const passed = results.filter(r => r.pass).length;
    const failed = results.filter(r => !r.pass).length;

    res.json({
      ran_at:      new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      total: results.length,
      passed,
      failed,
      score: Math.round((passed / results.length) * 100),
      db_stats: dbStats,
      results,
      ai_analysis: aiAnalysis,
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Route: GET /api/ai-test/history ──────────────────────────
router.get("/ai-test/history", auth, requireRole("director"), async (req, res) => {
  res.json({ message: "History coming soon" });
});

module.exports = router;
