import { state, api, escapeHtml } from "./common.js";

let assistantOpen = false;
let assistantBusy = false;
const history = [];

// Хурдан санал болгох асуулт (backend-с шинэчлэгдэнэ)
const quickPrompts = [
  "Өнөөдрийн тойм",
  "Нээлттэй гэмтэл хэдэн байна?",
  "Гэрлэн дохионы статус ямар байна?",
  "Агуулахын нөөцийн анхааруулга байна уу?"
];

function currentModuleName() {
  const m = state.current || "";
  const label = document.querySelector(`#menu_${m}`)?.textContent?.trim();
  return label || m || "dashboard";
}

// ── Markdown-ийн зарим хэлбэрийг HTML болгоно ──
function renderMarkdown(text) {
  return escapeHtml(text)
    // **bold**
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    // `code`
    .replace(/`([^`]+)`/g, "<code style='background:#f1f5f9;padding:1px 4px;border-radius:3px;font-size:0.92em'>$1</code>")
    // _(italic)_
    .replace(/\_\((.+?)\)\_/g, "<em style='color:#94a3b8;font-size:0.9em'>($1)</em>");
}

function assistantStyles() {
  if (document.getElementById("erpAssistantStyles")) return "";
  return `<style id="erpAssistantStyles">
    .erp-ai-fab{position:fixed;right:22px;bottom:22px;z-index:2200;border:0;border-radius:999px;background:#2563eb;color:#fff;box-shadow:0 14px 32px rgba(37,99,235,.32);height:48px;padding:0 18px;font-weight:800;cursor:pointer;display:flex;align-items:center;gap:8px;transition:transform .15s}
    .erp-ai-fab:hover{transform:scale(1.05)}
    .erp-ai-panel{position:fixed;right:22px;bottom:82px;width:min(440px,calc(100vw - 28px));height:min(640px,calc(100vh - 120px));z-index:2200;background:#fff;border:1px solid #dbe3ef;border-radius:16px;box-shadow:0 24px 70px rgba(15,23,42,.22);display:none;overflow:hidden;flex-direction:column}
    .erp-ai-panel.open{display:flex}
    .erp-ai-head{padding:13px 16px;background:#0f172a;color:#fff;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-shrink:0}
    .erp-ai-body{padding:14px;overflow-y:auto;flex:1;background:#f8fafc;scroll-behavior:smooth}
    .erp-ai-msg{max-width:94%;margin:0 0 10px;padding:10px 12px;border-radius:12px;font-size:13px;line-height:1.55;white-space:pre-wrap}
    .erp-ai-user{margin-left:auto;background:#2563eb;color:#fff;border-bottom-right-radius:4px;white-space:normal}
    .erp-ai-bot{background:#fff;color:#172033;border:1px solid #e2e8f0;border-bottom-left-radius:4px;white-space:normal}
    .erp-ai-foot{padding:10px;border-top:1px solid #e2e8f0;background:#fff;flex-shrink:0}
    .erp-ai-input{display:flex;gap:8px}
    .erp-ai-input textarea{flex:1;resize:none;min-height:42px;max-height:110px;border:1px solid #cbd5e1;border-radius:10px;padding:9px 10px;font:inherit;font-size:13px;outline:none;transition:border-color .15s}
    .erp-ai-input textarea:focus{border-color:#2563eb}
    .erp-ai-input button{border:0;border-radius:10px;background:#2563eb;color:#fff;font-weight:800;padding:0 14px;cursor:pointer;transition:background .15s}
    .erp-ai-input button:hover{background:#1d4ed8}
    .erp-ai-chip{border:1px solid #dbe3ef;background:#fff;border-radius:999px;padding:5px 9px;font-size:11px;color:#475569;cursor:pointer;margin:0 6px 6px 0;transition:background .12s}
    .erp-ai-chip:hover{background:#f1f5f9}
    .erp-ai-devbtn{border:1px solid #bfdbfe;background:#eff6ff;color:#1d4ed8;border-radius:999px;padding:5px 10px;font-size:11px;font-weight:800;cursor:pointer;margin:0 6px 6px 0}
    .erp-ai-devbtn:hover{background:#dbeafe}
    .erp-ai-meta{font-size:10px;color:#94a3b8;margin-top:5px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    .erp-ai-fb{display:inline-flex;gap:4px;margin-top:2px}
    .erp-ai-fb button{border:1px solid #e2e8f0;background:#f8fafc;border-radius:6px;padding:2px 7px;font-size:12px;cursor:pointer;transition:all .12s;line-height:1.4}
    .erp-ai-fb button:hover{background:#f1f5f9;border-color:#cbd5e1}
    .erp-ai-fb button.active-up{background:#dcfce7;border-color:#86efac;color:#166534}
    .erp-ai-fb button.active-dn{background:#fee2e2;border-color:#fca5a5;color:#991b1b}
    .erp-ai-thinking{display:flex;gap:4px;padding:12px;align-items:center}
    .erp-ai-dot{width:6px;height:6px;border-radius:50%;background:#94a3b8;animation:erpDot 1.2s infinite both}
    .erp-ai-dot:nth-child(2){animation-delay:.2s}
    .erp-ai-dot:nth-child(3){animation-delay:.4s}
    @keyframes erpDot{0%,80%,100%{transform:scale(0.6);opacity:.4}40%{transform:scale(1);opacity:1}}
  </style>`;
}

function renderAssistantShell() {
  if (document.getElementById("erpAssistantFab")) return;
  document.body.insertAdjacentHTML("beforeend", assistantStyles() + `
    <button id="erpAssistantFab" class="erp-ai-fab" onclick="toggleErpAssistant()">💬 ERP туслах</button>
    <section id="erpAssistantPanel" class="erp-ai-panel" aria-label="ERP туслах">
      <div class="erp-ai-head">
        <div>
          <div style="font-weight:900;font-size:14px">💬 ERP туслах</div>
          <div style="font-size:11px;color:#94a3b8" id="erpAiStatus">Сургалт · Заавар · Зөвлөгөө</div>
        </div>
        <button onclick="toggleErpAssistant(false)" style="border:0;background:rgba(255,255,255,.12);color:#fff;border-radius:8px;padding:5px 10px;cursor:pointer;font-size:16px">✕</button>
      </div>
      <div id="erpAssistantBody" class="erp-ai-body"></div>
      <div class="erp-ai-foot">
        <div style="margin-bottom:6px">
          <button class="erp-ai-devbtn" onclick="openErpDevRequest()">Санал/алдаа илгээх</button>
          <span id="erpAssistantQuick"></span>
        </div>
        <div class="erp-ai-input">
          <textarea id="erpAssistantInput" placeholder="ERP дээр юу хийхээ асуугаарай..." onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendErpAssistant()}"></textarea>
          <button onclick="sendErpAssistant()" id="erpAiSendBtn">Илгээх</button>
        </div>
      </div>
    </section>`);
  renderAssistantMessages();
}

function renderAssistantMessages() {
  const body  = document.getElementById("erpAssistantBody");
  const quick = document.getElementById("erpAssistantQuick");
  if (!body || !quick) return;

  if (!history.length) {
    history.push({
      role: "bot",
      text: "Сайн байна уу. Би ERP ашиглах богино заавар, бүртгэл хийх дараалал, тайлангийн зөвлөгөө өгнө.\n\nДэлгэрэнгүй хэрэгтэй бол \"алхам алхмаар\" гэж бичээрэй."
    });
  }

  body.innerHTML = history.map((m, i) => {
    if (m.thinking) {
      return `<div class="erp-ai-msg erp-ai-bot">
        <div class="erp-ai-thinking">
          <div class="erp-ai-dot"></div><div class="erp-ai-dot"></div><div class="erp-ai-dot"></div>
        </div>
      </div>`;
    }
    if (m.role === "user") {
      return `<div class="erp-ai-msg erp-ai-user">${escapeHtml(m.text)}</div>`;
    }
    // Bot message
    const modeLabel = m.mode === "ai" ? "🤖 AI" : m.mode === "local" ? "📊 ERP дата" : m.mode === "fallback" ? "📚 Заавар" : "📚 ERP сургалтын сан";
    const fbHtml = m.log_id ? feedbackHtml(i, m.log_id, m.fb) : "";
    return `<div class="erp-ai-msg erp-ai-bot" id="erp-msg-${i}">
      ${renderMarkdown(m.text)}
      ${m.title ? `<div class="erp-ai-meta">${modeLabel} · ${escapeHtml(m.title)}${fbHtml}</div>` : `<div class="erp-ai-meta">${modeLabel}${fbHtml}</div>`}
    </div>`;
  }).join("");

  quick.innerHTML = quickPrompts.map(q =>
    `<button class="erp-ai-chip" onclick="askErpAssistant('${escapeHtml(q).replace(/'/g,"\\'")}')">
      ${escapeHtml(q)}
    </button>`
  ).join("");

  body.scrollTop = body.scrollHeight;
}

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
    .map(m => `${m.role === "user" ? "Хэрэглэгч" : "ERP туслах"}: ${m.text}`)
    .join("\n\n")
    .slice(0, 1800);
}

function previousUserQuestion(msgIdx) {
  for (let i = msgIdx - 1; i >= 0; i--) {
    if (history[i]?.role === "user" && history[i]?.text) return history[i].text;
  }
  return "";
}

// Feedback илгээх
async function erpAiFeedback(msgIdx, logId, rating) {
  const msg = history[msgIdx];
  if (!msg || msg.fb === rating) return;
  let comment = "";
  if (rating === -1) {
    comment = window.prompt(
      "Энэ хариулт юугаараа буруу/дутуу байсан бэ?\nЗөв хариулт ERP-ийн аль хэсэгт байж магадгүй вэ?\nЖишээ: Ажлын явц > Захирлын ажил tab дээр харагдаж байна.\n\nХоосон үлдээсэн ч асуулт+хариулт автоматаар хадгалагдана.",
      ""
    ) || "";
  }
  msg.fb = rating;
  renderAssistantMessages();
  try {
    await api("/api/assistant/feedback", {
      method: "POST",
      body: JSON.stringify({ log_id: logId, rating, comment })
    });
    if (rating === -1) {
      await saveBadAnswerDevRequest(msgIdx, logId, comment);
    }
  } catch (_) {
    // silent fail — UI аль хэдийн шинэчлэгдсэн
  }
}

async function saveBadAnswerDevRequest(msgIdx, logId, comment) {
  const msg = history[msgIdx];
  const question = previousUserQuestion(msgIdx);
  const description = [
    "ERP туслах буруу/дутуу хариулсан.",
    "",
    `Одоогийн дэлгэц: ${currentModuleName()}`,
    `Log ID: ${logId || "—"}`,
    "",
    "Асуулт:",
    question || "—",
    "",
    "Хариулт:",
    msg?.text || "—",
    "",
    comment ? `Ажилтны тайлбар:\n${comment}\n` : "",
    "Сүүлийн чатны context:",
    recentChatTranscript(),
    "",
    "Шийдэхдээ ялгах зүйл:",
    "- Энэ ERP дата/API query дутуу юу?",
    "- Эсвэл chatbot prompt/intent routing засах шаардлагатай юу?",
  ].filter(Boolean).join("\n").slice(0, 2000);
  const r = await api("/api/assistant/dev-request", {
    method: "POST",
    body: JSON.stringify({
      description,
      module: currentModuleName(),
      page_url: location.href,
      user_agent: navigator.userAgent,
    })
  });
  history.push({
    role: "bot",
    text: `Буруу хариултын мэдээллийг хөгжүүлэлтийн backlog-д хадгаллаа. #${r.id || ""}\nАсуулт, хариулт, чатны context хамт хадгалагдсан.`,
    title: "AI feedback",
    mode: "local",
  });
  renderAssistantMessages();
}

function toggleErpAssistant(force) {
  assistantOpen = force === undefined ? !assistantOpen : !!force;
  renderAssistantShell();
  document.getElementById("erpAssistantPanel")?.classList.toggle("open", assistantOpen);
  if (assistantOpen) setTimeout(() => document.getElementById("erpAssistantInput")?.focus(), 80);
}

function askErpAssistant(text) {
  const input = document.getElementById("erpAssistantInput");
  if (input) input.value = text;
  sendErpAssistant();
}

async function openErpDevRequest() {
  const input = document.getElementById("erpAssistantInput");
  const seed = input?.value?.trim() || "";
  const description = window.prompt(
    "ERP дээр юуг засах/нэмэх хэрэгтэй байна вэ?\nЖишээ: Тайлан хэвлэхэд багана тасраад байна, Word upload болохгүй байна.",
    seed
  );
  if (!description || !description.trim()) return;
  try {
    const r = await api("/api/assistant/dev-request", {
      method: "POST",
      body: JSON.stringify({
        description: description.trim(),
        module: currentModuleName(),
        page_url: location.href,
        user_agent: navigator.userAgent,
      })
    });
    history.push({
      role: "bot",
      text: `Хадгаллаа. Хөгжүүлэлтийн санал/алдаа #${r.id || ""} үүслээ.\nТөрөл: ${r.request_type || "support"} · Эрэмбэ: ${r.severity || "low"}`,
      title: "Хөгжүүлэлтийн backlog",
      mode: "local",
    });
    renderAssistantMessages();
    if (input) input.value = "";
  } catch (e) {
    history.push({ role: "bot", text: "Санал/алдаа хадгалахад алдаа гарлаа: " + (e.message || "дахин оролдоно уу"), mode: "error" });
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
      body: JSON.stringify({ question, current_module: currentModuleName(), conv_history })
    });

    history.pop(); // thinking-г устгана

    const mode = r.mode || "fallback";
    history.push({
      role:    "bot",
      text:    r.answer || "Хариулт олдсонгүй.",
      title:   r.title  || "",
      mode,
      log_id:  r.log_id || null,
      fb:      null,
      question,
    });

    if (Array.isArray(r.suggestions) && r.suggestions.length) {
      quickPrompts.splice(0, quickPrompts.length, ...r.suggestions.slice(0, 4));
    }
  } catch (e) {
    history.pop();
    history.push({ role: "bot", text: "Алдаа гарлаа: " + (e.message || "дахин оролдоно уу"), mode: "error" });
  } finally {
    assistantBusy = false;
    if (btn) { btn.disabled = false; btn.textContent = "Илгээх"; }
    renderAssistantMessages();
  }
}

export function initErpAssistant() {
  if (!state.token) return;
  renderAssistantShell();
}

Object.assign(window, { toggleErpAssistant, sendErpAssistant, askErpAssistant, erpAiFeedback, openErpDevRequest });
