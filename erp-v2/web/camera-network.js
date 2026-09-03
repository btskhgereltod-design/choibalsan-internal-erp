"use strict";

state.cameraNetwork = null;
state.cameraNetworkLoading = false;
state.cameraNetworkSearch = "";
state.cameraNetworkDraw = [];
state.cameraNetworkMode = "";
state.cameraNetworkPoint = null;
state.cameraNetworkFull = false;
state.cameraNetworkTool = "";
state.cameraNetworkLayers = { cameras: true, nodes: true, routes: true, recovery: true };

let cameraNetworkMap = null;
let cameraNetworkGroups = {};
let cameraNetworkDraftLayer = null;
let cameraNetworkPreviewMarker = null;
let cameraNetworkMapItems = [];
let cameraNetworkResizeObserver = null;

const cameraNetworkCoreColors = {
  4: "#16a34a", 6: "#0284c7", 8: "#2563eb", 12: "#ea580c",
  24: "#7c3aed", 48: "#c026d3", 96: "#475569",
};
const cameraNetworkNodeLabels = {
  splice: "Муфт", closure: "Холболтын хайрцаг", odf: "ODF",
  cross: "Кросс", splitter: "Splitter", other: "Бусад",
};

async function loadCameraNetwork(force = false) {
  if (state.cameraNetworkLoading || (state.cameraNetwork && !force)) return;
  state.cameraNetworkLoading = true;
  if (state.view === "camera") render();
  try {
    state.cameraNetwork = await api("/api/camera/network/workspace");
  } catch (error) {
    state.cameraNetwork = { error: error.message || "Шилэн кабелийн сүлжээний мэдээллийг ачаалж чадсангүй." };
  } finally {
    state.cameraNetworkLoading = false;
    if (state.view === "camera") render();
  }
}

function cameraNetworkLength(value) {
  const meters = Number(value || 0);
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} км` : `${Math.round(meters)} м`;
}

function cameraNetworkRouteOptions(routes, includeEmpty = true) {
  return `${includeEmpty ? '<option value="">Трасстай холбохгүй</option>' : ""}${routes
    .filter(item => item.status === "active")
    .map(item => `<option value="${item.id}">${esc(item.code)} · ${esc(item.name)}</option>`).join("")}`;
}

function cameraNetworkLegend(data) {
  return data.coreOptions.map(core => `<label class="camera-network-legend-item">
    <input type="checkbox" data-network-core="${core}" checked>
    <i style="background:${cameraNetworkCoreColors[core]}"></i>${core} core
  </label>`).join("");
}

function cameraNetworkLayerPanel(data) {
  const recoveryCount = data.recovery?.summary?.candidates || 0;
  return `<div class="camera-network-layer-panel"><h3>Давхарга</h3><small>Шилэн кабелийг камерын төхөөрөмж болгон давхар бүртгэхгүй.</small>
    <label><input type="checkbox" data-network-layer="cameras" ${state.cameraNetworkLayers.cameras ? "checked" : ""}> Камерын GPS (${data.summary.cameraPointsWithGps})</label>
    <label><input type="checkbox" data-network-layer="nodes" ${state.cameraNetworkLayers.nodes ? "checked" : ""}> Муфт / цэг (${data.summary.activeNodes})</label>
    <label><input type="checkbox" data-network-layer="routes" ${state.cameraNetworkLayers.routes ? "checked" : ""}> Шилэн трасс (${data.summary.activeRoutes})</label>
    <label class="camera-network-recovery-layer"><input type="checkbox" data-network-layer="recovery" ${state.cameraNetworkLayers.recovery ? "checked" : ""}> Legacy сэргээх preview (${recoveryCount})</label>
    <div class="camera-network-core-layers">${cameraNetworkLegend(data)}</div>
  </div>`;
}

function cameraNetworkProperties() {
  return `<div class="camera-network-properties"><h3>Сонгосон объект</h3><div id="cameraNetworkProperties">
    <p>Газрын зураг дээр камер, цэг эсвэл трасс дарахад мэдээлэл энд гарна.</p>
  </div></div>`;
}

function cameraNetworkForms(data) {
  const canManage = data.capabilities.canManage;
  const missing = data.cameraPoints.filter(item => item.latitude === null || item.longitude === null).length;
  return `<div class="camera-network-controls ${state.cameraNetworkTool ? "is-open" : ""}" id="cameraNetworkToolDrawer">
    <form id="cameraNetworkRouteForm" class="camera-network-control-card ${state.cameraNetworkTool === "route" ? "is-active" : ""}">
      <div><span class="eyebrow">ТРАСС</span><h3>Шилэн кабель зурах</h3></div>
      <label>Трассын нэр<input name="name" maxlength="200" required placeholder="Жишээ: 7-р багийн үндсэн трасс" ${canManage ? "" : "disabled"}></label>
      <div class="camera-network-form-row"><label>Core<select name="coreCount" data-network-core-select ${canManage ? "" : "disabled"}>${data.coreOptions.map(core => `<option value="${core}" ${core === 24 ? "selected" : ""}>${core} core</option>`).join("")}</select></label><label>Өнгө<input name="color" type="color" value="${cameraNetworkCoreColors[24]}" ${canManage ? "" : "disabled"}></label></div>
      <label>Тэмдэглэл<input name="note" maxlength="2000" placeholder="Холболт, хайрцаг, тайлбар" ${canManage ? "" : "disabled"}></label>
      <div class="camera-network-actions"><button type="button" class="secondary" data-network-draw ${canManage ? "" : "disabled"}>Трасс зурах</button><button class="primary" ${canManage ? "" : "disabled"}>Хадгалах</button><button type="button" class="secondary" data-network-cancel>Цуцлах</button></div>
      <small id="cameraNetworkDrawHint">Трасс зурах товч дараад map дээр дарааллаар цэгүүдээ дарна.</small>
    </form>
    <form id="cameraNetworkNodeForm" class="camera-network-control-card ${state.cameraNetworkTool === "node" ? "is-active" : ""}">
      <div><span class="eyebrow">МУФТ / ЦЭГ</span><h3>Сүлжээний зангилаа</h3></div>
      <div class="camera-network-form-row"><label>Төрөл<select name="nodeType" ${canManage ? "" : "disabled"}>${Object.entries(cameraNetworkNodeLabels).map(([code, label]) => `<option value="${code}">${label}</option>`).join("")}</select></label><label>Нэр<input name="name" required maxlength="200" placeholder="Муфт-001" ${canManage ? "" : "disabled"}></label></div>
      <div class="camera-network-form-row"><label>Трасс A<select name="routeA" ${canManage ? "" : "disabled"}>${cameraNetworkRouteOptions(data.routes)}</select></label><label>Трасс B<select name="routeB" ${canManage ? "" : "disabled"}>${cameraNetworkRouteOptions(data.routes)}</select></label></div>
      <label>Байршил / тайлбар<input name="note" maxlength="2000" ${canManage ? "" : "disabled"}></label>
      <div class="camera-network-actions"><button type="button" class="secondary" data-network-node-pick ${canManage ? "" : "disabled"}>Цэг нэмэх</button><button class="primary" ${canManage ? "" : "disabled"}>Цэг хадгалах</button><button type="button" class="secondary" data-network-cancel>Цуцлах</button></div>
      <small id="cameraNetworkNodeHint">Цэг нэмэх товч дараад map дээр байршил сонгоно.</small>
    </form>
    <form id="cameraNetworkGpsForm" class="camera-network-control-card wide ${state.cameraNetworkTool === "gps" ? "is-active" : ""}">
      <div><span class="eyebrow">КАМЕРЫН GPS</span><h3>Камерын цэгт байршил оноох</h3></div>
      <label>Камерын объект / цэг<select name="cameraPointId" data-network-camera-point ${data.capabilities.canUpdateCameraGps ? "" : "disabled"}>
        <option value="">Камерын цэг сонгоно уу</option>${data.cameraPoints.map(item => `<option value="${item.target_kind}:${item.target_id}">${esc(item.object_code)} · ${esc(item.object_name)} / ${esc(item.point_name)}${item.latitude === null ? " · GPS-гүй" : ""}${item.target_kind === "legacy_object" ? " · profile хянаагүй" : ""}</option>`).join("")}
      </select></label>
      <label>Тайлбар<input name="note" maxlength="500" placeholder="GPS эх сурвалж / шалгасан тайлбар" ${data.capabilities.canUpdateCameraGps ? "" : "disabled"}></label>
      <div class="camera-network-actions"><button type="button" class="secondary" data-network-camera-toggle>Камер: ${state.cameraNetworkLayers.cameras ? "ON" : "OFF"}</button><button type="button" class="secondary" data-network-gps-pick ${data.capabilities.canUpdateCameraGps ? "" : "disabled"}>Камер зөөх / GPS сонгох</button><button class="primary" ${data.capabilities.canUpdateCameraGps ? "" : "disabled"}>GPS хадгалах</button></div>
      <small id="cameraNetworkGpsHint">${missing} GPS-гүй цэг байна. Камер сонгоод map дээр байрлал дарж, дараа нь хадгална.</small>
    </form>
  </div>`;
}

function cameraNetworkTables(data) {
  const query = state.cameraNetworkSearch.trim().toLocaleLowerCase("mn");
  const routes = data.routes.filter(item => !query || `${item.code} ${item.name} ${item.note}`.toLocaleLowerCase("mn").includes(query));
  const nodes = data.nodes.filter(item => !query || `${item.code} ${item.name} ${item.note}`.toLocaleLowerCase("mn").includes(query));
  const recovery = (data.recovery?.candidates || []).filter(item => !query
    || `${item.proposed_code} ${item.proposed_name}`.toLocaleLowerCase("mn").includes(query));
  const reviewLabel = item => item.review_decision === "confirmed" ? "Зураг дээр баталсан"
    : item.review_decision === "needs_correction" ? "Засвар шаардлагатай"
      : item.review_decision === "rejected" ? "Татгалзсан" : "Хяналт хүлээж буй";
  const recoverySection = data.recovery?.batch ? `<section class="camera-network-recovery-review"><div class="lighting-section-title"><div><span class="eyebrow">LEGACY СЭРГЭЭХ ХЯНАЛТ</span><h2>Canonical болоогүй трассын preview</h2></div><span>${Number(data.recovery.summary.candidates)} трасс · ${Number(data.recovery.summary.vertices)} цэг · longitude-аас ${Number(data.recovery.batch.transform?.longitudeOffset || 0).toLocaleString()} хасаж сэргээсэн</span></div>
    <div class="camera-network-recovery-notice"><strong>Энэ бол master бүртгэл биш.</strong> Хуучин эх координат, сэргээсэн зураг, уртыг инженер шалгасны дараа тусдаа дэвшүүлнэ.</div>
    ${cameraTable(["Legacy трасс", "Core", "Эх → сэргээсэн урт", "Тулгалт", "Хяналтын төлөв", "Үйлдэл"], recovery.map(item => {
      const difference = Number(item.validation?.lengthDifferenceM || 0);
      const stateClass = item.review_decision === "confirmed" ? "active" : item.review_decision ? "inactive" : "warning";
      return `<tr><td><button class="object-dossier-link" data-network-focus="recovery:${item.id}">${esc(item.proposed_name)}</button><small>${esc(item.proposed_code)} · эх мөр ${esc(item.source_key)}</small></td><td><span class="camera-network-core"><i style="background:${esc(item.proposed_color)}"></i>${Number(item.proposed_core_count)} core</span></td><td>${cameraNetworkLength(item.source_length_m)} → ${cameraNetworkLength(item.recomputed_length_m)}</td><td><span class="badge active">${Math.abs(difference) < .01 ? "Яг таарсан" : `${difference.toFixed(2)} м`}</span></td><td><span class="badge ${stateClass}">${reviewLabel(item)}</span>${item.review_note ? `<small>${esc(item.review_note)}</small>` : ""}</td><td><div class="camera-network-actions"><button class="secondary" data-network-focus="recovery:${item.id}">Map</button>${data.capabilities.canManage ? `<button class="secondary" data-network-review="${data.recovery.batch.id}:${item.id}:confirmed">Батлах</button><button class="secondary" data-network-review="${data.recovery.batch.id}:${item.id}:needs_correction">Засвар</button>` : ""}</div></td></tr>`;
    }), 6)}
    </section>` : "";
  return `<div class="camera-network-lists">${recoverySection}<section><div class="lighting-section-title"><h2>Шилэн кабелийн трассын бүртгэл</h2><span>Устгахгүй; lifecycle төлвөөр архивлаж, геометрийн хувилбарыг хадгална.</span></div>
    ${cameraTable(["Код / трасс", "Core", "Урт", "Хувилбар", "Төлөв", "Үйлдэл"], routes.map(item => `<tr><td><button class="object-dossier-link" data-network-focus="route:${item.id}">${esc(item.name)}</button><small>${esc(item.code)} · ${esc(item.note || "Тайлбаргүй")}</small></td><td><span class="camera-network-core"><i style="background:${esc(item.color)}"></i>${Number(item.core_count)} core</span></td><td>${cameraNetworkLength(item.length_m)}</td><td>v${Number(item.revision_version)}</td><td><span class="badge ${item.status === "active" ? "active" : "inactive"}">${item.status === "active" ? "Идэвхтэй" : "Архивласан"}</span></td><td><button class="secondary" data-network-focus="route:${item.id}">Map дээр харах</button></td></tr>`), 6)}
    </section><section><div class="lighting-section-title"><h2>Муфт, ODF ба холболтын цэг</h2><span>Трассын холбоос болон GPS-ийг тусдаа canonical зангилаагаар хадгална.</span></div>
    ${cameraTable(["Код / цэг", "Төрөл", "Трассын холбоос", "GPS", "Төлөв"], nodes.map(item => `<tr><td><button class="object-dossier-link" data-network-focus="node:${item.id}">${esc(item.name)}</button><small>${esc(item.code)} · ${esc(item.note || "Тайлбаргүй")}</small></td><td>${esc(cameraNetworkNodeLabels[item.node_type] || item.node_type)}</td><td>${(item.routes || []).map(route => esc(route.name)).join(" · ") || "Холбоогүй"}</td><td>${Number(item.latitude).toFixed(6)}, ${Number(item.longitude).toFixed(6)}</td><td><span class="badge ${item.status === "active" ? "active" : "inactive"}">${item.status === "active" ? "Идэвхтэй" : "Архивласан"}</span></td></tr>`), 5)}
    </section></div>`;
}

function cameraNetworkCadToolbar(data) {
  const active = tool => state.cameraNetworkTool === tool ? "is-active" : "";
  return `<div class="camera-network-cad-toolbar">
    <div class="camera-network-tool-group" aria-label="Зураглалын хэрэгсэл">
      <button class="camera-network-tool ${active("")}" type="button" data-network-tool="select" title="Сонгох / харах"><b>⌖</b><span>Сонгох</span></button>
      <button class="camera-network-tool ${active("route")}" type="button" data-network-tool="route" ${data.capabilities.canManage ? "" : "disabled"} title="Шинэ трасс зурах"><b>⌁</b><span>Трасс</span></button>
      <button class="camera-network-tool ${active("node")}" type="button" data-network-tool="node" ${data.capabilities.canManage ? "" : "disabled"} title="Муфт эсвэл зангилаа нэмэх"><b>◆</b><span>Муфт / цэг</span></button>
      <button class="camera-network-tool ${active("gps")}" type="button" data-network-tool="gps" ${data.capabilities.canUpdateCameraGps ? "" : "disabled"} title="Камерын GPS оноох"><b>C</b><span>Камер GPS</span></button>
      <button class="camera-network-tool" type="button" data-network-undo title="Сүүлчийн зурсан цэгийг буцаах"><b>↶</b><span>Буцаах</span></button>
    </div>
    <div class="camera-network-tool-group camera-network-view-tools">
      <label class="camera-network-cad-search" title="Код, нэр, байршлаар хайх"><span>⌕</span><input type="search" value="${esc(state.cameraNetworkSearch)}" data-network-search placeholder="Хайлт..."></label>
      <button class="camera-network-tool" type="button" data-network-refresh title="Map болон бүртгэлийг шинэчлэх"><b>↻</b><span>Шинэчлэх</span></button>
      <button class="camera-network-tool" type="button" data-network-fit title="Бүх зураглалыг багтаах"><b>▣</b><span>Бүгдийг харах</span></button>
      <button class="camera-network-tool" type="button" data-network-full title="Map дэлгэцийг томруулах"><b>${state.cameraNetworkFull ? "🗗" : "⛶"}</b><span>${state.cameraNetworkFull ? "Буцаах" : "Томруулах"}</span></button>
    </div>
  </div>`;
}

function cameraNetworkStatusText() {
  if (state.cameraNetworkMode === "draw") return `Трасс зурж байна · ${state.cameraNetworkDraw.length} цэг`;
  if (state.cameraNetworkMode === "node") return "Муфт / зангилааны байршил сонгоно уу";
  if (state.cameraNetworkMode === "gps") return "Камерын GPS байршил сонгоно уу";
  return "Сонгох горим";
}

function cameraNetworkView() {
  const data = state.cameraNetwork;
  if (!data && !state.cameraNetworkLoading) queueMicrotask(() => loadCameraNetwork());
  if (state.cameraNetworkLoading && !data) return `<div class="panel">Шилэн кабелийн GIS мэдээллийг ачаалж байна...</div>`;
  if (!data) return `<div class="panel">Шилэн кабелийн мэдээлэл ачаалагдаагүй байна.</div>`;
  if (data.error) return `<div class="panel"><div class="error">${esc(data.error)}</div><button class="secondary" data-network-refresh>Дахин оролдох</button></div>`;
  queueMicrotask(initCameraNetworkMap);
  return `<section class="camera-network-shell ${state.cameraNetworkFull ? "is-full" : ""}" id="cameraNetworkShell">
    <div class="lighting-stat-grid camera-network-stats">${stat("Идэвхтэй трасс", data.summary.activeRoutes, cameraNetworkLength(data.summary.lengthM), "⌁", "purple")}${stat("Legacy preview", data.recovery?.summary?.candidates || 0, `${data.recovery?.summary?.vertices || 0} сэргээсэн цэг`, "↺", "orange")}${stat("Муфт / цэг", data.summary.activeNodes, "Трассын зангилаа", "◆", "orange")}${stat("Камерын GPS", data.summary.cameraPointsWithGps, `${data.summary.cameraPoints} цэгээс`, "⌖", "blue")}${stat("GPS-гүй", data.summary.cameraPoints - data.summary.cameraPointsWithGps, "Шалгаж оноох шаардлагатай", "!", "red")}</div>
    <div class="camera-network-workspace"><aside>${cameraNetworkLayerPanel(data)}</aside><main>${cameraNetworkCadToolbar(data)}<div class="camera-network-map-stage"><div id="cameraNetworkMap"></div>${cameraNetworkForms(data)}</div><div class="camera-network-statusbar"><span id="cameraNetworkModeStatus">${cameraNetworkStatusText()}</span><span id="cameraNetworkCoordinateStatus">Lat — · Lng —</span><span id="cameraNetworkZoomStatus">Zoom —</span></div></main>${cameraNetworkProperties()}</div>
    ${cameraNetworkTables(data)}
  </section>`;
}

function cameraNetworkIcon(symbol, color) {
  return L.divIcon({ className: "", html: `<div class="camera-network-marker" style="background:${color}">${symbol}</div>`, iconSize: [24, 24], iconAnchor: [12, 12] });
}

function cameraNetworkSetProperties(type, item) {
  const box = document.querySelector("#cameraNetworkProperties");
  if (!box) return;
  const data = state.cameraNetwork;
  if (type === "route") box.innerHTML = `<h4>${esc(item.name)}</h4><small>${esc(item.code)} · v${Number(item.revision_version)}</small><p><span class="camera-network-core"><i style="background:${esc(item.color)}"></i>${Number(item.core_count)} core</span> · ${cameraNetworkLength(item.length_m)}</p><p>${esc(item.note || "Тайлбаргүй")}</p>${data.capabilities.canManage && item.status === "active" ? `<button class="danger" data-network-archive="route:${item.id}:${item.version}">Архивлах</button>` : ""}`;
  if (type === "recovery") {
    const raw = item.source_geometry?.coordinates?.[0] || [];
    const fixed = item.normalized_geometry?.coordinates?.[0] || [];
    box.innerHTML = `<span class="eyebrow">CANONICAL БИШ</span><h4>${esc(item.proposed_name)}</h4><small>${esc(item.proposed_code)} · ${Number(item.proposed_core_count)} core</small><p>Эх: ${Number(raw[1]).toFixed(6)}, ${Number(raw[0]).toFixed(6)}</p><p>Сэргээсэн: ${Number(fixed[1]).toFixed(6)}, ${Number(fixed[0]).toFixed(6)}</p><p>Урт: ${cameraNetworkLength(item.source_length_m)} → ${cameraNetworkLength(item.recomputed_length_m)}</p><p>${item.review_decision ? `Сүүлчийн хяналт: ${esc(item.review_decision)}` : "Инженерийн хяналт хүлээж байна."}</p>`;
  }
  if (type === "node") box.innerHTML = `<h4>${esc(item.name)}</h4><small>${esc(item.code)} · ${esc(cameraNetworkNodeLabels[item.node_type] || item.node_type)}</small><p>${Number(item.latitude).toFixed(6)}, ${Number(item.longitude).toFixed(6)}</p><p>${esc(item.note || "Тайлбаргүй")}</p>${data.capabilities.canManage && item.status === "active" ? `<button class="danger" data-network-archive="node:${item.id}:${item.version}">Архивлах</button>` : ""}`;
  if (type === "camera") box.innerHTML = `<h4>${esc(item.object_name)} / ${esc(item.point_name)}</h4><small>${esc(item.object_code)} · ${Number(item.camera_count)} камер${item.target_kind === "legacy_object" ? " · profile хянаагүй" : ""}</small><p>${item.latitude === null ? "GPS байхгүй" : `${Number(item.latitude).toFixed(6)}, ${Number(item.longitude).toFixed(6)}`}</p><button class="secondary" data-network-select-camera="${item.target_kind}:${item.target_id}">GPS оноох</button>`;
}

function cameraNetworkUpdateStatus() {
  const mode = document.querySelector("#cameraNetworkModeStatus");
  const zoom = document.querySelector("#cameraNetworkZoomStatus");
  if (mode) mode.textContent = cameraNetworkStatusText();
  if (zoom && cameraNetworkMap) zoom.textContent = `Zoom ${cameraNetworkMap.getZoom()}`;
}

function cameraNetworkOpenTool(tool = "") {
  state.cameraNetworkTool = tool;
  const drawer = document.querySelector("#cameraNetworkToolDrawer");
  drawer?.classList.toggle("is-open", Boolean(tool));
  document.querySelectorAll(".camera-network-control-card").forEach(form => {
    const expected = tool === "route" ? "cameraNetworkRouteForm"
      : tool === "node" ? "cameraNetworkNodeForm" : tool === "gps" ? "cameraNetworkGpsForm" : "";
    form.classList.toggle("is-active", form.id === expected);
  });
  document.querySelectorAll("[data-network-tool]").forEach(button => {
    const selected = button.dataset.networkTool === (tool || "select");
    button.classList.toggle("is-active", selected);
  });
  cameraNetworkUpdateStatus();
  setTimeout(() => cameraNetworkMap?.invalidateSize({ pan: false, animate: false }), 40);
}

function cameraNetworkRefreshDraft() {
  if (cameraNetworkDraftLayer) cameraNetworkDraftLayer.remove();
  cameraNetworkDraftLayer = null;
  if (!cameraNetworkMap || state.cameraNetworkDraw.length < 1) return;
  const color = document.querySelector('#cameraNetworkRouteForm [name="color"]')?.value || cameraNetworkCoreColors[24];
  cameraNetworkDraftLayer = L.polyline(state.cameraNetworkDraw.map(([lng, lat]) => [lat, lng]), {
    color, weight: 5, dashArray: "8 6",
  }).addTo(cameraNetworkMap);
}

function cameraNetworkFitAll() {
  if (!cameraNetworkMap) return;
  const layers = cameraNetworkMapItems.map(item => item.layer).filter(Boolean);
  if (!layers.length) return cameraNetworkMap.setView([48.072, 114.532], 13);
  const group = L.featureGroup(layers);
  const bounds = group.getBounds();
  if (bounds.isValid()) cameraNetworkMap.fitBounds(bounds, { padding: [45, 45], maxZoom: 17 });
}

function cameraNetworkToggleFull(force) {
  state.cameraNetworkFull = typeof force === "boolean" ? force : !state.cameraNetworkFull;
  document.querySelector("#cameraNetworkShell")?.classList.toggle("is-full", state.cameraNetworkFull);
  document.querySelectorAll("[data-network-full]").forEach(button => {
    const icon = button.querySelector("b");
    const label = button.querySelector("span");
    if (icon && label) {
      icon.textContent = state.cameraNetworkFull ? "🗗" : "⛶";
      label.textContent = state.cameraNetworkFull ? "Буцаах" : "Томруулах";
    } else {
      button.textContent = state.cameraNetworkFull ? "Буцаах" : "GIS горим";
    }
  });
  setTimeout(() => cameraNetworkMap?.invalidateSize({ pan: false, animate: false }), 80);
}

function initCameraNetworkMap() {
  const element = document.querySelector("#cameraNetworkMap");
  const data = state.cameraNetwork;
  if (!element || !data || data.error || typeof L === "undefined") return;
  cameraNetworkResizeObserver?.disconnect();
  cameraNetworkResizeObserver = null;
  if (cameraNetworkMap) cameraNetworkMap.remove();
  cameraNetworkGroups = { cameras: L.layerGroup(), nodes: L.layerGroup(), routes: L.layerGroup(), recovery: L.layerGroup() };
  cameraNetworkMapItems = [];
  cameraNetworkMap = L.map(element, { zoomControl: true, minZoom: 3, maxZoom: 22,
    zoomAnimation: true, fadeAnimation: false }).setView([48.072, 114.532], 13);
  const tileOptions = { maxZoom: 22, keepBuffer: 8,
    updateWhenIdle: false, updateWhenZooming: false };
  const street = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    ...tileOptions, maxNativeZoom: 19, attribution: "© OpenStreetMap contributors",
  });
  const satellite = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    ...tileOptions, maxNativeZoom: 17, attribution: "Tiles © Esri",
  }).addTo(cameraNetworkMap);
  L.control.layers({ "Сансрын зураг": satellite, "Гудамжны зураг": street }, null, { position: "topleft" }).addTo(cameraNetworkMap);
  L.control.scale({ metric: true, imperial: false, position: "bottomleft" }).addTo(cameraNetworkMap);
  const bounds = [];
  data.routes.filter(item => item.status === "active").forEach(item => {
    const coordinates = item.geometry?.coordinates || [];
    const latLngs = coordinates.map(([lng, lat]) => [lat, lng]);
    if (latLngs.length < 2) return;
    const line = L.polyline(latLngs, { color: item.color, weight: 6, opacity: .9 }).bindTooltip(`${item.name} · ${item.core_count} core`).on("click", () => cameraNetworkSetProperties("route", item));
    line.networkCore = Number(item.core_count); line.addTo(cameraNetworkGroups.routes);
    cameraNetworkMapItems.push({ type: "route", id: item.id, layer: line, item }); bounds.push(...latLngs);
  });
  (data.recovery?.candidates || []).forEach(item => {
    const coordinates = item.normalized_geometry?.coordinates || [];
    const latLngs = coordinates.map(([lng, lat]) => [Number(lat), Number(lng)]);
    if (latLngs.length < 2) return;
    const line = L.polyline(latLngs, { color: item.proposed_color || "#f59e0b", weight: 5,
      opacity: .8, dashArray: "10 7" }).bindTooltip(`Legacy preview · ${item.proposed_name}`)
      .on("click", () => cameraNetworkSetProperties("recovery", item)).addTo(cameraNetworkGroups.recovery);
    cameraNetworkMapItems.push({ type: "recovery", id: item.id, layer: line, item });
    bounds.push(...latLngs);
  });
  data.nodes.filter(item => item.status === "active").forEach(item => {
    const marker = L.marker([Number(item.latitude), Number(item.longitude)], { icon: cameraNetworkIcon("◆", "#f97316") }).bindTooltip(item.name).on("click", () => cameraNetworkSetProperties("node", item)).addTo(cameraNetworkGroups.nodes);
    cameraNetworkMapItems.push({ type: "node", id: item.id, layer: marker, item }); bounds.push([Number(item.latitude), Number(item.longitude)]);
  });
  data.cameraPoints.filter(item => item.latitude !== null && item.longitude !== null).forEach(item => {
    const marker = L.marker([Number(item.latitude), Number(item.longitude)], { icon: cameraNetworkIcon("C", "#2563eb") }).bindTooltip(`${item.object_name} / ${item.point_name}`).on("click", () => cameraNetworkSetProperties("camera", item)).addTo(cameraNetworkGroups.cameras);
    cameraNetworkMapItems.push({ type: "camera", id: `${item.target_kind}:${item.target_id}`, layer: marker, item }); bounds.push([Number(item.latitude), Number(item.longitude)]);
  });
  Object.entries(cameraNetworkGroups).forEach(([key, group]) => { if (state.cameraNetworkLayers[key]) group.addTo(cameraNetworkMap); });
  if (bounds.length) cameraNetworkMap.fitBounds(bounds, { padding: [35, 35], maxZoom: 16 });
  cameraNetworkMap.on("click", event => cameraNetworkMapClicked(event.latlng));
  cameraNetworkMap.on("mousemove", event => {
    const status = document.querySelector("#cameraNetworkCoordinateStatus");
    if (status) status.textContent = `Lat ${event.latlng.lat.toFixed(6)} · Lng ${event.latlng.lng.toFixed(6)}`;
  });
  cameraNetworkMap.on("zoomend moveend", cameraNetworkUpdateStatus);
  if (typeof ResizeObserver !== "undefined") {
    cameraNetworkResizeObserver = new ResizeObserver(() => requestAnimationFrame(() => {
      cameraNetworkMap?.invalidateSize({ pan: false, animate: false });
    }));
    cameraNetworkResizeObserver.observe(element);
  }
  setTimeout(() => {
    cameraNetworkMap?.invalidateSize({ pan: false, animate: false });
    if (state.cameraNetworkMode === "draw" && state.cameraNetworkDraw.length) cameraNetworkRefreshDraft();
    if (["node", "gps"].includes(state.cameraNetworkMode) && state.cameraNetworkPoint) {
      cameraNetworkPreviewMarker = L.marker(
        [state.cameraNetworkPoint.latitude, state.cameraNetworkPoint.longitude],
        { icon: cameraNetworkIcon("+", "#dc2626") },
      ).addTo(cameraNetworkMap);
    }
    cameraNetworkUpdateStatus();
  }, 80);
}

function cameraNetworkMapClicked(latlng) {
  if (state.cameraNetworkMode === "draw") {
    state.cameraNetworkDraw.push([latlng.lng, latlng.lat]);
    cameraNetworkRefreshDraft();
    const hint = document.querySelector("#cameraNetworkDrawHint");
    if (hint) hint.textContent = `${state.cameraNetworkDraw.length} цэг сонголоо. Хадгалах товч дарж баталгаажуулна.`;
    cameraNetworkUpdateStatus();
    return;
  }
  if (!["node", "gps"].includes(state.cameraNetworkMode)) return;
  state.cameraNetworkPoint = { latitude: latlng.lat, longitude: latlng.lng };
  if (cameraNetworkPreviewMarker) cameraNetworkPreviewMarker.remove();
  cameraNetworkPreviewMarker = L.marker(latlng, { icon: cameraNetworkIcon("+", "#dc2626") }).addTo(cameraNetworkMap);
  const hint = document.querySelector(state.cameraNetworkMode === "node" ? "#cameraNetworkNodeHint" : "#cameraNetworkGpsHint");
  if (hint) hint.textContent = `Сонгосон GPS: ${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}. Хадгалах товч дарна уу.`;
  cameraNetworkUpdateStatus();
}

function cameraNetworkCancel() {
  state.cameraNetworkMode = ""; state.cameraNetworkDraw = []; state.cameraNetworkPoint = null;
  if (cameraNetworkDraftLayer) cameraNetworkDraftLayer.remove();
  if (cameraNetworkPreviewMarker) cameraNetworkPreviewMarker.remove();
  cameraNetworkDraftLayer = null; cameraNetworkPreviewMarker = null;
  ["#cameraNetworkDrawHint", "#cameraNetworkNodeHint", "#cameraNetworkGpsHint"].forEach(selector => {
    const item = document.querySelector(selector); if (item) item.textContent = "Үйлдэл цуцлагдлаа.";
  });
  cameraNetworkOpenTool("");
}

async function cameraNetworkReload(message) {
  state.cameraNetwork = null;
  await loadCameraNetwork(true);
  if (message) toast(message);
}

document.addEventListener("click", async event => {
  if (event.target.closest("[data-network-refresh]")) return loadCameraNetwork(true);
  const toolButton = event.target.closest("[data-network-tool]");
  if (toolButton) {
    const tool = toolButton.dataset.networkTool;
    cameraNetworkCancel();
    if (tool === "select") return;
    cameraNetworkOpenTool(tool);
    if (tool === "route") state.cameraNetworkMode = "draw";
    if (tool === "node") state.cameraNetworkMode = "node";
    if (tool === "gps") state.cameraNetworkMode = "gps";
    cameraNetworkUpdateStatus();
    return;
  }
  if (event.target.closest("[data-network-fit]")) return cameraNetworkFitAll();
  if (event.target.closest("[data-network-undo]")) {
    if (state.cameraNetworkMode !== "draw" || !state.cameraNetworkDraw.length) return toast("Буцаах зурсан цэг алга", true);
    state.cameraNetworkDraw.pop();
    cameraNetworkRefreshDraft();
    const hint = document.querySelector("#cameraNetworkDrawHint");
    if (hint) hint.textContent = `${state.cameraNetworkDraw.length} цэг үлдлээ.`;
    cameraNetworkUpdateStatus();
    return;
  }
  if (event.target.closest("[data-network-full]")) {
    cameraNetworkToggleFull(); return;
  }
  if (event.target.closest("[data-network-draw]")) {
    cameraNetworkCancel(); cameraNetworkOpenTool("route"); state.cameraNetworkMode = "draw";
    cameraNetworkUpdateStatus();
    const hint = document.querySelector("#cameraNetworkDrawHint"); if (hint) hint.textContent = "Map дээр дарааллаар 2-оос олон цэг дарна уу."; return;
  }
  if (event.target.closest("[data-network-node-pick]")) {
    cameraNetworkCancel(); cameraNetworkOpenTool("node"); state.cameraNetworkMode = "node";
    cameraNetworkUpdateStatus();
    const hint = document.querySelector("#cameraNetworkNodeHint"); if (hint) hint.textContent = "Map дээр зангилааны байршлыг дарна уу."; return;
  }
  if (event.target.closest("[data-network-gps-pick]")) {
    const selected = document.querySelector("[data-network-camera-point]")?.value;
    if (!selected) return toast("Эхлээд камерын цэг сонгоно уу", true);
    cameraNetworkCancel(); cameraNetworkOpenTool("gps"); state.cameraNetworkMode = "gps";
    cameraNetworkUpdateStatus();
    const hint = document.querySelector("#cameraNetworkGpsHint"); if (hint) hint.textContent = "Map дээр камерын шалгасан байршлыг дарна уу."; return;
  }
  if (event.target.closest("[data-network-cancel]")) return cameraNetworkCancel();
  if (event.target.closest("[data-network-camera-toggle]")) {
    state.cameraNetworkLayers.cameras = !state.cameraNetworkLayers.cameras;
    const group = cameraNetworkGroups.cameras;
    if (cameraNetworkMap && group) state.cameraNetworkLayers.cameras ? group.addTo(cameraNetworkMap) : cameraNetworkMap.removeLayer(group);
    event.target.closest("button").textContent = `Камер: ${state.cameraNetworkLayers.cameras ? "ON" : "OFF"}`; return;
  }
  const selectCamera = event.target.closest("[data-network-select-camera]");
  if (selectCamera) {
    cameraNetworkOpenTool("gps");
    const select = document.querySelector("[data-network-camera-point]"); if (select) select.value = selectCamera.dataset.networkSelectCamera;
    state.cameraNetworkMode = "gps"; cameraNetworkUpdateStatus(); return;
  }
  const focus = event.target.closest("[data-network-focus]");
  if (focus && cameraNetworkMap) {
    const [type, id] = focus.dataset.networkFocus.split(":");
    const found = cameraNetworkMapItems.find(item => item.type === type && item.id === id);
    if (found) {
      if (["route", "recovery"].includes(type)) cameraNetworkMap.fitBounds(found.layer.getBounds(), { padding: [40, 40], maxZoom: 17 });
      else cameraNetworkMap.setView(found.layer.getLatLng(), 17);
      found.layer.openTooltip(); cameraNetworkSetProperties(type, found.item);
    }
    return;
  }
  const review = event.target.closest("[data-network-review]");
  if (review) {
    const [batchId, candidateId, decision] = review.dataset.networkReview.split(":");
    const promptText = decision === "confirmed" ? "Зураг дээр шалгасан тэмдэглэл:" : "Засах шаардлагатай шалтгаан:";
    const note = prompt(promptText, decision === "confirmed"
      ? "Сэргээсэн трассыг зураг болон уртаар шалгав"
      : "Байршлыг нэмэлт эхтэй тулгах шаардлагатай");
    if (!note) return;
    try {
      await api(`/api/camera/network/imports/${batchId}/candidates/${candidateId}/reviews`, {
        method: "POST", body: JSON.stringify({ decision, note }),
      });
      await cameraNetworkReload("Legacy трассын хяналтын шийдвэр аудиттай хадгалагдлаа");
    } catch (error) { toast(error.message, true); }
    return;
  }
  const archive = event.target.closest("[data-network-archive]");
  if (archive) {
    const [type, id, version] = archive.dataset.networkArchive.split(":");
    const reason = prompt(`${type === "route" ? "Трасс" : "Цэг"} архивлах шалтгаан:`);
    if (!reason) return;
    try { await api(`/api/camera/network/${type === "route" ? "routes" : "nodes"}/${id}/archive`, { method: "POST", body: JSON.stringify({ expectedVersion: Number(version), reason }) }); await cameraNetworkReload("Архивын төлөв аудиттайгаар хадгалагдлаа"); }
    catch (error) { toast(error.message, true); }
  }
});

document.addEventListener("change", event => {
  if (event.target.matches("[data-network-core-select]")) {
    const color = document.querySelector('#cameraNetworkRouteForm [name="color"]');
    if (color) color.value = cameraNetworkCoreColors[Number(event.target.value)] || "#7c3aed";
  }
  const layer = event.target.closest("[data-network-layer]");
  if (layer && cameraNetworkMap) {
    const key = layer.dataset.networkLayer; state.cameraNetworkLayers[key] = layer.checked;
    layer.checked ? cameraNetworkGroups[key]?.addTo(cameraNetworkMap) : cameraNetworkMap.removeLayer(cameraNetworkGroups[key]);
  }
  const core = event.target.closest("[data-network-core]");
  if (core && cameraNetworkMap) cameraNetworkMapItems.filter(item => item.type === "route" && item.layer.networkCore === Number(core.dataset.networkCore)).forEach(item => {
    if (core.checked && state.cameraNetworkLayers.routes) item.layer.addTo(cameraNetworkGroups.routes); else cameraNetworkGroups.routes.removeLayer(item.layer);
  });
});

document.addEventListener("input", event => {
  if (!event.target.matches("[data-network-search]")) return;
  state.cameraNetworkSearch = event.target.value;
  const query = state.cameraNetworkSearch.trim().toLocaleLowerCase("mn");
  cameraNetworkMapItems.forEach(item => {
    const text = `${item.item.code || ""} ${item.item.name || item.item.object_name || ""} ${item.item.point_name || ""}`.toLocaleLowerCase("mn");
    if (query && text.includes(query)) {
      if (item.type === "route") cameraNetworkMap.fitBounds(item.layer.getBounds(), { padding: [30, 30], maxZoom: 17 });
      else cameraNetworkMap.setView(item.layer.getLatLng(), 17);
    }
  });
});

document.addEventListener("keydown", event => {
  if (state.view !== "camera" || state.cameraTab !== "network") return;
  const editing = ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName);
  if (event.key === "Escape") {
    if (state.cameraNetworkMode || state.cameraNetworkTool) cameraNetworkCancel();
    else if (state.cameraNetworkFull) cameraNetworkToggleFull(false);
    return;
  }
  if (!editing && state.cameraNetworkMode === "draw" && ["Backspace", "Delete"].includes(event.key)) {
    event.preventDefault();
    if (state.cameraNetworkDraw.length) {
      state.cameraNetworkDraw.pop();
      cameraNetworkRefreshDraft();
      cameraNetworkUpdateStatus();
    }
  }
});

document.addEventListener("submit", async event => {
  if (!['cameraNetworkRouteForm', 'cameraNetworkNodeForm', 'cameraNetworkGpsForm'].includes(event.target.id)) return;
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.target));
  try {
    if (event.target.id === "cameraNetworkRouteForm") {
      if (state.cameraNetworkDraw.length < 2) return toast("Доод тал нь 2 цэгтэй трасс зурна уу", true);
      await api("/api/camera/network/routes", { method: "POST", body: JSON.stringify({ name: values.name, coreCount: Number(values.coreCount), color: values.color, note: values.note, coordinates: state.cameraNetworkDraw }) });
      cameraNetworkCancel(); await cameraNetworkReload("Шилэн кабелийн трассыг аудиттайгаар бүртгэлээ");
    }
    if (event.target.id === "cameraNetworkNodeForm") {
      if (!state.cameraNetworkPoint) return toast("Map дээр цэгийн байршил сонгоно уу", true);
      const routeIds = [...new Set([values.routeA, values.routeB].filter(Boolean))];
      await api("/api/camera/network/nodes", { method: "POST", body: JSON.stringify({ name: values.name, nodeType: values.nodeType, note: values.note, routeIds, ...state.cameraNetworkPoint }) });
      cameraNetworkCancel(); await cameraNetworkReload("Сүлжээний цэгийг аудиттайгаар бүртгэлээ");
    }
    if (event.target.id === "cameraNetworkGpsForm") {
      if (!values.cameraPointId) return toast("Камерын цэг сонгоно уу", true);
      if (!state.cameraNetworkPoint) return toast("Map дээр GPS байршил сонгоно уу", true);
      const [targetKind, targetId] = values.cameraPointId.split(":");
      const point = state.cameraNetwork.cameraPoints.find(item => item.target_kind === targetKind && item.target_id === targetId);
      if (!point) return toast("Сонгосон камерын цэг олдсонгүй", true);
      const targetPath = targetKind === "legacy_object" ? `camera-objects/${targetId}/initial-location` : `camera-points/${targetId}/location`;
      await api(`/api/camera/network/${targetPath}`, { method: "POST", body: JSON.stringify({ expectedObjectVersion: Number(point.object_version), note: values.note, ...state.cameraNetworkPoint }) });
      cameraNetworkCancel(); state.cameraWorkspace = null; await loadCamera(true); await cameraNetworkReload("Камерын GPS-ийг шинэ master хувилбараар хадгаллаа");
    }
  } catch (error) { toast(error.message, true); }
});

window.cameraNetworkView = cameraNetworkView;
window.loadCameraNetwork = loadCameraNetwork;
