"use strict";

const workspacePolicy=globalThis.OvervaWorkspacePolicy;
state.systemRoles=[];
state.allowedViews=["dashboard"];
state.unifiedDashboard=null;
state.unifiedDashboardLoading=false;
state.unifiedDashboardError="";

function refreshWorkspacePolicy(){
  state.systemRoles=state.user?.system_roles||state.systemRoles||[];
  state.allowedViews=workspacePolicy.allowedViews({role:state.user?.role,systemRoles:state.systemRoles,permissions:state.permissions||[],workspaceCodes:state.user?.workspace_codes||[],enabledModules:state.enabledModules||[],viewModules});
  const allowed=new Set(state.allowedViews),peopleView=allowed.has("hr")?"hr":"employees";
  state.peopleMasterView=peopleView;
  if(state.view==="employees"&&peopleView==="hr")state.view="hr";
  document.querySelectorAll(".nav-item[data-view]").forEach(item=>{
    const duplicatePeopleEntry=item.dataset.view==="employees"&&peopleView==="hr";
    item.classList.toggle("hidden",duplicatePeopleEntry||!allowed.has(item.dataset.view));
  });
  if(state.user){
    const roleLabel=workspacePolicy.isPrimaryAdmin(state.systemRoles)?"Байгууллагын үндсэн админ":workspacePolicy.isOrganizationAdmin(state.systemRoles)?"Байгууллагын админ":(labels[state.user.role]||state.user.role);
    $("#userRole").textContent=roleLabel;
  }
  if(!allowed.has(state.view))state.view="dashboard";
}

const standardAdjustBefore=adjustModuleNavigation;
adjustModuleNavigation=function(){standardAdjustBefore();refreshWorkspacePolicy()};

const standardSetViewBefore=setView;
setView=function(view){
  refreshWorkspacePolicy();
  if(view==="employees"&&state.allowedViews.includes("hr"))view="hr";
  if(!state.allowedViews.includes(view)){toast("Энэ ажлын талбар таны одоогийн үүрэгт хамаарахгүй байна.",true);return}
  standardSetViewBefore(view);
};

function dashboardValue(metric){return metric.format==="money"?money(metric.value):esc(metric.value)}
function organizationHomeBar(active="today",generatedAt=new Date().toISOString()){
  const organization=state.organization||{},settings=organization.settings||{},name=organization.name||"Байгууллага",shortName=settings.short_name||name;
  const logo=settings.logo_url?`<img src="${esc(settings.logo_url)}" alt="" onerror="this.remove()">`:`<b>${esc(initials(shortName))}</b>`;
  const banner=settings.home_banner_url?`<img class="organization-banner" src="${esc(settings.home_banner_url)}" alt="" onerror="this.remove()">`:"";
  const primary=/^#[0-9a-f]{6}$/i.test(settings.primary_color||"")?settings.primary_color:"#123e6f",accent=/^#[0-9a-f]{6}$/i.test(settings.accent_color||"")?settings.accent_color:"#176d78";
  const welcome=settings.home_welcome_text||"Өнөөдрийн ажлаа байгууллагынхаа бодит мэдээлэлтэй нэг дороос харна.";
  const updatedAt=new Intl.DateTimeFormat("mn-MN",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(generatedAt));
  const canEditBrand=(state.allowedViews||[]).includes("settings");
  return`<section class="organization-home" style="--org-primary:${primary};--org-accent:${accent}">${banner}<div class="organization-home-shade"></div><div class="organization-identity"><div class="organization-logo">${logo}</div><div><span>МАНАЙ БАЙГУУЛЛАГЫН ОРЧИН</span><h1>${esc(name)}</h1><p class="organization-welcome">${esc(welcome)}</p></div></div><div class="organization-live"><span><i></i> Систем онлайн</span><div class="organization-meta"><small>${esc(updatedAt)}</small>${canEditBrand?`<button class="hero-brand-edit" data-go="settings" data-settings-tab-target="organization" aria-label="Баннер зураг солих" title="Баннер зураг солих">▧</button>`:""}</div></div></section>`;
}
function attendanceStatusLabel(status){return({worked:"Ажилласан",late:"Хоцорсон",absent:"Тасалсан",leave:"Чөлөөтэй",sick:"Өвчтэй",vacation:"Амралттай",remote:"Зайнаас",holiday:"Амралтын өдөр"})[status]||"Өнөөдрийн ирц бүртгэгдээгүй"}
function personalDashboardView(d){
  const p=d.personal||{},identity=p.identity||{},attendance=p.attendance||{},work=p.work||{},requests=p.requests||{},department=p.department||{},compensation=p.compensation||{};
  const firstName=givenName(identity.fullName||state.user?.full_name),fieldView=(state.allowedViews||[]).includes("mobile")?"mobile":"work-orders";
  const salary=compensation.available?money(compensation.referenceSalary):"Мэдээлэлгүй";
  return`${organizationHomeBar("today",d.generatedAt)}
    <section class="personal-welcome"><div><span>МИНИЙ ӨДӨР</span><h2>Өдрийн мэнд, ${esc(firstName)}</h2><p>${esc(identity.position||labels[state.user?.role]||"Ажилтан")}${identity.department?` · ${esc(identity.department)}`:""}</p></div>${(state.allowedViews||[]).includes(fieldView)?`<button class="primary" data-go="${fieldView}">Миний ажлыг нээх →</button>`:""}</section>
    <div class="personal-grid">
      <button class="personal-card attendance" data-go="attendance"><span>Өнөөдрийн ирц</span><strong>${esc(attendanceStatusLabel(attendance.today_status))}</strong><small>${attendance.check_in?`Ирсэн ${esc(String(attendance.check_in).slice(0,5))}`:"Ирсэн цаг бүртгэгдээгүй"}${attendance.check_out?` · Гарсан ${esc(String(attendance.check_out).slice(0,5))}`:""}</small></button>
      <button class="personal-card work" data-go="${fieldView}"><span>Миний нээлттэй ажил</span><strong>${esc(work.open||0)}</strong><small>${esc(work.dueToday||0)} өнөөдөр · ${esc(work.overdueRecent||0)} хугацаа хэтэрсэн</small></button>
      <button class="personal-card done" data-go="${fieldView}"><span>Энэ сарын гүйцэтгэл</span><strong>${esc(work.completedMonth||0)}</strong><small>${esc(work.pendingReview||0)} ажил баталгаажуулалт хүлээж байна</small></button>
      <article class="personal-card salary"><span>Миний цалингийн лавлагаа 🔒</span><strong>${salary}</strong><small>${compensation.available?"Суурь цалин · эцсийн олгох цалин биш":"Баталгаажсан цалингийн мэдээлэл хараахан алга"}</small></article>
    </div>
    <div class="personal-lower">
      <section class="panel personal-month"><div class="panel-head"><div><span class="panel-kicker">ЭНЭ САР</span><h2>Миний төлөв</h2></div></div><div class="personal-facts"><span><b>${esc(attendance.worked_days||0)}</b> ажилласан өдөр</span><span><b>${esc(attendance.late_days||0)}</b> хоцролт</span><span><b>${esc(attendance.overtime_hours||0)}</b> илүү цаг</span><span><b>${Number(requests.pending_leave||0)+Number(requests.pending_corrections||0)}</b> шийдвэр хүлээсэн хүсэлт</span></div></section>
      <section class="panel department-snapshot"><div class="panel-head"><div><span class="panel-kicker">МИНИЙ НЭГЖ</span><h2>${esc(identity.department||"Хэлтсийн мэдээлэл")}</h2></div></div><p>Нэр, хувийн мэдээлэлгүй зөвхөн хамтын ажлын төлөв.</p><div class="personal-facts"><span><b>${esc(department.open||0)}</b> нээлттэй</span><span><b>${esc(department.completed_month||0)}</b> энэ сард дууссан</span><span><b>${esc(department.overdue_recent||0)}</b> хугацаа хэтэрсэн</span></div></section>
    </div>
    ${d.alerts.length?`<section class="panel unified-alerts"><div class="panel-head"><div><span class="panel-kicker">НАДАД ХАМААТАЙ</span><h2>Анхаарах зүйл</h2></div><span>${d.alerts.length} дохио</span></div>${d.alerts.slice(0,5).map(item=>`<button class="unified-alert ${esc(item.level)}" data-go="${esc(item.view||fieldView)}" ${item.reportTab?`data-report-tab-target="${esc(item.reportTab)}"`:""}><i></i><span><strong>${esc(item.message)}</strong><small>${esc(item.module)}</small></span><b>→</b></button>`).join("")}</section>`:""}`;
}
function setupProgress(data){
  if(data.setup.complete||!workspacePolicy.isPrimaryAdmin(state.systemRoles))return"";
  const percent=Math.round(data.setup.completed/data.setup.total*100);
  return`<section class="setup-progress"><div><span>ЭХЛҮҮЛЭХ ТОХИРГОО</span><strong>${data.setup.completed}/${data.setup.total} алхам дууссан</strong><small>Байгууллагын суурь мэдээллээ гүйцээвэл ажлын талбарууд илүү зөв тохирно.</small></div><div class="setup-progress-action"><b>${percent}%</b><button class="secondary" data-go="settings" data-settings-tab-target="start">Үргэлжлүүлэх</button></div></section>`;
}
function informationFlowBoard(items){
  const raw=items||[],groups=new Map();
  raw.forEach(item=>{
    const key=[item.kind,item.title,item.actor,item.view].join("|");
    const group=groups.get(key);
    if(group)group.count+=1;else groups.set(key,{...item,count:1});
  });
  const flow=[...groups.values()].slice(0,5);
  return`<section class="panel unified-activity"><div class="panel-head"><div><span class="panel-kicker">МЭДЭЭЛЛИЙН САМБАР</span><h2>Мэдээллийн урсгал</h2></div><span>${raw.length} үйлдэл · ${groups.size} төрөл</span></div>${flow.length?`<div class="information-flow-list">${flow.map(item=>`<button class="information-flow-item ${esc(item.kind)}" data-go="${esc(item.view||"dashboard")}"><i></i><span><strong>${esc(item.title)}${item.count>1?` · ${item.count} бүртгэл`:""}</strong><small>${esc(item.count>1?item.module:(item.subject||item.module))} · ${esc(item.actor||"Систем")}</small></span><time>${dateTime(item.occurredAt)}</time></button>`).join("")}</div>`:empty("Мэдээллийн урсгал алга","Таны харах эрхтэй ажлын өөрчлөлт одоогоор бүртгэгдээгүй байна.")}</section>`;
}
function attendanceOverview(data){
  if(!data)return"";
  const date=new Intl.DateTimeFormat("mn-MN",{year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(`${data.date}T00:00:00`));
  const facts=[["absent","Тасалсан",data.absent],["leave","Чөлөөтэй",data.leave],["sick","Өвчтэй",data.sick],["vacation","Амралт",data.vacation],["overtime","Илүү цаг",data.overtimeHours]];
  return`<section class="panel attendance-overview"><div class="attendance-overview-head"><span><b>⏱ Өнөөдрийн ирц</b><small>${esc(date)}</small></span><button class="secondary" data-go="attendance">Бүртгэх →</button></div><div class="attendance-overview-facts">${facts.map(([code,label,value])=>`<span class="${code}"><i></i><small>${label}</small><b>${Number(value||0).toLocaleString()}${code==="overtime"?" цаг":""}</b></span>`).join("")}</div></section>`;
}
function infrastructureOverview(data){
  const lightingRows=Array.isArray(data?.lighting)?data.lighting:[],camera=data?.camera;
  if(!lightingRows.length&&!camera)return"";
  const byCode=new Map(lightingRows.map(item=>[item.code,item])),unclassified=Number(byCode.get("unclassified")?.locations||0);
  const definitions=[
    ["road","💡","Авто замын гэрэл","Нийт толгой","Нийт шон"],
    ["ger","🏘","Гэр хорооллын гэрэл","Нийт гэрэл",null],
    ["tower","🗼","Цамхаг / прожектор","Нийт гэрэл",null],
    ["signal","🚦","Гэрлэн дохио","Нийт дохио",null]
  ];
  const lightingCards=definitions.map(([code,icon,label,totalLabel,poleLabel])=>{
    const row=byCode.get(code)||{},total=Number(row.total||0),faults=Number(row.faults||0),active=Math.max(0,total-faults),availability=total?active/total*100:0;
    return`<article class="infrastructure-group ${code}"><div class="infrastructure-group-head"><strong>${icon} ${label}</strong><span>${availability.toFixed(1)}% асалттай</span></div><div class="infrastructure-facts"><span><b>${Number(row.locations||0).toLocaleString()}</b><small>Байршил</small></span>${poleLabel?`<span><b>${Number(row.poles||0).toLocaleString()}</b><small>${poleLabel}</small></span>`:""}<span><b>${total.toLocaleString()}</b><small>${totalLabel}</small></span><span class="working"><b>${active.toLocaleString()}</b><small>Асаж байна</small></span><span class="fault"><b>${faults.toLocaleString()}</b><small>Гэмтэлтэй</small></span>${code==="road"?`<span class="attention"><b>${Number(row.replacements||0).toLocaleString()}</b><small>Нөхөх шон</small></span>`:""}</div></article>`;
  }).join("");
  const cameraTotal=Number(camera?.devices||0),cameraActive=Number(camera?.active||0),cameraBroken=Number(camera?.broken||0),cameraAvailability=Number(camera?.availability||0);
  return`<section class="infrastructure-overview">
    ${lightingRows.length?`<button class="panel infrastructure-panel lighting-overview" data-go="lighting"><div class="panel-head"><div><span class="panel-kicker">ДЭД БҮТЦИЙН БОДИТ БАЙДАЛ</span><h2>💡 Гэрэлтүүлгийн тойм</h2></div><span>${unclassified?`${unclassified} ангилал хүлээж буй`:`${definitions.length} бүлэг`}</span></div><div class="infrastructure-groups">${lightingCards}</div></button>`:""}
    ${camera?`<button class="panel infrastructure-panel camera-overview" data-go="camera"><div class="panel-head"><div><span class="panel-kicker">ХЯНАЛТЫН КАМЕР</span><h2>🎥 Камерын тойм</h2></div><span>${cameraAvailability.toFixed(1)}% ажиллагаатай</span></div><div class="camera-overview-facts"><span><b>${Number(camera.locations||0).toLocaleString()}</b><small>Байршил</small></span><span><b>${cameraTotal.toLocaleString()}</b><small>Нийт камер</small></span><span class="working"><b>${cameraActive.toLocaleString()}</b><small>Ажиллаж байна</small></span><span class="fault"><b>${cameraBroken.toLocaleString()}</b><small>Гэмтэлтэй</small></span></div><div class="camera-availability"><div><strong>Бүх камер</strong><b>${cameraActive.toLocaleString()} / ${cameraTotal.toLocaleString()} · ${cameraAvailability.toFixed(1)}%</b></div><progress max="100" value="${Math.max(0,Math.min(100,cameraAvailability))}"></progress>${cameraBroken?`<small>⚠ ${cameraBroken.toLocaleString()} камер нээлттэй гэмтлийн бүртгэлтэй</small>`:`<small class="healthy">✓ Нээлттэй камерын гэмтэлгүй</small>`}</div></button>`:""}
  </section>`;
}
function unifiedDashboardView(){
  const d=state.unifiedDashboard;
  if(state.unifiedDashboardError)return`${header("БАЙГУУЛЛАГЫН НҮҮР","Мэдээллийг нэгтгэж чадсангүй","Суурь мэдээлэл хэвээр хадгалагдсан. Дахин ачаалж шалгана уу.",'<button class="secondary" id="unifiedDashboardRefresh">↻ Дахин ачаалах</button>')}<section class="unified-error">${esc(state.unifiedDashboardError)}</section>`;
  if(!d){
    if(!state.unifiedDashboardLoading)queueMicrotask(loadUnifiedDashboard);
    return`${header("БАЙГУУЛЛАГЫН НҮҮР","Таны байгууллагын өнөөдрийн орчин","Шаардлагатай мэдээллийг нэгтгэж байна...")}<div class="unified-loading"><i></i><span>Өнөөдрийн байдлыг ачаалж байна</span></div>`;
  }
  if(d.scope==="personal"&&d.personal)return personalDashboardView(d);
  const hasInfrastructure=Boolean(d.infrastructure),duplicateViews=new Set(hasInfrastructure?["lighting","camera"]:[]);
  const operations=(d.operations||d.metrics||[]).filter(item=>!duplicateViews.has(item.view)).slice(0,6),resources=(d.resources||[]).slice(0,5),alerts=d.alerts.filter(item=>!duplicateViews.has(item.view)).slice(0,6),activity=d.activity||[];
  return`${organizationHomeBar("today",d.generatedAt)}
    ${setupProgress(d)}
    <div class="home-section-title"><div><span>ӨНӨӨДРИЙН НЭГДСЭН БАЙДАЛ</span><h2>Үйл ажиллагаа</h2></div><small>Дэлгэрэнгүйг харахын тулд үзүүлэлт дээр дарна уу.</small></div>
    <div class="unified-metrics">${operations.map(item=>`<button class="unified-metric ${esc(item.tone||"blue")}" data-go="${esc(item.view||"dashboard")}"><span>${esc(item.label)}</span><strong>${dashboardValue(item)}</strong><small>${esc(item.note||"")}</small></button>`).join("")}</div>
    ${attendanceOverview(d.attendanceOverview)}
    ${infrastructureOverview(d.infrastructure)}
    <section class="dashboard-lower">
      ${resources.length?`<section class="panel resource-cluster"><div class="panel-head"><div><span class="panel-kicker">НӨӨЦ БА САНХҮҮ</span><h2>Бодит үлдэгдэл</h2></div><span>${resources.length} үзүүлэлт</span></div><div class="unified-metrics unified-resources">${resources.map(item=>`<button class="unified-metric ${esc(item.tone||"blue")}" data-go="${esc(item.view||"dashboard")}"><span>${esc(item.label)}</span><strong>${dashboardValue(item)}</strong><small>${esc(item.note||"")}</small></button>`).join("")}</div></section>`:""}
      <section class="panel unified-alerts"><div class="panel-head"><div><span class="panel-kicker">ШИЙДВЭР ШААРДАХ</span><h2>Одоо анхаарах зүйл</h2></div><span>${alerts.length} дохио</span></div>${alerts.length?alerts.map(item=>`<button class="unified-alert ${esc(item.level)}" data-go="${esc(item.view||"dashboard")}" ${item.reportTab?`data-report-tab-target="${esc(item.reportTab)}"`:""}><i></i><span><strong>${esc(item.message)}</strong><small>${esc(item.module)}</small></span><b>→</b></button>`).join(""):empty("Одоогоор шуурхай дохио алга","Бүртгэгдсэн бодит мэдээллээр яаралтай шийдвэрлэх зүйл илрээгүй.")}</section>
      ${informationFlowBoard(activity)}
    </section>`;
}
async function loadUnifiedDashboard(force=false){
  if(state.unifiedDashboardLoading||state.unifiedDashboard&&!force)return;
  state.unifiedDashboardLoading=true;state.unifiedDashboardError="";
  try{state.unifiedDashboard=await api("/api/dashboard/overview")}catch(error){state.unifiedDashboardError=error.message}finally{state.unifiedDashboardLoading=false;if(state.view==="dashboard")render()}
}
function startSettingsContent(){
  const d=state.unifiedDashboard;
  if(!d){queueMicrotask(loadUnifiedDashboard);return`<div class="unified-loading"><i></i><span>Эхлүүлэх тохиргоог шалгаж байна</span></div>`}
  const enabled=(state.enabledModules||[]).filter(code=>!["core-work","structure","map","fleet","iot","ai-director","developer","integration-lab","automation"].includes(code));
  return`<div class="owner-intro"><strong>Байгууллагын орчныг дарааллаар нь бэлтгэнэ.</strong><span>Жижиг байгууллага зөвхөн хэрэгтэй алхмаа хийнэ. Бүтэц, ажилтан, эрх нэмэгдэх тусам OVERVA өөрөө өргөжинө.</span></div><div class="setup-grid">${d.setup.steps.map((step,index)=>`<button class="setup-card ${step.complete?"complete":""}" data-go="${esc(step.view||"settings")}" ${step.tab?`data-settings-tab-target="${esc(step.tab)}"`:""}><b>${step.complete?"✓":index+1}</b><span><strong>${esc(step.label)}</strong><small>${step.complete?"Бэлэн":"Тохируулж дуусгана уу"}</small></span></button>`).join("")}<button class="setup-card" data-go="billing"><b>5</b><span><strong>Багц ба төлбөр</strong><small>Үйлчилгээний төлөв, багц болон хэрэглээний хязгаарыг харна.</small></span></button></div><section class="panel owner-module-summary"><div class="panel-head"><h2>Сонгосон ажлын модулиуд</h2><span>${enabled.length} модуль</span></div><p>${enabled.length?enabled.map(code=>`<span>${esc(code)}</span>`).join(""):"Одоогоор нэмэлт модуль сонгоогүй байна."}</p></section>`;
}

dashboard=unifiedDashboardView;
const standardLoadSessionBefore=loadSession;
loadSession=async function(){await standardLoadSessionBefore();refreshWorkspacePolicy();state.unifiedDashboard=null;await loadUnifiedDashboard();render()};
document.addEventListener("click",event=>{
  const tabTarget=event.target.closest("[data-settings-tab-target]");
  if(tabTarget)state.settingsTab=tabTarget.dataset.settingsTabTarget;
},true);
document.addEventListener("click",event=>{
  const refresh=event.target.closest("#unifiedDashboardRefresh");
  if(refresh){state.unifiedDashboard=null;loadUnifiedDashboard(true)}
});
