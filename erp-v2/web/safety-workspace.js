"use strict";

(() => {
  const STORAGE_KEY = "overva_safety_workspace_tab";
  const PAGE_SIZE = 30;
  const validTabs = new Set(["focus", "start", "completion", "active", "records"]);
  const savedTab = sessionStorage.getItem(STORAGE_KEY);
  const workspace = {
    tab: validTabs.has(savedTab) ? savedTab : "focus",
    query: "",
    due: "all",
    assignee: "all",
    limit: PAGE_SIZE,
    guideOpen: localStorage.getItem("overva_safety_role_guide") !== "closed",
  };

  const tabDefinitions = [
    { key: "focus", label: "Миний хийх ажил" },
    { key: "start", label: "Эхлэх зөвшөөрөл" },
    { key: "completion", label: "Дуусгалтын шалгалт" },
    { key: "active", label: "Хяналтад буй ажил" },
    { key: "records", label: "Эрсдэл ба бүртгэл" },
  ];

  const queueDefinitions = {
    focus: {
      title: "Одоо шийдвэрлэх ажил",
      note: "Дуусгалтын шалгалт болон эхлэх зөвшөөрөл хүлээж буй ажлууд",
    },
    start: {
      title: "Эхлэх зөвшөөрөл",
      note: "Эрсдэл, хамгаалалт, PPE болон checklist-ийг шалгана",
    },
    completion: {
      title: "Дуусгалтын шалгалт",
      note: "Гүйцэтгэлийн нотолгоог хүлээн авах эсвэл буцаана",
    },
    active: {
      title: "Хяналтад буй ажил",
      note: "Хүчинтэй зөвшөөрөлтэй гүйцэтгэлийг хянаж, шаардлагатай бол зогсооно",
    },
  };

  function queues(items) {
    const start = items.filter(item => item.workflow_stage === "awaiting_safety_start");
    const completion = items.filter(item => item.workflow_stage === "awaiting_safety_completion");
    const active = items.filter(item => item.workflow_stage === "execution");
    return { start, completion, active, focus: [...completion, ...start] };
  }

  function dueTimestamp(value) {
    const timestamp = value ? new Date(value).getTime() : Number.POSITIVE_INFINITY;
    return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
  }

  function isOverdue(item) {
    const due = dueTimestamp(item.due_at);
    return Number.isFinite(due) && due < Date.now();
  }

  function isToday(item) {
    if (!item.due_at) return false;
    const due = new Date(item.due_at);
    const now = new Date();
    return due.getFullYear() === now.getFullYear()
      && due.getMonth() === now.getMonth()
      && due.getDate() === now.getDate();
  }

  function isWithinSevenDays(item) {
    const due = dueTimestamp(item.due_at);
    return Number.isFinite(due) && due >= Date.now() && due <= Date.now() + (7 * 24 * 60 * 60 * 1000);
  }

  function filteredItems(items) {
    const query = workspace.query.trim().toLocaleLowerCase("mn-MN");
    return [...items]
      .filter(item => {
        const text = [item.title, item.work_type_name, item.assigned_name, item.description]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase("mn-MN");
        if (query && !text.includes(query)) return false;
        if (workspace.assignee !== "all" && String(item.assigned_to || "unassigned") !== workspace.assignee) return false;
        if (workspace.due === "overdue" && !isOverdue(item)) return false;
        if (workspace.due === "today" && !isToday(item)) return false;
        if (workspace.due === "week" && !isWithinSevenDays(item)) return false;
        return true;
      })
      .sort((left, right) => {
        if (workspace.tab === "focus" && left.workflow_stage !== right.workflow_stage) {
          return left.workflow_stage === "awaiting_safety_completion" ? -1 : 1;
        }
        if (isOverdue(left) !== isOverdue(right)) return isOverdue(left) ? -1 : 1;
        return dueTimestamp(left.due_at) - dueTimestamp(right.due_at)
          || new Date(left.updated_at).getTime() - new Date(right.updated_at).getTime();
      });
  }

  function countForTab(key, grouped) {
    if (key === "records") return null;
    return grouped[key].length;
  }

  function tabHtml(definition, grouped) {
    const count = countForTab(definition.key, grouped);
    return `<button type="button" role="tab" aria-selected="${workspace.tab === definition.key}"
      class="${workspace.tab === definition.key ? "active" : ""}" data-safety-workspace-tab="${definition.key}">
      <span>${definition.label}</span>${count === null ? "" : `<b>${count}</b>`}
    </button>`;
  }

  function assigneeOptions(items) {
    const names = new Map();
    for (const item of items) {
      const id = String(item.assigned_to || "unassigned");
      if (!names.has(id)) names.set(id, item.assigned_name || "Хариуцагчгүй");
    }
    const sorted = [...names.entries()].sort((a, b) => a[1].localeCompare(b[1], "mn"));
    return `<option value="all">Бүх хариуцагч</option>${sorted.map(([id, name]) =>
      `<option value="${esc(id)}" ${workspace.assignee === id ? "selected" : ""}>${esc(name)}</option>`).join("")}`;
  }

  function roleGuideHtml() {
    return `<section class="safety-role-guide ${workspace.guideOpen ? "open" : ""}">
      <button type="button" class="safety-role-guide-toggle" data-safety-guide-toggle aria-expanded="${workspace.guideOpen}">
        <span><b>ХАБЭА ажилтны ажлын дараалал</b><small>Зөвшөөрөл, хяналт, нотолгоо нэг урсгалд</small></span>
        <span>${workspace.guideOpen ? "Хураах" : "Харуулах"}</span>
      </button>
      <div class="safety-role-guide-body">
        <div class="safety-workflow-path" aria-label="ХАБЭА ажлын дараалал">
          <span>Ажил үүсэх</span><i>→</i><strong>Эхлэх зөвшөөрөл</strong><i>→</i><span>Гүйцэтгэл</span><i>→</i>
          <span>Дуусгаж илгээх</span><i>→</i><strong>Талбайн шалгалт</strong><i>→</i><span>Ерөнхий инженер</span>
        </div>
        <div class="safety-role-duties">
          <p><b>Одоо хийх:</b> эрсдэлийг үнэлэх, хамгаалалт ба PPE-г шалгах, дууссан ажлын нотолгоонд дүгнэлт өгөх.</p>
          <p><b>Анхаарах:</b> хугацаа хэтэрсэн болон буцаагдсан ажлыг түрүүлж шийдвэрлэж, аюул илэрвэл гүйцэтгэлийг зогсооно.</p>
        </div>
      </div>
    </section>`;
  }

  function actionFor(item) {
    if (item.workflow_stage === "awaiting_safety_completion") return "safety_accept_completion";
    if (item.workflow_stage === "execution") return "safety_suspend_execution";
    return "safety_authorize_start";
  }

  function returnActionFor(item) {
    if (item.workflow_stage === "awaiting_safety_completion") return "safety_return_to_execution";
    if (item.workflow_stage === "awaiting_safety_start") return "safety_return_start";
    return null;
  }

  function stageLabel(item) {
    if (item.workflow_stage === "awaiting_safety_completion") return "Дуусгалт шалгах";
    if (item.workflow_stage === "execution") return "Хяналтад";
    return "Эхлэл зөвшөөрөх";
  }

  function riskPill(item) {
    const score = Number(item.start_risk_score || 0);
    if (!score) return "";
    const band = score >= 17 ? "critical" : score >= 10 ? "high" : score >= 5 ? "medium" : "low";
    return `<span class="safety-pill risk-${band}">Эрсдэл ${score}</span>`;
  }

  function workCardHtml(item) {
    const action = actionFor(item);
    const returnAction = returnActionFor(item);
    return `<article class="safety-role-work-card ${isOverdue(item) ? "overdue" : ""}">
      <div class="safety-role-work-main">
        <div class="safety-role-card-top"><span class="safety-role-stage">${stageLabel(item)}</span>
          ${isOverdue(item) ? '<span class="safety-role-overdue">Хугацаа хэтэрсэн</span>' : ""}${riskPill(item)}</div>
        <button type="button" class="safety-role-work-title" data-history-id="${item.id}">${esc(item.title)}</button>
        <p>${esc(item.work_type_name || item.category || "Ажлын төрөлгүй")}</p>
        <dl><div><dt>Хариуцагч</dt><dd>${esc(item.assigned_name || "Хариуцагчгүй")}</dd></div>
          <div><dt>Хугацаа</dt><dd>${date(item.due_at)}</dd></div></dl>
      </div>
      <div class="safety-role-work-actions">
        <button type="button" class="secondary" data-history-id="${item.id}">Түүх, нотолгоо</button>
        <button type="button" class="primary" data-workflow-action="${action}" data-workflow-id="${item.id}">${esc(workflowActionLabels[action])}</button>
        ${returnAction ? `<button type="button" class="secondary danger-text" data-workflow-action="${returnAction}" data-workflow-id="${item.id}">${esc(workflowActionLabels[returnAction])}</button>` : ""}
      </div>
    </article>`;
  }

  function queueHtml(allItems, selectedItems) {
    const definition = queueDefinitions[workspace.tab];
    const filtered = filteredItems(selectedItems);
    const visible = filtered.slice(0, workspace.limit);
    return `<section class="safety-role-queue" aria-live="polite">
      <header><div><h2>${definition.title}</h2><p>${definition.note}</p></div><b>${filtered.length}</b></header>
      <div class="safety-role-toolbar">
        <label class="safety-role-search"><span>Ажил хайх</span><input type="search" value="${esc(workspace.query)}"
          data-safety-workspace-search placeholder="Нэр, төрөл, хариуцагчаар хайх"></label>
        <label><span>Хугацаа</span><select data-safety-workspace-due>
          <option value="all" ${workspace.due === "all" ? "selected" : ""}>Бүх хугацаа</option>
          <option value="overdue" ${workspace.due === "overdue" ? "selected" : ""}>Хугацаа хэтэрсэн</option>
          <option value="today" ${workspace.due === "today" ? "selected" : ""}>Өнөөдөр</option>
          <option value="week" ${workspace.due === "week" ? "selected" : ""}>7 хоногт</option>
        </select></label>
        <label><span>Хариуцагч</span><select data-safety-workspace-assignee>${assigneeOptions(allItems)}</select></label>
      </div>
      <div class="safety-role-work-list">${visible.map(workCardHtml).join("") ||
        '<div class="safety-role-empty"><b>Тохирох ажил алга</b><span>Шүүлтүүрээ өөрчлөх эсвэл өөр tab сонгоно уу.</span></div>'}</div>
      ${visible.length < filtered.length ? `<button type="button" class="safety-role-more" data-safety-workspace-more>Дараагийн ${Math.min(PAGE_SIZE, filtered.length - visible.length)} ажлыг харуулах</button>` : ""}
    </section>`;
  }

  function recordsIntroHtml(data) {
    return `<section class="safety-records-intro"><div><h2>Эрсдэл, осол ба ХАБЭА нотолгоо</h2>
      <p>Доорх бүртгэлүүдээс эрсдэл, осол зөрчил, зааварчилгаа, сургалт болон аюулгүй маршрутыг хөтөлнө.</p></div>
      <div><b>${data.risks?.length || 0}</b><span>эрсдэл</span><b>${data.incidents?.length || 0}</b><span>осол, зөрчил</span></div></section>`;
  }

  function updatePageHeader() {
    const header = document.querySelector("#pageContent .page-header");
    if (!header) return;
    const title = header.querySelector("h1");
    const description = header.querySelector("p");
    if (title) title.textContent = "Миний ХАБЭА ажлын талбар";
    if (description) description.textContent = "Өнөөдөр шийдвэрлэх зөвшөөрөл, шалгалт, хяналт болон ХАБЭА бүртгэлээ нэг дор удирдана.";
  }

  function renderSafetyRoleWorkspace(data) {
    const cards = document.querySelector("#pageContent .safety-cards");
    if (!cards) return;
    document.getElementById("safetyRoleWorkspace")?.remove();
    const allItems = data.workOrders || [];
    const grouped = queues(allItems);
    const urgent = grouped.completion.length;
    const shell = document.createElement("div");
    shell.id = "safetyRoleWorkspace";
    shell.className = "safety-role-workspace";
    shell.innerHTML = `${workspace.tab === "focus" ? roleGuideHtml() : ""}
      ${urgent && workspace.tab === "focus" ? `<div class="safety-role-alert"><b>${urgent} ажил дуусгалтын шалгалт хүлээж байна</b><span>Эдгээр ажлыг эхэнд эрэмбэлж харууллаа.</span></div>` : ""}
      <nav class="safety-role-tabs" role="tablist" aria-label="ХАБЭА ажлын талбар">${tabDefinitions.map(item => tabHtml(item, grouped)).join("")}</nav>
      ${workspace.tab === "records" ? recordsIntroHtml(data) : queueHtml(allItems, grouped[workspace.tab])}`;
    cards.insertAdjacentElement("afterend", shell);
    document.getElementById("pageContent")?.setAttribute("data-safety-workspace-view", workspace.tab);
    updatePageHeader();
  }

  window.renderSafetyWorkQueues = renderSafetyRoleWorkspace;

  function rerender(options = {}) {
    if (!state.safetyData || state.view !== "safety") return;
    renderSafetyRoleWorkspace(state.safetyData);
    if (options.focusSearch) {
      requestAnimationFrame(() => {
        const input = document.querySelector("[data-safety-workspace-search]");
        if (!input) return;
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      });
    }
  }

  document.addEventListener("click", event => {
    const tab = event.target.closest("[data-safety-workspace-tab]");
    const more = event.target.closest("[data-safety-workspace-more]");
    const guide = event.target.closest("[data-safety-guide-toggle]");
    if (tab) {
      workspace.tab = tab.dataset.safetyWorkspaceTab;
      workspace.limit = PAGE_SIZE;
      sessionStorage.setItem(STORAGE_KEY, workspace.tab);
      rerender();
    }
    if (more) {
      workspace.limit += PAGE_SIZE;
      rerender();
    }
    if (guide) {
      workspace.guideOpen = !workspace.guideOpen;
      localStorage.setItem("overva_safety_role_guide", workspace.guideOpen ? "open" : "closed");
      rerender();
    }
  });

  document.addEventListener("input", event => {
    if (!event.target.matches("[data-safety-workspace-search]")) return;
    workspace.query = event.target.value;
    workspace.limit = PAGE_SIZE;
    rerender({ focusSearch: true });
  });

  document.addEventListener("change", event => {
    if (event.target.matches("[data-safety-workspace-due]")) workspace.due = event.target.value;
    else if (event.target.matches("[data-safety-workspace-assignee]")) workspace.assignee = event.target.value;
    else return;
    workspace.limit = PAGE_SIZE;
    rerender();
  });
})();
