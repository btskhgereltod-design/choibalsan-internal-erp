"use strict";
labels.executive="Чиг хандлага";
state.executiveData=null;
const renderBeforeExecutive=render;
render=function(){if(state.view!=="executive")return renderBeforeExecutive();renderExecutive()};
const adjustBeforeExecutive=adjustModuleNavigation;
adjustModuleNavigation=function(){adjustBeforeExecutive();$("#executiveNav")?.classList.add("hidden")};
async function loadExecutive(){try{state.executiveData=await api("/api/executive/overview");render()}catch(error){toast(error.message,true)}}
function execCard(title,value,detail){return`<article class="exec-card"><span>${title}</span><strong>${value}</strong><small>${detail}</small></article>`}
function renderExecutive(){
  const d=state.executiveData;
  if(!d){$("#pageContent").innerHTML=header("ЧИГ ХАНДЛАГА","Өөрчлөлт, шалтгааныг нэгтгэж байна","Өнөөдрийн байдлаас цааш хугацааны өөрчлөлт болон шийдвэрлэх асуудлыг ачаалж байна...");queueMicrotask(loadExecutive);return}
  const enabled=new Set(state.enabledModules||[]),f=d.finance,max=Math.max(1,...d.workTrend.flatMap(x=>[x.created,x.completed])),cards=[];
  if(enabled.has("work-orders"))cards.push(execCard("Нээлттэй ажил",d.work.open,`${d.work.emergency} яаралтай · ${d.work.overdue} хэтэрсэн`));
  if(enabled.has("assets"))cards.push(execCard("Хөрөнгө",d.assets.total,`${d.assets.repair} засварт`));
  if(enabled.has("finance"))cards.push(execCard("Сарын цэвэр урсгал",money(Number(f.income)-Number(f.expense)),`Орлого ${money(f.income)} · Зарлага ${money(f.expense)}`));
  if(enabled.has("hr"))cards.push(execCard("Ажилтан",d.people.active,`${d.people.inactive} идэвхгүй`));
  if(enabled.has("inventory"))cards.push(execCard("Агуулахын эрсдэл",d.inventory.low_stock,`${d.inventory.item_count} нэр төрлөөс`));
  if(enabled.has("maintenance"))cards.push(execCard("Засвар хэтэрсэн",d.maintenance.overdue,`${d.maintenance.active} идэвхтэй төлөвлөгөө`));
  if(enabled.has("fleet"))cards.push(execCard("Fleet онлайн",`${d.fleet.online}/${d.fleet.total}`,`${d.fleet.moving} хөдөлгөөнтэй`));
  if(enabled.has("iot"))cards.push(execCard("IoT онлайн",`${d.iot.online}/${d.iot.total}`,`${d.iot.fault} алдаатай`));
  $("#pageContent").innerHTML=`${organizationHomeBar("analysis",d.generatedAt)}<section class="analysis-purpose"><div><span>ШИЙДВЭР ГАРГАЛТ</span><h2>Өнөөдрөөс цааш хар</h2><p>Энд өнөөдрийн тоог давтахгүй. Хугацааны өөрчлөлт, эрэмбэлсэн эрсдэл болон удирдлагаас шийдвэр шаардах дохиог харуулна.</p></div><button class="secondary" id="executiveRefresh">↻ Шинэчлэх</button></section><div class="exec-layout">${enabled.has("work-orders")?`<section class="exec-panel"><div class="exec-panel-head"><div><span>14 ХОНОГИЙН ӨӨРЧЛӨЛТ</span><h2>Ажлын урсгал</h2></div><div class="exec-legend"><i></i>Үүссэн <i></i>Дууссан</div></div><div class="exec-trend">${d.workTrend.map(x=>`<div class="exec-day"><i style="height:${Math.max(2,x.created/max*145)}px" title="Үүссэн: ${x.created}"></i><i style="height:${Math.max(2,x.completed/max*145)}px" title="Дууссан: ${x.completed}"></i><small>${esc(x.day)}</small></div>`).join("")}</div></section>`:`<section class="exec-panel">${empty("Чиг хандлагын өгөгдөл бүрдээгүй","Ажлын урсгал эсвэл бусад шинжилгээний модуль идэвхжихэд хугацааны өөрчлөлт энд харагдана.")}</section>`}<section class="exec-panel"><div class="exec-panel-head"><div><span>ШИЙДВЭР ШААРДАХ</span><h2>Эрэмбэлсэн асуудал</h2></div><b>${d.alerts.length}</b></div>${d.alerts.length?d.alerts.map(a=>`<div class="exec-alert ${a.level}"><i></i><div><strong>${esc(a.message)}</strong><small>${esc(a.module)} · ${esc(a.level)}</small></div></div>`).join(""):empty("Шийдвэр шаардах асуудал алга","Одоогийн үзүүлэлтүүд хэвийн байна.")}</section></div>${cards.length?`<section class="decision-baseline"><div><span>ШИЙДВЭРИЙН СУУРЬ</span><h2>Холбогдох үзүүлэлтүүд</h2><p>Дээрх өөрчлөлт, асуудлыг тайлбарлахад ашиглах одоогийн утгууд.</p></div><div class="exec-grid">${cards.join("")}</div></section>`:""}`;
}
document.addEventListener("click",async event=>{if(event.target.closest("#executiveRefresh")){state.executiveData=null;await loadExecutive();toast("Чиг хандлагын мэдээлэл шинэчлэгдлээ")}});
