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
  safety: ["dashboard","attendance","safety","reports"]
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
