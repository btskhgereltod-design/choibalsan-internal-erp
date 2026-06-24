import { API, state, api, escapeHtml, toast } from "./common.js";

let _citizenRows = [];
let _citizenStatus = "";
let _citizenView = "reports";
let _publicPosts = [];

const STATUS_LABELS = {
  new: "Шинэ",
  accepted: "Хүлээн авсан",
  working: "Ажиллаж байна",
  done: "Дууссан",
  rejected: "Буцаасан",
};

function statusOptions(selected = "") {
  return Object.entries(STATUS_LABELS)
    .map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`)
    .join("");
}

function statusPill(status = "new") {
  const colors = {
    new: ["#eff6ff", "#1d4ed8"],
    accepted: ["#fef9c3", "#a16207"],
    working: ["#fff7ed", "#c2410c"],
    done: ["#dcfce7", "#15803d"],
    rejected: ["#f1f5f9", "#64748b"],
  }[status] || ["#f1f5f9", "#64748b"];
  return `<span style="display:inline-flex;border-radius:999px;background:${colors[0]};color:${colors[1]};padding:3px 9px;font-size:11px;font-weight:900">${STATUS_LABELS[status] || status}</span>`;
}

async function loadCitizenReports() {
  const qs = _citizenStatus ? `?status=${encodeURIComponent(_citizenStatus)}` : "";
  _citizenRows = await api(`/api/citizen-reports${qs}`).catch(e => {
    toast(e.message);
    return [];
  });
}

function reportCard(r) {
  const image = r.image_url ? `<img src="${escapeHtml(r.image_url)}" style="width:100%;height:150px;object-fit:cover;border-radius:8px;border:1px solid #e2e8f0">` : "";
  const doneImage = r.after_image_url ? `<img src="${escapeHtml(r.after_image_url)}" style="width:100%;height:110px;object-fit:cover;border-radius:8px;border:1px solid #dcfce7;margin-top:8px">` : "";
  return `
    <article class="panel" style="padding:14px;display:flex;flex-direction:column;gap:10px">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
        <div>
          <div style="font-size:13px;font-weight:900;color:#1d4ed8">${escapeHtml(r.tracking_code)}</div>
          <div style="font-size:16px;font-weight:900;color:#0f172a;margin-top:3px">${escapeHtml(r.issue_type)}</div>
        </div>
        ${statusPill(r.status)}
      </div>
      ${image}
      <div style="font-size:12px;color:#475569;line-height:1.5">
        <b>Байршил:</b> ${escapeHtml(r.location)}<br>
        <b>Тайлбар:</b> ${escapeHtml(r.description)}<br>
        ${r.phone ? `<b>Утас:</b> ${escapeHtml(r.phone)}<br>` : ""}
        ${r.gps_lat && r.gps_lng ? `<b>GPS:</b> ${Number(r.gps_lat).toFixed(6)}, ${Number(r.gps_lng).toFixed(6)}<br>` : ""}
        <b>Ирсэн:</b> ${escapeHtml(String(r.created_at || "").slice(0, 16))}
      </div>
      ${r.resolution_note ? `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:9px;font-size:12px;color:#334155">${escapeHtml(r.resolution_note)}</div>` : ""}
      ${doneImage}
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:auto">
        <button class="btn secondary" style="padding:6px 10px;font-size:12px" onclick="openCitizenReport(${r.id})">Засах</button>
        ${r.gps_lat && r.gps_lng ? `<button class="btn secondary" style="padding:6px 10px;font-size:12px" onclick="window.open('https://maps.google.com/?q=${Number(r.gps_lat)},${Number(r.gps_lng)}','_blank')">Map</button>` : ""}
      </div>
    </article>
  `;
}

function renderCitizenReports() {
  const main = document.getElementById("main");
  const counts = _citizenRows.reduce((m, r) => (m[r.status] = (m[r.status] || 0) + 1, m), {});
  main.innerHTML = `
    ${citizenTopTabs()}
    <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:16px">
      <div>
        <h1 style="margin:0 0 4px;font-size:22px;font-weight:900">Иргэдээс ирсэн мэдээлэл</h1>
        <div style="font-size:12px;color:#667085">Public portal-оор ирсэн гэмтэл, санал хүсэлт, хийсэн ажлын public тайлан</div>
      </div>
      <button class="btn secondary" onclick="window.open('/portal','_blank')">Public portal нээх</button>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
      ${[
        ["", "Бүгд", _citizenRows.length],
        ["new", "Шинэ", counts.new || 0],
        ["accepted", "Хүлээн авсан", counts.accepted || 0],
        ["working", "Ажиллаж байна", counts.working || 0],
        ["done", "Дууссан", counts.done || 0],
        ["rejected", "Буцаасан", counts.rejected || 0],
      ].map(([key, label, count]) => {
        const active = _citizenStatus === key;
        return `<button onclick="citizenReportFilter('${key}')" style="border:1px solid ${active ? "#2563eb" : "#dbe3ef"};background:${active ? "#eff6ff" : "#fff"};color:${active ? "#1d4ed8" : "#475569"};border-radius:8px;padding:8px 11px;font-size:12px;font-weight:900;cursor:pointer">${label} (${count})</button>`;
      }).join("")}
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px">
      ${_citizenRows.length ? _citizenRows.map(reportCard).join("") : `<div class="panel" style="grid-column:1/-1;padding:34px;text-align:center;color:#667085">Мэдээлэл алга байна</div>`}
    </div>
    <div id="citizenReportModal" style="display:none;position:fixed;inset:0;background:rgba(15,23,42,.48);z-index:2200;align-items:flex-start;justify-content:center;padding:30px 12px;overflow:auto" onclick="if(event.target===this)closeCitizenReport()">
      <div id="citizenReportInner" style="background:#fff;border-radius:12px;width:min(680px,96vw);box-shadow:0 22px 70px rgba(15,23,42,.28);overflow:hidden"></div>
    </div>
  `;
}

function citizenTopTabs() {
  const tab = (key, label) => `
    <button onclick="citizenReportsView('${key}')"
      style="padding:10px 16px;border:none;border-bottom:3px solid ${_citizenView === key ? "#2563eb" : "transparent"};background:#fff;color:${_citizenView === key ? "#1d4ed8" : "#667085"};font-size:13px;font-weight:900;cursor:pointer">
      ${label}
    </button>`;
  return `<div style="display:flex;gap:0;border:1px solid #e2e8f0;border-radius:10px 10px 0 0;background:#fff;margin-bottom:16px;overflow:auto">
    ${tab("reports", "📣 Иргэдээс ирсэн мэдээлэл")}
    ${tab("posts", "📰 Иргэдэд нийтлэх мэдээлэл")}
  </div>`;
}

async function loadPublicPosts() {
  _publicPosts = await api("/api/public-posts").catch(e => {
    toast(e.message);
    return [];
  });
}

function publicPostTypeLabel(type) {
  return { news: "Мэдээ", announcement: "Зарлал", job: "Ажлын байр" }[type] || "Мэдээ";
}

async function renderPublicPosts() {
  const main = document.getElementById("main");
  await loadPublicPosts();
  main.innerHTML = `
    ${citizenTopTabs()}
    <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:16px">
      <div>
        <h1 style="margin:0 0 4px;font-size:22px;font-weight:900">Иргэдэд нийтлэх мэдээлэл</h1>
        <div style="font-size:12px;color:#667085">Public нүүрний “Мэдээ” хэсэгт гарах мэдээ, зарлал, ажлын байр.</div>
      </div>
      <button class="btn secondary" onclick="window.open('/portal#news','_blank')">Public мэдээ харах</button>
    </div>

    <form id="publicPostForm" class="panel" style="padding:16px;margin-bottom:16px" onsubmit="savePublicPost(event)">
      <div style="display:grid;grid-template-columns:180px 1fr 180px;gap:10px;margin-bottom:10px">
        <select class="input" name="post_type">
          <option value="news">Мэдээ</option>
          <option value="announcement">Зарлал</option>
          <option value="job">Ажлын байр</option>
        </select>
        <input class="input" name="title" placeholder="Гарчиг" required>
        <label style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:800;color:#475569">
          <input type="checkbox" name="featured" value="1"> Онцлох
        </label>
      </div>
      <textarea class="input" name="summary" placeholder="Товч тайлбар public card дээр харагдана" required style="min-height:64px;resize:vertical;margin-bottom:10px"></textarea>
      <textarea class="input" name="body" placeholder="Дэлгэрэнгүй текст / ажлын байрны шаардлага, үүрэг..." style="min-height:90px;resize:vertical;margin-bottom:10px"></textarea>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 180px;gap:10px;align-items:center">
        <input class="input" name="deadline" type="date" title="Ажлын байрны материал авах хугацаа">
        <input class="input" name="contact_phone" placeholder="Холбогдох утас">
        <input class="input" name="contact_email" placeholder="И-мэйл">
        <input class="input" name="image" type="file" accept="image/*">
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:12px">
        <button class="btn" type="submit">Нийтлэх</button>
      </div>
    </form>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px">
      ${_publicPosts.length ? _publicPosts.map(publicPostCard).join("") : `<div class="panel" style="grid-column:1/-1;padding:28px;text-align:center;color:#667085">Одоогоор public мэдээ алга байна</div>`}
    </div>`;
}

function publicPostCard(p) {
  const image = p.image_url ? `<img src="${escapeHtml(p.image_url)}" style="width:100%;height:130px;object-fit:cover;border-radius:8px;border:1px solid #e2e8f0;margin-bottom:10px">` : "";
  return `
    <article class="panel" style="padding:14px;display:flex;flex-direction:column;gap:8px">
      ${image}
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
        <div>
          <div style="font-size:11px;font-weight:900;color:#1d4ed8">${publicPostTypeLabel(p.post_type)} ${p.featured ? " · Онцлох" : ""}</div>
          <div style="font-size:15px;font-weight:900;color:#0f172a;margin-top:4px">${escapeHtml(p.title || "")}</div>
        </div>
        <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#475569;font-weight:800">
          <input type="checkbox" ${Number(p.published) ? "checked" : ""} onchange="togglePublicPost(${p.id}, this.checked)">
          Нийтлэх
        </label>
      </div>
      <div style="font-size:12px;color:#475569;line-height:1.45">${escapeHtml(p.summary || "")}</div>
      ${p.deadline ? `<div style="font-size:12px;color:#1d4ed8;font-weight:900">Материал авах: ${escapeHtml(String(p.deadline).slice(0,10))}</div>` : ""}
    </article>`;
}

async function savePublicPost(e) {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector("button[type='submit']");
  btn.disabled = true;
  try {
    const fd = new FormData(form);
    if (!form.featured.checked) fd.set("featured", "0");
    fd.set("published", "1");
    const res = await fetch(`${API}/api/public-posts`, {
      method: "POST",
      headers: { Authorization: "Bearer " + state.token },
      body: fd,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Нийтлэх үед алдаа гарлаа");
    toast("Public мэдээ нийтлэгдлээ");
    form.reset();
    await renderPublicPosts();
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
  }
}

async function togglePublicPost(id, published) {
  try {
    await api(`/api/public-posts/${id}`, { method: "PATCH", body: JSON.stringify({ published: published ? 1 : 0 }) });
    toast(published ? "Нийтлэгдлээ" : "Нуугдлаа");
    await renderPublicPosts();
  } catch(e) { toast(e.message); }
}

async function citizenReportsView(view) {
  _citizenView = view;
  if (view === "posts") return renderPublicPosts();
  await loadCitizenReports();
  renderCitizenReports();
}

function openCitizenReport(id) {
  const r = _citizenRows.find(x => Number(x.id) === Number(id));
  const modal = document.getElementById("citizenReportModal");
  const inner = document.getElementById("citizenReportInner");
  if (!r || !modal || !inner) return;
  inner.innerHTML = `
    <form id="citizenEditForm" onsubmit="saveCitizenReport(event, ${r.id})">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;padding:16px;border-bottom:1px solid #e2e8f0">
        <div>
          <div style="font-size:13px;font-weight:900;color:#1d4ed8">${escapeHtml(r.tracking_code)}</div>
          <div style="font-size:16px;font-weight:900;color:#0f172a">${escapeHtml(r.issue_type)} · ${escapeHtml(r.location)}</div>
        </div>
        <button type="button" class="btn secondary" onclick="closeCitizenReport()" style="padding:6px 10px">Хаах</button>
      </div>
      <div style="padding:16px;display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <label style="font-size:12px;font-weight:900;color:#334155">Төлөв
          <select name="status" class="input" style="margin-top:6px">${statusOptions(r.status)}</select>
        </label>
        <label style="font-size:12px;font-weight:900;color:#334155">Priority
          <select name="priority" class="input" style="margin-top:6px">
            <option value="normal" ${r.priority === "normal" ? "selected" : ""}>Энгийн</option>
            <option value="high" ${r.priority === "high" ? "selected" : ""}>Яаралтай</option>
            <option value="low" ${r.priority === "low" ? "selected" : ""}>Бага</option>
          </select>
        </label>
        <label style="grid-column:1/-1;font-size:12px;font-weight:900;color:#334155">Хийсэн ажил / тайлбар
          <textarea name="resolution_note" class="input" style="margin-top:6px;min-height:100px">${escapeHtml(r.resolution_note || "")}</textarea>
        </label>
        <label style="font-size:12px;font-weight:900;color:#334155">Өмнөх зураг
          <input name="before_image" type="file" accept="image/*" class="input" style="margin-top:6px">
        </label>
        <label style="font-size:12px;font-weight:900;color:#334155">Дараах зураг
          <input name="after_image" type="file" accept="image/*" class="input" style="margin-top:6px">
        </label>
        <label style="grid-column:1/-1;display:flex;gap:8px;align-items:center;font-size:12px;font-weight:900;color:#334155">
          <input name="publish_public" type="checkbox" value="1" ${Number(r.publish_public || 0) ? "checked" : ""}>
          Public сайт дээр хийсэн ажил болгон нийтлэх
        </label>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;padding:14px 16px;border-top:1px solid #e2e8f0;background:#f8fafc">
        <button type="button" class="btn secondary" onclick="closeCitizenReport()">Цуцлах</button>
        <button class="btn" type="submit">Хадгалах</button>
      </div>
    </form>
  `;
  modal.style.display = "flex";
}

function closeCitizenReport() {
  const modal = document.getElementById("citizenReportModal");
  if (modal) modal.style.display = "none";
}

async function saveCitizenReport(e, id) {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector("button[type='submit']");
  btn.disabled = true;
  try {
    const fd = new FormData(form);
    if (!form.publish_public.checked) fd.set("publish_public", "0");
    const res = await fetch(`${API}/api/citizen-reports/${id}`, {
      method: "PATCH",
      headers: { Authorization: "Bearer " + state.token },
      body: fd,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Хадгалах үед алдаа гарлаа");
    toast("Хадгаллаа");
    closeCitizenReport();
    await loadCitizenReports();
    renderCitizenReports();
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
  }
}

async function citizenReportFilter(status = "") {
  _citizenStatus = status;
  await loadCitizenReports();
  renderCitizenReports();
}

async function citizen_reports() {
  if (_citizenView === "posts") return renderPublicPosts();
  await loadCitizenReports();
  renderCitizenReports();
}

Object.assign(window, {
  citizen_reports,
  citizenReportsView,
  savePublicPost,
  togglePublicPost,
  citizenReportFilter,
  openCitizenReport,
  closeCitizenReport,
  saveCitizenReport,
});
