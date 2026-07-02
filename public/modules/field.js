import { api, state, today, escapeHtml, toast } from './common.js';

let _fieldWorks = [];
let _fieldTrainings = [];
let _fieldInstructions = [];
let _fieldTodos = [];
let _fieldMyLocations = [];

async function field() {
  main.innerHTML = `<div style="text-align:center;padding:40px;color:#667085">⏳ Ачааллаж байна...</div>`;
  try {
    const [all, trainings, instructions, todos, myLocations] = await Promise.all([
      api("/api/work-logs").catch(() => []),
      api("/api/safety-trainings").catch(() => []),
      api("/api/safety-instructions").catch(() => []),
      api(`/api/nyarav/todos?module=personal&month=${today().slice(0, 7)}`).catch(() => []),
      api("/api/employee-locations/mine?limit=1").catch(() => []),
    ]);
    _fieldWorks = all.filter(w => w.status !== 'Хаагдсан');
    _fieldTrainings = trainings
      .filter(t => ['Төлөвлөсөн','Идэвхтэй','Хийгдсэн'].includes(t.status || 'Төлөвлөсөн'))
      .filter(t => Number(t.my_targeted || 0) > 0 || Number(t.target_count || 0) === 0)
      .slice(0, 5);
    _fieldInstructions = instructions
      .filter(i => (i.status || 'Идэвхтэй') === 'Идэвхтэй')
      .filter(i => Number(i.my_targeted || 0) > 0 || Number(i.target_count || 0) === 0)
      .slice(0, 6);
    const todayStr = today();
    const weekEnd = _fieldAddDays(todayStr, 6);
    _fieldTodos = (Array.isArray(todos) ? todos : [])
      .filter(t => (t.work_date || '') >= todayStr && (t.work_date || '') <= weekEnd)
      .sort(_fieldTodoSort);
    _fieldMyLocations = Array.isArray(myLocations) ? myLocations : [];
  } catch(e) { _fieldWorks = []; _fieldTodos = []; _fieldMyLocations = []; }
  _renderField();
}

function _renderField() {
  const active   = _fieldWorks.filter(w => ['Явцтай','Эхэлсэн'].includes(w.status));
  const rejected = _fieldWorks.filter(w => w.status === 'Буцаагдсан');
  const hseWait  = _fieldWorks.filter(w => ['Дууссан гэж илгээсэн','ХАБЭА шалгасан'].includes(w.status));
  const pending  = _fieldWorks.filter(w =>
    !['Явцтай','Эхэлсэн','Дууссан гэж илгээсэн','ХАБЭА шалгасан','Буцаагдсан'].includes(w.status));

  const section = (label, works, color) => works.length ? `
    <div style="font-size:11px;font-weight:700;color:${color||'#667085'};text-transform:uppercase;letter-spacing:.5px;margin:16px 0 8px">${label} (${works.length})</div>
    ${works.map(_workCard).join('')}` : '';

  const rejectedBanner = rejected.length ? `
    <div style="background:#fff1f2;border:2px solid #fca5a5;border-radius:12px;padding:12px 16px;margin-bottom:12px;display:flex;align-items:center;gap:10px">
      <span style="font-size:22px">❌</span>
      <div>
        <div style="font-size:13px;font-weight:800;color:#dc2626">${rejected.length} ажил буцаагдсан — дахин илгээх шаардлагатай</div>
        <div style="font-size:11px;color:#9f1239;margin-top:2px">Доорх ажлуудыг шалгаж, "Дахин илгээх" товчийг дарна уу</div>
      </div>
    </div>` : '';

  main.innerHTML = `
  <div style="max-width:600px;margin:0 auto;padding:0 4px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <div>
        <h1 style="margin:0 0 2px;font-size:18px">📱 Талбайн ажил</h1>
        <div style="font-size:11px;color:#667085">${active.length} явцтай${rejected.length ? ` · <span style="color:#dc2626;font-weight:700">${rejected.length} буцаагдсан</span>` : ''}</div>
      </div>
      <button class="btn" onclick="field()" style="padding:6px 14px;font-size:12px">🔄</button>
    </div>
    ${_fieldLocationBlock()}
    ${_fieldTodoBlock()}
    ${_fieldHseBlock()}
    ${rejectedBanner}
    ${section('❌ Буцаагдсан — дахин илгээх', rejected, '#dc2626')}
    ${section('Явцтай ажил', active)}
    ${section('Эхлэх хүлээгдэж буй', pending)}
    ${section('ХАБЭА / батлал хүлээж буй', hseWait)}
    ${!_fieldWorks.length ? `
    <div style="text-align:center;padding:60px 20px;color:#94a3b8">
      <div style="font-size:40px;margin-bottom:12px">✅</div>
      <div style="font-size:16px;font-weight:700;color:#374151">Идэвхтэй ажил байхгүй</div>
      <div style="font-size:12px;margin-top:4px">Бүх ажил дууссан</div>
    </div>` : ''}
  </div>`;
}

function _fieldLocationBlock() {
  const last = _fieldMyLocations[0];
  const maps = last ? `https://maps.google.com/?q=${Number(last.gps_lat)},${Number(last.gps_lng)}` : "";
  return `
  <div style="background:#fff;border:1px solid #bfdbfe;border-radius:14px;margin-bottom:14px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.05)">
    <div style="padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:10px">
      <div style="min-width:0">
        <div style="font-size:13px;font-weight:900;color:#0f172a">📍 Миний байршил</div>
        <div id="fieldLocStatus" style="font-size:10px;color:#64748b;margin-top:2px">
          ${last ? `Сүүлд: ${(last.created_at || '').slice(0,16)} · ${Number(last.gps_lat).toFixed(5)}, ${Number(last.gps_lng).toFixed(5)}` : 'Байршил илгээгээгүй байна'}
        </div>
      </div>
      <button id="fieldLocBtn" class="btn" onclick="fieldSendLocation()" style="padding:8px 12px;font-size:12px;white-space:nowrap">GPS илгээх</button>
    </div>
    ${last ? `<div style="padding:0 14px 12px"><a href="${maps}" target="_blank" rel="noopener" style="font-size:11px;font-weight:800;color:#2563eb;text-decoration:none">Google Maps дээр харах</a></div>` : ''}
  </div>`;
}

function _fieldAddDays(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function _fieldTodoSort(a, b) {
  const ad = `${a.work_date || ''} ${a.work_time || '99:99'}`;
  const bd = `${b.work_date || ''} ${b.work_time || '99:99'}`;
  if (ad !== bd) return ad.localeCompare(bd);
  return Number(a.id || 0) - Number(b.id || 0);
}

function _fieldTodoBlock() {
  const todayStr = today();
  const todays = _fieldTodos.filter(t => (t.work_date || '').slice(0, 10) === todayStr);
  const upcoming = _fieldTodos.filter(t => (t.work_date || '').slice(0, 10) !== todayStr).slice(0, 5);
  const activeCount = _fieldTodos.filter(t => t.status !== 'done').length;
  return `
  <div style="background:#fff;border:1px solid #dbe4f0;border-radius:14px;margin-bottom:14px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.05)">
    <div style="padding:12px 14px;background:#f8fafc;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;gap:10px">
      <div>
        <div style="font-size:13px;font-weight:900;color:#0f172a">📅 Миний төлөвлөгөө</div>
        <div style="font-size:10px;color:#64748b;margin-top:2px">Өнөөдөр ${todays.length} · 7 хоногт ${_fieldTodos.length}</div>
      </div>
      <span style="background:${activeCount ? '#dbeafe' : '#dcfce7'};color:${activeCount ? '#1d4ed8' : '#16a34a'};border-radius:999px;padding:3px 9px;font-size:10px;font-weight:900">${activeCount || 'OK'}</span>
    </div>
    <div style="padding:12px 14px">
      ${todays.length
        ? todays.map(t => _fieldTodoItem(t, true)).join('')
        : `<div style="font-size:12px;color:#94a3b8;text-align:center;padding:12px 4px">Өнөөдрийн төлөвлөгөө хоосон байна</div>`}
      ${upcoming.length ? `
        <div style="font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:.4px;margin:12px 0 7px">Ойрын өдрүүд</div>
        ${upcoming.map(t => _fieldTodoItem(t, false)).join('')}` : ''}
    </div>
  </div>`;
}

function _fieldTodoItem(t, isToday) {
  const done = t.status === 'done';
  const typeLabels = {
    work: 'Ажил',
    personal: 'Хувийн',
    reminder: 'Сануулах',
    meeting: 'Уулзалт',
    birthday: 'Төрсөн өдөр',
    other: 'Бусад',
  };
  const type = typeLabels[t.todo_type || 'work'] || 'Ажил';
  const dateLabel = isToday ? (t.work_time || 'Цаггүй') : `${(t.work_date || '').slice(5, 10)} ${t.work_time || ''}`.trim();
  return `
    <div style="display:flex;align-items:flex-start;gap:9px;border:1px solid ${done ? '#bbf7d0' : '#e2e8f0'};background:${done ? '#f0fdf4' : '#fff'};border-radius:11px;padding:10px 11px;margin-bottom:8px">
      <div style="width:44px;flex-shrink:0;text-align:center;border-radius:9px;background:${isToday ? '#eff6ff' : '#f8fafc'};color:${isToday ? '#1d4ed8' : '#64748b'};padding:6px 4px;font-size:10px;font-weight:900">${escapeHtml(dateLabel)}</div>
      <div style="min-width:0;flex:1">
        <div style="font-size:12px;font-weight:900;color:${done ? '#16a34a' : '#111827'};line-height:1.35;${done ? 'text-decoration:line-through' : ''}">${escapeHtml(t.title || '')}</div>
        ${t.note ? `<div style="font-size:11px;color:#64748b;line-height:1.4;margin-top:3px">${escapeHtml(String(t.note).slice(0, 120))}${String(t.note).length > 120 ? '...' : ''}</div>` : ''}
        <div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap;margin-top:6px">
          <span style="font-size:10px;font-weight:800;border-radius:999px;padding:2px 7px;background:#f1f5f9;color:#475569">${escapeHtml(type)}</span>
          ${done ? `<span style="font-size:10px;font-weight:800;color:#16a34a">✓ Дууссан</span>` : ''}
        </div>
      </div>
    </div>`;
}

function _fieldHseBlock() {
  const pendingInstructions = _fieldInstructions.filter(i => !i.my_ack_at);
  const pendingTrainings = _fieldTrainings.filter(t => !t.my_ack_at);
  const pendingTotal = pendingInstructions.length + pendingTrainings.length;
  if (!_fieldTrainings.length && !_fieldInstructions.length) return '';
  return `
  <div style="background:#fff;border:1px solid #dbe4f0;border-radius:14px;margin-bottom:14px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.05)">
    <div style="padding:12px 14px;background:#f8fafc;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;gap:10px">
      <div>
        <div style="font-size:13px;font-weight:900;color:#0f172a">🦺 ХАБЭА сургалт, зааварчилгаа</div>
        <div style="font-size:10px;color:#64748b;margin-top:2px">${pendingTotal} танилцах шаардлагатай</div>
      </div>
      ${pendingTotal ? `<span style="background:#fee2e2;color:#dc2626;border-radius:999px;padding:3px 9px;font-size:10px;font-weight:900">${pendingTotal}</span>` : `<span style="background:#dcfce7;color:#16a34a;border-radius:999px;padding:3px 9px;font-size:10px;font-weight:900">OK</span>`}
    </div>
    <div style="padding:12px 14px;display:flex;flex-direction:column;gap:10px">
      ${_fieldInstructions.map(_fieldInstructionCard).join('')}
      ${_fieldTrainings.map(_fieldTrainingCard).join('')}
    </div>
  </div>`;
}

function _fieldPdfViewer(url, title) {
  const safeUrl = escapeHtml(url || '');
  if (!safeUrl) return '';
  const isPdf = String(url).toLowerCase().split('?')[0].endsWith('.pdf');
  const openLabel = isPdf ? 'PDF нээх' : 'Файл нээх';
  return `
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px">
      <a href="${safeUrl}" target="_blank" rel="noopener"
        style="display:inline-flex;align-items:center;gap:5px;border:1px solid #bfdbfe;background:#eff6ff;color:#1d4ed8;border-radius:9px;padding:7px 10px;font-size:12px;font-weight:900;text-decoration:none">📄 ${openLabel}</a>
      <a href="${safeUrl}" download
        style="display:inline-flex;align-items:center;gap:5px;border:1px solid #e2e8f0;background:#fff;color:#475569;border-radius:9px;padding:7px 10px;font-size:12px;font-weight:800;text-decoration:none">⬇ Татах</a>
    </div>
    ${isPdf ? `
      <details style="margin-top:8px">
        <summary style="font-size:12px;font-weight:900;color:#2563eb;cursor:pointer">Утсан дээр урьдчилж харах</summary>
        <div style="margin-top:8px;border:1px solid #dbe4f0;border-radius:10px;overflow:hidden;background:#f8fafc">
          <iframe title="${escapeHtml(title || 'PDF')}" src="${safeUrl}#toolbar=0"
            style="width:100%;height:360px;border:0;background:#fff"></iframe>
        </div>
      </details>` : ''}
  `;
}

function _fieldInstructionCard(i) {
  const done = !!i.my_ack_at;
  return `
  <div style="border:1px solid ${done ? '#bbf7d0' : '#fde68a'};background:${done ? '#f0fdf4' : '#fffbeb'};border-radius:12px;padding:11px 12px">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:5px">
      <div style="min-width:0">
        <div style="font-size:12px;font-weight:900;color:#111827;line-height:1.35">${escapeHtml(i.title || '')}</div>
        <div style="font-size:10px;color:#64748b;margin-top:2px">${escapeHtml(i.type || 'Зааварчилгаа')} · ${(i.instruction_date || '').slice(0,10)}</div>
      </div>
      <span style="flex-shrink:0;font-size:10px;font-weight:900;border-radius:999px;padding:3px 8px;background:${done ? '#dcfce7' : '#fef3c7'};color:${done ? '#16a34a' : '#b45309'}">${done ? 'Танилцсан' : 'Танилцах'}</span>
    </div>
    ${i.body ? `<div style="font-size:11px;color:#475569;line-height:1.5;margin:7px 0;white-space:pre-wrap">${escapeHtml(String(i.body).slice(0, 260))}${String(i.body).length > 260 ? '...' : ''}</div>` : ''}
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      ${i.file_url ? `<a href="${escapeHtml(i.file_url)}" target="_blank" style="font-size:12px;font-weight:800;color:#2563eb;text-decoration:none">📎 Файл нээх</a>` : ''}
      ${done
        ? `<span style="font-size:10px;color:#16a34a;font-weight:800">✓ ${(i.my_ack_at || '').slice(0,10)} ${i.my_signature_code ? '· ' + escapeHtml(i.my_signature_code) : ''}</span>`
        : `<button onclick="fieldAckInstruction(${i.id})" class="btn" style="margin-left:auto;padding:7px 12px;font-size:12px;background:#16a34a">✓ Танилцсан</button>`}
    </div>
  </div>`;
}

function _fieldTrainingCard(t) {
  const done = !!t.my_ack_at;
  return `
  <div style="border:1px solid ${done ? '#bbf7d0' : '#dbeafe'};background:${done ? '#f0fdf4' : '#eff6ff'};border-radius:12px;padding:11px 12px">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:5px">
      <div style="min-width:0">
        <div style="font-size:12px;font-weight:900;color:#111827;line-height:1.35">🎓 ${escapeHtml(t.title || '')}</div>
        <div style="font-size:10px;color:#64748b;margin-top:2px">${(t.training_date || '').slice(0,10)} · ${escapeHtml(t.topic || 'Сургалт')}</div>
      </div>
      <span style="flex-shrink:0;font-size:10px;font-weight:900;border-radius:999px;padding:3px 8px;background:${done ? '#dcfce7' : '#fef3c7'};color:${done ? '#16a34a' : '#b45309'}">${done ? 'Танилцсан' : 'Танилцах'}</span>
    </div>
    <div style="font-size:11px;color:#475569;line-height:1.45">
      ${t.audience ? `Хүрээ: ${escapeHtml(t.audience)} · ` : ''}${t.trainer ? `Сургагч: ${escapeHtml(t.trainer)}` : ''}
    </div>
    ${t.result_note ? `<div style="font-size:11px;color:#475569;line-height:1.45;margin-top:6px;white-space:pre-wrap">${escapeHtml(String(t.result_note).slice(0, 220))}${String(t.result_note).length > 220 ? '...' : ''}</div>` : ''}
    ${t.file_url ? _fieldPdfViewer(t.file_url, t.title) : ''}
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:9px">
      ${done
        ? `<span style="font-size:10px;color:#16a34a;font-weight:900">✓ ${(t.my_ack_at || '').slice(0,10)} ${t.my_signature_code ? '· ' + escapeHtml(t.my_signature_code) : ''}</span>`
        : `<button onclick="fieldAckTraining(${t.id})" class="btn" style="margin-left:auto;padding:7px 12px;font-size:12px;background:#16a34a">✓ Сургалттай танилцсан</button>`}
    </div>
  </div>`;
}

async function fieldAckTraining(id) {
  if (!confirm('Энэ сургалтын материалтай танилцсанаа баталгаажуулах уу?')) return;
  try {
    await api(`/api/safety-trainings/${id}/ack`, { method: 'POST', body: JSON.stringify({ note: 'mobile' }) });
    toast('Сургалттай танилцсан гэж баталгаажлаа');
    field();
  } catch(e) { toast(e.message || 'Баталгаажуулах алдаа'); }
}

async function fieldAckInstruction(id) {
  if (!confirm('Энэ зааварчилгаатай танилцсанаа баталгаажуулах уу?')) return;
  try {
    await api(`/api/safety-instructions/${id}/ack`, { method: 'POST', body: JSON.stringify({ note: 'mobile' }) });
    toast('Зааварчилгаатай танилцсан гэж баталгаажлаа');
    field();
  } catch(e) { toast(e.message || 'Баталгаажуулах алдаа'); }
}

function _workCard(w) {
  const STAT = {
    'Явцтай':                 ['#dbeafe','#1d4ed8'],
    'Эхэлсэн':                ['#f0fdf4','#16a34a'],
    'Дууссан гэж илгээсэн':   ['#fef3c7','#d97706'],
    'ХАБЭА шалгасан':         ['#f3e8ff','#7c3aed'],
    'Буцаагдсан':             ['#fee2e2','#dc2626'],
  };
  const [sbg, scl] = STAT[w.status] || ['#f1f5f9','#475569'];
  const prog = w.progress || 0;
  const progColor = prog === 100 ? '#16a34a' : prog >= 50 ? '#2563eb' : '#d97706';
  const isRejected = w.status === 'Буцаагдсан';
  const canSubmit  = ['Явцтай','Эхэлсэн'].includes(w.status);
  const borderStyle = isRejected ? 'border:2px solid #fca5a5' : 'border:1px solid #e2e6ed';

  return `
  <div id="field-card-${w.id}" style="background:#fff;${borderStyle};border-radius:14px;margin-bottom:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.06)">
    <div style="padding:14px 16px 10px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:8px">
        <div style="flex:1">
          <div style="font-size:14px;font-weight:800;color:#111827;line-height:1.3">${escapeHtml(w.title||'')}</div>
          ${w.location ? `<div style="font-size:11px;color:#667085;margin-top:2px">📍 ${escapeHtml(w.location)}</div>` : ''}
          ${w.assigned_name ? `<div style="font-size:11px;color:#2563eb;margin-top:2px">👤 ${escapeHtml(w.assigned_name)}</div>` : ''}
        </div>
        <span style="padding:3px 9px;border-radius:20px;font-size:10px;font-weight:700;background:${sbg};color:${scl};white-space:nowrap;flex-shrink:0">${escapeHtml(w.status||'')}</span>
      </div>
      ${w.category ? `<span style="display:inline-block;padding:2px 8px;border-radius:20px;font-size:10px;background:#f1f5f9;color:#475569;margin-bottom:8px">${escapeHtml(w.category)}</span>` : ''}
      ${isRejected && w.reject_note ? `
        <div style="background:#fff1f2;border:1px solid #fca5a5;border-radius:8px;padding:9px 12px;margin-bottom:8px">
          <div style="font-size:10px;font-weight:700;color:#dc2626;margin-bottom:3px">❌ Буцаасан шалтгаан:</div>
          <div style="font-size:12px;color:#7f1d1d;line-height:1.5">${escapeHtml(w.reject_note)}</div>
        </div>` : ''}
      <div style="height:5px;background:#e2e6ed;border-radius:10px;overflow:hidden;margin-bottom:4px">
        <div style="height:100%;width:${prog}%;background:${progColor};border-radius:10px"></div>
      </div>
      <div style="font-size:10px;color:#94a3b8;text-align:right">${prog}% гүйцэтгэл</div>
    </div>

    <div style="display:flex;border-top:1px solid #f1f5f9">
      <button onclick="fieldToggleExec(${w.id})"
        style="flex:1;padding:13px 6px;border:none;background:transparent;color:#2563eb;font-size:12px;font-weight:700;cursor:pointer;border-right:1px solid #f1f5f9;-webkit-tap-highlight-color:transparent">
        + Гүйцэтгэл
      </button>
      <label style="flex:1;display:flex;align-items:center;justify-content:center;gap:4px;padding:13px 6px;color:#6366f1;font-size:12px;font-weight:700;cursor:pointer;border-right:1px solid #f1f5f9">
        📷 Зураг
        <input type="file" accept="image/*" capture="environment" style="display:none"
          onchange="fieldUploadPhoto(${w.id},this)">
      </label>
      ${isRejected
        ? `<button onclick="fieldMarkDone(${w.id})"
            style="flex:1;padding:13px 6px;border:none;background:#fef2f2;color:#dc2626;font-size:12px;font-weight:700;cursor:pointer;-webkit-tap-highlight-color:transparent">
            📬 Дахин илгээх
           </button>`
        : canSubmit
          ? `<button onclick="fieldMarkDone(${w.id})"
              style="flex:1;padding:13px 6px;border:none;background:transparent;color:#16a34a;font-size:12px;font-weight:700;cursor:pointer;-webkit-tap-highlight-color:transparent">
              ✓ Дуусгах
             </button>`
          : `<div style="flex:1;padding:13px 6px;text-align:center;color:#94a3b8;font-size:10px;display:flex;align-items:center;justify-content:center">ХАБЭА хүлээгдэж байна</div>`
      }
    </div>

    <div id="field-exec-form-${w.id}" style="display:none;padding:14px;background:#f8fafc;border-top:1px solid #e2e6ed">
      <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:10px">Гүйцэтгэл бүртгэх</div>
      <input class="input" id="fe-title-${w.id}" placeholder="Гүйцэтгэлийн нэр *"
        style="margin-bottom:8px;font-size:13px" value="${escapeHtml(w.title||'')}">
      <textarea class="input" id="fe-note-${w.id}" placeholder="Тайлбар..."
        style="margin-bottom:8px;font-size:13px;height:70px;resize:none"></textarea>
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <div style="flex:1">
          <div style="font-size:10px;color:#667085;margin-bottom:3px">Эхлэх огноо</div>
          <input class="input" id="fe-start-${w.id}" type="date" value="${today()}" style="font-size:12px">
        </div>
        <div style="flex:1">
          <div style="font-size:10px;color:#667085;margin-bottom:3px">Дуусах огноо</div>
          <input class="input" id="fe-end-${w.id}" type="date" value="${today()}" style="font-size:12px">
        </div>
      </div>
      <div style="margin-bottom:8px">
        <div style="font-size:10px;color:#667085;margin-bottom:3px">Явц: <span id="fe-prog-label-${w.id}">${prog}%</span></div>
        <input type="range" id="fe-prog-${w.id}" min="0" max="100" value="${prog}" step="5" style="width:100%;accent-color:#2563eb"
          oninput="document.getElementById('fe-prog-label-${w.id}').textContent=this.value+'%'">
      </div>
      <div style="margin-bottom:10px">
        <div style="font-size:10px;color:#667085;margin-bottom:3px">GPS байршил</div>
        <div style="display:flex;gap:6px;align-items:center">
          <input class="input" id="fe-gps-${w.id}" placeholder="GPS татагдаагүй" readonly
            style="font-size:11px;flex:1;color:#667085;background:#fff">
          <button id="fe-gps-btn-${w.id}" onclick="fieldGetGPS(${w.id})"
            style="padding:8px 12px;background:#0ea5e9;color:#fff;border:none;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap">
            📍 GPS
          </button>
        </div>
      </div>
      <input type="hidden" id="fe-lat-${w.id}">
      <input type="hidden" id="fe-lng-${w.id}">
      <div style="display:flex;gap:8px">
        <button onclick="fieldSaveExec(${w.id})" class="btn" style="flex:1;font-size:13px;padding:11px">Хадгалах</button>
        <button onclick="fieldToggleExec(${w.id})" class="btn secondary" style="font-size:13px;padding:11px">Цуцлах</button>
      </div>
    </div>
  </div>`;
}

function fieldToggleExec(id) {
  const el = document.getElementById(`field-exec-form-${id}`);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

async function fieldGetGPS(workId) {
  const btn = document.getElementById(`fe-gps-btn-${workId}`);
  if (btn) btn.textContent = '⏳';
  if (!navigator.geolocation) { toast('GPS дэмжигдэхгүй байна'); if (btn) btn.textContent = '📍 GPS'; return; }
  try {
    const pos = await fieldBestGeoPosition();
    const accuracy = Number(pos.coords.accuracy || 0);
    if (accuracy > 300) {
      toast('GPS нарийвчлал муу байна. Гадаа эсвэл цонхны ойролцоо дахин дарна уу.');
      if (btn) btn.textContent = '📍 GPS';
      return;
    }
    const lat = pos.coords.latitude.toFixed(6);
    const lng = pos.coords.longitude.toFixed(6);
    document.getElementById(`fe-gps-${workId}`).value = `${lat}, ${lng} (±${Math.round(accuracy)}м)`;
    document.getElementById(`fe-lat-${workId}`).value = lat;
    document.getElementById(`fe-lng-${workId}`).value = lng;
    if (btn) btn.textContent = '✅';
  } catch (err) {
    toast(`GPS алдаа: ${err.message}`);
    if (btn) btn.textContent = '📍 GPS';
  }
}

function fieldBestGeoPosition(onProgress) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("GPS дэмжигдэхгүй байна"));
    let best = null;
    let done = false;
    let watchId = null;
    let timer = null;
    const cleanup = () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      if (timer) clearTimeout(timer);
    };
    const finish = () => {
      if (done) return;
      done = true;
      cleanup();
      if (best) resolve(best);
      else reject(new Error("GPS координат авч чадсангүй"));
    };
    timer = setTimeout(finish, 15000);
    watchId = navigator.geolocation.watchPosition(
      pos => {
        const accuracy = Number(pos.coords.accuracy || Infinity);
        const bestAccuracy = best ? Number(best.coords.accuracy || Infinity) : Infinity;
        if (!best || accuracy < bestAccuracy) best = pos;
        if (typeof onProgress === "function") onProgress(best);
        if (Number(best.coords.accuracy || Infinity) <= 80) finish();
      },
      err => {
        if (done) return;
        done = true;
        cleanup();
        reject(err);
      },
      { timeout: 15000, enableHighAccuracy: true, maximumAge: 0 }
    );
  });
}

async function fieldSendLocation() {
  const btn = document.getElementById('fieldLocBtn');
  const status = document.getElementById('fieldLocStatus');
  if (!navigator.geolocation) {
    toast('GPS дэмжигдэхгүй байна');
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'GPS шалгаж байна...'; }
  if (status) status.textContent = 'GPS асаалттай эсэхийг шалгаад 10-15 сек хамгийн зөв координат авч байна...';
  try {
    const pos = await fieldBestGeoPosition(best => {
      if (!status || !best?.coords) return;
      status.textContent = `GPS уншиж байна... одоогийн нарийвчлал ±${Math.round(Number(best.coords.accuracy || 0))}м`;
    });
    const lat = Number(pos.coords.latitude);
    const lng = Number(pos.coords.longitude);
    const accuracy = Number(pos.coords.accuracy || 0);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || accuracy > 300) {
      toast('GPS нарийвчлал муу байна. Location/GPS асаагаад гадаа эсвэл цонхны ойролцоо дахин дарна уу.');
      if (status) status.textContent = `Хадгалаагүй: GPS нарийвчлал муу байна (±${Math.round(accuracy || 0)}м).`;
      return;
    }
    const saved = await api('/api/me/location', {
      method: 'POST',
      body: JSON.stringify({ lat, lng, accuracy, note: 'field_mobile' }),
    });
    toast('Байршил ERP-д хадгалагдлаа');
    _fieldMyLocations = [saved];
    if (status) status.textContent = `Сүүлд: ${(saved.created_at || '').slice(0,16)} · ${lat.toFixed(5)}, ${lng.toFixed(5)} · ±${Math.round(accuracy)}м`;
  } catch (e) {
    toast(e.message || 'GPS авахад алдаа гарлаа');
    if (status) status.textContent = 'GPS permission зөвшөөрөгдөөгүй эсвэл нарийвчлалтай координат авч чадсангүй.';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'GPS илгээх'; }
  }
}

async function fieldSaveExec(workId) {
  const title    = document.getElementById(`fe-title-${workId}`).value.trim();
  const note     = document.getElementById(`fe-note-${workId}`).value.trim();
  const start    = document.getElementById(`fe-start-${workId}`).value;
  const end      = document.getElementById(`fe-end-${workId}`).value;
  const progress = Number(document.getElementById(`fe-prog-${workId}`).value || 0);
  const gps_lat  = document.getElementById(`fe-lat-${workId}`).value || null;
  const gps_lng  = document.getElementById(`fe-lng-${workId}`).value || null;
  const myName   = state.me?.full_name || '';

  if (!title)       { toast('Гүйцэтгэлийн нэр оруулна уу'); return; }
  if (!start || !end) { toast('Огноо оруулна уу'); return; }

  try {
    await api(`/api/work-logs/${workId}/executions`, {
      method: 'POST',
      body: JSON.stringify({ title, note, start_date: start, end_date: end, progress, workers: myName, gps_lat, gps_lng })
    });
    toast('Гүйцэтгэл хадгалагдлаа');
    fieldToggleExec(workId);
    field();
  } catch(e) { toast(e.message); }
}

async function fieldUploadPhoto(workId, input) {
  if (!input.files?.[0]) return;
  const form = new FormData();
  form.append('photo', input.files[0]);
  try {
    const r = await fetch(`/api/work-logs/${workId}/photos`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      body: form
    });
    if (!r.ok) throw new Error('Upload failed');
    toast('Зураг хадгалагдлаа');
  } catch(e) { toast('Зураг оруулах алдаа гарлаа'); }
  input.value = '';
}

async function fieldMarkDone(workId) {
  const note = prompt('Дуусгалтын тайлбар оруулна уу.\n\nЖишээ: хийсэн ажил, үлдсэн анхаарах зүйл, хавсаргасан зураг.') || '';
  if (!confirm('Ажлыг "Дууссан гэж илгээсэн" гэж ХАБЭА шалгалтад илгээх үү?')) return;
  try {
    await api(`/api/work-logs/${workId}/submit-done`, { method: 'POST', body: JSON.stringify({ note }) });
    toast('ХАБЭА шалгах хүлээгдэж байна');
    field();
  } catch(e) { toast(e.message); }
}

Object.assign(window, { field, fieldAckInstruction, fieldAckTraining, fieldToggleExec, fieldGetGPS, fieldSendLocation, fieldSaveExec, fieldUploadPhoto, fieldMarkDone });
