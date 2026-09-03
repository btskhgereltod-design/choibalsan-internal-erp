"use strict";
state.lightingWorkspace = null;
state.lightingLoading = false;
state.lightingTab = "overview";
state.lightingAreaFilter = "all";
state.lightingFaultDrafts = {};
state.lightingFaultDensity = "compact";
state.lightingFaultZoom = 100;
state.lightingFaultExpanded = false;
state.lightingFaultSaving = false;
state.lightingFaultBatchKey = null;
state.lightingFaultBatchReportedAt = null;
state.lightingDossierObjectUrls = [];
const lightingLabels = {
  open: "Нээлттэй",
  in_progress: "Шийдвэрлэж байна",
  resolved: "Шийдвэрлэсэн",
  cancelled: "Цуцалсан",
  new: "Шинэ",
  assigned: "Хуваарилсан",
  pending_review: "Хянуулах",
  completed: "Дууссан",
  awaiting_safety_start: "ХАБЭА зөвшөөрөл",
  awaiting_management_start: "Ерөнхий инженер батлах",
  execution: "Гүйцэтгэл",
  awaiting_safety_completion: "ХАБЭА хяналт",
  awaiting_management_completion: "Эцсийн баталгаа",
};
function lightingStatus(value) {
  return lightingLabels[value] || labels[value] || value || "—";
}
function lightingTabs() {
  return `<div class="lighting-tabs" aria-label="Гэрэлтүүлгийн ажлын талбарын цэс">${[
    ["overview", "Нүүр"],
    ["assets", "Гэрэлтүүлгийн объектын бүртгэл"],
    ["incidents", "Гэмтэл бүртгэл"],
    ["work", "Ажлын гүйцэтгэл"],
    ["operations", "Ашиглалтын хяналт"],
    ["reports", "Судалгаа, тайлан"],
  ]
    .map(
      ([key, name]) =>
        `<button class="${state.lightingTab === key ? "active" : ""}" data-lighting-tab="${key}">${name}</button>`,
    )
    .join("")}</div>`;
}
function lightingAreaMatches(item) {
  return (
    state.lightingAreaFilter === "all" ||
    (state.lightingAreaFilter === "unclassified" &&
      !item.service_area_code) ||
    item.service_area_code === state.lightingAreaFilter
  );
}
function lightingScoped(d) {
  return {
    ...d,
    all: d,
    assets: (d.assets || []).filter(lightingAreaMatches),
    fixedAssets: (d.fixedAssets || []).filter(lightingAreaMatches),
    incidents: (d.incidents || []).filter(lightingAreaMatches),
    workOrders: (d.workOrders || []).filter(lightingAreaMatches),
  };
}
function lightingAreaMetrics(d, code) {
  const matches = (item) =>
    code === "all" ||
    (code === "unclassified" && !item.service_area_code) ||
    item.service_area_code === code;
  const records = [...(d.assets || []), ...(d.fixedAssets || [])].filter(
    matches,
  ).length;
  const openIncidents = (d.incidents || []).filter(
    (item) =>
      matches(item) &&
      ["open", "in_progress"].includes(item.status) &&
      Number(item.affected_quantity) - Number(item.resolved_quantity) > 0,
  );
  const affected = openIncidents.reduce(
    (sum, item) =>
      sum +
      Math.max(
        0,
        Number(item.affected_quantity) - Number(item.resolved_quantity),
      ),
    0,
  );
  const work = (d.workOrders || []).filter(
    (item) => matches(item) && !["completed", "cancelled"].includes(item.status),
  ).length;
  return { records, openIncidentRows: openIncidents.length, affected, work };
}
function lightingAreaNavigation(d) {
  const all = lightingAreaMetrics(d, "all");
  const unclassified = lightingAreaMetrics(d, "unclassified");
  const objectRegistry=state.lightingTab==="assets";
  const heading=objectRegistry
    ? ["ОБЪЕКТЫН АНГИЛАЛ","Аль ангиллын объектыг харах вэ?","Бүх ангилал"]
    : ["ҮЙЛЧИЛГЭЭНИЙ ЧИГЛЭЛ","Аль хэсгийн ажлыг харах вэ?","Бүх чиглэл"];
  const allValue=objectRegistry?all.records:state.lightingTab==="incidents"?all.openIncidentRows:state.lightingTab==="work"?all.work:all.records;
  const metricHtml=(metric)=>objectRegistry
    ? `<small><b>${metric.records}</b> объект / тоноглол</small>`
    : state.lightingTab==="incidents"
      ? `<small><b>${metric.openIncidentRows}</b> нээлттэй гэмтлийн мөр</small><small><b>${metric.affected}</b> гэмтэлтэй нэгж</small>`
      : state.lightingTab==="work"
        ? `<small><b>${metric.work}</b> идэвхтэй ажил</small>`
        : `<small><b>${metric.records}</b> объект / тоноглол</small><small><b>${metric.openIncidentRows}</b> нээлттэй гэмтлийн мөр</small><small><b>${metric.affected}</b> гэмтэлтэй нэгж</small><small><b>${metric.work}</b> идэвхтэй ажил</small>`;
  return `<section class="lighting-area-selector"><div class="lighting-area-heading"><div><span class="eyebrow">${heading[0]}</span><h2>${heading[1]}</h2></div><button class="lighting-area-all ${state.lightingAreaFilter === "all" ? "active" : ""}" data-lighting-area="all">${heading[2]} <b>${allValue}</b></button></div><div class="lighting-area-grid">${(
    d.serviceAreas || []
  )
    .map((area) => {
      const metric = lightingAreaMetrics(d, area.code);
      return `<button class="lighting-area-card ${state.lightingAreaFilter === area.code ? "active" : ""}" data-lighting-area="${esc(area.code)}"><span class="lighting-area-icon">${esc(area.icon || "•")}</span><strong>${esc(area.name)}</strong><span class="lighting-area-metrics">${metricHtml(metric)}</span></button>`;
    })
    .join("")}${unclassified.records ? `<button class="lighting-area-card warning ${state.lightingAreaFilter === "unclassified" ? "active" : ""}" data-lighting-area="unclassified"><span class="lighting-area-icon">?</span><strong>Ангилал тодорхойгүй</strong><span class="lighting-area-metrics"><small><b>${unclassified.records}</b> хянах объект</small><small>Автоматаар ангилаагүй</small></span></button>` : ""}</div></section>`;
}
function lightingOverview(d) {
  const records = d.assets.length + d.fixedAssets.length,
    openIssues = d.incidents.filter((x) =>
      ["open", "in_progress"].includes(x.status) &&
      Number(x.affected_quantity) - Number(x.resolved_quantity) > 0,
    ),
    openWork = d.workOrders.filter(
      (x) => !["completed", "cancelled"].includes(x.status),
    ),
    completedWork = d.workOrders.filter((x) => x.status === "completed");
  return `<div class="lighting-context-note"><strong>${
    state.lightingAreaFilter === "all"
      ? "Гэрэлтүүлгийн нийт ажиллагаа"
      : esc(
          (d.all.serviceAreas || []).find(
            (area) => area.code === state.lightingAreaFilter,
          )?.name || "Сонгосон чиглэл",
        )
  }</strong><span>Доорх бүх мэдээлэл сонгосон чиглэлээр шүүгдсэн.</span></div><div class="lighting-stat-grid">${stat("Объект ба тоноглол", records, `${d.assets.length} объект · ${d.fixedAssets.length} тоноглол`, "◇", "blue")}${stat("Нээлттэй гэмтлийн мөр", openIssues.length, `${openIssues.reduce((sum, x) => sum + Math.max(0, Number(x.affected_quantity) - Number(x.resolved_quantity)), 0)} гэмтэлтэй нэгж`, "!", "red")}${stat("Идэвхтэй ажил", openWork.length, "Нэгдсэн ажлын урсгал дахь ажил", "✓", "green")}${stat("Дууссан ажил", completedWork.length, "Баталгаажуулж хаасан ажил", "↗", "purple")}</div><div class="content-grid"><section class="panel"><div class="panel-head"><h2>Шийдэх гэмтэл</h2><button data-lighting-tab="incidents">Бүгдийг харах →</button></div>${
    d.incidents
      .filter((x) => ["open", "in_progress"].includes(x.status))
      .slice(0, 6)
      .map(
        (x) =>
          `<div class="lighting-list"><div><strong>${esc(x.title)}</strong><small>${esc(x.asset_name || x.location || "Объект холбоогүй")}</small></div><span class="badge ${esc(x.status)}">${lightingStatus(x.status)}</span></div>`,
      )
      .join("") ||
    empty(
      "Нээлттэй асуудал алга",
      "Үзлэг эсвэл мэдээллээр илэрсэн асуудал энд харагдана.",
    )
  }</section><section class="panel"><div class="panel-head"><h2>Сүүлийн гүйцэтгэл</h2><button data-lighting-tab="work">Бүгдийг харах →</button></div>${
    d.workOrders
      .slice(0, 6)
      .map(
        (x) =>
          `<button class="lighting-list link" data-history-id="${x.id}"><div><strong>${esc(x.title)}</strong><small>${esc(x.assigned_name || x.department_name || "Хариуцагч оноогоогүй")}</small></div><span class="badge ${esc(x.status)}">${lightingStatus(x.workflow_stage || x.status)}</span></button>`,
      )
      .join("") ||
    empty(
      "Ажил бүртгээгүй",
      "Гэмтэл эсвэл төлөвлөгөөнөөс ажлын захиалга үүсгэнэ.",
    )
  }</section></div>`;
}
function lightingAssets(d) {
  const totals=d.assets.reduce((sum,x)=>({
    poles:sum.poles+Number(x.pole_count??x.metadata?.poleCount??x.metadata?.lampCount??0),
    heads:sum.heads+Number(x.head_count??x.metadata?.totalHeadCount??x.metadata?.headCount??0),
    replacements:sum.replacements+Number(x.replacement_pole_count??x.metadata?.replacementPoleCount??0)
  }),{poles:0,heads:0,replacements:0});
  const objectTable = d.assets.length
    ? `<div class="lighting-object-summary"><span><b>${d.assets.length}</b> объект</span><span><b>${totals.poles}</b> шон</span><span><b>${totals.heads}</b> толгой</span><span><b>${totals.replacements}</b> нөхөх шон</span></div><div class="table-panel"><table class="data-table lighting-object-table"><thead><tr><th>Код / гэрэлтүүлгийн объект</th><th>Ангилал</th><th>Байршил</th><th>Шон</th><th>Нийт толгой</th><th>Нэг шон дахь толгой</th><th>Нөхөх шон</th><th>Төлөв</th><th>Үйлдэл</th></tr></thead><tbody>${d.assets.map((x) => `<tr><td><button class="object-dossier-link" data-object-dossier="${x.id}">${esc(x.name)}</button><small>${esc(x.display_code || x.code)} · ${esc(x.service_area_name || "Чиглэл тодорхойгүй")}</small></td><td><span class="classification-state ${esc(x.classification_state)}">${x.classification_state === "unclassified" ? "Хянах шаардлагатай" : x.classification_state === "legacy_candidate" ? "Эх кодоор таарсан" : "Canonical"}</span><small>${esc(x.light_type || x.object_type)}</small></td><td>${esc(x.location || "—")}</td><td>${esc(x.pole_count ?? x.metadata?.poleCount ?? x.metadata?.lampCount ?? "—")}</td><td>${esc(x.head_count ?? x.metadata?.totalHeadCount ?? x.metadata?.headCount ?? "—")}</td><td>${esc(x.head_count_per_pole ?? x.metadata?.headCountPerPole ?? "—")}</td><td>${esc(x.replacement_pole_count ?? x.metadata?.replacementPoleCount ?? "—")}</td><td><span class="badge ${esc(x.status)}">${lightingStatus(x.status)}</span></td><td><button class="secondary dossier-open-action" data-object-dossier="${x.id}">Нээх / засах</button></td></tr>`).join("")}</tbody></table></div>`
    : "";
  const equipmentTable = d.fixedAssets.length
    ? `<div class="table-panel"><table class="data-table"><thead><tr><th>Код / тоноглол</th><th>Ангилал</th><th>Байршил</th><th>Тоо хэмжээ</th><th>Төлөв</th></tr></thead><tbody>${d.fixedAssets.map((x) => `<tr><td><button class="object-dossier-link" data-asset-id="${x.id}">${esc(x.name)}</button><small>${esc(x.code)} · Үндсэн хөрөнгийн бүртгэл</small></td><td>${esc(x.category)}</td><td>${esc(x.location || "—")}</td><td>${esc(x.allocatable_quantity ?? "—")} ${esc(x.allocation_unit || "")}</td><td><span class="badge ${esc(x.status)}">${lightingStatus(x.status)}</span></td></tr>`).join("")}</tbody></table></div>`
    : "";
  if(!d.assets.length&&!d.fixedAssets.length)return empty(
    "Бүртгэл алга",
    "Энэ ангилалд гэрэлтүүлгийн объект эсвэл тоног төхөөрөмж бүртгээгүй байна.",
  );
  const objectSection=d.assets.length
    ? `<section><div class="lighting-section-title"><h2>Гэрэлтүүлгийн объектын бүртгэл</h2><span>Объект нь хөрөнгө биш; харин шон, кабель, толгой, тэжээлийн цэг зэрэг бүрэлдэхүүнийг холбосон ашиглалтын master data</span></div>${objectTable}</section>`
    : "";
  const equipmentTitle=state.lightingAreaFilter==="traffic-signal"?"Гэрлэн дохионы бүртгэл":"Тоног төхөөрөмж, үндсэн хөрөнгө";
  const equipmentSection=d.fixedAssets.length
    ? `<section><div class="lighting-section-title"><h2>${equipmentTitle}</h2><span>Тоологдох үндсэн хөрөнгө ба тоног төхөөрөмжийн бүртгэл</span></div>${equipmentTable}</section>`
    : "";
  return `<div class="lighting-section-stack">${objectSection}${equipmentSection}</div>`;
}
function lightingIncidents(d) {
  const types=d.incidentTypes||[],canReport=Boolean(d.capabilities?.canReportIncidents),typeByCode=new Map(types.map(type=>[type.code,type])),
    openByObjectUnit=new Map();
  const incidentUnit=incident=>String(incident.detail?.quantityUnit||typeByCode.get(incident.incident_type)?.quantity_unit||"толгой");
  for(const incident of d.incidents){
    if(!incident.operational_object_id||!["open","in_progress"].includes(incident.status))continue;
    const key=`${incident.operational_object_id}:${incidentUnit(incident)}`;
    openByObjectUnit.set(key,(openByObjectUnit.get(key)||0)+Math.max(0,Number(incident.affected_quantity)-Number(incident.resolved_quantity)));
  }
  const quantity=value=>value===null||value===undefined||value===""?null:Number.isFinite(Number(value))?Number(value):null;
  const rows=d.assets.map(object=>{
    const draft=state.lightingFaultDrafts[object.id]||{},selected=draft.incidentType||types[0]?.code||"",selectedType=typeByCode.get(selected)||types[0]||{},unit=selectedType.quantity_unit||"тохиолдол";
    const poleCount=quantity(object.pole_count),headCount=quantity(object.head_count),basis=unit==="толгой"?headCount:unit==="шон"?poleCount:null;
    const open=openByObjectUnit.get(`${object.id}:${unit}`)||0,newQuantity=Math.max(0,Number(draft.affectedQuantity)||0),projected=open+newQuantity;
    const availability=basis!==null&&basis>0?Math.max(0,Math.round(((basis-projected)/basis)*100)):null,
      availabilityText=basis===null?"Нийт тоо тодорхойгүй":basis===0?"Нийт тоо 0":`${availability}% хэвийн`;
    const availabilityClass=availability===null?"unknown":availability>=90?"good":availability>=70?"warning":"bad";
    const remaining=basis===null?1000000:Math.max(0,basis-open);
    const typeOptions=types.map(type=>`<option value="${esc(type.code)}" ${type.code===selected?"selected":""}>${esc(type.name)} · ${esc(type.quantity_unit)}</option>`).join("");
    return `<tr data-fault-row="${object.id}"><td class="fault-object-cell"><button type="button" class="object-dossier-link" data-object-dossier="${object.id}">${esc(object.name)}</button><small>${esc(object.display_code||object.code)} · ${esc(object.service_area_name||"Чиглэл тодорхойгүй")}</small></td><td class="numeric"><b>${poleCount??"—"}</b></td><td class="numeric"><b>${headCount??"—"}</b></td><td><small>${esc(object.light_type||"Төрөл бүртгээгүй")}</small></td><td class="quick-fault-cell"><select class="fault-type-select" aria-label="Гэмтлийн төрөл" data-fault-field="incidentType" data-object-id="${object.id}" ${canReport?"":"disabled"}>${typeOptions}</select><div class="fault-count-line"><span>Одоо <b class="fault-open-value">${open}</b> ${esc(unit)}</span><span>Шинээр нэмэх</span></div><div class="fault-stepper"><button type="button" data-fault-step="-1" data-object-id="${object.id}" ${canReport?"":"disabled"}>−</button><input class="fault-quantity-input" type="number" min="0" max="${remaining}" step="1" inputmode="numeric" value="${esc(draft.affectedQuantity??"")}" placeholder="0" data-fault-field="affectedQuantity" data-object-id="${object.id}" ${canReport?"":"disabled"}><button type="button" data-fault-step="1" data-object-id="${object.id}" ${canReport&&remaining>0?"":"disabled"}>+</button><span class="fault-availability ${availabilityClass}">${availabilityText}</span></div></td>${state.lightingFaultExpanded?`<td><input class="fault-note-input" value="${esc(draft.note||"")}" maxlength="2000" placeholder="Шаардлагатай бол тайлбар бичнэ" data-fault-field="note" data-object-id="${object.id}" ${canReport?"":"disabled"}></td>`:""}<td><button type="button" class="icon-button fault-clear" data-clear-fault="${object.id}" title="Хадгалаагүй мөрийг цэвэрлэх" ${draft.affectedQuantity||draft.note?"":"disabled"}>×</button></td></tr>`;
  }).join("");
  const visibleObjectIds=new Set(d.assets.map(object=>object.id)),draftCount=Object.entries(state.lightingFaultDrafts).filter(([id,item])=>visibleObjectIds.has(id)&&Number(item.affectedQuantity)>0).length;
  const typeNames=new Map(types.map(type=>[type.code,type.name]));
  const history=d.incidents.length?`<details class="lighting-incident-history"><summary>Бүртгэгдсэн гэмтлийн түүх (${d.incidents.length})</summary><div class="table-panel"><table class="data-table"><thead><tr><th>Гэмтэл</th><th>Объект / байршил</th><th>Нөлөөлсөн</th><th>Зассан</th><th>Огноо</th><th>Төлөв</th></tr></thead><tbody>${d.incidents.map((x)=>`<tr><td><strong>${esc(typeNames.get(x.incident_type)||x.incident_type)}</strong><small>${esc(x.title)}</small></td><td>${esc(x.asset_name||x.location||"—")}</td><td>${x.affected_quantity}</td><td>${x.resolved_quantity}</td><td>${date(x.reported_at)}</td><td><span class="badge ${esc(x.status)}">${lightingStatus(x.status)}</span></td></tr>`).join("")}</tbody></table></div></details>`:"";
  return `<section class="lighting-fault-sheet quick"><div class="lighting-fault-toolbar"><div><h2>Гэмтлийг тоогоор хурдан бүртгэх</h2><small>Нийт шон, гэрлийн толгойгоо харж байгаад гэмтсэн нэгж болон тоог шууд сонгоно.</small></div><div class="lighting-fault-controls"><button type="button" class="secondary" data-fault-expanded>${state.lightingFaultExpanded?"Тайлбар нуух":"Тайлбар нэмэх"}</button></div></div>${canReport?"":`<div class="lighting-permission-note">Танд бүртгэлийг харах эрх байна. Шинэ гэмтэл хадгалах <code>operational-incidents.report</code> эрх олгогдоогүй.</div>`}<form id="lightingFaultBatchForm"><div class="lighting-fault-scroll"><table class="data-table lighting-fault-table lighting-quick-fault-table"><thead><tr><th class="fault-object-cell">Код / объект</th><th>Нийт шон</th><th>Нийт толгой</th><th>Гэрлийн төрөл</th><th>Гэмтэл</th>${state.lightingFaultExpanded?"<th>Тайлбар</th>":""}<th></th></tr></thead><tbody>${rows}</tbody></table></div>${canReport?`<div class="lighting-fault-save"><span><b>${draftCount}</b> мөр бэлэн</span><small>0 бол шинэ гэмтэл нэмэхгүй. Хадгалах үед эрх, нийт тоо, давхардал дахин шалгагдаж audit үүснэ.</small><button class="primary" ${!draftCount||state.lightingFaultSaving?"disabled":""}>${state.lightingFaultSaving?"Хадгалж байна…":"Шалгаж хадгалах"}</button></div>`:""}</form></section>${history}`;
}
function lightingOutcome(x) {
  if (!Number(x.measurement_item_count))
    return `<span class="lighting-outcome unknown">Хэмжилт тодорхойлоогүй</span>`;
  const planned = Number(x.planned_quantity),
    done = Number(x.completed_quantity),
    unresolved = Number(x.unresolved_quantity),
    deferred = Number(x.deferred_quantity);
  return `<span class="lighting-outcome"><b>${done}/${planned} гүйцэтгэсэн</b>${unresolved ? `<small>${unresolved} шийдэгдээгүй</small>` : ""}${deferred ? `<small>${deferred} хойшлуулсан</small>` : ""}${Number(x.exception_pending) ? `<small>${x.exception_pending} үл хамаарах нөхцөл батлуулах</small>` : ""}</span>`;
}
function lightingWork(d) {
  return `<div class="work-source-note"><span>Эдгээр нь тусдаа урсгал биш. Нэгдсэн Ажлын самбараас зөвхөн гэрэлтүүлэгтэй холбоотой ажил, объект, бодит үр дүнг харуулж байна.</span><button class="secondary" data-go="work-orders">Ажлын самбар нээх →</button></div><div class="table-panel">${d.workOrders.length ? `<table class="data-table"><thead><tr><th>Ажил</th><th>Ашиглалтын объект</th><th>Хариуцагч</th><th>Бодит үр дүн</th><th>Одоогийн шат</th></tr></thead><tbody>${d.workOrders.map((x) => `<tr><td><button class="work-link" data-history-id="${x.id}">${esc(x.title)}</button><small>${esc(x.department_name || "—")} · ${date(x.due_at)}</small></td><td>${esc(x.asset_name || x.asset_code || "—")}</td><td>${esc(x.assigned_name || "—")}</td><td>${lightingOutcome(x)}</td><td><span class="badge ${esc(x.status)}">${lightingStatus(x.workflow_stage || x.status)}</span></td></tr>`).join("")}</tbody></table>` : empty("Гэрэлтүүлгийн ажил алга", "Гэмтэл, үзлэг эсвэл төлөвлөгөөнөөс хэмжигдэх үр дүнтэй ажил үүсгэнэ.")}</div>`;
}
function lightingOperations(d) {
  const hasMeter = d.assets.filter((x) =>
      String(x.metadata?.meterNo || "").trim(),
    ).length,
    hasGps = d.assets.filter((x) => {
      const gps = x.metadata?.gps;
      return Boolean(
        gps &&
          (typeof gps === "string"
            ? gps.trim()
            : gps.lat || gps.latitude || gps.lng || gps.longitude),
      );
    }).length,
    lights = d.assets.reduce(
      (sum, x) =>
        sum + Number(x.metadata?.totalHeadCount ?? x.metadata?.headCount ?? 0),
      0,
    );
  return `<div class="lighting-stat-grid">${stat("Ашиглалтын бүртгэл", d.assets.length, "Объект, шугам, хэсгийн бүртгэл", "◇", "blue")}${stat("Гэрэл / толгой", lights, "Бүртгэлд байгаа тоо хэмжээ", "◉", "green")}${stat("Тоолуурын дугаартай", hasMeter, `${d.assets.length ? Math.round((hasMeter / d.assets.length) * 100) : 0}% бүрдэлт`, "▥", "purple")}${stat("Байршилтай", hasGps, `${d.assets.length ? Math.round((hasGps / d.assets.length) * 100) : 0}% GPS бүрдэлт`, "⌖", "blue")}</div><section class="panel lighting-next-connection"><div class="panel-head"><div><h2>Дараагийн ашиглалтын холболт</h2><small>Хуучин ERP-д байсан боловч OVERVA-д хараахан эрх мэдэлтэй өгөгдөл болоогүй хэсгүүд</small></div></div><div class="lighting-connection-grid"><article><span>⏱</span><div><strong>Асалтын хуваарь</strong><small>Өнөөдрийн хүчинтэй асаах, унтраах цаг ба өөрчлөлтийн түүх</small></div></article><article><span>▥</span><div><strong>Сарын тоолуурын уншилт</strong><small>Цэг бүрийн заалт, хэрэглээ, баталгаажуулалт</small></div></article><article><span>₮</span><div><strong>Цахилгааны төлбөр</strong><small>Нэхэмжлэл, шалгалт, төлөлтийн хяналт</small></div></article></div><p>Эдгээрийг хуучин системээс шууд live уншихгүй. Эх өгөгдөл, хариуцагч, баталгаажуулалтын дүрмийг нь тогтоогоод дараагийн үе шатанд холбоно.</p></section>`;
}
function lightingReports(d) {
  const measured = d.workOrders.filter(
      (x) => Number(x.measurement_item_count) > 0,
    ),
    planned = measured.reduce(
      (sum, x) => sum + Number(x.planned_quantity || 0),
      0,
    ),
    completed = measured.reduce(
      (sum, x) => sum + Number(x.completed_quantity || 0),
      0,
    ),
    unresolved = measured.reduce(
      (sum, x) => sum + Number(x.unresolved_quantity || 0),
      0,
    ),
    deferred = measured.reduce(
      (sum, x) => sum + Number(x.deferred_quantity || 0),
      0,
    ),
    completion = planned ? Math.round((completed / planned) * 100) : 0;
  return `<div class="lighting-stat-grid">${stat("Хэмжигдэх ажил", measured.length, "Тоо хэмжээгээр баталгаажих ажил", "▥", "blue")}${stat("Гүйцэтгэл", `${completion}%`, `${completed}/${planned || 0} нэгж гүйцэтгэсэн`, "✓", "green")}${stat("Шийдэгдээгүй", unresolved, "Шалтгаан, дараагийн арга хэмжээ шаардлагатай", "!", "red")}${stat("Хойшлуулсан", deferred, "Батлагдсан үл хамаарах нөхцөлтэй", "↗", "purple")}</div><section class="panel"><div class="panel-head"><div><h2>Гэрэлтүүлгийн тайлангийн эх өгөгдөл</h2><small>Энэ тайлан зөвхөн гэрэлтүүлгийн объект, гэмтэл, ажлын урсгалаас бүрдэнэ.</small></div></div>${measured.length ? lightingWork({ ...d, workOrders: measured }) : empty("Хэмжигдэх үр дүн бүртгээгүй", "Ажлыг дурын хувиар биш, төлөвлөсөн / гүйцэтгэсэн / шийдэгдээгүй / хойшлуулсан тоогоор бүртгэнэ.")}</section>`;
}
function lightingView() {
  const d = state.lightingWorkspace;
  if (state.lightingLoading && !d)
    return `${header("ГЭРЭЛТҮҮЛГИЙН ҮЙЛ АЖИЛЛАГАА", "Гэрэлтүүлгийн ажлын талбар", "Объект, гэмтэл, ажил болон батлах урсгалыг ачаалж байна...")}<div class="unified-loading"><i></i><span>Мэдээлэл ачаалж байна</span></div>`;
  if (!d)
    return `${header("ГЭРЭЛТҮҮЛГИЙН ҮЙЛ АЖИЛЛАГАА", "Гэрэлтүүлгийн ажлын талбар", "Мэдээлэл ачаалагдаагүй байна.", '<button class="secondary" id="lightingRefresh">↻ Дахин ачаалах</button>')}`;
  if (!d.available)
    return `${header("ГЭРЭЛТҮҮЛГИЙН ҮЙЛ АЖИЛЛАГАА", "Гэрэлтүүлгийн ажлын талбар", "Энэ байгууллагад гэрэлтүүлгийн ажлын төрөл тохируулаагүй байна.")}`;
  const scoped = lightingScoped(d);
  const scopedBody =
    state.lightingTab === "assets"
      ? lightingAssets(scoped)
      : state.lightingTab === "incidents"
        ? lightingIncidents(scoped)
        : state.lightingTab === "work"
          ? lightingWork(scoped)
          : state.lightingTab === "operations"
            ? lightingOperations(scoped)
            : state.lightingTab === "reports"
              ? lightingReports(scoped)
              : lightingOverview(scoped);
  return `${header("ГЭРЭЛТҮҮЛГИЙН ҮЙЛ АЖИЛЛАГАА", "Гэрэлтүүлгийн ажлын талбар", "Цэлмэг инженер болон хэсгүүдийн объект → асуудал → ажил → нотолгоо → ХАБЭА → баталгаажуулалтын мэргэжлийн харагдац.", '<button class="secondary" id="lightingRefresh">↻ Шинэчлэх</button>')}${lightingTabs()}${lightingAreaNavigation(d)}${scopedBody}`;
}
async function loadLighting(force = false) {
  if (state.lightingLoading || (state.lightingWorkspace && !force)) return;
  state.lightingLoading = true;
  try {
    state.lightingWorkspace = await api("/api/lighting/workspace");
  } catch (error) {
    toast(error.message, true);
  } finally {
    state.lightingLoading = false;
    if (state.view === "lighting") render();
  }
}
function dossierEventName(type) {
  return type === "component_assigned"
    ? "Бүрэлдэхүүн хөрөнгө оноосон"
    : type === "component_removed"
      ? "Бүрэлдэхүүнээс хассан"
      : type === "updated"
        ? "Үндсэн мэдээлэл зассан"
        : type === "retired"
          ? "Объектыг архивласан"
          : type === "specification_changed"
            ? "Техникийн үзүүлэлтийн шинэ хувилбар"
            : type === "media_added"
              ? "Зураг / схем нэмсэн"
              : "Тэмдэглэл нэмсэн";
}
function lightingLampRow(item={}) {
  return `<div class="lighting-spec-row lamp-spec-row"><label>Толгойн төрөл<input data-lamp-field="lampType" maxlength="80" value="${esc(item.lamp_type||item.lampType||"")}" placeholder="Жишээ: LED"></label><label>Чадал (W)<input data-lamp-field="wattageW" type="number" min="0.01" max="100000" step="0.01" value="${esc(item.wattage_w||item.wattageW||"")}" required></label><label>Толгойн тоо<input data-lamp-field="headCount" type="number" min="1" max="1000000" step="1" value="${esc(item.head_count||item.headCount||"")}" required></label><button type="button" class="icon-button" data-remove-spec-row title="Мөр хасах">×</button></div>`;
}
function lightingSupplyRow(item={},assets=[]) {
  const options=(selected)=>`<option value="">Хөрөнгөтэй холбохгүй</option>${assets.map(asset=>`<option value="${asset.id}" ${asset.id===selected?"selected":""}>${esc(asset.asset_code)} · ${esc(asset.asset_name)}</option>`).join("")}`;
  return `<div class="lighting-supply-row"><div class="lighting-spec-row"><label>Тэжээлийн цэг / щитийн нэр<input data-supply-field="name" maxlength="200" value="${esc(item.name||"")}" placeholder="Жишээ: Щит 1" required></label><label>Щитийн үндсэн хөрөнгө<select data-supply-field="panelAssetId">${options(item.panel_asset_id||item.panelAssetId)}</select></label><label>Щитийн код / тайлбар<input data-supply-field="panelReference" maxlength="200" value="${esc(item.panel_reference||item.panelReference||"")}" placeholder="Жишээ: ШС-01"></label><button type="button" class="icon-button" data-remove-spec-row title="Цэг хасах">×</button></div><div class="lighting-spec-row"><label>Тоолуурын үндсэн хөрөнгө<select data-supply-field="meterAssetId">${options(item.meter_asset_id||item.meterAssetId)}</select></label><label>Тоолуурын дугаар<input data-supply-field="meterNumber" maxlength="200" value="${esc(item.meter_number||item.meterNumber||"")}"></label><label>Өргөрөг (latitude)<input data-supply-field="latitude" type="number" min="-90" max="90" step="0.000001" value="${esc(item.latitude??"")}"></label><label>Уртраг (longitude)<input data-supply-field="longitude" type="number" min="-180" max="180" step="0.000001" value="${esc(item.longitude??"")}"></label><label class="wide-field">Байршлын тайлбар<input data-supply-field="locationNote" maxlength="500" value="${esc(item.location_note||item.locationNote||"")}"></label></div></div>`;
}
function cameraDeviceRow(item={}) {
  return `<div class="camera-device-row"><div class="camera-device-fields"><label>Камерын төрөл<input data-camera-device-field="deviceType" maxlength="100" value="${esc(item.device_type||item.deviceType||"")}" placeholder="Жишээ: Суурин, dome, PTZ" required></label><label>Үйлдвэрлэгч<input data-camera-device-field="manufacturer" maxlength="120" value="${esc(item.manufacturer||"")}"></label><label>Загвар<input data-camera-device-field="model" maxlength="160" value="${esc(item.model||"")}"></label><label>Тоо<input data-camera-device-field="quantity" type="number" min="1" max="1000" step="1" value="${esc(item.quantity||1)}" required></label><label>Нягтаршил (MP)<input data-camera-device-field="resolutionMp" type="number" min="0.01" max="1000" step="0.01" value="${esc(item.resolution_mp??item.resolutionMp??"")}"></label><label>Дуран (mm)<input data-camera-device-field="lensMm" type="number" min="0.01" max="10000" step="0.01" value="${esc(item.lens_mm??item.lensMm??"")}"></label><label>Холболт<input data-camera-device-field="connectivity" maxlength="100" value="${esc(item.connectivity||"")}" placeholder="Жишээ: IP / fiber"></label><label>Тэжээл<input data-camera-device-field="powerSource" maxlength="100" value="${esc(item.power_source||item.powerSource||"")}" placeholder="Жишээ: PoE"></label><label class="camera-check"><input data-camera-device-field="supportsPtz" type="checkbox" ${item.supports_ptz||item.supportsPtz?"checked":""}> PTZ</label><label class="camera-check"><input data-camera-device-field="nightVision" type="checkbox" ${item.night_vision||item.nightVision?"checked":""}> Шөнийн харалт</label><label class="wide-field">Нэмэлт тайлбар<input data-camera-device-field="note" maxlength="1000" value="${esc(item.note||"")}"></label><button type="button" class="icon-button" data-remove-camera-device title="Камерын мөр хасах">×</button></div></div>`;
}
function cameraPointRow(item={},allDevices=[]) {
  const pointId=item.id||item.clientId||"",devices=allDevices.filter(device=>(device.camera_point_id||device.cameraPointId)===pointId);
  return `<div class="camera-point-row"><div class="camera-point-head"><strong>Камерын шон / цэг</strong><button type="button" class="icon-button" data-remove-camera-point title="Цэг хасах">×</button></div><div class="camera-point-fields"><label>Цэгийн нэр<input data-camera-point-field="name" maxlength="200" value="${esc(item.name||"")}" placeholder="Жишээ: Уулзварын баруун шон" required></label><label>Шон / цэгийн код<input data-camera-point-field="poleReference" maxlength="200" value="${esc(item.pole_reference||item.poleReference||"")}"></label><label>Өргөрөг (latitude)<input data-camera-point-field="latitude" type="number" min="-90" max="90" step="0.000001" value="${esc(item.latitude??"")}"></label><label>Уртраг (longitude)<input data-camera-point-field="longitude" type="number" min="-180" max="180" step="0.000001" value="${esc(item.longitude??"")}"></label><label class="wide-field">Байршлын тайлбар<input data-camera-point-field="locationNote" maxlength="500" value="${esc(item.location_note||item.locationNote||"")}"></label></div><div class="camera-device-head"><div><b>Энэ шон / цэг дээрх камер</b><small>Ижил үзүүлэлттэй камерыг нэг мөрөнд тоогоор бүртгэнэ.</small></div><button type="button" class="secondary" data-add-camera-device>+ Камерын мөр</button></div><div class="camera-device-rows">${devices.length?devices.map(cameraDeviceRow).join(""):cameraDeviceRow()}</div></div>`;
}
function lightingDossierHtml(d) {
  const o = d.item,
    active = d.components.filter((x) => !x.removed_at),
    history = d.components.filter((x) => x.removed_at);
  const edit = d.capabilities.canUpdate && o.status !== "retired"
    ? `<section class="dossier-section"><h3>Объектын үндсэн мэдээлэл</h3><p>Код ба төрөл нь тогтвортой таних мэдээлэл тул эндээс өөрчлөгдөхгүй. Нэр, байршлын засвар бүр audit түүхэнд хадгалагдана.</p><form id="dossierObjectEditForm" class="dossier-form"><div class="dossier-form-grid"><label>Код<input value="${esc(o.display_code || o.code)}" disabled></label><label>Объектын төрөл<input value="${esc(o.object_type)}" disabled></label><label>Нэр<input name="name" value="${esc(o.name)}" maxlength="200" required></label><label>Байршил<input name="location" value="${esc(o.location || "")}" maxlength="500"></label></div><input name="linearLengthM" type="hidden" value="${esc(o.linear_length_m ?? "")}"><input name="expectedVersion" type="hidden" value="${esc(o.version)}"><button class="primary">Өөрчлөлт хадгалах</button></form></section>`
    : `<section class="dossier-section"><h3>Объектын үндсэн мэдээлэл</h3><p>Энэ мэдээллийг засах эрх олгогдоогүй байна.</p></section>`;
  const linkedAssets=active.filter((item,index,list)=>list.findIndex(other=>other.asset_id===item.asset_id)===index);
  const canonicalHeads=(d.lampGroups||[]).reduce((sum,item)=>sum+Number(item.head_count),0);
  const lightingTechnical=d.capabilities.canUpdate&&o.status!=="retired"
    ? `<section class="dossier-section"><div class="dossier-section-heading"><div><h3>Техникийн үзүүлэлт</h3><p>${o.current_specification_id?`Canonical хувилбар ${esc(o.specification_version)}`:"Хуучин эхийн тоог reference болгон харуулж байна. Хадгалсны дараа хянасан canonical хувилбар үүснэ."}</p></div><span class="classification-state ${o.current_specification_id?"":"legacy_candidate"}">${o.current_specification_id?"Canonical":"Эх өгөгдөл"}</span></div><div class="lighting-technical-summary"><span><b>${esc(o.current_specification_id?o.specification_pole_count:(o.legacy_pole_count??"—"))}</b> шон</span><span><b>${esc(o.current_specification_id?canonicalHeads:(o.legacy_total_head_count??"—"))}</b> нийт толгой</span><span><b>${(d.supplyPoints||[]).length}</b> тэжээлийн цэг / щит</span><span><b>${(d.supplyPoints||[]).filter(point=>point.meter_number||point.meter_asset_id).length}</b> тоолуур</span></div><form id="dossierTechnicalForm" class="dossier-form"><div class="dossier-form-grid"><label>Нийт шон<input name="poleCount" type="number" min="0" max="1000000" step="1" value="${esc(o.current_specification_id?o.specification_pole_count:(o.legacy_pole_count??0))}" required></label><label>Шугамын урт (м)<input name="linearLengthM" type="number" min="0" max="1000000000" step="0.01" value="${esc(o.linear_length_m??"")}"></label><label>Өөрчлөлтийн тайлбар<input name="note" maxlength="2000" placeholder="Хэмжилт, паспорт эсвэл засварын үндэслэл"></label></div><div class="lighting-spec-block"><div class="lighting-spec-heading"><div><h4>Гэрлийн толгой — чадлаар</h4><small>Нийт толгой нь доорх мөрүүдийн нийлбэрээр автоматаар бодогдоно.</small></div><button type="button" class="secondary" data-add-lamp-row>+ Чадлын мөр</button></div><div id="lightingLampRows">${(d.lampGroups||[]).map(lightingLampRow).join("")}</div></div><div class="lighting-spec-block"><div class="lighting-spec-heading"><div><h4>Тэжээлийн цэг, щит, тоолуур, GPS</h4><small>Үндсэн хөрөнгийн холбоос сонголтод зөвхөн дээр холбосон бүрэлдэхүүнүүд орно.</small></div><button type="button" class="secondary" data-add-supply-row>+ Тэжээлийн цэг</button></div><div id="lightingSupplyRows">${(d.supplyPoints||[]).map(item=>lightingSupplyRow(item,linkedAssets)).join("")}</div></div><input name="expectedObjectVersion" type="hidden" value="${esc(o.version)}"><button class="primary">Техникийн хувилбар хадгалах</button></form></section>`
    : "";
  const canonicalCameraCount=(d.cameraDevices||[]).reduce((sum,item)=>sum+Number(item.quantity),0);
  const cameraTechnical=d.capabilities.canUpdate&&o.status!=="retired"
    ? `<section class="dossier-section"><div class="dossier-section-heading"><div><h3>Камерын техникийн master</h3><p>${o.current_specification_id?`Canonical хувилбар ${esc(o.specification_version)}`:`Хуучин эхэд зөвхөн ${esc(o.legacy_camera_count||0)} камер гэсэн нийлбэр байна. Төрөл, үзүүлэлтийг инженер хянаж анхны canonical хувилбар үүсгэнэ.`}</p></div><span class="classification-state ${o.current_specification_id?"":"legacy_candidate"}">${o.current_specification_id?"Canonical":"Эх өгөгдөл"}</span></div><div class="lighting-technical-summary"><span><b>${(d.cameraPoints||[]).length}</b> шон / цэг</span><span><b>${o.current_specification_id?canonicalCameraCount:esc(o.legacy_camera_count||0)}</b> камер</span><span><b>${(d.cameraPoints||[]).filter(point=>point.latitude!==null&&point.longitude!==null).length}</b> GPS-тэй цэг</span><span><b>${(d.cameraDevices||[]).filter(device=>device.supports_ptz).reduce((sum,item)=>sum+Number(item.quantity),0)}</b> PTZ</span></div><form id="dossierCameraTechnicalForm" class="dossier-form"><div class="dossier-form-grid"><label>Өөрчлөлтийн тайлбар<input name="note" maxlength="2000" placeholder="Паспорт, талбайн хэмжилт эсвэл импортын эх сурвалж"></label></div><div class="lighting-spec-block"><div class="lighting-spec-heading"><div><h4>Шон / цэг ба камерын үзүүлэлт</h4><small>GPS нь шон/цэг дээр, камерын төрөл ба үзүүлэлт нь тухайн цэгийн дотор хадгалагдана.</small></div><button type="button" class="secondary" data-add-camera-point>+ Шон / цэг</button></div><div id="cameraPointRows">${(d.cameraPoints||[]).map(point=>cameraPointRow(point,d.cameraDevices||[])).join("")}</div></div><input name="expectedObjectVersion" type="hidden" value="${esc(o.version)}"><button class="primary">Камерын master хувилбар хадгалах</button></form></section>`
    : "";
  const technical=o.domain==="camera"?cameraTechnical:lightingTechnical;
  const componentRows = active
    .map(
      (x) =>
        `<tr><td><strong>${esc(x.asset_name)}</strong><small>${esc(x.asset_code)} · ${esc(x.asset_category)}</small></td><td>${esc(x.component_role)}</td><td>${esc(x.quantity)} ${esc(x.unit)}</td><td>${date(x.installed_at)}</td><td>${d.capabilities.canManageComponents ? `<button class="secondary dossier-remove" data-remove-component="${x.id}">Холбоос дуусгах</button>` : "—"}</td></tr>`,
    )
    .join("");
  const allocate = d.capabilities.canManageComponents && o.status !== "retired"
    ? `<form id="dossierComponentForm" class="dossier-form"><h3>Хөрөнгөөс бүрэлдэхүүн оноох</h3><div class="dossier-form-grid"><label>Хөрөнгө<select name="assetId" required><option value="">Сонгоно уу</option>${d.assetOptions
        .filter((a) => Number(a.available_quantity) > 0)
        .map(
          (a) =>
            `<option value="${a.id}" data-unit="${esc(a.allocation_unit)}" data-available="${esc(a.available_quantity)}">${esc(a.code)} · ${esc(a.name)} · үлдэгдэл ${esc(a.available_quantity)} ${esc(a.allocation_unit)}</option>`,
        )
        .join(
          "",
        )}</select></label><label>Үүрэг / төрөл<input name="componentRole" required placeholder="Жишээ: шон, кабель, тоолуур"></label><label>Тоо хэмжээ<input name="quantity" type="number" min="0.001" step="0.001" required></label><label>Нэгж<input name="unit" required readonly placeholder="Хөрөнгөөс сонгогдоно"></label><label>Суурилуулсан огноо<input name="installedAt" type="date"></label><label>Тайлбар<input name="note" placeholder="Оноолтын үндэслэл"></label></div><button class="primary">Объектод оноох</button></form>`
    : "";
  const events = d.events
    .map(
      (e) =>
        `<div class="dossier-event"><i></i><div><strong>${dossierEventName(e.event_type)}</strong><small>${esc(e.actor_name || "Систем")} · ${dateTime(e.created_at)}</small>${e.note ? `<p>${esc(e.note)}</p>` : ""}</div></div>`,
    )
    .join("");
  const mediaCards=(d.media||[]).map(item=>`<article class="lighting-media-card"><div class="lighting-media-preview"><img data-object-media-image="${item.id}" alt="${esc(item.title)}"><span>Зураг ачаалж байна…</span></div><strong>${item.relation_type==="location_scheme"?"Байршлын схем":"Ерөнхий фото"}</strong><small>${esc(item.original_name||item.title)} · ${item.size_bytes?formatBytes(Number(item.size_bytes)):"Файлгүй"} · ${dateTime(item.created_at)}</small>${item.version_id?`<button type="button" class="secondary" data-object-media-download="${item.id}" data-file-name="${esc(item.original_name)}">Татах</button>`:""}</article>`).join("");
  const media=o.domain==="lighting"?`<section class="dossier-section"><h3>Байршлын схем ба ерөнхий зураг</h3><p>Зураг бүр canonical баримт, checksum, хувилбар болон объектын холбоостой хадгалагдана. Шинэ схем оруулахад өмнөх зураг түүхэнд үлдэнэ.</p>${mediaCards?`<div class="lighting-media-grid">${mediaCards}</div>`:empty("Зураг оруулаагүй","Байршлын схем эсвэл объектын ерөнхий фотог нэмнэ.")}${d.capabilities.canManageMedia&&o.status!=="retired"?`<form id="dossierMediaForm" class="dossier-form lighting-media-form"><label>Зургийн зориулалт<select name="role"><option value="location_scheme">Байршлын схем</option><option value="site_photo">Ерөнхий фото</option></select></label><label>Зураг (JPG, PNG, WEBP · 15MB хүртэл)<input name="file" type="file" accept="image/jpeg,image/png,image/webp" required></label><button class="primary">Зураг нэмэх</button></form>`:""}</section>`:"";
  const retire = d.capabilities.canRetire && o.status !== "retired"
    ? `<section class="dossier-section dossier-retire"><h3>Объектыг бүртгэлээс хасах</h3><p>Өгөгдлийг бүр мөсөн устгахгүй. Идэвхтэй бүрэлдэхүүн холбоос болон дуусаагүй ажиллагааны бүртгэл байхгүй үед объектыг audit түүхтэй нь архивлана.</p><form id="dossierObjectRetireForm" class="dossier-note-form"><input name="reason" minlength="3" maxlength="2000" required placeholder="Архивлах шалтгаан"><input name="expectedVersion" type="hidden" value="${esc(o.version)}"><button class="danger">Архивлах</button></form></section>`
    : "";
  return `<div class="dossier-summary"><div><span>Код</span><strong>${esc(o.display_code || o.code)}</strong></div><div><span>Төрөл</span><strong>${esc(o.object_type)}</strong></div><div><span>Байршил</span><strong>${esc(o.location || "—")}</strong></div><div><span>${o.domain==="camera"?"Шон / цэг":"Шугамын урт"}</span><strong>${o.domain==="camera"?(d.cameraPoints||[]).length:(o.linear_length_m?`${esc(o.linear_length_m)} м`:"—")}</strong></div></div>${edit}${technical}
    <section class="dossier-section"><h3>Бүрэлдэхүүн хөрөнгө</h3><p>Хөрөнгийн мастер бүртгэлийг нүүлгэхгүй. Энд тухайн хөрөнгийн ямар хэсэг, хэдэн нэгж энэ объектод ашиглагдаж байгааг хугацаатай холбоно.</p>${componentRows ? `<div class="table-panel"><table class="data-table"><thead><tr><th>Хөрөнгө</th><th>Үүрэг</th><th>Хэмжээ</th><th>Суурилуулсан</th><th>Үйлдэл</th></tr></thead><tbody>${componentRows}</tbody></table></div>` : empty("Бүрэлдэхүүн оноогоогүй", o.domain==="camera"?"Камерын үндсэн хөрөнгийн холбоос энд харагдана.":"Шон, кабель, тоолуур, гэрлийн толгой зэрэг хөрөнгийг доорх маягтаар холбоно.")}${allocate}${history.length ? `<details><summary>Өмнө нь хассан холбоос (${history.length})</summary>${history.map((x) => `<p>${esc(x.asset_name)} · ${esc(x.quantity)} ${esc(x.unit)} · ${date(x.removed_at)}</p>`).join("")}</details>` : ""}</section>
    ${media}${retire}<section class="dossier-section"><h3>Өөрчлөлтийн audit түүх</h3><div class="dossier-events">${events || "<p>Өөрчлөлтийн түүх алга.</p>"}</div></section>`;
}
async function openLightingDossier(id) {
  try {
    const data = await api(`/api/lighting/objects/${id}/dossier`);
    state.lightingDossier = data;
    $("#lightingDossierTitle").textContent =
      `${data.item.display_code || data.item.code} — ${data.item.name}`;
    $("#lightingDossierBody").innerHTML = lightingDossierHtml(data);
    $("#lightingDossierDialog").showModal();
    loadLightingMediaPreviews(data);
  } catch (error) {
    toast(error.message, true);
  }
}
async function loadLightingMediaPreviews(dossier) {
  for(const url of state.lightingDossierObjectUrls)URL.revokeObjectURL(url);
  state.lightingDossierObjectUrls=[];
  await Promise.all((dossier.media||[]).filter(item=>item.version_id).map(async item=>{
    try{
      const response=await fetch(`/api/lighting/objects/${dossier.item.id}/media/${item.id}/file`,{headers:{authorization:`Bearer ${state.token}`}});
      if(!response.ok)return;
      const url=URL.createObjectURL(await response.blob());state.lightingDossierObjectUrls.push(url);
      const image=document.querySelector(`[data-object-media-image="${item.id}"]`);
      if(image){image.src=url;image.parentElement.classList.add("loaded")}
    }catch(_error){}
  }));
}
async function downloadLightingObjectMedia(button) {
  try{
    const response=await fetch(`/api/lighting/objects/${state.lightingDossier.item.id}/media/${button.dataset.objectMediaDownload}/file`,{headers:{authorization:`Bearer ${state.token}`}});
    if(!response.ok)throw new Error("Зураг татаж чадсангүй");
    const url=URL.createObjectURL(await response.blob()),link=document.createElement("a");
    link.href=url;link.download=button.dataset.fileName||"object-image";link.click();URL.revokeObjectURL(url);
  }catch(error){toast(error.message,true)}
}
async function refreshLightingDossier() {
  if (!state.lightingDossier)return;
  if(state.lightingDossier.item.domain==="camera")await openCameraDossier(state.lightingDossier.item.id);
  else await openLightingDossier(state.lightingDossier.item.id);
}
document.addEventListener("click", async (event) => {
  const tab = event.target.closest("[data-lighting-tab]"),
    area = event.target.closest("[data-lighting-area]"),
    object = event.target.closest("[data-object-dossier]"),
    remove = event.target.closest("[data-remove-component]"),
    work = event.target.closest("[data-object-work]"),
    density = event.target.closest("[data-lighting-density]"),
    zoom = event.target.closest("[data-lighting-zoom]"),
    faultStep = event.target.closest("[data-fault-step]"),
    clearFault = event.target.closest("[data-clear-fault]"),
    expanded = event.target.closest("[data-fault-expanded]"),
    addLamp = event.target.closest("[data-add-lamp-row]"),
    addSupply = event.target.closest("[data-add-supply-row]"),
    addCameraPoint = event.target.closest("[data-add-camera-point]"),
    addCameraDevice = event.target.closest("[data-add-camera-device]"),
    removeCameraPoint = event.target.closest("[data-remove-camera-point]"),
    removeCameraDevice = event.target.closest("[data-remove-camera-device]"),
    removeSpecRow = event.target.closest("[data-remove-spec-row]"),
    mediaDownload = event.target.closest("[data-object-media-download]");
  if (tab) {
    state.lightingTab = tab.dataset.lightingTab;
    render();
  }
  if (area) {
    state.lightingAreaFilter = area.dataset.lightingArea;
    render();
  }
  if (event.target.closest("#lightingRefresh")) loadLighting(true);
  if (density) {
    state.lightingFaultDensity = density.dataset.lightingDensity;
    render();
  }
  if (zoom) {
    state.lightingFaultZoom = Math.min(130, Math.max(80, state.lightingFaultZoom + Number(zoom.dataset.lightingZoom)));
    render();
  }
  if (expanded) {
    state.lightingFaultExpanded = !state.lightingFaultExpanded;
    render();
  }
  if (faultStep) {
    const input=document.querySelector(`[data-fault-field="affectedQuantity"][data-object-id="${faultStep.dataset.objectId}"]`);
    if(input){
      const maximum=Number(input.max||1000000),next=Math.min(maximum,Math.max(0,(Number(input.value)||0)+Number(faultStep.dataset.faultStep)));
      input.value=String(next);
      input.dispatchEvent(new Event("input",{bubbles:true}));
      render();
    }
  }
  if (clearFault) {
    delete state.lightingFaultDrafts[clearFault.dataset.clearFault];
    state.lightingFaultBatchKey = null;
    state.lightingFaultBatchReportedAt = null;
    render();
  }
  if(addLamp)$("#lightingLampRows").insertAdjacentHTML("beforeend",lightingLampRow());
  if(addSupply){
    const assets=(state.lightingDossier.components||[]).filter((item,index,list)=>!item.removed_at&&list.findIndex(other=>!other.removed_at&&other.asset_id===item.asset_id)===index);
    $("#lightingSupplyRows").insertAdjacentHTML("beforeend",lightingSupplyRow({},assets));
  }
  if(addCameraPoint)$("#cameraPointRows").insertAdjacentHTML("beforeend",cameraPointRow());
  if(addCameraDevice)addCameraDevice.closest(".camera-point-row").querySelector(".camera-device-rows").insertAdjacentHTML("beforeend",cameraDeviceRow());
  if(removeCameraPoint)removeCameraPoint.closest(".camera-point-row")?.remove();
  if(removeCameraDevice)removeCameraDevice.closest(".camera-device-row")?.remove();
  if(removeSpecRow)(removeSpecRow.closest(".lighting-supply-row")||removeSpecRow.closest(".lamp-spec-row"))?.remove();
  if(mediaDownload)downloadLightingObjectMedia(mediaDownload);
  if (object) openLightingDossier(object.dataset.objectDossier);
  if (work) {
    $("#lightingDossierDialog").close();
    showHistory(work.dataset.objectWork);
  }
  if (remove) {
    const note = prompt("Энэ холбоосыг дуусгах шалтгааныг бичнэ үү.");
    if (!note) return;
    try {
      await api(
        `/api/lighting/objects/${state.lightingDossier.item.id}/components/${remove.dataset.removeComponent}/remove`,
        { method: "POST", body: JSON.stringify({ note }) },
      );
      await refreshLightingDossier();
      toast("Бүрэлдэхүүний холбоосыг түүхтэй нь дуусгалаа");
    } catch (error) {
      toast(error.message, true);
    }
  }
});
document.addEventListener("change", (event) => {
  if (event.target.matches("#dossierComponentForm select[name=assetId]")) {
    const option = event.target.selectedOptions[0],
      form = event.target.form;
    form.elements.unit.value = option?.dataset.unit || "";
    form.elements.quantity.max = option?.dataset.available || "";
  }
  if(event.target.matches('[data-fault-field="incidentType"],[data-fault-field="affectedQuantity"]'))render();
});
document.addEventListener("input", (event) => {
  if (!event.target.matches("[data-fault-field]")) return;
  const objectId=event.target.dataset.objectId,field=event.target.dataset.faultField;
  const current=state.lightingFaultDrafts[objectId]||{
    rowKey:crypto.randomUUID(),
    incidentType:state.lightingWorkspace?.incidentTypes?.[0]?.code||"",
    affectedQuantity:"",
    note:""
  };
  current[field]=event.target.value;
  state.lightingFaultDrafts[objectId]=current;
  state.lightingFaultBatchKey=null;
  state.lightingFaultBatchReportedAt=null;
  const form=event.target.closest("form"),button=form?.querySelector("button.primary"),visibleObjectIds=new Set(lightingScoped(state.lightingWorkspace).assets.map(object=>object.id)),count=Object.entries(state.lightingFaultDrafts).filter(([id,item])=>visibleObjectIds.has(id)&&Number(item.affectedQuantity)>0).length;
  if(button)button.disabled=!count;
  const countElement=form?.querySelector(".lighting-fault-save span b");
  if(countElement)countElement.textContent=String(count);
  const clear=form?.querySelector(`[data-clear-fault="${objectId}"]`);
  if(clear)clear.disabled=!(current.affectedQuantity||current.note);
});
document.addEventListener("submit", async (event) => {
  if (event.target.id === "lightingFaultBatchForm") {
    event.preventDefault();
    state.lightingFaultBatchReportedAt=state.lightingFaultBatchReportedAt||new Date().toISOString();
    const visibleObjectIds=new Set(lightingScoped(state.lightingWorkspace).assets.map(object=>object.id));
    const rows=Object.entries(state.lightingFaultDrafts)
      .filter(([id,item])=>visibleObjectIds.has(id)&&Number(item.affectedQuantity)>0)
      .map(([operationalObjectId,item])=>({
        rowKey:item.rowKey,
        operationalObjectId,
        incidentType:item.incidentType||state.lightingWorkspace?.incidentTypes?.[0]?.code||"",
        affectedQuantity:Number(item.affectedQuantity),
        reportedAt:state.lightingFaultBatchReportedAt,
        note:String(item.note||"").trim()
      }));
    if(!rows.length)return;
    state.lightingFaultSaving=true;
    state.lightingFaultBatchKey=state.lightingFaultBatchKey||crypto.randomUUID();
    render();
    try {
      const result=await api("/api/lighting/incidents/batch",{
        method:"POST",
        body:JSON.stringify({idempotencyKey:state.lightingFaultBatchKey,rows})
      });
      for(const item of result.items||[])delete state.lightingFaultDrafts[item.operational_object_id];
      state.lightingFaultBatchKey=null;
      state.lightingFaultBatchReportedAt=null;
      await loadLighting(true);
      toast(`${result.items?.length||0} гэмтлийг аудиттайгаар бүртгэлээ`);
    } catch (error) {
      toast(error.message,true);
    } finally {
      state.lightingFaultSaving=false;
      if(state.view==="lighting")render();
    }
  }
  if (event.target.id === "dossierObjectEditForm") {
    event.preventDefault();
    const value = Object.fromEntries(new FormData(event.target));
    value.expectedVersion = Number(value.expectedVersion);
    value.linearLengthM = value.linearLengthM === "" ? null : Number(value.linearLengthM);
    try {
      const domain=state.lightingDossier.item.domain==="camera"?"camera":"lighting";
      await api(`/api/${domain}/objects/${state.lightingDossier.item.id}`, {
        method: "PATCH",
        body: JSON.stringify(value),
      });
      if(domain==="camera")await loadCamera(true);else await loadLighting(true);
      await refreshLightingDossier();
      toast("Объектын үндсэн мэдээллийг audit түүхтэй шинэчиллээ");
    } catch (error) {
      toast(error.message, true);
    }
  }
  if(event.target.id==="dossierTechnicalForm"){
    event.preventDefault();
    const form=event.target,scalar=Object.fromEntries(new FormData(form));
    const lampGroups=[...form.querySelectorAll(".lamp-spec-row")].map(row=>({
      lampType:row.querySelector('[data-lamp-field="lampType"]').value.trim(),
      wattageW:Number(row.querySelector('[data-lamp-field="wattageW"]').value),
      headCount:Number(row.querySelector('[data-lamp-field="headCount"]').value)
    }));
    const supplyPoints=[...form.querySelectorAll(".lighting-supply-row")].map(row=>{
      const field=name=>row.querySelector(`[data-supply-field="${name}"]`).value.trim(),numberOrNull=name=>field(name)===""?null:Number(field(name));
      return {name:field("name"),panelAssetId:field("panelAssetId")||null,panelReference:field("panelReference"),
        meterAssetId:field("meterAssetId")||null,meterNumber:field("meterNumber"),latitude:numberOrNull("latitude"),
        longitude:numberOrNull("longitude"),locationNote:field("locationNote")};
    });
    const value={expectedObjectVersion:Number(scalar.expectedObjectVersion),poleCount:Number(scalar.poleCount),
      linearLengthM:scalar.linearLengthM===""?null:Number(scalar.linearLengthM),note:String(scalar.note||"").trim(),lampGroups,supplyPoints};
    try{
      await api(`/api/lighting/objects/${state.lightingDossier.item.id}/specifications`,{method:"POST",body:JSON.stringify(value)});
      await loadLighting(true);await refreshLightingDossier();
      toast("Техникийн үзүүлэлтийн шинэ canonical хувилбарыг хадгаллаа");
    }catch(error){toast(error.message,true)}
  }
  if(event.target.id==="dossierCameraTechnicalForm"){
    event.preventDefault();
    const form=event.target,scalar=Object.fromEntries(new FormData(form));
    const points=[...form.querySelectorAll(".camera-point-row")].map(pointRow=>{
      const pointField=name=>pointRow.querySelector(`[data-camera-point-field="${name}"]`).value.trim();
      const pointNumber=name=>pointField(name)===""?null:Number(pointField(name));
      const devices=[...pointRow.querySelectorAll(".camera-device-row")].map(deviceRow=>{
        const input=name=>deviceRow.querySelector(`[data-camera-device-field="${name}"]`),text=name=>input(name).value.trim();
        const number=name=>text(name)===""?null:Number(text(name));
        return {deviceType:text("deviceType"),manufacturer:text("manufacturer"),model:text("model"),quantity:Number(text("quantity")),
          resolutionMp:number("resolutionMp"),lensMm:number("lensMm"),supportsPtz:input("supportsPtz").checked,
          nightVision:input("nightVision").checked,connectivity:text("connectivity"),powerSource:text("powerSource"),note:text("note")};
      });
      return {name:pointField("name"),poleReference:pointField("poleReference"),latitude:pointNumber("latitude"),
        longitude:pointNumber("longitude"),locationNote:pointField("locationNote"),devices};
    });
    try{
      await api(`/api/camera/objects/${state.lightingDossier.item.id}/specifications`,{method:"POST",
        body:JSON.stringify({expectedObjectVersion:Number(scalar.expectedObjectVersion),note:String(scalar.note||"").trim(),points})});
      await loadCamera(true);await refreshLightingDossier();toast("Камерын техникийн шинэ canonical хувилбарыг хадгаллаа");
    }catch(error){toast(error.message,true)}
  }
  if(event.target.id==="dossierMediaForm"){
    event.preventDefault();
    const form=event.target,data=new FormData(),file=form.elements.file.files[0],role=form.elements.role.value;
    if(!file)return;
    data.append("file",file);
    try{
      const response=await fetch(`/api/lighting/objects/${state.lightingDossier.item.id}/media/${role}`,{method:"POST",headers:{authorization:`Bearer ${state.token}`},body:data});
      const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||"Зураг upload хийж чадсангүй");
      await refreshLightingDossier();toast(role==="location_scheme"?"Байршлын схем нэмлээ":"Ерөнхий фото нэмлээ");
    }catch(error){toast(error.message,true)}
  }
  if (event.target.id === "dossierObjectRetireForm") {
    event.preventDefault();
    const value = Object.fromEntries(new FormData(event.target));
    value.expectedVersion = Number(value.expectedVersion);
    if (!confirm("Энэ объектыг бүр мөсөн устгахгүй, жагсаалтаас хасаж архивлана. Үргэлжлүүлэх үү?")) return;
    try {
      const domain=state.lightingDossier.item.domain==="camera"?"camera":"lighting";
      await api(`/api/${domain}/objects/${state.lightingDossier.item.id}/retire`, {
        method: "POST",
        body: JSON.stringify(value),
      });
      $("#lightingDossierDialog").close();
      state.lightingDossier = null;
      if(domain==="camera")await loadCamera(true);else await loadLighting(true);
      toast("Объектыг audit түүхтэй нь архивлалаа");
    } catch (error) {
      toast(error.message, true);
    }
  }
  if (event.target.id === "dossierComponentForm") {
    event.preventDefault();
    const value = Object.fromEntries(new FormData(event.target));
    value.quantity = Number(value.quantity);
    value.installedAt = value.installedAt || null;
    try {
      await api(
        `/api/lighting/objects/${state.lightingDossier.item.id}/components`,
        { method: "POST", body: JSON.stringify(value) },
      );
      await refreshLightingDossier();
      toast("Хөрөнгийг объектод оноолоо");
    } catch (error) {
      toast(error.message, true);
    }
  }
  if (event.target.id === "dossierNoteForm") {
    event.preventDefault();
    const value = Object.fromEntries(new FormData(event.target));
    try {
      await api(
        `/api/lighting/objects/${state.lightingDossier.item.id}/notes`,
        { method: "POST", body: JSON.stringify(value) },
      );
      await refreshLightingDossier();
      toast("Тэмдэглэлийг хувийн хэрэгт нэмлээ");
    } catch (error) {
      toast(error.message, true);
    }
  }
});
