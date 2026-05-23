import { state, api, toast, table, userOptions, escapeHtml, today, codeClass } from './common.js';

// ── Globals for inline onclick handlers ──────────────────────
if (window.attViewMonth === undefined) window.attViewMonth = new Date().getMonth() + 1;

// ── Module-level state ────────────────────────────────────────
let editingEmployeeId = null;
let currentProfileUserId = null;

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

    const start = new Date(r.start_date.slice(0, 10));
    const end = new Date((r.end_date || r.start_date).slice(0, 10));
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month - 1, days);

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
    let code = "А";
    if (r.record_type === "Ажил тасалсан") code = "Т";
    if (r.record_type === "Чөлөө") code = "Ч";
    if (r.record_type === "Өвчтэй") code = "Ө";
    if (r.record_type === "Ээлжийн амралт") code = "Э";
    if (r.record_type === "Хоцорсон") code = "Х";
    if (r.record_type === "Илүү цаг") code = "ИЦ";

    byUser[r.user_id].days[day] = code;

    if (code === "А") byUser[r.user_id].summary.worked++;
    if (code === "Т") byUser[r.user_id].summary.absent++;
    if (code === "Ч") byUser[r.user_id].summary.leave++;
    if (code === "Ө") byUser[r.user_id].summary.sick++;
    if (code === "Э") byUser[r.user_id].summary.vacation++;
    if (code === "ИЦ") byUser[r.user_id].summary.overtime++;

    if (d.toISOString().slice(0, 10) === todayDate) {
      if (code === "А") todaySummary.worked++;
      if (code === "Т") todaySummary.absent++;
      if (code === "Ч") todaySummary.leave++;
      if (code === "Ө") todaySummary.sick++;
      if (code === "Э") todaySummary.vacation++;
      if (code === "Х") todaySummary.late++;
      if (code === "ИЦ") todaySummary.overtime++;
    }
  });

  main.innerHTML = `
  <h1>Ирц / цагийн бүртгэл</h1>

  <div class="panel">
    <h2>Өнөөдрийн ирц бүртгэх</h2>

    <div class="row3">
      <select class="input" id="auser">${userOptions()}</select>

      <select class="input" id="atype" onchange="onAttendanceTypeChange()">
        <option>Ажилласан</option>
        <option>Ажил тасалсан</option>
        <option>Чөлөө</option>
        <option>Өвчтэй</option>
        <option>Ээлжийн амралт</option>
        <option>Хоцорсон</option>
        <option>Илүү цаг</option>
      </select>

      <input class="input" id="adate" type="date" value="${today()}" max="${today()}">
    </div>

    <div id="attendanceDynamicFields"></div>

    <input class="input" id="anote" placeholder="Тайлбар">
    <button class="btn" onclick="saveAttendance()">Хадгалах</button>
    <button class="btn secondary" onclick="markAllWorked()">Өнөөдөр бүгдийг ажилласан болгох</button>
  </div>

  <div class="panel">
    <h2>Өнөөдрийн ирцийн дүн</h2>
    <div class="grid">
      <div class="stat"><span class="muted">Ажилласан</span><b>${todaySummary.worked}</b></div>
      <div class="stat"><span class="muted">Тасалсан</span><b>${todaySummary.absent}</b></div>
      <div class="stat"><span class="muted">Чөлөө</span><b>${todaySummary.leave}</b></div>
      <div class="stat"><span class="muted">Өвчтэй</span><b>${todaySummary.sick}</b></div>
      <div class="stat"><span class="muted">Амралт</span><b>${todaySummary.vacation}</b></div>
      <div class="stat"><span class="muted">Илүү цаг</span><b>${todaySummary.overtime}</b></div>
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
      <span class="dayCode overtime">ИЦ</span> Илүү цаг
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
  users.forEach(u => { byU[u.id] = { user: u, A:0, T:0, Ch:0, O:0, E:0, KH:0, ITs:0 }; });

  const cMap = {
    "Ажилласан":"A","Ажил тасалсан":"T","Чөлөө":"Ch",
    "Өвчтэй":"O","Ээлжийн амралт":"E","Хоцорсон":"KH","Илүү цаг":"ITs"
  };
  const latest = {};
  rows.forEach(r => {
    if (!byU[r.user_id] || !r.start_date) return;
    const s = new Date(r.start_date.slice(0,10));
    const e = new Date((r.end_date||r.start_date).slice(0,10));
    const mS = new Date(yr, mo-1, 1), mE = new Date(yr, mo-1, daysInMonth);
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
    const code = cMap[r.record_type];
    if (code && byU[uid]) byU[uid][code]++;
  });

  const shortName = n => {
    if (!n) return "";
    const p = n.trim().split(" ");
    return p.length >= 2 ? p[0][0] + "." + p[1] : n;
  };
  const hrUser  = users.find(u => u.role === "hr" || (u.position||"").toLowerCase().includes("хн менеж") || (u.position||"").toLowerCase().includes("хүний нөөц"));
  const accUser = users.find(u => (u.position||"").toLowerCase().includes("нягтлан"));

  let tot = { A:0, T:0, Ch:0, O:0, E:0, KH:0, ITs:0 };
  const dataRows = Object.values(byU).map((u, i) => {
    const vac  = u.E;
    const req  = workingDaysReq;                   // Ажилласан зохих = хуанлийн ажлын өдөр (vacation хасдаггүй)
    const notW = u.T + u.Ch + u.O + u.E;           // Ажиллаагүй нийт = тасалсан + чөлөө + өвчтэй + амралт
    Object.keys(tot).forEach(k => { tot[k] += u[k]; });
    const e = v => `<td contenteditable="true">${v || ""}</td>`;
    return `<tr>
      <td contenteditable="true">${i+1}</td>
      <td contenteditable="true" style="text-align:left;white-space:nowrap">${u.user.full_name}</td>
      ${e(daysInMonth)}${e(weekendDays)}${e(vac||"")}
      ${e(req)}${e(req*8)}
      ${e(u.A||"")}${e(u.A ? u.A*8 : "")}
      <td contenteditable="true"></td><td contenteditable="true"></td>
      <td contenteditable="true"></td><td contenteditable="true"></td>
      ${e(u.ITs||"")}${e(u.ITs ? u.ITs*8 : "")}
      ${e(notW||"")}${e(notW ? notW*8 : "")}
      <td contenteditable="true"></td><td contenteditable="true"></td>
      ${e(u.O||"")}${e(u.O ? u.O*8 : "")}
      ${e(u.Ch||"")}${e(u.Ch ? u.Ch*8 : "")}
      ${e(u.E||"")}${e(u.E ? u.E*8 : "")}
      ${e(u.T||"")}${e(u.T ? u.T*8 : "")}
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
    ${et(tot.A||"")}${et(tot.A ? tot.A*8 : "")}
    <td contenteditable="true"></td><td contenteditable="true"></td>
    <td contenteditable="true"></td><td contenteditable="true"></td>
    ${et(tot.ITs||"")}${et(tot.ITs ? tot.ITs*8 : "")}
    ${et(totNotW||"")}${et(totNotW ? totNotW*8 : "")}
    <td contenteditable="true"></td><td contenteditable="true"></td>
    ${et(tot.O||"")}${et(tot.O ? tot.O*8 : "")}
    ${et(tot.Ch||"")}${et(tot.Ch ? tot.Ch*8 : "")}
    ${et(tot.E||"")}${et(tot.E ? tot.E*8 : "")}
    ${et(tot.T||"")}${et(tot.T ? tot.T*8 : "")}
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
    byUserM[u.id] = { user:u, days:{}, summary:{worked:0,absent:0,leave:0,sick:0,vacation:0,overtime:0} };
  });

  const daysInMonth = new Date(year, month, 0).getDate();
  const latestByDay = {};

  rows.forEach(r => {
    if (!byUserM[r.user_id] || !r.start_date) return;
    const start = new Date(r.start_date.slice(0,10));
    const end   = new Date((r.end_date||r.start_date).slice(0,10));
    const mS    = new Date(year, month-1, 1);
    const mE    = new Date(year, month-1, daysInMonth);
    const rS    = start > mS ? start : mS;
    const rE    = end   < mE ? end   : mE;
    if (rS > rE) return;
    for (let c = new Date(rS); c <= rE; c.setDate(c.getDate()+1)) {
      const day = c.getDate();
      const key = `${r.user_id}|${day}`;
      if (!latestByDay[key] || r.id > latestByDay[key].id) latestByDay[key] = r;
    }
  });

  const codeMap = {
    "Ажилласан":"А","Ажил тасалсан":"Т","Чөлөө":"Ч",
    "Өвчтэй":"Ө","Ээлжийн амралт":"Э","Хоцорсон":"Х","Илүү цаг":"ИЦ"
  };
  Object.entries(latestByDay).forEach(([key, r]) => {
    const [uid, day] = key.split("|");
    if (!byUserM[uid]) return;
    const code = codeMap[r.record_type] || "";
    const d = Number(day);
    byUserM[uid].days[d] = code;
    byUserM[uid].recIds = byUserM[uid].recIds || {};
    byUserM[uid].recIds[d] = r.id;
    if (code==="А")  byUserM[uid].summary.worked++;
    if (code==="Т")  byUserM[uid].summary.absent++;
    if (code==="Ч")  byUserM[uid].summary.leave++;
    if (code==="Ө")  byUserM[uid].summary.sick++;
    if (code==="Э")  byUserM[uid].summary.vacation++;
    if (code==="ИЦ") byUserM[uid].summary.overtime++;
  });

  tc.innerHTML = `<div class="attendanceWrap"><table class="attendanceTable">
    <thead><tr>
      <th class="stickyName">Ажилтан</th>
      ${Array.from({length:daysInMonth},(_,i)=>{
        const dt=new Date(year,month-1,i+1);
        const iW=dt.getDay()===0||dt.getDay()===6;
        const iT=dt.toISOString().slice(0,10)===today();
        return `<th style="background:${iT?'#eff6ff':iW?'#fff5f5':''};color:${iT?'#2563eb':iW?'#dc2626':'#667085'};font-weight:${iT||iW?700:400}">${i+1}</th>`;
      }).join("")}
      <th>А</th><th>Т</th><th>Ч</th><th>Ө</th><th>Э</th><th>ИЦ</th>
    </tr></thead>
    <tbody>
      ${Object.values(byUserM).map(x=>`
        <tr>
          <td class="stickyName"><b>${x.user.full_name}</b><div class="small muted">${x.user.position||""}</div></td>
          ${Array.from({length:daysInMonth},(_,i)=>{
            const dt=new Date(year,month-1,i+1);
            const iW=dt.getDay()===0||dt.getDay()===6;
            const code=x.days[i+1]||"";
            const recId=x.recIds?.[i+1]||0;
            const canE=["director","hr"].includes(state.me.role);
            const style=`background:${!code&&iW?'#fff5f5':'transparent'};${canE?'cursor:pointer;':''}`;
            const click=canE?` onclick="editAttendanceCell(${x.user.id},${i+1},${recId})"` :'';
            return `<td style="${style}"${click}>${code?`<span class="dayCode ${codeClass(code)}">${code}</span>`:(iW?'<span style="color:#fca5a5;font-size:10px">—</span>':'')}</td>`;
          }).join("")}
          <td><b>${x.summary.worked}</b></td>
          <td style="color:#dc2626">${x.summary.absent}</td>
          <td style="color:#d97706">${x.summary.leave}</td>
          <td style="color:#2563eb">${x.summary.sick}</td>
          <td style="color:#475569">${x.summary.vacation}</td>
          <td style="color:#7c3aed">${x.summary.overtime}</td>
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
    const start = new Date(r.start_date.slice(0,10));
    const end   = new Date((r.end_date||r.start_date).slice(0,10));
    if (start.getFullYear() !== year && end.getFullYear() !== year) return;
    const yS = new Date(year,0,1), yE = new Date(year,11,31);
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
    const t = r.record_type;
    if (t==="Ажилласан")     { u.months[m].w++;  u.total.w++;  }
    if (t==="Ажил тасалсан") { u.months[m].a++;  u.total.a++;  }
    if (t==="Чөлөө")         { u.months[m].l++;  u.total.l++;  }
    if (t==="Өвчтэй")        { u.months[m].s++;  u.total.s++;  }
    if (t==="Ээлжийн амралт"){ u.months[m].v++;  u.total.v++;  }
    if (t==="Илүү цаг")      { u.months[m].ot++; u.total.ot++; }
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
              <span style="font-size:11px;font-weight:${m.w>0?700:400};color:${m.w>0?'#16a34a':'#cbd5e1'}">${m.w||"·"}</span>
            </td>
            <td style="text-align:center;padding:5px 3px;border-bottom:.5px solid #e2e6ed">
              <span style="font-size:11px;font-weight:${m.a>0?700:400};color:${m.a>0?'#dc2626':'#cbd5e1'}">${m.a||"·"}</span>
            </td>`).join("")}
          <td style="text-align:center;padding:5px 4px;border-bottom:.5px solid #e2e6ed;border-left:2px solid #2563eb;background:${ri%2===0?'#f0f7ff':'#e8f2ff'}">
            <b style="color:#16a34a">${u.total.w}</b>
          </td>
          <td style="text-align:center;padding:5px 4px;border-bottom:.5px solid #e2e6ed;background:${ri%2===0?'#f0f7ff':'#e8f2ff'}">
            <b style="color:${u.total.a>0?'#dc2626':'#cbd5e1'}">${u.total.a||"·"}</b>
          </td>
          <td style="text-align:center;padding:5px 4px;border-bottom:.5px solid #e2e6ed;background:${ri%2===0?'#f0f7ff':'#e8f2ff'}">
            <span style="color:${u.total.l>0?'#d97706':'#cbd5e1'}">${u.total.l||"·"}</span>
          </td>
          <td style="text-align:center;padding:5px 4px;border-bottom:.5px solid #e2e6ed;background:${ri%2===0?'#f0f7ff':'#e8f2ff'}">
            <span style="color:${u.total.s>0?'#2563eb':'#cbd5e1'}">${u.total.s||"·"}</span>
          </td>
          <td style="text-align:center;padding:5px 4px;border-bottom:.5px solid #e2e6ed;background:${ri%2===0?'#f0f7ff':'#e8f2ff'}">
            <span style="color:${u.total.v>0?'#475569':'#cbd5e1'}">${u.total.v||"·"}</span>
          </td>
          <td style="text-align:center;padding:5px 4px;border-bottom:.5px solid #e2e6ed;background:${ri%2===0?'#f0f7ff':'#e8f2ff'}">
            <span style="color:${u.total.ot>0?'#7c3aed':'#cbd5e1'}">${u.total.ot||"·"}</span>
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

  const startD = new Date(startStr);
  const endD   = new Date(endStr);
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

  const codeMap = {
    "Ажилласан":"А","Ажил тасалсан":"Т","Чөлөө":"Ч",
    "Өвчтэй":"Ө","Ээлжийн амралт":"Э","Хоцорсон":"Х","Илүү цаг":"ИЦ"
  };
  const latestByDay = {};
  rows.forEach(r => {
    if (!byU[r.user_id] || !r.start_date) return;
    const rs = new Date(r.start_date.slice(0,10));
    const re = new Date((r.end_date||r.start_date).slice(0,10));
    const rS = rs > startD ? rs : startD;
    const rE = re < endD   ? re : endD;
    if (rS > rE) return;
    for (let c = new Date(rS); c <= rE; c.setDate(c.getDate()+1)) {
      const key = `${r.user_id}|${c.toISOString().slice(0,10)}`;
      if (!latestByDay[key] || r.id > latestByDay[key].id) latestByDay[key] = r;
    }
  });

  Object.entries(latestByDay).forEach(([key, r]) => {
    const [uid, dateStr] = key.split("|");
    if (!byU[uid]) return;
    const code = codeMap[r.record_type] || "";
    byU[uid].days[dateStr]   = code;
    byU[uid].recIds[dateStr] = r.id;
    if (code==="А")  byU[uid].summary.worked++;
    if (code==="Т")  byU[uid].summary.absent++;
    if (code==="Ч")  byU[uid].summary.leave++;
    if (code==="Ө")  byU[uid].summary.sick++;
    if (code==="Э")  byU[uid].summary.vacation++;
    if (code==="Х")  byU[uid].summary.late++;
    if (code==="ИЦ") byU[uid].summary.overtime++;
  });

  const canE = ["director","hr"].includes(state.me.role);
  const todayStr = today();

  tc.innerHTML = `<div class="attendanceWrap"><table class="attendanceTable">
    <thead><tr>
      <th class="stickyName">Ажилтан</th>
      ${days.map(d => {
        const ds  = d.toISOString().slice(0,10);
        const dw  = d.getDay();
        const iW  = dw===0||dw===6;
        const iT  = ds===todayStr;
        const lbl = `${d.getMonth()+1}/${d.getDate()}`;
        return `<th style="background:${iT?'#eff6ff':iW?'#fff5f5':''};color:${iT?'#2563eb':iW?'#dc2626':'#667085'};font-weight:${iT||iW?700:400};font-size:10px;padding:4px 2px">${lbl}</th>`;
      }).join("")}
      <th>А</th><th>Т</th><th>Ч</th><th>Ө</th><th>Э</th><th>Х</th><th>ИЦ</th>
    </tr></thead>
    <tbody>
      ${Object.values(byU).map(x=>`
        <tr>
          <td class="stickyName"><b>${x.user.full_name}</b><div class="small muted">${x.user.position||""}</div></td>
          ${days.map(d => {
            const ds  = d.toISOString().slice(0,10);
            const dw  = d.getDay();
            const iW  = dw===0||dw===6;
            const code  = x.days[ds] || "";
            const recId = x.recIds[ds] || 0;
            const style = `background:${!code&&iW?'#fff5f5':'transparent'};${canE?'cursor:pointer;':''}`;
            const click = canE ? ` onclick="editAttendanceCellDate(${x.user.id},'${ds}',${recId})"` : '';
            return `<td style="${style}"${click}>${code?`<span class="dayCode ${codeClass(code)}">${code}</span>`:(iW?'<span style="color:#fca5a5;font-size:10px">—</span>':'')}</td>`;
          }).join("")}
          <td><b>${x.summary.worked}</b></td>
          <td style="color:#dc2626">${x.summary.absent}</td>
          <td style="color:#d97706">${x.summary.leave}</td>
          <td style="color:#2563eb">${x.summary.sick}</td>
          <td style="color:#475569">${x.summary.vacation}</td>
          <td style="color:#92400e">${x.summary.late}</td>
          <td style="color:#7c3aed">${x.summary.overtime}</td>
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
  const div  = document.createElement("div");
  div.id = "cellEditModal";
  div.style = "position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;display:flex;align-items:center;justify-content:center";
  div.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:24px;width:320px;box-shadow:0 20px 60px rgba(0,0,0,.25)">
      <div style="font-size:15px;font-weight:800;margin-bottom:4px">Ирц засварлах</div>
      <div style="font-size:12px;color:#667085;margin-bottom:16px">${user?.full_name||""} · ${dateStr}</div>
      <select id="cellEditType" class="input" style="width:100%;margin-bottom:16px">
        <option value="">— Бүртгэл устгах (хоосон болгох) —</option>
        <option>Ажилласан</option>
        <option>Ажил тасалсан</option>
        <option>Чөлөө</option>
        <option>Өвчтэй</option>
        <option>Ээлжийн амралт</option>
        <option>Хоцорсон</option>
        <option>Илүү цаг</option>
      </select>
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
      await api("/api/hr-records", {
        method:"POST",
        body:JSON.stringify({ user_id:userId, record_type:type, start_date:dateStr, end_date:dateStr, note:"Засварласан" })
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
  const startD = new Date(startStr);
  const endD   = new Date(endStr);
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
    const rs = new Date(r.start_date.slice(0,10));
    const re = new Date((r.end_date||r.start_date).slice(0,10));
    const rS = rs > startD ? rs : startD;
    const rE = re < endD   ? re : endD;
    if (rS > rE) return;
    for (let c = new Date(rS); c <= rE; c.setDate(c.getDate()+1)) {
      const key = `${r.user_id}|${c.toISOString().slice(0,10)}`;
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
      const ds  = d.toISOString().slice(0,10);
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
  if (type === "Ажилласан" || type === "Хоцорсон" || type === "Илүү цаг") {
    box.innerHTML = `
      <div class="row3">
        <input class="input" id="amorningIn" type="time" value="08:30">
        <input class="input" id="alunchOut" type="time" value="12:30">
        <input class="input" id="aafternoonIn" type="time" value="13:30">
      </div>
      <div class="row">
        <input class="input" id="aeveningOut" type="time" value="17:30">
        <div>
          <div class="small muted">Илүү цаг (цаг)</div>
          <input class="input" id="aovertime" type="number" value="0" placeholder="Жишээ: 2">
        </div>
      </div>
    `;
  } else {
    box.innerHTML = `
      <div class="row">
        <input class="input" id="astartDate" type="date" value="${today()}">
        <input class="input" id="aendDate" type="date" value="${today()}">
      </div>
    `;
  }
}

async function saveAttendance() {
  const type = atype.value;
  let noteText = anote.value || "";
  let startDate = adate.value;
  let endDate = adate.value;

  if (!auser.value) { toast("Ажилтан сонгоно уу"); return; }

  const todayStr = today();

  if (type === "Ажилласан" || type === "Хоцорсон" || type === "Илүү цаг") {
    if (!startDate) { toast("Огноо сонгоно уу"); return; }
    if (startDate > todayStr) { toast("Ирцийн огноо ирээдүйн огноо байж болохгүй"); return; }
    const mi = amorningIn.value;
    const lo = alunchOut.value;
    const ai = aafternoonIn.value;
    const eo = aeveningOut.value;
    const ot = aovertime.value || 0;
    noteText =
      `Өглөө ирсэн: ${mi}, Үдэд гарсан: ${lo}, Үдээс хойш ирсэн: ${ai}, Тарсан: ${eo}, Илүү цаг: ${ot}` +
      (noteText ? " | " + noteText : "");
  } else {
    startDate = astartDate.value;
    endDate = aendDate.value;
    if (!startDate) { toast("Эхлэх огноо сонгоно уу"); return; }
    if (!endDate)   { toast("Дуусах огноо сонгоно уу"); return; }
    if (endDate < startDate) { toast("Дуусах огноо эхлэх огнооноос өмнө байж болохгүй"); return; }
  }

  try {
    await api("/api/hr-records", {
      method: "POST",
      body: JSON.stringify({
        user_id: auser.value,
        record_type: type,
        start_date: startDate,
        end_date: endDate,
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

  const div = document.createElement("div");
  div.id = "cellEditModal";
  div.style = "position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;display:flex;align-items:center;justify-content:center";
  div.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:24px;width:320px;box-shadow:0 20px 60px rgba(0,0,0,.25)">
      <div style="font-size:15px;font-weight:800;margin-bottom:4px">Ирц засварлах</div>
      <div style="font-size:12px;color:#667085;margin-bottom:16px">${user?.full_name||""} · ${date}</div>
      <select id="cellEditType" class="input" style="width:100%;margin-bottom:16px">
        <option value="">— Бүртгэл устгах (хоосон болгох) —</option>
        <option>Ажилласан</option>
        <option>Ажил тасалсан</option>
        <option>Чөлөө</option>
        <option>Өвчтэй</option>
        <option>Ээлжийн амралт</option>
        <option>Хоцорсон</option>
        <option>Илүү цаг</option>
      </select>
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
      await api("/api/hr-records", {
        method: "POST",
        body: JSON.stringify({ user_id: userId, record_type: type, start_date: date, end_date: date, note: "Засварласан" })
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
        note: "Өглөө ирсэн: 08:30, Үдэд гарсан: 12:30, Үдээс хойш ирсэн: 13:30, Тарсан: 17:30"
      })
    });
  }
  toast("Бүх ажилтан ажилласнаар бүртгэгдлээ");
  attendance();
}

// ════════════════════════════════════════════════════════════
// ХҮНИЙ НӨӨЦИЙН УДИРДЛАГА · HR CENTER
// ════════════════════════════════════════════════════════════

const HR_DEPTS = ["Захиргаа","Инженер","Гэрэлтүүлэг","Цахилгаан","Камер","Санхүү","Хүний нөөц","Нярав","ХАБЭА","Бусад"];
const HR_POSITIONS = ["Захирал","Ерөнхий инженер","Инженер","Гэрэлтүүлгийн техникч","Цахилгаанчин","Камерын техникч","Нягтлан бодогч","ХН менежер","Агуулахын эрхлэгч","Аюулгүй байдлын мэргэжилтэн","Жолооч","Ажилчин","Бусад"];
const HR_CONTRACT_TYPES = ["Байнгын","Гэрээт","Туршилтын","Цагийн"];
const HR_STATUSES = ["Идэвхтэй","Чөлөөлөгдсөн","Амралтанд","Өвчтэй"];
const HR_EDUS = ["Дээд","Бүрэн дунд","Тусгай мэргэжлийн","Докторант","Магистр"];
const HR_HIST_TYPES = ["Томилогдсон","Цалин өссөн","Шагнагдсан","Сануулга","Чөлөөлөгдсөн","Сургалт","Өөр"];
const DEPT_COLORS = {
  "Захиргаа":   { bg:"#eff6ff", color:"#1d4ed8", border:"#bfdbfe" },
  "Санхүү":     { bg:"#f0fdf4", color:"#15803d", border:"#bbf7d0" },
  "Техник":     { bg:"#fdf4ff", color:"#7e22ce", border:"#e9d5ff" },
  "Хяналт":     { bg:"#fff7ed", color:"#c2410c", border:"#fed7aa" },
  "Хүний нөөц":{ bg:"#fdf2f8", color:"#be185d", border:"#fbcfe8" },
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
        <th style="padding:10px 12px;text-align:left;font-weight:600;color:#475569;font-size:11px">ГЭРЭЭ</th>
        <th style="padding:10px 12px;text-align:left;font-weight:600;color:#475569;font-size:11px">АЖИЛСАН</th>
        <th style="padding:10px 12px;text-align:left;font-weight:600;color:#475569;font-size:11px">ЦАЛИН</th>
        <th style="padding:10px 12px;text-align:left;font-weight:600;color:#475569;font-size:11px">СТАТУС</th>
        <th style="padding:10px 12px;text-align:center;font-weight:600;color:#475569;font-size:11px">ҮЙЛДЭЛ</th>
      </tr>
    </thead>
    <tbody>
      ${filtered.length === 0 ? `<tr><td colspan="7" style="text-align:center;padding:40px;color:#94a3b8">Ажилтан олдсонгүй</td></tr>` :
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
            <select class="input" id="hf_gender">
              <option value="">—</option>
              <option ${u.gender==="Эрэгтэй"?"selected":""}>Эрэгтэй</option>
              <option ${u.gender==="Эмэгтэй"?"selected":""}>Эмэгтэй</option>
            </select></div>
          <div><div class="small muted">Төрсөн өдөр</div>
            <input class="input" id="hf_birth" type="date" value="${u.birthdate||""}"></div>
        </div>
        <div class="row">
          <div><div class="small muted">Үндэс</div>
            <input class="input" id="hf_nat" value="${escapeHtml(u.nationality||"Монгол")}"></div>
          <div><div class="small muted">Яаралтай холбоо</div>
            <input class="input" id="hf_emergency" value="${escapeHtml(u.emergency_contact||"")}"></div>
        </div>
        <div><div class="small muted">Боловсрол</div>
          <select class="input" id="hf_edu">
            <option value="">—</option>
            ${HR_EDUS.map(e=>`<option ${u.education===e?"selected":""}>${e}</option>`).join("")}
          </select></div>
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
        ["Боловсрол", u.education],
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
    if (id) await api(`/api/trainings/${id}`,{method:"PUT",body:JSON.stringify(body)});
    else await api("/api/trainings",{method:"POST",body:JSON.stringify(body)});
    document.getElementById("trainingModal")?.remove();
    toast("Хадгалагдлаа");
    hrRenderTraining(document.getElementById("hrSubContent"));
  } catch(e) { toast("Алдаа: "+e.message); }
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

function surveyUseTemplate(key) {
  if (key === "abbd") surveyAdd(surveyTemplateAbbd());
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
      <button class="btn secondary" onclick="surveyUseTemplate('abbd')">📋 АББД загвараас үүсгэх</button>
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
  const needsOptions = q.type === "Нэг сонголт" || q.type === "Олон сонголт";
  const options = (q.options && q.options.length ? q.options : [""]).map((opt, oi) => `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <span style="font-size:13px;color:#64748b">${q.type==="Олон сонголт" ? "☑" : "○"}</span>
      <input class="input svq-option" data-q="${idx}" value="${escapeHtml(opt)}" placeholder="Сонголт..." style="font-size:12px;flex:1">
      <button type="button" onclick="surveyRemoveOption(${idx},${oi})" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:14px">✕</button>
    </div>`).join("");
  return `
  <div style="background:#f8fafc;border-radius:8px;padding:10px 12px;border:1px solid #e2e8f0">
    <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
      <span style="font-size:11px;font-weight:700;color:#64748b;min-width:20px">${idx+1}.</span>
      <input class="input" id="svq_text_${idx}" value="${escapeHtml(q.text||"")}" placeholder="Асуултын текст..." style="flex:1;font-size:12px">
      <select class="input" id="svq_type_${idx}" onchange="surveyRefreshQuestions()" style="width:120px;font-size:12px">
        ${["Нэг сонголт","Олон сонголт","Текст","Оноо (1-5)"].map(t=>`<option ${(q.type||"Нэг сонголт")===t?"selected":""}>${t}</option>`).join("")}
      </select>
      <button onclick="surveyRemoveQuestion(${idx})" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:16px">✕</button>
    </div>
    ${needsOptions ? `
    <div style="font-size:11px;color:#64748b;margin-bottom:6px">Сонголтууд</div>
    <div id="svq_opts_${idx}">${options}</div>
    <button type="button" class="btn secondary sm" onclick="surveyAddOption(${idx})">+ Сонголт нэмэх</button>`:""}
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
    const options = [...document.querySelectorAll(`.svq-option[data-q="${i}"]`)]
      .map(el => el.value.trim())
      .filter(Boolean);
    return { text, type, options };
  });
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
    return [r.submitted_at || "", ...qs.map((_, i) => Array.isArray(answers[i]) ? answers[i].join("; ") : (answers[i] ?? ""))];
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
          ${q.type==="Текст"?`<textarea class="input" id="sfq_${i}" rows="2" placeholder="Хариулт..."></textarea>`:
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
  for (let i=0;i<qCount;i++) {
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
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div>
          <div style="font-weight:800;font-size:16px">📊 ${escapeHtml(title)} — Үр дүн</div>
          <div style="font-size:12px;color:#64748b">Нийт ${responses.length} хариулт</div>
        </div>
        <button onclick="document.getElementById('surveyResultModal').remove()" style="background:none;border:none;font-size:20px;color:#94a3b8;cursor:pointer">✕</button>
      </div>
      ${qs.map((q,i)=>{
        const ans = responses.map(r=>{
          const parsed = typeof r.answers==="string"?JSON.parse(r.answers||"{}"):r.answers||{};
          return parsed[i];
        }).filter(a=>a!=null);
        if (q.type==="Текст") {
          return `<div style="background:#f8fafc;border-radius:10px;padding:14px;margin-bottom:12px">
            <div style="font-weight:600;margin-bottom:8px">${i+1}. ${escapeHtml(q.text)}</div>
            ${ans.slice(0,5).map(a=>`<div style="padding:4px 8px;font-size:12px;color:#475569;border-left:3px solid #2563eb;margin-bottom:4px">${escapeHtml(String(a))}</div>`).join("")}
            ${ans.length>5?`<div style="font-size:11px;color:#94a3b8">болон ${ans.length-5} хариулт...</div>`:""}
          </div>`;
        }
        if (q.type==="Оноо (1-5)") {
          const avg = ans.length?ans.reduce((s,v)=>s+Number(v),0)/ans.length:0;
          return `<div style="background:#f8fafc;border-radius:10px;padding:14px;margin-bottom:12px">
            <div style="font-weight:600;margin-bottom:8px">${i+1}. ${escapeHtml(q.text)}</div>
            <div style="font-size:28px;font-weight:800;color:#1d4ed8">${avg.toFixed(1)} <span style="font-size:14px;color:#64748b">/ 5</span></div>
            <div style="font-size:11px;color:#64748b">${ans.length} хариулт</div>
          </div>`;
        }
        const counts = {};
        ans.forEach(a=>{const vals=Array.isArray(a)?a:[a];vals.forEach(v=>{counts[v]=(counts[v]||0)+1;});});
        return `<div style="background:#f8fafc;border-radius:10px;padding:14px;margin-bottom:12px">
          <div style="font-weight:600;margin-bottom:10px">${i+1}. ${escapeHtml(q.text)}</div>
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
  surveyAddQuestion, surveyRemoveQuestion, surveyAddOption, surveyRemoveOption, surveyRefreshQuestions, surveyFill, surveySubmit, surveyViewResults });

// ── Tab 3: Цалингийн тооцоо ───────────────────────────────────

function hrNdPayrollRange(year, month) {
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  return {
    start: new Date(prevYear, prevMonth - 1, 21),
    end: new Date(year, month - 1, 20),
  };
}

function hrNdWorkedDays(records, userId, year, month) {
  const days = new Map();
  const { start: rangeStartDate, end: rangeEndDate } = hrNdPayrollRange(year, month);
  records.forEach(r => {
    if (r.user_id !== userId || !r.start_date) return;
    const start = new Date(r.start_date.slice(0, 10));
    const end = new Date((r.end_date || r.start_date).slice(0, 10));
    const rangeStart = start > rangeStartDate ? start : rangeStartDate;
    const rangeEnd = end < rangeEndDate ? end : rangeEndDate;
    if (rangeStart > rangeEnd) return;
    for (let d = new Date(rangeStart); d <= rangeEnd; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      const prev = days.get(key);
      if (!prev || r.id > prev.id) days.set(key, r);
    }
  });
  return [...days.values()].filter(r => ["Ажилласан", "Хоцорсон", "Илүү цаг"].includes(r.record_type)).length;
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
  const ND_EMP = 0.10, ND_EMP_HEALTH = 0.02;
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
  const totalNdEmp  = totalNdBase * (ND_EMP + ND_EMP_HEALTH);
  const totalNdOrg  = totalNdBase * (ND_ORG + ND_ORG_HEALTH);

  tc.innerHTML = `
  <div style="padding:20px 24px">
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:24px">
      ${[
        ["Үндсэн цалин", totalSalary.toLocaleString()+"₮","#1d4ed8","#eff6ff"],
        ["Ур чадвар", totalSkillAllowance.toLocaleString("mn-MN",{maximumFractionDigits:0})+"₮","#0f766e","#ecfdf5"],
        ["Ажилласан жил", totalTenureAllowance.toLocaleString("mn-MN",{maximumFractionDigits:0})+"₮","#4338ca","#eef2ff"],
        ["Хоол", totalMealAllowance.toLocaleString()+"₮","#b45309","#fffbeb"],
        ["НД тооцох дүн", totalNdBase.toLocaleString()+"₮","#334155","#f8fafc"],
        ["Ажилтны НД", totalNdEmp.toLocaleString("mn-MN",{maximumFractionDigits:0})+"₮","#7e22ce","#fdf4ff"],
        ["Байгуулллагын НД", totalNdOrg.toLocaleString("mn-MN",{maximumFractionDigits:0})+"₮","#15803d","#dcfce7"],
        ["Нийт НД", (totalNdEmp+totalNdOrg).toLocaleString("mn-MN",{maximumFractionDigits:0})+"₮","#c2410c","#fff7ed"]
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
      НД хувь: Ажилтан <b>${(ND_EMP*100).toFixed(0)}%</b> пенсион + <b>${(ND_EMP_HEALTH*100).toFixed(0)}%</b> эмнэлэг ·
      Байгуулллага <b>${(ND_ORG*100).toFixed(1)}%</b> + <b>${(ND_ORG_HEALTH*100).toFixed(0)}%</b> эмнэлэг
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
          <th style="padding:8px 8px;text-align:right;font-size:10px;font-weight:700;color:#475569">БАЙГ.НД</th>
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
          const empNd = base * (ND_EMP + ND_EMP_HEALTH);
          const orgNd = base * (ND_ORG + ND_ORG_HEALTH);
          const net = base - empNd;
          return `
          <tr style="border-bottom:1px solid #f1f5f9;background:${i%2===0?'#fff':'#fafbfc'}">
            <td style="padding:8px 10px;position:sticky;left:0;background:${i%2===0?'#fff':'#fafbfc'};z-index:1">
              <div style="font-weight:700;line-height:1.25">${escapeHtml(u.full_name)}</div>
              <div style="font-size:10px;color:#64748b;line-height:1.25">${escapeHtml(u.position||"")}</div>
            </td>
            <td style="padding:8px 8px;text-align:right">
              <input id="nd_salary_${u.id}" class="input" type="number" min="0" value="${sal || ""}"
                oninput="hrPreviewNdRow(${u.id},${days})"
                ${canEditNd ? "" : "disabled"} style="width:92px;margin:0;text-align:right;font-weight:700;color:#0f172a;padding:7px 8px">
            </td>
            <td style="padding:8px 8px;text-align:right">
              <input id="nd_skill_${u.id}" class="input" type="number" min="0" max="25" step="1" value="${skillRate || ""}"
                oninput="hrPreviewNdRow(${u.id},${days})"
                ${canEditNd ? "" : "disabled"} style="width:64px;margin:0;text-align:right;color:#0f766e;padding:7px 8px">
            </td>
            <td id="nd_skill_amt_${u.id}" style="padding:8px 8px;text-align:right;color:#0f766e;font-weight:700">${skill.toLocaleString("mn-MN",{maximumFractionDigits:0})}₮</td>
            <td style="padding:8px 8px;text-align:right">
              <input id="nd_tenure_years_${u.id}" class="input" type="number" min="0" step="1" value="${tenureYears ? Math.floor(tenureYears) : ""}"
                oninput="hrPreviewNdRow(${u.id},${days})"
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
            <td id="nd_org_${u.id}" style="padding:8px 8px;text-align:right;color:#15803d">${orgNd.toLocaleString("mn-MN",{maximumFractionDigits:0})}₮</td>
            <td id="nd_net_${u.id}" style="padding:8px 8px;text-align:right;font-weight:700;color:#0f172a">${net.toLocaleString("mn-MN",{maximumFractionDigits:0})}₮</td>
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
          <td style="padding:9px 8px;text-align:right;font-weight:700;color:#15803d">${totalNdOrg.toLocaleString("mn-MN",{maximumFractionDigits:0})}₮</td>
          <td style="padding:9px 8px;text-align:right;font-weight:700">${(totalNdBase-totalNdEmp).toLocaleString("mn-MN",{maximumFractionDigits:0})}₮</td>
          <td style="position:sticky;right:0;background:#f0f7ff"></td>
        </tr>
      </tfoot>
    </table>
    </div>
  </div>`;
}

function hrPreviewNdRow(userId, days) {
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
  const base = salary + skill + tenure + meal;
  const empNd = base * 0.12;
  const orgNd = base * 0.135;
  const net = base - empNd;
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
  set(`nd_org_${userId}`, money(orgNd));
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

  const ctCount = {};
  HR_CONTRACT_TYPES.forEach(t => ctCount[t] = 0);
  _hrUsers.forEach(u => { const t=u.contract_type||"Байнгын"; if(ctCount[t]!==undefined) ctCount[t]++; });

  tc.innerHTML = `
  <div style="padding:20px 24px;display:flex;flex-direction:column;gap:20px">
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
        <div style="font-weight:700;font-size:14px;margin-bottom:14px">Хэлтэсийн хүн хүч</div>
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
        ${HR_CONTRACT_TYPES.map(t => {
          const pct = _hrUsers.length ? Math.round(ctCount[t]/_hrUsers.length*100) : 0;
          const c = {"Байнгын":"#1d4ed8","Гэрээт":"#7e22ce","Туршилтын":"#c2410c","Цагийн":"#15803d"}[t]||"#475569";
          return `
          <div style="margin-bottom:10px">
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
              <span>${t}</span><b>${ctCount[t]} (${pct}%)</b>
            </div>
            <div style="background:#f1f5f9;border-radius:99px;height:8px;overflow:hidden">
              <div style="background:${c};height:100%;border-radius:99px;width:${pct}%;transition:width .4s"></div>
            </div>
          </div>`;
        }).join("")}

        <div style="margin-top:16px;font-size:12px;color:#64748b;background:#f8fafc;border-radius:8px;padding:10px">
          Нийт: ${_hrUsers.length} ажилтан · Идэвхтэй: ${active} · Чөлөөлөгдсөн: ${inactive}
        </div>
      </div>
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
  </div>`;
}

// ════════════════════════════════════════════════════════════
// ХАБЭА · ТӨЛӨВЛӨГӨӨ
// ════════════════════════════════════════════════════════════

async function safety() {
  main.innerHTML = `<div style="padding:40px;text-align:center;color:#94a3b8">
    <div style="font-size:48px;margin-bottom:12px">🦺</div>
    <div style="font-size:16px;font-weight:600">ХАБЭА модуль ачаалж байна...</div>
  </div>`;
  if (typeof window._safetyModule === "function") window._safetyModule();
}

async function plans() {
  const rows = await api("/api/plans");

  main.innerHTML = `
  <h1>Төлөвлөгөө</h1>

  <div class="panel">
    <h2>Шинэ төлөвлөгөө</h2>
    <div class="row3">
      <input class="input" id="ptitle" placeholder="Төлөвлөгөөний нэр">
      <input class="input" id="pyear" type="number" value="${new Date().getFullYear()}">
      <input class="input" id="pbudget" type="number" placeholder="Төсөв">
    </div>
    <textarea class="input" id="pdesc" placeholder="Тайлбар"></textarea>
    <button class="btn" onclick="savePlan()">Хадгалах</button>
  </div>

  <div class="panel">
    <h2>Төлөвлөгөөнүүд</h2>
    ${table(
      ["Он","Нэр","Төсөв","Тайлбар"],
      rows.map(r => [
        r.year || r.plan_year,
        r.title,
        Number(r.budget || 0).toLocaleString() + "₮",
        r.description || r.note || ""
      ])
    )}
  </div>

  <div class="panel">
    <h2>AI санал</h2>
    <div class="alertItem good">
      2026 оны өгөгдөл дээр үндэслэн:
      <ul>
        <li>Гэрэлтүүлгийн материалын төсөв 18% өсөх магадлалтай</li>
        <li>Камерын засвар 3-р улиралд өсөх хандлагатай</li>
        <li>Илүү цаг хамгийн өндөр сар: 11-р сар</li>
      </ul>
    </div>
  </div>`;
}

async function savePlan() {
  await api("/api/plans", {
    method: "POST",
    body: JSON.stringify({
      title: ptitle.value,
      year: Number(pyear.value),
      budget: Number(pbudget.value || 0),
      note: pdesc.value,
      plan_type: "Жилийн"
    })
  });
  toast("Төлөвлөгөө хадгаллаа");
  plans();
}

Object.assign(window, {
  attendance, switchAttTab, renderAttMonth, renderAttYear, renderAttRange,
  attChangeYear, attJumpToPayrollInterval, showAttCalendar, attPrint, _attPrintMonthForm, _attPrintYearSimple, _attPrintRangeForm,
  onAttendanceTypeChange, saveAttendance, editAttendanceCell, editAttendanceCellDate, markAllWorked,
  hr, hrSwTab, hrSwSubTab, hrRenderEmployees, hrRenderEmployeeList, hrRenderDocs, hrRenderND, hrPreviewNdRow, hrSaveNdRow, hrRenderReports,
  hrOpenForm, hrContractChg, hrCloseForm, hrSaveEmp, hrDeleteEmployee,
  hrOpenProfile, hrCloseProfile, hrProfTab, hrLoadProfTab,
  hrAddHistory, hrUploadFile, hrDelFile,
  safety, plans, savePlan,
});
