"use strict";
labels.finance = "Санхүү, бүртгэл";
state.financeData = null;
state.financeTab = "overview";
state.financeFilter = {
  from: `${new Date().getFullYear()}-01-01`,
  to: new Date().toISOString().slice(0, 10),
};
const renderBeforeFinance = render;
render = function () {
  if (state.view !== "finance") return renderBeforeFinance();
  renderFinance();
};
const adjustBeforeFinance = adjustModuleNavigation;
adjustModuleNavigation = function () {
  adjustBeforeFinance();
  if (state.user) {
    const allowed =
      (state.user.permissions || []).includes("finance.read") ||
      ["accountant", "director"].includes(state.user.role);
    $("#financeNav")?.classList.toggle("hidden", !allowed);
  }
};
async function loadFinance() {
  try {
    state.financeData = await api(
      `/api/finance/overview?${new URLSearchParams(state.financeFilter)}`,
    );
    render();
  } catch (error) {
    toast(error.message, true);
  }
}
const financeStatus = {
    open: "Нээлттэй",
    partial: "Хэсэгчлэн төлсөн",
    settled: "Төлөгдсөн",
    cancelled: "Цуцалсан",
    matched: "Тулгасан",
    exception: "Зөрүүтэй",
  },
  treatmentName = {
    expense: "Зардал",
    asset: "Хөрөнгө",
    work_in_progress: "Дуусаагүй ажил",
    no_charge: "Төлбөргүй",
  };
function financeTabs() {
  return `<div class="finance-tabs">${[
    ["overview", "Тойм"],
    ["journal", "Мөнгөн журнал"],
    ["payable", "Өглөг"],
    ["receivable", "Авлага"],
    ["materials", "Материалын тулгалт"],
    ["budgets", "Төсөв, гүйцэтгэл"],
    ["assets", "Үндсэн хөрөнгө"],
    ["reports", "Тайлан"],
  ]
    .map(
      ([key, name]) =>
        `<button type="button" class="${state.financeTab === key ? "active" : ""}" data-finance-tab="${key}">${name}</button>`,
    )
    .join("")}</div>`;
}
function financeCards(s) {
  return `<div class="finance-cards"><article class="finance-card income"><span>Орлого</span><strong>${money(s.income)}</strong></article><article class="finance-card expense"><span>Зарлага</span><strong>${money(s.expense)}</strong></article><article class="finance-card"><span>Өглөгийн үлдэгдэл</span><strong>${money(s.payable_outstanding)}</strong></article><article class="finance-card"><span>Авлагын үлдэгдэл</span><strong>${money(s.receivable_outstanding)}</strong></article><article class="finance-card"><span>Тулгаагүй материал</span><strong>${s.materials_pending}</strong></article></div>`;
}
function financeChart(items) {
  if (!items.length)
    return empty(
      "Гүйлгээ алга",
      "CSV эсвэл Excel файлаас баталгаатай өгөгдлөө импортлоорой.",
    );
  const max = Math.max(
    1,
    ...items.flatMap((x) => [Number(x.income), Number(x.expense)]),
  );
  return `<div class="finance-chart">${items.map((x) => `<div class="finance-month"><i class="finance-bar income" style="height:${Math.max(2, (Number(x.income) / max) * 170)}px"></i><i class="finance-bar expense" style="height:${Math.max(2, (Number(x.expense) / max) * 170)}px"></i><small>${esc(x.month.slice(5))} сар</small></div>`).join("")}</div>`;
}
function journalTable(d) {
  return `<section class="finance-panel"><div class="finance-heading"><h2>Мөнгөн журнал</h2><span>${d.transactions.length} гүйлгээ</span></div><div class="module-table-wrap"><table class="module-table"><thead><tr><th>Огноо</th><th>Данс</th><th>Төрөл</th><th>Харилцагч / Утга</th><th>Баримт</th><th>Дүн</th></tr></thead><tbody>${d.transactions.length ? d.transactions.map((t) => `<tr><td>${date(t.transaction_date)}</td><td><strong>${esc(t.account_code)}</strong><small>${esc(t.account_name)}</small></td><td>${esc(t.transaction_type)}</td><td>${esc(t.counterparty || "—")}<small>${esc(t.description || "")}</small></td><td>${esc(t.reference || "—")}</td><td>${money(t.amount, t.currency)}</td></tr>`).join("") : `<tr><td colspan="6">Гүйлгээ ороогүй байна.</td></tr>`}</tbody></table></div></section>`;
}
function obligationForm(direction) {
  return `<form class="finance-form finance-panel" data-obligation-form="${direction}"><h2>${direction === "payable" ? "Шинэ өглөг" : "Шинэ авлага"}</h2><div class="finance-form-grid"><label>Баримтын дугаар<input name="documentNo" required></label><label>Харилцагч<input name="counterparty" required></label><label>Баримтын огноо<input name="documentDate" type="date" value="${new Date().toISOString().slice(0, 10)}" required></label><label>Төлөх хугацаа<input name="dueDate" type="date"></label><label>Нийт дүн<input name="totalAmount" type="number" min="0.01" step="0.01" required></label><label>Валют<input name="currency" value="MNT" maxlength="3" required></label></div><label>Утга<input name="description"></label><button class="primary">Бүртгэх</button></form>`;
}
function obligationView(d, direction) {
  const rows = d.obligations.filter((x) => x.direction === direction);
  return `${d.capabilities.manage ? obligationForm(direction) : ""}<section class="finance-panel"><h2>${direction === "payable" ? "Өглөгийн бүртгэл" : "Авлагын бүртгэл"}</h2><div class="module-table-wrap"><table class="module-table"><thead><tr><th>Баримт</th><th>Харилцагч</th><th>Хугацаа</th><th>Нийт / Үлдэгдэл</th><th>Төлөв</th><th></th></tr></thead><tbody>${rows.length ? rows.map((x) => `<tr><td><strong>${esc(x.document_no)}</strong><small>${date(x.document_date)}</small></td><td>${esc(x.counterparty)}<small>${esc(x.description)}</small></td><td>${x.due_date ? date(x.due_date) : "—"}</td><td>${money(x.total_amount, x.currency)}<small>Үлдэгдэл: ${money(Number(x.total_amount) - Number(x.settled_amount), x.currency)}</small></td><td><span class="finance-status ${x.status}">${financeStatus[x.status]}</span></td><td>${d.capabilities.manage && !["settled", "cancelled"].includes(x.status) ? `<button class="secondary" data-settle-id="${x.id}" data-settle-balance="${Number(x.total_amount) - Number(x.settled_amount)}">Төлөлт</button>` : ""}</td></tr>`).join("") : `<tr><td colspan="6">Бүртгэл алга.</td></tr>`}</tbody></table></div></section>`;
}
function materialsView(d) {
  return `<section class="finance-panel"><h2>Ажлын захиалга ↔ нярав ↔ нягтлан</h2><p class="finance-note">Нярав материал олгосны дараа энд автоматаар орж ирнэ. Нягтлан агуулахын тоог өөрчлөхгүй, санхүүгийн ангилал ба баримтыг тулгана.</p><div class="module-table-wrap"><table class="module-table"><thead><tr><th>Ажлын захиалга</th><th>Материал</th><th>Олголт</th><th>Санхүүгийн ангилал</th><th>Төлөв</th><th></th></tr></thead><tbody>${d.materials.length ? d.materials.map((x) => `<tr><td><strong>${esc(x.work_order_title)}</strong><small>${esc(x.work_order_category)}</small></td><td>${esc(x.sku)} · ${esc(x.item_name)}</td><td>${x.issued_quantity} ${esc(x.unit)}<small>${dateTime(x.issued_at)}</small></td><td>${x.treatment ? treatmentName[x.treatment] : "—"}<small>${x.review_id ? `${money(x.amount, x.currency)} · ${esc(x.document_reference || "баримтгүй")}` : ""}</small></td><td><span class="finance-status ${x.review_status || "open"}">${x.review_status ? financeStatus[x.review_status] : "Тулгаагүй"}</span></td><td>${d.capabilities.reconcile ? `<button class="secondary" data-material-review="${x.material_request_id}">Тулгах</button>` : ""}</td></tr>`).join("") : `<tr><td colspan="6">Олгогдсон материал хараахан алга.</td></tr>`}</tbody></table></div></section>`;
}
function budgetView(d) {
  return `${d.capabilities.manage ? `<form class="finance-form finance-panel" id="financeBudgetForm"><h2>Төсөв бүртгэх</h2><div class="finance-form-grid"><label>Ангилал<input name="category" required></label><label>Төсөвт дүн<input name="plannedAmount" type="number" min="0" step="0.01" required></label><label>Эхлэх<input name="periodStart" type="date" required></label><label>Дуусах<input name="periodEnd" type="date" required></label><label>Валют<input name="currency" value="MNT" maxlength="3" required></label></div><button class="primary">Хадгалах</button></form>` : ""}<section class="finance-panel"><h2>Төсөв, гүйцэтгэл</h2>${d.budgets.length ? d.budgets.map((x) => `<div class="finance-job"><div><strong>${esc(x.category)}</strong><small>${date(x.period_start)} – ${date(x.period_end)}</small></div><strong>${money(x.planned_amount, x.currency)}</strong></div>`).join("") : "Төсөв бүртгэгдээгүй байна."}</section>`;
}
function assetsView(d) {
  return `<div class="finance-cards"><article class="finance-card"><span>Үндсэн хөрөнгийн мөр</span><strong>${d.summary.fixed_asset_count}</strong></article><article class="finance-card"><span>Анхны өртөг</span><strong>${money(d.summary.fixed_asset_initial_value)}</strong></article><article class="finance-card"><span>Үлдэгдэл өртөг</span><strong>${money(d.summary.fixed_asset_book_value)}</strong></article></div><section class="finance-panel"><h2>Үндсэн хөрөнгийн санхүүгийн бүртгэл</h2><p class="finance-note">Хуучин ERP-ийн эх мөр, өртөг, элэгдлийн нотолгоог хадгалсан. Энэ нь үйл ажиллагааны объектын хувийн хэргээс тусдаа нягтлан бодох бүртгэл юм.</p><div class="module-table-wrap"><table class="module-table"><thead><tr><th>Код / нэр</th><th>Огноо</th><th>Тоо</th><th>Анхны өртөг</th><th>Хуримтлагдсан элэгдэл</th><th>Үлдэгдэл өртөг</th></tr></thead><tbody>${d.assets.map((x) => `<tr><td><strong>${esc(x.asset_code)}</strong><small>${esc(x.asset_name)} · ${esc(x.account_code || "дансгүй")}</small></td><td>${date(x.acquisition_date)}</td><td>${x.quantity} ${esc(x.unit)}</td><td>${money(x.initial_value)}</td><td>${money(x.accumulated_depreciation)}</td><td>${money(x.book_value)}</td></tr>`).join("") || `<tr><td colspan="6">Хөрөнгө бүртгэгдээгүй байна.</td></tr>`}</tbody></table></div></section>`;
}
function toolsView(d) {
  return `<div class="finance-layout"><section class="finance-panel"><h2>Орлого, зарлагын чиг хандлага</h2>${financeChart(d.trend)}</section><section class="finance-panel"><h2>Баталгаатай импорт</h2><form class="finance-form" id="financeImportForm"><input name="file" type="file" accept=".csv,.xlsx" required><button class="primary">Импортлох</button><button class="secondary" type="button" id="financeTemplate">Загвар CSV татах</button></form><small>Хуучин ERP-ийн шалгагдсан өгөгдөл эх мөрийн нотолгоотой орсон. Дараагийн файл бүр мөн шалгалт, баталгаажуулалтаар нэмэгдэнэ.</small></section></div>`;
}
function reportsView(d) {
  return `${financeCards(d.summary)}<section class="finance-panel"><h2>Нэгдсэн тайлангийн суурь</h2><p>Сонгосон хугацааны ${d.summary.transaction_count} гүйлгээ, ${d.obligations.length} өглөг/авлага, ${d.materials.length} материалын олголтыг нэг эх сурвалжаас нэгтгэв.</p><p class="finance-note">Цалин, татвар, элэгдэл болон санхүүгийн албан ёсны тайлан нь эх өгөгдлийн баталгаажуулалт, дансны бодлого тохирсны дараагийн үе шат.</p></section>`;
}
function renderFinance() {
  const d = state.financeData;
  if (!d) {
    $("#pageContent").innerHTML = header(
      "САНХҮҮ, БҮРТГЭЛ",
      "Нягтлан бодогчийн ажлын талбар",
      "Мэдээллийг ачаалж байна...",
    );
    queueMicrotask(loadFinance);
    return;
  }
  const filter = `<form class="finance-filter" id="financeFilter"><label>Эхлэх<input name="from" type="date" value="${esc(d.from)}"></label><label>Дуусах<input name="to" type="date" value="${esc(d.to)}"></label><button class="secondary">Шүүх</button></form>`;
  let body = financeCards(d.summary) + toolsView(d);
  if (state.financeTab === "journal") body = journalTable(d) + toolsView(d);
  if (["payable", "receivable"].includes(state.financeTab))
    body = obligationView(d, state.financeTab);
  if (state.financeTab === "materials") body = materialsView(d);
  if (state.financeTab === "budgets") body = budgetView(d);
  if (state.financeTab === "assets") body = assetsView(d);
  if (state.financeTab === "reports") body = reportsView(d);
  $("#pageContent").innerHTML =
    `${header("САНХҮҮ, БҮРТГЭЛ", "Нягтлан бодогчийн ажлын талбар", "Өглөг, авлага, материал, хөрөнгө болон тайланг нэг холбоотой орчноос хянана.", filter)}${financeTabs()}${body}`;
}
async function financeReload(message) {
  state.financeData = null;
  await loadFinance();
  if (message) toast(message);
}
document.addEventListener("click", async (event) => {
  const tab = event.target.closest("[data-finance-tab]");
  if (tab) {
    state.financeTab = tab.dataset.financeTab;
    renderFinance();
    return;
  }
  const settle = event.target.closest("[data-settle-id]");
  if (settle) {
    const amount = prompt("Төлсөн дүн", settle.dataset.settleBalance);
    if (!amount) return;
    const reference = prompt("Төлбөрийн баримтын дугаар");
    if (!reference) return;
    try {
      await api(
        `/api/finance/obligations/${settle.dataset.settleId}/settlements`,
        {
          method: "POST",
          body: JSON.stringify({ amount, reference, note: "" }),
        },
      );
      await financeReload("Төлөлт бүртгэгдлээ");
    } catch (error) {
      toast(error.message, true);
    }
    return;
  }
  const review = event.target.closest("[data-material-review]");
  if (review) {
    const treatment = prompt(
      "Ангилал: expense, asset, work_in_progress, no_charge",
      "expense",
    );
    if (!treatment) return;
    const amount = prompt("Санхүүгийн дүн", "0");
    if (amount === null) return;
    const documentReference = prompt("Баримтын дугаар", "") ?? "";
    try {
      await api("/api/finance/material-reviews", {
        method: "POST",
        body: JSON.stringify({
          materialRequestId: review.dataset.materialReview,
          treatment,
          amount,
          currency: "MNT",
          accountCode: "",
          documentReference,
          status: documentReference ? "matched" : "exception",
          note: documentReference ? "" : "Баримт дутуу",
        }),
      });
      await financeReload("Материалын тулгалт хадгалагдлаа");
    } catch (error) {
      toast(error.message, true);
    }
    return;
  }
  if (event.target.closest("#financeTemplate")) {
    const response = await fetch("/api/finance/template.csv", {
      headers: { authorization: `Bearer ${state.token}` },
    });
    if (!response.ok) return toast("Загвар татаж чадсангүй", true);
    const url = URL.createObjectURL(await response.blob()),
      a = document.createElement("a");
    a.href = url;
    a.download = "finance-import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }
});
document.addEventListener("submit", async (event) => {
  const f = event.target;
  if (
    !["financeFilter", "financeImportForm", "financeBudgetForm"].includes(
      f.id,
    ) &&
    !f.dataset.obligationForm
  )
    return;
  event.preventDefault();
  try {
    if (f.id === "financeFilter") {
      state.financeFilter = Object.fromEntries(new FormData(f));
      return financeReload();
    }
    if (f.id === "financeImportForm") {
      const response = await fetch("/api/finance/imports", {
          method: "POST",
          headers: { authorization: `Bearer ${state.token}` },
          body: new FormData(f),
        }),
        body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Импорт амжилтгүй");
      return financeReload(`${body.job.rows_imported} гүйлгээ импортлогдлоо`);
    }
    if (f.id === "financeBudgetForm") {
      await api("/api/finance/budgets", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(new FormData(f))),
      });
      return financeReload("Төсөв хадгалагдлаа");
    }
    const values = Object.fromEntries(new FormData(f));
    values.direction = f.dataset.obligationForm;
    await api("/api/finance/obligations", {
      method: "POST",
      body: JSON.stringify(values),
    });
    await financeReload("Бүртгэл үүслээ");
  } catch (error) {
    toast(error.message, true);
  }
});
