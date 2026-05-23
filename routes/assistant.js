"use strict";
const express = require("express");
const { auth, all, get, run } = require("../db");
const { KB_SEED_ARTICLES } = require("../scripts/seed_kb");

const router = express.Router();

const ASK_RATE_WINDOW_MS = Math.max(10_000, Number(process.env.ASSISTANT_RATE_WINDOW_MS || 60_000));
const ASK_RATE_MAX = Math.max(3, Number(process.env.ASSISTANT_RATE_MAX || 30));
const askRateBuckets = new Map();

function checkAskRateLimit(req) {
  const now = Date.now();
  const key = `${req.user?.id || "anon"}:${req.ip || ""}`;
  const bucket = askRateBuckets.get(key) || { start: now, count: 0 };
  if (now - bucket.start > ASK_RATE_WINDOW_MS) {
    bucket.start = now;
    bucket.count = 0;
  }
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

function classifyDevRequest(text) {
  const q = cyrillize(String(text || "").toLowerCase());
  const has = (...words) => words.some(w => q.includes(w));
  const requestType = has("харагдахгүй", "ажиллахгүй", "алдаа", "болохгүй", "эвдэр", "гац", "уншигдахгүй", "upload")
    ? "bug"
    : has("тайлан", "хэвлэх", "excel", "word", "pdf")
      ? "report"
      : has("болг", "нэм", "сайжруул", "санал", "хүсэлт")
        ? "feature"
        : "support";
  const severity = has("яаралтай", "огт", "болохгүй", "ажиллахгүй", "уналаа", "алдаа")
    ? "high"
    : has("хэцүү", "удаан", "харагдахгүй", "засмаар")
      ? "medium"
      : "low";
  return { requestType, severity };
}

function makeDevRequestTitle(text, requestType) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  const prefix = requestType === "bug" ? "Алдаа" : requestType === "report" ? "Тайлан" : requestType === "feature" ? "Санал" : "Тусламж";
  return `${prefix}: ${clean.slice(0, 70)}${clean.length > 70 ? "..." : ""}`;
}

// ═════════════════════════════════════════════════════════════════════════════
// § 1  LATIN → CYRILLIC NORMALIZER
// Монгол галиг (latin) оролтыг кирилл болгоно — ажилчид latin гараар бичвэл
// ижил утгаар ойлгоно.
// ═════════════════════════════════════════════════════════════════════════════
const LATIN_MAP = [
  [/\bhr\b/gi,                                    "хүний нөөц"],
  [/\bit\b/gi,                                    "мэдээллийн технологи"],
  [/gereltuuleg|gereltüüleg|gereltuuleh/gi,   "гэрэлтүүлэг"],
  [/hunii\s*noots|hunii\s*nots|hünii\s*nöts/gi, "хүний нөөц"],
  [/gerlen\s*dohio|gerelt\s*dohio/gi,          "гэрлэн дохио"],
  [/gerliin\s*shon/gi,                          "гэрлийн шон"],
  [/sankhuu/gi,                                 "санхүү"],
  [/gerel/gi,                                   "гэрэл"],
  [/gudamj/gi,                                  "гудамж"],
  [/choibalsan/gi,                              "чойбалсан"],
  [/gemtel/gi,                                  "гэмтэл"],
  [/zasvar/gi,                                  "засвар"],
  [/irtsiin|irtsiig/gi,                         "ирцийн"],
  [/\birts\b/gi,                                "ирц"],
  [/nyagtlan|njagtlan/gi,                       "нягтлан"],
  [/naygtlan|nyagtlan|njagtlan/gi,              "нягтлан"],
  [/narav|naraviin|nyarav|njarav/gi,            "нярав"],
  [/zahiral|zakhiral/gi,                        "захирал"],
  [/tailan|taylan/gi,                           "тайлан"],
  [/huvaari|khuvaar/gi,                         "хуваарь"],
  [/aguulah|agwlah/gi,                          "агуулах"],
  [/\bdohio\b/gi,                               "дохио"],
  [/habea/gi,                                   "хабэа"],
  [/ajiltan/gi,                                 "ажилтан"],
  [/tsalin/gi,                                  "цалин"],
  [/batalgaa/gi,                                "баталгаа"],
  [/noots|nöts/gi,                              "нөөц"],
  [/unuudur/gi,                                 "өнөөдөр"],
  [/heden/gi,                                   "хэдэн"],
  [/heded/gi,                                   "хэдэд"],
  [/asahaar|asah|asaah/gi,                      "аса"],
  [/untarhaar|untarah/gi,                       "унтрах"],
  [/herhen/gi,                                  "хэрхэн"],
  [/\bniit\b/gi,                                "нийт"],
  [/irsen/gi,                                   "ирсэн"],
  [/\bshon\b/gi,                                "шон"],
  [/\btoo\b/gi,                                 "тоо"],
  [/surgalt/gi,                                 "сургалт"],
  [/gereet/gi,                                  "гэрээт"],
  [/gereet\b/gi,                                "гэрэ"],
  [/\bgeree\b/gi,                               "гэрээ"],
  // ── Нэмэлт галиг хөрвүүлэлт ──────────────────────────────────────────
  [/tsahilgaan/gi,                              "цахилгаан"],
  [/enegener|engener|injener/gi,                "инженер"],
  [/medeel/gi,                                  "мэдээлэл"],
  [/gemtl/gi,                                   "гэмтэл"],
  [/\btolgoi\b/gi,                              "толгой"],
  [/\bhed\b/gi,                                 "хэдэн"],
  [/\bner\b/gi,                                 "нэр"],
  [/\bashgvi\b|\bashgui\b|\basahgvi\b|\basahgui\b/gi, "асахгүй"],
  [/\bgargaj\b|\bgargaach\b/gi,                 "гаргаж"],
  [/\bharuul|\bharuulj\b/gi,                    "харуулаач"],
  [/\baviach\b|\bavch\b|\bug\b|\buguuch\b/gi,   "өгөөч"],
  [/\bbna\b/gi,                                 "байна"],
  [/\bbaidag\b/gi,                              "байдаг"],
  [/\bnadin\b|\bnadad\b/gi,                     "надад"],
  [/\bhen\b/gi,                                 "хэн"],
  [/\bgedeg\b/gi,                               "гэдэг"],
  [/\byamar\b/gi,                               "ямар"],
  [/\bbaidag\s*ve\b/gi,                         "байдаг вэ"],
  [/ajilchid/gi,                                "ажилчид"],
  [/\bners/gi,                                  "нэрс"],
  [/cameriin|cameriinх|kameriin|camera-iin/gi,  "камерын"],
  [/camer|camera|kamer/gi,                      "камер"],
  [/hvnii\s*nuuts|hunii\s*nuuts|hunii\s*noots/gi, "хүний нөөц"],
  [/tulbur/gi,                                  "төлбөр"],
  [/utas/gi,                                    "утас"],
  [/dugar|dugaar|dugaarig|dugaariig/gi,         "дугаар"],
  [/tselmeg/gi,                                 "цэлмэг"],
  [/tvvnii|tuunii/gi,                           "түүний"],
  [/minii/gi,                                   "миний"],
  [/svvl/gi,                                    "сүүл"],
  [/sariin|sar/gi,                              "сарын"],
  [/tulburiin|tulbur/gi,                        "төлбөр"],
  [/\bahmad\b/gi,                               "ахмад"],
  [/\bniis\b|\bniit\b/gi,                       "нийт"],
  [/emegt/gi,                                   "эмэгт"],
  [/eregt/gi,                                   "эрэгт"],
  [/\bgazar\b/gi,                               "газар"],
  [/tasaldaг|tasalddag/gi,                      "тасалддаг"],
];

function cyrillize(text) {
  let t = text;
  for (const [pat, rep] of LATIN_MAP) t = t.replace(pat, rep);
  return t;
}

// ═════════════════════════════════════════════════════════════════════════════
// § 2  МЭДЛЭГИЙН САН (SQLite FTS + seed fallback)
// ═════════════════════════════════════════════════════════════════════════════
const LOCAL_GUIDES = KB_SEED_ARTICLES.map(a => ({
  title: a.title,
  answer: a.body,
  module: a.module,
  keys: String(a.keywords || "").split(",").map(k => k.trim()).filter(Boolean),
}));

function matchLocalGuide(question) {
  const q = cyrillize(String(question || "").toLowerCase());
  let best = null;
  for (const guide of LOCAL_GUIDES) {
    const score = guide.keys.reduce((s, k) => s + (q.includes(k) ? 1 : 0), 0);
    if (score && (!best || score > best.score)) best = { ...guide, score };
  }
  return best;
}

async function matchGuide(question) {
  const q = cyrillize(String(question || "").toLowerCase()).trim();
  if (!q) return matchLocalGuide(question);

  const words = q.split(/\s+/)
    .map(w => w.replace(/[^\wЀ-ӿ]/g, "").trim())
    .filter(w => w.length > 1);

  if (words.length) {
    try {
      const ftsQuery = words.map(w => `"${w}"`).join(" OR ");
      const row = await get(
        `SELECT a.*, bm25(kb_fts) score
         FROM kb_fts
         JOIN kb_articles a ON a.id=kb_fts.rowid
         WHERE a.active=1
           AND kb_fts MATCH ?
         ORDER BY score, a.sort_order ASC
         LIMIT 1`,
        [ftsQuery]
      );
      if (row) return { title: row.title, answer: row.body, module: row.module };
    } catch (_) {
      // FTS5 failed — LIKE fallback
      const first = words[0];
      const row = await get(
        `SELECT * FROM kb_articles WHERE active=1
          AND (keywords LIKE ? OR title LIKE ? OR body LIKE ?) LIMIT 1`,
        [`%${first}%`, `%${first}%`, `%${first}%`]
      ).catch(() => null);
      if (row) return { title: row.title, answer: row.body, module: row.module };
    }
  }

  return matchLocalGuide(question);
}

// ═════════════════════════════════════════════════════════════════════════════
// § 3  INTENT CLASSIFIER
// Бүлэг keyword-ийн логик: БҮГД бүлэг ≥1 match байх ёстой (AND of ORs).
// Дарааллаар шалгана — эхний таарсан intent буцаана.
// ═════════════════════════════════════════════════════════════════════════════
const INTENT_RULES = [
  // Гэрэлтүүлэг
  { id: "OPEN_LIGHT_FAULTS",groups: [["гэмтэл","асахгүй","унтарсан","толгой"], ["хэдэн","нийт","тоо","байна уу","нээлттэй","ажиллахгүй","асдаггүй"]] },
  { id: "LIGHT_SCHEDULE",   groups: [["гэрэл","гэрэлтүүлэг","гудамж","авто зам","гэр хороолол","цамхаг"], ["хэдэд","цаг","аса","унтар","хуваарь"]] },
  { id: "POLE_COUNT",       groups: [["шон","гэрлийн шон","цамхаг","гэр хороолол","авто замын гэрэл","гэрэлтүүлгийн"], ["хэдэн","нийт","тоо","дэлгэрэнгүй","мэдээлэл","харуулаач","статус","хэмжээ"]] },

  // Хөрөнгө
  { id: "ASSET_VALUE",      groups: [["хөрөнгө","байгууллагын хөрөнгө"], ["дүн","үнэ","өртөг","хэдэн төгрөг"]] },
  { id: "ASSET_WARRANTY",   groups: [["баталгаа","warranty"], ["хугацаа","дуусч","дуусах","анхааруулга"]] },

  // Ажилтан / ирц
  { id: "EMPLOYEE_COUNT",   groups: [["ажилтан","хүн","staff","employee"], ["хэдэн","нийт","тоо"]] },
  { id: "ATTENDANCE_TODAY", groups: [["өнөөдөр","today","unuudur"], ["ирсэн","ирц","ажилдаа","хэдэн хүн"]] },
  { id: "MY_SALARY",        groups: [["миний","намайг","bi"], ["цалин","гар дээр","авах","net"]] },

  // Гэмтэл засвар
  { id: "OPEN_FAULTS",      groups: [["гэмтэл","засвар","тасалбар"], ["нээлттэй","хэдэн","нийт","өнөөдөр","байна уу","мэдээлэл","гаргаж","харуулаач"]] },
  { id: "OVERDUE_WORK",     groups: [["ажил","засвар","даалгавар"], ["хугацаа хэтэрсэн","хоцорсон","дуусаагүй","хэтэрсэн"]] },

  // Гэрлэн дохио
  { id: "TRAFFIC_SIGNAL_LOG", groups: [["гэрлэн дохио","гэрэл дохио","дохио"], ["ослын цаг","осол болсон","тухайн үед","асаалтай байсан","унтарсан байсан","журнал","баримт","нотлох","evidence"]] },
  { id: "TRAFFIC_STATUS",   groups: [["гэрлэн дохио","гэрэл дохио","дохио"], ["статус","ямар","хэдэн","тоо","нийт","ажиллаж","байна","байдаг"]] },

  // Агуулах
  { id: "LOW_STOCK",        groups: [["агуулах","нөөц","материал"], ["дуусч","дутмаг","хомс","анхааруулга","буурсан"]] },

  // Санхүү
  { id: "MONTHLY_EXPENSE",  groups: [["зардал"], ["энэ сар","сарын","тайлан"]] },
  { id: "BUDGET_PROGRESS",  groups: [["төсөв"], ["гүйцэтгэл","хувь","хэтэрсэн","үлдэгдэл"]] },

  // ХАБЭА
  { id: "SAFETY_OPEN",      groups: [["хабэа","аюулгүй","эрсдэл","осол"], ["нээлттэй","шийдвэрлэгдээгүй","хэдэн"]] },
  { id: "HABEA_WORK_STATUS", groups: [["хабэа","аюулгүй байдал"], ["ажлын явц","шалгалт","урьдчилсан","дараах","pre","post","бүртгэгдсэн үү","бүртгэгдсэн","дутуу","хийгдсэн","хийсэн","байгаа"]] },

  // Гэрээ / хуваарь
  { id: "CONTRACT_EXPIRY",  groups: [["гэрээ"], ["хугацаа","дуусч","дуусах","сануулга"]] },
  { id: "TRAINING",         groups: [["сургалт"], ["хуваарь","хэзээ","байна","ямар","дараагийн"]] },

  // Камер
  { id: "CAMERA_COUNT",     groups: [["камер"], ["хэдэн","тоо","нийт","байдаг","байна","хэмжээ"]] },

  // Ажилтны хайлт
  { id: "EMPLOYEE_LOOKUP",  groups: [["инженер","нягтлан","нярав","цахилгаанчин","хабэа","ажилтан","ажилчид","хүний нөөц","цахилгааны","камер"], ["хэн","нэр","нэрс","мэдээлэл","хэн бэ","ямар хүн","хэн ажилладаг","хэн ажиллаж","жагсаалт","утас","дугаар"]] },

  // Dashboard
  { id: "DASHBOARD_STATUS", groups: [["өнөөдөр","өнөөдрийн","одоо","яаралтай","unuudur"], ["тойм","байдал","статус","ямар","хурдан","summary","дүн"]] },
];

function historyText(convHistory = []) {
  return (Array.isArray(convHistory) ? convHistory : []).map(m => String(m?.text || "")).join("\n").toLowerCase();
}

async function classifyIntent(rawQuestion, convHistory = []) {
  if (isGreetingOnly(rawQuestion)) return "GREETING";
  const q = cyrillize(rawQuestion).toLowerCase();
  const h = cyrillize(historyText(convHistory));
  if ((q.includes("эмэгт") || q.includes("эрэгт")) && (q.includes("ажил") || q.includes("хүн"))) return "EMPLOYEE_GENDER";
  if ((q.includes("өөрийн") || q.includes("миний") || q.includes("захирал")) &&
      (q.includes("ажил") || q.includes("даалгавар")) &&
      (q.includes("юу") || q.includes("хийж") || q.includes("байгаа"))) {
    return "MY_WORK";
  }
  if ((h.includes("цахилгааны төлбөр") || h.includes("electricity")) &&
      (q.includes("сарын") || q.includes("sariinh") || /^\s*\d{1,2}/.test(q) || q.includes("зөрүү") || q.includes("төлөвлө"))) {
    return "ELECTRICITY_BILL";
  }
  if (q.includes("юу хийсэн") || q.includes("хийсэн байна") || q.includes("оруулсан") || q.includes("харагдсангүй") || q.includes("ажил хийсэн")) {
    return "WORK_ACTIVITY";
  }
  if ((q.includes("гэмтэл") || q.includes("асахгүй") || q.includes("унтарсан")) &&
      (q.includes("гудамж") || q.includes("чойбалсан") || q.match(/гт-\d+/i))) {
    return "LOCATION_LIGHT_FAULT";
  }
  if ((q.includes("миний") || q.includes("өөрийн")) && q.includes("дугаар")) return "MY_PHONE";
  if ((q.includes("дохио") || q.includes("гэрлэн дохио")) &&
      (q.includes("осол") || q.includes("тухайн үед") || q.includes("асаалтай байсан") ||
       q.includes("унтарсан байсан") || q.includes("баримт") || q.includes("нотлох") ||
       /\d{4}[-\/]\d{1,2}[-\/]\d{1,2}/.test(q))) {
    return "TRAFFIC_SIGNAL_LOG";
  }
  if ((q.includes("цахилгаан") || q.includes("эрчим хүч")) && q.includes("төлбөр")) return "ELECTRICITY_BILL";
  if ((q.includes("гэрэл") || q.includes("гэрэлтүүлэг")) &&
      (q.includes("асахгүй") || q.includes("гэмтэл") || q.includes("унтарсан")) &&
      (q.includes("хэдэд") || q.includes("хуваарь") || q.includes("унтрах") || q.includes("аса"))) {
    return "LIGHT_STATUS_SCHEDULE";
  }
  if (q.includes("утас") && q.includes("дугаар")) return "EMPLOYEE_PHONE_FOLLOWUP";
  if (q.includes("камер") && !q.includes("хэдэн") && !q.includes("тоо") && !q.includes("нийт")) return "EMPLOYEE_LOOKUP";
  if ((q.includes("нярав") || q.includes("нягтлан")) && !q.includes("хэдэн") && !q.includes("тоо")) return "EMPLOYEE_LOOKUP";
  for (const rule of INTENT_RULES) {
    if (rule.groups.every(grp => grp.some(k => q.includes(k)))) return rule.id;
  }
  const guide = await matchGuide(rawQuestion);
  if (guide) return { intent: "KB_MATCH", guide };
  return "AI";
}

// ═════════════════════════════════════════════════════════════════════════════
// § 4  ТУСЛАХ ФУНКЦҮҮД
// ═════════════════════════════════════════════════════════════════════════════
function localDate() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function money(n) {
  return `${Math.round(Number(n || 0)).toLocaleString("mn-MN")}₮`;
}

function isGreetingOnly(question) {
  const q = cyrillize(question.toLowerCase().trim()).replace(/[.!?؟。、\s]+$/, "");
  const greetings = [
    "sain uu","sain baina uu","hi","hello","hey",
    "сайн уу","сайн байна уу","сайн байн уу","сайнуу","мэнд","мэндээ",
  ];
  return greetings.includes(q) || (q.length <= 28 && greetings.some(g => q === g || q.startsWith(g + " ")));
}

// ═════════════════════════════════════════════════════════════════════════════
// § 5  SQL DATA FETCHERS
// ═════════════════════════════════════════════════════════════════════════════

async function fetchAssistantContext() {
  const today = localDate();
  const [faults, traffic, work, lightSchedules] = await Promise.all([
    all("SELECT status, COUNT(*) count, COALESCE(SUM(broken_count),0) broken FROM sl_faults GROUP BY status").catch(() => []),
    all("SELECT status, COUNT(*) count FROM assets WHERE category='Гэрлэн дохио' GROUP BY status").catch(() => []),
    all("SELECT status, COUNT(*) count FROM asset_events GROUP BY status").catch(() => []),
    fetchCurrentLightSchedules(today).catch(() => []),
  ]);
  return { today, faults, traffic, work, lightSchedules };
}

async function fetchCurrentLightSchedules(today) {
  const rows = await all(
    `SELECT category,valid_from,on_time,off_time,is_always_off,notes
     FROM light_schedule_logs WHERE valid_from<=?
     ORDER BY category, valid_from DESC, id DESC`,
    [today]
  );
  const seen = new Set(), current = [];
  for (const r of rows) {
    if (seen.has(r.category)) continue;
    seen.add(r.category);
    current.push(r);
  }
  return current;
}

async function fetchOpenFaults() {
  const [lighting, work] = await Promise.all([
    all(`SELECT status, COUNT(*) count, COALESCE(SUM(broken_count),0) broken_heads
         FROM sl_faults WHERE status IN ('Нээлттэй','Явцтай')
         GROUP BY status`).catch(() => []),
    all(`SELECT status, COUNT(*) count FROM asset_events
         WHERE status NOT IN ('Дууссан','Цуцалсан') GROUP BY status`).catch(() => []),
  ]);
  return { lighting, work };
}

async function fetchOpenLightFaults() {
  const [total, byType] = await Promise.all([
    get(`SELECT COUNT(*) count, COALESCE(SUM(broken_count),0) broken, COALESCE(SUM(fixed_count),0) fixed
         FROM sl_faults WHERE status IN ('Нээлттэй','Явцтай')`).catch(() => ({ count:0, broken:0, fixed:0 })),
    all(`SELECT category, COUNT(*) cnt, COALESCE(SUM(broken_count),0) broken
         FROM sl_faults WHERE status IN ('Нээлттэй','Явцтай')
         GROUP BY category ORDER BY broken DESC`).catch(() => []),
  ]);
  return { total, byType };
}

function extractFaultSearchTerm(question) {
  const q = cyrillize(String(question || "").toLowerCase());
  const code = q.match(/гт-\s*\d+/i);
  if (code) return code[0].replace(/\s+/g, "").toUpperCase();
  const known = ["чойбалсан", "мэнэн", "хэрлэн", "ламжав", "шинэ мэнэн", "зүүн чойбалсан"];
  return known.find(k => q.includes(k)) || "";
}

async function fetchLocationLightFaults(question) {
  const term = extractFaultSearchTerm(question);
  if (!term) return { term: "", rows: [] };
  const like = `%${term}%`;
  const rows = await all(
    `SELECT f.id, f.category, f.location_name, f.total_heads, f.broken_count, f.fixed_count,
            f.status, f.report_date, f.notes, p.code point_code, p.name point_name
     FROM sl_faults f
     LEFT JOIN sl_points p ON p.id=f.location_id
     WHERE (LOWER(f.location_name) LIKE LOWER(?)
        OR LOWER(COALESCE(p.name,'')) LIKE LOWER(?)
        OR LOWER(COALESCE(p.code,'')) LIKE LOWER(?)
        OR CAST(f.location_id AS TEXT) LIKE ?)
       AND f.status IN ('Нээлттэй','Явцтай')
      ORDER BY f.broken_count DESC, f.report_date DESC, f.id DESC
      LIMIT 10`,
    [like, like, like, like]
  ).catch(() => []);
  return { term, rows };
}

function fmtLocationLightFaults(s) {
  if (!s.term) {
    return "Аль гудамж/байршлын гэмтэл хэрэгтэйг нэрээр нь бичээрэй. Жишээ: `Чойбалсангийн гудамжийн гэмтэл` эсвэл `ГТ-015 гэмтэл`.";
  }
  if (!s.rows.length) {
    return `**${s.term}** нэрээр нээлттэй гэрэлтүүлгийн гэмтэл олдсонгүй.\n\nГэрэлтүүлэг → Гэмтэл хэсгээс байршлын нэрээр дахин шүүж шалгана уу.`;
  }
  const totalBroken = s.rows.reduce((sum, r) => sum + Number(r.broken_count || 0), 0);
  const lines = s.rows.map(r =>
    `- #${r.id}${r.point_code ? " " + r.point_code : ""} ${r.location_name || r.point_name || "Байршилгүй"} (${r.category}) — ${r.broken_count} толгой асахгүй / нийт ${r.total_heads}, төлөв: ${r.status}${r.report_date ? " · " + r.report_date : ""}`
  );
  return `**${s.term}** байршлын нээлттэй гэмтэл (${s.rows.length} мөр): нийт **${totalBroken} толгой** асахгүй.\n\n${lines.join("\n")}\n\nДэлгэрэнгүй: Гэрэлтүүлэг → Гэмтэл.`;
}

async function fetchEmployeeGender(question) {
  const q = cyrillize(String(question || "").toLowerCase());
  const gender = q.includes("эрэгт") ? "Эрэгтэй" : "Эмэгтэй";
  const rows = await all(
    `SELECT full_name, position, department, gender
     FROM users
     WHERE active=1 AND gender=?
     ORDER BY department, full_name`,
    [gender]
  ).catch(() => []);
  return { gender, rows };
}

function fmtEmployeeGender(s) {
  if (!s.rows.length) {
    return `ERP-ийн HR бүртгэлд ${s.gender.toLowerCase()} ажилтан олдсонгүй. HR → Ажилтны бүртгэл дээр хүйсийн талбар бөглөгдсөн эсэхийг шалгана уу.`;
  }
  const lines = s.rows.map(r =>
    `- **${r.full_name}** — ${r.position || "—"}${r.department ? " · " + r.department : ""}`
  );
  return `ERP HR бүртгэлээр **${s.gender.toLowerCase()} ажилтан ${s.rows.length}** байна:\n\n${lines.join("\n")}\n\nДэлгэрэнгүй: Хүний нөөц → Ажилтны бүртгэл.`;
}

async function fetchTrafficStatus() {
  return all(
    `SELECT status, COUNT(*) count FROM assets WHERE category='Гэрлэн дохио' GROUP BY status`
  ).catch(() => []);
}

async function fetchTrafficSignalLog(question) {
  const q = cyrillize(String(question || "").toLowerCase());
  // Extract datetime from question (YYYY-MM-DD or YYYY-MM-DD HH:MM)
  const dtMatch = q.match(/(\d{4}[./-]\d{1,2}[./-]\d{1,2}(?:\s+\d{1,2}:\d{2})?)/);
  const at = dtMatch ? dtMatch[1].replace(/[./]/g, "-") : null;

  const [recentLogs, assets] = await Promise.all([
    all(`SELECT l.*, a.name asset_name, a.location asset_location, u.full_name recorded_by_name
         FROM traffic_signal_status_logs l
         LEFT JOIN assets a ON a.id=l.asset_id
         LEFT JOIN users u ON u.id=l.recorded_by
         ORDER BY l.started_at DESC LIMIT 8`).catch(() => []),
    all(`SELECT id, name, location FROM assets WHERE category='Гэрлэн дохио' ORDER BY name LIMIT 20`).catch(() => []),
  ]);

  let matchedAt = null;
  if (at) {
    matchedAt = await get(
      `SELECT l.*, a.name asset_name, a.location asset_location, u.full_name recorded_by_name
       FROM traffic_signal_status_logs l
       LEFT JOIN assets a ON a.id=l.asset_id
       LEFT JOIN users u ON u.id=l.recorded_by
       WHERE l.started_at<=? AND (l.ended_at IS NULL OR l.ended_at='' OR l.ended_at>=?)
       ORDER BY l.started_at DESC LIMIT 1`,
      [at, at]
    ).catch(() => null);
  }

  return { at, matchedAt, recentLogs, assets };
}

function fmtTrafficSignalLog(s) {
  if (!s.at && !s.recentLogs.length) {
    return "Гэрлэн дохионы цагийн журнал ERP-д бүртгэгдээгүй байна.\n\nОбъектийн бүртгэл → Гэрлэн дохио → 🕒 товчоор статус бүртгэж эхлэнэ үү.";
  }

  if (s.at) {
    if (s.matchedAt) {
      const m = s.matchedAt;
      const isOn = ["Асаалтай", "Ажиллаж байна", "Normal"].includes(m.status);
      const icon = isOn ? "🟢" : "🔴";
      return (
        `**${s.at}** цагийн байдлаар гэрлэн дохионы журнал:\n\n` +
        `${icon} **${m.status}** — ${m.asset_name || "?"} (${m.asset_location || "—"})\n` +
        `Эхэлсэн: ${m.started_at}${m.ended_at ? ` · Дууссан: ${m.ended_at}` : " · (одоо хүртэл)"}\n` +
        (m.evidence_no ? `Баримтын дугаар: **${m.evidence_no}**\n` : "") +
        (m.source ? `Эх сурвалж: ${m.source}\n` : "") +
        (m.notes ? `Тэмдэглэл: ${m.notes}\n` : "") +
        (m.recorded_by_name ? `Бүртгэсэн: ${m.recorded_by_name}` : "") +
        `\n\nЦагдаагийн байгууллагад өгөх баримт бол Объектийн бүртгэл → Гэрлэн дохио → 🔎 товчоор хэвлэнэ үү.`
      );
    }
    return (
      `**${s.at}** цагийн журнал ERP-д олдсонгүй.\n\n` +
      `Энэ цагт бүртгэл хийгдээгүй, эсвэл дохио тухайн цагт систем дотор бүртгэгдэгүй байж болно.\n` +
      `Одоогийн журналыг шалгана уу:` +
      (s.recentLogs.length ? `\n${s.recentLogs.slice(0,3).map(r => `- ${r.started_at}: **${r.status}** — ${r.asset_name||"?"}`).join("\n")}` : "")
    );
  }

  const lines = s.recentLogs.map(r =>
    `- **${r.started_at}**${r.ended_at ? `→${r.ended_at}` : " (одоо)"}: ${r.status} — ${r.asset_name||"?"} (${r.asset_location||"—"})${r.evidence_no ? ` 📄${r.evidence_no}` : ""}`
  ).join("\n");
  return (
    `Гэрлэн дохионы сүүлийн журнал (${s.recentLogs.length}):\n\n${lines}\n\n` +
    `Тухайн ослын огноо цагийг хэлбэл тухайн үеийн статусыг шалгаж өгье.\n` +
    `Объектийн бүртгэл → Гэрлэн дохио → 🔎 товчоор нотлох баримт гаргана.`
  );
}

async function fetchLowStock() {
  return all(`
    SELECT m.name, m.unit, m.min_qty,
      ROUND(
        m.opening_qty
        + COALESCE((SELECT SUM(CASE WHEN txn_type IN ('INCOME','INTERNAL_IN') THEN qty ELSE 0 END)
                    FROM wh_transactions t WHERE t.material_id=m.id),0)
        - COALESCE((SELECT SUM(CASE WHEN txn_type IN ('EXPENSE','INTERNAL_OUT') THEN qty ELSE 0 END)
                    FROM wh_transactions t WHERE t.material_id=m.id),0)
      ,2) AS balance
    FROM wh_materials m
    WHERE m.min_qty > 0
    HAVING balance <= m.min_qty
    ORDER BY (balance - m.min_qty) ASC
    LIMIT 10
  `).catch(() => []);
}

async function fetchMonthlyExpenses() {
  const ym = localDate().slice(0, 7);
  return all(
    `SELECT type, ROUND(SUM(amount),0) total
     FROM expenses WHERE strftime('%Y-%m',expense_date)=?
     GROUP BY type ORDER BY total DESC`,
    [ym]
  ).catch(() => []);
}

async function fetchBudgetProgress() {
  const year = localDate().slice(0, 4);
  const [spent, planned] = await Promise.all([
    get(`SELECT COALESCE(SUM(cost_amount),0) total
         FROM asset_events WHERE strftime('%Y',created_at)=?`, [year]).catch(() => ({ total:0 })),
    get(`SELECT COALESCE(SUM(budget),0) total FROM plans WHERE year=?`, [year]).catch(() => ({ total:0 })),
  ]);
  return { year, spent: Number(spent.total||0), planned: Number(planned.total||0) };
}

async function fetchOpenSafetyReports() {
  return all(
    `SELECT COALESCE(risk_level,'Тодорхойгүй') risk_level, COUNT(*) count
     FROM safety_reports
     WHERE status='Нээлттэй' OR (workflow_status IS NOT NULL AND workflow_status NOT IN ('Хаасан','Дууссан'))
     GROUP BY COALESCE(risk_level,'Тодорхойгүй') ORDER BY count DESC`
  ).catch(() => []);
}

async function fetchHabeaWorkStatus() {
  const [missing, recent] = await Promise.all([
    all(`SELECT w.title, w.category, w.work_date, w.status,
              pre.full_name pre_by_name, w.habea_pre_status,
              post.full_name post_by_name, w.habea_post_status
         FROM asset_events w
         LEFT JOIN users pre  ON pre.id  = w.habea_pre_by
         LEFT JOIN users post ON post.id = w.habea_post_by
         WHERE w.status NOT IN ('Цуцалсан')
           AND date(COALESCE(w.work_date,w.created_at)) >= date('now','-30 days')
           AND (w.habea_pre_status IS NULL OR w.habea_pre_status=''
             OR w.habea_post_status IS NULL OR w.habea_post_status='')
         ORDER BY COALESCE(w.work_date,w.created_at) DESC LIMIT 10`).catch(() => []),
    all(`SELECT w.title, w.category, w.work_date, w.status,
              w.habea_pre_status, w.habea_pre_at, w.habea_pre_note,
              w.habea_post_status, w.habea_post_at, w.habea_post_note,
              pre.full_name pre_by_name, post.full_name post_by_name
         FROM asset_events w
         LEFT JOIN users pre  ON pre.id  = w.habea_pre_by
         LEFT JOIN users post ON post.id = w.habea_post_by
         WHERE w.habea_pre_status IS NOT NULL AND w.habea_pre_status!=''
         ORDER BY COALESCE(w.work_date,w.created_at) DESC LIMIT 5`).catch(() => []),
  ]);
  return { missing, recent };
}

function fmtHabeaWorkStatus(s) {
  const lines = [];
  if (s.missing.length) {
    lines.push(`⚠ ХАБЭА шалгалт дутуу байгаа ажил (сүүлийн 30 хоног): **${s.missing.length}**\n`);
    s.missing.slice(0, 6).forEach(w => {
      const noPre  = !w.habea_pre_status;
      const noPost = !w.habea_post_status;
      const flags  = [noPre ? "урьдчилсан шалгалт дутуу" : "", noPost ? "дараах шалгалт дутуу" : ""].filter(Boolean).join(", ");
      lines.push(`- **${w.title || "Ажил"}** (${w.work_date || "—"}) · ${flags}`);
    });
  } else {
    lines.push("✅ Сүүлийн 30 хоногт бүх ажилд ХАБЭА шалгалт бүртгэгдсэн байна.");
  }
  if (s.recent.length) {
    lines.push(`\nСүүлд бүртгэгдсэн ХАБЭА шалгалт:\n`);
    s.recent.forEach(w => {
      const pre  = w.habea_pre_status  ? `✅ Урьдчилсан: ${w.habea_pre_status}${w.pre_by_name  ? " · " + w.pre_by_name  : ""}` : "";
      const post = w.habea_post_status ? `✅ Дараах: ${w.habea_post_status}${w.post_by_name ? " · " + w.post_by_name : ""}` : "";
      lines.push(`- **${w.title || "Ажил"}** (${w.work_date || "—"})\n  ${[pre, post].filter(Boolean).join(" · ")}`);
    });
  }
  if (!s.missing.length && !s.recent.length) {
    return "ХАБЭА-н ажлын явцын бүртгэл ERP-д олдсонгүй.\n\nАжлын явц → ажлын картаас ХАБЭА урьдчилсан болон дараах шалгалтыг бүртгэнэ үү.";
  }
  return lines.join("\n") + "\n\nАжлын явц → ажлын картаас ХАБЭА шалгалт бүртгэнэ.";
}

async function fetchContractExpiry() {
  return all(`
    SELECT title, counterparty, end_date,
      CAST(julianday(end_date) - julianday('now') AS INTEGER) days_left
    FROM org_contracts
    WHERE end_date IS NOT NULL AND end_date != ''
      AND julianday(end_date) >= julianday('now')
      AND julianday(end_date) - julianday('now') <= 60
      AND status='Хүчинтэй'
    ORDER BY end_date ASC LIMIT 5
  `).catch(() => []);
}

async function fetchAssetWarranty() {
  return all(`
    SELECT name, category, warranty_until,
      CAST(julianday(warranty_until) - julianday('now') AS INTEGER) days_left
    FROM assets
    WHERE warranty_until IS NOT NULL AND warranty_until != ''
      AND julianday(warranty_until) >= julianday('now')
      AND julianday(warranty_until) - julianday('now') <= 90
    ORDER BY warranty_until ASC LIMIT 5
  `).catch(() => []);
}

async function fetchTrainingSchedule() {
  return all(`
    SELECT title, type, start_date, end_date, location, status
    FROM trainings
    WHERE (start_date >= date('now') OR status='Явагдаж байна')
      AND status != 'Цуцалсан'
    ORDER BY start_date ASC LIMIT 5
  `).catch(() => []);
}

async function fetchOverdueWork() {
  const [row, items] = await Promise.all([
    get(`SELECT COUNT(*) count FROM asset_events
         WHERE status NOT IN ('Дууссан','Цуцалсан')
           AND end_date IS NOT NULL AND end_date!=''
           AND end_date < date('now')`).catch(() => ({ count:0 })),
    all(`SELECT title, category, end_date, status,
          CAST(julianday('now') - julianday(end_date) AS INTEGER) days_over
         FROM asset_events
         WHERE status NOT IN ('Дууссан','Цуцалсан')
           AND end_date IS NOT NULL AND end_date!=''
           AND end_date < date('now')
         ORDER BY end_date ASC LIMIT 5`).catch(() => []),
  ]);
  return { count: Number(row.count||0), items };
}

async function fetchEmployeeCount() {
  const [total, byStatus, byDept] = await Promise.all([
    get("SELECT COUNT(*) count FROM users WHERE active=1").catch(() => ({ count:0 })),
    all(`SELECT COALESCE(status_hr,'Идэвхтэй') status, COUNT(*) count
         FROM users WHERE active=1 GROUP BY COALESCE(status_hr,'Идэвхтэй')`).catch(() => []),
    all(`SELECT COALESCE(department,'Бусад') department, COUNT(*) count
         FROM users WHERE active=1
         GROUP BY COALESCE(department,'Бусад') ORDER BY count DESC LIMIT 6`).catch(() => []),
  ]);
  return { total: Number(total.count||0), byStatus, byDept };
}

async function fetchEmployeeByRole(question) {
  const q = cyrillize(question.toLowerCase());
  const isCamera = q.includes("камер");
  const roleMap = [
    { keywords: ["хүний нөөц","hr менежер","hr ажилтан"], roles: ["hr"] },
    { keywords: ["камерын инженер","камер инженер","камер"], roles: ["camera_engineer"] },
    { keywords: ["цахилгааны инженер"], roles: ["engineer","chief_engineer"] },
    { keywords: ["цахилгааны инженер","инженер"], roles: ["engineer","chief_engineer"] },
    { keywords: ["цахилгаанчин"],                 roles: ["electric"] },
    { keywords: ["нягтлан"],                      roles: ["accountant"] },
    { keywords: ["нярав"],                        roles: ["storekeeper"] },
    { keywords: ["хабэа","аюулгүй"],              roles: ["safety"] },
    { keywords: ["захирал"],                      roles: ["director"] },
    { keywords: ["ажилчид","бүх ажилтан","нэрсийг","нэрс"],
                                                  roles: ["director","chief_engineer","engineer","electric","safety","storekeeper","hr","accountant","camera_engineer","worker"] },
    { keywords: ["ажилтан"],                      roles: ["engineer","electric","safety","storekeeper","hr","accountant","camera_engineer","worker"] },
  ];
  let roles = [];
  for (const { keywords, roles: r } of roleMap) {
    if (keywords.some(k => q.includes(k))) { roles = r; break; }
  }
  if (!roles.length) return [];
  if (isCamera) {
    return all(
      `SELECT full_name, position, department, role, phone
       FROM users
       WHERE active=1 AND (
         role='camera_engineer'
         OR LOWER(position) LIKE '%камер%'
         OR LOWER(department) LIKE '%камер%'
       )
       ORDER BY CASE WHEN role='camera_engineer' THEN 0 ELSE 1 END, full_name`
    ).catch(() => []);
  }
  const ph = roles.map(() => "?").join(",");
  const rows = await all(
    `SELECT full_name, position, department, role, phone FROM users WHERE active=1 AND role IN (${ph}) ORDER BY full_name`,
    roles
  ).catch(() => []);
  const nameHit = rows.filter(r => {
    const parts = String(r.full_name || "").toLowerCase().split(/\s+/).filter(Boolean);
    return parts.some(p => p.length >= 3 && q.includes(p));
  });
  return nameHit.length ? nameHit : rows;
}

async function fetchMyPhone(userId) {
  return get(
    `SELECT full_name, position, department, phone FROM users WHERE id=?`,
    [userId]
  ).catch(() => null);
}

function fmtMyPhone(row, user = {}) {
  if (!row) return "Таны ажилтны бүртгэл ERP дээр олдсонгүй.";
  const canSee = ["director", "hr"].includes(user.role);
  if (!canSee) {
    return "Өөрийн утасны дугаарыг HR → Миний мэдээлэл эсвэл ажилтны картаас шалгана уу.";
  }
  return `**${row.full_name || user.full_name || user.username}** — ${row.position || ""}${row.department ? " · " + row.department : ""}\n\nУтас: **${row.phone || "бүртгэлгүй"}**`;
}

function parseBillMonth(question) {
  const q = cyrillize(String(question || "").toLowerCase());
  const now = new Date();
  let year = now.getFullYear();
  const yearM = q.match(/(20\d{2})/);
  if (yearM) year = Number(yearM[1]);
  const numM = q.match(/\b(\d{1,2})\s*(?:-?р|r)?\s*сарын/);
  const shortM = q.match(/\b(\d{1,2})\s*(?:-?р|r)?\s*sariinh\b/);
  if (shortM) {
    const month = Number(shortM[1]);
    if (month >= 1 && month <= 12) return { year, month };
  }
  if (numM) {
    const month = Number(numM[1]);
    if (month >= 1 && month <= 12) return { year, month };
  }
  const mn = [
    ["нэгдүгээр",1],["хоёрдугаар",2],["гуравдугаар",3],["дөрөвдүгээр",4],
    ["тавдугаар",5],["зургадугаар",6],["долдугаар",7],["наймдугаар",8],
    ["есдүгээр",9],["аравдугаар",10],["арваннэгдүгээр",11],["арванхоёрдугаар",12],
  ];
  for (const [name, month] of mn) {
    if (q.includes(name)) return { year, month };
  }
  return null;
}

async function fetchElectricityBill(question) {
  const target = parseBillMonth(question);
  if (target) {
    const bill = await get(
      `SELECT * FROM electricity_bill_imports
       WHERE billing_year=? AND billing_month=?
       ORDER BY CASE status WHEN 'confirmed' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, id DESC
       LIMIT 1`,
      [target.year, target.month]
    ).catch(() => null);
    return { target, bill, latest: false };
  }
  const bill = await get(
    `SELECT * FROM electricity_bill_imports
     ORDER BY billing_year DESC, billing_month DESC, id DESC LIMIT 1`
  ).catch(() => null);
  return { target: bill ? { year: bill.billing_year, month: bill.billing_month } : null, bill, latest: true };
}

function fmtElectricityBill(s, question = "") {
  if (!s.bill) {
    const period = s.target ? `${s.target.year}-${String(s.target.month).padStart(2,"0")}` : "сүүлийн";
    return `${period} сарын цахилгааны төлбөр ERP дээр олдсонгүй.\n\nГэрэлтүүлэг → Цахилгааны төлбөр → Нэхэмжлэл хэсгээс импорт/баталгаажуулалт шалгана уу.`;
  }
  const b = s.bill;
  const period = `${b.billing_year}-${String(b.billing_month).padStart(2,"0")}`;
  const status = b.status === "confirmed" ? "Баталгаажсан" : b.status === "pending" ? "Хүлээгдэж буй" : (b.status || "—");
  const wantsDiff = cyrillize(question.toLowerCase()).includes("зөрүү") || cyrillize(question.toLowerCase()).includes("төлөвлө");
  const diffAmount = Number(b.total_amount || 0) - Number(b.our_amount || 0);
  const diffKwh = Number(b.total_kwh || 0) - Number(b.our_kwh || 0);
  return (
    `${s.latest ? "Сүүлийн" : "Сонгосон"} цахилгааны төлбөр (${period}):\n\n` +
    `- Нийт дүн: **${money(b.total_amount)}**\n` +
    `- Манай дүн: **${money(b.our_amount)}**\n` +
    `- Нийт хэрэглээ: ${Number(b.total_kwh || 0).toLocaleString("mn-MN")} кВт.ц\n` +
    `- Манай хэрэглээ: ${Number(b.our_kwh || 0).toLocaleString("mn-MN")} кВт.ц\n` +
    `- Төлөв: ${status}\n` +
    (wantsDiff ? `- Зөрүү: **${money(diffAmount)}**, ${diffKwh.toLocaleString("mn-MN")} кВт.ц\n` : "") +
    `\n` +
    `Дэлгэрэнгүй: Гэрэлтүүлэг → Цахилгааны төлбөр → Нэхэмжлэл.`
  );
}

function periodFromQuestion(question) {
  const q = cyrillize(String(question || "").toLowerCase());
  const today = localDate();
  if (q.includes("өнөөдөр")) return { from: today, to: today, label: "өнөөдөр" };
  if (q.includes("өнгөрсөн 7 хоног") || q.includes("7 хоног")) {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return { from: d.toISOString().slice(0, 10), to: today, label: "өнгөрсөн 7 хоног" };
  }
  return { from: today, to: today, label: "өнөөдөр" };
}

async function resolveActivityUsers(question, convHistory = []) {
  const q = cyrillize(String(question || "").toLowerCase());
  let rows = [];
  if (q.includes("хүний нөөц")) rows = await fetchEmployeeByRole("хүний нөөц нэр");
  else if (q.includes("хабэа")) rows = await fetchEmployeeByRole("хабэа нэр");
  else if (q.includes("камер")) rows = await fetchEmployeeByRole("камерын инженер нэр");
  else if (q.includes("билгүүн")) rows = await all(`SELECT full_name, position, department, role, phone, id FROM users WHERE active=1 AND LOWER(full_name) LIKE '%билгүүн%'`).catch(() => []);
  else {
    const name = lastEmployeeNameFromHistory(convHistory);
    if (name) rows = await all(`SELECT full_name, position, department, role, phone, id FROM users WHERE active=1 AND LOWER(full_name) LIKE LOWER(?)`, [`%${name}%`]).catch(() => []);
  }
  if (rows.length && rows[0].id) return rows;
  if (!rows.length) return [];
  const names = rows.map(r => r.full_name).filter(Boolean);
  if (!names.length) return [];
  const ph = names.map(() => "?").join(",");
  return all(`SELECT id, full_name, position, department, role, phone FROM users WHERE full_name IN (${ph})`, names).catch(() => []);
}

async function fetchWorkActivity(question, convHistory = []) {
  const period = periodFromQuestion(question);
  const users = await resolveActivityUsers(question, convHistory);
  if (!users.length) return { period, users: [], works: [], audits: [] };
  const ids = users.map(u => u.id).filter(Boolean);
  const ph = ids.map(() => "?").join(",");
  const params = [period.from, period.to, ...ids, ...ids, ...ids, ...ids, ...ids];
  const works = await all(
    `SELECT w.title, w.category, w.department, w.status, w.progress, w.work_date, w.created_at,
            c.full_name created_name, a.full_name assigned_name
     FROM asset_events w
     LEFT JOIN users c ON c.id=w.created_by
     LEFT JOIN users a ON a.id=w.assigned_to
     WHERE date(COALESCE(w.work_date,w.created_at)) BETWEEN ? AND ?
       AND (
         w.created_by IN (${ph}) OR w.assigned_to IN (${ph}) OR w.confirmed_by IN (${ph})
         OR w.habea_pre_by IN (${ph}) OR w.habea_post_by IN (${ph})
       )
     ORDER BY COALESCE(w.work_date,w.created_at) DESC, w.id DESC
     LIMIT 12`,
    params
  ).catch(() => []);
  const auditParams = [period.from, period.to, ...ids];
  const audits = await all(
    `SELECT action, entity, entity_id, detail, created_at
     FROM audit_logs
     WHERE date(created_at) BETWEEN ? AND ? AND user_id IN (${ph})
     ORDER BY created_at DESC LIMIT 12`,
    auditParams
  ).catch(() => []);
  return { period, users, works, audits };
}

function fmtWorkActivity(s) {
  const who = s.users.map(u => `${u.full_name} (${u.position || u.role || ""})`).join(", ");
  if (!s.users.length) return "ERP дээр тухайн ажилтныг тодорхойлж чадсангүй. Нэр эсвэл албан тушаалыг тодруулж бичээрэй.";
  const workLines = s.works.map(w =>
    `- ${w.work_date || String(w.created_at || "").slice(0,10)} · ${w.title || "Ажил"} · ${w.status || "—"}${w.assigned_name ? " · хариуцагч: " + w.assigned_name : ""}`
  );
  const auditLines = s.audits.map(a =>
    `- ${String(a.created_at || "").slice(0,16)} · ${a.action} ${a.entity}${a.detail ? " · " + a.detail : ""}`
  );
  if (!workLines.length && !auditLines.length) {
    return `${who}\n\n${s.period.label} ERP дээр ажил/өөрчлөлтийн бүртгэл олдсонгүй. Энэ нь ажил хийгээгүй гэсэн эцсийн дүгнэлт биш, зөвхөн ERP-д бүртгэгдээгүй байна гэсэн үг.`;
  }
  return (
    `${who}\n\n${s.period.label} ERP дээр харагдсан бүртгэл:\n\n` +
    (workLines.length ? `Ажлын явц:\n${workLines.join("\n")}\n\n` : "") +
    (auditLines.length ? `Системийн журнал:\n${auditLines.join("\n")}\n\n` : "") +
    `Дэлгэрэнгүй: Ажлын явц болон Audit журнал.`
  );
}

async function fetchMyWork(user) {
  const rows = await all(
    `SELECT w.title, w.category, w.department, w.status, w.progress, w.work_date,
            w.start_date, w.end_date, w.created_at,
            c.full_name created_name, a.full_name assigned_name
     FROM asset_events w
     LEFT JOIN users c ON c.id=w.created_by
     LEFT JOIN users a ON a.id=w.assigned_to
     WHERE w.created_by=? OR w.assigned_to=? OR w.confirmed_by=?
        OR w.habea_pre_by=? OR w.habea_post_by=?
     ORDER BY CASE WHEN COALESCE(w.status,'') IN ('Хаагдсан','Дууссан','Цуцалсан') THEN 1 ELSE 0 END,
              COALESCE(w.work_date,w.start_date,w.created_at) DESC,
              w.id DESC
     LIMIT 12`,
    [user.id, user.id, user.id, user.id, user.id]
  ).catch(() => []);
  return { user, rows };
}

function fmtMyWork(s) {
  if (!s.rows.length) {
    return `${s.user.full_name || "Таны"} нэр дээр ERP-ийн Ажлын явц модульд ажил олдсонгүй.\n\nДэлгэрэнгүй шалгах бол Ажлын явц → “Миний ажил” эсвэл хариуцагчаар нэрээ шүүнэ үү.`;
  }
  const active = s.rows.filter(r => !["Хаагдсан", "Дууссан", "Цуцалсан"].includes(r.status || "")).length;
  const lines = s.rows.map(w => {
    const date = w.work_date || w.start_date || String(w.created_at || "").slice(0, 10);
    const owner = w.assigned_name ? ` · хариуцагч: ${w.assigned_name}` : "";
    const pct = Number.isFinite(Number(w.progress)) ? ` · ${w.progress}%` : "";
    return `- ${date || "огноогүй"} · ${w.title || "Ажил"} · ${w.status || "—"}${pct}${owner}`;
  });
  return `${s.user.full_name || "Таны"} нэртэй холбоотой ажил: **${s.rows.length}**, үүнээс идэвхтэй **${active}**.\n\n${lines.join("\n")}\n\nДэлгэрэнгүй: Ажлын явц → Миний ажил.`;
}

function fmtEmployeeByRole(rows, question = "", user = {}) {
  if (!rows.length)
    return "ERP бүртгэлд тохирох идэвхтэй ажилтан олдсонгүй.\n\nХР → Ажилтны бүртгэл хэсгээс бүрэн жагсаалт харна уу.";
  const q = cyrillize(String(question || "").toLowerCase());
  const wantsPhone = q.includes("утас") || q.includes("дугаар");
  const canSeePhone = ["director", "hr"].includes(user.role);
  const lines = rows.map(r =>
    `- **${r.full_name || "—"}** — ${r.position || r.role}${r.department ? " · " + r.department : ""}` +
    (wantsPhone ? (canSeePhone ? ` · Утас: ${r.phone || "бүртгэлгүй"}` : " · Утас: эрх хүрэхгүй") : "")
  );
  const note = wantsPhone && !canSeePhone
    ? "\n\nУтасны дугаарыг зөвхөн захирал болон HR эрхтэй хэрэглэгч харна."
    : "";
  return `ERP бүртгэлийн дагуу (${rows.length} ажилтан):\n\n${lines.join("\n")}${note}\n\nДэлгэрэнгүй мэдээлэл: HR → Ажилтны бүртгэл`;
}

function lastEmployeeNameFromHistory(convHistory = []) {
  const items = Array.isArray(convHistory) ? convHistory.slice().reverse() : [];
  for (const m of items) {
    const text = String(m?.text || "");
    const bold = text.match(/\*\*([^*]{3,80})\*\*/);
    if (bold) return bold[1].trim();
    const line = text.match(/-\s+([А-Яа-яӨөҮүЁёA-Za-z-]+(?:\s+[А-Яа-яӨөҮүЁёA-Za-z-]+){0,2})\s+—/);
    if (line) return line[1].trim();
  }
  return "";
}

async function fetchEmployeePhoneFromHistory(convHistory, user) {
  const canSeePhone = ["director", "hr"].includes(user.role);
  const name = lastEmployeeNameFromHistory(convHistory);
  if (!name) return { name: "", row: null, canSeePhone };
  const row = await get(
    `SELECT full_name, position, department, phone FROM users
     WHERE active=1 AND LOWER(full_name) LIKE LOWER(?)
     ORDER BY LENGTH(full_name) ASC LIMIT 1`,
    [`%${name}%`]
  ).catch(() => null);
  return { name, row, canSeePhone };
}

function fmtEmployeePhoneFollowup(s) {
  if (!s.name) {
    return "Аль ажилтны утасны дугаар хэрэгтэйг нэрээр нь бичээрэй. Жишээ: `Цэлмэгийн утасны дугаар`.";
  }
  if (!s.row) {
    return `ERP дээр **${s.name}** нэртэй идэвхтэй ажилтан олдсонгүй. HR → Ажилтны бүртгэлээс шалгана уу.`;
  }
  if (!s.canSeePhone) {
    return `**${s.row.full_name}** — ${s.row.position || ""}${s.row.department ? " · " + s.row.department : ""}\n\nУтасны дугаарыг зөвхөн захирал болон HR эрхтэй хэрэглэгч харна.`;
  }
  return `**${s.row.full_name}** — ${s.row.position || ""}${s.row.department ? " · " + s.row.department : ""}\n\nУтас: **${s.row.phone || "бүртгэлгүй"}**`;
}

async function fetchCameraCount() {
  const [byStatus, total] = await Promise.all([
    all(`SELECT COALESCE(status,'Идэвхтэй') status, COUNT(*) count
         FROM assets
         WHERE category LIKE '%амер%' OR category LIKE '%камер%'
            OR name LIKE '%камер%' OR name LIKE '%camera%'
         GROUP BY COALESCE(status,'Идэвхтэй') ORDER BY count DESC`).catch(() => []),
    get(`SELECT COUNT(*) count FROM assets
         WHERE category LIKE '%амер%' OR category LIKE '%камер%'
            OR name LIKE '%камер%' OR name LIKE '%camera%'`).catch(() => ({ count: 0 })),
  ]);
  return { byStatus, total: Number(total.count || 0) };
}

function fmtCameraCount(s) {
  if (!s.total)
    return "ERP-д камер бүртгэгдээгүй байна.\n\nОбъектийн бүртгэл → Камер хэсгийг шалгана уу.";
  const lines = s.byStatus.map(r => `- ${r.status}: **${r.count}**`);
  return (
    `ERP-д бүртгэлтэй камерын тоо:\n\n**Нийт: ${s.total}**\n\n` +
    (lines.length ? lines.join("\n") : "") +
    `\n\nДэлгэрэнгүй: Объектийн бүртгэл → Камер`
  );
}

async function fetchPoleCount() {
  const [road, ger, tower] = await Promise.all([
    get(`SELECT COUNT(*) locations,
          COALESCE(SUM(lamp_count),0) poles,
          COALESCE(SUM(CASE WHEN total_heads>0 THEN total_heads ELSE lamp_count END),0) heads
         FROM sl_points WHERE code LIKE 'ГТ-%'`).catch(() => ({ locations:0, poles:0, heads:0 })),
    get(`SELECT COUNT(*) locations,
          COALESCE(SUM(total_count),0) poles,
          COALESCE(SUM(CASE WHEN head_count>0 THEN head_count ELSE total_count END),0) heads
         FROM sl_ger_inventory WHERE category='Гэр хороолол'`).catch(() => ({ locations:0, poles:0, heads:0 })),
    get(`SELECT COUNT(*) locations,
          COALESCE(SUM(total_count),0) poles,
          COALESCE(SUM(CASE WHEN head_count>0 THEN head_count ELSE total_count END),0) heads
         FROM sl_ger_inventory WHERE category='Цамхаг'`).catch(() => ({ locations:0, poles:0, heads:0 })),
  ]);
  const totalPoles = Number(road.poles||0) + Number(ger.poles||0) + Number(tower.poles||0);
  const totalHeads = Number(road.heads||0) + Number(ger.heads||0) + Number(tower.heads||0);
  return { road, ger, tower, totalPoles, totalHeads };
}

async function fetchAssetValue() {
  const [fixed, assets, oldWH, newWH, finance] = await Promise.all([
    get(`SELECT COUNT(*) count,
          COALESCE(SUM(book_value),0) book_value,
          COALESCE(SUM(initial_value),0) initial_value
         FROM fixed_assets_ledger`).catch(() => ({ count:0, book_value:0, initial_value:0 })),
    get(`SELECT COUNT(*) count,
          COALESCE(SUM(CASE WHEN current_value>0 THEN current_value ELSE purchase_price END),0) value
         FROM assets`).catch(() => ({ count:0, value:0 })),
    get(`SELECT COALESCE(SUM(balance*price),0) value FROM warehouse_items`).catch(() => ({ value:0 })),
    get(`SELECT COALESCE(SUM(
          (m.opening_qty
           + COALESCE((SELECT SUM(CASE WHEN txn_type IN ('INCOME','INTERNAL_IN') THEN qty ELSE 0 END)
                       FROM wh_transactions t WHERE t.material_id=m.id),0)
           - COALESCE((SELECT SUM(CASE WHEN txn_type IN ('EXPENSE','INTERNAL_OUT') THEN qty ELSE 0 END)
                       FROM wh_transactions t WHERE t.material_id=m.id),0)
          ) * m.unit_price
        ),0) value FROM wh_materials m`).catch(() => ({ value:0 })),
    get(`SELECT
          COALESCE((SELECT SUM(amount) FROM cash_journal WHERE txn_type='Орлого'),0)
        - COALESCE((SELECT SUM(amount) FROM cash_journal WHERE txn_type='Зарлага'),0) cash_balance,
          COALESCE((SELECT SUM(amount-received_amount) FROM accounts_receivable WHERE status!='Хүлээн авсан'),0) receivable,
          COALESCE((SELECT SUM(amount-paid_amount) FROM accounts_payable WHERE status!='Төлөгдсөн'),0) payable`).catch(() => ({ cash_balance:0, receivable:0, payable:0 })),
  ]);
  const fixedVal = Number(fixed.book_value||0) > 0 ? Number(fixed.book_value) : Number(fixed.initial_value||0);
  const regVal   = Number(assets.value||0);
  const whVal    = Number(oldWH.value||0) + Number(newWH.value||0);
  const finNet   = Number(finance.cash_balance||0) + Number(finance.receivable||0) - Number(finance.payable||0);
  return { fixed, assets, fixedVal, regVal, whVal, finNet, total: (fixedVal || regVal) + whVal + finNet };
}

async function fetchTodayAttendance(today) {
  const [activeRow, rows] = await Promise.all([
    get("SELECT COUNT(*) count FROM users WHERE active=1 AND COALESCE(status_hr,'Идэвхтэй')='Идэвхтэй'").catch(() => ({ count:0 })),
    all(`SELECT record_type, COUNT(DISTINCT user_id) count FROM hr_records
         WHERE start_date<=? AND COALESCE(end_date,start_date)>=?
         GROUP BY record_type`, [today, today]).catch(() => []),
  ]);
  const by = Object.fromEntries(rows.map(r => [r.record_type, Number(r.count||0)]));
  const present = (by["Ажилласан"]||0) + (by["Хоцорсон"]||0) + (by["Илүү цаг"]||0);
  return { today, active: Number(activeRow.count||0), present, by };
}

async function fetchMySalary(userId) {
  const now  = new Date();
  const year = now.getFullYear(), month = now.getMonth() + 1;
  const [payroll, user] = await Promise.all([
    get(`SELECT * FROM payroll_timesheet WHERE user_id=? AND year=? AND month=?`,
        [userId, year, month]).catch(() => null),
    get(`SELECT salary,skill_allowance,tenure_allowance,meal_allowance FROM users WHERE id=?`,
        [userId]).catch(() => null),
  ]);
  return { year, month, payroll, user };
}

// ═════════════════════════════════════════════════════════════════════════════
// § 6  ANSWER FORMATTERS
// ═════════════════════════════════════════════════════════════════════════════

function fmtLightSchedule(ctx) {
  const rows = ctx.lightSchedules || [];
  if (!rows.length)
    return "ERP дээрх бүртгэлээр өнөөдрийн гэрэлтүүлгийн цагийн тохиргоо олдсонгүй.\n\nГэрэлтүүлэг → Цаг тохиргоо хэсэгт өнөөдрийн хуваарийг бүртгээд дахин шалгаарай.";
  const lines = rows.map(r =>
    r.is_always_off
      ? `- ${r.category}: өнөөдөр унтраалттай гэж тохируулагдсан`
      : `- ${r.category}: **${r.on_time||"—"}** асаад **${r.off_time||"—"}** унтарна`
  );
  return `ERP-ийн өнөөдрийн (${ctx.today}) хүчинтэй гэрлийн хуваарь:\n\n${lines.join("\n")}\n\nАнхаарах зүйл: LoRa болон талбайн баталгаажуулалтаар бодит асалтыг тулгаж болно.`;
}

function fmtLightStatusAndSchedule(faults, ctx) {
  const faultText = fmtOpenLightFaults(faults);
  const scheduleText = fmtLightSchedule(ctx);
  return `${faultText}\n\nӨнөөдрийн асаах/унтраах хуваарь:\n${scheduleText}`;
}

function fmtPoleCount(s) {
  return (
    `ERP дээрх гэрэлтүүлгийн бүртгэлээр:\n\n` +
    `**Нийт шон: ${Number(s.totalPoles||0).toLocaleString("mn-MN")}**  |  Нийт толгой: ${Number(s.totalHeads||0).toLocaleString("mn-MN")}\n\n` +
    `- Авто замын гэрэл: ${Number(s.road.poles||0).toLocaleString("mn-MN")} шон, ${Number(s.road.heads||0).toLocaleString("mn-MN")} толгой\n` +
    `- Гэр хорооллын гэрэл: ${Number(s.ger.poles||0).toLocaleString("mn-MN")} шон, ${Number(s.ger.heads||0).toLocaleString("mn-MN")} толгой\n` +
    `- Цамхагийн гэрэл: ${Number(s.tower.poles||0).toLocaleString("mn-MN")} шон, ${Number(s.tower.heads||0).toLocaleString("mn-MN")} толгой\n\n` +
    `Анхаарах зүйл: талбайн тооллогоор баталгаажуулвал албан дүн болно.`
  );
}

function fmtAssetValue(s) {
  const src = s.fixedVal ? "нягтлангийн үндсэн хөрөнгийн дансаар" : "объектийн бүртгэлийн үнээр";
  return (
    `ERP дээрх бүртгэлээр байгууллагын тооцоолсон хөрөнгийн нийт дүн: **${money(s.total)}**\n\n` +
    `- Үндсэн хөрөнгө (${src}): ${money(s.fixedVal || s.regVal)}\n` +
    `- Агуулах/материалын үлдэгдэл: ${money(s.whVal)}\n` +
    `- Мөнгөн хөрөнгө + авлага – өглөг: ${money(s.finNet)}\n\n` +
    `Санхүүгийн албан баланс гаргахдаа нягтлангийн баталгаажсан тайлантай тулгана.`
  );
}

function fmtEmployeeCount(s) {
  const active = s.byStatus.find(x => x.status === "Идэвхтэй")?.count || s.total;
  const deptLines = s.byDept.map(x => `  - ${x.department}: ${x.count} хүн`).join("\n");
  return (
    `ERP дээрх HR бүртгэлээр нийт **${s.total} ажилтан** бүртгэлтэй.\nИдэвхтэй: ${active} хүн.\n\n` +
    (deptLines ? `Хэлтсээр:\n${deptLines}\n\n` : "") +
    `Анхаарах зүйл: зөвхөн active бүртгэлтэй ажилтнуудыг тооцов.`
  );
}

function fmtTodayAttendance(s) {
  return (
    `Өнөөдөр (${s.today}) ирцийн бүртгэлээр **${s.present} хүн** ажилдаа ирсэн.\n\n` +
    `- Нийт идэвхтэй ажилтан: ${s.active}\n` +
    `- Ажилласан: ${s.by["Ажилласан"]||0}\n` +
    `- Хоцорсон: ${s.by["Хоцорсон"]||0}\n` +
    `- Илүү цаг: ${s.by["Илүү цаг"]||0}\n` +
    `- Чөлөө/өвчтэй/амралт: ${(s.by["Чөлөө"]||0)+(s.by["Өвчтэй"]||0)+(s.by["Ээлжийн амралт"]||0)}\n\n` +
    `Анхаарах зүйл: зөвхөн бүртгэл орсон ажилтнуудыг тооцов.`
  );
}

function fmtMySalary(s) {
  if (s.payroll) {
    return (
      `${s.year}-${String(s.month).padStart(2,"0")} сарын цалингийн тооцоо:\n\n` +
      `Гар дээр авах: **${money(s.payroll.net_salary)}**\n\n` +
      `- Үндсэн цалин: ${money(s.payroll.base_salary)}\n` +
      `- Илүү цаг: ${money(s.payroll.overtime_pay)}\n` +
      `- Нэмэгдэл: ${money(s.payroll.bonuses)}\n` +
      `- Суутгал: −${money(s.payroll.deductions)}\n\n` +
      `Төлөв: ${s.payroll.status||"—"}\n\n` +
      `Анхаарах зүйл: баталгаажаагүй бол энэ нь урьдчилсан тооцоо байж болно.`
    );
  }
  const gross = [s.user?.salary,s.user?.skill_allowance,s.user?.tenure_allowance,s.user?.meal_allowance]
    .reduce((a,v) => a + Number(v||0), 0);
  return (
    `Энэ сарын payroll тооцоо одоогоор бүртгэгдээгүй байна.\n\n` +
    `HR профайл дээрх нийт суурь дүн: ${money(gross)}.\n\n` +
    `Нягтлан payroll тооцоо оруулсны дараа бодит гар дээр авах дүн харагдана.`
  );
}

function fmtOpenFaults(s) {
  const lOpen   = s.lighting.reduce((a,x) => a + Number(x.count||0), 0);
  const lBroken = s.lighting.reduce((a,x) => a + Number(x.broken_heads||0), 0);
  const wOpen   = s.work.reduce((a,x) => a + Number(x.count||0), 0);
  const wLines  = s.work.map(x => `  - ${x.status}: ${x.count}`).join("\n");
  return (
    `ERP дээрх нээлттэй гэмтлийн тойм:\n\n` +
    `**Гэрэлтүүлгийн гэмтэл:** ${lOpen} тасалбар, нийт ${lBroken} толгой асахгүй\n` +
    `**Засварын ажлын бүртгэл:** ${wOpen} нээлттэй\n` +
    (wLines ? `${wLines}\n\n` : "\n") +
    `Дэлгэрэнгүй: Гэрэлтүүлэг → Гэмтэл болон Ажлын явц хэсгүүдийг харна уу.`
  );
}

function fmtOpenLightFaults(s) {
  if (!s.total.count) return "Одоогоор нээлттэй гэрэлтүүлгийн гэмтэл байхгүй байна.";
  const lines = s.byType.map(r => `- ${r.category}: ${r.cnt} газар, ${r.broken} толгой асахгүй`).join("\n");
  return (
    `Нээлттэй гэрэлтүүлгийн гэмтэл: **${s.total.count} тасалбар**, нийт **${s.total.broken} толгой** асахгүй.\n\n` +
    `${lines}\n\n` +
    `Гэрэлтүүлэг → Гэмтэл хэсгээс дэлгэрэнгүй харна уу.`
  );
}

function fmtTrafficStatus(rows) {
  if (!rows.length)
    return "Гэрлэн дохионы бүртгэл ERP дээр олдсонгүй. Объектийн бүртгэл → Гэрлэн дохио хэсэгт оруулна уу.";
  const total = rows.reduce((s,x) => s + Number(x.count||0), 0);
  const lines = rows.map(x => `- ${x.status}: ${x.count}`).join("\n");
  return (
    `ERP дээрх гэрлэн дохионы статус:\n\n**Нийт: ${total}**\n${lines}\n\n` +
    `Гэмтэлтэй/идэвхгүй дохионы дэлгэрэнгүйг Объектийн бүртгэл → Гэрлэн дохио хэсгээс харна уу.`
  );
}

function fmtLowStock(rows) {
  if (!rows.length)
    return "Агуулахын нөөц хангалтай байна. Доод хязгаараас буурсан материал олдсонгүй.";
  const lines = rows.map(r =>
    `- **${r.name}**: үлдэгдэл ${r.balance}${r.unit||""} (доод хязгаар: ${r.min_qty}${r.unit|""})`
  ).join("\n");
  return (
    `Доод хязгаараас буурсан материал (${rows.length} нэр):\n\n${lines}\n\n` +
    `Агуулах → Нөөцийн удирдлага хэсгийг шалгаж захиалга өгнө үү.`
  );
}

function fmtMonthlyExpenses(rows) {
  if (!rows.length) return "Энэ сарын зардлын бүртгэл ERP дээр олдсонгүй.";
  const total = rows.reduce((s,x) => s + Number(x.total||0), 0);
  const lines = rows.map(x => `- ${x.type}: ${money(x.total)}`).join("\n");
  return (
    `Энэ сарын зардлын тойм:\n\n**Нийт: ${money(total)}**\n\n${lines}\n\n` +
    `Санхүү → Зардлын бүртгэл хэсгийг дэлгэрэнгүй харна уу.`
  );
}

function fmtBudgetProgress(s) {
  const pct = s.planned > 0 ? Math.round(s.spent / s.planned * 100) : 0;
  const filled = Math.min(Math.floor(pct / 5), 20);
  const bar = "█".repeat(filled) + "░".repeat(20 - filled);
  const diff = s.spent - s.planned;
  return (
    `${s.year} оны төсвийн гүйцэтгэл:\n\n` +
    `Зарцуулсан: **${money(s.spent)}** / Төлөвлөсөн: ${money(s.planned)}\n` +
    `Гүйцэтгэл: **${pct}%**  ${bar}\n\n` +
    (diff > 0 ? `⚠️ Төсвөөс ${money(diff)} хэтэрсэн байна.`
              : diff < 0 ? `✅ Төсвөөс ${money(Math.abs(diff))} үлдэгдэлтэй байна.`
              : "Төсөвтэй яг тэнцэж байна.")
  );
}

function fmtOpenSafety(rows) {
  if (!rows.length) return "Нээлттэй ХАБЭА тайлан ERP дээр олдсонгүй.";
  const total = rows.reduce((s,x) => s + Number(x.count||0), 0);
  const lines = rows.map(x => `- ${x.risk_level}: ${x.count} тайлан`).join("\n");
  return (
    `Нийт **${total} нээлттэй** ХАБЭА эрсдэлийн тайлан:\n\n${lines}\n\n` +
    `ХАБЭА → Эрсдэлийн бүртгэл хэсгийг шалгана уу.`
  );
}

function fmtContractExpiry(rows) {
  if (!rows.length) return "Дараагийн 60 хоногт дуусах гэрээ ERP дээр олдсонгүй.";
  const lines = rows.map(r =>
    `- **${r.title}** (${r.counterparty||"—"}): ${r.end_date} — ${r.days_left} хоног үлдсэн`
  ).join("\n");
  return (
    `Дараагийн 60 хоногт дуусах гэрээ (${rows.length}):\n\n${lines}\n\n` +
    `Захиргаа → Гэрээний бүртгэл хэсгийг шалгана уу.`
  );
}

function fmtAssetWarranty(rows) {
  if (!rows.length) return "Дараагийн 90 хоногт баталгааны хугацаа дуусах объект ERP дээр олдсонгүй.";
  const lines = rows.map(r =>
    `- **${r.name}** (${r.category}): ${r.warranty_until} — ${r.days_left} хоног үлдсэн`
  ).join("\n");
  return (
    `Баталгааны хугацаа дуусч байгаа объектууд (${rows.length}):\n\n${lines}\n\n` +
    `Объектийн бүртгэл хэсгийг шалгана уу.`
  );
}

function fmtTraining(rows) {
  if (!rows.length) return "Дараагийн сургалтын мэдээлэл ERP дээр бүртгэгдээгүй байна.";
  const lines = rows.map(r =>
    `- **${r.title}** (${r.type}): ${r.start_date}${r.location ? " — " + r.location : ""} [${r.status}]`
  ).join("\n");
  return (
    `Дараагийн сургалтын хуваарь:\n\n${lines}\n\n` +
    `Хүний нөөц → Сургалт хэсгийг дэлгэрэнгүй харна уу.`
  );
}

function fmtOverdueWork(s) {
  if (s.count === 0)
    return "Хугацаа хэтэрсэн ажлын бүртгэл ERP дээр олдсонгүй. Бүх ажил хуваарьтайгаа нийцэж байна.";
  const lines = s.items.map(r =>
    `- **${r.title}** (${r.category}): хугацаа ${r.end_date}, ${r.days_over} хоног хэтэрсэн — ${r.status}`
  ).join("\n");
  return (
    `Хугацаа хэтэрсэн нийт **${s.count} ажил** байна:\n\n${lines}` +
    (s.count > 5 ? "\n_(зөвхөн эхний 5 харуулав)_" : "") +
    `\n\nАжлын явц хэсгийг яаралтай шалгана уу.`
  );
}

function fmtDashboardStatus(ctx) {
  const openFaults = ctx.faults.reduce((s,x) => x.status !== "Дууссан" ? s + Number(x.count||0) : s, 0);
  const openWork   = ctx.work.reduce((s,x) => !["Дууссан","Цуцалсан"].includes(x.status) ? s + Number(x.count||0) : s, 0);
  const trafficIssue = ctx.traffic.filter(x => !["Асаалтай","Идэвхтэй"].includes(x.status)).reduce((s,x) => s + Number(x.count||0), 0);
  return (
    `Өнөөдрийн (${ctx.today}) ERP-ийн тойм:\n\n` +
    `- Нээлттэй гэмтэл: **${openFaults}**\n` +
    `- Нээлттэй засварын ажил: **${openWork}**\n` +
    `- Асуудалтай гэрлэн дохио: **${trafficIssue}**\n` +
    (ctx.lightSchedules.length ? `- Хүчинтэй гэрлийн хуваарь: ${ctx.lightSchedules.length} ангилал\n` : "") +
    `\nДэлгэрэнгүй асуулт байвал тодорхой хэсгийн нэрийг хэлээрэй.`
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// § 7  ROLE-AWARE GREETING
// ═════════════════════════════════════════════════════════════════════════════
function roleGreeting(user) {
  const name = user.full_name || user.username || "та";
  const ROLE_GREETINGS = {
    director: {
      hello: `Өдрийн мэнд, ${name} захирал аа.`,
      help:  `Өнөөдрийн KPI, эрсдэл, шийдвэр гаргалтын товч дүнг хэлье.\n→ "Өнөөдрийн тойм" гэж бичвэл тэр даруй харагдана.`,
    },
    chief_engineer: {
      hello: `Сайн байна уу, ${name} инженер ээ.`,
      help:  "Техникийн ажлын явц, гэмтэл баталгаажуулалт, хугацаа хэтэрсэн ажлуудад тусалъя.",
    },
    engineer: {
      hello: `Сайн байна уу, ${name} инженер ээ.`,
      help:  "Ажил бүртгэх, гүйцэтгэл шинэчлэх, гэмтэл мэдүүлэх алхмуудыг заагаад өгье.",
    },
    electric: {
      hello: `Сайн байна уу, ${name}.`,
      help:  "Гэрэлтүүлэг, гэмтэл, засвар, гэрлэн дохионы журнал — аль хэсгээс эхлэх вэ?",
    },
    accountant: {
      hello: `Сайн байна уу, ${name}.`,
      help:  "Цахилгааны уншилт, нэхэмжлэл, төлбөр, санхүүгийн тайланд тусалъя.",
    },
    storekeeper: {
      hello: `Сайн байна уу, ${name}.`,
      help:  "Агуулахын орлого, зарлага, үлдэгдэл, захиалга — юуг бүртгэх вэ?",
    },
    hr: {
      hello: `Сайн байна уу, ${name}.`,
      help:  "Ажилтан, ирц, гэрээ, сургалт, HR тайланд тусалъя.",
    },
    safety: {
      hello: `Сайн байна уу, ${name}.`,
      help:  "ХАБЭА эрсдэл, зөвшөөрөл, шалгалт, audit trail — юу хэрэгтэй вэ?",
    },
    worker: {
      hello: `Сайн байна уу, ${name}.`,
      help:  "ERP дээр юу хийх хэрэгтэйгээ бичнэ үү, алхам алхмаар заагаад өгье.",
    },
  };
  const g = ROLE_GREETINGS[user.role] || {
    hello: `Сайн байна уу, ${name}.`,
    help:  "ERP дээр юу хийхийг хэлнэ үү.",
  };
  return `${g.hello}\n${g.help}`;
}

// ═════════════════════════════════════════════════════════════════════════════
// § 8  ROLE-BASED OPENAI SYSTEM PROMPT
// ═════════════════════════════════════════════════════════════════════════════
const ROLE_STYLE_PROMPTS = {
  director: `
Хэрэглэгч нь ЗАХИРАЛ. Хариултын стиль:
• Энгийн тоон асуулт (хэн, хэдэн, ямар статус): шууд товч хариул — "KPI нөлөөлөл" эсвэл "Дараагийн шийдвэр" нэмэх шаардлагагүй
• Дүн шинжилгээ, эрсдэлийн асуулт: эхлээд дүгнэлт, дараа нь нөлөөлөл, нэг шийдвэрийн санал нэмнэ
• 8 мөрөөс хэтрэхгүй · Мэндчилгэнд зөвхөн мэндчилгээ`,

  chief_engineer: `
Хэрэглэгч нь ЕРӨНХИЙ ИНЖЕНЕР. Хариултын стиль:
• Техникийн нарийвчлалтай, алхам алхмаар
• Workflow, баталгаажуулалт, priority дарааллыг тодорхой хэл
• ХАБЭА, аюулгүй байдлын анхааруулга нэмнэ
• Эд анги, загварын дугаар байвал оруулна`,

  engineer: `
Хэрэглэгч нь ИНЖЕНЕР. Хариултын стиль:
• Тодорхой хийх алхмуудыг дугаарлана
• Талбар, форм бөглөх зааврыг нарийвчлана
• Аюулгүй байдлын асуудал байвал ⚠️ нэмнэ`,

  electric: `
Хэрэглэгч нь ЦАХИЛГААНЧИН. Хариултын стиль:
• 🔴 АНХААРНА УУ: аюулгүй байдлын заавар эхэлж
• Дугаарлагдсан алхам (1, 2, 3...)
• Эд ангийн нэр, загвар тодорхой
• ERP дээр дуусгах алхмыг төгсгөлд нэмнэ`,

  accountant: `
Хэрэглэгч нь НЯГТЛАН. Хариултын стиль:
• Тоо баримтыг ₮ тэмдэглэгээтэй, таслал бүхий
• Дансны дугаар, баримтын дугаар нэмнэ
• Огноо: YYYY-MM-DD
• Аудитын trail-г дурдана`,

  storekeeper: `
Хэрэглэгч нь НЯРАВ. Хариултын стиль:
• Тоо хэмжээ, нэгжийг тодорхой (ш, кг, м, л)
• Байршил, тавиурын дугаар нэмнэ
• Хариуцлага, баталгаажуулалт дурдана`,

  hr: `
Хэрэглэгч нь HR МЕНЕЖЕР. Хариултын стиль:
• Хуулийн зохицуулалт, дотоод дүрмийг эш татна
• Ажилтны мэдээллийг болгоомжтой харьцана
• Цалин/хувийн мэдээллийг бусдад дэлгэхгүй`,

  safety: `
Хэрэглэгч нь ХАБЭА-н АЖИЛТАН. Хариултын стиль:
• Аюулгүй байдлын нарийвчлал, нотолгоо
• Эрсдэлийн ангилал, workflow тодорхой
• Audit trail, баримт бичгийн шаардлага нэмнэ`,
};

function buildSystemPrompt(user) {
  const roleStyle = ROLE_STYLE_PROMPTS[user.role] ||
    "Хэрэглэгчийн role-д тохирсон товч, хэрэгжүүлэх боломжтой зөвлөгөө өг.";

  return `Чи Чойбалсан хөгжил ОНӨҮГ-ийн дотоод ERP системийн AI туслах юм.

ҮНДСЭН ДҮРЭМ:
1. Зөвхөн Монгол хэлээр хариул
2. Өгөгдлийг мэдэхгүй бол "ERP дээрх бүртгэлээр" гэж хэл — тааж баримт бүү зохио
3. Ажилтны нэр, алба тушаал: director/hr/chief_engineer харж болно. Цалин, хувийн мэдээлэл (регистр, утас, гэр хаяг): зөвхөн hr/director. PUBLIC болон бага эрхийн хэрэглэгчдэд юу ч дурдахгүй.
4. Системийн нэвтрэх мэдээлэл, нууц код, IP/сүлжээний мэдээлэл дурдахгүй
5. Бүртгэл устгах, засах, баталгаажуулах action хийхгүй — зөвхөн заавар, зөвлөгөө
6. Мэндчилсэн асуулт бол зөвхөн мэндчилгээ хариул — тоо/тайлан бүү дүгнэ
7. Ажилтны нэрийг огт зохиох хатуу хориглоно. Нэр мэдэгдэхгүй бол "HR модульд шалгана уу" гэ
8. Director (захирал) role ирвэл бүх мэдээлэлд хандах боломжтой — "эрх хүрэлцэхгүй" гэж бичих хориглоно

ФОРМАТЫН ДҮРЭМ:
• Default: 5–8 мөр
• "Дэлгэрэнгүй", "тайлбарла", "схем" гэвэл л урт хариул
• Нэг хариулт дор 3-аас их section бүү гарга
• Алхам эхлэхдээ 1-ээс дугаарлана

НИЙТИЙН МЭДЛЭГИЙН САН (LOCAL KB SEED):
${LOCAL_GUIDES.map(g => `[${g.title}]: ${g.answer.slice(0, 150)}...`).join("\n")}

ROLE-ТОХИРСОН СТИЛЬ:${roleStyle}`;
}

// ═════════════════════════════════════════════════════════════════════════════
// § 9  OPENAI CALLER
// ═════════════════════════════════════════════════════════════════════════════
async function askOpenAI(question, ctx, user, currentModule, convHistory = []) {
  if (!process.env.OPENAI_API_KEY)
    return { text: null, error: "OPENAI_API_KEY .env дээр тохируулаагүй байна" };
  if (typeof fetch !== "function")
    return { text: null, error: "Node.js 18+ шаардлагатай (fetch дэмжихгүй байна)" };

  const model = process.env.OPENAI_MODEL || "gpt-4.1";

  // ERP snapshot — system prompt-д нэмж өгнө (бүх харилцаанд нийтлэг контекст)
  const openFaults    = ctx.faults.filter(x => x.status !== "Дууссан").reduce((s,x) => s + Number(x.count||0), 0);
  const openWork      = ctx.work.filter(x => !["Дууссан","Цуцалсан"].includes(x.status)).reduce((s,x) => s + Number(x.count||0), 0);
  const trafficIssues = ctx.traffic.filter(x => !["Асаалтай","Идэвхтэй"].includes(x.status)).reduce((s,x) => s + Number(x.count||0), 0);

  const systemContent =
    buildSystemPrompt(user) +
    `\n\nERP өнөөдрийн байдал (${ctx.today}): нээлттэй гэмтэл ${openFaults}, нээлттэй ажил ${openWork}, замын дохионы асуудал ${trafficIssues}. Одоогийн модуль: ${currentModule || "dashboard"}. Хэрэглэгч: ${user.full_name || user.username} (${user.role}).`;

  // Харилцааны түүх — сүүлийн 8 мессеж (4 солилцоо)
  const historyMsgs = (Array.isArray(convHistory) ? convHistory : [])
    .filter(m => m.role && m.text && m.text.length > 0)
    .slice(-8)
    .map(m => ({
      role:    m.role === "user" ? "user" : "assistant",
      content: m.text.slice(0, 600),
    }));

  // Одоогийн асуулт — хэрэв өмнөх харилцаа байвал ердийн текст, эс бол контексттэй
  const currentContent = historyMsgs.length > 0
    ? question
    : JSON.stringify({
        question,
        currentModule: currentModule || "",
        user: { role: user.role, position: user.position, department: user.department, name: user.full_name || user.username },
      });

  const input = [
    { role: "system", content: systemContent },
    ...historyMsgs,
    { role: "user", content: currentContent },
  ];

  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model, input, store: false }),
  });

  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    return { text: null, error: `OpenAI API алдаа (${r.status}): ${errText.slice(0, 300)}` };
  }

  const data = await r.json();
  const text = extractOpenAIText(data);
  return { text: text || null, error: text ? null : "OpenAI API хариу ирсэн боловч текст олдсонгүй" };
}

function extractOpenAIText(data) {
  if (!data) return "";
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const parts = [];
  for (const item of data.output || []) {
    if (typeof item?.content === "string") parts.push(item.content);
    for (const c of item?.content || []) {
      if (typeof c?.text        === "string") parts.push(c.text);
      if (typeof c?.output_text === "string") parts.push(c.output_text);
      if (typeof c?.content     === "string") parts.push(c.content);
    }
  }
  if (typeof data.text === "string") parts.push(data.text);
  return parts.join("\n").trim();
}

// ═════════════════════════════════════════════════════════════════════════════
// § 10  QUERY LOGGER
// ═════════════════════════════════════════════════════════════════════════════
async function logQuery(userId, question, intent, mode) {
  try {
    const result = await run(
      `INSERT INTO assistant_logs(user_id,question,intent,mode,created_at)
       VALUES(?,?,?,?,datetime('now','localtime'))`,
      [userId, question.slice(0, 500), intent, mode]
    );
    return result?.id || null;
  } catch (_) {
    return null;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// § 11  INTENT ROUTER
// intent → { title, answer, suggestions }
// ═════════════════════════════════════════════════════════════════════════════
async function handleIntent(intent, question, ctx, user, convHistory = [], intentMeta = {}) {
  switch (intent) {
    // ── Мэндчилгээ ──────────────────────────────────────────────────────────
    case "GREETING":
      return {
        title: "Мэндчилгээ",
        answer: roleGreeting(user),
        suggestions: ["Өнөөдрийн тойм", "Нээлттэй гэмтэл хэдэн байна?", "Гэрлийн хуваарь хэд вэ?"],
      };

    // ── Гэрэлтүүлэг ─────────────────────────────────────────────────────────
    case "LIGHT_SCHEDULE":
      return {
        title: "Өнөөдрийн гэрэлтүүлгийн хуваарь",
        answer: fmtLightSchedule(ctx),
        suggestions: ["Цаг тохиргоо хаана бүртгэх вэ?", "LoRa бодит асалтыг тайлбарла", "Энэ сарын асалтын тайлан"],
      };

    case "LIGHT_STATUS_SCHEDULE": {
      const s = await fetchOpenLightFaults();
      return {
        title: "Гэрэлтүүлгийн асалт ба хуваарь",
        answer: fmtLightStatusAndSchedule(s, ctx),
        suggestions: ["Гэмтлийн дэлгэрэнгүй", "Цаг тохиргоо хаана вэ?", "Асалтын сарын тайлан"],
      };
    }

    case "POLE_COUNT": {
      const s = await fetchPoleCount();
      return {
        title: "Гэрлийн шонгийн тоо",
        answer: fmtPoleCount(s),
        suggestions: ["Асалтын хувийг хэл", "Нээлттэй гэмтэл хэдэн байна?", "Гэрэлтүүлгийн нийт тайлан"],
      };
    }

    case "OPEN_LIGHT_FAULTS": {
      const s = await fetchOpenLightFaults();
      return {
        title: "Нээлттэй гэрэлтүүлгийн гэмтэл",
        answer: fmtOpenLightFaults(s),
        suggestions: ["Гэмтэл хэрхэн бүртгэх вэ?", "Засварын дараалал яаж тавих вэ?", "Гэмтлийн тайлан гарга"],
      };
    }

    case "LOCATION_LIGHT_FAULT": {
      const s = await fetchLocationLightFaults(question);
      return {
        title: "Байршлын гэрэлтүүлгийн гэмтэл",
        answer: fmtLocationLightFaults(s),
        suggestions: ["Гэмтлийн дэлгэрэнгүй", "Чойбалсангийн гэмтэл", "ГТ-015 гэмтэл"],
      };
    }

    // ── Хөрөнгө ─────────────────────────────────────────────────────────────
    case "ASSET_VALUE": {
      const s = await fetchAssetValue();
      return {
        title: "Байгууллагын хөрөнгийн дүн",
        answer: fmtAssetValue(s),
        suggestions: ["Үндсэн хөрөнгийн дэлгэрэнгүй", "Агуулахын үлдэгдлийн дүн", "Санхүүгийн тойм"],
      };
    }

    case "ASSET_WARRANTY": {
      const rows = await fetchAssetWarranty();
      return {
        title: "Баталгааны хугацааны анхааруулга",
        answer: fmtAssetWarranty(rows),
        suggestions: ["Баталгааны хугацаа шинэчлэх хэрхэн вэ?", "Объектийн бүртгэл харах", "Засварын тайлан"],
      };
    }

    // ── Ажилтан / ирц ────────────────────────────────────────────────────────
    case "EMPLOYEE_COUNT": {
      const s = await fetchEmployeeCount();
      return {
        title: "Ажилтны тоо",
        answer: fmtEmployeeCount(s),
        suggestions: ["Өнөөдрийн ирц хэд вэ?", "Хэлтсээр ажилтны тоо", "HR тайлан гарга"],
      };
    }

    case "EMPLOYEE_GENDER": {
      const s = await fetchEmployeeGender(question);
      return {
        title: "Ажилтны хүйсийн шүүлт",
        answer: fmtEmployeeGender(s),
        suggestions: ["Нийт ажилтны тоо", "HR ажилтны жагсаалт", "Өнөөдрийн ирц"],
      };
    }

    case "ATTENDANCE_TODAY": {
      const s = await fetchTodayAttendance(ctx.today);
      return {
        title: "Өнөөдрийн ирц",
        answer: fmtTodayAttendance(s),
        suggestions: ["Ирцийн дэлгэрэнгүй тайлан", "Хоцорсон хүмүүсийг яаж харах вэ?", "Ирц бүртгэх заавар"],
      };
    }

    case "MY_SALARY": {
      const s = await fetchMySalary(user.id);
      return {
        title: "Миний цалин",
        answer: fmtMySalary(s),
        suggestions: ["Цалингийн тооцоо хаана харах вэ?", "Ирц цалинд яаж нөлөөлөх вэ?"],
      };
    }

    case "MY_PHONE": {
      const s = await fetchMyPhone(user.id);
      return {
        title: "Миний утасны дугаар",
        answer: fmtMyPhone(s, user),
        suggestions: ["Миний мэдээлэл хаана вэ?", "HR ажилтантай холбогдох", "Ажилтны карт засах"],
      };
    }

    case "ELECTRICITY_BILL": {
      const s = await fetchElectricityBill(question);
      return {
        title: "Цахилгааны төлбөр",
        answer: fmtElectricityBill(s, question),
        suggestions: ["4-р сарын цахилгааны төлбөр", "Сүүлийн сарын төлбөр", "Нэхэмжлэл хаана харах вэ?"],
      };
    }

    case "WORK_ACTIVITY": {
      const s = await fetchWorkActivity(question, convHistory);
      return {
        title: "ERP дээрх ажлын бүртгэл",
        answer: fmtWorkActivity(s),
        suggestions: ["Өнгөрсөн 7 хоногт юу хийсэн бэ?", "Өнөөдөр ERP дээр юм оруулсан уу?", "Ажлын явц дэлгэрэнгүй"],
      };
    }

    case "MY_WORK": {
      const s = await fetchMyWork(user);
      return {
        title: "Миний ажил",
        answer: fmtMyWork(s),
        suggestions: ["Ажлын явц дэлгэрэнгүй", "Миний идэвхтэй ажил", "Дууссан ажлууд"],
      };
    }

    case "CAMERA_COUNT": {
      const s = await fetchCameraCount();
      return {
        title: "Камерын тоо",
        answer: fmtCameraCount(s),
        suggestions: ["Камерын байршлуудыг харуулаач", "Объектийн бүртгэлд камер нэмэх", "Засварт орсон камер байна уу?"],
      };
    }

    case "EMPLOYEE_LOOKUP": {
      const canSee = ["director", "hr", "chief_engineer"].includes(user.role);
      if (!canSee) {
        return {
          title: "Ажилтны мэдээлэл",
          answer: "Ажилтны нэр, холбоо барих мэдээлэлд зөвхөн захирал, HR менежер болон ерөнхий инженер хандах боломжтой.\n\nДэлгэрэнгүй мэдээлэл авахын тулд HR модульд хандана уу.",
          suggestions: ["HR тайлан", "Өнөөдрийн ирц харах"],
        };
      }
      const rows = await fetchEmployeeByRole(cyrillize(question.toLowerCase()));
      return {
        title: "Ажилтны мэдээлэл",
        answer: fmtEmployeeByRole(rows, question, user),
        suggestions: ["Дэлгэрэнгүй карт харах", "Өнөөдрийн ирц харах", "HR тайлан гаргах"],
      };
    }

    case "EMPLOYEE_PHONE_FOLLOWUP": {
      const s = await fetchEmployeePhoneFromHistory(convHistory, user);
      return {
        title: "Ажилтны утас",
        answer: fmtEmployeePhoneFollowup(s),
        suggestions: ["HR ажилтны жагсаалт", "Өнөөдрийн ирц", "Ажилтны карт хаана вэ?"],
      };
    }

    // ── Гэмтэл засвар ────────────────────────────────────────────────────────
    case "OPEN_FAULTS": {
      const s = await fetchOpenFaults();
      return {
        title: "Нээлттэй гэмтэл ба засварын тойм",
        answer: fmtOpenFaults(s),
        suggestions: ["Гэмтэл хэрхэн бүртгэх вэ?", "Засварын тасалбар хаах заавар", "Хугацаа хэтэрсэн ажил байна уу?"],
      };
    }

    case "OVERDUE_WORK": {
      const s = await fetchOverdueWork();
      return {
        title: "Хугацаа хэтэрсэн ажил",
        answer: fmtOverdueWork(s),
        suggestions: ["Хугацааг яаж шинэчлэх вэ?", "Ажлын хариуцагчийг өөрчлөх", "Ажлын явцын тайлан"],
      };
    }

    // ── Гэрлэн дохио ────────────────────────────────────────────────────────
    case "TRAFFIC_STATUS": {
      const rows = await fetchTrafficStatus();
      return {
        title: "Гэрлэн дохионы статус",
        answer: fmtTrafficStatus(rows),
        suggestions: ["Гэрлэн дохионы ослын цаг яаж шалгах вэ?", "Гэмтэлтэй дохио мэдүүлэх", "Засварын тайлан"],
      };
    }

    // ── Агуулах ─────────────────────────────────────────────────────────────
    case "LOW_STOCK": {
      const rows = await fetchLowStock();
      return {
        title: "Агуулахын нөөцийн анхааруулга",
        answer: fmtLowStock(rows),
        suggestions: ["Материал захиалах хэрхэн вэ?", "Агуулахын нийт үлдэгдэл", "Нийлүүлэгчийн мэдээлэл"],
      };
    }

    // ── Санхүү ───────────────────────────────────────────────────────────────
    case "MONTHLY_EXPENSE": {
      const rows = await fetchMonthlyExpenses();
      return {
        title: "Энэ сарын зардал",
        answer: fmtMonthlyExpenses(rows),
        suggestions: ["Төсвийн гүйцэтгэл хэдэн хувьд байна?", "Зардлын тайлан Excel-рүү татах", "Аль хэсэг хамгийн их зардалтай?"],
      };
    }

    case "BUDGET_PROGRESS": {
      const s = await fetchBudgetProgress();
      return {
        title: "Төсвийн гүйцэтгэл",
        answer: fmtBudgetProgress(s),
        suggestions: ["Энэ сарын зардлын дэлгэрэнгүй", "Хэтрэлтийн шалтгаан юу вэ?", "Дараагийн сарын төлөвлөгөө"],
      };
    }

    // ── ХАБЭА ────────────────────────────────────────────────────────────────
    case "SAFETY_OPEN": {
      const rows = await fetchOpenSafetyReports();
      return {
        title: "Нээлттэй ХАБЭА тайлан",
        answer: fmtOpenSafety(rows),
        suggestions: ["Эрсдэл бүртгэх хэрхэн вэ?", "ХАБЭА шалгалтын хуудас", "ХАБЭА тайлан гаргах"],
      };
    }

    case "HABEA_WORK_STATUS": {
      const s = await fetchHabeaWorkStatus();
      return {
        title: "ХАБЭА — Ажлын явцын шалгалт",
        answer: fmtHabeaWorkStatus(s),
        suggestions: ["ХАБЭА шалгалт бүртгэх заавар", "Нээлттэй ХАБЭА тайлан", "Ажлын явцын дэлгэрэнгүй"],
      };
    }

    // ── Гэрээ / сургалт ──────────────────────────────────────────────────────
    case "CONTRACT_EXPIRY": {
      const rows = await fetchContractExpiry();
      return {
        title: "Дуусах дөхсөн гэрээ",
        answer: fmtContractExpiry(rows),
        suggestions: ["Гэрээ шинэчлэх хэрхэн вэ?", "Бүх гэрээний жагсаалт", "Гэрээний тайлан"],
      };
    }

    case "TRAINING": {
      const rows = await fetchTrainingSchedule();
      return {
        title: "Сургалтын хуваарь",
        answer: fmtTraining(rows),
        suggestions: ["Сургалтад бүртгүүлэх хэрхэн вэ?", "Сургалтын тайлан", "ХАБЭА сургалтын хуваарь"],
      };
    }

    // ── Dashboard ────────────────────────────────────────────────────────────
    case "DASHBOARD_STATUS":
      return {
        title: "ERP-ийн өнөөдрийн байдал",
        answer: fmtDashboardStatus(ctx),
        suggestions: ["Нээлттэй гэмтэл дэлгэрэнгүй", "Ажилтны ирц хэд вэ?", "Яаралтай анхаарах юм байна уу?"],
      };

    // ── Гэрлэн дохионы цагийн журнал ────────────────────────────────────────
    case "TRAFFIC_SIGNAL_LOG": {
      const canSee = ["director", "chief_engineer", "engineer", "electric", "accountant"].includes(user.role);
      if (!canSee) {
        return {
          title: "Гэрлэн дохионы журнал",
          answer: "Гэрлэн дохионы цагийн журналд хандах эрх хүрэлцэхгүй байна.",
          suggestions: ["Гэрлэн дохионы статус харах", "Объектийн бүртгэл"],
        };
      }
      const s = await fetchTrafficSignalLog(question);
      return {
        title: "Гэрлэн дохионы цагийн журнал",
        answer: fmtTrafficSignalLog(s),
        suggestions: ["Ослын огноо цагийг хэлбэл шалгаж өгье", "Баримтын дугаар хайх", "Нотлох баримт хэвлэх"],
      };
    }

    // ── Заавар ──────────────────────────────────────────────────────────────
    case "KB_MATCH":
    case "GUIDE": {
      const guide = intentMeta?.guide || await matchGuide(question);
      if (!guide) return null;
      return {
        title: guide.title,
        answer: `${guide.answer}\n\nДэлгэрэнгүй алхам хэрэгтэй бол тодруулаарай.`,
        suggestions: ["Алхам алхмаар заагаад өг", "Тайлан хэрхэн гаргах вэ?", "Бусад хэсгийг ашиглах заавар"],
      };
    }

    default:
      return null;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// § 12  ROUTES
// ═════════════════════════════════════════════════════════════════════════════

// ── GET /api/assistant/status ────────────────────────────────────────────────
router.get("/assistant/status", auth, (_req, res) => {
  res.json({
    ai_enabled: !!process.env.OPENAI_API_KEY,
    provider: "openai",
    model: process.env.OPENAI_MODEL || "gpt-4.1",
    rate_limit: { max: ASK_RATE_MAX, window_ms: ASK_RATE_WINDOW_MS },
  });
});

// ── GET /api/assistant/debug-normalize?text=hr ───────────────────────────────
router.get("/assistant/debug-normalize", auth, async (req, res) => {
  if (!["director", "chief_engineer", "admin"].includes(req.user.role)) {
    return res.status(403).json({ error: "Эрх хүрэхгүй" });
  }
  const text = String(req.query.text || "");
  const normalized = cyrillize(text);
  const classified = await classifyIntent(text);
  res.json({ input: text, normalized, classified });
});

// ── POST /api/assistant/ask ──────────────────────────────────────────────────
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

  // Local intent handler
  const local = await handleIntent(intent, question, ctx, req.user, convHistory, classified).catch(() => null);
  if (local) {
    const logId = await logQuery(req.user.id, question, intent, "local");
    return res.json({ mode: "local", log_id: logId, ...local });
  }

  // OpenAI fallback — харилцааны түүхтэйгээр
  const ai = await askOpenAI(question, ctx, req.user, currentModule, convHistory).catch(e => ({ text: null, error: e.message }));
  if (ai?.text) {
    const logId = await logQuery(req.user.id, question, "AI", "ai");
    return res.json({
      mode: "ai",
      log_id: logId,
      title: "AI туслах",
      answer: ai.text,
      suggestions: ["Алхам алхмаар заагаад өг", "Тайлангийн загвар гарга", "Гадны хүнд өгөх текст болго"],
    });
  }

  // Final fallback — DB/static guide or generic
  const guide = await matchGuide(question);
  const fallbackAnswer = guide
    ? `${guide.answer}${currentModule ? `\n\nОдоогийн дэлгэц: ${currentModule}.` : ""}`
    : `ERP туслах ажиллаж байна. Тодорхой хэсэг эсвэл асуултаа тодруулаарай.${ai?.error ? `\n\n_(AI: ${ai.error})_` : ""}`;

  const logId = await logQuery(req.user.id, question, "fallback", "fallback");
  return res.json({
    mode: "fallback",
    log_id: logId,
    title: guide ? guide.title : "ERP туслах",
    answer: fallbackAnswer,
    suggestions: [
      "Гэрлэн дохионы ослын цаг яаж шалгах вэ?",
      "Гэмтэл бүртгэлийг яаж хийх вэ?",
      "Өнөөдрийн ирц хэд вэ?",
    ],
  });
});

// ── POST /api/assistant/dev-request ──────────────────────────────────────────
// Ажилчдын ERP хөгжүүлэлтийн санал/алдааг backlog болгон хадгална.
router.post("/assistant/dev-request", auth, async (req, res) => {
  const description = String(req.body?.description || "").trim();
  const moduleName = String(req.body?.module || "").trim().slice(0, 120);
  const pageUrl = String(req.body?.page_url || "").trim().slice(0, 300);
  const userAgent = String(req.body?.user_agent || req.headers["user-agent"] || "").trim().slice(0, 300);
  if (description.length < 8) {
    return res.status(400).json({ error: "Санал/алдааны тайлбар арай богино байна" });
  }
  const { requestType, severity } = classifyDevRequest(description);
  const result = await run(
    `INSERT INTO assistant_dev_requests
      (user_id,module,request_type,severity,title,description,page_url,user_agent,status,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?, 'Шинэ', datetime('now','localtime'), datetime('now','localtime'))`,
    [
      req.user.id,
      moduleName || "unknown",
      requestType,
      severity,
      makeDevRequestTitle(description, requestType),
      description.slice(0, 2000),
      pageUrl,
      userAgent,
    ]
  );
  res.json({
    ok: true,
    id: result?.id || null,
    request_type: requestType,
    severity,
    message: "Санал/алдааг хөгжүүлэлтийн жагсаалтад хадгаллаа.",
  });
});

// ── GET /api/assistant/dev-requests ──────────────────────────────────────────
router.get("/assistant/dev-requests", auth, async (req, res) => {
  const privileged = ["director", "chief_engineer", "admin"].includes(req.user.role);
  const rows = privileged
    ? await all(`
        SELECT r.*, u.full_name AS user_name, u.role AS user_role
        FROM assistant_dev_requests r
        LEFT JOIN users u ON u.id=r.user_id
        ORDER BY CASE r.status
          WHEN 'Шинэ' THEN 0
          WHEN 'AI-д явуулсан' THEN 1
          WHEN 'Шалгаж байна' THEN 2
          WHEN 'Хийхээр болсон' THEN 3
          WHEN 'Хийгдсэн' THEN 4
          WHEN 'Хаасан' THEN 5
          ELSE 5
        END, r.created_at DESC
        LIMIT 200
      `)
    : await all(`
        SELECT r.*
        FROM assistant_dev_requests r
        WHERE r.user_id=?
        ORDER BY r.created_at DESC
        LIMIT 50
      `, [req.user.id]);
  res.json(rows);
});

// ── PUT /api/assistant/dev-requests/:id ──────────────────────────────────────
// Захирал/ерөнхий инженер: статус, чухалчлал, тайлбар шинэчлэх
router.put("/assistant/dev-requests/:id", auth, async (req, res) => {
  if (!["director", "chief_engineer"].includes(req.user.role))
    return res.status(403).json({ error: "Зөвхөн захирал/ерөнхий инженер" });

  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "id буруу" });

  const VALID_STATUS   = ["Шинэ", "AI-д явуулсан", "Шалгаж байна", "Хийхээр болсон", "Хийгдсэн", "Хаасан"];
  const VALID_PRIORITY = ["low", "medium", "high"];

  const { status, priority, admin_note } = req.body;
  const updates = [];
  const params  = [];

  if (status !== undefined) {
    if (!VALID_STATUS.includes(status)) return res.status(400).json({ error: "Статус буруу" });
    updates.push("status=?");
    params.push(status);
    if (status === "Хаасан") {
      updates.push("closed_at=datetime('now','localtime')");
    } else {
      updates.push("closed_at=NULL");
    }
  }
  if (priority !== undefined) {
    if (!VALID_PRIORITY.includes(priority)) return res.status(400).json({ error: "Чухалчлал буруу" });
    updates.push("priority=?");
    params.push(priority);
  }
  if (admin_note !== undefined) {
    updates.push("admin_note=?");
    params.push(String(admin_note).slice(0, 1000));
  }

  if (!updates.length) return res.status(400).json({ error: "Өөрчлөх талбар байхгүй" });

  updates.push("updated_at=datetime('now','localtime')");
  params.push(id);

  try {
    const result = await run(
      `UPDATE assistant_dev_requests SET ${updates.join(",")} WHERE id=?`,
      params
    );
    if (!result?.changes) return res.status(404).json({ error: "Хүсэлт олдсонгүй" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Шинэчлэхэд алдаа гарлаа: " + (e.message || "") });
  }
});

// ── POST /api/assistant/feedback ─────────────────────────────────────────────
// Хариултад thumbs up (1) / thumbs down (-1) өгөх
router.post("/assistant/feedback", auth, async (req, res) => {
  const { log_id, rating, comment } = req.body;
  if (!log_id || ![-1, 1].includes(Number(rating)))
    return res.status(400).json({ error: "log_id болон rating (1 эсвэл -1) шаардлагатай" });
  try {
    await run(
      `INSERT INTO assistant_feedback(log_id,user_id,rating,comment,created_at)
       VALUES(?,?,?,?,datetime('now','localtime'))
       ON CONFLICT(log_id,user_id) DO UPDATE SET
         rating=excluded.rating,
         comment=excluded.comment,
         created_at=datetime('now','localtime')`,
      [log_id, req.user.id, Number(rating), (comment || "").slice(0, 500)]
    );
    res.json({ ok: true });
  } catch (_) {
    res.status(500).json({ error: "Feedback хадгалахад алдаа гарлаа" });
  }
});

// ── GET /api/assistant/feedback-stats ────────────────────────────────────────
// Захирал/ерөнхий инженерт зориулсан — AI-н чанарын дүн шинжилгээ
router.get("/assistant/feedback-stats", auth, async (req, res) => {
  if (!["director", "chief_engineer"].includes(req.user.role))
    return res.status(403).json({ error: "Эрх хүрэхгүй" });

  const [intentStats, topPositive, topNegative, recentNegative] = await Promise.all([
    all(`
      SELECT l.intent, COUNT(*) total,
        SUM(CASE WHEN f.rating=1  THEN 1 ELSE 0 END) positive,
        SUM(CASE WHEN f.rating=-1 THEN 1 ELSE 0 END) negative
      FROM assistant_logs l
      LEFT JOIN assistant_feedback f ON f.log_id=l.id
      GROUP BY l.intent ORDER BY total DESC LIMIT 20
    `).catch(() => []),
    all(`
      SELECT l.question, COUNT(*) cnt
      FROM assistant_feedback f JOIN assistant_logs l ON l.id=f.log_id
      WHERE f.rating=1 GROUP BY l.question ORDER BY cnt DESC LIMIT 10
    `).catch(() => []),
    all(`
      SELECT l.question, COUNT(*) cnt
      FROM assistant_feedback f JOIN assistant_logs l ON l.id=f.log_id
      WHERE f.rating=-1 GROUP BY l.question ORDER BY cnt DESC LIMIT 10
    `).catch(() => []),
    all(`
      SELECT l.question, f.comment, f.created_at
      FROM assistant_feedback f JOIN assistant_logs l ON l.id=f.log_id
      WHERE f.rating=-1 AND f.comment IS NOT NULL AND f.comment!=''
      ORDER BY f.created_at DESC LIMIT 10
    `).catch(() => []),
  ]);

  res.json({ intentStats, topPositive, topNegative, recentNegative });
});

// ═════════════════════════════════════════════════════════════════════════════
// § KB  Knowledge Base CRUD
// ═════════════════════════════════════════════════════════════════════════════
const KB_ROLES = ["director", "chief_engineer"];
const KB_MODULES = ["general","lighting","hr","assets","warehouse","operations","habea","finance","streetlights","reports"];
const KB_CATS    = ["FAQ","procedure","rule","glossary"];
const KB_ROLE_MINS = ["worker","engineer","storekeeper","accountant","hr","chief_engineer","director"];

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
    [
      KB_MODULES.includes(mod) ? mod : "general",
      KB_CATS.includes(category) ? category : "FAQ",
      String(title).trim().slice(0, 200),
      String(body).trim().slice(0, 4000),
      String(keywords || "").slice(0, 500),
      KB_ROLE_MINS.includes(role_min) ? role_min : "worker",
      Number(sort_order) || 100,
    ]
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
  if (sort_order!== undefined) { sets.push("sort_order=?"); params.push(Number(sort_order) || 100); }
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
// Dashboard widget-д зориулсан хурдан тойм
router.get("/assistant/dashboard-summary", auth, async (req, res) => {
  const today = localDate();
  const [faults, work, trafficIssue, attendance, lowStock] = await Promise.all([
    get(`SELECT COUNT(*) count, COALESCE(SUM(broken_count),0) broken
         FROM sl_faults WHERE status IN ('Нээлттэй','Явцтай')`).catch(() => ({ count:0, broken:0 })),
    get(`SELECT COUNT(*) count FROM asset_events
         WHERE status NOT IN ('Дууссан','Цуцалсан')`).catch(() => ({ count:0 })),
    get(`SELECT COUNT(*) count FROM assets
         WHERE category='Гэрлэн дохио' AND status NOT IN ('Асаалтай','Идэвхтэй')`).catch(() => ({ count:0 })),
    get(`SELECT COUNT(DISTINCT user_id) count FROM hr_records
         WHERE start_date<=? AND COALESCE(end_date,start_date)>=?
           AND record_type IN ('Ажилласан','Хоцорсон','Илүү цаг')`, [today, today]).catch(() => ({ count:0 })),
    get(`SELECT COUNT(*) count FROM wh_materials m WHERE m.min_qty>0
         AND (m.opening_qty
           + COALESCE((SELECT SUM(CASE WHEN txn_type IN ('INCOME','INTERNAL_IN') THEN qty ELSE 0 END)
                       FROM wh_transactions t WHERE t.material_id=m.id),0)
           - COALESCE((SELECT SUM(CASE WHEN txn_type IN ('EXPENSE','INTERNAL_OUT') THEN qty ELSE 0 END)
                       FROM wh_transactions t WHERE t.material_id=m.id),0)) <= m.min_qty`).catch(() => ({ count:0 })),
  ]);
  res.json({
    today,
    open_light_faults:  Number(faults.count||0),
    broken_heads:       Number(faults.broken||0),
    open_work:          Number(work.count||0),
    traffic_issues:     Number(trafficIssue.count||0),
    present_today:      Number(attendance.count||0),
    low_stock_items:    Number(lowStock.count||0),
  });
});

module.exports = router;
