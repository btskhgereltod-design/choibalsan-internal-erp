"use strict";

// Read-only evidence extractor. It writes JSON to stdout only; it never opens
// the legacy database for write and never calls the OVERVA API/database.
const fs=require("node:fs");
const path=require("node:path");
const crypto=require("node:crypto");
const sqlite3=require("sqlite3");

const source="choibalsan_legacy_sqlite";
const legacyRoot=path.resolve(__dirname,"..","..");
const databasePath=path.resolve(process.env.LEGACY_DB_PATH||path.join(legacyRoot,"data","app.db"));
const db=new sqlite3.Database(databasePath,sqlite3.OPEN_READONLY);
const all=(sql,params=[])=>new Promise((resolve,reject)=>db.all(sql,params,(error,rows)=>error?reject(error):resolve(rows)));
const close=()=>new Promise((resolve,reject)=>db.close(error=>error?reject(error):resolve()));

function canonical(value){if(value===null||typeof value!=="object")return JSON.stringify(value);if(Array.isArray(value))return `[${value.map(canonical).join(",")}]`;return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`}
const hash=value=>crypto.createHash("sha256").update(Buffer.isBuffer(value)||typeof value==="string"?value:canonical(value)).digest("hex");
function filePath(value){if(!value)return null;const clean=String(value).replace(/^[/\\]+/,"").replace(/^uploads[/\\]/i,"");return path.join(legacyRoot,"uploads",clean)}
function fileHash(value){const resolved=filePath(value);return resolved&&fs.existsSync(resolved)?hash(fs.readFileSync(resolved)):null}
function safeName(value){return value==null?null:String(value).trim()||null}
function evidence(table,id,row,options={}){
  const summary=options.summary||row,fileSha=options.fileSha||hash(row),classification=options.classification||"REVIEW_REQUIRED";
  return {
    legacySource:source,legacyTable:table,legacyId:String(id),legacyStatus:options.legacyStatus??safeName(row.status),
    sourceSha256:fileSha,payloadHash:hash({table,id,row,fileSha}),sourceSummary:summary,
    suggestedClassification:classification,classification,duplicateSignals:options.signals||[],
    conflictReason:options.conflictReason||"",matchReason:options.matchReason||"",matchLookup:options.matchLookup||null,
    matchCandidateLookup:options.matchCandidateLookup||null,
  };
}

async function main(){
  await all("PRAGMA query_only=ON");
  const [users,attendance,orders,correspondence,documents,attachments,employeeFiles]=await Promise.all([
    all("SELECT * FROM users ORDER BY id"),all("SELECT * FROM hr_records ORDER BY id"),all("SELECT * FROM orders_decisions ORDER BY id"),
    all("SELECT * FROM correspondence ORDER BY id"),all("SELECT * FROM documents ORDER BY id"),all("SELECT * FROM doc_attachments ORDER BY id"),all("SELECT * FROM employee_files ORDER BY id")]);
  const activeUsers=users.filter(u=>Number(u.active)===1&&u.role!=="ai_readonly"),activeIds=new Set(activeUsers.map(u=>u.id));
  const activeNames=new Map();for(const user of activeUsers){const key=safeName(user.full_name)?.toLocaleLowerCase("mn-MN");if(key){const list=activeNames.get(key)||[];list.push(user.id);activeNames.set(key,list)}}
  const orderIds=new Set(orders.map(x=>x.id)),letterIds=new Set(correspondence.map(x=>x.id));
  const attendanceGroups=new Map();for(const row of attendance){const key=`${row.user_id}|${row.start_date}`;attendanceGroups.set(key,(attendanceGroups.get(key)||0)+1)}
  const orderNumbers=new Map();for(const row of orders){const key=safeName(row.doc_no)?.toLocaleLowerCase("mn-MN");if(key)orderNumbers.set(key,(orderNumbers.get(key)||0)+1)}
  const fileEntities=[];
  for(const row of documents)fileEntities.push({kind:"documents",id:row.id,path:row.file_path,sha:fileHash(row.file_path)});
  for(const row of attachments)fileEntities.push({kind:"doc_attachments",id:row.id,path:row.file_url,sha:fileHash(row.file_url)});
  for(const row of employeeFiles)fileEntities.push({kind:"employee_files",id:row.id,path:row.file_path,sha:fileHash(row.file_path)});
  const hashCounts=new Map();for(const file of fileEntities)if(file.sha)hashCounts.set(file.sha,(hashCounts.get(file.sha)||0)+1);
  const fileByKey=new Map(fileEntities.map(file=>[`${file.kind}:${file.id}`,file]));
  const records=[];

  for(const user of users){
    const safe={fullName:safeName(user.full_name),username:safeName(user.username),role:safeName(user.role),department:safeName(user.department),position:safeName(user.position),active:Boolean(user.active),hireDate:user.hire_date||null,statusHr:safeName(user.status_hr)};
    if(user.role==="ai_readonly")records.push(evidence("users",user.id,safe,{classification:"LEGACY_ONLY",summary:safe,legacyStatus:"system_account",conflictReason:"System-only legacy identity; not employee master data."}));
    else if(Number(user.active)===1)records.push(evidence("users",user.id,safe,{classification:"MATCH_EXISTING",summary:safe,matchLookup:{type:"employee",legacyUserId:user.id},matchReason:"Existing employee profile carries this legacy user identifier."}));
    else{
      const candidates=activeNames.get((safe.fullName||"").toLocaleLowerCase("mn-MN"))||[],signals=["INACTIVE_LEGACY_USER",...(candidates.length?["ACTIVE_NAME_OVERLAP"]:[])];
      records.push(evidence("users",user.id,safe,{classification:"REVIEW_REQUIRED",summary:safe,signals,conflictReason:candidates.length?"Inactive legacy user has an active employee with the same display name; name alone is not a merge key.":"Inactive legacy user requires a human disposition.",matchCandidateLookup:candidates.length===1?{type:"employee",legacyUserId:candidates[0]}:null}));
    }
  }

  const distinct=(field)=>[...new Set(activeUsers.map(x=>safeName(x[field])).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"mn"));
  for(const name of distinct("department")){
    const members=activeUsers.filter(x=>safeName(x.department)===name).map(x=>x.id);
    records.push(evidence("derived_departments",hash(name).slice(0,24),{name,memberLegacyUserIds:members},{classification:"MATCH_EXISTING",summary:{name,activeMemberCount:members.length},matchLookup:{type:"department",name,memberLegacyUserIds:members},matchReason:"Unique current unit is corroborated by employees matched through legacy IDs; not by name alone."}));
  }
  for(const name of distinct("position")){
    const members=activeUsers.filter(x=>safeName(x.position)===name).map(x=>x.id);
    for(const [table,type] of [["derived_jobs","job"],["derived_positions","position"]])records.push(evidence(table,hash(name).slice(0,24),{name,memberLegacyUserIds:members},{classification:"MATCH_EXISTING",summary:{name,activeMemberCount:members.length},matchLookup:{type,name,memberLegacyUserIds:members},matchReason:"Unique current master is corroborated by employee legacy-ID relationships; not by name alone."}));
  }
  for(const user of activeUsers)records.push(evidence("derived_assignments",user.id,{legacyUserId:user.id,department:safeName(user.department),position:safeName(user.position)},{classification:"MATCH_EXISTING",summary:{employeeName:safeName(user.full_name),department:safeName(user.department),position:safeName(user.position)},matchLookup:{type:"employee_assignment",legacyUserId:user.id},matchReason:"Current active primary assignment belongs to the employee matched by legacy ID."}));

  for(const row of attendance){const duplicate=attendanceGroups.get(`${row.user_id}|${row.start_date}`)>1,active=activeIds.has(row.user_id),signals=["ATTENDANCE_IMPORT_BLOCKED",...(duplicate?["DUPLICATE_EMPLOYEE_DATE_GROUP"]:[]),...(!active?["INACTIVE_OR_SYSTEM_USER_REFERENCE"]:[])];records.push(evidence("hr_records",row.id,row,{classification:"REVIEW_REQUIRED",summary:{legacyUserId:row.user_id,date:row.start_date,recordType:row.record_type,status:row.status,workHours:row.work_hours,leaveHours:row.leave_hours,overtimeHours:row.overtime_hours},signals,conflictReason:"Attendance stays provenance-only until production reconciliation comparison is approved.",matchCandidateLookup:active?{type:"employee",legacyUserId:row.user_id}:null}))}
  for(const row of orders){const key=safeName(row.doc_no)?.toLocaleLowerCase("mn-MN"),signals=["FINAL_IMPORT_BLOCKED",...(!key?["MISSING_DOCUMENT_NUMBER"]:[]),...(key&&orderNumbers.get(key)>1?["DUPLICATE_DOCUMENT_NUMBER"]:[]),...(!attachments.some(a=>a.entity_type==="order"&&a.entity_id===row.id)?["MISSING_ATTACHMENT"]:[])];records.push(evidence("orders_decisions",row.id,row,{classification:"REVIEW_REQUIRED",summary:{documentNo:safeName(row.doc_no),title:safeName(row.title),documentType:safeName(row.doc_type),documentDate:row.doc_date||null,status:safeName(row.status),relatedLegacyUserId:row.related_user||null},signals,conflictReason:"Order/decision requires document-number and attachment review before canonical document import."}))}
  for(const row of correspondence){const signals=["FINAL_IMPORT_BLOCKED",...(!safeName(row.doc_no)?["MISSING_DOCUMENT_NUMBER"]:[]),...(!attachments.some(a=>a.entity_type==="letter"&&a.entity_id===row.id)?["MISSING_ATTACHMENT"]:[]),...(safeName(row.ai_summary)||safeName(row.response_draft)?["AI_DERIVED_TEXT_PRESENT"]:[])];records.push(evidence("correspondence",row.id,row,{classification:"REVIEW_REQUIRED",summary:{direction:safeName(row.doc_type),documentNo:safeName(row.doc_no),documentDate:row.doc_date||null,sourceOrganization:safeName(row.source_org),subject:safeName(row.subject),assignedLegacyUserId:row.assigned_to||null,status:safeName(row.status)},signals,conflictReason:"Correspondence is staged for identity and duplicate review only; its legacy status is not workflow history."}))}
  for(const row of documents){const file=fileByKey.get(`documents:${row.id}`),signals=["FINAL_IMPORT_BLOCKED","MISSING_DOCUMENT_NUMBER",...(!file?.sha?["FILE_MISSING"]:[]),...(file?.sha&&hashCounts.get(file.sha)>1?["DUPLICATE_FILE_HASH"]:[])];records.push(evidence("documents",row.id,row,{classification:"REVIEW_REQUIRED",summary:{documentType:safeName(row.doc_type),title:safeName(row.title),validFrom:row.valid_from||null,status:safeName(row.status),fileName:path.basename(row.file_path||"")},fileSha:file?.sha||hash(row),signals,conflictReason:"Legacy document has no durable document number and requires canonical-document review."}))}
  for(const row of attachments){const file=fileByKey.get(`doc_attachments:${row.id}`),parentExists=row.entity_type==="order"?orderIds.has(row.entity_id):row.entity_type==="letter"?letterIds.has(row.entity_id):false,duplicate=Boolean(file?.sha&&hashCounts.get(file.sha)>1),signals=[...(!parentExists?["ORPHAN_ATTACHMENT"]:[]),...(!file?.sha?["FILE_MISSING"]:[]),...(duplicate?["DUPLICATE_FILE_HASH"]:[])];const classification=signals.length?"REVIEW_REQUIRED":"IMPORT_NEW";records.push(evidence("doc_attachments",row.id,row,{classification,summary:{entityType:safeName(row.entity_type),legacyEntityId:row.entity_id,fileName:safeName(row.file_name),uploadedAt:row.uploaded_at||null},fileSha:file?.sha||hash(row),signals,conflictReason:signals.length?"Attachment identity or content conflict requires human review.":"File is eligible for a later canonical-document import; no import occurs in this phase."}))}
  for(const row of employeeFiles){const file=fileByKey.get(`employee_files:${row.id}`),signals=[...(!activeIds.has(row.user_id)?["INACTIVE_OR_SYSTEM_USER_REFERENCE"]:[]),...(!file?.sha?["FILE_MISSING"]:[]),...(file?.sha&&hashCounts.get(file.sha)>1?["DUPLICATE_FILE_HASH"]:[])];records.push(evidence("employee_files",row.id,row,{classification:signals.length?"REVIEW_REQUIRED":"IMPORT_NEW",summary:{legacyUserId:row.user_id,fileType:safeName(row.file_type),fileName:safeName(row.file_name),uploadedAt:row.uploaded_at||null},fileSha:file?.sha||hash(row),signals,conflictReason:signals.length?"Employee file requires human review.":"File is eligible for later canonical-document linking; no import occurs now.",matchCandidateLookup:activeIds.has(row.user_id)?{type:"employee",legacyUserId:row.user_id}:null}))}

  const counts={};for(const record of records)counts[record.classification]=(counts[record.classification]||0)+1;
  process.stdout.write(JSON.stringify({format:"overva-legacy-provenance-v1",generatedAt:new Date().toISOString(),source,databaseSha256:hash(fs.readFileSync(databasePath)),records,counts},null,2));
}

main().then(close).catch(async error=>{console.error(error);await close().catch(()=>{});process.exitCode=1});
