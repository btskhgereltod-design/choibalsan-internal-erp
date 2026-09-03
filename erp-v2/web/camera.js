"use strict";

state.cameraWorkspace = null;
state.cameraLoading = false;
state.cameraTab = "overview";
state.cameraGroupFilter = "all";
state.cameraOperationalFilter = "all";
state.cameraSearch = "";
state.cameraFaultDrafts = {};
state.cameraFaultExpanded = false;
state.cameraFaultSaving = false;
state.cameraFaultBatchKey = null;
state.cameraFaultBatchReportedAt = null;

async function loadCamera(force = false) {
  if (state.cameraLoading || (state.cameraWorkspace && !force)) return;
  state.cameraLoading = true;
  render();
  try {
    state.cameraWorkspace = await api("/api/camera/workspace");
  } catch (error) {
    state.cameraWorkspace = { error: error.message || "Камерын мэдээллийг ачаалж чадсангүй." };
  } finally {
    state.cameraLoading = false;
    render();
  }
}

function cameraTabs() {
  const tabs = [
    ["overview", "Нүүр"],
    ["assets", "Камерын объектын бүртгэл"],
    ["network", "Шилэн кабель"],
    ["incidents", "Гэмтэл"],
    ["work", "Камерын ажлууд"],
    ["reports", "Тайлан"],
  ];
  return `<div class="lighting-tabs">${tabs.map(([key, name]) =>
    `<button class="${state.cameraTab === key ? "active" : ""}" data-camera-tab="${key}">${name}</button>`
  ).join("")}</div>`;
}

function cameraTable(headers, rows, colspan) {
  return `<div class="table-panel"><table class="data-table"><thead><tr>${headers.map((item) => `<th>${item}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.join("") : `<tr><td colspan="${colspan}">${empty("Одоогоор бүртгэл алга.")}</td></tr>`}</tbody></table></div>`;
}

function cameraGroupOf(item) {
  return String(item.source_group_code || "").trim();
}

function cameraGroupLabel(code) {
  if (String(code) === "98") return "Авто зам";
  if (String(code) === "99") return "Аж ахуйн нэгж";
  if (!String(code)) return "Ангилал тодорхойгүй";
  return `${Number(code) || code}-р баг`;
}

function cameraSourceDecision(item) {
  const condition = String(item.source_condition || "").trim();
  return /татан буулгах|нүүлгэх/i.test(condition) ? condition : "";
}

function cameraOperationalStateOf(item) {
  if (cameraSourceDecision(item)) return "decision";
  if (Number(item.open_incident_count || 0) > 0 || Number(item.affected_camera_count || 0) > 0) return "attention";
  return "normal";
}

function cameraSearchMatches(item) {
  const query = String(state.cameraSearch || "").trim().toLocaleLowerCase("mn");
  if (!query) return true;
  return [item.code, item.name, item.location, cameraGroupLabel(cameraGroupOf(item))]
    .filter(Boolean).join(" ").toLocaleLowerCase("mn").includes(query);
}

function cameraAssetMatches(item, {group = true, operational = true, search = true} = {}) {
  return (!group || state.cameraGroupFilter === "all" ||
      (state.cameraGroupFilter === "unclassified" && !cameraGroupOf(item)) ||
      cameraGroupOf(item) === state.cameraGroupFilter) &&
    (!operational || state.cameraOperationalFilter === "all" ||
      cameraOperationalStateOf(item) === state.cameraOperationalFilter) &&
    (!search || cameraSearchMatches(item));
}

function cameraScoped(data) {
  const assets = (data.assets || []).filter((item) => cameraAssetMatches(item));
  const visibleObjectIds = new Set(assets.map((item) => item.id));
  return {
    ...data,
    all: data,
    assets,
    incidents: (data.incidents || []).filter((item) => visibleObjectIds.has(item.operational_object_id)),
    workOrders: (data.workOrders || []).filter((item) => visibleObjectIds.has(item.operational_object_id)),
  };
}

function cameraScopeNavigation(data) {
  const locationAssets = data.assets || [];
  const groupCounts = new Map();
  locationAssets.filter(cameraSearchMatches).forEach((item) => {
    const key = cameraGroupOf(item) || "unclassified";
    groupCounts.set(key, (groupCounts.get(key) || 0) + 1);
  });
  const groups = [...groupCounts.keys()].sort((a, b) => {
    if (a === "unclassified") return 1;
    if (b === "unclassified") return -1;
    return Number(a) - Number(b) || String(a).localeCompare(String(b), "mn");
  });
  const groupedAssets = locationAssets.filter((item) =>
    (state.cameraGroupFilter === "all" ||
      (state.cameraGroupFilter === "unclassified" && !cameraGroupOf(item)) ||
      cameraGroupOf(item) === state.cameraGroupFilter) && cameraSearchMatches(item));
  const operationalOptions = [
    ["all", "Бүх байдал"],
    ["attention", "Засвар шаардлагатай"],
    ["normal", "Хэвийн"],
    ["decision", "Шийдвэр хүлээж буй"],
  ];
  const operationalCounts = new Map(operationalOptions.map(([key]) => [key,
    key === "all" ? groupedAssets.length : groupedAssets.filter((item) => cameraOperationalStateOf(item) === key).length]));
  const groupLabel = (key) => key === "unclassified" ? "Ангилал тодорхойгүй" : cameraGroupLabel(key);
  return `<section class="camera-scope-panel"><div class="camera-scope-head"><div><span class="eyebrow">БАЙРШИЛ БА АЖИЛЛАГАА</span><h2>Объектуудаа яаж задлах вэ?</h2></div><label class="camera-search"><span>Хайлт</span><input type="search" value="${esc(state.cameraSearch)}" placeholder="Код, нэр, байршил хайх..." data-camera-search></label></div><div class="camera-filter-row"><strong>Баг / үйлчилгээний бүс</strong><div class="camera-filter-chips"><button class="${state.cameraGroupFilter === "all" ? "active" : ""}" data-camera-group="all">Бүгд <b>${locationAssets.filter(cameraSearchMatches).length}</b></button>${groups.map((key) => `<button class="${state.cameraGroupFilter === key ? "active" : ""}" data-camera-group="${esc(key)}">${esc(groupLabel(key))} <b>${groupCounts.get(key)}</b></button>`).join("")}</div></div><div class="camera-filter-row"><strong>Ашиглалтын байдал</strong><div class="camera-filter-chips operational">${operationalOptions.map(([key, label]) => `<button class="${state.cameraOperationalFilter === key ? "active" : ""} ${key}" data-camera-operational="${key}">${label} <b>${operationalCounts.get(key)}</b></button>`).join("")}</div></div><small class="camera-scope-note">Баг / бүс нь объектын байршлын бүлэг. Баг нь нотлогдоогүй объект энэ хэсэгт “Ангилал тодорхойгүй” гэж үлдэнэ. “Засвар шаардлагатай” нь нээлттэй canonical гэмтлээс тооцогдоно. “Татан буулгах / нүүлгэх” эх тэмдэглэгээг master lifecycle-д шууд бичилгүй “Шийдвэр хүлээж буй” гэж тусгаарлав.</small></section>`;
}

function cameraAssets(data) {
  const totals = data.assets.reduce((sum, item) => ({
    points: sum.points + Number(item.camera_point_count || 0),
    cameras: sum.cameras + Number(item.camera_count || 0),
    gps: sum.gps + Number(item.gps_point_count || 0),
  }), {points: 0, cameras: 0, gps: 0});
  const rows = data.assets.map((item) => {
    const operational = cameraOperationalStateOf(item), decision = cameraSourceDecision(item);
    const operationalLabel = operational === "decision" ? decision : operational === "attention" ? "Засвар шаардлагатай" : "Хэвийн";
    const operationalDetail = operational === "attention" ? `${Number(item.affected_camera_count || 0)} камер · ${Number(item.open_incident_count || 0)} гэмтлийн мөр` : operational === "decision" ? "Эх өгөгдлийн шийдвэр" : "Нээлттэй гэмтэлгүй";
    return `<tr><td><button class="object-dossier-link" data-camera-dossier="${item.id}">${esc(item.name)}</button><small>${esc(item.code || "—")} · Объектын master бүртгэл</small></td><td>${esc(cameraGroupLabel(cameraGroupOf(item)))}</td><td>${esc(item.location || "—")}</td><td>${Number(item.camera_point_count || 0)}</td><td>${Number(item.camera_count || 0)}</td><td><span class="camera-operational-state ${operational}">${esc(operationalLabel)}</span><small>${esc(operationalDetail)}</small></td><td>${Number(item.gps_point_count || 0)}</td><td><span class="classification-state ${esc(item.classification_state)}">${item.classification_state === "canonical" ? `Canonical v${Number(item.specification_version)}` : "Эх өгөгдөл"}</span></td><td><button class="secondary dossier-open-action" data-camera-dossier="${item.id}">Нээх / засах</button></td></tr>`;
  });
  return `<div class="lighting-section-stack"><section><div class="lighting-section-title"><h2>Камерын объектын бүртгэл</h2><span>Объект → шон/цэг → камерын төхөөрөмж ба үзүүлэлт → GPS гэсэн холбоос бүхий ашиглалтын master data</span></div><div class="lighting-object-summary"><span><b>${data.assets.length}</b> объект</span><span><b>${totals.points}</b> шон / цэг</span><span><b>${totals.cameras}</b> камер</span><span><b>${totals.gps}</b> GPS цэг</span></div>${cameraTable(["Код / камерын объект", "Баг / бүс", "Байршил", "Шон / цэг", "Камер", "Ажиллагаа", "GPS", "Master төлөв", "Үйлдэл"], rows, 9)}</section></div>`;
}

function cameraIncidents(data) {
  const types=data.incidentTypes||[],canReport=Boolean(data.capabilities?.canReportIncidents),
    typeByCode=new Map(types.map(type=>[type.code,type])),openByObjectUnit=new Map();
  const incidentUnit=incident=>String(incident.detail?.quantityUnit||typeByCode.get(incident.incident_type)?.quantity_unit||"камер");
  for(const incident of data.incidents){
    if(!incident.operational_object_id||!["open","in_progress"].includes(incident.status))continue;
    const key=`${incident.operational_object_id}:${incidentUnit(incident)}`;
    openByObjectUnit.set(key,(openByObjectUnit.get(key)||0)+Math.max(0,
      Number(incident.affected_quantity||0)-Number(incident.resolved_quantity||0)));
  }
  const rows=data.assets.map(object=>{
    const draft=state.cameraFaultDrafts[object.id]||{},selected=draft.incidentType||types[0]?.code||"",
      selectedType=typeByCode.get(selected)||types[0]||{},unit=selectedType.quantity_unit||"тохиолдол",
      cameraCount=Number(object.camera_count||0),open=openByObjectUnit.get(`${object.id}:${unit}`)||0,
      newQuantity=Math.max(0,Number(draft.affectedQuantity)||0),projected=open+newQuantity,
      basis=unit==="камер"?cameraCount:null,
      availability=basis!==null&&basis>0?Math.max(0,Math.round(((basis-projected)/basis)*100)):null,
      availabilityText=basis===null?"Тоо хязгаарлахгүй":basis===0?"Нийт камер 0":`${availability}% хэвийн`,
      availabilityClass=availability===null?"unknown":availability>=90?"good":availability>=70?"warning":"bad",
      remaining=basis===null?1000000:Math.max(0,basis-open),
      typeOptions=types.map(type=>`<option value="${esc(type.code)}" ${type.code===selected?"selected":""}>${esc(type.name)} · ${esc(type.quantity_unit)}</option>`).join("");
    return `<tr data-camera-fault-row="${object.id}"><td class="fault-object-cell"><button type="button" class="object-dossier-link" data-camera-dossier="${object.id}">${esc(object.name)}</button><small>${esc(object.code||"—")} · ${esc(cameraGroupLabel(cameraGroupOf(object)))}</small></td><td class="numeric"><b>${Number(object.camera_point_count||0)}</b></td><td class="numeric"><b>${cameraCount}</b></td><td class="numeric"><b>${Number(object.gps_point_count||0)}</b></td><td class="quick-fault-cell"><select class="fault-type-select" aria-label="Камерын гэмтлийн төрөл" data-camera-fault-field="incidentType" data-object-id="${object.id}" ${canReport?"":"disabled"}>${typeOptions}</select><div class="fault-count-line"><span>Одоо <b class="fault-open-value">${open}</b> ${esc(unit)}</span><span>Шинээр нэмэх</span></div><div class="fault-stepper"><button type="button" data-camera-fault-step="-1" data-object-id="${object.id}" ${canReport?"":"disabled"}>−</button><input class="fault-quantity-input" type="number" min="0" max="${remaining}" step="1" inputmode="numeric" value="${esc(draft.affectedQuantity??"")}" placeholder="0" data-camera-fault-field="affectedQuantity" data-object-id="${object.id}" ${canReport?"":"disabled"}><button type="button" data-camera-fault-step="1" data-object-id="${object.id}" ${canReport&&remaining>0?"":"disabled"}>+</button><span class="fault-availability ${availabilityClass}">${availabilityText}</span></div></td>${state.cameraFaultExpanded?`<td><input class="fault-note-input" value="${esc(draft.note||"")}" maxlength="2000" placeholder="Шаардлагатай бол тайлбар бичнэ" data-camera-fault-field="note" data-object-id="${object.id}" ${canReport?"":"disabled"}></td>`:""}<td><button type="button" class="icon-button fault-clear" data-clear-camera-fault="${object.id}" title="Хадгалаагүй мөрийг цэвэрлэх" ${draft.affectedQuantity||draft.note?"":"disabled"}>×</button></td></tr>`;
  }).join("");
  const visibleObjectIds=new Set(data.assets.map(object=>object.id)),draftCount=Object.entries(state.cameraFaultDrafts)
    .filter(([id,item])=>visibleObjectIds.has(id)&&Number(item.affectedQuantity)>0).length,
    typeNames=new Map(types.map(type=>[type.code,type.name]));
  const history=data.incidents.length?`<details class="lighting-incident-history"><summary>Бүртгэгдсэн гэмтлийн түүх (${data.incidents.length})</summary><div class="table-panel"><table class="data-table"><thead><tr><th>Гэмтэл</th><th>Камерын объект</th><th>Нөлөөлсөн</th><th>Зассан</th><th>Огноо</th><th>Төлөв</th></tr></thead><tbody>${data.incidents.map(item=>`<tr><td><strong>${esc(typeNames.get(item.incident_type)||item.incident_type)}</strong><small>${esc(item.title||"")}</small></td><td>${esc(item.asset_name||item.location||"—")}</td><td>${Number(item.affected_quantity||0)}</td><td>${Number(item.resolved_quantity||0)}</td><td>${date(item.reported_at)}</td><td><span class="badge ${esc(item.status)}">${lightingStatus(item.status)}</span></td></tr>`).join("")}</tbody></table></div></details>`:"";
  return `<section class="lighting-fault-sheet quick"><div class="lighting-fault-toolbar"><div><h2>Камерын гэмтлийг тоогоор хурдан бүртгэх</h2><small>Объектын нийт камерын тоог харж байгаад гэмтлийн төрөл, нөлөөлсөн камерын тоог шууд сонгоно.</small></div><div class="lighting-fault-controls"><button type="button" class="secondary" data-camera-fault-expanded>${state.cameraFaultExpanded?"Тайлбар нуух":"Тайлбар нэмэх"}</button></div></div>${canReport?"":`<div class="lighting-permission-note">Танд бүртгэлийг харах эрх байна. Шинэ гэмтэл хадгалах <code>operational-incidents.report</code> эрх олгогдоогүй.</div>`}<form id="cameraFaultBatchForm"><div class="lighting-fault-scroll"><table class="data-table lighting-fault-table lighting-quick-fault-table"><thead><tr><th class="fault-object-cell">Код / камерын объект</th><th>Шон / цэг</th><th>Нийт камер</th><th>GPS</th><th>Гэмтэл</th>${state.cameraFaultExpanded?"<th>Тайлбар</th>":""}<th></th></tr></thead><tbody>${rows}</tbody></table></div>${canReport?`<div class="lighting-fault-save"><span><b>${draftCount}</b> мөр бэлэн</span><small>Камерын төрлийн гэмтэл нийт камерын тооноос хэтрэхгүй. Хадгалах үед эрх, тоо, давхардлыг сервер дахин шалгаж audit үүсгэнэ.</small><button class="primary" ${!draftCount||state.cameraFaultSaving?"disabled":""}>${state.cameraFaultSaving?"Хадгалж байна…":"Шалгаж хадгалах"}</button></div>`:""}</form></section>${history}`;
}

function cameraWork(data) {
  return `<div class="work-source-note"><span>Эдгээр нь тусдаа урсгал биш. Нэгдсэн Ажлын самбараас зөвхөн камертай холбоотой ажлыг харуулж байна.</span><button class="secondary" data-go="work-orders">Ажлын самбар нээх →</button></div>` + cameraTable(["Ажил", "Объект", "Хариуцагч", "Төлөв", "Үе шат", "Хугацаа"],
    data.workOrders.map((item) => `<tr><td><b>${esc(item.title)}</b></td><td>${esc(item.asset_name || item.asset_code || "—")}</td><td>${esc(item.assigned_name || item.department_name || "Оноогоогүй")}</td><td>${esc(item.status || "—")}</td><td>${esc(item.workflow_stage || "—")}</td><td>${item.due_at ? date(item.due_at) : "—"}</td></tr>`), 6);
}

function cameraReports(data) {
  const rows=(data.snapshots||[]).map(item=>`<tr><td>${date(item.snapshot_date)}</td><td>${Number(item.metrics?.totalPoints||0)}</td><td>${Number(item.metrics?.totalCameras||0)}</td><td>${Number(item.metrics?.brokenCameras||0)}</td><td>${Number(item.metrics?.availabilityPct||0).toFixed(1)}%</td><td>${Number(item.metrics?.openWork||0)}</td></tr>`);
  return `<section class="panel"><h3>Камерын өдрийн төлөвийн түүх</h3><p>Хуучин системийн өдөр бүр хадгалсан тоон агшныг эх сурвалжтай нь харуулна.</p>${cameraTable(["Огноо","Цэг","Нийт камер","Ажиллахгүй","Хэвийн ажиллагаа","Нээлттэй ажил"],rows,6)}</section>`;
}

async function openCameraDossier(id){
  try{const data=await api(`/api/camera/objects/${id}/dossier`);state.lightingDossier=data;$("#lightingDossierTitle").textContent=`${data.item.code} — ${data.item.name}`;$("#lightingDossierBody").innerHTML=lightingDossierHtml(data);$("#lightingDossierDialog").showModal()}catch(error){toast(error.message,true)}
}

function cameraOverview(data) {
  const devices = data.assets.reduce((sum, item) => sum + Number(item.camera_count || 0), 0);
  const openIncidents = data.incidents.filter((item) => ["open", "in_progress"].includes(item.status));
  const affectedDevices = openIncidents.reduce((sum, item) => sum + Math.max(0,
    Number(item.affected_quantity || 0) - Number(item.resolved_quantity || 0)), 0);
  const activeDevices = Math.max(0,devices-affectedDevices);
  const openWork = data.workOrders.filter((item) => !["completed", "cancelled"].includes(item.status));
  const completedWork = data.workOrders.filter((item) => item.status === "completed");
  const operationalLabels={attention:"Засвар шаардлагатай",normal:"Хэвийн",decision:"Шийдвэр хүлээж буй"};
  const selectedParts=[
    state.cameraGroupFilter === "all" ? "" : state.cameraGroupFilter === "unclassified" ? "Ангилал тодорхойгүй" : cameraGroupLabel(state.cameraGroupFilter),
    state.cameraOperationalFilter === "all" ? "" : operationalLabels[state.cameraOperationalFilter],
    state.cameraSearch ? `“${state.cameraSearch}” хайлт` : "",
  ].filter(Boolean);
  const selectedName = selectedParts.length ? selectedParts.join(" · ") : "Камерын нийт ажиллагаа";
  const recentIncidents = data.incidents.slice(0, 6).map((item) => `<div class="lighting-list"><div><b>${esc(item.asset_name || item.title || "Камерын гэмтэл")}</b><small>${esc(item.description || item.status || "—")}</small></div><span>${esc(item.status || "—")}</span></div>`).join("");
  const recentWork = data.workOrders.slice(0, 6).map((item) => `<div class="lighting-list"><div><b>${esc(item.title)}</b><small>${esc(item.assigned_name || item.department_name || "Оноогоогүй")}</small></div><span>${esc(item.workflow_stage || item.status || "—")}</span></div>`).join("");
  return `<div class="lighting-context-note"><strong>${esc(selectedName)}</strong><span>Доорх мэдээлэл сонгосон байршил, ажиллагааны төлөв болон хайлтаар шүүгдсэн.</span></div><div class="lighting-stat-grid">
    ${stat("Нийт камер", devices, `${data.assets.length} объект · ${activeDevices} хэвийн`, "◇", "blue")}
    ${stat("Нээлттэй гэмтэл", openIncidents.length, `${affectedDevices} төхөөрөмжид нөлөөлсөн`, "!", "red")}
    ${stat("Нээлттэй ажил", openWork.length, "Хянагдаж буй ажлууд", "✓", "green")}
    ${stat("Дууссан ажил", completedWork.length, "Баталгаажсан гүйцэтгэл", "↗", "purple")}
  </div><div class="content-grid"><section class="panel"><div class="panel-head"><h2>Шийдэх гэмтэл</h2><button data-camera-tab="incidents">Бүгдийг харах →</button></div>${recentIncidents || empty("Нээлттэй гэмтэл алга.")}</section><section class="panel"><div class="panel-head"><h2>Сүүлийн камерын ажлууд</h2><button data-camera-tab="work">Бүгдийг харах →</button></div>${recentWork || empty("Камерын ажил алга.")}</section></div>`;
}

function cameraView() {
  if (state.cameraLoading && !state.cameraWorkspace) return `${header("КАМЕРЫН ҮЙЛ АЖИЛЛАГАА", "Камерын тасгийн ажлын талбар", "Мэдээллийг ачаалж байна...")}<div class="panel">Ачаалж байна...</div>`;
  const data = state.cameraWorkspace;
  if (!data) return `${header("КАМЕРЫН ҮЙЛ АЖИЛЛАГАА", "Камерын тасгийн ажлын талбар", "Камерын объект, гэмтэл, засварын ажлын урсгал.")}<div class="panel">Мэдээлэл ачаалагдаагүй байна.</div>`;
  if (data.error) return `${header("КАМЕРЫН ҮЙЛ АЖИЛЛАГАА", "Камерын тасгийн ажлын талбар", "Камерын объект, гэмтэл, засварын ажлын урсгал.")}<div class="panel"><div class="error">${esc(data.error)}</div><button class="secondary" data-camera-refresh>Дахин оролдох</button></div>`;
  const scoped = cameraScoped(data);
  const content = state.cameraTab === "assets" ? cameraAssets(scoped)
    : state.cameraTab === "network" ? cameraNetworkView()
    : state.cameraTab === "incidents" ? cameraIncidents(scoped)
      : state.cameraTab === "work" ? cameraWork(scoped)
        : state.cameraTab === "reports" ? cameraReports(scoped) : cameraOverview(scoped);
  const navigation = ["reports", "network"].includes(state.cameraTab) ? "" : cameraScopeNavigation(data);
  return `${header("КАМЕРЫН ҮЙЛ АЖИЛЛАГАА", "Камерын тасгийн ажлын талбар", "Камерын объект → гэмтэл → ажил → хяналт → баталгаажуулалтын нэг урсгал.", `<button class="secondary" data-camera-refresh>↻ Шинэчлэх</button>`)}
    ${cameraTabs()}
    ${!data.available ? `<div class="panel">Камерын ажлын төрөл эсвэл объект бүртгэгдээгүй байна. Тохиргоо болон Smart Import-оор бүртгэнэ үү.</div>` : ""}
    ${navigation}${content}`;
}

document.addEventListener("click", (event) => {
  const tab = event.target.closest("[data-camera-tab]");
  if (tab) {
    state.cameraTab = tab.dataset.cameraTab;
    if (state.cameraTab === "network") loadCameraNetwork();
    render();
  }
  const group = event.target.closest("[data-camera-group]");
  if (group) {
    state.cameraGroupFilter = group.dataset.cameraGroup;
    state.cameraOperationalFilter = "all";
    render();
  }
  const operational = event.target.closest("[data-camera-operational]");
  if (operational) {
    state.cameraOperationalFilter = operational.dataset.cameraOperational;
    render();
  }
  if (event.target.closest("[data-camera-refresh]")) loadCamera(true);
  if(event.target.closest("[data-camera-fault-expanded]")){
    state.cameraFaultExpanded=!state.cameraFaultExpanded;
    render();
  }
  const faultStep=event.target.closest("[data-camera-fault-step]");
  if(faultStep){
    const input=document.querySelector(`[data-camera-fault-field="affectedQuantity"][data-object-id="${faultStep.dataset.objectId}"]`);
    if(input){
      const maximum=Number(input.max||1000000),next=Math.min(maximum,Math.max(0,(Number(input.value)||0)+Number(faultStep.dataset.cameraFaultStep)));
      input.value=String(next);
      input.dispatchEvent(new Event("input",{bubbles:true}));
      render();
    }
  }
  const clearFault=event.target.closest("[data-clear-camera-fault]");
  if(clearFault){
    delete state.cameraFaultDrafts[clearFault.dataset.clearCameraFault];
    state.cameraFaultBatchKey=null;
    state.cameraFaultBatchReportedAt=null;
    render();
  }
  const dossier=event.target.closest("[data-camera-dossier]");
  if(dossier)openCameraDossier(dossier.dataset.cameraDossier);
});

document.addEventListener("change",event=>{
  if(event.target.matches('[data-camera-fault-field="incidentType"],[data-camera-fault-field="affectedQuantity"]'))render();
});

document.addEventListener("input",event=>{
  if(event.target.matches("[data-camera-search]")){
    state.cameraSearch=event.target.value;
    render();
    const replacement=document.querySelector("[data-camera-search]");
    if(replacement){replacement.focus();replacement.setSelectionRange(replacement.value.length,replacement.value.length)}
    return;
  }
  if(!event.target.matches("[data-camera-fault-field]"))return;
  const objectId=event.target.dataset.objectId,field=event.target.dataset.cameraFaultField;
  const current=state.cameraFaultDrafts[objectId]||{
    rowKey:crypto.randomUUID(),incidentType:state.cameraWorkspace?.incidentTypes?.[0]?.code||"",
    affectedQuantity:"",note:""
  };
  current[field]=event.target.value;
  state.cameraFaultDrafts[objectId]=current;
  state.cameraFaultBatchKey=null;
  state.cameraFaultBatchReportedAt=null;
  const form=event.target.closest("form"),button=form?.querySelector("button.primary"),
    visibleObjectIds=new Set(cameraScoped(state.cameraWorkspace).assets.map(object=>object.id)),
    count=Object.entries(state.cameraFaultDrafts).filter(([id,item])=>visibleObjectIds.has(id)&&Number(item.affectedQuantity)>0).length;
  if(button)button.disabled=!count;
  const countElement=form?.querySelector(".lighting-fault-save span b");
  if(countElement)countElement.textContent=String(count);
  const clear=form?.querySelector(`[data-clear-camera-fault="${objectId}"]`);
  if(clear)clear.disabled=!(current.affectedQuantity||current.note);
});

document.addEventListener("submit",async event=>{
  if(event.target.id!=="cameraFaultBatchForm")return;
  event.preventDefault();
  state.cameraFaultBatchReportedAt=state.cameraFaultBatchReportedAt||new Date().toISOString();
  const visibleObjectIds=new Set(cameraScoped(state.cameraWorkspace).assets.map(object=>object.id));
  const rows=Object.entries(state.cameraFaultDrafts)
    .filter(([id,item])=>visibleObjectIds.has(id)&&Number(item.affectedQuantity)>0)
    .map(([operationalObjectId,item])=>({rowKey:item.rowKey,operationalObjectId,
      incidentType:item.incidentType||state.cameraWorkspace?.incidentTypes?.[0]?.code||"",
      affectedQuantity:Number(item.affectedQuantity),reportedAt:state.cameraFaultBatchReportedAt,
      note:String(item.note||"").trim()}));
  if(!rows.length)return;
  state.cameraFaultSaving=true;
  state.cameraFaultBatchKey=state.cameraFaultBatchKey||crypto.randomUUID();
  render();
  try{
    const result=await api("/api/camera/incidents/batch",{method:"POST",
      body:JSON.stringify({idempotencyKey:state.cameraFaultBatchKey,rows})});
    for(const item of result.items||[])delete state.cameraFaultDrafts[item.operational_object_id];
    state.cameraFaultBatchKey=null;
    state.cameraFaultBatchReportedAt=null;
    await loadCamera(true);
    toast(`${result.items?.length||0} камерын гэмтлийг аудиттайгаар бүртгэлээ`);
  }catch(error){toast(error.message,true)}finally{
    state.cameraFaultSaving=false;
    if(state.view==="camera")render();
  }
});

window.cameraView = cameraView;
window.loadCamera = loadCamera;
