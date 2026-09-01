"use strict";

const { Pool } = require("pg");
const { loadConfig } = require("./config");

let pool;

class TenantContextError extends Error {
  constructor(code) {
    super(code);
    this.name="TenantContextError";
    this.code=code;
    this.status=code==="TENANT_CONTEXT_MISMATCH"?403:500;
  }
}

function requireOrganizationId(value) {
  const id=String(value||"").trim();
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new TenantContextError("TENANT_CONTEXT_REQUIRED");
  }
  return id.toLowerCase();
}

function getPool() {
  if (!pool) {
    const config = loadConfig();
    pool = new Pool({
      connectionString: config.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    pool.on("error", error => console.error("[postgres pool]", error));
  }
  return pool;
}

async function closePool() {
  if (pool) await pool.end();
  pool = undefined;
}

async function currentTenantContext(client) {
  return (await client.query(
    "SELECT NULLIF(current_setting('app.organization_id',true),'') AS organization_id"
  )).rows[0].organization_id||null;
}

async function setTenantContext(client, organizationId) {
  const requested=requireOrganizationId(organizationId);
  const current=await currentTenantContext(client);
  if(current&&current!==requested)throw new TenantContextError("TENANT_CONTEXT_MISMATCH");
  await client.query("SELECT set_config('app.organization_id',$1,true)",[requested]);
  const verified=await currentTenantContext(client);
  if(verified!==requested)throw new TenantContextError("TENANT_CONTEXT_TRANSACTION_REQUIRED");
  return requested;
}

async function withTenantTransaction(organizationId, operation, {client=null}={}) {
  if(typeof operation!=="function")throw new TypeError("Tenant transaction operation is required");
  if(client){
    await setTenantContext(client,organizationId);
    return operation(client);
  }
  const owned=await getPool().connect();
  try{
    await owned.query("BEGIN");
    await setTenantContext(owned,organizationId);
    const result=await operation(owned);
    await owned.query("COMMIT");
    return result;
  }catch(error){
    await owned.query("ROLLBACK").catch(()=>{});
    throw error;
  }finally{owned.release()}
}

async function withSystemTransaction(purpose, operation, {client=null}={}) {
  const reason=String(purpose||"").trim();
  if(process.env.OVERVA_ALLOW_SYSTEM_DB_BYPASS!=="1"||reason.length<8||reason.length>240){
    throw new TenantContextError("SYSTEM_DB_BYPASS_DISABLED");
  }
  const execute=async tx=>{
    const current=await currentTenantContext(tx);
    if(current)throw new TenantContextError("TENANT_CONTEXT_MISMATCH");
    await tx.query("SET LOCAL row_security = off");
    await tx.query("SELECT set_config('app.system_bypass_purpose',$1,true)",[reason]);
    return operation(tx);
  };
  if(client)return execute(client);
  const owned=await getPool().connect();
  try{
    await owned.query("BEGIN");
    const result=await execute(owned);
    await owned.query("COMMIT");
    return result;
  }catch(error){
    await owned.query("ROLLBACK").catch(()=>{});
    throw error;
  }finally{owned.release()}
}

module.exports = {
  getPool,closePool,TenantContextError,requireOrganizationId,currentTenantContext,
  setTenantContext,withTenantTransaction,withSystemTransaction,
};
