"use strict";

// Read-only deterministic review-case analyzer. It reads the legacy SQLite DB
// with query_only enabled and writes JSON to stdout. It never contacts OVERVA.
const fs=require("node:fs");
const path=require("node:path");
const crypto=require("node:crypto");
const sqlite3=require("sqlite3");

const legacySource="choibalsan_legacy_sqlite";
const deterministicVersion="choibalsan-review-v1";
const legacyRoot=path.resolve(__dirname,"..","..");
const databasePath=path.resolve(process.env.LEGACY_DB_PATH||path.join(legacyRoot,"data","app.db"));
const db=new sqlite3.Database(databasePath,sqlite3.OPEN_READONLY);
const all=(sql,params=[])=>new Promise((resolve,reject)=>db.all(sql,params,(error,rows)=>error?reject(error):resolve(rows)));
const close=()=>new Promise((resolve,reject)=>db.close(error=>error?reject(error):resolve()));

function canonical(value){
  if(value===null||typeof value!=="object")return JSON.stringify(value);
  if(Array.isArray(value))return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}
const sha256=value=>crypto.createHash("sha256").update(Buffer.isBuffer(value)||typeof value==="string"?value:canonical(value)).digest("hex");
const text=value=>value==null?null:String(value).trim()||null;
const normalized=value=>(text(value)||"").normalize("NFKC").replace(/\s+/g," ").toLocaleLowerCase("mn-MN");
const latest=(values)=>values.filter(Boolean).sort().at(-1)||null;
function filePath(value){if(!value)return null;const clean=String(value).replace(/^[/\\]+/,"").replace(/^uploads[/\\]/i,"");return path.join(legacyRoot,"uploads",clean)}
function fileHash(value){const resolved=filePath(value);return resolved&&fs.existsSync(resolved)?sha256(fs.readFileSync(resolved)):null}
function member(table,row,options={}){
  return {
    legacySource,legacyTable:table,legacyId:String(row.id),memberRole:options.role||"MEMBER",
    recommendedClassification:options.classification||"REVIEW_REQUIRED",
    recommendationReason:options.reason||"",sourceOrder:options.order||0,sourceSummary:options.summary||{},
  };
}
function reviewGroup(category,groupKey,sourceSummary,signals,recommendation,recommendationReason,confidence,members,requiresExternalEvidence=false){
  const group={category,groupKey,deterministicVersion,sourceSummary,signals:[...new Set(signals)].sort(),recommendation,recommendationReason,confidence,
    requiresExternalEvidence,externalEvidenceStatus:requiresExternalEvidence?"MISSING":"NOT_REQUIRED",members};
  group.groupHash=sha256(group);
  return group;
}

async function main(){
  await all("PRAGMA query_only=ON");
  const [users,attendance,orders,correspondence,documents,attachments,employeeFiles]=await Promise.all([
    all("SELECT * FROM users ORDER BY id"),all("SELECT * FROM hr_records ORDER BY id"),all("SELECT * FROM orders_decisions ORDER BY id"),
    all("SELECT * FROM correspondence ORDER BY id"),all("SELECT * FROM documents ORDER BY id"),all("SELECT * FROM doc_attachments ORDER BY id"),
    all("SELECT * FROM employee_files ORDER BY id"),
  ]);
  const activeUsers=users.filter(row=>Number(row.active)===1&&row.role!=="ai_readonly");
  const inactiveUsers=users.filter(row=>Number(row.active)!==1&&row.role!=="ai_readonly");
  const activeIds=new Set(activeUsers.map(row=>row.id));
  const activeNames=new Map();
  for(const user of activeUsers){const key=normalized(user.full_name);if(key){const values=activeNames.get(key)||[];values.push(user.id);activeNames.set(key,values)}}
  const attachmentsByParent=new Map();
  for(const item of attachments){const key=`${item.entity_type}:${item.entity_id}`;const values=attachmentsByParent.get(key)||[];values.push(item);attachmentsByParent.set(key,values)}
  const orderIds=new Set(orders.map(row=>row.id)),correspondenceIds=new Set(correspondence.map(row=>row.id));
  const groups=[];

  // Attendance is grouped by its only stable reconciliation key. The latest
  // row is a candidate, never an accepted fact. Production comparison remains
  // mandatory even for a one-row group.
  const attendanceByEmployeeDate=new Map();
  for(const row of attendance){const key=`${row.user_id}|${row.start_date}`;const values=attendanceByEmployeeDate.get(key)||[];values.push(row);attendanceByEmployeeDate.set(key,values)}
  for(const [key,rows] of [...attendanceByEmployeeDate].sort(([a],[b])=>a.localeCompare(b))){
    rows.sort((a,b)=>String(a.created_at||"").localeCompare(String(b.created_at||""))||Number(a.id)-Number(b.id));
    const candidate=rows.at(-1),duplicate=rows.length>1,active=activeIds.has(candidate.user_id);
    const members=rows.map((row,index)=>member("hr_records",row,{
      role:row.id===candidate.id?"PRIMARY_CANDIDATE":"SUPERSEDED_CANDIDATE",order:index,
      reason:row.id===candidate.id?"Latest deterministic row candidate; production reconciliation is still required.":"Earlier row in the same employee/date group; superseded candidate only.",
      summary:{legacyUserId:row.user_id,date:row.start_date,recordType:text(row.record_type),status:text(row.status),workHours:row.work_hours,leaveHours:row.leave_hours,overtimeHours:row.overtime_hours,createdAt:row.created_at||null},
    }));
    groups.push(reviewGroup("ATTENDANCE",key,{legacyUserId:candidate.user_id,date:candidate.start_date,rawRowCount:rows.length,primaryCandidateLegacyId:candidate.id,activeEmployeeReference:active},[
      "PRODUCTION_RECONCILIATION_MISSING",...(duplicate?["DUPLICATE_EMPLOYEE_DATE_GROUP","SUPERSEDED_CANDIDATES_PRESENT"]:[]),...(!active?["INACTIVE_OR_SYSTEM_USER_REFERENCE"]:[]),
    ],"RECONCILE_REQUIRED","Deterministic grouping identifies a candidate but cannot establish production attendance truth.",duplicate?"MEDIUM":"LOW",members,true));
  }

  // Inactive users are review evidence only. Activity and HR references are
  // signals; they never imply termination or creation of an employee.
  for(const user of inactiveUsers){
    const hrRows=attendance.filter(row=>row.user_id===user.id);
    const createdOrders=orders.filter(row=>row.created_by===user.id),relatedOrders=orders.filter(row=>row.related_user===user.id);
    const createdLetters=correspondence.filter(row=>row.created_by===user.id),assignedLetters=correspondence.filter(row=>row.assigned_to===user.id);
    const uploadedAttachments=attachments.filter(row=>row.uploaded_by===user.id);
    const files=employeeFiles.filter(row=>row.user_id===user.id||row.uploaded_by===user.id);
    const overlap=activeNames.get(normalized(user.full_name))||[];
    const activityCount=createdOrders.length+relatedOrders.length+createdLetters.length+assignedLetters.length+uploadedAttachments.length+files.length;
    const lastActivity=latest([
      user.created_at,...hrRows.map(row=>row.created_at),...createdOrders.map(row=>row.created_at),...relatedOrders.map(row=>row.updated_at||row.created_at),
      ...createdLetters.map(row=>row.created_at),...assignedLetters.map(row=>row.response_sent_at||row.created_at),...uploadedAttachments.map(row=>row.uploaded_at),...files.map(row=>row.uploaded_at),
    ]);
    const ambiguous=overlap.length>0||hrRows.length>0||activityCount>0;
    groups.push(reviewGroup("INACTIVE_USER",String(user.id),{
      legacyUserId:user.id,fullName:text(user.full_name),username:text(user.username),department:text(user.department),position:text(user.position),
      activeEmployeeOverlapLegacyIds:overlap,legacyActivityCount:activityCount,hrEvidenceCount:hrRows.length,lastActivity,
    },["INACTIVE_LEGACY_USER",...(overlap.length?["ACTIVE_EMPLOYEE_OVERLAP"]:[]),...(hrRows.length?["HR_EVIDENCE_PRESENT"]:[]),...(activityCount?["LEGACY_ACTIVITY_PRESENT"]:[])],
    ambiguous?"MANUAL_REVIEW":"LEGACY_ONLY",ambiguous?"Inactive identity has HR, activity, or active-employee overlap evidence requiring human interpretation.":"No active overlap, HR evidence, or linked activity was found; retain as provenance only.",ambiguous?"LOW":"HIGH",
    [member("users",user,{classification:ambiguous?"REVIEW_REQUIRED":"LEGACY_ONLY",summary:{legacyUserId:user.id,fullName:text(user.full_name),username:text(user.username),active:false}})]));
  }

  // Document number is a grouping signal, not by itself a global identity.
  const ordersByNumber=new Map();
  for(const row of orders){const key=normalized(row.doc_no)||`missing:${row.id}`;const values=ordersByNumber.get(key)||[];values.push(row);ordersByNumber.set(key,values)}
  for(const [key,rows] of [...ordersByNumber].sort(([a],[b])=>a.localeCompare(b))){
    const duplicate=rows.length>1;
    const rowsWithAttachment=rows.filter(row=>(attachmentsByParent.get(`order:${row.id}`)||[]).length>0);
    const invalidLink=rows.some(row=>row.related_user!=null&&!activeIds.has(row.related_user));
    const missingNumber=rows.some(row=>!text(row.doc_no)),safe=!duplicate&&!missingNumber&&rowsWithAttachment.length===rows.length&&!invalidLink;
    groups.push(reviewGroup("ORDER_DECISION",`document-number:${key}`,{
      documentNumber:text(rows[0].doc_no),rawRowCount:rows.length,records:rows.map(row=>({legacyId:row.id,type:text(row.doc_type),date:row.doc_date||null,title:text(row.title),relatedLegacyUserId:row.related_user||null,attachmentCount:(attachmentsByParent.get(`order:${row.id}`)||[]).length})),
    },[...(duplicate?["DUPLICATE_DOCUMENT_NUMBER"]:[]),...(missingNumber?["MISSING_DOCUMENT_NUMBER"]:[]),...(rowsWithAttachment.length!==rows.length?["MISSING_ATTACHMENT"]:[]),...(invalidLink?["INACTIVE_OR_UNKNOWN_EMPLOYEE_LINK"]:[])],
    safe?"IMPORT_NEW":"MANUAL_REVIEW",safe?"Unique numbered record has an attachment and no invalid employee link; ready for review approval only.":"Number, attachment, duplicate, or employee-link evidence requires manual review.",safe?"HIGH":"LOW",
    rows.map((row,index)=>member("orders_decisions",row,{classification:safe?"IMPORT_NEW":"REVIEW_REQUIRED",order:index,summary:{documentNo:text(row.doc_no),type:text(row.doc_type),date:row.doc_date||null,relatedLegacyUserId:row.related_user||null,attachmentCount:(attachmentsByParent.get(`order:${row.id}`)||[]).length}}))));
  }

  const correspondenceByIdentity=new Map();
  for(const row of correspondence){const number=normalized(row.doc_no),key=number?`${normalized(row.source_org)}|${number}|${row.doc_date||""}`:`missing:${row.id}`;const values=correspondenceByIdentity.get(key)||[];values.push(row);correspondenceByIdentity.set(key,values)}
  for(const [key,rows] of [...correspondenceByIdentity].sort(([a],[b])=>a.localeCompare(b))){
    const duplicate=rows.length>1,missingNumber=rows.some(row=>!text(row.doc_no));
    const missingAttachment=rows.some(row=>(attachmentsByParent.get(`letter:${row.id}`)||[]).length===0);
    const invalidAssignee=rows.some(row=>row.assigned_to==null||!activeIds.has(row.assigned_to));
    const safe=!duplicate&&!missingNumber&&!missingAttachment&&!invalidAssignee;
    groups.push(reviewGroup("CORRESPONDENCE",key,{rawRowCount:rows.length,records:rows.map(row=>({legacyId:row.id,direction:text(row.doc_type),source:text(row.source_org),number:text(row.doc_no),date:row.doc_date||null,assignedLegacyUserId:row.assigned_to||null,attachmentCount:(attachmentsByParent.get(`letter:${row.id}`)||[]).length}))},[
      "NOT_CLASSIFIED_AS_COMPLAINT",...(duplicate?["DUPLICATE_CORRESPONDENCE_IDENTITY"]:[]),...(missingNumber?["MISSING_DOCUMENT_NUMBER"]:[]),...(missingAttachment?["MISSING_ATTACHMENT"]:[]),...(invalidAssignee?["MISSING_OR_INACTIVE_ASSIGNEE"]:[]),
    ],safe?"IMPORT_NEW":"MANUAL_REVIEW",safe?"Unique correspondence identity has an active assignee and attachment; ready for review approval only.":"Source, number, date, assignee, or attachment evidence requires manual review.",safe?"HIGH":"LOW",
    rows.map((row,index)=>member("correspondence",row,{classification:safe?"IMPORT_NEW":"REVIEW_REQUIRED",order:index,summary:{source:text(row.source_org),number:text(row.doc_no),date:row.doc_date||null,assignedLegacyUserId:row.assigned_to||null,attachmentCount:(attachmentsByParent.get(`letter:${row.id}`)||[]).length}}))));
  }

  // Reproduce the provenance risk boundary, then group risky file evidence.
  // Identical hashes are explicitly not treated as logical-document identity.
  const fileRows=[];
  for(const row of documents)fileRows.push({table:"documents",row,filePath:row.file_path,sha:fileHash(row.file_path),parent:null});
  for(const row of attachments)fileRows.push({table:"doc_attachments",row,filePath:row.file_url,sha:fileHash(row.file_url),parent:`${row.entity_type}:${row.entity_id}`});
  for(const row of employeeFiles)fileRows.push({table:"employee_files",row,filePath:row.file_path,sha:fileHash(row.file_path),parent:`employee:${row.user_id}`});
  const hashCounts=new Map();for(const item of fileRows)if(item.sha)hashCounts.set(item.sha,(hashCounts.get(item.sha)||0)+1);
  const parentHashCounts=new Map();for(const item of fileRows)if(item.parent&&item.sha){const key=`${item.parent}|${item.sha}`;parentHashCounts.set(key,(parentHashCounts.get(key)||0)+1)}
  const risky=fileRows.filter(item=>{
    if(item.table==="documents")return true;
    if(item.table==="doc_attachments"){
      const parentExists=item.row.entity_type==="order"?orderIds.has(item.row.entity_id):item.row.entity_type==="letter"?correspondenceIds.has(item.row.entity_id):false;
      return !parentExists||!item.sha||(item.sha&&hashCounts.get(item.sha)>1);
    }
    return !activeIds.has(item.row.user_id)||!item.sha||(item.sha&&hashCounts.get(item.sha)>1);
  });
  const riskyByKey=new Map();
  for(const item of risky){const key=item.sha&&hashCounts.get(item.sha)>1?`hash:${item.sha}`:`source:${item.table}:${item.row.id}`;const values=riskyByKey.get(key)||[];values.push(item);riskyByKey.set(key,values)}
  for(const [key,items] of [...riskyByKey].sort(([a],[b])=>a.localeCompare(b))){
    const signals=new Set();
    for(const item of items){
      if(!item.sha)signals.add("FILE_MISSING");
      if(item.sha&&hashCounts.get(item.sha)>1)signals.add("HASH_DUPLICATE");
      if(item.parent&&item.sha&&parentHashCounts.get(`${item.parent}|${item.sha}`)>1)signals.add("SAME_PARENT_DUPLICATE");
      if(item.table==="documents")signals.add("MISSING_DOCUMENT_NUMBER");
      if(item.table==="doc_attachments"){
        const exists=item.row.entity_type==="order"?orderIds.has(item.row.entity_id):item.row.entity_type==="letter"?correspondenceIds.has(item.row.entity_id):false;
        if(!exists){signals.add("ORPHAN");signals.add("MISSING_PARENT")}
      }
    }
    if(signals.has("HASH_DUPLICATE"))signals.add("HASH_IS_SIGNAL_NOT_MERGE_KEY");
    groups.push(reviewGroup("DOCUMENT_ATTACHMENT",key,{rawRowCount:items.length,contentSha256:key.startsWith("hash:")?key.slice(5):null,records:items.map(item=>({legacyTable:item.table,legacyId:item.row.id,parent:item.parent,fileName:text(item.row.file_name)||path.basename(item.filePath||"")}))},[...signals],"MANUAL_REVIEW","File hash and parent integrity are review signals only; no logical document is merged automatically.","LOW",
      items.map((item,index)=>member(item.table,item.row,{order:index,summary:{parent:item.parent,fileName:text(item.row.file_name)||path.basename(item.filePath||""),contentSha256:item.sha}}))));
  }

  const categoryCounts={},recommendationCounts={};let rawRows=0;
  for(const group of groups){
    const category=categoryCounts[group.category]||(categoryCounts[group.category]={groups:0,rawRows:0});category.groups++;category.rawRows+=group.members.length;
    const recommendation=recommendationCounts[group.recommendation]||(recommendationCounts[group.recommendation]={groups:0,rawRows:0});recommendation.groups++;recommendation.rawRows+=group.members.length;
    rawRows+=group.members.length;
  }
  const output={format:"overva-legacy-review-groups-v1",generatedAt:new Date().toISOString(),legacySource,deterministicVersion,databaseSha256:sha256(fs.readFileSync(databasePath)),summary:{rawRows,groups:groups.length,rawRowsReducedByGrouping:rawRows-groups.length,categoryCounts,recommendationCounts},groups};
  process.stdout.write(JSON.stringify(output,null,2));
}

main().then(close).catch(async error=>{console.error(error);await close().catch(()=>{});process.exitCode=1});
