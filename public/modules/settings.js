import { state, api, toast, escapeHtml } from './common.js';

const ROLES = [
  { value: "director",       label: "Захирал" },
  { value: "chief_engineer", label: "Ерөнхий инженер" },
  { value: "engineer",       label: "Цахилгааны инженер" },
  { value: "accountant",     label: "Нягтлан бодогч" },
  { value: "hr",             label: "Хүний нөөц" },
  { value: "safety",          label: "ХАБЭА ажилтан" },
  { value: "electric",        label: "Цахилгаанчин" },
  { value: "camera_engineer", label: "Камерийн инженер" },
  { value: "storekeeper",    label: "Нярав" },
  { value: "worker",         label: "Ажилтан" },
];

const ROLE_COLORS = {
  director:       "#dc2626",
  chief_engineer: "#9333ea",
  engineer:       "#2563eb",
  accountant:     "#0891b2",
  hr:             "#db2777",
  safety:          "#ea580c",
  electric:        "#f59e0b",
  camera_engineer: "#0d9488",
  storekeeper:     "#65a30d",
  worker:          "#475569",
};

const ROLE_HELP = {
  director:       "Бүх систем, батлах, тохиргоо, устгалын дээд эрх.",
  chief_engineer: "Ажлын явц, инженерийн модуль, гэрэлтүүлэг, тайлан хянах эрх.",
  engineer:       "Цахилгааны чиглэлийн ажил, объект, тайлангийн үндсэн хэрэглээ.",
  accountant:     "Санхүү, нэхэмжлэл, цалин, санхүүгийн тайлан.",
  hr:             "Ажилчдын бүртгэл, гэрээ, ирц, цалингийн суурь мэдээлэл.",
  safety:         "ХАБЭА бүртгэл, тээврийн хэрэгсэл, холбогдох тайлан.",
  electric:       "Гэрэлтүүлэг, цахилгааны засвар, уншилттай холбоотой ажил.",
  camera_engineer:"Камер, сүлжээ, объект болон ажлын явцын бүртгэл.",
  storekeeper:    "Агуулах, орлого, зарлага, үлдэгдэл, захиалга.",
  worker:         "Ердийн ажилтан. Анхдагчаар хязгаарлагдмал харах эрхтэй.",
};

window._roleSearch = window._roleSearch || "";
window._roleLoginFilter = window._roleLoginFilter || "all";
window._roleRoleFilter = window._roleRoleFilter || "";
let _stab = "org";

function regDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

async function settings() {
  const isDirector = state.me.role === "director";
  const canManagePublicAlerts = ["director", "chief_engineer", "safety"].includes(state.me.role);
  _stab = _stab || "org";

  const TABS = [
    { key: "org",   icon: "🏢", label: "Байгууллага" },
    { key: "roles", icon: "🔐", label: "Нэвтрэх эрх" },
  ];
  if (canManagePublicAlerts) TABS.push({ key: "alerts", icon: "🦺", label: "Public сэрэмжлүүлэг" });
  if (!TABS.some(t => t.key === _stab)) _stab = "org";

  main.innerHTML = `
  <div style="max-width:1120px">
    <div style="margin-bottom:18px">
      <h1 style="margin:0 0 3px;font-size:20px">⚙️ Тохиргоо</h1>
      <div style="font-size:12px;color:#667085">ERP системийн үндсэн тохиргоо · ${new Date().toLocaleDateString("mn-MN")}</div>
    </div>

    <div style="display:flex;gap:4px;border-bottom:2px solid #e2e6ed;margin-bottom:22px;overflow-x:auto">
      ${TABS.map(t => `
        <button id="stab_${t.key}" onclick="settingsTab('${t.key}')"
          style="padding:9px 18px;border:none;border-radius:8px 8px 0 0;cursor:pointer;font-size:13px;font-weight:600;white-space:nowrap;
                 background:${_stab===t.key?'#2563eb':'transparent'};
                 color:${_stab===t.key?'#fff':'#667085'};
                 border-bottom:${_stab===t.key?'2px solid #2563eb':'2px solid transparent'};
                 margin-bottom:-2px;transition:all .15s">
          ${t.icon} ${t.label}
        </button>`).join("")}
    </div>
    <div id="stab_content"></div>
  </div>`;

  window.settingsTab = (tab) => {
    _stab = tab;
    TABS.forEach(t => {
      const b = document.getElementById(`stab_${t.key}`);
      if (!b) return;
      b.style.background   = t.key === tab ? "#2563eb" : "transparent";
      b.style.color        = t.key === tab ? "#fff"    : "#667085";
      b.style.borderBottom = t.key === tab ? "2px solid #2563eb" : "2px solid transparent";
    });
    const fns = { org: stabOrg, roles: stabRoles, alerts: stabPublicAlerts };
    if (fns[tab]) fns[tab]();
  };

  const fns = { org: stabOrg, roles: stabRoles, alerts: stabPublicAlerts };
  if (fns[_stab]) fns[_stab]();
}

// ── Tab 1: Байгууллагын мэдээлэл ─────────────────────────────

async function stabOrg() {
  const isDirector = state.me.role === "director";
  let cfg = {};
  try {
    cfg = await api("/api/org-settings");
  } catch(e) {}

  const field = (key, label, placeholder, type="text") => `
    <div>
      <div style="font-size:12px;font-weight:600;color:#344054;margin-bottom:5px">${label}</div>
      <input class="input" id="os_${key}" type="${type}" value="${escapeHtml(cfg[key]||'')}"
        placeholder="${placeholder}" ${!isDirector ? 'readonly style="background:#f8f9fb;color:#667085"' : ''}>
    </div>`;

  document.getElementById("stab_content").innerHTML = `
    <div class="panel" style="padding:22px">
      <div style="font-size:14px;font-weight:700;margin-bottom:18px;color:#1e293b">🏢 Байгууллагын мэдээлэл</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
        ${field("org_name", "Байгууллагын нэр", "Чойбалсан хөгжил ОНӨҮГ")}
        ${field("director", "Захиралын нэр", "Батсүх Гэрэлт-Од")}
        ${field("register", "ААН-ийн регистр", "1234567")}
        ${field("phone", "Утас", "+(976) 7000-0000")}
        ${field("email", "И-мэйл", "info@choibalsan.mn", "email")}
        ${field("address", "Хаяг", "Чойбалсан хот, Дорнод аймаг")}
      </div>
      <div style="margin-bottom:18px">
        <div style="font-size:12px;font-weight:600;color:#344054;margin-bottom:5px">Мэдэгдэл / системийн мессеж</div>
        <textarea id="os_notice" class="input" style="min-height:70px;resize:vertical" placeholder="Нэвтрэх дэлгэцэнд харуулах мэдэгдэл..." ${!isDirector ? 'readonly style="background:#f8f9fb;color:#667085"' : ''}>${escapeHtml(cfg.notice||'')}</textarea>
      </div>
      ${isDirector ? `
      <div style="display:flex;gap:10px">
        <button class="btn" onclick="saveOrgSettings()">💾 Хадгалах</button>
      </div>` : `<div style="font-size:12px;color:#94a3b8">Тохиргоог зөвхөн захирал өөрчлөх боломжтой.</div>`}
    </div>`;

  window.saveOrgSettings = async () => {
    const g = id => document.getElementById(id)?.value || "";
    try {
      await api("/api/org-settings", {
        method: "PUT",
        body: JSON.stringify({
          org_name: g("os_org_name"), director: g("os_director"),
          register: g("os_register"), phone: g("os_phone"),
          email: g("os_email"),       address: g("os_address"),
          notice: g("os_notice"),
        })
      });
      toast("Байгууллагын мэдээлэл хадгалагдлаа ✓");
    } catch(e) { toast("Алдаа: " + e.message); }
  };
}

// ── Tab 2: Хэрэглэгчийн эрх ──────────────────────────────────

async function stabPublicAlerts() {
  const canManage = ["director", "chief_engineer", "safety"].includes(state.me.role);
  let rows = [];
  try { rows = await api("/api/public-alerts"); } catch(e) {}
  const levelName = { info: "Мэдээлэл", warning: "Анхааруулга", danger: "Яаралтай" };
  const levelColor = { info: "#2563eb", warning: "#d97706", danger: "#dc2626" };
  document.getElementById("stab_content").innerHTML = `
    <div class="panel" style="padding:22px">
      <div style="display:flex;justify-content:space-between;gap:14px;align-items:flex-start;margin-bottom:16px">
        <div>
          <div style="font-size:14px;font-weight:800;color:#1e293b">🦺 Public сэрэмжлүүлэг</div>
          <div style="font-size:12px;color:#667085;margin-top:4px">Иргэдийн нүүр хуудасны баруун доод буланд байнга харагдах ХАБЭА/анхааруулга.</div>
        </div>
        <a class="btn secondary sm" href="/portal" target="_blank">Нүүр харах</a>
      </div>
      ${canManage ? `
      <div style="display:grid;grid-template-columns:1fr 160px 180px;gap:10px;margin-bottom:10px">
        <input class="input" id="pa_title" placeholder="Гарчиг">
        <select class="input" id="pa_level"><option value="warning">Анхааруулга</option><option value="danger">Яаралтай</option><option value="info">Мэдээлэл</option></select>
        <input class="input" id="pa_location" placeholder="Байршил">
      </div>
      <textarea class="input" id="pa_body" style="min-height:76px;resize:vertical;margin-bottom:10px" placeholder="Иргэдэд харагдах сэрэмжлүүлгийн текст..."></textarea>
      <div style="display:grid;grid-template-columns:1fr 1fr 220px auto;gap:10px;align-items:center;margin-bottom:18px">
        <input class="input" id="pa_starts" type="datetime-local">
        <input class="input" id="pa_ends" type="datetime-local">
        <input class="input" id="pa_image" type="file" accept="image/jpeg,image/png,image/webp,image/gif">
        <button class="btn" onclick="savePublicAlert()">Нэмэх</button>
      </div>` : ""}
      <div style="display:grid;gap:10px">
        ${rows.length ? rows.map(r => `
          <article style="border:1px solid #e2e6ed;border-left:5px solid ${levelColor[r.level] || "#d97706"};border-radius:10px;padding:12px;background:${r.active ? "#fff" : "#f8fafc"}">
            <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
              <div style="display:flex;gap:10px;align-items:flex-start">
                ${r.image_url ? `<img src="${escapeHtml(r.image_url)}" style="width:74px;height:54px;object-fit:cover;border-radius:8px;border:1px solid #e2e8f0">` : ""}
                <div><div style="font-weight:900;color:#0f172a">${escapeHtml(r.title || "")}</div><div style="font-size:12px;color:#667085;margin-top:3px">${levelName[r.level] || r.level} ${r.location ? " · " + escapeHtml(r.location) : ""}</div></div>
              </div>
              <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#475569;font-weight:700"><input type="checkbox" ${Number(r.active) ? "checked" : ""} onchange="togglePublicAlert(${r.id}, this.checked)">Идэвхтэй</label>
            </div>
            <div style="font-size:13px;color:#344054;line-height:1.45;margin-top:8px">${escapeHtml(r.body || "")}</div>
          </article>`).join("") : `<div style="padding:18px;border:1px dashed #cbd5e1;border-radius:10px;color:#64748b;text-align:center">Одоогоор сэрэмжлүүлэг алга. Public нүүр default ХАБЭА санамж харуулна.</div>`}
      </div>
    </div>`;
  window.savePublicAlert = async () => {
    const title = document.getElementById("pa_title")?.value.trim();
    const body = document.getElementById("pa_body")?.value.trim();
    if (!title || !body) { toast("Гарчиг болон текст оруулна уу"); return; }
    try {
      const fd = new FormData();
      fd.set("title", title);
      fd.set("body", body);
      fd.set("level", document.getElementById("pa_level")?.value || "warning");
      fd.set("location", document.getElementById("pa_location")?.value || "");
      fd.set("starts_at", document.getElementById("pa_starts")?.value || "");
      fd.set("ends_at", document.getElementById("pa_ends")?.value || "");
      fd.set("active", "1");
      const img = document.getElementById("pa_image")?.files?.[0];
      if (img) fd.set("image", img);
      const res = await fetch("/api/public-alerts", {
        method: "POST",
        headers: { Authorization: "Bearer " + state.token },
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Алдаа гарлаа");
      toast("Public сэрэмжлүүлэг нэмэгдлээ ✓");
      stabPublicAlerts();
    } catch(e) { toast("Алдаа: " + e.message); }
  };
  window.togglePublicAlert = async (id, active) => {
    try {
      await api(`/api/public-alerts/${id}`, { method: "PATCH", body: JSON.stringify({ active: active ? 1 : 0 }) });
      toast(active ? "Идэвхжлээ" : "Унтраалаа");
      stabPublicAlerts();
    } catch(e) { toast("Алдаа: " + e.message); }
  };
}

const PERM_MODULES = [
  { key: "dashboard",    label: "Дашборд / Нүүр хуудас",        icon: "🏠" },
  { key: "assets",       label: "Үлдэгдлийн бүртгэл",            icon: "📦" },
  { key: "warehouse",    label: "Захиалга / Нярав",               icon: "🏪" },
  { key: "operations",   label: "Ажлын явц / Гүйцэтгэл",         icon: "📋" },
  { key: "reports",      label: "Тайлан",                         icon: "📊" },
  { key: "docs",         label: "Баримт бичиг",                   icon: "📄" },
  { key: "streetlights", label: "Гудамжны гэрэл",                icon: "💡" },
  { key: "camera",       label: "Камер",                         icon: "🎥" },
  { key: "lora",         label: "LoRaWAN хяналт",                icon: "📡" },
  { key: "nyagtlan",     label: "Нягтлан / Нэхэмжлэл",          icon: "💰" },
  { key: "habea",        label: "ХАБЭА",                         icon: "🦺" },
  { key: "admin_hub",    label: "Захиргаа / Хүний нөөц",         icon: "🏛" },
  { key: "settings",     label: "Тохиргоо",                      icon: "⚙️" },
];

async function stabRoles() {
  const isDirector = state.me.role === "director";
  let users = [];
  try { users = await api("/api/users"); } catch(e) {}

  const roleLabel = r => ROLES.find(x => x.value === r)?.label || r;
  const roleColor = r => ROLE_COLORS[r] || "#64748b";
  const canLogin = u => Number(u.can_login) !== 0;
  const loginUsers = users.filter(canLogin).length;
  const noLoginUsers = users.length - loginUsers;
  const customUsers = users.filter(u => {
    try { return Object.keys(JSON.parse(u.permissions || "{}")).length > 0; }
    catch { return false; }
  }).length;
  const filteredUsers = users.filter(u => {
    const q = (window._roleSearch || "").trim().toLowerCase();
    const hay = [u.full_name, u.username, u.phone, u.register_no, u.email, u.position, u.department, u.role].join(" ").toLowerCase();
    const matchesSearch = !q || hay.includes(q);
    const matchesLogin = window._roleLoginFilter === "all"
      || (window._roleLoginFilter === "login" && canLogin(u))
      || (window._roleLoginFilter === "nologin" && !canLogin(u));
    const matchesRole = !window._roleRoleFilter || u.role === window._roleRoleFilter;
    return matchesSearch && matchesLogin && matchesRole;
  });

  const permSummary = u => {
    try {
      const p = JSON.parse(u.permissions || "{}");
      const v = PERM_MODULES.filter(m => p[m.key]?.view).length;
      const e = PERM_MODULES.filter(m => p[m.key]?.edit).length;
      return v > 0 ? `<span style="font-size:10px;color:#64748b;margin-left:6px">${v} харах · ${e} засах</span>` : "";
    } catch { return ""; }
  };

  document.getElementById("stab_content").innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-bottom:14px">
      ${[
        ["Нийт ажилтан", users.length, "#2563eb", "#eff6ff"],
        ["Нэвтрэх эрхтэй", loginUsers, "#16a34a", "#f0fdf4"],
        ["Нэвтрэх эрхгүй", noLoginUsers, "#f97316", "#fff7ed"],
        ["Тусгай эрхтэй", customUsers, "#7c3aed", "#f5f3ff"],
      ].map(([l,v,c,bg]) => `
        <div style="background:${bg};border:1px solid ${c}22;border-radius:10px;padding:12px 14px">
          <div style="font-size:11px;color:${c};font-weight:800;text-transform:uppercase">${l}</div>
          <div style="font-size:24px;font-weight:900;color:${c};line-height:1;margin-top:6px">${v}</div>
        </div>`).join("")}
    </div>
    <div class="panel" style="padding:0;overflow:hidden">
      <div style="padding:16px 20px;border-bottom:1px solid #e2e6ed;display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="font-size:14px;font-weight:700">🔐 Нэвтрэх эрхийн тохиргоо</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">Username нь утасны дугаар, password нь РД-ийн үсгийг хассан тоо байхаар бөглөгдсөн</div>
        </div>
        ${isDirector ? `<div style="font-size:11px;color:#94a3b8">Username, утас, РД, password-ийг эндээс засна</div>` : ""}
      </div>
      <div style="padding:12px 16px;border-bottom:1px solid #eef2f7;display:flex;gap:8px;align-items:center;flex-wrap:wrap;background:#fbfdff">
        <input class="input" value="${escapeHtml(window._roleSearch)}" placeholder="Нэр, утас, РД, албан тушаал хайх..."
          oninput="window._roleSearch=this.value;stabRoles()" style="max-width:320px;margin:0">
        <select class="input" onchange="window._roleLoginFilter=this.value;stabRoles()" style="width:150px;margin:0">
          <option value="login" ${window._roleLoginFilter==="login"?"selected":""}>Нэвтрэх эрхтэй</option>
          <option value="nologin" ${window._roleLoginFilter==="nologin"?"selected":""}>Нэвтрэх эрхгүй</option>
          <option value="all" ${window._roleLoginFilter==="all"?"selected":""}>Бүгд</option>
        </select>
        <select class="input" onchange="window._roleRoleFilter=this.value;stabRoles()" style="width:170px;margin:0">
          <option value="">Бүх role</option>
          ${ROLES.map(r => `<option value="${r.value}" ${window._roleRoleFilter===r.value?"selected":""}>${r.label}</option>`).join("")}
        </select>
        <div style="margin-left:auto;font-size:12px;color:#94a3b8">${filteredUsers.length} / ${users.length}</div>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:#f8f9fb">
            <th style="padding:10px 16px;text-align:left;font-size:11px;color:#667085;font-weight:600">АЖИЛТАН</th>
            <th style="padding:10px 16px;text-align:left;font-size:11px;color:#667085;font-weight:600">ХЭЛТЭС / АЛБАН ТУШААЛ</th>
            <th style="padding:10px 16px;text-align:left;font-size:11px;color:#667085;font-weight:600">НЭВТРЭХ МЭДЭЭЛЭЛ</th>
            <th style="padding:10px 16px;text-align:left;font-size:11px;color:#667085;font-weight:600">ЭРХ / ROLE</th>
            ${isDirector ? `<th style="padding:10px 16px;text-align:left;font-size:11px;color:#667085;font-weight:600">ҮЙЛДЭЛ</th>` : ""}
          </tr>
        </thead>
        <tbody>
          ${filteredUsers.length ? filteredUsers.map(u => `
            <tr style="border-top:1px solid #f0f2f5;${u.active===0?'opacity:.45':''}">
              <td style="padding:10px 16px">
                <div style="display:flex;align-items:center;gap:10px">
                  <div style="width:34px;height:34px;border-radius:50%;background:${roleColor(u.role)}22;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;color:${roleColor(u.role)};flex-shrink:0">
                    ${(u.full_name||"?")[0].toUpperCase()}
                  </div>
                  <div>
                    <div style="font-weight:600;color:#1e293b">${escapeHtml(u.full_name)}</div>
                    <div style="font-size:11px;color:#94a3b8">
                      ${u.active===0
                        ? '<span style="color:#ef4444">Идэвхгүй</span>'
                        : Number(u.can_login) === 0
                          ? '<span style="color:#f97316">Нэвтрэх эрхгүй</span>'
                          : 'Нэвтрэх эрхтэй'}
                    </div>
                  </div>
                </div>
              </td>
              <td style="padding:10px 16px">
                <div style="font-size:12px;color:#344054">${escapeHtml(u.department||'—')}</div>
                <div style="font-size:11px;color:#94a3b8">${escapeHtml(u.position||'—')}</div>
              </td>
              <td style="padding:10px 16px;font-size:12px;color:#667085">
                <div style="font-family:monospace;font-weight:700;color:#2563eb">${escapeHtml(u.username||'')}</div>
                <div style="font-size:11px;color:#94a3b8">Утас: ${escapeHtml(u.phone||'—')} · РД: ${escapeHtml(u.register_no||'—')}</div>
              </td>
              <td style="padding:10px 16px">
                <span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;background:${roleColor(u.role)}18;color:${roleColor(u.role)};border:1px solid ${roleColor(u.role)}33">
                  ${roleLabel(u.role)}
                </span>
                ${permSummary(u)}
              </td>
              ${isDirector ? `
              <td style="padding:10px 16px">
                ${u.id !== state.me.id ? `
                  <div style="display:flex;gap:6px;align-items:center">
                    <button class="btn sm" onclick="openPermModal(${u.id})"
                      style="font-size:11px;padding:4px 12px">⚙️ Тохируулах</button>
                    <button onclick="deleteUser(${u.id},${JSON.stringify(escapeHtml(u.full_name))})"
                      style="border:none;background:none;cursor:pointer;font-size:16px;color:#cbd5e1;line-height:1;padding:2px 4px;border-radius:6px;transition:color .15s"
                      onmouseenter="this.style.color='#ef4444'" onmouseleave="this.style.color='#cbd5e1'"
                      title="Устгах">🗑</button>
                  </div>` : `
                  <span style="font-size:11px;color:#94a3b8">Өөрийн бүртгэл</span>`}
              </td>` : ""}
            </tr>`).join("") : `
            <tr><td colspan="${isDirector ? 5 : 4}" style="padding:28px;text-align:center;color:#94a3b8">Илэрц олдсонгүй</td></tr>`}
        </tbody>
      </table>
    </div>

    <!-- Permissions modal -->
    <div id="permModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:3000;align-items:flex-start;justify-content:center;padding:30px 16px;overflow-y:auto"
      onclick="if(event.target===this)this.style.display='none'">
      <div style="background:#fff;border-radius:16px;width:min(680px,96vw);box-shadow:0 20px 60px rgba(0,0,0,.25);margin:auto">

        <div style="padding:18px 24px;border-bottom:1px solid #e2e6ed;display:flex;align-items:center;justify-content:space-between">
          <div>
            <div id="permModalTitle" style="font-size:15px;font-weight:800;color:#1e293b"></div>
            <div style="font-size:11px;color:#94a3b8;margin-top:2px">Харах болон засах эрхийг хэсэг тус бүрд тохируулна</div>
          </div>
          <button onclick="document.getElementById('permModal').style.display='none'"
            style="border:none;background:none;font-size:20px;cursor:pointer;color:#94a3b8;line-height:1;padding:4px">✕</button>
        </div>

        <div style="padding:20px 24px">
          <!-- Role -->
          <div style="margin-bottom:18px;padding:14px 16px;background:#f8f9fb;border-radius:10px;border:1px solid #e2e6ed">
            <div style="font-size:12px;font-weight:700;color:#344054;margin-bottom:8px">🎖️ Үндсэн эрх (Role)</div>
            <select id="permRoleSelect" class="input" onchange="permSyncRoleHelp()" style="font-size:13px;max-width:260px">
              ${ROLES.map(r => `<option value="${r.value}">${r.label}</option>`).join("")}
            </select>
            <div id="permRoleHelp" style="font-size:11px;color:#64748b;margin-top:8px"></div>
          </div>

          <div style="margin-bottom:18px;padding:14px 16px;background:#fff;border-radius:10px;border:1px solid #e2e6ed">
            <div style="font-size:12px;font-weight:700;color:#344054;margin-bottom:10px">🔑 Нэвтрэх нэр / password</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <label style="display:block">
                <span style="display:block;font-size:11px;font-weight:700;color:#64748b;margin-bottom:4px">Username</span>
                <input id="permUsername" class="input" placeholder="Утасны дугаар" style="margin:0">
              </label>
              <label style="display:block">
                <span style="display:block;font-size:11px;font-weight:700;color:#64748b;margin-bottom:4px">Утас</span>
                <input id="permPhone" class="input" placeholder="Утасны дугаар" style="margin:0">
              </label>
              <label style="display:block">
                <span style="display:block;font-size:11px;font-weight:700;color:#64748b;margin-bottom:4px">Регистрийн дугаар</span>
                <input id="permRegisterNo" class="input" placeholder="ЖЯ80061073" oninput="permSyncRegPasswordHint()" style="margin:0">
              </label>
              <label style="display:block">
                <span style="display:block;font-size:11px;font-weight:700;color:#64748b;margin-bottom:4px">Шинэ password</span>
                <div style="display:flex;gap:6px">
                  <input id="permNewPassword" class="input" type="text" placeholder="Хоосон бол солихгүй" style="margin:0">
                  <button class="btn secondary sm" onclick="permFillPasswordFromRegister()" style="white-space:nowrap">РД тоо</button>
                </div>
              </label>
            </div>
            <div id="permPasswordHint" style="font-size:11px;color:#64748b;margin-top:8px"></div>
          </div>

          <label style="margin-bottom:18px;padding:12px 14px;border:1px solid #e2e8f0;border-radius:10px;display:flex;align-items:flex-start;gap:10px;cursor:pointer">
            <input type="checkbox" id="permCanLogin" onchange="permSyncLoginControls()" style="width:18px;height:18px;margin-top:1px;accent-color:#2563eb">
            <span>
              <span style="display:block;font-size:12px;font-weight:800;color:#344054">Системд нэвтрэх эрхтэй</span>
              <span style="display:block;font-size:11px;color:#64748b;margin-top:2px">Унтраалттай бол ажилтны бүртгэл хэвээр үлдэнэ, гэхдээ login хийж чадахгүй.</span>
            </span>
          </label>

          <!-- Module permissions -->
          <div id="permModuleBlock">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px">
            <div style="font-size:12px;font-weight:700;color:#344054">📋 Хэсэг тус бүрийн эрх</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button onclick="permSetAll('view',true)" class="btn secondary sm" style="font-size:11px">✓ Бүгдийг харах</button>
              <button onclick="permSetAll('edit',true)" class="btn secondary sm" style="font-size:11px">✓ Бүгдийг засах</button>
              <button onclick="permSetAll('all',false)" class="btn secondary sm" style="font-size:11px;color:#dc2626;border-color:#fca5a5">✕ Бүгдийг цэвэрлэх</button>
            </div>
          </div>

          <div style="border:1px solid #e2e6ed;border-radius:10px;overflow:hidden">
            <table style="width:100%;border-collapse:collapse;font-size:13px">
              <thead>
                <tr style="background:#f8f9fb">
                  <th style="padding:9px 16px;text-align:left;font-size:11px;color:#667085;font-weight:700">ХЭСЭГ / МОДУЛЬ</th>
                  <th style="padding:9px 16px;text-align:center;font-size:11px;color:#2563eb;font-weight:700;width:90px">👁 ХАРАХ</th>
                  <th style="padding:9px 16px;text-align:center;font-size:11px;color:#16a34a;font-weight:700;width:90px">✏️ ЗАСАХ</th>
                </tr>
              </thead>
              <tbody>
                ${PERM_MODULES.map(m => `
                <tr style="border-top:1px solid #f1f5f9" id="permrow_${m.key}">
                  <td style="padding:9px 16px">
                    <span style="font-size:15px;margin-right:8px">${m.icon}</span>
                    <span style="font-weight:500;color:#1e293b">${m.label}</span>
                  </td>
                  <td style="padding:9px 16px;text-align:center">
                    <input type="checkbox" id="perm_view_${m.key}"
                      onchange="if(!this.checked){document.getElementById('perm_edit_${m.key}').checked=false}permRowStyle('${m.key}')"
                      style="width:18px;height:18px;accent-color:#2563eb;cursor:pointer">
                  </td>
                  <td style="padding:9px 16px;text-align:center">
                    <input type="checkbox" id="perm_edit_${m.key}"
                      onchange="if(this.checked){document.getElementById('perm_view_${m.key}').checked=true}permRowStyle('${m.key}')"
                      style="width:18px;height:18px;accent-color:#16a34a;cursor:pointer">
                  </td>
                </tr>`).join("")}
              </tbody>
            </table>
          </div>
          <div style="font-size:11px;color:#64748b;margin-top:8px">Анхаарах: үндсэн role-ийн эрх дээр нэмэлт module эрх нэмж ажиллана. Role-оор өгөгдсөн үндсэн эрхийг эндээс хасахгүй.</div>
          </div>
        </div>

        <div style="padding:14px 24px;border-top:1px solid #e2e6ed;display:flex;gap:10px">
          <button class="btn" onclick="savePermissions()" style="padding:8px 24px">💾 Хадгалах</button>
          <button class="btn secondary" onclick="document.getElementById('permModal').style.display='none'" style="padding:8px 16px">Болих</button>
        </div>
      </div>
    </div>`;

  let _permUserId = null;

  window.permRowStyle = (key) => {
    const row  = document.getElementById(`permrow_${key}`);
    const view = document.getElementById(`perm_view_${key}`)?.checked;
    const edit = document.getElementById(`perm_edit_${key}`)?.checked;
    if (!row) return;
    row.style.background = edit ? "#f0fdf4" : view ? "#eff6ff" : "";
  };

  window.permSyncRoleHelp = () => {
    const role = document.getElementById("permRoleSelect")?.value;
    const help = document.getElementById("permRoleHelp");
    if (help) help.textContent = ROLE_HELP[role] || "";
  };

  window.permSyncLoginControls = () => {
    const enabled = document.getElementById("permCanLogin")?.checked;
    const block = document.getElementById("permModuleBlock");
    if (block) {
      block.style.opacity = enabled ? "1" : ".45";
      block.style.pointerEvents = enabled ? "auto" : "none";
    }
  };

  window.permSyncRegPasswordHint = () => {
    const reg = document.getElementById("permRegisterNo")?.value || "";
    const digits = regDigits(reg);
    const hint = document.getElementById("permPasswordHint");
    if (hint) hint.textContent = digits
      ? `РД-ийн үсгийг хасаад password болгох утга: ${digits}`
      : "РД бөглөгдвөл password-ийг РД-ийн тооноос автоматаар бөглөж болно.";
  };

  window.permFillPasswordFromRegister = () => {
    const digits = regDigits(document.getElementById("permRegisterNo")?.value || "");
    const input = document.getElementById("permNewPassword");
    if (input) input.value = digits;
    permSyncRegPasswordHint();
  };

  window.openPermModal = (userId) => {
    const u = users.find(x => x.id === userId);
    if (!u) return;
    _permUserId = userId;
    document.getElementById("permModalTitle").textContent = `⚙️ Эрх тохируулах — ${u.full_name}`;
    const roleSelect = document.getElementById("permRoleSelect");
    if (roleSelect) roleSelect.value = u.role;
    const usernameInput = document.getElementById("permUsername");
    if (usernameInput) usernameInput.value = u.username || "";
    const phoneInput = document.getElementById("permPhone");
    if (phoneInput) phoneInput.value = u.phone || "";
    const regInput = document.getElementById("permRegisterNo");
    if (regInput) regInput.value = u.register_no || "";
    const passInput = document.getElementById("permNewPassword");
    if (passInput) passInput.value = "";
    const canLogin = document.getElementById("permCanLogin");
    if (canLogin) canLogin.checked = Number(u.can_login) !== 0;
    permSyncRoleHelp();
    permSyncLoginControls();
    permSyncRegPasswordHint();

    let perms = {};
    try { perms = JSON.parse(u.permissions || "{}"); } catch(e) {}

    PERM_MODULES.forEach(m => {
      const vEl = document.getElementById(`perm_view_${m.key}`);
      const eEl = document.getElementById(`perm_edit_${m.key}`);
      if (vEl) vEl.checked = !!(perms[m.key]?.view);
      if (eEl) eEl.checked = !!(perms[m.key]?.edit);
      permRowStyle(m.key);
    });

    document.getElementById("permModal").style.display = "flex";
  };

  window.permSetAll = (type, value) => {
    PERM_MODULES.forEach(m => {
      if (type === "all") {
        const vEl = document.getElementById(`perm_view_${m.key}`);
        const eEl = document.getElementById(`perm_edit_${m.key}`);
        if (vEl) vEl.checked = false;
        if (eEl) eEl.checked = false;
      } else {
        const el = document.getElementById(`perm_${type}_${m.key}`);
        if (el) el.checked = value;
        if (type === "edit" && value) {
          const vEl = document.getElementById(`perm_view_${m.key}`);
          if (vEl) vEl.checked = true;
        }
      }
      permRowStyle(m.key);
    });
  };

  window.savePermissions = async () => {
    if (!_permUserId) return;
    const u = users.find(x => x.id === _permUserId);
    if (!u) return;
    const newRole = document.getElementById("permRoleSelect")?.value || u.role;
    const allowLogin = document.getElementById("permCanLogin")?.checked || false;
    const username = (document.getElementById("permUsername")?.value || "").trim();
    const phone = (document.getElementById("permPhone")?.value || "").trim();
    const registerNo = (document.getElementById("permRegisterNo")?.value || "").trim();
    const newPassword = document.getElementById("permNewPassword")?.value || "";
    if (!username) {
      toast("Username хоосон байж болохгүй");
      return;
    }
    if (newPassword && newPassword.length < 8) {
      toast("Password хамгийн багадаа 8 тэмдэгт байна");
      return;
    }

    const perms = {};
    if (allowLogin) {
      PERM_MODULES.forEach(m => {
        const view = document.getElementById(`perm_view_${m.key}`)?.checked || false;
        const edit = document.getElementById(`perm_edit_${m.key}`)?.checked || false;
        if (view || edit) perms[m.key] = { view, edit };
      });
    }

    try {
      await api(`/api/users/${_permUserId}`, {
        method: "PUT",
        body: JSON.stringify({
          full_name:   u.full_name,
          username,
          role:        newRole,
          position:    u.position    || "",
          register_no: registerNo,
          address:     u.address     || "",
          phone,
          department:  u.department  || "",
          email:       u.email       || null,
          active:      u.active !== 0,
          can_login:   allowLogin,
          permissions: JSON.stringify(perms),
        })
      });
      if (newPassword) {
        await api(`/api/users/${_permUserId}/password`, {
          method: "PUT",
          body: JSON.stringify({ new_password: newPassword })
        });
      }
      toast(`${u.full_name} — эрх шинэчлэгдлээ ✓`);
      document.getElementById("permModal").style.display = "none";
      stabRoles();
    } catch(e) { toast("Алдаа: " + e.message); }
  };

  window.deleteUser = async (id, name) => {
    if (!confirm(`"${name}" хэрэглэгчийг бүрмөсөн устгах уу?\n\nЭнэ үйлдлийг буцаах боломжгүй.`)) return;
    try {
      await api(`/api/users/${id}/permanent`, { method: "DELETE" });
      toast(`${name} — устгагдлаа`);
      stabRoles();
    } catch(e) { toast("Алдаа: " + e.message); }
  };
}

// ── Tab 3: Ажлын категориуд ───────────────────────────────────

async function stabWorkCats() {
  const isAdmin = ["director","chief_engineer"].includes(state.me.role);
  let cats = [];
  try { cats = await api("/api/work-categories"); } catch(e) {}

  document.getElementById("stab_content").innerHTML = `
    <div style="max-width:700px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div>
          <div style="font-size:14px;font-weight:700">🏷 Ажлын категориуд</div>
          <div style="font-size:11px;color:#667085;margin-top:2px">Ажлын явц (Gantt) хуудасны tab-уудыг тохируулна</div>
        </div>
        ${isAdmin ? `<button class="btn sm" onclick="scAddShow()">+ Шинэ нэмэх</button>` : ""}
      </div>

      ${isAdmin ? `
      <div id="scAddForm" style="display:none;background:#f8f9fb;border:1.5px dashed #d0d5dd;border-radius:12px;padding:18px;margin-bottom:16px">
        <div style="font-size:13px;font-weight:700;margin-bottom:14px">Шинэ категори</div>
        <div style="display:grid;grid-template-columns:1fr 56px 1fr 1fr;gap:10px;margin-bottom:12px">
          <div><div style="font-size:11px;font-weight:600;color:#344054;margin-bottom:4px">Нэр *</div>
            <input class="input" id="scName" placeholder="Замын засвар..."></div>
          <div><div style="font-size:11px;font-weight:600;color:#344054;margin-bottom:4px">Дүрс</div>
            <input class="input" id="scIcon" placeholder="🔧" style="font-size:18px;text-align:center"></div>
          <div><div style="font-size:11px;font-weight:600;color:#344054;margin-bottom:4px">Өнгө</div>
            <input type="color" id="scColor" value="#2563eb" style="width:100%;height:38px;border:1px solid #d0d5dd;border-radius:8px;cursor:pointer;padding:2px"></div>
          <div><div style="font-size:11px;font-weight:600;color:#344054;margin-bottom:4px">Хэлтэс (авто бөглөлт)</div>
            <input class="input" id="scDept" placeholder="Инженер, Захиргаа..."></div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn sm" onclick="scSave()">Хадгалах</button>
          <button class="btn secondary sm" onclick="document.getElementById('scAddForm').style.display='none'">Болих</button>
        </div>
      </div>` : ""}

      <div style="display:flex;flex-direction:column;gap:8px">
        ${cats.map((c,i) => `
          <div style="background:#fff;border:1.5px solid #e2e6ed;border-radius:12px;padding:14px 18px;display:flex;align-items:center;gap:14px">
            <div style="width:42px;height:42px;border-radius:10px;background:${escapeHtml(c.color||'#2563eb')}22;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">${escapeHtml(c.icon||'📋')}</div>
            <div style="flex:1;min-width:0">
              <div style="font-weight:700;font-size:14px;color:#1e293b">${escapeHtml(c.name)}</div>
              <div style="font-size:11px;color:#94a3b8;margin-top:2px;display:flex;align-items:center;gap:8px">
                ${c.department?`<span>🏢 ${escapeHtml(c.department)}</span>`:'<span style="color:#d1d5db">Хэлтэс тохируулаагүй</span>'}
                <span style="width:10px;height:10px;border-radius:50%;background:${escapeHtml(c.color||'#2563eb')};display:inline-block"></span>
                <span>${escapeHtml(c.color||'')}</span>
              </div>
            </div>
            ${isAdmin ? `
            <div style="display:flex;gap:6px;flex-shrink:0">
              <button class="btn secondary sm" onclick='scEdit(${JSON.stringify(c)})' style="font-size:12px">✏️ Засах</button>
              <button class="btn danger sm" onclick="scDel(${c.id},'${escapeHtml(c.name)}')" style="font-size:12px">🗑</button>
            </div>` : ""}
          </div>`).join("") || `<div style="text-align:center;color:#94a3b8;padding:40px">Категори бүртгэгдээгүй байна</div>`}
      </div>
    </div>

    <div id="scEditModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;align-items:center;justify-content:center"
      onclick="if(event.target===this)this.style.display='none'">
      <div style="background:#fff;border-radius:14px;width:min(480px,94vw);padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.25)">
        <div style="font-size:15px;font-weight:700;margin-bottom:18px">✏️ Категори засах</div>
        <input type="hidden" id="scEId">
        <div style="display:grid;grid-template-columns:1fr 56px;gap:10px;margin-bottom:12px">
          <div><div style="font-size:11px;font-weight:600;color:#344054;margin-bottom:4px">Нэр *</div>
            <input class="input" id="scEName"></div>
          <div><div style="font-size:11px;font-weight:600;color:#344054;margin-bottom:4px">Дүрс</div>
            <input class="input" id="scEIcon" style="font-size:18px;text-align:center"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px">
          <div><div style="font-size:11px;font-weight:600;color:#344054;margin-bottom:4px">Өнгө</div>
            <input type="color" id="scEColor" style="width:100%;height:38px;border:1px solid #d0d5dd;border-radius:8px;cursor:pointer;padding:2px"></div>
          <div><div style="font-size:11px;font-weight:600;color:#344054;margin-bottom:4px">Хэлтэс</div>
            <input class="input" id="scEDept"></div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn" onclick="scUpdate()">Хадгалах</button>
          <button class="btn secondary" onclick="document.getElementById('scEditModal').style.display='none'">Болих</button>
        </div>
      </div>
    </div>`;

  window.scAddShow = () => {
    const f = document.getElementById("scAddForm");
    if (f) f.style.display = f.style.display === "none" ? "block" : "none";
  };
  window.scSave = async () => {
    const name  = document.getElementById("scName")?.value.trim();
    const icon  = document.getElementById("scIcon")?.value.trim() || "📋";
    const color = document.getElementById("scColor")?.value || "#2563eb";
    const dept  = document.getElementById("scDept")?.value.trim() || "";
    if (!name) { toast("Нэр оруулна уу"); return; }
    try {
      await api("/api/work-categories", { method:"POST", body:JSON.stringify({ name, icon, color, department:dept }) });
      toast("Нэмэгдлээ ✓"); stabWorkCats();
    } catch(e) { toast("Алдаа: " + (e.message||e)); }
  };
  window.scEdit = (c) => {
    document.getElementById("scEId").value    = c.id;
    document.getElementById("scEName").value  = c.name;
    document.getElementById("scEIcon").value  = c.icon || "📋";
    document.getElementById("scEColor").value = c.color || "#2563eb";
    document.getElementById("scEDept").value  = c.department || "";
    document.getElementById("scEditModal").style.display = "flex";
  };
  window.scUpdate = async () => {
    const id    = document.getElementById("scEId")?.value;
    const name  = document.getElementById("scEName")?.value.trim();
    const icon  = document.getElementById("scEIcon")?.value.trim() || "📋";
    const color = document.getElementById("scEColor")?.value || "#2563eb";
    const dept  = document.getElementById("scEDept")?.value.trim() || "";
    if (!name) { toast("Нэр оруулна уу"); return; }
    try {
      await api(`/api/work-categories/${id}`, { method:"PUT", body:JSON.stringify({ name, icon, color, department:dept, is_active:1 }) });
      document.getElementById("scEditModal").style.display = "none";
      toast("Шинэчлэгдлээ ✓"); stabWorkCats();
    } catch(e) { toast("Алдаа: " + (e.message||e)); }
  };
  window.scDel = async (id, name) => {
    if (!confirm(`"${name}" категорийг нуух уу?\n(Одоо байгаа ажлууд хадгалагдсан хэвээр үлдэнэ)`)) return;
    try {
      await api(`/api/work-categories/${id}`, { method:"DELETE" });
      toast("Нуугдлаа ✓"); stabWorkCats();
    } catch(e) { toast("Алдаа: " + (e.message||e)); }
  };
}

// ── Tab 4: Хөрөнгийн ангилал ─────────────────────────────────

async function stabAssetCats() {
  const isAdmin = ["director","chief_engineer"].includes(state.me.role);
  let cats = [];
  try { cats = await api("/api/asset-categories"); } catch(e) {}

  document.getElementById("stab_content").innerHTML = `
  <div class="panel" style="padding:0;overflow:hidden">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #e2e6ed">
      <div style="font-size:14px;font-weight:700">🏗 Хөрөнгийн ангилал <span style="font-size:12px;color:#667085;font-weight:400">(${cats.length})</span></div>
      ${isAdmin ? `<button class="btn sm" onclick="sacOpenAdd()">+ Ангилал нэмэх</button>` : ""}
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:#f8f9fb">
        <th style="padding:8px 14px;text-align:left;font-size:11px;color:#667085;font-weight:700">АНГИЛАЛ</th>
        <th style="padding:8px 14px;text-align:left;font-size:11px;color:#667085;font-weight:700">ӨНГ</th>
        ${isAdmin ? `<th style="padding:8px 14px;font-size:11px;color:#667085;font-weight:700"></th>` : ""}
      </tr></thead>
      <tbody>
        ${cats.map(c => `
        <tr style="border-bottom:1px solid #f1f5f9">
          <td style="padding:10px 14px">
            <span style="font-size:20px">${c.icon||"📦"}</span>
            <span style="font-weight:700;margin-left:8px">${escapeHtml(c.name)}</span>
          </td>
          <td style="padding:10px 14px">
            <span style="display:inline-flex;align-items:center;gap:6px">
              <span style="width:18px;height:18px;border-radius:50%;background:${c.color||'#94a3b8'};display:inline-block;border:2px solid ${c.border||'#e2e8f0'}"></span>
              <span style="font-size:11px;color:#667085;font-family:monospace">${c.color||''}</span>
            </span>
          </td>
          ${isAdmin ? `<td style="padding:10px 14px;text-align:right">
            <button class="btn secondary sm" onclick="sacOpenEdit(${c.id},'${escapeHtml(c.name).replace(/'/g,"\\'")}','${c.icon||"📦"}','${c.color||"#94a3b8"}','${c.bg||"#f8fafc"}','${c.border||"#e2e8f0"}')">✏️</button>
            <button class="btn danger sm" onclick="sacDelete(${c.id},'${escapeHtml(c.name).replace(/'/g,"\\'")}')" style="margin-left:4px">🗑</button>
          </td>` : ""}
        </tr>`).join("")}
      </tbody>
    </table>
  </div>

  <div id="sacModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2000;align-items:center;justify-content:center"
    onclick="if(event.target===this)document.getElementById('sacModal').style.display='none'">
    <div style="background:#fff;border-radius:14px;width:min(420px,96vw);padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.2)">
      <div id="sacModalTitle" style="font-size:15px;font-weight:800;margin-bottom:18px"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
        <div style="grid-column:1/-1">
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Нэр *</div>
          <input class="input" id="sac_name" placeholder="Цахилгаан шугам...">
        </div>
        <div>
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Дүрс (emoji)</div>
          <input class="input" id="sac_icon" placeholder="⚡" style="font-size:18px;text-align:center">
        </div>
        <div>
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Үндсэн өнгө</div>
          <div style="display:flex;gap:6px;align-items:center">
            <input type="color" id="sac_color" value="#94a3b8" style="width:40px;height:34px;border:1px solid #e2e6ed;border-radius:6px;cursor:pointer;padding:2px">
            <input class="input" id="sac_colorhex" placeholder="#94a3b8" style="font-family:monospace;font-size:12px" oninput="document.getElementById('sac_color').value=this.value">
          </div>
        </div>
        <div>
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Арын өнгө</div>
          <div style="display:flex;gap:6px;align-items:center">
            <input type="color" id="sac_bg" value="#f8fafc" style="width:40px;height:34px;border:1px solid #e2e6ed;border-radius:6px;cursor:pointer;padding:2px">
            <input class="input" id="sac_bghex" placeholder="#f8fafc" style="font-family:monospace;font-size:12px" oninput="document.getElementById('sac_bg').value=this.value">
          </div>
        </div>
        <div>
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Хүрээний өнгө</div>
          <div style="display:flex;gap:6px;align-items:center">
            <input type="color" id="sac_border" value="#e2e8f0" style="width:40px;height:34px;border:1px solid #e2e6ed;border-radius:6px;cursor:pointer;padding:2px">
            <input class="input" id="sac_borderhex" placeholder="#e2e8f0" style="font-family:monospace;font-size:12px" oninput="document.getElementById('sac_border').value=this.value">
          </div>
        </div>
        <div>
          <div style="font-size:11px;color:#667085;margin-bottom:4px">Эрэмбэ</div>
          <input class="input" id="sac_order" type="number" value="99" min="1">
        </div>
      </div>
      <div id="sacPreview" style="margin-bottom:14px;padding:12px 14px;border-radius:10px;display:flex;align-items:center;gap:8px;border:2px solid #e2e8f0;background:#f8fafc">
        <span id="sacPrevIcon" style="font-size:22px">📦</span>
        <span id="sacPrevName" style="font-weight:700;font-size:13px">Жишээ ангилал</span>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn" onclick="sacSave()" style="flex:1">Хадгалах</button>
        <button class="btn secondary" onclick="document.getElementById('sacModal').style.display='none'">Цуцлах</button>
      </div>
    </div>
  </div>`;

  let _sacEditId = 0;

  window.sacOpenAdd = () => {
    _sacEditId = 0;
    document.getElementById("sacModalTitle").textContent = "+ Ангилал нэмэх";
    document.getElementById("sac_name").value    = "";
    document.getElementById("sac_icon").value    = "📦";
    document.getElementById("sac_color").value   = "#94a3b8";
    document.getElementById("sac_colorhex").value= "#94a3b8";
    document.getElementById("sac_bg").value      = "#f8fafc";
    document.getElementById("sac_bghex").value   = "#f8fafc";
    document.getElementById("sac_border").value  = "#e2e8f0";
    document.getElementById("sac_borderhex").value="#e2e8f0";
    document.getElementById("sac_order").value   = "99";
    document.getElementById("sacModal").style.display = "flex";
    document.getElementById("sac_name").focus();
  };

  window.sacOpenEdit = (id, name, icon, color, bg, border) => {
    _sacEditId = id;
    document.getElementById("sacModalTitle").textContent = "✏️ Ангилал засах";
    document.getElementById("sac_name").value    = name;
    document.getElementById("sac_icon").value    = icon;
    document.getElementById("sac_color").value   = color;
    document.getElementById("sac_colorhex").value= color;
    document.getElementById("sac_bg").value      = bg;
    document.getElementById("sac_bghex").value   = bg;
    document.getElementById("sac_border").value  = border;
    document.getElementById("sac_borderhex").value=border;
    document.getElementById("sacModal").style.display = "flex";
  };

  window.sacSave = async () => {
    const name   = document.getElementById("sac_name").value.trim();
    const icon   = document.getElementById("sac_icon").value.trim()   || "📦";
    const color  = document.getElementById("sac_colorhex").value.trim()  || document.getElementById("sac_color").value;
    const bg     = document.getElementById("sac_bghex").value.trim()     || document.getElementById("sac_bg").value;
    const border = document.getElementById("sac_borderhex").value.trim()  || document.getElementById("sac_border").value;
    const sort_order = Number(document.getElementById("sac_order").value || 99);
    if (!name) { toast("Нэр оруулна уу"); return; }
    try {
      if (_sacEditId) {
        await api(`/api/asset-categories/${_sacEditId}`, { method:"PUT", body:JSON.stringify({ name, icon, color, bg, border, sort_order, is_active:1 }) });
        toast("Шинэчлэгдлээ ✓");
      } else {
        await api("/api/asset-categories", { method:"POST", body:JSON.stringify({ name, icon, color, bg, border, sort_order }) });
        toast("Нэмэгдлээ ✓");
      }
      document.getElementById("sacModal").style.display = "none";
      stabAssetCats();
    } catch(e) { toast("Алдаа: " + (e.message||e)); }
  };

  window.sacDelete = async (id, name) => {
    if (!confirm(`"${name}" ангилалыг нуух уу?`)) return;
    try {
      await api(`/api/asset-categories/${id}`, { method:"DELETE" });
      toast("Нуугдлаа ✓"); stabAssetCats();
    } catch(e) { toast("Алдаа: " + (e.message||e)); }
  };

  // Live preview
  const updatePreview = () => {
    const icon  = document.getElementById("sac_icon")?.value   || "📦";
    const name  = document.getElementById("sac_name")?.value   || "Жишээ ангилал";
    const color = document.getElementById("sac_colorhex")?.value || "#94a3b8";
    const bg    = document.getElementById("sac_bghex")?.value   || "#f8fafc";
    const brd   = document.getElementById("sac_borderhex")?.value|| "#e2e8f0";
    const prev  = document.getElementById("sacPreview");
    if (prev) { prev.style.background = bg; prev.style.borderColor = brd; }
    const pi = document.getElementById("sacPrevIcon"); if (pi) pi.textContent = icon;
    const pn = document.getElementById("sacPrevName"); if (pn) { pn.textContent = name; pn.style.color = color; }
  };
  ["sac_icon","sac_name","sac_colorhex","sac_bghex","sac_borderhex"].forEach(id => {
    document.getElementById(id)?.addEventListener("input", updatePreview);
  });
  document.getElementById("sac_color")?.addEventListener("input", e => {
    document.getElementById("sac_colorhex").value = e.target.value; updatePreview();
  });
  document.getElementById("sac_bg")?.addEventListener("input", e => {
    document.getElementById("sac_bghex").value = e.target.value; updatePreview();
  });
  document.getElementById("sac_border")?.addEventListener("input", e => {
    document.getElementById("sac_borderhex").value = e.target.value; updatePreview();
  });
}

// ── Tab 5: Дэлгэцийн тохиргоо ────────────────────────────────

function stabDisplay() {
  const cur = {
    compact:   localStorage.getItem("ui_compact")   === "1",
    sideWidth: localStorage.getItem("ui_sideWidth") || "200",
    fontSize:  localStorage.getItem("ui_fontSize")  || "14",
    theme:     localStorage.getItem("ui_theme")     || "light",
  };

  document.getElementById("stab_content").innerHTML = `
    <div style="max-width:560px">
      <div class="panel" style="padding:22px;margin-bottom:14px">
        <div style="font-size:14px;font-weight:700;margin-bottom:18px;color:#1e293b">🎨 Дэлгэцийн тохиргоо</div>

        <div style="margin-bottom:18px">
          <div style="font-size:12px;font-weight:600;color:#344054;margin-bottom:10px">Загвар</div>
          <div style="display:flex;gap:10px">
            ${[["light","☀️ Цагаан"],["dark","🌙 Харанхуй"]].map(([v,l]) => `
              <button onclick="uiSetTheme('${v}')" id="theme_${v}"
                style="flex:1;padding:12px;border-radius:10px;cursor:pointer;font-size:13px;font-weight:600;transition:all .15s;
                       border:2px solid ${cur.theme===v?'#2563eb':'#e2e6ed'};
                       background:${cur.theme===v?'#eff6ff':'#fff'};
                       color:${cur.theme===v?'#2563eb':'#667085'}">
                ${l}
              </button>`).join("")}
          </div>
        </div>

        <div style="margin-bottom:18px">
          <div style="font-size:12px;font-weight:600;color:#344054;margin-bottom:6px">Үсгийн хэмжээ · <span id="fsSz">${cur.fontSize}</span>px</div>
          <input type="range" id="uiFontSize" min="12" max="18" step="1" value="${cur.fontSize}"
            oninput="document.getElementById('fsSz').textContent=this.value"
            style="width:100%;accent-color:#2563eb">
          <div style="display:flex;justify-content:space-between;font-size:11px;color:#94a3b8;margin-top:2px"><span>12px</span><span>18px</span></div>
        </div>

        <div style="margin-bottom:18px">
          <label style="display:flex;align-items:center;gap:12px;cursor:pointer;padding:12px;border:1.5px solid #e2e6ed;border-radius:10px;${cur.compact?'border-color:#2563eb;background:#eff6ff':''}">
            <input type="checkbox" id="uiCompact" ${cur.compact?'checked':''} style="width:16px;height:16px;accent-color:#2563eb"
              onchange="document.getElementById('compactRow').style.borderColor=this.checked?'#2563eb':'#e2e6ed';
                        document.getElementById('compactRow').style.background=this.checked?'#eff6ff':'#fff'">
            <div id="compactRow" style="pointer-events:none">
              <div style="font-size:13px;font-weight:600;color:#1e293b">Нягт загвар</div>
              <div style="font-size:11px;color:#94a3b8;margin-top:1px">Table row болон padding багасна</div>
            </div>
          </label>
        </div>

        <button class="btn" onclick="uiSaveDisplay()">💾 Хэрэглэх</button>
      </div>

      <div class="panel" style="padding:18px">
        <div style="font-size:13px;font-weight:700;margin-bottom:10px;color:#1e293b">🔑 Нууц үг солих</div>
        <div style="display:flex;flex-direction:column;gap:8px;max-width:320px">
          <input class="input" id="curPwd" type="password" placeholder="Одоогийн нууц үг">
          <input class="input" id="newPwd" type="password" placeholder="Шинэ нууц үг (8+ тэмдэгт)">
          <input class="input" id="newPwd2" type="password" placeholder="Шинэ нууц үг давтах">
          <button class="btn secondary" onclick="changeMyPassword()">Нууц үг шинэчлэх</button>
        </div>
      </div>
    </div>`;

  window.uiSetTheme = (theme) => {
    ["light","dark"].forEach(v => {
      const b = document.getElementById(`theme_${v}`);
      if (!b) return;
      b.style.borderColor = v === theme ? "#2563eb" : "#e2e6ed";
      b.style.background  = v === theme ? "#eff6ff" : "#fff";
      b.style.color       = v === theme ? "#2563eb" : "#667085";
    });
    document.getElementById("uiFontSize").dataset.theme = theme;
  };

  window.uiSaveDisplay = () => {
    const compact  = document.getElementById("uiCompact")?.checked;
    const fontSize = document.getElementById("uiFontSize")?.value || "14";
    const themeBtn = document.querySelector("[id^='theme_'][style*='#eff6ff']");
    const theme    = themeBtn?.id?.replace("theme_","") || localStorage.getItem("ui_theme") || "light";
    localStorage.setItem("ui_compact",   compact ? "1" : "0");
    localStorage.setItem("ui_fontSize",  fontSize);
    localStorage.setItem("ui_theme",     theme);
    document.documentElement.style.fontSize = fontSize + "px";
    toast("Тохиргоо хэрэглэгдлээ ✓ · Хуудсыг дахин ачаалахад бүрэн идэвхжинэ");
  };

  window.changeMyPassword = async () => {
    const cur  = document.getElementById("curPwd")?.value;
    const np   = document.getElementById("newPwd")?.value;
    const np2  = document.getElementById("newPwd2")?.value;
    if (!cur)             { toast("Одоогийн нууц үг оруулна уу"); return; }
    if (!np || np.length < 8) { toast("Шинэ нууц үг хамгийн багадаа 8 тэмдэгт байх ёстой"); return; }
    if (np !== np2)       { toast("Нууц үг таарахгүй байна"); return; }
    try {
      await api(`/api/users/${state.me.id}/password`, {
        method: "PUT",
        body: JSON.stringify({ current_password: cur, new_password: np })
      });
      toast("Нууц үг шинэчлэгдлээ ✓");
      document.getElementById("curPwd").value = "";
      document.getElementById("newPwd").value = "";
      document.getElementById("newPwd2").value = "";
    } catch(e) { toast("Алдаа: " + e.message); }
  };
}

Object.assign(window, { settings, settingsTab: () => {}, stabOrg, stabRoles, stabPublicAlerts, stabWorkCats, stabAssetCats, stabDisplay });
