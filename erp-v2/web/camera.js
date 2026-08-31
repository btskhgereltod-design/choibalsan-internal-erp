"use strict";

state.cameraWorkspace = null;
state.cameraLoading = false;
state.cameraTab = "overview";

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
    ["assets", "Камер, төхөөрөмж"],
    ["incidents", "Гэмтэл"],
    ["work", "Камерын ажлууд"],
    ["reports", "Тайлан"],
  ];
  return `<div class="lighting-tabs">${tabs.map(([key, name]) =>
    `<button class="${state.cameraTab === key ? "active" : ""}" data-camera-tab="${key}">${name}</button>`
  ).join("")}</div>`;
}

function cameraTable(headers, rows, colspan) {
  return `<div class="table-wrap"><table><thead><tr>${headers.map((item) => `<th>${item}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.join("") : `<tr><td colspan="${colspan}">${empty("Одоогоор бүртгэл алга.")}</td></tr>`}</tbody></table></div>`;
}

function cameraAssets(data) {
  return cameraTable(["Код / камерын объект", "Ангилал", "Камер", "Ажиллахгүй", "Байршил", "Төлөв"],
    data.assets.map((item) => `<tr><td><button class="object-dossier-link" data-camera-dossier="${item.id}">${esc(item.name)}</button><small>${esc(item.code || "—")} · Объектын хувийн хэрэг</small></td><td>${esc(item.metadata?.subCategory || "—")}</td><td>${Number(item.metadata?.cameraCount || 0)}</td><td>${Number(item.metadata?.brokenCount || 0)}</td><td>${esc(item.location || "—")}</td><td>${esc(item.status || "—")}</td></tr>`), 6);
}

function cameraIncidents(data) {
  return cameraTable(["Камер / объект", "Гэмтэл", "Төлөв", "Нөлөөлсөн", "Илэрсэн"],
    data.incidents.map((item) => `<tr><td>${esc(item.asset_name || item.asset_code || "—")}</td><td><b>${esc(item.title || item.description || "Камерын гэмтэл")}</b></td><td>${esc(item.status || "—")}</td><td>${Number(item.affected_quantity || 0)}</td><td>${date(item.reported_at)}</td></tr>`), 5);
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
  try{const data=await api(`/api/camera/objects/${id}/dossier`);data.capabilities={canManageComponents:false,canCreateNote:false};state.lightingDossier=data;$("#lightingDossierTitle").textContent=`${data.item.code} — ${data.item.name}`;$("#lightingDossierBody").innerHTML=lightingDossierHtml(data);$("#lightingDossierDialog").showModal()}catch(error){toast(error.message,true)}
}

function cameraOverview(data) {
  const recentIncidents = data.incidents.slice(0, 6).map((item) => `<div class="lighting-list"><div><b>${esc(item.asset_name || item.title || "Камерын гэмтэл")}</b><small>${esc(item.description || item.status || "—")}</small></div><span>${esc(item.status || "—")}</span></div>`).join("");
  const recentWork = data.workOrders.slice(0, 6).map((item) => `<div class="lighting-list"><div><b>${esc(item.title)}</b><small>${esc(item.assigned_name || item.department_name || "Оноогоогүй")}</small></div><span>${esc(item.workflow_stage || item.status || "—")}</span></div>`).join("");
  return `<div class="grid two"><section class="panel"><h3>Шийдэх гэмтэл</h3>${recentIncidents || empty("Нээлттэй гэмтэл алга.")}</section><section class="panel"><h3>Сүүлийн камерын ажлууд</h3>${recentWork || empty("Камерын ажил алга.")}</section></div>`;
}

function cameraView() {
  if (state.cameraLoading && !state.cameraWorkspace) return `${header("КАМЕРЫН ҮЙЛ АЖИЛЛАГАА", "Камерын тасгийн ажлын талбар", "Мэдээллийг ачаалж байна...")}<div class="panel">Ачаалж байна...</div>`;
  const data = state.cameraWorkspace;
  if (!data) return `${header("КАМЕРЫН ҮЙЛ АЖИЛЛАГАА", "Камерын тасгийн ажлын талбар", "Камерын объект, гэмтэл, засварын ажлын урсгал.")}<div class="panel">Мэдээлэл ачаалагдаагүй байна.</div>`;
  if (data.error) return `${header("КАМЕРЫН ҮЙЛ АЖИЛЛАГАА", "Камерын тасгийн ажлын талбар", "Камерын объект, гэмтэл, засварын ажлын урсгал.")}<div class="panel"><div class="error">${esc(data.error)}</div><button class="secondary" data-camera-refresh>Дахин оролдох</button></div>`;
  const s = data.summary;
  const content = state.cameraTab === "assets" ? cameraAssets(data)
    : state.cameraTab === "incidents" ? cameraIncidents(data)
      : state.cameraTab === "work" ? cameraWork(data)
        : state.cameraTab === "reports" ? cameraReports(data) : cameraOverview(data);
  return `${header("КАМЕРЫН ҮЙЛ АЖИЛЛАГАА", "Камерын тасгийн ажлын талбар", "Камерын объект → гэмтэл → ажил → хяналт → баталгаажуулалтын нэг урсгал.", `<button class="secondary" data-camera-refresh>↻ Шинэчлэх</button>`)}
    ${cameraTabs()}
    ${!data.available ? `<div class="panel">Камерын ажлын төрөл эсвэл объект бүртгэгдээгүй байна. Тохиргоо болон Smart Import-оор бүртгэнэ үү.</div>` : ""}
    <div class="lighting-stat-grid">
      ${stat("Нийт камер", s.devices, `${s.locations} байршил · ${s.activeDevices} хэвийн`, "◇", "blue")}
      ${stat("Нээлттэй гэмтэл", s.openIncidents, `${s.affectedDevices} төхөөрөмжид нөлөөлсөн`, "!", "red")}
      ${stat("Нээлттэй ажил", s.openWork, "Хянагдаж буй ажлууд", "✓", "green")}
      ${stat("Дууссан ажил", s.completedWork, "Баталгаажсан гүйцэтгэл", "↗", "purple")}
    </div>${content}`;
}

document.addEventListener("click", (event) => {
  const tab = event.target.closest("[data-camera-tab]");
  if (tab) {
    state.cameraTab = tab.dataset.cameraTab;
    render();
  }
  if (event.target.closest("[data-camera-refresh]")) loadCamera(true);
  const dossier=event.target.closest("[data-camera-dossier]");
  if(dossier)openCameraDossier(dossier.dataset.cameraDossier);
});

window.cameraView = cameraView;
window.loadCamera = loadCamera;
