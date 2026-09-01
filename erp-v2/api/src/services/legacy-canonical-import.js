"use strict";

const fs=require("node:fs");
const path=require("node:path");
const crypto=require("node:crypto");
const {withTenantTransaction}=require("../db");
const {writeAudit}=require("./audit");
const {canonicalJson,sha256Structured,sha256Bytes,assertUuid,cleanText,LegacyProvenanceError}=require("./legacy-provenance");
const {deterministicUuid}=require("./legacy-review-groups");

const SAFE_CATEGORIES=new Set(["ORDER_DECISION","CORRESPONDENCE"]);
const SOURCE_TABLES={ORDER_DECISION:"orders_decisions",CORRESPONDENCE:"correspondence"};

function requirePermission(req,permission){
  if(!new Set(req.user?.permissions||[]).has(permission))throw new LegacyProvenanceError("LEGACY_IMPORT_PERMISSION_REQUIRED",403);
}
function safeFileName(value){return path.basename(String(value||"legacy-file")).slice(0,255)||"legacy-file"}
function mimeType(name){const ext=path.extname(name).toLowerCase();return ({".pdf":"application/pdf",".jpg":"image/jpeg",".jpeg":"image/jpeg",".png":"image/png",".webp":"image/webp",".txt":"text/plain",".docx":"application/vnd.openxmlformats-officedocument.wordprocessingml.document",".xlsx":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"})[ext]||"application/octet-stream"}
function direction(value){
  const normalized=String(value||"").trim().toLocaleLowerCase("mn-MN");
  if(["ирсэн","incoming","in"].includes(normalized))return "incoming";
  if(["явсан","outgoing","out"].includes(normalized))return "outgoing";
  if(["дотоод","internal"].includes(normalized))return "internal";
  return null;
}
function fileContentSha256(bytes){return sha256Bytes(bytes)}
function sourceEvidence(table,row,fileSha=null){
  const id=row.id,sourceSha256=fileSha||sha256Structured(row);
  return {sourceSha256,payloadHash:sha256Structured({table,id,row,fileSha:sourceSha256})};
}
function emptyReport(databaseSha256){return {mode:"DRY_RUN",noWrites:true,create:{documents:0,documentVersions:0,correspondence:0},reused:{documents:0,documentVersions:0,correspondence:0},skipped:[],conflicts:[],sourceTargetMappings:[],documentCount:0,attachmentCount:0,checksumVerification:{databaseSha256,sourceRowsVerified:0,filesVerified:0,failures:[]}}}
function addConflict(report,group,code,detail){report.conflicts.push({groupId:group.id,category:group.category,code,detail:String(detail||"")})}

async function approvedSafeGroups(client,organizationId){
  return (await client.query(`SELECT g.*,jsonb_agg(jsonb_build_object('provenanceId',p.id,'legacySource',p.legacy_source,'legacyTable',p.legacy_table,
      'legacyId',p.legacy_id,'legacyStatus',p.legacy_status,'sourceSha256',btrim(p.source_sha256),'payloadHash',btrim(p.payload_hash),
      'classification',p.classification,'reviewStatus',p.review_status,'importedAt',p.imported_at,'version',p.version) ORDER BY m.source_order,m.id) members
    FROM legacy_review_groups g
    JOIN legacy_review_group_members m ON m.organization_id=g.organization_id AND m.group_id=g.id
    JOIN legacy_provenance_records p ON p.organization_id=m.organization_id AND p.id=m.provenance_id
    WHERE g.organization_id=$1 AND g.category IN('ORDER_DECISION','CORRESPONDENCE') AND g.recommendation='IMPORT_NEW'
      AND g.confidence='HIGH' AND NOT g.requires_external_evidence AND g.external_evidence_status='NOT_REQUIRED'
    GROUP BY g.id ORDER BY g.category,g.group_key`,[organizationId])).rows;
}

async function resolveLegacyPerson(client,org,legacyUserId,{userRequired=false}={}){
  const result=await client.query(`SELECT ep.employee_id,u.id user_id
    FROM employee_profiles ep LEFT JOIN users u ON u.organization_id=ep.organization_id AND u.employee_id=ep.employee_id AND u.active=true
    WHERE ep.organization_id=$1 AND ep.legacy_user_id=$2`,[org,legacyUserId]);
  if(result.rowCount!==1||!result.rows[0].employee_id||userRequired&&!result.rows[0].user_id)return null;
  return result.rows[0];
}

async function buildImportPlanInTransaction({client,req,source}){
  const org=req.user.organization_id,report=emptyReport(await source.databaseSha256()),groups=await approvedSafeGroups(client,org),plans=[];
  for(const group of groups){
    if(group.review_status!=="APPROVED"){
      report.skipped.push({groupId:group.id,category:group.category,reason:"REVIEWER_APPROVAL_REQUIRED",version:Number(group.version)});continue;
    }
    if(!SAFE_CATEGORIES.has(group.category)||group.members.length!==1){addConflict(report,group,"UNSAFE_GROUP_SHAPE","Expected one source record");continue}
    const provenance=group.members[0],expectedTable=SOURCE_TABLES[group.category];
    if(provenance.legacyTable!==expectedTable||provenance.classification!=="IMPORT_NEW"||provenance.reviewStatus!=="APPROVED"){
      addConflict(report,group,"PROVENANCE_NOT_APPROVED",`${provenance.legacyTable}/${provenance.legacyId}`);continue;
    }
    const existingMappings=(await client.query("SELECT * FROM legacy_canonical_import_mappings WHERE organization_id=$1 AND provenance_id=$2 ORDER BY target_role",[org,provenance.provenanceId])).rows;
    if(existingMappings.length){
      if(existingMappings.some(item=>item.source_sha256.trim()!==provenance.sourceSha256||item.payload_hash.trim()!==provenance.payloadHash)){addConflict(report,group,"MAPPING_CHECKSUM_CONFLICT","Existing source mapping checksum differs");continue}
      let missingTarget=false;
      for(const item of existingMappings){
        const table=item.target_type==="document_version"?"document_versions":item.target_type==="correspondence"?"correspondence_records":"documents";
        const target=await client.query(`SELECT id${item.target_type==="document_version"?",btrim(content_sha256) content_sha256":""} FROM ${table} WHERE organization_id=$1 AND id=$2`,[org,item.target_id]);
        if(!target.rowCount||item.target_type==="document_version"&&target.rows[0].content_sha256!==item.source_sha256.trim()){addConflict(report,group,"MAPPED_TARGET_MISSING_OR_CHANGED",`${item.target_type}/${item.target_id}`);missingTarget=true;break}
      }
      if(missingTarget)continue;
      for(const item of existingMappings){report.sourceTargetMappings.push({legacyTable:provenance.legacyTable,legacyId:provenance.legacyId,targetRole:item.target_role,targetType:item.target_type,targetId:item.target_id,reused:true});report.reused[item.target_type==="document_version"?"documentVersions":item.target_type==="correspondence"?"correspondence":"documents"]++}
      const documentMapping=existingMappings.find(item=>item.target_role==="canonical_document");
      if(documentMapping){
        const versions=(await client.query(`SELECT m.*,p.legacy_table,p.legacy_id,btrim(v.content_sha256) content_sha256 FROM legacy_canonical_import_mappings m
          JOIN legacy_provenance_records p ON p.organization_id=m.organization_id AND p.id=m.provenance_id
          JOIN document_versions v ON v.organization_id=m.organization_id AND v.id=m.target_id
          WHERE m.organization_id=$1 AND m.target_type='document_version' AND v.document_id=$2 ORDER BY v.version_no`,[org,documentMapping.target_id])).rows;
        if(versions.some(item=>item.source_sha256.trim()!==item.content_sha256)){addConflict(report,group,"MAPPED_TARGET_MISSING_OR_CHANGED",`document/${documentMapping.target_id}/versions`);continue}
        for(const item of versions){report.sourceTargetMappings.push({legacyTable:item.legacy_table,legacyId:item.legacy_id,targetRole:item.target_role,targetType:item.target_type,targetId:item.target_id,reused:true});report.reused.documentVersions++;report.attachmentCount++}
      }
      report.documentCount++;
      continue;
    }
    let row;
    try{row=await source.readRecord(expectedTable,provenance.legacyId)}catch(error){addConflict(report,group,"SOURCE_READ_FAILED",error.message);continue}
    if(!row){addConflict(report,group,"SOURCE_RECORD_MISSING",`${expectedTable}/${provenance.legacyId}`);continue}
    const evidence=sourceEvidence(expectedTable,row);
    if(evidence.sourceSha256!==provenance.sourceSha256||evidence.payloadHash!==provenance.payloadHash){report.checksumVerification.failures.push({table:expectedTable,id:provenance.legacyId});addConflict(report,group,"SOURCE_CHECKSUM_CONFLICT","Staged provenance no longer matches source");continue}
    report.checksumVerification.sourceRowsVerified++;
    const parentType=group.category==="ORDER_DECISION"?"order":"letter";
    let attachments;
    try{attachments=await source.listAttachments(parentType,row.id)}catch(error){addConflict(report,group,"ATTACHMENT_READ_FAILED",error.message);continue}
    if(!attachments.length){addConflict(report,group,"ATTACHMENT_REQUIRED","Approved safe group has no attachment");continue}
    const attachmentPlans=[];let attachmentConflict=false;
    for(const attachment of attachments){
      if(!Buffer.isBuffer(attachment.buffer)||!attachment.buffer.length){addConflict(report,group,"ATTACHMENT_EMPTY",attachment.row.id);attachmentConflict=true;break}
      const fileSha=fileContentSha256(attachment.buffer),fileEvidence=sourceEvidence("doc_attachments",attachment.row,fileSha);
      const staged=(await client.query(`SELECT * FROM legacy_provenance_records WHERE organization_id=$1 AND legacy_source=$2 AND legacy_table='doc_attachments' AND legacy_id=$3`,[org,provenance.legacySource,String(attachment.row.id)])).rows[0];
      if(!staged||staged.classification!=="IMPORT_NEW"||staged.review_status!=="NOT_REQUIRED"||staged.source_sha256.trim()!==fileEvidence.sourceSha256||staged.payload_hash.trim()!==fileEvidence.payloadHash){
        report.checksumVerification.failures.push({table:"doc_attachments",id:String(attachment.row.id)});addConflict(report,group,"ATTACHMENT_PROVENANCE_CONFLICT",String(attachment.row.id));attachmentConflict=true;break;
      }
      report.checksumVerification.filesVerified++;
      attachmentPlans.push({row:attachment.row,buffer:attachment.buffer,fileSha,provenance:staged});
    }
    if(attachmentConflict)continue;
    const documentNo=cleanText(row.doc_no,120),documentId=deterministicUuid("legacy-canonical-document",`${org}:${provenance.legacySource}:${expectedTable}:${provenance.legacyId}`);
    if(!documentNo){addConflict(report,group,"DOCUMENT_NUMBER_REQUIRED","");continue}
    const collision=await client.query("SELECT id FROM documents WHERE organization_id=$1 AND document_no=$2",[org,documentNo]);
    if(collision.rowCount){addConflict(report,group,"DOCUMENT_NUMBER_COLLISION",documentNo);continue}
    let linkedPerson=null;
    if(group.category==="ORDER_DECISION"&&row.related_user!=null){linkedPerson=await resolveLegacyPerson(client,org,row.related_user);if(!linkedPerson){addConflict(report,group,"EMPLOYEE_STABLE_MATCH_REQUIRED",String(row.related_user));continue}}
    let responsible=null,correspondenceId=null,registrationNo=null,mappedDirection=null;
    if(group.category==="CORRESPONDENCE"){
      mappedDirection=direction(row.doc_type);if(!mappedDirection){addConflict(report,group,"CORRESPONDENCE_DIRECTION_UNKNOWN",row.doc_type);continue}
      responsible=await resolveLegacyPerson(client,org,row.assigned_to,{userRequired:true});if(!responsible){addConflict(report,group,"RESPONSIBLE_USER_STABLE_MATCH_REQUIRED",String(row.assigned_to));continue}
      correspondenceId=deterministicUuid("legacy-correspondence",`${org}:${provenance.legacySource}:${provenance.legacyId}`);registrationNo=`LEGACY-CORR-${provenance.legacyId}`;
      const registrationCollision=await client.query("SELECT id FROM correspondence_records WHERE organization_id=$1 AND registration_no=$2",[org,registrationNo]);
      if(registrationCollision.rowCount){addConflict(report,group,"CORRESPONDENCE_REGISTRATION_COLLISION",registrationNo);continue}
    }
    const versions=attachmentPlans.map((item,index)=>({...item,id:deterministicUuid("legacy-document-version",`${documentId}:${item.provenance.id}`),versionNo:index+1,storageKey:`legacy-${deterministicUuid("legacy-file",`${org}:${item.provenance.id}:${item.fileSha}`)}`}));
    plans.push({group,provenance,row,documentId,documentNo,versions,linkedPerson,responsible,correspondenceId,registrationNo,mappedDirection});
    report.create.documents++;report.create.documentVersions+=versions.length;report.documentCount++;report.attachmentCount+=versions.length;
    if(correspondenceId)report.create.correspondence++;
    report.sourceTargetMappings.push({legacyTable:expectedTable,legacyId:provenance.legacyId,targetRole:"canonical_document",targetType:"document",targetId:documentId,reused:false});
    if(correspondenceId)report.sourceTargetMappings.push({legacyTable:expectedTable,legacyId:provenance.legacyId,targetRole:"domain_correspondence",targetType:"correspondence",targetId:correspondenceId,reused:false});
    for(const version of versions)report.sourceTargetMappings.push({legacyTable:"doc_attachments",legacyId:String(version.row.id),targetRole:"document_version",targetType:"document_version",targetId:version.id,reused:false});
  }
  return {report,plans,groups};
}

async function planLegacyCanonicalImport({req,source}){
  requirePermission(req,"legacy_migration.import");
  return withTenantTransaction(assertUuid(req.user.organization_id,"TENANT_CONTEXT_REQUIRED"),async client=>(await buildImportPlanInTransaction({client,req,source})).report);
}

async function commitLegacyCanonicalImport({req,source,idempotencyKey,allowCommit=false,uploadDirectory=null,injectFailure=null}){
  requirePermission(req,"legacy_migration.import");
  if(!allowCommit||process.env.ALLOW_LEGACY_CANONICAL_IMPORT!=="true")throw new LegacyProvenanceError("LEGACY_IMPORT_COMMIT_DISABLED",409);
  const org=assertUuid(req.user.organization_id,"TENANT_CONTEXT_REQUIRED"),actor=assertUuid(req.user.id,"LEGACY_ACTOR_INVALID"),requestId=assertUuid(idempotencyKey,"LEGACY_IDEMPOTENCY_KEY_INVALID");
  const destination=path.resolve(uploadDirectory||process.env.DOCUMENT_UPLOAD_DIR||process.env.UPLOAD_DIR||"/app/uploads/documents"),newFiles=[];
  try{return await withTenantTransaction(org,async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${org}:legacy-canonical-import:${requestId}`]);
    const prepared=await buildImportPlanInTransaction({client,req,source}),groupIds=prepared.groups.filter(item=>item.review_status==="APPROVED").map(item=>item.id).sort(),databaseSha=prepared.report.checksumVerification.databaseSha256;
    const payloadHash=sha256Structured({groupIds,databaseSha});
    const replay=await client.query("SELECT * FROM legacy_canonical_import_runs WHERE organization_id=$1 AND idempotency_key=$2",[org,requestId]);
    if(replay.rowCount){if(replay.rows[0].payload_hash.trim()!==payloadHash)throw new LegacyProvenanceError("LEGACY_IDEMPOTENCY_CONFLICT",409);return {...replay.rows[0].result_summary,replayed:true}}
    if(!groupIds.length)throw new LegacyProvenanceError("LEGACY_IMPORT_APPROVED_GROUPS_REQUIRED",409);
    if(prepared.report.conflicts.length)throw new LegacyProvenanceError("LEGACY_IMPORT_PREFLIGHT_CONFLICT",409);
    const expectedProvenance=new Map();
    for(const plan of prepared.plans){expectedProvenance.set(plan.provenance.provenanceId,{version:Number(plan.provenance.version),classification:"IMPORT_NEW",reviewStatus:"APPROVED"});for(const version of plan.versions)expectedProvenance.set(version.provenance.id,{version:Number(version.provenance.version),classification:"IMPORT_NEW",reviewStatus:"NOT_REQUIRED"})}
    if(expectedProvenance.size){
      const locked=await client.query("SELECT id,version,classification,review_status,imported_at FROM legacy_provenance_records WHERE organization_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE",[org,[...expectedProvenance.keys()]]);
      if(locked.rowCount!==expectedProvenance.size||locked.rows.some(row=>{const expected=expectedProvenance.get(row.id);return Number(row.version)!==expected.version||row.classification!==expected.classification||row.review_status!==expected.reviewStatus||row.imported_at!==null}))throw new LegacyProvenanceError("LEGACY_IMPORT_APPROVAL_VERSION_CONFLICT",409);
    }
    await fs.promises.mkdir(destination,{recursive:true});
    const runId=deterministicUuid("legacy-canonical-import-run",`${org}:${requestId}`),now=new Date();
    const result={...prepared.report,mode:"COMMIT",noWrites:false,replayed:false,importRunId:runId};
    await client.query(`INSERT INTO legacy_canonical_import_runs(id,organization_id,idempotency_key,payload_hash,source_database_sha256,selected_group_ids,result_summary,actor_user_id)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)`,[runId,org,requestId,payloadHash,databaseSha,JSON.stringify(groupIds),JSON.stringify(result),actor]);
    for(const plan of prepared.plans){
      const title=cleanText(plan.row.title||plan.row.subject||`${plan.row.doc_type||"Legacy document"} ${plan.documentNo}`,500);
      await client.query(`INSERT INTO documents(id,organization_id,document_no,title,document_type,status,classification_code,retention_class,created_by,updated_by)
        VALUES($1,$2,$3,$4,$5,'active','internal','standard',$6,$6)`,[plan.documentId,org,plan.documentNo,title,cleanText(plan.row.doc_type,120)||"legacy",actor]);
      for(const version of plan.versions){
        const target=path.join(destination,version.storageKey),exists=fs.existsSync(target);
        if(exists){const existingSha=fileContentSha256(await fs.promises.readFile(target));if(existingSha!==version.fileSha)throw new LegacyProvenanceError("LEGACY_STORAGE_KEY_CONFLICT",409)}
        else{await fs.promises.writeFile(target,version.buffer,{flag:"wx"});newFiles.push(target)}
        const metadata={legacySource:plan.provenance.legacySource,legacyTable:"doc_attachments",legacyId:String(version.row.id),legacyStatus:version.provenance.legacy_status,payloadHash:version.provenance.payload_hash.trim(),sourceSha256:version.provenance.source_sha256.trim(),importedAt:now.toISOString()};
        await client.query(`INSERT INTO document_versions(id,organization_id,document_id,version_no,original_name,storage_key,mime_type,size_bytes,content_sha256,metadata,created_by)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)`,[version.id,org,plan.documentId,version.versionNo,safeFileName(version.row.file_name||version.row.file_url),version.storageKey,mimeType(version.row.file_name||version.row.file_url),version.buffer.length,version.fileSha,JSON.stringify(metadata),actor]);
        await client.query(`INSERT INTO legacy_canonical_import_mappings(organization_id,import_run_id,provenance_id,target_role,target_type,target_id,source_sha256,payload_hash,provenance_metadata,created_by)
          VALUES($1,$2,$3,'document_version','document_version',$4,$5,$6,$7::jsonb,$8)`,[org,runId,version.provenance.id,version.id,version.provenance.source_sha256.trim(),version.provenance.payload_hash.trim(),JSON.stringify(metadata),actor]);
      }
      await client.query("UPDATE documents SET current_version_id=$3,updated_at=now() WHERE organization_id=$1 AND id=$2",[org,plan.documentId,plan.versions.at(-1).id]);
      const parentMetadata={legacySource:plan.provenance.legacySource,legacyTable:plan.provenance.legacyTable,legacyId:plan.provenance.legacyId,legacyStatus:plan.provenance.legacyStatus,payloadHash:plan.provenance.payloadHash,sourceSha256:plan.provenance.sourceSha256,importedAt:now.toISOString()};
      await client.query(`INSERT INTO legacy_canonical_import_mappings(organization_id,import_run_id,provenance_id,target_role,target_type,target_id,source_sha256,payload_hash,provenance_metadata,created_by)
        VALUES($1,$2,$3,'canonical_document','document',$4,$5,$6,$7::jsonb,$8)`,[org,runId,plan.provenance.provenanceId,plan.documentId,plan.provenance.sourceSha256,plan.provenance.payloadHash,JSON.stringify(parentMetadata),actor]);
      await client.query(`INSERT INTO document_links(organization_id,document_id,entity_type,entity_id,relation_type,source,recorded_by) VALUES($1,$2,'legacy_provenance_record',$3,'source','migration',$4)`,[org,plan.documentId,plan.provenance.provenanceId,actor]);
      if(plan.linkedPerson)await client.query(`INSERT INTO document_links(organization_id,document_id,entity_type,entity_id,relation_type,source,recorded_by) VALUES($1,$2,'employee',$3,'subject','migration',$4)`,[org,plan.documentId,plan.linkedPerson.employee_id,actor]);
      if(plan.correspondenceId){
        await client.query(`INSERT INTO correspondence_records(id,organization_id,registration_no,direction,document_type,document_no,document_date,registered_at,counterparty,subject,priority,responsible_user_id,status,created_by,channel,confidentiality,canonical_document_id,idempotency_key,payload_sha256)
          VALUES($1,$2,$3,$4,'official_letter',$5,$6,$6,$7,$8,'normal',$9,'registered',$10,'paper','internal',$11,$12,$13)`,[plan.correspondenceId,org,plan.registrationNo,plan.mappedDirection,plan.documentNo,plan.row.doc_date,cleanText(plan.row.source_org,500)||"",cleanText(plan.row.subject,1000)||plan.documentNo,plan.responsible.user_id,actor,plan.documentId,`legacy:${plan.provenance.provenanceId}`,plan.provenance.payloadHash]);
        await client.query(`INSERT INTO document_links(organization_id,document_id,entity_type,entity_id,relation_type,source,recorded_by) VALUES($1,$2,'correspondence',$3,'primary','migration',$4)`,[org,plan.documentId,plan.correspondenceId,actor]);
        await client.query(`INSERT INTO legacy_canonical_import_mappings(organization_id,import_run_id,provenance_id,target_role,target_type,target_id,source_sha256,payload_hash,provenance_metadata,created_by)
          VALUES($1,$2,$3,'domain_correspondence','correspondence',$4,$5,$6,$7::jsonb,$8)`,[org,runId,plan.provenance.provenanceId,plan.correspondenceId,plan.provenance.sourceSha256,plan.provenance.payloadHash,JSON.stringify(parentMetadata),actor]);
      }
      await client.query(`INSERT INTO document_lifecycle_events(organization_id,document_id,version_id,action,to_status,note,evidence,actor_user_id)
        VALUES($1,$2,$3,'created','active','Imported canonical evidence after explicit reviewer approval',$4::jsonb,$5)`,[org,plan.documentId,plan.versions.at(-1).id,JSON.stringify({legacyImportRunId:runId,provenanceId:plan.provenance.provenanceId,noHistoricalWorkflowBackfill:true}),actor]);
      const allProvenance=[{id:plan.provenance.provenanceId,version:Number(plan.provenance.version),targetType:plan.correspondenceId?"correspondence":"document",targetId:plan.correspondenceId||plan.documentId},...plan.versions.map(v=>({id:v.provenance.id,version:Number(v.provenance.version),targetType:"document",targetId:plan.documentId}))];
      for(const item of allProvenance){
        await client.query(`INSERT INTO legacy_canonical_import_events(id,organization_id,import_run_id,provenance_id,provenance_version,action,target_type,target_id,actor_user_id,imported_at,evidence)
          VALUES($1,$2,$3,$4,$5,'IMPORT_COMMITTED',$6,$7,$8,$9,$10::jsonb)`,[deterministicUuid("legacy-import-event",`${runId}:${item.id}`),org,runId,item.id,item.version+1,item.targetType,item.targetId,actor,now,JSON.stringify({noFabricatedWorkflowHistory:true})]);
        await client.query("UPDATE legacy_provenance_records SET imported_at=$3,version=$4 WHERE organization_id=$1 AND id=$2",[org,item.id,now,item.version+1]);
      }
      if(injectFailure)await injectFailure({client,plan});
    }
    await writeAudit(req,"legacy_migration.canonical_import_commit","legacy_canonical_import_run",runId,{idempotencyKey:requestId,groups:groupIds.length,documents:result.create.documents,attachments:result.create.documentVersions,correspondence:result.create.correspondence,noFabricatedWorkflowHistory:true},client);
    return result;
  })}catch(error){for(const file of newFiles)await fs.promises.unlink(file).catch(()=>{});throw error}
}

async function runLegacyCanonicalImport(options){return options.commit?commitLegacyCanonicalImport(options):planLegacyCanonicalImport(options)}

module.exports={SAFE_CATEGORIES,SOURCE_TABLES,direction,fileContentSha256,sourceEvidence,planLegacyCanonicalImport,commitLegacyCanonicalImport,runLegacyCanonicalImport};
