"use strict";

state.employees=[];
state.employeeDepartments=[];
state.employeePositions=[];
state.accessSearch="";
state.accessLoginFilter="all";
state.accessRoleFilter="all";
state.selectedAccessEmployeeId=null;
state.settingsTab="organization";

const employeeAccessRefreshBefore=refresh;
refresh=async function(){
  await employeeAccessRefreshBefore();
  if(state.user?.role!=="director")return;
  const result=await api("/api/employees");
  state.employees=result.items||[];
  state.employeeDepartments=result.departments||[];
  state.employeePositions=result.positions||[];
  state.roles=result.roles||state.roles;
  render();
};

function employeeRoleOptions(selected="worker"){
  return state.roles.map(role=>`<option value="${role}" ${role===selected?"selected":""}>${esc(labels[role]||role)}</option>`).join("");
}
function employeeDepartmentOptions(){
  return '<option value="">Хэлтэс сонгохгүй</option>'+state.employeeDepartments.map(item=>`<option value="${item.id}">${esc(item.name)}</option>`).join("");
}
function employeePositionOptions(){
  return '<option value="">Албан тушаал сонгохгүй</option>'+state.employeePositions.map(item=>`<option value="${item.id}" data-department-id="${item.department_id||""}">${esc(item.title)}</option>`).join("");
}
function employeesView(){
  const rows=state.employees.map(item=>`<tr><td><strong>${esc(item.full_name)}</strong><small>${esc(item.employee_no||"Ажилтны дугааргүй")}</small></td><td>${esc(item.position_title||labels[item.role]||item.role)}<small>${esc(item.department_name||"Хэлтэс оноогоогүй")}</small></td><td>${item.can_login?'<span class="badge active">Нэвтрэх эрхтэй</span>':'<span class="badge inactive">Нэвтрэх эрхгүй</span>'}</td><td>${item.can_login?`<small>${esc(item.username)}</small>`:`<button class="secondary" data-grant-access="${item.id}">Нэвтрэх эрх өгөх</button>`}</td></tr>`).join("");
  return `${header("БАЙГУУЛЛАГЫН ХҮМҮҮС","Ажилтнууд","Энд байгууллагад ажилладаг хүмүүсээ нэг удаа бүртгэнэ. OVERVA-д ажиллах хүнд нь дараа нь нэвтрэх эрх олгоно.",'<button class="primary" data-open="employeeDialog">+ Шинэ ажилтан</button>')}<div class="table-panel">${rows?`<table class="data-table"><thead><tr><th>Ажилтан</th><th>Ажлын байр</th><th>OVERVA эрх</th><th>Үйлдэл</th></tr></thead><tbody>${rows}</tbody></table>`:empty("Ажилтан бүртгэгдээгүй","Бүтэц, албан тушаалаа үүсгээд анхны ажилтнаа нэмнэ үү.")}</div>`;
}

function accessEnabled(item){return Boolean(item.can_login&&item.account_active)}
function maskRegister(value){
  const text=String(value||"").trim();
  if(!text)return "—";
  return text.length<=4?"••••":`${text.slice(0,2)}••••${text.slice(-2)}`;
}
function accessRoleOptions(selected="worker",includeAll=false){
  return `${includeAll?'<option value="all">Бүх эрх</option>':""}${employeeRoleOptions(selected)}`;
}
function accessFilteredEmployees(){
  const query=state.accessSearch.trim().toLocaleLowerCase("mn");
  return state.employees.filter(item=>{
    const hasAccess=accessEnabled(item);
    if(state.accessLoginFilter==="enabled"&&!hasAccess)return false;
    if(state.accessLoginFilter==="disabled"&&(!item.can_login||item.account_active))return false;
    if(state.accessLoginFilter==="none"&&item.can_login)return false;
    if(state.accessRoleFilter!=="all"&&item.access_role!==state.accessRoleFilter)return false;
    if(!query)return true;
    return [item.full_name,item.employee_no,item.department_name,item.position_title,item.username,item.email,item.phone,item.register_no,item.access_role]
      .some(value=>String(value||"").toLocaleLowerCase("mn").includes(query));
  });
}
function accessAvatar(item){
  return `<span class="access-avatar">${esc(initials(item.full_name))}</span>`;
}
function accessStatus(item){
  if(!item.can_login)return '<span class="access-status no-access">Нэвтрэх эрхгүй</span>';
  if(!item.account_active)return '<span class="access-status disabled">Түр хаалттай</span>';
  return '<span class="access-status enabled">Нэвтрэх эрхтэй</span>';
}
function accessAction(item){
  if(!item.can_login)return `<button class="access-config-button" data-grant-access="${item.id}">+ Эрх олгох</button>`;
  if(item.user_id===state.user.id)return '<span class="access-own-account">Таны бүртгэл</span>';
  return `<button class="access-config-button" data-configure-access="${item.id}">⚙ Тохируулах</button>`;
}
function accessRows(){
  return accessFilteredEmployees().map(item=>{
    const roles=(item.access_role_names||[]).join(", ");
    const permissionCount=Number(item.permission_count||0);
    return `<tr>
      <td><div class="access-person">${accessAvatar(item)}<div><strong>${esc(item.full_name)}</strong>${accessStatus(item)}</div></div></td>
      <td><strong>${esc(item.department_name||"Хэлтэс оноогоогүй")}</strong><small>${esc(item.position_title||"Албан тушаал оноогоогүй")}</small></td>
      <td><a class="access-identity">${esc(item.username||"—")}</a><small>${esc(item.phone||item.email||"Холбоо барих мэдээлэлгүй")} · РД: ${esc(maskRegister(item.register_no))}</small></td>
      <td>${item.can_login?`<span class="access-role-badge">${esc(labels[item.access_role]||item.access_role||"Ажилтан")}</span><small title="${esc(roles)}">${permissionCount} үйлдлийн эрх</small>`:'<span class="access-role-empty">—</span>'}</td>
      <td>${accessAction(item)}</td>
    </tr>`;
  }).join("");
}
function accessManagementContent(){
  const activeEmployees=state.employees.filter(item=>item.active);
  const accessCount=activeEmployees.filter(accessEnabled).length;
  const noAccessCount=activeEmployees.filter(item=>!item.can_login).length;
  const elevatedCount=activeEmployees.filter(item=>accessEnabled(item)&&Number(item.permission_count||0)>0).length;
  const rows=accessRows();
  return `<div class="access-stat-grid">
      <article class="access-stat blue"><span>НИЙТ АЖИЛТАН</span><strong>${activeEmployees.length}</strong></article>
      <article class="access-stat green"><span>НЭВТРЭХ ЭРХТЭЙ</span><strong>${accessCount}</strong></article>
      <article class="access-stat orange"><span>НЭВТРЭХ ЭРХГҮЙ</span><strong>${noAccessCount}</strong></article>
      <article class="access-stat purple"><span>УДИРДАХ ЭРХТЭЙ</span><strong>${elevatedCount}</strong></article>
    </div>
    <section class="access-panel">
      <div class="access-panel-head"><div><h2>🔐 Нэвтрэх эрхийн тохиргоо</h2><p>Ажилтан болон нэвтрэх бүртгэл тусдаа байна. Нууц үгийг зөвхөн шинэчилж болох бөгөөд харах боломжгүй.</p></div><button class="primary" data-open="accessDialog">+ Ажилтанд эрх өгөх</button></div>
      <div class="access-filters">
        <label class="access-search"><span>⌕</span><input id="accessSearch" value="${esc(state.accessSearch)}" placeholder="Нэр, утас, РД, албан тушаал хайх..."></label>
        <select id="accessLoginFilter"><option value="all">Бүгд</option><option value="enabled" ${state.accessLoginFilter==="enabled"?"selected":""}>Нэвтрэх эрхтэй</option><option value="disabled" ${state.accessLoginFilter==="disabled"?"selected":""}>Түр хаалттай</option><option value="none" ${state.accessLoginFilter==="none"?"selected":""}>Нэвтрэх эрхгүй</option></select>
        <select id="accessRoleFilter">${accessRoleOptions(state.accessRoleFilter,true)}</select>
        <span class="access-result-count">${accessFilteredEmployees().length} / ${state.employees.length}</span>
      </div>
      <div class="access-table-wrap">${rows?`<table class="access-table"><thead><tr><th>АЖИЛТАН</th><th>ХЭЛТЭС / АЛБАН ТУШААЛ</th><th>НЭВТРЭХ МЭДЭЭЛЭЛ</th><th>ЭРХ / ROLE</th><th>ҮЙЛДЭЛ</th></tr></thead><tbody>${rows}</tbody></table>`:empty("Тохирох ажилтан алга","Хайлтын утга эсвэл шүүлтүүрээ өөрчилнө үү.")}</div>
    </section>`;
}
users=function(){
  return `${header("ТОХИРГОО","Нэвтрэх эрх","Ажилтан бүрийн OVERVA-д нэвтрэх бүртгэл, үндсэн системийн эрх болон төлөвийг нэг дор удирдана.")}${accessManagementContent()}`;
};

const employeeAccessRenderBefore=render;
render=function(){
  if(state.view==="employees"){$("#pageContent").innerHTML=employeesView();return;}
  employeeAccessRenderBefore();
};

const employeeAccessSetViewBefore=setView;
setView=function(view){
  if(view==="users"){
    state.settingsTab="access";
    employeeAccessSetViewBefore("settings");
    $("#breadcrumb").textContent="Тохиргоо";
    return;
  }
  employeeAccessSetViewBefore(view);
  if(view==="employees")$("#breadcrumb").textContent="Ажилтнууд";
};

const employeeAccessOpenDialogBefore=openDialog;
openDialog=function(id){
  if(id==="employeeDialog"){$("#employeeRoleSelect").innerHTML=employeeRoleOptions();$("#employeeDepartmentSelect").innerHTML=employeeDepartmentOptions();$("#employeePositionSelect").innerHTML=employeePositionOptions();}
  if(id==="accessDialog"){
    const select=$("#accessEmployeeSelect"),current=select.value;
    select.innerHTML='<option value="">Ажилтан сонгоно уу</option>'+state.employees.filter(item=>item.active&&!item.can_login).map(item=>`<option value="${item.id}">${esc(item.full_name)}${item.position_title?` — ${esc(item.position_title)}`:""}</option>`).join("");
    if(current)select.value=current;
    $("#accessRoleSelect").innerHTML=employeeRoleOptions();
  }
  employeeAccessOpenDialogBefore(id);
};

function openAccessManager(employeeId){
  const item=state.employees.find(employee=>employee.id===employeeId&&employee.can_login);
  if(!item)return;
  state.selectedAccessEmployeeId=item.id;
  $("#manageAccessUserId").value=item.user_id;
  $("#manageAccessName").textContent=item.full_name;
  $("#manageAccessContext").textContent=[item.department_name,item.position_title].filter(Boolean).join(" · ")||"Ажлын байр оноогоогүй";
  $("#manageAccessUsername").textContent=item.username||"—";
  $("#manageAccessEmail").textContent=item.email||"—";
  $("#manageAccessRole").innerHTML=employeeRoleOptions(item.access_role||"worker");
  $("#manageAccessActive").value=item.account_active?"true":"false";
  $("#manageAccessPermissionSummary").textContent=`${Number(item.permission_count||0)} үйлдлийн эрх · ${(item.access_role_names||[]).join(", ")||"Нэмэлт role байхгүй"}`;
  $("#manageAccessForm").querySelector("[data-form-error]").textContent="";
  $("#accessPasswordResetForm").reset();
  $("#accessPasswordResetForm").querySelector("[data-form-error]").textContent="";
  $("#accessManageDialog").showModal();
}

async function createEmployee(event){event.preventDefault();const form=event.currentTarget,error=form.querySelector("[data-form-error]");error.textContent="";try{await api("/api/employees",{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(form)))});form.reset();$("#employeeDialog").close();await refresh();toast("Ажилтан амжилттай бүртгэгдлээ")}catch(err){error.textContent=err.message}}
async function grantEmployeeAccess(event){event.preventDefault();const form=event.currentTarget,value=Object.fromEntries(new FormData(form)),error=form.querySelector("[data-form-error]");error.textContent="";try{const employeeId=value.employeeId;delete value.employeeId;await api(`/api/employees/${employeeId}/access`,{method:"POST",body:JSON.stringify(value)});form.reset();$("#accessDialog").close();await refresh();toast("Ажилтанд OVERVA нэвтрэх эрх олголоо")}catch(err){error.textContent=err.message}}
async function updateEmployeeAccess(event){
  event.preventDefault();
  const form=event.currentTarget,error=form.querySelector("[data-form-error]"),value=Object.fromEntries(new FormData(form));
  error.textContent="";
  try{
    await api(`/api/users/${value.userId}`,{method:"PATCH",body:JSON.stringify({role:value.role,active:value.active==="true"})});
    $("#accessManageDialog").close();await refresh();toast("Нэвтрэх эрхийн тохиргоо хадгалагдлаа");
  }catch(err){error.textContent=err.message;}
}
async function resetEmployeePassword(event){
  event.preventDefault();
  const form=event.currentTarget,error=form.querySelector("[data-form-error]"),password=new FormData(form).get("password"),employee=state.employees.find(item=>item.id===state.selectedAccessEmployeeId);
  error.textContent="";
  try{await api(`/api/users/${employee.user_id}/reset-password`,{method:"POST",body:JSON.stringify({password})});form.reset();toast("Нууц үг амжилттай шинэчлэгдлээ");}catch(err){error.textContent=err.message;}
}

function syncAccessRole(){const employee=state.employees.find(item=>item.id===$("#accessEmployeeSelect").value);if(employee)$("#accessRoleSelect").value=employee.role;}
function filterEmployeePositions(){const departmentId=$("#employeeDepartmentSelect").value;for(const option of $("#employeePositionSelect").options){option.hidden=Boolean(option.value&&departmentId&&option.dataset.departmentId!==departmentId);}if($("#employeePositionSelect").selectedOptions[0]?.hidden)$("#employeePositionSelect").value="";}

$("#employeeForm").addEventListener("submit",createEmployee);
$("#accessForm").addEventListener("submit",grantEmployeeAccess);
$("#manageAccessForm").addEventListener("submit",updateEmployeeAccess);
$("#accessPasswordResetForm").addEventListener("submit",resetEmployeePassword);
document.addEventListener("click",event=>{
  const settingsTab=event.target.closest("[data-settings-tab]");
  if(settingsTab){state.settingsTab=settingsTab.dataset.settingsTab;render();if(state.settingsTab==="audit"&&!state.audit)loadAudit();if(state.settingsTab==="structure"&&!state.modules.structure)loadModule("structure").then(render);if(state.settingsTab==="data"&&!state.modules.dataGovernance)loadDataGovernance();return;}
  const settingsTarget=event.target.closest("[data-settings-tab-target]");
  if(settingsTarget){state.settingsTab=settingsTarget.dataset.settingsTabTarget;queueMicrotask(render);if(state.settingsTab==="structure"&&!state.modules.structure)loadModule("structure").then(render);if(state.settingsTab==="audit"&&!state.audit)loadAudit();if(state.settingsTab==="data"&&!state.modules.dataGovernance)loadDataGovernance();}
  const grant=event.target.closest("[data-grant-access]");
  if(grant){openDialog("accessDialog");$("#accessEmployeeSelect").value=grant.dataset.grantAccess;syncAccessRole();return;}
  const configure=event.target.closest("[data-configure-access]");
  if(configure)openAccessManager(configure.dataset.configureAccess);
});
document.addEventListener("input",event=>{if(event.target.id==="accessSearch"){state.accessSearch=event.target.value;render();const input=$("#accessSearch");input.focus();input.setSelectionRange(input.value.length,input.value.length);}});
document.addEventListener("change",event=>{
  if(event.target.id==="accessEmployeeSelect")syncAccessRole();
  if(event.target.id==="employeeDepartmentSelect")filterEmployeePositions();
  if(event.target.id==="accessLoginFilter"){state.accessLoginFilter=event.target.value;render();}
  if(event.target.id==="accessRoleFilter"){state.accessRoleFilter=event.target.value;render();}
});
