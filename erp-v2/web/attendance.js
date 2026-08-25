"use strict";

labels.attendance="Ирцийн бүртгэл";
state.attendance={year:new Date().getFullYear(),month:new Date().getMonth()+1,data:null};
const attendanceRenderBefore=render;
render=function(){if(state.view!=="attendance")return attendanceRenderBefore();renderAttendance()};
const attendanceAdjustBefore=adjustModuleNavigation;
adjustModuleNavigation=function(){attendanceAdjustBefore();if(state.user)$("#attendanceNav")?.classList.remove("hidden")};

const attendanceLabels={worked:"Ажилласан",absent:"Ажил тасалсан",leave:"Чөлөө",sick:"Өвчтэй",vacation:"Ээлжийн амралт",late:"Хоцорсон",remote:"Зайнаас ажилласан",holiday:"Бүх нийтийн амралт"};
const attendanceCodes={worked:"А",absent:"Т",leave:"Ч",sick:"Ө",vacation:"Э",late:"Х",remote:"З",holiday:"Б"};
const pad2=value=>String(value).padStart(2,"0");
const attendanceYmd=value=>String(value||"").slice(0,10);
const attendanceNumber=value=>{const number=Number(value||0);return Number.isInteger(number)?String(number):number.toFixed(1)};

async function loadAttendance(){
  try{
    const a=state.attendance;
    a.data=await api(`/api/attendance?year=${a.year}&month=${a.month}`);
    render();
  }catch(error){toast(error.message,true)}
}

function attendanceMonthTitle(){return `${state.attendance.year} оны ${state.attendance.month}-р сар`}
function attendanceMoveMonth(direction){
  let {year,month}=state.attendance;month+=direction;
  if(month<1){month=12;year--}if(month>12){month=1;year++}
  state.attendance={year,month,data:null};render();
}

function attendanceSummary(records){
  return records.reduce((sum,record)=>{
    sum[record.status]=(sum[record.status]||0)+1;
    const leaveHours=Number(record.leave_hours||0);
    sum.work+=Number(record.work_hours||0);sum.leaveHours+=leaveHours;sum.overtime+=Number(record.overtime_hours||0);
    if(record.status==="absent")sum.absentHours+=leaveHours;else sum.otherLeaveHours+=leaveHours;
    return sum;
  },{worked:0,absent:0,leave:0,sick:0,vacation:0,late:0,remote:0,holiday:0,work:0,leaveHours:0,absentHours:0,otherLeaveHours:0,overtime:0});
}

function attendanceEditor(data){
  if(!data.canEdit)return "";
  const today=new Date().toISOString().slice(0,10);
  return `<section class="attendance-editor"><div class="attendance-editor-head"><div><h2>Ирц бүртгэх</h2><p>Ажилтан ба өдрийг сонгоход өмнөх бүртгэл автоматаар нээгдэнэ.</p></div><button class="secondary" type="button" id="attendanceMarkAll">Өнөөдөр бүгд ажилласан</button></div>
    <form id="attendanceForm"><div class="attendance-form-grid">
      <label><span>Ажилтан</span><select name="userId" required><option value="">Сонгоно уу</option>${data.employees.map(item=>`<option value="${item.id}">${esc(item.full_name)} — ${esc(item.position_title||labels[item.role]||item.role)}</option>`).join("")}</select></label>
      <label><span>Огноо</span><input name="attendanceDate" type="date" value="${today}" required></label>
      <label><span>Төлөв</span><select name="status">${Object.entries(attendanceLabels).map(([key,value])=>`<option value="${key}">${value}</option>`).join("")}</select></label>
      <label><span>Ажилласан цаг</span><input name="workHours" type="number" min="0" max="8" step="0.5" value="8"></label>
      <label><span>Чөлөө/тасалсан цаг</span><input name="leaveHours" type="number" min="0" max="8" step="0.5" value="0"></label>
      <label><span>Илүү цаг</span><input name="overtimeHours" type="number" min="0" max="16" step="0.5" value="0"></label>
      <label><span>Ирсэн цаг</span><input name="checkIn" type="time"></label>
      <label><span>Гарсан цаг</span><input name="checkOut" type="time"></label>
      <label><span>Хоцорсон минут</span><input name="lateMinutes" type="number" min="0" max="1440" value="0"></label>
    </div><label class="attendance-note"><span>Тайлбар</span><input name="note" maxlength="1000" placeholder="Шаардлагатай тайлбар"></label>
    <div class="attendance-form-actions"><button class="primary">Хадгалах</button><button class="secondary hidden" type="button" id="attendanceDelete">Бүртгэл устгах</button></div><div class="form-error" data-attendance-error></div></form>
  </section>`;
}

function attendanceMatrix(data){
  const days=new Date(data.year,data.month,0).getDate(),records=new Map(data.records.map(item=>[`${item.user_id}|${Number(attendanceYmd(item.attendance_date).slice(8,10))}`,item]));
  const rows=data.employees.map(employee=>{
    const employeeRecords=data.records.filter(item=>item.user_id===employee.id),summary=attendanceSummary(employeeRecords);
    const cells=Array.from({length:days},(_,index)=>{const day=index+1,record=records.get(`${employee.id}|${day}`),weekday=new Date(data.year,data.month-1,day).getDay(),weekend=weekday===0||weekday===6,code=record?attendanceCodes[record.status]:"";
      const title=record?`${attendanceLabels[record.status]} · ${attendanceNumber(record.work_hours)}ц ажил · ${attendanceNumber(record.leave_hours)}ц чөлөө · ${attendanceNumber(record.overtime_hours)}ц илүү${record.note?` · ${record.note}`:""}`:"Бүртгэлгүй";
      return `<td class="attendance-day ${weekend?"weekend":""} ${record?`has-record status-${record.status}`:""}" ${data.canEdit?`data-attendance-cell data-user-id="${employee.id}" data-day="${day}"`:""} title="${esc(title)}">${code?`<span>${code}${Number(record.overtime_hours)>0?`+${attendanceNumber(record.overtime_hours)}`:""}</span>`:""}</td>`}).join("");
    return `<tr><td class="attendance-person"><strong>${esc(employee.full_name)}</strong><small>${esc(employee.position_title||labels[employee.role]||employee.role)} · ${esc(employee.department_name||"—")}</small></td>${cells}<td class="attendance-total">${attendanceNumber(summary.work)}</td><td class="attendance-total absent">${attendanceNumber(summary.absentHours)}</td><td class="attendance-total leave">${attendanceNumber(summary.otherLeaveHours)}</td><td class="attendance-total overtime">${attendanceNumber(summary.overtime)}</td></tr>`;
  }).join("");
  return `<section class="attendance-panel"><div class="attendance-legend">${Object.entries(attendanceLabels).map(([key,value])=>`<span><i class="status-${key}">${attendanceCodes[key]}</i>${value}</span>`).join("")}<span><b>+2</b> Илүү цаг</span></div><div class="attendance-table-wrap"><table class="attendance-table"><thead><tr><th class="attendance-person">Ажилтан</th>${Array.from({length:days},(_,i)=>{const weekday=new Date(data.year,data.month-1,i+1).getDay();return `<th class="${weekday===0||weekday===6?"weekend":""}">${i+1}</th>`}).join("")}<th>А цаг</th><th>Т цаг</th><th>Ч цаг</th><th>ИЦ</th></tr></thead><tbody>${rows||`<tr><td colspan="${days+5}">Ажилтан олдсонгүй.</td></tr>`}</tbody></table></div></section>`;
}

function renderAttendance(){
  const data=state.attendance.data;
  if(!data){$("#pageContent").innerHTML=header("ХҮНИЙ НӨӨЦ","Ирц / цагийн бүртгэл","Сарын мэдээллийг ачаалж байна...");queueMicrotask(loadAttendance);return}
  const today=new Date().toISOString().slice(0,10),todayRecords=data.records.filter(item=>attendanceYmd(item.attendance_date)===today),todaySummary=attendanceSummary(todayRecords),monthSummary=attendanceSummary(data.records);
  const toolbar=`<div class="attendance-toolbar"><button class="secondary" data-attendance-month="-1">‹</button><strong>${attendanceMonthTitle()}</strong><button class="secondary" data-attendance-month="1">›</button><button class="secondary" id="attendanceExport">CSV татах</button></div>`;
  $("#pageContent").innerHTML=`${header("ХҮНИЙ НӨӨЦ","Ирц / цагийн бүртгэл","Өдөр тутмын ирц, цагийн задаргаа, хоцролт болон сарын тайлан.",toolbar)}
    <div class="attendance-cards"><article><span>Өнөөдөр бүртгэсэн</span><strong>${todayRecords.length} / ${data.employees.length}</strong></article><article><span>Өнөөдөр ажилласан</span><strong>${todaySummary.worked+todaySummary.late+todaySummary.remote}</strong></article><article><span>Тасалсан</span><strong>${todaySummary.absent}</strong></article><article><span>Чөлөө / өвчтэй / амралт</span><strong>${todaySummary.leave+todaySummary.sick+todaySummary.vacation}</strong></article><article><span>Сарын илүү цаг</span><strong>${attendanceNumber(monthSummary.overtime)} цаг</strong></article></div>
    ${attendanceEditor(data)}${attendanceMatrix(data)}`;
}

function attendanceFillForm(userId,day){
  const form=$("#attendanceForm");if(!form)return;
  const ymd=`${state.attendance.year}-${pad2(state.attendance.month)}-${pad2(day)}`,record=state.attendance.data.records.find(item=>item.user_id===userId&&attendanceYmd(item.attendance_date)===ymd);
  form.elements.userId.value=userId;form.elements.attendanceDate.value=ymd;form.elements.status.value=record?.status||"worked";form.elements.workHours.value=record?.work_hours??8;form.elements.leaveHours.value=record?.leave_hours??0;form.elements.overtimeHours.value=record?.overtime_hours??0;form.elements.checkIn.value=record?.check_in?.slice(0,5)||"";form.elements.checkOut.value=record?.check_out?.slice(0,5)||"";form.elements.lateMinutes.value=record?.late_minutes??0;form.elements.note.value=record?.note||"";
  $("#attendanceDelete")?.classList.toggle("hidden",!record);form.scrollIntoView({behavior:"smooth",block:"start"});
}

function attendanceStatusDefaults(form){
  const status=form.elements.status.value;
  if(["absent","leave","sick","vacation","holiday"].includes(status)){form.elements.workHours.value=0;form.elements.leaveHours.value=status==="holiday"?0:8}
  if(["worked","late","remote"].includes(status)){form.elements.workHours.value=8;form.elements.leaveHours.value=0}
  if(status!=="late")form.elements.lateMinutes.value=0;
}

async function attendanceSave(form){
  const value=Object.fromEntries(new FormData(form)),error=form.querySelector("[data-attendance-error]");error.textContent="";
  try{await api(`/api/attendance/${value.userId}/${value.attendanceDate}`,{method:"PUT",body:JSON.stringify({status:value.status,workHours:value.workHours,leaveHours:value.leaveHours,overtimeHours:value.overtimeHours,checkIn:value.checkIn||null,checkOut:value.checkOut||null,lateMinutes:value.lateMinutes,note:value.note})});state.attendance.data=null;await loadAttendance();toast("Ирц хадгалагдлаа")}catch(reason){error.textContent=reason.message}
}

document.addEventListener("submit",event=>{if(event.target.id!=="attendanceForm")return;event.preventDefault();attendanceSave(event.target)});
document.addEventListener("change",event=>{if(event.target.matches("#attendanceForm [name=status]"))attendanceStatusDefaults(event.target.form)});
document.addEventListener("click",async event=>{
  const move=event.target.closest("[data-attendance-month]"),cell=event.target.closest("[data-attendance-cell]");
  if(move)attendanceMoveMonth(Number(move.dataset.attendanceMonth));
  if(cell)attendanceFillForm(cell.dataset.userId,Number(cell.dataset.day));
  if(event.target.closest("#attendanceMarkAll")){try{const today=new Date().toISOString().slice(0,10),result=await api("/api/attendance/mark-all-worked",{method:"POST",body:JSON.stringify({date:today,workHours:8})});state.attendance.data=null;await loadAttendance();toast(`${result.created} ажилтны ирц нэмэгдлээ`)}catch(error){toast(error.message,true)}}
  if(event.target.closest("#attendanceDelete")){const form=$("#attendanceForm");if(!form?.elements.userId.value)return;try{await api(`/api/attendance/${form.elements.userId.value}/${form.elements.attendanceDate.value}`,{method:"DELETE"});state.attendance.data=null;await loadAttendance();toast("Ирцийн бүртгэл устлаа")}catch(error){toast(error.message,true)}}
  if(event.target.closest("#attendanceExport")){try{const a=state.attendance,response=await fetch(`/api/attendance/export.csv?year=${a.year}&month=${a.month}`,{headers:{authorization:`Bearer ${state.token}`}});if(!response.ok)throw new Error("CSV тайлан татаж чадсангүй");const url=URL.createObjectURL(await response.blob()),link=document.createElement("a");link.href=url;link.download=`attendance-${a.year}-${pad2(a.month)}.csv`;link.click();URL.revokeObjectURL(url)}catch(error){toast(error.message,true)}}
});
