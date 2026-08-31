"use strict";

require("dotenv").config();
const { getPool, closePool } = require("../src/db");

const dryRun = process.argv.includes("--dry-run");
const base64Input = process.argv.includes("--base64");
const organizationSlug = process.env.IMPORT_ORG_SLUG || process.env.BOOTSTRAP_ORG_SLUG;
const text = value => String(value ?? "").trim();
const acquiredDate = value => /^\d{4}-\d{2}-\d{2}/.test(text(value)) ? text(value).slice(0, 10) : null;

function readStdin() {
  return new Promise((resolve, reject) => {
    let body = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", chunk => { body += chunk; });
    process.stdin.on("end", () => {
      try {
        const json = base64Input ? Buffer.from(body.trim(), "base64").toString("utf8") : body;
        resolve(JSON.parse(json));
      } catch (error) {
        reject(new Error(`Invalid asset repair JSON: ${error.message}`));
      }
    });
    process.stdin.on("error", reject);
  });
}

function targetStatus(row) {
  const condition = text(row.condition).toLowerCase();
  const status = text(row.status).toLowerCase();
  if (condition.includes("татан буулгах")) return "retired";
  if (condition.includes("засвар")) return "repair";
  if (status.includes("идэвхгүй") || status.includes("inactive")) return "inactive";
  return "active";
}

async function main() {
  const payload = await readStdin();
  if (payload.format !== "overva.legacy-assets.v1" || payload.sourceSystem !== "choibalsan-legacy-demo" || !Array.isArray(payload.assets)) {
    throw new Error("Unsupported legacy asset payload");
  }
  if (!organizationSlug) throw new Error("IMPORT_ORG_SLUG is required");
  if (!payload.assets.length || payload.assets.length > 5000) throw new Error("Legacy asset count is outside the reviewed range");

  const client = await getPool().connect();
  const report = { source: payload.assets.length, linked: 0, corrected: 0, missing: 0 };
  try {
    await client.query("BEGIN");
    const organization = (await client.query("SELECT id FROM organizations WHERE slug=$1 FOR UPDATE", [organizationSlug])).rows[0];
    if (!organization) throw new Error(`Organization not found: ${organizationSlug}`);
    const actor = (await client.query("SELECT id FROM users WHERE organization_id=$1 AND username='admin' AND active=true", [organization.id])).rows[0];
    if (!actor) throw new Error("Local demo administrator not found");
    const userRows = await client.query(`SELECT ep.legacy_user_id,u.id FROM employee_profiles ep JOIN users u
      ON u.organization_id=ep.organization_id AND u.id=ep.user_id WHERE ep.organization_id=$1`, [organization.id]);
    const users = new Map(userRows.rows.map(row => [Number(row.legacy_user_id), row.id]));

    const targets = new Map();
    for (const row of payload.assets) {
      const linked = await client.query(`SELECT s.target_id,a.id FROM source_import_records s
        JOIN assets a ON a.organization_id=s.organization_id AND a.id::text=s.target_id
        WHERE s.organization_id=$1 AND s.source_system=$2 AND s.source_table='assets'
          AND s.source_id=$3 AND s.target_type='asset'`, [organization.id, payload.sourceSystem, String(row.id)]);
      if (!linked.rowCount) { report.missing += 1; continue; }
      targets.set(String(row.id), linked.rows[0].id);
      report.linked += 1;
    }

    // Codes are tenant-unique. Temporary deterministic codes let the repair
    // restore the original codes without changing asset UUIDs or relationships.
    for (const [sourceId, assetId] of targets) {
      await client.query("UPDATE assets SET code=$3 WHERE organization_id=$1 AND id=$2", [organization.id, assetId, `ENCODING-REPAIR-${sourceId}`]);
    }

    for (const row of payload.assets) {
      const sourceId = String(row.id), assetId = targets.get(sourceId);
      if (!assetId) continue;
      const code = text(row.asset_code) || `LEGACY-ASSET-${sourceId}`;
      const name = text(row.name) || code;
      const status = targetStatus(row);
      const metadata = {
        source: payload.sourceSystem,
        legacyId: row.id,
        sourceStatus: text(row.status),
        sourceCondition: text(row.condition),
        subCategory: text(row.sub_category) || null,
        bagNo: row.bag_no ?? null,
        cameraCount: row.camera_count ?? null,
        cameraBrokenCount: row.camera_broken_count ?? null,
        encodingCorrectedAt: new Date().toISOString(),
      };
      await client.query(`UPDATE assets SET code=$3,name=$4,category=$5,status=$6,location=$7,
        responsible_user_id=$8,acquired_at=$9,metadata=metadata||$10::jsonb,updated_at=now()
        WHERE organization_id=$1 AND id=$2`, [organization.id, assetId, code, name, text(row.category) || "Бусад", status,
        text(row.location), users.get(Number(row.assigned_to)) || null, acquiredDate(row.installed_date), JSON.stringify(metadata)]);
      await client.query(`INSERT INTO asset_events(organization_id,asset_id,actor_user_id,event_type,detail)
        VALUES($1,$2,$3,'updated',$4::jsonb)`, [organization.id, assetId, actor.id, JSON.stringify({
        reason: "legacy UTF-8 transport correction", source: payload.sourceSystem, legacyId: row.id,
      })]);
      report.corrected += 1;
    }

    await client.query(`INSERT INTO audit_logs(organization_id,user_id,action,entity_type,entity_id,detail)
      VALUES($1,$2,'asset.legacy_encoding_repair','asset_import',$3,$4::jsonb)`, [organization.id, actor.id, organization.id, JSON.stringify({
      sourceSystem: payload.sourceSystem, ...report, dryRun, rule: "preserve asset UUIDs and append correction evidence",
    })]);
    if (dryRun) await client.query("ROLLBACK"); else await client.query("COMMIT");
    console.log(JSON.stringify({ mode: dryRun ? "dry-run" : "repair", ...report }));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await closePool();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
