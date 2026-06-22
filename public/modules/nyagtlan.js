import { state, api, toast, today, escapeHtml, table } from './common.js';

const canEdit = () => ["director","accountant"].includes(state.me.role);
const fmt = n => Number(n||0).toLocaleString("mn-MN", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1
});
const fmtDate = s => s ? s.slice(0,10) : "—";

const FIN_TABS = [
  ["fin_dashboard", "💼", "Самбар"],
  ["cash_journal",  "📋", "Мөнгөн журнал"],
  ["payables",      "↓",  "Өглөг"],
  ["receivables",   "↑",  "Авлага"],
  ["fin_materials",  "📦", "Бараа материал"],
  ["fin_budget_performance", "📊", "Төсөв гүйцэтгэл"],
  ["fixed_ledger",  "🏢", "Үндсэн хөрөнгө"],
  ["fin_reports",   "📑", "Тайлан"],
];

const budgetRow = (code, name, level, monthly) => ({
  code, name, level, monthly,
  plan: monthly.reduce((s, v) => s + Number(v || 0), 0)
});
const sumMonths = (...rows) => Array.from({ length: 12 }, (_, i) => rows.reduce((s, r) => s + Number(r[i] || 0), 0));
const M_TOTAL_2026 = [112661787,106229687,168956852,112079852,100076952,179070052,97676952,97676952,157470452,106926291,70447128,41694828];
const M_2101 = [42617063,42617063,50914063,50914063,50914063,50914063,50914063,50914063,50914063,50914063,5716100,3924000];
const M_2102 = [6179274,6179174,7382539,7382539,7382539,7382539,7382539,7382539,7382539,6444978,6444978,6444978];
const M_210201 = [3622250,3622150,4327695,4327695,4327695,4327695,4327695,4327695,4327695,3622450,3622450,3622450];
const M_210202 = [426171,426171,509141,509141,509141,509141,509141,509141,509141,509141,509141,509141];
const M_210203 = [1193278,1193278,1425594,1425594,1425594,1425594,1425594,1425594,1425594,1193278,1193278,1193278];
const M_210204 = [85234,85234,101828,101828,101828,101828,101828,101828,101828,101828,101828,101828];
const M_210205 = [852341,852341,1018281,1018281,1018281,1018281,1018281,1018281,1018281,1018281,1018281,1018281];
const M_210301 = [50847300,47347300,40141100,31800100,31800100,30799700,30800100,30800100,33800100,40141100,48859900,18846200];
const M_210302 = [845900,845900,845900,845900,0,0,0,0,0,845900,845900,845900];
const M_210303 = [148000,148000,148000,148000,148000,148000,148000,148000,148000,148000,148000,148000];
const M_210401 = [172833,172833,172833,172833,172833,172833,172833,172833,172833,172833,172833,172833];
const M_210402 = [4920700,4919700,4919700,4919700,4919700,4919700,4919700,4919700,4919700,4919700,4919700,4919700];
const M_210403 = [129000,129000,129000,129000,129000,129000,129000,129000,129000,129000,129000,129000];
const M_210405 = [397100,396100,396100,396100,396100,396100,396100,396100,396100,396100,396100,396100];
const M_210503 = [0,0,0,6578000,0,0,0,0,4340000,0,0,0];
const M_210601 = [515417,515417,515417,515417,515417,515417,515417,515417,515417,515417,515417,515417];
const M_210603 = [299200,299200,299200,6278200,299200,299200,299200,299200,299200,299200,299200,299200];
const M_210604 = [2000000,2000000,55260000,2000000,2000000,79540000,2000000,2000000,51600000,2000000,2000000,2000000];
const M_210801 = [0,0,2976200,0,0,2976200,0,0,1976200,0,0,1976200];
const M_210802 = [0,0,2700000,0,0,0,0,0,0,0,0,0];
const M_210803 = [0,0,565200,0,0,0,0,0,0,0,0,0];
const M_210804 = [0,0,153300,0,0,0,0,0,0,0,0,0];
const M_210805 = [0,0,121000,0,0,0,0,0,0,0,0,0];
const M_210806 = [0,0,440000,0,0,0,0,0,0,0,0,0];
const M_210807 = [0,0,677300,0,0,677300,0,0,677300,0,0,677300];
const M_210902 = [0,660000,0,0,0,0,0,0,0,0,0,0];
const M_213204 = [3590000,0,200000,0,1400000,200000,0,0,200000,0,0,400000];

const FIN_BUDGET_CODE_ALIASES = {
  "210406": "210405",
  "210901": "210902",
  "2205": "213204"
};

const FIN_BUDGET_PLAN_2026 = [
  budgetRow("2", "НИЙТ ЗАРЛАГА БА ЦЭВЭР ЗЭЭЛИЙН ДҮН", 0, M_TOTAL_2026),
  budgetRow("21", "УРСГАЛ ЗАРДАЛ", 0, M_TOTAL_2026),
  budgetRow("210", "БАРАА, АЖИЛ ҮЙЛЧИЛГЭЭНИЙ ЗАРДАЛ", 0, M_TOTAL_2026),
  budgetRow("2101", "Цалин хөлс болон нэмэгдэл урамшил", 1, M_2101),
  budgetRow("210101", "Үндсэн цалин", 2, M_2101),
  budgetRow("2102", "Ажил олгогчоос нийгмийн даатгал төлөх шимтгэл", 1, M_2102),
  budgetRow("210201", "Тэтгэврийн даатгал", 2, M_210201),
  budgetRow("210202", "Тэтгэмжийн даатгал", 2, M_210202),
  budgetRow("210203", "ҮОМШӨ-ний даатгал", 2, M_210203),
  budgetRow("210204", "Ажилгүйдлийн даатгал", 2, M_210204),
  budgetRow("210205", "Эрүүл мэндийн даатгал", 2, M_210205),
  budgetRow("2103", "Байр ашиглалттай холбоотой тогтмол зардал", 1, sumMonths(M_210301, M_210302, M_210303)),
  budgetRow("210301", "Гэрэл, цахилгаан", 2, M_210301),
  budgetRow("210302", "Түлш, халаалт", 2, M_210302),
  budgetRow("210303", "Цэвэр, бохир ус", 2, M_210303),
  budgetRow("2104", "Хангамж, бараа материалын зардал", 1, sumMonths(M_210401, M_210402, M_210403, M_210405)),
  budgetRow("210401", "Бичиг хэрэг", 2, M_210401),
  budgetRow("210402", "Тээвэр, шатахуун", 2, M_210402),
  budgetRow("210403", "Шуудан, холбоо, интернэтийн төлбөр", 2, M_210403),
  budgetRow("210405", "Бага үнэтэй, түргэн элэгдэх ахуйн эд зүйлс", 2, M_210405),
  budgetRow("2105", "Нормативт зардал", 1, M_210503),
  budgetRow("210503", "Нормын хувцас, зөөлөн эдлэл", 2, M_210503),
  budgetRow("2106", "Эд хогшил, урсгал засварын зардал", 1, sumMonths(M_210601, M_210603, M_210604)),
  budgetRow("210601", "Багаж, техник хэрэгсэл", 2, M_210601),
  budgetRow("210603", "Хөдөлмөр хамгааллын хэрэгсэл", 2, M_210603),
  budgetRow("210604", "Урсгал засвар", 2, M_210604),
  budgetRow("2108", "Бусдаар гүйцэтгүүлсэн ажил үйлчилгээний төлбөр, хураамж", 1, sumMonths(M_210801, M_210802, M_210803, M_210804, M_210805, M_210806, M_210807)),
  budgetRow("210801", "Бусдаар гүйцэтгэсэн ажил үйлчилгээ", 2, M_210801),
  budgetRow("210802", "Аудит, баталгаажуулалт, зэрэглэл тогтоох", 2, M_210802),
  budgetRow("210803", "Даатгалын үйлчилгээ", 2, M_210803),
  budgetRow("210804", "Тээврийн хэрэгслийн татвар", 2, M_210804),
  budgetRow("210805", "Тээврийн хэрэгслийн оношилгоо", 2, M_210805),
  budgetRow("210806", "Мэдээлэл, технологийн үйлчилгээ", 2, M_210806),
  budgetRow("210807", "Газрын татвар", 2, M_210807),
  budgetRow("2109", "Бараа үйлчилгээний бусад зардал", 1, M_210902),
  budgetRow("210902", "Сургалтын зардал", 2, M_210902),
  budgetRow("213", "Нийгмийн халамжийн тэтгэмж, урамшуулал", 1, M_213204),
  budgetRow("213204", "Бусад тэтгэмж, урамшуулал", 2, M_213204)
];

const parseYmdLocal = s => {
  const [y, m, d] = String(s || "").slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
};
function budgetPlanForPeriod(row, from, to) {
  const start = parseYmdLocal(from);
  const end = parseYmdLocal(to);
  if (!start || !end || start > end) return 0;
  let sum = 0;
  for (let month = 1; month <= 12; month++) {
    const monthStart = new Date(2026, month - 1, 1);
    const monthEnd = new Date(2026, month, 0);
    if (start <= monthEnd && end >= monthStart) {
      sum += Number(row.monthly?.[month - 1] || 0);
    }
  }
  return sum;
}

function finBudgetCodeOf(row) {
  const text = [
    row.cash_flow_type, row.econ_category, row.corr_account,
    row.purpose, row.debit_account, row.credit_account, row.description
  ].filter(Boolean).join(" ");
  const m = String(text).match(/(^|\D)(\d{1,6})(?=\D|$)/);
  const code = m ? m[2] : "";
  return FIN_BUDGET_CODE_ALIASES[code] || code;
}

function finBudgetPerformanceRows(cashRows, from, to) {
  const expenseRows = (cashRows || [])
    .filter(r => r.txn_type === "Зарлага")
    .map(r => ({ ...r, _budgetCode: finBudgetCodeOf(r) }));
  const rows = FIN_BUDGET_PLAN_2026.map(row => {
    const actualRows = expenseRows.filter(r => {
      if (!row.code || !r._budgetCode) return false;
      if (row.code.length < 6) return r._budgetCode.startsWith(row.code);
      return r._budgetCode === row.code;
    });
    const actual = actualRows.reduce((s, r) => s + Number(r.amount || 0), 0);
    const plan = budgetPlanForPeriod(row, from, to);
    return { ...row, plan, actual, count: actualRows.length, diff: plan - actual };
  });
  const unmatched = expenseRows.filter(r => !r._budgetCode || !FIN_BUDGET_PLAN_2026.some(b => r._budgetCode.startsWith(b.code) || b.code.startsWith(r._budgetCode)));
  return { rows, expenseRows, unmatched };
}

let _financeTab = "fin_dashboard";
let _financeNavObserver = null;
let _financeNavQueued = false;

function financeNavHtml() {
  return `
    <div id="financeShellNav" style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:14px;overflow:hidden">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;border-bottom:1px solid #e2e8f0;flex-wrap:wrap">
        <div>
          <div style="font-size:18px;font-weight:900;color:#0f172a">💼 Санхүүгийн ажлын талбар</div>
          <div style="font-size:12px;color:#64748b;margin-top:2px">Нягтлангийн бүртгэл, өглөг авлага, тайлан</div>
        </div>
        ${canEdit() ? `<button class="btn sm" onclick="openSmartImport()">🧠 Smart Import</button>` : ""}
      </div>
      <div style="display:flex;gap:0;overflow-x:auto;padding:0 12px">
        ${FIN_TABS.map(([key, icon, label]) => `
          <button onclick="finOpen('${key}')" id="finTab_${key}"
            style="padding:12px 14px;font-size:13px;font-weight:700;border:none;background:transparent;
                   color:${_financeTab===key ? '#2563eb' : '#64748b'};cursor:pointer;white-space:nowrap;
                   display:flex;align-items:center;gap:6px;border-bottom:${_financeTab===key ? '3px solid #2563eb' : '3px solid transparent'}">
            <span>${icon}</span>${label}
          </button>`).join("")}
      </div>
    </div>`;
}

function injectFinanceNav() {
  const mainEl = document.getElementById("main");
  if (!mainEl || document.getElementById("financeShellNav")) return;
  mainEl.insertAdjacentHTML("afterbegin", financeNavHtml());
}

function scheduleFinanceNavInject() {
  if (_financeNavQueued) return;
  _financeNavQueued = true;
  requestAnimationFrame(() => {
    _financeNavQueued = false;
    if (state.current === "finance") injectFinanceNav();
  });
}

function ensureFinanceNavObserver() {
  const mainEl = document.getElementById("main");
  if (!mainEl) return;
  if (_financeNavObserver) _financeNavObserver.disconnect();
  _financeNavObserver = new MutationObserver(() => {
    if (state.current === "finance") scheduleFinanceNavInject();
  });
  _financeNavObserver.observe(mainEl, { childList: true });
}

async function finance() {
  ensureFinanceNavObserver();
  await finOpen("fin_dashboard");
}

async function finOpen(tab = "fin_dashboard") {
  ensureFinanceNavObserver();
  _financeTab = FIN_TABS.some(([key]) => key === tab) ? tab : "fin_dashboard";
  const fn = window[_financeTab];
  if (typeof fn === "function") await fn();
  scheduleFinanceNavInject();
}

function statCard(label, value, color, sub) {
  return `<div style="background:#fff;border:1px solid #e2e6ed;border-radius:12px;padding:14px 16px;border-top:3px solid ${color}">
    <div style="font-size:11px;color:#667085;margin-bottom:4px;text-transform:uppercase">${label}</div>
    <div style="font-size:22px;font-weight:800;color:${color}">${value}</div>
    ${sub ? `<div style="font-size:11px;color:#94a3b8;margin-top:3px">${sub}</div>` : ""}
  </div>`;
}

const monthNameMn = m => `${Number(m)}-р сар`;
function financeMonthControls(year, month, onChangeFn, refreshFn) {
  const y = Number(year || today().slice(0, 4));
  const m = Number(month || today().slice(5, 7));
  return `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:8px 10px">
    <span style="font-size:12px;font-weight:800;color:#334155">Хугацаа</span>
    <select class="input" style="width:105px;margin:0;padding:6px 8px;font-size:12px" onchange="${onChangeFn}(this.value,null)">
      ${Array.from({ length: 6 }, (_, i) => 2024 + i).map(v => `<option value="${v}" ${v === y ? "selected" : ""}>${v}</option>`).join("")}
    </select>
    <select class="input" style="width:105px;margin:0;padding:6px 8px;font-size:12px" onchange="${onChangeFn}(null,this.value)">
      ${Array.from({ length: 12 }, (_, i) => i + 1).map(v => `<option value="${v}" ${v === m ? "selected" : ""}>${monthNameMn(v)}</option>`).join("")}
    </select>
    <button class="btn secondary sm" onclick="${refreshFn}()">↻</button>
  </div>`;
}

function currentFinanceImportPeriod() {
  const y = Number(
    _financeTab === "payables" ? (window.finPayYear || today().slice(0, 4)) :
    _financeTab === "receivables" ? (window.finRecvYear || today().slice(0, 4)) :
    today().slice(0, 4)
  );
  const m = Number(
    _financeTab === "payables" ? (window.finPayMonth || today().slice(5, 7)) :
    _financeTab === "receivables" ? (window.finRecvMonth || today().slice(5, 7)) :
    today().slice(5, 7)
  );
  return { year: y, month: m, date: `${y}-${String(m).padStart(2, "0")}-01` };
}

function importPeriodControls(prefix = "si") {
  const p = currentFinanceImportPeriod();
  return `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:10px 12px;margin-bottom:14px">
    <span style="font-size:12px;font-weight:900;color:#92400e">Огноогүй өглөг/авлагыг энэ сард хадгална</span>
    <select id="${prefix}Year" class="input" style="width:95px;margin:0;padding:6px 8px;font-size:12px">
      ${Array.from({ length: 6 }, (_, i) => 2024 + i).map(v => `<option value="${v}" ${v === p.year ? "selected" : ""}>${v}</option>`).join("")}
    </select>
    <select id="${prefix}Month" class="input" style="width:105px;margin:0;padding:6px 8px;font-size:12px">
      ${Array.from({ length: 12 }, (_, i) => i + 1).map(v => `<option value="${v}" ${v === p.month ? "selected" : ""}>${monthNameMn(v)}</option>`).join("")}
    </select>
  </div>`;
}

// ── 1. Санхүүгийн самбар ─────────────────────────────────────

async function fin_dashboard() {
  main.innerHTML = `<div style="text-align:center;padding:60px 0;color:#94a3b8">Уншиж байна...</div>`;
  let s = {};
  try { s = await api("/api/finance-summary"); } catch(e) { s = {}; }

  const bal = Number(s.cash_balance||0);
  const balColor = bal >= 0 ? "#16a34a" : "#dc2626";
  const monthlyBudgetTotal = M_TOTAL_2026.reduce((sum, v) => sum + Number(v || 0), 0);
  const monthlyBudgetPlanHtml = `<div class="table-wrap">${table(
    ["Сар", "Төлөвлөгөөний дүн"],
    [
      ...M_TOTAL_2026.map((amount, i) => [
        `${i + 1}-р сар`,
        `<b style="color:#2563eb">${fmt(amount)}₮</b>`
      ]),
      [
        `<b>Нийт</b>`,
        `<b style="color:#16a34a">${fmt(monthlyBudgetTotal)}₮</b>`
      ]
    ]
  )}</div>`;

  main.innerHTML = `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
    <div>
      <h1 style="margin:0 0 4px">💼 Санхүүгийн самбар</h1>
      <div style="font-size:12px;color:#667085">Нягтлангийн нэгдсэн тойм · ${new Date().toLocaleDateString("mn-MN")}</div>
    </div>
    <button class="btn secondary sm" onclick="fin_dashboard()">↺ Шинэчлэх</button>
  </div>

  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:22px">
    ${statCard("Нийт орлого (журнал)", fmt(s.cash_in)+"₮", "#2563eb")}
    ${statCard("Нийт зарлага (журнал)", fmt(s.cash_out)+"₮", "#dc2626")}
    ${statCard("Мөнгөн хөрөнгийн үлдэгдэл", fmt(s.cash_balance)+"₮", balColor)}
  </div>
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:24px">
    ${statCard("Нийт өглөг (төлөгдөөгүй)", fmt(s.total_payable)+"₮", "#d97706", s.payable_period ? `Сүүлийн сар: ${s.payable_period}` : "Сарын мэдээлэл алга")}
    ${statCard("Нийт авлага (хүлээгдэж буй)", fmt(s.total_receivable)+"₮", "#7c3aed", s.receivable_period ? `Сүүлийн сар: ${s.receivable_period}` : "Сарын мэдээлэл алга")}
    ${statCard("210101 үндсэн цалин", fmt(s.current_salary_210101 ?? s.current_payroll)+"₮", "#0891b2", "Мөнгөн журналын нийлбэр")}
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px">
    <div class="panel">
      <div style="padding:14px 18px;border-bottom:1px solid #e2e6ed;font-weight:700;font-size:14px">📊 2026 оны сарын төсвийн төлөвлөгөө</div>
      <div id="dashJournal" style="padding:14px 18px;font-size:13px;color:#334155">${monthlyBudgetPlanHtml}</div>
    </div>
    <div class="panel">
      <div style="padding:14px 18px;border-bottom:1px solid #e2e6ed;font-weight:700;font-size:14px">⚠️ Хугацаа дууссан өглөгүүд</div>
      <div id="dashPayable" style="padding:14px 18px;font-size:13px;color:#94a3b8">Уншиж байна...</div>
    </div>
  </div>`;

  try {
    const payables = await api("/api/payables");
    const overdue = payables.filter(p => p.status !== "Төлөгдсөн" && p.due_date && p.due_date < today());
    document.getElementById("dashPayable").innerHTML = overdue.length
      ? `<div class="table-wrap">${table(
          ["Нийлүүлэгч","Дүн","Дуусах огноо"],
          overdue.slice(0,6).map(r=>[
            escapeHtml(r.vendor_name),
            `<b style="color:#dc2626">${fmt(r.amount-r.paid_amount)}₮</b>`,
            `<span style="color:#dc2626">${fmtDate(r.due_date)}</span>`])
        )}</div>`
      : "<div style='color:#16a34a'>✓ Хугацаа хэтэрсэн өглөг алга</div>";
  } catch(e) {}
}

// ── 2. Мөнгөн хөрөнгийн журнал ──────────────────────────────

async function cash_journal() {
  let rows = [], prevRows = [], fromDate = today().slice(0,4)+"-01-01", toDate = today();
  const prevDay = d => {
    const dt = new Date(`${d}T00:00:00`);
    dt.setDate(dt.getDate() - 1);
    return dt.toISOString().slice(0, 10);
  };
  const cashSignedAmount = r => (r.txn_type === "Орлого" ? 1 : -1) * Number(r.amount || 0);
  const cashEndingBalance = list => {
    let balance = 0;
    [...list].reverse().forEach(r => {
      const imported = r.imported_balance;
      if (imported !== null && imported !== undefined && imported !== "") balance = Number(imported || 0);
      else balance += cashSignedAmount(r);
    });
    return balance;
  };
  async function load() {
    try {
      const before = prevDay(fromDate);
      [rows, prevRows] = await Promise.all([
        api(`/api/cash-journal?from=${fromDate}&to=${toDate}`).catch(() => []),
        api(`/api/cash-journal?to=${before}`).catch(() => []),
      ]);
    } catch(e) { rows = []; prevRows = []; }
    render();
  }

  function render() {
    const totalIn  = rows.filter(r=>r.txn_type==="Орлого").reduce((s,r)=>s+Number(r.amount),0);
    const totalOut = rows.filter(r=>r.txn_type==="Зарлага").reduce((s,r)=>s+Number(r.amount),0);
    const openingBalance = cashEndingBalance(prevRows);
    let bal = openingBalance;
    [...rows].reverse().forEach(r => {
      const imported = r.imported_balance;
      if (imported !== null && imported !== undefined && imported !== "") bal = Number(imported || 0);
      else bal += cashSignedAmount(r);
      r._balance = bal;
    });
    const closingBalance = bal;
    main.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
      <div>
        <h1 style="margin:0 0 4px">📋 Мөнгөн хөрөнгийн журнал</h1>
        <div style="font-size:12px;color:#667085">Cash journal · Гүйлгээний бүртгэл</div>
      </div>
      ${canEdit() ? `<button class="btn" onclick="openCashForm()">+ Бичилт нэмэх</button>` : ""}
    </div>

    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:18px">
      ${statCard("Эхний үлдэгдэл", fmt(openingBalance)+"₮", openingBalance>=0?"#2563eb":"#dc2626")}
      ${statCard("Нийт орлого", fmt(totalIn)+"₮", "#16a34a")}
      ${statCard("Нийт зарлага", fmt(totalOut)+"₮", "#dc2626")}
      ${statCard("Цэвэр дүн", fmt(totalIn-totalOut)+"₮", totalIn>=totalOut?"#2563eb":"#dc2626")}
      ${statCard("Эцсийн үлдэгдэл", fmt(closingBalance)+"₮", closingBalance>=0?"#16a34a":"#dc2626")}
    </div>

    <div class="panel">
      <div style="display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #e2e6ed;flex-wrap:wrap">
        <span style="font-size:13px;font-weight:700">Шүүлтүүр:</span>
        <input type="date" class="input" style="width:140px;padding:5px 8px;font-size:13px"
          value="${fromDate}" onchange="cjFrom=this.value;cjLoad()">
        <span style="color:#94a3b8">—</span>
        <input type="date" class="input" style="width:140px;padding:5px 8px;font-size:13px"
          value="${toDate}" onchange="cjTo=this.value;cjLoad()">
        ${canEdit() ? `<button class="btn sm" onclick="openSmartImport()">🧠 Smart Import</button>` : ""}
        ${state.me.role==='director' ? `<button class="btn secondary sm" style="color:#dc2626" onclick="clearCashRange('${fromDate}','${toDate}')">🗑 Шүүлтийн мөрүүд устгах</button>` : ""}
        ${state.me.role==='director' ? `<button class="btn secondary sm" style="color:#dc2626;font-weight:700" onclick="clearAllCash()">⚠ Бүх бичилт устгах</button>` : ""}
      </div>
      <div class="table-wrap">
        ${table(
          ["Огноо","Регистер","Байгууллага","Орлого","Зарлага","Үлдэгдэл","Ханш","Валют","Гүйлгээний утга","Харьцсан данс","Мөнгөн гүйлгээ тайлан",""],
          (rows.length || openingBalance) ? [
            ...rows.map((r,i) => {
            const s = v => `<span style="font-size:11px;color:#374151">${escapeHtml(String(v||"—"))}</span>`;
            return [
              fmtDate(r.txn_date),
              s(r.register_no),
              s(r.counterparty),
              r.txn_type==="Орлого"  ? `<b style="color:#16a34a">${fmt(r.amount)}</b>` : `<span style="color:#cbd5e1">—</span>`,
              r.txn_type==="Зарлага" ? `<b style="color:#dc2626">${fmt(r.amount)}</b>` : `<span style="color:#cbd5e1">—</span>`,
              `<b style="color:${Number(r.imported_balance ?? r._balance)>=0?'#16a34a':'#dc2626'}">${fmt(r.imported_balance ?? r._balance)}</b>`,
              Number(r.exchange_rate||1)!==1 ? r.exchange_rate : `<span style="color:#cbd5e1">1</span>`,
              escapeHtml(r.currency||"MNT"),
              s(r.description),
              s(r.corr_account),
              s(r.cash_flow_type),
              canEdit() ? `<button class="btn secondary sm" onclick="editCash(${r.id})" style="margin-right:4px">✏</button>
                ${state.me.role==='director'?`<button class="btn secondary sm" style="color:#dc2626" onclick="delCash(${r.id})">🗑</button>`:""}` : ""
            ];
          }),
          [
            fmtDate(fromDate),
            `<span style="color:#94a3b8">—</span>`,
            `<b style="color:#334155">Эхний үлдэгдэл</b>`,
            `<span style="color:#cbd5e1">—</span>`,
            `<span style="color:#cbd5e1">—</span>`,
            `<b style="color:${openingBalance>=0?'#2563eb':'#dc2626'}">${fmt(openingBalance)}</b>`,
            `<span style="color:#cbd5e1">1</span>`,
            `MNT`,
            `<span style="font-size:11px;color:#64748b">Өмнөх сарын эцсийн үлдэгдэл</span>`,
            `<span style="color:#94a3b8">—</span>`,
            `<span style="color:#94a3b8">—</span>`,
            ``
          ]] : []
        )}
      </div>
    </div>

    <div id="cashFormModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:1000;align-items:center;justify-content:center">
      <div style="background:#fff;border-radius:14px;padding:28px;width:560px;max-height:90vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.2)">
        <div style="font-size:16px;font-weight:800;margin-bottom:18px">📋 Журналын бичилт</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Огноо *</div>
            <input class="input" id="cj_date" type="date" value="${today()}"></div>
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Баримтын дугаар</div>
            <input class="input" id="cj_doc" placeholder="ГТ-2026-001"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Гүйлгээний төрөл *</div>
            <select class="input" id="cj_type">
              <option value="Орлого">Орлого</option>
              <option value="Зарлага">Зарлага</option>
            </select></div>
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Дүн ₮ *</div>
            <input class="input" id="cj_amount" type="number" placeholder="0" min="0"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Регистер (РД)</div>
            <input class="input" id="cj_register" placeholder="УЛ-12345678..."></div>
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Байгуулллага / Харилцагч</div>
            <input class="input" id="cj_counterparty" placeholder="Байгуулллагын нэр..."></div>
        </div>
        <div style="margin-bottom:12px"><div style="font-size:11px;color:#667085;margin-bottom:4px">Гүйлгээний утга *</div>
          <input class="input" id="cj_desc" placeholder="Гүйлгээний тайлбар..."></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Дебит данс</div>
            <input class="input" id="cj_debit" placeholder="1110"></div>
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Кредит данс</div>
            <input class="input" id="cj_credit" placeholder="1210"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Кассч</div>
            <input class="input" id="cj_cashier" placeholder="Нэр..."></div>
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Тэмдэглэл</div>
            <input class="input" id="cj_note" placeholder="..."></div>
        </div>
        <input type="hidden" id="cj_id" value="">
        <div style="display:flex;gap:10px">
          <button class="btn" onclick="saveCash()">Хадгалах</button>
          <button class="btn secondary" onclick="closeCashForm()">Цуцлах</button>
        </div>
      </div>
    </div>`;

    window.cjFrom = fromDate;
    window.cjTo   = toDate;
    window.cjLoad = () => { fromDate = window.cjFrom; toDate = window.cjTo; load(); };
  }

  window.openCashForm = () => {
    document.getElementById("cj_id").value = "";
    document.getElementById("cj_date").value = today();
    document.getElementById("cj_doc").value = "";
    document.getElementById("cj_type").value = "Орлого";
    document.getElementById("cj_amount").value = "";
    document.getElementById("cj_register").value = "";
    document.getElementById("cj_counterparty").value = "";
    document.getElementById("cj_desc").value = "";
    document.getElementById("cj_debit").value = "";
    document.getElementById("cj_credit").value = "";
    document.getElementById("cj_cashier").value = "";
    document.getElementById("cj_note").value = "";
    document.getElementById("cashFormModal").style.display = "flex";
  };
  window.closeCashForm = () => { document.getElementById("cashFormModal").style.display = "none"; };
  window.editCash = (id) => {
    const r = rows.find(x=>x.id===id); if (!r) return;
    document.getElementById("cj_id").value           = r.id;
    document.getElementById("cj_date").value         = r.txn_date||"";
    document.getElementById("cj_doc").value          = r.doc_no||"";
    document.getElementById("cj_type").value         = r.txn_type||"Орлого";
    document.getElementById("cj_amount").value       = r.amount||"";
    document.getElementById("cj_register").value     = r.register_no||"";
    document.getElementById("cj_counterparty").value = r.counterparty||"";
    document.getElementById("cj_desc").value         = r.description||"";
    document.getElementById("cj_debit").value        = r.debit_account||"";
    document.getElementById("cj_credit").value       = r.credit_account||"";
    document.getElementById("cj_cashier").value      = r.cashier||"";
    document.getElementById("cj_note").value         = r.note||"";
    document.getElementById("cashFormModal").style.display = "flex";
  };
  window.saveCash = async () => {
    const id   = document.getElementById("cj_id").value;
    const body = {
      txn_date:       document.getElementById("cj_date").value,
      doc_no:         document.getElementById("cj_doc").value,
      txn_type:       document.getElementById("cj_type").value,
      description:    document.getElementById("cj_desc").value,
      register_no:    document.getElementById("cj_register").value,
      counterparty:   document.getElementById("cj_counterparty").value,
      amount:         document.getElementById("cj_amount").value,
      debit_account:  document.getElementById("cj_debit").value,
      credit_account: document.getElementById("cj_credit").value,
      cashier:        document.getElementById("cj_cashier").value,
      note:           document.getElementById("cj_note").value
    };
    if (!body.txn_date || !body.description || !body.amount) { toast("Шаардлагатай талбар бөглөнө үү"); return; }
    try {
      if (id) await api(`/api/cash-journal/${id}`, { method:"PUT", body:JSON.stringify(body) });
      else    await api("/api/cash-journal",        { method:"POST",body:JSON.stringify(body) });
      toast("Амжилттай хадгаллаа");
      closeCashForm();
      load();
    } catch(e) { toast(e.message); }
  };
  window.delCash = async (id) => {
    if (!confirm("Устгах уу?")) return;
    try { await api(`/api/cash-journal/${id}`, { method:"DELETE" }); toast("Устгагдлаа"); load(); }
    catch(e) { toast(e.message); }
  };
  window.clearCashRange = async (from, to) => {
    if (!confirm(`${from} — ${to} хооронд бүртгэлтэй БҮГД бичлэгийг устгах уу?\nЭнэ үйлдлийг буцаах боломжгүй.`)) return;
    try {
      const r = await api(`/api/cash-journal-range?from=${from}&to=${to}`, { method:"DELETE" });
      toast(`${r.deleted} мөр устгагдлаа`);
      load();
    } catch(e) { toast(e.message); }
  };
  window.clearAllCash = async () => {
    if (!confirm("АНХААРУУЛГА: Мөнгөн хөрөнгийн журналын БҮГД бичилтийг устгах уу?\nЭнэ үйлдлийг буцаах боломжгүй!")) return;
    if (!confirm("Та итгэлтэй байна уу? Бүх мэдээлэл устна.")) return;
    try {
      const r = await api("/api/cash-journal-all", { method:"DELETE" });
      toast(`✅ ${r.deleted} мөр устгагдлаа`);
      load();
    } catch(e) { toast(e.message); }
  };

  load();
}

// ── 3. Өглөг ────────────────────────────────────────────────

async function payables() {
  let rows = [];
  let payYear = Number(window.finPayYear || today().slice(0, 4));
  let payMonth = Number(window.finPayMonth || today().slice(5, 7));
  async function load() {
    try { rows = await api(`/api/payables?year=${payYear}&month=${payMonth}`); } catch(e) { rows = []; }
    render();
  }
  function render() {
    const totalUnpaid = rows.filter(r=>r.status!=="Төлөгдсөн").reduce((s,r)=>s+Number(r.amount-r.paid_amount),0);
    const overdue = rows.filter(r=>r.status!=="Төлөгдсөн" && r.due_date && r.due_date < today()).length;
    main.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
      <div><h1 style="margin:0 0 4px">↓ Өглөгийн бүртгэл</h1>
        <div style="font-size:12px;color:#667085">Accounts Payable · ${payYear} оны ${monthNameMn(payMonth)} · Хийх төлбөрийн хяналт</div></div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end">
        ${financeMonthControls(payYear, payMonth, "setPayablePeriod", "payables")}
        ${canEdit()?`<button class="btn" onclick="openPayableForm()">+ Өглөг бүртгэх</button>`:""}
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px">
      ${statCard("Нийт төлөх өглөг", fmt(totalUnpaid)+"₮", "#d97706")}
      ${statCard("Нийт бичилт", rows.length+" ш", "#2563eb")}
      ${statCard("Хугацаа хэтэрсэн", overdue+" ш", "#dc2626")}
    </div>
    <div class="panel">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #e2e6ed">
        <span style="font-weight:700;font-size:14px">Өглөгийн жагсаалт · ${payYear}-${String(payMonth).padStart(2,"0")}</span>
        ${canEdit() ? `<button class="btn sm" onclick="openSmartImport()">🧠 Smart Import</button>` : ""}
      </div>
      <div class="table-wrap">
        ${table(
          ["#","Нийлүүлэгч","Нэхэмжлэлийн №","Огноо","Дуусах огноо","Нийт дүн","Төлсөн","Үлдэгдэл","Статус",""],
          rows.map((r,i)=>[
            i+1, escapeHtml(r.vendor_name), escapeHtml(r.invoice_no||"—"),
            fmtDate(r.invoice_date), fmtDate(r.due_date),
            fmt(r.amount)+"₮", fmt(r.paid_amount)+"₮",
            `<b>${fmt(r.amount-r.paid_amount)}₮</b>`,
            `<span style="padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700;background:${r.status==='Төлөгдсөн'?'#dcfce7':r.status==='Хэсэгчлэн'?'#fef9c3':'#fee2e2'};color:${r.status==='Төлөгдсөн'?'#16a34a':r.status==='Хэсэгчлэн'?'#ca8a04':'#dc2626'}">${r.status}</span>`,
            canEdit()?`<button class="btn secondary sm" onclick="editPayable(${r.id})">✏️</button>
              ${state.me.role==='director'?`<button class="btn secondary sm" style="color:#dc2626" onclick="delPayable(${r.id})">🗑</button>`:""}`:""
          ])
        )}
      </div>
    </div>
    <div id="payableModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:1000;align-items:center;justify-content:center">
      <div style="background:#fff;border-radius:14px;padding:28px;width:520px;max-height:90vh;overflow:auto">
        <div style="font-size:16px;font-weight:800;margin-bottom:18px">↓ Өглөг бүртгэх</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Нийлүүлэгч *</div><input class="input" id="pay_vendor" placeholder="Байгууллагын нэр"></div>
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Нэхэмжлэлийн №</div><input class="input" id="pay_inv" placeholder="INV-001"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Нэхэмжлэлийн огноо *</div><input class="input" id="pay_idate" type="date" value="${today()}"></div>
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Дуусах огноо</div><input class="input" id="pay_due" type="date"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Нийт дүн ₮ *</div><input class="input" id="pay_amt" type="number" placeholder="0"></div>
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Төлсөн дүн ₮</div><input class="input" id="pay_paid" type="number" placeholder="0"></div>
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Статус</div>
            <select class="input" id="pay_status">
              <option>Төлөгдөөгүй</option><option>Хэсэгчлэн</option><option>Төлөгдсөн</option>
            </select></div>
        </div>
        <div style="margin-bottom:12px"><div style="font-size:11px;color:#667085;margin-bottom:4px">Ангилал</div><input class="input" id="pay_cat" placeholder="Нийлүүлэлт, Үйлчилгээ..."></div>
        <div style="margin-bottom:14px"><div style="font-size:11px;color:#667085;margin-bottom:4px">Тайлбар</div><input class="input" id="pay_desc" placeholder="Дэлгэрэнгүй..."></div>
        <input type="hidden" id="pay_id">
        <div style="display:flex;gap:10px">
          <button class="btn" onclick="savePayable()">Хадгалах</button>
          <button class="btn secondary" onclick="document.getElementById('payableModal').style.display='none'">Цуцлах</button>
        </div>
      </div>
    </div>`;

    window.setPayablePeriod = (year, month) => {
      if (year !== null && year !== undefined) payYear = Number(year);
      if (month !== null && month !== undefined) payMonth = Number(month);
      window.finPayYear = payYear;
      window.finPayMonth = payMonth;
      load();
    };
    window.openPayableForm = () => {
      ["pay_id","pay_vendor","pay_inv","pay_amt","pay_paid","pay_cat","pay_desc"].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=""; });
      document.getElementById("pay_idate").value = today();
      document.getElementById("pay_due").value = "";
      document.getElementById("pay_status").value = "Төлөгдөөгүй";
      document.getElementById("payableModal").style.display = "flex";
    };
    window.editPayable = (id) => {
      const r = rows.find(x=>x.id===id); if (!r) return;
      document.getElementById("pay_id").value = r.id;
      document.getElementById("pay_vendor").value = r.vendor_name||"";
      document.getElementById("pay_inv").value    = r.invoice_no||"";
      document.getElementById("pay_idate").value  = r.invoice_date||"";
      document.getElementById("pay_due").value    = r.due_date||"";
      document.getElementById("pay_amt").value    = r.amount||"";
      document.getElementById("pay_paid").value   = r.paid_amount||"";
      document.getElementById("pay_status").value = r.status||"Төлөгдөөгүй";
      document.getElementById("pay_cat").value    = r.category||"";
      document.getElementById("pay_desc").value   = r.description||"";
      document.getElementById("payableModal").style.display = "flex";
    };
    window.savePayable = async () => {
      const id = document.getElementById("pay_id").value;
      const body = {
        vendor_name:  document.getElementById("pay_vendor").value,
        invoice_no:   document.getElementById("pay_inv").value,
        invoice_date: document.getElementById("pay_idate").value,
        due_date:     document.getElementById("pay_due").value,
        amount:       document.getElementById("pay_amt").value,
        paid_amount:  document.getElementById("pay_paid").value,
        status:       document.getElementById("pay_status").value,
        category:     document.getElementById("pay_cat").value,
        description:  document.getElementById("pay_desc").value
      };
      if (!body.vendor_name || !body.invoice_date || !body.amount) { toast("Шаардлагатай талбар бөглөнө үү"); return; }
      try {
        if (id) await api(`/api/payables/${id}`, { method:"PUT", body:JSON.stringify(body) });
        else    await api("/api/payables",        { method:"POST",body:JSON.stringify(body) });
        toast("Хадгалагдлаа"); document.getElementById("payableModal").style.display = "none"; load();
      } catch(e) { toast(e.message); }
    };
    window.delPayable = async (id) => {
      if (!confirm("Устгах уу?")) return;
      try { await api(`/api/payables/${id}`, { method:"DELETE" }); toast("Устгагдлаа"); load(); }
      catch(e) { toast(e.message); }
    };
  }
  load();
}

// ── 4. Авлага ────────────────────────────────────────────────

async function receivables() {
  let rows = [];
  let recvYear = Number(window.finRecvYear || today().slice(0, 4));
  let recvMonth = Number(window.finRecvMonth || today().slice(5, 7));
  async function load() {
    try { rows = await api(`/api/receivables?year=${recvYear}&month=${recvMonth}`); } catch(e) { rows = []; }
    render();
  }
  function render() {
    const totalPending = rows.filter(r=>r.status!=="Хүлээн авсан").reduce((s,r)=>s+Number(r.amount-r.received_amount),0);
    main.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
      <div><h1 style="margin:0 0 4px">↑ Авлагын бүртгэл</h1>
        <div style="font-size:12px;color:#667085">Accounts Receivable · ${recvYear} оны ${monthNameMn(recvMonth)} · Авах мөнгөний хяналт</div></div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end">
        ${financeMonthControls(recvYear, recvMonth, "setReceivablePeriod", "receivables")}
        ${canEdit()?`<button class="btn" onclick="openRecvForm()">+ Авлага бүртгэх</button>`:""}
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px">
      ${statCard("Нийт авах авлага", fmt(totalPending)+"₮", "#7c3aed")}
      ${statCard("Нийт бичилт", rows.length+" ш", "#2563eb")}
      ${statCard("Хүлээн авсан", rows.filter(r=>r.status==='Хүлээн авсан').length+" ш", "#16a34a")}
    </div>
    <div class="panel">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #e2e6ed">
        <span style="font-weight:700;font-size:14px">Авлагын жагсаалт · ${recvYear}-${String(recvMonth).padStart(2,"0")}</span>
        ${canEdit() ? `<button class="btn sm" onclick="openSmartImport()">🧠 Smart Import</button>` : ""}
      </div>
      <div class="table-wrap">
        ${table(
          ["#","Өртэй тал","Нэхэмжлэлийн №","Огноо","Дуусах огноо","Нийт дүн","Авсан","Үлдэгдэл","Статус",""],
          rows.map((r,i)=>[
            i+1, escapeHtml(r.debtor_name), escapeHtml(r.invoice_no||"—"),
            fmtDate(r.invoice_date), fmtDate(r.due_date),
            fmt(r.amount)+"₮", fmt(r.received_amount)+"₮",
            `<b>${fmt(r.amount-r.received_amount)}₮</b>`,
            `<span style="padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700;background:${r.status==='Хүлээн авсан'?'#dcfce7':r.status==='Хэсэгчлэн'?'#fef9c3':'#ede9fe'};color:${r.status==='Хүлээн авсан'?'#16a34a':r.status==='Хэсэгчлэн'?'#ca8a04':'#7c3aed'}">${r.status}</span>`,
            canEdit()?`<button class="btn secondary sm" onclick="editRecv(${r.id})">✏️</button>
              ${state.me.role==='director'?`<button class="btn secondary sm" style="color:#dc2626" onclick="delRecv(${r.id})">🗑</button>`:""}`:""
          ])
        )}
      </div>
    </div>
    <div id="recvModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:1000;align-items:center;justify-content:center">
      <div style="background:#fff;border-radius:14px;padding:28px;width:520px;max-height:90vh;overflow:auto">
        <div style="font-size:16px;font-weight:800;margin-bottom:18px">↑ Авлага бүртгэх</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Өртэй тал *</div><input class="input" id="rv_debtor" placeholder="Байгууллага/хувь хүн"></div>
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Нэхэмжлэлийн №</div><input class="input" id="rv_inv" placeholder="INV-001"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Огноо *</div><input class="input" id="rv_idate" type="date" value="${today()}"></div>
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Дуусах огноо</div><input class="input" id="rv_due" type="date"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Нийт дүн ₮ *</div><input class="input" id="rv_amt" type="number" placeholder="0"></div>
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Авсан дүн ₮</div><input class="input" id="rv_recv" type="number" placeholder="0"></div>
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Статус</div>
            <select class="input" id="rv_status">
              <option>Хүлээгдэж буй</option><option>Хэсэгчлэн</option><option>Хүлээн авсан</option>
            </select></div>
        </div>
        <div style="margin-bottom:12px"><div style="font-size:11px;color:#667085;margin-bottom:4px">Ангилал</div><input class="input" id="rv_cat" placeholder="..."></div>
        <div style="margin-bottom:14px"><div style="font-size:11px;color:#667085;margin-bottom:4px">Тайлбар</div><input class="input" id="rv_desc" placeholder="..."></div>
        <input type="hidden" id="rv_id">
        <div style="display:flex;gap:10px">
          <button class="btn" onclick="saveRecv()">Хадгалах</button>
          <button class="btn secondary" onclick="document.getElementById('recvModal').style.display='none'">Цуцлах</button>
        </div>
      </div>
    </div>`;

    window.setReceivablePeriod = (year, month) => {
      if (year !== null && year !== undefined) recvYear = Number(year);
      if (month !== null && month !== undefined) recvMonth = Number(month);
      window.finRecvYear = recvYear;
      window.finRecvMonth = recvMonth;
      load();
    };
    window.openRecvForm = () => {
      ["rv_id","rv_debtor","rv_inv","rv_amt","rv_recv","rv_cat","rv_desc"].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=""; });
      document.getElementById("rv_idate").value = today();
      document.getElementById("rv_status").value = "Хүлээгдэж буй";
      document.getElementById("recvModal").style.display = "flex";
    };
    window.editRecv = (id) => {
      const r = rows.find(x=>x.id===id); if (!r) return;
      document.getElementById("rv_id").value     = r.id;
      document.getElementById("rv_debtor").value = r.debtor_name||"";
      document.getElementById("rv_inv").value    = r.invoice_no||"";
      document.getElementById("rv_idate").value  = r.invoice_date||"";
      document.getElementById("rv_due").value    = r.due_date||"";
      document.getElementById("rv_amt").value    = r.amount||"";
      document.getElementById("rv_recv").value   = r.received_amount||"";
      document.getElementById("rv_status").value = r.status||"Хүлээгдэж буй";
      document.getElementById("rv_cat").value    = r.category||"";
      document.getElementById("rv_desc").value   = r.description||"";
      document.getElementById("recvModal").style.display = "flex";
    };
    window.saveRecv = async () => {
      const id = document.getElementById("rv_id").value;
      const body = {
        debtor_name:     document.getElementById("rv_debtor").value,
        invoice_no:      document.getElementById("rv_inv").value,
        invoice_date:    document.getElementById("rv_idate").value,
        due_date:        document.getElementById("rv_due").value,
        amount:          document.getElementById("rv_amt").value,
        received_amount: document.getElementById("rv_recv").value,
        status:          document.getElementById("rv_status").value,
        category:        document.getElementById("rv_cat").value,
        description:     document.getElementById("rv_desc").value
      };
      if (!body.debtor_name || !body.invoice_date || !body.amount) { toast("Шаардлагатай талбар бөглөнө үү"); return; }
      try {
        if (id) await api(`/api/receivables/${id}`, { method:"PUT", body:JSON.stringify(body) });
        else    await api("/api/receivables",        { method:"POST",body:JSON.stringify(body) });
        toast("Хадгалагдлаа"); document.getElementById("recvModal").style.display = "none"; load();
      } catch(e) { toast(e.message); }
    };
    window.delRecv = async (id) => {
      if (!confirm("Устгах уу?")) return;
      try { await api(`/api/receivables/${id}`, { method:"DELETE" }); toast("Устгагдлаа"); load(); }
      catch(e) { toast(e.message); }
    };
  }
  load();
}

// ── 5. Үндсэн хөрөнгийн нягтлан бүртгэл ────────────────────

async function fixed_ledger() {
  let rows = [], assets = [];
  let ledgerYear = Number(window._fixedLedgerYear || new Date().getFullYear());
  let ledgerMonth = Number(window._fixedLedgerMonth || new Date().getMonth() + 1);
  async function load() {
    try { [rows, assets] = await Promise.all([api("/api/fixed-ledger"), api("/api/assets")]); }
    catch(e) { rows = []; assets = []; }
    render();
  }
  function render() {
    const deprMonthKey = `depr_m${ledgerMonth}`;
    const sum = (key, fallback) => rows.reduce((s, r) => s + Number((fallback ? fallback(r) : r[key]) || 0), 0);
    const assetOpening = sum("initial_value");
    const assetIncome = sum("intake_amount");
    const assetExpense = sum("issue_amount_fa");
    const assetFinal = sum("final_amount", r => {
      const stored = Number(r.final_amount || 0);
      if (stored) return stored;
      return Number(r.initial_value || 0) + Number(r.intake_amount || 0) - Number(r.issue_amount_fa || 0)
        + Number(r.improve_income || 0) - Number(r.improve_expense || 0);
    });
    const deprOpeningBase = sum("depr_opening", r => Number(r.depr_opening || r.accumulated_depreciation || 0));
    const deprAdded = sum(deprMonthKey);
    const deprAddedToMonth = rows.reduce((s, r) => {
      let total = 0;
      for (let m = 1; m <= ledgerMonth; m++) total += Number(r[`depr_m${m}`] || 0);
      return s + total;
    }, 0);
    const deprDeducted = sum("depr_deducted");
    const deprFinal = deprOpeningBase + deprAddedToMonth - deprDeducted;
    const bookFinal = assetFinal - deprFinal;
    main.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
      <div><h1 style="margin:0 0 4px">🏢 Үндсэн хөрөнгийн дансны бүртгэл</h1>
        <div style="font-size:12px;color:#667085">Fixed Assets Ledger · Элэгдлийн тооцоо</div></div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end">
        <div style="display:flex;align-items:center;gap:8px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:8px 10px">
          <span style="font-size:12px;font-weight:800;color:#475569">Сар</span>
          <select class="input" style="width:92px;margin:0;padding:6px 8px;font-size:12px" onchange="setFixedLedgerPeriod(this.value,null)">
            ${Array.from({ length: 6 }, (_, i) => 2024 + i).map(y => `<option value="${y}" ${y === ledgerYear ? "selected" : ""}>${y}</option>`).join("")}
          </select>
          <select class="input" style="width:105px;margin:0;padding:6px 8px;font-size:12px" onchange="setFixedLedgerPeriod(null,this.value)">
            ${Array.from({ length: 12 }, (_, i) => i + 1).map(m => `<option value="${m}" ${m === ledgerMonth ? "selected" : ""}>${m}-р сар</option>`).join("")}
          </select>
        </div>
        ${canEdit()?`<button class="btn" onclick="openLedgerForm()">+ Бүртгэл нэмэх</button>`:""}
      </div>
    </div>
    <div style="font-size:12px;font-weight:800;color:#475569;margin:0 0 8px">${ledgerYear} оны ${ledgerMonth}-р сарын үндсэн хөрөнгийн өртгийн хөдөлгөөн</div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:14px">
      ${statCard("Эхний үлдэгдэл", fmt(assetOpening)+"₮", "#2563eb")}
      ${statCard("Орлого", fmt(assetIncome)+"₮", "#16a34a")}
      ${statCard("Зарлага", fmt(assetExpense)+"₮", "#dc2626")}
      ${statCard("Эцсийн үлдэгдэл", fmt(assetFinal)+"₮", "#7c3aed")}
    </div>
    <div style="font-size:12px;font-weight:800;color:#475569;margin:0 0 8px">Элэгдлийн хөдөлгөөн</div>
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:18px">
      ${statCard("Элэгдлийн эхний үлдэгдэл", fmt(deprOpeningBase)+"₮", "#64748b")}
      ${statCard("Нэмэгдсэн элэгдэл", fmt(deprAdded)+"₮", "#d97706", `${ledgerMonth}-р сарын элэгдэл`)}
      ${statCard("Хасагдсан элэгдэл", fmt(deprDeducted)+"₮", "#dc2626")}
      ${statCard("Элэгдлийн эцсийн үлдэгдэл", fmt(deprFinal)+"₮", "#9333ea")}
      ${statCard("Дансны үнэ", fmt(bookFinal)+"₮", bookFinal >= 0 ? "#16a34a" : "#dc2626")}
    </div>
    <div class="panel">
      <div style="display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #e2e6ed;flex-wrap:wrap">
        <span style="font-weight:700;font-size:14px;flex:1">Үндсэн хөрөнгийн дансны жагсаалт</span>
        ${canEdit() ? `<button class="btn sm" onclick="openSmartImport()">🧠 Smart Import</button>` : ""}
        ${state.me.role==='director' ? `<button class="btn secondary sm" style="color:#dc2626;font-weight:700" onclick="clearAllLedger()">⚠ Бүх бичилт устгах</button>` : ""}
      </div>
      <div class="table-wrap" style="overflow-x:auto">
        <table style="border-collapse:collapse;font-size:11px;white-space:nowrap;width:100%">
          <thead style="background:#f1f5f9;position:sticky;top:0;z-index:2">
            <tr style="border-bottom:1px solid #e2e6ed">
              <th rowspan="2" style="padding:6px 8px;border:1px solid #e2e6ed;text-align:center">#</th>
              <th rowspan="2" style="padding:6px 8px;border:1px solid #e2e6ed">Данс</th>
              <th rowspan="2" style="padding:6px 8px;border:1px solid #e2e6ed">Код</th>
              <th rowspan="2" style="padding:6px 8px;border:1px solid #e2e6ed;min-width:160px">Хөрөнгийн нэр</th>
              <th rowspan="2" style="padding:6px 8px;border:1px solid #e2e6ed">х.нэгж</th>
              <th rowspan="2" style="padding:6px 8px;border:1px solid #e2e6ed">Огноо</th>
              <th rowspan="2" style="padding:6px 8px;border:1px solid #e2e6ed">Ашиглах жил</th>
              <th rowspan="2" style="padding:6px 8px;border:1px solid #e2e6ed">Нэгж.Үнэ</th>
              <th colspan="2" style="padding:6px 8px;border:1px solid #e2e6ed;text-align:center;background:#dbeafe">Эхний үлдэгдэл</th>
              <th colspan="2" style="padding:6px 8px;border:1px solid #e2e6ed;text-align:center;background:#dcfce7">Орлого</th>
              <th colspan="2" style="padding:6px 8px;border:1px solid #e2e6ed;text-align:center;background:#fee2e2">Зарлага</th>
              <th colspan="2" style="padding:6px 8px;border:1px solid #e2e6ed;text-align:center;background:#fef9c3">Сайжруулалт</th>
              <th colspan="2" style="padding:6px 8px;border:1px solid #e2e6ed;text-align:center;background:#ede9fe">Эцсийн үлдэгдэл</th>
              <th rowspan="2" style="padding:6px 8px;border:1px solid #e2e6ed;background:#dcfce7;font-weight:800">Үлдэгдэл өртөг</th>
              ${canEdit() ? `<th rowspan="2" style="padding:6px 8px;border:1px solid #e2e6ed"></th>` : ""}
            </tr>
            <tr style="border-bottom:2px solid #cbd5e1">
              <th style="padding:4px 8px;border:1px solid #e2e6ed;background:#dbeafe">Тоо</th>
              <th style="padding:4px 8px;border:1px solid #e2e6ed;background:#dbeafe">Дүн</th>
              <th style="padding:4px 8px;border:1px solid #e2e6ed;background:#dcfce7">Тоо</th>
              <th style="padding:4px 8px;border:1px solid #e2e6ed;background:#dcfce7">Дүн</th>
              <th style="padding:4px 8px;border:1px solid #e2e6ed;background:#fee2e2">Тоо</th>
              <th style="padding:4px 8px;border:1px solid #e2e6ed;background:#fee2e2">Дүн</th>
              <th style="padding:4px 8px;border:1px solid #e2e6ed;background:#fef9c3">Орлого</th>
              <th style="padding:4px 8px;border:1px solid #e2e6ed;background:#fef9c3">Зарлага</th>
              <th style="padding:4px 8px;border:1px solid #e2e6ed;background:#ede9fe">Тоо</th>
              <th style="padding:4px 8px;border:1px solid #e2e6ed;background:#ede9fe">Дүн</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length ? rows.map((r,i) => {
              const n = v => `<td style="padding:4px 8px;border:1px solid #f1f5f9;text-align:right">${v||0 ? fmt(v) : '<span style="color:#cbd5e1">—</span>'}</td>`;
              const s = v => `<td style="padding:4px 8px;border:1px solid #f1f5f9;font-size:11px;color:#374151">${escapeHtml(String(v||"—"))}</td>`;
              return `<tr style="${i%2?'background:#fafafa':''}">
                <td style="padding:4px 8px;border:1px solid #f1f5f9;text-align:center;color:#94a3b8">${i+1}</td>
                ${s(r.account_code)}
                ${s(r.asset_code_manual||r.asset_code)}
                <td style="padding:4px 8px;border:1px solid #f1f5f9;font-weight:600">${escapeHtml(r.asset_name_manual||r.asset_name||"—")}</td>
                ${s(r.unit||"ш")}
                <td style="padding:4px 8px;border:1px solid #f1f5f9">${fmtDate(r.acquisition_date)}</td>
                <td style="padding:4px 8px;border:1px solid #f1f5f9;text-align:right">${r.useful_life_months ? (r.useful_life_months/12).toFixed(1)+" жил" : "—"}</td>
                ${n(r.unit_value)}
                ${n(r.initial_qty)} ${n(r.initial_value)}
                ${n(r.intake_qty)}  ${n(r.intake_amount)}
                ${n(r.issue_qty_fa)}${n(r.issue_amount_fa)}
                ${n(r.improve_income)}${n(r.improve_expense)}
                ${n(r.final_qty)}   ${n(r.final_amount)}
                <td style="padding:4px 8px;border:1px solid #f1f5f9;text-align:right;background:#f0fdf4;font-weight:800;color:#16a34a">${fmt(r.book_value)}₮</td>
                ${canEdit() ? `<td style="padding:4px 8px;border:1px solid #f1f5f9">
                  <button class="btn secondary sm" onclick="editLedger(${r.id})">✏️</button>
                  ${state.me.role==='director'?`<button class="btn secondary sm" style="color:#dc2626" onclick="delLedger(${r.id})">🗑</button>`:""}
                </td>` : ""}
              </tr>`;
            }).join("") : `<tr><td colspan="100" style="padding:24px;text-align:center;color:#94a3b8">Мэдээлэл алга</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
    <div id="ledgerModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:1000;align-items:center;justify-content:center">
      <div style="background:#fff;border-radius:14px;padding:28px;width:560px;max-height:90vh;overflow:auto">
        <div style="font-size:16px;font-weight:800;margin-bottom:18px">🏢 Үндсэн хөрөнгийн бүртгэл</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Данс</div><input class="input" id="lg_acct" placeholder="31211..."></div>
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Код</div><input class="input" id="lg_code" placeholder="A-001..."></div>
        </div>
        <div style="margin-bottom:12px"><div style="font-size:11px;color:#667085;margin-bottom:4px">Хөрөнгийн нэр *</div><input class="input" id="lg_name" placeholder="Хөрөнгийн нэр..."></div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Нэгж</div><input class="input" id="lg_unit" placeholder="ш"></div>
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Нэгж үнэ ₮</div><input class="input" id="lg_uval" type="number" placeholder="0"></div>
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Анхны тоо</div><input class="input" id="lg_qty" type="number" placeholder="0"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Авсан огноо *</div><input class="input" id="lg_date" type="date" value="${today()}"></div>
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Анхны өртөг ₮ *</div><input class="input" id="lg_init" type="number" placeholder="0"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Ашиглах хугацаа (сар)</div><input class="input" id="lg_life" type="number" placeholder="120" value="120"></div>
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Элэгдлийн арга</div>
            <select class="input" id="lg_method">
              <option>Шулуун шугам</option><option>Буурах үлдэгдэл</option><option>Нийлбэр жил</option>
            </select></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Хуримт. элэгдэл ₮</div><input class="input" id="lg_accum" type="number" placeholder="0"></div>
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Дансны үнэ ₮</div><input class="input" id="lg_book" type="number" placeholder="0"></div>
        </div>
        <div style="margin-bottom:14px"><div style="font-size:11px;color:#667085;margin-bottom:4px">Тэмдэглэл</div><input class="input" id="lg_note" placeholder="..."></div>
        <input type="hidden" id="lg_id">
        <div style="display:flex;gap:10px">
          <button class="btn" onclick="saveLedger()">Хадгалах</button>
          <button class="btn secondary" onclick="document.getElementById('ledgerModal').style.display='none'">Цуцлах</button>
        </div>
      </div>
    </div>`;

    window.openLedgerForm = () => {
      ["lg_id","lg_acct","lg_code","lg_name","lg_unit","lg_uval","lg_qty","lg_init","lg_accum","lg_book","lg_note"].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=""; });
      document.getElementById("lg_date").value   = today();
      document.getElementById("lg_life").value   = "120";
      document.getElementById("lg_method").value = "Шулуун шугам";
      document.getElementById("ledgerModal").style.display = "flex";
    };
    window.setFixedLedgerPeriod = (year, month) => {
      if (year !== null && year !== undefined) ledgerYear = Number(year);
      if (month !== null && month !== undefined) ledgerMonth = Number(month);
      window._fixedLedgerYear = ledgerYear;
      window._fixedLedgerMonth = ledgerMonth;
      render();
    };
    window.editLedger = (id) => {
      const r = rows.find(x=>x.id===id); if (!r) return;
      document.getElementById("lg_id").value     = r.id;
      document.getElementById("lg_acct").value   = r.account_code||"";
      document.getElementById("lg_code").value   = r.asset_code_manual||r.asset_code||"";
      document.getElementById("lg_name").value   = r.asset_name_manual||r.asset_name||"";
      document.getElementById("lg_unit").value   = r.unit||"ш";
      document.getElementById("lg_uval").value   = r.unit_value||"";
      document.getElementById("lg_qty").value    = r.initial_qty||"";
      document.getElementById("lg_date").value   = r.acquisition_date||"";
      document.getElementById("lg_init").value   = r.initial_value||"";
      document.getElementById("lg_life").value   = r.useful_life_months||"120";
      document.getElementById("lg_method").value = r.depreciation_method||"Шулуун шугам";
      document.getElementById("lg_accum").value  = r.accumulated_depreciation||"";
      document.getElementById("lg_book").value   = r.book_value||"";
      document.getElementById("lg_note").value   = r.note||"";
      document.getElementById("ledgerModal").style.display = "flex";
    };
    window.saveLedger = async () => {
      const id = document.getElementById("lg_id").value;
      const body = {
        account_code:            document.getElementById("lg_acct").value,
        asset_code_manual:       document.getElementById("lg_code").value,
        asset_name_manual:       document.getElementById("lg_name").value,
        unit:                    document.getElementById("lg_unit").value||"ш",
        unit_value:              document.getElementById("lg_uval").value,
        initial_qty:             document.getElementById("lg_qty").value,
        acquisition_date:        document.getElementById("lg_date").value,
        initial_value:           document.getElementById("lg_init").value,
        useful_life_months:      document.getElementById("lg_life").value,
        depreciation_method:     document.getElementById("lg_method").value,
        accumulated_depreciation:document.getElementById("lg_accum").value,
        book_value:              document.getElementById("lg_book").value,
        note:                    document.getElementById("lg_note").value
      };
      if (!body.acquisition_date || !body.initial_value) { toast("Огноо болон анхны өртгийг оруулна уу"); return; }
      try {
        if (id) await api(`/api/fixed-ledger/${id}`, { method:"PUT", body:JSON.stringify(body) });
        else    await api("/api/fixed-ledger",        { method:"POST",body:JSON.stringify(body) });
        toast("Хадгалагдлаа"); document.getElementById("ledgerModal").style.display = "none"; load();
      } catch(e) { toast(e.message); }
    };
    window.delLedger = async (id) => {
      if (!confirm("Устгах уу?")) return;
      try { await api(`/api/fixed-ledger/${id}`, { method:"DELETE" }); toast("Устгагдлаа"); load(); }
      catch(e) { toast(e.message); }
    };
    window.clearAllLedger = async () => {
      if (!confirm("АНХААРУУЛГА: Үндсэн хөрөнгийн бүртгэлийн БҮГД мөрүүдийг устгах уу?\nЭнэ үйлдлийг буцаах боломжгүй!")) return;
      if (!confirm("Та итгэлтэй байна уу? Бүх мэдээлэл устна.")) return;
      try {
        const r = await api("/api/fixed-ledger-all", { method:"DELETE" });
        toast(`✅ ${r.deleted} мөр устгагдлаа`);
        load();
      } catch(e) { toast(e.message); }
    };
  }
  load();
}

// ── 6. Цалингийн тооцоо ─────────────────────────────────────

async function payroll() {
  const now = new Date();
  let selYear = now.getFullYear(), selMonth = now.getMonth()+1;
  let rows = [], users = state.users || [];

  async function load() {
    try { rows = await api(`/api/payroll?year=${selYear}&month=${selMonth}`); } catch(e) { rows = []; }
    render();
  }
  function render() {
    const totalNet = rows.reduce((s,r)=>s+Number(r.net_salary),0);
    const totalBase = rows.reduce((s,r)=>s+Number(r.base_salary),0);
    main.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
      <div><h1 style="margin:0 0 4px">👷 Цалингийн тооцоо</h1>
        <div style="font-size:12px;color:#667085">Payroll · Ажлын цагийн тооцоо</div></div>
      ${canEdit()||state.me.role==='hr'?`<button class="btn" onclick="openPayrollForm()">+ Тооцоо нэмэх</button>`:""}
    </div>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
      <span style="font-size:13px;font-weight:600">Сар:</span>
      <select class="input" style="width:80px;padding:5px 8px;font-size:13px" onchange="window._prYear=parseInt(this.value);prLoad()">
        ${[2024,2025,2026,2027].map(y=>`<option ${y===selYear?'selected':''}>${y}</option>`).join("")}
      </select>
      <select class="input" style="width:80px;padding:5px 8px;font-size:13px" onchange="window._prMonth=parseInt(this.value);prLoad()">
        ${Array.from({length:12},(_,i)=>`<option value="${i+1}" ${i+1===selMonth?'selected':''}>${i+1}-р сар</option>`).join("")}
      </select>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px">
      ${statCard("Нийт үндсэн цалин", fmt(totalBase)+"₮", "#2563eb")}
      ${statCard("Нийт олгох цалин", fmt(totalNet)+"₮", "#16a34a")}
      ${statCard("Тооцосон ажилтан", rows.length+" хүн", "#7c3aed")}
    </div>
    <div class="panel">
      <div style="padding:12px 16px;border-bottom:1px solid #e2e6ed;font-weight:700;font-size:14px">${selYear} оны ${selMonth}-р сарын цалин</div>
      <div class="table-wrap">
        ${table(
          ["#","Ажилтан","Хэлтэс","Ажилласан өдөр","Илүү цаг","Чөлөөт өдөр","Хожим ирсэн","Үндсэн цалин","Илүү цагийн нэмэгдэл","Хасалт","Урамшуулал","Олгох цалин","Статус",""],
          rows.map((r,i)=>[
            i+1,
            escapeHtml(r.full_name||"—"),
            escapeHtml(r.department||"—"),
            r.work_days, r.overtime_hours, r.absent_days, r.late_times,
            fmt(r.base_salary)+"₮",
            fmt(r.overtime_pay)+"₮",
            `<span style="color:#dc2626">${fmt(r.deductions)}₮</span>`,
            `<span style="color:#16a34a">${fmt(r.bonuses)}₮</span>`,
            `<b>${fmt(r.net_salary)}₮</b>`,
            `<span style="padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700;background:${r.status==='Олгосон'?'#dcfce7':r.status==='Батлагдсан'?'#dbeafe':'#fef9c3'};color:${r.status==='Олгосон'?'#16a34a':r.status==='Батлагдсан'?'#2563eb':'#ca8a04'}">${r.status}</span>`,
            canEdit()||state.me.role==='hr'?`<button class="btn secondary sm" onclick="editPayroll(${r.id})">✏️</button>
              ${canEdit()?`<button class="btn secondary sm" style="color:#dc2626" onclick="delPayroll(${r.id})">🗑</button>`:""}`:""
          ])
        )}
      </div>
    </div>

    <div id="payrollModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:1000;align-items:center;justify-content:center">
      <div style="background:#fff;border-radius:14px;padding:28px;width:580px;max-height:90vh;overflow:auto">
        <div style="font-size:16px;font-weight:800;margin-bottom:18px">👷 Цалин тооцоо</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Ажилтан *</div>
            <select class="input" id="pr_user">
              <option value="">— Сонгох —</option>
              ${users.map(u=>`<option value="${u.id}">${escapeHtml(u.full_name)}</option>`).join("")}
            </select></div>
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Жил *</div><input class="input" id="pr_year" type="number" value="${selYear}"></div>
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Сар *</div><input class="input" id="pr_month" type="number" value="${selMonth}" min="1" max="12"></div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:12px">
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Ажилласан өдөр</div><input class="input" id="pr_wdays" type="number" placeholder="22"></div>
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Илүү цаг</div><input class="input" id="pr_ot" type="number" placeholder="0"></div>
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Чөлөөт өдөр</div><input class="input" id="pr_absent" type="number" placeholder="0"></div>
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Хожим ирсэн</div><input class="input" id="pr_late" type="number" placeholder="0"></div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:12px">
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Үндсэн цалин ₮</div><input class="input" id="pr_base" type="number" placeholder="0" oninput="calcNet()"></div>
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Илүү цагийн нэмэгдэл</div><input class="input" id="pr_otpay" type="number" placeholder="0" oninput="calcNet()"></div>
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Хасалт ₮</div><input class="input" id="pr_deduct" type="number" placeholder="0" oninput="calcNet()"></div>
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Урамшуулал ₮</div><input class="input" id="pr_bonus" type="number" placeholder="0" oninput="calcNet()"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
          <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:12px;text-align:center">
            <div style="font-size:11px;color:#16a34a;margin-bottom:4px">ОЛГОХ ЦАЛИН</div>
            <div style="font-size:24px;font-weight:800;color:#16a34a" id="pr_net_display">0₮</div>
            <input type="hidden" id="pr_net">
          </div>
          <div><div style="font-size:11px;color:#667085;margin-bottom:4px">Статус</div>
            <select class="input" id="pr_status">
              <option>Тооцсон</option><option>Батлагдсан</option><option>Олгосон</option>
            </select>
            <div style="margin-top:8px"><div style="font-size:11px;color:#667085;margin-bottom:4px">Тэмдэглэл</div><input class="input" id="pr_note" placeholder="..."></div>
          </div>
        </div>
        <input type="hidden" id="pr_id">
        <div style="display:flex;gap:10px">
          <button class="btn" onclick="savePayroll()">Хадгалах</button>
          <button class="btn secondary" onclick="document.getElementById('payrollModal').style.display='none'">Цуцлах</button>
        </div>
      </div>
    </div>`;

    window._prYear  = selYear;
    window._prMonth = selMonth;
    window.prLoad   = () => { selYear=window._prYear; selMonth=window._prMonth; load(); };
    window.calcNet  = () => {
      const base   = Number(document.getElementById("pr_base")?.value||0);
      const otpay  = Number(document.getElementById("pr_otpay")?.value||0);
      const deduct = Number(document.getElementById("pr_deduct")?.value||0);
      const bonus  = Number(document.getElementById("pr_bonus")?.value||0);
      const net    = base + otpay + bonus - deduct;
      const d = document.getElementById("pr_net_display");
      const h = document.getElementById("pr_net");
      if (d) d.textContent = fmt(net)+"₮";
      if (h) h.value = net;
    };
    window.openPayrollForm = () => {
      ["pr_id","pr_wdays","pr_ot","pr_absent","pr_late","pr_base","pr_otpay","pr_deduct","pr_bonus","pr_note"].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=""; });
      document.getElementById("pr_user").value   = "";
      document.getElementById("pr_year").value   = selYear;
      document.getElementById("pr_month").value  = selMonth;
      document.getElementById("pr_status").value = "Тооцсон";
      document.getElementById("pr_net_display").textContent = "0₮";
      document.getElementById("pr_net").value = "0";
      document.getElementById("payrollModal").style.display = "flex";
    };
    window.editPayroll = (id) => {
      const r = rows.find(x=>x.id===id); if (!r) return;
      document.getElementById("pr_id").value     = r.id;
      document.getElementById("pr_user").value   = r.user_id||"";
      document.getElementById("pr_year").value   = r.year||"";
      document.getElementById("pr_month").value  = r.month||"";
      document.getElementById("pr_wdays").value  = r.work_days||"";
      document.getElementById("pr_ot").value     = r.overtime_hours||"";
      document.getElementById("pr_absent").value = r.absent_days||"";
      document.getElementById("pr_late").value   = r.late_times||"";
      document.getElementById("pr_base").value   = r.base_salary||"";
      document.getElementById("pr_otpay").value  = r.overtime_pay||"";
      document.getElementById("pr_deduct").value = r.deductions||"";
      document.getElementById("pr_bonus").value  = r.bonuses||"";
      document.getElementById("pr_net").value    = r.net_salary||"";
      document.getElementById("pr_net_display").textContent = fmt(r.net_salary)+"₮";
      document.getElementById("pr_status").value = r.status||"Тооцсон";
      document.getElementById("pr_note").value   = r.note||"";
      document.getElementById("payrollModal").style.display = "flex";
    };
    window.savePayroll = async () => {
      const id = document.getElementById("pr_id").value;
      const body = {
        user_id:        document.getElementById("pr_user").value,
        year:           document.getElementById("pr_year").value,
        month:          document.getElementById("pr_month").value,
        work_days:      document.getElementById("pr_wdays").value,
        overtime_hours: document.getElementById("pr_ot").value,
        absent_days:    document.getElementById("pr_absent").value,
        late_times:     document.getElementById("pr_late").value,
        base_salary:    document.getElementById("pr_base").value,
        overtime_pay:   document.getElementById("pr_otpay").value,
        deductions:     document.getElementById("pr_deduct").value,
        bonuses:        document.getElementById("pr_bonus").value,
        net_salary:     document.getElementById("pr_net").value,
        status:         document.getElementById("pr_status").value,
        note:           document.getElementById("pr_note").value
      };
      if (!body.user_id || !body.year || !body.month) { toast("Ажилтан болон огноог сонгоно уу"); return; }
      try {
        await api("/api/payroll", { method:"POST", body:JSON.stringify(body) });
        toast("Хадгалагдлаа"); document.getElementById("payrollModal").style.display = "none"; load();
      } catch(e) { toast(e.message); }
    };
    window.delPayroll = async (id) => {
      if (!confirm("Устгах уу?")) return;
      try { await api(`/api/payroll/${id}`, { method:"DELETE" }); toast("Устгагдлаа"); load(); }
      catch(e) { toast(e.message); }
    };
  }
  load();
}

// ── Бараа материал / Төсөв / Гүйцэтгэл ───────────────────────

async function fin_materials() {
  main.innerHTML = `<div style="text-align:center;padding:60px 0;color:#94a3b8">Уншиж байна...</div>`;
  let summary = {}, rows = [];
  try {
    [summary, rows] = await Promise.all([
      api("/api/nyarav/summary").catch(() => ({})),
      api("/api/nyarav/balance").catch(() => [])
    ]);
  } catch(e) {}
  const totalValue = Number(summary.totalValue?.total || 0);
  const lowCount = Array.isArray(summary.lowStock) ? summary.lowStock.length : 0;
  const incomeTotal = Number(summary.monthIncome?.total || 0);
  const expenseTotal = Number(summary.monthExpense?.total || 0);
  main.innerHTML = `
  <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:18px">
    <div>
      <h1 style="margin:0 0 4px">📦 Бараа материал</h1>
      <div style="font-size:12px;color:#667085">Няравын бараа материалын үлдэгдэл, орлого зарлагын санхүүгийн тойм</div>
    </div>
    <button class="btn secondary sm" onclick="fin_materials()">↻ Шинэчлэх</button>
  </div>
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px">
    ${statCard("Нийт материал", fmt(summary.totalItems?.total || rows.length), "#2563eb")}
    ${statCard("Үлдэгдлийн дүн", fmt(totalValue)+"₮", "#16a34a")}
    ${statCard("Бага үлдэгдэл", fmt(lowCount), lowCount ? "#dc2626" : "#64748b")}
    ${statCard("Сарын зарлага", fmt(expenseTotal)+"₮", "#d97706", summary.month || "")}
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:18px">
    ${statCard("Сарын орлого", fmt(incomeTotal)+"₮", "#0891b2", "Няравын орлогын гүйлгээ")}
    ${statCard("Сарын цэвэр хөдөлгөөн", fmt(incomeTotal - expenseTotal)+"₮", incomeTotal >= expenseTotal ? "#16a34a" : "#dc2626")}
  </div>
  <div class="panel">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #e2e6ed;gap:10px;flex-wrap:wrap">
      <span style="font-size:14px;font-weight:800">Материалын үлдэгдлийн бүртгэл</span>
      <input placeholder="🔍 Хайх..." oninput="filterFinanceMaterialTable(this.value)"
        style="padding:7px 12px;border:1px solid #e2e6ed;border-radius:8px;font-size:12px;width:220px;outline:none">
    </div>
    <div style="overflow:auto">
      <table id="finMaterialTable" style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0">
          <th style="padding:9px;text-align:left">Код</th>
          <th style="padding:9px;text-align:left">Материал</th>
          <th style="padding:9px;text-align:left">Ангилал</th>
          <th style="padding:9px;text-align:right">Үлдэгдэл</th>
          <th style="padding:9px;text-align:left">Нэгж</th>
          <th style="padding:9px;text-align:right">Нэгж үнэ</th>
          <th style="padding:9px;text-align:right">Нийт дүн</th>
          <th style="padding:9px;text-align:center">Төлөв</th>
        </tr></thead>
        <tbody>
          ${rows.length ? rows.map(r => {
            const qty = Number(r.current_qty || 0);
            const price = Number(r.unit_price || 0);
            const low = Number(r.min_qty || 0) > 0 && qty <= Number(r.min_qty || 0);
            return `<tr style="border-bottom:1px solid #f1f5f9;background:${low ? "#fff7ed" : "#fff"}">
              <td style="padding:9px;color:#64748b">${escapeHtml(r.category_code || "")}</td>
              <td style="padding:9px;font-weight:800;color:#0f172a">${escapeHtml(r.name || "")}</td>
              <td style="padding:9px;color:#64748b">${escapeHtml(r.category_name || "—")}</td>
              <td style="padding:9px;text-align:right;font-weight:900;color:${low ? "#dc2626" : "#0f172a"}">${fmt(qty)}</td>
              <td style="padding:9px;color:#64748b">${escapeHtml(r.unit || "")}</td>
              <td style="padding:9px;text-align:right">${fmt(price)}₮</td>
              <td style="padding:9px;text-align:right;font-weight:900;color:#16a34a">${fmt(qty * price)}₮</td>
              <td style="padding:9px;text-align:center">${low ? `<span class="pill bad">Бага</span>` : `<span class="pill ok">Хэвийн</span>`}</td>
            </tr>`;
          }).join("") : `<tr><td colspan="8" style="text-align:center;padding:28px;color:#94a3b8">Бараа материал бүртгэгдээгүй байна</td></tr>`}
        </tbody>
      </table>
    </div>
  </div>`;
}

function filterFinanceMaterialTable(value = "") {
  const q = String(value || "").toLowerCase();
  document.querySelectorAll("#finMaterialTable tbody tr").forEach(tr => {
    tr.style.display = tr.textContent.toLowerCase().includes(q) ? "" : "none";
  });
}

async function fin_budget() {
  const total = FIN_BUDGET_PLAN_2026.find(r => r.code === "2")?.plan || 0;
  main.innerHTML = `
  <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:18px">
    <div>
      <h1 style="margin:0 0 4px">📊 Төсөв</h1>
      <div style="font-size:12px;color:#667085">2026 оны батлагдсан төсвийн сарын хуваарь</div>
    </div>
    ${statCard("Нийт төсөв", fmt(total)+"₮", "#2563eb")}
  </div>
  <div class="panel">
    <div style="padding:14px 18px;border-bottom:1px solid #e2e6ed;font-weight:800">Төсвийн задаргаа</div>
    <div style="overflow:auto">
      <table style="width:100%;border-collapse:collapse;font-size:11px;min-width:1180px">
        <thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0">
          <th style="padding:8px;text-align:left">Код</th>
          <th style="padding:8px;text-align:left">Төсвийн ангилал</th>
          ${Array.from({ length: 12 }, (_, i) => `<th style="padding:8px;text-align:right">${i + 1}-р сар</th>`).join("")}
          <th style="padding:8px;text-align:right">Нийт</th>
        </tr></thead>
        <tbody>
          ${FIN_BUDGET_PLAN_2026.map(r => {
            const isGroup = r.level <= 1;
            return `<tr style="border-bottom:1px solid #f1f5f9;background:${isGroup ? "#f8fafc" : "#fff"}">
              <td style="padding:8px;font-weight:900;color:#475569">${escapeHtml(r.code)}</td>
              <td style="padding:8px;font-weight:${isGroup ? 900 : 600};padding-left:${8 + r.level * 14}px;color:#0f172a">${escapeHtml(r.name)}</td>
              ${r.monthly.map(v => `<td style="padding:8px;text-align:right;white-space:nowrap">${fmt(v)}₮</td>`).join("")}
              <td style="padding:8px;text-align:right;font-weight:900;color:#2563eb;white-space:nowrap">${fmt(r.plan)}₮</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
  </div>`;
}

async function fin_performance() {
  const now = new Date();
  const from = window._finPerfFrom || `${now.getFullYear()}-01-01`;
  const to = window._finPerfTo || today();
  main.innerHTML = `<div style="text-align:center;padding:60px 0;color:#94a3b8">Уншиж байна...</div>`;
  let cashRows = [];
  try { cashRows = await api(`/api/cash-journal?from=${from}&to=${to}`); } catch(e) {}
  const perf = finBudgetPerformanceRows(cashRows, from, to);
  const rows = perf.rows;
  const plannedTotal = rows.find(r => r.code === "2")?.plan || rows.reduce((s, r) => s + r.plan, 0);
  const actualTotal = rows.find(r => r.code === "2")?.actual || perf.expenseRows.reduce((s, r) => s + Number(r.amount || 0), 0);
  const topRows = rows.filter(r => r.level === 1 && r.actual > 0);
  main.innerHTML = `
  <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:18px">
    <div>
      <h1 style="margin:0 0 4px">⚙️ Гүйцэтгэл</h1>
      <div style="font-size:12px;color:#667085">Мөнгөн журналын зарлагыг төсвийн кодоор тулгасан тайлан</div>
    </div>
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:8px 10px">
      <input type="date" class="input" value="${from}" style="width:150px;padding:7px 10px;font-size:13px" onchange="window._finPerfFrom=this.value; fin_performance()">
      <span style="color:#94a3b8">—</span>
      <input type="date" class="input" value="${to}" style="width:150px;padding:7px 10px;font-size:13px" onchange="window._finPerfTo=this.value; fin_performance()">
    </div>
  </div>
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px">
    ${statCard("Батлагдсан төсөв", fmt(plannedTotal)+"₮", "#2563eb")}
    ${statCard("Гүйцэтгэл", fmt(actualTotal)+"₮", "#16a34a")}
    ${statCard("Үлдэгдэл", fmt(plannedTotal - actualTotal)+"₮", plannedTotal >= actualTotal ? "#7c3aed" : "#dc2626")}
  </div>
  <div class="panel" style="margin-bottom:16px">
    <div style="padding:14px 18px;border-bottom:1px solid #e2e6ed;font-weight:800">Ангиллаар гүйцэтгэл</div>
    <div style="padding:16px 18px">
      ${topRows.length ? topRows.map(r => {
        const pct = actualTotal ? Math.round(r.actual / actualTotal * 100) : 0;
        return `<div style="display:grid;grid-template-columns:minmax(220px,1fr) 3fr 120px;gap:10px;align-items:center;margin-bottom:10px">
          <div style="font-size:12px;font-weight:800;color:#0f172a">${escapeHtml(r.name)}</div>
          <div style="height:12px;background:#e2e8f0;border-radius:999px;overflow:hidden"><div style="width:${Math.min(pct,100)}%;height:100%;background:#2563eb"></div></div>
          <div style="font-size:12px;font-weight:900;color:#2563eb;text-align:right">${fmt(r.actual)}₮</div>
        </div>`;
      }).join("") : `<div style="font-size:12px;color:#94a3b8;text-align:center;padding:20px">Зарлагын гүйцэтгэл бүртгэгдээгүй байна</div>`}
    </div>
  </div>
  <div class="panel">
    <div style="padding:14px 18px;border-bottom:1px solid #e2e6ed;font-weight:800">Төсөв vs гүйцэтгэл</div>
    <div style="overflow:auto">
      <table style="width:100%;border-collapse:collapse;font-size:11px;min-width:860px">
        <thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0">
          <th style="padding:8px;text-align:left">Код</th><th style="padding:8px;text-align:left">Ангилал</th>
          <th style="padding:8px;text-align:right">Төсөв</th><th style="padding:8px;text-align:right">Гүйцэтгэл</th>
          <th style="padding:8px;text-align:right">Зөрүү</th><th style="padding:8px;text-align:center">%</th><th style="padding:8px;text-align:center">Гүйлгээ</th>
        </tr></thead>
        <tbody>
          ${rows.map(r => {
            const pct = r.plan ? Math.round(r.actual / r.plan * 100) : (r.actual ? 100 : 0);
            const isGroup = r.level <= 1;
            return `<tr style="border-bottom:1px solid #f1f5f9;background:${isGroup ? "#f8fafc" : "#fff"}">
              <td style="padding:8px;font-weight:900;color:#475569">${escapeHtml(r.code)}</td>
              <td style="padding:8px;font-weight:${isGroup ? 900 : 600};padding-left:${8 + r.level * 14}px;color:#0f172a">${escapeHtml(r.name)}</td>
              <td style="padding:8px;text-align:right;white-space:nowrap">${fmt(r.plan)}₮</td>
              <td style="padding:8px;text-align:right;font-weight:900;color:#16a34a;white-space:nowrap">${fmt(r.actual)}₮</td>
              <td style="padding:8px;text-align:right;font-weight:900;color:${r.diff >= 0 ? "#2563eb" : "#dc2626"};white-space:nowrap">${fmt(r.diff)}₮</td>
              <td style="padding:8px;text-align:center;font-weight:900;color:${pct > 100 ? "#dc2626" : "#2563eb"}">${pct}%</td>
              <td style="padding:8px;text-align:center;color:#64748b">${r.count}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
    ${perf.unmatched.length ? `<div style="font-size:12px;color:#dc2626;padding:10px 18px">Код таараагүй ${perf.unmatched.length} зарлагын мөр байна.</div>` : ""}
  </div>`;
}

async function fin_budget_performance() {
  const now = new Date();
  const from = window._finBudgetPerfFrom || `${now.getFullYear()}-01-01`;
  const to = window._finBudgetPerfTo || today();
  main.innerHTML = `<div style="text-align:center;padding:60px 0;color:#94a3b8">Уншиж байна...</div>`;

  let cashRows = [];
  try { cashRows = await api(`/api/cash-journal?from=${from}&to=${to}`); } catch(e) {}

  const incomeRows = cashRows.filter(r => r.txn_type === "Орлого");
  const expenseRows = cashRows.filter(r => r.txn_type === "Зарлага");
  const incomeTotal = incomeRows.reduce((s, r) => s + Number(r.amount || 0), 0);
  const expenseTotal = expenseRows.reduce((s, r) => s + Number(r.amount || 0), 0);
  const incomeByType = Object.values(incomeRows.reduce((acc, r) => {
    const key = r.cash_flow_type || r.econ_category || r.corr_account || r.purpose || "Ангилалгүй орлого";
    if (!acc[key]) acc[key] = { name: key, amount: 0, count: 0 };
    acc[key].amount += Number(r.amount || 0);
    acc[key].count += 1;
    return acc;
  }, {})).sort((a, b) => b.amount - a.amount);

  const perf = finBudgetPerformanceRows(cashRows, from, to);
  const rows = perf.rows;
  const plannedTotal = rows.find(r => r.code === "2")?.plan || rows.reduce((s, r) => s + r.plan, 0);
  const actualTotal = rows.find(r => r.code === "2")?.actual || expenseTotal;
  const topExpenseRows = rows.filter(r => r.level === 1 && r.actual > 0);

  main.innerHTML = `
  <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:18px">
    <div>
      <h1 style="margin:0 0 4px">📊 Төсөв гүйцэтгэл</h1>
      <div style="font-size:12px;color:#667085">Орлого, зарлага тусдаа · ${from} - ${to}</div>
    </div>
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:8px 10px">
      <input type="date" class="input" value="${from}" style="width:150px;padding:7px 10px;font-size:13px" onchange="window._finBudgetPerfFrom=this.value; fin_budget_performance()">
      <span style="color:#94a3b8">—</span>
      <input type="date" class="input" value="${to}" style="width:150px;padding:7px 10px;font-size:13px" onchange="window._finBudgetPerfTo=this.value; fin_budget_performance()">
    </div>
  </div>

  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
    ${statCard("Нийт орлого", fmt(incomeTotal)+"₮", "#16a34a", `${incomeRows.length} гүйлгээ`)}
    ${statCard("Батлагдсан зарлагын төсөв", fmt(plannedTotal)+"₮", "#2563eb")}
    ${statCard("Зарлагын гүйцэтгэл", fmt(actualTotal)+"₮", "#dc2626", `${expenseRows.length} гүйлгээ`)}
    ${statCard("Зарлагын үлдэгдэл", fmt(plannedTotal - actualTotal)+"₮", plannedTotal >= actualTotal ? "#7c3aed" : "#dc2626")}
  </div>

  <div style="display:grid;grid-template-columns:minmax(360px, 1fr) minmax(520px, 1.4fr);gap:16px;align-items:start">
    <div class="panel">
      <div style="padding:14px 18px;border-bottom:1px solid #e2e6ed;font-weight:800;color:#166534">Орлого</div>
      <div style="padding:16px 18px">
        <div style="font-size:12px;color:#64748b;margin-bottom:12px">Мөнгөн журналын орлогын гүйлгээний задаргаа</div>
        ${incomeByType.length ? incomeByType.map(r => {
          const pct = incomeTotal ? Math.round(r.amount / incomeTotal * 100) : 0;
          return `<div style="display:grid;grid-template-columns:minmax(150px,1fr) 2fr 98px;gap:10px;align-items:center;margin-bottom:10px">
            <div style="font-size:12px;font-weight:800;color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</div>
            <div style="height:11px;background:#dcfce7;border-radius:999px;overflow:hidden">
              <div style="width:${Math.min(pct,100)}%;height:100%;background:#16a34a"></div>
            </div>
            <div style="font-size:12px;font-weight:900;color:#16a34a;text-align:right">${fmt(r.amount)}₮</div>
          </div>`;
        }).join("") : `<div style="font-size:12px;color:#94a3b8;text-align:center;padding:22px">Орлогын гүйлгээ бүртгэгдээгүй байна</div>`}
      </div>
    </div>

    <div class="panel">
      <div style="padding:14px 18px;border-bottom:1px solid #e2e6ed;font-weight:800;color:#991b1b">Зарлага / төсвийн гүйцэтгэл</div>
      <div style="padding:16px 18px;border-bottom:1px solid #eef2f7">
        ${topExpenseRows.length ? topExpenseRows.map(r => {
          const pct = actualTotal ? Math.round(r.actual / actualTotal * 100) : 0;
          return `<div style="display:grid;grid-template-columns:minmax(190px,1fr) 2fr 110px;gap:10px;align-items:center;margin-bottom:10px">
            <div style="font-size:12px;font-weight:800;color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</div>
            <div style="height:11px;background:#fee2e2;border-radius:999px;overflow:hidden">
              <div style="width:${Math.min(pct,100)}%;height:100%;background:#dc2626"></div>
            </div>
            <div style="font-size:12px;font-weight:900;color:#dc2626;text-align:right">${fmt(r.actual)}₮</div>
          </div>`;
        }).join("") : `<div style="font-size:12px;color:#94a3b8;text-align:center;padding:20px">Зарлагын гүйцэтгэл бүртгэгдээгүй байна</div>`}
      </div>
      <div style="overflow:auto">
        <table style="width:100%;border-collapse:collapse;font-size:11px;min-width:820px">
          <thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0">
            <th style="padding:8px;text-align:left">Код</th><th style="padding:8px;text-align:left">Ангилал</th>
            <th style="padding:8px;text-align:right">Төсөв</th><th style="padding:8px;text-align:right">Гүйцэтгэл</th>
            <th style="padding:8px;text-align:right">Үлдэгдэл</th><th style="padding:8px;text-align:center">%</th>
          </tr></thead>
          <tbody>
            ${rows.map(r => {
              const pct = r.plan ? Math.round(r.actual / r.plan * 100) : (r.actual ? 100 : 0);
              const isGroup = r.level <= 1;
              return `<tr style="border-bottom:1px solid #f1f5f9;background:${isGroup ? "#f8fafc" : "#fff"}">
                <td style="padding:8px;font-weight:900;color:#475569">${escapeHtml(r.code)}</td>
                <td style="padding:8px;font-weight:${isGroup ? 900 : 600};padding-left:${8 + r.level * 14}px;color:#0f172a">${escapeHtml(r.name)}</td>
                <td style="padding:8px;text-align:right;white-space:nowrap">${fmt(r.plan)}₮</td>
                <td style="padding:8px;text-align:right;font-weight:900;color:#dc2626;white-space:nowrap">${fmt(r.actual)}₮</td>
                <td style="padding:8px;text-align:right;font-weight:900;color:${r.diff >= 0 ? "#2563eb" : "#dc2626"};white-space:nowrap">${fmt(r.diff)}₮</td>
                <td style="padding:8px;text-align:center;font-weight:900;color:${pct > 100 ? "#dc2626" : "#2563eb"}">${pct}%</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
      ${perf.unmatched.length ? `<div style="font-size:12px;color:#dc2626;padding:10px 18px">Код таараагүй ${perf.unmatched.length} зарлагын мөр байна.</div>` : ""}
    </div>
  </div>`;
}

// ── 7. Санхүүгийн тайлан ────────────────────────────────────

async function fin_reports() {
  let cashRows=[], payRows=[], recvRows=[];
  const now = new Date();
  let reportFrom = window._finReportFrom || `${now.getFullYear()}-01-01`;
  let reportTo = window._finReportTo || today();
  const periodRange = () => {
    return {
      from: reportFrom,
      to: reportTo,
      label: `${reportFrom} - ${reportTo}`
    };
  };
  const rowInPeriod = (r, dateKeys, from, to) => {
    const date = dateKeys.map(k => r[k]).find(Boolean);
    if (!date) return false;
    const d = String(date).slice(0, 10);
    return d >= from && d <= to;
  };

  async function load() {
    const period = periodRange();
    try {
      [cashRows, payRows, recvRows] = await Promise.all([
        api(`/api/cash-journal?from=${period.from}&to=${period.to}`),
        api("/api/payables"),
        api("/api/receivables")
      ]);
    } catch(e) {}
    render();
  }

  function render() {
    const period = periodRange();
    const payPeriodRows = payRows.filter(r => rowInPeriod(r, ["invoice_date", "due_date", "created_at"], period.from, period.to));
    const recvPeriodRows = recvRows.filter(r => rowInPeriod(r, ["invoice_date", "due_date", "created_at"], period.from, period.to));
    const cashIn  = cashRows.filter(r=>r.txn_type==="Орлого").reduce((s,r)=>s+Number(r.amount),0);
    const cashOut = cashRows.filter(r=>r.txn_type==="Зарлага").reduce((s,r)=>s+Number(r.amount),0);
    const payTotal   = payPeriodRows.reduce((s,r)=>s+Number(r.amount),0);
    const payPaid    = payPeriodRows.reduce((s,r)=>s+Number(r.paid_amount),0);
    const recvTotal  = recvPeriodRows.reduce((s,r)=>s+Number(r.amount),0);
    const recvGot    = recvPeriodRows.reduce((s,r)=>s+Number(r.received_amount),0);
    const budgetCodeOf = r => {
      const text = [r.cash_flow_type, r.econ_category, r.corr_account].filter(Boolean).join(" ");
      const m = String(text).match(/(^|\D)(\d{1,6})(?=\D|$)/);
      const code = m ? m[2] : "";
      return FIN_BUDGET_CODE_ALIASES[code] || code;
    };
    const expenseRows = cashRows
      .filter(r => r.txn_type === "Зарлага")
      .map(r => ({ ...r, _budgetCode: budgetCodeOf(r) }));
    const budgetRows = FIN_BUDGET_PLAN_2026.map(row => {
      const actualRows = expenseRows.filter(r => {
        if (!row.code) return false;
        if (row.code.length < 6) return r._budgetCode.startsWith(row.code);
        return r._budgetCode === row.code;
      });
      const actual = actualRows.reduce((s,r) => s + Number(r.amount || 0), 0);
      const plan = budgetPlanForPeriod(row, period.from, period.to);
      return { ...row, plan, actual, count: actualRows.length, diff: plan - actual };
    });
    const unmatchedBudgetRows = expenseRows.filter(r => !r._budgetCode || !FIN_BUDGET_PLAN_2026.some(b => r._budgetCode.startsWith(b.code) || b.code.startsWith(r._budgetCode)));
    const plannedTotal = budgetRows.find(r => r.code === "2")?.plan || budgetRows.reduce((s,r)=>s+r.plan,0);
    const budgetTotal = budgetRows.find(r => r.code === "2")?.actual || expenseRows.reduce((s,r)=>s+Number(r.amount||0),0);
    const budgetTopRows = budgetRows.filter(r => r.level === 1 && r.actual > 0);
    const budgetChartColors = ["#2563eb","#16a34a","#7c3aed","#d97706","#0891b2","#dc2626","#4f46e5","#059669"];

    window._finReportFrom = reportFrom;
    window._finReportTo = reportTo;
    main.style.maxWidth = "none";
    main.style.width = "100%";
    main.innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:20px">
      <div>
        <h1 style="margin:0 0 4px">📑 Санхүүгийн тайлан</h1>
        <div style="font-size:12px;color:#667085">Financial Reports · ${period.label} · ${period.from} - ${period.to}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:8px 10px">
        <span style="font-size:12px;font-weight:800;color:#475569">Шүүлтүүр:</span>
        <input type="date" class="input" value="${period.from}" style="width:150px;padding:7px 10px;font-size:13px" onchange="window._finReportFrom=this.value; fin_reports()">
        <span style="color:#94a3b8">—</span>
        <input type="date" class="input" value="${period.to}" style="width:150px;padding:7px 10px;font-size:13px" onchange="window._finReportTo=this.value; fin_reports()">
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">
      <div class="panel">
        <div style="padding:14px 18px;border-bottom:1px solid #e2e6ed;font-weight:700;font-size:14px">💵 Мөнгөн гүйлгээний тойм</div>
        <div style="padding:16px 18px">
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:6px 0;color:#667085">Нийт орлого</td><td style="text-align:right;font-weight:700;color:#16a34a">${fmt(cashIn)}₮</td></tr>
            <tr><td style="padding:6px 0;color:#667085">Нийт зарлага</td><td style="text-align:right;font-weight:700;color:#dc2626">${fmt(cashOut)}₮</td></tr>
            <tr style="border-top:2px solid #e2e6ed"><td style="padding:8px 0;font-weight:800">Цэвэр дүн</td><td style="text-align:right;font-weight:800;font-size:18px;color:${cashIn>=cashOut?'#2563eb':'#dc2626'}">${fmt(cashIn-cashOut)}₮</td></tr>
          </table>
        </div>
      </div>
      <div class="panel">
        <div style="padding:14px 18px;border-bottom:1px solid #e2e6ed;font-weight:700;font-size:14px">📊 Өглөг / Авлагын тойм</div>
        <div style="padding:16px 18px">
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:6px 0;color:#667085">Нийт өглөг</td><td style="text-align:right;font-weight:700;color:#d97706">${fmt(payTotal)}₮</td></tr>
            <tr><td style="padding:6px 0;color:#667085">Төлсөн</td><td style="text-align:right;font-weight:700;color:#16a34a">${fmt(payPaid)}₮</td></tr>
            <tr><td style="padding:6px 0;color:#667085">Нийт авлага</td><td style="text-align:right;font-weight:700;color:#7c3aed">${fmt(recvTotal)}₮</td></tr>
            <tr><td style="padding:6px 0;color:#667085">Авсан</td><td style="text-align:right;font-weight:700;color:#16a34a">${fmt(recvGot)}₮</td></tr>
          </table>
      </div>
    </div>
    </div>

    <div style="display:grid;grid-template-columns:minmax(720px, 820px) minmax(360px, 1fr);gap:16px;align-items:start;margin-bottom:20px;width:100%">
    <div class="panel" style="margin-bottom:0">
      <div style="padding:14px 18px;border-bottom:1px solid #e2e6ed;font-weight:700;font-size:14px">📘 Төсвийн гүйцэтгэлийн тайлан</div>
      <div style="padding:16px 18px">
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:14px">
          ${statCard("Батлагдсан төсөв", fmt(plannedTotal)+"₮", "#2563eb")}
          ${statCard("Гүйцэтгэл", fmt(budgetTotal)+"₮", "#16a34a")}
          ${statCard("Үлдэгдэл", fmt(plannedTotal-budgetTotal)+"₮", plannedTotal>=budgetTotal?"#7c3aed":"#dc2626")}
        </div>
        <div style="display:grid;grid-template-columns:minmax(0,1fr);gap:14px;align-items:stretch;margin-bottom:14px">
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px">
            <div style="font-size:12px;font-weight:900;color:#334155;margin-bottom:10px">Зардлын ангиллаар гүйцэтгэлд эзлэх хувь</div>
            ${budgetTopRows.length ? budgetTopRows.map(r => {
              const pct = budgetTotal ? Math.round(r.actual / budgetTotal * 100) : 0;
              return `<div style="display:grid;grid-template-columns:minmax(180px,1fr) 3fr 86px;gap:10px;align-items:center;margin-bottom:8px">
                <div style="font-size:11px;font-weight:800;color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</div>
                <div style="height:12px;background:#e2e8f0;border-radius:999px;overflow:hidden">
                  <div style="width:${Math.min(pct,100)}%;height:100%;background:#2563eb;border-radius:999px"></div>
                </div>
                <div style="font-size:11px;font-weight:900;color:#2563eb;text-align:right">${fmt(r.actual)}₮</div>
              </div>`;
            }).join("") : `<div style="font-size:12px;color:#94a3b8;text-align:center;padding:12px">Зарлагын гүйцэтгэл бүртгэгдээгүй байна</div>`}
          </div>
        </div>
        <div style="overflow:hidden;border:1px solid #e2e8f0;border-radius:10px">
          <table style="width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed">
            <colgroup>
              <col style="width:58px">
              <col>
              <col style="width:116px">
              <col style="width:116px">
              <col style="width:116px">
              <col style="width:62px">
              <col style="width:58px">
            </colgroup>
            <thead>
              <tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0">
                <th style="padding:8px 8px;text-align:left;font-size:10px;color:#475569">КОД</th>
                <th style="padding:8px 8px;text-align:left;font-size:10px;color:#475569">ТӨСВИЙН АНГИЛАЛ</th>
                <th style="padding:8px 8px;text-align:right;font-size:10px;color:#475569">ТӨЛӨВЛӨГӨӨ</th>
                <th style="padding:8px 8px;text-align:right;font-size:10px;color:#475569">ГҮЙЦЭТГЭЛ</th>
                <th style="padding:8px 8px;text-align:right;font-size:10px;color:#475569">ЗӨРҮҮ</th>
                <th style="padding:8px 8px;text-align:center;font-size:10px;color:#475569">%</th>
                <th style="padding:8px 8px;text-align:center;font-size:10px;color:#475569">ГҮЙЛ.</th>
              </tr>
            </thead>
            <tbody>
              ${budgetRows.length ? budgetRows.map(r => {
                const pct = r.plan ? Math.round(r.actual / r.plan * 100) : (r.actual ? 100 : 0);
                const isGroup = r.level <= 1;
                return `<tr style="border-bottom:1px solid #f1f5f9;background:${isGroup ? "#f8fafc" : "#fff"}">
                  <td style="padding:8px 8px;font-weight:800;color:#475569;white-space:nowrap">${escapeHtml(r.code)}</td>
                  <td style="padding:8px 8px;font-weight:${isGroup ? 900 : 600};color:#0f172a;padding-left:${8 + r.level * 12}px;white-space:normal;line-height:1.25;word-break:break-word">${escapeHtml(r.name)}</td>
                  <td style="padding:8px 8px;text-align:right;font-weight:800;color:#334155;white-space:nowrap">${fmt(r.plan)}₮</td>
                  <td style="padding:8px 8px;text-align:right;font-weight:800;color:#16a34a;white-space:nowrap">${fmt(r.actual)}₮</td>
                  <td style="padding:8px 8px;text-align:right;font-weight:800;color:${r.diff >= 0 ? "#2563eb" : "#dc2626"};white-space:nowrap">${fmt(r.diff)}₮</td>
                  <td style="padding:8px 8px;text-align:center;white-space:nowrap">
                    <span style="font-weight:800;color:${pct > 100 ? "#dc2626" : "#2563eb"}">${pct}%</span>
                  </td>
                  <td style="padding:8px 8px;text-align:center;color:#64748b;white-space:nowrap">${r.count}</td>
                </tr>`;
              }).join("") : `<tr><td colspan="7" style="text-align:center;padding:28px;color:#94a3b8">Төсвийн гүйцэтгэлийн зарлага бүртгэгдээгүй байна</td></tr>`}
            </tbody>
          </table>
        </div>
        <div style="font-size:12px;color:#64748b;margin-top:10px;background:#f8fafc;border-radius:8px;padding:10px">
          Энэ тайлан нь 2026 оны төсвийн сарын хуваарийг суурь болгож, сонгосон хугацаанд хамрагдсан саруудын төлөвлөгөөг бүтнээр нь бодно. Мөнгөн журналын <b>Зарлага</b> мөрүүдийг кодоор нь тааруулж харуулна.
          ${unmatchedBudgetRows.length ? `<br><span style="color:#dc2626;font-weight:700">Анхаарах:</span> Код таараагүй ${unmatchedBudgetRows.length} зарлагын мөр байна.` : ""}
        </div>
      </div>
    </div>
    <div class="panel" style="margin-bottom:0;min-height:560px">
      <div style="padding:14px 18px;border-bottom:1px solid #e2e6ed;font-weight:700;font-size:14px">◔ Ангилал тус бүрийн зардалд эзлэх хувь</div>
      <div style="padding:16px 18px">
        <div style="font-size:12px;color:#64748b;margin-bottom:14px">Нийт гүйцэтгэл ${fmt(budgetTotal)}₮ дотор эзлэх хувь</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px">
          ${budgetTopRows.length ? budgetTopRows.map((r, idx) => {
            const color = budgetChartColors[idx % budgetChartColors.length];
            const pct = budgetTotal ? Math.round(r.actual / budgetTotal * 100) : 0;
            return `<div style="border:1px solid #e2e8f0;border-radius:10px;background:#fff;padding:14px;display:grid;grid-template-columns:86px minmax(0,1fr);gap:12px;align-items:center;min-height:116px">
              <div style="width:86px;height:86px;border-radius:50%;background:conic-gradient(${color} 0 ${Math.min(pct,100)}%, #e2e8f0 ${Math.min(pct,100)}% 100%);display:flex;align-items:center;justify-content:center">
                <div style="width:58px;height:58px;border-radius:50%;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;box-shadow:inset 0 0 0 1px #eef2f7">
                  <div style="font-size:18px;font-weight:900;color:${color};line-height:1">${pct}%</div>
                  <div style="font-size:9px;color:#94a3b8;font-weight:800">эзлэх</div>
                </div>
              </div>
              <div style="min-width:0">
                <div style="font-size:12px;font-weight:900;color:#0f172a;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</div>
                <div style="font-size:13px;font-weight:900;color:${color};margin-top:8px;white-space:nowrap">${fmt(r.actual)}₮</div>
                <div style="font-size:11px;color:#64748b;margin-top:4px">${r.count} гүйлгээ</div>
              </div>
            </div>`;
          }).join("") : `<div style="font-size:12px;color:#94a3b8;text-align:center;padding:32px;border:1px dashed #cbd5e1;border-radius:10px">Зарлагын гүйцэтгэл бүртгэгдээгүй байна</div>`}
        </div>
      </div>
    </div>
    </div>`;
  }
  load();
}

// ── Excel import modal (shared) ──────────────────────────────

function openImportModal(tbl) {
  const labels = {
    cash_journal:        ["txn_date:Огноо","doc_no:Журнал №","counterparty:Байгуулллага","description:Гүйлгээний утга","orlogo_amount:Орлого дүн","zarlaga_amount:Зарлага дүн"],
    accounts_payable:    ["vendor_name:Нийлүүлэгч","invoice_no:Нэхэмжлэлийн №","invoice_date:Огноо","due_date:Дуусах огноо","amount:Дүн"],
    accounts_receivable: ["debtor_name:Өртэй тал","invoice_no:Нэхэмжлэлийн №","invoice_date:Огноо","due_date:Дуусах огноо","amount:Дүн"]
  };
  const fields = labels[tbl]||[];
  const existing = document.getElementById("importModal");
  if (existing) existing.remove();
  const div = document.createElement("div");
  div.id = "importModal";
  div.style = "position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:2000;display:flex;align-items:center;justify-content:center";
  div.innerHTML = `<div style="background:#fff;border-radius:14px;padding:28px;width:600px;max-height:90vh;overflow:auto">
    <div style="font-size:16px;font-weight:800;margin-bottom:16px">📥 Excel Import</div>
    <div style="font-size:13px;color:#667085;margin-bottom:14px">Excel файл (.xlsx/.xls) оруулж баганы харгалзааг тохируулна уу. Эхний мөр толгой байх ёстой.</div>
    ${["accounts_payable","accounts_receivable"].includes(tbl) ? importPeriodControls("imp") : ""}
    <input type="file" id="impFile" accept=".xlsx,.xls" style="margin-bottom:12px" onchange="parseImport('${tbl}')">
    <div id="impPreview"></div>
    <div id="impMapping" style="display:none;margin-top:14px">
      <div style="font-size:13px;font-weight:700;margin-bottom:10px">Баганы харгалзаа:</div>
      ${fields.map(f=>{ const [k,label]=f.split(":"); return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <span style="width:200px;font-size:13px;color:#374151">${label}</span>
        <select class="input" id="map_${k}" style="flex:1;padding:5px 8px;font-size:13px"><option value="">— Багана сонгох —</option></select>
      </div>`; }).join("")}
      <button class="btn" style="margin-top:12px" onclick="commitImport('${tbl}')">Оруулах</button>
    </div>
    <button class="btn secondary" style="margin-top:12px" onclick="document.getElementById('importModal').remove()">Хаах</button>
  </div>`;
  document.body.appendChild(div);
}

window.parseImport = async (tbl) => {
  const file = document.getElementById("impFile").files[0];
  if (!file) return;
  const fd = new FormData(); fd.append("file", file);
  try {
    const r = await fetch("/api/finance-import/parse", {
      method:"POST",
      headers:{ Authorization:"Bearer "+state.token },
      body: fd
    });
    const d = await r.json();
    if (!r.ok) { toast(d.error||"Алдаа"); return; }
    window._impData = d;
    const prev = d.data.slice(0,5);
    document.getElementById("impPreview").innerHTML = `
      <div style="font-size:12px;color:#667085;margin-bottom:8px">Нийт ${d.total} мөр олдлоо. Урьдчилан харах (5 мөр):</div>
      <div class="table-wrap" style="max-height:160px;overflow:auto">${table(d.headers, prev)}</div>`;
    document.getElementById("impMapping").style.display = "block";
    const fields = ["txn_date","doc_no","txn_type","description","amount",
                    "vendor_name","invoice_no","invoice_date","due_date",
                    "debtor_name","received_amount"];
    fields.forEach(f => {
      const sel = document.getElementById("map_"+f); if (!sel) return;
      sel.innerHTML = `<option value="">— Багана сонгох —</option>`+
        d.headers.map((h,i)=>`<option value="${i}">${h}</option>`).join("");
      const auto = d.headers.findIndex(h=>h.toLowerCase().includes(f.toLowerCase().replace("_","")));
      if (auto>=0) sel.value = auto;
    });
  } catch(e) { toast("Файл уншихад алдаа: "+e.message); }
};

window.commitImport = async (tbl) => {
  const data = window._impData;
  if (!data) { toast("Эхлээд файл оруулна уу"); return; }
  const fields = tbl==="cash_journal"    ? ["txn_date","doc_no","counterparty","description","orlogo_amount","zarlaga_amount"] :
                 tbl==="accounts_payable" ? ["vendor_name","invoice_no","invoice_date","due_date","amount"] :
                 ["debtor_name","invoice_no","invoice_date","due_date","amount"];
  const mapping = {};
  fields.forEach(f => {
    const sel = document.getElementById("map_"+f);
    if (sel && sel.value !== "") mapping[f] = Number(sel.value);
  });
  try {
    const y = Number(document.getElementById("impYear")?.value || today().slice(0, 4));
    const m = Number(document.getElementById("impMonth")?.value || today().slice(5, 7));
    const r = await api("/api/finance-import/commit", {
      method:"POST",
      body: JSON.stringify({
        table: tbl,
        mapping,
        rows: data.data,
        target_year: y,
        target_month: m,
        target_date: `${y}-${String(m).padStart(2, "0")}-01`
      })
    });
    toast(`${r.inserted} мөр амжилттай оруулав`);
    document.getElementById("importModal")?.remove();
    if (tbl==="cash_journal") cash_journal();
    else if (tbl==="accounts_payable") payables();
    else if (tbl==="accounts_receivable") receivables();
  } catch(e) { toast(e.message); }
};

// ── Smart Import (auto-detect) ───────────────────────────────

function openSmartImport() {
  const existing = document.getElementById("smartImportModal");
  if (existing) existing.remove();
  const div = document.createElement("div");
  div.id = "smartImportModal";
  div.style = "position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:2000;display:flex;align-items:center;justify-content:center";
  div.innerHTML = `
  <div style="background:#fff;border-radius:14px;padding:28px;width:640px;max-height:90vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.2)">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
      <div style="font-size:16px;font-weight:800">🧠 Smart Import</div>
      <button class="btn secondary sm" onclick="document.getElementById('smartImportModal').remove()">✕ Хаах</button>
    </div>
    <div style="font-size:13px;color:#667085;margin-bottom:16px">
      Нягтлангийн програмаас гаргасан Excel файл оруулна уу — төрлийг автоматаар таних болно.<br>
      <span style="font-size:12px">Дэмжигдэх: Мөнгөн хөрөнгийн журнал · Үндсэн хөрөнгө · Няравын тайлан · Авлага · Өглөг</span>
    </div>
    ${importPeriodControls("si")}
    <div style="background:#f8fafc;border:2px dashed #e2e6ed;border-radius:10px;padding:24px;text-align:center;margin-bottom:16px">
      <input type="file" id="siFile" accept=".xlsx,.xls" style="display:none" onchange="siParseFile()">
      <div style="font-size:36px;margin-bottom:8px">📂</div>
      <button class="btn secondary" onclick="document.getElementById('siFile').click()">Excel файл сонгох (.xlsx / .xls)</button>
    </div>
    <div id="siStatus" style="display:none;margin-bottom:14px"></div>
    <div id="siPreview" style="display:none;margin-bottom:14px"></div>
    <div id="siCommitArea" style="display:none">
      <button class="btn" id="siCommitBtn" onclick="siCommit()">✓ Оруулах</button>
    </div>
  </div>`;
  document.body.appendChild(div);
}

window.siParseFile = async () => {
  const file = document.getElementById("siFile")?.files[0];
  if (!file) return;
  const status = document.getElementById("siStatus");
  status.style.display = "block";
  status.innerHTML = `<div style="color:#667085;font-size:13px">⏳ Уншиж байна...</div>`;
  document.getElementById("siPreview").style.display = "none";
  document.getElementById("siCommitArea").style.display = "none";
  window._siData = null;
  const fd = new FormData(); fd.append("file", file);
  try {
    const r = await fetch("/api/smart-import/parse", {
      method: "POST",
      headers: { Authorization: "Bearer " + state.token },
      body: fd
    });
    const d = await r.json();
    if (!r.ok) {
      status.innerHTML = `<div style="color:#dc2626;font-size:13px;padding:10px 14px;background:#fee2e2;border-radius:8px">
        ❌ ${d.error || "Алдаа"}<br>
        ${d.hint ? `<small style="color:#94a3b8">Эхний нүд: "${d.hint}"</small>` : ""}
      </div>`;
      return;
    }
    window._siData = d;
    const typeLabels = {
      cash_journal:   "📋 Мөнгөн хөрөнгийн журнал",
      fixed_assets:   "🏢 Үндсэн хөрөнгийн тайлан",
      material_trans: "📦 Няравын материалын тайлан",
      receivable:     "↑ Авлагын тайлан (BillPage)",
      payable:        "↓ Өглөгийн тайлан (BillPage)"
    };
    status.innerHTML = `<div style="padding:10px 14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;font-size:13px">
      ✅ Таньсан: <b>${typeLabels[d.type] || d.type}</b> — нийт <b>${d.total}</b> мөр
    </div>`;
    const cols = Object.keys(d.preview[0] || {});
    const prev = document.getElementById("siPreview");
    prev.style.display = "block";
    prev.innerHTML = `<div style="font-size:12px;color:#667085;margin-bottom:6px">Урьдчилан харах (${d.preview.length} мөр):</div>
      <div class="table-wrap" style="max-height:220px;overflow:auto">${table(cols, d.preview.map(row => cols.map(c => row[c] || "")))}</div>`;
    document.getElementById("siCommitArea").style.display = "block";
    document.getElementById("siCommitBtn").textContent = `✓ ${d.total} мөр оруулах`;
  } catch(e) {
    status.innerHTML = `<div style="color:#dc2626;font-size:13px">Алдаа: ${e.message}</div>`;
  }
};

window.siCommit = async () => {
  const d = window._siData;
  if (!d) return;
  const btn = document.getElementById("siCommitBtn");
  btn.disabled = true; btn.textContent = "Оруулж байна...";
  try {
    const y = Number(document.getElementById("siYear")?.value || today().slice(0, 4));
    const m = Number(document.getElementById("siMonth")?.value || today().slice(5, 7));
    const r = await api("/api/smart-import/commit", {
      method: "POST",
      body: JSON.stringify({
        type: d.type,
        data: d.data,
        target_year: y,
        target_month: m,
        target_date: `${y}-${String(m).padStart(2, "0")}-01`
      })
    });
    const msg = `✅ ${r.inserted} мөр нэмэгдсэн` +
      (r.skipped ? `, ${r.skipped} шинэчлэгдсэн` : "") +
      (r.errors?.length ? ` (${r.errors.length} алдаа)` : "");
    toast(msg);
    document.getElementById("smartImportModal")?.remove();
    const reloads = {
      cash_journal: cash_journal, fixed_assets: fixed_ledger,
      receivable: receivables,    payable: payables
    };
    const reload = reloads[d.type];
    if (reload) reload();
    else if (d.type === "material_trans" && window.nyarav_stock) window.nyarav_stock();
  } catch(e) {
    toast(e.message);
    btn.disabled = false; btn.textContent = "✓ Оруулах";
  }
};

Object.assign(window, {
  finance, finOpen,
  fin_dashboard, cash_journal, payables, receivables,
  fin_materials, fin_budget, fin_performance, fin_budget_performance, filterFinanceMaterialTable,
  fixed_ledger, payroll, fin_reports, openImportModal, openSmartImport
});
