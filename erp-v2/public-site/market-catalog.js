"use strict";

(() => {
  const DRAFT_STORAGE_KEY = "overva.market.listing-drafts.v1";
  const categoryLabels = { apps:"Апп", modules:"Модуль", connectors:"Холбогч", templates:"Загвар", agents:"AI агент" };
  const products = [
    { id:"inventory", eyebrow:"Апп · App", title:"Агуулахын удирдлага", vendor:"OVERVA Apps", summary:"Бараа, хөдөлгөөн, үлдэгдэл болон хариуцагчийг нэг урсгалаар хянах жишиг шийдэл.", fit:"Бараа материалын бүртгэлээ Excel болон цаасаар хөтөлдөг байгууллага", features:["Барааны нэгдсэн бүртгэл","Орлого, зарлагын хөдөлгөөн","Үлдэгдэл ба доод түвшний сануулга","Хариуцагч болон өөрчлөлтийн түүх"], support:"Нэвтрүүлэлтийн нөхцөлийг нийлүүлэгчтэй тохирно", price:"Үнэ тогтоогоогүй", tone:"blue" },
    { id:"people", eyebrow:"Модуль · Module", title:"Ажилтны өөртөө үйлчлэх модуль", vendor:"Нийлүүлэгчийн жишээ", summary:"Чөлөө, хүсэлт болон хувийн мэдээллийн шинэчлэлийг ажилтан өөрөө хийх гар утасны шийдлийн жишээ.", fit:"Ажилтны хүсэлт, мэдээлэл шинэчлэлтийг гараар дамжуулдаг байгууллага", features:["Чөлөөний хүсэлт","Хувийн мэдээлэл шинэчлэх","Хүсэлтийн төлөв харах","Гар утсанд тохирсон хэрэглээ"], support:"Нийлүүлэгчийн нөхцөл тодорхой болоогүй", price:"Үнэ тогтоогоогүй", tone:"green" },
    { id:"crm", eyebrow:"Загвар · Template", title:"Жижиг бизнесийн CRM загвар", vendor:"Нийлүүлэгчийн жишээ", summary:"Харилцагч, уулзалт, санал болон борлуулалтын үе шатыг нэг дор хөтлөх жишиг загвар.", fit:"Харилцагчийн түүх, борлуулалтаа хүснэгтээр хөтөлдөг жижиг баг", features:["Харилцагчийн бүртгэл","Уулзалт ба дараагийн алхам","Борлуулалтын үе шат","Энгийн удирдлагын тойм"], support:"Нийлүүлэгчийн нөхцөл тодорхой болоогүй", price:"Үнэ тогтоогоогүй", tone:"violet" },
    { id:"smart-import", eyebrow:"Холбогч · Connector", title:"Excel Smart Import холбогч", vendor:"OVERVA Apps", summary:"Хүснэгтийн өгөгдлийг шалгаж, зөрүүг хүнээр батлуулаад аюулгүй оруулах жишиг холбогч.", fit:"Олон Excel файлаас давхардсан болон дутуу өгөгдөл нэгтгэдэг байгууллага", features:["Баганын утга таних","Алдаа ба давхардал илрүүлэх","Хүний баталгаажуулалт","Импортын эх сурвалжийн түүх"], support:"Файлын бүтэц дээр үндэслэн тохирно", price:"Үнэ тогтоогоогүй", tone:"amber" },
    { id:"document-ai", eyebrow:"AI агент · AI agent", title:"Баримт шалгах AI агент", vendor:"Нийлүүлэгчийн жишээ", summary:"Баримтын бүрдэл, зөрүүг санал болгож, эцсийн шийдвэрийг хүнд үлдээх жишиг агент.", fit:"Олон баримтын бүрдэл, нийцлийг гараар шалгадаг баг", features:["Бүрдлийн санал","Зөрүү илрүүлэх","Шийдвэрийг хүнд үлдээх","Шалгалтын мөр хадгалах"], support:"Хэрэглээний бодлого тодорхой болоогүй", price:"Үнэ тогтоогоогүй", tone:"navy" }
  ];

  const grid = document.getElementById("productMarketGrid");
  if (!grid) return;

  const selected = new Set();
  const byId = id => products.find(product => product.id === id);

  function requestSeed(product) {
    return {
      type:"Одоогийн систем сайжруулах",
      title:`${product.title} бүтээгдэхүүнийг сонирхож байна`,
      problem:`${product.title} манай байгууллагын хэрэгцээнд тохирох эсэх, ашиглах нөхцөл болон үнийн саналыг тодруулах хүсэлтэй байна.`,
      outcome:`${product.title}-ийг ашиглах боломж, үнэ, нэвтрүүлэлт болон дэмжлэгийн нөхцөлийг нийлүүлэгчтэй тохирох.`,
      acceptance:"Нийлүүлэгч боломж, үнэ, хугацаа болон дэмжлэгийн нөхцөлийг ойлгомжтой санал болгосон байна.",
      capabilities:["Бүртгэл, мастер өгөгдөл"]
    };
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  const overlay = el("div", "catalog-overlay");
  overlay.hidden = true;
  overlay.innerHTML = `<section class="catalog-detail" role="dialog" aria-modal="true" aria-labelledby="catalogDetailTitle"><button class="catalog-close" type="button" aria-label="Хаах">×</button><div id="catalogDetailContent"></div></section>`;
  document.body.append(overlay);

  const compareTray = el("aside", "catalog-compare-tray");
  compareTray.hidden = true;
  document.body.append(compareTray);

  function openDetail(product) {
    const content = overlay.querySelector("#catalogDetailContent");
    content.replaceChildren();
    const hero = el("div", `catalog-detail-hero tone-${product.tone}`);
    const intro = el("div", "catalog-detail-intro");
    intro.append(el("span", "catalog-kicker", `${product.eyebrow} · ЖИШИГ / SAMPLE`), el("h2", "", product.title), el("p", "", product.summary));
    hero.append(intro, el("div", "catalog-monogram", product.title.split(" ").slice(0,2).map(word => word[0]).join("")));
    const body = el("div", "catalog-detail-body");
    const main = el("div", "catalog-detail-main");
    main.append(el("h3", "", "Юу хийж чадах вэ? / Capabilities"));
    const list = el("ul", "catalog-feature-list");
    product.features.forEach(feature => list.append(el("li", "", feature)));
    main.append(list, el("h3", "", "Хэнд тохирох вэ? / Best fit"), el("p", "", product.fit));
    const facts = el("aside", "catalog-facts");
    [["Нийлүүлэгч / Vendor",product.vendor],["Үнэ / Price",product.price],["Дэмжлэг / Support",product.support]].forEach(([label,value]) => { const row=el("div",""); row.append(el("small","",label),el("strong","",value)); facts.append(row); });
    const interest = el("button", "catalog-interest-button", "Сонирхож байна · Нөхцөл асуух");
    interest.type = "button";
    interest.addEventListener("click", () => {
      overlay.hidden = true;
      document.body.classList.remove("catalog-open");
      document.dispatchEvent(new CustomEvent("overva:product-interest", { detail:requestSeed(product) }));
    });
    facts.append(interest);
    const notice = el("p", "catalog-sample-notice", "Энэ бол UX шалгах жишиг мэдээлэл. Бодит худалдаа, захиалга эсвэл нийлүүлэгчийн амлалт биш.");
    body.append(main, facts);
    content.append(hero, body, notice);
    overlay.hidden = false;
    document.body.classList.add("catalog-open");
    overlay.querySelector(".catalog-close").focus();
  }

  function renderCompare() {
    const items = [...selected].map(byId).filter(Boolean);
    compareTray.hidden = items.length === 0;
    compareTray.replaceChildren();
    if (!items.length) return;
    const copy = el("div", "catalog-compare-copy");
    copy.append(el("strong", "", `${items.length} бүтээгдэхүүн сонгосон`), el("small", "", "3 хүртэл жишгийг зэрэгцүүлж харна"));
    const names = el("div", "catalog-compare-names");
    items.forEach(item => names.append(el("span", "", item.title)));
    const open = el("button", "catalog-compare-open", "Харьцуулах / Compare");
    open.type = "button"; open.disabled = items.length < 2;
    const clear = el("button", "catalog-compare-clear", "Цэвэрлэх"); clear.type = "button";
    open.addEventListener("click", () => openComparison(items));
    clear.addEventListener("click", () => { selected.clear(); syncCompareButtons(); renderCompare(); });
    compareTray.append(copy,names,open,clear);
  }

  function openComparison(items) {
    const content = overlay.querySelector("#catalogDetailContent");
    content.replaceChildren(el("span","catalog-kicker","ХАРЬЦУУЛАЛТ · COMPARISON"),el("h2","catalog-compare-title","Өөрт тохирох шийдлээ зэрэгцүүлж харах"));
    const table = el("div","catalog-compare-table");
    const rows = [["Бүтээгдэхүүн / Product",p=>p.title],["Төрөл / Type",p=>p.eyebrow],["Нийлүүлэгч / Vendor",p=>p.vendor],["Тохирох хэрэглээ / Best fit",p=>p.fit],["Гол боломж / Key capabilities",p=>p.features.join(" · ")],["Үнэ / Price",p=>p.price],["Дэмжлэг / Support",p=>p.support]];
    rows.forEach(([label,value]) => { const row=el("div","catalog-compare-row"); row.append(el("strong","",label)); items.forEach(item=>row.append(el("span","",value(item)))); table.append(row); });
    content.append(table,el("p","catalog-sample-notice","Харьцуулалт нь жишиг мэдээлэл дээр ажиллаж байна. Бодит listing backend дараагийн хэрэгжүүлэлтийн шатанд орно."));
    overlay.hidden=false; document.body.classList.add("catalog-open"); overlay.querySelector(".catalog-close").focus();
  }

  function syncCompareButtons() {
    grid.querySelectorAll("[data-catalog-compare]").forEach(button => { const active=selected.has(button.dataset.catalogCompare); button.classList.toggle("active",active); button.setAttribute("aria-pressed",String(active)); button.textContent=active?"✓ Сонгосон":"＋ Харьцуулах"; });
  }

  [...grid.querySelectorAll("[data-product-card]")].forEach((card,index) => {
    const product = products[index]; if (!product) return;
    card.dataset.catalogId = product.id;
    card.classList.add("catalog-enhanced-card");
    const button = card.querySelector(".product-card-body > button");
    button.disabled = false; button.textContent = "Дэлгэрэнгүй харах"; button.classList.add("catalog-detail-button");
    button.addEventListener("click",()=>openDetail(product));
    const compare = el("button","catalog-card-compare","＋ Харьцуулах"); compare.type="button"; compare.dataset.catalogCompare=product.id; compare.setAttribute("aria-pressed","false");
    compare.addEventListener("click",()=>{ if(selected.has(product.id)) selected.delete(product.id); else if(selected.size<3) selected.add(product.id); else return; syncCompareButtons(); renderCompare(); });
    button.after(compare);
  });

  const listingDialog = document.getElementById("catalogListingDialog");
  const listingForm = document.getElementById("catalogListingForm");
  const draftSection = document.getElementById("catalogDraftSection");
  const draftGrid = document.getElementById("catalogDraftGrid");

  function readDrafts() {
    try {
      const value = JSON.parse(localStorage.getItem(DRAFT_STORAGE_KEY) || "[]");
      return Array.isArray(value) ? value : [];
    } catch { return []; }
  }

  function writeDrafts(items) {
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(items));
  }

  function renderDrafts() {
    const drafts = readDrafts();
    draftSection.classList.toggle("hidden", drafts.length === 0);
    draftGrid.replaceChildren();
    drafts.forEach(draft => {
      const card = el("article", "product-market-card catalog-draft-card");
      card.dataset.productCategoryRow = draft.category;
      const cover = el("div", "product-cover");
      cover.append(el("span", "", draft.title.split(/\s+/).slice(0,2).map(word => word[0]).join("").toUpperCase()), el("small", "", "ТАНЫ НООРОГ"));
      const body = el("div", "product-card-body");
      body.append(el("span", "vendor-label", "Нийтлээгүй"), el("h2", "", draft.title), el("p", "", draft.summary));
      const facts = el("div");
      facts.append(el("span", "", categoryLabels[draft.category] || "Бүтээгдэхүүн"), el("strong", "", draft.price || "Үнэ оруулаагүй"));
      const remove = el("button", "", "Ноорог устгах");
      remove.type = "button";
      remove.addEventListener("click", () => {
        writeDrafts(readDrafts().filter(item => item.id !== draft.id));
        renderDrafts();
      });
      body.append(facts, remove);
      card.append(cover, body);
      draftGrid.append(card);
    });
  }

  document.querySelectorAll("[data-catalog-buy]").forEach(button => button.addEventListener("click", () => {
    const search = document.getElementById("homeSearchInput");
    search.focus();
    search.scrollIntoView({ behavior:"smooth", block:"center" });
  }));
  document.querySelectorAll("[data-catalog-sell]").forEach(button => button.addEventListener("click", () => {
    listingForm.reset();
    listingDialog.showModal();
    listingForm.elements.title.focus();
  }));
  document.querySelectorAll("[data-catalog-custom]").forEach(button => button.addEventListener("click", () => {
    document.dispatchEvent(new CustomEvent("overva:catalog-custom-request"));
  }));
  listingForm.addEventListener("submit", event => {
    event.preventDefault();
    if (!listingForm.reportValidity()) return;
    const values = Object.fromEntries(new FormData(listingForm));
    const drafts = readDrafts();
    drafts.unshift({ id:`draft-${Date.now()}`, title:values.title.trim(), category:values.category, summary:values.summary.trim(), price:values.price.trim(), savedAt:new Date().toISOString() });
    writeDrafts(drafts.slice(0,20));
    renderDrafts();
    listingDialog.close();
    draftSection.scrollIntoView({ behavior:"smooth", block:"start" });
  });
  renderDrafts();

  overlay.addEventListener("click", event => { if(event.target===overlay || event.target.closest(".catalog-close")){ overlay.hidden=true; document.body.classList.remove("catalog-open"); } });
  document.addEventListener("keydown",event=>{ if(event.key==="Escape"&&!overlay.hidden){ overlay.hidden=true; document.body.classList.remove("catalog-open"); } });
})();
