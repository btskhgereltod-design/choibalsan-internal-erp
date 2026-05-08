const API = location.origin;
let token = localStorage.getItem("token") || "";
let me = JSON.parse(localStorage.getItem("me") || "null");
let users = [];
let current = "dashboard";
let workCategory = "lighting";
let clockTimer = null;

const roleMenus = {
  director: ["dashboard","attendance","work","materials","expenses","hr","docs","safety","plans","reports","audit"],
  chief_engineer: ["dashboard","attendance","work","materials","docs","safety","plans","reports"],
  engineer: ["dashboard","attendance","work","docs","reports"],
  storekeeper: ["dashboard","attendance","materials","reports"],
  accountant: ["dashboard","attendance","expenses","reports"],
  hr: ["dashboard","attendance","hr","docs","reports"],
  safety: ["dashboard","attendance","safety","reports"]
};

const menuNames = {
  dashboard:"📊 Нэгдсэн дэлгэц",
  attendance:"⏱ Ирц / цагийн бүртгэл",
  work:"🛠 Ажлын явц",
  materials:"📦 Материал",
  expenses:"💰 Зардал",
  hr:"👥 Хүний нөөц",
  docs:"📄 Бичиг / гомдол",
  safety:"🦺 ХАБЭА",
  plans:"📈 Төлөвлөгөө",
  reports:"📑 Тайлан",
  audit:"🛡 Audit log"
};

async function api(path, opt = {}) {
  const res = await fetch(API + path, {
    ...opt,
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + token,
      ...(opt.headers || {})
    }
  });
  if (!res.ok) throw new Error((await res.json()).error || "Алдаа гарлаа");
  return res.json();
}

function toast(t) {
  const d = document.createElement("div");
  d.className = "toast";
  d.textContent = t;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 2200);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, m => ({
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    "\"":"&quot;",
    "'":"&#39;"
  }[m]));
}

function table(headers, rows) {
  return `
  <table>
    <thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead>
    <tbody>
      ${
        rows.length
        ? rows.map(r => `<tr>${r.map(c => `<td>${c ?? ""}</td>`).join("")}</tr>`).join("")
        : `<tr><td colspan="${headers.length}" class="muted">Одоогоор мэдээлэл алга</td></tr>`
      }
    </tbody>
  </table>`;
}

function userOptions(sel) {
  return users.map(u => `
    <option value="${u.id}" ${sel == u.id ? "selected" : ""}>
      ${u.full_name} — ${u.position || ""}
    </option>
  `).join("");
}

function renderLogin() {
  document.getElementById("app").innerHTML = `
  <div class="login">
    <div class="card">
      <h1>Чойбалсан хөгжил</h1>
      <p class="muted">Дотоод ажил, тайлан, төлөвлөгөөний систем</p>
      <input class="input" id="username" placeholder="Username" value="director">
      <input class="input" id="password" placeholder="Нууц код" type="password" value="1234">
      <button class="btn" onclick="login()">Нэвтрэх</button>
      <p class="muted small">Эхний код: director / 1234, engineer / 1234, hr / 1234, safety / 1234, accountant / 1234, store / 1234</p>
    </div>
  </div>`;
}

async function login() {
  try {
    const r = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ username: username.value, password: password.value })
    });
    token = r.token;
    me = r.user;
    localStorage.setItem("token", token);
    localStorage.setItem("me", JSON.stringify(me));
    init();
  } catch (e) {
    alert(e.message);
  }
}

function logout() {
  localStorage.clear();
  token = "";
  me = null;
  renderLogin();
}

async function init() {
  if (!token) return renderLogin();
  try {
    users = await api("/api/users");
  } catch {
    return renderLogin();
  }
  renderShell();
  show("dashboard");
}

function renderSidebar(allowedMenus) {
  const groups = {
    "Үндсэн":          ["dashboard", "attendance"],
    "Ажил & Санхүү":   ["work", "materials", "expenses"],
    "Хүний нөөц":      ["hr", "docs", "safety"],
    "Удирдлага":       ["plans", "reports", "audit"]
  };
  const icons = {
    dashboard:"📊", attendance:"⏱", work:"🛠", materials:"📦",
    expenses:"💰", hr:"👥", docs:"📄", safety:"🦺",
    plans:"📈", reports:"📑", audit:"🛡"
  };
  const names = {
    dashboard:"Нэгдсэн дэлгэц", attendance:"Ирц / цагийн бүртгэл",
    work:"Ажлын явц", materials:"Материал", expenses:"Зардал",
    hr:"Хүний нөөц", docs:"Бичиг / гомдол", safety:"ХАБЭА",
    plans:"Төлөвлөгөө", reports:"Тайлан", audit:"Audit log"
  };
  let html = '<div class="menu">';
  Object.entries(groups).forEach(([groupName, items]) => {
    const visible = items.filter(m => allowedMenus.includes(m));
    if (!visible.length) return;
    html += `<div class="side-label">${groupName}</div>`;
    visible.forEach(m => {
      html += `<button onclick="show('${m}')" id="menu_${m}" class="${current===m?'active':''}">
        <span class="menu-icon">${icons[m]||'•'}</span>
        ${names[m]||m}
      </button>`;
    });
    html += '<div class="side-divider"></div>';
  });
  html += '</div>';
  return html;
}

function renderShell() {
  const allowed = roleMenus[me.role] || ["dashboard"];
  document.getElementById("app").innerHTML = `
  <div class="top">
    <div class="top-brand">
      <img src="logo.jpg" onerror="this.style.display='none'" alt="">
      <div>
        <div class="brand-name">ЧОЙБАЛСАН ХӨГЖИЛ</div>
        <div class="brand-sub">ОНӨҮГ · ERP</div>
      </div>
    </div>
    <div class="top-center">
      <div class="top-search">🔍 Хайх...</div>
    </div>
    <div class="top-right" style="gap:14px;padding-right:4px">
      <div class="top-badge">ОНЛАЙН</div>
      <div id="topClock"></div>
      <div>
        <div class="top-user">
          <b>${me.full_name}</b>
          <span>${me.role}</span>
        </div>
      </div>
      <div class="top-avatar">${(me.full_name||'U')[0].toUpperCase()}</div>
      <button class="btn secondary sm" onclick="logout()">Гарах</button>
    </div>
  </div>
  <div class="layout">
    <aside class="side">
      ${renderSidebar(allowed)}
    </aside>
    <main class="main" id="main"></main>
  </div>`;
}

function updateActiveMenu(m) {
  document.querySelectorAll('.menu button').forEach(btn => {
    btn.classList.toggle('active', btn.id === `menu_${m}`);
  });
}

async function show(m) {
  current = m;
  updateActiveMenu(m);

  if (clockTimer) {
    clearInterval(clockTimer);
    clockTimer = null;
  }

  if (m === "dashboard") return dashboard();
  if (m === "attendance") return attendance();
  if (m === "work") return work();
  if (m === "materials") return materials();
  if (m === "expenses") return expenses();
  if (m === "hr") return hr();
  if (m === "docs") return docs();
  if (m === "safety") return safety();
  if (m === "plans") return plans();
  if (m === "reports") return reports();
  if (m === "audit") return audit();
}

function updateClock() {
  const timeStr = new Date().toLocaleString("mn-MN");
  const topClockEl = document.getElementById("topClock");
  if (topClockEl) topClockEl.innerText = timeStr;
  const heroClockEl = document.getElementById("heroClock");
  if (heroClockEl) heroClockEl.innerText = timeStr;
}

async function dashboard() {
  const s = await api(`/api/reports/summary?year=${new Date().getFullYear()}`);
  const todayAttendance = { worked:0, absent:0, leave:0, sick:0, vacation:0, late:0, overtime:0 };

  try {
  const hrRows = await api("/api/hr-records");
  const todayDate = today();
  const validUserIds = new Set(users.map(u => u.id));
  const latestTodayByUser = {};

  hrRows.forEach(r => {
    if (!r.start_date || !validUserIds.has(r.user_id)) return;

    const start = r.start_date.slice(0, 10);
    const end = (r.end_date || r.start_date).slice(0, 10);

    if (todayDate < start || todayDate > end) return;

    if (!latestTodayByUser[r.user_id] || r.id > latestTodayByUser[r.user_id].id) {
      latestTodayByUser[r.user_id] = r;
    }
  });

  Object.values(latestTodayByUser).forEach(r => {
    if (r.record_type === "Ажилласан") todayAttendance.worked++;
    if (r.record_type === "Ажил тасалсан") todayAttendance.absent++;
    if (r.record_type === "Чөлөө") todayAttendance.leave++;
    if (r.record_type === "Өвчтэй") todayAttendance.sick++;
    if (r.record_type === "Ээлжийн амралт") todayAttendance.vacation++;
    if (r.record_type === "Хоцорсон") todayAttendance.late++;
    if (r.record_type === "Илүү цаг") todayAttendance.overtime++;
  });
} catch (error) {
  console.warn("hr-records API failed", error);
}

  const totalWork = s.work.count || 0;
  const workCost = Math.round(s.work.total_cost || 0);
  const financeCost = Math.round(s.expenses.total || 0);
  const avgProgress = Math.round(s.work.avg_progress || 0);
  const materialWarnings = (s.materials || []).filter(x => Number(x.balance) <= 10);

  main.innerHTML = `
  <div class="hero" style="background: linear-gradient(rgba(0,0,0,0.2), rgba(0,0,0,0.2)), url('/team1.png') no-repeat center center; background-size: cover; position: relative;">
    <div class="hero-overlay" style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.3);"></div>
    <div class="heroTitleRow" style="position: relative; z-index: 2;">
      <img class="heroLogo" src="/logo.jpg" alt="Logo">
      <div>
        <h1>Чойбалсан хөгжил ОНӨҮГ</h1>
        <p class="muted">Чойбалсан хөгжил ОНӨҮГ — дотоод ажил, тайлан, төлөвлөгөөний систем</p>
        <p class="muted small">Б.Гэрэлт-Од</p>
      </div>
    </div>
    <div class="hero-right" style="position: relative; z-index: 2;">
      <div class="hero-badge">LAN ONLINE</div>
      <div id="heroClock"></div>
      <div class="weather">Choibalsan • ERP ONLINE</div>
    </div>
  </div>

  <div class="panel">
    <h2>Өнөөдрийн ирцийн дүн</h2>
    <div class="grid">
      <div class="stat"><span class="muted">Ажилласан</span><b>${todayAttendance.worked}</b></div>
      <div class="stat"><span class="muted">Тасалсан</span><b>${todayAttendance.absent}</b></div>
      <div class="stat"><span class="muted">Чөлөө</span><b>${todayAttendance.leave}</b></div>
      <div class="stat"><span class="muted">Өвчтэй</span><b>${todayAttendance.sick}</b></div>
      <div class="stat"><span class="muted">Амралт</span><b>${todayAttendance.vacation}</b></div>
      <div class="stat"><span class="muted">Илүү цаг</span><b>${todayAttendance.overtime}</b></div>
    </div>
  </div>

  <div class="grid">
    <div class="stat"><span class="muted">Нийт ажил</span><b>${totalWork}</b><p class="small muted">2026 оны бүртгэл</p></div>
    <div class="stat"><span class="muted">Ажлын зардал</span><b>${workCost.toLocaleString()}₮</b><p class="small muted">Ажилтай холбогдсон өртөг</p></div>
    <div class="stat"><span class="muted">Санхүүгийн зардал</span><b>${financeCost.toLocaleString()}₮</b><p class="small muted">Нягтлангийн бүртгэл</p></div>
    <div class="stat"><span class="muted">Дундаж явц</span><b>${avgProgress}%</b><p class="small muted">Гүйцэтгэлийн хувь</p></div>
  </div>

  <div class="smartGrid">
    <div class="panel">
      <h2>Smart City Status</h2>
      <div class="statusLine"><span>💡 Гэрэлтүүлэг</span><b class="okText">4332 бүртгэлтэй</b></div>
      <div class="statusLine"><span>🎥 Камер</span><b class="okText">191 камер</b></div>
      <div class="statusLine"><span>🚦 Гэрлэн дохио</span><b class="warnText">12 байршил</b></div>
      <div class="statusLine"><span>🌐 Backend</span><b class="okText">ONLINE</b></div>
    </div>

    <div class="panel">
      <h2>Warning Center</h2>
      ${
        materialWarnings.length
        ? materialWarnings.map(x => `<div class="alertItem">⚠ ${x.item_name} үлдэгдэл бага: <b>${x.balance}</b></div>`).join("")
        : `<div class="alertItem good">✅ Одоогоор материалын ноцтой анхааруулга алга</div>`
      }
      <div class="alertItem">📌 Хугацаа хэтэрсэн task logic дараагийн хувилбарт орно</div>
    </div>
  </div>

  <div class="panel">
    <h2>Ажлын төрөл</h2>
    ${table(["Төрөл","Тоо","Зардал"], s.byCategory.map(x => [
      x.category,
      x.count,
      Math.round(x.cost || 0).toLocaleString() + "₮"
    ]))}
  </div>

  <div class="panel">
    <h2>Материалын үлдэгдлийн зураглал</h2>
    ${table(["Материал","Үлдэгдэл"], s.materials.map(x => [
      x.item_name,
      Number(x.balance).toLocaleString()
    ]))}
  </div>`;

  updateClock();
  clockTimer = setInterval(updateClock, 1000);
}
async function attendance() {
  const rows = await api("/api/hr-records");
  const year = new Date().getFullYear();
  const month = new Date().getMonth() + 1;
  const days = new Date(year, month, 0).getDate();

  const canEditAttendance = ["director","hr"].includes(me.role);
  const todayDate = today();
  const todaySummary = { worked:0, absent:0, leave:0, sick:0, vacation:0, late:0, overtime:0 };

  const byUser = {};
  const latestRecordByDay = {};
  users.forEach(u => {
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
    if (code === "Х") {
      // Late does not contribute to the monthly summary counts aside from today’s special stat.
    }

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

    <p class="muted small">Өмнөх өдрийн бүртгэл өөрчлөхийг дараагийн хувилбарт зөвхөн Захирал/ХН эрхтэй болгоно.</p>
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
    <h2>${year} оны ${month}-р сарын ирцийн матриц</h2>

    <div class="legend">
      <span class="dayCode worked">А</span> Ажилласан
      <span class="dayCode absent">Т</span> Тасалсан
      <span class="dayCode leave">Ч</span> Чөлөө
      <span class="dayCode sick">Ө</span> Өвчтэй
      <span class="dayCode vacation">Э</span> Амралт
      <span class="dayCode late">Х</span> Хоцорсон
      <span class="dayCode overtime">ИЦ</span> Илүү цаг
    </div>

    <div class="attendanceWrap">
      <table class="attendanceTable">
        <thead>
          <tr>
            <th class="stickyName">Ажилтан</th>
            ${Array.from({length:days},(_,i)=>`<th>${i+1}</th>`).join("")}
            <th>А</th>
            <th>Т</th>
            <th>Ч</th>
            <th>Ө</th>
            <th>Э</th>
            <th>ИЦ</th>
          </tr>
        </thead>
        <tbody>
          ${Object.values(byUser).map(x => `
            <tr>
              <td class="stickyName">
                <b>${x.user.full_name}</b>
                <div class="small muted">${x.user.position || ""}</div>
              </td>
              ${Array.from({length:days},(_,i)=>{
                const code = x.days[i+1] || "";
                const editable = canEditAttendance ? " attendanceEditable" : "";
                const click = canEditAttendance ? ` onclick="editAttendanceCell(${x.user.id}, ${i+1})"` : "";
                return `<td class="attendanceCell${editable}"${click}>${code ? `<span class="dayCode ${codeClass(code)}">${code}</span>` : ""}</td>`;
              }).join("")}
              <td>${x.summary.worked}</td>
              <td>${x.summary.absent}</td>
              <td>${x.summary.leave}</td>
              <td>${x.summary.sick}</td>
              <td>${x.summary.vacation}</td>
              <td>${x.summary.overtime}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  </div>`;
  
  onAttendanceTypeChange();
}

function codeClass(code) {
  if (code === "А") return "worked";
  if (code === "Т") return "absent";
  if (code === "Ч") return "leave";
  if (code === "Ө") return "sick";
  if (code === "Э") return "vacation";
  if (code === "Х") return "late";
  if (code === "ИЦ") return "overtime";
  return "";
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

  if (type === "Ажилласан" || type === "Хоцорсон" || type === "Илүү цаг") {
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
  }

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
}

async function editAttendanceCell(userId, day) {
  if (!["director","hr"].includes(me.role)) {
    toast("Зөвхөн Захирал/ХН эрхтэй хэрэглэгч засварлах боломжтой");
    return;
  }

  const code = prompt("Ирцийн код оруулна уу? (А, Т, Ч, Ө, Э, Х, ИЦ)", "А");
  if (!code) return;

  const normalized = code.trim().toUpperCase();
  const types = {
    "А": "Ажилласан",
    "Т": "Ажил тасалсан",
    "Ч": "Чөлөө",
    "Ө": "Өвчтэй",
    "Э": "Ээлжийн амралт",
    "Х": "Хоцорсон",
    "ИЦ": "Илүү цаг"
  };

  if (!types[normalized]) {
    toast("Некоррект код. Дахин оролдож болно.");
    return;
  }

  const year = new Date().getFullYear();
  const month = new Date().getMonth() + 1;
  const paddedDay = String(day).padStart(2, "0");
  const paddedMonth = String(month).padStart(2, "0");
  const date = `${year}-${paddedMonth}-${paddedDay}`;

  await api("/api/hr-records", {
    method: "POST",
    body: JSON.stringify({
      user_id: userId,
      record_type: types[normalized],
      start_date: date,
      end_date: date,
      note: `Засварласан: ${normalized}`
    })
  });

  toast(`Ирц ${normalized} кодоор засварлалаа`);
  attendance();
}

async function markAllWorked() {
  if (!confirm("Өнөөдөр бүх ажилтныг ажилласан гэж бүртгэх үү?")) return;

  for (const u of users) {
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

async function work() {
  const rows = await api("/api/work-logs");

  main.innerHTML = `
  <h1>Үндсэн Ажил</h1>
    <div class="panel" style="padding:12px 16px">
    <button class="btn" onclick="workCategory='lighting'; work()">💡 Гэрэлтүүлэг засвар</button>
    <button class="btn secondary" onclick="workCategory='camera'; work()">🎥 Камер засвар</button>
</div>
  <div class="panel">
    <h2>Шинэ ажил бүртгэх</h2>
    <div class="row3">
      <input class="input" id="wtitle" placeholder="Ажлын нэр">
     <input class="input" id="wcat" value="${workCategory === 'lighting' ? 'Гэрэлтүүлэг засвар' : 'Камер засвар'}" readonly>
      <input class="input" id="wloc" placeholder="Байршил">
    </div>

    <div class="row3">
      <input class="input" id="wdep" placeholder="Тасаг">

      <input class="input" id="wstart" type="date" value="${today()}">

      <input class="input" id="wend" type="date" value="${today()}">
      <select id="wass" class="input">
        <option value="">Хариуцах хүн</option>
        ${userOptions()}
      </select>
    </div>

    <textarea class="input" id="wdesc" placeholder="Тайлбар"></textarea>

    <div class="row3">
      <select class="input" id="wstatus">
        <option>Эхэлсэн</option>
        <option selected>Явцтай</option>
        <option>Дууссан</option>
        <option>Хүлээгдэж байгаа</option>
      </select>
      <input class="input" id="wprog" type="number" value="0" placeholder="Явц %">
      <input class="input" id="wcost" type="number" value="0" placeholder="Зардал">
    </div>

    <button class="btn" onclick="saveWork()">Хадгалах</button>
  </div>

  <div class="panel">
    <h2>Бүртгэлүүд</h2>
    ${table(["№","Огноо","Ажил","Байршил","Төлөв","Явц","Зураг","Үйлдэл"], rows.map(r => [
      r.id,
      r.work_date,
      r.title,
      r.location,
      `<span class="pill">${r.status}</span>`,
      (r.progress || 0) + "%",
      r.photo_count || 0,
      `<button class="btn secondary" onclick="photoBox(${r.id}, '${escapeHtml(r.title)}','${escapeHtml(r.location || "")}')">Зураг</button>`
    ]))}
     </div>

   <div class="panel">
    <h2>Gantt төлөвлөгөө</h2>
    ${renderGantt(rows)}
  </div>`;
}


async function saveWork() {
  await api("/api/work-logs", {
    method: "POST",
    body: JSON.stringify({
      title: wtitle.value,
      category: wcat.value,
      description: wdesc.value,
      location: wloc.value,
      department: wdep.value,
      work_date: wstart.value,
      start_date: wstart.value,
      end_date: wend.value,
      assigned_to: wass.value || null,
      status: wstatus.value,
      progress: Number(wprog.value || 0),
      cost: Number(wcost.value || 0)
    })
  });

  toast("Ажил хадгаллаа");
  work();
}

function renderGantt(rows) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const days = new Date(year, month + 1, 0).getDate();

  const monthRows = rows.filter(r => {
    const d = new Date(r.start_date || r.work_date);
    return d.getFullYear() === year && d.getMonth() === month;
  });

  return `
    <div class="attendanceWrap">
      <table class="attendanceTable">
        <thead>
          <tr>
            <th class="stickyName">Ажил</th>
            ${Array.from({length: days}, (_, i) => `<th>${i + 1}</th>`).join("")}
            <th>Явц</th>
            <th>Төлөв</th>
          </tr>
        </thead>
        <tbody>
          ${monthRows.length ? monthRows.map(r => {
            const start = new Date(r.start_date || r.work_date);
            const end = new Date(r.end_date || r.work_date);

            const sDay = start.getDate();
            const eDay = end.getDate();

            return `
              <tr>
                <td class="stickyName">
                  <b>${escapeHtml(r.title || "")}</b>
                  <div class="small muted">${escapeHtml(r.location || "")}</div>
                </td>

                ${Array.from({length: days}, (_, i) => {
                  const day = i + 1;
                  const active = day >= sDay && day <= eDay;

                 return `
<td style="padding:2px">
  ${
    active
    ? `<div style="
        height:18px;
        border-radius:6px;
        background:${r.status === 'Дууссан'
          ? '#22c55e'
          : r.status === 'Хүлээгдэж байгаа'
          ? '#94a3b8'
          : '#3b82f6'};
      "></div>`
    : ""
  }
</td>
`;
                }).join("")}

                <td><b>${r.progress || 0}%</b></td>
                <td>${r.status || ""}</td>
              </tr>
            `;
          }).join("") : `
            <tr>
              <td colspan="${days + 3}" class="muted">
                Энэ сард бүртгэлтэй ажил алга
              </td>
            </tr>
          `}
        </tbody>
      </table>
    </div>
  `;
}


async function photoBox(id, title, loc) {
  const photos = await api(`/api/work-logs/${id}/photos`);

  main.innerHTML = `
  <button class="btn secondary" onclick="show('work')">← Буцах</button>

  <div class="panel">
    <h1>${escapeHtml(title)}</h1>
    <p class="muted">${escapeHtml(loc || "")}</p>

    <div class="row">
      <input type="file" id="pfile" class="input" accept="image/*">
      <button class="btn" onclick="uploadPhoto(${id})">Зураг нэмэх</button>
    </div>
  </div>

  <div class="panel">
    <h2>Ажлын зургууд</h2>

    <div class="photos" style="
      display:grid;
      grid-template-columns:repeat(auto-fill,minmax(220px,1fr));
      gap:16px;
    ">
      ${
        photos.length
        ? photos.map(p => {
            const img = (p.filename || p.file_path || "").replace(/^\/?uploads\//, "");
            return `
              <div class="card" style="padding:10px">
                <img 
                  src="${API}/uploads/${img}" 
                  onclick="window.open('${API}/uploads/${img}', '_blank')"
                  style="
                    width:100%;
                    height:160px;
                    object-fit:cover;
                    border-radius:12px;
                    cursor:pointer;
                    border:1px solid #e5e7eb;
                  "
                >
                <div class="small muted" style="margin-top:8px">
                  Оруулсан: ${escapeHtml(p.full_name || p.uploaded_by_name || "Хэрэглэгч")}
                </div>
                <div class="small muted">
                  Огноо: ${escapeHtml(p.created_at || p.uploaded_at || "")}
                </div>
              </div>
            `;
          }).join("")
        : `<p class="muted">Одоогоор зураг ороогүй байна</p>`
      }
    </div>
  </div>`;
}

async function uploadPhoto(id) {
  const fd = new FormData();
  fd.append("photo", pfile.files[0]);

  const r = await fetch(API + `/api/work-logs/${id}/photos`, {
    method: "POST",
    headers: { "Authorization": "Bearer " + token },
    body: fd
  });

  if (!r.ok) {
    alert("Upload амжилтгүй");
    return;
  }

  toast("Зураг хадгаллаа");
  show("work");
}

async function materials() {
  const rows = await api("/api/materials");

  main.innerHTML = `
  <h1>Материал</h1>

  <div class="panel">
    <h2>Материал нэмэх</h2>

    <div class="row3">
      <input class="input" id="mname" placeholder="Материалын нэр">
      <input class="input" id="munit" placeholder="Хэмжих нэгж">
      <input class="input" id="mbalance" type="number" value="0" placeholder="Үлдэгдэл">
    </div>

    <div class="row3">
      <input class="input" id="mwarn" type="number" value="10" placeholder="Анхааруулах үлдэгдэл">
      <input class="input" id="mprice" type="number" value="0" placeholder="Нэгж үнэ">
      <input class="input" id="mnote" placeholder="Тайлбар">
    </div>

    <button class="btn" onclick="saveMaterial()">Хадгалах</button>
  </div>

  <div class="panel">
    <h2>Материалын бүртгэл</h2>

    ${table(
      ["Нэр","Үлдэгдэл","Нэгж","Анхааруулга","Үнэ","Төлөв"],
      rows.map(r => [
        r.item_name,
        r.balance,
        r.unit,
        r.warning_level,
        Number(r.price || 0).toLocaleString() + "₮",
        Number(r.balance) <= Number(r.warning_level)
          ? `<span class="pill bad">Бага үлдэгдэл</span>`
          : `<span class="pill ok">Хэвийн</span>`
      ])
    )}
  </div>`;
}

async function saveMaterial() {
  await api("/api/materials", {
    method: "POST",
    body: JSON.stringify({
      item_name: mname.value,
      unit: munit.value,
      balance: Number(mbalance.value || 0),
      warning_level: Number(mwarn.value || 0),
      price: Number(mprice.value || 0),
      note: mnote.value
    })
  });

  toast("Материал хадгаллаа");
  materials();
}

async function expenses() {
  const rows = await api("/api/expenses");

  main.innerHTML = `
  <h1>Зардал</h1>

  <div class="panel">
    <h2>Шинэ зардал</h2>

    <div class="row3">
      <input class="input" id="ecat" placeholder="Төрөл">
      <input class="input" id="eamount" type="number" placeholder="Дүн">
      <input class="input" id="edate" type="date" value="${today()}">
    </div>

    <textarea class="input" id="edesc" placeholder="Тайлбар"></textarea>

    <button class="btn" onclick="saveExpense()">Хадгалах</button>
  </div>

  <div class="panel">
    <h2>Зардлын бүртгэл</h2>

    ${table(
      ["Огноо","Төрөл","Тайлбар","Дүн"],
      rows.map(r => [
        r.expense_date,
        r.category,
        r.description,
        Number(r.amount).toLocaleString() + "₮"
      ])
    )}
  </div>`;
}

async function saveExpense() {
  await api("/api/expenses", {
    method: "POST",
    body: JSON.stringify({
      category: ecat.value,
      amount: Number(eamount.value || 0),
      expense_date: edate.value,
      description: edesc.value
    })
  });

  toast("Зардал хадгаллаа");
  expenses();
}

let editingEmployeeId = null;

async function hr() {
  const rows = await api("/api/users");
  users = rows;

  main.innerHTML = `
  <div class="pageHead">
    <div>
      <h1>Хүний нөөц / Ажилчдын бүртгэл</h1>
      <div class="row3">
        <input class="input compact" id="employeeSearch" placeholder="Хайх: нэр, тасаг, роль, утас..." oninput="renderHrEmployees()">
        <select class="input compact" id="employeeDeptFilter" onchange="renderHrEmployees()">
          <option value="">Бүх тасаг</option>
          <option>Захиргаа Аж Ахуй</option>
          <option>Камер</option>
          <option>Гэрэлтүүлэг</option>
        </select>
        <select class="input compact" id="employeeRoleFilter" onchange="renderHrEmployees()">
          <option value="">Бүх роль</option>
          <option value="director">Захирал</option>
          <option value="hr">Хүний нөөц</option>
          <option value="chief_engineer">Ерөнхий инженер</option>
          <option value="engineer">Инженер</option>
          <option value="accountant">Нягтлан</option>
          <option value="safety">ХАБЭА</option>
          <option value="storekeeper">Нярав</option>
          <option value="Worker">Ажилтан</option>
        </select>
      </div>
    </div>
    <div class="headActions">
      <button class="btn secondary" onclick="resetEmployeeForm()">Шинэ</button>
    </div>
  </div>

  <div class="panel">
    <h2>Шинэ ажилтан нэмэх / засах</h2>

    <div class="row3">
      <input class="input" id="efull" placeholder="Овог нэр">
      <div>
        <div class="small muted">Албан тушаал</div>
        <select class="input" id="epos">
          <option>Сонгох</option>
          <option>Захирал</option>
          <option>Ерөнхий инженер</option>
          <option>Хүний нөөцийн ажилтан</option>
          <option>ХАБЭА-н ажилтан</option>
          <option>Нягтлан бодогч</option>
          <option>Сүлжээний инженер</option>
          <option>Цахилгааны инженер</option>
          <option>Нярав</option>
          <option>Сүлжээний техникч</option>
          <option>Гагнуурчин</option>
          <option>Цахилгаанчин</option>
          <option>Кранист</option>
          <option>Туслах ажилчин</option>
          <option>Сахиул</option>
        </select>
      </div>
      <div>
        <div class="small muted">Тасаг</div>
        <select class="input" id="edept">
          <option value="">Сонгох</option>
          <option>Захиргаа Аж Ахуй</option>
          <option>Камер</option>
          <option>Гэрэлтүүлэг</option>
        </select>
      </div>
    </div>

    <div class="row3">
      <input class="input" id="ereg" placeholder="Регистрийн дугаар">
      <input class="input" id="ephone" placeholder="Утас">
      <input class="input" id="eaddr" placeholder="Гэрийн хаяг">
    </div>

    <div class="row3">
      <div>
        <div class="small muted">Системийн эрх</div>
        <select class="input" id="erole">
          <option value="choice">Сонгох</option>
          <option value="director">Захирал</option>
          <option value="hr">Хүний нөөц</option>
          <option value="chief_engineer">Ерөнхий инженер</option>
          <option value="engineer">Инженер</option>
          <option value="accountant">Нягтлан</option>
          <option value="safety">ХАБЭА</option>
          <option value="storekeeper">Нярав</option>
          <option value="Worker">Ажилтан</option>
        </select>
      </div>
    </div>

    <div class="row3">
      <button class="btn" id="esave" onclick="saveEmployee()">Ажилтан нэмэх</button>
      <button class="btn secondary" onclick="resetEmployeeForm()">Цэвэрлэх</button>
    </div>
  </div>

  <div class="panel">
    <h2>Ажилчдын жагсаалт</h2>
    <div id="employeeTableHolder"></div>
  </div>`;

  resetEmployeeForm();
  renderHrEmployees();
}

function getFilteredEmployees() {
  const query = document.getElementById("employeeSearch")?.value.trim().toLowerCase() || "";
  const dept = document.getElementById("employeeDeptFilter")?.value || "";
  const role = document.getElementById("employeeRoleFilter")?.value || "";

  return users.filter(u => {
    const matchQuery =
      !query ||
      u.full_name.toLowerCase().includes(query) ||
      (u.position || "").toLowerCase().includes(query) ||
      (u.department || "").toLowerCase().includes(query) ||
      (u.phone || "").toLowerCase().includes(query) ||
      (u.role || "").toLowerCase().includes(query);

    const matchDept = !dept || (u.department || "") === dept;
    const matchRole = !role || (u.role || "") === role;

    return matchQuery && matchDept && matchRole;
  });
}

function renderHrEmployees() {
  const rows = getFilteredEmployees();

  document.getElementById("employeeTableHolder").innerHTML = table(
    ["№","Овог нэр","Албан тушаал","Тасаг","Утас","Role","Үйлдэл"],
    rows.map((r,i) => [
      i + 1,
      r.full_name,
      r.position || "",
      r.department || "",
      r.phone || "",
      r.role,
      `<button class="btn secondary" onclick="editEmployee(${r.id})">Засах</button>
       <button class="btn danger" onclick="deleteEmployee(${r.id})">Устгах</button>`
    ])
  );
}

function editEmployee(id) {
  const user = users.find(u => u.id === id);
  if (!user) return;

  editingEmployeeId = id;
  efull.value = user.full_name || "";
  epos.value = user.position || "Сонгох";
  edept.value = user.department || "";
  ereg.value = user.register_no || "";
  ephone.value = user.phone || "";
  eaddr.value = user.address || "";
  erole.value = user.role || "choice";

  const saveButton = document.getElementById("esave");
  if (saveButton) saveButton.textContent = "Засах";
}

function resetEmployeeForm() {
  editingEmployeeId = null;
  if (typeof efull !== "undefined") efull.value = "";
  if (typeof epos !== "undefined") epos.value = "Сонгох";
  if (typeof edept !== "undefined") edept.value = "";
  if (typeof ereg !== "undefined") ereg.value = "";
  if (typeof ephone !== "undefined") ephone.value = "";
  if (typeof eaddr !== "undefined") eaddr.value = "";
  if (typeof erole !== "undefined") erole.value = "choice";
  const saveButton = document.getElementById("esave");
  if (saveButton) saveButton.textContent = "Ажилтан нэмэх";
}

async function saveEmployee() {
  if (!efull.value.trim()) {
    alert("Овог нэр оруулна уу");
    return;
  }

  const payload = {
    full_name: efull.value,
    position: epos.value,
    department: edept.value,
    register_no: ereg.value,
    phone: ephone.value,
    address: eaddr.value,
    role: erole.value
  };

  if (editingEmployeeId) {
    await api(`/api/users/${editingEmployeeId}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
    toast("Ажилтан засагдлаа");
  } else {
    await api("/api/users", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    toast("Ажилтан нэмэгдлээ");
  }

  users = await api("/api/users");
  renderHrEmployees();
}

async function deleteEmployee(id) {
  if (!confirm("Энэ ажилтныг устгах уу?")) return;

  try {
    await api(`/api/users/${id}`, {
      method: "DELETE"
    });
  } catch (e) {
    alert(e.message);
    return;
  }

  if (editingEmployeeId === id) editingEmployeeId = null;
  users = await api("/api/users");
  resetEmployeeForm();
  renderHrEmployees();
  toast("Ажилтан устгагдлаа");
}

async function deactivateEmployee(id) {
  return deleteEmployee(id);
}

async function docs() {
  main.innerHTML = `
  <h1>Бичиг / гомдол</h1>

  <div class="panel">
    <h2>Санал, гомдол</h2>

    <div class="row3">
      <input class="input" placeholder="Иргэн">
      <input class="input" placeholder="Байршил">
      <input class="input" type="date" value="${today()}">
    </div>

    <textarea class="input" placeholder="Тайлбар"></textarea>

    <button class="btn">Хадгалах</button>
  </div>

  <div class="panel">
    <p class="muted">Дараагийн хувилбарт workflow engine орно.</p>
  </div>`;
}

async function safety() {
  main.innerHTML = `
  <h1>ХАБЭА</h1>

  <div class="panel">
    <h2>Эрсдэлийн бүртгэл</h2>

    <div class="row3">
      <input class="input" placeholder="Байршил">
      <input class="input" placeholder="Эрсдэлийн төрөл">
      <select class="input">
        <option>Бага</option>
        <option>Дунд</option>
        <option>Өндөр</option>
      </select>
    </div>

    <textarea class="input" placeholder="Тайлбар"></textarea>

    <button class="btn">Хадгалах</button>
  </div>`;
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
        r.plan_year,
        r.title,
        Number(r.budget || 0).toLocaleString() + "₮",
        r.description || ""
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
      plan_year: Number(pyear.value),
      budget: Number(pbudget.value || 0),
      description: pdesc.value
    })
  });

  toast("Төлөвлөгөө хадгаллаа");
  plans();
}

async function reports() {
  const work = await api("/api/work-logs");
  const expenses = await api("/api/expenses");
  const materials = await api("/api/materials");
  const attendanceRows = await api("/api/hr-records");

  const totalExpense =
    expenses.reduce((a,b)=>a + Number(b.amount || 0),0);

  const totalWorkCost =
    work.reduce((a,b)=>a + Number(b.cost || 0),0);

  const totalAttendance =
    attendanceRows.filter(x =>
      x.record_type === "Ажилласан"
    ).length;

  main.innerHTML = `
  <h1>Тайлан</h1>

  <div class="grid">
    <div class="stat">
      <span class="muted">Нийт ажил</span>
      <b>${work.length}</b>
    </div>

    <div class="stat">
      <span class="muted">Зардал</span>
      <b>${totalExpense.toLocaleString()}₮</b>
    </div>

    <div class="stat">
      <span class="muted">Ажлын өртөг</span>
      <b>${totalWorkCost.toLocaleString()}₮</b>
    </div>

    <div class="stat">
      <span class="muted">Ирц</span>
      <b>${totalAttendance}</b>
    </div>
  </div>

  <div class="panel">
    <h2>Сүүлийн ажлууд</h2>

    ${table(
      ["Огноо","Ажил","Байршил","Төлөв"],
      work.slice(0,10).map(r => [
        r.work_date,
        r.title,
        r.location,
        r.status
      ])
    )}
  </div>

  <div class="panel">
    <h2>Материалын төлөв</h2>

    ${table(
      ["Материал","Үлдэгдэл","Төлөв"],
      materials.map(r => [
        r.item_name,
        r.balance,
        Number(r.balance) <= Number(r.warning_level)
          ? `<span class="pill bad">Анхаар!</span>`
          : `<span class="pill ok">Хэвийн</span>`
      ])
    )}
  </div>

  <div class="panel">
    <h2>Тайлан хэвлэх</h2>

    <button class="btn" onclick="window.print()">
      PDF / Хэвлэх
    </button>
  </div>`;
}

async function audit() {
  const rows = await api("/api/audit-logs");

  main.innerHTML = `
  <h1>Audit log</h1>

  <div class="panel">
    ${table(
      ["Огноо","Хэрэглэгч","Үйлдэл","Дэлгэрэнгүй"],
      rows.map(r => [
        r.created_at,
        r.full_name || "",
        r.action,
        r.details || ""
      ])
    )}
  </div>`;
}

init();