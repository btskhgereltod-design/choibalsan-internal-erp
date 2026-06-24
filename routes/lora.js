const express = require("express");
const { run, all, get, auth, audit } = require("../db");
const { requirePermission } = require("../middleware/roles");
const router = express.Router();

function requireIotSecret(req, res, next) {
  const secret = process.env.IOT_WEBHOOK_SECRET;
  if (!secret) {
    console.warn("[LoRa] IOT_WEBHOOK_SECRET not configured — uplink endpoint unprotected");
    return next();
  }
  const provided = req.headers["x-iot-secret"];
  if (!provided || provided !== secret) {
    console.warn(`[LoRa] Invalid X-IOT-SECRET from ${req.ip}`);
    return res.status(401).json({ ok: false, error: "Invalid IoT webhook secret" });
  }
  next();
}

// ── Devices ───────────────────────────────────────────────────
router.get("/lora-devices", auth, async (req, res) => {
  try {
    const rows = await all(`
      SELECT d.*,
             sp.name        sl_point_name,
             gi.location_name ger_name
      FROM lora_devices d
      LEFT JOIN sl_points sp ON sp.id = d.sl_point_id
      LEFT JOIN sl_ger_inventory gi ON gi.id = d.ger_inv_id
      ORDER BY d.is_active DESC, d.device_name`);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post("/lora-devices", auth, requirePermission("lora_manage"), async (req, res) => {
  try {
    const b = req.body;
    if (!b.device_name) return res.status(400).json({ error: "Нэр оруулна уу" });
    const r = await run(`
      INSERT INTO lora_devices(device_eui,device_name,model,sl_point_id,ger_inv_id,
        location_desc,phase,is_active,notes,installed_date)
      VALUES(?,?,?,?,?,?,?,?,?,?)`,
      [b.device_eui||null, b.device_name, b.model||"AWD300",
       b.sl_point_id||null, b.ger_inv_id||null,
       b.location_desc||"", b.phase||"1Ф",
       b.is_active !== false ? 1 : 0,
       b.notes||"", b.installed_date||null]);
    await audit(req.user.id, "CREATE", "lora_devices", r.id, b.device_name);
    res.json({ id: r.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put("/lora-devices/:id", auth, requirePermission("lora_manage"), async (req, res) => {
  try {
    const b = req.body;
    await run(`
      UPDATE lora_devices SET device_eui=?,device_name=?,model=?,sl_point_id=?,ger_inv_id=?,
        location_desc=?,phase=?,is_active=?,notes=?,installed_date=? WHERE id=?`,
      [b.device_eui||null, b.device_name, b.model||"AWD300",
       b.sl_point_id||null, b.ger_inv_id||null,
       b.location_desc||"", b.phase||"1Ф",
       b.is_active !== false ? 1 : 0,
       b.notes||"", b.installed_date||null, req.params.id]);
    await audit(req.user.id, "UPDATE", "lora_devices", req.params.id, b.device_name);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete("/lora-devices/:id", auth, requirePermission("lora_manage"), async (req, res) => {
  try {
    await run("DELETE FROM lora_devices WHERE id=?", [req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Daily readings ────────────────────────────────────────────
router.get("/lora-daily", auth, async (req, res) => {
  try {
    const { device_id, date_from, date_to, is_fault } = req.query;
    let sql = `
      SELECT ld.*, d.device_name, d.model, d.phase,
             sp.name sl_point_name, gi.location_name ger_name,
             u.full_name entered_by_name
      FROM lora_daily ld
      JOIN lora_devices d ON d.id = ld.device_id
      LEFT JOIN sl_points sp ON sp.id = d.sl_point_id
      LEFT JOIN sl_ger_inventory gi ON gi.id = d.ger_inv_id
      LEFT JOIN users u ON u.id = ld.entered_by
      WHERE 1=1`;
    const params = [];
    if (device_id)   { sql += " AND ld.device_id=?";  params.push(device_id); }
    if (date_from)   { sql += " AND ld.date>=?";       params.push(date_from); }
    if (date_to)     { sql += " AND ld.date<=?";       params.push(date_to); }
    if (is_fault==="1") { sql += " AND ld.is_fault=1"; }
    sql += " ORDER BY ld.date DESC, d.device_name";
    res.json(await all(sql, params));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post("/lora-daily", auth, requirePermission("lora_access"), async (req, res) => {
  try {
    const b = req.body;
    if (!b.device_id || !b.date) return res.status(400).json({ error: "Дутуу мэдээлэл" });
    await run(`
      INSERT INTO lora_daily(device_id,date,on_time,off_time,voltage_v,current_a,power_kw,
        energy_kwh,power_factor,is_fault,fault_note,rssi,snr,entered_by,source)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'manual')
      ON CONFLICT(device_id,date) DO UPDATE SET
        on_time=excluded.on_time, off_time=excluded.off_time,
        voltage_v=excluded.voltage_v, current_a=excluded.current_a,
        power_kw=excluded.power_kw, energy_kwh=excluded.energy_kwh,
        power_factor=excluded.power_factor,
        is_fault=excluded.is_fault, fault_note=excluded.fault_note,
        entered_by=excluded.entered_by`,
      [b.device_id, b.date, b.on_time||null, b.off_time||null,
       b.voltage_v||null, b.current_a||null, b.power_kw||null,
       b.energy_kwh||null, b.power_factor||null,
       b.is_fault ? 1 : 0, b.fault_note||"",
       b.rssi||null, b.snr||null, req.user.id]);
    await audit(req.user.id, "UPSERT", "lora_daily", b.device_id, b.date);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete("/lora-daily/:id", auth, requirePermission("lora_manage"), async (req, res) => {
  try {
    await run("DELETE FROM lora_daily WHERE id=?", [req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Per-device summary (last 30 days) ────────────────────────
router.get("/lora-summary", auth, async (req, res) => {
  try {
    const rows = await all(`
      SELECT d.id, d.device_name, d.model, d.phase, d.is_active, d.device_eui,
             d.last_seen, d.last_voltage, d.last_current, d.last_power, d.last_status,
             d.location_desc,
             sp.name sl_point_name, gi.location_name ger_name,
             COUNT(ld.id)       days_recorded,
             SUM(ld.energy_kwh) total_kwh,
             SUM(ld.is_fault)   fault_days,
             MAX(ld.date)       last_date
      FROM lora_devices d
      LEFT JOIN sl_points sp ON sp.id = d.sl_point_id
      LEFT JOIN sl_ger_inventory gi ON gi.id = d.ger_inv_id
      LEFT JOIN lora_daily ld ON ld.device_id = d.id
        AND ld.date >= date('now','-30 days')
      GROUP BY d.id
      ORDER BY d.is_active DESC, d.device_name`);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── LoRaWAN uplink webhook (ChirpStack v4 / TTN v3) ──────────
router.post("/lora-uplink", requireIotSecret, async (req, res) => {
  try {
    const body = req.body;
    // Normalize EUI from either ChirpStack or TTN format
    let eui = (body.deviceInfo?.devEui || body.devEUI || body.end_device_ids?.dev_eui || "").toUpperCase();
    if (!eui) return res.status(200).json({ ok: false, msg: "no eui" });

    const decoded = body.object || body.uplink_message?.decoded_payload || body.data || {};
    const rxMeta  = (body.rxInfo || body.uplink_message?.rx_metadata || [])[0] || {};

    const rssi = rxMeta.rssi ?? null;
    const snr  = rxMeta.snr  ?? null;

    // AWD300/AWD310 decoded field mapping
    const voltage_v    = decoded.voltage    ?? decoded.volt   ?? decoded.U   ?? null;
    const current_a    = decoded.current    ?? decoded.amp    ?? decoded.I   ?? null;
    const power_kw     = decoded.power      ?? decoded.P      ?? null;
    const energy_kwh   = decoded.energy     ?? decoded.E      ?? decoded.kwh ?? null;
    const power_factor = decoded.pf         ?? decoded.powerFactor          ?? null;
    const is_on        = decoded.relay !== undefined ? (decoded.relay ? 1 : 0) : 1;
    const is_fault     = decoded.alarm      ?? decoded.fault  ?? 0;
    const fault_code   = decoded.alarmCode  ?? decoded.faultCode            ?? null;

    const dev = await get("SELECT id FROM lora_devices WHERE device_eui=? AND is_active=1", [eui]);
    if (!dev) return res.status(200).json({ ok: false, msg: "device not registered" });

    const now  = new Date().toISOString();
    const date = now.slice(0, 10);

    await run(`
      INSERT INTO lora_daily(device_id,date,voltage_v,current_a,power_kw,energy_kwh,power_factor,is_fault,source)
      VALUES(?,?,?,?,?,?,?,?,'lorawan')
      ON CONFLICT(device_id,date) DO UPDATE SET
        voltage_v    = COALESCE(excluded.voltage_v,    voltage_v),
        current_a    = COALESCE(excluded.current_a,    current_a),
        power_kw     = COALESCE(excluded.power_kw,     power_kw),
        energy_kwh   = CASE WHEN excluded.energy_kwh > energy_kwh THEN excluded.energy_kwh ELSE energy_kwh END,
        power_factor = COALESCE(excluded.power_factor, power_factor),
        is_fault     = MAX(excluded.is_fault, is_fault)`,
      [dev.id, date, voltage_v, current_a, power_kw, energy_kwh, power_factor, is_fault ? 1 : 0]);

    await run(`
      INSERT INTO lora_readings(device_id,received_at,voltage_v,current_a,power_kw,energy_kwh,
        power_factor,is_on,is_fault,fault_code,rssi,snr,raw_payload)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [dev.id, now, voltage_v, current_a, power_kw, energy_kwh, power_factor,
       is_on, is_fault ? 1 : 0, fault_code, rssi, snr,
       JSON.stringify(body).slice(0, 2000)]);

    await run(`
      UPDATE lora_devices SET last_seen=?,last_voltage=?,last_current=?,last_power=?,last_status=?
      WHERE id=?`,
      [now, voltage_v, current_a, power_kw,
       is_fault ? "fault" : (is_on ? "on" : "off"), dev.id]);

    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
