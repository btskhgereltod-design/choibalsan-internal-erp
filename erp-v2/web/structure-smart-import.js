"use strict";

state.structureSmartImport={items:null,job:null,loading:false,busy:false};
const structureImportFields={unitCode:"Нэгжийн код",unitName:"Нэгжийн нэр",unitType:"Нэгжийн төрөл",parentUnit:"Дээд нэгж",positionCode:"Орон тооны код",positionTitle:"Албан тушаал",rankLevel:"Шатлал (1-20)",headcountLimit:"Батлагдсан орон тоо"};
const structureImportStatuses={needs_review:"Хүний хяналт хүлээж байна",approved:"Баталсан",importing:"Импортолж байна",completed:"Дууссан",failed:"Алдаатай"};
const structureImportActions={create:"Үүсгэх",update:"Шинэчлэх",skip:"Алгасах"};
const structureImportValidations={valid:"Шалгалт давсан",warning:"Хянах шаардлагатай",error:"Засах шаардлагатай"};
const structureImportDecisions={pending:"Шийдвэрлээгүй",accepted:"Зөвшөөрсөн",corrected:"Засаж зөвшөөрсөн",excluded:"Хассан"};
const structureImportOutcomes={not_applied:"Оруулаагүй",created:"Үүсгэсэн",updated:"Шинэчилсэн",skipped:"Алгассан",rejected:"Хассан",failed:"Амжилтгүй"};
const structureImportBaseContent=structureSettingsContent;

async function loadStructureImports(){
  const value=state.structureSmartImport;if(value.loading)return;value.loading=true;
  try{const result=await api("/api/structure-smart-imports");value.items=result.items;}
  catch(error){toast(error.message,true)}finally{value.loading=false;if(state.view==="settings"&&state.settingsTab==="structure")render()}
}
async function loadStructureImportJob(id){
  try{const result=await api(`/api/structure-smart-imports/${id}`);state.structureSmartImport.job=result.item;render()}
  catch(error){toast(error.message,true)}
}
function structureImportMapping(job){
  return `<form id="structureImportMappingForm" class="admin-form smart-import-mapping"><div class="panel-head"><div><h2>Баганын утгыг шалгах</h2><p>AI болон дүрмийн санал. Нэгжийн нэрийг заавал зөв холбоно.</p></div><button class="secondary">Дахин шалгах</button></div><div class="smart-import-map-grid">${job.source_columns.map(source=>{const confidence=job.mapping_confidence?.[source];return `<label><span>${esc(source)}</span><select data-structure-import-source="${esc(source)}"><option value="">Импортлохгүй</option>${Object.entries(structureImportFields).map(([value,label])=>`<option value="${value}" ${job.proposed_mapping?.[source]===value?"selected":""}>${label}</option>`).join("")}</select><small>${confidence?`${Math.round(Number(confidence.score||0)*100)}% · ${esc(confidence.reason||"")}`:"Гараар тохируулна"}</small></label>`}).join("")}</div></form>`;
}
function structureImportReviewForm(row,value){
  if(row.review_decision==="excluded"||row.commit_outcome!=="not_applied")return "";
  return `<details class="structure-import-row-review"><summary>Засаж хянах</summary><form data-structure-import-row-form="${row.row_number}"><div class="structure-import-row-fields">${Object.entries(structureImportFields).map(([field,label])=>`<label><span>${label}</span><input name="${field}" value="${esc(value[field]??"")}"></label>`).join("")}</div><label><span>Зассан тайлбар</span><input name="reason" maxlength="500" placeholder="Юуг, яагаад зассанаа товч бичнэ"></label><div class="smart-import-actions"><button class="primary">Засаж зөвшөөрөх</button><button type="button" class="secondary" data-structure-import-accept="${row.row_number}" ${row.validation_state==="error"?"disabled":""}>Өгөгдлийг зөвшөөрөх</button><button type="button" class="danger" data-structure-import-exclude="${row.row_number}">Импортоос хасах</button></div></form></details>`;
}
function structureImportPreview(job){
  const rows=(job.rows||[]).map(row=>{
    const value={...(row.normalized_data||{}),...(row.reviewed_data||{})};
    const issues=[...(row.validation?.errors||[]),...(row.validation?.warnings||[])];
    const stateClass=row.validation_state==="error"?"error":row.validation_state==="warning"?"warning":"ready";
    return `<tr class="structure-import-row-${esc(row.review_decision||"pending")}"><td>${row.row_number}</td><td><strong>${esc(value.unitName||"—")}</strong><small>${esc(value.unitCode||"")}</small></td><td>${esc(value.unitType||"—")}<small>${value.parentUnit?`Дээд: ${esc(value.parentUnit)}`:"Дээд нэгжгүй"}</small></td><td><strong>${esc(value.positionTitle||"—")}</strong><small>${esc(value.positionCode||"")} ${value.rankLevel?`· шатлал ${esc(value.rankLevel)}`:""} ${value.headcountLimit?`· ${esc(value.headcountLimit)} орон тоо`:""}</small></td><td><span class="structure-import-pill action-${esc(row.proposed_action)}">${structureImportActions[row.proposed_action]||esc(row.proposed_action)}</span></td><td><span class="smart-import-row ${stateClass}">${structureImportValidations[row.validation_state]||esc(row.validation_state)}</span><small>${esc(issues.join(" · ")||"Зөрчил илрээгүй")}</small></td><td><span class="structure-import-pill decision-${esc(row.review_decision)}">${structureImportDecisions[row.review_decision]||esc(row.review_decision)}</span><small>${row.review_reason?esc(row.review_reason):row.commit_outcome!=="not_applied"?structureImportOutcomes[row.commit_outcome]||esc(row.commit_outcome):""}</small></td><td>${job.status==="needs_review"?structureImportReviewForm(row,value):"—"}</td></tr>`;
  }).join("");
  return `<section class="admin-panel"><div class="panel-head"><div><h2>Импортын шалгалт</h2><p>Үндсэн бүтцэд оруулах мөр бүрийн өөрчлөлт, зөрчил, хүний шийдвэрийг шалгана.</p></div><span>${job.preview_limited?"Эхний 200 мөр":"Бүх мөр"}</span></div><div class="admin-table-wrap"><table class="smart-import-table structure-import-table"><thead><tr><th>Мөр</th><th>Нэгж</th><th>Төрөл, хамаарал</th><th>Орон тоо</th><th>Үйлдэл</th><th>Шалгалт</th><th>Шийдвэр</th><th>Хяналт</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}
function structureImportJobView(job){
  const summary=job.summary||{},rows=job.rows||[];
  const count=predicate=>rows.filter(predicate).length;
  const create=count(row=>row.proposed_action==="create"&&row.review_decision!=="excluded"),update=count(row=>row.proposed_action==="update"&&row.review_decision!=="excluded"),skip=count(row=>row.proposed_action==="skip"&&row.review_decision!=="excluded"),needsReview=count(row=>row.review_decision==="pending"&&(row.validation_state==="warning"||row.validation_state==="error")),excluded=count(row=>row.review_decision==="excluded");
  const blockers=count(row=>row.review_decision!=="excluded"&&row.validation_state==="error")+count(row=>row.review_decision==="pending"&&row.validation_state==="warning"&&row.proposed_action!=="skip");
  const canApprove=job.status==="needs_review"&&blockers===0,canCommit=job.status==="approved";
  const buckets=[["create","Үүсгэх",create],["update","Шинэчлэх",update],["skip","Алгасах",skip],["review","Хянах шаардлагатай",needsReview],["reject","Хассан",excluded]];
  return `<section class="smart-import-job structure-import-job"><div class="smart-import-job-head"><div><small>${esc(job.original_filename)}</small><h2>${structureImportStatuses[job.status]||esc(job.status)}</h2><p>${job.analysis_mode==="ai_assisted"?"OVERVA AI баганыг танихад тусалсан":"Стандарт дүрмээр баганыг таньсан"}. Үндсэн бүтцэд хараахан бичээгүй.</p></div><div class="smart-import-actions">${canApprove?`<button class="secondary" data-structure-import-approve="${job.id}">Хяналтыг батлах</button>`:""}${canCommit?`<button class="primary" data-structure-import-commit="${job.id}">Бүтцийг нэг transaction-аар үүсгэх</button>`:""}</div></div><div class="structure-import-buckets">${buckets.map(([type,label,value])=>`<div class="bucket-${type}"><span>${label}</span><strong>${value}</strong></div>`).join("")}</div>${blockers?`<p class="smart-import-blocker"><strong>${blockers} мөр шийдвэрлэгдээгүй байна.</strong> Алдааг засах/хасах, анхааруулгатай шинэ бүртгэлийг зөвшөөрөх шаардлагатай.</p>`:""}<div class="structure-import-stats">${[["Нийт мөр",summary.total],["Нэгж",summary.units],["Орон тоо",summary.positions],["Анхааруулга",summary.warnings],["Алдаа",summary.errors]].map(([label,value])=>`<div><span>${label}</span><strong>${Number(value||0)}</strong></div>`).join("")}</div>${(summary.aiWarnings||[]).map(warning=>`<p class="smart-import-notice">${esc(warning)}</p>`).join("")}${job.status==="needs_review"?structureImportMapping(job):""}${structureImportPreview(job)}<div class="structure-import-safety"><strong>Аюулгүй байдлын хил</strong><span>Зөвхөн нэгж, ажлын байрны сан болон батлагдсан орон тоо үүсгэнэ.</span><small>Ажилтан, нэвтрэх эрх, role/permission, модуль, шилжилт хөдөлгөөн үүсгэхгүй. Одоогийн бүтцийг засах, идэвхгүй болгох, устгахгүй.</small></div></section>`;
}
function structureSmartImportContent(){
  const value=state.structureSmartImport;if(value.items===null&&!value.loading)queueMicrotask(loadStructureImports);
  const recent=(value.items||[]).map(item=>`<button type="button" data-structure-import-open="${item.id}"><strong>${esc(item.original_filename)}</strong><span>${structureImportStatuses[item.status]||esc(item.status)} · ${dateTime(item.created_at)}</span></button>`).join("");
  return `<section class="structure-import-shell"><details ${value.job?"open":""}><summary><div><span>SMART IMPORT</span><strong>Бэлэн Excel/CSV файлаас бүтцээ хурдан үүсгэх</strong><small>AI зөвхөн багана таних санал гаргана. Та preview-г шалгаж баталсны дараа үндсэн бүтцэд орно.</small></div><b>Нээх</b></summary><div class="smart-import-layout"><div><form id="structureImportUploadForm" class="admin-form smart-import-upload"><h2>1. Бүтцийн файл</h2><p>.xlsx эсвэл .csv · 10 MB хүртэл · 5,000 мөр хүртэл</p><label>Нэгж, дээд нэгж, албан тушаалын файл<input name="file" type="file" accept=".xlsx,.csv" required></label><button class="primary" ${value.busy?"disabled":""}>Шинжилж, preview үүсгэх</button><small>Жишээ багана: Нэгжийн код, Нэгжийн нэр, Төрөл, Дээд нэгж, Албан тушаал, Шатлал, Орон тоо.</small></form><section class="admin-panel smart-import-recent"><div class="panel-head"><h2>Сүүлийн импорт</h2></div>${value.loading?"<p>Ачаалж байна...</p>":recent||"<p>Бүтцийн импортын түүх алга.</p>"}</section></div><div>${value.job?structureImportJobView(value.job):'<section class="admin-panel smart-import-empty"><h2>Хяналттай 5 алхам</h2><ol><li>Файл staging-д орно</li><li>AI/дүрэм багана танина</li><li>Код, hierarchy, давхардал, тойрог хамаарлыг шалгана</li><li>Байгууллагын үндсэн админ preview-г батална</li><li>Нэг transaction-аар бүтэц үүснэ</li></ol></section>'}</div></div></details></section>`;
}
structureSettingsContent=function(){return `${structureImportBaseContent()}${structureSmartImportContent()}`};

document.addEventListener("click",async event=>{
  const open=event.target.closest("[data-structure-import-open]");if(open){await loadStructureImportJob(open.dataset.structureImportOpen);return}
  const accept=event.target.closest("[data-structure-import-accept]");if(accept){try{const result=await api(`/api/structure-smart-imports/${state.structureSmartImport.job.id}/rows/${accept.dataset.structureImportAccept}`,{method:"PATCH",body:JSON.stringify({decision:"accepted"})});state.structureSmartImport.job=result.item;render();toast("Мөрийг зөвшөөрлөө")}catch(error){toast(error.message,true)}return}
  const exclude=event.target.closest("[data-structure-import-exclude]");if(exclude){const reason=prompt("Энэ мөрийг импортоос хасах шалтгаан:");if(reason===null)return;if(!reason.trim()){toast("Хасах шалтгаан заавал бичнэ",true);return}try{const result=await api(`/api/structure-smart-imports/${state.structureSmartImport.job.id}/rows/${exclude.dataset.structureImportExclude}`,{method:"PATCH",body:JSON.stringify({decision:"excluded",reason:reason.trim()})});state.structureSmartImport.job=result.item;render();toast("Мөрийг импортоос хаслаа")}catch(error){toast(error.message,true)}return}
  const approve=event.target.closest("[data-structure-import-approve]");if(approve){try{const result=await api(`/api/structure-smart-imports/${approve.dataset.structureImportApprove}/approve`,{method:"POST"});state.structureSmartImport.job=result.item;await loadStructureImports();toast("Бүтцийн preview-г баталлаа")}catch(error){toast(error.message,true)}return}
  const commit=event.target.closest("[data-structure-import-commit]");if(commit){if(!confirm("Баталсан нэгж, ажлын байр, орон тоог үндсэн бүтцэд үүсгэх үү?"))return;try{const result=await api(`/api/structure-smart-imports/${commit.dataset.structureImportCommit}/commit`,{method:"POST"});state.structureSmartImport.job=result.item;state.modules.structure=null;await loadModule("structure");await loadStructureImports();toast("Байгууллагын бүтэц амжилттай үүслээ")}catch(error){toast(error.message,true)}return}
});

document.addEventListener("submit",async event=>{
  if(event.target.id==="structureImportUploadForm"){
    event.preventDefault();const form=event.target,button=form.querySelector("button"),value=state.structureSmartImport;button.disabled=true;value.busy=true;button.textContent="Шинжилж байна...";
    try{const response=await fetch("/api/structure-smart-imports",{method:"POST",headers:{authorization:`Bearer ${state.token}`},body:new FormData(form)});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||"Файл шинжилж чадсангүй");value.job=body.item;value.items=null;await loadStructureImports();toast("Файлыг staging-д оруулж шалгалаа")}catch(error){toast(error.message,true)}finally{value.busy=false;button.disabled=false;button.textContent="Шинжилж, preview үүсгэх"}return;
  }
  if(event.target.id==="structureImportMappingForm"){
    event.preventDefault();const mapping={};event.target.querySelectorAll("[data-structure-import-source]").forEach(select=>{if(select.value)mapping[select.dataset.structureImportSource]=select.value});
    try{const result=await api(`/api/structure-smart-imports/${state.structureSmartImport.job.id}/mapping`,{method:"PATCH",body:JSON.stringify({mapping})});state.structureSmartImport.job=result.item;render();toast("Mapping болон бүтцийн шалгалтыг шинэчиллээ")}catch(error){toast(error.message,true)}
    return;
  }
  if(event.target.matches("[data-structure-import-row-form]")){
    event.preventDefault();const form=event.target,changes={};Object.keys(structureImportFields).forEach(field=>{changes[field]=form.elements[field].value});
    try{const result=await api(`/api/structure-smart-imports/${state.structureSmartImport.job.id}/rows/${form.dataset.structureImportRowForm}`,{method:"PATCH",body:JSON.stringify({decision:"corrected",reason:form.elements.reason.value.trim(),changes})});state.structureSmartImport.job=result.item;render();toast("Мөрийг засаж дахин шалгалаа")}catch(error){toast(error.message,true)}
  }
});
