(function(){
  const baseStructureSettingsContent=structureSettingsContent;

  function uniqueCount(rows,key,fallback){
    return new Set(rows.map(row=>row[key]||row[fallback]).filter(Boolean)).size;
  }

  function duplicateValues(rows,key){
    const counts=new Map();
    rows.forEach(row=>{const value=String(row[key]||"").trim().toLowerCase();if(value)counts.set(value,(counts.get(value)||0)+1)});
    return [...counts.entries()].filter(([,count])=>count>1).map(([value])=>value);
  }

  function managerCycleCount(people){
    const managers=new Map(people.map(person=>[String(person.id),person.manager_user_id?String(person.manager_user_id):null]));
    const cycles=new Set();
    people.forEach(person=>{
      const path=[];const seen=new Map();let current=String(person.id);
      while(current&&managers.has(current)){
        if(seen.has(current)){
          const cycle=path.slice(seen.get(current)).sort().join(":");
          if(cycle)cycles.add(cycle);
          break;
        }
        seen.set(current,path.length);path.push(current);current=managers.get(current);
      }
    });
    return cycles.size;
  }

  function structureSnapshot(){
    const data=state.modules&&state.modules.structure||{};
    const units=Array.isArray(data.departments)?data.departments:[];
    const positions=Array.isArray(data.positions)?data.positions:[];
    const people=(Array.isArray(data.people)?data.people:[]).filter(person=>person.active!==false);
    const assignedPeople=people.filter(person=>person.position_id);
    const assignedByPosition=new Map();
    assignedPeople.forEach(person=>assignedByPosition.set(String(person.position_id),(assignedByPosition.get(String(person.position_id))||0)+1));
    const approvedSeats=positions.reduce((sum,position)=>sum+Math.max(1,Number(position.headcount_limit)||1),0);
    const vacantSeats=positions.reduce((sum,position)=>sum+Math.max(0,Math.max(1,Number(position.headcount_limit)||1)-(assignedByPosition.get(String(position.id))||0)),0);
    const overCapacity=positions.filter(position=>(assignedByPosition.get(String(position.id))||0)>Math.max(1,Number(position.headcount_limit)||1)).length;
    const warnings=[];
    const duplicateUnitCodes=duplicateValues(units,"code");
    const duplicatePositionCodes=duplicateValues(positions,"code");
    const unitsWithoutPosition=units.filter(unit=>!positions.some(position=>String(position.department_id||"")===String(unit.id))).length;
    const incompletePositions=positions.filter(position=>!position.department_id||!(position.job_id||position.job_name)).length;
    const unassignedPeople=people.filter(person=>!person.position_id||!person.department_id).length;
    const managerCycles=managerCycleCount(people);
    if(duplicateUnitCodes.length)warnings.push(`${duplicateUnitCodes.length} нэгжийн код давхардсан`);
    if(duplicatePositionCodes.length)warnings.push(`${duplicatePositionCodes.length} орон тооны код давхардсан`);
    if(incompletePositions)warnings.push(`${incompletePositions} орон тооны холбоос дутуу`);
    if(unassignedPeople)warnings.push(`${unassignedPeople} ажилтны томилгоо дутуу`);
    if(overCapacity)warnings.push(`${overCapacity} орон тоо батлагдсан хязгаараас хэтэрсэн`);
    if(managerCycles)warnings.push(`${managerCycles} тойрог тайлагнал илэрсэн`);
    return {
      units,positions,people,assignedPeople,approvedSeats,vacantSeats,unitsWithoutPosition,
      jobs:uniqueCount(positions,"job_id","job_name"),
      reporting:people.filter(person=>person.manager_user_id).length,
      warnings
    };
  }

  function stageCard(number,title,description,value,caption,tone,target){
    return `<button type="button" class="structure-hub-stage ${tone}" data-structure-hub-target="${target}">
      <span class="structure-hub-stage-number">${number}</span>
      <span class="structure-hub-stage-copy"><strong>${title}</strong><small>${description}</small></span>
      <span class="structure-hub-stage-value"><b>${value}</b><small>${caption}</small></span>
    </button>`;
  }

  function structureHubContent(){
    const snapshot=structureSnapshot();
    const warningCount=snapshot.warnings.length;
    return `<section class="structure-hub" aria-labelledby="structureHubTitle">
      <div class="structure-hub-head">
        <div><span>OVERVA · БҮТЦИЙН ТОХИРГОО</span><h2 id="structureHubTitle">Байгууллагын бүтцийг 6 алхмаар удирдах</h2><p>Нэгжээс ажилтны томилгоо хүртэлх бодит төлөвийг нэг дор шалгаж, дараагийн хийх ажлаа сонгоно.</p></div>
        <div class="structure-hub-health ${warningCount?'caution':'ready'}"><b>${warningCount||'✓'}</b><span>${warningCount?'анхааруулга':'бүтэц хэвийн'}</span></div>
      </div>
      <div class="structure-hub-stages">
        ${stageCard(1,"Байгууллагын нэгж","Салбар, газар, хэлтэс, тасаг, баг",snapshot.units.length,"идэвхтэй нэгж",snapshot.units.length?'ready':'caution',"departmentForm")}
        ${stageCard(2,"Ажлын тодорхойлолт","Мэргэжлийн ажлын нэр ба суурь үүрэг",snapshot.jobs,"тодорхойлолт",snapshot.jobs?'ready':'caution',"positionForm")}
        ${stageCard(3,"Орон тоо","Нэгж доторх батлагдсан ажлын байр",snapshot.positions.length,`${snapshot.approvedSeats} батлагдсан суудал`,snapshot.positions.length?'ready':'caution',"positionForm")}
        ${stageCard(4,"Тайлагнах хамаарал","Хэн хэндээ шууд тайлагнах шугам",snapshot.reporting,"удирдлагын холбоос",snapshot.people.length&&!snapshot.reporting?'caution':'ready',"structurePeopleTable")}
        ${stageCard(5,"Ажилтны томилгоо","Employee master-ийг орон тоонд оноох",snapshot.assignedPeople.length,`${snapshot.vacantSeats} сул орон тоо`,snapshot.assignedPeople.length===snapshot.people.length?'ready':'caution',"structurePeopleTable")}
        ${stageCard(6,"Шалгалт ба баталгаажуулалт","Давхардал, холбоос, багтаамж, тойрог хамаарал",warningCount,warningCount?'шийдвэрлэх асуудал':'алдаа илрээгүй',warningCount?'caution':'ready',"structureValidation")}
      </div>
      <div id="structureValidation" class="structure-hub-validation ${warningCount?'has-warnings':'is-ready'}">
        <div><strong>${warningCount?'Батлахаас өмнө шалгах зүйл байна':'Одоогийн бүтэц автомат шалгалтыг давлаа'}</strong><small>${warningCount?snapshot.warnings.map(esc).join(' · '):'Код, холбоос, орон тоо, томилгоо болон тайлагнах хамаарлын суурь шалгалт хэвийн.'}</small></div>
        <button type="button" class="secondary" data-structure-hub-target="structureImportUploadForm">Smart Import нээх</button>
      </div>
      ${snapshot.unitsWithoutPosition?`<p class="structure-hub-note">${snapshot.unitsWithoutPosition} нэгжид орон тоо хараахан үүсээгүй байна. Энэ нь алдаа биш; ашиглагдахгүй нэгж байж болно.</p>`:""}
    </section>`;
  }

  structureSettingsContent=function(){
    const content=baseStructureSettingsContent();
    return `${structureHubContent()}<section class="structure-hub-existing"><div class="structure-hub-existing-title"><span>ДЭЛГЭРЭНГҮЙ ТОХИРГОО</span><strong>Одоогийн бүтэц болон Smart Import</strong></div>${content.replace('<div class="module-table-wrap">','<div id="structurePeopleTable" class="module-table-wrap">')}</section>`;
  };

  document.addEventListener("click",event=>{
    const control=event.target.closest("[data-structure-hub-target]");
    if(!control)return;
    const target=document.getElementById(control.dataset.structureHubTarget)||document.querySelector(`.${control.dataset.structureHubTarget}`);
    if(!target)return;
    if(target.tagName==="FORM"){
      const details=target.closest("details");if(details)details.open=true;
    }
    target.scrollIntoView({behavior:"smooth",block:"start"});
    target.classList.remove("structure-hub-focus");void target.offsetWidth;target.classList.add("structure-hub-focus");
  });
})();
