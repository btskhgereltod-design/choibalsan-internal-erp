"use strict";

require("dotenv").config();
const {getPool,closePool}=require("../src/db");

const dryRun=process.argv.includes("--dry-run");
const slug=process.env.IMPORT_ORG_SLUG||"choibalsan-hugjil";
const clean=value=>String(value??"").trim();
const readable=(value,fallback="")=>{const text=clean(value);if(!text.includes("?"))return text||fallback;return text.replace(/\?+/g," ").replace(/\s+/g," ").trim()||fallback};
const integer=value=>Number.isInteger(Number(value))?Number(value):0;
const statusAsset=value=>clean(value).toLowerCase()==="active"?"active":"inactive";
const faultStatus=value=>{const text=clean(value).toLowerCase();return text.includes("дуус")||text.includes("хааг")?"resolved":text.includes("явц")?"in_progress":"open"};
const read=()=>new Promise((resolve,reject)=>{let body="";process.stdin.setEncoding("utf8");process.stdin.on("data",chunk=>{body+=chunk});process.stdin.on("end",()=>{try{resolve(JSON.parse(body))}catch(error){reject(new Error(`Invalid JSON: ${error.message}`))}});process.stdin.on("error",reject)});

async function main(){
  const data=await read();
  if(data.format!=="overva.legacy-lighting.v1")throw new Error("Unsupported lighting import format");
  const client=await getPool().connect();
  const counts={objects:0,incidents:0,workOrders:0};
  try{
    await client.query("BEGIN");
    const organization=await client.query("SELECT id FROM organizations WHERE slug=$1",[slug]);
    if(!organization.rowCount)throw new Error(`Organization not found: ${slug}`);
    const organizationId=organization.rows[0].id;

    for(const [table,rows,nameField] of [["sl_points",data.points,"name"],["sl_ger_inventory",data.inventory,"location_name"]]){
      for(const row of rows||[]){
        const metadata={legacyId:row.id,bagNo:row.bag_no??null,meterNo:row.meter_no??null,lightType:row.light_type??null,lampCount:row.lamp_count??row.total_count??0,headCount:row.head_count??row.total_heads??0,wattagePerLamp:row.wattage_per_lamp??null,gps:{lat:row.gps_lat??null,lng:row.gps_lng??null},notes:row.notes??""};
        const result=await client.query(`UPDATE operational_objects SET name=$5,location=$6,status=$7,metadata=metadata||$8::jsonb,updated_at=now()
          WHERE organization_id=$1 AND source_system=$2 AND source_table=$3 AND source_id=$4
            AND (name LIKE '%?%' OR COALESCE(location,'') LIKE '%?%' OR metadata::text LIKE '%?%')`,[organizationId,data.sourceSystem,table,String(row.id),clean(row[nameField])||`Legacy object ${row.id}`,clean(row.location||row.location_name),statusAsset(row.status),JSON.stringify(metadata)]);
        counts.objects+=result.rowCount;
      }
    }

    for(const row of data.faults||[]){
      const category=readable(row.category,"Гэмтэл"),location=readable(row.location_name,"Байршил");
      const affected=Math.max(0,integer(row.broken_count)),resolved=Math.min(affected,Math.max(0,integer(row.fixed_count)));
      const detail={legacyStatus:row.status,totalHeads:row.total_heads,notes:row.notes||""};
      const result=await client.query(`UPDATE operational_incidents SET incident_type=$4,title=$5,location=$6,affected_quantity=$7,resolved_quantity=$8,status=$9,detail=detail||$10::jsonb,updated_at=now()
        WHERE organization_id=$1 AND domain='lighting' AND source_system=$2 AND external_id=$3
          AND (title LIKE '%?%' OR COALESCE(location,'') LIKE '%?%' OR detail::text LIKE '%?%')`,[organizationId,data.sourceSystem,String(row.id),category,`${category} — ${location||"Байршил"}`,location,affected,resolved,faultStatus(row.status),JSON.stringify(detail)]);
      counts.incidents+=result.rowCount;
    }

    for(const row of data.work||[]){
      const result=await client.query(`UPDATE work_orders w SET title=$4,description=$5,updated_at=now()
        FROM source_import_records s
        WHERE w.organization_id=$1 AND s.organization_id=w.organization_id AND s.target_type='work_order' AND s.target_id=w.id::text
          AND s.source_system=$2 AND s.source_table='asset_events' AND s.source_id=$3
          AND (w.title LIKE '%?%' OR COALESCE(w.description,'') LIKE '%?%')`,[organizationId,data.sourceSystem,String(row.id),clean(row.title)||`Legacy lighting work ${row.id}`,clean(row.description||row.location)]);
      counts.workOrders+=result.rowCount;
    }

    await client.query(`INSERT INTO audit_logs(organization_id,user_id,action,entity_type,entity_id,detail)
      VALUES($1::uuid,NULL,'legacy_lighting.encoding_repair','legacy_import',($1::uuid)::text,$2::jsonb)`,[organizationId,JSON.stringify({sourceSystem:data.sourceSystem,dryRun,counts,rule:"repair targets from read-only UTF-8 source; preserve immutable source provenance"})]);
    if(dryRun)await client.query("ROLLBACK");else await client.query("COMMIT");
    process.stdout.write(`${JSON.stringify({dryRun,organization:slug,counts},null,2)}\n`);
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release();await closePool()}
}

main().catch(error=>{console.error(error);process.exitCode=1});
