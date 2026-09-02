"use strict";

// Grouped review-only surface. It exposes no import or target-creation action.
state.legacyMigrationFilters={category:"",recommendation:"",reviewStatus:"PENDING",search:"",safeCanonical:false,offset:0};

const legacyCategoryLabels={ATTENDANCE:"Ирцийн reconciliation",INACTIVE_USER:"Идэвхгүй хэрэглэгч",ORDER_DECISION:"Тушаал / шийдвэр",CORRESPONDENCE:"Албан бичиг",DOCUMENT_ATTACHMENT:"Файл / хавсралт"};
const legacyRecommendationLabels={IMPORT_NEW:"IMPORT_NEW санал",LEGACY_ONLY:"LEGACY_ONLY санал",MANUAL_REVIEW:"Гараар шалгана",RECONCILE_REQUIRED:"Reconciliation шаардлагатай"};

async function loadLegacyMigrationReview(){
  if(!state.permissions.includes("legacy_migration.read"))return;
  const params=new URLSearchParams();
  Object.entries(state.legacyMigrationFilters).forEach(([key,value])=>{if(value!==""&&value!=null&&value!==false)params.set(key,value)});
  params.set("limit","200");
  const data=await api(`/api/legacy-migration/review-groups/overview?${params}`);
  if(state.administration.hr)state.administration.hr.legacyReview=data;
  if(state.view==="hr"&&(state.domainSections.hr||"dashboard")==="migration-review")render();
}

const legacyMigrationLoadBefore=loadAdministration;
loadAdministration=async function(view){
  const legacyPromise=view==="hr"&&state.permissions.includes("legacy_migration.read")?api("/api/legacy-migration/review-groups/overview?reviewStatus=PENDING&limit=200"):null;
  await legacyMigrationLoadBefore(view);
  if(legacyPromise&&state.administration.hr){
    try{state.administration.hr.legacyReview=await legacyPromise;if(state.view==="hr")render()}
    catch(error){toast(error.message,true)}
  }
};

const legacyMigrationAdjustBefore=adjustModuleNavigation;
adjustModuleNavigation=function(){legacyMigrationAdjustBefore();document.querySelector("[data-legacy-review-nav]")?.classList.toggle("hidden",!state.permissions.includes("legacy_migration.read"))};

function legacySignals(signals){return (signals||[]).map(signal=>`<span class="legacy-signal">${esc(signal)}</span>`).join("")||"—"}
function legacyGroupSummary(group){
  const summary=group.source_summary||{};
  if(group.category==="ATTENDANCE")return `<strong>${esc(summary.date||"—")}</strong><small>Legacy employee #${esc(summary.legacyUserId)} · ${summary.rawRowCount} raw мөр · candidate #${esc(summary.primaryCandidateLegacyId)}</small>`;
  if(group.category==="INACTIVE_USER")return `<strong>${esc(summary.fullName||summary.username||"—")}</strong><small>Active overlap: ${(summary.activeEmployeeOverlapLegacyIds||[]).length} · HR evidence: ${summary.hrEvidenceCount||0} · activity: ${summary.legacyActivityCount||0} · last: ${esc(summary.lastActivity||"—")}</small>`;
  const records=summary.records||[];
  if(group.category==="ORDER_DECISION")return `<strong>${esc(summary.documentNumber||"Дугааргүй")}</strong><small>${records.map(item=>`${item.type||"—"} · ${item.date||"—"} · employee ${item.relatedLegacyUserId||"—"} · attachment ${item.attachmentCount||0}`).join(" | ")}</small>`;
  if(group.category==="CORRESPONDENCE")return `<strong>${esc(records[0]?.number||"Дугааргүй")} · ${esc(records[0]?.source||"Эх сурвалжгүй")}</strong><small>${records.map(item=>`${item.date||"—"} · assignee ${item.assignedLegacyUserId||"—"} · attachment ${item.attachmentCount||0}`).join(" | ")}</small>`;
  return `<strong>${summary.rawRowCount||group.member_count} файл</strong><small>SHA-256: ${esc(summary.contentSha256||"—")} · ${(summary.records||[]).map(item=>`${item.legacyTable}/${item.legacyId} → ${item.parent||"parent-гүй"}`).join(" | ")}</small>`;
}
function legacyMemberDetails(group){
  const members=group.members||[];
  return `<details><summary>${members.length} source мөрийн дэлгэрэнгүй</summary><div class="legacy-members">${members.map(item=>`<article class="legacy-member ${item.memberRole==="PRIMARY_CANDIDATE"?"primary":""}"><strong>${esc(item.memberRole)} · ${esc(item.legacyTable)}/${esc(item.legacyId)}</strong><small>${esc(item.recommendationReason||"")}</small><pre>${esc(JSON.stringify(item.sourceSummary||{},null,2))}</pre></article>`).join("")}</div></details>`;
}

function legacyMigrationView(d){
  const review=d.legacyReview;
  if(!review){queueMicrotask(loadLegacyMigrationReview);return `${hrWorkspaceTabs()}${header("LEGACY MIGRATION","Grouped provenance review","Legacy өгөгдлийг import хийхгүйгээр deterministic review case болгон бэлтгэж байна.")}<section class="admin-panel"><p>Review case ачаалж байна...</p></section>`}
  const canReview=state.permissions.includes("legacy_migration.review"),summary=review.summary||{};
  const categoryCounts=Object.fromEntries((review.categoryCounts||[]).map(item=>[item.category,item]));
  const rows=(review.items||[]).map(group=>{
    const blocked=group.requires_external_evidence&&group.external_evidence_status!=="VERIFIED";
    const safeImport=group.recommendation==="IMPORT_NEW"&&group.confidence==="HIGH"&&!group.requires_external_evidence&&["ORDER_DECISION","CORRESPONDENCE"].includes(group.category);
    const check=canReview&&group.review_status==="PENDING"?`<input type="checkbox" data-select-legacy-group data-safe-import="${safeImport}" data-id="${group.id}" data-version="${group.version}" aria-label="Case сонгох">`:"";
    return `<tr class="${blocked?"legacy-blocked":""}"><td>${check}</td><td><span class="legacy-category">${esc(legacyCategoryLabels[group.category]||group.category)}</span>${legacyGroupSummary(group)}${legacyMemberDetails(group)}</td><td><strong>${esc(legacyRecommendationLabels[group.recommendation]||group.recommendation)}</strong><small>${esc(group.confidence)} confidence · v${group.version}</small><p>${esc(group.recommendation_reason)}</p></td><td><div class="legacy-signals">${legacySignals(group.signals)}</div>${blocked?'<div class="legacy-evidence-block">Final decision хаалттай: production reconciliation evidence байхгүй.</div>':""}</td><td><strong>${esc(group.review_status)}</strong><small>${esc(group.reviewed_by_name||"Шийдээгүй")} ${group.reviewed_at?`· ${dateTime(group.reviewed_at)}`:""}</small><button type="button" data-legacy-group-history="${group.id}">Decision history</button></td></tr>`;
  }).join("");
  const categories=["ATTENDANCE","INACTIVE_USER","ORDER_DECISION","CORRESPONDENCE","DOCUMENT_ATTACHMENT"];
  return `${hrWorkspaceTabs()}${header("LEGACY MIGRATION","Safe batch review","Actual import, employee/master update, workflow history үүсгэх үйлдэл энэ дэлгэцэд байхгүй.")}
    ${administrationCards([["Pending case",summary.unresolved_groups||0],["Raw мөр",summary.unresolved_raw_rows||0],["Grouping-аар буурсан",summary.raw_rows_reduced_by_grouping||0],["Safe recommendation",summary.safe_recommended_groups||0],["True manual review",summary.true_manual_groups||0,"warn"],["Evidence хүлээж буй",summary.external_evidence_blocked_groups||0,"warn"]])}
    <nav class="legacy-category-tabs"><button type="button" data-legacy-category="" class="${!state.legacyMigrationFilters.category?"active":""}">Бүгд · ${summary.groups||0}</button>${categories.map(category=>`<button type="button" data-legacy-category="${category}" class="${state.legacyMigrationFilters.category===category?"active":""}">${esc(legacyCategoryLabels[category])} · ${categoryCounts[category]?.groups||0}</button>`).join("")}</nav>
    <form class="admin-form legacy-filter" id="legacyMigrationFilter"><div class="admin-fields"><label>Recommendation<select name="recommendation"><option value="">Бүгд</option>${Object.keys(legacyRecommendationLabels).map(value=>`<option value="${value}" ${state.legacyMigrationFilters.recommendation===value?"selected":""}>${esc(legacyRecommendationLabels[value])}</option>`).join("")}</select></label><label>Review status<select name="reviewStatus">${["PENDING","APPROVED","LEGACY_ONLY","MANUAL_REVIEW",""] .map(value=>`<option value="${value}" ${state.legacyMigrationFilters.reviewStatus===value?"selected":""}>${value||"Бүгд"}</option>`).join("")}</select></label><label>Хайх<input name="search" value="${esc(state.legacyMigrationFilters.search)}" placeholder="employee, date, number, source, hash"></label></div><button class="secondary">Шүүх</button></form>
    ${canReview?`<form id="legacyBatchReview" class="admin-panel legacy-batch"><div><strong><span data-legacy-selected-count>0</span> case сонгосон</strong><small>Нэг case сонговол single group decision болно. Нэг batch хамгийн ихдээ 200 case.</small><button type="button" class="secondary" data-select-safe-import>Харагдаж буй safe recommendation сонгох</button></div><label>Batch action<select name="action"><option value="APPROVE_RECOMMENDATION">Recommendation зөвшөөрөх</option><option value="MARK_LEGACY_ONLY">LEGACY_ONLY болгох</option><option value="SEND_MANUAL_REVIEW">Manual review руу илгээх</option></select></label><label>Reviewer note<textarea name="note" maxlength="4000" placeholder="Нэмэлт үндэслэл / тэмдэглэл"></textarea></label><button class="primary">Append batch decision</button></form>`:""}
    <section class="admin-panel"><div class="panel-head"><div><h2>Grouped review queue</h2><span>${review.items.length} case · offset ${review.paging?.offset||0}</span></div><span class="legacy-no-import">NO IMPORT</span></div><div class="admin-table-wrap legacy-group-table"><table><thead><tr><th></th><th>Review case</th><th>Recommendation</th><th>Conflict / signal</th><th>Decision</th></tr></thead><tbody>${rows||'<tr><td colspan="5">Тохирох review case алга.</td></tr>'}</tbody></table></div><div class="legacy-paging"><button type="button" data-legacy-page="prev" ${Number(state.legacyMigrationFilters.offset||0)<=0?"disabled":""}>Өмнөх</button><button type="button" data-legacy-page="next" ${review.items.length<200?"disabled":""}>Дараах</button></div></section><section id="legacyDecisionHistory"></section>`;
}

const legacyMigrationHrBefore=hrAdministration;
hrAdministration=function(d){return (state.domainSections.hr||"dashboard")==="migration-review"?legacyMigrationView(d):legacyMigrationHrBefore(d)};

document.addEventListener("submit",async event=>{
  if(event.target.id==="legacyMigrationFilter"){
    event.preventDefault();const values=Object.fromEntries(new FormData(event.target));state.legacyMigrationFilters={...state.legacyMigrationFilters,...values,offset:0};
    try{await loadLegacyMigrationReview()}catch(error){toast(error.message,true)}return;
  }
  if(event.target.id!=="legacyBatchReview")return;
  event.preventDefault();
  const selections=[...document.querySelectorAll("[data-select-legacy-group]:checked")].map(input=>({groupId:input.dataset.id,expectedVersion:Number(input.dataset.version)}));
  if(!selections.length){toast("Review case сонгоно уу",true);return}
  const values=Object.fromEntries(new FormData(event.target));
  try{
    await api("/api/legacy-migration/review-groups/batch-decisions",{method:"POST",body:JSON.stringify({idempotencyKey:crypto.randomUUID(),action:values.action,selections,note:values.note||""})});
    await loadLegacyMigrationReview();toast("Batch decision append-only түүхэнд бүртгэгдлээ. Import хийгдээгүй.");
  }catch(error){toast(error.message,true)}
});

document.addEventListener("change",event=>{if(event.target.matches("[data-select-legacy-group]"))document.querySelector("[data-legacy-selected-count]")?.replaceChildren(String(document.querySelectorAll("[data-select-legacy-group]:checked").length))});
document.addEventListener("click",async event=>{
  const selectSafe=event.target.closest("[data-select-safe-import]");
  if(selectSafe){document.querySelectorAll('[data-select-legacy-group][data-safe-import="true"]').forEach(input=>input.checked=true);document.querySelector("[data-legacy-selected-count]")?.replaceChildren(String(document.querySelectorAll("[data-select-legacy-group]:checked").length));return}
  const categoryButton=event.target.closest("[data-legacy-category]");
  if(categoryButton){state.legacyMigrationFilters.category=categoryButton.dataset.legacyCategory;state.legacyMigrationFilters.offset=0;try{await loadLegacyMigrationReview()}catch(error){toast(error.message,true)}return}
  const page=event.target.closest("[data-legacy-page]");
  if(page){const direction=page.dataset.legacyPage==="next"?200:-200;state.legacyMigrationFilters.offset=Math.max(0,Number(state.legacyMigrationFilters.offset||0)+direction);try{await loadLegacyMigrationReview()}catch(error){toast(error.message,true)}return}
  const button=event.target.closest("[data-legacy-group-history]");if(!button)return;
  try{
    const data=await api(`/api/legacy-migration/review-groups/${button.dataset.legacyGroupHistory}`),panel=document.querySelector("#legacyDecisionHistory");
    panel.className="admin-panel";panel.innerHTML=`<div class="panel-head"><h2>Decision history · ${esc(legacyCategoryLabels[data.item.category]||data.item.category)}</h2><button type="button" data-legacy-history-close>Хаах</button></div><ul class="domain-timeline">${data.decisions.map(item=>`<li><strong>v${item.decision_version} · ${esc(item.action)} · ${esc(item.to_review_status)}</strong><span>${esc(item.actor_name)} · ${dateTime(item.created_at)}</span><small>${esc(item.reason)} ${esc(item.notes||"")}</small></li>`).join("")}</ul>`;
    panel.scrollIntoView({behavior:"smooth",block:"start"});
  }catch(error){toast(error.message,true)}
});
document.addEventListener("click",event=>{if(event.target.closest("[data-legacy-history-close]"))document.querySelector("#legacyDecisionHistory")?.replaceChildren()});
