export const API = location.origin;

export const state = {
  token: localStorage.getItem("token") || "",
  me: JSON.parse(localStorage.getItem("me") || "null"),
  users: [],
  current: "dashboard",
  clockTimer: null
};

export const roleMenus = {
  director: ["dashboard","attendance","work","materials","expenses","hr","docs","safety","plans","reports","audit"],
  chief_engineer: ["dashboard","attendance","work","materials","docs","safety","plans","reports"],
  engineer: ["dashboard","attendance","work","docs","reports"],
  storekeeper: ["dashboard","attendance","materials","reports"],
  accountant: ["dashboard","attendance","expenses","reports"],
  hr: ["dashboard","attendance","hr","docs","reports"],
  safety: ["dashboard","attendance","safety","reports"],
  electric: ["dashboard","attendance","work","reports"]
};

export const menuNames = {
  dashboard:"📊 Нэгдсэн дэлгэц",
  attendance:"⏱ Ирц / цагийн бүртгэл",
  work:"🛠 Ажлын явц",
  materials:"📦 Материал",
  expenses:"💰 Зардал",
  hr:"👥 Хүний нөөц",
  docs:"📄 Бичиг / гомдол",
  safety:"🦺 ХАБЭА",
  plans:"📈 Төлөвлөгөө",
  reports:"📑 Тайлан",
  audit:"🛡 Audit log"
};

export async function api(path, opt = {}) {
  const res = await fetch(API + path, {
    ...opt,
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + state.token,
      ...(opt.headers || {})
    }
  });
  if (!res.ok) throw new Error((await res.json()).error || "Алдаа гарлаа");
  return res.json();
}

export function toast(t) {
  const d = document.createElement("div");
  d.className = "toast";
  d.textContent = t;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 2200);
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, m => ({
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    '"':"&quot;",
    "'":"&#39;"
  }[m]));
}

export function table(headers, rows) {
  return `
  <table>
    <thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead>
    <tbody>
      ${
        rows.length
        ? rows.map(r => `<tr>${r.map(c => `<td>${c ?? ""}</td>`).join("")}</tr>`).join("")
        : `<tr><td colspan="${headers.length}" class="muted">Одоогоор мэдээлэл алга</td></tr>`
      }
    </tbody>
  </table>`;
}

export function userOptions(sel) {
  return state.users.map(u => `
    <option value="${u.id}" ${sel == u.id ? "selected" : ""}>
      ${u.full_name} — ${u.position || ""}
    </option>
  `).join("");
}

export function codeClass(code) {
  if (code === "А") return "worked";
  if (code === "Т") return "absent";
  if (code === "Ч") return "leave";
  if (code === "Ө") return "sick";
  if (code === "Э") return "vacation";
  if (code === "Х") return "late";
  if (code === "ИЦ") return "overtime";
  return "";
}

// ── Floating sticky horizontal scrollbar ─────────────────────
// .table-wrap viewport-оос гадагшлахад доод талд гарна

let _floatingBar = null;
let _activeWrap  = null;
let _syncing     = false;

function _getOrCreateBar() {
  if (_floatingBar) return _floatingBar;
  const bar = document.createElement("div");
  bar.className = "floating-hscroll";
  const inner = document.createElement("div");
  bar.appendChild(inner);
  document.body.appendChild(bar);

  bar.addEventListener("scroll", () => {
    if (_syncing || !_activeWrap) return;
    _syncing = true;
    _activeWrap.scrollLeft = bar.scrollLeft;
    _syncing = false;
  }, { passive: true });

  _floatingBar = bar;
  return bar;
}

function _updateFloating() {
  const bar = _getOrCreateBar();
  const wraps = document.querySelectorAll(".table-wrap");
  let found = null;

  wraps.forEach(wrap => {
    if (wrap.scrollWidth <= wrap.clientWidth) return;
    const rect = wrap.getBoundingClientRect();
    // Хүснэгтийн native scrollbar viewport-аас гарсан бол
    if (rect.bottom > window.innerHeight && rect.top < window.innerHeight) {
      found = wrap;
    }
  });

  if (found) {
    const rect = found.getBoundingClientRect();
    bar.style.display  = "block";
    bar.style.left     = rect.left + "px";
    bar.style.width    = rect.width + "px";
    bar.firstChild.style.width = found.scrollWidth + "px";
    if (_activeWrap !== found) {
      _activeWrap = found;
      bar.scrollLeft = found.scrollLeft;
      found._floatingListener && found.removeEventListener("scroll", found._floatingListener);
      found._floatingListener = () => {
        if (_syncing) return;
        _syncing = true;
        bar.scrollLeft = found.scrollLeft;
        _syncing = false;
      };
      found.addEventListener("scroll", found._floatingListener, { passive: true });
    }
  } else {
    bar.style.display = "none";
    _activeWrap = null;
  }
}

export function initFloatingScrollbar() {
  window.addEventListener("scroll",  _updateFloating, { passive: true });
  window.addEventListener("resize",  _updateFloating, { passive: true });
  // main дотор шинэ table-wrap нэмэгдэхэд автоматаар идэвхжих
  const main = document.getElementById("main");
  if (!main) return;
  new MutationObserver(_updateFloating).observe(main, { childList: true, subtree: true });
}

export function hydrateGlobals() {
  [
    "main","username","password","auser","atype","adate","anote",
    "amorningIn","alunchOut","aafternoonIn","aeveningOut","aovertime",
    "astartDate","aendDate","wtitle","wcat","wloc","wdep","wdate",
    "wass","wdesc","wstatus","wprog","wcost","pfile","mname",
    "munit","mbalance","mwarn","mprice","mnote","ecat","eamount",
    "edate","edesc","efull","epos","edept","ereg","ephone",
    "eaddr","erole","ptitle","pyear","pbudget","pdesc"
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) window[id] = el;
  });
}
