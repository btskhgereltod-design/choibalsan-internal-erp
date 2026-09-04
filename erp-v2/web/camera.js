"use strict";

state.cameraWorkspace = null;
state.cameraLoading = false;
state.cameraTab = "overview";
state.cameraGroupFilter = "all";
state.cameraOperationalFilter = "all";
state.cameraSearch = "";
state.cameraFaultDrafts = {};
state.cameraFaultEditors = {};
state.cameraFaultView = "all";
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
    return `<tr><td><button class="object-dossier-link" data-camera-dossier="${item.id}">${esc(item.name)}</button><small>${esc(item.code || "—")} · Объектын master бүртгэл</small></td><td>${esc(cameraGroupLabel(cameraGroupOf(item)))}</td><td>${esc(item.location || "—")}</td><td>${Number(item.camera_point_count || 0)}</td><td>${Number(item.camera_count || 0)}</td><td><span class="camera-operational-state ${operational}">${esc(operationalLabel)}</span><small>${esc(operationalDetail)}</small></td><td>${Number(item.gps_point_count || 0)}</td><td><span class="classification-state ${esc(item.classification_state)}">${item.classification_state === "canonical" ? `Canonical v${Number(item.specification_version)}` : "Эх өгөгдөл"}</span></td><td><button class="secondary dossier-open-action" data-camera-dossier="${item.id}">Хувийн хэрэг</button></td></tr>`;
  });
  return `<div class="lighting-section-stack"><section><div class="lighting-section-title"><h2>Камерын объектын бүртгэл</h2><span>Объект → шон/цэг → камерын төхөөрөмж ба үзүүлэлт → GPS гэсэн холбоос бүхий ашиглалтын master data</span></div><div class="lighting-object-summary"><span><b>${data.assets.length}</b> объект</span><span><b>${totals.points}</b> шон / цэг</span><span><b>${totals.cameras}</b> камер</span><span><b>${totals.gps}</b> GPS цэг</span></div>${cameraTable(["Код / камерын объект", "Баг / бүс", "Байршил", "Шон / цэг", "Камер", "Ажиллагаа", "GPS", "Master төлөв", "Үйлдэл"], rows, 9)}</section></div>`;
}

function cameraIncidentsLegacy(data) {
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

function cameraIncidents(data){
  const types=data.incidentTypes||[],canReport=Boolean(data.capabilities?.canReportIncidents),canCancel=Boolean(data.capabilities?.canCancelIncidents),
    typeByCode=new Map(types.map(type=>[type.code,type])),allObjects=state.cameraWorkspace?.assets||data.assets,targetById=new Map(allObjects.map(object=>[object.id,object])),
    openIncidents=(data.incidents||[]).filter(item=>item.operational_object_id&&['open','in_progress'].includes(item.status)&&Number(item.affected_quantity)>Number(item.resolved_quantity)),
    drafts=Object.values(state.cameraFaultDrafts),openByObjectType=new Map(),openByObjectUnit=new Map();
  const incidentUnit=incident=>String(incident.detail?.quantityUnit||typeByCode.get(incident.incident_type)?.quantity_unit||'камер');
  for(const incident of openIncidents){
    const remaining=Math.max(0,Number(incident.affected_quantity)-Number(incident.resolved_quantity)),unit=incidentUnit(incident),objectId=incident.operational_object_id;
    openByObjectType.set(`${objectId}:${incident.incident_type}`,(openByObjectType.get(`${objectId}:${incident.incident_type}`)||0)+remaining);
    openByObjectUnit.set(`${objectId}:${unit}`,(openByObjectUnit.get(`${objectId}:${unit}`)||0)+remaining);
  }
  const hasOpen=object=>openIncidents.some(item=>item.operational_object_id===object.id),faultyObjectCount=data.assets.filter(hasOpen).length,
    showFaultyOnly=state.cameraFaultView==='faulty'&&faultyObjectCount>0,
    displayedObjects=data.assets.map((object,index)=>({object,index,hasOpen:hasOpen(object)})).filter(item=>!showFaultyOnly||item.hasOpen)
      .sort((left,right)=>Number(right.hasOpen)-Number(left.hasOpen)||left.index-right.index);
  const openSummary=object=>{
    const records=openIncidents.filter(item=>item.operational_object_id===object.id),codes=[...new Set(records.map(item=>item.incident_type))],
      items=codes.map(code=>{const record=records.find(item=>item.incident_type===code),known=typeByCode.get(code);return {type:known||{name:'Өмнөх бүртгэлийн гэмтэл',quantity_unit:incidentUnit(record)},legacyLabel:known?'':code,count:openByObjectType.get(`${object.id}:${code}`)||0}}).filter(item=>item.count>0);
    if(!items.length)return '<span class="fault-none-chip">Одоогоор нээлттэй гэмтэлгүй</span>';
    const totals=items.map(item=>`<span class="fault-open-chip"><b>${esc(item.type.name)}</b>${item.count} ${esc(item.type.quantity_unit)}${item.legacyLabel?`<small>${esc(item.legacyLabel)}</small>`:''}</span>`).join(''),
      details=records.map(item=>{const type=typeByCode.get(item.incident_type),remaining=Math.max(0,Number(item.affected_quantity)-Number(item.resolved_quantity));return `<div class="fault-open-record"><span><b>${esc(type?.name||'Өмнөх бүртгэлийн гэмтэл')}</b><small>${type?'':`${esc(item.incident_type)} · `}${dateTime(item.reported_at)} · үлдсэн ${remaining} ${esc(incidentUnit(item))}</small></span>${canCancel?`<button type="button" class="secondary incident-cancel" data-cancel-camera-incident="${item.id}" data-version="${item.version}">Хүчингүй болгох</button>`:'<small>Зөвхөн харах эрхтэй</small>'}</div>`}).join('');
    return `${totals}<details class="fault-object-history"><summary>${canCancel?'Буруу бүртгэл засах / хүчингүй болгох':'Бүртгэл тус бүрийг харах'} (${records.length})</summary><div>${details}</div></details>`;
  };
  const draftSummary=drafts.map(draft=>{const object=targetById.get(draft.objectId),type=typeByCode.get(draft.incidentType);if(!object||!type)return '';return `<div class="fault-review-item"><span><b>${esc(object.name)}</b><small>${esc(type.name)} · шинээр +${draft.affectedQuantity} ${esc(type.quantity_unit)}${draft.note?` · ${esc(draft.note)}`:''}</small></span><button type="button" class="icon-button" data-remove-camera-fault-draft="${draft.rowKey}" title="Энэ өөрчлөлтийг хасах">×</button></div>`}).join('');
  const rows=displayedObjects.map(({object,hasOpen:objectHasOpen})=>{
    const fallback=types[0]?.code||'',editor=state.cameraFaultEditors[object.id]||{incidentType:fallback,affectedQuantity:'',note:''};
    if(!types.some(type=>type.code===editor.incidentType))editor.incidentType=fallback;
    const selectedType=typeByCode.get(editor.incidentType)||types[0]||{},unit=selectedType.quantity_unit||'тохиолдол',cameraCount=Number(object.camera_count||0),
      total=unit==='камер'?cameraCount:null,open=openByObjectUnit.get(`${object.id}:${unit}`)||0,
      pending=drafts.filter(item=>item.objectId===object.id&&typeByCode.get(item.incidentType)?.quantity_unit===unit).reduce((sum,item)=>sum+Number(item.affectedQuantity||0),0),
      remaining=total===null?1000000:Math.max(0,total-open-pending),prepared=drafts.filter(item=>item.objectId===object.id),
      options=types.map(type=>`<option value="${esc(type.code)}" ${type.code===editor.incidentType?'selected':''}>${esc(type.name)} · ${esc(type.quantity_unit)}</option>`).join(''),
      preparedHtml=prepared.length?`<div class="fault-row-drafts">${prepared.map(item=>{const type=typeByCode.get(item.incidentType);return `<span><b>${esc(type?.name||item.incidentType)}</b> +${item.affectedQuantity} ${esc(type?.quantity_unit||'')}<button type="button" data-remove-camera-fault-draft="${item.rowKey}" aria-label="Бэлтгэсэн мөр хасах">×</button></span>`}).join('')}</div>`:'';
    return `<tr class="${objectHasOpen?'fault-row-current':''}" data-camera-fault-row="${object.id}"><td class="fault-object-cell"><button type="button" class="object-dossier-link" data-camera-dossier="${object.id}">${esc(object.name)}</button><small>${esc(object.code||'—')} · ${esc(cameraGroupLabel(cameraGroupOf(object)))}</small></td><td><span class="fault-inventory">Цэг ${Number(object.camera_point_count||0)} · Камер ${cameraCount} · GPS ${Number(object.gps_point_count||0)}</span></td><td><div class="fault-open-list">${openSummary(object)}</div></td><td class="quick-fault-cell"><select class="fault-type-select" data-camera-fault-field="incidentType" data-object-id="${object.id}" ${canReport?'':'disabled'}>${options}</select><div class="fault-entry-line"><label><small>Шинээр нэмэх (${esc(unit)})</small><input class="fault-quantity-input" type="number" min="0" max="${remaining}" step="1" value="${esc(editor.affectedQuantity||'')}" placeholder="0" data-camera-fault-field="affectedQuantity" data-object-id="${object.id}" ${canReport?'':'disabled'}></label><button type="button" class="secondary fault-prepare" data-add-camera-fault="${object.id}" ${canReport&&remaining>0?'':'disabled'}>+ Бэлтгэх</button></div>${state.cameraFaultExpanded?`<input class="fault-note-input" value="${esc(editor.note||'')}" maxlength="2000" placeholder="Тайлбар" data-camera-fault-field="note" data-object-id="${object.id}" ${canReport?'':'disabled'}>`:''}${preparedHtml}</td></tr>`;
  }).join('')||'<tr><td colspan="4" class="fault-filter-empty">Энэ сонголтод нээлттэй гэмтэлтэй камерын объект алга.</td></tr>';
  const history=data.incidents||[],historyHtml=history.length?`<details class="lighting-incident-history"><summary>Бүртгэгдсэн гэмтлийн түүх (${history.length})</summary><div class="table-panel"><table class="data-table"><thead><tr><th>Гэмтэл</th><th>Камерын объект</th><th>Нөлөөлсөн</th><th>Зассан</th><th>Огноо</th><th>Төлөв</th><th>Үйлдэл</th></tr></thead><tbody>${history.map(item=>`<tr><td><strong>${esc(typeByCode.get(item.incident_type)?.name||item.incident_type)}</strong><small>${esc(item.title||'')}</small></td><td>${esc(item.asset_name||item.location||'—')}</td><td>${Number(item.affected_quantity||0)}</td><td>${Number(item.resolved_quantity||0)}</td><td>${date(item.reported_at)}</td><td><span class="badge ${esc(item.status)}">${lightingStatus(item.status)}</span></td><td>${canCancel&&['open','in_progress'].includes(item.status)?`<button type="button" class="secondary incident-cancel" data-cancel-camera-incident="${item.id}" data-version="${item.version}">Хүчингүй болгох</button>`:'—'}</td></tr>`).join('')}</tbody></table></div></details>`:'';
  const faultSummary=faultyObjectCount
    ? `${faultyObjectCount} гэмтэлтэй объект эхэнд байна. Нэг объектод олон төрлийн гэмтлийг бэлтгээд нэг удаа хадгална.`
    : `Энэ сонголтод нээлттэй гэмтэл алга. Шинэ гэмтэл бүртгэх ${data.assets.length} объектыг бүгдийг харуулж байна.`;
  return `<section class="lighting-fault-sheet quick"><div class="lighting-fault-toolbar"><div><h2>Камерын шинэ гэмтэл бүртгэх</h2><small>${faultSummary}</small></div><div class="lighting-fault-controls"><div class="fault-view-filter"><button type="button" class="${showFaultyOnly?'':'active'}" data-camera-fault-view="all">Бүгд ${data.assets.length}</button><button type="button" class="${showFaultyOnly?'active':''}" data-camera-fault-view="faulty" ${faultyObjectCount?'':'disabled aria-disabled="true" title="Нээлттэй гэмтэлтэй объект алга"'}>Зөвхөн гэмтэлтэй ${faultyObjectCount}</button></div><button type="button" class="secondary" data-camera-fault-expanded>${state.cameraFaultExpanded?'Тайлбар нуух':'Тайлбар нэмэх'}</button></div></div>${drafts.length?`<section class="fault-change-review"><div><strong>Хадгалах өөрчлөлт — ${drafts.length} мөр</strong><small>Бүх мөр тус тусын камерын объект, гэмтлийн төрөлд нэмэгдэнэ.</small></div><div class="fault-review-list">${draftSummary}</div><div class="fault-review-actions"><button type="button" class="secondary" data-clear-all-camera-fault-drafts>Бүгдийг цэвэрлэх</button><button type="submit" form="cameraFaultBatchForm" class="primary" ${state.cameraFaultSaving?'disabled':''}>${state.cameraFaultSaving?'Хадгалж байна…':`${drafts.length} өөрчлөлт хадгалах`}</button></div></section>`:''}${canReport?'':`<div class="lighting-permission-note">Танд бүртгэлийг харах эрх байна. Шинэ гэмтэл хадгалах эрх олгогдоогүй.</div>`}<form id="cameraFaultBatchForm"><div class="lighting-fault-scroll"><table class="data-table lighting-fault-table lighting-fault-understandable"><thead><tr><th class="fault-object-cell">Камерын объект</th><th>Бүртгэлтэй тоноглол</th><th>Одоогийн нээлттэй гэмтэл</th><th>Шинэ өөрчлөлт бэлтгэх</th></tr></thead><tbody>${rows}</tbody></table></div><div class="lighting-fault-save"><small>Бэлтгэсэн мөрийг хадгалахаас өмнө × товчоор хасна. Хадгалсан буруу мөрийг тухайн объектын нээлттэй гэмтлээс шалтгаантай хүчингүй болгоно.</small></div></form></section>${historyHtml}`;
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

document.addEventListener("click", async (event) => {
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
  const faultView=event.target.closest("[data-camera-fault-view]");
  if(faultView){state.cameraFaultView=faultView.dataset.cameraFaultView;render()}
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
  const addFault=event.target.closest("[data-add-camera-fault]");
  if(addFault){
    const objectId=addFault.dataset.addCameraFault,row=addFault.closest('[data-camera-fault-row]'),typeInput=row?.querySelector('[data-camera-fault-field="incidentType"]'),quantityInput=row?.querySelector('[data-camera-fault-field="affectedQuantity"]'),noteInput=row?.querySelector('[data-camera-fault-field="note"]'),
      incidentType=typeInput?.value||'',quantity=Number(quantityInput?.value||0),maximum=Number(quantityInput?.max||1000000),key=`${objectId}:${incidentType}`,existing=state.cameraFaultDrafts[key];
    if(!incidentType||!Number.isInteger(quantity)||quantity<1)return toast('Гэмтлийн төрөл болон шинээр нэмэх тоог оруулна уу',true);
    if(quantity>maximum)return toast(`Энэ төрлийн үлдсэн боломжит тоо ${maximum}`,true);
    state.cameraFaultDrafts[key]={rowKey:existing?.rowKey||crypto.randomUUID(),objectId,incidentType,affectedQuantity:Number(existing?.affectedQuantity||0)+quantity,note:String(noteInput?.value||existing?.note||'').trim()};
    state.cameraFaultEditors[objectId]={incidentType,affectedQuantity:'',note:''};
    state.cameraFaultBatchKey=null;state.cameraFaultBatchReportedAt=null;render();
  }
  const removeDraft=event.target.closest("[data-remove-camera-fault-draft]");
  if(removeDraft){
    const entry=Object.entries(state.cameraFaultDrafts).find(([,item])=>item.rowKey===removeDraft.dataset.removeCameraFaultDraft);
    if(entry)delete state.cameraFaultDrafts[entry[0]];
    state.cameraFaultBatchKey=null;state.cameraFaultBatchReportedAt=null;render();
  }
  if(event.target.closest("[data-clear-all-camera-fault-drafts]")){
    state.cameraFaultDrafts={};state.cameraFaultBatchKey=null;state.cameraFaultBatchReportedAt=null;render();
  }
  const cancelIncident=event.target.closest("[data-cancel-camera-incident]");
  if(cancelIncident){
    const reason=prompt('Яагаад энэ камерын гэмтлийн бүртгэлийг хүчингүй болгож байгааг бичнэ үү');
    if(reason===null)return;
    if(reason.trim().length<3)return toast('Хүчингүй болгосон шалтгааныг 3-аас дээш тэмдэгтээр бичнэ үү',true);
    cancelIncident.disabled=true;
    try{
      await api(`/api/camera/incidents/${cancelIncident.dataset.cancelCameraIncident}/cancel`,{method:'POST',body:JSON.stringify({reason:reason.trim(),expectedVersion:Number(cancelIncident.dataset.version),idempotencyKey:crypto.randomUUID()})});
      await loadCamera(true);toast('Камерын буруу гэмтлийн бүртгэлийг түүхтэй нь хүчингүй болголоо');
    }catch(error){toast(error.message,true)}finally{cancelIncident.disabled=false}
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
  const current=state.cameraFaultEditors[objectId]||{
    incidentType:state.cameraWorkspace?.incidentTypes?.[0]?.code||"",
    affectedQuantity:"",note:""
  };
  current[field]=event.target.value;
  state.cameraFaultEditors[objectId]=current;
  state.cameraFaultBatchKey=null;
  state.cameraFaultBatchReportedAt=null;
});

document.addEventListener("submit",async event=>{
  if(event.target.id!=="cameraFaultBatchForm")return;
  event.preventDefault();
  state.cameraFaultBatchReportedAt=state.cameraFaultBatchReportedAt||new Date().toISOString();
  const allObjectIds=new Set((state.cameraWorkspace?.assets||[]).map(object=>object.id));
  const rows=Object.values(state.cameraFaultDrafts)
    .filter(item=>allObjectIds.has(item.objectId)&&Number(item.affectedQuantity)>0)
    .map(item=>({rowKey:item.rowKey,operationalObjectId:item.objectId,
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
    state.cameraFaultDrafts={};
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
