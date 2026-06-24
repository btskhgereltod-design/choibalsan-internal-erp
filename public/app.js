import { state, api, toast, initFloatingScrollbar } from './modules/common.js';
import './modules/dashboard.js?v=20260526dashboardorder';
import './modules/assets.js?v=20260619cameragpslist';
import './modules/operations.js?v=20260609autoprogress';
import './modules/warehouse.js';
import './modules/hr.js?v=20260612attendanceovertime';
import './modules/docs.js';
import './modules/habea.js?v=20260612repairrole';
import './modules/reports.js';
import './modules/nyagtlan.js?v=20260526financenavfix';
import './modules/nyarav.js?v=20260608manualmat';
import './modules/personal_plan.js?v=20260604time24select';
import './modules/admin_hub.js';
import './modules/streetlights.js?v=20260618noloratab';
import './modules/lighting_schedule.js?v=20260527engineeredit';
import './modules/lora_monitor.js?v=20260618redirect';
import './modules/iot_monitor.js?v=20260618iotchart';
import './modules/settings.js?v=20260527loginrights';
import './modules/eng_hub.js?v=20260529monthfilter';
import './modules/field.js?v=20260608hseacktarget';
import './modules/habea_hub.js';
import './modules/my_job_description.js?v=20260610';
import './modules/website.js?v=20260623';
import { initErpAssistant } from './modules/assistant.js?v=20260612chatreactions';
import { dev_requests } from './modules/dev_requests.js';

const _shellTimers = { clock: null, notif: null, clickHandler: null };

const LIGHTING_MENUS = ["sl_dashboard","iot_monitor"];
const FINANCE_MENUS = ["finance"];
const WAREHOUSE_MENUS = ["nyarav"];
const CAMERA_MENUS = ["camera_assets"];

function syncMobileClass() {
  const isMobile = window.matchMedia("(max-width: 900px)").matches ||
    window.matchMedia("(pointer: coarse)").matches ||
    Math.min(window.screen?.width || 9999, window.screen?.height || 9999) <= 760;
  document.body.classList.toggle("is-mobile", isMobile);
}

syncMobileClass();
window.addEventListener("resize", syncMobileClass);
window.addEventListener("orientationchange", syncMobileClass);

const roleMenus = {
  director:       ["eng_hub","habea_hub","dashboard","personal_plan","my_job_description","website","assets","attendance","work","hr","letters","plans","reports","report_schedule","reports_unified","audit","dev_requests","ai_test",
                   ...FINANCE_MENUS, ...WAREHOUSE_MENUS, ...LIGHTING_MENUS, ...CAMERA_MENUS, "settings"],
  chief_engineer: ["eng_hub","habea_hub","dashboard","personal_plan","my_job_description","website","assets","attendance","work","letters","docs","plans","reports","reports_unified","dev_requests",
                   ...WAREHOUSE_MENUS, ...LIGHTING_MENUS, ...CAMERA_MENUS],
  engineer:       ["dashboard","personal_plan","my_job_description","attendance","work","field","letters","docs","reports", ...LIGHTING_MENUS],
  storekeeper:    ["dashboard","personal_plan","my_job_description","assets","attendance","reports",
                   "letters", ...WAREHOUSE_MENUS],
  accountant:     ["dashboard","personal_plan","my_job_description","attendance","reports","report_schedule",
                   "letters","plans", ...FINANCE_MENUS, ...LIGHTING_MENUS],
  hr:             ["dashboard","personal_plan","my_job_description","website","attendance","hr","letters","reports","report_schedule","payroll","plans"],
  safety:         ["habea_hub","dashboard","personal_plan","my_job_description","attendance","hr","letters","reports","plans"],
  electric:       ["dashboard","personal_plan","my_job_description","attendance","work","field","letters","reports","plans", ...LIGHTING_MENUS],
  camera_engineer:["dashboard","personal_plan","my_job_description","attendance","work","field","letters","docs","reports","plans", ...CAMERA_MENUS],
  worker:         ["dashboard","my_job_description","field"]
};

const menuNames = {
  eng_hub:       "🔧 Ерөнхий инженерийн самбар",
  habea_hub:     "🦺 ХАБЭА самбар",
  dashboard:     "📊 Нэгдсэн дэлгэц",
  personal_plan: "✓ Миний төлөвлөгөө",
  my_job_description: "📄 Миний ажлын байрны тодорхойлолт",
  website:       "🌐 Вэб сайт",
  assets:        "🏗 Объектийн бүртгэл",
  attendance:    "⏱ Ирц / цагийн бүртгэл",
  work:          "📅 Ажлын явц (Gantt)",
  field:         "📱 Талбайн ажил",
  materials:     "📦 Агуулах / Материал",
  expenses:      "💰 Зардал",
  admin_hub:     "🏛 Захиргаа / HR / Архив",
  hr:            "🏛 Хүний нөөцийн удирдлага",
  letters:       "📨 Миний албан бичиг",
  docs:          "📄 Бичиг / гомдол",
  safety:        "🦺 ХАБЭА",
  plans:         "📈 Ирээдүйн төсөл",
  reports:          "📑 Ажлын тайлан",
  report_schedule:  "📋 Тайлангийн хуваарь",
  reports_unified:  "📊 Нэгтгэсэн тайлан",
  audit:            "🛡 Audit log",
  dev_requests:    "🛠 ERP хөгжүүлэлт",
  ai_test:         "🤖 AI Тест",
  settings:        "⚙️ Тохиргоо",
  // Нягтлан
  finance:       "💼 Санхүү",
  fin_dashboard: "💼 Санхүүгийн самбар",
  cash_journal:  "📋 Мөнгөн хөрөнгийн журнал",
  payables:      "↓ Өглөг",
  receivables:   "↑ Авлага",
  fixed_ledger:  "🏢 Үндсэн хөрөнгийн бүртгэл",
  payroll:       "👷 Цалингийн тооцоо",
  fin_reports:   "📑 Санхүүгийн тайлан",
  // Нярав
  nyarav:        "📦 Нярав",
  nyarav_dash:   "📦 Агуулахын самбар",
  nyarav_intake: "📥 Орлого",
  nyarav_issue:  "📤 Зарлага",
  nyarav_stock:  "🔢 Үлдэгдлийн бүртгэл",
  nyarav_order:  "📝 Захиалга",
  nyarav_report: "📊 Нярав тайлан",
  // Гэрэлтүүлгийн хөрөнгө
  sl_asset_road:   "💡 Авто замын гэрэл",
  sl_asset_ger:    "🏘️ Гэр хорооллын гэрэл",
  sl_asset_tower:  "🗼 Цамхагийн гэрэл",
  sl_asset_signal: "🚦 Гэрлэн дохио",
  sl_asset_panel:  "⚡ Шит/Самбар",
  // Гудамжны гэрэл
  sl_dashboard:  "💡 Гэрэлтүүлэг",
  sl_points:     "📍 Тоолуур шидний байршил",
  sl_readings:   "📊 Сарын уншилт",
  sl_bills:      "🧾 Нэхэмжлэл / Харьцуулалт",
  sl_budget:     "📊 Төлөвлөгөө / Гүйцэтгэл",
  sl_faults:     "⚡ Гэмтэл / Засварын бүртгэл",
  sl_light_sched: "🌙 Гэрэлтүүлгийн цаг тохиргоо",
  lora_monitor:   "📡 LoRaWAN хяналтын систем",
  iot_monitor:    "IoT Гэрэлтүүлгийн хяналт",
  // Камер
  camera_assets:  "🎥 Камерын бүртгэл"
};

const menuGroups = [
  { label: "ХЯНАХ САМБАР",        items: ["dashboard","personal_plan","my_job_description"] },
  { label: "ОБЪЕКТИЙН БҮРТГЭЛ",  items: ["assets"] },
  { label: "ҮЙЛДЛИЙН УДИРДЛАГА", items: ["attendance","work","field"] },
  { label: "БАЙГУУЛЛАГА",         items: ["website","hr","letters","eng_hub","habea_hub","safety","plans", ...LIGHTING_MENUS, ...CAMERA_MENUS, "finance", ...WAREHOUSE_MENUS, "payroll"] },
  { label: "ТАЙЛАН & ХЯНАЛТ",    items: ["reports","report_schedule","reports_unified","audit"] },
  { label: "ERP ХӨГЖҮҮЛЭЛТ",   items: ["dev_requests","ai_test"] },
  { label: "ТОХИРГОО",    items: ["settings"] },
];

// ── Login UI ─────────────────────────────────────────────────

function renderLogin() {
  const remembered = localStorage.getItem("remembered_login") || localStorage.getItem("remembered_email") || "";
  const params = new URLSearchParams(location.search);
  const resetToken = params.get("reset_token");

  document.getElementById("app").innerHTML = `
  <div class="login">
    <div class="card">
      <div class="login-logo">
        <img src="/logo.jpg" onerror="this.style.display='none'"
             style="width:52px;height:52px;border-radius:12px;object-fit:contain;background:rgba(255,255,255,.08);padding:6px;border:1px solid rgba(255,255,255,.15)">
        <div>
          <div style="font-weight:800;font-size:18px;color:var(--ink);letter-spacing:-.02em">Чойбалсан хөгжил</div>
          <div style="font-size:11px;color:var(--ink3);letter-spacing:.06em">ОНӨҮГ · SMART CITY ERP</div>
        </div>
      </div>

      <!-- Login form -->
      <div id="loginView" style="${resetToken ? 'display:none' : ''}">
        <input class="input" id="loginEmail" type="text" placeholder="Утасны дугаар"
               value="${remembered}" autocomplete="username"
               onkeydown="if(event.key==='Enter')document.getElementById('loginPassword').focus()">
        <input class="input" id="loginPassword" type="password" placeholder="Нууц үг"
               autocomplete="current-password"
               onkeydown="if(event.key==='Enter')login()">
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink3);margin:4px 0 2px;cursor:pointer">
          <input type="checkbox" id="rememberMe" ${remembered ? 'checked' : ''}>
          Утасны дугаар сануулах
        </label>
        <div id="loginError" style="display:none;color:#ef4444;font-size:13px;padding:8px 12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;margin-bottom:2px"></div>
        <button class="btn" style="width:100%;margin-top:6px" onclick="login()">Нэвтрэх</button>
        <div style="text-align:center;margin-top:14px">
          <a href="#" style="font-size:13px;color:var(--blue);text-decoration:none"
             onclick="showForgotPassword();return false">Нууц үгээ мартсан уу?</a>
        </div>
      </div>

      <!-- Forgot password form -->
      <div id="forgotView" style="display:none">
        <div style="font-weight:700;font-size:15px;margin-bottom:6px">🔑 Нууц үг сэргээх</div>
        <p style="font-size:13px;color:var(--ink3);margin-bottom:14px">
          Бүртгэлтэй и-мэйл хаягаа оруулбал сэргээх холбоос илгээнэ.
        </p>
        <input class="input" id="forgotEmail" type="email" placeholder="И-мэйл хаяг"
               onkeydown="if(event.key==='Enter')forgotPassword()">
        <button class="btn" style="width:100%;margin-top:6px" onclick="forgotPassword()">Холбоос илгээх</button>
        <div style="text-align:center;margin-top:12px">
          <a href="#" style="font-size:13px;color:var(--ink3);text-decoration:none"
             onclick="showLoginView();return false">← Нэвтрэх хуудас руу буцах</a>
        </div>
      </div>

      <!-- Reset password form -->
      <div id="resetView" style="${resetToken ? '' : 'display:none'}">
        <div style="font-weight:700;font-size:15px;margin-bottom:6px">🔒 Шинэ нууц үг тохируулах</div>
        <p style="font-size:13px;color:var(--ink3);margin-bottom:14px">
          Нууц үг хамгийн багадаа 8 тэмдэгт байх ёстой.
        </p>
        <input class="input" id="resetPassword" type="password" placeholder="Шинэ нууц үг (8+ тэмдэгт)"
               autocomplete="new-password">
        <input class="input" id="resetPassword2" type="password" placeholder="Нууц үг давтах"
               autocomplete="new-password"
               onkeydown="if(event.key==='Enter')resetPassword()">
        <div id="resetError" style="display:none;color:#ef4444;font-size:13px;padding:8px 12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;margin-bottom:2px"></div>
        <button class="btn" style="width:100%;margin-top:6px" onclick="resetPassword()">Нууц үг шинэчлэх</button>
      </div>
    </div>
  </div>`;

  if (resetToken) window._resetToken = resetToken;
}

function showForgotPassword() {
  document.getElementById("loginView").style.display   = "none";
  document.getElementById("forgotView").style.display  = "block";
  document.getElementById("resetView").style.display   = "none";
  const fe = document.getElementById("forgotEmail");
  const le = document.getElementById("loginEmail");
  if (fe && le) fe.value = le.value;
  fe?.focus();
}

function showLoginView() {
  document.getElementById("loginView").style.display   = "block";
  document.getElementById("forgotView").style.display  = "none";
  document.getElementById("resetView").style.display   = "none";
  document.getElementById("loginEmail")?.focus();
}

async function login() {
  const email    = document.getElementById("loginEmail")?.value.trim();
  const password = document.getElementById("loginPassword")?.value;
  const remember = document.getElementById("rememberMe")?.checked;
  const errEl    = document.getElementById("loginError");

  if (errEl) errEl.style.display = "none";
  if (!email || !password) {
    if (errEl) { errEl.textContent = "Утасны дугаар болон нууц үгийг оруулна уу"; errEl.style.display = "block"; }
    return;
  }

  try {
    const r = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    if (remember) {
      localStorage.setItem("remembered_login", email);
      localStorage.removeItem("remembered_email");
    } else {
      localStorage.removeItem("remembered_login");
      localStorage.removeItem("remembered_email");
    }
    state.token = r.token;
    state.me    = r.user;
    localStorage.setItem("token", state.token);
    localStorage.setItem("me", JSON.stringify(state.me));
    history.replaceState(null, "", "/erp");
    init();
  } catch(e) {
    if (errEl) {
      errEl.textContent  = "Утасны дугаар эсвэл нууц үг буруу байна";
      errEl.style.display = "block";
    }
    document.getElementById("loginPassword")?.select();
  }
}

async function forgotPassword() {
  const email = document.getElementById("forgotEmail")?.value.trim();
  if (!email) { toast("И-мэйл хаяг оруулна уу"); return; }
  try {
    const r = await api("/api/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email })
    });
    const fv = document.getElementById("forgotView");
    if (fv) fv.innerHTML = `
      <div style="text-align:center;padding:12px 0">
        <div style="font-size:40px;margin-bottom:12px">📧</div>
        <div style="font-weight:700;margin-bottom:8px">Амжилттай илгээлээ!</div>
        <p style="font-size:13px;color:var(--ink3)">
          <b>${email}</b> хаяг руу сэргээх холбоос илгээлээ.<br>
          Хэдэн минутын дотор ирэх болно.
        </p>
        ${r.debug_link ? `<div style="margin-top:16px;padding:10px;background:#f0f9ff;border-radius:8px;font-size:11px;word-break:break-all;text-align:left;color:#0369a1">
          <b>SMTP тохиргоогүй тул холбоосыг шууд ашиглана уу:</b><br>
          <a href="${r.debug_link}" style="color:#2563eb">${r.debug_link}</a>
        </div>` : ""}
        <a href="#" style="display:block;margin-top:16px;font-size:13px;color:var(--ink3);text-decoration:none"
           onclick="showLoginView();return false">← Нэвтрэх хуудас руу буцах</a>
      </div>`;
  } catch(e) { toast(e.message || "Алдаа гарлаа"); }
}

async function resetPassword() {
  const pwd  = document.getElementById("resetPassword")?.value;
  const pwd2 = document.getElementById("resetPassword2")?.value;
  const errEl = document.getElementById("resetError");
  if (errEl) errEl.style.display = "none";

  if (!pwd || pwd.length < 8) {
    if (errEl) { errEl.textContent = "Нууц үг хамгийн багадаа 8 тэмдэгт байх ёстой"; errEl.style.display = "block"; }
    return;
  }
  if (pwd !== pwd2) {
    if (errEl) { errEl.textContent = "Нууц үг таарахгүй байна"; errEl.style.display = "block"; }
    return;
  }
  try {
    await api("/api/reset-password", {
      method: "POST",
      body: JSON.stringify({ token: window._resetToken, password: pwd })
    });
    const rv = document.getElementById("resetView");
    if (rv) rv.innerHTML = `
      <div style="text-align:center;padding:12px 0">
        <div style="font-size:40px;margin-bottom:12px">✅</div>
        <div style="font-weight:700;margin-bottom:8px">Нууц үг шинэчлэгдлээ!</div>
        <p style="font-size:13px;color:var(--ink3)">Шинэ нууц үгээрээ нэвтэрч болно.</p>
      </div>`;
    history.replaceState(null, "", "/erp");
    setTimeout(() => renderLogin(), 2500);
  } catch(e) {
    if (errEl) { errEl.textContent = e.message || "Алдаа гарлаа"; errEl.style.display = "block"; }
  }
}

// ── Shell ────────────────────────────────────────────────────

function logout() {
  if (_shellTimers.clock)        { clearInterval(_shellTimers.clock);  _shellTimers.clock = null; }
  if (_shellTimers.notif)        { clearInterval(_shellTimers.notif);  _shellTimers.notif = null; }
  if (_shellTimers.clickHandler) { document.removeEventListener("click", _shellTimers.clickHandler, true); _shellTimers.clickHandler = null; }
  localStorage.clear();
  state.token = "";
  state.me    = null;
  renderLogin();
}

async function init() {
  if (!state.token) return renderLogin();
  try {
    state.users = await api("/api/users");
  } catch {
    return renderLogin();
  }
  renderShell();
  initFloatingScrollbar();
  initErpAssistant();
  initCtrlRightDragZoom();
  show("dashboard");
}

function renderSidebar(allowedMenus) {
  let html = '<div class="menu">';
  menuGroups.forEach(({ label, items, collapsed }, idx) => {
    const visible = items.filter(m => allowedMenus.includes(m));
    if (!visible.length) return;
    const isOpen = !collapsed || visible.includes(state.current);
    const groupId = `side_group_${idx}`;
    html += collapsed
      ? `<button type="button" class="side-group-btn ${isOpen ? "open" : ""}" onclick="toggleSideGroup('${groupId}', this)">
          <span>${label}</span><span class="side-group-count">${visible.length}</span><span class="side-group-caret">▾</span>
        </button><div id="${groupId}" class="side-group-items" style="display:${isOpen ? "block" : "none"}">`
      : `<div class="side-label">${label}</div>`;
    visible.forEach(m => {
      const [icon, ...nameParts] = (menuNames[m] || m).split(" ");
      html += `<button onclick="show('${m}')" id="menu_${m}" class="${state.current === m ? 'active' : ''}">
        <span class="menu-icon">${icon}</span>${nameParts.join(" ")}
      </button>`;
    });
    if (collapsed) html += '</div>';
    html += '<div class="side-divider"></div>';
  });
  html += '</div>';
  return html;
}

function toggleSideGroup(id, btn) {
  const el = document.getElementById(id);
  if (!el) return;
  const open = el.style.display === "none";
  el.style.display = open ? "block" : "none";
  btn?.classList.toggle("open", open);
}

const PERM_TO_MENUS = {
  dashboard:    ["dashboard"],
  assets:       ["assets"],
  warehouse:    ["nyarav"],
  operations:   ["work"],
  reports:      ["reports","report_schedule"],
  docs:         ["docs"],
  streetlights: LIGHTING_MENUS,
  camera:      CAMERA_MENUS,
  lora:         ["lora_monitor"],
  nyagtlan:     ["finance"],
  habea:        ["safety"],
  admin_hub:    ["hr","attendance","plans"],
  settings:     ["settings"],
};

function getAllowedMenus() {
  if (["director","chief_engineer"].includes(state.me.role)) {
    return [...(roleMenus[state.me.role] || ["dashboard"])];
  }
  // Role-ийн үндсэн эрхээс эхэлнэ — custom permissions нь зөвхөн нэмэлт эрх өгнө, хасахгүй
  const allowed = new Set(roleMenus[state.me.role] || ["dashboard"]);
  let p = {};
  try { if (state.me.permissions) p = JSON.parse(state.me.permissions); } catch(e) {}
  Object.entries(p).forEach(([key, v]) => {
    if (v?.view && PERM_TO_MENUS[key]) PERM_TO_MENUS[key].forEach(m => allowed.add(m));
  });
  return [...allowed];
}

function topAvatarHtml() {
  if (state.me?.avatar_url) {
    return `<img src="${state.me.avatar_url}" alt="Avatar" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
      <span style="display:none">${(state.me.full_name || "U")[0].toUpperCase()}</span>`;
  }
  return `<span>${(state.me?.full_name || "U")[0].toUpperCase()}</span>`;
}

function chooseMyAvatar() {
  document.getElementById("myAvatarInput")?.click();
}

async function uploadMyAvatar(input) {
  const file = input?.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    toast("Зөвхөн зураг файл сонгоно уу");
    input.value = "";
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    toast("Зургийн хэмжээ 10MB-аас бага байна");
    input.value = "";
    return;
  }

  const form = new FormData();
  form.append("avatar", file);
  try {
    const res = await fetch("/api/me/avatar", {
      method: "POST",
      headers: { Authorization: "Bearer " + state.token },
      body: form
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Avatar хадгалахад алдаа гарлаа");
    state.me.avatar_url = data.avatar_url;
    localStorage.setItem("me", JSON.stringify(state.me));
    const meInUsers = state.users.find(u => Number(u.id) === Number(state.me.id));
    if (meInUsers) meInUsers.avatar_url = data.avatar_url;
    const avatar = document.getElementById("topAvatarBtn");
    if (avatar) avatar.innerHTML = topAvatarHtml();
    toast("Avatar зураг шинэчлэгдлээ");
  } catch (e) {
    toast(e.message || "Avatar хадгалахад алдаа гарлаа");
  } finally {
    input.value = "";
  }
}

function renderShell() {
  const allowed = getAllowedMenus();
  document.getElementById("app").innerHTML = `
  <div class="top">
    <div class="top-brand">
      <img src="/logo.jpg" onerror="this.style.display='none'" alt=""
           style="width:36px;height:36px;border-radius:8px;object-fit:contain">
      <div>
        <div class="brand-name">ЧОЙБАЛСАН ХӨГЖИЛ</div>
        <div class="brand-sub">ОНӨҮГ · SMART CITY ERP</div>
      </div>
    </div>
    <div class="top-center">
      <div class="top-search">🔍 Хайх...</div>
    </div>
    <div class="top-right" style="gap:14px;padding-right:4px">
      <div class="top-badge">ОНЛАЙН</div>
      <div id="topClock"></div>
      <button class="mobile-job-btn" onclick="show('my_job_description')" title="Ажлын байрны тодорхойлолт">АБТ</button>
      <div class="top-user">
        <b>${state.me.full_name}</b>
        <span>${state.me.role}</span>
      </div>
      <div style="position:relative">
        <button id="notifBell" onclick="toggleNotifPanel()"
          style="background:transparent;border:none;cursor:pointer;font-size:20px;padding:4px;position:relative;line-height:1">
          🔔
          <span id="notifBadge" style="display:none;position:absolute;top:0;right:0;background:#dc2626;color:#fff;font-size:9px;font-weight:800;border-radius:10px;padding:1px 4px;min-width:14px;text-align:center;line-height:14px"></span>
        </button>
        <div id="notifPanel" style="display:none;position:absolute;top:38px;right:0;width:320px;background:#fff;border:1px solid #e2e6ed;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.15);z-index:9999;overflow:hidden">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #f1f5f9">
            <span style="font-weight:800;font-size:13px">Мэдэгдэл</span>
            <button onclick="notifReadAll()" style="font-size:11px;color:#2563eb;background:none;border:none;cursor:pointer;font-weight:600">Бүгдийг уншсан</button>
          </div>
          <div id="notifList" style="max-height:340px;overflow-y:auto"></div>
        </div>
      </div>
      <button id="topAvatarBtn" class="top-avatar" type="button" onclick="chooseMyAvatar()" title="Avatar зураг солих">
        ${topAvatarHtml()}
      </button>
      <input id="myAvatarInput" type="file" accept="image/jpeg,image/png,image/webp,image/gif"
             onchange="uploadMyAvatar(this)" style="display:none">
      <button class="btn secondary sm" onclick="logout()">Гарах</button>
    </div>
  </div>
  <div class="layout">
    <aside class="side">${renderSidebar(allowed)}</aside>
    <main class="main" id="main"></main>
  </div>`;

  const clockEl = document.getElementById("topClock");
  if (clockEl) {
    const tick = () => {
      clockEl.textContent = new Date().toLocaleTimeString("mn-MN", { hour:"2-digit", minute:"2-digit", second:"2-digit" });
    };
    tick();
    if (_shellTimers.clock) clearInterval(_shellTimers.clock);
    _shellTimers.clock = setInterval(tick, 1000);
  }

  // Notification poll every 5 minutes
  loadNotifications();
  if (_shellTimers.notif) clearInterval(_shellTimers.notif);
  _shellTimers.notif = setInterval(loadNotifications, 5 * 60 * 1000);

  // Close panel on outside click — remove previous listener before adding
  if (_shellTimers.clickHandler) document.removeEventListener("click", _shellTimers.clickHandler, true);
  _shellTimers.clickHandler = e => {
    const panel = document.getElementById("notifPanel");
    const bell  = document.getElementById("notifBell");
    if (panel && bell && !panel.contains(e.target) && !bell.contains(e.target)) {
      panel.style.display = "none";
    }
  };
  document.addEventListener("click", _shellTimers.clickHandler, true);
}

let _notifData = [];

async function loadNotifications() {
  try {
    _notifData = await api("/api/notifications");
    const badge = document.getElementById("notifBadge");
    if (badge) {
      if (_notifData.length) {
        badge.textContent = _notifData.length > 99 ? "99+" : String(_notifData.length);
        badge.style.display = "block";
      } else {
        badge.style.display = "none";
      }
    }
  } catch(e) {}
}

function toggleNotifPanel() {
  const panel = document.getElementById("notifPanel");
  if (!panel) return;
  const open = panel.style.display !== "none";
  panel.style.display = open ? "none" : "block";
  if (!open) renderNotifList();
}

function renderNotifList() {
  const list = document.getElementById("notifList");
  if (!list) return;
  const TYPE_ICON = { overdue_work:"⏰", high_risk_hse:"🔴", hse_waiting:"🦺", pending_final:"✅" };
  if (!_notifData.length) {
    list.innerHTML = `<div style="padding:24px;text-align:center;color:#94a3b8;font-size:12px">Шинэ мэдэгдэл байхгүй</div>`;
    return;
  }
  list.innerHTML = _notifData.map(n => `
    <div style="padding:12px 14px;border-bottom:1px solid #f1f5f9;cursor:pointer;transition:background .15s"
      onmouseenter="this.style.background='#f8fafc'" onmouseleave="this.style.background=''"
      onclick="notifRead(${n.id})">
      <div style="display:flex;gap:8px;align-items:flex-start">
        <span style="font-size:16px;flex-shrink:0">${TYPE_ICON[n.type]||'🔔'}</span>
        <div>
          <div style="font-size:12px;font-weight:700;color:#111827;margin-bottom:2px">${n.title}</div>
          ${n.body ? `<div style="font-size:11px;color:#667085;line-height:1.4">${n.body}</div>` : ''}
          <div style="font-size:10px;color:#94a3b8;margin-top:4px">${(n.created_at||'').slice(0,16)}</div>
        </div>
      </div>
    </div>`).join('');
}

async function notifRead(id) {
  try {
    await api(`/api/notifications/${id}/read`, { method: "PATCH" });
    _notifData = _notifData.filter(n => n.id !== id);
    loadNotifications();
    renderNotifList();
  } catch(e) {}
}

async function notifReadAll() {
  try {
    await api("/api/notifications/read-all", { method: "POST" });
    _notifData = [];
    loadNotifications();
    renderNotifList();
  } catch(e) {}
}

// ── Ctrl + RightClick Drag Zoom ───────────────────────────────
function closePresZoom() {
  document.getElementById('pres-zoom-overlay')?.remove();
  document.getElementById('pres-sel-box')?.remove();
}

function openPresZoomRect(selRect) {
  const main = document.getElementById('main');
  if (!main) return;
  const vpW = window.innerWidth, vpH = window.innerHeight;
  const mr  = main.getBoundingClientRect();
  const selCX = selRect.left + selRect.width  / 2;
  const selCY = selRect.top  + selRect.height / 2;
  const scale = Math.min(vpW / selRect.width, vpH / selRect.height, 4.0) * 0.88;
  const Tx = vpW/2 - mr.left - scale * (main.scrollLeft + selCX - mr.left);
  const Ty = vpH/2 - mr.top  - scale * (main.scrollTop  + selCY - mr.top);

  const clone = main.cloneNode(true);
  clone.style.cssText = `position:absolute;top:${mr.top}px;left:${mr.left}px;width:${mr.width}px;transform-origin:0 0;transform:translate(${Tx}px,${Ty}px) scale(${scale});pointer-events:none;overflow:visible;`;

  closePresZoom();
  const overlay = document.createElement('div');
  overlay.id = 'pres-zoom-overlay';
  overlay.appendChild(clone);
  const badge = document.createElement('div');
  badge.className = 'pres-esc-badge';
  badge.textContent = 'ESC — буцах';
  overlay.appendChild(badge);
  document.body.appendChild(overlay);
}

function initCtrlRightDragZoom() {
  let origin = null;

  document.addEventListener('mousedown', e => {
    if (e.button !== 0 || !e.ctrlKey) return;
    e.preventDefault();
    closePresZoom();
    origin = { x: e.clientX, y: e.clientY };
  });

  document.addEventListener('mousemove', e => {
    if (!origin) return;
    const dx = e.clientX - origin.x, dy = e.clientY - origin.y;
    let sel = document.getElementById('pres-sel-box');
    if (!sel) { sel = document.createElement('div'); sel.id = 'pres-sel-box'; document.body.appendChild(sel); }
    sel.style.left   = Math.min(e.clientX, origin.x) + 'px';
    sel.style.top    = Math.min(e.clientY, origin.y) + 'px';
    sel.style.width  = Math.abs(dx) + 'px';
    sel.style.height = Math.abs(dy) + 'px';
  });

  document.addEventListener('mouseup', e => {
    if (e.button !== 0 || !origin) return;
    origin = null;
    const sel = document.getElementById('pres-sel-box');
    if (!sel) return;
    const r = sel.getBoundingClientRect();
    sel.remove();
    if (r.width > 20 && r.height > 20) openPresZoomRect(r);
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closePresZoom();
  });
}

function updateActiveMenu(m) {
  document.querySelectorAll(".menu button").forEach(btn => {
    btn.classList.toggle("active", btn.id === `menu_${m}`);
  });
}

async function show(m) {
  state.current = m;
  updateActiveMenu(m);
  if (state.clockTimer) { clearInterval(state.clockTimer); state.clockTimer = null; }
  const fn = window[m];
  if (typeof fn === "function") return fn();
}

Object.assign(window, {
  login, logout, renderLogin, show, toggleSideGroup,
  chooseMyAvatar, uploadMyAvatar,
  showForgotPassword, showLoginView, forgotPassword, resetPassword,
  loadNotifications, toggleNotifPanel, notifRead, notifReadAll,
  closePresZoom,
});

init();
