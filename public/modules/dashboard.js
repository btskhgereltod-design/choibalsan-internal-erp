import { api, today, table, state, escapeHtml } from "./common.js";

// ── Weather code → [emoji, Mongolian label] ──
const WX_CODE = {
  113:['☀️','Цэлмэг'],116:['⛅','Хэсэгчилсэн үүлтэй'],119:['☁️','Үүлтэй'],
  122:['☁️','Бүрхэг'],143:['🌫️','Манантай'],176:['🌦️','Хагас бороо'],
  179:['🌨️','Хагас цас'],182:['🌧️','Шиврээ хур'],185:['🌧️','Хөлдүү шиврээ'],
  200:['⛈️','Аадар бороо'],227:['🌨️','Хийн шуурга'],230:['🌨️','Цасан шуурга'],
  248:['🌫️','Манан'],260:['🌫️','Хөлдүү манан'],263:['🌦️','Шиврээ'],
  266:['🌦️','Шиврээ бороо'],281:['🌧️','Хөлдүү шиврээ'],284:['🌧️','Хөлдүү шиврээ'],
  293:['🌧️','Жаахан бороо'],296:['🌧️','Бороо'],299:['🌧️','Дунд бороо'],
  302:['🌧️','Дунд бороо'],305:['🌧️','Хүчтэй бороо'],308:['🌧️','Хүчтэй бороо'],
  311:['🌧️','Мөсөн бороо'],314:['🌧️','Мөсөн бороо'],317:['🌧️','Мөсөн бороо'],
  320:['🌨️','Цас бороо'],323:['🌨️','Цас'],326:['🌨️','Цас'],329:['❄️','Цас'],
  332:['❄️','Цас'],335:['❄️','Хүчтэй цас'],338:['❄️','Хүчтэй цас'],
  350:['🌧️','Мөсний бөмбөлөг'],353:['🌦️','Бороо'],356:['🌧️','Бороо'],
  359:['🌧️','Хүчтэй бороо'],362:['🌨️','Цас'],365:['🌨️','Цас'],
  368:['❄️','Хүчтэй цас'],371:['❄️','Хүчтэй цас'],374:['🌧️','Мөсний бөмбөлөг'],
  377:['🌧️','Мөсний бөмбөлөг'],386:['⛈️','Аадар'],389:['⛈️','Аадар бороо'],
  392:['⛈️','Аадар'],395:['⛈️','Аадар цас'],
};

// ── Mongolian month ordinal names (1-based) ──
const MN_MON = ['','Нэгдүгээр','Хоёрдугаар','Гуравдугаар','Дөрөвдүгээр',
  'Тавдугаар','Зургаадугаар','Долдугаар','Наймдугаар','Есдүгээр',
  'Аравдугаар','Арваннэгдүгээр','Арванхоёрдугаар'];

// ── Weekday names (Sun=0) ──
const MN_WD = ['Ням','Даваа','Мягмар','Лхагва','Пүрэв','Баасан','Бямба'];

// ── Chinese/Mongolian New Year dates ──
const LUNAR_YRS = [
  { cny: new Date('2023-01-22'), el:'Хар',    an:'Туулай' },
  { cny: new Date('2024-02-10'), el:'Модон',  an:'Луу'    },
  { cny: new Date('2025-01-29'), el:'Модон',  an:'Могой'  },
  { cny: new Date('2026-02-17'), el:'Галт',   an:'Морь'   },
  { cny: new Date('2027-02-06'), el:'Галт',   an:'Хонь'   },
  { cny: new Date('2028-01-26'), el:'Газрын', an:'Бич'    },
  { cny: new Date('2029-02-13'), el:'Газрын', an:'Тахиа'  },
];

function getLunarDate(d) {
  const SYNODIC = 29.530588861;
  let yr = LUNAR_YRS[0];
  for (const ly of LUNAR_YRS) { if (d >= ly.cny) yr = ly; else break; }
  const diff = (d - yr.cny) / 86400000;
  const mIdx = Math.floor(diff / SYNODIC);
  const day  = Math.floor(diff - mIdx * SYNODIC) + 1;
  return { yearName: `${yr.el} ${yr.an}`, month: mIdx + 1, day };
}

async function fetchWeather() {
  try {
    const r = await fetch('https://wttr.in/Choibalsan?format=j1');
    if (!r.ok) return null;
    const d = await r.json();
    const c = d.current_condition[0];
    const code = Number(c.weatherCode);
    const [icon, desc] = WX_CODE[code] || ['🌤️','Мэдэгдэхгүй'];
    return { icon, desc, temp: c.temp_C, feels: c.FeelsLikeC, wind: c.windspeedKmph, hum: c.humidity };
  } catch { return null; }
}

function renderWeather(w) {
  const el = document.getElementById('wcWeather');
  if (!el) return;
  if (w) {
    el.innerHTML = `
      <div class="wc-label">🌡️ ЦАГ АГААР · ЧОЙБАЛСАН, ДОРНОД</div>
      <div class="wc-weather-row">
        <span class="wc-wicon">${w.icon}</span>
        <span class="wc-temp">${w.temp}°C</span>
        <span class="wc-cond">${w.desc}</span>
      </div>
      <div class="wc-sub">💧 Чийг ${w.hum}% &nbsp;·&nbsp; 💨 ${w.wind} км/ц &nbsp;·&nbsp; 🌡️ Мэдрэгдэх ${w.feels}°C</div>`;
  } else {
    el.innerHTML = `
      <div class="wc-label">🌡️ ЦАГ АГААР · ЧОЙБАЛСАН</div>
      <div class="wc-main" style="color:var(--ink3)">Интернэт холболт байхгүй</div>
      <div class="wc-sub">Локал сүлжээнд ажиллаж байна</div>`;
  }
}

function updateWcBar() {
  const now = new Date();
  const gEl = document.getElementById('wcGreg');
  if (gEl) {
    gEl.innerHTML = `
      <div class="wc-label">📅 ОН САРЫН ТООЛЛОЛ</div>
      <div class="wc-main">${now.getFullYear()} оны ${MN_MON[now.getMonth()+1]} сарын ${now.getDate()}</div>
      <div class="wc-sub">${MN_WD[now.getDay()]} гараг</div>`;
  }
  // Org info rendered separately via renderOrgInfo()
}

const LIGHT_CATS = [
  ["🛣️", "Авто замын гэрэл"],
  ["🏘️", "Гэр хорооллын гэрэл"],
  ["🗼", "Цамхагийн гэрэл"],
];

function dashHoursFromStr(s) {
  if (!s) return null;
  const [hh, mm] = s.split(":").map(Number);
  return hh + mm / 60;
}

function dashCivilAverageOnTime(dateStr) {
  const LAT = 48.0714, LNG = 114.5357, UTC_OFFSET = 8;
  const [year, month1, day] = dateStr.split("-").map(Number);
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
  const solarNoonMinutes = 720 - 4 * LNG - eot + UTC_OFFSET * 60;
  const eveningAt = (angleDeg) => {
    const zenith = toR(90 - angleDeg);
    const cosH = (Math.cos(zenith) / (Math.cos(lat) * Math.cos(decl))) - Math.tan(lat) * Math.tan(decl);
    if (Math.abs(cosH) > 1) return null;
    return (solarNoonMinutes + toD(Math.acos(cosH)) * 4) / 60;
  };
  const sunset = eveningAt(-0.833);
  const civilEnd = eveningAt(-6);
  if (sunset == null || civilEnd == null) return null;
  return (sunset + civilEnd) / 2;
}

function dashTimeText(hour) {
  if (hour == null || isNaN(hour)) return "—";
  const t = Math.round(((hour % 24) + 24) % 24 * 60);
  return `${String(Math.floor(t / 60)).padStart(2,"0")}:${String(t % 60).padStart(2,"0")}`;
}

function lightScheduleWarnings(logs, dateStr) {
  const suitableOn = dashCivilAverageOnTime(dateStr);
  if (suitableOn == null) return [];
  return LIGHT_CATS.map(([, cat]) => {
    const s = activeLightSchedule(logs, cat, dateStr);
    if (!s || s.is_always_off || !s.on_time) return null;
    const on = dashHoursFromStr(s.on_time);
    if (on == null || isNaN(on)) return null;
    const diff = Math.round((on - suitableOn) * 60);
    const abs = Math.abs(diff);
    if (abs <= 10) return null;
    return {
      category: cat,
      onTime: s.on_time,
      suitableOn: dashTimeText(suitableOn),
      text: diff < 0
        ? `${abs} минут эрт асаж байна`
        : `${abs} минут оройтож асаж байна`,
    };
  }).filter(Boolean);
}

function activeLightSchedule(logs, category, dateStr) {
  const monthKey = dateStr.slice(0, 7);
  const monthRows = logs
    .filter(r => r.category === category && (r.valid_from || r.adjusted_date || "").startsWith(monthKey))
    .sort((a,b) => (b.valid_from || "").localeCompare(a.valid_from || "") || (b.id || 0) - (a.id || 0));
  if (monthRows.length) return monthRows[0];

  const rows = logs
    .filter(r => r.category === category && (r.valid_from || r.adjusted_date || "") <= dateStr)
    .sort((a,b) => (b.valid_from || "").localeCompare(a.valid_from || "") || (b.id || 0) - (a.id || 0));
  return rows[0] || null;
}

function renderAiFeedbackStats(stats) {
  if (!stats) return "";
  const rows = (stats.intentStats || []).slice(0, 5);
  const total = rows.reduce((s, r) => s + Number(r.total || 0), 0);
  const positive = rows.reduce((s, r) => s + Number(r.positive || 0), 0);
  const negative = rows.reduce((s, r) => s + Number(r.negative || 0), 0);
  const pct = positive + negative ? Math.round(positive / (positive + negative) * 100) : null;
  return `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;margin:-6px 0 16px;box-shadow:0 1px 2px rgba(15,23,42,.04)">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px">
        <div>
          <div style="font-size:13px;font-weight:900;color:#172033">AI туслахын чанарын хяналт</div>
          <div style="font-size:11px;color:#64748b">Асуултын log болон ажилтны 👍/👎 үнэлгээний тойм</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <span class="pill ${pct === null || pct >= 80 ? 'ok' : pct >= 60 ? 'warn' : 'bad'}">👍 ${pct === null ? '—' : pct + '%'}</span>
          <span class="pill">Нийт ${total}</span>
          <span class="pill ${negative ? 'bad' : 'ok'}">👎 ${negative}</span>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px">
        ${rows.map(r => `
          <div style="background:#f8fafc;border-radius:9px;padding:8px 10px">
            <div style="font-size:11px;font-weight:800;color:#334155;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(r.intent || 'unknown')}</div>
            <div style="font-size:10px;color:#64748b;margin-top:3px">Нийт ${Number(r.total||0)} · 👍 ${Number(r.positive||0)} · 👎 ${Number(r.negative||0)}</div>
          </div>
        `).join("") || `<div style="font-size:12px;color:#64748b">Одоогоор үнэлгээний мэдээлэл алга.</div>`}
      </div>
    </div>`;
}

function renderDevRequestStats(rows) {
  if (!Array.isArray(rows) || !rows.length) return "";
  const open = rows.filter(r => !["Хаасан", "Цуцалсан"].includes(r.status || "")).slice(0, 5);
  const bugs = rows.filter(r => r.request_type === "bug" && !["Хаасан", "Цуцалсан"].includes(r.status || "")).length;
  const reports = rows.filter(r => r.request_type === "report" && !["Хаасан", "Цуцалсан"].includes(r.status || "")).length;
  const high = rows.filter(r => r.severity === "high" && !["Хаасан", "Цуцалсан"].includes(r.status || "")).length;
  return `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;margin:-6px 0 16px;box-shadow:0 1px 2px rgba(15,23,42,.04)">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px">
        <div>
          <div style="font-size:13px;font-weight:900;color:#172033">ERP хөгжүүлэлтийн санал/алдаа</div>
          <div style="font-size:11px;color:#64748b">Ажилчдын ERP туслахаар илгээсэн хүсэлтүүд</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <span class="pill ${high ? 'bad' : 'ok'}">Яаралтай ${high}</span>
          <span class="pill ${bugs ? 'bad' : 'ok'}">Алдаа ${bugs}</span>
          <span class="pill">Тайлан ${reports}</span>
        </div>
      </div>
      <div style="display:grid;gap:7px">
        ${open.map(r => `
          <div style="display:flex;align-items:center;gap:10px;background:#f8fafc;border-radius:9px;padding:8px 10px">
            <span class="pill ${r.severity === 'high' ? 'bad' : r.severity === 'medium' ? 'warn' : 'ok'}" style="font-size:10px">${escapeHtml(r.request_type || 'support')}</span>
            <div style="flex:1;min-width:0">
              <div style="font-size:12px;font-weight:800;color:#334155;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(r.title || r.description || '')}</div>
              <div style="font-size:10px;color:#64748b">${escapeHtml(r.module || 'unknown')} · ${escapeHtml(r.user_name || '')} · ${escapeHtml(r.created_at || '')}</div>
            </div>
          </div>
        `).join("")}
      </div>
    </div>`;
}

export async function dashboard() {
  const s = await api(`/api/reports/summary?year=${new Date().getFullYear()}`);
  let myTasks = [];
  try { myTasks = await api("/api/my-tasks"); } catch(e) {}
  let myRisks = [];
  try {
    const allRisks = await api('/api/safety-reports');
    myRisks = allRisks.filter(r =>
      r.assigned_to === state.me?.id &&
      (r.workflow_status || 'Шинэ') !== 'Хаасан'
    );
  } catch(e) {}
  let aiSummary = null;
  try { aiSummary = await api("/api/assistant/dashboard-summary"); } catch(e) {}
  let aiFeedbackStats = null;
  let devRequests = [];
  if (["director", "chief_engineer"].includes(state.me?.role)) {
    try { aiFeedbackStats = await api("/api/assistant/feedback-stats"); } catch(e) {}
    try { devRequests = await api("/api/assistant/dev-requests"); } catch(e) {}
  }
  const totalWork     = s.work.count || 0;
  let expiringDocs = [];
  try { expiringDocs = (await api("/api/documents/expiring?days=30")) || []; } catch(e) {}
  let upcomingReports = [];
  try { upcomingReports = (await api("/api/report-schedules/upcoming")) || []; } catch(e) {}
  let gerStats = { total_ger: 0, total_camhag: 0, total_broken: 0, sl_poles: 0, sl_heads: 0 };
  try { gerStats = await api("/api/sl-ger-stats"); } catch(e) {}
  let lightSchedules = [];
  try { lightSchedules = await api(`/api/light-schedules?year=${new Date().getFullYear()}`); } catch(e) {}
  const workCost      = Math.round(s.work.total_cost || 0);
  const financeCost   = Math.round(s.expenses.total || 0);
  const avgProgress   = Math.round(s.work.avg_progress || 0);
  const matWarnings   = (s.materials || []).filter(x => Number(x.balance) <= Number(x.warning_level || 10));

  // ── Today attendance ──
  const todayStr = today();
  const lightWarnings = lightScheduleWarnings(lightSchedules, todayStr);
  let todayAtt = { worked:0, absent:0, leave:0, sick:0, vacation:0, late:0, overtime:0 };
  let hrRows = [];
  try {
    hrRows = await api("/api/hr-records");
    const validIds = new Set(state.users.map(u => u.id));
    const latest = {};
    hrRows.forEach(r => {
      if (!r.start_date || !validIds.has(r.user_id)) return;
      const s = r.start_date.slice(0,10);
      const e = (r.end_date || r.start_date).slice(0,10);
      if (todayStr < s || todayStr > e) return;
      if (!latest[r.user_id] || r.id > latest[r.user_id].id) latest[r.user_id] = r;
    });
    Object.values(latest).forEach(r => {
      if (r.record_type === "Ажилласан")       todayAtt.worked++;
      if (r.record_type === "Ажил тасалсан")   todayAtt.absent++;
      if (r.record_type === "Чөлөө")           todayAtt.leave++;
      if (r.record_type === "Өвчтэй")          todayAtt.sick++;
      if (r.record_type === "Ээлжийн амралт")  todayAtt.vacation++;
      if (r.record_type === "Хоцорсон")        todayAtt.late++;
      if (r.record_type === "Илүү цаг")        todayAtt.overtime++;
    });
  } catch(e) {}

  const totalEmp    = state.users.length;
  const notRecorded = totalEmp - Object.values(todayAtt).reduce((a,b)=>a+b,0);
  const attPct      = totalEmp ? Math.round(todayAtt.worked / totalEmp * 100) : 0;

  // ── This month attendance trend (last 7 days) ──
  const year  = new Date().getFullYear();
  const month = new Date().getMonth() + 1;

  main.innerHTML = `
  <!-- ═══ HERO ═══ -->
  <div class="hero">
    <div style="display:flex;align-items:center;gap:16px;position:relative;z-index:1">
      <img src="/logo.jpg" class="heroLogo" onerror="this.style.display='none'">
      <div class="hero-text">
        <h1>Нэгдсэн хяналтын самбар</h1>
        <p class="sub">Дотоод ажил · Тайлан · Төлөвлөгөө</p>
      </div>
    </div>
    <div class="hero-right">
      <div class="hero-badge">Систем онлайн</div>
    </div>
  </div>

  <!-- ═══ WEATHER + CALENDAR BAR ═══ -->
  <div class="wc-bar">
    <div class="wc-section" id="wcWeather">
      <div class="wc-label">🌡️ ЦАГ АГААР · ЧОЙБАЛСАН, ДОРНОД</div>
      <div class="wc-main" style="color:var(--ink3)">Ачаалж байна...</div>
    </div>
    <div class="wc-divider"></div>
    <div class="wc-section" id="wcGreg"></div>
    <div class="wc-divider"></div>
    <div class="wc-section" id="wcOrg" style="cursor:default"></div>
  </div>

  <!-- ═══ STATS ROW ═══ -->
  <div class="stats-grid" style="grid-template-columns:repeat(6,1fr);margin-bottom:20px">
    <div class="stat-card blue">
      <div class="stat-top">
        <span class="stat-label">Нийт ажилтан</span>
        <div class="stat-icon">👥</div>
      </div>
      <div class="stat-value">${totalEmp}</div>
      <div class="stat-sub">Бүртгэлтэй ажилтан</div>
    </div>
    <div class="stat-card green">
      <div class="stat-top">
        <span class="stat-label">Өнөөдөр ирсэн</span>
        <div class="stat-icon">✅</div>
      </div>
      <div class="stat-value">${todayAtt.worked}</div>
      <div class="stat-sub">${attPct}% ирц</div>
    </div>
    <div class="stat-card red">
      <div class="stat-top">
        <span class="stat-label">Ирээгүй</span>
        <div class="stat-icon">❌</div>
      </div>
      <div class="stat-value">${todayAtt.absent}</div>
      <div class="stat-sub">Тасалсан ажилтан</div>
    </div>
    <div class="stat-card amber">
      <div class="stat-top">
        <span class="stat-label">Нийт ажил</span>
        <div class="stat-icon">🛠</div>
      </div>
      <div class="stat-value">${totalWork}</div>
      <div class="stat-sub">${new Date().getFullYear()} оны бүртгэл</div>
    </div>
    <div class="stat-card purple">
      <div class="stat-top">
        <span class="stat-label">Ажлын дундаж явц</span>
        <div class="stat-icon">📈</div>
      </div>
      <div class="stat-value">${avgProgress}%</div>
      <div class="stat-sub">
        <div class="progress-bar" style="margin-top:4px">
          <div class="progress-fill ${avgProgress>=70?'green':avgProgress>=40?'amber':'red'}"
               style="width:${avgProgress}%"></div>
        </div>
      </div>
    </div>
    <div class="stat-card ${(matWarnings.length||expiringDocs.length||upcomingReports.length)?'red':'green'}">
      <div class="stat-top">
        <span class="stat-label">Анхааруулга</span>
        <div class="stat-icon">${(matWarnings.length||expiringDocs.length)?'⚠️':'✅'}</div>
      </div>
      <div class="stat-value">${matWarnings.length + expiringDocs.length + upcomingReports.length}</div>
      <div class="stat-sub">${[matWarnings.length?'Материал':'', expiringDocs.length?'Баримт':'', upcomingReports.length?'Тайлан':''].filter(Boolean).join(' · ')||'Хэвийн байдалтай'}</div>
    </div>
  </div>

  <!-- ═══ AI ДҮГНЭЛТ ═══ -->
  ${(() => {
    if (!aiSummary) return '';
    const badge = (icon, label, val, isAlert) => {
      const danger = isAlert && typeof val === 'number' && val > 0;
      const bg = danger ? 'rgba(239,68,68,.18)' : 'rgba(255,255,255,.08)';
      const nc = danger ? '#fca5a5' : '#94a3b8';
      const vc = danger ? '#f87171' : '#f8fafc';
      return `<div style="background:${bg};border-radius:10px;padding:7px 11px;text-align:center;min-width:74px;cursor:default">
        <div style="font-size:15px">${icon}</div>
        <div style="font-size:16px;font-weight:800;color:${vc};line-height:1.2">${val ?? '—'}</div>
        <div style="font-size:9px;color:${nc};margin-top:2px;white-space:nowrap">${label}</div>
      </div>`;
    };
    const chips = ['Өнөөдрийн тойм','Нээлттэй гэмтэл хэдэн байна?','Агуулахын нөөц байна уу?','Өнөөдөр хэн ирсэн?'];
    return `
    <div style="background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%);border-radius:14px;padding:14px 18px;margin-bottom:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:12px">
        <div>
          <div style="font-size:13px;font-weight:800;color:#fff">💬 AI Өдрийн тойм &nbsp;<span style="font-weight:400;font-size:11px;color:#64748b">· ${aiSummary.today}</span></div>
          <div style="font-size:11px;color:#475569;margin-top:2px">Системийн өнөөдрийн байдал — асуулт дарж илгээх</div>
        </div>
        <button onclick="toggleErpAssistant(true)" style="border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.1);color:#e2e8f0;border-radius:8px;padding:5px 14px;cursor:pointer;font-size:11px;font-weight:700">ERP туслахтай ярих →</button>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">
        ${badge('⚡','Гэрлэн гэмтэл', aiSummary.open_light_faults, true)}
        ${badge('🔧','Толгой гэмтэл', aiSummary.broken_heads, true)}
        ${badge('🛠','Нээлттэй ажил', aiSummary.open_work, true)}
        ${badge('🚦','Дохионы гэмтэл', aiSummary.traffic_issues, true)}
        ${badge('✅','Өнөөдөр ирсэн', aiSummary.present_today, false)}
        ${badge('📦','Нөөц анхааруулга', aiSummary.low_stock_items, true)}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        ${chips.map(q=>`<button onclick="toggleErpAssistant(true);askErpAssistant('${q.replace(/'/g,"\\'")}');" style="border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.07);color:#cbd5e1;border-radius:20px;padding:4px 12px;font-size:11px;cursor:pointer;transition:background .12s" onmouseover="this.style.background='rgba(255,255,255,.14)'" onmouseout="this.style.background='rgba(255,255,255,.07)'">${q}</button>`).join('')}
      </div>
    </div>`;
  })()}

  ${renderAiFeedbackStats(aiFeedbackStats)}
  ${renderDevRequestStats(devRequests)}

  <!-- ═══ MAIN CONTENT GRID ═══ -->
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:16px">

    <!-- Өнөөдрийн ирц -->
    <div class="panel">
      <div class="panel-head">
        <div>
          <h3>⏱ Өнөөдрийн ирц</h3>
          <div class="subtitle">${todayStr}</div>
        </div>
        <button class="btn sm secondary" onclick="show('attendance')">Бүртгэх →</button>
      </div>
      <div class="panel-body">
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px">
          ${[
            ['🟡','Чөлөөтэй', todayAtt.leave,    'amber'],
            ['🔵','Өвчтэй',   todayAtt.sick,     'blue'],
            ['⚫','Амралт',   todayAtt.vacation,  ''],
            ['🟠','Илүү цаг', todayAtt.overtime,  ''],
          ].map(([ic,lb,vl,cl])=>`
            <div style="display:flex;align-items:center;gap:8px;padding:8px;background:var(--bg);border-radius:8px">
              <span style="font-size:16px">${ic}</span>
              <div style="flex:1;min-width:0">
                <div style="font-size:11px;color:var(--ink3)">${lb}</div>
                <div style="font-size:18px;font-weight:800;color:var(--ink)">${vl}</div>
              </div>
            </div>`).join('')}
        </div>
        ${notRecorded>0?`<div class="alertItem warn" style="margin-top:10px;padding:8px 10px;font-size:12px">
          ⚠ ${notRecorded} ажилтны ирц бүртгэгдээгүй байна</div>`:''}
      </div>
    </div>

    <!-- Гэрэлтүүлгийн тойм -->
    <div class="panel">
      <div class="panel-head">
        <div>
          <h3>💡 Гэрэлтүүлгийн тойм</h3>
          <div class="subtitle">Нийт бүртгэлтэй гэрлүүд</div>
        </div>
        ${(() => {
          const slPct      = (gerStats.sl_heads||0)    > 0 ? (gerStats.sl_heads    - (gerStats.sl_broken||0))    / gerStats.sl_heads    * 100 : 100;
          const gerPct     = (gerStats.total_ger||0)   > 0 ? (gerStats.total_ger   - (gerStats.ger_broken||0))   / gerStats.total_ger   * 100 : 100;
          const camPct     = (gerStats.total_camhag||0)> 0 ? (gerStats.total_camhag- (gerStats.camhag_broken||0))/ gerStats.total_camhag* 100 : 100;
          const trafficPct = (gerStats.traffic_total||0)> 0 ? (gerStats.traffic_asaaltai||0) / gerStats.traffic_total * 100 : null;
          const parts      = [slPct, gerPct, camPct, ...(trafficPct !== null ? [trafficPct] : [])];
          const avg        = (parts.reduce((s,v)=>s+v,0) / parts.length).toFixed(1);
          const col        = avg >= 90 ? 'ok' : avg >= 70 ? 'warn' : 'bad';
          return `<span class="pill ${col}" style="font-size:11px;font-weight:800">⚡ ${avg}% асалттай</span>`;
        })()}
      </div>
      <div class="panel-body" style="padding-top:4px">
        <div style="border-bottom:1px solid #f1f5f9;padding:8px 0 10px">
          <div style="font-size:12px;font-weight:700;color:#344054;margin-bottom:8px">
            <span style="margin-right:6px">🛣️</span>Авто замын гэрэл
          </div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px">
            ${[
              [gerStats.sl_streets||0,  'Нийт гудамж',    '#f59e0b','#fffbeb'],
              [gerStats.sl_poles||0,    'Нийт шон',        '#2563eb','#eff6ff'],
              [gerStats.sl_heads||0,    'Нийт толгой',     '#0ea5e9','#f0f9ff'],
              [(gerStats.sl_heads||0) - (gerStats.sl_broken||0), 'Асаж байна', '#16a34a','#f0fdf4'],
              [gerStats.sl_needs_poles||0,'Нөхөх шон',    '#d97706','#fff7ed'],
              [(() => {
                const h = gerStats.sl_heads||0;
                const b = gerStats.sl_broken||0;
                const pct = h>0 ? ((h-b)/h*100).toFixed(1) : '100.0';
                return pct+'%';
              })(),                     'Асалтын хувь',    (() => {
                const h = gerStats.sl_heads||0, b = gerStats.sl_broken||0;
                const p = h>0 ? (h-b)/h*100 : 100;
                return p>=90?'#16a34a':p>=70?'#d97706':'#dc2626';
              })(),                                         (() => {
                const h = gerStats.sl_heads||0, b = gerStats.sl_broken||0;
                const p = h>0 ? (h-b)/h*100 : 100;
                return p>=90?'#f0fdf4':p>=70?'#fff7ed':'#fef2f2';
              })()],
              [gerStats.sl_broken||0,   'Гэмтэлтэй',      '#dc2626','#fef2f2'],
              [gerStats.sl_active||0,   'Идэвхтэй',        '#8b5cf6','#f5f3ff'],
            ].map(([val,label,color,bg])=>`
              <div style="background:${bg};border-radius:8px;padding:6px 8px;text-align:center">
                <div style="font-size:15px;font-weight:800;color:${color};line-height:1.2">${typeof val==='number'?val.toLocaleString():val}</div>
                <div style="font-size:9px;color:#64748b;margin-top:1px">${label}</div>
              </div>`).join('')}
          </div>
        </div>
        <div style="border-bottom:1px solid #f1f5f9;padding:8px 0 10px">
          <div style="font-size:12px;font-weight:700;color:#344054;margin-bottom:8px">
            <span style="margin-right:6px">🏘️</span>Гэр хорооллын гэрэл
          </div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px">
            ${[
              [gerStats.ger_locations||0,  'Байршил',         '#8b5cf6','#f5f3ff'],
              [gerStats.total_ger||0,      'Нийт шон',        '#2563eb','#eff6ff'],
              [(gerStats.total_ger||0) - (gerStats.ger_broken||0), 'Асаж байна', '#16a34a','#f0fdf4'],
              [(() => {
                const h = gerStats.total_ger||0;
                const b = gerStats.ger_broken||0;
                const pct = h>0 ? ((h-b)/h*100).toFixed(1) : '100.0';
                return pct+'%';
              })(),                        'Асалтын хувь',     (() => {
                const h = gerStats.total_ger||0, b = gerStats.ger_broken||0;
                const p = h>0 ? (h-b)/h*100 : 100;
                return p>=90?'#16a34a':p>=70?'#d97706':'#dc2626';
              })(),                                              (() => {
                const h = gerStats.total_ger||0, b = gerStats.ger_broken||0;
                const p = h>0 ? (h-b)/h*100 : 100;
                return p>=90?'#f0fdf4':p>=70?'#fff7ed':'#fef2f2';
              })()],
              [gerStats.ger_broken||0,     'Гэмтэлтэй',       '#dc2626','#fef2f2'],
            ].map(([val,label,color,bg])=>`
              <div style="background:${bg};border-radius:8px;padding:6px 8px;text-align:center">
                <div style="font-size:14px;font-weight:800;color:${color};line-height:1.2">${typeof val==='number'?val.toLocaleString():val}</div>
                <div style="font-size:9px;color:#64748b;margin-top:1px">${label}</div>
              </div>`).join('')}
          </div>
        </div>
        <div style="padding:8px 0 10px">
          <div style="font-size:12px;font-weight:700;color:#344054;margin-bottom:8px">
            <span style="margin-right:6px">🗼</span>Цамхаг / прожектор
          </div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px">
            ${[
              [gerStats.camhag_locations||0, 'Байршил',         '#0891b2','#ecfeff'],
              [gerStats.total_camhag||0,     'Нийт шон',        '#2563eb','#eff6ff'],
              [(gerStats.total_camhag||0) - (gerStats.camhag_broken||0), 'Асаж байна', '#16a34a','#f0fdf4'],
              [(() => {
                const h = gerStats.total_camhag||0;
                const b = gerStats.camhag_broken||0;
                const pct = h>0 ? ((h-b)/h*100).toFixed(1) : '100.0';
                return pct+'%';
              })(),                          'Асалтын хувь',     (() => {
                const h = gerStats.total_camhag||0, b = gerStats.camhag_broken||0;
                const p = h>0 ? (h-b)/h*100 : 100;
                return p>=90?'#16a34a':p>=70?'#d97706':'#dc2626';
              })(),                                               (() => {
                const h = gerStats.total_camhag||0, b = gerStats.camhag_broken||0;
                const p = h>0 ? (h-b)/h*100 : 100;
                return p>=90?'#f0fdf4':p>=70?'#fff7ed':'#fef2f2';
              })()],
              [gerStats.camhag_broken||0,    'Гэмтэлтэй',       '#dc2626','#fef2f2'],
            ].map(([val,label,color,bg])=>`
              <div style="background:${bg};border-radius:8px;padding:6px 8px;text-align:center">
                <div style="font-size:14px;font-weight:800;color:${color};line-height:1.2">${typeof val==='number'?val.toLocaleString():val}</div>
                <div style="font-size:9px;color:#64748b;margin-top:1px">${label}</div>
              </div>`).join('')}
          </div>
        </div>
        ${(gerStats.traffic_total||0) > 0 ? `
        <div style="border-top:1px solid #f1f5f9;padding:8px 0 10px;margin-top:4px">
          <div style="font-size:12px;font-weight:700;color:#344054;margin-bottom:8px">
            <span style="margin-right:6px">🚦</span>Гэрлэн дохио
          </div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px">
            ${[
              [gerStats.traffic_total||0,    'Нийт дохио',     '#10b981','#f0fdf4'],
              [gerStats.traffic_asaaltai||0, 'Асаж байна', '#16a34a','#dcfce7'],
              [(gerStats.traffic_total||0) - (gerStats.traffic_asaaltai||0), 'Гэмтэлтэй', '#dc2626','#fef2f2'],
              [(() => {
                const t = gerStats.traffic_total||0, a = gerStats.traffic_asaaltai||0;
                const pct = t>0 ? (a/t*100).toFixed(1) : '0.0';
                return pct+'%';
              })(),                          'Асалтын хувь',   (() => {
                const t = gerStats.traffic_total||0, a = gerStats.traffic_asaaltai||0;
                const p = t>0 ? a/t*100 : 0;
                return p>=90?'#16a34a':p>=70?'#d97706':'#dc2626';
              })(),                                              (() => {
                const t = gerStats.traffic_total||0, a = gerStats.traffic_asaaltai||0;
                const p = t>0 ? a/t*100 : 0;
                return p>=90?'#f0fdf4':p>=70?'#fff7ed':'#fef2f2';
              })()],
            ].map(([val,label,color,bg])=>`
              <div style="background:${bg};border-radius:8px;padding:6px 8px;text-align:center">
                <div style="font-size:15px;font-weight:800;color:${color};line-height:1.2">${typeof val==='number'?val.toLocaleString():val}</div>
                <div style="font-size:9px;color:#64748b;margin-top:1px">${label}</div>
              </div>`).join('')}
          </div>
        </div>` : ''}
        ${gerStats.total_broken > 0 ? `
        <div class="alertItem bad" style="padding:8px 10px;font-size:12px;margin-top:8px">
          <span>⚠️</span>
          <div><b>${gerStats.total_broken}</b> толгой гэмтэлтэй байна —
            <a href="#" onclick="show('assets')" style="font-size:11px">Дэлгэрэнгүй →</a>
          </div>
        </div>` : `
        <div class="alertItem good" style="padding:8px 10px;font-size:12px;margin-top:8px">
          <span>✅</span><span>Бүх гэрэл хэвийн ажиллаж байна</span>
        </div>`}
      </div>
    </div>

    <!-- Warning Center -->
    <div class="panel">
      <div class="panel-head">
        <div>
          <h3>⚠️ Warning Center</h3>
          <div class="subtitle">Анхааруулга, мэдэгдэл</div>
        </div>
        ${(matWarnings.length||expiringDocs.length||upcomingReports.length||lightWarnings.length)
          ? `<span class="pill bad">${matWarnings.length+expiringDocs.length+upcomingReports.length+lightWarnings.length} анхааруулга</span>`
          : `<span class="pill ok">Хэвийн</span>`}
      </div>
      <div class="panel-body" style="padding-top:12px">
        ${lightWarnings.length ? lightWarnings.map(w => `
          <div class="alertItem bad" style="padding:9px 12px;font-size:12px;margin-bottom:6px;cursor:pointer" onclick="show('sl_light_sched')">
            <span>💡</span>
            <div><b>${escapeHtml(w.category)}</b> — ${escapeHtml(w.text)}<br>
              <span style="color:var(--ink3)">Асах: ${escapeHtml(w.onTime)} · Асаах тохиромжтой: ${escapeHtml(w.suitableOn)} · зөвшөөрөх зөрүү ±10мин</span>
            </div>
          </div>`).join('') : ''}
        ${expiringDocs.length ? expiringDocs.map(d => {
            const dl = Number(d.days_left);
            const cls = dl <= 7 ? 'bad' : 'warn';
            const label = dl <= 0 ? 'Хугацаа дууссан!' : `${dl} хоног үлдсэн`;
            return `<div class="alertItem ${cls}" style="padding:9px 12px;font-size:12px">
              <span>📄</span>
              <div><b>${d.title}</b> — ${d.doc_type}<br>
                <span style="color:var(--ink3)">${label} · ${d.valid_until}</span>
              </div>
            </div>`;
          }).join('') : ''}
        ${matWarnings.length
          ? matWarnings.map(x=>`
            <div class="alertItem bad" style="padding:9px 12px;font-size:12px${expiringDocs.length?';margin-top:6px':''}">
              <span>⚠️</span>
              <div><b>${x.item_name}</b> — үлдэгдэл бага: <b>${x.balance}</b></div>
            </div>`).join('')
          : !expiringDocs.length
            ? `<div class="alertItem good" style="padding:9px 12px;font-size:12px">
                <span>✅</span><span>Материалын ноцтой анхааруулга байхгүй</span></div>`
            : ''
        }
        ${upcomingReports.length ? upcomingReports.map(r => {
            const due  = new Date(r.next_due);
            const diff = Math.ceil((due - new Date().setHours(0,0,0,0)) / 86400000);
            const cls  = diff <= 0 ? 'bad' : diff <= 3 ? 'bad' : 'warn';
            const lbl  = diff < 0 ? `${Math.abs(diff)} хоног хэтэрсэн!` : diff === 0 ? 'Өнөөдөр!' : `${diff} хоног үлдсэн`;
            return `<div class="alertItem ${cls}" style="padding:9px 12px;font-size:12px;margin-top:6px;cursor:pointer" onclick="show('reports')">
              <span>📋</span>
              <div><b>${r.name}</b> <span style="color:var(--ink3);font-size:10px">(${r.frequency})</span><br>
                <span style="color:var(--ink3)">${lbl} · ${r.next_due}${r.responsible?' · '+r.responsible:''}</span>
              </div>
            </div>`;
          }).join('') : ''}
        ${todayAtt.absent>0?`
          <div class="alertItem warn" style="padding:9px 12px;font-size:12px;margin-top:6px">
            <span>👤</span><span>Өнөөдөр <b>${todayAtt.absent}</b> ажилтан ирээгүй байна</span>
          </div>`:''}
      </div>
    </div>

  </div>

  <!-- ═══ SECOND ROW ═══ -->
  <div style="display:grid;grid-template-columns:1fr;gap:16px;margin-bottom:16px">

    <!-- Ажлын явц + зардал -->
    <div class="panel">
      <div class="panel-head">
        <div>
          <h3>📊 Санхүү & Ажлын дүн</h3>
          <div class="subtitle">${new Date().getFullYear()} оны нийт</div>
        </div>
        <button class="btn sm secondary" onclick="show('reports')">Дэлгэрэнгүй →</button>
      </div>
      <div class="panel-body">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px">
          <div style="background:var(--blue4);border-radius:10px;padding:14px;border:1px solid #bfdbfe">
            <div style="font-size:11px;color:var(--blue);margin-bottom:4px;font-weight:600">АЖЛЫН ЗАРДАЛ</div>
            <div style="font-size:22px;font-weight:800;color:var(--blue)">${workCost.toLocaleString()}₮</div>
          </div>
          <div style="background:var(--red2);border-radius:10px;padding:14px;border:1px solid #fecaca">
            <div style="font-size:11px;color:var(--red);margin-bottom:4px;font-weight:600">САНХҮҮГИЙН ЗАРДАЛ</div>
            <div style="font-size:22px;font-weight:800;color:var(--red)">${financeCost.toLocaleString()}₮</div>
          </div>
          <div style="background:var(--green4);border-radius:10px;padding:14px;border:1px solid #bbf7d0">
            <div style="font-size:11px;color:var(--green);margin-bottom:4px;font-weight:600">НИЙТ АЖИЛ</div>
            <div style="font-size:22px;font-weight:800;color:var(--green)">${totalWork}</div>
          </div>
        </div>
        <!-- Category breakdown -->
        <div style="font-size:12px;font-weight:700;color:var(--ink3);margin-bottom:8px;letter-spacing:.08em;text-transform:uppercase">Ажлын төрлөөр</div>
        ${s.byCategory.slice(0,5).map(x => {
          const maxCost = Math.max(...s.byCategory.map(c=>Number(c.cost||0)),1);
          const pct = Math.round(Number(x.cost||0)/maxCost*100);
          return `<div class="progress-wrap" style="margin-bottom:10px">
            <div class="progress-label">
              <span>${x.category||'Бусад'} <span style="color:var(--ink3)">(${x.count})</span></span>
              <span style="font-weight:700">${Math.round(x.cost||0).toLocaleString()}₮</span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" style="width:${pct}%"></div>
            </div>
          </div>`;
        }).join('') || '<div class="muted small">Өгөгдөл алга</div>'}
      </div>
    </div>

  </div>

  <!-- ═══ BOTTOM ROW ═══ -->
  <div style="display:grid;grid-template-columns:1fr;gap:16px">

    <!-- Recent work -->
    <div class="panel">
      <div class="panel-head">
        <div>
          <h3>🛠 Сүүлийн ажлууд</h3>
          <div class="subtitle">5 сүүлийн бүртгэл</div>
        </div>
        <button class="btn sm secondary" onclick="show('work')">Бүгдийг харах →</button>
      </div>
      <div class="table-wrap">
        ${table(
          ["Огноо","Ажил","Байршил","Төлөв"],
          (s.recentWork||s.byCategory.slice(0,5)).slice(0,5).map(r=>[
            r.work_date||'—',
            r.title||r.category||'—',
            r.location||'—',
            r.status
              ? `<span class="pill ${r.status==='Дууссан'?'ok':r.status==='Явагдаж байна'?'info':'warn'}">${r.status}</span>`
              : '—'
          ])
        )}
      </div>
    </div>

  </div>

  ${myTasks.length > 0 ? `
  <!-- ═══ МИНИЙ ДААЛГАВАР ═══ -->
  <div style="margin-top:20px">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
      <span style="font-size:15px;font-weight:800;color:#1e293b">👤 Миний даалгаврууд</span>
      <span style="background:#ede9fe;color:#4f46e5;font-size:11px;font-weight:700;padding:2px 10px;border-radius:20px">${myTasks.length} ажил</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">
      ${myTasks.map(t => {
        const pct  = Number(t.progress) || 0;
        const stC  = t.status === 'Дууссан' ? '#16a34a' : t.status === 'Явцтай' ? '#2563eb' : '#94a3b8';
        const stBg = t.status === 'Дууссан' ? '#f0fdf4' : t.status === 'Явцтай' ? '#eff6ff' : '#f8f9fb';
        return `
        <div style="background:#fff;border:1px solid #e2e6ed;border-radius:12px;padding:14px 16px;border-left:3px solid ${stC}">
          <div style="font-size:10px;color:#94a3b8;font-weight:600;margin-bottom:4px">${escapeHtml(t.category||'')} · ${escapeHtml(t.work_title||'')}</div>
          <div style="font-size:13px;font-weight:700;color:#1e293b;margin-bottom:8px">${escapeHtml(t.title)}</div>
          ${t.location ? `<div style="font-size:11px;color:#2563eb;margin-bottom:6px">📍 ${escapeHtml(t.location)}</div>` : ''}
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;background:${stBg};color:${stC}">${t.status}</span>
            <span style="font-size:12px;font-weight:700;color:${stC}">${pct}%</span>
          </div>
          <div style="height:5px;background:#f1f5f9;border-radius:3px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:${stC};border-radius:3px;transition:width .3s"></div>
          </div>
          ${t.end_date ? `<div style="font-size:10px;color:#94a3b8;margin-top:6px">⏰ Дуусах: ${t.end_date.slice(0,10)}</div>` : ''}
        </div>`;
      }).join('')}
    </div>
  </div>` : ''}

  ${myRisks.length > 0 ? `
  <!-- ═══ МИНИЙ ХАБЭА ЭРСДЭЛ ═══ -->
  <div style="margin-top:20px">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
      <span style="font-size:15px;font-weight:800;color:#1e293b">🦺 Миний ХАБЭА эрсдэл</span>
      <span style="background:#fee2e2;color:#dc2626;font-size:11px;font-weight:700;padding:2px 10px;border-radius:20px">${myRisks.length} нээлттэй</span>
      <button onclick="show('safety')" style="margin-left:auto;padding:5px 14px;border-radius:8px;font-size:12px;font-weight:700;background:#fff;border:1.5px solid #e2e6ed;color:#374151;cursor:pointer">ХАБЭА руу очих →</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px">
      ${myRisks.map(r => {
        const wf = r.workflow_status || 'Шинэ';
        const lvColors = {
          'Бага':      ['#dcfce7','#16a34a'],
          'Дунд':      ['#fef9c3','#ca8a04'],
          'Өндөр':     ['#ffedd5','#ea580c'],
          'Маш өндөр': ['#fee2e2','#dc2626'],
        };
        const wfColors = {
          'Шинэ':               ['#eff6ff','#2563eb'],
          'Танилцсан':          ['#f0fdf4','#16a34a'],
          'Арга хэмжээ өгсөн': ['#fefce8','#ca8a04'],
          'Хэрэгжиж байна':    ['#fff7ed','#ea580c'],
          'Хаасан':            ['#f1f5f9','#374151'],
        };
        const [lvBg, lvColor] = lvColors[r.risk_level] || ['#f1f5f9','#64748b'];
        const [wfBg, wfColor] = wfColors[wf] || ['#f1f5f9','#64748b'];
        const borderColor = r.risk_level === 'Маш өндөр' ? '#dc2626'
          : r.risk_level === 'Өндөр' ? '#ea580c'
          : r.risk_level === 'Дунд'  ? '#ca8a04' : '#16a34a';

        // Deadline countdown
        let cdHtml = '';
        if (r.deadline) {
          const now = new Date(); now.setHours(0,0,0,0);
          const dl = new Date(r.deadline);
          const days = Math.ceil((dl - now) / 86400000);
          if (days < 0) cdHtml = `<div style="font-size:11px;font-weight:700;color:#dc2626;background:#fee2e2;padding:3px 8px;border-radius:6px;display:inline-block">${Math.abs(days)} хоног хэтэрсэн ⚠️</div>`;
          else if (days === 0) cdHtml = `<div style="font-size:11px;font-weight:700;color:#ea580c;background:#ffedd5;padding:3px 8px;border-radius:6px;display:inline-block">Өнөөдөр дуусна 🔥</div>`;
          else if (days === 1) cdHtml = `<div style="font-size:11px;font-weight:700;color:#ea580c;background:#ffedd5;padding:3px 8px;border-radius:6px;display:inline-block">Маргааш дуусна ⏱</div>`;
          else if (days <= 3) cdHtml = `<div style="font-size:11px;font-weight:700;color:#ca8a04;background:#fefce8;padding:3px 8px;border-radius:6px;display:inline-block">${days} хоног үлдсэн</div>`;
          else cdHtml = `<div style="font-size:11px;color:#94a3b8">⏰ Дедлайн: ${r.deadline.slice(0,10)}</div>`;
        }

        return `
        <div style="background:#fff;border:1px solid #e2e6ed;border-radius:12px;padding:14px 16px;border-left:4px solid ${borderColor};cursor:pointer" onclick="show('safety')">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;gap:8px">
            <div style="min-width:0">
              <div style="font-size:13px;font-weight:700;color:#1e293b;line-height:1.3">${escapeHtml(r.location||'—')}</div>
              <div style="font-size:11px;color:#94a3b8;margin-top:2px">${escapeHtml(r.risk_type||'—')} · ${r.report_date ? r.report_date.slice(0,10) : '—'}</div>
            </div>
            <span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;background:${lvBg};color:${lvColor};white-space:nowrap;flex-shrink:0">${r.risk_level||'—'}</span>
          </div>
          ${r.risk_description ? `<div style="font-size:12px;color:#475569;margin-bottom:8px;line-height:1.4">${escapeHtml(r.risk_description).slice(0,90)}${(r.risk_description||'').length>90?'…':''}</div>` : ''}
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px">
            <span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;background:${wfBg};color:${wfColor}">${wf}</span>
            ${r.priority ? `<span style="font-size:10px;font-weight:700;color:#7c3aed;background:#f5f3ff;padding:2px 8px;border-radius:20px">🎯 ${escapeHtml(r.priority)}</span>` : ''}
          </div>
          ${cdHtml}
        </div>`;
      }).join('')}
    </div>
  </div>` : ''}

  `;

  // Clock + calendar bar
  if (state.clockTimer)   clearInterval(state.clockTimer);
  if (state.weatherTimer) clearInterval(state.weatherTimer);
  updateClock();
  updateWcBar();
  state.clockTimer = setInterval(() => { updateClock(); updateWcBar(); }, 1000);
  // Weather: fetch now, refresh every 15 min
  fetchWeather().then(renderWeather);
  state.weatherTimer = setInterval(() => fetchWeather().then(renderWeather), 15 * 60 * 1000);
  // Org info
  renderOrgInfo();
}

function updateClock() {
  const el = document.getElementById("liveClock");
  if (el) el.innerText = new Date().toLocaleString("mn-MN", {
    year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit'
  });
}

async function renderOrgInfo() {
  const el = document.getElementById('wcOrg');
  if (!el) return;
  let info = {};
  try { info = await api('/api/org-settings'); } catch(e) {}
  const canEdit = ["director","hr"].includes(state.me?.role);
  const notice = (info.notice || "").trim();
  el.innerHTML = `
    <div class="wc-label" style="display:flex;align-items:center;justify-content:space-between">
      <span>🏛 БАЙГУУЛЛЛАГЫН МЭДЭЭЛЭЛ</span>
      ${canEdit ? `<button onclick="openOrgEdit()" style="border:none;background:none;cursor:pointer;font-size:11px;color:#2563eb;padding:0;font-weight:600">— Засах</button>` : ""}
    </div>
    <div class="wc-main" style="font-size:14px">${info.org_name || "—"}</div>
    ${notice ? `
    <div style="overflow:hidden;white-space:nowrap;margin-top:3px">
      <span style="display:inline-block;animation:orgNoticeScroll 18s linear infinite;font-size:11px;color:#2563eb;font-weight:500">
        📢 ${notice}
      </span>
    </div>
    <style>
      @keyframes orgNoticeScroll {
        0%   { transform: translateX(100%); }
        100% { transform: translateX(-100%); }
      }
    </style>` : `
    <div class="wc-sub">
      ${info.director ? `👤 ${info.director}` : ""}
      ${info.director && info.phone ? " &nbsp;·&nbsp; " : ""}
      ${info.phone ? `📞 ${info.phone}` : ""}
      ${!info.director && !info.phone ? "Мэдээлэл бүртгэгдээгүй" : ""}
    </div>`}`;
}

function openOrgEdit() {
  api('/api/org-settings').then(info => {
    const existing = document.getElementById('orgEditModal');
    if (existing) existing.remove();
    document.body.insertAdjacentHTML('beforeend', `
    <div id="orgEditModal" style="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2000;display:flex;align-items:center;justify-content:center">
      <div style="background:#fff;border-radius:16px;padding:28px 32px;width:480px;box-shadow:0 20px 60px rgba(0,0,0,.25)">
        <div style="font-weight:800;font-size:16px;margin-bottom:20px">🏛 Байгуулллагын мэдээлэл засах</div>
        <div style="display:flex;flex-direction:column;gap:12px">
          <div>
            <div style="font-size:11px;font-weight:600;color:#64748b;margin-bottom:4px">БАЙГУУЛЛЛАГЫН НЭР</div>
            <input class="input" id="oe_name" value="${info.org_name||""}" placeholder="Чойбалсан хөгжил ОНӨҮГ">
          </div>
          <div>
            <div style="font-size:11px;font-weight:600;color:#64748b;margin-bottom:4px">ЗАХИРАЛ</div>
            <input class="input" id="oe_dir" value="${info.director||""}" placeholder="ОД. Батсүх">
          </div>
          <div>
            <div style="font-size:11px;font-weight:600;color:#64748b;margin-bottom:4px">ХАЯГ</div>
            <input class="input" id="oe_addr" value="${info.address||""}" placeholder="Чойбалсан хот, Дорнод аймаг">
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div>
              <div style="font-size:11px;font-weight:600;color:#64748b;margin-bottom:4px">УТАС</div>
              <input class="input" id="oe_phone" value="${info.phone||""}" placeholder="+976 ...">
            </div>
            <div>
              <div style="font-size:11px;font-weight:600;color:#64748b;margin-bottom:4px">И-МЭЙЛ</div>
              <input class="input" id="oe_email" value="${info.email||""}" placeholder="info@...">
            </div>
          </div>
          <div>
            <div style="font-size:11px;font-weight:600;color:#64748b;margin-bottom:4px">МУА РЕГИСТР</div>
            <input class="input" id="oe_reg" value="${info.register||""}" placeholder="1234567">
          </div>
          <div>
            <div style="font-size:11px;font-weight:600;color:#64748b;margin-bottom:4px">
              📢 МЭДЭГДЭЛ / ЗАРЛАЛ <span style="font-weight:400;color:#94a3b8">(dashboard дээр гүйнэ)</span>
            </div>
            <textarea class="input" id="oe_notice" rows="2" placeholder="Өнөөдөр салхи ихтэй өдөр байна, хурал 14:00-д болно...">${info.notice||""}</textarea>
            <div style="font-size:10px;color:#94a3b8;margin-top:3px">Хоосон үлдээвэл захирал, утас харагдана</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:20px;justify-content:flex-end">
          <button class="btn secondary" onclick="document.getElementById('orgEditModal').remove()">Болих</button>
          <button class="btn" onclick="saveOrgInfo()">Хадгалах</button>
        </div>
      </div>
    </div>`);
  });
}

async function saveOrgInfo() {
  const body = {
    org_name: document.getElementById('oe_name')?.value.trim(),
    director: document.getElementById('oe_dir')?.value.trim(),
    address:  document.getElementById('oe_addr')?.value.trim(),
    phone:    document.getElementById('oe_phone')?.value.trim(),
    email:    document.getElementById('oe_email')?.value.trim(),
    register: document.getElementById('oe_reg')?.value.trim(),
    notice:   document.getElementById('oe_notice')?.value.trim(),
  };
  try {
    await api('/api/org-settings', { method:'PUT', body: JSON.stringify(body) });
    document.getElementById('orgEditModal')?.remove();
    renderOrgInfo();
  } catch(e) {
    alert(e.message || 'Алдаа гарлаа');
  }
}

Object.assign(window, { dashboard, openOrgEdit, saveOrgInfo });
