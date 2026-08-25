"use strict";

labels.builder="OVERVA Builder";
state.builder=null;
const builderRenderBefore=render;
render=function(){if(state.view!=="builder")return builderRenderBefore();renderBuilder()};
const builderAdjustBefore=adjustModuleNavigation;
adjustModuleNavigation=function(){builderAdjustBefore();if((state.permissions||[]).includes("builder.manage"))$("#builderNav")?.classList.remove("hidden")};

async function loadBuilder(){
  try{
    const[catalog,current,aiStatus]=await Promise.all([api("/api/builder/catalog"),api("/api/builder/current"),api("/api/builder/ai/status")]);
    const selected=current.modules.filter(item=>item.enabled).map(item=>item.code);
    state.builder={catalog,current,step:1,profileCode:current.profile?.template_code||"general",selected:new Set(selected),answers:{organization_type:current.profile?.template_code||"general",employee_count:1},project:null,planned:null,ai:{status:aiStatus,open:false,session:null,messages:[],proposal:null,busy:false}};
    render();
  }catch(error){toast(error.message,true)}
}

function maturityLabel(value){return value==="verified"?"Баталгаажсан":value==="pilot"?"Pilot":value==="draft"?"Ноорог":value}
function renderBuilder(){
  const b=state.builder;
  if(!b){$("#pageContent").innerHTML=`${header("OVERVA BUILDER","Байгууллагадаа тохируулж эхэлье","OVERVA-ийн баталгаажсан сангаас хэрэгтэй бүтэц, модулиа сонгоно.")}<div class="builder-loading">Builder-ийн каталогийг ачаалж байна...</div>`;queueMicrotask(loadBuilder);return}
  const stepBody=b.ai.open?builderAiChat(b):b.step===1?builderQuestions(b):b.step===2?builderTemplates(b):b.step===3?builderModules(b):builderPreview(b);
  const aiButton=`<button class="${b.ai.open?"secondary":"primary"}" data-builder-ai-toggle>${b.ai.open?"Гараар тохируулах":"✦ BA AI-тай ярилцах"}</button>`;
  $("#pageContent").innerHTML=`${header("OVERVA BUILDER","Байгууллагаа бүхэлд нь нэг дор хар.","Хэрэгцээгээ тодорхойлоод, баталгаажсан модулиудаар өөрийн ERP орчноо угсарна.")}<div class="builder-ai-toolbar"><div><strong>OVERVA BA AI</strong><small>Бизнес анализын дарааллаар хэрэгцээг тодруулж, зөвхөн батлагдсан сангаас санал гаргана.</small></div>${aiButton}</div><div class="builder-shell ${b.ai.open?"builder-ai-mode":""}"><aside class="builder-steps">${[[1,"Хэрэгцээ"],[2,"Загвар"],[3,"Модуль"],[4,"Хянах"]].map(([n,t])=>`<button class="builder-step ${b.step===n?"active":""}" data-builder-step="${n}" ${b.ai.open?"disabled":""}><b>${n}</b>${t}</button>`).join("")}</aside><section>${stepBody}</section></div>`;
}

function builderAiChat(b){
  const ai=b.ai;
  if(!ai.status.enabled)return `<div class="builder-card builder-ai-card"><div class="builder-ai-head"><div><span class="builder-ai-mark">✦</span><h2>BA AI тохиргоо хүлээж байна</h2></div></div><p>AI код бэлэн болсон. Серверт OpenAI project API key-г secret файлаар холбоход энэ цонхоор ярилцаж эхэлнэ. Нууц түлхүүрийг Git, чат эсвэл browser-д хадгалахгүй.</p><div class="builder-notice">Одоогоор гараар ажилладаг Builder хэвийн ажиллаж байна.</div></div>`;
  const messages=ai.messages.length?ai.messages.map(m=>`<article class="builder-ai-message ${m.role}"><b>${m.role==="user"?"Та":"OVERVA BA AI"}</b><p>${esc(m.content)}</p>${(m.metadata?.questions||[]).map(q=>`<div class="builder-ai-question">${esc(q)}</div>`).join("")}</article>`).join(""):`<div class="builder-ai-welcome"><span class="builder-ai-mark">✦</span><h2>ERP хэрэгцээгээ ярьж эхэлье</h2><p>Байгууллага юу хийдэг, одоо ажлаа яаж явуулдаг, хамгийн хүндрэлтэй 2–3 асуудлаа энгийнээр бичээрэй.</p><div class="builder-ai-guard">AI зөвхөн санал гаргана · Дүрмийн сан шалгана · Та зөвшөөрсний дараа Builder-д орно</div></div>`;
  const proposal=ai.proposal?builderAiProposal(ai.proposal,b):"";
  return `<div class="builder-card builder-ai-card"><div class="builder-ai-head"><div><span class="builder-ai-mark">✦</span><div><h2>OVERVA BA AI</h2><small>${esc(ai.status.model)} · Business analysis assistant</small></div></div>${ai.session?'<button class="secondary" data-builder-ai-new>Шинэ ярилцлага</button>':""}</div><div class="builder-ai-messages">${messages}</div>${proposal}<form id="builderAiForm" class="builder-ai-form"><textarea name="content" minlength="2" maxlength="6000" rows="3" required ${ai.busy?"disabled":""} placeholder="Жишээ: Манай байгууллага 25 ажилтантай, захиалга Excel-ээр авч, ажлыг утсаар хуваарилдаг..."></textarea><button class="primary" type="submit" ${ai.busy?"disabled":""}>${ai.busy?"Шинжилж байна…":"AI-д илгээх"}</button></form><small class="builder-ai-privacy">Хувийн нууц, банкны мэдээлэл, нууц үг, API key бүү оруулаарай.</small></div>`;
}

function builderAiProposal(item,b){
  const p=item.proposal||{},validation=item.deterministic_validation||{},names=(p.moduleCodes||[]).map(code=>b.catalog.modules.find(m=>m.code===code)?.name||code);
  return `<div class="builder-ai-proposal"><div><span class="builder-pill ${validation.valid?"verified":"draft"}">${validation.valid?"Дүрмийн шалгалт давсан":"Нэмэлт тодруулга шаардлагатай"}</span><h3>${esc(b.catalog.templates.find(t=>t.code===p.profileCode)?.name||p.profileCode||"AI санал")}</h3></div><div class="builder-tags">${names.map(x=>`<span>${esc(x)}</span>`).join("")}</div>${(p.reasons||[]).map(x=>`<p>• ${esc(x)}</p>`).join("")}${(validation.errors||[]).map(x=>`<div class="builder-notice">${esc(typeof x==="string"?x:x.message||JSON.stringify(x))}</div>`).join("")}<div class="builder-actions"><button class="secondary" data-builder-ai-reject="${item.id}">Татгалзах</button><button class="primary" data-builder-ai-accept="${item.id}" ${validation.valid?"":"disabled"}>Builder-д оруулах</button></div></div>`;
}

function builderQuestions(b){
  const booleans=b.catalog.questions.filter(q=>q.input_type==="boolean");
  return `<div class="builder-card"><h2>Танай байгууллагын хэрэгцээ</h2><p>Эдгээр хариулт модуль санал болгоход ашиглагдана. Дараа нь хүссэн үедээ өөрчилж болно.</p><label class="builder-question">Ажилтны тоо<input type="number" min="1" max="100000" data-builder-answer="employee_count" value="${Number(b.answers.employee_count)||1}"></label><div class="builder-grid">${booleans.map(q=>`<label class="builder-toggle"><span>${esc(q.prompt)}</span><input type="checkbox" data-builder-answer="${esc(q.code)}" ${b.answers[q.code]?"checked":""}></label>`).join("")}</div>${builderActions(1)}</div>`
}
function builderTemplates(b){
  return `<div class="builder-card"><h2>Салбарын эхлэх загвар</h2><p>Загвар нь Core-ийг өөрчлөхгүй. Зөвхөн тохирох ажлын төрөл, ангилал болон модулийг санал болгоно.</p><div class="builder-grid">${b.catalog.templates.map(t=>`<label class="builder-option"><input type="radio" name="builderTemplate" value="${t.code}" ${b.profileCode===t.code?"checked":""}><strong>${esc(t.name)}</strong><small>${esc(t.description)}</small><span class="builder-pill ${t.maturity}">${maturityLabel(t.maturity)} · v${t.version}</span></label>`).join("")}</div>${builderActions(2)}</div>`
}
function builderModules(b){
  const approval=new Set(b.catalog.rules.filter(r=>r.rule_type==="requires_approval").map(r=>r.subject_code));
  return `<div class="builder-card"><h2>Хэрэгтэй модулиудаа сонгоно уу</h2><p>Core модулиуд байнга ажиллана. Техникийн эрсдэлтэй холболтууд зөвлөгөө, баталгаажуулалтын дараа асна.</p><div class="builder-grid">${b.catalog.modules.map(m=>`<label class="builder-option ${m.core?"builder-core":""}"><input type="checkbox" data-builder-module="${m.code}" ${b.selected.has(m.code)||m.core?"checked":""} ${m.core?"disabled":""}><strong>${esc(m.name)}</strong><small>${esc(m.description)}</small><span class="builder-pill">${esc(m.category)}</span>${m.core?'<small class="builder-lock">Core · үргэлж идэвхтэй</small>':approval.has(m.code)?'<small class="builder-lock">OVERVA зөвшөөрөл шаардлагатай</small>':""}</label>`).join("")}</div>${builderActions(3)}</div>`
}
function builderPreview(b){
  const plan=b.planned,selected=[...b.selected],template=b.catalog.templates.find(t=>t.code===b.profileCode);
  const enabled=plan?.configuration?.enabledModules||selected;
  const history=b.current.builds.filter(x=>x.project_id!==null).slice(0,8);
  return `<div class="builder-card"><h2>Тохиргоогоо хянах</h2><p>Хэрэгжүүлэхээс өмнө OVERVA дүрмийн сан dependency, Core болон зөвшөөрлийг дахин шалгана.</p><div class="builder-summary"><h3>${esc(template?.name||b.profileCode)}</h3><div class="builder-tags">${enabled.map(code=>`<span>${esc(b.catalog.modules.find(m=>m.code===code)?.name||code)}</span>`).join("")}</div>${(plan?.validation?.warnings||[]).map(x=>`<div class="builder-notice">${esc(x)}</div>`).join("")}${(plan?.validation?.requiresApproval||[]).map(x=>`<div class="builder-notice">${esc(x.message)}</div>`).join("")}</div><div class="builder-actions"><button class="secondary" data-builder-step="3">← Буцах</button>${plan?'<button class="primary" data-builder-apply>Тохиргоог хэрэгжүүлэх</button>':'<button class="primary" data-builder-plan>Төлөвлөгөө үүсгэх</button>'}</div></div><div class="builder-history"><div class="panel-head"><h2>Хувилбарын түүх</h2></div>${history.length?history.map(x=>`<div class="builder-history-row"><div><strong>v${x.version_no} · ${esc(x.configuration.profileCode)}</strong><small>${dateTime(x.applied_at||x.created_at)} · ${x.status}</small></div><span class="badge ${x.status==="applied"?"active":"inactive"}">${x.status}</span>${x.status!=="applied"?`<button class="secondary" data-builder-restore="${x.id}">Сэргээх</button>`:"<span></span>"}</div>`).join(""):'<div class="builder-empty">Одоогоор Builder хувилбар үүсээгүй.</div>'}</div><form class="builder-support" id="builderSupportForm"><h3>Тохиргоонд тусламж хэрэгтэй юу?</h3><p>OVERVA багт зөвлөгөөний хүсэлт үлдээнэ үү.</p><textarea name="description" rows="3" minlength="10" maxlength="5000" required placeholder="Ямар тохиргоонд тусламж хэрэгтэйг бичнэ үү..."></textarea><button class="secondary" type="submit">Зөвлөгөө хүсэх</button></form>`
}
function builderActions(step){return `<div class="builder-actions">${step>1?`<button class="secondary" data-builder-step="${step-1}">← Буцах</button>`:"<span></span>"}<button class="primary" data-builder-step="${step+1}">Үргэлжлүүлэх →</button></div>`}

function applyAnswerRecommendations(b){
  const map={manages_assets:["assets"],manages_inventory:["inventory"],field_work:["work-orders","field"],approval_workflow:["procurement"],tracks_attendance:["attendance"],manages_records:["records","archive"]};
  Object.entries(map).forEach(([answer,modules])=>{if(b.answers[answer])modules.forEach(code=>b.selected.add(code))});
}
async function createBuilderPlan(){
  const b=state.builder;applyAnswerRecommendations(b);
  try{
    if(!b.project){const created=await api("/api/builder/projects",{method:"POST",body:JSON.stringify({name:`${state.organization.name} тохиргоо`,answers:b.answers})});b.project=created.item}
    const out=await api(`/api/builder/projects/${b.project.id}/plan`,{method:"POST",body:JSON.stringify({profileCode:b.profileCode,moduleCodes:[...b.selected],answers:b.answers})});
    b.planned=out.item;b.current.builds.unshift(out.item);render();toast("Төлөвлөгөө бэлэн боллоо");
  }catch(error){toast(error.message,true)}
}
async function applyBuilderPlan(){
  try{const out=await api(`/api/builder/builds/${state.builder.planned.id}/apply`,{method:"POST",body:"{}"});state.builder.planned=out.item;await reloadModuleAccess();state.organization.builderConfigured=true;await loadBuilder();toast("OVERVA тохиргоо хэрэгжлээ")}catch(error){toast(error.message,true)}
}
async function restoreBuilder(id){
  if(!confirm("Энэ тохиргоог шинэ хувилбар болгон сэргээх үү?"))return;
  try{await api(`/api/builder/builds/${id}/restore`,{method:"POST",body:"{}"});await reloadModuleAccess();await loadBuilder();toast("Сонгосон тохиргоог шинэ хувилбараар сэргээв")}catch(error){toast(error.message,true)}
}

async function startBuilderAiSession(){
  const ai=state.builder.ai;
  const out=await api("/api/builder/ai/sessions",{method:"POST",body:JSON.stringify({title:`${state.organization.name} ERP шинжилгээ`,projectId:state.builder.project?.id||null})});
  ai.session=out.item;ai.messages=[];ai.proposal=null;
}
async function sendBuilderAi(content){
  const ai=state.builder.ai;if(ai.busy)return;ai.busy=true;render();
  try{
    if(!ai.session)await startBuilderAiSession();
    const out=await api(`/api/builder/ai/sessions/${ai.session.id}/messages`,{method:"POST",body:JSON.stringify({content})});
    ai.messages.push(out.userMessage,out.assistantMessage);ai.proposal=out.proposal||null;
    render();queueMicrotask(()=>document.querySelector(".builder-ai-messages")?.scrollTo({top:999999,behavior:"smooth"}));
  }catch(error){toast(error.message,true)}finally{ai.busy=false;render()}
}
async function acceptBuilderAiProposal(id){
  try{
    const out=await api(`/api/builder/ai/proposals/${id}/accept`,{method:"POST",body:"{}"}),config=out.configuration,b=state.builder;
    b.profileCode=config.profileCode;b.answers={...b.answers,...(config.answers||{}),organization_type:config.profileCode};b.selected=new Set(config.enabledModules||[]);b.planned=null;b.step=4;b.ai.open=false;b.ai.proposal=null;
    render();toast("AI санал Builder-д орлоо. Одоо төлөвлөгөөг хянаж үүсгэнэ үү.");
  }catch(error){toast(error.message,true)}
}
async function rejectBuilderAiProposal(id){
  try{await api(`/api/builder/ai/proposals/${id}/reject`,{method:"POST",body:"{}"});state.builder.ai.proposal=null;render();toast("AI саналыг татгалзлаа") }catch(error){toast(error.message,true)}
}

document.addEventListener("click",event=>{const step=event.target.closest("[data-builder-step]"),plan=event.target.closest("[data-builder-plan]"),apply=event.target.closest("[data-builder-apply]"),restore=event.target.closest("[data-builder-restore]"),aiToggle=event.target.closest("[data-builder-ai-toggle]"),aiNew=event.target.closest("[data-builder-ai-new]"),aiAccept=event.target.closest("[data-builder-ai-accept]"),aiReject=event.target.closest("[data-builder-ai-reject]");if(step&&state.builder&&!state.builder.ai.open){state.builder.step=Number(step.dataset.builderStep);render()}if(plan)createBuilderPlan();if(apply)applyBuilderPlan();if(restore)restoreBuilder(restore.dataset.builderRestore);if(aiToggle&&state.builder){state.builder.ai.open=!state.builder.ai.open;render()}if(aiNew&&state.builder){state.builder.ai.session=null;state.builder.ai.messages=[];state.builder.ai.proposal=null;render()}if(aiAccept)acceptBuilderAiProposal(aiAccept.dataset.builderAiAccept);if(aiReject)rejectBuilderAiProposal(aiReject.dataset.builderAiReject)});
document.addEventListener("change",event=>{if(!state.builder)return;if(event.target.matches("[data-builder-answer]")){const key=event.target.dataset.builderAnswer;state.builder.answers[key]=event.target.type==="checkbox"?event.target.checked:Number(event.target.value)}if(event.target.name==="builderTemplate"){state.builder.profileCode=event.target.value;state.builder.answers.organization_type=event.target.value;const defaults=state.builder.catalog.templateModules.filter(x=>x.template_code===event.target.value&&x.enabled_by_default);defaults.forEach(x=>state.builder.selected.add(x.module_code))}if(event.target.matches("[data-builder-module]")){event.target.checked?state.builder.selected.add(event.target.dataset.builderModule):state.builder.selected.delete(event.target.dataset.builderModule)}});
document.addEventListener("submit",async event=>{if(event.target.id==="builderAiForm"){event.preventDefault();const content=String(new FormData(event.target).get("content")||"").trim();if(content)sendBuilderAi(content);return}if(event.target.id!=="builderSupportForm")return;event.preventDefault();const description=new FormData(event.target).get("description");try{await api("/api/builder/support-requests",{method:"POST",body:JSON.stringify({projectId:state.builder.project?.id||null,buildId:state.builder.planned?.id||null,title:"Builder тохиргооны зөвлөгөө",description})});event.target.reset();toast("Зөвлөгөөний хүсэлт илгээгдлээ")}catch(error){toast(error.message,true)}});
