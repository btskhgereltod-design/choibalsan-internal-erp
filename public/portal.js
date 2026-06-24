const $ = (sel) => document.querySelector(sel);

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function statusLabel(status) {
  return {
    new: "Шинэ",
    accepted: "Хүлээн авсан",
    working: "Ажиллаж байна",
    done: "Дууссан",
    rejected: "Буцаасан",
  }[status] || status || "Шинэ";
}

function fmtDate(v) {
  if (!v) return "";
  const d = new Date(String(v).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 10);
  return d.toLocaleDateString("mn-MN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function fmtDateDots(v) {
  return fmtDate(v).replace(/\//g, ".");
}

async function jsonFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Алдаа гарлаа");
  return data;
}

async function loadSummary() {
  try {
    const s = await jsonFetch("/api/public-portal/summary");
    if ($("#statServices"))   $("#statServices").textContent   = s.services || 4;
    if ($("#statReports"))    $("#statReports").textContent    = s.reports || 0;
    if ($("#statDone"))       $("#statDone").textContent       = s.done || 0;
    if ($("#statActive"))     $("#statActive").textContent     = s.active || 0;
    if (s.employees && $("#statEmployees")) $("#statEmployees").textContent = s.employees;
    if (s.poles     && $("#statPoles"))     $("#statPoles").textContent     = Number(s.poles).toLocaleString();
    if (s.cameras   && $("#statCameras"))   $("#statCameras").textContent   = s.cameras;
  } catch (_) {}
}

async function loadCompletedWorks() {
  const box = $("#completedWorks");
  if (!box) return;
  try {
    const rows = await jsonFetch("/api/public-portal/completed");
    if (!rows.length) {
      box.innerHTML = `<div class="empty">Нийтлэхээр тэмдэглэсэн хийсэн ажил одоогоор алга байна.</div>`;
      return;
    }
    box.innerHTML = rows.map(r => `
      <article>
        ${r.after_image_url ? `<img src="${r.after_image_url}" alt="">` : `<img src="/portal-hero-city.png" alt="">`}
        <div>
          <b>${r.issue_type} · ${r.location}</b>
          <span>${fmtDate(r.closed_at || r.created_at)} · ${r.resolution_note || "Ажил дууссан"}</span>
        </div>
      </article>
    `).join("");
  } catch (e) {
    box.innerHTML = `<div class="empty">${e.message}</div>`;
  }
}

function postTypeLabel(type) {
  return {
    news: "Мэдээ",
    announcement: "Зарлал",
    job: "Ажлын байр",
  }[type] || "Мэдээ";
}

async function loadPublicNews() {
  const box = $("#publicNewsGrid");
  if (!box) return;
  const fallback = box.innerHTML;
  try {
    const rows = await jsonFetch("/api/public-portal/posts");
    if (!rows.length) {
      box.innerHTML = fallback;
      return;
    }
    box.innerHTML = rows.slice(0, 6).map(p => `
      <article>
        <img src="${p.image_url ? esc(p.image_url) : "/portal-hero-city.png"}" alt="">
        <div>
          <time>${postTypeLabel(p.post_type)} · ${fmtDateDots(p.deadline || p.created_at)}</time>
          <b>${esc(p.title)}</b>
          <span>${esc(p.summary || p.body || "")}</span>
          ${p.post_type === "job" && p.deadline ? `<span class="jobDeadline">Материал авах: ${fmtDateDots(p.deadline)} хүртэл</span>` : ""}
        </div>
      </article>
    `).join("");
  } catch (_) {
    box.innerHTML = fallback;
  }
}

function fallbackAlerts() {
  return [{
    title: "Өнөөдрийн ХАБЭА сэрэмжлүүлэг",
    body: "Цахилгааны байгууламж, шон, утас, засварын бүсэд ойртохдоо анхааралтай байж, хүүхэд багачуудыг ойртуулахгүй байна уу.",
    level: "warning",
    location: "Нийтийн эзэмшлийн талбай",
  }];
}

function renderSafetyAlerts(rows) {
  const alerts = rows?.length ? rows : fallbackAlerts();
  const first = alerts[0];
  const float = $("#safetyFloat");
  const title = $("#safetyFloatTitle");
  const body = $("#safetyFloatBody");
  const list = $("#safetyAlertList");
  if (!float || !title || !body || !list) return;

  float.dataset.level = first.level || "warning";
  title.textContent = first.title || "ХАБЭА сэрэмжлүүлэг";
  body.textContent = first.body || "";
  list.innerHTML = alerts.map(a => `
    <article class="safetyAlertItem" data-level="${esc(a.level || "warning")}">
      ${a.image_url ? `<img class="safetyAlertImage" src="${esc(a.image_url)}" alt="">` : ""}
      <b>${esc(a.title)}</b>
      <p>${esc(a.body)}</p>
      <div class="safetyAlertMeta">
        ${a.location ? `<span>${esc(a.location)}</span>` : ""}
        ${a.ends_at ? `<span>Дуусах: ${esc(fmtDate(a.ends_at))}</span>` : ""}
      </div>
    </article>
  `).join("");
}

async function loadSafetyAlerts() {
  try {
    renderSafetyAlerts(await jsonFetch("/api/public-portal/alerts"));
  } catch (_) {
    renderSafetyAlerts([]);
  }
}

function bindSafetyFloat() {
  const btn = $("#safetyFloatBtn");
  const close = $("#safetyFloatClose");
  const panel = $("#safetyFloatPanel");
  btn?.addEventListener("click", () => {
    if (panel) panel.hidden = !panel.hidden;
  });
  close?.addEventListener("click", e => {
    e.stopPropagation();
    if (panel) panel.hidden = true;
  });
}

function bindGps() {
  $("#gpsBtn")?.addEventListener("click", () => {
    if (!navigator.geolocation) {
      $("#gpsText").textContent = "Таны browser GPS дэмжихгүй байна";
      return;
    }
    $("#gpsText").textContent = "GPS авч байна...";
    navigator.geolocation.getCurrentPosition(pos => {
      const lat = pos.coords.latitude.toFixed(6);
      const lng = pos.coords.longitude.toFixed(6);
      document.querySelector("[name='gps_lat']").value = lat;
      document.querySelector("[name='gps_lng']").value = lng;
      $("#gpsText").textContent = `${lat}, ${lng}`;
    }, () => {
      $("#gpsText").textContent = "GPS авах боломжгүй байна";
    }, { enableHighAccuracy: true, timeout: 10000 });
  });
}

function bindReportForm() {
  const form = $("#reportForm");
  if (!form) return;
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const result = $("#reportResult");
    const btn = form.querySelector(".submitBtn");
    result.hidden = true;
    btn.disabled = true;
    btn.textContent = "Илгээж байна...";
    try {
      const data = await jsonFetch("/api/public-portal/reports", {
        method: "POST",
        body: new FormData(form),
      });
      result.hidden = false;
      result.innerHTML = `Амжилттай илгээгдлээ. Таны хяналтын код: <b>${data.tracking_code}</b>`;
      $("#trackCode").value = data.tracking_code;
      form.reset();
      $("#gpsText").textContent = "GPS сонгоогүй";
      loadSummary();
    } catch (err) {
      result.hidden = false;
      result.style.background = "#fef2f2";
      result.style.borderColor = "#fecaca";
      result.style.color = "#991b1b";
      result.textContent = err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = "Илгээх";
    }
  });
}

function bindTracking() {
  $("#trackBtn")?.addEventListener("click", async () => {
    const code = $("#trackCode").value.trim().toUpperCase();
    const box = $("#trackResult");
    if (!code) {
      box.textContent = "Хяналтын кодоо оруулна уу.";
      return;
    }
    box.textContent = "Шалгаж байна...";
    try {
      const r = await jsonFetch(`/api/public-portal/reports/${encodeURIComponent(code)}`);
      box.innerHTML = `
        <b>${r.tracking_code}</b><br>
        Төрөл: ${r.issue_type}<br>
        Байршил: ${r.location}<br>
        Төлөв: <b>${statusLabel(r.status)}</b><br>
        ${r.resolution_note ? `Тайлбар: ${r.resolution_note}<br>` : ""}
        Илгээсэн: ${fmtDate(r.created_at)}
      `;
    } catch (err) {
      box.textContent = err.message;
    }
  });
}

loadSummary();
loadPublicNews();
loadCompletedWorks();
loadSafetyAlerts();
bindGps();
bindReportForm();
bindTracking();
bindSafetyFloat();
