import { state, api, toast, escapeHtml } from './common.js';

// ── KB state ────────────────────────────────────────────────────
let _kbRows = [];
let _kbEditId = null;
let _kbModFilter = "all";
let _activeView = "requests"; // "requests" | "kb"

const KB_MODULES = ["general","lighting","hr","assets","warehouse","operations","habea","finance","streetlights","reports"];
const KB_CATS    = ["FAQ","procedure","rule","glossary"];
const KB_CAT_MN  = { FAQ:"Асуулт/Хариулт", procedure:"Заавар", rule:"Дүрэм", glossary:"Тодорхойлолт" };
const KB_MOD_MN  = { general:"Нийтлэг", lighting:"Гэрэлтүүлэг", hr:"Хүний нөөц", assets:"Объект",
                     warehouse:"Агуулах", operations:"Үйлдэл", habea:"ХАБЭА",
                     finance:"Санхүү", streetlights:"Гудамжны гэрэл", reports:"Тайлан" };
const KB_ROLE_MINS = ["worker","engineer","storekeeper","accountant","hr","chief_engineer","director"];
const KB_ROLE_MN   = { worker:"Бүгд", engineer:"Инженер+", storekeeper:"Нярав+",
                       accountant:"Нягтлан+", hr:"HR+", chief_engineer:"Ерөнхий инженер+", director:"Захирал" };

const ALLOWED = ["director", "chief_engineer"];
const STATUS_LIST   = ["Шинэ", "AI-д явуулсан", "Шалгаж байна", "Хийхээр болсон", "Хийгдсэн", "Хаасан"];
const PRIORITY_LIST = ["low", "medium", "high"];
const PRIORITY_MN   = { low: "Бага", medium: "Дунд", high: "Өндөр" };
const STATUS_COLOR  = {
  "Шинэ":           "#2563eb",
  "AI-д явуулсан":  "#0891b2",
  "Шалгаж байна":   "#d97706",
  "Хийхээр болсон": "#7c3aed",
  "Хийгдсэн":       "#16a34a",
  "Хаасан":         "#6b7280",
};
const TYPE_MN = { bug: "🐛 Алдаа", feature: "✨ Санал", report: "📄 Тайлан", support: "🙋 Тусламж" };

let _rows = [];
let _filter = "all";
let _lastPromptIds = [];

function fmtDate(s) { return s ? s.slice(0, 16).replace("T", " ") : "—"; }
function esc(s)     { return escapeHtml(String(s || "")); }
function promptText(s, max = 1000) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, max);
}

export async function dev_requests() {
  const me = state.me;
  if (!ALLOWED.includes(me?.role)) {
    document.getElementById("main").innerHTML =
      `<div style="padding:40px;color:#ef4444;font-size:15px">🔒 Зөвхөн захирал/ерөнхий инженер харах боломжтой.</div>`;
    return;
  }
  renderOuterShell();
  if (_activeView === "kb") { await loadKbRows(); renderKbView(); }
  else { renderShell(true); await loadRows(); }
}

function renderOuterShell() {
  const main = document.getElementById("main");
  main.innerHTML = `
  <div style="max-width:1100px;margin:0 auto">
    <div style="display:flex;gap:6px;margin-bottom:18px;border-bottom:2px solid #e2e6ed;padding-bottom:0">
      <button id="dr_vtab_requests" onclick="drSwitchView('requests')"
        style="padding:8px 18px;border:0;border-radius:8px 8px 0 0;cursor:pointer;font-size:13px;font-weight:700;
               background:${_activeView==='requests'?'#2563eb':'transparent'};
               color:${_activeView==='requests'?'#fff':'#6b7280'};
               border-bottom:${_activeView==='requests'?'2px solid #2563eb':'2px solid transparent'};margin-bottom:-2px">
        📋 Хүсэлтүүд
      </button>
      <button id="dr_vtab_kb" onclick="drSwitchView('kb')"
        style="padding:8px 18px;border:0;border-radius:8px 8px 0 0;cursor:pointer;font-size:13px;font-weight:700;
               background:${_activeView==='kb'?'#2563eb':'transparent'};
               color:${_activeView==='kb'?'#fff':'#6b7280'};
               border-bottom:${_activeView==='kb'?'2px solid #2563eb':'2px solid transparent'};margin-bottom:-2px">
        📚 KB засах
      </button>
    </div>
    <div id="dr_view_content"></div>
  </div>`;
}

async function drSwitchView(v) {
  _activeView = v;
  const main = document.getElementById("main");
  // update tab styles
  ["requests","kb"].forEach(t => {
    const btn = document.getElementById(`dr_vtab_${t}`);
    if (!btn) return;
    btn.style.background    = t===v ? "#2563eb" : "transparent";
    btn.style.color         = t===v ? "#fff"    : "#6b7280";
    btn.style.borderBottom  = t===v ? "2px solid #2563eb" : "2px solid transparent";
  });
  const vc = document.getElementById("dr_view_content");
  if (!vc) { await dev_requests(); return; }
  if (v === "kb") { await loadKbRows(); renderKbView(); }
  else            { renderShell(true); await loadRows(); }
}

function renderShell(inPlace = false) {
  const target = inPlace
    ? document.getElementById("dr_view_content")
    : document.getElementById("main");
  if (!target) return;
  target.innerHTML = `
  <div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;flex-wrap:wrap;gap:10px">
      <div>
        <h1 style="margin:0 0 3px;font-size:20px">🛠 ERP хөгжүүлэлтийн хүсэлтүүд</h1>
        <div style="font-size:12px;color:#667085">Ажилчдын санал, алдааны мэдэгдэл · backlog удирдлага</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button onclick="drGenCodexPrompt()" style="border:0;border-radius:8px;background:#7c3aed;color:#fff;font-weight:700;padding:8px 16px;cursor:pointer;font-size:13px">
          🤖 Шинэ хүсэлт AI-д
        </button>
        <button onclick="drGenCodexPrompt(true)" style="border:1px solid #bfdbfe;border-radius:8px;background:#eff6ff;color:#1d4ed8;font-weight:700;padding:8px 14px;cursor:pointer;font-size:13px">
          Бүх статус export
        </button>
        <button onclick="drMarkAllNewPrompted()" style="border:1px solid #bae6fd;border-radius:8px;background:#ecfeff;color:#0e7490;font-weight:700;padding:8px 14px;cursor:pointer;font-size:13px">
          Шинэ бүгдийг явуулсан болгох
        </button>
        <button onclick="drRefresh()" style="border:1px solid #e2e6ed;border-radius:8px;background:#fff;color:#374151;font-weight:600;padding:8px 14px;cursor:pointer;font-size:13px">
          ↻ Шинэчлэх
        </button>
      </div>
    </div>

    <!-- Filter tabs -->
    <div style="display:flex;gap:4px;margin-bottom:16px;flex-wrap:wrap">
      ${["all","Шинэ","AI-д явуулсан","Шалгаж байна","Хийхээр болсон","Хийгдсэн","Хаасан"].map(f =>
        `<button id="dr_f_${f}" onclick="drFilter('${f}')"
          style="border:1px solid #e2e6ed;border-radius:999px;padding:5px 14px;font-size:12px;cursor:pointer;
                 background:${_filter===f?'#2563eb':'#fff'};color:${_filter===f?'#fff':'#374151'};font-weight:600;transition:all .15s">
          ${f === "all" ? "Бүгд" : f}
        </button>`).join("")}
    </div>

    <div id="dr_list"><div style="padding:40px;text-align:center;color:#94a3b8">Ачааллаж байна…</div></div>

    <!-- Codex prompt modal -->
    <div id="dr_codex_modal" style="display:none;position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,.5);align-items:center;justify-content:center">
      <div style="background:#fff;border-radius:16px;padding:24px;width:min(700px,94vw);max-height:85vh;overflow-y:auto;position:relative">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <div style="font-weight:800;font-size:16px">🤖 AI prompt</div>
          <button onclick="drCloseCodex()" style="border:0;background:none;font-size:20px;cursor:pointer;color:#6b7280">✕</button>
        </div>
        <div style="font-size:12px;color:#6b7280;margin-bottom:10px">Доорх бэлэн багцыг шууд Codex, Claude эсвэл ChatGPT-д өгнө. Copy хийхэд шинэ хүсэлтүүд автоматаар "AI-д явуулсан" болно.</div>
        <textarea id="dr_codex_text" readonly style="width:100%;min-height:320px;border:1px solid #e2e6ed;border-radius:8px;padding:12px;font:13px/1.6 monospace;resize:vertical;box-sizing:border-box"></textarea>
        <button onclick="drCopyCodex()" style="margin-top:12px;border:0;border-radius:8px;background:#2563eb;color:#fff;font-weight:700;padding:8px 20px;cursor:pointer;font-size:13px">
          📋 Хуулах + явуулсан болгох
        </button>
      </div>
    </div>
  </div>`;
}

async function loadRows() {
  try {
    _rows = await api("/api/assistant/dev-requests");
    renderList();
  } catch (e) {
    document.getElementById("dr_list").innerHTML =
      `<div style="padding:30px;color:#ef4444">Ачаалахад алдаа: ${esc(e.message)}</div>`;
  }
}

function renderList() {
  const visible = _filter === "all" ? _rows : _rows.filter(r => r.status === _filter);

  // Update filter button styles
  ["all","Шинэ","AI-д явуулсан","Шалгаж байна","Хийхээр болсон","Хийгдсэн","Хаасан"].forEach(f => {
    const btn = document.getElementById(`dr_f_${f}`);
    if (!btn) return;
    btn.style.background = _filter === f ? "#2563eb" : "#fff";
    btn.style.color      = _filter === f ? "#fff"    : "#374151";
  });

  if (!visible.length) {
    document.getElementById("dr_list").innerHTML =
      `<div style="padding:40px;text-align:center;color:#94a3b8">Хүсэлт байхгүй байна.</div>`;
    return;
  }

  document.getElementById("dr_list").innerHTML = `
  <div style="display:flex;flex-direction:column;gap:10px">
    ${visible.map(r => rowCard(r)).join("")}
  </div>`;
}

function rowCard(r) {
  const statusColor = STATUS_COLOR[r.status] || "#6b7280";
  const priorityBg  = r.priority === "high" ? "#fef2f2" : r.priority === "medium" ? "#fffbeb" : "#f0fdf4";
  const priorityClr = r.priority === "high" ? "#991b1b" : r.priority === "medium" ? "#92400e" : "#166534";

  return `
  <div id="dr_card_${r.id}" style="background:#fff;border:1px solid #e2e6ed;border-radius:12px;padding:16px;transition:box-shadow .15s"
       onmouseover="this.style.boxShadow='0 4px 16px rgba(0,0,0,.08)'" onmouseout="this.style.boxShadow='none'">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div style="flex:1;min-width:200px">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
          <span style="font-size:11px;font-weight:700;background:${statusColor}22;color:${statusColor};border-radius:999px;padding:2px 10px">${esc(r.status)}</span>
          <span style="font-size:11px;font-weight:700;background:${priorityBg};color:${priorityClr};border-radius:999px;padding:2px 10px">${PRIORITY_MN[r.priority] || r.priority || "—"}</span>
          <span style="font-size:11px;color:#6b7280">${TYPE_MN[r.request_type] || esc(r.request_type)}</span>
          <span style="font-size:11px;color:#94a3b8">#${r.id}</span>
        </div>
        <div style="font-weight:700;font-size:14px;margin-bottom:4px">${esc(r.title)}</div>
        <div style="font-size:12px;color:#374151;margin-bottom:6px;white-space:pre-wrap">${esc(r.description)}</div>
        <div style="font-size:11px;color:#94a3b8">
          ${r.user_name ? `👤 ${esc(r.user_name)} · ` : ""}
          📦 ${esc(r.module || "—")} ·
          🕐 ${fmtDate(r.created_at)}
        </div>
        ${r.admin_note ? `<div style="margin-top:8px;padding:8px 10px;background:#f1f5f9;border-radius:8px;font-size:12px;color:#374151"><strong>Тайлбар:</strong> ${esc(r.admin_note)}</div>` : ""}
      </div>

      <!-- Controls -->
      <div style="display:flex;flex-direction:column;gap:8px;min-width:170px">
        <div>
          <div style="font-size:11px;color:#6b7280;margin-bottom:3px">Статус</div>
          <select onchange="drUpdateField(${r.id},'status',this.value)"
            style="width:100%;border:1px solid #e2e6ed;border-radius:7px;padding:5px 8px;font-size:12px;font-weight:600;cursor:pointer">
            ${STATUS_LIST.map(s => `<option value="${s}" ${r.status===s?"selected":""}>${s}</option>`).join("")}
          </select>
        </div>
        <div>
          <div style="font-size:11px;color:#6b7280;margin-bottom:3px">Чухалчлал</div>
          <select onchange="drUpdateField(${r.id},'priority',this.value)"
            style="width:100%;border:1px solid #e2e6ed;border-radius:7px;padding:5px 8px;font-size:12px;font-weight:600;cursor:pointer">
            ${PRIORITY_LIST.map(p => `<option value="${p}" ${r.priority===p?"selected":""}>${PRIORITY_MN[p]}</option>`).join("")}
          </select>
        </div>
        <div>
          <div style="font-size:11px;color:#6b7280;margin-bottom:3px">Тайлбар</div>
          <input id="dr_note_${r.id}" type="text" placeholder="Тэмдэглэл…" value="${esc(r.admin_note||'')}"
            style="width:100%;border:1px solid #e2e6ed;border-radius:7px;padding:5px 8px;font-size:12px;box-sizing:border-box"
            onkeydown="if(event.key==='Enter')drSaveNote(${r.id})">
        </div>
        <button onclick="drSaveNote(${r.id})"
          style="border:1px solid #2563eb;background:#eff6ff;color:#1d4ed8;border-radius:7px;padding:5px 10px;font-size:12px;font-weight:700;cursor:pointer">
          💾 Хадгалах
        </button>
      </div>
    </div>
  </div>`;
}

async function drUpdateField(id, field, value) {
  const row = _rows.find(r => r.id === id);
  if (!row) return;

  try {
    await api(`/api/assistant/dev-requests/${id}`, {
      method: "PUT",
      body: JSON.stringify({ [field]: value }),
    });
    row[field] = value;
    if (field === "status" && value === "Хаасан") row.closed_at = new Date().toISOString();
    renderList();
    toast(`${field === "status" ? "Статус" : "Чухалчлал"} шинэчлэгдлээ`, "success");
  } catch (e) {
    toast("Алдаа: " + (e.message || "дахин оролдоно уу"), "error");
  }
}

async function drSaveNote(id) {
  const input = document.getElementById(`dr_note_${id}`);
  if (!input) return;
  const note = input.value.trim();
  try {
    await api(`/api/assistant/dev-requests/${id}`, {
      method: "PUT",
      body: JSON.stringify({ admin_note: note }),
    });
    const row = _rows.find(r => r.id === id);
    if (row) row.admin_note = note;
    renderList();
    toast("Тайлбар хадгалагдлаа", "success");
  } catch (e) {
    toast("Алдаа: " + (e.message || "дахин оролдоно уу"), "error");
  }
}

function drFilter(f) {
  _filter = f;
  renderList();
}

function drRefresh() { loadRows(); }

function drKind(r) {
  const d = `${r.title || ""} ${r.description || ""}`.toLowerCase();
  if (d.includes("erp туслах") || d.includes("bot") || d.includes("хариулт") || d.includes("intent") || d.includes("prompt")) return "chatbot";
  if (d.includes("хэвл") || d.includes("тайлан") || d.includes("pdf") || d.includes("excel")) return "report";
  if (d.includes("upload") || d.includes("word") || d.includes("зураг") || d.includes("файл")) return "upload";
  if (d.includes("харагдахгүй") || d.includes("дэлгэц") || d.includes("ui") || d.includes("товч")) return "ui";
  if (r.request_type === "bug") return "bug";
  return "feature";
}

function drKindLabel(k) {
  return {
    chatbot: "ERP туслах / AI хариулт",
    report: "Тайлан / хэвлэх",
    upload: "Файл / зураг upload",
    ui: "UI / харагдах байдал",
    bug: "ERP алдаа",
    feature: "Сайжруулалт",
  }[k] || k;
}

function drGenCodexPrompt(allRows = false) {
  const sourceRows = _rows
    .filter(r => allRows || r.status === "Шинэ")
    .sort((a, b) => {
      const pOrd = { high: 0, medium: 1, low: 2 };
      return (pOrd[a.priority] ?? 1) - (pOrd[b.priority] ?? 1) ||
        String(b.created_at || "").localeCompare(String(a.created_at || ""));
    })
    .slice(0, allRows ? 40 : 12);

  if (!sourceRows.length) {
    toast("Хүсэлт байхгүй байна", "info");
    return;
  }

  const grouped = {};
  for (const r of sourceRows) {
    const k = drKind(r);
    if (!grouped[k]) grouped[k] = [];
    grouped[k].push(r);
  }

  const groupText = Object.entries(grouped).map(([kind, rows]) => {
    const lines = rows.map((r, i) => {
      const prio = PRIORITY_MN[r.priority] || r.priority || "Дунд";
      const type = TYPE_MN[r.request_type]?.replace(/[^\wА-Яа-яҮүӨөЭэ ]/gu, "").trim() || r.request_type;
      const desc = promptText(r.description, kind === "chatbot" ? 1600 : 900);
      const note = r.admin_note ? `\n   admin_note: ${promptText(r.admin_note, 400)}` : "";
      return `${i + 1}. #${r.id} [${promptText(r.module || "?", 80)}] [${promptText(type, 40)}] [${promptText(prio, 20)}] [${r.status || "Шинэ"}]\n   ${desc}${note}`;
    }).join("\n");
    return `## ${drKindLabel(kind)}\n${lines}`;
  }).join("\n\n");

  const top = sourceRows.slice(0, 5).map(r => `#${r.id}`).join(", ");
  const prompt = `AI agent, энэ ERP backlog-ийг уншаад өөрөө ангилж засаж эхэл.

Repo: Node.js/Express + SQLite backend, Vanilla JS ES modules frontend.
Чухал: хэрэглэгчийн одоогийн өөрчлөлтийг эвдэхгүй, жижиг patch-аар яв.
Экспортын горим: ${allRows ? "бүх статус" : "зөвхөн шинэ хүсэлт"}.

Эхний ээлжинд шалгах хүсэлтүүд: ${top}

${groupText}

Даалгавар:
1. Хүсэлт бүрийг "chatbot intent/prompt", "ERP data/API", "UI/report/upload", "тодруулах шаардлагатай" гэж ангил.
2. Давхардсан хүсэлтүүдийг нэгтгэ.
3. Бага эрсдэлтэй 3-5 засварыг шууд хэрэгжүүл.
4. Код өөрчлөхдөө зөвхөн хэрэгтэй файлуудыг зас.
5. Дуусгаад changed files + syntax check + үлдсэн TODO-г товч хэл.`;

  const modal = document.getElementById("dr_codex_modal");
  const ta    = document.getElementById("dr_codex_text");
  if (modal && ta) {
    ta.value = prompt;
    modal.style.display = "flex";
    _lastPromptIds = allRows ? [] : sourceRows.map(r => r.id);
  }
}

function drCloseCodex() {
  const modal = document.getElementById("dr_codex_modal");
  if (modal) modal.style.display = "none";
}

async function drCopyCodex() {
  const ta = document.getElementById("dr_codex_text");
  if (!ta) return;
  try {
    await navigator.clipboard.writeText(ta.value);
    await drMarkPrompted();
    toast("Хуулагдлаа, шинэ хүсэлтүүд AI-д явуулсан боллоо ✓", "success");
  } catch (_) {
    ta.select();
    document.execCommand("copy");
    await drMarkPrompted();
    toast("Хуулагдлаа, шинэ хүсэлтүүд AI-д явуулсан боллоо ✓", "success");
  }
}

async function drMarkPrompted() {
  const ids = _lastPromptIds.filter(Boolean);
  if (!ids.length) return;
  await Promise.all(ids.map(id =>
    api(`/api/assistant/dev-requests/${id}`, {
      method: "PUT",
      body: JSON.stringify({ status: "AI-д явуулсан" }),
    }).catch(() => null)
  ));
  _rows = _rows.map(r => ids.includes(r.id) && r.status === "Шинэ"
    ? { ...r, status: "AI-д явуулсан" }
    : r
  );
  _lastPromptIds = [];
  renderList();
}

async function drMarkAllNewPrompted() {
  const ids = _rows.filter(r => r.status === "Шинэ").map(r => r.id);
  if (!ids.length) {
    toast("Шинэ хүсэлт алга байна", "info");
    return;
  }
  if (!confirm(`${ids.length} шинэ хүсэлтийг "AI-д явуулсан" болгох уу?`)) return;
  _lastPromptIds = ids;
  await drMarkPrompted();
  toast(`${ids.length} хүсэлт AI-д явуулсан боллоо`, "success");
}

// ═════════════════════════════════════════════════════════════════
// KB MANAGEMENT
// ═════════════════════════════════════════════════════════════════

async function loadKbRows() {
  try {
    _kbRows = await api("/api/assistant/kb");
  } catch (e) {
    _kbRows = [];
    toast("KB ачаалахад алдаа: " + (e.message || ""), "error");
  }
}

function renderKbView() {
  const vc = document.getElementById("dr_view_content");
  if (!vc) return;

  const filtered = _kbModFilter === "all" ? _kbRows : _kbRows.filter(r => r.module === _kbModFilter);

  vc.innerHTML = `
  <div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:10px">
      <div>
        <div style="font-weight:800;font-size:16px">📚 Мэдлэгийн сан (Knowledge Base)</div>
        <div style="font-size:12px;color:#667085">Нийт ${_kbRows.length} нийтлэл · Идэвхтэй: ${_kbRows.filter(r=>r.active).length}</div>
      </div>
      <button onclick="kbOpenNew()"
        style="border:0;border-radius:8px;background:#2563eb;color:#fff;font-weight:700;padding:8px 16px;cursor:pointer;font-size:13px">
        ➕ Шинэ нийтлэл
      </button>
    </div>

    <!-- Module filter -->
    <div style="display:flex;gap:4px;margin-bottom:14px;flex-wrap:wrap">
      ${["all",...KB_MODULES].map(m =>
        `<button onclick="kbModFilter('${m}')"
          style="border:1px solid #e2e6ed;border-radius:999px;padding:4px 12px;font-size:11px;cursor:pointer;font-weight:600;
                 background:${_kbModFilter===m?'#2563eb':'#fff'};color:${_kbModFilter===m?'#fff':'#374151'}">
          ${m==='all'?'Бүгд':KB_MOD_MN[m]||m}
        </button>`).join("")}
    </div>

    <!-- Article list -->
    <div style="display:flex;flex-direction:column;gap:8px">
      ${filtered.length ? filtered.map(r => kbCard(r)).join("") :
        `<div style="padding:40px;text-align:center;color:#94a3b8">Нийтлэл байхгүй байна.</div>`}
    </div>

    <!-- Add/Edit form modal -->
    <div id="kb_modal" style="display:none;position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,.5);align-items:center;justify-content:center">
      <div style="background:#fff;border-radius:16px;padding:24px;width:min(680px,94vw);max-height:90vh;overflow-y:auto">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
          <div style="font-weight:800;font-size:16px" id="kb_modal_title">Шинэ нийтлэл</div>
          <button onclick="kbCloseModal()" style="border:0;background:none;font-size:20px;cursor:pointer;color:#6b7280">✕</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
          <div>
            <div style="font-size:11px;color:#6b7280;margin-bottom:3px">Модуль</div>
            <select id="kb_f_module" style="width:100%;border:1px solid #e2e6ed;border-radius:7px;padding:6px 8px;font-size:13px">
              ${KB_MODULES.map(m => `<option value="${m}">${KB_MOD_MN[m]||m}</option>`).join("")}
            </select>
          </div>
          <div>
            <div style="font-size:11px;color:#6b7280;margin-bottom:3px">Ангилал</div>
            <select id="kb_f_category" style="width:100%;border:1px solid #e2e6ed;border-radius:7px;padding:6px 8px;font-size:13px">
              ${KB_CATS.map(c => `<option value="${c}">${KB_CAT_MN[c]||c}</option>`).join("")}
            </select>
          </div>
          <div>
            <div style="font-size:11px;color:#6b7280;margin-bottom:3px">Доод эрх</div>
            <select id="kb_f_role_min" style="width:100%;border:1px solid #e2e6ed;border-radius:7px;padding:6px 8px;font-size:13px">
              ${KB_ROLE_MINS.map(r => `<option value="${r}">${KB_ROLE_MN[r]||r}</option>`).join("")}
            </select>
          </div>
          <div>
            <div style="font-size:11px;color:#6b7280;margin-bottom:3px">Эрэмбэ</div>
            <input id="kb_f_sort" type="number" value="100" min="1" max="999"
              style="width:100%;border:1px solid #e2e6ed;border-radius:7px;padding:6px 8px;font-size:13px;box-sizing:border-box">
          </div>
        </div>
        <div style="margin-bottom:10px">
          <div style="font-size:11px;color:#6b7280;margin-bottom:3px">Гарчиг *</div>
          <input id="kb_f_title" type="text" maxlength="200" placeholder="ERP-д энэ үйлдлийг хэрхэн хийх вэ?"
            style="width:100%;border:1px solid #e2e6ed;border-radius:7px;padding:7px 10px;font-size:13px;box-sizing:border-box">
        </div>
        <div style="margin-bottom:10px">
          <div style="font-size:11px;color:#6b7280;margin-bottom:3px">Агуулга * <span style="color:#94a3b8">(Markdown **bold**, \`code\`)</span></div>
          <textarea id="kb_f_body" rows="7" maxlength="4000" placeholder="Алхам алхмаар заавар бичнэ үү…"
            style="width:100%;border:1px solid #e2e6ed;border-radius:7px;padding:7px 10px;font-size:13px;resize:vertical;box-sizing:border-box"></textarea>
        </div>
        <div style="margin-bottom:16px">
          <div style="font-size:11px;color:#6b7280;margin-bottom:3px">Хайлтын түлхүүр үгс <span style="color:#94a3b8">(таслалаар тусга)</span></div>
          <input id="kb_f_keywords" type="text" maxlength="500" placeholder="гэмтэл,засвар,бүртгэх,lighting"
            style="width:100%;border:1px solid #e2e6ed;border-radius:7px;padding:7px 10px;font-size:13px;box-sizing:border-box">
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button onclick="kbCloseModal()"
            style="border:1px solid #e2e6ed;border-radius:8px;background:#fff;color:#374151;padding:8px 18px;font-weight:600;cursor:pointer">
            Болих
          </button>
          <button onclick="kbSave()"
            style="border:0;border-radius:8px;background:#2563eb;color:#fff;font-weight:700;padding:8px 22px;cursor:pointer;font-size:13px">
            💾 Хадгалах
          </button>
        </div>
      </div>
    </div>
  </div>`;
}

function kbCard(r) {
  const activeBg  = r.active ? "#f0fdf4" : "#f8fafc";
  const activeCl  = r.active ? "#16a34a" : "#9ca3af";
  return `
  <div style="background:#fff;border:1px solid #e2e6ed;border-radius:10px;padding:14px;display:flex;align-items:flex-start;gap:12px;transition:box-shadow .15s"
       onmouseover="this.style.boxShadow='0 4px 16px rgba(0,0,0,.07)'" onmouseout="this.style.boxShadow='none'">
    <div style="flex:1;min-width:0">
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:5px">
        <span style="font-size:10px;font-weight:700;background:#eff6ff;color:#2563eb;border-radius:999px;padding:2px 8px">${KB_MOD_MN[r.module]||r.module}</span>
        <span style="font-size:10px;color:#6b7280;background:#f1f5f9;border-radius:999px;padding:2px 8px">${KB_CAT_MN[r.category]||r.category}</span>
        <span style="font-size:10px;color:#6b7280;background:#f1f5f9;border-radius:999px;padding:2px 8px">👁 ${KB_ROLE_MN[r.role_min]||r.role_min}</span>
        <span style="font-size:10px;font-weight:700;background:${activeBg};color:${activeCl};border-radius:999px;padding:2px 8px">${r.active?'Идэвхтэй':'Идэвхгүй'}</span>
      </div>
      <div style="font-weight:700;font-size:13px;margin-bottom:3px">${esc(r.title)}</div>
      <div style="font-size:11px;color:#6b7280;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.body.slice(0,120))}</div>
      ${r.keywords ? `<div style="font-size:10px;color:#94a3b8;margin-top:4px">🔑 ${esc(r.keywords)}</div>` : ""}
    </div>
    <div style="display:flex;gap:6px;flex-shrink:0">
      <button onclick="kbOpenEdit(${r.id})"
        style="border:1px solid #e2e6ed;border-radius:7px;background:#fff;color:#374151;padding:5px 10px;font-size:12px;cursor:pointer;font-weight:600">
        ✏️
      </button>
      <button onclick="kbToggleActive(${r.id},${r.active})"
        style="border:1px solid ${r.active?'#fca5a5':'#86efac'};border-radius:7px;background:${r.active?'#fef2f2':'#f0fdf4'};color:${r.active?'#991b1b':'#166534'};padding:5px 10px;font-size:12px;cursor:pointer;font-weight:600"
        title="${r.active?'Идэвхгүй болгох':'Идэвхжүүлэх'}">
        ${r.active?'🚫':'✅'}
      </button>
    </div>
  </div>`;
}

function kbOpenNew() {
  _kbEditId = null;
  const modal = document.getElementById("kb_modal");
  const titleEl = document.getElementById("kb_modal_title");
  if (!modal) return;
  if (titleEl) titleEl.textContent = "Шинэ нийтлэл нэмэх";
  document.getElementById("kb_f_module").value   = "general";
  document.getElementById("kb_f_category").value = "FAQ";
  document.getElementById("kb_f_role_min").value = "worker";
  document.getElementById("kb_f_sort").value     = "100";
  document.getElementById("kb_f_title").value    = "";
  document.getElementById("kb_f_body").value     = "";
  document.getElementById("kb_f_keywords").value = "";
  modal.style.display = "flex";
}

function kbOpenEdit(id) {
  const row = _kbRows.find(r => r.id === id);
  if (!row) return;
  _kbEditId = id;
  const modal = document.getElementById("kb_modal");
  const titleEl = document.getElementById("kb_modal_title");
  if (!modal) return;
  if (titleEl) titleEl.textContent = "Нийтлэл засах";
  document.getElementById("kb_f_module").value   = row.module   || "general";
  document.getElementById("kb_f_category").value = row.category || "FAQ";
  document.getElementById("kb_f_role_min").value = row.role_min || "worker";
  document.getElementById("kb_f_sort").value     = row.sort_order || 100;
  document.getElementById("kb_f_title").value    = row.title   || "";
  document.getElementById("kb_f_body").value     = row.body    || "";
  document.getElementById("kb_f_keywords").value = row.keywords|| "";
  modal.style.display = "flex";
}

function kbCloseModal() {
  const modal = document.getElementById("kb_modal");
  if (modal) modal.style.display = "none";
  _kbEditId = null;
}

async function kbSave() {
  const payload = {
    module:     document.getElementById("kb_f_module")?.value,
    category:   document.getElementById("kb_f_category")?.value,
    role_min:   document.getElementById("kb_f_role_min")?.value,
    sort_order: Number(document.getElementById("kb_f_sort")?.value) || 100,
    title:      document.getElementById("kb_f_title")?.value?.trim(),
    body:       document.getElementById("kb_f_body")?.value?.trim(),
    keywords:   document.getElementById("kb_f_keywords")?.value?.trim(),
  };
  if (!payload.title || !payload.body) {
    toast("Гарчиг болон агуулга заавал бөглөнө", "error");
    return;
  }
  try {
    if (_kbEditId) {
      await api(`/api/assistant/kb/${_kbEditId}`, { method: "PUT", body: JSON.stringify(payload) });
      const idx = _kbRows.findIndex(r => r.id === _kbEditId);
      if (idx >= 0) _kbRows[idx] = { ..._kbRows[idx], ...payload };
      toast("Нийтлэл шинэчлэгдлээ", "success");
    } else {
      const r = await api("/api/assistant/kb", { method: "POST", body: JSON.stringify(payload) });
      _kbRows.unshift({ id: r.id, active: 1, ...payload });
      toast("Шинэ нийтлэл нэмэгдлээ", "success");
    }
    kbCloseModal();
    renderKbView();
  } catch (e) {
    toast("Хадгалахад алдаа: " + (e.message || ""), "error");
  }
}

async function kbToggleActive(id, currentActive) {
  try {
    await api(`/api/assistant/kb/${id}`, {
      method: "PUT",
      body: JSON.stringify({ active: currentActive ? 0 : 1 }),
    });
    const row = _kbRows.find(r => r.id === id);
    if (row) row.active = currentActive ? 0 : 1;
    renderKbView();
    toast(currentActive ? "Идэвхгүй болголоо" : "Идэвхжүүллээ", "success");
  } catch (e) {
    toast("Алдаа: " + (e.message || ""), "error");
  }
}

function kbModFilter(m) {
  _kbModFilter = m;
  renderKbView();
}

Object.assign(window, {
  dev_requests, drSwitchView,
  drFilter, drRefresh, drUpdateField, drSaveNote,
  drGenCodexPrompt, drCloseCodex, drCopyCodex, drMarkAllNewPrompted,
  kbOpenNew, kbOpenEdit, kbCloseModal, kbSave, kbToggleActive, kbModFilter,
});
