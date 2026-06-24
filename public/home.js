(function () {
  let publicContents = [];
  let publicJobs = [];
  let lightingOverview = null;
  let hseOverview = null;

  const typeLabels = {
    work: "Ажлын бүртгэл",
    job: "Ажлын байр",
    document: "Баримт бичиг",
    news: "Мэдээ"
  };

  function fmtNumber(value) {
    return Number(value || 0).toLocaleString("mn-MN");
  }

  function fmtPercent(value) {
    if (value == null || value === "") return "—";
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";
    return `${Number.isInteger(number) ? number : number.toFixed(1)}%`;
  }

  function fmtDate(value) {
    if (!value) return "Огноо бүртгээгүй";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
    return date.toLocaleDateString("mn-MN", { year: "numeric", month: "2-digit", day: "2-digit" });
  }

  function text(value, fallback = "") {
    return String(value || fallback).replace(/[&<>"']/g, (m) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[m]));
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el && value != null && value !== "") el.textContent = value;
  }

  function firstContent(contents, section, key) {
    return (contents || []).find(row => row.section === section && (!key || row.content_key === key));
  }

  function renderContents(contents) {
    const hero = firstContent(contents, "hero", "hero_title") || firstContent(contents, "hero");
    if (hero) {
      setText("heroTitle", hero.title);
      setText("heroText", hero.body);
      if (hero.image_url) {
        const img = document.querySelector(".hero-img");
        if (img) img.src = hero.image_url;
      }
    }

    const heroKicker = firstContent(contents, "hero", "hero_kicker");
    if (heroKicker) setText("heroKicker", heroKicker.title || heroKicker.body);

    const about = firstContent(contents, "about");
    if (about) {
      setText("aboutTitle", about.title);
      setText("aboutText", about.body);
    }

    const services = (contents || []).filter(row => row.section === "service").slice(0, 8);
    const grid = document.getElementById("serviceGrid");
    if (grid && services.length) {
      grid.innerHTML = services.map((row, idx) => `
        <article>
          <span>${String(idx + 1).padStart(2, "0")}</span>
          <h3>${text(row.title)}</h3>
          <p>${text(row.body || "Дэлгэрэнгүй мэдээлэл удахгүй нэмэгдэнэ.")}</p>
        </article>
      `).join("");
    }
  }

  function renderLatest(rows) {
    const el = document.getElementById("latestList");
    if (!el) return;
    if (!rows || !rows.length) {
      el.innerHTML = '<div class="loading">Одоогоор public-д харуулах мэдээлэл бүртгэгдээгүй байна.</div>';
      return;
    }
    el.innerHTML = rows.map((row) => `
      <article>
        <div class="latest-top">
          <span>${text(typeLabels[row.type] || row.category || "Мэдээлэл")}</span>
          <time>${text(fmtDate(row.date || row.created_at))}</time>
        </div>
        <h3>${text(row.title, "Гарчиггүй")}</h3>
        <p>${text(row.description || row.category || "Дэлгэрэнгүй мэдээлэл ERP системд бүртгэлтэй байна.").slice(0, 150)}</p>
      </article>
    `).join("");
  }

  function renderHomeHighlights(data) {
    setText("homeOverallPct", fmtPercent(data.lighting?.availability_pct));
    setText("homeRoadPct", fmtPercent(data.lighting?.road_availability_pct));
    setText("homeGerPct", fmtPercent(data.lighting?.ger_availability_pct));
    setText("homeTowerPct", fmtPercent(data.lighting?.tower_availability_pct));
    setText("homeTrafficPct", fmtPercent(data.lighting?.traffic_availability_pct));

    const list = document.getElementById("homeLatestList");
    if (!list) return;
    const rows = (data.latest || []).slice(0, 3);
    if (!rows.length) {
      list.innerHTML = '<div class="content-empty">Одоогоор нийтэлсэн мэдээ, ажлын байрны мэдээлэл алга.</div>';
      return;
    }
    list.innerHTML = rows.map(row => `
      <article class="home-latest-card">
        <div class="latest-top">
          <span>${text(typeLabels[row.type] || row.category || "Мэдээлэл")}</span>
          <time>${text(fmtDate(row.date || row.created_at))}</time>
        </div>
        <h3>${text(row.title, "Гарчиггүй")}</h3>
        <p>${text(row.description || row.category || "Дэлгэрэнгүй мэдээлэл удахгүй нэмэгдэнэ.").slice(0, 160)}</p>
      </article>
    `).join("");
  }

  const pageMeta = {
    about: ["Бидний тухай", "Байгууллагын танилцуулга"],
    stages: ["Үйл ажиллагааны үе шат", "Байгууллагын хөгжлийн тойм"],
    job: ["Хүний нөөц", "Сонгон шалгаруулалт, ажлын байр"],
    news: ["Мэдээ мэдээлэл", "Сүүлийн мэдээ, зар мэдээлэл"],
    sustainability: ["Тогтвортой хөгжил", "Нийгмийн хариуцлага, байгаль орчин, ХАБЭА"],
    transparency: ["Ил тод", "Тайлан, тендер, худалдан авалт"],
    contact: ["Холбоо барих", "Хаяг, утас, цахим шуудан"],
    service: ["Үйл ажиллагаа", "Үйлчилгээний мэдээлэл"],
    lighting: ["Гэрэлтүүлгийн тойм", "Иргэдэд зориулсан ерөнхий мэдээлэл"],
    hse: ["ХАБЭА / Аюул мэдээлэх", "Хөдөлмөрийн аюулгүй байдал, эрүүл ахуй"]
  };

  const sectionMap = {
    sustainability: "service",
    transparency: "news"
  };

  function pageRows(page, titleFilter) {
    const section = sectionMap[page] || page;
    let rows = publicContents.filter(row => row.section === section);
    if (titleFilter) {
      const wanted = titleFilter.trim().toLowerCase();
      const exact = rows.filter(row => String(row.title || "").trim().toLowerCase() === wanted);
      if (exact.length) rows = exact;
    }
    return rows;
  }

  function renderLightingOverview() {
    const data = lightingOverview || {};
    const total = Number(data.total_heads || 0);
    const working = Number(data.working_heads || 0);
    const broken = Number(data.broken_heads || 0);
    const pct = fmtPercent(data.availability_pct);
    return `
      <div class="overview-grid">
        <article><b>${fmtNumber(total)}</b><span>Нийт гэрэлтүүлгийн толгой</span></article>
        <article><b>${fmtNumber(working)}</b><span>Ажиллаж байгаа</span></article>
        <article><b>${fmtNumber(broken)}</b><span>Бүртгэлтэй гэмтэл</span></article>
        <article><b>${pct}</b><span>Ерөнхий хэвийн ажиллагаа</span></article>
      </div>
      <article class="content-card">
        <h2>Ерөнхий мэдээлэл</h2>
        <p>Энэ хэсэгт гудамж, гэр хороолол, цамхагийн гэрэлтүүлгийн ERP-д бүртгэгдсэн ерөнхий тоон мэдээллийг харуулж байна. Дотоод төхөөрөмжийн код, нарийвчилсан байршил, ажилтны тайлан public талд харагдахгүй.</p>
      </article>
      <article class="content-card">
        <h2>Төрлөөр</h2>
        <p>Авто замын гэрэл: ${fmtNumber(data.road_heads)}\nГэр хорооллын гэрэл: ${fmtNumber(data.ger_heads)}\nЦамхагийн гэрэл: ${fmtNumber(data.tower_heads)}\nГэрлэн дохио: ${fmtNumber(data.traffic_working)} / ${fmtNumber(data.traffic_total)} асаалттай</p>
      </article>
    `;
  }

  function renderHseOverview() {
    const data = hseOverview || {};
    return `
      <div class="overview-grid">
        <article><b>${fmtNumber(data.open_public_reports)}</b><span>Нээлттэй public мэдээлэл</span></article>
        <article><b>${fmtNumber(data.this_month_reports)}</b><span>Энэ сарын public мэдээлэл</span></article>
        <article><b>${fmtNumber(data.internal_open_risks)}</b><span>ERP дотоод нээлттэй эрсдэл</span></article>
        <article><b>24/7</b><span>Аюул мэдээлэх боломж</span></article>
      </div>
      <article class="content-card">
        <h2>Аюул, эрсдэл мэдээлэх</h2>
        <p>Иргэн та гэрэлтүүлэг, зам талбай, тоног төхөөрөмж, хөдөлмөрийн аюулгүй байдалтай холбоотой эрсдэлтэй нөхцөл анзаарвал мэдээлнэ үү.</p>
        <div class="detail-actions">
          <button type="button" data-dialog-open="hazardDialog" data-dialog-tab="report">Гэмтэл мэдээлэх</button>
          <button type="button" data-dialog-open="hazardDialog" data-dialog-tab="track">Мэдээллийн төлөв шалгах</button>
        </div>
      </article>
    `;
  }

  function renderFallbackPage(page) {
    const fallbackPages = {
      about: `
        <article class="content-card">
          <h2>Хотын өдөр тутмын үйлчилгээг ил тод, хүртээмжтэй болгоно</h2>
          <p>“Чойбалсан хөгжил” ОНӨҮГ нь гудамж, зам талбайн гэрэлтүүлэг, гэрлэн дохио, хяналтын камер болон хотын үйлчилгээний хэвийн ажиллагааг ханган ажилладаг.</p>
        </article>`,
      stages: `
        <div class="detail-card-grid">
          <article class="content-card"><span class="detail-number">01</span><h2>Бүртгэл ба хяналт</h2><p>Хотын тоног төхөөрөмж, үйлчилгээний мэдээллийг нэгдсэн бүртгэлд төвлөрүүлнэ.</p></article>
          <article class="content-card"><span class="detail-number">02</span><h2>Төлөвлөлт</h2><p>Гэмтэл, хэрэгцээ, эрсдэлийн мэдээлэлд үндэслэн ажлыг төлөвлөнө.</p></article>
          <article class="content-card"><span class="detail-number">03</span><h2>Гүйцэтгэл</h2><p>Засвар үйлчилгээ, хяналтын ажлын явц болон үр дүнг бүртгэнэ.</p></article>
        </div>`,
      service: `
        <div class="detail-card-grid">
          <article class="content-card"><span class="detail-number">01</span><h2>Гэрэлтүүлэг</h2><p>Гудамж, зам талбайн гэрэлтүүлгийн бүртгэл, засвар үйлчилгээ, хяналт.</p></article>
          <article class="content-card"><span class="detail-number">02</span><h2>Камерын хяналт</h2><p>Хотын аюулгүй байдлыг дэмжих камер, тоног төхөөрөмжийн бүртгэл.</p></article>
          <article class="content-card"><span class="detail-number">03</span><h2>Ухаалаг хот</h2><p>IoT төхөөрөмж, хяналтын самбар, автоматжуулалтын мэдээлэл.</p></article>
          <article class="content-card"><span class="detail-number">04</span><h2>Хотын үйлчилгээ</h2><p>Засвар, үйлчилгээ, төлөвлөгөөт ажил болон гүйцэтгэлийн бүртгэл.</p></article>
        </div>`
    };
    return fallbackPages[page] || "";
  }

  function renderJobPostings() {
    if (!publicJobs.length) {
      return '<div class="content-empty">Одоогоор нээлттэй ажлын байр алга.</div>';
    }
    return publicJobs.map(row => `
      <article class="content-card">
        <h2>${text(row.title)}</h2>
        <p>${text(row.category || "")}${row.date ? `\nМатериал хүлээн авах хугацаа: ${text(fmtDate(row.date))}` : ""}${row.description ? `\n\n${text(row.description)}` : ""}</p>
      </article>
    `).join("");
  }

  function closeDropdowns(except = null) {
    document.querySelectorAll(".has-dropdown.open").forEach(item => {
      if (item === except) return;
      item.classList.remove("open");
      item.querySelector(".dropdown-toggle")?.setAttribute("aria-expanded", "false");
    });
  }

  function setMobileMenu(open) {
    const header = document.querySelector(".site-header");
    const toggle = document.querySelector(".nav-toggle");
    header?.classList.toggle("nav-open", open);
    toggle?.setAttribute("aria-expanded", String(open));
    if (!open) closeDropdowns();
  }

  function closeNavigation() {
    closeDropdowns();
    setMobileMenu(false);
  }

  function showHomePage(updateHistory = true) {
    document.getElementById("heroBlock")?.removeAttribute("hidden");
    document.getElementById("homeHighlights")?.removeAttribute("hidden");
    document.getElementById("contentPage")?.setAttribute("hidden", "");
    closeNavigation();
    if (updateHistory) history.pushState(null, "", "/");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function showContentPage(page, titleFilter = "", updateHistory = true) {
    if (page === "home") return showHomePage();
    const [title, kicker] = pageMeta[page] || ["Мэдээлэл", "Дэлгэрэнгүй"];
    const rows = pageRows(page, titleFilter);
    document.getElementById("heroBlock")?.setAttribute("hidden", "");
    document.getElementById("homeHighlights")?.setAttribute("hidden", "");
    closeNavigation();
    setText("contentKicker", kicker);
    setText("contentTitle", titleFilter || title);
    const body = document.getElementById("contentBody");
    if (body) {
      body.innerHTML = page === "lighting"
        ? renderLightingOverview()
        : page === "hse"
        ? renderHseOverview()
        : page === "job" && titleFilter === "Нээлттэй ажлын байр"
        ? renderJobPostings()
        : rows.length
        ? rows.map(row => `
            <article class="content-card">
              <h2>${text(row.title)}</h2>
              <p>${text(row.body || "Дэлгэрэнгүй мэдээлэл удахгүй нэмэгдэнэ.")}</p>
            </article>
          `).join("")
        : renderFallbackPage(page) || `<div class="content-empty">Энэ хэсэгт одоогоор мэдээлэл бүртгэгдээгүй байна. ERP-ийн “Вэб сайт” цэснээс мэдээлэл нэмнэ.</div>`;
    }
    document.getElementById("contentPage")?.removeAttribute("hidden");
    if (updateHistory) history.pushState(null, "", `/#${page}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function bindHazardForm() {
    const form = document.getElementById("hazardForm");
    if (!form) return;
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const result = document.getElementById("hazardResult");
      if (result) {
        result.hidden = true;
        result.textContent = "";
      }
      const image = document.getElementById("hazardImage")?.files?.[0];
      if (image && image.size > 5 * 1024 * 1024) {
        if (result) {
          result.hidden = false;
          result.textContent = "Зургийн хэмжээ 5MB-аас бага байна.";
        }
        return;
      }
      const payload = new FormData();
      payload.append("location", document.getElementById("hazardLocation")?.value || "");
      payload.append("hazard_type", document.getElementById("hazardType")?.value || "");
      payload.append("description", document.getElementById("hazardDescription")?.value || "");
      payload.append("reporter_name", document.getElementById("hazardName")?.value || "");
      payload.append("reporter_phone", document.getElementById("hazardPhone")?.value || "");
      if (image) payload.append("image", image);
      try {
        const res = await fetch("/api/public/hazard-reports", {
          method: "POST",
          body: payload
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Илгээхэд алдаа гарлаа");
        form.reset();
        if (result) {
          result.hidden = false;
          result.textContent = `Мэдээлэл хүлээн авлаа. Tracking код: ${data.tracking_code}`;
        }
      } catch (e) {
        if (result) {
          result.hidden = false;
          result.textContent = e.message || "Илгээхэд алдаа гарлаа";
        }
      }
    });
  }

  function bindTrackingForm() {
    const form = document.getElementById("trackingForm");
    if (!form) return;
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const code = String(document.getElementById("trackingCode")?.value || "").trim().toUpperCase();
      const result = document.getElementById("trackingResult");
      if (!code || !result) return;
      result.hidden = true;
      try {
        const res = await fetch(`/api/public/hazard-reports/${encodeURIComponent(code)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Мэдээлэл олдсонгүй");
        result.textContent = `${data.tracking_code} · ${data.status} · ${data.location}`;
        result.hidden = false;
      } catch (e) {
        result.textContent = e.message || "Шалгахад алдаа гарлаа";
        result.hidden = false;
      }
    });
  }

  function setDialogTab(tabName) {
    const selected = tabName === "track" ? "track" : "report";
    document.querySelectorAll("[data-dialog-tab-button]").forEach(button => {
      button.setAttribute("aria-selected", String(button.dataset.dialogTabButton === selected));
    });
    document.querySelectorAll("[data-dialog-panel]").forEach(panel => {
      panel.hidden = panel.dataset.dialogPanel !== selected;
    });
  }

  function openServiceDialog(tabName = "report") {
    const dialog = document.getElementById("hazardDialog");
    if (!dialog) return;
    setDialogTab(tabName);
    if (!dialog.open) dialog.showModal();
    document.body.classList.add("dialog-open");
    window.setTimeout(() => {
      const target = tabName === "track" ? document.getElementById("trackingCode") : document.getElementById("hazardLocation");
      target?.focus();
    }, 50);
  }

  function closeServiceDialog() {
    const dialog = document.getElementById("hazardDialog");
    if (dialog?.open) dialog.close();
  }

  function bindServiceDialog() {
    const dialog = document.getElementById("hazardDialog");
    document.addEventListener("click", event => {
      const opener = event.target.closest("[data-dialog-open]");
      if (opener) {
        event.preventDefault();
        openServiceDialog(opener.dataset.dialogTab || "report");
        return;
      }
      if (event.target.closest("[data-dialog-close]")) closeServiceDialog();
    });
    document.querySelectorAll("[data-dialog-tab-button]").forEach(button => {
      button.addEventListener("click", () => setDialogTab(button.dataset.dialogTabButton));
    });
    dialog?.addEventListener("click", event => {
      if (event.target === dialog) closeServiceDialog();
    });
    dialog?.addEventListener("close", () => document.body.classList.remove("dialog-open"));
    bindHazardForm();
    bindTrackingForm();
  }

  function bindNavigation() {
    const navToggle = document.querySelector(".nav-toggle");
    navToggle?.addEventListener("click", () => {
      const header = document.querySelector(".site-header");
      setMobileMenu(!header?.classList.contains("nav-open"));
    });

    document.querySelectorAll(".dropdown-toggle").forEach(toggle => {
      toggle.addEventListener("click", event => {
        event.stopPropagation();
        const item = toggle.closest(".has-dropdown");
        const willOpen = !item?.classList.contains("open");
        closeDropdowns(item);
        item?.classList.toggle("open", willOpen);
        toggle.setAttribute("aria-expanded", String(willOpen));
      });
    });

    document.querySelectorAll("[data-page]").forEach(link => {
      link.addEventListener("click", event => {
        event.preventDefault();
        showContentPage(link.dataset.page, link.dataset.title || "");
      });
    });

    document.addEventListener("click", event => {
      if (!event.target.closest(".has-dropdown")) closeDropdowns();
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") closeNavigation();
    });
    window.addEventListener("resize", () => {
      if (window.innerWidth > 980) setMobileMenu(false);
    });
    window.addEventListener("popstate", () => {
      const page = location.hash.replace("#", "");
      if (page) showContentPage(page, "", false);
      else showHomePage(false);
    });
  }

  async function loadHome() {
    try {
      const res = await fetch("/api/public/home", { headers: { "Accept": "application/json" } });
      if (!res.ok) throw new Error("bad response");
      const data = await res.json();
      setText("statLights", fmtNumber(data.stats?.lights));
      setText("statCameras", fmtNumber(data.stats?.cameras));
      setText("statWorks", fmtNumber(data.stats?.works));
      setText("statJobs", fmtNumber(data.stats?.jobs));
      publicContents = data.contents || [];
      publicJobs = data.jobs || [];
      lightingOverview = data.lighting || null;
      hseOverview = data.hse || null;
      renderOrganization(data.organization || {});
      renderContents(data.contents || []);
      renderLatest(data.latest);
      renderHomeHighlights(data);
      const hashPage = location.hash.replace("#", "");
      if (hashPage && hashPage !== "home") showContentPage(hashPage, "", false);
    } catch (_e) {
      renderLatest([]);
    }
  }

  function renderOrganization(org) {
    setText("footerOrgName", org.org_name || "Чойбалсан хөгжил ОНӨҮГ");
    setText("footerAddress", org.address || "Дорнод аймаг, Чойбалсан хот");
    const phone = document.getElementById("footerPhone");
    const email = document.getElementById("footerEmail");
    if (phone) {
      phone.textContent = org.phone ? `Утас: ${org.phone}` : "";
      phone.hidden = !org.phone;
    }
    if (email) {
      email.textContent = org.email ? `И-мэйл: ${org.email}` : "";
      email.hidden = !org.email;
    }
  }

  window.showHomePage = showHomePage;
  bindNavigation();
  bindServiceDialog();
  loadHome();
})();
