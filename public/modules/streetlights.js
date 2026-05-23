import { state, api, toast } from './common.js';

const canEdit       = () => ["director","accountant"].includes(state.me?.role);
const canEditPoints = () => ["director","chief_engineer","engineer","accountant"].includes(state.me?.role);
const fmt     = n => Number(n || 0).toLocaleString("mn-MN");
const fmtM    = n => (Number(n || 0) / 1_000_000).toFixed(2) + " сая";
const post    = (path, body) => api(path, { method: "POST", body: JSON.stringify(body) });
const put_    = (path, body) => api(path, { method: "PUT",  body: JSON.stringify(body) });
const del_    = path          => api(path, { method: "DELETE" });

function ownerBadge(o) {
  const cfg = {
    OURS:        { bg:"#dcfce7", color:"#16a34a", label:"Манайх" },
    OTHER:       { bg:"#f1f5f9", color:"#475569", label:"Бусад" },
    SHARED:      { bg:"#e0f2fe", color:"#0369a1", label:"Хамтарсан" },
    TRANSFERRED: { bg:"#fef9c3", color:"#a16207", label:"Шилжүүлсэн" },
  };
  const c = cfg[o] || { bg:"#f1f5f9", color:"#64748b", label: o||"—" };
  return `<span style="font-size:10px;padding:2px 8px;border-radius:20px;background:${c.bg};color:${c.color};font-weight:600">${c.label}</span>`;
}
function sevBadge(s) {
  const cfg = {
    ERROR:   { bg:"#fee2e2", color:"#dc2626" },
    WARNING: { bg:"#fef9c3", color:"#a16207" },
    INFO:    { bg:"#f1f5f9", color:"#64748b" },
  };
  const c = cfg[s] || { bg:"#f1f5f9", color:"#64748b" };
  return `<span style="font-size:10px;padding:2px 8px;border-radius:20px;background:${c.bg};color:${c.color};font-weight:600">${s}</span>`;
}
function statusBadge(s) {
  const cfg = {
    confirmed: { bg:"#dcfce7", color:"#16a34a", label:"Баталгаажсан" },
    pending:   { bg:"#fef9c3", color:"#a16207", label:"Хүлээгдэж буй" },
    rejected:  { bg:"#fee2e2", color:"#dc2626", label:"Татгалзсан" },
  };
  const c = cfg[s] || { bg:"#f1f5f9", color:"#64748b", label: s||"—" };
  return `<span style="font-size:10px;padding:2px 8px;border-radius:20px;background:${c.bg};color:${c.color};font-weight:600">${c.label}</span>`;
}

// ── Гэрэлтүүлгийн нэгдсэн төв (Tabbed Hub) ──────────────────────
let _slHubData = null;

async function sl_dashboard() {
  main.innerHTML = `<div style="padding:40px;text-align:center;color:#64748b">Ачааллаж байна...</div>`;

  let workLogs=[], faults=[], schedules=[], assetSummary=[], gerInv=[], slPoints=[], gerStats={}, safetyRisks=[];
  try {
    [workLogs, faults, schedules, assetSummary, gerInv, slPoints, gerStats, safetyRisks] = await Promise.all([
      api("/api/work-logs"),
      api("/api/sl-faults"),
      api("/api/light-schedules"),
      api("/api/assets/summary/by-category"),
      api("/api/sl-ger-inventory").catch(()=>[]),
      api("/api/mp").catch(()=>[]),
      api("/api/sl-ger-stats").catch(()=>({})),
      api("/api/safety-reports").catch(()=>[]),
    ]);
  } catch(e) { main.innerHTML = `<div class="alert alert-danger">${e.message}</div>`; return; }

  const slWork    = workLogs.filter(w =>
    w.sl_point_id ||
    (w.category||"").includes("Гэрэлтүүлэг") ||
    (w.department||"").includes("Гэрэлтүүлэг") ||
    (w.category||"").includes("Цахилгаан") ||
    (w.department||"").includes("Цахилгаан")
  );
  const openWork   = slWork.filter(w => w.status !== "Дууссан");
  const doneWork   = slWork.filter(w => w.status === "Дууссан");
  const openFaults = faults.filter(f => (f.status||"Нээлттэй") !== "Дууссан");
  const today      = new Date().toISOString().slice(0,10);
  const todaySched = schedules.filter(s=>(s.adjusted_date||s.valid_from)<=today).sort((a,b)=>b.valid_from.localeCompare(a.valid_from)||b.id-a.id)[0];
  const gerCount   = {
    "Гэр хорооллын гэрэл": gerStats.ger_locations || gerInv.filter(r=>r.category==="Гэр хороолол").length,
    "Цамхагийн гэрэл":     gerStats.camhag_locations || gerInv.filter(r=>r.category==="Цамхаг").length,
  };
  const roadCount  = gerStats.sl_streets || 0;
  const SL_ASSET_CATS = [
    { name:"Авто замын гэрэл",    icon:"💡", color:"#f59e0b", bg:"#fffbeb", fn:"sl_asset_road",   count: roadCount },
    { name:"Гэр хорооллын гэрэл", icon:"🏘️", color:"#0ea5e9", bg:"#f0f9ff", fn:"sl_asset_ger",    count: gerCount["Гэр хорооллын гэрэл"] || 0 },
    { name:"Цамхагийн гэрэл",     icon:"🗼", color:"#8b5cf6", bg:"#f5f3ff", fn:"sl_asset_tower",  count: gerCount["Цамхагийн гэрэл"] || 0 },
    { name:"Гэрлэн дохио",        icon:"🚦", color:"#10b981", bg:"#ecfdf5", fn:"sl_asset_signal", count: (assetSummary.find(x=>x.category==="Гэрлэн дохио")||{}).total || 0 },
    { name:"Шит/Самбар",          icon:"⚡", color:"#ef4444", bg:"#fef2f2", fn:"sl_asset_panel",  count: (assetSummary.find(x=>x.category==="Шит/Самбар")||{}).total  || 0 },
  ];

  // Open risks relevant to the electric engineer: linked to sl_ger_inventory, or electrical type, or all new
  const slRisks = safetyRisks.filter(r =>
    (r.workflow_status || 'Шинэ') !== 'Хаасан' && (
      r.location_ref_type === 'sl_ger_inventory' ||
      (r.risk_type || '').includes('Цахилгаан') ||
      (r.workflow_status || 'Шинэ') === 'Шинэ'
    )
  );

  _slHubData = { slWork, openWork, doneWork, openFaults, todaySched, slPoints, gerInv, gerCount, SL_ASSET_CATS, faults, schedules, slRisks };

  const isFinance = ["director","accountant"].includes(state.me?.role);
  const tab = window._slHubTab || "home";
  const TABS = [
    { key:"home",     icon:"🏠", label:"Нүүр" },
    { key:"assets",   icon:"📦", label:"Объектийн бүртгэл" },
    { key:"work",     icon:"📅", label:"Ажлын явц" },
    { key:"faults",   icon:"⚡", label:"Гэмтэл" },
    { key:"points",   icon:"📍", label:"Тоолуур" },
    { key:"sched",    icon:"🌙", label:"Цаг тохиргоо" },
    { key:"readings", icon:"📊", label:"Уншилт" },
    { key:"analytics", icon:"📈", label:"Судалгаа" },
    { key:"lora",     icon:"📡", label:"LoRa" },
    ...(isFinance ? [{ key:"finance", icon:"💰", label:"Цахилгааны төлбөр" }] : []),
  ];

  const totalObjects = SL_ASSET_CATS
    .filter(c => c.name !== "Шит/Самбар")
    .reduce((s,c)=>s+c.count, 0);

  main.innerHTML = `
  <div style="margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
    <div>
      <h1 style="margin:0 0 3px;font-size:20px;font-weight:800;letter-spacing:-.02em">💡 Гэрэлтүүлгийн төв</h1>
      <div style="font-size:12px;color:#667085">Бүх хэсгийн нэгдсэн хяналтын самбар</div>
    </div>
  </div>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;margin-bottom:16px">
    ${[
      { icon:"📦", val:totalObjects,          label:"Нийт объект",     bg:"#f8fafc", color:"#475569" },
      { icon:"⚡", val:openWork.length,        label:"Нээлттэй ажил",   bg:openWork.length?"#fff7ed":"#f0fdf4",   color:openWork.length?"#c2410c":"#15803d" },
      { icon:"✅", val:doneWork.length,        label:"Дууссан ажил",    bg:"#f0fdf4", color:"#15803d" },
      { icon:"🔧", val:openFaults.length,      label:"Нээлттэй гэмтэл", bg:openFaults.length?"#fee2e2":"#f0fdf4", color:openFaults.length?"#dc2626":"#15803d" },
      { icon:"📍", val:slPoints.length,        label:"Тоолуурын цэг",   bg:"#eff6ff", color:"#2563eb" },
      { icon:"🌙", val:todaySched?.on_time||"—", label:"Асах цаг",      bg:"#fefce8", color:"#ca8a04" },
    ].map(c=>`<div style="background:${c.bg};border-radius:12px;padding:14px 16px">
      <div style="font-size:22px;font-weight:800;color:${c.color};line-height:1.1">${c.val}</div>
      <div style="font-size:16px;margin:2px 0">${c.icon}</div>
      <div style="font-size:11px;color:#64748b;font-weight:600">${c.label}</div>
    </div>`).join("")}
  </div>
  <div style="display:flex;border-bottom:1px solid #e2e6ed;overflow-x:auto;margin-bottom:0" id="slTabBar">
    ${TABS.map(t => `<button onclick="slHubTab('${t.key}')" data-tab="${t.key}" style="
      display:flex;align-items:center;gap:6px;padding:7px 16px;border:none;cursor:pointer;
      font-size:13px;font-weight:600;border-bottom:2px solid ${tab===t.key?'#2563eb':'transparent'};
      background:none;color:${tab===t.key?'#2563eb':'#64748b'};transition:all .15s;white-space:nowrap">
      ${t.icon} ${t.label}
    </button>`).join("")}
  </div>
  <div id="slHubContent" style="padding-top:16px"></div>`;

  slHubTab(tab);
}

async function slHubTab(tab) {
  window._slHubTab = tab;
  if (tab !== "points") window._pointsEmbedTarget = "";
  if (tab !== "sched") window._lightingScheduleEmbedTarget = "";
  if (tab !== "work") window._workEmbedTarget = "";
  const d = _slHubData;
  if (!d) { sl_dashboard(); return; }

  const bar = document.getElementById("slTabBar");
  if (bar) {
    bar.querySelectorAll("button[data-tab]").forEach(btn => {
      const active = btn.dataset.tab === tab;
      btn.style.color = active ? "#2563eb" : "#64748b";
      btn.style.borderBottomColor = active ? "#2563eb" : "transparent";
    });
  }

  const el = document.getElementById("slHubContent");
  if (!el) return;

  if      (tab === "home")     el.innerHTML = _slTabHome(d);
  else if (tab === "assets")   return slHubAsset("Авто замын гэрэл");
  else if (tab === "work")     return slHubWork();
  else if (tab === "faults")   el.innerHTML = _slTabFaults(d);
  else if (tab === "points")   await _slTabPoints(el);
  else if (tab === "sched")    return slHubLightSched();
  else if (tab === "readings") await _slTabReadings(el);
  else if (tab === "analytics") await _slTabAnalytics(el);
  else if (tab === "lora")     _slTabLora(el);
  else if (tab === "finance")  await _slTabFinance(el);
}

function _slTabHome(d) {
  const { openWork, openFaults, todaySched, slPoints, gerInv, gerCount, slRisks = [] } = d;
  function wfBadge(s) {
    const cfg = { "Явцтай":"#2563eb","Дууссан":"#16a34a","Хойшлогдсон":"#dc2626","Төлөвлөсөн":"#64748b" };
    const col = cfg[s]||"#64748b";
    return `<span style="font-size:10px;padding:2px 8px;border-radius:20px;background:${col}18;color:${col};font-weight:700">${s||"—"}</span>`;
  }
  const workRows = openWork.slice(0,5).map((w,i) => `
    <tr style="background:${i%2?"#fafafa":"#fff"}">
      <td style="font-weight:600;font-size:12px">${w.title||"—"}</td>
      <td style="font-size:11px;color:#64748b">${w.location||"—"}</td>
      <td>${wfBadge(w.status)}</td>
      <td style="font-size:11px;color:#64748b">${w.assigned_name||"—"}</td>
    </tr>`).join("") || `<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:20px">Нээлттэй ажил байхгүй</td></tr>`;
  const faultRows = openFaults.slice(0,4).map((f,i) => {
    const c = f.category==="Авто замын гэрэл"?"#f59e0b":f.category==="Гэр хорооллын гэрэл"?"#0ea5e9":"#ef4444";
    return `<tr style="background:${i%2?"#fafafa":"#fff"}">
      <td><span style="font-size:10px;padding:2px 7px;border-radius:20px;background:${c}18;color:${c};font-weight:700">${f.category||"—"}</span></td>
      <td style="font-size:12px;font-weight:600">${f.location_name||"—"}</td>
      <td style="text-align:center;font-size:12px;color:#dc2626;font-weight:700">${f.broken_count||0}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="3" style="text-align:center;color:#94a3b8;padding:20px">Нээлттэй гэмтэл байхгүй</td></tr>`;
  const schedHtml = todaySched
    ? `<div style="display:flex;gap:10px">
        <div style="background:#fef9c3;border-radius:10px;padding:12px;flex:1;text-align:center">
          <div style="font-size:9px;color:#a16207;font-weight:700">АСАХ</div>
          <div style="font-size:22px;font-weight:800;color:#854d0e">${todaySched.on_time||"—"}</div>
        </div>
        <div style="background:#eff6ff;border-radius:10px;padding:12px;flex:1;text-align:center">
          <div style="font-size:9px;color:#1d4ed8;font-weight:700">УНТРАХ</div>
          <div style="font-size:22px;font-weight:800;color:#1e40af">${todaySched.off_time||"—"}</div>
        </div>
      </div>
      <div style="font-size:10px;color:#64748b;margin-top:6px">${todaySched.name||""}</div>`
    : `<div style="color:#94a3b8;font-size:12px">Цагийн хуваарь байхгүй</div>`;
  return `
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
    <div class="panel">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #e2e6ed">
        <div style="font-size:13px;font-weight:700">📅 Нээлттэй ажил</div>
        <button onclick="slHubTab('work')" class="btn secondary" style="font-size:11px;padding:4px 10px">Бүгд →</button>
      </div>
      <div class="table-wrap"><table><thead><tr><th>Ажил</th><th>Байршил</th><th>Явц</th><th>Хариуцагч</th></tr></thead><tbody>${workRows}</tbody></table></div>
    </div>
    <div class="panel">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #e2e6ed">
        <div style="font-size:13px;font-weight:700">⚡ Нээлттэй гэмтэл</div>
        <button onclick="slHubTab('faults')" class="btn secondary" style="font-size:11px;padding:4px 10px">Бүгд →</button>
      </div>
      <div class="table-wrap"><table><thead><tr><th>Төрөл</th><th>Байршил</th><th>Асахгүй</th></tr></thead><tbody>${faultRows}</tbody></table></div>
    </div>
  </div>
  ${slRisks.length ? `
  <div class="panel" style="margin-bottom:14px;padding:0;border-top:3px solid #ea580c">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #f1f5f9">
      <div style="font-size:13px;font-weight:700;color:#c2410c">⚠️ Эрсдэл мэдээлэл — ХАБЭА мэдэгдэл</div>
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:11px;padding:2px 10px;border-radius:20px;background:#fff7ed;color:#c2410c;font-weight:700">${slRisks.length} нээлттэй</span>
        <button onclick="show('safety')" class="btn secondary" style="font-size:11px;padding:4px 10px">Бүгд →</button>
      </div>
    </div>
    <div class="table-wrap">
      <table><thead><tr>
        <th>Түвшин</th><th>Байршил</th><th>Эрсдэлийн төрөл</th><th>Огноо</th><th>Мэдэгдсэн</th><th>Workflow</th>
      </tr></thead><tbody>
        ${slRisks.slice(0,8).map((r,i) => {
          const RCOL = {'Маш өндөр':'#dc2626','Өндөр':'#ea580c','Дунд':'#ca8a04','Бага':'#16a34a'};
          const WFCOL = {'Шинэ':'#2563eb','Танилцсан':'#16a34a','Арга хэмжээ өгсөн':'#ca8a04','Хэрэгжиж байна':'#ea580c','Хаасан':'#374151'};
          const rc = RCOL[r.risk_level]||'#64748b';
          const wc = WFCOL[r.workflow_status||'Шинэ']||'#64748b';
          return `<tr style="background:${i%2?'#fafafa':'#fff'}${(r.workflow_status||'Шинэ')==='Шинэ'?';font-weight:600':''}">
            <td><span style="font-size:10px;padding:2px 9px;border-radius:20px;background:${rc}18;color:${rc};font-weight:800">${r.risk_level||'—'}</span></td>
            <td style="font-size:12px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.location||'—'}</td>
            <td style="font-size:11px;color:#475569">${r.risk_type||'—'}</td>
            <td style="font-size:11px;color:#64748b;white-space:nowrap">${(r.report_date||'').slice(0,10)}</td>
            <td style="font-size:11px;color:#64748b">${r.creator_name||'—'}</td>
            <td><span style="font-size:10px;padding:2px 8px;border-radius:20px;background:${wc}18;color:${wc};font-weight:700">${r.workflow_status||'Шинэ'}</span></td>
          </tr>`;
        }).join('')}
      </tbody></table>
    </div>
  </div>` : ''}

  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">
    <div class="panel" style="padding:14px">
      <div style="font-size:12px;font-weight:700;margin-bottom:10px">🌙 Өнөөдрийн хуваарь</div>
      ${schedHtml}
      <button onclick="slHubTab('sched')" class="btn secondary" style="width:100%;margin-top:10px;font-size:11px;padding:5px">Тохиргоо →</button>
    </div>
    <div class="panel" style="padding:14px;cursor:pointer" onclick="slHubTab('points')">
      <div style="font-size:12px;font-weight:700;margin-bottom:10px">📍 Тоолуурын байршил</div>
      <div style="font-size:30px;font-weight:800;color:#2563eb">${slPoints.length}</div>
      <div style="font-size:11px;color:#64748b;margin-top:4px">Нийт бүртгэлтэй цэг</div>
      <div style="font-size:11px;color:#f59e0b;margin-top:4px">❓ ${slPoints.filter(p=>!p.verified).length} баталгаажаагүй</div>
    </div>
    <div class="panel" style="padding:14px;cursor:pointer" onclick="slHubTab('assets')">
      <div style="font-size:12px;font-weight:700;margin-bottom:10px">🏘️ Гэр/цамхаг</div>
      <div style="font-size:30px;font-weight:800;color:#0ea5e9">${gerInv.length}</div>
      <div style="font-size:11px;color:#64748b;margin-top:4px">🏘️ ${gerCount["Гэр хорооллын гэрэл"]||0} гэр · 🗼 ${gerCount["Цамхагийн гэрэл"]||0} цамхаг</div>
    </div>
  </div>`;
}

function _slTabAssets(d) {
  const { SL_ASSET_CATS } = d;
  return `
  <div style="margin-bottom:14px">
    <div style="font-size:14px;font-weight:700;color:#1e293b;margin-bottom:4px">📦 Объектийн бүртгэл</div>
    <div style="font-size:12px;color:#64748b">Ангилал дарж дэлгэрэнгүй харна уу</div>
  </div>
  <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:14px">
    ${SL_ASSET_CATS.map(c => `
    <div onclick="${c.fn}()" style="background:${c.bg};border-radius:14px;padding:24px 20px;cursor:pointer;
      border:2px solid ${c.color}22;transition:box-shadow .15s;text-align:center"
      onmouseover="this.style.boxShadow='0 4px 20px ${c.color}33'" onmouseout="this.style.boxShadow=''">
      <div style="font-size:30px;margin-bottom:10px">${c.icon}</div>
      <div style="font-size:36px;font-weight:800;color:${c.color};line-height:1">${c.count}</div>
      <div style="font-size:13px;font-weight:700;color:${c.color};margin-top:8px">${c.name}</div>
      <div style="font-size:11px;color:#94a3b8;margin-top:4px">Дарж харах →</div>
    </div>`).join("")}
  </div>`;
}

function _slTabWork(d) {
  const { slWork, openWork, doneWork } = d;
  function wfBadge(s, p) {
    const cfg = { "Явцтай":"#2563eb","Дууссан":"#16a34a","Хойшлогдсон":"#dc2626","Төлөвлөсөн":"#64748b" };
    const col = cfg[s]||"#64748b";
    return `<span style="font-size:10px;padding:2px 8px;border-radius:20px;background:${col}18;color:${col};font-weight:700">${s||"—"}${p!=null?` · ${p}%`:""}</span>`;
  }
  const rows = slWork.map((w,i) => `
    <tr style="background:${i%2?"#fafafa":"#fff"}">
      <td style="font-weight:600;font-size:12px">${w.title||"—"}</td>
      <td style="font-size:11px;color:#64748b">${w.location||"—"}</td>
      <td>${wfBadge(w.status, w.progress)}</td>
      <td style="font-size:11px;color:#64748b">${w.assigned_name||"—"}</td>
      <td style="font-size:11px;color:#64748b">${w.start_date||"—"}</td>
      <td style="font-size:11px;color:#64748b">${w.end_date||"—"}</td>
    </tr>`).join("") || `<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:30px">Ажил бүртгэгдээгүй байна</td></tr>`;
  return `
  <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
    <div style="background:#fff7ed;border-radius:10px;padding:12px 20px;flex:1;text-align:center">
      <div style="font-size:22px;font-weight:800;color:#c2410c">${openWork.length}</div>
      <div style="font-size:11px;color:#64748b">Нээлттэй</div>
    </div>
    <div style="background:#f0fdf4;border-radius:10px;padding:12px 20px;flex:1;text-align:center">
      <div style="font-size:22px;font-weight:800;color:#15803d">${doneWork.length}</div>
      <div style="font-size:11px;color:#64748b">Дууссан</div>
    </div>
    <div style="background:#f8fafc;border-radius:10px;padding:12px 20px;flex:1;text-align:center">
      <div style="font-size:22px;font-weight:800;color:#475569">${slWork.length}</div>
      <div style="font-size:11px;color:#64748b">Нийт</div>
    </div>
  </div>
  <div class="panel">
    <div class="table-wrap">
      <table><thead><tr>
        <th>Ажил</th><th>Байршил</th><th>Явц</th><th>Хариуцагч</th><th>Эхлэх</th><th>Дуусах</th>
      </tr></thead><tbody>${rows}</tbody></table>
    </div>
  </div>`;
}

function _slTabFaults(d) {
  const { faults } = d;
  const catColor = c => c==="Авто замын гэрэл"?"#f59e0b":c==="Гэр хорооллын гэрэл"?"#0ea5e9":c==="Цамхагийн гэрэл"?"#8b5cf6":"#ef4444";
  const scMap = { "Нээлттэй":"#dc2626","Засварт":"#d97706","Дууссан":"#16a34a" };
  const rows = faults.map((f,i) => {
    const col = catColor(f.category); const sc = scMap[f.status]||"#64748b";
    return `<tr style="background:${i%2?"#fafafa":"#fff"}">
      <td><span style="font-size:10px;padding:2px 7px;border-radius:20px;background:${col}18;color:${col};font-weight:700">${f.category||"—"}</span></td>
      <td style="font-size:12px;font-weight:600">${f.location_name||"—"}</td>
      <td style="text-align:center;font-size:12px"><span style="color:#dc2626;font-weight:700">${f.broken_count||0}</span>/${f.total_heads||0}</td>
      <td style="font-size:11px;color:#64748b">${f.report_date||"—"}</td>
      <td><span style="font-size:10px;padding:2px 8px;border-radius:20px;background:${sc}18;color:${sc};font-weight:700">${f.status||"—"}</span></td>
    </tr>`;
  }).join("") || `<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:30px">Гэмтэл байхгүй</td></tr>`;
  const byS = {}; faults.forEach(f => { byS[f.status]=(byS[f.status]||0)+1; });
  return `
  <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
    ${[
      {label:"Нээлттэй",cnt:byS["Нээлттэй"]||0,bg:"#fee2e2",color:"#dc2626"},
      {label:"Засварт", cnt:byS["Засварт"]||0, bg:"#fff7ed",color:"#d97706"},
      {label:"Дууссан", cnt:byS["Дууссан"]||0, bg:"#f0fdf4",color:"#16a34a"},
      {label:"Нийт",    cnt:faults.length,      bg:"#f8fafc",color:"#475569"},
    ].map(s=>`<div style="background:${s.bg};border-radius:10px;padding:12px 20px;flex:1;text-align:center">
      <div style="font-size:22px;font-weight:800;color:${s.color}">${s.cnt}</div>
      <div style="font-size:11px;color:#64748b">${s.label}</div>
    </div>`).join("")}
  </div>
  <div class="panel">
    <div style="padding:10px 16px;border-bottom:1px solid #e2e6ed;display:flex;align-items:center;justify-content:space-between">
      <div style="font-size:13px;font-weight:700">Гэмтлийн бүртгэл</div>
      <button class="btn" style="font-size:11px;padding:4px 10px" onclick="sl_faults()">Дэлгэрэнгүй →</button>
    </div>
    <div class="table-wrap">
      <table><thead><tr><th>Ангилал</th><th>Байршил</th><th>Эвдрэл</th><th>Огноо</th><th>Төлөв</th></tr></thead>
      <tbody>${rows}</tbody></table>
    </div>
  </div>`;
}

async function _slTabAnalytics(el) {
  const year = window._slAnalyticsYear || new Date().getFullYear();
  el.innerHTML = `<div style="padding:30px;text-align:center;color:#64748b">Судалгаа ачааллаж байна...</div>`;
  let data;
  try {
    data = await api(`/api/sl-analytics?year=${year}`);
  } catch(e) {
    el.innerHTML = `<div class="alert alert-danger">${e.message}</div>`;
    return;
  }

  const pct = v => v == null ? "—" : `${Number(v).toFixed(1)}%`;
  const catColor = c => c==="Авто замын гэрэл"?"#f59e0b":c==="Гэр хорооллын гэрэл"?"#0ea5e9":c==="Цамхагийн гэрэл"?"#8b5cf6":c==="Гэрлэн дохио"?"#10b981":"#64748b";
  const maxReported = Math.max(1, ...data.months.map(m => m.reported_heads || 0));
  const maxOpen = Math.max(1, ...data.months.map(m => m.open_heads || 0));
  const monthRows = data.months.map(m => `
    <tr>
      <td style="font-weight:700;white-space:nowrap">${m.label}</td>
      <td style="text-align:center">${fmt(m.fault_count)}</td>
      <td style="text-align:center;color:#dc2626;font-weight:800">${fmt(m.reported_heads)}</td>
      <td style="text-align:center;color:#16a34a;font-weight:800">${fmt(m.repaired_heads)}</td>
      <td style="text-align:center;color:${m.open_heads ? "#d97706" : "#16a34a"};font-weight:800">${fmt(m.open_heads)}</td>
      <td style="text-align:center;font-weight:800;color:#2563eb">${pct(m.availability_pct)}</td>
      <td>
        <div style="height:8px;background:#f1f5f9;border-radius:999px;overflow:hidden;min-width:160px">
          <div style="height:100%;width:${Math.min(100, (m.reported_heads || 0) / maxReported * 100)}%;background:#ef4444"></div>
        </div>
        <div style="height:8px;background:#f1f5f9;border-radius:999px;overflow:hidden;min-width:160px;margin-top:4px">
          <div style="height:100%;width:${Math.min(100, (m.open_heads || 0) / maxOpen * 100)}%;background:#f59e0b"></div>
        </div>
      </td>
    </tr>`).join("");

  const catRows = data.by_category.map(r => {
    const col = catColor(r.category);
    return `<tr>
      <td><span style="font-size:11px;padding:3px 9px;border-radius:20px;background:${col}18;color:${col};font-weight:800">${r.category}</span></td>
      <td style="text-align:center;font-weight:700">${fmt(r.capacity)}</td>
      <td style="text-align:center;color:#dc2626;font-weight:800">${fmt(r.reported_heads)}</td>
      <td style="text-align:center;color:#16a34a;font-weight:800">${fmt(r.repaired_heads)}</td>
      <td style="text-align:center;color:${r.open_heads ? "#d97706" : "#16a34a"};font-weight:800">${fmt(r.open_heads)}</td>
      <td style="text-align:center;font-weight:800;color:#2563eb">${pct(r.availability_pct)}</td>
    </tr>`;
  }).join("");

  el.innerHTML = `
  <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px">
    <div>
      <div style="font-size:16px;font-weight:800;color:#1e293b">📈 Гэмтэл ба асалтын жилийн судалгаа</div>
      <div style="font-size:12px;color:#64748b;margin-top:3px">Сар бүрийн гэмтэл, засвар, сарын эцсийн асахгүй үлдэгдэл</div>
    </div>
    <div style="display:flex;gap:8px;align-items:center">
      <input id="slAnalyticsYear" class="input" type="number" min="2020" max="2100" value="${data.year}" style="width:100px;margin:0">
      <button class="btn" style="padding:8px 14px" onclick="slAnalyticsReload()">Харах</button>
      <button class="btn secondary" style="padding:8px 14px" onclick="window.print()">Хэвлэх</button>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px">
    ${[
      ["Нийт толгой", data.summary.capacity, "#475569", "#f8fafc"],
      ["Жилд бүртгэсэн", data.summary.reported_heads, "#dc2626", "#fef2f2"],
      ["Жилд зассан", data.summary.repaired_heads, "#16a34a", "#f0fdf4"],
      ["Одоо асахгүй", data.summary.open_heads, "#d97706", "#fff7ed"],
      ["Одоогийн асалт", pct(data.summary.availability_pct), "#2563eb", "#eff6ff"],
    ].map(c => `<div style="background:${c[3]};border-radius:10px;padding:13px 16px">
      <div style="font-size:22px;font-weight:800;color:${c[2]};line-height:1.1">${typeof c[1] === "number" ? fmt(c[1]) : c[1]}</div>
      <div style="font-size:11px;color:#64748b;margin-top:5px;font-weight:700">${c[0]}</div>
    </div>`).join("")}
  </div>

  <div style="display:grid;grid-template-columns:minmax(0,1.25fr) minmax(320px,.75fr);gap:14px">
    <div class="panel">
      <div style="padding:12px 16px;border-bottom:1px solid #e2e6ed;font-size:13px;font-weight:800">Сарын явц</div>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Сар</th><th style="text-align:center">Бүртгэл</th><th style="text-align:center">Гэмтсэн</th>
            <th style="text-align:center">Зассан</th><th style="text-align:center">Үлдсэн</th>
            <th style="text-align:center">Асалт</th><th>График</th>
          </tr></thead>
          <tbody>${monthRows}</tbody>
        </table>
      </div>
    </div>
    <div class="panel">
      <div style="padding:12px 16px;border-bottom:1px solid #e2e6ed;font-size:13px;font-weight:800">Төрлөөр жилийн дүн</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Төрөл</th><th style="text-align:center">Нийт</th><th style="text-align:center">Гэмтсэн</th><th style="text-align:center">Зассан</th><th style="text-align:center">Одоо</th><th style="text-align:center">Асалт</th></tr></thead>
          <tbody>${catRows}</tbody>
        </table>
      </div>
    </div>
  </div>`;
}

function slAnalyticsReload() {
  const y = parseInt(document.getElementById("slAnalyticsYear")?.value) || new Date().getFullYear();
  window._slAnalyticsYear = y;
  slHubTab("analytics");
}

async function _slTabPoints(el) {
  window._pointsEmbedTarget = "slHubContent";
  await sl_points();
}

function _slTabSched(el, d) {
  const { schedules } = d;
  const today = new Date().toISOString().slice(0,10);
  const SCHED_CATS = ["Авто замын гэрэл", "Гэр хорооллын гэрэл", "Цамхагийн гэрэл"];

  function effectiveFor(cat) {
    const catSched = schedules.filter(s => s.category === cat);
    // Schedule is "current" from the day it was configured (adjusted_date <= today)
    const current = catSched
      .filter(s => (s.adjusted_date || s.valid_from) <= today)
      .sort((a,b) => b.valid_from.localeCompare(a.valid_from) || b.id - a.id)[0];
    if (current) return { rec: current, upcoming: false };
    // Nothing configured yet — show nearest future record with ⏳ badge
    const next = catSched
      .filter(s => s.valid_from > today)
      .sort((a,b) => a.valid_from.localeCompare(b.valid_from) || a.id - b.id)[0];
    return next ? { rec: next, upcoming: true } : null;
  }

  const catCards = SCHED_CATS.map(cat => {
    const found = effectiveFor(cat);
    if (!found) return `
      <div style="background:#f8fafc;border:1px dashed #cbd5e1;border-radius:12px;padding:16px;flex:1;min-width:160px">
        <div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:8px">${cat}</div>
        <div style="font-size:12px;color:#94a3b8;font-style:italic">Тохиргоо алга</div>
      </div>`;
    const { rec: s, upcoming } = found;
    const upcomingBadge = upcoming
      ? `<div style="font-size:10px;color:#d97706;font-weight:700;background:#fef9c3;border-radius:20px;padding:1px 8px;display:inline-block;margin-bottom:6px">⏳ ${s.valid_from}-аас хүчинтэй</div>`
      : "";
    if (s.is_always_off) return `
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:16px;flex:1;min-width:160px">
        <div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:6px">${cat}</div>
        ${upcomingBadge}
        <div style="font-size:18px;font-weight:800;color:#dc2626">🔴 Унтраасан</div>
        <div style="font-size:10px;color:#94a3b8;margin-top:6px">${s.adjusted_by_name||""}</div>
      </div>`;
    const borderColor = upcoming ? "#fde68a" : "#e2e8f0";
    const bgColor     = upcoming ? "#fffbeb" : "#f8fafc";
    return `
      <div style="background:${bgColor};border:1px solid ${borderColor};border-radius:12px;padding:16px;flex:1;min-width:160px">
        <div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:6px">${cat}</div>
        ${upcomingBadge}
        <div style="display:flex;gap:10px;align-items:center">
          <div style="text-align:center">
            <div style="font-size:10px;color:#a16207;font-weight:700;margin-bottom:2px">АСАХ</div>
            <div style="font-size:26px;font-weight:800;color:#854d0e;line-height:1">${s.on_time||"—"}</div>
          </div>
          <div style="color:#cbd5e1;font-size:18px">–</div>
          <div style="text-align:center">
            <div style="font-size:10px;color:#1d4ed8;font-weight:700;margin-bottom:2px">УНТРАХ</div>
            <div style="font-size:26px;font-weight:800;color:#1e40af;line-height:1">${s.off_time||"—"}</div>
          </div>
        </div>
        <div style="font-size:10px;color:#94a3b8;margin-top:8px">${s.adjusted_by_name||""}</div>
      </div>`;
  }).join("");

  const histRows = schedules.slice(0,20).map((s,i) => `
    <tr style="background:${i%2?"#fafafa":"#fff"}">
      <td style="font-size:12px;font-weight:600;color:#334155">${s.category||"—"}</td>
      <td style="font-family:monospace;font-size:12px;color:#854d0e;font-weight:700">
        ${s.is_always_off ? `<span style="color:#dc2626">🔴 Унтраасан</span>` : (s.on_time||"—")}
      </td>
      <td style="font-family:monospace;font-size:12px;color:#1e40af;font-weight:700">${s.is_always_off?"": (s.off_time||"—")}</td>
      <td style="font-size:11px;color:#64748b">${s.valid_from||"—"}</td>
      <td style="font-size:11px;color:#94a3b8">${s.adjusted_by_name||"—"}</td>
    </tr>`).join("") || `<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:20px">Хуваарь байхгүй</td></tr>`;

  el.innerHTML = `
  <div class="panel" style="margin-bottom:14px;overflow:hidden">
    <div style="padding:18px 20px;border-bottom:1px solid #e2e6ed;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;background:linear-gradient(135deg,#fff7ed,#eff6ff)">
      <div>
        <div style="font-size:16px;font-weight:900;color:#0f172a">🌙 Өнөөдрийн хуваарь</div>
        <div style="font-size:12px;color:#64748b;margin-top:4px">Өдрийн тохиромжтой асаах цаг, ±10 минутын бүс, түүхтэй тохиргооны дэлгэрэнгүй самбар</div>
      </div>
      <button class="btn" style="font-size:13px;padding:10px 18px;border-radius:10px;box-shadow:0 8px 18px rgba(37,99,235,.18)" onclick="sl_light_sched()">+ Дахин тааруулах / Timeline харах</button>
    </div>
    <div style="padding:20px;display:flex;gap:12px;flex-wrap:wrap">${catCards}</div>
  </div>
  <div class="panel">
    <div style="padding:12px 16px;border-bottom:1px solid #e2e6ed;font-size:13px;font-weight:700">Хуваарийн түүх</div>
    <div class="table-wrap">
      <table><thead><tr>
        <th>Ангилал</th><th>Асах</th><th>Унтрах</th><th>Хүчинтэй</th><th>Тохирч. хүн</th>
      </tr></thead>
      <tbody>${histRows}</tbody></table>
    </div>
  </div>`;
}

async function _slTabReadings(el) {
  el.innerHTML = `<div style="text-align:center;padding:40px;color:#64748b">Ачааллаж байна...</div>`;
  try {
    const bills = await api("/api/eb");
    const rows = (bills||[]).map((b,i)=>`
      <tr style="background:${i%2?"#fafafa":"#fff"}">
        <td style="font-family:monospace;font-size:12px;font-weight:700;color:#1d4ed8">${b.billing_year}-${String(b.billing_month).padStart(2,"0")}</td>
        <td style="text-align:right;font-size:12px">${fmt(Math.round(b.total_kwh))}</td>
        <td style="text-align:right;font-size:12px;color:#16a34a;font-weight:600">${fmt(Math.round(b.our_kwh))}</td>
        <td style="text-align:right;font-size:12px">${fmtM(b.total_amount)}</td>
        <td style="text-align:right;font-size:12px;color:#16a34a;font-weight:600">${fmtM(b.our_amount)}</td>
        <td style="text-align:center;font-size:11px;color:#64748b">${b.point_count??"-"}</td>
        <td><button class="btn secondary" style="padding:2px 9px;font-size:11px" onclick="sl_readings_for(${b.id})">→</button></td>
      </tr>`).join("") || `<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:30px">Мэдээлэл байхгүй</td></tr>`;
    el.innerHTML = `
    <div class="panel">
      <div style="padding:12px 16px;border-bottom:1px solid #e2e6ed;font-size:13px;font-weight:700">📊 Цахилгааны уншилт / Нэхэмжлэл</div>
      <div class="table-wrap">
        <table><thead><tr>
          <th>Сар</th><th style="text-align:right">Нийт кВт.ц</th><th style="text-align:right">Манай кВт.ц</th>
          <th style="text-align:right">Нийт дүн</th><th style="text-align:right">Манай дүн</th><th style="text-align:center">Цэг</th><th></th>
        </tr></thead><tbody>${rows}</tbody></table>
      </div>
    </div>`;
  } catch(e) { el.innerHTML = `<div style="color:#dc2626;padding:20px">${e.message}</div>`; }
}

function _slTabLora(el) {
  el.innerHTML = `
  <div class="panel" style="padding:60px;text-align:center">
    <div style="font-size:48px;margin-bottom:16px">📡</div>
    <div style="font-size:16px;font-weight:700;color:#1e293b;margin-bottom:8px">LoRaWAN хяналт</div>
    <div style="font-size:13px;color:#64748b;margin-bottom:20px">Бодит цагийн мэдрэгчийн хяналт · Дохионы чанар · Тайлан</div>
    <button class="btn" onclick="lora_monitor()">Нэвтрэх →</button>
  </div>`;
}

async function _slTabFinance(el) {
  el.innerHTML = `<div style="text-align:center;padding:40px;color:#64748b">Ачааллаж байна...</div>`;
  try {
    const d = await api("/api/el-summary");
    const unverified = d.unverified || 0;
    el.innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">
      ${[
        {label:"Нийт идэвхтэй цэг",val:fmt(d.total_points), color:"#2563eb",bg:"#eff6ff"},
        {label:"Манай цэг",        val:fmt(d.our_points),   color:"#16a34a",bg:"#dcfce7"},
        {label:"Баталгаажаагүй",   val:fmt(unverified),     color:unverified?"#a16207":"#64748b",bg:unverified?"#fef9c3":"#f8fafc"},
        {label:"Анхааруулга",      val:fmt(d.warnings),     color:d.warnings?"#dc2626":"#64748b",bg:d.warnings?"#fee2e2":"#f8fafc"},
        {label:"Нийт дүн",        val:fmtM(d.total_amount), color:"#0369a1",bg:"#e0f2fe"},
        {label:"Манай дүн",       val:fmtM(d.our_amount),   color:"#16a34a",bg:"#dcfce7"},
      ].map(s=>`<div style="background:${s.bg};border-radius:10px;padding:14px 18px;flex:1;min-width:120px">
        <div style="font-size:20px;font-weight:800;color:${s.color}">${s.val}</div>
        <div style="font-size:11px;color:#64748b;margin-top:4px">${s.label}</div>
      </div>`).join("")}
    </div>
    <div style="display:flex;gap:10px;margin-bottom:16px">
      <button class="btn" onclick="sl_points()">🔍 Тоолуур</button>
      <button class="btn" onclick="sl_bills()">📋 Нэхэмжлэл</button>
      <button class="btn secondary" onclick="sl_budget()">📊 Төлөвлөгөө</button>
    </div>
    <div class="panel">
      <div style="padding:12px 16px;border-bottom:1px solid #e2e6ed;font-size:13px;font-weight:700">📋 Сүүлийн нэхэмжлэлүүд</div>
      <div class="table-wrap">
        <table><thead><tr>
          <th>Сар</th><th style="text-align:right">Нийт кВт.ц</th><th style="text-align:right">Манай кВт.ц</th>
          <th style="text-align:right">Нийт дүн</th><th style="text-align:right">Манай дүн</th>
          <th style="text-align:center">Цэг</th><th style="text-align:center">Анхааруулга</th><th>Төлөв</th><th></th>
        </tr></thead>
        <tbody>${(d.recent_bills||[]).map(b=>`<tr>
          <td style="font-family:monospace;font-size:12px;font-weight:700;color:#1d4ed8">${b.billing_year}-${String(b.billing_month).padStart(2,"0")}</td>
          <td style="text-align:right;font-size:12px">${fmt(Math.round(b.total_kwh))}</td>
          <td style="text-align:right;font-size:12px;color:#16a34a;font-weight:600">${fmt(Math.round(b.our_kwh))}</td>
          <td style="text-align:right;font-size:12px">${fmtM(b.total_amount)}</td>
          <td style="text-align:right;font-size:12px;color:#16a34a;font-weight:600">${fmtM(b.our_amount)}</td>
          <td style="text-align:center;font-size:12px;color:#64748b">${b.point_count??"—"}</td>
          <td style="text-align:center">${b.unresolved_checks>0?`<span style="background:#fee2e2;color:#dc2626;border-radius:20px;padding:1px 8px;font-size:11px;font-weight:700">${b.unresolved_checks}</span>`:`<span style="color:#94a3b8;font-size:12px">—</span>`}</td>
          <td>${statusBadge(b.status)}</td>
          <td><button class="btn secondary" style="padding:3px 10px;font-size:11px" onclick="sl_readings_for(${b.id})">Харах →</button></td>
        </tr>`).join("")}
        ${!(d.recent_bills||[]).length?`<tr><td colspan="9" style="text-align:center;color:#94a3b8;padding:30px">Нэхэмжлэл байхгүй</td></tr>`:""}
        </tbody></table>
      </div>
    </div>`;
  } catch(e) { el.innerHTML = `<div style="color:#dc2626;padding:20px">${e.message}</div>`; }
}

// ── Meter Points ─────────────────────────────────────────────────
async function sl_points() {
  const embedTargetId = window._pointsEmbedTarget || "";
  const renderTarget = embedTargetId ? document.getElementById(embedTargetId) : main;
  const embedded = !!embedTargetId && !!renderTarget;
  if (!embedded) window._pointsEmbedTarget = "";
  renderTarget.innerHTML = `<div class="text-center py-5"><div class="spinner-border text-primary"></div></div>`;
  let rows;
  try { rows = await api("/api/mp"); } catch(e) { renderTarget.innerHTML = `<div class="alert alert-danger">${e.message}</div>`; return; }

  // Tab state
  const tab = window._mpTab || "unverified";
  const filtered = tab === "all"          ? rows
    : tab === "unverified" ? rows.filter(r => !r.verified)
    : tab === "OURS"       ? rows.filter(r => r.owner_status === "OURS" && r.verified)
    : tab === "OTHER"      ? rows.filter(r => r.owner_status === "OTHER" && r.verified)
    : tab === "TRANSFERRED"? rows.filter(r => r.owner_status === "TRANSFERRED")
    : rows;

  const counts = {
    all: rows.length,
    unverified: rows.filter(r => !r.verified).length,
    OURS:    rows.filter(r => r.owner_status === "OURS"        && r.verified).length,
    OTHER:   rows.filter(r => r.owner_status === "OTHER"       && r.verified).length,
    TRANSFERRED: rows.filter(r => r.owner_status === "TRANSFERRED").length,
  };

  function tabBtn(key, label, icon, activeColor, activeBg) {
    const active = tab === key;
    return `<button onclick="sl_points_tab('${key}')" style="
      display:flex;align-items:center;gap:6px;padding:6px 14px;border-radius:20px;border:none;cursor:pointer;font-size:12px;font-weight:600;transition:all .15s;
      background:${active ? activeBg : '#f1f5f9'};color:${active ? activeColor : '#64748b'};
      outline:${active ? '2px solid '+activeColor : 'none'};outline-offset:1px">
      ${icon}${label}
      <span style="background:${active?'rgba(255,255,255,.35)':'#e2e8f0'};color:${active?activeColor:'#475569'};border-radius:10px;padding:1px 7px;font-size:11px;font-weight:700">${counts[key]}</span>
    </button>`;
  }

  renderTarget.innerHTML = `
  <div class="panel">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #e2e6ed;flex-wrap:wrap;gap:8px">
      <div>
        <div style="font-size:15px;font-weight:800">🔌 Тоолуурын бүртгэл</div>
        <div style="font-size:11px;color:#667085">Master Registry · Өмчлөл баталгаажуулалт</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        ${counts.unverified > 0 ? `<span style="background:#fef9c3;color:#a16207;border-radius:20px;padding:4px 12px;font-size:11px;font-weight:700">❓ ${counts.unverified} баталгаажаагүй</span>` : `<span style="background:#dcfce7;color:#16a34a;border-radius:20px;padding:4px 12px;font-size:11px;font-weight:700">✅ Бүгд баталгаажсан</span>`}
        ${canEditPoints() ? `<button class="btn secondary" style="padding:5px 12px;font-size:11px" onclick="sl_points_bootstrap()">⚡ Bootstrap</button>` : ""}
        ${canEditPoints() ? `<button class="btn" style="padding:5px 12px;font-size:11px" onclick="sl_points_add()">+ Нэмэх</button>` : ""}
      </div>
    </div>

    <div id="mpBootstrapArea"></div>

    <div style="display:flex;align-items:center;gap:8px;padding:12px 18px;border-bottom:1px solid #f1f5f9;flex-wrap:wrap">
      ${tabBtn("unverified", "Баталгаажаагүй", "❓ ", "#a16207", "#fef9c3")}
      ${tabBtn("OURS",       "Манайх",         "✅ ", "#16a34a", "#dcfce7")}
      ${tabBtn("OTHER",      "Бусад",           "🔲 ", "#475569", "#f1f5f9")}
      ${tabBtn("TRANSFERRED","Шилжүүлсэн",     "🔄 ", "#0369a1", "#e0f2fe")}
      ${tabBtn("all",        "Бүгд",            "",    "#1d4ed8", "#eff6ff")}
      <input id="mpSearch" placeholder="Хайх..." oninput="sl_points_filter()"
        style="margin-left:auto;padding:6px 12px;border:1px solid #e2e6ed;border-radius:8px;font-size:12px;width:180px;outline:none">
    </div>

    ${canEditPoints() && filtered.length > 0 ? `
    <div id="bulkBar" style="display:flex;align-items:center;gap:8px;padding:8px 18px;background:#f8fafc;border-bottom:1px solid #f1f5f9;flex-wrap:wrap">
      <span id="selCount" style="font-size:11px;color:#64748b;min-width:80px">0 сонгогдсон</span>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn" style="padding:4px 12px;font-size:11px;background:#16a34a;border-color:#16a34a" onclick="sl_bulk_verify('OURS')">✅ Манайх</button>
        <button class="btn secondary" style="padding:4px 12px;font-size:11px" onclick="sl_bulk_verify('OTHER')">🔲 Бусад</button>
        <button class="btn" style="padding:4px 12px;font-size:11px;background:#0369a1;border-color:#0369a1" onclick="sl_bulk_verify('TRANSFERRED')">🔄 Шилжүүлсэн</button>
      </div>
      <div style="margin-left:auto;display:flex;gap:6px">
        <button class="btn secondary" style="padding:4px 10px;font-size:11px" onclick="sl_points_select_all()">Бүгдийг сонгох</button>
        <button class="btn secondary" style="padding:4px 10px;font-size:11px" onclick="sl_points_deselect()">Болих</button>
      </div>
    </div>` : ""}

    <div class="table-wrap">
      <table id="mpTable">
        <thead><tr>
          ${canEditPoints() ? `<th style="width:32px"><input type="checkbox" id="chkAll" onchange="sl_points_toggle_all(this.checked)"></th>` : ""}
          <th>Тоолуурын №</th><th>Байршил</th><th>Өмчлөл</th><th style="text-align:center">Баталгаа</th>${canEditPoints() ? "<th></th>" : ""}
        </tr></thead>
        <tbody>
          ${filtered.map(r => `<tr data-id="${r.id}" style="${!r.verified ? "background:#fefce8;border-left:3px solid #facc15" : ""}">
            ${canEditPoints() ? `<td><input type="checkbox" class="mpChk" value="${r.id}" onchange="sl_points_chk_change()"></td>` : ""}
            <td><span style="font-family:monospace;font-size:11px;background:#f1f5f9;padding:2px 7px;border-radius:4px">${r.meter_no}</span>${r.auto_created ? ` <span style="font-size:9px;background:#e2e8f0;color:#64748b;border-radius:4px;padding:1px 5px">auto</span>` : ""}</td>
            <td style="font-size:12px;color:#667085">${r.location||r.name||"—"}</td>
            <td>${ownerBadge(r.owner_status)}</td>
            <td style="text-align:center">${r.verified ? `<span style="color:#16a34a;font-size:13px">✅</span>` : `<span style="color:#ca8a04;font-size:13px">❓</span>`}</td>
            ${canEditPoints() ? `<td><div style="display:flex;gap:4px">
              <button class="btn secondary" style="padding:2px 8px;font-size:10px" onclick='sl_points_edit(${JSON.stringify(r).replace(/'/g,"&#39;")})'>✏️</button>
              <button class="btn danger" style="padding:2px 8px;font-size:10px" onclick="sl_points_del(${r.id})">🗑</button>
            </div></td>` : ""}
          </tr>`).join("")}
          ${filtered.length === 0 ? `<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:30px">Энэ ангиллын тоолуур байхгүй</td></tr>` : ""}
        </tbody>
      </table>
    </div>
  </div>
  <div id="mpFormArea"></div>`;
}

function sl_points_tab(key) {
  window._mpTab = key;
  sl_points();
}

function sl_points_filter() {
  const q = (document.getElementById("mpSearch").value || "").toLowerCase();
  document.querySelectorAll("#mpTable tbody tr").forEach(tr => {
    tr.style.display = tr.textContent.toLowerCase().includes(q) ? "" : "none";
  });
}

function sl_points_toggle_all(checked) {
  document.querySelectorAll(".mpChk").forEach(c => c.checked = checked);
  sl_points_chk_change();
}

function sl_points_select_all() {
  document.querySelectorAll(".mpChk").forEach(c => c.checked = true);
  sl_points_chk_change();
}

function sl_points_deselect() {
  document.querySelectorAll(".mpChk").forEach(c => c.checked = false);
  sl_points_chk_change();
}

function sl_points_chk_change() {
  const n = document.querySelectorAll(".mpChk:checked").length;
  const el = document.getElementById("selCount");
  if (el) el.textContent = n + " сонгогдсон";
}

function _selectedIds() {
  return [...document.querySelectorAll(".mpChk:checked")].map(c => +c.value);
}

async function sl_bulk_verify(owner_status) {
  const ids = _selectedIds();
  if (!ids.length) { toast("Тоолуур сонгоно уу"); return; }
  const label = { OURS:"Манайх", OTHER:"Бусад", TRANSFERRED:"Шилжүүлсэн" }[owner_status] || owner_status;
  if (!confirm(`${ids.length} тоолуурыг "${label}" гэж тэмдэглэх үү?`)) return;
  try {
    const r = await put_("/api/mp/bulk-verify", { ids, owner_status });
    toast(`✅ ${r.updated} тоолуур баталгаажлаа`);
    sl_points();
  } catch(e) { toast("⚠️ " + e.message); }
}

function sl_points_bootstrap() {
  document.getElementById("mpBootstrapArea").innerHTML = `
    <div class="card mb-3 border-warning">
      <div class="card-header bg-warning fw-bold">⚡ Registry Bootstrap — PDF-аас автоматаар тоолуур үүсгэх</div>
      <div class="card-body">
        <p class="small text-muted mb-2">1-р сараас 4-р сар хүртэлх PDF нэхэмжлэлүүдийг сонгоно уу. Систем бүх тоолуурыг автоматаар задлан draft бүртгэл үүсгэнэ.</p>
        <div class="d-flex gap-2 align-items-end">
          <div class="flex-grow-1">
            <label class="form-label small fw-bold">PDF файлууд (олноор сонгох боломжтой)</label>
            <input type="file" id="bootstrapPdfs" class="form-control form-control-sm" accept=".pdf" multiple>
          </div>
          <button class="btn btn-warning" onclick="sl_points_bootstrap_run()">🚀 Үүсгэх</button>
          <button class="btn btn-secondary" onclick="document.getElementById('mpBootstrapArea').innerHTML=''">Болих</button>
        </div>
        <div id="bootstrapResult" class="mt-2"></div>
      </div>
    </div>`;
}

async function sl_points_bootstrap_run() {
  const input = document.getElementById("bootstrapPdfs");
  if (!input || !input.files.length) { toast("PDF файл сонгоно уу"); return; }
  const result = document.getElementById("bootstrapResult");
  result.innerHTML = `<div class="spinner-border spinner-border-sm text-warning"></div> Боловсруулж байна (${input.files.length} файл)…`;

  const fd = new FormData();
  for (const f of input.files) fd.append("pdfs", f);

  try {
    const res = await fetch("/api/mp/bootstrap", {
      method: "POST",
      headers: { "Authorization": "Bearer " + state.token },
      body: fd
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || "Алдаа гарлаа");
    result.innerHTML = `<div class="alert alert-success py-2 mt-2">
      ✅ Bootstrap дууслаа: <strong>${d.created}</strong> шинэ тоолуур үүслээ, ${d.already} аль хэдийн байсан.
      Нийт ${d.total} өвөрмөц тоолуур олдлоо.
    </div>`;
    setTimeout(() => sl_points(), 1500);
  } catch(e) {
    result.innerHTML = `<div class="alert alert-danger py-2 mt-2">⚠️ ${e.message}</div>`;
  }
}

function sl_points_add() {
  const area = document.getElementById("mpFormArea");
  if (!area) return;
  area.innerHTML = _mpForm({});
  area.scrollIntoView({ behavior: "smooth", block: "start" });
}

function sl_points_edit(r) {
  const area = document.getElementById("mpFormArea");
  if (!area) return;
  area.innerHTML = _mpForm(r);
  area.scrollIntoView({ behavior: "smooth", block: "start" });
}

function _mpForm(r) {
  const ownerOpts = ["OURS","OTHER","SHARED","TRANSFERRED","UNKNOWN"].map(o =>
    `<option ${(r.owner_status||"UNKNOWN")===o?"selected":""}>${o}</option>`).join("");
  const statusOpts = ["ACTIVE","INACTIVE","TRANSFERRED","REMOVED"].map(s =>
    `<option ${(r.status||"ACTIVE")===s?"selected":""}>${s}</option>`).join("");
  return `<div class="card mt-3 border-primary">
    <div class="card-header bg-primary text-white fw-bold">${r.id ? "Засварлах — " + r.meter_no : "Шинэ тоолуур нэмэх"}</div>
    <div class="card-body">
      <div class="row g-2">
        <div class="col-md-3"><label class="form-label small">Тоолуурын №</label>
          <input id="mpNo" class="form-control form-control-sm" value="${r.meter_no||""}" ${r.id?"readonly":""}></div>
        <div class="col-md-3"><label class="form-label small">Нэр</label>
          <input id="mpName" class="form-control form-control-sm" value="${r.name||""}"></div>
        <div class="col-md-3"><label class="form-label small">Байршил</label>
          <input id="mpLoc" class="form-control form-control-sm" value="${r.location||""}"></div>
        <div class="col-md-3"><label class="form-label small">Өмчлөл</label>
          <select id="mpOwner" class="form-select form-select-sm">${ownerOpts}</select></div>
        <div class="col-md-2"><label class="form-label small">Төлөв</label>
          <select id="mpStatus" class="form-select form-select-sm">${statusOpts}</select></div>
        <div class="col-md-2"><label class="form-label small">Чийдэн</label>
          <input id="mpLamps" type="number" class="form-control form-control-sm" value="${r.lamp_count||1}"></div>
        <div class="col-md-2"><label class="form-label small">Ватт/чийдэн</label>
          <input id="mpWatt" type="number" class="form-control form-control-sm" value="${r.wattage_per_lamp||0}"></div>
        <div class="col-md-6"><label class="form-label small">Тэмдэглэл</label>
          <input id="mpNotes" class="form-control form-control-sm" value="${r.notes||""}"></div>
      </div>
      <div class="mt-3 d-flex gap-2">
        <button class="btn btn-sm btn-primary" onclick="sl_points_save(${r.id||0})">Хадгалах</button>
        <button class="btn btn-sm btn-secondary" onclick="document.getElementById('mpFormArea').innerHTML=''">Болих</button>
      </div>
    </div>
  </div>`;
}

async function sl_points_save(id) {
  const body = {
    meter_no:         (document.getElementById("mpNo").value || "").trim(),
    name:             (document.getElementById("mpName").value || "").trim(),
    location:         (document.getElementById("mpLoc").value || "").trim(),
    owner_status:     document.getElementById("mpOwner").value,
    status:           document.getElementById("mpStatus").value,
    lamp_count:       +document.getElementById("mpLamps").value,
    wattage_per_lamp: +document.getElementById("mpWatt").value,
    notes:            (document.getElementById("mpNotes").value || "").trim()
  };
  try {
    id ? await put_(`/api/mp/${id}`, body) : await post("/api/mp", body);
    toast(id ? "Шинэчлэгдлаа" : "Нэмэгдлээ");
    sl_points();
  } catch(e) { toast("⚠️ " + e.message); }
}

async function sl_points_del(id) {
  if (!confirm("Тоолуурыг REMOVED болгох уу?")) return;
  try { await del_(`/api/mp/${id}`); toast("Устгагдлаа"); sl_points(); }
  catch(e) { toast("⚠️ " + e.message); }
}

// ── Bill Detail (readings view) ──────────────────────────────────
async function sl_readings() {
  main.innerHTML = `<div class="text-center py-5"><div class="spinner-border text-primary"></div></div>`;
  let bills;
  try { bills = await api("/api/eb"); } catch(e) { main.innerHTML = `<div class="alert alert-danger">${e.message}</div>`; return; }
  if (!bills.length) {
    main.innerHTML = `<div class="alert alert-info">Нэхэмжлэл байхгүй байна. ${canEdit() ? `<a href="#" onclick="sl_bills()">Оруулах →</a>` : ""}</div>`;
    return;
  }
  await sl_readings_for(bills[0].id, bills);
}

async function sl_readings_for(id, bills) {
  if (!bills) {
    try { bills = await api("/api/eb"); } catch(e) { main.innerHTML = `<div class="alert alert-danger">${e.message}</div>`; return; }
  }
  let d;
  try { d = await api(`/api/eb/${id}`); } catch(e) { main.innerHTML = `<div class="alert alert-danger">${e.message}</div>`; return; }
  const { bill, points, checks } = d;
  const openChecks = checks.filter(c => !c.is_resolved);

  const ourPct = bill.total_kwh > 0 ? (bill.our_kwh / bill.total_kwh * 100).toFixed(1) : "0.0";

  main.innerHTML = `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
    <div>
      <h1 style="margin:0 0 3px;font-size:20px;font-weight:800;letter-spacing:-.02em">📋 Нэхэмжлэлийн дэлгэрэнгүй</h1>
      <div style="font-size:12px;color:#667085">Цахилгааны зарцуулалт · Тоолуурын бүртгэл</div>
    </div>
    <select onchange="sl_readings_for(+this.value)"
      style="padding:7px 12px;border:1px solid #e2e6ed;border-radius:8px;font-size:12px;font-weight:600;color:#374151;outline:none;background:#fff;cursor:pointer">
      ${bills.map(b => `<option value="${b.id}" ${b.id===bill.id?"selected":""}>${b.billing_year}-${String(b.billing_month).padStart(2,"0")} · ${b.status==="confirmed"?"✅ Баталгаажсан":b.status==="pending"?"⏳ Хүлээгдэж буй":"❌ Татгалзсан"}</option>`).join("")}
    </select>
  </div>

  <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">
    <div style="background:#eff6ff;border-radius:10px;padding:14px 20px;flex:1;min-width:140px">
      <div style="font-size:11px;color:#64748b;margin-bottom:3px">Нийт кВт.ц</div>
      <div style="font-size:20px;font-weight:800;color:#2563eb">${fmt(Math.round(bill.total_kwh))}</div>
      <div style="font-size:10px;color:#94a3b8">кВт.ц</div>
    </div>
    <div style="background:#dcfce7;border-radius:10px;padding:14px 20px;flex:1;min-width:140px">
      <div style="font-size:11px;color:#64748b;margin-bottom:3px">Манай кВт.ц</div>
      <div style="font-size:20px;font-weight:800;color:#16a34a">${fmt(Math.round(bill.our_kwh))}</div>
      <div style="font-size:10px;color:#16a34a;font-weight:600">${ourPct}% нийт дүнгээс</div>
    </div>
    <div style="background:#e0f2fe;border-radius:10px;padding:14px 20px;flex:1;min-width:140px">
      <div style="font-size:11px;color:#64748b;margin-bottom:3px">Нийт дүн</div>
      <div style="font-size:20px;font-weight:800;color:#0369a1">${fmt(Math.round(bill.total_amount))}</div>
      <div style="font-size:10px;color:#94a3b8">₮</div>
    </div>
    <div style="background:#dcfce7;border-radius:10px;padding:14px 20px;flex:1;min-width:140px">
      <div style="font-size:11px;color:#64748b;margin-bottom:3px">Манай дүн</div>
      <div style="font-size:20px;font-weight:800;color:#16a34a">${fmt(Math.round(bill.our_amount))}</div>
      <div style="font-size:10px;color:#94a3b8">₮</div>
    </div>
    ${openChecks.length ? `
    <div style="background:#fee2e2;border-radius:10px;padding:14px 20px;min-width:140px;cursor:pointer" onclick="document.getElementById('checksSection').scrollIntoView({behavior:'smooth'})">
      <div style="font-size:11px;color:#64748b;margin-bottom:3px">Нээлттэй шалгалт</div>
      <div style="font-size:20px;font-weight:800;color:#dc2626">${openChecks.length}</div>
      <div style="font-size:10px;color:#dc2626;font-weight:600">⚠ Шийдвэрлэх шаардлагатай</div>
    </div>` : `
    <div style="background:#f0fdf4;border-radius:10px;padding:14px 20px;min-width:140px">
      <div style="font-size:11px;color:#64748b;margin-bottom:3px">Шалгалт</div>
      <div style="font-size:20px;font-weight:800;color:#16a34a">✅</div>
      <div style="font-size:10px;color:#16a34a;font-weight:600">Бүгд шийдвэрлэгдсэн</div>
    </div>`}
  </div>

  ${openChecks.length ? `
  <div class="panel" id="checksSection" style="margin-bottom:16px">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 18px;border-bottom:1px solid #fecaca;background:#fef2f2;border-radius:10px 10px 0 0">
      <div style="font-size:13px;font-weight:700;color:#dc2626">⚠ Нээлттэй шалгалтууд</div>
      <span style="background:#fee2e2;color:#dc2626;border-radius:20px;padding:2px 10px;font-size:11px;font-weight:700">${openChecks.length}</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Тоолуур</th><th>Код</th><th>Төрөл</th><th>Мессеж</th>${canEdit()?"<th></th>":""}
        </tr></thead>
        <tbody>
          ${openChecks.map(c => `<tr style="${c.severity==="ERROR"?"background:#fff5f5;border-left:3px solid #dc2626":"background:#fefce8;border-left:3px solid #facc15"}">
            <td><span style="font-family:monospace;font-size:11px;background:#f1f5f9;padding:2px 7px;border-radius:4px">${c.meter_no||"—"}</span></td>
            <td><span style="font-size:10px;color:#64748b;background:#f1f5f9;padding:2px 6px;border-radius:4px">${c.check_code}</span></td>
            <td>${sevBadge(c.severity)}</td>
            <td style="font-size:12px;color:#374151">${c.message}</td>
            ${canEdit() ? `<td><button class="btn" style="padding:3px 10px;font-size:11px;background:#16a34a;border-color:#16a34a" onclick="el_resolve(${c.id},${id})">✓ Шийдвэрлэх</button></td>` : ""}
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
  </div>` : ""}

  <div class="panel">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 18px;border-bottom:1px solid #e2e6ed">
      <div style="font-size:13px;font-weight:700">🔌 Нормалчилсан цэгүүд</div>
      <span style="background:#f1f5f9;color:#475569;border-radius:20px;padding:2px 10px;font-size:11px;font-weight:600">${points.length} цэг</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Тоолуур №</th><th>Байршил</th><th>Өмчлөл</th>
          <th style="text-align:right">кВт.ц</th>
          <th style="text-align:right">Өдөр</th>
          <th style="text-align:right">Шөнө</th>
          <th style="text-align:right">Тариф дүн</th>
          <th style="text-align:right">Capacity</th>
          <th style="text-align:right">Нийт дүн</th>
        </tr></thead>
        <tbody>
          ${points.map(p => `<tr style="${p.owner_status!=="OURS"?"opacity:.6":""}">
            <td><span style="font-family:monospace;font-size:11px;background:#f1f5f9;padding:2px 7px;border-radius:4px">${p.meter_no}</span></td>
            <td style="font-size:11px;color:#667085">${p.location||"—"}</td>
            <td>${ownerBadge(p.owner_status||"OTHER")}</td>
            <td style="text-align:right;font-size:12px;font-weight:600">${fmt(Math.round(p.usage_kwh))}</td>
            <td style="text-align:right;font-size:11px;color:#64748b">${fmt(Math.round(p.day_kwh))}</td>
            <td style="text-align:right;font-size:11px;color:#64748b">${fmt(Math.round(p.night_kwh))}</td>
            <td style="text-align:right;font-size:12px">${fmt(Math.round(p.amount - p.capacity_amount))}</td>
            <td style="text-align:right;font-size:11px;color:#64748b">${p.capacity_amount > 0 ? fmt(Math.round(p.capacity_amount)) : "—"}</td>
            <td style="text-align:right;font-size:12px;font-weight:700;color:#1d4ed8">${fmt(Math.round(p.amount))}</td>
          </tr>`).join("")}
          <tr style="background:#f8fafc;font-weight:700;border-top:2px solid #e2e6ed">
            <td colspan="3" style="font-size:12px;color:#1d4ed8">НИЙТ</td>
            <td style="text-align:right;font-size:12px">${fmt(Math.round(points.reduce((s,p)=>s+p.usage_kwh,0)))}</td>
            <td colspan="2"></td>
            <td style="text-align:right;font-size:12px">${fmt(Math.round(points.reduce((s,p)=>s+(p.amount-p.capacity_amount),0)))}</td>
            <td style="text-align:right;font-size:12px">${fmt(Math.round(points.reduce((s,p)=>s+p.capacity_amount,0)))}</td>
            <td style="text-align:right;font-size:12px;color:#1d4ed8">${fmt(Math.round(points.reduce((s,p)=>s+p.amount,0)))}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>`;
}

async function el_resolve(checkId, billId) {
  const note = prompt("Шийдвэрлэлтийн тэмдэглэл (заавал биш):");
  if (note === null) return;
  try {
    await put_(`/api/el-check/${checkId}/resolve`, { resolution_note: note });
    toast("Шийдвэрлэгдлээ");
    sl_readings_for(billId);
  } catch(e) { toast("⚠️ " + e.message); }
}

// ── Bill Import ──────────────────────────────────────────────────
async function sl_bills() {
  main.innerHTML = `<div style="text-align:center;padding:60px;color:#94a3b8">Ачааллаж байна...</div>`;
  let bills;
  try { bills = await api("/api/eb"); } catch(e) { main.innerHTML = `<div style="color:#ef4444;padding:20px">${e.message}</div>`; return; }

  const canE = canEdit();
  main.innerHTML = `
  <div class="panel">
    <div class="panel-header" style="display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="font-weight:700;font-size:16px;color:#1e293b">🧾 Нэхэмжлэл / Харьцуулалт</div>
        <div style="font-size:12px;color:#667085">Цахилгааны нэхэмжлэлийн жагсаалт ба PDF татан авалт</div>
      </div>
      ${canE ? `<label class="btn" style="cursor:pointer">
        📂 PDF оруулах
        <input type="file" accept=".pdf" style="display:none" onchange="el_preview_upload(this)">
      </label>` : ""}
    </div>
    <div class="panel-body">
      ${bills.length === 0 ? `
        <div style="text-align:center;padding:60px;color:#94a3b8">
          <div style="font-size:40px;margin-bottom:12px">📄</div>
          <div style="font-size:14px">Нэхэмжлэл байхгүй байна</div>
          ${canE ? `<div style="margin-top:8px;font-size:12px;color:#cbd5e1">Дээрх товчлуураар PDF оруулна уу</div>` : ""}
        </div>
      ` : `
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>Сар</th><th>Нэхэмжлэлийн №</th>
              <th>Нийт кВт.ц</th><th>Манай кВт.ц</th>
              <th>Нийт дүн</th><th>Манай дүн</th>
              <th>Анхааруулга</th><th>Төлөв</th><th></th>
            </tr></thead>
            <tbody>
              ${bills.map(b => `<tr>
                <td style="font-weight:600">${b.billing_year}-${String(b.billing_month).padStart(2,"0")}</td>
                <td style="font-family:monospace;font-size:11px;color:#64748b">${b.invoice_no||"—"}</td>
                <td>${(b.total_kwh||0).toFixed(1)}</td>
                <td>${(b.our_kwh||0).toFixed(1)}</td>
                <td>${fmt(b.total_amount)} ₮</td>
                <td style="font-weight:600;color:#1e293b">${fmt(b.our_amount)} ₮</td>
                <td>${b.unresolved_checks > 0
                  ? `<span style="color:#d97706;font-weight:700">⚠️ ${b.unresolved_checks}</span>`
                  : `<span style="color:#16a34a;font-weight:600">✓ Цэвэр</span>`}</td>
                <td>${statusBadge(b.status)}</td>
                <td style="display:flex;gap:6px;white-space:nowrap">
                  <button class="btn secondary" style="padding:3px 10px;font-size:11px" onclick="sl_readings_for(${b.id})">Харах →</button>
                  ${canE ? `<button class="btn" style="padding:3px 10px;font-size:11px;background:#ef4444;border-color:#ef4444" onclick="el_bill_delete(${b.id})">Устгах</button>` : ""}
                </td>
              </tr>`).join("")}
            </tbody>
          </table>
        </div>
      `}
    </div>
  </div>`;
}

async function el_preview_upload(input) {
  const file = input.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append("pdf", file);
  main.innerHTML = `<div style="text-align:center;padding:60px;color:#667085">
    <div style="font-size:32px;margin-bottom:12px">⚙️</div>
    <div style="font-size:14px">PDF задлаж байна...</div>
  </div>`;
  try {
    const res = await fetch("/api/el-import/preview", {
      method: "POST",
      headers: { "Authorization": "Bearer " + state.token },
      body: fd
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Алдаа гарлаа");
    el_preview(data);
  } catch(e) {
    toast("⚠️ " + e.message);
    sl_bills();
  }
}

function el_preview(data) {
  const { meta, normRows, checks, stats } = data;
  const errors   = (checks||[]).filter(c => c.severity === "ERROR").length;
  const warnings = (checks||[]).filter(c => c.severity === "WARNING").length;

  main.innerHTML = `
  <div style="display:flex;flex-direction:column;gap:16px">

    <div class="panel">
      <div class="panel-header">
        <div style="font-weight:700;font-size:15px;color:#1e293b">📋 PDF урьдчилан харах</div>
        <div style="font-size:12px;color:#667085">Баталгаажуулахаасаа өмнө мэдээллийг шалгана уу</div>
      </div>
      <div class="panel-body">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:16px">
          ${[
            ["📅 Огноо", meta.billing_year && meta.billing_month ? `${meta.billing_year}-${String(meta.billing_month).padStart(2,"0")}` : "⚠️ Тодорхойгүй", meta.billing_year && meta.billing_month ? "#1e293b" : "#d97706"],
            ["⚡ Нийт кВт.ц", (stats.total_kwh||0).toFixed(1), "#1e293b"],
            ["🏢 Манай кВт.ц", (stats.our_kwh||0).toFixed(1), "#0369a1"],
            ["💰 Нийт дүн", fmt(stats.total_amount)+" ₮", "#1e293b"],
            ["💳 Манай дүн", fmt(stats.our_amount)+" ₮", "#16a34a"],
            ["📍 Тоолуур", stats.point_count+" ш", "#1e293b"],
          ].map(([label,val,color]) => `
            <div style="background:#f8fafc;border-radius:10px;padding:12px;text-align:center">
              <div style="font-size:11px;color:#94a3b8;margin-bottom:4px">${label}</div>
              <div style="font-weight:700;font-size:14px;color:${color}">${val}</div>
            </div>`).join("")}
        </div>

        ${!meta.billing_year || !meta.billing_month ? `
        <div style="background:#fef9c3;border:1px solid #fde68a;border-radius:8px;padding:12px;margin-bottom:16px">
          <div style="font-size:12px;font-weight:700;color:#a16207;margin-bottom:8px">⚠️ Огноо автоматаар тодорхойлогдсонгүй. Гараар оруулна уу:</div>
          <div style="display:flex;gap:8px;align-items:center">
            <input type="number" id="override_year" placeholder="Жил (2025)" min="2020" max="2030"
              style="padding:6px 10px;border:1px solid #e2e6ed;border-radius:6px;width:120px"
              value="${meta.billing_year||new Date().getFullYear()}">
            <input type="number" id="override_month" placeholder="Сар (1-12)" min="1" max="12"
              style="padding:6px 10px;border:1px solid #e2e6ed;border-radius:6px;width:100px"
              value="${meta.billing_month||""}">
          </div>
        </div>` : ""}

        ${checks && checks.length ? `
        <div style="margin-bottom:16px">
          <div style="font-weight:700;font-size:13px;color:#1e293b;margin-bottom:8px">
            🔍 Шалгалтын үр дүн
            ${errors   ? `<span style="font-size:11px;background:#fee2e2;color:#dc2626;padding:2px 8px;border-radius:20px;margin-left:6px">${errors} алдаа</span>` : ""}
            ${warnings ? `<span style="font-size:11px;background:#fef9c3;color:#a16207;padding:2px 8px;border-radius:20px;margin-left:4px">${warnings} анхааруулга</span>` : ""}
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Төрөл</th><th>Тоолуур</th><th>Мэдэгдэл</th></tr></thead>
              <tbody>
                ${checks.map(c => `<tr>
                  <td>${sevBadge(c.severity)}</td>
                  <td style="font-family:monospace;font-size:12px">${c.meter_no||"—"}</td>
                  <td style="font-size:12px;color:#374151">${c.message}</td>
                </tr>`).join("")}
              </tbody>
            </table>
          </div>
        </div>` : `<div style="color:#16a34a;font-weight:600;margin-bottom:16px">✅ Шалгалт цэвэр — алдаа анхааруулга байхгүй</div>`}

        <div style="display:flex;gap:10px;margin-top:8px">
          <button class="btn" onclick="el_confirm(${JSON.stringify(JSON.stringify(data))})">✅ Баталгаажуулах</button>
          <button class="btn secondary" onclick="sl_bills()">← Буцах</button>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <div style="font-weight:600;font-size:13px;color:#1e293b">📊 Нормалчилсан мөрүүд (${(normRows||[]).length} тоолуур)</div>
      </div>
      <div class="panel-body" style="padding:0">
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>Тоолуур №</th><th>Байршил</th><th>Өмчлөл</th>
              <th>Өмнөх</th><th>Одоогийн</th><th>кВт.ц</th><th>Дүн</th>
            </tr></thead>
            <tbody>
              ${(normRows||[]).map(r => `<tr>
                <td style="font-family:monospace;font-size:12px">${r.meter_no}</td>
                <td style="font-size:12px;color:#64748b">${r.location||"—"}</td>
                <td>${ownerBadge(r.owner_status)}</td>
                <td style="text-align:right">${r.prev_reading?.toFixed(4)||"—"}</td>
                <td style="text-align:right">${r.curr_reading?.toFixed(4)||"—"}</td>
                <td style="text-align:right;font-weight:600">${(r.usage_kwh||0).toFixed(3)}</td>
                <td style="text-align:right">${fmt(r.amount)} ₮</td>
              </tr>`).join("")}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>`;

  window._el_preview_data = data;
}

async function el_confirm(dataJson) {
  let data;
  try { data = typeof dataJson === "string" ? JSON.parse(dataJson) : dataJson; }
  catch(e) { data = window._el_preview_data; }

  const yr = document.getElementById("override_year");
  const mo = document.getElementById("override_month");
  if (yr && mo) {
    data = { ...data, meta: { ...data.meta, billing_year: +yr.value, billing_month: +mo.value } };
  }

  if (!data.meta.billing_year || !data.meta.billing_month) {
    toast("⚠️ Жил, сарыг заавал оруулна уу"); return;
  }

  try {
    await post("/api/el-import/confirm", data);
    toast("✅ Нэхэмжлэл баталгаажлаа");
    sl_bills();
  } catch(e) { toast("⚠️ " + e.message); }
}

async function el_bill_delete(id) {
  if (!confirm("Энэ нэхэмжлэлийг бүх өгөгдлийн хамт устгах уу?")) return;
  try {
    await del_(`/api/eb/${id}`);
    toast("Устгагдлаа ✓");
    sl_bills();
  } catch(e) { toast("⚠️ " + e.message); }
}

// ── Budget Plan (Төлөвлөгөө) ─────────────────────────────────────
async function sl_budget() {
  main.innerHTML = `<div class="text-center py-5"><div class="spinner-border text-primary"></div></div>`;
  let plans = [];
  try { plans = await api("/api/el-budget"); } catch(e) {}

  const curYear = new Date().getFullYear();
  const MONTHS = ["1-р","2-р","3-р","4-р","5-р","6-р","7-р","8-р","9-р","10-р","11-р","12-р"];

  function diffClass(plan, act) {
    if (!act) return "";
    return act > plan ? "text-danger" : "text-success";
  }
  function diffIcon(plan, act) {
    if (!act) return "";
    return act > plan ? "▲" : "▼";
  }

  function planTable(p) {
    const months = Array.from({length:12},(_,i) => i+1);
    const totalPlan = months.reduce((s,m) => s + (p[`m${m}`]||0), 0);
    // Only compare months where actual data exists
    const actMonths = months.filter(m => p.actuals?.[m] != null);
    const totalAct      = actMonths.reduce((s,m) => s + (p.actuals[m]||0), 0);
    const totalPlanComp = actMonths.reduce((s,m) => s + (p[`m${m}`]||0), 0);
    const totalDiff = totalAct - totalPlanComp;

    const rows = months.map(m => {
      const plan = p[`m${m}`] || 0;
      const act  = p.actuals?.[m] || null;
      const diff = act !== null ? act - plan : null;
      const pct  = act !== null && plan > 0 ? (act / plan) * 100 : null;
      const over = pct !== null && pct > 100;
      const pctColor = pct === null ? "#94a3b8" : over ? "#dc2626" : "#16a34a";
      const pctBg    = pct === null ? "#f8fafc"  : over ? "#fee2e2"  : "#dcfce7";
      const barW     = pct !== null ? Math.min(pct, 130).toFixed(0) : 0;
      return `<tr>
        <td style="font-size:12px;color:#374151;font-weight:500">${MONTHS[m-1]}</td>
        <td style="text-align:right;font-size:12px;color:#374151">${fmt(plan)}</td>
        <td style="text-align:right;font-size:12px;font-weight:${act !== null ? 700 : 400};color:${act === null ? "#94a3b8" : over ? "#dc2626" : "#16a34a"}">
          ${act !== null ? fmt(Math.round(act)) : "—"}
        </td>
        <td style="text-align:right;font-size:12px;color:${diff === null ? "#94a3b8" : diff > 0 ? "#dc2626" : "#16a34a"}">
          ${diff !== null ? `${diff > 0 ? "+" : ""}${fmt(Math.round(diff))}` : "—"}
        </td>
        <td style="min-width:110px">
          ${pct !== null ? `
          <div style="display:flex;align-items:center;gap:6px">
            <div style="flex:1;height:6px;background:#f1f5f9;border-radius:4px;overflow:hidden">
              <div style="width:${Math.min(pct,100).toFixed(0)}%;height:100%;background:${over?"#dc2626":"#16a34a"};border-radius:4px"></div>
            </div>
            <span style="font-size:11px;font-weight:700;color:${pctColor};background:${pctBg};padding:1px 6px;border-radius:8px;white-space:nowrap">${pct.toFixed(1)}%</span>
          </div>` : `<span style="color:#94a3b8;font-size:12px">—</span>`}
        </td>
      </tr>`;
    }).join("");

    const totalPct = totalAct > 0 && totalPlanComp > 0 ? (totalAct / totalPlanComp) * 100 : null;
    const totalOver = totalPct !== null && totalPct > 100;

    return `
    <div class="panel" style="margin-bottom:18px">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 18px;border-bottom:1px solid #e2e6ed;background:linear-gradient(135deg,#1d4ed8,#2563eb);border-radius:10px 10px 0 0">
        <div>
          <div style="font-size:14px;font-weight:800;color:#fff">${p.year} он — ${p.name}</div>
          <div style="font-size:11px;color:rgba(255,255,255,.7);margin-top:1px">${p.budget_code || ""}</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          ${totalPct !== null ? `<div style="background:rgba(255,255,255,.15);border-radius:8px;padding:5px 12px;text-align:center">
            <div style="font-size:16px;font-weight:800;color:${totalOver?"#fca5a5":"#86efac"}">${totalPct.toFixed(1)}%</div>
            <div style="font-size:9px;color:rgba(255,255,255,.7)">нийт гүйцэтгэл</div>
          </div>` : ""}
          ${canEdit() ? `<button onclick="sl_budget_delete(${p.id},${p.year})" style="background:rgba(255,255,255,.15);border:none;color:#fff;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:11px">🗑 Устгах</button>` : ""}
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Сар</th>
            <th style="text-align:right">Төлөвлөгөө ₮</th>
            <th style="text-align:right">Гүйцэтгэл ₮</th>
            <th style="text-align:right">Зөрүү ₮</th>
            <th>Гүйцэтгэлийн хувь</th>
          </tr></thead>
          <tbody>${rows}</tbody>
          <tbody>
            <tr style="background:#f8fafc;font-weight:700;border-top:2px solid #e2e6ed">
              <td style="font-size:12px;color:#1d4ed8">НИЙТ</td>
              <td style="text-align:right;font-size:12px">
                ${fmt(Math.round(totalPlan))}
                ${actMonths.length < 12 ? `<div style="font-size:10px;color:#94a3b8;font-weight:400">${actMonths.length} сарын харьцуулалт: ${fmt(Math.round(totalPlanComp))}</div>` : ""}
              </td>
              <td style="text-align:right;font-size:12px;color:${totalAct > 0 ? (totalOver ? "#dc2626" : "#16a34a") : "#94a3b8"}">
                ${totalAct > 0 ? fmt(Math.round(totalAct)) : "—"}
              </td>
              <td style="text-align:right;font-size:12px;color:${totalDiff > 0 ? "#dc2626" : totalDiff < 0 ? "#16a34a" : "#94a3b8"}">
                ${totalAct > 0 ? `${totalDiff > 0 ? "+" : ""}${fmt(Math.round(totalDiff))}` : "—"}
              </td>
              <td>
                ${totalPct !== null ? `
                <div style="display:flex;align-items:center;gap:6px">
                  <div style="flex:1;height:7px;background:#f1f5f9;border-radius:4px;overflow:hidden">
                    <div style="width:${Math.min(totalPct,100).toFixed(0)}%;height:100%;background:${totalOver?"#dc2626":"#16a34a"};border-radius:4px"></div>
                  </div>
                  <span style="font-size:12px;font-weight:800;color:${totalOver?"#dc2626":"#16a34a"}">${totalPct.toFixed(1)}%</span>
                </div>` : `<span style="color:#94a3b8;font-size:12px">—</span>`}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>`;
  }

  main.innerHTML = `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;flex-wrap:wrap;gap:10px">
    <div>
      <h1 style="margin:0 0 3px;font-size:20px;font-weight:800;letter-spacing:-.02em">📊 Цахилгааны зардлын төлөвлөгөө</h1>
      <div style="font-size:12px;color:#667085">Төлөвлөгөө vs. Гүйцэтгэл харьцуулалт · Гэрэлтүүлгийн цахилгааны зардал</div>
    </div>
    ${canEdit() ? `<button class="btn" style="padding:7px 16px;font-size:12px" onclick="sl_budget_show_form()">+ Төлөвлөгөө оруулах</button>` : ""}
  </div>

  <div id="budgetFormArea"></div>

  ${plans.length ? plans.map(planTable).join("") : `
    <div class="panel" style="padding:50px;text-align:center">
      <div style="font-size:40px;margin-bottom:12px">📋</div>
      <div style="font-size:14px;color:#64748b;margin-bottom:16px">Төлөвлөгөө оруулаагүй байна</div>
      ${canEdit() ? `<button class="btn" onclick="sl_budget_show_form()">+ Төлөвлөгөө оруулах</button>` : ""}
    </div>`}`;
}

function sl_budget_show_form(p) {
  const curYear = new Date().getFullYear();
  const MONTHS = ["1-р сар","2-р сар","3-р сар","4-р сар","5-р сар","6-р сар",
                  "7-р сар","8-р сар","9-р сар","10-р сар","11-р сар","12-р сар"];
  const monthInputs = MONTHS.map((label, i) => {
    const m = i + 1;
    return `<div class="col-md-2 col-4">
      <label class="form-label small">${label}</label>
      <input type="number" id="bm${m}" class="form-control form-control-sm" step="0.01"
        value="${p ? (p[`m${m}`]||0) : 0}" oninput="sl_budget_calc_total()">
    </div>`;
  }).join("");

  document.getElementById("budgetFormArea").innerHTML = `
  <div class="card mb-4 border-primary">
    <div class="card-header bg-primary text-white fw-bold">
      ${p ? `${p.year} оны төлөвлөгөө засах` : "Шинэ төлөвлөгөө оруулах"}
    </div>
    <div class="card-body">
      <div class="row g-2 mb-3">
        <div class="col-md-2">
          <label class="form-label small">Жил *</label>
          <input type="number" id="bYear" class="form-control form-control-sm"
            value="${p ? p.year : curYear}" min="2020" max="2099" ${p ? "readonly" : ""}>
        </div>
        <div class="col-md-2">
          <label class="form-label small">Төсвийн код</label>
          <input type="text" id="bCode" class="form-control form-control-sm"
            value="${p ? p.budget_code : "210301"}">
        </div>
        <div class="col-md-4">
          <label class="form-label small">Нэр</label>
          <input type="text" id="bName" class="form-control form-control-sm"
            value="${p ? p.name : "Гэрэл цахилгаан"}">
        </div>
        <div class="col-md-2">
          <label class="form-label small">Нийт дүн</label>
          <div id="bTotal" class="form-control form-control-sm bg-light fw-bold text-primary" style="cursor:default">0</div>
        </div>
      </div>
      <div class="row g-2 mb-3">${monthInputs}</div>
      <div class="d-flex gap-2">
        <button class="btn btn-primary btn-sm" onclick="sl_budget_save()">Хадгалах</button>
        <button class="btn btn-secondary btn-sm" onclick="document.getElementById('budgetFormArea').innerHTML=''">Болих</button>
      </div>
    </div>
  </div>`;

  sl_budget_calc_total();
}

function sl_budget_calc_total() {
  let total = 0;
  for (let m = 1; m <= 12; m++) {
    total += parseFloat(document.getElementById(`bm${m}`)?.value || 0);
  }
  const el = document.getElementById("bTotal");
  if (el) el.textContent = fmt(Math.round(total));
}

async function sl_budget_save() {
  const year = parseInt(document.getElementById("bYear")?.value);
  if (!year) { toast("Жил оруулна уу"); return; }
  const body = {
    year,
    budget_code: document.getElementById("bCode")?.value || "210301",
    name:        document.getElementById("bName")?.value || "Гэрэл цахилгаан",
  };
  for (let m = 1; m <= 12; m++) {
    body[`m${m}`] = parseFloat(document.getElementById(`bm${m}`)?.value || 0);
  }
  try {
    await post("/api/el-budget", body);
    toast("✅ Төлөвлөгөө хадгалагдлаа");
    sl_budget();
  } catch(e) { toast("⚠️ " + e.message); }
}

async function sl_budget_delete(id, year) {
  if (!confirm(`${year} оны төлөвлөгөөг устгах уу?`)) return;
  try {
    await del_(`/api/el-budget/${id}`);
    toast("Устгагдлаа");
    sl_budget();
  } catch(e) { toast("⚠️ " + e.message); }
}

// ══════════════════════════════════════════════════════════════
// ГЭР ХОРООЛЛЫН ГЭРЭЛТҮҮЛГИЙН БҮРТГЭЛ — UI
// ══════════════════════════════════════════════════════════════

let _gerData = [];
let _gerCtx  = {};   // current modal context: { id, row }

function gerOverlay() { return document.getElementById("gerOverlay"); }

function gerShowOverlay(html) {
  const ov = gerOverlay();
  if (!ov) return;
  ov.innerHTML = html;
  ov.style.display = "flex";
}

function gerCloseOverlay() {
  const ov = gerOverlay();
  if (ov) ov.style.display = "none";
}

function gerCard(html) {
  return `<div style="background:#fff;border-radius:14px;width:100%;max-width:520px;
    box-shadow:0 20px 60px rgba(0,0,0,.22);overflow:hidden">${html}</div>`;
}

function gerHeader(title) {
  return `<div style="padding:16px 20px;border-bottom:1px solid #f1f5f9;
    display:flex;align-items:center;justify-content:space-between">
    <div style="font-weight:700;font-size:15px">${title}</div>
    <button onclick="gerCloseOverlay()" style="background:none;border:none;font-size:18px;
      color:#94a3b8;cursor:pointer;line-height:1">✕</button>
  </div>`;
}

async function sl_ger_list() {
  main.innerHTML = `<div style="text-align:center;padding:48px 0"><div class="spinner"></div></div>`;
  let stats, data, points;
  try {
    [stats, data, points] = await Promise.all([
      api("/api/sl-ger-stats"),
      api("/api/sl-ger-inventory"),
      api("/api/sl-points"),
    ]);
  } catch(e) { main.innerHTML = `<div class="alert">${e.message}</div>`; return; }

  _gerData = data;
  window._slPointsForGer = points;
  const bags = [...new Set(data.map(r => r.bag_no).filter(Boolean))].sort((a,b)=>a-b);
  const brokenTotal = stats.total_broken ?? 0;

  main.innerHTML = `
    <div id="gerOverlay" onclick="if(event.target===this)gerCloseOverlay()"
      style="display:none;position:fixed;inset:0;background:rgba(15,23,42,.45);
      z-index:1000;overflow-y:auto;align-items:flex-start;justify-content:center;padding:40px 16px"></div>

    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h5 style="margin:0">🏘️ Гэр хороолол / Цамхагийн гэрэлтүүлгийн бүртгэл</h5>
      <button class="btn" onclick="gerOpenAdd(0)" style="background:#16a34a;color:#fff;font-size:13px">+ Байршил нэмэх</button>
    </div>

    <div class="row" style="margin-bottom:16px">
      <div class="col" style="text-align:center;padding:12px;background:#eff6ff;border-radius:10px">
        <div style="font-size:22px;font-weight:800;color:#2563eb">${stats.total_ger ?? 0}</div>
        <div class="muted small">Гэр хорооллын гэрэл</div>
      </div>
      <div class="col" style="text-align:center;padding:12px;background:#fffbeb;border-radius:10px">
        <div style="font-size:22px;font-weight:800;color:#d97706">${stats.total_camhag ?? 0}</div>
        <div class="muted small">Цамхаг / прожектор</div>
      </div>
      <div class="col" style="text-align:center;padding:12px;background:#f0fdf4;border-radius:10px">
        <div style="font-size:22px;font-weight:800;color:#16a34a">${data.length}</div>
        <div class="muted small">Нийт байршил</div>
      </div>
      <div class="col" style="text-align:center;padding:12px;background:${brokenTotal>0?"#fef2f2":"#f8fafc"};border-radius:10px">
        <div style="font-size:22px;font-weight:800;color:${brokenTotal>0?"#dc2626":"#94a3b8"}">${brokenTotal}</div>
        <div class="muted small">Эвдэрсэн (сүүлийн тооллого)</div>
      </div>
    </div>

    <div class="row" style="margin-bottom:12px;gap:8px">
      <div class="col">
        <select class="input" id="gerCatFilter" onchange="gerApplyFilter()">
          <option value="">-- Бүх төрөл --</option>
          <option value="Гэр хороолол">🏘️ Гэр хороолол</option>
          <option value="Цамхаг">🗼 Цамхаг / прожектор</option>
        </select>
      </div>
      <div class="col">
        <select class="input" id="gerBagFilter" onchange="gerApplyFilter()">
          <option value="">-- Бүх баг --</option>
          ${bags.map(b=>`<option value="${b}">${b}-р баг</option>`).join("")}
        </select>
      </div>
      <div class="col">
        <input class="input" id="gerSearch" placeholder="🔍 Байршлаар хайх..." oninput="gerApplyFilter()">
      </div>
    </div>

    <div id="gerTableWrap"></div>
  `;

  gerRenderTable(_gerData);
}

function gerApplyFilter() {
  const cat    = document.getElementById("gerCatFilter")?.value || "";
  const bag    = document.getElementById("gerBagFilter")?.value || "";
  const search = (document.getElementById("gerSearch")?.value || "").toLowerCase();
  const filtered = _gerData.filter(r => {
    if (cat && r.category !== cat) return false;
    if (bag && String(r.bag_no) !== bag) return false;
    if (search && !r.location_name.toLowerCase().includes(search)) return false;
    return true;
  });
  gerRenderTable(filtered);
}

function gerRenderTable(rows) {
  const wrap = document.getElementById("gerTableWrap");
  if (!wrap) return;
  if (!rows.length) {
    wrap.innerHTML = `<div class="alert" style="text-align:center">Мэдээлэл олдсонгүй</div>`;
    return;
  }
  wrap.innerHTML = `
    <div style="overflow-x:auto">
      <table>
        <thead><tr>
          <th>Баг</th><th>Байршил</th><th>Төрөл</th>
          <th style="text-align:center">Шонгийн тоо</th>
          <th style="text-align:center">Толгойн тоо</th>
          <th style="text-align:center">Эвдэрсэн</th>
          <th>Тоолуур цэг</th><th>Сүүлийн тооллого</th>
          <th style="text-align:center">Үйлдэл</th>
        </tr></thead>
        <tbody>
          ${rows.map(r => {
            const isCamhag = r.category === "Цамхаг";
            const catBadge = isCamhag
              ? `<span class="badge" style="background:#f59e0b">🗼 Цамхаг</span>`
              : `<span class="badge">🏘️ Гэр хороолол</span>`;
            const brokenCell = r.last_broken > 0
              ? `<span class="badge" style="background:#dc2626">${r.last_broken}</span>`
              : `<span class="muted">0</span>`;
            const pointCell = r.sl_point_id
              ? `<span class="badge" style="background:#16a34a">${r.point_name || "Цэг #"+r.sl_point_id}</span>`
              : `<button class="btn" style="font-size:12px;padding:2px 8px" onclick="gerLinkPoint(${r.id})">🔗 холбох</button>`;
            const lastInspect = r.last_inspect
              ? `<span class="small">${r.last_inspect.slice(0,10)}</span>`
              : `<span class="muted">—</span>`;
            // Гэр хороолол: total_count = шонгийн тоо (1 шон = 1 толгой)
            // Цамхаг: нэг мөр = 1 шон, total_count = толгойн тоо
            const poleCell = isCamhag
              ? `<td style="text-align:center;color:#64748b;font-size:12px">1</td>`
              : `<td style="text-align:center;font-weight:600">${r.total_count}</td>`;
            const headCell = isCamhag
              ? `<td style="text-align:center;font-weight:700;color:#d97706">${r.total_count}</td>`
              : `<td style="text-align:center;font-weight:700;color:#0ea5e9">${r.total_count}</td>`;
            return `<tr>
              <td>${r.bag_no ?? "—"}</td>
              <td>${r.location_name}</td>
              <td>${catBadge}</td>
              ${poleCell}
              ${headCell}
              <td style="text-align:center">${brokenCell}</td>
              <td>${pointCell}</td>
              <td>${lastInspect}</td>
              <td style="text-align:center">
                <button class="btn" style="font-size:13px;padding:3px 8px;margin:1px" title="Тооллого бүртгэх" onclick="gerAddInspect(${r.id})">📝</button>
                <button class="btn" style="font-size:13px;padding:3px 8px;margin:1px;background:#475569" title="Засварын түүх" onclick="gerViewWorks(${r.id})">📋</button>
                <button class="btn" style="font-size:13px;padding:3px 8px;margin:1px;background:#d97706" title="Засах" onclick="gerOpenAdd(${r.id})">✏️</button>
              </td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
    <div class="muted small" style="text-align:right;margin-top:6px">${rows.length} байршил харагдаж байна</div>
  `;
}

function gerAddInspect(id) {
  _gerCtx.id = id;
  const row = _gerData.find(r => r.id === id);
  const now = new Date();
  const quarter = Math.ceil((now.getMonth()+1)/3);
  gerShowOverlay(gerCard(`
    ${gerHeader("📝 Тооллого бүртгэх")}
    <div style="padding:20px">
      <div class="muted small" style="margin-bottom:12px;font-weight:600">${row?.location_name || ""}</div>
      <div class="row">
        <div class="col">
          <div class="small muted">Жил</div>
          <input type="number" id="giYear" class="input" value="${now.getFullYear()}">
        </div>
        <div class="col">
          <div class="small muted">Улирал</div>
          <select id="giQuarter" class="input">
            ${[1,2,3,4].map(q=>`<option value="${q}" ${q===quarter?"selected":""}>${q}-р улирал</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="small muted" style="margin-top:10px">Тооллогын огноо</div>
      <input type="date" id="giDate" class="input" value="${now.toISOString().slice(0,10)}">
      <div class="row" style="margin-top:10px">
        <div class="col">
          <div class="small muted">Нийт тоо</div>
          <input type="number" id="giTotal" class="input" min="0" value="${row?.total_count ?? 0}">
        </div>
        <div class="col">
          <div class="small muted">Эвдэрсэн тоо</div>
          <input type="number" id="giBroken" class="input" min="0" value="0">
        </div>
      </div>
      <div class="small muted" style="margin-top:10px">Тэмдэглэл</div>
      <textarea id="giNote" class="input" rows="2" style="resize:vertical"></textarea>
      <div style="display:flex;gap:8px;margin-top:16px">
        <button class="btn" style="flex:1" onclick="gerSaveInspect()">Хадгалах</button>
        <button class="btn" style="flex:1;background:#64748b" onclick="gerCloseOverlay()">Болих</button>
      </div>
    </div>
  `));
}

async function gerSaveInspect() {
  const id      = _gerCtx.id;
  const year    = parseInt(document.getElementById("giYear")?.value);
  const quarter = parseInt(document.getElementById("giQuarter")?.value);
  const date    = document.getElementById("giDate")?.value;
  const total   = parseInt(document.getElementById("giTotal")?.value || "0");
  const broken  = parseInt(document.getElementById("giBroken")?.value || "0");
  const note    = document.getElementById("giNote")?.value || "";

  if (!year || !quarter || !date) { toast("Жил, улирал, огноо заавал оруулна уу"); return; }
  if (broken > total && total > 0) { toast("Эвдэрсэн тоо нийт тооноос их байж болохгүй"); return; }

  try {
    await post("/api/sl-inspections", { inventory_id: id, year, quarter, inspect_date: date, total_count: total, broken_count: broken, note });
    toast("✅ Тооллого бүртгэгдлээ");
    gerCloseOverlay();
    sl_ger_list();
  } catch(e) { toast("⚠️ " + e.message); }
}

async function gerViewWorks(id) {
  const row = _gerData.find(r => r.id === id);
  gerShowOverlay(gerCard(`
    ${gerHeader("📋 Засварын түүх — " + (row?.location_name || ""))}
    <div style="padding:20px" id="gerWorksBody">
      <div style="text-align:center"><div class="spinner"></div></div>
    </div>
  `));
  try {
    const works = await api(`/api/sl-ger-works/${id}`);
    const body = document.getElementById("gerWorksBody");
    if (!body) return;
    if (!works.length) {
      body.innerHTML = `<div class="muted" style="text-align:center;padding:24px">Засварын бүртгэл олдсонгүй</div>`;
      return;
    }
    body.innerHTML = `
      <table>
        <thead><tr><th>Огноо</th><th>Ажил</th><th>Төлөв</th><th>Хариуцагч</th></tr></thead>
        <tbody>${works.map(w=>`
          <tr>
            <td>${w.work_date || "—"}</td>
            <td>${w.title}</td>
            <td>${w.status || "—"}</td>
            <td>${w.assigned_name || "—"}</td>
          </tr>`).join("")}
        </tbody>
      </table>`;
  } catch(e) {
    const body = document.getElementById("gerWorksBody");
    if (body) body.innerHTML = `<div class="alert">${e.message}</div>`;
  }
}

function gerLinkPoint(id) {
  _gerCtx.id = id;
  const points = window._slPointsForGer || [];
  gerShowOverlay(gerCard(`
    ${gerHeader("🔗 Тоолуур цэгтэй холбох")}
    <div style="padding:20px">
      <div class="small muted" style="margin-bottom:10px">Энэ байршилтай холбогдох тоолуур цэгийг сонгоно уу.</div>
      <select id="gerLinkSelect" class="input">
        <option value="">-- Цэг сонгох --</option>
        ${points.map(p=>`<option value="${p.id}">${p.code}${p.meter_no?" ("+p.meter_no+")":""} — ${p.name||p.location||"байршил тодорхойгүй"}</option>`).join("")}
      </select>
      <div style="display:flex;gap:8px;margin-top:16px">
        <button class="btn" style="flex:1" onclick="gerSaveLink()">Холбох</button>
        <button class="btn" style="flex:1;background:#64748b" onclick="gerCloseOverlay()">Болих</button>
      </div>
    </div>
  `));
}

async function gerSaveLink() {
  const id   = _gerCtx.id;
  const slId = document.getElementById("gerLinkSelect")?.value;
  if (!slId) { toast("Цэг сонгоно уу"); return; }
  const row = _gerData.find(r => r.id === id);
  if (!row) { toast("Байршил олдсонгүй"); return; }
  try {
    await put_(`/api/sl-ger-inventory/${id}`, {
      location_name: row.location_name,
      bag_no:        row.bag_no,
      category:      row.category,
      total_count:   row.total_count,
      head_count:    row.head_count || 0,
      light_type:    row.light_type || "",
      notes:         row.notes || "",
      sl_point_id:   parseInt(slId),
    });
    toast("✅ Холбогдлоо");
    gerCloseOverlay();
    sl_ger_list();
  } catch(e) { toast("⚠️ " + e.message); }
}

function gerOpenAdd(id) {
  _gerCtx.id = id || null;
  const row = id ? _gerData.find(r => r.id === id) : null;
  gerShowOverlay(gerCard(`
    ${gerHeader(id ? "✏️ Байршил засах" : "➕ Байршил нэмэх")}
    <div style="padding:20px">
      <div class="row">
        <div class="col">
          <div class="small muted">Баг дугаар</div>
          <input type="number" id="gaoBag" class="input" min="1" value="${row?.bag_no ?? ""}">
        </div>
        <div class="col">
          <div class="small muted">Төрөл</div>
          <select id="gaoCat" class="input" onchange="gerToggleHeadField()">
            <option value="Гэр хороолол" ${(!row||row.category==="Гэр хороолол")?"selected":""}>🏘️ Гэр хороолол</option>
            <option value="Цамхаг" ${row?.category==="Цамхаг"?"selected":""}>🗼 Цамхаг / прожектор</option>
          </select>
        </div>
      </div>
      <div class="small muted" style="margin-top:10px">Байршлын нэр *</div>
      <input type="text" id="gaoName" class="input" value="${row?.location_name ?? ""}">
      <div class="row" style="margin-top:10px">
        <div class="col">
          <div class="small muted" id="gaoTotalLabel">${row?.category==="Цамхаг"?"Толгойн тоо (1 шон дээр)":"Нийт гэрлийн тоо"}</div>
          <input type="number" id="gaoTotal" class="input" min="0" value="${row?.total_count ?? 0}">
        </div>
      </div>
      <div class="row" style="margin-top:10px">
        <div class="col">
          <div class="small muted">Гэрлийн төрөл</div>
          <input type="text" id="gaoType" class="input" placeholder="ЛЕД, натри..." value="${row?.light_type ?? ""}">
        </div>
      </div>
      <div class="small muted" style="margin-top:10px">Тэмдэглэл</div>
      <textarea id="gaoNotes" class="input" rows="2" style="resize:vertical">${row?.notes ?? ""}</textarea>
      <div style="display:flex;gap:8px;margin-top:16px">
        <button class="btn" style="flex:1" onclick="gerDoAdd()">Хадгалах</button>
        <button class="btn" style="flex:1;background:#64748b" onclick="gerCloseOverlay()">Болих</button>
      </div>
    </div>
  `));
}

function gerToggleHeadField() {
  const cat = document.getElementById("gaoCat")?.value;
  const lbl = document.getElementById("gaoTotalLabel");
  if (lbl) lbl.textContent = cat === "Цамхаг" ? "Толгойн тоо (1 шон дээр)" : "Нийт гэрлийн тоо";
}

async function gerDoAdd() {
  const name = document.getElementById("gaoName")?.value?.trim();
  if (!name) { toast("Байршлын нэр заавал оруулна уу"); return; }
  const category = document.getElementById("gaoCat")?.value || "Гэр хороолол";
  const body = {
    location_name: name,
    bag_no:        parseInt(document.getElementById("gaoBag")?.value || "0") || null,
    category,
    total_count:   parseInt(document.getElementById("gaoTotal")?.value || "0"),
    head_count:    0,
    light_type:    document.getElementById("gaoType")?.value || "",
    notes:         document.getElementById("gaoNotes")?.value || "",
  };
  try {
    if (_gerCtx.id) {
      await put_(`/api/sl-ger-inventory/${_gerCtx.id}`, body);
      toast("✅ Шинэчлэгдлээ");
    } else {
      await post("/api/sl-ger-inventory", body);
      toast("✅ Нэмэгдлээ");
    }
    gerCloseOverlay();
    sl_ger_list();
  } catch(e) { toast("⚠️ " + e.message); }
}

// ═══════════════════════════════════════════════════════════════
// ГЭМТЭЛ / ЗАСВАРЫН БҮРТГЭЛ
// ═══════════════════════════════════════════════════════════════

const FAULT_CATS = ["Гэр хорооллын гэрэл", "Авто замын гэрэл", "Цамхагийн гэрэл", "Гэрлэн дохио"];

let _faultData = [];       // cached faults
let _faultLocations = {};  // {cat: [{id, name, total_heads}]}

async function sl_faults() {
  const [faults, gerInv, slPts, signals] = await Promise.all([
    api("/api/sl-faults"),
    api("/api/sl-ger-inventory").catch(()=>[]),
    api("/api/sl-points").catch(()=>[]),
    api("/api/assets?category=Гэрлэн дохио").catch(()=>[]),
  ]);
  _faultData = faults;
  _faultLocations = {
    "Гэр хорооллын гэрэл": gerInv
      .filter(r=>r.category==="Гэр хороолол")
      .map(r=>({ id:r.id, name:r.location_name, total_heads:r.total_count, type:"ger" })),
    "Авто замын гэрэл": slPts
      .filter(r=>(r.code||"").startsWith("ГТ-"))
      .map(r=>({ id:r.id, name:r.name, total_heads:r.total_heads||r.lamp_count, type:"sl_point" })),
    "Цамхагийн гэрэл": gerInv
      .filter(r=>r.category==="Цамхаг")
      .map(r=>({ id:r.id, name:r.location_name, total_heads:r.total_count, type:"ger" })),
    "Гэрлэн дохио": signals
      .map(r=>({ id:r.id, name:r.name || r.asset_code, total_heads:1, type:"asset" })),
  };

  const byStatus = { "Нээлттэй":0, "Засварт":0, "Дууссан":0 };
  faults.forEach(f => { byStatus[f.status] = (byStatus[f.status]||0)+1; });
  const totalBroken = faults.filter(f=>f.status!=="Дууссан").reduce((s,f)=>s+(f.broken_count||0),0);

  const activeCat = window._faultCat || "Бүгд";

  main.innerHTML = `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;flex-wrap:wrap;gap:12px">
    <div>
      <h1 style="margin:0 0 4px;font-size:22px;font-weight:800;letter-spacing:-.02em">⚡ Гэмтэл / Засварын бүртгэл</h1>
      <div style="font-size:12px;color:#667085">Гэрэлтүүлгийн гэмтлийн тооллого · Засварын явц</div>
    </div>
    <button class="btn" onclick="faultOpenAdd()">+ Гэмтэл бүртгэх</button>
  </div>

  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:20px">
    ${[
      { key:"Бүгд",      icon:"📋", color:"#1d4ed8", bg:"#eff6ff", cnt: faults.length },
      { key:"Нээлттэй",  icon:"🔴", color:"#dc2626", bg:"#fef2f2", cnt: byStatus["Нээлттэй"]||0 },
      { key:"Засварт",   icon:"🟡", color:"#d97706", bg:"#fff7ed", cnt: byStatus["Засварт"]||0 },
      { key:"Дууссан",   icon:"🟢", color:"#16a34a", bg:"#f0fdf4", cnt: byStatus["Дууссан"]||0 },
    ].map(s => `<div onclick="faultSetFilter('${s.key}')" style="
      padding:12px 14px;border-radius:10px;cursor:pointer;
      background:${activeCat===s.key?s.color:s.bg};color:${activeCat===s.key?"#fff":s.color};
      border:2px solid ${activeCat===s.key?s.color:"transparent"};transition:all .15s">
      <div style="font-size:16px">${s.icon}</div>
      <div style="font-size:12px;font-weight:700;margin-top:2px">${s.key}</div>
      <div style="font-size:22px;font-weight:800">${s.cnt}</div>
    </div>`).join("")}
    <div style="padding:12px 14px;border-radius:10px;background:#fff7ed;border:2px solid transparent">
      <div style="font-size:16px">🔦</div>
      <div style="font-size:12px;font-weight:700;margin-top:2px;color:#d97706">Нийт асахгүй</div>
      <div style="font-size:22px;font-weight:800;color:#d97706">${totalBroken}</div>
      <div style="font-size:10px;color:#94a3b8">толгой</div>
    </div>
  </div>

  <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
    ${FAULT_CATS.map(c=>`<button onclick="faultSetCat('${c}')"
      style="padding:5px 14px;border-radius:20px;border:1px solid ${window._faultSubCat===c?'#2563eb':'#e2e6ed'};
      background:${window._faultSubCat===c?'#2563eb':'#fff'};color:${window._faultSubCat===c?'#fff':'#344054'};
      font-size:12px;cursor:pointer">${c}</button>`).join("")}
    ${window._faultSubCat?`<button onclick="faultSetCat('')" style="padding:5px 14px;border-radius:20px;border:1px solid #e2e6ed;background:#f1f5f9;color:#667085;font-size:12px;cursor:pointer">✕ Цэвэрлэх</button>`:""}
  </div>

  <div class="panel">
    <div style="padding:14px 18px;border-bottom:1px solid #e2e6ed;display:flex;align-items:center;justify-content:space-between">
      <div style="font-size:14px;font-weight:700">Гэмтлийн жагсаалт</div>
      <input placeholder="Хайх байршил..." oninput="faultFilter(this.value)"
        style="padding:6px 12px;border:1px solid #e2e6ed;border-radius:8px;font-size:12px;width:200px;outline:none">
    </div>
    <div class="table-wrap">
      <table id="faultTable">
        <thead><tr>
          <th style="width:36px">#</th>
          <th>Ангилал</th>
          <th>Байршил</th>
          <th style="text-align:center">Нийт толгой</th>
          <th style="text-align:center">Асахгүй</th>
          <th style="text-align:center">Засагдсан</th>
          <th style="text-align:center">Үлдсэн</th>
          <th>Огноо</th>
          <th style="text-align:center">Төлөв</th>
          <th style="text-align:center">Үйлдэл</th>
        </tr></thead>
        <tbody id="faultTbody">
          ${faultRows(faults, activeCat)}
        </tbody>
      </table>
    </div>
  </div>

  <div id="faultOverlay" style="display:none;position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:1000;align-items:flex-start;justify-content:center;padding-top:40px;overflow-y:auto"
    onclick="if(event.target===this)faultCloseOverlay()">
    <div id="faultOverlayInner" style="width:min(560px,96vw);margin:0 auto 40px"></div>
  </div>`;
}

function faultRows(faults, activeCat) {
  const subCat = window._faultSubCat || "";
  let list = faults;
  if (activeCat && activeCat !== "Бүгд") list = list.filter(f=>f.status===activeCat);
  if (subCat) list = list.filter(f=>f.category===subCat);
  if (!list.length) return `<tr><td colspan="10" style="text-align:center;color:#667085;padding:30px">Гэмтэл бүртгэгдээгүй байна</td></tr>`;

  const statusColor = { "Нээлттэй":"#dc2626", "Засварт":"#d97706", "Дууссан":"#16a34a" };
  const statusBg    = { "Нээлттэй":"#fef2f2", "Засварт":"#fff7ed", "Дууссан":"#f0fdf4" };
  return list.map((f,i)=>{
    const brokenLeft = f.broken_count;
    const pct = f.total_heads > 0 ? Math.round(f.fixed_count/f.total_heads*100) : 0;
    return `<tr data-loc="${(f.location_name||"").toLowerCase()}">
      <td style="color:#94a3b8;font-size:11px">${i+1}</td>
      <td style="font-size:11px;color:#667085">${f.category}</td>
      <td style="font-weight:600">${f.location_name}</td>
      <td style="text-align:center;font-size:13px">${f.total_heads}</td>
      <td style="text-align:center">
        <span style="background:#fef2f2;color:#dc2626;border-radius:12px;padding:2px 10px;font-weight:800;font-size:13px">${f.broken_count}</span>
      </td>
      <td style="text-align:center">
        <span style="background:#f0fdf4;color:#16a34a;border-radius:12px;padding:2px 10px;font-weight:700;font-size:13px">${f.fixed_count}</span>
      </td>
      <td style="text-align:center">
        ${brokenLeft > 0
          ? `<span style="background:#fff7ed;color:#d97706;border-radius:12px;padding:2px 10px;font-weight:700;font-size:13px">${brokenLeft}</span>`
          : `<span style="color:#16a34a;font-weight:700;font-size:12px">✓ Дууссан</span>`}
      </td>
      <td style="font-size:12px;color:#667085">${f.report_date||""}</td>
      <td style="text-align:center">
        <span style="font-size:10px;padding:2px 8px;border-radius:20px;background:${statusBg[f.status]||'#f1f5f9'};color:${statusColor[f.status]||'#475569'};font-weight:600">${f.status}</span>
      </td>
      <td style="text-align:center">
        <div style="display:flex;gap:4px;justify-content:center">
          ${f.status!=="Дууссан" ? `<button class="btn" style="padding:3px 10px;font-size:11px;background:#16a34a" onclick="faultOpenRepair(${f.id})">🔧 Засах</button>` : ""}
          <button class="btn secondary" style="padding:3px 8px;font-size:11px" onclick="faultViewHistory(${f.id})">📋</button>
          <button class="btn secondary" style="padding:3px 8px;font-size:11px;color:#dc2626" onclick="faultDelete(${f.id})">✕</button>
        </div>
      </td>
    </tr>`;
  }).join("");
}

function faultSetFilter(key) {
  window._faultCat = key;
  const tbody = document.getElementById("faultTbody");
  if (tbody) tbody.innerHTML = faultRows(_faultData, key);
  // Update button styles
  sl_faults();
}

function faultSetCat(cat) {
  window._faultSubCat = cat;
  sl_faults();
}

function faultFilter(val) {
  const v = val.toLowerCase();
  document.querySelectorAll("#faultTable tbody tr[data-loc]").forEach(tr=>{
    tr.style.display = (tr.dataset.loc||"").includes(v) ? "" : "none";
  });
}

function faultOverlay() { return document.getElementById("faultOverlay"); }
function faultCloseOverlay() {
  const ov = faultOverlay();
  if (ov) ov.style.display = "none";
}
function faultShowInner(html) {
  const ov = faultOverlay();
  if (!ov) return;
  document.getElementById("faultOverlayInner").innerHTML = html;
  ov.style.display = "flex";
}

async function faultOpenAdd() {
  const cat = window._faultSubCat || FAULT_CATS[0];
  const locs = _faultLocations[cat] || [];
  faultShowInner(`
  <div style="background:#fff;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.25)">
    <div style="padding:14px 20px;border-bottom:1px solid #e2e6ed;display:flex;align-items:center;justify-content:space-between;border-radius:14px 14px 0 0;background:#0f1623">
      <div style="font-size:15px;font-weight:800;color:#fff">⚡ Гэмтэл бүртгэх</div>
      <button onclick="faultCloseOverlay()" style="border:none;background:rgba(255,255,255,.1);color:#fff;border-radius:8px;padding:5px 12px;cursor:pointer">✕</button>
    </div>
    <div style="padding:20px">
      <div style="margin-bottom:12px">
        <div style="font-size:11px;color:#667085;margin-bottom:4px">Ангилал *</div>
        <select id="fa_cat" class="input" onchange="faultCatChange()" style="margin:0">
          ${FAULT_CATS.map(c=>`<option ${c===cat?"selected":""}>${c}</option>`).join("")}
        </select>
      </div>
      <div style="margin-bottom:12px">
        <div style="font-size:11px;color:#667085;margin-bottom:4px">Байршил *</div>
        <select id="fa_loc" class="input" onchange="faultLocChange()" style="margin:0">
          <option value="">— Сонгох —</option>
          ${locs.map(l=>`<option value="${l.id}" data-heads="${l.total_heads}" data-type="${l.type}">${l.name}</option>`).join("")}
        </select>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Нийт толгой</div>
          <input id="fa_total" type="number" class="input" style="margin:0" placeholder="0" oninput="faultCalcLeft()">
        </div>
        <div>
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Асахгүй толгой *</div>
          <input id="fa_broken" type="number" class="input" style="margin:0;border-color:#dc2626" placeholder="0" oninput="faultCalcLeft()">
        </div>
      </div>
      <div id="fa_preview" style="background:#fff7ed;border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:13px;color:#92400e;display:none"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Огноо</div>
          <input id="fa_date" type="date" class="input" style="margin:0" value="${new Date().toISOString().slice(0,10)}">
        </div>
        <div></div>
      </div>
      <div style="margin-bottom:16px">
        <div style="font-size:11px;color:#667085;margin-bottom:4px">Тэмдэглэл</div>
        <textarea id="fa_notes" class="input" style="margin:0;min-height:50px" placeholder="Нэмэлт мэдэгдэл..."></textarea>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn" onclick="faultSaveAdd()">Хадгалах</button>
        <button class="btn secondary" onclick="faultCloseOverlay()">Болих</button>
      </div>
    </div>
  </div>`);
}

function faultCatChange() {
  const cat = document.getElementById("fa_cat").value;
  const locs = _faultLocations[cat] || [];
  const sel = document.getElementById("fa_loc");
  if (!sel) return;
  sel.innerHTML = `<option value="">— Сонгох —</option>`
    + locs.map(l=>`<option value="${l.id}" data-heads="${l.total_heads}" data-type="${l.type}">${l.name}</option>`).join("");
  document.getElementById("fa_total").value = "";
  const prev = document.getElementById("fa_preview");
  if (prev) prev.style.display = "none";
}

function faultLocChange() {
  const sel = document.getElementById("fa_loc");
  const opt = sel?.selectedOptions[0];
  const heads = opt?.dataset.heads;
  if (heads) {
    document.getElementById("fa_total").value = heads;
    faultCalcLeft();
  }
}

function faultCalcLeft() {
  const total  = parseInt(document.getElementById("fa_total")?.value) || 0;
  const broken = parseInt(document.getElementById("fa_broken")?.value) || 0;
  const prev   = document.getElementById("fa_preview");
  if (!prev) return;
  if (total > 0 && broken > 0) {
    const working = total - broken;
    prev.style.display = "block";
    prev.innerHTML = `<b>${total}</b> толгойн <b style="color:#dc2626">${broken}</b> нь асахгүй байна &nbsp;·&nbsp; Ажиллаж байгаа: <b style="color:#16a34a">${working}</b>`;
  } else {
    prev.style.display = "none";
  }
}

async function faultSaveAdd() {
  const catEl   = document.getElementById("fa_cat");
  const locEl   = document.getElementById("fa_loc");
  const totalEl = document.getElementById("fa_total");
  const brokenEl= document.getElementById("fa_broken");
  const opt     = locEl?.selectedOptions[0];

  const cat    = catEl?.value || "";
  const locId  = locEl?.value || null;
  const locName= opt?.textContent?.trim() || "";
  const locType= opt?.dataset.type || null;
  const total  = parseInt(totalEl?.value) || 0;
  const broken = parseInt(brokenEl?.value) || 0;

  if (!cat)    { toast("Ангилал сонгоно уу"); return; }
  if (!locName){ toast("Байршил сонгоно уу"); return; }
  if (broken < 1){ toast("Асахгүй толгойн тоо оруулна уу"); return; }
  if (broken > total){ toast("Асахгүй тоо нийт толгойноос хэтэрч байна"); return; }

  try {
    await post("/api/sl-faults", {
      category: cat,
      location_id: locId ? parseInt(locId) : null,
      location_name: locName,
      location_type: locType,
      total_heads: total,
      broken_count: broken,
      report_date: document.getElementById("fa_date")?.value || null,
      notes: document.getElementById("fa_notes")?.value || null,
    });
    toast("Гэмтэл бүртгэгдлээ ✓");
    faultCloseOverlay();
    sl_faults();
  } catch(e) { toast("Алдаа: " + e.message); }
}

async function faultOpenRepair(faultId) {
  const fault = _faultData.find(f=>f.id===faultId);
  if (!fault) return;
  faultShowInner(`
  <div style="background:#fff;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.25)">
    <div style="padding:14px 20px;border-bottom:1px solid #e2e6ed;border-radius:14px 14px 0 0;background:#14532d;display:flex;align-items:center;justify-content:space-between">
      <div style="font-size:15px;font-weight:800;color:#fff">🔧 Засвар бүртгэх</div>
      <button onclick="faultCloseOverlay()" style="border:none;background:rgba(255,255,255,.1);color:#fff;border-radius:8px;padding:5px 12px;cursor:pointer">✕</button>
    </div>
    <div style="padding:20px">
      <div style="background:#f0fdf4;border-radius:10px;padding:12px 16px;margin-bottom:16px">
        <div style="font-size:12px;color:#16a34a;font-weight:700;margin-bottom:4px">${fault.location_name}</div>
        <div style="display:flex;gap:16px;font-size:13px">
          <span>Нийт: <b>${fault.total_heads}</b></span>
          <span style="color:#dc2626">Асахгүй: <b>${fault.broken_count}</b></span>
          <span style="color:#16a34a">Засагдсан: <b>${fault.fixed_count}</b></span>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Хэдэн толгой засагдав? *</div>
          <input id="fr_fixed" type="number" min="1" max="${fault.broken_count}" class="input" style="margin:0;border-color:#16a34a;font-size:18px;font-weight:800;color:#16a34a" placeholder="0" oninput="faultRepairPreview(${fault.broken_count})">
        </div>
        <div>
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Засварын огноо</div>
          <input id="fr_date" type="date" class="input" style="margin:0" value="${new Date().toISOString().slice(0,10)}">
        </div>
      </div>
      <div id="fr_preview" style="background:#f0fdf4;border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:13px;display:none"></div>
      <div style="margin-bottom:16px">
        <div style="font-size:11px;color:#667085;margin-bottom:4px">Тэмдэглэл</div>
        <textarea id="fr_notes" class="input" style="margin:0;min-height:50px" placeholder="Засварын дэлгэрэнгүй..."></textarea>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn" style="background:#16a34a" onclick="faultSaveRepair(${faultId},${fault.broken_count})">✓ Засвар хадгалах</button>
        <button class="btn secondary" onclick="faultCloseOverlay()">Болих</button>
      </div>
    </div>
  </div>`);
}

function faultRepairPreview(maxBroken) {
  const fixed = parseInt(document.getElementById("fr_fixed")?.value) || 0;
  const prev  = document.getElementById("fr_preview");
  if (!prev) return;
  if (fixed > 0) {
    const remaining = Math.max(0, maxBroken - fixed);
    prev.style.display = "block";
    prev.innerHTML = `<b style="color:#16a34a">${fixed}</b> толгой шинээр асна → Үлдсэн асахгүй: <b style="color:${remaining>0?'#d97706':'#16a34a'}">${remaining}</b>${remaining===0?" ✓ Бүгд засагдлаа":""}`;
  } else {
    prev.style.display = "none";
  }
}

async function faultSaveRepair(faultId, maxBroken) {
  const fixed = parseInt(document.getElementById("fr_fixed")?.value) || 0;
  if (fixed < 1) { toast("Засагдсан толгойн тоо оруулна уу"); return; }
  if (fixed > maxBroken) { toast(`Хамгийн ихдээ ${maxBroken} толгой засагдах боломжтой`); return; }
  try {
    const r = await post("/api/sl-fault-repairs", {
      fault_id: faultId,
      heads_fixed: fixed,
      repair_date: document.getElementById("fr_date")?.value || null,
      notes: document.getElementById("fr_notes")?.value || null,
    });
    toast(`${fixed} толгой шинээр асав ✓${r.newStatus==="Дууссан"?" — Гэмтэл бүрэн засагдлаа 🎉":""}`);
    faultCloseOverlay();
    sl_faults();
  } catch(e) { toast("Алдаа: " + e.message); }
}

async function faultViewHistory(faultId) {
  const fault = _faultData.find(f=>f.id===faultId);
  if (!fault) return;
  const repairs = await api(`/api/sl-fault-repairs/${faultId}`).catch(()=>[]);
  faultShowInner(`
  <div style="background:#fff;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.25)">
    <div style="padding:14px 20px;border-bottom:1px solid #e2e6ed;border-radius:14px 14px 0 0;background:#1e3a5f;display:flex;align-items:center;justify-content:space-between">
      <div style="font-size:15px;font-weight:800;color:#fff">📋 Засварын түүх — ${fault.location_name}</div>
      <button onclick="faultCloseOverlay()" style="border:none;background:rgba(255,255,255,.1);color:#fff;border-radius:8px;padding:5px 12px;cursor:pointer">✕</button>
    </div>
    <div style="padding:20px">
      <div style="display:flex;gap:16px;background:#f8f9fb;border-radius:10px;padding:12px 16px;margin-bottom:16px;font-size:13px">
        <span>${fault.category}</span>
        <span>Нийт: <b>${fault.total_heads}</b></span>
        <span style="color:#dc2626">Анхны гэмтэл: <b>${fault.broken_count + fault.fixed_count}</b></span>
        <span style="color:#16a34a">Засагдсан: <b>${fault.fixed_count}</b></span>
        <span style="color:${fault.broken_count>0?'#d97706':'#16a34a'}">Үлдсэн: <b>${fault.broken_count}</b></span>
      </div>
      ${repairs.length ? `
      <div style="position:relative;padding-left:22px">
        <div style="position:absolute;left:8px;top:0;bottom:0;width:2px;background:#e2e6ed"></div>
        ${repairs.map((r,i)=>`<div style="position:relative;margin-bottom:12px">
          <div style="position:absolute;left:-18px;top:8px;width:10px;height:10px;border-radius:50%;background:${i===0?'#16a34a':'#e2e6ed'};border:2px solid ${i===0?'#16a34a':'#94a3b8'}"></div>
          <div style="background:${i===0?'#f0fdf4':'#f8f9fb'};border:1px solid ${i===0?'#bbf7d0':'#e2e6ed'};border-radius:10px;padding:10px 14px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
              <span style="font-size:14px;font-weight:800;color:#16a34a">+${r.heads_fixed} толгой асав</span>
              <span style="font-size:11px;color:#94a3b8">${r.repair_date||r.created_at?.slice(0,10)}</span>
            </div>
            ${r.notes?`<div style="font-size:12px;color:#667085">${r.notes}</div>`:""}
            ${r.repaired_name?`<div style="font-size:11px;color:#94a3b8;margin-top:4px">👤 ${r.repaired_name}</div>`:""}
          </div>
        </div>`).join("")}
      </div>` : `<div style="text-align:center;padding:24px;color:#94a3b8">Засварын бүртгэл алга</div>`}
      ${fault.status!=="Дууссан"?`<div style="margin-top:12px"><button class="btn" style="background:#16a34a;width:100%" onclick="faultCloseOverlay();faultOpenRepair(${faultId})">🔧 Шинэ засвар нэмэх</button></div>`:""}
    </div>
  </div>`);
}

async function faultDelete(id) {
  if (!confirm("Энэ гэмтлийн бүртгэлийг устгах уу?")) return;
  try {
    await del_(`/api/sl-faults/${id}`);
    toast("Устгагдлаа ✓");
    sl_faults();
  } catch(e) { toast("Алдаа: " + e.message); }
}

Object.assign(window, {
  sl_dashboard, slHubTab, sl_points, sl_readings, sl_bills,
  slAnalyticsReload,
  sl_readings_for,
  sl_points_tab, sl_points_add, sl_points_edit, sl_points_save, sl_points_del,
  sl_points_filter, sl_points_toggle_all, sl_points_select_all, sl_points_deselect,
  sl_points_chk_change, sl_points_bootstrap, sl_points_bootstrap_run,
  sl_bulk_verify,
  el_preview, el_preview_upload, el_confirm, el_bill_delete, el_resolve,
  sl_budget, sl_budget_show_form, sl_budget_calc_total, sl_budget_save, sl_budget_delete,
  sl_ger_list, gerApplyFilter,
  gerAddInspect, gerSaveInspect, gerViewWorks,
  gerLinkPoint, gerSaveLink,
  gerOpenAdd, gerDoAdd, gerCloseOverlay, gerToggleHeadField,
  sl_faults, faultSetFilter, faultSetCat, faultFilter,
  faultOpenAdd, faultCatChange, faultLocChange, faultCalcLeft, faultSaveAdd,
  faultOpenRepair, faultRepairPreview, faultSaveRepair,
  faultViewHistory, faultDelete, faultCloseOverlay,
});
