const express = require("express");
const { run, all, get, auth } = require("../db");
const { requirePermission } = require("../middleware/roles");
const { reconcileIotLighting } = require("../services/iot_recovery");

const router = express.Router();

// ChirpStack HTTP integration дотор X-IOT-SECRET header тохируулна
function requireIotSecret(req, res, next) {
  const secret = process.env.IOT_WEBHOOK_SECRET;
  if (!secret) {
    console.warn("[IoT] IOT_WEBHOOK_SECRET not configured — webhook endpoint unprotected");
    return next();
  }
  const provided = req.headers["x-iot-secret"];
  if (!provided || provided !== secret) {
    console.warn(`[IoT] Invalid X-IOT-SECRET from ${req.ip}`);
    return res.status(401).json({ ok: false, error: "Invalid IoT webhook secret" });
  }
  next();
}

function normalizeDevEui(value) {
  return String(value || "").trim().toUpperCase();
}

function numberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function stateOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function firstValue(obj, keys) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null && obj[key] !== "") return obj[key];
  }
  return null;
}

function numberFirst(obj, keys) {
  return numberOrNull(firstValue(obj, keys));
}

function decodedObject(body) {
  return body.object || body.decodedData || body.objectJSON || {};
}

function jsonText(value) {
  try {
    return JSON.stringify(value ?? {});
  } catch (_) {
    return "{}";
  }
}

const MANUAL_OFF_REASONS = {
  maintenance: "Засвар",
  hazard: "Аюултай нөхцөл",
  temporary: "Түр унтраалт",
  other: "Бусад",
};

function normalizeManualOffReason(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const key = raw.toLowerCase();
  if (MANUAL_OFF_REASONS[key]) return key;
  const found = Object.entries(MANUAL_OFF_REASONS).find(([, label]) => label === raw);
  return found ? found[0] : "";
}

function mnLocalParts(date = new Date()) {
  const local = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth(),
    date: local.getUTCDate(),
    hour: local.getUTCHours(),
  };
}

function mnLocalUtc(year, month, day, hour = 0, minute = 0, second = 0) {
  return new Date(Date.UTC(year, month, day, hour - 8, minute, second));
}

function iotReportRange(period = "night") {
  const now = new Date();
  const p = String(period || "night").toLowerCase();
  const local = mnLocalParts(now);
  if (p === "today") {
    const from = mnLocalUtc(local.year, local.month, local.date, 0);
    const to = mnLocalUtc(local.year, local.month, local.date + 1, 0);
    return { period: p, label: "Өнөөдөр", from, to };
  }
  if (p === "7d" || p === "week") {
    return { period: "7d", label: "Сүүлийн 7 хоног", from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), to: now };
  }
  if (p === "month") {
    const from = mnLocalUtc(local.year, local.month, 1, 0);
    const to = mnLocalUtc(local.year, local.month + 1, 1, 0);
    return { period: p, label: "Энэ сар", from, to };
  }
  if (p === "year") {
    const from = mnLocalUtc(local.year, 0, 1, 0);
    const to = mnLocalUtc(local.year + 1, 0, 1, 0);
    return { period: p, label: "Энэ жил", from, to };
  }
  const from = mnLocalUtc(local.year, local.month, local.date - 1, 20);
  const to = mnLocalUtc(local.year, local.month, local.date, 6);
  return { period: "night", label: "Өнгөрсөн шөнө", from, to };
}

function isReadingOn(row) {
  const power = iotLatestNumber(row, ["totalP", "total_power", "power"]);
  const current = iotLatestNumber(row, ["Ia", "ia", "current"]);
  if (power !== null && power > 0.01) return true;
  if (current !== null && current > 0.02) return true;
  if (power !== null || current !== null) return false;
  const doState = String(row?.DO_State ?? row?.do_state ?? "").trim();
  if (doState === "1") return true;
  if (doState === "0") return false;
  return false;
}

function iotLatestNumber(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value === null || value === undefined || value === "") continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function iotHasLinePower(row) {
  const voltage = iotLatestNumber(row, ["Ua", "voltage", "V"]);
  return voltage !== null && voltage > 1;
}

function iotHasActiveLoad(row) {
  const power = iotLatestNumber(row, ["totalP", "power"]);
  const current = iotLatestNumber(row, ["Ia", "current", "A"]);
  if (power !== null && power > 0.01) return true;
  if (current !== null && current > 0.02) return true;
  if (power !== null || current !== null) return false;
  return null;
}

function iotRelayState(row) {
  const loadOn = iotHasActiveLoad(row);
  if (loadOn === true) return "on";
  if (loadOn === false) return "off";
  const doState = String(row?.DO_State ?? row?.do_state ?? "").trim();
  if (doState === "1") return "on";
  if (doState === "0") return "off";
  return "unknown";
}

function iotNodeHeard(row, minutes = 10) {
  if (!row?.last_seen) return false;
  const t = new Date(row.last_seen).getTime();
  return Number.isFinite(t) && Date.now() - t <= minutes * 60 * 1000;
}

function iotFaultKey(parts) {
  return parts.map(v => String(v ?? "").trim().replace(/\s+/g, "_")).join(":");
}

function iotTodayLocal() {
  const local = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

function operatorEvent(type, at, message, extra = {}) {
  return { type, at, message, ...extra };
}

function operatorEventSeverity(type) {
  if (["power_lost", "light_off_expected", "signal_gap"].includes(type)) return "warning";
  if (["auto_on_failed", "command_failed"].includes(type)) return "critical";
  if (["power_restored", "light_restored", "auto_on_sent", "auto_off_sent"].includes(type)) return "ok";
  return "info";
}

function classifyIotDeviceFault(row) {
  const heard = iotNodeHeard(row);
  const linePower = iotHasLinePower(row);
  const relay = iotRelayState(row);
  const hasMeasurement =
    iotLatestNumber(row, ["Ua", "voltage", "V", "Ia", "current", "A", "totalP", "power"]) !== null ||
    row?.DO_State !== null && row?.DO_State !== undefined;
  if (!heard) {
    return {
      code: "node_signal_lost",
      severity: "critical",
      label: "Node дохио тасарсан",
      operator_message: "Сүүлийн 10 минутанд ChirpStack uplink ERP-д ирээгүй. Төхөөрөмж, антен, gateway, ChirpStack HTTP integration шалгана.",
      active: true,
    };
  }
  if (!hasMeasurement) {
    return {
      code: "decoder_or_payload_missing",
      severity: "warning",
      label: "Хэмжилтийн decode дутуу",
      operator_message: "Node сонсогдож байгаа ч хүчдэл/гүйдэл/чадлын утга тайлагдаагүй байна. Decoder payload mapping шалгана.",
      active: true,
    };
  }
  if (!linePower) {
    return {
      code: "panel_no_line_power",
      severity: "warning",
      label: "Шит тэжээлгүй",
      operator_message: "ADW хэмжилтээр шит/оролтын талд хүчдэл харагдахгүй байна.",
      active: true,
    };
  }
  if (relay === "off") {
    return {
      code: "street_light_off",
      severity: "fault",
      label: "Гудамж асаагүй",
      operator_message: "Шит тэжээлтэй боловч гаралтын талд power/current хэрэглээ үүсээгүй байна. Гудамжны гэрэлтүүлгийн хэлхээг шалгана.",
      active: true,
    };
  }
  if (relay === "unknown") {
    return {
      code: "street_state_unknown",
      severity: "info",
      label: "Гудамжны төлөв баталгаажаагүй",
      operator_message: "Шит тэжээлтэй боловч гаралтын хэрэглээг батлах өгөгдөл хангалтгүй байна.",
      active: false,
    };
  }
  return {
    code: "ok",
    severity: "ok",
    label: "Хэвийн",
    operator_message: "Node сонсогдсон, шит тэжээлтэй, гудамжны гэрэлтүүлэг хэрэглээ авч байна.",
    active: false,
  };
}

async function buildIotDiagnostics() {
  const [devices, feedPoints, deviceLinks, feederCables, routes, poles] = await Promise.all([
    all(`${latestDeviceSelect()} ORDER BY datetime(l.received_at) DESC, l.device_name COLLATE NOCASE`),
    all("SELECT * FROM sl_feed_point ORDER BY id"),
    all("SELECT * FROM sl_feed_point_device ORDER BY feed_point_id, id"),
    all(`SELECT fc.*, fp.name feed_point_name, r.name segment_name, r.parent_route_id, r.pole_start, r.pole_end
           FROM sl_feeder_cable fc
           LEFT JOIN sl_feed_point fp ON fp.id=fc.feed_point_id
           LEFT JOIN sl_network_routes r ON r.id=fc.cable_segment_id
          ORDER BY fc.feed_point_id, fc.id`),
    all("SELECT id,name,parent_route_id,route_type,pole_start,pole_end,segment_status FROM sl_network_routes ORDER BY id"),
    all("SELECT id,route_id,pole_no,display_code,name,pole_type,status FROM sl_network_poles ORDER BY route_id,pole_no,id"),
  ]);

  const deviceByEui = new Map(devices.map(row => [normalizeDevEui(row.devEui || row.dev_eui), row]));
  const linksByFeedPoint = new Map();
  for (const link of deviceLinks) {
    const arr = linksByFeedPoint.get(Number(link.feed_point_id)) || [];
    arr.push(link);
    linksByFeedPoint.set(Number(link.feed_point_id), arr);
  }
  const feedersByFeedPoint = new Map();
  const feedersBySegment = new Map();
  for (const fc of feederCables) {
    const fpArr = feedersByFeedPoint.get(Number(fc.feed_point_id)) || [];
    fpArr.push(fc);
    feedersByFeedPoint.set(Number(fc.feed_point_id), fpArr);
    const segArr = feedersBySegment.get(Number(fc.cable_segment_id)) || [];
    segArr.push(fc);
    feedersBySegment.set(Number(fc.cable_segment_id), segArr);
  }

  const deviceDiagnostics = devices.map(row => {
    const devEui = normalizeDevEui(row.devEui || row.dev_eui);
    const link = deviceLinks.find(l => normalizeDevEui(l.dev_eui) === devEui && String(l.role || "controller") === "controller") || null;
    const feedPoint = link ? feedPoints.find(fp => Number(fp.id) === Number(link.feed_point_id)) || null : null;
    const segments = feedPoint ? (feedersByFeedPoint.get(Number(feedPoint.id)) || []) : [];
    const fault = classifyIotDeviceFault(row);
    return {
      devEui,
      deviceName: row.deviceName || row.device_name || devEui,
      deviceModel: row.deviceModel || row.device_model || null,
      last_seen: row.last_seen || null,
      heard: iotNodeHeard(row),
      line_power: iotHasLinePower(row),
      relay_state: iotRelayState(row),
      fault,
      feed_point: feedPoint ? { id: feedPoint.id, name: feedPoint.name, type: feedPoint.type } : null,
      segments: segments.map(s => ({
        id: s.cable_segment_id,
        name: s.segment_name,
        pole_start: s.pole_start,
        pole_end: s.pole_end,
      })),
    };
  });

  const topologyIssues = [];
  for (const fp of feedPoints) {
    const links = linksByFeedPoint.get(Number(fp.id)) || [];
    const controllerLinks = links.filter(l => String(l.role || "controller") === "controller");
    const feeders = feedersByFeedPoint.get(Number(fp.id)) || [];
    if (!controllerLinks.length) {
      topologyIssues.push({
        code: "feed_point_no_node",
        severity: "warning",
        feed_point_id: fp.id,
        feed_point_name: fp.name,
        message: "Тэжээлийн цэг дээр ADW node оноогдоогүй байна.",
      });
    }
    if (controllerLinks.length > 1) {
      topologyIssues.push({
        code: "feed_point_multiple_controllers",
        severity: "warning",
        feed_point_id: fp.id,
        feed_point_name: fp.name,
        message: "Нэг тэжээлийн цэг дээр controller role-той нэгээс олон node оноогдсон байна.",
      });
    }
    if (!feeders.length) {
      topologyIssues.push({
        code: "feed_point_no_feeder_cable",
        severity: "info",
        feed_point_id: fp.id,
        feed_point_name: fp.name,
        message: "Тэжээлийн цэг cable segment-тэй холбогдоогүй байна.",
      });
    }
    for (const link of links) {
      if (!deviceByEui.has(normalizeDevEui(link.dev_eui))) {
        topologyIssues.push({
          code: "assigned_node_no_uplink_history",
          severity: "warning",
          feed_point_id: fp.id,
          feed_point_name: fp.name,
          devEui: normalizeDevEui(link.dev_eui),
          message: "ERP дээр оноосон node-д хэмжилтийн түүх хараахан байхгүй байна.",
        });
      }
    }
  }

  const cableSegments = routes.filter(r => r.route_type === "cable");
  for (const segment of cableSegments) {
    const start = Number(segment.pole_start || 0);
    const end = Number(segment.pole_end || 0);
    const linkedFeeders = feedersBySegment.get(Number(segment.id)) || [];
    const rangePoles = poles.filter(p =>
      Number(p.route_id) === Number(segment.parent_route_id) &&
      Number(p.pole_no || 0) >= start &&
      Number(p.pole_no || 0) <= end &&
      String(p.pole_type || "pole") !== "feed"
    );
    if (!linkedFeeders.length) {
      topologyIssues.push({
        code: "segment_no_feed_point",
        severity: "info",
        segment_id: segment.id,
        segment_name: segment.name,
        pole_start: segment.pole_start,
        pole_end: segment.pole_end,
        message: "Cable segment тэжээлийн цэгтэй холбогдоогүй тул шонгууд автоматаар саарал харагдана.",
      });
    }
    if (!start || !end || start > end) {
      topologyIssues.push({
        code: "segment_invalid_pole_range",
        severity: "warning",
        segment_id: segment.id,
        segment_name: segment.name,
        message: "Cable segment-ийн pole_start/pole_end range буруу байна.",
      });
    } else if (!rangePoles.length) {
      topologyIssues.push({
        code: "segment_no_poles_in_range",
        severity: "warning",
        segment_id: segment.id,
        segment_name: segment.name,
        pole_start: segment.pole_start,
        pole_end: segment.pole_end,
        message: "Segment-ийн range дотор бүртгэлтэй шон олдсонгүй.",
      });
    }
  }

  const candidates = deviceDiagnostics
    .filter(d => d.fault.active && ["node_signal_lost", "decoder_or_payload_missing", "panel_no_line_power", "street_light_off"].includes(d.fault.code))
    .map(d => {
      const location = d.feed_point?.name || d.segments[0]?.name || d.deviceName;
      const key = iotFaultKey(["iot", d.fault.code, d.devEui, d.feed_point?.id || "no_fp"]);
      return {
        key,
        devEui: d.devEui,
        title: `[IoT] ${d.fault.label} - ${location}`,
        category: "Гэрэлтүүлэг засвар",
        sl_sub_category: "other",
        department: "Ерөнхий инженерийн алба",
        location,
        description: `${d.fault.operator_message}\nNode: ${d.deviceName} (${d.devEui})\nШит тэжээлтэй: ${d.line_power ? "тийм" : "үгүй"}\nГудамжны төлөв: ${d.relay_state}\nСүүлд сонсогдсон: ${d.last_seen || "-"}`,
        severity: d.fault.severity,
      };
    });

  return {
    generated_at: new Date().toISOString(),
    online_window_minutes: 10,
    devices: deviceDiagnostics,
    topology: {
      feed_points: feedPoints.length,
      feeder_cables: feederCables.length,
      cable_segments: cableSegments.length,
      poles: poles.filter(p => String(p.pole_type || "pole") !== "feed").length,
      issues: topologyIssues,
    },
    summary: {
      total_nodes: deviceDiagnostics.length,
      heard_nodes: deviceDiagnostics.filter(d => d.heard).length,
      line_power_on: deviceDiagnostics.filter(d => d.line_power).length,
      street_on: deviceDiagnostics.filter(d => d.relay_state === "on").length,
      active_faults: deviceDiagnostics.filter(d => d.fault.active).length,
      topology_issues: topologyIssues.length,
    },
    work_order_candidates: candidates,
  };
}

async function createIotDraftWorkOrders({ userId }) {
  const diag = await buildIotDiagnostics();
  const created = [];
  const skipped = [];
  const today = iotTodayLocal();
  for (const item of diag.work_order_candidates) {
    const marker = `IOT_FAULT_KEY:${item.key}`;
    const existing = await get(
      `SELECT id,title,status FROM asset_events
        WHERE category='Гэрэлтүүлэг засвар'
          AND COALESCE(sl_sub_category,'')='other'
          AND status NOT IN ('Дууссан','Цуцлагдсан','Цуцалсан','Хаагдсан')
          AND material_note LIKE ?
        ORDER BY id DESC LIMIT 1`,
      [`%${marker}%`]
    );
    if (existing) {
      skipped.push({ key: item.key, existing_id: existing.id, title: existing.title, reason: "duplicate_open_work_order" });
      continue;
    }
    const r = await run(
      `INSERT INTO asset_events(title,category,department,location,description,status,progress,
        assigned_to,created_by,work_date,start_date,end_date,cost_amount,material_note,sl_sub_category)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        item.title,
        item.category,
        item.department,
        item.location,
        item.description,
        "Хүлээгдэж байгаа",
        0,
        null,
        userId,
        today,
        today,
        today,
        0,
        `${marker}\nsource=iot_diagnostics\nseverity=${item.severity}`,
        item.sl_sub_category,
      ]
    );
    created.push({ key: item.key, id: r.id, title: item.title });
  }
  return { generated_at: diag.generated_at, created, skipped, candidates: diag.work_order_candidates.length };
}

function round(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(digits));
}

function localDateKeyFromIso(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const local = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}-${String(local.getUTCDate()).padStart(2, "0")}`;
}

function localMinutesFromIso(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const local = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

function minutesFromTime(value) {
  const m = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

const CHOIBALSAN_LAT = 48.0714;
const CHOIBALSAN_LNG = 114.5357;
const MN_UTC_OFFSET = 8;

function sunCrossingTimes(year, month1, day, angleDeg) {
  const toR = d => d * Math.PI / 180;
  const toD = r => r * 180 / Math.PI;
  const date = new Date(Date.UTC(year, month1 - 1, day));
  const dayOfYear = Math.round((date - new Date(Date.UTC(year, 0, 1))) / 86400000) + 1;
  const gamma = 2 * Math.PI / 365 * (dayOfYear - 1);
  const eot = 229.18 * (
    0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma)
  );
  const decl =
    0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
  const lat = toR(CHOIBALSAN_LAT);
  const zenith = toR(90 - angleDeg);
  const cosH = (Math.cos(zenith) / (Math.cos(lat) * Math.cos(decl)))
             - Math.tan(lat) * Math.tan(decl);
  if (Math.abs(cosH) > 1) return null;
  const halfDayMinutes = toD(Math.acos(cosH)) * 4;
  const solarNoonMinutes = 720 - 4 * CHOIBALSAN_LNG - eot + MN_UTC_OFFSET * 60;
  return {
    evening: solarNoonMinutes + halfDayMinutes,
    morning: solarNoonMinutes - halfDayMinutes,
  };
}

function suitableOnMinutes(dateKey) {
  const m = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const sunset = sunCrossingTimes(year, month, day, -0.833);
  const civil = sunCrossingTimes(year, month, day, -6);
  if (!sunset || !civil) return null;
  return Math.round((sunset.evening + civil.evening) / 2);
}

function timeFromMinutes(minutes) {
  if (minutes === null || minutes === undefined || !Number.isFinite(Number(minutes))) return null;
  const t = Math.round((((Number(minutes) % 1440) + 1440) % 1440));
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

function scheduledOnAt(log, iso) {
  if (!log) return null;
  if (Number(log.is_always_off || 0)) return false;
  const dateKey = localDateKeyFromIso(iso);
  const on = suitableOnMinutes(dateKey) ?? minutesFromTime(log.on_time);
  const off = minutesFromTime(log.off_time);
  const cur = localMinutesFromIso(iso);
  if (on === null || off === null || cur === null) return null;
  if (off <= on) return cur >= on || cur < off;
  return cur >= on && cur < off;
}

function activeScheduleFor(logs, category, dateKey) {
  return logs.find(l => l.category === category && String(l.valid_from || "") <= dateKey) || null;
}

function boolEnv(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function normalizeHex(value) {
  return String(value || "").replace(/\s+/g, "").toLowerCase();
}

const ADW300_DO1_ON_HEX = "4D6F646275733A30303130303143323030303130323030303136413232";
const ADW300_DO1_OFF_HEX = "4D6F646275733A30303130303143323030303130323030303041424532";

const IOT_NODE_CONFIG = {
  "00956906000AA9F1": { category: "Авто замын гэрэл", lampCount: 20, wattageW: 100 },
  "00956906000AE4EA": { category: "Гэр хорооллын гэрэл", lampCount: 20, wattageW: 100 },
};

function detectDeviceModel({ devEui, deviceName }) {
  const eui = normalizeDevEui(devEui);
  const name = String(deviceName || "").toLowerCase();
  if (eui === "00956906000AE4EA" || /\b(node|nod)\s*2\b/.test(name) || name.includes("dornod nod 2")) {
    return "ADW300";
  }
  if (eui === "00956906000AA9F1" || /\b(node|nod)\s*1\b/.test(name) || name.includes("dornod nod 1")) {
    return "ADW310";
  }
  return "ADW310";
}

function downlinkPayloadHex(action, model = "ADW310") {
  if (model === "ADW300") {
    if (action === "ON") return normalizeHex(ADW300_DO1_ON_HEX);
    if (action === "OFF") return normalizeHex(ADW300_DO1_OFF_HEX);
  }
  if (action === "ON") return normalizeHex(process.env.IOT_DOWNLINK_ON_HEX);
  if (action === "OFF") return normalizeHex(process.env.IOT_DOWNLINK_OFF_HEX);
  return "";
}

function validateDownlinkRequest({ devEui, action, model }) {
  const apiUrl = String(process.env.CHIRPSTACK_API_URL || "").replace(/\/+$/, "");
  const token = process.env.CHIRPSTACK_API_TOKEN;
  const payloadHex = downlinkPayloadHex(action, model);
  const fPort = Number(process.env.IOT_DOWNLINK_FPORT);
  const confirmed = boolEnv(process.env.IOT_DOWNLINK_CONFIRMED, true);

  if (!devEui) throw new Error("devEui is required");
  if (!["ON", "OFF"].includes(action)) throw new Error("action must be ON or OFF");
  if (!["ADW300", "ADW310"].includes(model)) throw new Error("Unsupported IoT device model");
  if (!apiUrl) throw new Error("CHIRPSTACK_API_URL is not configured");
  if (!token) throw new Error("CHIRPSTACK_API_TOKEN is not configured");
  if (!payloadHex) throw new Error(`${model} ${action} payload is not configured`);
  if (payloadHex.length % 2 !== 0) throw new Error(`IOT_DOWNLINK_${action}_HEX must have even length`);
  if (!/^[0-9a-f]+$/i.test(payloadHex)) throw new Error(`IOT_DOWNLINK_${action}_HEX must contain only hex characters`);
  if (!Number.isInteger(fPort) || fPort < 1 || fPort > 223) {
    throw new Error("IOT_DOWNLINK_FPORT must be an integer between 1 and 223");
  }

  return { apiUrl, token, payloadHex, fPort, confirmed, model };
}

async function enqueueChirpStackDownlink({ devEui, action, model }) {
  const { apiUrl, token, payloadHex, fPort, confirmed } = validateDownlinkRequest({ devEui, action, model });
  const data = Buffer.from(payloadHex, "hex").toString("base64");
  const body = { queueItem: { confirmed, fPort, data } };

  const response = await fetch(`${apiUrl}/api/devices/${encodeURIComponent(devEui)}/queue`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch (_) {}
  if (!response.ok) {
    throw new Error(parsed?.message || parsed?.error || text || `ChirpStack downlink failed (${response.status})`);
  }

  return {
    statusCode: response.status,
    chirpstackQueueResult: parsed || text || {},
    fPort,
    confirmed,
    payloadHex,
    model,
  };
}

function latestDeviceSelect(whereClause = "") {
  return `
    WITH latest AS (
      SELECT r.*
      FROM iot_meter_readings r
      JOIN (
        SELECT dev_eui, MAX(id) AS max_id
        FROM iot_meter_readings
        ${whereClause}
        GROUP BY dev_eui
      ) x ON x.max_id = r.id
    ),
    latest_command AS (
      SELECT c.*
      FROM iot_device_commands c
      JOIN (
        SELECT dev_eui, MAX(id) AS max_id
        FROM iot_device_commands
        WHERE status IN ('queued','txack_received','ack_received','uplink_received','ack_failed','failed')
        GROUP BY dev_eui
      ) x ON x.max_id = c.id
    )
    SELECT
      l.id,
      l.dev_eui AS devEui,
      l.device_name AS deviceName,
      l.application_name AS applicationName,
      CASE
        WHEN UPPER(l.dev_eui)='00956906000AE4EA' OR LOWER(COALESCE(l.device_name,'')) LIKE '%nod 2%' OR LOWER(COALESCE(l.device_name,'')) LIKE '%node 2%' THEN 'ADW300'
        ELSE 'ADW310'
      END AS deviceModel,
      (SELECT voltage FROM iot_meter_readings m WHERE m.dev_eui=l.dev_eui AND m.voltage IS NOT NULL ORDER BY m.id DESC LIMIT 1) AS voltage,
      (SELECT current FROM iot_meter_readings m WHERE m.dev_eui=l.dev_eui AND m.current IS NOT NULL ORDER BY m.id DESC LIMIT 1) AS current,
      (SELECT voltage FROM iot_meter_readings m WHERE m.dev_eui=l.dev_eui AND m.voltage IS NOT NULL ORDER BY m.id DESC LIMIT 1) AS V,
      (SELECT current FROM iot_meter_readings m WHERE m.dev_eui=l.dev_eui AND m.current IS NOT NULL ORDER BY m.id DESC LIMIT 1) AS A,
      (SELECT power FROM iot_meter_readings m WHERE m.dev_eui=l.dev_eui AND m.power IS NOT NULL ORDER BY m.id DESC LIMIT 1) AS power,
      (SELECT energy FROM iot_meter_readings m WHERE m.dev_eui=l.dev_eui AND m.energy IS NOT NULL ORDER BY m.id DESC LIMIT 1) AS energy,
      (SELECT frequency FROM iot_meter_readings m WHERE m.dev_eui=l.dev_eui AND m.frequency IS NOT NULL ORDER BY m.id DESC LIMIT 1) AS frequency,
      (SELECT power_factor FROM iot_meter_readings m WHERE m.dev_eui=l.dev_eui AND m.power_factor IS NOT NULL ORDER BY m.id DESC LIMIT 1) AS power_factor,
      (SELECT ua FROM iot_meter_readings m WHERE m.dev_eui=l.dev_eui AND m.ua IS NOT NULL ORDER BY m.id DESC LIMIT 1) AS Ua,
      (SELECT ub FROM iot_meter_readings m WHERE m.dev_eui=l.dev_eui AND m.ub IS NOT NULL ORDER BY m.id DESC LIMIT 1) AS Ub,
      (SELECT uc FROM iot_meter_readings m WHERE m.dev_eui=l.dev_eui AND m.uc IS NOT NULL ORDER BY m.id DESC LIMIT 1) AS Uc,
      (SELECT ia FROM iot_meter_readings m WHERE m.dev_eui=l.dev_eui AND m.ia IS NOT NULL ORDER BY m.id DESC LIMIT 1) AS Ia,
      (SELECT ib FROM iot_meter_readings m WHERE m.dev_eui=l.dev_eui AND m.ib IS NOT NULL ORDER BY m.id DESC LIMIT 1) AS Ib,
      (SELECT ic FROM iot_meter_readings m WHERE m.dev_eui=l.dev_eui AND m.ic IS NOT NULL ORDER BY m.id DESC LIMIT 1) AS Ic,
      (SELECT total_power FROM iot_meter_readings m WHERE m.dev_eui=l.dev_eui AND m.total_power IS NOT NULL ORDER BY m.id DESC LIMIT 1) AS totalP,
      (SELECT ep FROM iot_meter_readings m WHERE m.dev_eui=l.dev_eui AND m.ep IS NOT NULL ORDER BY m.id DESC LIMIT 1) AS EP,
      (SELECT pf FROM iot_meter_readings m WHERE m.dev_eui=l.dev_eui AND m.pf IS NOT NULL ORDER BY m.id DESC LIMIT 1) AS Pf,
      (SELECT do_state FROM iot_meter_readings m WHERE m.dev_eui=l.dev_eui AND m.do_state IS NOT NULL ORDER BY m.id DESC LIMIT 1) AS DO_State,
      (SELECT di_state FROM iot_meter_readings m WHERE m.dev_eui=l.dev_eui AND m.di_state IS NOT NULL ORDER BY m.id DESC LIMIT 1) AS DI_State,
      (SELECT rssi FROM iot_meter_readings m WHERE m.dev_eui=l.dev_eui AND m.rssi IS NOT NULL ORDER BY m.id DESC LIMIT 1) AS rssi,
      (SELECT snr FROM iot_meter_readings m WHERE m.dev_eui=l.dev_eui AND m.snr IS NOT NULL ORDER BY m.id DESC LIMIT 1) AS snr,
      (SELECT gateway_id FROM iot_meter_readings m WHERE m.dev_eui=l.dev_eui AND m.gateway_id IS NOT NULL ORDER BY m.id DESC LIMIT 1) AS gatewayId,
      l.raw_payload AS rawPayload,
      l.received_at AS last_seen,
      l.created_at,
      c.id AS command_id,
      c.device_model AS command_device_model,
      c.action AS command_action,
      c.status AS command_status,
      c.requested_at AS command_requested_at,
      c.f_port AS command_f_port,
      c.payload_hex AS command_payload_hex,
      COALESCE(s.auto_mode, 1) AS autoMode,
      s.updated_at AS autoModeUpdatedAt,
      s.manual_off_reason AS manualOffReason,
      s.manual_off_note AS manualOffNote,
      s.manual_off_by AS manualOffBy,
      s.manual_off_at AS manualOffAt,
      COALESCE(s.maintenance_mode, 0) AS maintenanceMode,
      s.maintenance_reason AS maintenanceReason,
      s.maintenance_by AS maintenanceBy,
      s.maintenance_at AS maintenanceAt,
      s.manual_lat AS manualLat,
      s.manual_lng AS manualLng,
      s.manual_location_by AS manualLocationBy,
      s.manual_location_at AS manualLocationAt,
      u.full_name AS manualOffOperatorName,
      u.username AS manualOffOperatorUsername,
      mu.full_name AS maintenanceOperatorName,
      mu.username AS maintenanceOperatorUsername,
      CASE
        WHEN c.id IS NULL THEN NULL
        WHEN c.status='ack_failed' THEN 'ack_failed'
        WHEN c.status='failed' THEN 'failed'
        WHEN EXISTS (
          SELECT 1 FROM iot_meter_readings m
          WHERE m.dev_eui=l.dev_eui
            AND datetime(m.received_at) >= datetime(c.requested_at)
            AND (m.power IS NOT NULL OR m.current IS NOT NULL OR m.do_state IS NOT NULL)
            AND (
              (c.action='ON' AND (
                COALESCE(m.power, 0) > 0.01
                OR COALESCE(m.current, 0) > 0.02
                OR (m.power IS NULL AND m.current IS NULL AND TRIM(COALESCE(m.do_state, ''))='1')
              ))
              OR
              (c.action='OFF' AND (
                ((m.power IS NOT NULL OR m.current IS NOT NULL) AND COALESCE(m.power, 0) <= 0.01 AND COALESCE(m.current, 0) <= 0.02)
                OR (m.power IS NULL AND m.current IS NULL AND TRIM(COALESCE(m.do_state, ''))='0')
              ))
            )
        ) THEN LOWER(c.action) || '_confirmed'
        WHEN EXISTS (
          SELECT 1 FROM iot_meter_readings m
          WHERE m.dev_eui=l.dev_eui
            AND datetime(m.received_at) >= datetime(c.requested_at)
        ) THEN 'uplink_received'
        WHEN c.status='ack_received' THEN 'ack_received'
        WHEN c.status='txack_received' THEN 'txack_received'
        WHEN c.status='queued' THEN 'queued'
        WHEN (
          SELECT COUNT(*) FROM iot_meter_readings m
          WHERE m.dev_eui=l.dev_eui
            AND datetime(m.received_at) >= datetime(c.requested_at)
            AND (m.power IS NOT NULL OR m.current IS NOT NULL OR m.do_state IS NOT NULL)
        ) >= 2 THEN 'sent_not_confirmed'
        ELSE 'pending_confirmation'
      END AS command_confirmation_status,
      (
        SELECT COUNT(*) FROM iot_meter_readings m
        WHERE m.dev_eui=l.dev_eui
          AND datetime(m.received_at) >= datetime(c.requested_at)
          AND (m.power IS NOT NULL OR m.current IS NOT NULL OR m.do_state IS NOT NULL)
      ) AS command_uplinks_seen
    FROM latest l
    LEFT JOIN latest_command c ON c.dev_eui=l.dev_eui
    LEFT JOIN iot_device_settings s ON s.dev_eui=l.dev_eui
    LEFT JOIN users u ON u.id=s.manual_off_by
    LEFT JOIN users mu ON mu.id=s.maintenance_by
  `;
}

router.post("/iot/chirpstack/uplink", requireIotSecret, async (req, res) => {
  const body = req.body || {};
  const obj = decodedObject(body);
  const deviceInfo = body.deviceInfo || {};
  const rx0 = Array.isArray(body.rxInfo) ? (body.rxInfo[0] || {}) : {};

  const devEui = normalizeDevEui(deviceInfo.devEui);
  const deviceName = deviceInfo.deviceName || null;
  const applicationName = deviceInfo.applicationName || null;
  const rawPayload = jsonText(body);

  await run(
    `INSERT INTO iot_audit_logs(event_type,dev_eui,payload,source)
     VALUES(?,?,?,?)`,
    ["chirpstack_uplink", devEui || null, rawPayload, "chirpstack_http_integration"]
  );

  if (!devEui) {
    return res.status(400).json({ ok: false, error: "deviceInfo.devEui missing" });
  }

  const receivedAt = new Date().toISOString();
  const ua = numberFirst(obj, ["Ua", "UA", "uA", "voltage_a", "voltageA", "U_A"]);
  const ub = numberFirst(obj, ["Ub", "UB", "uB", "voltage_b", "voltageB", "U_B"]);
  const uc = numberFirst(obj, ["Uc", "UC", "uC", "voltage_c", "voltageC", "U_C"]);
  const ia = numberFirst(obj, ["Ia", "IA", "iA", "current_a", "currentA", "I_A"]);
  const ib = numberFirst(obj, ["Ib", "IB", "iB", "current_b", "currentB", "I_B"]);
  const ic = numberFirst(obj, ["Ic", "IC", "iC", "current_c", "currentC", "I_C"]);
  const totalPower = numberFirst(obj, ["totalP", "TotalP", "total_power", "totalPower", "P", "p", "power", "Power", "kW", "active_power", "activePower"]);
  const ep = numberFirst(obj, ["EP", "Ep", "ep", "energy", "Energy", "kWh", "total_energy", "totalEnergy", "EQ_F1", "EQF1", "eq_f1"]);
  const pf = numberFirst(obj, ["Pf", "PF", "pf", "power_factor", "powerFactor", "PowerFactor"]);
  const reading = {
    voltage: numberFirst(obj, ["voltage", "Voltage", "V", "U", "u"]) ?? ua,
    current: numberFirst(obj, ["current", "Current", "A", "I", "i"]) ?? ia,
    power: totalPower,
    energy: ep,
    frequency: numberFirst(obj, ["frequency", "Frequency", "Hz", "F", "f"]),
    power_factor: pf,
    ua,
    ub,
    uc,
    ia,
    ib,
    ic,
    total_power: totalPower,
    ep,
    pf,
    do_state: stateOrNull(firstValue(obj, ["DO_State", "do_state", "DO", "do", "relay", "relayState"])),
    di_state: stateOrNull(firstValue(obj, ["DI_State", "di_state", "DI", "di"])),
    rssi: numberOrNull(rx0.rssi),
    snr: numberOrNull(rx0.snr),
    gateway_id: rx0.gatewayId || null,
  };

  const result = await run(
    `INSERT INTO iot_meter_readings(
       dev_eui,device_name,application_name,
       voltage,current,power,energy,frequency,power_factor,
       ua,ub,uc,ia,ib,ic,total_power,ep,pf,
       do_state,di_state,rssi,snr,gateway_id,raw_payload,received_at
     )
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      devEui,
      deviceName,
      applicationName,
      reading.voltage,
      reading.current,
      reading.power,
      reading.energy,
      reading.frequency,
      reading.power_factor,
      reading.ua,
      reading.ub,
      reading.uc,
      reading.ia,
      reading.ib,
      reading.ic,
      reading.total_power,
      reading.ep,
      reading.pf,
      reading.do_state,
      reading.di_state,
      reading.rssi,
      reading.snr,
      reading.gateway_id,
      rawPayload,
      receivedAt,
    ]
  );

  const isCommandAck = body.queueItemId && Object.prototype.hasOwnProperty.call(body, "acknowledged");
  if (isCommandAck) {
    const acknowledged = body.acknowledged === true || body.acknowledged === 1 || body.acknowledged === "true";
    await run(
      `UPDATE iot_device_commands
       SET status=?, ack_response=?
       WHERE id=(
         SELECT id FROM iot_device_commands
         WHERE dev_eui=? AND status IN ('queued','txack_received','ack_received','uplink_received')
         ORDER BY datetime(requested_at) DESC, id DESC
         LIMIT 1
       )`,
      [acknowledged ? "ack_received" : "ack_failed", rawPayload, devEui]
    ).catch(() => {});
  } else {
    await run(
      `UPDATE iot_device_commands
       SET status='uplink_received'
       WHERE id=(
         SELECT id FROM iot_device_commands
         WHERE dev_eui=? AND status IN ('queued','txack_received','ack_received')
         ORDER BY datetime(requested_at) DESC, id DESC
         LIMIT 1
       )`,
      [devEui]
    ).catch(() => {});
  }

  res.json({ ok: true, id: result.id, devEui, received_at: receivedAt });
});

async function recordCommandEvent({ body, eventType, status, responseColumn }) {
  const deviceInfo = body.deviceInfo || {};
  const devEui = normalizeDevEui(deviceInfo.devEui || body.devEui || body.deviceName);
  if (!devEui) return { ok: false, error: "deviceInfo.devEui missing" };
  const command = await get(
    `SELECT c.*, r.device_name
     FROM iot_device_commands c
     LEFT JOIN (
       SELECT dev_eui, device_name, MAX(id) AS max_reading_id
       FROM iot_meter_readings
       GROUP BY dev_eui
     ) r ON r.dev_eui=c.dev_eui
     WHERE c.dev_eui=? AND c.status IN ('queued','txack_received','ack_received','uplink_received','ack_failed','failed')
     ORDER BY datetime(c.requested_at) DESC, c.id DESC
     LIMIT 1`,
    [devEui]
  );
  const auditPayload = {
    devEui,
    deviceName: command?.device_name || deviceInfo.deviceName || null,
    model: command?.device_model || detectDeviceModel({ devEui, deviceName: command?.device_name || deviceInfo.deviceName }),
    action: command?.action || null,
    fPort: command?.f_port || null,
    payloadHex: command?.payload_hex || null,
    user: command?.requested_by || null,
    timestamp: new Date().toISOString(),
    txackResult: eventType === "chirpstack_txack" ? body : null,
    ackResult: eventType === "chirpstack_ack" ? body : null,
  };
  const payload = jsonText(auditPayload);
  await run(
    `INSERT INTO iot_audit_logs(event_type,dev_eui,payload,source)
     VALUES(?,?,?,?)`,
    [eventType, devEui, payload, "chirpstack_http_integration"]
  );
  const column = responseColumn === "ack_response" ? "ack_response" : "txack_response";
  await run(
    `UPDATE iot_device_commands
     SET status=?, ${column}=?
     WHERE id=(
       SELECT id FROM iot_device_commands
      WHERE dev_eui=? AND status IN ('queued','txack_received','ack_received','uplink_received','ack_failed','failed')
       ORDER BY datetime(requested_at) DESC, id DESC
       LIMIT 1
     )`,
    [status, payload, devEui]
  );
  return { ok: true, devEui, status };
}

router.post("/iot/chirpstack/txack", requireIotSecret, async (req, res) => {
  const result = await recordCommandEvent({
    body: req.body || {},
    eventType: "chirpstack_txack",
    status: "txack_received",
    responseColumn: "txack_response",
  });
  res.status(result.ok ? 200 : 400).json(result);
});

router.post("/iot/chirpstack/ack", requireIotSecret, async (req, res) => {
  const result = await recordCommandEvent({
    body: req.body || {},
    eventType: "chirpstack_ack",
    status: "ack_received",
    responseColumn: "ack_response",
  });
  res.status(result.ok ? 200 : 400).json(result);
});

router.get("/iot/devices/:devEui/latest", auth, async (req, res) => {
  const devEui = normalizeDevEui(req.params.devEui);
  const row = await get(
    `${latestDeviceSelect("WHERE dev_eui=?")}
     LIMIT 1`,
    [devEui]
  );
  if (!row) return res.status(404).json({ error: "Device reading not found" });
  res.json(row);
});

router.get("/iot/devices", auth, async (_req, res) => {
  const rows = await all(`
    ${latestDeviceSelect()}
    ORDER BY datetime(l.received_at) DESC, l.device_name COLLATE NOCASE
  `);
  res.json(rows);
});

router.get("/iot/schedule-info", auth, async (_req, res) => {
  const now = new Date();
  const dateKey = localDateKeyFromIso(now.toISOString());
  const curMinutes = localMinutesFromIso(now.toISOString());
  const logs = await all(
    `SELECT category, on_time, off_time, is_always_off
       FROM light_schedule_logs
      WHERE valid_from <= ?
      ORDER BY category, valid_from DESC, id DESC`,
    [dateKey]
  );
  const seen = new Set();
  const latestPerCategory = logs.filter(l => {
    if (seen.has(l.category)) return false;
    seen.add(l.category);
    return true;
  });
  const solarOnMins = suitableOnMinutes(dateKey);
  const solarOn = timeFromMinutes(solarOnMins);
  function desiredAction(log) {
    if (!log || Number(log.is_always_off || 0)) return "OFF";
    const on = solarOnMins ?? minutesFromTime(log.on_time);
    const off = minutesFromTime(log.off_time);
    if (on === null || off === null || curMinutes === null) return null;
    const isOnWindow = off <= on ? (curMinutes >= on || curMinutes < off) : (curMinutes >= on && curMinutes < off);
    return isOnWindow ? "ON" : "OFF";
  }
  const result = Object.entries(IOT_NODE_CONFIG).map(([devEui, cfg]) => {
    const log = latestPerCategory.find(l => l.category === cfg.category) || null;
    return {
      devEui,
      category: cfg.category,
      on_time: solarOn || log?.on_time || null,
      off_time: log?.off_time || null,
      is_always_off: Number(log?.is_always_off || 0),
      scheduled_action: desiredAction(log),
    };
  });
  res.json(result);
});

router.post("/iot/devices/:devEui/location", auth, requirePermission("lighting_edit"), async (req, res) => {
  const devEui = normalizeDevEui(req.params.devEui);
  const lat = Number(req.body?.lat ?? req.body?.gps_lat);
  const lng = Number(req.body?.lng ?? req.body?.gps_lng ?? req.body?.lon);
  if (!devEui) return res.status(400).json({ error: "devEui is required" });
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: "lat/lng must be numbers" });
  }
  if (lat < 47 || lat > 49.5 || lng < 113 || lng > 116.5) {
    return res.status(400).json({ error: "Location is outside Choibalsan area" });
  }
  const latest = await get(
    `SELECT dev_eui, device_name FROM iot_meter_readings WHERE dev_eui=? ORDER BY datetime(received_at) DESC, id DESC LIMIT 1`,
    [devEui]
  );
  if (!latest) return res.status(404).json({ error: "Device not found" });

  await run(
    `INSERT INTO iot_device_settings(dev_eui,updated_by,updated_at,manual_lat,manual_lng,manual_location_by,manual_location_at)
     VALUES(?,?,CURRENT_TIMESTAMP,?,?,?,CURRENT_TIMESTAMP)
     ON CONFLICT(dev_eui) DO UPDATE SET
       updated_by=excluded.updated_by,
       updated_at=CURRENT_TIMESTAMP,
       manual_lat=excluded.manual_lat,
       manual_lng=excluded.manual_lng,
       manual_location_by=excluded.manual_location_by,
       manual_location_at=CURRENT_TIMESTAMP`,
    [devEui, req.user?.id || null, lat, lng, req.user?.id || null]
  );
  await run(
    `INSERT INTO iot_audit_logs(event_type,dev_eui,payload,source)
     VALUES(?,?,?,?)`,
    ["iot_manual_location_changed", devEui, jsonText({
      devEui,
      deviceName: latest.device_name || null,
      lat,
      lng,
      user: req.user?.id || null,
      role: req.user?.role || null,
      timestamp: new Date().toISOString(),
    }), "erp_backend"]
  );
  res.json({ ok: true, devEui, deviceName: latest.device_name || null, manualLat: lat, manualLng: lng });
});

router.get("/iot/diagnostics", auth, async (_req, res) => {
  try {
    res.json(await buildIotDiagnostics());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/iot/diagnostics/draft-work-orders", auth, requirePermission("operations_write"), async (req, res) => {
  try {
    res.json(await createIotDraftWorkOrders({ userId: req.user.id }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/iot/report", auth, async (req, res) => {
  const range = iotReportRange(req.query.period);
  const fromIso = range.from.toISOString();
  const toIso = range.to.toISOString();
  const readings = await all(
    `SELECT id,dev_eui,device_name,received_at,voltage,current,power,energy,frequency,power_factor,
            ua,ub,uc,ia,ib,ic,total_power,ep,pf,do_state,di_state,rssi,snr
       FROM iot_meter_readings
      WHERE datetime(received_at) >= datetime(?) AND datetime(received_at) < datetime(?)
      ORDER BY dev_eui, datetime(received_at), id`,
    [fromIso, toIso]
  );
  const commands = await all(
    `SELECT dev_eui,device_model,action,status,f_port,payload_hex,requested_by,requested_by_role,requested_at
       FROM iot_device_commands
      WHERE datetime(requested_at) >= datetime(?) AND datetime(requested_at) < datetime(?)
      ORDER BY datetime(requested_at), id`,
    [fromIso, toIso]
  );
  const scheduleLogs = await all(
    `SELECT category,valid_from,on_time,off_time,is_always_off
       FROM light_schedule_logs
      ORDER BY category, valid_from DESC, id DESC`
  );

  const byDev = new Map();
  for (const row of readings) {
    const key = normalizeDevEui(row.dev_eui);
    if (!byDev.has(key)) byDev.set(key, []);
    byDev.get(key).push(row);
  }

  const summaries = [...byDev.entries()].map(([devEui, rows]) => {
    const first = rows[0] || {};
    const last = rows[rows.length - 1] || {};
    const config = IOT_NODE_CONFIG[devEui] || { category: "", lampCount: null, wattageW: null };
    const capacityKw = Number(config.lampCount || 0) * Number(config.wattageW || 0) / 1000;
    const onSamples = rows.filter(isReadingOn).length;
    const values = field => rows.map(r => Number(r[field])).filter(Number.isFinite);
    const minOf = field => {
      const vals = values(field);
      return vals.length ? Math.min(...vals) : null;
    };
    const maxOf = field => {
      const vals = values(field);
      return vals.length ? Math.max(...vals) : null;
    };
    const avgOf = field => {
      const vals = values(field);
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    let offlineGaps = 0;
    let maxGapMinutes = 0;
    let prevTime = null;
    let prevOn = null;
    let scheduleKnownSamples = 0;
    let scheduleOnSamples = 0;
    let scheduleMatchedSamples = 0;
    const transitions = [];
    const operatorEvents = [];
    let prevLinePower = null;
    for (const row of rows) {
      const t = new Date(row.received_at).getTime();
      if (prevTime) {
        const gap = (t - prevTime) / 60000;
        if (gap > 20) {
          offlineGaps += 1;
          operatorEvents.push(operatorEvent(
            "signal_gap",
            row.received_at,
            `Node дохио ${round(gap, 0)} минут тасарсан байж магадгүй`,
            { minutes: round(gap, 1) }
          ));
        }
        if (gap > maxGapMinutes) maxGapMinutes = gap;
      }
      const on = isReadingOn(row);
      const linePower = iotHasLinePower(row);
      const schedule = activeScheduleFor(scheduleLogs, config.category, localDateKeyFromIso(row.received_at));
      const expectedOn = scheduledOnAt(schedule, row.received_at);
      if (expectedOn !== null) {
        scheduleKnownSamples += 1;
        if (expectedOn) scheduleOnSamples += 1;
        if (expectedOn === on) scheduleMatchedSamples += 1;
      }
      if (prevLinePower !== null && prevLinePower !== linePower) {
        operatorEvents.push(operatorEvent(
          linePower ? "power_restored" : "power_lost",
          row.received_at,
          linePower ? "Шитний тэжээл сэргэсэн" : "Шитний тэжээл тасарсан",
          { voltage: round(row.voltage ?? row.ua, 1) }
        ));
      }
      if (expectedOn === true && prevOn !== null && prevOn !== on) {
        operatorEvents.push(operatorEvent(
          on ? "light_restored" : "light_off_expected",
          row.received_at,
          on ? "Асах ёстой үед гэрэл дахин ассан" : "Асах ёстой үед гэрэл унтарсан",
          { power: round(row.power ?? row.total_power, 3), current: round(row.current ?? row.ia, 2) }
        ));
      }
      if (prevOn !== null && prevOn !== on) {
        transitions.push({
          type: "relay_change",
          at: row.received_at,
          state: on ? "ON" : "OFF",
          power: round(row.power, 3),
          current: round(row.current, 2),
        });
      }
      prevTime = t;
      prevOn = on;
      prevLinePower = linePower;
    }
    const commandsForDevice = commands
      .filter(c => normalizeDevEui(c.dev_eui) === devEui)
      .map(c => ({
        type: "command",
        at: c.requested_at,
        action: c.action,
        status: c.status,
        model: c.device_model,
      }));
    for (const c of commands.filter(c => normalizeDevEui(c.dev_eui) === devEui)) {
      const role = String(c.requested_by_role || "");
      if (role === "system" && c.action === "ON") {
        operatorEvents.push(operatorEvent("auto_on_sent", c.requested_at, "ERP автоматаар ON command дахин илгээсэн", { status: c.status }));
      } else if (role === "system" && c.action === "OFF") {
        operatorEvents.push(operatorEvent("auto_off_sent", c.requested_at, "ERP schedule дагуу OFF command илгээсэн", { status: c.status }));
      } else if (c.action === "ON") {
        operatorEvents.push(operatorEvent("manual_on_sent", c.requested_at, "Оператор ON command илгээсэн", { status: c.status, role }));
      } else if (c.action === "OFF") {
        operatorEvents.push(operatorEvent("manual_off_sent", c.requested_at, "Оператор OFF command илгээсэн", { status: c.status, role }));
      }
    }
    const energyDelta = Number(last.energy) - Number(first.energy);
    const avgPowerKw = avgOf("power");
    const latestDateKey = localDateKeyFromIso(last.received_at || new Date().toISOString());
    const latestSchedule = activeScheduleFor(scheduleLogs, config.category, latestDateKey);
    const latestSuitableOnTime = timeFromMinutes(suitableOnMinutes(latestDateKey));
    const sortedOperatorEvents = operatorEvents
      .filter(e => e.at)
      .map(e => ({ ...e, severity: operatorEventSeverity(e.type) }))
      .sort((a, b) => String(a.at).localeCompare(String(b.at)));
    return {
      devEui,
      deviceName: last.device_name || first.device_name || devEui,
      model: detectDeviceModel({ devEui, deviceName: last.device_name || first.device_name }),
      samples: rows.length,
      onSamples,
      onPct: rows.length ? round((onSamples / rows.length) * 100, 1) : 0,
      avgPowerKw: round(avgPowerKw, 3),
      scheduleCategory: config.category || null,
      scheduleOnTime: latestSuitableOnTime || latestSchedule?.on_time || null,
      scheduleRegisteredOnTime: latestSchedule?.on_time || null,
      scheduleOnSource: latestSuitableOnTime ? "suitable_sunlight" : "registered",
      scheduleOffTime: latestSchedule?.off_time || null,
      expectedOnSamples: scheduleOnSamples,
      expectedOnPct: scheduleKnownSamples ? round((scheduleOnSamples / scheduleKnownSamples) * 100, 1) : null,
      scheduleMatchPct: scheduleKnownSamples ? round((scheduleMatchedSamples / scheduleKnownSamples) * 100, 1) : null,
      lampCount: config.lampCount || null,
      wattageW: config.wattageW || null,
      maxCapacityKw: capacityKw ? round(capacityKw, 3) : null,
      estimatedLitLamps: capacityKw && Number.isFinite(avgPowerKw) ? round(Math.min(config.lampCount, Math.max(0, avgPowerKw / (Number(config.wattageW) / 1000))), 1) : null,
      estimatedLitPct: capacityKw && Number.isFinite(avgPowerKw) ? round(Math.min(100, Math.max(0, avgPowerKw / capacityKw * 100)), 1) : null,
      minVoltage: round(minOf("voltage"), 1),
      maxVoltage: round(maxOf("voltage"), 1),
      minCurrent: round(minOf("current"), 2),
      maxCurrent: round(maxOf("current"), 2),
      minPowerKw: round(minOf("power"), 3),
      maxPowerKw: round(maxOf("power"), 3),
      energyStart: round(first.energy, 3),
      energyEnd: round(last.energy, 3),
      energyDeltaKwh: Number.isFinite(energyDelta) ? round(Math.max(0, energyDelta), 3) : null,
      firstSeen: first.received_at || null,
      lastSeen: last.received_at || null,
      offlineGaps,
      maxGapMinutes: round(maxGapMinutes, 1),
      operatorEvents: sortedOperatorEvents.slice(-30),
      events: [...commandsForDevice, ...transitions].sort((a, b) => String(a.at).localeCompare(String(b.at))).slice(-20),
    };
  });

  const totals = {
    devices: summaries.length,
    samples: summaries.reduce((sum, r) => sum + Number(r.samples || 0), 0),
    onPct: summaries.length ? round(summaries.reduce((sum, r) => sum + Number(r.onPct || 0), 0) / summaries.length, 1) : 0,
    energyDeltaKwh: round(summaries.reduce((sum, r) => sum + Number(r.energyDeltaKwh || 0), 0), 3),
    avgPowerKw: summaries.length ? round(summaries.reduce((sum, r) => sum + Number(r.avgPowerKw || 0), 0), 3) : 0,
    maxCapacityKw: round(summaries.reduce((sum, r) => sum + Number(r.maxCapacityKw || 0), 0), 3),
    estimatedLitLamps: round(summaries.reduce((sum, r) => sum + Number(r.estimatedLitLamps || 0), 0), 1),
    estimatedLitPct: summaries.reduce((sum, r) => sum + Number(r.maxCapacityKw || 0), 0)
      ? round((summaries.reduce((sum, r) => sum + Number(r.avgPowerKw || 0), 0) / summaries.reduce((sum, r) => sum + Number(r.maxCapacityKw || 0), 0)) * 100, 1)
      : null,
    scheduleMatchPct: summaries.filter(r => r.scheduleMatchPct !== null).length
      ? round(summaries.filter(r => r.scheduleMatchPct !== null).reduce((sum, r) => sum + Number(r.scheduleMatchPct || 0), 0) / summaries.filter(r => r.scheduleMatchPct !== null).length, 1)
      : null,
    offlineGaps: summaries.reduce((sum, r) => sum + Number(r.offlineGaps || 0), 0),
    commands: commands.length,
  };
  const operatorEvents = summaries
    .flatMap(d => (d.operatorEvents || []).map(e => ({
      ...e,
      devEui: d.devEui,
      deviceName: d.deviceName,
    })))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const operatorSummary = {
    events: operatorEvents,
    powerEvents: operatorEvents.filter(e => ["power_lost", "power_restored", "signal_gap"].includes(e.type)).length,
    autoCommands: operatorEvents.filter(e => ["auto_on_sent", "auto_off_sent"].includes(e.type)).length,
    lightProblems: operatorEvents.filter(e => e.type === "light_off_expected").length,
    recovered: operatorEvents.filter(e => e.type === "light_restored").length,
    critical: operatorEvents.filter(e => e.severity === "critical").length,
    warnings: operatorEvents.filter(e => e.severity === "warning").length,
  };

  res.json({
    period: range.period,
    label: range.label,
    timezone: "Asia/Ulaanbaatar",
    from: fromIso,
    to: toIso,
    totals,
    operatorSummary,
    devices: summaries.sort((a, b) => String(a.deviceName).localeCompare(String(b.deviceName))),
    commands: commands.slice(-50),
  });
});

router.get("/iot/timeseries", auth, async (req, res) => {
  const range = iotReportRange(req.query.period);
  const devEui = normalizeDevEui(req.query.devEui || "");
  const bucketMinutes = Math.max(1, Math.min(240, Number(req.query.bucket || 15)));
  const fromIso = range.from.toISOString();
  const toIso = range.to.toISOString();
  const params = [fromIso, toIso];
  let whereDev = "";
  if (devEui) {
    whereDev = " AND UPPER(dev_eui)=?";
    params.push(devEui);
  }
  const rows = await all(
    `SELECT id,dev_eui,device_name,received_at,voltage,current,power,energy,do_state
       FROM iot_meter_readings
      WHERE datetime(received_at) >= datetime(?) AND datetime(received_at) < datetime(?)
      ${whereDev}
      ORDER BY dev_eui, datetime(received_at), id`,
    params
  );
  const buckets = new Map();
  for (const row of rows) {
    const t = new Date(row.received_at).getTime();
    if (!Number.isFinite(t)) continue;
    const bucketStartMs = Math.floor(t / (bucketMinutes * 60000)) * bucketMinutes * 60000;
    const key = `${normalizeDevEui(row.dev_eui)}:${bucketStartMs}`;
    if (!buckets.has(key)) {
      buckets.set(key, {
        devEui: normalizeDevEui(row.dev_eui),
        deviceName: row.device_name || normalizeDevEui(row.dev_eui),
        bucketStart: new Date(bucketStartMs).toISOString(),
        samples: 0,
        onSamples: 0,
        powerSum: 0,
        voltageSum: 0,
        currentSum: 0,
        powerCount: 0,
        voltageCount: 0,
        currentCount: 0,
        firstEnergy: null,
        lastEnergy: null,
      });
    }
    const b = buckets.get(key);
    b.samples += 1;
    if (isReadingOn(row)) b.onSamples += 1;
    const power = Number(row.power);
    const voltage = Number(row.voltage);
    const current = Number(row.current);
    const energy = Number(row.energy);
    if (Number.isFinite(power)) { b.powerSum += power; b.powerCount += 1; }
    if (Number.isFinite(voltage)) { b.voltageSum += voltage; b.voltageCount += 1; }
    if (Number.isFinite(current)) { b.currentSum += current; b.currentCount += 1; }
    if (Number.isFinite(energy)) {
      if (b.firstEnergy === null) b.firstEnergy = energy;
      b.lastEnergy = energy;
    }
  }
  const series = [...buckets.values()].map(b => ({
    devEui: b.devEui,
    deviceName: b.deviceName,
    bucketStart: b.bucketStart,
    samples: b.samples,
    avgPowerKw: b.powerCount ? round(b.powerSum / b.powerCount, 3) : null,
    avgVoltage: b.voltageCount ? round(b.voltageSum / b.voltageCount, 1) : null,
    avgCurrent: b.currentCount ? round(b.currentSum / b.currentCount, 2) : null,
    onPct: b.samples ? round((b.onSamples / b.samples) * 100, 1) : 0,
    energyDeltaKwh: Number.isFinite(Number(b.lastEnergy) - Number(b.firstEnergy)) ? round(Math.max(0, Number(b.lastEnergy) - Number(b.firstEnergy)), 3) : null,
    energyKwh: b.lastEnergy,
  })).sort((a, b) => String(a.bucketStart).localeCompare(String(b.bucketStart)));
  res.json({
    period: range.period,
    label: range.label,
    timezone: "Asia/Ulaanbaatar",
    from: fromIso,
    to: toIso,
    bucketMinutes,
    devEui: devEui || null,
    series,
  });
});

router.post("/iot/devices/:devEui/auto-mode", auth, requirePermission("lighting_edit"), async (req, res) => {
  const devEui = normalizeDevEui(req.params.devEui);
  const autoMode = req.body?.autoMode === false || req.body?.autoMode === 0 || req.body?.autoMode === "0" ? 0 : 1;
  const latest = await get(
    `SELECT dev_eui, device_name FROM iot_meter_readings WHERE dev_eui=? ORDER BY datetime(received_at) DESC, id DESC LIMIT 1`,
    [devEui]
  );
  if (!latest) return res.status(404).json({ error: "Device not found" });

  await run(
    `INSERT INTO iot_device_settings(dev_eui,auto_mode,updated_by,updated_at)
     VALUES(?,?,?,CURRENT_TIMESTAMP)
     ON CONFLICT(dev_eui) DO UPDATE SET
       auto_mode=excluded.auto_mode,
       updated_by=excluded.updated_by,
       updated_at=CURRENT_TIMESTAMP,
       manual_off_reason=CASE WHEN excluded.auto_mode=1 THEN NULL ELSE manual_off_reason END,
       manual_off_note=CASE WHEN excluded.auto_mode=1 THEN NULL ELSE manual_off_note END,
       manual_off_by=CASE WHEN excluded.auto_mode=1 THEN NULL ELSE manual_off_by END,
       manual_off_at=CASE WHEN excluded.auto_mode=1 THEN NULL ELSE manual_off_at END,
       maintenance_mode=CASE WHEN excluded.auto_mode=1 THEN 0 ELSE maintenance_mode END,
       maintenance_reason=CASE WHEN excluded.auto_mode=1 THEN NULL ELSE maintenance_reason END,
       maintenance_by=CASE WHEN excluded.auto_mode=1 THEN NULL ELSE maintenance_by END,
       maintenance_at=CASE WHEN excluded.auto_mode=1 THEN NULL ELSE maintenance_at END`,
    [devEui, autoMode, req.user?.id || null]
  );
  await run(
    `INSERT INTO iot_audit_logs(event_type,dev_eui,payload,source)
     VALUES(?,?,?,?)`,
    ["iot_auto_mode_changed", devEui, jsonText({
      devEui,
      deviceName: latest.device_name || null,
      autoMode: Boolean(autoMode),
      user: req.user?.id || null,
      role: req.user?.role || null,
      timestamp: new Date().toISOString(),
    }), "erp_backend"]
  );

  let recovery = null;
  if (autoMode) {
    try {
      recovery = await reconcileIotLighting({ source: "auto_mode_enabled" });
    } catch (e) {
      recovery = { error: e.message };
    }
  }

  res.json({
    devEui,
    deviceName: latest.device_name || null,
    autoMode: Boolean(autoMode),
    recovery,
  });
});

router.post("/iot/devices/:devEui/downlink", auth, requirePermission("lighting_edit"), async (req, res) => {
  const devEui = normalizeDevEui(req.params.devEui);
  const action = String(req.body?.action || req.body?.command || "").trim().toUpperCase();
  const manualOffReason = normalizeManualOffReason(req.body?.manualOffReason || req.body?.reason);
  const manualOffNote = String(req.body?.manualOffNote || req.body?.note || "").trim().slice(0, 500);
  const rawRequest = {
    params: { devEui: req.params.devEui },
    body: req.body || {},
    requestedBy: req.user?.id || null,
    requestedByRole: req.user?.role || null,
  };

  const latest = await get(
    `SELECT dev_eui, device_name FROM iot_meter_readings WHERE dev_eui=? ORDER BY datetime(received_at) DESC, id DESC LIMIT 1`,
    [devEui]
  );
  if (!latest) return res.status(404).json({ error: "Device not found" });
  if (action === "OFF" && !manualOffReason) {
    return res.status(400).json({ error: "Manual OFF reason is required" });
  }
  const settings = await get("SELECT maintenance_mode FROM iot_device_settings WHERE dev_eui=?", [devEui]);
  if (action === "ON" && Number(settings?.maintenance_mode || 0)) {
    return res.status(409).json({
      error: "Maintenance mode is active. Return this node to AUTO after the work is finished before sending ON.",
      code: "maintenance_mode_active",
    });
  }

  const model = detectDeviceModel({ devEui, deviceName: latest.device_name });
  let config;
  try {
    config = validateDownlinkRequest({ devEui, action, model });
  } catch (e) {
    await run(
      `INSERT INTO iot_audit_logs(event_type,dev_eui,payload,source)
       VALUES(?,?,?,?)`,
      ["chirpstack_downlink", devEui || null, jsonText({
        rawRequest,
        devEui,
        deviceName: latest.device_name || null,
        model,
        action,
        user: req.user?.id || null,
        timestamp: new Date().toISOString(),
        ok: false,
        error: e.message,
      }), "erp_backend"]
    );
    return res.status(400).json({ error: e.message });
  }

  let auditPayload = {
    rawRequest,
    devEui,
    deviceName: latest.device_name || null,
    model,
    action,
    fPort: config.fPort,
    payloadHex: config.payloadHex,
    user: req.user?.id || null,
    timestamp: new Date().toISOString(),
    txackResult: null,
    ackResult: null,
  };

  try {
    const result = await enqueueChirpStackDownlink({ devEui, action, model });
    const chirpstackQueueResult = result.chirpstackQueueResult;
    await run(
      `INSERT INTO iot_device_commands(dev_eui,device_model,action,f_port,payload_hex,status,chirpstack_response,requested_by,requested_by_role)
       VALUES(?,?,?,?,?,?,?,?,?)`,
      [devEui, model, action, result.fPort, result.payloadHex, "queued", jsonText(chirpstackQueueResult), req.user?.id || null, req.user?.role || null]
    );
    await run(
      `INSERT INTO iot_device_settings(dev_eui,auto_mode,updated_by,updated_at)
       VALUES(?,0,?,CURRENT_TIMESTAMP)
       ON CONFLICT(dev_eui) DO UPDATE SET
         auto_mode=0,
         updated_by=excluded.updated_by,
         updated_at=CURRENT_TIMESTAMP,
         manual_off_reason=CASE WHEN ?='OFF' THEN ? ELSE NULL END,
         manual_off_note=CASE WHEN ?='OFF' THEN ? ELSE NULL END,
         manual_off_by=CASE WHEN ?='OFF' THEN ? ELSE NULL END,
         manual_off_at=CASE WHEN ?='OFF' THEN CURRENT_TIMESTAMP ELSE NULL END,
         maintenance_mode=CASE WHEN ?='OFF' AND ?='maintenance' THEN 1 WHEN ?='ON' THEN 0 ELSE maintenance_mode END,
         maintenance_reason=CASE WHEN ?='OFF' AND ?='maintenance' THEN ? WHEN ?='ON' THEN NULL ELSE maintenance_reason END,
         maintenance_by=CASE WHEN ?='OFF' AND ?='maintenance' THEN ? WHEN ?='ON' THEN NULL ELSE maintenance_by END,
         maintenance_at=CASE WHEN ?='OFF' AND ?='maintenance' THEN CURRENT_TIMESTAMP WHEN ?='ON' THEN NULL ELSE maintenance_at END`,
      [
        devEui,
        req.user?.id || null,
        action,
        manualOffReason ? MANUAL_OFF_REASONS[manualOffReason] : null,
        action,
        manualOffNote || null,
        action,
        req.user?.id || null,
        action,
        action,
        manualOffReason,
        action,
        action,
        manualOffReason,
        manualOffReason ? MANUAL_OFF_REASONS[manualOffReason] : null,
        action,
        action,
        manualOffReason,
        req.user?.id || null,
        action,
        action,
        manualOffReason,
        action,
      ]
    );
    auditPayload = {
      ...auditPayload,
      ok: true,
      chirpstackQueueResult,
      manualOffReason: action === "OFF" ? MANUAL_OFF_REASONS[manualOffReason] : null,
      manualOffNote: action === "OFF" ? manualOffNote || null : null,
    };
    await run(
      `INSERT INTO iot_audit_logs(event_type,dev_eui,payload,source)
       VALUES(?,?,?,?)`,
      ["chirpstack_downlink", devEui, jsonText(auditPayload), "erp_backend"]
    );
    res.json({
      devEui,
      deviceName: latest.device_name || null,
      model,
      action,
      fPort: result.fPort,
      payloadHex: result.payloadHex,
      chirpstackQueueResult,
      status: "queued",
      autoMode: false,
      manualOffReason: action === "OFF" ? MANUAL_OFF_REASONS[manualOffReason] : null,
    });
  } catch (e) {
    await run(
      `INSERT INTO iot_device_commands(dev_eui,device_model,action,f_port,payload_hex,status,chirpstack_response,requested_by,requested_by_role)
       VALUES(?,?,?,?,?,?,?,?,?)`,
      [devEui, model, action, config.fPort, config.payloadHex, "failed", jsonText({ error: e.message }), req.user?.id || null, req.user?.role || null]
    );
    auditPayload = { ...auditPayload, ok: false, error: e.message };
    await run(
      `INSERT INTO iot_audit_logs(event_type,dev_eui,payload,source)
       VALUES(?,?,?,?)`,
      ["chirpstack_downlink", devEui, jsonText(auditPayload), "erp_backend"]
    );
    res.status(502).json({ error: e.message || "Downlink failed" });
  }
});

module.exports = router;
