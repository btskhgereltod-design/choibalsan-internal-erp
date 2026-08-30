"use strict";

(() => {
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

  overlay.addEventListener("click", event => { if(event.target===overlay || event.target.closest(".catalog-close")){ overlay.hidden=true; document.body.classList.remove("catalog-open"); } });
  document.addEventListener("keydown",event=>{ if(event.key==="Escape"&&!overlay.hidden){ overlay.hidden=true; document.body.classList.remove("catalog-open"); } });
})();
