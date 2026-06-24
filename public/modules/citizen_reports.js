import { API, state, api, escapeHtml, toast } from "./common.js";

let _citizenRows = [];
let _citizenStatus = "";
let _citizenView = "reports";
let _statsYear = new Date().getFullYear();
let _statsMonth = new Date().getMonth() + 1;
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

const CITIZEN_CATEGORIES = [
  { value: "Гэрэлтүүлэг",  roles: ["electric"] },
  { value: "Камер",         roles: ["camera_engineer"] },
  { value: "Замын дохио",   roles: ["electric", "engineer"] },
  { value: "Замын засвар",  roles: ["engineer", "worker"] },
  { value: "Бусад",         roles: [] },
];

function reportRow(r) {
  const date = String(r.created_at || "").slice(0, 10);
  const desc = escapeHtml((r.description || "").slice(0, 55)) + ((r.description || "").length > 55 ? "…" : "");
  return `
    <div style="display:grid;grid-template-columns:128px 140px 1fr 95px 108px auto;gap:8px;align-items:center;padding:9px 12px;border-bottom:1px solid #f1f5f9;font-size:12px">
      <div style="font-weight:900;color:#1d4ed8;white-space:nowrap">${escapeHtml(r.tracking_code)}</div>
      <div style="font-weight:700;color:#0f172a">${escapeHtml(r.issue_type)}</div>
      <div style="color:#475569;line-height:1.4">${escapeHtml(r.location)}<br><span style="color:#94a3b8;font-size:11px">${desc}</span></div>
      <div style="color:#64748b;line-height:1.4">${date}${r.phone ? `<br><span style="color:#94a3b8">${escapeHtml(r.phone)}</span>` : ""}</div>
      <div>${statusPill(r.status)}</div>
      <div style="display:flex;gap:4px;flex-wrap:nowrap">
        ${r.status === "new" ? `<button class="btn" style="padding:4px 8px;font-size:11px;background:#16a34a;color:#fff;white-space:nowrap" onclick="openAcceptModal(${r.id})">✓ Авах</button>` : ""}
        ${r.image_url ? `<button class="btn secondary" style="padding:4px 8px;font-size:11px" title="Зураг харах" onclick="openImageViewer('${escapeHtml(r.image_url)}')">🔍</button>` : ""}
        <button class="btn secondary" style="padding:4px 8px;font-size:11px" onclick="openCitizenReport(${r.id})">Шийдвэрлэх</button>
        ${r.gps_lat && r.gps_lng ? `<button class="btn secondary" style="padding:4px 8px;font-size:11px" title="Газрын зураг" onclick="window.open('https://maps.google.com/?q=${Number(r.gps_lat)},${Number(r.gps_lng)}','_blank')">📍</button>` : ""}
        <button class="btn secondary" style="padding:4px 8px;font-size:11px;color:#ef4444;border-color:#fecaca" onclick="deleteCitizenReport(${r.id},'${escapeHtml(r.tracking_code)}')">✕</button>
      </div>
    </div>
  `;
}

const MONTH_NAMES_MN = ["1-р сар","2-р сар","3-р сар","4-р сар","5-р сар","6-р сар","7-р сар","8-р сар","9-р сар","10-р сар","11-р сар","12-р сар"];

function monthOptions() {
  return MONTH_NAMES_MN.map((n, i) =>
    `<option value="${i+1}" ${_statsMonth === i+1 ? "selected" : ""}>${n}</option>`
  ).join("");
}

function renderCitizenReports(stats = null) {
  const main = document.getElementById("main");
  const counts = _citizenRows.reduce((m, r) => (m[r.status] = (m[r.status] || 0) + 1, m), {});

  const statBar = stats ? `
    <div class="panel" style="padding:14px 18px;margin-bottom:14px;display:flex;align-items:center;gap:16px;flex-wrap:wrap">
      <div style="font-size:13px;font-weight:900;color:#0f172a;white-space:nowrap">${_statsYear} · ${MONTH_NAMES_MN[_statsMonth-1]} — Тайлан</div>
      <div style="display:flex;gap:20px;flex-wrap:wrap;flex:1">
        <div style="text-align:center"><div style="font-size:22px;font-weight:900;color:#1d4ed8">${stats.received}</div><div style="font-size:11px;color:#64748b">Нийт ирсэн</div></div>
        <div style="text-align:center"><div style="font-size:22px;font-weight:900;color:#15803d">${stats.done}</div><div style="font-size:11px;color:#64748b">Шийдвэрлэсэн</div></div>
        <div style="text-align:center"><div style="font-size:22px;font-weight:900;color:#c2410c">${stats.open}</div><div style="font-size:11px;color:#64748b">Шийдвэрлээгүй</div></div>
        <div style="text-align:center"><div style="font-size:22px;font-weight:900;color:#64748b">${stats.rejected}</div><div style="font-size:11px;color:#64748b">Буцаасан</div></div>
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <select class="input" style="padding:5px 8px;font-size:12px;width:auto" onchange="citizenStatsMonthChange(this.value,'year')">${Array.from({length:3},(_,i)=>new Date().getFullYear()-i).map(y=>`<option value="${y}" ${_statsYear===y?"selected":""}>${y}</option>`).join("")}</select>
        <select class="input" style="padding:5px 8px;font-size:12px;width:auto" onchange="citizenStatsMonthChange(this.value,'month')">${monthOptions()}</select>
        <button class="btn secondary" style="padding:5px 10px;font-size:12px" onclick="printCitizenReport(${JSON.stringify(stats).replace(/"/g,'&quot;')})">🖨 Хэвлэх</button>
      </div>
    </div>` : `<div class="panel" style="padding:10px 18px;margin-bottom:14px;display:flex;justify-content:flex-end;gap:6px;align-items:center">
      <select class="input" style="padding:5px 8px;font-size:12px;width:auto" onchange="citizenStatsMonthChange(this.value,'year')">${Array.from({length:3},(_,i)=>new Date().getFullYear()-i).map(y=>`<option value="${y}" ${_statsYear===y?"selected":""}>${y}</option>`).join("")}</select>
      <select class="input" style="padding:5px 8px;font-size:12px;width:auto" onchange="citizenStatsMonthChange(this.value,'month')">${monthOptions()}</select>
      <button class="btn secondary" style="padding:5px 10px;font-size:12px" onclick="loadAndRenderWithStats()">Тайлан харах</button>
    </div>`;

  main.innerHTML = `
    ${citizenTopTabs()}
    <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px">
      <div>
        <h1 style="margin:0 0 4px;font-size:22px;font-weight:900">Иргэдийн санал хүсэлт</h1>
        <div style="font-size:12px;color:#667085">Public portal-оор ирсэн гэмтэл, санал хүсэлт, хийсэн ажлын public тайлан</div>
      </div>
      <button class="btn secondary" onclick="window.open('/portal','_blank')">Public portal нээх</button>
    </div>
    ${statBar}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      ${[
        ["", "Бүгд", _citizenRows.length],
        ["new", "Шинэ", counts.new || 0],
        ["accepted", "Хүлээн авсан", counts.accepted || 0],
        ["working", "Ажиллаж байна", counts.working || 0],
        ["done", "Дууссан", counts.done || 0],
        ["rejected", "Буцаасан", counts.rejected || 0],
      ].map(([key, label, count]) => {
        const active = _citizenStatus === key;
        return `<button onclick="citizenReportFilter('${key}')" style="border:1px solid ${active ? "#2563eb" : "#dbe3ef"};background:${active ? "#eff6ff" : "#fff"};color:${active ? "#1d4ed8" : "#475569"};border-radius:8px;padding:7px 11px;font-size:12px;font-weight:900;cursor:pointer">${label} (${count})</button>`;
      }).join("")}
    </div>
    <div class="panel" style="overflow:hidden;padding:0">
      <div style="display:grid;grid-template-columns:128px 140px 1fr 95px 108px auto;gap:8px;padding:8px 12px;background:#f8fafc;border-bottom:2px solid #e2e8f0;font-size:11px;font-weight:900;color:#64748b">
        <div>Хяналтын код</div><div>Төрөл</div><div>Байршил / тайлбар</div><div>Огноо / утас</div><div>Төлөв</div><div>Үйлдэл</div>
      </div>
      ${_citizenRows.length ? _citizenRows.map(reportRow).join("") : `<div style="padding:32px;text-align:center;color:#94a3b8">Мэдээлэл алга байна</div>`}
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
    ${tab("reports", "📣 Иргэдийн санал хүсэлт")}
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
  await loadAndRenderWithStats();
}

function _openCitizenModal(html) {
  const modal = document.getElementById("citizenReportModal");
  const inner = document.getElementById("citizenReportInner");
  if (!modal || !inner) return;
  inner.innerHTML = html;
  modal.style.display = "flex";
}

function openAcceptModal(id) {
  const r = _citizenRows.find(x => Number(x.id) === Number(id));
  if (!r) return;

  _openCitizenModal(`
    <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;padding:14px 16px;border-bottom:1px solid #e2e8f0">
      <div>
        <div style="font-size:13px;font-weight:900;color:#1d4ed8">${escapeHtml(r.tracking_code)}</div>
        <div style="font-size:15px;font-weight:900;color:#0f172a">${escapeHtml(r.issue_type)} · ${escapeHtml(r.location)}</div>
        ${r.description ? `<div style="font-size:12px;color:#64748b;margin-top:3px">${escapeHtml(r.description)}</div>` : ""}
        ${r.phone ? `<div style="font-size:12px;color:#64748b">📞 ${escapeHtml(r.phone)}</div>` : ""}
      </div>
      <button class="btn secondary" onclick="closeCitizenReport()" style="padding:5px 10px;font-size:12px">Хаах</button>
    </div>
    ${r.image_url ? `<div onclick="openImageViewer('${escapeHtml(r.image_url)}')" style="cursor:zoom-in;background:#000">
      <img src="${escapeHtml(r.image_url)}" style="width:100%;max-height:260px;object-fit:contain;image-orientation:from-image;display:block">
    </div>` : ""}
    <form id="citizenAcceptForm" onsubmit="submitAcceptReport(event,${r.id})">
      <div style="padding:16px;display:grid;gap:12px">
        <label style="font-size:12px;font-weight:900;color:#334155">Ямар ажил вэ? (ангилал)
          <select name="category" class="input" style="margin-top:6px" onchange="filterAssignUsers(this.value)">
            ${CITIZEN_CATEGORIES.map(c => `<option value="${escapeHtml(c.value)}">${escapeHtml(c.value)}</option>`).join("")}
          </select>
        </label>
        <label style="font-size:12px;font-weight:900;color:#334155">Хариуцах ажилтан — ажлын төлөвлөгөөнд нэмнэ
          <select name="assigned_to" id="acceptAssignSelect" class="input" style="margin-top:6px">
            <option value="">— Сонгоогүй —</option>
          </select>
        </label>
        <label style="font-size:12px;font-weight:900;color:#334155">Ажилтанд дамжуулах тэмдэглэл
          <textarea name="note" class="input" placeholder="Аюул, онцлог нөхцөл байдал, тэмдэглэх зүйл..." style="margin-top:6px;min-height:68px"></textarea>
        </label>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid #e2e8f0;background:#f0fdf4">
        <button type="button" class="btn secondary" onclick="closeCitizenReport()">Цуцлах</button>
        <button class="btn" type="submit" style="background:#16a34a;color:#fff">✓ Хүлээн авах &amp; Ажилтанд хариуцуулах</button>
      </div>
    </form>
  `);
  // Modal render болсны дараа default ангилалын ажилтнуудыг шүүж харуулна
  filterAssignUsers(CITIZEN_CATEGORIES[0].value);
}

function filterAssignUsers(category) {
  const catDef = CITIZEN_CATEGORIES.find(c => c.value === category);
  const roles = catDef?.roles || [];
  const select = document.getElementById("acceptAssignSelect");
  if (!select) return;
  const users = (state.users || []).filter(u => u.active !== 0);
  const sorted = [...users].sort((a, b) => {
    const aM = roles.includes(a.role) ? 0 : 1;
    const bM = roles.includes(b.role) ? 0 : 1;
    return aM - bM || (a.full_name || "").localeCompare(b.full_name || "");
  });
  select.innerHTML = `<option value="">— Сонгоогүй —</option>` + sorted.map(u => {
    const match = roles.includes(u.role);
    return `<option value="${u.id}" ${match ? 'style="font-weight:800"' : ""}>${escapeHtml(u.full_name)}${u.position ? " · " + escapeHtml(u.position) : ""}${match ? " ✓" : ""}</option>`;
  }).join("");
}

async function submitAcceptReport(e, id) {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector("button[type='submit']");
  btn.disabled = true;
  try {
    const body = {
      category: form.category.value,
      assigned_to: form.assigned_to.value || null,
      note: form.note.value,
    };
    const res = await api(`/api/citizen-reports/${id}/assign`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    const name = (state.users || []).find(u => String(u.id) === String(body.assigned_to))?.full_name || "";
    toast(res.workLogId
      ? `Хүлээн авч ${name ? name + "-д" : "ажилтанд"} хариуцуулаа — Ажлын явцад нэмэгдлээ ✓`
      : "Хүлээн авлаа ✓");
    closeCitizenReport();
    await loadAndRenderWithStats();
  } catch(err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
  }
}

function openCitizenReport(id) {
  const r = _citizenRows.find(x => Number(x.id) === Number(id));
  if (!r) return;
  const assignedName = (state.users || []).find(u => Number(u.id) === Number(r.assigned_to))?.full_name || "";

  _openCitizenModal(`
    <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;padding:14px 16px;border-bottom:1px solid #e2e8f0">
      <div>
        <div style="font-size:13px;font-weight:900;color:#1d4ed8">${escapeHtml(r.tracking_code)}</div>
        <div style="font-size:15px;font-weight:900;color:#0f172a">${escapeHtml(r.issue_type)} · ${escapeHtml(r.location)}</div>
        ${r.description ? `<div style="font-size:12px;color:#64748b;margin-top:2px">${escapeHtml(r.description)}</div>` : ""}
        ${r.phone ? `<div style="font-size:12px;color:#64748b">📞 ${escapeHtml(r.phone)}</div>` : ""}
        ${assignedName ? `<div style="font-size:12px;color:#0369a1;margin-top:2px">👤 Хариуцсан: ${escapeHtml(assignedName)}</div>` : ""}
      </div>
      <button class="btn secondary" onclick="closeCitizenReport()" style="padding:5px 10px;font-size:12px">Хаах</button>
    </div>
    ${r.image_url ? `<div onclick="openImageViewer('${escapeHtml(r.image_url)}')" style="cursor:zoom-in;background:#000">
      <img src="${escapeHtml(r.image_url)}" style="width:100%;max-height:240px;object-fit:contain;image-orientation:from-image;display:block">
      <div style="text-align:center;font-size:11px;color:#94a3b8;padding:4px 0;background:#000">Иргэний оруулсан зураг — томруулахад дарна уу</div>
    </div>` : ""}
    <form id="citizenEditForm" onsubmit="saveCitizenReport(event,${r.id})">
      <div style="padding:16px;display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <label style="font-size:12px;font-weight:900;color:#334155">Төлөв
          <select name="status" class="input" style="margin-top:6px">${statusOptions(r.status)}</select>
        </label>
        <label style="font-size:12px;font-weight:900;color:#334155">Яаралтай эсэх
          <select name="priority" class="input" style="margin-top:6px">
            <option value="normal" ${r.priority === "normal" ? "selected" : ""}>Энгийн</option>
            <option value="high" ${r.priority === "high" ? "selected" : ""}>Яаралтай</option>
            <option value="low" ${r.priority === "low" ? "selected" : ""}>Бага</option>
          </select>
        </label>
        <label style="grid-column:1/-1;font-size:12px;font-weight:900;color:#334155">Хийсэн ажил / шийдвэрлэлтийн тайлбар
          <textarea name="resolution_note" class="input" style="margin-top:6px;min-height:90px">${escapeHtml(r.resolution_note || "")}</textarea>
        </label>
        <label style="font-size:12px;font-weight:900;color:#334155">Өмнөх зураг (нэмэлт)
          <input name="before_image" type="file" accept="image/*" class="input" style="margin-top:6px">
        </label>
        <label style="font-size:12px;font-weight:900;color:#334155">Дараах зураг — засаж дууссан
          <input name="after_image" type="file" accept="image/*" class="input" style="margin-top:6px">
          ${r.after_image_url ? `<img src="${escapeHtml(r.after_image_url)}" onclick="openImageViewer('${escapeHtml(r.after_image_url)}')" style="margin-top:6px;width:100%;height:80px;object-fit:cover;border-radius:6px;cursor:zoom-in;image-orientation:from-image">` : ""}
        </label>
        <label style="grid-column:1/-1;display:flex;gap:8px;align-items:center;font-size:12px;font-weight:900;color:#334155">
          <input name="publish_public" type="checkbox" value="1" ${Number(r.publish_public || 0) ? "checked" : ""}>
          Public сайт дээр хийсэн ажил болгон нийтлэх
        </label>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid #e2e8f0;background:#f8fafc">
        <button type="button" class="btn secondary" onclick="closeCitizenReport()">Цуцлах</button>
        <button class="btn" type="submit">Хадгалах</button>
      </div>
    </form>
  `);
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

function openImageViewer(url) {
  const existing = document.getElementById("imgViewerOverlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "imgViewerOverlay";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:9999;display:flex;align-items:center;justify-content:center";
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

  const img = document.createElement("img");
  img.src = url;
  img.style.cssText = "max-width:88vw;max-height:86vh;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,.6);image-orientation:from-image;display:block";
  img.onclick = e => e.stopPropagation();

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "✕";
  closeBtn.style.cssText = "position:fixed;top:18px;right:22px;background:rgba(255,255,255,.15);border:none;color:#fff;font-size:24px;width:44px;height:44px;border-radius:50%;cursor:pointer;z-index:10000;line-height:1";
  closeBtn.onclick = () => overlay.remove();

  const onKey = e => { if (e.key === "Escape") { overlay.remove(); document.removeEventListener("keydown", onKey); } };
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("remove", () => document.removeEventListener("keydown", onKey));

  overlay.appendChild(img);
  overlay.appendChild(closeBtn);
  document.body.appendChild(overlay);
}

async function acceptCitizenReport(id) {
  try {
    await api(`/api/citizen-reports/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "accepted" }),
    });
    toast("Хүлээн авлаа ✓");
    await loadCitizenReports();
    renderCitizenReports();
  } catch(e) { toast(e.message); }
}

async function deleteCitizenReport(id, code) {
  if (!confirm(`"${code}" мэдээллийг устгах уу?`)) return;
  try {
    await api(`/api/citizen-reports/${id}`, { method: "DELETE" });
    toast("Устгагдлаа ✓");
    await loadCitizenReports();
    renderCitizenReports();
  } catch(e) { toast(e.message); }
}

function citizenStatsMonthChange(val, field) {
  if (field === "year") _statsYear = Number(val);
  else _statsMonth = Number(val);
}

async function loadAndRenderWithStats() {
  const [, stats] = await Promise.all([
    loadCitizenReports(),
    api(`/api/citizen-reports/monthly-stats?year=${_statsYear}&month=${_statsMonth}`).catch(() => null),
  ]);
  renderCitizenReports(stats);
}

function printCitizenReport(stats) {
  const mn = MONTH_NAMES_MN[_statsMonth - 1];
  const w = window.open("", "_blank", "width=700,height=500");
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
  <title>Иргэдийн санал хүсэлт тайлан — ${_statsYear} ${mn}</title>
  <style>body{font-family:sans-serif;padding:32px;color:#0f172a}h2{margin:0 0 4px}table{width:100%;border-collapse:collapse;margin-top:20px;font-size:13px}th{background:#1d4ed8;color:#fff;padding:8px 10px;text-align:left}td{padding:7px 10px;border-bottom:1px solid #e2e8f0}.stat{display:inline-block;margin:0 24px 0 0;text-align:center}.num{font-size:32px;font-weight:900}.lbl{font-size:12px;color:#64748b}@media print{button{display:none}}</style></head><body>
  <h2>Чойбалсан хөгжил ОНӨҮГ</h2>
  <div style="font-size:15px;margin-bottom:20px">Иргэдийн санал хүсэлт тайлан — ${_statsYear} он, ${mn}</div>
  <div style="display:flex;gap:0;margin-bottom:24px">
    <div class="stat"><div class="num" style="color:#1d4ed8">${stats.received}</div><div class="lbl">Нийт ирсэн</div></div>
    <div class="stat"><div class="num" style="color:#15803d">${stats.done}</div><div class="lbl">Шийдвэрлэсэн</div></div>
    <div class="stat"><div class="num" style="color:#c2410c">${stats.open}</div><div class="lbl">Шийдвэрлээгүй</div></div>
    <div class="stat"><div class="num" style="color:#64748b">${stats.rejected}</div><div class="lbl">Буцаасан</div></div>
  </div>
  <table><tr><th>#</th><th>Код</th><th>Төрөл</th><th>Байршил</th><th>Огноо</th><th>Төлөв</th></tr>
  ${_citizenRows.map((r, i) => `<tr><td>${i+1}</td><td>${escapeHtml(r.tracking_code)}</td><td>${escapeHtml(r.issue_type)}</td><td>${escapeHtml(r.location)}</td><td>${String(r.created_at||"").slice(0,10)}</td><td>${STATUS_LABELS[r.status]||r.status}</td></tr>`).join("")}
  </table>
  <div style="margin-top:24px;font-size:12px;color:#94a3b8">Хэвлэсэн огноо: ${new Date().toLocaleDateString("mn-MN")}</div>
  <script>window.print();<\/script></body></html>`);
  w.document.close();
}

async function citizenReportFilter(status = "") {
  _citizenStatus = status;
  await loadCitizenReports();
  renderCitizenReports();
}

async function citizen_reports() {
  if (_citizenView === "posts") return renderPublicPosts();
  await loadAndRenderWithStats();
}

Object.assign(window, {
  citizen_reports,
  citizenReportsView,
  savePublicPost,
  togglePublicPost,
  citizenReportFilter,
  openCitizenReport,
  openAcceptModal,
  filterAssignUsers,
  submitAcceptReport,
  closeCitizenReport,
  saveCitizenReport,
  acceptCitizenReport,
  deleteCitizenReport,
  openImageViewer,
  citizenStatsMonthChange,
  loadAndRenderWithStats,
  printCitizenReport,
});
