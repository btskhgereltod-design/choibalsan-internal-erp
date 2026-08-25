"use strict";

function renderAiUsage(){
  const data=state.aiUsage;
  if(!data)return;
  const summary=data.summary||{};
  $("#aiUsageStats").innerHTML=[
    ["AI ажил",summary.events||0,"Сонгосон хугацаанд"],
    ["Нийт token",number(summary.total_tokens).toLocaleString(),"OpenAI хэрэглээ"],
    ["Cached input",number(summary.cached_input_tokens).toLocaleString(),"Дахин ашигласан оролт"],
    ["Hercules credit",number(summary.external_credits).toFixed(2),"Гадаад хэрэгслийн зардал"],
    ["Хүлээн авсан",summary.accepted||0,"Production-д ашигласан"],
    ["Татгалзсан",summary.rejected||0,"Ашиглаагүй үр дүн"]
  ].map(item=>`<article class="stat"><span>${esc(item[0])}</span><strong>${esc(item[1])}</strong><small>${esc(item[2])}</small></article>`).join("");
  $("#aiUsageBreakdown").innerHTML=(data.breakdown||[]).map(item=>`<article class="ai-usage-row"><div><strong>${esc(item.provider)} · ${esc(item.operation_mode)}</strong><small>${esc(item.model||"external tool")}</small></div><span>${number(item.events)} ажил</span><span>${number(item.total_tokens).toLocaleString()} token</span><span>${number(item.external_credits).toFixed(2)} credit</span></article>`).join("")||'<div class="empty-state">AI хэрэглээ бүртгэгдээгүй байна.</div>';
  $("#aiUsageRecent").innerHTML=(data.recent||[]).map(item=>`<article class="ai-usage-row"><div><strong>${esc(item.scope||`${item.provider} ${item.operation_mode}`)}</strong><small>${esc(item.artifact_reference||item.model||"Artifact холбоосгүй")} · ${dateTime(item.created_at)}</small></div><span>${esc(item.provider)}</span><span>${esc(item.outcome||"partial")}</span><span>${number(item.external_credits)>0?`${number(item.external_credits).toFixed(2)} credit`:`${number(item.total_tokens).toLocaleString()} token`}</span></article>`).join("")||'<div class="empty-state">Сүүлийн AI ажил алга.</div>';
  const governance=data.moduleGovernance||{},modules=governance.modules||[],routes=governance.routes||[];
  $("#moduleGovernance").innerHTML=`<div class="card-head"><div><span class="eyebrow">MODULE CONTRACTS</span><h2>Hercules-д өгөх хяналттай хүрээ</h2><p>Manifest болон route contract байхгүй модулийг production-д нийлүүлэхгүй.</p></div><b>${modules.filter(item=>item.manifest_version).length}/${modules.length} manifest</b></div><div class="ai-usage-list">${modules.map(item=>`<article class="ai-usage-row"><div><strong>${esc(item.name)}</strong><small>${esc(item.code)} · ${esc(item.category)}</small></div><span>${item.manifest_version?`v${esc(item.manifest_version)}`:"Manifest дутуу"}</span><span>${esc(item.lifecycle_status||"draft")}</span><span>${esc(item.route_prefix||"Route дутуу")}</span></article>`).join("")||'<div class="empty-state">Модулийн каталог алга.</div>'}</div><div class="ai-usage-recent"><strong>Route registry</strong><small>${routes.length} бүртгэл · ${routes.filter(item=>item.reserved).length} reserved route</small></div>`;
}

async function recordExternalAiUsage(event){
  event.preventDefault();
  const form=event.currentTarget,values=Object.fromEntries(new FormData(form));
  values.externalCredits=Number(values.externalCredits||0);
  if(values.outcome==="failed")values.outcome="error";
  if(!values.artifactReference)delete values.artifactReference;
  try{
    await api("/api/platform/ai-usage/external",{method:"POST",body:JSON.stringify(values)});
    form.reset();
    await refresh();
    toast("AI хэрэглээ бүртгэгдлээ");
  }catch(error){toast(error.message,true)}
}

document.addEventListener("DOMContentLoaded",()=>{
  const form=document.querySelector("#externalAiUsageForm");
  if(form)form.addEventListener("submit",recordExternalAiUsage);
});
