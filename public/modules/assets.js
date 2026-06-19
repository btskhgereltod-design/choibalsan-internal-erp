import { state, api, toast, escapeHtml, today, API } from './common.js';

const SL_CATS = ["Авто замын гэрэл","Гэр хорооллын гэрэл","Цамхагийн гэрэл","Гэрлэн дохио","Шит/Самбар"];

const ASSET_CATEGORIES = [
  { id:"Авто замын гэрэл",     icon:"💡", color:"#f59e0b", bg:"#fffbeb", border:"#fde68a" },
  { id:"Гэр хорооллын гэрэл", icon:"🏘️", color:"#0ea5e9", bg:"#f0f9ff", border:"#bae6fd" },
  { id:"Цамхагийн гэрэл",     icon:"🗼", color:"#d97706", bg:"#fff7ed", border:"#fed7aa" },
  { id:"Камер",                icon:"🎥", color:"#3b82f6", bg:"#eff6ff", border:"#bfdbfe" },
  { id:"Шилэн кабель",         icon:"🧵", color:"#8b5cf6", bg:"#f5f3ff", border:"#ddd6fe" },
  { id:"Шит/Самбар",           icon:"⚡", color:"#ef4444", bg:"#fef2f2", border:"#fecaca" },
  { id:"Гэрлэн дохио",         icon:"🚦", color:"#10b981", bg:"#f0fdf4", border:"#bbf7d0" },
  { id:"Техник",               icon:"🚗", color:"#6366f1", bg:"#eef2ff", border:"#c7d2fe" },
  { id:"Барилга",              icon:"🏢", color:"#64748b", bg:"#f8fafc", border:"#e2e8f0" },
  { id:"Бусад",                icon:"📦", color:"#94a3b8", bg:"#f8fafc", border:"#e2e8f0" },
];

const ASSET_CONDITIONS = ["Хэвийн","Засвар хэрэгтэй","Хугацаа дууссан","Ашиглалтаас гарсан"];
const CAMERA_CONDITIONS = ["Засварлах","Хэвийн","Татан буулгах","Нүүлгэх"];
const ASSET_STATUSES   = ["Идэвхтэй","Идэвхгүй","Засварт","Нөөцөд"];
let _cameraAssetTab = "dashboard";
let _cameraAssetSearch = "";
let _cameraAssetBagFilter = "";
let _cameraConditionFilter = "";
let _fiberMap = null;
let _fiberRoutes = [];
let _fiberPoints = [];
let _fiberDrawMode = false;
let _fiberDrawPoints = [];
let _fiberDrawLayer = null;
let _fiberPointMode = false;
let _fiberGpsPickAssetId = "";
let _fiberGpsRows = [];
let _fiberCameraMoveMode = false;
let _fiberCameraMarkers = [];
let _fiberPointMarkers = [];
let _fiberCameraLayerVisible = true;

const FIBER_CORE_OPTIONS = [
  { core: 4, color: "#16a34a" },
  { core: 6, color: "#0ea5e9" },
  { core: 8, color: "#6366f1" },
  { core: 12, color: "#f59e0b" },
  { core: 24, color: "#ef4444" },
  { core: 48, color: "#7c3aed" },
  { core: 96, color: "#111827" },
];

const FIBER_POINT_TYPES = ["Муфт", "Холболтын хайрцаг", "ODF", "Кросс", "Splitter", "Бусад"];
const FIBER_SPLICE_COLORS = [
  { name: "Blue", color: "#2563eb" },
  { name: "Orange", color: "#f97316" },
  { name: "Green", color: "#16a34a" },
  { name: "Brown", color: "#92400e" },
  { name: "Slate", color: "#64748b" },
  { name: "White", color: "#f8fafc" },
  { name: "Red", color: "#ef4444" },
  { name: "Black", color: "#111827" },
  { name: "Yellow", color: "#eab308" },
  { name: "Violet", color: "#7c3aed" },
  { name: "Pink", color: "#db2777" },
  { name: "Aqua", color: "#06b6d4" }
];

const GER_CAT_MAP = {
  "Гэр хорооллын гэрэл": "Гэр хороолол",
  "Цамхагийн гэрэл":     "Цамхаг",
};

function gerSummaryBar(cat, rows, faultMap) {
  const totalCount  = rows.reduce((s,r) => s + (r.total_count||0), 0);
  const needsPoles  = rows.reduce((s,r) => s + (r.needs_poles||0), 0);
  const totalBroken = faultMap
    ? rows.reduce((s,r) => { const f = faultMap.get(r.id); return s + (f ? f.broken_count : 0); }, 0)
    : rows.reduce((s,r) => s + (r.last_broken||0), 0);
  const asaltPct   = totalCount > 0 ? ((totalCount - totalBroken) / totalCount * 100).toFixed(1) : "100.0";
  const asaltColor = parseFloat(asaltPct) >= 90 ? "#16a34a" : parseFloat(asaltPct) >= 70 ? "#d97706" : "#dc2626";
  const asaltBg    = parseFloat(asaltPct) >= 90 ? "#f0fdf4" : parseFloat(asaltPct) >= 70 ? "#fff7ed" : "#fef2f2";

  const asaltBox = `
    <div style="background:${asaltBg};border-radius:8px;padding:8px 16px;text-align:center;min-width:90px">
      <div style="font-size:20px;font-weight:800;color:${asaltColor}">${asaltPct}%</div>
      <div style="font-size:11px;color:#64748b">Асалтын хувь</div>
      ${totalBroken > 0 ? `<div style="font-size:10px;font-weight:700;color:#dc2626">${totalBroken} гэмтэл</div>` : `<div style="font-size:10px;color:#94a3b8">гэмтэлгүй</div>`}
    </div>`;

  if (cat === "Цамхагийн гэрэл") {
    return `<div style="display:flex;gap:12px;padding:12px 18px;border-bottom:1px solid #f1f5f9;flex-wrap:wrap">
      <div style="background:#f0f9ff;border-radius:8px;padding:8px 16px;text-align:center;min-width:90px">
        <div style="font-size:20px;font-weight:800;color:#0ea5e9">${rows.length}</div>
        <div style="font-size:11px;color:#64748b">Нийт шон</div>
      </div>
      <div style="background:#fff7ed;border-radius:8px;padding:8px 16px;text-align:center;min-width:90px">
        <div style="font-size:20px;font-weight:800;color:#d97706">${totalCount}</div>
        <div style="font-size:11px;color:#64748b">Нийт толгой</div>
      </div>
      ${needsPoles > 0 ? `<div style="background:#fff7ed;border-radius:8px;padding:8px 16px;text-align:center;min-width:90px">
        <div style="font-size:20px;font-weight:800;color:#d97706">${needsPoles}</div>
        <div style="font-size:11px;color:#64748b">Дутуу шон</div>
      </div>` : ""}
      ${asaltBox}
    </div>`;
  }
  return `<div style="display:flex;gap:12px;padding:12px 18px;border-bottom:1px solid #f1f5f9;flex-wrap:wrap">
    <div style="background:#f0f9ff;border-radius:8px;padding:8px 16px;text-align:center;min-width:90px">
      <div style="font-size:20px;font-weight:800;color:#0ea5e9">${rows.length}</div>
      <div style="font-size:11px;color:#64748b">Нийт байршил</div>
    </div>
    <div style="background:#eff6ff;border-radius:8px;padding:8px 16px;text-align:center;min-width:90px">
      <div style="font-size:20px;font-weight:800;color:#2563eb">${totalCount}</div>
      <div style="font-size:11px;color:#64748b">Нийт шон</div>
    </div>
    ${needsPoles > 0 ? `<div style="background:#fff7ed;border-radius:8px;padding:8px 16px;text-align:center;min-width:90px">
      <div style="font-size:20px;font-weight:800;color:#d97706">${needsPoles}</div>
      <div style="font-size:11px;color:#64748b">Дутуу шон</div>
    </div>` : ""}
    ${asaltBox}
  </div>`;
}

function slStatusLabel(status) {
  if (!status) return "—";
  if (status === "active" || status === "Идэвхтэй") return "Идэвхтэй";
  if (status === "inactive" || status === "Идэвхгүй") return "Идэвхгүй";
  return status;
}
function slIsActive(r) {
  return r.status === "active" || r.status === "Идэвхтэй";
}

function slSummaryBar(rows, faultMap) {
  const totalPoles  = rows.reduce((s,r) => s + (r.lamp_count||0), 0);
  const totalHeads  = rows.reduce((s,r) => s + (r.total_heads > 0 ? r.total_heads : (r.lamp_count||0)), 0);
  const needsPoles  = rows.reduce((s,r) => s + (r.needs_poles||0), 0);
  const activeCount = rows.filter(slIsActive).length;
  const activePct   = rows.length > 0 ? ((activeCount / rows.length) * 100).toFixed(1) : "0.0";
  const totalBroken = faultMap ? rows.reduce((s,r) => { const ef = faultMap.get(r.id); return s + (ef ? ef.broken_count : 0); }, 0) : 0;
  const asaltPct    = totalHeads > 0 ? ((totalHeads - totalBroken) / totalHeads * 100).toFixed(1) : "100.0";
  const asaltColor  = parseFloat(asaltPct) >= 90 ? "#16a34a" : parseFloat(asaltPct) >= 70 ? "#d97706" : "#dc2626";
  const asaltBg     = parseFloat(asaltPct) >= 90 ? "#f0fdf4" : parseFloat(asaltPct) >= 70 ? "#fff7ed" : "#fef2f2";
  return `<div style="display:flex;gap:12px;padding:12px 18px;border-bottom:1px solid #f1f5f9;flex-wrap:wrap">
    <div style="background:#fffbeb;border-radius:8px;padding:8px 16px;text-align:center;min-width:90px">
      <div style="font-size:20px;font-weight:800;color:#f59e0b">${rows.length}</div>
      <div style="font-size:11px;color:#64748b">Нийт гудамж</div>
    </div>
    <div style="background:#eff6ff;border-radius:8px;padding:8px 16px;text-align:center;min-width:90px">
      <div style="font-size:20px;font-weight:800;color:#2563eb">${totalPoles}</div>
      <div style="font-size:11px;color:#64748b">Нийт шон</div>
    </div>
    <div style="background:#f0f9ff;border-radius:8px;padding:8px 16px;text-align:center;min-width:90px">
      <div style="font-size:20px;font-weight:800;color:#0ea5e9">${totalHeads}</div>
      <div style="font-size:11px;color:#64748b">Нийт толгой</div>
    </div>
    ${needsPoles > 0 ? `<div style="background:#fff7ed;border-radius:8px;padding:8px 16px;text-align:center;min-width:90px">
      <div style="font-size:20px;font-weight:800;color:#d97706">${needsPoles}</div>
      <div style="font-size:11px;color:#64748b">Нөхөх шон</div>
    </div>` : ""}
    <div style="background:${asaltBg};border-radius:8px;padding:8px 16px;text-align:center;min-width:90px">
      <div style="font-size:20px;font-weight:800;color:${asaltColor}">${asaltPct}%</div>
      <div style="font-size:11px;color:#64748b">Асалтын хувь</div>
      ${totalBroken > 0 ? `<div style="font-size:10px;font-weight:700;color:#dc2626">${totalBroken} гэмтэл</div>` : `<div style="font-size:10px;color:#94a3b8">гэмтэлгүй</div>`}
    </div>
    <div style="background:#f0fdf4;border-radius:8px;padding:8px 16px;text-align:center;min-width:90px">
      <div style="font-size:20px;font-weight:800;color:#16a34a">${activeCount}</div>
      <div style="font-size:11px;color:#64748b">Идэвхтэй</div>
      <div style="font-size:11px;font-weight:700;color:#16a34a">${activePct}%</div>
    </div>
  </div>`;
}

function trafficSummaryBar(rows) {
  const total    = rows.length;
  const onCount  = rows.filter(r => isTrafficOn(r.status)).length;
  const offCount = total - onCount;
  const pct      = total > 0 ? (onCount / total * 100).toFixed(1) : "0.0";
  const pctColor = parseFloat(pct) >= 90 ? "#16a34a" : parseFloat(pct) >= 70 ? "#d97706" : "#dc2626";
  const pctBg    = parseFloat(pct) >= 90 ? "#f0fdf4" : parseFloat(pct) >= 70 ? "#fff7ed" : "#fef2f2";
  return `<div style="display:flex;gap:12px;padding:12px 18px;border-bottom:1px solid #f1f5f9;flex-wrap:wrap">
    <div style="background:#f0fdf4;border-radius:8px;padding:8px 16px;text-align:center;min-width:90px">
      <div style="font-size:20px;font-weight:800;color:#10b981">${total}</div>
      <div style="font-size:11px;color:#64748b">Нийт дохио</div>
    </div>
    <div style="background:#dcfce7;border-radius:8px;padding:8px 16px;text-align:center;min-width:90px">
      <div style="font-size:20px;font-weight:800;color:#16a34a">${onCount}</div>
      <div style="font-size:11px;color:#64748b">Асаалтай 🟢</div>
    </div>
    <div style="background:#f1f5f9;border-radius:8px;padding:8px 16px;text-align:center;min-width:90px">
      <div style="font-size:20px;font-weight:800;color:#475569">${offCount}</div>
      <div style="font-size:11px;color:#64748b">Унтраалтай ⚫</div>
    </div>
    <div style="background:${pctBg};border-radius:8px;padding:8px 16px;text-align:center;min-width:90px">
      <div style="font-size:20px;font-weight:800;color:${pctColor}">${pct}%</div>
      <div style="font-size:11px;color:#64748b">Асалтын хувь</div>
    </div>
  </div>`;
}

function refreshAssetView(category) {
  if (category === "Камер" && window._cameraAssetMode) camera_assets();
  else assets(category);
}

function cameraCountOf(asset) {
  const direct = Number(asset?.camera_count || 0);
  if (direct > 0) return direct;
  const spec = String(asset?.specs || asset?.description || "");
  const m = spec.match(/(\d+)\s*(?:ш|ширхэг|camera|камер)/i);
  return m ? Number(m[1]) : 1;
}

function cameraBrokenCountOf(asset) {
  return Math.max(0, Number(asset?.camera_broken_count || 0));
}

function cameraConditionOf(asset) {
  const condition = String(asset?.condition || "").trim();
  if (condition === "Засвар хэрэгтэй" || condition === "Засварт") return "Засварлах";
  return CAMERA_CONDITIONS.includes(condition) ? condition : "Хэвийн";
}

async function updateCameraCounts(id, cameraCount, brokenCount, status = null) {
  const total = Math.max(1, Number(cameraCount || 1));
  const nextStatus = status === "Идэвхгүй" ? "Идэвхгүй" : "Идэвхтэй";
  const broken = nextStatus === "Идэвхгүй" ? total : Math.max(0, Math.min(total, Number(brokenCount || 0)));
  try {
    await api(`/api/assets/${id}/camera-counts`, {
      method: "PATCH",
      body: JSON.stringify({ camera_count: total, camera_broken_count: broken, status: nextStatus })
    });
    toast("Камерын тоо шинэчлэгдлээ ✓");
    camera_assets();
  } catch(e) {
    toast("Алдаа: " + e.message);
  }
}

function cameraConditionFilter(val) {
  _cameraConditionFilter = String(val || "");
  camera_assets();
}

async function updateCameraBag(id, bagNo) {
  const nextBag = bagNo ? String(bagNo) : "";
  try {
    await api(`/api/assets/${id}/bag`, {
      method: "PATCH",
      body: JSON.stringify({ bag_no: nextBag ? Number(nextBag) : null })
    });
    _cameraAssetBagFilter = nextBag;
    toast("Камерын баг шинэчлэгдлээ ✓");
    camera_assets();
  } catch(e) {
    toast("Алдаа: " + e.message);
  }
}

async function updateCameraCondition(id, condition) {
  const nextCondition = CAMERA_CONDITIONS.includes(condition) ? condition : "Хэвийн";
  try {
    await api(`/api/assets/${id}/condition`, {
      method: "PATCH",
      body: JSON.stringify({ condition: nextCondition })
    });
    _cameraConditionFilter = nextCondition;
    toast("Камерын нөхцөл шинэчлэгдлээ ✓");
    camera_assets();
  } catch(e) {
    toast("Алдаа: " + e.message);
  }
}

async function assets(filterCat) {
  const slMode = !!window._slAssetMode;
  window._slAssetMode = false;
  if (!slMode) window._assetEmbedTarget = "";
  const embedTargetId = window._assetEmbedTarget || "";
  const renderTarget = embedTargetId ? document.getElementById(embedTargetId) : main;
  const embedded = !!embedTargetId && !!renderTarget;
  const canCreate = ["director","chief_engineer","storekeeper","camera_engineer"].includes(state.me.role) ||
                    (slMode && ["engineer","electric"].includes(state.me.role));
  const canDel    = ["director","chief_engineer"].includes(state.me.role) ||
                    (slMode && ["engineer","electric"].includes(state.me.role));
  const cat = filterCat !== undefined ? filterCat : (window._assetCat || null);
  window._assetCat = cat;
  if (cat !== "Камер") window._cameraAssetMode = false;

  const isGerCat      = Object.hasOwn(GER_CAT_MAP, cat || "");
  const isSlPoints    = cat === "Авто замын гэрэл";
  const isTrafficLight = cat === "Гэрлэн дохио";
  const isSpecial      = isGerCat || isSlPoints;

  let _dynCats = [];
  try { _dynCats = await api("/api/asset-categories"); } catch(e) {}
  if (!_dynCats.length) _dynCats = ASSET_CATEGORIES.map(c => ({ name:c.id, icon:c.icon, color:c.color, bg:c.bg, border:c.border }));
  window._assetCatList = _dynCats;

  const [summary, gerInvAll, slPointsAll] = await Promise.all([
    api("/api/assets/summary/by-category"),
    api("/api/sl-ger-inventory").catch(() => []),
    api("/api/sl-points").catch(() => []),
  ]);

  const gerCountByName = {
    "Гэр хорооллын гэрэл": gerInvAll.filter(r=>r.category==="Гэр хороолол").length,
    "Цамхагийн гэрэл":     gerInvAll.filter(r=>r.category==="Цамхаг").length,
    "Авто замын гэрэл":     slPointsAll.filter(r=>(r.code||"").startsWith("ГТ-")).length,
  };

  let rows = [], gerRows = [], slRows = [], slFaultMap = new Map(), gerFaultMap = new Map();
  if (isGerCat) {
    gerRows = gerInvAll.filter(r => r.category === GER_CAT_MAP[cat]);
    const gerFaults = await api(`/api/sl-faults?category=${encodeURIComponent(cat)}`).catch(()=>[]);
    gerFaults.filter(f=>f.status!=="Дууссан").forEach(f => {
      if (f.location_id) gerFaultMap.set(f.location_id, f);
    });
  } else if (isSlPoints) {
    slRows = slPointsAll.filter(r => (r.code||"").startsWith("ГТ-"));
    const slFaults = await api("/api/sl-faults?category=Авто замын гэрэл").catch(()=>[]);
    slFaults.filter(f=>f.status!=="Дууссан").forEach(f => {
      if (f.location_id) slFaultMap.set(f.location_id, f);
    });
  } else {
    rows = await api("/api/assets" + (cat ? `?category=${encodeURIComponent(cat)}` : ""));
  }

  const allFlags = await api("/api/asset-flags").catch(() => []);
  const flagMap = new Map(allFlags.map(f => [`${f.table_name}_${f.record_id}`, f]));

  const visibleCats = slMode ? _dynCats.filter(c => SL_CATS.includes(c.name)) : _dynCats;

  renderTarget.innerHTML = `
  ${embedded ? "" : `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;flex-wrap:wrap;gap:12px">
    <div>
      <h1 style="margin:0 0 4px;font-size:22px;font-weight:800;letter-spacing:-.02em">${slMode ? "💡 Гэрэлтүүлгийн объектийн бүртгэл" : "🏗 Объектийн бүртгэл"}</h1>
      <div style="font-size:12px;color:#667085">${slMode ? "Гэрэлтүүлэг · Дэд станц · Тоног төхөөрөмж" : "Asset Registry · Паспорт · Засварын түүх"}</div>
    </div>
    ${slMode ? `<button onclick="sl_dashboard()" class="btn secondary" style="font-size:12px;padding:6px 14px">← Гэрэлтүүлгийн төв</button>` : ""}
  </div>`}

  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:10px;margin-bottom:20px">
    ${visibleCats.map(c => {
      const isGer = Object.hasOwn(GER_CAT_MAP, c.name) || Object.hasOwn(gerCountByName, c.name);
      const s = isGer
        ? { total: gerCountByName[c.name] || 0, needs_repair: 0 }
        : (summary.find(x=>x.category===c.name) || {total:0,needs_repair:0});
      const active = cat===c.name;
      const col  = c.color  || "#94a3b8";
      const bg   = c.bg     || "#f8fafc";
      const brd  = c.border || "#e2e8f0";
      const clickFn = embedded && slMode ? `slHubAsset(this.dataset.cat)` : slMode ? `slAssets(this.dataset.cat)` : `assets(this.dataset.cat)`;
      return `<div data-cat="${escapeHtml(c.name)}" onclick="${clickFn}" style="
        padding:12px 14px;border-radius:10px;cursor:pointer;transition:all .15s;
        background:${active?col:bg};color:${active?'#fff':col};
        border:2px solid ${active?col:brd};
      ">
        <div style="font-size:18px;margin-bottom:4px">${c.icon||'📦'}</div>
        <div style="font-size:12px;font-weight:700;opacity:${active?1:.85}">${escapeHtml(c.name)}</div>
        <div style="font-size:22px;font-weight:800;margin-top:2px">${s.total}</div>
        ${c.name==="Гэрлэн дохио" && s.total>0
          ? `<div style="font-size:10px;margin-top:2px;opacity:.9">🟢 ${Math.round((s.active||0)/s.total*100)}% асаалтай</div>`
          : s.needs_repair>0 ? `<div style="font-size:10px;margin-top:2px;opacity:.9">⚠ ${s.needs_repair} засвар</div>` : ""}
      </div>`;
    }).join("")}
  </div>

  <div id="assetFormModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;align-items:flex-start;justify-content:center;padding-top:30px;overflow-y:auto"
    onclick="if(event.target===this)closeAssetForm()">
    <div id="assetFormInner" style="background:#fff;border-radius:14px;width:min(700px,96vw);margin:0 auto 40px;box-shadow:0 20px 60px rgba(0,0,0,.25)"></div>
  </div>

  <div id="assetPassportModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;align-items:flex-start;justify-content:center;padding-top:30px;overflow-y:auto"
    onclick="if(event.target===this)closePassport()">
    <div id="assetPassportInner" style="background:#fff;border-radius:14px;width:min(780px,96vw);margin:0 auto 40px;box-shadow:0 20px 60px rgba(0,0,0,.25)"></div>
  </div>

  <div id="trafficSignalModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1200;align-items:flex-start;justify-content:center;padding-top:30px;overflow-y:auto"
    onclick="if(event.target===this)closeTrafficSignalModal()">
    <div id="trafficSignalInner" style="background:#fff;border-radius:14px;width:min(900px,96vw);margin:0 auto 40px;box-shadow:0 20px 60px rgba(0,0,0,.25)"></div>
  </div>

  <div id="globalLightbox" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.93);z-index:3000;align-items:center;justify-content:center;flex-direction:column"
    onclick="if(event.target.id==='globalLightbox')closeLightbox()">
    <button onclick="closeLightbox()" style="position:fixed;top:14px;right:18px;background:rgba(255,255,255,.15);border:none;color:#fff;border-radius:8px;padding:6px 16px;cursor:pointer;font-size:15px;z-index:1">✕</button>
    <button id="lbPrev" onclick="lightboxNav(-1)" style="display:none;position:fixed;left:14px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,.15);border:none;color:#fff;border-radius:50%;width:48px;height:48px;font-size:26px;cursor:pointer;z-index:1;line-height:1">‹</button>
    <img id="lbImg" style="max-width:92vw;max-height:88vh;object-fit:contain;border-radius:8px;box-shadow:0 8px 48px rgba(0,0,0,.6)">
    <div id="lbCaption" style="color:rgba(255,255,255,.6);font-size:12px;margin-top:12px;text-align:center"></div>
    <button id="lbNext" onclick="lightboxNav(1)" style="display:none;position:fixed;right:14px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,.15);border:none;color:#fff;border-radius:50%;width:48px;height:48px;font-size:26px;cursor:pointer;z-index:1;line-height:1">›</button>
  </div>

  <div id="slDetailModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:1100;align-items:flex-start;justify-content:center;padding-top:24px;overflow-y:auto"
    onclick="if(event.target===this)closeSlDetail()">
    <div id="slDetailInner" style="background:#fff;border-radius:16px;width:min(820px,96vw);margin:0 auto 40px;box-shadow:0 24px 80px rgba(0,0,0,.3)"></div>
  </div>

  <div id="slDocReaderModal" style="display:none;position:fixed;inset:0;background:rgba(10,10,20,.92);z-index:1200;flex-direction:column;align-items:center">
    <div style="display:flex;align-items:center;justify-content:space-between;width:100%;padding:10px 20px;background:rgba(0,0,0,.4);border-bottom:1px solid rgba(255,255,255,.1);flex-shrink:0">
      <div id="slDocReaderTitle" style="color:#fff;font-size:13px;font-weight:700;max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></div>
      <div style="display:flex;align-items:center;gap:10px">
        <div id="slDocPageNav" style="display:none;align-items:center;gap:8px;color:#fff;font-size:12px">
          <button onclick="slDocPage(-1)" style="background:rgba(255,255,255,.15);border:none;color:#fff;border-radius:6px;padding:4px 12px;cursor:pointer;font-size:14px">‹</button>
          <span id="slDocPageInfo" style="min-width:80px;text-align:center"></span>
          <button onclick="slDocPage(1)" style="background:rgba(255,255,255,.15);border:none;color:#fff;border-radius:6px;padding:4px 12px;cursor:pointer;font-size:14px">›</button>
        </div>
        <a id="slDocDownloadLink" href="#" download style="background:rgba(255,255,255,.15);color:#fff;border-radius:6px;padding:5px 12px;font-size:11px;text-decoration:none;font-weight:600">⬇ Татах</a>
        <button onclick="closeSlDocReader()" style="background:rgba(255,255,255,.15);border:none;color:#fff;border-radius:6px;padding:5px 14px;cursor:pointer;font-size:13px">✕ Хаах</button>
      </div>
    </div>
    <div id="slDocReaderBody" style="flex:1;overflow:auto;width:100%;display:flex;flex-direction:column;align-items:center;padding:20px 10px;gap:10px"></div>
  </div>

  <div id="gerFormModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;align-items:flex-start;justify-content:center;padding-top:30px;overflow-y:auto"
    onclick="if(event.target===this)closeGerForm()">
    <div id="gerFormInner" style="background:#fff;border-radius:14px;width:min(520px,96vw);margin:0 auto 40px;box-shadow:0 20px 60px rgba(0,0,0,.25)"></div>
  </div>

  <div id="slFormModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;align-items:flex-start;justify-content:center;padding-top:30px;overflow-y:auto"
    onclick="if(event.target===this)closeSlForm()">
    <div id="slFormInner" style="background:#fff;border-radius:14px;width:min(520px,96vw);margin:0 auto 40px;box-shadow:0 20px 60px rgba(0,0,0,.25)"></div>
  </div>

  <div id="assetFlagModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2000;align-items:center;justify-content:center"
    onclick="if(event.target===this)closeAssetFlagModal()">
    <div style="background:#fff;border-radius:14px;width:min(420px,94vw);padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.25)">
      <div style="font-size:15px;font-weight:800;margin-bottom:6px">🚩 Буруу бүртгэл тэмдэглэх</div>
      <div id="afmTitle" style="font-size:12px;color:#667085;margin-bottom:14px"></div>
      <div style="font-size:11px;color:#374151;font-weight:600;margin-bottom:6px">Юу буруу бүртгэгдсэн? *</div>
      <textarea id="afmNote" rows="3" placeholder="Жишээ: Шонгийн тоо буруу — 9 биш 7 байх ёстой, байршил буруу..."
        style="width:100%;border:1px solid #e2e6ed;border-radius:8px;padding:8px 10px;font-size:13px;resize:vertical;outline:none;box-sizing:border-box"></textarea>
      <div style="display:flex;gap:8px;margin-top:14px">
        <button onclick="saveAssetFlag()" class="btn" style="flex:1;background:#d97706;border-color:#d97706">🚩 Тэмдэглэх</button>
        <button onclick="closeAssetFlagModal()" class="btn secondary">Цуцлах</button>
      </div>
    </div>
  </div>

  <div class="panel">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #e2e6ed">
      <div style="font-size:14px;font-weight:700">
        ${cat ? (_dynCats.find(c=>c.name===cat)?.icon || ASSET_CATEGORIES.find(c=>c.id===cat)?.icon || "📦") : "📦"}
        ${cat || "Объект"}
        <span style="font-size:12px;color:#667085;font-weight:400">(${isGerCat ? gerRows.length : isSlPoints ? slRows.length : rows.length})</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        ${canCreate && cat === "Шит/Самбар" ? `<button class="btn secondary" style="padding:6px 14px;font-size:12px;white-space:nowrap"
          onclick="importPanelsFromMeters()">🔌 Тоолуураас татах</button>` : ""}
        ${canCreate ? `<button class="btn" style="padding:6px 14px;font-size:12px;white-space:nowrap"
          onclick="${isGerCat ? 'openGerForm()' : isSlPoints ? 'openSlForm()' : 'openAssetForm()'}">
          + ${escapeHtml(cat || 'Объект')} нэмэх
        </button>` : ""}
        <input placeholder="${cat === "Шит/Самбар" ? "Кодоор хайх..." : "Хайх..."}" oninput="filterAssets(this.value)"
          style="padding:6px 12px;border:1px solid #e2e6ed;border-radius:8px;font-size:12px;width:180px;outline:none">
      </div>
    </div>
    ${isGerCat ? gerSummaryBar(cat, gerRows, gerFaultMap) : isSlPoints ? slSummaryBar(slRows, slFaultMap) : isTrafficLight ? trafficSummaryBar(rows) : ""}
    <div class="table-wrap">
      ${isSlPoints ? `
      <table id="assetTable">
        <thead><tr>
          <th style="width:36px">#</th>
          <th>Код</th>
          <th>Нэр / Байршил</th>
          <th style="text-align:center">Шонгийн тоо</th>
          <th style="text-align:center">Нийт толгой</th>
          <th>Төрөл</th>
          <th style="text-align:center;color:#dc2626">Гэмтэл</th>
          <th style="text-align:center">Нөхөх шон</th>
          <th style="text-align:center">Үйлдэл</th>
          <th style="text-align:center">Дэлгэрэнгүй</th>
        </tr></thead>
        <tbody>
          ${slRows.length ? slRows.map((r,i) => {
            const headsDisplay = r.total_heads > 0 ? r.total_heads : (r.lamp_count||0);
            const ef = slFaultMap.get(r.id);
            const brokenVal = ef ? ef.broken_count : 0;
            const faultId   = ef ? ef.id : 0;
            const inputColor = brokenVal > 0 ? "#dc2626" : "#94a3b8";
            return `<tr data-name="${escapeHtml((r.name||"").toLowerCase())}" data-loc="${escapeHtml((r.location||"").toLowerCase())}">
              <td style="color:#94a3b8;font-size:11px">${i+1}</td>
              <td><span style="font-family:monospace;font-size:11px;background:#f1f5f9;padding:2px 6px;border-radius:4px">${escapeHtml(r.code||"—")}</span></td>
              <td>
                <div style="font-weight:600">${escapeHtml(r.name||"—")}</div>
                ${r.location ? `<div style="font-size:11px;color:#94a3b8">${escapeHtml(r.location)}</div>` : ""}
              </td>
              <td style="text-align:center;font-weight:700;color:#2563eb">${r.lamp_count||0}</td>
              <td style="text-align:center;font-weight:700;color:#0ea5e9">${headsDisplay}</td>
              <td style="font-size:11px;color:#667085">${escapeHtml(r.light_type||(r.wattage_per_lamp?`${r.wattage_per_lamp}Вт`:"—"))}</td>
              <td style="text-align:center">
                ${(() => {
                  const workPct = headsDisplay > 0 ? Math.round((headsDisplay - brokenVal) / headsDisplay * 100) : 100;
                  const pctColor = workPct >= 90 ? "#16a34a" : workPct >= 70 ? "#d97706" : "#dc2626";
                  return `<input type="number" min="0" max="${headsDisplay}"
                    value="${brokenVal||""}"
                    placeholder="0"
                    data-slid="${r.id}" data-name="${escapeHtml(r.name||"")}" data-heads="${headsDisplay}" data-fid="${faultId}" data-orig="${brokenVal}"
                    onkeydown="if(event.key==='Enter'){slFaultQuickSave(this);this.blur()}"
                    onblur="slFaultQuickSave(this)"
                    style="width:60px;text-align:center;padding:4px 6px;border-radius:8px;border:2px solid ${brokenVal>0?'#fecaca':'#e2e6ed'};font-size:14px;font-weight:800;color:${inputColor};outline:none;background:${brokenVal>0?'#fef2f2':'#fff'};transition:all .2s"
                    onfocus="this.style.borderColor='#dc2626';this.style.background='#fff5f5'"
                  >
                  <div style="font-size:10px;margin-top:3px;font-weight:700;color:${pctColor}">${workPct}%</div>`;
                })()}
              </td>
              <td style="text-align:center">${r.needs_poles > 0 ? `<span style="background:#fff7ed;color:#d97706;border-radius:12px;padding:1px 8px;font-size:11px;font-weight:700">${r.needs_poles}</span>` : `<span style="color:#94a3b8">—</span>`}</td>
              <td style="text-align:center">
                ${(() => {
                  const fl2 = flagMap.get(`sl_points_${r.id}`);
                  const flBtn2 = fl2 && !fl2.is_resolved
                    ? `<button class="btn secondary" style="padding:3px 8px;font-size:10px;color:#d97706;border-color:#d97706"
                         onclick="openAssetFlagModal('sl_points',${r.id},'${escapeHtml((r.name||"").replace(/'/g,""))}',${fl2.id},'${escapeHtml((fl2.flag_note||"").replace(/'/g,""))}')">🚩</button>
                       <button class="btn secondary" style="padding:3px 8px;font-size:10px;color:#16a34a"
                         onclick="resolveAssetFlag(${fl2.id})">✓</button>`
                    : `<button class="btn secondary" style="padding:3px 8px;font-size:10px"
                         onclick="openAssetFlagModal('sl_points',${r.id},'${escapeHtml((r.name||"").replace(/'/g,""))}')">🚩</button>`;
                  return `<div style="display:flex;gap:3px;justify-content:center">
                    <button class="btn secondary" style="padding:3px 8px;font-size:10px" onclick="openSlForm(${r.id})" title="Засах">✏️</button>
                    <button class="btn secondary" style="padding:3px 8px;font-size:10px" onclick="show('sl_faults')" title="Гэмтэл / засварын бүртгэл">⚡</button>
                    ${flBtn2}
                    ${canDel ? `<button class="btn danger" style="padding:3px 8px;font-size:10px"
                      onclick="deleteSlPointRow(${r.id},'${escapeHtml((r.name||"").replace(/'/g,""))}')">🗑</button>` : ""}
                  </div>`;
                })()}
              </td>
              <td style="text-align:center">
                <button class="btn secondary" style="padding:3px 8px;font-size:10px;background:#eff6ff;color:#2563eb;border-color:#bfdbfe" onclick="openSlDetail(${r.id})" title="Дэлгэрэнгүй мэдээлэл">📋 Харах</button>
              </td>
            </tr>`;
          }).join("") : `<tr><td colspan="10" style="text-align:center;color:#667085;padding:30px">Бүртгэл олдсонгүй</td></tr>`}
        </tbody>
      </table>` : isGerCat ? `
      <table id="assetTable">
        <thead><tr>
          <th style="width:36px">#</th>
          <th>Баг</th>
          <th>Байршил</th>
          <th style="text-align:center">Шонгийн тоо</th>
          <th style="text-align:center">Толгойн тоо</th>
          <th>Төрөл</th>
          <th style="text-align:center;color:#dc2626">Гэмтэл</th>
          <th style="text-align:center">Дутуу шон</th>
          <th style="text-align:center">Үйлдэл</th>
          <th style="text-align:center">Дэлгэрэнгүй</th>
        </tr></thead>
        <tbody>
          ${gerRows.length ? gerRows.map((r,i)=>{
            const isCamhag = cat==="Цамхагийн гэрэл";
            const heads = r.total_count || 0;
            const ef = gerFaultMap.get(r.id);
            const brokenVal = ef ? ef.broken_count : 0;
            const faultId   = ef ? ef.id : 0;
            const inputColor = brokenVal > 0 ? "#dc2626" : "#94a3b8";
            const workPct = heads > 0 ? Math.round((heads - brokenVal) / heads * 100) : 100;
            const pctColor = workPct >= 90 ? "#16a34a" : workPct >= 70 ? "#d97706" : "#dc2626";
            const countCells = isCamhag
              ? `<td style="text-align:center;color:#64748b;font-size:12px">1</td>
                 <td style="text-align:center;font-weight:700;color:#d97706">${heads}</td>`
              : `<td style="text-align:center;font-weight:700;color:#2563eb">${heads}</td>
                 <td style="text-align:center;font-weight:700;color:#0ea5e9">${heads}</td>`;
            const fl = flagMap.get(`sl_ger_inventory_${r.id}`);
            const flStyle = fl && !fl.is_resolved ? "background:#fffbeb;border-left:3px solid #d97706;" : "";
            const flBadge = fl && !fl.is_resolved
              ? `<div style="font-size:10px;color:#d97706;font-weight:700;margin-top:2px" title="${escapeHtml(fl.flag_note)}">🚩 ${escapeHtml((fl.flag_note||"").slice(0,20))}${fl.flag_note?.length>20?"…":""}</div>` : "";
            const flBtn = fl && !fl.is_resolved
              ? `<button class="btn secondary" style="padding:3px 8px;font-size:10px;color:#d97706;border-color:#d97706"
                   onclick="openAssetFlagModal('sl_ger_inventory',${r.id},'${escapeHtml((r.location_name||"").replace(/'/g,""))}',${fl.id},'${escapeHtml((fl.flag_note||"").replace(/'/g,""))}')">🚩 Засах</button>
                 <button class="btn secondary" style="padding:3px 8px;font-size:10px;color:#16a34a"
                   onclick="resolveAssetFlag(${fl.id})">✓ Засагдлаа</button>`
              : `<button class="btn secondary" style="padding:3px 8px;font-size:10px"
                   onclick="openAssetFlagModal('sl_ger_inventory',${r.id},'${escapeHtml((r.location_name||"").replace(/'/g,""))}')">🚩 Тэмдэглэх</button>`;
            return `<tr data-name="${escapeHtml((r.location_name||"").toLowerCase())}" data-loc="" style="${flStyle}">
              <td style="color:#94a3b8;font-size:11px">${i+1}</td>
              <td style="font-size:12px">${r.bag_no ?? "—"}${flBadge}</td>
              <td style="font-weight:600">${escapeHtml(r.location_name||"—")}</td>
              ${countCells}
              <td style="font-size:11px;color:#667085">${escapeHtml(r.light_type||"—")}</td>
              <td style="text-align:center">
                <input type="number" min="0" max="${heads}"
                  value="${brokenVal||""}" placeholder="0"
                  data-gerid="${r.id}" data-name="${escapeHtml(r.location_name||"")}"
                  data-heads="${heads}" data-fid="${faultId}" data-orig="${brokenVal}"
                  data-cat="${escapeHtml(cat)}"
                  onkeydown="if(event.key==='Enter'){gerFaultQuickSave(this);this.blur()}"
                  onblur="gerFaultQuickSave(this)"
                  style="width:60px;text-align:center;padding:4px 6px;border-radius:8px;border:2px solid ${brokenVal>0?'#fecaca':'#e2e6ed'};font-size:14px;font-weight:800;color:${inputColor};outline:none;background:${brokenVal>0?'#fef2f2':'#fff'};transition:all .2s"
                  onfocus="this.style.borderColor='#dc2626';this.style.background='#fff5f5'"
                >
                <div style="font-size:10px;margin-top:3px;font-weight:700;color:${pctColor}">${workPct}%</div>
              </td>
              <td style="text-align:center">${r.needs_poles > 0 ? `<span style="background:#fff7ed;color:#d97706;border-radius:12px;padding:1px 8px;font-size:11px;font-weight:700">${r.needs_poles}</span>` : `<span style="color:#94a3b8">—</span>`}</td>
              <td style="text-align:center">
                <div style="display:flex;gap:3px;justify-content:center;flex-wrap:wrap">
                  <button class="btn secondary" style="padding:3px 8px;font-size:10px" onclick="openGerForm(${r.id})" title="Засах">✏️</button>
                  <button class="btn secondary" style="padding:3px 8px;font-size:10px" onclick="show('sl_faults')" title="Гэмтэл / засварын бүртгэл">⚡</button>
                  ${flBtn}
                  ${canDel ? `<button class="btn danger" style="padding:3px 8px;font-size:10px"
                    onclick="deleteGerRow(${r.id},'${escapeHtml((r.location_name||"").replace(/'/g,""))}')">🗑</button>` : ""}
                </div>
              </td>
              <td style="text-align:center">
                <button class="btn secondary" style="padding:3px 8px;font-size:10px;background:#eff6ff;color:#2563eb;border-color:#bfdbfe"
                  onclick="openGerDetail(${r.id},'${escapeHtml(cat)}')" title="Дэлгэрэнгүй мэдээлэл">📋 Харах</button>
              </td>
            </tr>`;
          }).join("") : `<tr><td colspan="10" style="text-align:center;color:#667085;padding:30px">Бүртгэл олдсонгүй</td></tr>`}
        </tbody>
      </table>` : `
      <table id="assetTable">
        <thead><tr>
          <th style="width:40px">#</th>
          <th>Код</th>
          <th>Нэр</th>
          <th>Ангилал</th>
          <th>Байршил</th>
          <th>Төлөв</th>
          <th>Нөхцөл</th>
          <th>Хариуцагч</th>
          <th>Файл</th>
          <th>Ажил</th>
          <th></th>
        </tr></thead>
        <tbody>
          ${rows.length ? rows.map((r,i) => {
            const ac = _dynCats.find(c=>c.name===r.category) || ASSET_CATEGORIES.find(c=>c.id===r.category) || ASSET_CATEGORIES.at(-1);
            const condColor = r.condition==="Хэвийн"?"#16a34a":r.condition==="Засвар хэрэгтэй"?"#d97706":"#dc2626";
            const fl3 = flagMap.get(`assets_${r.id}`);
            const flStyle3 = fl3 && !fl3.is_resolved ? "background:#fffbeb;border-left:3px solid #d97706;" : "";
            const flBtn3 = fl3 && !fl3.is_resolved
              ? `<button class="btn secondary" style="padding:3px 8px;font-size:10px;color:#d97706;border-color:#d97706" title="${escapeHtml(fl3.flag_note)}"
                   onclick="openAssetFlagModal('assets',${r.id},'${escapeHtml((r.name||"").replace(/'/g,""))}',${fl3.id},'${escapeHtml((fl3.flag_note||"").replace(/'/g,""))}')">🚩</button>
                 <button class="btn secondary" style="padding:3px 8px;font-size:10px;color:#16a34a"
                   onclick="resolveAssetFlag(${fl3.id})">✓</button>`
              : `<button class="btn secondary" style="padding:3px 8px;font-size:10px"
                   onclick="openAssetFlagModal('assets',${r.id},'${escapeHtml((r.name||"").replace(/'/g,""))}')">🚩</button>`;
            return `<tr data-code="${escapeHtml((r.asset_code||"").toLowerCase())}" data-name="${escapeHtml((r.name||"").toLowerCase())}" data-loc="${escapeHtml((r.location||"").toLowerCase())}" style="${flStyle3}">
              <td style="color:#94a3b8;font-size:11px">${i+1}</td>
              <td><span style="font-family:monospace;font-size:11px;background:#f1f5f9;padding:2px 6px;border-radius:4px">${escapeHtml(r.asset_code||"—")}</span></td>
              <td><span style="font-weight:600;cursor:pointer;color:#1d4ed8" onclick="openPassport(${r.id})">${escapeHtml(r.name)}</span>
                ${fl3&&!fl3.is_resolved?`<div style="font-size:10px;color:#d97706;margin-top:1px">🚩 ${escapeHtml((fl3.flag_note||"").slice(0,24))}${fl3.flag_note?.length>24?"…":""}</div>`:""}</td>
              <td><span style="font-size:13px">${ac.icon}</span> <span style="font-size:12px">${r.category}</span></td>
              <td style="font-size:12px;color:#667085">${escapeHtml(r.location||"—")}</td>
              <td>${r.category === "Гэрлэн дохио"
                ? `<span onclick="toggleTrafficStatus(${r.id},'${r.status}')" title="Дарж солих" style="cursor:pointer;font-size:10px;padding:2px 10px;border-radius:20px;user-select:none;
                    background:${isTrafficOn(r.status)?"#dcfce7":"#f1f5f9"};
                    color:${isTrafficOn(r.status)?"#16a34a":"#475569"};
                    border:1.5px solid ${isTrafficOn(r.status)?"#86efac":"#cbd5e1"}">${isTrafficOn(r.status)?"🟢 Асаалтай":"⚫ Унтраалтай"}</span>`
                : `<span style="font-size:10px;padding:2px 8px;border-radius:20px;background:${r.status==="Идэвхтэй"?"#dcfce7":"#f1f5f9"};color:${r.status==="Идэвхтэй"?"#16a34a":"#475569"}">${r.status}</span>`
              }</td>
              <td><span style="font-size:10px;color:${condColor};font-weight:600">${r.condition}</span></td>
              <td style="font-size:12px">${escapeHtml(r.assigned_name||"—")}</td>
              <td style="font-family:monospace;font-size:12px;color:#667085">${r.file_count||0}</td>
              <td style="font-family:monospace;font-size:12px;color:#667085">${r.work_count||0}</td>
              <td>
                <div style="display:flex;gap:4px;flex-wrap:wrap">
                  <button class="btn secondary" style="padding:3px 8px;font-size:10px" onclick="openPassport(${r.id})">📋</button>
                  ${r.category==="Гэрлэн дохио"?`<button class="btn secondary" style="padding:3px 8px;font-size:10px;color:#059669;border-color:#86efac" onclick="openTrafficSignalJournal(${r.id})" title="Төлөвийн цагийн журнал">🕒</button>`:""}
                  ${r.category==="Гэрлэн дохио"?`<button class="btn secondary" style="padding:3px 8px;font-size:10px;color:#2563eb;border-color:#bfdbfe" onclick="openTrafficSignalCheck(${r.id})" title="Ослын цаг шалгах">🔎</button>`:""}
                  ${canCreate?`<button class="btn secondary" style="padding:3px 8px;font-size:10px" onclick="openAssetForm(${r.id})">✏️</button>`:""}
                  ${canDel?`<button class="btn danger" style="padding:3px 8px;font-size:10px" onclick="confirmDeleteAsset(${r.id})">🗑</button>`:""}
                  ${flBtn3}
                </div>
              </td>
            </tr>`;
          }).join("") : `<tr><td colspan="11" style="text-align:center;color:#667085;padding:30px">
            Объект бүртгэгдээгүй байна. ${canCreate?`<a href="#" onclick="openAssetForm()" style="color:#2563eb">+ Бүртгэх</a>`:""}
          </td></tr>`}
        </tbody>
      </table>`}
    </div>
  </div>`;

  // Keyboard navigation for lightbox
  document.onkeydown = (e) => {
    const lb = document.getElementById("globalLightbox");
    if (!lb || lb.style.display === "none") return;
    if (e.key === "ArrowRight") lightboxNav(1);
    else if (e.key === "ArrowLeft") lightboxNav(-1);
    else if (e.key === "Escape") closeLightbox();
  };
}

function filterAssets(val) {
  const v = val.toLowerCase();
  document.querySelectorAll("#assetTable tbody tr[data-name]").forEach(tr => {
    const code = tr.dataset.code || "";
    if (window._assetCat === "Шит/Самбар") {
      tr.style.display = code.includes(v) ? "" : "none";
      return;
    }
    const name = tr.dataset.name || "";
    const loc  = tr.dataset.loc  || "";
    tr.style.display = name.includes(v) || loc.includes(v) ? "" : "none";
  });
}

let _afmTableName = "", _afmRecordId = 0, _afmFlagId = 0;

function openAssetFlagModal(tableName, recordId, label, flagId = 0, existingNote = "") {
  _afmTableName = tableName;
  _afmRecordId  = recordId;
  _afmFlagId    = flagId;
  const modal = document.getElementById("assetFlagModal");
  document.getElementById("afmTitle").textContent = label || "";
  document.getElementById("afmNote").value = existingNote;
  modal.style.display = "flex";
  setTimeout(() => document.getElementById("afmNote").focus(), 80);
}

function closeAssetFlagModal() {
  document.getElementById("assetFlagModal").style.display = "none";
}

async function saveAssetFlag() {
  const note = document.getElementById("afmNote").value.trim();
  if (!note) { document.getElementById("afmNote").focus(); return; }
  try {
    await api("/api/asset-flags", {
      method: "POST",
      body: JSON.stringify({ table_name: _afmTableName, record_id: _afmRecordId, flag_note: note })
    });
    closeAssetFlagModal();
    toast("🚩 Тэмдэглэгдлээ");
    refreshAssetView(window._assetCat);
  } catch(e) { toast("Алдаа: " + e.message); }
}

async function resolveAssetFlag(flagId) {
  if (!confirm("Засагдсан гэж тэмдэглэх үү?")) return;
  try {
    await api(`/api/asset-flags/${flagId}/resolve`, { method: "PUT" });
    toast("✓ Засагдсан гэж тэмдэглэгдлээ");
    refreshAssetView(window._assetCat);
  } catch(e) { toast("Алдаа: " + e.message); }
}

async function deleteGerRow(id, name) {
  if (!confirm(`"${name || id}" байршлын бүртгэлийг устгах уу?\nЭнэ үйлдлийг буцаах боломжгүй.`)) return;
  try {
    await api(`/api/sl-ger-inventory/${id}`, { method: "DELETE" });
    toast("Устгагдлаа ✓");
    refreshAssetView(window._assetCat);
  } catch(e) { toast("Алдаа: " + e.message); }
}

async function deleteSlPointRow(id, name) {
  if (!confirm(`"${name || id}" гудамжны бүртгэлийг устгах уу?\nЭнэ үйлдлийг буцаах боломжгүй.`)) return;
  try {
    await api(`/api/sl-points/${id}`, { method: "DELETE" });
    toast("Устгагдлаа ✓");
    refreshAssetView(window._assetCat);
  } catch(e) { toast("Алдаа: " + e.message); }
}

function isTrafficOn(status) {
  return status === "Асаалтай" || status === "Идэвхтэй";
}

function nowLocalInput() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0,16);
}

async function toggleTrafficStatus(id, current) {
  const next = isTrafficOn(current) ? "Унтраалтай" : "Асаалтай";
  try {
    await api("/api/traffic-signal-logs", {
      method: "POST",
      body: JSON.stringify({
        asset_id: id,
        status: next,
        started_at: nowLocalInput(),
        source: "Шуурхай төлөв солив",
        notes: "Жагсаалтаас шууд сольсон төлөв"
      })
    });
    refreshAssetView(window._assetCat);
  } catch(e) { toast("Алдаа: " + e.message); }
}

function trafficSignalModal(html) {
  const modal = document.getElementById("trafficSignalModal");
  const inner = document.getElementById("trafficSignalInner");
  if (!modal || !inner) return;
  inner.innerHTML = html;
  modal.style.display = "flex";
}

function closeTrafficSignalModal() {
  const modal = document.getElementById("trafficSignalModal");
  if (modal) modal.style.display = "none";
}

async function openTrafficSignalJournal(assetId) {
  const asset = await api(`/api/assets/${assetId}`).catch(()=>null);
  const logs = await api(`/api/traffic-signal-logs?asset_id=${assetId}`).catch(()=>[]);
  const rows = logs.map((l,i)=>`
    <tr>
      <td style="color:#94a3b8;font-size:11px">${i+1}</td>
      <td><span style="font-size:10px;padding:2px 8px;border-radius:20px;background:${isTrafficOn(l.status)?"#dcfce7":"#f1f5f9"};color:${isTrafficOn(l.status)?"#16a34a":"#475569"};font-weight:700">${escapeHtml(l.status)}</span></td>
      <td style="font-family:monospace;font-size:12px">${escapeHtml(l.started_at||"")}</td>
      <td style="font-family:monospace;font-size:12px">${escapeHtml(l.ended_at||"Одоо хүртэл")}</td>
      <td style="font-size:12px;color:#475569">${escapeHtml(l.source||"")}</td>
      <td style="font-size:12px;color:#475569">${escapeHtml(l.evidence_no||"")}</td>
      <td style="font-size:11px;color:#64748b">${escapeHtml(l.recorded_name||"")}</td>
    </tr>`).join("") || `<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:24px">Журнал бүртгэгдээгүй байна</td></tr>`;

  trafficSignalModal(`
  <div style="padding:16px 20px;border-bottom:1px solid #e2e6ed;display:flex;align-items:center;justify-content:space-between;background:#0f172a;border-radius:14px 14px 0 0">
    <div>
      <div style="font-size:15px;font-weight:800;color:#fff">🚦 Төлөвийн цагийн журнал</div>
      <div style="font-size:11px;color:#cbd5e1;margin-top:2px">${escapeHtml(asset?.name||"")} · ${escapeHtml(asset?.location||"")}</div>
    </div>
    <button onclick="closeTrafficSignalModal()" style="border:none;background:rgba(255,255,255,.12);color:#fff;border-radius:8px;padding:6px 12px;cursor:pointer">✕</button>
  </div>
  <div style="padding:18px 20px">
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:12px">
      <div>
        <div style="font-size:11px;color:#667085;margin-bottom:4px">Төлөв *</div>
        <select class="input" id="ts_status" style="margin:0">
          ${["Асаалтай","Унтраалтай","Гэмтэлтэй","Засварт","Гар удирдлага"].map(s=>`<option>${s}</option>`).join("")}
        </select>
      </div>
      <div>
        <div style="font-size:11px;color:#667085;margin-bottom:4px">Эхэлсэн огноо, цаг *</div>
        <input class="input" id="ts_start" type="datetime-local" value="${nowLocalInput()}" style="margin:0">
      </div>
      <div>
        <div style="font-size:11px;color:#667085;margin-bottom:4px">Дууссан огноо, цаг</div>
        <input class="input" id="ts_end" type="datetime-local" style="margin:0">
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
      <div>
        <div style="font-size:11px;color:#667085;margin-bottom:4px">Эх сурвалж</div>
        <input class="input" id="ts_source" placeholder="Жижүүр, LoRa, дуудлага, цагдаа..." style="margin:0">
      </div>
      <div>
        <div style="font-size:11px;color:#667085;margin-bottom:4px">Баримт / дуудлагын №</div>
        <input class="input" id="ts_evidence" placeholder="Дуудлага №, албан бичиг №..." style="margin:0">
      </div>
    </div>
    <div style="margin-bottom:12px">
      <div style="font-size:11px;color:#667085;margin-bottom:4px">Тайлбар</div>
      <textarea class="input" id="ts_notes" style="margin:0;min-height:54px" placeholder="Ямар шалтгаанаар унтарсан, ямар арга хэмжээ авсан..."></textarea>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:18px">
      <button class="btn" onclick="saveTrafficSignalLog(${assetId})">Журнал нэмэх</button>
      <button class="btn secondary" onclick="openTrafficSignalCheck(${assetId})">Ослын цаг шалгах</button>
    </div>
    <div class="table-wrap" style="max-height:360px;overflow:auto">
      <table>
        <thead><tr><th>#</th><th>Төлөв</th><th>Эхэлсэн</th><th>Дууссан</th><th>Эх сурвалж</th><th>Баримт</th><th>Бүртгэсэн</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`);
}

async function saveTrafficSignalLog(assetId) {
  const body = {
    asset_id: assetId,
    status: document.getElementById("ts_status")?.value,
    started_at: document.getElementById("ts_start")?.value,
    ended_at: document.getElementById("ts_end")?.value || null,
    source: document.getElementById("ts_source")?.value || "",
    evidence_no: document.getElementById("ts_evidence")?.value || "",
    notes: document.getElementById("ts_notes")?.value || "",
  };
  if (!body.status || !body.started_at) { toast("Төлөв, эхэлсэн цаг шаардлагатай"); return; }
  try {
    await api("/api/traffic-signal-logs", { method:"POST", body:JSON.stringify(body) });
    toast("Журнал нэмэгдлээ");
    openTrafficSignalJournal(assetId);
  } catch(e) { toast("Алдаа: " + e.message); }
}

async function openTrafficSignalCheck(assetId) {
  const asset = await api(`/api/assets/${assetId}`).catch(()=>null);
  trafficSignalModal(`
  <div style="padding:16px 20px;border-bottom:1px solid #e2e6ed;display:flex;align-items:center;justify-content:space-between;background:#1e3a5f;border-radius:14px 14px 0 0">
    <div>
      <div style="font-size:15px;font-weight:800;color:#fff">🔎 Ослын цагийн төлөв шалгах</div>
      <div style="font-size:11px;color:#bfdbfe;margin-top:2px">${escapeHtml(asset?.name||"")} · ${escapeHtml(asset?.location||"")}</div>
    </div>
    <button onclick="closeTrafficSignalModal()" style="border:none;background:rgba(255,255,255,.12);color:#fff;border-radius:8px;padding:6px 12px;cursor:pointer">✕</button>
  </div>
  <div style="padding:20px">
    <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:14px">
      <div>
        <div style="font-size:11px;color:#667085;margin-bottom:4px">Ослын огноо, цаг *</div>
        <input class="input" id="ts_check_at" type="datetime-local" value="${nowLocalInput()}" style="margin:0;width:210px">
      </div>
      <button class="btn" onclick="checkTrafficSignalAt(${assetId})">Шалгах</button>
      <button class="btn secondary" onclick="openTrafficSignalJournal(${assetId})">Журнал харах</button>
    </div>
    <div id="ts_check_result" style="border:1px dashed #cbd5e1;border-radius:10px;padding:18px;color:#64748b">
      Цаг оруулаад шалгахад тухайн мөчид хүчинтэй байсан журналын бичлэг гарна.
    </div>
  </div>`);
}

async function checkTrafficSignalAt(assetId) {
  const at = document.getElementById("ts_check_at")?.value;
  if (!at) { toast("Ослын огноо, цаг оруулна уу"); return; }
  const box = document.getElementById("ts_check_result");
  try {
    const r = await api(`/api/traffic-signal-status-at?asset_id=${assetId}&at=${encodeURIComponent(at)}`);
    const ok = r.matched && isTrafficOn(r.status);
    const warn = r.matched && !isTrafficOn(r.status);
    box.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px">
        <div>
          <div style="font-size:13px;color:#64748b">Шалгасан цаг</div>
          <div style="font-size:18px;font-weight:800;color:#0f172a;font-family:monospace">${escapeHtml(r.checked_at)}</div>
        </div>
        <div style="font-size:18px;font-weight:900;color:${ok?"#16a34a":warn?"#dc2626":"#d97706"}">
          ${ok?"🟢 Асаалттай байсан":warn?"🔴 Асаалтгүй / эрсдэлтэй төлөв":"⚠️ Журнал олдсонгүй"}
        </div>
      </div>
      <div style="background:${ok?"#f0fdf4":warn?"#fef2f2":"#fffbeb"};border-radius:10px;padding:12px 14px;font-size:13px">
        <b>Дохио:</b> ${escapeHtml(r.asset?.name||"")}<br>
        <b>Байршил:</b> ${escapeHtml(r.asset?.location||"")}<br>
        <b>Төлөв:</b> ${escapeHtml(r.status||"")}<br>
        ${r.log ? `<b>Хугацаа:</b> ${escapeHtml(r.log.started_at||"")} - ${escapeHtml(r.log.ended_at||"Одоо хүртэл")}<br>
        <b>Эх сурвалж:</b> ${escapeHtml(r.log.source||"")}<br>
        <b>Баримт:</b> ${escapeHtml(r.log.evidence_no||"")}<br>
        <b>Тайлбар:</b> ${escapeHtml(r.log.notes||"")}<br>
        <b>Бүртгэсэн:</b> ${escapeHtml(r.log.recorded_name||"")}` : "Тухайн цагийг хамарсан төлөвийн бичлэг байхгүй байна."}
      </div>`;
  } catch(e) {
    box.innerHTML = `<div style="color:#dc2626">${escapeHtml(e.message)}</div>`;
  }
}

function updateAssetFormStatus(cat) {
  const sel = document.getElementById("af_status");
  if (!sel) return;
  const isTraffic = cat === "Гэрлэн дохио";
  const opts = isTraffic ? ["Асаалтай","Унтраалтай"] : ASSET_STATUSES;
  sel.innerHTML = opts.map(s => `<option>${s}</option>`).join("");
}

async function openAssetForm(id) {
  let asset = null;
  if (id) {
    try { asset = await api(`/api/assets/${id}`); } catch(e){}
  }
  let meterPoints = [];
  try { meterPoints = await api("/api/mp"); } catch(e) {}
  const modal = document.getElementById("assetFormModal");
  const inner = document.getElementById("assetFormInner");
  const formCat = asset?.category || window._assetCat || "";
  const isCamera = formCat === "Камер";
  const title = isCamera ? (asset ? "✏️ Камерын цэг засах" : "+ Камерын цэг бүртгэх") : (asset ? "✏️ Объект засах" : "+ Объект бүртгэх");
  const isTraffic = formCat === "Гэрлэн дохио";
  const statusOpts = isCamera ? ["Идэвхтэй","Идэвхгүй"] : (isTraffic ? ["Асаалтай","Унтраалтай"] : ASSET_STATUSES);
  const conditionOpts = isCamera ? CAMERA_CONDITIONS : ASSET_CONDITIONS;
  const currentCondition = isCamera ? cameraConditionOf(asset) : asset?.condition;

  inner.innerHTML = `
    <div style="padding:16px 22px;border-bottom:1px solid #e2e6ed;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;background:#fff;z-index:2;border-radius:14px 14px 0 0">
      <span style="font-size:15px;font-weight:800">${title}</span>
      <button onclick="closeAssetForm()" style="border:none;background:#f1f5f9;border-radius:8px;padding:6px 14px;cursor:pointer;color:#667085">✕</button>
    </div>
      <div style="padding:18px 22px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Код ${formCat==="Шит/Самбар"?"*":""}</div>
          <input class="input" id="af_code" value="${escapeHtml(asset?.asset_code||"")}" list="assetCodeMeterList" data-asset-id="${id||""}"
            oninput="checkAssetCodeDuplicate(${id||"null"})"
            placeholder="${formCat==="Шит/Самбар"?"Жишээ: *K*2024100197":"Хоосон бол автоматаар үүснэ"}">
          <datalist id="assetCodeMeterList">
            ${meterPoints.map(m => `<option value="${escapeHtml(m.meter_no||"")}">${escapeHtml(m.location||m.name||"Тоолуур")}</option>`).join("")}
          </datalist>
          <div id="af_code_msg" style="font-size:10px;margin-top:4px;min-height:14px;color:#94a3b8">${formCat==="Шит/Самбар"?"Тоолуурын №-г шууд бичиж болно":""}</div>
        </div>
        <div>
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Хөрөнгийн нэр *</div>
          <input class="input" id="af_name" value="${escapeHtml(asset?.name||"")}" placeholder="Найрамдал паркийн гэрэлтүүлэг">
        </div>
        <div>
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Ангилал *</div>
          <select class="input" id="af_cat" onchange="updateAssetFormStatus(this.value)">
            ${(window._assetCatList||ASSET_CATEGORIES.map(c=>({name:c.id,icon:c.icon}))).map(c=>{
              const selected = asset ? asset.category===c.name : window._assetCat===c.name;
              return `<option value="${escapeHtml(c.name)}" ${selected?"selected":""}>${c.icon||"📦"} ${escapeHtml(c.name)}</option>`;
            }).join("")}
          </select>
        </div>
        <div>
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Дэд ангилал</div>
          <input class="input" id="af_subcat" value="${escapeHtml(asset?.sub_category||"")}" placeholder="Авто зам / Гэр хороолол...">
        </div>
        ${isCamera ? `<div>
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Камерын тоо *</div>
          <input class="input" type="number" min="1" step="1" id="af_camera_count" value="${cameraCountOf(asset)}" placeholder="1-4">
        </div>
        <div>
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Баг</div>
          <select class="input" id="af_bag_no">
            <option value="">— Сонгох —</option>
            ${Array.from({ length: 11 }, (_, i) => {
              const b = i + 1;
              return `<option value="${b}" ${Number(asset?.bag_no || 0)===b?"selected":""}>${b}-р баг</option>`;
            }).join("")}
            <option value="98" ${Number(asset?.bag_no || 0)===98?"selected":""}>Авто зам</option>
            <option value="99" ${Number(asset?.bag_no || 0)===99?"selected":""}>Аж ахуйн нэгж</option>
          </select>
        </div>` : ""}
        <div>
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Байршил</div>
          <input class="input" id="af_loc" value="${escapeHtml(asset?.location||"")}" placeholder="Найрамдал парк, Замын 3-р хэсэг...">
        </div>
        <div>
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Төлөв</div>
          <select class="input" id="af_status">
            ${statusOpts.map(s=>`<option ${asset?.status===s?"selected":""}>${s}</option>`).join("")}
          </select>
        </div>
        <div>
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Нөхцөл</div>
          <select class="input" id="af_cond">
            ${conditionOpts.map(c=>`<option ${currentCondition===c?"selected":""}>${c}</option>`).join("")}
          </select>
        </div>
        <div>
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Суурилуулсан огноо</div>
          <input class="input" type="date" id="af_date" value="${asset?.installed_date||""}">
        </div>
        <div>
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Баталгааны хугацаа</div>
          <input class="input" type="date" id="af_warranty" value="${asset?.warranty_until||""}">
        </div>
        <div>
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Анхны үнэ ₮</div>
          <input class="input" type="number" id="af_price" value="${asset?.purchase_price||0}">
        </div>
        <div>
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Ашиглалтын хугацаа (жил)</div>
          <input class="input" type="number" id="af_life" value="${asset?.useful_life_years||10}">
        </div>
        ${!isCamera ? `<div>
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Хариуцагч инженер</div>
          <select class="input" id="af_assign">
            <option value="">— Сонгох —</option>
            ${state.users.map(u=>`<option value="${u.id}" ${asset?.assigned_to==u.id?"selected":""}>${u.full_name} (${u.position||""})</option>`).join("")}
          </select>
        </div>` : ""}
        <div>
          <div style="font-size:11px;color:#667085;margin-bottom:4px">GPS (lat, lng)</div>
          <div style="display:flex;gap:6px">
            <input class="input" type="number" step="any" id="af_lat" value="${asset?.gps_lat||""}" placeholder="47.9136">
            <input class="input" type="number" step="any" id="af_lng" value="${asset?.gps_lng||""}" placeholder="114.5327">
          </div>
        </div>
      </div>
      <div style="margin-bottom:12px">
        <div style="font-size:11px;color:#667085;margin-bottom:4px">Техникийн үзүүлэлт</div>
        <textarea class="input" id="af_specs" style="min-height:60px;margin:0" placeholder="Хүч: 150W · Кабель: СИП 4x25 · Шон: 1747 · Толгой: 2182...">${escapeHtml(asset?.specs||"")}</textarea>
      </div>
      <div style="margin-bottom:16px">
        <div style="font-size:11px;color:#667085;margin-bottom:4px">Тайлбар / Тэмдэглэл</div>
        <textarea class="input" id="af_desc" style="min-height:50px;margin:0" placeholder="Нэмэлт мэдээлэл...">${escapeHtml(asset?.description||"")}</textarea>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn" onclick="saveAsset(${id||"null"})">Хадгалах</button>
        <button class="btn secondary" onclick="closeAssetForm()">Болих</button>
      </div>
    </div>`;

  modal.style.display = "flex";
  checkAssetCodeDuplicate(id || null);
}

function closeAssetForm() {
  const m = document.getElementById("assetFormModal");
  if (m) m.style.display = "none";
}

let _assetCodeCheckTimer = null;
function checkAssetCodeDuplicate(id) {
  clearTimeout(_assetCodeCheckTimer);
  const input = document.getElementById("af_code");
  const msg = document.getElementById("af_code_msg");
  if (!input || !msg) return;
  const code = input.value.trim();
  if (!code) {
    input.dataset.duplicate = "0";
    input.style.borderColor = "";
    msg.style.color = "#94a3b8";
    msg.textContent = "Код бичнэ үү";
    return;
  }
  _assetCodeCheckTimer = setTimeout(async () => {
    try {
      const r = await api(`/api/assets/check-code?code=${encodeURIComponent(code)}${id ? `&exclude_id=${id}` : ""}`);
      input.dataset.duplicate = r.exists ? "1" : "0";
      input.style.borderColor = r.exists ? "#ef4444" : "#16a34a";
      msg.style.color = r.exists ? "#dc2626" : "#16a34a";
      msg.textContent = r.exists ? `Давхардсан код байна: ${r.asset?.name || code}` : "Код ашиглах боломжтой";
    } catch(e) {
      input.dataset.duplicate = "0";
      msg.style.color = "#d97706";
      msg.textContent = "Код шалгаж чадсангүй";
    }
  }, 250);
}

// ── GER inventory form ────────────────────────────────────────
async function openGerForm(id) {
  let rec = null;
  if (id) { try { rec = await api(`/api/sl-ger-inventory/${id}`); } catch(e){} }
  const gerCat = GER_CAT_MAP[window._assetCat] || rec?.category || "Гэр хороолол";
  const inner = document.getElementById("gerFormInner");
  inner.innerHTML = `
    <div style="padding:16px 22px;border-bottom:1px solid #e2e6ed;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;background:#fff;z-index:2;border-radius:14px 14px 0 0">
      <span style="font-size:15px;font-weight:800">${id ? `✏️ ${escapeHtml(window._assetCat||"Байршил")} засах` : `+ Шинэ ${escapeHtml(window._assetCat||"байршил")} бүртгэх`}</span>
      <button onclick="closeGerForm()" style="border:none;background:#f1f5f9;border-radius:8px;padding:6px 14px;cursor:pointer;color:#667085">✕</button>
    </div>
    <div style="padding:18px 22px">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div style="grid-column:1/-1">
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Байршил *</div>
          <input class="input" id="gf_loc" value="${escapeHtml(rec?.location_name||"")}" placeholder="Найрамдал гудамж...">
        </div>
        <div>
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Баг дугаар</div>
          <input class="input" type="number" id="gf_bag" value="${rec?.bag_no??""}" placeholder="1">
        </div>
        <div>
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Нийт шон/байршил</div>
          <input class="input" type="number" id="gf_total" value="${rec?.total_count??0}">
        </div>
        <div>
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Нийт толгой</div>
          <input class="input" type="number" id="gf_head" value="${rec?.head_count??0}">
        </div>
        <div>
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Дутуу шон</div>
          <input class="input" type="number" min="0" id="gf_needs_poles" value="${rec?.needs_poles??0}">
        </div>
        <div>
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Гэрлийн төрөл</div>
          <input class="input" id="gf_type" value="${escapeHtml(rec?.light_type||"")}" placeholder="LED, ДРЛ, ЛМ...">
        </div>
        <div style="grid-column:1/-1">
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Тайлбар</div>
          <textarea class="input" id="gf_notes" style="min-height:50px;margin:0">${escapeHtml(rec?.notes||"")}</textarea>
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn" onclick="saveGerForm(${id||"null"},'${escapeHtml(gerCat)}')">Хадгалах</button>
        <button class="btn secondary" onclick="closeGerForm()">Болих</button>
      </div>
    </div>`;
  document.getElementById("gerFormModal").style.display = "flex";
}

function closeGerForm() {
  const m = document.getElementById("gerFormModal");
  if (m) m.style.display = "none";
}

async function saveGerForm(id, gerCat) {
  const g = el => (document.getElementById(el)||{}).value||"";
  const loc = g("gf_loc").trim();
  if (!loc) { toast("Байршил оруулна уу"); return; }
  const body = {
    location_name: loc,
    bag_no: g("gf_bag") ? Number(g("gf_bag")) : null,
    category: gerCat || GER_CAT_MAP[window._assetCat] || "Гэр хороолол",
    total_count: Number(g("gf_total")||0),
    head_count: Number(g("gf_head")||0),
    needs_poles: Number(g("gf_needs_poles")||0),
    light_type: g("gf_type"),
    notes: g("gf_notes"),
  };
  try {
    if (id) {
      await api(`/api/sl-ger-inventory/${id}`, { method:"PUT", body:JSON.stringify(body) });
      toast("Засагдлаа ✓");
    } else {
      await api("/api/sl-ger-inventory", { method:"POST", body:JSON.stringify(body) });
      toast("Байршил бүртгэгдлээ ✓");
    }
    closeGerForm();
    refreshAssetView(window._assetCat);
  } catch(err) { toast("Алдаа: "+err.message); }
}

// ── SL points form ────────────────────────────────────────────
async function openSlForm(id) {
  let rec = null;
  if (id) { try { rec = await api(`/api/sl-points/${id}`); } catch(e){} }
  const inner = document.getElementById("slFormInner");
  inner.innerHTML = `
    <div style="padding:16px 22px;border-bottom:1px solid #e2e6ed;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;background:#fff;z-index:2;border-radius:14px 14px 0 0">
      <span style="font-size:15px;font-weight:800">${id ? "✏️ Авто замын гэрэл засах" : "+ Шинэ авто замын гэрэл бүртгэх"}</span>
      <button onclick="closeSlForm()" style="border:none;background:#f1f5f9;border-radius:8px;padding:6px 14px;cursor:pointer;color:#667085">✕</button>
    </div>
    <div style="padding:18px 22px">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Цэгийн код *</div>
          <input class="input" id="sf_code" value="${escapeHtml(rec?.code||"")}" placeholder="ГТ-001">
        </div>
        <div>
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Нэр / Байршил *</div>
          <input class="input" id="sf_name" value="${escapeHtml(rec?.name||"")}" placeholder="Найрамдал гудамж">
        </div>
        <div style="grid-column:1/-1">
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Дэлгэрэнгүй байршил</div>
          <input class="input" id="sf_loc" value="${escapeHtml(rec?.location||"")}">
        </div>
        <div>
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Шонгийн тоо</div>
          <input class="input" type="number" id="sf_lamps" value="${rec?.lamp_count??1}">
        </div>
        <div>
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Нөхөх шон</div>
          <input class="input" type="number" min="0" id="sf_needs_poles" value="${rec?.needs_poles??0}">
        </div>
        <div>
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Нийт толгой</div>
          <input class="input" type="number" min="0" id="sf_total_heads" value="${rec?.total_heads??0}">
        </div>
        <div>
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Гэрлийн төрөл</div>
          <input class="input" id="sf_light_type" value="${escapeHtml(rec?.light_type||"")}" placeholder="лед 100">
        </div>
        <div>
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Төлөв</div>
          <select class="input" id="sf_status">
            <option value="active" ${(!rec||rec.status==="active"||rec.status==="Идэвхтэй")?"selected":""}>Идэвхтэй</option>
            <option value="inactive" ${(rec?.status==="inactive"||rec?.status==="Идэвхгүй")?"selected":""}>Идэвхгүй</option>
          </select>
        </div>
        <div>
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Суурилуулсан огноо</div>
          <input class="input" type="date" id="sf_date" value="${rec?.install_date||""}">
        </div>
        <div style="grid-column:1/-1">
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Тайлбар</div>
          <textarea class="input" id="sf_notes" style="min-height:50px;margin:0">${escapeHtml(rec?.notes||"")}</textarea>
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn" onclick="saveSlForm(${id||"null"})">Хадгалах</button>
        <button class="btn secondary" onclick="closeSlForm()">Болих</button>
      </div>
    </div>`;
  document.getElementById("slFormModal").style.display = "flex";
}

function closeSlForm() {
  const m = document.getElementById("slFormModal");
  if (m) m.style.display = "none";
}

async function saveSlForm(id) {
  const g = el => (document.getElementById(el)||{}).value||"";
  const code = g("sf_code").trim();
  const name = g("sf_name").trim();
  if (!code) { toast("Код оруулна уу"); return; }
  if (!name) { toast("Нэр оруулна уу"); return; }
  const body = {
    code, name,
    location: g("sf_loc"),
    lamp_count: Number(g("sf_lamps")||1),
    total_heads: Number(g("sf_total_heads")||0),
    light_type: g("sf_light_type"),
    needs_poles: Number(g("sf_needs_poles")||0),
    status: g("sf_status"),
    install_date: g("sf_date")||null,
    notes: g("sf_notes"),
  };
  try {
    if (id) {
      await api(`/api/sl-points/${id}`, { method:"PUT", body:JSON.stringify(body) });
      toast("Засагдлаа ✓");
    } else {
      await api("/api/sl-points", { method:"POST", body:JSON.stringify(body) });
      toast("Цэг бүртгэгдлээ ✓");
    }
    closeSlForm();
    refreshAssetView(window._assetCat);
  } catch(err) { toast("Алдаа: "+err.message); }
}

async function saveAsset(id) {
  const g = el => (document.getElementById(el)||{}).value||"";
  const name = g("af_name").trim();
  if (!name) { toast("Нэр оруулна уу"); return; }
  const category = g("af_cat");
  const assetCode = g("af_code").trim();
  if (category === "Шит/Самбар" && !assetCode) { toast("Шит/Самбарын код оруулна уу"); return; }
  if ((document.getElementById("af_code")||{}).dataset?.duplicate === "1") {
    toast("Код давхардсан байна");
    return;
  }
  const body = {
    asset_code: assetCode,
    name, category, sub_category: g("af_subcat"),
    location: g("af_loc"), status: g("af_status"), condition: g("af_cond"),
    installed_date: g("af_date")||null, warranty_until: g("af_warranty")||null,
    purchase_price: Number(g("af_price")||0), useful_life_years: Number(g("af_life")||10),
    assigned_to: g("af_assign")||null,
    gps_lat: parseFloat(g("af_lat"))||null, gps_lng: parseFloat(g("af_lng"))||null,
    camera_count: category === "Камер" ? Math.max(1, Number(g("af_camera_count") || 1)) : null,
    bag_no: category === "Камер" ? (Number(g("af_bag_no") || 0) || null) : null,
    specs: g("af_specs"), description: g("af_desc"),
  };
  try {
    if (id) {
      await api(`/api/assets/${id}`, { method:"PUT", body:JSON.stringify(body) });
      toast("Объект засагдлаа ✓");
      closeAssetForm();
      if (category === "Камер") _cameraAssetBagFilter = body.bag_no ? String(body.bag_no) : "";
      refreshAssetView(window._assetCat);
    } else {
      const r = await api("/api/assets", { method:"POST", body:JSON.stringify(body) });
      toast(`Объект бүртгэгдлээ ✓ (${r.asset_code})`);
      closeAssetForm();
      if (category === "Камер") _cameraAssetBagFilter = body.bag_no ? String(body.bag_no) : "";
      refreshAssetView(body.category);
    }
  } catch(err) { toast("Алдаа: "+err.message); }
}

async function importPanelsFromMeters() {
  if (!confirm("Тоолуурын бүртгэлээс Шит/Самбар автоматаар үүсгэж холбоx уу? Давхардсан кодтойг дахин үүсгэхгүй.")) return;
  try {
    const r = await api("/api/assets/panels/import-meters", { method:"POST", body:JSON.stringify({}) });
    toast(`Тоолуураас татлаа ✓ Шинээр: ${r.created}, Холбосон: ${r.linked}, Алгассан: ${r.skipped}`);
    assets("Шит/Самбар");
  } catch(err) {
    toast("Алдаа: " + err.message);
  }
}

async function openPassport(id) {
  const modal = document.getElementById("assetPassportModal");
  const inner = document.getElementById("assetPassportInner");
  if (!modal || !inner) return;

  inner.innerHTML = `<div style="padding:40px;text-align:center;color:#667085">
    <div style="font-size:28px;margin-bottom:12px">⏳</div>Уншиж байна...
  </div>`;
  modal.style.display = "flex";

  let asset;
  try { asset = await api(`/api/assets/${id}`); }
  catch(e) { inner.innerHTML = `<div style="padding:24px;color:#dc2626">Алдаа: ${e.message}</div>`; return; }

  const cat     = ASSET_CATEGORIES.find(c => c.id === asset.category) || ASSET_CATEGORIES[7];
  const lightingCats = new Set(["Авто замын гэрэл", "Гэр хорооллын гэрэл", "Цамхагийн гэрэл", "Шит/Самбар", "Гэрлэн дохио"]);
  const canEdit = ["director","chief_engineer","storekeeper","engineer","electric","camera_engineer"].includes(state.me.role);
  const canDel  = ["director","chief_engineer"].includes(state.me.role) ||
                  (["engineer","electric"].includes(state.me.role) && lightingCats.has(asset.category));

  const installed  = asset.installed_date ? new Date(asset.installed_date) : null;
  const ageYears   = installed ? (Date.now() - installed) / (1000*60*60*24*365.25) : 0;
  const lifeYears  = asset.useful_life_years || 10;
  const deprPct    = Math.min(100, Math.round(ageYears / lifeYears * 100));
  const curValue   = Math.round((asset.purchase_price||0) * (1 - deprPct/100));
  const deprColor  = deprPct >= 80 ? "#dc2626" : deprPct >= 50 ? "#d97706" : "#16a34a";
  const condColor  = {"Хэвийн":"#16a34a","Засвар хэрэгтэй":"#d97706","Хугацаа дууссан":"#dc2626","Ашиглалтаас гарсан":"#94a3b8"}[asset.condition] || "#667085";

  const files   = asset.files   || [];
  const history = asset.history || [];
  const photos  = files.filter(f => f.file_type==="photo" || /\.(jpg|jpeg|png|gif|webp)$/i.test(f.file_path||""));
  const cadFiles= files.filter(f => f.file_type==="autocad" || /\.(dwg|dxf)$/i.test(f.file_path||""));
  const docs    = files.filter(f => !photos.includes(f) && !cadFiles.includes(f));

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(
    `ЧОЙБАЛСАН ХӨГЖИЛ ОНӨҮГ\nКод: ${asset.asset_code||""}\nНэр: ${asset.name}\nБайршил: ${asset.location||""}\n${location.origin}/assets/${id}`
  )}`;

  inner.innerHTML = `
  <div style="background:linear-gradient(135deg,#0f1623 0%,#1a2840 60%,#0f1623 100%);border-radius:14px 14px 0 0;padding:22px 26px;position:relative;overflow:hidden">
    <div style="position:absolute;right:-50px;top:-50px;width:200px;height:200px;border-radius:50%;background:${cat.color};opacity:.1;pointer-events:none"></div>
    <div style="position:absolute;left:0;top:0;bottom:0;width:4px;background:${cat.color};border-radius:14px 0 0 0"></div>
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;position:relative">
      <div style="flex:1;min-width:0">
        <div style="font-size:10px;color:rgba(255,255,255,.45);letter-spacing:.15em;text-transform:uppercase;margin-bottom:8px">
          ${cat.icon} ${asset.category} · ОБЪЕКТИЙН ПАСПОРТ
        </div>
        <div style="font-size:22px;font-weight:800;color:#fff;margin-bottom:8px;line-height:1.2">${escapeHtml(asset.name)}</div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-family:monospace;font-size:12px;background:rgba(255,255,255,.1);color:rgba(255,255,255,.8);padding:4px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.15)">${asset.asset_code||"—"}</span>
          <span style="font-size:11px;padding:4px 10px;border-radius:20px;background:${asset.status==="Идэвхтэй"?"rgba(46,204,138,.2)":"rgba(148,163,184,.15)"};color:${asset.status==="Идэвхтэй"?"#4ade80":"#94a3b8"};border:1px solid ${asset.status==="Идэвхтэй"?"rgba(74,222,128,.3)":"rgba(148,163,184,.2)"}">${asset.status}</span>
          <span style="font-size:11px;color:${condColor};font-weight:600">● ${asset.condition}</span>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:8px;flex-shrink:0">
        <img src="${qrUrl}" style="width:80px;height:80px;border-radius:8px;border:2px solid rgba(255,255,255,.15);background:rgba(255,255,255,.05)" alt="QR">
        <div style="font-size:9px;color:rgba(255,255,255,.4);letter-spacing:.06em">QR КОД</div>
      </div>
    </div>
    <button onclick="closePassport()" style="position:absolute;top:14px;right:14px;border:none;background:rgba(255,255,255,.1);color:rgba(255,255,255,.6);border-radius:8px;padding:5px 12px;cursor:pointer;font-size:12px;z-index:1">✕</button>
  </div>

  <div style="display:flex;border-bottom:1px solid #e2e6ed;background:#f8f9fb;padding:0 20px">
    ${(()=>{
      const isPanel = asset.category === "Шит/Самбар";
      const tabs   = ["info","files","map","history", ...(isPanel?["meters"]:[])];
      const labels = ["ℹ️ Мэдээлэл","📁 Файлууд","🗺 Байршил","🛠 Засварын түүх","🔌 Тоолуур"];
      const counts = ["",(files.length||""),"",(history.length||""),""];
      return tabs.map((t,i)=>`<button id="pt_${t}" onclick="switchPassportTab('${t}',${id})"
        style="padding:10px 14px;border:none;background:none;cursor:pointer;font-size:12px;font-weight:600;color:${i===0?'#1d4ed8':'#667085'};border-bottom:2px solid ${i===0?'#1d4ed8':'transparent'};margin-bottom:-1px;white-space:nowrap">
        ${labels[i]}${counts[i]?` <span style="font-size:10px;background:#e2e6ed;padding:1px 6px;border-radius:10px">${counts[i]}</span>`:""}
      </button>`).join("");
    })()}
    ${canEdit ? `<button onclick="openAssetForm(${id})" style="margin-left:auto;padding:8px 14px;border:none;background:none;cursor:pointer;font-size:11px;color:#2563eb;font-weight:600">✏️ Засах</button>` : ""}
    ${canDel  ? `<button onclick="confirmDeleteAsset(${id})" style="padding:8px 14px;border:none;background:none;cursor:pointer;font-size:11px;color:#dc2626;font-weight:600">🗑 Устгах</button>` : ""}
  </div>

  <div id="passportTabContent" style="max-height:65vh;overflow-y:auto">
    <div id="ptab_info" style="padding:20px 24px">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:18px">
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px;text-align:center">
          <div style="font-size:10px;color:#16a34a;font-weight:600;letter-spacing:.06em;margin-bottom:4px">АНХНЫ ҮНЭ</div>
          <div style="font-size:17px;font-weight:800;color:#16a34a">${(asset.purchase_price||0).toLocaleString()}<span style="font-size:11px">₮</span></div>
        </div>
        <div style="background:${deprPct>=80?"#fef2f2":deprPct>=50?"#fff7ed":"#f0fdf4"};border:1px solid ${deprPct>=80?"#fecaca":deprPct>=50?"#fed7aa":"#bbf7d0"};border-radius:10px;padding:12px;text-align:center">
          <div style="font-size:10px;color:${deprColor};font-weight:600;letter-spacing:.06em;margin-bottom:4px">ЭЛЭГДЭЛ</div>
          <div style="font-size:17px;font-weight:800;color:${deprColor}">${deprPct}%</div>
          <div style="height:4px;background:#e2e6ed;border-radius:2px;margin-top:6px;overflow:hidden">
            <div style="height:100%;width:${deprPct}%;background:${deprColor};border-radius:2px;transition:width .6s"></div>
          </div>
        </div>
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:12px;text-align:center">
          <div style="font-size:10px;color:#2563eb;font-weight:600;letter-spacing:.06em;margin-bottom:4px">ОДООГИЙН ҮНЭ</div>
          <div style="font-size:17px;font-weight:800;color:#2563eb">${curValue.toLocaleString()}<span style="font-size:11px">₮</span></div>
        </div>
        <div style="background:#f8f9fb;border:1px solid #e2e6ed;border-radius:10px;padding:12px;text-align:center">
          <div style="font-size:10px;color:#667085;font-weight:600;letter-spacing:.06em;margin-bottom:4px">АШИГЛАЛТ</div>
          <div style="font-size:17px;font-weight:800;color:#344054">${Math.round(ageYears*10)/10}<span style="font-size:11px"> / ${lifeYears}жил</span></div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
        ${[
          ["📍 Байршил",        asset.location||"—"],
          ["👤 Хариуцагч",      asset.assigned_name||"—"],
          ["🏷 Дэд ангилал",    asset.sub_category||"—"],
          ["📅 Суурилуулсан",   asset.installed_date||"—"],
          ["📅 Баталгааны хугацаа", asset.warranty_until||"—"],
          ["🔢 Кодлогдсон",     asset.asset_code||"—"],
        ].map(([l,v]) => `
          <div style="background:#f8f9fb;border:1px solid #e2e6ed;border-radius:8px;padding:10px 14px;display:flex;align-items:flex-start;gap:10px">
            <span style="font-size:14px;flex-shrink:0;margin-top:1px">${l.split(" ")[0]}</span>
            <div style="min-width:0">
              <div style="font-size:10px;color:#94a3b8;margin-bottom:2px">${l.split(" ").slice(1).join(" ")}</div>
              <div style="font-size:13px;font-weight:600;color:#172033;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(String(v))}</div>
            </div>
          </div>`).join("")}
      </div>

      ${asset.specs ? `
        <div style="background:#0f1623;border-radius:10px;padding:14px 16px;margin-bottom:14px">
          <div style="font-size:10px;color:rgba(255,255,255,.4);letter-spacing:.12em;text-transform:uppercase;margin-bottom:8px">⚙️ ТЕХНИКИЙН ҮЗҮҮЛЭЛТ</div>
          <pre style="font-family:'JetBrains Mono',monospace;font-size:12px;color:#a5f3fc;margin:0;white-space:pre-wrap;line-height:1.7">${escapeHtml(asset.specs)}</pre>
        </div>` : ""}

      ${asset.description ? `
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 14px">
          <div style="font-size:10px;color:#d97706;font-weight:600;margin-bottom:6px">📝 ТЭМДЭГЛЭЛ</div>
          <div style="font-size:13px;color:#344054;line-height:1.6">${escapeHtml(asset.description)}</div>
        </div>` : ""}
    </div>

    <div id="ptab_files" style="display:none;padding:20px 24px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div style="font-size:13px;font-weight:700;color:#344054">Нийт ${files.length} файл</div>
        ${canEdit ? `
          <div style="display:flex;gap:8px">
            <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-size:11px;background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe;border-radius:8px;padding:6px 12px;font-weight:600">
              📷 Зураг нэмэх
              <input type="file" id="af_photo" accept="image/*" multiple style="display:none" onchange="uploadAssetFiles(${id},'photo',this)">
            </label>
            <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-size:11px;background:#f5f3ff;color:#7c3aed;border:1px solid #ddd6fe;border-radius:8px;padding:6px 12px;font-weight:600">
              📐 AutoCAD нэмэх
              <input type="file" id="af_cad" accept=".dwg,.dxf,.pdf" style="display:none" onchange="uploadAssetFiles(${id},'autocad',this)">
            </label>
            <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-size:11px;background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;border-radius:8px;padding:6px 12px;font-weight:600">
              📄 Баримт нэмэх
              <input type="file" id="af_doc" accept=".pdf,.doc,.docx,.xls,.xlsx" style="display:none" onchange="uploadAssetFiles(${id},'document',this)">
            </label>
          </div>` : ""}
      </div>

      ${photos.length ? (() => {
          const photoSrcs = photos.map(f => "/" + (f.file_path||"").replace(/^\/?/,""));
          const psJson = JSON.stringify(photoSrcs);
          return `<div style="margin-bottom:16px">
            <div style="font-size:11px;font-weight:700;color:#667085;letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px">📷 Зургийн галерей (${photos.length})</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px">
              ${photos.map((f,fi) => {
                const src = photoSrcs[fi];
                return `<div style="border-radius:10px;overflow:hidden;border:1px solid #e2e6ed;position:relative">
                  <img src="${src}" style="width:100%;height:110px;object-fit:cover;cursor:pointer;display:block"
                    onclick="openLightbox(${psJson},${fi})">
                  <div style="padding:6px 8px;background:#fff">
                    <div style="font-size:10px;color:#344054;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(f.description||f.file_name||"—")}</div>
                    <div style="font-size:9px;color:#94a3b8">${(f.uploaded_at||"").slice(0,10)}</div>
                  </div>
                  ${canEdit ? `<button onclick="deleteAssetFile(${f.id},${id})"
                    style="position:absolute;top:4px;right:4px;background:rgba(220,38,38,.85);color:#fff;border:none;border-radius:4px;padding:2px 6px;font-size:10px;cursor:pointer">✕</button>` : ""}
                </div>`;
              }).join("")}
            </div>
          </div>`;
        })() : ""}

      ${cadFiles.length ? `
        <div style="margin-bottom:16px">
          <div style="font-size:11px;font-weight:700;color:#667085;letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px">📐 AutoCAD & Схем (${cadFiles.length})</div>
          ${cadFiles.map(f => {
            const src = (f.file_path||"").replace(/^\/?/,"");
            return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:8px;margin-bottom:6px">
              <div style="display:flex;align-items:center;gap:10px">
                <span style="font-size:22px">📐</span>
                <div>
                  <div style="font-size:13px;font-weight:600;color:#5b21b6">${escapeHtml(f.description||f.file_name||"CAD файл")}</div>
                  <div style="font-size:10px;color:#7c3aed">${(f.uploaded_at||"").slice(0,10)}</div>
                </div>
              </div>
              <div style="display:flex;gap:6px">
                <button onclick="window.open('/${src}','_blank')" class="btn secondary" style="padding:4px 10px;font-size:11px">⬇️ Татах</button>
                ${canEdit ? `<button onclick="deleteAssetFile(${f.id},${id})" class="btn danger" style="padding:4px 10px;font-size:11px">✕</button>` : ""}
              </div>
            </div>`;
          }).join("")}
        </div>` : ""}

      ${docs.length ? `
        <div>
          <div style="font-size:11px;font-weight:700;color:#667085;letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px">📄 Баримт бичиг (${docs.length})</div>
          ${docs.map(f => {
            const src = (f.file_path||"").replace(/^\/?/,"");
            const ext = (f.file_name||"").split(".").pop().toUpperCase();
            return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#f8f9fb;border:1px solid #e2e6ed;border-radius:8px;margin-bottom:6px">
              <div style="display:flex;align-items:center;gap:10px">
                <span style="font-size:20px">📄</span>
                <div>
                  <div style="font-size:13px;font-weight:600">${escapeHtml(f.description||f.file_name||"Файл")}</div>
                  <div style="font-size:10px;color:#94a3b8">${ext} · ${(f.uploaded_at||"").slice(0,10)}</div>
                </div>
              </div>
              <div style="display:flex;gap:6px">
                <button onclick="window.open('/${src}','_blank')" class="btn secondary" style="padding:4px 10px;font-size:11px">⬇️ Нээх</button>
                ${canEdit ? `<button onclick="deleteAssetFile(${f.id},${id})" class="btn danger" style="padding:4px 10px;font-size:11px">✕</button>` : ""}
              </div>
            </div>`;
          }).join("")}
        </div>` : ""}

      ${!files.length ? `<div style="text-align:center;padding:30px;color:#94a3b8">
        <div style="font-size:32px;margin-bottom:8px">📁</div>Файл хавсаргагдаагүй байна
      </div>` : ""}
    </div>

    <div id="ptab_map" style="display:none;padding:0">
      ${asset.gps_lat && asset.gps_lng ? `
        <div id="passportMap" style="height:320px;width:100%"></div>
        <div style="padding:12px 20px;background:#f8f9fb;border-top:1px solid #e2e6ed;display:flex;align-items:center;gap:12px">
          <span style="font-family:monospace;font-size:12px;color:#344054">📍 ${asset.gps_lat}, ${asset.gps_lng}</span>
          <a href="https://www.google.com/maps?q=${asset.gps_lat},${asset.gps_lng}" target="_blank"
            style="font-size:11px;color:#2563eb;text-decoration:none;font-weight:600">Google Maps-д нээх →</a>
        </div>` : `
        <div style="padding:40px;text-align:center;color:#94a3b8">
          <div style="font-size:32px;margin-bottom:10px">🗺</div>
          <div>GPS координат бүртгэгдээгүй байна</div>
          ${canEdit ? `<button class="btn secondary" style="margin-top:12px;font-size:12px" onclick="switchPassportTab('info');closePassport();openAssetForm(${id})">GPS нэмэх →</button>` : ""}
        </div>`}
    </div>

    <div id="ptab_history" style="display:none;padding:20px 24px">
      <!-- ХАБЭА эрсдэлийн түүх -->
      <div id="assetRisksSection" style="margin-bottom:18px">
        <div style="font-size:12px;color:#94a3b8;padding:8px 0">⚠️ ХАБЭА эрсдэлийг ачааллаж байна...</div>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div style="font-size:13px;font-weight:700;color:#344054">Засварын түүх (${history.length})</div>
        ${canEdit ? `<button class="btn" style="font-size:11px;padding:6px 12px" onclick="closePassport();window.workCat='${asset.category==="Авто замын гэрэл"?"Авто замын гэрэл засвар":"Камер засвар"}';show('work')">+ Шинэ ажил нэмэх</button>` : ""}
      </div>
      ${history.length ? `
        <div style="position:relative;padding-left:24px">
          <div style="position:absolute;left:8px;top:0;bottom:0;width:2px;background:#e2e6ed"></div>
          ${history.map((w,i) => {
            const isNew = i === 0;
            const statusColor = w.status==="Дууссан" ? "#16a34a" : w.status==="Явцтай" ? "#2563eb" : "#d97706";
            return `<div style="position:relative;margin-bottom:14px">
              <div style="position:absolute;left:-20px;top:10px;width:10px;height:10px;border-radius:50%;background:${isNew?"#2563eb":"#e2e6ed"};border:2px solid ${isNew?"#2563eb":"#94a3b8"}"></div>
              <div style="background:${isNew?"#eff6ff":"#f8f9fb"};border:1px solid ${isNew?"#bfdbfe":"#e2e6ed"};border-radius:10px;padding:12px 14px">
                <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:6px">
                  <div style="font-size:13px;font-weight:700;color:#172033">${escapeHtml(w.title||"")}</div>
                  <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
                    <span style="font-size:10px;padding:2px 8px;border-radius:20px;background:${w.status==="Дууссан"?"#dcfce7":"#dbeafe"};color:${statusColor}">${w.status||""}</span>
                    <span style="font-size:10px;color:#94a3b8;font-family:monospace">${w.work_date||""}</span>
                  </div>
                </div>
                ${w.description ? `<div style="font-size:12px;color:#667085;line-height:1.5;margin-bottom:4px">${escapeHtml(w.description)}</div>` : ""}
                ${w.created_name ? `<div style="font-size:11px;color:#94a3b8">👤 ${escapeHtml(w.created_name)}</div>` : ""}
                ${w.cost_amount ? `<div style="font-size:11px;color:#16a34a;font-weight:600;margin-top:4px">💰 ${Number(w.cost_amount).toLocaleString()}₮</div>` : ""}
              </div>
            </div>`;
          }).join("")}
        </div>` : `
        <div style="text-align:center;padding:30px;color:#94a3b8">
          <div style="font-size:32px;margin-bottom:8px">🛠</div>Засварын түүх байхгүй байна
        </div>`}
    </div>

    ${asset.category === "Шит/Самбар" ? `
    <div id="ptab_meters" style="display:none;padding:20px 24px">
      <div id="panelMetersContent" style="text-align:center;color:#94a3b8;padding:30px">
        <div style="font-size:28px;margin-bottom:8px">⏳</div>Уншиж байна...
      </div>
    </div>` : ""}
  </div>

  `;

  if (asset.gps_lat && asset.gps_lng) {
    setTimeout(() => initPassportMap(asset.gps_lat, asset.gps_lng, asset.name), 100);
  }
  loadAssetSafetyRisks(id);
}

async function loadAssetSafetyRisks(assetId) {
  const el = document.getElementById('assetRisksSection');
  if (!el) return;
  try {
    const risks = await api(`/api/safety-reports?ref_type=assets&ref_id=${assetId}`);
    if (!risks.length) { el.innerHTML = ''; return; }
    const COLORS = {'Маш өндөр':['#fee2e2','#dc2626'],'Өндөр':['#ffedd5','#ea580c'],'Дунд':['#fef9c3','#ca8a04'],'Бага':['#dcfce7','#16a34a']};
    el.innerHTML = `
      <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:14px;margin-bottom:4px">
        <div style="font-size:12px;font-weight:700;color:#c2410c;margin-bottom:10px">⚠️ ХАБЭА эрсдэлийн түүх (${risks.length})</div>
        ${risks.map(r => {
          const [bg,color] = COLORS[r.risk_level] || ['#f1f5f9','#64748b'];
          return `<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid #fed7aa;last-child:border-bottom:none">
            <span style="padding:2px 9px;border-radius:20px;font-size:10px;font-weight:800;background:${bg};color:${color};flex-shrink:0">${escapeHtml(r.risk_level||'')}</span>
            <div style="flex:1;min-width:0">
              <div style="font-size:12px;font-weight:600;color:#1e293b">${escapeHtml(r.risk_type||'—')}</div>
              <div style="font-size:10px;color:#94a3b8">${r.report_date||''} · ${escapeHtml(r.creator_name||'—')} · ${escapeHtml(r.workflow_status||'Шинэ')}</div>
              ${r.risk_description ? `<div style="font-size:11px;color:#475569;margin-top:2px">${escapeHtml(r.risk_description)}</div>` : ''}
            </div>
          </div>`;
        }).join('')}
      </div>`;
  } catch { if (el) el.innerHTML = ''; }
}

function switchPassportTab(tab, panelId) {
  ["info","files","map","history","meters"].forEach(t => {
    const el = document.getElementById(`ptab_${t}`);
    const btn= document.getElementById(`pt_${t}`);
    if (el)  el.style.display = t===tab ? "block" : "none";
    if (btn) {
      btn.style.color       = t===tab ? "#1d4ed8" : "#667085";
      btn.style.borderBottom= t===tab ? "2px solid #1d4ed8" : "2px solid transparent";
    }
  });
  if (tab === "map") setTimeout(() => window._passportMap?.invalidateSize(), 100);
  if (tab === "meters" && panelId) loadPanelMeters(panelId);
}

async function loadPanelMeters(panelId) {
  const wrap = document.getElementById("panelMetersContent");
  if (!wrap) return;
  wrap.innerHTML = `<div style="text-align:center;color:#94a3b8;padding:20px">⏳ Уншиж байна...</div>`;

  let meters, allMeters;
  try {
    [meters, allMeters] = await Promise.all([
      api(`/api/mp/by-panel/${panelId}`),
      api("/api/mp").catch(() => []),
    ]);
  } catch(e) { wrap.innerHTML = `<div style="color:#dc2626;padding:16px">Алдаа: ${e.message}</div>`; return; }

  const canEd = ["director","chief_engineer","engineer","accountant"].includes(state.me?.role);
  const ownerBadge = o => ({OURS:"✅ Манайх",OTHER:"🔲 Бусад",TRANSFERRED:"🔄 Шилжүүлсэн"}[o] || o || "—");
  const linked = new Set(meters.map(m => m.id));

  wrap.innerHTML = `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px">
    <div>
      <div style="font-size:14px;font-weight:700;color:#1e293b">🔌 Тоолуурын бүртгэл</div>
      <div style="font-size:11px;color:#64748b">Энэ самбарт бүртгэлтэй тоолуурууд</div>
    </div>
    ${canEd ? `
    <div style="display:flex;align-items:center;gap:8px">
      <select id="meterLinkSel" style="padding:6px 10px;border:1px solid #e2e6ed;border-radius:8px;font-size:12px;outline:none;max-width:220px">
        <option value="">— Тоолуур холбох —</option>
        ${allMeters.filter(m=>!linked.has(m.id)&&m.status!=='REMOVED').map(m=>`<option value="${m.id}">${escapeHtml(m.meter_no)}${m.location?' · '+escapeHtml(m.location):''}</option>`).join("")}
      </select>
      <button class="btn" style="padding:6px 14px;font-size:12px" onclick="linkMeterToPanel(${panelId})">+ Холбох</button>
    </div>` : ""}
  </div>

  ${meters.length === 0 ? `
  <div style="text-align:center;padding:32px;color:#94a3b8;background:#f8f9fb;border-radius:12px;border:1px dashed #e2e6ed">
    <div style="font-size:28px;margin-bottom:8px">🔌</div>
    Тоолуур холбогдоогүй байна
  </div>` : `
  <div style="display:flex;flex-direction:column;gap:8px">
    ${meters.map(m=>`
    <div style="display:flex;align-items:center;justify-content:space-between;background:#f8fafc;border:1px solid #e2e6ed;border-radius:10px;padding:10px 14px;gap:10px">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700;color:#172033;font-family:monospace">${escapeHtml(m.meter_no)}</div>
        ${m.location?`<div style="font-size:11px;color:#64748b;margin-top:2px">📍 ${escapeHtml(m.location)}</div>`:""}
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
        <span style="font-size:11px;padding:2px 10px;border-radius:20px;background:${m.owner_status==='OURS'?'#dcfce7':'#f1f5f9'};color:${m.owner_status==='OURS'?'#16a34a':'#475569'};font-weight:600">${ownerBadge(m.owner_status)}</span>
        <span style="font-size:10px;padding:2px 8px;border-radius:20px;background:${m.verified?'#eff6ff':'#fef9c3'};color:${m.verified?'#2563eb':'#a16207'};font-weight:600">${m.verified?'✓ Баталгаажсан':'❓ Хүлээгдэж буй'}</span>
        ${canEd?`<button onclick="unlinkMeterFromPanel(${m.id},${panelId})" style="border:none;background:none;cursor:pointer;color:#dc2626;font-size:14px;padding:2px 4px" title="Салгах">✕</button>`:""}
      </div>
    </div>`).join("")}
  </div>`}
  `;
}

async function linkMeterToPanel(panelId) {
  const sel = document.getElementById("meterLinkSel");
  if (!sel || !sel.value) return toast("Тоолуур сонгоно уу");
  try {
    await api(`/api/mp/${sel.value}/panel`, { method:"PUT", body:JSON.stringify({ panel_asset_id: panelId }) });
    toast("Тоолуур холбогдлоо ✓");
    loadPanelMeters(panelId);
  } catch(e) { toast("Алдаа: "+e.message); }
}

async function unlinkMeterFromPanel(meterId, panelId) {
  if (!confirm("Тоолуурыг энэ самбараас салгах уу?")) return;
  try {
    await api(`/api/mp/${meterId}/panel`, { method:"PUT", body:JSON.stringify({ panel_asset_id: null }) });
    toast("Салгагдлаа ✓");
    loadPanelMeters(panelId);
  } catch(e) { toast("Алдаа: "+e.message); }
}

function initPassportMap(lat, lng, name) {
  const mapEl = document.getElementById("passportMap");
  if (!mapEl) return;
  if (window._passportMap) {
    try { window._passportMap.remove(); } catch(e){}
    window._passportMap = null;
  }
  if (typeof L === "undefined") {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
    document.head.appendChild(css);
    const js = document.createElement("script");
    js.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
    js.onload = () => _createMap(mapEl, lat, lng, name);
    document.head.appendChild(js);
  } else {
    _createMap(mapEl, lat, lng, name);
  }
}

function _createMap(mapEl, lat, lng, name) {
  const map = L.map(mapEl).setView([lat, lng], 15);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors", maxZoom: 19
  }).addTo(map);
  L.marker([lat, lng])
    .addTo(map)
    .bindPopup(`<b>${escapeHtml(name)}</b><br>${lat}, ${lng}`)
    .openPopup();
  window._passportMap = map;
}

let _lbImages = [], _lbIdx = 0;

function openLightbox(srcs, index = 0) {
  _lbImages = Array.isArray(srcs) ? srcs : [srcs];
  _lbIdx = index;
  _lbRender();
  const lb = document.getElementById("globalLightbox");
  if (lb) lb.style.display = "flex";
}

function _lbRender() {
  const img  = document.getElementById("lbImg");
  const cap  = document.getElementById("lbCaption");
  const prev = document.getElementById("lbPrev");
  const next = document.getElementById("lbNext");
  if (img) img.src = _lbImages[_lbIdx] || "";
  const multi = _lbImages.length > 1;
  if (prev) prev.style.display = multi ? "block" : "none";
  if (next) next.style.display = multi ? "block" : "none";
  if (cap)  cap.textContent = multi ? `${_lbIdx + 1} / ${_lbImages.length}` : "";
}

function lightboxNav(dir) {
  _lbIdx = (_lbIdx + dir + _lbImages.length) % _lbImages.length;
  _lbRender();
}

function closeLightbox() {
  const lb = document.getElementById("globalLightbox");
  if (lb) lb.style.display = "none";
  _lbImages = []; _lbIdx = 0;
}

function closePassport() {
  const m = document.getElementById("assetPassportModal");
  if (m) m.style.display = "none";
  if (window._passportMap) {
    try { window._passportMap.remove(); } catch(e){}
    window._passportMap = null;
  }
}

async function confirmDeleteAsset(id) {
  if (!confirm("Энэ объектийг бүртгэлээс хасах уу?")) return;
  try {
    await api(`/api/assets/${id}`, { method:"DELETE" });
    toast("Объект устгагдлаа ✓");
    closePassport();
    refreshAssetView(window._assetCat);
  } catch(err) { toast("Алдаа: "+err.message); }
}

async function uploadAssetFiles(assetId, fileType, input) {
  if (!input?.files?.length) return;
  let ok = 0;
  for (const file of input.files) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("file_type", fileType);
    fd.append("description", file.name);
    try {
      await fetch(API + `/api/assets/${assetId}/files`, {
        method:"POST", headers:{"Authorization":"Bearer "+state.token}, body:fd
      });
      ok++;
    } catch(e) {}
  }
  toast(`${ok} файл хадгаллаа ✓`);
  openPassport(assetId);
}

async function deleteAssetFile(fileId, assetId) {
  if (!confirm("Файл устгах уу?")) return;
  try {
    await api(`/api/asset-files/${fileId}`, { method:"DELETE" });
    toast("Файл устгагдлаа ✓");
    openPassport(assetId);
  } catch(err) { toast("Алдаа: "+err.message); }
}

function renderSlRepairHistory(history = [], cat = "") {
  const rows = history.map((w, i) => {
    const statusColor = w.status === "Дууссан" ? "#16a34a" : w.status === "Явцтай" ? "#2563eb" : "#d97706";
    const confirmText = w.confirm_status === "confirmed"
      ? `<span style="font-size:10px;padding:2px 8px;border-radius:20px;background:#dcfce7;color:#15803d;font-weight:700">Батлагдсан</span>`
      : w.confirm_status === "rejected"
        ? `<span style="font-size:10px;padding:2px 8px;border-radius:20px;background:#fee2e2;color:#dc2626;font-weight:700">Буцаагдсан</span>`
        : "";
    return `<div style="position:relative;margin-bottom:10px">
      <div style="position:absolute;left:-20px;top:12px;width:10px;height:10px;border-radius:50%;background:${i === 0 ? "#2563eb" : "#cbd5e1"};border:2px solid #fff;box-shadow:0 0 0 1px #cbd5e1"></div>
      <div style="background:${i === 0 ? "#eff6ff" : "#f8fafc"};border:1px solid ${i === 0 ? "#bfdbfe" : "#e2e8f0"};border-radius:10px;padding:12px 14px">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:6px">
          <div style="font-size:13px;font-weight:800;color:#172033">${escapeHtml(w.title || "Засварын ажил")}</div>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
            <span style="font-size:10px;padding:2px 8px;border-radius:20px;background:${w.status === "Дууссан" ? "#dcfce7" : "#dbeafe"};color:${statusColor};font-weight:700">${escapeHtml(w.status || "")}</span>
            ${confirmText}
            <span style="font-size:10px;color:#94a3b8;font-family:monospace">${escapeHtml(w.work_date || w.start_date || "")}</span>
          </div>
        </div>
        ${w.description ? `<div style="font-size:12px;color:#667085;line-height:1.5;margin-bottom:6px">${escapeHtml(w.description)}</div>` : ""}
        <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:11px;color:#94a3b8">
          ${w.created_name ? `<span>👤 Үүсгэсэн: ${escapeHtml(w.created_name)}</span>` : ""}
          ${w.material_note ? `<span>👷 ${escapeHtml(w.material_note)}</span>` : ""}
          ${w.progress != null ? `<span>Явц: <b style="color:#2563eb">${Number(w.progress || 0)}%</b></span>` : ""}
          ${w.cost_amount ? `<span style="color:#16a34a;font-weight:700">💰 ${Number(w.cost_amount).toLocaleString()}₮</span>` : ""}
        </div>
      </div>
    </div>`;
  }).join("");

  return `<div style="padding:14px 20px;border-bottom:1px solid #f1f5f9">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;gap:10px;flex-wrap:wrap">
      <div style="font-size:13px;font-weight:700;color:#344054">🛠 Засварын түүх (${history.length})</div>
      <div style="font-size:11px;color:#94a3b8">${escapeHtml(cat || "")}</div>
    </div>
    ${history.length ? `<div style="position:relative;padding-left:24px">
      <div style="position:absolute;left:8px;top:0;bottom:0;width:2px;background:#e2e8f0"></div>
      ${rows}
    </div>` : `<div style="text-align:center;padding:22px;color:#94a3b8;background:#f8fafc;border-radius:10px;border:2px dashed #e2e8f0">
      <div style="font-size:26px;margin-bottom:6px">🛠</div>
      <div style="font-size:12px">Засварын түүх бүртгэгдээгүй байна</div>
    </div>`}
  </div>`;
}

async function openSlDetail(id) {
  const modal = document.getElementById("slDetailModal");
  const inner = document.getElementById("slDetailInner");
  if (!modal || !inner) return;

  inner.innerHTML = `<div style="padding:48px;text-align:center;color:#667085">
    <div style="font-size:32px;margin-bottom:10px">⏳</div>Уншиж байна...
  </div>`;
  modal.style.display = "flex";

  let pt, meterPoints;
  try {
    [pt, meterPoints] = await Promise.all([
      api(`/api/sl-points/${id}`),
      api("/api/mp").catch(() => []),
    ]);
  } catch(e) { inner.innerHTML = `<div style="padding:24px;color:#dc2626">Алдаа: ${e.message}</div>`; return; }

  const canEdit = ["director","chief_engineer","engineer","camera_engineer"].includes(state.me.role);
  const photos  = pt.photos || [];
  const docs    = pt.docs   || [];
  const history = pt.history || [];
  const workPct = (pt.total_heads||pt.lamp_count||0) > 0
    ? Math.round(((pt.total_heads||pt.lamp_count) - 0) / (pt.total_heads||pt.lamp_count) * 100)
    : 100;

  inner.innerHTML = `
  <div style="background:linear-gradient(135deg,#1e3a5f 0%,#1d4ed8 100%);border-radius:16px 16px 0 0;padding:20px 24px;position:relative">
    <button onclick="closeSlDetail()" style="position:absolute;top:14px;right:14px;border:none;background:rgba(255,255,255,.15);color:#fff;border-radius:8px;padding:5px 12px;cursor:pointer;font-size:13px">✕</button>
    <div style="font-size:10px;color:rgba(255,255,255,.5);letter-spacing:.15em;text-transform:uppercase;margin-bottom:6px">💡 ГУДАМЖНЫ ГЭРЭЛТҮҮЛЭГ · ПАСПОРТ</div>
    <div style="font-size:21px;font-weight:800;color:#fff;margin-bottom:6px">${escapeHtml(pt.name||"—")}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <span style="font-family:monospace;font-size:12px;background:rgba(255,255,255,.12);color:rgba(255,255,255,.85);padding:3px 10px;border-radius:6px">${escapeHtml(pt.code||"—")}</span>
      <span style="font-size:11px;padding:3px 10px;border-radius:20px;background:rgba(255,255,255,.12);color:#86efac">${pt.status==="active"||pt.status==="Идэвхтэй" ? "✓ Идэвхтэй" : "✗ Идэвхгүй"}</span>
      ${pt.location ? `<span style="font-size:11px;color:rgba(255,255,255,.6)">📍 ${escapeHtml(pt.location)}</span>` : ""}
    </div>
  </div>

  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;padding:18px 20px;border-bottom:1px solid #f1f5f9">
    <div style="background:#eff6ff;border-radius:10px;padding:12px;text-align:center">
      <div style="font-size:22px;font-weight:800;color:#2563eb">${pt.lamp_count||0}</div>
      <div style="font-size:11px;color:#64748b">Нийт шон</div>
    </div>
    <div style="background:#f0f9ff;border-radius:10px;padding:12px;text-align:center">
      <div style="font-size:22px;font-weight:800;color:#0ea5e9">${pt.total_heads||pt.lamp_count||0}</div>
      <div style="font-size:11px;color:#64748b">Нийт толгой</div>
    </div>
    ${(pt.needs_poles||0) > 0 ? `
    <div style="background:#fff7ed;border-radius:10px;padding:12px;text-align:center">
      <div style="font-size:22px;font-weight:800;color:#d97706">${pt.needs_poles}</div>
      <div style="font-size:11px;color:#64748b">Нөхөх шон</div>
    </div>` : `
    <div style="background:#f0fdf4;border-radius:10px;padding:12px;text-align:center">
      <div style="font-size:22px;font-weight:800;color:#16a34a">${workPct}%</div>
      <div style="font-size:11px;color:#64748b">Асалтын хувь</div>
    </div>`}
    <div style="background:#f8f9fb;border-radius:10px;padding:12px;text-align:center">
      <div style="font-size:14px;font-weight:700;color:#344054">${escapeHtml(pt.light_type||pt.wattage_per_lamp?(pt.wattage_per_lamp+"Вт"):"—")}</div>
      <div style="font-size:11px;color:#64748b">Гэрлийн төрөл</div>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:16px 20px;border-bottom:1px solid #f1f5f9">
    ${[
      ["📍 Байршил",          escapeHtml(pt.location||"—")],
      ["📅 Суурилуулсан огноо", pt.install_date||"—"],
      ["🏢 Байгууллага",      escapeHtml(pt.org_name||"—")],
      ["🗺 GPS",              pt.gps_lat && pt.gps_lng ? `${pt.gps_lat}, ${pt.gps_lng}` : "—"],
      ["📝 Тэмдэглэл",        escapeHtml(pt.notes||"—")],
    ].map(([l,v]) => `
      <div style="background:#f8f9fb;border:1px solid #e2e6ed;border-radius:8px;padding:10px 14px;display:flex;gap:10px;align-items:flex-start">
        <span style="font-size:14px;flex-shrink:0;margin-top:1px">${l.split(" ")[0]}</span>
        <div>
          <div style="font-size:10px;color:#94a3b8;margin-bottom:2px">${l.split(" ").slice(1).join(" ")}</div>
          <div style="font-size:13px;font-weight:600;color:#172033">${v}</div>
        </div>
      </div>`).join("")}

    <div style="background:#f0f9ff;border:2px solid ${pt.meter_point_id?'#0ea5e9':'#e2e6ed'};border-radius:8px;padding:10px 14px;display:flex;gap:10px;align-items:flex-start;grid-column:1/-1">
      <span style="font-size:14px;flex-shrink:0;margin-top:1px">⚡</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:10px;color:#94a3b8;margin-bottom:6px">Тоолуурын байршил — холбох</div>
        <select id="slMeterSelect_${id}" onchange="saveSlMeterLink(${id}, this)"
          style="width:100%;padding:7px 10px;border:1px solid #bae6fd;border-radius:8px;font-size:13px;font-weight:600;color:#0c4a6e;background:#fff;outline:none;cursor:pointer">
          <option value="">— Сонгох —</option>
          ${meterPoints.map(mp => `<option value="${mp.id}" data-meter-no="${escapeHtml(mp.meter_no||"")}"
            ${pt.meter_point_id === mp.id ? "selected" : ""}>
            ${escapeHtml(mp.meter_no||"")}${mp.location ? " · " + escapeHtml(mp.location) : ""}${mp.name ? " (" + escapeHtml(mp.name) + ")" : ""}
          </option>`).join("")}
        </select>
        ${pt.meter_point_id && pt.mp_location ? `<div style="font-size:11px;color:#0369a1;margin-top:4px">📍 ${escapeHtml(pt.mp_location)}</div>` : ""}
      </div>
    </div>
  </div>

  <div style="padding:14px 20px;border-bottom:1px solid #f1f5f9;background:${pt.gps_lat?'#f8faff':'#fff'}">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px">
      <div style="font-size:12px;font-weight:700;color:#344054">🗺 GPS координат</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        ${pt.gps_lat && pt.gps_lng ? `
        <a href="https://www.google.com/maps?q=${pt.gps_lat},${pt.gps_lng}" target="_blank"
          style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:#2563eb;font-weight:600;text-decoration:none;background:#eff6ff;padding:5px 12px;border-radius:8px;border:1px solid #bfdbfe">
          🗺 Google Maps →
        </a>` : ""}
        ${canEdit ? `
        <label style="display:inline-flex;align-items:center;gap:5px;cursor:pointer;font-size:11px;background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;border-radius:8px;padding:5px 12px;font-weight:600">
          📎 KMZ / KML импортлох
          <input type="file" accept=".kmz,.kml" style="display:none" onchange="slKmzImport(${id},this)">
        </label>` : ""}
      </div>
    </div>
    ${canEdit ? `
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <input type="number" step="any" id="slGpsLat_${id}"
        value="${pt.gps_lat||""}" placeholder="Өргөрөг · 47.9136..."
        style="flex:1;min-width:160px;padding:7px 10px;border:1px solid #e2e6ed;border-radius:8px;font-size:13px;outline:none;font-family:monospace">
      <input type="number" step="any" id="slGpsLng_${id}"
        value="${pt.gps_lng||""}" placeholder="Уртраг · 114.5327..."
        style="flex:1;min-width:160px;padding:7px 10px;border:1px solid #e2e6ed;border-radius:8px;font-size:13px;outline:none;font-family:monospace">
      <button class="btn" style="padding:7px 16px;font-size:12px;white-space:nowrap" onclick="saveSlGps(${id})">💾 Хадгалах</button>
    </div>` : `
    <div style="font-family:monospace;font-size:13px;color:#344054;font-weight:600">
      ${pt.gps_lat && pt.gps_lng ? `${pt.gps_lat}, ${pt.gps_lng}` : '<span style="color:#94a3b8">GPS бүртгэгдээгүй</span>'}
    </div>`}
    <div id="slKmzResults_${id}" style="margin-top:10px"></div>
  </div>

  <div style="padding:14px 20px;border-bottom:1px solid #f1f5f9">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <div style="font-size:13px;font-weight:700;color:#344054">📖 Паспорт баримт (${docs.length})</div>
      ${canEdit ? `
      <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-size:11px;background:#faf5ff;color:#7c3aed;border:1px solid #ddd6fe;border-radius:8px;padding:6px 12px;font-weight:600">
        + Баримт нэмэх
        <input type="file" accept=".pdf,image/*" multiple style="display:none" onchange="uploadSlDoc(${id},this)">
      </label>` : ""}
    </div>
    ${docs.length ? `
    <div style="display:flex;flex-direction:column;gap:6px">
      ${docs.map(d => {
        const filePath = "/" + d.file_path.replace(/\\/g,"/").replace(/^.*uploads\//,"uploads/");
        const isPdf = (d.file_name||"").toLowerCase().endsWith(".pdf") || (d.file_path||"").toLowerCase().endsWith(".pdf");
        const ext = (d.file_name||"").split(".").pop().toUpperCase() || "FILE";
        return `<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:#faf5ff;border:1px solid #ddd6fe;border-radius:10px">
          <div style="font-size:28px;flex-shrink:0">${isPdf ? "📄" : "🖼"}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:700;color:#5b21b6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(d.description||d.file_name||"Баримт")}</div>
            <div style="font-size:10px;color:#94a3b8">${ext} · ${(d.uploaded_at||"").slice(0,10)} · ${escapeHtml(d.uploader_name||"")}</div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            <button class="btn" style="padding:5px 12px;font-size:11px;background:#7c3aed;border-color:#7c3aed"
              onclick="openSlDocReader('${filePath}','${escapeHtml(d.description||d.file_name||"Баримт")}',${isPdf})">
              📖 Унших
            </button>
            ${canEdit ? `<button onclick="deleteSlDoc(${d.id},${id})"
              style="background:#fef2f2;color:#dc2626;border:1px solid #fecaca;border-radius:8px;padding:5px 10px;font-size:11px;cursor:pointer">✕</button>` : ""}
          </div>
        </div>`;
      }).join("")}
    </div>` : `
    <div style="text-align:center;padding:20px;color:#94a3b8;background:#faf5ff;border-radius:10px;border:2px dashed #ddd6fe">
      <div style="font-size:28px;margin-bottom:6px">📖</div>
      <div style="font-size:12px">Паспорт баримт байхгүй байна</div>
      ${canEdit ? `<div style="font-size:11px;color:#a78bfa;margin-top:3px">PDF эсвэл зургаар scan хийж оруулна уу</div>` : ""}
    </div>`}
  </div>

  ${renderSlRepairHistory(history, "Авто замын гэрэл")}

  <div style="padding:16px 20px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <div style="font-size:13px;font-weight:700;color:#344054">📷 Зургийн галерей (${photos.length})</div>
      ${canEdit ? `
      <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-size:11px;background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe;border-radius:8px;padding:6px 12px;font-weight:600">
        + Зураг нэмэх
        <input type="file" accept="image/*" multiple style="display:none" onchange="uploadSlPhoto(${id}, this)">
      </label>` : ""}
    </div>
    ${photos.length ? (() => {
      const srcs = photos.map(p => "/" + p.file_path.replace(/\\/g,"/").replace(/^.*uploads\//,"uploads/"));
      const srcsJson = JSON.stringify(srcs);
      return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px">
        ${photos.map((p,i) => {
          const src = srcs[i];
          return `<div style="border-radius:10px;overflow:hidden;border:1px solid #e2e6ed;position:relative;background:#f8f9fb">
            <img src="${src}" style="width:100%;height:120px;object-fit:cover;cursor:pointer;display:block"
              onclick="openLightbox(${srcsJson},${i})">
            <div style="padding:6px 8px">
              <div style="font-size:10px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(p.description||"")}</div>
              <div style="font-size:9px;color:#94a3b8">${(p.uploaded_at||"").slice(0,10)} · ${escapeHtml(p.uploader_name||"")}</div>
            </div>
            ${canEdit ? `<button onclick="deleteSlPhoto(${p.id},${id})"
              style="position:absolute;top:4px;right:4px;background:rgba(220,38,38,.85);color:#fff;border:none;border-radius:4px;padding:2px 6px;font-size:10px;cursor:pointer">✕</button>` : ""}
          </div>`;
        }).join("")}
      </div>`;
    })() : `
    <div style="text-align:center;padding:28px;color:#94a3b8;background:#f8f9fb;border-radius:10px;border:2px dashed #e2e6ed">
      <div style="font-size:28px;margin-bottom:6px">📷</div>
      <div style="font-size:12px">Зураг байхгүй байна</div>
      ${canEdit ? `<div style="font-size:11px;color:#bfdbfe;margin-top:4px">Дээрх товчоор зураг оруулна уу</div>` : ""}
    </div>`}
  </div>`;
}

function closeSlDetail() {
  const m = document.getElementById("slDetailModal");
  if (m) m.style.display = "none";
}

async function uploadSlDoc(slId, input) {
  if (!input?.files?.length) return;
  let ok = 0;
  for (const file of input.files) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("description", file.name.replace(/\.[^.]+$/, ""));
    try {
      await fetch(API + `/api/sl-points/${slId}/docs`, {
        method: "POST",
        headers: { "Authorization": "Bearer " + state.token },
        body: fd
      });
      ok++;
    } catch(e) {}
  }
  toast(`${ok} баримт хадгаллаа ✓`);
  openSlDetail(slId);
}

async function deleteSlDoc(docId, slId) {
  if (!confirm("Баримт устгах уу?")) return;
  try {
    await api(`/api/sl-point-docs/${docId}`, { method: "DELETE" });
    toast("Баримт устгагдлаа ✓");
    openSlDetail(slId);
  } catch(e) { toast("Алдаа: " + e.message); }
}

let _pdfDoc = null, _pdfPage = 1, _pdfTotal = 0;

async function _loadPdfJs() {
  if (window.pdfjsLib) return;
  await new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    s.onload = () => {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      res();
    };
    s.onerror = rej;
    document.head.appendChild(s);
  });
}

async function _renderPdfPage(pageNum) {
  if (!_pdfDoc) return;
  const page = await _pdfDoc.getPage(pageNum);
  const vw = Math.min(window.innerWidth - 40, 900);
  const viewport = page.getViewport({ scale: vw / page.getViewport({ scale: 1 }).width });
  const canvas = document.createElement("canvas");
  canvas.width  = viewport.width;
  canvas.height = viewport.height;
  canvas.style.cssText = "border-radius:6px;box-shadow:0 4px 24px rgba(0,0,0,.5);max-width:100%";
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  const body = document.getElementById("slDocReaderBody");
  if (body) { body.innerHTML = ""; body.appendChild(canvas); }
  const info = document.getElementById("slDocPageInfo");
  if (info) info.textContent = `${pageNum} / ${_pdfTotal} хуудас`;
  _pdfPage = pageNum;
}

async function openSlDocReader(filePath, title, isPdf) {
  const modal = document.getElementById("slDocReaderModal");
  const body  = document.getElementById("slDocReaderBody");
  const nav   = document.getElementById("slDocPageNav");
  const dl    = document.getElementById("slDocDownloadLink");
  document.getElementById("slDocReaderTitle").textContent = title;
  if (dl) { dl.href = filePath; dl.download = title; }
  modal.style.display = "flex";
  body.innerHTML = `<div style="color:rgba(255,255,255,.6);font-size:14px;margin-top:80px">⏳ Уншиж байна...</div>`;
  if (nav) nav.style.display = "none";

  if (isPdf) {
    try {
      await _loadPdfJs();
      _pdfDoc   = await pdfjsLib.getDocument(filePath).promise;
      _pdfTotal = _pdfDoc.numPages;
      _pdfPage  = 1;
      if (nav) nav.style.display = "flex";
      await _renderPdfPage(1);
    } catch(e) {
      body.innerHTML = `<div style="color:#fca5a5;margin-top:60px">PDF уншихад алдаа гарлаа: ${escapeHtml(e.message)}</div>`;
    }
  } else {
    body.innerHTML = `<img src="${filePath}" style="max-width:min(900px,100%);border-radius:8px;box-shadow:0 4px 24px rgba(0,0,0,.5)">`;
  }
}

function closeSlDocReader() {
  const m = document.getElementById("slDocReaderModal");
  if (m) m.style.display = "none";
  _pdfDoc = null; _pdfPage = 1; _pdfTotal = 0;
}

async function slDocPage(dir) {
  const next = _pdfPage + dir;
  if (next < 1 || next > _pdfTotal) return;
  await _renderPdfPage(next);
}

async function saveSlGps(slId) {
  const lat = parseFloat(document.getElementById(`slGpsLat_${slId}`)?.value);
  const lng = parseFloat(document.getElementById(`slGpsLng_${slId}`)?.value);
  if (isNaN(lat) || isNaN(lng)) { toast("Координат буруу байна"); return; }
  try {
    await api(`/api/sl-points/${slId}/gps`, {
      method: "PUT",
      body: JSON.stringify({ gps_lat: lat, gps_lng: lng })
    });
    toast(`GPS хадгаллаа ✓ (${lat}, ${lng})`);
    openSlDetail(slId);
  } catch(e) { toast("Алдаа: " + e.message); }
}

async function _loadJszip() {
  if (window.JSZip) return;
  await new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

function _parseKml(kmlText) {
  const doc = new DOMParser().parseFromString(kmlText, "text/xml");
  const points = [];
  doc.querySelectorAll("Placemark").forEach(pm => {
    const name = pm.querySelector("name")?.textContent?.trim() || "";
    const desc = pm.querySelector("description")?.textContent?.trim() || "";
    const coordEl = pm.querySelector("Point coordinates") || pm.querySelector("coordinates");
    if (!coordEl) return;
    const parts = coordEl.textContent.trim().split(",");
    const lng = parseFloat(parts[0]);
    const lat = parseFloat(parts[1]);
    if (!isNaN(lat) && !isNaN(lng)) points.push({ name, desc, lat, lng });
  });
  return points;
}

async function slKmzImport(slId, input) {
  const file = input.files?.[0];
  if (!file) return;
  const resultsEl = document.getElementById(`slKmzResults_${slId}`);
  if (resultsEl) resultsEl.innerHTML = `<div style="color:#667085;font-size:12px;padding:6px 0">⏳ Уншиж байна...</div>`;

  try {
    let points = [];
    if (file.name.toLowerCase().endsWith(".kml")) {
      const text = await file.text();
      points = _parseKml(text);
    } else {
      await _loadJszip();
      const zip = await JSZip.loadAsync(file);
      const kmlName = Object.keys(zip.files).find(f => f.toLowerCase().endsWith(".kml"));
      if (!kmlName) throw new Error("KML файл олдсонгүй");
      const text = await zip.files[kmlName].async("string");
      points = _parseKml(text);
    }

    if (!resultsEl) return;
    if (!points.length) {
      resultsEl.innerHTML = `<div style="color:#dc2626;font-size:12px;padding:6px 0">⚠ Координат олдсонгүй</div>`;
      return;
    }

    resultsEl.innerHTML = `
    <div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:6px">📌 ${points.length} байршил олдлоо — сонгоно уу:</div>
    <div style="max-height:220px;overflow-y:auto;display:flex;flex-direction:column;gap:4px">
      ${points.map((p,i) => `
      <div style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:#f8fafc;border:1px solid #e2e6ed;border-radius:8px">
        <div style="flex:1;min-width:0">
          ${p.name ? `<div style="font-size:12px;font-weight:700;color:#172033;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(p.name)}</div>` : ""}
          <div style="font-family:monospace;font-size:11px;color:#64748b">${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}</div>
        </div>
        <button class="btn secondary" style="padding:4px 10px;font-size:11px;white-space:nowrap;flex-shrink:0"
          onclick="slSelectKmzPoint(${slId},${p.lat},${p.lng})">Сонгох</button>
      </div>`).join("")}
    </div>`;
  } catch(e) {
    if (resultsEl) resultsEl.innerHTML = `<div style="color:#dc2626;font-size:12px;padding:6px 0">Алдаа: ${escapeHtml(e.message)}</div>`;
  }
  input.value = "";
}

function slSelectKmzPoint(slId, lat, lng) {
  const latEl = document.getElementById(`slGpsLat_${slId}`);
  const lngEl = document.getElementById(`slGpsLng_${slId}`);
  if (latEl) latEl.value = lat;
  if (lngEl) lngEl.value = lng;
  const resultsEl = document.getElementById(`slKmzResults_${slId}`);
  if (resultsEl) resultsEl.innerHTML = `<div style="color:#16a34a;font-size:12px;padding:4px 0;font-weight:600">✓ ${lat.toFixed(6)}, ${lng.toFixed(6)} — "Хадгалах" дарна уу</div>`;
}

async function saveSlMeterLink(slId, selectEl) {
  const opt = selectEl.options[selectEl.selectedIndex];
  const meterPointId = selectEl.value ? parseInt(selectEl.value) : null;
  const meterNo = opt ? (opt.dataset.meterNo || "") : "";
  try {
    await api(`/api/sl-points/${slId}/link-meter`, {
      method: "PUT",
      body: JSON.stringify({ meter_point_id: meterPointId, meter_no: meterNo })
    });
    selectEl.style.borderColor = meterPointId ? "#0ea5e9" : "#e2e6ed";
    selectEl.closest("[style*='background:#f0f9ff']").style.borderColor = meterPointId ? "#0ea5e9" : "#e2e6ed";
    toast(meterPointId ? `Тоолуур холбогдлоо ✓ (${meterNo})` : "Холбоос устгагдлаа ✓");
  } catch(e) { toast("Алдаа: " + (e.message || "Хадгалах боломжгүй")); }
}

async function uploadSlPhoto(slId, input) {
  if (!input?.files?.length) return;
  let ok = 0;
  for (const file of input.files) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("description", file.name);
    try {
      await fetch(API + `/api/sl-points/${slId}/photos`, {
        method: "POST",
        headers: { "Authorization": "Bearer " + state.token },
        body: fd
      });
      ok++;
    } catch(e) {}
  }
  toast(`${ok} зураг хадгаллаа ✓`);
  openSlDetail(slId);
}

async function deleteSlPhoto(photoId, slId) {
  if (!confirm("Зураг устгах уу?")) return;
  try {
    await api(`/api/sl-point-photos/${photoId}`, { method: "DELETE" });
    toast("Зураг устгагдлаа ✓");
    openSlDetail(slId);
  } catch(e) { toast("Алдаа: " + e.message); }
}

async function slFaultQuickSave(inputEl) {
  const val  = parseInt(inputEl.value) || 0;
  const orig = parseInt(inputEl.dataset.orig) || 0;
  if (val === orig) return;

  const slId    = parseInt(inputEl.dataset.slid);
  const name    = inputEl.dataset.name;
  const heads   = parseInt(inputEl.dataset.heads) || 0;
  const faultId = parseInt(inputEl.dataset.fid) || 0;

  if (val < 0 || val > heads) {
    toast(`Буруу тоо (0–${heads})`);
    inputEl.value = orig || "";
    return;
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  try {
    if (faultId > 0) {
      await api(`/api/sl-faults/${faultId}`, {
        method: "PUT",
        body: JSON.stringify({
          category: "Авто замын гэрэл",
          location_id: slId,
          location_name: name,
          total_heads: heads,
          broken_count: val,
          report_date: todayStr,
        })
      });
    } else if (val > 0) {
      const r = await api("/api/sl-faults", {
        method: "POST",
        body: JSON.stringify({
          category: "Авто замын гэрэл",
          location_id: slId,
          location_name: name,
          location_type: "sl_point",
          total_heads: heads,
          broken_count: val,
          report_date: todayStr,
        })
      });
      inputEl.dataset.fid = r.id;
    }

    inputEl.dataset.orig       = val;
    inputEl.style.borderColor  = val > 0 ? "#fca5a5" : "#e2e6ed";
    inputEl.style.background   = val > 0 ? "#fef2f2" : "#fff";
    inputEl.style.color        = val > 0 ? "#dc2626" : "#94a3b8";
    toast(val > 0 ? `${name}: ${val} гэмтэл бүртгэгдлээ ✓` : "Хадгалагдлаа ✓");
  } catch(e) {
    toast("Алдаа: " + (e.message || "Хадгалах боломжгүй"));
    inputEl.value = orig || "";
  }
}

async function gerFaultQuickSave(inputEl) {
  const val  = parseInt(inputEl.value) || 0;
  const orig = parseInt(inputEl.dataset.orig) || 0;
  if (val === orig) return;
  const gerId   = parseInt(inputEl.dataset.gerid);
  const name    = inputEl.dataset.name;
  const heads   = parseInt(inputEl.dataset.heads) || 0;
  const faultId = parseInt(inputEl.dataset.fid) || 0;
  const cat     = inputEl.dataset.cat || "Гэр хорооллын гэрэл";
  if (val < 0 || val > heads) { toast(`Буруу тоо (0–${heads})`); inputEl.value = orig||""; return; }
  const todayStr = new Date().toISOString().slice(0, 10);
  try {
    if (faultId > 0) {
      await api(`/api/sl-faults/${faultId}`, { method:"PUT", body:JSON.stringify({
        category: cat, location_id: gerId, location_name: name,
        total_heads: heads, broken_count: val, report_date: todayStr,
      })});
    } else if (val > 0) {
      const r = await api("/api/sl-faults", { method:"POST", body:JSON.stringify({
        category: cat, location_id: gerId, location_name: name,
        location_type: "sl_ger_inventory", total_heads: heads,
        broken_count: val, report_date: todayStr,
      })});
      inputEl.dataset.fid = r.id;
    }
    inputEl.dataset.orig      = val;
    inputEl.style.borderColor = val > 0 ? "#fca5a5" : "#e2e6ed";
    inputEl.style.background  = val > 0 ? "#fef2f2" : "#fff";
    inputEl.style.color       = val > 0 ? "#dc2626" : "#94a3b8";
    toast(val > 0 ? `${name}: ${val} гэмтэл бүртгэгдлээ ✓` : "Хадгалагдлаа ✓");
  } catch(e) { toast("Алдаа: " + (e.message||"")); inputEl.value = orig||""; }
}

async function openGerDetail(id, cat) {
  const modal = document.getElementById("slDetailModal");
  const inner = document.getElementById("slDetailInner");
  if (!modal || !inner) return;
  inner.innerHTML = `<div style="padding:48px;text-align:center;color:#667085"><div style="font-size:32px;margin-bottom:10px">⏳</div>Уншиж байна...</div>`;
  modal.style.display = "flex";

  let rec, meterPoints;
  try {
    [rec, meterPoints] = await Promise.all([
      api(`/api/sl-ger-inventory/${id}`),
      api("/api/mp").catch(()=>[]),
    ]);
  } catch(e) { inner.innerHTML = `<div style="padding:24px;color:#dc2626">Алдаа: ${e.message}</div>`; return; }

  const canEdit = ["director","chief_engineer","engineer"].includes(state.me.role);
  const photos  = rec.photos || [];
  const docs    = rec.docs   || [];
  const history = rec.history || [];
  const isCamhag = cat === "Цамхагийн гэрэл";
  const catIcon  = isCamhag ? "🗼" : "🏘️";
  const catColor = isCamhag ? "#d97706" : "#0ea5e9";
  const heads    = rec.total_count || 0;

  inner.innerHTML = `
  <div style="background:linear-gradient(135deg,#1e3a5f 0%,${isCamhag?"#92400e":"#0369a1"} 100%);border-radius:16px 16px 0 0;padding:20px 24px;position:relative">
    <button onclick="closeSlDetail()" style="position:absolute;top:14px;right:14px;border:none;background:rgba(255,255,255,.15);color:#fff;border-radius:8px;padding:5px 12px;cursor:pointer;font-size:13px">✕</button>
    <div style="font-size:10px;color:rgba(255,255,255,.5);letter-spacing:.15em;text-transform:uppercase;margin-bottom:6px">${catIcon} ${cat} · ПАСПОРТ</div>
    <div style="font-size:21px;font-weight:800;color:#fff;margin-bottom:6px">${escapeHtml(rec.location_name||"—")}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      ${rec.bag_no ? `<span style="font-size:11px;background:rgba(255,255,255,.12);color:rgba(255,255,255,.85);padding:3px 10px;border-radius:6px">${rec.bag_no}-р баг</span>` : ""}
      ${rec.light_type ? `<span style="font-size:11px;color:rgba(255,255,255,.6)">💡 ${escapeHtml(rec.light_type)}</span>` : ""}
    </div>
  </div>

  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;padding:18px 20px;border-bottom:1px solid #f1f5f9">
    <div style="background:#eff6ff;border-radius:10px;padding:12px;text-align:center">
      <div style="font-size:22px;font-weight:800;color:#2563eb">${isCamhag?1:heads}</div>
      <div style="font-size:11px;color:#64748b">${isCamhag?"Шон":"Нийт шон"}</div>
    </div>
    <div style="background:#f0f9ff;border-radius:10px;padding:12px;text-align:center">
      <div style="font-size:22px;font-weight:800;color:${catColor}">${heads}</div>
      <div style="font-size:11px;color:#64748b">Нийт толгой</div>
    </div>
    ${(rec.needs_poles||0) > 0 ? `
    <div style="background:#fff7ed;border-radius:10px;padding:12px;text-align:center">
      <div style="font-size:22px;font-weight:800;color:#d97706">${rec.needs_poles}</div>
      <div style="font-size:11px;color:#64748b">Дутуу шон</div>
    </div>` : `
    <div style="background:#f0fdf4;border-radius:10px;padding:12px;text-align:center">
      <div style="font-size:22px;font-weight:800;color:#16a34a">100%</div>
      <div style="font-size:11px;color:#64748b">Асалтын хувь</div>
    </div>`}
    <div style="background:#f8f9fb;border-radius:10px;padding:12px;text-align:center">
      <div style="font-size:14px;font-weight:700;color:#344054">${escapeHtml(rec.light_type||"—")}</div>
      <div style="font-size:11px;color:#64748b">Гэрлийн төрөл</div>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:16px 20px;border-bottom:1px solid #f1f5f9">
    ${[
      ["📍 Байршил",      escapeHtml(rec.location_name||"—")],
      ["🏘 Баг",          rec.bag_no ? rec.bag_no+"-р баг" : "—"],
      ["⚠ Дутуу шон",    Number(rec.needs_poles||0) > 0 ? rec.needs_poles : "—"],
      ["📅 Суурилуулсан", rec.install_date||"—"],
      ["🏢 Байгууллага",  "Чойбалсан хөгжил ОНӨҮГ"],
      ["🗺 GPS",          rec.gps_lat&&rec.gps_lng ? `${rec.gps_lat}, ${rec.gps_lng}` : "—"],
      ["📝 Тэмдэглэл",   escapeHtml(rec.notes||"—")],
    ].map(([l,v]) => `
      <div style="background:#f8f9fb;border:1px solid #e2e6ed;border-radius:8px;padding:10px 14px;display:flex;gap:10px;align-items:flex-start">
        <span style="font-size:14px;flex-shrink:0;margin-top:1px">${l.split(" ")[0]}</span>
        <div>
          <div style="font-size:10px;color:#94a3b8;margin-bottom:2px">${l.split(" ").slice(1).join(" ")}</div>
          <div style="font-size:13px;font-weight:600;color:#172033">${v}</div>
        </div>
      </div>`).join("")}

    <div style="background:#f0f9ff;border:2px solid ${rec.meter_point_id?'#0ea5e9':'#e2e6ed'};border-radius:8px;padding:10px 14px;display:flex;gap:10px;align-items:flex-start;grid-column:1/-1">
      <span style="font-size:14px;flex-shrink:0;margin-top:1px">⚡</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:10px;color:#94a3b8;margin-bottom:6px">Тоолуурын байршил — холбох</div>
        <select id="gerMeterSelect_${id}" onchange="saveGerMeterLink(${id}, this)"
          style="width:100%;padding:7px 10px;border:1px solid #bae6fd;border-radius:8px;font-size:13px;font-weight:600;color:#0c4a6e;background:#fff;outline:none;cursor:pointer">
          <option value="">— Сонгох —</option>
          ${meterPoints.map(mp => `<option value="${mp.id}" data-meter-no="${escapeHtml(mp.meter_no||"")}"
            ${rec.meter_point_id===mp.id?"selected":""}>
            ${escapeHtml(mp.meter_no||"")}${mp.location?" · "+escapeHtml(mp.location):""}${mp.name?" ("+escapeHtml(mp.name)+")":""}
          </option>`).join("")}
        </select>
      </div>
    </div>
  </div>

  <div style="padding:14px 20px;border-bottom:1px solid #f1f5f9;background:${rec.gps_lat?'#f8faff':'#fff'}">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px">
      <div style="font-size:12px;font-weight:700;color:#344054">🗺 GPS координат</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${rec.gps_lat&&rec.gps_lng ? `<a href="https://www.google.com/maps?q=${rec.gps_lat},${rec.gps_lng}" target="_blank"
          style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:#2563eb;font-weight:600;text-decoration:none;background:#eff6ff;padding:5px 12px;border-radius:8px;border:1px solid #bfdbfe">🗺 Google Maps →</a>` : ""}
        ${canEdit ? `<label style="display:inline-flex;align-items:center;gap:5px;cursor:pointer;font-size:11px;background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;border-radius:8px;padding:5px 12px;font-weight:600">
          📎 KMZ / KML импортлох
          <input type="file" accept=".kmz,.kml" style="display:none" onchange="gerKmzImport(${id},this)">
        </label>` : ""}
      </div>
    </div>
    ${canEdit ? `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <input type="number" step="any" id="gerGpsLat_${id}" value="${rec.gps_lat||""}" placeholder="Өргөрөг · 47.9136..."
        style="flex:1;min-width:160px;padding:7px 10px;border:1px solid #e2e6ed;border-radius:8px;font-size:13px;outline:none;font-family:monospace">
      <input type="number" step="any" id="gerGpsLng_${id}" value="${rec.gps_lng||""}" placeholder="Уртраг · 114.5327..."
        style="flex:1;min-width:160px;padding:7px 10px;border:1px solid #e2e6ed;border-radius:8px;font-size:13px;outline:none;font-family:monospace">
      <button class="btn" style="padding:7px 16px;font-size:12px;white-space:nowrap" onclick="saveGerGps(${id})">💾 Хадгалах</button>
    </div>` : `<div style="font-family:monospace;font-size:13px;color:#344054">${rec.gps_lat&&rec.gps_lng?`${rec.gps_lat}, ${rec.gps_lng}`:'<span style="color:#94a3b8">GPS бүртгэгдээгүй</span>'}</div>`}
    <div id="gerKmzResults_${id}" style="margin-top:10px"></div>
  </div>

  <div style="padding:14px 20px;border-bottom:1px solid #f1f5f9">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <div style="font-size:13px;font-weight:700;color:#344054">📖 Паспорт баримт (${docs.length})</div>
      ${canEdit ? `<label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-size:11px;background:#faf5ff;color:#7c3aed;border:1px solid #ddd6fe;border-radius:8px;padding:6px 12px;font-weight:600">
        + Баримт нэмэх
        <input type="file" accept=".pdf,image/*" multiple style="display:none" onchange="uploadGerDoc(${id},this)">
      </label>` : ""}
    </div>
    ${docs.length ? `<div style="display:flex;flex-direction:column;gap:6px">
      ${docs.map(d => {
        const fp = "/" + d.file_path.replace(/\\/g,"/").replace(/^.*uploads\//,"uploads/");
        const isPdf = (d.file_name||d.file_path||"").toLowerCase().endsWith(".pdf");
        return `<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:#faf5ff;border:1px solid #ddd6fe;border-radius:10px">
          <div style="font-size:28px;flex-shrink:0">${isPdf?"📄":"🖼"}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:700;color:#5b21b6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(d.description||d.file_name||"Баримт")}</div>
            <div style="font-size:10px;color:#94a3b8">${(d.uploaded_at||"").slice(0,10)} · ${escapeHtml(d.uploader_name||"")}</div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            <button class="btn" style="padding:5px 12px;font-size:11px;background:#7c3aed;border-color:#7c3aed"
              onclick="openSlDocReader('${fp}','${escapeHtml(d.description||d.file_name||"Баримт")}',${isPdf})">📖 Унших</button>
            ${canEdit?`<button onclick="deleteGerDoc(${d.id},${id},'${escapeHtml(cat)}')" style="background:#fef2f2;color:#dc2626;border:1px solid #fecaca;border-radius:8px;padding:5px 10px;font-size:11px;cursor:pointer">✕</button>`:""}
          </div>
        </div>`;
      }).join("")}
    </div>` : `<div style="text-align:center;padding:20px;color:#94a3b8;background:#faf5ff;border-radius:10px;border:2px dashed #ddd6fe">
      <div style="font-size:28px;margin-bottom:6px">📖</div><div style="font-size:12px">Паспорт баримт байхгүй байна</div>
    </div>`}
  </div>

  ${renderSlRepairHistory(history, cat)}

  <div style="padding:16px 20px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <div style="font-size:13px;font-weight:700;color:#344054">📷 Зургийн галерей (${photos.length})</div>
      ${canEdit ? `<label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-size:11px;background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe;border-radius:8px;padding:6px 12px;font-weight:600">
        + Зураг нэмэх <input type="file" accept="image/*" multiple style="display:none" onchange="uploadGerPhoto(${id},this)">
      </label>` : ""}
    </div>
    ${photos.length ? (() => {
      const srcs = photos.map(p => "/" + p.file_path.replace(/\\/g,"/").replace(/^.*uploads\//,"uploads/"));
      return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px">
        ${photos.map((p,i) => `<div style="border-radius:10px;overflow:hidden;border:1px solid #e2e6ed;position:relative;background:#f8f9fb">
          <img src="${srcs[i]}" style="width:100%;height:120px;object-fit:cover;cursor:pointer;display:block"
            onclick="openLightbox(${JSON.stringify(srcs)},${i})">
          <div style="padding:6px 8px">
            <div style="font-size:10px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(p.description||"")}</div>
            <div style="font-size:9px;color:#94a3b8">${(p.uploaded_at||"").slice(0,10)} · ${escapeHtml(p.uploader_name||"")}</div>
          </div>
          ${canEdit?`<button onclick="deleteGerPhoto(${p.id},${id},'${escapeHtml(cat)}')"
            style="position:absolute;top:4px;right:4px;background:rgba(220,38,38,.85);color:#fff;border:none;border-radius:4px;padding:2px 6px;font-size:10px;cursor:pointer">✕</button>`:""}
        </div>`).join("")}
      </div>`;
    })() : `<div style="text-align:center;padding:28px;color:#94a3b8;background:#f8f9fb;border-radius:10px;border:2px dashed #e2e6ed">
      <div style="font-size:28px;margin-bottom:6px">📷</div><div style="font-size:12px">Зураг байхгүй байна</div>
    </div>`}
  </div>`;
}

async function saveGerGps(gerId) {
  const lat = parseFloat(document.getElementById(`gerGpsLat_${gerId}`)?.value);
  const lng = parseFloat(document.getElementById(`gerGpsLng_${gerId}`)?.value);
  if (isNaN(lat)||isNaN(lng)) { toast("Координат буруу байна"); return; }
  try {
    await api(`/api/sl-ger-inventory/${gerId}/gps`, { method:"PUT", body:JSON.stringify({gps_lat:lat,gps_lng:lng}) });
    toast(`GPS хадгаллаа ✓`); openGerDetail(gerId, document.getElementById("slDetailInner")?.dataset?.cat || "");
  } catch(e) { toast("Алдаа: "+e.message); }
}

async function saveGerMeterLink(gerId, selectEl) {
  const opt = selectEl.options[selectEl.selectedIndex];
  const meterPointId = selectEl.value ? parseInt(selectEl.value) : null;
  const meterNo = opt ? (opt.dataset.meterNo||"") : "";
  try {
    await api(`/api/sl-ger-inventory/${gerId}/link-meter`, { method:"PUT", body:JSON.stringify({meter_point_id:meterPointId,meter_no:meterNo}) });
    toast(meterPointId ? `Тоолуур холбогдлоо ✓ (${meterNo})` : "Холбоос устгагдлаа ✓");
  } catch(e) { toast("Алдаа: "+e.message); }
}

async function gerKmzImport(gerId, input) {
  const file = input.files?.[0]; if (!file) return;
  const res = document.getElementById(`gerKmzResults_${gerId}`);
  if (res) res.innerHTML = `<div style="color:#667085;font-size:12px;padding:6px 0">⏳ Уншиж байна...</div>`;
  try {
    let points = [];
    if (file.name.toLowerCase().endsWith(".kml")) { points = _parseKml(await file.text()); }
    else { await _loadJszip(); const zip = await JSZip.loadAsync(file); const kn = Object.keys(zip.files).find(f=>f.toLowerCase().endsWith(".kml")); if (!kn) throw new Error("KML файл олдсонгүй"); points = _parseKml(await zip.files[kn].async("string")); }
    if (!res) return;
    if (!points.length) { res.innerHTML = `<div style="color:#dc2626;font-size:12px;padding:6px 0">⚠ Координат олдсонгүй</div>`; return; }
    res.innerHTML = `<div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:6px">📌 ${points.length} байршил олдлоо:</div>
    <div style="max-height:220px;overflow-y:auto;display:flex;flex-direction:column;gap:4px">
      ${points.map(p=>`<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:#f8fafc;border:1px solid #e2e6ed;border-radius:8px">
        <div style="flex:1;min-width:0">
          ${p.name?`<div style="font-size:12px;font-weight:700;color:#172033">${escapeHtml(p.name)}</div>`:""}
          <div style="font-family:monospace;font-size:11px;color:#64748b">${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}</div>
        </div>
        <button class="btn secondary" style="padding:4px 10px;font-size:11px" onclick="gerSelectKmzPoint(${gerId},${p.lat},${p.lng})">Сонгох</button>
      </div>`).join("")}
    </div>`;
  } catch(e) { if (res) res.innerHTML = `<div style="color:#dc2626;font-size:12px">${escapeHtml(e.message)}</div>`; }
  input.value = "";
}

function gerSelectKmzPoint(gerId, lat, lng) {
  const latEl = document.getElementById(`gerGpsLat_${gerId}`);
  const lngEl = document.getElementById(`gerGpsLng_${gerId}`);
  if (latEl) latEl.value = lat; if (lngEl) lngEl.value = lng;
  const res = document.getElementById(`gerKmzResults_${gerId}`);
  if (res) res.innerHTML = `<div style="color:#16a34a;font-size:12px;padding:4px 0;font-weight:600">✓ ${lat.toFixed(6)}, ${lng.toFixed(6)} — "Хадгалах" дарна уу</div>`;
}

async function uploadGerPhoto(gerId, input) {
  if (!input?.files?.length) return;
  let ok = 0;
  for (const file of input.files) {
    const fd = new FormData(); fd.append("file",file); fd.append("description",file.name);
    try { await fetch(API+`/api/sl-ger-inventory/${gerId}/photos`,{method:"POST",headers:{"Authorization":"Bearer "+state.token},body:fd}); ok++; } catch(e){}
  }
  toast(`${ok} зураг хадгаллаа ✓`); openGerDetail(gerId, "");
}

async function deleteGerPhoto(photoId, gerId, cat) {
  if (!confirm("Зураг устгах уу?")) return;
  try { await api(`/api/sl-ger-photos/${photoId}`,{method:"DELETE"}); toast("Устгагдлаа ✓"); openGerDetail(gerId, cat); }
  catch(e) { toast("Алдаа: "+e.message); }
}

async function uploadGerDoc(gerId, input) {
  if (!input?.files?.length) return;
  let ok = 0;
  for (const file of input.files) {
    const fd = new FormData(); fd.append("file",file); fd.append("description",file.name.replace(/\.[^.]+$/,""));
    try { await fetch(API+`/api/sl-ger-inventory/${gerId}/docs`,{method:"POST",headers:{"Authorization":"Bearer "+state.token},body:fd}); ok++; } catch(e){}
  }
  toast(`${ok} баримт хадгаллаа ✓`); openGerDetail(gerId, "");
}

async function deleteGerDoc(docId, gerId, cat) {
  if (!confirm("Баримт устгах уу?")) return;
  try { await api(`/api/sl-ger-docs/${docId}`,{method:"DELETE"}); toast("Устгагдлаа ✓"); openGerDetail(gerId, cat); }
  catch(e) { toast("Алдаа: "+e.message); }
}

function slAssets(cat)     { window._slAssetMode = true; assets(cat); }
function slHubAsset(cat)   { window._assetEmbedTarget = "slHubContent"; window._slAssetMode = true; assets(cat || "Авто замын гэрэл"); }
function sl_asset_road()   { slAssets("Авто замын гэрэл"); }
function sl_asset_ger()    { slAssets("Гэр хорооллын гэрэл"); }
function sl_asset_tower()  { slAssets("Цамхагийн гэрэл"); }
function sl_asset_signal() { slAssets("Гэрлэн дохио"); }
function sl_asset_panel()  { slAssets("Шит/Самбар"); }
function cameraAssetTab(tab) {
  _cameraAssetTab = tab === "list" ? "dashboard" : (tab || "dashboard");
  camera_assets();
}

function cameraAssetSearch(val) {
  _cameraAssetSearch = String(val || "").toLowerCase();
  document.querySelectorAll("#cameraAssetTable tbody tr[data-search]").forEach(tr => {
    const matchesSearch = tr.dataset.search.includes(_cameraAssetSearch);
    const matchesBag = !_cameraAssetBagFilter || tr.dataset.bag === _cameraAssetBagFilter;
    tr.style.display = matchesSearch && matchesBag ? "" : "none";
  });
}

function cameraAssetBagFilter(val) {
  _cameraAssetBagFilter = String(val || "");
  camera_assets();
}

function cameraBagNoOf(asset) {
  const explicit = Number(asset?.bag_no || 0);
  if (explicit > 0) return explicit;
  const text = `${asset?.name || ""} ${asset?.location || ""}`.toLowerCase();
  const match = text.match(/(?:^|\D)(\d{1,2})\s*(?:-?\s*р|дугаар)?\s*баг\b/u);
  return match ? Number(match[1]) : null;
}

function fiberRouteLengthM(latlngs) {
  const R = 6371000;
  let total = 0;
  for (let i = 1; i < latlngs.length; i++) {
    const a = latlngs[i - 1], b = latlngs[i];
    const p1 = a.lat * Math.PI / 180, p2 = b.lat * Math.PI / 180;
    const dp = (b.lat - a.lat) * Math.PI / 180;
    const dl = (b.lng - a.lng) * Math.PI / 180;
    const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    total += 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }
  return Math.round(total);
}

function fmtFiberLength(m) {
  return Number(m || 0) >= 1000 ? `${(Number(m) / 1000).toFixed(2)} км` : `${Math.round(Number(m || 0))} м`;
}

function fiberCoreColor(core) {
  const found = FIBER_CORE_OPTIONS.find(o => o.core === Number(core));
  return found?.color || "#7c3aed";
}

function fiberRouteCore(route) {
  const explicit = Number(route?.core_count || 0);
  if (explicit > 0) return explicit;
  const match = String(route?.route_type || "").match(/(\d+)\s*core/i);
  return match ? Number(match[1]) : 24;
}

function selectedFiberCore() {
  return Number(document.getElementById("fiberCoreSelect")?.value || 24);
}

function fiberCoreLegendHtml() {
  return FIBER_CORE_OPTIONS.map(o => `
    <span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:#475569;font-weight:700">
      <span style="width:18px;height:4px;border-radius:20px;background:${o.color};display:inline-block"></span>${o.core} core
    </span>
  `).join("");
}

function fiberCameraIcon() {
  return L.divIcon({
    className: "",
    html: `<div style="width:18px;height:18px;border-radius:50%;background:#2563eb;border:3px solid #fff;box-shadow:0 2px 8px rgba(15,23,42,.35);display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;line-height:1">●</div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -10]
  });
}

function fiberPointIcon(type = "Муфт") {
  const label = String(type || "Муфт").slice(0, 1).toUpperCase();
  const colors = {
    "Муфт": "#f97316",
    "Холболтын хайрцаг": "#0f766e",
    "ODF": "#7c3aed",
    "Кросс": "#db2777",
    "Splitter": "#0891b2",
    "Бусад": "#475569"
  };
  const color = colors[type] || "#475569";
  return L.divIcon({
    className: "",
    html: `<div style="width:24px;height:24px;border-radius:7px;background:${color};border:2px solid #fff;box-shadow:0 2px 10px rgba(15,23,42,.35);display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:900;line-height:1">${escapeHtml(label)}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12]
  });
}

function populateFiberRouteSelect() {
  const select = document.getElementById("fiberPointRouteSelect");
  if (!select) return;
  select.innerHTML = `<option value="">Трасстай холбохгүй</option>` +
    _fiberRoutes.map(r => `<option value="${r.id}">${escapeHtml(r.name || ("Трасс #" + r.id))}</option>`).join("");
}

function fiberRouteOptionHtml(selectedId = "") {
  return `<option value="">Сонгох</option>` +
    _fiberRoutes.map(r => `<option value="${r.id}" ${String(selectedId || "") === String(r.id) ? "selected" : ""}>${escapeHtml(r.name || ("Трасс #" + r.id))} · ${fiberRouteCore(r)} core</option>`).join("");
}

function fiberColorSelectHtml(id, selected = "") {
  return `<select id="${id}" class="input" style="margin:0;padding:5px 6px;font-size:11px;width:98px">
    ${FIBER_SPLICE_COLORS.map(c => `<option value="${c.name}" ${selected === c.name ? "selected" : ""}>${c.name}</option>`).join("")}
  </select>`;
}

function fiberColorSwatch(name) {
  const c = FIBER_SPLICE_COLORS.find(x => x.name === name) || FIBER_SPLICE_COLORS[0];
  const border = c.name === "White" ? "border:1px solid #cbd5e1;" : "";
  return `<span style="width:14px;height:14px;border-radius:50%;background:${c.color};${border}display:inline-block"></span>`;
}

function defaultFiberSpliceRows(count = 12) {
  return Array.from({ length: Math.max(1, count) }, (_, i) => {
    const color = FIBER_SPLICE_COLORS[i % FIBER_SPLICE_COLORS.length].name;
    return { a_core: i + 1, a_color: color, b_core: i + 1, b_color: color, note: "" };
  });
}

function updateFiberCameraLayerButton() {
  const btn = document.getElementById("fiberCameraLayerBtn");
  if (!btn) return;
  btn.textContent = _fiberCameraLayerVisible ? "Камер: ON" : "Камер: OFF";
  btn.style.background = _fiberCameraLayerVisible ? "#eff6ff" : "";
  btn.style.borderColor = _fiberCameraLayerVisible ? "#2563eb" : "";
  btn.style.color = _fiberCameraLayerVisible ? "#1d4ed8" : "";
}

function syncFiberCameraMarkerVisibility() {
  if (!_fiberMap) return;
  _fiberCameraMarkers.forEach(marker => {
    if (_fiberCameraLayerVisible) {
      if (!_fiberMap.hasLayer(marker)) marker.addTo(_fiberMap);
    } else if (_fiberMap.hasLayer(marker)) {
      marker.remove();
    }
  });
  updateFiberCameraLayerButton();
}

function loadLeaflet() {
  if (window.L) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (!document.querySelector("style[data-fiber-map]")) {
      const style = document.createElement("style");
      style.dataset.fiberMap = "1";
      style.textContent = `
        .fiber-route-label {
          background: rgba(255,255,255,.92);
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          color: #0f172a;
          font-size: 11px;
          font-weight: 800;
          padding: 2px 6px;
          box-shadow: 0 2px 8px rgba(15,23,42,.12);
        }
      `;
      document.head.appendChild(style);
    }
    if (!document.querySelector("link[data-leaflet]")) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      link.dataset.leaflet = "1";
      document.head.appendChild(link);
    }
    const existing = document.querySelector("script[data-leaflet]");
    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.dataset.leaflet = "1";
    script.onload = resolve;
    script.onerror = () => reject(new Error("Газрын зургийн сан ачаалж чадсангүй"));
    document.head.appendChild(script);
  });
}

async function initFiberMap(cameraRows = []) {
  const box = document.getElementById("fiberMap");
  const msg = document.getElementById("fiberMapHint");
  if (!box) return;
  try { await loadLeaflet(); } catch(e) {
    if (msg) msg.textContent = "Map ачаалж чадсангүй. Интернэт холболтоо шалгана уу.";
    return;
  }
  if (_fiberMap) {
    _fiberMap.remove();
    _fiberMap = null;
  }
  _fiberDrawMode = false;
  _fiberDrawPoints = [];
  _fiberDrawLayer = null;
  _fiberPointMode = false;
  _fiberGpsRows = cameraRows;
  _fiberCameraMarkers = [];
  _fiberPointMarkers = [];
  _fiberMap = L.map("fiberMap", { zoomControl: true }).setView([48.072, 114.532], 13);
  const streetLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  });
  const googleSatelliteLayer = L.tileLayer("https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", {
    maxZoom: 20,
    subdomains: ["0", "1", "2", "3"],
    attribution: "&copy; Google"
  }).addTo(_fiberMap);
  const esriSatelliteLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19,
    attribution: "Tiles &copy; Esri"
  });
  googleSatelliteLayer.on("tileerror", () => {
    if (msg) msg.textContent = "Satellite зураг ачаалахгүй байвал зүүн дээд layer-ээс 'Замын зураг' эсвэл 'Esri satellite' сонгоно уу.";
  });
  L.control.layers({
    "Google satellite": googleSatelliteLayer,
    "Esri satellite": esriSatelliteLayer,
    "Замын зураг": streetLayer
  }, null, { position: "topleft" }).addTo(_fiberMap);

  const points = [];
  cameraRows.forEach(r => {
    const lat = Number(r.gps_lat), lng = Number(r.gps_lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    points.push([lat, lng]);
    const marker = L.marker([lat, lng], { icon: fiberCameraIcon(), draggable: _fiberCameraMoveMode })
      .bindPopup(`<b>${escapeHtml(r.name || "Камер")}</b><br>${escapeHtml(r.asset_code || "")}<br>${escapeHtml(r.location || "")}<br><span style="font-size:11px;color:#64748b">GPS товчоор сонгоод map дээр дарна, эсвэл Камер зөөх горимоор чирнэ</span>`);
    marker.assetId = r.id;
    marker.on("dragstart", e => {
      e.target._oldLatLng = e.target.getLatLng();
    });
    marker.on("dragend", async e => {
      const pos = e.target.getLatLng();
      const saved = await saveCameraGpsFromMap(r.id, pos.lat, pos.lng, { refresh: false });
      if (!saved && e.target._oldLatLng) e.target.setLatLng(e.target._oldLatLng);
    });
    _fiberCameraMarkers.push(marker);
    if (_fiberCameraLayerVisible) marker.addTo(_fiberMap);
  });
  syncFiberCameraMarkerVisibility();

  try { _fiberRoutes = await api("/api/fiber-routes"); } catch(e) { _fiberRoutes = []; }
  populateFiberRouteSelect();
  _fiberRoutes.forEach(route => {
    const coords = route?.geojson?.geometry?.coordinates || [];
    if (coords.length < 2) return;
    const latlngs = coords.map(p => [Number(p[1]), Number(p[0])]);
    points.push(...latlngs);
    const core = fiberRouteCore(route);
    const color = route.color || fiberCoreColor(core);
    const line = L.polyline(latlngs, { color, weight: 7, opacity: 0.9 }).addTo(_fiberMap).bindPopup(`
      <b>${escapeHtml(route.name)}</b><br>
      ${core} core · ${escapeHtml(route.status || "")}<br>
      Урт: ${fmtFiberLength(route.length_m)}<br>
      ${route.note ? escapeHtml(route.note) + "<br>" : ""}
      <button onclick="deleteFiberRoute(${route.id})" style="margin-top:6px;border:1px solid #fecaca;background:#fef2f2;color:#dc2626;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer">Устгах</button>
    `);
    line.on("mouseover", () => line.setStyle({ weight: 9 }));
    line.on("mouseout", () => line.setStyle({ weight: 7 }));
  });
  try { _fiberPoints = await api("/api/fiber-points"); } catch(e) { _fiberPoints = []; }
  _fiberPoints.forEach(point => {
    const lat = Number(point.lat), lng = Number(point.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    points.push([lat, lng]);
    const marker = L.marker([lat, lng], { icon: fiberPointIcon(point.point_type) }).addTo(_fiberMap).bindPopup(`
      <b>${escapeHtml(point.name || "Цэг")}</b><br>
      ${escapeHtml(point.point_type || "Муфт")}<br>
      GPS: ${lat.toFixed(6)}, ${lng.toFixed(6)}<br>
      ${point.route_name ? `Кабель A: ${escapeHtml(point.route_name)}<br>` : ""}
      ${point.route_b_name ? `Кабель B: ${escapeHtml(point.route_b_name)}<br>` : ""}
      ${(point.splice || []).length ? `Core холболт: ${(point.splice || []).length}<br>` : ""}
      ${point.note ? escapeHtml(point.note) + "<br>" : ""}
      <button onclick="openFiberSpliceModal(${point.id})" style="margin-top:6px;border:1px solid #bfdbfe;background:#eff6ff;color:#1d4ed8;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer">Холболт</button>
      <button onclick="deleteFiberPoint(${point.id})" style="margin-top:6px;border:1px solid #fecaca;background:#fef2f2;color:#dc2626;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer">Устгах</button>
    `);
    _fiberPointMarkers.push(marker);
  });
  if (points.length) _fiberMap.fitBounds(points, { padding: [30, 30], maxZoom: 16 });
  if (msg) msg.textContent = `GPS-тэй камер: ${cameraRows.filter(r => Number.isFinite(Number(r.gps_lat)) && Number.isFinite(Number(r.gps_lng))).length} · Трасс: ${_fiberRoutes.length} · Цэг: ${_fiberPoints.length}`;
  const gpsSelect = document.getElementById("fiberGpsAssetSelect");
  if (gpsSelect) {
    const missing = cameraRows.filter(r => !Number.isFinite(Number(r.gps_lat)) || !Number.isFinite(Number(r.gps_lng)));
    gpsSelect.innerHTML = `<option value="">— GPS оруулах камер сонгох —</option>` +
      missing.map(r => `<option value="${r.id}">${escapeHtml(r.asset_code || "")} · ${escapeHtml(r.name || "Камер")}</option>`).join("");
    const gpsCount = document.getElementById("fiberGpsMissingCount");
    if (gpsCount) gpsCount.textContent = `${missing.length} GPS-гүй`;
  }
  setTimeout(() => _fiberMap?.invalidateSize(), 80);
  _fiberMap.on("click", e => {
    if (_fiberGpsPickAssetId) {
      saveCameraGpsFromMap(_fiberGpsPickAssetId, e.latlng.lat, e.latlng.lng);
      return;
    }
    if (_fiberPointMode) {
      saveFiberPointAt(e.latlng);
      return;
    }
    if (!_fiberDrawMode) return;
    _fiberDrawPoints.push(e.latlng);
    if (_fiberDrawLayer) _fiberDrawLayer.remove();
    _fiberDrawLayer = L.polyline(_fiberDrawPoints, { color: fiberCoreColor(selectedFiberCore()), weight: 5, dashArray: "6 6" }).addTo(_fiberMap);
    const hint = document.getElementById("fiberDrawHint");
    if (hint) hint.textContent = `${_fiberDrawPoints.length} цэг · ${fmtFiberLength(fiberRouteLengthM(_fiberDrawPoints))}`;
  });
}

function setFiberGpsTarget(assetId) {
  _fiberGpsPickAssetId = String(assetId || "");
  _fiberDrawMode = false;
  _fiberPointMode = false;
  const hint = document.getElementById("fiberGpsPickHint");
  if (!hint) return;
  if (!_fiberGpsPickAssetId) {
    hint.textContent = "Камер сонгоод map дээр байршлыг дарна";
    return;
  }
  const row = _fiberGpsRows.find(r => String(r.id) === _fiberGpsPickAssetId);
  hint.textContent = `${row?.name || "Камер"} — map дээр байршлыг дарна уу`;
}

function toggleFiberCameraMoveMode() {
  _fiberCameraMoveMode = !_fiberCameraMoveMode;
  _fiberCameraMarkers.forEach(marker => {
    if (_fiberCameraMoveMode) marker.dragging?.enable();
    else marker.dragging?.disable();
  });
  const btn = document.getElementById("fiberCameraMoveBtn");
  if (btn) {
    btn.textContent = _fiberCameraMoveMode ? "Камер зөөх: ON" : "Камер зөөх";
    btn.style.background = _fiberCameraMoveMode ? "#eff6ff" : "";
    btn.style.borderColor = _fiberCameraMoveMode ? "#2563eb" : "";
    btn.style.color = _fiberCameraMoveMode ? "#1d4ed8" : "";
  }
  const hint = document.getElementById("fiberGpsPickHint");
  if (hint) hint.textContent = _fiberCameraMoveMode ? "Камерын цэгийг чирээд шинэ байршил дээр тавина" : "Камер сонгоод map дээр байршлыг дарна";
}

function toggleFiberCameraLayer() {
  _fiberCameraLayerVisible = !_fiberCameraLayerVisible;
  syncFiberCameraMarkerVisibility();
}

function pickFiberCameraGps(assetId) {
  if (!_fiberMap) return toast("Газрын зураг ачаалагдаагүй байна");
  if (!_fiberCameraLayerVisible) {
    _fiberCameraLayerVisible = true;
    syncFiberCameraMarkerVisibility();
  }
  setFiberGpsTarget(assetId);
  const row = _fiberGpsRows.find(r => String(r.id) === String(assetId));
  const marker = _fiberCameraMarkers.find(m => String(m.assetId) === String(assetId));
  if (marker) {
    _fiberMap.setView(marker.getLatLng(), Math.max(_fiberMap.getZoom(), 16));
    marker.openPopup();
  } else if (row) {
    toast("Map дээр дарж энэ камерын GPS байрлалыг оруулна");
  }
  document.getElementById("fiberMap")?.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function saveCameraGpsFromMap(assetId, lat, lng, opts = {}) {
  const row = _fiberGpsRows.find(r => String(r.id) === String(assetId));
  if (!confirm(`${row?.name || "Камер"} цэгийн GPS-г энд хадгалах уу?\n${lat.toFixed(6)}, ${lng.toFixed(6)}`)) return false;
  try {
    await api(`/api/assets/${assetId}/gps`, {
      method: "PATCH",
      body: JSON.stringify({ gps_lat: lat, gps_lng: lng })
    });
    toast("GPS хадгаллаа ✓");
    _fiberGpsPickAssetId = "";
    if (opts.refresh === false) {
      if (row) {
        row.gps_lat = lat;
        row.gps_lng = lng;
      }
    } else {
      if (row) {
        row.gps_lat = lat;
        row.gps_lng = lng;
      }
      camera_assets();
    }
    return true;
  } catch(e) {
    toast("Алдаа: " + e.message);
    return false;
  }
}

function startFiberDraw() {
  if (!_fiberMap) return toast("Газрын зураг ачаалагдаагүй байна");
  _fiberDrawMode = true;
  _fiberPointMode = false;
  _fiberGpsPickAssetId = "";
  _fiberDrawPoints = [];
  if (_fiberDrawLayer) _fiberDrawLayer.remove();
  _fiberDrawLayer = null;
  const hint = document.getElementById("fiberDrawHint");
  if (hint) hint.textContent = "Map дээр цэг цэгээр дарж трассаа зурна";
}

function cancelFiberDraw() {
  _fiberDrawMode = false;
  _fiberDrawPoints = [];
  if (_fiberDrawLayer) _fiberDrawLayer.remove();
  _fiberDrawLayer = null;
  const hint = document.getElementById("fiberDrawHint");
  if (hint) hint.textContent = "Зураг дээр трасс зурж болно";
}

function startFiberPointAdd() {
  if (!_fiberMap) return toast("Газрын зураг ачаалагдаагүй байна");
  _fiberPointMode = true;
  _fiberDrawMode = false;
  _fiberGpsPickAssetId = "";
  const hint = document.getElementById("fiberPointHint");
  if (hint) hint.textContent = "Map дээр муфт/холболтын цэгийн байршлыг дарна";
}

function cancelFiberPointAdd() {
  _fiberPointMode = false;
  const hint = document.getElementById("fiberPointHint");
  if (hint) hint.textContent = "Цэг нэмэх товч дараад map дээр байрлал сонгоно";
}

async function saveFiberPointAt(latlng) {
  const type = document.getElementById("fiberPointTypeSelect")?.value || "Муфт";
  const routeId = document.getElementById("fiberPointRouteSelect")?.value || "";
  const noteEl = document.getElementById("fiberPointNote");
  const note = (noteEl?.value || "").trim();
  const name = prompt("Цэгийн нэр:", `${type}-${String(_fiberPoints.length + 1).padStart(3, "0")}`);
  if (!name) return;
  try {
    await api("/api/fiber-points", {
      method: "POST",
      body: JSON.stringify({
        name,
        point_type: type,
        route_id: routeId || null,
        lat: latlng.lat,
        lng: latlng.lng,
        note
      })
    });
    toast("Цэг хадгалагдлаа ✓");
    if (noteEl) noteEl.value = "";
    cancelFiberPointAdd();
    camera_assets();
  } catch(e) { toast("Алдаа: " + e.message); }
}

function openFiberSpliceModal(pointId) {
  const point = _fiberPoints.find(p => String(p.id) === String(pointId));
  const modal = document.getElementById("fiberSpliceModal");
  const inner = document.getElementById("fiberSpliceInner");
  if (!point || !modal || !inner) return;
  const routeA = _fiberRoutes.find(r => String(r.id) === String(point.route_id));
  const routeB = _fiberRoutes.find(r => String(r.id) === String(point.route_b_id));
  const maxCore = Math.min(96, Math.max(fiberRouteCore(routeA || {}), fiberRouteCore(routeB || {}), 12));
  const rows = (point.splice && point.splice.length) ? point.splice : defaultFiberSpliceRows(Math.min(maxCore, 12));
  inner.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #e2e8f0">
      <div>
        <div style="font-size:15px;font-weight:900;color:#0f172a">${escapeHtml(point.name || "Муфт")} · Core холболт</div>
        <div style="font-size:11px;color:#64748b;margin-top:2px">Хоёр шилэн кабелийн залгаа дээр core бүрийн холболтыг тэмдэглэнэ</div>
      </div>
      <button class="btn secondary" onclick="closeFiberSpliceModal()" style="padding:5px 10px;font-size:12px">Хаах</button>
    </div>
    <div style="padding:12px 16px;display:flex;gap:8px;flex-wrap:wrap;border-bottom:1px solid #e2e8f0">
      <select id="fiberSpliceRouteA" class="input" style="margin:0;padding:7px 10px;font-size:12px;width:min(310px,100%)">${fiberRouteOptionHtml(point.route_id)}</select>
      <select id="fiberSpliceRouteB" class="input" style="margin:0;padding:7px 10px;font-size:12px;width:min(310px,100%)">${fiberRouteOptionHtml(point.route_b_id)}</select>
      <button class="btn secondary" onclick="fiberSpliceAutoFill()" style="padding:7px 10px;font-size:12px">Авто 1-1</button>
    </div>
    <div id="fiberSpliceScroll" style="position:relative;padding:12px 16px;max-height:55vh;overflow:auto">
      <svg id="fiberSpliceSvg" style="position:absolute;inset:0;pointer-events:none;z-index:3;overflow:visible"></svg>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:#f8fafc">
          <th style="padding:7px;text-align:left">Кабель A core</th>
          <th style="padding:7px;text-align:left">Өнгө</th>
          <th style="padding:7px;text-align:center">→</th>
          <th style="padding:7px;text-align:left">Кабель B core</th>
          <th style="padding:7px;text-align:left">Өнгө</th>
          <th style="padding:7px;text-align:left">Тайлбар</th>
        </tr></thead>
        <tbody id="fiberSpliceRows">
          ${rows.map((r, i) => fiberSpliceRowHtml(r, i)).join("")}
        </tbody>
      </table>
    </div>
    <div style="display:flex;justify-content:space-between;gap:8px;padding:12px 16px;border-top:1px solid #e2e8f0">
      <button class="btn secondary" onclick="fiberSpliceAddRow()" style="padding:7px 12px;font-size:12px">+ Мөр</button>
      <div style="display:flex;gap:8px">
        <button class="btn secondary" onclick="closeFiberSpliceModal()" style="padding:7px 12px;font-size:12px">Цуцлах</button>
        <button class="btn" onclick="saveFiberSplice(${point.id})" style="padding:7px 12px;font-size:12px">Хадгалах</button>
      </div>
    </div>
  `;
  modal.style.display = "flex";
  bindFiberSpliceDrawing();
}

function fiberSpliceRowHtml(row = {}, idx = 0) {
  return `<tr data-splice-row style="border-top:1px solid #eef2f7">
    <td style="padding:6px"><input class="input" data-a-core type="number" min="1" value="${Number(row.a_core || idx + 1)}" style="margin:0;padding:5px 6px;font-size:11px;width:70px"></td>
    <td style="padding:6px;white-space:nowrap"><span data-a-anchor style="display:inline-flex;align-items:center;position:relative;z-index:4">${fiberColorSwatch(row.a_color)}</span> ${fiberColorSelectHtml(`splice_a_color_${idx}`, row.a_color || FIBER_SPLICE_COLORS[idx % FIBER_SPLICE_COLORS.length].name)}</td>
    <td style="padding:6px;text-align:center;color:#94a3b8">→</td>
    <td style="padding:6px"><input class="input" data-b-core type="number" min="1" value="${Number(row.b_core || idx + 1)}" style="margin:0;padding:5px 6px;font-size:11px;width:70px"></td>
    <td style="padding:6px;white-space:nowrap"><span data-b-anchor style="display:inline-flex;align-items:center;position:relative;z-index:4">${fiberColorSwatch(row.b_color)}</span> ${fiberColorSelectHtml(`splice_b_color_${idx}`, row.b_color || FIBER_SPLICE_COLORS[idx % FIBER_SPLICE_COLORS.length].name)}</td>
    <td style="padding:6px"><input class="input" data-note value="${escapeHtml(row.note || "")}" style="margin:0;padding:5px 6px;font-size:11px;width:160px"></td>
  </tr>`;
}

function closeFiberSpliceModal() {
  const modal = document.getElementById("fiberSpliceModal");
  if (modal) modal.style.display = "none";
}

function bindFiberSpliceDrawing() {
  const scroll = document.getElementById("fiberSpliceScroll");
  const body = document.getElementById("fiberSpliceRows");
  if (!scroll || !body) return;
  const redraw = () => requestAnimationFrame(drawFiberSpliceLines);
  scroll.addEventListener("scroll", redraw);
  body.addEventListener("input", redraw);
  body.addEventListener("change", redraw);
  window.addEventListener("resize", redraw, { once: true });
  redraw();
}

function drawFiberSpliceLines() {
  const scroll = document.getElementById("fiberSpliceScroll");
  const svg = document.getElementById("fiberSpliceSvg");
  const rows = [...document.querySelectorAll("#fiberSpliceRows [data-splice-row]")];
  if (!scroll || !svg || !rows.length) return;
  const rect = scroll.getBoundingClientRect();
  svg.setAttribute("width", scroll.scrollWidth);
  svg.setAttribute("height", scroll.scrollHeight);
  svg.setAttribute("viewBox", `0 0 ${scroll.scrollWidth} ${scroll.scrollHeight}`);
  svg.innerHTML = "";
  rows.forEach(row => {
    const aAnchor = row.querySelector("[data-a-anchor]");
    const bCore = Number(row.querySelector("[data-b-core]")?.value || 0);
    const targetRow = rows[bCore - 1] || row;
    const bAnchor = targetRow.querySelector("[data-b-anchor]");
    if (!aAnchor || !bAnchor) return;
    const a = aAnchor.getBoundingClientRect();
    const b = bAnchor.getBoundingClientRect();
    const x1 = a.left + a.width / 2 - rect.left + scroll.scrollLeft;
    const y1 = a.top + a.height / 2 - rect.top + scroll.scrollTop;
    const x2 = b.left + b.width / 2 - rect.left + scroll.scrollLeft;
    const y2 = b.top + b.height / 2 - rect.top + scroll.scrollTop;
    const dx = Math.max(50, Math.abs(x2 - x1) * 0.45);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "#38bdf8");
    path.setAttribute("stroke-width", "1.6");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("opacity", "0.9");
    svg.appendChild(path);
  });
}

function fiberSpliceAddRow() {
  const body = document.getElementById("fiberSpliceRows");
  if (!body) return;
  const idx = body.querySelectorAll("[data-splice-row]").length;
  body.insertAdjacentHTML("beforeend", fiberSpliceRowHtml(defaultFiberSpliceRows(idx + 1)[idx], idx));
  drawFiberSpliceLines();
}

function fiberSpliceAutoFill() {
  const body = document.getElementById("fiberSpliceRows");
  if (!body) return;
  const routeA = _fiberRoutes.find(r => String(r.id) === String(document.getElementById("fiberSpliceRouteA")?.value || ""));
  const routeB = _fiberRoutes.find(r => String(r.id) === String(document.getElementById("fiberSpliceRouteB")?.value || ""));
  const count = Math.min(96, Math.max(fiberRouteCore(routeA || {}), fiberRouteCore(routeB || {}), 12));
  body.innerHTML = defaultFiberSpliceRows(count).map((r, i) => fiberSpliceRowHtml(r, i)).join("");
  drawFiberSpliceLines();
}

async function saveFiberSplice(pointId) {
  const rows = [...document.querySelectorAll("#fiberSpliceRows [data-splice-row]")].map(tr => ({
    a_core: Number(tr.querySelector("[data-a-core]")?.value || 1),
    a_color: tr.querySelector("select[id^='splice_a_color_']")?.value || "",
    b_core: Number(tr.querySelector("[data-b-core]")?.value || 1),
    b_color: tr.querySelector("select[id^='splice_b_color_']")?.value || "",
    note: tr.querySelector("[data-note]")?.value || ""
  }));
  try {
    await api(`/api/fiber-points/${pointId}/splice`, {
      method: "PATCH",
      body: JSON.stringify({
        route_id: document.getElementById("fiberSpliceRouteA")?.value || null,
        route_b_id: document.getElementById("fiberSpliceRouteB")?.value || null,
        splice: rows
      })
    });
    toast("Core холболт хадгалагдлаа ✓");
    closeFiberSpliceModal();
    camera_assets();
  } catch(e) { toast("Алдаа: " + e.message); }
}

async function deleteFiberPoint(id) {
  if (!confirm("Энэ цэгийг устгах уу?")) return;
  try {
    await api(`/api/fiber-points/${id}`, { method: "DELETE" });
    toast("Цэг устгагдлаа ✓");
    camera_assets();
  } catch(e) { toast("Алдаа: " + e.message); }
}

async function saveFiberDraw() {
  if (_fiberDrawPoints.length < 2) return toast("Доод тал нь 2 цэг дарж трасс зурна уу");
  const core = selectedFiberCore();
  const noteInput = document.getElementById("fiberRouteNote");
  const note = (noteInput?.value || "").trim();
  const name = prompt("Трассын нэр:", note || `${core} core трасс`);
  if (!name) return;
  const coords = _fiberDrawPoints.map(p => [p.lng, p.lat]);
  try {
    await api("/api/fiber-routes", {
      method: "POST",
      body: JSON.stringify({
        name,
        route_type: `${core} core`,
        core_count: core,
        color: fiberCoreColor(core),
        status: "Идэвхтэй",
        note,
        length_m: fiberRouteLengthM(_fiberDrawPoints),
        geojson: { type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: {} }
      })
    });
    toast("Трасс хадгалагдлаа ✓");
    if (noteInput) noteInput.value = "";
    cancelFiberDraw();
    camera_assets();
  } catch(e) { toast("Алдаа: " + e.message); }
}

async function deleteFiberRoute(id) {
  if (!confirm("Энэ трассыг устгах уу?")) return;
  try {
    await api(`/api/fiber-routes/${id}`, { method: "DELETE" });
    toast("Трасс устгагдлаа ✓");
    camera_assets();
  } catch(e) { toast("Алдаа: " + e.message); }
}

function camRepairFilterTable() {
  const q     = (document.getElementById("camRepairSearchInput")?.value || "").toLowerCase().trim();
  const yearF = document.getElementById("camRepairYearFilter")?.value  || "";
  const monF  = document.getElementById("camRepairMonthFilter")?.value || "";
  let visible = 0;
  document.querySelectorAll("#camRepairTable tbody tr").forEach(tr => {
    const d = tr.dataset.date || "";
    const matchY = !yearF || d.slice(0, 4) === yearF;
    const matchM = !monF  || d.slice(5, 7) === monF;
    const matchQ = !q     || (tr.dataset.search || "").includes(q);
    const show = matchY && matchM && matchQ;
    tr.style.display = show ? "" : "none";
    if (show) visible++;
  });
  const cnt = document.getElementById("camRepairCount");
  if (cnt) cnt.textContent = `(${visible})`;
}

async function camera_assets() {
  window._slAssetMode = false;
  window._assetCat = "Камер";
  window._cameraAssetMode = true;
  const canCreate = ["director","chief_engineer","storekeeper","camera_engineer"].includes(state.me.role);
  const canDel = ["director","chief_engineer"].includes(state.me.role);
  let rows = [];
  let fiberRows = [];
  let flags = [];
  let workRows = [];
  let workExecs = [];
  const workYear = window.workYear || new Date().getFullYear();
  try {
    [rows, fiberRows, flags, workRows, workExecs] = await Promise.all([
      api("/api/assets?category=%D0%9A%D0%B0%D0%BC%D0%B5%D1%80"),
      api("/api/assets?category=%D0%A8%D0%B8%D0%BB%D1%8D%D0%BD%20%D0%BA%D0%B0%D0%B1%D0%B5%D0%BB%D1%8C").catch(() => []),
      api("/api/asset-flags").catch(() => []),
      api("/api/work-logs").catch(() => []),
      api(`/api/executions?year=${workYear}&category=${encodeURIComponent("Камер засвар")}`).catch(() => []),
    ]);
  } catch(e) {
    toast("Камерын бүртгэл уншиж чадсангүй: " + e.message);
  }
  const flagMap = new Map(flags.map(f => [`${f.table_name}_${f.record_id}`, f]));
  const closedStatuses = new Set(["Дууссан", "Хаагдсан"]);
  const cameraWorkRows = workRows
    .filter(r => r.category === "Камер засвар")
    .sort((a, b) => String(b.start_date || b.work_date || "").localeCompare(String(a.start_date || a.work_date || "")));
  const openCameraWorkRows = cameraWorkRows.filter(r => !closedStatuses.has(r.status));
  const activeRows = rows.filter(r => r.status === "Идэвхтэй");
  const brokenCameraCount = rows.reduce((sum, r) => sum + cameraBrokenCountOf(r), 0);
  const locations = new Set(rows.map(r => (r.location || "").trim()).filter(Boolean));
  const totalCameraCount = rows.reduce((sum, r) => sum + cameraCountOf(r), 0);
  const workingCameraCount = Math.max(0, totalCameraCount - brokenCameraCount);
  const cameraAvailabilityPct = totalCameraCount ? ((workingCameraCount / totalCameraCount) * 100).toFixed(1) : "0.0";
  const execsByWork = new Map();
  workExecs.forEach(e => {
    const list = execsByWork.get(e.work_log_id) || [];
    list.push(e);
    execsByWork.set(e.work_log_id, list);
  });
  const currentRows = rows;
  const cameraBagRows = currentRows
    .map(r => ({ ...r, _camera_bag_no: cameraBagNoOf(r) }));
  const searchedRows = cameraBagRows.filter(r => {
    const matchesSearch = !_cameraAssetSearch ||
      `${r.asset_code||""} ${r.name||""} ${r.location||""} ${r.assigned_name||""}`.toLowerCase().includes(_cameraAssetSearch);
    const matchesBag = !_cameraAssetBagFilter || String(r._camera_bag_no || "") === _cameraAssetBagFilter;
    const matchesCondition = !_cameraConditionFilter || cameraConditionOf(r) === _cameraConditionFilter;
    return matchesSearch && matchesBag && matchesCondition;
  });
  const cameraBagCounts = new Map();
  cameraBagRows.forEach(r => {
    const bagNo = Number(r._camera_bag_no || 0);
    if ((bagNo >= 1 && bagNo <= 11) || bagNo === 98 || bagNo === 99) cameraBagCounts.set(bagNo, (cameraBagCounts.get(bagNo) || 0) + 1);
  });
  const cameraBagBtn = (value, label, count = null) => {
    const active = String(value || "") === _cameraAssetBagFilter;
    return `<button type="button" onclick="cameraAssetBagFilter('${value || ""}')"
      style="border:1px solid ${active ? "#2563eb" : "#dbe3ef"};background:${active ? "#eff6ff" : "#fff"};color:${active ? "#1d4ed8" : "#475569"};border-radius:8px;padding:7px 10px;font-size:12px;font-weight:800;cursor:pointer;white-space:nowrap;min-width:58px">
      ${label}${count === null ? "" : ` <span style="font-size:10px;color:${active ? "#2563eb" : "#94a3b8"}">(${count})</span>`}
    </button>`;
  };
  const cameraBagButtonsHtml = `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
    ${Array.from({ length: 11 }, (_, i) => {
      const b = i + 1;
      return cameraBagBtn(String(b), `${b}-р`, cameraBagCounts.get(b) || 0);
    }).join("")}
    ${cameraBagBtn("98", "Авто зам", cameraBagCounts.get(98) || 0)}
    ${cameraBagBtn("99", "Аж ахуйн нэгж", cameraBagCounts.get(99) || 0)}
    <span style="margin-left:auto">${cameraBagBtn("", "Бүгд", cameraBagRows.length)}</span>
  </div>`;
  const conditionScopeRows = cameraBagRows.filter(r => {
    const matchesSearch = !_cameraAssetSearch ||
      `${r.asset_code||""} ${r.name||""} ${r.location||""} ${r.assigned_name||""}`.toLowerCase().includes(_cameraAssetSearch);
    const matchesBag = !_cameraAssetBagFilter || String(r._camera_bag_no || "") === _cameraAssetBagFilter;
    return matchesSearch && matchesBag;
  });
  const cameraConditionCounts = new Map();
  conditionScopeRows.forEach(r => {
    const condition = cameraConditionOf(r);
    cameraConditionCounts.set(condition, (cameraConditionCounts.get(condition) || 0) + 1);
  });
  const cameraConditionBtn = (value, label, count = null) => {
    const active = String(value || "") === _cameraConditionFilter;
    const colors = {
      "Засварлах": ["#fff7ed", "#d97706", "#fed7aa"],
      "Хэвийн": ["#f0fdf4", "#16a34a", "#bbf7d0"],
      "Татан буулгах": ["#fef2f2", "#dc2626", "#fecaca"],
      "Нүүлгэх": ["#eff6ff", "#2563eb", "#bfdbfe"],
    }[value] || ["#fff", "#475569", "#dbe3ef"];
    return `<button type="button" onclick="cameraConditionFilter('${value || ""}')"
      style="border:1px solid ${active ? colors[1] : colors[2]};background:${active ? colors[0] : "#fff"};color:${active ? colors[1] : "#475569"};border-radius:8px;padding:7px 10px;font-size:12px;font-weight:800;cursor:pointer;white-space:nowrap">
      ${label}${count === null ? "" : ` <span style="font-size:10px;color:${active ? colors[1] : "#94a3b8"}">(${count})</span>`}
    </button>`;
  };
  const cameraConditionButtonsHtml = `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
    ${cameraConditionBtn("", "Бүх нөхцөл", conditionScopeRows.length)}
    ${CAMERA_CONDITIONS.map(c => cameraConditionBtn(c, c, cameraConditionCounts.get(c) || 0)).join("")}
  </div>`;
  const searchedWorks = _cameraAssetSearch
    ? cameraWorkRows.filter(r => `${r.title||""} ${r.location||""} ${r.description||""} ${r.assigned_name||""} ${r.status||""}`.toLowerCase().includes(_cameraAssetSearch))
    : cameraWorkRows;
  const searchedFibers = _cameraAssetSearch
    ? fiberRows.filter(r => `${r.asset_code||""} ${r.name||""} ${r.location||""} ${r.assigned_name||""} ${r.status||""}`.toLowerCase().includes(_cameraAssetSearch))
    : fiberRows;
  const fiberMapCameraRows = _cameraAssetSearch
    ? cameraBagRows.filter(r => `${r.asset_code||""} ${r.name||""} ${r.location||""} ${r.assigned_name||""}`.toLowerCase().includes(_cameraAssetSearch))
    : cameraBagRows;
  const statusPill = (status = "") => {
    const color = status === "Хаагдсан" || status === "Дууссан" ? ["#dcfce7","#15803d"] :
      status === "Явцтай" || status === "Эхэлсэн" ? ["#dbeafe","#1d4ed8"] :
      status === "Хүлээгдэж байгаа" ? ["#f1f5f9","#475569"] : ["#fff7ed","#d97706"];
    return `<span style="font-size:10px;padding:3px 9px;border-radius:20px;background:${color[0]};color:${color[1]};font-weight:800">${escapeHtml(status || "—")}</span>`;
  };
  const tabBtn = (key, label) => `<button onclick="cameraAssetTab('${key}')" style="border:none;background:transparent;padding:12px 14px;cursor:pointer;font-size:13px;font-weight:700;color:${_cameraAssetTab===key?"#2563eb":"#475569"};border-bottom:3px solid ${_cameraAssetTab===key?"#2563eb":"transparent"}">${label}</button>`;
  const kpi = (label, value, color, bg, sub = "") => `<div style="background:${bg};border:1px solid ${color}33;border-radius:8px;padding:14px 16px;min-width:150px">
    <div style="font-size:24px;font-weight:800;color:${color}">${value}</div>
    <div style="font-size:12px;color:#475569;margin-top:4px">${label}</div>
    ${sub ? `<div style="font-size:10px;color:${color};font-weight:700;margin-top:3px">${sub}</div>` : ""}
  </div>`;

  // repair tab header — computed before template to avoid deep backtick nesting
  const _curMon = String(new Date().getMonth() + 1).padStart(2, "0");
  const _repairYears = [...new Set(cameraWorkRows.map(w => (w.start_date||w.work_date||"").slice(0,4)).filter(Boolean))].sort().reverse();
  if (!_repairYears.includes(String(workYear))) _repairYears.unshift(String(workYear));
  const _MON = ["1-р сар","2-р сар","3-р сар","4-р сар","5-р сар","6-р сар","7-р сар","8-р сар","9-р сар","10-р сар","11-р сар","12-р сар"];
  const _repairYearOpts = _repairYears.map(y => "<option value='" + y + "'" + (y===String(workYear)?" selected":"") + ">" + y + "</option>").join("");
  const _repairMonOpts  = _MON.map((n,i) => { const v=String(i+1).padStart(2,"0"); return "<option value='" + v + "'" + (v===_curMon?" selected":"") + ">" + n + "</option>"; }).join("");
  const _repairAddBtn   = ["director","chief_engineer","engineer","camera_engineer"].includes(state.me.role)
    ? "<button class='btn' onclick=\"window.workCat='Камер засвар';window.workYear=" + workYear + ";show('work');setTimeout(()=>toggleWorkForm?.(),250)\" style='padding:6px 14px;font-size:12px'>+ Камер засвар нэмэх</button>" : "";
  const camRepairHeader = "<div style='display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #e2e6ed;gap:12px;flex-wrap:wrap'>"
    + "<div style='font-size:14px;font-weight:800'>🛠 Камер засварын ажлууд <span id='camRepairCount' style='font-size:12px;color:#667085;font-weight:400'></span></div>"
    + "<div style='display:flex;gap:8px;flex-wrap:wrap;align-items:center'>"
    + "<select id='camRepairYearFilter' class='input' style='width:78px;margin:0' onchange='camRepairFilterTable()'><option value=''>Бүх жил</option>" + _repairYearOpts + "</select>"
    + "<select id='camRepairMonthFilter' class='input' style='width:110px;margin:0' onchange='camRepairFilterTable()'><option value=''>Бүх сар</option>" + _repairMonOpts + "</select>"
    + "<input id='camRepairSearchInput' class='input' style='width:170px;margin:0' placeholder='🔍 Хайх...' oninput='camRepairFilterTable()'>"
    + "<button class='btn secondary' onclick=\"window.workCat='Камер засвар';window.workYear=" + workYear + ";show('work')\" style='padding:6px 14px;font-size:12px'>📅 Gantt нээх</button>"
    + _repairAddBtn
    + "</div></div>";

  // rows pre-computed to avoid nested backtick depth > 2 inside main.innerHTML template
  const camRepairRows = cameraWorkRows.length ? cameraWorkRows.map((w, i) => {
    const execs = execsByWork.get(w.id) || [];
    const progress = Math.max(0, Math.min(100, Number(w.progress || 0)));
    const wDate = w.start_date || w.work_date || "";
    const pColor = progress >= 100 ? "#16a34a" : "#2563eb";
    const searchStr = ((w.title||"") + " " + (w.location||"") + " " + (w.assigned_name||"") + " " + (w.status||"")).toLowerCase();
    const descHtml = w.description
      ? "<div style='font-size:11px;color:#94a3b8;margin-top:2px'>" + escapeHtml(String(w.description).slice(0,90)) + (String(w.description).length > 90 ? "…" : "") + "</div>"
      : "";
    return `<tr data-search="${escapeHtml(searchStr)}" data-date="${escapeHtml(wDate)}">
      <td style="color:#94a3b8;font-size:11px">${i+1}</td>
      <td>
        <div style="font-weight:800;color:#1d4ed8">${escapeHtml(w.title || "—")}</div>
        <div style="font-size:11px;color:#667085;margin-top:2px">📍 ${escapeHtml(w.location || "Байршил оруулаагүй")}</div>
        ${descHtml}
      </td>
      <td style="font-size:12px;font-family:monospace;color:#475569;white-space:nowrap">${escapeHtml(w.start_date || w.work_date || "—")} → ${escapeHtml(w.end_date || w.work_date || "—")}</td>
      <td style="text-align:center;min-width:90px">
        <div style="font-weight:800;color:${pColor}">${progress}%</div>
        <div style="height:5px;background:#e2e8f0;border-radius:99px;overflow:hidden;margin-top:4px">
          <div style="height:100%;width:${progress}%;background:${pColor}"></div>
        </div>
      </td>
      <td>${statusPill(w.status)}</td>
      <td style="font-size:12px">${escapeHtml(w.assigned_name || w.created_name || "—")}</td>
      <td style="text-align:center;font-family:monospace;color:#667085">${execs.length}</td>
      <td style="text-align:center;font-family:monospace;color:#667085">${(w.photo_count || 0) + execs.reduce((s, e) => s + Number(e.photo_count || 0), 0)}</td>
      <td><div style="display:flex;gap:4px;justify-content:flex-end;flex-wrap:wrap">
        <button class="btn secondary" style="padding:3px 8px;font-size:10px" onclick="window.workCat='Камер засвар';window.workYear=${workYear};show('work')">📅</button>
        <button class="btn secondary" style="padding:3px 8px;font-size:10px" onclick="window.workCat='Камер засвар';window.workYear=${workYear};show('work');setTimeout(()=>editWorkById?.(${w.id},window._workAllRows||[]),350)">✏️</button>
      </div></td>
    </tr>`;
  }).join("") : "<tr><td colspan='9' style='text-align:center;color:#667085;padding:30px'>Камер засварын ажил бүртгэгдээгүй байна</td></tr>";

  main.innerHTML = `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px">
    <div>
      <h1 style="margin:0 0 4px;font-size:22px;font-weight:800">🎥 Камерын цэгийн бүртгэлийн төв</h1>
      <div style="font-size:12px;color:#667085">Камерын цэг · Камерын тоо · Гэмтэл · Төлөв · Байршил</div>
    </div>
    ${canCreate ? `<button class="btn" onclick="openAssetForm()" style="padding:9px 16px">+ Камерын цэг нэмэх</button>` : ""}
  </div>

  <div class="panel" style="margin-bottom:16px;overflow:hidden">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:0 18px">
      <div style="display:flex;align-items:center;gap:4px;overflow-x:auto">
        ${tabBtn("dashboard","📊 Самбар / цэгийн жагсаалт")}
        ${tabBtn("fiber","🧵 Шилэн кабель")}
        ${tabBtn("repair","🛠 Засвар / гэмтэл")}
        ${tabBtn("report","📈 Судалгаа")}
      </div>
      <input value="${escapeHtml(_cameraAssetSearch)}" oninput="cameraAssetSearch(this.value)" placeholder="Камер, код, байршил хайх..."
        style="padding:8px 12px;border:1px solid #dbe3ef;border-radius:8px;font-size:12px;width:min(280px,100%);outline:none">
    </div>
  </div>

  <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px">
    ${kpi("Камерын цэг", rows.length, "#2563eb", "#eff6ff")}
    ${kpi("Нийт камер", totalCameraCount, "#0ea5e9", "#f0f9ff")}
    ${kpi("Ажиллагааны хувь", `${cameraAvailabilityPct}%`, "#16a34a", "#f0fdf4", `${workingCameraCount} хэвийн`)}
    ${kpi("Гэмтэлтэй камер", brokenCameraCount, "#d97706", "#fff7ed")}
    ${kpi("Камер засвар", openCameraWorkRows.length, "#dc2626", "#fef2f2", `${cameraWorkRows.length} нийт ажил`)}
    ${kpi("Шилэн кабель", fiberRows.length, "#8b5cf6", "#f5f3ff")}
    ${kpi("Байршил", locations.size, "#7c3aed", "#f5f3ff")}
  </div>

  ${_cameraAssetTab === "report" ? `<div id="cameraAnalyticsBox" class="panel" style="padding:18px;margin-bottom:16px">
    <div style="text-align:center;color:#667085;padding:24px">Судалгаа ачааллаж байна...</div>
  </div>` : ""}

  <div id="assetFormModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;align-items:flex-start;justify-content:center;padding-top:30px;overflow-y:auto"
    onclick="if(event.target===this)closeAssetForm()"><div id="assetFormInner" style="background:#fff;border-radius:14px;width:min(700px,96vw);margin:0 auto 40px;box-shadow:0 20px 60px rgba(0,0,0,.25)"></div></div>
  <div id="assetPassportModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;align-items:flex-start;justify-content:center;padding-top:30px;overflow-y:auto"
    onclick="if(event.target===this)closePassport()"><div id="assetPassportInner" style="background:#fff;border-radius:14px;width:min(780px,96vw);margin:0 auto 40px;box-shadow:0 20px 60px rgba(0,0,0,.25)"></div></div>
  <div id="globalLightbox" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.93);z-index:3000;align-items:center;justify-content:center;flex-direction:column"
    onclick="if(event.target.id==='globalLightbox')closeLightbox()">
    <button onclick="closeLightbox()" style="position:fixed;top:14px;right:18px;background:rgba(255,255,255,.15);border:none;color:#fff;border-radius:8px;padding:6px 16px;cursor:pointer;font-size:15px;z-index:1">✕</button>
    <button id="lbPrev" onclick="lightboxNav(-1)" style="display:none;position:fixed;left:14px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,.15);border:none;color:#fff;border-radius:50%;width:48px;height:48px;font-size:26px;cursor:pointer;z-index:1;line-height:1">‹</button>
    <img id="lbImg" style="max-width:92vw;max-height:88vh;object-fit:contain;border-radius:8px;box-shadow:0 8px 48px rgba(0,0,0,.6)">
    <div id="lbCaption" style="color:rgba(255,255,255,.6);font-size:12px;margin-top:12px;text-align:center"></div>
    <button id="lbNext" onclick="lightboxNav(1)" style="display:none;position:fixed;right:14px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,.15);border:none;color:#fff;border-radius:50%;width:48px;height:48px;font-size:26px;cursor:pointer;z-index:1;line-height:1">›</button>
  </div>
  <div id="assetFlagModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2000;align-items:center;justify-content:center"
    onclick="if(event.target===this)closeAssetFlagModal()">
    <div style="background:#fff;border-radius:14px;width:min(420px,94vw);padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.25)">
      <div style="font-size:15px;font-weight:800;margin-bottom:6px">🚩 Буруу бүртгэл тэмдэглэх</div>
      <div id="afmTitle" style="font-size:12px;color:#667085;margin-bottom:14px"></div>
      <div style="font-size:11px;color:#374151;font-weight:600;margin-bottom:6px">Юу буруу бүртгэгдсэн? *</div>
      <textarea id="afmNote" rows="3" placeholder="Жишээ: байршил, код, хариуцагч буруу..."
        style="width:100%;border:1px solid #e2e6ed;border-radius:8px;padding:8px 10px;font-size:13px;resize:vertical;outline:none;box-sizing:border-box"></textarea>
      <div style="display:flex;gap:8px;margin-top:14px">
        <button onclick="saveAssetFlag()" class="btn" style="flex:1;background:#d97706;border-color:#d97706">🚩 Тэмдэглэх</button>
        <button onclick="closeAssetFlagModal()" class="btn secondary">Цуцлах</button>
      </div>
    </div>
  </div>
  <div id="fiberSpliceModal" style="display:none;position:fixed;inset:0;background:rgba(15,23,42,.50);z-index:2600;align-items:flex-start;justify-content:center;padding-top:34px;overflow:auto"
    onclick="if(event.target===this)closeFiberSpliceModal()">
    <div id="fiberSpliceInner" style="background:#fff;border-radius:10px;width:min(920px,96vw);margin:0 auto 40px;box-shadow:0 22px 70px rgba(15,23,42,.32);overflow:hidden"></div>
  </div>

  ${_cameraAssetTab === "fiber" ? `
  <div class="panel">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #e2e6ed;gap:12px;flex-wrap:wrap">
      <div>
        <div style="font-size:14px;font-weight:800">🧵 Шилэн кабелийн бүртгэл <span style="font-size:12px;color:#667085;font-weight:400">(${searchedFibers.length})</span></div>
        <div style="font-size:11px;color:#667085;margin-top:2px">Камерын сүлжээний шилэн кабель, байршил, хариуцагч, файл</div>
      </div>
      ${canCreate ? `<button class="btn" onclick="window._assetCat='Шилэн кабель';openAssetForm()" style="padding:6px 14px;font-size:12px">+ Кабель нэмэх</button>` : ""}
    </div>
    <div style="padding:14px 18px;border-bottom:1px solid #e2e6ed;background:#fbfdff">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px">
        <div>
          <div style="font-size:13px;font-weight:800;color:#1e293b">🗺 Шилэн кабелийн трассын зураг</div>
          <div id="fiberMapHint" style="font-size:11px;color:#667085;margin-top:2px">Газрын зураг ачааллаж байна...</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <span id="fiberDrawHint" style="font-size:11px;color:#667085;margin-right:4px">Зураг дээр трасс зурж болно</span>
          <button class="btn secondary" style="padding:6px 12px;font-size:12px" onclick="startFiberDraw()">Трасс зурах</button>
          <button class="btn" style="padding:6px 12px;font-size:12px" onclick="saveFiberDraw()">Хадгалах</button>
          <button class="btn secondary" style="padding:6px 12px;font-size:12px" onclick="cancelFiberDraw()">Цуцлах</button>
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px">
        <div style="font-size:12px;font-weight:800;color:#334155">Core / өнгө</div>
        <select id="fiberCoreSelect" class="input" style="width:130px;margin:0;padding:7px 10px;font-size:12px">
          ${FIBER_CORE_OPTIONS.map(o => `<option value="${o.core}" ${o.core === 24 ? "selected" : ""}>${o.core} core</option>`).join("")}
        </select>
        <input id="fiberRouteNote" class="input" placeholder="Тэмдэглэл / холболт / хайрцаг..." style="width:min(380px,100%);margin:0;padding:7px 10px;font-size:12px">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-left:auto">${fiberCoreLegendHtml()}</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px">
        <div style="font-size:12px;font-weight:800;color:#334155">Муфт / цэг</div>
        <select id="fiberPointTypeSelect" class="input" style="width:160px;margin:0;padding:7px 10px;font-size:12px">
          ${FIBER_POINT_TYPES.map(t => `<option>${escapeHtml(t)}</option>`).join("")}
        </select>
        <select id="fiberPointRouteSelect" class="input" style="width:min(260px,100%);margin:0;padding:7px 10px;font-size:12px">
          <option value="">Трасстай холбохгүй</option>
        </select>
        <input id="fiberPointNote" class="input" placeholder="Байршил / тайлбар / холболт..." style="width:min(320px,100%);margin:0;padding:7px 10px;font-size:12px">
        <button class="btn secondary" type="button" onclick="startFiberPointAdd()" style="padding:6px 12px;font-size:12px">Цэг нэмэх</button>
        <button class="btn secondary" type="button" onclick="cancelFiberPointAdd()" style="padding:6px 12px;font-size:12px">Цуцлах</button>
        <span id="fiberPointHint" style="font-size:11px;color:#667085">Цэг нэмэх товч дараад map дээр байрлал сонгоно</span>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px">
        <div style="font-size:12px;font-weight:800;color:#334155">GPS оруулах</div>
        <select id="fiberGpsAssetSelect" class="input" onchange="setFiberGpsTarget(this.value)" style="width:min(360px,100%);margin:0;padding:7px 10px;font-size:12px"></select>
        <span id="fiberGpsMissingCount" style="font-size:11px;color:#94a3b8;font-weight:700"></span>
        <button id="fiberCameraLayerBtn" class="btn secondary" type="button" onclick="toggleFiberCameraLayer()" style="padding:6px 12px;font-size:12px">Камер: ON</button>
        <button id="fiberCameraMoveBtn" class="btn secondary" type="button" onclick="toggleFiberCameraMoveMode()" style="padding:6px 12px;font-size:12px">Камер зөөх</button>
        <span id="fiberGpsPickHint" style="font-size:11px;color:#667085">Камер сонгоод map дээр байршлыг дарна</span>
      </div>
      <div id="fiberMap" style="height:430px;border:1px solid #dbe3ef;border-radius:8px;overflow:hidden;background:#e5edf7"></div>
    </div>
    <div style="padding:12px 18px;border-bottom:1px solid #e2e6ed;background:#fff">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:8px">
        <div style="font-size:13px;font-weight:800;color:#1e293b">🎥 Камерын GPS жагсаалт <span style="font-size:12px;color:#667085;font-weight:400">(${fiberMapCameraRows.length})</span></div>
        <div style="font-size:11px;color:#667085">GPS товч дараад map дээр шинэ байрлал дарна</div>
      </div>
      <div style="max-height:260px;overflow:auto;border:1px solid #e2e8f0;border-radius:8px">
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:#f8fafc">
            <th style="text-align:left;padding:9px 10px;font-size:11px;color:#475569">#</th>
            <th style="text-align:left;padding:9px 10px;font-size:11px;color:#475569">Код</th>
            <th style="text-align:left;padding:9px 10px;font-size:11px;color:#475569">Камер / байршил</th>
            <th style="text-align:left;padding:9px 10px;font-size:11px;color:#475569">GPS</th>
            <th style="text-align:center;padding:9px 10px;font-size:11px;color:#475569">Үйлдэл</th>
          </tr></thead>
          <tbody>
            ${fiberMapCameraRows.map((r, i) => {
              const hasGps = Number.isFinite(Number(r.gps_lat)) && Number.isFinite(Number(r.gps_lng));
              return `<tr style="border-top:1px solid #eef2f7">
                <td style="padding:8px 10px;font-size:11px;color:#94a3b8">${i + 1}</td>
                <td style="padding:8px 10px"><span style="font-family:monospace;font-size:11px;background:#f1f5f9;padding:2px 6px;border-radius:4px">${escapeHtml(r.asset_code || "—")}</span></td>
                <td style="padding:8px 10px">
                  <div style="font-size:12px;font-weight:800;color:#1d4ed8;cursor:pointer" onclick="openPassport(${r.id})">${escapeHtml(r.name || "Камер")}</div>
                  <div style="font-size:11px;color:#667085;margin-top:2px">${escapeHtml(r.location || "Байршил оруулаагүй")}</div>
                </td>
                <td style="padding:8px 10px;font-family:monospace;font-size:11px;color:${hasGps ? "#15803d" : "#dc2626"}">${hasGps ? `${Number(r.gps_lat).toFixed(6)}, ${Number(r.gps_lng).toFixed(6)}` : "GPS байхгүй"}</td>
                <td style="padding:8px 10px;text-align:center">
                  <button class="btn secondary" type="button" onclick="pickFiberCameraGps(${r.id})" style="padding:4px 10px;font-size:11px">GPS</button>
                </td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
    </div>
    <div class="table-wrap">
      <table id="cameraAssetTable">
        <thead><tr>
          <th style="width:40px">#</th>
          <th>Код</th>
          <th>Нэр / байршил</th>
          <th>Дэд ангилал</th>
          <th>Төлөв</th>
          <th>Нөхцөл</th>
          <th>Хариуцагч</th>
          <th style="text-align:center">Файл</th>
          <th style="text-align:center">Ажил</th>
          <th></th>
        </tr></thead>
        <tbody>
          ${searchedFibers.length ? searchedFibers.map((r,i) => {
            const condColor = r.condition === "Хэвийн" ? "#16a34a" : r.condition === "Засвар хэрэгтэй" ? "#d97706" : "#dc2626";
            const statusBg = r.status === "Идэвхтэй" ? "#dcfce7" : r.status === "Засварт" ? "#fff7ed" : "#f1f5f9";
            const statusColor = r.status === "Идэвхтэй" ? "#16a34a" : r.status === "Засварт" ? "#d97706" : "#475569";
            const fl = flagMap.get(`assets_${r.id}`);
            const search = `${r.asset_code||""} ${r.name||""} ${r.location||""} ${r.assigned_name||""}`.toLowerCase();
            return `<tr data-search="${escapeHtml(search)}" style="${fl&&!fl.is_resolved?"background:#fffbeb;border-left:3px solid #d97706":""}">
              <td style="color:#94a3b8;font-size:11px">${i+1}</td>
              <td><span style="font-family:monospace;font-size:11px;background:#f1f5f9;padding:2px 6px;border-radius:4px">${escapeHtml(r.asset_code||"—")}</span></td>
              <td>
                <div style="font-weight:800;color:#1d4ed8;cursor:pointer" onclick="openPassport(${r.id})">${escapeHtml(r.name||"—")}</div>
                <div style="font-size:11px;color:#667085;margin-top:2px">${escapeHtml(r.location||"Байршил оруулаагүй")}</div>
                ${fl&&!fl.is_resolved?`<div style="font-size:10px;color:#d97706;margin-top:2px">🚩 ${escapeHtml((fl.flag_note||"").slice(0,30))}${fl.flag_note?.length>30?"…":""}</div>`:""}
              </td>
              <td style="font-size:12px">${escapeHtml(r.sub_category||"—")}</td>
              <td><span style="font-size:10px;padding:3px 9px;border-radius:20px;background:${statusBg};color:${statusColor};font-weight:800">${escapeHtml(r.status||"—")}</span></td>
              <td><span style="font-size:11px;color:${condColor};font-weight:800">${escapeHtml(r.condition||"—")}</span></td>
              <td style="font-size:12px">${escapeHtml(r.assigned_name||"—")}</td>
              <td style="text-align:center;font-family:monospace;color:#667085">${r.file_count||0}</td>
              <td style="text-align:center;font-family:monospace;color:#667085">${r.work_count||0}</td>
              <td><div style="display:flex;gap:4px;justify-content:flex-end;flex-wrap:wrap">
                <button class="btn secondary" style="padding:3px 8px;font-size:10px" onclick="openPassport(${r.id})">📋</button>
                ${canCreate ? `<button class="btn secondary" style="padding:3px 8px;font-size:10px" onclick="openAssetForm(${r.id})">✏️</button>` : ""}
                ${canDel ? `<button class="btn danger" style="padding:3px 8px;font-size:10px" onclick="confirmDeleteAsset(${r.id})">🗑</button>` : ""}
                ${fl&&!fl.is_resolved
                  ? `<button class="btn secondary" style="padding:3px 8px;font-size:10px;color:#16a34a" onclick="resolveAssetFlag(${fl.id})">✓</button>`
                  : `<button class="btn secondary" style="padding:3px 8px;font-size:10px" onclick="openAssetFlagModal('assets',${r.id},'${escapeHtml((r.name||"").replace(/'/g,""))}')">🚩</button>`}
              </div></td>
            </tr>`;
          }).join("") : `<tr><td colspan="10" style="text-align:center;color:#667085;padding:30px">Шилэн кабель бүртгэгдээгүй байна</td></tr>`}
        </tbody>
      </table>
    </div>
  </div>` : _cameraAssetTab === "repair" ? `
  <div class=”panel”>
    ${camRepairHeader}
    <div class=”table-wrap”>
      <table id=”camRepairTable”>
        <thead><tr>
          <th style=”width:40px”>#</th>
          <th>Ажлын нэр / байршил</th>
          <th>Хугацаа</th>
          <th style=”text-align:center”>Явц</th>
          <th>Төлөв</th>
          <th>Хариуцагч</th>
          <th style=”text-align:center”>Гүйцэтгэл</th>
          <th style=”text-align:center”>Зураг</th>
          <th></th>
        </tr></thead>
        <tbody>${camRepairRows}</tbody>
      </table>
    </div>
  </div>` : _cameraAssetTab === "report" ? "" : `
  <div class="panel">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #e2e6ed;gap:12px;flex-wrap:wrap">
      <div style="font-size:14px;font-weight:800">🎥 Камерын цэгийн жагсаалт <span style="font-size:12px;color:#667085;font-weight:400">(${searchedRows.length})</span></div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        ${canCreate ? `<button class="btn secondary" onclick="openAssetForm()" style="padding:6px 14px;font-size:12px">+ Шинэ цэг</button>` : ""}
      </div>
    </div>
    <div style="padding:10px 18px;border-bottom:1px solid #eef2f7;background:#fbfdff">
      ${cameraBagButtonsHtml}
    </div>
    <div style="padding:10px 18px;border-bottom:1px solid #eef2f7;background:#fff">
      ${cameraConditionButtonsHtml}
    </div>
    <div class="table-wrap">
      <table id="cameraAssetTable">
        <thead><tr>
          <th style="width:40px">#</th>
          <th>Код</th>
          <th>Цэг / Байршил</th>
          <th style="text-align:center">Камерын тоо</th>
          <th style="text-align:center">Гэмтэл</th>
          <th>Төлөв</th>
          <th>Нөхцөл</th>
          <th style="text-align:center">Файл</th>
          <th style="text-align:center">Ажил</th>
          <th></th>
        </tr></thead>
        <tbody>
          ${searchedRows.length ? searchedRows.map((r,i) => {
            const rowCondition = cameraConditionOf(r);
            const conditionStyle = {
              "Засварлах": ["#fff7ed", "#d97706", "#fed7aa"],
              "Хэвийн": ["#f0fdf4", "#16a34a", "#bbf7d0"],
              "Татан буулгах": ["#fef2f2", "#dc2626", "#fecaca"],
              "Нүүлгэх": ["#eff6ff", "#2563eb", "#bfdbfe"],
            }[rowCondition] || ["#fff", "#475569", "#dbe3ef"];
            const statusBg = r.status === "Идэвхтэй" ? "#dcfce7" : r.status === "Засварт" ? "#fff7ed" : "#f1f5f9";
            const statusColor = r.status === "Идэвхтэй" ? "#16a34a" : r.status === "Засварт" ? "#d97706" : "#475569";
            const fl = flagMap.get(`assets_${r.id}`);
            const camCount = cameraCountOf(r);
            const brokenCount = cameraBrokenCountOf(r);
            const rowStatus = r.status === "Идэвхгүй" ? "Идэвхгүй" : "Идэвхтэй";
            const search = `${r.asset_code||""} ${r.name||""} ${r.location||""} ${r.assigned_name||""}`.toLowerCase();
            const bagNo = r._camera_bag_no || cameraBagNoOf(r);
            const bagLabel = Number(bagNo || 0) === 99 ? "Аж ахуйн нэгж" : Number(bagNo || 0) === 98 ? "Авто зам" : (bagNo ? `${bagNo}-р баг` : "");
            const bagSelect = `<select onchange="updateCameraBag(${r.id}, this.value)"
              style="margin-top:5px;border:1px solid #dbe3ef;border-radius:7px;padding:3px 7px;font-size:11px;font-weight:800;color:#475569;background:#fff;outline:none">
              <option value="">Баг сонгох</option>
              ${Array.from({ length: 11 }, (_, i) => {
                const b = i + 1;
                return `<option value="${b}" ${Number(bagNo || 0)===b?"selected":""}>${b}-р баг</option>`;
              }).join("")}
              <option value="98" ${Number(bagNo || 0)===98?"selected":""}>Авто зам</option>
              <option value="99" ${Number(bagNo || 0)===99?"selected":""}>Аж ахуйн нэгж</option>
            </select>`;
            const conditionSelect = `<select onchange="updateCameraCondition(${r.id}, this.value)"
              style="border:1px solid ${conditionStyle[2]};border-radius:8px;padding:5px 8px;font-size:11px;font-weight:800;color:${conditionStyle[1]};background:${conditionStyle[0]};outline:none;min-width:120px">
              ${CAMERA_CONDITIONS.map(c => `<option value="${c}" ${rowCondition===c?"selected":""}>${c}</option>`).join("")}
            </select>`;
            return `<tr data-search="${escapeHtml(search)}" data-bag="${bagNo || ""}" style="${fl&&!fl.is_resolved?"background:#fffbeb;border-left:3px solid #d97706":""}">
              <td style="color:#94a3b8;font-size:11px">${i+1}</td>
              <td><span style="font-family:monospace;font-size:11px;background:#f1f5f9;padding:2px 6px;border-radius:4px">${escapeHtml(r.asset_code||"—")}</span></td>
              <td>
                <div style="font-weight:700;color:#1d4ed8;cursor:pointer" onclick="openPassport(${r.id})">${escapeHtml(r.name||"—")} ${bagLabel ? `<span style="font-size:10px;background:#eef2ff;color:#4338ca;border-radius:999px;padding:2px 7px;margin-left:6px;white-space:nowrap">${bagLabel}</span>` : ""}</div>
                <div style="font-size:11px;color:#667085;margin-top:2px">${escapeHtml(r.location||"Байршил оруулаагүй")}</div>
                ${bagSelect}
                ${fl&&!fl.is_resolved?`<div style="font-size:10px;color:#d97706;margin-top:2px">🚩 ${escapeHtml((fl.flag_note||"").slice(0,30))}${fl.flag_note?.length>30?"…":""}</div>`:""}
              </td>
              <td style="text-align:center">
                <input type="number" min="1" step="1" value="${camCount}"
                  onchange="updateCameraCounts(${r.id}, this.value, document.getElementById('cam_broken_${r.id}')?.value || 0, document.getElementById('cam_status_${r.id}')?.value || 'Идэвхтэй')"
                  style="width:58px;text-align:center;border:1px solid #bfdbfe;border-radius:8px;padding:4px 2px;font-weight:800;color:#0ea5e9;background:#f0f9ff">
              </td>
              <td style="text-align:center">
                <input id="cam_broken_${r.id}" type="number" min="0" max="${camCount}" step="1" value="${brokenCount}"
                  onchange="updateCameraCounts(${r.id}, ${camCount}, this.value, document.getElementById('cam_status_${r.id}')?.value || 'Идэвхтэй')"
                  style="width:58px;text-align:center;border:1px solid ${brokenCount ? "#fed7aa" : "#d1fae5"};border-radius:8px;padding:4px 2px;font-weight:800;color:${brokenCount ? "#d97706" : "#16a34a"};background:${brokenCount ? "#fff7ed" : "#f0fdf4"}">
              </td>
              <td>
                <select id="cam_status_${r.id}"
                  onchange="updateCameraCounts(${r.id}, ${camCount}, document.getElementById('cam_broken_${r.id}')?.value || 0, this.value)"
                  style="border:1px solid ${rowStatus==="Идэвхтэй"?"#bbf7d0":"#e2e8f0"};border-radius:8px;padding:5px 8px;font-size:11px;font-weight:800;color:${rowStatus==="Идэвхтэй"?"#16a34a":"#475569"};background:${rowStatus==="Идэвхтэй"?"#dcfce7":"#f1f5f9"};outline:none">
                  <option ${rowStatus==="Идэвхтэй"?"selected":""}>Идэвхтэй</option>
                  <option ${rowStatus==="Идэвхгүй"?"selected":""}>Идэвхгүй</option>
                </select>
              </td>
              <td>${conditionSelect}</td>
              <td style="text-align:center;font-family:monospace;color:#667085">${r.file_count||0}</td>
              <td style="text-align:center;font-family:monospace;color:#667085">${r.work_count||0}</td>
              <td><div style="display:flex;gap:4px;justify-content:flex-end;flex-wrap:wrap">
                <button class="btn secondary" style="padding:3px 8px;font-size:10px" onclick="openPassport(${r.id})">📋</button>
                ${canCreate ? `<button class="btn secondary" style="padding:3px 8px;font-size:10px" onclick="openAssetForm(${r.id})">✏️</button>` : ""}
                ${canDel ? `<button class="btn danger" style="padding:3px 8px;font-size:10px" onclick="confirmDeleteAsset(${r.id})">🗑</button>` : ""}
                ${fl&&!fl.is_resolved
                  ? `<button class="btn secondary" style="padding:3px 8px;font-size:10px;color:#16a34a" onclick="resolveAssetFlag(${fl.id})">✓</button>`
                  : `<button class="btn secondary" style="padding:3px 8px;font-size:10px" onclick="openAssetFlagModal('assets',${r.id},'${escapeHtml((r.name||"").replace(/'/g,""))}')">🚩</button>`}
              </div></td>
            </tr>`;
          }).join("") : `<tr><td colspan="10" style="text-align:center;color:#667085;padding:30px">Камерын цэг бүртгэгдээгүй байна</td></tr>`}
        </tbody>
      </table>
    </div>
  </div>`}`;

  if (_cameraAssetTab === "report") loadCameraAnalytics();
  if (_cameraAssetTab === "repair") setTimeout(camRepairFilterTable, 0);
  if (_cameraAssetTab === "fiber") setTimeout(() => initFiberMap(rows), 0);
}

async function loadCameraAnalytics() {
  const box = document.getElementById("cameraAnalyticsBox");
  if (!box) return;
  const year = window._cameraAnalyticsYear || new Date().getFullYear();
  let data;
  try { data = await api(`/api/camera-analytics?year=${year}`); }
  catch(e) { box.innerHTML = `<div style="color:#dc2626;padding:12px">Алдаа: ${escapeHtml(e.message)}</div>`; return; }
  const fmt = n => Number(n || 0).toLocaleString("mn-MN");
  const pct = v => v == null ? "—" : `${Number(v).toFixed(1)}%`;
  const visibleMonths = data.months.filter(m => m.work_count || m.done_count || m.snapshot_date);
  const maxWork = Math.max(1, ...visibleMonths.map(m => m.work_count || 0));
  const monthRows = visibleMonths.length ? visibleMonths.map(m => `
    <tr>
      <td style="font-weight:800">${m.label}</td>
      <td style="text-align:center;color:#dc2626;font-weight:800">${fmt(m.work_count)}</td>
      <td style="text-align:center;color:#16a34a;font-weight:800">${fmt(m.done_count)}</td>
      <td style="text-align:center;color:${m.open_count ? "#d97706" : "#16a34a"};font-weight:800">${m.snapshot_date ? fmt(m.open_count) : "—"}</td>
      <td style="text-align:center;color:#2563eb;font-weight:800">${pct(m.availability_pct)}${m.snapshot_date ? `<div style="font-size:10px;color:#94a3b8">${m.snapshot_date}</div>` : ""}</td>
      <td>
        <div style="height:7px;background:#f1f5f9;border-radius:999px;overflow:hidden;min-width:120px">
          <div style="height:100%;width:${Math.min(100, (m.work_count || 0) / maxWork * 100)}%;background:#ef4444"></div>
        </div>
        <div style="font-size:10px;color:#94a3b8;margin-top:3px">${m.snapshot_date ? "snapshot" : "snapshot байхгүй"}</div>
      </td>
    </tr>`).join("") : `<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:28px">Энэ жилд камер засварын судалгаа алга</td></tr>`;
  const locRows = data.locations.length ? data.locations.map(r => `
    <tr>
      <td style="font-weight:700">${escapeHtml(r.location)}</td>
      <td style="text-align:center">${fmt(r.work_count)}</td>
      <td style="text-align:center;color:#16a34a;font-weight:800">${fmt(r.done_count)}</td>
      <td style="text-align:center;color:${r.open_count ? "#d97706" : "#16a34a"};font-weight:800">${fmt(r.open_count)}</td>
      <td style="text-align:center;font-weight:800;color:#7c3aed">${r.mttr_days == null ? "—" : `${r.mttr_days} өдөр`}</td>
    </tr>`).join("") : `<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:24px">Байршлын мэдээлэл алга</td></tr>`;

  box.innerHTML = `
    <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px">
      <div>
        <div style="font-size:16px;font-weight:800;color:#1e293b">📈 Камерын засвар ба ажиллагааны жилийн судалгаа</div>
        <div style="font-size:12px;color:#64748b;margin-top:3px">Gantt-ийн “Камер засвар” ажил болон өдөр тутмын snapshot дээр суурилсан харагдац</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <input id="cameraAnalyticsYear" class="input" type="number" min="2020" max="2100" value="${data.year}" style="width:100px;margin:0">
        <button class="btn" style="padding:8px 14px" onclick="cameraAnalyticsReload()">Харах</button>
        <button class="btn secondary" style="padding:8px 14px" onclick="window.print()">Хэвлэх</button>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px">
      ${[
        ["Камерын цэг", data.summary.points, "#2563eb", "#eff6ff"],
        ["Нийт камер", data.summary.capacity, "#0ea5e9", "#f0f9ff"],
        ["Гэмтэлтэй камер", data.summary.broken_cameras, "#d97706", "#fff7ed"],
        ["Жилд бүртгэсэн", data.summary.work_count, "#dc2626", "#fef2f2"],
        ["Жилд дууссан", data.summary.done_count, "#16a34a", "#f0fdf4"],
        ["Нээлттэй засвар", data.summary.open_count, "#d97706", "#fff7ed"],
        ["Хэвийн хувь", pct(data.summary.availability_pct), "#7c3aed", "#f5f3ff"],
      ].map(c => `<div style="background:${c[3]};border-radius:10px;padding:13px 16px">
        <div style="font-size:22px;font-weight:800;color:${c[2]};line-height:1.1">${typeof c[1] === "number" ? fmt(c[1]) : c[1]}</div>
        <div style="font-size:11px;color:#64748b;margin-top:5px;font-weight:700">${c[0]}</div>
      </div>`).join("")}
    </div>
    ${cameraAnalyticsChart(data)}
    <div style="display:grid;grid-template-columns:minmax(0,1.25fr) minmax(320px,.75fr);gap:14px">
      <div class="panel">
        <div style="padding:12px 16px;border-bottom:1px solid #e2e6ed;font-size:13px;font-weight:800">Сарын явц</div>
        <div class="table-wrap"><table>
          <thead><tr><th>Сар</th><th style="text-align:center">Бүртгэл</th><th style="text-align:center">Дууссан</th><th style="text-align:center">Нээлттэй</th><th style="text-align:center">Хэвийн</th><th>График</th></tr></thead>
          <tbody>${monthRows}</tbody>
        </table></div>
      </div>
      <div class="panel">
        <div style="padding:12px 16px;border-bottom:1px solid #e2e6ed;font-size:13px;font-weight:800">Байршил / MTTR</div>
        <div class="table-wrap"><table>
          <thead><tr><th>Байршил</th><th style="text-align:center">Ажил</th><th style="text-align:center">Дууссан</th><th style="text-align:center">Нээлттэй</th><th style="text-align:center">MTTR</th></tr></thead>
          <tbody>${locRows}</tbody>
        </table></div>
      </div>
    </div>`;
}

function cameraAnalyticsChart(data) {
  const mode = window._cameraAnalyticsMode || "year";
  const selectedMonth = window._cameraAnalyticsMonth || new Date().getMonth() + 1;
  const monthKey = `${data.year}-${String(selectedMonth).padStart(2, "0")}`;
  const sourceRows = mode === "month"
    ? (data?.daily || []).filter(d => String(d.day || "").startsWith(monthKey))
    : (data?.months || []);
  const visible = sourceRows
    .map(r => ({
      label: mode === "month" ? String(r.day || "").slice(8) : (r.label || r.ym),
      sub_label: mode === "month" ? String(r.day || "").slice(5) : (r.snapshot_date ? String(r.snapshot_date).slice(5) : ""),
      work_count: Number(r.work_count || 0),
      done_count: Number(r.done_count || 0),
      open_count: Number(r.open_count ?? r.open_work_count ?? 0),
      availability_pct: r.availability_pct == null ? null : Number(r.availability_pct),
      snapshot_date: r.snapshot_date || null
    }))
    .filter(m => m.snapshot_date || m.work_count || m.done_count || m.open_count);
  if (!visible.length) {
    return `<div class="panel" style="margin-bottom:14px;padding:34px;text-align:center;color:#94a3b8;font-size:13px">
      ${mode === "month" ? `${selectedMonth}-р сарын` : "Камерын"} график харуулах snapshot / засварын мэдээлэл алга
    </div>`;
  }

  const W = 900, H = 300, PL = 54, PR = 70, PT = 34, PB = 48;
  const cw = W - PL - PR;
  const ch = H - PT - PB;
  const maxWork = Math.max(1, ...visible.map(m => Math.max(Number(m.work_count || 0), Number(m.done_count || 0), Number(m.open_count || 0))));
  const pctVals = visible.map(m => Number(m.availability_pct)).filter(v => Number.isFinite(v));
  const rawMin = pctVals.length ? Math.min(...pctVals) : 95;
  const minY = Math.max(0, Math.floor((rawMin - 3) / 5) * 5);
  const maxY = 100;
  const yRange = Math.max(1, maxY - minY);
  const xOf = i => PL + (visible.length > 1 ? i / (visible.length - 1) * cw : cw / 2);
  const yOf = v => PT + ch - ((Math.max(minY, Math.min(maxY, Number(v))) - minY) / yRange) * ch;
  const barY = count => H - PB - (Number(count || 0) / maxWork) * 58;

  let grid = "";
  for (let v = minY; v <= maxY + 0.001; v += 5) {
    const y = yOf(v);
    grid += `<line x1="${PL}" y1="${y.toFixed(1)}" x2="${W-PR}" y2="${y.toFixed(1)}" stroke="#e2e6ed" stroke-width="1"/>`;
    grid += `<text x="${PL-8}" y="${(y+4).toFixed(1)}" text-anchor="end" font-size="11" fill="#94a3b8" font-weight="700">${v}%</text>`;
  }

  const xLabels = visible.map((m, i) => `
    <text x="${xOf(i).toFixed(1)}" y="${H-20}" text-anchor="middle" font-size="11" fill="#64748b" font-weight="800">${escapeHtml(m.label || m.ym)}</text>
    ${m.sub_label ? `<text x="${xOf(i).toFixed(1)}" y="${H-7}" text-anchor="middle" font-size="9" fill="#94a3b8">${escapeHtml(m.sub_label)}</text>` : ""}
  `).join("");

  const bars = visible.map((m, i) => {
    const x = xOf(i);
    const workH = H - PB - barY(m.work_count);
    const doneH = H - PB - barY(m.done_count);
    const openH = H - PB - barY(m.open_count);
    return `
      <rect x="${(x-18).toFixed(1)}" y="${barY(m.work_count).toFixed(1)}" width="8" height="${workH.toFixed(1)}" rx="3" fill="#ef4444" opacity="0.75"/>
      <rect x="${(x-6).toFixed(1)}" y="${barY(m.done_count).toFixed(1)}" width="8" height="${doneH.toFixed(1)}" rx="3" fill="#16a34a" opacity="0.75"/>
      <rect x="${(x+6).toFixed(1)}" y="${barY(m.open_count).toFixed(1)}" width="8" height="${openH.toFixed(1)}" rx="3" fill="#f59e0b" opacity="0.75"/>
    `;
  }).join("");

  const pts = visible
    .map((m, i) => m.availability_pct == null ? null : { x: xOf(i), y: yOf(m.availability_pct), v: Number(m.availability_pct) })
    .filter(Boolean);
  const line = pts.length >= 2
    ? `<path d="${pts.map((p,i)=>`${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}" fill="none" stroke="#7c3aed" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round"/>`
    : "";
  const points = pts.map((p, i) => {
    const label = i === pts.length - 1
      ? `<text x="${(p.x+10).toFixed(1)}" y="${(p.y+4).toFixed(1)}" text-anchor="start" font-size="11" font-weight="800" fill="#7c3aed" stroke="#fff" stroke-width="5" paint-order="stroke">${p.v.toFixed(1)}%</text>`
      : "";
    return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.8" fill="#7c3aed" stroke="#fff" stroke-width="2"/>${label}`;
  }).join("");

  const monthLabels = ["1-р сар","2-р сар","3-р сар","4-р сар","5-р сар","6-р сар","7-р сар","8-р сар","9-р сар","10-р сар","11-р сар","12-р сар"];
  const modeBtn = (key, label) => {
    const active = mode === key;
    return `<button onclick="cameraAnalyticsMode('${key}')" style="padding:4px 12px;border-radius:6px;border:1.5px solid ${active?"#2563eb":"#d1d5db"};background:${active?"#2563eb":"#fff"};color:${active?"#fff":"#64748b"};font-size:12px;font-weight:700;cursor:pointer">${label}</button>`;
  };
  return `
  <div class="panel" style="margin-bottom:14px">
    <div style="padding:12px 16px;border-bottom:1px solid #e2e6ed;display:flex;align-items:center;gap:16px;flex-wrap:wrap">
      <div style="font-size:13px;font-weight:800">Камерын хэвийн хувь ба засварын явц</div>
      <div style="display:flex;gap:4px">
        ${modeBtn("year", "Жилээр")}
        ${modeBtn("month", "Сараар")}
      </div>
      <div style="margin-left:auto;display:flex;gap:12px;flex-wrap:wrap;font-size:11px;color:#64748b;font-weight:700">
        <span><i style="display:inline-block;width:16px;height:3px;background:#7c3aed;border-radius:3px;vertical-align:middle"></i> Хэвийн хувь</span>
        <span><i style="display:inline-block;width:9px;height:9px;background:#ef4444;border-radius:2px;vertical-align:middle"></i> Бүртгэл</span>
        <span><i style="display:inline-block;width:9px;height:9px;background:#16a34a;border-radius:2px;vertical-align:middle"></i> Дууссан</span>
        <span><i style="display:inline-block;width:9px;height:9px;background:#f59e0b;border-radius:2px;vertical-align:middle"></i> Нээлттэй</span>
      </div>
    </div>
    ${mode === "month" ? `<div style="padding:8px 16px;border-bottom:1px solid #f1f5f9;display:flex;gap:4px;flex-wrap:wrap">
      ${monthLabels.map((label, i) => {
        const m = i + 1;
        const active = selectedMonth === m;
        return `<button onclick="cameraAnalyticsMonth(${m})" style="padding:3px 10px;border-radius:5px;border:1.5px solid ${active?"#2563eb":"#e2e6ed"};background:${active?"#eff6ff":"#f8fafc"};color:${active?"#2563eb":"#475569"};font-size:12px;font-weight:${active?"800":"600"};cursor:pointer">${label}</button>`;
      }).join("")}
    </div>` : ""}
    <div style="padding:14px 16px 12px">
      <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:6px;text-align:center">${mode === "month" ? `${monthLabels[selectedMonth - 1]} — өдөр тутмын камерын хэвийн хувь` : `${data.year} он — сарын камерын хэвийн хувь`} (${minY}% - ${maxY}%)</div>
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px;display:block;margin:auto;overflow:visible">
        <rect x="${PL}" y="${PT}" width="${cw}" height="${ch}" rx="12" fill="#fbfdff" stroke="#e8eef7" stroke-width="1.2"/>
        ${grid}${bars}${line}${points}${xLabels}
        <line x1="${PL}" y1="${PT}" x2="${PL}" y2="${H-PB}" stroke="#e2e6ed" stroke-width="1"/>
        <line x1="${PL}" y1="${H-PB}" x2="${W-PR}" y2="${H-PB}" stroke="#e2e6ed" stroke-width="1"/>
      </svg>
    </div>
  </div>`;
}

function cameraAnalyticsReload() {
  window._cameraAnalyticsYear = parseInt(document.getElementById("cameraAnalyticsYear")?.value) || new Date().getFullYear();
  loadCameraAnalytics();
}

function cameraAnalyticsMode(mode) {
  window._cameraAnalyticsMode = mode === "month" ? "month" : "year";
  if (!window._cameraAnalyticsMonth) window._cameraAnalyticsMonth = new Date().getMonth() + 1;
  loadCameraAnalytics();
}

function cameraAnalyticsMonth(month) {
  window._cameraAnalyticsMode = "month";
  window._cameraAnalyticsMonth = Math.max(1, Math.min(12, Number(month || 1)));
  loadCameraAnalytics();
}

// ── Улсын үзлэг, тооллого ────────────────────────────────────

const INV_STATUSES = [
  { key: "Хүлээгдэж буй",    label: "Хүлээгдэж буй",    color: "#94a3b8", bg: "#f1f5f9", icon: "⏳" },
  { key: "Тоологдсон",        label: "Тоологдсон",        color: "#16a34a", bg: "#dcfce7", icon: "✅" },
  { key: "Зөрүүтэй",          label: "Зөрүүтэй",          color: "#d97706", bg: "#fef3c7", icon: "⚠️" },
  { key: "Олдоогүй",          label: "Олдоогүй",          color: "#dc2626", bg: "#fee2e2", icon: "❌" },
  { key: "Актлах саналтай",   label: "Актлах саналтай",   color: "#7c3aed", bg: "#ede9fe", icon: "📋" },
  { key: "Шилжүүлэх",        label: "Шилжүүлэх",        color: "#0369a1", bg: "#e0f2fe", icon: "🔄" },
];

function invStatusMeta(key) {
  return INV_STATUSES.find(s => s.key === key) || INV_STATUSES[0];
}

async function asset_inventory() {
  const canWrite = ["director","chief_engineer","accountant"].includes(state.me.role);
  let sessions;
  try { sessions = await api("/api/inventory-sessions"); } catch(e) { sessions = []; }

  main.innerHTML = `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;flex-wrap:wrap;gap:12px">
    <div>
      <h1 style="margin:0 0 4px;font-size:22px;font-weight:800;letter-spacing:-.02em">📋 Улсын үзлэг, тооллого</h1>
      <div style="font-size:12px;color:#667085">Орон нутгийн өмчийн эд хөрөнгийн бүртгэл шалгалт · 2026-08-31 хүртэл</div>
    </div>
    ${canWrite ? `<button class="btn" onclick="openInvSessionForm()" style="white-space:nowrap">+ Шинэ тооллого үүсгэх</button>` : ""}
  </div>

  <div id="invSessionFormWrap" style="display:none;margin-bottom:18px">
    <div class="panel" style="padding:18px 22px;max-width:600px">
      <div style="font-size:14px;font-weight:700;margin-bottom:12px">Шинэ тооллогын сесс</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
        <div style="grid-column:1/-1">
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Гарчиг *</div>
          <input class="input" id="inv_title" placeholder="2026 оны улсын үзлэг, тооллого" value="2026 оны улсын үзлэг, тооллого">
        </div>
        <div>
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Жил *</div>
          <input class="input" type="number" id="inv_year" value="2026">
        </div>
        <div>
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Эхлэх огноо</div>
          <input class="input" type="date" id="inv_start" value="2026-05-21">
        </div>
        <div>
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Дуусах огноо</div>
          <input class="input" type="date" id="inv_end" value="2026-08-31">
        </div>
        <div style="grid-column:1/-1">
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Тэмдэглэл</div>
          <textarea class="input" id="inv_notes" style="min-height:48px;margin:0" placeholder="ТӨБЗГ 143 дугаар тогтоол, 2026-04-23..."></textarea>
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn" onclick="saveInvSession()">Үүсгэх</button>
        <button class="btn secondary" onclick="closeInvSessionForm()">Болих</button>
      </div>
    </div>
  </div>

  ${sessions.length === 0 ? `
  <div class="panel" style="padding:48px;text-align:center;color:#94a3b8">
    <div style="font-size:40px;margin-bottom:12px">📋</div>
    <div style="font-size:15px;font-weight:600;color:#344054;margin-bottom:6px">Тооллого бүртгэгдээгүй байна</div>
    <div style="font-size:13px">Шинэ тооллого үүсгэж эхлэнэ үү</div>
  </div>` : `
  <div style="display:flex;flex-direction:column;gap:12px">
    ${sessions.map(s => {
      const total   = s.total_items || 0;
      const counted = s.counted     || 0;
      const pct     = total > 0 ? Math.round(counted / total * 100) : 0;
      const pctColor = pct >= 90 ? "#16a34a" : pct >= 50 ? "#d97706" : "#dc2626";
      const statusBg = s.status === "Дууссан" ? "#dcfce7" : "#dbeafe";
      const statusColor = s.status === "Дууссан" ? "#16a34a" : "#2563eb";
      return `
      <div class="panel" style="padding:0;overflow:hidden">
        <div style="padding:16px 20px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:14px;flex-wrap:wrap">
          <div style="flex:1;min-width:0">
            <div style="font-size:16px;font-weight:800;color:#172033;margin-bottom:3px">${escapeHtml(s.title)}</div>
            <div style="font-size:12px;color:#667085">${s.year} он · ${s.start_date||"—"} → ${s.end_date||"2026-08-31"}</div>
          </div>
          <span style="font-size:11px;padding:4px 12px;border-radius:20px;background:${statusBg};color:${statusColor};font-weight:700">${s.status}</span>
          <div style="text-align:right">
            <div style="font-size:22px;font-weight:800;color:${pctColor}">${pct}%</div>
            <div style="font-size:11px;color:#94a3b8">гүйцэтгэл</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(6,1fr);border-bottom:1px solid #f1f5f9">
          ${[
            ["Нийт",s.total_items||0,"#64748b","#f8fafc"],
            ["Тоологдсон",s.counted||0,"#16a34a","#f0fdf4"],
            ["Зөрүүтэй",s.discrepancy||0,"#d97706","#fffbeb"],
            ["Олдоогүй",s.missing||0,"#dc2626","#fef2f2"],
            ["Актлах",s.write_off||0,"#7c3aed","#f5f3ff"],
            ["Шилжүүлэх",s.transfer||0,"#0369a1","#f0f9ff"],
          ].map(([lbl,val,col,bg])=>`
            <div style="padding:12px 8px;text-align:center;background:${bg};border-right:1px solid #f1f5f9">
              <div style="font-size:18px;font-weight:800;color:${col}">${val}</div>
              <div style="font-size:10px;color:#94a3b8">${lbl}</div>
            </div>`).join("")}
        </div>
        <div style="padding:12px 18px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn" style="font-size:12px;padding:6px 14px" onclick="openInvSession(${s.id})">📝 Тооллого хийх</button>
          <button class="btn secondary" style="font-size:12px;padding:6px 14px" onclick="openInvReport(${s.id})">📊 Тайлан харах</button>
          ${canWrite && s.status !== "Дууссан" ? `<button class="btn secondary" style="font-size:12px;padding:6px 14px;color:#16a34a;border-color:#16a34a" onclick="closeInvSession(${s.id})">✓ Дуусгах</button>` : ""}
        </div>
      </div>`;
    }).join("")}
  </div>`}`;
}

function openInvSessionForm() {
  document.getElementById("invSessionFormWrap").style.display = "block";
  document.getElementById("inv_title").focus();
}
function closeInvSessionForm() {
  document.getElementById("invSessionFormWrap").style.display = "none";
}

async function saveInvSession() {
  const g = id => (document.getElementById(id)||{}).value||"";
  const title = g("inv_title").trim();
  const year  = parseInt(g("inv_year"));
  if (!title) { toast("Гарчиг оруулна уу"); return; }
  if (!year)  { toast("Жил оруулна уу"); return; }
  try {
    await api("/api/inventory-sessions", { method:"POST", body:JSON.stringify({
      title, year, start_date: g("inv_start")||null, end_date: g("inv_end")||null, notes: g("inv_notes")
    })});
    toast("Тооллогын сесс үүслээ ✓");
    closeInvSessionForm();
    asset_inventory();
  } catch(e) { toast("Алдаа: " + e.message); }
}

async function closeInvSession(sid) {
  if (!confirm("Тооллогыг дуусгах уу? Дуусгасны дараа засах боломжгүй болно.")) return;
  try {
    await api(`/api/inventory-sessions/${sid}/close`, { method:"PATCH" });
    toast("Тооллого дуусгагдлаа ✓");
    asset_inventory();
  } catch(e) { toast("Алдаа: " + e.message); }
}

// ── Тооллогын ажлын дэлгэц ──────────────────────────────────

let _invSessionId = 0;
let _invItems = [];
let _invFilter = "";
let _invStatusFilter = "";

async function openInvSession(sid) {
  _invSessionId = sid;
  _invFilter = "";
  _invStatusFilter = "";

  main.innerHTML = `<div style="padding:40px;text-align:center;color:#667085">
    <div style="font-size:32px;margin-bottom:10px">⏳</div>Тооллогын мэдээлэл уншиж байна...
  </div>`;

  let data;
  try { data = await api(`/api/inventory-sessions/${sid}/items`); }
  catch(e) { toast("Алдаа: " + e.message); return; }

  _invItems = data.items || [];
  _renderInvSession(data.session);
}

function _renderInvSession(session) {
  const items   = _invItems;
  const total   = items.length;
  const counted = items.filter(i => i.inv_status === "Тоологдсон").length;
  const pending = items.filter(i => i.inv_status === "Хүлээгдэж буй").length;
  const pct     = total > 0 ? Math.round(counted / total * 100) : 0;
  const pctColor = pct >= 90 ? "#16a34a" : pct >= 50 ? "#d97706" : "#dc2626";

  const filtered = items.filter(i => {
    const matchText = !_invFilter ||
      (i.name||"").toLowerCase().includes(_invFilter) ||
      (i.asset_code||"").toLowerCase().includes(_invFilter) ||
      (i.account_code||"").toLowerCase().includes(_invFilter) ||
      (i.model||"").toLowerCase().includes(_invFilter);
    const matchStatus = !_invStatusFilter || i.inv_status === _invStatusFilter;
    return matchText && matchStatus;
  });

  main.innerHTML = `
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap">
    <button onclick="asset_inventory()" class="btn secondary" style="font-size:12px;padding:6px 12px">← Буцах</button>
    <div style="flex:1;min-width:0">
      <div style="font-size:18px;font-weight:800;color:#172033">${escapeHtml(session.title)}</div>
      <div style="font-size:12px;color:#667085">${session.year} он · ${session.start_date||"—"} → ${session.end_date||"2026-08-31"} · Нийт ${total} хөрөнгө</div>
    </div>
    <button onclick="openInvReport(${session.id})" class="btn secondary" style="font-size:12px;padding:6px 12px">📊 Тайлан</button>
  </div>

  <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:14px">
    ${[
      ["Нийт",total,"#64748b","#f8fafc",""],
      ["Тоологдсон",counted,"#16a34a","#f0fdf4","Тоологдсон"],
      ["Зөрүүтэй",items.filter(i=>i.inv_status==="Зөрүүтэй").length,"#d97706","#fffbeb","Зөрүүтэй"],
      ["Олдоогүй",items.filter(i=>i.inv_status==="Олдоогүй").length,"#dc2626","#fef2f2","Олдоогүй"],
      ["Актлах",items.filter(i=>i.inv_status==="Актлах саналтай").length,"#7c3aed","#f5f3ff","Актлах саналтай"],
      ["Хүлээгдэж буй",pending,"#94a3b8","#f1f5f9","Хүлээгдэж буй"],
    ].map(([lbl,val,col,bg,sf])=>`
      <div onclick="invSetStatusFilter('${sf}')"
        style="background:${bg};border:2px solid ${_invStatusFilter===sf&&sf?col:'transparent'};border-radius:10px;padding:10px 8px;text-align:center;cursor:pointer;transition:border .15s">
        <div style="font-size:20px;font-weight:800;color:${col}">${val}</div>
        <div style="font-size:10px;color:#94a3b8">${lbl}</div>
      </div>`).join("")}
  </div>

  <div style="height:6px;background:#f1f5f9;border-radius:3px;margin-bottom:16px;overflow:hidden">
    <div style="height:100%;width:${pct}%;background:${pctColor};border-radius:3px;transition:width .6s"></div>
  </div>

  <div class="panel" style="padding:0;overflow:hidden">
    <div style="padding:12px 16px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <input placeholder="Нэр, код, загвараар хайх..." oninput="invSetFilter(this.value)"
        style="flex:1;min-width:180px;padding:7px 12px;border:1px solid #e2e6ed;border-radius:8px;font-size:12px;outline:none">
      ${INV_STATUSES.map(s=>`
        <button onclick="invSetStatusFilter('${s.key}')"
          style="padding:5px 12px;font-size:11px;border-radius:20px;border:1.5px solid ${_invStatusFilter===s.key?s.color:'#e2e6ed'};background:${_invStatusFilter===s.key?s.bg:'#fff'};color:${_invStatusFilter===s.key?s.color:'#667085'};cursor:pointer;white-space:nowrap">
          ${s.icon} ${s.label}
        </button>`).join("")}
    </div>
    <div class="table-wrap">
      <table id="invTable">
        <thead><tr>
          <th style="width:36px">#</th>
          <th>Данс</th>
          <th>Код</th>
          <th>Хөрөнгийн нэр</th>
          <th>Загвар</th>
          <th style="text-align:center">Тоо</th>
          <th>Огноо</th>
          <th style="text-align:right">Дансны үнэ ₮</th>
          <th style="min-width:190px">Тооллогын статус</th>
          <th>Тэмдэглэл</th>
        </tr></thead>
        <tbody>
          ${filtered.length ? filtered.map((r,i) => {
            const sm = invStatusMeta(r.inv_status);
            const isDone = r.inv_status !== "Хүлээгдэж буй";
            return `<tr style="${isDone?`background:${sm.bg}`:""}" data-id="${r.id}">
              <td style="color:#94a3b8;font-size:11px">${i+1}</td>
              <td><span style="font-family:monospace;font-size:11px;background:#eff6ff;color:#1d4ed8;padding:2px 6px;border-radius:4px">${escapeHtml(r.account_code||"—")}</span></td>
              <td><span style="font-family:monospace;font-size:11px;background:#f1f5f9;padding:2px 6px;border-radius:4px">${escapeHtml(r.asset_code||"—")}</span></td>
              <td style="font-weight:600;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(r.name)}">${escapeHtml(r.name||"—")}</td>
              <td style="font-size:11px;color:#667085;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(r.model||"—")}</td>
              <td style="text-align:center;font-size:12px">${r.initial_qty||1} ${escapeHtml(r.unit||"ш")}</td>
              <td style="font-size:11px;color:#667085">${r.acquisition_date||"—"}</td>
              <td style="text-align:right;font-size:12px;font-weight:600;color:#1d4ed8">${(r.book_value||0).toLocaleString()}</td>
              <td>
                <select onchange="invUpdateStatus(${r.id},this.value,${_invSessionId})"
                  style="padding:5px 8px;border-radius:8px;border:2px solid ${sm.color};background:${sm.bg};color:${sm.color};font-size:12px;font-weight:700;cursor:pointer;outline:none;width:100%">
                  ${INV_STATUSES.map(s=>`<option value="${s.key}" ${r.inv_status===s.key?"selected":""}>${s.icon} ${s.label}</option>`).join("")}
                </select>
                ${r.checked_name ? `<div style="font-size:10px;color:#94a3b8;margin-top:3px">✓ ${escapeHtml(r.checked_name)} · ${(r.checked_at||"").slice(0,10)}</div>` : ""}
              </td>
              <td>
                <input value="${escapeHtml(r.note||"")}" placeholder="Тэмдэглэл..."
                  onblur="invUpdateNote(${r.id},this.value,${_invSessionId})"
                  onkeydown="if(event.key==='Enter')this.blur()"
                  style="padding:5px 8px;border:1px solid #e2e6ed;border-radius:8px;font-size:11px;width:130px;outline:none">
              </td>
            </tr>`;
          }).join("") : `<tr><td colspan="10" style="text-align:center;color:#94a3b8;padding:30px">
            ${_invFilter || _invStatusFilter ? "Хайлтад тохирох хөрөнгө олдсонгүй" : "Тооллогод оруулах хөрөнгө байхгүй байна"}
          </td></tr>`}
        </tbody>
      </table>
    </div>
  </div>`;
}

function invSetFilter(val) {
  _invFilter = val.toLowerCase();
  _reRenderInvTable();
}

function invSetStatusFilter(sf) {
  _invStatusFilter = (_invStatusFilter === sf && sf) ? "" : sf;
  openInvSession(_invSessionId);
}

function _reRenderInvTable() {
  const filtered = _invItems.filter(i => {
    const matchText = !_invFilter ||
      (i.name||"").toLowerCase().includes(_invFilter) ||
      (i.asset_code||"").toLowerCase().includes(_invFilter) ||
      (i.account_code||"").toLowerCase().includes(_invFilter) ||
      (i.model||"").toLowerCase().includes(_invFilter);
    const matchStatus = !_invStatusFilter || i.inv_status === _invStatusFilter;
    return matchText && matchStatus;
  });
  const tbody = document.querySelector("#invTable tbody");
  if (!tbody) return;
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;color:#94a3b8;padding:30px">Хайлтад тохирох хөрөнгө олдсонгүй</td></tr>`;
    return;
  }
  tbody.querySelectorAll("tr").forEach(tr => {
    tr.style.display = filtered.find(f => f.id === parseInt(tr.dataset.id || "0")) ? "" : "none";
  });
}

async function invUpdateStatus(assetId, status, sid) {
  const item = _invItems.find(i => i.id === assetId);
  const note = item?.note || "";
  try {
    await api(`/api/inventory-sessions/${sid}/items/${assetId}`, {
      method:"PUT", body:JSON.stringify({ inv_status: status, note })
    });
    if (item) item.inv_status = status;
    toast(`${invStatusMeta(status).icon} ${status}`);
  } catch(e) { toast("Алдаа: " + e.message); }
}

async function invUpdateNote(assetId, note, sid) {
  const item = _invItems.find(i => i.id === assetId);
  const status = item?.inv_status || "Хүлээгдэж буй";
  try {
    await api(`/api/inventory-sessions/${sid}/items/${assetId}`, {
      method:"PUT", body:JSON.stringify({ inv_status: status, note })
    });
    if (item) item.note = note;
  } catch(e) {}
}

// ── Тооллогын тайлан ────────────────────────────────────────

async function openInvReport(sid) {
  main.innerHTML = `<div style="padding:40px;text-align:center;color:#667085">
    <div style="font-size:32px;margin-bottom:10px">⏳</div>Тайлан бэлтгэж байна...
  </div>`;

  let data;
  try { data = await api(`/api/inventory-sessions/${sid}/report`); }
  catch(e) { toast("Алдаа: " + e.message); return; }

  const { session, summary, byAccount } = data;
  const total = byAccount.reduce((s,r) => s + r.total, 0);
  const totalCounted = byAccount.reduce((s,r) => s + r.counted, 0);
  const totalBook = byAccount.reduce((s,r) => s + (r.total_book||0), 0);
  const totalInitial = byAccount.reduce((s,r) => s + (r.total_initial||0), 0);
  const pct = total > 0 ? Math.round(totalCounted / total * 100) : 0;
  const pctColor = pct >= 90 ? "#16a34a" : pct >= 50 ? "#d97706" : "#dc2626";

  const summaryMap = {};
  summary.forEach(s => summaryMap[s.inv_status] = s);

  main.innerHTML = `
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;flex-wrap:wrap">
    <button onclick="openInvSession(${sid})" class="btn secondary" style="font-size:12px;padding:6px 12px">← Тооллого руу буцах</button>
    <button onclick="asset_inventory()" class="btn secondary" style="font-size:12px;padding:6px 12px">🏠 Жагсаалт</button>
    <div style="flex:1"></div>
    <button onclick="invPrintReport()" class="btn" style="font-size:12px;padding:6px 14px">🖨 Хэвлэх</button>
  </div>

  <div id="invReportPrint">
    <div style="text-align:center;margin-bottom:20px">
      <div style="font-size:11px;color:#667085;letter-spacing:.12em;text-transform:uppercase">ЧОЙБАЛСАН ХӨГЖИЛ ОНӨҮГ</div>
      <div style="font-size:20px;font-weight:800;margin:6px 0">УЛСЫН ҮЗЛЭГ, ТООЛЛОГЫН ТАЙЛАН</div>
      <div style="font-size:13px;color:#667085">${escapeHtml(session.title)} · ${session.year} он</div>
      <div style="font-size:12px;color:#94a3b8">${session.start_date||""} — ${session.end_date||"2026-08-31"}</div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:20px">
      <div style="background:#eff6ff;border-radius:10px;padding:14px;text-align:center">
        <div style="font-size:10px;color:#2563eb;font-weight:600;letter-spacing:.08em;margin-bottom:4px">НИЙТ ХӨРӨНГӨ</div>
        <div style="font-size:28px;font-weight:800;color:#1d4ed8">${total}</div>
      </div>
      <div style="background:#f0fdf4;border-radius:10px;padding:14px;text-align:center">
        <div style="font-size:10px;color:#16a34a;font-weight:600;letter-spacing:.08em;margin-bottom:4px">ТООЛОГДСОН</div>
        <div style="font-size:28px;font-weight:800;color:#15803d">${totalCounted}</div>
        <div style="font-size:13px;font-weight:700;color:${pctColor}">${pct}%</div>
      </div>
      <div style="background:#fef2f2;border-radius:10px;padding:14px;text-align:center">
        <div style="font-size:10px;color:#dc2626;font-weight:600;letter-spacing:.08em;margin-bottom:4px">ОЛДООГҮЙ</div>
        <div style="font-size:28px;font-weight:800;color:#b91c1c">${(summaryMap["Олдоогүй"]||{cnt:0}).cnt}</div>
      </div>
      <div style="background:#f8fafc;border-radius:10px;padding:14px;text-align:center">
        <div style="font-size:10px;color:#64748b;font-weight:600;letter-spacing:.08em;margin-bottom:4px">ДАНСНЫ ҮНЭ НИЙТ</div>
        <div style="font-size:13px;font-weight:800;color:#334155">${totalBook.toLocaleString()}₮</div>
        <div style="font-size:10px;color:#94a3b8">Анхны: ${totalInitial.toLocaleString()}₮</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin-bottom:20px">
      ${INV_STATUSES.slice(1).map(s => {
        const sd = summaryMap[s.key] || { cnt:0, total_price:0 };
        return `<div style="background:${s.bg};border:1px solid ${s.color}33;border-radius:10px;padding:12px;display:flex;align-items:center;gap:10px">
          <div style="font-size:24px">${s.icon}</div>
          <div>
            <div style="font-size:11px;color:${s.color};font-weight:700">${s.label}</div>
            <div style="font-size:20px;font-weight:800;color:${s.color}">${sd.cnt}</div>
            ${sd.total_price ? `<div style="font-size:10px;color:#94a3b8">${sd.total_price.toLocaleString()}₮</div>` : ""}
          </div>
        </div>`;
      }).join("")}
    </div>

    <div class="panel" style="padding:0;overflow:hidden;margin-bottom:16px">
      <div style="padding:12px 16px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:700;color:#344054">Дансны дугаараар</div>
      <table>
        <thead><tr>
          <th>Данс</th>
          <th style="text-align:center">Нийт</th>
          <th style="text-align:center;color:#16a34a">Тоологдсон</th>
          <th style="text-align:center;color:#d97706">Зөрүүтэй</th>
          <th style="text-align:center;color:#dc2626">Олдоогүй</th>
          <th style="text-align:center;color:#7c3aed">Актлах</th>
          <th style="text-align:center;color:#94a3b8">Хүлээгдэж буй</th>
          <th style="text-align:right">Анхны үнэ ₮</th>
          <th style="text-align:right">Дансны үнэ ₮</th>
          <th style="text-align:center">Гүйцэтгэл</th>
        </tr></thead>
        <tbody>
          ${byAccount.map(r => {
            const p = r.total > 0 ? Math.round(r.counted / r.total * 100) : 0;
            const pc = p >= 90 ? "#16a34a" : p >= 50 ? "#d97706" : "#dc2626";
            return `<tr>
              <td><span style="font-family:monospace;font-size:12px;font-weight:700;color:#1d4ed8">${escapeHtml(r.account_code||"—")}</span></td>
              <td style="text-align:center;font-weight:700">${r.total}</td>
              <td style="text-align:center;color:#16a34a;font-weight:700">${r.counted}</td>
              <td style="text-align:center;color:#d97706;font-weight:700">${r.discrepancy}</td>
              <td style="text-align:center;color:#dc2626;font-weight:700">${r.missing}</td>
              <td style="text-align:center;color:#7c3aed;font-weight:700">${r.write_off}</td>
              <td style="text-align:center;color:#94a3b8">${r.pending}</td>
              <td style="text-align:right;font-size:12px;color:#64748b">${(r.total_initial||0).toLocaleString()}</td>
              <td style="text-align:right;font-size:12px;font-weight:600;color:#1d4ed8">${(r.total_book||0).toLocaleString()}</td>
              <td style="text-align:center">
                <span style="font-size:12px;font-weight:800;color:${pc}">${p}%</span>
              </td>
            </tr>`;
          }).join("")}
          <tr style="background:#f8fafc;font-weight:800">
            <td>Нийт дүн</td>
            <td style="text-align:center">${total}</td>
            <td style="text-align:center;color:#16a34a">${totalCounted}</td>
            <td style="text-align:center;color:#d97706">${byAccount.reduce((s,r)=>s+r.discrepancy,0)}</td>
            <td style="text-align:center;color:#dc2626">${byAccount.reduce((s,r)=>s+r.missing,0)}</td>
            <td style="text-align:center;color:#7c3aed">${byAccount.reduce((s,r)=>s+r.write_off,0)}</td>
            <td style="text-align:center;color:#94a3b8">${byAccount.reduce((s,r)=>s+r.pending,0)}</td>
            <td style="text-align:right">${totalInitial.toLocaleString()}</td>
            <td style="text-align:right;color:#1d4ed8">${totalBook.toLocaleString()}</td>
            <td style="text-align:center;color:${pctColor}">${pct}%</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div style="font-size:11px;color:#94a3b8;text-align:right">
      Тайлан үүссэн: ${new Date().toLocaleString("mn-MN")}
    </div>
  </div>`;
}

function invPrintReport() {
  const content = document.getElementById("invReportPrint");
  if (!content) return;
  const w = window.open("", "_blank");
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Тооллогын тайлан</title>
    <style>
      body{font-family:sans-serif;padding:24px;color:#1a1a1a}
      table{width:100%;border-collapse:collapse;font-size:12px}
      th,td{padding:7px 10px;border:1px solid #e2e6ed;text-align:left}
      th{background:#f8fafc;font-weight:700}
      @media print{button{display:none}}
    </style>
  </head><body>${content.innerHTML}</body></html>`);
  w.document.close();
  w.print();
}

Object.assign(window, {
  assets, filterAssets,
  slAssets, slHubAsset, sl_asset_road, sl_asset_ger, sl_asset_tower, sl_asset_signal, sl_asset_panel,
  camera_assets, cameraAssetTab, cameraAssetSearch, cameraAssetBagFilter, cameraConditionFilter, camRepairFilterTable, updateCameraCounts, updateCameraBag, updateCameraCondition, cameraAnalyticsReload,
  cameraAnalyticsMode, cameraAnalyticsMonth,
  startFiberDraw, cancelFiberDraw, saveFiberDraw, deleteFiberRoute, startFiberPointAdd, cancelFiberPointAdd, deleteFiberPoint,
  openFiberSpliceModal, closeFiberSpliceModal, fiberSpliceAddRow, fiberSpliceAutoFill, saveFiberSplice,
  setFiberGpsTarget, toggleFiberCameraMoveMode,
  toggleFiberCameraLayer, pickFiberCameraGps,
  openAssetFlagModal, closeAssetFlagModal, saveAssetFlag, resolveAssetFlag,
  openTrafficSignalJournal, openTrafficSignalCheck, closeTrafficSignalModal,
  saveTrafficSignalLog, checkTrafficSignalAt,
  deleteGerRow, deleteSlPointRow,
  openAssetForm, closeAssetForm, saveAsset, importPanelsFromMeters,
  openGerForm, closeGerForm, saveGerForm,
  openSlForm, closeSlForm, saveSlForm,
  openPassport, closePassport, switchPassportTab, loadAssetSafetyRisks,
  loadPanelMeters, linkMeterToPanel, unlinkMeterFromPanel,
  confirmDeleteAsset, uploadAssetFiles, deleteAssetFile,
  openLightbox, closeLightbox, lightboxNav, slFaultQuickSave,
  openSlDetail, closeSlDetail, uploadSlPhoto, deleteSlPhoto,
  uploadSlDoc, deleteSlDoc, openSlDocReader, closeSlDocReader, slDocPage,
  saveSlMeterLink, saveSlGps, slKmzImport, slSelectKmzPoint,
  openGerDetail, gerFaultQuickSave,
  saveGerGps, saveGerMeterLink, gerKmzImport, gerSelectKmzPoint,
  uploadGerPhoto, deleteGerPhoto, uploadGerDoc, deleteGerDoc,
  asset_inventory, openInvSessionForm, closeInvSessionForm, saveInvSession, closeInvSession,
  openInvSession, invSetFilter, invSetStatusFilter, invUpdateStatus, invUpdateNote,
  openInvReport, invPrintReport,
});
