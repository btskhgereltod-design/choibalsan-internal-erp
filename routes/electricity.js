"use strict";
const express = require("express");
const router  = express.Router();
const path    = require("path");
const fs      = require("fs");
const PDFParser = require("pdf2json");
const { run, all, get, auth, audit, upload } = require("../db");
const { requirePermission } = require("../middleware/roles");

// ── PDF helpers ──────────────────────────────────────────────────
function readPDF(filePath) {
  return new Promise((resolve, reject) => {
    const parser = new PDFParser(null, 1);
    parser.on("pdfParser_dataError", e => reject(e));
    parser.on("pdfParser_dataReady", pdfData => {
      try {
        const pages = pdfData.Pages || (pdfData.formImage && pdfData.formImage.Pages) || [];
        const text = pages.map(p =>
          (p.Texts || []).map(t => decodeURIComponent(t.R.map(r => r.T).join(""))).join(" ")
        ).join("\n");
        resolve(text);
      } catch (e) { reject(e); }
    });
    parser.loadPDF(filePath);
  });
}

function pNum(s) {
  return parseFloat(String(s || 0).replace(/[\s,]/g, "")) || 0;
}

function extractMeta(text) {
  const invoice_no = (text.match(/№\s*(4\d{12})/) || [])[1] || null;

  const MONTHS = [
    "нэгдүгээр","хоёрдугаар","гуравдугаар","дөрөвдүгээр","тавдугаар",
    "зургадугаар","долдугаар","наймдугаар","есдүгээр","аравдугаар",
    "арваннэгдүгээр","арванхоёрдугаар"
  ];

  let billing_year = null, billing_month = null;
  const yearM = text.match(/(\d{4})\s*оны/i);
  if (yearM) billing_year = parseInt(yearM[1]);

  for (let i = 0; i < MONTHS.length; i++) {
    if (new RegExp(MONTHS[i], "i").test(text)) { billing_month = i + 1; break; }
  }
  if (!billing_month) {
    const mM = text.match(/(\d{1,2})\s*дугаар\s*сар/i);
    if (mM) billing_month = parseInt(mM[1]);
  }

  // Fallback: derive from invoice_no format 4YYMMDD...
  if (invoice_no && (!billing_year || !billing_month)) {
    const inv = invoice_no.match(/^4(\d{2})(\d{2})\d{2}/);
    if (inv) {
      const iYear  = 2000 + parseInt(inv[1]);
      const iMonth = parseInt(inv[2]);
      if (!billing_year  && iYear  >= 2020) billing_year  = iYear;
      if (!billing_month && iMonth >= 1 && iMonth <= 12)
        billing_month = iMonth;
    }
  }

  // Take the last number > 1,000,000 that appears BEFORE "Эцсийн үлдэгдэл" / "Нийт орлого".
  // pdf2json joins all text in one page as a single space-separated string (no \n within a page),
  // so keyword-line splits are unreliable. Cutting at the accounting-summary boundary is robust.
  let total_amount = 0;
  const cutMatch = text.search(/Эцсийн\s+үлдэгдэл|Нийт\s+орлого/i);
  const searchText = cutMatch > 0 ? text.slice(0, cutMatch) : text;
  for (const m of [...searchText.matchAll(/\b(\d{1,3}(?:,\d{3})+\.\d{2})\b/g)]) {
    const v = pNum(m[1]);
    if (v > 1_000_000) total_amount = v;
  }

  return { invoice_no, billing_year, billing_month, total_amount };
}

function splitHeader(header) {
  const tokens = (header || "").trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return { meter_no: "", location: "" };

  let meter_no, location;

  if (tokens[0].includes("*K*") || tokens[0] === "*K*") {
    meter_no = tokens[0];
    location = tokens.slice(1).join(" ");
  } else if (tokens[0].toLowerCase() === "ктп") {
    meter_no = tokens.slice(0, 2).join(" ");
    location = tokens.slice(2).join(" ");
  } else if (tokens[0] === "№") {
    meter_no = tokens.length > 1 ? "№" + tokens[1] : "№";
    location = tokens.slice(tokens.length > 1 ? 2 : 1).join(" ");
  } else if (tokens[0].startsWith("№")) {
    meter_no = tokens[0];
    location = tokens.slice(1).join(" ");
  } else if (/^\d{4}$/.test(tokens[0]) && tokens.length > 1 && /^\d{5,}$/.test(tokens[1])) {
    meter_no = tokens[0] + " " + tokens[1];
    location = tokens.slice(2).join(" ");
  } else {
    meter_no = tokens[0];
    location = tokens.slice(1).join(" ");
  }

  const loc = location.trim();
  // PDF-ээс зөвхөн тоо (тоо хэмжээ, дарааллын дугаар) location-д орвол хоосон болгоно
  const locClean = /^\d+$/.test(loc) ? "" : loc;
  return { meter_no: meter_no.trim(), location: locClean };
}

function parsePDFRows(text) {
  const rawRows = [];
  let seq = 0;

  // Split on row-type markers
  const parts = text.split(/(Өдөр|Шөнө|Энгийн\s+тарифаар|Тариф\s+1\s*\([^)]*\))/);

  // 5-num METERED: header prev curr diff 1.000 kwh 241 amount  (commas allowed as thousands sep)
  const re5 = /^(.*?)\s+([\d,]+\.\d{1,4})\s+([\d,]+\.\d{1,4})\s+([\d,]+\.\d{1,4})\s+1\.0+\s+([\d,]+\.\d{1,4})\s+241(?:\.0+)?\s+([\d, ]+\.\d{2})/;
  // 4-num METERED (*K* type): header prev curr 1.000 kwh 241 amount
  const re4 = /^(.*?)\s+([\d,]+\.\d{1,4})\s+([\d,]+\.\d{1,4})\s+1\.0+\s+([\d,]+\.\d{1,4})\s+241(?:\.0+)?\s+([\d, ]+\.\d{2})/;
  // FIXED (Энгийн тарифаар): header n1 n2 n3 n4 15500 amount
  const reF = /^(.*?)\s+([\d,]+\.\d{1,4})\s+([\d,]+\.\d{1,4})\s+([\d,]+\.\d{1,4})\s+([\d,]+\.\d{1,4})\s+15500(?:\.0+)?\s+([\d, ]+\.\d{2})/;

  for (let i = 1; i < parts.length; i += 2) {
    const typeToken = parts[i].trim();
    const body = (parts[i + 1] || "").trim();

    const isFixed = /Энгийн\s+тарифаар/.test(typeToken);
    const time_type = typeToken === "Шөнө" ? "NIGHT" : "DAY";
    const row_type = isFixed ? "FIXED" : "METERED";

    let m;
    if (!isFixed) {
      m = body.match(re5);
      if (m) {
        const { meter_no, location } = splitHeader(m[1]);
        rawRows.push({
          row_seq: ++seq, row_type, time_type, meter_no, location,
          prev_reading: pNum(m[2]), curr_reading: pNum(m[3]),
          usage_kwh: pNum(m[5]), tariff: 241, amount: pNum(m[6]),
          raw_text: (typeToken + " " + m[0]).substring(0, 120)
        });
        continue;
      }
      m = body.match(re4);
      if (m) {
        const { meter_no, location } = splitHeader(m[1]);
        rawRows.push({
          row_seq: ++seq, row_type, time_type, meter_no, location,
          prev_reading: pNum(m[2]), curr_reading: pNum(m[3]),
          usage_kwh: pNum(m[4]), tariff: 241, amount: pNum(m[5]),
          raw_text: (typeToken + " " + m[0]).substring(0, 120)
        });
      }
    } else {
      m = body.match(reF);
      if (m) {
        const { meter_no, location } = splitHeader(m[1]);
        rawRows.push({
          row_seq: ++seq, row_type, time_type, meter_no, location,
          prev_reading: pNum(m[2]), curr_reading: pNum(m[3]),
          usage_kwh: pNum(m[4]), tariff: 15500, amount: pNum(m[6]),
          raw_text: (typeToken + " " + m[0]).substring(0, 120)
        });
      }
    }
  }

  return rawRows;
}

function normalizeRows(rawRows) {
  const map   = new Map();
  const seqMap = new Map();

  for (const r of rawRows) {
    const key = r.meter_no;
    if (!map.has(key)) {
      map.set(key, {
        meter_no: r.meter_no, location: r.location,
        row_type: r.row_type,
        prev_reading: r.prev_reading, curr_reading: r.curr_reading,
        usage_kwh: 0, day_kwh: 0, night_kwh: 0,
        capacity_amount: 0, tariff: r.tariff, amount: 0,
        raw_row_count: 0
      });
      seqMap.set(key, []);
    }
    const e = map.get(key);
    seqMap.get(key).push(r.row_seq);
    e.raw_row_count++;

    if (r.row_type === "METERED") {
      e.usage_kwh += r.usage_kwh;
      if (r.time_type === "DAY") e.day_kwh += r.usage_kwh;
      else                        e.night_kwh += r.usage_kwh;
      e.amount += r.amount;
      if (r.curr_reading > e.curr_reading) {
        e.prev_reading = r.prev_reading;
        e.curr_reading = r.curr_reading;
      }
    } else {
      e.capacity_amount += r.amount;
      e.amount          += r.amount;
    }
  }

  return { normRows: [...map.values()], seqMap };
}

async function runChecks(normRows, seqMap, year, month) {
  const checks = [];
  if (!year || !month) return checks;

  const prevYear  = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12        : month - 1;
  const prevPoints = await all(
    `SELECT ebp.meter_no, ebp.usage_kwh
     FROM electricity_bill_points ebp
     JOIN electricity_bill_imports ebi ON ebi.id = ebp.import_id
     WHERE ebi.billing_year=? AND ebi.billing_month=?`,
    [prevYear, prevMonth]
  );
  const prevMap = new Map(prevPoints.map(p => [p.meter_no, p.usage_kwh]));

  for (const row of normRows) {
    const mp = await get("SELECT * FROM meter_points WHERE meter_no=?", [row.meter_no]);

    // A: NEW_POINT
    if (!mp) {
      checks.push({
        check_code: "NEW_POINT", check_name: "Шинэ цэг", severity: "WARNING",
        message: `Тоолуур ${row.meter_no} master registry-д байхгүй`,
        meter_no: row.meter_no
      });
      continue;
    }

    row.meter_point_id = mp.id;
    row.owner_status   = mp.owner_status;
    row.mp_status      = mp.status;

    // B: OWNER_MISMATCH
    if (mp.owner_status !== "OURS") {
      checks.push({
        check_code: "OWNER_MISMATCH", check_name: "Өмчийн зөрүү", severity: "WARNING",
        message: `Тоолуур ${row.meter_no} манай биш (${mp.owner_status})`,
        meter_no: row.meter_no
      });
    }

    // C: TRANSFERRED_BUT_BILLED
    if (mp.status === "TRANSFERRED" || mp.owner_status === "TRANSFERRED") {
      checks.push({
        check_code: "TRANSFERRED_BUT_BILLED", check_name: "Шилжүүлсэн боловч тооцсон",
        severity: "WARNING",
        message: `Тоолуур ${row.meter_no} шилжүүлсэн төлөвтэй боловч тооцоонд орсон`,
        meter_no: row.meter_no
      });
    }

    // D: DUPLICATE_METER (>2 raw rows for METERED)
    const seqs = seqMap.get(row.meter_no) || [];
    if (row.row_type === "METERED" && seqs.length > 2) {
      checks.push({
        check_code: "DUPLICATE_METER", check_name: "Давхардсан тоолуур", severity: "INFO",
        message: `Тоолуур ${row.meter_no} ${seqs.length} удаа тооцогдсон`,
        meter_no: row.meter_no
      });
    }

    // G: ZERO_USAGE
    if (row.row_type === "METERED" && row.usage_kwh === 0) {
      checks.push({
        check_code: "ZERO_USAGE", check_name: "Хэрэглээ тэг", severity: "WARNING",
        message: `Тоолуур ${row.meter_no}-н кВт.цаг хэрэглээ тэг байна`,
        meter_no: row.meter_no
      });
    }

    // H: TARIFF_MISMATCH
    if (row.row_type === "METERED" && row.tariff !== 241) {
      checks.push({
        check_code: "TARIFF_MISMATCH", check_name: "Тариф зөрүү", severity: "ERROR",
        message: `Тоолуур ${row.meter_no}-н тариф ${row.tariff} ₮ (хүлээгдэж буй: 241 ₮)`,
        meter_no: row.meter_no
      });
    }

    // E/F: USAGE_SPIKE / USAGE_DROP vs previous month
    if (prevMap.has(row.meter_no) && row.usage_kwh > 0) {
      const prev  = prevMap.get(row.meter_no);
      if (prev > 0) {
        const ratio = row.usage_kwh / prev;
        if (ratio > 1.3) {
          checks.push({
            check_code: "USAGE_SPIKE", check_name: "Хэрэглээ огцом өссөн", severity: "WARNING",
            message: `${row.meter_no}: ${prev.toFixed(0)}→${row.usage_kwh.toFixed(0)} кВт.ц (+${((ratio-1)*100).toFixed(0)}%)`,
            meter_no: row.meter_no
          });
        } else if (ratio < 0.7) {
          checks.push({
            check_code: "USAGE_DROP", check_name: "Хэрэглээ огцом буурсан", severity: "WARNING",
            message: `${row.meter_no}: ${prev.toFixed(0)}→${row.usage_kwh.toFixed(0)} кВт.ц (-${((1-ratio)*100).toFixed(0)}%)`,
            meter_no: row.meter_no
          });
        }
      }
    }
  }

  return checks;
}

// ── GET /el-summary ──────────────────────────────────────────────
router.get("/el-summary", auth, async (req, res) => {
  try {
    const total_points    = (await get("SELECT COUNT(*) as c FROM meter_points WHERE status='ACTIVE'")).c;
    const our_points      = (await get("SELECT COUNT(*) as c FROM meter_points WHERE status='ACTIVE' AND owner_status='OURS'")).c;
    const unverified      = (await get("SELECT COUNT(*) as c FROM meter_points WHERE (verified=0 OR verified IS NULL) AND status='ACTIVE'")).c;
    const new_points      = (await get("SELECT COUNT(DISTINCT meter_no) as c FROM electricity_bill_checks WHERE check_code='NEW_POINT' AND is_resolved=0")).c;
    const warnings        = (await get("SELECT COUNT(*) as c FROM electricity_bill_checks WHERE severity IN ('WARNING','ERROR') AND is_resolved=0")).c;

    const latest = await get(`SELECT * FROM electricity_bill_imports WHERE status='confirmed' ORDER BY billing_year DESC, billing_month DESC LIMIT 1`);
    const prev   = latest ? await get(
      `SELECT * FROM electricity_bill_imports WHERE status='confirmed' AND (billing_year < ? OR (billing_year=? AND billing_month<?)) ORDER BY billing_year DESC, billing_month DESC LIMIT 1`,
      [latest.billing_year, latest.billing_year, latest.billing_month]
    ) : null;

    const mom_change = (latest && prev && prev.our_amount > 0)
      ? +((latest.our_amount - prev.our_amount) / prev.our_amount * 100).toFixed(1)
      : null;

    const recent_bills = await all(`SELECT * FROM electricity_bill_imports ORDER BY billing_year DESC, billing_month DESC LIMIT 6`);

    res.json({
      total_points, our_points, unverified, new_points, warnings,
      total_amount: latest ? latest.total_amount : 0,
      our_amount:   latest ? latest.our_amount   : 0,
      our_kwh:      latest ? latest.our_kwh      : 0,
      mom_change,
      latest_bill:  latest,
      recent_bills
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Meter Points CRUD ────────────────────────────────────────────
router.get("/mp", auth, async (req, res) => {
  try {
    res.json(await all("SELECT * FROM meter_points WHERE status != 'REMOVED' ORDER BY status, meter_no"));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/mp", auth, requirePermission("meter_write"), async (req, res) => {
  const { meter_no, name, location, owner_status, lamp_count, wattage_per_lamp, notes } = req.body;
  if (!meter_no) return res.status(400).json({ error: "Тоолуурын дугаар шаардлагатай" });
  try {
    const r = await run(
      "INSERT INTO meter_points(meter_no,name,location,owner_status,lamp_count,wattage_per_lamp,notes,created_by) VALUES(?,?,?,?,?,?,?,?)",
      [meter_no.trim(), name||"", location||"", owner_status||"OURS",
       lamp_count||1, wattage_per_lamp||0, notes||"", req.user.id]
    );
    await audit(req.user.id, "CREATE", "meter_points", r.id, `meter_no=${meter_no}`);
    res.json({ id: r.id });
  } catch (e) {
    if (e.message.includes("UNIQUE")) return res.status(409).json({ error: "Тоолуурын дугаар давхардсан байна" });
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/mp/by-panel/:panelId — meters linked to a Шит/Самбар asset ──
router.get("/mp/by-panel/:panelId", auth, async (req, res) => {
  try {
    const rows = await all(
      "SELECT * FROM meter_points WHERE panel_asset_id=? AND status!='REMOVED' ORDER BY meter_no",
      [req.params.panelId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PUT /api/mp/:id/panel — link/unlink meter to a panel asset ──
router.put("/mp/:id/panel", auth, requirePermission("meter_write"), async (req, res) => {
  const { panel_asset_id } = req.body;
  try {
    await run(
      "UPDATE meter_points SET panel_asset_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      [panel_asset_id || null, req.params.id]
    );
    await audit(req.user.id, "UPDATE", "meter_points", req.params.id,
      panel_asset_id ? `panel_asset_id=${panel_asset_id}` : "panel unlinked");
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PUT /api/mp/bulk-delete — soft-delete multiple meters ────────
router.put("/mp/bulk-delete", auth, requirePermission("meter_write"), async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length)
    return res.status(400).json({ error: "Мэдээлэл дутуу" });
  for (const id of ids) {
    await run(
      "UPDATE meter_points SET status='REMOVED',updated_at=CURRENT_TIMESTAMP WHERE id=?",
      [id]
    );
  }
  await audit(req.user.id, "BULK_DELETE", "meter_points", null,
    `${ids.length} тоолуур устгагдлаа`);
  res.json({ ok: true, deleted: ids.length });
});

// ── PUT /api/mp/bulk-verify must be BEFORE /mp/:id to avoid route collision ───
router.put("/mp/bulk-verify", auth, requirePermission("meter_write"), async (req, res) => {
  const { ids, owner_status } = req.body;
  if (!Array.isArray(ids) || !ids.length || !owner_status)
    return res.status(400).json({ error: "Мэдэлэл дутуу" });
  if (!["OURS","OTHER","TRANSFERRED","UNKNOWN"].includes(owner_status))
    return res.status(400).json({ error: "Буруу өмчийн төрөл" });
  for (const id of ids) {
    await run(
      "UPDATE meter_points SET owner_status=?,verified=1,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      [owner_status, id]
    );
  }
  await audit(req.user.id, "BULK_VERIFY", "meter_points", null,
    `${ids.length} тоолуур → ${owner_status}`);
  res.json({ ok: true, updated: ids.length });
});

router.put("/mp/:id", auth, requirePermission("meter_write"), async (req, res) => {
  const { name, location, owner_status, status, lamp_count, wattage_per_lamp, notes, panel_asset_id } = req.body;
  try {
    await run(
      "UPDATE meter_points SET name=?,location=?,owner_status=?,status=?,lamp_count=?,wattage_per_lamp=?,notes=?,panel_asset_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      [name||"", location||"", owner_status||"OURS", status||"ACTIVE",
       lamp_count||1, wattage_per_lamp||0, notes||"", panel_asset_id||null, req.params.id]
    );
    await audit(req.user.id, "UPDATE", "meter_points", req.params.id, `owner_status=${owner_status}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete("/mp/:id", auth, requirePermission("meter_write"), async (req, res) => {
  try {
    await run("UPDATE meter_points SET status='REMOVED',updated_at=CURRENT_TIMESTAMP WHERE id=?", [req.params.id]);
    await audit(req.user.id, "REMOVE", "meter_points", req.params.id, "soft delete");
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/mp/bootstrap — parse 1+ PDFs, auto-create draft meter_points ──
router.post("/mp/bootstrap", auth, requirePermission("meter_write"), upload.array("pdfs", 20), async (req, res) => {
  if (!req.files || !req.files.length) return res.status(400).json({ error: "PDF файл шаардлагатай" });

  // Collect unique meters across all uploaded PDFs
  const meterMap = new Map(); // meter_no → { location, freq }
  for (const file of req.files) {
    try {
      const text    = await readPDF(file.path);
      const rawRows = parsePDFRows(text);
      for (const r of rawRows) {
        if (!r.meter_no) continue;
        if (!meterMap.has(r.meter_no)) {
          meterMap.set(r.meter_no, { location: r.location || "", freq: 0 });
        }
        const e = meterMap.get(r.meter_no);
        e.freq++;
        // prefer a real location over an empty or numeric-only one
        const isNumeric = loc => /^\d*$/.test(loc || "");
        if (isNumeric(e.location) && !isNumeric(r.location) && r.location) e.location = r.location;
      }
    } finally {
      fs.unlink(file.path, () => {});
    }
  }

  let created = 0, already = 0;
  for (const [meter_no, info] of meterMap) {
    const ex = await get("SELECT id FROM meter_points WHERE meter_no=? AND status != 'REMOVED'", [meter_no]);
    if (!ex) {
      await run(
        `INSERT INTO meter_points(meter_no,location,owner_status,status,verified,auto_created,created_by)
         VALUES(?,?,?,?,0,1,?)`,
        [meter_no, info.location, "UNKNOWN", "ACTIVE", req.user.id]
      );
      created++;
    } else {
      already++;
    }
  }

  // Аль хэдийн байгаа UNKNOWN мөрийн location нь тоо бол шинэ сайн location-оор шинэчлэх
  let locationFixed = 0;
  for (const [meter_no, info] of meterMap) {
    if (!info.location || /^\d*$/.test(info.location)) continue;
    const ex = await get(
      "SELECT id, location FROM meter_points WHERE meter_no=? AND owner_status='UNKNOWN'",
      [meter_no]
    );
    if (ex && /^\d*$/.test(ex.location || "")) {
      await run(
        "UPDATE meter_points SET location=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        [info.location, ex.id]
      );
      locationFixed++;
    }
  }

  await audit(req.user.id, "BOOTSTRAP", "meter_points", null,
    `${created} шинэ draft, ${already} аль хэдийн байсан, ${locationFixed} байршил засагдлаа`);
  res.json({ ok: true, created, already, total: meterMap.size, locationFixed });
});


// ── Bill Imports ─────────────────────────────────────────────────
router.get("/eb", auth, async (req, res) => {
  try {
    res.json(await all(`
      SELECT ebi.*,
        (SELECT COUNT(*) FROM electricity_bill_checks ebc WHERE ebc.import_id=ebi.id AND ebc.is_resolved=0) AS unresolved_checks,
        (SELECT COUNT(*) FROM electricity_bill_points ebp WHERE ebp.import_id=ebi.id) AS point_count
      FROM electricity_bill_imports ebi
      ORDER BY billing_year DESC, billing_month DESC
    `));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/eb/:id", auth, async (req, res) => {
  try {
    const bill = await get("SELECT * FROM electricity_bill_imports WHERE id=?", [req.params.id]);
    if (!bill) return res.status(404).json({ error: "Олдсонгүй" });
    const points = await all("SELECT * FROM electricity_bill_points WHERE import_id=? ORDER BY meter_no", [req.params.id]);
    const checks = await all("SELECT * FROM electricity_bill_checks WHERE import_id=? ORDER BY severity DESC, meter_no", [req.params.id]);
    res.json({ bill, points, checks });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put("/eb/:id/status", auth, requirePermission("finance_write"), async (req, res) => {
  const { status, notes } = req.body;
  try {
    await run("UPDATE electricity_bill_imports SET status=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      [status, notes||"", req.params.id]);
    await audit(req.user.id, "STATUS", "electricity_bill_imports", req.params.id, status);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PUT /eb/:id/pay — record payment ─────────────────────────────
router.put("/eb/:id/pay", auth, requirePermission("finance_write"), async (req, res) => {
  const { paid_at, paid_amount, payment_ref } = req.body;
  if (!paid_at) return res.status(400).json({ error: "Төлсөн огноо шаардлагатай" });
  try {
    const bill = await get("SELECT * FROM electricity_bill_imports WHERE id=?", [req.params.id]);
    if (!bill) return res.status(404).json({ error: "Олдсонгүй" });
    await run(
      `UPDATE electricity_bill_imports
       SET paid_at=?, paid_amount=?, payment_ref=?, paid_by=?, status='paid', updated_at=CURRENT_TIMESTAMP
       WHERE id=?`,
      [paid_at, paid_amount || bill.our_amount, payment_ref || null, req.user.id, req.params.id]);
    await audit(req.user.id, "PAY", "electricity_bill_imports", req.params.id,
      `${bill.billing_year}-${String(bill.billing_month).padStart(2,"0")} · ${paid_at}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /eb/:id — delete a bill import and all child data ─────
router.delete("/eb/:id", auth, requirePermission("finance_write"), async (req, res) => {
  try {
    const bill = await get("SELECT * FROM electricity_bill_imports WHERE id=?", [req.params.id]);
    if (!bill) return res.status(404).json({ error: "Олдсонгүй" });
    // Child rows cascade via ON DELETE CASCADE; raw_rows/points/checks auto-deleted
    await run("DELETE FROM electricity_bill_imports WHERE id=?", [req.params.id]);
    await audit(req.user.id, "DELETE", "electricity_bill_imports", req.params.id,
      `${bill.billing_year}-${String(bill.billing_month).padStart(2,"0")}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /el-import/preview ──────────────────────────────────────
router.post("/el-import/preview", auth, requirePermission("finance_write"), upload.single("pdf"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "PDF файл шаардлагатай" });
  const filePath = req.file.path;
  try {
    const text = await readPDF(filePath);
    const meta = extractMeta(text);
    const rawRows = parsePDFRows(text);
    const { normRows, seqMap } = normalizeRows(rawRows);
    const checks = await runChecks(normRows, seqMap, meta.billing_year, meta.billing_month);

    const total_kwh  = normRows.reduce((s, r) => s + r.usage_kwh, 0);
    const our_kwh    = normRows.filter(r => r.owner_status === "OURS").reduce((s, r) => s + r.usage_kwh, 0);
    const our_amount = normRows.filter(r => r.owner_status === "OURS").reduce((s, r) => s + r.amount, 0);

    res.json({
      meta, rawRows, normRows, checks,
      stats: {
        total_kwh:      +total_kwh.toFixed(3),
        our_kwh:        +our_kwh.toFixed(3),
        our_amount:     +our_amount.toFixed(2),
        total_amount:   meta.total_amount,
        point_count:    normRows.length,
        raw_row_count:  rawRows.length,
        check_count:    checks.length,
        warning_count:  checks.filter(c => c.severity === "WARNING" || c.severity === "ERROR").length
      }
    });
  } catch (e) {
    console.error("[el-import/preview]", e);
    res.status(500).json({ error: e.message });
  } finally {
    fs.unlink(filePath, () => {});
  }
});

// ── POST /el-import/confirm ──────────────────────────────────────
router.post("/el-import/confirm", auth, requirePermission("finance_write"), async (req, res) => {
  const { meta, rawRows, normRows, checks } = req.body;
  if (!meta || !meta.billing_year || !meta.billing_month)
    return res.status(400).json({ error: "Огноо дутуу байна" });

  try {
    const existing = await get(
      "SELECT id FROM electricity_bill_imports WHERE billing_year=? AND billing_month=?",
      [meta.billing_year, meta.billing_month]
    );
    if (existing)
      return res.status(409).json({ error: `${meta.billing_year}-${meta.billing_month} сарын тооцоо аль хэдийн орсон байна` });

    const rows      = normRows || [];
    const total_kwh  = rows.reduce((s, r) => s + (r.usage_kwh || 0), 0);
    const our_kwh    = rows.filter(r => r.owner_status === "OURS").reduce((s, r) => s + (r.usage_kwh || 0), 0);
    const our_amount = rows.filter(r => r.owner_status === "OURS").reduce((s, r) => s + (r.amount || 0), 0);
    const diff_kwh   = total_kwh - our_kwh;
    const diff_amount = (meta.total_amount || 0) - our_amount;

    const imp = await run(
      `INSERT INTO electricity_bill_imports
         (invoice_no,billing_year,billing_month,total_kwh,total_amount,our_kwh,our_amount,diff_kwh,diff_amount,status,created_by)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      [meta.invoice_no || null, meta.billing_year, meta.billing_month,
       +total_kwh.toFixed(3), meta.total_amount || 0,
       +our_kwh.toFixed(3), +our_amount.toFixed(2),
       +diff_kwh.toFixed(3), +diff_amount.toFixed(2),
       "confirmed", req.user.id]
    );
    const importId = imp.id;

    for (const r of (rawRows || [])) {
      await run(
        `INSERT INTO electricity_bill_raw_rows
           (import_id,row_seq,row_type,time_type,meter_no,location,prev_reading,curr_reading,usage_kwh,tariff,amount,raw_text)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
        [importId, r.row_seq, r.row_type, r.time_type, r.meter_no, r.location || "",
         r.prev_reading || 0, r.curr_reading || 0, r.usage_kwh || 0,
         r.tariff || 0, r.amount || 0, r.raw_text || ""]
      );
    }

    const billPointIds = new Map();
    for (const r of rows) {
      const bp = await run(
        `INSERT INTO electricity_bill_points
           (import_id,meter_no,location,prev_reading,curr_reading,usage_kwh,day_kwh,night_kwh,
            capacity_amount,tariff,amount,row_type,raw_row_count,meter_point_id,owner_status,mp_status)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [importId, r.meter_no, r.location || "",
         r.prev_reading || 0, r.curr_reading || 0,
         r.usage_kwh || 0, r.day_kwh || 0, r.night_kwh || 0,
         r.capacity_amount || 0, r.tariff || 0, r.amount || 0,
         r.row_type || "METERED", r.raw_row_count || 1,
         r.meter_point_id || null, r.owner_status || null, r.mp_status || null]
      );
      billPointIds.set(r.meter_no, bp.id);
    }

    for (const c of (checks || [])) {
      await run(
        `INSERT INTO electricity_bill_checks
           (import_id,bill_point_id,check_code,check_name,severity,message,meter_no,is_resolved)
         VALUES(?,?,?,?,?,?,?,0)`,
        [importId, billPointIds.get(c.meter_no) || null,
         c.check_code, c.check_name, c.severity, c.message, c.meter_no || ""]
      );
    }

    // Auto-create draft meter_points for any meter_no not in master registry
    let newDrafts = 0;
    for (const r of rows) {
      if (!r.meter_point_id) {
        const ex = await get("SELECT id FROM meter_points WHERE meter_no=?", [r.meter_no]);
        if (!ex) {
          await run(
            `INSERT OR IGNORE INTO meter_points(meter_no,location,owner_status,status,verified,auto_created,created_by)
             VALUES(?,?,?,?,0,1,?)`,
            [r.meter_no, r.location || "", "UNKNOWN", "ACTIVE", req.user.id]
          );
          newDrafts++;
        }
      }
    }

    await audit(req.user.id, "IMPORT", "electricity_bill_imports", importId,
      `${meta.billing_year}-${String(meta.billing_month).padStart(2,"0")} / ${rows.length} цэг / ${newDrafts} шинэ draft`);

    res.json({ ok: true, id: importId, new_drafts: newDrafts });
  } catch (e) {
    console.error("[el-import/confirm]", e);
    if (e.message.includes("UNIQUE"))
      return res.status(409).json({ error: "Энэ сарын тооцоо аль хэдийн орсон байна" });
    res.status(500).json({ error: e.message });
  }
});

// ── PUT /el-check/:id/resolve ────────────────────────────────────
router.put("/el-check/:id/resolve", auth, requirePermission("finance_write"), async (req, res) => {
  const { resolution_note } = req.body;
  try {
    await run(
      "UPDATE electricity_bill_checks SET is_resolved=1,resolved_by=?,resolved_at=CURRENT_TIMESTAMP,resolution_note=? WHERE id=?",
      [req.user.id, resolution_note || "", req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Meter Transfers ──────────────────────────────────────────────
router.get("/mt", auth, async (req, res) => {
  try {
    res.json(await all(`
      SELECT mt.*, mp.meter_no, mp.name, mp.location
      FROM meter_transfers mt
      JOIN meter_points mp ON mp.id = mt.meter_point_id
      ORDER BY mt.transfer_date DESC
    `));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/mt", auth, requirePermission("finance_write"), async (req, res) => {
  const { meter_point_id, from_status, to_status, transfer_date, doc_no, reason, notes } = req.body;
  if (!meter_point_id || !to_status || !transfer_date)
    return res.status(400).json({ error: "Мэдэлэл дутуу" });
  try {
    const mp = await get("SELECT * FROM meter_points WHERE id=?", [meter_point_id]);
    if (!mp) return res.status(404).json({ error: "Тоолуур олдсонгүй" });

    const r = await run(
      "INSERT INTO meter_transfers(meter_point_id,from_status,to_status,transfer_date,doc_no,reason,notes,created_by) VALUES(?,?,?,?,?,?,?,?)",
      [meter_point_id, from_status || mp.owner_status, to_status,
       transfer_date, doc_no||"", reason||"", notes||"", req.user.id]
    );
    await run("UPDATE meter_points SET owner_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?", [to_status, meter_point_id]);
    await audit(req.user.id, "TRANSFER", "meter_points", meter_point_id, `${mp.owner_status}→${to_status}`);
    res.json({ id: r.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Budget Plan ──────────────────────────────────────────────────
router.get("/el-budget", auth, async (req, res) => {
  try {
    const plans = await all("SELECT * FROM el_budget_plan ORDER BY year DESC");
    // Attach actual amounts from electricity_bill_imports for each plan year
    for (const p of plans) {
      const bills = await all(
        `SELECT billing_month, total_amount FROM electricity_bill_imports
         WHERE billing_year = ? AND status != 'rejected'`, [p.year]
      );
      p.actuals = {};
      for (const b of bills) p.actuals[b.billing_month] = b.total_amount;
    }
    res.json(plans);
  } catch(e) { res.json([]); }
});

router.post("/el-budget", auth, requirePermission("finance_write"), async (req, res) => {
  const b = req.body;
  if (!b.year) return res.status(400).json({ error: "Жил заавал оруулна уу" });
  try {
    const r = await run(
      `INSERT INTO el_budget_plan(year,budget_code,name,m1,m2,m3,m4,m5,m6,m7,m8,m9,m10,m11,m12,created_by,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
       ON CONFLICT(year) DO UPDATE SET
         budget_code=excluded.budget_code, name=excluded.name,
         m1=excluded.m1,m2=excluded.m2,m3=excluded.m3,m4=excluded.m4,
         m5=excluded.m5,m6=excluded.m6,m7=excluded.m7,m8=excluded.m8,
         m9=excluded.m9,m10=excluded.m10,m11=excluded.m11,m12=excluded.m12,
         updated_at=CURRENT_TIMESTAMP`,
      [b.year, b.budget_code||"210301", b.name||"Гэрэл цахилгаан",
       b.m1||0,b.m2||0,b.m3||0,b.m4||0,b.m5||0,b.m6||0,
       b.m7||0,b.m8||0,b.m9||0,b.m10||0,b.m11||0,b.m12||0, req.user.id]
    );
    await audit(req.user.id, "UPSERT", "el_budget_plan", r.id, `${b.year} оны цахилгааны төлөвлөгөө`);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete("/el-budget/:id", auth, requirePermission("finance_write"), async (req, res) => {
  await run("DELETE FROM el_budget_plan WHERE id=?", [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
