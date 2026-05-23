import { state, api, toast, today } from './common.js';

let _works = [], _risks = [], _vehicles = [];

// ── Main entry ────────────────────────────────────────────────

export async function eng_hub() {
  document.getElementById('main').innerHTML =
    `<div style="padding:40px;text-align:center;color:#94a3b8">Уншиж байна...</div>`;
  await _load();
  _render();
}

async function _load() {
  try {
    [_works, _risks, _vehicles] = await Promise.all([
      api('/api/work-logs'),
      api('/api/safety-reports'),
      api('/api/vehicles'),
    ]);
  } catch { _works = []; _risks = []; _vehicles = []; }
}

// ── Render ────────────────────────────────────────────────────

function _render() {
  const pending     = _works.filter(w => w.status === 'Дууссан гэж илгээсэн');
  const rejected    = _works.filter(w => w.status === 'Буцаагдсан');
  const active      = _works.filter(w => ['Явцтай','Эхэлсэн'].includes(w.status));
  const engApproved = _works.filter(w => w.status === 'Инженер баталсан');
  const closed      = _works.filter(w => w.status === 'Хаагдсан');

  const openRisks   = _risks.filter(r => (r.workflow_status || 'Шинэ') !== 'Хаасан');
  const critRisks   = openRisks.filter(r => ['Маш өндөр','Өндөр'].includes(r.risk_level));
  const inRepair    = _vehicles.filter(v => v.status === 'Засварт' || v.status === 'Их засвартай');
  // Risks specifically assigned to this engineer that are still "Шинэ"
  const myNewRisks  = _risks.filter(r =>
    r.assigned_to === state.me?.id && (r.workflow_status || 'Шинэ') === 'Шинэ'
  );

  const thisM = today().slice(0, 7);
  const thisMonth = _works.filter(w => (w.work_date || '').startsWith(thisM));
  const doneThisM  = thisMonth.filter(w => w.status === 'Хаагдсан').length;

  const el = document.getElementById('main');
  el.innerHTML = `
  <div style="max-width:1400px;margin:0 auto">

    <!-- Header -->
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px;gap:10px;flex-wrap:wrap">
      <div>
        <h1 style="margin:0;font-size:20px;font-weight:800;color:#1e293b">🔧 Ерөнхий Инженерийн Самбар</h1>
        <div style="font-size:12px;color:#667085;margin-top:3px">${escHtml(state.me.full_name)} · ${today()}</div>
      </div>
      <button onclick="show('work')" class="btn sm secondary" style="font-size:12px">📅 Ажлын Gantt нээх</button>
    </div>

    <!-- KPI row -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-bottom:20px">
      ${_kpi('Батлах хүлээж буй', pending.length,     '#dc2626', '⏳', pending.length > 0 ? 'Яаралтай!' : 'Хоосон')}
      ${_kpi('Явцтай ажлууд',     active.length,      '#2563eb', '🔄', 'Идэвхтэй')}
      ${_kpi('ХАБЭА хүлээж буй',  engApproved.length, '#7c3aed', '🦺', 'Инженер баталсан')}
      ${_kpi('Буцаагдсан',        rejected.length,    '#ea580c', '↩', 'Засвар шаардлагатай')}
      ${_kpi('Хаагдсан (сар)',    doneThisM,          '#16a34a', '✅', thisM + ' сард')}
      ${_kpi('Нээлттэй эрсдэл',   openRisks.length,   '#d97706', '⚠️', 'Шүүмжлэлтэй: ' + critRisks.length)}
    </div>

    <!-- My new risks alert -->
    ${myNewRisks.length ? `
    <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:14px 18px;margin-bottom:16px;border-left:4px solid #ea580c">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="font-size:13px;font-weight:800;color:#c2410c">🚨 Таны байршилд шинэ ХАБЭА эрсдэл бүртгэгдсэн — ${myNewRisks.length} эрсдэл</div>
        <button onclick="show('safety')" style="padding:4px 12px;border-radius:7px;font-size:11px;font-weight:700;background:#ea580c;color:#fff;border:none;cursor:pointer">Бүгдийг харах →</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${myNewRisks.slice(0,5).map(r => {
          const COLORS = {'Маш өндөр':['#fee2e2','#dc2626'],'Өндөр':['#ffedd5','#ea580c'],'Дунд':['#fef9c3','#ca8a04'],'Бага':['#dcfce7','#16a34a']};
          const [bg, color] = COLORS[r.risk_level] || ['#f1f5f9','#64748b'];
          return `<div style="display:flex;align-items:center;gap:10px;background:#fff;border-radius:8px;padding:8px 12px;border:1px solid #fed7aa">
            <span style="padding:2px 9px;border-radius:20px;font-size:10px;font-weight:800;background:${bg};color:${color};flex-shrink:0">${escHtml(r.risk_level)}</span>
            <div style="flex:1;min-width:0">
              <div style="font-size:12px;font-weight:700;color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(r.location||'—')}</div>
              <div style="font-size:10px;color:#94a3b8">${escHtml(r.risk_type||'—')} · ${(r.report_date||'').slice(0,10)} · ${escHtml(r.creator_name||'—')}</div>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>` : ''}

    <!-- Main 2-col grid -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">

      <!-- Pending confirmations -->
      <div style="background:#fff;border:1px solid #e2e6ed;border-radius:14px;overflow:hidden;border-top:3px solid #dc2626">
        <div style="padding:13px 16px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;justify-content:space-between">
          <div style="font-size:13px;font-weight:800;color:#1e293b">⏳ Батлах шаардлагатай</div>
          <span style="font-size:11px;padding:2px 10px;border-radius:20px;background:${pending.length?'#fee2e2':'#f0fdf4'};color:${pending.length?'#dc2626':'#16a34a'};font-weight:700">${pending.length}</span>
        </div>
        <div style="max-height:360px;overflow-y:auto">
          ${pending.length ? pending.map(_pendingCard).join('') : _empty('Батлах ажил байхгүй ✓')}
        </div>
      </div>

      <!-- Active work status -->
      <div style="background:#fff;border:1px solid #e2e6ed;border-radius:14px;overflow:hidden;border-top:3px solid #2563eb">
        <div style="padding:13px 16px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;justify-content:space-between">
          <div style="font-size:13px;font-weight:800;color:#1e293b">🔄 Явцтай ажлуудын байдал</div>
          <span style="font-size:11px;color:#94a3b8">${active.length} ажил</span>
        </div>
        <div style="max-height:360px;overflow-y:auto">
          ${active.length ? active.map(_activeCard).join('') : _empty('Явцтай ажил байхгүй')}
        </div>
      </div>
    </div>

    <!-- Second row -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">

      <!-- ХАБЭА waiting (eng confirmed) -->
      <div style="background:#fff;border:1px solid #e2e6ed;border-radius:14px;overflow:hidden;border-top:3px solid #7c3aed">
        <div style="padding:13px 16px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;justify-content:space-between">
          <div style="font-size:13px;font-weight:800;color:#1e293b">🦺 ХАБЭА дуусгалт хүлээж буй</div>
          <span style="font-size:11px;padding:2px 10px;border-radius:20px;background:#f5f3ff;color:#7c3aed;font-weight:700">${engApproved.length}</span>
        </div>
        <div style="max-height:280px;overflow-y:auto">
          ${engApproved.length ? engApproved.map(_habeaWaitCard).join('') : _empty('ХАБЭА хүлээж буй ажил байхгүй ✓')}
        </div>
      </div>

      <!-- Open risks -->
      <div style="background:#fff;border:1px solid #e2e6ed;border-radius:14px;overflow:hidden;border-top:3px solid #d97706">
        <div style="padding:13px 16px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;justify-content:space-between">
          <div style="font-size:13px;font-weight:800;color:#1e293b">⚠️ Нээлттэй эрсдэлүүд</div>
          <span style="font-size:11px;color:#94a3b8">${openRisks.length} нийт · <b style="color:#dc2626">${critRisks.length}</b> шүүмжлэлтэй</span>
        </div>
        <div style="max-height:280px;overflow-y:auto">
          ${openRisks.length
            ? (critRisks.length ? critRisks : openRisks).slice(0, 10).map(_riskCard).join('')
            : _empty('Нээлттэй эрсдэл байхгүй ✓')}
        </div>
      </div>
    </div>

    <!-- Rejected work -->
    ${rejected.length ? `
    <div style="background:#fff;border:1px solid #fecaca;border-radius:14px;overflow:hidden;margin-bottom:16px;border-top:3px solid #ea580c">
      <div style="padding:13px 16px;border-bottom:1px solid #fff1f2;display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:13px;font-weight:800;color:#dc2626">↩ Буцаагдсан ажлууд — засвар шаардлагатай</div>
        <span style="font-size:11px;padding:2px 10px;border-radius:20px;background:#fee2e2;color:#dc2626;font-weight:700">${rejected.length}</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">
        ${rejected.slice(0, 6).map(_rejectedCard).join('')}
      </div>
    </div>` : ''}

  </div>

  <!-- Action modal -->
  <div id="engActModal"
    style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:500;align-items:flex-start;justify-content:center;padding:24px 12px;overflow-y:auto"
    onclick="document.getElementById('engActModal').style.display='none'">
    <div style="background:#fff;border-radius:16px;width:min(660px,98vw);box-shadow:0 24px 70px rgba(0,0,0,.3);margin:auto" onclick="event.stopPropagation()">
      <div id="engActModalBody"></div>
    </div>
  </div>`;
}

// ── Card renderers ────────────────────────────────────────────

function _pendingCard(w) {
  const prog = w.progress || 0;
  const progColor = prog === 100 ? '#16a34a' : prog >= 60 ? '#2563eb' : '#d97706';
  return `<div onclick="engOpenDetail(${w.id})"
    style="padding:12px 16px;border-bottom:1px solid #f1f5f9;cursor:pointer;transition:background .15s"
    onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
    <div style="display:flex;align-items:flex-start;gap:10px">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700;color:#1e293b;margin-bottom:2px">${escHtml(w.title)}</div>
        <div style="font-size:10px;color:#94a3b8">${escHtml(w.category||'—')} · ${escHtml(w.location||'—')}</div>
        <div style="font-size:11px;color:#475569;margin-top:3px">👷 ${escHtml(w.assigned_name||'—')} · ${(w.work_date||'').slice(0,10)}</div>
        <div style="margin-top:6px;height:4px;background:#f1f5f9;border-radius:4px;overflow:hidden">
          <div style="height:100%;width:${prog}%;background:${progColor};border-radius:4px"></div>
        </div>
      </div>
      <div style="flex-shrink:0;text-align:right">
        <div style="font-size:18px;font-weight:900;color:${progColor};line-height:1">${prog}%</div>
        <div style="font-size:9px;color:#94a3b8;margin-top:2px">дарж харах</div>
      </div>
    </div>
  </div>`;
}

function _activeCard(w) {
  const [bg, color] = _stColor(w.status);
  const prog = w.progress || 0;
  return `<div style="padding:10px 16px;border-bottom:1px solid #f8fafc">
    <div style="display:flex;align-items:center;gap:8px">
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:600;color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(w.title)}</div>
        <div style="font-size:10px;color:#94a3b8">${escHtml(w.category||'—')} · ${escHtml(w.assigned_name||'—')}</div>
        <div style="margin-top:5px;height:4px;background:#f1f5f9;border-radius:4px;overflow:hidden">
          <div style="height:100%;width:${prog}%;background:${color};border-radius:4px"></div>
        </div>
      </div>
      <div style="flex-shrink:0;text-align:right">
        <div style="font-size:13px;font-weight:800;color:${color}">${prog}%</div>
        <span style="font-size:10px;padding:2px 8px;border-radius:20px;font-weight:700;background:${bg};color:${color}">${w.status}</span>
      </div>
    </div>
  </div>`;
}

function _habeaWaitCard(w) {
  const confDate = (w.confirmed_at || '').slice(0, 10);
  return `<div style="padding:10px 16px;border-bottom:1px solid #f8fafc;display:flex;align-items:center;gap:8px">
    <div style="flex:1;min-width:0">
      <div style="font-size:12px;font-weight:600;color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(w.title)}</div>
      <div style="font-size:10px;color:#94a3b8">${escHtml(w.location||'—')} · Батласан: ${escHtml(w.confirmed_name||'—')} ${confDate}</div>
      <div style="font-size:10px;color:#7c3aed;font-weight:600;margin-top:2px">🦺 ХАБЭА-н дуусгалтыг хүлээж байна</div>
    </div>
    <div style="font-size:14px;font-weight:900;color:#7c3aed;flex-shrink:0">${w.progress||0}%</div>
  </div>`;
}

function _riskCard(r) {
  const COLORS = { 'Маш өндөр':['#fee2e2','#dc2626'], 'Өндөр':['#ffedd5','#ea580c'], 'Дунд':['#fef9c3','#ca8a04'], 'Бага':['#dcfce7','#16a34a'] };
  const [bg, color] = COLORS[r.risk_level] || ['#f1f5f9','#64748b'];
  const wf = r.workflow_status || 'Шинэ';
  return `<div style="padding:10px 16px;border-bottom:1px solid #f8fafc;display:flex;align-items:center;gap:8px">
    <div style="flex:1;min-width:0">
      <div style="font-size:12px;font-weight:600;color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(r.location||'—')}</div>
      <div style="font-size:10px;color:#94a3b8">${escHtml(r.risk_type||'—')} · ${(r.report_date||'').slice(0,10)} · ${escHtml(r.assigned_name||'—')}</div>
    </div>
    <div style="flex-shrink:0;display:flex;flex-direction:column;align-items:flex-end;gap:3px">
      <span style="padding:2px 9px;border-radius:20px;font-size:10px;font-weight:700;background:${bg};color:${color}">${r.risk_level}</span>
      <span style="font-size:10px;color:#64748b">${wf}</span>
    </div>
  </div>`;
}

function _rejectedCard(w) {
  return `<div style="padding:12px 16px;border-bottom:1px solid #fff1f2">
    <div style="font-size:12px;font-weight:700;color:#dc2626;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(w.title)}</div>
    <div style="font-size:10px;color:#94a3b8;margin-top:2px">${escHtml(w.assigned_name||'—')} · ${(w.work_date||'').slice(0,10)}</div>
    ${w.reject_note ? `<div style="font-size:11px;color:#dc2626;margin-top:4px;padding:4px 8px;background:#fff1f2;border-radius:5px">"${escHtml(w.reject_note)}"</div>` : ''}
  </div>`;
}

// ── Helpers ───────────────────────────────────────────────────

function _kpi(label, value, color, icon, sub) {
  return `<div style="background:#fff;border:1px solid #e2e6ed;border-radius:12px;padding:14px 16px;border-top:3px solid ${color}">
    <div style="font-size:11px;color:#667085;font-weight:600;margin-bottom:3px">${label}</div>
    <div style="font-size:26px;font-weight:900;color:${color};line-height:1">${value}</div>
    <div style="font-size:10px;color:#94a3b8;margin-top:3px">${icon} ${sub}</div>
  </div>`;
}

function _empty(msg) {
  return `<div style="padding:28px;text-align:center;color:#16a34a;font-size:12px;font-weight:600">${msg}</div>`;
}

function _stColor(s) {
  return ({
    'Явцтай':               ['#dbeafe','#2563eb'],
    'Эхэлсэн':              ['#dcfce7','#16a34a'],
    'Буцаагдсан':           ['#fee2e2','#dc2626'],
    'Дууссан гэж илгээсэн': ['#fef9c3','#ca8a04'],
    'Инженер баталсан':     ['#ede9fe','#7c3aed'],
    'Хаагдсан':             ['#f0fdf4','#15803d'],
  }[s] || ['#f1f5f9','#374151']);
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Detail + approval modal ───────────────────────────────────

async function engOpenDetail(id) {
  const m = document.getElementById('engActModal');
  const b = document.getElementById('engActModalBody');
  if (!m || !b) return;
  b.innerHTML = `<div style="padding:28px;text-align:center;color:#94a3b8">Уншиж байна...</div>`;
  m.style.display = 'flex';

  let w, execs = [], ptw = [];
  try {
    [w, execs, ptw] = await Promise.all([
      api(`/api/work-logs/${id}/approval-sheet`),
      api(`/api/work-logs/${id}/executions`).catch(() => []),
      api(`/api/work-logs/${id}/safety-reports`).catch(() => []),
    ]);
  } catch(e) { b.innerHTML = `<div style="padding:28px;color:#dc2626">Алдаа: ${escHtml(e.message)}</div>`; return; }

  const prog = w.progress || 0;
  const progColor = prog === 100 ? '#16a34a' : prog >= 60 ? '#2563eb' : '#d97706';

  const row = (label, val) => val
    ? `<div style="display:flex;gap:8px;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:12px">
        <div style="width:130px;flex-shrink:0;color:#64748b;font-weight:600">${label}</div>
        <div style="color:#1e293b">${val}</div>
       </div>` : '';

  // ── Warnings ─────────────────────────────────────────────────
  const warns = [];
  if (!execs.length)
    warns.push({ level: 'error', msg: 'Гүйцэтгэлийн бүртгэл огт байхгүй байна — ажил хийгдсэн эсэх нь тодорхойгүй!' });
  else if (execs.every(e => !(e.description||'').trim()))
    warns.push({ level: 'warn', msg: 'Гүйцэтгэлийн бүртгэлд тайлбар байхгүй байна' });

  const totalExecPhotos = execs.reduce((s, e) => s + (e.photo_count || 0), 0);
  const totalPhotos = (w.photo_count || 0) + totalExecPhotos;
  if (totalPhotos === 0)
    warns.push({ level: 'warn', msg: 'Зураг хавсаргаагүй байна — ажлын талбайн нотолгоо дутуу' });
  if (!w.assigned_to)
    warns.push({ level: 'warn', msg: 'Гүйцэтгэгч тодорхойгүй — хэн хийснийг баталгаажуулна уу' });

  const warnHtml = warns.length ? `
    <div style="margin-bottom:14px;border-radius:10px;overflow:hidden;border:1px solid ${warns.some(x=>x.level==='error')?'#fca5a5':'#fde68a'}">
      <div style="padding:7px 12px;background:${warns.some(x=>x.level==='error')?'#dc2626':'#d97706'};color:#fff;font-size:11px;font-weight:800">
        ⚠️ АНХААРУУЛГА — Батлахаасаа өмнө шалгана уу
      </div>
      ${warns.map(wn => `<div style="padding:7px 12px;background:${wn.level==='error'?'#fff1f2':'#fffbeb'};font-size:12px;color:${wn.level==='error'?'#be123c':'#92400e'};display:flex;gap:7px;align-items:flex-start;border-bottom:1px solid ${wn.level==='error'?'#fecdd3':'#fde68a'}">
        <span style="flex-shrink:0">${wn.level==='error'?'🔴':'🟡'}</span>
        <span>${wn.msg}</span>
      </div>`).join('')}
    </div>` : `<div style="margin-bottom:14px;padding:8px 12px;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;font-size:11px;color:#15803d;font-weight:600">
      ✅ Бүх шаардлага хангагдсан — батлахад бэлэн
    </div>`;

  const execHtml = execs.length
    ? execs.map(e => `<div style="padding:6px 10px;background:#f8fafc;border-radius:6px;font-size:11px;margin-bottom:4px;border-left:3px solid ${e.photo_count>0?'#86efac':'#93c5fd'}">
        <div style="display:flex;justify-content:space-between">
          <div style="font-weight:600;color:#1e293b">${escHtml(e.exec_date||'')} · ${escHtml(e.worker_name||e.worker_names||'—')}</div>
          ${e.photo_count>0?`<span style="font-size:10px;color:#16a34a">📷 ${e.photo_count}</span>`:'<span style="font-size:10px;color:#f59e0b">📷 0</span>'}
        </div>
        <div style="color:${(e.description||'').trim()?'#475569':'#f59e0b'};margin-top:2px">${escHtml(e.description||'— тайлбар байхгүй')}</div>
      </div>`).join('')
    : `<div style="font-size:11px;color:#dc2626;font-weight:600;padding:8px 10px;background:#fff1f2;border-radius:6px">🔴 Гүйцэтгэлийн бүртгэл байхгүй</div>`;

  const ptwHtml = ptw.length
    ? ptw.map(p => `<div style="font-size:11px;padding:4px 8px;background:#f5f3ff;border-radius:5px;margin-bottom:3px;border-left:3px solid #7c3aed">
        <b>${escHtml(p.title||'PTW')}</b> · ${escHtml(p.status||'—')}
      </div>`).join('')
    : '';

  b.innerHTML = `
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#1e40af,#2563eb);padding:18px 22px;border-radius:16px 16px 0 0;display:flex;align-items:flex-start;justify-content:space-between">
      <div>
        <div style="color:#bfdbfe;font-size:10px;font-weight:700;letter-spacing:.06em;margin-bottom:4px">АЖЛЫН БАТЛАЛТЫН ХҮСЭЛТ</div>
        <div style="color:#fff;font-size:15px;font-weight:800;line-height:1.3">${escHtml(w.title)}</div>
        <div style="color:#93c5fd;font-size:11px;margin-top:3px">${escHtml(w.category||'—')} · ${escHtml(w.location||'—')}</div>
      </div>
      <button onclick="document.getElementById('engActModal').style.display='none'"
        style="border:none;background:rgba(255,255,255,.2);color:#fff;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:13px;flex-shrink:0">✕</button>
    </div>

    <div style="padding:20px 22px;max-height:70vh;overflow-y:auto">

      <!-- Progress -->
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;padding:10px 14px;background:#f8fafc;border-radius:10px">
        <div style="flex:1">
          <div style="font-size:10px;color:#64748b;font-weight:700;margin-bottom:4px">ГҮЙЦЭТГЭЛИЙН ЯВЦ</div>
          <div style="height:8px;background:#e2e8f0;border-radius:8px;overflow:hidden">
            <div style="height:100%;width:${prog}%;background:${progColor};border-radius:8px;transition:width .4s"></div>
          </div>
        </div>
        <div style="font-size:22px;font-weight:900;color:${progColor}">${prog}%</div>
      </div>

      <!-- Warnings -->
      ${warnHtml}

      <!-- Work info -->
      <div style="margin-bottom:14px">
        ${row('Гүйцэтгэгч', escHtml(w.assigned_name||'—'))}
        ${row('Бүртгэсэн', escHtml(w.created_name||'—'))}
        ${row('Ажлын огноо', `${w.start_date||'—'} → ${w.end_date||'—'}`)}
        ${row('Байршил', escHtml(w.location||'—'))}
        ${w.description ? row('Тайлбар', escHtml(w.description)) : ''}
      </div>

      <!-- Executions -->
      <div style="margin-bottom:14px">
        <div style="font-size:11px;font-weight:700;color:#374151;margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em">📋 Гүйцэтгэлийн бүртгэл (${execs.length})</div>
        ${execHtml}
      </div>

      ${ptwHtml ? `<div style="margin-bottom:14px">
        <div style="font-size:11px;font-weight:700;color:#7c3aed;margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em">🛂 PTW бүртгэл</div>
        ${ptwHtml}
      </div>` : ''}

      ${w.habea_pre_status === 'approved' ? `<div style="margin-bottom:14px;padding:8px 12px;background:#e0f2fe;border-radius:8px;font-size:11px;color:#0369a1">
        🦺 ХАБЭА эхлэлтийн зөвшөөрөл: <b>${escHtml(w.habea_pre_name||'—')}</b> · ${(w.habea_pre_at||'').slice(0,10)}
        ${w.habea_pre_risks ? `<br>Эрсдэл: ${escHtml(w.habea_pre_risks)}` : ''}
      </div>` : ''}

      <!-- Divider -->
      <div style="border-top:2px solid #f1f5f9;margin:16px 0"></div>

      <!-- Approval form -->
      <div style="font-size:13px;font-weight:800;color:#1e293b;margin-bottom:10px">⚖️ Ерөнхий инженерийн шийдвэр</div>
      <label style="font-size:11px;color:#16a34a;font-weight:700;display:block;margin-bottom:4px">
        Баталгааны тэмдэглэл <span style="color:#dc2626">*</span>
      </label>
      <textarea id="engActNote" class="input" rows="3"
        style="resize:vertical;width:100%;box-sizing:border-box;border-color:#86efac;margin-bottom:4px"
        placeholder="Ажлын гүйцэтгэлийн үнэлгээ, батлах үндэслэл — тодорхой бичнэ үү..."></textarea>
      <div style="font-size:10px;color:#6b7280;margin-bottom:14px">⚠️ Энэ тэмдэглэл хуулийн баримт болно</div>

      <div style="display:flex;gap:8px">
        <button onclick="engDoConfirm(${id})"
          style="flex:2;padding:11px;border-radius:9px;border:none;background:#16a34a;color:#fff;cursor:pointer;font-size:14px;font-weight:800">✓ Батлах</button>
        <button onclick="engDoReject(${id})"
          style="flex:1;padding:11px;border-radius:9px;border:none;background:#fee2e2;color:#dc2626;cursor:pointer;font-size:13px;font-weight:700">↩ Буцаах</button>
      </div>
    </div>`;
}

// ── Simple modal helper ───────────────────────────────────────

function _showModal(html) {
  const m = document.getElementById('engActModal');
  const b = document.getElementById('engActModalBody');
  if (!m || !b) return;
  b.innerHTML = html;
  m.style.display = 'flex';
}

function engOpenConfirm(id, title) {
  _showModal(`
    <div style="font-size:15px;font-weight:800;margin-bottom:6px">✓ Ажил батлах</div>
    <div style="font-size:12px;color:#475569;margin-bottom:14px;padding:8px 10px;background:#f0fdf4;border-radius:6px">${title}</div>
    <div style="margin-bottom:16px">
      <label style="font-size:11px;color:#16a34a;font-weight:700;display:block;margin-bottom:4px">Баталгааны тэмдэглэл <span style="color:#dc2626">*</span></label>
      <textarea id="engActNote" class="input" rows="3" style="resize:vertical;width:100%;box-sizing:border-box;border-color:#86efac"
        placeholder="Ажлын байдал, гүйцэтгэлийн үнэлгээ, батлах үндэслэлийг бичнэ үү..."></textarea>
      <div style="font-size:10px;color:#6b7280;margin-top:3px">⚠️ Энэ тэмдэглэл хуулийн баримт болно — тодорхой бичнэ үү</div>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button onclick="document.getElementById('engActModal').style.display='none'"
        style="padding:8px 18px;border-radius:8px;border:1px solid #e2e6ed;background:#fff;cursor:pointer;font-size:13px">Болих</button>
      <button onclick="engDoConfirm(${id})"
        style="padding:8px 22px;border-radius:8px;border:none;background:#16a34a;color:#fff;cursor:pointer;font-size:13px;font-weight:700">✓ Батлах</button>
    </div>`);
}

function engOpenReject(id, title) {
  _showModal(`
    <div style="font-size:15px;font-weight:800;margin-bottom:6px;color:#dc2626">↩ Ажил буцаах</div>
    <div style="font-size:12px;color:#475569;margin-bottom:14px;padding:8px 10px;background:#fff1f2;border-radius:6px">${title}</div>
    <div style="margin-bottom:16px">
      <label style="font-size:11px;color:#667085;font-weight:600;display:block;margin-bottom:4px">Буцаасан шалтгаан *</label>
      <textarea id="engActNote" class="input" rows="3" style="resize:vertical;width:100%;box-sizing:border-box"
        placeholder="Яагаад буцааж байгаагаа бичнэ үү..."></textarea>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button onclick="document.getElementById('engActModal').style.display='none'"
        style="padding:8px 18px;border-radius:8px;border:1px solid #e2e6ed;background:#fff;cursor:pointer;font-size:13px">Болих</button>
      <button onclick="engDoReject(${id})"
        style="padding:8px 22px;border-radius:8px;border:none;background:#dc2626;color:#fff;cursor:pointer;font-size:13px;font-weight:700">↩ Буцаах</button>
    </div>`);
}

async function engDoConfirm(id) {
  const note = document.getElementById('engActNote')?.value?.trim() || '';
  if (!note) { toast('Баталгааны тэмдэглэл заавал бичих шаардлагатай'); return; }
  try {
    const fd = new FormData();
    fd.append('confirm_note', note);
    const res = await fetch(`/api/work-logs/${id}/confirm`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('token') || '') },
      body: fd
    });
    if (!res.ok) { const e = await res.json(); toast(e.error || 'Алдаа'); return; }
    document.getElementById('engActModal').style.display = 'none';
    toast('✅ Ажил амжилттай батлагдлаа! Акт хэвлэхийг санал болгоно.');
    await _load();
    _render();
    printApprovalSheet(id);
  } catch(e) { toast(e.message || 'Алдаа'); }
}

async function engDoReject(id) {
  let note = document.getElementById('engActNote')?.value?.trim() || '';
  if (!note) {
    note = prompt('Буцаасан шалтгаан бичнэ үү:');
    if (!note?.trim()) { toast('Буцаасан шалтгаан заавал бичих шаардлагатай'); return; }
  }
  try {
    await api(`/api/work-logs/${id}/reject`, { method: 'POST', body: JSON.stringify({ note }) });
    document.getElementById('engActModal').style.display = 'none';
    toast('Ажил буцаагдлаа');
    await _load();
    _render();
  } catch(e) { toast(e.message || 'Алдаа'); }
}

// ── Window exports ────────────────────────────────────────────

Object.assign(window, {
  eng_hub,
  engOpenDetail,
  engOpenConfirm, engOpenReject,
  engDoConfirm, engDoReject,
});
