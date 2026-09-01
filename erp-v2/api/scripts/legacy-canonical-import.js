"use strict";

// Default mode is a read-only dry-run. Commit additionally requires both
// --commit and ALLOW_LEGACY_CANONICAL_IMPORT=true.
require("dotenv").config();
const fs=require("node:fs");
const path=require("node:path");
const crypto=require("node:crypto");
const sqlite3=require("sqlite3");
const {getPool,closePool}=require("../src/db");
const {runLegacyCanonicalImport}=require("../src/services/legacy-canonical-import");

function option(name){const index=process.argv.indexOf(name);return index>=0?process.argv[index+1]:null}
const commit=process.argv.includes("--commit"),organizationId=option("--organization-id"),actorUserId=option("--actor-user-id"),idempotencyKey=option("--idempotency-key")||crypto.randomUUID();
const legacyRoot=path.resolve(__dirname,"..","..","..");
const databasePath=path.resolve(option("--legacy-db")||process.env.LEGACY_DB_PATH||path.join(legacyRoot,"data","app.db"));
const uploadRoot=path.resolve(option("--legacy-upload-root")||process.env.LEGACY_UPLOAD_ROOT||path.join(legacyRoot,"uploads"));

function openSource(){
  const db=new sqlite3.Database(databasePath,sqlite3.OPEN_READONLY),all=(sql,params=[])=>new Promise((resolve,reject)=>db.all(sql,params,(error,rows)=>error?reject(error):resolve(rows))),get=(sql,params=[])=>new Promise((resolve,reject)=>db.get(sql,params,(error,row)=>error?reject(error):resolve(row)));
  const resolveFile=value=>{const clean=String(value||"").replace(/^[/\\]+/,"").replace(/^uploads[/\\]/i,"");const resolved=path.resolve(uploadRoot,clean);if(resolved!==uploadRoot&&!resolved.startsWith(`${uploadRoot}${path.sep}`))throw new Error("LEGACY_FILE_PATH_OUTSIDE_ROOT");return resolved};
  return {
    async initialize(){await all("PRAGMA query_only=ON")},
    async databaseSha256(){return crypto.createHash("sha256").update(await fs.promises.readFile(databasePath)).digest("hex")},
    async readRecord(table,id){if(!["orders_decisions","correspondence"].includes(table))throw new Error("LEGACY_SOURCE_TABLE_NOT_ALLOWED");return get(`SELECT * FROM ${table} WHERE id=?`,[id])},
    async listAttachments(entityType,entityId){const rows=await all("SELECT * FROM doc_attachments WHERE entity_type=? AND entity_id=? ORDER BY id",[entityType,entityId]);return Promise.all(rows.map(async row=>{const filePath=resolveFile(row.file_url);return {row,filePath,buffer:await fs.promises.readFile(filePath)}}))},
    close:()=>new Promise((resolve,reject)=>db.close(error=>error?reject(error):resolve())),
  };
}

async function actorContext(){
  if(!organizationId||!actorUserId)throw new Error("--organization-id and --actor-user-id are required");
  const result=await getPool().query(`SELECT u.id,u.organization_id,ARRAY(SELECT DISTINCT rp.permission_code FROM user_roles ur JOIN organization_role_permissions rp ON rp.organization_id=ur.organization_id AND rp.role_id=ur.role_id WHERE ur.organization_id=u.organization_id AND ur.user_id=u.id) permissions
    FROM users u WHERE u.organization_id=$1 AND u.id=$2 AND u.active=true`,[organizationId,actorUserId]);
  if(result.rowCount!==1)throw new Error("LEGACY_IMPORT_ACTOR_NOT_FOUND");
  return {user:result.rows[0],ip:null};
}

async function main(){
  const source=openSource();
  try{await source.initialize();const req=await actorContext();const report=await runLegacyCanonicalImport({req,source,commit,idempotencyKey,allowCommit:commit});process.stdout.write(`${JSON.stringify(report,null,2)}\n`)}
  finally{await source.close().catch(()=>{});await closePool()}
}

main().catch(error=>{console.error(JSON.stringify({error:error.code||error.message,status:error.status||500},null,2));process.exitCode=1});
