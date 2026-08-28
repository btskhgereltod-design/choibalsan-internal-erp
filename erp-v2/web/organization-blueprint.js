"use strict";

state.organizationBlueprint={catalog:null,latest:null,draft:null,method:null,interview:null,pendingAnswer:null,evidenceSources:[],capabilityProposals:[],datasetDiscoveries:[],datasetDiscovery:null,loading:false,busy:false,advanced:false};
const legacyStructureSettingsContent=structureSettingsContent;
const blueprintSectorLabels={
  general:"Ерөнхий байгууллага",retail:"Дэлгүүр, худалдаа",services:"Үйлчилгээ",healthcare:"Эмнэлэг, эрүүл мэнд",
  education:"Сургууль, сургалт",construction:"Барилга",road:"Зам, дэд бүтэц",mining:"Уул уурхай",transport:"Тээвэр",
  delivery:"Хүргэлт, түгээлт",manufacturing:"Үйлдвэрлэл","food-production":"Хүнсний үйлдвэрлэл",agriculture:"Хөдөө аж ахуй",
  government:"Төрийн байгууллага","public-service":"Нийтийн үйлчилгээ",ngo:"ТББ",other:"Бусад"
};
const blueprintNeedLabels={finance:"Санхүү",accounting:"Нягтлан бодох",hr:"Хүний нөөц",attendance:"Ирц, ээлж",sales:"Борлуулалт",customers:"Харилцагч",
  service:"Үйлчилгээ",inventory:"Бараа материал",warehouse:"Агуулах",procurement:"Худалдан авалт",operations:"Өдөр тутмын ажиллагаа",
  field:"Талбайн ажил",maintenance:"Засвар үйлчилгээ",delivery:"Хүргэлт",safety:"ХАБЭА",quality:"Чанарын хяналт",compliance:"Нийцэл",
  it:"Мэдээллийн технологи",devices:"Төхөөрөмж",digital:"Цахим үйлчилгээ"};

function blueprintStructureSnapshot(){
  const data=state.modules.structure||{};
  return {
    departments:(data.departments||[]).filter(item=>item.active!==false),
    positions:(data.positions||[]).filter(item=>item.active!==false),
    people:(data.people||[]).filter(item=>item.active!==false)
  };
}
function blueprintHasExistingStructure(){
  const structure=blueprintStructureSnapshot();
  return structure.departments.length>0||structure.positions.length>0;
}
function blueprintCurrentProfile(){
  const b=state.organizationBlueprint,saved=b.draft?.profile||b.latest?.profile||{};
  if(!blueprintHasExistingStructure())return saved;
  const structure=blueprintStructureSnapshot();
  const searchable=[...structure.departments.map(item=>item.name),...structure.positions.map(item=>item.title)].filter(Boolean).join(" ").toLocaleLowerCase("mn");
  const inferred=[];
  const add=(...codes)=>codes.forEach(code=>inferred.push(code));
  if(/санхүү|нягтлан|касс|төсөв/.test(searchable))add("finance","accounting");
  if(/нярав|агуулах|бараа\s*материал/.test(searchable))add("inventory","warehouse");
  if(/хүний\s*нөөц/.test(searchable))add("hr");
  if(/аюулгүй|хабэа|эрүүл\s*ахуй/.test(searchable))add("safety","compliance");
  if(/инженер|цахилгаан|камер|сүлжээ|техник|засвар/.test(searchable))add("operations","field","maintenance");
  if(/камер|сүлжээ|төхөөрөмж/.test(searchable))add("it","devices");
  return {...saved,employeeCount:Math.max(Number(saved.employeeCount)||0,structure.people.length,1),branchCount:Number(saved.branchCount)||1,needs:[...new Set([...(saved.needs||[]),...inferred])]};
}

async function loadOrganizationBlueprint(){
  const b=state.organizationBlueprint;if(b.loading||b.catalog)return;b.loading=true;
  try{const [data,method,latestInterview,evidence,datasets]=await Promise.all([api("/api/organization-blueprints/catalog"),api("/api/organization-blueprints/method"),api("/api/organization-blueprints/interviews/latest"),api("/api/organization-blueprints/evidence"),api("/api/dataset-discoveries")]);b.catalog=data;b.latest=data.latest;b.draft=data.latest?.status==="draft"?data.latest:null;b.method=method;b.evidenceSources=evidence.sources||[];b.capabilityProposals=evidence.proposals||[];b.datasetDiscoveries=datasets.items||[];if(latestInterview.item)await refreshBlueprintInterview(latestInterview.item.id);}
  catch(error){toast(error.message,true)}finally{b.loading=false;if(state.view==="settings"&&state.settingsTab==="structure")render()}
}
async function refreshBlueprintInterview(id){const b=state.organizationBlueprint;b.interview=await api(`/api/organization-blueprints/interviews/${id}`);b.pendingAnswer=[...(b.interview.answers||[])].reverse().find(item=>item.confirmation_status==="pending")||null;}
async function refreshOrganizationEvidence(){const b=state.organizationBlueprint,result=await api("/api/organization-blueprints/evidence");b.evidenceSources=result.sources||[];b.capabilityProposals=result.proposals||[];}
const capabilityDispositionLabels={native:"OVERVA Native",integrate:"Integrate",later:"Later"};
function blueprintEvidence(){
  const b=state.organizationBlueprint,proposals=b.capabilityProposals||[],pending=proposals.filter(item=>!item.decision).length;
  return `<section class="blueprint-evidence"><div class="blueprint-section-head"><div><span>ORGANIZATION EVIDENCE</span><h2>Материалаас AS-IS ба capability map гаргах</h2><p>Эх сурвалжийн текстийг баримт болгон хадгалж, нотолгоотой санал гаргана. Хүний шийдвэргүйгээр бүтэц, модуль, master data өөрчлөгдөхгүй.</p></div><div class="blueprint-count"><b>${b.evidenceSources.length}</b> эх сурвалж · <b>${pending}</b> хүлээгдэж буй</div></div>
    <form id="blueprintEvidenceForm" class="blueprint-evidence-form"><div><label><span>Эх сурвалжийн төрөл</span><select name="sourceType"><option value="pasted_text">Материалын текст</option><option value="document_excerpt">Баримтын хэсэг</option><option value="system_inventory">Одоогийн системийн жагсаалт</option><option value="interview_note">Ярилцлагын тэмдэглэл</option></select></label><label><span>Гарчиг</span><input name="title" maxlength="240" required placeholder="Жишээ: Компанийн танилцуулга 2026"></label></div><label><span>Шинжлэх материал</span><textarea name="content" rows="6" minlength="20" maxlength="50000" required placeholder="Байгууллагын танилцуулга, хийдэг ажил, ашигладаг систем, хүндрэл, хяналтын мэдээллээ оруулна уу..."></textarea></label><button class="primary" type="submit" ${b.busy?"disabled":""}>Нотолгоо шинжилж санал гаргах</button></form>
    ${proposals.length?`<div class="capability-review-list">${proposals.map(item=>{const selected=item.selected_disposition||item.proposed_disposition,status=item.decision||"pending";return `<article class="capability-review ${esc(status)}"><div class="capability-review-head"><div><span>${esc(item.finding_kind)} · ${Math.round(Number(item.confidence)*100)}%</span><strong>${esc(item.capability_name)}</strong><small>${esc(item.source_title)}</small></div><b>${item.decision?esc(item.decision):"Хүний хяналт хүлээж байна"}</b></div><blockquote>${esc(item.evidence_excerpt)}</blockquote><p>${esc(item.rationale)}</p><div class="capability-review-actions"><select data-capability-disposition="${item.id}" ${item.decision?"disabled":""}>${Object.entries(capabilityDispositionLabels).map(([value,label])=>`<option value="${value}" ${selected===value?"selected":""}>${label}</option>`).join("")}</select>${item.decision?`<small>Шийдвэр: ${esc(capabilityDispositionLabels[selected]||selected)} · ${dateTime(item.reviewed_at)}</small>`:`<button class="primary" type="button" data-capability-review="accept" data-proposal-id="${item.id}">Батлах</button><button class="ghost" type="button" data-capability-review="reject" data-proposal-id="${item.id}">Татгалзах</button>`}</div></article>`}).join("")}</div>`:`<div class="blueprint-evidence-empty">Материал оруулсны дараа нотолгоотой capability саналууд энд гарна.</div>`}
  </section>`;
}
const datasetRoleLabels={source:"Эх өгөгдөл",master:"Master / лавлах",derived:"Боловсруулсан үр дүн",report:"Тайлан / KPI",instruction:"Тайлбар / заавар",unknown:"Тодорхойгүй"};
const datasetReadinessLabels={ready:"Commit contract бэлэн",partial_native:"Native суурь хэсэгчлэн бэлэн",contract_missing:"Target contract дутуу",analysis_only:"Зөвхөн шинжилгээ"};
async function refreshDatasetDiscoveries(){const result=await api("/api/dataset-discoveries");state.organizationBlueprint.datasetDiscoveries=result.items||[];}
async function loadDatasetDiscovery(id){const result=await api(`/api/dataset-discoveries/${id}`);state.organizationBlueprint.datasetDiscovery=result.item;render();}
function blueprintDatasetDiscovery(){
  const b=state.organizationBlueprint,job=b.datasetDiscovery,summary=job?.summary||{};
  const recent=(b.datasetDiscoveries||[]).map(item=>`<button type="button" data-dataset-open="${item.id}"><strong>${esc(item.original_filename)}</strong><span>${item.summary?.sheetCount||0} sheet · ${dateTime(item.created_at)}</span></button>`).join("");
  const sheetCards=(job?.sheets||[]).map(sheet=>{const role=sheet.selected_role||sheet.proposed_role,issues=sheet.findings||[];return `<article class="dataset-sheet-card ${esc(sheet.decision||"pending")}"><div><span>Sheet ${sheet.sheet_index} · ${sheet.row_count} мөр · ${sheet.column_count} багана</span><strong>${esc(sheet.sheet_name)}</strong><small>${issues.length} quality finding${sheet.truncated?" · profile хязгаарлагдсан":""}</small></div><div class="dataset-sheet-review"><select data-dataset-role="${sheet.id}" ${sheet.decision?"disabled":""}>${Object.entries(datasetRoleLabels).map(([value,label])=>`<option value="${value}" ${role===value?"selected":""}>${label}</option>`).join("")}</select>${sheet.decision?`<small>${esc(sheet.decision)} · ${esc(datasetRoleLabels[role]||role)}</small>`:`<button type="button" class="primary" data-dataset-review="accept" data-job-id="${job.id}" data-sheet-id="${sheet.id}">Батлах</button><button type="button" class="ghost" data-dataset-review="exclude" data-job-id="${job.id}" data-sheet-id="${sheet.id}">Хасах</button>`}</div>${issues.length?`<ul>${issues.slice(0,5).map(issue=>`<li class="${esc(issue.severity)}"><b>${esc(issue.column||issue.code)}</b> — ${esc(issue.message)} (${issue.count})</li>`).join("")}${issues.length>5?`<li>+${issues.length-5} бусад finding</li>`:""}</ul>`:"<p>Profile түвшинд зөрчил илрээгүй.</p>"}</article>`}).join("");
  const targets=(job?.targets||[]).map(target=>`<article class="dataset-target ${esc(target.readiness)}"><div><strong>${esc(target.domain_name)}</strong><span>${esc(datasetReadinessLabels[target.readiness]||target.readiness)}</span></div><p>${esc(target.rationale)}</p><small>${(target.source_sheets||[]).map(esc).join(" · ")}</small></article>`).join("");
  return `<section class="blueprint-dataset"><div class="blueprint-section-head"><div><span>SMART IMPORT · DATASET DISCOVERY</span><h2>Танихгүй workbook-ийг эхлээд ойлгох</h2><p>Sheet, column, төрөл, хоосон утга, duplicate key болон target-domain readiness-ийг шинжилнэ. Raw cell value хадгалахгүй; canonical contract байхгүй бол commit хийхгүй.</p></div>${job?`<div class="blueprint-count"><b>${summary.sheetCount||0}</b> sheet · <b>${summary.findings||0}</b> finding</div>`:""}</div><div class="dataset-layout"><div><form id="datasetDiscoveryUploadForm" class="blueprint-evidence-form"><label><span>Олон sheet-тэй Excel workbook</span><input name="file" type="file" accept=".xlsx" required></label><button class="primary" ${b.busy?"disabled":""}>Workbook шинжлэх</button><small>10 MB хүртэл. Файл үндсэн санд шууд орохгүй.</small></form><div class="dataset-recent"><strong>Сүүлийн discovery</strong>${recent||"<p>Discovery түүх алга.</p>"}</div></div><div>${job?`<div class="dataset-stop"><strong>Canonical commit хаалттай</strong><span>${summary.blockingTargets||0} target contract дутуу. Sheet review нь operational/master data үүсгэхгүй.</span></div><div class="dataset-targets">${targets}</div><div class="dataset-sheets">${sheetCards}</div>`:`<div class="blueprint-evidence-empty">Workbook оруулсны дараа source/master/derived/report/instruction ангилал болон target contract энд харагдана.</div>`}</div></div></section>`;
}
function blueprintInterview(){
  const b=state.organizationBlueprint,method=b.method,editing=blueprintHasExistingStructure();
  if(!method)return "";
  if(!method.canStart&&!b.interview)return `<section class="blueprint-ai"><div class="blueprint-ai-head"><div><span>OVERVA AI · REQUIREMENTS</span><h2>Зөв аргачлалаар байгууллагаа тодорхойлно</h2><p>AI нь таамгаар бүтэц үүсгэхгүй. Platform admin баталсан аргачлалаар асууж, ойлгосноо танд батлуулсны дараа санал болгоно.</p></div><b class="blueprint-method-status draft">Аргачлал v${method.item.version} · баталгаажуулалт хүлээж байна</b></div></section>`;
  if(!b.interview)return `<section class="blueprint-ai"><div class="blueprint-ai-head"><div><span>OVERVA AI · REQUIREMENTS</span><h2>${editing?"Яриагаар бүтцийн өөрчлөлт, нэмэлтээ тодруулах":"Яриагаар байгууллагынхаа загварыг тодорхойлох"}</h2><p>${esc(method.item.description||"")} Нэг хариулт бүрийг AI бүтэцчилж харуулна; зөвхөн таны баталсан утга дараагийн шатанд ашиглагдана.</p></div><b class="blueprint-method-status active">Батлагдсан v${method.item.version}</b></div><button class="primary" type="button" data-blueprint-interview-start>AI ярилцлага эхлүүлэх</button></section>`;
  const interview=b.interview,next=interview.nextQuestion,pending=b.pendingAnswer,confirmed=(interview.answers||[]).filter(item=>["confirmed","corrected"].includes(item.confirmation_status)).length,total=(interview.questions||[]).filter(item=>item.required).length;
  const normalized=pending?.normalized_answer||{};
  return `<section class="blueprint-ai"><div class="blueprint-ai-head"><div><span>OVERVA AI · ${esc(interview.item.current_stage||"DISCOVERY")}</span><h2>Байгууллагын шаардлага тодруулах ярилцлага</h2><p>${confirmed}/${total} үндсэн хариултыг хүн баталгаажуулсан. Tenant-ийн бодит мэдээллийг нийтлэг мэдлэгийн санд автоматаар оруулахгүй.</p></div><b class="blueprint-method-status active">${esc(interview.item.status)}</b></div>
    ${pending?`<div class="blueprint-confirm"><span>AI таны хариултыг ингэж ойлголоо</span><strong>${esc(normalized.understood||normalized.message||pending.answer_text)}</strong>${(normalized.facts||[]).length?`<ul>${normalized.facts.map(item=>`<li>${esc(item)}</li>`).join("")}</ul>`:""}<small>Итгэлцүүр: ${Math.round(Number(pending.confidence||0)*100)}%. Батлах хүртэл энэ нь зөвлөмж бөгөөд master data биш.</small><label>Засах шаардлагатай бол энд бичнэ үү<textarea data-blueprint-correction rows="3">${esc(pending.answer_text)}</textarea></label><div><button class="primary" type="button" data-blueprint-answer-confirm>Зөв, батлах</button><button class="ghost" type="button" data-blueprint-answer-correct>Засаад батлах</button></div></div>`:
    next?`<form id="blueprintInterviewForm" class="blueprint-question"><span>Дараагийн асуулт</span><h3>${esc(next.prompt_mn)}</h3><input type="hidden" name="questionCode" value="${esc(next.code)}"><textarea name="answerText" rows="4" maxlength="12000" required placeholder="Өөрийн байгууллагын бодит байдлаар хариулна уу"></textarea><button class="primary" type="submit">AI-д ойлгуулах</button></form>`:
    `<div class="blueprint-interview-ready"><strong>Ярилцлагын үндсэн асуултууд баталгаажлаа.</strong><span>Одоо дээрх хариултуудад тулгуурлан доорх бүтэцчилсэн маягтыг шалгаж, загварын саналаа үүсгэнэ.</span></div>`}
  </section>`;
}
function blueprintProfileForm(){
  const b=state.organizationBlueprint,profile=blueprintCurrentProfile(),editing=blueprintHasExistingStructure();
  return `<form class="blueprint-profile" id="blueprintProfileForm">
    <div class="blueprint-section-head"><div><span>1-р алхам</span><h2>${editing?"Бүтцийн хэрэгцээг шинэчлэх":"Байгууллагаа тодорхойлох"}</h2><p>${editing?"Одоогийн мэдээллээ шалгаад шинээр нэмэгдсэн чиглэл, хийдэг ажил, хэмжээний өөрчлөлтөө оруулна.":"Нэг салбарын нэрээр хязгаарлахгүй. Үндсэн чиглэл болон бодитоор хийдэг ажлуудаа сонгоно."}</p></div></div>
    <div class="blueprint-form-grid">
      <label><span>Байгууллагын хэлбэр</span><select name="organizationType" required>
        ${[["company","Компани, аж ахуйн нэгж"],["government","Төрийн байгууллага"],["ngo","ТББ"],["cooperative","Хоршоо, нөхөрлөл"],["individual","Хувиараа эрхлэгч"],["other","Бусад"]].map(([v,l])=>`<option value="${v}" ${profile.organizationType===v?"selected":""}>${l}</option>`).join("")}
      </select></label>
      <label><span>Үндсэн салбар, чиглэл</span><select name="sector" required>${Object.entries(blueprintSectorLabels).map(([v,l])=>`<option value="${v}" ${profile.sector===v?"selected":""}>${l}</option>`).join("")}</select></label>
      <label><span>Нийт ажилтны тоо</span><input name="employeeCount" type="number" min="1" max="1000000" value="${profile.employeeCount||1}" required></label>
      <label><span>Салбар, байршлын тоо</span><input name="branchCount" type="number" min="1" max="10000" value="${profile.branchCount||1}" required></label>
    </div>
    <label class="blueprint-shift"><input type="checkbox" name="hasShifts" ${profile.hasShifts?"checked":""}> Ээлжийн зохион байгуулалттай</label>
    <fieldset><legend>Танай байгууллагад бодитоор хийгддэг ажлууд</legend>${editing?"<small>Одоогийн батлагдсан нэгж, албан тушаалаас таньсан хэрэгцээг урьдчилан тэмдэглэв. Та шалгаж, шинээр нэмэгдсэнийг сонгоно уу.</small>":""}<div class="blueprint-needs">${Object.entries(blueprintNeedLabels).map(([v,l])=>`<label><input type="checkbox" name="needs" value="${v}" ${(profile.needs||[]).includes(v)?"checked":""}><span>${l}</span></label>`).join("")}</div></fieldset>
    <label><span>Үндсэн үйл ажиллагаагаа өөрийн үгээр бичнэ үү</span><textarea name="activities" rows="3" maxlength="3000" placeholder="Жишээ: захиалга авч бараа хүргэдэг, 2 салбар дэлгүүртэй, агуулахын үлдэгдэл хөтөлнө...">${esc(profile.activities||"")}</textarea></label>
    <button class="primary" type="submit" ${b.busy?"disabled":""}>${b.busy?"Төлөвлөж байна...":editing?"Нэмэлт бүтцийн санал гаргах":"Тохирох бүтцийг санал болгох"}</button>
  </form>`;
}
function blueprintProposal(){
  const b=state.organizationBlueprint,draft=b.draft;if(!draft)return "";const proposal=draft.proposal||{},templates=proposal.templates||[],editing=blueprintHasExistingStructure();
  return `<section class="blueprint-proposal"><div class="blueprint-section-head"><div><span>2-р алхам</span><h2>${editing?"OVERVA-ийн өөрчлөлт, нэмэлтийн санал":"OVERVA-ийн санал болгосон бүтэц"}</h2><p>Сонголт бүрийг шалгаж, хэрэггүйг нь хасаж болно. Бүтэц үүсгэх хүртэл өгөгдөлд өөрчлөлт орохгүй.</p></div><div class="blueprint-count"><b>${proposal.departmentCount||0}</b> нэгж · <b>${proposal.positionCount||0}</b> албан тушаал</div></div>
    <form id="blueprintApplyForm"><div class="blueprint-template-grid">${templates.map(item=>`<label class="blueprint-template"><input type="checkbox" name="catalogCodes" value="${esc(item.code)}" checked><div><span>${esc(item.category)}</span><strong>${esc(item.name)}</strong><small>${esc(item.description)}</small><ul>${(item.departments||[]).map(department=>`<li><b>${esc(department.name)}</b> — ${(department.positions||[]).map(position=>esc(position.title)).join(", ")}</li>`).join("")}</ul></div></label>`).join("")}</div>
      <div class="blueprint-module-note"><strong>Дараагийн шатанд санал болгох ажлын талбарууд</strong><span>${(proposal.moduleCodes||[]).map(code=>`<i>${esc(code)}</i>`).join("")||"Нэмэлт ажлын талбар шаардлагагүй."}</span><small>Энэ алхам модулийг автоматаар асаахгүй. Эхлээд байгууллагын бүтэц батлагдана.</small></div>
      <div class="blueprint-apply"><div><span>3-р алхам</span><strong>${editing?"Сонгосон өөрчлөлт, нэмэлтийг батлах":"Сонгосон бүтцийг байгууллагадаа үүсгэх"}</strong><small>Одоо байгаа ижил кодтой нэгж, албан тушаалыг давхардуулахгүй.</small></div><button class="primary" type="submit" ${b.busy?"disabled":""}>${editing?"Нэмэлтийг баталж хэрэгжүүлэх":"Бүтцийг баталж үүсгэх"}</button></div>
    </form></section>`;
}
function blueprintCurrentStructure(){
  const data=state.modules.structure;
  if(!data)return `<section class="blueprint-current"><div class="blueprint-current-head"><div><span>Одоогийн бүтэц</span><h2>Батлагдсан бүтцийг ачаалж байна...</h2></div></div></section>`;
  const departments=(data.departments||[]).filter(item=>item.active!==false);
  const positions=(data.positions||[]).filter(item=>item.active!==false);
  const people=(data.people||[]).filter(item=>item.active!==false);
  const typeNames=new Map((data.unitTypes||[]).map(item=>[item.code,item.name]));
  const departmentNames=new Map(departments.map(item=>[item.id,item.name]));
  const positionsByDepartment=new Map(),staffedByPosition=new Map();
  for(const position of positions){const items=positionsByDepartment.get(position.department_id)||[];items.push(position);positionsByDepartment.set(position.department_id,items)}
  for(const person of people){if(person.position_id)staffedByPosition.set(person.position_id,(staffedByPosition.get(person.position_id)||0)+1)}
  const assigned=people.filter(person=>person.department_id||person.position_id).length,unassigned=people.length-assigned;
  if(!departments.length)return `<section class="blueprint-current"><div class="blueprint-current-head"><div><span>Одоогийн бүтэц</span><h2>Батлагдсан нэгж хараахан алга</h2><p>Мэдээллээ бөглөж саналаа батлах эсвэл нарийвчилсан тохиргоогоор нэгж үүсгэнэ үү.</p></div></div></section>`;
  const cards=departments.map(department=>{const items=(positionsByDepartment.get(department.id)||[]).sort((a,b)=>a.title.localeCompare(b.title,"mn")),staffed=items.reduce((sum,item)=>sum+(staffedByPosition.get(item.id)||0),0);return `<details class="blueprint-unit" ${departments.length<=12?"open":""}><summary><div><span>${esc(typeNames.get(department.unit_type_code)||department.unit_type_code||"Нэгж")}</span><strong>${esc(department.name)}</strong>${department.parent_id?`<small>Дээд нэгж: ${esc(departmentNames.get(department.parent_id)||"—")}</small>`:""}</div><b>${items.length} ажлын байр · ${staffed} ажилтан</b></summary><div class="blueprint-positions">${items.map(position=>{const count=staffedByPosition.get(position.id)||0;return `<div><span>${esc(position.title)}</span><small>${count} ажилтан${position.headcount_limit!=null?` · орон тоо ${count}/${position.headcount_limit}`:""}</small></div>`}).join("")||"<p>Ажлын байр бүртгээгүй байна.</p>"}</div></details>`}).join("");
  return `<section class="blueprint-current"><div class="blueprint-current-head"><div><span>Одоогийн батлагдсан бүтэц</span><h2>Нэгж, ажлын байр, ажилтны бодит зураг</h2><p>OVERVA-д бүртгэлтэй master data-г энд нэгтгэн харуулна. Энэ нь санал болгож буй загвар биш, одоо ашиглагдаж байгаа бүтэц юм.</p></div><div class="blueprint-current-stats"><b>${departments.length}<small>нэгж</small></b><b>${positions.length}<small>ажлын байр</small></b><b>${assigned}<small>хуваарилагдсан</small></b>${unassigned?`<b class="warning">${unassigned}<small>хуваарилаагүй</small></b>`:""}</div></div><div class="blueprint-unit-grid">${cards}</div></section>`;
}
function blueprintApplied(){
  const latest=state.organizationBlueprint.latest;if(!latest||latest.status!=="applied")return "";
  return `<div class="blueprint-applied"><span>✓</span><div><strong>Удирдамжтай бүтэц хэрэгжсэн</strong><small>${dateTime(latest.applied_at)} · Та доорх нарийвчилсан хэсгээс нэгж, албан тушаалаа засаж үргэлжлүүлж болно.</small></div></div>`;
}
structureSettingsContent=function(){
  const b=state.organizationBlueprint;if(!b.catalog&&!b.loading)queueMicrotask(loadOrganizationBlueprint);
  const editing=blueprintHasExistingStructure();
  const loading=!b.catalog?`<section class="module-card"><strong>Байгууллагын загварын санг ачаалж байна...</strong><small>OVERVA тохирох бүтэц, албан тушаалын саналыг бэлтгэнэ.</small></section>`:"";
  const advanced=b.advanced?legacyStructureSettingsContent():"";
  return `<div class="blueprint-intro"><span>БАЙГУУЛЛАГЫН ЗАГВАРЧЛАЛ</span><h2>${editing?"Байгууллагын бүтцээ шинэчилж, нэмэлт оруулна уу":"Байгууллагынхаа ажиллах загварыг эхлээд тодорхойлъё"}</h2><p>${editing?"Одоогийн батлагдсан бүтцийг хадгална. Шинэ хэрэгцээ, ажлын чиглэл, нэгж, албан тушаалыг баталгаатай сангаас санал болгон нэмнэ.":"OVERVA таны салбарын нэрийг цэс болгон хуулбарлахгүй. Хийдэг ажил, хэмжээ, зохион байгуулалтад тань тулгуурлан баталгаатай сангаас бүтэц санал болгоно."}</p></div>${loading}${blueprintCurrentStructure()}${b.catalog?blueprintEvidence()+blueprintDatasetDiscovery()+blueprintInterview()+blueprintApplied()+blueprintProfileForm()+blueprintProposal():""}<button type="button" class="blueprint-advanced-toggle" data-blueprint-advanced>${b.advanced?"Нарийвчилсан тохиргоог хаах":"Нарийвчилсан гараар тохируулах"}</button>${advanced}`;
};

document.addEventListener("submit",async event=>{
  if(event.target.id==="datasetDiscoveryUploadForm"){
    event.preventDefault();const b=state.organizationBlueprint,button=event.target.querySelector("button");b.busy=true;button.disabled=true;button.textContent="Шинжилж байна...";try{const response=await fetch("/api/dataset-discoveries",{method:"POST",headers:{authorization:`Bearer ${state.token}`},body:new FormData(event.target)}),body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||"Workbook шинжилж чадсангүй");b.datasetDiscovery=body.item;await refreshDatasetDiscoveries();toast("Workbook profile болон target readiness бэлэн боллоо")}catch(error){toast(error.message,true)}finally{b.busy=false;render()}return;
  }
  if(event.target.id==="blueprintEvidenceForm"){
    event.preventDefault();const b=state.organizationBlueprint,data=new FormData(event.target),payload={sourceType:data.get("sourceType"),title:data.get("title"),content:data.get("content")};b.busy=true;render();try{const result=await api("/api/organization-blueprints/evidence",{method:"POST",body:JSON.stringify(payload)});await refreshOrganizationEvidence();toast(`${result.proposalCount} capability санал нотолгоотой үүслээ`)}catch(error){toast(error.message,true)}finally{b.busy=false;render()}return;
  }
  if(event.target.id==="blueprintInterviewForm"){
    event.preventDefault();const b=state.organizationBlueprint,data=new FormData(event.target);b.busy=true;render();try{const result=await api(`/api/organization-blueprints/interviews/${b.interview.item.id}/answers`,{method:"POST",body:JSON.stringify({questionCode:data.get("questionCode"),answerText:data.get("answerText")})});b.pendingAnswer=result.item;await refreshBlueprintInterview(b.interview.item.id)}catch(error){toast(error.message,true)}finally{b.busy=false;render()}return;
  }
  if(event.target.id==="blueprintProfileForm"){
    event.preventDefault();const form=event.target,data=new FormData(form),b=state.organizationBlueprint;
    const payload={organizationType:data.get("organizationType"),sector:data.get("sector"),employeeCount:Number(data.get("employeeCount")),branchCount:Number(data.get("branchCount")),hasShifts:data.has("hasShifts"),needs:data.getAll("needs"),activities:data.get("activities")||""};
    b.busy=true;render();try{const result=await api("/api/organization-blueprints/preview",{method:"POST",body:JSON.stringify(payload)});b.draft=result.item;b.latest=result.item;toast(blueprintHasExistingStructure()?"Бүтцийн өөрчлөлт, нэмэлтийн санал бэлэн боллоо":"Тохирох бүтцийн санал бэлэн боллоо")}catch(error){toast(error.message,true)}finally{b.busy=false;render()}return;
  }
  if(event.target.id==="blueprintApplyForm"){
    event.preventDefault();const b=state.organizationBlueprint,catalogCodes=new FormData(event.target).getAll("catalogCodes");if(!catalogCodes.length)return toast("Дор хаяж нэг бүтцийн загвар сонгоно уу",true);
    b.busy=true;render();try{const result=await api(`/api/organization-blueprints/${b.draft.id}/apply`,{method:"POST",body:JSON.stringify({catalogCodes})});b.latest=result.item;b.draft=null;state.modules.structure=null;await loadModule("structure");toast(`${result.summary.departmentsCreated} нэгж, ${result.summary.positionsCreated} албан тушаал шинээр үүслээ`)}catch(error){toast(error.message,true)}finally{b.busy=false;render()}
  }
});
document.addEventListener("click",async event=>{const b=state.organizationBlueprint;
  const datasetOpen=event.target.closest("[data-dataset-open]");if(datasetOpen){await loadDatasetDiscovery(datasetOpen.dataset.datasetOpen);return}
  const datasetReview=event.target.closest("[data-dataset-review]");if(datasetReview){const sheetId=datasetReview.dataset.sheetId,exclude=datasetReview.dataset.datasetReview==="exclude",selected=document.querySelector(`[data-dataset-role="${sheetId}"]`)?.value;try{const result=await api(`/api/dataset-discoveries/${datasetReview.dataset.jobId}/sheets/${sheetId}/reviews`,{method:"POST",body:JSON.stringify({decision:exclude?"excluded":"accepted",selectedRole:exclude?null:selected,note:""})});b.datasetDiscovery=result.item;render();toast(exclude?"Sheet discovery-оос хасагдлаа":"Sheet-ийн үүргийг баталлаа")}catch(error){toast(error.message,true)}return}
  const review=event.target.closest("[data-capability-review]");if(review){const id=review.dataset.proposalId,reject=review.dataset.capabilityReview==="reject",selected=document.querySelector(`[data-capability-disposition="${id}"]`)?.value;b.busy=true;render();try{await api(`/api/organization-blueprints/capability-proposals/${id}/reviews`,{method:"POST",body:JSON.stringify({decision:reject?"rejected":"accepted",selectedDisposition:reject?null:selected,note:""})});await refreshOrganizationEvidence();toast(reject?"Capability санал татгалзагдлаа":"Capability шийдвэр хадгалагдлаа")}catch(error){toast(error.message,true)}finally{b.busy=false;render()}return}
  if(event.target.closest("[data-blueprint-advanced]")){b.advanced=!b.advanced;render();return}
  if(event.target.closest("[data-blueprint-interview-start]")){b.busy=true;render();try{const result=await api("/api/organization-blueprints/interviews",{method:"POST",body:"{}"});await refreshBlueprintInterview(result.item.id)}catch(error){toast(error.message,true)}finally{b.busy=false;render()}return}
  const confirm=event.target.closest("[data-blueprint-answer-confirm]"),correct=event.target.closest("[data-blueprint-answer-correct]");if(confirm||correct){const pending=b.pendingAnswer;if(!pending)return;const correction=document.querySelector("[data-blueprint-correction]")?.value||pending.answer_text;b.busy=true;render();try{await api(`/api/organization-blueprints/interviews/${b.interview.item.id}/answers/${pending.id}/confirm`,{method:"POST",body:JSON.stringify({answerText:correct?correction:pending.answer_text,corrected:Boolean(correct)})});await refreshBlueprintInterview(b.interview.item.id)}catch(error){toast(error.message,true)}finally{b.busy=false;render()}}
});
