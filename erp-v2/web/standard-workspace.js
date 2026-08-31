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
  const today=new Intl.DateTimeFormat("mn-MN",{year:"numeric",month:"long",day:"numeric",weekday:"long"}).format(new Date(generatedAt));
  const analysisAvailable=(state.allowedViews||[]).includes("executive");
  return`<section class="organization-home" style="--org-primary:${primary};--org-accent:${accent}">${banner}<div class="organization-home-shade"></div><div class="organization-identity"><div class="organization-logo">${logo}</div><div><span>МАНАЙ БАЙГУУЛЛАГЫН ОРЧИН</span><h1>${esc(name)}</h1><p class="organization-welcome">${esc(welcome)}</p><small>${esc(today)}</small></div></div><div class="organization-live"><span><i></i> Систем онлайн</span><small>${dateTime(generatedAt)} шинэчлэгдсэн</small><button class="hero-refresh" id="unifiedDashboardRefresh" aria-label="Мэдээллийг шинэчлэх">↻ Шинэчлэх</button></div></section><nav class="home-view-switch" aria-label="Байгууллагын нүүрийн харагдац"><button class="${active==="today"?"active":""}" data-go="dashboard"><b>Өнөөдөр</b><small>Яг одоо юу болж байна?</small></button>${analysisAvailable?`<button class="${active==="analysis"?"active":""}" data-go="executive"><b>Чиг хандлага</b><small>Юу өөрчлөгдөж, юуг шийдэх вэ?</small></button>`:""}</nav>`;
}
function setupProgress(data){
  if(data.setup.complete||!workspacePolicy.isPrimaryAdmin(state.systemRoles))return"";
  const percent=Math.round(data.setup.completed/data.setup.total*100);
  return`<section class="setup-progress"><div><span>ЭХЛҮҮЛЭХ ТОХИРГОО</span><strong>${data.setup.completed}/${data.setup.total} алхам дууссан</strong><small>Байгууллагын суурь мэдээллээ гүйцээвэл ажлын талбарууд илүү зөв тохирно.</small></div><div class="setup-progress-action"><b>${percent}%</b><button class="secondary" data-go="settings" data-settings-tab-target="start">Үргэлжлүүлэх</button></div></section>`;
}
function unifiedDashboardView(){
  const d=state.unifiedDashboard;
  if(state.unifiedDashboardError)return`${header("БАЙГУУЛЛАГЫН НҮҮР","Мэдээллийг нэгтгэж чадсангүй","Суурь мэдээлэл хэвээр хадгалагдсан. Дахин ачаалж шалгана уу.",'<button class="secondary" id="unifiedDashboardRefresh">↻ Дахин ачаалах</button>')}<section class="unified-error">${esc(state.unifiedDashboardError)}</section>`;
  if(!d){
    if(!state.unifiedDashboardLoading)queueMicrotask(loadUnifiedDashboard);
    return`${header("БАЙГУУЛЛАГЫН НҮҮР","Таны байгууллагын өнөөдрийн орчин","Шаардлагатай мэдээллийг нэгтгэж байна...")}<div class="unified-loading"><i></i><span>Өнөөдрийн байдлыг ачаалж байна</span></div>`;
  }
  const operations=(d.operations||d.metrics||[]).slice(0,8),resources=(d.resources||[]).slice(0,4),alerts=d.alerts.slice(0,8);
  return`${organizationHomeBar("today",d.generatedAt)}
    ${setupProgress(d)}
    <div class="home-section-title"><div><span>ӨНӨӨДРИЙН НЭГДСЭН БАЙДАЛ</span><h2>Үйл ажиллагаа</h2></div><small>Дэлгэрэнгүйг харахын тулд үзүүлэлт дээр дарна уу.</small></div>
    <div class="unified-metrics">${operations.map(item=>`<button class="unified-metric ${esc(item.tone||"blue")}" data-go="${esc(item.view||"dashboard")}"><span>${esc(item.label)}</span><strong>${dashboardValue(item)}</strong><small>${esc(item.note||"")}</small></button>`).join("")}</div>
    ${resources.length?`<div class="home-section-title resource-title"><div><span>НӨӨЦ БА САНХҮҮ</span><h2>Удирдлагын бодит үлдэгдэл</h2></div></div><div class="unified-metrics unified-resources">${resources.map(item=>`<button class="unified-metric ${esc(item.tone||"blue")}" data-go="${esc(item.view||"dashboard")}"><span>${esc(item.label)}</span><strong>${dashboardValue(item)}</strong><small>${esc(item.note||"")}</small></button>`).join("")}</div>`:""}
    <section class="panel unified-alerts"><div class="panel-head"><div><span class="panel-kicker">ШИЙДВЭР ШААРДАХ</span><h2>Одоо анхаарах зүйл</h2></div><span>${d.alerts.length} дохио</span></div>${alerts.length?alerts.map(item=>`<button class="unified-alert ${esc(item.level)}" data-go="${esc(item.view||"dashboard")}"><i></i><span><strong>${esc(item.message)}</strong><small>${esc(item.module)}</small></span><b>→</b></button>`).join(""):empty("Одоогоор шуурхай дохио алга","Бүртгэгдсэн бодит мэдээллээр яаралтай шийдвэрлэх зүйл илрээгүй.")}</section>`;
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
