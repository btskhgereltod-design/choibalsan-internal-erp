"use strict";
labels.executive="Чиг хандлага";
state.executiveData=null;
state.executiveDays=30;
const renderBeforeExecutive=render;
render=function(){if(state.view!=="executive")return renderBeforeExecutive();renderExecutive()};
const adjustBeforeExecutive=adjustModuleNavigation;
adjustModuleNavigation=function(){adjustBeforeExecutive();$("#executiveNav")?.classList.add("hidden")};

async function loadExecutive(force=false){
  if(state.executiveData&&!force)return render();
  try{state.executiveData=await api(`/api/executive/overview?days=${state.executiveDays}`);render()}catch(error){toast(error.message,true)}
}
function trendDelta(current,previous,suffix=""){
  if(current===null||current===undefined||previous===null||previous===undefined)return"Харьцуулах өгөгдөлгүй";
  const difference=Number(current)-Number(previous),sign=difference>0?"+":"";
  return`${sign}${difference}${suffix} · өмнөх ${previous}${suffix}`;
}
function trendCard(label,current,previous,note,format="number",inverse=false){
  const value=format==="money"?money(current):`${current??"—"}${format==="percent"&&current!==null?"%":""}`;
  const difference=current===null||previous===null?0:Number(current)-Number(previous),tone=difference===0?"flat":((difference>0)!==inverse?"up":"down");
  return`<article class="trend-card ${tone}"><span>${esc(label)}</span><strong>${value}</strong><small>${esc(trendDelta(current,previous,format==="percent"?"%":""))}</small><p>${esc(note)}</p></article>`;
}
function sectionRow(title,view,metrics){
  return`<button class="trend-domain" data-go="${esc(view)}"><strong>${esc(title)}</strong>${metrics.map(item=>`<span><b>${esc(item[1])}</b><small>${esc(item[0])}</small></span>`).join("")}<i>→</i></button>`;
}
function renderExecutive(){
  const d=state.executiveData;
  if(!d){$("#pageContent").innerHTML=`${organizationHomeBar("analysis")}<div class="unified-loading"><i></i><span>Чиг хандлагыг тооцоолж байна</span></div>`;queueMicrotask(()=>loadExecutive());return}
  const s=d.sections||{},w=s.work,a=s.attendance,c=s.camera,l=s.lighting,safety=s.safety,inventory=s.inventory,finance=s.finance;
  const cards=[];
  if(w){cards.push(trendCard("Шинээр үүссэн ажил",w.created_current,w.created_previous,"Сонгосон хоёр ижил хугацааг харьцуулсан"));cards.push(trendCard("Дууссан ажил",w.completed_current,w.completed_previous,"Баталгаажсан төлөвийн түүхээс", "number",false))}
  if(a)cards.push(trendCard("Ирцийн хувь",a.rate_current,a.rate_previous,"Ажилласан, хоцорсон, зайнаас ажилласны харьцаа","percent"));
  if(finance)cards.push(trendCard("Цэвэр мөнгөн урсгал",finance.net_current,finance.net_previous,finance.transactions_current?`${finance.transactions_current} гүйлгээнд үндэслэв`:"Энэ хугацаанд гүйлгээ бүртгэгдээгүй","money"));
  const trend=d.workTrend||[],max=Math.max(1,...trend.flatMap(item=>[Number(item.created),Number(item.completed)]));
  const domains=[];
  if(w)domains.push(sectionRow("Ажлын урсгал","work-orders",[["сүүлийн үеийн нээлттэй",w.recent_open],["хугацаа хэтэрсэн",w.overdue_recent],["өмнөх үлдэгдэл",w.historical_open]]));
  if(c)domains.push(sectionRow("Камер","camera",[["ажиллагаатай",`${Math.max(0,c.devices-c.broken)}/${c.devices}`],["шинэ гэмтэл",c.reported_current],["шийдсэн",c.resolved_current]]));
  if(l)domains.push(sectionRow("Гэрэлтүүлэг","lighting",[["нээлттэй гэмтэл",l.open_now],["шинэ гэмтэл",l.reported_current],["шийдсэн",l.resolved_current]]));
  if(safety)domains.push(sectionRow("ХАБЭА","safety",[["нээлттэй эрсдэл",safety.open_now],["шинэ",safety.reported_current],["хаасан",safety.closed_current]]));
  if(inventory)domains.push(sectionRow("Нярав","inventory",[["доод үлдэгдэл",inventory.low_stock],["босготой бараа",inventory.threshold_configured],["үлдэгдлийн үнэ",money(inventory.inventory_value)]]));
  if(finance)domains.push(sectionRow("Санхүү","finance",[["орлого",money(finance.income_current)],["зарлага",money(finance.expense_current)],["нээлттэй өглөг",money(finance.payable_open)]]));
  $("#pageContent").innerHTML=`${organizationHomeBar("analysis",d.generatedAt)}
    <section class="trend-toolbar"><div><span>ШИЙДВЭР ГАРГАЛТ</span><h2>Юу өөрчлөгдөв, юуг шийдэх вэ?</h2><p>Өнөөдрийн нүүрийг давтахгүй. Ижил урттай өмнөх хугацаатай харьцуулж, зөвхөн таны үүрэгт хамаарах дохиог харуулна.</p></div><div class="period-switch" aria-label="Харьцуулах хугацаа">${[14,30,90].map(days=>`<button class="${d.period.days===days?"active":""}" data-executive-days="${days}">${days} хоног</button>`).join("")}</div></section>
    ${cards.length?`<div class="trend-card-grid">${cards.join("")}</div>`:""}
    <div class="exec-layout">${w?`<section class="exec-panel"><div class="exec-panel-head"><div><span>${d.period.days} ХОНОГИЙН ӨӨРЧЛӨЛТ</span><h2>Ажлын оролт ба гарц</h2></div><div class="exec-legend"><i></i>Үүссэн <i></i>Дууссан</div></div><div class="exec-trend">${trend.map((item,index)=>`<div class="exec-day"><i style="height:${Math.max(2,item.created/max*145)}px" title="Үүссэн: ${item.created}"></i><i style="height:${Math.max(2,item.completed/max*145)}px" title="Дууссан: ${item.completed}"></i>${(trend.length<=30||index%7===0||index===trend.length-1)?`<small>${esc(item.day)}</small>`:""}</div>`).join("")}</div></section>`:`<section class="exec-panel">${empty("Ажлын чиг хандлага харагдахгүй","Таны үүрэгт ажлын урсгалын шинжилгээ хамаарахгүй байна.")}</section>`}
      <section class="exec-panel"><div class="exec-panel-head"><div><span>ШИЙДВЭР ШААРДАХ</span><h2>Эрэмбэлсэн дохио</h2></div><b>${d.alerts.length}</b></div>${d.alerts.length?d.alerts.map(item=>`<button class="exec-alert ${esc(item.level)}" data-go="${esc(item.view)}"><i></i><div><strong>${esc(item.message)}</strong><small>${esc(item.module)}</small></div><b>→</b></button>`).join(""):empty("Шуурхай шийдвэр шаардах дохио алга","Сонгосон хугацааны баталгаатай мэдээллээр ноцтой өөрчлөлт илрээгүй.")}</section></div>
    ${domains.length?`<section class="trend-domains"><div class="exec-panel-head"><div><span>ҮҮРЭГТ ТОХИРСОН ХАРАХ ӨНЦӨГ</span><h2>Шалтгааныг задлах</h2></div></div>${domains.join("")}</section>`:""}`;
}
document.addEventListener("click",async event=>{
  const period=event.target.closest("[data-executive-days]");
  if(period){state.executiveDays=Number(period.dataset.executiveDays);state.executiveData=null;await loadExecutive(true)}
  if(event.target.closest("#executiveRefresh")){state.executiveData=null;await loadExecutive(true);toast("Чиг хандлагын мэдээлэл шинэчлэгдлээ")}
});
