import { api, escapeHtml, toast } from "./common.js";

let websiteRows = [];
let hazardRows = [];
let editingWebsiteId = null;

const websiteSections = [
  ["hero", "Нүүр хуудасны hero"],
  ["about", "Бидний тухай"],
  ["service", "Үйл ажиллагаа / үйлчилгээ"],
  ["news", "Мэдээ мэдээлэл"],
  ["job", "Ажлын байр"],
  ["contact", "Холбоо барих"]
];

function websiteSectionLabel(value) {
  return (websiteSections.find(([key]) => key === value) || [value, value])[1];
}

function websiteResetForm() {
  editingWebsiteId = null;
  ["websiteTitle", "websiteKey", "websiteBody", "websiteImage", "websiteLink"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const section = document.getElementById("websiteSection");
  if (section) section.value = "news";
  const sort = document.getElementById("websiteSort");
  if (sort) sort.value = "99";
  const published = document.getElementById("websitePublished");
  if (published) published.checked = true;
  const btn = document.getElementById("websiteSaveBtn");
  if (btn) btn.textContent = "Хадгалах";
}

function websiteEdit(id) {
  const row = websiteRows.find(item => Number(item.id) === Number(id));
  if (!row) return;
  editingWebsiteId = row.id;
  document.getElementById("websiteSection").value = row.section || "news";
  document.getElementById("websiteKey").value = row.content_key || "";
  document.getElementById("websiteTitle").value = row.title || "";
  document.getElementById("websiteBody").value = row.body || "";
  document.getElementById("websiteImage").value = row.image_url || "";
  document.getElementById("websiteLink").value = row.link_url || "";
  document.getElementById("websiteSort").value = row.sort_order || 99;
  document.getElementById("websitePublished").checked = Number(row.published) !== 0;
  document.getElementById("websiteSaveBtn").textContent = "Шинэчлэх";
  document.getElementById("websiteTitle").focus();
}

async function websiteDelete(id) {
  if (!confirm("Энэ мэдээллийг устгах уу?")) return;
  await api(`/api/website/contents/${id}`, { method: "DELETE" });
  toast("Устгалаа");
  await websiteLoad();
}

async function websiteSave() {
  const payload = {
    section: document.getElementById("websiteSection")?.value || "news",
    content_key: document.getElementById("websiteKey")?.value || "",
    title: document.getElementById("websiteTitle")?.value || "",
    body: document.getElementById("websiteBody")?.value || "",
    image_url: document.getElementById("websiteImage")?.value || "",
    link_url: document.getElementById("websiteLink")?.value || "",
    sort_order: Number(document.getElementById("websiteSort")?.value || 99),
    published: document.getElementById("websitePublished")?.checked ? 1 : 0
  };
  if (!payload.title.trim()) return toast("Гарчиг оруулна уу");
  const url = editingWebsiteId ? `/api/website/contents/${editingWebsiteId}` : "/api/website/contents";
  await api(url, {
    method: editingWebsiteId ? "PUT" : "POST",
    body: JSON.stringify(payload)
  });
  toast(editingWebsiteId ? "Шинэчиллээ" : "Хадгаллаа");
  websiteResetForm();
  await websiteLoad();
}

function websiteRenderRows() {
  const box = document.getElementById("websiteRows");
  if (!box) return;
  if (!websiteRows.length) {
    box.innerHTML = `<div class="muted" style="padding:18px">Одоогоор public сайт дээр оруулах мэдээлэл бүртгээгүй байна.</div>`;
    return;
  }
  box.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Хэсэг</th>
            <th>Гарчиг</th>
            <th>Текст</th>
            <th>Төлөв</th>
            <th>Дараалал</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${websiteRows.map(row => `
            <tr>
              <td>${escapeHtml(websiteSectionLabel(row.section))}</td>
              <td><b>${escapeHtml(row.title)}</b>${row.content_key ? `<div class="muted">${escapeHtml(row.content_key)}</div>` : ""}</td>
              <td>${escapeHtml(row.body || "").slice(0, 120)}</td>
              <td>${Number(row.published) === 0 ? "Ноорог" : "Нийтэлсэн"}</td>
              <td>${Number(row.sort_order || 99)}</td>
              <td style="white-space:nowrap;text-align:right">
                <button class="btn secondary sm" onclick="websiteEdit(${row.id})">Засах</button>
                <button class="btn danger sm" onclick="websiteDelete(${row.id})">Устгах</button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>`;
}

async function websiteLoad() {
  [websiteRows, hazardRows] = await Promise.all([
    api("/api/website/contents"),
    api("/api/website/hazard-reports").catch(() => [])
  ]);
  websiteRenderRows();
  websiteRenderHazards();
}

function websiteRenderHazards() {
  const box = document.getElementById("hazardRows");
  if (!box) return;
  if (!hazardRows.length) {
    box.innerHTML = `<div class="muted" style="padding:18px">Public сайтаас ирсэн аюулын мэдээлэл одоогоор алга.</div>`;
    return;
  }
  box.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Огноо</th>
            <th>Байршил</th>
            <th>Төрөл</th>
            <th>Тайлбар</th>
            <th>Зураг</th>
            <th>Холбогдох</th>
            <th>Tracking код</th>
            <th>Төлөв</th>
          </tr>
        </thead>
        <tbody>
          ${hazardRows.map(row => `
            <tr>
              <td>${escapeHtml(String(row.created_at || "").slice(0, 16))}</td>
              <td><b>${escapeHtml(row.location)}</b></td>
              <td>${escapeHtml(row.hazard_type || "Бусад")}</td>
              <td>${escapeHtml(row.description || "").slice(0, 180)}</td>
              <td>${row.image_url
                ? `<a href="${escapeHtml(row.image_url)}" target="_blank" rel="noopener">Зураг харах</a>`
                : "-"}</td>
              <td>${escapeHtml([row.reporter_name, row.reporter_phone].filter(Boolean).join(" · ") || "-")}</td>
              <td><code>${escapeHtml(row.tracking_code || "-")}</code></td>
              <td>
                <select class="input" style="min-width:130px;margin:0" onchange="websiteHazardStatus(${row.id}, this.value)">
                  ${["Шинэ", "Шалгаж байна", "Шийдвэрлэсэн", "Хаасан"].map(status =>
                    `<option value="${status}" ${row.status === status ? "selected" : ""}>${status}</option>`
                  ).join("")}
                </select>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>`;
}

async function websiteHazardStatus(id, status) {
  await api(`/api/website/hazard-reports/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status })
  });
  toast("Төлөв шинэчиллээ");
  await websiteLoad();
}

async function website() {
  document.getElementById("main").innerHTML = `
    <div class="page-head">
      <div>
        <h1>Вэб сайт</h1>
        <p class="muted">Иргэдэд нээлттэй public сайт дээр харагдах мэдээллийг эндээс оруулна.</p>
      </div>
      <a class="btn secondary" href="/" target="_blank">Public сайтыг харах</a>
    </div>

    <div class="grid two">
      <div class="card">
        <h3>Мэдээлэл оруулах</h3>
        <label>Хэсэг</label>
        <select class="input" id="websiteSection">
          ${websiteSections.map(([key, label]) => `<option value="${key}">${label}</option>`).join("")}
        </select>
        <label>Түлхүүр нэр <span class="muted">(заавал биш: hero_title гэх мэт)</span></label>
        <input class="input" id="websiteKey" placeholder="Жишээ: hero_title">
        <label>Гарчиг</label>
        <input class="input" id="websiteTitle" placeholder="Гарчиг">
        <label>Тайлбар / үндсэн текст</label>
        <textarea class="input" id="websiteBody" rows="6" placeholder="Public сайт дээр гарах текст"></textarea>
        <label>Зургийн URL <span class="muted">(заавал биш)</span></label>
        <input class="input" id="websiteImage" placeholder="/uploads/... эсвэл https://...">
        <label>Холбоос <span class="muted">(заавал биш)</span></label>
        <input class="input" id="websiteLink" placeholder="/news/...">
        <div class="grid two" style="gap:12px">
          <div>
            <label>Дараалал</label>
            <input class="input" id="websiteSort" type="number" value="99">
          </div>
          <label style="display:flex;align-items:center;gap:8px;margin-top:30px">
            <input id="websitePublished" type="checkbox" checked> Нийтлэх
          </label>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button id="websiteSaveBtn" class="btn" onclick="websiteSave()">Хадгалах</button>
          <button class="btn secondary" onclick="websiteResetForm()">Цэвэрлэх</button>
        </div>
      </div>

      <div class="card">
        <h3>Яаж ашиглах вэ?</h3>
        <p class="muted">Жишээ нь “Мэдээ мэдээлэл” хэсгийг сонгоод гарчиг, текстээ оруулаад хадгалбал public сайтын “Сүүлийн мэдээлэл” хэсэгт гарна.</p>
        <p class="muted">“Үйл ажиллагаа / үйлчилгээ” хэсэгт оруулсан мэдээллийг дараагийн шатанд нүүр хуудсын үйлчилгээний картуудтай бүрэн холбож болно.</p>
        <p class="muted">Ажлын байрны мэдээллийг одоо ERP-ийн HR/recruitment table-аас мөн уншихаар холбосон.</p>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <h3>Оруулсан мэдээллүүд</h3>
      <div id="websiteRows"></div>
    </div>`;
  document.getElementById("main").insertAdjacentHTML("beforeend", `
    <div class="card" style="margin-top:16px">
      <h3>Public сайтаас ирсэн аюулын мэдээлэл</h3>
      <div id="hazardRows"></div>
    </div>`);
  websiteResetForm();
  await websiteLoad();
}

Object.assign(window, {
  website,
  websiteSave,
  websiteEdit,
  websiteDelete,
  websiteResetForm,
  websiteHazardStatus
});
