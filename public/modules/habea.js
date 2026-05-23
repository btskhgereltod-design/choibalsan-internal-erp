import { state, api, toast, today, escapeHtml } from './common.js';

// ── Constants ─────────────────────────────────────────────────
const RISK_TYPES = ['Цахилгааны эрсдэл','Өндрийн эрсдэл','Зам тээврийн эрсдэл','Гал түймрийн эрсдэл','Химийн эрсдэл','Механик эрсдэл','Бусад'];
const RISK_LEVELS = ['Бага','Дунд','Өндөр','Маш өндөр'];
const APPROVAL_STATUSES = ['Нээлттэй','Хаагдсан'];
const WORKFLOW_STATUSES = ['Шинэ','Танилцсан','Арга хэмжээ өгсөн','Хэрэгжиж байна','Хаасан'];
const PPE_ITEMS = ['Каск','Бээлий','Хантааз','Хүчдэл шалгагч','Конус','Өндрийн бүс','Аюулгүйн шил','Хамгаалалтын гутал'];
const PROB_LABELS = ['','1 — Маш бага','2 — Бага','3 — Дунд','4 — Өндөр','5 — Маш өндөр'];
const CONS_LABELS = ['','1 — Мэдэгдэхгүй','2 — Бага гэмтэл','3 — Дунд гэмтэл','4 — Ноцтой','5 — Үхэлд хүргэх'];
const VEHICLE_TYPES = ['Автокран','Өргөгч','Суудлын автомашин','Ачааны автомашин','Минибус','Бусад'];
const VEHICLE_STATUSES = ['Ажилд','Засварт','Их засвартай','Үзлэг хийгдэх шаардлагатай'];
const REPAIR_TYPES = ['Урсгал засвар','Их засвар','Урьдчилсан засвар'];
const DAILY_ITEMS = ['Кабин','Шил арчигч','Галын хор','Эмийн сан','Явах эд анги','Дугуй','Гэрэл','Дохио','Моторын тос','Аккумулятор','Гар тоормос','Түлшний түвшин','Ослын тэмдэг','Конус','Бичиг баримт'];
const MONTHLY_ITEMS = ['Ремень','Агаар шүүгч','Тоормосны хоолой','Түлшний хоолой','Амортизатор','Чул','Аккумулятор','Нум','Тоормос','Рульны хоолой','Мэдрэгч','Гулсмал'];

// ── State ─────────────────────────────────────────────────────
let _tab = 'dash';
let _risks = [], _vehicles = [], _daily = [], _weekly = [], _monthly = [], _repairs = [], _vehDash = {};
let _canEdit = false;
let _users = [];
let _editId = null;
let _dailyStates = {}; // {i: {status, comment}}
let _monthlyStates = {};
let _vehFilter = '';

// ── Helpers ───────────────────────────────────────────────────
const fmtN = n => Number(n||0).toLocaleString('mn-MN');
const fmtDate = s => s ? String(s).slice(0,10) : '—';
const parsePpe = raw => { try { return JSON.parse(raw||'[]'); } catch { return []; } };
const parseParts = raw => { try { return JSON.parse(raw||'[]'); } catch { return []; } };

const riskLevelStyle = l => ({
  'Бага':      ['#dcfce7','#16a34a'],
  'Дунд':      ['#fef9c3','#ca8a04'],
  'Өндөр':     ['#ffedd5','#ea580c'],
  'Маш өндөр': ['#fee2e2','#dc2626'],
}[l] || ['#f1f5f9','#64748b']);

const workflowStyle = s => ({
  'Шинэ':                ['#eff6ff','#2563eb'],
  'Танилцсан':           ['#f0fdf4','#16a34a'],
  'Арга хэмжээ өгсөн':  ['#fefce8','#ca8a04'],
  'Хэрэгжиж байна':     ['#fff7ed','#ea580c'],
  'Хаасан':             ['#f1f5f9','#374151'],
}[s] || ['#f1f5f9','#64748b']);

const statusStyle = s => ({
  'Нээлттэй': ['#eff6ff','#2563eb'],
  'Хаагдсан': ['#f1f5f9','#374151'],
}[s] || ['#f1f5f9','#64748b']);

function riskScoreLevel(score) {
  if (score <= 4)  return 'Бага';
  if (score <= 12) return 'Дунд';
  if (score <= 19) return 'Өндөр';
  return 'Маш өндөр';
}

function riskScoreBadge(score) {
  const level = riskScoreLevel(score);
  const [bg, color] = riskLevelStyle(level);
  return `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:800;background:${bg};color:${color}">
    ${score} · ${level}
  </span>`;
}

const PRIORITY_LEVELS = ['Бага','Дунд','Өндөр','Маш өндөр'];
const DEADLINE_DAYS = { 'Маш өндөр': 1, 'Өндөр': 3, 'Дунд': 7, 'Бага': 14 };

function deadlineCountdown(deadline, wf) {
  if (!deadline || wf === 'Хаасан') return null;
  const now = new Date(); now.setHours(0,0,0,0);
  const dl  = new Date(deadline);
  const diffMs   = dl - now;
  const diffDays = Math.ceil(diffMs / 86400000);
  if (diffMs < 0) {
    const d = Math.abs(Math.floor(diffMs / 86400000));
    return { overdue:true, label:`${d} хоног хэтэрсэн`, color:'#dc2626', bg:'#fee2e2' };
  }
  if (diffDays === 0) return { overdue:false, urgent:true, label:'Өнөөдөр дуусна', color:'#ea580c', bg:'#ffedd5' };
  if (diffDays === 1) return { overdue:false, urgent:true, label:'Маргааш дуусна', color:'#ea580c', bg:'#ffedd5' };
  if (diffDays <= 3)  return { overdue:false, label:`${diffDays} хоног үлдсэн`, color:'#ca8a04', bg:'#fefce8' };
  return { overdue:false, label:`${diffDays} хоног үлдсэн`, color:'#16a34a', bg:'#f0fdf4' };
}

function rowBg(r, isExp, i) {
  const wf = r.workflow_status || 'Шинэ';
  if (isExp) return '#eff6ff';
  if (wf === 'Хаасан') return i%2 ? '#f0fdf4' : '#dcfce7';
  const cd = deadlineCountdown(r.deadline, wf);
  if (cd?.overdue) return i%2 ? '#fff1f2' : '#fee2e2';
  if (cd?.urgent)  return i%2 ? '#fff7ed' : '#ffedd5';
  if (r.risk_level === 'Маш өндөр') return i%2 ? '#fff1f2' : '#fff';
  return i%2 ? '#fafafa' : '#fff';
}

function hseAutoDeadline() {
  const level = document.getElementById('sf_level')?.value;
  const deadlineEl = document.getElementById('sf_deadline');
  if (!deadlineEl || !level) return;
  const days = DEADLINE_DAYS[level];
  if (!days) return;
  const dl = new Date();
  dl.setDate(dl.getDate() + days);
  deadlineEl.value = dl.toISOString().slice(0,10);
  const hint = document.getElementById('sf_deadline_hint');
  const labels = { 'Маш өндөр':'24 цаг', 'Өндөр':'3 хоног', 'Дунд':'7 хоног', 'Бага':'14 хоног' };
  if (hint) hint.textContent = labels[level] + ' — автоматаар тохируулав';
}

function hseCalcScore() {
  const p = Number(document.getElementById('sf_prob')?.value) || 1;
  const c = Number(document.getElementById('sf_cons')?.value) || 1;
  const score = p * c;
  const level = riskScoreLevel(score);
  const [bg, color] = riskLevelStyle(level);
  const el = document.getElementById('sf_score_display');
  if (el) el.innerHTML = `<span style="font-size:20px;font-weight:900;color:${color}">${score}</span>
    <span style="font-size:11px;font-weight:700;padding:2px 10px;border-radius:20px;background:${bg};color:${color};margin-left:6px">${level}</span>`;
}

const vehStatusStyle = s => ({
  'Ажилд':                         ['#dcfce7','#16a34a'],
  'Засварт':                       ['#fef3c7','#d97706'],
  'Их засвартай':                  ['#fee2e2','#dc2626'],
  'Үзлэг хийгдэх шаардлагатай':   ['#f5f3ff','#7c3aed'],
}[s] || ['#f1f5f9','#64748b']);

function badge(text, styles) {
  const [bg,color] = styles;
  return `<span style="display:inline-block;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700;background:${bg};color:${color}">${escapeHtml(String(text||'—'))}</span>`;
}

function kpiCard(label, value, color, icon, sub) {
  return `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:16px 18px;box-shadow:0 2px 10px rgba(0,0,0,.05);position:relative;overflow:hidden">
    <div style="font-size:10px;font-weight:700;letter-spacing:.05em;color:#94a3b8;margin-bottom:6px;text-transform:uppercase">${label}</div>
    <div style="font-size:28px;font-weight:900;color:${color};line-height:1">${value}</div>
    ${sub ? `<div style="font-size:10px;color:#94a3b8;margin-top:4px">${sub}</div>` : ''}
    <div style="position:absolute;right:12px;top:10px;font-size:28px;opacity:.12">${icon}</div>
    <div style="position:absolute;bottom:0;left:0;right:0;height:3px;background:${color}"></div>
  </div>`;
}

function tabBtn(key, label, active) {
  return `<button id="hseTb_${key}" onclick="hseTab('${key}')"
    style="padding:11px 18px;border:none;cursor:pointer;font-size:13px;font-weight:700;background:transparent;
           color:${active?'#7c3aed':'#94a3b8'};
           border-bottom:${active?'3px solid #7c3aed':'3px solid transparent'};
           margin-bottom:-2px;transition:color .15s;white-space:nowrap;flex-shrink:0">${label}</button>`;
}

function userOpts(selectedId) {
  return `<option value="">— Сонгоно уу —</option>` +
    _users.filter(u => u.active !== 0)
      .map(u => `<option value="${u.id}" ${u.id == selectedId ? 'selected' : ''}>${escapeHtml(u.full_name)}</option>`)
      .join('');
}

function vehicleOpts(selectedId) {
  return `<option value="">— Техник сонгоно уу —</option>` +
    _vehicles.map(v => `<option value="${v.id}" ${v.id == selectedId ? 'selected' : ''}>${escapeHtml(v.plate_no)} · ${escapeHtml(v.vehicle_type)}</option>`).join('');
}

function inputRow(label, html) {
  return `<div><label style="display:block;font-size:12px;color:#667085;font-weight:600;margin-bottom:4px">${label}</label>${html}</div>`;
}

// ── Main Export ───────────────────────────────────────────────

export async function safety() {
  _canEdit = ['director','safety','chief_engineer'].includes(state.me.role);
  _users = state.users || [];
  renderShell();
  await hseTab(_tab);
}

function renderShell() {
  const tabs = [
    {key:'dash',    label:'🏠 Самбар'},
    {key:'risks',   label:'⚠️ Эрсдэл'},
    {key:'ptw',     label:'🛂 PTW'},
    {key:'vehicles',label:'🚗 Техник'},
    {key:'inspect', label:'✅ Үзлэг'},
    {key:'repairs', label:'🔧 Засвар'},
  ];
  document.getElementById('main').innerHTML = `
    <div style="background:#f5f3ff;min-height:100vh">

      <!-- ─── Hero Header ──────────────────────────────────────── -->
      <div style="background:linear-gradient(145deg,#3b0764,#5b21b6,#7c3aed);padding:20px 28px 26px">
        <div style="max-width:1400px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:14px">
            <div style="width:46px;height:46px;background:rgba(255,255,255,.15);border:2px solid rgba(255,255,255,.25);border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:23px;flex-shrink:0">🦺</div>
            <div>
              <div style="color:#c4b5fd;font-size:10px;font-weight:700;letter-spacing:.14em;margin-bottom:3px">ХАБЭА · ТЕХНИК ХЭРЭГСЛИЙН УДИРДЛАГА</div>
              <div style="color:#fff;font-size:18px;font-weight:900;line-height:1.2">HSE & Equipment Management</div>
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${_canEdit ? `<button onclick="hseOpenRisk()" style="padding:8px 16px;border-radius:9px;border:2px solid rgba(255,255,255,.28);background:rgba(255,255,255,.1);color:#fff;cursor:pointer;font-size:12px;font-weight:700" onmouseover="this.style.background='rgba(255,255,255,.2)'" onmouseout="this.style.background='rgba(255,255,255,.1)'">+ Эрсдэл</button>` : ''}
            ${_canEdit ? `<button onclick="hseOpenVeh()" style="padding:8px 16px;border-radius:9px;border:2px solid rgba(255,255,255,.28);background:rgba(255,255,255,.1);color:#fff;cursor:pointer;font-size:12px;font-weight:700" onmouseover="this.style.background='rgba(255,255,255,.2)'" onmouseout="this.style.background='rgba(255,255,255,.1)'">+ Техник</button>` : ''}
            <button onclick="hsePrint()" style="padding:8px 16px;border-radius:9px;border:2px solid rgba(255,255,255,.28);background:rgba(255,255,255,.1);color:#fff;cursor:pointer;font-size:12px;font-weight:700">🖨 PDF</button>
          </div>
        </div>
      </div>

      <!-- ─── Tab bar ──────────────────────────────────────────── -->
      <div style="background:#fff;border-bottom:2px solid #e2e8f0;position:sticky;top:0;z-index:10;box-shadow:0 1px 4px rgba(0,0,0,.06)">
        <div style="max-width:1400px;margin:0 auto;display:flex;padding:0 28px;overflow-x:auto">
          ${tabs.map(t => tabBtn(t.key, t.label, _tab === t.key)).join('')}
        </div>
      </div>

      <!-- ─── Content ──────────────────────────────────────────── -->
      <div style="max-width:1400px;margin:0 auto;padding:24px 28px">
        <div id="hseContent"></div>
      </div>
    </div>

    <div id="hseRiskModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:300;overflow-y:auto;padding:16px;-webkit-overflow-scrolling:touch">
      <div style="background:#fff;border-radius:16px;max-width:640px;margin:0 auto;padding:28px" onclick="event.stopPropagation()">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
          <h2 style="margin:0;font-size:16px;font-weight:800" id="hseRiskTitle">Эрсдэл бүртгэх</h2>
          <button onclick="hseCloseRisk()" style="background:none;border:none;font-size:22px;cursor:pointer;color:#94a3b8;line-height:1">✕</button>
        </div>
        <div id="hseRiskBody"></div>
      </div>
    </div>

    <div id="hseVehModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:300;overflow-y:auto;padding:16px">
      <div style="background:#fff;border-radius:16px;max-width:560px;margin:0 auto;padding:28px" onclick="event.stopPropagation()">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
          <h2 style="margin:0;font-size:16px;font-weight:800" id="hseVehTitle">Техник бүртгэх</h2>
          <button onclick="hseCloseVeh()" style="background:none;border:none;font-size:22px;cursor:pointer;color:#94a3b8;line-height:1">✕</button>
        </div>
        <div id="hseVehBody"></div>
      </div>
    </div>

    <div id="hseInspModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:300;overflow-y:auto;padding:16px">
      <div style="background:#fff;border-radius:16px;max-width:700px;margin:0 auto;padding:28px" onclick="event.stopPropagation()">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
          <h2 style="margin:0;font-size:16px;font-weight:800" id="hseInspTitle">Үзлэг бүртгэх</h2>
          <button onclick="hseCloseInsp()" style="background:none;border:none;font-size:22px;cursor:pointer;color:#94a3b8;line-height:1">✕</button>
        </div>
        <div id="hseInspBody"></div>
      </div>
    </div>

    <div id="hseRepairModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:300;overflow-y:auto;padding:16px">
      <div style="background:#fff;border-radius:16px;max-width:600px;margin:0 auto;padding:28px" onclick="event.stopPropagation()">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
          <h2 style="margin:0;font-size:16px;font-weight:800">Засвар бүртгэх</h2>
          <button onclick="hseCloseRepair()" style="background:none;border:none;font-size:22px;cursor:pointer;color:#94a3b8;line-height:1">✕</button>
        </div>
        <div id="hseRepairBody"></div>
      </div>
    </div>`;
}

// ── Tab Switch ────────────────────────────────────────────────

async function hseTab(tab) {
  _tab = tab;
  document.querySelectorAll('[id^="hseTb_"]').forEach(el => {
    const k = el.id.replace('hseTb_','');
    Object.assign(el.style, {
      background: k === tab ? '#2563eb' : '#fff',
      color:      k === tab ? '#fff'    : '#374151',
      borderColor:k === tab ? '#2563eb' : '#e2e6ed',
    });
  });
  const el = document.getElementById('hseContent');
  el.innerHTML = `<div style="text-align:center;padding:40px;color:#94a3b8;font-size:13px">Уншиж байна...</div>`;
  switch(tab) {
    case 'dash':    await renderDash(el);    break;
    case 'risks':   await renderRisks(el);   break;
    case 'ptw':     await renderPTW(el);     break;
    case 'vehicles':await renderVehicles(el);break;
    case 'inspect': await renderInspect(el); break;
    case 'repairs': await renderRepairs(el); break;
  }
}

// ── Dashboard Tab ─────────────────────────────────────────────

async function renderDash(el) {
  let dash = {};
  try {
    [_risks, _vehicles, dash] = await Promise.all([
      api('/api/safety-reports'), api('/api/vehicles'), api('/api/vehicle-dashboard')
    ]);
  } catch(e) { _risks = []; _vehicles = []; }
  _vehDash = dash;

  const todayStr  = today();
  const todayR    = _risks.filter(r => r.report_date === todayStr).length;
  const open      = _risks.filter(r => (r.workflow_status||'Шинэ') !== 'Хаасан').length;
  const closed    = _risks.filter(r => r.workflow_status === 'Хаасан').length;
  const critical  = _risks.filter(r => r.risk_level === 'Өндөр' || r.risk_level === 'Маш өндөр').length;
  const overdue   = _risks.filter(r => deadlineCountdown(r.deadline, r.workflow_status||'Шинэ')?.overdue).length;
  const urgent24  = _risks.filter(r => deadlineCountdown(r.deadline, r.workflow_status||'Шинэ')?.urgent).length;
  const unclosedHigh = _risks.filter(r => (r.risk_level==='Маш өндөр') && (r.workflow_status||'Шинэ')!=='Хаасан').length;
  const recent5   = _risks.slice(0, 5);
  const uninsp    = (dash.uninspected || []);

  // PPE compliance
  const withPpe = _risks.filter(r => { try { return JSON.parse(r.ppe_checklist||'[]').length > 0; } catch { return false; } }).length;
  const ppePct  = _risks.length ? Math.round(withPpe / _risks.length * 100) : 0;

  // Action implementation %
  const withAction = _risks.filter(r => r.action_plan || r.action_note).length;
  const actionPct  = open > 0 ? Math.round(withAction / _risks.length * 100) : 100;

  // Workflow counts
  const wfCounts = {};
  WORKFLOW_STATUSES.forEach(s => { wfCounts[s] = _risks.filter(r => (r.workflow_status||'Шинэ') === s).length; });

  // Deadline urgency list (overdue + urgent, sorted)
  const urgentRisks = _risks
    .filter(r => deadlineCountdown(r.deadline, r.workflow_status||'Шинэ'))
    .sort((a,b) => (a.deadline||'').localeCompare(b.deadline||''))
    .slice(0, 8);

  const secHead = (icon, iconBg, title, sub='') => `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
      <div style="width:30px;height:30px;background:${iconBg};border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0">${icon}</div>
      <div>
        <div style="font-size:13px;font-weight:800;color:#1e293b">${title}</div>
        ${sub ? `<div style="font-size:10px;color:#94a3b8;margin-top:1px">${sub}</div>` : ''}
      </div>
    </div>`;

  el.innerHTML = `
    ${secHead('⚠️','#dc2626','ХАБЭА — Эрсдэлийн үзүүлэлт')}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:24px">
      ${kpiCard('Нээлттэй эрсдэл', open, '#2563eb', '🔓', 'Хаагдаагүй')}
      ${kpiCard('Хаагдсан', closed, '#16a34a', '✅', 'Шийдвэрлэгдсэн')}
      ${kpiCard('Маш өндөр (нээлттэй)', unclosedHigh, '#991b1b', '🔴', 'Яаралтай шийдэх')}
      ${kpiCard('Хугацаа хэтэрсэн', overdue, '#dc2626', '⏰', 'Арга хэмжээ шаардлагатай')}
      ${kpiCard('24 цагт шийдэх', urgent24, '#ea580c', '🚨', 'Яаралтай')}
      ${kpiCard('PPE compliance', ppePct + '%', '#7c3aed', '🦺', `${withPpe}/${_risks.length}`)}
      ${kpiCard('Арга хэмжээ %', actionPct + '%', '#0891b2', '📌', `${withAction} эрсдэлд`)}
      ${kpiCard('Өнөөдрийн', todayR, '#d97706', '📅', todayStr)}
    </div>

    ${secHead('📊','#2563eb','Workflow явц')}
    <div style="display:flex;gap:0;margin-bottom:24px;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 2px 10px rgba(0,0,0,.05)">
      ${WORKFLOW_STATUSES.map((s, i) => {
        const [bg, color] = workflowStyle(s);
        const cnt = wfCounts[s] || 0;
        return `<div style="flex:1;padding:14px 8px;background:${bg};border-left:${i?'1px solid #e2e8f0':''};text-align:center">
          <div style="font-size:22px;font-weight:900;color:${color};line-height:1">${cnt}</div>
          <div style="font-size:10px;color:${color};font-weight:700;margin-top:4px">${s}</div>
        </div>`;
      }).join('')}
    </div>

    ${urgentRisks.length ? `
    ${secHead('🚨','#ea580c','Deadline удирдлага','Яаралтай болон хэтэрсэн')}
    <div style="background:#fff;border-radius:14px;box-shadow:0 2px 10px rgba(0,0,0,.05);border:1px solid #e2e8f0;margin-bottom:24px;overflow:hidden;overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0">
          <th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:700;color:#94a3b8;letter-spacing:.06em">БАЙРШИЛ</th>
          <th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:700;color:#94a3b8;letter-spacing:.06em">ТҮВШИН</th>
          <th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:700;color:#94a3b8;letter-spacing:.06em">WORKFLOW</th>
          <th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:700;color:#94a3b8;letter-spacing:.06em">ХАРИУЦСАН</th>
          <th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:700;color:#94a3b8;letter-spacing:.06em">ДЕДЛАЙН</th>
        </tr></thead>
        <tbody>
          ${urgentRisks.map((r,i) => {
            const cd = deadlineCountdown(r.deadline, r.workflow_status||'Шинэ');
            const [wfbg, wfcolor] = workflowStyle(r.workflow_status||'Шинэ');
            return `<tr style="border-bottom:1px solid #f1f5f9;${i%2?'background:#fafafa':''}">
              <td style="padding:9px 14px;font-weight:600;color:#1e293b">${escapeHtml(r.location||'—')}</td>
              <td style="padding:9px 14px">${badge(r.risk_level, riskLevelStyle(r.risk_level))}</td>
              <td style="padding:9px 14px"><span style="padding:2px 9px;border-radius:20px;font-size:11px;font-weight:700;background:${wfbg};color:${wfcolor}">${r.workflow_status||'Шинэ'}</span></td>
              <td style="padding:9px 14px;font-size:11px;color:#64748b">${escapeHtml(r.assigned_name||'—')}</td>
              <td style="padding:9px 14px">
                <div style="font-size:12px;color:#374151">${fmtDate(r.deadline)}</div>
                ${cd ? `<div style="font-size:11px;font-weight:700;color:${cd.color}">${cd.label}</div>` : ''}
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>` : ''}

    ${secHead('🚗','#374151','Техник хэрэгслийн үзүүлэлт')}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:24px">
      ${kpiCard('Нийт техник', dash.total||0, '#374151', '🚗', 'Бүртгэлтэй')}
      ${kpiCard('Ажилд', dash.active||0, '#16a34a', '✅', 'Идэвхтэй')}
      ${kpiCard('Засварт', dash.in_repair||0, '#d97706', '🔧', 'Одоогийн засвар')}
      ${kpiCard('Их засвартай', dash.big_repair||0, '#dc2626', '⚙️', 'Их засвар')}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div style="background:#fff;border-radius:14px;box-shadow:0 2px 10px rgba(0,0,0,.05);border:1px solid #e2e8f0;overflow:hidden">
        <div style="padding:13px 18px;border-bottom:2px solid #f1f5f9;display:flex;align-items:center;gap:8px;background:#fafafa">
          <div style="width:28px;height:28px;background:#ea580c;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:14px">📋</div>
          <div style="font-size:12px;font-weight:800;color:#1e293b">Сүүлийн эрсдэлүүд</div>
        </div>
        ${recent5.length ? recent5.map(r => {
          const [rlBg, rlColor] = riskLevelStyle(r.risk_level);
          return `<div style="padding:10px 18px;border-bottom:1px solid #f8fafc;display:flex;align-items:center;gap:8px;border-left:3px solid ${rlColor}">
            <div style="flex:1;min-width:0">
              <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#1e293b">${escapeHtml(r.location||'—')}</div>
              <div style="font-size:10px;color:#94a3b8;margin-top:1px">${escapeHtml(r.risk_type||'—')} · ${fmtDate(r.report_date)}</div>
            </div>
            <span style="padding:2px 10px;border-radius:20px;font-size:10px;font-weight:700;background:${rlBg};color:${rlColor};flex-shrink:0;white-space:nowrap">${r.risk_level}</span>
            ${_canEdit ? `
            <button onclick="hseOpenRisk(${r.id})" style="padding:3px 9px;border-radius:5px;font-size:11px;border:1px solid #e2e6ed;background:#fff;cursor:pointer;flex-shrink:0">✏</button>
            <button onclick="hseDelRisk(${r.id})" style="padding:3px 9px;border-radius:5px;font-size:11px;border:1px solid #fecaca;background:#fff;color:#dc2626;cursor:pointer;flex-shrink:0">🗑</button>` : ''}
          </div>`;
        }).join('') : '<div style="padding:28px;text-align:center;color:#94a3b8;font-size:12px">Бүртгэлтэй эрсдэл байхгүй</div>'}
      </div>
      <div style="background:#fff;border-radius:14px;box-shadow:0 2px 10px rgba(0,0,0,.05);border:1px solid #e2e8f0;overflow:hidden">
        <div style="padding:13px 18px;border-bottom:2px solid #f1f5f9;display:flex;align-items:center;gap:8px;background:#fafafa">
          <div style="width:28px;height:28px;background:#dc2626;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:14px">🚗</div>
          <div style="font-size:12px;font-weight:800;color:#1e293b">Өнөөдөр үзлэг хийгдээгүй техник</div>
        </div>
        ${uninsp.length ? uninsp.map(v => `
          <div style="padding:10px 18px;border-bottom:1px solid #f8fafc;display:flex;align-items:center;justify-content:space-between;gap:8px;border-left:3px solid #dc2626">
            <div>
              <div style="font-size:13px;font-weight:700;color:#dc2626">${escapeHtml(v.plate_no)}</div>
              <div style="font-size:10px;color:#94a3b8">${escapeHtml(v.vehicle_type)}</div>
            </div>
            <span style="font-size:10px;color:#dc2626;font-weight:700;padding:2px 10px;background:#fee2e2;border-radius:20px">Үзлэг дутуу</span>
          </div>`).join('') : '<div style="padding:28px;text-align:center;color:#16a34a;font-size:12px;font-weight:600">✓ Бүх техник үзлэгтэй</div>'}
      </div>
    </div>`;
}

// ── Risks Tab ─────────────────────────────────────────────────

async function renderRisks(el) {
  try { _risks = await api('/api/safety-reports'); } catch { _risks = []; }
  let _wfFilter = '';
  let _lvFilter = '';
  let _myOnly   = false;
  let _detailId = null;

  function detailRowHtml(r) {
    const wf = r.workflow_status || 'Шинэ';
    const wfIdx = WORKFLOW_STATUSES.indexOf(wf);
    const ppe = parsePpe(r.ppe_checklist);
    const score = Number(r.risk_score) || (Number(r.probability||1) * Number(r.consequence_score||1));
    const cd = deadlineCountdown(r.deadline, wf);

    const timelineSteps = [
      { s:'Шинэ',                icon:'📋', note: `${fmtDate(r.report_date)}${r.risk_time?' '+String(r.risk_time).slice(0,5):''}` },
      { s:'Танилцсан',           icon:'👁',  note: r.acknowledged_name ? `${r.acknowledged_name}${r.acknowledged_at?' · '+fmtDate(r.acknowledged_at):''}` : '' },
      { s:'Арга хэмжээ өгсөн',  icon:'📋',  note: r.action_note || '' },
      { s:'Хэрэгжиж байна',     icon:'▶',   note: r.action_plan || '' },
      { s:'Хаасан',             icon:'🏁',  note: wf==='Хаасан'?'Шийдвэрлэгдсэн':'' },
    ];

    return `<tr>
      <td colspan="${_canEdit?8:7}" style="padding:0;border-bottom:2px solid #e2e6ed;background:#f8fafc">
        <div style="padding:16px 20px;display:grid;grid-template-columns:1fr 1fr 300px;gap:20px;align-items:start">

          <!-- Left: Risk details -->
          <div>
            <div style="margin-bottom:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              ${score > 1 ? riskScoreBadge(score) : ''}
              ${r.priority ? `<span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;background:#f5f3ff;color:#7c3aed">🎯 ${escapeHtml(r.priority)}</span>` : ''}
              ${cd ? `<span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;background:${cd.bg};color:${cd.color}">⏱ ${cd.label}</span>` : ''}
            </div>
            ${r.risk_description ? `<div style="margin-bottom:8px"><div style="font-size:10px;color:#667085;font-weight:700;margin-bottom:2px">ТАЙЛБАР</div><div style="font-size:12px;color:#374151">${escapeHtml(r.risk_description)}</div></div>` : ''}
            ${r.risk_condition ? `<div style="margin-bottom:8px"><div style="font-size:10px;color:#667085;font-weight:700;margin-bottom:2px">ИЛЭРСЭН НӨХЦӨЛ</div><div style="font-size:12px;color:#374151">${escapeHtml(r.risk_condition)}</div></div>` : ''}
            ${r.possible_consequence ? `<div style="margin-bottom:8px;padding:8px;background:#fff5f5;border-radius:6px;border-left:3px solid #dc2626"><div style="font-size:10px;color:#dc2626;font-weight:700;margin-bottom:2px">⚠ БОЛЗОШГҮЙ ҮР ДАГАВАР</div><div style="font-size:12px;color:#dc2626">${escapeHtml(r.possible_consequence)}</div></div>` : ''}
            ${r.pre_work_note ? `<div style="margin-bottom:8px"><div style="font-size:10px;color:#667085;font-weight:700;margin-bottom:2px">🛡 АЮУЛГҮЙН ЗААВАР</div><div style="font-size:12px;color:#374151">${escapeHtml(r.pre_work_note)}</div></div>` : ''}
            ${r.action_plan ? `<div style="margin-bottom:8px;padding:8px;background:#eff6ff;border-radius:6px;border-left:3px solid #2563eb"><div style="font-size:10px;color:#2563eb;font-weight:700;margin-bottom:2px">📌 АРГА ХЭМЖЭЭНИЙ ТӨЛӨВЛӨГӨӨ</div><div style="font-size:12px;color:#1d4ed8">${escapeHtml(r.action_plan)}</div></div>` : ''}
            ${ppe.length ? `<div style="margin-bottom:8px"><div style="font-size:10px;color:#667085;font-weight:700;margin-bottom:4px">🦺 PPE</div><div>${ppe.map(p=>`<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;background:#dbeafe;color:#1d4ed8;font-weight:600;margin:1px">${escapeHtml(p)}</span>`).join('')}</div></div>` : ''}
            ${r.gps_lat && r.gps_lng ? `<div style="font-size:11px;color:#94a3b8;margin-top:4px">📍 GPS: ${Number(r.gps_lat).toFixed(4)}, ${Number(r.gps_lng).toFixed(4)}</div>` : ''}
            <!-- Before/After images -->
            ${(r.before_image_url||r.after_image_url) ? `
              <div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:8px">
                ${r.before_image_url ? `<div>
                  <div style="font-size:10px;color:#dc2626;font-weight:700;margin-bottom:3px">📷 ӨМНӨ</div>
                  <img src="${escapeHtml(r.before_image_url)}" style="width:100%;height:100px;object-fit:cover;border-radius:7px;cursor:pointer;border:2px solid #fecaca" onclick="hseViewImg('${escapeHtml(r.before_image_url)}')">
                </div>` : '<div></div>'}
                ${r.after_image_url ? `<div>
                  <div style="font-size:10px;color:#16a34a;font-weight:700;margin-bottom:3px">📷 ДАРАА</div>
                  <img src="${escapeHtml(r.after_image_url)}" style="width:100%;height:100px;object-fit:cover;border-radius:7px;cursor:pointer;border:2px solid #bbf7d0" onclick="hseViewImg('${escapeHtml(r.after_image_url)}')">
                </div>` : '<div></div>'}
              </div>` : ''}
            ${r.image_url && !r.before_image_url ? `<img src="${escapeHtml(r.image_url)}" style="width:100%;max-height:120px;object-fit:cover;border-radius:8px;cursor:pointer;margin-top:8px" onclick="hseViewImg('${escapeHtml(r.image_url)}')">` : ''}
          </div>

          <!-- Middle: Vertical Timeline -->
          <div>
            <div style="font-size:10px;color:#667085;font-weight:700;margin-bottom:10px">📊 WORKFLOW TIMELINE</div>
            <div>
              ${timelineSteps.map((step, si) => {
                const done = si <= wfIdx;
                const isCur = si === wfIdx;
                const [sbg, scolor] = workflowStyle(step.s);
                return `<div style="display:flex;gap:10px;align-items:flex-start">
                  <div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0">
                    <div style="width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;
                      background:${done?sbg:'#f1f5f9'};border:2px solid ${done?scolor:'#e2e6ed'};
                      color:${done?scolor:'#94a3b8'};font-weight:700">
                      ${done ? '✓' : String(si+1)}
                    </div>
                    ${si < timelineSteps.length-1 ? `<div style="width:2px;flex:1;min-height:20px;background:${done?scolor:'#e2e6ed'};margin:3px 0"></div>` : ''}
                  </div>
                  <div style="flex:1;padding-top:4px;padding-bottom:${si<timelineSteps.length-1?'12':'0'}px">
                    <div style="font-size:12px;font-weight:${isCur?'800':'600'};color:${done?'#111827':'#94a3b8'}">${step.s}</div>
                    ${step.note ? `<div style="font-size:11px;color:${done?'#475569':'#94a3b8'};margin-top:1px;line-height:1.4">${escapeHtml(step.note)}</div>` : ''}
                    ${isCur && _canEdit && wf !== 'Хаасан' ? `
                      <div style="margin-top:6px">
                        ${wf==='Шинэ' ? `<button onclick="hseRiskWorkflow(${r.id},'Танилцсан',event)" style="padding:5px 12px;border-radius:7px;font-size:11px;font-weight:700;border:1.5px solid #16a34a;background:#f0fdf4;color:#16a34a;cursor:pointer">👁 Танилцах →</button>` : ''}
                        ${wf==='Танилцсан' ? `<button onclick="hseRiskWorkflow(${r.id},'Арга хэмжээ өгсөн',event)" style="padding:5px 12px;border-radius:7px;font-size:11px;font-weight:700;border:1.5px solid #ca8a04;background:#fefce8;color:#ca8a04;cursor:pointer">📋 Арга хэмжээ →</button>` : ''}
                        ${wf==='Арга хэмжээ өгсөн' ? `<button onclick="hseRiskWorkflow(${r.id},'Хэрэгжиж байна',event)" style="padding:5px 12px;border-radius:7px;font-size:11px;font-weight:700;border:1.5px solid #ea580c;background:#fff7ed;color:#ea580c;cursor:pointer">▶ Хэрэгжүүлэх →</button>` : ''}
                        ${wf==='Хэрэгжиж байна' ? `<button onclick="hseRiskWorkflow(${r.id},'Хаасан',event)" style="padding:5px 12px;border-radius:7px;font-size:11px;font-weight:700;border:1.5px solid #374151;background:#f1f5f9;color:#374151;cursor:pointer">🏁 Хаах</button>` : ''}
                      </div>` : ''}
                  </div>
                </div>`;
              }).join('')}
            </div>
          </div>

          <!-- Right: Comments -->
          <div>
            <div style="font-size:10px;color:#667085;font-weight:700;margin-bottom:8px">💬 КОММЕНТУУД</div>
            <div id="hseComments_${r.id}" style="margin-bottom:8px;max-height:260px;overflow-y:auto"><div style="font-size:11px;color:#94a3b8">Уншиж байна...</div></div>
            <div style="display:flex;gap:6px">
              <input id="hseCommentInput_${r.id}" class="input" placeholder="Коммент бичих..." style="flex:1;font-size:12px;padding:6px 10px" onkeydown="if(event.key==='Enter')hseAddComment(${r.id})">
              <button onclick="hseAddComment(${r.id})" style="padding:6px 12px;border-radius:7px;font-size:12px;font-weight:700;background:#2563eb;color:#fff;border:none;cursor:pointer">→</button>
            </div>
          </div>

        </div>
      </td>
    </tr>`;
  }

  function renderRiskTable() {
    let shown = _risks;
    if (_myOnly) shown = shown.filter(r => r.assigned_to === state.me?.id);
    if (_wfFilter) shown = shown.filter(r => (r.workflow_status||'Шинэ') === _wfFilter);
    if (_lvFilter) shown = shown.filter(r => r.risk_level === _lvFilter);

    const myCount = _risks.filter(r => r.assigned_to === state.me?.id && (r.workflow_status||'Шинэ') !== 'Хаасан').length;

    el.innerHTML = `
      <div style="display:flex;gap:6px;margin-bottom:10px;align-items:center;flex-wrap:wrap">
        <div style="display:flex;border:1.5px solid #e2e6ed;border-radius:8px;overflow:hidden;flex-shrink:0">
          <button onclick="hseMyFilter(false)" style="padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer;border:none;
            background:${!_myOnly?'#2563eb':'#fff'};color:${!_myOnly?'#fff':'#374151'}">📋 Бүгд</button>
          <button onclick="hseMyFilter(true)" style="padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer;border:none;border-left:1.5px solid #e2e6ed;
            background:${_myOnly?'#dc2626':'#fff'};color:${_myOnly?'#fff':'#374151'}">🦺 Миний эрсдэл${myCount>0?' ('+myCount+')':''}</button>
        </div>
        ${_myOnly && myCount === 0 ? `<span style="font-size:12px;color:#16a34a;font-weight:600">✓ Таньд хариуцуулсан нээлттэй эрсдэл байхгүй байна</span>` : ''}
      </div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px;align-items:center">
        <span style="font-size:11px;color:#667085;font-weight:600;flex-shrink:0">Workflow:</span>
        ${['', ...WORKFLOW_STATUSES].map(v => {
          const active = _wfFilter === v;
          const [bg, color] = v ? workflowStyle(v) : ['#eff6ff','#2563eb'];
          return `<button onclick="hseRiskFilter('${v}','wf')" style="padding:4px 11px;border-radius:20px;font-size:11px;font-weight:600;cursor:pointer;border:1.5px solid ${active?color:'#e2e6ed'};background:${active?bg:'#fff'};color:${active?color:'#374151'}">${v||'Бүгд'}</button>`;
        }).join('')}
      </div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:12px;align-items:center">
        <span style="font-size:11px;color:#667085;font-weight:600;flex-shrink:0">Түвшин:</span>
        ${['', ...RISK_LEVELS].map(v => {
          const active = _lvFilter === v;
          const [bg, color] = v ? riskLevelStyle(v) : ['#eff6ff','#2563eb'];
          return `<button onclick="hseRiskFilter('${v}','level')" style="padding:4px 11px;border-radius:20px;font-size:11px;font-weight:600;cursor:pointer;border:1.5px solid ${active?color:'#e2e6ed'};background:${active?bg:'#fff'};color:${active?color:'#374151'}">${v||'Бүгд'}</button>`;
        }).join('')}
        <span style="margin-left:auto;font-size:12px;color:#94a3b8">${shown.length} бүртгэл</span>
      </div>
      <div class="panel" style="padding:0;overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:900px">
          <thead><tr style="background:#f8fafc;border-bottom:2px solid #e2e6ed">
            <th style="padding:10px 12px;text-align:left;font-size:11px;color:#667085;font-weight:700">№</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;color:#667085">БАЙРШИЛ / ОГНОО</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;color:#667085">ЭРСДЭЛ</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;color:#667085">ОНОО</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;color:#667085">WORKFLOW</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;color:#667085">ХАРИУЦСАН</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;color:#667085">ДЕДЛАЙН</th>
            ${_canEdit ? '<th style="padding:10px 12px"></th>' : ''}
          </tr></thead>
          <tbody>
            ${shown.length ? shown.map((r, i) => {
              const score = Number(r.risk_score) || (Number(r.probability||1) * Number(r.consequence_score||1));
              const wf = r.workflow_status || 'Шинэ';
              const [wfbg, wfcolor] = workflowStyle(wf);
              const cd = deadlineCountdown(r.deadline, wf);
              const isExp = _detailId === r.id;
              const bg = rowBg(r, isExp, i);
              const leftBorder = wf==='Хаасан' ? '4px solid #16a34a'
                : cd?.overdue ? '4px solid #dc2626'
                : cd?.urgent ? '4px solid #ea580c'
                : r.risk_level==='Маш өндөр' ? '4px solid #991b1b'
                : '4px solid transparent';
              return `<tr style="border-bottom:${isExp?'none':'1px solid #f1f5f9'};cursor:pointer;background:${bg};border-left:${leftBorder};transition:background .1s" onclick="hseToggleDetail(${r.id})">
                <td style="padding:10px 12px;color:#94a3b8;font-weight:500">${i+1}</td>
                <td style="padding:10px 12px">
                  <div style="font-weight:600;color:#111827">${escapeHtml(r.location||'—')}</div>
                  <div style="font-size:10px;color:#94a3b8">${fmtDate(r.report_date)}${r.risk_time?' · '+String(r.risk_time).slice(0,5):''}</div>
                </td>
                <td style="padding:10px 12px">
                  <div>${badge(r.risk_level, riskLevelStyle(r.risk_level))}</div>
                  <div style="font-size:10px;color:#94a3b8;margin-top:3px">${escapeHtml(r.risk_type||'—')}</div>
                </td>
                <td style="padding:10px 12px">${score>1 ? riskScoreBadge(score) : '—'}</td>
                <td style="padding:10px 12px"><span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;background:${wfbg};color:${wfcolor}">${wf}</span></td>
                <td style="padding:10px 12px;color:#475569;font-size:11px">${escapeHtml(r.assigned_name||'—')}</td>
                <td style="padding:10px 12px;white-space:nowrap">
                  ${r.deadline ? `<div style="font-size:12px;color:#374151">${fmtDate(r.deadline)}</div>
                    ${cd ? `<div style="font-size:10px;font-weight:700;color:${cd.color}">${cd.label}</div>` : ''}` : '<span style="color:#94a3b8">—</span>'}
                </td>
                ${_canEdit ? `<td style="padding:10px 12px;white-space:nowrap;text-align:right" onclick="event.stopPropagation()">
                  <button onclick="hseOpenRisk(${r.id})" style="padding:3px 10px;border-radius:5px;font-size:11px;border:1px solid #e2e6ed;background:#fff;cursor:pointer;margin-right:3px">✏</button>
                  <button onclick="hseDelRisk(${r.id})" style="padding:3px 10px;border-radius:5px;font-size:11px;border:1px solid #fecaca;background:#fff;color:#dc2626;cursor:pointer">🗑</button>
                </td>` : ''}
              </tr>
              ${isExp ? detailRowHtml(r) : ''}`;
            }).join('') : `<tr><td colspan="${_canEdit?8:7}" style="padding:32px;text-align:center;color:#94a3b8">Бүртгэлтэй эрсдэл байхгүй байна</td></tr>`}
          </tbody>
        </table>
      </div>`;

    window._hseRiskFilterFn = (v, type) => {
      if (type === 'wf') _wfFilter = v; else _lvFilter = v;
      renderRiskTable();
    };
    window.hseMyFilter = (val) => { _myOnly = val; _detailId = null; renderRiskTable(); };
    window.hseToggleDetail = (id) => {
      _detailId = (_detailId === id) ? null : id;
      renderRiskTable();
      if (_detailId) hseLoadComments(_detailId);
    };
    if (_detailId) hseLoadComments(_detailId);
  }

  renderRiskTable();
}

// ── PTW Tab ───────────────────────────────────────────────────

async function renderPTW(el) {
  try { _risks = await api('/api/safety-reports'); } catch { _risks = []; }
  const ptw = _risks.filter(r => r.risk_type !== 'Бусад' || true); // All are PTW candidates

  const statCounts = {};
  APPROVAL_STATUSES.forEach(s => { statCounts[s] = _risks.filter(r => r.status === s).length; });

  const ptwSteps = ['Хүлээгдэж байна','Батлагдсан','Хаагдсан'];

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px">
      ${APPROVAL_STATUSES.map(s => {
        const [bg,color] = statusStyle(s);
        return `<div style="background:${bg};border-radius:12px;padding:14px 16px;border:1px solid ${color}33">
          <div style="font-size:11px;color:${color};font-weight:700">${s}</div>
          <div style="font-size:28px;font-weight:900;color:${color}">${statCounts[s]||0}</div>
        </div>`;
      }).join('')}
    </div>

    <div style="margin-bottom:14px;font-size:13px;font-weight:700;color:#374151">🛂 Permit To Work — Зөвшөөрлийн бүртгэл</div>
    <div class="panel" style="padding:0;overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:780px">
        <thead><tr style="background:#f8fafc;border-bottom:2px solid #e2e6ed">
          <th style="padding:10px 12px;text-align:left;font-size:11px;color:#667085">№</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;color:#667085">БАЙРШИЛ / АЖИЛ</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;color:#667085">ХОЛБОСОН АЖИЛ</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;color:#667085">ЭРСДЭЛИЙН ТҮВШИН</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;color:#667085">ХАРИУЦСАН</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;color:#667085">WORKFLOW</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;color:#667085">ОГНОО</th>
          ${_canEdit ? '<th style="padding:10px 12px"></th>' : ''}
        </tr></thead>
        <tbody>
          ${_risks.length ? _risks.map((r, i) => `
            <tr style="border-bottom:1px solid #f1f5f9;${i%2?'background:#fafafa':''}${r.work_log_id?';border-left:3px solid #7c3aed':''}">
              <td style="padding:10px 12px;color:#94a3b8">${i+1}</td>
              <td style="padding:10px 12px">
                <div style="font-weight:600">${escapeHtml(r.location||'—')}</div>
                <div style="font-size:11px;color:#94a3b8">${escapeHtml(r.risk_type||'—')}</div>
              </td>
              <td style="padding:10px 12px">
                ${r.work_title
                  ? `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#7c3aed;background:#f5f3ff;padding:3px 8px;border-radius:10px;font-weight:600">🔗 ${escapeHtml(r.work_title)}</span>`
                  : '<span style="color:#94a3b8;font-size:11px">—</span>'}
              </td>
              <td style="padding:10px 12px">${badge(r.risk_level, riskLevelStyle(r.risk_level))}</td>
              <td style="padding:10px 12px;color:#475569;font-size:11px">${escapeHtml(r.assigned_name||'—')}</td>
              <td style="padding:10px 12px">
                <div style="display:flex;align-items:center;gap:0">
                  ${ptwSteps.map((s, si) => {
                    const done = s === 'Хүлээгдэж байна' ? true
                      : s === 'Батлагдсан' ? r.status === 'Батлагдсан' || r.status === 'Хаагдсан'
                      : r.status === 'Хаагдсан';
                    const [bg,color] = statusStyle(s);
                    return `<div style="display:flex;align-items:center">
                      <div style="width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;
                        background:${done?bg:'#f1f5f9'};border:2px solid ${done?color:'#e2e6ed'};color:${done?color:'#94a3b8'}">
                        ${done ? '✓' : (si+1)}
                      </div>
                      ${si < ptwSteps.length-1 ? `<div style="width:24px;height:2px;background:${done?color:'#e2e6ed'}"></div>` : ''}
                    </div>`;
                  }).join('')}
                </div>
                <div style="font-size:10px;color:#94a3b8;margin-top:2px">${badge(r.status, statusStyle(r.status))}</div>
              </td>
              <td style="padding:10px 12px;color:#94a3b8;white-space:nowrap">${fmtDate(r.report_date)}</td>
              ${_canEdit ? `<td style="padding:10px 12px;white-space:nowrap">
                ${r.status==='Хүлээгдэж байна' ? `<button onclick="hseRiskStatus(${r.id},'Батлагдсан')" style="padding:3px 10px;border-radius:5px;font-size:11px;font-weight:700;border:none;background:#dcfce7;color:#16a34a;cursor:pointer;margin-right:3px">Батлах</button>` : ''}
                ${r.status==='Батлагдсан' ? `<button onclick="hseRiskStatus(${r.id},'Хаагдсан')" style="padding:3px 10px;border-radius:5px;font-size:11px;font-weight:700;border:none;background:#f1f5f9;color:#374151;cursor:pointer;margin-right:3px">Хаах</button>` : ''}
                ${r.status!=='Цуцлагдсан'&&r.status!=='Хаагдсан' ? `<button onclick="hseRiskStatus(${r.id},'Цуцлагдсан')" style="padding:3px 10px;border-radius:5px;font-size:11px;font-weight:700;border:none;background:#fee2e2;color:#dc2626;cursor:pointer">Цуцлах</button>` : ''}
              </td>` : ''}
            </tr>`).join('')
          : `<tr><td colspan="${_canEdit?8:7}" style="padding:32px;text-align:center;color:#94a3b8">Бүртгэлтэй PTW байхгүй</td></tr>`}
        </tbody>
      </table>
    </div>`;
}

// ── Vehicles Tab ──────────────────────────────────────────────

async function renderVehicles(el) {
  try { _vehicles = await api('/api/vehicles'); } catch { _vehicles = []; }

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap">
      <input id="hseVehSearch" placeholder="🔍 Хайх (улсын дугаар, марк...)" class="input"
        style="max-width:280px;padding:7px 12px;font-size:13px" oninput="hseVehSearch(this.value)">
      <div style="margin-left:auto;font-size:12px;color:#94a3b8">${_vehicles.length} техник</div>
    </div>
    <div id="hseVehGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px">
      ${renderVehCards(_vehicles)}
    </div>`;
}

function renderVehCards(list) {
  if (!list.length) return `<div style="grid-column:1/-1;padding:40px;text-align:center;color:#94a3b8">Бүртгэлтэй техник байхгүй байна</div>`;
  return list.map(v => {
    const [sbg, scolor] = vehStatusStyle(v.status);
    const lastDaily = v.latest_daily_insp || v.last_daily_insp;
    const lastMonthly = v.latest_monthly_insp || v.last_monthly_insp;
    const inspectedToday = lastDaily === today();
    return `<div style="background:#fff;border:1px solid #e2e6ed;border-radius:14px;padding:18px;border-top:4px solid ${scolor};position:relative;overflow:hidden">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:10px">
        <div>
          <div style="font-size:18px;font-weight:900;color:#111827">${escapeHtml(v.plate_no)}</div>
          <div style="font-size:12px;color:#667085">${escapeHtml(v.vehicle_type)} ${v.brand ? '· '+escapeHtml(v.brand) : ''} ${v.model ? escapeHtml(v.model) : ''}</div>
        </div>
        ${badge(v.status, vehStatusStyle(v.status))}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11px;margin-bottom:12px">
        <div style="color:#94a3b8">Жолооч</div><div style="font-weight:600">${escapeHtml(v.driver_name||'—')}</div>
        <div style="color:#94a3b8">Сүүлийн өдөр тутмын</div>
        <div style="font-weight:600;color:#0f172a">${fmtDate(lastDaily)}</div>
        <div style="color:#94a3b8">Өнөөдрийн үзлэг</div>
        <div style="font-weight:700;color:${inspectedToday?'#16a34a':'#dc2626'}">${inspectedToday?'Хийгдсэн':'Хийгдээгүй ⚠️'}</div>
        <div style="color:#94a3b8">Сарын үзлэг</div><div style="font-weight:600">${fmtDate(lastMonthly)}</div>
        <div style="color:#94a3b8">Идэвхтэй засвар</div><div style="font-weight:600;color:${v.active_repairs>0?'#dc2626':'#16a34a'}">${v.active_repairs||0}</div>
      </div>
      ${v.note ? `<div style="font-size:11px;color:#94a3b8;background:#f8fafc;padding:6px 8px;border-radius:6px;margin-bottom:10px">${escapeHtml(v.note)}</div>` : ''}
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button onclick="hseOpenDailyInsp(${v.id})" style="flex:1;padding:6px;border-radius:7px;font-size:11px;font-weight:700;border:1.5px solid #16a34a;background:#f0fdf4;color:#16a34a;cursor:pointer">✅ Өдөр тутмын</button>
        <button onclick="hseOpenMonthlyInsp(${v.id})" style="flex:1;padding:6px;border-radius:7px;font-size:11px;font-weight:700;border:1.5px solid #2563eb;background:#eff6ff;color:#2563eb;cursor:pointer">📋 Сарын</button>
        <button onclick="hseOpenRepair(${v.id})" style="flex:1;padding:6px;border-radius:7px;font-size:11px;font-weight:700;border:1.5px solid #d97706;background:#fffbeb;color:#d97706;cursor:pointer">🔧 Засвар</button>
        ${_canEdit ? `<button onclick="hseEditVeh(${v.id})" style="padding:6px 10px;border-radius:7px;font-size:11px;border:1px solid #e2e6ed;background:#fff;cursor:pointer">✏</button>` : ''}
        ${state.me.role==='director' ? `<button onclick="hseDelVeh(${v.id})" style="padding:6px 10px;border-radius:7px;font-size:11px;border:1px solid #fecaca;background:#fff;color:#dc2626;cursor:pointer">🗑</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

function hseInspectionApprovalCell(type, r) {
  const role = state.me?.role;
  const canReviewDaily = ['director','chief_engineer','safety'].includes(role);
  const canApproveMonthly = ['director','chief_engineer'].includes(role);
  if (type === 'daily') {
    const status = r.review_status || 'ХАБЭА хүлээгдэж байна';
    const ok = status === 'Ажилд гарах зөвшөөрөлтэй';
    const bad = status === 'Зөвшөөрөл татгалзсан';
    return `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
      <span style="padding:2px 8px;border-radius:999px;font-weight:800;background:${ok?'#dcfce7':bad?'#fee2e2':'#fff7ed'};color:${ok?'#16a34a':bad?'#dc2626':'#d97706'}">${escapeHtml(status)}</span>
      ${status === 'ХАБЭА хүлээгдэж байна' && canReviewDaily ? `
        <button class="btn secondary sm" onclick="hseReviewDaily(${r.id},true)">Зөвшөөрөх</button>
        <button class="btn secondary sm" style="color:#dc2626" onclick="hseReviewDaily(${r.id},false)">Татгалзах</button>` : ''}
      ${r.reviewer_name ? `<span style="color:#94a3b8">${escapeHtml(r.reviewer_name)}</span>` : ''}
    </div>`;
  }
  if (type === 'monthly') {
    const status = r.approval_status || 'Ерөнхий инженер хүлээгдэж байна';
    const ok = status === 'Баталгаажсан';
    const bad = status === 'Буцаасан';
    return `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
      <span style="padding:2px 8px;border-radius:999px;font-weight:800;background:${ok?'#dcfce7':bad?'#fee2e2':'#eff6ff'};color:${ok?'#16a34a':bad?'#dc2626':'#2563eb'}">${escapeHtml(status)}</span>
      ${status === 'Ерөнхий инженер хүлээгдэж байна' && canApproveMonthly ? `
        <button class="btn secondary sm" onclick="hseApproveMonthly(${r.id},true)">Батлах</button>
        <button class="btn secondary sm" style="color:#dc2626" onclick="hseApproveMonthly(${r.id},false)">Буцаах</button>` : ''}
      ${r.approver_name ? `<span style="color:#94a3b8">${escapeHtml(r.approver_name)}</span>` : ''}
    </div>`;
  }
  return `<span style="padding:2px 8px;border-radius:999px;background:#dcfce7;color:#16a34a;font-weight:800">ХАБЭА хийсэн</span>`;
}

// ── Inspection Tab ────────────────────────────────────────────

async function renderInspect(el) {
  let subTab = 'daily';
  try {
    [_vehicles, _daily, _weekly, _monthly] = await Promise.all([
      api('/api/vehicles'),
      api('/api/vehicle-daily-inspections'),
      api('/api/vehicle-weekly-inspections'),
      api('/api/vehicle-monthly-inspections'),
    ]);
  } catch { _vehicles = []; _daily = []; _weekly = []; _monthly = []; }

  renderInspContent(el, subTab);

  function renderInspContent(el, st) {
    subTab = st;
    const list = st === 'daily' ? _daily : st === 'weekly' ? _weekly : _monthly;
    const pendingDaily = _daily.filter(r => (r.review_status || 'ХАБЭА хүлээгдэж байна') === 'ХАБЭА хүлээгдэж байна').length;
    const pendingMonthly = _monthly.filter(r => (r.approval_status || 'Ерөнхий инженер хүлээгдэж байна') === 'Ерөнхий инженер хүлээгдэж байна').length;
    el.innerHTML = `
      <div style="display:flex;gap:8px;margin-bottom:16px;align-items:center;flex-wrap:wrap">
        <button onclick="hseInspSub('daily')" style="padding:7px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;border:1.5px solid ${st==='daily'?'#16a34a':'#e2e6ed'};background:${st==='daily'?'#16a34a':'#fff'};color:${st==='daily'?'#fff':'#374151'}">✅ Өдөр тутмын ${pendingDaily?`· ${pendingDaily}`:''}</button>
        <button onclick="hseInspSub('weekly')" style="padding:7px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;border:1.5px solid ${st==='weekly'?'#7c3aed':'#e2e6ed'};background:${st==='weekly'?'#7c3aed':'#fff'};color:${st==='weekly'?'#fff':'#374151'}">🦺 7 хоногийн үзлэг</button>
        <button onclick="hseInspSub('monthly')" style="padding:7px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;border:1.5px solid ${st==='monthly'?'#2563eb':'#e2e6ed'};background:${st==='monthly'?'#2563eb':'#fff'};color:${st==='monthly'?'#fff':'#374151'}">📋 Сарын үзлэг ${pendingMonthly?`· ${pendingMonthly}`:''}</button>
        <button onclick="window._hseInspSub==='daily'?hseOpenDailyInsp():window._hseInspSub==='weekly'?hseOpenWeeklyInsp():hseOpenMonthlyInsp()" style="margin-left:auto;padding:7px 14px;border-radius:8px;font-size:12px;font-weight:700;background:#2563eb;color:#fff;border:none;cursor:pointer">+ Үзлэг нэмэх</button>
      </div>
      <div style="font-size:12px;color:#64748b;margin-bottom:10px">
        Өдөр тутмын: цахилгааны инженер чеклэнэ, ХАБЭА ажилтан ажилд гарах зөвшөөрөл өгнө. 7 хоногийн: ХАБЭА ажилтан. Сарын: ерөнхий инженер баталгаажуулна.
      </div>
      <div class="panel" style="padding:0;overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:780px">
          <thead><tr style="background:#f8fafc;border-bottom:2px solid #e2e6ed">
            <th style="padding:10px 12px;font-size:11px;color:#667085;font-weight:700;text-align:left">ТЕХНИК</th>
            <th style="padding:10px 12px;font-size:11px;color:#667085;text-align:left">${st==='daily'?'ОГНОО':st==='weekly'?'7 ХОНОГ':'САР'}</th>
            <th style="padding:10px 12px;font-size:11px;color:#667085;text-align:left">ШАЛГАСАН</th>
            <th style="padding:10px 12px;font-size:11px;color:#667085;text-align:left">ҮЗЛЭГИЙН ДҮН</th>
            <th style="padding:10px 12px;font-size:11px;color:#667085;text-align:left">ЗӨРЧЛИЙН ТОО</th>
            <th style="padding:10px 12px;font-size:11px;color:#667085;text-align:left">БАТАЛГАА</th>
            <th style="padding:10px 12px;font-size:11px;color:#667085;text-align:left">ТЭМДЭГЛЭЛ</th>
          </tr></thead>
          <tbody>
            ${list.length ? list.map((r, i) => {
              const items = parseParts(r.items_json);
              const issues = items.filter(it => it.status === 'Зөрчилтэй');
              return `<tr style="border-bottom:1px solid #f1f5f9;${i%2?'background:#fafafa':''}">
                <td style="padding:10px 12px">
                  <div style="font-weight:700">${escapeHtml(r.plate_no||'—')}</div>
                  <div style="font-size:10px;color:#94a3b8">${escapeHtml(r.vehicle_type||'')}</div>
                </td>
                <td style="padding:10px 12px;white-space:nowrap;color:#374151">
                  ${st==='daily' ? fmtDate(r.insp_date) : st==='weekly' ? fmtDate(r.week_start) : `${r.insp_year}-${String(r.insp_month).padStart(2,'0')}`}
                </td>
                <td style="padding:10px 12px;color:#475569;font-size:11px">
                  <div>${escapeHtml(r.inspector_name||r.hse_name||r.mechanic_name||'—')}</div>
                  ${st==='daily' ? `<div style="font-size:10px;color:#94a3b8">Жолооч: ${escapeHtml(r.driver_name||'—')}</div>` : ''}
                </td>
                <td style="padding:10px 12px">
                  ${r.overall_ok
                    ? `<span style="display:inline-block;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700;background:#dcfce7;color:#16a34a">✓ Хэвийн</span>`
                    : `<span style="display:inline-block;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700;background:#fee2e2;color:#dc2626">⚠ Зөрчилтэй</span>`}
                </td>
                <td style="padding:10px 12px;text-align:center;font-weight:700;color:${issues.length?'#dc2626':'#16a34a'}">${issues.length || '—'}</td>
                <td style="padding:10px 12px;font-size:11px">
                  ${hseInspectionApprovalCell(st, r)}
                </td>
                <td style="padding:10px 12px;font-size:11px;color:#94a3b8;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(r.note||'—')}</td>
              </tr>
              ${issues.length ? `<tr style="border-bottom:1px solid #f1f5f9">
                <td colspan="7" style="padding:6px 12px 10px 48px;background:#fff5f5">
                  <span style="font-size:10px;color:#dc2626;font-weight:700">⚠ Зөрчилтэй:</span>
                  ${issues.map(it => `<span style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:10px;background:#fee2e2;color:#dc2626;margin:1px">${escapeHtml(it.item)}${it.comment?': '+escapeHtml(it.comment):''}</span>`).join('')}
                </td>
              </tr>` : ''}`;
            }).join('')
            : `<tr><td colspan="7" style="padding:32px;text-align:center;color:#94a3b8">Бүртгэлтэй үзлэг байхгүй байна</td></tr>`}
          </tbody>
        </table>
      </div>`;
    window._hseInspSub = st;
    window.hseInspSub = (s) => renderInspContent(el, s);
  }
}

// ── Repairs Tab ───────────────────────────────────────────────

async function renderRepairs(el) {
  try { [_vehicles, _repairs] = await Promise.all([api('/api/vehicles'), api('/api/vehicle-repairs')]); }
  catch { _vehicles = []; _repairs = []; }

  const totCost = _repairs.reduce((s,r) => s + Number(r.cost||0), 0);
  const active  = _repairs.filter(r => r.repair_status !== 'Дууссан').length;

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px">
      ${kpiCard('Нийт засвар', _repairs.length, '#374151', '🔧', 'Бүртгэлтэй')}
      ${kpiCard('Хийгдэж байна', active, '#d97706', '⚙️', 'Одоогийн засвар')}
      ${kpiCard('Нийт зардал', fmtN(totCost)+'₮', '#dc2626', '💰', 'Засварын зардал')}
    </div>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
      <select id="hseRepVehFilter" class="input" style="max-width:220px;padding:7px 12px;font-size:13px" onchange="hseRepFilter()">
        <option value="">Бүх техник</option>
        ${_vehicles.map(v => `<option value="${v.id}">${escapeHtml(v.plate_no)} · ${escapeHtml(v.vehicle_type)}</option>`).join('')}
      </select>
      ${_canEdit ? `<button onclick="hseOpenRepair()" style="margin-left:auto;padding:7px 14px;border-radius:8px;font-size:12px;font-weight:700;background:#2563eb;color:#fff;border:none;cursor:pointer">+ Засвар нэмэх</button>` : ''}
    </div>
    <div class="panel" style="padding:0;overflow-x:auto" id="hseRepTable">
      ${repairTable(_repairs)}
    </div>`;
  window.hseRepFilter = () => {
    const vid = document.getElementById('hseRepVehFilter').value;
    const filtered = vid ? _repairs.filter(r => String(r.vehicle_id) === vid) : _repairs;
    document.getElementById('hseRepTable').innerHTML = repairTable(filtered);
  };
}

function repairTable(list) {
  return `<table style="width:100%;border-collapse:collapse;font-size:12px;min-width:700px">
    <thead><tr style="background:#f8fafc;border-bottom:2px solid #e2e6ed">
      <th style="padding:10px 12px;text-align:left;font-size:11px;color:#667085">ТЕХНИК</th>
      <th style="padding:10px 12px;text-align:left;font-size:11px;color:#667085">ОГНОО</th>
      <th style="padding:10px 12px;text-align:left;font-size:11px;color:#667085">ЗАСВАРЫН ТӨРӨЛ</th>
      <th style="padding:10px 12px;text-align:left;font-size:11px;color:#667085">АКТЫН №</th>
      <th style="padding:10px 12px;text-align:left;font-size:11px;color:#667085">ЗАСАРЛАГЧ</th>
      <th style="padding:10px 12px;text-align:left;font-size:11px;color:#667085">ЗАРДАЛ</th>
      <th style="padding:10px 12px;text-align:left;font-size:11px;color:#667085">СТАТУС</th>
      ${_canEdit ? '<th style="padding:10px 12px"></th>' : ''}
    </tr></thead>
    <tbody>
      ${list.length ? list.map((r, i) => {
        const parts = parseParts(r.parts_json);
        const [rbg,rcolor] = r.repair_status==='Дууссан' ? ['#dcfce7','#16a34a'] : ['#fef3c7','#d97706'];
        return `<tr style="border-bottom:1px solid #f1f5f9;${i%2?'background:#fafafa':''}">
          <td style="padding:10px 12px">
            <div style="font-weight:700">${escapeHtml(r.plate_no||'—')}</div>
            <div style="font-size:10px;color:#94a3b8">${escapeHtml(r.vehicle_type||'')}</div>
          </td>
          <td style="padding:10px 12px;white-space:nowrap;color:#374151">${fmtDate(r.repair_date)}</td>
          <td style="padding:10px 12px">
            <span style="display:inline-block;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700;
              background:${r.repair_type==='Их засвар'?'#fee2e2':'#f1f5f9'};
              color:${r.repair_type==='Их засвар'?'#dc2626':'#374151'}">${escapeHtml(r.repair_type)}</span>
          </td>
          <td style="padding:10px 12px;color:#475569;font-size:11px">${escapeHtml(r.act_no||'—')}</td>
          <td style="padding:10px 12px;color:#475569;font-size:11px">${escapeHtml(r.technician_name||'—')}</td>
          <td style="padding:10px 12px;font-weight:700;color:#374151">${r.cost ? fmtN(r.cost)+'₮' : '—'}</td>
          <td style="padding:10px 12px">
            <span style="display:inline-block;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700;background:${rbg};color:${rcolor}">${escapeHtml(r.repair_status||'—')}</span>
          </td>
          ${_canEdit ? `<td style="padding:10px 12px;white-space:nowrap">
            ${r.repair_status!=='Дууссан' ? `<button onclick="hseRepDone(${r.id},${r.vehicle_id})" style="padding:3px 10px;border-radius:5px;font-size:11px;font-weight:700;border:none;background:#dcfce7;color:#16a34a;cursor:pointer;margin-right:3px">✓ Дуусгах</button>` : ''}
            <button onclick="hseDelRepair(${r.id})" style="padding:3px 10px;border-radius:5px;font-size:11px;border:1px solid #fecaca;background:#fff;color:#dc2626;cursor:pointer">🗑</button>
          </td>` : ''}
        </tr>
        ${(r.description || parts.length) ? `<tr style="border-bottom:1px solid #f1f5f9">
          <td colspan="${_canEdit?8:7}" style="padding:6px 12px 10px 48px;background:#fafafa">
            ${r.description ? `<div style="font-size:11px;color:#374151;margin-bottom:4px">📝 ${escapeHtml(r.description)}</div>` : ''}
            ${parts.length ? `<div>${parts.map(p => `<span style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:10px;background:#ede9fe;color:#7c3aed;margin:1px">${escapeHtml(p.name||p)}</span>`).join('')}</div>` : ''}
          </td>
        </tr>` : ''}`;
      }).join('')
      : `<tr><td colspan="${_canEdit?8:7}" style="padding:32px;text-align:center;color:#94a3b8">Засварын бүртгэл байхгүй</td></tr>`}
    </tbody>
  </table>`;
}

// ── Risk Form ─────────────────────────────────────────────────

function hseOpenRisk(id) {
  _editId = id || null;
  const r = id ? _risks.find(x => x.id === id) : null;
  const ppeSelected = parsePpe(r?.ppe_checklist);
  document.getElementById('hseRiskTitle').textContent = r ? 'Эрсдэл засах' : 'Эрсдэл бүртгэх';
  document.getElementById('hseRiskBody').innerHTML = `
    <div style="display:grid;grid-template-columns:2fr 1fr;gap:12px;margin-bottom:12px">
      ${inputRow('Огноо *', `<input class="input" id="sf_date" type="date" value="${r?.report_date||today()}">`)}
      ${inputRow('Цаг', `<input class="input" id="sf_time" type="time" value="${r?.risk_time||''}">`)}
    </div>
    <div style="margin-bottom:12px">
      ${inputRow('Байршил *', `
        <div style="position:relative" id="sf_loc_wrap">
          <input class="input" id="sf_loc" value="${escapeHtml(r?.location||'')}"
            placeholder="Объект хайх эсвэл шууд бичих..."
            oninput="hseLocFilter()" onfocus="hseLocShow()" autocomplete="off"
            style="padding-right:32px">
          <input type="hidden" id="sf_loc_ref_type" value="${escapeHtml(r?.location_ref_type||'')}">
          <input type="hidden" id="sf_loc_ref_id"   value="${r?.location_ref_id||''}">
          <input type="hidden" id="sf_loc_assigned"  value="">
          <span style="position:absolute;right:10px;top:50%;transform:translateY(-50%);color:#94a3b8;pointer-events:none;font-size:14px">🔍</span>
          <div id="sf_loc_drop"
            style="display:none;position:absolute;top:calc(100% + 4px);left:0;right:0;background:#fff;border:1px solid #c4b5fd;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12);z-index:200;max-height:220px;overflow-y:auto"></div>
        </div>`)}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">
      ${inputRow('Эрсдэлийн төрөл', `<select class="input" id="sf_type">${RISK_TYPES.map(t=>`<option ${r?.risk_type===t?'selected':''}>${escapeHtml(t)}</option>`).join('')}</select>`)}
      ${inputRow('Эрсдэлийн түвшин', `<select class="input" id="sf_level" onchange="hseAutoDeadline();hseCalcScore()">${RISK_LEVELS.map(l=>`<option ${(r?.risk_level||'Бага')===l?'selected':''}>${escapeHtml(l)}</option>`).join('')}</select>`)}
      ${inputRow('Яаралтын зэрэг (Priority)', `<select class="input" id="sf_priority">${PRIORITY_LEVELS.map(p=>`<option ${(r?.priority||'Дунд')===p?'selected':''}>${escapeHtml(p)}</option>`).join('')}</select>`)}
    </div>

    <div style="padding:14px;background:#fafafa;border-radius:10px;border:1px solid #e2e6ed;margin-bottom:12px">
      <div style="font-size:12px;color:#667085;font-weight:700;margin-bottom:10px">🎯 Эрсдэлийн оноо тооцоолол (Магадлал × Үр дагавар)</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;align-items:end">
        <div>
          <label style="display:block;font-size:11px;color:#667085;font-weight:600;margin-bottom:4px">Магадлал (1–5)</label>
          <select class="input" id="sf_prob" onchange="hseCalcScore()">
            ${PROB_LABELS.slice(1).map((l,i)=>`<option value="${i+1}" ${(Number(r?.probability)||1)===(i+1)?'selected':''}>${l}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="display:block;font-size:11px;color:#667085;font-weight:600;margin-bottom:4px">Үр дагавар (1–5)</label>
          <select class="input" id="sf_cons" onchange="hseCalcScore()">
            ${CONS_LABELS.slice(1).map((l,i)=>`<option value="${i+1}" ${(Number(r?.consequence_score)||1)===(i+1)?'selected':''}>${l}</option>`).join('')}
          </select>
        </div>
        <div style="text-align:center;padding:8px;background:#fff;border-radius:8px;border:1px solid #e2e6ed;min-height:56px;display:flex;flex-direction:column;align-items:center;justify-content:center">
          <div style="font-size:10px;color:#667085;font-weight:600;margin-bottom:4px">ОНОО</div>
          <div id="sf_score_display" style="display:flex;align-items:center;justify-content:center"></div>
        </div>
      </div>
    </div>

    <div style="margin-bottom:12px">
      ${inputRow('Илэрсэн нөхцөл', `<textarea class="input" id="sf_condition" rows="2" style="resize:vertical" placeholder="Ямар нөхцөлд эрсдэл илэрсэн бэ?">${escapeHtml(r?.risk_condition||'')}</textarea>`)}
    </div>
    <div style="margin-bottom:12px">
      ${inputRow('Болзошгүй үр дагавар', `<textarea class="input" id="sf_consequence" rows="2" style="resize:vertical" placeholder="Эрсдэл үүсвэл ямар үр дагавар гарах вэ?">${escapeHtml(r?.possible_consequence||'')}</textarea>`)}
    </div>
    <div style="margin-bottom:12px">
      ${inputRow('Тайлбар', `<textarea class="input" id="sf_desc" rows="2" style="resize:vertical" placeholder="Эрсдэлийн нарийвчилсан тайлбар...">${escapeHtml(r?.risk_description||'')}</textarea>`)}
    </div>
    <div style="margin-bottom:12px">
      ${inputRow('Ажил эхлэхийн өмнөх заавар', `<textarea class="input" id="sf_prework" rows="2" style="resize:vertical" placeholder="Аюулгүй ажиллагааны заавар, зааварчилгаа...">${escapeHtml(r?.pre_work_note||'')}</textarea>`)}
    </div>
    <div style="margin-bottom:12px">
      ${inputRow('Арга хэмжээний төлөвлөгөө', `<textarea class="input" id="sf_actionplan" rows="3" style="resize:vertical" placeholder="Аюулыг арилгахад хэрэгжүүлэх арга хэмжээнүүд, хариуцагч, хугацаа...">${escapeHtml(r?.action_plan||'')}</textarea>`)}
    </div>

    <div style="padding:14px;background:#f8fafc;border-radius:10px;border:1px solid #e2e6ed;margin-bottom:12px">
      <div style="font-size:12px;color:#667085;font-weight:700;margin-bottom:10px">🦺 PPE хамгаалалтын хэрэгсэл</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:6px">
        ${PPE_ITEMS.map(item => {
          const checked = ppeSelected.includes(item);
          return `<label id="ppelbl_${item.replace(/[^a-zA-Z0-9]/g,'_')}" style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;padding:7px 10px;border-radius:8px;border:1.5px solid ${checked?'#2563eb':'#e2e6ed'};background:${checked?'#eff6ff':'#fff'};transition:all .15s">
            <input type="checkbox" name="ppe" value="${escapeHtml(item)}" ${checked?'checked':''} onchange="hsePpeToggle(this)">
            ${escapeHtml(item)}
          </label>`;
        }).join('')}
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
      ${inputRow('Хариуцсан ажилтан', `<select class="input" id="sf_assigned">${userOpts(r?.assigned_to)}</select>`)}
      <div>
        <label style="display:block;font-size:12px;color:#667085;font-weight:600;margin-bottom:4px">Аюул арилгах дедлайн</label>
        <input class="input" id="sf_deadline" type="date" value="${r?.deadline||''}">
        <div id="sf_deadline_hint" style="font-size:10px;color:#16a34a;margin-top:3px;font-weight:600"></div>
      </div>
    </div>
    ${r ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
      ${inputRow('Workflow статус', `<select class="input" id="sf_workflow">${WORKFLOW_STATUSES.map(s=>`<option ${(r?.workflow_status||'Шинэ')===s?'selected':''}>${escapeHtml(s)}</option>`).join('')}</select>`)}
      ${inputRow('Арга хэмжээний тэмдэглэл', `<input class="input" id="sf_actionnote" value="${escapeHtml(r?.action_note||'')}" placeholder="Хэрэгжүүлсэн арга хэмжээ...">`)}
    </div>` : ''}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
      ${inputRow('GPS Өргөрөг', `<input class="input" id="sf_lat" type="number" step="any" value="${r?.gps_lat||''}" placeholder="48.0000">`)}
      ${inputRow('GPS Уртраг', `<input class="input" id="sf_lng" type="number" step="any" value="${r?.gps_lng||''}" placeholder="114.5000">`)}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px">
      <div>
        <label style="display:block;font-size:12px;color:#667085;font-weight:600;margin-bottom:4px">📷 Зураг (ерөнхий)</label>
        <input type="file" accept="image/*" id="sf_img" onchange="hseUploadImg(this)" style="font-size:11px;width:100%">
        <div id="sf_img_preview" style="margin-top:6px">
          ${r?.image_url ? `<img src="${escapeHtml(r.image_url)}" style="width:100%;height:54px;object-fit:cover;border-radius:6px">` : ''}
        </div>
        <input type="hidden" id="sf_img_url" value="${escapeHtml(r?.image_url||'')}">
      </div>
      <div>
        <label style="display:block;font-size:12px;color:#dc2626;font-weight:600;margin-bottom:4px">📷 Өмнөх зураг</label>
        <input type="file" accept="image/*" id="sf_before_img" onchange="hseUploadBeforeImg(this)" style="font-size:11px;width:100%">
        <div id="sf_before_preview" style="margin-top:6px">
          ${r?.before_image_url ? `<img src="${escapeHtml(r.before_image_url)}" style="width:100%;height:54px;object-fit:cover;border-radius:6px;border:2px solid #fecaca">` : ''}
        </div>
        <input type="hidden" id="sf_before_url" value="${escapeHtml(r?.before_image_url||'')}">
      </div>
      <div>
        <label style="display:block;font-size:12px;color:#16a34a;font-weight:600;margin-bottom:4px">📷 Дараах зураг</label>
        <input type="file" accept="image/*" id="sf_after_img" onchange="hseUploadAfterImg(this)" style="font-size:11px;width:100%">
        <div id="sf_after_preview" style="margin-top:6px">
          ${r?.after_image_url ? `<img src="${escapeHtml(r.after_image_url)}" style="width:100%;height:54px;object-fit:cover;border-radius:6px;border:2px solid #bbf7d0">` : ''}
        </div>
        <input type="hidden" id="sf_after_url" value="${escapeHtml(r?.after_image_url||'')}">
      </div>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button class="btn secondary" onclick="hseCloseRisk()">Болих</button>
      <button class="btn" onclick="hseSaveRisk()">Хадгалах</button>
    </div>`;
  document.getElementById('hseRiskModal').style.display = 'block';
  hseCalcScore();
  hseLocInit();
}

function hseCloseRisk() { document.getElementById('hseRiskModal').style.display = 'none'; _editId = null; }

// ── Location combobox ─────────────────────────────────────────

let _locAssets  = null;
let _locCat     = null;   // selected category filter
let _locBag     = null;   // selected bag/location filter

async function hseLocInit() {
  if (!_locAssets) {
    try {
      const [assets, gerInv] = await Promise.all([
        api('/api/assets').catch(() => []),
        api('/api/sl-ger-inventory').catch(() => []),
      ]);
      const GER_CAT = { 'Гэр хороолол': 'Гэр хорооллын гэрэл', 'Цамхаг': 'Цамхагийн гэрэл' };
      const gerNorm = gerInv.map(r => ({
        name: r.location_name, category: GER_CAT[r.category] || r.category,
        location: '', _bag: r.bag_no != null ? String(r.bag_no) + '-р баг' : null,
        _refType: 'sl_ger_inventory', _refId: r.id, _assignedTo: r.assigned_to || null,
      }));
      const SL_CATS = new Set(['Гэр хорооллын гэрэл','Цамхагийн гэрэл','Авто замын гэрэл']);
      const assetNorm = assets.filter(a => !SL_CATS.has(a.category)).map(a => ({
        ...a, _refType: 'assets', _refId: a.id, _assignedTo: a.assigned_to || null,
      }));
      _locAssets = [...gerNorm, ...assetNorm];
    } catch { _locAssets = []; }
  }
  _locCat = null; _locBag = null;
  document.addEventListener('mousedown', _hseLocOutside, { once: true });
}

function _hseLocOutside(e) {
  const wrap = document.getElementById('sf_loc_wrap');
  if (wrap && !wrap.contains(e.target)) hseLocHide();
  else document.addEventListener('mousedown', _hseLocOutside, { once: true });
}

function hseLocShow() { _hseLocRender(); }
function hseLocHide() {
  const d = document.getElementById('sf_loc_drop');
  if (d) d.style.display = 'none';
}
function hseLocFilter() { _hseLocRender(); }

function hseLocSetCat(cat) {
  _locCat = _locCat === cat ? null : cat;
  _locBag = null;
  _hseLocRender();
}
function hseLocSetBag(bag) {
  _locBag = _locBag === bag ? null : bag;
  _hseLocRender();
}

function _hseLocRender() {
  const d   = document.getElementById('sf_loc_drop');
  const inp = document.getElementById('sf_loc');
  if (!d || !inp || !_locAssets) return;

  const q = (inp.value || '').toLowerCase().trim();

  // 1 — all categories
  const cats = [...new Set(_locAssets.map(a => a.category).filter(Boolean))].sort();

  // 2 — apply cat + text filter
  let pool = _locAssets.filter(a => {
    if (_locCat && a.category !== _locCat) return false;
    if (!q) return true;
    return (a.name||'').toLowerCase().includes(q) ||
           (a.location||'').toLowerCase().includes(q) ||
           (a.asset_code||'').toLowerCase().includes(q);
  });

  // 3 — extract "N-р баг" tokens from filtered pool
  const bagRe = /(\d+)-р\s*баг/gi;
  const bags  = [...new Set(
    pool.flatMap(a => {
      if (a._bag) return [a._bag.toLowerCase().replace(/\s+/,'')];
      return [...(a.location||'').matchAll(bagRe)].map(m => m[0].toLowerCase().replace(/\s+/,''));
    })
  )].sort((a,b) => parseInt(a) - parseInt(b));

  if (_locBag) pool = pool.filter(a => {
    const bagStr = a._bag ? a._bag.toLowerCase().replace(/\s+/,'') : (a.location||'').toLowerCase().replace(/\s+/,'');
    return bagStr.includes(_locBag);
  });

  // 4 — for large pools without a category selected, require bag or 2+ char search
  const tooMany = !_locCat && pool.length > 30 && !_locBag && q.length < 2;
  const shown = tooMany ? [] : pool.slice(0, 40);

  // ── Category select + Баг chips — single compact row
  const _shortCat = {
    'Авто замын гэрэл':    '💡 Авто зам',
    'Гэр хорооллын гэрэл': '🏘 Гэр хороолол',
    'Цамхагийн гэрэл':     '🗼 Цамхаг',
    'Гэрлэн дохио':        '🚦 Дохио',
    'Гэрэлтүүлэг':         '💡 Гэрэлтүүлэг',
    'Камер':               '📷 Камер',
    'Техник':              '🔧 Техник',
    'Барилга':             '🏢 Барилга',
    'Шит/Самбар':          '⚡ Шит/Самбар',
    'Шилэн кабель':        '🔌 Кабель',
  };
  const catOptions = cats
    .filter(c => _locAssets.filter(a=>a.category===c).length > 0)
    .map(c => {
      const cnt   = _locAssets.filter(a=>a.category===c).length;
      const label = _shortCat[c] || c;
      return `<option value="${escapeHtml(c)}" ${_locCat===c?'selected':''}>${label} (${cnt})</option>`;
    }).join('');

  const bagChipsHtml = bags.length > 1
    ? bags.map(b => {
        const act = _locBag === b;
        const num  = b.match(/\d+/)?.[0] || b;
        return `<button onclick="event.stopPropagation();hseLocSetBag('${b}')"
          style="padding:2px 9px;border-radius:20px;border:1px solid ${act?'#2563eb':'#e2e6ed'};background:${act?'#dbeafe':'#fff'};color:${act?'#1d4ed8':'#64748b'};font-size:11px;cursor:pointer;font-weight:700;flex-shrink:0">
          ${num}-р баг
        </button>`;
      }).join('')
    : '';

  const catChips = `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid #f1f5f9;flex-wrap:wrap">
    <select onchange="event.stopPropagation();hseLocSetCat(this.value||null)"
      style="padding:4px 8px;border:1px solid #e2e6ed;border-radius:8px;font-size:12px;color:#374151;background:#fff;cursor:pointer;flex-shrink:0;max-width:220px">
      <option value="">Бүх ангилал (${_locAssets.length})</option>
      ${catOptions}
    </select>
    ${bagChipsHtml}
  </div>`;

  const bagChips = '';

  // ── Asset list
  const list = tooMany
    ? `<div style="padding:16px 14px;text-align:center">
        <div style="font-size:22px;margin-bottom:6px">🔍</div>
        <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:4px">${pool.length} объект байна</div>
        <div style="font-size:11px;color:#94a3b8">${bags.length ? 'Дээрх баг-аас сонгох эсвэл' : ''} нэр бичиж хайна уу (2+ тэмдэгт)</div>
      </div>`
    : shown.length
      ? shown.map(a => {
          const val = a.location ? `${a.name} — ${a.location}` : a.name;
          const refType = a._refType || '';
          const refId   = a._refId   || 0;
          const assignTo = a._assignedTo || 0;
          return `<div onclick="hseLocSelect('${val.replace(/'/g,"&#39;")}','${refType}',${refId},${assignTo})"
            style="padding:9px 14px;cursor:pointer;border-bottom:1px solid #f8fafc;display:flex;align-items:center;gap:10px"
            onmouseover="this.style.background='#faf5ff'" onmouseout="this.style.background=''">
            <div style="flex:1;min-width:0">
              <div style="font-size:12px;font-weight:600;color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(a.name||'')}</div>
              <div style="font-size:10px;color:#94a3b8;margin-top:1px">${escapeHtml(a.category||'')}${a._bag?' · '+escapeHtml(a._bag):a.location?' · 📍 '+escapeHtml(a.location):''}</div>
            </div>
            <span style="font-size:10px;color:#c4b5fd;flex-shrink:0">${escapeHtml(a.asset_code||'')}</span>
          </div>`;
        }).join('')
      : `<div style="padding:16px;text-align:center;font-size:12px;color:#94a3b8">Объект олдсонгүй</div>`;

  const counter = pool.length > 40
    ? `<div style="padding:6px 14px;text-align:center;font-size:10px;color:#94a3b8;border-top:1px solid #f1f5f9">${pool.length} объектоос эхний 40-г харуулж байна</div>` : '';

  d.innerHTML = catChips + bagChips + `<div style="max-height:200px;overflow-y:auto">${list}</div>` + counter;
  d.style.display = 'block';
}

function hseLocSelect(val, refType, refId, assignTo) {
  const inp = document.getElementById('sf_loc');
  if (inp) { inp.value = val; inp.focus(); }
  const rt = document.getElementById('sf_loc_ref_type');
  const ri = document.getElementById('sf_loc_ref_id');
  const at = document.getElementById('sf_loc_assigned');
  if (rt) rt.value = refType || '';
  if (ri) ri.value = refId   || '';
  if (at) at.value = assignTo || '';
  hseLocHide();
}

function hsePpeToggle(cb) {
  const label = cb.closest('label');
  if (!label) return;
  label.style.borderColor = cb.checked ? '#2563eb' : '#e2e6ed';
  label.style.background  = cb.checked ? '#eff6ff' : '#fff';
}

async function _hseUpload(file) {
  const fd = new FormData();
  fd.append('file', file);
  const token = localStorage.getItem('erp_token');
  const res = await fetch('/api/upload', { method:'POST', headers:{'Authorization':'Bearer '+token}, body:fd });
  const json = await res.json();
  if (!json.url) throw new Error('Upload failed');
  return json.url;
}

async function hseUploadImg(input) {
  if (!input.files[0]) return;
  try {
    const url = await _hseUpload(input.files[0]);
    document.getElementById('sf_img_url').value = url;
    document.getElementById('sf_img_preview').innerHTML = `<img src="${url}" style="width:100%;height:54px;object-fit:cover;border-radius:6px">`;
  } catch(e) { toast('Зураг upload алдаа'); }
}

async function hseUploadBeforeImg(input) {
  if (!input.files[0]) return;
  try {
    const url = await _hseUpload(input.files[0]);
    document.getElementById('sf_before_url').value = url;
    document.getElementById('sf_before_preview').innerHTML = `<img src="${url}" style="width:100%;height:54px;object-fit:cover;border-radius:6px;border:2px solid #fecaca">`;
  } catch(e) { toast('Зураг upload алдаа'); }
}

async function hseUploadAfterImg(input) {
  if (!input.files[0]) return;
  try {
    const url = await _hseUpload(input.files[0]);
    document.getElementById('sf_after_url').value = url;
    document.getElementById('sf_after_preview').innerHTML = `<img src="${url}" style="width:100%;height:54px;object-fit:cover;border-radius:6px;border:2px solid #bbf7d0">`;
  } catch(e) { toast('Зураг upload алдаа'); }
}

async function hseSaveRisk() {
  const loc  = document.getElementById('sf_loc').value.trim();
  const date = document.getElementById('sf_date').value;
  if (!loc)  { toast('Байршил оруулна уу'); return; }
  if (!date) { toast('Огноо оруулна уу');   return; }
  const ppeChecked = [...document.querySelectorAll('input[name="ppe"]:checked')].map(el => el.value);
  const body = {
    report_date:          date,
    risk_time:            document.getElementById('sf_time')?.value || null,
    location:             loc,
    risk_type:            document.getElementById('sf_type').value,
    risk_level:           document.getElementById('sf_level').value,
    priority:             document.getElementById('sf_priority')?.value || 'Дунд',
    probability:          Number(document.getElementById('sf_prob').value) || 1,
    consequence_score:    Number(document.getElementById('sf_cons').value) || 1,
    risk_condition:       document.getElementById('sf_condition').value.trim() || null,
    possible_consequence: document.getElementById('sf_consequence').value.trim() || null,
    risk_description:     document.getElementById('sf_desc').value.trim() || null,
    pre_work_note:        document.getElementById('sf_prework').value.trim() || null,
    action_plan:          document.getElementById('sf_actionplan')?.value.trim() || null,
    ppe_checklist:        JSON.stringify(ppeChecked),
    assigned_to:          document.getElementById('sf_assigned').value || null,
    deadline:             document.getElementById('sf_deadline').value || null,
    workflow_status:      document.getElementById('sf_workflow')?.value || 'Шинэ',
    action_note:          document.getElementById('sf_actionnote')?.value.trim() || null,
    gps_lat:              document.getElementById('sf_lat').value || null,
    gps_lng:              document.getElementById('sf_lng').value || null,
    image_url:            document.getElementById('sf_img_url').value || '',
    before_image_url:     document.getElementById('sf_before_url')?.value || '',
    after_image_url:      document.getElementById('sf_after_url')?.value || '',
    status:               'Нээлттэй',
    location_ref_type:    document.getElementById('sf_loc_ref_type')?.value || null,
    location_ref_id:      Number(document.getElementById('sf_loc_ref_id')?.value) || null,
    _loc_assigned:        Number(document.getElementById('sf_loc_assigned')?.value) || null,
  };
  try {
    if (_editId) await api(`/api/safety-reports/${_editId}`, { method:'PUT', body:JSON.stringify(body) });
    else         await api('/api/safety-reports',             { method:'POST',body:JSON.stringify(body) });
    toast('Хадгаллаа');
    hseCloseRisk();
    await hseTab(_tab);
  } catch(e) { toast(e.message || 'Алдаа'); }
}

async function hseRiskStatus(id, status) {
  try {
    await api(`/api/safety-reports/${id}/status`, { method:'PATCH', body:JSON.stringify({ status }) });
    toast('Шинэчлэгдлаа');
    await hseTab(_tab);
  } catch(e) { toast(e.message || 'Алдаа'); }
}

async function hseDelRisk(id) {
  const r = _risks.find(x => x.id === id);
  if (!confirm(`"${r?.location||id}" — устгах уу?`)) return;
  try {
    await api(`/api/safety-reports/${id}`, { method:'DELETE' });
    toast('Устгагдлаа');
    await hseTab(_tab);
  } catch(e) { toast(e.message || 'Алдаа'); }
}

async function hseRiskWorkflow(id, status, evt) {
  if (evt) evt.stopPropagation();
  try {
    await api(`/api/safety-reports/${id}/workflow`, { method:'PATCH', body:JSON.stringify({ workflow_status: status }) });
    toast('Workflow шинэчлэгдлаа: ' + status);
    await hseTab(_tab);
  } catch(e) { toast(e.message || 'Алдаа'); }
}

async function hseLoadComments(reportId) {
  const el = document.getElementById(`hseComments_${reportId}`);
  if (!el) return;
  try {
    const comments = await api(`/api/safety-reports/${reportId}/comments`);
    if (!comments.length) {
      el.innerHTML = `<div style="font-size:11px;color:#94a3b8;padding:4px 0">Коммент байхгүй байна</div>`;
      return;
    }
    el.innerHTML = comments.map(c => `
      <div style="display:flex;gap:8px;margin-bottom:6px;align-items:flex-start">
        <div style="width:26px;height:26px;border-radius:50%;background:#e0e7ff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#4338ca;flex-shrink:0">${escapeHtml((c.user_name||'?').slice(0,1))}</div>
        <div style="flex:1;background:#fff;border:1px solid #e2e6ed;border-radius:8px;padding:7px 10px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
            <span style="font-size:11px;font-weight:700;color:#374151">${escapeHtml(c.user_name||'—')}</span>
            <span style="font-size:10px;color:#94a3b8">${fmtDate(c.created_at)}</span>
          </div>
          <div style="font-size:12px;color:#111827">${escapeHtml(c.comment)}</div>
        </div>
        ${c.user_id === state.me?.id ? `<button onclick="hseDelComment(${c.id},${reportId})" style="padding:2px 6px;border-radius:4px;font-size:11px;border:1px solid #fecaca;background:#fff;color:#dc2626;cursor:pointer;flex-shrink:0">✕</button>` : ''}
      </div>`).join('');
  } catch { el.innerHTML = '<div style="font-size:11px;color:#dc2626">Коммент ачаалахад алдаа гарлаа</div>'; }
}

async function hseAddComment(reportId) {
  const input = document.getElementById(`hseCommentInput_${reportId}`);
  const comment = input?.value.trim();
  if (!comment) return;
  try {
    await api(`/api/safety-reports/${reportId}/comments`, { method:'POST', body:JSON.stringify({ comment }) });
    input.value = '';
    hseLoadComments(reportId);
  } catch(e) { toast(e.message || 'Алдаа'); }
}

async function hseDelComment(commentId, reportId) {
  try {
    await api(`/api/safety-comments/${commentId}`, { method:'DELETE' });
    hseLoadComments(reportId);
  } catch(e) { toast(e.message || 'Алдаа'); }
}

// ── Vehicle Form ──────────────────────────────────────────────

function hseOpenVeh(id) {
  _editId = id || null;
  const v = id ? _vehicles.find(x => x.id === id) : null;
  document.getElementById('hseVehTitle').textContent = v ? 'Техник засах' : 'Техник бүртгэх';
  document.getElementById('hseVehBody').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
      ${inputRow('Улсын дугаар *', `<input class="input" id="vf_plate" value="${escapeHtml(v?.plate_no||'')}" placeholder="1234АА" style="text-transform:uppercase">`)}
      ${inputRow('Техникийн төрөл *', `<select class="input" id="vf_type">${VEHICLE_TYPES.map(t=>`<option ${v?.vehicle_type===t?'selected':''}>${t}</option>`).join('')}</select>`)}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">
      ${inputRow('Марк', `<input class="input" id="vf_brand" value="${escapeHtml(v?.brand||'')}" placeholder="Toyota">`)}
      ${inputRow('Загвар', `<input class="input" id="vf_model" value="${escapeHtml(v?.model||'')}" placeholder="Land Cruiser">`)}
      ${inputRow('Он', `<input class="input" id="vf_year" type="number" value="${v?.manufacture_year||''}" placeholder="2020">`)}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
      ${inputRow('Жолооч', `<select class="input" id="vf_driver">${userOpts(v?.driver_id)}</select>`)}
      ${inputRow('Статус', `<select class="input" id="vf_status">${VEHICLE_STATUSES.map(s=>`<option ${(v?.status||'Ажилд')===s?'selected':''}>${s}</option>`).join('')}</select>`)}
    </div>
    ${inputRow('Тэмдэглэл', `<input class="input" id="vf_note" value="${escapeHtml(v?.note||'')}" placeholder="...">`)}
    <div style="display:flex;gap:10px;margin-top:18px;justify-content:flex-end">
      <button class="btn secondary" onclick="hseCloseVeh()">Болих</button>
      <button class="btn" onclick="hseSaveVeh()">Хадгалах</button>
    </div>`;
  document.getElementById('hseVehModal').style.display = 'block';
}

function hseEditVeh(id) { hseOpenVeh(id); }
function hseCloseVeh() { document.getElementById('hseVehModal').style.display = 'none'; _editId = null; }

async function hseSaveVeh() {
  const plate = document.getElementById('vf_plate').value.trim().toUpperCase();
  const type  = document.getElementById('vf_type').value;
  if (!plate || !type) { toast('Улсын дугаар болон төрлийг оруулна уу'); return; }
  const body = {
    plate_no: plate, vehicle_type: type,
    brand: document.getElementById('vf_brand').value.trim(),
    model: document.getElementById('vf_model').value.trim(),
    manufacture_year: document.getElementById('vf_year').value || 0,
    driver_id: document.getElementById('vf_driver').value || null,
    status:    document.getElementById('vf_status').value,
    note:      document.getElementById('vf_note').value.trim(),
  };
  try {
    if (_editId) await api(`/api/vehicles/${_editId}`, { method:'PUT', body:JSON.stringify(body) });
    else         await api('/api/vehicles',             { method:'POST',body:JSON.stringify(body) });
    toast('Хадгаллаа');
    hseCloseVeh();
    await hseTab(_tab);
  } catch(e) { toast(e.message || 'Алдаа'); }
}

async function hseDelVeh(id) {
  const v = _vehicles.find(x => x.id === id);
  if (!confirm(`"${v?.plate_no||id}" техникийг устгах уу?`)) return;
  try {
    await api(`/api/vehicles/${id}`, { method:'DELETE' });
    toast('Устгагдлаа');
    await hseTab(_tab);
  } catch(e) { toast(e.message || 'Алдаа'); }
}

// ── Daily Inspection Form ─────────────────────────────────────

function hseOpenDailyInsp(vehicleId) {
  _dailyStates = {};
  DAILY_ITEMS.forEach((_, i) => { _dailyStates[i] = { status: 'Хэвийн', comment: '' }; });
  const selectedVehicle = _vehicles.find(v => String(v.id) === String(vehicleId));
  document.getElementById('hseInspTitle').textContent = 'Өдөр тутмын үзлэг';
  document.getElementById('hseInspBody').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
      ${inputRow('Техник *', `<select class="input" id="if_vehicle" onchange="hseDailyVehicleChanged(this.value)">${vehicleOpts(vehicleId)}</select>`)}
      ${inputRow('Огноо *', `<input class="input" id="if_date" type="date" value="${today()}">`)}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
      ${inputRow('Цахилгааны инженер', `<select class="input" id="if_inspector">${userOpts(state.me.id)}</select>`)}
      ${inputRow('Хамтарсан жолооч', `<div id="if_driver_label" style="padding:9px 12px;border:1px solid #e2e6ed;border-radius:8px;background:#f8fafc;font-size:13px;font-weight:700;color:#0f172a">${escapeHtml(selectedVehicle?.driver_name||'—')}</div><input type="hidden" id="if_driver" value="${selectedVehicle?.driver_id||''}">`)}
    </div>
    <div style="margin-top:16px;margin-bottom:10px;font-size:13px;font-weight:700;color:#374151">📋 Өдөр тутмын үзлэгийн жагсаалт</div>
    <div id="if_items">
      ${DAILY_ITEMS.map((item, i) => dailyItemHtml(item, i)).join('')}
    </div>
    <div style="margin-top:12px">
      ${inputRow('Ерөнхий тэмдэглэл', `<textarea class="input" id="if_note" rows="2" style="resize:vertical" placeholder="Нэмэлт тайлбар..."></textarea>`)}
    </div>
    <div style="display:flex;gap:10px;margin-top:18px;justify-content:flex-end">
      <button class="btn secondary" onclick="hseCloseInsp()">Болих</button>
      <button class="btn" onclick="hseSaveDailyInsp()">Хадгалах</button>
    </div>`;
  document.getElementById('hseInspModal').style.display = 'block';
}

function hseDailyVehicleChanged(vehicleId) {
  const v = _vehicles.find(x => String(x.id) === String(vehicleId));
  const label = document.getElementById('if_driver_label');
  const input = document.getElementById('if_driver');
  if (label) label.textContent = v?.driver_name || '—';
  if (input) input.value = v?.driver_id || '';
}

function dailyItemHtml(item, i) {
  return `<div id="ditem_${i}" style="display:flex;flex-direction:column;border:1.5px solid #e2e6ed;border-radius:9px;padding:10px 12px;margin-bottom:5px;background:#fff;transition:all .15s">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
      <span style="font-weight:600;font-size:13px">${escapeHtml(item)}</span>
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button id="dib_ok_${i}" onclick="hseItemToggle(${i},'Хэвийн','daily')" style="padding:5px 14px;border-radius:7px;font-size:11px;font-weight:700;border:1.5px solid #16a34a;background:#dcfce7;color:#16a34a;cursor:pointer">✓ Хэвийн</button>
        <button id="dib_ng_${i}" onclick="hseItemToggle(${i},'Зөрчилтэй','daily')" style="padding:5px 14px;border-radius:7px;font-size:11px;font-weight:700;border:1.5px solid #e2e6ed;background:#fff;color:#94a3b8;cursor:pointer">✗ Зөрчилтэй</button>
      </div>
    </div>
    <div id="dcomment_${i}" style="display:none;margin-top:7px">
      <input type="text" id="dic_${i}" placeholder="Зөрчлийн тайлбар..." class="input" style="font-size:12px">
    </div>
  </div>`;
}

function hseItemToggle(i, status, type) {
  const states = type === 'daily' ? _dailyStates : _monthlyStates;
  states[i] = { ...states[i], status };
  const okBtn = document.getElementById(`dib_ok_${i}`);
  const ngBtn = document.getElementById(`dib_ng_${i}`);
  const comment = document.getElementById(`dcomment_${i}`);
  const wrap = document.getElementById(`ditem_${i}`);
  if (status === 'Хэвийн') {
    Object.assign(okBtn.style, { background:'#dcfce7', borderColor:'#16a34a', color:'#16a34a' });
    Object.assign(ngBtn.style, { background:'#fff', borderColor:'#e2e6ed', color:'#94a3b8' });
    if (comment) comment.style.display = 'none';
    if (wrap) Object.assign(wrap.style, { borderColor:'#e2e6ed', background:'#fff' });
  } else {
    Object.assign(ngBtn.style, { background:'#fee2e2', borderColor:'#dc2626', color:'#dc2626' });
    Object.assign(okBtn.style, { background:'#fff', borderColor:'#e2e6ed', color:'#94a3b8' });
    if (comment) comment.style.display = 'block';
    if (wrap) Object.assign(wrap.style, { borderColor:'#fca5a5', background:'#fff5f5' });
  }
}

async function hseSaveDailyInsp() {
  const vehicleId = document.getElementById('if_vehicle').value;
  const date      = document.getElementById('if_date').value;
  if (!vehicleId) { toast('Техник сонгоно уу'); return; }
  if (!date)      { toast('Огноо оруулна уу'); return; }
  const items = DAILY_ITEMS.map((item, i) => ({
    item,
    status:  _dailyStates[i]?.status || 'Хэвийн',
    comment: document.getElementById(`dic_${i}`)?.value || '',
  }));
  const body = {
    vehicle_id:   vehicleId,
    insp_date:    date,
    inspector_id: document.getElementById('if_inspector').value || null,
    driver_id:    document.getElementById('if_driver').value || null,
    items,
    note: document.getElementById('if_note').value,
  };
  try {
    await api('/api/vehicle-daily-inspections', { method:'POST', body:JSON.stringify(body) });
    toast('Өдөр тутмын үзлэг бүртгэгдлаа');
    hseCloseInsp();
    await hseTab(_tab);
  } catch(e) { toast(e.message || 'Алдаа'); }
}

function hseOpenWeeklyInsp(vehicleId) {
  _monthlyStates = {};
  MONTHLY_ITEMS.forEach((_, i) => { _monthlyStates[i] = { status: 'Хэвийн', comment: '' }; });
  document.getElementById('hseInspTitle').textContent = '7 хоногийн үзлэг';
  document.getElementById('hseInspBody').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
      ${inputRow('Техник *', `<select class="input" id="if_vehicle">${vehicleOpts(vehicleId)}</select>`)}
      ${inputRow('7 хоног эхлэх огноо *', `<input class="input" id="if_week_start" type="date" value="${today()}">`)}
    </div>
    ${inputRow('ХАБЭА ажилтан', `<select class="input" id="if_hse">${userOpts(state.me.id)}</select>`)}
    <div style="margin-top:16px;margin-bottom:10px;font-size:13px;font-weight:700;color:#374151">🦺 7 хоногийн үзлэгийн жагсаалт</div>
    <div id="if_items">${MONTHLY_ITEMS.map((item, i) => monthlyItemHtml(item, i)).join('')}</div>
    <div style="margin-top:12px">
      ${inputRow('Тэмдэглэл', `<textarea class="input" id="if_note" rows="2" style="resize:vertical" placeholder="Нэмэлт тайлбар..."></textarea>`)}
    </div>
    <div style="display:flex;gap:10px;margin-top:18px;justify-content:flex-end">
      <button class="btn secondary" onclick="hseCloseInsp()">Болих</button>
      <button class="btn" onclick="hseSaveWeeklyInsp()">Хадгалах</button>
    </div>`;
  document.getElementById('hseInspModal').style.display = 'block';
}

async function hseSaveWeeklyInsp() {
  const vehicleId = document.getElementById('if_vehicle').value;
  const weekStart = document.getElementById('if_week_start').value;
  if (!vehicleId) { toast('Техник сонгоно уу'); return; }
  if (!weekStart) { toast('7 хоногийн огноо оруулна уу'); return; }
  const items = MONTHLY_ITEMS.map((item, i) => ({
    item,
    status:  _monthlyStates[i]?.status || 'Хэвийн',
    comment: document.getElementById(`dic_${i}`)?.value || '',
  }));
  try {
    await api('/api/vehicle-weekly-inspections', { method:'POST', body:JSON.stringify({
      vehicle_id: vehicleId,
      week_start: weekStart,
      hse_id: document.getElementById('if_hse').value || null,
      items,
      note: document.getElementById('if_note').value,
    }) });
    toast('7 хоногийн үзлэг бүртгэгдлээ');
    hseCloseInsp();
    await hseTab(_tab);
  } catch(e) { toast(e.message || 'Алдаа'); }
}

// ── Monthly Inspection Form ───────────────────────────────────

function hseOpenMonthlyInsp(vehicleId) {
  _monthlyStates = {};
  MONTHLY_ITEMS.forEach((_, i) => { _monthlyStates[i] = { status: 'Хэвийн', comment: '' }; });
  const now = new Date();
  document.getElementById('hseInspTitle').textContent = 'Сарын үзлэг';
  document.getElementById('hseInspBody').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">
      ${inputRow('Техник *', `<select class="input" id="if_vehicle">${vehicleOpts(vehicleId)}</select>`)}
      ${inputRow('Он', `<input class="input" id="if_year" type="number" value="${now.getFullYear()}">`)}
      ${inputRow('Сар', `<select class="input" id="if_month">${Array.from({length:12},(_,j)=>`<option value="${j+1}" ${j+1===now.getMonth()+1?'selected':''}>${j+1}-р сар</option>`).join('')}</select>`)}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
      ${inputRow('Механик', `<select class="input" id="if_mechanic">${userOpts(null)}</select>`)}
      ${inputRow('Хянасан инженер', `<select class="input" id="if_engineer">${userOpts(null)}</select>`)}
    </div>
    <div style="margin-top:4px;margin-bottom:10px;font-size:13px;font-weight:700;color:#374151">📋 Сарын үзлэгийн жагсаалт</div>
    <div id="if_items">
      ${MONTHLY_ITEMS.map((item, i) => monthlyItemHtml(item, i)).join('')}
    </div>
    <div style="margin-top:12px">
      ${inputRow('Тэмдэглэл', `<textarea class="input" id="if_note" rows="2" style="resize:vertical" placeholder="Нэмэлт тайлбар..."></textarea>`)}
    </div>
    <div style="display:flex;gap:10px;margin-top:18px;justify-content:flex-end">
      <button class="btn secondary" onclick="hseCloseInsp()">Болих</button>
      <button class="btn" onclick="hseSaveMonthlyInsp()">Хадгалах</button>
    </div>`;
  document.getElementById('hseInspModal').style.display = 'block';
}

function monthlyItemHtml(item, i) {
  return `<div id="ditem_${i}" style="display:flex;flex-direction:column;border:1.5px solid #e2e6ed;border-radius:9px;padding:10px 12px;margin-bottom:5px;background:#fff;transition:all .15s">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
      <span style="font-weight:600;font-size:13px">${escapeHtml(item)}</span>
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button id="dib_ok_${i}" onclick="hseItemToggle(${i},'Хэвийн','monthly')" style="padding:5px 14px;border-radius:7px;font-size:11px;font-weight:700;border:1.5px solid #16a34a;background:#dcfce7;color:#16a34a;cursor:pointer">✓ Хэвийн</button>
        <button id="dib_ng_${i}" onclick="hseItemToggle(${i},'Зөрчилтэй','monthly')" style="padding:5px 14px;border-radius:7px;font-size:11px;font-weight:700;border:1.5px solid #e2e6ed;background:#fff;color:#94a3b8;cursor:pointer">✗ Зөрчилтэй</button>
      </div>
    </div>
    <div id="dcomment_${i}" style="display:none;margin-top:7px">
      <input type="text" id="dic_${i}" placeholder="Зөрчлийн тайлбар..." class="input" style="font-size:12px">
    </div>
  </div>`;
}

async function hseSaveMonthlyInsp() {
  const vehicleId = document.getElementById('if_vehicle').value;
  const year  = document.getElementById('if_year').value;
  const month = document.getElementById('if_month').value;
  if (!vehicleId) { toast('Техник сонгоно уу'); return; }
  const items = MONTHLY_ITEMS.map((item, i) => ({
    item,
    status:  _monthlyStates[i]?.status || 'Хэвийн',
    comment: document.getElementById(`dic_${i}`)?.value || '',
  }));
  const body = {
    vehicle_id:  vehicleId,
    insp_year:   year,
    insp_month:  month,
    mechanic_id: document.getElementById('if_mechanic').value || null,
    engineer_id: document.getElementById('if_engineer').value || null,
    items,
    note: document.getElementById('if_note').value,
  };
  try {
    await api('/api/vehicle-monthly-inspections', { method:'POST', body:JSON.stringify(body) });
    toast('Сарын үзлэг бүртгэгдлаа');
    hseCloseInsp();
    await hseTab(_tab);
  } catch(e) { toast(e.message || 'Алдаа'); }
}

function hseCloseInsp() { document.getElementById('hseInspModal').style.display = 'none'; }

async function hseReviewDaily(id, approved) {
  const note = approved ? '' : (prompt('Татгалзсан шалтгаан') || '');
  try {
    await api(`/api/vehicle-daily-inspections/${id}/review`, {
      method:'PATCH',
      body: JSON.stringify({ approved, note })
    });
    toast(approved ? 'Ажилд гарах зөвшөөрөл олголоо' : 'Зөвшөөрөл татгалзлаа');
    await hseTab(_tab);
  } catch(e) { toast(e.message || 'Алдаа'); }
}

async function hseApproveMonthly(id, approved) {
  const note = approved ? '' : (prompt('Буцаасан шалтгаан') || '');
  try {
    await api(`/api/vehicle-monthly-inspections/${id}/approve`, {
      method:'PATCH',
      body: JSON.stringify({ approved, note })
    });
    toast(approved ? 'Сарын үзлэг баталгаажлаа' : 'Сарын үзлэг буцаагдлаа');
    await hseTab(_tab);
  } catch(e) { toast(e.message || 'Алдаа'); }
}

// ── Repair Form ───────────────────────────────────────────────

function hseOpenRepair(vehicleId) {
  document.getElementById('hseRepairBody').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
      ${inputRow('Техник *', `<select class="input" id="rf_vehicle">${vehicleOpts(vehicleId)}</select>`)}
      ${inputRow('Огноо *', `<input class="input" id="rf_date" type="date" value="${today()}">`)}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
      ${inputRow('Засварын төрөл *', `<select class="input" id="rf_type">${REPAIR_TYPES.map(t=>`<option>${t}</option>`).join('')}</select>`)}
      ${inputRow('Гэмтлийн актын №', `<input class="input" id="rf_act" placeholder="АКТ-2026-001">`)}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
      ${inputRow('Суурилуулсан ажилтан', `<select class="input" id="rf_tech">${userOpts(null)}</select>`)}
      ${inputRow('Хянасан инженер', `<select class="input" id="rf_eng">${userOpts(null)}</select>`)}
    </div>
    ${inputRow('Засварын тайлбар', `<textarea class="input" id="rf_desc" rows="3" style="resize:vertical" placeholder="Гэмтлийн шинж тэмдэг, хийсэн ажил..."></textarea>`)}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px;margin-bottom:12px">
      ${inputRow('Зардал ₮', `<input class="input" id="rf_cost" type="number" placeholder="0">`)}
      ${inputRow('Статус', `<select class="input" id="rf_status"><option>Хийгдэж байна</option><option>Дууссан</option></select>`)}
    </div>
    ${inputRow('Сэлбэгийн нэр (таслалаар тусгаарла)', `<input class="input" id="rf_parts" placeholder="Тос, шүүлтүүр, дугуй...">`)}
    <div style="display:flex;gap:10px;margin-top:18px;justify-content:flex-end">
      <button class="btn secondary" onclick="hseCloseRepair()">Болих</button>
      <button class="btn" onclick="hseSaveRepair()">Хадгалах</button>
    </div>`;
  document.getElementById('hseRepairModal').style.display = 'block';
}

function hseCloseRepair() { document.getElementById('hseRepairModal').style.display = 'none'; }

async function hseSaveRepair() {
  const vehicleId = document.getElementById('rf_vehicle').value;
  const date      = document.getElementById('rf_date').value;
  const type      = document.getElementById('rf_type').value;
  if (!vehicleId || !date || !type) { toast('Шаардлагатай талбарууд дутуу'); return; }
  const partsRaw = document.getElementById('rf_parts').value.trim();
  const parts = partsRaw ? partsRaw.split(',').map(s => ({ name: s.trim() })).filter(s => s.name) : [];
  const body = {
    vehicle_id:   vehicleId,
    repair_date:  date,
    repair_type:  type,
    act_no:       document.getElementById('rf_act').value.trim(),
    technician_id:document.getElementById('rf_tech').value || null,
    engineer_id:  document.getElementById('rf_eng').value || null,
    description:  document.getElementById('rf_desc').value.trim(),
    cost:         document.getElementById('rf_cost').value || 0,
    repair_status:document.getElementById('rf_status').value,
    parts,
  };
  try {
    await api('/api/vehicle-repairs', { method:'POST', body:JSON.stringify(body) });
    toast('Засвар бүртгэгдлаа');
    hseCloseRepair();
    await hseTab(_tab);
  } catch(e) { toast(e.message || 'Алдаа'); }
}

async function hseRepDone(id, vehicleId) {
  try {
    await api(`/api/vehicle-repairs/${id}/status`, { method:'PATCH', body:JSON.stringify({ repair_status:'Дууссан', vehicle_id:vehicleId }) });
    toast('Засвар дууссан гэж тэмдэглэгдлаа');
    await hseTab(_tab);
  } catch(e) { toast(e.message || 'Алдаа'); }
}

async function hseDelRepair(id) {
  if (!confirm('Засварын бүртгэл устгах уу?')) return;
  try {
    await api(`/api/vehicle-repairs/${id}`, { method:'DELETE' });
    toast('Устгагдлаа');
    await hseTab(_tab);
  } catch(e) { toast(e.message || 'Алдаа'); }
}

// ── Misc Actions ──────────────────────────────────────────────

function hseRiskFilter(v, type) { window._hseRiskFilterFn && window._hseRiskFilterFn(v, type); }

function hseVehSearch(q) {
  const filtered = q ? _vehicles.filter(v =>
    v.plate_no.toLowerCase().includes(q.toLowerCase()) ||
    v.vehicle_type.toLowerCase().includes(q.toLowerCase()) ||
    (v.brand||'').toLowerCase().includes(q.toLowerCase()) ||
    (v.model||'').toLowerCase().includes(q.toLowerCase())
  ) : _vehicles;
  const grid = document.getElementById('hseVehGrid');
  if (grid) grid.innerHTML = renderVehCards(filtered);
}

function hseViewImg(url) {
  const win = window.open('', '_blank', 'width=800,height=600');
  win.document.write(`<html><body style="margin:0;background:#000;display:flex;align-items:center;justify-content:center;height:100vh">
    <img src="${url}" style="max-width:100%;max-height:100%;object-fit:contain">
  </body></html>`);
}

function hsePrint() {
  const content = document.getElementById('hseContent')?.innerHTML || '';
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>ХАБЭА Тайлан — Чойбалсан хөгжил ОНӨҮГ</title>
    <style>*{box-sizing:border-box;margin:0;padding:0;font-family:'Segoe UI',Arial,sans-serif}
    body{padding:20px;font-size:12px;color:#111}
    table{width:100%;border-collapse:collapse}
    th,td{padding:6px 10px;border:1px solid #e2e6ed;text-align:left;font-size:11px}
    th{background:#f8fafc;font-weight:700}
    h1{font-size:16px;font-weight:800;margin-bottom:6px}
    .no-print{display:none}
    </style>
  </head><body>
    <div style="text-align:center;margin-bottom:16px;border-bottom:2px solid #111;padding-bottom:12px">
      <h1>🦺 ХАБЭА · Техник хэрэгслийн удирдлагын тайлан</h1>
      <div style="font-size:11px;color:#666">Чойбалсан хөгжил ОНӨҮГ · Хэвлэсэн: ${new Date().toLocaleString('mn-MN')}</div>
    </div>
    ${content}
    <script>window.onload=()=>{window.print();window.close()}<\/script>
  </body></html>`);
  win.document.close();
}

// ── Window Exports ────────────────────────────────────────────

Object.assign(window, {
  safety, hseTab,
  hseOpenRisk, hseCloseRisk, hseSaveRisk, hsePpeToggle,
  hseUploadImg, hseUploadBeforeImg, hseUploadAfterImg,
  hseCalcScore, hseAutoDeadline,
  hseLocInit, hseLocShow, hseLocFilter, hseLocSelect, hseLocHide,
  hseLocSetCat, hseLocSetBag,
  hseRiskStatus, hseDelRisk, hseRiskFilter, hseMyFilter: () => {}, hseRiskWorkflow,
  hseLoadComments, hseAddComment, hseDelComment,
  hseToggleDetail: () => {},
  hseOpenVeh, hseEditVeh, hseCloseVeh, hseSaveVeh, hseDelVeh,
  hseVehSearch,
  hseOpenDailyInsp, hseOpenWeeklyInsp, hseOpenMonthlyInsp, hseCloseInsp,
  hseDailyVehicleChanged,
  hseSaveDailyInsp, hseSaveWeeklyInsp, hseSaveMonthlyInsp,
  hseReviewDaily, hseApproveMonthly,
  hseItemToggle,
  hseOpenRepair, hseCloseRepair, hseSaveRepair, hseRepDone, hseDelRepair,
  hseRepFilter: () => {},
  hseViewImg, hsePrint,
  hseInspSub: () => {},
});
