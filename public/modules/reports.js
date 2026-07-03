import { api, table, state, today, escapeHtml, toast } from './common.js';

let _rptCatFilter = new Set(); // empty = show all
let _workCats     = [];
let _rptReloadTimer = null;
let _rptRenderSeq = 0;

const FREQ_OPTS = ["Өдөр тутам","7 хоног","Сар тутам","Улирал тутам","Хагас жил","Жил тутам","Нэг удаа"];

function daysDiff(dateStr) {
  const due = new Date(dateStr);
  due.setHours(0,0,0,0);
  const now = new Date(); now.setHours(0,0,0,0);
  return Math.ceil((due - now) / 86400000);
}

function statusBadge(dateStr, isActive) {
  if (!isActive) return `<span style="padding:2px 8px;border-radius:20px;font-size:11px;background:#f1f5f9;color:#94a3b8">Идэвхгүй</span>`;
  const d = daysDiff(dateStr);
  if (d < 0)  return `<span style="padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700;background:#fee2e2;color:#dc2626">${Math.abs(d)} хоног хэтэрсэн</span>`;
  if (d === 0) return `<span style="padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700;background:#fee2e2;color:#dc2626">Өнөөдөр!</span>`;
  if (d <= 3)  return `<span style="padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700;background:#fee2e2;color:#dc2626">${d} хоног</span>`;
  if (d <= 7)  return `<span style="padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700;background:#fef3c7;color:#d97706">${d} хоног</span>`;
  return `<span style="padding:2px 8px;border-radius:20px;font-size:11px;background:#dcfce7;color:#16a34a">${d} хоног</span>`;
}

// ── Тайлангийн хуваарь ────────────────────────────────────────

async function report_schedule() {
  let rows = [];
  const canEdit = ["director","hr","accountant"].includes(state.me.role);

  async function load() {
    try { rows = await api("/api/report-schedules"); } catch(e) { rows = []; }
    render();
  }

  function render() {
    const overdue  = rows.filter(r => r.is_active && daysDiff(r.next_due) <= 0).length;
    const upcoming = rows.filter(r => r.is_active && daysDiff(r.next_due) > 0 && daysDiff(r.next_due) <= 7).length;

    main.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
      <div>
        <h1 style="margin:0 0 4px">📋 Тайлангийн хуваарь</h1>
        <div style="font-size:12px;color:#667085">Report Schedule · Гаргах тайлангийн хугацааны хяналт</div>
      </div>
      ${canEdit ? `<button class="btn" onclick="rsOpenForm(0)">+ Хуваарь нэмэх</button>` : ""}
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:18px">
      <div style="background:#fff;border:1px solid #e2e6ed;border-radius:12px;padding:14px 16px;border-top:3px solid #2563eb">
        <div style="font-size:11px;color:#667085;margin-bottom:4px;text-transform:uppercase">Нийт хуваарь</div>
        <div style="font-size:24px;font-weight:800;color:#2563eb">${rows.filter(r=>r.is_active).length}</div>
      </div>
      <div style="background:#fff;border:1px solid #e2e6ed;border-radius:12px;padding:14px 16px;border-top:3px solid #dc2626">
        <div style="font-size:11px;color:#667085;margin-bottom:4px;text-transform:uppercase">Хэтэрсэн / Өнөөдөр</div>
        <div style="font-size:24px;font-weight:800;color:#dc2626">${overdue}</div>
      </div>
      <div style="background:#fff;border:1px solid #e2e6ed;border-radius:12px;padding:14px 16px;border-top:3px solid #d97706">
        <div style="font-size:11px;color:#667085;margin-bottom:4px;text-transform:uppercase">7 хоногийн дотор</div>
        <div style="font-size:24px;font-weight:800;color:#d97706">${upcoming}</div>
      </div>
    </div>

    <div class="panel" style="padding:0;overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:#f8fafc;border-bottom:2px solid #e2e6ed">
            <th style="padding:10px 14px;text-align:left;font-size:11px;color:#667085;font-weight:700">#</th>
            <th style="padding:10px 14px;text-align:left;font-size:11px;color:#667085;font-weight:700">ТАЙЛАНГИЙН НЭР</th>
            <th style="padding:10px 14px;text-align:left;font-size:11px;color:#667085;font-weight:700">ДАВТАМЖ</th>
            <th style="padding:10px 14px;text-align:left;font-size:11px;color:#667085;font-weight:700">ДАРААГИЙН ХУГАЦАА</th>
            <th style="padding:10px 14px;text-align:left;font-size:11px;color:#667085;font-weight:700">ҮЛДСЭН</th>
            <th style="padding:10px 14px;text-align:left;font-size:11px;color:#667085;font-weight:700">ХАРИУЦАХ</th>
            <th style="padding:10px 14px;text-align:left;font-size:11px;color:#667085;font-weight:700">ХҮЛЭЭН АВАГЧ</th>
            <th style="padding:10px 14px;text-align:left;font-size:11px;color:#667085;font-weight:700">ТЭМДЭГЛЭЛ</th>
            <th style="padding:10px 14px;font-size:11px;color:#667085;font-weight:700"></th>
          </tr>
        </thead>
        <tbody>
          ${rows.length ? rows.map((r, i) => `
            <tr style="border-bottom:1px solid #f1f5f9;${!r.is_active?'opacity:0.5':''}">
              <td style="padding:10px 14px;color:#94a3b8;font-size:11px">${i+1}</td>
              <td style="padding:10px 14px;font-weight:700">${escapeHtml(r.name)}</td>
              <td style="padding:10px 14px"><span style="padding:2px 8px;border-radius:20px;font-size:11px;background:#eff6ff;color:#2563eb">${escapeHtml(r.frequency)}</span></td>
              <td style="padding:10px 14px;font-family:monospace;font-weight:600">
                ${r.next_due}
                ${r.last_sent ? `<div style="font-size:10px;color:#16a34a;margin-top:2px">✓ ${r.last_sent}</div>` : ""}
              </td>
              <td style="padding:10px 14px">${statusBadge(r.next_due, r.is_active)}</td>
              <td style="padding:10px 14px;color:#374151;font-size:12px">${escapeHtml(r.responsible||"—")}</td>
              <td style="padding:10px 14px;color:#374151;font-size:12px">${escapeHtml(r.recipient||"—")}</td>
              <td style="padding:10px 14px;color:#94a3b8;font-size:11px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(r.note||"—")}</td>
              <td style="padding:10px 14px;white-space:nowrap">
                ${r.is_active ? `<button class="btn secondary sm" onclick="rsMarkSent(${r.id})" style="color:#16a34a;margin-right:4px" title="Тайлан илгээсэн гэж тэмдэглэх">✓ Илгээсэн</button>` : ""}
                ${canEdit ? `<button class="btn secondary sm" onclick="rsOpenForm(${r.id})" style="margin-right:4px">✏</button>
                <button class="btn secondary sm" style="color:#dc2626" onclick="rsDelete(${r.id})">🗑</button>` : ""}
              </td>
            </tr>`).join("") : `
            <tr><td colspan="9" style="text-align:center;padding:32px;color:#94a3b8">Хуваарь бүртгэгдээгүй байна</td></tr>`}
        </tbody>
      </table>
    </div>

    <!-- Modal -->
    <div id="rsModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;align-items:center;justify-content:center">
      <div style="background:#fff;border-radius:14px;padding:28px;width:500px;max-height:90vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.2)">
        <div id="rsModalTitle" style="font-size:16px;font-weight:800;margin-bottom:18px"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
          <div style="grid-column:1/-1">
            <div style="font-size:11px;color:#667085;margin-bottom:4px">Тайлангийн нэр *</div>
            <input class="input" id="rs_name" placeholder="Жишээ: Сарын санхүүгийн тайлан">
          </div>
          <div>
            <div style="font-size:11px;color:#667085;margin-bottom:4px">Давтамж *</div>
            <select class="input" id="rs_freq">
              ${FREQ_OPTS.map(f=>`<option>${f}</option>`).join("")}
            </select>
          </div>
          <div>
            <div style="font-size:11px;color:#667085;margin-bottom:4px">Дараагийн хугацаа *</div>
            <input class="input" id="rs_due" type="date" value="${today()}">
          </div>
          <div>
            <div style="font-size:11px;color:#667085;margin-bottom:4px">Хариуцах</div>
            <input class="input" id="rs_resp" placeholder="Нэр / хэлтэс">
          </div>
          <div>
            <div style="font-size:11px;color:#667085;margin-bottom:4px">Хүлээн авагч</div>
            <input class="input" id="rs_recv" placeholder="Удирдлага, байгууллага...">
          </div>
          <div>
            <div style="font-size:11px;color:#667085;margin-bottom:4px">Анхааруулах (хоног)</div>
            <input class="input" id="rs_warn" type="number" value="7" min="1">
          </div>
          <div>
            <div style="font-size:11px;color:#667085;margin-bottom:4px">Идэвхтэй</div>
            <select class="input" id="rs_active">
              <option value="1">Тийм</option>
              <option value="0">Үгүй</option>
            </select>
          </div>
          <div style="grid-column:1/-1">
            <div style="font-size:11px;color:#667085;margin-bottom:4px">Тэмдэглэл</div>
            <input class="input" id="rs_note" placeholder="Нэмэлт тайлбар...">
          </div>
        </div>
        <div style="display:flex;gap:10px;margin-top:4px">
          <button class="btn" onclick="rsSave()">Хадгалах</button>
          <button class="btn secondary" onclick="document.getElementById('rsModal').style.display='none'">Цуцлах</button>
        </div>
      </div>
    </div>`;

    window._rsRows = rows;
    window.rsOpenForm = (id) => {
      const r = id ? rows.find(x => x.id === id) : null;
      document.getElementById("rsModalTitle").textContent = r ? "Хуваарь засах" : "+ Хуваарь нэмэх";
      document.getElementById("rs_name").value   = r ? r.name        : "";
      document.getElementById("rs_freq").value   = r ? r.frequency   : FREQ_OPTS[2];
      document.getElementById("rs_due").value    = r ? r.next_due    : today();
      document.getElementById("rs_resp").value   = r ? (r.responsible||"") : "";
      document.getElementById("rs_recv").value   = r ? (r.recipient||"")   : "";
      document.getElementById("rs_warn").value   = r ? (r.warn_days||7)    : 7;
      document.getElementById("rs_active").value = r ? String(r.is_active) : "1";
      document.getElementById("rs_note").value   = r ? (r.note||"") : "";
      document.getElementById("rsModal").dataset.editId = id || "";
      document.getElementById("rsModal").style.display = "flex";
    };
    window.rsSave = async () => {
      const editId = document.getElementById("rsModal").dataset.editId;
      const body = {
        name:        document.getElementById("rs_name").value.trim(),
        frequency:   document.getElementById("rs_freq").value,
        next_due:    document.getElementById("rs_due").value,
        responsible: document.getElementById("rs_resp").value,
        recipient:   document.getElementById("rs_recv").value,
        warn_days:   Number(document.getElementById("rs_warn").value||7),
        is_active:   Number(document.getElementById("rs_active").value),
        note:        document.getElementById("rs_note").value
      };
      if (!body.name || !body.next_due) { toast("Нэр болон хугацааг оруулна уу"); return; }
      try {
        if (editId) {
          await api(`/api/report-schedules/${editId}`, { method:"PUT", body:JSON.stringify(body) });
          toast("Хадгаллаа");
        } else {
          await api("/api/report-schedules", { method:"POST", body:JSON.stringify(body) });
          toast("Нэмэгдлээ");
        }
        document.getElementById("rsModal").style.display = "none";
        load();
      } catch(e) { toast(e.message); }
    };
    window.rsDelete = async (id) => {
      if (!confirm("Энэ хуваарийг устгах уу?")) return;
      try {
        await api(`/api/report-schedules/${id}`, { method:"DELETE" });
        toast("Устгагдлаа");
        load();
      } catch(e) { toast(e.message); }
    };
    window.rsMarkSent = async (id) => {
      const r = rows.find(x => x.id === id);
      if (!r) return;
      const msg = r.frequency === "Нэг удаа"
        ? `"${r.name}" тайланг илгээсэн гэж тэмдэглэх үү?\n(Нэг удаагийн тайлан — идэвхгүй болно)`
        : `"${r.name}" тайланг илгээсэн гэж тэмдэглэх үү?\nДараагийн хугацаа автоматаар шинэчлэгдэнэ.`;
      if (!confirm(msg)) return;
      try {
        const result = await api(`/api/report-schedules/${id}/mark-sent`, { method:"POST" });
        toast(`Илгээсэн гэж тэмдэглэгдлээ. Дараагийн хугацаа: ${result.next_due}`);
        load();
      } catch(e) { toast(e.message); }
    };
  }

  load();
}

// ── Ерөнхий тайлан ───────────────────────────────────────────

function _rptVals() {
  const y = Number(document.getElementById("rptYear")?.value  || new Date().getFullYear());
  const m = Number(document.getElementById("rptMonth")?.value || new Date().getMonth()+1);
  return { y, m };
}

let _rptCache = null; // { year, allWork, execs }
let _rptDelegatedEventsBound = false;

function reloadReports() {
  const { y } = _rptVals();
  // flush cache only when year changes so month switches reuse cached data
  if (_rptCache && _rptCache.year !== y) _rptCache = null;
  clearTimeout(_rptReloadTimer);
  _rptReloadTimer = setTimeout(() => reports(), 80);
}

function bindReportDelegatedEvents() {
  if (_rptDelegatedEventsBound) return;
  _rptDelegatedEventsBound = true;
  document.addEventListener("change", (ev) => {
    if (ev.target?.id === "rptYear" || ev.target?.id === "rptMonth") reloadReports();
  });
  window.addEventListener("focus", () => {
    if (document.getElementById("rptYear") && document.getElementById("rptMonth")) {
      document.getElementById("rptYear").disabled = false;
      document.getElementById("rptMonth").disabled = false;
    }
  });
}

function reportPhotoSrc(photo) {
  const raw = photo?.file_path || photo?.filename || "";
  if (!raw) return "";
  const path = raw.startsWith("/uploads/")
    ? raw
    : `/uploads/${raw.replace(/^\/?uploads\//, "").replace(/^\/+/, "")}`;
  return `${location.origin}${path}`;
}

function rptIsDoneStatus(status = "") {
  return ["Хаагдсан", "Дууссан"].includes(status);
}

function rptWorkProgress(work, workExecs = []) {
  if (rptIsDoneStatus(work.status)) return 100;
  const nums = workExecs
    .map(e => Number(e.progress || 0))
    .filter(n => Number.isFinite(n));
  if (nums.length) return Math.round(nums.reduce((s, n) => s + n, 0) / nums.length);
  return Number(work.progress || 0);
}

function rptIsOverdue(work) {
  if (rptIsDoneStatus(work.status)) return false;
  if (!work.end_date) return false;
  const end = new Date(work.end_date);
  const now = new Date();
  end.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  return end < now;
}

function rptExecMap(execRows = []) {
  const map = new Map();
  for (const e of execRows) {
    const key = Number(e.work_log_id);
    const list = map.get(key) || [];
    list.push(e);
    map.set(key, list);
  }
  return map;
}

function rptWorkRows(workRows, execRowsOrMap) {
  const execMap = execRowsOrMap instanceof Map ? execRowsOrMap : rptExecMap(execRowsOrMap);
  return workRows.map(r => {
    const wExecs = execMap.get(Number(r.id)) || [];
    const displayProgress = rptWorkProgress(r, wExecs);
    return { ...r, _execs: wExecs, _displayProgress: displayProgress, _overdue: rptIsOverdue(r) };
  });
}

function rptGroupByCategory(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = r.category || "Бусад";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return [...groups.entries()].map(([category, items]) => ({ category, items }));
}

async function buildWorkReportSnapshot(year, month) {
  let allWork = [], execs = [];
  if (_rptCache && _rptCache.year === year) {
    allWork = _rptCache.allWork || [];
    execs = _rptCache.execs || [];
  } else {
    try { allWork = await api("/api/work-logs"); } catch(e) {}
    try { execs = await api(`/api/executions?year=${year}`); } catch(e) {}
  }
  const execMap = rptExecMap(execs);
  const mm = String(month).padStart(2, "0");
  const prefix = `${year}-${mm}`;
  const execWorkIdsInMonth = new Set();
  for (const e of execs) {
    if ((e.start_date || "").startsWith(prefix) || (e.end_date || "").startsWith(prefix)) {
      execWorkIdsInMonth.add(e.work_log_id);
    }
  }
  const filtered = rptWorkRows(allWork.filter(r => {
    const d = r.start_date || r.work_date || "";
    return d.startsWith(prefix) || (r.end_date || "").startsWith(prefix) || execWorkIdsInMonth.has(r.id);
  }).filter(r => _rptCatFilter.size === 0 || _rptCatFilter.has(r.category || "")), execMap);

  const done = filtered.filter(r => rptIsDoneStatus(r.status)).length;
  const ongoing = filtered.filter(r => String(r.status || "").includes("Явц")).length;
  const waiting = filtered.length - done - ongoing;
  const avgProgress = filtered.length
    ? Math.round(filtered.reduce((s, r) => s + Number(r._displayProgress || 0), 0) / filtered.length)
    : 0;
  const rows = filtered.map(r => ({
    id: r.id,
    title: r.title || "",
    location: r.location || "",
    category: r.category || "",
    start_date: r.start_date || r.work_date || "",
    end_date: r.end_date || "",
    workers: r.material_note || "",
    status: r.status || "",
    progress: Number(r._displayProgress || 0),
    overdue: !!r._overdue,
    material_count: Number(r.material_count || 0),
    photo_count: Number(r.photo_count || 0),
    confirm_status: r.confirm_status || "",
    executions: (r._execs || []).map(e => ({
      id: e.id,
      title: e.title || "",
      start_date: e.start_date || "",
      end_date: e.end_date || "",
      workers: e.workers || "",
      note: e.note || "",
      status: e.status || "",
      progress: Number(e.progress || 0),
      photo_count: Number(e.photo_count || 0),
    })),
  }));
  return {
    year,
    month,
    filter: [..._rptCatFilter],
    saved_at: new Date().toISOString(),
    summary: { total: filtered.length, done, ongoing, waiting, avg_progress: avgProgress },
    rows,
  };
}

function rptBadge(text, color = "#2563eb", bg = "#eff6ff") {
  return `<span style="display:inline-block;margin:2px 4px 0 0;padding:2px 7px;border-radius:20px;background:${bg};color:${color};font-size:9px;font-weight:700;white-space:nowrap">${text}</span>`;
}

function downloadHtmlFile(filename, html) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.replace(/[\\/:*?"<>|]+/g, "_");
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function reports() {
  bindReportDelegatedEvents();
  const renderSeq = ++_rptRenderSeq;
  const now = new Date();
  const savedY = document.getElementById("rptYear")?.value;
  const savedM = document.getElementById("rptMonth")?.value;

  if (!savedY) _rptCatFilter.clear();

  const initYear  = savedY ? Number(savedY)  : now.getFullYear();
  const initMonth = savedM ? Number(savedM)  : now.getMonth()+1;

  const MN_MONTHS = ["","1-р сар","2-р сар","3-р сар","4-р сар","5-р сар",
    "6-р сар","7-р сар","8-р сар","9-р сар","10-р сар","11-р сар","12-р сар"];
  const canSaveSnapshot = ["director","hr","accountant"].includes(state.me?.role) || !!state.me?.permissions;

  let allWork = [], execs = [], execMap = new Map();
  if (_rptCache && _rptCache.year === initYear) {
    allWork = _rptCache.allWork;
    execs   = _rptCache.execs;
    execMap = _rptCache.execMap || rptExecMap(execs);
  } else {
    main.innerHTML = `<div style="text-align:center;padding:40px;color:#667085">⏳ Уншиж байна...</div>`;
    try { allWork = await api("/api/work-logs"); } catch(e) {}
    try { execs   = await api(`/api/executions?year=${initYear}`); } catch(e) {}
    execMap = rptExecMap(execs);
    try { _workCats = await api("/api/work-categories"); } catch(e) {}
    if (renderSeq !== _rptRenderSeq) return;
    if (!_workCats.length) {
      const catNames = [...new Set(allWork.map(r=>r.category||"").filter(Boolean))];
      _workCats = catNames.map(n => ({ name: n, icon: "📋", color: "#2563eb" }));
    }
    _rptCache = { year: initYear, allWork, execs, execMap };
  }

  const mm = String(initMonth).padStart(2,"0");
  const prefix = `${initYear}-${mm}`;
  const execWorkIdsInMonth = new Set();
  for (const e of execs) {
    if ((e.start_date || "").startsWith(prefix) || (e.end_date || "").startsWith(prefix)) {
      execWorkIdsInMonth.add(e.work_log_id);
    }
  }

  const filtered = rptWorkRows(allWork.filter(r => {
    const d = r.start_date || r.work_date || "";
    return d.startsWith(prefix) || (r.end_date||"").startsWith(prefix) ||
           execWorkIdsInMonth.has(r.id);
  }).filter(r => _rptCatFilter.size === 0 || _rptCatFilter.has(r.category || "")), execMap);

  const done    = filtered.filter(r => ["Хаагдсан","Дууссан"].includes(r.status)).length;
  const ongoing = filtered.filter(r => r.status === "Явцтай").length;
  const waiting = filtered.filter(r => r.status === "Хүлээгдэж байгаа" || r.status === "Эхэлсэн").length;

  main.innerHTML = `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
    <div>
      <h1 style="margin:0 0 2px">📑 Ажлын явцын тайлан</h1>
      <div style="font-size:12px;color:#667085">Сар сонгоод тайланг хэвлэнэ үү</div>
    </div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <select id="rptYear" class="input" style="width:80px">
        ${[2024,2025,2026,2027].map(y=>`<option value="${y}" ${y===initYear?"selected":""}>${y}</option>`).join("")}
      </select>
      <select id="rptMonth" class="input" style="width:100px">
        ${MN_MONTHS.slice(1).map((m,i)=>`<option value="${i+1}" ${i+1===initMonth?"selected":""}>${m}</option>`).join("")}
      </select>
      ${canSaveSnapshot ? `<button class="btn" onclick="const v=_rptVals();saveWorkReportSnapshot(v.y,v.m)" style="padding:6px 14px;background:#16a34a;border-color:#16a34a">💾 Хадгалах</button>` : ""}
      <button class="btn secondary" onclick="const v=_rptVals();showWorkReportSnapshots(v.y,v.m)" style="padding:6px 14px">📂 Хадгалсан</button>
      <button class="btn secondary" onclick="const v=_rptVals();downloadLiveWorkReport(v.y,v.m)" style="padding:6px 14px">📥 HTML татах</button>
      <button class="btn" onclick="const v=_rptVals();printWorkReport(v.y,v.m,false)" style="padding:6px 14px">🖨️ Зураггүй</button>
      <button class="btn" onclick="const v=_rptVals();printWorkReport(v.y,v.m,true)" style="padding:6px 14px;background:#0ea5e9;border-color:#0ea5e9">🖼️ Зурагтай</button>
    </div>
  </div>

  <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:16px;padding:8px 12px;background:#f8f9fb;border-radius:10px;border:1px solid #e2e6ed">
    <span style="font-size:11px;color:#667085;font-weight:700;white-space:nowrap;margin-right:2px">Категори:</span>
    <button onclick="rptToggleAll()"
      style="padding:4px 14px;border-radius:20px;cursor:pointer;font-size:12px;font-weight:600;transition:all .15s;
             border:2px solid ${_rptCatFilter.size===0?'#2563eb':'#d1d5db'};
             background:${_rptCatFilter.size===0?'#2563eb':'transparent'};
             color:${_rptCatFilter.size===0?'#fff':'#374151'}">
      Бүх
    </button>
    ${_workCats.map(c => {
      const on = _rptCatFilter.has(c.name);
      const col = c.color || '#2563eb';
      return `<button data-cat="${escapeHtml(c.name)}" onclick="rptToggleCat(this.dataset.cat)"
        style="padding:4px 14px;border-radius:20px;cursor:pointer;font-size:12px;font-weight:600;transition:all .15s;
               border:2px solid ${on ? col : '#d1d5db'};
               background:${on ? col : 'transparent'};
               color:${on ? '#fff' : '#374151'}">
        ${c.icon||'📋'} ${escapeHtml(c.name)}
      </button>`;
    }).join("")}
  </div>

  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px">
    <div class="panel" style="padding:12px 16px;border-top:3px solid #2563eb;margin:0">
      <div style="font-size:10px;color:#667085;margin-bottom:4px">НИЙТ АЖИЛ</div>
      <div style="font-size:24px;font-weight:900;color:#2563eb">${filtered.length}</div>
    </div>
    <div class="panel" style="padding:12px 16px;border-top:3px solid #16a34a;margin:0">
      <div style="font-size:10px;color:#667085;margin-bottom:4px">ДУУССАН</div>
      <div style="font-size:24px;font-weight:900;color:#16a34a">${done}</div>
    </div>
    <div class="panel" style="padding:12px 16px;border-top:3px solid #6366f1;margin:0">
      <div style="font-size:10px;color:#667085;margin-bottom:4px">ЯВЦТАЙ</div>
      <div style="font-size:24px;font-weight:900;color:#6366f1">${ongoing}</div>
    </div>
    <div class="panel" style="padding:12px 16px;border-top:3px solid #d97706;margin:0">
      <div style="font-size:10px;color:#667085;margin-bottom:4px">ХҮЛЭЭГДЭЖ БУЙ</div>
      <div style="font-size:24px;font-weight:900;color:#d97706">${waiting}</div>
    </div>
  </div>

  <div class="panel" style="padding:0;overflow-x:auto">
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead>
        <tr style="background:#f8f9fb;border-bottom:2px solid #e2e6ed">
          <th style="padding:10px 12px;text-align:left;font-size:11px;color:#667085;font-weight:700;white-space:nowrap">#</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;color:#667085;font-weight:700">АЖЛЫН НЭР / БАЙРШИЛ</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;color:#667085;font-weight:700;white-space:nowrap">ОГНОО</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;color:#667085;font-weight:700">АЖИЛЧИД</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;color:#667085;font-weight:700;white-space:nowrap">ЯВЦ</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;color:#667085;font-weight:700;white-space:nowrap">ТӨЛӨВ</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;color:#667085;font-weight:700">ГҮЙЦЭТГЭЛ</th>
        </tr>
      </thead>
      <tbody>
        ${filtered.length ? filtered.map((r,i) => {
          const wExecs = r._execs || [];
          const prog = r._displayProgress ?? r.progress ?? 0;
          const progColor = prog===100?'#16a34a':prog>=50?'#2563eb':'#d97706';
          const statusBg  = r.status==='Дууссан'?'#dcfce7':r.status==='Явцтай'?'#dbeafe':'#f1f5f9';
          const statusCl  = r.status==='Дууссан'?'#16a34a':r.status==='Явцтай'?'#1d4ed8':'#475569';
          const badges = [
            r._overdue ? rptBadge("Хугацаа хэтэрсэн", "#dc2626", "#fee2e2") : "",
            Number(r.material_count || 0) > 0 ? rptBadge(`Материал ${r.material_count}`, "#0ea5e9", "#e0f2fe") : "",
            Number(r.photo_count || 0) > 0 || wExecs.some(e => Number(e.photo_count || 0) > 0) ? rptBadge("Зурагтай", "#16a34a", "#dcfce7") : "",
            r.confirm_status === "confirmed" ? rptBadge("Батлагдсан", "#16a34a", "#dcfce7") : "",
          ].join("");
          return `
          <tr style="border-bottom:1px solid #f1f5f9;${r._overdue ? "background:#fff7ed" : ""}">
            <td style="padding:10px 12px;color:#94a3b8;font-size:11px;vertical-align:top">${i+1}</td>
            <td style="padding:10px 12px;vertical-align:top">
              <div style="font-weight:700;font-size:12px">${escapeHtml(r.title||"")}</div>
              <div style="font-size:11px;color:#667085">${escapeHtml(r.location||"")}</div>
              ${r.category?`<div style="font-size:10px;color:#94a3b8">${escapeHtml(r.category)}</div>`:""}
              <div>${badges}</div>
            </td>
            <td style="padding:10px 12px;font-size:11px;color:#344054;vertical-align:top;white-space:nowrap">
              ${r.start_date||r.work_date||""}<br><span style="color:#94a3b8">~</span> ${r.end_date||""}
            </td>
            <td style="padding:10px 12px;font-size:11px;color:#2563eb;vertical-align:top">
              ${escapeHtml(r.material_note||"")}
            </td>
            <td style="padding:10px 12px;vertical-align:top;min-width:70px">
              <div style="font-weight:800;color:${progColor};font-size:13px">${prog}%</div>
              <div style="height:5px;background:#e2e6ed;border-radius:10px;overflow:hidden;margin-top:3px;width:60px">
                <div style="height:100%;width:${prog}%;background:${progColor};border-radius:10px"></div>
              </div>
            </td>
            <td style="padding:10px 12px;vertical-align:top;white-space:nowrap">
              <span style="font-size:10px;padding:2px 8px;border-radius:20px;background:${statusBg};color:${statusCl};font-weight:600">${r.status||""}</span>
              ${r._overdue ? `<div style="font-size:9px;color:#dc2626;margin-top:2px;font-weight:700">Хугацаа хэтэрсэн</div>` : ""}
            </td>
            <td style="padding:10px 12px;vertical-align:top;min-width:160px">
              ${wExecs.length ? wExecs.map((ex,j) => `
                <div style="margin-bottom:4px;padding:4px 8px;background:#f8f9fb;border-radius:6px;border-left:3px solid ${ex.status==='Дууссан'?'#16a34a':'#6366f1'}">
                  <div style="font-size:10px;font-weight:700;color:#344054">Гүйцэтгэл ${j+1}: ${escapeHtml(ex.title||"")}</div>
                  <div style="font-size:9px;color:#667085">${ex.start_date||""} ~ ${ex.end_date||""} · ${ex.progress||0}%</div>
                  ${ex.workers?`<div style="font-size:9px;color:#2563eb">👷 ${escapeHtml(ex.workers)}</div>`:""}
                  ${ex.note?`<div style="font-size:9px;color:#475569;margin-top:2px">📝 ${escapeHtml(ex.note)}</div>`:""}
                </div>`).join("") : `<span style="font-size:10px;color:#94a3b8">—</span>`}
            </td>
          </tr>`;
        }).join("") : `<tr><td colspan="7" style="padding:30px;text-align:center;color:#94a3b8">
          ${MN_MONTHS[initMonth]} ${initYear} онд ажил бүртгэгдээгүй байна
        </td></tr>`}
      </tbody>
    </table>
  </div>

  <div class="panel" style="background:linear-gradient(135deg,#1e40af 0%,#2563eb 100%);border:none;margin-top:16px">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
      <div>
        <div style="font-size:14px;font-weight:800;color:#fff;margin-bottom:4px">🧠 Smart Import</div>
        <div style="font-size:11px;color:#bfdbfe">Нягтлангийн програмаас гаргасан Excel-г автоматаар таньж оруулна</div>
      </div>
      <button onclick="openSmartImport()"
        style="padding:9px 20px;background:#fff;color:#1d4ed8;font-weight:800;font-size:13px;border:none;border-radius:10px;cursor:pointer">
        📂 Excel оруулах
      </button>
    </div>
  </div>`;
}

function rptPrintChart(filtered) {
  const statusRows = [
    { label: "Дууссан", value: filtered.filter(r => rptIsDoneStatus(r.status)).length, color: "#16a34a" },
    { label: "Явцтай", value: filtered.filter(r => r.status === "Явцтай").length, color: "#6366f1" },
    { label: "Хүлээгдэж буй", value: filtered.filter(r => r.status === "Хүлээгдэж байгаа" || r.status === "Эхэлсэн").length, color: "#d97706" },
    { label: "Хугацаа хэтэрсэн", value: filtered.filter(r => r._overdue).length, color: "#dc2626" },
  ];
  const groups = rptGroupByCategory(filtered).slice(0, 7).map(g => {
    const avg = g.items.length ? Math.round(g.items.reduce((s, r) => s + Number(r._displayProgress || 0), 0) / g.items.length) : 0;
    return { label: g.category, count: g.items.length, avg };
  });

  const W = 1040, H = 158, leftW = 360, pad = 18;
  const maxStatus = Math.max(1, ...statusRows.map(r => r.value));
  const maxGroup = Math.max(1, ...groups.map(r => r.count));
  const statusSvg = statusRows.map((r, i) => {
    const y = 36 + i * 27;
    const bw = Math.round((r.value / maxStatus) * 220);
    return `
      <text x="${pad}" y="${y+11}" font-size="11" fill="#334155" font-weight="700">${r.label}</text>
      <rect x="122" y="${y}" width="205" height="14" rx="7" fill="#eef2f7"/>
      <rect x="122" y="${y}" width="${Math.round((r.value / maxStatus) * 205)}" height="14" rx="7" fill="${r.color}"/>
      <text x="${338}" y="${y+11}" font-size="11" fill="${r.color}" font-weight="800" text-anchor="end">${r.value}</text>`;
  }).join("");

  const groupSvg = groups.length ? groups.map((r, i) => {
    const y = 36 + i * 17;
    const countW = Math.round((r.count / maxGroup) * 155);
    const progW = Math.round((r.avg / 100) * 155);
    return `
      <text x="${leftW + 18}" y="${y+10}" font-size="10" fill="#334155" font-weight="700">${escapeHtml(String(r.label).slice(0, 26))}${String(r.label).length > 26 ? "..." : ""}</text>
      <rect x="${leftW + 198}" y="${y}" width="155" height="9" rx="5" fill="#eef2f7"/>
      <rect x="${leftW + 198}" y="${y}" width="${countW}" height="9" rx="5" fill="#2563eb"/>
      <text x="${leftW + 362}" y="${y+8}" font-size="9" fill="#2563eb" font-weight="800">${r.count}</text>
      <rect x="${leftW + 400}" y="${y}" width="155" height="9" rx="5" fill="#eef2f7"/>
      <rect x="${leftW + 400}" y="${y}" width="${progW}" height="9" rx="5" fill="${r.avg >= 80 ? "#16a34a" : r.avg >= 40 ? "#f59e0b" : "#dc2626"}"/>
      <text x="${leftW + 564}" y="${y+8}" font-size="9" fill="#334155" font-weight="800">${r.avg}%</text>`;
  }).join("") : `<text x="${leftW + 18}" y="86" font-size="12" fill="#94a3b8">Категорийн график харуулах мэдээлэл алга</text>`;

  return `
  <div class="chart-box">
    <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Ажлын явцын график">
      <rect x="0" y="0" width="${W}" height="${H}" rx="12" fill="#f8fafc" stroke="#dbe3ef"/>
      <text x="${pad}" y="22" font-size="13" fill="#0f172a" font-weight="900">Төлөвийн график</text>
      <text x="${leftW + 18}" y="22" font-size="13" fill="#0f172a" font-weight="900">Категориор: ажил тоо / дундаж явц</text>
      <text x="${leftW + 198}" y="33" font-size="8" fill="#64748b" font-weight="700">АЖИЛ</text>
      <text x="${leftW + 400}" y="33" font-size="8" fill="#64748b" font-weight="700">ЯВЦ</text>
      <line x1="${leftW}" y1="16" x2="${leftW}" y2="${H-16}" stroke="#dbe3ef"/>
      ${statusSvg}
      ${groupSvg}
    </svg>
  </div>`;
}

function rptPrintCameraChart(cameraData, year, month) {
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  const daily = (cameraData?.daily || [])
    .filter(d => String(d.day || "").startsWith(monthKey) && d.availability_pct != null)
    .sort((a, b) => String(a.day).localeCompare(String(b.day)));
  if (!daily.length) return "";

  const W = 520, H = 220, PL = 44, PR = 58, PT = 38, PB = 32;
  const cw = W - PL - PR;
  const ch = H - PT - PB;
  const pctVals = daily.map(d => Number(d.availability_pct)).filter(Number.isFinite);
  const minY = Math.max(0, Math.floor((Math.min(...pctVals) - 4) / 5) * 5);
  const maxY = 100;
  const range = Math.max(1, maxY - minY);
  const xOf = i => PL + (daily.length > 1 ? i / (daily.length - 1) * cw : cw / 2);
  const yOf = v => PT + ch - ((Math.max(minY, Math.min(maxY, Number(v))) - minY) / range) * ch;

  let grid = "";
  for (let v = minY; v <= maxY + 0.001; v += 5) {
    const y = yOf(v);
    grid += `<line x1="${PL}" y1="${y.toFixed(1)}" x2="${W-PR}" y2="${y.toFixed(1)}" stroke="#e2e8f0"/>`;
    grid += `<text x="${PL-7}" y="${(y+3).toFixed(1)}" font-size="8" fill="#64748b" text-anchor="end">${v}%</text>`;
  }
  const pts = daily.map((d, i) => ({ x: xOf(i), y: yOf(d.availability_pct), v: Number(d.availability_pct), d }));
  const path = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const labels = pts.map((p, i) => {
    const day = String(p.d.day || "").slice(8);
    const showX = daily.length <= 12 || i % 2 === 0 || i === daily.length - 1;
    return `${showX ? `<text x="${p.x.toFixed(1)}" y="${H-8}" font-size="8" fill="#64748b" text-anchor="middle">${day}</text>` : ""}
      <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="#7c3aed" stroke="#fff" stroke-width="1.4"/>`;
  }).join("");
  const last = pts.at(-1);
  const summary = cameraData?.summary || {};

  return `
  <div class="chart-box camera-chart">
    <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Камерын ажиллагааны график">
      <rect x="0" y="0" width="${W}" height="${H}" rx="12" fill="#fbfdff" stroke="#dbe3ef"/>
      <text x="16" y="20" font-size="14" fill="#0f172a" font-weight="900">Камерын ажиллагааны хувь</text>
      <text x="${W-12}" y="20" font-size="10" fill="#475569" text-anchor="end" font-weight="700">
        ${Number(summary.capacity || 0).toLocaleString("mn-MN")} нийт · ${Number(summary.broken_cameras || 0).toLocaleString("mn-MN")} гэмтэл · ${(summary.availability_pct == null ? last?.v : Number(summary.availability_pct)).toFixed(1)}%
      </text>
      ${grid}
      <path d="${path}" fill="none" stroke="#7c3aed" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
      ${labels}
      ${last ? `<text x="${(last.x+8).toFixed(1)}" y="${(last.y+4).toFixed(1)}" font-size="10" fill="#7c3aed" font-weight="900" stroke="#fff" stroke-width="4" paint-order="stroke">${last.v.toFixed(1)}%</text>` : ""}
      <line x1="${PL}" y1="${PT}" x2="${PL}" y2="${H-PB}" stroke="#cbd5e1"/>
      <line x1="${PL}" y1="${H-PB}" x2="${W-PR}" y2="${H-PB}" stroke="#cbd5e1"/>
    </svg>
  </div>`;
}

function rptPrintLightingChart(snaps, year, month) {
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  const rows = (snaps || [])
    .filter(s => String(s.snapshot_date || "").startsWith(monthKey) && s.availability_pct != null)
    .sort((a, b) => String(a.snapshot_date).localeCompare(String(b.snapshot_date)));
  if (!rows.length) return "";

  const cats = [
    { key: "Авто замын гэрэл", color: "#f59e0b", label: "Авто зам" },
    { key: "Гэр хорооллын гэрэл", color: "#0ea5e9", label: "Гэр хороолол" },
    { key: "Цамхагийн гэрэл", color: "#8b5cf6", label: "Цамхаг" },
    { key: "Гэрлэн дохио", color: "#10b981", label: "Дохио" },
  ];
  const byDate = {};
  rows.forEach(s => {
    const d = String(s.snapshot_date || "").slice(0, 10);
    if (!byDate[d]) byDate[d] = {};
    byDate[d][s.category] = Number(s.availability_pct);
  });
  const dates = Object.keys(byDate).sort();
  const values = [];
  dates.forEach(d => cats.forEach(c => {
    if (byDate[d][c.key] != null) values.push(byDate[d][c.key]);
  }));
  if (!dates.length || !values.length) return "";

  const W = 520, H = 220, PL = 44, PR = 72, PT = 50, PB = 32;
  const cw = W - PL - PR;
  const ch = H - PT - PB;
  const minY = Math.max(0, Math.floor((Math.min(...values) - 4) / 5) * 5);
  const maxY = Math.min(100, Math.max(100, Math.ceil(Math.max(...values) / 5) * 5));
  const range = Math.max(1, maxY - minY);
  const xOf = i => PL + (dates.length > 1 ? i / (dates.length - 1) * cw : cw / 2);
  const yOf = v => PT + ch - ((Math.max(minY, Math.min(maxY, Number(v))) - minY) / range) * ch;

  let grid = "";
  for (let v = minY; v <= maxY + 0.001; v += 5) {
    const y = yOf(v);
    grid += `<line x1="${PL}" y1="${y.toFixed(1)}" x2="${W-PR}" y2="${y.toFixed(1)}" stroke="#e2e8f0"/>`;
    grid += `<text x="${PL-6}" y="${(y+3).toFixed(1)}" font-size="8" fill="#64748b" text-anchor="end">${v}%</text>`;
  }
  const labelSlots = [];
  function labelYFor(x, y) {
    let ly = y + 3;
    for (let i = 0; i < 8 && labelSlots.some(s => Math.abs(s.x - x) < 42 && Math.abs(s.y - ly) < 12); i++) {
      ly = y + 3 + (i % 2 === 0 ? -1 : 1) * 12 * Math.ceil((i + 1) / 2);
      ly = Math.max(PT + 8, Math.min(H - PB - 8, ly));
    }
    labelSlots.push({ x, y: ly });
    return ly;
  }
  const lines = cats.map(c => {
    const pts = dates.map((d, i) => byDate[d][c.key] == null ? null : { x: xOf(i), y: yOf(byDate[d][c.key]), v: byDate[d][c.key] }).filter(Boolean);
    if (!pts.length) return "";
    const path = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    const last = pts.at(-1);
    const lastLabelY = labelYFor(last.x + 6, last.y);
    return `<path d="${path}" fill="none" stroke="${c.color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
      ${pts.map(p => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.8" fill="${c.color}" stroke="#fff" stroke-width="1"/>`).join("")}
      <text x="${(last.x+6).toFixed(1)}" y="${lastLabelY.toFixed(1)}" font-size="8.5" fill="${c.color}" font-weight="900" stroke="#fff" stroke-width="3" paint-order="stroke">${last.v.toFixed(1)}%</text>`;
  }).join("");
  const xLabels = dates.map((d, i) => {
    const show = dates.length <= 10 || i % 2 === 0 || i === dates.length - 1;
    return show ? `<text x="${xOf(i).toFixed(1)}" y="${H-7}" font-size="8" fill="#64748b" text-anchor="middle">${d.slice(8)}</text>` : "";
  }).join("");
  const legend = cats.map((c, i) => `<text x="${16 + i * 118}" y="35" font-size="8.5" fill="${c.color}" font-weight="800">━ ${c.label}</text>`).join("");

  return `
  <div class="chart-box lighting-chart">
    <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Гэрэлтүүлгийн асалтын график">
      <rect x="0" y="0" width="${W}" height="${H}" rx="12" fill="#fbfdff" stroke="#dbe3ef"/>
      <text x="16" y="20" font-size="14" fill="#0f172a" font-weight="900">Гэрэлтүүлгийн асалтын хувь</text>
      ${legend}
      ${grid}${lines}${xLabels}
      <line x1="${PL}" y1="${PT}" x2="${PL}" y2="${H-PB}" stroke="#cbd5e1"/>
      <line x1="${PL}" y1="${H-PB}" x2="${W-PR}" y2="${H-PB}" stroke="#cbd5e1"/>
    </svg>
  </div>`;
}

async function printWorkReport(year, month, withImages = false) {
  document.getElementById("rptYear")?.blur();
  document.getElementById("rptMonth")?.blur();
  const MN_MONTHS = ["","1-р сар","2-р сар","3-р сар","4-р сар","5-р сар",
    "6-р сар","7-р сар","8-р сар","9-р сар","10-р сар","11-р сар","12-р сар"];

  let allWork = [], execs = [];
  try { allWork = await api("/api/work-logs"); } catch(e) {}
  try { execs   = await api(`/api/executions?year=${year}`); } catch(e) {}
  const execMap = rptExecMap(execs);

  const mm = String(month).padStart(2,"0");
  const prefix = `${year}-${mm}`;
  const execWorkIdsInMonth = new Set();
  for (const e of execs) {
    if ((e.start_date || "").startsWith(prefix) || (e.end_date || "").startsWith(prefix)) {
      execWorkIdsInMonth.add(e.work_log_id);
    }
  }
  const filtered = rptWorkRows(allWork.filter(r => {
    const d = r.start_date || r.work_date || "";
    return d.startsWith(prefix) || (r.end_date||"").startsWith(prefix) ||
           execWorkIdsInMonth.has(r.id);
  }).filter(r => _rptCatFilter.size === 0 || _rptCatFilter.has(r.category || "")), execMap);

  const done    = filtered.filter(r=>["Хаагдсан","Дууссан"].includes(r.status)).length;
  const ongoing = filtered.filter(r=>r.status==="Явцтай").length;
  const waiting = filtered.length - done - ongoing;
  const avgProg = filtered.length ? Math.round(filtered.reduce((a,r)=>a+(r._displayProgress||0),0)/filtered.length) : 0;
  const chartHtml = rptPrintChart(filtered);
  let cameraChartHtml = "";
  let lightingChartHtml = "";
  try {
    const cameraData = await api(`/api/camera-analytics?year=${year}`);
    cameraChartHtml = rptPrintCameraChart(cameraData, year, month);
  } catch(e) {
    cameraChartHtml = "";
  }
  try {
    const lightingSnaps = await api(`/api/sl-daily-snapshots?year=${year}`);
    lightingChartHtml = rptPrintLightingChart(lightingSnaps, year, month);
  } catch(e) {
    lightingChartHtml = "";
  }
  const availabilityChartsHtml = (cameraChartHtml || lightingChartHtml)
    ? `<div class="availability-grid">${lightingChartHtml}${cameraChartHtml}</div>`
    : "";

  // Зурагтай хэвлэх үед бүх гүйцэтгэлийн зургийг татна
  let photoMap = {};
  if (withImages && execs.length) {
    const results = await Promise.all(
      execs.map(e => api(`/api/executions/${e.id}/photos`)
        .then(photos => ({ id: e.id, photos }))
        .catch(() => ({ id: e.id, photos: [] })))
    );
    results.forEach(({ id, photos }) => { photoMap[id] = photos; });
  }

  let rowNo = 0;
  const rows = rptGroupByCategory(filtered).map(group => {
    const groupDone = group.items.filter(r => rptIsDoneStatus(r.status)).length;
    const groupAvg = group.items.length
      ? Math.round(group.items.reduce((s, r) => s + Number(r._displayProgress || 0), 0) / group.items.length)
      : 0;
    const body = group.items.map(r => {
      rowNo++;
      const wExecs = r._execs || [];
      const workBadges = [
        r._overdue ? `<span class="badge red">Хугацаа хэтэрсэн</span>` : "",
        Number(r.material_count || 0) > 0 ? `<span class="badge blue">Материал ${r.material_count}</span>` : "",
        Number(r.photo_count || 0) > 0 || wExecs.some(e => Number(e.photo_count || 0) > 0) ? `<span class="badge green">Зурагтай</span>` : "",
        r.confirm_status === "confirmed" ? `<span class="badge green">Батлагдсан</span>` : "",
      ].join("");
      return `
      <tr class="${r._overdue ? "overdue" : ""}">
        <td style="text-align:center">${rowNo}</td>
        <td><b>${escapeHtml(r.title||"")}</b><br><span class="muted">${escapeHtml(r.location||"")}</span><div>${workBadges}</div></td>
        <td style="text-align:center;white-space:nowrap">${r.start_date||r.work_date||""}</td>
        <td style="text-align:center;white-space:nowrap">${r.end_date||""}</td>
        <td>${escapeHtml(r.material_note||"")}</td>
        <td style="text-align:center;font-weight:700">${r._displayProgress||0}%</td>
        <td style="text-align:center">${escapeHtml(r.status||"")}</td>
        <td>${wExecs.map((ex,j)=>`<div class="exec"><b>Г${j+1}:</b> ${escapeHtml(ex.title||"")}
          <span class="muted">(${ex.start_date||""} ~ ${ex.end_date||""}, ${ex.progress||0}%)</span>
          ${ex.workers?`<br><small>Ажилчид: ${escapeHtml(ex.workers)}</small>`:""}
          ${ex.note?`<br><small>Тайлбар: ${escapeHtml(ex.note)}</small>`:""}
          ${withImages && photoMap[ex.id]?.length ? `<div class="photos">${photoMap[ex.id].slice(0,4).map(p=>`<img src="${escapeHtml(reportPhotoSrc(p))}">`).join("")}</div>` : ""}
        </div>`).join("")||"—"}</td>
      </tr>`;
    }).join("");
    return `
      <tr class="cat-row">
        <td colspan="8">${escapeHtml(group.category)} · ${group.items.length} ажил · Дууссан ${groupDone} · Дундаж явц ${groupAvg}%</td>
      </tr>
      ${body}`;
  }).join("");

  const html = `<!DOCTYPE html><html lang="mn"><head><meta charset="utf-8">
  <title>Ажлын явцын тайлан — ${MN_MONTHS[month]} ${year} он${_rptCatFilter.size ? " · " + [..._rptCatFilter].join(", ") : ""}${withImages ? " · Зурагтай" : ""}</title>
  <style>
    @page { size: A4 landscape; margin: 8mm; }
    body { font-family: 'Arial', sans-serif; font-size: 9.5pt; margin: 0; color: #000; }
    .header { text-align: center; margin-bottom: 8px; border-bottom: 2px solid #000; padding-bottom: 6px; }
    .header h2 { margin: 2px 0; font-size: 13pt; }
    .header p  { margin: 1px 0; font-size: 9pt; color: #444; }
    .summary { display: flex; gap: 8px; margin-bottom: 8px; }
    .sum-box { border: 1px solid #ccc; border-radius: 5px; padding: 5px 10px; text-align: center; flex: 1; }
    .sum-box b { font-size: 14pt; display: block; }
    .sum-box span { font-size: 8pt; color: #666; }
    .chart-box { margin: 4px 0 5px; break-inside: avoid; page-break-inside: avoid; }
    .chart-box svg { display:block; width:100%; max-height:39mm; }
    .camera-chart svg, .lighting-chart svg { max-height:58mm; }
    .availability-grid { display:flex; gap:7px; margin: -1px 0 6px; break-inside: avoid; page-break-inside: avoid; }
    .availability-grid .chart-box { flex:1; margin:0; min-width:0; }
    table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
    th { background: #1d4ed8; color: #fff; padding: 4px 6px; text-align: left; font-size: 8pt; }
    td { padding: 3px 5px; border-bottom: 1px solid #e0e0e0; vertical-align: top; }
    tr:nth-child(even) td { background: #f5f7ff; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    .cat-row td { background:#dbeafe!important; color:#1e40af; font-weight:800; padding:5px 7px; border-top:2px solid #1d4ed8; }
    .overdue td { background:#fff7ed!important; }
    .muted { font-size:8pt;color:#666; }
    .badge { display:inline-block;margin:2px 3px 0 0;padding:1px 5px;border-radius:10px;font-size:7.5pt;font-weight:700; }
    .badge.red { background:#fee2e2;color:#dc2626; }
    .badge.blue { background:#e0f2fe;color:#0284c7; }
    .badge.green { background:#dcfce7;color:#16a34a; }
    .exec { margin-bottom:3px;padding:3px 5px;border-left:2px solid #6366f1;background:#f8fafc;break-inside:avoid; }
    .photos { display:grid;grid-template-columns:repeat(4,1fr);gap:3px;margin-top:3px;max-width:360px; }
    .photos img { width:100%;height:58px;object-fit:cover;border:1px solid #ccc;border-radius:2px;print-color-adjust:exact; }
    .footer { margin-top: 16px; display: flex; justify-content: space-between; }
    .sign { text-align: center; border-top: 1px solid #000; padding-top: 5px; width: 180px; font-size: 9pt; }
    @media print { img { page-break-inside: avoid; max-width: 100%; } }
  </style></head><body>
  <div class="header">
    <div style="font-size:11pt;margin-bottom:4px">ЧОЙБАЛСАН ХӨГЖИЛ ОНӨҮГ</div>
    <h2>АЖЛЫН ЯВЦЫН ТАЙЛАН</h2>
    <p>${MN_MONTHS[month]} ${year} он · Нийт: ${filtered.length} ажил · Гүйцэтгэл: ${avgProg}%${_rptCatFilter.size ? ` · Категори: ${[..._rptCatFilter].join(", ")}` : ""}</p>
    <p style="font-size:9pt;color:#666">Тайлан гарсан огноо: ${new Date().toLocaleDateString("mn-MN")}</p>
  </div>
  <div class="summary">
    <div class="sum-box"><b>${filtered.length}</b><span>Нийт ажил</span></div>
    <div class="sum-box" style="border-color:#16a34a"><b style="color:#16a34a">${done}</b><span>Дууссан</span></div>
    <div class="sum-box" style="border-color:#6366f1"><b style="color:#6366f1">${ongoing}</b><span>Явцтай</span></div>
    <div class="sum-box" style="border-color:#d97706"><b style="color:#d97706">${waiting}</b><span>Хүлээгдэж буй</span></div>
    <div class="sum-box" style="border-color:#2563eb"><b style="color:#2563eb">${avgProg}%</b><span>Дундаж явц</span></div>
  </div>
  ${chartHtml}
  ${availabilityChartsHtml}
  <table>
    <thead><tr>
      <th style="width:28px">#</th>
      <th style="width:18%">Ажлын нэр / Байршил</th>
      <th style="width:70px">Эхлэх</th>
      <th style="width:70px">Дуусах</th>
      <th style="width:15%">Ажилчид</th>
      <th style="width:45px">Явц%</th>
      <th style="width:70px">Төлөв</th>
      <th>Гүйцэтгэл</th>
    </tr></thead>
    <tbody>${rows||`<tr><td colspan="8" style="text-align:center;padding:20px;color:#999">Мэдээлэл байхгүй</td></tr>`}</tbody>
  </table>
  <div class="footer">
    <div class="sign">Тайлан гаргасан:<br><br>.....................<br>${new Date().toLocaleDateString("mn-MN")}</div>
    <div class="sign">Ахлах инженер:<br><br>.....................<br></div>
    <div class="sign">Захирал:<br><br>.....................<br></div>
  </div>
  <script>window.onload=()=>window.print();<\/script>
  </body></html>`;

  const w = window.open("", "_blank");
  if (w) { w.document.write(html); w.document.close(); }
  else toast("Popup блоклогдсон байна. Хөтчийн popup зөвшөөрлийг тохируулна уу.");
}

async function audit() {
  const rows = await api("/api/audit-logs");

  main.innerHTML = `
  <h1>Audit log</h1>
  <div class="panel">
    ${table(
      ["Огноо","Хэрэглэгч","Үйлдэл","Дэлгэрэнгүй"],
      rows.map(r => [r.created_at, r.full_name || "", r.action, r.detail || ""])
    )}
  </div>`;
}

function workReportSnapshotHtml(snap, autoPrint = false) {
  const d = snap.data || snap;
  const MN_MONTHS = ["","1-р сар","2-р сар","3-р сар","4-р сар","5-р сар","6-р сар","7-р сар","8-р сар","9-р сар","10-р сар","11-р сар","12-р сар"];
  const summary = d.summary || {};
  let rowNo = 0;
  const rows = rptGroupByCategory(d.rows || []).map(group => {
    const body = group.items.map(r => {
      rowNo++;
      const execs = (r.executions || []).map((ex, i) => `
        <div class="exec"><b>Г${i + 1}:</b> ${escapeHtml(ex.title || "")}
          <span class="muted">(${escapeHtml(ex.start_date || "")} ~ ${escapeHtml(ex.end_date || "")}, ${Number(ex.progress || 0)}%)</span>
          ${ex.workers ? `<br><small>Ажилчид: ${escapeHtml(ex.workers)}</small>` : ""}
          ${ex.note ? `<br><small>Тайлбар: ${escapeHtml(ex.note)}</small>` : ""}
        </div>`).join("");
      return `
      <tr class="${r.overdue ? "overdue" : ""}">
        <td style="text-align:center">${rowNo}</td>
        <td><b>${escapeHtml(r.title || "")}</b><br><span class="muted">${escapeHtml(r.location || "")}</span></td>
        <td style="text-align:center;white-space:nowrap">${escapeHtml(r.start_date || "")}</td>
        <td style="text-align:center;white-space:nowrap">${escapeHtml(r.end_date || "")}</td>
        <td>${escapeHtml(r.workers || "")}</td>
        <td style="text-align:center;font-weight:700">${Number(r.progress || 0)}%</td>
        <td style="text-align:center">${escapeHtml(r.status || "")}</td>
        <td>${execs || "—"}</td>
      </tr>`;
    }).join("");
    return `<tr class="cat-row"><td colspan="8">${escapeHtml(group.category)} · ${group.items.length} ажил</td></tr>${body}`;
  }).join("");
  const savedAt = (snap.updated_at || snap.saved_at || d.saved_at || "").slice(0, 16);
  const savedBy = snap.created_name ? ` · Хадгалсан: ${escapeHtml(snap.created_name)}` : "";
  return `<!DOCTYPE html><html lang="mn"><head><meta charset="utf-8">
  <title>${escapeHtml(snap.title || "Ажлын явцын тайлан")}</title>
  <style>
    @page { size:A4 landscape; margin:8mm; }
    body { font-family:Arial,sans-serif; font-size:9.5pt; color:#000; margin:0; }
    .header { text-align:center; border-bottom:2px solid #000; padding-bottom:7px; margin-bottom:8px; }
    .header h2 { margin:3px 0; font-size:13pt; }
    .header p { margin:2px 0; color:#444; }
    .summary { display:flex; gap:8px; margin-bottom:8px; }
    .sum-box { flex:1; border:1px solid #ccc; border-radius:5px; padding:6px 10px; text-align:center; }
    .sum-box b { display:block; font-size:14pt; }
    .sum-box span { color:#666; font-size:8pt; }
    table { width:100%; border-collapse:collapse; font-size:8.5pt; }
    th { background:#1d4ed8; color:#fff; padding:4px 6px; text-align:left; font-size:8pt; }
    td { padding:3px 5px; border-bottom:1px solid #e0e0e0; vertical-align:top; }
    tr:nth-child(even) td { background:#f5f7ff; }
    tr { break-inside:avoid; page-break-inside:avoid; }
    .cat-row td { background:#dbeafe!important; color:#1e40af; font-weight:800; border-top:2px solid #1d4ed8; }
    .overdue td { background:#fff7ed!important; }
    .muted { color:#666; font-size:8pt; }
    .exec { margin-bottom:3px; padding:3px 5px; border-left:2px solid #6366f1; background:#f8fafc; break-inside:avoid; }
    .footer { margin-top:16px; display:flex; justify-content:space-between; }
    .sign { text-align:center; border-top:1px solid #000; padding-top:5px; width:180px; font-size:9pt; }
  </style></head><body>
  <div class="header">
    <div style="font-size:11pt;margin-bottom:4px">ЧОЙБАЛСАН ХӨГЖИЛ ОНӨҮГ</div>
    <h2>АЖЛЫН ЯВЦЫН ХАДГАЛСАН ТАЙЛАН</h2>
    <p>${MN_MONTHS[d.month || snap.month] || ""} ${d.year || snap.year} он · ${escapeHtml((d.filter || snap.filter || []).join(", ") || "Бүх категори")}</p>
    <p style="font-size:9pt;color:#666">Хадгалсан: ${escapeHtml(savedAt || "—")}${savedBy}</p>
  </div>
  <div class="summary">
    <div class="sum-box"><b>${summary.total || 0}</b><span>Нийт ажил</span></div>
    <div class="sum-box"><b style="color:#16a34a">${summary.done || 0}</b><span>Дууссан</span></div>
    <div class="sum-box"><b style="color:#6366f1">${summary.ongoing || 0}</b><span>Явцтай</span></div>
    <div class="sum-box"><b style="color:#d97706">${summary.waiting || 0}</b><span>Хүлээгдэж буй</span></div>
    <div class="sum-box"><b style="color:#2563eb">${summary.avg_progress || 0}%</b><span>Дундаж явц</span></div>
  </div>
  <table>
    <thead><tr><th style="width:28px">#</th><th>Ажлын нэр / Байршил</th><th>Эхлэх</th><th>Дуусах</th><th>Ажилчид</th><th>Явц%</th><th>Төлөв</th><th>Гүйцэтгэл</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="8" style="text-align:center;padding:20px;color:#999">Мэдээлэл байхгүй</td></tr>`}</tbody>
  </table>
  <div class="footer">
    <div class="sign">Тайлан гаргасан:<br><br>.....................<br></div>
    <div class="sign">Ахлах инженер:<br><br>.....................<br></div>
    <div class="sign">Захирал:<br><br>.....................<br></div>
  </div>
  ${autoPrint ? `<script>window.onload=()=>window.print();<\/script>` : ""}
  </body></html>`;
}

async function saveWorkReportSnapshot(year, month) {
  const label = _rptCatFilter.size ? [..._rptCatFilter].join(", ") : "Бүх категори";
  if (!confirm(`${year} оны ${month}-р сарын "${label}" ажлын явцын тайланг хадгалах уу?\n(Өмнө хадгалсан ижил сарын/категорийн тайлан байвал шинэчлэгдэнэ)`)) return;
  try {
    const data = await buildWorkReportSnapshot(year, month);
    const title = `Ажлын явцын тайлан ${year}-${String(month).padStart(2, "0")} · ${label}`;
    await api("/api/work-report-snapshots", {
      method: "POST",
      body: JSON.stringify({ year, month, title, filter: data.filter, data }),
    });
    toast("Тайлан хадгалагдлаа");
    showWorkReportSnapshots(year, month);
  } catch(e) { toast("Алдаа: " + e.message); }
}

async function showWorkReportSnapshots(year, month) {
  let rows = [];
  try { rows = await api(`/api/work-report-snapshots?year=${year}&month=${month}`); }
  catch(e) { toast(e.message); return; }
  const old = document.getElementById("workReportSnapModal");
  if (old) old.remove();
  const modal = document.createElement("div");
  modal.id = "workReportSnapModal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:1200;display:flex;align-items:center;justify-content:center;padding:18px";
  modal.innerHTML = `
    <div style="background:#fff;border-radius:12px;width:min(760px,96vw);max-height:84vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.22)">
      <div style="padding:16px 18px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;gap:12px;align-items:center">
        <div>
          <div style="font-size:16px;font-weight:900;color:#0f172a">📂 Хадгалсан ажлын тайлан</div>
          <div style="font-size:12px;color:#64748b;margin-top:2px">${year} оны ${month}-р сар</div>
        </div>
        <button class="btn secondary" onclick="document.getElementById('workReportSnapModal')?.remove()">Хаах</button>
      </div>
      <div style="padding:14px 18px">
        ${rows.length ? rows.map(r => `
          <div style="border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;margin-bottom:10px;display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap">
            <div style="min-width:0">
              <div style="font-size:13px;font-weight:900;color:#0f172a">${escapeHtml(r.title || "")}</div>
              <div style="font-size:11px;color:#64748b;margin-top:3px">Хадгалсан: ${(r.updated_at || r.created_at || "").slice(0,16)} · ${escapeHtml(r.created_name || "")}</div>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button class="btn secondary" style="padding:6px 10px;font-size:12px" onclick="openWorkReportSnapshot(${r.id},false)">Харах</button>
              <button class="btn" style="padding:6px 10px;font-size:12px" onclick="openWorkReportSnapshot(${r.id},true)">Хэвлэх</button>
              <button class="btn" style="padding:6px 10px;font-size:12px;background:#0ea5e9;border-color:#0ea5e9" onclick="downloadWorkReportSnapshot(${r.id})">Татах</button>
            </div>
          </div>`).join("") : `<div style="text-align:center;color:#94a3b8;padding:28px">Хадгалсан тайлан байхгүй байна</div>`}
      </div>
    </div>`;
  document.body.appendChild(modal);
}

async function openWorkReportSnapshot(id, autoPrint = false) {
  try {
    const snap = await api(`/api/work-report-snapshots/${id}`);
    const w = window.open("", "_blank");
    if (!w) { toast("Popup блоклогдсон байна"); return; }
    w.document.write(workReportSnapshotHtml(snap, autoPrint));
    w.document.close();
  } catch(e) { toast(e.message); }
}

async function downloadWorkReportSnapshot(id) {
  try {
    const snap = await api(`/api/work-report-snapshots/${id}`);
    const html = workReportSnapshotHtml(snap, false);
    const ym = `${snap.year}-${String(snap.month).padStart(2, "0")}`;
    downloadHtmlFile(`${ym}-ajliin-yavtsiin-hadgalsan-tailan.html`, html);
    toast("Тайлан HTML файл болж татагдлаа");
  } catch(e) { toast(e.message); }
}

async function downloadLiveWorkReport(year, month) {
  try {
    const data = await buildWorkReportSnapshot(year, month);
    const label = data.filter.length ? data.filter.join(", ") : "Бүх категори";
    const snap = {
      year,
      month,
      title: `Ажлын явцын тайлан ${year}-${String(month).padStart(2, "0")} · ${label}`,
      filter: data.filter,
      data,
      updated_at: data.saved_at,
      created_name: state.me?.full_name || "",
    };
    const html = workReportSnapshotHtml(snap, false);
    downloadHtmlFile(`${year}-${String(month).padStart(2, "0")}-ajliin-yavtsiin-tailan.html`, html);
    toast("Одоогийн тайлан HTML файл болж татагдлаа");
  } catch(e) { toast("Алдаа: " + e.message); }
}

// ── Нэгтгэсэн сарын тайлан ───────────────────────────────────

let _unifiedViewMode = 'live'; // 'live' | 'snap'

async function reports_unified() {
  const now = new Date();
  const MN_MONTHS = ["","1-р сар","2-р сар","3-р сар","4-р сар","5-р сар",
    "6-р сар","7-р сар","8-р сар","9-р сар","10-р сар","11-р сар","12-р сар"];
  const role = state.me?.role || "";
  const canFinance = ["director","accountant","chief_engineer"].includes(role);
  const canHR      = ["director","hr","chief_engineer"].includes(role);
  const canSave    = ["director","chief_engineer"].includes(role);

  const savedY = document.getElementById("unifiedYear")?.value;
  const savedM = document.getElementById("unifiedMonth")?.value;
  const initYear  = savedY ? Number(savedY)  : now.getFullYear();
  const initMonth = savedM ? Number(savedM)  : now.getMonth() + 1;

  main.innerHTML = `<div style="text-align:center;padding:40px;color:#667085">⏳ Уншиж байна...</div>`;

  let d, snapMeta = null;
  try {
    const [liveData, snapList] = await Promise.all([
      api(`/api/monthly-report-unified?year=${initYear}&month=${initMonth}`),
      api(`/api/unified-report-snapshots?year=${initYear}&month=${initMonth}`).catch(() => []),
    ]);
    const snap = Array.isArray(snapList) ? (snapList[0] || null) : null;
    if (_unifiedViewMode === 'snap' && snap) {
      const snapFull = await api(`/api/unified-report-snapshots/${initYear}/${initMonth}/data`).catch(() => null);
      if (snapFull) { d = snapFull; snapMeta = snap; }
      else { d = liveData; _unifiedViewMode = 'live'; }
    } else {
      d = liveData;
      if (_unifiedViewMode === 'snap') _unifiedViewMode = 'live';
    }
    snapMeta = snap;
  } catch(e) {
    main.innerHTML = `<div style="padding:30px;color:#dc2626">Алдаа: ${escapeHtml(e.message)}</div>`;
    return;
  }

  const fmt = n => Number(n||0).toLocaleString("mn-MN");
  const kpi = (label, val, color, sub="") => `
    <div style="background:#fff;border:1px solid #e2e6ed;border-radius:12px;padding:14px 16px;border-top:3px solid ${color}">
      <div style="font-size:10px;color:#667085;margin-bottom:4px;text-transform:uppercase;letter-spacing:.4px">${label}</div>
      <div style="font-size:22px;font-weight:900;color:${color}">${val}</div>
      ${sub ? `<div style="font-size:10px;color:#94a3b8;margin-top:2px">${sub}</div>` : ""}
    </div>`;

  const workByCat = (d.work.by_category || []).map(c => `
    <tr style="border-bottom:1px solid #f1f5f9">
      <td style="padding:8px 12px;font-weight:700;font-size:12px">${escapeHtml(c.category||"—")}</td>
      <td style="padding:8px 12px;text-align:center;font-weight:700;color:#2563eb">${c.total}</td>
      <td style="padding:8px 12px;text-align:center;color:#16a34a">${c.closed}</td>
      <td style="padding:8px 12px;text-align:center;color:#6366f1">${c.active}</td>
      <td style="padding:8px 12px;text-align:center;color:#f59e0b">${c.hse_wait||0}</td>
      <td style="padding:8px 12px;text-align:center;color:#8b5cf6">${c.pend_final||0}</td>
      <td style="padding:8px 12px;text-align:center;color:#dc2626">${c.rejected}</td>
      <td style="padding:8px 12px;text-align:center">
        <span style="font-weight:700;color:${c.avg_progress>=80?'#16a34a':c.avg_progress>=50?'#d97706':'#dc2626'}">${c.avg_progress}%</span>
      </td>
    </tr>`).join("");

  const matRows = (d.materials.by_work || []).slice(0,15).map(g => `
    <tr style="border-bottom:1px solid #f1f5f9">
      <td style="padding:8px 12px;font-weight:700;font-size:12px">${escapeHtml(g.label||"—")}</td>
      <td style="padding:8px 12px;text-align:right;font-weight:700;color:#0ea5e9">${fmt(g.total)}₮</td>
      <td style="padding:8px 12px;font-size:11px;color:#667085">
        ${g.lines.map(l=>`${escapeHtml(l.name||"")} ${fmt(l.qty)} ${escapeHtml(l.unit||"")}`).join(", ")}
      </td>
    </tr>`).join("");

  const hrRows = (d.hr.records || []).map(r => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #f1f5f9">
      <span style="font-size:12px">${escapeHtml(r.record_type||"—")}</span>
      <span style="font-weight:800;color:#2563eb;font-size:14px">${r.count}</span>
    </div>`).join("");

  const isSnap = _unifiedViewMode === 'snap' && snapMeta;
  const snapLabel = snapMeta
    ? `💾 Хадгалсан · ${(snapMeta.updated_at||snapMeta.created_at||"").slice(0,10)} · ${escapeHtml(snapMeta.created_name||"")}`
    : "💾 Хадгалсан байхгүй";

  main.innerHTML = `
  <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:18px;flex-wrap:wrap;gap:10px">
    <div>
      <h1 style="margin:0 0 2px">📊 Нэгтгэсэн тайлан</h1>
      <div style="font-size:12px;color:#667085">Unified Monthly Report · ${MN_MONTHS[initMonth]} ${initYear}</div>
      ${isSnap ? `<div style="font-size:11px;color:#d97706;margin-top:3px;font-weight:700">📌 Хадгалсан хувилбар харж байна — ${(snapMeta.updated_at||"").slice(0,16)}</div>` : ""}
    </div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <select id="unifiedYear" class="input" style="width:80px" onchange="reports_unified()">
        ${[2024,2025,2026,2027].map(y=>`<option value="${y}" ${y===initYear?"selected":""}>${y}</option>`).join("")}
      </select>
      <select id="unifiedMonth" class="input" style="width:100px" onchange="reports_unified()">
        ${MN_MONTHS.slice(1).map((m,i)=>`<option value="${i+1}" ${i+1===initMonth?"selected":""}>${m}</option>`).join("")}
      </select>
      <!-- Live / Snapshot toggle -->
      <div style="display:flex;border:1.5px solid #e2e6ed;border-radius:8px;overflow:hidden">
        <button onclick="_unifiedViewMode='live';reports_unified()"
          style="padding:5px 12px;border:none;cursor:pointer;font-size:12px;font-weight:700;
                 background:${!isSnap?'#2563eb':'#fff'};color:${!isSnap?'#fff':'#667085'}">
          📊 Live
        </button>
        <button onclick="_unifiedViewMode='snap';reports_unified()"
          title="${snapLabel}"
          style="padding:5px 12px;border:none;border-left:1.5px solid #e2e6ed;cursor:pointer;font-size:12px;font-weight:700;
                 background:${isSnap?'#d97706':'#fff'};color:${isSnap?'#fff':snapMeta?'#d97706':'#94a3b8'}">
          💾 ${snapMeta ? (snapMeta.updated_at||"").slice(0,10) : "Хадгаагүй"}
        </button>
      </div>
      ${canSave ? `<button class="btn" onclick="unifiedSaveSnapshot(${initYear},${initMonth})"
        style="padding:6px 14px;background:#16a34a;border-color:#16a34a">💾 Хадгалах</button>` : ""}
      <button class="btn" onclick="printUnifiedReport()" style="padding:6px 14px;background:#6366f1;border-color:#6366f1">🖨️ Хэвлэх</button>
    </div>
  </div>

  <!-- KPI row -->
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:18px">
    ${kpi("Нийт ажил",      d.work.total,         "#2563eb")}
    ${kpi("Хаагдсан",       d.work.closed,        "#16a34a", `${d.work.avg_progress}% дундаж`)}
    ${kpi("Явцтай",         d.work.active,        "#6366f1")}
    ${kpi("ХАБЭА хүлээж",   d.work.hse_waiting,   "#f59e0b")}
    ${kpi("Батламж хүлээж", d.work.pending_final, "#8b5cf6")}
    ${kpi("Хугацаа хэтэрсэн", d.work.overdue,    "#dc2626")}
    ${kpi("Нээлттэй эрсдэл", d.hse.open_risks,   "#f59e0b", `${d.hse.high_risks} өндөр`)}
    ${kpi("Материал",       fmt(d.materials.total_amount)+"₮", "#0ea5e9")}
    ${canFinance ? kpi("Орлого",  fmt(d.finance.income)+"₮",  "#10b981") : ""}
    ${canFinance ? kpi("Зарлага", fmt(d.finance.expense)+"₮", "#f43f5e") : ""}
    ${kpi("Нийт тээвэр", d.vehicles.total, "#8b5cf6", `${d.vehicles.in_repair} засварт`)}
  </div>

  <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:16px">
    <!-- Work by category -->
    <div class="panel" style="padding:0;overflow:hidden">
      <div style="padding:12px 16px;font-weight:800;font-size:13px;border-bottom:1px solid #f1f5f9">
        🔧 Ажлын категориор
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr style="background:#f8fafc">
            <th style="padding:8px 12px;text-align:left;font-size:10px;color:#667085;font-weight:700">КАТЕГОРИ</th>
            <th style="padding:8px 12px;text-align:center;font-size:10px;color:#667085;font-weight:700">НИЙТ</th>
            <th style="padding:8px 12px;text-align:center;font-size:10px;color:#667085;font-weight:700">ХААГДСАН</th>
            <th style="padding:8px 12px;text-align:center;font-size:10px;color:#667085;font-weight:700">ЯВЦТАЙ</th>
            <th style="padding:8px 12px;text-align:center;font-size:10px;color:#f59e0b;font-weight:700">ХАБЭА ХҮЛЭЭЖ</th>
            <th style="padding:8px 12px;text-align:center;font-size:10px;color:#8b5cf6;font-weight:700">БАТЛАМЖ ХҮЛЭЭЖ</th>
            <th style="padding:8px 12px;text-align:center;font-size:10px;color:#667085;font-weight:700">БУЦААСАН</th>
            <th style="padding:8px 12px;text-align:center;font-size:10px;color:#667085;font-weight:700">ДУН%</th>
          </tr>
        </thead>
        <tbody>
          ${workByCat || `<tr><td colspan="8" style="padding:20px;text-align:center;color:#94a3b8">Мэдээлэл байхгүй</td></tr>`}
        </tbody>
      </table>
    </div>

    <!-- HSE + HR sidebar -->
    <div style="display:flex;flex-direction:column;gap:14px">
      <div class="panel" style="padding:14px">
        <div style="font-weight:800;font-size:13px;margin-bottom:10px">🦺 ХАБЭА</div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9">
          <span style="font-size:12px;color:#667085">Нээлттэй эрсдэл</span>
          <span style="font-weight:700;color:#f59e0b">${d.hse.open_risks}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9">
          <span style="font-size:12px;color:#667085">Өндөр эрсдэл</span>
          <span style="font-weight:700;color:#dc2626">${d.hse.high_risks}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:6px 0">
          <span style="font-size:12px;color:#667085">Шинэ эрсдэл</span>
          <span style="font-weight:700;color:#2563eb">${d.hse.new_risks}</span>
        </div>
        ${d.hse.snapshot ? `
        <div style="margin-top:10px;padding:8px;background:#f0fdf4;border-radius:8px;border:1px solid #bbf7d0;font-size:11px">
          ✅ <b>${escapeHtml(d.hse.snapshot.title||"ХАБЭА хадгалсан")}</b>
          <div style="color:#667085;margin-top:2px">${(d.hse.snapshot.saved_at||"").slice(0,10)}</div>
        </div>` : ""}
      </div>

      ${canHR ? `<div class="panel" style="padding:14px">
        <div style="font-weight:800;font-size:13px;margin-bottom:8px">👥 HR (${d.hr.total} бүртгэл)</div>
        ${hrRows || `<div style="color:#94a3b8;font-size:12px">Мэдээлэл байхгүй</div>`}
      </div>` : ""}
    </div>
  </div>

  <!-- Materials -->
  ${d.materials.total_amount > 0 ? `
  <div class="panel" style="padding:0;overflow:hidden;margin-bottom:16px">
    <div style="padding:12px 16px;font-weight:800;font-size:13px;border-bottom:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center">
      <span>📦 Материал зарцуулалт</span>
      <span style="font-size:14px;font-weight:900;color:#0ea5e9">${fmt(d.materials.total_amount)}₮</span>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead>
        <tr style="background:#f8fafc">
          <th style="padding:8px 12px;text-align:left;font-size:10px;color:#667085;font-weight:700">АЖИЛ</th>
          <th style="padding:8px 12px;text-align:right;font-size:10px;color:#667085;font-weight:700">ДҮН</th>
          <th style="padding:8px 12px;text-align:left;font-size:10px;color:#667085;font-weight:700">МАТЕРИАЛУУД</th>
        </tr>
      </thead>
      <tbody>${matRows}</tbody>
    </table>
  </div>` : ""}

  <!-- Finance -->
  ${canFinance ? `
  <div class="panel" style="padding:14px;margin-bottom:16px">
    <div style="font-weight:800;font-size:13px;margin-bottom:12px">💰 Санхүү</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
      <div style="text-align:center;padding:12px;background:#f0fdf4;border-radius:10px;border:1px solid #bbf7d0">
        <div style="font-size:10px;color:#667085;margin-bottom:4px">ОРЛОГО</div>
        <div style="font-size:18px;font-weight:900;color:#10b981">${fmt(d.finance.income)}₮</div>
      </div>
      <div style="text-align:center;padding:12px;background:#fff1f2;border-radius:10px;border:1px solid #fecdd3">
        <div style="font-size:10px;color:#667085;margin-bottom:4px">ЗАРЛАГА</div>
        <div style="font-size:18px;font-weight:900;color:#f43f5e">${fmt(d.finance.expense)}₮</div>
      </div>
      <div style="text-align:center;padding:12px;background:#eff6ff;border-radius:10px;border:1px solid #bfdbfe">
        <div style="font-size:10px;color:#667085;margin-bottom:4px">ҮЙЛЧИЛГЭЭНИЙ ЗАРДАЛ</div>
        <div style="font-size:18px;font-weight:900;color:#2563eb">${fmt(d.finance.op_expenses)}₮</div>
      </div>
    </div>
  </div>` : ""}`;

  window._unifiedData = { d, initYear, initMonth, MN_MONTHS };
}

async function printUnifiedReport() {
  const ud = window._unifiedData;
  if (!ud) { toast("Эхлээд тайлан ачаална уу"); return; }
  const { d, initYear, initMonth, MN_MONTHS } = ud;
  const fmt = n => Number(n||0).toLocaleString("mn-MN");
  const role = state.me?.role || "";
  const canFinance = ["director","accountant","chief_engineer"].includes(role);

  const catRows = (d.work.by_category || []).map((c,i) => `
    <tr>
      <td>${i+1}</td><td>${c.category||"—"}</td>
      <td style="text-align:center">${c.total}</td>
      <td style="text-align:center">${c.closed}</td>
      <td style="text-align:center">${c.active}</td>
      <td style="text-align:center">${c.hse_wait||0}</td>
      <td style="text-align:center">${c.pend_final||0}</td>
      <td style="text-align:center">${c.rejected}</td>
      <td style="text-align:center">${c.avg_progress}%</td>
    </tr>`).join("");

  const matRows = (d.materials.by_work || []).map((g,i) => `
    <tr>
      <td>${i+1}</td><td>${g.label||"—"}</td>
      <td style="text-align:right">${fmt(g.total)}₮</td>
      <td>${g.lines.map(l=>`${l.name||""} ${fmt(l.qty)} ${l.unit||""}`).join("; ")}</td>
    </tr>`).join("");

  const html = `<!DOCTYPE html><html lang="mn"><head><meta charset="utf-8">
  <title>Нэгтгэсэн тайлан — ${MN_MONTHS[initMonth]} ${initYear}</title>
  <style>
    body { font-family: Arial, sans-serif; font-size: 10.5pt; margin: 0; color: #000; }
    .header { text-align: center; margin-bottom: 18px; border-bottom: 2px solid #000; padding-bottom: 10px; }
    h2 { margin: 4px 0; font-size: 13pt; }
    h3 { margin: 14px 0 6px; font-size: 11pt; border-bottom: 1px solid #ccc; padding-bottom: 3px; }
    table { width: 100%; border-collapse: collapse; font-size: 9.5pt; margin-bottom: 14px; }
    th { background: #1d4ed8; color: #fff; padding: 5px 7px; text-align: left; font-size: 9pt; }
    td { padding: 4px 7px; border-bottom: 1px solid #e0e0e0; vertical-align: top; }
    tr:nth-child(even) td { background: #f5f7ff; }
    .kpi-row { display: flex; gap: 12px; margin-bottom: 14px; }
    .kpi { border: 1px solid #ccc; border-radius: 6px; padding: 7px 12px; flex: 1; text-align: center; }
    .kpi b { font-size: 15pt; display: block; }
    .kpi span { font-size: 8.5pt; color: #555; }
    .footer { margin-top: 30px; display: flex; justify-content: space-between; }
    .sign { text-align: center; border-top: 1px solid #000; padding-top: 6px; width: 180px; font-size: 9.5pt; }
    @media print { body { margin: 8mm; } }
  </style></head><body>
  <div class="header">
    <div style="font-size:10pt;margin-bottom:4px">ЧОЙБАЛСАН ХӨГЖИЛ ОНӨҮГ</div>
    <h2>НЭГТГЭСЭН ТАЙЛАН — ${MN_MONTHS[initMonth].toUpperCase()} ${initYear} ОН</h2>
    <p style="font-size:9pt;color:#444">Тайлан гарсан огноо: ${new Date().toLocaleDateString("mn-MN")}</p>
  </div>

  <div class="kpi-row">
    <div class="kpi"><b>${d.work.total}</b><span>Нийт ажил</span></div>
    <div class="kpi"><b style="color:#16a34a">${d.work.closed}</b><span>Хаагдсан</span></div>
    <div class="kpi"><b style="color:#6366f1">${d.work.active}</b><span>Явцтай</span></div>
    <div class="kpi"><b style="color:#dc2626">${d.work.overdue}</b><span>Хугацаа хэтэрсэн</span></div>
    <div class="kpi"><b>${d.work.avg_progress}%</b><span>Дундаж явц</span></div>
  </div>

  <h3>1. Ажлын категориор</h3>
  <table>
    <thead><tr><th>#</th><th>Категори</th><th>Нийт</th><th>Хаагдсан</th><th>Явцтай</th><th>ХАБЭА хүл.</th><th>Батламж хүл.</th><th>Буцаасан</th><th>Дундаж%</th></tr></thead>
    <tbody>${catRows||`<tr><td colspan="9" style="text-align:center">Мэдээлэл байхгүй</td></tr>`}</tbody>
  </table>

  <h3>2. ХАБЭА</h3>
  <div class="kpi-row">
    <div class="kpi"><b style="color:#f59e0b">${d.hse.open_risks}</b><span>Нээлттэй эрсдэл</span></div>
    <div class="kpi"><b style="color:#dc2626">${d.hse.high_risks}</b><span>Өндөр эрсдэл</span></div>
    <div class="kpi"><b style="color:#2563eb">${d.hse.new_risks}</b><span>Шинэ эрсдэл</span></div>
  </div>

  ${d.materials.total_amount > 0 ? `
  <h3>3. Материал зарцуулалт — Нийт: ${fmt(d.materials.total_amount)}₮</h3>
  <table>
    <thead><tr><th>#</th><th>Ажил</th><th>Дүн</th><th>Материал</th></tr></thead>
    <tbody>${matRows}</tbody>
  </table>` : ""}

  ${canFinance ? `
  <h3>4. Санхүү</h3>
  <div class="kpi-row">
    <div class="kpi"><b style="color:#10b981">${fmt(d.finance.income)}₮</b><span>Орлого</span></div>
    <div class="kpi"><b style="color:#f43f5e">${fmt(d.finance.expense)}₮</b><span>Зарлага</span></div>
    <div class="kpi"><b style="color:#2563eb">${fmt(d.finance.op_expenses)}₮</b><span>Үйл. зардал</span></div>
  </div>` : ""}

  <div class="footer">
    <div class="sign">Тайлан гаргасан:<br><br>.....................<br>${new Date().toLocaleDateString("mn-MN")}</div>
    <div class="sign">Ахлах инженер:<br><br>.....................<br></div>
    <div class="sign">Захирал:<br><br>.....................<br></div>
  </div>
  <script>window.onload=()=>window.print();<\/script>
  </body></html>`;

  const w = window.open("", "_blank");
  if (w) {
    const restoreControls = () => {
      document.getElementById("rptYear")?.removeAttribute("disabled");
      document.getElementById("rptMonth")?.removeAttribute("disabled");
      window.focus();
    };
    w.document.write(html);
    w.document.close();
    const poll = setInterval(() => {
      if (w.closed) {
        clearInterval(poll);
        restoreControls();
      }
    }, 500);
    setTimeout(restoreControls, 1200);
  }
  else toast("Popup блоклогдсон байна.");
}

function rptToggleCat(name) {
  if (_rptCatFilter.size === 1 && _rptCatFilter.has(name)) {
    _rptCatFilter.clear();
  } else {
    _rptCatFilter.clear();
    _rptCatFilter.add(name);
  }
  reloadReports();
}

function rptToggleAll() {
  _rptCatFilter.clear();
  reloadReports();
}

async function unifiedSaveSnapshot(year, month) {
  if (!confirm(`${year} оны ${month}-р сарын нэгтгэсэн тайланг одоогийн дүнгээр хадгалах уу?\n(Байгаа бол дарж бичнэ)`)) return;
  try {
    const res = await api("/api/unified-report-snapshots", {
      method: "POST",
      body: JSON.stringify({ year, month }),
    });
    toast(`✅ ${res.title} — хадгалагдлаа`);
    _unifiedViewMode = 'snap';
    reports_unified();
  } catch(e) { toast("Алдаа: " + e.message); }
}

Object.assign(window, { reports, audit, report_schedule, reports_unified, printWorkReport, printUnifiedReport, reloadReports, _rptVals, rptToggleCat, rptToggleAll, saveWorkReportSnapshot, showWorkReportSnapshots, openWorkReportSnapshot, downloadWorkReportSnapshot, downloadLiveWorkReport, unifiedSaveSnapshot, _unifiedViewMode });
