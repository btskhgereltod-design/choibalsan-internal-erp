import { state, api, toast, today } from './common.js';

let _works = [], _risks = [];

// ── Main entry ────────────────────────────────────────────────

let _activeTab = 'dashboard';

export async function habea_hub(tab) {
  if (tab) _activeTab = tab;
  if (_activeTab === 'records') {
    // Render safety module into main, then inject tab bar on top
    if (typeof window.safety === 'function') {
      await window.safety();
      _injectTabBar('records');
    }
    return;
  }
  document.getElementById('main').innerHTML =
    `<div style="padding:40px;text-align:center;color:#94a3b8">Уншиж байна...</div>`;
  await _load();
  _render();
}

function _injectTabBar(active) {
  const main = document.getElementById('main');
  if (!main) return;
  const bar = document.createElement('div');
  bar.id = 'habeaTabBar';
  bar.innerHTML = _tabBarHtml(active);
  main.insertBefore(bar, main.firstChild);
}

function _tabBarHtml(active) {
  const tab = (key, label) => `
    <button onclick="habea_hub('${key}')"
      style="padding:10px 20px;border:none;cursor:pointer;font-size:13px;font-weight:700;background:transparent;
             color:${active===key?'#7c3aed':'#94a3b8'};
             border-bottom:${active===key?'3px solid #7c3aed':'3px solid transparent'};
             margin-bottom:-2px;transition:color .15s">
      ${label}
    </button>`;
  return `<div style="display:flex;gap:0;padding:0 20px;border-bottom:2px solid #e2e8f0;background:#fff;position:sticky;top:0;z-index:10;box-shadow:0 1px 4px rgba(0,0,0,.06)">
    ${tab('dashboard','🏠 Самбар')}
    ${tab('records','📋 Эрсдэл & PTW')}
  </div>`;
}

async function _load() {
  try {
    [_works, _risks] = await Promise.all([
      api('/api/work-logs'),
      api('/api/safety-reports'),
    ]);
  } catch { _works = []; _risks = []; }
}

// ── Render ────────────────────────────────────────────────────

function _render() {
  const pendingPost  = _works.filter(w => w.status === 'Инженер баталсан');
  const needsPre     = _works.filter(w =>
    ['Явцтай','Эхэлсэн'].includes(w.status) && w.habea_pre_status !== 'approved');
  const preApproved  = _works.filter(w =>
    ['Явцтай','Эхэлсэн'].includes(w.status) && w.habea_pre_status === 'approved');
  const thisM = today().slice(0, 7);
  const doneThisM = _works.filter(w => w.status === 'Хаагдсан' && (w.habea_post_at||'').startsWith(thisM)).length;

  const openRisks = _risks.filter(r => (r.workflow_status||'Шинэ') !== 'Хаасан');
  const critRisks = openRisks.filter(r => ['Маш өндөр','Өндөр'].includes(r.risk_level));
  const newRisks  = openRisks.filter(r => (r.workflow_status||'Шинэ') === 'Шинэ');

  const urgentBanner = pendingPost.length ? `
    <div style="display:flex;align-items:center;gap:12px;padding:11px 28px;background:#dc2626;color:#fff;font-size:13px;font-weight:800">
      <span style="font-size:18px">🚨</span>
      <span>${pendingPost.length} ажил таны ХАБЭА батлалтыг яаралтай хүлээж байна!</span>
      <span style="margin-left:auto;font-size:11px;font-weight:400;opacity:.85">↓ доорх жагсаалтаас харна уу</span>
    </div>` : '';

  const hkpi = (icon, val, label, sub, urgent=false) => `
    <div style="background:${urgent&&val>0?'rgba(220,38,38,.35)':'rgba(255,255,255,.13)'};border:1px solid ${urgent&&val>0?'rgba(252,165,165,.5)':'rgba(255,255,255,.22)'};border-radius:14px;padding:16px 18px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:10px">
        <span style="font-size:24px;line-height:1">${icon}</span>
        <span style="font-size:30px;font-weight:900;color:#fff;line-height:1">${val}</span>
      </div>
      <div style="font-size:11px;font-weight:700;color:rgba(255,255,255,.95);margin-bottom:3px">${label}</div>
      <div style="font-size:10px;color:rgba(255,255,255,.6)">${sub}</div>
    </div>`;

  document.getElementById('main').innerHTML =
    _tabBarHtml('dashboard') +
    urgentBanner +
  `<div style="background:#f5f3ff;min-height:100vh">

    <!-- ─── Hero Header ─────────────────────────────────────── -->
    <div style="background:linear-gradient(145deg,#3b0764,#5b21b6,#7c3aed);padding:24px 28px 36px">
      <div style="max-width:1400px;margin:0 auto">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:22px;gap:12px;flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:14px">
            <div style="width:48px;height:48px;background:rgba(255,255,255,.15);border:2px solid rgba(255,255,255,.25);border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0">🦺</div>
            <div>
              <div style="color:#c4b5fd;font-size:10px;font-weight:700;letter-spacing:.14em;margin-bottom:3px">ХАБЭА АЖЛЫН САМБАР</div>
              <div style="color:#fff;font-size:20px;font-weight:900;line-height:1.15">${escH(state.me.full_name)}</div>
              <div style="color:#a78bfa;font-size:11px;margin-top:4px">${today()}</div>
            </div>
          </div>
          <button onclick="habea_hub('records')"
            style="padding:10px 20px;border-radius:10px;border:2px solid rgba(255,255,255,.28);background:rgba(255,255,255,.1);color:#fff;cursor:pointer;font-size:12px;font-weight:700;transition:all .15s;white-space:nowrap"
            onmouseover="this.style.background='rgba(255,255,255,.2)'" onmouseout="this.style.background='rgba(255,255,255,.1)'">
            📋 Эрсдэл & PTW →
          </button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">
          ${hkpi('⏳', pendingPost.length, 'БАТЛАЛ ХҮЛЭЭЖ БУЙ',   pendingPost.length ? '⚡ Яаралтай шийдвэрлэнэ үү' : 'Дуусгасан байна ✓', true)}
          ${hkpi('🔐', needsPre.length,    'ЭХЛЭЛТ ЗӨВШӨӨРӨХ',    needsPre.length ? 'Pre-approval дутуу ажлууд' : 'Бүх ажил зөвшөөрөлтэй ✓')}
          ${hkpi('⚠️', openRisks.length,   'НЭЭЛТТЭЙ ЭРСДЭЛ',     `Шүүмжлэлтэй: ${critRisks.length} · Шинэ: ${newRisks.length}`)}
          ${hkpi('✅', doneThisM,           'САРЫН ХААГДСАН',       `${thisM} · Хяналтанд: ${preApproved.length}`)}
        </div>
      </div>
    </div>

    <!-- ─── Main content ────────────────────────────────────── -->
    <div style="max-width:1400px;margin:-16px auto 0;padding:0 28px 32px;position:relative;z-index:1">

      <!-- Pending post-approval — most important -->
      <div style="background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(109,40,217,.1);border:1px solid #ede9fe;margin-bottom:16px;overflow:hidden">
        <div style="padding:14px 20px;background:linear-gradient(90deg,#faf5ff,#f5f3ff);border-bottom:2px solid #ede9fe;display:flex;align-items:center;justify-content:space-between">
          <div style="display:flex;align-items:center;gap:10px">
            <div style="width:34px;height:34px;background:linear-gradient(135deg,#6d28d9,#7c3aed);border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:16px;box-shadow:0 2px 8px rgba(124,58,237,.35)">⏳</div>
            <div>
              <div style="font-size:13px;font-weight:800;color:#4c1d95">Дуусгалтын батлал шаардлагатай</div>
              <div style="font-size:10px;color:#7c3aed;margin-top:1px">Ерөнхий инженер баталсан — ХАБЭА-н шийдвэр хүлээж байна</div>
            </div>
          </div>
          <span style="min-width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:50%;font-size:13px;font-weight:900;background:${pendingPost.length?'#7c3aed':'#dcfce7'};color:${pendingPost.length?'#fff':'#16a34a'}">${pendingPost.length}</span>
        </div>
        <div style="max-height:360px;overflow-y:auto">
          ${pendingPost.length ? pendingPost.map(_pendingPostCard).join('') : _emptyState('⏳', 'Батлал хүлээж буй ажил байхгүй', 'Бүх дуусгалт батлагдсан байна ✓', '#16a34a')}
        </div>
      </div>

      <!-- Mid row: pre-approval + risks -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">

        <div style="background:#fff;border-radius:16px;box-shadow:0 2px 14px rgba(0,0,0,.06);border:1px solid ${needsPre.length?'#fecaca':'#e2e8f0'};overflow:hidden">
          <div style="padding:13px 18px;border-bottom:2px solid ${needsPre.length?'#fee2e2':'#f1f5f9'};display:flex;align-items:center;justify-content:space-between;background:${needsPre.length?'#fff7f7':'#f8fafc'}">
            <div style="display:flex;align-items:center;gap:8px">
              <div style="width:30px;height:30px;background:${needsPre.length?'#dc2626':'#cbd5e1'};border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:14px">🔐</div>
              <div>
                <div style="font-size:12px;font-weight:800;color:${needsPre.length?'#7f1d1d':'#374151'}">Эхлэлтийн зөвшөөрөл</div>
                <div style="font-size:10px;color:${needsPre.length?'#dc2626':'#94a3b8'};margin-top:1px">${needsPre.length?`${needsPre.length} ажил зөвшөөрөл хүлээж байна`:'Бүх ажил зөвшөөрөлтэй'}</div>
              </div>
            </div>
            <span style="min-width:24px;height:24px;display:flex;align-items:center;justify-content:center;border-radius:50%;font-size:11px;font-weight:900;background:${needsPre.length?'#dc2626':'#dcfce7'};color:${needsPre.length?'#fff':'#16a34a'}">${needsPre.length}</span>
          </div>
          <div style="max-height:310px;overflow-y:auto">
            ${needsPre.length ? needsPre.map(_needsPreCard).join('') : _emptyState('🔐', 'Бүх явцтай ажил зөвшөөрөлтэй', '', '#16a34a')}
          </div>
        </div>

        <div style="background:#fff;border-radius:16px;box-shadow:0 2px 14px rgba(0,0,0,.06);border:1px solid ${critRisks.length?'#fed7aa':'#e2e8f0'};overflow:hidden">
          <div style="padding:13px 18px;border-bottom:2px solid ${critRisks.length?'#fed7aa':'#f1f5f9'};display:flex;align-items:center;justify-content:space-between;background:${critRisks.length?'#fffbeb':'#f8fafc'}">
            <div style="display:flex;align-items:center;gap:8px">
              <div style="width:30px;height:30px;background:${openRisks.length?'#ea580c':'#cbd5e1'};border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:14px">⚠️</div>
              <div>
                <div style="font-size:12px;font-weight:800;color:${critRisks.length?'#7c2d12':'#374151'}">Нээлттэй эрсдэлүүд</div>
                <div style="font-size:10px;color:${openRisks.length?'#ea580c':'#94a3b8'};margin-top:1px">Нийт ${openRisks.length} · Шүүмжлэлтэй ${critRisks.length} · Шинэ ${newRisks.length}</div>
              </div>
            </div>
            <button onclick="habea_hub('records')" style="font-size:10px;padding:3px 10px;border:1px solid #e2e6ed;border-radius:6px;background:#fff;cursor:pointer;color:#64748b;font-weight:600">Бүгд →</button>
          </div>
          <div style="max-height:310px;overflow-y:auto">
            ${openRisks.length
              ? (critRisks.length ? critRisks : openRisks).slice(0,10).map(_riskCard).join('')
              : _emptyState('✅', 'Нээлттэй эрсдэл байхгүй', 'Бүх эрсдэл шийдвэрлэгдсэн', '#16a34a')}
          </div>
        </div>
      </div>

      <!-- Bottom: active monitored works -->
      <div style="background:#fff;border-radius:16px;box-shadow:0 2px 14px rgba(0,0,0,.06);border:1px solid #dbeafe;overflow:hidden">
        <div style="padding:13px 20px;border-bottom:2px solid #dbeafe;display:flex;align-items:center;justify-content:space-between;background:#f0f9ff">
          <div style="display:flex;align-items:center;gap:8px">
            <div style="width:30px;height:30px;background:#2563eb;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:14px">🔄</div>
            <div>
              <div style="font-size:12px;font-weight:800;color:#1e40af">Хяналтан доорх ажлууд</div>
              <div style="font-size:10px;color:#3b82f6;margin-top:1px">ХАБЭА зөвшөөрөл авсан идэвхтэй ажлууд</div>
            </div>
          </div>
          <span style="font-size:12px;font-weight:800;color:#2563eb">${preApproved.length}</span>
        </div>
        ${preApproved.length
          ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">${preApproved.map(_activeCard).join('')}</div>`
          : _emptyState('🔄', 'Хяналтан доорх ажил байхгүй', 'Зөвшөөрөл бүхий явцтай ажил алга', '#94a3b8')}
      </div>

    </div>
  </div>

  <!-- Detail modal -->
  <div id="habeaHubModal"
    style="display:none;position:fixed;inset:0;background:rgba(15,10,40,.6);z-index:500;align-items:flex-start;justify-content:center;padding:24px 12px;overflow-y:auto"
    onclick="document.getElementById('habeaHubModal').style.display='none'">
    <div style="background:#fff;border-radius:18px;width:min(680px,98vw);box-shadow:0 32px 80px rgba(0,0,0,.35);margin:auto" onclick="event.stopPropagation()">
      <div id="habeaHubModalBody"></div>
    </div>
  </div>`;
}

// ── Card renderers ────────────────────────────────────────────

function _pendingPostCard(w) {
  const prog = w.progress || 0;
  const confDate = (w.confirmed_at||'').slice(0,10);
  return `<div onclick="habeaHubOpenDetail(${w.id})"
    style="padding:14px 20px;border-bottom:1px solid #f3f0ff;cursor:pointer;transition:all .15s;border-left:3px solid transparent"
    onmouseover="this.style.background='#faf5ff';this.style.borderLeftColor='#7c3aed'"
    onmouseout="this.style.background='';this.style.borderLeftColor='transparent'">
    <div style="display:flex;align-items:flex-start;gap:12px">
      <div style="width:38px;height:38px;border-radius:10px;background:linear-gradient(135deg,#7c3aed,#a78bfa);display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0;box-shadow:0 2px 8px rgba(124,58,237,.28)">🦺</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700;color:#1e293b;margin-bottom:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escH(w.title)}</div>
        <div style="font-size:11px;color:#64748b;margin-bottom:6px">${escH(w.location||'—')} · <span style="color:#94a3b8">${escH(w.category||'—')}</span></div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:10px;padding:2px 10px;border-radius:20px;background:#ede9fe;color:#7c3aed;font-weight:700">🔧 ${escH(w.confirmed_name||'—')}</span>
          <span style="font-size:10px;color:#94a3b8">${confDate}</span>
        </div>
        <div style="margin-top:8px;height:4px;background:#f1f5f9;border-radius:4px;overflow:hidden">
          <div style="height:100%;width:${prog}%;background:linear-gradient(90deg,#7c3aed,#a78bfa);border-radius:4px"></div>
        </div>
      </div>
      <div style="flex-shrink:0;text-align:right;padding-left:4px">
        <div style="font-size:22px;font-weight:900;color:#7c3aed;line-height:1">${prog}%</div>
        <div style="font-size:9px;color:#a78bfa;margin-top:4px;font-weight:700;letter-spacing:.04em">НЭЭХ ▶</div>
      </div>
    </div>
  </div>`;
}

function _needsPreCard(w) {
  const prog = w.progress || 0;
  const progColor = prog >= 80 ? '#dc2626' : prog >= 50 ? '#d97706' : '#2563eb';
  return `<div onclick="habeaHubOpenPre(${w.id})"
    style="padding:12px 18px;border-bottom:1px solid #fff1f2;cursor:pointer;transition:all .15s;border-left:3px solid transparent"
    onmouseover="this.style.background='#fff5f5';this.style.borderLeftColor='#dc2626'"
    onmouseout="this.style.background='';this.style.borderLeftColor='transparent'">
    <div style="display:flex;align-items:center;gap:10px">
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:700;color:#1e293b;margin-bottom:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escH(w.title)}</div>
        <div style="font-size:10px;color:#94a3b8;margin-bottom:6px">${escH(w.location||'—')} · 👷 ${escH(w.assigned_name||'—')}</div>
        <div style="height:3px;background:#f1f5f9;border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${prog}%;background:${progColor};border-radius:3px"></div>
        </div>
      </div>
      <div style="flex-shrink:0;display:flex;flex-direction:column;align-items:flex-end;gap:5px">
        <span style="font-size:13px;font-weight:900;color:${progColor}">${prog}%</span>
        <button style="font-size:10px;padding:4px 12px;border-radius:6px;border:none;background:#dc2626;color:#fff;cursor:pointer;font-weight:700;white-space:nowrap">🔐 Зөвшөөрөх</button>
      </div>
    </div>
  </div>`;
}

function _activeCard(w) {
  const prog = w.progress || 0;
  const hpDate = (w.habea_pre_at||'').slice(0,10);
  return `<div style="padding:12px 18px;border-bottom:1px solid #f0f9ff;border-right:1px solid #e0f2fe;transition:background .15s"
    onmouseover="this.style.background='#f0f9ff'" onmouseout="this.style.background=''">
    <div style="display:flex;align-items:center;gap:10px">
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:700;color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:2px">${escH(w.title)}</div>
        <div style="font-size:10px;color:#0369a1;margin-bottom:6px">✅ ${escH(w.habea_pre_name||'—')} · ${hpDate}</div>
        <div style="height:4px;background:#dbeafe;border-radius:4px;overflow:hidden">
          <div style="height:100%;width:${prog}%;background:linear-gradient(90deg,#2563eb,#60a5fa);border-radius:4px"></div>
        </div>
      </div>
      <div style="font-size:15px;font-weight:900;color:#2563eb;flex-shrink:0">${prog}%</div>
    </div>
  </div>`;
}

function _riskCard(r) {
  const C = {
    'Маш өндөр': ['#fef2f2','#fee2e2','#dc2626','🔴'],
    'Өндөр':     ['#fff7ed','#ffedd5','#ea580c','🟠'],
    'Дунд':      ['#fefce8','#fef9c3','#ca8a04','🟡'],
    'Бага':      ['#f0fdf4','#dcfce7','#16a34a','🟢'],
  };
  const [bg, pillBg, color, dot] = C[r.risk_level] || ['#f8fafc','#f1f5f9','#64748b','⚪'];
  return `<div style="padding:10px 18px;border-bottom:1px solid ${bg};display:flex;align-items:center;gap:10px;background:${bg};border-left:3px solid ${color}">
    <span style="font-size:16px;flex-shrink:0">${dot}</span>
    <div style="flex:1;min-width:0">
      <div style="font-size:12px;font-weight:600;color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escH(r.location||'—')}</div>
      <div style="font-size:10px;color:#94a3b8;margin-top:1px">${escH(r.risk_type||'—')} · ${(r.report_date||'').slice(0,10)}</div>
    </div>
    <span style="padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700;background:${pillBg};color:${color};flex-shrink:0;white-space:nowrap">${r.risk_level}</span>
  </div>`;
}

// ── Detail modal — ХАБЭА post-approval ───────────────────────

export async function habeaHubOpenDetail(id) {
  const m = document.getElementById('habeaHubModal');
  const b = document.getElementById('habeaHubModalBody');
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
  } catch(e) { b.innerHTML = `<div style="padding:28px;color:#dc2626">Алдаа: ${escH(e.message)}</div>`; return; }

  const prog = w.progress || 0;

  // ── Warnings ─────────────────────────────────────────────────
  const warns = [];
  if (!execs.length)
    warns.push({ level:'error', msg:'Гүйцэтгэлийн бүртгэл огт байхгүй — ажил хийгдсэн эсэх нь тодорхойгүй!' });
  else if (execs.every(e => !(e.description||'').trim()))
    warns.push({ level:'warn', msg:'Гүйцэтгэлийн бүртгэлд тайлбар байхгүй байна' });

  const totalPhotos = execs.reduce((s,e) => s+(e.photo_count||0), 0) + (w.photo_count||0);
  if (totalPhotos === 0)
    warns.push({ level:'warn', msg:'Зураг хавсаргаагүй байна — ажлын талбайн нотолгоо дутуу' });
  if (!w.habea_pre_status || w.habea_pre_status !== 'approved')
    warns.push({ level:'warn', msg:'Эхлэлтийн ХАБЭА зөвшөөрөл бүртгэгдээгүй байна' });

  const warnHtml = warns.length ? `
    <div style="margin-bottom:14px;border-radius:10px;overflow:hidden;border:1px solid ${warns.some(x=>x.level==='error')?'#fca5a5':'#fde68a'}">
      <div style="padding:7px 12px;background:${warns.some(x=>x.level==='error')?'#dc2626':'#d97706'};color:#fff;font-size:11px;font-weight:800">
        ⚠️ АНХААРУУЛГА — Батлахаасаа өмнө шалгана уу
      </div>
      ${warns.map(wn=>`<div style="padding:7px 12px;background:${wn.level==='error'?'#fff1f2':'#fffbeb'};font-size:12px;color:${wn.level==='error'?'#be123c':'#92400e'};display:flex;gap:7px;align-items:flex-start;border-bottom:1px solid ${wn.level==='error'?'#fecdd3':'#fde68a'}">
        <span>${wn.level==='error'?'🔴':'🟡'}</span><span>${wn.msg}</span>
      </div>`).join('')}
    </div>` : `<div style="margin-bottom:14px;padding:8px 12px;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;font-size:11px;color:#15803d;font-weight:600">
      ✅ Бүх шаардлага хангагдсан — батлахад бэлэн
    </div>`;

  const row = (label, val) => val ? `<div style="display:flex;gap:8px;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:12px">
    <div style="width:140px;flex-shrink:0;color:#64748b;font-weight:600">${label}</div>
    <div style="color:#1e293b">${val}</div></div>` : '';

  const execHtml = execs.length
    ? execs.map(e=>`<div style="padding:6px 10px;background:#f8fafc;border-radius:6px;font-size:11px;margin-bottom:4px;border-left:3px solid ${e.photo_count>0?'#86efac':'#93c5fd'}">
        <div style="display:flex;justify-content:space-between">
          <div style="font-weight:600;color:#1e293b">${escH(e.exec_date||'')} · ${escH(e.worker_name||e.worker_names||'—')}</div>
          <span style="font-size:10px;color:${e.photo_count>0?'#16a34a':'#f59e0b'}">📷 ${e.photo_count||0}</span>
        </div>
        <div style="color:${(e.description||'').trim()?'#475569':'#f59e0b'};margin-top:2px">${escH(e.description||'— тайлбар байхгүй')}</div>
      </div>`).join('')
    : `<div style="font-size:11px;color:#dc2626;font-weight:600;padding:8px 10px;background:#fff1f2;border-radius:6px">🔴 Гүйцэтгэлийн бүртгэл байхгүй</div>`;

  b.innerHTML = `
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#6d28d9,#7c3aed);padding:18px 22px;border-radius:16px 16px 0 0;display:flex;align-items:flex-start;justify-content:space-between">
      <div>
        <div style="color:#ddd6fe;font-size:10px;font-weight:700;letter-spacing:.06em;margin-bottom:4px">ХАБЭА — АЖЛЫН ДУУСГАЛТ ШАЛГАХ</div>
        <div style="color:#fff;font-size:15px;font-weight:800;line-height:1.3">${escH(w.title)}</div>
        <div style="color:#c4b5fd;font-size:11px;margin-top:3px">${escH(w.category||'—')} · ${escH(w.location||'—')}</div>
      </div>
      <button onclick="document.getElementById('habeaHubModal').style.display='none'"
        style="border:none;background:rgba(255,255,255,.2);color:#fff;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:13px;flex-shrink:0">✕</button>
    </div>

    <div style="padding:20px 22px;max-height:70vh;overflow-y:auto">

      <!-- Progress -->
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;padding:10px 14px;background:#faf5ff;border-radius:10px">
        <div style="flex:1">
          <div style="font-size:10px;color:#7c3aed;font-weight:700;margin-bottom:4px">ГҮЙЦЭТГЭЛИЙН ЯВЦ</div>
          <div style="height:8px;background:#ede9fe;border-radius:8px;overflow:hidden">
            <div style="height:100%;width:${prog}%;background:#7c3aed;border-radius:8px"></div>
          </div>
        </div>
        <div style="font-size:22px;font-weight:900;color:#7c3aed">${prog}%</div>
      </div>

      <!-- Warnings -->
      ${warnHtml}

      <!-- Work info -->
      <div style="margin-bottom:14px">
        ${row('Гүйцэтгэгч',       escH(w.assigned_name||'—'))}
        ${row('Бүртгэсэн',        escH(w.created_name||'—'))}
        ${row('Ажлын огноо',      `${w.start_date||'—'} → ${w.end_date||'—'}`)}
        ${row('Байршил',          escH(w.location||'—'))}
        ${w.description ? row('Тайлбар', escH(w.description)) : ''}
      </div>

      <!-- Chief engineer approval -->
      ${w.confirmed_name ? `<div style="margin-bottom:14px;padding:10px 14px;background:#f5f3ff;border-radius:10px;border-left:4px solid #7c3aed">
        <div style="font-size:10px;font-weight:700;color:#7c3aed;margin-bottom:4px">🔧 ЕРӨНХИЙ ИНЖЕНЕРИЙН БАТЛАЛ</div>
        <div style="font-size:12px;color:#1e293b;font-weight:600">${escH(w.confirmed_name)} · ${(w.confirmed_at||'').slice(0,16)}</div>
        ${w.confirm_note ? `<div style="font-size:12px;color:#374151;margin-top:4px;font-style:italic">"${escH(w.confirm_note)}"</div>` : ''}
      </div>` : ''}

      <!-- Executions -->
      <div style="margin-bottom:14px">
        <div style="font-size:11px;font-weight:700;color:#374151;margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em">📋 Гүйцэтгэлийн бүртгэл (${execs.length})</div>
        ${execHtml}
      </div>

      ${ptw.length ? `<div style="margin-bottom:14px">
        <div style="font-size:11px;font-weight:700;color:#7c3aed;margin-bottom:5px;text-transform:uppercase;letter-spacing:.05em">🛂 PTW бүртгэл</div>
        ${ptw.map(p=>`<div style="font-size:11px;padding:4px 8px;background:#f5f3ff;border-radius:5px;margin-bottom:3px;border-left:3px solid #7c3aed">
          <b>${escH(p.title||'PTW')}</b> · ${escH(p.status||'—')}
        </div>`).join('')}
      </div>` : ''}

      ${w.habea_pre_status === 'approved' ? `<div style="margin-bottom:14px;padding:8px 12px;background:#e0f2fe;border-radius:8px;font-size:11px;color:#0369a1">
        🦺 Эхлэлтийн зөвшөөрөл: <b>${escH(w.habea_pre_name||'—')}</b> · ${(w.habea_pre_at||'').slice(0,10)}
        ${w.habea_pre_risks ? `<br>Эрсдэл: ${escH(w.habea_pre_risks)}` : ''}
      </div>` : ''}

      <!-- Divider -->
      <div style="border-top:2px solid #f1f5f9;margin:16px 0"></div>

      <!-- ХАБЭА approval form -->
      <div style="font-size:13px;font-weight:800;color:#1e293b;margin-bottom:10px">🦺 ХАБЭА-н шийдвэр</div>
      <label style="font-size:11px;color:#7c3aed;font-weight:700;display:block;margin-bottom:4px">
        Шалгалтын дүгнэлт <span style="color:#dc2626">*</span>
      </label>
      <textarea id="habeaHubNote" class="input" rows="3"
        style="resize:vertical;width:100%;box-sizing:border-box;border-color:#c4b5fd;margin-bottom:4px"
        placeholder="Ажлын талбайн байдал, аюулгүй байдлын шалгалтын дүн, дүгнэлт — тодорхой бичнэ үү..."></textarea>
      <div style="font-size:10px;color:#6b7280;margin-bottom:14px">⚠️ Энэ тэмдэглэл хуулийн баримт болно</div>

      <div style="display:flex;gap:8px">
        <button onclick="habeaHubDoPost(${id})"
          style="flex:2;padding:11px;border-radius:9px;border:none;background:#7c3aed;color:#fff;cursor:pointer;font-size:14px;font-weight:800">🦺 Аюулгүй — Ажил хаах</button>
        <button onclick="habeaHubDoReject(${id})"
          style="flex:1;padding:11px;border-radius:9px;border:none;background:#fee2e2;color:#dc2626;cursor:pointer;font-size:13px;font-weight:700">↩ Буцаах</button>
      </div>
    </div>`;
}

// ── Pre-approval modal ────────────────────────────────────────

export async function habeaHubOpenPre(id) {
  const m = document.getElementById('habeaHubModal');
  const b = document.getElementById('habeaHubModalBody');
  if (!m || !b) return;

  let w;
  try { w = await api(`/api/work-logs/${id}/approval-sheet`); }
  catch(e) { toast('Алдаа: ' + e.message); return; }

  m.style.display = 'flex';
  b.innerHTML = `
    <div style="background:linear-gradient(135deg,#0369a1,#0284c7);padding:18px 22px;border-radius:16px 16px 0 0;display:flex;align-items:flex-start;justify-content:space-between">
      <div>
        <div style="color:#bae6fd;font-size:10px;font-weight:700;letter-spacing:.06em;margin-bottom:4px">ХАБЭА — ЭХЛЭЛТИЙН ЗӨВШӨӨРӨЛ</div>
        <div style="color:#fff;font-size:15px;font-weight:800">${escH(w.title)}</div>
        <div style="color:#7dd3fc;font-size:11px;margin-top:2px">${escH(w.location||'—')}</div>
      </div>
      <button onclick="document.getElementById('habeaHubModal').style.display='none'"
        style="border:none;background:rgba(255,255,255,.2);color:#fff;border-radius:8px;padding:6px 12px;cursor:pointer">✕</button>
    </div>
    <div style="padding:20px 22px">
      <div style="margin-bottom:14px;padding:10px 14px;background:#f0f9ff;border-radius:10px;font-size:12px;color:#0369a1">
        <b>Шалгах зүйлс:</b> Хамгаалах хэрэгсэл бэлэн үү? · Ажлын байр аюулгүй юу? · Зарлал хийгдсэн үү?
      </div>
      <label style="font-size:11px;font-weight:700;color:#0369a1;display:block;margin-bottom:4px">Эрсдэлийн мэдээлэл</label>
      <textarea id="hhPreRisks" class="input" rows="2" style="margin-bottom:10px;width:100%;box-sizing:border-box"
        placeholder="Тухайн ажилд байгаа эрсдэлүүдийг бичнэ үү..."></textarea>
      <label style="font-size:11px;font-weight:700;color:#0369a1;display:block;margin-bottom:4px">Хамгаалах арга хэмжээ</label>
      <textarea id="hhPreMeasures" class="input" rows="2" style="margin-bottom:10px;width:100%;box-sizing:border-box"
        placeholder="Авсан арга хэмжээ, PPE, аюулгүйн зааварчилгаа..."></textarea>
      <label style="font-size:11px;font-weight:700;color:#0369a1;display:block;margin-bottom:4px">Нэмэлт тэмдэглэл</label>
      <textarea id="hhPreNote" class="input" rows="2" style="margin-bottom:14px;width:100%;box-sizing:border-box"
        placeholder="Нэмэлт мэдээлэл..."></textarea>
      <div style="display:flex;gap:8px">
        <button onclick="habeaHubDoPre(${id})"
          style="flex:1;padding:11px;border-radius:9px;border:none;background:#0369a1;color:#fff;cursor:pointer;font-size:13px;font-weight:800">🔐 Эхлэлт зөвшөөрөх</button>
        <button onclick="document.getElementById('habeaHubModal').style.display='none'"
          style="padding:11px 18px;border-radius:9px;border:1px solid #e2e6ed;background:#fff;cursor:pointer">Болих</button>
      </div>
    </div>`;
}

// ── Actions ───────────────────────────────────────────────────

export async function habeaHubDoPost(id) {
  const note = document.getElementById('habeaHubNote')?.value?.trim() || '';
  if (!note) { toast('Шалгалтын дүгнэлт заавал бичих шаардлагатай'); return; }
  try {
    await api(`/api/work-logs/${id}/habea-post`, { method:'POST', body:JSON.stringify({ note }) });
    document.getElementById('habeaHubModal').style.display = 'none';
    toast('🦺 ХАБЭА батлагдсан — Ажил амжилттай хаагдлаа ✓');
    await _load(); _render();
    printApprovalSheet(id);
  } catch(e) { toast('Алдаа: ' + e.message); }
}

export async function habeaHubDoReject(id) {
  let note = document.getElementById('habeaHubNote')?.value?.trim() || '';
  if (!note) {
    note = prompt('Буцаасан шалтгаан бичнэ үү:');
    if (!note?.trim()) { toast('Шалтгаан заавал бичих шаардлагатай'); return; }
  }
  try {
    await api(`/api/work-logs/${id}/habea-post-reject`, { method:'POST', body:JSON.stringify({ note }) });
    document.getElementById('habeaHubModal').style.display = 'none';
    toast('↩ Ажил буцаагдлаа — Инженерт мэдэгдэнэ');
    await _load(); _render();
  } catch(e) { toast('Алдаа: ' + e.message); }
}

export async function habeaHubDoPre(id) {
  const risks    = document.getElementById('hhPreRisks')?.value?.trim()    || '';
  const measures = document.getElementById('hhPreMeasures')?.value?.trim() || '';
  const note     = document.getElementById('hhPreNote')?.value?.trim()     || '';
  try {
    await api(`/api/work-logs/${id}/habea-pre`, {
      method:'POST', body: JSON.stringify({ risks, measures, note })
    });
    document.getElementById('habeaHubModal').style.display = 'none';
    toast('🦺 Эхлэлтийн зөвшөөрөл өгөгдлөө ✓');
    await _load(); _render();
  } catch(e) { toast('Алдаа: ' + e.message); }
}

// ── Helpers ───────────────────────────────────────────────────

function _emptyState(icon, title, sub, color='#94a3b8') {
  return `<div style="padding:32px 20px;text-align:center">
    <div style="font-size:30px;margin-bottom:8px">${icon}</div>
    <div style="font-size:13px;font-weight:700;color:${color}">${title}</div>
    ${sub ? `<div style="font-size:11px;color:#94a3b8;margin-top:3px">${sub}</div>` : ''}
  </div>`;
}

function escH(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Window exports ────────────────────────────────────────────

Object.assign(window, {
  habea_hub,
  habeaHubOpenDetail, habeaHubOpenPre,
  habeaHubDoPost, habeaHubDoReject, habeaHubDoPre,
});

// Keep backward compat — show('safety') still works for other modules
// but habea_hub now owns the sidebar slot
