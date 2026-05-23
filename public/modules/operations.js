import { state, api, toast, escapeHtml, today, API } from './common.js';

// ── Globals for inline onclick handlers ──────────────────────
if (window.workCat        === undefined) window.workCat        = null; // loaded from DB
if (window.workYear       === undefined) window.workYear       = new Date().getFullYear();
if (window._workSubCat    === undefined) window._workSubCat    = "sl";
if (window._workBagFilter === undefined) window._workBagFilter = null;
if (window._workCatList   === undefined) window._workCatList   = [];
if (window._workMyOnly    === undefined) window._workMyOnly    = false;

// ── Module-level state ────────────────────────────────────────
let workEditId = null;
let workAssets = [];

// Gantt баганын өргөн — localStorage-аас уншина
const _gcw = JSON.parse(localStorage.getItem("ganttColW") || "{}");
let G_COL_N = _gcw.n || 190;
let G_COL_S = _gcw.s || 130;
let G_COL_P = _gcw.p || 55;
let _ganttCache = null; // { rows, execs, year, canEdit, canDel }

// ════════════════════════════════════════════════════════════
// АЖЛЫН ЯВЦ (Gantt)
// ════════════════════════════════════════════════════════════

async function work() {
  const canEdit = ["director","chief_engineer","engineer","camera_engineer"].includes(state.me.role);
  const canDel  = ["director","chief_engineer"].includes(state.me.role);
  const embedTargetId = window._workEmbedTarget || "";
  const embedTarget = embedTargetId ? document.getElementById(embedTargetId) : null;
  if (embedTargetId && !embedTarget) window._workEmbedTarget = "";
  const renderTarget = embedTarget || main;

  // Load categories dynamically
  try { window._workCatList = await api("/api/work-categories"); } catch(e) { window._workCatList = []; }
  if (!window._workCatList.length) {
    window._workCatList = [
      { name:"Гэрэлтүүлэг засвар", icon:"💡", color:"#f59e0b", department:"Гэрэлтүүлэг" },
      { name:"Камер засвар",        icon:"🎥", color:"#8b5cf6", department:"Камер" }
    ];
  }
  if (!window.workCat || !window._workCatList.find(c => c.name === window.workCat)) {
    window.workCat = window._workCatList[0].name;
  }

  const activeCat = window._workCatList.find(c => c.name === window.workCat) || window._workCatList[0];

  const allRows = await api("/api/work-logs");
  window._workAllRows = allRows;
  let rows = allRows
    .filter(r => r.category === window.workCat)
    .sort((a, b) => {
      const da = a.start_date || a.work_date || "";
      const db = b.start_date || b.work_date || "";
      return db.localeCompare(da);
    });

  if (activeCat.department) {
    try { workAssets = await api(`/api/assets?category=${encodeURIComponent(activeCat.department)}`); } catch(e) { workAssets = []; }
  } else { workAssets = []; }

  if (window.workCat === "Гэрэлтүүлэг засвар") {
    try { window._gerLocations = await api("/api/sl-ger-inventory"); } catch(e) { window._gerLocations = []; }
    try {
      const pts = await api("/api/sl-points");
      window._slPoints = pts.filter(p => (p.code||'').startsWith('ГТ-'));
    } catch(e) { window._slPoints = []; }
  } else {
    window._gerLocations = [];
    window._slPoints = [];
  }

  let execs = [];
  try {
    execs = await api(`/api/executions?year=${window.workYear}&category=${encodeURIComponent(window.workCat)}`);
  } catch(e) { console.warn("executions fetch failed", e); }

  // "Миний ажил" шүүлт
  if (window._workMyOnly && state.me?.full_name) {
    const myName = state.me.full_name;
    const myId   = state.me.id;
    rows = rows.filter(r => {
      if (r.assigned_to === myId) return true;
      return execs.some(e =>
        e.work_log_id === r.id &&
        (e.workers || "").split(",").map(w => w.trim()).includes(myName)
      );
    });
  }

  const autoDepт = activeCat.department || "";

  const isHiddenEmbedCat = (name = "") =>
    name === "Камер засвар" || name === "Бусад" || name.toLowerCase().includes("захир");
  const visibleCats = embedTarget
    ? window._workCatList.filter(c => !isHiddenEmbedCat(c.name || ""))
    : window._workCatList;
  const catTabs = visibleCats.map(c => `
    <button class="btn ${window.workCat===c.name?'':'secondary'}"
      data-cat="${escapeHtml(c.name)}"
      onclick="window.workCat=this.dataset.cat;work()"
      style="${window.workCat===c.name?`background:${c.color||'#2563eb'};border-color:${c.color||'#2563eb'}`:''}">
      ${c.icon||'📋'} ${escapeHtml(c.name)}
    </button>`).join("");

  renderTarget.innerHTML = `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:10px">
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${catTabs}
    </div>
    <div style="display:flex;align-items:center;gap:8px">
      <button class="btn secondary sm" onclick="workYear--;work()">‹</button>
      <span style="font-weight:700;font-size:14px">${window.workYear} он</span>
      <button class="btn secondary sm" onclick="workYear++;work()">›</button>
      <div style="display:flex;margin-left:8px;border:1.5px solid #e2e6ed;border-radius:8px;overflow:hidden">
        <button onclick="window._workMyOnly=false;work()"
          style="padding:5px 13px;font-size:12px;font-weight:700;cursor:pointer;border:none;
            background:${!window._workMyOnly?'#2563eb':'#fff'};
            color:${!window._workMyOnly?'#fff':'#64748b'};transition:all .15s">
          📋 Бүх ажил
        </button>
        <button onclick="window._workMyOnly=true;work()"
          style="padding:5px 13px;font-size:12px;font-weight:700;cursor:pointer;border:none;border-left:1.5px solid #e2e6ed;
            background:${window._workMyOnly?'#6366f1':'#fff'};
            color:${window._workMyOnly?'#fff':'#64748b'};transition:all .15s">
          👤 Миний ажил
        </button>
      </div>
      ${canEdit?`<button class="btn sm" id="btnShowForm" onclick="toggleWorkForm()" style="margin-left:4px">+ Ажил нэмэх</button>`:''}
    </div>
  </div>

  ${canEdit ? `<div class="panel" id="workFormPanel" style="margin-bottom:14px;display:none">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:13px 18px;border-bottom:1px solid #e2e6ed">
      <span style="font-size:14px;font-weight:700" id="workFormTitle">+ Шинэ ажил нэмэх</span>
      <button class="btn secondary sm" onclick="toggleWorkForm()">✕</button>
    </div>
    <div style="padding:16px 18px">
      <div class="row3" style="margin-bottom:10px">
        <div><div class="small muted" style="margin-bottom:4px">Ажлын нэр *</div>
          <input class="input" id="wtitle" placeholder="Найрамдал парк..."></div>
        <div><div class="small muted" style="margin-bottom:4px">Байршил</div>
          <input class="input" id="wloc" placeholder="${window.workCat === "Гэрэлтүүлэг засвар" ? "Доорх бүртгэлтэй байршлаас сонгоно" : "Байршил"}" ${window.workCat === "Гэрэлтүүлэг засвар" ? "readonly" : ""}></div>
        <div><div class="small muted" style="margin-bottom:4px">Тасаг</div>
          <input class="input" id="wdep" value="${autoDepт}" placeholder="Тасаг оруулах..."></div>
      </div>
      ${window.workCat === "Гэрэлтүүлэг засвар" ? `
      <div style="margin-bottom:12px">
        <div class="small muted" style="margin-bottom:6px">💡 Гэрэлтүүлгийн дэд хэсэг</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${[['sl','🛣️','Авто замын гэрэл'],['ger','🏘️','Гэр хорооллын гэрэл'],['cam','🗼','Цамхаг'],['other','➕','Бусад']]
            .map(([k,ic,lb])=>`<button type="button" id="wSubBtn_${k}" class="btn secondary sm" onclick="setWorkSubCat('${k}')">${ic} ${lb}</button>`).join('')}
        </div>
      </div>
      <div id="wBagRow" style="margin-bottom:10px;display:none">
        <div class="small muted" style="margin-bottom:4px">📍 Баг сонгох</div>
        <div id="wBagBtns" style="display:flex;gap:5px;flex-wrap:wrap"></div>
      </div>
      <div id="wLocRow" style="margin-bottom:10px;display:none">
        <div class="small muted" style="margin-bottom:4px">📍 Бүртгэлтэй байршил / объект сонгох</div>
        <select class="input" id="wgerLoc" style="width:100%" onchange="onWorkLocSelect()">
          <option value="">— Дэд хэсэг сонгоно уу —</option>
        </select>
      </div>
      <div id="wFaultInfo" style="display:none;margin-bottom:10px;padding:10px 14px;background:#fef2f2;border:1.5px solid #fca5a5;border-radius:8px;font-size:12px;color:#b91c1c"></div>` : ''}
      <div class="row3" style="margin-bottom:10px">
        <div><div class="small muted" style="margin-bottom:4px">Эхлэх огноо *</div>
          <input class="input" id="wstart" type="date" value="${today()}"></div>
        <div><div class="small muted" style="margin-bottom:4px">Дуусах огноо *</div>
          <input class="input" id="wend" type="date" value="${today()}"></div>
        <div><div class="small muted" style="margin-bottom:4px">Төлөв</div>
          <select class="input" id="wstatus">
            <option>Эхэлсэн</option><option selected>Явцтай</option>
            <option>Дууссан</option><option>Хүлээгдэж байгаа</option>
          </select></div>
      </div>
      <div class="row3" style="margin-bottom:10px">
        <div><div class="small muted" style="margin-bottom:4px">Явц %</div>
          <input class="input" id="wprog" type="number" value="0" min="0" max="100"></div>
        <div><div class="small muted" style="margin-bottom:4px">Зардал ₮</div>
          <input class="input" id="wcost" type="number" value="0"></div>
        <div style="${window.workCat === "Гэрэлтүүлэг засвар" ? "display:none" : ""}"><div class="small muted" style="margin-bottom:4px">🏗 Холбогдох хөрөнгө / байршил</div>
          <select class="input" id="wasset" onchange="onWorkAssetSelect()">
            <option value="">— Сонгохгүй —</option>
            ${workAssets.map(a => `<option value="${a.id}">[${escapeHtml(a.asset_code||"")}] ${escapeHtml(a.name)} — ${escapeHtml(a.location||"")}</option>`).join("")}
          </select>
        </div>
      </div>
      <div style="margin-bottom:10px">
        <div class="small muted" style="margin-bottom:6px">👷 Хариуцах хүмүүс</div>
        <div id="wassDropdown" style="position:relative">
          <div id="wassBtn" style="padding:8px 12px;border:1px solid #d0d5dd;border-radius:8px;background:#fff;cursor:pointer;font-size:13px;color:#344054;display:flex;align-items:center;justify-content:space-between;min-height:38px"
            onclick="toggleWassDropdown()">
            <span id="wassLabel" style="color:#98a2b3">Хүн сонгох...</span><span>▾</span>
          </div>
          <div id="wassList" style="display:none;position:absolute;top:calc(100% + 3px);left:0;right:0;z-index:999;background:#fff;border:1px solid #d0d5dd;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.12);max-height:220px;overflow-y:auto">
            <div style="padding:6px 10px;border-bottom:1px solid #f1f5f9">
              <input placeholder="Хайх..." oninput="filterWassList(this.value)" style="width:100%;border:1px solid #e2e6ed;border-radius:6px;padding:5px 8px;font-size:12px;outline:none">
            </div>
            <div id="wassItems">
              ${state.users.map(u=>`
                <label style="display:flex;align-items:center;gap:10px;padding:7px 12px;cursor:pointer" onclick="event.stopPropagation()">
                  <input type="checkbox" value="${u.id}" onchange="updateWassLabel()" style="width:15px;height:15px;accent-color:#2563eb">
                  <div>
                    <div style="font-size:13px;font-weight:600">${escapeHtml(u.full_name)}</div>
                    <div style="font-size:11px;color:#667085">${escapeHtml(u.position||"")} · ${escapeHtml(u.department||"")}</div>
                  </div>
                </label>`).join("")}
            </div>
          </div>
        </div>
      </div>
      <textarea class="input" id="wdesc" placeholder="Тайлбар" style="margin-bottom:10px;min-height:60px"></textarea>
      <input type="hidden" id="wcat" value="${window.workCat}">
      <div style="display:flex;gap:8px">
        <button class="btn" onclick="saveWork()">Хадгалах</button>
        <button class="btn secondary" onclick="resetWorkForm()">Цэвэрлэх</button>
      </div>
    </div>
  </div>` : ""}

  <div class="panel">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #e2e6ed;flex-wrap:wrap;gap:10px">
      <div>
        <div style="font-size:14px;font-weight:700">📅 ${window.workYear} оны Gantt — ${window.workCat}</div>
        <div style="font-size:11px;color:#667085;margin-top:2px">${rows.length} ажил · ${execs.length} гүйцэтгэл</div>
      </div>
      <div style="display:flex;gap:5px;flex-wrap:wrap">
        ${["1","2","3","4","5","6","7","8","9","10","11","12"].map(m=>
          `<button class="btn secondary sm" onclick="scrollGanttToMonth(${m})">${m}-р сар</button>`
        ).join("")}
      </div>
    </div>
    <div style="overflow:auto;max-height:calc(100vh - 220px)" id="ganttWrap">
      ${renderGantt(rows, execs, window.workYear, canEdit, canDel)}
    </div>
  </div>

  <div id="execModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;align-items:flex-start;justify-content:center;padding-top:40px;overflow-y:auto"
    onclick="if(event.target===this)closeExecModal()">
    <div id="execModalInner" style="background:#fff;border-radius:14px;width:min(700px,96vw);margin:0 auto 40px;box-shadow:0 20px 60px rgba(0,0,0,.25)"></div>
  </div>`;

  if (window.workCat === "Гэрэлтүүлэг засвар") {
    setWorkSubCat(window._workSubCat || "sl");
  }

  document.getElementById("ganttWrap").addEventListener("click", e => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const id     = Number(btn.dataset.id);
    if (action === "del-work")     confirmDeleteWork(id);
    if (action === "edit-work")    editWorkById(id, allRows);
    if (action === "add-exec")     openExecModal(id);
    if (action === "view-exec")    openExecModal(id);
    if (action === "del-exec")     deleteExec(Number(btn.dataset.eid), Number(btn.dataset.wid));
    if (action === "edit-exec")    openEditExecModal(btn);
    if (action === "submit-done")  openSubmitDoneModal(id);
    if (action === "confirm-work") confirmWorkDone(id);
    if (action === "reject-work")  rejectWorkDone(id);
    if (action === "habea-post")   openHabeaPostModal(id);
    if (action === "habea-reject") habeaPostReject(id);
    if (action === "habea-pre")    openHabeaPreModal(id);
    if (action === "add-photo")    openQuickPhotoModal(id, btn.dataset.title || "");
    if (action === "upd-prog")     openProgressModal(id, btn.dataset.title || "", Number(btn.dataset.prog||0), btn.dataset.status||"Явцтай");
    if (action === "show-move-menu") { e.stopPropagation(); showMoveMenu(btn, id); }
  });

  autoScrollToCurrentMonth();
  initColResize();
  initGanttDrag(28);
}

async function slHubWork() {
  window._workEmbedTarget = "slHubContent";
  window.workCat = "Гэрэлтүүлэг засвар";
  await work();
}

function initColResize() {
  const wrap = document.getElementById("ganttWrap");
  if (!wrap) return;

  // body болон wrap дотор хуучин handle цэвэрлэ
  document.querySelectorAll(".gcol-rhandle").forEach(el => el.remove());

  let line = document.getElementById("ganttResizeLine");
  if (!line) {
    line = document.createElement("div");
    line.id = "ganttResizeLine";
    line.style.cssText = "display:none;position:fixed;top:0;bottom:0;width:2px;background:#2563eb;z-index:9999;pointer-events:none;opacity:.8";
    document.body.appendChild(line);
  }
  line.style.display = "none";

  const ths = wrap.querySelectorAll("thead th");
  const colDefs = [
    { idx: 0, get: () => G_COL_N, set: v => { G_COL_N = v; } },
    { idx: 1, get: () => G_COL_S, set: v => { G_COL_S = v; } },
    { idx: 2, get: () => G_COL_P, set: v => { G_COL_P = v; } },
  ];

  colDefs.forEach(({ idx, get, set }) => {
    const th = ths[idx];
    if (!th) return;
    // TH-ийн дотор absolute — Gantt арилахад автоматаар арилна
    th.style.overflow = "visible";

    const handle = document.createElement("div");
    handle.className = "gcol-rhandle";
    handle.style.cssText =
      "position:absolute;right:-4px;top:0;bottom:0;width:8px;" +
      "cursor:col-resize;z-index:20;display:flex;align-items:stretch;justify-content:center";

    const pip = document.createElement("div");
    pip.style.cssText =
      "width:2px;background:#6366f1;opacity:.5;transition:opacity .15s,width .1s;align-self:stretch";
    handle.appendChild(pip);
    th.appendChild(handle);

    handle.addEventListener("mouseenter", () => { pip.style.opacity = "1"; pip.style.width = "3px"; });
    handle.addEventListener("mouseleave", () => { if (!handle._drag) { pip.style.opacity = ".5"; pip.style.width = "2px"; } });

    handle.addEventListener("mousedown", e => {
      e.preventDefault(); e.stopPropagation();
      handle._drag = true;
      pip.style.opacity = "1";
      const startX = e.clientX;
      const startW = get();
      line.style.display = "block";
      line.style.left = e.clientX + "px";

      const onMove = mv => {
        line.style.left = mv.clientX + "px";
        handle._newW = Math.max(50, startW + (mv.clientX - startX));
      };
      const onUp = () => {
        line.style.display = "none";
        handle._drag = false;
        pip.style.opacity = ".45";
        pip.style.width = "2px";
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        if (handle._newW) {
          set(handle._newW);
          handle._newW = null;
          localStorage.setItem("ganttColW", JSON.stringify({ n: G_COL_N, s: G_COL_S, p: G_COL_P }));
          if (_ganttCache) {
            const { rows, execs, year, canEdit, canDel } = _ganttCache;
            wrap.innerHTML = renderGantt(rows, execs, year, canEdit, canDel);
            initColResize();
            initGanttDrag(28);
          }
        }
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  });
}

let _ganttDragHandlers = null;
function initGanttDrag(cellPx) {
  if (_ganttDragHandlers) {
    document.removeEventListener("mousemove", _ganttDragHandlers.move);
    document.removeEventListener("mouseup",   _ganttDragHandlers.up);
    _ganttDragHandlers = null;
  }
  const wrap = document.getElementById("ganttWrap");
  if (!wrap) return;

  // Tooltip element
  let tip = document.getElementById("ganttDragTip");
  if (!tip) {
    tip = document.createElement("div");
    tip.id = "ganttDragTip";
    tip.style.cssText = "display:none;position:fixed;z-index:9999;background:#1e293b;color:#fff;font-size:11px;font-weight:700;padding:5px 10px;border-radius:8px;pointer-events:none;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,.3)";
    document.body.appendChild(tip);
  }

  let drag = null;

  wrap.addEventListener("mousedown", e => {
    const bar = e.target.closest(".gdrag");
    if (!bar) return;
    e.preventDefault();
    const isLeft  = e.target.classList.contains("gbar-left");
    const isRight = e.target.classList.contains("gbar-right");
    drag = {
      bar,
      mode:      isLeft ? "resize-left" : isRight ? "resize-right" : "move",
      id:        Number(bar.dataset.gid),
      isExec:    bar.dataset.gexec === "1",
      execId:    Number(bar.dataset.gexecid),
      startDate: bar.dataset.gstart,
      endDate:   bar.dataset.gend,
      startX:    e.clientX,
      origLeft:  parseInt(bar.style.left)  || 0,
      origWidth: parseInt(bar.style.width) || cellPx,
    };
    bar.style.opacity   = "0.8";
    bar.style.boxShadow = "0 4px 16px rgba(0,0,0,.3)";
  });

  const addDays = (s, n) => {
    if (!s) return s;
    const d = new Date(s); d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };

  const onMove = e => {
    if (!drag) return;
    const days = Math.round((e.clientX - drag.startX) / cellPx);
    if (drag.mode === "move") {
      drag.bar.style.left = Math.max(0, drag.origLeft + days * cellPx) + "px";
    } else if (drag.mode === "resize-right") {
      drag.bar.style.width = Math.max(cellPx, drag.origWidth + days * cellPx) + "px";
    } else {
      const nW = drag.origWidth - days * cellPx;
      const nL = drag.origLeft  + days * cellPx;
      if (nW >= cellPx && nL >= 0) { drag.bar.style.width = nW + "px"; drag.bar.style.left = nL + "px"; }
    }
    // Tooltip: show new dates
    let ns = drag.startDate, ne = drag.endDate;
    const days2 = Math.round((e.clientX - drag.startX) / cellPx);
    if (drag.mode === "move")             { ns = addDays(drag.startDate, days2); ne = addDays(drag.endDate, days2); }
    else if (drag.mode === "resize-right"){ ne = addDays(drag.endDate, days2); if (ne < ns) ne = ns; }
    else                                  { ns = addDays(drag.startDate, days2); if (ns > ne) ns = ne; }
    tip.textContent = `📅 ${ns} → ${ne}`;
    tip.style.display = "block";
    tip.style.left = (e.clientX + 12) + "px";
    tip.style.top  = (e.clientY - 30) + "px";
  };

  const onUp = async e => {
    if (!drag) return;
    const { bar, mode, id, isExec, execId, startDate, endDate } = drag;
    bar.style.opacity   = "1";
    bar.style.boxShadow = "";
    tip.style.display   = "none";
    const days = Math.round((e.clientX - drag.startX) / cellPx);
    drag = null;
    if (days === 0) return;

    let ns = startDate, ne = endDate;
    if (mode === "move")              { ns = addDays(startDate, days); ne = addDays(endDate, days); }
    else if (mode === "resize-right") { ne = addDays(endDate, days); if (ne < ns) ne = ns; }
    else                              { ns = addDays(startDate, days); if (ns > ne) ns = ne; }

    try {
      const ep = isExec ? `/api/executions/${execId}/dates` : `/api/work-logs/${id}/dates`;
      await api(ep, { method:"PATCH", body: JSON.stringify({ start_date: ns, end_date: ne }) });
      toast(`📅 ${ns} ~ ${ne} хадгалагдлаа`);
      await work();
    } catch(ex) { toast("Алдаа: " + ex.message); }
  };

  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup",   onUp);
  _ganttDragHandlers = { move: onMove, up: onUp };
}

// ── Gantt renderer ────────────────────────────────────────────
function renderGantt(rows, execs, year, canEdit, canDel) {
  _ganttCache = { rows, execs, year, canEdit, canDel };
  const CELL  = 28;
  const mDays = [0,1,2,3,4,5,6,7,8,9,10,11].map(m => new Date(year,m+1,0).getDate());
  const total = mDays.reduce((a,b)=>a+b,0);
  const mNames= ["1-р сар","2-р сар","3-р сар","4-р сар","5-р сар","6-р сар",
                 "7-р сар","8-р сар","9-р сар","10-р сар","11-р сар","12-р сар"];
  const COL_N = G_COL_N, COL_S = G_COL_S, COL_P = G_COL_P;

  function off(str) {
    if (!str) return -1;
    const p = String(str).slice(0,10).split("-");
    if (p.length < 3) return -1;
    const d = new Date(Number(p[0]), Number(p[1])-1, Number(p[2]));
    const j = new Date(year, 0, 1);
    return Math.floor((d - j) / 86400000);
  }

  function barColor(s) {
    if (s==="Дууссан") return "#16a34a";
    if (s==="Хүлээгдэж байгаа") return "#94a3b8";
    return "#2563eb";
  }

  function dayCells(sOff, eOff, color, startLabel, height="20px", dragData=null) {
    const hasBar  = sOff >= 0 && eOff >= 0;
    const barLeft = hasBar ? sOff * CELL : 0;
    const barW    = hasBar ? (eOff - sOff + 1) * CELL : 0;
    const tdH     = parseInt(height) + 6;
    const dd      = dragData;
    const gridBg  = `repeating-linear-gradient(90deg,transparent,transparent ${CELL-1}px,#f0f2f5 ${CELL-1}px,#f0f2f5 ${CELL}px)`;
    return `<td colspan="${total}" style="padding:0;position:relative;height:${tdH}px;min-width:${total*CELL}px;background-image:${gridBg};background-size:${CELL}px 100%">
      ${hasBar ? `<div class="gbar${dd?' gdrag':''}"
        style="position:absolute;top:3px;left:${barLeft}px;width:${barW}px;height:${height};background:${color};border-radius:6px;overflow:hidden;cursor:${dd?'grab':'default'};user-select:none;z-index:1"
        ${dd ? `data-gid="${dd.id}" data-gexec="${dd.isExec?1:0}" data-gexecid="${dd.execId||0}" data-gstart="${dd.startDate||""}" data-gend="${dd.endDate||""}"` : ""}>
        ${dd ? `<div class="gbar-left" style="position:absolute;left:0;top:0;bottom:0;width:8px;background:rgba(0,0,0,.25);cursor:w-resize;z-index:2"></div>` : ""}
        <span style="position:absolute;left:10px;right:10px;top:50%;transform:translateY(-50%);font-size:9px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden">${escapeHtml(startLabel||"")}</span>
        ${dd ? `<div class="gbar-right" style="position:absolute;right:0;top:0;bottom:0;width:8px;background:rgba(0,0,0,.25);cursor:e-resize;z-index:2"></div>` : ""}
      </div>` : ""}
    </td>`;
  }

  const T0 = "position:sticky;top:0;z-index:3;";   // month header row
  const T1 = "position:sticky;top:27px;z-index:3;"; // day header row (below month row)

  let mHead = "";
  mDays.forEach((d,i) => {
    mHead += `<th id="gantt-m${i+1}" colspan="${d}" style="${T0}min-width:${d*CELL}px;background:#f8f9fb;border-right:2px solid #e2e6ed;border-bottom:1px solid #e2e6ed;font-size:11px;color:#667085;font-weight:700;padding:5px 0;text-align:center;white-space:nowrap">${mNames[i]}</th>`;
  });

  let dHead = "";
  mDays.forEach((days, mi) => {
    for (let d = 1; d <= days; d++) {
      const dt = new Date(year, mi, d);
      const isToday   = dt.toISOString().slice(0,10) === today();
      const isWeekend = dt.getDay()===0 || dt.getDay()===6;
      dHead += `<th style="${T1}min-width:${CELL}px;max-width:${CELL}px;font-size:9px;text-align:center;padding:2px 0;border-right:.5px solid #e2e6ed;color:${isToday?"#2563eb":isWeekend?"#dc2626":"#98a2b3"};background:${isToday?"#eff6ff":isWeekend?"#fff5f5":"#f8f9fb"};font-weight:${isToday?"700":"400"}">${d}</th>`;
    }
  });

  const sticky = (left, bg="#fff", extra="") =>
    `position:sticky;left:${left}px;z-index:2;background:${bg};${extra}`;

  let body = "";
  rows.forEach((r, rowIdx) => {
    const rExecs = execs.filter(e => e.work_log_id === r.id);
    const sOff   = off(r.start_date || r.work_date);
    const eOff   = off(r.end_date   || r.start_date || r.work_date);
    const workers = r.material_note || "";

    const canConfirm    = ["director","chief_engineer"].includes(state.me.role);
    const canHabeaAct   = ["director","safety"].includes(state.me.role);
    const canSubmitDone = ["director","chief_engineer","engineer","electric","camera_engineer"].includes(state.me.role);
    const cs  = r.confirm_status || "";
    const st  = r.status || "Явцтай";
    const prog = r.progress || 0;

    // Status badge colours
    const _sBg = {
      'Явцтай':'#dbeafe','Эхэлсэн':'#f1f5f9','Дууссан':'#dcfce7',
      'Дууссан гэж илгээсэн':'#fef3c7','Инженер баталсан':'#ede9fe',
      'Хаагдсан':'#dcfce7','Буцаагдсан':'#fee2e2','Хүлээгдэж байгаа':'#f1f5f9',
    };
    const _sCl = {
      'Явцтай':'#1d4ed8','Эхэлсэн':'#475569','Дууссан':'#16a34a',
      'Дууссан гэж илгээсэн':'#92400e','Инженер баталсан':'#7c3aed',
      'Хаагдсан':'#15803d','Буцаагдсан':'#dc2626','Хүлээгдэж байгаа':'#94a3b8',
    };
    const statusBg = _sBg[st] || '#f1f5f9';
    const statusCl = _sCl[st] || '#475569';

    // Workflow badge
    let confirmBadge = "";
    if (st === "Хаагдсан") {
      const hDate = (r.habea_post_at||"").slice(0,10);
      confirmBadge = `
      <div style="margin-top:4px;padding:5px 8px;background:linear-gradient(135deg,#fefce8,#fef9c3);border:1px solid #fde047;border-radius:8px;text-align:center">
        <div style="font-size:16px;letter-spacing:2px;line-height:1.2">⭐⭐⭐⭐⭐</div>
        <div style="font-size:9px;color:#92400e;font-weight:700;margin-top:1px">Бүрэн хаагдсан!</div>
      </div>
      <div style="font-size:10px;color:#15803d;background:#dcfce7;border:1px solid #86efac;border-radius:6px;padding:4px 8px;margin-top:3px">
        🦺 ХАБЭА баталсан · ${escapeHtml(r.habea_post_name||"")} · ${hDate}
      </div>
      <button onclick="printApprovalSheet(${r.id})" style="margin-top:4px;width:100%;padding:4px 8px;font-size:10px;font-weight:700;background:#1e40af;color:#fff;border:none;border-radius:6px;cursor:pointer">🖨 Акт хэвлэх</button>`;
    } else if (st === "Инженер баталсан") {
      const cDate = (r.confirmed_at||"").slice(0,10);
      confirmBadge = `<div style="font-size:10px;color:#7c3aed;background:#ede9fe;border:1px solid #c4b5fd;border-radius:6px;padding:4px 8px;margin-top:3px">
        🔧 Инж. баталсан · ${escapeHtml(r.confirmed_name||"")} · ${cDate} · ⏳ ХАБЭА хүлээж байна
      </div>`;
    } else if (st === "Дууссан гэж илгээсэн") {
      confirmBadge = `<div style="font-size:10px;color:#92400e;background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;padding:4px 8px;margin-top:3px">
        📬 Илгээсэн · ⏳ Ерөнхий инженер батлалт хүлээж байна
      </div>`;
    } else if (st === "Буцаагдсан" || cs === "rejected") {
      confirmBadge = `<div style="font-size:10px;color:#dc2626;background:#fee2e2;border:1px solid #fca5a5;border-radius:6px;padding:4px 8px;margin-top:3px">
        ❌ Буцаагдсан${r.reject_note?` · "${escapeHtml(r.reject_note)}"`:""}</div>`;
    } else if (cs === "confirmed") {
      const cDate = (r.confirmed_at||"").slice(0,10);
      const imgThumb = r.confirm_image_url
        ? `<img src="${r.confirm_image_url}" onclick="window._ftZoom&&window._ftZoom('${r.confirm_image_url}')"
             style="height:32px;width:48px;object-fit:cover;border-radius:4px;cursor:zoom-in;border:1px solid #86efac;margin-left:4px">` : "";
      confirmBadge = `
      <div style="margin-top:4px;padding:5px 8px;background:linear-gradient(135deg,#fefce8,#fef9c3);border:1px solid #fde047;border-radius:8px;text-align:center">
        <div style="font-size:16px;letter-spacing:2px;line-height:1.2">⭐⭐⭐⭐⭐</div>
      </div>
      <div style="font-size:10px;color:#15803d;background:#dcfce7;border:1px solid #86efac;border-radius:6px;padding:4px 8px;margin-top:3px;display:inline-flex;align-items:center;gap:4px;flex-wrap:wrap">
        ✅ Батлагдсан · ${escapeHtml(r.confirmed_name||"")} · ${cDate}
        ${r.confirm_note?`<span style="color:#166534;font-style:italic">"${escapeHtml(r.confirm_note)}"</span>`:""}
        ${imgThumb}
      </div>`;
    }

    // ХАБЭА pre sign-off badge
    if (r.habea_pre_status === "approved") {
      const hpDate = (r.habea_pre_at||"").slice(0,10);
      confirmBadge += `<div style="font-size:10px;color:#0369a1;background:#e0f2fe;border:1px solid #7dd3fc;border-radius:6px;padding:3px 7px;margin-top:3px">
        🦺 Эхлэлтийн зөвшөөрөл: ${escapeHtml(r.habea_pre_name||"")} · ${hpDate}
      </div>`;
    }

    // Action buttons
    let btnConfirm = "";
    const notLocked = !["Дууссан гэж илгээсэн","Инженер баталсан","Хаагдсан"].includes(st);
    if (canSubmitDone && prog >= 100 && notLocked) {
      btnConfirm += `<button data-action="submit-done" data-id="${r.id}" class="btn" style="padding:3px 8px;font-size:10px;background:#f59e0b;color:#fff">📬 Дуусгаж илгээх</button>`;
    }
    if (canConfirm && (st === "Дууссан гэж илгээсэн" || (st === "Дууссан" && cs !== "confirmed"))) {
      btnConfirm += `
        <button data-action="confirm-work" data-id="${r.id}" class="btn" style="padding:3px 8px;font-size:10px;background:#16a34a">✅ Батлах</button>
        <button data-action="reject-work"  data-id="${r.id}" class="btn danger" style="padding:3px 8px;font-size:10px">↩ Буцаах</button>`;
    }
    if (canHabeaAct && st === "Инженер баталсан") {
      btnConfirm += `
        <button data-action="habea-post"   data-id="${r.id}" class="btn" style="padding:3px 8px;font-size:10px;background:#7c3aed">🦺 ХАБЭА батлах</button>
        <button data-action="habea-reject" data-id="${r.id}" class="btn danger" style="padding:3px 8px;font-size:10px">↩ Буцаах</button>`;
    }
    if (canHabeaAct && !["Хаагдсан","Дууссан гэж илгээсэн","Инженер баталсан"].includes(st) && r.habea_pre_status !== "approved") {
      btnConfirm += `<button data-action="habea-pre" data-id="${r.id}" class="btn secondary" style="padding:3px 8px;font-size:10px;color:#0369a1;border-color:#7dd3fc">🦺 Эхлэлт зөвшөөрөх</button>`;
    }

    const btnEdit    = canEdit ? `<button data-action="edit-work"  data-id="${r.id}" class="btn secondary" style="padding:2px 7px;font-size:10px">✏️</button>` : "";
    const btnDel     = canDel  ? `<button data-action="del-work"   data-id="${r.id}" class="btn danger"    style="padding:2px 7px;font-size:10px">🗑</button>` : "";
    const btnMove    = canEdit && window._workCatList.length > 1
      ? `<button data-action="show-move-menu" data-id="${r.id}" class="btn secondary" style="padding:2px 7px;font-size:10px" title="Өөр категорид шилжүүлэх">📁</button>` : "";
    const btnProg    = canEdit ? `<button data-action="upd-prog"   data-id="${r.id}" data-prog="${prog}" data-status="${escapeHtml(st)}" data-title="${escapeHtml(r.title)}" class="btn" style="padding:2px 7px;font-size:10px">📝 Явц</button>` : "";
    const btnAddExec = canEdit ? `<button data-action="add-exec"   data-id="${r.id}" class="btn" style="padding:2px 7px;font-size:10px;background:#16a34a">➕ Гүйцэтгэл</button>` : "";
    const btnView    = `<button data-action="view-exec"  data-id="${r.id}" class="btn secondary" style="padding:2px 7px;font-size:10px">📋</button>`;
    const btnPhoto   = canEdit ? `<button data-action="add-photo"  data-id="${r.id}" data-title="${escapeHtml(r.title)}" class="btn secondary" style="padding:2px 7px;font-size:10px">📷</button>` : "";

    const planBarColor = st==="Хаагдсан" ? "#15803d" : st==="Инженер баталсан" ? "#8b5cf6" : cs==="confirmed" ? "#15803d" : "#93c5fd";
    const progColor = prog === 100 ? '#16a34a' : prog >= 50 ? '#2563eb' : '#d97706';
    const progBg    = prog === 100 ? '#16a34a' : prog >= 50 ? '#2563eb' : '#f59e0b';

    // rowspan: main + plan row + exec rows
    const totalSpan = 1 + rExecs.length;

    // ── Main row: left cell spans all sub-rows via rowspan ──
    body += `<tr style="background:#fff">
      <td style="${sticky(0)} min-width:${COL_N}px;max-width:${COL_N}px;padding:8px 10px;vertical-align:top;box-shadow:1px 0 0 #e2e6ed;border-bottom:5px solid #f0f2f5" rowspan="${totalSpan}">
        <div style="display:flex;align-items:flex-start;gap:6px;margin-bottom:3px">
          <span style="flex-shrink:0;min-width:20px;height:20px;border-radius:5px;background:#e0e7ff;color:#3730a3;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;line-height:1">${rows.length - rowIdx}</span>
          <div style="min-width:0;flex:1">
            <div style="font-weight:800;font-size:13px;color:#0f172a;line-height:1.3;word-break:break-word;white-space:normal" title="${escapeHtml(r.title)}">${escapeHtml(r.title)}</div>
            ${r.location ? `<div style="font-size:11px;color:#2563eb;font-weight:600;margin-top:2px;display:flex;align-items:center;gap:3px"><span style="font-size:10px">📍</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(r.location)}</span></div>` : ""}
          </div>
        </div>
        ${workers?`<div style="font-size:10px;color:#0ea5e9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:2px">👷 ${escapeHtml(workers.slice(0,28))}</div>`:""}
        ${confirmBadge}
        <div style="display:flex;align-items:center;gap:5px;margin:5px 0 4px">
          <div style="flex:1;height:5px;background:#e2e6ed;border-radius:10px;overflow:hidden">
            <div style="height:100%;width:${prog}%;background:${progBg};border-radius:10px"></div>
          </div>
          <span style="font-size:11px;font-weight:700;color:${progColor};white-space:nowrap">${prog}%</span>
          <span style="font-size:9px;padding:1px 6px;border-radius:10px;background:${statusBg};color:${statusCl};font-weight:600;white-space:nowrap">${r.status||""}</span>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:3px;margin-bottom:3px">
          <div style="display:flex;gap:2px">${btnEdit}${btnDel}${btnPhoto}${btnMove}</div>
          <div style="display:flex;gap:2px">${btnView}</div>
        </div>
        ${btnProg||btnAddExec||btnConfirm ? `<div style="display:flex;gap:3px;flex-wrap:wrap">${btnProg}${btnAddExec}${btnConfirm}</div>` : ""}
      </td>
      <td style="${sticky(COL_N)} padding:3px 8px;min-width:${COL_S}px;box-shadow:1px 0 0 #e2e6ed;white-space:nowrap">
        <span style="font-size:10px;color:#64748b">📅 Төлөвлөсөн нь</span>
      </td>
      <td style="${sticky(COL_N+COL_S)} padding:3px 6px;min-width:${COL_P}px;border-right:2px solid #c7d2fe;vertical-align:middle">
        <span style="font-size:9px;padding:1px 6px;border-radius:10px;background:${statusBg};color:${statusCl};font-weight:600">${r.status||""}</span>
      </td>
      ${dayCells(sOff, eOff, planBarColor, "", "10px", canEdit ? {id:r.id, isExec:false, execId:0, startDate:r.start_date||r.work_date||"", endDate:r.end_date||r.start_date||r.work_date||""} : null)}
    </tr>`;

    // ── Execution sub-rows (no left cell — covered by rowspan) ──
    rExecs.forEach((ex, idx) => {
      const esOff  = off(ex.start_date);
      const eeOff  = off(ex.end_date);
      const exColor = ex.status === "Дууссан" ? "#16a34a" : "#6366f1";
      const exProg  = ex.progress || 0;
      const doneBadge = ex.status === "Дууссан"
        ? `<span style="font-size:9px;padding:1px 5px;border-radius:8px;background:#dcfce7;color:#15803d;margin-left:3px">Дууссан</span>` : "";
      const exEditBtn = canEdit
        ? `<button data-action="edit-exec" data-eid="${ex.id}" data-wid="${r.id}"
             data-title="${escapeHtml(ex.title||"")}" data-start="${ex.start_date||""}" data-end="${ex.end_date||""}"
             data-prog="${exProg}" data-status="${escapeHtml(ex.status||"Явцтай")}"
             data-workers="${escapeHtml(ex.workers||"")}" data-note="${escapeHtml(ex.note||"")}"
             class="btn secondary" style="padding:2px 8px;font-size:10px;margin-left:auto;background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8">✏️ Засах</button>` : "";
      const exDelBtn = canDel
        ? `<button data-action="del-exec" data-eid="${ex.id}" data-wid="${r.id}"
             class="btn danger" style="padding:2px 6px;font-size:10px">🗑</button>` : "";
      body += `<tr style="background:#fafbff">
        <td style="${sticky(COL_N)} padding:4px 8px;min-width:${COL_S}px;box-shadow:1px 0 0 #e2e6ed;vertical-align:top">
          <div style="display:flex;align-items:center;gap:4px;margin-bottom:2px">
            <span style="width:6px;height:6px;border-radius:50%;flex-shrink:0;background:${exColor}"></span>
            <span style="font-size:10px;color:#344054;font-weight:700">Гүйцэтгэл ${idx+1}</span>
            ${doneBadge}
          </div>
          ${ex.title ? `<div style="font-size:9px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-left:10px;margin-bottom:2px">${escapeHtml(ex.title)}</div>` : ""}
          ${ex.workers ? `<div style="font-size:9px;color:#7c3aed;padding-left:10px;margin-bottom:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">👤 ${escapeHtml(ex.workers)}</div>` : ""}
          <div style="display:flex;gap:3px;padding-left:10px">${exEditBtn}${exDelBtn}</div>
        </td>
        <td style="${sticky(COL_N+COL_S)} padding:3px 6px;min-width:${COL_P}px;border-right:2px solid #c7d2fe;vertical-align:middle">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
            <span style="font-size:9px;font-weight:700;color:${exColor}">${exProg}%</span>
          </div>
          <div style="height:5px;background:#e2e6ed;border-radius:10px;overflow:hidden">
            <div style="height:100%;width:${exProg}%;background:${exColor};border-radius:10px"></div>
          </div>
        </td>
        ${dayCells(esOff, eeOff, exColor, "", "8px", canEdit ? {id:r.id, isExec:true, execId:ex.id, startDate:ex.start_date||"", endDate:ex.end_date||""} : null)}
      </tr>`;
    });

    body += `<tr><td colspan="${total+3}" style="height:6px;background:#f0f2f5"></td></tr>`;
  });

  if (!body) body = `<tr><td colspan="${total+3}" style="padding:20px;text-align:center;color:#667085">${window.workCat}-ийн ${window.workYear} оны ажил бүртгэгдээгүй байна</td></tr>`;

  return `<table style="border-collapse:collapse;font-size:12px;min-width:${COL_N+COL_S+COL_P+total*CELL}px">
    <thead>
      <tr>
        <th rowspan="2" style="${sticky(0,"#f8f9fb","top:0;z-index:5;")} min-width:${COL_N}px;padding:8px 12px;font-size:11px;color:#344054;font-weight:800;border-bottom:1px solid #e2e6ed;text-align:left;box-shadow:1px 0 0 #e2e6ed">№ · АЖЛЫН НЭР / БАЙРШИЛ</th>
        <th rowspan="2" style="${sticky(COL_N,"#f8f9fb","top:0;z-index:5;")} min-width:${COL_S}px;padding:8px 8px;font-size:10px;color:#667085;border-bottom:1px solid #e2e6ed;text-align:left;box-shadow:1px 0 0 #e2e6ed">ХЭСЭГ / ТӨЛӨВ</th>
        <th rowspan="2" style="${sticky(COL_N+COL_S,"#f8f9fb","top:0;z-index:5;")} min-width:${COL_P}px;padding:8px 8px;font-size:10px;color:#667085;border-bottom:1px solid #e2e6ed;text-align:left;border-right:2px solid #c7d2fe">ЯВЦ %</th>
        ${mHead}
      </tr>
      <tr>${dHead}</tr>
    </thead>
    <tbody>${body}</tbody>
  </table>`;
}

// ── Work form helpers ─────────────────────────────────────────
function toggleWorkForm() {
  const p = document.getElementById("workFormPanel");
  if (!p) return;
  p.style.display = p.style.display === "none" ? "block" : "none";
}

function resetWorkForm() {
  workEditId = null;
  const t = document.getElementById("workFormTitle");
  if (t) t.textContent = "+ Шинэ ажил нэмэх";
  ["wtitle","wloc","wdesc"].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = "";
  });
  const wdep = document.getElementById("wdep");
  if (wdep) wdep.value = (window._workCatList||[]).find(c=>c.name===window.workCat)?.department || "";
  const f = id => { const el=document.getElementById(id); if(el) el.value=today(); };
  f("wstart"); f("wend");
  const wp=document.getElementById("wprog"); if(wp) wp.value=0;
  const wc=document.getElementById("wcost"); if(wc) wc.value=0;
  const wa=document.getElementById("wasset"); if(wa) wa.value="";
  document.querySelectorAll("#wassItems input[type=checkbox]").forEach(cb=>cb.checked=false);
  updateWassLabel();
  window._workSubCat = "sl";
  window._workBagFilter = null;
  if (document.getElementById("wSubBtn_sl")) setWorkSubCat("sl");
  document.getElementById("wFaultInfo")?.style && (document.getElementById("wFaultInfo").style.display = "none");
}

function editWorkById(id, allRows) {
  const r = allRows.find(x => x.id === id);
  if (!r) return;
  workEditId = r.id;
  const t = document.getElementById("workFormTitle");
  if (t) t.textContent = "✏️ Ажил засах";
  const s = id => document.getElementById(id);
  if(s("wtitle"))  s("wtitle").value  = r.title||"";
  if(s("wloc"))    s("wloc").value    = r.location||"";
  if(s("wdep"))    s("wdep").value    = r.department||"";
  if(s("wdesc"))   s("wdesc").value   = r.description||"";
  if(s("wstart"))  s("wstart").value  = r.start_date||r.work_date||today();
  if(s("wend"))    s("wend").value    = r.end_date||today();
  if(s("wprog"))   s("wprog").value   = r.progress||0;
  if(s("wcost"))   s("wcost").value   = r.cost_amount||0;
  if(s("wstatus")) s("wstatus").value = r.status||"Явцтай";
  if(s("wasset"))  s("wasset").value  = r.asset_id||"";
  document.querySelectorAll("#wassItems input[type=checkbox]").forEach(cb=>cb.checked=false);
  const workerStr = r.material_note||"";
  if (workerStr) setSelectedWorkers(workerStr);
  if (r.sl_sub_category) {
    window._workSubCat = r.sl_sub_category;
    window._workBagFilter = null;
    setWorkSubCat(r.sl_sub_category);
    setTimeout(() => {
      const sel = document.getElementById("wgerLoc");
      if (!sel) return;
      if (r.sl_point_id)      sel.value = `sl:${r.sl_point_id}`;
      else if (r.ger_inventory_id) sel.value = `ger:${r.ger_inventory_id}`;
    }, 30);
  }
  const p = document.getElementById("workFormPanel");
  if (p) p.style.display = "block";
  window.scrollTo({top:0,behavior:"smooth"});
}

function toggleWassDropdown() {
  const list = document.getElementById("wassList");
  if (!list) return;
  const open = list.style.display !== "none";
  list.style.display = open ? "none" : "block";
}

function updateWassLabel() {
  const checked = [...document.querySelectorAll("#wassItems input[type=checkbox]:checked")];
  const label   = document.getElementById("wassLabel");
  if (!label) return;
  if (!checked.length) {
    label.textContent = "Хүн сонгох...";
    label.style.color = "#98a2b3";
  } else {
    label.textContent = checked.map(cb => {
      const u = state.users.find(u => String(u.id) === cb.value);
      return u ? u.full_name.split(" ").pop() : cb.value;
    }).join(", ");
    label.style.color = "#172033";
  }
}

function filterWassList(val) {
  const v = val.toLowerCase();
  document.querySelectorAll("#wassItems label").forEach(lbl => {
    lbl.style.display = lbl.textContent.toLowerCase().includes(v) ? "" : "none";
  });
}

function getSelectedWorkers() {
  return [...document.querySelectorAll("#wassItems input[type=checkbox]:checked")]
    .map(cb => { const u = state.users.find(u => String(u.id) === cb.value); return u ? u.full_name : ""; })
    .filter(Boolean).join(", ");
}

function setSelectedWorkers(str) {
  const names = str.split(",").map(s => s.trim());
  document.querySelectorAll("#wassItems input[type=checkbox]").forEach(cb => {
    const u = state.users.find(u => String(u.id) === cb.value);
    if (u && names.includes(u.full_name)) { cb.checked = true; }
  });
  updateWassLabel();
}

document.addEventListener("click", e => {
  const dd = document.getElementById("wassDropdown");
  if (dd && !dd.contains(e.target)) {
    const list = document.getElementById("wassList");
    if (list) list.style.display = "none";
  }
});

async function saveWork() {
  const title = (document.getElementById("wtitle")||{}).value?.trim();
  if (!title) { toast("Ажлын нэр оруулна уу"); return; }
  const g = id => (document.getElementById(id)||{}).value||"";
  if (window.workCat === "Гэрэлтүүлэг засвар" && window._workSubCat !== "other" && !g("wgerLoc")) {
    toast("Бүртгэлтэй байршил / объект сонгоно уу");
    return;
  }
  const workers = getSelectedWorkers();
  const locVal = g("wgerLoc") || "";
  const [locType, locIdStr] = locVal.includes(":") ? locVal.split(":") : ["", ""];
  const locId = parseInt(locIdStr) || null;
  const body = {
    title,
    category:         window.workCat,
    description:      g("wdesc"),
    location:         g("wloc"),
    department:       g("wdep") || (window._workCatList||[]).find(c=>c.name===window.workCat)?.department || "",
    work_date:        g("wstart"),
    start_date:       g("wstart"),
    end_date:         g("wend"),
    assigned_to:      null,
    status:           g("wstatus")||"Явцтай",
    progress:         Number(g("wprog")||0),
    cost_amount:      Number(g("wcost")||0),
    material_note:    workers,
    asset_id:         Number(g("wasset")||0) || null,
    ger_inventory_id: locType === "ger" ? locId : null,
    sl_point_id:      locType === "sl"  ? locId : null,
    sl_sub_category:  window._workSubCat || null,
  };
  try {
    if (workEditId) {
      await api(`/api/work-logs/${workEditId}`, { method:"PUT", body:JSON.stringify(body) });
      toast("Ажил засагдлаа ✓");
    } else {
      await api("/api/work-logs", { method:"POST", body:JSON.stringify(body) });
      toast("Ажил нэмэгдлээ ✓");
    }
    workEditId = null;
    work();
  } catch(err) { toast("Хадгалах алдаа: "+err.message); }
}

async function confirmDeleteWork(id) {
  if (!confirm("Энэ ажлыг устгах уу? Гүйцэтгэлүүд бүгд устана.")) return;
  try {
    await api(`/api/work-logs/${id}`, { method:"DELETE" });
    toast("Ажил устгагдлаа ✓");
    work();
  } catch(err) { toast("Устгах алдаа: "+err.message); }
}

// ── Completion confirmation modal ─────────────────────────────
function confirmWorkDone(id) {
  // Inject modal if not yet present
  let m = document.getElementById("confirmWorkModal");
  if (!m) {
    m = document.createElement("div");
    m.id = "confirmWorkModal";
    m.style.cssText = "display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:3000;align-items:flex-start;justify-content:center;padding-top:60px";
    m.innerHTML = `
    <div style="background:#fff;border-radius:16px;width:min(520px,94vw);box-shadow:0 20px 60px rgba(0,0,0,.25);overflow:hidden">
      <div style="background:linear-gradient(135deg,#15803d,#16a34a);padding:18px 22px;display:flex;align-items:center;gap:12px">
        <span style="font-size:24px">✅</span>
        <div>
          <div style="color:#fff;font-size:15px;font-weight:800">Ажлын дуусгалт батлах</div>
          <div style="color:rgba(255,255,255,.75);font-size:11px" id="cwm_sub"></div>
        </div>
      </div>
      <div style="padding:22px">
        <div style="margin-bottom:14px">
          <div style="font-size:12px;font-weight:700;color:#344054;margin-bottom:6px">📝 Батлалтын тайлбар</div>
          <textarea id="cwm_note" style="width:100%;min-height:80px;border:1px solid #d0d5dd;border-radius:8px;padding:10px 12px;font-size:13px;font-family:inherit;resize:vertical;outline:none"
            placeholder="Ажил гүйцэтгэлийн дүгнэлт, ажиглалт..."></textarea>
        </div>
        <div style="margin-bottom:20px">
          <div style="font-size:12px;font-weight:700;color:#344054;margin-bottom:6px">📷 Нотлох зураг (заавал биш)</div>
          <input type="file" id="cwm_img" accept="image/*"
            style="border:1px solid #d0d5dd;border-radius:8px;padding:6px 10px;font-size:12px;width:100%"
            onchange="if(this.files[0]){document.getElementById('cwm_preview').src=URL.createObjectURL(this.files[0]);document.getElementById('cwm_preview').style.display='block'}">
          <img id="cwm_preview" style="display:none;margin-top:8px;max-width:100%;max-height:160px;border-radius:8px;object-fit:cover;border:1px solid #e2e6ed">
        </div>
        <div style="display:flex;gap:10px">
          <button id="cwm_btn" onclick="submitConfirmWork()" style="flex:1;background:#16a34a;color:#fff;border:none;border-radius:8px;padding:10px;font-size:14px;font-weight:700;cursor:pointer">
            ✅ Батлах
          </button>
          <button onclick="document.getElementById('confirmWorkModal').style.display='none'"
            style="padding:10px 20px;border:1px solid #e2e6ed;border-radius:8px;background:#fff;font-size:13px;cursor:pointer">
            Цуцлах
          </button>
        </div>
      </div>
    </div>`;
    document.body.appendChild(m);
  }

  window._cwmId = id;
  document.getElementById("cwm_note").value = "";
  document.getElementById("cwm_img").value  = "";
  document.getElementById("cwm_preview").style.display = "none";
  document.getElementById("cwm_sub").textContent = `ID: ${id}`;
  m.style.display = "flex";
}

async function submitConfirmWork() {
  const id   = window._cwmId;
  const note = document.getElementById("cwm_note").value.trim();
  const img  = document.getElementById("cwm_img").files?.[0];
  const btn  = document.getElementById("cwm_btn");
  if (btn) btn.disabled = true;
  try {
    const fd = new FormData();
    fd.append("confirm_note", note);
    if (img) fd.append("confirm_image", img);
    const res = await fetch(location.origin + `/api/work-logs/${id}/confirm`, {
      method: "POST",
      headers: { "Authorization": "Bearer " + (localStorage.getItem("token")||"") },
      body: fd
    });
    if (!res.ok) { const e=await res.json(); toast(e.error||"Алдаа"); return; }
    document.getElementById("confirmWorkModal").style.display = "none";
    toast("✅ Ажил амжилттай батлагдлаа!");
    work();
  } catch(err) { toast("Алдаа: " + err.message); }
  finally { if (btn) btn.disabled = false; }
}

async function rejectWorkDone(id) {
  const note = prompt("Буцаах шалтгаан:");
  if (note === null) return;
  try {
    await api(`/api/work-logs/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ note: note || "Нэмэлт засвар хийх шаардлагатай" })
    });
    toast("↩ Ажил буцаагдлаа, шалтгаан тэмдэглэгдлээ.");
    work();
  } catch(err) { toast("Алдаа: " + err.message); }
}

// ── Move work to another category ────────────────────────────
function showMoveMenu(btn, workId) {
  document.getElementById("_moveMenuPopup")?.remove();

  const otherCats = (window._workCatList||[]).filter(c => c.name !== window.workCat);
  if (!otherCats.length) return;

  const rect = btn.getBoundingClientRect();
  const popup = document.createElement("div");
  popup.id = "_moveMenuPopup";
  popup.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.bottom+4}px;z-index:9999;
    background:#fff;border:1px solid #e2e6ed;border-radius:10px;
    box-shadow:0 4px 24px rgba(0,0,0,.18);min-width:190px;padding:6px`;
  popup.innerHTML = `
    <div style="font-size:10px;color:#94a3b8;padding:4px 8px 6px;font-weight:700;border-bottom:1px solid #f1f5f9;margin-bottom:4px;text-transform:uppercase">
      📁 Шилжүүлэх категори
    </div>
    ${otherCats.map(c => `
      <button data-wid="${workId}" data-cat="${escapeHtml(c.name)}"
        onclick="document.getElementById('_moveMenuPopup')?.remove();moveWorkToCat(Number(this.dataset.wid),this.dataset.cat)"
        style="display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;border:none;background:none;cursor:pointer;font-size:12px;color:#374151;border-radius:6px;text-align:left"
        onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='none'">
        <span style="width:10px;height:10px;border-radius:50%;background:${c.color||'#2563eb'};flex-shrink:0;display:inline-block"></span>
        ${c.icon||'📋'} ${escapeHtml(c.name)}
      </button>`).join("")}`;

  document.body.appendChild(popup);

  setTimeout(() => {
    function outsideClick(e) {
      if (!popup.contains(e.target)) {
        popup.remove();
        document.removeEventListener("click", outsideClick);
      }
    }
    document.addEventListener("click", outsideClick);
  }, 0);
}

async function moveWorkToCat(workId, toCat) {
  const r = (window._workAllRows||[]).find(x => x.id === workId);
  if (!r) return;
  if (!confirm(`"${r.title}"\nажлыг "${toCat}" категорид шилжүүлэх үү?`)) return;
  const newDept = (window._workCatList||[]).find(c => c.name === toCat)?.department || r.department || "";
  try {
    await api(`/api/work-logs/${workId}`, {
      method: "PUT",
      body: JSON.stringify({
        title:            r.title,
        category:         toCat,
        department:       newDept,
        location:         r.location || "",
        description:      r.description || "",
        status:           r.status || "Явцтай",
        progress:         r.progress || 0,
        assigned_to:      r.assigned_to || null,
        work_date:        r.work_date || r.start_date || null,
        start_date:       r.start_date || null,
        end_date:         r.end_date || null,
        cost_amount:      r.cost_amount || 0,
        material_note:    r.material_note || "",
        asset_id:         r.asset_id || null,
        ger_inventory_id: r.ger_inventory_id || null,
        sl_point_id:      r.sl_point_id || null,
        sl_sub_category:  r.sl_sub_category || null,
      })
    });
    toast(`✓ "${toCat}" категорид шилжүүллээ`);
    work();
  } catch(e) { toast("Алдаа: " + e.message); }
}

// ── Execution Modal ───────────────────────────────────────────
async function openExecModal(workId) {
  const canEdit = ["director","chief_engineer","engineer","camera_engineer"].includes(state.me.role);
  const canDel  = ["director","chief_engineer"].includes(state.me.role);

  let workInfo = {};
  try {
    const all = await api("/api/work-logs");
    workInfo = all.find(r=>r.id===workId) || {};
  } catch(e){}

  let execs = [];
  try { execs = await api(`/api/work-logs/${workId}/executions`); } catch(e){}

  let linkedPtw = [];
  try { linkedPtw = await api(`/api/work-logs/${workId}/safety-reports`); } catch(e){}

  const modal = document.getElementById("execModal");
  const inner = document.getElementById("execModalInner");
  if (!modal || !inner) return;

  const PRESET_DEPTS = ["Гэрэлтүүлэг","Цахилгаан","Камер","Захиргаа","Санхүү","Хүний нөөц","Инженер","Бусад"];
  const userDepts    = (state.users||[]).map(u=>u.department||"").filter(Boolean);
  const depts        = [...new Set([...PRESET_DEPTS, ...userDepts])];

  // ── Status helpers ────────────────────────────────────────────
  const stColor = s => s==="Дууссан"?"#16a34a":s==="Хүлээгдэж байгаа"?"#94a3b8":"#2563eb";
  const stBg    = s => s==="Дууссан"?"#dcfce7":s==="Хүлээгдэж байгаа"?"#f1f5f9":"#dbeafe";
  const stIcon  = s => s==="Дууссан"?"✅":s==="Хүлээгдэж байгаа"?"⏳":"🔄";

  const prog   = workInfo.progress || 0;
  const status = workInfo.status   || "Явцтай";
  const pColor = prog>=100?"#16a34a":prog>0?"#2563eb":"#94a3b8";

  // ── Workflow status block ─────────────────────────────────────
  const cs  = workInfo.confirm_status || "";
  const wst = workInfo.status || "Явцтай";
  let confirmBlock = "";

  const _wfSteps = [
    { key:"created",   label:"Ажил үүссэн",          done: true,                                                              icon:"📋" },
    { key:"habea_pre", label:"ХАБЭА эхлэлт зөвшөөрөл", done: workInfo.habea_pre_status==="approved",                          icon:"🦺" },
    { key:"submitted", label:"Дуусгаж илгээсэн",      done: ["Дууссан гэж илгээсэн","Инженер баталсан","Хаагдсан"].includes(wst), icon:"📬" },
    { key:"eng",       label:"Ерөнхий инженер батлал", done: ["Инженер баталсан","Хаагдсан"].includes(wst),                   icon:"🔧" },
    { key:"habea_post",label:"ХАБЭА дуусгалт батлал", done: wst==="Хаагдсан",                                                 icon:"🦺" },
  ];
  const activeStep = _wfSteps.filter(s=>s.done).length - 1;
  confirmBlock = `
  <div style="margin-bottom:14px;padding:12px 14px;background:#f8fafc;border:1px solid #e2e6ed;border-radius:10px">
    <div style="font-size:11px;font-weight:700;color:#334155;margin-bottom:10px">📊 Ажлын явцын дэс дараалал</div>
    <div style="display:flex;align-items:center;gap:4px;flex-wrap:nowrap;overflow-x:auto">
      ${_wfSteps.map((s, i) => `
        <div style="display:flex;flex-direction:column;align-items:center;gap:3px;min-width:0;flex:1">
          <div style="width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;
            background:${s.done?'#16a34a':'#f1f5f9'};border:2px solid ${s.done?'#86efac':'#e2e6ed'}">${s.done?'✅':s.icon}</div>
          <div style="font-size:9px;text-align:center;color:${s.done?'#15803d':'#94a3b8'};font-weight:${s.done?'700':'400'};line-height:1.2;max-width:70px">${s.label}</div>
        </div>
        ${i<_wfSteps.length-1?`<div style="height:2px;flex:1;background:${_wfSteps[i+1].done?'#86efac':'#e2e6ed'};min-width:8px;margin-bottom:14px"></div>`:""}
      `).join("")}
    </div>
    ${wst==="Буцаагдсан"?`<div style="margin-top:10px;font-size:11px;color:#dc2626;font-weight:700">❌ Буцаагдсан${workInfo.reject_note?` · "${escapeHtml(workInfo.reject_note)}"`:""}</div>`:""}
    ${workInfo.habea_pre_status==="approved"?`<div style="margin-top:8px;font-size:11px;color:#0369a1;background:#e0f2fe;border-radius:6px;padding:5px 8px">
      🦺 Эхлэлт зөвшөөрсөн: ${escapeHtml(workInfo.habea_pre_name||"")} · ${(workInfo.habea_pre_at||"").slice(0,10)}
      ${workInfo.habea_pre_risks?`<br><b>Эрсдэл:</b> ${escapeHtml(workInfo.habea_pre_risks)}`:""}
      ${workInfo.habea_pre_measures?`<br><b>Арга хэмжээ:</b> ${escapeHtml(workInfo.habea_pre_measures)}`:""}
      ${workInfo.habea_pre_note?`<br><b>Тайлбар:</b> ${escapeHtml(workInfo.habea_pre_note)}`:""}
    </div>`:""}
    ${wst==="Хаагдсан"?`<div style="margin-top:8px;font-size:11px;color:#15803d;background:#dcfce7;border-radius:6px;padding:5px 8px">
      🦺 ХАБЭА дуусгалт: ${escapeHtml(workInfo.habea_post_name||"")} · ${(workInfo.habea_post_at||"").slice(0,10)}
      ${workInfo.habea_post_note?` · "${escapeHtml(workInfo.habea_post_note)}"`:""}</div>`:""}
    ${linkedPtw.length?`<div style="margin-top:8px;padding:8px 10px;background:#f5f3ff;border-radius:6px;border-left:3px solid #7c3aed">
      <div style="font-size:10px;font-weight:700;color:#7c3aed;margin-bottom:5px">🛂 PTW — Ажлын зөвшөөрлийн бүртгэл</div>
      ${linkedPtw.map(ptw=>`<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;padding:4px 6px;background:#fff;border-radius:5px;border:1px solid #e9d5ff;margin-bottom:3px">
        <div style="min-width:0">
          <span style="font-size:11px;font-weight:600;color:#374151">${escapeHtml(ptw.title||"PTW")}</span>
          <span style="font-size:10px;color:#94a3b8;margin-left:6px">${ptw.report_date?String(ptw.report_date).slice(0,10):""}</span>
        </div>
        <span style="flex-shrink:0;font-size:10px;padding:2px 8px;border-radius:20px;font-weight:700;
          background:${ptw.status==="Хаагдсан"?"#dcfce7":ptw.status==="Батлагдсан"?"#eff6ff":"#fff7ed"};
          color:${ptw.status==="Хаагдсан"?"#16a34a":ptw.status==="Батлагдсан"?"#2563eb":"#ea580c"}">
          ${escapeHtml(ptw.status||"—")}
        </span>
      </div>`).join("")}
    </div>`:""}
  </div>`;

  // ── Creator / workers ─────────────────────────────────────────
  const creatorUser = (state.users||[]).find(u=>u.id===workInfo.created_by);
  const creatorName = creatorUser?.full_name || "";

  // ── Execution cards ───────────────────────────────────────────
  const execCards = execs.length ? execs.map((ex, idx) => {
    const eColor = stColor(ex.status);
    const eProg  = ex.progress || 0;
    return `
    <div style="position:relative;padding-left:28px;margin-bottom:20px" id="exec-${ex.id}">
      <!-- timeline dot + line -->
      <div style="position:absolute;left:0;top:4px;width:14px;height:14px;border-radius:50%;background:${eColor};border:2px solid #fff;box-shadow:0 0 0 2px ${eColor}44;z-index:1"></div>
      ${idx < execs.length-1 ? `<div style="position:absolute;left:6px;top:20px;bottom:-20px;width:2px;background:#e2e6ed"></div>` : ""}

      <div style="background:#fff;border:1.5px solid #e2e6ed;border-radius:12px;padding:14px 16px;box-shadow:0 1px 4px rgba(0,0,0,.06)">
        <!-- exec header -->
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:10px">
          <div style="min-width:0">
            <div style="font-weight:700;font-size:13px;color:#1e293b">${escapeHtml(ex.title)}</div>
            <div style="font-size:11px;color:#94a3b8;margin-top:2px">📅 ${ex.start_date||""} ~ ${ex.end_date||""}</div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
            <span style="font-size:11px;padding:3px 10px;border-radius:20px;font-weight:600;background:${stBg(ex.status)};color:${eColor}">${stIcon(ex.status)} ${ex.status}</span>
            <span style="font-size:13px;font-weight:800;color:${eColor}">${eProg}%</span>
            ${canDel?`<button class="btn danger sm btn-del-exec" data-eid="${ex.id}" data-wid="${workId}" style="padding:2px 8px;font-size:11px">🗑</button>`:""}
          </div>
        </div>

        <!-- progress bar -->
        <div style="height:5px;background:#f1f5f9;border-radius:10px;overflow:hidden;margin-bottom:10px">
          <div style="height:100%;width:${eProg}%;background:${eColor};border-radius:10px;transition:width .4s"></div>
        </div>

        <!-- workers -->
        ${ex.workers ? `
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap">
          <span style="font-size:11px;color:#667085;font-weight:600">👷 Гүйцэтгэгч:</span>
          ${ex.workers.split(",").map(w=>w.trim()).filter(Boolean).map(w=>`
            <span style="font-size:11px;padding:2px 8px;background:#f1f5f9;border-radius:20px;color:#334155;font-weight:500">${escapeHtml(w)}</span>
          `).join("")}
        </div>` : ""}

        <!-- note -->
        ${ex.note ? `<div style="font-size:12px;color:#334155;background:#f8f9fb;border-left:3px solid #c7d2fe;padding:8px 12px;border-radius:0 6px 6px 0;margin-bottom:8px;line-height:1.5">📝 ${escapeHtml(ex.note)}</div>` : ""}

        <!-- safety -->
        ${ex.safety_note ? `<div style="font-size:11px;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:7px 10px;margin-bottom:8px">🦺 <b>ХАБЭА:</b> ${escapeHtml(ex.safety_note)}</div>` : ""}

        <!-- photos -->
        <div id="execPhotos-${ex.id}" style="margin-bottom:6px"></div>

        <!-- photo actions -->
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:4px">
          ${canEdit?`<label style="display:inline-flex;align-items:center;gap:5px;cursor:pointer;font-size:11px;background:#f8f9fb;border:1px dashed #c7d2fe;border-radius:7px;padding:4px 10px;color:#4f46e5">
            📎 Зураг нэмэх
            <input type="file" class="inp-exec-photo" data-eid="${ex.id}" data-wid="${workId}" accept="image/*" style="display:none">
          </label>`:""}
          ${(ex.photo_count||0)>0?`<button class="btn secondary sm btn-load-photos" data-eid="${ex.id}" style="font-size:11px">🖼 Зураг харах (${ex.photo_count})</button>`:""}
        </div>
      </div>
    </div>`;
  }).join("") : `
    <div style="text-align:center;padding:36px 20px;color:#94a3b8">
      <div style="font-size:36px;margin-bottom:10px">📋</div>
      <div style="font-size:14px;font-weight:600;color:#64748b;margin-bottom:4px">Гүйцэтгэл бүртгэгдээгүй байна</div>
      <div style="font-size:12px">Ажлын гүйцэтгэлийг "Гүйцэтгэл нэмэх" товчоор нэмнэ үү</div>
    </div>`;

  // ── Add-exec form (collapsible) ───────────────────────────────
  const addForm = canEdit ? `
    <div style="padding:14px 20px;border-top:1px solid #e2e6ed;background:#f8f9fb">
      <button id="toggleAddExec"
        style="width:100%;padding:10px;border:1.5px dashed #c7d2fe;border-radius:10px;background:#fff;font-size:13px;font-weight:600;color:#2563eb;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px">
        ➕ Гүйцэтгэл нэмэх
      </button>
      <div id="addExecForm" style="display:none;margin-top:14px">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px">
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Нэр *</div>
            <input class="input" id="exTitle" placeholder="Гүйцэтгэлийн нэр"></div>
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Эхлэх огноо</div>
            <input class="input" id="exStart" type="date" value="${today()}"></div>
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Дуусах огноо</div>
            <input class="input" id="exEnd" type="date" value="${today()}"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Явц %</div>
            <input class="input" id="exProg" type="number" value="0" min="0" max="100"></div>
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Төлөв</div>
            <select class="input" id="exStatus">
              <option>Эхэлсэн</option><option selected>Явцтай</option>
              <option>Дууссан</option><option>Хүлээгдэж байгаа</option>
            </select></div>
        </div>
        <div style="margin-bottom:10px">
          <div style="font-size:11px;color:#667085;margin-bottom:4px">👥 Тасаг сонгох</div>
          <select class="input" id="exDept" onchange="filterExecWorkers()">
            <option value="">— Тасаг сонгох —</option>
            ${depts.map(d=>`<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join("")}
          </select>
        </div>
        <div style="margin-bottom:10px">
          <div style="font-size:11px;color:#667085;margin-bottom:6px">👷 Ажилсан хүмүүс</div>
          <div id="exWorkersBox" style="display:flex;flex-wrap:wrap;gap:6px;padding:8px;background:#fff;border:1px solid #e2e6ed;border-radius:8px;min-height:38px">
            <span style="font-size:11px;color:#94a3b8;align-self:center">Тасаг сонгоход ажилчид харагдана</span>
          </div>
          <input type="hidden" id="exWorkers">
        </div>
        <div style="margin-bottom:10px">
          <div style="font-size:11px;color:#667085;margin-bottom:6px">📷 Зураг нэмэх</div>
          <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;padding:7px 14px;background:#fff;border:1.5px dashed #c7d2fe;border-radius:8px;font-size:12px;color:#4f46e5">
            📎 Зураг сонгох (олон боломжтой)
            <input type="file" id="exPhotos" accept="image/*" multiple style="display:none" onchange="previewExecPhotos()">
          </label>
          <div id="exPhotoPreview" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px"></div>
        </div>
        <div style="margin-bottom:8px">
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Тайлбар</div>
          <textarea class="input" id="exNote" placeholder="Тайлбар" style="min-height:60px;margin:0"></textarea>
        </div>
        <div style="margin-bottom:12px">
          <div style="font-size:11px;color:#d97706;margin-bottom:4px">🦺 ХАБЭА зааварчилгаа</div>
          <textarea class="input" id="exSafety" placeholder="Аюулгүй ажиллагааны заавар..." style="min-height:48px;margin:0"></textarea>
        </div>
        <button class="btn" id="btnSaveExec">✔ Гүйцэтгэл хадгалах</button>
      </div>
    </div>` : "";

  inner.innerHTML = `
    <!-- Sticky header -->
    <div style="padding:16px 20px;border-bottom:1px solid #e2e6ed;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;position:sticky;top:0;background:#fff;z-index:10;border-radius:14px 14px 0 0">
      <div style="min-width:0">
        <div style="font-size:15px;font-weight:800;color:#1e293b;line-height:1.3">${escapeHtml(workInfo.title||"")}</div>
        <div style="font-size:11px;color:#94a3b8;margin-top:3px">${escapeHtml(workInfo.category||"")} · ${escapeHtml(workInfo.department||"")}</div>
      </div>
      <button id="btnCloseExec" style="border:none;background:#f1f5f9;border-radius:8px;padding:6px 14px;font-size:13px;cursor:pointer;color:#667085;flex-shrink:0">✕ Хаах</button>
    </div>

    <!-- Summary cards -->
    <div style="padding:16px 20px;border-bottom:1px solid #f0f2f5">
      ${confirmBlock}

      <!-- Progress + status -->
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px;flex-wrap:wrap">
        <div style="text-align:center;flex-shrink:0">
          <div style="font-size:36px;font-weight:900;color:${pColor};line-height:1">${prog}%</div>
          <div style="font-size:10px;color:#94a3b8;margin-top:2px">Нийт явц</div>
        </div>
        <div style="flex:1;min-width:180px">
          <div style="height:10px;background:#f1f5f9;border-radius:10px;overflow:hidden;margin-bottom:8px">
            <div style="height:100%;width:${prog}%;background:${pColor};border-radius:10px;transition:width .5s"></div>
          </div>
          <div style="display:inline-flex;align-items:center;gap:5px;padding:4px 12px;border-radius:20px;background:${stBg(status)};font-size:12px;font-weight:700;color:${stColor(status)}">
            ${stIcon(status)} ${status}
          </div>
        </div>
      </div>

      <!-- Info grid -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:12px">
        ${workInfo.location ? `
        <div style="background:#f8f9fb;border-radius:8px;padding:10px 12px">
          <div style="font-size:10px;color:#94a3b8;font-weight:600;margin-bottom:3px">📍 БАЙРШИЛ</div>
          <div style="font-weight:600;color:#1e293b">${escapeHtml(workInfo.location)}</div>
        </div>` : ""}
        ${workInfo.department ? `
        <div style="background:#f8f9fb;border-radius:8px;padding:10px 12px">
          <div style="font-size:10px;color:#94a3b8;font-weight:600;margin-bottom:3px">🏢 ХЭЛТЭС / ТАСАГ</div>
          <div style="font-weight:600;color:#1e293b">${escapeHtml(workInfo.department)}</div>
        </div>` : ""}
        <div style="background:#f8f9fb;border-radius:8px;padding:10px 12px">
          <div style="font-size:10px;color:#94a3b8;font-weight:600;margin-bottom:3px">📅 ХУГАЦАА</div>
          <div style="font-weight:600;color:#1e293b">${workInfo.start_date||"?"} ~ ${workInfo.end_date||"?"}</div>
        </div>
        ${creatorName ? `
        <div style="background:#f8f9fb;border-radius:8px;padding:10px 12px">
          <div style="font-size:10px;color:#94a3b8;font-weight:600;margin-bottom:3px">👤 ТӨЛӨВЛӨСӨН</div>
          <div style="font-weight:600;color:#1e293b">${escapeHtml(creatorName)}</div>
        </div>` : ""}
        ${workInfo.material_note ? `
        <div style="background:#f8f9fb;border-radius:8px;padding:10px 12px;grid-column:1/-1">
          <div style="font-size:10px;color:#94a3b8;font-weight:600;margin-bottom:5px">👷 ХАРИУЦАХ АЖИЛЧИД</div>
          <div style="display:flex;flex-wrap:wrap;gap:5px">
            ${workInfo.material_note.split(",").map(w=>w.trim()).filter(Boolean).map(w=>`
              <span style="padding:2px 10px;background:#eff6ff;border-radius:20px;font-size:11px;font-weight:600;color:#2563eb">${escapeHtml(w)}</span>
            `).join("")}
          </div>
        </div>` : ""}
        ${workInfo.description ? `
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 12px;grid-column:1/-1">
          <div style="font-size:10px;color:#92400e;font-weight:600;margin-bottom:3px">📄 ТАЙЛБАР</div>
          <div style="color:#78350f;line-height:1.5">${escapeHtml(workInfo.description)}</div>
        </div>` : ""}
      </div>
    </div>

    <!-- Executions timeline -->
    <div style="padding:16px 20px">
      <div style="font-size:13px;font-weight:700;color:#344054;margin-bottom:16px;display:flex;align-items:center;gap:8px">
        <span>📋 Гүйцэтгэлийн явц</span>
        <span style="font-size:11px;background:#e2e6ed;border-radius:20px;padding:2px 8px;color:#667085">${execs.length}</span>
      </div>
      ${execCards}
    </div>

    ${addForm}`;

  modal.style.display = "flex";

  document.getElementById("btnCloseExec")?.addEventListener("click", closeExecModal);

  if (canEdit) {
    document.getElementById("toggleAddExec")?.addEventListener("click", () => {
      const f = document.getElementById("addExecForm");
      if (f) f.style.display = f.style.display === "none" ? "block" : "none";
    });
    document.getElementById("btnSaveExec")?.addEventListener("click", () => saveExec(workId));
  }

  inner.querySelectorAll(".btn-del-exec").forEach(btn => {
    btn.addEventListener("click", () => deleteExec(Number(btn.dataset.eid), Number(btn.dataset.wid)));
  });
  inner.querySelectorAll(".inp-exec-photo").forEach(inp => {
    inp.addEventListener("change", () => uploadExecPhoto(Number(inp.dataset.eid), Number(inp.dataset.wid)));
  });
  inner.querySelectorAll(".btn-load-photos").forEach(btn => {
    btn.addEventListener("click", () => loadExecPhotos(Number(btn.dataset.eid)));
  });
  execs.filter(e=>(e.photo_count||0)>0).forEach(e => loadExecPhotos(e.id));
}

function closeExecModal() {
  const m = document.getElementById("execModal");
  if (m) m.style.display = "none";
}

function eeFilterWorkers() {
  const dept    = document.getElementById("eeDept")?.value || "";
  const box     = document.getElementById("eeWorkersBox");
  const current = (document.getElementById("eeWorkers")?.value || "").split(",").map(s=>s.trim()).filter(Boolean);
  if (!box) return;
  let users = (state.users||[]).filter(u => dept ? u.department === dept : true);
  if (dept && !users.length) users = state.users||[];
  box.innerHTML = users.map(u => {
    const checked = current.includes(u.full_name);
    return `<label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;padding:5px 12px;border:1.5px solid ${checked?'#2563eb':'#e2e6ed'};border-radius:20px;background:${checked?'#eff6ff':'#fff'};font-size:12px;user-select:none;transition:all .15s">
      <input type="checkbox" class="ee-worker-cb" value="${escapeHtml(u.full_name)}" ${checked?'checked':''}
        style="width:14px;height:14px;cursor:pointer;accent-color:#2563eb"
        onchange="this.closest('label').style.background=this.checked?'#eff6ff':'#fff';
                  this.closest('label').style.borderColor=this.checked?'#2563eb':'#e2e6ed';
                  this.closest('label').style.color=this.checked?'#1d4ed8':'inherit';
                  eeUpdateWorkers()">
      <span style="font-weight:500">${escapeHtml(u.full_name)}</span>
      ${u.position?`<span style="font-size:10px;color:#94a3b8">${escapeHtml(u.position)}</span>`:''}
      ${u.department&&!dept?`<span style="font-size:9px;color:#6366f1;background:#ede9fe;padding:1px 5px;border-radius:8px">${escapeHtml(u.department)}</span>`:''}
    </label>`;
  }).join("");
}

function eeUpdateWorkers() {
  const names = [...document.querySelectorAll(".ee-worker-cb:checked")].map(c=>c.value).join(", ");
  const el = document.getElementById("eeWorkers");
  if (el) el.value = names;
}

function filterExecWorkers() {
  const dept = document.getElementById("exDept")?.value || "";
  const box  = document.getElementById("exWorkersBox");
  if (!box) return;

  // тасгийн ажилчид эхлээд хайх, байхгүй бол бүх ажилчдыг харуулах
  let users = (state.users||[]).filter(u => dept && u.department === dept);
  const noMatch = dept && users.length === 0;
  if (noMatch) users = (state.users||[]); // fallback: бүх ажилтан

  if (!users.length) {
    box.innerHTML = `<span style="font-size:11px;color:#94a3b8;padding:4px">Ажилтан бүртгэгдээгүй байна</span>`;
    return;
  }

  // CSS нэг удаа inject
  if (!document.getElementById("excWorkerStyle")) {
    const s = document.createElement("style");
    s.id = "excWorkerStyle";
    s.textContent = `.sel-w{background:#eff6ff!important;border-color:#2563eb!important;color:#1d4ed8!important;font-weight:700!important}`;
    document.head.appendChild(s);
  }

  box.innerHTML = (noMatch
    ? `<div style="width:100%;font-size:10px;color:#d97706;margin-bottom:6px;padding:2px 4px">
         ⚠️ "${escapeHtml(dept)}" тасагт ажилтан олдсонгүй — бүх ажилтан харагдаж байна
       </div>` : "")
    + users.map(u => `
    <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;padding:5px 12px;border:1.5px solid #e2e6ed;border-radius:20px;background:#fff;font-size:12px;user-select:none;transition:all .15s">
      <input type="checkbox" class="exc-worker-cb" value="${escapeHtml(u.full_name)}"
        style="width:14px;height:14px;cursor:pointer;accent-color:#2563eb"
        onchange="this.closest('label').style.background=this.checked?'#eff6ff':'#fff';
                  this.closest('label').style.borderColor=this.checked?'#2563eb':'#e2e6ed';
                  this.closest('label').style.color=this.checked?'#1d4ed8':'inherit';
                  updateExecWorkers()">
      <span style="font-weight:500">${escapeHtml(u.full_name)}</span>
      ${u.position?`<span style="font-size:10px;color:#94a3b8">${escapeHtml(u.position)}</span>`:""}
      ${u.department && !dept?`<span style="font-size:9px;color:#6366f1;background:#ede9fe;padding:1px 5px;border-radius:8px">${escapeHtml(u.department)}</span>`:""}
    </label>`).join("");
}

function updateExecWorkers() {
  const names = [...document.querySelectorAll(".exc-worker-cb:checked")].map(c=>c.value).join(", ");
  const el = document.getElementById("exWorkers");
  if (el) el.value = names;
}

function previewExecPhotos() {
  const files = document.getElementById("exPhotos")?.files;
  const prev  = document.getElementById("exPhotoPreview");
  if (!files || !prev) return;
  prev.innerHTML = "";
  [...files].forEach(f => {
    const url = URL.createObjectURL(f);
    prev.innerHTML += `<div style="position:relative;display:inline-block">
      <img src="${url}" style="height:64px;width:80px;object-fit:cover;border-radius:6px;border:1px solid #e2e6ed">
    </div>`;
  });
}

async function saveExec(workId) {
  const titleEl = document.getElementById("exTitle");
  if (!titleEl) { toast("Form олдсонгүй"); return; }
  const title = titleEl.value.trim();
  if (!title) { toast("Нэр оруулна уу"); return; }
  const g = id => (document.getElementById(id)||{}).value||"";
  const workers = g("exWorkers") || [...document.querySelectorAll(".exc-worker-cb:checked")].map(c=>c.value).join(", ");
  const btn = document.getElementById("btnSaveExec");
  if (btn) btn.disabled = true;
  try {
    const res = await api(`/api/work-logs/${workId}/executions`, {
      method: "POST",
      body: JSON.stringify({
        title, start_date: g("exStart"), end_date: g("exEnd"),
        progress: Number(g("exProg")||0), status: g("exStatus")||"Явцтай",
        workers, note: g("exNote"), safety_note: g("exSafety"),
      })
    });
    // Upload photos if any
    const photoFiles = document.getElementById("exPhotos")?.files;
    if (photoFiles && photoFiles.length && res.id) {
      for (const file of photoFiles) {
        const fd = new FormData();
        fd.append("photo", file);
        await fetch(location.origin + `/api/executions/${res.id}/photos`, {
          method: "POST",
          headers: { "Authorization": "Bearer " + (localStorage.getItem("token")||"") },
          body: fd
        });
      }
    }
    toast(`✅ Гүйцэтгэл нэмэгдлээ${photoFiles?.length ? ` · ${photoFiles.length} зураг хадгалагдлаа` : ""}`);
    closeExecModal();
    work();
  } catch(err) { toast("Алдаа: "+err.message); }
  finally { if (btn) btn.disabled = false; }
}

async function deleteExec(execId, workId) {
  if (!confirm("Гүйцэтгэлийг устгах уу?")) return;
  try {
    await api(`/api/executions/${execId}`, { method:"DELETE" });
    toast("Гүйцэтгэл устгагдлаа ✓");
    closeExecModal();
    work();
  } catch(err) { toast("Устгах алдаа: "+err.message); }
}

function openEditExecModal(btn) {
  const execId  = Number(btn.dataset.eid);
  const workId  = Number(btn.dataset.wid);
  let m = document.getElementById("editExecModal");
  if (!m) { m = document.createElement("div"); m.id = "editExecModal"; document.body.appendChild(m); }
  m.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:3000;display:flex;align-items:flex-start;justify-content:center;padding-top:80px";
  m.innerHTML = `
    <div style="background:#fff;border-radius:14px;width:min(500px,94vw);box-shadow:0 20px 60px rgba(0,0,0,.2);overflow:hidden">
      <div style="background:linear-gradient(135deg,#6366f1,#4f46e5);padding:14px 18px;display:flex;align-items:center;justify-content:space-between">
        <div style="color:#fff;font-size:14px;font-weight:800">✏️ Гүйцэтгэл засах</div>
        <button onclick="document.getElementById('editExecModal').style.display='none'"
          style="border:none;background:rgba(255,255,255,.2);color:#fff;border-radius:8px;padding:4px 10px;cursor:pointer">✕</button>
      </div>
      <div style="padding:18px;display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div style="grid-column:1/-1">
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Нэр *</div>
          <input class="input" id="eeTitle" value="${btn.dataset.title||""}">
        </div>
        <div>
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Эхлэх огноо</div>
          <input class="input" id="eeStart" type="date" value="${btn.dataset.start||""}">
        </div>
        <div>
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Дуусах огноо</div>
          <input class="input" id="eeEnd" type="date" value="${btn.dataset.end||""}">
        </div>
        <div>
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Явц %</div>
          <input class="input" id="eeProg" type="number" min="0" max="100" value="${btn.dataset.prog||0}">
        </div>
        <div>
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Төлөв</div>
          <select class="input" id="eeStatus">
            ${["Эхэлсэн","Явцтай","Дууссан","Хүлээгдэж байгаа"].map(s=>
              `<option ${s===(btn.dataset.status||"Явцтай")?"selected":""}>${s}</option>`).join("")}
          </select>
        </div>
        <div style="grid-column:1/-1">
          <div style="font-size:11px;color:#667085;margin-bottom:6px">👷 Ажилсан хүмүүс</div>
          <select class="input" id="eeDept" onchange="eeFilterWorkers()" style="margin-bottom:8px">
            <option value="">— Тасгаар шүүх —</option>
            ${[...new Set((state.users||[]).map(u=>u.department).filter(Boolean))].sort().map(d=>`<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join("")}
          </select>
          <div id="eeWorkersBox" style="display:flex;flex-wrap:wrap;gap:6px;padding:8px;background:#fff;border:1px solid #e2e6ed;border-radius:8px;min-height:38px"></div>
          <input type="hidden" id="eeWorkers" value="${escapeHtml(btn.dataset.workers||"")}">
        </div>
        <div style="grid-column:1/-1">
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Тайлбар</div>
          <textarea class="input" id="eeNote" rows="2" style="resize:vertical">${btn.dataset.note||""}</textarea>
        </div>
        <div style="grid-column:1/-1;display:flex;gap:8px">
          <button onclick="updateExec(${execId},${workId})"
            style="flex:1;background:#6366f1;color:#fff;border:none;border-radius:8px;padding:10px;font-size:13px;font-weight:700;cursor:pointer">
            💾 Хадгалах
          </button>
          <button onclick="document.getElementById('editExecModal').style.display='none'"
            style="background:#f1f5f9;color:#475569;border:none;border-radius:8px;padding:10px 16px;font-size:13px;cursor:pointer">
            Болих
          </button>
        </div>
      </div>
    </div>`;
  m.addEventListener("click", e => { if (e.target === m) m.style.display = "none"; });
  // Ажилтнуудыг автоматаар харуулах
  setTimeout(() => eeFilterWorkers(), 0);
}

async function updateExec(execId, workId) {
  const g = id => (document.getElementById(id)||{}).value||"";
  const title = g("eeTitle").trim();
  if (!title) { toast("Нэр оруулна уу"); return; }
  try {
    await api(`/api/executions/${execId}`, {
      method: "PUT",
      body: JSON.stringify({
        title,
        start_date: g("eeStart"),
        end_date:   g("eeEnd"),
        progress:   Number(g("eeProg")||0),
        status:     g("eeStatus")||"Явцтай",
        workers:    g("eeWorkers"),
        note:       g("eeNote"),
      })
    });
    toast("✅ Гүйцэтгэл шинэчлэгдлээ");
    document.getElementById("editExecModal").style.display = "none";
    work();
  } catch(err) { toast("Алдаа: "+err.message); }
}

async function loadExecPhotos(execId) {
  const canDel = ["director","chief_engineer","engineer"].includes(state.me.role);
  let photos = [];
  try { photos = await api(`/api/executions/${execId}/photos`); } catch(e){ return; }
  const c = document.getElementById(`execPhotos-${execId}`);
  if (!c) return;
  if (!photos.length) { c.innerHTML = ""; return; }
  c.innerHTML = `
    <div style="margin-top:10px">
      <div style="font-size:11px;font-weight:700;color:#667085;letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px">
        📷 Зургийн бүртгэл (${photos.length})
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px">
        ${photos.map(p => {
          const src = (p.file_path||"").replace(/^\/?/,"");
          const stamp = p.stamp_text || "";
          const date  = (p.uploaded_at||"").slice(0,10);
          return `<div style="position:relative;border-radius:10px;overflow:hidden;border:1px solid #e2e6ed;box-shadow:0 1px 4px rgba(0,0,0,.08)">
            <img src="/${src}" style="width:100%;height:110px;object-fit:cover;display:block;cursor:pointer"
              onclick="window.open('/${src}','_blank')" title="${escapeHtml(stamp)}">
            <div style="padding:6px 8px;background:#fff">
              <div style="font-size:10px;color:#344054;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(stamp||"—")}</div>
              <div style="font-size:9px;color:#98a2b3;margin-top:2px">${date}</div>
            </div>
            ${canDel ? `<button class="btn-del-photo" data-pid="${p.id}" data-eid="${execId}"
              style="position:absolute;top:5px;right:5px;background:rgba(220,38,38,.82);color:#fff;border:none;border-radius:5px;padding:2px 7px;font-size:11px;cursor:pointer;line-height:1.4">✕</button>` : ""}
          </div>`;
        }).join("")}
      </div>
    </div>`;
  c.querySelectorAll(".btn-del-photo").forEach(btn => {
    btn.addEventListener("click", () => deleteExecPhoto(Number(btn.dataset.pid), Number(btn.dataset.eid)));
  });
}

async function deleteExecPhoto(photoId, execId) {
  if (!confirm("Зургийг устгах уу?")) return;
  try {
    await api(`/api/execution-photos/${photoId}`, { method:"DELETE" });
    toast("Зураг устгагдлаа ✓");
    loadExecPhotos(execId);
  } catch(err) { toast("Алдаа: "+err.message); }
}

async function uploadExecPhoto(execId, workId) {
  const inp = document.querySelector(`.inp-exec-photo[data-eid="${execId}"]`);
  if (!inp || !inp.files[0]) { toast("Зураг сонгоно уу"); return; }

  let stampText = "";
  try {
    const allWork = await api("/api/work-logs");
    const execs   = await api(`/api/work-logs/${workId}/executions`);
    const w  = allWork.find(r => r.id === workId);
    const ex = execs.find(e => e.id === execId);
    const now = new Date().toLocaleDateString("mn-MN");
    stampText = [
      w?.title || "", ex?.title || "",
      ex?.start_date ? `${ex.start_date} ~ ${ex.end_date}` : "", now
    ].filter(Boolean).join(" · ");
  } catch(e) {
    stampText = new Date().toLocaleDateString("mn-MN");
  }

  const file = inp.files[0];
  const btn  = inp.closest("label");
  if (btn) btn.textContent = "Боловсруулж байна...";

  try {
    const stampedBlob = await stampImage(file, stampText);
    const fd = new FormData();
    fd.append("photo", stampedBlob, file.name);
    fd.append("stamp_text", stampText);

    const res = await fetch(API + `/api/executions/${execId}/photos`, {
      method: "POST",
      headers: { "Authorization": "Bearer " + state.token },
      body: fd
    });
    if (!res.ok) throw new Error("Upload амжилтгүй");
    toast("Зураг хадгаллаа ✓");
    inp.value = "";
    loadExecPhotos(execId);
  } catch(err) {
    toast("Upload алдаа: " + err.message);
  } finally {
    if (btn) btn.innerHTML = `📎 Зураг нэмэх <input type="file" class="inp-exec-photo" data-eid="${execId}" data-wid="${workId}" accept="image/*" style="display:none">`;
    const newInp = btn?.querySelector("input");
    if (newInp) newInp.addEventListener("change", () => uploadExecPhoto(execId, workId));
  }
}

function stampImage(file, stampText) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width  = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const fontSize  = Math.max(16, Math.round(img.width * 0.022));
      const padH      = Math.round(fontSize * 0.7);
      const padV      = Math.round(fontSize * 0.5);
      const boxH      = fontSize + padV * 2;
      const margin    = Math.round(img.width * 0.015);
      ctx.font = `bold ${fontSize}px Arial, sans-serif`;
      const textW = ctx.measureText(stampText).width;
      const boxW  = textW + padH * 2;
      const x = img.width  - boxW  - margin;
      const y = img.height - boxH  - margin;
      ctx.fillStyle = "rgba(0,0,0,0.68)";
      ctx.beginPath();
      ctx.roundRect(x, y, boxW, boxH, 6);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.textBaseline = "middle";
      ctx.fillText(stampText, x + padH, y + boxH / 2);
      URL.revokeObjectURL(url);
      canvas.toBlob(blob => resolve(blob), "image/jpeg", 0.88);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Зураг уншихад алдаа гарлаа")); };
    img.src = url;
  });
}

function openExecDetail(workId, execId) {
  openExecModal(workId).then(()=>{
    const el = document.getElementById(`exec-${execId}`);
    if (el) el.scrollIntoView({behavior:"smooth",block:"center"});
  });
}

function scrollGanttToMonth(m) {
  const el = document.getElementById(`gantt-m${m}`);
  const wrap = document.getElementById("ganttWrap");
  if (!el || !wrap) return;
  const wRect = wrap.getBoundingClientRect();
  const eRect = el.getBoundingClientRect();
  wrap.scrollLeft += (eRect.left - wRect.left) - 360;
}

function autoScrollToCurrentMonth() {
  const m = window.workYear === new Date().getFullYear() ? new Date().getMonth()+1 : 1;
  setTimeout(() => scrollGanttToMonth(m), 100);
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
    <div class="photos" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px">
      ${photos.length
        ? photos.map(p => {
            const img = (p.filename || p.file_path || "").replace(/^\/?uploads\//, "");
            return `<div class="card" style="padding:10px">
              <img src="${API}/uploads/${img}"
                onclick="window.open('${API}/uploads/${img}', '_blank')"
                style="width:100%;height:160px;object-fit:cover;border-radius:12px;cursor:pointer;border:1px solid #e5e7eb">
              <div class="small muted" style="margin-top:8px">Оруулсан: ${escapeHtml(p.full_name || "Хэрэглэгч")}</div>
              <div class="small muted">Огноо: ${escapeHtml(p.created_at || p.uploaded_at || "")}</div>
            </div>`;
          }).join("")
        : `<p class="muted">Одоогоор зураг ороогүй байна</p>`}
    </div>
  </div>`;
}

async function uploadPhoto(id) {
  const fd = new FormData();
  fd.append("photo", pfile.files[0]);
  const r = await fetch(API + `/api/work-logs/${id}/photos`, {
    method: "POST",
    headers: { "Authorization": "Bearer " + state.token },
    body: fd
  });
  if (!r.ok) { alert("Upload амжилтгүй"); return; }
  toast("Зураг хадгаллаа");
  show("work");
}

// ── Quick progress update modal ───────────────────────────────
function openProgressModal(workId, title, currentProg, currentStatus) {
  let m = document.getElementById("progressModal");
  if (!m) { m = document.createElement("div"); m.id = "progressModal"; document.body.appendChild(m); }
  m.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:3000;display:flex;align-items:flex-start;justify-content:center;padding-top:80px";
  m.innerHTML = `
    <div style="background:#fff;border-radius:16px;width:min(460px,94vw);box-shadow:0 20px 60px rgba(0,0,0,.25);overflow:hidden">
      <div style="background:linear-gradient(135deg,#0ea5e9,#2563eb);padding:16px 20px;display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="color:#fff;font-size:14px;font-weight:800">📝 Ажлын явц шинэчлэх</div>
          <div style="color:rgba(255,255,255,.8);font-size:11px;margin-top:2px">${escapeHtml(title)}</div>
        </div>
        <button onclick="document.getElementById('progressModal').style.display='none'"
          style="border:none;background:rgba(255,255,255,.2);color:#fff;border-radius:8px;padding:5px 12px;cursor:pointer;font-size:13px">✕</button>
      </div>
      <div style="padding:22px">
        <div style="margin-bottom:18px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <span style="font-size:13px;font-weight:700;color:#344054">Явцын хувь</span>
            <span id="pmProgLabel" style="font-size:20px;font-weight:800;color:#2563eb">${currentProg}%</span>
          </div>
          <input type="range" id="pmProg" min="0" max="100" value="${currentProg}"
            style="width:100%;accent-color:#2563eb;height:6px;cursor:pointer"
            oninput="document.getElementById('pmProgLabel').textContent=this.value+'%'">
          <div style="display:flex;justify-content:space-between;font-size:10px;color:#94a3b8;margin-top:3px">
            <span>0%</span><span>50%</span><span>100%</span>
          </div>
        </div>
        <div style="margin-bottom:16px">
          <div style="font-size:13px;font-weight:700;color:#344054;margin-bottom:8px">Төлөв</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${["Эхэлсэн","Явцтай","Дууссан","Хүлээгдэж байгаа"].map(s => `
              <label style="display:flex;align-items:center;gap:5px;cursor:pointer;padding:7px 12px;border:1.5px solid ${s===currentStatus?'#2563eb':'#e2e6ed'};border-radius:8px;background:${s===currentStatus?'#eff6ff':'#fff'};font-size:12px;font-weight:${s===currentStatus?'700':'400'}">
                <input type="radio" name="pmStatus" value="${s}" ${s===currentStatus?'checked':''} style="accent-color:#2563eb">
                ${s==='Дууссан'?'✅ ':s==='Явцтай'?'🔄 ':s==='Эхэлсэн'?'▶️ ':'⏳ '}${s}
              </label>`).join('')}
          </div>
        </div>
        <div style="margin-bottom:20px">
          <div style="font-size:13px;font-weight:700;color:#344054;margin-bottom:6px">Тайлбар</div>
          <textarea id="pmNote" class="input" rows="2" placeholder="Өнөөдөр юу хийсэн, ямар байдалтай байна..." style="resize:vertical"></textarea>
        </div>
        <button id="pmBtn" onclick="submitProgress(${workId})"
          style="width:100%;background:#2563eb;color:#fff;border:none;border-radius:10px;padding:12px;font-size:14px;font-weight:700;cursor:pointer">
          ✅ Хадгалах
        </button>
      </div>
    </div>`;
  m.addEventListener("click", e => { if (e.target === m) m.style.display = "none"; }, { once: false });
}

async function submitProgress(workId) {
  const prog   = Number(document.getElementById("pmProg")?.value || 0);
  const status = document.querySelector("input[name='pmStatus']:checked")?.value || "Явцтай";
  const note   = document.getElementById("pmNote")?.value?.trim() || "";
  const btn    = document.getElementById("pmBtn");
  if (btn) btn.disabled = true;
  try {
    const all  = await api("/api/work-logs");
    const work = all.find(r => r.id === workId);
    if (!work) throw new Error("Ажил олдсонгүй");
    await api(`/api/work-logs/${workId}`, {
      method: "PUT",
      body: JSON.stringify({
        ...work,
        progress: prog,
        status,
        description: note ? (work.description ? work.description + "\n" + note : note) : work.description,
      })
    });
    document.getElementById("progressModal").style.display = "none";
    toast(`✅ Явц ${prog}% · ${status} гэж шинэчлэгдлээ`);
    work();
  } catch(e) { toast("Алдаа: " + e.message); }
  finally { if (btn) btn.disabled = false; }
}

// ── Quick photo upload modal ──────────────────────────────────
function openQuickPhotoModal(workId, title) {
  let m = document.getElementById("quickPhotoModal");
  if (!m) {
    m = document.createElement("div");
    m.id = "quickPhotoModal";
    m.style.cssText = "display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:3000;align-items:flex-start;justify-content:center;padding-top:80px";
    document.body.appendChild(m);
  }
  m.innerHTML = `
    <div style="background:#fff;border-radius:16px;width:min(480px,94vw);box-shadow:0 20px 60px rgba(0,0,0,.25);overflow:hidden">
      <div style="background:linear-gradient(135deg,#1d4ed8,#2563eb);padding:16px 20px;display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="color:#fff;font-size:14px;font-weight:800">📷 Зураг нэмэх</div>
          <div style="color:rgba(255,255,255,.75);font-size:11px;margin-top:2px">${escapeHtml(title)}</div>
        </div>
        <button onclick="document.getElementById('quickPhotoModal').style.display='none'"
          style="border:none;background:rgba(255,255,255,.2);color:#fff;border-radius:8px;padding:5px 12px;cursor:pointer;font-size:13px">✕</button>
      </div>
      <div style="padding:20px">
        <div style="border:2px dashed #d0d5dd;border-radius:12px;padding:20px;text-align:center;cursor:pointer;background:#f8f9fb;margin-bottom:14px"
          onclick="document.getElementById('qpFile').click()">
          <div style="font-size:32px;margin-bottom:6px">📷</div>
          <div style="font-size:13px;font-weight:600;color:#344054">Зураг сонгох</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:3px">JPG, PNG, HEIC — дарж сонгоно уу</div>
          <input type="file" id="qpFile" accept="image/*" style="display:none" multiple
            onchange="qpPreviewFiles(this)">
        </div>
        <div id="qpPreviews" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px"></div>
        <div style="margin-bottom:14px">
          <div style="font-size:11px;font-weight:600;color:#344054;margin-bottom:4px">Тайлбар (заавал биш)</div>
          <input class="input" id="qpNote" placeholder="Засварын явц, тайлбар...">
        </div>
        <div style="display:flex;gap:8px">
          <button id="qpSubmitBtn" onclick="submitQuickPhotos(${workId}, '${escapeHtml(title)}')"
            style="flex:1;background:#2563eb;color:#fff;border:none;border-radius:8px;padding:10px;font-size:14px;font-weight:700;cursor:pointer">
            📤 Хадгалах
          </button>
          <button onclick="document.getElementById('quickPhotoModal').style.display='none'"
            style="padding:10px 18px;border:1px solid #e2e6ed;border-radius:8px;background:#fff;font-size:13px;cursor:pointer">
            Цуцлах
          </button>
        </div>
        <div id="qpStatus" style="margin-top:10px;font-size:12px;text-align:center;color:#667085"></div>
      </div>
    </div>`;
  m.style.display = "flex";
}

function qpPreviewFiles(inp) {
  const container = document.getElementById("qpPreviews");
  if (!container) return;
  container.innerHTML = "";
  [...inp.files].forEach(file => {
    const url = URL.createObjectURL(file);
    container.innerHTML += `
      <div style="position:relative;width:80px;height:80px;border-radius:8px;overflow:hidden;border:1px solid #e2e6ed">
        <img src="${url}" style="width:100%;height:100%;object-fit:cover">
      </div>`;
  });
}

async function submitQuickPhotos(workId, title) {
  const inp = document.getElementById("qpFile");
  const note = (document.getElementById("qpNote")?.value || "").trim();
  const btn  = document.getElementById("qpSubmitBtn");
  const status = document.getElementById("qpStatus");
  if (!inp || !inp.files.length) { toast("Зураг сонгоно уу"); return; }
  if (btn) btn.disabled = true;
  const files = [...inp.files];
  let done = 0;
  for (const file of files) {
    if (status) status.textContent = `Боловсруулж байна ${done+1}/${files.length}...`;
    try {
      const now = new Date().toLocaleDateString("mn-MN");
      const stampText = [title, note, now].filter(Boolean).join(" · ");
      const blob = await stampImage(file, stampText);
      const fd   = new FormData();
      fd.append("photo", blob, file.name);
      fd.append("stamp_text", stampText);
      const res = await fetch(API + `/api/work-logs/${workId}/photos`, {
        method: "POST",
        headers: { "Authorization": "Bearer " + state.token },
        body: fd
      });
      if (!res.ok) throw new Error("Upload амжилтгүй");
      done++;
    } catch(e) { toast("Алдаа: " + e.message); }
  }
  if (btn) btn.disabled = false;
  if (status) status.textContent = "";
  document.getElementById("quickPhotoModal").style.display = "none";
  toast(`✅ ${done} зураг хадгалагдлаа`);
}

// ── Cascading location selector ───────────────────────────────
function setWorkSubCat(sub) {
  window._workSubCat = sub;
  window._workBagFilter = null;
  ["sl","ger","cam","other"].forEach(k => {
    const btn = document.getElementById(`wSubBtn_${k}`);
    if (btn) btn.className = `btn ${k === sub ? "" : "secondary"} sm`;
  });
  const bagRow = document.getElementById("wBagRow");
  if (bagRow) bagRow.style.display = (sub === "ger" || sub === "cam") ? "block" : "none";
  if (sub === "ger" || sub === "cam") _renderWorkBagBtns(sub);
  _renderWorkLocDropdown(sub, null);
  const fi = document.getElementById("wFaultInfo");
  if (fi) fi.style.display = "none";
}

function setWorkBag(bagNo, sub) {
  window._workBagFilter = bagNo;
  _renderWorkBagBtns(sub);
  _renderWorkLocDropdown(sub, bagNo);
}

function _renderWorkBagBtns(sub) {
  const cat = sub === "ger" ? "Гэр хороолол" : "Цамхаг";
  const locs = (window._gerLocations || []).filter(g => g.category === cat);
  const bags = [...new Set(locs.map(g => g.bag_no).filter(Boolean))].sort((a, b) => a - b);
  const container = document.getElementById("wBagBtns");
  if (!container) return;
  const cur = window._workBagFilter;
  container.innerHTML = [
    `<button type="button" class="btn ${cur === null ? "" : "secondary"} sm" onclick="setWorkBag(null,'${sub}')">Бүх баг</button>`,
    ...bags.map(b => `<button type="button" class="btn ${cur === b ? "" : "secondary"} sm" onclick="setWorkBag(${b},'${sub}')">${b}-р баг</button>`)
  ].join("");
}

function _renderWorkLocDropdown(sub, bagFilter) {
  const locRow = document.getElementById("wLocRow");
  const sel    = document.getElementById("wgerLoc");
  if (!locRow || !sel) return;
  if (!sub || sub === "other") {
    locRow.style.display = "none";
    sel.innerHTML = `<option value="">— Холбохгүй —</option>`;
    return;
  }
  locRow.style.display = "block";
  let opts = `<option value="">— Байршил сонгох —</option>`;
  if (sub === "sl") {
    (window._slPoints || []).forEach(p => {
      opts += `<option value="sl:${p.id}">${escapeHtml(p.name || p.code || "")} (${p.lamp_count||0} шон · ${p.total_heads||0} толгой)</option>`;
    });
  } else {
    const cat = sub === "ger" ? "Гэр хороолол" : "Цамхаг";
    let locs = (window._gerLocations || []).filter(g => g.category === cat);
    if (bagFilter !== null && bagFilter !== undefined) locs = locs.filter(g => g.bag_no === bagFilter);
    locs.forEach(g => {
      const bag = g.bag_no ? `${g.bag_no}-р баг · ` : "";
      opts += `<option value="ger:${g.id}">${bag}${escapeHtml(g.location_name)} (${g.total_count||0} ш)</option>`;
    });
  }
  sel.innerHTML = opts;
  const locEl = document.getElementById("wloc");
  if (locEl) locEl.value = "";
}

async function onWorkLocSelect() {
  const sel      = document.getElementById("wgerLoc");
  const faultDiv = document.getElementById("wFaultInfo");
  if (!sel || !faultDiv) return;
  const val = sel.value;
  if (!val) { faultDiv.style.display = "none"; return; }
  const [locType, locIdStr] = val.split(":");
  const locId = parseInt(locIdStr);
  const titleEl = document.getElementById("wtitle");
  const locEl   = document.getElementById("wloc");
  let fCat = "";
  if (locType === "sl") {
    const pt = (window._slPoints || []).find(p => p.id === locId);
    if (pt) {
      if (locEl) locEl.value = pt.name || pt.code || "";
      if (titleEl && !titleEl.value) titleEl.value = `Гэмтэл засвар — ${pt.name || pt.code || ""}`;
    }
    fCat = "Авто замын гэрэл";
  } else {
    const g = (window._gerLocations || []).find(g => g.id === locId);
    if (g) {
      if (locEl) locEl.value = g.location_name || "";
      if (titleEl && !titleEl.value) titleEl.value = `Гэмтэл засвар — ${g.location_name || ""}`;
    }
    fCat = window._workSubCat === "ger" ? "Гэр хорооллын гэрэл" : "Цамхагийн гэрэл";
  }
  try {
    const faults = await api(`/api/sl-faults?location_id=${locId}&category=${encodeURIComponent(fCat)}`);
    const open   = faults.filter(f => f.status !== "Дууссан");
    if (open.length) {
      const broken = open.reduce((s, f) => s + (f.broken_count || 0), 0);
      faultDiv.style.display = "block";
      faultDiv.innerHTML = `⚠️ <b>${broken} толгой эвдэрсэн</b> бүртгэлтэй — ${open[0].report_date || ""} · Засварын ажил дотор автоматаар холбогдоно`;
    } else {
      faultDiv.style.display = "block";
      faultDiv.style.background = "#f0fdf4";
      faultDiv.style.borderColor = "#86efac";
      faultDiv.style.color = "#15803d";
      faultDiv.innerHTML = `✅ Энэ байршилд нээлттэй гэмтэл бүртгэлгүй байна`;
    }
  } catch(e) { faultDiv.style.display = "none"; }
}

function onWorkAssetSelect() {
  const id = Number(document.getElementById("wasset")?.value || 0);
  const asset = (workAssets || []).find(a => Number(a.id) === id);
  if (!asset) return;
  const locEl = document.getElementById("wloc");
  const titleEl = document.getElementById("wtitle");
  if (locEl) locEl.value = asset.location || asset.name || "";
  if (titleEl && !titleEl.value) titleEl.value = asset.name || asset.asset_code || "";
}

// ── Submit-done modal ─────────────────────────────────────────
function openSubmitDoneModal(id) {
  let m = document.getElementById("submitDoneModal");
  if (!m) { m = document.createElement("div"); m.id = "submitDoneModal"; document.body.appendChild(m); }
  m.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:3000;display:flex;align-items:flex-start;justify-content:center;padding-top:80px";
  window._sdmId = id;
  m.innerHTML = `
    <div style="background:#fff;border-radius:16px;width:min(460px,94vw);box-shadow:0 20px 60px rgba(0,0,0,.25);overflow:hidden">
      <div style="background:linear-gradient(135deg,#d97706,#f59e0b);padding:16px 20px;display:flex;align-items:center;justify-content:space-between">
        <div style="color:#fff;font-size:14px;font-weight:800">📬 Дуусгаж илгээх</div>
        <button onclick="document.getElementById('submitDoneModal').style.display='none'"
          style="border:none;background:rgba(255,255,255,.2);color:#fff;border-radius:8px;padding:5px 12px;cursor:pointer">✕</button>
      </div>
      <div style="padding:20px">
        <div style="font-size:13px;color:#475569;margin-bottom:14px">Ажил дуусч, ерөнхий инженерт батлуулахаар илгээх гэж байна. Дуусгалтын тайлбар оруулна уу.</div>
        <textarea id="sdm_note" class="input" rows="3" placeholder="Дуусгалтын тайлбар, хийсэн ажлын мэдээлэл..." style="resize:vertical;margin-bottom:14px"></textarea>
        <div style="display:flex;gap:10px">
          <button id="sdm_btn" onclick="doSubmitDone()" style="flex:1;background:#f59e0b;color:#fff;border:none;border-radius:8px;padding:10px;font-size:14px;font-weight:700;cursor:pointer">
            📬 Илгээх
          </button>
          <button onclick="document.getElementById('submitDoneModal').style.display='none'"
            style="padding:10px 20px;border:1px solid #e2e6ed;border-radius:8px;background:#fff;cursor:pointer">Цуцлах</button>
        </div>
      </div>
    </div>`;
  m.addEventListener("click", e => { if (e.target===m) m.style.display="none"; }, { once:false });
}
async function doSubmitDone() {
  const id   = window._sdmId;
  const note = document.getElementById("sdm_note")?.value?.trim() || "";
  const btn  = document.getElementById("sdm_btn");
  if (btn) btn.disabled = true;
  try {
    await api(`/api/work-logs/${id}/submit-done`, { method:"POST", body:JSON.stringify({ note }) });
    document.getElementById("submitDoneModal").style.display = "none";
    toast("📬 Ерөнхий инженерт илгээгдлээ ✓");
    work();
  } catch(e) { toast("Алдаа: " + e.message); }
  finally { if (btn) btn.disabled = false; }
}

// ── ХАБЭА pre sign-off modal ──────────────────────────────────
function openHabeaPreModal(id) {
  let m = document.getElementById("habeaPreModal");
  if (!m) { m = document.createElement("div"); m.id = "habeaPreModal"; document.body.appendChild(m); }
  m.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:3000;display:flex;align-items:flex-start;justify-content:center;padding-top:80px";
  window._hpmId = id;
  m.innerHTML = `
    <div style="background:#fff;border-radius:16px;width:min(520px,94vw);box-shadow:0 20px 60px rgba(0,0,0,.25);overflow:hidden">
      <div style="background:linear-gradient(135deg,#0369a1,#0ea5e9);padding:16px 20px;display:flex;align-items:center;justify-content:space-between">
        <div style="color:#fff;font-size:14px;font-weight:800">🦺 ХАБЭА — Ажлын эхлэлт зөвшөөрөх</div>
        <button onclick="document.getElementById('habeaPreModal').style.display='none'"
          style="border:none;background:rgba(255,255,255,.2);color:#fff;border-radius:8px;padding:5px 12px;cursor:pointer">✕</button>
      </div>
      <div style="padding:20px;display:flex;flex-direction:column;gap:12px">
        <div>
          <div style="font-size:11px;font-weight:700;color:#344054;margin-bottom:4px">⚠️ Тодорхойлсон эрсдэлүүд</div>
          <textarea id="hpm_risks" class="input" rows="2" placeholder="Цахилгааны эрсдэл, өндрөөс унах эрсдэл..." style="resize:vertical"></textarea>
        </div>
        <div>
          <div style="font-size:11px;font-weight:700;color:#344054;margin-bottom:4px">🛡️ Авах хамгаалах арга хэмжээ</div>
          <textarea id="hpm_measures" class="input" rows="2" placeholder="Хувийн хамгаалах хэрэгсэл, ажлын талбайн хаалт..." style="resize:vertical"></textarea>
        </div>
        <div>
          <div style="font-size:11px;font-weight:700;color:#344054;margin-bottom:4px">📝 Зааварчилгааны тэмдэглэл</div>
          <textarea id="hpm_note" class="input" rows="2" placeholder="Ажилчдад өгсөн зааварчилгаа, анхааруулга..." style="resize:vertical"></textarea>
        </div>
        <div style="display:flex;gap:10px">
          <button id="hpm_btn" onclick="doHabeaPre()" style="flex:1;background:#0369a1;color:#fff;border:none;border-radius:8px;padding:10px;font-size:14px;font-weight:700;cursor:pointer">
            🦺 Зөвшөөрч гарын үсэг зурах
          </button>
          <button onclick="document.getElementById('habeaPreModal').style.display='none'"
            style="padding:10px 20px;border:1px solid #e2e6ed;border-radius:8px;background:#fff;cursor:pointer">Цуцлах</button>
        </div>
      </div>
    </div>`;
  m.addEventListener("click", e => { if (e.target===m) m.style.display="none"; }, { once:false });
}
async function doHabeaPre() {
  const id       = window._hpmId;
  const risks    = document.getElementById("hpm_risks")?.value?.trim() || "";
  const measures = document.getElementById("hpm_measures")?.value?.trim() || "";
  const note     = document.getElementById("hpm_note")?.value?.trim() || "";
  const btn      = document.getElementById("hpm_btn");
  if (btn) btn.disabled = true;
  try {
    await api(`/api/work-logs/${id}/habea-pre`, { method:"POST", body:JSON.stringify({ risks, measures, note }) });
    document.getElementById("habeaPreModal").style.display = "none";
    toast("🦺 Эхлэлтийн зөвшөөрөл бүртгэгдлээ ✓");
    work();
  } catch(e) { toast("Алдаа: " + e.message); }
  finally { if (btn) btn.disabled = false; }
}

// ── ХАБЭА post-work approval modal ───────────────────────────
function openHabeaPostModal(id) {
  let m = document.getElementById("habeaPostModal");
  if (!m) { m = document.createElement("div"); m.id = "habeaPostModal"; document.body.appendChild(m); }
  m.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:3000;display:flex;align-items:flex-start;justify-content:center;padding-top:80px";
  window._hpostId = id;
  m.innerHTML = `
    <div style="background:#fff;border-radius:16px;width:min(500px,94vw);box-shadow:0 20px 60px rgba(0,0,0,.25);overflow:hidden">
      <div style="background:linear-gradient(135deg,#6d28d9,#7c3aed);padding:16px 20px;display:flex;align-items:center;justify-content:space-between">
        <div style="color:#fff;font-size:14px;font-weight:800">🦺 ХАБЭА — Ажлын талбай шалгах</div>
        <button onclick="document.getElementById('habeaPostModal').style.display='none'"
          style="border:none;background:rgba(255,255,255,.2);color:#fff;border-radius:8px;padding:5px 12px;cursor:pointer">✕</button>
      </div>
      <div style="padding:20px">
        <div style="margin-bottom:14px;padding:12px;background:#faf5ff;border:1px solid #e9d5ff;border-radius:8px;font-size:12px;color:#581c87">
          <b>Шалгах зүйлс:</b> Ил утас/кабель үлдсэн үү? · Нүх, унасан зүйл байна уу? · Замын саад арилсан уу? · Ажилчид осол гэмтэлгүй дуусгасан уу?
        </div>
        <label style="font-size:11px;color:#6d28d9;font-weight:700;display:block;margin-bottom:4px">Шалгалтын дүгнэлт <span style="color:#dc2626">*</span></label>
        <textarea id="hpost_note" class="input" rows="3" placeholder="Шалгалтын дүн, ажлын талбайн байдал, ажилчдын аюулгүй байдал — заавал бичнэ үү..." style="resize:vertical;margin-bottom:4px;border-color:#c4b5fd"></textarea>
        <div style="font-size:10px;color:#6b7280;margin-bottom:12px">⚠️ Энэ тэмдэглэл хуулийн баримт болно — тодорхой бичнэ үү</div>
        <div style="display:flex;gap:10px">
          <button id="hpost_btn" onclick="doHabeaPost()" style="flex:1;background:#7c3aed;color:#fff;border:none;border-radius:8px;padding:10px;font-size:14px;font-weight:700;cursor:pointer">
            🦺 Аюулгүй — Ажил хаах
          </button>
          <button onclick="document.getElementById('habeaPostModal').style.display='none'"
            style="padding:10px 20px;border:1px solid #e2e6ed;border-radius:8px;background:#fff;cursor:pointer">Цуцлах</button>
        </div>
      </div>
    </div>`;
  m.addEventListener("click", e => { if (e.target===m) m.style.display="none"; }, { once:false });
}
async function doHabeaPost() {
  const id   = window._hpostId;
  const note = document.getElementById("hpost_note")?.value?.trim() || "";
  if (!note) { toast("Шалгалтын дүгнэлт заавал бичих шаардлагатай"); return; }
  const btn  = document.getElementById("hpost_btn");
  if (btn) btn.disabled = true;
  try {
    await api(`/api/work-logs/${id}/habea-post`, { method:"POST", body:JSON.stringify({ note }) });
    document.getElementById("habeaPostModal").style.display = "none";
    toast("🦺 ХАБЭА батлагдсан — Ажил хаагдлаа ✓");
    work();
    printApprovalSheet(id);
  } catch(e) { toast("Алдаа: " + e.message); }
  finally { if (btn) btn.disabled = false; }
}
async function habeaPostReject(id) {
  const note = prompt("ХАБЭА буцаах шалтгаан (ямар асуудал байгаа):");
  if (note === null) return;
  try {
    await api(`/api/work-logs/${id}/habea-post-reject`, {
      method: "POST",
      body: JSON.stringify({ note: note || "ХАБЭА шалгалтад тэнцсэнгүй" })
    });
    toast("↩ ХАБЭА буцаасан — Ажил засварлах шаардлагатай.");
    work();
  } catch(e) { toast("Алдаа: " + e.message); }
}

// ── Approval sheet print ──────────────────────────────────────
async function printApprovalSheet(id) {
  let w;
  try { w = await api(`/api/work-logs/${id}/approval-sheet`); } catch(e) { toast("Акт татахад алдаа гарлаа"); return; }

  const fmt = s => s ? s.replace("T"," ").slice(0,16) : "—";
  const esc = s => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

  const html = `<!DOCTYPE html><html lang="mn"><head><meta charset="utf-8">
  <title>Ажлын зөвшөөрлийн акт — ${esc(w.title)}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:"Times New Roman",serif;font-size:13px;color:#000;background:#fff;padding:30px 40px}
    h1{font-size:17px;text-align:center;margin-bottom:4px;font-weight:bold}
    .sub{text-align:center;font-size:12px;color:#333;margin-bottom:18px}
    table{width:100%;border-collapse:collapse;margin-bottom:16px}
    td,th{border:1px solid #666;padding:5px 8px;vertical-align:top;font-size:12px}
    th{background:#f0f0f0;font-weight:bold;width:38%}
    .section{font-size:13px;font-weight:bold;margin:14px 0 6px;border-bottom:1px solid #999;padding-bottom:3px}
    .sign-row{display:flex;gap:40px;margin-top:30px}
    .sign-box{flex:1;border-top:1px solid #000;padding-top:6px;font-size:11px;text-align:center}
    .stamp{width:80px;height:80px;border:1px dashed #aaa;display:inline-block;margin-top:8px;line-height:78px;text-align:center;color:#bbb;font-size:10px}
    .watermark{position:fixed;top:40%;left:50%;transform:translate(-50%,-50%) rotate(-30deg);font-size:80px;color:rgba(0,100,0,.06);font-weight:900;pointer-events:none;white-space:nowrap}
    @media print{.no-print{display:none}body{padding:15px 20px}}
  </style></head><body>
  <div class="watermark">ЧОЙБАЛСАН ХӨГЖИЛ</div>

  <div class="no-print" style="margin-bottom:16px;display:flex;gap:10px">
    <button onclick="window.print()" style="padding:8px 20px;background:#1e40af;color:#fff;border:none;border-radius:6px;font-size:13px;cursor:pointer;font-weight:700">🖨 Хэвлэх</button>
    <button onclick="window.close()" style="padding:8px 16px;background:#6b7280;color:#fff;border:none;border-radius:6px;font-size:13px;cursor:pointer">✕ Хаах</button>
  </div>

  <h1>АЖЛЫН ЗӨВШӨӨРЛИЙН АКТ</h1>
  <div class="sub">Чойбалсан Хөгжил ОНӨҮГ · Smart City ERP · №${esc(w.id)}</div>

  <div class="section">1. АЖЛЫН МЭДЭЭЛЭЛ</div>
  <table>
    <tr><th>Ажлын нэр</th><td><b>${esc(w.title)}</b></td></tr>
    <tr><th>Байршил / Объект</th><td>${esc(w.location||w.address||"—")}</td></tr>
    <tr><th>Эхлэх огноо</th><td>${esc(w.start_date||"—")}</td></tr>
    <tr><th>Дуусах огноо</th><td>${esc(w.end_date||"—")}</td></tr>
    <tr><th>Гүйцэтгэгч</th><td>${esc(w.assigned_name||"—")}</td></tr>
    <tr><th>Бүртгэсэн</th><td>${esc(w.created_name||"—")} · ${fmt(w.created_at)}</td></tr>
    <tr><th>Эцсийн статус</th><td><b>${esc(w.status||"—")}</b></td></tr>
  </table>

  <div class="section">2. ЕРӨНХИЙ ИНЖЕНЕРИЙН БАТЛАЛ</div>
  <table>
    <tr><th>Баталсан ажилтан</th><td><b>${esc(w.confirmed_name||"—")}</b></td></tr>
    <tr><th>Баталсан огноо</th><td>${fmt(w.confirmed_at)}</td></tr>
    <tr><th>Баталгааны тэмдэглэл</th><td><b>${esc(w.confirm_note||"—")}</b></td></tr>
  </table>

  <div class="section">3. ХАБЭА ЭХЛЭЛТИЙН ЗӨВШӨӨРӨЛ</div>
  <table>
    <tr><th>Зөвшөөрсөн ажилтан</th><td>${esc(w.habea_pre_name||"—")}</td></tr>
    <tr><th>Зөвшөөрсөн огноо</th><td>${fmt(w.habea_pre_at)}</td></tr>
    <tr><th>Эрсдэлийн мэдээлэл</th><td>${esc(w.habea_pre_risks||"—")}</td></tr>
    <tr><th>Хамгаалах арга хэмжээ</th><td>${esc(w.habea_pre_measures||"—")}</td></tr>
    <tr><th>Тэмдэглэл</th><td>${esc(w.habea_pre_note||"—")}</td></tr>
  </table>

  <div class="section">4. ХАБЭА ДУУСГАЛТЫН БАТЛАЛ</div>
  <table>
    <tr><th>Баталсан ажилтан</th><td><b>${esc(w.habea_post_name||"—")}</b></td></tr>
    <tr><th>Баталсан огноо</th><td>${fmt(w.habea_post_at)}</td></tr>
    <tr><th>Шалгалтын дүгнэлт</th><td><b>${esc(w.habea_post_note||"—")}</b></td></tr>
  </table>

  <div class="sign-row">
    <div class="sign-box">
      Ерөнхий инженер<br><br>
      <div style="height:40px"></div>
      ___________________________<br>
      ${esc(w.confirmed_name||"")}<br>
      <span style="font-size:10px">${fmt(w.confirmed_at)}</span>
      <div><div class="stamp">Тамга</div></div>
    </div>
    <div class="sign-box">
      ХАБЭА мэргэжилтэн<br><br>
      <div style="height:40px"></div>
      ___________________________<br>
      ${esc(w.habea_post_name||"")}<br>
      <span style="font-size:10px">${fmt(w.habea_post_at)}</span>
      <div><div class="stamp">Тамга</div></div>
    </div>
  </div>

  <div style="margin-top:24px;font-size:10px;color:#666;text-align:center;border-top:1px solid #ddd;padding-top:8px">
    Энэхүү акт нь Чойбалсан Хөгжил ОНӨҮГ-ийн Smart City ERP системээс автоматаар үүсгэгдсэн.<br>
    Баримт бичгийн дугаар: WO-${esc(w.id)} · Хэвлэсэн: ${new Date().toLocaleString("mn-MN")}
  </div>
  </body></html>`;

  const win = window.open("", "_blank", "width=800,height=900");
  if (!win) { toast("Popup хаалттай байна — хөтчийн тохиргоог шалгана уу"); return; }
  win.document.write(html);
  win.document.close();
}

Object.assign(window, {
  work, slHubWork, toggleWorkForm, resetWorkForm, editWorkById,
  toggleWassDropdown, updateWassLabel, filterWassList,
  saveWork, confirmDeleteWork,
  confirmWorkDone, rejectWorkDone, submitConfirmWork,
  openSubmitDoneModal, doSubmitDone,
  openHabeaPreModal, doHabeaPre,
  openHabeaPostModal, doHabeaPost, habeaPostReject,
  openExecModal, closeExecModal, saveExec, deleteExec, openEditExecModal, updateExec,
  filterExecWorkers, updateExecWorkers, eeFilterWorkers, eeUpdateWorkers, previewExecPhotos,
  loadExecPhotos, deleteExecPhoto, uploadExecPhoto,
  openExecDetail, scrollGanttToMonth,
  photoBox, uploadPhoto,
  setWorkSubCat, setWorkBag, onWorkLocSelect, onWorkAssetSelect,
  openQuickPhotoModal, qpPreviewFiles, submitQuickPhotos,
  openProgressModal, submitProgress,
  showMoveMenu, moveWorkToCat,
  printApprovalSheet,
});
