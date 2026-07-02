import { state, api, toast, escapeHtml } from './common.js';

let _iotRows = [];
let _iotView = "overview";
let _iotLeafletReady = false;
let _iotMap = null;
let _iotMarkers = null;
let _iotMaximized = false;
let _iotReport = null;
let _iotReportPeriod = "night";
let _iotChartDevEui = "";
let _iotChartBucket = 15;
let _iotSeries = null;
let _iotMeterPoints = [];
let _iotLightPoints = [];
let _iotGerInventory = [];
let _iotNetworkRoutes = [];
let _iotNetworkPoles = [];
let _iotDrawMode = "";
let _iotDraftRoute = [];
let _iotDraftLayer = null;
let _iotWorkCategory = "road";
let _iotWorkName = "";
let _iotWorkMeter = "";
let _iotScadaMode = false;
let _iotPoleSpacingM = 40;
let _iotFeedDraft = null;
let _iotCablePath = [];
let _iotFeedDraftLayer = null;
let _iotFeedConnectRouteId = null;
let _iotFeedHighlightLayer = null;
let _iotSnapPoint = null;
let _iotSnapMarker = null;
let _iotSavedCenter = null;
let _iotSavedZoom = null;
let _iotSplitMode = false;
let _iotFeedPoints = [];
let _iotFeederCables = [];
let _iotFeedPointDeviceLinks = [];
let _iotDualSide = false;
let _iotSelectedFeedPointId = null;
let _iotRoadWidth = 14;
let _iotScheduleInfo = [];
let _iotEmployeeLocations = [];

function fmtNum(value, digits = 2, suffix = "") {
  if (value === null || value === undefined || value === "") return "-";
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return `${n.toFixed(digits)}${suffix}`;
}

function fmtText(value) {
  return value === null || value === undefined || value === "" ? "-" : escapeHtml(value);
}

function fmtDate(value) {
  if (!value) return "-";
  const raw = String(value);
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(raw)
    ? `${raw.replace(" ", "T")}Z`
    : raw;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return escapeHtml(String(value).slice(0, 19));
  return d.toLocaleString("mn-MN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isOnline(lastSeen) {
  if (!lastSeen) return false;
  const t = new Date(lastSeen).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t <= 10 * 60 * 1000;
}

function hasLinePower(row) {
  const voltage = Number(iotNumericValue(row, "voltage"));
  if (!Number.isFinite(voltage)) return false;
  return voltage > 1;
}

function isDeviceOnline(row) {
  return isOnline(row?.last_seen);
}

function statusBadge(row) {
  const online = isDeviceOnline(row);
  const bg = online ? "#dcfce7" : "#fee2e2";
  const fg = online ? "#166534" : "#991b1b";
  const label = online ? "Дохио ирсэн" : "Дохио тасарсан";
  return `<span style="display:inline-flex;align-items:center;gap:6px;border-radius:999px;background:${bg};color:${fg};font-size:12px;font-weight:700;padding:3px 9px">
    <span style="width:7px;height:7px;border-radius:999px;background:${fg};display:inline-block"></span>${label}
  </span>`;
}

function doStateValue(row) {
  const value = row?.DO_State;
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function rowModel(row) {
  return String(row?.deviceModel || row?.command_device_model || "").toUpperCase();
}

function hasDecodedScalars(row) {
  const raw = rawPayloadObject(row);
  const obj = raw.object || raw.decodedData || raw.objectJSON || {};
  return Object.entries(obj || {}).some(([, v]) => v !== null && v !== undefined && typeof v !== "object");
}

function hasPhaseData(row) {
  return ["Ua", "Ub", "Uc", "Ia", "Ib", "Ic", "totalP", "EP", "Pf"].some(field => phaseNumber(row, field) !== null);
}

function isDecoderMissing(row) {
  return rowModel(row) === "ADW300" && !hasDecodedScalars(row) && !hasPhaseData(row);
}

function firstFiniteValue(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const n = Number(value);
    if (Number.isFinite(n)) return value;
  }
  return undefined;
}

function rawDecodedNumber(row, keys) {
  const raw = rawPayloadObject(row);
  const obj = raw.object || raw.decodedData || raw.objectJSON || {};
  return deepFindNumber(obj, keys) ?? deepFindNumber(raw, keys);
}

function iotNumericValue(row, field) {
  if (!row) return undefined;
  if (field === "voltage") return firstFiniteValue(row.Ua, row.voltage, row.V, rawDecodedNumber(row, ["voltage", "Voltage", "V", "U", "u"]));
  if (field === "current") return firstFiniteValue(row.Ia, row.current, row.A, rawDecodedNumber(row, ["current", "Current", "A", "I", "i"]));
  if (field === "power") return firstFiniteValue(row.totalP, row.power, rawDecodedNumber(row, ["totalP", "TotalP", "total_power", "totalPower", "P", "p", "power", "Power", "kW"]));
  if (field === "energy") return firstFiniteValue(row.EP, row.energy, rawDecodedNumber(row, ["EP", "Ep", "ep", "energy", "Energy", "kWh", "total_energy", "totalEnergy", "EQ_F1", "EQF1", "eq_f1"]));
  if (field === "frequency") return firstFiniteValue(row.frequency, rawDecodedNumber(row, ["frequency", "Frequency", "Hz", "F", "f"]));
  if (field === "power_factor") return firstFiniteValue(row.Pf, row.power_factor, rawDecodedNumber(row, ["Pf", "PF", "pf", "power_factor", "powerFactor", "PowerFactor"]));
  return row[field];
}

function fmtIotValue(row, field, digits, suffix = "") {
  if (isDecoderMissing(row)) return "-";
  return fmtNum(iotNumericValue(row, field), digits, suffix);
}

function fmtIotState(row, field) {
  if (isDecoderMissing(row)) return "-";
  return fmtText(row?.[field]);
}

function phaseNumber(row, field) {
  const n = Number(row?.[field]);
  return Number.isFinite(n) ? n : null;
}

function isAdw300SinglePhaseTest(row) {
  if (rowModel(row) !== "ADW300") return false;
  const ua = phaseNumber(row, "Ua");
  const ia = phaseNumber(row, "Ia");
  const ub = phaseNumber(row, "Ub");
  const uc = phaseNumber(row, "Uc");
  const ib = phaseNumber(row, "Ib");
  const ic = phaseNumber(row, "Ic");
  const hasA = (ua !== null && ua > 1) || (ia !== null && ia > 0);
  const onlyA =
    (ub === null || ub === 0) &&
    (uc === null || uc === 0) &&
    (ib === null || ib === 0) &&
    (ic === null || ic === 0);
  return hasA && onlyA;
}

function modelLine(row) {
  if (rowModel(row) === "ADW300") {
    return isAdw300SinglePhaseTest(row)
      ? "ADW300 / 380V 3-phase meter / currently 220V single-phase test"
      : "ADW300 / 380V 3-phase meter";
  }
  if (rowModel(row) === "ADW310") return "ADW310 / 220V single-phase meter";
  return "";
}

function phaseLine(row) {
  if (rowModel(row) !== "ADW300") return decodedPayloadSummary(row);
  if (isDecoderMissing(row)) return "ADW300 / 380V 3-phase meter / currently 220V single-phase test · decoder object ирээгүй";
  return [
    `Ua ${fmtNum(row.Ua, 1, "V")}`,
    `Ub ${fmtNum(row.Ub, 1, "V")}`,
    `Uc ${fmtNum(row.Uc, 1, "V")}`,
    `Ia ${fmtNum(row.Ia, 2, "A")}`,
    `Ib ${fmtNum(row.Ib, 2, "A")}`,
    `Ic ${fmtNum(row.Ic, 2, "A")}`,
    `P ${fmtNum(row.totalP ?? row.power, 3, "kW")}`,
    `EP ${fmtNum(row.EP ?? row.energy, 3, "kWh")}`,
    `Pf ${fmtNum(row.Pf ?? row.power_factor, 3)}`,
  ].join(" · ");
}

function hasActiveLoad(row) {
  if (isDecoderMissing(row)) return null;
  const power = Number(iotNumericValue(row, "power"));
  const current = Number(iotNumericValue(row, "current"));
  if (Number.isFinite(power) && power > 0.01) return true;
  if (Number.isFinite(current) && current > 0.02) return true;
  if (Number.isFinite(power) || Number.isFinite(current)) return false;
  return null;
}

function isAutoMode(row) {
  return !(row?.autoMode === 0 || row?.autoMode === false || row?.autoMode === "0");
}

function autoModeBadge(row) {
  return isAutoMode(row)
    ? `<div class="iot-command-badge iot-auto-badge-on">Сонголт: AUTO</div>`
    : `<div class="iot-command-badge iot-auto-badge-off">Сонголт: ${controlMode(row)}</div>`;
}

function controlMode(row) {
  if (isAutoMode(row)) return "AUTO";
  const action = String(row?.command_action || "").toUpperCase();
  if (action === "ON" || action === "OFF") return action;
  const relay = relayState(row);
  if (relay === "on") return "ON";
  if (relay === "off") return "OFF";
  return "MANUAL";
}

function isManualOff(row) {
  return !isAutoMode(row) && controlMode(row) === "OFF";
}

function isMaintenanceMode(row) {
  return row?.maintenanceMode === 1 || row?.maintenanceMode === true || row?.maintenanceMode === "1";
}

function manualOffAgeHours(row) {
  if (!row?.manualOffAt) return 0;
  const t = new Date(row.manualOffAt).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, (Date.now() - t) / 3600000);
}

function maintenanceBadge(row) {
  if (!isMaintenanceMode(row)) return "";
  const operator = row.maintenanceOperatorName || row.maintenanceOperatorUsername || row.maintenanceBy || "-";
  const reason = row.maintenanceReason || row.manualOffReason || "Засвар";
  return `<div class="iot-maintenance-badge">
    <b>ЗАСВАР ГОРИМ</b>
    <span>Auto-recovery бүрэн хориглогдсон</span>
    <span>Шалтгаан: ${fmtText(reason)}</span>
    <span>Оператор: ${fmtText(operator)}</span>
    <span>${fmtDate(row.maintenanceAt || row.manualOffAt || row.autoModeUpdatedAt)}</span>
  </div>`;
}

function manualOffBadge(row) {
  if (!isManualOff(row)) return "";
  const operator = row.manualOffOperatorName || row.manualOffOperatorUsername || row.manualOffBy || "-";
  const reason = row.manualOffReason || "Шалтгаан бүртгээгүй";
  const note = row.manualOffNote ? `<div class="iot-manual-off-line">${fmtText(row.manualOffNote)}</div>` : "";
  const overdue = manualOffAgeHours(row) >= 24;
  return `<div class="iot-manual-off-badge${overdue ? " is-overdue" : ""}">
    <b>MANUAL OFF</b>
    <span>Schedule идэвхгүй</span>
    <span>Шалтгаан: ${fmtText(reason)}</span>
    <span>Оператор: ${fmtText(operator)}</span>
    <span>${fmtDate(row.manualOffAt || row.autoModeUpdatedAt)}</span>
    ${overdue ? `<strong>24 цагаас дээш manual OFF байна</strong>` : ""}
    ${note}
  </div>`;
}

function commandButtonClass(row, action) {
  const active = controlMode(row) === action;
  return `iot-command-btn iot-${action.toLowerCase()}${active ? " is-active" : ""}`;
}

function commandButtonDisabled(row, action) {
  if (action === "ON" && isMaintenanceMode(row)) return " disabled title=\"Засвар горим идэвхтэй\"";
  return controlMode(row) === action ? " disabled" : "";
}

function relayState(row) {
  if (isDecoderMissing(row)) return "unknown";
  const loadOn = hasActiveLoad(row);
  if (loadOn === true) return "on";
  if (loadOn === false) return "off";
  const stateValue = doStateValue(row);
  if (stateValue === "1") return "on";
  if (stateValue === "0") return "off";
  return "unknown";
}

function relayStateBadge(row) {
  const stateValue = relayState(row);
  if (stateValue === "on") return `<div class="iot-relay-state iot-relay-on">ГЭРЭЛ АССАН</div>`;
  if (stateValue === "off") return `<div class="iot-relay-state iot-relay-off">ГЭРЭЛ АСААГҮЙ</div>`;
  return `<div class="iot-relay-state iot-relay-unknown">ТӨЛӨВ ТОДОРХОЙГҮЙ</div>`;
}

function commandBadge(row) {
  const s = row.command_confirmation_status;
  if (!s) return "";
  const cfg = {
    pending_confirmation: ["#fef3c7", "#92400e", "Баталгаажилт хүлээж байна"],
    sent_not_confirmed: ["#fee2e2", "#991b1b", "Команд илгээгдсэн ч баталгаажаагүй"],
    on_confirmed: ["#dcfce7", "#166534", "Асаалт баталгаажсан"],
    off_confirmed: ["#dcfce7", "#166534", "Унтраалт баталгаажсан"],
  };
  const [bg, fg, label] = cfg[s] || ["#f1f5f9", "#475569", s];
  return `<div class="iot-command-badge" style="background:${bg};color:${fg}">${label}</div>`;
}

commandBadge = function(row) {
  const s = row.command_confirmation_status || row.command_status;
  if (!s) return "";
  const cfg = {
    queued: ["#e0f2fe", "#075985", "Команд хүлээгдэж байна"],
    pending_confirmation: ["#e0f2fe", "#075985", "Команд хүлээгдэж байна"],
    txack_received: ["#ede9fe", "#5b21b6", "LoRa дамжуулалт баталгаажсан"],
    ack_received: ["#dcfce7", "#166534", "Төхөөрөмж хүлээн авсан"],
    ack_failed: ["#fee2e2", "#991b1b", "Төхөөрөмж баталгаажуулаагүй"],
    failed: ["#fee2e2", "#991b1b", "Команд амжилтгүй"],
    uplink_received: ["#fef3c7", "#92400e", "Дохио ирсэн"],
    sent_not_confirmed: ["#fee2e2", "#991b1b", "Реле баталгаажаагүй"],
    on_confirmed: ["#dcfce7", "#166534", "Асалт баталгаажсан"],
    off_confirmed: ["#dcfce7", "#166534", "Унтраалт баталгаажсан"],
  };
  const [bg, fg, label] = cfg[s] || ["#f1f5f9", "#475569", s];
  return `<div class="iot-command-badge" style="background:${bg};color:${fg}">${label}</div>`;
};

relayStateBadge = function(row) {
  const stateValue = relayState(row);
  if (stateValue === "on") return `<div class="iot-relay-state iot-relay-on">ГЭРЭЛ АССАН</div>`;
  if (stateValue === "off") return `<div class="iot-relay-state iot-relay-off">ГЭРЭЛ АСААГҮЙ</div>`;
  return `<div class="iot-relay-state iot-relay-unknown">ТӨЛӨВ БАТАЛГААЖААГҮЙ</div>`;
};

function renderSummary() {
  const total = _iotRows.length;
  const online = _iotRows.filter(r => isDeviceOnline(r)).length;
  const offline = total - online;
  const manualOffLong = _iotRows.filter(r => isManualOff(r) && manualOffAgeHours(r) >= 24).length;
  const energy = _iotRows.reduce((sum, r) => sum + (Number(iotNumericValue(r, "energy")) || 0), 0);
  const power = _iotRows.reduce((sum, r) => sum + (Number(iotNumericValue(r, "power")) || 0), 0);
  const cards = [
    ["Manual OFF >24ц", manualOffLong, manualOffLong ? "#fee2e2" : "#f8fafc", manualOffLong ? "#b91c1c" : "#64748b"],
    ["Нийт төхөөрөмж", total, "#eff6ff", "#1d4ed8"],
    ["Дохио ирсэн", online, "#dcfce7", "#166534"],
    ["Дохио тасарсан", offline, "#fee2e2", "#991b1b"],
    ["Нийт чадал", fmtNum(power, 2, " kW"), "#f8fafc", "#334155"],
    ["Нийт энерги", fmtNum(energy, 2, " kWh"), "#fefce8", "#854d0e"],
  ];
  return `<div class="iot-summary-grid">
    ${cards.map(([label, value, bg, color]) => `
      <div class="iot-summary-card" style="background:${bg};border-color:${color}22">
        <div style="font-size:12px;color:#64748b;margin-bottom:5px">${label}</div>
        <div style="font-size:24px;font-weight:800;color:${color}">${value}</div>
      </div>
    `).join("")}
  </div>`;
}

function renderTable() {
  return `
    <div class="iot-table-wrap">
      <table class="iot-meter-table">
        <thead>
          <tr style="background:#f8fafc">
            ${[
              "Төлөв","Төхөөрөмж","DevEUI","V","A","kW","kWh",
              "Hz","PF","DO","DI","RSSI","SNR","Сүүлд","Удирдлага"
            ].map((h, i) => `<th class="${i === 14 ? "iot-sticky-col" : ""}">${h}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${_iotRows.length ? _iotRows.map(row => `
            <tr style="border-bottom:1px solid #f1f5f9">
              <td>${statusBadge(row)}</td>
              <td class="iot-device-name">
                <div>${fmtText(row.deviceName)}</div>
                ${modelLine(row) ? `<div class="iot-model-inline">${escapeHtml(modelLine(row))}</div>` : ""}
                <div class="iot-payload-inline">${phaseLine(row)}</div>
              </td>
              <td class="iot-mono iot-deveui">${fmtText(row.devEui)}</td>
              <td class="iot-mono">${fmtIotValue(row, "voltage", 1, " V")}</td>
              <td class="iot-mono">${fmtIotValue(row, "current", 2, " A")}</td>
              <td class="iot-mono">${fmtIotValue(row, "power", 3, " kW")}</td>
              <td class="iot-mono iot-strong">${fmtIotValue(row, "energy", 3, " kWh")}</td>
              <td class="iot-mono">${fmtIotValue(row, "frequency", 2, " Hz")}</td>
              <td class="iot-mono">${fmtIotValue(row, "power_factor", 3)}</td>
              <td>${fmtIotState(row, "DO_State")}</td>
              <td>${fmtIotState(row, "DI_State")}</td>
              <td class="iot-mono">${fmtNum(row.rssi, 0, " dBm")}</td>
              <td class="iot-mono">${fmtNum(row.snr, 1, " dB")}</td>
              <td class="iot-last-seen">${fmtDate(row.last_seen)}</td>
              <td class="iot-sticky-col iot-control-cell iot-relay-${relayState(row)}">
                ${relayStateBadge(row)}
                ${commandBadge(row)}
                ${autoModeBadge(row)}
                ${maintenanceBadge(row)}
                ${manualOffBadge(row)}
                <div class="iot-control-buttons">
                  <button class="${commandButtonClass(row, "ON")}"${commandButtonDisabled(row, "ON")} onclick="iotSendDownlink('${escapeHtml(row.devEui)}','ON')">ON</button>
                  <button class="${commandButtonClass(row, "AUTO")}"${commandButtonDisabled(row, "AUTO")} onclick="iotSetAutoMode('${escapeHtml(row.devEui)}', true)">AUTO</button>
                  <button class="${commandButtonClass(row, "OFF")}"${commandButtonDisabled(row, "OFF")} onclick="iotSendDownlink('${escapeHtml(row.devEui)}','OFF')">OFF</button>
                </div>
              </td>
            </tr>
          `).join("") : `
            <tr>
              <td colspan="15" style="padding:42px;text-align:center;color:#94a3b8">
                IoT хэмжилтийн мэдээлэл хараахан ирээгүй байна.
              </td>
            </tr>
          `}
        </tbody>
      </table>
    </div>`;
}

function iotStats() {
  const total = _iotRows.length;
  const online = _iotRows.filter(r => isDeviceOnline(r)).length;
  const offline = total - online;
  const supplyOn = _iotRows.filter(r => hasLinePower(r)).length;
  const supplyOff = Math.max(0, total - supplyOn);
  const on = _iotRows.filter(r => relayState(r) === "on").length;
  const off = _iotRows.filter(r => relayState(r) === "off").length;
  const unknown = Math.max(0, total - on - off);
  const power = _iotRows.reduce((sum, r) => sum + (Number(iotNumericValue(r, "power")) || 0), 0);
  const energy = _iotRows.reduce((sum, r) => sum + (Number(iotNumericValue(r, "energy")) || 0), 0);
  const rssiVals = _iotRows.map(r => Number(r.rssi)).filter(Number.isFinite);
  const avgRssi = rssiVals.length ? rssiVals.reduce((a, b) => a + b, 0) / rssiVals.length : null;
  return { total, online, offline, supplyOn, supplyOff, on, off, unknown, power, energy, avgRssi };
}

function reportPeriodLabel(period) {
  return ({
    night: "Өнгөрсөн шөнө",
    today: "Өнөөдөр",
    "7d": "7 хоног",
    month: "Энэ сар",
    year: "Энэ жил",
  })[period] || period;
}

function reportEventText(event) {
  if (!event) return "-";
  if (event.type === "command") return `${event.action || "-"} command · ${event.status || "-"}`;
  if (event.type === "relay_change") return `Төлөв ${event.state || "-"} болсон · ${fmtNum(event.power, 3, " kW")}`;
  return event.type || "-";
}

function renderOperatorSummary() {
  const summary = _iotReport?.operatorSummary || {};
  const events = summary.events || [];
  const cards = [
    ["Power", summary.powerEvents || 0, "tasralt/sergelt", "#f59e0b"],
    ["Auto", summary.autoCommands || 0, "ERP command", "#2563eb"],
    ["Problem", summary.lightProblems || 0, "asah yostoi ued untarsan", "#dc2626"],
    ["Recovered", summary.recovered || 0, "dahin assan", "#16a34a"],
  ];
  return `<div class="iot-panel iot-operator-summary">
    <div class="iot-panel-head">
      <div>
        <div class="iot-panel-title">Operatoriin ugluunii shuniin dugnelt</div>
        <div class="iot-map-sub">Power tasralt, auto recovery, ON/OFF command, gerel sergesen eseh</div>
      </div>
      <span>${events.length} event</span>
    </div>
    <div class="iot-operator-cards">
      ${cards.map(([label, value, sub, color]) => `
        <div class="iot-report-card" style="--accent:${color}">
          <span>${label}</span>
          <b>${value}</b>
          <i>${sub}</i>
        </div>
      `).join("")}
    </div>
    <div class="iot-operator-timeline">
      ${events.length ? events.slice(-18).reverse().map(e => `
        <div class="iot-operator-event is-${escapeHtml(e.severity || "info")}">
          <time>${fmtDate(e.at)}</time>
          <b>${fmtText(e.deviceName)}</b>
          <span>${fmtText(e.message)}</span>
        </div>
      `).join("") : `<div class="iot-empty-dark">Songoson hugatsaand operator anhaarah event alga.</div>`}
    </div>
  </div>`;
}

function chartTimeLabel(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("mn-MN", { hour: "2-digit", minute: "2-digit" });
}

function renderUsageChart() {
  const series = _iotSeries?.series || [];
  if (!_iotSeries) return `<div class="iot-chart-empty">График ачааллаж байна...</div>`;
  if (!series.length) return `<div class="iot-chart-empty">Сонгосон хугацаанд график үүсгэх бичлэг алга.</div>`;
  const w = 860, h = 260, pl = 46, pr = 18, pt = 18, pb = 38;
  const cw = w - pl - pr, ch = h - pt - pb;
  const maxKw = Math.max(0.1, ...series.map(p => Number(p.avgPowerKw) || 0));
  const xOf = i => pl + (series.length === 1 ? cw / 2 : (i / (series.length - 1)) * cw);
  const yKw = v => pt + ch - ((Number(v) || 0) / maxKw) * ch;
  const yPct = v => pt + ch - ((Number(v) || 0) / 100) * ch;
  const powerPts = series.map((p, i) => `${xOf(i).toFixed(1)},${yKw(p.avgPowerKw).toFixed(1)}`).join(" ");
  const onPts = series.map((p, i) => `${xOf(i).toFixed(1)},${yPct(p.onPct).toFixed(1)}`).join(" ");
  const ticks = series.filter((_, i) => series.length <= 10 || i % Math.ceil(series.length / 8) === 0 || i === series.length - 1);
  return `<div class="iot-chart-wrap">
    <svg class="iot-usage-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="IoT хэрэглээний график">
      <path d="M${pl} ${pt} V${pt + ch} H${pl + cw}" fill="none" stroke="#b8c7d6"/>
      ${[0, .25, .5, .75, 1].map(r => {
        const y = pt + ch - r * ch;
        return `<path d="M${pl} ${y} H${pl + cw}" stroke="#d5e0ea" stroke-width="1"/><text x="8" y="${y + 4}" font-size="10" fill="#58728b">${fmtNum(maxKw * r, 2)}</text>`;
      }).join("")}
      <polyline points="${onPts}" fill="none" stroke="#94a3b8" stroke-width="2" stroke-dasharray="5 4"/>
      <polyline points="${powerPts}" fill="none" stroke="#1f6fb2" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      ${series.map((p, i) => {
        const x = xOf(i), y = yKw(p.avgPowerKw);
        return `<circle cx="${x}" cy="${y}" r="4" fill="#1f6fb2"><title>${chartTimeLabel(p.bucketStart)} · ${fmtNum(p.avgPowerKw, 3, " kW")} · ON ${fmtNum(p.onPct, 1, "%")} · ${p.samples} sample</title></circle>`;
      }).join("")}
      ${ticks.map((p, i) => `<text x="${xOf(series.indexOf(p))}" y="${h - 12}" text-anchor="${i === 0 ? "start" : "middle"}" font-size="10" fill="#58728b">${chartTimeLabel(p.bucketStart)}</text>`).join("")}
      <text x="${pl}" y="12" font-size="11" fill="#1f6fb2" font-weight="800">kW</text>
      <text x="${pl + 42}" y="12" font-size="11" fill="#64748b" font-weight="800">--- ON%</text>
    </svg>
  </div>`;
}

function renderTimeseriesPanel(devices) {
  const selected = _iotChartDevEui || devices[0]?.devEui || "";
  if (!_iotChartDevEui && selected) _iotChartDevEui = selected;
  return `<div class="iot-panel">
    <div class="iot-panel-head">
      <div>
        <div class="iot-panel-title">Цагийн интервалын график</div>
        <div class="iot-map-sub">ADW төхөөрөмж сонгоод хэрэглээ, асаалттай хувь, хэмжилтийн интервалаар харна.</div>
      </div>
      <div class="iot-chart-controls">
        <select onchange="iotSetChartDevice(this.value)">
          ${devices.map(d => `<option value="${escapeHtml(d.devEui)}" ${selected === d.devEui ? "selected" : ""}>${fmtText(d.deviceName)}</option>`).join("")}
        </select>
        <select onchange="iotSetChartBucket(this.value)">
          ${[5, 15, 30, 60].map(v => `<option value="${v}" ${Number(_iotChartBucket) === v ? "selected" : ""}>${v} мин</option>`).join("")}
        </select>
      </div>
    </div>
    ${renderUsageChart()}
  </div>`;
}

function renderReportPanel() {
  if (!_iotReport) {
    return `<div class="iot-panel" style="min-height:360px;display:flex;align-items:center;justify-content:center;color:#58728b;font-weight:900">Тайлан ачааллаж байна...</div>`;
  }
  const totals = _iotReport.totals || {};
  const devices = _iotReport.devices || [];
  const cards = [
    ["Төхөөрөмж", totals.devices || 0, `${totals.samples || 0} бичлэг`, "#2563eb"],
    ["Асаалттай хувь", fmtNum(totals.onPct, 1, "%"), "sample дээр үндэслэв", "#16a34a"],
    ["Хэрэглээ", fmtNum(totals.energyDeltaKwh, 3, " kWh"), _iotReport.label || reportPeriodLabel(_iotReportPeriod), "#f59e0b"],
    ["Max хүчин чадал", fmtNum(totals.maxCapacityKw, 2, " kW"), "гэрэл × ватт", "#8b5cf6"],
    ["Ассан гэрэл", `${fmtNum(totals.estimatedLitLamps, 1)} (${fmtNum(totals.estimatedLitPct, 1, "%")})`, "бодит kW-оос", "#06b6d4"],
    ["Schedule нийцэл", fmtNum(totals.scheduleMatchPct, 1, "%"), "цаг тохиргоотой тулгав", "#64748b"],
  ];
  const events = devices.flatMap(d => (d.events || []).map(e => ({ ...e, deviceName: d.deviceName })))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, 12);
  return `<div class="iot-report">
    <div class="iot-report-toolbar">
      <div>
        <div class="iot-panel-title">IoT хэрэглээ, асаалтын тайлан</div>
        <div class="iot-map-sub">${fmtDate(_iotReport.from)} - ${fmtDate(_iotReport.to)} · ${_iotReport.timezone || "Asia/Ulaanbaatar"}</div>
      </div>
      <div class="iot-report-periods">
        ${["night", "today", "7d", "month", "year"].map(p => `
          <button class="${_iotReportPeriod === p ? "is-active" : ""}" onclick="iotSetReportPeriod('${p}')">${reportPeriodLabel(p)}</button>
        `).join("")}
      </div>
    </div>
    <div class="iot-report-cards">
      ${cards.map(([label, value, sub, color]) => `
        <div class="iot-report-card" style="--accent:${color}">
          <span>${label}</span>
          <b>${value}</b>
          <i>${sub}</i>
        </div>
      `).join("")}
    </div>
    ${renderOperatorSummary()}
    ${renderTimeseriesPanel(devices)}
    <div class="iot-report-grid">
      <div class="iot-panel">
        <div class="iot-panel-head"><div class="iot-panel-title">ADW төхөөрөмж бүрийн дүн</div><span>${devices.length} төхөөрөмж</span></div>
        <div class="iot-table-wrap">
          <table class="iot-meter-table iot-report-table">
            <thead><tr>
              ${["Төхөөрөмж","Schedule","Асаалт","Ассан гэрэл","kWh","Дундаж kW","V min/max","A min/max","Sample","Gap","Сүүлд"].map(h => `<th>${h}</th>`).join("")}
            </tr></thead>
            <tbody>${devices.length ? devices.map(d => `
              <tr>
                <td><b>${fmtText(d.deviceName)}</b><div class="iot-payload-inline">${fmtText(d.devEui)}</div></td>
                <td>${fmtText(d.scheduleCategory || d.model)}<div class="iot-payload-inline">${fmtText(d.scheduleOnTime || "—")} - ${fmtText(d.scheduleOffTime || "—")} · ${fmtNum(d.scheduleMatchPct, 1, "%")}</div></td>
                <td><b style="color:#16a34a">${fmtNum(d.onPct, 1, "%")}</b><div class="iot-payload-inline">${d.onSamples || 0}/${d.samples || 0}</div></td>
                <td class="iot-mono"><b>${fmtNum(d.estimatedLitLamps, 1)}</b> / ${fmtNum(d.lampCount, 0)}<div class="iot-payload-inline">${fmtNum(d.wattageW, 0, "W")} · max ${fmtNum(d.maxCapacityKw, 2, " kW")}</div></td>
                <td class="iot-mono iot-strong">${fmtNum(d.energyDeltaKwh, 3, " kWh")}</td>
                <td class="iot-mono">${fmtNum(d.avgPowerKw, 3, " kW")}</td>
                <td class="iot-mono">${fmtNum(d.minVoltage, 1, " V")} / ${fmtNum(d.maxVoltage, 1, " V")}</td>
                <td class="iot-mono">${fmtNum(d.minCurrent, 2, " A")} / ${fmtNum(d.maxCurrent, 2, " A")}</td>
                <td class="iot-mono">${d.samples || 0}</td>
                <td class="iot-mono">${d.offlineGaps || 0}${d.maxGapMinutes ? ` · ${fmtNum(d.maxGapMinutes, 0, " мин")}` : ""}</td>
                <td>${fmtDate(d.lastSeen)}</td>
              </tr>
            `).join("") : `<tr><td colspan="11" style="padding:34px;text-align:center;color:#94a3b8">Энэ хугацаанд IoT бичлэг алга.</td></tr>`}</tbody>
          </table>
        </div>
      </div>
      <div class="iot-panel">
        <div class="iot-panel-head"><div class="iot-panel-title">Юу болсон</div><span>${events.length} event</span></div>
        ${events.length ? events.map(e => `
          <div class="iot-report-event">
            <b>${fmtText(e.deviceName)}</b>
            <span>${reportEventText(e)}</span>
            <time>${fmtDate(e.at)}</time>
          </div>
        `).join("") : `<div class="iot-empty-dark">Энэ хугацаанд command эсвэл төлөв солигдсон event алга.</div>`}
      </div>
    </div>
  </div>`;
}

function pct(part, total) {
  if (!total) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

function renderCommandKpis() {
  const s = iotStats();
  const cards = [
    ["Нийт node", s.total, "100%", "🗼", "#0ea5e9"],
    ["Шит тэжээлтэй", s.supplyOn, pct(s.supplyOn, s.total), "🔌", "#2563eb"],
    ["Гудамж ассан", s.on, pct(s.on, s.total), "💡", "#22c55e"],
    ["Гудамж асаагүй", s.off, pct(s.off, s.total), "⚠", "#f59e0b"],
    ["Сонсогдсон node", s.online, pct(s.online, s.total), "📍", "#8b5cf6"],
    ["Нийт эрчим хүч", fmtNum(s.power, 2, " kW"), "Одоогоор", "⚡", "#06b6d4"],
    ["Өнөөдрийн хэмжилт", fmtNum(s.energy, 2, " kWh"), s.energy ? "+ live" : "хүлээгдэж байна", "⌂", "#2563eb"],
  ];
  return `<div class="iot-command-kpis">
    ${cards.map(([label, value, sub, icon, color]) => `
      <div class="iot-command-kpi">
        <div class="iot-kpi-icon" style="--kpi:${color}">${icon}</div>
        <div>
          <div class="iot-kpi-label">${label}</div>
          <div class="iot-kpi-value">${value}</div>
          <div class="iot-kpi-sub">${sub}</div>
        </div>
      </div>
    `).join("")}
  </div>`;
}

function renderCategoryCards() {
  const s = iotStats();
  const online = s.online;
  const offline = s.offline;
  const groups = [
    ["IoT node / ADW300 380V · ADW310 220V", s.total, online, offline, "#2563eb", "▥", "Сонсогдсон", "Анхаарах"],
    ["Шитний тэжээл", s.total, s.supplyOn || 0, s.supplyOff || 0, "#2563eb", "🔌", "Тэжээлтэй", "Тэжээлгүй/мэдэгдэхгүй"],
    ["Гудамжны гэрэлтүүлэг", s.total, s.on || 0, s.off || 0, "#22c55e", "⌁", "Ассан", "Асаагүй"],
    ["Node дохионы төлөв", s.total, online, offline, "#8b5cf6", "⌬", "Сонсогдсон", "Дохио тасарсан"],
  ];
  return `<div class="iot-category-stack">
    ${groups.map(([title, total, ok, bad, color, icon, okLabel, badLabel]) => `
      <div class="iot-category-card">
        <div class="iot-category-icon" style="background:${color}">${icon}</div>
        <div class="iot-category-main">
          <div class="iot-panel-title">${title}</div>
          <div class="iot-category-row"><span>Нийт</span><b>${total}</b></div>
          <div class="iot-category-row"><span>${okLabel}</span><b>${ok} (${pct(ok, total)})</b></div>
          <div class="iot-category-row"><span>${badLabel}</span><b>${bad} (${pct(bad, total)})</b></div>
          <div class="iot-progress"><span style="width:${pct(ok, total)};background:${color}"></span><i style="width:${pct(bad, total)}"></i></div>
        </div>
      </div>
    `).join("")}
  </div>`;
}

function deviceScheduleAlert(row) {
  const eui = String(row.devEui || "").toUpperCase();
  const sched = _iotScheduleInfo.find(s => String(s.devEui || "").toUpperCase() === eui);
  const online = isDeviceOnline(row);
  const relay = relayState(row);
  if (!online) return { bad: true, msg: "Дохио тасарсан" };
  if (!sched) {
    if (relay === "off") return { bad: false, msg: "Гэрэл унтарсан (хуваарь тодорхойгүй)" };
    return { bad: false, msg: "Дохио ирсэн" };
  }
  if (sched.scheduled_action === "ON" && relay === "off") return { bad: true, msg: "Асах ёстой цагт гэрэл асаагүй" };
  if (sched.scheduled_action === "ON" && relay === "on") return { bad: false, msg: "Хуваарийн дагуу ассан" };
  if (sched.scheduled_action === "OFF" && relay === "on") {
    const lastCmd = String(row.command_action || "").toUpperCase();
    const lastRole = String(row.command_requested_by_role || "");
    const isOperator = lastRole && lastRole !== "system";
    if (lastCmd === "ON" && isOperator) {
      const operator = row.manualOnOperatorName || row.manualOnOperatorUsername || row.manualOnBy || "-";
      const reasonText = row.manualOnReason || "Шалтгаан бүртгээгүй";
      const noteText = row.manualOnNote ? ` · ${row.manualOnNote}` : "";
      return {
        bad: true,
        msg: "Унтрах ёстой цагт гэрэл асчээ — оператор гараар асаасан",
        detail: `Шалтгаан: ${reasonText}${noteText} · Оператор: ${operator}`,
        reason: "manual_on",
      };
    }
    if (lastCmd === "ON" && lastRole === "system") {
      return { bad: true, msg: "Унтрах ёстой цагт гэрэл асчээ — авт. тушаалаар асаасан", reason: "auto_on" };
    }
    // Сервер ON тушаал өгөөгүй байтал гэрэл асчээ → тогны эх
    return { bad: true, msg: "Хуваарь бус цагт гэрэл асчээ — сервер ON тушаал өгөөгүй", reason: "unexpected_power" };
  }
  return { bad: false, msg: "Хуваарийн дагуу унтарсан" };
}

function renderAlerts() {
  const alertRows = _iotRows.map(r => ({ row: r, alert: deviceScheduleAlert(r) }));
  const bad = alertRows.filter(a => a.alert.bad);
  const source = bad.length ? bad : alertRows.slice(0, 3);
  return `<div class="iot-panel iot-alert-panel">
    <div class="iot-panel-head"><div class="iot-panel-title">Сэрэмжлүүлэг</div><button onclick="iotSetView('list')">Бүгдийг харах →</button></div>
    ${source.length ? source.map(({ row, alert }) => `<div class="iot-alert-row">
        <div class="iot-alert-icon ${alert.bad ? "is-bad" : "is-ok"}">${alert.bad ? "!" : "✓"}</div>
        <div>
          <b>${fmtText(row.deviceName)}</b>
          <span>${escapeHtml(alert.msg)}</span>
          ${alert.detail ? `<small>${escapeHtml(alert.detail)}</small>` : ""}
        </div>
        <time>${fmtDate(row.last_seen)}</time>
      </div>`).join("") : `<div class="iot-empty-dark">Мэдээлэл алга</div>`}
  </div>`;
}

function renderEnergyChart() {
  const vals = _iotRows.slice(0, 18).map(r => Number(iotNumericValue(r, "power")) || 0);
  const data = vals.length ? vals : [0.2, 0.35, 0.25, 0.5, 0.42, 0.6, 0.4];
  const max = Math.max(...data, 0.1);
  const points = data.map((v, i) => {
    const x = 18 + (i * (264 / Math.max(1, data.length - 1)));
    const y = 112 - (v / max) * 82;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return `<div class="iot-panel">
    <div class="iot-panel-head"><div class="iot-panel-title">Эрчим хүчний хэрэглээ</div><span>live</span></div>
    <svg class="iot-line-chart" viewBox="0 0 300 130" aria-label="Эрчим хүчний хэрэглээ">
      <path d="M18 112 H286 M18 84 H286 M18 56 H286 M18 28 H286" stroke="rgba(148,163,184,.16)" stroke-width="1"/>
      <polyline points="${points}" fill="none" stroke="#38bdf8" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      ${points.split(" ").map(p => {
        const [x, y] = p.split(",");
        return `<circle cx="${x}" cy="${y}" r="3" fill="#38bdf8"/>`;
      }).join("")}
    </svg>
  </div>`;
}

function renderStatusDonut() {
  const s = iotStats();
  const onPct = s.total ? Math.round((s.on / s.total) * 100) : 0;
  const offPct = Math.max(0, 100 - onPct);
  return `<div class="iot-panel iot-donut-panel">
    <div class="iot-panel-title">Гудамжны гэрэлтүүлгийн төлөв</div>
    <div class="iot-donut-wrap">
      <div class="iot-donut" style="background:conic-gradient(#22c55e 0 ${onPct}%, #f59e0b ${onPct}% ${onPct + Math.round(offPct / 2)}%, #ef4444 ${onPct + Math.round(offPct / 2)}% 100%)">
        <div><b>${s.total}</b><span>Нийт</span></div>
      </div>
      <div class="iot-donut-legend">
        <span><i style="background:#22c55e"></i>Ассан <b>${s.on || 0}</b></span>
        <span><i style="background:#f59e0b"></i>Асаагүй <b>${s.off || 0}</b></span>
        <span><i style="background:#ef4444"></i>Дохио тасарсан <b>${s.offline}</b></span>
      </div>
    </div>
  </div>`;
}

function renderErpSyncPanel() {
  const rows = _iotRows.slice(0, 4);
  return `<div class="iot-panel">
    <div class="iot-panel-head"><div class="iot-panel-title">ERP холболт - хэмжилт</div><button onclick="iotSetView('list')">Дэлгэрэнгүй →</button></div>
    <table class="iot-dark-table">
      <thead><tr><th>Төхөөрөмж</th><th>Хэрэглээ</th><th>Төлөв</th></tr></thead>
      <tbody>${rows.length ? rows.map(r => `
        <tr>
          <td>${fmtText(r.deviceName)}</td>
          <td>${fmtNum(iotNumericValue(r, "energy"), 2, " kWh")}</td>
          <td><span class="${isDeviceOnline(r) ? "ok" : "bad"}">${isDeviceOnline(r) ? "Ирсэн" : "Тасарсан"}</span></td>
        </tr>
      `).join("") : `<tr><td colspan="3">Мэдээлэл алга</td></tr>`}</tbody>
    </table>
  </div>`;
}

function renderWeatherLikePanel() {
  const s = iotStats();
  const scheduleRows = _iotScheduleInfo.map(info => {
    if (info.is_always_off) return `<span>${escapeHtml(info.category)}</span><b style="color:#dc2626">Унтраалттай</b>`;
    const on = info.on_time || "—";
    const off = info.off_time || "—";
    return `<span>${escapeHtml(info.category)}</span><b>${on} → ${off}</b>`;
  }).join("");
  return `<div class="iot-panel iot-weather-panel">
    <div class="iot-panel-title">Системийн байдал</div>
    <div class="iot-weather-main"><span>☀</span><b>${s.avgRssi === null ? "-" : Math.round(s.avgRssi)} dBm</b></div>
    <div class="iot-weather-grid">
      <span>Node дохио</span><b>${s.online}/${s.total} сонсогдсон</b>
      <span>Чадал</span><b>${fmtNum(s.power, 2, " kW")}</b>
      <span>Энерги</span><b>${fmtNum(s.energy, 2, " kWh")}</b>
      ${scheduleRows ? `<span style="grid-column:1/-1;border-top:1px solid #e2e8f0;margin-top:4px;padding-top:6px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;color:#94a3b8">Өнөөдрийн хуваарь</span>${scheduleRows}` : ""}
    </div>
  </div>`;
}

// Shared guide for humans and future AI agents. Keep the AI notes explicit:
// this screen has several similar-looking concepts that must not be merged.
function renderOperatorGuide() {
  return `<details class="iot-guide">
    <summary>
      <span>Заавар, нэр томъёо</span>
      <b>Операторын зөвлөмж + AI техникийн зөвлөмж</b>
    </summary>
    <div class="iot-guide-split">
      <section class="iot-guide-operator">
        <div class="iot-safety-note">
          <b>Аюулгүй ажиллагаа:</b> Өдрийн цагаар ажилчин гэрэл дээр засвар хийх үед оператор ON command зөвхөн шалгалтад хэрэглэнэ. "Унтраа" гэж хэлсэн даруйд OFF дарж, ажил дуусах хүртэл дахин ON бүү дар. ERP command нь газар дээрх физик салгалт, түгжээ/анхааруулах тэмдэглэгээг орлохгүй.
        </div>
        <p><b>Автомат асаалт</b>: schedule recovery нь ON цагийг тухайн өдрийн Чойбалсан хотын "Асаах тохиромжтой" нарны тооцоогоор авна. Унтрах цаг нь баталсан тохиргооны OFF цаг хэвээр байна.</p>
        <p><b>ON / AUTO / OFF</b>: энэ 3 товч нь операторын сонгосон удирдлагын горим. Гудамжинд очиж бодитоор харж чадахгүй тул идэвхтэй товчийг power/current хэмжилтээр автоматаар сольж болохгүй.</p>
        <p><b>ON сонголт</b>: оператор шууд асаах command илгээнэ. Энэ үед node MANUAL горимд орж schedule түр идэвхгүй болно.</p>
        <p><b>OFF сонголт</b>: оператор шалтгаан сонгоод унтраах command илгээнэ. OFF болсон node дээр MANUAL OFF badge харагдаж, AUTO дарахаас нааш schedule буцааж асаахгүй.</p>
        <p><b>Засвар горим</b>: OFF шалтгаанаас "Засвар" сонговол ЗАСВАР ГОРИМ идэвхжинэ. Энэ үед auto-recovery тухайн node-г огт хөндөхгүй, ON command хаагдана.</p>
        <p><b>AUTO сонголт</b>: node-г schedule горимд буцаана. AUTO дарсны дараа тухайн цагийн schedule-тай тааруулж сервер ON эсвэл OFF command явуулж болно.</p>
        <p><b>ГЭРЭЛ АССАН/АСААГҮЙ</b>: энэ бол бодит хэмжилтийн badge. Харин <b>Сонголт: ON/AUTO/OFF</b> бол операторын удирдлагын горим. Энэ хоёрыг андуурч болохгүй.</p>
        <p><b>Команд баталгаажаагүй</b>: LoRa/төхөөрөмж ACK ирээгүй гэсэн үг. Энэ үед сонгосон горим хэвээр үлдэнэ, оператор дахин шалгаж command илгээх эсэхээ шийднэ.</p>
        <h3>Операторын зөвлөмж</h3>
        <p><b>Node</b> бол шитэнд суусан ADW300/310 төхөөрөмжийн бүртгэл.</p>
        <p><b>ADW оноох</b> товчоор тухайн шитэнд физикээр суусан төхөөрөмжийг сонгоно.</p>
        <p><b>Сонсогдсон node</b> бол сүүлийн 10 минутанд төхөөрөмжөөс дохио ERP-д ирсэн гэсэн үг.</p>
        <p><b>Шит тэжээлтэй</b> бол шитний оролтын талд хүчдэл байна. Энэ нь гудамжны гэрэл ассан гэсэн үг биш.</p>
        <p><b>Гудамж ассан</b> бол тухайн шитнээс гарч байгаа гудамжны гэрэлтүүлэг хэрэглээ авч байна.</p>
        <p><b>Шонгийн өнгө</b>: гудамж ассан бол шон шар, асаагүй эсвэл тэжээл холбогдоогүй бол саарал.</p>
        <p><b>Нэг гудамж олон шиттэй</b> байж болно. Жишээ нь 1-44 шон нэг шит, 45-76 шон өөр шитээр тусдаа ажиллана.</p>
        <p><b>Ажлын дараалал</b>: эхлээд трасс, шон үүсгэнэ. Дараа нь шаардлагатай бол segment болгон тасална. Тэгээд тэжээлийн цэгээ байрлуулж segment-тэй холбоно. Эцэст нь тухайн шитэнд суусан ADW node-ийг онооно.</p>
        <p><b>Анхаарах</b>: шитэнд хүчдэл байна гэдэг нь гудамж ассан гэсэн үг биш. Гудамж ассан эсэхийг тухайн шитнээс гарах гэрэлтүүлгийн хэрэглээгээр ойлгоно.</p>
      </section>
      <section class="iot-guide-ai">
        <div class="iot-safety-note">
          <b>Safety rule for AI:</b> Schedule recovery ignores manual ON/OFF hold decisions. It sends ON during the schedule ON window and sends OFF only near the registered OFF boundary; daytime maintenance commands remain under operator/engineer control.
        </div>
        <p><b>Auto schedule rule</b>: recovery uses Choibalsan daily suitable sunlight ON time for the ON boundary, while OFF comes from the registered schedule off_time boundary only.</p>
        <p><b>Control mode source</b>: <code>iot_device_settings.auto_mode</code> is the source of truth for AUTO vs MANUAL. When <code>auto_mode=0</code>, the active ON/OFF selection comes from the latest operator command, not from measured load.</p>
        <p><b>Manual OFF hold</b>: manual OFF stores <code>manual_off_reason</code>, <code>manual_off_by</code>, and <code>manual_off_at</code>. Recovery must skip schedule commands while <code>auto_mode=0</code>; only the AUTO endpoint clears manual OFF fields.</p>
        <p><b>Maintenance hard lock</b>: when OFF reason is <code>maintenance</code>, set <code>maintenance_mode=1</code>. Recovery must skip it even if <code>auto_mode</code> is accidentally wrong, and the downlink endpoint must reject ON while this flag is active.</p>
        <p><b>Measured relay state</b>: <code>relayState()</code> and report <code>isReadingOn()</code> must prioritize <code>power/totalP</code> and <code>current/Ia</code>. Use <code>DO_State</code> only when numeric load values are missing.</p>
        <p><b>DO_State fallback</b>: current ADW data is interpreted as <code>DO_State=1</code> ON and <code>DO_State=0</code> OFF. Do not invert this, otherwise OFF samples appear as false ON/OFF transitions in the report.</p>
        <p><b>Command ACK rule</b>: <code>ack_failed</code> and <code>failed</code> are warning states only. They must not automatically change <code>auto_mode</code>, clear manual OFF, or switch the operator's selected button.</p>
        <p><b>Report event rule</b>: ON/OFF timeline events are generated from measured state changes. Operator commands are separate command events; do not merge command intent with physical measured state.</p>
        <h3>AI техникийн зөвлөмж</h3>
        <p><b>Энэ хэсгийн файл</b>: <code>public/modules/iot_monitor.js</code>. Гол функцүүд: <code>isDeviceOnline</code>, <code>hasLinePower</code>, <code>relayState</code>, <code>iotStats</code>, <code>iotSegmentVisualStatus</code>, <code>poleSegmentStatus</code>, <code>iotControllerForSegment</code>.</p>
        <p><b>Backend эх сурвалж</b>: <code>/api/iot/devices</code> нь <code>routes/iot.js</code>-ийн <code>latestDeviceSelect()</code>-оос ирнэ. <code>last_seen</code> нь latest <code>iot_meter_readings.received_at</code>.</p>
        <p><b>Сонсогдсон node</b>: <code>Date.now() - last_seen <= 10 минут</code>. Энэ нь <code>sl_feed_point_device</code>-ийн ADW оноолтоос тусдаа ойлголт.</p>
        <p><b>ADW оноолт</b>: <code>sl_feed_point_device.feed_point_id + dev_eui</code>. Тэжээлийн цэгийг кабель segment-тэй <code>sl_feeder_cable.feed_point_id + cable_segment_id</code>-ээр холбоно.</p>
        <p><b>Шит тэжээлтэй</b>: <code>hasLinePower()</code> нь <code>voltage/Ua</code> 1V-оос дээш эсэхийг харна. Үүнийг гудамж ассан гэж бүү ашигла.</p>
        <p><b>Гудамж ассан</b>: <code>relayState()</code> нь <code>power/totalP/current/Ia</code> босго давсан эсэхийг харна. Энэ нь гаралтын талд хэрэглээ үүссэн гэсэн UI утгатай.</p>
        <p><b>Шонгийн өнгө</b>: <code>poleSegmentStatus()</code> нь тухайн pole-ийн дугаар <code>segment.pole_start..pole_end</code> range-д орсон segment-ийг олно. Segment нь ADW-тэй бол <code>relayState</code>-ээр бүх range шар/саарал болно. ADW холбоогүй бол саарал.</p>
        <p><b>Чухал дүрэм</b>: нэг route нэртэй гудамж олон cable segment-тэй байж болно. Segment бүр өөр feed point, өөр ADW node-той байж болох тул гудамжийг бүхэлд нь нэг state-ээр будаж болохгүй.</p>
        <p><b>Ажлын талбарын pipeline</b>: route/corridor зурна → poles үүсгэнэ → cable segment үүсгэнэ эсвэл <code>Таслах</code> горимоор range салгана → feed point байрлуулна → <code>sl_feeder_cable</code>-аар feed point-ийг segment-тэй холбоно → <code>sl_feed_point_device</code>-ээр ADW node онооно → uplink ирэхэд KPI болон pole color шинэчлэгдэнэ.</p>
        <p><b>Do not break</b>: <code>hasLinePower()</code> бол шитний оролтын хүчдэл, <code>relayState()</code> бол гудамжны гаралтын хэрэглээ. Эдгээрийг нэгтгэж болохгүй. Тэжээлгүй/unassigned segment default саарал байх ёстой.</p>
        <p><b>Webhook</b>: ChirpStack HTTP integration URL <code>/api/iot/chirpstack/uplink</code>, header <code>X-IOT-SECRET</code> шаардлагатай. Header алга бол ERP-д uplink орохгүй, node сонсогдохгүй.</p>
      </section>
    </div>
  </details>`;
}

function renderNodeLivePanel() {
  if (!_iotRows.length) return "";
  return `<div class="iot-panel iot-node-live-panel">
    <div class="iot-panel-head">
      <div class="iot-panel-title">Node хэмжилт</div>
      <span>${_iotRows.length} node</span>
    </div>
    <div class="iot-node-live-list">
      ${_iotRows.map(row => {
        const online = isDeviceOnline(row);
        const relay = relayState(row);
        const relayColor = relay === "on" ? "#16a34a" : relay === "off" ? "#dc2626" : "#64748b";
        const relayLabel = relay === "on" ? "ГЭРЭЛ АССАН" : relay === "off" ? "ГЭРЭЛ АСААГҮЙ" : "ТӨЛӨВ ТОДОРХОЙГҮЙ";
        return `<div class="iot-node-live-row">
          <div class="iot-node-live-top">
            <span class="iot-node-live-name">${fmtText(row.deviceName)}</span>
            <span class="iot-node-live-badge" style="background:${online ? "#dcfce7" : "#fee2e2"};color:${online ? "#166534" : "#991b1b"}">${online ? "● Дохио ирсэн" : "○ Тасарсан"}</span>
          </div>
          <div class="iot-node-live-state" style="color:${relayColor}">${relayLabel}</div>
          <div class="iot-node-live-vals">
            <span>${fmtIotValue(row, "voltage", 1, " V")}</span>
            <span>${fmtIotValue(row, "current", 2, " A")}</span>
            <span>${fmtIotValue(row, "power", 3, " kW")}</span>
            <span>${fmtIotValue(row, "energy", 3, " kWh")}</span>
          </div>
          <div class="iot-node-live-time">${fmtDate(row.last_seen)}</div>
        </div>`;
      }).join("")}
    </div>
  </div>`;
}

function renderCommandDashboard() {
  return `
    <div class="iot-command-dashboard">
      ${renderCommandKpis()}
      <div class="iot-command-grid">
        <main>${renderMapPanel({ editable: false })}</main>
        <aside>${renderAlerts()}${renderNodeLivePanel()}${renderWeatherLikePanel()}</aside>
      </div>
    </div>`;
}

function rawPayloadObject(row) {
  try {
    return JSON.parse(row?.rawPayload || "{}") || {};
  } catch (_) {
    return {};
  }
}

function base64ToHex(value) {
  try {
    return Array.from(atob(String(value || "")), ch =>
      ch.charCodeAt(0).toString(16).padStart(2, "0")
    ).join("");
  } catch (_) {
    return "";
  }
}

function rawDataHex(row) {
  const raw = rawPayloadObject(row);
  return raw.data_hex || raw.dataHex || base64ToHex(raw.data || raw.frm_payload || "");
}

function decodedPayloadSummary(row) {
  const raw = rawPayloadObject(row);
  const obj = raw.object || raw.decodedData || raw.objectJSON || {};
  const entries = Object.entries(obj || {})
    .filter(([, v]) => v !== null && v !== undefined && typeof v !== "object");
  if (entries.length) {
    return entries.slice(0, 12).map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(String(v))}`).join(" · ");
  }
  const hex = rawDataHex(row);
  if (hex) return `Raw HEX: ${escapeHtml(hex.slice(0, 140))}${hex.length > 140 ? "..." : ""}`;
  return "Decoder object ирээгүй";
}

function pickNumber(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function deepFindNumber(obj, keys) {
  if (!obj || typeof obj !== "object") return null;
  const wanted = new Set(keys.map(k => String(k).toLowerCase()));
  const stack = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    for (const [key, value] of Object.entries(cur)) {
      if (wanted.has(String(key).toLowerCase())) {
        const n = Number(value);
        if (Number.isFinite(n)) return n;
      }
      if (value && typeof value === "object") stack.push(value);
    }
  }
  return null;
}

function isChoibalsanCoord(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= 47 && lat <= 49.5 &&
    lng >= 113 && lng <= 116.5;
}

function fallbackCoord(row, index) {
  const baseLat = 48.0789;
  const baseLng = 114.5357;
  const text = `${row?.devEui || ""}${row?.deviceName || ""}`;
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  const angle = ((hash % 360) * Math.PI) / 180;
  const radius = 0.006 + (index % 6) * 0.002;
  return {
    lat: baseLat + Math.sin(angle) * radius,
    lng: baseLng + Math.cos(angle) * radius,
    estimated: true,
  };
}

function coordForRow(row, index) {
  const raw = rawPayloadObject(row);
  const obj = raw.object || {};
  const deviceInfo = raw.deviceInfo || {};
  const manualLat = pickNumber(row?.manualLat, row?.manual_lat);
  const manualLng = pickNumber(row?.manualLng, row?.manual_lng);
  if (manualLat !== null && manualLng !== null && isChoibalsanCoord(manualLat, manualLng)) {
    return { lat: manualLat, lng: manualLng, estimated: false, source: "manual" };
  }
  const lat = pickNumber(
    row?.lat, row?.latitude, row?.gps_lat, row?.gpsLat,
    obj.lat, obj.latitude, obj.gps_lat, obj.gpsLat,
    deviceInfo.lat, deviceInfo.latitude
  );
  const lng = pickNumber(
    row?.lng, row?.lon, row?.long, row?.longitude, row?.gps_lng, row?.gpsLon,
    obj.lng, obj.lon, obj.long, obj.longitude, obj.gps_lng, obj.gpsLon,
    deviceInfo.lng, deviceInfo.lon, deviceInfo.longitude
  );
  if (lat !== null && lng !== null && isChoibalsanCoord(lat, lng)) {
    return { lat, lng, estimated: false, source: "payload" };
  }
  return fallbackCoord(row, index);
}

function coordForStoredPoint(row) {
  const lat = pickNumber(row?.gps_lat, row?.gpsLat, row?.lat, row?.latitude);
  const lng = pickNumber(row?.gps_lng, row?.gpsLng, row?.lng, row?.lon, row?.longitude);
  if (lat !== null && lng !== null && isChoibalsanCoord(lat, lng)) return { lat, lng };
  return null;
}

function gatewayLocationsFromRows(rows) {
  const byGateway = new Map();
  (rows || []).forEach(row => {
    const raw = rawPayloadObject(row);
    const rxList = Array.isArray(raw.rxInfo) ? raw.rxInfo : [];
    rxList.forEach(rx => {
      const loc = rx?.location || {};
      const lat = pickNumber(loc.latitude, loc.lat, rx.latitude, rx.lat);
      const lng = pickNumber(loc.longitude, loc.lng, loc.lon, rx.longitude, rx.lng, rx.lon);
      if (lat === null || lng === null || !isChoibalsanCoord(lat, lng)) return;
      const gatewayId = String(rx.gatewayId || rx.gateway_id || rx.gwId || `${lat.toFixed(6)},${lng.toFixed(6)}`);
      const prev = byGateway.get(gatewayId) || {
        gatewayId,
        lat,
        lng,
        rssi: null,
        snr: null,
        seen: 0,
        devices: new Set(),
        lastSeen: null,
      };
      prev.lat = lat;
      prev.lng = lng;
      prev.rssi = pickNumber(rx.rssi, prev.rssi);
      prev.snr = pickNumber(rx.snr, prev.snr);
      prev.seen += 1;
      if (row?.devEui) prev.devices.add(String(row.devEui).toUpperCase());
      if (!prev.lastSeen || String(row?.last_seen || "") > String(prev.lastSeen || "")) prev.lastSeen = row?.last_seen || null;
      byGateway.set(gatewayId, prev);
    });
  });
  return Array.from(byGateway.values()).map(gw => ({ ...gw, devices: Array.from(gw.devices) }));
}

function normIotText(value) {
  return String(value || "").trim().toLowerCase();
}

function findIotForMeter(point) {
  const meter = normIotText(point?.meter_no);
  const name = normIotText(point?.name);
  const location = normIotText(point?.location);
  return _iotRows.find(row => {
    const hay = normIotText(`${row.devEui || ""} ${row.deviceName || ""} ${row.applicationName || ""}`);
    return (meter && hay.includes(meter)) ||
      (name && name.length > 2 && hay.includes(name)) ||
      (location && location.length > 4 && hay.includes(location));
  }) || null;
}

function iotStateColor(row) {
  if (!row) return "#f59e0b";
  if (!isDeviceOnline(row)) return "#ef4444";
  const state = relayState(row);
  if (state === "on") return "#22c55e";
  if (state === "off") return "#ef4444";
  return "#2563eb";
}

function iotStateLabel(row) {
  if (!row) return "Холбоогүй";
  if (!isDeviceOnline(row)) return "Дохио тасарсан";
  const state = relayState(row);
  if (state === "on") return "Гэрэл ассан";
  if (state === "off") return "Гэрэл асаагүй";
  return "Дохио ирсэн";
}

function meterPopup(point, row) {
  return `
    <div class="iot-map-popup">
      <div style="font-weight:900;color:#0f172a;margin-bottom:4px">Шит / тоолуур</div>
      <div style="font-size:13px;font-weight:900;color:#1f6fb2">${fmtText(point.name || point.meter_no || "Тоолуур")}</div>
      <div style="font-family:Consolas,monospace;font-size:11px;color:#64748b;margin-top:3px">${fmtText(point.meter_no || "")}</div>
      <div style="font-size:12px;color:#475569;margin-top:6px">${fmtText(point.location || "")}</div>
      <div style="margin-top:8px;font-size:12px">Төлөв: <b style="color:${iotStateColor(row)}">${iotStateLabel(row)}</b></div>
      ${row ? `<div style="font-size:11px;color:#64748b;margin-top:4px">${fmtText(row.deviceName)} · ${fmtNum(iotNumericValue(row, "power"), 3, " kW")}</div>` : ""}
    </div>
  `;
}

function lightPointPopup(point, row) {
  return `
    <div class="iot-map-popup">
      <div style="font-weight:900;color:#0f172a;margin-bottom:4px">Гэрлийн цэг</div>
      <div style="font-size:13px;font-weight:900;color:#1f6fb2">${fmtText(point.name || point.code || "Гэрэл")}</div>
      <div style="font-family:Consolas,monospace;font-size:11px;color:#64748b;margin-top:3px">${fmtText(point.code || point.meter_no || "")}</div>
      <div style="font-size:12px;color:#475569;margin-top:6px">${fmtText(point.location || "")}</div>
      <div style="margin-top:8px;font-size:12px">Гэрэл: <b>${Number(point.total_heads || point.head_count || point.lamp_count || 1)}</b></div>
      <div style="font-size:12px">Тэжээл: <b style="color:${iotStateColor(row)}">${iotStateLabel(row)}</b></div>
    </div>
  `;
}

function employeeMapCoord(loc) {
  const coord = coordForStoredPoint(loc);
  if (!coord) return null;
  const accuracy = Number(loc?.accuracy);
  return { ...coord, accuracy: Number.isFinite(accuracy) ? accuracy : null };
}

function mapDistanceText(meters) {
  const n = Number(meters);
  if (!Number.isFinite(n)) return "-";
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)} км`;
  return `${Math.round(n)} м`;
}

function employeeNearbyTargets(coord, limit = 4) {
  if (!_iotMap || !coord) return [];
  const targets = [];
  const addTarget = (type, name, coordLike, extra = "") => {
    const c = coordForStoredPoint(coordLike);
    if (!c) return;
    targets.push({
      type,
      name: name || "-",
      extra,
      distance: _iotMap.distance([coord.lat, coord.lng], [c.lat, c.lng]),
    });
  };
  _iotNetworkPoles.forEach(p => addTarget("Шон", p.display_code || p.name || `#${p.pole_no || p.id}`, p, p.status || ""));
  _iotFeedPoints.forEach(fp => addTarget("Тэжээлийн цэг", fp.name || `#${fp.id}`, fp, fp.type || ""));
  _iotMeterPoints.forEach(p => addTarget("Шит", p.name || p.meter_no || `#${p.id}`, p, p.location || ""));
  _iotLightPoints.forEach(p => addTarget("Гэрэл", p.name || p.code || `#${p.id}`, p, p.location || ""));
  _iotRows.forEach((row, index) => {
    const c = coordForRow(row, index);
    if (!c || c.estimated) return;
    targets.push({
      type: "IoT node",
      name: row.deviceName || row.devEui || "-",
      extra: iotStateLabel(row),
      distance: _iotMap.distance([coord.lat, coord.lng], [c.lat, c.lng]),
    });
  });
  return targets
    .filter(t => Number.isFinite(t.distance))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}

function employeeLocationPopup(loc, coord) {
  const nearby = employeeNearbyTargets(coord);
  const mapsUrl = `https://maps.google.com/?q=${Number(coord.lat)},${Number(coord.lng)}`;
  return `
    <div class="iot-map-popup employee-location-popup" style="min-width:270px;max-width:360px">
      <div style="font-size:10px;font-weight:900;color:#db2777;text-transform:uppercase;letter-spacing:.4px">Ажилтны GPS байршил</div>
      <div style="font-size:14px;font-weight:950;color:#0f172a;margin:4px 0">${fmtText(loc.full_name || "Ажилтан")}</div>
      <div style="font-size:11px;color:#64748b">${fmtText([loc.position, loc.department].filter(Boolean).join(" · "))}</div>
      <div style="display:grid;grid-template-columns:82px 1fr;gap:4px 8px;margin-top:9px;font-size:12px">
        <span style="color:#64748b">Илгээсэн</span><b>${fmtDate(loc.created_at)}</b>
        <span style="color:#64748b">GPS</span><b style="font-family:Consolas,monospace">${fmtNum(coord.lat, 6)}, ${fmtNum(coord.lng, 6)}</b>
        <span style="color:#64748b">Нарийвчлал</span><b>${coord.accuracy === null ? "-" : `±${Math.round(coord.accuracy)} м`}</b>
      </div>
      <div style="border-top:1px solid #e5e7eb;margin-top:10px;padding-top:8px">
        <div style="font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;margin-bottom:5px">Ойролцоох гэрэлтүүлэг</div>
        ${nearby.length ? nearby.map(t => `
          <div style="display:grid;grid-template-columns:72px 1fr auto;gap:6px;align-items:center;font-size:11px;padding:4px 0;border-bottom:1px solid #f1f5f9">
            <span style="color:#64748b">${escapeHtml(t.type)}</span>
            <b style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#172033">${escapeHtml(t.name)}</b>
            <strong style="color:#db2777">${mapDistanceText(t.distance)}</strong>
            ${t.extra ? `<span></span><span style="grid-column:2 / 4;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(t.extra)}</span>` : ""}
          </div>
        `).join("") : `<div style="font-size:12px;color:#94a3b8">Ойролцоох бүртгэлтэй гэрэл/шон олдсонгүй.</div>`}
      </div>
      <div style="display:flex;align-items:center;gap:8px;justify-content:space-between;margin-top:9px">
        <a href="${mapsUrl}" target="_blank" rel="noopener" style="font-size:11px;font-weight:900;color:#2563eb;text-decoration:none">Google Maps дээр нээх</a>
        <button type="button" onclick="iotClearEmployeeLocation(${Number(loc.id || 0)})" style="border:1px solid #f9a8d4;background:#fff1f2;color:#be185d;border-radius:7px;padding:5px 8px;font-size:11px;font-weight:900;cursor:pointer">Ашиглаад устгах</button>
      </div>
    </div>
  `;
}

async function iotClearEmployeeLocation(id) {
  if (!id) return;
  const found = _iotEmployeeLocations.find(loc => Number(loc.id) === Number(id));
  const name = found?.full_name || "Ажилтан";
  if (!confirm(`${name || "Ажилтан"} GPS байршлыг map-аас устгах уу?\n\nОператор ашиглаж дууссан бол устгахад болно.`)) return;
  try {
    await api(`/api/employee-locations/${encodeURIComponent(id)}`, { method: "DELETE" });
    toast("GPS байршил map-аас устлаа");
    await iotRefresh();
  } catch (e) {
    toast(e.message || "GPS байршил устгахад алдаа гарлаа");
  }
}

function employeeLocationIcon(loc) {
  const initials = String(loc?.full_name || loc?.username || "A")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0] || "")
    .join("")
    .toUpperCase() || "A";
  return window.L.divIcon({
    className: "",
    html: `<div class="iot-employee-marker"><span>${escapeHtml(initials)}</span></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -18],
  });
}

function routeGeometry(row) {
  if (Array.isArray(row?.geometry)) return row.geometry;
  try { return JSON.parse(row?.geometry_json || "[]"); } catch (_) { return []; }
}

function poleDistanceAlongRoute(pole, geo, map) {
  if (!map || geo.length < 2 || !pole.gps_lat) return -1;
  let bestSegDist = Infinity, bestAlongDist = 0, cumDist = 0;
  for (let i = 0; i < geo.length - 1; i++) {
    const A = geo[i], B = geo[i + 1];
    const segLen = map.distance([A.lat, A.lng], [B.lat, B.lng]);
    const dA = map.distance([pole.gps_lat, pole.gps_lng], [A.lat, A.lng]);
    const dB = map.distance([pole.gps_lat, pole.gps_lng], [B.lat, B.lng]);
    const t = segLen > 0 ? Math.max(0, Math.min(1, (dA * dA - dB * dB + segLen * segLen) / (2 * segLen * segLen))) : 0;
    const perpDist = Math.sqrt(Math.max(0, dA * dA - (t * segLen) * (t * segLen)));
    if (perpDist < bestSegDist) {
      bestSegDist = perpDist;
      bestAlongDist = cumDist + t * segLen;
    }
    cumDist += segLen;
  }
  return bestAlongDist;
}

function findInventoryForRoute(route) {
  const rname = (route.name || "").trim().toLowerCase();
  return _iotLightPoints.find(lp => {
    const n = (lp.name || lp.location || "").trim().toLowerCase();
    return n && (rname === n || rname.endsWith(" " + n) || rname.includes("- " + n) || n.includes(rname));
  }) || null;
}

function routeCorridorSummary(routeId) {
  const cableSegs = _iotNetworkRoutes.filter(r => r.route_type === "cable" && Number(r.parent_route_id) === routeId);
  if (!cableSegs.length) return "";
  const on = cableSegs.filter(s => (s.segment_status || "on") === "on")
    .reduce((sum, s) => sum + Math.max(0, Number(s.pole_end || 0) - Number(s.pole_start || 0) + 1), 0);
  const off = cableSegs.filter(s => s.segment_status === "off")
    .reduce((sum, s) => sum + Math.max(0, Number(s.pole_end || 0) - Number(s.pole_start || 0) + 1), 0);
  const fault = cableSegs.filter(s => s.segment_status === "fault")
    .reduce((sum, s) => sum + Math.max(0, Number(s.pole_end || 0) - Number(s.pole_start || 0) + 1), 0);
  const partial = cableSegs.filter(s => s.segment_status === "partial")
    .reduce((sum, s) => sum + Math.max(0, Number(s.pole_end || 0) - Number(s.pole_start || 0) + 1), 0);
  const parts = [];
  if (on > 0)      parts.push(`<span style="color:#166534">🟢 ${on} асаалттай</span>`);
  if (off > 0)     parts.push(`<span style="color:#374151">⚫ ${off} унтраалттай</span>`);
  if (fault > 0)   parts.push(`<span style="color:#991b1b">🔴 ${fault} гэмтэлтэй</span>`);
  if (partial > 0) parts.push(`<span style="color:#92400e">🟡 ${partial} хэсэгчилсэн</span>`);
  return `
    <div style="border-top:1px solid #e5e7eb;margin-top:8px;padding-top:7px">
      <div style="font-size:10px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">Сегментийн нийт төлөв · ${cableSegs.length} сегмент</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;font-size:12px;font-weight:700">${parts.join(" · ") || "<span style='color:#94a3b8'>Мэдээлэлгүй</span>"}</div>
    </div>`;
}

function routePopup(row) {
  const geo = routeGeometry(row);
  const routePoles = _iotNetworkPoles.filter(p => Number(p.route_id) === Number(row.id) && p.pole_type !== "feed");
  const feedPt = _iotNetworkPoles.find(p => Number(p.route_id) === Number(row.id) && p.pole_type === "feed");
  let totalM = 0;
  if (_iotMap && geo.length >= 2) {
    for (let i = 0; i < geo.length - 1; i++)
      totalM += _iotMap.distance([geo[i].lat, geo[i].lng], [geo[i+1].lat, geo[i+1].lng]);
  }
  const invRow = findInventoryForRoute(row);
  const lampCount = invRow?.lamp_count || row.lamp_count || routePoles.length || 0;
  const spacingM = lampCount > 1 && totalM > 0 ? Math.round(totalM / (lampCount - 1)) : "-";
  const savedCount = lampCount;
  const totalMStr = totalM > 0 ? (totalM / 1000).toFixed(2) + " км" : "—";
  const catLabel = { road: "Авто замын гэрэл", ger: "Гэр хороолол", tower: "Цамхаг" }[row.route_type] || row.route_type || "";
  const statusLabel = row.status === "active" ? "Идэвхтэй" : "Ноорог";
  const btnStyle = "border-radius:7px;padding:5px 9px;font-size:11px;font-weight:900;cursor:pointer;border:1px solid";
  const rid = Number(row.id);
  return `
    <div class="iot-map-popup" style="min-width:240px">
      <div style="font-size:10px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.5px">Трасс / Гудамж</div>
      <div style="font-size:14px;font-weight:900;color:#1f6fb2;margin:3px 0">${escapeHtml(row.name || "Нэргүй трасс")}</div>
      ${catLabel ? `<div style="font-size:11px;color:#475569">${escapeHtml(catLabel)}</div>` : ""}
      ${row.meter_no ? `<div style="font-family:Consolas,monospace;font-size:11px;color:#64748b;margin-top:2px">Шит: ${escapeHtml(row.meter_no)}</div>` : ""}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;margin-top:10px;font-size:12px">
        <span style="color:#64748b">Шонгийн тоо</span><b>${savedCount} ш</b>
        <span style="color:#64748b">Шон хоорондын зай</span><b>${spacingM}${spacingM !== "-" ? " м" : ""}</b>
        <span style="color:#64748b">Нийт урт</span><b>${totalMStr}</b>
        <span style="color:#64748b">Трасс цэг</span><b>${geo.length}</b>
        <span style="color:#64748b">Тэжээл</span><b>${feedPt ? "⚡ Холбогдсон" : "Холбоогүй"}</b>
        <span style="color:#64748b">Төлөв</span><b style="color:${row.status === "active" ? "#166534" : "#92400e"}">${statusLabel}</b>
      </div>
      <div id="routeEditForm_${rid}" style="display:none;margin-top:10px;padding-top:8px;border-top:1px solid #e5e7eb">
        <div style="font-size:11px;color:#475569;margin-bottom:5px;font-weight:600">✏ Шон тоо / зай засах · нийт урт: <b>${totalMStr}</b></div>
        <div style="font-size:10px;color:#94a3b8;margin-bottom:5px">Томьёо: нийт урт ÷ зай = шонгийн тоо</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">
          <label style="font-size:11px;color:#64748b">Нийт шон (ш)
            <input id="editPoleCount_${rid}" type="number" min="2" max="999" value="${savedCount}"
              style="width:100%;padding:4px 6px;border:1px solid #cbd5e1;border-radius:5px;font-size:13px;font-weight:700;margin-top:2px"
              oninput="iotRouteEditCalc(${rid},${totalM.toFixed(0)},'count')" />
          </label>
          <label style="font-size:11px;color:#64748b">Шон хоорондын зай (м)
            <input id="editSpacingM_${rid}" type="number" min="5" max="500" value="${spacingM === "-" ? _iotPoleSpacingM : spacingM}"
              style="width:100%;padding:4px 6px;border:1px solid #cbd5e1;border-radius:5px;font-size:13px;font-weight:700;margin-top:2px"
              oninput="iotRouteEditCalc(${rid},${totalM.toFixed(0)},'spacing')" />
          </label>
        </div>
        <div style="font-size:11px;color:#64748b;margin-bottom:6px">Нийт урт: <b>${totalMStr}</b></div>
        <div style="display:flex;gap:6px">
          <button onclick="iotSaveRouteStats(${rid})" style="flex:1;padding:5px;border:1px solid #86efac;background:#f0fdf4;color:#166534;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer">💾 Хадгалах</button>
          <button onclick="document.getElementById('routeEditForm_${rid}').style.display='none'" style="padding:5px 10px;border:1px solid #e2e8f0;background:#f8fafc;color:#64748b;border-radius:6px;font-size:12px;cursor:pointer">✕</button>
        </div>
      </div>
      ${routeCorridorSummary(rid)}
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
        <button style="${btnStyle} #86efac;background:#f0fdf4;color:#166534" onclick="iotEditPoles(${rid})">✏ Шон засах</button>
        <button style="${btnStyle} #bae6fd;background:#f0f9ff;color:#0369a1" onclick="iotLoadRouteToEdit(${rid})">↩ Трасс ачаалах</button>
        <button style="${btnStyle} #fde68a;background:#fffbeb;color:#92400e" onclick="iotRenumberPoles(${rid})">🔢 Дахин дугаарлах</button>
        <button style="${btnStyle} #fecaca;background:#fff;color:#b91c1c" onclick="iotDeleteNetworkRoute(${rid})">🗑 Устгах</button>
      </div>
    </div>
  `;
}

function polePopup(pole) {
  const route = _iotNetworkRoutes.find(r => Number(r.id) === Number(pole.route_id));
  const isFeed = pole.pole_type === "feed";
  const feedCables = isFeed ? _iotNetworkRoutes.filter(r => Number(r.feed_pole_id) === Number(pole.id)) : [];
  const btnStyle = "border-radius:7px;padding:5px 9px;font-size:11px;font-weight:900;cursor:pointer;border:1px solid";
  const divider = `<div style="border-top:1px solid #e5e7eb;margin:8px 0"></div>`;
  let routeStats = "";
  if (route) {
    const geo = routeGeometry(route);
    const routePoles = _iotNetworkPoles.filter(p => Number(p.route_id) === Number(route.id) && p.pole_type !== "feed");
    const feedPt = _iotNetworkPoles.find(p => Number(p.route_id) === Number(route.id) && p.pole_type === "feed");
    // New model: check sl_feeder_cable → cable_segment → this route
    const routeSegs = _iotNetworkRoutes.filter(r => r.route_type === "cable" && Number(r.parent_route_id) === Number(route.id));
    const newFeeders = routeSegs.flatMap(seg => {
      return _iotFeederCables
        .filter(fc => Number(fc.cable_segment_id) === Number(seg.id))
        .map(fc => {
          const fp = _iotFeedPoints.find(f => Number(f.id) === Number(fc.feed_point_id));
          return fp ? { name: fp.name, range: seg.pole_start ? `${seg.pole_start}-${seg.pole_end}шон` : "" } : null;
        }).filter(Boolean);
    });
    let totalM = 0;
    if (_iotMap && geo.length >= 2) {
      for (let i = 0; i < geo.length - 1; i++)
        totalM += _iotMap.distance([geo[i].lat, geo[i].lng], [geo[i+1].lat, geo[i+1].lng]);
    }
    const invRow = findInventoryForRoute(route);
    const lampCount = invRow?.lamp_count || route.lamp_count || routePoles.length || 0;
  const spacingM = lampCount > 1 && totalM > 0 ? Math.round(totalM / (lampCount - 1)) : "-";
    const calcCount = lampCount;
    const poleNumberMatch = (pole.name || pole.code || "").match(/(\d+)\s*(?:[-_]?\s*)?$/);
    const poleNumber = poleNumberMatch ? Number(poleNumberMatch[1]) : null;
    const totalMStr = totalM > 0 ? (totalM / 1000).toFixed(2) + " км" : "—";
    const rid = Number(route.id);
    routeStats = `
      ${divider}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">
        <div style="font-size:10px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.5px">🛣 ${escapeHtml(route.name || "Гудамж")}</div>
      </div>
      <div id="routeStatView_${rid}" style="display:grid;grid-template-columns:auto 1fr;gap:3px 12px;font-size:12px">
        <span style="color:#64748b">Нийт шон</span><b>${calcCount} ш</b>
        ${poleNumber !== null ? `<span style="color:#64748b">Шоны дугаар</span><b>${poleNumber}-р шон</b>` : ""}
        <span style="color:#64748b">Шон хоорондын зай</span><b>${spacingM} м</b>
        <span style="color:#64748b">Нийт урт</span><b>${totalMStr}</b>
        <span style="color:#64748b">Тэжээл</span><b style="color:${(feedPt || newFeeders.length) ? "#b45309" : "#94a3b8"}">${feedPt ? "⚡ " + escapeHtml(feedPt.name || "Холбогдсон") : newFeeders.length ? newFeeders.map(f => `⚡ ${escapeHtml(f.name)}${f.range ? " (" + f.range + ")" : ""}`).join(" · ") : "Холбоогүй"}</b>
      </div>
      <div id="routeEditForm_${rid}" style="display:none;margin-top:6px">
        <div style="font-size:11px;color:#475569;margin-bottom:5px;font-weight:600">Нэгийг оруулахад нөгөө автоматаар тооцоолно · нийт урт: <b>${totalMStr}</b></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">
          <label style="font-size:11px;color:#64748b">Нийт шон (ш)
            <input id="editPoleCount_${rid}" type="number" min="2" max="999" value="${calcCount}"
              style="width:100%;padding:4px 6px;border:1px solid #cbd5e1;border-radius:5px;font-size:13px;font-weight:700;margin-top:2px"
              oninput="iotRouteEditCalc(${rid},${totalM.toFixed(0)},'count')" />
          </label>
          <label style="font-size:11px;color:#64748b">Шон хоорондын зай (м)
            <input id="editSpacingM_${rid}" type="number" min="5" max="500" value="${spacingM}"
              style="width:100%;padding:4px 6px;border:1px solid #cbd5e1;border-radius:5px;font-size:13px;font-weight:700;margin-top:2px"
              oninput="iotRouteEditCalc(${rid},${totalM.toFixed(0)},'spacing')" />
          </label>
        </div>
        <div style="font-size:11px;color:#94a3b8;margin-bottom:6px">Томьёо: нийт урт ÷ зай = шонгийн тоо</div>
        <div style="display:flex;gap:6px">
          <button onclick="iotSaveRouteStats(${rid})" style="flex:1;padding:5px;border:1px solid #86efac;background:#f0fdf4;color:#166534;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer">💾 Хадгалах</button>
          <button onclick="iotToggleRouteEdit(${rid},${totalM.toFixed(0)})" style="padding:5px 10px;border:1px solid #e2e8f0;background:#f8fafc;color:#64748b;border-radius:6px;font-size:12px;cursor:pointer">✕</button>
        </div>
      </div>`;
  }
  let feedStats = "";
  if (isFeed) {
    const cableRoutes = _iotNetworkRoutes.filter(r => r.route_type === "cable");
    const connectedIds = new Set([
      ...feedCables.map(fc => Number(fc.parent_route_id)),
      ..._iotNetworkRoutes.filter(r => r.route_type === "cable" && Number(r.feed_pole_id) === Number(pole.id)).map(r => Number(r.id)),
    ]);
    const btnS = "flex-shrink:0;border-radius:6px;padding:3px 7px;font-size:11px;font-weight:700;cursor:pointer;border:1px solid;white-space:nowrap";
    feedStats = `
      ${divider}
      <div style="font-size:10px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">🔌 Кабель холболт</div>
      ${cableRoutes.length === 0 ? `<div style="font-size:11px;color:#94a3b8">Кабель байхгүй</div>` : ""}
      <div style="display:flex;flex-direction:column;gap:5px">
        ${cableRoutes.map(r => {
          const geo = routeGeometry(r);
          let len = 0;
          if (_iotMap && geo.length >= 2) for (let i = 0; i < geo.length - 1; i++) len += _iotMap.distance([geo[i].lat, geo[i].lng], [geo[i+1].lat, geo[i+1].lng]);
          const lenStr = len > 50 ? ` · ${len >= 1000 ? (len/1000).toFixed(2)+"км" : len.toFixed(0)+"м"}` : "";
          const segRange = r.pole_start ? ` · ${r.pole_start}-${r.pole_end}шон` : "";
          const isConn = connectedIds.has(Number(r.id)) || Number(r.feed_pole_id) === Number(pole.id);
          return `<div style="display:flex;align-items:center;gap:5px;justify-content:space-between">
            <span style="font-size:11px;color:${isConn ? "#166534" : "#334155"};font-weight:${isConn ? "700" : "400"};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px" title="${escapeHtml(r.name || "Кабель")}${segRange}">${escapeHtml(r.name || "Кабель")}${segRange}${lenStr}</span>
            <div style="display:flex;gap:3px;flex-shrink:0">
              ${isConn
                ? `<button style="${btnS}#86efac;background:#f0fdf4;color:#166534" onclick="iotHighlightFeed(${Number(pole.id)},${Number(r.id)})">⚡ Тодруулах</button>
                   <button style="${btnS}#fca5a5;background:#fff0f0;color:#b91c1c" title="Холболт салгах" onclick="iotDisconnectFeedFromSegment(${Number(pole.id)},${Number(r.id)})">✕</button>`
                : `<button style="${btnS}#fde68a;background:#fffbeb;color:#92400e" onclick="iotConnectFeedToSegment(${Number(pole.id)},${Number(r.id)})">+ Холбох</button>`}
            </div>
          </div>`;
        }).join("")}
      </div>`;
  }
  return `
    <div class="iot-map-popup" style="min-width:${isFeed ? "310px" : "220px"};max-width:340px">
      <div style="font-size:10px;font-weight:800;color:${isFeed ? "#b45309" : "#1e40af"};text-transform:uppercase;letter-spacing:.5px">${isFeed ? "⚡ ТЭЖЭЭЛ АВАХ ЦЭГ" : "🔦 ГЭРЛИЙН ШОН"}</div>
      <div style="font-size:15px;font-weight:900;color:${isFeed ? "#92400e" : "#1f6fb2"};margin:3px 0 1px">${escapeHtml(pole.name || pole.code || (isFeed ? "Тэжээл" : "Шон"))}</div>
      ${pole.code && pole.code !== pole.name ? `<div style="font-family:Consolas,monospace;font-size:11px;color:#64748b">${escapeHtml(pole.code)}</div>` : ""}
      <div style="display:grid;grid-template-columns:auto 1fr;gap:3px 12px;margin-top:6px;font-size:12px">
        ${pole.meter_no ? `<span style="color:#64748b">Шит/тоолуур</span><b>${escapeHtml(pole.meter_no)}</b>` : ""}
        <span style="color:#64748b">GPS</span><span style="font-family:Consolas,monospace;font-size:10px;color:#334155">${fmtNum(pole.gps_lat,6)}, ${fmtNum(pole.gps_lng,6)}</span>
      </div>
      ${routeStats}
      ${feedStats}
      ${isFeed && feedCables.length ? `
        ${divider}
        <div style="font-size:10px;font-weight:800;color:#b45309;text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px">⚡ Энэ тэжээлийн утас</div>
        <div style="display:grid;gap:4px;font-size:12px">
          ${feedCables.map(c => `<button style="text-align:left;border:1px solid #fde68a;background:#fffbeb;color:#92400e;border-radius:7px;padding:6px 8px;font-size:12px;font-weight:800;cursor:pointer" onclick="iotHighlightFeed(${Number(pole.id)},${Number(c.id)})">${escapeHtml(c.name || "Утас")} · ${Number(c.pole_start || 0)}-${Number(c.pole_end || 0)} шон · ${escapeHtml(c.wire_phase || "")} ${escapeHtml(c.wire_profile || "")}</button>`).join("")}
        </div>` : ""}
      ${divider}
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        
        ${route && !isFeed ? `<button style="${btnStyle} #86efac;background:#f0fdf4;color:#166534" onclick="iotEditPoles(${Number(route.id)})">✏ Шон засах</button>` : ""}
        <button style="${btnStyle} #fecaca;background:#fff0f0;color:#b91c1c" onclick="iotDeleteNetworkPole(${Number(pole.id)})">🗑 Устгах</button>
      </div>
      <div style="font-size:10px;color:#cbd5e1;margin-top:6px;font-style:italic">Байрлал өөрчлөхийн тулд "Шон засах" горимд чирнэ</div>
    </div>
  `;
}

function currentNetworkMeterNo() {
  const value = document.getElementById("iotNetMeter")?.value || _iotWorkMeter || "";
  _iotWorkMeter = value;
  return value;
}

function currentNetworkName() {
  const selected = document.getElementById("iotNetName")?.value || _iotWorkName || "";
  _iotWorkName = selected.trim();
  const poleCount = document.getElementById("iotPoleCount");
  if (poleCount) poleCount.textContent = `Shon: ${selectedRoutePoleCount()}`;
  updateDraftRouteMetrics();
  return _iotWorkName;
}

function currentNetworkCategory() {
  const value = document.getElementById("iotNetCategory")?.value || _iotWorkCategory || "road";
  _iotWorkCategory = value;
  return value;
}

function routeSourceRows(category = "road") {
  if (category === "ger") return _iotGerInventory.filter(r => r.category === "Гэр хороолол");
  if (category === "tower") return _iotGerInventory.filter(r => r.category === "Цамхаг");
  return _iotLightPoints.filter(r => (r.code || "").startsWith("ГТ-") || r.name || r.location);
}

function routeSourceLabel(row, category) {
  if (category === "road") {
    const code = row.code ? `${row.code} - ` : "";
    return `${code}${row.name || row.location || "Авто замын гэрэл"}`;
  }
  const bag = row.bag_no ? `${row.bag_no}-р баг - ` : "";
  return `${bag}${row.location_name || row.name || "Байршил"}`;
}

function routeSourceValue(row, category) {
  if (category === "road") return row.name || row.location || row.code || "";
  return row.location_name || row.name || "";
}

function selectedRouteSourceRow() {
  const category = document.getElementById("iotNetCategory")?.value || _iotWorkCategory || "road";
  const name = document.getElementById("iotNetName")?.value || _iotWorkName || "";
  return routeSourceRows(category).find(row => routeSourceValue(row, category) === name) || null;
}

function selectedRoutePoleCount() {
  const row = selectedRouteSourceRow();
  if (!row) return 0;
  const category = document.getElementById("iotNetCategory")?.value || _iotWorkCategory || "road";
  const raw = category === "road"
    ? (row.lamp_count || row.total_heads || row.head_count || 0)
    : (row.total_count || row.head_count || 0);
  const count = Number(raw);
  return Number.isFinite(count) && count > 0 ? Math.round(count) : 0;
}

function selectedRouteCode() {
  const row = selectedRouteSourceRow();
  return row?.code || row?.id || "";
}

function routeNameOptions(category = "road") {
  const rows = routeSourceRows(category);
  if (!rows.length) return `<option value="">Ner oldsonggui</option>`;
  if (!_iotWorkName) _iotWorkName = routeSourceValue(rows[0], category);
  return rows.map(row => {
    const value = routeSourceValue(row, category);
    const label = routeSourceLabel(row, category);
    const meter = row.meter_no ? ` · ${row.meter_no}` : "";
    return `<option value="${escapeHtml(value)}" ${value === _iotWorkName ? "selected" : ""}>${escapeHtml(label + meter)}</option>`;
  }).join("");
}

function iotUpdateRouteNameOptions() {
  const category = currentNetworkCategory();
  _iotWorkName = "";
  const select = document.getElementById("iotNetName");
  if (select) select.innerHTML = routeNameOptions(category);
  currentNetworkName();
}

function networkMeterOptions() {
  const rows = _iotMeterPoints
    .filter(p => p?.meter_no)
    .map(p => `<option value="${escapeHtml(p.meter_no)}" ${p.meter_no === _iotWorkMeter ? "selected" : ""}>${escapeHtml(p.meter_no)}${p.name ? " - " + escapeHtml(p.name) : ""}</option>`)
    .join("");
  return `<option value="" ${_iotWorkMeter ? "" : "selected"}>Meter / shid songoh</option>${rows}`;
}

function renderNetworkWorkspace() {
  const hint = _iotDrawMode === "route"
    ? "Газрын зураг дээр дарж трасс цэг нэмнэ. Цэгийг чирж засах боломжтой."
    : _iotDrawMode === "pole"
    ? "Газрын зураг дээр дарж шон байрлуулна."
    : "Трасс зурах эсвэл шон цэг тэмдэглэх горимоо сонгоно уу.";
  return `
    <div class="iot-network-tools">
      <select id="iotNetCategory" class="iot-net-input" onchange="iotUpdateRouteNameOptions()">
        <option value="road" ${_iotWorkCategory === "road" ? "selected" : ""}>Авто замын гэрэл</option>
        <option value="ger" ${_iotWorkCategory === "ger" ? "selected" : ""}>Гэр хорооллын гэрэл</option>
        <option value="tower" ${_iotWorkCategory === "tower" ? "selected" : ""}>Цамхагийн гэрэл</option>
      </select>
      <select id="iotNetName" class="iot-net-input iot-net-name" onchange="iotOnRouteNameChange()">${routeNameOptions(_iotWorkCategory)}</select>
      <select id="iotNetMeter" class="iot-net-input">${networkMeterOptions()}</select>
      <span id="iotPoleCount" class="iot-pole-count">🔦 Шон: ${selectedRoutePoleCount()}</span>
      <span id="iotRouteMetrics" class="iot-route-metrics">Нийт урт: 0 м · Хоорондын зай: - · Авто шон: ${selectedRoutePoleCount()}</span>
      <button type="button" class="iot-btn-auto" onclick="iotAutoLoadRoute()" title="Сонгосон гудамжны трассыг автоматаар ачаалах">⚡ Авто</button>
      <button type="button" class="${_iotDrawMode === "route" ? "is-active" : ""}" onclick="iotSetDrawMode('route')" title="Гараар трасс зурах">✏ Трасс</button>
      <button type="button" class="${_iotDrawMode === "pole" ? "is-active" : ""}" onclick="iotSetDrawMode('pole')" title="Шон цэг тэмдэглэх">🔩 Шон</button>
      <label style="display:flex;align-items:center;gap:5px;font-size:12px;color:#334155;font-weight:700;cursor:pointer;white-space:nowrap;padding:0 4px" title="Нэг замын хоёр талд тусдаа alignment үүсгэнэ">
        <input type="checkbox" id="iotDualSide" ${_iotDualSide ? "checked" : ""} onchange="_iotDualSide=this.checked;iotUpdateDualSideLabel()"> Хоёр тал
      </label>
      <span id="iotDualSideLabel" style="display:${_iotDualSide ? "" : "none"};font-size:11px;color:#64748b;border:1px solid #e2e8f0;background:#f8fafc;border-radius:7px;padding:4px 7px"></span>
      <label style="display:${_iotDualSide ? "flex" : "none"};align-items:center;gap:3px;font-size:11px;color:#64748b;white-space:nowrap" id="iotRoadWidthLabel" title="Замын нийт өргөн (м) — centerline-аас A/B тийш хэдэн метр хазайлгах">
        <input type="number" id="iotRoadWidthInput" value="${_iotRoadWidth}" min="4" max="60" step="1"
          style="width:46px;font-size:11px;border:1px solid #e2e8f0;border-radius:5px;padding:2px 5px;background:#fff;text-align:center"
          onchange="_iotRoadWidth=Number(this.value)||14">м өргөн
      </label>
      <button type="button" id="iotFeedPlaceBtn" class="${_iotDrawMode === "feed_place" ? "is-active iot-btn-feed" : "iot-btn-feed"}" onclick="iotSetDrawMode('feed_place')" title="Тэжээлийн цэг (ТП/щит/тоолуур) газрын зурагт байрлуулах">⚡ Тэж. цэг</button>
      <button type="button" id="iotFeedConnectBtn" class="${_iotDrawMode === "feed_connect" ? "is-active iot-btn-feed" : "iot-btn-feed"}" onclick="iotSetDrawMode('feed_connect')" title="Тэжээлийн цэгийг кабель сегменттэй холбох">🔗 Холбох${_iotSelectedFeedPointId ? " ✓" : ""}</button>
      <button type="button" id="iotSplitModeBtn" class="${_iotSplitMode ? "is-active iot-btn-split-active" : "iot-btn-split"}" onclick="iotToggleSplitMode()" title="Кабель сегментийг 2 хэсэгт таслах горим">✂ Таслах</button>
      ${_iotEditingRouteId ? `<button type="button" class="iot-btn-stop-edit" onclick="iotStopEditPoles()">✅ Засах дуусгах</button>` : ""}
      <button type="button" id="iotSaveBtn" onclick="iotSaveDraftRoute()" title="Трасс болон шонгуудыг хадгалах">💾 Хадгалах</button>
      <button type="button" onclick="iotClearDraft()" title="Ноорогыг арилгах">🗑 Цэвэрлэх</button>
      <button type="button" class="${_iotScadaMode ? "is-active" : ""}" onclick="iotToggleScadaMode()" title="SCADA / AutoCAD харагдац">🖥 SCADA</button>
      <span id="iotDrawHint" class="iot-draw-hint">${hint}</span>
    </div>
  `;
}

function syncIotWorkspaceControls() {
  const cat = document.getElementById("iotNetCategory");
  const name = document.getElementById("iotNetName");
  const meter = document.getElementById("iotNetMeter");
  const poleCount = document.getElementById("iotPoleCount");
  const spacing = document.getElementById("iotPoleSpacing");
  if (cat) {
    cat.value = _iotWorkCategory || "road";
    cat.onchange = () => iotUpdateRouteNameOptions();
  }
  if (name) {
    name.innerHTML = routeNameOptions(_iotWorkCategory || "road");
    if (_iotWorkName) name.value = _iotWorkName;
    name.onchange = () => iotOnRouteNameChange();
  }
  if (meter) {
    if (_iotWorkMeter) meter.value = _iotWorkMeter;
    meter.onchange = () => currentNetworkMeterNo();
  }
  if (spacing) {
    spacing.value = _iotPoleSpacingM;
    spacing.onchange = (e) => iotUpdatePoleSpacing(e.target.value);
  }
  if (poleCount) poleCount.textContent = `🔦 Шон: ${selectedRoutePoleCount()}`;
  const feedConnectBtn = document.getElementById("iotFeedConnectBtn");
  if (feedConnectBtn && !document.getElementById("iotNodeLinkBtn")) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "iotNodeLinkBtn";
    btn.className = "iot-btn-feed";
    btn.title = "Шитэнд суурилуулсан ADW300/310 төхөөрөмжийг тэжээлийн цэгт оноох";
    btn.textContent = "📡 ADW оноох";
    btn.onclick = () => iotLinkNodePromptReplace();
    feedConnectBtn.insertAdjacentElement("afterend", btn);
  }
  updateDraftRouteMetrics();
}

function mapPopup(row, coord) {
  const online = isDeviceOnline(row);
  return `
    <div class="iot-map-popup">
      <div style="font-weight:900;color:#0f172a;margin-bottom:4px">${fmtText(row.deviceName)}</div>
      <div style="font-size:12px;color:#64748b;margin-bottom:8px">${fmtText(row.devEui)}</div>
      <div style="display:grid;grid-template-columns:auto auto;gap:4px 12px;font-size:12px">
        <span>Дохио</span><b style="color:${online ? "#166534" : "#991b1b"}">${online ? "Ирсэн" : "Тасарсан"}</b>
        <span>Чадал</span><b>${fmtNum(iotNumericValue(row, "power"), 3, " kW")}</b>
        <span>Энерги</span><b>${fmtNum(iotNumericValue(row, "energy"), 3, " kWh")}</b>
        <span>Сүүлд</span><b>${fmtDate(row.last_seen)}</b>
      </div>
      ${coord.source === "manual" ? `<div style="margin-top:8px;color:#166534;font-size:11px">Байршлыг оператор map дээр гараар тогтоосон.</div>` : ""}
      ${coord.estimated ? `<div style="margin-top:8px;color:#92400e;font-size:11px">Байршил payload-д байхгүй тул түр ойролцоогоор байрлуулсан. Сүлжээний зураглал дээр marker-ийг чирж зөв байрлуулж хадгална.</div>` : ""}
    </div>
  `;
}

function markerHtml(row, coord) {
  const online = isDeviceOnline(row);
  const load = relayState(row);
  const color = online ? (load === "on" ? "#16a34a" : "#6b7280") : "#dc2626";
  const ring = coord.estimated ? "#f59e0b" : "#ffffff";
  return `<div class="iot-map-marker" style="background:${color};border-color:${ring}">
    <span>${load === "on" ? "ON" : load === "off" ? "OFF" : "IoT"}</span>
  </div>`;
}

async function iotSaveNodeLocation(devEui, latlng) {
  const lat = Number(latlng?.lat);
  const lng = Number(latlng?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !isChoibalsanCoord(lat, lng)) {
    toast("Node байрлал Чойбалсан орчмоос гадуур байна");
    throw new Error("Invalid node location");
  }
  const result = await api(`/api/iot/devices/${encodeURIComponent(devEui)}/location`, {
    method: "POST",
    body: JSON.stringify({ lat, lng }),
  });
  const row = _iotRows.find(r => String(r.devEui || "").toUpperCase() === String(devEui || "").toUpperCase());
  if (row) {
    row.manualLat = lat;
    row.manualLng = lng;
    row.manualLocationAt = new Date().toISOString();
  }
  toast(`${result.deviceName || devEui}: байрлал хадгалагдлаа`);
  return result;
}

async function iotSaveNodeLocationFromFeedPoint(feedPointId, node) {
  const fp = _iotFeedPoints.find(row => Number(row.id) === Number(feedPointId));
  const lat = Number(fp?.gps_lat ?? fp?.lat);
  const lng = Number(fp?.gps_lng ?? fp?.lng);
  if (!node?.devEui || !Number.isFinite(lat) || !Number.isFinite(lng) || !isChoibalsanCoord(lat, lng)) return false;
  await iotSaveNodeLocation(node.devEui, { lat, lng });
  return true;
}

function iotPoleZoomStyle(zoom) {
  const z = Number(zoom || 13);
  if (z <= 12) return { r: 1, border: 0, font: 0, glow: 0, opacity: 0 };
  if (z <= 13) return { r: 1, border: 0, font: 0, glow: 0, opacity: 0.18 };
  if (z <= 14) return { r: 2, border: 1, font: 0, glow: 0, opacity: 0.45 };
  if (z <= 15) return { r: 4, border: 1, font: 0, glow: 4, opacity: 0.78 };
  if (z <= 16) return { r: 5, border: 1, font: 7, glow: 7, opacity: 0.92 };
  return { r: 8, border: 2, font: 10, glow: 14, opacity: 1 };
}

function iotRowByDevEui(devEui) {
  const key = String(devEui || "").toUpperCase();
  return _iotRows.find(row => String(row.devEui || "").toUpperCase() === key) || null;
}

function iotControllerForSegment(segmentId) {
  const feeder = _iotFeederCables.find(fc => Number(fc.cable_segment_id) === Number(segmentId));
  if (!feeder) return null;
  const link = _iotFeedPointDeviceLinks.find(row =>
    Number(row.feed_point_id) === Number(feeder.feed_point_id) &&
    String(row.role || "controller") === "controller"
  );
  const row = link ? iotRowByDevEui(link.dev_eui) : null;
  return row ? { feeder, link, row } : null;
}

function iotNodeLoadPercent(row, segment = null) {
  if (!row) return null;
  const state = relayState(row);
  if (state === "off") return 0;
  const powerKw = Number(iotNumericValue(row, "power")) || 0;
  const segmentPoleCount = segment
    ? Math.max(0, Number(segment.pole_end || 0) - Number(segment.pole_start || 0) + 1)
    : 0;
  const segmentMaxKw = segmentPoleCount && Number(row.wattageW)
    ? (segmentPoleCount * Number(row.wattageW)) / 1000
    : 0;
  const maxKw = segmentMaxKw || Number(row.maxCapacityKw) ||
    ((Number(row.lampCount) || 0) * (Number(row.wattageW) || 0) / 1000);
  if (Number.isFinite(maxKw) && maxKw > 0) {
    return Math.max(0, Math.min(100, (powerKw / maxKw) * 100));
  }
  if (state === "on") return 100;
  return null;
}

function iotSegmentNodeInfo(segment) {
  if (!segment || segment.route_type !== "cable") return null;
  const controller = iotControllerForSegment(segment.id);
  if (!controller) return null;
  const pct = iotNodeLoadPercent(controller.row, segment);
  const state = relayState(controller.row);
  if (pct === null) return { ...controller, state, pct: null };
  return { ...controller, state, pct };
}

function iotSegmentVisualStatus(segment) {
  const node = iotSegmentNodeInfo(segment);
  if (!node) return "off";
  if (node.state === "on") return "on";
  if (node.state === "off") return "off";
  return segment?.segment_status || "partial";
}

function poleSegmentStatus(pole) {
  if (pole.pole_type === "feed") return "feed";
  const poleNum = iotPoleNumber(pole);
  const routeId = Number(pole.route_id || 0);
  if (!routeId || poleNum <= 0) return "unknown";
  const segments = _iotNetworkRoutes.filter(r =>
    r.route_type === "cable" &&
    Number(r.parent_route_id) === routeId &&
    Number(r.pole_start || 0) <= poleNum &&
    Number(r.pole_end || 0) >= poleNum
  );
  if (!segments.length) return "no_segment";
  const nodeSegment = segments.find(s => iotSegmentNodeInfo(s));
  if (nodeSegment) {
    const info = iotSegmentNodeInfo(nodeSegment);
    if (info?.state === "on") return "on";
    if (info?.state === "off") return "off";
    return "partial";
  }
  if (segments.every(s => s.route_type === "cable" && !iotControllerForSegment(s.id))) return "off";
  const statuses = segments.map(s => s.segment_status || "on");
  if (statuses.every(s => s === "off")) return "off";
  if (statuses.some(s => s === "fault")) return "fault";
  if (statuses.some(s => s === "off")) return "partial";
  return "on";
}

function iotPoleIconForZoom(pole, zoom) {
  const s = iotPoleZoomStyle(zoom);
  const segStatus = poleSegmentStatus(pole);
  let poleColor, poleBorder, glowColor;
  if (_iotScadaMode) {
    if (segStatus === "off")     { poleColor = "#9ca3af"; poleBorder = "#4b5563"; glowColor = null; }
    else if (segStatus === "fault") { poleColor = "#dc2626"; poleBorder = "#991b1b"; glowColor = "#ff444488"; }
    else if (segStatus === "partial") { poleColor = "#ea580c"; poleBorder = "#c2410c"; glowColor = "#ff990088"; }
    else                         { poleColor = "#ffe600"; poleBorder = "#ff9900"; glowColor = "#ffe60088"; }
  } else {
    if (segStatus === "off")     { poleColor = "#d1d5db"; poleBorder = "#6b7280"; glowColor = null; }
    else if (segStatus === "fault") { poleColor = "#ef4444"; poleBorder = "#991b1b"; glowColor = null; }
    else if (segStatus === "partial") { poleColor = "#fb923c"; poleBorder = "#c2410c"; glowColor = null; }
    else                         { poleColor = "#fde047"; poleBorder = "#0f172a"; glowColor = null; }
  }
  const size = s.r * 2 + s.border * 2;
  const showSymbol = s.font > 0;
  const symbol = showSymbol
    ? (segStatus === "off" ? "○" : segStatus === "fault" ? "!" : segStatus === "partial" ? "~" : "🔦")
    : "";
  const glowBox = s.glow > 0 && glowColor
    ? `0 0 ${Math.max(5, s.glow)}px 2px ${glowColor}`
    : "none";
  return window.L.divIcon({
    className: "iot-pole-marker-wrap",
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:${poleColor};border:${s.border}px solid ${poleBorder};
      box-shadow:${glowBox};
      display:flex;align-items:center;justify-content:center;
      font-size:${s.font}px;font-weight:900;color:${poleBorder};
      opacity:${s.opacity};
    ">${symbol}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function updateIotPoleMarkerStyles(poleRefs = []) {
  if (!_iotMap || !window.L) return;
  const zoom = _iotMap.getZoom();
  const s = iotPoleZoomStyle(zoom);
  poleRefs.forEach(ref => {
    ref.marker?.setIcon(iotPoleIconForZoom(ref.pole, zoom));
    if (ref.glow) {
      if (s.glow > 0) {
        ref.glow.setRadius(s.glow);
        ref.glow.setStyle({ opacity: 1, fillOpacity: _iotScadaMode ? 0.75 : 0.35 });
      } else {
        ref.glow.setRadius(0.1);
        ref.glow.setStyle({ opacity: 0, fillOpacity: 0 });
      }
    }
  });
}

function renderMapPanel({ editable = true } = {}) {
  const points = _iotRows.map((row, index) => ({ row, coord: coordForRow(row, index) }));
  const online = points.filter(p => isDeviceOnline(p.row)).length;
  const estimated = points.filter(p => p.coord.estimated).length;
  const metersWithGps = _iotMeterPoints.filter(p => coordForStoredPoint(p)).length;
  const lightsWithGps = _iotLightPoints.filter(p => coordForStoredPoint(p)).length;
  const routeCount = _iotNetworkRoutes.length;
  const poleCount = _iotNetworkPoles.length;
  const employeeCount = _iotEmployeeLocations.filter(loc => employeeMapCoord(loc)).length;
  return `
    <div class="iot-map-shell">
      <div class="iot-map-toolbar">
        <div>
          <div class="iot-panel-title">${editable ? "Сүлжээний зураглал, тохиргоо" : "Map хяналт"}</div>
          <div class="iot-map-sub">${points.length} ADW · ${online} дохио ирсэн · ${metersWithGps} шит · ${lightsWithGps} гэрэл · ${routeCount} трасс · ${poleCount} шон · ${employeeCount} ажилтан GPS · ${estimated} түр байршил${editable ? " · зураглал засварлах хэсэг" : " · зөвхөн хяналт"}</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <div class="iot-map-legend"><span><i class="ok"></i>Гэрэл ассан</span><span><i class="off"></i>Гэрэл унтарсан</span><span><i class="bad"></i>Дохио тасарсан</span><span><i class="est"></i>Түр байршил</span><span><i class="employee"></i>Ажилтан GPS</span></div>
          <button type="button" class="iot-fullscreen-btn" onclick="iotToggleMaximize()" title="${_iotMaximized ? "Буцах" : "Дэлгэц дүүрэн харах"}">
            ${_iotMaximized
              ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg> Буцах`
              : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg> Дэлгэц дүүрэн`}
          </button>
        </div>
      </div>
      ${editable ? renderNetworkWorkspace() : ""}
      <div id="iotMap" class="iot-map-canvas"></div>
    </div>`;
}

function renderIotBody() {
  if (_iotView === "report") return renderReportPanel();
  if (_iotView === "list") return renderTable();
  if (_iotView === "map") return `${renderOperatorGuide()}${renderMapPanel({ editable: true })}`;
  return renderCommandDashboard();
}

function ensureLeaflet() {
  if (window.L) {
    _iotLeafletReady = true;
    return Promise.resolve();
  }
  if (_iotLeafletReady) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cssId = "iotLeafletCss";
    if (!document.getElementById(cssId)) {
      const css = document.createElement("link");
      css.id = cssId;
      css.rel = "stylesheet";
      css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(css);
    }
    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.onload = () => {
      _iotLeafletReady = true;
      resolve();
    };
    script.onerror = () => reject(new Error("Map сан ачаалахад алдаа гарлаа"));
    document.head.appendChild(script);
  });
}

async function initIotMap() {
  if (_iotView === "list") return;
  const mapEl = document.getElementById("iotMap");
  if (!mapEl) return;
  try {
    await ensureLeaflet();
  } catch (e) {
    mapEl.innerHTML = `<div class="iot-map-empty">${escapeHtml(e.message || "Map ачаалагдсангүй")}</div>`;
    return;
  }
  if (!window.L || !document.getElementById("iotMap")) return;
  const points = _iotRows.map((row, index) => ({ row, coord: coordForRow(row, index) }));
  const initCenter = _iotSavedCenter ? [_iotSavedCenter.lat, _iotSavedCenter.lng] : [48.0789, 114.5357];
  const initZoom = _iotSavedZoom ?? 13;
  const shouldFitToData = !_iotSavedCenter && _iotSavedZoom == null;
  _iotSavedCenter = null;
  _iotSavedZoom = null;
  _iotMap = window.L.map("iotMap", { zoomControl: true, preferCanvas: true }).setView(initCenter, initZoom);
  window.L.tileLayer("https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", {
    maxZoom: 20,
    subdomains: ["0", "1", "2", "3"],
    attribution: "&copy; Google",
  }).addTo(_iotMap);
  _iotMarkers = window.L.featureGroup().addTo(_iotMap);
  const meterLayer = window.L.featureGroup().addTo(_iotMap);
  const lightLayer = window.L.featureGroup().addTo(_iotMap);
  const linkLayer = window.L.featureGroup().addTo(_iotMap);
  const networkRouteLayer = window.L.featureGroup().addTo(_iotMap);
  const poleLayer = window.L.featureGroup().addTo(_iotMap);
  const gatewayLayer = window.L.featureGroup().addTo(_iotMap);
  const employeeLayer = window.L.featureGroup().addTo(_iotMap);
  const poleMarkerRefs = [];
  const feedLayer = window.L.featureGroup().addTo(_iotMap);
  _iotFeedHighlightLayer = window.L.featureGroup().addTo(_iotMap);
  _iotFeedDraftLayer = window.L.featureGroup().addTo(_iotMap);
  _iotDraftLayer = window.L.featureGroup().addTo(_iotMap);
  points.forEach(({ row, coord }) => {
    const icon = window.L.divIcon({
      className: "iot-map-marker-wrap",
      html: markerHtml(row, coord),
      iconSize: [42, 42],
      iconAnchor: [21, 21],
      popupAnchor: [0, -18],
    });
    const marker = window.L.marker([coord.lat, coord.lng], {
      icon,
      draggable: _iotView === "map",
      autoPan: true,
    }).bindPopup(mapPopup(row, coord));
    if (_iotView === "map") {
      marker.on("dragend", async () => {
        const pos = marker.getLatLng();
        try {
          await iotSaveNodeLocation(row.devEui, pos);
          marker.setPopupContent(mapPopup(row, { lat: pos.lat, lng: pos.lng, estimated: false, source: "manual" }));
        } catch (e) {
          marker.setLatLng([coord.lat, coord.lng]);
          toast(e.message || "Node байрлал хадгалах үед алдаа гарлаа");
        }
      });
    }
    marker.addTo(_iotMarkers);
  });
  const meterByNo = new Map();
  _iotMeterPoints.forEach(point => {
    const coord = coordForStoredPoint(point);
    if (!coord) return;
    const row = findIotForMeter(point);
    const color = iotStateColor(row);
    if (point.meter_no) meterByNo.set(String(point.meter_no).trim().toLowerCase(), { point, coord, row });
    const marker = window.L.circleMarker([coord.lat, coord.lng], {
      radius: 8,
      color: "#ffffff",
      weight: 2,
      fillColor: color,
      fillOpacity: 0.95,
    }).bindPopup(meterPopup(point, row));
    marker.addTo(meterLayer);
  });
  _iotLightPoints.forEach(point => {
    const coord = coordForStoredPoint(point);
    if (!coord) return;
    const linked = point.meter_no ? meterByNo.get(String(point.meter_no).trim().toLowerCase()) : null;
    const row = linked?.row || findIotForMeter(point);
    const color = iotStateColor(row);
    window.L.circleMarker([coord.lat, coord.lng], {
      radius: 4,
      color,
      weight: 1,
      fillColor: color,
      fillOpacity: 0.85,
    }).bindPopup(lightPointPopup(point, row)).addTo(lightLayer);
    if (linked) {
      window.L.polyline([[linked.coord.lat, linked.coord.lng], [coord.lat, coord.lng]], {
        color,
        weight: 2,
        opacity: row ? 0.75 : 0.35,
        dashArray: row ? "" : "5 6",
      }).addTo(linkLayer);
    }
  });
  _iotNetworkRoutes.forEach(route => {
    const geometry = routeGeometry(route).filter(p => coordForStoredPoint({ gps_lat: p.lat, gps_lng: p.lng }));
    if (geometry.length < 2) return;
    const isCable = route.route_type === "cable";
    const isFeedWire = route.route_type === "feed_wire";
    if (isFeedWire) {
      // Feed wire: orange thin dashed line from feed point to cable segment
      const wireColor = _iotScadaMode ? "#fbbf24" : "#f97316";
      window.L.polyline(geometry.map(p => [p.lat, p.lng]), {
        color: wireColor, weight: _iotScadaMode ? 3 : 2, dashArray: "6 4", opacity: 0.9,
      }).bindPopup(cableRoutePopup(route))
        .bindTooltip(`⚡ ${escapeHtml(route.name || "Тэжээлийн утас")}`, { sticky: true })
        .addTo(networkRouteLayer);
      return;
    }
    const segStatus = isCable ? iotSegmentVisualStatus(route) : null;
    const cableColorNormal = { on: "#22c55e", off: "#9ca3af", fault: "#ef4444", partial: "#f97316" };
    const cableColorScada  = { on: "#00ff88", off: "#6b7280", fault: "#ff4444", partial: "#ff9900" };
    const routeColor = isCable
      ? ((_iotScadaMode ? cableColorScada : cableColorNormal)[segStatus] || "#22c55e")
      : (_iotScadaMode ? "#00e5ff" : (route.color || "#f59e0b"));
    if (_iotScadaMode && !isCable) {
      window.L.polyline(geometry.map(p => [p.lat, p.lng]), {
        color: "rgba(0,229,255,0.18)", weight: 12, opacity: 1,
      }).addTo(networkRouteLayer);
    }
    const zoomNow = _iotMap.getZoom();
    const cableHaloWeight = zoomNow <= 13 ? 5 : zoomNow <= 15 ? 7 : (_iotScadaMode ? 11 : 9);
    const cableLineWeight = zoomNow <= 13 ? 2.5 : zoomNow <= 15 ? 3.5 : (_iotScadaMode ? 4 : 5);
    if (isCable) {
      window.L.polyline(geometry.map(p => [p.lat, p.lng]), {
        color: _iotScadaMode ? "rgba(255,107,53,0.28)" : "rgba(239,68,68,0.30)",
        weight: cableHaloWeight,
        opacity: 1,
      }).addTo(networkRouteLayer);
    }
    const cableLabel = isCable && route.pole_start ? ` · ${route.pole_start}-${route.pole_end} шон` : "";
    const routeLine = window.L.polyline(geometry.map(p => [p.lat, p.lng]), {
      color: routeColor,
      weight: isCable ? cableLineWeight : (_iotScadaMode ? 2.5 : 4),
      opacity: route.status === "active" ? 0.92 : 0.62,
      dashArray: isCable ? "12 6" : (route.status === "active" ? "" : "8 7"),
    }).bindTooltip(isCable ? `🔌 ${escapeHtml(route.name || "Кабель")}${cableLabel}` : escapeHtml(route.name || "Трасс"), { sticky: true })
      .addTo(networkRouteLayer);
    if (isCable) {
      routeLine.on("click", (e) => {
        window.L.DomEvent.stopPropagation(e);
        if (_iotDrawMode === "feed_connect" && _iotSelectedFeedPointId) {
          iotConnectFeedToSegment(_iotSelectedFeedPointId, Number(route.id));
        } else {
          window.L.popup({ maxWidth: 400 }).setLatLng(e.latlng).setContent(cableRoutePopup(route)).openOn(_iotMap);
        }
      });
    } else {
      routeLine.bindPopup(routePopup(route));
    }
  });
  _iotNetworkPoles.forEach(pole => {
    const coord = coordForStoredPoint(pole);
    if (!coord) return;
    const zoom = _iotMap.getZoom();
    const style = iotPoleZoomStyle(zoom);
    let glow = null;
    if (_iotScadaMode) {
      glow = window.L.circleMarker([coord.lat, coord.lng], {
        radius: style.glow || 0.1,
        color: "rgba(255,230,0,0.18)",
        weight: 0,
        fillOpacity: style.glow ? 0.75 : 0,
        opacity: style.glow ? 1 : 0,
      }).addTo(poleLayer);
    }
    const marker = window.L.marker([coord.lat, coord.lng], { icon: iotPoleIconForZoom(pole, zoom) })
      .bindPopup(polePopup(pole))
      .addTo(poleLayer);
    poleMarkerRefs.push({ marker, glow, pole });
  });
  _iotMap.on("zoomend", () => updateIotPoleMarkerStyles(poleMarkerRefs));
  _iotNetworkPoles.filter(p => p.pole_type === "feed").forEach(feed => {
    const coord = coordForStoredPoint(feed);
    if (!coord) return;
    const feedIcon = window.L.divIcon({
      className: "",
      html: `<div style="width:28px;height:28px;border-radius:50%;background:#f59e0b;border:3px solid #fff;box-shadow:0 0 0 3px #f59e0b88,0 4px 12px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;font-size:14px">⚡</div>`,
      iconSize: [28, 28], iconAnchor: [14, 14],
    });
    window.L.marker([coord.lat, coord.lng], { icon: feedIcon })
      .bindPopup(polePopup(feed)).addTo(feedLayer);
    const route = feed.route_id ? _iotNetworkRoutes.find(r => Number(r.id) === Number(feed.route_id)) : null;
    const routeGeo = route ? routeGeometry(route) : [];
    const routePoles = _iotNetworkPoles.filter(p => Number(p.route_id) === Number(feed.route_id) && p.pole_type !== "feed");
    const target = routeGeo.length > 0 ? routeGeo[0]
      : routePoles.length > 0 ? { lat: Number(routePoles[0].gps_lat), lng: Number(routePoles[0].gps_lng) }
      : null;
    if (target) {
      window.L.polyline([[coord.lat, coord.lng], [target.lat, target.lng]], {
        color: _iotScadaMode ? "#fbbf24" : "#f59e0b",
        weight: _iotScadaMode ? 2 : 3,
        dashArray: "6 4",
        opacity: 0.9,
      }).bindTooltip(`⚡ ${escapeHtml(feed.name || "Тэжээл")} → ${escapeHtml(route?.name || "Трасс")}`, { sticky: true })
        .addTo(feedLayer);
    }
  });
  // New feed_point + feeder_cable layer (sl_feed_point table)
  const newFeedPointLayer = window.L.featureGroup().addTo(_iotMap);
  const CHOIBALSAN_BOUNDS = { latMin: 47.85, latMax: 48.25, lngMin: 114.25, lngMax: 114.85 };
  _iotFeedPoints.forEach(fp => {
    const lat = Number(fp.gps_lat), lng = Number(fp.gps_lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    if (lat < CHOIBALSAN_BOUNDS.latMin || lat > CHOIBALSAN_BOUNDS.latMax) return;
    if (lng < CHOIBALSAN_BOUNDS.lngMin || lng > CHOIBALSAN_BOUNDS.lngMax) return;
    const isSelected = Number(_iotSelectedFeedPointId) === Number(fp.id);
    const fpBg = isSelected ? "#ef4444" : "#f59e0b";
    const fpRing = isSelected ? "#ef444488" : "#f59e0b88";
    const fpIconHtml = `<div style="width:32px;height:32px;border-radius:50%;background:${fpBg};border:3px solid #fff;box-shadow:0 0 0 3px ${fpRing},0 4px 12px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;font-size:16px">⚡</div>`;
    const fpIcon = window.L.divIcon({ className: "", html: fpIconHtml, iconSize: [32, 32], iconAnchor: [16, 16] });
    window.L.marker([lat, lng], { icon: fpIcon })
      .on("click", (e) => {
        window.L.DomEvent.stopPropagation(e);
        if (_iotDrawMode === "feed_connect") {
          _iotSelectedFeedPointId = Number(fp.id);
          setIotDrawHint(`⚡ "${escapeHtml(fp.name || "ТП")}" сонгогдлоо · Одоо холбох кабель сегмент (ногоон/улбар шар шугам) дээр дарна уу`);
          renderNetworkWorkspace();
        } else {
          window.L.popup({ maxWidth: 360 }).setLatLng([lat, lng]).setContent(feedPointPopupWithNode(fp)).openOn(_iotMap);
        }
      })
      .bindTooltip(`⚡ ${escapeHtml(fp.name || "ТП")}`, { sticky: true })
      .addTo(newFeedPointLayer);
  });
  _iotFeederCables.forEach(fc => {
    const geo = Array.isArray(fc.geometry) ? fc.geometry : (Array.isArray(fc.geometry_json) ? fc.geometry_json : []);
    if (geo.length < 2) return;
    const wireColor = _iotScadaMode ? "#fbbf24" : "#f97316";
    window.L.polyline(geo.map(p => [Number(p.lat), Number(p.lng)]), {
      color: wireColor, weight: 2, dashArray: "7 4", opacity: 0.88,
    }).on("click", (e) => {
      window.L.DomEvent.stopPropagation(e);
      if (!(_iotDrawMode === "feed_connect" && _iotSelectedFeedPointId)) {
        const fpName = _iotFeedPoints.find(f => Number(f.id) === Number(fc.feed_point_id))?.name || "Тэжээл";
        const segName = _iotNetworkRoutes.find(r => Number(r.id) === Number(fc.cable_segment_id))?.name || "Сегмент";
        const btnS = "border-radius:6px;padding:5px 10px;font-size:12px;font-weight:700;cursor:pointer;border:1px solid";
        window.L.popup().setLatLng(e.latlng).setContent(`<div style="min-width:200px"><div style="font-size:10px;font-weight:800;color:#b45309;text-transform:uppercase;margin-bottom:6px">⚡ ТЭЖЭЭЛИЙН УТАС</div><div style="font-size:13px;font-weight:900;color:#92400e;margin-bottom:8px">${escapeHtml(fpName)} → ${escapeHtml(segName)}</div><button style="${btnS}#fca5a5;background:#fff0f0;color:#b91c1c" onclick="iotDeleteFeederCable(${Number(fc.id)})">🗑 Устгах</button></div>`).openOn(_iotMap);
      }
    })
    .bindTooltip(`⚡ ${escapeHtml(fc.feed_point_name || "Тэжээл")} → ${escapeHtml(fc.segment_name || "Сегмент")}`, { sticky: true })
    .addTo(newFeedPointLayer);
  });

  gatewayLocationsFromRows(_iotRows).forEach(gw => {
    const icon = window.L.divIcon({
      className: "",
      html: `<div style="width:30px;height:30px;border-radius:50%;background:#7c3aed;border:3px solid #fff;box-shadow:0 0 0 3px rgba(124,58,237,.28),0 4px 12px rgba(0,0,0,.28);display:flex;align-items:center;justify-content:center;color:#fff;font-size:15px;font-weight:900">📡</div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });
    const popup = `
      <div style="min-width:230px;font-size:12px;color:#334155">
        <div style="font-size:10px;font-weight:900;color:#6d28d9;text-transform:uppercase;margin-bottom:5px">Unitel gateway antenna</div>
        <div style="font-weight:900;color:#0f172a;margin-bottom:5px">${escapeHtml(gw.gatewayId)}</div>
        <div style="display:grid;grid-template-columns:76px 1fr;gap:4px 8px">
          <span style="color:#64748b">GPS</span><b style="font-family:Consolas,monospace">${fmtNum(gw.lat, 6)}, ${fmtNum(gw.lng, 6)}</b>
          <span style="color:#64748b">RSSI/SNR</span><b>${fmtNum(gw.rssi, 0, " dBm")} / ${fmtNum(gw.snr, 1, " dB")}</b>
          <span style="color:#64748b">Node</span><b>${gw.devices.length} төхөөрөмжийн дохионд харагдсан</b>
        </div>
        <div style="margin-top:8px;color:#92400e;font-size:11px">Энэ нь node-ийн байрлал биш. Дохио хүлээж авсан gateway antenna-ийн байрлал.</div>
      </div>
    `;
    window.L.marker([gw.lat, gw.lng], { icon })
      .bindPopup(popup)
      .bindTooltip(`📡 Unitel gateway · ${escapeHtml(gw.gatewayId)}`, { sticky: true })
      .addTo(gatewayLayer);
  });

  _iotEmployeeLocations.forEach(loc => {
    const coord = employeeMapCoord(loc);
    if (!coord) return;
    if (coord.accuracy !== null && coord.accuracy > 0) {
      window.L.circle([coord.lat, coord.lng], {
        radius: Math.min(Math.max(coord.accuracy, 8), 500),
        color: "#db2777",
        weight: 1,
        fillColor: "#f9a8d4",
        fillOpacity: 0.14,
        opacity: 0.35,
      }).addTo(employeeLayer);
    }
    window.L.marker([coord.lat, coord.lng], { icon: employeeLocationIcon(loc), zIndexOffset: 950 })
      .bindPopup(employeeLocationPopup(loc, coord), { maxWidth: 390 })
      .bindTooltip(`${escapeHtml(loc.full_name || "Ажилтан")} · GPS`, { sticky: true })
      .addTo(employeeLayer);
  });

  window.L.control.layers({}, {
    "ADW төхөөрөмж": _iotMarkers,
    "Трасс / коридор": networkRouteLayer,
    "Шон / pole": poleLayer,
    "⚡ Тэжээлийн цэг": newFeedPointLayer,
    "Ажилтан GPS": employeeLayer,
  }, { position: "topright", collapsed: false }).addTo(_iotMap);
  const fitLayer = window.L.featureGroup([
    ..._iotMarkers.getLayers(),
    ...meterLayer.getLayers(),
    ...lightLayer.getLayers(),
    ...networkRouteLayer.getLayers(),
    ...poleLayer.getLayers(),
    ...employeeLayer.getLayers(),
  ]);
  if (shouldFitToData && fitLayer.getLayers().length) {
    _iotMap.fitBounds(fitLayer.getBounds().pad(0.18), { maxZoom: 15 });
  } else if (shouldFitToData) {
    _iotMap.setView([48.0789, 114.5357], 13);
  }
  redrawIotDraftRoute();
  redrawFeedDraft();
  _iotMap.on("mousemove", (e) => {
    if (_iotDrawMode !== "feed" || !_iotFeedDraft || !_iotFeedDraftLayer) return;
    if (_iotSnapMarker) { _iotFeedDraftLayer.removeLayer(_iotSnapMarker); _iotSnapMarker = null; }
    _iotSnapPoint = null;
    const SNAP_PX = 45;
    const cur = _iotMap.latLngToContainerPoint(e.latlng);
    let bestPt = null, bestDist = SNAP_PX + 1, bestCable = null;
    // Snap to cable segments first; fall back to any route if no cables exist
    const snapTargets = _iotNetworkRoutes.filter(r => r.route_type === "cable").length > 0
      ? _iotNetworkRoutes.filter(r => r.route_type === "cable")
      : _iotNetworkRoutes.filter(r => r.route_type !== "cable");
    snapTargets.forEach(cable => {
      const geo = routeGeometry(cable);
      for (let i = 0; i < geo.length; i++) {
        const pA = _iotMap.latLngToContainerPoint([geo[i].lat, geo[i].lng]);
        const dPt = Math.hypot(pA.x - cur.x, pA.y - cur.y);
        if (dPt < bestDist) { bestDist = dPt; bestPt = geo[i]; bestCable = cable; }
        if (i < geo.length - 1) {
          const pB = _iotMap.latLngToContainerPoint([geo[i+1].lat, geo[i+1].lng]);
          const dx = pB.x - pA.x, dy = pB.y - pA.y;
          const lenSq = dx*dx + dy*dy;
          if (lenSq > 0) {
            const t = Math.max(0, Math.min(1, ((cur.x-pA.x)*dx + (cur.y-pA.y)*dy) / lenSq));
            const projX = pA.x + t*dx, projY = pA.y + t*dy;
            const dSeg = Math.hypot(projX - cur.x, projY - cur.y);
            if (dSeg < bestDist) {
              bestDist = dSeg;
              const ll = _iotMap.containerPointToLatLng([projX, projY]);
              bestPt = { lat: ll.lat, lng: ll.lng };
              bestCable = cable;
            }
          }
        }
      }
    });
    if (bestPt) {
      _iotSnapPoint = bestPt;
      const segLabel = bestCable?.pole_start ? ` · ${bestCable.pole_start}-${bestCable.pole_end} шон` : "";
      _iotSnapMarker = window.L.circleMarker([bestPt.lat, bestPt.lng], {
        radius: 13, color: "#ef4444", weight: 3,
        fillColor: "rgba(254,202,202,0.85)", fillOpacity: 1,
      }).bindTooltip(`📌 ${escapeHtml(bestCable?.name || "Кабель")}${segLabel} — дарж холбоно`, { permanent: true, direction: "top", offset: [0, -16], className: "iot-snap-tip" })
        .addTo(_iotFeedDraftLayer);
      window.L.DomUtil.addClass(_iotMap.getContainer(), "iot-cursor-snap");
      // Track which cable is being snapped to
      if (bestCable) _iotFeedConnectRouteId = Number(bestCable.id);
    } else {
      window.L.DomUtil.removeClass(_iotMap.getContainer(), "iot-cursor-snap");
    }
  });
  _iotMap.on("click", async (e) => {
    if (_iotSplitMode) { await iotSplitCableAt(e.latlng); return; }
    if (_iotDrawMode === "route") {
      _iotDraftRoute.push({ lat: e.latlng.lat, lng: e.latlng.lng });
      redrawIotDraftRoute();
      const totalM = routeLengthMeters(_iotDraftRoute);
      const spacingM = routeSpacingMeters(_iotDraftRoute, selectedRoutePoleCount());
      setIotDrawHint(`${_iotDraftRoute.length} трасс цэг · Нийт урт: ${formatRouteLength(totalM)} · Зай: ${spacingM ? Math.round(spacingM) + " м" : "-"} · Цагаан цэгийг чирж засна`);
    } else if (_iotDrawMode === "pole") {
      await iotCreatePoleAt(e.latlng);
    } else if (_iotDrawMode === "feed_place") {
      await iotPlaceFeedPoint(e.latlng);
    }
  });
  setTimeout(() => _iotMap?.invalidateSize(), 80);
}

function setIotDrawHint(text) {
  const el = document.getElementById("iotDrawHint");
  if (el) el.textContent = text;
}

function draftPointIcon(index) {
  return window.L.divIcon({
    className: "iot-draft-point-wrap",
    html: `<div class="iot-draft-point">${index + 1}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function routeSegmentDistance(a, b) {
  if (!_iotMap) return 0;
  return _iotMap.distance([a.lat, a.lng], [b.lat, b.lng]);
}

function routeLengthMeters(route) {
  if (!Array.isArray(route) || route.length < 2 || !_iotMap) return 0;
  let total = 0;
  for (let i = 0; i < route.length - 1; i += 1) {
    total += routeSegmentDistance(route[i], route[i + 1]);
  }
  return total;
}

function formatRouteLength(meters) {
  const n = Number(meters);
  if (!Number.isFinite(n) || n <= 0) return "0 м";
  return n >= 1000 ? `${(n / 1000).toFixed(2)} км` : `${Math.round(n)} м`;
}

function routeSpacingMeters(route, poleCount) {
  const length = routeLengthMeters(route);
  const count = Number(poleCount);
  if (!length || !Number.isFinite(count) || count < 2) return 0;
  return length / (count - 1);
}

function updateDraftRouteMetrics() {
  const el = document.getElementById("iotRouteMetrics");
  if (!el) return;
  const poleCount = selectedRoutePoleCount();
  const totalM = routeLengthMeters(_iotDraftRoute);
  const spacingM = routeSpacingMeters(_iotDraftRoute, poleCount);
  el.textContent = `Нийт урт: ${formatRouteLength(totalM)} · Хоорондын зай: ${spacingM ? Math.round(spacingM) + " м" : "-"} · Авто шон: ${poleCount}`;
}

function pointsAlongRoute(route, count) {
  if (!Array.isArray(route) || route.length < 2 || count <= 0) return [];
  if (count === 1) {
    const mid = pointsAlongRoute(route, 3)[1];
    return mid ? [mid] : [];
  }
  const segments = [];
  let total = 0;
  for (let i = 0; i < route.length - 1; i += 1) {
    const distance = routeSegmentDistance(route[i], route[i + 1]);
    if (distance <= 0) continue;
    segments.push({ from: route[i], to: route[i + 1], distance, start: total });
    total += distance;
  }
  if (!total) return [];
  return Array.from({ length: count }, (_, index) => {
    const target = count === 1 ? total / 2 : (total * index) / (count - 1);
    const seg = segments.find(s => target <= s.start + s.distance) || segments[segments.length - 1];
    const ratio = Math.max(0, Math.min(1, (target - seg.start) / seg.distance));
    return {
      lat: seg.from.lat + (seg.to.lat - seg.from.lat) * ratio,
      lng: seg.from.lng + (seg.to.lng - seg.from.lng) * ratio,
    };
  });
}

function currentSelectedNetworkRoute() {
  if (_iotFeedConnectRouteId) {
    const selected = _iotNetworkRoutes.find(r => Number(r.id) === Number(_iotFeedConnectRouteId));
    if (selected && selected.route_type !== "cable") return selected;
  }
  if (_iotEditingRouteId) {
    const editing = _iotNetworkRoutes.find(r => Number(r.id) === Number(_iotEditingRouteId));
    if (editing && editing.route_type !== "cable") return editing;
  }
  const name = normIotText(currentNetworkName());
  const category = currentNetworkCategory();
  return _iotNetworkRoutes.find(r => {
    if (r.route_type === "cable") return false;
    const routeName = normIotText(r.name);
    return routeName && name && (routeName === name || routeName.includes(name) || name.includes(routeName));
  }) || _iotNetworkRoutes.find(r => r.route_type !== "cable" && r.route_type === category) || null;
}

function routePoleCoordinates(route) {
  if (!route) return [];
  const routeId = Number(route.id);
  const stored = _iotNetworkPoles
    .filter(p => Number(p.route_id) === routeId && p.pole_type !== "feed")
    .map((p, index) => ({ ...p, _num: iotPoleNumber(p, index), _coord: coordForStoredPoint(p) }))
    .filter(p => p._coord)
    .sort((a, b) => a._num - b._num)
    .map(p => p._coord);
  if (stored.length) return stored;
  const count = Number(route.lamp_count || selectedRoutePoleCount() || 0);
  return pointsAlongRoute(routeGeometry(route), count);
}

function cableGeometryForPoleRange(feedPoint, route, poleStart, poleEnd) {
  const coords = routePoleCoordinates(route);
  if (!feedPoint || !coords.length) return [];
  const startIndex = Math.max(0, Number(poleStart || 1) - 1);
  const endIndex = Math.min(coords.length - 1, Math.max(startIndex, Number(poleEnd || poleStart || 1) - 1));
  const segment = coords.slice(startIndex, endIndex + 1);
  if (!segment.length) return [];
  const path = [{ lat: feedPoint.lat, lng: feedPoint.lng }];
  const first = segment[0];
  if (Math.hypot(first.lat - feedPoint.lat, first.lng - feedPoint.lng) > 0.0000001) {
    path.push({ lat: first.lat, lng: first.lng });
  }
  segment.slice(1).forEach(p => path.push({ lat: p.lat, lng: p.lng }));
  return path;
}

function redrawIotDraftRoute() {
  if (!_iotMap || !_iotDraftLayer) return;
  _iotDraftLayer.clearLayers();
  if (_iotDraftRoute.length >= 2) {
    const bearing = corridorBearing(_iotDraftRoute);
    if (_iotDualSide && bearing !== null) {
      // Хоёр тал горимд centerline + A/B offset preview харуулна
      const offsets = sideOffsetBearing(bearing);
      const halfWidth = (_iotRoadWidth || 14) / 2;
      const lineA = _iotDraftRoute.map(p => { const o = offsetPoint(p.lat, p.lng, offsets.a, halfWidth); return [o.lat, o.lng]; });
      const lineB = _iotDraftRoute.map(p => { const o = offsetPoint(p.lat, p.lng, offsets.b, halfWidth); return [o.lat, o.lng]; });
      // Centerline — саарал тасархай
      window.L.polyline(_iotDraftRoute.map(p => [p.lat, p.lng]), {
        color: "#94a3b8", weight: 1, opacity: 0.6, dashArray: "4 6",
      }).addTo(_iotDraftLayer);
      // A тал — шар
      window.L.polyline(lineA, { color: "#f59e0b", weight: 3, opacity: 0.9, dashArray: "8 5" }).addTo(_iotDraftLayer);
      // B тал — ягаан
      window.L.polyline(lineB, { color: "#a78bfa", weight: 3, opacity: 0.9, dashArray: "8 5" }).addTo(_iotDraftLayer);
    } else {
      const routeColor = _iotScadaMode ? "#00e5ff" : "#2563eb";
      const routeWeight = _iotScadaMode ? 3 : 4;
      if (_iotScadaMode) {
        window.L.polyline(_iotDraftRoute.map(p => [p.lat, p.lng]), {
          color: "rgba(0,229,255,0.25)", weight: 9, opacity: 1,
        }).addTo(_iotDraftLayer);
      }
      window.L.polyline(_iotDraftRoute.map(p => [p.lat, p.lng]), {
        color: routeColor, weight: routeWeight, opacity: 0.9, dashArray: "8 5",
      }).addTo(_iotDraftLayer);
    }
  }
  const poleCount = selectedRoutePoleCount();
  const autoPoles = pointsAlongRoute(_iotDraftRoute, poleCount);
  const poleRadius = _iotScadaMode ? 7 : 4;
  if (_iotDualSide && _iotDraftRoute.length >= 2) {
    const bearing = corridorBearing(_iotDraftRoute);
    const offsets = sideOffsetBearing(bearing);
    const halfWidth = (_iotRoadWidth || 14) / 2;
    autoPoles.forEach((p, index) => {
      const pA = offsetPoint(p.lat, p.lng, offsets.a, halfWidth);
      const pB = offsetPoint(p.lat, p.lng, offsets.b, halfWidth);
      window.L.circleMarker([pA.lat, pA.lng], { radius: poleRadius, color: "#92400e", weight: 1, fillColor: "#f59e0b", fillOpacity: 1 })
        .bindTooltip(`A-${String(index + 1).padStart(3, "0")}`, { permanent: false, direction: "top", offset: [0, -6] })
        .addTo(_iotDraftLayer);
      window.L.circleMarker([pB.lat, pB.lng], { radius: poleRadius, color: "#6d28d9", weight: 1, fillColor: "#a78bfa", fillOpacity: 1 })
        .bindTooltip(`B-${String(index + 1).padStart(3, "0")}`, { permanent: false, direction: "top", offset: [0, -6] })
        .addTo(_iotDraftLayer);
    });
  } else {
    const poleColor = _iotScadaMode ? "#ffe600" : "#facc15";
    const poleBorder = _iotScadaMode ? "#ff9900" : "#92400e";
    autoPoles.forEach((p, index) => {
      if (_iotScadaMode) {
        window.L.circleMarker([p.lat, p.lng], {
          radius: 12, color: "rgba(255,230,0,0.2)", weight: 0, fillOpacity: 1,
        }).addTo(_iotDraftLayer);
      }
      window.L.circleMarker([p.lat, p.lng], {
        radius: poleRadius, color: poleBorder, weight: _iotScadaMode ? 2 : 1, fillColor: poleColor, fillOpacity: 1,
      }).bindTooltip(`Шон ${index + 1}`, { permanent: _iotScadaMode && poleCount <= 30, direction: "top", offset: [0, -8] })
        .addTo(_iotDraftLayer);
    });
  }
  _iotDraftRoute.forEach((p, index) => {
    window.L.marker([p.lat, p.lng], {
      icon: draftPointIcon(index),
      draggable: true,
      autoPan: true,
    })
      .on("dragend", (event) => {
        const pos = event.target.getLatLng();
        _iotDraftRoute[index] = { lat: pos.lat, lng: pos.lng };
        redrawIotDraftRoute();
        const el = document.getElementById("iotPoleCount");
        if (el) el.textContent = `🔦 Шон: ${selectedRoutePoleCount()}`;
      })
      .on("click", event => window.L.DomEvent.stopPropagation(event))
      .bindTooltip("Чирж байрлалыг өөрчилнэ", { permanent: false })
      .addTo(_iotDraftLayer);
  });
  updateDraftRouteMetrics();
  iotUpdateDualSideLabel();
}

function updateIotDrawButtons() {
  document.querySelectorAll(".iot-network-tools button").forEach(btn => btn.classList.remove("is-active", "iot-feed-active"));
  const saveBtn = document.getElementById("iotSaveBtn");
  document.querySelectorAll(".iot-network-tools button").forEach(b => b.classList.remove("is-active", "iot-feed-active"));
  if (_iotDrawMode === "route") {
    document.querySelector(".iot-network-tools button[onclick=\"iotSetDrawMode('route')\"]")?.classList.add("is-active");
  } else if (_iotDrawMode === "pole") {
    document.querySelector(".iot-network-tools button[onclick=\"iotSetDrawMode('pole')\"]")?.classList.add("is-active");
  } else if (_iotDrawMode === "feed_place") {
    document.getElementById("iotFeedPlaceBtn")?.classList.add("is-active", "iot-feed-active");
  } else if (_iotDrawMode === "feed_connect") {
    document.getElementById("iotFeedConnectBtn")?.classList.add("is-active", "iot-feed-active");
  }
  if (_iotSplitMode) document.getElementById("iotSplitModeBtn")?.classList.add("is-active", "iot-btn-split-active");
  if (saveBtn) {
    saveBtn.onclick = () => iotSaveDraftRoute();
    saveBtn.title = "Трасс болон шонгуудыг хадгалах";
  }
}

function iotSetDrawMode(mode) {
  _iotDrawMode = _iotDrawMode === mode ? "" : mode;
  _iotSelectedFeedPointId = null;
  if (_iotDrawMode !== "") _iotSplitMode = false;
  updateIotDrawButtons();
  if (_iotDrawMode === "route") setIotDrawHint(`Газрын зураг дээр дарж трасс цэг нэмнэ · Авто шон: ${selectedRoutePoleCount()}`);
  else if (_iotDrawMode === "pole") setIotDrawHint("Газрын зураг дээр дарж шон байрлуулна.");
  else if (_iotDrawMode === "feed_place") setIotDrawHint("⚡ Газрын зурагт дарж тэжээлийн цэг (ТП / щит / тоолуур) байрлуулна уу");
  else if (_iotDrawMode === "feed_connect") setIotDrawHint("🔗 1-р алхам: Тэжээлийн цэг (⚡ шар бөмбөлөг) дээр дарна уу");
  else setIotDrawHint("Трасс зурах эсвэл шон цэг тэмдэглэх горимоо сонгоно уу.");
}

function iotStartFeedConnect(feedPointId) {
  const fp = _iotFeedPoints.find(row => Number(row.id) === Number(feedPointId));
  _iotDrawMode = "feed_connect";
  _iotSelectedFeedPointId = Number(feedPointId);
  _iotSplitMode = false;
  _iotMap?.closePopup();
  updateIotDrawButtons();
  setIotDrawHint(`⚡ "${fp?.name || "Тэжээл"}" сонгогдлоо · Холбох кабель сегмент дээр дарна уу`);
  renderNetworkWorkspace();
}

function iotClearDraft() {
  _iotDraftRoute = [];
  _iotFeedDraft = null;
  _iotCablePath = [];
  _iotSnapPoint = null;
  _iotSnapMarker = null;
  redrawIotDraftRoute();
  if (_iotFeedDraftLayer) _iotFeedDraftLayer.clearLayers();
  if (_iotMap) window.L.DomUtil.removeClass(_iotMap.getContainer(), "iot-cursor-snap");
  const el = document.getElementById("iotPoleCount");
  if (el) el.textContent = `🔦 Шон: ${selectedRoutePoleCount()}`;
  setIotDrawHint("Ноорог арилгагдлаа.");
}

async function iotSaveDraftRoute() {
  if (_iotDraftRoute.length < 2) {
    toast("Трасс хадгалахад 2-оос дээш цэг хэрэгтэй");
    return;
  }
  const name = currentNetworkName() || `Lighting route ${new Date().toLocaleString("mn-MN")}`;
  const category = currentNetworkCategory();
  const meter_no = currentNetworkMeterNo();
  const poleCount = selectedRoutePoleCount();
  const autoPoles = pointsAlongRoute(_iotDraftRoute, poleCount);
  if (!poleCount) {
    toast("Сонгосон гудамж дээр шонгийн тоо бүртгэлгүй байна");
    return;
  }
  if (autoPoles.length !== poleCount) {
    toast(`Авто шон бүрэн үүссэнгүй: ${autoPoles.length}/${poleCount}`);
    return;
  }
  const route = await api("/api/sl-network/routes", {
    method: "POST",
    body: JSON.stringify({
      name,
      meter_no,
      route_type: category,
      status: "draft",
      color: "#f59e0b",
      lamp_count: poleCount,
      geometry: _iotDraftRoute,
    }),
  });
  if (route?.id && autoPoles.length) {
    const prefix = selectedRouteCode() || name;
    const bearing = corridorBearing(_iotDraftRoute);
    const labelA = sideLabel("A", bearing);
    const labelB = sideLabel("B", bearing);

    if (_iotDualSide) {
      // Хоёр тал: centerline-аас перпендикуляр offset хийж A/B тусдаа route үүснэ
      const offsets = sideOffsetBearing(bearing);
      const halfWidth = (_iotRoadWidth || 14) / 2;
      const autoPolesA = autoPoles.map(p => offsetPoint(p.lat, p.lng, offsets.a, halfWidth));
      const autoPolesB = autoPoles.map(p => offsetPoint(p.lat, p.lng, offsets.b, halfWidth));
      const [routeA, routeB] = await Promise.all([
        api("/api/sl-network/routes", { method: "POST", body: JSON.stringify({
          name: `${name} (${labelA})`, meter_no, route_type: category, status: "draft",
          color: "#f59e0b", lamp_count: poleCount, geometry: autoPolesA,
        }) }),
        api("/api/sl-network/routes", { method: "POST", body: JSON.stringify({
          name: `${name} (${labelB})`, meter_no, route_type: category, status: "draft",
          color: "#a78bfa", lamp_count: poleCount, geometry: autoPolesB,
        }) }),
      ]);
      if (routeA?.id) {
        await Promise.all(autoPolesA.map((p, i) => api("/api/sl-network/poles", { method: "POST", body: JSON.stringify({
          code: `${prefix}-A-${String(i + 1).padStart(3, "0")}`,
          name: `${name} ${labelA} шон ${i + 1}`,
          meter_no, route_id: routeA.id, gps_lat: p.lat, gps_lng: p.lng,
          pole_type: "auto", status: "active", display_code: `A-${String(i + 1).padStart(3, "0")}`,
        }) })));
        await api("/api/sl-network/routes", { method: "POST", body: JSON.stringify({
          name: `Кабель: ${name} ${labelA}`, meter_no, route_type: "cable", status: "active",
          color: "#22c55e", parent_route_id: routeA.id, pole_start: 1, pole_end: poleCount, geometry: autoPolesA,
        }) });
      }
      if (routeB?.id) {
        await Promise.all(autoPolesB.map((p, i) => api("/api/sl-network/poles", { method: "POST", body: JSON.stringify({
          code: `${prefix}-B-${String(i + 1).padStart(3, "0")}`,
          name: `${name} ${labelB} шон ${i + 1}`,
          meter_no, route_id: routeB.id, gps_lat: p.lat, gps_lng: p.lng,
          pole_type: "auto", status: "active", display_code: `B-${String(i + 1).padStart(3, "0")}`,
        }) })));
        await api("/api/sl-network/routes", { method: "POST", body: JSON.stringify({
          name: `Кабель: ${name} ${labelB}`, meter_no, route_type: "cable", status: "active",
          color: "#22c55e", parent_route_id: routeB.id, pole_start: 1, pole_end: poleCount, geometry: autoPolesB,
        }) });
      }
      // Delete the original single-side placeholder route
      if (route.id) await api(`/api/sl-network/routes/${route.id}`, { method: "DELETE" });
    } else {
      // Нэг тал
      await Promise.all(autoPoles.map((p, index) => api("/api/sl-network/poles", {
        method: "POST",
        body: JSON.stringify({
          code: `${prefix}-${String(index + 1).padStart(3, "0")}`,
          name: `${name} shon ${index + 1}`,
          meter_no, route_id: route.id, gps_lat: p.lat, gps_lng: p.lng,
          pole_type: "auto", status: "active",
        }),
      })));
      await api("/api/sl-network/routes", {
        method: "POST",
        body: JSON.stringify({
          name: `Кабель: ${name}`, meter_no, route_type: "cable", status: "active",
          color: "#ef4444", parent_route_id: route.id, pole_start: 1, pole_end: poleCount, geometry: autoPoles,
        }),
      });
    }
  }
  _iotDraftRoute = [];
  _iotDrawMode = "";
  const sides = _iotDualSide ? "хоёр тал (A/B)" : "нэг тал";
  toast(autoPoles.length ? `Трасс + ${autoPoles.length} шон + кабель (${sides}) хадгаглагдлаа` : "Трасс хадгаглагдлаа");
  refreshFeedPointPopup(feedPointId);
  setTimeout(() => iotRefresh().catch(err => console.warn("Feed point device refresh failed", err)), 600);
}

async function iotCreatePoleAt(latlng) {
  const code = prompt("Шонгийн код / нэр оруулна уу");
  if (code === null) return;
  const clean = String(code || "").trim();
  const feed = await api("/api/sl-network/poles", {
    method: "POST",
    body: JSON.stringify({
      code: clean || null,
      name: clean || "Pole",
      meter_no: currentNetworkMeterNo() || null,
      gps_lat: latlng.lat,
      gps_lng: latlng.lng,
      status: "active",
    }),
  });
  toast("Шонгийн цэг хадгаглагдлаа");
  refreshFeedPointPopup(feedPointId);
  setTimeout(() => iotRefresh().catch(err => console.warn("Feed point device refresh failed", err)), 600);
}

async function iotDeleteNetworkRoute(id) {
  if (!confirm("Энэ трассыг устгах уу?")) return;
  await api(`/api/sl-network/routes/${id}`, { method: "DELETE" });
  toast("Трасс устгагдлаа");
  await iotRefresh();
}

async function iotDeleteNetworkPole(id) {
  if (!confirm("Энэ шонг устгах уу?")) return;
  await api(`/api/sl-network/poles/${id}`, { method: "DELETE" });
  toast("Шон устгагдлаа");
  await iotRefresh();
}

function iotPoleNumber(pole, fallbackIndex = 0) {
  const m = String(`${pole?.code || ""} ${pole?.name || ""}`).match(/(\d+)(?!.*\d)/);
  return m ? Number(m[1]) : fallbackIndex + 1;
}

function iotHighlightFeed(feedId, cableId = null) {
  if (!_iotMap) return;
  if (!_iotFeedHighlightLayer) _iotFeedHighlightLayer = window.L.featureGroup().addTo(_iotMap);
  _iotFeedHighlightLayer.clearLayers();
  const feed = _iotNetworkPoles.find(p => Number(p.id) === Number(feedId));
  const cable = cableId
    ? _iotNetworkRoutes.find(r => Number(r.id) === Number(cableId))
    : _iotNetworkRoutes.find(r => Number(r.feed_pole_id) === Number(feedId));
  const routeId = Number(cable?.parent_route_id || feed?.route_id || 0);
  const start = Number(cable?.pole_start || 1);
  const end = Number(cable?.pole_end || start);
  const poles = _iotNetworkPoles
    .filter(p => Number(p.route_id) === routeId && p.pole_type !== "feed")
    .map((p, index) => ({ ...p, _num: iotPoleNumber(p, index) }))
    .filter(p => p._num >= start && p._num <= end);
  const bounds = [];
  poles.forEach(p => {
    const coord = coordForStoredPoint(p);
    if (!coord) return;
    bounds.push([coord.lat, coord.lng]);
    window.L.circleMarker([coord.lat, coord.lng], {
      radius: 9,
      color: "#f59e0b",
      weight: 3,
      fillColor: "#fff7ed",
      fillOpacity: 0.85,
    }).bindTooltip(`⚡ ${feed?.name || "Тэжээл"} · ${p._num}-р шон`, { permanent: false }).addTo(_iotFeedHighlightLayer);
  });
  if (feed) {
    const coord = coordForStoredPoint(feed);
    if (coord) {
      bounds.push([coord.lat, coord.lng]);
      window.L.circleMarker([coord.lat, coord.lng], {
        radius: 13,
        color: "#f97316",
        weight: 4,
        fillColor: "#fbbf24",
        fillOpacity: 0.95,
      }).bindTooltip(`⚡ ${feed.name || "Тэжээл"}`, { permanent: true, direction: "top" }).addTo(_iotFeedHighlightLayer);
    }
  }
  if (bounds.length) _iotMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
  setIotDrawHint(`⚡ ${feed?.name || "Тэжээл"}: ${start}-${end} шон · нийт ${poles.length} шон тодорлоо`);
}

function iotUpdatePoleSpacing(value) {
  const n = Number(value);
  if (Number.isFinite(n) && n >= 5) _iotPoleSpacingM = n;
  const el = document.getElementById("iotPoleCount");
  if (el) el.textContent = `🔦 Шон: ${selectedRoutePoleCount()}`;
  redrawIotDraftRoute();
}

function iotOnRouteNameChange() {
  currentNetworkName();
  const el = document.getElementById("iotPoleCount");
  if (el) el.textContent = `🔦 Шон: ${selectedRoutePoleCount()}`;
}

function iotToggleScadaMode() {
  _iotScadaMode = !_iotScadaMode;
  document.body.classList.toggle("iot-scada", _iotScadaMode);
  const mapEl = document.querySelector(".iot-map-shell");
  if (mapEl) mapEl.classList.toggle("scada", _iotScadaMode);
  if (_iotMap) {
    _iotMap.eachLayer(layer => {
      if (layer._url) _iotMap.removeLayer(layer);
    });
    const darkTile = window.L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      { maxZoom: 20, attribution: "&copy; OpenStreetMap &copy; CARTO" }
    );
    const satTile = window.L.tileLayer(
      "https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
      { maxZoom: 20, subdomains: ["0", "1", "2", "3"], attribution: "&copy; Google" }
    );
    (_iotScadaMode ? darkTile : satTile).addTo(_iotMap);
    setTimeout(() => _iotMap?.invalidateSize(), 80);
  }
  const btn = document.querySelector(".iot-network-tools button[onclick='iotToggleScadaMode()']");
  if (btn) btn.classList.toggle("is-active", _iotScadaMode);
  redrawIotDraftRoute();
}

async function iotAutoLoadRoute() {
  const name = currentNetworkName();
  if (!name) { toast("Эхлээд гудамжаа сонгоно уу"); return; }
  const existingRoute = _iotNetworkRoutes.find(r =>
    r.name === name || r.meter_no === name
  );
  if (existingRoute) {
    const geo = routeGeometry(existingRoute);
    if (geo.length >= 2) {
      _iotDraftRoute = geo.map(p => ({ lat: p.lat, lng: p.lng }));
      redrawIotDraftRoute();
      const el = document.getElementById("iotPoleCount");
      if (el) el.textContent = `🔦 Шон: ${selectedRoutePoleCount()}`;
      setIotDrawHint(`"${name}" трасс ачаалагдлаа · ${_iotDraftRoute.length} цэг · ${selectedRoutePoleCount()} шон`);
      return;
    }
  }
  await iotFetchOsmRouteGeometry(name);
}

async function iotLoadRouteToEdit(routeId) {
  const route = _iotNetworkRoutes.find(r => Number(r.id) === routeId);
  if (!route) return;
  const geo = routeGeometry(route);
  if (geo.length >= 2) {
    _iotDraftRoute = geo.map(p => ({ lat: p.lat, lng: p.lng }));
    _iotWorkName = route.name || "";
    redrawIotDraftRoute();
    const el = document.getElementById("iotPoleCount");
    if (el) el.textContent = `🔦 Шон: ${selectedRoutePoleCount()}`;
    setIotDrawHint(`"${route.name}" трасс засах горимд ачаалагдлаа · Хадгалахад шинэ трасс үүснэ`);
  }
  _iotMap?.closePopup();
}

let _iotEditLayer = null;
let _iotEditingRouteId = null;

async function iotEditPoles(routeId) {
  _iotEditingRouteId = routeId;
  const route = _iotNetworkRoutes.find(r => Number(r.id) === routeId);
  if (!_iotMap) return;
  if (_iotEditLayer) { _iotEditLayer.clearLayers(); }
  else { _iotEditLayer = window.L.featureGroup().addTo(_iotMap); }
  _iotEditLayer.clearLayers();
  const poles = _iotNetworkPoles.filter(p => Number(p.route_id) === routeId && p.pole_type !== "feed");
  if (!poles.length) { toast("Энэ трасст хадгалагдсан шон алга"); return; }
  poles.forEach((pole, idx) => {
    const coord = coordForStoredPoint(pole);
    if (!coord) return;
    const editIcon = window.L.divIcon({
      className: "",
      html: `<div style="width:22px;height:22px;border-radius:50%;background:#fde047;border:3px solid #1f6fb2;box-shadow:0 0 0 3px rgba(31,111,178,.3);cursor:move;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:900;color:#0f172a">${idx+1}</div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });
    window.L.marker([coord.lat, coord.lng], { icon: editIcon, draggable: true })
      .bindTooltip(`${pole.name || pole.code || "Шон " + (idx+1)} · Чирж байрлалыг өөрчилнэ`, { permanent: false })
      .on("dragend", async (e) => {
        const pos = e.target.getLatLng();
        await api(`/api/sl-network/poles/${pole.id}`, {
          method: "PUT",
          body: JSON.stringify({ gps_lat: pos.lat, gps_lng: pos.lng }),
        });
        pole.gps_lat = pos.lat;
        pole.gps_lng = pos.lng;
        toast(`Шон ${idx+1} байрлал хадгаглагдлаа`);
      })
      .addTo(_iotEditLayer);
  });
  if (_iotEditLayer.getLayers().length) {
    _iotMap.fitBounds(_iotEditLayer.getBounds().pad(0.15), { maxZoom: 17 });
  }
  setIotDrawHint(`"${route?.name}" — ${poles.length} шонгийн байрлал засах горим · Шонг чирж шинэчилнэ`);
  _iotMap.closePopup();
}

async function iotStopEditPoles() {
  if (_iotEditLayer) { _iotEditLayer.clearLayers(); }
  _iotEditingRouteId = null;
  setIotDrawHint("Шон засах горимоос гарлаа.");
  await iotRefresh();
}

function iotToggleRouteEdit(routeId, totalM) {
  const view = document.getElementById(`routeStatView_${routeId}`);
  const form = document.getElementById(`routeEditForm_${routeId}`);
  if (!view || !form) return;
  const open = form.style.display === "none";
  form.style.display = open ? "" : "none";
  view.style.display = open ? "none" : "";
}

function iotRouteEditCalc(routeId, totalM, changed) {
  const countEl = document.getElementById(`editPoleCount_${routeId}`);
  const spacingEl = document.getElementById(`editSpacingM_${routeId}`);
  if (!countEl || !spacingEl || totalM <= 0) return;
  if (changed === "count") {
    const n = Math.max(2, parseInt(countEl.value) || 2);
    spacingEl.value = Math.round(totalM / (n - 1));
  } else {
    const s = Math.max(1, parseInt(spacingEl.value) || 1);
    countEl.value = Math.max(2, Math.round(totalM / s) + 1);
  }
}

async function iotRenumberPoles(routeId) {
  const route = _iotNetworkRoutes.find(r => Number(r.id) === routeId);
  const poles = _iotNetworkPoles.filter(p => Number(p.route_id) === routeId && p.pole_type !== "feed");
  if (!confirm(`"${route?.name || "Трасс"}" — ${poles.length} шоныг трасс дагуу 1-ээс ${poles.length} хүртэл дахин дугаарлах уу?`)) return;
  const res = await api(`/api/sl-network/routes/${routeId}/renumber`, { method: "POST" });
  if (res?.ok) {
    toast(`✅ ${res.renumbered} шон дахин дугаарлагдлаа`);
  }
}

async function iotSaveRouteStats(routeId) {
  const countEl = document.getElementById(`editPoleCount_${routeId}`);
  if (!countEl) return;
  const lampCount = Math.max(2, parseInt(countEl.value) || 2);
  await api(`/api/sl-network/routes/${routeId}`, {
    method: "PUT",
    body: JSON.stringify({ lamp_count: lampCount }),
  });
  toast(`Шонгийн тоо хадгалагдлаа: ${lampCount} ш`);
  await iotRefresh();
}

function iotSetFeedConnectRoute(routeId) {
  _iotFeedConnectRouteId = routeId ? Number(routeId) : null;
  redrawFeedDraft();
}

function redrawFeedDraft() {
  if (!_iotFeedDraftLayer) return;
  _iotFeedDraftLayer.clearLayers();
  if (!_iotFeedDraft) return;
  const feedIcon = window.L.divIcon({
    className: "",
    html: `<div style="width:30px;height:30px;border-radius:50%;background:#f59e0b;border:3px solid #fff;box-shadow:0 0 0 4px rgba(245,158,11,.35),0 4px 14px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;font-size:15px">⚡</div>`,
    iconSize: [30, 30], iconAnchor: [15, 15],
  });
  window.L.marker([_iotFeedDraft.lat, _iotFeedDraft.lng], { icon: feedIcon })
    .bindTooltip("⚡ Тэжээлийн цэг · Хадгалахаас өмнөх ноорог", { permanent: false })
    .addTo(_iotFeedDraftLayer);
  if (_iotCablePath.length >= 2) {
    const cableColor = _iotScadaMode ? "#ff6b35" : "#ef4444";
    if (_iotScadaMode) {
      window.L.polyline(_iotCablePath.map(p => [p.lat, p.lng]), {
        color: "rgba(255,107,53,0.2)", weight: 10, opacity: 1,
      }).addTo(_iotFeedDraftLayer);
    }
    window.L.polyline(_iotCablePath.map(p => [p.lat, p.lng]), {
      color: cableColor, weight: 3, dashArray: "10 5", opacity: 0.9,
    }).addTo(_iotFeedDraftLayer);
    _iotCablePath.forEach((p, i) => {
      if (i === 0) return;
      window.L.circleMarker([p.lat, p.lng], {
        radius: i === _iotCablePath.length - 1 ? 6 : 4,
        color: cableColor, weight: 2, fillColor: "#fff", fillOpacity: 1,
      }).bindTooltip(`Кабель ${i + 1}`, { permanent: false })
        .on("click", e => { window.L.DomEvent.stopPropagation(e); _iotCablePath.splice(i, 1); redrawFeedDraft(); })
        .addTo(_iotFeedDraftLayer);
    });
  }
  if (_iotFeedConnectRouteId) {
    const connCable = _iotNetworkRoutes.find(r => Number(r.id) === _iotFeedConnectRouteId);
    const connGeo = connCable ? routeGeometry(connCable) : [];
    const origin = _iotFeedDraft;
    if (connGeo.length > 0 && origin) {
      let nearest = connGeo[0], minD = Infinity;
      connGeo.forEach(pt => {
        const d = Math.hypot(pt.lat - origin.lat, pt.lng - origin.lng);
        if (d < minD) { minD = d; nearest = pt; }
      });
      const segLabel = connCable?.pole_start ? ` · ${connCable.pole_start}-${connCable.pole_end} шон` : "";
      window.L.polyline([[origin.lat, origin.lng], [nearest.lat, nearest.lng]], {
        color: "#f97316", weight: 2, dashArray: "5 4", opacity: 0.8,
      }).bindTooltip(`⚡ → ${escapeHtml(connCable?.name || "Кабель")}${segLabel}`, { sticky: true })
        .addTo(_iotFeedDraftLayer);
      window.L.circleMarker([nearest.lat, nearest.lng], {
        radius: 8, color: "#f97316", weight: 2, fillColor: "#fed7aa", fillOpacity: 1,
      }).bindTooltip(`Холболтын цэг${segLabel}`, { permanent: true, direction: "top", offset: [0, -10] })
        .addTo(_iotFeedDraftLayer);
    }
  }
}

async function iotSaveFeedWithCable() {
  if (!_iotFeedDraft) { toast("Эхлээд ⚡ Тэжээлийн цэгийг газрын зурагт дарж байрлуулна уу"); return; }
  const name = prompt("Тэжээл авах цэгийн нэр (жишээ: ТП-5, Шит-12)", "ТП");
  if (name === null) return;
  const cleanName = String(name || "").trim() || "ТП";
  const meterNo = currentNetworkMeterNo() || null;

  // Check if connecting to a cable segment (new flow)
  const connCable = _iotFeedConnectRouteId
    ? _iotNetworkRoutes.find(r => Number(r.id) === _iotFeedConnectRouteId && r.route_type === "cable")
    : null;

  if (connCable) {
    // New flow: connect feed to existing cable segment
    const poleStart = Number(connCable.pole_start || 1);
    const poleEnd = Number(connCable.pole_end || poleStart);
    const parentRoute = _iotNetworkRoutes.find(r => Number(r.id) === Number(connCable.parent_route_id));

    // Create feed pole
    const feed = await api("/api/sl-network/poles", {
      method: "POST",
      body: JSON.stringify({
        code: cleanName, name: cleanName, meter_no: meterNo,
        route_id: connCable.parent_route_id || null,
        gps_lat: _iotFeedDraft.lat, gps_lng: _iotFeedDraft.lng,
        pole_type: "feed", status: "active",
      }),
    });
    // Update cable segment: set feed_pole_id
    await api(`/api/sl-network/routes/${connCable.id}`, {
      method: "PUT",
      body: JSON.stringify({ feed_pole_id: feed?.id || null }),
    });
    // Create feed wire route (line from feed point to nearest cable end)
    const cableGeo = routeGeometry(connCable);
    let nearestPt = cableGeo[0] || _iotFeedDraft;
    let minD = Infinity;
    cableGeo.forEach(pt => {
      const d = Math.hypot(pt.lat - _iotFeedDraft.lat, pt.lng - _iotFeedDraft.lng);
      if (d < minD) { minD = d; nearestPt = pt; }
    });
    const wireGeo = [
      { lat: _iotFeedDraft.lat, lng: _iotFeedDraft.lng },
      { lat: nearestPt.lat, lng: nearestPt.lng },
    ];
    await api("/api/sl-network/routes", {
      method: "POST",
      body: JSON.stringify({
        name: `Тэжээл: ${cleanName} → ${connCable.name || "Кабель"}`,
        meter_no: meterNo,
        route_type: "feed_wire",
        status: "active",
        color: "#f97316",
        parent_route_id: connCable.parent_route_id || null,
        feed_pole_id: feed?.id || null,
        pole_start: poleStart,
        pole_end: poleEnd,
        geometry: wireGeo,
      }),
    });
    toast(`⚡ "${cleanName}" тэжээл — ${poleStart}-${poleEnd} шон (${connCable.name || "кабель"}) хадгаглагдлаа`);
  } else {
    // Legacy flow: connect feed to route directly (backward compat)
    const connRoute = currentSelectedNetworkRoute();
    if (!connRoute) {
      toast("Холбох кабель сегментийг сонгоно уу");
      return;
    }
    const routePoleCoords = routePoleCoordinates(connRoute);
    const maxPole = Number(routePoleCoords.length || connRoute?.lamp_count || 0);
    const poleStartRaw = prompt(`Тэжээл хэд дэх шонгоос эхлэх вэ? (1-${maxPole || "?"})`, "1");
    if (poleStartRaw === null) return;
    const poleEndRaw = prompt(`Тэжээл хэд дэх шон хүртэл хамаарах вэ?`, String(maxPole || ""));
    if (poleEndRaw === null) return;
    const poleStart = Math.max(1, Number(poleStartRaw) || 1);
    const poleEnd = Math.max(poleStart, Number(poleEndRaw) || poleStart);
    const cableToSave = cableGeometryForPoleRange(_iotFeedDraft, connRoute, poleStart, poleEnd);
    if (cableToSave.length < 2) { toast("Кабель үүсгэх шонгийн байрлал дутуу байна"); return; }
    const feed = await api("/api/sl-network/poles", {
      method: "POST",
      body: JSON.stringify({
        code: cleanName, name: cleanName, meter_no: meterNo,
        route_id: Number(connRoute.id), gps_lat: _iotFeedDraft.lat, gps_lng: _iotFeedDraft.lng,
        pole_type: "feed", status: "active",
      }),
    });
    await api("/api/sl-network/routes", {
      method: "POST",
      body: JSON.stringify({
        name: `Кабель: ${cleanName} → ${connRoute.name}`,
        meter_no: meterNo,
        route_type: "cable",
        status: "active",
        color: "#ef4444",
        parent_route_id: Number(connRoute.id),
        feed_pole_id: feed?.id || null,
        pole_start: poleStart,
        pole_end: poleEnd,
        geometry: cableToSave,
      }),
    });
    toast(`⚡ "${cleanName}" тэжээлийн цэг + кабель хадгаглагдлаа`);
  }

  _iotFeedDraft = null;
  _iotCablePath = [];
  _iotFeedConnectRouteId = null;
  _iotDrawMode = "";
  if (_iotFeedDraftLayer) _iotFeedDraftLayer.clearLayers();
  updateIotDrawButtons();
  setIotDrawHint("Тэжээл авах цэг хадгаглагдлаа.");
  await iotRefresh();
}

async function iotPlaceFeedPointLegacy(latlng) {
  const name = prompt("Тэжээлийн цэгийн нэр (жишээ: ТП-1, Шит-5, Тоолуур-12)", "ТП");
  if (name === null) return;
  const typeRaw = prompt("Төрөл оруулна уу:\n  tp = Трансформаторын пост\n  panel = Щит/Самбар\n  meter = Тоолуур\n  substation = Дэд станц", "tp");
  if (typeRaw === null) return;
  const validTypes = ["tp", "panel", "meter", "substation"];
  const type = validTypes.includes(typeRaw.trim()) ? typeRaw.trim() : "tp";
  await api("/api/sl-network/feed-points", {
    method: "POST",
    body: JSON.stringify({ name: name.trim() || "ТП", gps_lat: latlng.lat, gps_lng: latlng.lng, type }),
  });
  toast(`⚡ "${name.trim()}" тэжээлийн цэг хадгаглагдлаа`);
  await iotRefresh();
}

async function iotPlaceFeedPoint(latlng) {
  const name = prompt("Тэжээлийн цэгийн нэр (жишээ: ТП-1, Шит-5, Тоолуур-12)", "ТП");
  if (name === null) return;
  const cleanName = name.trim() || "ТП";
  try {
    const saved = await api("/api/sl-network/feed-points", {
      method: "POST",
      body: JSON.stringify({ name: cleanName, gps_lat: latlng.lat, gps_lng: latlng.lng, type: "tp" }),
    });
    _iotFeedPoints.unshift({
      id: saved?.id || `tmp-${Date.now()}`,
      name: cleanName,
      gps_lat: latlng.lat,
      gps_lng: latlng.lng,
      type: "tp",
    });
    renderNetworkWorkspace();
    toast(`⚡ "${cleanName}" тэжээлийн цэг хадгалагдлаа`);
    setTimeout(() => iotRefresh().catch(err => console.warn("Feed point refresh failed", err)), 600);
  } catch (e) {
    console.error("Failed to save feed point", e);
    alert(`Тэжээлийн цэг хадгалахад алдаа гарлаа:\n${e.message || e}`);
    toast(`Тэжээлийн цэг хадгалахад алдаа гарлаа: ${e.message || e}`);
  }
}

async function iotConnectFeedToSegment(feedPointId, cableSegmentId) {
  const fp = _iotFeedPoints.find(f => Number(f.id) === Number(feedPointId));
  const cable = _iotNetworkRoutes.find(r => Number(r.id) === Number(cableSegmentId));
  if (!fp || !cable) { toast("Тэжээлийн цэг эсвэл кабель олдсонгүй"); return; }
  const already = _iotFeederCables.find(fc =>
    Number(fc.feed_point_id) === Number(feedPointId) && Number(fc.cable_segment_id) === Number(cableSegmentId)
  );
  if (already) { toast("Аль хэдийн холбогдсон байна"); return; }
  const fpCoord = { lat: Number(fp.gps_lat), lng: Number(fp.gps_lng) };
  const cableGeo = routeGeometry(cable);
  let nearestPt = cableGeo[0] || fpCoord;
  let minD = Infinity;
  cableGeo.forEach(pt => {
    const d = Math.hypot(pt.lat - fpCoord.lat, pt.lng - fpCoord.lng);
    if (d < minD) { minD = d; nearestPt = pt; }
  });
  await api("/api/sl-network/feeder-cables", {
    method: "POST",
    body: JSON.stringify({
      feed_point_id: feedPointId,
      cable_segment_id: cableSegmentId,
      geometry: [fpCoord, { lat: nearestPt.lat, lng: nearestPt.lng }],
    }),
  });
  _iotSelectedFeedPointId = null;
  _iotDrawMode = "";
  updateIotDrawButtons();
  toast(`⚡ ${fp.name} → ${cable.name || "Кабель"} холбогдлоо`);
  await iotRefresh();
}

async function iotDeleteFeederCable(id) {
  if (!confirm("Тэжээлийн утас холболтыг устгах уу?")) return;
  await api(`/api/sl-network/feeder-cables/${id}`, { method: "DELETE" });
  toast("Тэжээлийн утас устгагдлаа");
  await iotRefresh();
}

async function iotToggleSegmentStatus(segmentId, newStatus) {
  const res = await api(`/api/sl-network/cable-segments/${segmentId}/status`, {
    method: "PUT",
    body: JSON.stringify({ status: newStatus }),
  });
  if (res?.ok) {
    const seg = _iotNetworkRoutes.find(r => Number(r.id) === segmentId);
    const poleCount = seg ? Math.max(0, Number(seg.pole_end || 0) - Number(seg.pole_start || 0) + 1) : 0;
    const label = { on: "АСААЛТТАЙ", off: "УНТРААЛТТАЙ", fault: "ГЭМТЭЛТЭЙ", partial: "ХЭСЭГЧИЛСЭН" }[newStatus] || newStatus;
    toast(`Сегмент ${label} болов${poleCount ? " · " + poleCount + " шон" : ""}`);
    await iotRefresh();
  }
}

async function iotSetSegmentFault(segmentId) {
  const seg = _iotNetworkRoutes.find(r => Number(r.id) === segmentId);
  const current = seg?.segment_status || "on";
  const newStatus = current === "fault" ? "on" : "fault";
  await iotToggleSegmentStatus(segmentId, newStatus);
}

function corridorBearing(geometry) {
  if (!Array.isArray(geometry) || geometry.length < 2) return null;
  const first = geometry[0], last = geometry[geometry.length - 1];
  return ((Math.atan2(last.lng - first.lng, last.lat - first.lat) * 180 / Math.PI) + 360) % 360;
}

function sideLabel(sideKey, bearing) {
  if (bearing === null || bearing === undefined) return sideKey === "A" ? "A тал" : "B тал";
  const isNS = bearing < 45 || bearing >= 315 || (bearing >= 135 && bearing < 225);
  if (isNS) return sideKey === "A" ? "Зүүн тал" : "Баруун тал";
  return sideKey === "A" ? "Хойд тал" : "Урд тал";
}

// Сферийн тригонометр: lat/lng цэгийг bearingDeg чиглэлд distMeters метрээр хазайлгана
function offsetPoint(lat, lng, bearingDeg, distMeters) {
  const R = 6371000;
  const d = distMeters / R;
  const b = bearingDeg * Math.PI / 180;
  const lat1 = lat * Math.PI / 180;
  const lng1 = lng * Math.PI / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lng2 = lng1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: lat2 * 180 / Math.PI, lng: lng2 * 180 / Math.PI };
}

// Коридорын чиглэлээс A/B талын перпендикуляр чиглэлийг тооцно
function sideOffsetBearing(corridorBear) {
  const b = ((corridorBear % 360) + 360) % 360;
  const isNS = (b < 45 || b > 315) || (b > 135 && b < 225);
  // N/S зам: A=Зүүн(90°), B=Баруун(270°); E/W зам: A=Хойд(0°), B=Урд(180°)
  return isNS ? { a: 90, b: 270 } : { a: 0, b: 180 };
}

function iotUpdateDualSideLabel() {
  const el = document.getElementById("iotDualSideLabel");
  const wl = document.getElementById("iotRoadWidthLabel");
  if (el) {
    el.style.display = _iotDualSide ? "" : "none";
    if (_iotDualSide) {
      const bearing = _iotDraftRoute.length >= 2 ? corridorBearing(_iotDraftRoute) : null;
      el.textContent = `A = ${sideLabel("A", bearing)} · B = ${sideLabel("B", bearing)}`;
    }
  }
  if (wl) wl.style.display = _iotDualSide ? "flex" : "none";
}

function feedPointNodeHtml(fp, btnS) {
  const linkedNodes = _iotFeedPointDeviceLinks.filter(link => Number(link.feed_point_id) === Number(fp.id));
  return `
      <div style="font-size:10px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">📡 Шитний ADW төхөөрөмж (${linkedNodes.length} ш)</div>
      ${linkedNodes.length === 0 ? `<div style="font-size:11px;color:#94a3b8;margin-bottom:6px">Энэ шитэнд оноосон ADW төхөөрөмж байхгүй</div>` : ""}
      <div style="display:flex;flex-direction:column;gap:5px;margin-bottom:8px">
        ${linkedNodes.map(link => {
          const dev = _iotRows.find(row => String(row.devEui || "").toUpperCase() === String(link.dev_eui || "").toUpperCase());
          const cmdStatus = dev?.command_confirmation_status;
          const cmdAction = String(dev?.command_action || "").toUpperCase();
          const isPending = ["queued", "txack_received", "ack_received", "pending_confirmation"].includes(cmdStatus) && cmdAction;
          let stateLabel, stateColor;
          if (isPending) {
            stateLabel = cmdAction === "OFF" ? "⏳ гэрэл унтарч байна" : "⏳ гэрэл асаж байна";
            stateColor = "#d97706";
          } else if (dev && !isDeviceOnline(dev)) {
            stateLabel = "Дохио тасарсан";
            stateColor = "#dc2626";
          } else {
            const state = relayState(dev);
            stateLabel = state === "on" ? "Гэрэл ассан" : state === "off" ? "Гэрэл асаагүй" : "Төлөв тодорхойгүй";
            stateColor = state === "on" ? "#16a34a" : state === "off" ? "#dc2626" : "#64748b";
          }
          return `<div style="display:flex;align-items:center;gap:6px;justify-content:space-between;background:#f8fafc;border:1px solid #e2e8f0;border-radius:7px;padding:5px 8px">
            <div style="overflow:hidden">
              <div style="font-size:12px;font-weight:800;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(dev?.deviceName || link.dev_eui)}</div>
              <div style="font-size:10px;color:#64748b;font-family:Consolas,monospace">${escapeHtml(link.dev_eui)} · <span style="color:${stateColor};font-weight:800">${stateLabel}</span></div>
            </div>
            <div style="display:flex;gap:3px;flex-shrink:0">
              <button style="${btnS}#86efac;background:#f0fdf4;color:#166534" onclick="iotSendDownlink('${escapeHtml(link.dev_eui)}','ON')">ON</button>
              <button style="${btnS}#fca5a5;background:#fff0f0;color:#b91c1c" onclick="iotSendDownlink('${escapeHtml(link.dev_eui)}','OFF')">OFF</button>
              <button style="${btnS}#cbd5e1;background:#fff;color:#475569" onclick="iotUnlinkNodeFromFeedPoint(${Number(link.id)})">×</button>
            </div>
          </div>`;
        }).join("")}
      </div>
      <button style="${btnS}#bfdbfe;background:#eff6ff;color:#1d4ed8;margin-bottom:8px" onclick="iotLinkNodeToFeedPoint(${Number(fp.id)})">📡 ADW оноох</button>
      <div style="border-top:1px solid #e5e7eb;margin:8px 0"></div>`;
}

function feedPointPopup(fp) {
  const typeLabel = { panel: "Щит/Самбар", meter: "Тоолуур", substation: "Трансформатор", tp: "ТП" }[fp.type] || fp.type || "";
  const connected = _iotFeederCables.filter(fc => Number(fc.feed_point_id) === Number(fp.id));
  const btnS = "border-radius:6px;padding:4px 8px;font-size:11px;font-weight:700;cursor:pointer;border:1px solid;white-space:nowrap";

  // Derive effective feed point state from linked nodes
  const fpLinks = (_iotFeedPointDeviceLinks || []).filter(link => Number(link.feed_point_id) === Number(fp.id));
  let fpNodeState = null; // null = no nodes, use segment_status from DB
  if (fpLinks.length > 0) {
    const nodeStates = fpLinks.map(link => {
      const dev = (_iotRows || []).find(row => String(row.devEui || "").toUpperCase() === String(link.dev_eui || "").toUpperCase());
      const cmdStatus = dev?.command_confirmation_status;
      const cmdAction = String(dev?.command_action || "").toUpperCase();
      if (["queued", "txack_received", "ack_received", "pending_confirmation"].includes(cmdStatus) && cmdAction) {
        return cmdAction === "OFF" ? "off" : "on";
      }
      return relayState(dev);
    });
    if (nodeStates.some(s => s === "off")) fpNodeState = "off";
    else if (nodeStates.some(s => s === "on")) fpNodeState = "on";
  }

  return `
    <div class="iot-map-popup" style="min-width:280px;max-width:360px">
      <div style="font-size:10px;font-weight:800;color:#b45309;text-transform:uppercase;letter-spacing:.5px">⚡ ТЭЖЭЭЛИЙН ЦЭГ</div>
      <div style="font-size:15px;font-weight:900;color:#92400e;margin:3px 0">${escapeHtml(fp.name || "ТП")}</div>
      ${typeLabel ? `<div style="font-size:11px;color:#64748b;margin-bottom:6px">${typeLabel}</div>` : ""}
      <div style="display:grid;grid-template-columns:auto 1fr;gap:3px 10px;font-size:12px">
        <span style="color:#64748b">GPS</span><span style="font-family:Consolas,monospace;font-size:10px">${Number(fp.gps_lat).toFixed(6)}, ${Number(fp.gps_lng).toFixed(6)}</span>
      </div>
      <div style="border-top:1px solid #e5e7eb;margin:8px 0"></div>
      <div style="font-size:10px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">🔌 Кабель холболт (${connected.length} ш)</div>
      ${connected.length === 0 ? `<div style="font-size:11px;color:#94a3b8;margin-bottom:6px">Холбогдсон кабель байхгүй — "🔗 Холбох" горим ашиглана уу</div>` : ""}
      <div style="display:flex;flex-direction:column;gap:5px;margin-bottom:8px">
        ${connected.map(fc => {
          const seg = _iotNetworkRoutes.find(r => Number(r.id) === Number(fc.cable_segment_id));
          const effectiveStatus = fpNodeState || seg?.segment_status || "on";
          const segStatus = effectiveStatus;
          const statusColor = { on: "#16a34a", off: "#6b7280", fault: "#dc2626", partial: "#d97706" }[segStatus] || "#16a34a";
          const streetName = fc.segment_name || seg?.name || "Холбогдсон гудамж";
          const statusLabel = { on: `${streetName} ассан`, off: `${streetName} асаагүй`, fault: `${streetName} гэмтэлтэй`, partial: `${streetName} хэсэгчилсэн` }[segStatus] || segStatus;
          return `<div style="display:flex;align-items:center;gap:6px;justify-content:space-between;background:#fffbeb;border:1px solid #fde68a;border-radius:7px;padding:5px 8px">
            <div style="overflow:hidden">
              <div style="font-size:12px;font-weight:700;color:#92400e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(streetName)}</div>
              ${fc.pole_start ? `<div style="font-size:10px;color:#64748b">${fc.pole_start}-${fc.pole_end} шон · <span style="color:${statusColor};font-weight:700">${escapeHtml(statusLabel)}</span></div>` : ""}
            </div>
            <button style="${btnS}#fca5a5;background:#fff0f0;color:#b91c1c" onclick="iotDeleteFeederCable(${Number(fc.id)})">✕</button>
          </div>`;
        }).join("")}
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button style="${btnS}#fde68a;background:#fffbeb;color:#92400e" onclick="_iotMap?.closePopup();iotSetDrawMode('feed_connect');_iotSelectedFeedPointId=${Number(fp.id)};setIotDrawHint('⚡ &quot;${escapeHtml(fp.name)}&quot; сонгогдлоо · Холбох кабель сегмент дээр дарна уу');renderNetworkWorkspace()">🔗 Кабель холбох</button>
        <button style="${btnS}#fecaca;background:#fff0f0;color:#b91c1c" onclick="iotDeleteFeedPoint(${Number(fp.id)})">🗑 Устгах</button>
      </div>
    </div>`;
}

function feedPointPopupWithNode(fp) {
  const btnS = "border-radius:6px;padding:4px 8px;font-size:11px;font-weight:700;cursor:pointer;border:1px solid;white-space:nowrap";
  const divider = `<div style="border-top:1px solid #e5e7eb;margin:8px 0"></div>`;
  return feedPointPopup(fp).replace(divider, `${divider}${feedPointNodeHtml(fp, btnS)}`);
}

function refreshFeedPointPopup(feedPointId) {
  const fp = _iotFeedPoints.find(row => Number(row.id) === Number(feedPointId));
  if (!fp || !_iotMap) return;
  const lat = Number(fp.gps_lat);
  const lng = Number(fp.gps_lng);
  window.L.popup({ maxWidth: 360 })
    .setLatLng([lat, lng])
    .setContent(feedPointPopupWithNode(fp))
    .openOn(_iotMap);
}

async function iotDeleteFeedPoint(id) {
  if (!confirm("Энэ тэжээлийн цэгийг устгах уу?")) return;
  await api(`/api/sl-network/feed-points/${id}`, { method: "DELETE" });
  toast("Тэжээлийн цэг устгагдлаа");
  await iotRefresh();
}

async function iotLinkNodePrompt() {
  if (!_iotFeedPoints.length) {
    toast("Эхлээд тэжээлийн цэг үүсгэнэ үү");
    return;
  }
  if (!_iotRows.length) {
    toast("Оноох ADW төхөөрөмж олдсонгүй");
    return;
  }
  const feedList = _iotFeedPoints.map((fp, i) =>
    `${i + 1}. ${fp.name || "ТП"} (${Number(fp.gps_lat).toFixed(5)}, ${Number(fp.gps_lng).toFixed(5)})`
  ).join("\n");
  const feedIdx = Number(prompt(`Аль тэжээлийн цэгт холбох вэ?\n\n${feedList}`, "1"));
  const fp = _iotFeedPoints[feedIdx - 1];
  if (!fp) return;
  await iotLinkNodeToFeedPoint(fp.id);
}

async function iotLinkNodeToFeedPoint(feedPointId) {
  if (!_iotRows.length) {
    toast("Оноох ADW төхөөрөмж олдсонгүй");
    return;
  }
  const nodeList = _iotRows.map((row, i) =>
    `${i + 1}. ${row.deviceName || row.devEui} - ${row.devEui}`
  ).join("\n");
  const nodeIdx = Number(prompt(`Энэ шитэнд аль ADW300/310 төхөөрөмж суурилуулсан бэ?\n\n${nodeList}`, "1"));
  const node = _iotRows[nodeIdx - 1];
  if (!node?.devEui) return;
  const saved = await api("/api/sl-network/feed-point-devices", {
    method: "POST",
    body: JSON.stringify({ feed_point_id: feedPointId, dev_eui: node.devEui, role: "controller" }),
  });
  const devEui = String(node.devEui || "").toUpperCase();
  _iotFeedPointDeviceLinks = _iotFeedPointDeviceLinks.filter(link =>
    !(Number(link.feed_point_id) === Number(feedPointId) && String(link.dev_eui || "").toUpperCase() === devEui)
  );
  _iotFeedPointDeviceLinks.push({
    id: saved?.id || `tmp-${Date.now()}`,
    feed_point_id: feedPointId,
    dev_eui: devEui,
    role: "controller",
  });
  await iotSaveNodeLocationFromFeedPoint(feedPointId, node).catch(err => console.warn("Node location auto-save failed", err));
  toast(`${node.deviceName || node.devEui} тэжээлийн цэгтэй холбогдлоо`);
  await iotRefresh();
}

async function iotUnlinkNodeFromFeedPoint(linkId) {
  if (!confirm("Энэ шитнээс ADW төхөөрөмжийн оноолтыг салгах уу?")) return;
  await api(`/api/sl-network/feed-point-devices/${linkId}`, { method: "DELETE" });
  toast("ADW төхөөрөмжийн оноолт салгагдлаа");
  await iotRefresh();
}

async function iotLinkNodeToFeedPointLive(feedPointId) {
  if (!_iotRows.length) {
    toast("Оноох ADW төхөөрөмж олдсонгүй");
    return;
  }
  const nodeList = _iotRows.map((row, i) =>
    `${i + 1}. ${row.deviceName || row.devEui} - ${row.devEui}`
  ).join("\n");
  const nodeIdx = Number(prompt(`Энэ шитэнд аль ADW300/310 төхөөрөмж суурилуулсан бэ?\n\n${nodeList}`, "1"));
  const node = _iotRows[nodeIdx - 1];
  if (!node?.devEui) return;
  const saved = await api("/api/sl-network/feed-point-devices", {
    method: "POST",
    body: JSON.stringify({ feed_point_id: feedPointId, dev_eui: node.devEui, role: "controller" }),
  });
  const devEui = String(node.devEui || "").toUpperCase();
  _iotFeedPointDeviceLinks = _iotFeedPointDeviceLinks.filter(link =>
    !(Number(link.feed_point_id) === Number(feedPointId) && String(link.dev_eui || "").toUpperCase() === devEui)
  );
  _iotFeedPointDeviceLinks.push({
    id: saved?.id || `tmp-${Date.now()}`,
    feed_point_id: feedPointId,
    dev_eui: devEui,
    role: "controller",
  });
  await iotSaveNodeLocationFromFeedPoint(feedPointId, node).catch(err => console.warn("Node location auto-save failed", err));
  toast(`${node.deviceName || node.devEui} тэжээлийн цэгтэй холбогдлоо`);
  refreshFeedPointPopup(feedPointId);
  setTimeout(() => iotRefresh().catch(err => console.warn("Feed point device refresh failed", err)), 600);
}

async function iotUnlinkNodeFromFeedPointLive(linkId) {
  if (!confirm("Энэ шитнээс ADW төхөөрөмжийн оноолтыг салгах уу?")) return;
  const link = _iotFeedPointDeviceLinks.find(row => Number(row.id) === Number(linkId));
  await api(`/api/sl-network/feed-point-devices/${linkId}`, { method: "DELETE" });
  _iotFeedPointDeviceLinks = _iotFeedPointDeviceLinks.filter(row => Number(row.id) !== Number(linkId));
  toast("ADW төхөөрөмжийн оноолт салгагдлаа");
  if (link) refreshFeedPointPopup(link.feed_point_id);
  setTimeout(() => iotRefresh().catch(err => console.warn("Feed point device refresh failed", err)), 600);
}

async function iotLinkNodePromptLive() {
  if (!_iotFeedPoints.length) {
    toast("Эхлээд тэжээлийн цэг үүсгэнэ үү");
    return;
  }
  const feedList = _iotFeedPoints.map((fp, i) =>
    `${i + 1}. ${fp.name || "ТП"} (${Number(fp.gps_lat).toFixed(5)}, ${Number(fp.gps_lng).toFixed(5)})`
  ).join("\n");
  const feedIdx = Number(prompt(`Аль тэжээлийн цэгт холбох вэ?\n\n${feedList}`, "1"));
  const fp = _iotFeedPoints[feedIdx - 1];
  if (!fp) return;
  await iotLinkNodeToFeedPointLive(fp.id);
}

async function iotLinkNodeToFeedPointReplace(feedPointId) {
  if (!_iotRows.length) {
    toast("Оноох ADW төхөөрөмж олдсонгүй");
    return;
  }
  const current = _iotFeedPointDeviceLinks
    .filter(link => Number(link.feed_point_id) === Number(feedPointId))
    .map(link => _iotRows.find(row => String(row.devEui || "").toUpperCase() === String(link.dev_eui || "").toUpperCase())?.deviceName || link.dev_eui)
    .join(", ");
  const nodeList = _iotRows.map((row, i) =>
    `${i + 1}. ${row.deviceName || row.devEui} - ${row.devEui}`
  ).join("\n");
  const nodeIdx = Number(prompt(`Энэ тэжээлийн цэгийн шитэнд аль ADW300/310 төхөөрөмж суурилуулсан бэ?\nОдоогийн: ${current || "байхгүй"}\n\n${nodeList}\n\nДугаараа оруулна уу:`, ""));
  const node = _iotRows[nodeIdx - 1];
  if (!node?.devEui) return;
  const saved = await api("/api/sl-network/feed-point-devices", {
    method: "POST",
    body: JSON.stringify({ feed_point_id: feedPointId, dev_eui: node.devEui, role: "controller" }),
  });
  const devEui = String(node.devEui || "").toUpperCase();
  _iotFeedPointDeviceLinks = _iotFeedPointDeviceLinks.filter(link => Number(link.feed_point_id) !== Number(feedPointId));
  _iotFeedPointDeviceLinks.push({
    id: saved?.id || `tmp-${Date.now()}`,
    feed_point_id: feedPointId,
    dev_eui: devEui,
    role: "controller",
  });
  await iotSaveNodeLocationFromFeedPoint(feedPointId, node).catch(err => console.warn("Node location auto-save failed", err));
  toast(`${node.deviceName || node.devEui} энэ шитний ADW төхөөрөмжөөр оноогдлоо`);
  refreshFeedPointPopup(feedPointId);
  setTimeout(() => iotRefresh().catch(err => console.warn("Feed point device refresh failed", err)), 600);
}

async function iotLinkNodePromptReplace() {
  if (!_iotFeedPoints.length) {
    toast("Эхлээд тэжээлийн цэг үүсгэнэ үү");
    return;
  }
  const feedList = _iotFeedPoints.map((fp, i) =>
    `${i + 1}. ${fp.name || "ТП"} (${Number(fp.gps_lat).toFixed(5)}, ${Number(fp.gps_lng).toFixed(5)})`
  ).join("\n");
  const feedIdx = Number(prompt(`Аль тэжээлийн цэгийн ADW төхөөрөмжийн оноолтыг солих вэ?\n\n${feedList}\n\nДугаараа оруулна уу:`, ""));
  const fp = _iotFeedPoints[feedIdx - 1];
  if (!fp) return;
  await iotLinkNodeToFeedPointReplace(fp.id);
}

function iotToggleSplitMode() {
  _iotSplitMode = !_iotSplitMode;
  _iotMap?.closePopup();
  if (_iotSplitMode) {
    _iotDrawMode = "";
    updateIotDrawButtons();
    setIotDrawHint("✂ Таслах горим: Кабель сегмент дээр дарж хоёр хэсэгт хуваана · Дахин дарж горимоос гарна");
  } else {
    setIotDrawHint("Таслах горимоос гарлаа.");
  }
  const btn = document.getElementById("iotSplitModeBtn");
  if (btn) {
    btn.classList.toggle("is-active", _iotSplitMode);
    btn.classList.toggle("iot-btn-split-active", _iotSplitMode);
  }
}

async function iotSplitCableAt(latlng) {
  if (!_iotMap) return;
  const SNAP_PX = 35;
  const cur = _iotMap.latLngToContainerPoint(latlng);
  let bestCable = null, bestDist = SNAP_PX + 1;
  _iotNetworkRoutes.filter(r => r.route_type === "cable").forEach(cable => {
    const geo = routeGeometry(cable);
    for (let i = 0; i < geo.length - 1; i++) {
      const pA = _iotMap.latLngToContainerPoint([geo[i].lat, geo[i].lng]);
      const pB = _iotMap.latLngToContainerPoint([geo[i+1].lat, geo[i+1].lng]);
      const dx = pB.x - pA.x, dy = pB.y - pA.y;
      const lenSq = dx*dx + dy*dy;
      if (lenSq > 0) {
        const t = Math.max(0, Math.min(1, ((cur.x-pA.x)*dx + (cur.y-pA.y)*dy) / lenSq));
        const projX = pA.x + t*dx, projY = pA.y + t*dy;
        const dSeg = Math.hypot(projX - cur.x, projY - cur.y);
        if (dSeg < bestDist) { bestDist = dSeg; bestCable = cable; }
      }
    }
  });
  if (!bestCable) { toast("Кабель олдсонгүй — кабелийн шугам дээр дарна уу"); return; }
  const parentRouteId = Number(bestCable.parent_route_id || 0);
  const poleStart = Number(bestCable.pole_start || 1);
  const poleEnd = Number(bestCable.pole_end || poleStart);
  if (poleEnd - poleStart < 1) { toast("Таслах боломжгүй: хэтэрхий цөөн шон"); return; }
  // Find poles in the cable's parent route within this cable's range, excluding endpoints
  const routePoles = _iotNetworkPoles
    .filter(p => Number(p.route_id) === parentRouteId && p.pole_type !== "feed")
    .map((p, idx) => ({ ...p, _num: iotPoleNumber(p, idx) }))
    .filter(p => p._num > poleStart && p._num < poleEnd)
    .sort((a, b) => a._num - b._num);
  if (!routePoles.length) { toast("Таслах дундаж шон байхгүй — нэмэлт шон хэрэгтэй"); return; }
  // Find nearest pole to click
  let nearestPole = routePoles[0], nearestDist = Infinity;
  routePoles.forEach(p => {
    const pPx = _iotMap.latLngToContainerPoint([Number(p.gps_lat), Number(p.gps_lng)]);
    const d = Math.hypot(pPx.x - cur.x, pPx.y - cur.y);
    if (d < nearestDist) { nearestDist = d; nearestPole = p; }
  });
  const splitAt = nearestPole._num;
  if (!confirm(`"${bestCable.name || "Кабель"}" — ${poleStart}-${poleEnd} шон\nТаслах цэг: ${splitAt}-р шон\n\n▸ 1-р хэсэг: ${poleStart}-${splitAt} шон\n▸ 2-р хэсэг: ${splitAt+1}-${poleEnd} шон`)) return;
  // Build sub-geometries from ordered poles
  const allPoles = _iotNetworkPoles
    .filter(p => Number(p.route_id) === parentRouteId && p.pole_type !== "feed")
    .map((p, idx) => ({ ...p, _num: iotPoleNumber(p, idx) }))
    .sort((a, b) => a._num - b._num);
  const geoA = allPoles.filter(p => p._num >= poleStart && p._num <= splitAt).map(p => ({ lat: Number(p.gps_lat), lng: Number(p.gps_lng) }));
  const geoB = allPoles.filter(p => p._num >= splitAt + 1 && p._num <= poleEnd).map(p => ({ lat: Number(p.gps_lat), lng: Number(p.gps_lng) }));
  if (geoA.length < 2 || geoB.length < 2) { toast("Геометр хангалтгүй — таслах боломжгүй"); return; }
  const baseName = (bestCable.name || "Кабель").replace(/\s*\(\d+-\d+\)\s*$/, "");
  await api(`/api/sl-network/routes/${bestCable.id}`, { method: "DELETE" });
  await Promise.all([
    api("/api/sl-network/routes", { method: "POST", body: JSON.stringify({
      name: `${baseName} (${poleStart}-${splitAt})`, meter_no: bestCable.meter_no,
      route_type: "cable", status: "active", color: "#ef4444",
      parent_route_id: parentRouteId, pole_start: poleStart, pole_end: splitAt,
      wire_install_type: bestCable.wire_install_type, wire_phase: bestCable.wire_phase, wire_profile: bestCable.wire_profile,
      geometry: geoA,
    }) }),
    api("/api/sl-network/routes", { method: "POST", body: JSON.stringify({
      name: `${baseName} (${splitAt+1}-${poleEnd})`, meter_no: bestCable.meter_no,
      route_type: "cable", status: "active", color: "#ef4444",
      parent_route_id: parentRouteId, pole_start: splitAt + 1, pole_end: poleEnd,
      wire_install_type: bestCable.wire_install_type, wire_phase: bestCable.wire_phase, wire_profile: bestCable.wire_profile,
      geometry: geoB,
    }) }),
  ]);
  toast(`✂ Кабель таслагдлаа: ${poleStart}-${splitAt} ба ${splitAt+1}-${poleEnd} шон`);
  await iotRefresh();
}

function cableRoutePopupLegacy(route) {
  const geo = routeGeometry(route);
  let totalM = 0;
  if (_iotMap && geo.length >= 2) {
    for (let i = 0; i < geo.length - 1; i++)
      totalM += _iotMap.distance([geo[i].lat, geo[i].lng], [geo[i+1].lat, geo[i+1].lng]);
  }
  const btnStyle = "border-radius:7px;padding:5px 9px;font-size:11px;font-weight:900;cursor:pointer;border:1px solid";
  return `
    <div class="iot-map-popup" style="min-width:190px">
      <div style="font-size:10px;font-weight:800;color:#64748b;text-transform:uppercase">🔌 Тэжээлийн кабель</div>
      <div style="font-size:14px;font-weight:900;color:#ef4444;margin:3px 0">${escapeHtml(route.name || "Кабель")}</div>
      <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 10px;margin-top:8px;font-size:12px">
        <span style="color:#64748b">Нийт урт</span><b>${totalM > 0 ? totalM.toFixed(0) + " м" : "-"}</b>
        <span style="color:#64748b">Цэгийн тоо</span><b>${geo.length}</b>
      </div>
      <div style="display:flex;gap:6px;margin-top:10px">
        <button style="${btnStyle} #fecaca;background:#fff;color:#b91c1c" onclick="iotDeleteNetworkRoute(${Number(route.id)})">🗑 Устгах</button>
      </div>
    </div>`;
}

function cableRoutePopup(route) {
  const geo = routeGeometry(route);
  const totalM = routeLengthMeters(geo);
  const btnStyle = "border-radius:7px;padding:5px 9px;font-size:11px;font-weight:900;cursor:pointer;border:1px solid";
  const profile = [route.wire_install_type, route.wire_phase, route.wire_profile].filter(Boolean).join(" / ");
  const isFeedWire = route.route_type === "feed_wire";
  const poleRange = route.pole_start ? `${route.pole_start}-${route.pole_end} шон` : null;
  const feedPole = route.feed_pole_id ? _iotNetworkPoles.find(p => Number(p.id) === Number(route.feed_pole_id)) : null;
  const parentRoute = route.parent_route_id ? _iotNetworkRoutes.find(r => Number(r.id) === Number(route.parent_route_id)) : null;
  const poleCount = route.pole_start && route.pole_end ? (Number(route.pole_end) - Number(route.pole_start) + 1) : null;
  const headerColor = isFeedWire ? "#ea580c" : "#ef4444";
  const headerLabel = isFeedWire ? "⚡ Тэжээлийн утас" : "🔌 Кабель сегмент";
  const segStatus = isFeedWire ? null : iotSegmentVisualStatus(route);
  const segStatusLabel = { on: "🟢 Асаалттай", off: "⚫ Унтраалттай", fault: "🔴 Гэмтэлтэй", partial: "🟡 Хэсэгчилсэн" }[segStatus] || "";
  const segStatusColor = { on: "#166534", off: "#374151", fault: "#991b1b", partial: "#92400e" }[segStatus] || "#374151";
  const toggleStatus = segStatus === "on" ? "off" : "on";
  const toggleLabel = segStatus === "on" ? "🔴 Унтраах" : "🟢 Асаах";
  const toggleBorder = segStatus === "on" ? "#fecaca;background:#fff1f2;color:#b91c1c" : "#86efac;background:#f0fdf4;color:#166534";
  return `
    <div class="iot-map-popup" style="min-width:240px">
      <div style="font-size:10px;font-weight:800;color:${headerColor};text-transform:uppercase;letter-spacing:.4px">${headerLabel}</div>
      <div style="font-size:14px;font-weight:900;color:${headerColor};margin:3px 0">${escapeHtml(route.name || "Кабель")}</div>
      ${parentRoute ? `<div style="font-size:11px;color:#64748b;margin-bottom:4px">🛣 ${escapeHtml(parentRoute.name || "Трасс")}</div>` : ""}
      <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 10px;margin-top:6px;font-size:12px">
        ${poleRange ? `<span style="color:#64748b">Хамаарах шон</span><b style="color:#b91c1c">${poleRange}</b>` : ""}
        ${poleCount ? `<span style="color:#64748b">Нийт шон</span><b>${poleCount} ш</b>` : ""}
        <span style="color:#64748b">Нийт урт</span><b>${formatRouteLength(totalM)}</b>
        ${profile ? `<span style="color:#64748b">Профиль</span><b>${escapeHtml(profile)}</b>` : ""}
        ${segStatusLabel ? `<span style="color:#64748b">Төлөв</span><b style="color:${segStatusColor}">${segStatusLabel}</b>` : ""}
        <span style="color:#64748b">Тэжээл</span><b style="color:${feedPole ? '#b45309' : '#94a3b8'}">${feedPole ? `⚡ ${escapeHtml(feedPole.name || "Холбогдсон")}` : "Холбоогүй"}</b>
      </div>
      <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
        ${!isFeedWire ? `<button style="${btnStyle} ${toggleBorder}" onclick="iotToggleSegmentStatus(${Number(route.id)},'${toggleStatus}')">${toggleLabel}</button>` : ""}
        ${!isFeedWire ? `<button style="${btnStyle} #fde68a;background:#fffbeb;color:#92400e" onclick="iotSetSegmentFault(${Number(route.id)})">⚠ Гэмтэл</button>` : ""}
        ${route.feed_pole_id ? `<button style="${btnStyle} #e0f2fe;background:#f0f9ff;color:#0369a1" onclick="iotHighlightFeed(${Number(route.feed_pole_id)},${Number(route.id)})">⚡ Тодруулах</button>` : ""}
        ${!isFeedWire && poleCount && poleCount > 2 ? `<button style="${btnStyle} #fca5a5;background:#fef2f2;color:#dc2626" onclick="iotToggleSplitMode()">✂ Таслах</button>` : ""}
        <button style="${btnStyle} #fecaca;background:#fff;color:#b91c1c" onclick="iotDeleteNetworkRoute(${Number(route.id)})">🗑 Устгах</button>
      </div>
    </div>`;
}

async function iotFetchOsmRouteGeometry(streetName) {
  setIotDrawHint("OpenStreetMap-аас гудамжны мэдээлэл татаж байна...");
  try {
    const query = `[out:json][timeout:20];
way["name"~"${streetName.replace(/"/g, "")}",i](47.85,114.25,48.25,114.85);
out geom;`;
    const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`OSM алдаа: ${resp.status}`);
    const data = await resp.json();
    const ways = (data.elements || []).filter(e => e.type === "way" && Array.isArray(e.geometry));
    if (!ways.length) {
      setIotDrawHint(`"${streetName}" гудамж OSM-д олдсонгүй. Гараар трасс зурна уу.`);
      return;
    }
    const pts = ways.flatMap(w => w.geometry.map(n => ({ lat: n.lat, lng: n.lon })));
    const CHOIBALSAN = { latMin: 47.85, latMax: 48.25, lngMin: 114.25, lngMax: 114.85 };
    const valid = pts.filter(p =>
      p.lat >= CHOIBALSAN.latMin && p.lat <= CHOIBALSAN.latMax &&
      p.lng >= CHOIBALSAN.lngMin && p.lng <= CHOIBALSAN.lngMax
    );
    if (valid.length < 2) {
      setIotDrawHint("OSM-аас авсан цэгүүд Чойбалсан хотын хил дотор байхгүй байна.");
      return;
    }
    _iotDraftRoute = valid;
    redrawIotDraftRoute();
    if (_iotMap && valid.length) {
      _iotMap.fitBounds(valid.map(p => [p.lat, p.lng]), { padding: [40, 40], maxZoom: 17 });
    }
    const el = document.getElementById("iotPoleCount");
    if (el) el.textContent = `🔦 Шон: ${selectedRoutePoleCount()}`;
    setIotDrawHint(`OSM-аас "${streetName}" трасс ачаалагдлаа · ${valid.length} цэг · ${selectedRoutePoleCount()} шон автоматаар байрлана`);
  } catch (e) {
    setIotDrawHint(`OSM алдаа: ${e.message}. Гараар трасс зурна уу.`);
  }
}

function syncIotMaximized() {
  document.body.classList.toggle("iot-maximized", _iotMaximized);
  setTimeout(() => _iotMap?.invalidateSize(), 120);
}

function iotToggleMaximize() {
  _iotMaximized = !_iotMaximized;
  syncIotMaximized();
  if (_iotMaximized && document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else if (!_iotMaximized && document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  }
  renderIotPage();
}

function iotSetView(view) {
  _iotView = ["overview", "map", "list", "report"].includes(view) ? view : "overview";
  _iotMap = null;
  _iotMarkers = null;
  renderIotPage();
  if (_iotView === "report") loadIotReport();
}

function renderIotPage() {
  const el = document.getElementById("main");
  if (!el) return;
  el.innerHTML = `
    <style>
      .iot-page{padding:24px;max-width:100%;box-sizing:border-box}
      .iot-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:18px}
      .iot-summary-grid{display:grid;grid-template-columns:repeat(6,minmax(120px,1fr));gap:12px;margin-bottom:18px}
      .iot-summary-card{border:1px solid;border-radius:8px;padding:14px;min-width:0}
      .iot-table-wrap{overflow-x:auto;border:1px solid #e5e7eb;border-radius:8px;background:#fff;max-width:100%}
      .iot-tabs{display:flex;gap:6px;margin:0 0 12px}
      .iot-tab{border:1px solid #cbd5e1;background:#fff;color:#334155;border-radius:8px;padding:8px 12px;font-size:12px;font-weight:900;cursor:pointer}
      .iot-tab.is-active{background:#2563eb;border-color:#2563eb;color:#fff;box-shadow:0 6px 16px rgba(37,99,235,.18)}
      .iot-meter-table{width:max-content;min-width:100%;border-collapse:separate;border-spacing:0;font-size:12px;line-height:1.25}
      .iot-meter-table th,.iot-meter-table td{padding:9px 8px;text-align:left;border-bottom:1px solid #e5e7eb;white-space:nowrap;vertical-align:middle}
      .iot-meter-table th{color:#64748b;font-size:10px;font-weight:800;text-transform:uppercase;background:#f8fafc}
      .iot-meter-table tr:last-child td{border-bottom:none}
      .iot-mono{font-family:Consolas,Menlo,monospace;color:#0f172a}
      .iot-strong{font-weight:800}
      .iot-device-name{font-weight:800;max-width:220px;overflow:hidden;text-overflow:ellipsis}
      .iot-model-inline{margin-top:3px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#1f6fb2;font-size:10px;font-weight:900}
      .iot-payload-inline{margin-top:4px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#64748b;font-size:10px;font-family:Consolas,Menlo,monospace;font-weight:600}
      .iot-deveui{max-width:126px;overflow:hidden;text-overflow:ellipsis;color:#475569}
      .iot-last-seen{color:#475569;max-width:132px;overflow:hidden;text-overflow:ellipsis}
      .iot-sticky-col{position:sticky;right:0;background:#fff;box-shadow:-8px 0 12px rgba(15,23,42,.05);z-index:2}
      th.iot-sticky-col{background:#f8fafc;z-index:3}
      .iot-control-cell{min-width:150px}
      .iot-control-cell.iot-relay-on{background:linear-gradient(90deg,#dcfce7 0%,#f0fdf4 100%);box-shadow:-10px 0 18px rgba(22,163,74,.16)}
      .iot-control-cell.iot-relay-off{background:linear-gradient(90deg,#fee2e2 0%,#fef2f2 100%);box-shadow:-10px 0 18px rgba(220,38,38,.16)}
      .iot-control-cell.iot-relay-unknown{background:#f8fafc}
      .iot-relay-state{display:inline-flex;align-items:center;border-radius:7px;font-size:11px;font-weight:900;letter-spacing:.2px;padding:4px 8px;margin-bottom:6px;border:1px solid}
      .iot-relay-on{background:#16a34a;color:#fff;border-color:#047857;box-shadow:0 4px 12px rgba(22,163,74,.24)}
      .iot-relay-off{background:#dc2626;color:#fff;border-color:#b91c1c;box-shadow:0 4px 12px rgba(220,38,38,.24)}
      .iot-relay-unknown{background:#e2e8f0;color:#475569;border-color:#cbd5e1}
      .iot-command-badge{display:block;width:max-content;max-width:108px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-radius:999px;font-size:10px;font-weight:800;padding:2px 7px;margin-bottom:5px}
      .iot-maintenance-badge{display:grid;gap:2px;max-width:170px;margin:0 0 6px;padding:7px 8px;border-radius:8px;background:#111827;color:#fef3c7;border:1px solid #f59e0b;box-shadow:0 0 0 2px rgba(245,158,11,.16),0 8px 18px rgba(17,24,39,.22);white-space:normal}
      .iot-maintenance-badge b{font-size:11px;color:#fef08a;letter-spacing:0}
      .iot-maintenance-badge span{font-size:10px;line-height:1.25}
      .iot-manual-off-badge{display:grid;gap:2px;max-width:170px;margin:0 0 6px;padding:7px 8px;border-radius:8px;background:#7f1d1d;color:#fee2e2;border:1px solid #ef4444;box-shadow:0 6px 16px rgba(127,29,29,.18);white-space:normal}
      .iot-manual-off-badge b{font-size:11px;color:#fff;letter-spacing:0}
      .iot-manual-off-badge span,.iot-manual-off-badge strong,.iot-manual-off-line{font-size:10px;line-height:1.25}
      .iot-manual-off-badge strong{color:#fef08a}
      .iot-manual-off-badge.is-overdue{background:#991b1b;box-shadow:0 0 0 2px rgba(239,68,68,.18),0 8px 18px rgba(127,29,29,.24)}
      .iot-control-buttons{display:inline-flex;gap:0;border:1px solid #cbd5e1;border-radius:10px;overflow:hidden;background:#f8fafc;box-shadow:0 6px 16px rgba(15,23,42,.08)}
      .iot-command-btn{border:0;border-right:1px solid #cbd5e1;border-radius:0;background:#f8fafc;color:#64748b;font-size:12px;font-weight:900;padding:9px 12px;min-width:52px;cursor:pointer;opacity:.72;filter:none;transition:background .15s,border-color .15s,box-shadow .15s,color .15s,transform .15s,opacity .15s}
      .iot-command-btn:last-child{border-right:0}
      .iot-command-btn:disabled{cursor:default}
      .iot-command-btn.iot-on:not(.is-active):hover{color:#15803d;border-color:#86efac;background:#f0fdf4;opacity:1;filter:none}
      .iot-command-btn.iot-off:not(.is-active):hover{color:#b91c1c;border-color:#fecaca;background:#fef2f2;opacity:1;filter:none}
      .iot-command-btn.iot-auto:not(.is-active):hover{color:#1d4ed8;border-color:#93c5fd;background:#eff6ff;opacity:1;filter:none}
      .iot-command-btn.iot-on.is-active{color:#fff;background:#16a34a;box-shadow:inset 0 0 0 1px #047857;opacity:1;filter:none}
      .iot-command-btn.iot-off.is-active{color:#fff;background:#dc2626;box-shadow:inset 0 0 0 1px #b91c1c;opacity:1;filter:none}
      .iot-command-btn.iot-auto.is-active{color:#fff;background:#2563eb;box-shadow:inset 0 0 0 1px #1d4ed8;opacity:1;filter:none}
      .iot-auto-badge-on{background:#dbeafe!important;color:#1d4ed8!important}
      .iot-auto-badge-off{background:#f1f5f9!important;color:#475569!important}
      .iot-command-btn.is-active{transform:none}
      .iot-map-shell{border:1px solid #e5e7eb;border-radius:8px;background:#fff;overflow:hidden}
      .iot-map-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border-bottom:1px solid #e5e7eb;background:#f8fafc}
      .iot-map-canvas{height:560px;width:100%;background:#e2e8f0}
      .iot-map-empty{height:100%;display:flex;align-items:center;justify-content:center;color:#64748b;font-weight:800}
      .iot-map-marker{width:38px;height:38px;border-radius:999px;border:3px solid #fff;box-shadow:0 8px 20px rgba(15,23,42,.26);display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:900}
      .iot-map-marker span{line-height:1}
      .iot-employee-marker{width:34px;height:34px;border-radius:999px;background:#db2777;border:3px solid #fff;box-shadow:0 0 0 3px rgba(219,39,119,.28),0 8px 18px rgba(15,23,42,.25);display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:950}
      .iot-employee-marker span{line-height:1}
      .iot-map-popup{min-width:190px}
      @media (max-width:1200px){
        .iot-page{padding:18px}
        .iot-summary-grid{grid-template-columns:repeat(3,minmax(120px,1fr))}
        .iot-meter-table th,.iot-meter-table td{padding:8px 7px;font-size:11px}
      }
      @media (max-width:760px){
        .iot-head{align-items:stretch;flex-direction:column}
        .iot-summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
        .iot-map-toolbar{align-items:stretch;flex-direction:column}
        .iot-map-canvas{height:460px}
      }
    </style>
    <div class="iot-page">
      <div class="iot-head">
        <div>
          <h2 style="margin:0;font-size:20px">Гэрэлтүүлгийн IoT хяналт</h2>
          <div style="margin-top:4px;color:#64748b;font-size:13px">ADW300 380V 3 фаз / ADW310 220V 1 фаз · ChirpStack uplink · сүүлийн хэмжилт</div>
        </div>
        <button class="btn secondary" onclick="iotRefresh()" style="padding:8px 14px;font-size:13px">Шинэчлэх</button>
      </div>
      <div id="iotSummary">${renderSummary()}</div>
      <div style="background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;border-radius:8px;padding:10px 12px;font-size:12px;margin-bottom:12px">
        ADW300 380V 3 фаз, ADW310 220V 1 фаз тоолуур. DO удирдлага ажиллахын тулд ChirpStack EU868 RX2 DR=3, RX2 frequency=869525000 байх шаардлагатай.
      </div>
      <div class="iot-tabs" role="tablist" aria-label="IoT харагдац">
        <button class="iot-tab ${_iotView === "list" ? "is-active" : ""}" onclick="iotSetView('list')">Жагсаалт</button>
        <button class="iot-tab ${_iotView === "map" ? "is-active" : ""}" onclick="iotSetView('map')">Сүлжээний зураглал</button>
      </div>
      <div id="iotBody">${renderIotBody()}</div>
    </div>`;
  if (_iotView === "overview" || _iotView === "map") initIotMap();
}

renderIotPage = function() {
  const el = document.getElementById("main");
  if (!el) return;
  el.innerHTML = `
    <style>
      .iot-page{padding:16px;max-width:100%;min-height:calc(100vh - 72px);box-sizing:border-box;background:#e7edf3;color:#172033}
      body.iot-maximized{overflow:hidden}
      body.iot-maximized .top,body.iot-maximized .side{display:none!important}
      body.iot-maximized .layout{display:block!important;margin-top:0!important;min-height:100vh!important}
      body.iot-maximized .main{padding:0!important;width:100vw!important;height:100vh!important;overflow:auto!important}
      body.iot-maximized .iot-page{min-height:100vh;padding:6px 10px}
      body.iot-maximized .iot-head{margin-bottom:6px}
      body.iot-maximized .iot-tabs{margin-bottom:6px}
      body.iot-maximized .iot-command-title{padding:10px 14px}
      body.iot-maximized .iot-command-title h2{font-size:20px}
      body.iot-maximized .iot-map-canvas{height:calc(100vh - 440px);min-height:300px}
      body.iot-maximized .iot-view-map .iot-map-canvas{height:calc(100vh - 118px)!important;min-height:0}
      body.iot-maximized .iot-view-map .iot-map-toolbar{padding:6px 12px}
      body.iot-maximized .iot-view-map .iot-tabs{margin-bottom:6px}
      body.iot-maximized .iot-command-bottom{grid-template-columns:1fr .8fr 1.1fr}
      body.iot-scada .iot-map-shell{border-color:#00e5ff33;background:#0a0f1a}
      body.iot-scada .iot-map-toolbar{background:#0d1421;border-color:#00e5ff33;color:#a0e4f1}
      body.iot-scada .iot-network-tools{background:#0d1421;border-color:#00e5ff33}
      body.iot-scada .iot-network-tools button{background:#0a1628;border-color:#00e5ff44;color:#7dd3fc}
      body.iot-scada .iot-network-tools button.is-active{background:#003a52;border-color:#00e5ff;color:#00e5ff;box-shadow:0 0 12px rgba(0,229,255,.35)}
      body.iot-scada .iot-network-tools .iot-pole-count{background:#0d2233;border-color:#ffe60044;color:#ffe600}
      body.iot-scada .iot-network-tools .iot-route-metrics{background:#1f1a05;border-color:#ffe60055;color:#ffe600}
      body.iot-scada .iot-network-tools .iot-draw-hint{color:#4dd9f0}
      body.iot-scada .iot-net-input{background:#0a1628;border-color:#00e5ff44;color:#a0e4f1}
      body.iot-scada .iot-spacing-label span{color:#4dd9f0}
      body.iot-scada .iot-spacing-input{background:#0a1628;border-color:#00e5ff44;color:#ffe600}
      .iot-cursor-snap,.iot-cursor-snap .leaflet-grab,.iot-cursor-snap .leaflet-interactive{cursor:crosshair!important}
      .iot-snap-tip{background:#fff0f0!important;border:1px solid #ef4444!important;color:#b91c1c!important;font-size:11px!important;font-weight:700!important;padding:2px 7px!important;border-radius:5px!important;white-space:nowrap!important}
      .iot-snap-tip::before{border-top-color:#ef4444!important}
      .iot-tabs{display:flex;gap:8px;margin:0 0 12px}
      .iot-tab{border:1px solid #a9bacb;background:#f8fafc;color:#23415f;border-radius:8px;padding:9px 13px;font-size:12px;font-weight:900;cursor:pointer}
      .iot-tab.is-active{background:#1f6fb2;border-color:#1f6fb2;color:#fff;box-shadow:0 8px 18px rgba(31,111,178,.18)}
      .iot-command-dashboard{display:flex;flex-direction:column;gap:12px}
      .iot-command-title{display:flex;align-items:center;justify-content:space-between;gap:18px;background:linear-gradient(180deg,#f8fbff 0%,#edf4fb 100%);border:1px solid #b8c7d6;border-left:5px solid #1f6fb2;border-radius:8px;padding:16px 18px}
      .iot-command-title h2{margin:0;max-width:980px;font-size:24px;line-height:1.22;letter-spacing:0;text-transform:uppercase;color:#152238}
      .iot-command-title p{margin:6px 0 0;color:#41617d;font-size:13px}
      .iot-command-title button,.iot-panel-head button{border:1px solid #8db4d8;background:#e8f2fb;color:#1f5f9a;border-radius:8px;padding:8px 12px;font-size:12px;font-weight:900;cursor:pointer}
      .iot-title-actions{display:flex;gap:8px;align-items:center;flex:0 0 auto}
      .iot-guide{background:linear-gradient(180deg,#fffdfa,#f6fbff);border:1px solid #b8c7d6;border-left:5px solid #f59e0b;border-radius:8px;box-shadow:0 10px 22px rgba(31,55,77,.08);overflow:hidden}
      .iot-guide summary{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:12px 16px;cursor:pointer;color:#172033;font-weight:950;list-style:none}
      .iot-guide summary::-webkit-details-marker{display:none}
      .iot-guide summary span{font-size:13px;text-transform:uppercase}
      .iot-guide summary b{font-size:12px;color:#8a4b0b;text-align:right}
      .iot-guide summary:after{content:"Дэлгэх";border:1px solid #f59e0b;background:#fffbeb;color:#92400e;border-radius:999px;padding:3px 9px;font-size:11px;font-weight:950;white-space:nowrap}
      .iot-guide[open] summary:after{content:"Эвхэх"}
      .iot-guide-split{display:grid;grid-template-columns:minmax(280px,.85fr) minmax(420px,1.15fr);gap:0;border-top:1px solid #d5e0ea}
      .iot-guide section{padding:13px 16px;min-width:0}
      .iot-guide-operator{border-right:1px solid #d5e0ea;background:rgba(255,255,255,.48)}
      .iot-guide-ai{background:rgba(239,246,255,.42)}
      .iot-guide h3{margin:0 0 8px;color:#1f5f9a;font-size:12px;text-transform:uppercase;letter-spacing:0}
      .iot-guide p{margin:6px 0;color:#1d2f44;font-size:12px;line-height:1.45}
      .iot-guide b{font-weight:950;color:#102033}
      .iot-guide code{font-family:Consolas,Menlo,monospace;font-size:11px;background:#eef5fb;border:1px solid #cfe0ee;border-radius:5px;padding:1px 4px;color:#0f3b63}
      .iot-safety-note{margin:0 0 10px;border:1px solid #fca5a5;border-left:5px solid #dc2626;background:#fff1f2;color:#7f1d1d;border-radius:8px;padding:10px 12px;font-size:12px;line-height:1.5}
      .iot-safety-note b{color:#7f1d1d}
      .iot-command-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
      .iot-command-kpi,.iot-panel,.iot-category-card,.iot-map-shell{background:linear-gradient(180deg,#f8fbff,#edf4fa);border:1px solid #b8c7d6;border-radius:8px;box-shadow:0 10px 22px rgba(31,55,77,.08);min-width:0}
      .iot-command-kpi{display:flex;align-items:center;gap:12px;padding:14px}
      .iot-kpi-icon{width:40px;height:40px;border-radius:999px;background:var(--kpi);display:flex;align-items:center;justify-content:center;box-shadow:0 0 22px rgba(14,165,233,.25);font-size:18px}
      .iot-kpi-label{font-size:11px;color:#506f8b;text-transform:uppercase;font-weight:800}
      .iot-kpi-value{font-size:24px;line-height:1.1;font-weight:950;color:#102033;margin-top:3px}
      .iot-kpi-sub{font-size:11px;color:#1f6fb2;margin-top:5px}
      .iot-command-grid{display:grid;grid-template-columns:minmax(520px,1fr) 300px;gap:12px;align-items:stretch}
      .iot-command-grid aside{display:flex;flex-direction:column;gap:12px;min-width:0}
      .iot-page.iot-view-overview{padding:12px 16px}
      .iot-view-overview .iot-tabs{margin-bottom:8px}
      .iot-view-overview{height:calc(100dvh - 178px);overflow:hidden;display:flex;flex-direction:column}
      .iot-view-overview #iotBody{flex:1;min-height:0;display:flex;flex-direction:column}
      .iot-view-overview .iot-command-dashboard{gap:8px;height:100%;min-height:0;overflow:hidden;display:flex;flex-direction:column}
      .iot-view-overview .iot-command-kpis{grid-template-columns:repeat(7,minmax(110px,1fr));gap:8px}
      .iot-view-overview .iot-command-kpi{padding:9px 10px;gap:9px;min-height:58px}
      .iot-view-overview .iot-kpi-icon{width:30px;height:30px;font-size:14px}
      .iot-view-overview .iot-kpi-label{font-size:9px;line-height:1.15}
      .iot-view-overview .iot-kpi-value{font-size:20px;margin-top:1px}
      .iot-view-overview .iot-kpi-sub{font-size:10px;margin-top:2px}
      .iot-view-overview .iot-command-grid{display:grid;grid-template-columns:minmax(0,1fr) 300px;grid-template-rows:1fr;gap:10px;min-height:0;flex:1;overflow:hidden}
      .iot-view-overview .iot-command-grid main{grid-column:1;grid-row:1;height:100%;min-height:0;overflow:hidden;display:flex;min-width:0}
      .iot-view-overview .iot-command-grid aside{grid-column:2;grid-row:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;gap:8px;padding:8px 0 72px;min-width:0}
      .iot-view-overview .iot-panel{background:rgba(255,255,255,0.93);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
      .iot-view-overview .iot-alert-panel{min-height:0;overflow-y:auto}
      .iot-node-live-panel{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}
      .iot-node-live-list{display:flex;flex-direction:column;overflow-y:auto;flex:1;min-height:0}
      .iot-node-live-row{padding:8px 0;border-bottom:1px solid #f1f5f9}
      .iot-node-live-row:last-child{border-bottom:none}
      .iot-node-live-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;gap:6px}
      .iot-node-live-name{font-weight:700;font-size:12px;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .iot-node-live-badge{font-size:10px;padding:2px 7px;border-radius:999px;font-weight:700;white-space:nowrap;flex-shrink:0}
      .iot-node-live-state{font-size:11px;font-weight:800;margin-bottom:4px}
      .iot-node-live-vals{display:flex;gap:10px;font-size:11px;color:#475569;font-family:Consolas,monospace;flex-wrap:wrap}
      .iot-node-live-time{font-size:10px;color:#94a3b8;margin-top:3px}
      .iot-view-overview .iot-map-shell{height:100%;width:100%;display:flex;flex-direction:column;min-height:0;min-width:0}
      .iot-view-overview .iot-map-toolbar{padding:9px 12px}
      .iot-view-overview .iot-map-sub{font-size:11px;line-height:1.25}
      .iot-view-overview .iot-map-legend{padding:7px 9px;font-size:11px;gap:8px;display:flex;align-items:center}
      .iot-view-overview .iot-map-canvas{height:auto;min-height:0;flex:1;width:100%}
      .iot-view-overview .iot-panel{padding:10px}
      .iot-view-overview .iot-panel-head{margin-bottom:6px}
      .iot-view-overview .iot-panel-title{font-size:12px}
      .iot-view-overview .iot-alert-row{grid-template-columns:28px 1fr;gap:8px;padding:7px 0}
      .iot-view-overview .iot-alert-row time{grid-column:2;font-size:10px}
      .iot-view-overview .iot-alert-icon{width:24px;height:24px}
      .iot-view-overview .iot-weather-main{margin:10px 0}
      .iot-view-overview .iot-weather-main span{font-size:26px}
      .iot-view-overview .iot-weather-main b{font-size:22px}
      .iot-view-overview .iot-weather-grid{gap:5px;font-size:11px}
      .iot-overview-grid{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:12px;align-items:start}
      .iot-overview-grid aside{display:flex;flex-direction:column;gap:12px;min-width:0}
      .iot-overview-main{background:linear-gradient(180deg,#f8fbff,#edf4fa);border:1px solid #b8c7d6;border-radius:8px;box-shadow:0 10px 22px rgba(31,55,77,.08);padding:14px;min-width:0}
      .iot-category-stack{display:flex;flex-direction:column;gap:10px}
      .iot-category-card{display:flex;gap:12px;padding:13px}
      .iot-category-icon{width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;flex:0 0 auto}
      .iot-category-main{flex:1;min-width:0}
      .iot-category-row{display:flex;justify-content:space-between;gap:10px;color:#1d2f44;font-size:12px;margin-top:7px}
      .iot-category-row span{color:#58728b}
      .iot-progress{display:flex;height:5px;background:#d7e1eb;border-radius:999px;overflow:hidden;margin-top:10px}
      .iot-progress span,.iot-progress i{display:block;height:100%}
      .iot-progress i{background:#ef4444}
      .iot-panel{padding:14px}
      .iot-panel-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}
      .iot-panel-head span{font-size:11px;color:#1f6fb2}
      .iot-panel-title{font-size:13px;font-weight:950;color:#172033;text-transform:uppercase;letter-spacing:0}
      .iot-report{display:flex;flex-direction:column;gap:12px}
      .iot-report-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;background:linear-gradient(180deg,#f8fbff,#edf4fa);border:1px solid #b8c7d6;border-radius:8px;padding:14px}
      .iot-report-periods{display:flex;flex-wrap:wrap;gap:7px}
      .iot-report-periods button{border:1px solid #a9bacb;background:#f8fafc;color:#23415f;border-radius:8px;padding:8px 11px;font-size:12px;font-weight:900;cursor:pointer}
      .iot-report-periods button.is-active{background:#1f6fb2;border-color:#1f6fb2;color:#fff}
      .iot-report-cards{display:grid;grid-template-columns:repeat(6,minmax(120px,1fr));gap:10px}
      .iot-report-card{background:linear-gradient(180deg,#f8fbff,#edf4fa);border:1px solid #b8c7d6;border-left:4px solid var(--accent);border-radius:8px;padding:13px;min-width:0;box-shadow:0 10px 22px rgba(31,55,77,.08)}
      .iot-report-card span{display:block;color:#506f8b;font-size:11px;text-transform:uppercase;font-weight:900}
      .iot-report-card b{display:block;color:#102033;font-size:22px;line-height:1.15;margin-top:5px}
      .iot-report-card i{display:block;color:#58728b;font-size:11px;font-style:normal;margin-top:5px}
      .iot-operator-cards{display:grid;grid-template-columns:repeat(4,minmax(120px,1fr));gap:10px;margin-bottom:12px}
      .iot-operator-timeline{display:grid;gap:8px}
      .iot-operator-event{display:grid;grid-template-columns:132px 160px minmax(0,1fr);gap:10px;align-items:center;border:1px solid #d5e0ea;border-left:4px solid #64748b;border-radius:8px;background:#f8fbff;padding:9px 11px;font-size:12px}
      .iot-operator-event.is-ok{border-left-color:#16a34a;background:#f0fdf4}
      .iot-operator-event.is-warning{border-left-color:#f59e0b;background:#fffbeb}
      .iot-operator-event.is-critical{border-left-color:#dc2626;background:#fef2f2}
      .iot-operator-event time{color:#58728b;font-weight:800}
      .iot-operator-event b{color:#172033}
      .iot-operator-event span{color:#1d2f44;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .iot-report-grid{display:grid;grid-template-columns:minmax(0,1fr) 330px;gap:12px;align-items:start}
      .iot-report-event{display:grid;grid-template-columns:1fr;gap:3px;border-top:1px solid #d5e0ea;padding:10px 0}
      .iot-report-event b{font-size:12px;color:#172033}.iot-report-event span{font-size:12px;color:#1d2f44}.iot-report-event time{font-size:11px;color:#58728b}
      .iot-chart-controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      .iot-chart-controls select{border:1px solid #a9bacb;background:#fff;color:#172033;border-radius:8px;padding:8px 10px;font-size:12px;font-weight:800}
      .iot-chart-wrap{overflow-x:auto;border:1px solid #d5e0ea;border-radius:8px;background:#fff}
      .iot-usage-chart{display:block;min-width:720px;width:100%;height:300px}
      .iot-chart-empty{height:220px;display:flex;align-items:center;justify-content:center;color:#58728b;font-weight:900;background:#f8fbff;border:1px solid #d5e0ea;border-radius:8px}
      .iot-map-shell{overflow:hidden;padding:0}
      .iot-map-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border-bottom:1px solid #b8c7d6;background:#edf4fb}
      .iot-fullscreen-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid #a9bacb;background:#fff;color:#23415f;border-radius:8px;padding:7px 12px;font-size:12px;font-weight:900;cursor:pointer;white-space:nowrap}
      .iot-fullscreen-btn:hover{background:#1f6fb2;border-color:#1f6fb2;color:#fff}
      body.iot-maximized .iot-fullscreen-btn{background:#dc2626;border-color:#dc2626;color:#fff}
      body.iot-scada .iot-fullscreen-btn{background:#0a1628;border-color:#00e5ff44;color:#7dd3fc}
      body.iot-scada .iot-fullscreen-btn:hover{background:#003a52;border-color:#00e5ff;color:#00e5ff}
      .iot-network-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 14px;border-bottom:1px solid #b8c7d6;background:#f8fbff}
      .iot-network-tools button{border:1px solid #a9bacb;background:#fff;color:#23415f;border-radius:8px;padding:7px 10px;font-size:12px;font-weight:900;cursor:pointer}
      .iot-network-tools button.is-active{background:#1f6fb2;border-color:#1f6fb2;color:#fff;box-shadow:0 6px 14px rgba(31,111,178,.18)}
      .iot-network-tools button.iot-btn-auto{background:#f0fdf4;border-color:#86efac;color:#166534;font-weight:900}
      .iot-network-tools button.iot-btn-auto:hover{background:#dcfce7;border-color:#4ade80}
      .iot-network-tools button.iot-btn-feed{background:#fffbeb;border-color:#fcd34d;color:#92400e}
      .iot-network-tools button.iot-feed-active{background:#f59e0b;border-color:#d97706;color:#fff;box-shadow:0 0 12px rgba(245,158,11,.4)}
      .iot-network-tools button.iot-btn-split{background:#fef2f2;border-color:#fca5a5;color:#dc2626;font-weight:900}
      .iot-network-tools button.iot-btn-split:hover{background:#fee2e2;border-color:#f87171}
      .iot-network-tools button.iot-btn-split-active{background:#dc2626;border-color:#b91c1c;color:#fff;box-shadow:0 0 12px rgba(220,38,38,.4);animation:iot-split-pulse 1.5s infinite}
      @keyframes iot-split-pulse{0%,100%{box-shadow:0 0 12px rgba(220,38,38,.4)}50%{box-shadow:0 0 20px rgba(220,38,38,.7)}}
      .iot-network-tools button.iot-btn-stop-edit{background:#dcfce7;border-color:#4ade80;color:#166534;font-weight:900}
      .iot-network-tools span{color:#58728b;font-size:12px}
      .iot-network-tools .iot-pole-count{border:1px solid #c5d2df;background:#edf4fb;color:#1f5f9a;border-radius:8px;padding:7px 10px;font-weight:900}
      .iot-network-tools .iot-route-metrics{border:1px solid #fde68a;background:#fffbeb;color:#92400e;border-radius:8px;padding:7px 10px;font-weight:900}
      .iot-network-tools .iot-draw-hint{color:#58728b;font-size:11px;font-style:italic;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .iot-spacing-label{display:flex;align-items:center;gap:4px;font-size:11px;color:#506f8b;font-weight:900}
      .iot-spacing-input{width:56px;border:1px solid #a9bacb;border-radius:8px;padding:5px 6px;font-size:12px;font-weight:800;text-align:center;background:#fff;color:#172033}
      .iot-net-input{border:1px solid #a9bacb;background:#fff;color:#172033;border-radius:8px;padding:7px 9px;font-size:12px;font-weight:800;min-width:170px}
      .iot-net-name{min-width:260px;max-width:520px;flex:1}
      .iot-map-sub{font-size:12px;color:#58728b;margin-top:3px}
      .iot-map-legend{display:grid;gap:7px;font-size:12px;color:#1d2f44;background:#f8fbff;border:1px solid #c5d2df;border-radius:8px;padding:10px 12px}
      .iot-map-legend span{display:flex;align-items:center;gap:8px}
      .iot-map-legend i{width:10px;height:10px;border-radius:999px;display:inline-block}
      .iot-map-legend .ok{background:#fde047;border:1px solid #0f172a}.iot-map-legend .off{background:#6b7280}.iot-map-legend .bad{background:#dc2626}.iot-map-legend .est{background:#f59e0b}.iot-map-legend .employee{background:#db2777}
      .iot-map-canvas{height:420px;width:100%;background:#d7e1eb}
      .iot-view-map .iot-map-canvas{height:calc(100vh - 200px);min-height:580px}
      .iot-view-map .iot-map-toolbar{padding:10px 14px}
      .iot-view-map .iot-map-legend{display:flex;gap:14px;align-items:center}
      .iot-view-map .leaflet-control-attribution{font-size:9px;opacity:.28;transform:scale(.84);transform-origin:right bottom;background:rgba(255,255,255,.55)}
      .iot-view-map .leaflet-control-attribution:hover{opacity:.85}
      .iot-map-empty{height:100%;display:flex;align-items:center;justify-content:center;color:#58728b;font-weight:800}
      .iot-map-marker{width:38px;height:38px;border-radius:999px;border:3px solid #fff;box-shadow:0 4px 14px rgba(31,55,77,.22);display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:900}
      .iot-map-marker span{line-height:1}
      .iot-employee-marker{width:34px;height:34px;border-radius:999px;background:#db2777;border:3px solid #fff;box-shadow:0 0 0 3px rgba(219,39,119,.28),0 8px 18px rgba(31,55,77,.25);display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:950}
      .iot-employee-marker span{line-height:1}
      .iot-map-popup{min-width:190px}
      .iot-draft-point{width:22px;height:22px;border-radius:999px;background:#2563eb;border:2px solid #fff;box-shadow:0 4px 10px rgba(15,23,42,.28);color:#fff;font-size:11px;font-weight:950;display:flex;align-items:center;justify-content:center;cursor:grab}
      .iot-alert-row{display:grid;grid-template-columns:34px 1fr auto;gap:10px;align-items:center;border-top:1px solid #d5e0ea;padding:10px 0}
      .iot-alert-row b{display:block;color:#172033;font-size:12px}
      .iot-alert-row span,.iot-alert-row time{font-size:11px;color:#58728b}
      .iot-alert-row small{display:block;margin-top:3px;font-size:10px;color:#8aa0b5;line-height:1.35}
      .iot-alert-icon{width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-weight:950}
      .iot-alert-icon.is-bad{background:rgba(239,68,68,.18);color:#f87171}.iot-alert-icon.is-ok{background:rgba(34,197,94,.18);color:#4ade80}
      .iot-weather-main{display:flex;align-items:center;gap:12px;margin:18px 0;color:#172033}
      .iot-weather-main span{font-size:36px;color:#f59e0b}.iot-weather-main b{font-size:26px}
      .iot-weather-grid{display:grid;grid-template-columns:1fr auto;gap:8px;font-size:12px;color:#58728b}.iot-weather-grid b{color:#172033}
      .iot-command-bottom{display:grid;grid-template-columns:1.1fr .9fr 1.25fr;gap:12px}
      .iot-line-chart{width:100%;height:142px;display:block}
      .iot-donut-wrap{display:flex;align-items:center;gap:18px;margin-top:12px}
      .iot-donut{width:118px;height:118px;border-radius:999px;display:flex;align-items:center;justify-content:center;flex:0 0 auto}
      .iot-donut>div{width:72px;height:72px;border-radius:999px;background:#f8fbff;display:flex;flex-direction:column;align-items:center;justify-content:center}
      .iot-donut b{font-size:22px;color:#172033}.iot-donut span{font-size:11px;color:#58728b}
      .iot-donut-legend{display:grid;gap:9px;font-size:12px;color:#1d2f44;flex:1}.iot-donut-legend span{display:flex;align-items:center;gap:8px;justify-content:space-between}.iot-donut-legend i{width:9px;height:9px;border-radius:999px}
      .iot-dark-table{width:100%;border-collapse:collapse;font-size:12px;color:#1d2f44}
      .iot-dark-table th,.iot-dark-table td{padding:8px;border-bottom:1px solid #d5e0ea;text-align:left}
      .iot-dark-table th{color:#58728b;font-size:11px;font-weight:800}
      .iot-dark-table .ok,.iot-dark-table .bad{border-radius:999px;padding:3px 8px;font-weight:900;font-size:11px}.iot-dark-table .ok{background:#166534;color:#dcfce7}.iot-dark-table .bad{background:#7f1d1d;color:#fee2e2}
      .iot-empty-dark{color:#58728b;font-size:12px;padding:16px 0}
      .iot-table-wrap{overflow-x:auto;border:1px solid rgba(56,189,248,.18);border-radius:8px;background:#fff;max-width:100%}
      .iot-meter-table{width:max-content;min-width:100%;border-collapse:separate;border-spacing:0;font-size:12px;line-height:1.25}
      .iot-meter-table th,.iot-meter-table td{padding:9px 8px;text-align:left;border-bottom:1px solid #e5e7eb;white-space:nowrap;vertical-align:middle}
      .iot-meter-table th{color:#64748b;font-size:10px;font-weight:800;text-transform:uppercase;background:#f8fafc}
      .iot-meter-table tr:last-child td{border-bottom:none}
      .iot-mono{font-family:Consolas,Menlo,monospace;color:#0f172a}
      .iot-strong{font-weight:800}
      .iot-device-name{font-weight:800;max-width:220px;overflow:hidden;text-overflow:ellipsis}
      .iot-model-inline{margin-top:3px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#1f6fb2;font-size:10px;font-weight:900}
      .iot-payload-inline{margin-top:4px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#64748b;font-size:10px;font-family:Consolas,Menlo,monospace;font-weight:600}
      .iot-deveui{max-width:126px;overflow:hidden;text-overflow:ellipsis;color:#475569}
      .iot-last-seen{color:#475569;max-width:132px;overflow:hidden;text-overflow:ellipsis}
      .iot-sticky-col{position:sticky;right:0;background:#fff;box-shadow:-8px 0 12px rgba(15,23,42,.05);z-index:2}
      th.iot-sticky-col{background:#f8fafc;z-index:3}
      .iot-control-cell{min-width:150px}
      .iot-control-cell.iot-relay-on{background:linear-gradient(90deg,#dcfce7 0%,#f0fdf4 100%);box-shadow:-10px 0 18px rgba(22,163,74,.16)}
      .iot-control-cell.iot-relay-off{background:linear-gradient(90deg,#fee2e2 0%,#fef2f2 100%);box-shadow:-10px 0 18px rgba(220,38,38,.16)}
      .iot-control-cell.iot-relay-unknown{background:#f8fafc}
      .iot-relay-state{display:inline-flex;align-items:center;border-radius:7px;font-size:11px;font-weight:900;letter-spacing:.2px;padding:4px 8px;margin-bottom:6px;border:1px solid}
      .iot-relay-on{background:#16a34a;color:#fff;border-color:#047857;box-shadow:0 4px 12px rgba(22,163,74,.24)}
      .iot-relay-off{background:#dc2626;color:#fff;border-color:#b91c1c;box-shadow:0 4px 12px rgba(220,38,38,.24)}
      .iot-relay-unknown{background:#e2e8f0;color:#475569;border-color:#cbd5e1}
      .iot-command-badge{display:block;width:max-content;max-width:108px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-radius:999px;font-size:10px;font-weight:800;padding:2px 7px;margin-bottom:5px}
      .iot-maintenance-badge{display:grid;gap:2px;max-width:170px;margin:0 0 6px;padding:7px 8px;border-radius:8px;background:#111827;color:#fef3c7;border:1px solid #f59e0b;box-shadow:0 0 0 2px rgba(245,158,11,.16),0 8px 18px rgba(17,24,39,.22);white-space:normal}
      .iot-maintenance-badge b{font-size:11px;color:#fef08a;letter-spacing:0}
      .iot-maintenance-badge span{font-size:10px;line-height:1.25}
      .iot-manual-off-badge{display:grid;gap:2px;max-width:170px;margin:0 0 6px;padding:7px 8px;border-radius:8px;background:#7f1d1d;color:#fee2e2;border:1px solid #ef4444;box-shadow:0 6px 16px rgba(127,29,29,.18);white-space:normal}
      .iot-manual-off-badge b{font-size:11px;color:#fff;letter-spacing:0}
      .iot-manual-off-badge span,.iot-manual-off-badge strong,.iot-manual-off-line{font-size:10px;line-height:1.25}
      .iot-manual-off-badge strong{color:#fef08a}
      .iot-manual-off-badge.is-overdue{background:#991b1b;box-shadow:0 0 0 2px rgba(239,68,68,.18),0 8px 18px rgba(127,29,29,.24)}
      .iot-control-buttons{display:inline-flex;gap:0;border:1px solid #cbd5e1;border-radius:10px;overflow:hidden;background:#f8fafc;box-shadow:0 6px 16px rgba(15,23,42,.08)}
      .iot-command-btn{border:0;border-right:1px solid #cbd5e1;border-radius:0;background:#f8fafc;color:#64748b;font-size:12px;font-weight:900;padding:9px 12px;min-width:52px;cursor:pointer;opacity:.72;filter:none;transition:background .15s,border-color .15s,box-shadow .15s,color .15s,transform .15s,opacity .15s}
      .iot-command-btn:last-child{border-right:0}
      .iot-command-btn:disabled{cursor:default}
      .iot-command-btn.iot-on:not(.is-active):hover{color:#15803d;border-color:#86efac;background:#f0fdf4;opacity:1;filter:none}
      .iot-command-btn.iot-off:not(.is-active):hover{color:#b91c1c;border-color:#fecaca;background:#fef2f2;opacity:1;filter:none}
      .iot-command-btn.iot-auto:not(.is-active):hover{color:#1d4ed8;border-color:#93c5fd;background:#eff6ff;opacity:1;filter:none}
      .iot-command-btn.iot-on.is-active{color:#fff;background:#16a34a;box-shadow:inset 0 0 0 1px #047857;opacity:1;filter:none}
      .iot-command-btn.iot-off.is-active{color:#fff;background:#dc2626;box-shadow:inset 0 0 0 1px #b91c1c;opacity:1;filter:none}
      .iot-command-btn.iot-auto.is-active{color:#fff;background:#2563eb;box-shadow:inset 0 0 0 1px #1d4ed8;opacity:1;filter:none}
      .iot-auto-badge-on{background:#dbeafe!important;color:#1d4ed8!important}
      .iot-auto-badge-off{background:#f1f5f9!important;color:#475569!important}
      .iot-command-btn.is-active{transform:none}
      @media (max-width:1200px){
        .iot-command-kpis{grid-template-columns:repeat(3,minmax(140px,1fr))}
        .iot-report-cards{grid-template-columns:repeat(3,minmax(140px,1fr))}
        .iot-report-grid{grid-template-columns:1fr}
        .iot-command-grid{grid-template-columns:1fr}
        .iot-view-overview .iot-command-kpis{grid-template-columns:repeat(7,minmax(90px,1fr))}
        .iot-view-overview .iot-command-grid{grid-template-columns:minmax(520px,1fr) 280px}
        .iot-view-overview .iot-map-canvas{height:auto;min-height:0;flex:1}
        .iot-overview-grid{grid-template-columns:1fr}
        .iot-command-bottom{grid-template-columns:1fr}
        .iot-guide-split{grid-template-columns:1fr}
        .iot-guide-operator{border-right:0;border-bottom:1px solid #d5e0ea}
        .iot-guide section:last-child{border-bottom:0}
        .iot-map-canvas{height:440px}
        .iot-meter-table th,.iot-meter-table td{padding:8px 7px;font-size:11px}
      }
      @media (max-width:760px){
        .iot-page{padding:10px}
        .iot-command-title{align-items:stretch;flex-direction:column}
        .iot-command-title h2{font-size:18px}
        .iot-guide summary{align-items:flex-start;flex-direction:column}
        .iot-guide summary b{text-align:left}
        .iot-command-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}
        .iot-report-cards{grid-template-columns:repeat(2,minmax(0,1fr))}
        .iot-report-toolbar{align-items:stretch;flex-direction:column}
        .iot-map-toolbar{align-items:stretch;flex-direction:column}
        .iot-map-canvas{height:460px}
      }
    </style>
    <div class="iot-page iot-view-${_iotView}">
      <div class="iot-tabs" role="tablist" aria-label="IoT харагдац">
        <button class="iot-tab ${_iotView === "overview" ? "is-active" : ""}" onclick="iotSetView('overview')">Нөхцөл байдлын самбар</button>
        <button class="iot-tab ${_iotView === "map" ? "is-active" : ""}" onclick="iotSetView('map')">Зураглал, бүтэц засвар</button>
        <button class="iot-tab ${_iotView === "list" ? "is-active" : ""}" onclick="iotSetView('list')">Node удирдлага</button>
        <button class="iot-tab ${_iotView === "report" ? "is-active" : ""}" onclick="iotSetView('report')">Ажиллагааны түүх</button>
      </div>
      <div id="iotBody">${renderIotBody()}</div>
    </div>`;
  syncIotMaximized();
  syncIotWorkspaceControls();
  if (_iotView === "overview" || _iotView === "map") initIotMap();
};

async function iotRefresh() {
  try {
    const [devices, meters, lights, gerInventory, routes, poles, feedPoints, feederCables, feedPointDeviceLinks, scheduleInfo, employeeLocations] = await Promise.all([
      api("/api/iot/devices"),
      api("/api/mp").catch(() => []),
      api("/api/sl-points").catch(() => []),
      api("/api/sl-ger-inventory").catch(() => []),
      api("/api/sl-network/routes").catch(() => []),
      api("/api/sl-network/poles").catch(() => []),
      api("/api/sl-network/feed-points").catch(() => []),
      api("/api/sl-network/feeder-cables").catch(() => []),
      api("/api/sl-network/feed-point-devices").catch(() => []),
      api("/api/iot/schedule-info").catch(() => []),
      api("/api/employee-locations/latest?hours=2").catch(() => []),
    ]);
    _iotRows = devices;
    _iotMeterPoints = Array.isArray(meters) ? meters : [];
    _iotLightPoints = Array.isArray(lights) ? lights : [];
    _iotGerInventory = Array.isArray(gerInventory) ? gerInventory : [];
    _iotNetworkRoutes = Array.isArray(routes) ? routes : [];
    _iotNetworkPoles = Array.isArray(poles) ? poles : [];
    _iotFeedPoints = Array.isArray(feedPoints) ? feedPoints : [];
    _iotFeederCables = Array.isArray(feederCables) ? feederCables : [];
    _iotFeedPointDeviceLinks = Array.isArray(feedPointDeviceLinks) ? feedPointDeviceLinks : [];
    _iotScheduleInfo = Array.isArray(scheduleInfo) ? scheduleInfo : [];
    _iotEmployeeLocations = Array.isArray(employeeLocations) ? employeeLocations : [];
    if (_iotView === "report") _iotReport = await api(`/api/iot/report?period=${encodeURIComponent(_iotReportPeriod)}`);
    if (_iotMap) {
      _iotSavedCenter = _iotMap.getCenter();
      _iotSavedZoom = _iotMap.getZoom();
    }
    renderIotPage();
  } catch (e) {
    const el = document.getElementById("main");
    if (el) {
      el.innerHTML = `
        <div style="padding:24px;max-width:900px">
          <h2 style="margin:0 0 10px;font-size:20px">Гэрэлтүүлгийн IoT хяналт</h2>
          <div style="background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;border-radius:8px;padding:14px;font-size:13px;line-height:1.55">
            IoT API JSON буцаахгүй байна. Node server шинэ route-аар restart хийгдсэн эсэхийг шалгана уу.
          </div>
        </div>`;
    }
    toast(e.message || "IoT мэдээлэл татахад алдаа гарлаа");
  }
}

async function loadIotReport() {
  _iotReport = null;
  _iotSeries = null;
  renderIotPage();
  try {
    _iotReport = await api(`/api/iot/report?period=${encodeURIComponent(_iotReportPeriod)}`);
    if (!_iotChartDevEui && _iotReport.devices?.[0]?.devEui) _iotChartDevEui = _iotReport.devices[0].devEui;
    if (_iotChartDevEui) {
      _iotSeries = await api(`/api/iot/timeseries?period=${encodeURIComponent(_iotReportPeriod)}&devEui=${encodeURIComponent(_iotChartDevEui)}&bucket=${encodeURIComponent(_iotChartBucket)}`);
    }
    renderIotPage();
  } catch (e) {
    toast(e.message || "IoT тайлан татахад алдаа гарлаа");
  }
}

function iotSetReportPeriod(period) {
  _iotReportPeriod = ["night", "today", "7d", "month", "year"].includes(period) ? period : "night";
  loadIotReport();
}

async function loadIotSeries() {
  if (!_iotChartDevEui) return;
  _iotSeries = null;
  renderIotPage();
  try {
    _iotSeries = await api(`/api/iot/timeseries?period=${encodeURIComponent(_iotReportPeriod)}&devEui=${encodeURIComponent(_iotChartDevEui)}&bucket=${encodeURIComponent(_iotChartBucket)}`);
    renderIotPage();
  } catch (e) {
    toast(e.message || "IoT график татахад алдаа гарлаа");
  }
}

function iotSetChartDevice(devEui) {
  _iotChartDevEui = devEui;
  loadIotSeries();
}

function iotSetChartBucket(value) {
  _iotChartBucket = Number(value) || 15;
  loadIotSeries();
}

async function iotSendDownlink(devEui, action) {
  const row = _iotRows.find(r => r.devEui === devEui);
  const deviceName = row?.deviceName || devEui;
  const body = { action };
  if (action === "ON" && isMaintenanceMode(row)) {
    toast("Засвар горим идэвхтэй байна. Ажил дууссаны дараа AUTO болгож байж ON илгээнэ.");
    return;
  }
  if (action === "OFF") {
    const menu = [
      "1. Засвар",
      "2. Аюултай нөхцөл",
      "3. Түр унтраалт",
      "4. Бусад",
    ].join("\n");
    const picked = prompt(`${deviceName}: OFF хийх шалтгаанаа сонгоно уу\n\n${menu}\n\n1-4 дугаар оруулна уу:`);
    const reasonMap = { 1: "maintenance", 2: "hazard", 3: "temporary", 4: "other" };
    const manualOffReason = reasonMap[String(picked || "").trim()];
    if (!manualOffReason) return;
    body.manualOffReason = manualOffReason;
    body.manualOffNote = manualOffReason === "other" ? (prompt("Бусад шалтгааны тайлбар оруулна уу:") || "") : "";
    const maintenanceLine = manualOffReason === "maintenance"
      ? "\n\nЗАСВАР ГОРИМ идэвхжинэ. Auto-recovery энэ node-г огт хөндөхгүй, ON command хаагдана."
      : "";
    if (!confirm(`${deviceName}: OFF илгээх үү?\n\nManual OFF болно. Schedule идэвхгүй үлдэнэ. AUTO дарахаас нааш сервер schedule-аар буцааж асаахгүй.${maintenanceLine}`)) return;
  } else if (action === "ON") {
    const menu = [
      "1. Туршилт / шалгалт",
      "2. Аюулгүй байдал",
      "3. Түр асаалт",
      "4. Бусад",
    ].join("\n");
    const picked = prompt(`${deviceName}: ON хийх шалтгаанаа сонгоно уу\n\n${menu}\n\n1-4 дугаар оруулна уу:`);
    const reasonMap = { 1: "test", 2: "emergency", 3: "temporary", 4: "other" };
    const manualOnReason = reasonMap[String(picked || "").trim()];
    if (!manualOnReason) return;
    body.manualOnReason = manualOnReason;
    body.manualOnNote = manualOnReason === "other" ? (prompt("Бусад шалтгааны тайлбар оруулна уу:") || "") : "";
    const noteLine = body.manualOnNote ? `\nТайлбар: ${body.manualOnNote}` : "";
    if (!confirm(`${deviceName}: ON илгээх үү?\n\nManual ON болно. Шалтгаан: ${menu.split("\n")[Number(picked)-1]?.replace(/^\d+\.\s*/, "") || ""}${noteLine}\n\nГазар дээр ажиллаж байгаа эсэхийг инженерийн хяналтаар нягтална уу.`)) return;
  }
  try {
    const result = await api(`/api/iot/devices/${encodeURIComponent(devEui)}/downlink`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    toast(result.status === "queued" ? "Команд дараалалд орлоо" : `Downlink ${action} дараалалд орлоо`);
    await iotRefresh();
  } catch (e) {
    toast(e.message || "Downlink илгээхэд алдаа гарлаа");
  }
  return;
  const label = action === "ON" ? "асаах" : "унтраах";
  const safety = action === "ON"
    ? "\n\nАнхаар: газар дээр засварчин ажиллаж байгаа эсэхийг заавал нягтал. ERP command нь физик салгалтыг орлохгүй."
    : "\n\nАнхаар: manual OFF нь дараагийн schedule ON асаалтыг хаахгүй. Өдрийн засварын асаалт/унтраалт инженерийн хяналтаар явна.";
  if (!confirm(`${deviceName} төхөөрөмжийг ${label} downlink илгээх үү?${safety}`)) return;
  try {
    const result = await api(`/api/iot/devices/${encodeURIComponent(devEui)}/downlink`, {
      method: "POST",
      body: JSON.stringify({ action }),
    });
    toast(result.status === "queued" ? "Команд дараалалд орлоо" : `Downlink ${action} дараалалд орлоо`);
    await iotRefresh();
  } catch (e) {
    toast(e.message || "Downlink илгээхэд алдаа гарлаа");
  }
}

async function iotSetAutoMode(devEui, autoMode) {
  const row = _iotRows.find(r => r.devEui === devEui);
  const deviceName = row?.deviceName || devEui;
  const message = autoMode
    ? `${deviceName}\n\nЭнэ node-г schedule горимд буцаах уу?\n\nAUTO болвол сервер тухайн цагийн schedule-аар шууд тааруулна.`
    : `${deviceName}: MANUAL горимд шилжүүлэх үү?`;
  if (!confirm(message)) return;
  try {
    const result = await api(`/api/iot/devices/${encodeURIComponent(devEui)}/auto-mode`, {
      method: "POST",
      body: JSON.stringify({ autoMode }),
    });
    toast(result.autoMode ? "AUTO горим идэвхжлээ" : "MANUAL горим идэвхжлээ");
    await iotRefresh();
  } catch (e) {
    toast(e.message || "AUTO горим солиход алдаа гарлаа");
  }
  return;
  const label = autoMode ? "AUTO горим асаах" : "AUTO горим унтраах";
  const note = autoMode
    ? "\n\nAuto идэвхжвэл schedule-ийн асаах/унтраах цагаар сервер удирдана."
    : "\n\nAuto унтарвал сервер schedule command явуулахгүй, зөвхөн операторын ON/OFF ажиллана.";
  if (!confirm(`${deviceName}: ${label} уу?${note}`)) return;
  try {
    const result = await api(`/api/iot/devices/${encodeURIComponent(devEui)}/auto-mode`, {
      method: "POST",
      body: JSON.stringify({ autoMode }),
    });
    toast(result.autoMode ? "AUTO горим идэвхжлээ" : "MANUAL горим идэвхжлээ");
    await iotRefresh();
  } catch (e) {
    toast(e.message || "AUTO горим солиход алдаа гарлаа");
  }
}

async function iot_monitor() {
  const el = document.getElementById("main");
  if (el) {
    el.innerHTML = `<div style="padding:24px;color:#64748b">IoT хэмжилтүүдийг ачааллаж байна...</div>`;
  }
  await iotRefresh();
  state.clockTimer = setInterval(iotRefresh, 60 * 1000);
}

document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && _iotMaximized) {
    _iotMaximized = false;
    syncIotMaximized();
    renderIotPage();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && _iotMaximized && !document.fullscreenElement) {
    _iotMaximized = false;
    syncIotMaximized();
    renderIotPage();
  }
});

Object.defineProperty(window, "_iotMap", {
  configurable: true,
  get: () => _iotMap,
});
Object.defineProperty(window, "_iotSelectedFeedPointId", {
  configurable: true,
  get: () => _iotSelectedFeedPointId,
  set: value => { _iotSelectedFeedPointId = Number(value) || null; },
});

Object.assign(window, {
  iot_monitor,
  iotRefresh,
  iotSendDownlink,
  iotSetAutoMode,
  iotSetView,
  iotToggleMaximize,
  iotSetReportPeriod,
  iotSetChartDevice,
  iotSetChartBucket,
  iotClearEmployeeLocation,
  iotSaveNodeLocation,
  iotUpdateRouteNameOptions,
  setIotDrawHint,
  iotSetDrawMode,
  iotStartFeedConnect,
  iotClearDraft,
  iotSaveDraftRoute,
  iotDeleteNetworkRoute,
  iotDeleteNetworkPole,
  iotHighlightFeed,
  iotSetFeedConnectRoute,
  iotSaveFeedWithCable,
  iotToggleScadaMode,
  iotAutoLoadRoute,
  iotEditPoles,
  iotStopEditPoles,
  iotLoadRouteToEdit,
  iotRenumberPoles,
  iotToggleSplitMode,
  iotSplitCableAt,
  iotToggleSegmentStatus,
  iotSetSegmentFault,
  iotPlaceFeedPoint,
  iotConnectFeedToSegment,
  iotDeleteFeederCable,
  iotDeleteFeedPoint,
  iotLinkNodePrompt: iotLinkNodePromptReplace,
  iotLinkNodeToFeedPoint: iotLinkNodeToFeedPointReplace,
  iotUnlinkNodeFromFeedPoint: iotUnlinkNodeFromFeedPointLive,
  iotUpdateDualSideLabel,
  iotRouteEditCalc,
  iotSaveRouteStats,
  iotToggleRouteEdit,
});
