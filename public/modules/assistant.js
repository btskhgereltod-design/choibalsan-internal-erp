import { state, api, escapeHtml } from "./common.js";

// ══ AI assistant state ════════════════════════════════════════
let assistantBusy = false;
let assistantOpen = false;
const history = [];
const quickPrompts = [
  "Өнөөдрийн тойм",
  "Нээлттэй гэмтэл хэдэн байна?",
  "Гэрлэн дохионы статус ямар байна?",
  "Агуулахын нөөцийн анхааруулга байна уу?",
];
const CHAT_REACTIONS = ["👍", "❤️", "😂", "😮", "😢"];

// ══ Chat / Messenger state ════════════════════════════════════
let _view      = "group";  // "group" | "dm" | "ai"
let _recip     = null;     // { id, full_name, ... }
let _msgs      = [];
let _users     = [];
let _poll      = null;
let _wlogs     = [];
let _tagId     = null;
let _pendingImgs = [];
let _shellReady = false;
let _soundReady = false;
let _lastMsgMaxId = 0;
let _unreadCount = 0;
let _bgPoll = null;
let _tagData = null;
let _panelMax = true;

// ══ Utilities ═════════════════════════════════════════════════
function currentModuleName() {
  const m = state.current || "";
  return document.querySelector(`#menu_${m}`)?.textContent?.trim() || m || "dashboard";
}

function renderMarkdown(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code style='background:#f1f5f9;padding:1px 4px;border-radius:3px;font-size:0.92em'>$1</code>")
    .replace(/\_\((.+?)\)\_/g, "<em style='color:#94a3b8;font-size:0.9em'>($1)</em>");
}

function fmtTime(dt) {
  if (!dt) return "";
  const d = new Date(dt.includes("T") ? dt : dt.replace(" ","T"));
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60)    return "одоо";
  if (diff < 3600)  return Math.floor(diff / 60) + "м өмнө";
  if (diff < 86400) return d.getHours().toString().padStart(2,"0") + ":" + d.getMinutes().toString().padStart(2,"0");
  return `${d.getMonth()+1}/${d.getDate()} ${d.getHours().toString().padStart(2,"0")}:${d.getMinutes().toString().padStart(2,"0")}`;
}

function chatAvatar(url, name, cls = "") {
  const initial = escapeHtml((name || "U").trim().charAt(0).toUpperCase());
  if (url) {
    return `<span class="erp-avatar ${cls}">
      <img src="${escapeHtml(url)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
      <span style="display:none">${initial}</span>
    </span>`;
  }
  return `<span class="erp-avatar ${cls}"><span>${initial}</span></span>`;
}

// ══ Styles ════════════════════════════════════════════════════
function insertStyles() {
  if (document.getElementById("erpChatStyles")) return;
  const s = document.createElement("style");
  s.id = "erpChatStyles";
  s.textContent = `
    .erp-fab{position:fixed;right:22px;bottom:22px;z-index:2200;border:0;border-radius:999px;background:#2563eb;color:#fff;box-shadow:0 14px 32px rgba(37,99,235,.32);height:48px;padding:0 18px;font-weight:800;cursor:pointer;display:flex;align-items:center;gap:8px;transition:transform .15s}
    .erp-fab:hover{transform:scale(1.05)}
    .erp-panel{position:fixed;right:22px;bottom:82px;width:min(560px,calc(100vw - 28px));height:min(640px,calc(100vh - 120px));z-index:2500;background:#fff;border:1px solid #dbe3ef;border-radius:16px;box-shadow:0 24px 70px rgba(15,23,42,.22);display:none;flex-direction:column;overflow:hidden}
    .erp-panel.open{display:flex}
    .erp-head{padding:12px 16px;background:#0f172a;color:#fff;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-shrink:0;border-radius:16px 16px 0 0}
    .erp-body{display:flex;flex:1;overflow:hidden;min-height:0}
    .erp-sidebar{width:130px;background:#f8fafc;border-right:1px solid #e2e6ed;display:flex;flex-direction:column;overflow-y:auto;flex-shrink:0}
    .erp-s-item{padding:9px 10px;cursor:pointer;display:flex;align-items:center;gap:7px;border-left:3px solid transparent;transition:background .12s;font-size:12px;color:#334155;user-select:none;word-break:break-word}
    .erp-s-item:hover{background:#eff6ff}
    .erp-s-item.active{background:#eff6ff;border-left-color:#2563eb;font-weight:700;color:#1d4ed8}
    .erp-s-sep{height:1px;background:#e2e6ed;margin:4px 8px}
    .erp-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
    .erp-dot.on{background:#22c55e;box-shadow:0 0 0 2px #bbf7d0}
    .erp-dot.off{background:#cbd5e1}
    .erp-avatar{width:26px;height:26px;border-radius:50%;overflow:hidden;flex-shrink:0;background:linear-gradient(135deg,#2563eb,#7c3aed);color:#fff;font-size:10px;font-weight:800;display:inline-flex;align-items:center;justify-content:center;position:relative}
    .erp-avatar img,.erp-avatar>span{width:100%;height:100%;object-fit:cover}
    .erp-avatar>span{display:flex;align-items:center;justify-content:center}
    .erp-avatar.sm{width:22px;height:22px;font-size:9px}
    .erp-avatar.msg{width:28px;height:28px;margin-top:15px}
    .erp-avatar-status{position:relative;display:inline-flex;flex-shrink:0}
    .erp-avatar-status .erp-dot{position:absolute;right:-1px;bottom:-1px;border:2px solid #fff;width:8px;height:8px}
    .erp-main{display:flex;flex-direction:column;flex:1;overflow:hidden;min-width:0}
    .erp-chat-head{padding:10px 14px;border-bottom:1px solid #e2e6ed;font-weight:700;font-size:13px;color:#1e293b;display:flex;align-items:center;gap:8px;flex-shrink:0;background:#fff;min-height:42px}
    .erp-chat-body{flex:1;overflow-y:auto;padding:12px 14px;background:#f8fafc;display:flex;flex-direction:column;gap:8px}
    .erp-msg{display:flex;flex-direction:column;max-width:82%}
    .erp-msg.me{align-self:flex-end;align-items:flex-end}
    .erp-msg.other{align-self:flex-start;align-items:flex-start;max-width:88%}
    .erp-msg-other-row{display:flex;align-items:flex-start;gap:7px}
    .erp-msg-other-content{display:flex;flex-direction:column;align-items:flex-start;min-width:0}
    .erp-msg-name{font-size:10px;color:#667085;margin-bottom:2px;font-weight:600}
    .erp-msg-bubble{padding:8px 12px;border-radius:14px;font-size:13px;line-height:1.45;word-break:break-word}
    .erp-msg.me .erp-msg-bubble{background:#2563eb;color:#fff;border-bottom-right-radius:3px}
    .erp-msg.other .erp-msg-bubble{background:#fff;color:#1e293b;border:1px solid #e2e6ed;border-bottom-left-radius:3px}
    .erp-msg-time{font-size:10px;color:#94a3b8;margin-top:2px}
    .erp-msg-img{max-width:200px;max-height:200px;border-radius:10px;object-fit:cover;cursor:pointer;display:block;margin-top:4px;border:1px solid rgba(0,0,0,.08)}
    .erp-tag-btn{font-size:10px;padding:3px 10px;border:1px solid #bfdbfe;background:#eff6ff;color:#1d4ed8;border-radius:20px;cursor:pointer;margin-top:4px;display:inline-block;font-weight:600}
    .erp-tag-btn:hover{background:#dbeafe}
    .erp-tagged{font-size:10px;color:#16a34a;background:#dcfce7;padding:2px 8px;border-radius:20px;margin-top:4px;display:inline-block;font-weight:600}
    .erp-del-btn{font-size:10px;border:0;background:transparent;color:#94a3b8;cursor:pointer;margin-top:3px;padding:2px 4px}
    .erp-del-btn:hover{color:#dc2626;text-decoration:underline}
    .erp-react-wrap{display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-top:4px}
    .erp-react-count,.erp-react-add{border:1px solid #dbe3ef;background:#fff;border-radius:999px;padding:2px 7px;font-size:11px;line-height:18px;cursor:pointer;color:#475569}
    .erp-react-count.mine{background:#eff6ff;border-color:#93c5fd;color:#1d4ed8;font-weight:800}
    .erp-react-add:hover,.erp-react-count:hover{background:#f1f5f9}
    .erp-react-picker{display:none;gap:3px;padding:4px;background:#fff;border:1px solid #dbe3ef;border-radius:999px;box-shadow:0 6px 18px rgba(15,23,42,.14)}
    .erp-react-picker.open{display:inline-flex}
    .erp-react-picker button{border:0;background:transparent;border-radius:50%;width:28px;height:28px;font-size:17px;cursor:pointer;padding:0}
    .erp-react-picker button:hover{background:#f1f5f9;transform:scale(1.12)}
    .erp-chat-foot{padding:8px 10px;border-top:1px solid #e2e6ed;background:#fff;flex-shrink:0}
    .erp-chat-row{display:flex;gap:6px;align-items:flex-end}
    .erp-chat-textarea{flex:1;resize:none;min-height:38px;max-height:90px;border:1px solid #cbd5e1;border-radius:10px;padding:8px 10px;font:inherit;font-size:13px;outline:none;transition:border-color .15s}
    .erp-chat-textarea:focus{border-color:#2563eb}
    .erp-send-btn{border:0;border-radius:10px;background:#2563eb;color:#fff;font-weight:800;padding:0 14px;cursor:pointer;height:38px;transition:background .15s;white-space:nowrap;flex-shrink:0}
    .erp-send-btn:hover{background:#1d4ed8}
    .erp-img-btn{border:1px solid #cbd5e1;background:#f8fafc;border-radius:8px;padding:0 10px;height:38px;cursor:pointer;font-size:16px;transition:background .12s;flex-shrink:0}
    .erp-img-btn:hover{background:#eff6ff;border-color:#bfdbfe}
    .erp-img-prev{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px}
    .erp-img-prev img{height:52px;width:60px;object-fit:cover;border-radius:6px;border:1px solid #e2e6ed}
    .erp-tag-panel{padding:8px 12px;background:#fffbeb;border-top:1px solid #fde68a;font-size:12px;flex-shrink:0}
    .erp-tag-sel{width:100%;border:1px solid #e2e6ed;border-radius:6px;padding:5px 8px;font-size:12px;margin-top:5px;outline:none}
    /* AI panel styles */
    .erp-ai-body{padding:14px;overflow-y:auto;flex:1;background:#f8fafc;scroll-behavior:smooth;display:flex;flex-direction:column;gap:0}
    .erp-ai-msg{max-width:94%;margin:0 0 10px;padding:10px 12px;border-radius:12px;font-size:13px;line-height:1.55;white-space:pre-wrap}
    .erp-ai-user{margin-left:auto;background:#2563eb;color:#fff;border-bottom-right-radius:4px;white-space:normal}
    .erp-ai-bot{background:#fff;color:#172033;border:1px solid #e2e8f0;border-bottom-left-radius:4px;white-space:normal}
    .erp-ai-meta{font-size:10px;color:#94a3b8;margin-top:5px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    .erp-ai-fb{display:inline-flex;gap:4px;margin-top:2px}
    .erp-ai-fb button{border:1px solid #e2e8f0;background:#f8fafc;border-radius:6px;padding:2px 7px;font-size:12px;cursor:pointer;line-height:1.4}
    .erp-ai-fb button:hover{background:#f1f5f9;border-color:#cbd5e1}
    .erp-ai-fb button.active-up{background:#dcfce7;border-color:#86efac;color:#166534}
    .erp-ai-fb button.active-dn{background:#fee2e2;border-color:#fca5a5;color:#991b1b}
    .erp-ai-chip{border:1px solid #dbe3ef;background:#fff;border-radius:999px;padding:5px 9px;font-size:11px;color:#475569;cursor:pointer;margin:0 5px 5px 0;transition:background .12s}
    .erp-ai-chip:hover{background:#f1f5f9}
    .erp-ai-devbtn{border:1px solid #bfdbfe;background:#eff6ff;color:#1d4ed8;border-radius:999px;padding:5px 10px;font-size:11px;font-weight:800;cursor:pointer;margin:0 5px 5px 0}
    .erp-ai-thinking{display:flex;gap:4px;padding:12px;align-items:center}
    .erp-ai-dot{width:6px;height:6px;border-radius:50%;background:#94a3b8;animation:erpDot 1.2s infinite both}
    .erp-ai-dot:nth-child(2){animation-delay:.2s}
    .erp-ai-dot:nth-child(3){animation-delay:.4s}
    @keyframes erpDot{0%,80%,100%{transform:scale(0.6);opacity:.4}40%{transform:scale(1);opacity:1}}
    .erp-ai-modal-overlay{position:fixed;inset:0;z-index:3000;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:16px}
    .erp-ai-modal{background:#fff;border-radius:16px;box-shadow:0 24px 70px rgba(15,23,42,.28);width:min(600px,100%);max-height:80vh;display:flex;flex-direction:column;overflow:hidden}
    .erp-ai-modal-head{padding:14px 18px;background:#0f172a;color:#fff;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
    .erp-ai-modal-body{padding:18px;overflow-y:auto;font-size:13px;line-height:1.65;color:#172033;white-space:pre-wrap}
    .erp-ai-modal-footer{padding:12px 18px;border-top:1px solid #e2e8f0;background:#f8fafc;font-size:11px;color:#64748b;display:flex;flex-wrap:wrap;gap:8px;align-items:center;flex-shrink:0}
    .erp-ai-source-tag{background:#eff6ff;border:1px solid #bfdbfe;border-radius:999px;padding:2px 8px;font-size:10px;color:#1d4ed8}
    .erp-ai-conf{font-size:10px;color:#64748b}
    .erp-max-btn{display:none}
    .erp-back-btn{display:none;align-items:center;gap:5px;border:0;background:transparent;color:#fff;cursor:pointer;font-size:14px;font-weight:700;padding:4px 6px;border-radius:6px;opacity:.85}
    .erp-back-btn:active{opacity:1;background:rgba(255,255,255,.15)}
    @media (max-width:640px){
      /* Panel sizing */
      .erp-panel{right:0!important;bottom:0!important;left:0!important;width:100vw!important;height:100svh!important;height:100vh!important;border-radius:0!important;border:none!important;transition:height .22s cubic-bezier(.4,0,.2,1)}
      .erp-panel.minimized{height:52vh!important;border-radius:18px 18px 0 0!important;border:1px solid #dbe3ef!important}
      .erp-panel.minimized .erp-head{border-radius:18px 18px 0 0!important}
      .erp-fab{right:12px!important;bottom:12px!important}
      .erp-head{border-radius:0!important}
      .erp-max-btn{display:flex!important;align-items:center;justify-content:center;border:0;background:rgba(255,255,255,.15);color:#fff;border-radius:8px;padding:5px 10px;cursor:pointer;font-size:18px;line-height:1;min-width:36px}
      /* Two-panel mobile nav: sidebar first, chat second */
      .erp-sidebar{width:100%!important;border-right:none!important}
      .erp-main{display:none!important}
      .erp-panel.chat-active .erp-sidebar{display:none!important}
      .erp-panel.chat-active .erp-main{display:flex!important;width:100%!important}
      /* Bigger tap targets in sidebar */
      .erp-s-item{padding:14px 18px!important;font-size:15px!important}
      .erp-dot{width:11px!important;height:11px!important}
      .erp-s-sep{margin:6px 12px!important}
      /* Back button: зөвхөн chat-active үед харагдана */
      .erp-panel.chat-active .erp-back-btn{display:inline-flex!important;min-width:44px;min-height:44px;align-items:center;justify-content:center;font-size:22px;padding:0 8px}
    }
  `;
  document.head.appendChild(s);
}

// ══ Shell ════════════════════════════════════════════════════
function renderShell() {
  if (document.getElementById("erpFab")) return;
  insertStyles();
  document.body.insertAdjacentHTML("beforeend", `
    <button id="erpFab" class="erp-fab" onclick="toggleErpAssistant()">💬 Дотоод чат</button>
    <section id="erpPanel" class="erp-panel" aria-label="Дотоод чат">
      <div class="erp-head">
        <div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1">
          <button class="erp-back-btn" id="erpBackBtn" onclick="mobileBackToList()" title="Буцах">← </button>
          <div style="min-width:0">
            <div style="font-weight:900;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" id="erpHeadTitle">💬 Дотоод чат</div>
            <div style="font-size:11px;color:#94a3b8" id="erpStatus">Ачааллаж байна...</div>
          </div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-shrink:0">
          <button id="erpMaxBtn" class="erp-max-btn" onclick="togglePanelMax()" title="Томсгох / жижгэлэх">▾</button>
          <button onclick="toggleErpAssistant(false)" style="border:0;background:rgba(255,255,255,.12);color:#fff;border-radius:8px;padding:5px 10px;cursor:pointer;font-size:16px">✕</button>
        </div>
      </div>
      <div class="erp-body">
        <div id="erpSidebar" class="erp-sidebar"></div>
        <div id="erpMain" class="erp-main">
          <div id="erpChatHead" class="erp-chat-head"></div>
          <div id="erpChatBody" class="erp-chat-body"></div>
          <div id="erpChatFoot" class="erp-chat-foot"></div>
        </div>
      </div>
    </section>`);
  _shellReady = true;
}

// ══ Sidebar ══════════════════════════════════════════════════
function renderSidebar() {
  const el = document.getElementById("erpSidebar");
  if (!el) return;
  const myId = state.me?.id;
  el.innerHTML = `
    <div style="padding:8px 10px 4px;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px">Чат</div>
    <div class="erp-s-item ${_view==="group"?"active":""}" onclick="switchView('group')">
      <span style="font-size:15px">👥</span>
      <span>Бүгд</span>
    </div>
    <div class="erp-s-item ${_view==="ai"?"active":""}" onclick="switchView('ai')">
      <span style="font-size:15px">🤖</span>
      <span>Чойбалсан ERP зөвлөх</span>
    </div>
    <div class="erp-s-sep"></div>
    <div style="padding:6px 10px 2px;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px">Ажилтнууд</div>
    ${_users.map(u => {
      const lastName = u.full_name.split(" ").slice(-1)[0];
      const isActive = _view==="dm" && _recip?.id===u.id;
      return `<div class="erp-s-item ${isActive?"active":""}" onclick="switchView('dm',${u.id})" title="${escapeHtml(u.full_name)} · ${escapeHtml(u.position||u.department||"")}">
        <span class="erp-avatar-status">
          ${chatAvatar(u.avatar_url, u.full_name, "sm")}
          <span class="erp-dot ${u.is_online?"on":"off"}"></span>
        </span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(lastName)}</span>
      </div>`;
    }).join("")}`;
}

// ══ Chat head ════════════════════════════════════════════════
function renderChatHead() {
  const el = document.getElementById("erpChatHead");
  if (!el) return;
  if (_view === "group") {
    el.innerHTML = `<span style="font-size:16px">👥</span> <b>Бүлгийн чат</b> <span style="font-size:11px;color:#94a3b8;margin-left:4px">${_users.length + 1} гишүүн</span>`;
  } else if (_view === "dm" && _recip) {
    const u = _users.find(u => u.id === _recip.id);
    const online = u?.is_online;
    el.innerHTML = `<span class="erp-avatar-status">${chatAvatar(u?.avatar_url, _recip.full_name)}
      <span class="erp-dot ${online?"on":"off"}"></span></span>
      <b>${escapeHtml(_recip.full_name)}</b>
      <span style="font-size:11px;color:${online?"#22c55e":"#94a3b8"};margin-left:4px">${online?"● Онлайн":"○ Оффлайн"}</span>`;
  } else if (_view === "ai") {
    el.innerHTML = `<span>🤖</span> <b>Чойбалсан ERP зөвлөх</b> <span style="font-size:11px;color:#94a3b8;margin-left:4px">ERP дата · Зөвлөгөө · Заавар</span>`;
  }
}

// ══ Chat body ════════════════════════════════════════════════
function renderChatBody() {
  const el = document.getElementById("erpChatBody");
  if (!el) return;

  if (_view === "ai") {
    el.className = "erp-ai-body";
    if (!history.length) {
      history.push({ role: "bot", text: "Сайн байна уу. Би **Чойбалсан ERP зөвлөх** — ERP системийн бодит датаас уншиж хариулах, зөвлөгөө өгөх AI туслах.\n\n**Юу асуух вэ?**\n• Ажилтан, ирц, ажлын явц → бодит ERP датаас\n• Тайлан, ХАБЭА, гэрэлтүүлэг, IoT зөвлөгөө → AI туслах\n• ERP ашиглах заавар, алхам алхмаар\n\nМэдээлэл олдохгүй бол зохиохгүй, шууд хэлнэ." });
    }
    el.innerHTML = history.map((m, i) => {
      if (m.thinking) return `<div class="erp-ai-msg erp-ai-bot"><div class="erp-ai-thinking"><div class="erp-ai-dot"></div><div class="erp-ai-dot"></div><div class="erp-ai-dot"></div></div></div>`;
      if (m.role === "user") return `<div class="erp-ai-msg erp-ai-user">${escapeHtml(m.text)}</div>`;
      const txt = m.answer || m.text || m.short_answer || "";
      const modeLabel = m.mode==="ai"?"🤖 AI":m.mode==="local"?"📊 ERP дата":"📚 ERP сургалтын сан";
      const fbHtml = m.log_id ? feedbackHtml(i, m.log_id, m.fb) : "";
      return `<div class="erp-ai-msg erp-ai-bot" id="erp-msg-${i}">
        ${renderMarkdown(txt)}
        <div class="erp-ai-meta">${modeLabel}${m.title?" · "+escapeHtml(m.title):""}${fbHtml}</div>
      </div>`;
    }).join("");
    el.scrollTop = el.scrollHeight;
    return;
  }

  // Chat messages
  el.className = "erp-chat-body";
  const myId   = state.me?.id;
  const myRole = state.me?.role;
  const myDept = state.me?.department;

  // ХАБЭА ажилтан: ямар ч зургийг холбох эрхгүй
  const isHabea = myDept === "ХАБЭА" || myRole === "habea";

  // Таг хийх зөвшөөрлийн шалгалт
  function canTag(m) {
    if (isHabea) return false;
    if (Number(m.sender_id) === Number(myId)) return true;              // өөрийн зураг
    if (myRole === "director" || myRole === "chief_engineer") return true; // бүгдийг
    if (myRole === "engineer")
      return ["Гэрэлтүүлэг", "Цахилгаан"].includes(m.sender_dept);    // цахилгааны хэсэг
    if (myRole === "camera_engineer")
      return m.sender_dept === "Камер";                                 // камерын хэсэг
    return false;
  }

  // Remember if user is near the bottom before re-render
  const wasAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;

  if (!_msgs.length) {
    el.innerHTML = `<div style="text-align:center;color:#94a3b8;font-size:13px;padding:40px 20px">
      <div style="font-size:32px;margin-bottom:10px">${_view==="group"?"👥":"💬"}</div>
      ${_view==="group"?"Бүлгийн чатад мессеж байхгүй байна":"Мессеж байхгүй байна. Эхний мессежийг илгээгээрэй!"}</div>`;
    return;
  }

  el.innerHTML = _msgs.map(m => {
    const isMe = Number(m.sender_id) === Number(myId);
    const canDelete = isMe || myRole === "director";
    const cls = isMe ? "me" : "other";
    const imgHtml = m.image_url
      ? `<img src="${escapeHtml(m.image_url)}" class="erp-msg-img" onclick="window.open('${escapeHtml(m.image_url)}','_blank')" alt="зураг">`
      : "";
    const tagHtml = m.tagged_work_log_id
      ? `<span class="erp-tagged">✅ Ажилтай холбогдсон</span>`
      : (m.image_url && canTag(m)
          ? `<span class="erp-tag-btn" onclick="startTagMsg(${m.id})">🏷 Ажилтай холбох</span>`
          : "");
    const deleteHtml = canDelete ? `<button class="erp-del-btn" onclick="deleteChatMsg(${m.id})">Устгах</button>` : "";
    const reactionHtml = `
      <div class="erp-react-wrap">
        ${(m.reactions || []).map(r => `
          <button class="erp-react-count ${m.my_reaction===r.emoji?"mine":""}"
                  onclick="reactChatMsg(${m.id},'${r.emoji}')">${r.emoji} ${r.count}</button>`).join("")}
        <button class="erp-react-add" onclick="toggleReactionPicker(event,${m.id})" title="Reaction өгөх">☺</button>
        <span class="erp-react-picker" id="erpReactPicker_${m.id}">
          ${CHAT_REACTIONS.map(emoji => `<button onclick="reactChatMsg(${m.id},'${emoji}')" title="${emoji}">${emoji}</button>`).join("")}
        </span>
      </div>`;
    const content = `
      ${!isMe ? `<div class="erp-msg-name">${escapeHtml(m.sender_name||"")}</div>` : ""}
      <div class="erp-msg-bubble">
        ${m.message ? escapeHtml(m.message) : ""}
        ${imgHtml}
      </div>
      ${tagHtml}
      ${reactionHtml}
      ${deleteHtml}
      <div class="erp-msg-time">${fmtTime(m.created_at)}</div>`;
    return isMe
      ? `<div class="erp-msg ${cls}">${content}</div>`
      : `<div class="erp-msg ${cls}"><div class="erp-msg-other-row">
          ${chatAvatar(m.sender_avatar_url, m.sender_name, "msg")}
          <div class="erp-msg-other-content">${content}</div>
        </div></div>`;
  }).join("");

  // Only auto-scroll if user was already at the bottom (or initial load)
  if (wasAtBottom) el.scrollTop = el.scrollHeight;
}

function toggleReactionPicker(event, messageId) {
  event?.stopPropagation();
  const target = document.getElementById(`erpReactPicker_${messageId}`);
  document.querySelectorAll(".erp-react-picker.open").forEach(el => {
    if (el !== target) el.classList.remove("open");
  });
  target?.classList.toggle("open");
}

async function reactChatMsg(messageId, emoji) {
  try {
    const updated = await api(`/api/chat/messages/${messageId}/reaction`, {
      method: "POST",
      body: JSON.stringify({ emoji })
    });
    const msg = _msgs.find(m => Number(m.id) === Number(messageId));
    if (msg) {
      msg.reactions = updated.reactions || [];
      msg.my_reaction = updated.my_reaction || null;
    }
    renderChatBody();
  } catch(e) {
    console.warn("[chat reaction]", e.message);
  }
}

// ══ Chat foot ════════════════════════════════════════════════
function renderChatFoot() {
  const el = document.getElementById("erpChatFoot");
  if (!el) return;

  if (_view === "ai") {
    el.innerHTML = `
      <div style="margin-bottom:6px">
        <button class="erp-ai-devbtn" onclick="openErpDevRequest()">Санал/алдаа илгээх</button>
        ${quickPrompts.map(q => `<button class="erp-ai-chip" onclick="askErpAssistant('${escapeHtml(q).replace(/'/g,"\\'")}')">  ${escapeHtml(q)}</button>`).join("")}
      </div>
      <div class="erp-ai-input" style="display:flex;gap:8px">
        <textarea id="erpAssistantInput" style="flex:1;resize:none;min-height:42px;max-height:110px;border:1px solid #cbd5e1;border-radius:10px;padding:9px 10px;font:inherit;font-size:13px;outline:none" placeholder="ERP дээр юу хийхээ асуугаарай..."
          onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendErpAssistant()}"></textarea>
        <button onclick="sendErpAssistant()" id="erpAiSendBtn" style="border:0;border-radius:10px;background:#2563eb;color:#fff;font-weight:800;padding:0 14px;cursor:pointer">Илгээх</button>
      </div>`;
    return;
  }

  el.innerHTML = `
    <div id="erpImgPrev" class="erp-img-prev"></div>
    <div id="erpTagPanel" class="erp-tag-panel" style="display:none">
      <div style="font-weight:700;color:#92400e;margin-bottom:6px">🏷 Ажилтай холбох</div>
      <select class="erp-tag-sel" id="erpTagCat" onchange="filterTagExecs()" style="margin-bottom:4px">
        <option value="">— Салбар сонгох —</option>
      </select>
      <select class="erp-tag-sel" id="erpTagExec">
        <option value="">— Гүйцэтгэл сонгох —</option>
      </select>
      <div style="display:flex;gap:6px;margin-top:6px">
        <button onclick="confirmTagMsg()" style="border:0;background:#2563eb;color:#fff;padding:5px 14px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700">Холбох</button>
        <button onclick="cancelTagMsg()" style="border:1px solid #e2e6ed;background:#f8fafc;padding:5px 14px;border-radius:6px;cursor:pointer;font-size:12px">Болих</button>
      </div>
    </div>
    <div class="erp-chat-row">
      <button class="erp-img-btn" onclick="document.getElementById('erpImgFile').click()" title="Зураг илгээх">📎</button>
      <input type="file" id="erpImgFile" accept="image/*" multiple style="display:none" onchange="handleImgSelect(this)">
      <textarea class="erp-chat-textarea" id="erpChatInput" placeholder="Мессеж бичнэ үү..."
        onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendChatMsg()}"></textarea>
      <button class="erp-send-btn" onclick="sendChatMsg()">Илгээх</button>
    </div>`;
}

function renderAll() {
  renderSidebar();
  renderChatHead();
  renderChatBody();
  renderChatFoot();
}

// alias for backward compat (erpAiFeedback calls this)
function renderAssistantMessages() { renderChatBody(); }

// ══ Mobile two-panel nav ══════════════════════════════════════
function mobileBackToList() {
  const panel = document.getElementById("erpPanel");
  if (panel) panel.classList.remove("chat-active");
  const title = document.getElementById("erpHeadTitle");
  if (title) title.textContent = "💬 Дотоод чат";
}

function mobileGoToChat(label) {
  if (window.innerWidth > 640) return;
  const panel = document.getElementById("erpPanel");
  if (panel) panel.classList.add("chat-active");
  const title = document.getElementById("erpHeadTitle");
  if (title) title.textContent = label || "💬 Чат";
}

// ══ Switch view ══════════════════════════════════════════════
async function switchView(view, userId) {
  _view = view;
  _recip = null;
  if (view === "dm" && userId) {
    _recip = _users.find(u => u.id === Number(userId)) || { id: Number(userId), full_name: "..." };
  }
  // On mobile: activate chat panel, update header title
  if (view === "group")       mobileGoToChat("👥 Бүлгийн чат");
  else if (view === "ai")     mobileGoToChat("🤖 Чойбалсан ERP зөвлөх");
  else if (view === "dm" && _recip) mobileGoToChat(_recip.full_name);
  renderAll();
  if (view !== "ai") {
    await loadMessages();
  } else {
    renderChatBody();
  }
}

// ══ Data loading ═════════════════════════════════════════════
async function loadUsers() {
  try {
    _users = await api("/api/chat/users");
    renderSidebar();
    const statusEl = document.getElementById("erpStatus");
    const online = _users.filter(u => u.is_online).length;
    if (statusEl) statusEl.textContent = `${online} хүн онлайн`;
  } catch(e) { console.warn("[chat] users:", e.message); }
}

async function loadMessages() {
  try {
    let url = "/api/chat/messages";
    if (_view === "dm" && _recip) url += `?recipient_id=${_recip.id}`;
    const rows = await api(url);
    maybePlayIncomingSound(rows);
    _msgs = rows;
    renderChatBody();
  } catch(e) { console.warn("[chat] msgs:", e.message); }
}

function unlockChatSound() {
  _soundReady = true;
}

function playChatSound() {
  if (!_soundReady) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1175, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
    setTimeout(() => ctx.close?.(), 260);
  } catch(_) {}
}

function updateChatBadge(count) {
  _unreadCount = count;
  const fab = document.getElementById("erpFab");
  if (!fab) return;
  let badge = document.getElementById("erpFabBadge");
  if (!badge) {
    badge = document.createElement("span");
    badge.id = "erpFabBadge";
    badge.style.cssText = "position:absolute;top:-6px;right:-6px;background:#ef4444;color:#fff;" +
      "border-radius:50%;font-size:11px;font-weight:900;min-width:18px;height:18px;" +
      "display:flex;align-items:center;justify-content:center;padding:0 3px;pointer-events:none";
    fab.appendChild(badge);
  }
  badge.textContent = count > 99 ? "99+" : count;
  badge.style.display = count > 0 ? "flex" : "none";
}

function showBrowserNotification(senderName, text) {
  if (document.visibilityState === "visible" && assistantOpen) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const body = text ? (text.length > 80 ? text.slice(0, 80) + "…" : text) : "Зураг илгээлээ";
  try {
    const n = new Notification(`💬 ${senderName}`, { body, icon: "/logo.jpg", tag: "erp-chat" });
    n.onclick = () => { window.focus(); toggleErpAssistant(true); n.close(); };
    setTimeout(() => n.close(), 6000);
  } catch(_) {}
}

function requestNotifPermission() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
}

function maybePlayIncomingSound(rows) {
  if (!Array.isArray(rows) || !rows.length) return;
  const maxId = Math.max(...rows.map(m => Number(m.id || 0)));
  const newMsgs = rows.filter(m =>
    Number(m.id || 0) > _lastMsgMaxId &&
    Number(m.sender_id) !== Number(state.me?.id)
  );
  if (_lastMsgMaxId && newMsgs.length) {
    playChatSound();
    const last = newMsgs[newMsgs.length - 1];
    showBrowserNotification(last.sender_name || "Шинэ мессеж", last.message);
  }
  _lastMsgMaxId = Math.max(_lastMsgMaxId, maxId);
}

// Background poll — chat хаалттай үед ч unread тоолно
async function bgCheckUnread() {
  if (assistantOpen) return;
  if (!state.token) return;
  try {
    const r = await api(`/api/chat/unread?since_id=${_lastMsgMaxId}`);
    if (!r || typeof r.count !== "number") return;
    if (r.count > _unreadCount) {
      const added = r.count - _unreadCount;
      if (_lastMsgMaxId > 0) {
        playChatSound();
        if (r.latest) showBrowserNotification(r.latest.sender_name || "Шинэ мессеж", r.latest.message);
      }
      if (r.latest) _lastMsgMaxId = Math.max(_lastMsgMaxId, r.latest.id);
    }
    updateChatBadge(r.count);
  } catch(_) {}
}

async function loadWorkLogs() {
  try { _wlogs = await api("/api/chat/work-logs"); } catch(e) {}
}

// ══ Polling ══════════════════════════════════════════════════
let _pollCount = 0;
function startPolling() {
  if (_poll) return;
  _poll = setInterval(async () => {
    if (!assistantOpen) return;
    _pollCount++;
    if (_view !== "ai") await loadMessages();
    if (_pollCount % 6 === 0) await loadUsers(); // ~30s
  }, 5000);

  // Background poll: unread count even when chat is closed (every 15s)
  if (!_bgPoll) {
    _bgPoll = setInterval(bgCheckUnread, 15000);
  }

  setInterval(async () => {
    if (!state.token) return;
    try { await api("/api/chat/heartbeat", { method: "POST" }); } catch(_) {}
  }, 60000);
}

// ══ Send message ═════════════════════════════════════════════
function handleImgSelect(input) {
  const files = Array.from(input.files || []).slice(0, 12);
  if (!files.length) return;
  _pendingImgs = files;
  const prev = document.getElementById("erpImgPrev");
  if (!prev) return;
  prev.innerHTML = files.map((file, i) => {
    const url = URL.createObjectURL(file);
    return `<div style="position:relative;display:inline-block">
      <img src="${url}" style="height:52px;width:60px;object-fit:cover;border-radius:6px;border:1px solid #e2e6ed">
      <button onclick="removeChatImg(${i})" style="position:absolute;top:-5px;right:-5px;width:17px;height:17px;border-radius:50%;border:0;background:#ef4444;color:#fff;cursor:pointer;font-size:11px;line-height:17px;text-align:center;font-weight:900">×</button>
    </div>`;
  }).join("") + `<span style="font-size:11px;color:#64748b;align-self:center">${files.length} зураг</span>`;
  input.value = "";
}

function clearChatImg() {
  _pendingImgs = [];
  const prev = document.getElementById("erpImgPrev");
  if (prev) prev.innerHTML = "";
}

function removeChatImg(i) {
  _pendingImgs.splice(i, 1);
  const prev = document.getElementById("erpImgPrev");
  if (!prev) return;
  if (!_pendingImgs.length) { prev.innerHTML = ""; return; }
  prev.innerHTML = _pendingImgs.map((file, idx) => {
    const url = URL.createObjectURL(file);
    return `<div style="position:relative;display:inline-block">
      <img src="${url}" style="height:52px;width:60px;object-fit:cover;border-radius:6px;border:1px solid #e2e6ed">
      <button onclick="removeChatImg(${idx})" style="position:absolute;top:-5px;right:-5px;width:17px;height:17px;border-radius:50%;border:0;background:#ef4444;color:#fff;cursor:pointer;font-size:11px;line-height:17px;text-align:center;font-weight:900">×</button>
    </div>`;
  }).join("") + `<span style="font-size:11px;color:#64748b;align-self:center">${_pendingImgs.length} зураг</span>`;
}

async function sendChatMsg() {
  const input = document.getElementById("erpChatInput");
  const text = input?.value.trim() || "";
  if (!text && !_pendingImgs.length) return;

  const fd = new FormData();
  if (text) fd.append("message", text);
  if (_view === "dm" && _recip) fd.append("recipient_id", String(_recip.id));
  _pendingImgs.forEach(file => fd.append("images", file));

  if (input) input.value = "";
  clearChatImg();

  try {
    const r = await fetch(location.origin + "/api/chat/messages", {
      method: "POST",
      headers: { Authorization: "Bearer " + (localStorage.getItem("token") || "") },
      body: fd,
    });
    const ct = r.headers.get("content-type") || "";
    const payload = ct.includes("application/json") ? await r.json() : { error: (await r.text()).slice(0, 160) };
    if (!r.ok || payload.error) {
      alert("Алдаа: " + (payload.error || "Зураг upload хийхэд алдаа гарлаа"));
      return;
    }
    const rows = Array.isArray(payload) ? payload : [payload];
    _msgs.push(...rows);
    renderChatBody();
  } catch(e) { alert("Алдаа: " + e.message); }
}

async function deleteChatMsg(id) {
  if (!confirm("Энэ мессежийг устгах уу?")) return;
  try {
    await api(`/api/chat/messages/${id}`, { method: "DELETE" });
    _msgs = _msgs.filter(m => Number(m.id) !== Number(id));
    renderChatBody();
  } catch(e) { alert("Алдаа: " + e.message); }
}

// ══ Image tagging ════════════════════════════════════════════
async function startTagMsg(msgId) {
  _tagId = msgId;
  const panel = document.getElementById("erpTagPanel");
  if (!panel) return;
  panel.style.display = "block";

  // Load tag data if not cached
  if (!_tagData) {
    try {
      _tagData = await api("/api/chat/tag-data");
    } catch(_) { _tagData = { categories: [], execsByCat: {} }; }
  }

  // Populate category dropdown
  const catSel = document.getElementById("erpTagCat");
  if (!catSel) return;
  catSel.innerHTML = `<option value="">— Салбар сонгох —</option>`;
  (_tagData.categories || []).forEach(cat => {
    const opt = document.createElement("option");
    opt.value = cat;
    opt.textContent = cat;
    catSel.appendChild(opt);
  });

  // Reset execution dropdown
  const execSel = document.getElementById("erpTagExec");
  if (execSel) execSel.innerHTML = `<option value="">— Гүйцэтгэл сонгох —</option>`;
}

function cancelTagMsg() {
  _tagId = null;
  const panel = document.getElementById("erpTagPanel");
  if (panel) panel.style.display = "none";
}

function filterTagExecs() {
  const cat = document.getElementById("erpTagCat")?.value || "";
  const execSel = document.getElementById("erpTagExec");
  if (!execSel) return;
  execSel.innerHTML = `<option value="">— Гүйцэтгэл сонгох —</option>`;
  if (!cat || !_tagData) return;
  const execs = _tagData.execsByCat[cat] || [];
  execs.forEach(e => {
    const opt = document.createElement("option");
    opt.value = e.id;
    opt.dataset.wlog = e.work_log_id;
    opt.textContent = `${e.exec_title} · ${e.work_title} (${e.progress || 0}%)`;
    execSel.appendChild(opt);
  });
}

// kept for backward compat — no longer used in UI
function filterTagWlogs() {}
async function loadExecsForTag() {}

async function confirmTagMsg() {
  const execSel = document.getElementById("erpTagExec");
  const execId = execSel?.value;
  const wlogId = execSel?.options[execSel.selectedIndex]?.dataset?.wlog;
  if (!execId || !wlogId) { alert("Гүйцэтгэл сонгоно уу"); return; }
  if (!_tagId) return;
  try {
    await api(`/api/chat/messages/${_tagId}/tag`, {
      method: "POST",
      body: JSON.stringify({ work_log_id: Number(wlogId), execution_id: Number(execId) }),
    });
    const msg = _msgs.find(m => m.id === _tagId);
    if (msg) msg.tagged_work_log_id = Number(wlogId);
    cancelTagMsg();
    renderChatBody();
  } catch(e) { alert("Алдаа: " + e.message); }
}

// ══ Panel maximize / minimize (mobile) ═══════════════════════
function togglePanelMax() {
  _panelMax = !_panelMax;
  const panel = document.getElementById("erpPanel");
  const btn   = document.getElementById("erpMaxBtn");
  if (panel) panel.classList.toggle("minimized", !_panelMax);
  if (btn)   btn.textContent = _panelMax ? "▾" : "▴";
}

// ══ Toggle ═══════════════════════════════════════════════════
function toggleErpAssistant(force) {
  assistantOpen = force === undefined ? !assistantOpen : !!force;
  unlockChatSound();
  renderShell();
  const panel = document.getElementById("erpPanel");
  panel?.classList.toggle("open", assistantOpen);
  if (assistantOpen) {
    // Reset to maximized, back to list on each open
    _panelMax = true;
    panel?.classList.remove("minimized");
    panel?.classList.remove("chat-active");
    const maxBtn = document.getElementById("erpMaxBtn");
    if (maxBtn) maxBtn.textContent = "▾";
    const title = document.getElementById("erpHeadTitle");
    if (title) title.textContent = "💬 Дотоод чат";
    updateChatBadge(0);
    _lastMsgMaxId = 0;
    renderAll();
    loadUsers();
    loadWorkLogs();
    setTimeout(() => {
      document.getElementById("erpChatInput")?.focus();
    }, 80);
  }
}

// ══ AI functions (backward-compat) ══════════════════════════
function feedbackHtml(msgIdx, logId, currentFb) {
  const upClass = currentFb === 1  ? "active-up" : "";
  const dnClass = currentFb === -1 ? "active-dn" : "";
  return ` &nbsp;<span class="erp-ai-fb">
    <button class="${upClass}" onclick="erpAiFeedback(${msgIdx},${logId},1)" title="Сайн хариулт">👍</button>
    <button class="${dnClass}" onclick="erpAiFeedback(${msgIdx},${logId},-1)" title="Муу хариулт">👎</button>
  </span>`;
}

function recentChatTranscript(limit = 6) {
  return history
    .filter(m => !m.thinking && m.role && m.text)
    .slice(-limit)
    .map(m => `${m.role === "user" ? "Хэрэглэгч" : "Чойбалсан ERP зөвлөх"}: ${m.text}`)
    .join("\n\n")
    .slice(0, 1800);
}

function previousUserQuestion(msgIdx) {
  for (let i = msgIdx - 1; i >= 0; i--) {
    if (history[i]?.role === "user" && history[i]?.text) return history[i].text;
  }
  return "";
}

async function erpAiFeedback(msgIdx, logId, rating) {
  const msg = history[msgIdx];
  if (!msg || msg.fb === rating) return;
  let comment = "";
  if (rating === -1) {
    comment = window.prompt(
      "Энэ хариулт юугаараа буруу/дутуу байсан бэ?\nЗөв хариулт ERP-ийн аль хэсэгт байж магадгүй вэ?\n\nХоосон үлдээсэн ч асуулт+хариулт автоматаар хадгалагдана.",
      ""
    ) || "";
  }
  msg.fb = rating;
  renderAssistantMessages();
  try {
    await api("/api/assistant/feedback", {
      method: "POST",
      body: JSON.stringify({ log_id: logId, rating, comment }),
    });
    if (rating === -1) await saveBadAnswerDevRequest(msgIdx, logId, comment);
  } catch(_) {}
}

async function saveBadAnswerDevRequest(msgIdx, logId, comment) {
  const msg = history[msgIdx];
  const question = previousUserQuestion(msgIdx);
  const description = [
    "Чойбалсан ERP зөвлөх буруу/дутуу хариулсан.",
    "",
    `Одоогийн дэлгэц: ${currentModuleName()}`,
    `Log ID: ${logId || "—"}`,
    "",
    "Асуулт:", question || "—",
    "",
    "Хариулт:", msg?.text || "—",
    "",
    comment ? `Ажилтны тайлбар:\n${comment}\n` : "",
    "Сүүлийн чатны context:",
    recentChatTranscript(),
  ].filter(Boolean).join("\n").slice(0, 2000);

  const r = await api("/api/assistant/dev-request", {
    method: "POST",
    body: JSON.stringify({
      description,
      module: currentModuleName(),
      page_url: location.href,
      user_agent: navigator.userAgent,
    }),
  });
  history.push({
    role: "bot",
    text: `Буруу хариултын мэдээллийг хөгжүүлэлтийн backlog-д хадгаллаа. #${r.id || ""}`,
    title: "AI feedback",
    mode: "local",
  });
  renderAssistantMessages();
}

function askErpAssistant(text) {
  if (_view !== "ai") {
    _view = "ai";
    renderAll();
  }
  const input = document.getElementById("erpAssistantInput");
  if (input) { input.value = text; sendErpAssistant(); }
}

async function openErpDevRequest() {
  const input = document.getElementById("erpAssistantInput");
  const seed = input?.value?.trim() || "";
  const description = window.prompt(
    "ERP дээр юуг засах/нэмэх хэрэгтэй байна вэ?\nЖишээ: Тайлан хэвлэхэд багана тасраад байна.",
    seed
  );
  if (!description?.trim()) return;
  try {
    const r = await api("/api/assistant/dev-request", {
      method: "POST",
      body: JSON.stringify({
        description: description.trim(),
        module: currentModuleName(),
        page_url: location.href,
        user_agent: navigator.userAgent,
      }),
    });
    history.push({
      role: "bot",
      text: `Хадгаллаа. Санал/алдаа #${r.id || ""} үүслээ.\nТөрөл: ${r.request_type||"support"} · Эрэмбэ: ${r.severity||"low"}`,
      title: "Хөгжүүлэлтийн backlog",
      mode: "local",
    });
    renderAssistantMessages();
    if (input) input.value = "";
  } catch(e) {
    history.push({ role: "bot", text: "Хадгалахад алдаа: " + (e.message || "дахин оролдоно уу"), mode: "error" });
    renderAssistantMessages();
  }
}

async function sendErpAssistant() {
  if (assistantBusy) return;
  const input = document.getElementById("erpAssistantInput");
  const question = input?.value.trim();
  if (!question) return;
  input.value = "";

  const conv_history = history
    .filter(m => !m.thinking && m.role && m.text)
    .slice(-10)
    .map(m => ({ role: m.role, text: m.text.slice(0, 500) }));

  history.push({ role: "user", text: question });
  history.push({ thinking: true });
  renderAssistantMessages();

  assistantBusy = true;
  const btn = document.getElementById("erpAiSendBtn");
  if (btn) { btn.disabled = true; btn.textContent = "..."; }

  try {
    const r = await api("/api/assistant/ask", {
      method: "POST",
      body: JSON.stringify({ question, current_module: currentModuleName(), conv_history }),
    });
    history.pop();
    history.push({
      role: "bot",
      text: r.answer || r.short_answer || "Хариулт олдсонгүй.",
      short_answer: r.short_answer || null,
      answer: r.answer || r.short_answer || "Хариулт олдсонгүй.",
      title: r.title || "",
      mode: r.mode || "fallback",
      log_id: r.log_id || null,
      sources: r.sources || [],
      confidence: r.confidence ?? null,
      data_found: r.data_found ?? true,
      fb: null,
      question,
    });
    if (Array.isArray(r.suggestions) && r.suggestions.length) {
      quickPrompts.splice(0, quickPrompts.length, ...r.suggestions.slice(0, 4));
    }
  } catch(e) {
    history.pop();
    history.push({ role: "bot", text: "Алдаа гарлаа: " + (e.message || "дахин оролдоно уу"), mode: "error" });
  } finally {
    assistantBusy = false;
    if (btn) { btn.disabled = false; btn.textContent = "Илгээх"; }
    renderAssistantMessages();
  }
}

function showErpDetail(msgIdx) {
  const m = history[msgIdx];
  if (!m) return;
  document.getElementById("erpAiDetailModal")?.remove();
  const overlay = document.createElement("div");
  overlay.id = "erpAiDetailModal";
  overlay.className = "erp-ai-modal-overlay";
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="erp-ai-modal">
      <div class="erp-ai-modal-head">
        <span style="font-weight:800;font-size:14px">${escapeHtml(m.title || "Дэлгэрэнгүй хариулт")}</span>
        <button onclick="document.getElementById('erpAiDetailModal').remove()" style="border:0;background:rgba(255,255,255,.12);color:#fff;border-radius:8px;padding:5px 10px;cursor:pointer;font-size:16px">✕</button>
      </div>
      <div class="erp-ai-modal-body">${renderMarkdown(m.answer || m.text)}</div>
    </div>`;
  document.body.appendChild(overlay);
}

// ══ Init ═════════════════════════════════════════════════════
export function initErpAssistant() {
  if (!state.token) return;
  renderShell();
  startPolling();
  requestNotifPermission();
}

Object.assign(window, {
  toggleErpAssistant,
  togglePanelMax,
  mobileBackToList,
  sendErpAssistant,
  askErpAssistant,
  erpAiFeedback,
  openErpDevRequest,
  showErpDetail,
  sendChatMsg,
  handleImgSelect,
  clearChatImg,
  removeChatImg,
  deleteChatMsg,
  toggleReactionPicker,
  reactChatMsg,
  startTagMsg,
  cancelTagMsg,
  confirmTagMsg,
  filterTagExecs,
  loadExecsForTag,
  filterTagWlogs,
  switchView,
});
