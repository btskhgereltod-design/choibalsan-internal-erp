import { state, api, toast, escapeHtml } from './common.js';

// ── Чойбалсан хотын координат ────────────────────────────────
const LAT = 48.0714, LNG = 114.5357, UTC_OFFSET = 8;

const ALL_CATS = "Бүгд";
const SCHED_CATS = ["Авто замын гэрэл", "Гэр хорооллын гэрэл", "Цамхагийн гэрэл"];
const MONTH_LABELS = ["1-р сар","2-р сар","3-р сар","4-р сар","5-р сар","6-р сар","7-р сар","8-р сар","9-р сар","10-р сар","11-р сар","12-р сар"];
const TIMELINE_START_HOUR = 16;
const TIMELINE_END_HOUR = 33; // next day 09:00

function sunCrossingTimes(year, month1, angleDeg, day = 15) {
  const toR = d => d * Math.PI / 180;
  const toD = r => r * 180 / Math.PI;
  const date = new Date(year, month1 - 1, day);
  const dayOfYear = Math.round((date - new Date(year, 0, 1)) / 86400000) + 1;

  const gamma = 2 * Math.PI / 365 * (dayOfYear - 1);
  const eot = 229.18 * (
    0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma)
  );
  const decl =
    0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);

  const lat = toR(LAT);
  const zenith = toR(90 - angleDeg);
  const cosH = (Math.cos(zenith) / (Math.cos(lat) * Math.cos(decl)))
             - Math.tan(lat) * Math.tan(decl);

  if (Math.abs(cosH) > 1) return null;
  const halfDayMinutes = toD(Math.acos(cosH)) * 4;
  const solarNoonMinutes = 720 - 4 * LNG - eot + UTC_OFFSET * 60;

  return {
    evening: (solarNoonMinutes + halfDayMinutes) / 60,
    morning: (solarNoonMinutes - halfDayMinutes) / 60,
  };
}

// ── Бүрэнхийн үеүүдийн цаг тооцоо ───────────────────────────
function civilTwilight(year, month1, day = 15) {
  return sunCrossingTimes(year, month1, -6, day);
}

function twilightPhases(year, month1, day = 15) {
  const sunrise = sunCrossingTimes(year, month1, -0.833, day);
  const civil = sunCrossingTimes(year, month1, -6, day);
  const nautical = sunCrossingTimes(year, month1, -12, day);
  const astro = sunCrossingTimes(year, month1, -18, day);
  if (!sunrise || !civil || !nautical || !astro) return [];

  return [
    { name: "Өдөр", short: "Өдөр", start: TIMELINE_START_HOUR, end: sunrise.evening, color: "#b7e4ec" },
    { name: "Тод гэгээтэй үе", short: "Тод гэгээ", start: sunrise.evening, end: civil.evening, color: "#5f9faf" },
    { name: "Бүүдгэр гэгээтэй үе", short: "Бүүдгэр", start: civil.evening, end: nautical.evening, color: "#355866" },
    { name: "Бүрий үе", short: "Бүрий", start: nautical.evening, end: astro.evening, color: "#1d3641" },
    { name: "Шөнө", short: "Шөнө", start: astro.evening, end: astro.morning + 24, color: "#0b1f27" },
    { name: "Бүрий үе", short: "Бүрий", start: astro.morning + 24, end: nautical.morning + 24, color: "#1d3641" },
    { name: "Бүүдгэр гэгээтэй үе", short: "Бүүдгэр", start: nautical.morning + 24, end: civil.morning + 24, color: "#355866" },
    { name: "Тод гэгээтэй үе", short: "Тод гэгээ", start: civil.morning + 24, end: sunrise.morning + 24, color: "#5f9faf" },
    { name: "Өдөр", short: "Өдөр", start: sunrise.morning + 24, end: TIMELINE_END_HOUR, color: "#b7e4ec" },
  ].filter(p => p.end > TIMELINE_START_HOUR && p.start < TIMELINE_END_HOUR);
}

function hFmt(h) {
  if (h == null || isNaN(h)) return "—";
  const t = Math.round(((h % 24) + 24) % 24 * 60);
  return `${String(Math.floor(t / 60)).padStart(2,'0')}:${String(t % 60).padStart(2,'0')}`;
}

function civilAverageTimes(year, month1, day = 15) {
  const sunrise = sunCrossingTimes(year, month1, -0.833, day);
  const civil = sunCrossingTimes(year, month1, -6, day);
  if (!sunrise || !civil) return null;
  return {
    on: (sunrise.evening + civil.evening) / 2,
    off: (civil.morning + sunrise.morning) / 2,
  };
}

function hoursFromStr(s) {
  if (!s) return null;
  const [hh, mm] = s.split(":").map(Number);
  return hh + mm / 60;
}

function lightingDurationMinutes(onTime, offTime) {
  const on = hoursFromStr(onTime);
  let off = hoursFromStr(offTime);
  if (on == null || off == null || isNaN(on) || isNaN(off)) return null;
  if (off <= on) off += 24;
  return Math.round((off - on) * 60);
}

function durationText(minutes) {
  if (minutes == null) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h <= 0) return `${m} минут`;
  if (m <= 0) return `${h} цаг`;
  return `${h} цаг ${m} минут`;
}

function durationBadge(minutes) {
  if (minutes == null) return "";
  return `<span style="font-size:10px;font-weight:800;color:#1d4ed8;background:#dbeafe;border-radius:20px;padding:2px 8px;white-space:nowrap">Асалт ${durationText(minutes)}</span>`;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function parseDateStr(dateStr) {
  const [y, m, d] = (dateStr || todayStr()).split("-").map(Number);
  return { year: y, month: m, day: d };
}

function dateLabel(dateStr) {
  const { year, month, day } = parseDateStr(dateStr);
  return `${year} оны ${month}-р сарын ${day}`;
}

function shiftDateStr(dateStr, days) {
  const { year, month, day } = parseDateStr(dateStr);
  const d = new Date(year, month - 1, day);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function activeLogForDate(logs, dateStr) {
  const matching = logs.filter(l => (l.valid_from || "") <= dateStr);
  if (!matching.length) return null;
  return matching[0]; // already sorted DESC by valid_from
}

function lastDayOfMonth(year, month1) {
  return new Date(year, month1, 0).getDate();
}

function dateStrFromDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function recommendedScheduleForDate(year, month1, day) {
  const suitable = civilAverageTimes(year, month1, day);
  if (!suitable) return null;
  return {
    on_time: hFmt(suitable.on),
    off_time: "01:00",
    valid_from: "",
    adjusted_by_name: "Автомат тооцоо",
    is_auto_recommended: true,
  };
}

let _lsYear = new Date().getFullYear();
let _lsCat  = "Авто замын гэрэл";
let _lsMonth = new Date().getMonth() + 1;
let _lsDate = todayStr();
let _lsReportLogs = [];

function catCheckList(selected = []) {
  const selectedSet = new Set(selected.length ? selected : [_lsCat === ALL_CATS ? SCHED_CATS[0] : _lsCat]);
  const allChecked = SCHED_CATS.every(c => selectedSet.has(c));
  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;grid-column:1/-1">
        <input type="checkbox" id="lsf_cat_all" ${allChecked?"checked":""} onchange="lsToggleAllCats(this)">
        <span style="font-weight:700">${ALL_CATS}</span>
      </label>
      ${SCHED_CATS.map(c => `
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
          <input class="lsf-cat-check" type="checkbox" value="${escapeHtml(c)}" ${selectedSet.has(c)?"checked":""} onchange="lsSyncAllCats()">
          <span>${escapeHtml(c)}</span>
        </label>`).join("")}
    </div>`;
}

function selectedScheduleCats() {
  const checked = [...document.querySelectorAll(".lsf-cat-check:checked")].map(cb => cb.value);
  return checked.length ? checked : [_lsCat].filter(c => c && c !== ALL_CATS);
}

function dateScroller() {
  return `<div onwheel="lsWheelDate(event)"
    style="padding:10px 14px;border-bottom:1px solid #e2e6ed;display:flex;gap:8px;align-items:center;flex-wrap:wrap;background:#fff">
      <button type="button" class="btn secondary" style="padding:6px 10px;font-size:12px" onclick="lsShiftDay(-1)">‹</button>
      <input class="input" type="date" value="${escapeHtml(_lsDate)}" onchange="lsSetDate(this.value)" style="width:150px;font-size:12px">
      <button type="button" class="btn secondary" style="padding:6px 10px;font-size:12px" onclick="lsShiftDay(1)">›</button>
      <button type="button" class="btn secondary" style="padding:6px 10px;font-size:12px" onclick="lsSetToday()">Өнөөдөр</button>
      <span style="font-size:12px;font-weight:800;color:#334155">${escapeHtml(dateLabel(_lsDate))}</span>
      <span style="font-size:11px;color:#94a3b8">Mouse scroll: өдөр солих</span>
    </div>`;
}

function timelineHourLabel(hour) {
  return `${String(hour % 24).padStart(2, "0")}:00 цаг`;
}

function timelineTimeToHour(time, base = 12) {
  const h = typeof time === "number" ? time : hoursFromStr(time);
  if (h == null || isNaN(h)) return null;
  return h < base ? h + 24 : h;
}

function timelinePos(hour) {
  return Math.max(0, Math.min(100, ((hour - TIMELINE_START_HOUR) / (TIMELINE_END_HOUR - TIMELINE_START_HOUR)) * 100));
}

function timelineSegment(startHour, endHour, color, label, clickId = null, track = "bottom") {
  if (startHour == null || endHour == null || endHour <= startHour) return "";
  const left  = timelinePos(startHour);
  const width = Math.max(1.2, timelinePos(endHour) - left);
  const top    = track === "top" ? "28%" : "62%";
  const height = track === "top" ? "8px" : "12px";
  return `<div title="${escapeHtml(label)}"
    style="position:absolute;left:${left}%;width:${width}%;top:${top};height:${height};transform:translateY(-50%);border-radius:999px;background:${color};box-shadow:0 1px 3px rgba(15,23,42,.18)"></div>`;
}

function timelinePhaseBands(phases, showLabels = false) {
  return phases.map(p => {
    const start = Math.max(p.start, TIMELINE_START_HOUR);
    const end = Math.min(p.end, TIMELINE_END_HOUR);
    if (end <= start) return "";
    const left = timelinePos(start);
    const width = timelinePos(end) - left;
    const label = `${p.name}: ${hFmt(p.start)} - ${hFmt(p.end)}`;
    return `<div title="${escapeHtml(label)}"
      style="position:absolute;left:${left}%;width:${width}%;top:0;bottom:0;background:${p.color};opacity:${showLabels ? ".98" : ".42"};border-left:1px solid rgba(255,255,255,.45)">
        ${showLabels && width > 8 ? `<span style="position:absolute;left:6px;top:20px;font-size:9px;font-weight:800;color:${p.color === "#b7e4ec" ? "#31505a" : "#fff"};white-space:nowrap;text-shadow:0 1px 1px rgba(0,0,0,.18)">${escapeHtml(p.short)}</span>` : ""}
      </div>`;
  }).join("");
}

function suitableOnMarker(hour, showLabel = false) {
  if (hour == null || isNaN(hour)) return "";
  const left = timelinePos(hour);
  return `<div title="Асаах тохиромжтой: ${hFmt(hour)}"
    style="position:absolute;left:${left}%;top:0;bottom:0;width:0;border-left:2px solid #f97316;z-index:3;pointer-events:none">
      ${showLabel ? `<span style="position:absolute;left:4px;top:30px;font-size:9px;font-weight:900;color:#9a3412;background:#ffedd5;border:1px solid #fed7aa;border-radius:5px;padding:1px 5px;white-space:nowrap;box-shadow:0 1px 2px rgba(15,23,42,.12)">Асаах тохиромжтой ${hFmt(hour)}</span>` : ""}
    </div>`;
}

function suitableOnWindow(hour, showLabel = false) {
  if (hour == null || isNaN(hour)) return "";
  const start = hour - 10 / 60;
  const end = hour + 10 / 60;
  const left = timelinePos(start);
  const width = Math.max(0.8, timelinePos(end) - left);
  const label = `Зөвшөөрөх бүс: ${hFmt(start)} - ${hFmt(end)} (±10 минут)`;
  return `<div title="${escapeHtml(label)}"
    style="position:absolute;left:${left}%;width:${width}%;top:0;bottom:0;background:rgba(249,115,22,.14);border-left:1px dashed #fb923c;border-right:1px dashed #fb923c;z-index:2;pointer-events:none">
      ${showLabel ? `<span style="position:absolute;right:3px;bottom:2px;font-size:8px;font-weight:800;color:#9a3412;background:rgba(255,237,213,.9);border-radius:4px;padding:1px 4px;white-space:nowrap">±10мин</span>` : ""}
    </div>`;
}

function renderTimelineRow(label, log, tw, monthLogs = [], canEdit = false) {
  const barLog = monthLogs.length > 0 ? monthLogs[0] : log;
  const { year, month, day } = parseDateStr(_lsDate);
  const suitable = civilAverageTimes(year, month, day);

  const actualOn  = barLog && !barLog.is_always_off ? timelineTimeToHour(barLog.on_time)  : null;
  let   actualOff = barLog && !barLog.is_always_off ? timelineTimeToHour(barLog.off_time) : null;
  if (actualOn != null && actualOff != null && actualOff <= actualOn) actualOff += 24;

  const actualLabel = barLog?.is_always_off
    ? "Унтраасан"
    : barLog ? `${barLog.on_time || "--:--"} – ${barLog.off_time || "--:--"}` : "Тохиргоо алга";
  const actualDuration = barLog && !barLog.is_always_off
    ? lightingDurationMinutes(barLog.on_time, barLog.off_time)
    : null;

  const fmtDiff = (d) => {
    if (d == null) return "";
    const abs = Math.abs(d);
    const h   = Math.floor(abs / 60);
    const m   = abs % 60;
    const timeStr = h > 0 ? `${h}ц ${m}мин` : `${abs}мин`;
    let col, bg, txt;
    if (abs <= 10) {
      col = "#16a34a"; bg = "#dcfce7";
      txt = d === 0 ? "Яг тохирсон" : `${timeStr} ${d < 0 ? "эрт асна" : "оройтно"}`;
    } else {
      const desc = d < 0 ? `${timeStr} эрт асна` : `${timeStr} оройтно`;
      if (abs <= 30) { col = "#d97706"; bg = "#fef9c3"; txt = `⚠️ ${desc}`; }
      else           { col = "#dc2626"; bg = "#fee2e2"; txt = `🚨 ${desc}`; }
    }
    return `<span style="font-size:10px;font-weight:700;color:${col};background:${bg};border-radius:20px;padding:2px 8px;white-space:nowrap">${txt}</span>`;
  };

  // Placeholder badge on the timeline track when no record exists for this month
  const noConfigBadge = !barLog
    ? `<div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:11px;color:#94a3b8;background:#f1f5f9;border:1px dashed #cbd5e1;border-radius:999px;padding:2px 10px;white-space:nowrap;pointer-events:none">Тохиргоо алга</div>`
    : "";

  // Inline records list — replaces the separate history table
  const recordsHtml = monthLogs.map(l => {
    const dOn  = (suitable && !l.is_always_off && l.on_time)
      ? Math.round((hoursFromStr(l.on_time)  - suitable.on) * 60) : null;
    const duration = !l.is_always_off ? lightingDurationMinutes(l.on_time, l.off_time) : null;
    return `
      <div style="display:grid;grid-template-columns:160px minmax(620px,1fr);border-top:1px solid #f0f4f8">
        <div style="padding:5px 12px;font-size:11px;color:#94a3b8;background:#f8fafc;border-right:1px solid #f0f4f8;display:flex;flex-direction:column;gap:2px;justify-content:center">
          <span>Огноо: <strong style="color:#475569">${escapeHtml(l.valid_from||l.adjusted_date||"")}</strong></span>
        </div>
        <div style="padding:5px 12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:#fff">
          ${l.is_always_off
            ? `<span style="font-size:12px;font-weight:700;color:#dc2626">🔴 Унтраасан</span>`
            : `<span style="font-size:12px;font-weight:700;color:#f59e0b">${escapeHtml(l.on_time||"—")}</span>
               <span style="font-size:11px;color:#94a3b8">–</span>
               <span style="font-size:12px;font-weight:700;color:#2563eb">${escapeHtml(l.off_time||"—")}</span>
               ${dOn  != null ? fmtDiff(dOn)  : ""}
               ${durationBadge(duration)}`}
          ${l.notes ? `<span style="font-size:11px;color:#667085">· ${escapeHtml(l.notes)}</span>` : ""}
          <span style="font-size:11px;color:#94a3b8;margin-left:auto">${escapeHtml(l.adjusted_by_name||"")}</span>
        </div>
      </div>`;
  }).join("");

  return `<div style="border-top:1px solid #e5e7eb">
    <div style="display:grid;grid-template-columns:160px minmax(620px,1fr);min-height:80px">
      <div style="padding:12px;font-size:12px;font-weight:800;color:#334155;background:#f8fafc;border-right:1px solid #e5e7eb;display:flex;flex-direction:column;justify-content:center;gap:4px">
        <div>${escapeHtml(label)}</div>
        ${suitable ? `
          <div style="font-size:10px;color:#64748b;line-height:1.45;font-weight:700">
            <div>Асаах тохиромжтой: <span style="color:#f59e0b">${hFmt(suitable.on)}</span></div>
            <div>Унтраах тохиромжтой: <span style="color:#2563eb">${hFmt(suitable.off)}</span></div>
          </div>` : ""}
        ${!barLog ? `<div style="font-size:11px;color:#94a3b8;font-style:italic">Тохиргоо алга</div>` : ""}
      </div>
      <div style="position:relative;background:#fff;min-height:80px">
        ${timelinePhaseBands(tw?.phases || [])}
        <div style="position:absolute;inset:0;display:grid;grid-template-columns:repeat(${TIMELINE_END_HOUR - TIMELINE_START_HOUR},1fr);pointer-events:none">
          ${Array.from({length:TIMELINE_END_HOUR - TIMELINE_START_HOUR}).map(()=>`<div style="border-left:1px solid #f0f4f8"></div>`).join("")}
        </div>
        ${suitableOnWindow(tw?.suitableOn)}
        ${suitableOnMarker(tw?.suitableOn)}
        ${barLog?.is_always_off
          ? `<div style="position:absolute;left:8px;top:62%;transform:translateY(-50%);font-size:11px;font-weight:800;color:#dc2626;background:#fef2f2;border:1px solid #fecaca;border-radius:999px;padding:3px 10px">Унтраасан</div>`
          : barLog
            ? timelineSegment(actualOn, actualOff, "#2563eb", `Бодит: ${actualLabel}`, barLog.id, "bottom")
            : noConfigBadge}
        ${actualDuration != null ? `<div style="position:absolute;left:${timelinePos(actualOff)}%;top:62%;transform:translate(8px,-50%);font-size:10px;font-weight:800;color:#1d4ed8;background:#dbeafe;border-radius:999px;padding:2px 8px;white-space:nowrap;box-shadow:0 1px 3px rgba(15,23,42,.12)">${durationText(actualDuration)}</div>` : ""}
      </div>
    </div>
    ${recordsHtml}
  </div>`;
}

function timelinePreview(logs, canEdit = false) {
  const { year, month, day } = parseDateStr(_lsDate);
  const tw = civilTwilight(year, month, day);
  const suitable = civilAverageTimes(year, month, day);
  if (tw) {
    tw.phases = twilightPhases(year, month, day);
    tw.suitableOn = suitable?.on;
  }
  const labels = Array.from({length:TIMELINE_END_HOUR - TIMELINE_START_HOUR + 1}, (_, i) => TIMELINE_START_HOUR + i);
  const cats = SCHED_CATS;

  const rows = cats.map(cat => {
    const catLogs   = logs.filter(l => l.category === cat);
    const log       = activeLogForDate(catLogs, _lsDate);
    return renderTimelineRow(cat, log, tw, log ? [log] : [], canEdit);
  }).join("");

  return `<div class="panel" style="margin-bottom:20px;overflow:hidden">
    <div style="padding:12px 16px;border-bottom:1px solid #e2e6ed;display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap">
      <div>
        <div style="font-size:14px;font-weight:800">${escapeHtml(dateLabel(_lsDate))} timeline</div>
        <div style="font-size:11px;color:#64748b;margin-top:2px">Өдрийн тохиромжтой асаах/унтраах цаг ба одоогийн тохиргооны зөрүү</div>
      </div>
      <div style="display:flex;gap:12px;align-items:center;font-size:11px;color:#64748b">
        <span><i style="display:inline-block;width:18px;height:8px;border-radius:99px;background:#2563eb;margin-right:5px"></i>Бодит</span>
      </div>
    </div>
    ${dateScroller()}
    <div style="display:grid;grid-template-columns:160px minmax(620px,1fr);background:#fff;border-bottom:1px solid #e5e7eb">
      <div style="background:#f8fafc;border-right:1px solid #e5e7eb;padding:7px 12px;font-size:10px;font-weight:800;color:#64748b">Цаг / минут</div>
      <div style="position:relative;height:46px;overflow:hidden">
        ${timelinePhaseBands(tw?.phases || [], true)}
        ${suitableOnWindow(tw?.suitableOn, true)}
        ${suitableOnMarker(tw?.suitableOn, true)}
        ${labels.map(h => {
          const pct = timelinePos(h);
          const anchor = h === TIMELINE_START_HOUR ? "left:0" : h === TIMELINE_END_HOUR ? "right:0" : `left:${pct}%;transform:translateX(-50%)`;
          return `<div style="position:absolute;${anchor};top:4px;font-size:9px;color:#0f172a;background:rgba(255,255,255,.78);border-radius:4px;padding:1px 3px;white-space:nowrap">${timelineHourLabel(h)}</div>`;
        }).join("")}
      </div>
    </div>
    <div style="overflow-x:auto">${rows}</div>
  </div>`;
}

function annualReportData(logs, year) {
  const yearLogs = logs.filter(l => String(l.valid_from || l.adjusted_date || "").startsWith(`${year}-`));
  return SCHED_CATS.map(cat => {
    const catLogsDesc = logs.filter(l => l.category === cat);
    const catYearLogs = yearLogs.filter(l => l.category === cat);
    const monthly = MONTH_LABELS.map((label, i) => {
      const month = i + 1;
      const date = `${year}-${String(month).padStart(2,"0")}-${String(lastDayOfMonth(year, month)).padStart(2,"0")}`;
      const monthPrefix = `${year}-${String(month).padStart(2,"0")}-`;
      const monthLog = catLogsDesc.find(l => String(l.valid_from || l.adjusted_date || "").startsWith(monthPrefix));
      const active = monthLog || recommendedScheduleForDate(year, month, 15);
      const duration = active && !active.is_always_off ? lightingDurationMinutes(active.on_time, active.off_time) : null;
      const suitable = civilAverageTimes(year, month, 15);
      const diff = active && suitable && !active.is_always_off && active.on_time
        ? Math.round((hoursFromStr(active.on_time) - suitable.on) * 60)
        : null;
      return { month, label, active, duration, diff };
    });
    const durations = monthly.map(m => m.duration).filter(v => v != null);
    const avg = durations.length ? Math.round(durations.reduce((s,v)=>s+v,0) / durations.length) : null;
    const min = durations.length ? Math.min(...durations) : null;
    const max = durations.length ? Math.max(...durations) : null;
    const totals = annualLightingTotals(catLogsDesc, year);
    return { cat, logs: catYearLogs, monthly, avg, min, max, totals };
  });
}

function annualLightingTotals(catLogsDesc, year) {
  const now = new Date();
  const today = now.getFullYear() === year ? dateStrFromDate(now) : `${year}-12-31`;
  let registeredYtd = 0, estimatedYtd = 0, idealFullYear = 0, estimatedFullYear = 0, allNightIdealFullYear = 0;
  for (let d = new Date(year, 0, 1); d.getFullYear() === year; d.setDate(d.getDate() + 1)) {
    const dateStr = dateStrFromDate(d);
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const ideal = recommendedScheduleForDate(year, month, day);
    const idealDur = ideal ? lightingDurationMinutes(ideal.on_time, ideal.off_time) : 0;
    const allNight = civilAverageTimes(year, month, day);
    const allNightDur = allNight ? lightingDurationMinutes(hFmt(allNight.on), hFmt(allNight.off)) : 0;
    const active = activeLogForDate(catLogsDesc, dateStr);
    const fallback = active || ideal;
    const actualDur = fallback && !fallback.is_always_off ? lightingDurationMinutes(fallback.on_time, fallback.off_time) : 0;
    idealFullYear += idealDur || 0;
    allNightIdealFullYear += allNightDur || 0;
    estimatedFullYear += actualDur || 0;
    if (dateStr <= today) {
      estimatedYtd += actualDur || 0;
      if (active && !active.is_always_off) registeredYtd += lightingDurationMinutes(active.on_time, active.off_time) || 0;
    }
  }
  return { registeredYtd, estimatedYtd, idealFullYear, estimatedFullYear, allNightIdealFullYear };
}

function diffText(minutes) {
  if (minutes == null) return "—";
  const abs = Math.abs(minutes);
  if (minutes === 0) return "Яг тохирсон";
  return `${abs} минут ${minutes < 0 ? "эрт" : "оройтсон"}`;
}

function annualReportPanel(logs, year) {
  const data = annualReportData(logs, year);
  const totalChanges = data.reduce((s,x)=>s+x.logs.length,0);
  const changedCats = data.filter(x => x.logs.length > 0).length;
  const baseline = data[0]?.totals || { estimatedYtd:0, idealFullYear:0, allNightIdealFullYear:0 };
  return `<div class="panel" style="margin-bottom:16px;overflow:hidden">
    <div style="padding:16px 18px;border-bottom:1px solid #e2e6ed;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;background:linear-gradient(135deg,#f8fafc,#eff6ff)">
      <div>
        <div style="font-size:15px;font-weight:900;color:#0f172a">📄 ${year} оны гэрэлтүүлгийн цаг тохиргооны тайлан</div>
        <div style="font-size:12px;color:#64748b;margin-top:3px">Жилийн өөрчлөлт, сарын асалтын хугацаа, тохиромжтой асаах цагийн зөрүү, ангиллаар нэгтгэсэн тайлан</div>
      </div>
      <button class="btn" style="padding:9px 16px;border-radius:10px" onclick="lsPrintAnnualReport()">Тайлан хэвлэх</button>
    </div>
    <div style="padding:14px 18px;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px">
      ${[
        ["Нийт тааруулсан", `${totalChanges} удаа`, "#eff6ff", "#1d4ed8"],
        ["Өөрчлөлттэй ангилал", `${changedCats}/${SCHED_CATS.length}`, "#f0fdf4", "#15803d"],
        ["Оны эхнээс нийт асалт", durationText(baseline.estimatedYtd), "#fff7ed", "#c2410c"],
        ["Бүтэн жилийн зохимжит асалт", durationText(baseline.idealFullYear), "#f8fafc", "#475569"],
        ["Шөнийн турш асаавал", durationText(baseline.allNightIdealFullYear), "#fef2f2", "#dc2626"],
      ].map(([label,val,bg,color]) => `
        <div style="background:${bg};border:1px solid #e2e8f0;border-radius:10px;padding:12px">
          <div style="font-size:10px;color:#64748b;font-weight:800;text-transform:uppercase">${label}</div>
          <div style="font-size:18px;font-weight:900;color:${color};margin-top:4px">${escapeHtml(val)}</div>
        </div>`).join("")}
    </div>
    <div style="padding:0 18px 14px;font-size:11px;color:#64748b">Цагийн үзүүлэлтүүдийг нэг төрлийн гэрэлтүүлгийн жишиг цаг гэж харуулсан, ангиллуудыг хооронд нь нэмж үржүүлээгүй. Бүртгэлгүй өдрүүдийг тухайн өдрийн зохимжит асаах цагаас 01:00 хүртэл автоматаар нөхөж тооцсон.</div>
  </div>`;
}

function annualReportHtml(logs, year) {
  const data = annualReportData(logs, year);
  const generated = new Date().toLocaleString("mn-MN");
  const summaryRows = data.map(d => `
    <tr>
      <td>${escapeHtml(d.cat)}</td>
      <td class="num">${d.logs.length}</td>
      <td>${d.avg != null ? durationText(d.avg) : "—"}</td>
      <td>${d.min != null ? durationText(d.min) : "—"}</td>
      <td>${d.max != null ? durationText(d.max) : "—"}</td>
      <td>${durationText(d.totals.estimatedYtd)}</td>
      <td>${durationText(d.totals.idealFullYear)}</td>
      <td>${durationText(d.totals.allNightIdealFullYear)}</td>
    </tr>`).join("");
  const monthlySections = data.map(d => `
    <h2>${escapeHtml(d.cat)} - сарын өөрчлөлтийн зураглал</h2>
    <table>
      <thead><tr><th>Сар</th><th>Идэвхтэй цаг</th><th>Эх сурвалж</th><th>Асалтын хугацаа</th><th>Тохиромжтой асаахаас зөрүү</th><th>Хүчинтэй огноо</th><th>Тохируулсан хүн</th></tr></thead>
      <tbody>${d.monthly.map(m => `
        <tr>
          <td>${escapeHtml(m.label)}</td>
          <td>${m.active?.is_always_off ? "Унтраасан" : `${escapeHtml(m.active?.on_time || "—")} - ${escapeHtml(m.active?.off_time || "—")}`}</td>
          <td>${m.active?.is_auto_recommended ? "Зохимжит автомат тооцоо" : "Бүртгэлтэй тохиргоо"}</td>
          <td>${m.duration != null ? durationText(m.duration) : "—"}</td>
          <td>${diffText(m.diff)}</td>
          <td>${escapeHtml(m.active?.valid_from || m.active?.adjusted_date || "—")}</td>
          <td>${escapeHtml(m.active?.adjusted_by_name || "—")}</td>
        </tr>`).join("")}</tbody>
    </table>`).join("");
  const changeSections = data.map(d => {
    const asc = [...d.logs].sort((a,b) => String(a.valid_from || "").localeCompare(String(b.valid_from || "")));
    return `<h2>${escapeHtml(d.cat)} - өөрчлөлтийн бүртгэл</h2>
      <table>
        <thead><tr><th>Огноо</th><th>Хэдээс хэд болсон</th><th>Асалтын хугацаа</th><th>Тохируулсан хүн</th><th>Тайлбар</th></tr></thead>
        <tbody>${asc.length ? asc.map((l, i) => {
          const prev = asc[i - 1];
          const oldRange = prev?.is_always_off ? "Унтраасан" : prev ? `${prev.on_time || "—"} - ${prev.off_time || "—"}` : "Анхны тохиргоо";
          const newRange = l.is_always_off ? "Унтраасан" : `${l.on_time || "—"} - ${l.off_time || "—"}`;
          return `<tr>
            <td>${escapeHtml(l.valid_from || l.adjusted_date || "—")}</td>
            <td>${escapeHtml(oldRange)} → <b>${escapeHtml(newRange)}</b></td>
            <td>${l.is_always_off ? "—" : durationText(lightingDurationMinutes(l.on_time, l.off_time))}</td>
            <td>${escapeHtml(l.adjusted_by_name || "—")}</td>
            <td>${escapeHtml(l.notes || "")}</td>
          </tr>`;
        }).join("") : `<tr><td colspan="5" class="muted">Өөрчлөлт бүртгэгдээгүй</td></tr>`}</tbody>
      </table>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${year} гэрэлтүүлгийн цагийн тайлан</title>
    <style>
      body{font-family:Arial,sans-serif;color:#0f172a;margin:24px;font-size:12px}
      h1{font-size:20px;margin:0 0 4px} h2{font-size:15px;margin:22px 0 8px}
      .muted{color:#64748b}.head{display:flex;justify-content:space-between;border-bottom:2px solid #0f172a;padding-bottom:10px;margin-bottom:14px}
      table{width:100%;border-collapse:collapse;margin-bottom:12px} th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left}
      th{background:#f1f5f9;font-size:11px;text-transform:uppercase;color:#334155}.num{text-align:right}
      @media print{button{display:none} body{margin:12mm}}
    </style></head><body>
      <div class="head"><div><h1>${year} оны гэрэлтүүлгийн цаг тохиргооны тайлан</h1><div class="muted">Чойбалсан хот · 48.07°N 114.54°E · UTC+8</div></div><div class="muted">Үүсгэсэн: ${generated}</div></div>
      <button onclick="window.print()" style="padding:8px 14px;margin-bottom:12px">Хэвлэх</button>
      <h2>Жилийн нэгтгэл</h2>
      <table><thead><tr><th>Ангилал</th><th>Тааруулсан тоо</th><th>Дундаж асалт</th><th>Хамгийн богино</th><th>Хамгийн урт</th><th>Оны эхнээс ассан</th><th>Бүтэн жилийн зохимжит</th><th>Шөнийн турш асаавал</th></tr></thead><tbody>${summaryRows}</tbody></table>
      <div class="muted">Бүртгэлгүй сар, өдрүүдийг тухайн өдрийн зохимжит асаах цагаас 01:00 хүртэл автоматаар нөхөж тооцсон. “Шөнийн турш асаавал” нь асаах тохиромжтой цагаас өглөө унтраах тохиромжтой цаг хүртэлх хувилбар.</div>
      ${monthlySections}
      ${changeSections}
    </body></html>`;
}

export async function sl_light_sched() {
  // Sync module vars from window globals before rebuilding UI
  _lsDate = window._lsDate || _lsDate || todayStr();
  _lsYear = parseDateStr(_lsDate).year;
  _lsCat = ALL_CATS;
  _lsMonth = parseDateStr(_lsDate).month;

  const canEdit = ["director","chief_engineer","accountant","electric"].includes(state.me.role);
  const embedTargetId = window._lightingScheduleEmbedTarget || "";
  const embedTarget = embedTargetId ? document.getElementById(embedTargetId) : null;
  if (embedTargetId && !embedTarget) window._lightingScheduleEmbedTarget = "";
  const embedded = Boolean(embedTarget);
  const el = embedTarget || document.getElementById("main");
  if (!el) return;

  el.innerHTML = `
  <div style="${embedded ? "" : "padding:24px 28px;"}max-width:none;width:100%">
    <div style="${embedded ? "justify-content:flex-end;margin-bottom:14px" : "align-items:center;justify-content:space-between;margin-bottom:20px"};display:flex;flex-wrap:wrap;gap:10px">
      ${embedded ? "" : `
      <div>
        <h1 style="margin:0 0 4px;font-size:22px;font-weight:800">🌙 Гэрэлтүүлгийн цаг тохиргоо</h1>
        <div style="font-size:12px;color:#667085">Чойбалсан хот · 48.07°N 114.54°E · UTC+8 · Тод гэгээтэй үеийн тооцоолол</div>
      </div>
      `}
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        ${canEdit ? `<button class="btn" onclick="lsOpenAdd()">+ Дахин тааруулах</button>` : ""}
      </div>
    </div>

    <div id="lsBody">
      <div style="text-align:center;padding:40px;color:#94a3b8">Ачааллаж байна...</div>
    </div>

    <div id="lsModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2000;align-items:center;justify-content:center"
      onclick="if(event.target===this)lsCloseModal()">
      <div id="lsModalInner" style="background:#fff;border-radius:14px;width:min(480px,96vw);padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.25)"></div>
    </div>
  </div>`;

  await lsRender();
}

export async function slHubLightSched() {
  window._lightingScheduleEmbedTarget = "slHubContent";
  await sl_light_sched();
}

async function lsRender() {
  _lsDate = window._lsDate || _lsDate || todayStr();
  const selected = parseDateStr(_lsDate);
  _lsYear = selected.year;
  _lsCat  = ALL_CATS;
  _lsMonth = selected.month;
  const canEdit = ["director","chief_engineer","accountant","electric"].includes(state.me.role);

  let allLogs = [];
  try {
    const currentLogs = await api(`/api/light-schedules?year=${_lsYear}`);
    const prevLogs = await api(`/api/light-schedules?year=${_lsYear - 1}`);
    allLogs = [...currentLogs, ...prevLogs].sort((a,b) => String(b.valid_from || "").localeCompare(String(a.valid_from || "")));
  }
  catch(e) {}
  const logs = allLogs;
  _lsReportLogs = allLogs;

  const historyPanel = (cat) => {
    const catLogs = logs.filter(l => l.category === cat);
    const asc = [...catLogs].sort((a,b) => String(a.valid_from || "").localeCompare(String(b.valid_from || "")));
    const prevById = new Map();
    asc.forEach((log, i) => prevById.set(log.id, asc[i - 1] || null));

    const rows = catLogs.length ? catLogs.map(l => {
      const prev = prevById.get(l.id);
      const oldRange = prev?.is_always_off
        ? "Унтраасан"
        : prev ? `${prev.on_time || "—"} - ${prev.off_time || "—"}` : "Анхны тохиргоо";
      const newRange = l.is_always_off ? "Унтраасан" : `${l.on_time || "—"} - ${l.off_time || "—"}`;
      return `
        <tr>
          <td style="font-size:12px;font-family:monospace">${escapeHtml(l.adjusted_date||l.valid_from||"")}</td>
          <td style="font-size:12px">
            <span style="color:#94a3b8">${escapeHtml(oldRange)}</span>
            <span style="color:#64748b;margin:0 6px">→</span>
            <strong style="color:#0f172a">${escapeHtml(newRange)}</strong>
          </td>
          <td style="text-align:center">
            ${l.is_always_off
              ? `<span style="background:#fef2f2;color:#dc2626;border-radius:20px;padding:2px 10px;font-size:11px;font-weight:700">Унтраасан</span>`
              : `<span style="font-weight:700;color:#f59e0b">${escapeHtml(l.on_time||"—")}</span>`}
          </td>
          <td style="text-align:center">
            ${l.is_always_off ? "" : `<span style="font-weight:700;color:#2563eb">${escapeHtml(l.off_time||"—")}</span>`}
          </td>
          <td style="text-align:center;font-size:12px;font-weight:700;color:#1d4ed8">
            ${l.is_always_off ? "" : durationText(lightingDurationMinutes(l.on_time, l.off_time))}
          </td>
          <td style="font-size:12px">${escapeHtml(l.adjusted_by_name||"")}</td>
          <td style="font-size:11px;color:#667085;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(l.notes||"")}</td>
          ${canEdit ? `<td style="text-align:right">
            <button class="btn secondary sm" style="color:#dc2626;border-color:#fecaca;background:#fff5f5"
              title="Энэ түүхийг устгах" onclick="lsDeleteHistory(${Number(l.id)})">🗑 Устгах</button>
          </td>` : ""}
        </tr>`;
    }).join("") :
      `<tr><td colspan="${canEdit ? 8 : 7}" style="text-align:center;color:#94a3b8;padding:18px">Энэ ангилалд түүх алга байна</td></tr>`;

    return `<div class="panel" style="margin-bottom:16px">
      <div style="padding:14px 18px;border-bottom:1px solid #e2e6ed;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
        <span style="font-size:14px;font-weight:800">${escapeHtml(cat)} тохиргооны түүх</span>
        <span style="font-size:12px;color:#94a3b8">${catLogs.length} бүртгэл</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Өөрчилсөн огноо</th>
            <th>Хэдээс хэд болсон</th>
            <th style="text-align:center">Асах цаг</th>
            <th style="text-align:center">Унтраах цаг</th>
            <th style="text-align:center">Асалтын хугацаа</th>
            <th>Тохируулсан хүн</th>
            <th>Тайлбар</th>
            ${canEdit ? `<th style="width:96px;text-align:right">Үйлдэл</th>` : ""}
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
  };

  document.getElementById("lsBody").innerHTML = `
    ${annualReportPanel(allLogs, _lsYear)}
    ${timelinePreview(allLogs, canEdit)}

    <div style="display:grid;gap:16px">
      ${SCHED_CATS.map(historyPanel).join("")}
    </div>`;
}

// ── Draggable modal ───────────────────────────────────────────
function lsInitDrag() {
  const inner = document.getElementById("lsModalInner");
  if (!inner) return;
  const r = inner.getBoundingClientRect();
  inner.style.position = "fixed";
  inner.style.top  = r.top  + "px";
  inner.style.left = r.left + "px";
  inner.style.margin = "0";
  inner.style.maxHeight = "90vh";
  inner.style.overflowY = "auto";

  const handle = inner.querySelector(".ls-drag-handle");
  if (!handle) return;
  handle.style.cursor = "grab";
  handle.style.userSelect = "none";

  let dragging = false, ox = 0, oy = 0;
  const onMove = e => {
    if (!dragging) return;
    const maxL = window.innerWidth  - inner.offsetWidth;
    const maxT = window.innerHeight - inner.offsetHeight;
    inner.style.left = Math.max(0, Math.min(maxL, e.clientX - ox)) + "px";
    inner.style.top  = Math.max(0, Math.min(maxT, e.clientY - oy)) + "px";
  };
  const onUp = () => { dragging = false; handle.style.cursor = "grab"; };
  handle.addEventListener("mousedown", e => {
    dragging = true;
    const r2 = inner.getBoundingClientRect();
    ox = e.clientX - r2.left;
    oy = e.clientY - r2.top;
    handle.style.cursor = "grabbing";
    e.preventDefault();
  });
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup",  onUp);
  inner._lsDragCleanup = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup",  onUp);
    inner.style.position = inner.style.top = inner.style.left = inner.style.margin = "";
  };
}

// ── Modal: Add ────────────────────────────────────────────────
window.lsOpenAdd = function() {
  const selectedDate = _lsDate || todayStr();
  const { year, month, day } = parseDateStr(selectedDate);
  const suitable = civilAverageTimes(year, month, day);
  const defOn  = suitable ? hFmt(suitable.on) : "19:00";
  const defOff = suitable ? hFmt(suitable.off) : "01:00";
  document.getElementById("lsModalInner").innerHTML = `
    <div class="ls-drag-handle" style="font-size:15px;font-weight:800;margin-bottom:16px">+ Дахин тааруулах</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
      <div style="grid-column:1/-1">
        <div style="font-size:11px;color:#667085;margin-bottom:4px">Ангилал</div>
        ${catCheckList(SCHED_CATS)}
      </div>
      <div>
        <div style="font-size:11px;color:#667085;margin-bottom:4px">Тохируулгын огноо *</div>
        <input class="input" type="date" id="lsf_adj" value="${selectedDate}">
      </div>
      <div>
        <div style="font-size:11px;color:#667085;margin-bottom:4px">💡 Асах цаг</div>
        <input class="input" type="time" id="lsf_on" value="${defOn}">
      </div>
      <div>
        <div style="font-size:11px;color:#667085;margin-bottom:4px">🔌 Унтраах цаг</div>
        <input class="input" type="time" id="lsf_off" value="${defOff}">
      </div>
      <div style="grid-column:1/-1">
        <div style="font-size:11px;color:#667085;margin-bottom:4px">Тайлбар</div>
        <input class="input" id="lsf_notes" placeholder="Жишээ: Зун улирлын тохируулга...">
      </div>
    </div>
    <div style="display:flex;gap:8px">
      <button class="btn" onclick="lsSave(null)">Хадгалах</button>
      <button class="btn secondary" onclick="lsCloseModal()">Болих</button>
    </div>`;
  document.getElementById("lsModal").style.display = "flex";
  lsInitDrag();
};

window.lsToggleAllCats = function(cb) {
  document.querySelectorAll(".lsf-cat-check").forEach(x => { x.checked = cb.checked; });
};

window.lsSyncAllCats = function() {
  const all = document.getElementById("lsf_cat_all");
  if (!all) return;
  const checks = [...document.querySelectorAll(".lsf-cat-check")];
  all.checked = checks.length > 0 && checks.every(x => x.checked);
};

window.lsSave = async function(id) {
  const g = el => (document.getElementById(el)||{}).value||"";
  const scheduleDate = g("lsf_adj");
  if (!scheduleDate) { toast("Огноо оруулна уу"); return; }
  const body = {
    adjusted_date: scheduleDate,
    valid_from: scheduleDate,
    on_time:  g("lsf_on")  || null,
    off_time: g("lsf_off") || null,
    is_always_off: false,
    notes: g("lsf_notes"),
  };
  try {
    const cats = selectedScheduleCats();
    if (!cats.length) { toast("Ангилал сонгоно уу"); return; }
    for (const category of cats) {
      await api("/api/light-schedules", { method:"POST", body:JSON.stringify({ ...body, category }) });
    }
    toast(`${cats.length} ангилалд бүртгэгдлээ ✓`);
    lsCloseModal();
    await lsRender();
  } catch(e) { toast("Алдаа: " + e.message); }
};

window.lsDeleteHistory = async function(id) {
  if (!id) return;
  if (!confirm("Энэ тохиргооны түүхийг устгах уу?")) return;
  try {
    await api(`/api/light-schedules/${id}`, { method:"DELETE" });
    toast("Түүх устгагдлаа");
    await lsRender();
  } catch(e) {
    toast("Устгах үед алдаа гарлаа: " + e.message);
  }
};

window.lsSetDate = async function(dateStr) {
  if (!dateStr) return;
  _lsDate = dateStr;
  window._lsDate = dateStr;
  await lsRender();
};

window.lsShiftDay = async function(days) {
  _lsDate = shiftDateStr(_lsDate, days);
  window._lsDate = _lsDate;
  await lsRender();
};

window.lsSetToday = async function() {
  _lsDate = todayStr();
  window._lsDate = _lsDate;
  await lsRender();
};

window.lsWheelDate = function(event) {
  event.preventDefault();
  window.lsShiftDay(event.deltaY > 0 ? 1 : -1);
};

window.lsPrintAnnualReport = function() {
  const html = annualReportHtml(_lsReportLogs, _lsYear);
  const w = window.open("", "_blank");
  if (!w) { toast("Popup блоклогдсон байна. Browser popup зөвшөөрнө үү."); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
};

window.lsCloseModal = function() {
  const inner = document.getElementById("lsModalInner");
  if (inner?._lsDragCleanup) { inner._lsDragCleanup(); delete inner._lsDragCleanup; }
  const m = document.getElementById("lsModal");
  if (m) m.style.display = "none";
};

Object.assign(window, { sl_light_sched, slHubLightSched, lsRender });
