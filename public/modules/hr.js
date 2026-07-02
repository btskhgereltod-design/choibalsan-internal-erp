import { state, api, toast, table, userOptions, escapeHtml, today, codeClass } from './common.js';

// ── Globals for inline onclick handlers ──────────────────────
if (window.attViewMonth === undefined) window.attViewMonth = new Date().getMonth() + 1;

// ── Module-level state ────────────────────────────────────────
let editingEmployeeId = null;
let currentProfileUserId = null;

const ATTENDANCE_DAY_HOURS = 8;

function attParseYmd(value) {
  const [y, m, d] = String(value || "").slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return new Date(NaN);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

function attYmd(date = new Date()) {
  const d = date instanceof Date ? date : attParseYmd(date);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function attendanceHourValue(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function attendanceHours(record) {
  const hasHours = record && ["work_hours", "leave_hours", "overtime_hours"]
    .some(key => record[key] !== null && record[key] !== undefined && record[key] !== "");
  if (hasHours) {
    return {
      work: attendanceHourValue(record.work_hours),
      leave: attendanceHourValue(record.leave_hours),
      overtime: attendanceHourValue(record.overtime_hours)
    };
  }
  const type = record?.record_type;
  const works = ["Ажилласан", "Хоцорсон", "Илүү цаг"].includes(type);
  const off = ["Ажил тасалсан", "Чөлөө", "Өвчтэй", "Ээлжийн амралт"].includes(type);
  const overtimeMatch = String(record?.note || "").match(/Илүү цаг:\s*([\d.]+)/);
  return {
    work: works ? ATTENDANCE_DAY_HOURS : 0,
    leave: off ? ATTENDANCE_DAY_HOURS : 0,
    overtime: overtimeMatch ? attendanceHourValue(overtimeMatch[1]) : 0
  };
}

function attendanceHourText(value) {
  const n = attendanceHourValue(value);
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

function attendanceTypeCode(type) {
  return {
    "Ажилласан":"А", "Ажил тасалсан":"Т", "Чөлөө":"Ч",
    "Өвчтэй":"Ө", "Ээлжийн амралт":"Э", "Хоцорсон":"Х", "Илүү цаг":"ИЦ"
  }[type] || "";
}

function attendanceRecordCode(record) {
  if (!record) return "";
  const h = attendanceHours(record);
  const typeCode = attendanceTypeCode(record.record_type);
  const workCode = record.record_type === "Хоцорсон" ? "Х" : "А";
  const offCode = ["Ажилласан", "Хоцорсон", "Илүү цаг"].includes(record.record_type) ? "Ч" : typeCode;
  const parts = [];
  if (h.work > 0) parts.push(h.work === ATTENDANCE_DAY_HOURS ? workCode : `${workCode}${attendanceHourText(h.work)}`);
  if (h.leave > 0) parts.push(`${offCode || "Ч"}${h.leave === ATTENDANCE_DAY_HOURS && !h.work ? "" : attendanceHourText(h.leave)}`);
  if (h.overtime > 0) parts.push(`+${attendanceHourText(h.overtime)}`);
  return parts.join("/") || offCode;
}

function attendanceOffType(record) {
  if (["Ажил тасалсан", "Чөлөө", "Өвчтэй", "Ээлжийн амралт"].includes(record?.record_type)) {
    return record.record_type;
  }
  return attendanceHourValue(record?.leave_hours) > 0 ? "Чөлөө" : "";
}

function addAttendanceOffHours(summary, record, hours) {
  const offType = attendanceOffType(record);
  if (offType === "Ажил тасалсан") summary.absent += hours.leave;
  if (offType === "Чөлөө") summary.leave += hours.leave;
  if (offType === "Өвчтэй") summary.sick += hours.leave;
  if (offType === "Ээлжийн амралт") summary.vacation += hours.leave;
}

function onCellEditTypeChange() {
  const type = document.getElementById("cellEditType")?.value;
  const workInput = document.getElementById("cellWorkHours");
  const leaveInput = document.getElementById("cellLeaveHours");
  const overtimeInput = document.getElementById("cellOvertimeHours");
  if (type === "Илүү цаг") {
    if (attendanceHourValue(workInput?.value) === 0 && workInput) workInput.value = 8;
    if (leaveInput) leaveInput.value = 0;
    overtimeInput?.focus();
  }
}

// ════════════════════════════════════════════════════════════
// ИРЦ / ЦАГИЙН БҮРТГЭЛ
// ════════════════════════════════════════════════════════════

async function attendance() {
  const rows = await api("/api/hr-records");
  const year = new Date().getFullYear();
  const month = new Date().getMonth() + 1;
  const days = new Date(year, month, 0).getDate();
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear  = month === 1 ? year - 1 : year;
  const defRangeStart = `${prevYear}-${String(prevMonth).padStart(2,"0")}-25`;
  const defRangeEnd   = `${year}-${String(month).padStart(2,"0")}-25`;
  const todayDate = today();
  const todaySummary = { worked:0, absent:0, leave:0, sick:0, vacation:0, late:0, overtime:0 };

  const byUser = {};
  const latestRecordByDay = {};
  state.users.forEach(u => {
    byUser[u.id] = {
      user: u,
      days: {},
      summary: { worked:0, absent:0, leave:0, sick:0, vacation:0, overtime:0 }
    };
  });

  rows.forEach(r => {
    if (!byUser[r.user_id] || !r.start_date) return;

    const start = attParseYmd(r.start_date);
    const end = attParseYmd(r.end_date || r.start_date);
    const monthStart = new Date(year, month - 1, 1, 12);
    const monthEnd = new Date(year, month - 1, days, 12);

    const rangeStart = start > monthStart ? start : monthStart;
    const rangeEnd = end < monthEnd ? end : monthEnd;
    if (rangeStart > rangeEnd) return;

    for (let cursor = new Date(rangeStart); cursor <= rangeEnd; cursor.setDate(cursor.getDate() + 1)) {
      const day = cursor.getDate();
      const key = `${r.user_id}|${day}`;
      if (!latestRecordByDay[key] || r.id > latestRecordByDay[key].id) {
        latestRecordByDay[key] = { record: r, date: new Date(cursor) };
      }
    }
  });

  Object.values(latestRecordByDay).forEach(entry => {
    const r = entry.record;
    const d = entry.date;
    const day = d.getDate();
    const code = attendanceRecordCode(r);
    const hours = attendanceHours(r);

    byUser[r.user_id].days[day] = code;

    if (hours.work > 0) byUser[r.user_id].summary.worked += hours.work / ATTENDANCE_DAY_HOURS;
    const offType = attendanceOffType(r);
    if (offType === "Ажил тасалсан") byUser[r.user_id].summary.absent += hours.leave / ATTENDANCE_DAY_HOURS;
    if (offType === "Чөлөө") byUser[r.user_id].summary.leave += hours.leave / ATTENDANCE_DAY_HOURS;
    if (offType === "Өвчтэй") byUser[r.user_id].summary.sick += hours.leave / ATTENDANCE_DAY_HOURS;
    if (offType === "Ээлжийн амралт") byUser[r.user_id].summary.vacation += hours.leave / ATTENDANCE_DAY_HOURS;
    byUser[r.user_id].summary.overtime += hours.overtime;

    if (attYmd(d) === todayDate) {
      if (hours.work > 0) todaySummary.worked++;
      if (offType === "Ажил тасалсан" && hours.leave > 0) todaySummary.absent++;
      if (offType === "Чөлөө" && hours.leave > 0) todaySummary.leave++;
      if (offType === "Өвчтэй" && hours.leave > 0) todaySummary.sick++;
      if (offType === "Ээлжийн амралт" && hours.leave > 0) todaySummary.vacation++;
      if (r.record_type === "Хоцорсон") todaySummary.late++;
      todaySummary.overtime += hours.overtime;
    }
  });

  const canEditAttendance = ["director", "hr"].includes(state.me?.role);

  main.innerHTML = `
  <h1>Ирц / цагийн бүртгэл</h1>

  ${canEditAttendance ? `
  <div class="panel">
    <h2>Өнөөдрийн ирц бүртгэх</h2>

    <div class="row3">
      <select class="input" id="auser">${userOptions()}</select>

      <select class="input" id="atype" onchange="onAttendanceTypeChange()">
        <option>Ажилласан</option>
        <option>Чөлөө</option>
        <option>Ажил тасалсан</option>
        <option>Өвчтэй</option>
        <option>Ээлжийн амралт</option>
        <option>Хоцорсон</option>
      </select>

      <input class="input" id="adate" type="date" value="${today()}" max="${today()}">
    </div>

    <div id="attendanceDynamicFields"></div>

    <input class="input" id="anote" placeholder="Тайлбар">
    <button class="btn" onclick="saveAttendance()">Хадгалах</button>
    <button class="btn secondary" onclick="markAllWorked()">Өнөөдөр бүгдийг ажилласан болгох</button>
  </div>` : ``}

  <div class="panel">
    <h2>Өнөөдрийн ирцийн дүн</h2>
    <div class="grid">
      <div class="stat"><span class="muted">Ажилласан</span><b>${todaySummary.worked}</b></div>
      <div class="stat"><span class="muted">Тасалсан</span><b>${todaySummary.absent}</b></div>
      <div class="stat"><span class="muted">Чөлөө</span><b>${todaySummary.leave}</b></div>
      <div class="stat"><span class="muted">Өвчтэй</span><b>${todaySummary.sick}</b></div>
      <div class="stat"><span class="muted">Амралт</span><b>${todaySummary.vacation}</b></div>
      <div class="stat"><span class="muted">Илүү цаг</span><b>${attendanceHourText(todaySummary.overtime)}ц</b></div>
    </div>
  </div>

  <div class="panel">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #e2e6ed;flex-wrap:wrap;gap:10px">
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" id="tabMonthBtn" onclick="switchAttTab('month')">📅 Сарын матриц</button>
        <button class="btn secondary" id="tabYearBtn" onclick="switchAttTab('year')">📊 Жилийн дүн</button>
        <button class="btn secondary" id="tabRangeBtn" onclick="switchAttTab('range')">📆 Интервалаар</button>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <div id="attYearNav" style="display:flex;align-items:center;gap:6px">
          <button class="btn secondary sm" onclick="attChangeYear(-1)">‹</button>
          <span id="attYearLabel" style="font-weight:700;font-size:13px;min-width:52px;text-align:center">${year} он</span>
          <button class="btn secondary sm" onclick="attChangeYear(1)">›</button>
        </div>
        <div id="attMonthNav" style="display:flex;align-items:center;gap:6px">
          <button class="btn secondary sm" onclick="attViewMonth=attViewMonth>1?attViewMonth-1:12;renderAttMonth(window._attYear,attViewMonth)">‹</button>
          <span id="attMonthLabel" title="Цалингийн интервал харах" onclick="attJumpToPayrollInterval()" style="font-weight:700;font-size:13px;min-width:62px;text-align:center;cursor:pointer;text-decoration:underline dotted #94a3b8">${month}-р сар</span>
          <button class="btn secondary sm" onclick="attViewMonth=attViewMonth<12?attViewMonth+1:1;renderAttMonth(window._attYear,attViewMonth)">›</button>
        </div>
        <div id="attRangeNav" style="display:none;align-items:center;gap:6px;flex-wrap:wrap">
          <button class="btn secondary sm" id="attRangePickerBtn" onclick="showAttCalendar()" style="display:flex;align-items:center;gap:5px;font-size:12px">
            📅 <span id="attRangeLabel">${defRangeStart} — ${defRangeEnd}</span>
          </button>
          <input type="hidden" id="attRangeStart" value="${defRangeStart}">
          <input type="hidden" id="attRangeEnd" value="${defRangeEnd}">
          <button class="btn secondary sm" onclick="renderAttRange(document.getElementById('attRangeStart').value,document.getElementById('attRangeEnd').value)">Харах</button>
        </div>
        <button class="btn secondary sm" onclick="attPrint()" style="margin-left:8px">🖨️ Хэвлэх</button>
      </div>
    </div>

    <div class="legend" style="padding:12px 18px;border-bottom:1px solid #e2e6ed">
      <span class="dayCode worked">А</span> Ажилласан
      <span class="dayCode absent">Т</span> Тасалсан
      <span class="dayCode leave">Ч</span> Чөлөө
      <span class="dayCode sick">Ө</span> Өвчтэй
      <span class="dayCode vacation">Э</span> Амралт
      <span class="dayCode late">Х</span> Хоцорсон
      <span class="dayCode overtime">+2</span> Илүү цаг
      <span style="font-size:11px;color:#64748b">А4/Ч4 = 4 цаг ажилласан, 4 цаг чөлөө</span>
      <span style="margin-left:8px;font-size:11px;color:#94a3b8">🟥 Амралтын өдөр</span>
    </div>

    <div id="attTabContent"></div>
  </div>`;

  window._attRows    = rows;
  window._attYear    = year;
  window._attByUser  = byUser;
  window.attViewMonth = month;
  window._attRangeStart = defRangeStart;
  window._attRangeEnd   = defRangeEnd;

  switchAttTab("month");
  onAttendanceTypeChange();
}

function switchAttTab(tab) {
  window._attTab = tab;
  const btn1 = document.getElementById("tabMonthBtn");
  const btn2 = document.getElementById("tabYearBtn");
  const btn3 = document.getElementById("tabRangeBtn");
  if (btn1) { btn1.className = tab==="month" ? "btn" : "btn secondary"; }
  if (btn2) { btn2.className = tab==="year"  ? "btn" : "btn secondary"; }
  if (btn3) { btn3.className = tab==="range" ? "btn" : "btn secondary"; }
  const mn = document.getElementById("attMonthNav");
  const yn = document.getElementById("attYearNav");
  const rn = document.getElementById("attRangeNav");
  if (mn) mn.style.display = tab === "month" ? "flex" : "none";
  if (yn) yn.style.display = tab === "year"  ? "flex" : "none";
  if (rn) rn.style.display = tab === "range" ? "flex" : "none";
  if (tab === "month") {
    renderAttMonth(window._attYear, window.attViewMonth);
  } else if (tab === "year") {
    renderAttYear(window._attYear);
  } else {
    const s = document.getElementById("attRangeStart")?.value || window._attRangeStart;
    const e = document.getElementById("attRangeEnd")?.value   || window._attRangeEnd;
    if (s && e) renderAttRange(s, e);
  }
}

function attChangeYear(dir) {
  window._attYear = (window._attYear || new Date().getFullYear()) + dir;
  const lbl = document.getElementById("attYearLabel");
  if (lbl) lbl.textContent = window._attYear + " он";
  switchAttTab(window._attTab || "month");
}

function attJumpToPayrollInterval() {
  const mo   = window.attViewMonth || (new Date().getMonth() + 1);
  const yr   = window._attYear    || new Date().getFullYear();
  const prevM = mo === 1 ? 12 : mo - 1;
  const prevY = mo === 1 ? yr - 1 : yr;
  const s = `${prevY}-${String(prevM).padStart(2,"0")}-25`;
  const e = `${yr}-${String(mo).padStart(2,"0")}-25`;
  const si = document.getElementById("attRangeStart");
  const ei = document.getElementById("attRangeEnd");
  if (si) si.value = s;
  if (ei) ei.value = e;
  window._attRangeStart = s;
  window._attRangeEnd   = e;
  const lbl = document.getElementById("attRangeLabel");
  if (lbl) lbl.textContent = s + " — " + e;
  switchAttTab("range");
}

function showAttCalendar() {
  document.getElementById("attCalPopup")?.remove();
  const curStart = document.getElementById("attRangeStart")?.value || window._attRangeStart || "";
  const curEnd   = document.getElementById("attRangeEnd")?.value   || window._attRangeEnd   || "";

  let calYear  = curStart ? parseInt(curStart.slice(0,4)) : new Date().getFullYear();
  let calMonth = curStart ? parseInt(curStart.slice(5,7))-1 : new Date().getMonth();
  let selStart = curStart || null;
  let selEnd   = curEnd   || null;
  let picking  = "start";

  const mNames = ["1-р сар","2-р сар","3-р сар","4-р сар","5-р сар","6-р сар",
                  "7-р сар","8-р сар","9-р сар","10-р сар","11-р сар","12-р сар"];
  const dNames = ["Да","Мя","Лх","Пү","Ба","Бя","Ня"];

  function toStr(y,m,d) {
    return `${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
  }

  function render() {
    const pop = document.getElementById("attCalPopup");
    if (!pop) return;
    const daysInMonth = new Date(calYear, calMonth+1, 0).getDate();
    const firstDow = (new Date(calYear, calMonth, 1).getDay()+6)%7; // Mon=0

    let cells = "";
    for (let i=0; i<firstDow; i++) cells += `<div></div>`;
    for (let d=1; d<=daysInMonth; d++) {
      const ds  = toStr(calYear, calMonth, d);
      const dw  = (new Date(calYear,calMonth,d).getDay()+6)%7;
      const isW = dw>=5;
      const isS = ds===selStart;
      const isE = ds===selEnd;
      const inR = selStart && selEnd && ds>=selStart && ds<=selEnd;
      let bg="transparent",color=isW?"#dc2626":"#1e293b",fw=400,br="6px";
      if (isS||isE) { bg="#2563eb";color="#fff";fw=700; }
      else if (inR) { bg="#dbeafe";br="0"; }
      cells += `<div onclick="window._attCalClick('${ds}')"
        style="text-align:center;padding:6px 2px;cursor:pointer;background:${bg};color:${color};
               font-weight:${fw};border-radius:${br};font-size:12px;user-select:none"
        onmouseover="this.style.background=this.style.background||'#f1f5f9'">${d}</div>`;
    }

    const hint = picking==="start" ? "Эхлэх огноо сонгоно уу" : "Дуусах огноо сонгоно уу";
    pop.querySelector("#calGrid").innerHTML = cells;
    pop.querySelector("#calMonthLbl").textContent = `${mNames[calMonth]} ${calYear}`;
    pop.querySelector("#calHint").textContent = hint;
    pop.querySelector("#calSelLbl").textContent =
      (selStart||"???") + " — " + (selEnd||"???");
  }

  window._attCalClick = (ds) => {
    if (picking==="start") {
      selStart = ds; selEnd = null; picking = "end";
    } else {
      if (ds < selStart) { selEnd = selStart; selStart = ds; }
      else { selEnd = ds; }
      picking = "start";
    }
    render();
  };
  window._attCalNav = (dir) => { calMonth += dir; if (calMonth<0){calMonth=11;calYear--;} if (calMonth>11){calMonth=0;calYear++;} render(); };
  window._attCalApply = () => {
    if (!selStart || !selEnd) { toast("Огноо сонгоно уу"); return; }
    document.getElementById("attRangeStart").value = selStart;
    document.getElementById("attRangeEnd").value   = selEnd;
    window._attRangeStart = selStart;
    window._attRangeEnd   = selEnd;
    const lbl = document.getElementById("attRangeLabel");
    if (lbl) lbl.textContent = selStart + " — " + selEnd;
    document.getElementById("attCalPopup")?.remove();
    renderAttRange(selStart, selEnd);
  };
  window._attCalQuick = (label, s, e) => {
    selStart=s; selEnd=e; picking="start";
    calYear=parseInt(s.slice(0,4)); calMonth=parseInt(s.slice(5,7))-1;
    render();
  };

  const now  = new Date();
  const yr   = now.getFullYear(), mo = now.getMonth()+1;
  const pm   = mo===1?12:mo-1, py = mo===1?yr-1:yr;
  const q1s  = `${py}-${String(pm).padStart(2,"0")}-25`;
  const q1e  = `${yr}-${String(mo).padStart(2,"0")}-25`;
  const pm2  = pm===1?12:pm-1, py2= pm===1?py-1:py;
  const q2s  = `${py2}-${String(pm2).padStart(2,"0")}-25`;
  const q2e  = `${py}-${String(pm).padStart(2,"0")}-25`;
  const m1s  = `${yr}-${String(mo).padStart(2,"0")}-01`;
  const m1e  = `${yr}-${String(mo).padStart(2,"0")}-${new Date(yr,mo,0).getDate()}`;

  const pop = document.createElement("div");
  pop.id = "attCalPopup";
  pop.style = "position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:2000;display:flex;align-items:center;justify-content:center";
  pop.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:20px;width:340px;box-shadow:0 24px 64px rgba(0,0,0,.25)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <b style="font-size:14px">Огноо сонгох</b>
        <button onclick="document.getElementById('attCalPopup').remove()" style="background:none;border:none;font-size:18px;cursor:pointer;color:#94a3b8">✕</button>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
        <button onclick="window._attCalQuick('${mo}-р сар','${m1s}','${m1e}')" style="background:#f1f5f9;border:none;border-radius:8px;padding:4px 10px;font-size:11px;cursor:pointer">${mo}-р сар</button>
        <button onclick="window._attCalQuick('${mo}-р цалин','${q1s}','${q1e}')" style="background:#eff6ff;border:none;border-radius:8px;padding:4px 10px;font-size:11px;cursor:pointer;color:#2563eb">${mo}-р цалингийн хугацаа</button>
        <button onclick="window._attCalQuick('${pm}-р цалин','${q2s}','${q2e}')" style="background:#f0fdf4;border:none;border-radius:8px;padding:4px 10px;font-size:11px;cursor:pointer;color:#16a34a">${pm}-р цалингийн хугацаа</button>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <button onclick="window._attCalNav(-1)" style="background:#f1f5f9;border:none;border-radius:8px;padding:4px 10px;cursor:pointer">‹</button>
        <b id="calMonthLbl" style="font-size:13px"></b>
        <button onclick="window._attCalNav(1)"  style="background:#f1f5f9;border:none;border-radius:8px;padding:4px 10px;cursor:pointer">›</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-bottom:6px">
        ${dNames.map(d=>`<div style="text-align:center;font-size:10px;font-weight:700;color:#94a3b8;padding:3px 0">${d}</div>`).join("")}
      </div>
      <div id="calGrid" style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;min-height:120px"></div>
      <div id="calHint" style="font-size:11px;color:#64748b;margin-top:10px;text-align:center"></div>
      <div style="background:#f8fafc;border-radius:8px;padding:8px 12px;margin:10px 0;font-size:12px;font-weight:600;text-align:center">
        📅 <span id="calSelLbl" style="color:#2563eb"></span>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn secondary" style="flex:1" onclick="document.getElementById('attCalPopup').remove()">Цуцлах</button>
        <button class="btn" style="flex:1" onclick="window._attCalApply()">Хэрэглэх</button>
      </div>
    </div>`;
  document.body.appendChild(pop);
  render();
}

function attPrint() {
  const tab = window._attTab || "month";
  const yr = window._attYear || new Date().getFullYear();
  const mo = window.attViewMonth || (new Date().getMonth() + 1);
  if (tab === "month") {
    _attPrintMonthForm(yr, mo);
  } else if (tab === "range") {
    const s = document.getElementById("attRangeStart")?.value || window._attRangeStart;
    const e = document.getElementById("attRangeEnd")?.value   || window._attRangeEnd;
    if (s && e) _attPrintRangeForm(s, e);
  } else {
    _attPrintYearSimple(yr);
  }
}

function _attPrintMonthForm(yr, mo) {
  const daysInMonth = new Date(yr, mo, 0).getDate();
  let weekendDays = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dw = new Date(yr, mo - 1, d).getDay();
    if (dw === 0 || dw === 6) weekendDays++;
  }
  const workingDaysReq = daysInMonth - weekendDays;

  const rows = window._attRows || [];
  const users = (state.users || []).filter(u => u.active !== false);
  const byU = {};
  users.forEach(u => { byU[u.id] = { user: u, A:0, T:0, Ch:0, O:0, E:0, KH:0, ITs:0, OTDays:0 }; });

  const latest = {};
  rows.forEach(r => {
    if (!byU[r.user_id] || !r.start_date) return;
    const s = attParseYmd(r.start_date);
    const e = attParseYmd(r.end_date || r.start_date);
    const mS = new Date(yr, mo-1, 1, 12), mE = new Date(yr, mo-1, daysInMonth, 12);
    const rS = s > mS ? s : mS, rE = e < mE ? e : mE;
    if (rS > rE) return;
    for (let c = new Date(rS); c <= rE; c.setDate(c.getDate()+1)) {
      const dw = c.getDay();
      if (dw === 0 || dw === 6) continue;
      const key = `${r.user_id}|${c.getDate()}`;
      if (!latest[key] || r.id > latest[key].id) latest[key] = r;
    }
  });
  Object.entries(latest).forEach(([key, r]) => {
    const uid = key.split("|")[0];
    if (!byU[uid]) return;
    const h = attendanceHours(r);
    byU[uid].A += h.work;
    const offType = attendanceOffType(r);
    if (offType === "Ажил тасалсан") byU[uid].T += h.leave;
    if (offType === "Чөлөө") byU[uid].Ch += h.leave;
    if (offType === "Өвчтэй") byU[uid].O += h.leave;
    if (offType === "Ээлжийн амралт") byU[uid].E += h.leave;
    byU[uid].ITs += h.overtime;
    if (h.overtime > 0) byU[uid].OTDays++;
  });

  const shortName = n => {
    if (!n) return "";
    const p = n.trim().split(" ");
    return p.length >= 2 ? p[0][0] + "." + p[1] : n;
  };
  const hrUser  = users.find(u => u.role === "hr" || (u.position||"").toLowerCase().includes("хн менеж") || (u.position||"").toLowerCase().includes("хүний нөөц"));
  const accUser = users.find(u => (u.position||"").toLowerCase().includes("нягтлан"));

  let tot = { A:0, T:0, Ch:0, O:0, E:0, KH:0, ITs:0, OTDays:0 };
  const dataRows = Object.values(byU).map((u, i) => {
    const vac  = u.E / ATTENDANCE_DAY_HOURS;
    const req  = workingDaysReq;                   // Ажилласан зохих = хуанлийн ажлын өдөр (vacation хасдаггүй)
    const notW = u.T + u.Ch + u.O + u.E;           // Ажиллаагүй нийт цаг
    Object.keys(tot).forEach(k => { tot[k] += u[k]; });
    const e = v => `<td contenteditable="true">${v || ""}</td>`;
    return `<tr>
      <td contenteditable="true">${i+1}</td>
      <td contenteditable="true" style="text-align:left;white-space:nowrap">${u.user.full_name}</td>
      ${e(daysInMonth)}${e(weekendDays)}${e(vac||"")}
      ${e(req)}${e(req*8)}
      ${e(u.A ? u.A/ATTENDANCE_DAY_HOURS : "")}${e(u.A||"")}
      <td contenteditable="true"></td><td contenteditable="true"></td>
      <td contenteditable="true"></td><td contenteditable="true"></td>
      ${e(u.OTDays||"")}${e(u.ITs||"")}
      ${e(notW ? notW/ATTENDANCE_DAY_HOURS : "")}${e(notW||"")}
      <td contenteditable="true"></td><td contenteditable="true"></td>
      ${e(u.O ? u.O/ATTENDANCE_DAY_HOURS : "")}${e(u.O||"")}
      ${e(u.Ch ? u.Ch/ATTENDANCE_DAY_HOURS : "")}${e(u.Ch||"")}
      ${e(u.E ? u.E/ATTENDANCE_DAY_HOURS : "")}${e(u.E||"")}
      ${e(u.T ? u.T/ATTENDANCE_DAY_HOURS : "")}${e(u.T||"")}
      <td contenteditable="true"></td>
    </tr>`;
  });

  const n      = Object.values(byU).length;
  const totNotW = tot.T + tot.Ch + tot.O + tot.E;
  const et = v => `<td contenteditable="true">${v || ""}</td>`;
  const totalTr = `<tr style="font-weight:700;background:#f0f0f0">
    <td contenteditable="true" colspan="2" style="text-align:left">Дүн</td>
    ${et(daysInMonth*n)}${et(weekendDays*n)}<td contenteditable="true"></td>
    ${et(workingDaysReq*n)}${et(workingDaysReq*n*8)}
    ${et(tot.A ? tot.A/ATTENDANCE_DAY_HOURS : "")}${et(tot.A||"")}
    <td contenteditable="true"></td><td contenteditable="true"></td>
    <td contenteditable="true"></td><td contenteditable="true"></td>
    ${et(tot.OTDays||"")}${et(tot.ITs||"")}
    ${et(totNotW ? totNotW/ATTENDANCE_DAY_HOURS : "")}${et(totNotW||"")}
    <td contenteditable="true"></td><td contenteditable="true"></td>
    ${et(tot.O ? tot.O/ATTENDANCE_DAY_HOURS : "")}${et(tot.O||"")}
    ${et(tot.Ch ? tot.Ch/ATTENDANCE_DAY_HOURS : "")}${et(tot.Ch||"")}
    ${et(tot.E ? tot.E/ATTENDANCE_DAY_HOURS : "")}${et(tot.E||"")}
    ${et(tot.T ? tot.T/ATTENDANCE_DAY_HOURS : "")}${et(tot.T||"")}
    <td contenteditable="true"></td>
  </tr>`;

  const printDate = `${yr}.${String(mo).padStart(2,"0")}.${String(new Date().getDate()).padStart(2,"0")}`;

  const html = `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<title>Ажлын цагийн тооцоо – ${yr} оны ${mo}-р сар</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Arial Unicode MS",Arial,sans-serif;font-size:11px;color:#000}
#toolbar{position:sticky;top:0;z-index:200;background:#1e293b;color:#fff;
  display:flex;align-items:center;gap:10px;padding:8px 14px;font-size:13px;
  font-family:Arial,sans-serif}
#toolbar .tl{font-weight:700;font-size:13px;margin-right:6px}
.tb{padding:6px 14px;border:none;border-radius:6px;cursor:pointer;
    font-size:13px;font-weight:600;background:#334155;color:#fff}
.tb:hover{background:#475569}
.tb-pr{background:#2563eb;margin-left:auto}
.tb-pr:hover{background:#1d4ed8}
#zl{min-width:48px;text-align:center;font-weight:700;font-size:14px;color:#93c5fd}
.hint{font-size:11px;color:#94a3b8;margin-left:4px}
#content{padding:14px;transform-origin:top left}
.dh{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:5px}
.fn{font-size:11px;font-weight:700}
.dc{font-size:9px;text-align:right;line-height:1.6}
.ttl{text-align:center;font-size:16px;font-weight:700;letter-spacing:4px;margin:7px 0}
.ol{display:flex;justify-content:space-between;margin-bottom:8px;font-size:10.5px}
table{border-collapse:collapse;width:100%}
th{border:1px solid #000;padding:4px 3px;text-align:center;vertical-align:middle;
   font-size:9.5px;font-weight:700;background:#f2f2f2;white-space:normal;line-height:1.4}
td{border:1px solid #000;padding:4px 5px;text-align:center;vertical-align:middle;font-size:11px}
th.vt{writing-mode:vertical-rl;transform:rotate(180deg);white-space:nowrap;padding:8px 3px;font-size:8.5px}
td[contenteditable]:hover{background:#f0f9ff;cursor:text}
td[contenteditable]:focus{outline:2px solid #2563eb;background:#eff6ff;z-index:1;position:relative}
.nc{text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sg{display:flex;justify-content:space-between;margin-top:20px;font-size:10.5px}
.si{text-align:center}
.sl{border-bottom:1px solid #000;width:160px;margin:14px auto 4px}
@media print{
  #toolbar{display:none!important}
  #content{padding:2px!important;zoom:1!important}
  @page{size:A3 landscape;margin:9mm}
  td[contenteditable]:focus,td[contenteditable]:hover{outline:none;background:inherit}
}
</style>
</head><body>
<div id="toolbar">
  <span class="tl">🖨️ Урьдчилан харах</span>
  <button class="tb" onclick="chgZoom(-10)">− Жижигрүүлэх</button>
  <span id="zl">100%</span>
  <button class="tb" onclick="chgZoom(10)">+ Томруулах</button>
  <button class="tb" onclick="chgZoom(0)">↺ Анхны хэмжээ</button>
  <span class="hint">✏️ Нүдэн дээр дарж утгыг засах боломжтой</span>
  <button class="tb tb-pr" onclick="doPrint()">🖨️ Хэвлэх</button>
</div>
<div id="content">
<div class="dh">
  <div class="fn">НХ Маягт ЦХ-2</div>
  <div class="dc">Сангийн сайдын 2017 оны 12<br>дугаар сарын 5 өдрийн 347<br>тоот тушаалын хавсралт</div>
</div>
<div class="ttl">АЖЛЫН ЦАГИЙН ТООЦОО</div>
<div class="ol">
  <div>"Чойбалсан хөгжил" ОНӨҮГ &nbsp;&nbsp; Захиргаа, аж ахуй</div>
  <div contenteditable="true">${printDate}</div>
</div>
<table>
  <thead>
    <tr>
      <th rowspan="3" style="width:24px">№</th>
      <th rowspan="3" style="min-width:110px">Овог нэр</th>
      <th rowspan="3" class="vt">Хуанлийн хүн өдөр</th>
      <th rowspan="3" class="vt">Амралт баяр ёслолын хүн өдөр</th>
      <th rowspan="3" class="vt">Зэлмийн амралтын хүн өдөр</th>
      <th colspan="2">Ажилласан зохих</th>
      <th colspan="6">Ажилласан</th>
      <th colspan="2">Илүү цаг</th>
      <th colspan="12">Ажиллаагүй цаг</th>
      <th rowspan="3" class="vt">Хэнгэлэгтэй цаг 10</th>
    </tr>
    <tr>
      <th rowspan="2" class="vt">Өдөр</th>
      <th rowspan="2" class="vt">Цаг</th>
      <th colspan="2">Бүгд</th>
      <th colspan="4">Үүнээс</th>
      <th rowspan="2" class="vt">Өдөр</th>
      <th rowspan="2" class="vt">Цаг</th>
      <th colspan="2">Бүгд</th>
      <th colspan="2">Жирэмсний</th>
      <th colspan="2">Өвчтэй 08-12</th>
      <th colspan="2">Чөлөөтэй зөвшөөрсөн</th>
      <th colspan="2">Хуулиар зөвшөөрсөн</th>
      <th colspan="2">Тасалсан 14</th>
    </tr>
    <tr>
      <th class="vt">Өдөр</th><th class="vt">Цаг</th>
      <th class="vt">Шинэ ажилласан</th>
      <th class="vt">Амралт баяр ёслолын үед</th>
      <th class="vt">Хийснээр цалинжих</th>
      <th class="vt">Цагаар цалинжих</th>
      <th class="vt">Өдөр</th><th class="vt">Цаг</th>
      <th class="vt">Өдөр</th><th class="vt">Цаг</th>
      <th class="vt">Өдөр</th><th class="vt">Цаг</th>
      <th class="vt">Өдөр</th><th class="vt">Цаг</th>
      <th class="vt">Өдөр</th><th class="vt">Цаг</th>
    </tr>
  </thead>
  <tbody>
    ${dataRows.join("")}
    ${totalTr}
  </tbody>
</table>
<div class="sg">
  <div class="si">
    <div>Хүний нөөцийн ажилтан</div>
    <div class="sl"></div>
    <div contenteditable="true">${hrUser ? shortName(hrUser.full_name) : "___________"}</div>
  </div>
  <div class="si">
    <div>Еренхий нягтлан бодогч</div>
    <div class="sl"></div>
    <div contenteditable="true">${accUser ? shortName(accUser.full_name) : "___________"}</div>
  </div>
</div>
</div>
<script>
var _z=100;
function chgZoom(d){
  if(d===0){_z=100;}else{_z=Math.max(40,Math.min(220,_z+d));}
  document.getElementById('content').style.zoom=_z/100;
  document.getElementById('zl').textContent=_z+'%';
}
function doPrint(){
  var c=document.getElementById('content');
  var z=c.style.zoom;
  c.style.zoom=1;
  window.print();
  c.style.zoom=z;
}
document.addEventListener('keydown',function(e){
  if((e.ctrlKey||e.metaKey)&&e.key==='+'){e.preventDefault();chgZoom(10);}
  if((e.ctrlKey||e.metaKey)&&e.key==='-'){e.preventDefault();chgZoom(-10);}
  if((e.ctrlKey||e.metaKey)&&e.key==='0'){e.preventDefault();chgZoom(0);}
  if((e.ctrlKey||e.metaKey)&&e.key==='p'){e.preventDefault();doPrint();}
});
<\/script>
</body></html>`;

  const w = window.open("", "_blank");
  if (!w) { toast("Попап хаасан байна. Зөвшөөрч дахин дарна уу."); return; }
  w.document.write(html);
  w.document.close();
}

function _attPrintYearSimple(yr) {
  const content = document.getElementById("attTabContent")?.innerHTML || "";
  const title = `Ирцийн жилийн дүн – ${yr} он`;
  const w = window.open("", "_blank");
  if (!w) { toast("Попап хаасан байна. Зөвшөөрч дахин дарна уу."); return; }
  w.document.write(`<!DOCTYPE html>
<html><head>
<meta charset="UTF-8"><title>${title}</title>
<style>
*{box-sizing:border-box}
body{font-family:Arial,sans-serif;font-size:10px;margin:14px;color:#000}
h1{font-size:13px;margin:0 0 3px}
.sub{font-size:9px;color:#555;margin-bottom:8px}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid #aaa;padding:3px 4px;text-align:center;font-size:9px}
.stickyName{text-align:left;white-space:nowrap;position:static}
@media print{@page{size:A3 landscape;margin:8mm}}
</style>
</head><body>
<h1>${title}</h1>
<div class="sub">Чойбалсан хөгжил ОНӨҮГ &nbsp;·&nbsp; Хэвлэсэн: ${new Date().toLocaleDateString("mn-MN")}</div>
${content}
<script>window.onload=function(){setTimeout(function(){window.print();},350);}<\/script>
</body></html>`);
  w.document.close();
}

function renderAttMonth(year, month) {
  const tc = document.getElementById("attTabContent");
  if (!tc) return;
  window.attViewMonth = month;
  const lbl = document.getElementById("attMonthLabel");
  if (lbl) lbl.textContent = month + "-р сар";

  const rows    = window._attRows || [];
  const byUserM = {};
  state.users.forEach(u => {
    byUserM[u.id] = { user:u, days:{}, records:{}, summary:{worked:0,absent:0,leave:0,sick:0,vacation:0,overtime:0} };
  });

  const daysInMonth = new Date(year, month, 0).getDate();
  const latestByDay = {};

  rows.forEach(r => {
    if (!byUserM[r.user_id] || !r.start_date) return;
    const start = attParseYmd(r.start_date);
    const end   = attParseYmd(r.end_date || r.start_date);
    const mS    = new Date(year, month-1, 1, 12);
    const mE    = new Date(year, month-1, daysInMonth, 12);
    const rS    = start > mS ? start : mS;
    const rE    = end   < mE ? end   : mE;
    if (rS > rE) return;
    for (let c = new Date(rS); c <= rE; c.setDate(c.getDate()+1)) {
      const day = c.getDate();
      const key = `${r.user_id}|${day}`;
      if (!latestByDay[key] || r.id > latestByDay[key].id) latestByDay[key] = r;
    }
  });

  Object.entries(latestByDay).forEach(([key, r]) => {
    const [uid, day] = key.split("|");
    if (!byUserM[uid]) return;
    const code = attendanceRecordCode(r);
    const hours = attendanceHours(r);
    const d = Number(day);
    byUserM[uid].days[d] = code;
    byUserM[uid].records[d] = r;
    byUserM[uid].recIds = byUserM[uid].recIds || {};
    byUserM[uid].recIds[d] = r.id;
    byUserM[uid].summary.worked += hours.work;
    addAttendanceOffHours(byUserM[uid].summary, r, hours);
    byUserM[uid].summary.overtime += hours.overtime;
  });

  tc.innerHTML = `<div class="attendanceWrap"><table class="attendanceTable">
    <thead><tr>
      <th class="stickyName">Ажилтан</th>
      ${Array.from({length:daysInMonth},(_,i)=>{
        const dt=new Date(year,month-1,i+1);
        const iW=dt.getDay()===0||dt.getDay()===6;
        const iT=attYmd(dt)===today();
        return `<th style="background:${iT?'#eff6ff':iW?'#fff5f5':''};color:${iT?'#2563eb':iW?'#dc2626':'#667085'};font-weight:${iT||iW?700:400}">${i+1}</th>`;
      }).join("")}
      <th>А цаг</th><th>Т цаг</th><th>Ч цаг</th><th>Ө цаг</th><th>Э цаг</th><th>ИЦ</th>
    </tr></thead>
    <tbody>
      ${Object.values(byUserM).map(x=>`
        <tr>
          <td class="stickyName"><b>${x.user.full_name}</b><div class="small muted">${x.user.position||""}</div></td>
          ${Array.from({length:daysInMonth},(_,i)=>{
            const dt=new Date(year,month-1,i+1);
            const iW=dt.getDay()===0||dt.getDay()===6;
            const code=x.days[i+1]||"";
            const record=x.records[i+1];
            const recId=x.recIds?.[i+1]||0;
            const canE=["director","hr"].includes(state.me.role);
            const style=`background:${!code&&iW?'#fff5f5':'transparent'};${canE?'cursor:pointer;':''}`;
            const click=canE?` onclick="editAttendanceCell(${x.user.id},${i+1},${recId})"` :'';
            const baseCode = attendanceTypeCode(record?.record_type) || code;
            const title = record ? `${record.record_type}: ${attendanceHourText(attendanceHours(record).work)}ц ажилласан, ${attendanceHourText(attendanceHours(record).leave)}ц чөлөө/тасалсан, ${attendanceHourText(attendanceHours(record).overtime)}ц илүү` : "";
            return `<td style="${style}"${click} title="${title}">${code?`<span class="dayCode ${codeClass(baseCode)}" style="white-space:nowrap;font-size:${code.length>3?'9px':'11px'}">${code}</span>`:(iW?'<span style="color:#fca5a5;font-size:10px">—</span>':'')}</td>`;
          }).join("")}
          <td><b>${attendanceHourText(x.summary.worked)}</b></td>
          <td style="color:#dc2626">${attendanceHourText(x.summary.absent)}</td>
          <td style="color:#d97706">${attendanceHourText(x.summary.leave)}</td>
          <td style="color:#2563eb">${attendanceHourText(x.summary.sick)}</td>
          <td style="color:#475569">${attendanceHourText(x.summary.vacation)}</td>
          <td style="color:#7c3aed">${attendanceHourText(x.summary.overtime)}</td>
        </tr>`).join("")}
    </tbody>
  </table></div>`;
}

function renderAttYear(year) {
  const tc = document.getElementById("attTabContent");
  if (!tc) return;
  const rows = window._attRows || [];
  const mNames = ["1-р","2-р","3-р","4-р","5-р","6-р","7-р","8-р","9-р","10-р","11-р","12-р"];

  const byUserYear = {};
  state.users.forEach(u => {
    byUserYear[u.id] = { user:u, months: Array.from({length:12},()=>({w:0,a:0,l:0,s:0,v:0,ot:0})), total:{w:0,a:0,l:0,s:0,v:0,ot:0} };
  });

  const latestByDay = {};
  rows.forEach(r => {
    if (!byUserYear[r.user_id] || !r.start_date) return;
    const start = attParseYmd(r.start_date);
    const end   = attParseYmd(r.end_date || r.start_date);
    if (start.getFullYear() !== year && end.getFullYear() !== year) return;
    const yS = new Date(year,0,1,12), yE = new Date(year,11,31,12);
    const rS = start > yS ? start : yS;
    const rE = end   < yE ? end   : yE;
    if (rS > rE) return;
    for (let c=new Date(rS); c<=rE; c.setDate(c.getDate()+1)) {
      const key = `${r.user_id}|${c.getFullYear()}-${c.getMonth()}-${c.getDate()}`;
      if (!latestByDay[key] || r.id > latestByDay[key].id) latestByDay[key] = { r, m: c.getMonth() };
    }
  });

  Object.entries(latestByDay).forEach(([key,{r,m}]) => {
    const uid = key.split("|")[0];
    if (!byUserYear[uid]) return;
    const u = byUserYear[uid];
    const t = attendanceOffType(r);
    const h = attendanceHours(r);
    const workedDays = h.work / ATTENDANCE_DAY_HOURS;
    const offDays = h.leave / ATTENDANCE_DAY_HOURS;
    u.months[m].w += workedDays; u.total.w += workedDays;
    if (t==="Ажил тасалсан") { u.months[m].a += offDays; u.total.a += offDays; }
    if (t==="Чөлөө")         { u.months[m].l += offDays; u.total.l += offDays; }
    if (t==="Өвчтэй")        { u.months[m].s += offDays; u.total.s += offDays; }
    if (t==="Ээлжийн амралт"){ u.months[m].v += offDays; u.total.v += offDays; }
    u.months[m].ot += h.overtime; u.total.ot += h.overtime;
  });

  tc.innerHTML = `
  <div style="overflow-x:auto">
  <table style="width:100%;border-collapse:collapse;font-size:12px">
    <thead>
      <tr>
        <th class="stickyName" style="background:#f8f9fb;padding:8px 12px;text-align:left;border-bottom:1px solid #e2e6ed">АЖИЛТАН</th>
        ${mNames.map(m=>`<th colspan="2" style="background:#f8f9fb;text-align:center;padding:6px;border-bottom:1px solid #e2e6ed;border-left:1px solid #e2e6ed;font-size:10px;color:#667085">${m} сар</th>`).join("")}
        <th colspan="6" style="background:#eff6ff;text-align:center;padding:6px;border-bottom:1px solid #e2e6ed;border-left:2px solid #2563eb;font-size:10px;color:#2563eb">НИЙТ ДҮН</th>
      </tr>
      <tr>
        <th class="stickyName" style="background:#f8f9fb;border-bottom:2px solid #e2e6ed"></th>
        ${mNames.map(()=>`
          <th style="background:#f8f9fb;text-align:center;padding:4px 3px;border-bottom:2px solid #e2e6ed;border-left:1px solid #e2e6ed;font-size:9px;color:#16a34a">А</th>
          <th style="background:#f8f9fb;text-align:center;padding:4px 3px;border-bottom:2px solid #e2e6ed;font-size:9px;color:#dc2626">Т</th>`).join("")}
        <th style="background:#eff6ff;text-align:center;padding:4px 3px;border-bottom:2px solid #e2e6ed;border-left:2px solid #2563eb;font-size:9px;color:#16a34a">А</th>
        <th style="background:#eff6ff;text-align:center;padding:4px 3px;border-bottom:2px solid #e2e6ed;font-size:9px;color:#dc2626">Т</th>
        <th style="background:#eff6ff;text-align:center;padding:4px 3px;border-bottom:2px solid #e2e6ed;font-size:9px;color:#d97706">Ч</th>
        <th style="background:#eff6ff;text-align:center;padding:4px 3px;border-bottom:2px solid #e2e6ed;font-size:9px;color:#2563eb">Ө</th>
        <th style="background:#eff6ff;text-align:center;padding:4px 3px;border-bottom:2px solid #e2e6ed;font-size:9px;color:#475569">Э</th>
        <th style="background:#eff6ff;text-align:center;padding:4px 3px;border-bottom:2px solid #e2e6ed;font-size:9px;color:#7c3aed">ИЦ</th>
      </tr>
    </thead>
    <tbody>
      ${Object.values(byUserYear).map((u,ri)=>`
        <tr style="background:${ri%2===0?'#fff':'#f8f9fb'}">
          <td class="stickyName" style="background:${ri%2===0?'#fff':'#f8f9fb'};padding:7px 12px;border-bottom:.5px solid #e2e6ed">
            <b style="font-size:12px">${u.user.full_name}</b>
            <div style="font-size:10px;color:#667085">${u.user.position||""}</div>
          </td>
          ${u.months.map(m=>`
            <td style="text-align:center;padding:5px 3px;border-bottom:.5px solid #e2e6ed;border-left:1px solid #f1f5f9">
              <span style="font-size:11px;font-weight:${m.w>0?700:400};color:${m.w>0?'#16a34a':'#cbd5e1'}">${m.w?attendanceHourText(m.w):"·"}</span>
            </td>
            <td style="text-align:center;padding:5px 3px;border-bottom:.5px solid #e2e6ed">
              <span style="font-size:11px;font-weight:${m.a>0?700:400};color:${m.a>0?'#dc2626':'#cbd5e1'}">${m.a?attendanceHourText(m.a):"·"}</span>
            </td>`).join("")}
          <td style="text-align:center;padding:5px 4px;border-bottom:.5px solid #e2e6ed;border-left:2px solid #2563eb;background:${ri%2===0?'#f0f7ff':'#e8f2ff'}">
            <b style="color:#16a34a">${attendanceHourText(u.total.w)}</b>
          </td>
          <td style="text-align:center;padding:5px 4px;border-bottom:.5px solid #e2e6ed;background:${ri%2===0?'#f0f7ff':'#e8f2ff'}">
            <b style="color:${u.total.a>0?'#dc2626':'#cbd5e1'}">${u.total.a?attendanceHourText(u.total.a):"·"}</b>
          </td>
          <td style="text-align:center;padding:5px 4px;border-bottom:.5px solid #e2e6ed;background:${ri%2===0?'#f0f7ff':'#e8f2ff'}">
            <span style="color:${u.total.l>0?'#d97706':'#cbd5e1'}">${u.total.l?attendanceHourText(u.total.l):"·"}</span>
          </td>
          <td style="text-align:center;padding:5px 4px;border-bottom:.5px solid #e2e6ed;background:${ri%2===0?'#f0f7ff':'#e8f2ff'}">
            <span style="color:${u.total.s>0?'#2563eb':'#cbd5e1'}">${u.total.s?attendanceHourText(u.total.s):"·"}</span>
          </td>
          <td style="text-align:center;padding:5px 4px;border-bottom:.5px solid #e2e6ed;background:${ri%2===0?'#f0f7ff':'#e8f2ff'}">
            <span style="color:${u.total.v>0?'#475569':'#cbd5e1'}">${u.total.v?attendanceHourText(u.total.v):"·"}</span>
          </td>
          <td style="text-align:center;padding:5px 4px;border-bottom:.5px solid #e2e6ed;background:${ri%2===0?'#f0f7ff':'#e8f2ff'}">
            <span style="color:${u.total.ot>0?'#7c3aed':'#cbd5e1'}">${u.total.ot?attendanceHourText(u.total.ot):"·"}</span>
          </td>
        </tr>`).join("")}
    </tbody>
  </table>
  </div>`;
}

function renderAttRange(startStr, endStr) {
  const tc = document.getElementById("attTabContent");
  if (!tc) return;
  window._attRangeStart = startStr;
  window._attRangeEnd   = endStr;

  const startD = attParseYmd(startStr);
  const endD   = attParseYmd(endStr);
  if (isNaN(startD) || isNaN(endD) || startD > endD) {
    tc.innerHTML = `<div style="padding:24px;color:#dc2626">Буруу огноо сонгосон байна</div>`;
    return;
  }

  const days = [];
  for (let c = new Date(startD); c <= endD; c.setDate(c.getDate()+1)) {
    days.push(new Date(c));
  }

  const rows  = window._attRows || [];
  const byU   = {};
  state.users.forEach(u => {
    byU[u.id] = { user:u, days:{}, recIds:{}, summary:{worked:0,absent:0,leave:0,sick:0,vacation:0,late:0,overtime:0} };
  });

  const latestByDay = {};
  rows.forEach(r => {
    if (!byU[r.user_id] || !r.start_date) return;
    const rs = attParseYmd(r.start_date);
    const re = attParseYmd(r.end_date || r.start_date);
    const rS = rs > startD ? rs : startD;
    const rE = re < endD   ? re : endD;
    if (rS > rE) return;
    for (let c = new Date(rS); c <= rE; c.setDate(c.getDate()+1)) {
      const key = `${r.user_id}|${attYmd(c)}`;
      if (!latestByDay[key] || r.id > latestByDay[key].id) latestByDay[key] = r;
    }
  });

  Object.entries(latestByDay).forEach(([key, r]) => {
    const [uid, dateStr] = key.split("|");
    if (!byU[uid]) return;
    const code = attendanceRecordCode(r);
    const hours = attendanceHours(r);
    byU[uid].days[dateStr]   = code;
    byU[uid].recIds[dateStr] = r.id;
    byU[uid].summary.worked += hours.work;
    addAttendanceOffHours(byU[uid].summary, r, hours);
    if (r.record_type === "Хоцорсон") byU[uid].summary.late++;
    byU[uid].summary.overtime += hours.overtime;
  });

  const canE = ["director","hr"].includes(state.me.role);
  const todayStr = today();

  tc.innerHTML = `<div class="attendanceWrap"><table class="attendanceTable">
    <thead><tr>
      <th class="stickyName">Ажилтан</th>
      ${days.map(d => {
        const ds  = attYmd(d);
        const dw  = d.getDay();
        const iW  = dw===0||dw===6;
        const iT  = ds===todayStr;
        const lbl = `${d.getMonth()+1}/${d.getDate()}`;
        return `<th style="background:${iT?'#eff6ff':iW?'#fff5f5':''};color:${iT?'#2563eb':iW?'#dc2626':'#667085'};font-weight:${iT||iW?700:400};font-size:10px;padding:4px 2px">${lbl}</th>`;
      }).join("")}
      <th>Ац</th><th>Тц</th><th>Чц</th><th>Өц</th><th>Эц</th><th>Х</th><th>ИЦ</th>
    </tr></thead>
    <tbody>
      ${Object.values(byU).map(x=>`
        <tr>
          <td class="stickyName"><b>${x.user.full_name}</b><div class="small muted">${x.user.position||""}</div></td>
          ${days.map(d => {
            const ds  = attYmd(d);
            const dw  = d.getDay();
            const iW  = dw===0||dw===6;
            const code  = x.days[ds] || "";
            const recId = x.recIds[ds] || 0;
            const style = `background:${!code&&iW?'#fff5f5':'transparent'};${canE?'cursor:pointer;':''}`;
            const click = canE ? ` onclick="editAttendanceCellDate(${x.user.id},'${ds}',${recId})"` : '';
            return `<td style="${style}"${click}>${code?`<span class="dayCode ${codeClass(code)}">${code}</span>`:(iW?'<span style="color:#fca5a5;font-size:10px">—</span>':'')}</td>`;
          }).join("")}
          <td><b>${attendanceHourText(x.summary.worked)}</b></td>
          <td style="color:#dc2626">${attendanceHourText(x.summary.absent)}</td>
          <td style="color:#d97706">${attendanceHourText(x.summary.leave)}</td>
          <td style="color:#2563eb">${attendanceHourText(x.summary.sick)}</td>
          <td style="color:#475569">${attendanceHourText(x.summary.vacation)}</td>
          <td style="color:#92400e">${x.summary.late}</td>
          <td style="color:#7c3aed">${attendanceHourText(x.summary.overtime)}</td>
        </tr>`).join("")}
    </tbody>
  </table></div>`;
}

function editAttendanceCellDate(userId, dateStr, recId) {
  if (!["director","hr"].includes(state.me.role)) {
    toast("Зөвхөн Захирал/ХН эрхтэй хэрэглэгч засварлах боломжтой");
    return;
  }
  document.getElementById("cellEditModal")?.remove();
  const user = state.users.find(u => u.id === userId);
  const record = (window._attRows || []).find(r => Number(r.id) === Number(recId));
  const hours = attendanceHours(record);
  const selectedType = hours.leave > 0 ? attendanceOffType(record) : record?.record_type;
  const div  = document.createElement("div");
  div.id = "cellEditModal";
  div.style = "position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;display:flex;align-items:center;justify-content:center";
  div.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:24px;width:380px;box-shadow:0 20px 60px rgba(0,0,0,.25)">
      <div style="font-size:15px;font-weight:800;margin-bottom:4px">Ирц засварлах</div>
      <div style="font-size:12px;color:#667085;margin-bottom:16px">${user?.full_name||""} · ${dateStr}</div>
      <select id="cellEditType" class="input" onchange="onCellEditTypeChange()" style="width:100%;margin-bottom:10px">
        <option value="">— Бүртгэл устгах (хоосон болгох) —</option>
        ${["Ажилласан","Чөлөө","Ажил тасалсан","Өвчтэй","Ээлжийн амралт","Хоцорсон","Илүү цаг"].map(t =>
          `<option${selectedType===t?" selected":""}>${t}</option>`).join("")}
      </select>
      <div class="row3" style="margin-bottom:16px">
        <div><div class="small muted">Ажилласан</div><input id="cellWorkHours" class="input" type="number" min="0" max="8" step=".5" value="${hours.work}"></div>
        <div><div class="small muted">Ажиллаагүй</div><input id="cellLeaveHours" class="input" type="number" min="0" max="8" step=".5" value="${hours.leave}"></div>
        <div><div class="small muted">Илүү</div><input id="cellOvertimeHours" class="input" type="number" min="0" max="24" step=".5" value="${hours.overtime}"></div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn" onclick="confirmCellEditDate(${userId},${recId},'${dateStr}')">Хадгалах</button>
        <button class="btn secondary" onclick="document.getElementById('cellEditModal').remove()">Цуцлах</button>
      </div>
    </div>`;
  document.body.appendChild(div);
}

window.confirmCellEditDate = async (userId, recId, dateStr) => {
  const type = document.getElementById("cellEditType")?.value;
  try {
    if (!type) {
      if (recId) {
        await api(`/api/hr-records/${recId}`, { method:"DELETE" });
        toast("Бүртгэл устгагдлаа");
      } else {
        toast("Устгах бүртгэл байхгүй байна");
        return;
      }
    } else {
      const workHours = attendanceHourValue(document.getElementById("cellWorkHours")?.value);
      const leaveHours = attendanceHourValue(document.getElementById("cellLeaveHours")?.value);
      const overtimeHours = attendanceHourValue(document.getElementById("cellOvertimeHours")?.value);
      await api("/api/hr-records", {
        method:"POST",
        body:JSON.stringify({
          user_id:userId, record_type:type, start_date:dateStr, end_date:dateStr,
          work_hours:workHours, leave_hours:leaveHours, overtime_hours:overtimeHours, note:"Засварласан"
        })
      });
      toast(`"${type}" болгон засварлалаа`);
    }
    document.getElementById("cellEditModal")?.remove();
    const s = window._attRangeStart;
    const e = window._attRangeEnd;
    await attendance();
    if (s && e) {
      window._attRangeStart = s;
      window._attRangeEnd   = e;
      switchAttTab("range");
    }
  } catch(err) { toast(err.message); }
};

function _attPrintRangeForm(startStr, endStr) {
  const startD = attParseYmd(startStr);
  const endD   = attParseYmd(endStr);
  const days   = [];
  for (let c = new Date(startD); c <= endD; c.setDate(c.getDate()+1)) {
    days.push(new Date(c));
  }

  const rows = window._attRows || [];
  const users = (state.users || []).filter(u => u.active !== false);
  const byU = {};
  users.forEach(u => {
    byU[u.id] = { user:u, days:{}, recIds:{}, worked:0, absent:0, leave:0, sick:0, vacation:0, late:0, overtime:0 };
  });

  const codeMap = {
    "Ажилласан":"А","Ажил тасалсан":"Т","Чөлөө":"Ч",
    "Өвчтэй":"Ө","Ээлжийн амралт":"Э","Хоцорсон":"Х","Илүү цаг":"ИЦ"
  };
  const latestByDay = {};
  rows.forEach(r => {
    if (!byU[r.user_id] || !r.start_date) return;
    const rs = attParseYmd(r.start_date);
    const re = attParseYmd(r.end_date || r.start_date);
    const rS = rs > startD ? rs : startD;
    const rE = re < endD   ? re : endD;
    if (rS > rE) return;
    for (let c = new Date(rS); c <= rE; c.setDate(c.getDate()+1)) {
      const key = `${r.user_id}|${attYmd(c)}`;
      if (!latestByDay[key] || r.id > latestByDay[key].id) latestByDay[key] = r;
    }
  });
  Object.entries(latestByDay).forEach(([key, r]) => {
    const [uid, ds] = key.split("|");
    if (!byU[uid]) return;
    const code = codeMap[r.record_type] || "";
    byU[uid].days[ds] = code;
    if (code==="А")  byU[uid].worked++;
    if (code==="Т")  byU[uid].absent++;
    if (code==="Ч")  byU[uid].leave++;
    if (code==="Ө")  byU[uid].sick++;
    if (code==="Э")  byU[uid].vacation++;
    if (code==="Х")  byU[uid].late++;
    if (code==="ИЦ") byU[uid].overtime++;
  });

  const usersArr = Object.values(byU);
  const dayHeaders = days.map(d => {
    const dw = d.getDay();
    const iW = dw===0||dw===6;
    return `<th style="writing-mode:vertical-rl;transform:rotate(180deg);white-space:nowrap;padding:8px 3px;font-size:9px;background:${iW?'#fff0f0':'#f8fafc'};color:${iW?'#dc2626':'#1e293b'}">${d.getMonth()+1}/${d.getDate()}</th>`;
  }).join("");

  const tableRows = usersArr.map((x, ri) => {
    const cells = days.map(d => {
      const ds  = attYmd(d);
      const dw  = d.getDay();
      const iW  = dw===0||dw===6;
      const code = x.days[ds]||"";
      const bg   = iW ? "#fff5f5" : "#fff";
      return `<td contenteditable="true" style="text-align:center;padding:5px 3px;background:${bg};border:0.5px solid #cbd5e1;font-size:11px;font-weight:${code==="А"?700:400};color:${code==="Т"?'#dc2626':code==="А"?'#16a34a':code==="Ч"?'#d97706':code==="Ө"?'#2563eb':code==="Э"?'#475569':code==="Х"?'#92400e':code==="ИЦ"?'#7c3aed':'#94a3b8'}">${code||""}</td>`;
    }).join("");
    return `<tr style="background:${ri%2===0?'#fff':'#f8fafc'}">
      <td contenteditable="true" style="padding:7px 10px;border:0.5px solid #cbd5e1;white-space:nowrap;font-weight:700;font-size:11px">${ri+1}</td>
      <td contenteditable="true" style="padding:7px 10px;border:0.5px solid #cbd5e1;white-space:nowrap;font-size:11px">${x.user.full_name}</td>
      <td contenteditable="true" style="padding:7px 10px;border:0.5px solid #cbd5e1;white-space:nowrap;font-size:11px">${x.user.position||""}</td>
      ${cells}
      <td contenteditable="true" style="text-align:center;padding:5px;border:0.5px solid #cbd5e1;font-weight:800;font-size:11px;color:#16a34a">${x.worked}</td>
      <td contenteditable="true" style="text-align:center;padding:5px;border:0.5px solid #cbd5e1;font-size:11px;color:${x.absent>0?'#dc2626':'#94a3b8'}">${x.absent||""}</td>
      <td contenteditable="true" style="text-align:center;padding:5px;border:0.5px solid #cbd5e1;font-size:11px;color:${x.leave>0?'#d97706':'#94a3b8'}">${x.leave||""}</td>
      <td contenteditable="true" style="text-align:center;padding:5px;border:0.5px solid #cbd5e1;font-size:11px;color:${x.sick>0?'#2563eb':'#94a3b8'}">${x.sick||""}</td>
      <td contenteditable="true" style="text-align:center;padding:5px;border:0.5px solid #cbd5e1;font-size:11px;color:${x.vacation>0?'#475569':'#94a3b8'}">${x.vacation||""}</td>
      <td contenteditable="true" style="text-align:center;padding:5px;border:0.5px solid #cbd5e1;font-size:11px;color:${x.late>0?'#92400e':'#94a3b8'}">${x.late||""}</td>
      <td contenteditable="true" style="text-align:center;padding:5px;border:0.5px solid #cbd5e1;font-size:11px;color:${x.overtime>0?'#7c3aed':'#94a3b8'}">${x.overtime||""}</td>
    </tr>`;
  }).join("");

  const totals = usersArr.reduce((t,x)=>({
    worked:t.worked+x.worked, absent:t.absent+x.absent, leave:t.leave+x.leave,
    sick:t.sick+x.sick, vacation:t.vacation+x.vacation, late:t.late+x.late, overtime:t.overtime+x.overtime
  }), {worked:0,absent:0,leave:0,sick:0,vacation:0,late:0,overtime:0});

  const win = window.open("","_blank","width=1200,height=900");
  win.document.write(`<!DOCTYPE html><html lang="mn"><head><meta charset="UTF-8">
  <title>Ирцийн бүртгэл ${startStr} — ${endStr}</title>
  <style>
    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family:"Arial",sans-serif; background:#f1f5f9; }
    #toolbar { position:sticky;top:0;z-index:100;background:#1e293b;color:#fff;display:flex;align-items:center;gap:8px;padding:8px 14px; }
    #toolbar button { background:#334155;color:#fff;border:none;border-radius:6px;padding:5px 12px;font-size:12px;cursor:pointer; }
    #toolbar button:hover { background:#475569; }
    #content { padding:16px; zoom:0.85; }
    table { border-collapse:collapse; width:100%; }
    th { background:#f1f5f9;border:0.5px solid #cbd5e1;text-align:center;padding:6px 4px;font-size:11px; }
    @media print {
      #toolbar { display:none; }
      body { background:#fff; }
      #content { padding:0; zoom:1; }
      @page { size:A3 landscape; margin:9mm; }
    }
  </style>
  </head><body>
  <div id="toolbar">
    <span style="font-weight:700;font-size:13px">Ирцийн бүртгэл · ${startStr} — ${endStr}</span>
    <span style="flex:1"></span>
    <button onclick="chgZoom(-0.05)">🔍−</button>
    <button id="zoomLbl" style="min-width:44px" onclick="chgZoom(0)">85%</button>
    <button onclick="chgZoom(0.05)">🔍+</button>
    <button onclick="document.getElementById('content').style.zoom=1;document.getElementById('zoomLbl').textContent='100%'">⊡</button>
    <button onclick="window.print()">🖨 Хэвлэх</button>
  </div>
  <div id="content">
    <table>
      <thead>
        <tr>
          <th rowspan="2" style="padding:6px 8px">№</th>
          <th rowspan="2" style="padding:6px 16px;min-width:120px">Ажилтны нэр</th>
          <th rowspan="2" style="padding:6px 10px;min-width:100px">Албан тушаал</th>
          ${dayHeaders}
          <th style="writing-mode:vertical-rl;transform:rotate(180deg);padding:8px 3px;font-size:9px;color:#16a34a">А</th>
          <th style="writing-mode:vertical-rl;transform:rotate(180deg);padding:8px 3px;font-size:9px;color:#dc2626">Т</th>
          <th style="writing-mode:vertical-rl;transform:rotate(180deg);padding:8px 3px;font-size:9px;color:#d97706">Ч</th>
          <th style="writing-mode:vertical-rl;transform:rotate(180deg);padding:8px 3px;font-size:9px;color:#2563eb">Ө</th>
          <th style="writing-mode:vertical-rl;transform:rotate(180deg);padding:8px 3px;font-size:9px;color:#475569">Э</th>
          <th style="writing-mode:vertical-rl;transform:rotate(180deg);padding:8px 3px;font-size:9px;color:#92400e">Х</th>
          <th style="writing-mode:vertical-rl;transform:rotate(180deg);padding:8px 3px;font-size:9px;color:#7c3aed">ИЦ</th>
        </tr>
        <tr>
          ${days.map(d => `<th style="font-size:8px;padding:2px;color:#94a3b8">${["Ня","Да","Мя","Лх","Пү","Ба","Бя"][d.getDay()]}</th>`).join("")}
          <th colspan="7"></th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
        <tr style="background:#f0f7ff">
          <td colspan="3" contenteditable="true" style="padding:7px 10px;border:0.5px solid #cbd5e1;font-weight:800;font-size:11px">НИЙТ ДҮН</td>
          ${days.map(()=>`<td style="border:0.5px solid #cbd5e1"></td>`).join("")}
          <td contenteditable="true" style="text-align:center;padding:5px;border:0.5px solid #cbd5e1;font-weight:800;color:#16a34a">${totals.worked}</td>
          <td contenteditable="true" style="text-align:center;padding:5px;border:0.5px solid #cbd5e1;font-weight:800;color:#dc2626">${totals.absent||""}</td>
          <td contenteditable="true" style="text-align:center;padding:5px;border:0.5px solid #cbd5e1;font-weight:800;color:#d97706">${totals.leave||""}</td>
          <td contenteditable="true" style="text-align:center;padding:5px;border:0.5px solid #cbd5e1;font-weight:800;color:#2563eb">${totals.sick||""}</td>
          <td contenteditable="true" style="text-align:center;padding:5px;border:0.5px solid #cbd5e1;font-weight:800;color:#475569">${totals.vacation||""}</td>
          <td contenteditable="true" style="text-align:center;padding:5px;border:0.5px solid #cbd5e1;font-weight:800;color:#92400e">${totals.late||""}</td>
          <td contenteditable="true" style="text-align:center;padding:5px;border:0.5px solid #cbd5e1;font-weight:800;color:#7c3aed">${totals.overtime||""}</td>
        </tr>
      </tbody>
    </table>
    <div style="display:flex;gap:60px;margin-top:28px;font-size:11px;padding:0 8px">
      <div>Хянасан: ______________________________</div>
      <div>Тооцоо хийсэн: ______________________________</div>
      <div>Огноо: ______________________________</div>
    </div>
  </div>
  <script>
    let _z = 0.85;
    function chgZoom(d) {
      if (d === 0) return;
      _z = Math.min(2, Math.max(0.4, _z + d));
      document.getElementById("content").style.zoom = _z;
      document.getElementById("zoomLbl").textContent = Math.round(_z*100)+"%";
    }
    document.addEventListener("keydown", e => {
      if (e.ctrlKey && e.key==="-") { e.preventDefault(); chgZoom(-0.05); }
      if (e.ctrlKey && e.key==="=") { e.preventDefault(); chgZoom(0.05); }
      if (e.ctrlKey && e.key==="0") { e.preventDefault(); document.getElementById("content").style.zoom=1; document.getElementById("zoomLbl").textContent="100%"; }
      if (e.ctrlKey && e.key==="p") { e.preventDefault(); window.print(); }
    });
  </scr`+`ipt>
  </body></html>`);
  win.document.close();
}

function onAttendanceTypeChange() {
  const type = document.getElementById("atype").value;
  const box = document.getElementById("attendanceDynamicFields");
  const isWorked = type === "Ажилласан" || type === "Хоцорсон";
  const defaultOffType = ["Чөлөө", "Ажил тасалсан", "Өвчтэй", "Ээлжийн амралт"].includes(type) ? type : "Чөлөө";
  box.innerHTML = `
    <div class="row3">
      <div>
        <div class="small muted">Ажилласан цаг</div>
        <input class="input" id="aworkHours" type="number" min="0" max="8" step="0.5" value="${isWorked ? 8 : 0}">
      </div>
      <div>
        <div class="small muted">Ажиллаагүй цаг</div>
        <input class="input" id="aleaveHours" type="number" min="0" max="8" step="0.5" value="${isWorked ? 0 : 8}">
      </div>
      <div>
        <div class="small muted">Илүү цаг</div>
        <input class="input" id="aovertime" type="number" min="0" max="24" step="0.5" value="0">
      </div>
    </div>
    <div style="margin-top:8px">
      <div class="small muted">Ажиллаагүй цагийн төрөл</div>
      <select class="input" id="aoffType">
        ${["Чөлөө","Ажил тасалсан","Өвчтэй","Ээлжийн амралт"].map(t =>
          `<option${t===defaultOffType?" selected":""}>${t}</option>`).join("")}
      </select>
    </div>
    <div class="small muted" style="margin-top:6px">
      Үндсэн өдөр 8 цаг. Жишээ: тал өдрийн чөлөө = 4 ажилласан + 4 чөлөө; 2 цаг илүү = 8 ажилласан + 2 илүү.
    </div>
  `;
}

async function saveAttendance() {
  const selectedType = atype.value;
  const noteText = anote.value || "";
  const startDate = adate.value;
  const endDate = adate.value;

  if (!auser.value) { toast("Ажилтан сонгоно уу"); return; }

  const todayStr = today();
  const workHours = attendanceHourValue(document.getElementById("aworkHours")?.value);
  const leaveHours = attendanceHourValue(document.getElementById("aleaveHours")?.value);
  const overtimeHours = attendanceHourValue(document.getElementById("aovertime")?.value);
  const type = leaveHours > 0
    ? (document.getElementById("aoffType")?.value || "Чөлөө")
    : selectedType;
  if (!startDate) { toast("Огноо сонгоно уу"); return; }
  if (startDate > todayStr) { toast("Ирцийн огноо ирээдүйн огноо байж болохгүй"); return; }
  if ([workHours, leaveHours, overtimeHours].some(v => v < 0 || v > 24)) {
    toast("Цагийн утга 0-24 хооронд байна"); return;
  }
  if (workHours + leaveHours > ATTENDANCE_DAY_HOURS) {
    toast("Ажилласан болон чөлөө/тасалсан цагийн нийлбэр 8-аас их байж болохгүй"); return;
  }
  if (workHours + leaveHours + overtimeHours === 0) {
    toast("Дор хаяж нэг цаг оруулна уу"); return;
  }

  try {
    await api("/api/hr-records", {
      method: "POST",
      body: JSON.stringify({
        user_id: auser.value,
        record_type: type,
        start_date: startDate,
        end_date: endDate,
        work_hours: workHours,
        leave_hours: leaveHours,
        overtime_hours: overtimeHours,
        note: noteText
      })
    });
    toast("Ирц хадгаллаа");
    attendance();
  } catch (e) {
    toast("Алдаа: " + e.message);
  }
}

function editAttendanceCell(userId, day, recId) {
  if (!["director","hr"].includes(state.me.role)) {
    toast("Зөвхөн Захирал/ХН эрхтэй хэрэглэгч засварлах боломжтой");
    return;
  }
  document.getElementById("cellEditModal")?.remove();

  const year  = window._attYear;
  const month = window.attViewMonth;
  const date  = `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
  const user  = state.users.find(u => u.id === userId);
  const record = (window._attRows || []).find(r => Number(r.id) === Number(recId));
  const hours = attendanceHours(record);
  const selectedType = hours.leave > 0 ? attendanceOffType(record) : record?.record_type;

  const div = document.createElement("div");
  div.id = "cellEditModal";
  div.style = "position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;display:flex;align-items:center;justify-content:center";
  div.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:24px;width:380px;box-shadow:0 20px 60px rgba(0,0,0,.25)">
      <div style="font-size:15px;font-weight:800;margin-bottom:4px">Ирц засварлах</div>
      <div style="font-size:12px;color:#667085;margin-bottom:16px">${user?.full_name||""} · ${date}</div>
      <select id="cellEditType" class="input" onchange="onCellEditTypeChange()" style="width:100%;margin-bottom:10px">
        <option value="">— Бүртгэл устгах (хоосон болгох) —</option>
        ${["Ажилласан","Чөлөө","Ажил тасалсан","Өвчтэй","Ээлжийн амралт","Хоцорсон","Илүү цаг"].map(t =>
          `<option${selectedType===t?" selected":""}>${t}</option>`).join("")}
      </select>
      <div class="row3" style="margin-bottom:16px">
        <div><div class="small muted">Ажилласан</div><input id="cellWorkHours" class="input" type="number" min="0" max="8" step=".5" value="${hours.work}"></div>
        <div><div class="small muted">Ажиллаагүй</div><input id="cellLeaveHours" class="input" type="number" min="0" max="8" step=".5" value="${hours.leave}"></div>
        <div><div class="small muted">Илүү</div><input id="cellOvertimeHours" class="input" type="number" min="0" max="24" step=".5" value="${hours.overtime}"></div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn" onclick="confirmCellEdit(${userId},${recId},'${date}')">Хадгалах</button>
        <button class="btn secondary" onclick="document.getElementById('cellEditModal').remove()">Цуцлах</button>
      </div>
    </div>`;
  document.body.appendChild(div);
}

window.confirmCellEdit = async (userId, recId, date) => {
  const type = document.getElementById("cellEditType")?.value;
  try {
    if (!type) {
      if (recId) {
        await api(`/api/hr-records/${recId}`, { method: "DELETE" });
        toast("Бүртгэл устгагдлаа");
      } else {
        toast("Устгах бүртгэл байхгүй байна");
        return;
      }
    } else {
      const workHours = attendanceHourValue(document.getElementById("cellWorkHours")?.value);
      const leaveHours = attendanceHourValue(document.getElementById("cellLeaveHours")?.value);
      const overtimeHours = attendanceHourValue(document.getElementById("cellOvertimeHours")?.value);
      await api("/api/hr-records", {
        method: "POST",
        body: JSON.stringify({
          user_id: userId, record_type: type, start_date: date, end_date: date,
          work_hours: workHours, leave_hours: leaveHours, overtime_hours: overtimeHours, note: "Засварласан"
        })
      });
      toast(`"${type}" болгон засварлалаа`);
    }
    document.getElementById("cellEditModal")?.remove();
    attendance();
  } catch(e) { toast(e.message); }
};

async function markAllWorked() {
  if (!confirm("Өнөөдөр бүх ажилтныг ажилласан гэж бүртгэх үү?")) return;
  for (const u of state.users) {
    await api("/api/hr-records", {
      method: "POST",
      body: JSON.stringify({
        user_id: u.id,
        record_type: "Ажилласан",
        start_date: today(),
        end_date: today(),
        work_hours: 8,
        leave_hours: 0,
        overtime_hours: 0,
        note: "Бүгдийг ажилласнаар бүртгэсэн"
      })
    });
  }
  toast("Бүх ажилтан ажилласнаар бүртгэгдлээ");
  attendance();
}

// ════════════════════════════════════════════════════════════
// ХҮНИЙ НӨӨЦИЙН УДИРДЛАГА · HR CENTER
// ════════════════════════════════════════════════════════════

const HR_DEPTS = ["Захиргаа аж ахуй","Цахилгааны тасаг","Теле камерийн тасаг"];
const HR_POSITIONS = ["Захирал","Ерөнхий инженер","Ерөнхий нягтлан бодогч","Хүний нөөцийн ажилтан","Хөдөлмөрийн аюулгүй байдал эрүүл ахуйн ажилтан","Цахилгааны инженер","Сүлжээний инженер","Сүлжээний техникч","Цахилгаанчин","Гагнуурчин","Кранист","Нярав","Туслах ажилчин","Сахиул"];
const HR_CONTRACT_TYPES = ["Байнгын","Гэрээт","Туршилтын","Цагийн"];
const HR_STATUSES = ["Идэвхтэй","Чөлөөлөгдсөн","Амралтанд","Өвчтэй"];
const HR_EDUS = ["Дээд","Бүрэн дунд","Тусгай мэргэжлийн","Докторант","Магистр"];
const HR_HIST_TYPES = ["Томилогдсон","Цалин өссөн","Шагнагдсан","Сануулга","Чөлөөлөгдсөн","Сургалт","Өөр"];
const DEPT_COLORS = {
  "Захиргаа аж ахуй": { bg:"#eff6ff", color:"#1d4ed8", border:"#bfdbfe" },
  "Цахилгааны тасаг": { bg:"#fff7ed", color:"#c2410c", border:"#fed7aa" },
  "Теле камерийн тасаг": { bg:"#fdf4ff", color:"#7e22ce", border:"#e9d5ff" },
  "Бусад":      { bg:"#f8fafc", color:"#475569", border:"#e2e8f0" }
};

function deptBadge(dept) {
  const c = DEPT_COLORS[dept] || DEPT_COLORS["Бусад"];
  return `<span style="display:inline-block;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600;background:${c.bg};color:${c.color};border:1px solid ${c.border}">${dept||"—"}</span>`;
}

function avatarEl(name, size=36) {
  const colors = ["#2563eb","#7c3aed","#db2777","#d97706","#059669","#dc2626"];
  const idx = (name||"U").charCodeAt(0) % colors.length;
  const letter = (name||"U")[0].toUpperCase();
  return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${colors[idx]};color:#fff;display:flex;align-items:center;justify-content:center;font-size:${Math.round(size*0.4)}px;font-weight:700;flex-shrink:0">${letter}</div>`;
}

function hrStatusBadge(s) {
  const map = {
    "Идэвхтэй":    "background:#dcfce7;color:#15803d",
    "Чөлөөлөгдсөн":"background:#fee2e2;color:#b91c1c",
    "Амралтанд":   "background:#fef3c7;color:#b45309",
    "Өвчтэй":      "background:#eff6ff;color:#1d4ed8"
  };
  const st = map[s] || "background:#f1f5f9;color:#475569";
  return `<span style="display:inline-block;padding:2px 9px;border-radius:99px;font-size:11px;font-weight:600;${st}">${s||"—"}</span>`;
}

function hrContractBadge(t) {
  const map = {
    "Байнгын":    "background:#eff6ff;color:#1d4ed8",
    "Гэрээт":     "background:#fdf4ff;color:#7e22ce",
    "Туршилтын":  "background:#fff7ed;color:#c2410c",
    "Цагийн":     "background:#f0fdf4;color:#15803d"
  };
  const st = map[t] || "background:#f1f5f9;color:#475569";
  return `<span style="display:inline-block;padding:2px 8px;border-radius:99px;font-size:11px;${st}">${t||"—"}</span>`;
}

function tenureTxt(hireDate) {
  if (!hireDate) return "—";
  const diff = Date.now() - new Date(hireDate).getTime();
  const years = Math.floor(diff / (365.25 * 24 * 3600 * 1000));
  const months = Math.floor((diff % (365.25 * 24 * 3600 * 1000)) / (30.44 * 24 * 3600 * 1000));
  if (years > 0) return `${years}ж ${months}с`;
  return `${months}с`;
}

function contractWarnDays(endDate) {
  if (!endDate) return null;
  const diff = new Date(endDate).getTime() - Date.now();
  return Math.ceil(diff / (24 * 3600 * 1000));
}

// ── Module state ─────────────────────────────────────────────
let _hrUsers = [];
let _hrTab = "employees";
let _hrSubTab = "list";
let _hrSearch = "";
let _hrDeptFilter = "";
let _hrStatusFilter = "";
let _hrLetterSearch = "";
let _hrLetterStatus = "";
let _hrLetterType = "";

async function hr() {
  _hrUsers = await api("/api/users-full").catch(() => state.users || []);
  _hrTab = "employees";
  _hrSearch = "";
  _hrDeptFilter = "";
  _hrStatusFilter = "";

  const _active   = _hrUsers.filter(u => !u.status_hr || u.status_hr === "Идэвхтэй").length;
  const _onLeave  = _hrUsers.filter(u => u.status_hr === "Амралтанд" || u.status_hr === "Өвчтэй").length;
  const _left     = _hrUsers.filter(u => u.status_hr === "Чөлөөлөгдсөн").length;
  const _expiring = _hrUsers.filter(u => { const d = contractWarnDays(u.contract_end); return d !== null && d >= 0 && d <= 30; }).length;
  const _nowDate  = new Date().toLocaleDateString("mn-MN");

  main.innerHTML = `
  <!-- ── HEADER ────────────────────────────────────── -->
  <div style="background:#fff;border-bottom:1px solid #e2e8f0;padding:24px 28px 0">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:14px;margin-bottom:20px">
      <div>
        <div style="font-size:10px;font-weight:700;letter-spacing:2px;color:#94a3b8;margin-bottom:6px">ХҮНИЙ НӨӨЦИЙН УДИРДЛАГА · HR CENTER</div>
        <div style="font-size:24px;font-weight:800;letter-spacing:-.3px;color:#0f172a;display:flex;align-items:center;gap:10px">
          <span style="background:#eff6ff;border-radius:10px;padding:6px 10px;font-size:20px">👥</span>
          Хүний нөөцийн удирдлага
        </div>
        <div style="font-size:12px;color:#64748b;margin-top:6px">Чойбалсан хөгжил ОНӨҮГ &nbsp;·&nbsp; ${_nowDate}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button onclick="hrOpenForm(null)"
          style="background:#2563eb;color:#fff;border:none;font-weight:700;padding:10px 18px;border-radius:10px;font-size:13px;cursor:pointer;box-shadow:0 2px 10px rgba(37,99,235,.25);display:flex;align-items:center;gap:6px">
          ＋ Ажилтан нэмэх
        </button>
      </div>
    </div>

    <!-- Stats cards -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding-bottom:0">
      ${[
        ["👥","Нийт ажилтан",   _hrUsers.length, "#eff6ff","#1d4ed8"],
        ["✅","Идэвхтэй",        _active,          "#f0fdf4","#15803d"],
        ["🏖","Амралт / Өвчтэй", _onLeave,         "#fefce8","#a16207"],
        ["⚠️","Гэрээ дуусах",    _expiring,        "#fef2f2","#dc2626"],
      ].map(([ic,lb,val,bg,clr])=>`
        <div style="background:${bg};border:1px solid ${clr}22;border-radius:14px;padding:14px 16px 12px;cursor:default">
          <div style="font-size:20px;margin-bottom:6px">${ic}</div>
          <div style="font-size:26px;font-weight:800;line-height:1;letter-spacing:-.5px;color:${clr}">${val}</div>
          <div style="font-size:11px;color:#475569;margin-top:5px;font-weight:500">${lb}</div>
        </div>`).join("")}
    </div>

    <!-- Tab strip inside header -->
    <div style="display:flex;gap:0;margin-top:18px;overflow-x:auto">
      ${[
        ["employees","👤","Хүний нөөц"],
        ["docs","📋","Гэрээ / Баримт"],
        ["letters","📨","Албан бичиг"],
        ["orders","📜","Бодлогын бичиг баримт"],
        ["legal","⚖️","Хуулийн шүүлтүүр"],
        ["nd","🏦","Цалингийн тооцоо"],
        ["reports","📊","Тайлан"],
      ].map(([k,ic,l])=>`
        <button onclick="hrSwTab('${k}')" id="hrtab_${k}"
          style="padding:12px 20px;font-size:13px;font-weight:600;border:none;
                 background:transparent;
                 color:${_hrTab===k?'#2563eb':'#64748b'};
                 cursor:pointer;white-space:nowrap;display:flex;align-items:center;gap:6px;
                 border-bottom:${_hrTab===k?'3px solid #2563eb':'3px solid transparent'};
                 border-radius:8px 8px 0 0;transition:all .15s"
          onmouseover="if('${k}'!==_hrTab)this.style.color='#0f172a'"
          onmouseout="if('${k}'!==_hrTab)this.style.color='#64748b'"
        >${ic} ${l}</button>`).join("")}
    </div>
  </div>

  <!-- Tab content -->
  <div id="hrTabContent" style="background:#f8fafc;min-height:400px"></div>
  <div id="hrFormOverlay" style="display:none;position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:1000;overflow-y:auto"></div>
  <div id="hrProfilePanel" style="display:none;position:fixed;top:0;right:0;width:440px;height:100vh;background:#fff;box-shadow:-4px 0 40px rgba(0,0,0,.15);z-index:999;overflow-y:auto"></div>`;

  hrRenderTab();
}

async function letters() {
  _hrUsers = state.users || [];
  _hrLetterStatus = _hrLetterStatus || "";
  const main = document.getElementById("main");
  if (!main) return;
  main.innerHTML = `
    <div id="hrTabContent" style="background:#f8fafc;min-height:calc(100vh - 74px)"></div>`;
  await hrRenderLetters();
}

function hrSwTab(tab) {
  _hrTab = tab;
  document.querySelectorAll("[id^='hrtab_']").forEach(b => {
    const k = b.id.replace("hrtab_","");
    const active = k === tab;
    b.style.borderBottom = active ? "3px solid #2563eb" : "3px solid transparent";
    b.style.color        = active ? "#2563eb" : "#64748b";
    b.style.background   = "transparent";
  });
  hrRenderTab();
}

function hrRenderTab() {
  const tc = document.getElementById("hrTabContent");
  if (!tc) return;
  if (_hrTab === "employees") hrRenderEmployees(tc);
  else if (_hrTab === "docs")    hrRenderDocs(tc);
  else if (_hrTab === "letters") hrRenderLetters(tc);
  else if (_hrTab === "orders")  hrRenderOrders(tc);
  else if (_hrTab === "legal")   hrRenderLegalFilter(tc);
  else if (_hrTab === "nd")      hrRenderND(tc);
  else if (_hrTab === "reports") hrRenderReports(tc);
}

// ── Tab 1: Ажилтнуудын жагсаалт ─────────────────────────────

function hrFiltered() {
  return _hrUsers.filter(u => {
    const q = _hrSearch.toLowerCase();
    const matchQ = !q || (u.full_name||"").toLowerCase().includes(q) || (u.email||"").toLowerCase().includes(q) || (u.position||"").toLowerCase().includes(q);
    const matchD = !_hrDeptFilter || (u.department||"") === _hrDeptFilter;
    const matchS = !_hrStatusFilter || (u.status_hr||"Идэвхтэй") === _hrStatusFilter;
    return matchQ && matchD && matchS;
  });
}

function hrSwSubTab(tab) {
  _hrSubTab = tab;
  hrRenderEmployees();
}

function hrRenderEmployeeList(tc) {
  const filtered = hrFiltered();
  const canEdit = ["director","hr"].includes(state.me.role);
  tc.innerHTML = `
  <div style="padding:16px 24px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;border-bottom:1px solid #e2e8f0;background:#fff">
    <div style="position:relative;flex:1;min-width:200px">
      <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:#94a3b8;font-size:14px">🔍</span>
      <input class="input" id="hrSearchInp" placeholder="Нэр, и-мэйл, албан тушаал хайх..." value="${escapeHtml(_hrSearch)}"
        oninput="_hrSearch=this.value;hrRenderEmployeeList(document.getElementById('hrSubContent'))"
        style="padding-left:32px;margin:0">
    </div>
    <select class="input" style="width:140px;margin:0" onchange="_hrDeptFilter=this.value;hrRenderEmployeeList(document.getElementById('hrSubContent'))">
      <option value="">Бүх хэлтэс</option>
      ${HR_DEPTS.map(d=>`<option value="${d}" ${_hrDeptFilter===d?'selected':''}>${d}</option>`).join("")}
    </select>
    <select class="input" style="width:130px;margin:0" onchange="_hrStatusFilter=this.value;hrRenderEmployeeList(document.getElementById('hrSubContent'))">
      <option value="">Бүх статус</option>
      ${HR_STATUSES.map(s=>`<option value="${s}" ${_hrStatusFilter===s?'selected':''}>${s}</option>`).join("")}
    </select>
    <div style="font-size:12px;color:#94a3b8;white-space:nowrap">${filtered.length} / ${_hrUsers.length}</div>
  </div>

  <div style="overflow-x:auto">
  <table style="width:100%;border-collapse:collapse;font-size:13px">
    <thead>
      <tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0">
        <th style="padding:10px 16px;text-align:left;font-weight:600;color:#475569;font-size:11px">АЖИЛТАН</th>
        <th style="padding:10px 12px;text-align:left;font-weight:600;color:#475569;font-size:11px">ХЭЛТЭС</th>
        <th style="padding:10px 12px;text-align:left;font-weight:600;color:#475569;font-size:11px">ХҮЙС</th>
        <th style="padding:10px 12px;text-align:left;font-weight:600;color:#475569;font-size:11px">АЖЛЫН НӨХЦӨЛ</th>
        <th style="padding:10px 12px;text-align:left;font-weight:600;color:#475569;font-size:11px">БОЛОВСРОЛ</th>
        <th style="padding:10px 12px;text-align:left;font-weight:600;color:#475569;font-size:11px">ГЭРЭЭ</th>
        <th style="padding:10px 12px;text-align:left;font-weight:600;color:#475569;font-size:11px">АЖИЛСАН</th>
        <th style="padding:10px 12px;text-align:left;font-weight:600;color:#475569;font-size:11px">ЦАЛИН</th>
        <th style="padding:10px 12px;text-align:left;font-weight:600;color:#475569;font-size:11px">СТАТУС</th>
        <th style="padding:10px 12px;text-align:center;font-weight:600;color:#475569;font-size:11px">ҮЙЛДЭЛ</th>
      </tr>
    </thead>
    <tbody>
      ${filtered.length === 0 ? `<tr><td colspan="10" style="text-align:center;padding:40px;color:#94a3b8">Ажилтан олдсонгүй</td></tr>` :
        filtered.map((u,i) => {
          const warn = contractWarnDays(u.contract_end);
          const warnHtml = (warn !== null && warn <= 30 && warn >= 0)
            ? `<div style="font-size:10px;color:#dc2626;margin-top:2px">⚠ ${warn}х хоногт дуусна</div>` : "";
          return `
          <tr style="border-bottom:1px solid #f1f5f9;background:${i%2===0?'#fff':'#fafbfc'};cursor:pointer" onclick="hrOpenProfile(${u.id})">
            <td style="padding:12px 16px">
              <div style="display:flex;align-items:center;gap:10px">
                ${avatarEl(u.full_name,38)}
                <div>
                  <div style="font-weight:600;color:#0f172a">${escapeHtml(u.full_name)}</div>
                  <div style="font-size:11px;color:#64748b">${escapeHtml(u.position||"")} · ${escapeHtml(u.email||"")}</div>
                  ${warnHtml}
                </div>
              </div>
            </td>
            <td style="padding:12px">${deptBadge(u.department)}</td>
            <td style="padding:12px;color:#475569;font-size:12px">${escapeHtml(u.gender||"—")}</td>
            <td style="padding:12px;color:#475569;font-size:12px">${escapeHtml(u.work_condition||"—")}</td>
            <td style="padding:12px;color:#475569;font-size:12px;max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(u.education||"")}">${escapeHtml(u.education||"—")}</td>
            <td style="padding:12px">${hrContractBadge(u.contract_type||"Байнгын")}</td>
            <td style="padding:12px;color:#475569;font-size:12px">${tenureTxt(u.hire_date)}</td>
            <td style="padding:12px;font-weight:600;color:#0f172a">
              ${u.salary ? Number(u.salary).toLocaleString()+"₮" : "<span style='color:#cbd5e1'>—</span>"}
            </td>
            <td style="padding:12px">${hrStatusBadge(u.status_hr||"Идэвхтэй")}</td>
            <td style="padding:12px;text-align:center" onclick="event.stopPropagation()">
              <div style="display:flex;gap:6px;justify-content:center">
                ${canEdit ? `<button class="btn secondary sm" onclick="hrOpenForm(${u.id})">Засах</button>` : ""}
              </div>
            </td>
          </tr>`;
        }).join("")}
    </tbody>
  </table>
  </div>`;
}

function hrRenderEmployees(tc) {
  if (!tc) tc = document.getElementById("hrTabContent");
  if (!tc) return;

  const subTabs = [
    { key: "list",       icon: "👥", label: "Ажилтнууд" },
    { key: "recruit",    icon: "🔍", label: "Бүрдүүлэлт" },
    { key: "training",   icon: "📚", label: "Сургалт" },
    { key: "evaluation", icon: "⭐", label: "Үнэлгээ" },
    { key: "survey",     icon: "📝", label: "Судалгаа" },
  ];

  tc.innerHTML = `
  <div style="display:flex;gap:0;border-bottom:2px solid #e2e8f0;background:#fff;padding:0 20px">
    ${subTabs.map(t => `
      <button onclick="hrSwSubTab('${t.key}')"
        style="padding:12px 18px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:600;
          color:${_hrSubTab===t.key?'#2563eb':'#64748b'};
          border-bottom:${_hrSubTab===t.key?'2px solid #2563eb':'2px solid transparent'};
          margin-bottom:-2px;white-space:nowrap;transition:color .15s">
        ${t.icon} ${t.label}
      </button>`).join("")}
  </div>
  <div id="hrSubContent" style="flex:1;overflow:auto"></div>`;

  const sub = document.getElementById("hrSubContent");
  if (_hrSubTab === "list")       hrRenderEmployeeList(sub);
  else if (_hrSubTab === "recruit")    hrRenderRecruit(sub);
  else if (_hrSubTab === "training")   hrRenderTraining(sub);
  else if (_hrSubTab === "evaluation") hrRenderEvaluation(sub);
  else if (_hrSubTab === "survey")     hrRenderSurvey(sub);
}

async function hrDeleteEmployee(id, name) {
  if (!confirm(`"${name}"-г бүртгэлээс устгах уу?\nЭнэ үйлдлийг буцаах боломжгүй.`)) return;
  try {
    await api(`/api/users/${id}`, { method: "DELETE" });
    toast(`${name} устгагдлаа`);
    _hrUsers = await api("/api/users-full").catch(() => _hrUsers);
    const cont = document.getElementById("hdTabContent");
    if (cont) hdRenderEmployment(cont);
  } catch(e) { toast("Алдаа: " + e.message); }
}

// ── Add / Edit modal ─────────────────────────────────────────

function hrOpenForm(userId) {
  editingEmployeeId = userId;
  const u = userId ? (_hrUsers.find(x => x.id === userId) || {}) : {};
  const isNew = !userId;
  const overlay = document.getElementById("hrFormOverlay");
  if (!overlay) return;

  overlay.style.display = "flex";
  overlay.style.alignItems = "flex-start";
  overlay.style.justifyContent = "center";
  overlay.style.padding = "40px 16px";
  overlay.innerHTML = `
  <div style="background:#fff;border-radius:16px;width:100%;max-width:640px;box-shadow:0 20px 60px rgba(0,0,0,.2);overflow:hidden">
    <div style="padding:20px 24px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;justify-content:space-between">
      <div>
        <div style="font-weight:800;font-size:17px;color:#0f172a">${isNew ? "Шинэ ажилтан нэмэх" : "Ажилтны мэдээлэл засах"}</div>
        ${!isNew ? `<div style="font-size:12px;color:#94a3b8;margin-top:2px">${escapeHtml(u.full_name||"")}</div>` : ""}
      </div>
      <button onclick="hrCloseForm()" style="background:none;border:none;font-size:20px;color:#94a3b8;cursor:pointer;padding:4px">✕</button>
    </div>

    <div style="padding:24px;display:flex;flex-direction:column;gap:20px">

      <!-- Хувийн мэдээлэл -->
      <div>
        <div style="font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:.08em;margin-bottom:12px">ХУВИЙН МЭДЭЭЛЭЛ</div>
        <div class="row">
          <div><div class="small muted">Бүтэн нэр *</div>
            <input class="input" id="hf_name" value="${escapeHtml(u.full_name||"")}" placeholder="Овог Нэр"></div>
          <div><div class="small muted">И-мэйл *</div>
            <input class="input" id="hf_email" type="email" value="${escapeHtml(u.email||"")}" placeholder="email@example.com"></div>
        </div>
        <div class="row">
          <div><div class="small muted">Хүйс</div>
            <input class="input" id="hf_gender" value="${escapeHtml(u.gender||"")}" list="hrGenderList" placeholder="Жишээ: Эрэгтэй">
            <datalist id="hrGenderList"><option value="Эрэгтэй"><option value="Эмэгтэй"></datalist></div>
          <div><div class="small muted">Төрсөн өдөр</div>
            <input class="input" id="hf_birth" type="date" value="${u.birthdate||""}"></div>
        </div>
        <div class="row">
          <div><div class="small muted">Үндэс</div>
            <input class="input" id="hf_nat" value="${escapeHtml(u.nationality||"Монгол")}"></div>
          <div><div class="small muted">Яаралтай холбоо</div>
            <input class="input" id="hf_emergency" value="${escapeHtml(u.emergency_contact||"")}"></div>
        </div>
        <div><div class="small muted">Боловсролын мэдээлэл</div>
          <textarea class="input" id="hf_edu" rows="2" style="resize:vertical" placeholder="Жишээ: Дээд, цахилгааны инженер, МУИС, 2018">${escapeHtml(u.education||"")}</textarea></div>
      </div>

      <!-- Ажлын мэдээлэл -->
      <div>
        <div style="font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:.08em;margin-bottom:12px">АЖЛЫН МЭДЭЭЛЭЛ</div>
        <div class="row">
          <div><div class="small muted">Албан тушаал</div>
            <select class="input" id="hf_position">
              ${HR_POSITIONS.map(p=>`<option ${u.position===p?"selected":""}>${p}</option>`).join("")}
            </select></div>
          <div><div class="small muted">Хэлтэс</div>
            <select class="input" id="hf_dept">
              ${HR_DEPTS.map(d=>`<option ${u.department===d?"selected":""}>${d}</option>`).join("")}
            </select></div>
        </div>
        <div class="row">
          <div><div class="small muted">Статус</div>
            <select class="input" id="hf_status">
              ${HR_STATUSES.map(s=>`<option ${(u.status_hr||"Идэвхтэй")===s?"selected":""}>${s}</option>`).join("")}
            </select></div>
          <div><div class="small muted" style="color:#94a3b8">Нэвтрэх эрх</div>
            <div style="padding:8px 12px;border:1px solid #e2e6ed;border-radius:8px;background:#f8f9fb;font-size:12px;color:#94a3b8">
              Тохиргоо → Хэрэглэгчийн эрх хэсгээс өөрчлөнө
            </div>
          </div>
        </div>
        <div><div class="small muted">Ажлын нөхцөл</div>
          <input class="input" id="hf_work_condition" value="${escapeHtml(u.work_condition||"")}" list="hrWorkConditionList" placeholder="Жишээ: Хэвийн / Хүнд / Гадаа талбай / Өндөрт ажиллах">
          <datalist id="hrWorkConditionList">
            <option value="Хэвийн">
            <option value="Хүнд">
            <option value="Хортой">
            <option value="Гадаа талбай">
            <option value="Өндөрт ажиллах">
            <option value="Ээлжийн ажил">
          </datalist>
        </div>
        <div class="row">
          <div><div class="small muted">Ажилд орсон огноо</div>
            <input class="input" id="hf_hire" type="date" value="${u.hire_date||""}"></div>
          <div><div class="small muted">Цалин (₮)</div>
            <input class="input" id="hf_salary" type="number" value="${u.salary||""}"></div>
        </div>
        <div class="row">
          <div><div class="small muted">Ур чадварын нэмэгдэл (%)</div>
            <input class="input" id="hf_skill_allowance_rate" type="number" min="0" max="25" step="1" value="${u.skill_allowance_rate ? Math.floor(Number(u.skill_allowance_rate)) : ""}" placeholder="0 - 25"></div>
          <div><div class="small muted">Ажилласан жил</div>
            <input class="input" id="hf_tenure_years" type="number" min="0" step="1" value="${u.tenure_years ? Math.floor(Number(u.tenure_years)) : ""}" placeholder="Жилээр"></div>
        </div>
        <div class="row">
          <div><div class="small muted">Хоолны мөнгө</div>
            <div style="padding:8px 12px;border:1px solid #e2e6ed;border-radius:8px;background:#f8f9fb;font-size:12px;color:#64748b">
              Цалингийн тооцоо хэсэгт ажилласан хоногоор автоматаар бодогдоно
            </div></div>
          <div></div>
        </div>
        <div class="row">
          <div><div class="small muted">Гэрээний төрөл</div>
            <select class="input" id="hf_ctype" onchange="hrContractChg()">
              ${HR_CONTRACT_TYPES.map(t=>`<option ${(u.contract_type||"Байнгын")===t?"selected":""}>${t}</option>`).join("")}
            </select></div>
          <div id="hf_cend_wrap"><div class="small muted">Гэрээний дуусах огноо</div>
            <input class="input" id="hf_cend" type="date" value="${u.contract_end||""}"></div>
        </div>
        ${isNew ? `
        <div style="padding:10px 12px;border:1px solid #dbeafe;border-radius:8px;background:#eff6ff;font-size:12px;color:#1d4ed8">
          Энэ хэсгээс зөвхөн ажилтны бүртгэл үүснэ. Системд нэвтрэх эрхийг Тохиргоо → Хэрэглэгчийн эрх хэсгээс тусад нь олгоно.
        </div>` : ""}
      </div>

    </div>

    <div style="padding:16px 24px;border-top:1px solid #f1f5f9;display:flex;justify-content:flex-end;gap:10px">
      <button class="btn secondary" onclick="hrCloseForm()">Болих</button>
      <button class="btn" onclick="hrSaveEmp()">💾 Хадгалах</button>
    </div>
  </div>`;

  hrContractChg();
}

function hrContractChg() {
  const t = document.getElementById("hf_ctype")?.value;
  const wrap = document.getElementById("hf_cend_wrap");
  if (wrap) wrap.style.display = t === "Байнгын" ? "none" : "block";
}

function hrCloseForm() {
  const ov = document.getElementById("hrFormOverlay");
  if (ov) { ov.style.display = "none"; ov.innerHTML = ""; }
  editingEmployeeId = null;
}

async function hrSaveEmp() {
  const name  = document.getElementById("hf_name")?.value.trim();
  const email = document.getElementById("hf_email")?.value.trim();
  if (!name)  { toast("Нэр шаардлагатай"); return; }
  if (!email) { toast("И-мэйл шаардлагатай"); return; }
  const skillRate = Math.floor(Number(document.getElementById("hf_skill_allowance_rate")?.value || 0));
  if (skillRate < 0 || skillRate > 25) { toast("Ур чадварын нэмэгдлийн хувь 0-25 хооронд байх ёстой"); return; }
  const tenureYears = Math.floor(Number(document.getElementById("hf_tenure_years")?.value || 0));
  if (tenureYears < 0) { toast("Ажилласан жил 0-ээс бага байж болохгүй"); return; }
  const tenureRate = hrTenureAllowanceRate(tenureYears);

  const body = {
    full_name:         name,
    email:             email,
    role:              (_hrUsers?.find(x=>x.id===editingEmployeeId)?.role) || "worker",
    position:          document.getElementById("hf_position")?.value,
    department:        document.getElementById("hf_dept")?.value,
    gender:            document.getElementById("hf_gender")?.value || null,
    birthdate:         document.getElementById("hf_birth")?.value || null,
    nationality:       document.getElementById("hf_nat")?.value || null,
    emergency_contact: document.getElementById("hf_emergency")?.value || null,
    education:         document.getElementById("hf_edu")?.value || null,
    work_condition:    document.getElementById("hf_work_condition")?.value || null,
    hire_date:         document.getElementById("hf_hire")?.value || null,
    salary:            Number(document.getElementById("hf_salary")?.value || 0),
    skill_allowance_rate: skillRate,
    skill_allowance:   Number(document.getElementById("hf_salary")?.value || 0) * skillRate / 100,
    tenure_years:      tenureYears,
    tenure_allowance_rate: tenureRate,
    tenure_allowance:  Number(document.getElementById("hf_salary")?.value || 0) * tenureRate / 100,
    meal_allowance:    Number(_hrUsers?.find(x=>x.id===editingEmployeeId)?.meal_allowance || 0),
    contract_type:     document.getElementById("hf_ctype")?.value,
    contract_end:      document.getElementById("hf_cend")?.value || null,
    status_hr:         document.getElementById("hf_status")?.value
  };

  if (editingEmployeeId) {
    await api(`/api/users/${editingEmployeeId}/hr`, { method: "PUT", body: JSON.stringify(body) });
    toast("Мэдээлэл шинэчлэгдлээ");
  } else {
    body.can_login = false;
    await api("/api/users", { method: "POST", body: JSON.stringify(body) });
    toast("Ажилтан нэмэгдлээ");
  }

  hrCloseForm();
  state.users = await api("/api/users").catch(() => state.users || []);
  _hrUsers = await api("/api/users-full").catch(() => state.users || []);
  hrRenderEmployees();
}

// ── Profile side panel ───────────────────────────────────────

let _hrProfTab = "info";
let _hrProfUser = null;
let _hrProfHistory = [];
let _hrProfDocs = [];

async function hrOpenProfile(userId) {
  currentProfileUserId = userId;
  _hrProfTab = "info";
  _hrProfUser = _hrUsers.find(u => u.id === userId) || null;
  if (!_hrProfUser) return;

  const panel = document.getElementById("hrProfilePanel");
  if (!panel) return;
  panel.style.display = "block";
  panel.innerHTML = `
  <div style="display:flex;flex-direction:column;height:100%">
    <div style="padding:20px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:12px">
      ${avatarEl(_hrProfUser.full_name, 48)}
      <div style="flex:1">
        <div style="font-weight:800;font-size:16px;color:#0f172a">${escapeHtml(_hrProfUser.full_name)}</div>
        <div style="font-size:12px;color:#64748b">${escapeHtml(_hrProfUser.position||"")} · ${deptBadge(_hrProfUser.department)}</div>
      </div>
      <button onclick="hrCloseProfile()" style="background:none;border:none;font-size:20px;color:#94a3b8;cursor:pointer">✕</button>
    </div>

    <div style="display:flex;border-bottom:1px solid #f1f5f9">
      ${[["info","📋 Мэдээлэл"],["docs","📁 Баримт"],["history","📜 Түүх"],["leave","🏖 Чөлөө"]].map(([k,l])=>`
        <button onclick="hrProfTab('${k}')" id="hprof_${k}"
          style="flex:1;padding:10px 6px;font-size:11px;font-weight:600;border:none;background:none;cursor:pointer;border-bottom:${_hrProfTab===k?'2px solid #2563eb':'2px solid transparent'};color:${_hrProfTab===k?'#2563eb':'#64748b'}"
        >${l}</button>`).join("")}
    </div>

    <div id="hrProfContent" style="flex:1;overflow-y:auto;padding:16px"></div>

    <div style="padding:12px 16px;border-top:1px solid #f1f5f9;display:flex;gap:8px;flex-wrap:wrap">
      ${["director","hr"].includes(state.me.role) ? `
        <button class="btn secondary sm" onclick="hrOpenForm(${userId})">✏ Засах</button>
        <button class="btn sm" onclick="hrAddHistory(${userId})" style="background:#7c3aed">+ Түүх</button>` : ""}
    </div>
  </div>`;

  await hrLoadProfTab();
}

function hrCloseProfile() {
  const panel = document.getElementById("hrProfilePanel");
  if (panel) { panel.style.display = "none"; panel.innerHTML = ""; }
  currentProfileUserId = null;
}

function hrProfTab(tab) {
  _hrProfTab = tab;
  document.querySelectorAll("[id^='hprof_']").forEach(b => {
    const k = b.id.replace("hprof_","");
    b.style.borderBottom = k === tab ? "2px solid #2563eb" : "2px solid transparent";
    b.style.color = k === tab ? "#2563eb" : "#64748b";
  });
  hrLoadProfTab();
}

async function hrLoadProfTab() {
  const cont = document.getElementById("hrProfContent");
  if (!cont || !_hrProfUser) return;
  const u = _hrProfUser;

  if (_hrProfTab === "info") {
    const warn = contractWarnDays(u.contract_end);
    cont.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:12px">
      ${(warn !== null && warn <= 30 && warn >= 0) ? `
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 14px;font-size:12px;color:#dc2626">
          ⚠ Гэрээ <b>${warn}</b> хоногт дуусна (${u.contract_end})
        </div>` : ""}

      ${[
        ["Албан тушаал", u.position],
        ["Хэлтэс", u.department],
        ["Ажлын нөхцөл", u.work_condition],
        ["И-мэйл", u.email],
        ["Эрх", u.role],
        ["Ажилд орсон", u.hire_date],
        ["Ажилсан хугацаа", tenureTxt(u.hire_date)],
        ["Цалин", u.salary ? Number(u.salary).toLocaleString()+"₮" : "—"],
        ["Ур чадварын нэмэгдэл", u.skill_allowance ? `${Number(u.skill_allowance).toLocaleString()}₮ (${Number(u.skill_allowance_rate||0)}%)` : "—"],
        ["Ажилласан жилийн нэмэгдэл", u.tenure_allowance ? `${Number(u.tenure_allowance).toLocaleString()}₮ (${Number(u.tenure_allowance_rate||0)}%)` : "—"],
        ["Хоолны нэмэгдэл", u.meal_allowance ? Number(u.meal_allowance).toLocaleString()+"₮" : "—"],
        ["НД тооцох дүн", (Number(u.salary||0)+Number(u.skill_allowance||0)+Number(u.tenure_allowance||0)+Number(u.meal_allowance||0)) ? (Number(u.salary||0)+Number(u.skill_allowance||0)+Number(u.tenure_allowance||0)+Number(u.meal_allowance||0)).toLocaleString()+"₮" : "—"],
        ["Гэрээний төрөл", u.contract_type],
        ["Гэрээ дуусах", u.contract_end || "—"],
        ["Статус", hrStatusBadge(u.status_hr||"Идэвхтэй")],
        ["Хүйс", u.gender],
        ["Төрсөн өдөр", u.birthdate],
        ["Үндэс", u.nationality],
        ["Боловсролын мэдээлэл", u.education],
        ["Яаралтай холбоо", u.emergency_contact]
      ].map(([lbl,val])=>val?`
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f1f5f9">
          <span style="font-size:12px;color:#64748b">${lbl}</span>
          <span style="font-size:13px;font-weight:600;color:#0f172a">${val}</span>
        </div>` : "").join("")}
    </div>`;

  } else if (_hrProfTab === "docs") {
    let docs = [];
    try { docs = await api(`/api/users/${u.id}/files`); } catch(e) { docs = []; }
    _hrProfDocs = docs;
    const canEdit = ["director","hr"].includes(state.me.role);
    cont.innerHTML = `
    ${canEdit ? `
    <div style="margin-bottom:14px;padding:14px;background:#f8fafc;border-radius:10px;border:1px dashed #cbd5e1">
      <div style="font-size:12px;color:#64748b;margin-bottom:8px">Файл оруулах (PDF, Word, зураг)</div>
      <input type="file" id="hrProfFile" accept="image/*,.pdf,.doc,.docx" style="font-size:12px">
      <button class="btn sm" onclick="hrUploadFile(${u.id})" style="margin-top:8px">Оруулах</button>
    </div>` : ""}
    ${docs.length === 0 ? `<div style="text-align:center;color:#94a3b8;padding:30px;font-size:13px">Баримт байхгүй</div>` :
      docs.map(f => `
      <div style="display:flex;align-items:center;gap:10px;padding:10px;border:1px solid #f1f5f9;border-radius:8px;margin-bottom:8px">
        <div style="font-size:22px">${(f.filename||"").match(/\.(pdf)$/i)?'📕':(f.filename||"").match(/\.(docx?)$/i)?'📝':'🖼'}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:600;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(f.original_name||f.filename||"")}</div>
          <div style="font-size:11px;color:#94a3b8">${f.uploaded_at ? new Date(f.uploaded_at).toLocaleDateString("mn-MN") : ""}</div>
        </div>
        <a href="/uploads/${f.filename}" target="_blank" class="btn secondary sm">Нээх</a>
        ${canEdit ? `<button class="btn sm" onclick="hrDelFile(${f.id},${u.id})" style="background:#ef4444">✕</button>` : ""}
      </div>`).join("")}`;

  } else if (_hrProfTab === "history") {
    let hist = [];
    try { hist = await api(`/api/hr-history/${u.id}`); } catch(e) { hist = []; }
    _hrProfHistory = hist;
    cont.innerHTML = `
    ${hist.length === 0 ? `<div style="text-align:center;color:#94a3b8;padding:30px;font-size:13px">Түүх байхгүй</div>` :
      hist.map(h => `
      <div style="display:flex;gap:12px;padding:10px 0;border-bottom:1px solid #f1f5f9">
        <div style="width:8px;height:8px;border-radius:50%;background:#2563eb;margin-top:5px;flex-shrink:0"></div>
        <div>
          <div style="font-size:12px;font-weight:700;color:#0f172a">${escapeHtml(h.event_type||"")}</div>
          <div style="font-size:12px;color:#475569">${escapeHtml(h.note||"")}</div>
          <div style="font-size:11px;color:#94a3b8">${h.event_date||""}</div>
        </div>
      </div>`).join("")}`;

  } else if (_hrProfTab === "leave") {
    const attRows = await api("/api/hr-records").catch(() => []);
    const userAtt = attRows.filter(r => r.user_id === u.id);
    const vacation = userAtt.filter(r => r.record_type === "Ээлжийн амралт").length;
    const sick = userAtt.filter(r => r.record_type === "Өвчтэй").length;
    const leave = userAtt.filter(r => r.record_type === "Чөлөө").length;
    const hireYear = u.hire_date ? new Date(u.hire_date).getFullYear() : new Date().getFullYear();
    const yearsWorked = new Date().getFullYear() - hireYear;
    const entitledDays = Math.min(15 + yearsWorked, 30);
    cont.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
      ${[
        ["Ээлжийн амралт", vacation+"өдөр", "#15803d","#dcfce7"],
        ["Өвчтэй", sick+"өдөр","#1d4ed8","#eff6ff"],
        ["Чөлөө", leave+"өдөр","#b45309","#fef3c7"],
        ["Эрхтэй өдөр", entitledDays+"өдөр","#7e22ce","#fdf4ff"]
      ].map(([l,v,c,bg])=>`
        <div style="background:${bg};border-radius:10px;padding:14px;text-align:center">
          <div style="font-size:10px;color:${c};font-weight:700;margin-bottom:4px">${l.toUpperCase()}</div>
          <div style="font-size:22px;font-weight:800;color:${c}">${v}</div>
        </div>`).join("")}
    </div>
    <div style="font-size:12px;color:#64748b;background:#f8fafc;border-radius:8px;padding:12px">
      Хуримтлагдсан: <b>${entitledDays}өдөр</b> эрхтэй · Авсан: <b>${vacation}өдөр</b> · Үлдсэн: <b>${Math.max(0,entitledDays-vacation)}өдөр</b>
    </div>`;
  }
}

async function hrAddHistory(userId) {
  const type = prompt("Ажиллагааны төрөл:\n" + HR_HIST_TYPES.join(", "));
  if (!type) return;
  const note = prompt("Тайлбар:");
  const date = prompt("Огноо (YYYY-MM-DD):", today());
  await api("/api/hr-history", {
    method: "POST",
    body: JSON.stringify({ user_id: userId, event_type: type, note: note||"", event_date: date||today() })
  });
  toast("Түүх нэмэгдлээ");
  hrProfTab("history");
}

async function hrUploadFile(userId) {
  const inp = document.getElementById("hrProfFile");
  if (!inp?.files?.length) { toast("Файл сонгоно уу"); return; }
  const fd = new FormData();
  fd.append("file", inp.files[0]);
  await fetch(`/api/users/${userId}/files`, {
    method: "POST",
    headers: { Authorization: "Bearer " + state.token },
    body: fd
  });
  toast("Файл оруулагдлаа");
  hrProfTab("docs");
}

async function hrDelFile(fileId, userId) {
  if (!confirm("Файл устгах уу?")) return;
  await api(`/api/users/${userId}/files/${fileId}`, { method: "DELETE" });
  toast("Устгагдлаа");
  hrProfTab("docs");
}

// ── Tab 2: Гэрээ / Баримт ───────────────────────────────────

const ORG_CONTRACT_TYPES = ["Худалдах худалдан авах гэрээ","Ажил гүйцэтгэх гэрээ","Түрээсийн гэрээ","Хамтран ажиллах гэрээ"];
const HR_REPORT_CONTRACT_TYPES = [
  { key:"employment", label:"Хөдөлмөрийн гэрээ", icon:"👤", color:"#2563eb" },
  { key:"Худалдах худалдан авах гэрээ", label:"Худалдах худалдан авах гэрээ", icon:"📦", color:"#7e22ce" },
  { key:"Ажил гүйцэтгэх гэрээ", label:"Ажил гүйцэтгэх гэрээ", icon:"🏗", color:"#c2410c" },
  { key:"Түрээсийн гэрээ", label:"Түрээсийн гэрээ", icon:"🚗", color:"#15803d" },
  { key:"Хамтран ажиллах гэрээ", label:"Хамтран ажиллах гэрээ", icon:"🤝", color:"#0e7490" }
];
const ORG_CONTRACT_STATUSES = ["Хүчинтэй","Дууссан","Цуцлагдсан","Хэлэлцэж байна"];
let _docSubTab = "employment";

function hrRenderDocs(tc) {
  if (!tc) tc = document.getElementById("hrTabContent");
  if (!tc) return;

  const TABS = [
    { key: "employment", label: "👤 Хөдөлмөрийн гэрээ" },
    { key: "Худалдах худалдан авах гэрээ", label: "📦 Худалдах худалдан авах гэрээ" },
    { key: "Ажил гүйцэтгэх гэрээ", label: "🏗 Ажил гүйцэтгэх гэрээ" },
    { key: "Түрээсийн гэрээ", label: "🚗 Түрээсийн гэрээ" },
    { key: "Хамтран ажиллах гэрээ", label: "🤝 Хамтран ажиллах гэрээ" },
  ];

  tc.innerHTML = `
  <div style="padding:0 24px">
    <div style="display:flex;gap:0;border-bottom:2px solid #e2e8f0;margin-bottom:0;overflow-x:auto">
      ${TABS.map(t => `
        <button onclick="hrDocTab('${t.key}')" id="hdtab_${t.key}"
          style="padding:10px 18px;font-size:13px;font-weight:600;border:none;cursor:pointer;white-space:nowrap;
                 border-bottom:3px solid ${_docSubTab===t.key?'#2563eb':'transparent'};
                 color:${_docSubTab===t.key?'#2563eb':'#64748b'};background:transparent;transition:all .15s">
          ${t.label}
        </button>`).join("")}
    </div>
    <div id="hdTabContent" style="padding-top:18px"></div>
  </div>`;

  hdRenderTab(_docSubTab);
}

function hrDocTab(key) {
  _docSubTab = key;
  document.querySelectorAll("[id^='hdtab_']").forEach(b => {
    const active = b.id === `hdtab_${key}`;
    b.style.borderBottomColor = active ? "#2563eb" : "transparent";
    b.style.color = active ? "#2563eb" : "#64748b";
  });
  hdRenderTab(key);
}

function hdRenderTab(key) {
  const cont = document.getElementById("hdTabContent");
  if (!cont) return;
  if (key === "employment") {
    hdRenderEmployment(cont);
  } else {
    hdRenderOrgContracts(cont, key);
  }
}

function hdRenderEmployment(cont) {
  const expiring = _hrUsers.filter(u => {
    const d = contractWarnDays(u.contract_end);
    return d !== null && d <= 30 && d >= 0;
  });
  cont.innerHTML = `
    ${expiring.length > 0 ? `
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px 18px;margin-bottom:20px">
      <div style="font-weight:700;color:#dc2626;margin-bottom:8px">⚠ Дуусч буй ажлын гэрээнүүд (${expiring.length})</div>
      ${expiring.map(u=>`
        <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid #fecaca;font-size:13px">
          <span>${escapeHtml(u.full_name)}</span>
          <span style="color:#dc2626;font-weight:600">${contractWarnDays(u.contract_end)}х хоног · ${u.contract_end}</span>
        </div>`).join("")}
    </div>` : ""}
    <div style="overflow-x:auto">
    <table style="width:100%;min-width:980px;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0">
          <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#475569">АЖИЛТАН</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#475569">ГЭРЭЭНИЙ ТӨРӨЛ</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#475569">ЭХЭЛСЭН</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#475569">ДУУСАХ</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#475569">СТАТУС</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#475569">ҮЙЛДЭЛ</th>
        </tr>
      </thead>
      <tbody>
        ${_hrUsers.map((u,i) => {
          const canEdit = ["director","hr"].includes(state.me.role);
          const warn = contractWarnDays(u.contract_end);
          const rowBg = warn !== null && warn <= 30 && warn >= 0 ? "#fff7f7" : (i%2===0?"#fff":"#fafbfc");
          return `
          <tr style="border-bottom:1px solid #f1f5f9;background:${rowBg}">
            <td style="padding:11px 12px">
              <div style="display:flex;align-items:center;gap:8px">
                ${avatarEl(u.full_name,30)}
                <div>
                  <div style="font-weight:600">${escapeHtml(u.full_name)}</div>
                  <div style="font-size:11px;color:#64748b">${escapeHtml(u.position||"")}</div>
                </div>
              </div>
            </td>
            <td style="padding:11px 12px">${hrContractBadge(u.contract_type||"Байнгын")}</td>
            <td style="padding:11px 12px;font-size:12px;color:#475569">${u.hire_date||"—"}</td>
            <td style="padding:11px 12px;font-size:12px;color:${warn!==null&&warn<=30&&warn>=0?'#dc2626':'#475569'};font-weight:${warn!==null&&warn<=30&&warn>=0?700:400}">
              ${u.contract_end || (u.contract_type==="Байнгын"?"Байнгын":"—")}
            </td>
            <td style="padding:11px 12px">${hrStatusBadge(u.status_hr||"Идэвхтэй")}</td>
            <td style="padding:11px 12px;white-space:nowrap;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
              ${u.contract_scan_url ? `
                <span style="padding:3px 8px;border-radius:999px;background:#dcfce7;color:#15803d;font-size:11px;font-weight:700">Скантай</span>
                <button class="btn secondary sm" title="Оруулсан гэрээний скан харах" onclick="hdViewContractScan('${u.contract_scan_url}','${escapeHtml(u.full_name)}')">📄 Скан харах</button>` : ""}
              ${canEdit ? `
              <button class="btn secondary sm" title="Хөдөлмөрийн гэрээний скан оруулах эсвэл солих" onclick="hdUploadEmploymentScan(${u.id},'${escapeHtml(u.full_name)}','${u.contract_scan_url || ""}')">📎 ${u.contract_scan_url ? "Скан солих" : "Скан оруулах"}</button>
              <button class="btn secondary sm" title="Ажилтны мэдээлэл засах" onclick="hrOpenForm(${u.id})">✏ Засах</button>
              <button class="btn secondary sm" title="Ажилтан устгах" style="color:#dc2626" onclick="hrDeleteEmployee(${u.id},'${escapeHtml(u.full_name)}')">🗑 Устгах</button>` : ""}
            </td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>`;
}

async function hdRenderOrgContracts(cont, type) {
  cont.innerHTML = `<div style="color:#94a3b8;padding:20px">Уншиж байна...</div>`;
  const canEdit = ["director","hr"].includes(state.me.role);
  let rows = [];
  try { rows = await api(`/api/org-contracts?type=${encodeURIComponent(type)}`); } catch(e) {}

  const expiring = rows.filter(r => {
    if (!r.end_date) return false;
    const d = Math.ceil((new Date(r.end_date) - Date.now()) / 86400000);
    return d >= 0 && d <= 30;
  });

  cont.innerHTML = `
    ${expiring.length > 0 ? `
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px 18px;margin-bottom:16px">
      <div style="font-weight:700;color:#dc2626;margin-bottom:8px">⚠ Дуусч буй гэрээнүүд (${expiring.length})</div>
      ${expiring.map(r=>{
        const d=Math.ceil((new Date(r.end_date)-Date.now())/86400000);
        return `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #fecaca;font-size:13px">
          <span>${escapeHtml(r.title)}</span>
          <span style="color:#dc2626;font-weight:600">${d}х хоног · ${r.end_date}</span>
        </div>`;
      }).join("")}
    </div>` : ""}

    <div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:12px">
      <button class="btn secondary" onclick="hdPrintContracts('${escapeHtml(type)}')">🖨 Хэвлэх</button>
      ${canEdit ? `<button class="btn" onclick="hdAddContract('${type}')">+ Гэрээ нэмэх</button>` : ""}
    </div>

    ${rows.length === 0 ? `
    <div style="text-align:center;padding:48px;color:#94a3b8">
      <div style="font-size:32px;margin-bottom:8px">📄</div>
      Гэрээ бүртгэгдээгүй байна
    </div>` : `
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0">
          <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#475569">ДУГ</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#475569">НЭРШИЛ</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#475569">НИЙЛҮҮЛЭГЧ / ГҮЙЦЭТГЭГЧ</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#475569">ДҮН</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#475569">ЭХЭЛСЭН</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#475569">ДУУСАХ</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#475569">СТАТУС</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#475569">ҮЙЛДЭЛ</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r,i) => {
          const days = r.end_date ? Math.ceil((new Date(r.end_date)-Date.now())/86400000) : null;
          const expWarn = days !== null && days >= 0 && days <= 30;
          const statusColor = r.status === "Хүчинтэй" ? "#15803d" : r.status === "Хэлэлцэж байна" ? "#c2410c" : "#64748b";
          return `
          <tr style="border-bottom:1px solid #f1f5f9;background:${expWarn?"#fff7f7":(i%2===0?"#fff":"#fafbfc")}">
            <td style="padding:10px 12px;font-size:12px;color:#64748b;font-weight:600">${escapeHtml(r.contract_no||"—")}</td>
            <td style="padding:10px 12px;font-weight:600">${escapeHtml(r.title)}</td>
            <td style="padding:10px 12px;color:#475569">${escapeHtml(r.counterparty||"—")}</td>
            <td style="padding:10px 12px;font-weight:600;color:#0f172a">${r.amount?Number(r.amount).toLocaleString()+"₮":"—"}</td>
            <td style="padding:10px 12px;font-size:12px;color:#64748b">${r.start_date||"—"}</td>
            <td style="padding:10px 12px;font-size:12px;color:${expWarn?"#dc2626":"#64748b"};font-weight:${expWarn?700:400}">
              ${r.end_date||"—"}${expWarn?` <span style="font-size:10px">(${days}өдөр)</span>`:""}
            </td>
            <td style="padding:10px 12px">
              <span style="padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600;
                           background:${r.status==="Хүчинтэй"?"#dcfce7":r.status==="Хэлэлцэж байна"?"#fff7ed":"#f1f5f9"};
                           color:${statusColor}">${r.status||"Хүчинтэй"}</span>
            </td>
            <td style="padding:10px 12px;white-space:nowrap;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
              <button class="btn secondary sm" onclick="hdViewContract(${r.id})">👁 Харах</button>
              <button class="btn secondary sm" title="Скан файл харах, нэмэх, устгах" onclick="hdUploadContractScan(${r.id},'${escapeHtml(r.title)}')">📎 Скан файлууд</button>
              ${canEdit ? `
              <button class="btn secondary sm" title="Гэрээний мэдээлэл засах" onclick="hdEditContract(${r.id})">✏ Засах</button>
              <button class="btn secondary sm" title="Гэрээ устгах" style="color:#dc2626" onclick="hdDeleteContract(${r.id},'${escapeHtml(r.title)}')">🗑 Устгах</button>` : ""}
            </td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>`}`;
}

async function hdViewContract(id) {
  document.getElementById("hdViewModal")?.remove();
  let rows = [];
  try { rows = await api("/api/org-contracts"); } catch(e) {}
  const r = rows.find(x => x.id === id);
  if (!r) { toast("Гэрээ олдсонгүй"); return; }
  const scans = await api(`/api/org-contracts/${id}/scans`).catch(() => []);
  const canEdit = ["director","hr"].includes(state.me.role);

  const details = (() => {
    try { return typeof r.details === "string" ? JSON.parse(r.details||"{}") : (r.details||{}); } catch(e) { return {}; }
  })();
  const detailRows = Object.entries(details).filter(([,v])=>v).map(([k,v]) => {
    const labels = {
      work_name:"Ажлын нэр", work_scope:"Ажлын хүрээ", duration:"Хугацаа (хоног)", budget:"Төсөвт өртөг",
      progress:"Явц (%)", goods:"Барааны нэр", qty:"Тоо хэмжээ", unit_price:"Нэгжийн үнэ",
      total_price:"Нийт дүн", delivery:"Хүргэлтийн нөхцөл", payment:"Төлбөрийн нөхцөл",
      object:"Түрээсийн объект", location:"Байршил", rent:"Түрээсийн төлбөр",
      payment_terms:"Төлбөрийн нөхцөл", deposit:"Барьцаа мөнгө",
      partner:"Хамтрагч байгууллага", direction:"Хамтын чиглэл",
      duties:"Үүрэг хариуцлага", finance:"Санхүүгийн нөхцөл", project:"Хамтын төсөл"
    };
    return `<div style="display:flex;gap:8px;padding:6px 0;border-bottom:1px solid #f1f5f9">
      <span style="color:#64748b;font-size:12px;min-width:160px">${labels[k]||k}</span>
      <span style="font-weight:600;font-size:13px">${escapeHtml(String(v))}</span>
    </div>`;
  }).join("");

  const statusColor = r.status==="Хүчинтэй"?"#15803d":r.status==="Хэлэлцэж байна"?"#c2410c":"#64748b";
  const statusBg   = r.status==="Хүчинтэй"?"#dcfce7":r.status==="Хэлэлцэж байна"?"#fff7ed":"#f1f5f9";
  const days = r.end_date ? Math.ceil((new Date(r.end_date)-Date.now())/86400000) : null;
  const expWarn = days !== null && days >= 0 && days <= 30;

  const scanGrid = scans.length
    ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px">
        ${scans.map(s => {
          const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(s.url);
          return `<div style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;cursor:pointer"
                       onclick="hdViewContractScan('${s.url}','${escapeHtml(s.filename||r.title)}')">
            ${isImg
              ? `<img src="${s.url}" style="width:100%;height:80px;object-fit:cover;display:block">`
              : `<div style="height:80px;display:flex;align-items:center;justify-content:center;font-size:26px;background:#f8fafc">📄</div>`}
            <div style="padding:3px 6px;font-size:10px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(s.filename||"PDF")}</div>
          </div>`;
        }).join("")}
      </div>`
    : `<div style="color:#94a3b8;font-size:12px">Скан файл оруулаагүй байна</div>`;

  const row = (label, val, style="") =>
    `<div style="display:flex;gap:8px;padding:7px 0;border-bottom:1px solid #f1f5f9;align-items:baseline">
      <span style="color:#64748b;font-size:12px;min-width:160px;flex-shrink:0">${label}</span>
      <span style="font-weight:600;font-size:13px;${style}">${val||"—"}</span>
    </div>`;

  const html = `
  <div id="hdViewModal" style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1001;display:flex;align-items:center;justify-content:center"
       onclick="if(event.target===this)this.remove()">
    <div style="background:#fff;border-radius:18px;width:680px;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 24px 64px rgba(0,0,0,.25)">
      <!-- header -->
      <div style="padding:22px 28px 16px;border-bottom:1px solid #e2e8f0;flex-shrink:0">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
          <div>
            <div style="font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:1px;margin-bottom:4px">${escapeHtml(r.contract_type||"ГЭРЭЭ")}</div>
            <div style="font-size:18px;font-weight:800;color:#0f172a">${escapeHtml(r.title)}</div>
            ${r.contract_no?`<div style="font-size:12px;color:#64748b;margin-top:2px">Дугаар: ${escapeHtml(r.contract_no)}</div>`:""}
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
            <span style="padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700;background:${statusBg};color:${statusColor}">${r.status||"Хүчинтэй"}</span>
            <button onclick="document.getElementById('hdViewModal').remove()" style="background:none;border:none;font-size:22px;cursor:pointer;color:#94a3b8;padding:0 4px;line-height:1">✕</button>
          </div>
        </div>
      </div>
      <!-- body -->
      <div style="padding:20px 28px;overflow-y:auto;flex:1">
        <!-- basic info -->
        ${row("Нийлүүлэгч / Гүйцэтгэгч", escapeHtml(r.counterparty||""))}
        ${r.register_no ? row("Регистрийн дугаар", escapeHtml(r.register_no)) : ""}
        ${r.phone ? row("Утас", escapeHtml(r.phone)) : ""}
        ${r.email ? row("И-мэйл", escapeHtml(r.email)) : ""}
        ${r.responsible_person ? row("Хариуцах ажилтан", escapeHtml(r.responsible_person)) : ""}
        ${row("Дүн", r.amount ? Number(r.amount).toLocaleString()+"₮" : "—", "color:#0f172a")}
        ${row("Эхэлсэн огноо", r.start_date||"—")}
        ${row("Дуусах огноо", `${r.end_date||"—"}${expWarn?` <span style="color:#dc2626;font-size:11px">(${days}өдөр үлдсэн)</span>`:""}`, expWarn?"color:#dc2626":"")}
        ${r.signed_date ? row("Гарын үсэг зурсан", r.signed_date) : ""}
        ${r.description ? `<div style="padding:8px 0;border-bottom:1px solid #f1f5f9">
          <div style="font-size:12px;color:#64748b;margin-bottom:4px">Тайлбар</div>
          <div style="font-size:13px;color:#334155">${escapeHtml(r.description)}</div>
        </div>` : ""}
        ${detailRows ? `<div style="margin-top:8px"><div style="font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Нэмэлт мэдээлэл</div>${detailRows}</div>` : ""}
        <!-- scans -->
        <div style="margin-top:16px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <div style="font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.5px">Скан файлууд (${scans.length})</div>
            <button class="btn secondary sm" onclick="document.getElementById('hdViewModal').remove();hdUploadContractScan(${r.id},'${escapeHtml(r.title)}')">📎 Скан нэмэх</button>
          </div>
          ${scanGrid}
        </div>
      </div>
      <!-- footer -->
      <div style="padding:14px 28px;border-top:1px solid #e2e8f0;display:flex;gap:8px;justify-content:flex-end;flex-shrink:0">
        ${canEdit ? `<button class="btn secondary" onclick="document.getElementById('hdViewModal').remove();hdEditContract(${r.id})">✏ Засах</button>` : ""}
        <button class="btn secondary" onclick="document.getElementById('hdViewModal').remove()">Хаах</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML("beforeend", html);
}

async function hdPrintContracts(type) {
  let rows = [];
  try { rows = await api(`/api/org-contracts?type=${encodeURIComponent(type)}`); } catch(e) {}
  const nowStr = new Date().toLocaleDateString("mn-MN", { year:"numeric", month:"long", day:"numeric" });
  const total = rows.reduce((s,r) => s + (Number(r.amount)||0), 0);

  const tableRows = rows.map((r,i) => {
    const days = r.end_date ? Math.ceil((new Date(r.end_date)-Date.now())/86400000) : null;
    const expWarn = days !== null && days >= 0 && days <= 30;
    return `<tr>
      <td>${i+1}</td>
      <td>${escapeHtml(r.contract_no||"—")}</td>
      <td>${escapeHtml(r.title)}</td>
      <td>${escapeHtml(r.counterparty||"—")}</td>
      <td style="text-align:right">${r.amount ? Number(r.amount).toLocaleString()+"₮" : "—"}</td>
      <td>${r.start_date||"—"}</td>
      <td style="color:${expWarn?"#dc2626":"inherit"};font-weight:${expWarn?700:400}">${r.end_date||"—"}</td>
      <td>${escapeHtml(r.status||"Хүчинтэй")}</td>
    </tr>`;
  }).join("");

  const html = `<!DOCTYPE html><html lang="mn"><head>
  <meta charset="utf-8">
  <title>${escapeHtml(type)} жагсаалт</title>
  <style>
    @page { size: A4 landscape; margin: 18mm 14mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 11px; color: #000; }
    .header { text-align: center; margin-bottom: 16px; }
    .header h2 { font-size: 15px; font-weight: 800; margin-bottom: 4px; }
    .header p { font-size: 10px; color: #555; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #1e3a8a; color: #fff; padding: 7px 8px; text-align: left; font-size: 10px; font-weight: 700; }
    td { padding: 6px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
    tr:nth-child(even) td { background: #f8fafc; }
    .tfoot td { font-weight: 700; border-top: 2px solid #1e3a8a; background: #eff6ff; }
    .footer { margin-top: 20px; display: flex; justify-content: space-between; font-size: 10px; color: #555; }
    .sig { margin-top: 40px; display: flex; justify-content: space-between; }
    .sig-block { text-align: center; min-width: 160px; }
    .sig-line { border-top: 1px solid #000; margin-top: 36px; padding-top: 4px; font-size: 10px; }
    @media print { button { display: none; } }
  </style>
  </head><body>
  <div style="display:flex;justify-content:flex-end;margin-bottom:8px">
    <button onclick="window.print()" style="padding:8px 18px;background:#1e3a8a;color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer">🖨 Хэвлэх</button>
  </div>
  <div class="header">
    <div style="font-size:10px;color:#555;margin-bottom:4px">Чойбалсан хөгжил ОНӨҮГ</div>
    <h2>${escapeHtml(type)} жагсаалт</h2>
    <p>Хэвлэсэн огноо: ${nowStr}</p>
  </div>
  <table>
    <thead>
      <tr>
        <th style="width:32px">№</th>
        <th style="width:56px">Дугаар</th>
        <th>Нэршил</th>
        <th>Нийлүүлэгч / Гүйцэтгэгч</th>
        <th style="width:90px;text-align:right">Дүн</th>
        <th style="width:78px">Эхэлсэн</th>
        <th style="width:78px">Дуусах</th>
        <th style="width:70px">Статус</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
    <tfoot>
      <tr class="tfoot">
        <td colspan="4" style="text-align:right">Нийт дүн:</td>
        <td style="text-align:right">${total.toLocaleString()}₮</td>
        <td colspan="3"></td>
      </tr>
    </tfoot>
  </table>
  <div class="footer">
    <span>Нийт: ${rows.length} гэрээ</span>
    <span>Чойбалсан хөгжил ОНӨҮГ · ${nowStr}</span>
  </div>
  <div class="sig">
    <div class="sig-block"><div class="sig-line">Захирал /____________/</div></div>
    <div class="sig-block"><div class="sig-line">ХН-ийн мэргэжилтэн /____________/</div></div>
  </div>
  </body></html>`;

  const w = window.open("", "_blank", "width=1000,height=700");
  w.document.write(html);
  w.document.close();
}

function hdContractTypeFields(type, data = {}) {
  const d = data.details ? (typeof data.details === "string" ? JSON.parse(data.details||"{}") : data.details) : {};
  const f = (id, label, val="", ph="", tp="text") =>
    `<div><div class="small muted">${label}</div><input class="input" id="${id}" type="${tp}" value="${escapeHtml(String(val||""))}" placeholder="${ph}"></div>`;
  if (type === "Ажил гүйцэтгэх гэрээ") return `
    <div style="background:#f0f9ff;border-radius:8px;padding:12px 14px;margin:10px 0">
      <div style="font-size:11px;font-weight:700;color:#0369a1;margin-bottom:8px">🏗 АЖИЛ ГҮЙЦЭТГЭХ ГЭРЭЭНИЙ МЭДЭЭЛЭЛ</div>
      <div class="row">${f("hdd_work_name","Ажлын нэр",d.work_name||"","Барилга засвар...")}</div>
      <div>${f("hdd_work_scope","Ажлын хүрээ",d.work_scope||"","Ажлын хүрээний тайлбар")}</div>
      <div class="row">
        ${f("hdd_duration","Гүйцэтгэх хугацаа (хоног)",d.duration||"","90",tp="number")}
        ${f("hdd_budget","Төсөвт өртөг (₮)",d.budget||"","10000000","number")}
      </div>
      <div class="row">
        ${f("hdd_progress","Ажлын явц (%)",d.progress||0,"0","number")}
        <div><div class="small muted">Акт хавсаргах</div>
          <div style="font-size:12px;color:#64748b;margin-top:4px">${d.act_url?`<a href="${d.act_url}" target="_blank" style="color:#2563eb">📎 Акт харах</a>`:"Гэрээ хадгалсны дараа хавсаргана"}</div>
        </div>
      </div>
    </div>`;
  if (type === "Худалдах худалдан авах гэрээ") return `
    <div style="background:#f0fdf4;border-radius:8px;padding:12px 14px;margin:10px 0">
      <div style="font-size:11px;font-weight:700;color:#15803d;margin-bottom:8px">📦 ХУДАЛДАХ ХУДАЛДАН АВАХ ГЭРЭЭНИЙ МЭДЭЭЛЭЛ</div>
      <div class="row">
        ${f("hdd_goods","Барааны нэр",d.goods||"","Барааны нэр...")}
        ${f("hdd_qty","Тоо хэмжээ",d.qty||"","100","number")}
      </div>
      <div class="row">
        ${f("hdd_unit_price","Нэгж үнэ (₮)",d.unit_price||"","50000","number")}
        ${f("hdd_total_price","Нийт үнэ (₮)",d.total_price||"","5000000","number")}
      </div>
      <div class="row">
        ${f("hdd_delivery","Нийлүүлэх хугацаа",d.delivery||"","2026-06-01","date")}
        ${f("hdd_payment","Төлбөрийн нөхцөл",d.payment||"","30 хоногт...")}
      </div>
    </div>`;
  if (type === "Түрээсийн гэрээ") return `
    <div style="background:#fefce8;border-radius:8px;padding:12px 14px;margin:10px 0">
      <div style="font-size:11px;font-weight:700;color:#a16207;margin-bottom:8px">🚗 ТҮРЭЭСИЙН ГЭРЭЭНИЙ МЭДЭЭЛЭЛ</div>
      <div class="row">
        ${f("hdd_object","Түрээслэх объект",d.object||"","Машин, байр...")}
        ${f("hdd_location","Байршил",d.location||"","Хот, дүүрэг...")}
      </div>
      <div class="row">
        ${f("hdd_rent","Түрээсийн төлбөр (₮/сар)",d.rent||"","500000","number")}
        ${f("hdd_payment_terms","Төлбөр төлөх нөхцөл",d.payment_terms||"","Сар бүр...")}
      </div>
      <div>${f("hdd_deposit","Барьцааны мэдээлэл",d.deposit||"","Барьцааны хэмжээ, нөхцөл...")}</div>
    </div>`;
  if (type === "Хамтран ажиллах гэрээ") return `
    <div style="background:#fdf4ff;border-radius:8px;padding:12px 14px;margin:10px 0">
      <div style="font-size:11px;font-weight:700;color:#7e22ce;margin-bottom:8px">🤝 ХАМТРАН АЖИЛЛАХ ГЭРЭЭНИЙ МЭДЭЭЛЭЛ</div>
      <div class="row">
        ${f("hdd_partner","Хамтрагч байгууллагын нэр",d.partner||"","Байгууллагын нэр...")}
        ${f("hdd_direction","Хамтын ажиллагааны чиглэл",d.direction||"","Технологи, санхүү...")}
      </div>
      <div>${f("hdd_duties","Гол үүрэг хариуцлага",d.duties||"","Талуудын үүрэг...")}</div>
      <div class="row">
        ${f("hdd_finance","Санхүүгийн нөхцөл",d.finance||"","Санхүүжилтийн нөхцөл...")}
        ${f("hdd_project","Төслийн мэдээлэл",d.project||"","Төслийн нэр, код...")}
      </div>
    </div>`;
  return "";
}

function hdContractModal(type, data = {}) {
  const isEdit = !!data.id;
  const html = `
  <div id="hdContractModal" style="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;display:flex;align-items:center;justify-content:center">
    <div style="background:#fff;border-radius:16px;padding:28px 32px;width:560px;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.25)">
      <div style="font-weight:800;font-size:17px;margin-bottom:20px">${isEdit?"Гэрээ засах":"Гэрээ нэмэх"} · ${type}</div>
      <div class="row">
        <div><div class="small muted">Гэрээний дугаар</div>
          <input class="input" id="hdc_no" value="${escapeHtml(data.contract_no||"")}" placeholder="Г-2024-001"></div>
        <div><div class="small muted">Нэршил *</div>
          <input class="input" id="hdc_title" value="${escapeHtml(data.title||"")}" placeholder="Гэрээний нэр"></div>
      </div>
      <div><div class="small muted">Нийлүүлэгч / гүйцэтгэгч байгууллага</div>
        <input class="input" id="hdc_counter" value="${escapeHtml(data.counterparty||"")}" placeholder="Байгуулллагын нэр"></div>
      <div class="row">
        <div><div class="small muted">Дүн (₮)</div>
          <input class="input" id="hdc_amount" type="number" value="${data.amount||""}" placeholder="0"></div>
        <div><div class="small muted">Статус</div>
          <select class="input" id="hdc_status">
            ${ORG_CONTRACT_STATUSES.map(s=>`<option ${(data.status||"Хүчинтэй")===s?"selected":""}>${s}</option>`).join("")}
          </select></div>
      </div>
      <div class="row">
        <div><div class="small muted">Регистр / байгууллагын код</div>
          <input class="input" id="hdc_regno" value="${escapeHtml(data.register_no||"")}" placeholder="ЖБ123456"></div>
        <div><div class="small muted">Утас</div>
          <input class="input" id="hdc_phone" value="${escapeHtml(data.phone||"")}" placeholder="9900-0000"></div>
      </div>
      <div class="row">
        <div><div class="small muted">Имэйл</div>
          <input class="input" id="hdc_email" value="${escapeHtml(data.email||"")}" placeholder="info@company.mn"></div>
        <div><div class="small muted">Хариуцсан ажилтан</div>
          <input class="input" id="hdc_resp" value="${escapeHtml(data.responsible_person||"")}" placeholder="Нэр"></div>
      </div>
      <div class="row">
        <div><div class="small muted">Гэрээ байгуулсан огноо</div>
          <input class="input" id="hdc_signed" type="date" value="${data.signed_date||""}"></div>
        <div></div>
      </div>
      <div class="row">
        <div><div class="small muted">Эхлэх огноо</div>
          <input class="input" id="hdc_start" type="date" value="${data.start_date||""}"></div>
        <div><div class="small muted">Дуусах огноо</div>
          <input class="input" id="hdc_end" type="date" value="${data.end_date||""}"></div>
      </div>
      ${hdContractTypeFields(type, data)}
      <div><div class="small muted">Тайлбар</div>
        <textarea class="input" id="hdc_desc" rows="2" placeholder="Нэмэлт мэдээлэл">${escapeHtml(data.description||"")}</textarea></div>
      <div style="display:flex;gap:8px;margin-top:18px;justify-content:flex-end">
        <button class="btn secondary" onclick="document.getElementById('hdContractModal').remove()">Болих</button>
        <button class="btn" onclick="hdSaveContract(${isEdit?data.id:"null"},'${type}')">Хадгалах</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML("beforeend", html);
}

function hdAddContract(type) { hdContractModal(type); }

async function hdEditContract(id) {
  try {
    const rows = await api("/api/org-contracts");
    const r = rows.find(x => x.id === id);
    if (r) hdContractModal(r.contract_type, r);
  } catch(e) { toast("Алдаа: " + e.message); }
}

function hdGatherTypeDetails(type) {
  const v = id => document.getElementById(id)?.value || "";
  if (type === "Ажил гүйцэтгэх гэрээ") return {
    work_name: v("hdd_work_name"), work_scope: v("hdd_work_scope"),
    duration: v("hdd_duration"), budget: v("hdd_budget"), progress: v("hdd_progress")
  };
  if (type === "Худалдах худалдан авах гэрээ") return {
    goods: v("hdd_goods"), qty: v("hdd_qty"),
    unit_price: v("hdd_unit_price"), total_price: v("hdd_total_price"),
    delivery: v("hdd_delivery"), payment: v("hdd_payment")
  };
  if (type === "Түрээсийн гэрээ") return {
    object: v("hdd_object"), location: v("hdd_location"),
    rent: v("hdd_rent"), payment_terms: v("hdd_payment_terms"), deposit: v("hdd_deposit")
  };
  if (type === "Хамтран ажиллах гэрээ") return {
    partner: v("hdd_partner"), direction: v("hdd_direction"),
    duties: v("hdd_duties"), finance: v("hdd_finance"), project: v("hdd_project")
  };
  return {};
}

async function hdSaveContract(id, type) {
  const title = document.getElementById("hdc_title")?.value.trim();
  if (!title) { toast("Гэрээний нэр оруулна уу"); return; }
  const body = {
    contract_no:         document.getElementById("hdc_no")?.value.trim(),
    title,
    contract_type:       type,
    counterparty:        document.getElementById("hdc_counter")?.value.trim(),
    amount:              document.getElementById("hdc_amount")?.value,
    status:              document.getElementById("hdc_status")?.value,
    start_date:          document.getElementById("hdc_start")?.value,
    end_date:            document.getElementById("hdc_end")?.value,
    description:         document.getElementById("hdc_desc")?.value.trim(),
    register_no:         document.getElementById("hdc_regno")?.value.trim(),
    phone:               document.getElementById("hdc_phone")?.value.trim(),
    email:               document.getElementById("hdc_email")?.value.trim(),
    signed_date:         document.getElementById("hdc_signed")?.value,
    responsible_person:  document.getElementById("hdc_resp")?.value.trim(),
    details:             JSON.stringify(hdGatherTypeDetails(type)),
  };
  try {
    if (id) {
      await api(`/api/org-contracts/${id}`, { method:"PUT", body:JSON.stringify(body) });
    } else {
      await api("/api/org-contracts", { method:"POST", body:JSON.stringify(body) });
    }
    document.getElementById("hdContractModal")?.remove();
    toast("Хадгалагдлаа");
    hdRenderTab(_docSubTab);
  } catch(e) { toast("Алдаа: " + e.message); }
}

async function hdDeleteContract(id, title) {
  if (!confirm(`"${title}" гэрээг устгах уу?`)) return;
  try {
    await api(`/api/org-contracts/${id}`, { method:"DELETE" });
    toast("Устгагдлаа");
    hdRenderTab(_docSubTab);
  } catch(e) { toast("Алдаа: " + e.message); }
}

// pending files for the scan upload modal
let _scanPending = [];   // Array of { file, previewUrl }
let _scanContractId = null;
let _scanContractTitle = "";

function _hdScanCardHtml(s, canEdit) {
  const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(s.url);
  return `<div style="position:relative;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;background:#f8fafc">
    ${isImg
      ? `<img src="${s.url}" style="width:100%;height:110px;object-fit:cover;display:block;cursor:pointer"
             onclick="hdViewContractScan('${s.url}','${escapeHtml(s.filename||_scanContractTitle)}')">`
      : `<div style="height:110px;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;gap:4px"
              onclick="hdViewContractScan('${s.url}','${escapeHtml(s.filename||_scanContractTitle)}')">
           <span style="font-size:30px">📄</span>
           <span style="font-size:10px;color:#64748b;text-align:center;padding:0 6px;word-break:break-all;max-width:100%">${escapeHtml(s.filename||"PDF")}</span>
         </div>`}
    ${canEdit ? `<button title="Энэ скан файлыг устгах" aria-label="Скан устгах" onclick="hdDelContractScan(${s.contract_id},'${escapeHtml(_scanContractTitle)}',${s.id})"
        style="position:absolute;top:4px;right:4px;background:rgba(220,38,38,.85);color:#fff;border:none;border-radius:50%;
                width:22px;height:22px;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center">✕</button>` : ""}
    <div style="padding:4px 6px;font-size:10px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(s.filename||"")}</div>
  </div>`;
}

function _hdRenderScanGrid(scans, canEdit) {
  const grid = document.getElementById("hdScanGrid");
  if (!grid) return;
  if (!scans.length) {
    grid.innerHTML = `<div style="text-align:center;padding:20px;color:#94a3b8;font-size:13px">Скан оруулаагүй байна</div>`;
  } else {
    grid.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;margin-bottom:4px">
      ${scans.map(s => _hdScanCardHtml(s, canEdit)).join("")}
    </div>`;
  }
}

function _hdRenderPendingGrid() {
  const el = document.getElementById("hdPendingGrid");
  if (!el) return;
  if (!_scanPending.length) { el.innerHTML = ""; return; }
  el.innerHTML = `
    <div style="font-size:11px;font-weight:700;color:#475569;margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">
      Хуулах файлууд (${_scanPending.length})
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;margin-bottom:12px">
      ${_scanPending.map((p, i) => {
        const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(p.file.name);
        return `<div style="position:relative;border:2px solid #2563eb;border-radius:10px;overflow:hidden;background:#eff6ff">
          ${isImg && p.previewUrl
            ? `<img src="${p.previewUrl}" style="width:100%;height:100px;object-fit:cover;display:block">`
            : `<div style="height:100px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px">
                 <span style="font-size:28px">📄</span>
               </div>`}
          <button title="Сонгосон файлыг жагсаалтаас хасах" aria-label="Сонгосон файлыг хасах" onclick="hdRemovePendingFile(${i})"
            style="position:absolute;top:4px;right:4px;background:rgba(220,38,38,.9);color:#fff;border:none;border-radius:50%;
                   width:20px;height:20px;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center">✕</button>
          <div style="padding:3px 5px;font-size:10px;color:#1d4ed8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(p.file.name)}</div>
        </div>`;
      }).join("")}
    </div>`;
}

function hdScanFilesChanged(input) {
  const files = Array.from(input.files);
  files.forEach(file => {
    const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(file.name);
    if (isImg) {
      const reader = new FileReader();
      reader.onload = e => {
        _scanPending.push({ file, previewUrl: e.target.result });
        _hdRenderPendingGrid();
      };
      reader.readAsDataURL(file);
    } else {
      _scanPending.push({ file, previewUrl: null });
      _hdRenderPendingGrid();
    }
  });
  input.value = "";
}

function hdRemovePendingFile(i) {
  _scanPending.splice(i, 1);
  _hdRenderPendingGrid();
}

async function hdUploadContractScan(id, title) {
  _scanContractId = id;
  _scanContractTitle = title;
  _scanPending = [];
  document.getElementById("hdScanModal")?.remove();
  const canEdit = ["director","hr"].includes(state.me.role);
  const scans = await api(`/api/org-contracts/${id}/scans`).catch(() => []);
  // inject contract_id for card rendering
  scans.forEach(s => { if (!s.contract_id) s.contract_id = id; });

  const html = `
  <div id="hdScanModal" style="position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:1001;display:flex;align-items:center;justify-content:center">
    <div style="background:#fff;border-radius:18px;width:640px;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 24px 64px rgba(0,0,0,.28)">
      <!-- header -->
      <div style="padding:22px 28px 16px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;flex-shrink:0">
        <div>
          <div style="font-weight:800;font-size:16px;color:#0f172a">📎 Скан файлууд</div>
          <div style="font-size:12px;color:#64748b;margin-top:2px">${escapeHtml(title)}</div>
        </div>
        <button onclick="document.getElementById('hdScanModal').remove()" style="background:none;border:none;font-size:22px;cursor:pointer;color:#94a3b8;padding:0 4px;line-height:1">✕</button>
      </div>
      <!-- body -->
      <div style="padding:20px 28px;overflow-y:auto;flex:1">
        <!-- uploaded scans -->
        <div style="font-size:11px;font-weight:700;color:#475569;margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">
          Хуулагдсан файлууд
        </div>
        <div id="hdScanGrid" style="margin-bottom:16px"></div>
        <!-- pending previews -->
        <div id="hdPendingGrid"></div>
        ${canEdit ? `
        <!-- drop zone -->
        <div id="hdScanDropZone"
             style="border:2px dashed #cbd5e1;border-radius:12px;padding:24px 16px;text-align:center;cursor:pointer;transition:.15s;margin-top:4px"
             onclick="document.getElementById('hdScanFileInput').click()"
             ondragover="event.preventDefault();this.style.borderColor='#2563eb';this.style.background='#eff6ff'"
             ondragleave="this.style.borderColor='#cbd5e1';this.style.background='transparent'"
             ondrop="event.preventDefault();this.style.borderColor='#cbd5e1';this.style.background='transparent';hdScanFilesChanged({files:event.dataTransfer.files,value:''})">
          <div style="font-size:32px;margin-bottom:8px">🖼</div>
          <div style="font-size:13px;font-weight:600;color:#334155">Зураг эсвэл PDF файл сонгох</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:4px">Олон файл нэг дор сонгох боломжтой · Drag & drop дэмжинэ</div>
        </div>
        <input type="file" id="hdScanFileInput" accept="image/*,.pdf" multiple style="display:none"
               onchange="hdScanFilesChanged(this)">` : ""}
      </div>
      <!-- footer -->
      <div style="padding:16px 28px;border-top:1px solid #e2e8f0;display:flex;gap:8px;justify-content:flex-end;flex-shrink:0">
        <button class="btn secondary" onclick="document.getElementById('hdScanModal').remove()">Хаах</button>
        ${canEdit ? `<button class="btn" id="hdScanUploadBtn" onclick="hdDoUploadScans(${id},'${escapeHtml(title)}')">⬆ Хуулах</button>` : ""}
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML("beforeend", html);
  _hdRenderScanGrid(scans, canEdit);
}

async function hdDoUploadScans(id, title) {
  if (!_scanPending.length) { toast("Файл сонгоно уу"); return; }
  const btn = document.getElementById("hdScanUploadBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Хуулж байна..."; }
  const token = localStorage.getItem("token");
  let uploaded = 0;
  for (const p of _scanPending) {
    const formData = new FormData();
    formData.append("scan", p.file);
    try {
      const resp = await fetch(`/api/org-contracts/${id}/scans`, {
        method: "POST", headers: { Authorization: "Bearer " + token }, body: formData
      });
      if (resp.ok) uploaded++;
    } catch(e) { /* continue */ }
  }
  _scanPending = [];
  _hdRenderPendingGrid();
  toast(`${uploaded} файл хуулагдлаа`);
  const scans = await api(`/api/org-contracts/${id}/scans`).catch(() => []);
  scans.forEach(s => { if (!s.contract_id) s.contract_id = id; });
  const canEdit = ["director","hr"].includes(state.me.role);
  _hdRenderScanGrid(scans, canEdit);
  if (btn) { btn.disabled = false; btn.textContent = "⬆ Хуулах"; }
}

async function hdDelContractScan(contractId, title, scanId) {
  if (!confirm("Энэ скан файлыг устгах уу?")) return;
  await api(`/api/org-contracts/${contractId}/scans/${scanId}`, { method: "DELETE" });
  toast("Устгагдлаа");
  const scans = await api(`/api/org-contracts/${contractId}/scans`).catch(() => []);
  scans.forEach(s => { if (!s.contract_id) s.contract_id = contractId; });
  _hdRenderScanGrid(scans, ["director","hr"].includes(state.me.role));
}

async function hdDoUploadScan(id) {
  const fileInput = document.getElementById("hdScanFile");
  if (!fileInput?.files?.length) { toast("Файл сонгоно уу"); return; }
  const formData = new FormData();
  formData.append("scan", fileInput.files[0]);
  try {
    const token = localStorage.getItem("token");
    const resp = await fetch(`/api/org-contracts/${id}/scan`, {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: formData
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Алдаа");
    document.getElementById("hdScanModal")?.remove();
    toast("Скан хуулагдлаа");
    hdRenderTab(_docSubTab);
  } catch(e) { toast("Алдаа: " + e.message); }
}

function hdUploadEmploymentScan(userId, name, currentUrl = "") {
  document.getElementById("hdEmpScanModal")?.remove();
  const html = `
  <div id="hdEmpScanModal" style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1001;display:flex;align-items:center;justify-content:center">
    <div style="background:#fff;border-radius:16px;padding:28px 32px;width:440px;box-shadow:0 20px 60px rgba(0,0,0,.25)">
      <div style="font-weight:800;font-size:16px;margin-bottom:6px">📎 Хөдөлмөрийн гэрээний скан</div>
      <div style="font-size:13px;color:#64748b;margin-bottom:18px">${escapeHtml(name)}</div>
      ${currentUrl ? `
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px 14px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;gap:10px">
          <div>
            <div style="font-size:12px;font-weight:800;color:#15803d">Одоогийн скан файл байна</div>
            <div style="font-size:11px;color:#64748b;margin-top:2px">Шинэ файл хуулбал одоогийн скан солигдоно.</div>
          </div>
          <button class="btn secondary sm" onclick="hdViewContractScan('${currentUrl}','${escapeHtml(name)}')">📄 Харах</button>
        </div>` : ""}
      <div style="border:2px dashed #cbd5e1;border-radius:10px;padding:24px;text-align:center;cursor:pointer;margin-bottom:16px"
           onclick="document.getElementById('hdEmpScanFile').click()">
        <div style="font-size:28px;margin-bottom:8px">📁</div>
        <div style="font-size:13px;color:#475569">${currentUrl ? "Шинэ scan файл сонгох" : "Scan файл сонгох"} (зураг эсвэл PDF)</div>
        <div id="hdEmpScanFileName" style="font-size:12px;color:#1d4ed8;margin-top:6px;font-weight:600"></div>
      </div>
      <input type="file" id="hdEmpScanFile" accept="image/*,.pdf" style="display:none"
             onchange="document.getElementById('hdEmpScanFileName').textContent=this.files[0]?.name||''">
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn secondary" onclick="document.getElementById('hdEmpScanModal').remove()">Болих</button>
        <button class="btn" onclick="hdDoUploadEmploymentScan(${userId})">${currentUrl ? "Солих" : "Хуулах"}</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML("beforeend", html);
}

async function hdDoUploadEmploymentScan(userId) {
  const fileInput = document.getElementById("hdEmpScanFile");
  if (!fileInput?.files?.length) { toast("Файл сонгоно уу"); return; }
  const formData = new FormData();
  formData.append("scan", fileInput.files[0]);
  try {
    const token = localStorage.getItem("token");
    const resp = await fetch(`/api/users/${userId}/contract-scan`, {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: formData
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Алдаа");
    document.getElementById("hdEmpScanModal")?.remove();
    toast("Скан хуулагдлаа");
    _hrUsers = await api("/api/users-full").catch(() => _hrUsers);
    const cont = document.getElementById("hdTabContent");
    if (cont) hdRenderEmployment(cont);
  } catch(e) { toast("Алдаа: " + e.message); }
}

function hdViewContractScan(url, title) {
  document.getElementById("hdScanViewModal")?.remove();
  const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(url);
  const isPdf = /\.pdf(?:$|\?)/i.test(url);
  const previewUrl = isPdf && !url.includes("#") ? `${url}#toolbar=0&navpanes=0&scrollbar=1` : url;
  const html = `
  <div id="hdScanViewModal" style="position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:1001;display:flex;flex-direction:column;align-items:center;justify-content:center"
       onclick="if(event.target===this)this.remove()">
    <div style="background:#1e293b;border-radius:12px;padding:12px 18px;margin-bottom:10px;display:flex;align-items:center;gap:12px;width:90%;max-width:900px">
      <span style="color:#f8fafc;font-weight:700;font-size:14px;flex:1">📄 ${escapeHtml(title)}</span>
      <button onclick="document.getElementById('hdScanViewModal').remove()" style="background:none;border:none;color:#94a3b8;font-size:20px;cursor:pointer;padding:0 4px">✕</button>
    </div>
    <div style="width:90%;max-width:900px;max-height:80vh;background:#fff;border-radius:8px;overflow:auto">
      ${isImage
        ? `<img src="${url}" style="width:100%;display:block">`
        : isPdf
          ? `<iframe src="${previewUrl}" style="width:100%;height:80vh;border:none"></iframe>`
          : `<div style="padding:32px;text-align:center;color:#475569;font-size:13px">
               Энэ төрлийн файлыг дэлгэц дээр шууд preview хийх боломжгүй байна.
             </div>`}
    </div>
  </div>`;
  document.body.insertAdjacentHTML("beforeend", html);
}

Object.assign(window, { hrDocTab, hdAddContract, hdEditContract, hdViewContract, hdSaveContract, hdDeleteContract,
  hdContractTypeFields, hdGatherTypeDetails, hdPrintContracts,
  hdUploadContractScan, hdDoUploadScan, hdDoUploadScans, hdDelContractScan, hdViewContractScan,
  hdScanFilesChanged, hdRemovePendingFile,
  hdUploadEmploymentScan, hdDoUploadEmploymentScan });

// ══════════════════════════════════════════════════════════════
// ── Tab: Бүрдүүлэлт (Recruitment) ─────────────────────────────
// ══════════════════════════════════════════════════════════════

let _recruitTab = "postings";

async function hrRenderRecruit(tc) {
  if (!tc) tc = document.getElementById("hrSubContent") || document.getElementById("hrTabContent");
  if (!tc) return;
  const canEdit = ["director","hr"].includes(state.me.role);
  tc.innerHTML = `
  <div style="padding:20px 24px">
    <div style="display:flex;gap:8px;margin-bottom:20px;border-bottom:2px solid #e2e8f0;padding-bottom:0">
      ${[["postings","📋 Ажлын байр"],["candidates","👥 Анкет / Нэр дэвшигч"]].map(([k,l])=>`
        <button onclick="recruitSwTab('${k}')" id="rectab_${k}"
          style="padding:10px 16px;font-size:13px;font-weight:600;border:none;background:none;cursor:pointer;
                 border-bottom:${_recruitTab===k?"2px solid #2563eb":"2px solid transparent"};
                 color:${_recruitTab===k?"#2563eb":"#64748b"};margin-bottom:-2px">${l}</button>`).join("")}
      ${canEdit ? `<div style="margin-left:auto;padding-bottom:8px">
        <button class="btn" onclick="${_recruitTab==="postings"?"recruitAddPosting()":"recruitAddCandidate()"}">+ Нэмэх</button>
      </div>` : ""}
    </div>
    <div id="recruitContent"></div>
  </div>`;
  await recruitRender();
}

async function recruitSwTab(tab) {
  _recruitTab = tab;
  document.querySelectorAll("[id^='rectab_']").forEach(b => {
    const k = b.id.replace("rectab_","");
    b.style.borderBottom = k===tab?"2px solid #2563eb":"2px solid transparent";
    b.style.color        = k===tab?"#2563eb":"#64748b";
  });
  const addBtn = document.querySelector("[onclick*='recruitAddPosting'],[onclick*='recruitAddCandidate']");
  if (addBtn) addBtn.setAttribute("onclick", tab==="postings"?"recruitAddPosting()":"recruitAddCandidate()");
  await recruitRender();
}

async function recruitRender() {
  const cont = document.getElementById("recruitContent");
  if (!cont) return;
  const canEdit = ["director","hr"].includes(state.me.role);
  if (_recruitTab === "postings") {
    const rows = await api("/api/job-postings").catch(()=>[]);
    const stColors = {"Нээлттэй":"#15803d","Хаагдсан":"#64748b","Дүүрсэн":"#c2410c"};
    cont.innerHTML = rows.length === 0
      ? `<div style="text-align:center;padding:48px;color:#94a3b8"><div style="font-size:32px">🔍</div>Ажлын байр зарлаагүй байна</div>`
      : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px">
      ${rows.map(r=>`
      <div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:18px;box-shadow:0 1px 4px rgba(0,0,0,.06)">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
          <div style="font-weight:700;font-size:14px">${escapeHtml(r.title)}</div>
          <span style="padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600;
            background:${r.status==="Нээлттэй"?"#dcfce7":r.status==="Хаагдсан"?"#f1f5f9":"#fff7ed"};
            color:${stColors[r.status]||"#64748b"}">${r.status}</span>
        </div>
        <div style="font-size:12px;color:#475569;margin-bottom:6px">📁 ${escapeHtml(r.department||"—")} · ${escapeHtml(r.position||"—")}</div>
        ${r.salary_range?`<div style="font-size:12px;color:#15803d;font-weight:600;margin-bottom:6px">💰 ${escapeHtml(r.salary_range)}</div>`:""}
        ${r.deadline?`<div style="font-size:12px;color:${new Date(r.deadline)<new Date()?"#dc2626":"#64748b"}">📅 Дуусах: ${r.deadline}</div>`:""}
        ${r.requirements?`<div style="font-size:12px;color:#64748b;margin-top:8px;border-top:1px solid #f1f5f9;padding-top:8px">${escapeHtml(r.requirements).substring(0,120)}${r.requirements.length>120?"...":""}</div>`:""}
        ${canEdit?`<div style="display:flex;gap:6px;margin-top:12px">
          <button class="btn secondary sm" onclick="recruitAddCandidate(${r.id},'${escapeHtml(r.title)}')">+ Нэр дэвшигч</button>
          <button class="btn secondary sm" onclick="recruitEditPosting(${r.id})">✏</button>
          <button class="btn secondary sm" style="color:#dc2626" onclick="recruitDelPosting(${r.id},'${escapeHtml(r.title)}')">🗑</button>
        </div>`:""}
      </div>`).join("")}
    </div>`;
  } else {
    const rows = await api("/api/job-applications").catch(()=>[]);
    const stages = ["Бүртгэгдсэн","Ярилцлага","Шалгаруулалт","Тэнцсэн","Тэнцээгүй"];
    const stColor = {"Бүртгэгдсэн":"#2563eb","Ярилцлага":"#c2410c","Шалгаруулалт":"#a16207","Тэнцсэн":"#15803d","Тэнцээгүй":"#64748b"};
    cont.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0">
          <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#475569">НЭР</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#475569">АЖЛЫН БАЙР</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#475569">УТАС / ИМЭЙЛ</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#475569">ШАТ</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#475569">ЯРИЛЦЛАГА</th>
          <th style="padding:10px 12px"></th>
        </tr>
      </thead>
      <tbody>
        ${rows.length===0?`<tr><td colspan="6" style="text-align:center;padding:40px;color:#94a3b8">Анкет бүртгэгдээгүй байна</td></tr>`:
        rows.map((r,i)=>`
        <tr style="border-bottom:1px solid #f1f5f9;background:${i%2===0?"#fff":"#fafbfc"}">
          <td style="padding:10px 12px;font-weight:600">${escapeHtml(r.full_name)}
            ${r.education?`<div style="font-size:11px;color:#64748b">${escapeHtml(r.education)}</div>`:""}
          </td>
          <td style="padding:10px 12px;color:#475569;font-size:12px">${escapeHtml(r.posting_title||"—")}</td>
          <td style="padding:10px 12px;font-size:12px;color:#64748b">${escapeHtml(r.phone||"—")}<br>${escapeHtml(r.email||"")}</td>
          <td style="padding:10px 12px">
            <span style="padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600;
              background:${r.stage==="Тэнцсэн"?"#dcfce7":r.stage==="Тэнцээгүй"?"#f1f5f9":"#eff6ff"};
              color:${stColor[r.stage]||"#2563eb"}">${r.stage}</span>
          </td>
          <td style="padding:10px 12px;font-size:12px;color:#64748b">${r.interview_date||"—"}</td>
          <td style="padding:10px 12px;white-space:nowrap">
            ${r.cv_url?`<a href="${r.cv_url}" target="_blank" class="btn secondary sm" style="text-decoration:none">📄 CV</a>`:""}
            ${canEdit?`
            <button class="btn secondary sm" onclick="recruitEditCandidate(${r.id})">✏</button>
            <button class="btn secondary sm" style="color:#dc2626" onclick="recruitDelCandidate(${r.id},'${escapeHtml(r.full_name)}')">🗑</button>`:""}
          </td>
        </tr>`).join("")}
      </tbody>
    </table>`;
  }
}

function recruitAddPosting() {
  document.getElementById("recruitPostingModal")?.remove();
  const html = `
  <div id="recruitPostingModal" style="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;display:flex;align-items:center;justify-content:center;overflow-y:auto">
    <div style="background:#fff;border-radius:16px;padding:28px 32px;width:540px;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.25)">
      <div style="font-weight:800;font-size:17px;margin-bottom:20px">🔍 Ажлын байр зарлах</div>
      <div class="row">
        <div><div class="small muted">Ажлын байрны нэр *</div><input class="input" id="rp_title" placeholder="Инженер, Нягтлан..."></div>
        <div><div class="small muted">Хэлтэс</div><input class="input" id="rp_dept" placeholder="Захиргаа..."></div>
      </div>
      <div class="row">
        <div><div class="small muted">Албан тушаал</div><input class="input" id="rp_pos" placeholder="Ахлах инженер..."></div>
        <div><div class="small muted">Цалингийн хязгаар</div><input class="input" id="rp_sal" placeholder="1,500,000 - 2,000,000₮"></div>
      </div>
      <div class="row">
        <div><div class="small muted">Дуусах огноо</div><input class="input" id="rp_deadline" type="date"></div>
        <div><div class="small muted">Статус</div>
          <select class="input" id="rp_status">
            <option>Нээлттэй</option><option>Хаагдсан</option><option>Дүүрсэн</option>
          </select></div>
      </div>
      <div><div class="small muted">Шаардлага / Тайлбар</div>
        <textarea class="input" id="rp_req" rows="3" placeholder="Боловсрол, туршлага, ур чадвар..."></textarea></div>
      <div style="display:flex;gap:8px;margin-top:18px;justify-content:flex-end">
        <button class="btn secondary" onclick="document.getElementById('recruitPostingModal').remove()">Болих</button>
        <button class="btn" onclick="recruitSavePosting(null)">Хадгалах</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML("beforeend", html);
}

async function recruitEditPosting(id) {
  const rows = await api("/api/job-postings").catch(()=>[]);
  const r = rows.find(x=>x.id===id);
  if (!r) return;
  recruitAddPosting();
  document.getElementById("rp_title").value = r.title||"";
  document.getElementById("rp_dept").value  = r.department||"";
  document.getElementById("rp_pos").value   = r.position||"";
  document.getElementById("rp_sal").value   = r.salary_range||"";
  document.getElementById("rp_deadline").value = r.deadline||"";
  document.getElementById("rp_status").value   = r.status||"Нээлттэй";
  document.getElementById("rp_req").value   = r.requirements||"";
  document.querySelector("[onclick='recruitSavePosting(null)']")?.setAttribute("onclick",`recruitSavePosting(${id})`);
  document.querySelector("#recruitPostingModal div div:first-child").textContent = "🔍 Ажлын байр засах";
}

async function recruitSavePosting(id) {
  const title = document.getElementById("rp_title")?.value.trim();
  if (!title) { toast("Нэрийг оруулна уу"); return; }
  const body = {
    title, department: document.getElementById("rp_dept")?.value.trim(),
    position: document.getElementById("rp_pos")?.value.trim(),
    salary_range: document.getElementById("rp_sal")?.value.trim(),
    deadline: document.getElementById("rp_deadline")?.value,
    status: document.getElementById("rp_status")?.value,
    requirements: document.getElementById("rp_req")?.value.trim(),
  };
  try {
    if (id) await api(`/api/job-postings/${id}`,{method:"PUT",body:JSON.stringify(body)});
    else await api("/api/job-postings",{method:"POST",body:JSON.stringify(body)});
    document.getElementById("recruitPostingModal")?.remove();
    toast("Хадгалагдлаа");
    await recruitRender();
  } catch(e) { toast("Алдаа: "+e.message); }
}

async function recruitDelPosting(id, title) {
  if (!confirm(`"${title}" ажлын байрыг устгах уу?`)) return;
  await api(`/api/job-postings/${id}`,{method:"DELETE"});
  toast("Устгагдлаа"); await recruitRender();
}

function recruitAddCandidate(postingId=null, postingTitle="") {
  document.getElementById("recruitCandModal")?.remove();
  const html = `
  <div id="recruitCandModal" style="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;display:flex;align-items:center;justify-content:center;overflow-y:auto">
    <div style="background:#fff;border-radius:16px;padding:28px 32px;width:560px;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.25)">
      <div style="font-weight:800;font-size:17px;margin-bottom:20px">👤 Нэр дэвшигч бүртгэх</div>
      <div class="row">
        <div><div class="small muted">Овог нэр *</div><input class="input" id="rc_name" placeholder="Бат Болд"></div>
        <div><div class="small muted">Регистрийн дугаар</div><input class="input" id="rc_reg" placeholder="ЖБ123456"></div>
      </div>
      <div class="row">
        <div><div class="small muted">Төрсөн огноо</div><input class="input" id="rc_birth" type="date"></div>
        <div><div class="small muted">Утас</div><input class="input" id="rc_phone" placeholder="9900-0000"></div>
      </div>
      <div class="row">
        <div><div class="small muted">Имэйл</div><input class="input" id="rc_email" placeholder="bat@gmail.com"></div>
        <div><div class="small muted">Хаяг</div><input class="input" id="rc_addr" placeholder="Хот, дүүрэг..."></div>
      </div>
      <div class="row">
        <div><div class="small muted">Боловсрол</div>
          <select class="input" id="rc_edu">
            <option>Бакалавр</option><option>Магистр</option><option>Доктор</option>
            <option>Дипломын дээд</option><option>Бүрэн дунд</option>
          </select></div>
        <div><div class="small muted">Мэргэжил</div><input class="input" id="rc_major" placeholder="Мэдээллийн технологи..."></div>
      </div>
      <div><div class="small muted">Ажлын туршлага</div>
        <textarea class="input" id="rc_exp" rows="2" placeholder="Ажилласан байгууллага, хугацаа..."></textarea></div>
      <div><div class="small muted">Ур чадвар</div>
        <input class="input" id="rc_skills" placeholder="JavaScript, Excel, Монгол хэл..."></div>
      <div class="row">
        <div><div class="small muted">Ярилцлагын огноо</div><input class="input" id="rc_idate" type="date"></div>
        <div><div class="small muted">Шат</div>
          <select class="input" id="rc_stage">
            <option>Бүртгэгдсэн</option><option>Ярилцлага</option>
            <option>Шалгаруулалт</option><option>Тэнцсэн</option><option>Тэнцээгүй</option>
          </select></div>
      </div>
      <div><div class="small muted">Ярилцлагын тэмдэглэл</div>
        <textarea class="input" id="rc_inote" rows="2" placeholder="Ярилцлагын үр дүн..."></textarea></div>
      <input type="hidden" id="rc_posting_id" value="${postingId||""}">
      <div style="display:flex;gap:8px;margin-top:18px;justify-content:flex-end">
        <button class="btn secondary" onclick="document.getElementById('recruitCandModal').remove()">Болих</button>
        <button class="btn" onclick="recruitSaveCandidate(null)">Хадгалах</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML("beforeend", html);
}

async function recruitEditCandidate(id) {
  const rows = await api("/api/job-applications").catch(()=>[]);
  const r = rows.find(x=>x.id===id);
  if (!r) return;
  recruitAddCandidate(r.posting_id);
  setTimeout(()=>{
    document.getElementById("rc_name").value   = r.full_name||"";
    document.getElementById("rc_reg").value    = r.register_no||"";
    document.getElementById("rc_birth").value  = r.birthdate||"";
    document.getElementById("rc_phone").value  = r.phone||"";
    document.getElementById("rc_email").value  = r.email||"";
    document.getElementById("rc_addr").value   = r.address||"";
    document.getElementById("rc_edu").value    = r.education||"Бакалавр";
    document.getElementById("rc_major").value  = r.major||"";
    document.getElementById("rc_exp").value    = r.experience||"";
    document.getElementById("rc_skills").value = r.skills||"";
    document.getElementById("rc_idate").value  = r.interview_date||"";
    document.getElementById("rc_stage").value  = r.stage||"Бүртгэгдсэн";
    document.getElementById("rc_inote").value  = r.interview_note||"";
    document.querySelector("[onclick='recruitSaveCandidate(null)']")?.setAttribute("onclick",`recruitSaveCandidate(${id})`);
  }, 50);
}

async function recruitSaveCandidate(id) {
  const name = document.getElementById("rc_name")?.value.trim();
  if (!name) { toast("Нэр оруулна уу"); return; }
  const body = {
    posting_id: document.getElementById("rc_posting_id")?.value||null,
    full_name: name, register_no: document.getElementById("rc_reg")?.value.trim(),
    birthdate: document.getElementById("rc_birth")?.value,
    phone: document.getElementById("rc_phone")?.value.trim(),
    email: document.getElementById("rc_email")?.value.trim(),
    address: document.getElementById("rc_addr")?.value.trim(),
    education: document.getElementById("rc_edu")?.value,
    major: document.getElementById("rc_major")?.value.trim(),
    experience: document.getElementById("rc_exp")?.value.trim(),
    skills: document.getElementById("rc_skills")?.value.trim(),
    interview_date: document.getElementById("rc_idate")?.value,
    stage: document.getElementById("rc_stage")?.value,
    interview_note: document.getElementById("rc_inote")?.value.trim(),
  };
  try {
    if (id) await api(`/api/job-applications/${id}`,{method:"PUT",body:JSON.stringify(body)});
    else await api("/api/job-applications",{method:"POST",body:JSON.stringify(body)});
    document.getElementById("recruitCandModal")?.remove();
    toast("Хадгалагдлаа");
    _recruitTab = "candidates"; await recruitRender();
  } catch(e) { toast("Алдаа: "+e.message); }
}

async function recruitDelCandidate(id, name) {
  if (!confirm(`"${name}"-г устгах уу?`)) return;
  await api(`/api/job-applications/${id}`,{method:"DELETE"});
  toast("Устгагдлаа"); await recruitRender();
}

Object.assign(window, { hrRenderRecruit, recruitSwTab, recruitRender,
  recruitAddPosting, recruitEditPosting, recruitSavePosting, recruitDelPosting,
  recruitAddCandidate, recruitEditCandidate, recruitSaveCandidate, recruitDelCandidate });

// ══════════════════════════════════════════════════════════════
// ── Tab: Сургалт (Training) ────────────────────────────────────
// ══════════════════════════════════════════════════════════════

let _trainings = [];

function trainingMaterialLabel(url = "") {
  if (/\.pdf$/i.test(url)) return "PDF";
  if (/\.pptx?$/i.test(url)) return "PPT";
  return "Файл";
}

async function hrRenderTraining(tc) {
  if (!tc) tc = document.getElementById("hrSubContent") || document.getElementById("hrTabContent");
  if (!tc) return;
  const canEdit = ["director","hr"].includes(state.me.role);
  _trainings = await api("/api/trainings").catch(()=>[]);
  const total = _trainings.length;
  const totalHours = _trainings.reduce((s,t)=>s+Number(t.hours||0),0);
  const planned = _trainings.filter(t=>t.status==="Төлөвлөгдсөн").length;
  const done    = _trainings.filter(t=>t.status==="Дууссан").length;

  tc.innerHTML = `
  <div style="padding:20px 24px">
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px">
      ${[
        ["📚","Нийт сургалт",total,"#eff6ff","#1d4ed8"],
        ["⏱","Нийт цаг",totalHours+"ц","#f0fdf4","#15803d"],
        ["📅","Төлөвлөгдсөн",planned,"#fef9c3","#a16207"],
        ["✅","Дууссан",done,"#dcfce7","#15803d"],
      ].map(([ic,l,v,bg,c])=>`
        <div style="background:${bg};border-radius:12px;padding:14px 16px;text-align:center">
          <div style="font-size:20px">${ic}</div>
          <div style="font-size:10px;font-weight:700;color:${c};letter-spacing:.05em">${l}</div>
          <div style="font-size:20px;font-weight:800;color:${c}">${v}</div>
        </div>`).join("")}
    </div>
    ${canEdit?`<div style="display:flex;justify-content:flex-end;margin-bottom:12px">
      <button class="btn" onclick="trainingAdd()">+ Сургалт нэмэх</button>
    </div>`:""}
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0">
          <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#475569">СУРГАЛТЫН НЭР</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#475569">ТӨРӨЛ</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#475569">СУРГАГЧ</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#475569">ОГНОО</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#475569">ЦАГ</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#475569">СТАТУС</th>
          <th style="padding:10px 12px"></th>
        </tr>
      </thead>
      <tbody>
        ${_trainings.length===0?`<tr><td colspan="7" style="text-align:center;padding:40px;color:#94a3b8">Сургалт бүртгэгдээгүй байна</td></tr>`:
        _trainings.map((t,i)=>{
          const stBg = t.status==="Дууссан"?"#dcfce7":t.status==="Явагдаж байна"?"#eff6ff":"#fef9c3";
          const stCl = t.status==="Дууссан"?"#15803d":t.status==="Явагдаж байна"?"#1d4ed8":"#a16207";
          return `
          <tr style="border-bottom:1px solid #f1f5f9;background:${i%2===0?"#fff":"#fafbfc"}">
            <td style="padding:10px 12px;font-weight:600">${escapeHtml(t.title)}
              ${t.location?`<div style="font-size:11px;color:#64748b">📍 ${escapeHtml(t.location)}</div>`:""}
            </td>
            <td style="padding:10px 12px"><span style="padding:2px 8px;border-radius:20px;font-size:11px;background:${t.type==="Дотоод"?"#f0f9ff":"#fdf4ff"};color:${t.type==="Дотоод"?"#0369a1":"#7e22ce"};font-weight:600">${t.type}</span></td>
            <td style="padding:10px 12px;color:#475569;font-size:12px">${escapeHtml(t.trainer||"—")}</td>
            <td style="padding:10px 12px;font-size:12px;color:#64748b">${t.start_date||"—"}${t.end_date&&t.end_date!==t.start_date?" ~ "+t.end_date:""}</td>
            <td style="padding:10px 12px;font-weight:600">${t.hours||0}ц</td>
            <td style="padding:10px 12px"><span style="padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600;background:${stBg};color:${stCl}">${t.status}</span></td>
            <td style="padding:10px 12px;white-space:nowrap">
              ${t.material_url?`<a class="btn secondary sm" href="${escapeHtml(t.material_url)}" target="_blank" style="text-decoration:none">${trainingMaterialLabel(t.material_url)}</a>`:""}
              <button class="btn secondary sm" onclick="trainingViewAttendees(${t.id},'${escapeHtml(t.title)}')">👥</button>
              ${canEdit?`<button class="btn secondary sm" onclick="trainingEdit(${t.id})">✏</button>
              <button class="btn secondary sm" style="color:#dc2626" onclick="trainingDel(${t.id},'${escapeHtml(t.title)}')">🗑</button>`:""}
            </td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
    </div>
  </div>`;
}

function trainingAdd(data={}) {
  document.getElementById("trainingModal")?.remove();
  const isEdit = !!data.id;
  const html = `
  <div id="trainingModal" style="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;display:flex;align-items:center;justify-content:center;overflow-y:auto">
    <div style="background:#fff;border-radius:16px;padding:28px 32px;width:540px;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.25)">
      <div style="font-weight:800;font-size:17px;margin-bottom:20px">${isEdit?"Сургалт засах":"📚 Сургалт нэмэх"}</div>
      <div class="row">
        <div><div class="small muted">Сургалтын нэр *</div><input class="input" id="tr_title" value="${escapeHtml(data.title||"")}" placeholder="Нэр..."></div>
        <div><div class="small muted">Төрөл</div>
          <select class="input" id="tr_type">
            ${["Дотоод","Гадаад","Онлайн"].map(t=>`<option ${(data.type||"Дотоод")===t?"selected":""}>${t}</option>`).join("")}
          </select></div>
      </div>
      <div class="row">
        <div><div class="small muted">Ангилал</div><input class="input" id="tr_cat" value="${escapeHtml(data.category||"")}" placeholder="Мэргэжлийн, Аюулгүй байдал..."></div>
        <div><div class="small muted">Сургагч</div><input class="input" id="tr_trainer" value="${escapeHtml(data.trainer||"")}" placeholder="Нэр..."></div>
      </div>
      <div class="row">
        <div><div class="small muted">Байршил</div><input class="input" id="tr_loc" value="${escapeHtml(data.location||"")}" placeholder="Танхим, онлайн..."></div>
        <div><div class="small muted">Статус</div>
          <select class="input" id="tr_status">
            ${["Төлөвлөгдсөн","Явагдаж байна","Дууссан","Цуцлагдсан"].map(s=>`<option ${(data.status||"Төлөвлөгдсөн")===s?"selected":""}>${s}</option>`).join("")}
          </select></div>
      </div>
      <div class="row">
        <div><div class="small muted">Эхлэх огноо</div><input class="input" id="tr_start" type="date" value="${data.start_date||""}"></div>
        <div><div class="small muted">Дуусах огноо</div><input class="input" id="tr_end" type="date" value="${data.end_date||""}"></div>
      </div>
      <div class="row">
        <div><div class="small muted">Нийт цаг</div><input class="input" id="tr_hours" type="number" value="${data.hours||""}" placeholder="8"></div>
        <div><div class="small muted">Төсөв (₮)</div><input class="input" id="tr_budget" type="number" value="${data.budget||""}" placeholder="0"></div>
      </div>
      <div>
        <div class="small muted">Сургалтын материал (PDF / PowerPoint)</div>
        <input class="input" id="tr_material" type="file" accept=".pdf,.ppt,.pptx,application/pdf,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation" style="margin:0">
        ${data.material_url?`<div style="margin-top:6px"><a href="${escapeHtml(data.material_url)}" target="_blank" style="font-size:12px;color:#2563eb;text-decoration:none">Оруулсан материал харах</a></div>`:""}
      </div>
      <div><div class="small muted">Тайлбар</div><textarea class="input" id="tr_desc" rows="2" placeholder="...">${escapeHtml(data.description||"")}</textarea></div>
      <div style="display:flex;gap:8px;margin-top:18px;justify-content:flex-end">
        <button class="btn secondary" onclick="document.getElementById('trainingModal').remove()">Болих</button>
        <button class="btn" onclick="trainingSave(${isEdit?data.id:"null"})">Хадгалах</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML("beforeend", html);
}

async function trainingEdit(id) {
  const t = _trainings.find(x=>x.id===id);
  if (t) trainingAdd(t);
}

async function trainingSave(id) {
  const title = document.getElementById("tr_title")?.value.trim();
  if (!title) { toast("Нэрийг оруулна уу"); return; }
  const body = {
    title, type: document.getElementById("tr_type")?.value,
    category: document.getElementById("tr_cat")?.value.trim(),
    trainer: document.getElementById("tr_trainer")?.value.trim(),
    location: document.getElementById("tr_loc")?.value.trim(),
    status: document.getElementById("tr_status")?.value,
    start_date: document.getElementById("tr_start")?.value,
    end_date: document.getElementById("tr_end")?.value,
    hours: document.getElementById("tr_hours")?.value,
    budget: document.getElementById("tr_budget")?.value,
    description: document.getElementById("tr_desc")?.value.trim(),
  };
  try {
    let saved = null;
    if (id) {
      await api(`/api/trainings/${id}`,{method:"PUT",body:JSON.stringify(body)});
      saved = { id };
    } else {
      saved = await api("/api/trainings",{method:"POST",body:JSON.stringify(body)});
    }
    await trainingUploadMaterial(saved.id);
    document.getElementById("trainingModal")?.remove();
    toast("Хадгалагдлаа");
    hrRenderTraining(document.getElementById("hrSubContent"));
  } catch(e) { toast("Алдаа: "+e.message); }
}

async function trainingUploadMaterial(trainingId) {
  const input = document.getElementById("tr_material");
  if (!input?.files?.length) return;
  const file = input.files[0];
  const okType = [
    "application/pdf",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ].includes(file.type);
  const okExt = /\.(pdf|ppt|pptx)$/i.test(file.name || "");
  if (!okType && !okExt) {
    throw new Error("Зөвхөн PDF эсвэл PowerPoint файл сонгоно уу");
  }
  const fd = new FormData();
  fd.append("material", file);
  const res = await fetch(`/api/trainings/${trainingId}/material`, {
    method: "POST",
    headers: { Authorization: "Bearer " + state.token },
    body: fd
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Материал файл хадгалахад алдаа гарлаа");
  return data;
}

async function trainingDel(id, title) {
  if (!confirm(`"${title}" устгах уу?`)) return;
  await api(`/api/trainings/${id}`,{method:"DELETE"});
  toast("Устгагдлаа");
  hrRenderTraining(document.getElementById("hrSubContent"));
}

async function trainingViewAttendees(trainingId, trainingTitle) {
  document.getElementById("trainingAttendeesModal")?.remove();
  const attendees = await api(`/api/training-attendees/${trainingId}`).catch(()=>[]);
  const all = _hrUsers;
  const attendeeIds = new Set(attendees.map(a=>a.user_id));
  const canEdit = ["director","hr"].includes(state.me.role);

  const html = `
  <div id="trainingAttendeesModal" style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1001;display:flex;align-items:center;justify-content:center;overflow-y:auto">
    <div style="background:#fff;border-radius:16px;padding:28px 32px;width:640px;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.25)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div style="font-weight:800;font-size:16px">👥 ${escapeHtml(trainingTitle)} — оролцогчид</div>
        <button onclick="document.getElementById('trainingAttendeesModal').remove()" style="background:none;border:none;font-size:20px;color:#94a3b8;cursor:pointer">✕</button>
      </div>
      <div style="font-size:12px;color:#64748b;margin-bottom:12px">Нийт: ${attendees.length} ажилтан оролцсон</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0">
          <th style="padding:8px 10px;text-align:left;font-size:11px;font-weight:600;color:#475569">АЖИЛТАН</th>
          <th style="padding:8px 10px;text-align:left;font-size:11px;font-weight:600;color:#475569">ИРСЭН</th>
          <th style="padding:8px 10px;text-align:left;font-size:11px;font-weight:600;color:#475569">ОНОО</th>
          <th style="padding:8px 10px;text-align:left;font-size:11px;font-weight:600;color:#475569">СЕРТИФИКАТ</th>
        </tr></thead>
        <tbody>
          ${all.map(u=>{
            const a = attendees.find(x=>x.user_id===u.id);
            return `<tr style="border-bottom:1px solid #f1f5f9">
              <td style="padding:8px 10px">
                <div style="display:flex;align-items:center;gap:6px">
                  ${avatarEl(u.full_name,24)}
                  <div><div style="font-weight:600;font-size:12px">${escapeHtml(u.full_name)}</div>
                  <div style="font-size:10px;color:#64748b">${escapeHtml(u.department||"")}</div></div>
                </div>
              </td>
              <td style="padding:8px 10px">
                ${canEdit?`<input type="checkbox" ${a?.attended?"checked":""} onchange="trainingSetAttendee(${trainingId},${u.id},this.checked,${a?.id||"null"})">`:
                  a?.attended?"✅":"—"}
              </td>
              <td style="padding:8px 10px">
                ${canEdit&&a?`<input type="number" min="0" max="100" value="${a.score||""}" style="width:60px;border:1px solid #e2e8f0;border-radius:6px;padding:2px 6px;font-size:12px" onchange="trainingSetScore(${a.id},this.value)">`:
                  a?.score!=null?a.score+"":"—"}
              </td>
              <td style="padding:8px 10px">
                ${a?.certificate_url?`<a href="${a.certificate_url}" target="_blank" style="color:#2563eb;font-size:12px">📄 Харах</a>`:"—"}
              </td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
  </div>`;
  document.body.insertAdjacentHTML("beforeend", html);
}

async function trainingSetAttendee(trainingId, userId, attended, existingId) {
  await api("/api/training-attendees",{method:"POST",body:JSON.stringify({training_id:trainingId,user_id:userId,attended:attended?1:0})}).catch(()=>{});
}

async function trainingSetScore(attendeeId, score) {
  await api(`/api/training-attendees`,{method:"POST",body:JSON.stringify({id:attendeeId,score:Number(score)})}).catch(()=>{});
}

Object.assign(window, { hrRenderTraining, trainingAdd, trainingEdit, trainingSave, trainingDel,
  trainingViewAttendees, trainingSetAttendee, trainingSetScore });

// ══════════════════════════════════════════════════════════════
// ── Tab: Үнэлгээ (KPI Evaluation) ─────────────────────────────
// ══════════════════════════════════════════════════════════════

const KPI_CRITERIA = [
  { name: "Ирц", weight: 20 },
  { name: "Төлөвлөгөөт ажлын гүйцэтгэл", weight: 30 },
  { name: "ХАБЭА-н зааварчилгааг мөрдсөн байдал", weight: 15 },
  { name: "Ажлын байрны эмх цэгц", weight: 10 },
  { name: "Үүрэг даалгаврын биелэлт", weight: 15 },
  { name: "Олон нийтийн ажлын идэвхи", weight: 10 },
];

async function hrRenderEvaluation(tc) {
  if (!tc) tc = document.getElementById("hrSubContent") || document.getElementById("hrTabContent");
  if (!tc) return;
  const canEdit  = ["director","hr"].includes(state.me.role);
  const canApprove = ["director","chief_engineer"].includes(state.me.role);
  const evals = await api("/api/kpi-evaluations").catch(()=>[]);
  const periodTypes = ["Сар","Улирал","Жил"];
  const now = new Date();
  const defPeriod = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;

  const byGrade = {};
  evals.forEach(e=>{const g=e.grade||"Дүгнэгдээгүй";byGrade[g]=(byGrade[g]||0)+1;});
  const pending = evals.filter(e=>e.status==="Хянаж байна").length;

  tc.innerHTML = `
  <div style="padding:20px 24px">
    ${pending>0&&canApprove?`
    <div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:10px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;gap:10px">
      <span style="font-size:18px">⏳</span>
      <span style="font-weight:600;font-size:13px;color:#92400e">Таны баталгаажуулалт хүлээж буй үнэлгээ: <strong>${pending}</strong></span>
    </div>`:""}
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:20px">
      ${[["⭐","Нийт",evals.length,"#eff6ff","#1d4ed8"],
         ["⏳","Хянаж байна",pending,"#fffbeb","#92400e"],
         ["🏆","Маш сайн (A)",byGrade["A"]||0,"#dcfce7","#15803d"],
         ["✅","Сайн (B)",byGrade["B"]||0,"#fef9c3","#a16207"],
         ["📊","Хангалттай",((byGrade["C"]||0)+(byGrade["D"]||0)),"#fff7ed","#c2410c"],
      ].map(([ic,l,v,bg,c])=>`
        <div style="background:${bg};border-radius:12px;padding:14px 16px;text-align:center">
          <div style="font-size:20px">${ic}</div>
          <div style="font-size:10px;font-weight:700;color:${c};letter-spacing:.05em">${l}</div>
          <div style="font-size:20px;font-weight:800;color:${c}">${v}</div>
        </div>`).join("")}
    </div>

    ${canEdit?`<div style="display:flex;gap:8px;justify-content:flex-end;margin-bottom:12px">
      <button class="btn" onclick="kpiAddEval()">+ Үнэлгээ нэмэх</button>
    </div>`:""}

    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0">
          <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#475569">АЖИЛТАН</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#475569">ХУГАЦАА</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#475569">ТӨРөЛ</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#475569">ОНОО</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#475569">ЗЭРЭГЛЭЛ</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#475569">СТАТУС</th>
          <th style="padding:10px 12px"></th>
        </tr>
      </thead>
      <tbody>
        ${evals.length===0?`<tr><td colspan="7" style="text-align:center;padding:40px;color:#94a3b8">Үнэлгээ бүртгэгдээгүй байна</td></tr>`:
        evals.map((e,i)=>{
          const gradeColor={"A":"#15803d","B":"#a16207","C":"#c2410c","D":"#dc2626"}[e.grade]||"#64748b";
          const gradeBg={"A":"#dcfce7","B":"#fef9c3","C":"#fff7ed","D":"#fef2f2"}[e.grade]||"#f1f5f9";
          const pct = Math.round(e.total_score||0);
          const stMap = {
            "Ноорог":       ["#f1f5f9","#64748b"],
            "Хянаж байна":  ["#fffbeb","#92400e"],
            "Баталгаажсан": ["#dcfce7","#15803d"],
            "Буцаагдсан":   ["#fef2f2","#dc2626"],
          };
          const [stBg,stCl] = stMap[e.status]||["#f1f5f9","#64748b"];
          return `
          <tr style="border-bottom:1px solid #f1f5f9;background:${e.status==="Хянаж байна"?"#fffdf0":(i%2===0?"#fff":"#fafbfc")}">
            <td style="padding:10px 12px">
              <div style="display:flex;align-items:center;gap:6px">
                ${avatarEl(e.full_name||"?",28)}
                <div><div style="font-weight:600;font-size:13px">${escapeHtml(e.full_name||"")}</div>
                <div style="font-size:11px;color:#64748b">${escapeHtml(e.department||"")}</div></div>
              </div>
            </td>
            <td style="padding:10px 12px;font-weight:600;color:#1d4ed8">${e.period||"—"}</td>
            <td style="padding:10px 12px;font-size:12px;color:#475569">${e.period_type}</td>
            <td style="padding:10px 12px">
              <div style="display:flex;align-items:center;gap:6px">
                <div style="flex:1;height:6px;background:#e2e8f0;border-radius:10px;min-width:60px;overflow:hidden">
                  <div style="height:100%;width:${pct}%;background:${pct>=80?"#16a34a":pct>=60?"#ca8a04":"#dc2626"};border-radius:10px"></div>
                </div>
                <span style="font-weight:700;font-size:13px">${pct}%</span>
              </div>
            </td>
            <td style="padding:10px 12px">
              ${e.grade?`<span style="padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700;background:${gradeBg};color:${gradeColor}">${e.grade}</span>`:"—"}
            </td>
            <td style="padding:10px 12px">
              <span style="padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600;background:${stBg};color:${stCl}">${e.status}</span>
              ${e.status==="Буцаагдсан"&&e.reject_note?`<div style="font-size:10px;color:#dc2626;margin-top:2px" title="${escapeHtml(e.reject_note)}">💬 ${escapeHtml(e.reject_note).substring(0,30)}...</div>`:""}
            </td>
            <td style="padding:10px 12px;white-space:nowrap">
              <button class="btn secondary sm" onclick="kpiViewEval(${e.id})">👁</button>
              ${canEdit&&e.status==="Ноорог"?`<button class="btn sm" style="background:#f59e0b;font-size:11px;padding:2px 8px" onclick="kpiSubmitForReview(${e.id})" title="Ерөнхий инженерт хянуулах">📤 Хянуулах</button>`:""}
              ${canApprove&&e.status==="Хянаж байна"?`
                <button class="btn sm" style="background:#16a34a;font-size:11px;padding:2px 8px" onclick="kpiApprove(${e.id})">✅ Батлах</button>
                <button class="btn sm" style="background:#dc2626;font-size:11px;padding:2px 8px" onclick="kpiReject(${e.id})">↩ Буцаах</button>
              `:""}
              ${canEdit&&["Ноорог","Буцаагдсан"].includes(e.status)?`
                <button class="btn secondary sm" onclick="kpiEditEval(${e.id})">✏</button>
                <button class="btn secondary sm" style="color:#dc2626" onclick="kpiDelEval(${e.id})">🗑</button>`:""}
            </td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
  </div>`;
}

function kpiAddEval(prefill={}) {
  document.getElementById("kpiModal")?.remove();
  const isEdit = !!prefill.id;
  let items = prefill.items ? (typeof prefill.items==="string"?JSON.parse(prefill.items):prefill.items) : KPI_CRITERIA.map(c=>({...c,actual:0,score:0}));
  const html = `
  <div id="kpiModal" style="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;display:flex;align-items:center;justify-content:center;overflow-y:auto">
    <div style="background:#fff;border-radius:16px;padding:28px 32px;width:680px;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.25)">
      <div style="font-weight:800;font-size:17px;margin-bottom:20px">${isEdit?"Үнэлгээ засах":"⭐ Гүйцэтгэлийн үнэлгээ нэмэх"}</div>
      <div class="row">
        <div><div class="small muted">Ажилтан *</div>
          <select class="input" id="kpi_user">
            ${_hrUsers.map(u=>`<option value="${u.id}" ${prefill.user_id===u.id?"selected":""}>${escapeHtml(u.full_name)}</option>`).join("")}
          </select></div>
        <div><div class="small muted">Хугацааны төрөл</div>
          <select class="input" id="kpi_ptype" onchange="kpiPeriodTypeChg()">
            ${["Сар","Улирал","Жил"].map(t=>`<option ${(prefill.period_type||"Сар")===t?"selected":""}>${t}</option>`).join("")}
          </select></div>
      </div>
      <div class="row">
        <div><div class="small muted">Хугацаа</div><input class="input" id="kpi_period" value="${prefill.period||""}" placeholder="2026-05"></div>
        <div><div class="small muted">Статус</div>
          <select class="input" id="kpi_status">
            ${["Ноорог","Хянаж байна","Баталгаажсан"].map(s=>`<option ${(prefill.status||"Ноорог")===s?"selected":""}>${s}</option>`).join("")}
          </select></div>
      </div>

      <div style="margin:14px 0 8px;font-weight:700;font-size:13px">📊 Үнэлгээний үзүүлэлтүүд</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px" id="kpiItemsTable">
        <thead><tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0">
          <th style="padding:8px;text-align:left">ҮЗҮҮЛЭЛТ</th>
          <th style="padding:8px;text-align:center;width:70px">ЖИНЛЭХ (%)</th>
          <th style="padding:8px;text-align:center;width:70px">ГҮЙЦЭТГЭЛ (%)</th>
          <th style="padding:8px;text-align:center;width:70px">ОНОО</th>
        </tr></thead>
        <tbody id="kpiItemsBody">
          ${items.map((it,idx)=>`
          <tr style="border-bottom:1px solid #f1f5f9">
            <td style="padding:6px 8px">${escapeHtml(it.name)}</td>
            <td style="padding:6px 8px;text-align:center"><input type="number" min="0" max="100" value="${it.weight||0}" class="input" style="width:55px;padding:2px 6px;font-size:12px;text-align:center" id="kpi_w_${idx}" onchange="kpiCalcScore(${idx})"></td>
            <td style="padding:6px 8px;text-align:center"><input type="number" min="0" max="100" value="${it.actual||0}" class="input" style="width:55px;padding:2px 6px;font-size:12px;text-align:center" id="kpi_a_${idx}" onchange="kpiCalcScore(${idx})"></td>
            <td style="padding:6px 8px;text-align:center;font-weight:700;color:#1d4ed8" id="kpi_s_${idx}">${(((it.actual||0)/100*(it.weight||0))).toFixed(1)}</td>
          </tr>`).join("")}
        </tbody>
        <tfoot>
          <tr style="background:#f8fafc;font-weight:700">
            <td colspan="3" style="padding:8px;text-align:right">Нийт оноо:</td>
            <td style="padding:8px;text-align:center;font-size:15px;color:#1d4ed8" id="kpiTotalScore">
              ${items.reduce((s,it)=>s+(it.actual||0)/100*(it.weight||0),0).toFixed(1)}
            </td>
          </tr>
        </tfoot>
      </table>

      <div class="row" style="margin-top:12px">
        <div><div class="small muted">Зэрэглэл</div>
          <select class="input" id="kpi_grade">
            ${["","A (Маш сайн 90+)","B (Сайн 75-89)","C (Хангалттай 60-74)","D (Хангалтгүй 60-)"].map(g=>`<option value="${g.charAt(0)}" ${(prefill.grade||"")===(g.charAt(0)||"")?"selected":""}>${g||"—"}</option>`).join("")}
          </select></div>
        <div></div>
      </div>
      <div><div class="small muted">Тайлбар / дүгнэлт</div>
        <textarea class="input" id="kpi_comment" rows="2" placeholder="Дүгнэлт...">${escapeHtml(prefill.comment||"")}</textarea></div>
      <input type="hidden" id="kpi_item_count" value="${items.length}">
      <div style="display:flex;gap:8px;margin-top:18px;justify-content:flex-end">
        <button class="btn secondary" onclick="document.getElementById('kpiModal').remove()">Болих</button>
        <button class="btn" onclick="kpiSaveEval(${isEdit?prefill.id:"null"})">Хадгалах</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML("beforeend", html);
}

function kpiCalcScore(idx) {
  const w = Number(document.getElementById("kpi_w_"+idx)?.value||0);
  const a = Number(document.getElementById("kpi_a_"+idx)?.value||0);
  const s = (a/100*w);
  const el = document.getElementById("kpi_s_"+idx);
  if (el) el.textContent = s.toFixed(1);
  const n = Number(document.getElementById("kpi_item_count")?.value||KPI_CRITERIA.length);
  let total = 0;
  for (let i=0;i<n;i++) {
    const wi = Number(document.getElementById("kpi_w_"+i)?.value||0);
    const ai = Number(document.getElementById("kpi_a_"+i)?.value||0);
    total += ai/100*wi;
  }
  const tot = document.getElementById("kpiTotalScore");
  if (tot) tot.textContent = total.toFixed(1);
}

async function kpiSaveEval(id) {
  const userId = document.getElementById("kpi_user")?.value;
  if (!userId) { toast("Ажилтанг сонгоно уу"); return; }
  const n = Number(document.getElementById("kpi_item_count")?.value||KPI_CRITERIA.length);
  const items = [];
  let total = 0;
  for (let i=0;i<n;i++) {
    const w = Number(document.getElementById("kpi_w_"+i)?.value||0);
    const a = Number(document.getElementById("kpi_a_"+i)?.value||0);
    const s = a/100*w;
    total += s;
    const nameEl = document.querySelector(`#kpiItemsBody tr:nth-child(${i+1}) td:first-child`);
    items.push({ name: nameEl?.textContent||KPI_CRITERIA[i]?.name||"", weight:w, actual:a, score:s });
  }
  const grade = document.getElementById("kpi_grade")?.value;
  const body = {
    user_id: Number(userId),
    period: document.getElementById("kpi_period")?.value,
    period_type: document.getElementById("kpi_ptype")?.value,
    items, total_score: total,
    grade, comment: document.getElementById("kpi_comment")?.value.trim(),
    status: document.getElementById("kpi_status")?.value,
  };
  try {
    if (id) await api(`/api/kpi-evaluations/${id}`,{method:"PUT",body:JSON.stringify(body)});
    else await api("/api/kpi-evaluations",{method:"POST",body:JSON.stringify(body)});
    document.getElementById("kpiModal")?.remove();
    toast("Хадгалагдлаа");
    hrRenderEvaluation(document.getElementById("hrSubContent"));
  } catch(e) { toast("Алдаа: "+e.message); }
}

async function kpiEditEval(id) {
  const evals = await api("/api/kpi-evaluations").catch(()=>[]);
  const e = evals.find(x=>x.id===id);
  if (e) kpiAddEval(e);
}

async function kpiViewEval(id) {
  const [evals, approverInfo] = await Promise.all([
    api("/api/kpi-evaluations").catch(()=>[]),
    api(`/api/kpi-evaluations/${id}/approver`).catch(()=>({}))
  ]);
  const e = {...(evals.find(x=>x.id===id)||{}), ...approverInfo};
  if (!e.id) return;
  const items = typeof e.items==="string"?JSON.parse(e.items||"[]"):e.items||[];
  const gradeColor={"A":"#15803d","B":"#a16207","C":"#c2410c","D":"#dc2626"}[e.grade]||"#64748b";
  document.getElementById("kpiViewModal")?.remove();
  const html = `
  <div id="kpiViewModal" style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1001;display:flex;align-items:center;justify-content:center;overflow-y:auto">
    <div style="background:#fff;border-radius:16px;padding:28px 32px;width:560px;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.25)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div>
          <div style="font-weight:800;font-size:16px">${escapeHtml(e.full_name||"")} — Гүйцэтгэлийн үнэлгээ</div>
          <div style="font-size:12px;color:#64748b">${e.period} · ${e.period_type}</div>
        </div>
        <button onclick="document.getElementById('kpiViewModal').remove()" style="background:none;border:none;font-size:20px;color:#94a3b8;cursor:pointer">✕</button>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px">
        <thead><tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0">
          <th style="padding:8px;text-align:left">ҮЗҮҮЛЭЛТ</th>
          <th style="padding:8px;text-align:center">ЖИН</th>
          <th style="padding:8px;text-align:center">ГҮЙЦЭТГЭЛ</th>
          <th style="padding:8px;text-align:center">ОНОО</th>
        </tr></thead>
        <tbody>
          ${items.map(it=>{
            const pct = it.actual||0;
            return `<tr style="border-bottom:1px solid #f1f5f9">
              <td style="padding:8px">${escapeHtml(it.name)}</td>
              <td style="padding:8px;text-align:center">${it.weight}%</td>
              <td style="padding:8px;text-align:center">
                <div style="display:flex;align-items:center;gap:4px">
                  <div style="flex:1;height:5px;background:#e2e8f0;border-radius:10px;overflow:hidden">
                    <div style="height:100%;width:${pct}%;background:${pct>=80?"#16a34a":pct>=60?"#ca8a04":"#dc2626"};border-radius:10px"></div>
                  </div>
                  <span style="font-size:11px;font-weight:600">${pct}%</span>
                </div>
              </td>
              <td style="padding:8px;text-align:center;font-weight:700;color:#1d4ed8">${(it.score||0).toFixed(1)}</td>
            </tr>`;
          }).join("")}
        </tbody>
        <tfoot><tr style="background:#f8fafc;font-weight:700">
          <td colspan="3" style="padding:8px;text-align:right">Нийт оноо:</td>
          <td style="padding:8px;text-align:center;font-size:16px;color:${gradeColor}">${Number(e.total_score||0).toFixed(1)}</td>
        </tr></tfoot>
      </table>
      ${e.grade?`<div style="text-align:center;margin-bottom:12px">
        <span style="font-size:24px;font-weight:800;color:${gradeColor}">${e.grade}</span>
        <span style="font-size:13px;color:#64748b;margin-left:8px">${{"A":"Маш сайн","B":"Сайн","C":"Хангалттай","D":"Хангалтгүй"}[e.grade]||""}</span>
      </div>`:""}
      ${e.comment?`<div style="background:#f8fafc;border-radius:8px;padding:12px;font-size:13px;color:#475569;margin-bottom:12px">${escapeHtml(e.comment)}</div>`:""}
      ${e.status==="Баталгаажсан"&&e.approved_by?`
      <div style="background:#dcfce7;border-radius:8px;padding:12px 14px;display:flex;align-items:center;gap:10px">
        <span style="font-size:20px">✅</span>
        <div>
          <div style="font-weight:700;font-size:12px;color:#15803d">Ерөнхий инженер баталгаажуулсан</div>
          <div style="font-size:11px;color:#166534">${escapeHtml(e.approver_name||"")} · ${e.approved_at||""}</div>
        </div>
      </div>`:e.status==="Буцаагдсан"?`
      <div style="background:#fef2f2;border-radius:8px;padding:12px 14px;display:flex;align-items:center;gap:10px">
        <span style="font-size:20px">↩</span>
        <div>
          <div style="font-weight:700;font-size:12px;color:#dc2626">Буцаагдсан</div>
          ${e.reject_note?`<div style="font-size:11px;color:#991b1b">${escapeHtml(e.reject_note)}</div>`:""}
        </div>
      </div>`:e.status==="Хянаж байна"?`
      <div style="background:#fffbeb;border-radius:8px;padding:12px 14px;display:flex;align-items:center;gap:10px">
        <span style="font-size:20px">⏳</span>
        <div style="font-weight:700;font-size:12px;color:#92400e">Ерөнхий инженерийн баталгаажуулалт хүлээж байна</div>
      </div>`:""}
    </div>
  </div>`;
  document.body.insertAdjacentHTML("beforeend", html);
}

async function kpiDelEval(id) {
  if (!confirm("Үнэлгээ устгах уу?")) return;
  await api(`/api/kpi-evaluations/${id}`,{method:"DELETE"});
  toast("Устгагдлаа");
  hrRenderEvaluation(document.getElementById("hrSubContent"));
}

async function kpiSubmitForReview(id) {
  if (!confirm("Ерөнхий инженерт хянуулахаар илгээх үү?")) return;
  try {
    await api(`/api/kpi-evaluations/${id}/submit`,{method:"PUT"});
    toast("Ерөнхий инженерт илгээгдлаа");
    hrRenderEvaluation(document.getElementById("hrSubContent"));
  } catch(e) { toast("Алдаа: "+e.message); }
}

async function kpiApprove(id) {
  if (!confirm("Үнэлгээг баталгаажуулах уу?")) return;
  try {
    await api(`/api/kpi-evaluations/${id}/approve`,{method:"PUT"});
    toast("Баталгаажлаа ✅");
    hrRenderEvaluation(document.getElementById("hrSubContent"));
  } catch(e) { toast("Алдаа: "+e.message); }
}

function kpiReject(id) {
  document.getElementById("kpiRejectModal")?.remove();
  const html = `
  <div id="kpiRejectModal" style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1002;display:flex;align-items:center;justify-content:center">
    <div style="background:#fff;border-radius:14px;padding:24px 28px;width:400px;box-shadow:0 20px 60px rgba(0,0,0,.25)">
      <div style="font-weight:800;font-size:15px;margin-bottom:12px">↩ Үнэлгээ буцаах</div>
      <div class="small muted" style="margin-bottom:6px">Буцаасан шалтгаан</div>
      <textarea class="input" id="kpiRejectNote" rows="3" placeholder="Засвар хийх шаардлагатай хэсэг, тайлбар..."></textarea>
      <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
        <button class="btn secondary" onclick="document.getElementById('kpiRejectModal').remove()">Болих</button>
        <button class="btn" style="background:#dc2626" onclick="kpiDoReject(${id})">Буцаах</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML("beforeend", html);
}

async function kpiDoReject(id) {
  const note = document.getElementById("kpiRejectNote")?.value.trim();
  try {
    await api(`/api/kpi-evaluations/${id}/reject`,{method:"PUT",body:JSON.stringify({note})});
    document.getElementById("kpiRejectModal")?.remove();
    toast("Буцаагдлаа");
    hrRenderEvaluation(document.getElementById("hrSubContent"));
  } catch(e) { toast("Алдаа: "+e.message); }
}

Object.assign(window, { hrRenderEvaluation, kpiAddEval, kpiCalcScore, kpiSaveEval,
  kpiEditEval, kpiViewEval, kpiDelEval,
  kpiSubmitForReview, kpiApprove, kpiReject, kpiDoReject });

// ══════════════════════════════════════════════════════════════
// ── Tab: Судалгаа (Survey) ─────────────────────────────────────
// ══════════════════════════════════════════════════════════════

let _surveyQuestions = [];

function surveyTemplateAbbd() {
  const rating = ["Бүрэн хангалттай", "Хангалттай", "Дунд", "Хангалтгүй", "Маш хангалтгүй"];
  return {
    title: "Ажлын байрны бэлгийн дарамттай холбоотой санал асуумж",
    type: "АББД судалгаа",
    status: "Идэвхтэй",
    anonymous: 1,
    description: "Байгууллага нийт ажилтанд ажлын байрны бэлгийн дарамт, хүчирхийллээс ангид орчны баталгааг хангах зорилгоор нууцлалтай санал асуумж авч байна.",
    questions: [
      { text: "Таны хүйс", type: "Нэг сонголт", options: ["Эрэгтэй", "Эмэгтэй", "Хариулахгүй"] },
      { text: "Нас", type: "Текст", options: [] },
      { text: "АББД-д дараах үйлдлүүд багтах ба эдгээр үйлдлээс аль нь танд тохиолдож байсан бэ? /хэдэн ч хариултыг сонгож болно/", type: "Олон сонголт", options: [
        "Хүсээгүй байхад биед хүрэх, илэх, барих",
        "Бэлгийн сэдэлтэй яриа гаргах, үүсгэх",
        "Бэлгийн шинжтэй зурагт хуудас, фото зураг, бичлэг үзүүлэх",
        "Хамтран ажиллагчаас бэлгийн хандлагын талаар асуух",
        "Ажлын бус цагаар хамт ажиллагч руу яриа, и-мэйл, мессеж илгээх",
        "Албан тушаал дэвших боломж амлан бэлгийн шинжтэй үйлдэл хийхийг шаардах",
        "Ажлын нөхцөл сайжруулах болзол тавьж хүчээр болзохыг шаардах",
        "Тохиолдож байгаагүй",
        "Бусад"
      ] },
      { text: "Хэзээ тохиолдсон бэ?", type: "Нэг сонголт", options: ["Сүүлийн өдрүүдэд /30-аас доош хоног/", "Сүүлийн саруудад", "1-2 жилд", "2-оос дээш жилд", "Тохиолдож байгаагүй"] },
      { text: "АББД үйлдэгч хэн байсан бэ?", type: "Нэг сонголт", options: ["Дарга", "Дээд удирдлагын албан тушаалтан", "Хамтран ажиллагч", "Хариулахгүй", "Бусад"] },
      { text: "АББД-д өртсөний дараа ямар хариу арга хэмжээ авсан бэ?", type: "Олон сонголт", options: [
        "Хаана хандахаа мэдээгүй тул гомдол гаргаагүй",
        "Ажлаасаа халагдах байх гэсэн айдастай байсан тул гомдол гаргаагүй",
        "Бэлгийн хүчирхийлэл үйлдэгч этгээдийн дарамт шахалт, сүрдүүлгээс эмээсэн тул гомдол гаргаагүй",
        "Өөрийн ажил, албаны нэр хүндийг харгалзан гомдол гаргаагүй",
        "Өөрийн гэр бүлийн нэр хүнд, гэр бүлийн зөрчлөөс эмээн гомдол гаргаагүй",
        "Холбогдох байгууллагад гомдол гаргаж шийдвэрлүүлсэн",
        "Тохиолдож байгаагүй",
        "Бусад"
      ] },
      { text: "АББД-тай тэмцэх, түүнээс урьдчилан сэргийлэх чиглэлээр байгууллагаас ямар арга хэмжээ авсан бэ?", type: "Текст", options: [] },
      { text: "Жендерийн ялгаварлан гадуурхалт, АББД, түүнээс урьдчилан сэргийлэх чиглэлээр байгууллагаас авч хэрэгжүүлж байгаа сургалт, нөлөөллийн ажлын чанар, хүртээмжийн талаар үнэлгээ өгнө үү.", type: "Нэг сонголт", options: rating },
    ]
  };
}

function surveyTemplateEngagementMatrix() {
  return {
    title: "Ажилтны санал, сэтгэл ханамжийн асуумж",
    type: "Үнэлгээний судалгаа",
    status: "Идэвхтэй",
    anonymous: 1,
    description: "Байгууллагын дотоод орчин, хамтын ажиллагаа, удирдлага, ажлын нөхцөлийн талаар нууцлалтай санал авч байна.",
    questions: [
      {
        text: "Та дараах үзүүлэлтүүдэд 1-5 оноогоор үнэлгээ өгнө үү.",
        type: "Матриц (1-5)",
        options: [
          "Би өөрийн ажлын байрны нөхцөлд сэтгэл хангалуун байдаг.",
          "Байгууллагаас ажил үүргээ гүйцэтгэхэд шаардлагатай тоног төхөөрөмж, хэрэгслээр хангадаг.",
          "Миний ажлын үнэлгээ шударга, урамшуулал нь ажлын гүйцэтгэлтэй нийцдэг гэж үздэг.",
          "Миний хөдөлмөрийг удирдлага үнэлж, дэмждэг.",
          "Хамт олны харилцаа, уур амьсгал эерэг байдаг.",
          "Байгууллагын дотоод мэдээлэл, харилцаа ойлгомжтой байдаг.",
          "Байгууллагын соёл, ёс зүйн орчин надад таатай санагддаг.",
          "Мэргэжлийн ур чадвараа хөгжүүлэх боломж хангалттай байдаг.",
          "Би байгууллагынхаа ирээдүйн хөгжилд итгэлтэй байдаг.",
          "Ерөнхийдөө би өөрийн ажил болон байгууллагадаа сэтгэл хангалуун байдаг."
        ]
      },
      { text: "Нэмэлт санал хүсэлт байвал бичнэ үү.", type: "Текст", options: [] }
    ]
  };
}

function surveyTemplateImageEngagement(imageUrl="") {
  const data = surveyTemplateEngagementMatrix();
  data.title = "Ажлын байрны сэтгэл ханамжийн судалгаа";
  data.type = "Сэтгэл ханамж";
  data.description = "Ажилчдын сэтгэл ханамж, ажлын орчин, удирдлага, хамт олон, хөгжлийн боломжийн талаарх нууцлалтай асуумж.";
  data.questions = [
    {
      ...data.questions[0],
      text: "Доорх зураг болон үзүүлэлтүүдийн дагуу 1-5 оноогоор үнэлгээ өгнө үү.",
      image_url: imageUrl || ""
    },
    { text: "Байгууллагын үйл ажиллагаанд хамгийн түрүүнд сайжруулах шаардлагатай зүйл юу вэ?", type: "Текст", options: [], image_url: "" },
    { text: "Таны сэтгэл ханамжийг нэмэгдүүлэх хамгийн чухал санал юу вэ?", type: "Текст", options: [], image_url: "" },
    { text: "Удирдлага болон байгууллагад өгөх нэмэлт санал байвал бичнэ үү.", type: "Текст", options: [], image_url: "" }
  ];
  return data;
}

function surveyTemplateTrainingNeeds() {
  return {
    title: "Сургалтын хэрэгцээ тодорхойлох асуумж",
    type: "Дотоод санал асуулга",
    status: "Идэвхтэй",
    anonymous: 1,
    description: "Ажилтнуудын мэдлэг, ур чадвар хөгжүүлэх хэрэгцээг тодорхойлох зорилготой асуумж.",
    questions: [
      { text: "Танд ойрын 6 сард ямар чиглэлийн сургалт хамгийн хэрэгтэй вэ?", type: "Олон сонголт", options: ["Мэргэжлийн ур чадвар", "ХАБЭА", "Компьютер / программ", "Харилцаа, багаар ажиллах", "Удирдлага, манлайлал", "Бусад"] },
      { text: "Сургалтын хэлбэрийн хувьд аль нь тохиромжтой вэ?", type: "Нэг сонголт", options: ["Танхим", "Онлайн", "Ажлын байран дээр", "Хосолсон"] },
      { text: "Сургалтад хамрагдахад тохиромжтой хугацаа?", type: "Нэг сонголт", options: ["Ажлын өдөр", "Амралтын өдөр", "Өглөө", "Өдөр", "Орой"] },
      { text: "Нэмэлт санал, хэрэгцээ байвал бичнэ үү.", type: "Текст", options: [] }
    ]
  };
}

function surveyTemplateWorkEnvironment() {
  return {
    title: "Ажлын орчин, аюулгүй байдлын үнэлгээ",
    type: "Ажлын орчны судалгаа",
    status: "Идэвхтэй",
    anonymous: 1,
    description: "Ажлын байрны орчин, аюулгүй ажиллагаа, тоног төхөөрөмжийн хүрэлцээг үнэлэх асуумж.",
    questions: [
      {
        text: "Дараах үзүүлэлтүүдийг 1-5 оноогоор үнэлнэ үү.",
        type: "Матриц (1-5)",
        options: [
          "Ажлын байрны гэрэлтүүлэг хангалттай.",
          "Ажлын байрны цэвэрлэгээ, эмх цэгц сайн.",
          "Аюулгүй ажиллагааны зааварчилгаа ойлгомжтой.",
          "Хамгаалах хэрэгсэл хүртээмжтэй.",
          "Ажил үүргээ гүйцэтгэх тоног төхөөрөмж хангалттай.",
          "Ажлын байрны эрсдэлийг мэдээлэх боломж нээлттэй."
        ]
      },
      { text: "Сайжруулах шаардлагатай хамгийн чухал зүйл юу вэ?", type: "Текст", options: [] }
    ]
  };
}

function surveyUseTemplate(key) {
  if (key === "abbd") surveyAdd(surveyTemplateAbbd());
  if (key === "engagement") surveyAdd(surveyTemplateEngagementMatrix());
  if (key === "training") surveyAdd(surveyTemplateTrainingNeeds());
  if (key === "environment") surveyAdd(surveyTemplateWorkEnvironment());
}

function surveyIsMatrix(q) {
  return q?.type === "Матриц (1-5)";
}

function surveyMatrixRows(q) {
  return (q?.options || []).filter(Boolean);
}

function surveyMatrixFillHtml(q, i, prefix="sfq") {
  const rows = surveyMatrixRows(q);
  const scale = [
    [1, "Маш хангалтгүй"],
    [2, "Хангалтгүй"],
    [3, "Дунд"],
    [4, "Хангалттай"],
    [5, "Маш сайн"],
  ];
  return `
    <div style="overflow-x:auto;border:1px solid #dbeafe;border-radius:10px;background:#fff">
      <table style="width:100%;border-collapse:collapse;min-width:560px;font-size:12px">
        <thead>
          <tr style="background:#2563eb;color:#fff">
            <th style="padding:8px;text-align:center;width:42px">№</th>
            <th style="padding:8px;text-align:left">Асуулт</th>
            ${scale.map(([n])=>`<th style="padding:8px;text-align:center;width:54px">${n}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${rows.map((row, ri)=>`
            <tr style="border-top:1px solid #e2e8f0">
              <td style="padding:8px;text-align:center;font-weight:700;color:#2563eb">${ri+1}</td>
              <td style="padding:8px;line-height:1.35">${escapeHtml(row)}</td>
              ${scale.map(([n, label])=>`
                <td style="padding:8px;text-align:center">
                  <input type="radio" name="${prefix}_${i}_${ri}" value="${n}" title="${label}" style="width:16px;height:16px;accent-color:#2563eb">
                </td>`).join("")}
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:4px;margin-top:8px;font-size:10px;color:#64748b">
      ${scale.map(([n, label])=>`<div><b>${n}</b> ${label}</div>`).join("")}
    </div>`;
}

function surveyMatrixAnswer(i, q, prefix="sfq") {
  const out = {};
  surveyMatrixRows(q).forEach((row, ri) => {
    const checked = document.querySelector(`input[name="${prefix}_${i}_${ri}"]:checked`);
    if (checked) out[row] = checked.value;
  });
  return out;
}

function surveyFormatAnswer(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value).map(([k,v]) => `${k}: ${v}`).join("; ");
  }
  return Array.isArray(value) ? value.join("; ") : (value ?? "");
}

function surveyConclusionLevel(avg) {
  if (avg >= 4) return { label: "Сайн", color: "#16a34a", note: "давуу тал болгон хадгалах боломжтой" };
  if (avg >= 3) return { label: "Дунд", color: "#d97706", note: "сайжруулах төлөвлөгөө хэрэгтэй" };
  if (avg >= 2) return { label: "Анхаарах", color: "#ea580c", note: "ойрын хугацаанд арга хэмжээ шаардлагатай" };
  return { label: "Эрсдэлтэй", color: "#dc2626", note: "яаралтай арга хэмжээ авах шаардлагатай" };
}

function surveyBuildConclusion(qs, responses) {
  const parsedRows = responses.map(r => {
    try { return typeof r.answers === "string" ? JSON.parse(r.answers || "{}") : (r.answers || {}); }
    catch { return {}; }
  });
  const metrics = [];
  const choices = [];
  const texts = [];

  qs.forEach((q, i) => {
    const ans = parsedRows.map(a => a[i]).filter(v => v != null && v !== "");
    if (surveyIsMatrix(q)) {
      surveyMatrixRows(q).forEach(row => {
        const vals = ans.map(a => Number(a?.[row])).filter(Number.isFinite);
        if (!vals.length) return;
        metrics.push({
          label: row,
          question: q.text,
          avg: vals.reduce((s,v)=>s+v,0) / vals.length,
          count: vals.length,
        });
      });
      return;
    }
    if (q.type === "Оноо (1-5)") {
      const vals = ans.map(Number).filter(Number.isFinite);
      if (vals.length) metrics.push({
        label: q.text,
        question: q.text,
        avg: vals.reduce((s,v)=>s+v,0) / vals.length,
        count: vals.length,
      });
      return;
    }
    if (q.type === "Текст") {
      const vals = ans.map(v => String(v || "").trim()).filter(Boolean);
      if (vals.length) texts.push({ question: q.text, answers: vals });
      return;
    }
    const counts = {};
    ans.forEach(a => {
      const vals = Array.isArray(a) ? a : [a];
      vals.map(v => String(v || "").trim()).filter(Boolean).forEach(v => { counts[v] = (counts[v] || 0) + 1; });
    });
    const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]);
    if (sorted.length) choices.push({ question: q.text, top: sorted[0], total: ans.length });
  });

  const overall = metrics.length ? metrics.reduce((s,m)=>s+m.avg,0) / metrics.length : 0;
  const strongest = [...metrics].sort((a,b)=>b.avg-a.avg).slice(0,3);
  const weakest = [...metrics].sort((a,b)=>a.avg-b.avg).slice(0,3);
  const level = metrics.length ? surveyConclusionLevel(overall) : null;
  return { total: responses.length, overall, level, metrics, strongest, weakest, choices, texts };
}

function surveyConclusionHtml(qs, responses) {
  const c = surveyBuildConclusion(qs, responses);
  if (!c.total) {
    return `<div id="surveyConclusionPanel" style="display:none;background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:14px;margin-bottom:14px;color:#92400e;font-size:13px">Одоогоор хариулт ирээгүй байна.</div>`;
  }
  const levelHtml = c.level ? `<span style="color:${c.level.color};font-weight:900">${c.level.label}</span>` : `<span style="color:#64748b;font-weight:900">Тоон үнэлгээ алга</span>`;
  const recommendation = c.weakest.length
    ? `Нэн түрүүнд "${escapeHtml(c.weakest[0].label)}" үзүүлэлтийг сайжруулах арга хэмжээ төлөвлөх нь зүйтэй.`
    : `Текст санал болон сонголтын давамгай хариултад үндэслэн сайжруулах чиглэл тодорхойлно.`;
  return `
  <div id="surveyConclusionPanel" style="display:none;background:#f8fafc;border:1px solid #dbeafe;border-radius:12px;padding:14px;margin-bottom:14px">
    <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px">
      <div style="font-weight:900;color:#0f172a">🧠 Автомат дүгнэлт</div>
      <div style="font-size:12px;color:#64748b">Нийт ${c.total} хариулт</div>
    </div>
    ${c.metrics.length ? `
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin-bottom:10px">
        <div style="font-size:12px;color:#64748b;margin-bottom:4px">Нийт дундаж</div>
        <div style="font-size:24px;font-weight:900;color:#1d4ed8">${c.overall.toFixed(1)} <span style="font-size:13px;color:#64748b">/ 5</span> · ${levelHtml}</div>
        <div style="font-size:12px;color:#64748b;margin-top:4px">${escapeHtml(c.level?.note || "")}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
        <div style="background:#fff;border:1px solid #bbf7d0;border-radius:10px;padding:10px">
          <div style="font-size:12px;font-weight:900;color:#15803d;margin-bottom:6px">Давуу үзүүлэлт</div>
          ${c.strongest.map(x=>`<div style="font-size:12px;color:#334155;margin-bottom:5px">${escapeHtml(x.label)} <b>${x.avg.toFixed(1)}</b></div>`).join("")}
        </div>
        <div style="background:#fff;border:1px solid #fed7aa;border-radius:10px;padding:10px">
          <div style="font-size:12px;font-weight:900;color:#c2410c;margin-bottom:6px">Сайжруулах үзүүлэлт</div>
          ${c.weakest.map(x=>`<div style="font-size:12px;color:#334155;margin-bottom:5px">${escapeHtml(x.label)} <b>${x.avg.toFixed(1)}</b></div>`).join("")}
        </div>
      </div>` : ""}
    ${c.choices.length ? `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px;margin-bottom:10px">
      <div style="font-size:12px;font-weight:900;color:#334155;margin-bottom:6px">Сонголтын давамгай хариулт</div>
      ${c.choices.slice(0,4).map(x=>`<div style="font-size:12px;color:#475569;margin-bottom:5px">${escapeHtml(x.question)}: <b>${escapeHtml(x.top[0])}</b> (${x.top[1]})</div>`).join("")}
    </div>` : ""}
    ${c.texts.length ? `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px;margin-bottom:10px">
      <div style="font-size:12px;font-weight:900;color:#334155;margin-bottom:6px">Текст саналын жишээ</div>
      ${c.texts.slice(0,3).map(x=>`<div style="font-size:12px;color:#475569;margin-bottom:6px"><b>${escapeHtml(x.question)}</b><br>${x.answers.slice(0,2).map(a=>`<span style="display:block;border-left:3px solid #2563eb;padding-left:7px;margin-top:4px">${escapeHtml(a).slice(0,180)}</span>`).join("")}</div>`).join("")}
    </div>` : ""}
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:10px;font-size:12px;color:#1e3a8a">
      <b>Зөвлөмж:</b> ${recommendation}
    </div>
  </div>`;
}

function surveyToggleConclusion() {
  const panel = document.getElementById("surveyConclusionPanel");
  if (!panel) return;
  panel.style.display = panel.style.display === "none" ? "block" : "none";
}

function surveyQuestionImageHtml(q) {
  const url = String(q?.image_url || "").trim();
  if (!url) return "";
  return `<div style="margin:8px 0 12px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
    <img src="${escapeHtml(url)}" alt="Асуултын зураг" style="width:100%;max-height:260px;object-fit:contain;display:block;background:#f8fafc">
  </div>`;
}

function surveyUploadErrorMessage(res, data, fallback="Зураг upload хийхэд алдаа гарлаа") {
  if (data?.error) return data.error;
  if (res.status === 404) return "Зураг upload API олдсонгүй. Server restart хийгээд дахин оролдоно уу.";
  if (res.status === 401) return "Нэвтрэх token дууссан байна. Дахин нэвтэрнэ үү.";
  if (res.status === 403) return "Зураг upload хийх эрх хүрэхгүй байна.";
  if (res.status === 413) return "Зургийн хэмжээ хэтэрсэн байна. 10MB-аас бага зураг сонгоно уу.";
  return `${fallback} (${res.status})`;
}

async function hrRenderSurvey(tc) {
  if (!tc) tc = document.getElementById("hrSubContent") || document.getElementById("hrTabContent");
  if (!tc) return;
  const canEdit = ["director","hr"].includes(state.me.role);
  const surveys = await api("/api/surveys").catch(()=>[]);
  const active = surveys.filter(s=>s.status==="Идэвхтэй").length;

  tc.innerHTML = `
  <div style="padding:20px 24px">
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px">
      ${[["📝","Нийт судалгаа",surveys.length,"#eff6ff","#1d4ed8"],
         ["✅","Идэвхтэй",active,"#dcfce7","#15803d"],
         ["📊","Дууссан",surveys.length-active,"#f8fafc","#64748b"],
      ].map(([ic,l,v,bg,c])=>`
        <div style="background:${bg};border-radius:12px;padding:14px 16px;text-align:center">
          <div style="font-size:20px">${ic}</div>
          <div style="font-size:10px;font-weight:700;color:${c};letter-spacing:.05em">${l}</div>
          <div style="font-size:20px;font-weight:800;color:${c}">${v}</div>
        </div>`).join("")}
    </div>
    ${canEdit?`<div style="display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      <button class="btn secondary" onclick="surveyEmployeePortalQr()">👥 Ажилчдын QR/линк</button>
      <button class="btn" onclick="surveyQuickImageEngagement()">🖼 Зурагтай асуумж</button>
      <button class="btn secondary" onclick="surveyUseTemplate('abbd')">📋 АББД загвараас үүсгэх</button>
      <button class="btn secondary" onclick="surveyUseTemplate('engagement')">📊 Матриц загвараас үүсгэх</button>
      <button class="btn secondary" onclick="surveyUseTemplate('training')">🎓 Сургалтын хэрэгцээ</button>
      <button class="btn secondary" onclick="surveyUseTemplate('environment')">🦺 Ажлын орчин</button>
      <button class="btn" onclick="surveyAdd()">+ Судалгаа үүсгэх</button>
    </div>`:""}
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px">
      ${surveys.length===0?`<div style="grid-column:1/-1;text-align:center;padding:48px;color:#94a3b8"><div style="font-size:32px">📝</div>Судалгаа бүртгэгдээгүй байна</div>`:
      surveys.map(s=>{
        const qs = typeof s.questions==="string"?JSON.parse(s.questions||"[]"):s.questions||[];
        const isActive = s.status==="Идэвхтэй";
        return `
        <div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:18px;box-shadow:0 1px 4px rgba(0,0,0,.06)">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
            <div style="font-weight:700;font-size:14px">${escapeHtml(s.title)}</div>
            <span style="padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600;
              background:${isActive?"#dcfce7":"#f1f5f9"};color:${isActive?"#15803d":"#64748b"}">${s.status}</span>
          </div>
          <div style="font-size:12px;color:#475569;margin-bottom:6px">📋 ${s.type} · ${qs.length} асуулт</div>
          ${s.deadline?`<div style="font-size:12px;color:#64748b">📅 Дуусах: ${s.deadline}</div>`:""}
          ${s.description?`<div style="font-size:12px;color:#64748b;margin-top:8px;border-top:1px solid #f1f5f9;padding-top:8px">${escapeHtml(s.description).substring(0,100)}...</div>`:""}
          <div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap">
            ${isActive?`<button class="btn sm" onclick="surveyFill(${s.id},'${escapeHtml(s.title)}')">✍ Бөглөх</button>`:""}
            ${canEdit?`<button class="btn secondary sm" onclick="surveyViewResults(${s.id},'${escapeHtml(s.title)}')">📊 Үр дүн</button>`:""}
            ${canEdit?`<button class="btn secondary sm" onclick="surveyQr(${s.id})">🔗 QR/линк</button>
            <button class="btn secondary sm" onclick="surveyDownloadCsv(${s.id})">⬇ CSV</button>`:""}
            ${canEdit?`<button class="btn secondary sm" onclick="surveyEdit(${s.id})">✏</button>
            <button class="btn secondary sm" style="color:#dc2626" onclick="surveyDel(${s.id},'${escapeHtml(s.title)}')">🗑</button>`:""}
          </div>
        </div>`;
      }).join("")}
    </div>
  </div>`;
}

function surveyAdd(data={}) {
  _surveyQuestions = data.questions ? (typeof data.questions==="string"?JSON.parse(data.questions):data.questions) : [];
  document.getElementById("surveyModal")?.remove();
  const isEdit = !!data.id;
  const html = `
  <div id="surveyModal" style="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;display:flex;align-items:center;justify-content:center;overflow-y:auto">
    <div style="background:#fff;border-radius:16px;padding:28px 32px;width:600px;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.25)">
      <div style="font-weight:800;font-size:17px;margin-bottom:20px">${isEdit?"Судалгаа засах":"📝 Судалгаа нэмэх"}</div>
      <div class="row">
        <div><div class="small muted">Судалгааны нэр *</div><input class="input" id="sv_title" value="${escapeHtml(data.title||"")}" placeholder="Нэр..."></div>
        <div><div class="small muted">Төрөл</div>
          <select class="input" id="sv_type">
            ${["Сэтгэл ханамж","Дотоод санал асуулга","Үнэлгээний судалгаа","Ажлын орчны судалгаа","АББД судалгаа"].map(t=>`<option ${(data.type||"Сэтгэл ханамж")===t?"selected":""}>${t}</option>`).join("")}
          </select></div>
      </div>
      <div class="row">
        <div><div class="small muted">Дуусах огноо</div><input class="input" id="sv_deadline" type="date" value="${data.deadline||""}"></div>
        <div><div class="small muted">Статус</div>
          <select class="input" id="sv_status">
            ${["Идэвхтэй","Хаагдсан"].map(s=>`<option ${(data.status||"Идэвхтэй")===s?"selected":""}>${s}</option>`).join("")}
          </select></div>
      </div>
      <div><div class="small muted">Тайлбар</div>
        <textarea class="input" id="sv_desc" rows="2" placeholder="...">${escapeHtml(data.description||"")}</textarea></div>
      <div style="margin:14px 0 8px;display:flex;justify-content:space-between;align-items:center">
        <div style="font-weight:700;font-size:13px">❓ Асуултууд</div>
        <button class="btn secondary sm" onclick="surveyAddQuestion()">+ Асуулт нэмэх</button>
      </div>
      <div id="svQuestionList" style="display:flex;flex-direction:column;gap:8px">
        ${_surveyQuestions.map((q,i)=>surveyQuestionHtml(q,i)).join("")}
      </div>
      <div style="display:flex;gap:8px;margin-top:18px;justify-content:flex-end">
        <button class="btn secondary" onclick="document.getElementById('surveyModal').remove()">Болих</button>
        <button class="btn" onclick="surveySave(${isEdit?data.id:"null"})">Хадгалах</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML("beforeend", html);
}

function surveyQuestionHtml(q, idx) {
  const needsOptions = q.type === "Нэг сонголт" || q.type === "Олон сонголт" || surveyIsMatrix(q);
  const options = (q.options && q.options.length ? q.options : [""]).map((opt, oi) => `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <span style="font-size:13px;color:#64748b">${surveyIsMatrix(q) ? "№" : (q.type==="Олон сонголт" ? "☑" : "○")}</span>
      <input class="input svq-option" data-q="${idx}" value="${escapeHtml(opt)}" placeholder="${surveyIsMatrix(q) ? "Matrix мөрийн асуулт..." : "Сонголт..."}" style="font-size:12px;flex:1">
      <button type="button" onclick="surveyRemoveOption(${idx},${oi})" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:14px">✕</button>
    </div>`).join("");
  return `
  <div style="background:#f8fafc;border-radius:8px;padding:10px 12px;border:1px solid #e2e8f0">
    <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
      <span style="font-size:11px;font-weight:700;color:#64748b;min-width:20px">${idx+1}.</span>
      <input class="input" id="svq_text_${idx}" value="${escapeHtml(q.text||"")}" placeholder="Асуултын текст..." style="flex:1;font-size:12px">
      <select class="input" id="svq_type_${idx}" onchange="surveyRefreshQuestions()" style="width:140px;font-size:12px">
        ${["Нэг сонголт","Олон сонголт","Текст","Оноо (1-5)","Матриц (1-5)"].map(t=>`<option ${(q.type||"Нэг сонголт")===t?"selected":""}>${t}</option>`).join("")}
      </select>
      <button onclick="surveyRemoveQuestion(${idx})" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:16px">✕</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr auto auto;gap:6px;align-items:center;margin:8px 0">
      <input class="input" id="svq_image_${idx}" value="${escapeHtml(q.image_url||"")}" placeholder="Зургийн URL эсвэл upload хийнэ..." style="font-size:12px">
      <input type="file" id="svq_image_file_${idx}" accept="image/*" style="display:none" onchange="surveyUploadQuestionImage(${idx},this)">
      <button type="button" class="btn secondary sm" onclick="document.getElementById('svq_image_file_${idx}')?.click()">🖼 Зураг</button>
      <button type="button" class="btn secondary sm" onclick="surveyClearQuestionImage(${idx})">Арилгах</button>
    </div>
    ${q.image_url ? surveyQuestionImageHtml(q) : ""}
    ${needsOptions ? `
    <div style="font-size:11px;color:#64748b;margin-bottom:6px">${surveyIsMatrix(q) ? "Matrix мөрүүд" : "Сонголтууд"}</div>
    <div id="svq_opts_${idx}">${options}</div>
    <button type="button" class="btn secondary sm" onclick="surveyAddOption(${idx})">+ ${surveyIsMatrix(q) ? "Мөр нэмэх" : "Сонголт нэмэх"}</button>`:""}
  </div>`;
}

function surveyAddQuestion() {
  _surveyQuestions.push({ text:"", type:"Нэг сонголт", options:[] });
  const list = document.getElementById("svQuestionList");
  if (list) {
    const idx = _surveyQuestions.length-1;
    list.insertAdjacentHTML("beforeend", surveyQuestionHtml(_surveyQuestions[idx], idx));
  }
}

function surveyRemoveQuestion(idx) {
  _surveyQuestions.splice(idx,1);
  const list = document.getElementById("svQuestionList");
  if (list) list.innerHTML = _surveyQuestions.map((q,i)=>surveyQuestionHtml(q,i)).join("");
}

function surveySyncQuestionDrafts() {
  _surveyQuestions = surveyGatherQuestions();
}

function surveyAddOption(idx) {
  surveySyncQuestionDrafts();
  _surveyQuestions[idx].options = _surveyQuestions[idx].options || [];
  _surveyQuestions[idx].options.push("");
  const list = document.getElementById("svQuestionList");
  if (list) list.innerHTML = _surveyQuestions.map((q,i)=>surveyQuestionHtml(q,i)).join("");
}

function surveyRemoveOption(idx, optIdx) {
  surveySyncQuestionDrafts();
  _surveyQuestions[idx].options = (_surveyQuestions[idx].options || []).filter((_, i) => i !== optIdx);
  if (!_surveyQuestions[idx].options.length) _surveyQuestions[idx].options = [""];
  const list = document.getElementById("svQuestionList");
  if (list) list.innerHTML = _surveyQuestions.map((q,i)=>surveyQuestionHtml(q,i)).join("");
}

function surveyRefreshQuestions() {
  _surveyQuestions = surveyGatherQuestions();
  const list = document.getElementById("svQuestionList");
  if (list) list.innerHTML = _surveyQuestions.map((q,i)=>surveyQuestionHtml(q,i)).join("");
}

function surveyGatherQuestions() {
  const n = _surveyQuestions.length;
  return _surveyQuestions.map((_,i)=>{
    const text = document.getElementById("svq_text_"+i)?.value.trim()||"";
    const type = document.getElementById("svq_type_"+i)?.value||"Нэг сонголт";
    const image_url = document.getElementById("svq_image_"+i)?.value.trim()||"";
    const options = [...document.querySelectorAll(`.svq-option[data-q="${i}"]`)]
      .map(el => el.value.trim())
      .filter(Boolean);
    return { text, type, options, image_url };
  });
}

async function surveyUploadQuestionImage(idx, input) {
  const file = input?.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) { toast("Зөвхөн зураг файл сонгоно уу"); input.value = ""; return; }
  if (file.size > 10 * 1024 * 1024) { toast("Зургийн хэмжээ 10MB-аас бага байна"); input.value = ""; return; }
  const fd = new FormData();
  fd.append("image", file);
  try {
    const res = await fetch("/api/surveys/image", {
      method: "POST",
      headers: { Authorization: "Bearer " + (state.token || localStorage.getItem("token") || "") },
      body: fd
    });
    const data = await res.json().catch(()=>({}));
    if (!res.ok) throw new Error(surveyUploadErrorMessage(res, data));
    const el = document.getElementById("svq_image_"+idx);
    if (el) el.value = data.url || "";
    surveyRefreshQuestions();
    toast("Зураг нэмэгдлээ");
  } catch(e) {
    toast("Алдаа: " + e.message);
  } finally {
    input.value = "";
  }
}

function surveyClearQuestionImage(idx) {
  const el = document.getElementById("svq_image_"+idx);
  if (el) el.value = "";
  surveyRefreshQuestions();
}

function surveyQuickImageEngagement() {
  document.getElementById("surveyQuickImageModal")?.remove();
  document.body.insertAdjacentHTML("beforeend", `
    <div id="surveyQuickImageModal" style="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1003;display:flex;align-items:center;justify-content:center;padding:18px">
      <div style="background:#fff;border-radius:16px;padding:24px;width:min(520px,96vw);box-shadow:0 20px 60px rgba(0,0,0,.25)">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:16px">
          <div>
            <div style="font-weight:800;font-size:17px">🖼 Зурагтай сэтгэл ханамжийн асуумж</div>
            <div style="font-size:12px;color:#64748b;margin-top:5px">Зургаа оруулаад шууд ажилчид бөглөх QR/линк гаргана.</div>
          </div>
          <button onclick="document.getElementById('surveyQuickImageModal').remove()" style="background:none;border:none;font-size:20px;color:#94a3b8;cursor:pointer">✕</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <div>
            <div class="small muted">Судалгааны нэр</div>
            <input class="input" id="sq_title" value="Ажлын байрны сэтгэл ханамжийн судалгаа">
          </div>
          <div>
            <div class="small muted">Дуусах огноо /заавал биш/</div>
            <input class="input" id="sq_deadline" type="date">
          </div>
          <div>
            <div class="small muted">Зураг</div>
            <input class="input" id="sq_image" type="file" accept="image/*">
            <div style="font-size:11px;color:#64748b;margin-top:6px">JPG, PNG, WEBP зураг. 10MB-аас бага байна.</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:18px;justify-content:flex-end;flex-wrap:wrap">
          <button class="btn secondary" onclick="document.getElementById('surveyQuickImageModal').remove()">Болих</button>
          <button class="btn" id="sqCreateBtn" onclick="surveyCreateQuickImageEngagement()">Үүсгээд QR гаргах</button>
        </div>
      </div>
    </div>`);
}

async function surveyUploadStandaloneImage(file) {
  if (!file) throw new Error("Зураг сонгоно уу");
  if (!file.type.startsWith("image/")) throw new Error("Зөвхөн зураг файл сонгоно уу");
  if (file.size > 10 * 1024 * 1024) throw new Error("Зургийн хэмжээ 10MB-аас бага байна");
  const fd = new FormData();
  fd.append("image", file);
  const res = await fetch("/api/surveys/image", {
    method: "POST",
    headers: { Authorization: "Bearer " + (state.token || localStorage.getItem("token") || "") },
    body: fd
  });
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(surveyUploadErrorMessage(res, data));
  return data.url || "";
}

async function surveyCreateQuickImageEngagement() {
  const btn = document.getElementById("sqCreateBtn");
  const oldText = btn?.textContent || "Үүсгээд QR гаргах";
  try {
    if (btn) { btn.disabled = true; btn.textContent = "Үүсгэж байна..."; }
    const title = document.getElementById("sq_title")?.value.trim() || "Ажлын байрны сэтгэл ханамжийн судалгаа";
    const deadline = document.getElementById("sq_deadline")?.value || "";
    const file = document.getElementById("sq_image")?.files?.[0];
    const imageUrl = await surveyUploadStandaloneImage(file);
    const body = surveyTemplateImageEngagement(imageUrl);
    body.title = title;
    body.deadline = deadline;
    const created = await api("/api/surveys", { method:"POST", body:JSON.stringify(body) }).catch(e => {
      throw new Error("Судалгаа үүсгэхэд алдаа гарлаа: " + e.message);
    });
    document.getElementById("surveyQuickImageModal")?.remove();
    toast("Зурагтай асуумж үүслээ");
    await hrRenderSurvey(document.getElementById("hrSubContent"));
    if (created?.id) surveyQr(created.id);
  } catch(e) {
    toast("Алдаа: " + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = oldText; }
  }
}

async function surveySave(id) {
  const title = document.getElementById("sv_title")?.value.trim();
  if (!title) { toast("Нэрийг оруулна уу"); return; }
  const body = {
    title, type: document.getElementById("sv_type")?.value,
    deadline: document.getElementById("sv_deadline")?.value,
    status: document.getElementById("sv_status")?.value,
    description: document.getElementById("sv_desc")?.value.trim(),
    questions: surveyGatherQuestions(),
    anonymous: 1,
  };
  try {
    if (id) await api(`/api/surveys/${id}`,{method:"PUT",body:JSON.stringify(body)});
    else await api("/api/surveys",{method:"POST",body:JSON.stringify(body)});
    document.getElementById("surveyModal")?.remove();
    toast("Хадгалагдлаа");
    hrRenderSurvey(document.getElementById("hrSubContent"));
  } catch(e) { toast("Алдаа: "+e.message); }
}

async function surveyEdit(id) {
  const surveys = await api("/api/surveys").catch(()=>[]);
  const s = surveys.find(x=>x.id===id);
  if (s) surveyAdd(s);
}

async function surveyDel(id, title) {
  if (!confirm(`"${title}" устгах уу?`)) return;
  await api(`/api/surveys/${id}`,{method:"DELETE"});
  toast("Устгагдлаа");
  hrRenderSurvey(document.getElementById("hrSubContent"));
}

async function surveyQr(id) {
  const surveys = await api("/api/surveys").catch(()=>[]);
  const s = surveys.find(x => x.id === id);
  if (!s) return;
  let token = s.public_token;
  if (!token) {
    const created = await api(`/api/surveys/${id}/public-token`, { method:"POST" }).catch(e => ({ error: e.message }));
    token = created?.token;
  }
  if (!token) { toast("QR холбоос үүсгэж чадсангүй. Серверээ restart хийгээд дахин оролдоорой."); return; }
  const cfg = await fetch("/api/public-base-url").then(r => r.json()).catch(()=>({ baseUrl: location.origin }));
  const link = `${(cfg.baseUrl || location.origin).replace(/\/+$/,"")}/qr-survey.html?t=${encodeURIComponent(token)}`;
  document.getElementById("surveyQrModal")?.remove();
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(link)}`;
  document.body.insertAdjacentHTML("beforeend", `
    <div id="surveyQrModal" style="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1002;display:flex;align-items:center;justify-content:center;padding:18px">
      <div style="background:#fff;border-radius:16px;padding:24px;width:min(440px,96vw);box-shadow:0 20px 60px rgba(0,0,0,.25)">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:14px">
          <div>
            <div style="font-weight:800;font-size:16px">🔗 Судалгааны QR</div>
            <div style="font-size:12px;color:#64748b;margin-top:4px">${escapeHtml(s.title)}</div>
          </div>
          <button onclick="document.getElementById('surveyQrModal').remove()" style="background:none;border:none;font-size:20px;color:#94a3b8;cursor:pointer">✕</button>
        </div>
        <div style="text-align:center;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:12px">
          <img src="${qrSrc}" alt="QR" style="width:240px;height:240px;max-width:100%">
          <div style="font-size:11px;color:#94a3b8;margin-top:8px">QR харагдахгүй бол доорх холбоосыг ашиглана.</div>
        </div>
        <input class="input" id="surveyPublicLink" readonly value="${escapeHtml(link)}" onclick="this.select()" style="font-size:12px;margin-bottom:12px">
        <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
          <button class="btn secondary" onclick="navigator.clipboard?.writeText(document.getElementById('surveyPublicLink').value);toast('Холбоос хууллаа')">Холбоос хуулах</button>
          <button class="btn" onclick="window.open(document.getElementById('surveyPublicLink').value,'_blank')">Нээж шалгах</button>
        </div>
      </div>
    </div>`);
}

async function surveyEmployeePortalQr() {
  const cfg = await fetch("/api/public-base-url").then(r => r.json()).catch(()=>({ baseUrl: location.origin }));
  const link = `${(cfg.baseUrl || location.origin).replace(/\/+$/,"")}/employee-surveys.html`;
  document.getElementById("surveyQrModal")?.remove();
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(link)}`;
  document.body.insertAdjacentHTML("beforeend", `
    <div id="surveyQrModal" style="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1002;display:flex;align-items:center;justify-content:center;padding:18px">
      <div style="background:#fff;border-radius:16px;padding:24px;width:min(460px,96vw);box-shadow:0 20px 60px rgba(0,0,0,.25)">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:14px">
          <div>
            <div style="font-weight:800;font-size:16px">👥 Ажилчдын судалгааны QR</div>
            <div style="font-size:12px;color:#64748b;margin-top:4px">Ажилчид энэ QR-аар ороод идэвхтэй асуумжаа сонгож бөглөнө.</div>
          </div>
          <button onclick="document.getElementById('surveyQrModal').remove()" style="background:none;border:none;font-size:20px;color:#94a3b8;cursor:pointer">✕</button>
        </div>
        <div style="text-align:center;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:12px">
          <img src="${qrSrc}" alt="QR" style="width:240px;height:240px;max-width:100%">
          <div style="font-size:11px;color:#94a3b8;margin-top:8px">QR харагдахгүй бол доорх холбоосыг ашиглана.</div>
        </div>
        <input class="input" id="surveyPublicLink" readonly value="${escapeHtml(link)}" onclick="this.select()" style="font-size:12px;margin-bottom:12px">
        <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
          <button class="btn secondary" onclick="navigator.clipboard?.writeText(document.getElementById('surveyPublicLink').value);toast('Холбоос хууллаа')">Холбоос хуулах</button>
          <button class="btn" onclick="window.open(document.getElementById('surveyPublicLink').value,'_blank')">Нээж шалгах</button>
        </div>
      </div>
    </div>`);
}

async function surveyDownloadCsv(id) {
  const [survey, responses] = await Promise.all([
    api("/api/surveys").then(s => s.find(x => x.id === id)),
    api(`/api/survey-responses/${id}`)
  ]).catch(()=>[null,[]]);
  if (!survey) return;
  const qs = typeof survey.questions === "string" ? JSON.parse(survey.questions || "[]") : survey.questions || [];
  const csvCell = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = ["Огноо", ...qs.map((q,i) => `${i+1}. ${q.text}`)];
  const rows = responses.map(r => {
    const answers = typeof r.answers === "string" ? JSON.parse(r.answers || "{}") : r.answers || {};
    return [r.submitted_at || "", ...qs.map((_, i) => surveyFormatAnswer(answers[i]))];
  });
  const csv = "\uFEFF" + [header, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(survey.title || "survey").replace(/[\\/:*?"<>|]/g, "_")}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function surveyFill(id, title) {
  const [survey] = await Promise.all([api(`/api/surveys`).then(s=>s.find(x=>x.id===id))]).catch(()=>[null]);
  if (!survey) return;
  const mine = await api(`/api/survey-responses/${id}/mine`).catch(()=>null);
  if (mine) { toast("Та аль хэдийн бөглөсөн байна"); return; }
  const qs = typeof survey.questions==="string"?JSON.parse(survey.questions||"[]"):survey.questions||[];
  window._surveyFillQuestions = qs;
  document.getElementById("surveyFillModal")?.remove();
  const html = `
  <div id="surveyFillModal" style="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1001;display:flex;align-items:center;justify-content:center;overflow-y:auto">
    <div style="background:#fff;border-radius:16px;padding:28px 32px;width:580px;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.25)">
      <div style="font-weight:800;font-size:17px;margin-bottom:6px">📝 ${escapeHtml(title)}</div>
      <div style="font-size:12px;color:#64748b;margin-bottom:20px">${escapeHtml(survey.type)}</div>
      <div style="display:flex;flex-direction:column;gap:16px" id="surveyFillBody">
        ${qs.map((q,i)=>`
        <div style="background:#f8fafc;border-radius:10px;padding:14px">
          <div style="font-weight:600;font-size:13px;margin-bottom:10px">${i+1}. ${escapeHtml(q.text)}</div>
          ${surveyQuestionImageHtml(q)}
          ${q.type==="Текст"?`<textarea class="input" id="sfq_${i}" rows="2" placeholder="Хариулт..."></textarea>`:
            surveyIsMatrix(q)?surveyMatrixFillHtml(q,i):
            q.type==="Оноо (1-5)"?`<div style="display:flex;gap:8px">${[1,2,3,4,5].map(n=>`
              <label style="display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer">
                <input type="radio" name="sfq_${i}" value="${n}">
                <span style="font-size:13px;font-weight:600">${n}</span>
              </label>`).join("")}</div>`:
            (q.options||[]).map(opt=>`
            <label style="display:flex;align-items:center;gap:6px;margin-bottom:6px;cursor:pointer">
              <input type="${q.type==="Олон сонголт"?"checkbox":"radio"}" name="sfq_${i}" value="${escapeHtml(opt)}">
              <span style="font-size:13px">${escapeHtml(opt)}</span>
            </label>`).join("")}
        </div>`).join("")}
      </div>
      <div style="display:flex;gap:8px;margin-top:18px;justify-content:flex-end">
        <button class="btn secondary" onclick="document.getElementById('surveyFillModal').remove()">Болих</button>
        <button class="btn" onclick="surveySubmit(${id},${qs.length})">Илгээх</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML("beforeend", html);
}

async function surveySubmit(surveyId, qCount) {
  const answers = {};
  const qs = window._surveyFillQuestions || [];
  for (let i=0;i<qCount;i++) {
    if (surveyIsMatrix(qs[i])) { answers[i] = surveyMatrixAnswer(i, qs[i]); continue; }
    const ta = document.getElementById("sfq_"+i);
    if (ta) { answers[i] = ta.value; continue; }
    const radios = document.querySelectorAll(`input[name="sfq_${i}"]:checked`);
    const vals = [...radios].map(r=>r.value);
    answers[i] = vals.length===1?vals[0]:vals;
  }
  try {
    await api("/api/survey-responses",{method:"POST",body:JSON.stringify({survey_id:surveyId,answers})});
    document.getElementById("surveyFillModal")?.remove();
    toast("Судалгаа амжилттай илгээгдлаа!");
    hrRenderSurvey(document.getElementById("hrSubContent"));
  } catch(e) { toast("Алдаа: "+e.message); }
}

async function surveyViewResults(id, title) {
  const [survey, responses] = await Promise.all([
    api("/api/surveys").then(s=>s.find(x=>x.id===id)),
    api(`/api/survey-responses/${id}`)
  ]).catch(()=>[null,[]]);
  if (!survey) return;
  const qs = typeof survey.questions==="string"?JSON.parse(survey.questions||"[]"):survey.questions||[];
  document.getElementById("surveyResultModal")?.remove();
  const html = `
  <div id="surveyResultModal" style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1001;display:flex;align-items:center;justify-content:center;overflow-y:auto">
    <div style="background:#fff;border-radius:16px;padding:28px 32px;width:640px;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.25)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;gap:12px">
        <div>
          <div style="font-weight:800;font-size:16px">📊 ${escapeHtml(title)} — Үр дүн</div>
          <div style="font-size:12px;color:#64748b">Нийт ${responses.length} хариулт</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <button class="btn secondary sm" onclick="surveyToggleConclusion()">🧠 Дүгнэлт гаргах</button>
          <button onclick="document.getElementById('surveyResultModal').remove()" style="background:none;border:none;font-size:20px;color:#94a3b8;cursor:pointer">✕</button>
        </div>
      </div>
      ${surveyConclusionHtml(qs, responses)}
      ${qs.map((q,i)=>{
        const ans = responses.map(r=>{
          const parsed = typeof r.answers==="string"?JSON.parse(r.answers||"{}"):r.answers||{};
          return parsed[i];
        }).filter(a=>a!=null);
        if (q.type==="Текст") {
          return `<div style="background:#f8fafc;border-radius:10px;padding:14px;margin-bottom:12px">
            <div style="font-weight:600;margin-bottom:8px">${i+1}. ${escapeHtml(q.text)}</div>
            ${surveyQuestionImageHtml(q)}
            ${ans.slice(0,5).map(a=>`<div style="padding:4px 8px;font-size:12px;color:#475569;border-left:3px solid #2563eb;margin-bottom:4px">${escapeHtml(String(a))}</div>`).join("")}
            ${ans.length>5?`<div style="font-size:11px;color:#94a3b8">болон ${ans.length-5} хариулт...</div>`:""}
          </div>`;
        }
        if (q.type==="Оноо (1-5)") {
          const avg = ans.length?ans.reduce((s,v)=>s+Number(v),0)/ans.length:0;
          return `<div style="background:#f8fafc;border-radius:10px;padding:14px;margin-bottom:12px">
            <div style="font-weight:600;margin-bottom:8px">${i+1}. ${escapeHtml(q.text)}</div>
            ${surveyQuestionImageHtml(q)}
            <div style="font-size:28px;font-weight:800;color:#1d4ed8">${avg.toFixed(1)} <span style="font-size:14px;color:#64748b">/ 5</span></div>
            <div style="font-size:11px;color:#64748b">${ans.length} хариулт</div>
          </div>`;
        }
        if (surveyIsMatrix(q)) {
          const rows = surveyMatrixRows(q);
          const totals = rows.map(row => {
            const vals = ans.map(a => Number(a?.[row])).filter(Boolean);
            const avg = vals.length ? vals.reduce((s,v)=>s+v,0)/vals.length : 0;
            return { row, avg, count: vals.length };
          });
          return `<div style="background:#f8fafc;border-radius:10px;padding:14px;margin-bottom:12px">
            <div style="font-weight:600;margin-bottom:10px">${i+1}. ${escapeHtml(q.text)}</div>
            ${surveyQuestionImageHtml(q)}
            ${totals.map(t=>`
              <div style="margin-bottom:8px">
                <div style="display:flex;justify-content:space-between;gap:10px;font-size:12px;margin-bottom:3px">
                  <span>${escapeHtml(t.row)}</span><span style="font-weight:700;color:#1d4ed8">${t.avg.toFixed(1)} / 5</span>
                </div>
                <div style="height:7px;background:#e2e8f0;border-radius:10px;overflow:hidden">
                  <div style="height:100%;width:${Math.round(t.avg/5*100)}%;background:#2563eb;border-radius:10px"></div>
                </div>
              </div>`).join("")}
          </div>`;
        }
        const counts = {};
        ans.forEach(a=>{const vals=Array.isArray(a)?a:[a];vals.forEach(v=>{counts[v]=(counts[v]||0)+1;});});
        return `<div style="background:#f8fafc;border-radius:10px;padding:14px;margin-bottom:12px">
          <div style="font-weight:600;margin-bottom:10px">${i+1}. ${escapeHtml(q.text)}</div>
          ${surveyQuestionImageHtml(q)}
          ${Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([opt,cnt])=>{
            const pct = ans.length?Math.round(cnt/ans.length*100):0;
            return `<div style="margin-bottom:6px">
              <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:2px">
                <span>${escapeHtml(String(opt))}</span><span style="font-weight:600">${cnt} (${pct}%)</span>
              </div>
              <div style="height:6px;background:#e2e8f0;border-radius:10px;overflow:hidden">
                <div style="height:100%;width:${pct}%;background:#2563eb;border-radius:10px"></div>
              </div>
            </div>`;
          }).join("")}
        </div>`;
      }).join("")}
    </div>
  </div>`;
  document.body.insertAdjacentHTML("beforeend", html);
}

Object.assign(window, { hrRenderSurvey, surveyAdd, surveyEdit, surveySave, surveyDel,
  surveyUseTemplate, surveyQr, surveyDownloadCsv,
  surveyAddQuestion, surveyRemoveQuestion, surveyAddOption, surveyRemoveOption, surveyRefreshQuestions,
  surveyUploadQuestionImage, surveyClearQuestionImage, surveyQuickImageEngagement,
  surveyCreateQuickImageEngagement, surveyEmployeePortalQr, surveyToggleConclusion,
  surveyFill, surveySubmit, surveyViewResults });

// ── Tab: Албан бичгийн хяналт ─────────────────────────────────

const HR_LETTER_STATUSES = ["Шинэ","Хуваарилагдсан","Биелэж байна","Биелсэн","Хаасан"];
const HR_LETTER_TYPES = ["Ирсэн","Явсан","Дотоод","Гомдол","Хүсэлт"];

function hrLetterStatusPill(status) {
  const colors = {
    "Шинэ": "#2563eb",
    "Хуваарилагдсан": "#7c3aed",
    "Биелэж байна": "#d97706",
    "Биелсэн": "#16a34a",
    "Хаасан": "#64748b",
  };
  const c = colors[status] || "#64748b";
  return `<span style="padding:3px 9px;border-radius:999px;background:${c}18;color:${c};font-size:11px;font-weight:700">${escapeHtml(status||"—")}</span>`;
}

function hrLetterFmtDate(d) {
  return d ? String(d).slice(0, 10) : "—";
}

async function hrRenderLetters(tc) {
  if (!tc) tc = document.getElementById("hrTabContent");
  if (!tc) return;
  tc.innerHTML = `<div style="padding:28px;color:#94a3b8">Уншиж байна...</div>`;

  const canEdit = ["director","hr"].includes(state.me.role);
  let rows = [];
  try { rows = await api("/api/correspondence"); } catch(e) { rows = []; }

  const q = (_hrLetterSearch || "").toLowerCase();
  const filtered = rows.filter(r => {
    const text = [r.doc_no, r.subject, r.source_org, r.assigned_name, r.decision].join(" ").toLowerCase();
    return (!q || text.includes(q)) &&
      (!_hrLetterStatus || r.status === _hrLetterStatus) &&
      (!_hrLetterType || r.doc_type === _hrLetterType);
  });
  const todayStr = today();
  const openRows = rows.filter(r => !["Хаасан","Биелсэн"].includes(r.status));
  const overdue = openRows.filter(r => r.due_date && r.due_date < todayStr).length;
  const dueSoon = openRows.filter(r => r.due_date && r.due_date >= todayStr &&
    ((new Date(r.due_date) - new Date(todayStr)) / 86400000) <= 7).length;
  const newCount = rows.filter(r => r.status === "Шинэ").length;

  const byStatus = {};
  HR_LETTER_STATUSES.forEach(s => { byStatus[s] = rows.filter(r => r.status === s).length; });

  tc.innerHTML = `
  <div style="padding:20px 24px;background:#f8fafc">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:16px">
      <div>
        <div style="font-size:18px;font-weight:800;color:#0f172a">📨 Албан бичгийн хяналт</div>
        <div style="font-size:12px;color:#64748b;margin-top:3px">Ирсэн, явсан, дотоод бичгийн хариуцлага ба хугацааны хяналт</div>
      </div>
      ${canEdit ? `<button class="btn" onclick="hrOpenLetterForm()">+ Бичиг бүртгэх</button>` : ""}
    </div>

    <div style="display:grid;grid-template-columns:repeat(4,minmax(120px,1fr));gap:12px;margin-bottom:14px">
      ${[
        ["Нийт бичиг", rows.length, "#2563eb", "📨"],
        ["Шинэ", newCount, "#7c3aed", "●"],
        ["Хугацаа дөхсөн", dueSoon, "#d97706", "⏳"],
        ["Хугацаа хэтэрсэн", overdue, "#dc2626", "⚠"],
      ].map(([label,value,color,icon]) => `
        <div style="background:#fff;border:1px solid #e2e8f0;border-top:3px solid ${color};border-radius:10px;padding:12px 14px">
          <div style="display:flex;align-items:center;justify-content:space-between;color:${color};font-weight:800;font-size:20px">
            <span>${value}</span><span style="font-size:16px">${icon}</span>
          </div>
          <div style="font-size:11px;color:#64748b;margin-top:4px;font-weight:600">${label}</div>
        </div>`).join("")}
    </div>

    <div style="display:flex;gap:8px;overflow-x:auto;margin-bottom:14px">
      ${HR_LETTER_STATUSES.map(s => `
        <button onclick="_hrLetterStatus='${s===_hrLetterStatus?"":s}';hrRenderLetters()"
          style="border:1px solid ${_hrLetterStatus===s?'#2563eb':'#e2e8f0'};background:${_hrLetterStatus===s?'#eff6ff':'#fff'};
                 color:${_hrLetterStatus===s?'#1d4ed8':'#475569'};border-radius:999px;padding:7px 12px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap">
          ${s} · ${byStatus[s]||0}
        </button>`).join("")}
    </div>

    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin-bottom:12px">
      <input class="input" value="${escapeHtml(_hrLetterSearch)}" placeholder="🔍 Дугаар, гарчиг, байгууллага, хариуцагч хайх..."
        oninput="_hrLetterSearch=this.value;hrRenderLetters()" style="flex:1;min-width:260px;margin:0">
      <select class="input" onchange="_hrLetterType=this.value;hrRenderLetters()" style="width:140px;margin:0">
        <option value="">Бүх төрөл</option>
        ${HR_LETTER_TYPES.map(t => `<option value="${t}" ${_hrLetterType===t?'selected':''}>${t}</option>`).join("")}
      </select>
      <button class="btn secondary sm" onclick="_hrLetterSearch='';_hrLetterStatus='';_hrLetterType='';hrRenderLetters()">Цэвэрлэх</button>
      <div style="font-size:12px;color:#94a3b8;margin-left:auto">${filtered.length} / ${rows.length}</div>
    </div>

    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
      <div style="overflow-x:auto">
      <table style="width:100%;min-width:1050px;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0">
            <th style="padding:10px 12px;text-align:left;font-size:11px;color:#475569">ОГНОО</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;color:#475569">ДУГААР</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;color:#475569">ТӨРӨЛ</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;color:#475569">БАЙГУУЛЛАГА</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;color:#475569">ГАРЧИГ</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;color:#475569">ХАРИУЦСАН</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;color:#475569">ДУУСАХ</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;color:#475569">СТАТУС</th>
            <th style="padding:10px 12px;text-align:center;font-size:11px;color:#475569">ҮЙЛДЭЛ</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.length ? filtered.map((r,i) => {
            const isLate = r.due_date && r.due_date < todayStr && !["Хаасан","Биелсэн"].includes(r.status);
            return `<tr style="border-bottom:1px solid #f1f5f9;background:${isLate?'#fff7f7':(i%2?'#fafbfc':'#fff')}">
              <td style="padding:10px 12px;color:#64748b;font-size:12px">${hrLetterFmtDate(r.doc_date)}</td>
              <td style="padding:10px 12px;font-weight:700;color:#334155">${escapeHtml(r.doc_no||"—")}</td>
              <td style="padding:10px 12px;color:#475569">${escapeHtml(r.doc_type||"—")}</td>
              <td style="padding:10px 12px;color:#475569">${escapeHtml(r.source_org||"—")}</td>
              <td style="padding:10px 12px">
                <div style="font-weight:700;color:#0f172a">${escapeHtml(r.subject||"")}</div>
                ${r.decision ? `<div style="font-size:11px;color:#64748b;margin-top:2px">${escapeHtml(r.decision)}</div>` : ""}
              </td>
              <td style="padding:10px 12px;color:#475569">${escapeHtml(r.assigned_name||"—")}</td>
              <td style="padding:10px 12px;color:${isLate?'#dc2626':'#64748b'};font-weight:${isLate?800:500};font-size:12px">${hrLetterFmtDate(r.due_date)}</td>
              <td style="padding:10px 12px">${hrLetterStatusPill(r.status)}</td>
              <td style="padding:10px 12px;text-align:center;white-space:nowrap">
                <button class="btn secondary sm" onclick="hrLetterAiRead(${r.id})">AI унших</button>
                <button class="btn secondary sm" onclick="hrLetterReplyDraft(${r.id})">Хариу draft</button>
                <button class="btn secondary sm" onclick="hrLetterLegalCheck(${r.id})">⚖️</button>
                <button class="btn secondary sm" onclick="hrOpenLetterScan(${r.id})">${canEdit ? "Скан" : "Харах"}</button>
                <button class="btn secondary sm" onclick="hrPrintLetter(${r.id})">Хэвлэх</button>
                ${canEdit ? `<button class="btn secondary sm" onclick="hrEditLetter(${r.id})">Засах</button>` : ""}
              </td>
            </tr>`;
          }).join("") : `<tr><td colspan="9" style="text-align:center;padding:36px;color:#94a3b8">Албан бичиг олдсонгүй</td></tr>`}
        </tbody>
      </table>
      </div>
    </div>
  </div>
  <div id="hrLetterModal" style="display:none;position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:1000;align-items:center;justify-content:center"></div>`;

  window._hrLetters = rows;
}

function hrOpenLetterForm(data = {}) {
  const users = state.users || [];
  const isEdit = !!data.id;
  const m = document.getElementById("hrLetterModal");
  if (!m) return;
  m.innerHTML = `
    <div style="background:#fff;border-radius:14px;width:min(620px,94vw);max-height:90vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.25);padding:24px">
      <div style="font-size:17px;font-weight:800;color:#0f172a;margin-bottom:16px">${isEdit ? "Албан бичиг засах" : "Албан бичиг бүртгэх"}</div>
      <input type="hidden" id="hl_id" value="${data.id||""}">
      <div class="row3" style="margin-bottom:10px">
        <div><div class="small muted">Төрөл</div><select class="input" id="hl_type">${HR_LETTER_TYPES.map(t=>`<option ${((data.doc_type||"Ирсэн")===t)?'selected':''}>${t}</option>`).join("")}</select></div>
        <div><div class="small muted">Дугаар</div><input class="input" id="hl_no" value="${escapeHtml(data.doc_no||"")}" placeholder="2026/001"></div>
        <div><div class="small muted">Огноо *</div><input class="input" id="hl_date" type="date" value="${data.doc_date||today()}"></div>
      </div>
      <div style="margin-bottom:10px"><div class="small muted">Гарчиг *</div><input class="input" id="hl_subject" value="${escapeHtml(data.subject||"")}" placeholder="Бичгийн гарчиг"></div>
      <div class="row" style="margin-bottom:10px">
        <div><div class="small muted">Байгууллага</div><input class="input" id="hl_org" value="${escapeHtml(data.source_org||"")}" placeholder="Илгээгч / хүлээн авагч"></div>
        <div><div class="small muted">Хариуцсан ажилтан</div><select class="input" id="hl_assign">
          <option value="">— Сонгох —</option>
          ${users.map(u=>`<option value="${u.id}" ${String(data.assigned_to||"")===String(u.id)?'selected':''}>${escapeHtml(u.full_name)}</option>`).join("")}
        </select></div>
      </div>
      <div class="row" style="margin-bottom:10px">
        <div><div class="small muted">Дуусах огноо</div><input class="input" id="hl_due" type="date" value="${data.due_date||""}"></div>
        <div><div class="small muted">Статус</div><select class="input" id="hl_status">${HR_LETTER_STATUSES.map(s=>`<option ${((data.status||"Шинэ")===s)?'selected':''}>${s}</option>`).join("")}</select></div>
      </div>
      <div style="margin-bottom:14px"><div class="small muted">Шийдвэр / тэмдэглэл</div><textarea class="input" id="hl_decision" rows="3" placeholder="Шийдвэр, биелэлт, тэмдэглэл">${escapeHtml(data.decision||"")}</textarea></div>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button class="btn secondary" onclick="document.getElementById('hrLetterModal').style.display='none'">Цуцлах</button>
        <button class="btn" onclick="hrSaveLetter()">Хадгалах</button>
      </div>
    </div>`;
  m.style.display = "flex";
}

function hrEditLetter(id) {
  const row = (window._hrLetters || []).find(r => r.id === id);
  if (row) hrOpenLetterForm(row);
}

function hrOpenLetterScan(id) {
  const row = (window._hrLetters || []).find(r => Number(r.id) === Number(id));
  if (!row) return toast("Албан бичиг олдсонгүй");
  if (!["director","hr"].includes(state.me.role)) return hrViewLetterFiles(row);
  if (typeof window.openScanModal !== "function") return hrViewLetterFiles(row);
  const label = [row.doc_no, row.subject].filter(Boolean).join(" · ") || "Албан бичиг";
  window.openScanModal("letter", row.id, label);
}

function hrLetterAiModal(title, bodyHtml) {
  document.getElementById("hrLetterAiModal")?.remove();
  document.body.insertAdjacentHTML("beforeend", `
    <div id="hrLetterAiModal" style="position:fixed;inset:0;background:rgba(15,23,42,.52);z-index:2200;display:flex;align-items:flex-start;justify-content:center;padding-top:38px;overflow:auto">
      <div style="background:#fff;border-radius:14px;width:min(860px,96vw);margin-bottom:42px;box-shadow:0 20px 60px rgba(0,0,0,.25);overflow:hidden">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:16px 20px;border-bottom:1px solid #e2e8f0;background:#f8fafc">
          <div style="font-size:16px;font-weight:800;color:#0f172a">${title}</div>
          <button class="btn secondary sm" onclick="document.getElementById('hrLetterAiModal').remove()">Хаах</button>
        </div>
        <div style="padding:18px 20px">${bodyHtml}</div>
      </div>
    </div>`);
}

async function hrLetterAiRead(id) {
  try {
    const data = await api(`/api/correspondence/${id}/ai-read`, { method:"POST" });
    hrLetterAiModal("AI уншсан товч дүгнэлт", `
      <div style="white-space:pre-wrap;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;color:#334155;font-size:13px;line-height:1.6">${escapeHtml(data.summary || "")}</div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
        <button class="btn" onclick="hrLetterReplyDraft(${id})">Хариу draft үүсгэх</button>
        <button class="btn secondary" onclick="hrLetterLegalCheck(${id})">⚖️ Хууль шалгах</button>
      </div>`);
    hrRenderLetters();
  } catch(e) { toast("Алдаа: " + e.message); }
}

function hrLetterReplyDraft(id) {
  hrLetterAiModal("Хариу бичгийн draft", `
    <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:14px">
      <div style="flex:1;min-width:240px">
        <div class="small muted">Хариуны төрөл</div>
        <select class="input" id="letterDraftType" style="margin:0">
          ${["Мэдээлэл өгөх","Биелүүлсэн тухай","Хугацаа сунгах","Шилжүүлэх","Татгалзах"].map(t => `<option>${t}</option>`).join("")}
        </select>
      </div>
      <button class="btn" onclick="hrLetterGenerateDraft(${id})">Draft үүсгэх</button>
    </div>
    <div id="letterDraftBody" style="color:#94a3b8;border:1px dashed #cbd5e1;border-radius:10px;padding:22px;text-align:center">Төрлөө сонгоод draft үүсгэнэ үү</div>`);
}

async function hrLetterGenerateDraft(id) {
  const type = document.getElementById("letterDraftType")?.value || "Мэдээлэл өгөх";
  try {
    const data = await api(`/api/correspondence/${id}/reply-draft`, {
      method:"POST",
      body: JSON.stringify({ response_type: type })
    });
    const box = document.getElementById("letterDraftBody");
    if (box) box.innerHTML = `
      <textarea class="input" rows="13" style="margin:0;resize:vertical;line-height:1.55">${escapeHtml(data.draft || "")}</textarea>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
        <button class="btn secondary" onclick="navigator.clipboard?.writeText(document.querySelector('#letterDraftBody textarea')?.value || '');toast('Draft хууллаа')">Хуулах</button>
        <button class="btn" onclick="hrPrintLetter(${id})">Хэвлэх</button>
      </div>`;
    hrRenderLetters();
  } catch(e) { toast("Алдаа: " + e.message); }
}

async function hrLetterLegalCheck(id) {
  try {
    const data = await api(`/api/correspondence/${id}/legal-check`, { method:"POST" });
    hrLetterAiModal("⚖️ Хуулийн хөндлөнгийн шүүлт", legalFilterResultHtml({
      doc_name: "Албан бичиг",
      summary: data.summary,
      results: data.results || []
    }));
  } catch(e) { toast("Алдаа: " + e.message); }
}

async function hrViewLetterFiles(row) {
  let m = document.getElementById("hrLetterFileModal");
  if (!m) {
    m = document.createElement("div");
    m.id = "hrLetterFileModal";
    m.style.cssText = "display:none;position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:2000;align-items:flex-start;justify-content:center;padding-top:42px;overflow:auto";
    document.body.appendChild(m);
  }
  m.innerHTML = `
    <div style="background:#fff;border-radius:14px;width:min(760px,96vw);margin-bottom:40px;box-shadow:0 20px 60px rgba(0,0,0,.25);overflow:hidden">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;padding:16px 20px;border-bottom:1px solid #e2e8f0;background:#f8fafc">
        <div>
          <div style="font-size:15px;font-weight:800;color:#0f172a">📨 Скан хавсралт</div>
          <div style="font-size:12px;color:#64748b;margin-top:2px">${escapeHtml([row.doc_no, row.subject].filter(Boolean).join(" · ") || "Албан бичиг")}</div>
        </div>
        <button class="btn secondary sm" onclick="document.getElementById('hrLetterFileModal').style.display='none'">Хаах</button>
      </div>
      <div id="hrLetterFileBody" style="padding:18px 20px"><div style="color:#94a3b8;font-size:13px">Уншиж байна...</div></div>
    </div>`;
  m.style.display = "flex";

  const body = document.getElementById("hrLetterFileBody");
  let files = [];
  try { files = await api(`/api/doc-attachments?entity_type=letter&entity_id=${row.id}`); } catch(e) { files = []; }
  if (!files.length) {
    body.innerHTML = `<div style="text-align:center;color:#94a3b8;padding:24px">Скан файл хавсаргаагүй байна.</div>`;
    return;
  }
  body.innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:10px">
      <button class="btn secondary sm" onclick="hrPrintLetter(${row.id})">Хэвлэх</button>
    </div>
    ${files.map(f => {
      const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(f.file_url || "");
      const isPdf = /\.pdf$/i.test(f.file_url || "");
      return `<div style="display:flex;gap:12px;align-items:flex-start;border:1px solid #e2e8f0;border-radius:10px;padding:10px;margin-bottom:10px">
        ${isImg
          ? `<a href="${escapeHtml(f.file_url)}" target="_blank"><img src="${escapeHtml(f.file_url)}" style="width:86px;height:86px;object-fit:cover;border-radius:8px;border:1px solid #e2e8f0"></a>`
          : `<a href="${escapeHtml(f.file_url)}" target="_blank" style="width:86px;height:86px;display:flex;align-items:center;justify-content:center;border-radius:8px;border:1px solid #e2e8f0;background:${isPdf?'#fef2f2':'#f8fafc'};text-decoration:none;font-size:30px">${isPdf?'📄':'📎'}</a>`}
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:800;color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(f.file_name || "scan")}</div>
          <div style="font-size:12px;color:#64748b;margin-top:3px">${escapeHtml(f.note || "")}</div>
          <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
            <a class="btn secondary sm" href="${escapeHtml(f.file_url)}" target="_blank" style="text-decoration:none">Харах</a>
            <a class="btn secondary sm" href="${escapeHtml(f.file_url)}" download style="text-decoration:none">Татах</a>
          </div>
        </div>
      </div>`;
    }).join("")}`;
}

async function hrPrintLetter(id) {
  const row = (window._hrLetters || []).find(r => Number(r.id) === Number(id));
  if (!row) return toast("Албан бичиг олдсонгүй");
  const w = window.open("", "_blank", "width=900,height=900");
  if (!w) return toast("Хэвлэх цонх нээгдсэнгүй");
  w.document.write(`<!doctype html><html lang="mn"><head><meta charset="utf-8"><title>Албан бичиг хэвлэх</title></head><body style="font-family:Arial,sans-serif;padding:24px;color:#64748b">Хэвлэх хуудас бэлдэж байна...</body></html>`);
  w.document.close();

  let files = [];
  try { files = await api(`/api/doc-attachments?entity_type=letter&entity_id=${row.id}`); } catch(e) { files = []; }

  const fileBlocks = files.length ? files.map(f => {
    const url = escapeHtml(f.file_url || "");
    const name = escapeHtml(f.file_name || (f.file_url || "").split("/").pop() || "scan");
    const note = escapeHtml(f.note || "");
    const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(f.file_url || "");
    if (isImg) {
      return `<section class="scan-page">
        <div class="scan-title">${name}${note ? ` · ${note}` : ""}</div>
        <img src="${url}" alt="${name}">
      </section>`;
    }
    return `<section class="file-row">
      <b>${name}</b>${note ? ` · ${note}` : ""}<br>
      <span>PDF/файл хавсралт: ${url}</span>
    </section>`;
  }).join("") : `<div class="empty">Скан файл хавсаргаагүй байна.</div>`;

  w.document.open();
  w.document.write(`<!doctype html>
  <html lang="mn"><head><meta charset="utf-8">
  <title>Албан бичиг хэвлэх</title>
  <style>
    *{box-sizing:border-box} body{font-family:Arial,sans-serif;color:#0f172a;margin:0;background:#f8fafc}
    .page{width:210mm;min-height:297mm;margin:0 auto;background:#fff;padding:18mm 16mm}
    .top{display:flex;justify-content:space-between;gap:16px;border-bottom:2px solid #0f172a;padding-bottom:10px;margin-bottom:18px}
    h1{font-size:20px;margin:0 0 6px}.muted{color:#64748b;font-size:12px}.grid{display:grid;grid-template-columns:42mm 1fr;gap:0;border:1px solid #cbd5e1}
    .grid div{padding:8px 10px;border-bottom:1px solid #e2e8f0}.grid div:nth-child(odd){background:#f8fafc;font-weight:700;color:#334155}
    .grid div:nth-last-child(-n+2){border-bottom:0}.subject{font-size:18px;font-weight:800;margin:18px 0 10px}
    .decision{white-space:pre-wrap;border:1px solid #e2e8f0;padding:12px;min-height:45px;margin-top:8px}
    .scan-page{page-break-before:always;text-align:center}.scan-title{text-align:left;font-size:12px;color:#475569;margin-bottom:10px}
    .scan-page img{max-width:100%;max-height:260mm;object-fit:contain}.file-row{border:1px solid #e2e8f0;padding:12px;margin-top:12px}
    .empty{color:#94a3b8;border:1px dashed #cbd5e1;padding:14px;margin-top:12px}.actions{position:sticky;top:0;background:#fff;padding:10px;text-align:right;border-bottom:1px solid #e2e8f0}
    button{background:#2563eb;color:#fff;border:0;border-radius:8px;padding:9px 14px;font-weight:700;cursor:pointer}
    @media print{body{background:#fff}.actions{display:none}.page{margin:0;width:auto;min-height:auto;box-shadow:none}}
  </style></head><body>
    <div class="actions"><button onclick="window.print()">Хэвлэх</button></div>
    <main class="page">
      <div class="top">
        <div><h1>Албан бичгийн бүртгэл</h1><div class="muted">Чойбалсан хөгжил ОНӨҮГ</div></div>
        <div class="muted">Хэвлэсэн: ${new Date().toLocaleString("mn-MN")}</div>
      </div>
      <div class="subject">${escapeHtml(row.subject || "Албан бичиг")}</div>
      <div class="grid">
        <div>Төрөл</div><div>${escapeHtml(row.doc_type || "—")}</div>
        <div>Дугаар</div><div>${escapeHtml(row.doc_no || "—")}</div>
        <div>Огноо</div><div>${hrLetterFmtDate(row.doc_date)}</div>
        <div>Байгууллага</div><div>${escapeHtml(row.source_org || "—")}</div>
        <div>Хариуцсан</div><div>${escapeHtml(row.assigned_name || "—")}</div>
        <div>Дуусах огноо</div><div>${hrLetterFmtDate(row.due_date)}</div>
        <div>Статус</div><div>${escapeHtml(row.status || "—")}</div>
      </div>
      <h2 style="font-size:14px;margin:18px 0 6px">Шийдвэр / тэмдэглэл</h2>
      <div class="decision">${escapeHtml(row.decision || "")}</div>
      <h2 style="font-size:14px;margin:18px 0 6px">Скан хавсралт</h2>
      ${fileBlocks}
    </main>
  </body></html>`);
  w.document.close();
}

async function hrSaveLetter() {
  const id = document.getElementById("hl_id")?.value;
  const body = {
    doc_type: document.getElementById("hl_type")?.value,
    doc_no: document.getElementById("hl_no")?.value.trim(),
    doc_date: document.getElementById("hl_date")?.value,
    subject: document.getElementById("hl_subject")?.value.trim(),
    source_org: document.getElementById("hl_org")?.value.trim(),
    assigned_to: document.getElementById("hl_assign")?.value,
    due_date: document.getElementById("hl_due")?.value,
    status: document.getElementById("hl_status")?.value,
    decision: document.getElementById("hl_decision")?.value.trim(),
  };
  if (!body.subject || !body.doc_date) { toast("Гарчиг болон огноо оруулна уу"); return; }
  try {
    if (id) await api(`/api/correspondence/${id}`, { method:"PUT", body:JSON.stringify(body) });
    else await api("/api/correspondence", { method:"POST", body:JSON.stringify(body) });
    toast("Албан бичиг хадгалагдлаа");
    document.getElementById("hrLetterModal").style.display = "none";
    hrRenderLetters();
  } catch(e) { toast("Алдаа: " + e.message); }
}

Object.assign(window, { letters, hrRenderLetters, hrOpenLetterForm, hrEditLetter, hrOpenLetterScan, hrViewLetterFiles, hrPrintLetter, hrSaveLetter,
  hrLetterAiRead, hrLetterReplyDraft, hrLetterGenerateDraft, hrLetterLegalCheck });

// ── Tab: Бодлогын бичиг баримт ────────────────────────────────

const HR_POLICY_DOC_TYPES = [
  ["ИТХ-ын тогтоол", "Орон нутгийн өмч, тариф, чиг үүрэг, бүтэцтэй холбоотой шийдвэр"],
  ["Аймгийн Засаг даргын захирамж", "Аймаг, орон нутгийн захиргаанаас байгууллагад хамаарах захирамж"],
  ["Байгууллагын дүрэм", "Үйл ажиллагааны чиглэл, эрх үүрэг, бүтэц, төлөөлөн удирдах зохицуулалт"],
  ["Хөдөлмөрийн дотоод журам", "Ажил, амралт, сахилга, чөлөө, хөдөлмөрийн харилцааны дотоод зохицуулалт"],
  ["Албан тушаалын тодорхойлолт", "Ажилтны чиг үүрэг, хариуцлага, тавигдах шаардлага"],
  ["Захирлын тушаал", "Дотоод шийдвэр, томилгоо, үүрэг даалгавар, зохион байгуулалтын акт"],
];
const HR_ORDER_TYPES = [...HR_POLICY_DOC_TYPES.map(([name]) => name), "AI засварын draft","Журам","Бодлогын баримт","Тушаал","Шийдвэр","Тогтоол","Зарлиг","Захидал","Бусад"];
const HR_ORDER_STATUSES = ["Хүчинтэй","Хүчингүй","Архивт"];
let _hrOrderSearch = "";
let _hrOrderTypeFilter = "";

function hrOrderTypePill(type) {
  const colors = { "ИТХ-ын тогтоол":"#0891b2", "Аймгийн Засаг даргын захирамж":"#7c3aed", "Байгууллагын дүрэм":"#1d4ed8", "Хөдөлмөрийн дотоод журам":"#0f766e", "Албан тушаалын тодорхойлолт":"#d97706", "Захирлын тушаал":"#2563eb", "Журам":"#0f766e", "Бодлогын баримт":"#1d4ed8", "Тушаал":"#2563eb", "Шийдвэр":"#7c3aed", "Тогтоол":"#16a34a", "Зарлиг":"#dc2626", "Захидал":"#d97706", "Бусад":"#94a3b8" };
  const c = colors[type] || "#94a3b8";
  return `<span style="padding:3px 9px;border-radius:999px;background:${c}18;color:${c};font-size:11px;font-weight:800">${escapeHtml(type||"—")}</span>`;
}

function hrOrderStatusPill(status) {
  const colors = { "Хүчинтэй":"#16a34a", "Хүчингүй":"#dc2626", "Архивт":"#64748b" };
  const c = colors[status] || "#64748b";
  return `<span style="padding:3px 9px;border-radius:999px;background:${c}18;color:${c};font-size:11px;font-weight:800">${escapeHtml(status||"—")}</span>`;
}

function hrSetOrderTypeFilter(type = "") {
  _hrOrderTypeFilter = type;
  hrRenderOrders();
}

function hrSetOrderSearch(value = "") {
  _hrOrderSearch = value;
  hrRenderOrders();
}

function hrClearOrderFilters() {
  _hrOrderSearch = "";
  _hrOrderTypeFilter = "";
  hrRenderOrders();
}

function hrPolicyChecklistHtml(rows = []) {
  const required = HR_POLICY_DOC_TYPES.map(([name, desc]) => ({
    name,
    desc,
    count: rows.filter(r => r.doc_type === name && r.status !== "Хүчингүй").length
  }));
  const collected = required.filter(x => x.count > 0).length;
  const missing = required.filter(x => x.count === 0);
  const ready = collected === required.length;
  const almostReady = collected >= 4;
  return `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;margin-bottom:12px">
        <div>
          <div style="font-weight:900;color:#0f172a">Баримтын сангийн checklist</div>
          <div style="font-size:12px;color:#64748b;margin-top:3px">AI асуулт, хуулийн шүүлтэд ашиглах үндсэн баримтуудын бүрдэл</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
          <span style="font-size:12px;font-weight:900;color:#2563eb;background:#eff6ff;border:1px solid #bfdbfe;border-radius:999px;padding:6px 10px">Цуглуулсан: ${collected}/${required.length}</span>
          <span style="font-size:12px;font-weight:900;color:${missing.length ? "#d97706" : "#16a34a"};background:${missing.length ? "#fffbeb" : "#f0fdf4"};border:1px solid ${missing.length ? "#fde68a" : "#bbf7d0"};border-radius:999px;padding:6px 10px">Дутуу: ${missing.length}</span>
          <span style="font-size:12px;font-weight:900;color:${ready ? "#16a34a" : almostReady ? "#d97706" : "#64748b"};background:${ready ? "#f0fdf4" : almostReady ? "#fffbeb" : "#f8fafc"};border:1px solid ${ready ? "#bbf7d0" : almostReady ? "#fde68a" : "#e2e8f0"};border-radius:999px;padding:6px 10px">AI бэлэн: ${ready ? "тийм" : almostReady ? "дунд" : "үгүй"}</span>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px">
        ${required.map(item => {
          const ok = item.count > 0;
          return `<button onclick="${ok ? `hrSetOrderTypeFilter('${escapeHtml(item.name)}')` : `hrOpenOrderForm({doc_type:'${escapeHtml(item.name)}'})`}" style="text-align:left;border:1px solid ${ok ? "#bbf7d0" : "#fde68a"};background:${ok ? "#f0fdf4" : "#fffbeb"};border-radius:10px;padding:10px 12px;cursor:pointer;min-height:74px">
            <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
              <span style="font-size:12px;font-weight:900;color:#0f172a;line-height:1.25">${escapeHtml(item.name)}</span>
              <span style="white-space:nowrap;font-size:11px;font-weight:900;color:${ok ? "#16a34a" : "#d97706"}">${ok ? `байгаа · ${item.count}` : "дутуу"}</span>
            </div>
            <div style="font-size:11px;color:#64748b;line-height:1.35;margin-top:6px">${escapeHtml(item.desc)}</div>
          </button>`;
        }).join("")}
      </div>
      ${missing.length ? `<div style="font-size:12px;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:9px 10px;margin-top:10px">Эхлээд дутуу ${missing.length} төрлийн баримтыг нэмбэл AI хариулт, шүүлтийн чанар илүү найдвартай болно.</div>` : `<div style="font-size:12px;color:#15803d;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:9px 10px;margin-top:10px">Үндсэн баримтын сан бүрдсэн байна. Одоо баримтаас асуух болон хуулийн шүүлтэд ашиглахад тохиромжтой.</div>`}
    </div>`;
}

async function hrRenderOrders(tc) {
  if (!tc) tc = document.getElementById("hrTabContent");
  if (!tc) return;
  tc.innerHTML = `<div style="padding:28px;color:#94a3b8">Уншиж байна...</div>`;

  const canEdit = ["director","hr"].includes(state.me.role);
  let rows = [];
  try { rows = await api("/api/admin-hub/orders"); } catch(e) { rows = []; }
  window._hrOrders = rows;

  const q = (_hrOrderSearch || "").toLowerCase();
  const filtered = rows.filter(r => (!_hrOrderTypeFilter || r.doc_type === _hrOrderTypeFilter) &&
    [r.doc_no, r.doc_type, r.title, r.related_name, r.description, r.status].join(" ").toLowerCase().includes(q));
  const valid = rows.filter(r => r.status === "Хүчинтэй").length;
  const archived = rows.filter(r => r.status === "Архивт").length;

  tc.innerHTML = `
  <div style="padding:20px 24px;background:#f8fafc">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:16px">
      <div>
        <div style="font-size:18px;font-weight:800;color:#0f172a">📜 Бодлогын бичиг баримт</div>
        <div style="font-size:12px;color:#64748b;margin-top:3px">Журам, тушаал, шийдвэр, тогтоол, бодлогын баримтын дугаар, огноо, холбогдох бүртгэл</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${canEdit ? `<button class="btn secondary" onclick="hrOpenKhuralImport()">ИТХ тогтоол татах</button>` : ""}
        ${canEdit ? `<button class="btn" onclick="hrOpenOrderForm()">+ Баримт нэмэх</button>` : ""}
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(4,minmax(120px,1fr));gap:12px;margin-bottom:14px">
      ${[
        ["Нийт баримт", rows.length, "#2563eb"],
        ["Хүчинтэй", valid, "#16a34a"],
        ["Архивт", archived, "#64748b"],
        ["Хүчингүй", rows.filter(r=>r.status==="Хүчингүй").length, "#dc2626"],
      ].map(([label,value,color]) => `
        <div style="background:#fff;border:1px solid #e2e8f0;border-top:3px solid ${color};border-radius:10px;padding:12px 14px">
          <div style="font-size:22px;font-weight:800;color:${color};line-height:1">${value}</div>
          <div style="font-size:11px;color:#64748b;margin-top:6px;font-weight:700">${label}</div>
        </div>`).join("")}
    </div>

    ${hrPolicyChecklistHtml(rows)}

    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px">
        <div>
          <div style="font-weight:800;color:#0f172a">1-р шат: цуглуулах бичиг баримтын хайрцаг</div>
          <div style="font-size:12px;color:#64748b;margin-top:3px">Хайрцаг дээр дарахад доорх жагсаалт тухайн төрлөөр шүүгдэнэ</div>
        </div>
        <div style="font-size:12px;font-weight:800;color:#2563eb;background:#eff6ff;border:1px solid #bfdbfe;border-radius:999px;padding:6px 10px">
          ${_hrOrderTypeFilter ? escapeHtml(_hrOrderTypeFilter) : "Бүх баримт"} · ${filtered.length}
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px">
        ${[["", "Бүгд", "Бүх төрлийн бодлогын бичиг баримт", rows.length], ...HR_POLICY_DOC_TYPES.map(([name, desc]) => [name, name, desc, rows.filter(r => r.doc_type === name).length])].map(([value, name, desc, count]) => {
          const active = _hrOrderTypeFilter === value;
          const topColor = active ? "#2563eb" : (value ? "#cbd5e1" : "#94a3b8");
          return `<button onclick="hrSetOrderTypeFilter('${escapeHtml(value)}')" style="position:relative;text-align:left;border:1px solid ${active ? "#2563eb" : "#e2e8f0"};border-top:4px solid ${topColor};background:${active ? "#eff6ff" : "#fff"};border-radius:10px;padding:13px 14px;cursor:pointer;min-height:104px;box-shadow:${active ? "0 8px 20px rgba(37,99,235,.12)" : "none"}">
            <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
              <span style="font-size:13px;font-weight:900;color:${active ? "#1d4ed8" : "#0f172a"};line-height:1.25">${escapeHtml(name)}</span>
              <span style="min-width:28px;text-align:center;font-size:13px;font-weight:900;color:${active ? "#fff" : "#2563eb"};background:${active ? "#2563eb" : "#eff6ff"};border-radius:999px;padding:3px 8px">${count}</span>
            </div>
            <div style="font-size:11px;color:#64748b;margin-top:8px;line-height:1.4">${escapeHtml(desc)}</div>
            ${active ? `<div style="position:absolute;right:12px;bottom:10px;font-size:11px;font-weight:800;color:#2563eb">Сонгосон</div>` : ""}
          </button>`;
        }).join("")}
      </div>
    </div>

    <div style="display:flex;gap:10px;align-items:center;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin-bottom:12px">
      <input class="input" value="${escapeHtml(_hrOrderSearch)}" placeholder="🔍 Дугаар, гарчиг, ажилтан, төлөв хайх..."
        oninput="hrSetOrderSearch(this.value)" style="flex:1;min-width:260px;margin:0">
      <select class="input" onchange="hrSetOrderTypeFilter(this.value)" style="width:230px;margin:0">
        <option value="">Бүх төрөл</option>
        ${HR_ORDER_TYPES.map(t => `<option value="${escapeHtml(t)}" ${_hrOrderTypeFilter===t ? "selected" : ""}>${escapeHtml(t)}</option>`).join("")}
      </select>
      <button class="btn secondary sm" onclick="hrClearOrderFilters()">Цэвэрлэх</button>
      <div style="font-size:12px;color:#94a3b8">${filtered.length} / ${rows.length}</div>
    </div>

    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
      <div style="overflow-x:auto">
      <table style="width:100%;min-width:980px;border-collapse:collapse;font-size:13px">
        <thead><tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0">
          <th style="padding:10px 12px;text-align:left;font-size:11px;color:#475569">ОГНОО</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;color:#475569">ДУГААР</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;color:#475569">ТӨРӨЛ</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;color:#475569">ГАРЧИГ</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;color:#475569">ХОЛБООТОЙ АЖИЛТАН</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;color:#475569">СТАТУС</th>
          <th style="padding:10px 12px;text-align:center;font-size:11px;color:#475569">ҮЙЛДЭЛ</th>
        </tr></thead>
        <tbody>
          ${filtered.length ? filtered.map((r,i) => `
            <tr style="border-bottom:1px solid #f1f5f9;background:${i%2?"#fafbfc":"#fff"}">
              <td style="padding:10px 12px;color:#64748b;font-size:12px">${hrLetterFmtDate(r.doc_date)}</td>
              <td style="padding:10px 12px;font-weight:800;color:#334155">${escapeHtml(r.doc_no||"—")}</td>
              <td style="padding:10px 12px">${hrOrderTypePill(r.doc_type)}</td>
              <td style="padding:10px 12px">
                <div style="font-weight:800;color:#0f172a">${escapeHtml(r.title||"")}</div>
                ${r.description ? `<div style="font-size:11px;color:#64748b;margin-top:2px">${escapeHtml(String(r.description).slice(0,90))}${String(r.description).length>90?"...":""}</div>` : ""}
              </td>
              <td style="padding:10px 12px;color:#475569">${escapeHtml(r.related_name||"—")}</td>
              <td style="padding:10px 12px">${hrOrderStatusPill(r.status)}</td>
              <td style="padding:10px 12px;text-align:center;white-space:nowrap">
                ${/^https?:\/\//i.test(r.description || "") ? `<button class="btn secondary sm" onclick="window.open('${escapeHtml(r.description)}','_blank')">Эх сурвалж</button>` : ""}
                <button class="btn secondary sm" onclick="hrOrderLegalCheck(${r.id})">⚖️</button>
                <button class="btn secondary sm" onclick="hrOpenOrderScan(${r.id})">${canEdit ? "Файл" : "Харах"}</button>
                ${canEdit ? `<button class="btn secondary sm" onclick="hrEditOrder(${r.id})">Засах</button>
                <button class="btn secondary sm" style="color:#dc2626" onclick="hrDeleteOrder(${r.id})">Устгах</button>` : ""}
              </td>
            </tr>`).join("") : `<tr><td colspan="7" style="text-align:center;padding:36px;color:#94a3b8">Бодлогын бичиг баримт олдсонгүй</td></tr>`}
        </tbody>
      </table>
      </div>
    </div>
  </div>
  <div id="hrOrderModal" style="display:none;position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:1000;align-items:center;justify-content:center"></div>`;
}

function hrOpenOrderForm(data = {}) {
  const users = state.users || [];
  const m = document.getElementById("hrOrderModal");
  if (!m) return;
  const defaultType = data.doc_type || _hrOrderTypeFilter || "Захирлын тушаал";
  m.innerHTML = `
    <div style="background:#fff;border-radius:14px;width:min(620px,94vw);max-height:90vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.25);padding:24px">
      <div style="font-size:17px;font-weight:800;color:#0f172a;margin-bottom:16px">${data.id ? "Баримт засах" : "Бодлогын баримт бүртгэх"}</div>
      <input type="hidden" id="ho_id" value="${data.id||""}">
      <div class="row3" style="margin-bottom:10px">
        <div><div class="small muted">Төрөл</div><select class="input" id="ho_type">${HR_ORDER_TYPES.map(t=>`<option ${defaultType===t?'selected':''}>${t}</option>`).join("")}</select></div>
        <div><div class="small muted">Дугаар</div><input class="input" id="ho_no" value="${escapeHtml(data.doc_no||"")}" placeholder="А/01"></div>
        <div><div class="small muted">Огноо *</div><input class="input" id="ho_date" type="date" value="${data.doc_date||today()}"></div>
      </div>
      <div style="margin-bottom:10px"><div class="small muted">Гарчиг *</div><input class="input" id="ho_title" value="${escapeHtml(data.title||"")}" placeholder="Баримтын гарчиг"></div>
      <div class="row" style="margin-bottom:10px">
        <div><div class="small muted">Холбоотой ажилтан</div><select class="input" id="ho_user">
          <option value="">— Сонгох —</option>
          ${users.map(u=>`<option value="${u.id}" ${String(data.related_user||"")===String(u.id)?'selected':''}>${escapeHtml(u.full_name)}</option>`).join("")}
        </select></div>
        <div><div class="small muted">Статус</div><select class="input" id="ho_status">${HR_ORDER_STATUSES.map(s=>`<option ${((data.status||"Хүчинтэй")===s)?'selected':''}>${s}</option>`).join("")}</select></div>
      </div>
      <div style="margin-bottom:14px"><div class="small muted">Тайлбар</div><textarea class="input" id="ho_desc" rows="3" placeholder="Баримтын агуулга, эх сурвалж эсвэл тэмдэглэл">${escapeHtml(data.description||"")}</textarea></div>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button class="btn secondary" onclick="document.getElementById('hrOrderModal').style.display='none'">Цуцлах</button>
        <button class="btn" onclick="hrSaveOrder()">Хадгалах</button>
      </div>
    </div>`;
  m.style.display = "flex";
}

function hrEditOrder(id) {
  const row = (window._hrOrders || []).find(r => Number(r.id) === Number(id));
  if (row) hrOpenOrderForm(row);
}

function hrOpenOrderScan(id) {
  const row = (window._hrOrders || []).find(r => Number(r.id) === Number(id));
  if (!row) return toast("Баримт олдсонгүй");
  if (typeof window.openScanModal !== "function") return toast("Файл хавсаргах цонх ачаалагдаагүй байна");
  window.openScanModal("order", row.id, row.title || row.doc_no || "Бодлогын баримт");
}

function hrOpenKhuralImport() {
  document.getElementById("khuralImportModal")?.remove();
  document.body.insertAdjacentHTML("beforeend", `
    <div id="khuralImportModal" style="position:fixed;inset:0;background:rgba(15,23,42,.52);z-index:2200;display:flex;align-items:flex-start;justify-content:center;padding-top:38px;overflow:auto">
      <div style="background:#fff;border-radius:14px;width:min(980px,96vw);margin-bottom:42px;box-shadow:0 20px 60px rgba(0,0,0,.25);overflow:hidden">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:16px 20px;border-bottom:1px solid #e2e8f0;background:#f8fafc">
          <div><div style="font-size:16px;font-weight:800;color:#0f172a">ИТХ тогтоол татах</div><div style="font-size:12px;color:#64748b;margin-top:2px">dornod.khural.mn/togtool дээрээс манайд холбоотой тогтоол хайна</div></div>
          <button class="btn secondary sm" onclick="document.getElementById('khuralImportModal').remove()">Хаах</button>
        </div>
        <div style="padding:18px 20px">
          <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:end;margin-bottom:12px">
            <div><div class="small muted">Эх сурвалж URL</div><input class="input" id="khuralUrl" value="https://dornod.khural.mn/togtool" style="margin:0"></div>
            <div><div class="small muted">Түлхүүр үг</div><input class="input" id="khuralQ" value="Чойбалсан хөгжил,ОНӨҮГ,ОНӨААТҮГ,хөрөнгө,өмч" style="margin:0"></div>
            <button class="btn" onclick="hrSearchKhuralResolutions()">Хайх</button>
          </div>
          <div id="khuralImportBody" style="border:1px dashed #cbd5e1;border-radius:10px;padding:28px;text-align:center;color:#94a3b8">Хайлт хийнэ үү</div>
        </div>
      </div>
    </div>`);
}

async function hrSearchKhuralResolutions() {
  const body = document.getElementById("khuralImportBody");
  const url = document.getElementById("khuralUrl")?.value.trim() || "https://dornod.khural.mn/togtool";
  const q = document.getElementById("khuralQ")?.value.trim() || "Чойбалсан хөгжил";
  if (body) body.innerHTML = `<div style="color:#64748b">Татаж байна...</div>`;
  try {
    const data = await api(`/api/khural-resolutions/search?url=${encodeURIComponent(url)}&q=${encodeURIComponent(q)}`);
    const rows = data.rows || [];
    if (!body) return;
    body.innerHTML = rows.length ? `
      <div style="font-size:12px;color:#64748b;margin-bottom:10px">Нийт ${data.total || 0} тогтоолоос ${rows.length} тохирлоо</div>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0"><th style="padding:9px;text-align:left">Огноо</th><th style="padding:9px;text-align:left">Дугаар</th><th style="padding:9px;text-align:left">Гарчиг</th><th style="padding:9px;text-align:center">Үйлдэл</th></tr></thead>
        <tbody>${rows.map((r,i) => `<tr style="border-bottom:1px solid #f1f5f9"><td style="padding:9px;color:#64748b">${escapeHtml(r.doc_date || "")}</td><td style="padding:9px;font-weight:800">${escapeHtml(r.doc_no || "—")}</td><td style="padding:9px"><div style="font-weight:800;color:#0f172a">${escapeHtml(r.title || "")}</div><div style="font-size:11px;color:#94a3b8">${escapeHtml(r.source_url || "")}</div></td><td style="padding:9px;text-align:center"><button class="btn secondary sm" onclick='hrImportKhuralResolution(${JSON.stringify(r).replace(/'/g,"&#39;")})'>Импорт</button></td></tr>`).join("")}</tbody>
      </table></div>` : `<div style="color:#94a3b8;text-align:center;padding:24px">Тохирох тогтоол олдсонгүй. Түлхүүр үгээ өөрчилж хайгаарай.</div>`;
  } catch(e) {
    if (body) body.innerHTML = `<div style="color:#dc2626">Алдаа: ${escapeHtml(e.message)}</div>`;
  }
}

async function hrImportKhuralResolution(row) {
  try {
    const r = await api("/api/khural-resolutions/import", { method:"POST", body:JSON.stringify(row) });
    toast(r.duplicate ? "Өмнө импортлогдсон байна" : "ИТХ тогтоол импортлогдлоо");
    await hrRenderOrders();
  } catch(e) { toast("Алдаа: " + e.message); }
}

async function hrOrderLegalCheck(id) {
  try {
    const data = await api(`/api/admin-hub/orders/${id}/legal-check`, { method:"POST" });
    hrLetterAiModal("⚖️ Өмнөх баримттай тулгасан шүүлт", legalFilterResultHtml({
      doc_name: data.doc_name || "Бодлогын баримт",
      summary: data.summary,
      results: data.results || [],
      ai_used: data.ai_used
    }));
  } catch(e) { toast("Алдаа: " + e.message); }
}

async function hrSaveOrder() {
  const id = document.getElementById("ho_id")?.value;
  const body = {
    doc_type: document.getElementById("ho_type")?.value,
    doc_no: document.getElementById("ho_no")?.value.trim(),
    doc_date: document.getElementById("ho_date")?.value,
    title: document.getElementById("ho_title")?.value.trim(),
    related_user: document.getElementById("ho_user")?.value,
    status: document.getElementById("ho_status")?.value,
    description: document.getElementById("ho_desc")?.value.trim(),
  };
  if (!body.title || !body.doc_date) { toast("Гарчиг болон огноо оруулна уу"); return; }
  try {
    if (id) await api(`/api/admin-hub/orders/${id}`, { method:"PUT", body:JSON.stringify(body) });
    else await api("/api/admin-hub/orders", { method:"POST", body:JSON.stringify(body) });
    toast("Баримт хадгалагдлаа");
    document.getElementById("hrOrderModal").style.display = "none";
    hrRenderOrders();
  } catch(e) { toast("Алдаа: " + e.message); }
}

async function hrDeleteOrder(id) {
  if (!confirm("Энэ баримтыг устгах уу?")) return;
  try {
    await api(`/api/admin-hub/orders/${id}`, { method:"DELETE" });
    toast("Устгагдлаа");
    hrRenderOrders();
  } catch(e) { toast("Алдаа: " + e.message); }
}

Object.assign(window, { hrRenderOrders, hrSetOrderTypeFilter, hrSetOrderSearch, hrClearOrderFilters, hrOpenOrderForm, hrEditOrder, hrOpenOrderScan, hrSaveOrder, hrDeleteOrder,
  hrOpenKhuralImport, hrSearchKhuralResolutions, hrImportKhuralResolution, hrOrderLegalCheck });

let _legalFilterHistory = [];
let _legalFilterSources = [];
let _legalFilterDomains = [];
let _legalFilterResult = null;
let _legalAskResult = null;
let _legalAiStatus = null;
let _legalAdviceResult = null;
let _legalDraftResult = null;
const LEGAL_FILTER_META = {
  "Эрсдэлтэй заалт": { icon:"🔴", color:"#dc2626", bg:"#fef2f2", border:"#fecaca" },
  "Зөрчилдөж болзошгүй заалт": { icon:"🟠", color:"#d97706", bg:"#fff7ed", border:"#fed7aa" },
  "Ойлгомжгүй нэр томьёо": { icon:"🟡", color:"#a16207", bg:"#fefce8", border:"#fde68a" },
  "Давхардсан зохицуулалт": { icon:"🔵", color:"#2563eb", bg:"#eff6ff", border:"#bfdbfe" },
  "Сайжруулах санал": { icon:"🟢", color:"#16a34a", bg:"#f0fdf4", border:"#bbf7d0" },
};

function legalFilterLevelPill(level) {
  const c = level === "Өндөр" ? "#dc2626" : level === "Дунд" ? "#d97706" : "#16a34a";
  return `<span style="padding:3px 9px;border-radius:999px;background:${c}18;color:${c};font-size:11px;font-weight:800">${escapeHtml(level || "Бага")}</span>`;
}

function legalFilterSourceLabel(s) {
  const map = { contract:"Гэрээ", letter:"Албан бичиг", order:"Бодлогын бичиг баримт", document:"Баримт" };
  return `${map[s.source_type] || "ERP"} · ${[s.doc_no, s.title].filter(Boolean).join(" · ")}`;
}

function legalFilterImportedOrders() {
  return (_legalFilterSources || []).filter(s => s.source_type === "order" && /ИТХ|тогтоол/i.test([s.type, s.title].join(" ")));
}

function legalFilterResultHtml(data) {
  if (!data) {
    return `<div style="background:#fff;border:1px dashed #cbd5e1;border-radius:12px;padding:32px;text-align:center;color:#94a3b8">
      <div style="font-size:32px;margin-bottom:8px">⚖️</div>
      Шүүлт хийсний дараа эрсдэл, зөрчил, нэр томьёо, давхардал, санал энд харагдана
    </div>`;
  }
  const grouped = Object.keys(LEGAL_FILTER_META).map(cat => [cat, (data.results || []).filter(r => r.category === cat)]);
  return `<div style="display:flex;flex-direction:column;gap:10px">
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:center">
        <div style="font-weight:800;color:#0f172a">${escapeHtml(data.doc_name || "Шинжилгээ")}</div>
        <div style="font-size:11px;font-weight:800;color:${data.ai_used ? "#16a34a" : "#64748b"};background:${data.ai_used ? "#dcfce7" : "#f1f5f9"};border-radius:999px;padding:4px 9px">${data.ai_used ? "OPENAI" : "RULE"}</div>
      </div>
      <div style="font-size:12px;color:#64748b;margin-top:4px">${escapeHtml(data.summary || "")}</div>
    </div>
    ${grouped.map(([cat, rows]) => {
      const m = LEGAL_FILTER_META[cat];
      return `<div style="background:#fff;border:1px solid ${m.border};border-radius:12px;overflow:hidden">
        <div style="padding:10px 14px;background:${m.bg};color:${m.color};font-weight:800;font-size:13px">${m.icon} ${cat} · ${rows.length}</div>
        ${rows.length ? rows.map(r => `<div style="padding:13px 14px;border-top:1px solid ${m.border}">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px"><div style="font-weight:800;color:#0f172a">Эрсдэлийн түвшин</div>${legalFilterLevelPill(r.level)}</div>
          <div style="font-size:11px;color:#64748b;font-weight:700;margin-bottom:4px">Баримтын хэсэг</div>
          <div style="font-size:12px;color:#334155;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:9px 10px;margin-bottom:8px">${escapeHtml(r.section || "—")}</div>
          <div style="font-size:11px;color:#64748b;font-weight:700;margin-bottom:4px">AI тайлбар</div>
          <div style="font-size:12px;color:#475569;margin-bottom:8px">${escapeHtml(r.explanation || "")}</div>
          <div style="font-size:11px;color:#64748b;font-weight:700;margin-bottom:4px">Санал болгож буй өөрчлөлт</div>
          <div style="font-size:12px;color:#0f172a;font-weight:600">${escapeHtml(r.suggestion || "")}</div>
        </div>`).join("") : `<div style="padding:14px;color:#94a3b8;font-size:12px">Илрээгүй</div>`}
      </div>`;
    }).join("")}
  </div>`;
}

function legalFilterSourceTypeLabel(type) {
  return ({ contract:"Гэрээ", letter:"Албан бичиг", order:"Бодлогын бичиг баримт", document:"Баримт" })[type] || "ERP";
}

function legalFilterAskHtml() {
  const matches = _legalAskResult?.matches || [];
  const topRef = _legalAskResult?.answer_source_type && _legalAskResult?.answer_source_id ? `${_legalAskResult.answer_source_type}:${_legalAskResult.answer_source_id}` : "";
  const topUrl = _legalAskResult?.answer_source_url || "";
  return `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:12px">
        <div>
          <div style="font-weight:800;color:#0f172a">Баримтаас асуух</div>
          <div style="font-size:12px;color:#64748b;margin-top:3px">Цуглуулсан тогтоол, журам, тушаал, гэрээ, албан бичгээс эх сурвалжтай хариу хайна</div>
        </div>
        <button class="btn secondary sm" onclick="document.getElementById('lfAskQ').value='';window._lastLegalAsk='';_legalAskResult=null;hrRenderLegalFilter()">Цэвэрлэх</button>
      </div>
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:12px">
        <input class="input" id="lfAskQ" value="${escapeHtml(window._lastLegalAsk || "")}" placeholder="Жишээ: Камерын үйлчилгээний тариф хэд вэ?" onkeydown="if(event.key==='Enter')legalFilterAsk()" style="flex:1;margin:0">
        <button class="btn" id="lfAskBtn" onclick="legalFilterAsk()">Асуух</button>
      </div>
      ${_legalAskResult ? `
        <div style="border:1px solid #bfdbfe;background:#eff6ff;border-radius:10px;padding:14px 16px;margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;margin-bottom:8px">
            <div>
              <div style="font-size:11px;color:#1d4ed8;font-weight:900;margin-bottom:5px">ХАРИУ ${_legalAskResult.ai_used ? "· OPENAI" : "· ХАЙЛТ"}</div>
              <div style="font-size:14px;color:#0f172a;font-weight:900">${escapeHtml(_legalAskResult.answer_ref || "Баримт")}</div>
              <div style="font-size:12px;color:#475569;margin-top:3px">${escapeHtml(_legalAskResult.answer_title || "")}${_legalAskResult.answer_date ? ` · ${escapeHtml(String(_legalAskResult.answer_date).slice(0,10))}` : ""}</div>
            </div>
            <div style="display:flex;gap:7px;flex-wrap:wrap">
              ${topRef ? `<button class="btn sm" onclick="legalFilterAnalyzeSource('${escapeHtml(topRef)}')">Шүүлтэд оруулах</button>` : ""}
              ${topUrl ? `<button class="btn secondary sm" onclick='legalFilterOpenAskSource(${JSON.stringify(topUrl).replace(/'/g,"&#39;")})'>Эх сурвалж</button>` : ""}
            </div>
          </div>
          <div style="font-size:13px;color:#0f172a;line-height:1.55;font-weight:600;background:#fff;border:1px solid #dbeafe;border-radius:8px;padding:10px 12px">${escapeHtml(_legalAskResult.answer_snippet || _legalAskResult.answer || "")}</div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:8px">
          ${matches.map(m => `<div style="border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;background:#f8fafc">
            <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:4px">
              <span style="font-size:11px;font-weight:800;color:#2563eb">${escapeHtml([m.type, m.doc_no].filter(Boolean).join(" ") || legalFilterSourceTypeLabel(m.source_type))}</span>
              <span style="font-size:10px;color:#94a3b8">оноо ${m.score}</span>
            </div>
            <div style="font-size:12px;font-weight:800;color:#0f172a;margin-bottom:3px">${escapeHtml(m.title || "Гарчиггүй")}</div>
            <div style="font-size:10px;color:#94a3b8;margin-bottom:6px">${escapeHtml(String(m.doc_date || "").slice(0,10))}</div>
            <div style="font-size:11px;color:#64748b;line-height:1.4;margin-bottom:9px">${escapeHtml(m.snippet || "")}</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button class="btn secondary sm" onclick="legalFilterAnalyzeSource('${escapeHtml(m.source_ref || `${m.source_type}:${m.id}`)}')">Шүүлт</button>
              ${m.source_url ? `<button class="btn secondary sm" onclick='legalFilterOpenAskSource(${JSON.stringify(m.source_url).replace(/'/g,"&#39;")})'>Эх сурвалж</button>` : ""}
            </div>
          </div>`).join("")}
        </div>` : `
        <div style="border:1px dashed #cbd5e1;border-radius:10px;padding:18px;text-align:center;color:#94a3b8;font-size:12px">
          Асуулт асуувал хамгийн ойр баримт, ишлэл маягийн хэсгийг энд харуулна
        </div>`}
    </div>`;
}

function legalAdviceHtml() {
  const decisionColor = _legalAdviceResult?.decision === "Баталж болно" ? "#16a34a" : _legalAdviceResult?.decision === "Засварлаад батална" ? "#d97706" : "#dc2626";
  return `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:12px">
        <div>
          <div style="font-weight:800;color:#0f172a">Хуульч AI-аас зөвлөгөө авах</div>
          <div style="font-size:12px;color:#64748b;margin-top:3px">Баримт батлахын өмнө эрсдэл, холбогдох хууль, засах саналыг зөвлөх горимоор асууна</div>
        </div>
        <button class="btn secondary sm" onclick="_legalAdviceResult=null;hrRenderLegalFilter()">Цэвэрлэх</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
        <div><div class="small muted">ERP баримт сонгох</div><select class="input" id="lawyerSource" style="margin:0"><option value="">— Сонгохгүй —</option>${_legalFilterSources.map(s => `<option value="${s.source_type}:${s.id}">${escapeHtml(legalFilterSourceLabel(s))}</option>`).join("")}</select></div>
        <div><div class="small muted">Асуух зүйл</div><input class="input" id="lawyerQuestion" value="Энэ баримтыг баталж болох уу?" style="margin:0"></div>
      </div>
      <div style="margin-bottom:10px"><div class="small muted">Text paste</div><textarea class="input" id="lawyerText" rows="4" placeholder="Шинэ тушаал, журам, гэрээний заалтыг энд paste хийж зөвлөгөө авч болно..." style="margin:0;resize:vertical"></textarea></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" id="lawyerAskBtn" onclick="legalAdviceAsk()">Зөвлөгөө авах</button>
        <button class="btn secondary" id="lawyerDraftBtn" onclick="legalDraftAsk()">Засварын draft гаргах</button>
      </div>
      ${_legalAdviceResult ? `
        <div style="margin-top:12px;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;background:#f8fafc;padding:12px 14px;border-bottom:1px solid #e2e8f0">
            <div>
              <div style="font-size:11px;font-weight:900;color:${_legalAdviceResult.ai_used ? "#15803d" : "#64748b"}">${_legalAdviceResult.ai_used ? "OPENAI ЗӨВЛӨГӨӨ" : "RULE ЗӨВЛӨГӨӨ"}</div>
              <div style="font-size:14px;font-weight:900;color:#0f172a;margin-top:3px">${escapeHtml(_legalAdviceResult.doc_name || "Баримт")}</div>
            </div>
            <div style="font-size:12px;font-weight:900;color:#fff;background:${decisionColor};border-radius:999px;padding:6px 10px">${escapeHtml(_legalAdviceResult.decision || "Шалгана")}</div>
          </div>
          <div style="padding:14px">
            <div style="font-size:13px;color:#0f172a;line-height:1.55;font-weight:600;margin-bottom:12px">${escapeHtml(_legalAdviceResult.answer || "")}</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px">
              ${legalAdviceList("Эрсдэл", _legalAdviceResult.risks, "#dc2626")}
              ${legalAdviceList("Холбогдох хууль/журам", _legalAdviceResult.related_laws, "#2563eb")}
              ${legalAdviceList("Засах санал", _legalAdviceResult.suggestions, "#16a34a")}
              ${legalAdviceList("Дутуу мэдээлэл", _legalAdviceResult.missing, "#d97706")}
            </div>
          </div>
        </div>` : ""}
      ${_legalDraftResult ? `
        <div style="margin-top:12px;border:1px solid #bbf7d0;border-radius:12px;overflow:hidden">
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;background:#f0fdf4;padding:12px 14px;border-bottom:1px solid #bbf7d0">
            <div>
              <div style="font-size:11px;font-weight:900;color:${_legalDraftResult.ai_used ? "#15803d" : "#64748b"}">${_legalDraftResult.ai_used ? "OPENAI DRAFT" : "RULE DRAFT"}</div>
              <div style="font-size:14px;font-weight:900;color:#0f172a;margin-top:3px">${escapeHtml(_legalDraftResult.draft_title || "Засварын draft")}</div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
              <button class="btn secondary sm" onclick="legalDraftCopy()">Хуулах</button>
              <button class="btn sm" onclick="legalDraftSaveAsPolicy()">Бодлогын баримт болгох</button>
            </div>
          </div>
          <div style="padding:14px">
            ${_legalDraftResult.original_issue ? `<div style="font-size:12px;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:9px 10px;margin-bottom:10px">${escapeHtml(_legalDraftResult.original_issue)}</div>` : ""}
            <div style="font-size:11px;color:#64748b;font-weight:800;margin-bottom:5px">ЗАСВАРЛАСАН DRAFT</div>
            <div id="legalDraftText" style="white-space:pre-wrap;font-size:13px;line-height:1.55;color:#0f172a;background:#fff;border:1px solid #d1fae5;border-radius:10px;padding:12px;margin-bottom:10px">${escapeHtml(_legalDraftResult.revised_text || "")}</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px">
              ${legalAdviceList("Яагаад ингэж зассан", _legalDraftResult.rationale, "#16a34a")}
              ${legalAdviceList("Батлахаас өмнөх checklist", _legalDraftResult.checklist, "#2563eb")}
            </div>
          </div>
        </div>` : ""}
    </div>`;
}

function legalAdviceList(title, rows = [], color = "#64748b") {
  return `<div style="border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;background:#fff">
    <div style="font-size:12px;font-weight:900;color:${color};margin-bottom:7px">${title}</div>
    ${rows?.length ? rows.map(x => `<div style="font-size:12px;color:#334155;line-height:1.45;border-top:1px solid #f1f5f9;padding:7px 0">${escapeHtml(x)}</div>`).join("") : `<div style="font-size:12px;color:#94a3b8">Илрээгүй</div>`}
  </div>`;
}

function legalHistoryStatusPill(status) {
  const colors = {
    "Шинэ": "#2563eb",
    "Шинжилсэн": "#2563eb",
    "Засах шаардлагатай": "#dc2626",
    "Зассан": "#16a34a",
    "Баталсан": "#0f766e",
    "Архивласан": "#64748b"
  };
  const c = colors[status] || "#64748b";
  return `<span style="display:inline-flex;align-items:center;justify-content:center;border-radius:999px;background:${c}18;color:${c};font-size:11px;font-weight:900;padding:4px 9px;white-space:nowrap">${escapeHtml(status || "Шинэ")}</span>`;
}

function legalHistoryHtml() {
  const rows = _legalFilterHistory || [];
  const openCount = rows.filter(r => !["Зассан", "Баталсан", "Архивласан"].includes(r.status)).length;
  const fixedCount = rows.filter(r => Number(r.improved || 0) || ["Зассан", "Баталсан"].includes(r.status)).length;
  return `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;margin-top:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding:14px 16px;border-bottom:1px solid #e2e8f0">
        <div>
          <div style="font-weight:900;color:#0f172a">Шүүлтийн түүх ба workflow</div>
          <div style="font-size:12px;color:#64748b;margin-top:2px">AI илрүүлсэн эрсдэлийг HR ажил болгож тэмдэглэнэ</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <span style="font-size:12px;font-weight:900;color:#2563eb;background:#eff6ff;border:1px solid #bfdbfe;border-radius:999px;padding:6px 10px">Нээлттэй: ${openCount}</span>
          <span style="font-size:12px;font-weight:900;color:#16a34a;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:999px;padding:6px 10px">Зассан/баталсан: ${fixedCount}</span>
        </div>
      </div>
      <div style="overflow-x:auto"><table style="width:100%;min-width:1120px;border-collapse:collapse;font-size:13px">
        <thead><tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0">
          <th style="padding:10px 12px;text-align:left;font-size:11px;color:#475569">ОГНОО</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;color:#475569">ШАЛГАСАН</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;color:#475569">БАРИМТ</th>
          <th style="padding:10px 12px;text-align:center;font-size:11px;color:#475569">ДҮН</th>
          <th style="padding:10px 12px;text-align:center;font-size:11px;color:#475569">СТАТУС</th>
          <th style="padding:10px 12px;text-align:center;font-size:11px;color:#475569">ҮЙЛДЭЛ</th>
        </tr></thead>
        <tbody>${rows.length ? rows.map(r => `
          <tr style="border-bottom:1px solid #f1f5f9">
            <td style="padding:10px 12px;color:#64748b">${String(r.created_at || "").slice(0, 16)}</td>
            <td style="padding:10px 12px;color:#475569">${escapeHtml(r.created_name || "—")}</td>
            <td style="padding:10px 12px;min-width:320px">
              <div style="font-weight:900;color:#0f172a">${escapeHtml(r.doc_name || "—")}</div>
              <div style="font-size:11px;color:#64748b;line-height:1.4;margin-top:2px">${escapeHtml(String(r.summary || "").slice(0, 150))}${String(r.summary || "").length > 150 ? "..." : ""}</div>
            </td>
            <td style="padding:10px 12px;text-align:center;font-weight:900;white-space:nowrap">
              <span style="color:#dc2626">${r.risk_count || 0}</span>
              <span style="color:#cbd5e1"> / </span>
              <span style="color:#d97706">${r.conflict_count || 0}</span>
              <span style="color:#cbd5e1"> / </span>
              <span style="color:#2563eb">${r.duplicate_count || 0}</span>
            </td>
            <td style="padding:10px 12px;text-align:center">${legalHistoryStatusPill(r.status || (Number(r.improved || 0) ? "Зассан" : "Шинэ"))}</td>
            <td style="padding:10px 12px;text-align:center;white-space:nowrap">
              <button class="btn secondary sm" onclick="legalFilterOpenHistory(${r.id})">Дэлгэрэнгүй</button>
              <button class="btn secondary sm" onclick="legalFilterSetHistoryStatus(${r.id}, 'Засах шаардлагатай')">Засах</button>
              <button class="btn secondary sm" onclick="legalFilterSetHistoryStatus(${r.id}, 'Зассан')">Зассан</button>
              <button class="btn secondary sm" onclick="legalFilterSetHistoryStatus(${r.id}, 'Баталсан')">Баталсан</button>
              <button class="btn secondary sm" onclick="legalFilterSetHistoryStatus(${r.id}, 'Архивласан')">Архив</button>
            </td>
          </tr>`).join("") : `<tr><td colspan="6" style="text-align:center;padding:34px;color:#94a3b8">Шүүлтийн түүх алга</td></tr>`}</tbody>
      </table></div>
    </div>`;
}

async function hrRenderLegalFilter(tc) {
  if (!tc) tc = document.getElementById("hrTabContent");
  if (!tc) return;
  tc.innerHTML = `<div style="padding:28px;color:#94a3b8">Уншиж байна...</div>`;
  [_legalFilterHistory, _legalFilterSources, _legalFilterDomains, _legalAiStatus] = await Promise.all([
    api("/api/legal-filter/history").catch(() => []),
    api("/api/legal-filter/sources").catch(() => []),
    api("/api/legal-filter/domains").catch(() => []),
    api("/api/assistant/status").catch(() => null),
  ]);
  const totals = _legalFilterHistory.reduce((a, r) => {
    a.docs += 1; a.risks += Number(r.risk_count || 0); a.conflicts += Number(r.conflict_count || 0); a.improved += Number(r.improved || 0);
    return a;
  }, { docs:0, risks:0, conflicts:0, improved:0 });
  const importedOrders = legalFilterImportedOrders();
  tc.innerHTML = `
  <div style="padding:20px 24px;background:#f8fafc">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:16px">
      <div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <div style="font-size:18px;font-weight:800;color:#0f172a">⚖️ Хуулийн шүүлтүүр</div>
          <span style="font-size:11px;font-weight:900;color:${_legalAiStatus?.ai_enabled ? "#15803d" : "#64748b"};background:${_legalAiStatus?.ai_enabled ? "#dcfce7" : "#f1f5f9"};border:1px solid ${_legalAiStatus?.ai_enabled ? "#bbf7d0" : "#e2e8f0"};border-radius:999px;padding:4px 9px">
            ${_legalAiStatus?.ai_enabled ? `OPENAI · ${escapeHtml(_legalAiStatus.model || "AI")}` : "OPENAI OFF"}
          </span>
        </div>
        <div style="font-size:12px;color:#64748b;margin-top:3px">Журам, тушаал, тогтоол, гэрээ, албан бичгийн эрсдэлтэй болон ойлгомжгүй заалтыг AI шүүлтээр илрүүлэх</div>
      </div>
      <button class="btn" onclick="legalFilterAnalyze()">Шүүлт хийх</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,minmax(130px,1fr));gap:12px;margin-bottom:14px">
      ${[["Нийт шалгасан баримт",totals.docs,"#2563eb"],["Илэрсэн эрсдэл",totals.risks,"#dc2626"],["Зөрчилтэй заалт",totals.conflicts,"#d97706"],["Сайжруулсан баримт",totals.improved,"#16a34a"]].map(([label,value,color]) => `
        <div style="background:#fff;border:1px solid #e2e8f0;border-top:3px solid ${color};border-radius:10px;padding:12px 14px"><div style="font-size:24px;font-weight:800;color:${color};line-height:1">${value}</div><div style="font-size:11px;color:#64748b;margin-top:6px;font-weight:700">${label}</div></div>`).join("")}
    </div>
    ${legalFilterAskHtml()}
    ${legalAdviceHtml()}
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid #e2e8f0">
        <div>
          <div style="font-weight:800;color:#0f172a">Импортолсон ИТХ тогтоолууд</div>
          <div style="font-size:12px;color:#64748b;margin-top:2px">Бодлогын бичиг баримтаас татсан тогтоолуудыг эндээс шууд шүүлтэд ашиглана</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn secondary sm" onclick="legalFilterManualOrder()">Гараар нэмэх</button>
          <button class="btn secondary sm" onclick="hrSwTab('orders')">Тогтоол импортлох</button>
        </div>
      </div>
      <div style="overflow-x:auto">
        <table style="width:100%;min-width:860px;border-collapse:collapse;font-size:13px">
          <thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0">
            <th style="padding:9px 12px;text-align:left;color:#475569;font-size:11px">ДУГААР</th>
            <th style="padding:9px 12px;text-align:left;color:#475569;font-size:11px">ГАРЧИГ</th>
            <th style="padding:9px 12px;text-align:left;color:#475569;font-size:11px">ТӨРӨЛ</th>
            <th style="padding:9px 12px;text-align:center;color:#475569;font-size:11px">ҮЙЛДЭЛ</th>
          </tr></thead>
          <tbody>${importedOrders.length ? importedOrders.slice(0, 8).map(s => `
            <tr style="border-bottom:1px solid #f1f5f9">
              <td style="padding:9px 12px;font-weight:800;color:#334155">${escapeHtml(s.doc_no || "—")}</td>
              <td style="padding:9px 12px"><div style="font-weight:800;color:#0f172a">${escapeHtml(s.title || "")}</div><div style="font-size:11px;color:#94a3b8">${escapeHtml(s.extra || "")}</div></td>
              <td style="padding:9px 12px;color:#475569">${escapeHtml(s.type || "ИТХ-ын тогтоол")}</td>
              <td style="padding:9px 12px;text-align:center;white-space:nowrap">
                <button class="btn secondary sm" onclick="legalFilterPickSource('order:${s.id}')">Сонгох</button>
                <button class="btn sm" onclick="legalFilterAnalyzeSource('order:${s.id}')">Шүүлт хийх</button>
              </td>
            </tr>`).join("") : `<tr><td colspan="4" style="padding:24px;text-align:center;color:#94a3b8">Импортолсон ИТХ тогтоол алга. Бодлогын бичиг баримтаас импортлоорой.</td></tr>`}</tbody>
        </table>
      </div>
    </div>
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;margin-bottom:14px">
      <div style="font-weight:800;color:#0f172a;margin-bottom:8px">Хөндлөнгийн аудитын хамрах хууль, чиглэл</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px">
        ${_legalFilterDomains.map(d => `<div style="border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;background:#f8fafc">
          <div style="font-size:12px;font-weight:800;color:#1d4ed8;margin-bottom:4px">${escapeHtml(d.law)}</div>
          <div style="font-size:11px;color:#64748b;line-height:1.45">${escapeHtml(d.scope || "")}</div>
        </div>`).join("")}
      </div>
      <div style="font-size:11px;color:#94a3b8;margin-top:8px">Тайлбар: Энэ нь хуульчийн эцсийн дүгнэлт биш, баримтыг урьдчилан шалгах аудитын туслах checklist юм.</div>
    </div>
    <div style="display:grid;grid-template-columns:minmax(320px,.85fr) minmax(420px,1.15fr);gap:14px;align-items:start">
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px">
        <div style="font-weight:800;color:#0f172a;margin-bottom:12px">Баримт оруулах</div>
        <div style="display:grid;grid-template-columns:1fr;gap:10px">
          <div><div class="small muted">Баримтын нэр</div><input class="input" id="lfDocName" placeholder="Жишээ: Дотоод журам 2026" style="margin:0"></div>
          <div><div class="small muted">PDF / DOCX upload</div><input class="input" id="lfFile" type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" style="margin:0"></div>
          <div><div class="small muted">ERP дээр хадгалсан баримт сонгох</div><select class="input" id="lfSource" style="margin:0"><option value="">— Сонгохгүй —</option>${_legalFilterSources.map(s => `<option value="${s.source_type}:${s.id}">${escapeHtml(legalFilterSourceLabel(s))}</option>`).join("")}</select></div>
          <div><div class="small muted">Text paste</div><textarea class="input" id="lfText" rows="9" placeholder="Шинжлэх заалт, гэрээний хэсэг эсвэл журмын текстээ энд paste хийнэ..." style="margin:0;resize:vertical"></textarea></div>
          <button class="btn" id="lfAnalyzeBtn" onclick="legalFilterAnalyze()">Шүүлт хийх</button>
        </div>
      </div>
      <div id="legalFilterResultBox">${legalFilterResultHtml(_legalFilterResult)}</div>
    </div>
    ${legalHistoryHtml()}
  </div>`;
}

async function legalFilterAnalyze() {
  const fd = new FormData();
  const name = document.getElementById("lfDocName")?.value.trim();
  const text = document.getElementById("lfText")?.value.trim();
  const file = document.getElementById("lfFile")?.files?.[0];
  const src = document.getElementById("lfSource")?.value || "";
  if (name) fd.append("doc_name", name);
  if (text) fd.append("text", text);
  if (file) fd.append("file", file);
  if (src) { const [sourceType, sourceId] = src.split(":"); fd.append("source_type", sourceType); fd.append("source_id", sourceId); }
  if (!text && !file && !src) return toast("Текст, файл эсвэл ERP баримт сонгоно уу");
  const btn = document.getElementById("lfAnalyzeBtn");
  try {
    if (btn) { btn.disabled = true; btn.textContent = "Шүүж байна..."; }
    const token = localStorage.getItem("token");
    const resp = await fetch("/api/legal-filter/analyze", { method:"POST", headers:{ Authorization:`Bearer ${token}` }, body:fd });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Шүүлт хийхэд алдаа гарлаа");
    _legalFilterResult = data;
    toast("Шүүлт дууслаа");
    await hrRenderLegalFilter();
  } catch(e) { toast("Алдаа: " + e.message); }
  finally { if (btn) { btn.disabled = false; btn.textContent = "Шүүлт хийх"; } }
}

async function legalFilterAsk() {
  const q = document.getElementById("lfAskQ")?.value.trim();
  if (!q) return toast("Асуулт оруулна уу");
  window._lastLegalAsk = q;
  const btn = document.getElementById("lfAskBtn");
  try {
    if (btn) { btn.disabled = true; btn.textContent = "Хайж байна..."; }
    _legalAskResult = await api("/api/legal-filter/ask", { method:"POST", body:JSON.stringify({ question:q }) });
    await hrRenderLegalFilter();
  } catch(e) {
    toast("Алдаа: " + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Асуух"; }
  }
}

function legalFilterOpenAskSource(url) {
  if (!url) return toast("Эх сурвалжийн холбоос алга");
  window.open(url, "_blank");
}

async function legalAdviceAsk() {
  const src = document.getElementById("lawyerSource")?.value || "";
  const question = document.getElementById("lawyerQuestion")?.value.trim() || "Энэ баримтыг баталж болох уу?";
  const text = document.getElementById("lawyerText")?.value.trim() || "";
  const body = { question, text };
  if (src) {
    const [source_type, source_id] = src.split(":");
    body.source_type = source_type;
    body.source_id = source_id;
  }
  if (!text && !src) return toast("ERP баримт сонгох эсвэл текст paste хийнэ үү");
  const btn = document.getElementById("lawyerAskBtn");
  try {
    if (btn) { btn.disabled = true; btn.textContent = "Зөвлөж байна..."; }
    _legalAdviceResult = await api("/api/legal-filter/advice", { method:"POST", body:JSON.stringify(body) });
    await hrRenderLegalFilter();
  } catch(e) {
    toast("Алдаа: " + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Зөвлөгөө авах"; }
  }
}

async function legalDraftAsk() {
  const src = document.getElementById("lawyerSource")?.value || "";
  const instruction = document.getElementById("lawyerQuestion")?.value.trim() || "Энэ заалтыг засварын draft болгож өг.";
  const text = document.getElementById("lawyerText")?.value.trim() || "";
  const body = { instruction, text };
  if (src) {
    const [source_type, source_id] = src.split(":");
    body.source_type = source_type;
    body.source_id = source_id;
  }
  if (!text && !src) return toast("ERP баримт сонгох эсвэл текст paste хийнэ үү");
  const btn = document.getElementById("lawyerDraftBtn");
  try {
    if (btn) { btn.disabled = true; btn.textContent = "Draft гаргаж байна..."; }
    _legalDraftResult = await api("/api/legal-filter/draft", { method:"POST", body:JSON.stringify(body) });
    await hrRenderLegalFilter();
  } catch(e) {
    toast("Алдаа: " + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Засварын draft гаргах"; }
  }
}

async function legalDraftCopy() {
  const text = _legalDraftResult?.revised_text || document.getElementById("legalDraftText")?.textContent || "";
  if (!text) return toast("Хуулах draft алга");
  try {
    await navigator.clipboard.writeText(text);
    toast("Draft clipboard-д хуулагдлаа");
  } catch(_) {
    toast("Clipboard-д хуулах боломжгүй байна");
  }
}

async function legalDraftSaveAsPolicy() {
  const draft = _legalDraftResult || {};
  const text = String(draft.revised_text || "").trim();
  if (!text) return toast("Хадгалах draft алга");
  const titleBase = String(draft.draft_title || draft.doc_name || "AI засварын draft").trim();
  const rationale = Array.isArray(draft.rationale) && draft.rationale.length
    ? `\n\nAI тайлбар:\n- ${draft.rationale.join("\n- ")}`
    : "";
  const checklist = Array.isArray(draft.checklist) && draft.checklist.length
    ? `\n\nБатлахаас өмнөх checklist:\n- ${draft.checklist.join("\n- ")}`
    : "";
  const body = {
    doc_no: `AI-DRAFT-${today().replaceAll("-", "")}`,
    title: titleBase,
    doc_type: "AI засварын draft",
    doc_date: today(),
    status: "Хүчинтэй",
    description: `${text}${rationale}${checklist}`
  };
  try {
    const saved = await api("/api/admin-hub/orders", { method:"POST", body:JSON.stringify(body) });
    toast("Draft бодлогын бичиг баримтад хадгалагдлаа");
    _legalDraftResult = null;
    _hrTab = "orders";
    _hrOrderTypeFilter = "AI засварын draft";
    await hrRender();
    setTimeout(() => hrEditOrder(saved.id), 250);
  } catch(e) {
    toast("Алдаа: " + e.message);
  }
}

function legalFilterPickSource(value) {
  const sel = document.getElementById("lfSource");
  if (sel) {
    sel.value = value;
    sel.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  toast("Тогтоол сонгогдлоо. Шүүлт хийх дарна уу.");
}

async function legalFilterAnalyzeSource(value) {
  const sel = document.getElementById("lfSource");
  if (sel) sel.value = value;
  await legalFilterAnalyze();
}

function legalFilterManualOrder() {
  document.getElementById("legalManualOrderModal")?.remove();
  document.body.insertAdjacentHTML("beforeend", `
    <div id="legalManualOrderModal" style="position:fixed;inset:0;background:rgba(15,23,42,.52);z-index:2300;display:flex;align-items:flex-start;justify-content:center;padding-top:42px;overflow:auto">
      <div style="background:#fff;border-radius:14px;width:min(720px,96vw);margin-bottom:42px;box-shadow:0 20px 60px rgba(0,0,0,.25);padding:22px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
          <div>
            <div style="font-size:17px;font-weight:800;color:#0f172a">ИТХ тогтоол гараар нэмэх</div>
            <div style="font-size:12px;color:#64748b;margin-top:2px">Гараар нэмсэн тогтоол Бодлогын бичиг баримтад орж, Хуулийн шүүлтүүрт ашиглагдана</div>
          </div>
          <button class="btn secondary sm" onclick="document.getElementById('legalManualOrderModal').remove()">Хаах</button>
        </div>
        <div class="row3" style="margin-bottom:10px">
          <div><div class="small muted">Дугаар</div><input class="input" id="lm_no" placeholder="07/08"></div>
          <div><div class="small muted">Огноо *</div><input class="input" id="lm_date" type="date" value="${today()}"></div>
          <div><div class="small muted">Төрөл</div><input class="input" id="lm_type" value="ИТХ-ын тогтоол"></div>
        </div>
        <div style="margin-bottom:10px"><div class="small muted">Гарчиг *</div><input class="input" id="lm_title" placeholder="Тогтоолын гарчиг"></div>
        <div style="margin-bottom:10px"><div class="small muted">Эх сурвалж URL / PDF холбоос</div><input class="input" id="lm_url" placeholder="https://..."></div>
        <div style="margin-bottom:14px"><div class="small muted">Тайлбар / хэрэгжилтийн тэмдэглэл</div><textarea class="input" id="lm_note" rows="4" placeholder="Манайд хамаарах хэсэг, хэрэгжүүлэх чиглэл..."></textarea></div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn secondary" onclick="document.getElementById('legalManualOrderModal').remove()">Цуцлах</button>
          <button class="btn" onclick="legalFilterSaveManualOrder(false)">Хадгалах</button>
          <button class="btn" onclick="legalFilterSaveManualOrder(true)">Хадгалаад шүүх</button>
        </div>
      </div>
    </div>`);
}

async function legalFilterSaveManualOrder(runAnalyze = false) {
  const body = {
    doc_no: document.getElementById("lm_no")?.value.trim(),
    doc_date: document.getElementById("lm_date")?.value,
    doc_type: document.getElementById("lm_type")?.value.trim() || "ИТХ-ын тогтоол",
    title: document.getElementById("lm_title")?.value.trim(),
    description: [document.getElementById("lm_url")?.value.trim(), document.getElementById("lm_note")?.value.trim()].filter(Boolean).join("\n"),
    status: "Хүчинтэй"
  };
  if (!body.title || !body.doc_date) return toast("Гарчиг, огноо оруулна уу");
  try {
    const saved = await api("/api/admin-hub/orders", { method:"POST", body:JSON.stringify(body) });
    toast("Тогтоол нэмэгдлээ");
    document.getElementById("legalManualOrderModal")?.remove();
    _legalFilterSources = await api("/api/legal-filter/sources").catch(() => _legalFilterSources);
    if (runAnalyze && saved.id) {
      await legalFilterAnalyzeSource(`order:${saved.id}`);
    } else {
      await hrRenderLegalFilter();
    }
  } catch(e) { toast("Алдаа: " + e.message); }
}

async function legalFilterMarkImproved(id, checked) {
  try {
    await api(`/api/legal-filter/history/${id}/improved`, { method:"PUT", body:JSON.stringify({ improved: checked }) });
    hrRenderLegalFilter();
  } catch(e) { toast("Алдаа: " + e.message); }
}

async function legalFilterSetHistoryStatus(id, status) {
  try {
    await api(`/api/legal-filter/history/${id}/status`, { method:"PUT", body:JSON.stringify({ status }) });
    toast(`Статус: ${status}`);
    await hrRenderLegalFilter();
  } catch(e) { toast("Алдаа: " + e.message); }
}

function legalFilterOpenHistory(id) {
  const r = (_legalFilterHistory || []).find(x => Number(x.id) === Number(id));
  if (!r) return toast("Түүхийн мөр олдсонгүй");
  const results = Array.isArray(r.results) ? r.results : [];
  document.getElementById("legalHistoryModal")?.remove();
  document.body.insertAdjacentHTML("beforeend", `
    <div id="legalHistoryModal" style="position:fixed;inset:0;background:rgba(15,23,42,.52);z-index:2400;display:flex;align-items:flex-start;justify-content:center;padding-top:42px;overflow:auto">
      <div style="background:#fff;border-radius:14px;width:min(980px,96vw);margin-bottom:42px;box-shadow:0 20px 60px rgba(0,0,0,.25);overflow:hidden">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:16px 18px;border-bottom:1px solid #e2e8f0;background:#f8fafc">
          <div>
            <div style="font-size:17px;font-weight:900;color:#0f172a">${escapeHtml(r.doc_name || "Шүүлтийн дэлгэрэнгүй")}</div>
            <div style="font-size:12px;color:#64748b;margin-top:3px">${escapeHtml(r.created_name || "—")} · ${escapeHtml(String(r.created_at || "").slice(0, 16))}</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
            ${legalHistoryStatusPill(r.status || (Number(r.improved || 0) ? "Зассан" : "Шинэ"))}
            <button class="btn secondary sm" onclick="document.getElementById('legalHistoryModal').remove()">Хаах</button>
          </div>
        </div>
        <div style="padding:16px 18px">
          <div style="display:grid;grid-template-columns:repeat(4,minmax(120px,1fr));gap:10px;margin-bottom:12px">
            ${[["Эрсдэл", r.risk_count || 0, "#dc2626"],["Зөрчил", r.conflict_count || 0, "#d97706"],["Давхардал", r.duplicate_count || 0, "#2563eb"],["Санал", r.suggestion_count || 0, "#16a34a"]].map(([label,value,color]) => `
              <div style="border:1px solid #e2e8f0;border-top:3px solid ${color};border-radius:10px;padding:10px 12px">
                <div style="font-size:20px;font-weight:900;color:${color};line-height:1">${value}</div>
                <div style="font-size:11px;color:#64748b;margin-top:5px;font-weight:800">${label}</div>
              </div>`).join("")}
          </div>
          <div style="font-size:13px;color:#334155;line-height:1.5;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:11px 12px;margin-bottom:12px">${escapeHtml(r.summary || "Дүгнэлт байхгүй")}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
            <button class="btn secondary sm" onclick="legalFilterSetHistoryStatus(${r.id}, 'Засах шаардлагатай');document.getElementById('legalHistoryModal')?.remove()">Засах шаардлагатай</button>
            <button class="btn secondary sm" onclick="legalFilterSetHistoryStatus(${r.id}, 'Зассан');document.getElementById('legalHistoryModal')?.remove()">Зассан</button>
            <button class="btn secondary sm" onclick="legalFilterSetHistoryStatus(${r.id}, 'Баталсан');document.getElementById('legalHistoryModal')?.remove()">Баталсан</button>
            <button class="btn secondary sm" onclick="legalFilterSetHistoryStatus(${r.id}, 'Архивласан');document.getElementById('legalHistoryModal')?.remove()">Архивласан</button>
          </div>
          <div style="font-weight:900;color:#0f172a;margin:8px 0">AI илрүүлсэн зүйлс</div>
          <div style="display:grid;gap:10px">
            ${results.length ? results.map(item => `
              <div style="border:1px solid #e2e8f0;border-radius:12px;padding:12px;background:#fff">
                <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px">
                  <div style="font-weight:900;color:#0f172a">${escapeHtml(item.category || "Дүгнэлт")}</div>
                  <div style="font-size:11px;font-weight:900;color:#475569;background:#f1f5f9;border-radius:999px;padding:4px 8px">${escapeHtml(item.level || item.risk_level || "түвшин")}</div>
                </div>
                ${item.excerpt ? `<div style="font-size:12px;color:#334155;background:#f8fafc;border-left:3px solid #cbd5e1;padding:8px 10px;margin-bottom:8px;white-space:pre-wrap">${escapeHtml(item.excerpt)}</div>` : ""}
                ${item.explanation ? `<div style="font-size:12px;color:#475569;line-height:1.45;margin-bottom:7px">${escapeHtml(item.explanation)}</div>` : ""}
                ${item.suggestion ? `<div style="font-size:12px;color:#15803d;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:8px 10px">${escapeHtml(item.suggestion)}</div>` : ""}
              </div>`).join("") : `<div style="text-align:center;color:#94a3b8;padding:28px;border:1px dashed #cbd5e1;border-radius:12px">Дэлгэрэнгүй үр дүн алга</div>`}
          </div>
        </div>
      </div>
    </div>`);
}

Object.assign(window, { hrRenderLegalFilter, legalFilterAnalyze, legalFilterAnalyzeSource, legalFilterPickSource,
  legalFilterManualOrder, legalFilterSaveManualOrder, legalFilterMarkImproved, legalFilterSetHistoryStatus, legalFilterOpenHistory, legalFilterAsk, legalFilterOpenAskSource, legalAdviceAsk, legalDraftAsk, legalDraftCopy, legalDraftSaveAsPolicy });

// ── Tab 3: Цалингийн тооцоо ───────────────────────────────────

function hrNdPayrollRange(year, month) {
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  return {
    start: new Date(prevYear, prevMonth - 1, 21, 12),
    end: new Date(year, month - 1, 20, 12),
  };
}

function hrNdWorkedDays(records, userId, year, month) {
  const days = new Map();
  const { start: rangeStartDate, end: rangeEndDate } = hrNdPayrollRange(year, month);
  records.forEach(r => {
    if (r.user_id !== userId || !r.start_date) return;
    const start = attParseYmd(r.start_date);
    const end = attParseYmd(r.end_date || r.start_date);
    const rangeStart = start > rangeStartDate ? start : rangeStartDate;
    const rangeEnd = end < rangeEndDate ? end : rangeEndDate;
    if (rangeStart > rangeEnd) return;
    for (let d = new Date(rangeStart); d <= rangeEnd; d.setDate(d.getDate() + 1)) {
      const key = attYmd(d);
      const prev = days.get(key);
      if (!prev || r.id > prev.id) days.set(key, r);
    }
  });
  return [...days.values()].reduce((sum, record) => sum + attendanceHours(record).work / ATTENDANCE_DAY_HOURS, 0);
}

function hrNdTenureYears(hireDate, atDate = new Date()) {
  if (!hireDate) return 0;
  const start = new Date(String(hireDate).slice(0, 10));
  if (isNaN(start)) return 0;
  let years = atDate.getFullYear() - start.getFullYear();
  const beforeAnniversary = atDate.getMonth() < start.getMonth()
    || (atDate.getMonth() === start.getMonth() && atDate.getDate() < start.getDate());
  if (beforeAnniversary) years--;
  return Math.max(0, years);
}

function hrTenureAllowanceRate(years) {
  const y = Math.floor(Number(years || 0));
  if (y >= 16) return 25;
  if (y >= 11) return 20;
  if (y >= 9) return 15;
  if (y >= 7) return 10;
  if (y >= 4) return 8;
  if (y >= 2) return 5;
  return 0;
}

async function hrRenderND(tc) {
  if (!tc) tc = document.getElementById("hrTabContent");
  if (!tc) return;
  const ND_EMP_PENSION = 0.085, ND_EMP_BENEFIT = 0.01, ND_EMP_HEALTH = 0.02;
  const ND_EMP = ND_EMP_PENSION + ND_EMP_BENEFIT;
  const ND_ORG = 0.115, ND_ORG_HEALTH = 0.02;
  const MEAL_PER_WORKDAY = 10000;
  const canEditNd = ["director","hr"].includes(state.me?.role);
  const ndYear = window._hrNdYear || new Date().getFullYear();
  const ndMonth = window._hrNdMonth || (new Date().getMonth() + 1);
  window._hrNdYear = ndYear;
  window._hrNdMonth = ndMonth;
  const payrollRange = hrNdPayrollRange(ndYear, ndMonth);
  const fmtDate = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const records = await api("/api/hr-records").catch(() => []);
  const workedDays = (u) => hrNdWorkedDays(records, u.id, ndYear, ndMonth);
  const skillAmount = (u) => Number(u.salary||0) * Math.min(25, Math.max(0, Math.floor(Number(u.skill_allowance_rate||0)))) / 100;
  const tenureYearsOf = (u) => Number(u.tenure_years || 0);
  const tenureRateOf = (u) => hrTenureAllowanceRate(tenureYearsOf(u));
  const tenureAmount = (u) => Number(u.salary||0) * tenureRateOf(u) / 100;
  const mealAmount = (u) => workedDays(u) * MEAL_PER_WORKDAY;
  const ndBase = (u) => Number(u.salary||0) + skillAmount(u) + tenureAmount(u) + mealAmount(u);
  const active = _hrUsers.filter(u => (u.status_hr||"Идэвхтэй") === "Идэвхтэй");
  const totalSalary = active.reduce((s,u) => s + Number(u.salary||0), 0);
  const totalSkillAllowance = active.reduce((s,u) => s + skillAmount(u), 0);
  const totalTenureAllowance = active.reduce((s,u) => s + tenureAmount(u), 0);
  const totalMealAllowance = active.reduce((s,u) => s + mealAmount(u), 0);
  const totalWorkedDays = active.reduce((s,u) => s + workedDays(u), 0);
  const totalNdBase = active.reduce((s,u) => s + ndBase(u), 0);
  const totalNdEmp  = Math.round(totalNdBase * (ND_EMP + ND_EMP_HEALTH));
  const totalHaot   = active.reduce((s, u) => {
    const base = ndBase(u);
    const empNd = Math.round(base * (ND_EMP + ND_EMP_HEALTH));
    return s + (u.haot_exempt ? 0 : Math.round((base - empNd) * 0.10));
  }, 0);
  const totalNet    = Math.round(totalNdBase - totalNdEmp - totalHaot);

  tc.innerHTML = `
  <div style="padding:20px 24px">
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:24px">
      ${[
        ["Үндсэн цалин", totalSalary.toLocaleString()+"₮","#1d4ed8","#eff6ff"],
        ["Ур чадвар", totalSkillAllowance.toLocaleString("mn-MN",{maximumFractionDigits:0})+"₮","#0f766e","#ecfdf5"],
        ["Ажилласан жил", totalTenureAllowance.toLocaleString("mn-MN",{maximumFractionDigits:0})+"₮","#4338ca","#eef2ff"],
        ["Хоол", totalMealAllowance.toLocaleString()+"₮","#b45309","#fffbeb"],
        ["НД тооцох дүн", totalNdBase.toLocaleString()+"₮","#334155","#f8fafc"],
        ["Ажилтны НД (11.5%)", totalNdEmp.toLocaleString("mn-MN",{maximumFractionDigits:0})+"₮","#7e22ce","#fdf4ff"],
        ["ХАОАТ (10%)", totalHaot.toLocaleString("mn-MN",{maximumFractionDigits:0})+"₮","#dc2626","#fef2f2"],
        ["Нийт авах", totalNet.toLocaleString("mn-MN",{maximumFractionDigits:0})+"₮","#15803d","#dcfce7"]
      ].map(([l,v,c,bg])=>`
        <div style="background:${bg};border-radius:12px;padding:16px;text-align:center">
          <div style="font-size:10px;font-weight:700;color:${c};letter-spacing:.06em;margin-bottom:6px">${l.toUpperCase()}</div>
          <div style="font-size:18px;font-weight:800;color:${c}">${v}</div>
        </div>`).join("")}
    </div>

    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
      <button class="btn secondary sm" onclick="window._hrNdMonth--; if(window._hrNdMonth<1){window._hrNdMonth=12;window._hrNdYear--;} hrRenderND()">‹</button>
      <div style="padding:8px 12px;border:1px solid #dbe3ef;border-radius:10px;background:#fff;font-size:13px;font-weight:800;color:#0f172a">
        ${ndYear} оны ${ndMonth}-р сарын цалингийн тооцоо
      </div>
      <button class="btn secondary sm" onclick="window._hrNdMonth++; if(window._hrNdMonth>12){window._hrNdMonth=1;window._hrNdYear++;} hrRenderND()">›</button>
      <span style="font-size:12px;color:#64748b">Цалин бодох өдөр: сарын 20 · Ирцийн хугацаа: ${fmtDate(payrollRange.start)} — ${fmtDate(payrollRange.end)} · Нэмэгдэл: үндсэн цалингийн 0-25% · Хоол: ажилласан хоног × ${MEAL_PER_WORKDAY.toLocaleString()}₮</span>
    </div>

    <div style="background:#f8fafc;border-radius:10px;padding:12px 16px;margin-bottom:20px;font-size:12px;color:#475569">
      НД шимтгэл <b>${((ND_EMP+ND_EMP_HEALTH)*100).toFixed(1)}%</b>
      <span style="color:#94a3b8">(тэтгэвэр ${(ND_EMP_PENSION*100).toFixed(1)}% + тэтгэмж ${(ND_EMP_BENEFIT*100).toFixed(1)}% + эмнэлэг ${(ND_EMP_HEALTH*100).toFixed(1)}%)</span>
      · Хүн амийн орлогын албан татвар <b>10%</b>
    </div>

    <div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:10px">
    <table style="width:100%;min-width:1320px;border-collapse:collapse;font-size:12px;table-layout:fixed">
      <colgroup>
        <col style="width:150px"><col style="width:104px"><col style="width:82px"><col style="width:92px">
        <col style="width:82px"><col style="width:72px"><col style="width:92px"><col style="width:70px">
        <col style="width:92px"><col style="width:104px"><col style="width:104px"><col style="width:112px">
        <col style="width:104px"><col style="width:96px">
      </colgroup>
      <thead>
        <tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0">
          <th style="padding:8px 10px;text-align:left;font-size:10px;font-weight:700;color:#475569;position:sticky;left:0;background:#f8fafc;z-index:2">АЖИЛТАН</th>
          <th style="padding:8px 8px;text-align:right;font-size:10px;font-weight:700;color:#475569">ЦАЛИН</th>
          <th style="padding:8px 8px;text-align:right;font-size:10px;font-weight:700;color:#475569">УР %</th>
          <th style="padding:8px 8px;text-align:right;font-size:10px;font-weight:700;color:#475569">УР ₮</th>
          <th style="padding:8px 8px;text-align:right;font-size:10px;font-weight:700;color:#475569">ЖИЛ</th>
          <th style="padding:8px 8px;text-align:right;font-size:10px;font-weight:700;color:#475569">ЖИЛ %</th>
          <th style="padding:8px 8px;text-align:right;font-size:10px;font-weight:700;color:#475569">ЖИЛ ₮</th>
          <th style="padding:8px 8px;text-align:right;font-size:10px;font-weight:700;color:#475569">ХОНОГ</th>
          <th style="padding:8px 8px;text-align:right;font-size:10px;font-weight:700;color:#475569">ХООЛ</th>
          <th style="padding:8px 8px;text-align:right;font-size:10px;font-weight:700;color:#475569">СУУРЬ</th>
          <th style="padding:8px 8px;text-align:right;font-size:10px;font-weight:700;color:#475569">АЖ.НД</th>
          <th style="padding:8px 8px;text-align:right;font-size:10px;font-weight:700;color:#475569">ХАОАТ</th>
          <th style="padding:8px 8px;text-align:right;font-size:10px;font-weight:700;color:#475569">АВАХ</th>
          <th style="padding:8px 8px;text-align:center;font-size:10px;font-weight:700;color:#475569;position:sticky;right:0;background:#f8fafc;z-index:2">ҮЙЛДЭЛ</th>
        </tr>
      </thead>
      <tbody>
        ${active.map((u,i) => {
          const sal = Number(u.salary||0);
          const skillRate = Math.min(25, Math.max(0, Math.floor(Number(u.skill_allowance_rate||0))));
          const skill = sal * skillRate / 100;
          const tenureYears = tenureYearsOf(u);
          const tenureRate = tenureRateOf(u);
          const tenure = sal * tenureRate / 100;
          const days = workedDays(u);
          const meal = days * MEAL_PER_WORKDAY;
          const base = sal + skill + tenure + meal;
          const empNd = Math.round(base * (ND_EMP + ND_EMP_HEALTH));
          const haot  = u.haot_exempt ? 0 : Math.round((base - empNd) * 0.10);
          const net   = Math.round(base) - empNd - haot;
          return `
          <tr style="border-bottom:1px solid #f1f5f9;background:${i%2===0?'#fff':'#fafbfc'}">
            <td style="padding:8px 10px;position:sticky;left:0;background:${i%2===0?'#fff':'#fafbfc'};z-index:1">
              <div style="font-weight:700;line-height:1.25">${escapeHtml(u.full_name)}${u.haot_exempt ? ' <span style="font-size:9px;font-weight:800;color:#16a34a;background:#dcfce7;border-radius:4px;padding:1px 5px;vertical-align:middle">ХБ·ЧӨЛӨӨ</span>' : ''}</div>
              <div style="font-size:10px;color:#64748b;line-height:1.25">${escapeHtml(u.position||"")}</div>
            </td>
            <td style="padding:8px 8px;text-align:right">
              <input id="nd_salary_${u.id}" class="input" type="number" min="0" value="${sal || ""}"
                oninput="hrPreviewNdRow(${u.id},${days},${u.haot_exempt?1:0})"
                ${canEditNd ? "" : "disabled"} style="width:92px;margin:0;text-align:right;font-weight:700;color:#0f172a;padding:7px 8px">
            </td>
            <td style="padding:8px 8px;text-align:right">
              <input id="nd_skill_${u.id}" class="input" type="number" min="0" max="25" step="1" value="${skillRate || ""}"
                oninput="hrPreviewNdRow(${u.id},${days},${u.haot_exempt?1:0})"
                ${canEditNd ? "" : "disabled"} style="width:64px;margin:0;text-align:right;color:#0f766e;padding:7px 8px">
            </td>
            <td id="nd_skill_amt_${u.id}" style="padding:8px 8px;text-align:right;color:#0f766e;font-weight:700">${skill.toLocaleString("mn-MN",{maximumFractionDigits:0})}₮</td>
            <td style="padding:8px 8px;text-align:right">
              <input id="nd_tenure_years_${u.id}" class="input" type="number" min="0" step="1" value="${tenureYears ? Math.floor(tenureYears) : ""}"
                oninput="hrPreviewNdRow(${u.id},${days},${u.haot_exempt?1:0})"
                ${canEditNd ? "" : "disabled"} style="width:64px;margin:0;text-align:right;color:#475569;padding:7px 8px">
            </td>
            <td id="nd_tenure_rate_${u.id}" style="padding:8px 8px;text-align:right;color:#4338ca;font-weight:700">${tenureRate}%</td>
            <td id="nd_tenure_amt_${u.id}" style="padding:8px 8px;text-align:right;color:#4338ca;font-weight:700">${tenure.toLocaleString("mn-MN",{maximumFractionDigits:0})}₮</td>
            <td style="padding:8px 8px;text-align:right;color:#475569;font-weight:700">${days}</td>
            <td style="padding:8px 8px;text-align:right">
              <div id="nd_meal_amt_${u.id}" style="font-weight:700;color:#b45309">${meal ? meal.toLocaleString()+"₮" : "—"}</div>
            </td>
            <td id="nd_base_${u.id}" style="padding:8px 8px;text-align:right;font-weight:700;color:#334155">${base.toLocaleString()}₮</td>
            <td id="nd_emp_${u.id}" style="padding:8px 8px;text-align:right;color:#7e22ce">${empNd.toLocaleString("mn-MN",{maximumFractionDigits:0})}₮</td>
            <td id="nd_haot_${u.id}" style="padding:8px 8px;text-align:right;color:#dc2626">${haot.toLocaleString("mn-MN",{maximumFractionDigits:0})}₮</td>
            <td id="nd_net_${u.id}" style="padding:8px 8px;text-align:right;font-weight:800;color:#15803d">${net.toLocaleString("mn-MN",{maximumFractionDigits:0})}₮</td>
            <td style="padding:8px 8px;text-align:center;position:sticky;right:0;background:${i%2===0?'#fff':'#fafbfc'};z-index:1">
              ${canEditNd ? `<button class="btn secondary sm" onclick="hrSaveNdRow(${u.id})">Хадгалах</button>` : "—"}
            </td>
          </tr>`;
        }).join("")}
      </tbody>
      <tfoot>
        <tr style="background:#f0f7ff;border-top:2px solid #bfdbfe">
          <td style="padding:9px 10px;font-weight:700;position:sticky;left:0;background:#f0f7ff;z-index:1">НИЙТ (${active.length})</td>
          <td style="padding:9px 8px;text-align:right;font-weight:700">${totalSalary.toLocaleString()}₮</td>
          <td></td>
          <td style="padding:9px 8px;text-align:right;font-weight:700;color:#0f766e">${totalSkillAllowance.toLocaleString("mn-MN",{maximumFractionDigits:0})}₮</td>
          <td></td>
          <td></td>
          <td style="padding:9px 8px;text-align:right;font-weight:700;color:#4338ca">${totalTenureAllowance.toLocaleString("mn-MN",{maximumFractionDigits:0})}₮</td>
          <td style="padding:9px 8px;text-align:right;font-weight:700;color:#475569">${totalWorkedDays}</td>
          <td style="padding:9px 8px;text-align:right;font-weight:700;color:#b45309">${totalMealAllowance.toLocaleString()}₮</td>
          <td style="padding:9px 8px;text-align:right;font-weight:700">${totalNdBase.toLocaleString()}₮</td>
          <td style="padding:9px 8px;text-align:right;font-weight:700;color:#7e22ce">${totalNdEmp.toLocaleString("mn-MN",{maximumFractionDigits:0})}₮</td>
          <td style="padding:9px 8px;text-align:right;font-weight:700;color:#dc2626">${totalHaot.toLocaleString("mn-MN",{maximumFractionDigits:0})}₮</td>
          <td style="padding:9px 8px;text-align:right;font-weight:800;color:#15803d">${totalNet.toLocaleString("mn-MN",{maximumFractionDigits:0})}₮</td>
          <td style="position:sticky;right:0;background:#f0f7ff"></td>
        </tr>
      </tfoot>
    </table>
    </div>
  </div>`;
}

function hrPreviewNdRow(userId, days, haotExempt) {
  const salary = Number(document.getElementById(`nd_salary_${userId}`)?.value || 0);
  let rate = Math.floor(Number(document.getElementById(`nd_skill_${userId}`)?.value || 0));
  let tenureYears = Math.floor(Number(document.getElementById(`nd_tenure_years_${userId}`)?.value || 0));
  if (isNaN(rate)) rate = 0;
  if (isNaN(tenureYears)) tenureYears = 0;
  rate = Math.min(25, Math.max(0, rate));
  tenureYears = Math.max(0, tenureYears);
  const tenureRate = hrTenureAllowanceRate(tenureYears);
  const skill = salary * rate / 100;
  const tenure = salary * tenureRate / 100;
  const meal = Number(days || 0) * 10000;
  const base   = salary + skill + tenure + meal;
  const empNd  = Math.round(base * 0.115);
  const haot   = haotExempt ? 0 : Math.round((base - empNd) * 0.10);
  const net    = Math.round(base) - empNd - haot;
  const money = (v) => Number(v || 0).toLocaleString("mn-MN", { maximumFractionDigits: 0 }) + "₮";
  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  set(`nd_skill_amt_${userId}`, money(skill));
  set(`nd_tenure_rate_${userId}`, tenureRate + "%");
  set(`nd_tenure_amt_${userId}`, money(tenure));
  set(`nd_meal_amt_${userId}`, meal ? money(meal) : "—");
  set(`nd_base_${userId}`, money(base));
  set(`nd_emp_${userId}`, money(empNd));
  set(`nd_haot_${userId}`, money(haot));
  set(`nd_net_${userId}`, money(net));
}

async function hrSaveNdRow(userId) {
  const u = _hrUsers.find(x => x.id === userId);
  if (!u) return;
  const salary = Number(document.getElementById(`nd_salary_${userId}`)?.value || 0);
  const skillRate = Math.floor(Number(document.getElementById(`nd_skill_${userId}`)?.value || 0));
  const tenureYears = Math.floor(Number(document.getElementById(`nd_tenure_years_${userId}`)?.value || 0));
  if ([salary, skillRate, tenureYears].some(v => isNaN(v) || v < 0) || skillRate > 25) {
    toast("Цалин, ажилласан жил 0-ээс багагүй, ур чадварын хувь 0-25 хооронд байх ёстой");
    return;
  }
  const tenureRate = hrTenureAllowanceRate(tenureYears);
  const ndYear = window._hrNdYear || new Date().getFullYear();
  const ndMonth = window._hrNdMonth || (new Date().getMonth() + 1);
  const records = await api("/api/hr-records").catch(() => []);
  const meal = hrNdWorkedDays(records, userId, ndYear, ndMonth) * 10000;
  const skill = salary * skillRate / 100;
  const tenure = salary * tenureRate / 100;
  await api(`/api/users/${userId}/hr`, {
    method: "PUT",
    body: JSON.stringify({
      full_name: u.full_name,
      email: u.email || null,
      role: u.role || "worker",
      position: u.position || "",
      department: u.department || "",
      phone: u.phone || "",
      address: u.address || "",
      register_no: u.register_no || "",
      hire_date: u.hire_date || null,
      contract_type: u.contract_type || "Байнгын",
      contract_end: u.contract_end || null,
      status_hr: u.status_hr || "Идэвхтэй",
      job_category: u.job_category || "Захиргааны ажилтан",
      education: u.education || "",
      gender: u.gender || "",
      birthdate: u.birthdate || null,
      nationality: u.nationality || "Монгол",
      emergency_contact: u.emergency_contact || "",
      active: u.active !== false,
      salary,
      skill_allowance_rate: skillRate,
      skill_allowance: skill,
      tenure_years: tenureYears,
      tenure_allowance_rate: tenureRate,
      tenure_allowance: tenure,
      meal_allowance: meal
    })
  });
  toast("НД тооцооны мэдээлэл хадгалагдлаа");
  _hrUsers = await api("/api/users-full").catch(() => _hrUsers);
  hrRenderND();
}

// ── Tab 4: Тайлан ────────────────────────────────────────────

function hrCountByField(field, fallback = "Тодорхойгүй") {
  const counts = {};
  _hrUsers.forEach(u => {
    const raw = String(u[field] || "").trim();
    const key = raw || fallback;
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

function hrReportBars(title, counts, color = "#2563eb") {
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((s, [, n]) => s + Number(n || 0), 0);
  const max = Math.max(...rows.map(([, n]) => Number(n || 0)), 1);
  return `
  <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:18px">
    <div style="font-weight:700;font-size:14px;margin-bottom:14px">${title}</div>
    ${rows.length ? rows.map(([label, count]) => {
      const pct = total ? Math.round(count / total * 100) : 0;
      return `
      <div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;gap:10px">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(label)}</span>
          <b>${count} (${pct}%)</b>
        </div>
        <div style="background:#f1f5f9;border-radius:99px;height:8px;overflow:hidden">
          <div style="background:${color};height:100%;border-radius:99px;width:${count / max * 100}%;transition:width .4s"></div>
        </div>
      </div>`;
    }).join("") : `<div style="font-size:12px;color:#94a3b8">Мэдээлэл бүртгэгдээгүй байна</div>`}
  </div>`;
}

function hrGenderChart(counts) {
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((s, [, n]) => s + Number(n || 0), 0);
  const colors = ["#2563eb", "#db2777", "#0f766e", "#f59e0b", "#64748b"];
  let cursor = 0;
  const stops = rows.map(([, count], i) => {
    const start = cursor;
    cursor += total ? (count / total * 100) : 0;
    return `${colors[i % colors.length]} ${start}% ${cursor}%`;
  }).join(", ");
  return `
  <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:18px">
    <div style="font-weight:700;font-size:14px;margin-bottom:14px">Хүйсийн бүтэц</div>
    <div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap">
      <div style="width:120px;height:120px;border-radius:50%;background:conic-gradient(${stops || "#e2e8f0 0 100%"});position:relative;flex-shrink:0">
        <div style="position:absolute;inset:24px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;flex-direction:column">
          <b style="font-size:22px;color:#0f172a">${total}</b>
          <span style="font-size:10px;color:#64748b">ажилтан</span>
        </div>
      </div>
      <div style="flex:1;min-width:180px">
        ${rows.map(([label, count], i) => {
          const pct = total ? Math.round(count / total * 100) : 0;
          return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;font-size:12px">
            <span style="display:flex;align-items:center;gap:7px"><i style="width:9px;height:9px;border-radius:50%;background:${colors[i % colors.length]};display:inline-block"></i>${escapeHtml(label)}</span>
            <b>${count} (${pct}%)</b>
          </div>`;
        }).join("") || `<div style="font-size:12px;color:#94a3b8">Мэдээлэл бүртгэгдээгүй байна</div>`}
      </div>
    </div>
  </div>`;
}

function hrAttendanceSummary(records = [], year = new Date().getFullYear(), month = new Date().getMonth() + 1) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const start = new Date(year, month - 1, 1, 12);
  const end = new Date(year, month - 1, daysInMonth, 12);
  const latestByUserDay = new Map();
  records.forEach(r => {
    if (!r.user_id || !r.start_date) return;
    const rs = attParseYmd(r.start_date);
    const re = attParseYmd(r.end_date || r.start_date);
    const from = rs > start ? rs : start;
    const to = re < end ? re : end;
    if (from > to) return;
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      const key = `${r.user_id}|${d.getDate()}`;
      if (!latestByUserDay.has(key) || Number(r.id || 0) > Number(latestByUserDay.get(key).id || 0)) {
        latestByUserDay.set(key, r);
      }
    }
  });
  const byType = {
    "Ажилласан": 0,
    "Ажил тасалсан": 0,
    "Чөлөө": 0,
    "Өвчтэй": 0,
    "Ээлжийн амралт": 0,
    "Хоцорсон": 0,
    "Илүү цаг": 0
  };
  latestByUserDay.forEach(r => {
    const t = r.record_type || "Ажилласан";
    byType[t] = (byType[t] || 0) + 1;
  });
  return byType;
}

function hrAttendanceReportHtml(records = []) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const counts = hrAttendanceSummary(records, year, month);
  const meta = [
    ["Ажилласан", counts["Ажилласан"] || 0, "#16a34a", "#dcfce7"],
    ["Тасалсан", counts["Ажил тасалсан"] || 0, "#dc2626", "#fee2e2"],
    ["Чөлөө", counts["Чөлөө"] || 0, "#d97706", "#fef3c7"],
    ["Өвчтэй", counts["Өвчтэй"] || 0, "#2563eb", "#dbeafe"],
    ["Амралт", counts["Ээлжийн амралт"] || 0, "#475569", "#f1f5f9"],
    ["Хоцорсон", counts["Хоцорсон"] || 0, "#92400e", "#ffedd5"],
    ["Илүү цаг", counts["Илүү цаг"] || 0, "#7c3aed", "#f3e8ff"],
  ];
  const total = meta.reduce((s, [, n]) => s + Number(n || 0), 0);
  const max = Math.max(...meta.map(([, n]) => Number(n || 0)), 1);
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px;flex-wrap:wrap">
      <div>
        <div style="font-weight:700;font-size:14px">Ирцийн сарын дүн</div>
        <div style="font-size:11px;color:#64748b;margin-top:2px">${year}-${String(month).padStart(2, "0")} сарын бүртгэлийн нэгтгэл</div>
      </div>
      <div style="font-size:12px;color:#64748b;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:7px 10px">Нийт бүртгэлтэй өдөр: <b>${total}</b></div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:14px">
      ${meta.map(([label, count, color, bg]) => `
        <div style="background:${bg};border-radius:10px;padding:12px">
          <div style="font-size:11px;font-weight:800;color:${color};margin-bottom:5px">${label}</div>
          <div style="font-size:24px;font-weight:900;color:${color};line-height:1">${count}</div>
        </div>`).join("")}
    </div>
    ${meta.map(([label, count, color]) => {
      const pct = total ? Math.round(count / total * 100) : 0;
      return `
      <div style="margin-bottom:9px">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
          <span>${label}</span><b>${count} (${pct}%)</b>
        </div>
        <div style="height:8px;background:#f1f5f9;border-radius:99px;overflow:hidden">
          <div style="height:100%;width:${count / max * 100}%;background:${color};border-radius:99px"></div>
        </div>
      </div>`;
    }).join("")}`;
}

async function hrLoadAttendanceReportCounts() {
  const el = document.getElementById("hrAttendanceReportCounts");
  if (!el) return;
  try {
    const rows = await api("/api/hr-records");
    if (document.getElementById("hrAttendanceReportCounts")) {
      el.innerHTML = hrAttendanceReportHtml(Array.isArray(rows) ? rows : []);
    }
  } catch(e) {
    el.innerHTML = `<div style="font-size:12px;color:#dc2626">Ирцийн мэдээлэл уншихад алдаа гарлаа.</div>`;
  }
}

function hrRenderReports(tc) {
  if (!tc) tc = document.getElementById("hrTabContent");
  if (!tc) return;

  const active   = _hrUsers.filter(u => (u.status_hr||"Идэвхтэй") === "Идэвхтэй").length;
  const inactive = _hrUsers.filter(u => u.status_hr === "Чөлөөлөгдсөн").length;
  const expiring = _hrUsers.filter(u => { const d=contractWarnDays(u.contract_end); return d!==null&&d<=30&&d>=0; }).length;
  const totalSal = _hrUsers.reduce((s,u) => s + Number(u.salary||0), 0);

  const deptCount = {};
  HR_DEPTS.forEach(d => deptCount[d] = 0);
  _hrUsers.forEach(u => { if (u.department && deptCount[u.department] !== undefined) deptCount[u.department]++; });
  const maxDept = Math.max(...Object.values(deptCount), 1);
  const genderCount = hrCountByField("gender");
  const workConditionCount = hrCountByField("work_condition");
  const educationCount = hrCountByField("education");

  tc.innerHTML = `
  <div style="padding:20px 24px">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;flex-wrap:wrap">
      <div>
        <div style="font-size:18px;font-weight:900;color:#0f172a">Хүний нөөцийн тайлан</div>
        <div style="font-size:12px;color:#64748b;margin-top:3px">Ажилтан, гэрээ, ирц, боловсрол, ажлын нөхцлийн нэгтгэл</div>
      </div>
      <button class="btn secondary" onclick="hrPrintReports()">🖨 Хэвлэх</button>
    </div>
    <div id="hrReportPrintable" style="display:flex;flex-direction:column;gap:20px">
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">
      ${[
        ["👤 Нийт ажилтан", _hrUsers.length, "#1d4ed8","#eff6ff"],
        ["✅ Идэвхтэй", active, "#15803d","#dcfce7"],
        ["⚠ Дуусч буй гэрээ", expiring, "#dc2626","#fef2f2"],
        ["💰 Нийт цалинд", totalSal.toLocaleString()+"₮", "#7e22ce","#fdf4ff"]
      ].map(([l,v,c,bg])=>`
        <div style="background:${bg};border-radius:12px;padding:18px;text-align:center">
          <div style="font-size:11px;font-weight:700;color:${c};margin-bottom:6px">${l}</div>
          <div style="font-size:24px;font-weight:800;color:${c}">${v}</div>
        </div>`).join("")}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:18px">
        <div style="font-weight:700;font-size:14px;margin-bottom:14px">Батлагдсан орон тоо</div>
        ${HR_DEPTS.map(d => `
          <div style="margin-bottom:10px">
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
              <span>${d}</span><b>${deptCount[d]}</b>
            </div>
            <div style="background:#f1f5f9;border-radius:99px;height:8px;overflow:hidden">
              <div style="background:#2563eb;height:100%;border-radius:99px;width:${deptCount[d]/maxDept*100}%;transition:width .4s"></div>
            </div>
          </div>`).join("")}
      </div>

      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:18px">
        <div style="font-weight:700;font-size:14px;margin-bottom:14px">Гэрээний төрлөөр</div>
        <div id="hrContractReportCounts">${hrContractReportHtml([])}</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px">
      ${hrGenderChart(genderCount)}
      ${hrReportBars("Ажлын нөхцөлөөр", workConditionCount, "#0f766e")}
      ${hrReportBars("Боловсролын мэдээллээр", educationCount, "#7c3aed")}
    </div>

    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:18px">
      <div id="hrAttendanceReportCounts">${hrAttendanceReportHtml([])}</div>
    </div>

    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:18px">
      <div style="font-weight:700;font-size:14px;margin-bottom:14px">Албан бичгийн мэдээлэл</div>
      <div id="hrLetterReportCounts">${hrLetterReportHtml([])}</div>
    </div>

    ${expiring > 0 ? `
    <div style="background:#fff;border:1px solid #fecaca;border-radius:12px;padding:18px">
      <div style="font-weight:700;font-size:14px;color:#dc2626;margin-bottom:12px">⚠ Дуусч буй гэрээнүүд (30 хоногт)</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="border-bottom:1px solid #fecaca">
          <th style="padding:8px;text-align:left;color:#64748b;font-size:11px">АЖИЛТАН</th>
          <th style="padding:8px;text-align:left;color:#64748b;font-size:11px">ГЭРЭЭ</th>
          <th style="padding:8px;text-align:left;color:#64748b;font-size:11px">ДУУСАХ ОГНОО</th>
          <th style="padding:8px;text-align:right;color:#64748b;font-size:11px">ҮЛДСЭН ХОНОГ</th>
        </tr></thead>
        <tbody>
          ${_hrUsers.filter(u=>{const d=contractWarnDays(u.contract_end);return d!==null&&d<=30&&d>=0;}).map(u=>`
          <tr style="border-bottom:1px solid #fff5f5">
            <td style="padding:8px;font-weight:600">${escapeHtml(u.full_name)}</td>
            <td style="padding:8px">${hrContractBadge(u.contract_type||"")}</td>
            <td style="padding:8px;color:#dc2626">${u.contract_end}</td>
            <td style="padding:8px;text-align:right;font-weight:700;color:#dc2626">${contractWarnDays(u.contract_end)}өдөр</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>` : ""}
    </div>
  </div>`;

  hrLoadContractReportCounts();
  hrLoadLetterReportCounts();
  hrLoadAttendanceReportCounts();
}

function hrContractReportStats(orgContracts = []) {
  const counts = {};
  HR_REPORT_CONTRACT_TYPES.forEach(t => counts[t.key] = 0);
  counts.employment = _hrUsers.length;
  orgContracts.forEach(r => {
    const type = r.contract_type || "";
    if (counts[type] !== undefined) counts[type]++;
  });
  const total = Object.values(counts).reduce((sum, n) => sum + Number(n || 0), 0);
  return { counts, total, orgTotal: Math.max(total - counts.employment, 0) };
}

function hrContractReportHtml(orgContracts = []) {
  const { counts, total, orgTotal } = hrContractReportStats(orgContracts);
  return `
    ${HR_REPORT_CONTRACT_TYPES.map(t => {
      const count = counts[t.key] || 0;
      const pct = total ? Math.round(count / total * 100) : 0;
      return `
      <div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;gap:10px">
          <span>${t.icon} ${t.label}</span><b>${count} (${pct}%)</b>
        </div>
        <div style="background:#f1f5f9;border-radius:99px;height:8px;overflow:hidden">
          <div style="background:${t.color};height:100%;border-radius:99px;width:${pct}%;transition:width .4s"></div>
        </div>
      </div>`;
    }).join("")}

    <div style="margin-top:16px;font-size:12px;color:#64748b;background:#f8fafc;border-radius:8px;padding:10px">
      Нийт: ${total} гэрээ · Хөдөлмөрийн: ${counts.employment || 0} · Байгууллагын: ${orgTotal}
    </div>`;
}

async function hrLoadContractReportCounts() {
  const el = document.getElementById("hrContractReportCounts");
  if (!el) return;
  try {
    const rows = await api("/api/org-contracts");
    if (document.getElementById("hrContractReportCounts")) {
      el.innerHTML = hrContractReportHtml(Array.isArray(rows) ? rows : []);
    }
  } catch(e) {}
}

function hrLetterReportStats(rows = []) {
  const todayStr = today();
  const byType = {};
  const byStatus = {};
  HR_LETTER_TYPES.forEach(t => byType[t] = 0);
  HR_LETTER_STATUSES.forEach(s => byStatus[s] = 0);
  rows.forEach(r => {
    if (byType[r.doc_type] !== undefined) byType[r.doc_type]++;
    if (byStatus[r.status] !== undefined) byStatus[r.status]++;
  });
  const openRows = rows.filter(r => !["Хаасан","Биелсэн"].includes(r.status));
  const overdue = openRows.filter(r => r.due_date && r.due_date < todayStr).length;
  const dueSoon = openRows.filter(r => r.due_date && r.due_date >= todayStr &&
    ((new Date(r.due_date) - new Date(todayStr)) / 86400000) <= 7).length;
  return { byType, byStatus, open: openRows.length, overdue, dueSoon };
}

function hrLetterReportHtml(rows = []) {
  const { byType, byStatus, open, overdue, dueSoon } = hrLetterReportStats(rows);
  const total = rows.length;
  const typeColors = {
    "Ирсэн":"#2563eb",
    "Явсан":"#15803d",
    "Дотоод":"#7e22ce",
    "Гомдол":"#dc2626",
    "Хүсэлт":"#d97706"
  };
  return `
    <div style="display:grid;grid-template-columns:repeat(4,minmax(120px,1fr));gap:10px;margin-bottom:16px">
      ${[
        ["Нийт бичиг", total, "#2563eb"],
        ["Нээлттэй", open, "#d97706"],
        ["7 хоногт дөхсөн", dueSoon, "#c2410c"],
        ["Хугацаа хэтэрсэн", overdue, "#dc2626"],
      ].map(([label,value,color]) => `
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-top:3px solid ${color};border-radius:10px;padding:12px">
          <div style="font-size:22px;font-weight:800;color:${color};line-height:1">${value}</div>
          <div style="font-size:11px;color:#64748b;margin-top:6px;font-weight:700">${label}</div>
        </div>`).join("")}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div>
        <div style="font-size:12px;font-weight:800;color:#334155;margin-bottom:8px">Төрлөөр</div>
        ${HR_LETTER_TYPES.map(t => {
          const count = byType[t] || 0;
          const pct = total ? Math.round(count / total * 100) : 0;
          const color = typeColors[t] || "#64748b";
          return `<div style="margin-bottom:9px">
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;gap:10px">
              <span>${t}</span><b>${count} (${pct}%)</b>
            </div>
            <div style="height:7px;background:#f1f5f9;border-radius:999px;overflow:hidden">
              <div style="height:100%;width:${pct}%;background:${color};border-radius:999px"></div>
            </div>
          </div>`;
        }).join("")}
      </div>
      <div>
        <div style="font-size:12px;font-weight:800;color:#334155;margin-bottom:8px">Статусаар</div>
        ${HR_LETTER_STATUSES.map(s => `
          <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #f1f5f9;padding:7px 0;font-size:12px">
            <span>${hrLetterStatusPill(s)}</span>
            <b>${byStatus[s] || 0}</b>
          </div>`).join("")}
      </div>
    </div>`;
}

async function hrLoadLetterReportCounts() {
  const el = document.getElementById("hrLetterReportCounts");
  if (!el) return;
  try {
    const rows = await api("/api/correspondence");
    if (document.getElementById("hrLetterReportCounts")) {
      el.innerHTML = hrLetterReportHtml(Array.isArray(rows) ? rows : []);
    }
  } catch(e) {}
}

// ════════════════════════════════════════════════════════════
// ХАБЭА · ТӨЛӨВЛӨГӨӨ
// ════════════════════════════════════════════════════════════

function hrPrintReports() {
  const src = document.getElementById("hrReportPrintable");
  if (!src) { toast("Хэвлэх тайлан олдсонгүй"); return; }
  const date = attYmd();
  const win = window.open("", "_blank", "width=1100,height=800");
  if (!win) { toast("Pop-up хориглогдсон байна"); return; }
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>Хүний нөөцийн тайлан</title>
    <style>
      @page { size: A4 landscape; margin: 10mm; }
      * { box-sizing: border-box; }
      body { font-family: Arial, sans-serif; margin:0; color:#0f172a; background:#fff; font-size:12px; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
      .page { width:277mm; margin:0 auto; padding:8px; background:#fff; }
      .print-head { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; border-bottom:2px solid #0f172a; padding-bottom:10px; margin-bottom:14px; }
      h1 { margin:0; font-size:18px; }
      .muted { color:#64748b; font-size:11px; margin-top:4px; }
      button { display:none !important; }
      #hrReportPrintable { display:flex; flex-direction:column; gap:14px; }
      #hrReportPrintable > div { break-inside:avoid; page-break-inside:avoid; }
      div[style*="box-shadow"] { box-shadow:none !important; }
      @media print { .page { width:auto; margin:0; padding:0; } }
    </style>
  </head><body>
    <div class="page">
      <div class="print-head">
        <div>
          <h1>Хүний нөөцийн тайлан</h1>
          <div class="muted">Чойбалсан хөгжил ОНӨҮГ · ${date}</div>
        </div>
        <div class="muted">Хэвлэсэн: ${escapeHtml(state.me?.full_name || "")}</div>
      </div>
      <div id="hrReportPrintable">${src.innerHTML}</div>
    </div>
    <script>window.onload=()=>setTimeout(()=>window.print(),250)<\/script>
  </body></html>`);
  win.document.close();
}

async function safety() {
  main.innerHTML = `<div style="padding:40px;text-align:center;color:#94a3b8">
    <div style="font-size:48px;margin-bottom:12px">🦺</div>
    <div style="font-size:16px;font-weight:600">ХАБЭА модуль ачаалж байна...</div>
  </div>`;
  if (typeof window._safetyModule === "function") window._safetyModule();
}

async function plans() {
  main.innerHTML = `<div style="padding:40px;text-align:center;color:#94a3b8">Ачааллаж байна...</div>`;
  const targetYear = Math.max(2027, new Date().getFullYear() + 1);
  const STATUSES = ["Санаа","Төлөвлөж буй","Судалгаа шаардлагатай","Төсөвт санал болгох","Батлуулахаар бэлдсэн"];
  const STATUS_COLOR = {
    "Санаа":"#94a3b8","Төлөвлөж буй":"#2563eb","Судалгаа шаардлагатай":"#d97706",
    "Төсөвт санал болгох":"#7c3aed","Батлуулахаар бэлдсэн":"#16a34a"
  };

  const [rows, aiData] = await Promise.all([
    api("/api/plans").catch(() => []),
    api(`/api/reports/annual-plan-suggestion?baseYear=${new Date().getFullYear()}`).catch(() => null)
  ]);

  const futureRows = rows.filter(r => String(r.plan_type||"") === "Ирээдүйн төсөл" || Number(r.year||0) >= 2027);
  if (!window._futurePlanId && futureRows.length) window._futurePlanId = futureRows[0].id;
  const activePlan = futureRows.find(r => Number(r.id) === Number(window._futurePlanId)) || futureRows[0] || null;

  let planFiles = [], planItems = [];
  if (activePlan) {
    [planFiles, planItems] = await Promise.all([
      api(`/api/plans/${activePlan.id}/files`).catch(() => []),
      api(`/api/plans/${activePlan.id}/items`).catch(() => [])
    ]);
  }
  const introFiles  = planFiles.filter(f => f.file_type === "intro_pdf");
  const budgetFiles = planFiles.filter(f => f.file_type === "budget_excel");
  const canEdit   = ["director","chief_engineer","hr","safety","electric","camera_engineer","accountant"].includes(state.me?.role);
  const canDelete = ["director","chief_engineer"].includes(state.me?.role);

  function statusPill(s) {
    const c = STATUS_COLOR[s] || "#64748b";
    return `<span style="font-size:10px;padding:2px 10px;border-radius:20px;background:${c}18;color:${c};font-weight:700">${escapeHtml(s||"")}</span>`;
  }

  // AI suggestions section
  const aiHtml = aiData?.suggestions?.length ? `
    <div style="overflow:auto">
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:#f8fafc">
          <th style="padding:8px 12px;text-align:left;font-size:11px;color:#667085">Санал</th>
          <th style="padding:8px 12px;text-align:left;font-size:11px;color:#667085">Шалтгаан</th>
          <th style="padding:8px 12px;text-align:left;font-size:11px;color:#667085">Давтамж</th>
          <th style="padding:8px 12px;text-align:right;font-size:11px;color:#667085">Тооцоолсон төсөв</th>
          <th style="padding:8px 12px;font-size:11px;color:#667085"></th>
        </tr></thead>
        <tbody>
          ${aiData.suggestions.slice(0,8).map((s,i) => `
          <tr style="border-top:1px solid #f1f5f9;${i%2?"background:#fafafa":""}">
            <td style="padding:8px 12px;font-weight:600">${escapeHtml(s.title)}</td>
            <td style="padding:8px 12px;color:#64748b;font-size:11px">${escapeHtml(s.reason)}</td>
            <td style="padding:8px 12px;font-size:11px">${escapeHtml(s.suggested_frequency)}</td>
            <td style="padding:8px 12px;text-align:right;font-weight:700;color:#2563eb">${Number(s.estimated_budget||0).toLocaleString()}₮</td>
            <td style="padding:8px 12px">
              ${canEdit ? `<button class="btn secondary sm" onclick="addPlanFromSuggestion(${JSON.stringify(s).replace(/"/g,'&quot;')})">+ Нэмэх</button>` : ""}
            </td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>` : `<div style="color:#94a3b8;padding:20px;text-align:center">Өгөгдөл хангалтгүй байна — ажлын бүртгэл нэмэгдэх тусам санал гарна</div>`;

  main.innerHTML = `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
    <div>
      <h1 style="margin:0 0 3px">🏗️ Ирээдүйн том төсөл</h1>
      <div style="font-size:12px;color:#667085">2027+ онуудад хэрэгжүүлэх хөрөнгө оруулалт, шинэчлэлийн төлөвлөгөө</div>
    </div>
  </div>

  ${canEdit ? `
  <div style="margin-bottom:14px">
    <button class="btn secondary" onclick="toggleNewPlanForm()" id="btnNewPlan" style="margin-bottom:0">+ Шинэ том төсөл нэмэх</button>
    <div id="newPlanForm" style="display:none;margin-top:10px" class="panel">
      <div class="row3" style="margin-bottom:10px">
        <div><div class="small muted" style="margin-bottom:4px">Төслийн нэр *</div>
          <input class="input" id="ptitle" placeholder="Ирэх оны том төслийн нэр..."></div>
        <div><div class="small muted" style="margin-bottom:4px">Он</div>
          <input class="input" id="pyear" type="number" min="2027" value="${targetYear}"></div>
        <div><div class="small muted" style="margin-bottom:4px">Тооцоолсон төсөв ₮</div>
          <input class="input" id="pbudget" type="number" placeholder="0"></div>
      </div>
      <div class="row3" style="margin-bottom:10px">
        <div><div class="small muted" style="margin-bottom:4px">Чиглэл / тасаг</div>
          <input class="input" id="pdept" placeholder="Гэрэлтүүлэг, Камер..."></div>
        <div><div class="small muted" style="margin-bottom:4px">Төлөв</div>
          <select class="input" id="pstatus">
            ${STATUSES.map(s=>`<option ${s==="Төлөвлөж буй"?"selected":""}>${s}</option>`).join("")}
          </select></div>
        <div></div>
      </div>
      <textarea class="input" id="pdesc" rows="2" placeholder="Төслийн үндэслэл, хамрах хүрээ, хүлээгдэж буй үр дүн..." style="margin-bottom:10px"></textarea>
      <div style="display:flex;gap:8px">
        <button class="btn" onclick="savePlan()">Хадгалах</button>
        <button class="btn secondary" onclick="toggleNewPlanForm()">Болих</button>
      </div>
    </div>
  </div>` : ""}

  <div class="panel" style="margin-bottom:14px">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:0 0 12px;border-bottom:1px solid #e2e6ed;margin-bottom:12px">
      <div style="font-size:14px;font-weight:700">📋 Бүртгэлтэй том төсөлүүд (${futureRows.length})</div>
    </div>
    ${futureRows.length ? `
    <div style="overflow:auto">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="background:#f8fafc;border-bottom:2px solid #e2e6ed">
          <th style="padding:8px 12px;text-align:left;font-size:11px;color:#667085">Он</th>
          <th style="padding:8px 12px;text-align:left;font-size:11px;color:#667085">Төслийн нэр</th>
          <th style="padding:8px 12px;text-align:left;font-size:11px;color:#667085">Чиглэл</th>
          <th style="padding:8px 12px;text-align:right;font-size:11px;color:#667085">Төсөв</th>
          <th style="padding:8px 12px;text-align:left;font-size:11px;color:#667085">Төлөв</th>
          <th style="padding:8px 12px;text-align:left;font-size:11px;color:#667085">Тайлбар</th>
          <th style="padding:8px 12px"></th>
        </tr></thead>
        <tbody>
          ${futureRows.map((r,i) => {
            const active = Number(activePlan?.id) === Number(r.id);
            return `<tr style="border-bottom:1px solid #f1f5f9;${active?"background:#eff6ff;":"i%2?'background:#fafafa':''"};cursor:pointer" onclick="openFuturePlan(${r.id})">
              <td style="padding:10px 12px;font-weight:700;color:#2563eb">${r.year||""}</td>
              <td style="padding:10px 12px;font-weight:700">${escapeHtml(r.title||"")}</td>
              <td style="padding:10px 12px;font-size:12px;color:#64748b">${escapeHtml(r.department||"")}</td>
              <td style="padding:10px 12px;text-align:right;font-weight:700;color:#0369a1">${Number(r.budget||0).toLocaleString()}₮</td>
              <td style="padding:10px 12px">${statusPill(r.status)}</td>
              <td style="padding:10px 12px;font-size:11px;color:#64748b;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(r.note||"")}</td>
              <td style="padding:10px 12px;white-space:nowrap">
                <button class="btn sm" onclick="event.stopPropagation();openFuturePlan(${r.id})">Дэлгэрэнгүй</button>
                ${canDelete ? `<button class="btn secondary sm" style="color:#dc2626;margin-left:4px" onclick="event.stopPropagation();deletePlan(${r.id})">Устгах</button>` : ""}
              </td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>` : `<div style="text-align:center;color:#94a3b8;padding:30px">Ирээдүйн төсөл бүртгэгдээгүй байна</div>`}
  </div>

  ${activePlan ? `
  <div class="panel" style="margin-bottom:14px;border-top:3px solid #2563eb">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div style="font-size:14px;font-weight:800;color:#1e40af">📂 ${escapeHtml(activePlan.title||"")} — Дэлгэрэнгүй</div>
      <div style="font-size:11px;color:#94a3b8">${activePlan.year} он · ${statusPill(activePlan.status)}</div>
    </div>

    ${canEdit ? `
    <div class="row3" style="margin-bottom:10px">
      <div><div class="small muted" style="margin-bottom:4px">Төслийн нэр</div>
        <input class="input" id="pdTitle" value="${escapeHtml(activePlan.title||"")}"></div>
      <div><div class="small muted" style="margin-bottom:4px">Он</div>
        <input class="input" id="pdYear" type="number" min="2027" value="${activePlan.year||targetYear}"></div>
      <div><div class="small muted" style="margin-bottom:4px">Нийт төсөв ₮</div>
        <input class="input" id="pdBudget" type="number" value="${Number(activePlan.budget||0)}"></div>
    </div>
    <div class="row3" style="margin-bottom:10px">
      <div><div class="small muted" style="margin-bottom:4px">Чиглэл / тасаг</div>
        <input class="input" id="pdDept" value="${escapeHtml(activePlan.department||"")}"></div>
      <div><div class="small muted" style="margin-bottom:4px">Төлөв</div>
        <select class="input" id="pdStatus">
          ${STATUSES.map(s=>`<option ${s===(activePlan.status||"")?"selected":""}>${s}</option>`).join("")}
        </select></div>
      <div><div class="small muted" style="margin-bottom:4px">Файл</div>
        <input class="input" value="PDF: ${introFiles.length} · Excel: ${budgetFiles.length}" disabled></div>
    </div>
    <textarea class="input" id="pdNote" rows="2" style="margin-bottom:10px">${escapeHtml(activePlan.note||"")}</textarea>
    <button class="btn" onclick="saveFuturePlanDetail(${activePlan.id})">Үндсэн мэдээлэл хадгалах</button>
    <div style="height:1px;background:#e2e6ed;margin:16px 0"></div>` : ""}

    <!-- Дэд ажлын жагсаалт -->
    <div style="margin-bottom:16px">
      <div style="font-size:13px;font-weight:700;margin-bottom:10px">📌 Дэд ажил / хэрэгжүүлэх арга хэмжээ (${planItems.length})</div>
      ${canEdit ? `
      <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
        <input class="input" id="piTitle" placeholder="Дэд ажлын нэр *" style="flex:2;min-width:160px">
        <input class="input" id="piQty" type="number" placeholder="Тоо хэмжээ" style="width:100px" value="1">
        <input class="input" id="piUnit" placeholder="Нэгж (ш, м...)" style="width:90px">
        <input class="input" id="piCost" type="number" placeholder="Тооцоолсон зардал ₮" style="flex:1;min-width:140px">
        <input class="input" id="piDue" type="date" style="width:130px">
        <button class="btn sm" onclick="addPlanItem(${activePlan.id})">+ Нэмэх</button>
      </div>` : ""}
      ${planItems.length ? `
      <div style="overflow:auto">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e6ed">
            <th style="padding:6px 10px;font-size:11px;color:#667085">#</th>
            <th style="padding:6px 10px;font-size:11px;color:#667085">Нэр</th>
            <th style="padding:6px 10px;text-align:center;font-size:11px;color:#667085">Тоо</th>
            <th style="padding:6px 10px;font-size:11px;color:#667085">Нэгж</th>
            <th style="padding:6px 10px;text-align:right;font-size:11px;color:#667085">Зардал ₮</th>
            <th style="padding:6px 10px;font-size:11px;color:#667085">Хугацаа</th>
            <th style="padding:6px 10px;text-align:center;font-size:11px;color:#667085">Явц</th>
            <th style="padding:6px 10px"></th>
          </tr></thead>
          <tbody>
            ${planItems.map((it,i) => `
            <tr style="border-bottom:1px solid #f1f5f9;${i%2?"background:#fafafa":""}">
              <td style="padding:7px 10px;color:#94a3b8">${i+1}</td>
              <td style="padding:7px 10px;font-weight:600">${escapeHtml(it.title||"")}</td>
              <td style="padding:7px 10px;text-align:center">${it.target_qty||1}</td>
              <td style="padding:7px 10px;color:#64748b">${escapeHtml(it.unit||"")}</td>
              <td style="padding:7px 10px;text-align:right;font-weight:700;color:#0369a1">${Number(it.estimated_cost||0).toLocaleString()}₮</td>
              <td style="padding:7px 10px;font-size:11px;color:#64748b">${it.due_date||"—"}</td>
              <td style="padding:7px 10px;text-align:center">
                <div style="display:flex;align-items:center;gap:4px;justify-content:center">
                  <div style="width:50px;height:5px;background:#e2e8f0;border-radius:99px;overflow:hidden">
                    <div style="height:100%;width:${it.performance_percent||0}%;background:#2563eb"></div>
                  </div>
                  <span style="font-size:10px;color:#475569">${it.performance_percent||0}%</span>
                </div>
              </td>
              <td style="padding:7px 10px">
                ${canDelete ? `<button class="btn secondary sm" style="color:#dc2626;font-size:10px" onclick="deletePlanItem(${it.id},${activePlan.id})">Устгах</button>` : ""}
              </td>
            </tr>`).join("")}
            <tr style="background:#f0f9ff;border-top:2px solid #bfdbfe">
              <td colspan="4" style="padding:7px 10px;font-weight:700;font-size:11px;color:#1d4ed8">Нийт дүн</td>
              <td style="padding:7px 10px;text-align:right;font-weight:800;color:#1d4ed8">${planItems.reduce((s,it)=>s+Number(it.estimated_cost||0),0).toLocaleString()}₮</td>
              <td colspan="3"></td>
            </tr>
          </tbody>
        </table>
      </div>` : `<div style="color:#94a3b8;font-size:12px;padding:12px 0">Дэд ажил бүртгэгдээгүй байна</div>`}
    </div>

    <div style="height:1px;background:#e2e6ed;margin:16px 0"></div>

    <!-- Файл upload -->
    <div style="font-size:13px;font-weight:700;margin-bottom:10px">📎 Файл хавсаргах</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
      <div style="border:1px solid #e2e6ed;border-radius:10px;padding:14px;background:#f8fafc">
        <div style="font-weight:700;margin-bottom:6px;font-size:13px">Танилцуулга PDF</div>
        <div class="muted" style="font-size:11px;margin-bottom:8px">Зураг, үндэслэл, хамрах хүрээ, шийдвэрийн материал</div>
        <input type="file" id="planIntroFile" accept=".pdf" class="input" style="margin-bottom:6px">
        <button class="btn sm" onclick="uploadFuturePlanFile(${activePlan.id},'intro_pdf','planIntroFile')">PDF хадгалах</button>
      </div>
      <div style="border:1px solid #e2e6ed;border-radius:10px;padding:14px;background:#f8fafc">
        <div style="font-weight:700;margin-bottom:6px;font-size:13px">Төсөв Excel</div>
        <div class="muted" style="font-size:11px;margin-bottom:8px">Дэлгэрэнгүй задаргаа, тооцоо, материал, үнэ</div>
        <input type="file" id="planBudgetFile" accept=".xls,.xlsx,.csv" class="input" style="margin-bottom:6px">
        <button class="btn sm" onclick="uploadFuturePlanFile(${activePlan.id},'budget_excel','planBudgetFile')">Excel хадгалах</button>
      </div>
    </div>

    ${planFiles.length ? `
    <div style="overflow:auto">
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e6ed">
          <th style="padding:6px 10px;font-size:11px;color:#667085">#</th>
          <th style="padding:6px 10px;font-size:11px;color:#667085">Төрөл</th>
          <th style="padding:6px 10px;font-size:11px;color:#667085">Файл</th>
          <th style="padding:6px 10px;font-size:11px;color:#667085">Оруулсан</th>
          <th style="padding:6px 10px"></th>
        </tr></thead>
        <tbody>
          ${planFiles.map((f,i) => {
            const href = (f.file_path||"").startsWith("/") ? f.file_path : "/"+f.file_path;
            const lbl = f.file_type==="intro_pdf"?"📄 Танилцуулга PDF":f.file_type==="budget_excel"?"📊 Төсөв Excel":"📎 Файл";
            return `<tr style="border-bottom:1px solid #f1f5f9">
              <td style="padding:7px 10px;color:#94a3b8">${i+1}</td>
              <td style="padding:7px 10px;font-size:11px">${lbl}</td>
              <td style="padding:7px 10px;font-weight:600">${escapeHtml(f.file_name||"")}</td>
              <td style="padding:7px 10px;font-size:11px;color:#64748b">${(f.uploaded_at||"").slice(0,10)}${f.uploaded_name?" · "+escapeHtml(f.uploaded_name):""}</td>
              <td style="padding:7px 10px;white-space:nowrap">
                <a class="btn secondary sm" href="${href}" target="_blank">Нээх</a>
                ${canDelete ? `<button class="btn secondary sm" style="color:#dc2626;margin-left:4px" onclick="deleteFuturePlanFile(${f.id})">Устгах</button>` : ""}
              </td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>` : `<div style="color:#94a3b8;font-size:12px">Файл хавсаргаагүй байна</div>`}
  </div>` : ""}

  <div class="panel">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <div style="font-size:14px;font-weight:700">🤖 AI санал — ${new Date().getFullYear()} оны ажлын түүхэд тулгуурласан</div>
    </div>
    ${aiHtml}
  </div>`;
}

function openFuturePlan(id) {
  window._futurePlanId = id;
  plans();
}

async function saveFuturePlanDetail(id) {
  await api(`/api/plans/${id}`, {
    method: "PUT",
    body: JSON.stringify({
      title: pdTitle.value,
      year: Number(pdYear.value),
      budget: Number(pdBudget.value || 0),
      department: pdDept.value,
      status: pdStatus.value,
      note: pdNote.value
    })
  });
  toast("Төслийн танилцуулга хадгалагдлаа");
  plans();
}

async function uploadFuturePlanFile(planId, fileType, inputId) {
  const input = document.getElementById(inputId);
  if (!input?.files?.length) { toast("Файл сонгоно уу"); return; }
  const fd = new FormData();
  fd.append("file", input.files[0]);
  fd.append("file_type", fileType);
  const res = await fetch(`/api/plans/${planId}/files`, {
    method: "POST",
    headers: { Authorization: "Bearer " + state.token },
    body: fd
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Файл хадгалахад алдаа гарлаа");
  toast(fileType === "intro_pdf" ? "PDF танилцуулга хадгалагдлаа" : "Excel төсөв хадгалагдлаа");
  plans();
}

async function deleteFuturePlanFile(id) {
  if (!confirm("Энэ файлыг устгах уу?")) return;
  await api(`/api/plan-files/${id}`, { method: "DELETE" });
  toast("Файл устгагдлаа");
  plans();
}

function toggleNewPlanForm() {
  const f = document.getElementById("newPlanForm");
  if (!f) return;
  const show = f.style.display === "none";
  f.style.display = show ? "block" : "none";
  const btn = document.getElementById("btnNewPlan");
  if (btn) btn.textContent = show ? "✕ Болих" : "+ Шинэ том төсөл нэмэх";
}

async function savePlan() {
  const title = document.getElementById("ptitle")?.value?.trim();
  if (!title) { toast("Төслийн нэр оруулна уу"); return; }
  const r = await api("/api/plans", {
    method: "POST",
    body: JSON.stringify({
      title,
      year:       Number(document.getElementById("pyear")?.value || 2027),
      budget:     Number(document.getElementById("pbudget")?.value || 0),
      department: document.getElementById("pdept")?.value || "",
      status:     document.getElementById("pstatus")?.value || "Төлөвлөж буй",
      note:       document.getElementById("pdesc")?.value || "",
      plan_type:  "Ирээдүйн төсөл"
    })
  });
  window._futurePlanId = r.id;
  toast("Ирээдүйн том төсөл хадгаллаа");
  plans();
}

async function deletePlan(id) {
  if (!confirm("Энэ төслийг бүх файл, дэд ажлын хамт устгах уу?")) return;
  await api(`/api/plans/${id}`, { method: "DELETE" });
  if (Number(window._futurePlanId) === Number(id)) window._futurePlanId = null;
  toast("Төсөл устгагдлаа");
  plans();
}

async function addPlanItem(planId) {
  const title = document.getElementById("piTitle")?.value?.trim();
  if (!title) { toast("Дэд ажлын нэр оруулна уу"); return; }
  await api(`/api/plans/${planId}/items`, {
    method: "POST",
    body: JSON.stringify({
      title,
      target_qty:     Number(document.getElementById("piQty")?.value || 1),
      unit:           document.getElementById("piUnit")?.value || "",
      estimated_cost: Number(document.getElementById("piCost")?.value || 0),
      due_date:       document.getElementById("piDue")?.value || null,
    })
  });
  toast("Дэд ажил нэмэгдлээ");
  plans();
}

async function deletePlanItem(itemId, planId) {
  if (!confirm("Энэ дэд ажлыг устгах уу?")) return;
  await api(`/api/plan-items/${itemId}`, { method: "DELETE" });
  toast("Устгагдлаа");
  plans();
}

async function addPlanFromSuggestion(s) {
  window._futurePlanId = null;
  const r = await api("/api/plans", {
    method: "POST",
    body: JSON.stringify({
      title:     s.title,
      year:      new Date().getFullYear() + 1,
      budget:    s.estimated_budget || 0,
      status:    "Санаа",
      plan_type: "Ирээдүйн төсөл"
    })
  });
  window._futurePlanId = r.id;
  toast("AI саналаас төсөл нэмэгдлээ");
  plans();
}

Object.assign(window, {
  attendance, switchAttTab, renderAttMonth, renderAttYear, renderAttRange,
  attChangeYear, attJumpToPayrollInterval, showAttCalendar, attPrint, _attPrintMonthForm, _attPrintYearSimple, _attPrintRangeForm,
  onAttendanceTypeChange, onCellEditTypeChange, saveAttendance, editAttendanceCell, editAttendanceCellDate, markAllWorked,
  hr, hrSwTab, hrSwSubTab, hrRenderEmployees, hrRenderEmployeeList, hrRenderDocs, hrRenderND, hrPreviewNdRow, hrSaveNdRow, hrRenderReports, hrPrintReports,
  hrOpenForm, hrContractChg, hrCloseForm, hrSaveEmp, hrDeleteEmployee,
  hrOpenProfile, hrCloseProfile, hrProfTab, hrLoadProfTab,
  hrAddHistory, hrUploadFile, hrDelFile,
  safety, plans, savePlan, openFuturePlan, saveFuturePlanDetail, uploadFuturePlanFile, deleteFuturePlanFile,
  deletePlan, addPlanItem, deletePlanItem, addPlanFromSuggestion, toggleNewPlanForm,
});
