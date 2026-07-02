"use strict";

const { run, all, get } = require("../db");
const { writeNotification } = require("./notifications");

const MAX_ATTEMPTS_PER_ON_WINDOW = Number(process.env.IOT_RECOVERY_MAX_ATTEMPTS || 3);
const RETRY_MINUTES = Number(process.env.IOT_RECOVERY_RETRY_MINUTES || 5);
const LINE_POWER_VOLTAGE_MIN = Number(process.env.IOT_RECOVERY_LINE_POWER_VOLTAGE_MIN || 1);
const LOAD_POWER_KW_MIN = Number(process.env.IOT_RECOVERY_LOAD_POWER_KW_MIN || 0.01);
const LOAD_CURRENT_A_MIN = Number(process.env.IOT_RECOVERY_LOAD_CURRENT_A_MIN || 0.02);

const ADW300_DO1_ON_HEX = "4D6F646275733A30303130303143323030303130323030303136413232";
const ADW300_DO1_OFF_HEX = "4D6F646275733A30303130303143323030303130323030303041424532";

const IOT_NODE_CONFIG = {
  "00956906000AA9F1": { category: "\u0410\u0432\u0442\u043e \u0437\u0430\u043c\u044b\u043d \u0433\u044d\u0440\u044d\u043b", lampCount: 20, wattageW: 100 },
  "00956906000AE4EA": { category: "\u0413\u044d\u0440 \u0445\u043e\u0440\u043e\u043e\u043b\u043b\u044b\u043d \u0433\u044d\u0440\u044d\u043b", lampCount: 20, wattageW: 100 },
};

const CHOIBALSAN_LAT = 48.0714;
const CHOIBALSAN_LNG = 114.5357;
const MN_UTC_OFFSET = 8;

function normalizeDevEui(value) {
  return String(value || "").trim().toUpperCase();
}

function boolEnv(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function normalizeHex(value) {
  return String(value || "").replace(/\s+/g, "").toLowerCase();
}

function jsonText(value) {
  try {
    return JSON.stringify(value ?? {});
  } catch (_) {
    return "{}";
  }
}

function mnLocalDateKey(date = new Date()) {
  const local = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}-${String(local.getUTCDate()).padStart(2, "0")}`;
}

function mnLocalMinutes(date = new Date()) {
  const local = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

function minutesFromTime(value) {
  const m = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

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

function scheduledOnAt(log, date = new Date()) {
  if (!log) return null;
  if (Number(log.is_always_off || 0)) return false;
  const dateKey = mnLocalDateKey(date);
  const on = suitableOnMinutes(dateKey) ?? minutesFromTime(log.on_time);
  const off = minutesFromTime(log.off_time);
  const cur = mnLocalMinutes(date);
  if (on === null || off === null) return null;
  if (off <= on) return cur >= on || cur < off;
  return cur >= on && cur < off;
}

function scheduledDesiredAction(log, date = new Date()) {
  if (!log) return null;
  if (Number(log.is_always_off || 0)) return "OFF";
  const dateKey = mnLocalDateKey(date);
  const on = suitableOnMinutes(dateKey) ?? minutesFromTime(log.on_time);
  const off = minutesFromTime(log.off_time);
  const cur = mnLocalMinutes(date);
  if (on === null || off === null) return null;
  const isOnWindow = off <= on ? (cur >= on || cur < off) : (cur >= on && cur < off);
  return isOnWindow ? "ON" : "OFF";
}

function activeScheduleFor(logs, category, dateKey) {
  return logs.find(l => l.category === category && String(l.valid_from || "") <= dateKey) || null;
}

function latestNumber(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value === null || value === undefined || value === "") continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function hasLinePower(row) {
  const voltage = latestNumber(row, ["Ua", "voltage", "V"]);
  return voltage !== null && voltage > LINE_POWER_VOLTAGE_MIN;
}

function hasActiveLoad(row) {
  const power = latestNumber(row, ["totalP", "power"]);
  const current = latestNumber(row, ["Ia", "current", "A"]);
  if (power !== null && power > LOAD_POWER_KW_MIN) return true;
  if (current !== null && current > LOAD_CURRENT_A_MIN) return true;
  if (power !== null || current !== null) return false;
  const doState = String(row?.DO_State ?? row?.do_state ?? "").trim();
  if (doState === "1") return true;
  if (doState === "0") return false;
  return null;
}

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

async function latestDevices() {
  return all(`
    WITH latest AS (
      SELECT r.*
      FROM iot_meter_readings r
      JOIN (
        SELECT dev_eui, MAX(id) AS max_id
        FROM iot_meter_readings
        GROUP BY dev_eui
      ) x ON x.max_id = r.id
    )
    SELECT
      l.dev_eui AS devEui,
      l.device_name AS deviceName,
      l.received_at AS last_seen,
      (SELECT voltage FROM iot_meter_readings m WHERE m.dev_eui=l.dev_eui AND m.voltage IS NOT NULL ORDER BY m.id DESC LIMIT 1) AS voltage,
      (SELECT current FROM iot_meter_readings m WHERE m.dev_eui=l.dev_eui AND m.current IS NOT NULL ORDER BY m.id DESC LIMIT 1) AS current,
      (SELECT power FROM iot_meter_readings m WHERE m.dev_eui=l.dev_eui AND m.power IS NOT NULL ORDER BY m.id DESC LIMIT 1) AS power,
      (SELECT ua FROM iot_meter_readings m WHERE m.dev_eui=l.dev_eui AND m.ua IS NOT NULL ORDER BY m.id DESC LIMIT 1) AS Ua,
      (SELECT ia FROM iot_meter_readings m WHERE m.dev_eui=l.dev_eui AND m.ia IS NOT NULL ORDER BY m.id DESC LIMIT 1) AS Ia,
      (SELECT total_power FROM iot_meter_readings m WHERE m.dev_eui=l.dev_eui AND m.total_power IS NOT NULL ORDER BY m.id DESC LIMIT 1) AS totalP,
      (SELECT do_state FROM iot_meter_readings m WHERE m.dev_eui=l.dev_eui AND m.do_state IS NOT NULL ORDER BY m.id DESC LIMIT 1) AS DO_State,
      (SELECT action FROM iot_device_commands c WHERE c.dev_eui=l.dev_eui ORDER BY c.id DESC LIMIT 1) AS lastCommandAction,
      (SELECT status FROM iot_device_commands c WHERE c.dev_eui=l.dev_eui ORDER BY c.id DESC LIMIT 1) AS lastCommandStatus,
      (SELECT requested_by_role FROM iot_device_commands c WHERE c.dev_eui=l.dev_eui ORDER BY c.id DESC LIMIT 1) AS lastCommandRole,
      (SELECT requested_at FROM iot_device_commands c WHERE c.dev_eui=l.dev_eui ORDER BY c.id DESC LIMIT 1) AS lastCommandAt,
      s.manual_on_reason AS manualOnReason,
      s.manual_on_note AS manualOnNote,
      s.manual_on_by AS manualOnBy,
      s.manual_on_at AS manualOnAt,
      COALESCE(s.auto_mode, 1) AS autoMode,
      COALESCE(s.maintenance_mode, 0) AS maintenanceMode,
      NULL AS lastManualOnAt,
      NULL AS lastManualOffAt
    FROM latest l
    LEFT JOIN iot_device_settings s ON s.dev_eui=l.dev_eui
  `);
}

async function recordSystemCommand({ devEui, deviceName, model, action, result, status, error, reason, requestedByRole = "system" }) {
  const fallbackFPort = Number(process.env.IOT_DOWNLINK_FPORT) || 1;
  await run(
    `INSERT INTO iot_device_commands(dev_eui,device_model,action,f_port,payload_hex,status,chirpstack_response,requested_by,requested_by_role)
     VALUES(?,?,?,?,?,?,?,?,?)`,
    [
      devEui,
      model,
      action,
      result?.fPort || fallbackFPort,
      result?.payloadHex || downlinkPayloadHex(action, model),
      status,
      jsonText(result?.chirpstackQueueResult || { error, reason }),
      null,
      requestedByRole,
    ]
  );

  await run(
    `INSERT INTO iot_audit_logs(event_type,dev_eui,payload,source)
     VALUES(?,?,?,?)`,
    ["iot_auto_recovery_downlink", devEui, jsonText({
      devEui,
      deviceName,
      model,
      action,
      status,
      reason,
      ok: status === "queued",
      error: error || null,
      timestamp: new Date().toISOString(),
    }), "erp_auto_recovery"]
  );
}

async function upsertRecoveryState({ devEui, scheduleCategory, desiredAction, desiredMet, attempted, error }) {
  const existing = await get("SELECT * FROM iot_recovery_state WHERE dev_eui=?", [devEui]);
  const now = new Date().toISOString();
  const resetAttempts = desiredMet || (existing && existing.desired_action !== desiredAction);
  const nextAttemptCount = resetAttempts ? (attempted ? 1 : 0) : Number(existing?.attempt_count || 0) + (attempted ? 1 : 0);
  if (!existing) {
    await run(
      `INSERT INTO iot_recovery_state(dev_eui,schedule_category,desired_action,attempt_count,last_attempt_at,last_observed_at,last_error,updated_at)
       VALUES(?,?,?,?,?,?,?,?)`,
      [devEui, scheduleCategory || "", desiredAction || "", attempted ? 1 : 0, attempted ? now : null, now, error || null, now]
    );
    return { attemptCount: attempted ? 1 : 0 };
  }

  await run(
    `UPDATE iot_recovery_state
        SET schedule_category=?,
            desired_action=?,
            attempt_count=?,
            last_attempt_at=CASE WHEN ? THEN ? ELSE last_attempt_at END,
            last_observed_at=?,
            last_error=?,
            updated_at=?
      WHERE dev_eui=?`,
    [
      scheduleCategory || "",
      desiredAction || "",
      nextAttemptCount,
      attempted ? 1 : 0,
      now,
      now,
      error || null,
      now,
      devEui,
    ]
  );
  return { attemptCount: nextAttemptCount };
}

function canRetry(state, desiredAction) {
  if (!state) return true;
  if (desiredAction && state.desired_action !== desiredAction) return true;
  if (!state.last_attempt_at) return true;
  const last = new Date(state.last_attempt_at).getTime();
  return !Number.isFinite(last) || Date.now() - last >= RETRY_MINUTES * 60 * 1000;
}

let recoveryRunning = false;

async function reconcileIotLighting({ source = "cron" } = {}) {
  if (recoveryRunning) return { skipped: true, reason: "already_running" };
  recoveryRunning = true;
  const summary = { checked: 0, attempted: 0, skipped: 0, failed: 0 };
  try {
    const [devices, schedules] = await Promise.all([
      latestDevices(),
      all(`SELECT category,valid_from,on_time,off_time,is_always_off
             FROM light_schedule_logs
            ORDER BY category, valid_from DESC, id DESC`),
    ]);
    const dateKey = mnLocalDateKey();

    for (const row of devices) {
      summary.checked += 1;
      const devEui = normalizeDevEui(row.devEui);
      const config = IOT_NODE_CONFIG[devEui];
      if (!config?.category) {
        summary.skipped += 1;
        continue;
      }
      if (Number(row.maintenanceMode || 0)) {
        await upsertRecoveryState({ devEui, scheduleCategory: config.category, desiredAction: "MAINTENANCE", desiredMet: true, attempted: false });
        summary.skipped += 1;
        continue;
      }
      if (!Number(row.autoMode ?? 1)) {
        await upsertRecoveryState({ devEui, scheduleCategory: config.category, desiredAction: "MANUAL", desiredMet: true, attempted: false });
        summary.skipped += 1;
        continue;
      }

      const schedule = activeScheduleFor(schedules, config.category, dateKey);
      const desiredAction = scheduledDesiredAction(schedule);
      const linePower = hasLinePower(row);
      const loadOn = hasActiveLoad(row);
      const state = await get("SELECT * FROM iot_recovery_state WHERE dev_eui=?", [devEui]);
      const desiredMet =
        (desiredAction === "ON" && loadOn === true) ||
        (desiredAction === "OFF" && loadOn === false);

      // Schedule зөрчил илрэхэд (OFF ёстой байтал гэрэл асаалттай) notification бичих
      if (desiredAction === "OFF" && loadOn === true) {
        const deviceLabel = row.deviceName || devEui;
        const hourKey = new Date().toISOString().slice(0, 13);
        const lastCmd = String(row.lastCommandAction || "").toUpperCase();
        const lastRole = String(row.lastCommandRole || "");
        const isOperator = lastRole && lastRole !== "system";
        const manualOnReason = row.manualOnReason || "Шалтгаан бүртгээгүй";
        const manualOnNote = row.manualOnNote ? ` Тайлбар: ${row.manualOnNote}` : "";
        if (lastCmd === "ON" && isOperator) {
          await writeNotification({
            type: "iot_manual_on_violation",
            title: `${deviceLabel}: Унтрах ёстой цагт гараар асаасан`,
            body: `${deviceLabel} хуваарийн дагуу унтрах ёстой цагт оператор гараар асаасан байна. Шалтгаан: ${manualOnReason}.${manualOnNote}`,
            dedupe_key: `iot_manual_on:${devEui}:${hourKey}`,
          }).catch(() => {});
        } else if (!lastCmd || lastCmd === "OFF") {
          await writeNotification({
            type: "iot_unexpected_power",
            title: `${deviceLabel}: Сервер ON тушаал өгөөгүй — гэрэл асчээ`,
            body: `${deviceLabel}-д хуваарийн бус цагт тог өгөгдөж гэрэл асчээ. Сервер ON тушаал илгээгээгүй. Физик эх үүсвэр шалгана уу.`,
            dedupe_key: `iot_unexpected_power:${devEui}:${hourKey}`,
          }).catch(() => {});
        }
      }

      if (!desiredAction || !linePower || desiredMet || !canRetry(state, desiredAction)) {
        await upsertRecoveryState({ devEui, scheduleCategory: config.category, desiredAction, desiredMet, attempted: false });
        summary.skipped += 1;
        continue;
      }

      const model = detectDeviceModel({ devEui, deviceName: row.deviceName });
      const reason = desiredAction === "OFF"
        ? `${source}: schedule_off_boundary_line_power_load_on`
        : `${source}: schedule_on_line_power_no_load`;
      try {
        const result = await enqueueChirpStackDownlink({ devEui, action: desiredAction, model });
        await recordSystemCommand({ devEui, deviceName: row.deviceName, model, action: desiredAction, result, status: "queued", reason });
        await upsertRecoveryState({ devEui, scheduleCategory: config.category, desiredAction, desiredMet, attempted: true });
        summary.attempted += 1;
      } catch (e) {
        await recordSystemCommand({ devEui, deviceName: row.deviceName, model, action: desiredAction, status: "failed", error: e.message, reason });
        await upsertRecoveryState({ devEui, scheduleCategory: config.category, desiredAction, desiredMet, attempted: true, error: e.message });
        summary.failed += 1;
      }
    }
    return summary;
  } finally {
    recoveryRunning = false;
  }
}

async function sendImmediateIotCommand({ devEui, action, source = "manual_test", requestedByRole = "director_test" }) {
  const normalizedDevEui = normalizeDevEui(devEui);
  const row = (await latestDevices()).find(d => normalizeDevEui(d.devEui) === normalizedDevEui);
  if (!row) throw new Error(`Device not found: ${normalizedDevEui}`);
  if (!IOT_NODE_CONFIG[normalizedDevEui]) throw new Error(`Device is not allowed for IoT recovery test: ${normalizedDevEui}`);
  const normalizedAction = String(action || "").toUpperCase();
  const model = detectDeviceModel({ devEui: normalizedDevEui, deviceName: row.deviceName });
  const result = await enqueueChirpStackDownlink({ devEui: normalizedDevEui, action: normalizedAction, model });
  await recordSystemCommand({
    devEui: normalizedDevEui,
    deviceName: row.deviceName,
    model,
    action: normalizedAction,
    result,
    status: "queued",
    reason: source,
    requestedByRole,
  });
  return {
    devEui: normalizedDevEui,
    deviceName: row.deviceName,
    model,
    action: normalizedAction,
    status: "queued",
    queueId: result.chirpstackQueueResult?.id || null,
  };
}

module.exports = { reconcileIotLighting, sendImmediateIotCommand };
