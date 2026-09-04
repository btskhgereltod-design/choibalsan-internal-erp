"use strict";
state.modules = {};
state.moduleLoading = {};
Object.assign(labels, {
  structure: "Байгууллагын бүтэц",
  inventory: "Няравын ажлын талбар",
  maintenance: "Төлөвлөгөөт засвар",
  procurement: "Худалдан авалт",
  settings: "Тохиргоо",
  billing: "Багц ба төлбөр",
});
const moduleViews = new Set(["structure", "inventory", "maintenance", "procurement", "settings", "billing"]);
state.inventoryTab = state.inventoryTab || "dashboard";
const originalRender = render;
function money(value, currency = "MNT") {
  return new Intl.NumberFormat("mn-MN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}
function selectOptions(items, valueKey, labelKey, emptyLabel = "Сонгохгүй") {
  return `<option value="">${emptyLabel}</option>` + items.map((x) => `<option value="${x[valueKey]}">${esc(x[labelKey])}</option>`).join("");
}
function moduleHeader(kicker, title, desc) {
  return header(kicker, title, desc);
}
function adjustModuleNavigation() {
  if (!state.user) return;
  const role = state.user.role;
  ["structureNav", "inventoryNav", "maintenanceNav", "procurementNav"].forEach((id) => $("#" + id)?.classList.remove("hidden"));
  $("#settingsNav")?.classList.toggle("hidden", role !== "director");
  $("#billingNav")?.classList.toggle("hidden", !["director", "accountant"].includes(role));
  if (state.organization?.settings) {
    const s = state.organization.settings;
    document.documentElement.style.setProperty("--module-brand", s.primary_color || "#246bea");
    document.documentElement.style.setProperty("--module-accent", s.accent_color || "#0f9f6e");
    if (s.short_name) $("#orgName").textContent = s.short_name;
    document.querySelectorAll("#appView .brand-mark").forEach((mark) => {
      if (s.logo_url) {
        mark.style.backgroundImage = `url(${s.logo_url})`;
        mark.style.backgroundSize = "contain";
        mark.style.backgroundPosition = "center";
        mark.style.backgroundRepeat = "no-repeat";
        mark.style.color = "transparent";
      } else {
        mark.style.backgroundImage = "";
        mark.style.color = "";
      }
    });
  }
}
async function loadModule(name) {
  if (state.moduleLoading[name]) return;
  state.moduleLoading[name] = true;
  try {
    state.modules[name] = await api(`/api/modules/${name}`);
  } catch (error) {
    toast(error.message, true);
  } finally {
    state.moduleLoading[name] = false;
    if (state.view === name) render();
  }
}
render = function () {
  adjustModuleNavigation();
  if (!moduleViews.has(state.view)) return originalRender();
  const renderer = moduleRenderers[state.view];
  $("#pageContent").innerHTML = renderer();
  if (!state.modules[state.view] && !state.moduleLoading[state.view]) queueMicrotask(() => loadModule(state.view));
};

function structureView() {
  const d = state.modules.structure;
  if (!d) return moduleHeader("БАЙГУУЛЛАГА", "Бүтэц ба шатлал", "Байгууллагын нэгж, ажлын байр болон тайлагнах шугамыг ачаалж байна...");
  const typeOptions = (d.unitTypes || []).map((x) => `<option value="${esc(x.code)}">${esc(x.name)}</option>`).join("");
  return `${moduleHeader("БАЙГУУЛЛАГА", "Бүтэц ба шатлал", "Салбар, газар, хэлтэс, баг, талбай, ажлын байр болон тайлагнах шугамыг байгууллагынхаа загварт тохируулна.")}
  <div class="module-grid"><article class="module-card"><span>Байгууллагын нэгж</span><strong class="metric-number">${d.departments.length}</strong></article><article class="module-card"><span>Албан тушаал / орон тоо</span><strong class="metric-number">${d.positions.length}</strong></article><article class="module-card"><span>Ажилтан</span><strong class="metric-number">${d.people.filter((x) => x.active).length}</strong></article></div>
  ${
    ["director", "chief_engineer"].includes(state.user.role)
      ? `
  <form class="module-form" id="departmentForm"><h2>Шинэ байгууллагын нэгж</h2><small>Салбар, газар, хэлтэс, тасаг, баг, дэлгүүр, төсөл эсвэл ажлын талбай байж болно.</small><div class="module-form-grid"><label><span>Код</span><input name="code" required maxlength="40" placeholder="ENG"></label><label><span>Нэр</span><input name="name" required placeholder="Инженерийн алба"></label><label><span>Нэгжийн төрөл</span><select name="unitTypeCode" required>${typeOptions}</select></label><label><span>Дээд нэгж</span><select name="parentId">${selectOptions(d.departments, "id", "name")}</select></label></div><button class="primary" type="submit">Нэгж нэмэх</button></form>
  <form class="module-form" id="positionForm"><h2>Шинэ ажил ба орон тоо</h2><small>Ажлын нэр нь мэргэжлийг, орон тоо нь тухайн нэгж дээрх батлагдсан ажлын байрыг илэрхийлнэ.</small><div class="module-form-grid"><label><span>Код</span><input name="code" required placeholder="SEN-ENG"></label><label><span>Ажлын нэр</span><input name="title" required placeholder="Ахлах инженер"></label><label><span>Байгууллагын нэгж</span><select name="departmentId">${selectOptions(d.departments, "id", "name")}</select></label><label><span>Шатлал (1 дээд)</span><input name="rankLevel" type="number" min="1" max="20" value="5"></label><label><span>Батлагдсан орон тоо</span><input name="headcountLimit" type="number" min="1" placeholder="1"></label></div><button class="primary" type="submit">Ажил, орон тоо нэмэх</button></form>`
      : ""
  }
  <div class="module-table-wrap"><table class="module-table"><thead><tr><th>Ажилтан</th><th>Байгууллагын нэгж</th><th>Албан тушаал</th><th>Шууд удирдлага</th>${state.user.role === "director" ? "<th>Тохируулах</th>" : ""}</tr></thead><tbody>${d.people.map((p) => `<tr><td><strong>${esc(p.full_name)}</strong><small>${labels[p.role] || p.role}</small></td><td>${esc(p.department_name || "—")}</td><td>${esc(p.position_title || "—")}</td><td>${esc(p.manager_name || "—")}</td>${state.user.role === "director" ? `<td><button class="secondary" data-assign-structure="${p.id}">Засах</button></td>` : ""}</tr>`).join("")}</tbody></table></div>`;
}

function inventoryView() {
  const d = state.modules.inventory;
  if (!d) return moduleHeader("НӨӨЦИЙН УДИРДЛАГА", "Агуулах, бараа материал", "Мэдээллийг ачаалж байна...");
  const total = d.items.reduce((s, x) => s + Number(x.total_quantity), 0),
    low = d.items.filter((x) => Number(x.total_quantity) <= Number(x.minimum_stock)).length,
    can = ["director", "chief_engineer", "storekeeper"].includes(state.user.role);
  return `${moduleHeader("НӨӨЦИЙН УДИРДЛАГА", "Агуулах, бараа материал", "Орлого, зарлага, шилжүүлэг болон бодит үлдэгдэл.")}<div class="module-grid"><article class="module-card"><span>Агуулах</span><strong class="metric-number">${d.warehouses.length}</strong></article><article class="module-card"><span>Барааны нэр төрөл</span><strong class="metric-number">${d.items.length}</strong></article><article class="module-card"><span>Нийт үлдэгдэл</span><strong class="metric-number">${total}</strong></article><article class="module-card"><span>Доод түвшинд хүрсэн</span><strong class="metric-number low-stock">${low}</strong></article></div>${can ? `<div class="module-grid"><form class="module-form" id="warehouseForm"><h2>Агуулах нэмэх</h2><label><span>Код</span><input name="code" required placeholder="MAIN"></label><label><span>Нэр</span><input name="name" required placeholder="Төв агуулах"></label><label><span>Байршил</span><input name="location"></label><button class="primary">Нэмэх</button></form><form class="module-form" id="inventoryItemForm"><h2>Бараа нэмэх</h2><div class="module-form-grid"><label><span>SKU</span><input name="sku" required></label><label><span>Нэр</span><input name="name" required></label><label><span>Ангилал</span><input name="category" value="Сэлбэг" required></label><label><span>Нэгж</span><input name="unit" value="ш" required></label><label><span>Доод үлдэгдэл</span><input name="minimumStock" type="number" min="0" step="0.001" value="0"></label></div><button class="primary">Нэмэх</button></form></div><form class="module-form" id="stockMovementForm"><h2>Орлого, зарлага, шилжүүлэг</h2><div class="module-form-grid"><label><span>Бараа</span><select name="itemId" required>${selectOptions(d.items, "id", "name", "Бараа сонгоно уу")}</select></label><label><span>Гүйлгээ</span><select name="type"><option value="receipt">Орлого</option><option value="issue">Зарлага</option><option value="transfer">Шилжүүлэг</option><option value="adjustment_in">Тооллогын нэмэгдэл</option><option value="adjustment_out">Тооллогын хорогдол</option></select></label><label><span>Гарах агуулах</span><select name="fromWarehouseId">${selectOptions(d.warehouses, "id", "name")}</select></label><label><span>Орох агуулах</span><select name="toWarehouseId">${selectOptions(d.warehouses, "id", "name")}</select></label><label><span>Тоо хэмжээ</span><input name="quantity" type="number" min="0.001" step="0.001" required></label><label><span>Баримтын дугаар</span><input name="reference"></label></div><label><span>Тэмдэглэл</span><input name="note"></label><button class="primary">Гүйлгээ бүртгэх</button></form>` : ""}<div class="module-table-wrap"><table class="module-table"><thead><tr><th>SKU / Бараа</th><th>Ангилал</th><th>Үлдэгдэл</th><th>Агуулахаар</th></tr></thead><tbody>${d.items.map((i) => `<tr><td><strong>${esc(i.sku)} · ${esc(i.name)}</strong></td><td>${esc(i.category)}</td><td class="${Number(i.total_quantity) <= Number(i.minimum_stock) ? "low-stock" : ""}">${i.total_quantity} ${esc(i.unit)}<small>Доод: ${i.minimum_stock}</small></td><td>${(i.balances || []).map((b) => `${esc(b.warehouseName)}: ${b.quantity}`).join(" · ") || "—"}</td></tr>`).join("")}</tbody></table></div>`;
}

function maintenanceView() {
  const d = state.modules.maintenance;
  if (!d) return moduleHeader("ЗАСВАР ҮЙЛЧИЛГЭЭ", "Төлөвлөгөөт засвар", "Мэдээллийг ачаалж байна...");
  const can = ["director", "chief_engineer"].includes(state.user.role);
  return `${moduleHeader("ЗАСВАР ҮЙЛЧИЛГЭЭ", "Төлөвлөгөөт засвар", "Хөрөнгийн үзлэг, үйлчилгээний давтамж ба дараагийн хугацаа.")}<div class="module-grid"><article class="module-card"><span>Идэвхтэй төлөвлөгөө</span><strong class="metric-number">${d.items.filter((x) => x.active).length}</strong></article><article class="module-card"><span>Хугацаа хэтэрсэн</span><strong class="metric-number low-stock">${d.items.filter((x) => x.overdue).length}</strong></article></div>${can ? `<form class="module-form" id="maintenanceForm"><h2>Шинэ төлөвлөгөө</h2><div class="module-form-grid"><label><span>Хөрөнгө</span><select name="assetId" required>${selectOptions(state.assets, "id", "name", "Хөрөнгө сонгоно уу")}</select></label><label><span>Үйлчилгээний нэр</span><input name="title" required></label><label><span>Давтамж (хоног)</span><input name="frequencyDays" type="number" min="1" max="3650" value="30" required></label><label><span>Дараагийн огноо</span><input name="nextDueDate" type="date" required></label><label><span>Хариуцагч</span><select name="assignedTo">${selectOptions(state.assignableUsers, "id", "full_name")}</select></label></div><label><span>Заавар</span><textarea name="instructions" rows="3"></textarea></label><button class="primary">Төлөвлөгөө үүсгэх</button></form>` : ""}<div class="module-table-wrap"><table class="module-table"><thead><tr><th>Хөрөнгө</th><th>Үйлчилгээ</th><th>Давтамж</th><th>Дараагийн огноо</th><th>Хариуцагч</th><th>Үйлдэл</th></tr></thead><tbody>${d.items.map((x) => `<tr><td><strong>${esc(x.asset_code)}</strong><small>${esc(x.asset_name)}</small></td><td>${esc(x.title)}<small>${x.completion_count} удаа гүйцэтгэсэн</small></td><td>${x.frequency_days} хоног</td><td><span class="status-pill ${x.overdue ? "overdue" : ""}">${date(x.next_due_date)}</span></td><td>${esc(x.assigned_name || "—")}</td><td><button class="primary" data-complete-maintenance="${x.id}">Гүйцэтгэсэн</button></td></tr>`).join("")}</tbody></table></div>`;
}

const procurementLabels = {
  draft: "Ноорог",
  submitted: "Батлуулахаар",
  approved: "Баталсан",
  rejected: "Татгалзсан",
  ordered: "Захиалсан",
  received: "Хүлээн авсан",
  cancelled: "Цуцалсан",
};
function procurementView() {
  const d = state.modules.procurement;
  if (!d) return moduleHeader("ХУДАЛДАН АВАЛТ", "Хүсэлт ба батлах урсгал", "Мэдээллийг ачаалж байна...");
  return `${moduleHeader("ХУДАЛДАН АВАЛТ", "Хүсэлт ба батлах урсгал", "Шаардлага үүсгэхээс хүлээн авах хүртэлх хяналттай урсгал.")}<form class="module-form" id="procurementForm"><h2>Шинэ хүсэлт</h2><div class="module-form-grid"><label><span>Хүсэлтийн нэр</span><input name="title" required></label><label><span>Хэрэгтэй огноо</span><input name="neededBy" type="date"></label><label><span>Валют</span><select name="currency"><option>MNT</option><option>USD</option><option>CNY</option></select></label><label><span>Бараа, үйлчилгээ</span><input name="description" required></label><label><span>Тоо хэмжээ</span><input name="quantity" type="number" min="0.001" step="0.001" value="1" required></label><label><span>Нэгж</span><input name="unit" value="ш" required></label><label><span>Нэгж үнэ</span><input name="unitPrice" type="number" min="0" step="0.01" required></label></div><label><span>Үндэслэл</span><textarea name="justification" rows="3"></textarea></label><button class="primary">Хүсэлт илгээх</button></form><div class="module-table-wrap"><table class="module-table"><thead><tr><th>Дугаар</th><th>Хүсэлт</th><th>Дүн</th><th>Төлөв</th><th>Хүсэлт гаргасан</th><th>Үйлдэл</th></tr></thead><tbody>${d.items.map((x) => `<tr><td><strong>${esc(x.request_no)}</strong><small>${date(x.created_at)}</small></td><td>${esc(x.title)}<small>${(x.lines || []).map((l) => `${esc(l.description)} × ${l.quantity}`).join(", ")}</small></td><td>${money(x.total_amount, x.currency)}</td><td><span class="status-pill ${x.status}">${procurementLabels[x.status] || x.status}</span></td><td>${esc(x.requested_by_name || "—")}</td><td><div class="module-actions">${procurementActions(x)}</div></td></tr>`).join("")}</tbody></table></div>`;
}
function procurementActions(x) {
  if (!["director", "chief_engineer", "accountant"].includes(state.user.role)) return "";
  const map = {
    submitted: [
      ["approved", "Батлах"],
      ["rejected", "Татгалзах"],
    ],
    approved: [["ordered", "Захиалсан"]],
    ordered: [["received", "Хүлээн авсан"]],
  };
  return (map[x.status] || []).map(([a, l]) => `<button class="${a === "rejected" ? "danger" : "primary"}" data-procurement-id="${x.id}" data-procurement-action="${a}">${l}</button>`).join("");
}

async function loadDataGovernance() {
  if (state.moduleLoading.dataGovernance) return;
  state.moduleLoading.dataGovernance = true;
  try {
    state.modules.dataGovernance = await api("/api/data-governance");
  } catch (error) {
    toast(error.message, true);
  } finally {
    state.moduleLoading.dataGovernance = false;
    if (state.view === "settings" && state.settingsTab === "data") render();
  }
}
function governanceAssetOptions(items, includeAudit = true) {
  return items
    .filter((x) => includeAudit || x.code !== "audit-log")
    .map((x) => `<option value="${esc(x.code)}">${esc(x.domain)} · ${esc(x.name)}</option>`)
    .join("");
}
function dataGovernanceContent() {
  const d = state.modules.dataGovernance;
  if (!d) return `<section class="module-card"><strong>Өгөгдлийн удирдлагыг ачаалж байна...</strong><small>Lifecycle бодлого, хариуцагч, хадгалалтын хориг болон баталгаажуулалт.</small></section>`;
  const assetOptions = governanceAssetOptions(d.assets),
    dispositionAssets = governanceAssetOptions(d.assets, false);
  const domains = [...new Set(d.assets.map((x) => x.domain))].sort();
  const policyRows = d.assets.map((x) => `<tr><td><strong>${esc(x.name)}</strong><small>${esc(x.code)} · ${esc(x.classification_code)}</small></td><td>${esc(x.domain)}</td><td>${x.authoritative_system ? `<strong>${esc(x.authoritative_system)}</strong><small>${esc(x.update_policy)} · ${esc(x.history_strategy)}</small>` : "Тохируулаагүй"}</td><td>${x.policy_id ? `${x.archive_after_days || "—"} / ${x.retention_days || "—"} хоног` : "Тохируулаагүй"}</td><td>${esc(x.criticality || "standard")}<small>RPO ${x.recovery_point_minutes || "—"} / RTO ${x.recovery_time_minutes || "—"} мин</small></td><td>${x.quality_rule_count}</td></tr>`).join("");
  const holdRows = d.holds.map((x) => `<tr><td>${esc(x.asset_code)}<small>${esc(x.record_key || "Бүх бүртгэл")}</small></td><td>${esc(x.reason)}</td><td><span class="status-pill ${x.status}">${esc(x.status)}</span></td><td>${x.status === "active" ? `<button class="secondary" data-release-hold="${x.id}">Суллах</button>` : "—"}</td></tr>`).join("");
  const requestRows = d.requests.map((x) => `<tr><td>${esc(x.asset_code)}<small>${esc(x.record_key)}</small></td><td>${esc(x.requested_action)}</td><td><span class="status-pill ${x.status}">${esc(x.status)}</span></td><td>${esc(x.requested_by_name)}</td><td>${x.status === "pending" ? `<button class="primary" data-disposition-decision="approved" data-disposition-id="${x.id}">Батлах</button> <button class="danger" data-disposition-decision="rejected" data-disposition-id="${x.id}">Татгалзах</button>` : "—"}</td></tr>`).join("");
  const findingLabels = {
    open: "Нээлттэй",
    triaged: "Ангилсан",
    awaiting_owner: "Хариуцагч хүлээж байна",
    accepted_for_correction: "Засахаар баталсан",
    resolved: "Шийдвэрлэсэн",
    accepted_exception: "Онцгой нөхцөлөөр зөвшөөрсөн",
    rejected: "Татгалзсан",
  };
  const findingRows = (d.findings || []).map((x) => `<tr><td><strong>${esc(x.title)}</strong><small>${esc(x.finding_type)} · ${esc(x.source_system)}</small></td><td><span class="status-pill ${x.severity}">${esc(x.severity)}</span></td><td>${esc(x.pattern_name || x.pattern_code || "Шинэ хэв шинж")}</td><td><span class="status-pill ${x.status}">${findingLabels[x.status] || esc(x.status)}</span><small>${esc(x.assigned_employee_name || "Хариуцагч оноогоогүй")}</small></td><td>${!["resolved", "accepted_exception", "rejected"].includes(x.status) ? `<button class="secondary" data-finding-decision="triaged" data-finding-id="${x.id}">Ангилах</button> <button class="primary" data-finding-decision="accepted_for_correction" data-finding-id="${x.id}">Засахаар батлах</button> <button class="secondary" data-finding-decision="resolved" data-finding-id="${x.id}">Шийдвэрлэх</button>` : "—"}</td></tr>`).join("");
  return `<div class="governance-notice"><strong>AI болон импорт өгөгдлийг чимээгүй засахгүй.</strong><span>Зөрчлийг кейс болгон хадгалж, эх сурвалжийг хамгаалан, зөвлөмж гаргаж, эрх бүхий хүн баталсны дараа canonical мэдээлэлд тусдаа үйлдлээр өөрчлөлт хийнэ.</span></div>
  <div class="module-grid"><article class="module-card"><span>Нээлттэй асуудал</span><strong class="metric-number">${d.summary.openFindings || 0}</strong></article><article class="module-card"><span>Өндөр эрсдэлтэй</span><strong class="metric-number low-stock">${d.summary.highRiskFindings || 0}</strong></article><article class="module-card"><span>Шийдвэрлэсэн</span><strong class="metric-number">${d.summary.resolvedFindings || 0}</strong></article><article class="module-card"><span>Дүрэм болгох нэр дэвшигч</span><strong class="metric-number">${d.summary.learningCandidates || 0}</strong></article></div>
  <form class="module-form" id="dataFindingForm"><h2>Өгөгдлийн асуудал бүртгэх</h2><small>Энд нууц болон түүхий мөр хуулж тавихгүй. Хаана, ямар утгын зөрчил илэрсэн, бизнест яаж нөлөөлөхийг бүртгэнэ.</small><div class="module-form-grid"><label><span>Кейсийн түлхүүр</span><input name="fingerprint" required minlength="8" maxlength="160" pattern="[a-z0-9][a-z0-9._:-]+" placeholder="legacy-employee-duplicate"></label><label><span>Өгөгдлийн объект</span><select name="assetCode"><option value="">Каталогтой холбохгүй</option>${assetOptions}</select></label><label><span>Entity төрөл</span><input name="entityType" required placeholder="employee, work_order, operational_object"></label><label><span>Асуудлын төрөл</span><select name="findingType"><option value="semantic_mismatch">Утга, ангиллын зөрүү</option><option value="duplicate">Давхардал</option><option value="missing_reference">Хамаарах бүртгэл дутуу</option><option value="invalid_value">Буруу утга</option><option value="ambiguous_definition">Тодорхойлолт ойлгомжгүй</option><option value="relationship_gap">Хамаарал дутуу</option><option value="measurement_gap">Хэмжилтийн суурь дутуу</option><option value="ownership_gap">Эзэн / эх сурвалж тодорхойгүй</option><option value="lineage_gap">Өгөгдлийн замнал дутуу</option><option value="other">Бусад</option></select></label><label><span>Эрсдэл</span><select name="severity"><option value="medium">Дунд</option><option value="high">Өндөр</option><option value="critical">Маш өндөр</option><option value="low">Бага</option><option value="info">Мэдээлэл</option></select></label><label><span>Эх систем</span><input name="sourceSystem" value="OVERVA" required></label></div><label><span>Гарчиг</span><input name="title" required maxlength="240"></label><label><span>Юу зөрсөн бэ?</span><textarea name="description" required maxlength="4000" rows="3"></textarea></label><div class="module-form-grid"><label><span>Бизнесийн нөлөө</span><textarea name="businessImpact" maxlength="4000" rows="3"></textarea></label><label><span>Санал болгож буй шийдэл</span><textarea name="recommendation" maxlength="4000" rows="3"></textarea></label></div><label class="check-row"><input name="learningCandidate" type="checkbox"> Дараагийн импортод дахин илрүүлэх дүрмийн нэр дэвшигч болгох</label><button class="primary">Асуудал бүртгэх</button></form>
  <div class="module-table-wrap"><h2>Өгөгдлийн асуудлын дараалал</h2><table class="module-table"><thead><tr><th>Асуудал</th><th>Эрсдэл</th><th>Хэв шинж</th><th>Төлөв / хариуцагч</th><th>Хүний шийдвэр</th></tr></thead><tbody>${findingRows || '<tr><td colspan="5">Бүртгэгдсэн өгөгдлийн асуудал алга.</td></tr>'}</tbody></table></div>
  <div class="governance-notice"><strong>Өгөгдлийг автоматаар устгахгүй.</strong><span>Бүх архивлах, нэргүйжүүлэх, устгах хүсэлт заавал баталгаажна. Идэвхтэй legal hold байвал батлах боломжгүй.</span></div>
  <div class="module-grid"><article class="module-card"><span>Каталогийн объект</span><strong class="metric-number">${d.summary.catalogAssets}</strong></article><article class="module-card"><span>Эх сурвалж тогтоосон</span><strong class="metric-number">${d.summary.architectureConfigured}</strong></article><article class="module-card"><span>Бодлоготой</span><strong class="metric-number">${d.summary.configuredPolicies}</strong></article><article class="module-card"><span>Хориг / хүсэлт</span><strong class="metric-number">${d.summary.activeHolds} / ${d.summary.pendingRequests}</strong></article></div>
  <form class="module-form" id="dataArchitectureForm"><h2>Эх сурвалж ба найдвартай ажиллагаа</h2><small>Аль систем албан ёсны эх сурвалж болох, хаанаас өөрчлөх, түүх болон сэргээх шаардлагыг өгөгдлийн объект бүрээр тогтооно. Энэ тохиргоо физик өгөгдлийн сангийн бүтцийг өөрчлөхгүй.</small><div class="module-form-grid"><label><span>Өгөгдлийн объект</span><select name="assetCode" required>${assetOptions}</select></label><label><span>Албан ёсны эх сурвалж</span><input name="authoritativeSystem" required maxlength="200" value="OVERVA" placeholder="OVERVA эсвэл гаднын системийн нэр"></label><label><span>Өөрчлөх дүрэм</span><select name="updatePolicy"><option value="overva_only">Зөвхөн OVERVA</option><option value="source_only">Зөвхөн эх систем</option><option value="bidirectional">Хоёр чиглэлтэй</option><option value="manual_review">Гараар баталгаажуулах</option></select></label><label><span>Түүх хадгалах</span><select name="historyStrategy"><option value="audit">Audit</option><option value="event">Event history</option><option value="snapshot">Snapshot</option><option value="archive">Archive</option><option value="none">Тусгай түүхгүй</option></select></label><label><span>Чухлын түвшин</span><select name="criticality"><option value="standard">Ердийн</option><option value="important">Чухал</option><option value="critical">Маш чухал</option></select></label><label><span>Хүртээмж</span><select name="availabilityClass"><option value="standard">Ердийн</option><option value="high">Өндөр</option><option value="mission_critical">Тасралтгүй чухал</option></select></label><label><span>RPO (минут)</span><input name="recoveryPointMinutes" type="number" min="1" placeholder="Алдаж болох өгөгдлийн хугацаа"></label><label><span>RTO (минут)</span><input name="recoveryTimeMinutes" type="number" min="1" placeholder="Сэргээх зорилтот хугацаа"></label><label><span>Архивын түвшин</span><select name="archiveTier"><option value="standard">Ердийн</option><option value="warm">Шуурхай архив</option><option value="cold">Урт хугацааны архив</option><option value="offline">Offline хамгаалалт</option></select></label></div><label><span>Тайлбар</span><textarea name="notes" maxlength="2000" rows="2"></textarea></label><button class="primary">Архитектурын тохиргоо хадгалах</button></form>
  <div class="module-grid governance-grid">
    <form class="module-form" id="dataPolicyForm"><h2>Lifecycle бодлого</h2><small>Архивлах болон нийт хадгалах хугацааг хоногоор заана. Баталгаажуулалт үргэлж заавал байна.</small><label><span>Өгөгдлийн объект</span><select name="assetCode" required>${assetOptions}</select></label><label><span>Бодлогын нэр</span><input name="name" required placeholder="Ажилтны мэдээлэл хадгалах бодлого"></label><div class="module-form-grid"><label><span>Архивлах (хоног)</span><input name="archiveAfterDays" type="number" min="1"></label><label><span>Хадгалах (хоног)</span><input name="retentionDays" type="number" min="1"></label><label><span>Хугацааны төгсгөлийн үйлдэл</span><select name="dispositionAction"><option value="review">Гараар хянах</option><option value="archive">Архивлах</option><option value="anonymize">Нэргүйжүүлэх</option><option value="delete">Устгах хүсэлт</option></select></label></div><button class="primary">Бодлого хадгалах</button></form>
    <form class="module-form" id="dataStewardForm"><h2>Өгөгдөл хариуцагч</h2><small>Стандарт, чанар болон ашиглалтыг тухайн domain дээр хэн хариуцахыг тогтооно.</small><label><span>Domain</span><select name="domain">${domains.map((x) => `<option>${esc(x)}</option>`).join("")}</select></label><label><span>Хариуцагч ажилтан</span><select name="employeeId" required>${selectOptions(d.employees, "id", "full_name", "Ажилтан сонгоно уу")}</select></label><button class="primary">Хариуцагч оноох</button><div class="governance-stewards">${domains
      .map((domain) => {
        const s = d.stewards.find((x) => x.domain === domain);
        return `<span><b>${esc(domain)}</b>: ${esc(s?.employee_name || "Оноогоогүй")}</span>`;
      })
      .join("")}</div></form>
  </div>
  <div class="module-table-wrap"><table class="module-table"><thead><tr><th>Өгөгдөл</th><th>Domain</th><th>Албан ёсны эх сурвалж</th><th>Архив / хадгалалт</th><th>Чухал байдал</th><th>Чанарын дүрэм</th></tr></thead><tbody>${policyRows}</tbody></table></div>
  <div class="module-grid governance-grid">
    <form class="module-form" id="dataHoldForm"><h2>Хадгалалтын хориг (Legal hold)</h2><label><span>Өгөгдлийн объект</span><select name="assetCode">${assetOptions}</select></label><label><span>Бүртгэлийн түлхүүр</span><input name="recordKey" placeholder="Хоосон бол бүх объектод үйлчилнэ"></label><label><span>Үндэслэл</span><textarea name="reason" required rows="3"></textarea></label><button class="primary">Хориг тавих</button></form>
    <form class="module-form" id="dataDispositionForm"><h2>Архивлах / устгах хүсэлт</h2><small>Баталсан ч өгөгдөл шууд устахгүй; execution тусдаа хяналттай шат байна.</small><label><span>Өгөгдлийн объект</span><select name="assetCode">${dispositionAssets}</select></label><label><span>Бүртгэлийн түлхүүр</span><input name="recordKey" required></label><label><span>Хүсэх үйлдэл</span><select name="requestedAction"><option value="archive">Архивлах</option><option value="anonymize">Нэргүйжүүлэх</option><option value="delete">Устгах</option></select></label><label><span>Үндэслэл</span><textarea name="reason" required rows="3"></textarea></label><button class="primary">Хүсэлт үүсгэх</button></form>
  </div>
  <div class="module-table-wrap"><h2>Хадгалалтын хориг</h2><table class="module-table"><thead><tr><th>Объект</th><th>Үндэслэл</th><th>Төлөв</th><th>Үйлдэл</th></tr></thead><tbody>${holdRows || '<tr><td colspan="4">Хадгалалтын хориг алга.</td></tr>'}</tbody></table></div>
  <div class="module-table-wrap"><h2>Disposition хүсэлт</h2><table class="module-table"><thead><tr><th>Объект</th><th>Үйлдэл</th><th>Төлөв</th><th>Хүссэн</th><th>Шийдвэр</th></tr></thead><tbody>${requestRows || '<tr><td colspan="5">Хүсэлт алга.</td></tr>'}</tbody></table></div>`;
}

function settingsView() {
  const tab = state.settingsTab || "organization";
  const tabs = `<div class="settings-tabs" role="tablist">
    <button type="button" role="tab" aria-selected="${tab === "start"}" class="${tab === "start" ? "active" : ""}" data-settings-tab="start">◎ Эхлүүлэх тохиргоо</button>
    <button type="button" role="tab" aria-selected="${tab === "organization"}" class="${tab === "organization" ? "active" : ""}" data-settings-tab="organization">🏢 Байгууллага</button>
    <button type="button" role="tab" aria-selected="${tab === "structure"}" class="${tab === "structure" ? "active" : ""}" data-settings-tab="structure">♧ Бүтэц ба шатлал</button>
    <button type="button" role="tab" aria-selected="${tab === "access"}" class="${tab === "access" ? "active" : ""}" data-settings-tab="access">🔐 Нэвтрэх эрх</button>
    <button type="button" role="tab" aria-selected="${tab === "audit"}" class="${tab === "audit" ? "active" : ""}" data-settings-tab="audit">◎ Аудит журнал</button>
    <button type="button" role="tab" aria-selected="${tab === "data"}" class="${tab === "data" ? "active" : ""}" data-settings-tab="data">▦ Өгөгдлийн удирдлага</button>
    ${(state.permissions||[]).includes("connectors.manage")?`<button type="button" role="tab" aria-selected="${tab === "integrations"}" class="${tab === "integrations" ? "active" : ""}" data-settings-tab="integrations">⌁ Холболт, интеграц</button>`:""}
  </div>`;
  if (tab === "start") return `${moduleHeader("ТОХИРГОО", "Эхлүүлэх тохиргоо", "Байгууллагын суурь орчныг дарааллаар нь бэлтгэж, явцыг нэг дор хянана.")}${tabs}${startSettingsContent()}`;
  if (tab === "structure") return `${moduleHeader("ТОХИРГОО", "Системийн тохиргоо", "Байгууллагын бүтэц, албан тушаал, нэвтрэх эрх болон аудитын хяналтыг нэг дор удирдана.")}${tabs}${structureSettingsContent()}`;
  if (tab === "access") return `${moduleHeader("ТОХИРГОО", "Системийн тохиргоо", "Байгууллагын мэдээлэл болон ажилтнуудын нэвтрэх эрхийг нэг дор удирдана.")}${tabs}${accessManagementContent()}`;
  if (tab === "audit") return `${moduleHeader("ТОХИРГОО", "Системийн тохиргоо", "Байгууллагын үндсэн мэдээлэл, нэвтрэх эрх болон аудитын хяналтыг нэг дор удирдана.")}${tabs}${auditSettingsContent()}`;
  if (tab === "data") return `${moduleHeader("ТОХИРГОО", "Өгөгдлийн удирдлага", "Өгөгдлийн эзэн, чанар, хадгалалт болон lifecycle шийдвэрийг нэг дор хянана.")}${tabs}${dataGovernanceContent()}`;
  if (tab === "integrations") return `${moduleHeader("ТОХИРГОО", "Холболт, интеграц", "Гадаад үйлчилгээг зөвшөөрөлтэй, байгууллагаар тусгаарласан сувгаар холбоно.")}${tabs}${typeof connectorsSettingsContent==="function"?connectorsSettingsContent():"Холболтын тохиргоог ачаалж байна..."}`;
  const d = state.modules.settings?.item;
  if (!d) return `${moduleHeader("ТОХИРГОО", "Системийн тохиргоо", "Мэдээллийг ачаалж байна...")}${tabs}`;
  return `${moduleHeader("ТОХИРГОО", "Байгууллагын орчин", "Нэр, өнгө, лого, нүүр зургаа тохируулж ажилтнууддаа танил өөрийн орчин бүрдүүлнэ.")}${tabs}<div class="brand-preview" style="background:linear-gradient(120deg,${esc(d.primary_color)},${esc(d.accent_color)})">${d.logo_url ? `<img src="${esc(d.logo_url)}" alt="">` : ""}<div><strong>${esc(d.short_name || d.name)}</strong><small style="display:block;color:#fff">${esc(d.home_welcome_text || d.address || "Манай байгууллагын ажлын орчин")}</small></div></div><form class="module-form" id="settingsForm"><div class="module-form-grid"><label><span>Бүтэн нэр</span><input name="name" value="${esc(d.name)}" required></label><label><span>Товч нэр</span><input name="shortName" value="${esc(d.short_name)}"></label><label><span>Логоны URL</span><input name="logoUrl" value="${esc(d.logo_url)}" placeholder="/organization-assets/logo.png"></label><label><span>Нүүр зургийн URL</span><input name="homeBannerUrl" value="${esc(d.home_banner_url)}" placeholder="/organization-assets/banner.jpg"></label><label><span>Үндсэн өнгө</span><input name="primaryColor" type="color" value="${esc(d.primary_color)}"></label><label><span>Туслах өнгө</span><input name="accentColor" type="color" value="${esc(d.accent_color)}"></label><label><span>Регистр</span><input name="registrationNo" value="${esc(d.registration_no)}"></label><label><span>Утас</span><input name="phone" value="${esc(d.phone)}"></label><label><span>И-мэйл</span><input name="email" type="email" value="${esc(d.email)}"></label></div><label><span>Нүүрийн мэндчилгээ</span><input name="homeWelcomeText" maxlength="300" value="${esc(d.home_welcome_text)}" placeholder="Манай байгууллагын өнөөдрийн ажил нэг дор"></label><label><span>Хаяг</span><input name="address" value="${esc(d.address)}"></label><button class="primary">Тохиргоо хадгалах</button></form>`;
}

function structureSettingsContent() {
  if (!state.modules.structure) return `<section class="module-card"><strong>Байгууллагын бүтцийг ачаалж байна...</strong><small>Хэлтэс, албан тушаал болон тайлагнах шугамын мэдээлэл.</small></section>`;
  const template = document.createElement("template");
  template.innerHTML = structureView();
  template.content.querySelector(".page-header")?.remove();
  return template.innerHTML;
}

function auditSettingsContent() {
  const template = document.createElement("template");
  template.innerHTML = auditView();
  const pageHeader = template.content.querySelector(".page-header"),
    toolbar = pageHeader?.querySelector("#auditFilterForm")?.outerHTML || "";
  pageHeader?.remove();
  return `<div class="settings-audit-toolbar">${toolbar}</div>${template.innerHTML}`;
}

function billingView() {
  const d = state.modules.billing;
  if (!d) return moduleHeader("OVERVA ҮЙЛЧИЛГЭЭ", "Багц ба төлбөр", "Мэдээллийг ачаалж байна...");
  const s = d.subscription || {};
  return `${moduleHeader("OVERVA ҮЙЛЧИЛГЭЭ", "Багц ба төлбөр", "Танай байгууллагын ашиглаж буй багц, хэрэглээний хязгаар, төлбөр болон нэхэмжлэхүүд.")}<div class="module-grid"><article class="module-card"><span>Одоогийн багц</span><strong class="metric-number">${esc(s.plan_name || s.plan_code || "—")}</strong><small>${s.user_limit || "—"} хэрэглэгч · ${s.storage_gb || "—"} GB</small></article><article class="module-card"><span>Төлөв</span><strong class="metric-number">${esc(s.status || "—")}</strong><small>Дуусах: ${date(s.ends_at)}</small></article><article class="module-card"><span>Сарын үнэ</span><strong class="metric-number">${money(s.monthly_price)}</strong></article></div><div class="module-table-wrap"><table class="module-table"><thead><tr><th>Нэхэмжлэх</th><th>Хугацаа</th><th>Төлөх огноо</th><th>Дүн</th><th>Төлсөн</th><th>Төлөв</th></tr></thead><tbody>${d.invoices.length ? d.invoices.map((i) => `<tr><td><strong>${esc(i.invoice_no)}</strong></td><td>${date(i.period_start)} – ${date(i.period_end)}</td><td>${date(i.due_date)}</td><td>${money(i.amount, i.currency)}</td><td>${money(i.paid_amount, i.currency)}</td><td><span class="status-pill ${i.status}">${esc(i.status)}</span></td></tr>`).join("") : `<tr><td colspan="6">Нэхэмжлэх үүсээгүй байна.</td></tr>`}</tbody></table></div>`;
}

const inventoryMovementNames={receipt:"Орлого",issue:"Зарлага",transfer:"Шилжүүлэг",adjustment_in:"Тооллогын нэмэгдэл",adjustment_out:"Тооллогын хорогдол"};
function inventoryWorkspaceTabs(){return `<div class="inventory-tabs">${[["dashboard","Самбар"],["receipt","Орлого"],["issue","Зарлага, олголт"],["stock","Үлдэгдэл"],["replenishment","Захиалга"],["report","Тайлан"]].map(([key,name])=>`<button type="button" class="${state.inventoryTab===key?"active":""}" data-inventory-tab="${key}">${name}</button>`).join("")}</div>`}
function inventoryQuantity(value){const number=Number(value||0);return Number.isFinite(number)?new Intl.NumberFormat("mn-MN",{maximumFractionDigits:3}).format(number):"0"}
function inventoryDateTime(value){if(!value)return "—";const parsed=new Date(value);if(Number.isNaN(parsed.valueOf()))return "—";const options={year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"},timeZone=state.organization?.time_zone||state.organization?.timezone;if(timeZone)options.timeZone=timeZone;const parts=Object.fromEntries(new Intl.DateTimeFormat("mn-MN",options).formatToParts(parsed).map(part=>[part.type,part.value]));return `${parts.year}.${parts.month}.${parts.day} ${parts.hour}:${parts.minute}`}
function inventoryLowItems(items){return (items||[]).filter(item=>Number(item.minimum_stock)>0&&Number(item.total_quantity)<=Number(item.minimum_stock))}
function inventoryMovementRows(items,limit=100){const rows=(items||[]).slice(0,limit);return rows.length?rows.map(x=>`<tr><td>${inventoryDateTime(x.created_at)}</td><td><span class="status-pill">${inventoryMovementNames[x.movement_type]||esc(x.movement_type)}</span></td><td><strong>${esc(x.sku)} · ${esc(x.item_name)}</strong></td><td>${inventoryQuantity(x.quantity)}</td><td>${esc(x.from_name||"—")} → ${esc(x.to_name||"—")}</td><td>${esc(x.reference||"—")}<small>${esc(x.note||"")}</small></td><td>${esc(x.created_by_name||"—")}</td></tr>`).join(""):`<tr><td colspan="7">Хөдөлгөөн бүртгэгдээгүй байна.</td></tr>`}
function inventoryIssueQueue(d){const requests=d.workMaterialRequests||[];return `<div class="module-table-wrap inventory-section"><h2>Ажлын материалын олголт ба буцаалт</h2><p class="inventory-explain">Батлагдсан материалыг олгоно. Хэсэгчлэн зарцуулсан ажлын үлдэгдлийг яг тоо хэмжээгээр нь агуулахад буцааж, хөдөлгөөн ба audit-ийг нэг удаа бүртгэнэ.</p><table class="module-table"><thead><tr><th>Ажил</th><th>Материал</th><th>Тоо хэмжээ</th><th>Агуулахын үлдэгдэл</th><th>Үйлдэл</th></tr></thead><tbody>${requests.length?requests.map(request=>`<tr><td><strong>${esc(request.work_order_title)}</strong><small>${esc(request.reason)}</small></td><td>${esc(request.sku)} · ${esc(request.item_name)}</td><td>${request.status==="partially_consumed"?`Буцаах: ${request.return_quantity}`:`Баталсан: ${request.approved_quantity}`} ${esc(request.unit)}</td><td>${(request.balances||[]).map(balance=>`${esc(balance.warehouseName)}: ${balance.quantity}`).join(" · ")||"Үлдэгдэлгүй"}</td><td>${request.status==="approved"&&d.canIssueWorkMaterial?`<button class="primary" data-issue-work-material="${request.id}" data-material-work="${request.work_order_id}">Олгох</button>`:request.status==="partially_consumed"&&d.canReturnWorkMaterial?`<button class="primary" data-return-work-material="${request.id}" data-material-work="${request.work_order_id}">Буцаан авах</button>`:"Харах эрхтэй"}</td></tr>`).join(""):`<tr><td colspan="5">Олголт эсвэл буцаалт хүлээж буй материал алга.</td></tr>`}</tbody></table></div>`}
function inventoryMovementForm(d,mode){const receipt=mode==="receipt",types=receipt?[["receipt","Худалдан авалтын орлого"],["adjustment_in","Тооллогын нэмэгдэл"]]:[["issue","Тусгай зарлага"],["transfer","Агуулах хооронд шилжүүлэх"],["adjustment_out","Тооллогын хорогдол"]];return `<form class="module-form" id="stockMovementForm"><h2>${receipt?"Орлого бүртгэх":"Бусад зарлага, шилжүүлэг"}</h2>${receipt?"":`<p class="inventory-warning">Ажлын материалын зарлагыг дээрх батлагдсан олголтоор хийнэ. Энэ маягтыг зөвхөн ажлын захиалгад хамаарахгүй тусгай хөдөлгөөнд баримтын дугаар, тайлбартай ашиглана.</p>`}<div class="module-form-grid"><label><span>Бараа материал</span><select name="itemId" required>${selectOptions(d.items,"id","name","Бараа сонгоно уу")}</select></label><label><span>Хөдөлгөөний төрөл</span><select name="type">${types.map(([v,l])=>`<option value="${v}">${l}</option>`).join("")}</select></label><label><span>Гарах агуулах</span><select name="fromWarehouseId">${selectOptions(d.warehouses,"id","name")}</select></label><label><span>Орох агуулах</span><select name="toWarehouseId">${selectOptions(d.warehouses,"id","name")}</select></label><label><span>Тоо хэмжээ</span><input name="quantity" type="number" min="0.001" step="0.001" required></label><label><span>Баримтын дугаар</span><input name="reference" required></label></div><label><span>Тэмдэглэл</span><input name="note" required></label><button class="primary">Хөдөлгөөн бүртгэх</button></form>`}
function inventoryStockTable(d){return `<div class="module-table-wrap inventory-section"><h2>Бодит үлдэгдэл</h2><table class="module-table"><thead><tr><th>SKU / Материал</th><th>Ангилал</th><th>Нийт үлдэгдэл</th><th>Нэгж өртөг</th><th>Үлдэгдлийн дүн</th><th>Доод түвшин</th><th>Агуулахаар</th></tr></thead><tbody>${d.items.length?d.items.map(i=>`<tr><td><strong>${esc(i.sku)} · ${esc(i.name)}</strong></td><td>${esc(i.category)}</td><td class="${Number(i.minimum_stock)>0&&Number(i.total_quantity)<=Number(i.minimum_stock)?"low-stock":""}">${inventoryQuantity(i.total_quantity)} ${esc(i.unit)}</td><td>${money(i.unit_cost)}</td><td>${money(Number(i.total_quantity)*Number(i.unit_cost))}</td><td>${inventoryQuantity(i.minimum_stock)} ${esc(i.unit)}</td><td>${(i.balances||[]).map(b=>`${esc(b.warehouseName)}: ${inventoryQuantity(b.quantity)}`).join(" · ")||"—"}</td></tr>`).join(""):`<tr><td colspan="7">Бараа материал бүртгэгдээгүй байна.</td></tr>`}</tbody></table></div>`}
function inventoryMasterForms(d){return `<details class="inventory-master"><summary>Агуулах, барааны мастер бүртгэл тохируулах</summary><div class="module-grid"><form class="module-form" id="warehouseForm"><h2>Агуулах нэмэх</h2><label><span>Код</span><input name="code" required placeholder="MAIN"></label><label><span>Нэр</span><input name="name" required placeholder="Төв агуулах"></label><label><span>Байршил</span><input name="location"></label><button class="primary">Нэмэх</button></form><form class="module-form" id="inventoryItemForm"><h2>Бараа материал нэмэх</h2><div class="module-form-grid"><label><span>SKU</span><input name="sku" required></label><label><span>Нэр</span><input name="name" required></label><label><span>Ангилал</span><input name="category" value="Сэлбэг" required></label><label><span>Нэгж</span><input name="unit" value="ш" required></label><label><span>Доод үлдэгдэл</span><input name="minimumStock" type="number" min="0" step="0.001" value="0"></label></div><button class="primary">Нэмэх</button></form></div></details>`}
function storekeeperWorkspaceView(){
  const d=state.modules.inventory;
  if(!d)return moduleHeader("АГУУЛАХ БА НӨӨЦ","Няравын ажлын талбар","Мэдээллийг ачаалж байна...");
  const canManage=(state.user.permissions||[]).includes("inventory.manage");
  const low=inventoryLowItems(d.items);
  const stocked=d.items.filter(item=>Number(item.total_quantity)>0).length;
  const head=`${moduleHeader("АГУУЛАХ БА НӨӨЦ","Няравын ажлын талбар","Орлого, олголт, үлдэгдэл, нөхөн таталт ба тайланг нэг хөдөлгөөний журналаас хөтөлнө.")}${inventoryWorkspaceTabs()}`;
  if(state.inventoryTab==="receipt")return head+(canManage?inventoryMovementForm(d,"receipt"):inventoryStockTable(d));
  if(state.inventoryTab==="issue")return head+inventoryIssueQueue(d)+(canManage?inventoryMovementForm(d,"issue"):"");
  if(state.inventoryTab==="stock")return head+inventoryStockTable(d)+(canManage?inventoryMasterForms(d):"");
  if(state.inventoryTab==="replenishment")return head+`<div class="module-table-wrap inventory-section"><h2>Нөхөн татах шаардлага</h2><p class="inventory-explain">Зөвхөн доод түвшин тохируулсан бөгөөд үлдэгдэл нь түүнд хүрсэн материалыг харуулна. Худалдан авалтын хүсэлт үүсгэж, батлах–захиалах–хүлээн авах урсгалаар явна.</p><table class="module-table"><thead><tr><th>Материал</th><th>Үлдэгдэл</th><th>Доод түвшин</th><th>Зөрүү</th></tr></thead><tbody>${low.length?low.map(i=>`<tr><td><strong>${esc(i.sku)} · ${esc(i.name)}</strong></td><td>${inventoryQuantity(i.total_quantity)} ${esc(i.unit)}</td><td>${inventoryQuantity(i.minimum_stock)} ${esc(i.unit)}</td><td class="low-stock">${inventoryQuantity(Math.max(0,Number(i.minimum_stock)-Number(i.total_quantity)))} ${esc(i.unit)}</td></tr>`).join(""):`<tr><td colspan="4">Нөхөн татах материал алга.</td></tr>`}</tbody></table>${canManage?`<div class="inventory-action"><button class="primary" data-open-procurement>Худалдан авалтын хүсэлт рүү очих</button></div>`:""}</div>`;
  if(state.inventoryTab==="report")return head+`<div class="module-table-wrap inventory-section"><h2>Няравын хөдөлгөөний тайлан</h2><table class="module-table"><thead><tr><th>Огноо</th><th>Төрөл</th><th>Материал</th><th>Тоо</th><th>Чиглэл</th><th>Баримт</th><th>Бүртгэсэн</th></tr></thead><tbody>${inventoryMovementRows(d.movements)}</tbody></table></div>`;
  return `${head}<div class="module-grid"><article class="module-card"><span>Агуулах</span><strong class="metric-number">${d.warehouses.length}</strong></article><article class="module-card"><span>Материалын нэр төрөл</span><strong class="metric-number">${d.items.length}</strong></article><article class="module-card"><span>Үлдэгдэлтэй материал</span><strong class="metric-number">${stocked}</strong></article><article class="module-card"><span>Нөхөн татах</span><strong class="metric-number low-stock">${low.length}</strong></article><article class="module-card"><span>Олголт хүлээж буй</span><strong class="metric-number">${(d.workMaterialRequests||[]).length}</strong></article></div><div class="inventory-dashboard-grid"><div class="module-table-wrap"><h2>Сүүлийн хөдөлгөөн</h2><table class="module-table"><thead><tr><th>Огноо</th><th>Төрөл</th><th>Материал</th><th>Тоо</th><th>Чиглэл</th><th>Баримт</th><th>Бүртгэсэн</th></tr></thead><tbody>${inventoryMovementRows(d.movements,8)}</tbody></table></div><div class="module-table-wrap"><h2>Анхаарах үлдэгдэл</h2><table class="module-table"><thead><tr><th>Материал</th><th>Үлдэгдэл</th><th>Доод түвшин</th></tr></thead><tbody>${low.length?low.slice(0,10).map(i=>`<tr><td>${esc(i.sku)} · ${esc(i.name)}</td><td class="low-stock">${inventoryQuantity(i.total_quantity)} ${esc(i.unit)}</td><td>${inventoryQuantity(i.minimum_stock)} ${esc(i.unit)}</td></tr>`).join(""):`<tr><td colspan="3">Анхаарах материал алга.</td></tr>`}</tbody></table></div></div>`;
}
const baseInventoryView = inventoryView;
inventoryView = function () {
  const base = baseInventoryView(),
    d = state.modules.inventory,
    requests = d?.workMaterialRequests || [];
  if (!d?.canIssueWorkMaterial) return base;
  const queue = `<div class="module-table-wrap"><h2>Ажлын материал олгох дараалал</h2><table class="module-table"><thead><tr><th>Ажил</th><th>Материал</th><th>Баталсан</th><th>Агуулахын үлдэгдэл</th><th>Үйлдэл</th></tr></thead><tbody>${requests.length ? requests.map((request) => `<tr><td><strong>${esc(request.work_order_title)}</strong><small>${esc(request.reason)}</small></td><td>${esc(request.sku)} · ${esc(request.item_name)}</td><td>${request.approved_quantity} ${esc(request.unit)}</td><td>${(request.balances || []).map((balance) => `${esc(balance.warehouseName)}: ${balance.quantity}`).join(" · ") || "Үлдэгдэлгүй"}</td><td><button class="primary" data-issue-work-material="${request.id}" data-material-work="${request.work_order_id}">Олгох</button></td></tr>`).join("") : `<tr><td colspan="5">Батлагдсан, олголт хүлээж буй материал алга.</td></tr>`}</tbody></table></div>`;
  return base + queue;
};
const moduleRenderers = {
  structure: structureView,
  inventory: storekeeperWorkspaceView,
  maintenance: maintenanceView,
  procurement: procurementView,
  settings: settingsView,
  billing: billingView,
};

async function issueWorkMaterial(button) {
  const data = state.modules.inventory,
    request = (data.workMaterialRequests || []).find((item) => item.id === button.dataset.issueWorkMaterial);
  if (!request) return;
  const available = (request.balances || []).filter((balance) => Number(balance.quantity) >= Number(request.approved_quantity));
  if (!available.length) return toast("Олгоход хүрэлцэх агуулахын үлдэгдэл алга", true);
  const answer = prompt(`Агуулахын нэрийг оруулна уу:\n${available.map((balance) => `${balance.warehouseName}: ${balance.quantity}`).join("\n")}`, available[0].warehouseName);
  if (answer === null) return;
  const warehouse = available.find((balance) => balance.warehouseName.toLowerCase() === answer.trim().toLowerCase());
  if (!warehouse) return toast("Агуулахын нэр тохирсонгүй", true);
  try {
    await api(`/api/work-orders/${button.dataset.materialWork}/materials/${request.id}/issue`, {
      method: "POST",
      body: JSON.stringify({
        warehouseId: warehouse.warehouseId,
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    state.modules.inventory = null;
    await loadModule("inventory");
    toast("Материал олгож, агуулахын үлдэгдэл шинэчлэгдлээ");
  } catch (error) {
    toast(error.message, true);
  }
}

async function returnWorkMaterial(button) {
  const data=state.modules.inventory,request=(data.workMaterialRequests||[]).find(item=>item.id===button.dataset.returnWorkMaterial);
  if(!request||!data.warehouses.length)return;
  const answer=prompt(`Буцаан авах агуулахын нэрийг оруулна уу:\n${data.warehouses.map(item=>item.name).join("\n")}`,data.warehouses[0].name);
  if(answer===null)return;
  const warehouse=data.warehouses.find(item=>item.name.toLowerCase()===answer.trim().toLowerCase());
  if(!warehouse)return toast("Агуулахын нэр тохирсонгүй",true);
  try{
    await api(`/api/work-orders/${button.dataset.materialWork}/materials/${request.id}/return`,{method:"POST",body:JSON.stringify({
      warehouseId:warehouse.id,returnedQuantity:Number(request.return_quantity),idempotencyKey:crypto.randomUUID(),note:"Ажлаас зарцуулагдаагүй материалыг буцаан авав",
    })});
    state.modules.inventory=null;await loadModule("inventory");toast("Үлдсэн материал агуулахад буцаж, тулгалт хаагдлаа");
  }catch(error){toast(error.message,true)}
}

async function postModule(path, body, name, message) {
  await api(path, { method: "POST", body: JSON.stringify(body) });
  state.modules[name] = null;
  await loadModule(name);
  toast(message);
}
document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!["departmentForm", "positionForm", "warehouseForm", "inventoryItemForm", "stockMovementForm", "maintenanceForm", "procurementForm", "settingsForm", "dataArchitectureForm", "dataPolicyForm", "dataStewardForm", "dataHoldForm", "dataDispositionForm", "dataFindingForm"].includes(form.id)) return;
  event.preventDefault();
  const v = Object.fromEntries(new FormData(form));
  try {
    if (form.id === "departmentForm") await postModule("/api/modules/structure/departments", v, "structure", "Хэлтэс нэмэгдлээ");
    if (form.id === "positionForm") await postModule("/api/modules/structure/positions", v, "structure", "Албан тушаал нэмэгдлээ");
    if (form.id === "warehouseForm") await postModule("/api/modules/inventory/warehouses", v, "inventory", "Агуулах нэмэгдлээ");
    if (form.id === "inventoryItemForm") await postModule("/api/modules/inventory/items", v, "inventory", "Бараа нэмэгдлээ");
    if (form.id === "stockMovementForm") await postModule("/api/modules/inventory/movements", v, "inventory", "Гүйлгээ бүртгэгдлээ");
    if (form.id === "maintenanceForm") await postModule("/api/modules/maintenance", v, "maintenance", "Засварын төлөвлөгөө үүслээ");
    if (form.id === "procurementForm")
      await postModule(
        "/api/modules/procurement",
        {
          title: v.title,
          neededBy: v.neededBy || null,
          currency: v.currency,
          justification: v.justification,
          submit: true,
          lines: [
            {
              description: v.description,
              quantity: v.quantity,
              unit: v.unit,
              unitPrice: v.unitPrice,
            },
          ],
        },
        "procurement",
        "Хүсэлт илгээгдлээ",
      );
    if (form.id === "settingsForm") {
      const out = await api("/api/modules/settings", {
        method: "PATCH",
        body: JSON.stringify(v),
      });
      state.modules.settings = { item: { ...out.item, name: v.name } };
      state.organization.name = v.name;
      state.organization.settings = out.item;
      adjustModuleNavigation();
      render();
      toast("Тохиргоо хадгалагдлаа");
    }
    if (form.id === "dataArchitectureForm") {
      const asset = v.assetCode;
      delete v.assetCode;
      v.recoveryPointMinutes = v.recoveryPointMinutes || null;
      v.recoveryTimeMinutes = v.recoveryTimeMinutes || null;
      await api(`/api/data-governance/architecture/${asset}`, {
        method: "PUT",
        body: JSON.stringify(v),
      });
      await refreshDataGovernance();
      toast("Өгөгдлийн эх сурвалж ба сэргээх шаардлага хадгалагдлаа");
    }
    if (form.id === "dataPolicyForm") {
      const asset = v.assetCode;
      delete v.assetCode;
      v.archiveAfterDays = v.archiveAfterDays || null;
      v.retentionDays = v.retentionDays || null;
      v.active = true;
      await api(`/api/data-governance/policies/${asset}`, {
        method: "PUT",
        body: JSON.stringify(v),
      });
      await refreshDataGovernance();
      toast("Lifecycle бодлого хадгалагдлаа");
    }
    if (form.id === "dataStewardForm") {
      await api(`/api/data-governance/stewards/${v.domain}`, {
        method: "PUT",
        body: JSON.stringify({ employeeId: v.employeeId }),
      });
      await refreshDataGovernance();
      toast("Өгөгдөл хариуцагч оноогдлоо");
    }
    if (form.id === "dataHoldForm") {
      v.recordKey = v.recordKey || null;
      await api("/api/data-governance/holds", {
        method: "POST",
        body: JSON.stringify(v),
      });
      form.reset();
      await refreshDataGovernance();
      toast("Хадгалалтын хориг бүртгэгдлээ");
    }
    if (form.id === "dataDispositionForm") {
      await api("/api/data-governance/dispositions", {
        method: "POST",
        body: JSON.stringify(v),
      });
      form.reset();
      await refreshDataGovernance();
      toast("Хүсэлт шийдвэр хүлээх төлөвт орлоо");
    }
    if (form.id === "dataFindingForm") {
      v.sourceType = "user_report";
      v.assetCode = v.assetCode || null;
      v.sourceReference = {};
      v.learningCandidate = Boolean(form.elements.learningCandidate.checked);
      await api("/api/data-governance/findings", {
        method: "POST",
        body: JSON.stringify(v),
      });
      form.reset();
      await refreshDataGovernance();
      toast("Өгөгдлийн асуудал хүний хяналтын дараалалд бүртгэгдлээ");
    }
  } catch (error) {
    toast(error.message, true);
  }
});
async function refreshDataGovernance() {
  state.modules.dataGovernance = null;
  await loadDataGovernance();
}
document.addEventListener("click", async (event) => {
  const inventoryTab = event.target.closest("[data-inventory-tab]"),
    openProcurement = event.target.closest("[data-open-procurement]"),
    assign = event.target.closest("[data-assign-structure]"),
    complete = event.target.closest("[data-complete-maintenance]"),
    decision = event.target.closest("[data-procurement-action]"),
    releaseHold = event.target.closest("[data-release-hold]"),
    dispositionDecision = event.target.closest("[data-disposition-decision]"),
    findingDecision = event.target.closest("[data-finding-decision]"),
    materialIssue = event.target.closest("[data-issue-work-material]"),
    materialReturn = event.target.closest("[data-return-work-material]");
  try {
    if (inventoryTab) {
      state.inventoryTab = inventoryTab.dataset.inventoryTab;
      render();
      return;
    }
    if (openProcurement) {
      $("#procurementNav")?.click();
      return;
    }
    if (materialIssue) await issueWorkMaterial(materialIssue);
    if (materialReturn) await returnWorkMaterial(materialReturn);
    if (assign) {
      const d = state.modules.structure,
        p = d.people.find((x) => x.id === assign.dataset.assignStructure),
        departmentId = prompt("Хэлтсийн код (хоосон бол цэвэрлэнэ):", d.departments.find((x) => x.id === p.department_id)?.code || ""),
        positionCode = prompt("Албан тушаалын код (хоосон бол цэвэрлэнэ):", d.positions.find((x) => x.id === p.position_id)?.code || ""),
        managerEmail = prompt("Шууд удирдлагын и-мэйл (хоосон бол цэвэрлэнэ):", d.people.find((x) => x.id === p.manager_user_id)?.email || "");
      if (departmentId === null || positionCode === null || managerEmail === null) return;
      await api(`/api/modules/structure/users/${p.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          departmentId: d.departments.find((x) => x.code.toLowerCase() === departmentId.trim().toLowerCase())?.id || null,
          positionId: d.positions.find((x) => x.code.toLowerCase() === positionCode.trim().toLowerCase())?.id || null,
          managerUserId: d.people.find((x) => x.email.toLowerCase() === managerEmail.trim().toLowerCase())?.id || null,
        }),
      });
      state.modules.structure = null;
      await loadModule("structure");
      toast("Ажилтны бүтэц шинэчлэгдлээ");
    }
    if (complete) {
      const note = prompt("Гүйцэтгэлийн тэмдэглэл:", "");
      if (note === null) return;
      await postModule(`/api/modules/maintenance/${complete.dataset.completeMaintenance}/complete`, { note, meterReading: "" }, "maintenance", "Засвар гүйцэтгэсэнд тооцлоо");
    }
    if (decision) {
      const note = prompt("Шийдвэрийн тайлбар:", "");
      if (note === null) return;
      await postModule(`/api/modules/procurement/${decision.dataset.procurementId}/decision`, { action: decision.dataset.procurementAction, note }, "procurement", "Хүсэлтийн төлөв шинэчлэгдлээ");
    }
    if (releaseHold) {
      if (!confirm("Энэ хадгалалтын хоригийг суллах уу?")) return;
      await api(`/api/data-governance/holds/${releaseHold.dataset.releaseHold}/release`, { method: "POST" });
      await refreshDataGovernance();
      toast("Хадгалалтын хориг суллагдлаа");
    }
    if (dispositionDecision) {
      const note = prompt("Шийдвэрийн үндэслэл:", "");
      if (note === null) return;
      await api(`/api/data-governance/dispositions/${dispositionDecision.dataset.dispositionId}/decision`, {
        method: "POST",
        body: JSON.stringify({
          decision: dispositionDecision.dataset.dispositionDecision,
          note,
        }),
      });
      await refreshDataGovernance();
      toast("Lifecycle шийдвэр бүртгэгдлээ. Өгөгдөл автоматаар устгагдаагүй.");
    }
    if (findingDecision) {
      const note = prompt("Шийдвэр, үндэслэлээ бичнэ үү:", "");
      if (note === null || !note.trim()) return;
      await api(`/api/data-governance/findings/${findingDecision.dataset.findingId}/decision`, {
        method: "POST",
        body: JSON.stringify({
          status: findingDecision.dataset.findingDecision,
          note,
        }),
      });
      await refreshDataGovernance();
      toast("Шийдвэр бүртгэгдлээ. Canonical өгөгдлийг автоматаар өөрчлөөгүй.");
    }
  } catch (error) {
    toast(error.message, true);
  }
});
