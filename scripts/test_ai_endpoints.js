"use strict";
/**
 * AI Advisor — 7 Шинэ Endpoint Тестийн Скрипт
 * Ажиллуулах: node scripts/test_ai_endpoints.js
 */
const http = require("http");

const TOKEN = process.argv[2] || "";
const BASE  = "http://localhost:4000";

if (!TOKEN) {
  console.error("Хэрэглэх: node scripts/test_ai_endpoints.js <JWT_TOKEN>");
  process.exit(1);
}

function fetch(path) {
  return new Promise((resolve, reject) => {
    const t0  = Date.now();
    const req = http.request(
      { host: "localhost", port: 4000, path, headers: { Authorization: "Bearer " + TOKEN } },
      (r) => {
        let buf = "";
        r.on("data", (c) => (buf += c));
        r.on("end", () => {
          const ms = Date.now() - t0;
          try {
            resolve({ status: r.statusCode, ms, body: JSON.parse(buf) });
          } catch (_) {
            resolve({ status: r.statusCode, ms, body: buf.slice(0, 300), parseError: true });
          }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

function fetchNoAuth(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "localhost", port: 4000, path }, (r) => {
      let b = "";
      r.on("data", (c) => (b += c));
      r.on("end", () => resolve({ status: r.statusCode, body: b }));
    });
    req.on("error", reject);
    req.end();
  });
}

const ok  = (s) => (s >= 200 && s < 300 ? "✅" : "❌");
const chk = (cond, label) => (cond ? "✅" : "❌") + " " + label;

const results = [];

function ep(num, path, status, checks) {
  results.push({ num, path, status, checks });
}

async function main() {
  console.log("");
  console.log("════════════════════════════════════════════════════════════════");
  console.log("  Чойбалсан ERP — AI Advisor  /  7 Шинэ Endpoint Тестийн Тайлан");
  console.log("  Огноо: " + new Date().toLocaleString("mn-MN"));
  console.log("════════════════════════════════════════════════════════════════");

  // ── EP12: GET /api/ai/executive/daily ─────────────────────────────────────
  {
    const r = await fetch("/api/ai/executive/daily");
    const d = r.body;
    console.log("\n" + ok(r.status) + " EP12 · GET /api/ai/executive/daily  [" + r.status + " · " + r.ms + "ms]");

    if (r.status === 200) {
      console.log("   📅 date:                   " + d.date);
      console.log("   💡 open_faults:            " + d.lighting?.open_faults + " гэмтэл");
      console.log("   📊 availability_pct:       " + d.lighting?.availability_pct + "%");
      console.log("   ⏳ oldest_fault:            " +
        (d.lighting?.oldest_open_faults?.[0]?.days_open || "—") + " хоног (" +
        (d.lighting?.oldest_open_faults?.[0]?.location_name || "—") + ")");
      console.log("   🔧 work.overdue:           " + d.work_orders?.overdue_count + " ажил хоцорсон");
      console.log("   📋 work.today_by_status:   " + JSON.stringify(d.work_orders?.today_by_status || []));
      console.log("   📡 iot.offline:            " + d.iot?.offline_count + " | alarm: " + d.iot?.alarm_count);
      console.log("   📦 inventory.low_stock:    " + d.inventory?.total_low_stock_items + " бараа дутагдаж байна");
      console.log("   👥 attendance.records:     " + d.attendance_this_month?.records_count +
        " | absent: " + (d.attendance_this_month?.total_absent || 0) +
        " | late: " + (d.attendance_this_month?.total_late || 0));

      const risks = d.top_risks || [];
      console.log("   ⚠️  top_risks (" + risks.length + "):");
      risks.forEach((r) => console.log("       [" + r.level.toUpperCase() + "] " + r.area + ": " + r.msg));

      const actions = d.recommended_actions || [];
      console.log("   💡 recommended_actions (" + actions.length + "):");
      actions.forEach((a) => console.log("       " + a));

      ep(12, "/api/ai/executive/daily", r.status, [
        chk(r.status === 200,           "HTTP 200"),
        chk(d.date != null,             "date талбар байна"),
        chk(typeof d.lighting?.open_faults === "number", "lighting.open_faults тоо"),
        chk(typeof d.work_orders?.overdue_count === "number", "work_orders.overdue_count тоо"),
        chk(typeof d.iot?.offline_count === "number", "iot.offline_count тоо"),
        chk(Array.isArray(d.top_risks), "top_risks массив"),
        chk(Array.isArray(d.recommended_actions), "recommended_actions массив"),
        chk(typeof d.inventory?.total_low_stock_items === "number", "inventory.total_low_stock_items тоо"),
        chk(d.attendance_this_month != null, "attendance_this_month байна"),
        chk(d.generated_at != null,     "generated_at байна"),
      ]);
    } else {
      console.log("   ❌ ERROR: " + JSON.stringify(d).slice(0, 200));
      ep(12, "/api/ai/executive/daily", r.status, [chk(false, "HTTP 200 (" + r.status + " ирлээ)")]);
    }
  }

  // ── EP13: GET /api/ai/lighting/schedule-today ─────────────────────────────
  {
    const r = await fetch("/api/ai/lighting/schedule-today");
    const d = r.body;
    console.log("\n" + ok(r.status) + " EP13 · GET /api/ai/lighting/schedule-today  [" + r.status + " · " + r.ms + "ms]");

    if (r.status === 200) {
      console.log("   📅 date:                   " + d.date);
      console.log("   ✋ manual_override_count:  " + d.manual_override_count);
      console.log("   📋 schedules found:        " + (d.schedules?.length || 0) + " категори");
      (d.schedules || []).forEach((s) => {
        const tag = s.is_always_off ? " 🔴ALWAYS_OFF" : "";
        console.log("     [" + s.category + "] on:" + (s.final_on_time || "—") +
          " off:" + (s.final_off_time || "—") + " → " + s.decision_source + tag);
      });

      ep(13, "/api/ai/lighting/schedule-today", r.status, [
        chk(r.status === 200,           "HTTP 200"),
        chk(d.date != null,             "date талбар байна"),
        chk(typeof d.manual_override_count === "number", "manual_override_count тоо"),
        chk(Array.isArray(d.schedules), "schedules массив"),
        chk(Array.isArray(d.priority_order), "priority_order массив"),
        chk((d.schedules || []).every((s) => s.decision_source != null),
          "schedules бүрт decision_source байна"),
      ]);
    } else {
      console.log("   ❌ ERROR: " + JSON.stringify(d).slice(0, 200));
      ep(13, "/api/ai/lighting/schedule-today", r.status, [chk(false, "HTTP 200 (" + r.status + " ирлээ)")]);
    }
  }

  // ── EP14: GET /api/ai/lighting/control-points-status ─────────────────────
  {
    const r = await fetch("/api/ai/lighting/control-points-status");
    const d = r.body;
    console.log("\n" + ok(r.status) + " EP14 · GET /api/ai/lighting/control-points-status  [" + r.status + " · " + r.ms + "ms]");

    if (r.status === 200) {
      const s = d.summary || {};
      console.log("   🔢 total control_points:   " + d.total);
      console.log("   🟢 healthy:                " + s.healthy);
      console.log("   🟡 warning:                " + s.warning);
      console.log("   🔴 fault:                  " + s.fault);
      console.log("   ⚫ offline:                " + s.offline);
      console.log("   ⬜ no_iot:                 " + s.no_iot);
      const pts = d.control_points || [];
      const faultPts   = pts.filter((p) => p.health_status === "fault").slice(0, 3);
      const offlinePts = pts.filter((p) => p.health_status === "offline").slice(0, 3);
      if (faultPts.length)   console.log("   🔴 fault examples:         " + faultPts.map((p) => p.name).join(", "));
      if (offlinePts.length) console.log("   ⚫ offline examples:       " + offlinePts.map((p) => p.name).join(", "));
      const sample = pts[0];
      if (sample) {
        console.log("   🔍 1st point sample:");
        console.log("      name:" + sample.name + " health:" + sample.health_status +
          " has_iot:" + sample.has_iot_device + " fault_status:" + sample.fault_status);
      }

      ep(14, "/api/ai/lighting/control-points-status", r.status, [
        chk(r.status === 200,           "HTTP 200"),
        chk(typeof d.total === "number", "total тоо"),
        chk(s.healthy != null,          "summary.healthy байна"),
        chk(s.offline != null,          "summary.offline байна"),
        chk(s.no_iot != null,           "summary.no_iot байна"),
        chk(Array.isArray(d.control_points), "control_points массив"),
        chk(pts.every((p) => p.health_status != null), "бүрт health_status байна"),
        chk(pts.every((p) => p.fault_status != null),  "бүрт fault_status байна"),
        chk(pts.every((p) => p.connectivity != null),  "бүрт connectivity байна"),
      ]);
    } else {
      console.log("   ❌ ERROR: " + JSON.stringify(d).slice(0, 200));
      ep(14, "/api/ai/lighting/control-points-status", r.status, [chk(false, "HTTP 200 (" + r.status + " ирлээ)")]);
    }
  }

  // ── EP15: GET /api/ai/iot/detailed ───────────────────────────────────────
  {
    const r = await fetch("/api/ai/iot/detailed");
    const d = r.body;
    console.log("\n" + ok(r.status) + " EP15 · GET /api/ai/iot/detailed  [" + r.status + " · " + r.ms + "ms]");

    if (r.status === 200) {
      const c = d.counts || {};
      console.log("   📡 total_nodes:            " + c.total_active_nodes);
      console.log("   🎮 feed_point_controllers: " + c.feed_point_controllers);
      console.log("   🟢 online:                 " + c.online);
      console.log("   🔴 offline_1h:             " + c.offline_1h);
      console.log("   ⚫ offline_6h:             " + c.offline_6h);
      console.log("   💀 offline_24h:            " + c.offline_24h);
      console.log("   ⚠️  fault_nodes:           " + c.fault_nodes);
      console.log("   📶 weak_signal_nodes:      " + c.weak_signal_nodes);
      if (d.fault_nodes?.length)
        console.log("   🔴 fault example:          " + d.fault_nodes[0]?.device_name + " (" + d.fault_nodes[0]?.last_status + ")");
      if (d.top_problem_nodes?.length)
        console.log("   🔴 top problem nodes:      " + d.top_problem_nodes.slice(0,3).map((n)=>n.device_name+"("+n.problem+")").join(", "));

      ep(15, "/api/ai/iot/detailed", r.status, [
        chk(r.status === 200,               "HTTP 200"),
        chk(typeof c.total_active_nodes === "number", "counts.total_active_nodes тоо"),
        chk(typeof c.online === "number",   "counts.online тоо"),
        chk(typeof c.offline_1h === "number", "counts.offline_1h тоо"),
        chk(typeof c.offline_6h === "number", "counts.offline_6h тоо"),
        chk(typeof c.offline_24h === "number","counts.offline_24h тоо"),
        chk(Array.isArray(d.fault_nodes),   "fault_nodes массив"),
        chk(Array.isArray(d.all_devices),   "all_devices массив"),
        chk((d.all_devices || []).every((dev) => dev.connectivity != null), "бүрт connectivity байна"),
      ]);
    } else {
      console.log("   ❌ ERROR: " + JSON.stringify(d).slice(0, 200));
      ep(15, "/api/ai/iot/detailed", r.status, [chk(false, "HTTP 200 (" + r.status + " ирлээ)")]);
    }
  }

  // ── EP16: GET /api/ai/work-orders/search ─────────────────────────────────
  {
    const r = await fetch("/api/ai/work-orders/search?overdue_only=true&limit=10");
    const d = r.body;
    console.log("\n" + ok(r.status) + " EP16 · GET /api/ai/work-orders/search?overdue_only=true  [" + r.status + " · " + r.ms + "ms]");

    if (r.status === 200) {
      console.log("   🔢 total returned:         " + d.summary?.total);
      console.log("   ⏰ overdue:                " + d.summary?.overdue);
      console.log("   🚨 critical:               " + d.summary?.critical);
      console.log("   🔴 high:                   " + d.summary?.high);
      const wos = d.work_orders || [];
      console.log("   📋 work_orders sample (3):");
      wos.slice(0, 3).forEach((w) => {
        console.log("     [" + w.risk_level?.toUpperCase() + "] " + (w.title || "").slice(0, 35) +
          " | +" + w.days_overdue + "хоног | " + w.next_required_action);
      });

      ep(16, "/api/ai/work-orders/search", r.status, [
        chk(r.status === 200,             "HTTP 200"),
        chk(d.summary != null,            "summary байна"),
        chk(typeof d.summary?.total === "number", "summary.total тоо"),
        chk(Array.isArray(d.work_orders), "work_orders массив"),
        chk(wos.every((w) => typeof w.is_overdue === "boolean"), "бүрт is_overdue boolean"),
        chk(wos.every((w) => typeof w.days_overdue === "number"), "бүрт days_overdue тоо"),
        chk(wos.every((w) => ["low","medium","high","critical"].includes(w.risk_level)), "бүрт risk_level хүчинтэй"),
        chk(wos.every((w) => w.next_required_action != null), "бүрт next_required_action байна"),
      ]);
    } else {
      console.log("   ❌ ERROR: " + JSON.stringify(d).slice(0, 200));
      ep(16, "/api/ai/work-orders/search", r.status, [chk(false, "HTTP 200 (" + r.status + " ирлээ)")]);
    }
  }

  // ── EP17: GET /api/ai/faults/workflow-status ──────────────────────────────
  {
    const r = await fetch("/api/ai/faults/workflow-status");
    const d = r.body;
    console.log("\n" + ok(r.status) + " EP17 · GET /api/ai/faults/workflow-status  [" + r.status + " · " + r.ms + "ms]");

    if (r.status === 200) {
      console.log("   🔄 workflow steps:         " + JSON.stringify(d.workflow_definition?.steps));
      console.log("   📊 by_status:              " + JSON.stringify(d.by_status || []));
      console.log("   ⏳ stuck_open_7+days:      " + d.stuck_open_over_7days?.length + " гэмтэл");
      if (d.stuck_open_over_7days?.length)
        console.log("     oldest: " + d.stuck_open_over_7days[0]?.location_name + " — " + d.stuck_open_over_7days[0]?.days_open + " хоног");
      console.log("   🔧 recently_repaired:      " + d.recently_repaired?.length + " засвар");
      console.log("   ❓ possibly_missed_close:  " + d.possibly_missed_close?.length + " гэмтэл");
      console.log("   ⚠️  risks:                 " + JSON.stringify(d.risks || []));

      ep(17, "/api/ai/faults/workflow-status", r.status, [
        chk(r.status === 200,             "HTTP 200"),
        chk(d.workflow_definition != null,"workflow_definition байна"),
        chk(Array.isArray(d.by_status),   "by_status массив"),
        chk(Array.isArray(d.stuck_open_over_7days), "stuck_open_over_7days массив"),
        chk(Array.isArray(d.recently_repaired), "recently_repaired массив"),
        chk(Array.isArray(d.risks),       "risks массив"),
      ]);
    } else {
      console.log("   ❌ ERROR: " + JSON.stringify(d).slice(0, 200));
      ep(17, "/api/ai/faults/workflow-status", r.status, [chk(false, "HTTP 200 (" + r.status + " ирлээ)")]);
    }
  }

  // ── EP18: GET /api/ai/audit/ai-summary ───────────────────────────────────
  {
    const r = await fetch("/api/ai/audit/ai-summary?days=7");
    const d = r.body;
    console.log("\n" + ok(r.status) + " EP18 · GET /api/ai/audit/ai-summary  [" + r.status + " · " + r.ms + "ms]");

    if (r.status === 200) {
      console.log("   📅 period_days:            " + d.period_days);
      console.log("   📖 total_reads:            " + d.totals?.total_ai_reads);
      console.log("   ❓ total_questions:        " + d.totals?.total_ai_questions);
      console.log("   ⏱️  reads_last_hour:       " + d.reads_last_hour);
      console.log("   🚦 rate_limit_warning:     " + d.rate_limit_warning);
      console.log("   📊 by_endpoint (" + (d.by_endpoint?.length || 0) + "):");
      (d.by_endpoint || []).forEach((e) => console.log("     " + e.endpoint + " → " + e.call_count + "x"));
      console.log("   📆 by_day: " + JSON.stringify(d.by_day || []));

      ep(18, "/api/ai/audit/ai-summary", r.status, [
        chk(r.status === 200,             "HTTP 200"),
        chk(typeof d.period_days === "number", "period_days тоо"),
        chk(d.totals != null,             "totals байна"),
        chk(typeof d.reads_last_hour === "number", "reads_last_hour тоо"),
        chk(typeof d.rate_limit_warning === "boolean", "rate_limit_warning boolean"),
        chk(Array.isArray(d.by_endpoint),"by_endpoint массив"),
        chk(Array.isArray(d.by_day),     "by_day массив"),
        chk(Array.isArray(d.recent_questions), "recent_questions массив"),
      ]);
    } else {
      console.log("   ❌ ERROR: " + JSON.stringify(d).slice(0, 200));
      ep(18, "/api/ai/audit/ai-summary", r.status, [chk(false, "HTTP 200 (" + r.status + " ирлээ)")]);
    }
  }

  // ── Аюулгүй байдлын тестүүд ──────────────────────────────────────────────
  console.log("\n── Аюулгүй байдлын тестүүд ──────────────────────────────────────");

  const noAuthR = await fetchNoAuth("/api/ai/executive/daily");
  console.log(chk(noAuthR.status === 401, "Token-гүй хүсэлт → 401  (авсан: " + noAuthR.status + ")"));

  const badToken = "eyJhbGciOiJIUzI1NiJ9.eyJpZCI6MSwicm9sZSI6ImVuZ2luZWVyIn0.FAKE";
  const badR = await new Promise((res, rej) => {
    const req = http.request(
      { host: "localhost", port: 4000, path: "/api/ai/executive/daily", headers: { Authorization: "Bearer " + badToken } },
      (r) => { let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => res({ status: r.statusCode, body: b })); }
    );
    req.on("error", rej); req.end();
  });
  console.log(chk(badR.status === 401, "Буруу token → 401  (авсан: " + badR.status + ")"));

  // Rate limit тест (61 хүсэлт)
  let rl200 = 0, rl429 = 0;
  for (let i = 0; i < 61; i++) {
    const r = await fetch("/api/ai/executive/daily");
    if (r.status === 200) rl200++; else if (r.status === 429) rl429++;
  }
  console.log(chk(rl429 > 0, "Rate limit (61 хүсэлт) → 429 авлаа (" + rl429 + " удаа)"));

  // ── Дүгнэлт ──────────────────────────────────────────────────────────────
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("  ДҮГНЭЛТ");
  console.log("════════════════════════════════════════════════════════════════");

  let totalChecks = 0, passedChecks = 0;
  results.forEach((ep) => {
    const passed = ep.checks.filter((c) => c.startsWith("✅")).length;
    const total  = ep.checks.length;
    totalChecks += total;
    passedChecks += passed;
    const allOk  = passed === total;
    console.log((allOk ? "✅" : "❌") + " EP" + ep.num + "  " + ep.path.padEnd(45) +
      " HTTP:" + ep.status + "  " + passed + "/" + total + " шалгалт");
    ep.checks.filter((c) => c.startsWith("❌")).forEach((c) => console.log("      ⚠️  FAILED: " + c));
  });

  console.log("\n  Нийт шалгалт:  " + passedChecks + " / " + totalChecks +
    "  (" + Math.round((passedChecks / totalChecks) * 100) + "%)");
  console.log("  Дуусгасан:     " + new Date().toLocaleString("mn-MN"));
  console.log("════════════════════════════════════════════════════════════════");
}

main().catch((e) => {
  console.error("SCRIPT ERROR:", e.message);
  process.exit(1);
});
