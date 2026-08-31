"use strict";

require("dotenv").config();
const crypto = require("node:crypto");
const { getPool, closePool } = require("../src/db");

const dryRun = process.argv.includes("--dry-run");
const base64Input = process.argv.includes("--base64");
const refreshImportedBalances = process.argv.includes("--refresh-imported-balances");
const slug = process.env.IMPORT_ORG_SLUG || "choibalsan-hugjil";
const clean = (value) => String(value ?? "").trim();
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const date = (value, fallback = "2026-01-01") => {
  const raw = clean(value);
  const parsed = new Date(raw || fallback);
  return Number.isNaN(parsed.valueOf()) ? fallback : parsed.toISOString().slice(0, 10);
};
const timestamp = (value) => `${date(value)}T00:00:00.000Z`;
const read = () => new Promise((resolve, reject) => {
  let body = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { body += chunk; });
  process.stdin.on("end", () => { try { resolve(JSON.parse(base64Input ? Buffer.from(body.trim(), "base64").toString("utf8") : body)); } catch (error) { reject(error); } });
  process.stdin.on("error", reject);
});

async function main() {
  if (!dryRun && process.env.ALLOW_LEGACY_FINANCE_INVENTORY_IMPORT !== "true") {
    throw new Error("Apply requires ALLOW_LEGACY_FINANCE_INVENTORY_IMPORT=true");
  }
  const data = await read();
  if (data.format !== "overva.legacy-finance-inventory.v1") throw new Error("Unsupported import format");
  if (slug !== "choibalsan-hugjil") throw new Error("This reviewed import is restricted to choibalsan-hugjil");

  const client = await getPool().connect();
  const counts = { materials: 0, movements: 0, cash: 0, payables: 0, receivables: 0, fixedAssets: 0, skipped: 0, warnings: [] };
  try {
    await client.query("BEGIN");
    const org = (await client.query("SELECT id FROM organizations WHERE slug=$1", [slug])).rows[0]?.id;
    if (!org) throw new Error(`Organization not found: ${slug}`);
    const actor = (await client.query("SELECT id FROM users WHERE organization_id=$1 AND active=true ORDER BY CASE WHEN role='admin' THEN 0 WHEN role='director' THEN 1 ELSE 2 END,created_at LIMIT 1", [org])).rows[0]?.id;
    if (!actor) throw new Error("Active import actor not found");
    const source = data.sourceSystem;
    const sourceRecord = async (table, id) => (await client.query("SELECT target_id FROM source_import_records WHERE organization_id=$1 AND source_system=$2 AND source_table=$3 AND source_id=$4", [org, source, table, String(id)])).rows[0]?.target_id;
    const provenance = async (table, row, targetType, targetId, warnings = []) => client.query(
      "INSERT INTO source_import_records(organization_id,source_system,source_table,source_id,target_type,target_id,source_snapshot,warnings) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)",
      [org, source, table, String(row.id), targetType, String(targetId), JSON.stringify(row), JSON.stringify(warnings)],
    );

    let warehouse = (await client.query("SELECT id FROM warehouses WHERE organization_id=$1 AND code='MAIN'", [org])).rows[0]?.id;
    if (!warehouse) warehouse = (await client.query("INSERT INTO warehouses(organization_id,code,name,location) VALUES($1,'MAIN','Төв агуулах','') RETURNING id", [org])).rows[0].id;

    const movementByMaterial = new Map();
    for (const row of data.movements || []) {
      const item = movementByMaterial.get(Number(row.material_id)) || { incoming: 0, outgoing: 0 };
      if (["INCOME", "INTERNAL_IN"].includes(clean(row.txn_type))) item.incoming += number(row.qty);
      else if (["EXPENSE", "INTERNAL_OUT"].includes(clean(row.txn_type))) item.outgoing += number(row.qty);
      movementByMaterial.set(Number(row.material_id), item);
    }
    const itemIds = new Map();
    const newItems = new Set();
    for (const row of data.materials || []) {
      let itemId = await sourceRecord("wh_materials", row.id);
      if (!itemId) {
        const sku = clean(row.barcode) || `LEGACY-MAT-${row.id}`;
        const inserted = await client.query(
          "INSERT INTO inventory_items(organization_id,sku,name,category,unit,minimum_stock,unit_cost) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(organization_id,sku) DO UPDATE SET name=EXCLUDED.name RETURNING id",
          [org, sku, clean(row.name) || sku, clean(row.category_name) || clean(row.category_code) || "Бусад", clean(row.unit) || "ш", Math.max(0, number(row.min_qty)), Math.max(0, number(row.unit_price))],
        );
        itemId = inserted.rows[0].id;
        await provenance("wh_materials", row, "inventory_item", itemId, clean(row.barcode) ? [] : ["Blank legacy barcode replaced with deterministic SKU"]);
        newItems.add(itemId);
        counts.materials++;
      } else {
        await client.query("UPDATE inventory_items SET unit_cost=$3,updated_at=now() WHERE organization_id=$1 AND id=$2", [org, itemId, Math.max(0, number(row.unit_price))]);
        counts.skipped++;
      }
      itemIds.set(Number(row.id), itemId);
      if (newItems.has(itemId) || refreshImportedBalances) {
        const m = movementByMaterial.get(Number(row.id)) || { incoming: 0, outgoing: 0 };
        const balance = number(row.opening_qty) + m.incoming - m.outgoing;
        if (balance < 0) throw new Error(`Negative calculated balance for material ${row.id}`);
        await client.query("INSERT INTO inventory_balances(organization_id,warehouse_id,item_id,quantity) VALUES($1,$2,$3,$4) ON CONFLICT(organization_id,warehouse_id,item_id) DO UPDATE SET quantity=EXCLUDED.quantity,updated_at=now()", [org, warehouse, itemId, balance]);
      }
    }

    const movementType = { INCOME: "receipt", INTERNAL_IN: "adjustment_in", EXPENSE: "issue", INTERNAL_OUT: "adjustment_out" };
    for (const row of data.movements || []) {
      if (await sourceRecord("wh_transactions", row.id)) { counts.skipped++; continue; }
      const itemId = itemIds.get(Number(row.material_id));
      if (!itemId) throw new Error(`Material ${row.material_id} missing for movement ${row.id}`);
      const type = movementType[clean(row.txn_type)];
      if (!type || number(row.qty) <= 0) throw new Error(`Invalid movement ${row.id}`);
      const incoming = ["receipt", "adjustment_in"].includes(type);
      const inserted = await client.query(
        "INSERT INTO stock_movements(organization_id,item_id,from_warehouse_id,to_warehouse_id,movement_type,quantity,reference,note,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id",
        [org, itemId, incoming ? null : warehouse, incoming ? warehouse : null, type, number(row.qty), clean(row.doc_no) || clean(row.txn_no) || `LEGACY-WH-${row.id}`, [clean(row.notes), clean(row.work_ref), clean(row.asset_ref)].filter(Boolean).join(" · "), actor, timestamp(row.txn_date)],
      );
      await provenance("wh_transactions", row, "stock_movement", inserted.rows[0].id);
      counts.movements++;
    }

    let connector = (await client.query("SELECT id FROM finance_connectors WHERE organization_id=$1 AND code='LEGACY-ERP'", [org])).rows[0]?.id;
    if (!connector) connector = (await client.query("INSERT INTO finance_connectors(organization_id,code,name,connector_type,status,created_by) VALUES($1,'LEGACY-ERP','Хуучин ERP-ийн баталгаажсан импорт','accounting','active',$2) RETURNING id", [org, actor])).rows[0].id;
    const checksum = crypto.createHash("sha256").update(JSON.stringify({ cash: data.cash, payables: data.payables, receivables: data.receivables, fixedAssets: data.fixedAssets })).digest("hex");
    let job = (await client.query("SELECT id FROM finance_import_jobs WHERE organization_id=$1 AND file_checksum=$2", [org, checksum])).rows[0]?.id;
    if (!job) job = (await client.query("INSERT INTO finance_import_jobs(organization_id,connector_id,status,source_file_name,file_checksum,rows_received,rows_imported,created_by,completed_at) VALUES($1,$2,'completed','legacy-app.db',$3,$4,$4,$5,now()) RETURNING id", [org, connector, checksum, (data.cash || []).length, actor])).rows[0].id;

    for (const row of data.cash || []) {
      if (await sourceRecord("cash_journal", row.id)) { counts.skipped++; continue; }
      const sourceType = clean(row.txn_type) === "Орлого" ? "income" : clean(row.txn_type) === "Зарлага" ? "expense" : null;
      const rawAmount = number(row.amount);
      const type = rawAmount < 0 ? (sourceType === "income" ? "expense" : sourceType === "expense" ? "income" : null) : sourceType;
      if (!type) throw new Error(`Invalid cash journal row ${row.id}`);
      const code = (clean(row.corr_account) || clean(type === "income" ? row.debit_account : row.credit_account) || "CASH").slice(0, 100);
      let account = (await client.query("SELECT id FROM finance_accounts WHERE organization_id=$1 AND code=$2", [org, code])).rows[0]?.id;
      if (!account) account = (await client.query("INSERT INTO finance_accounts(organization_id,code,name,account_type,currency) VALUES($1,$2,$3,$4,'MNT') RETURNING id", [org, code, code, type === "income" ? "revenue" : "expense"])).rows[0].id;
      const inserted = await client.query(
        "INSERT INTO finance_transactions(organization_id,connector_id,import_job_id,account_id,external_id,transaction_date,transaction_type,amount,currency,counterparty,description,reference,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'MNT',$9,$10,$11,$12::jsonb) RETURNING id",
        [org, connector, job, account, `cash_journal:${row.id}`, date(row.txn_date), type, Math.abs(rawAmount), clean(row.counterparty), clean(row.description), clean(row.doc_no), JSON.stringify({ sourceSystem: source, sourceId: row.id, sourceType: clean(row.txn_type), sourceSignedAmount: rawAmount, debitAccount: clean(row.debit_account), creditAccount: clean(row.credit_account), cashFlowType: clean(row.cash_flow_type), economicCategory: clean(row.econ_category) })],
      );
      const warnings = rawAmount < 0 ? ["Negative legacy amount represented as the opposite cash-flow direction"] : [];
      await provenance("cash_journal", row, "finance_transaction", inserted.rows[0].id, warnings);
      counts.warnings.push(...warnings.map((warning) => `cash_journal ${row.id}: ${warning}`));
      counts.cash++;
    }

    const importObligations = async (table, rows, direction) => {
      for (const row of rows || []) {
        if (await sourceRecord(table, row.id)) { counts.skipped++; continue; }
        const original = number(row.amount), total = original, rawSettled = number(direction === "payable" ? row.paid_amount : row.received_amount);
        if (total < 0.01) {
          const warning = "Sub-cent or non-positive legacy obligation retained as import evidence but omitted from open balances";
          await provenance(table, row, "finance_import_warning", job, [warning]);
          counts.warnings.push(`${table} ${row.id}: ${warning}`);
          continue;
        }
        const settled = Math.min(total, Math.max(0, rawSettled));
        const status = settled === 0 ? "open" : settled === total ? "settled" : "partial";
        const warnings = [];
        const documentNo = clean(row.invoice_no) || `LEGACY-${direction === "payable" ? "AP" : "AR"}-${row.id}`;
        const documentDate = date(row.invoice_date), due = clean(row.due_date) && date(row.due_date) >= documentDate ? date(row.due_date) : null;
        const inserted = await client.query(
          "INSERT INTO finance_obligations(organization_id,direction,document_no,document_date,due_date,counterparty,description,total_amount,settled_amount,currency,status,created_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'MNT',$10,$11,COALESCE($12::timestamptz,now()),COALESCE($13::timestamptz,$12::timestamptz,now())) RETURNING id",
          [org, direction, documentNo, documentDate, due, clean(direction === "payable" ? row.vendor_name : row.debtor_name) || "Тодорхойгүй", [clean(row.description), clean(row.category)].filter(Boolean).join(" · "), total, settled, status, actor, row.created_at || null, row.updated_at || null],
        );
        await client.query("INSERT INTO finance_obligation_events(organization_id,obligation_id,actor_user_id,action,amount,reference,note,detail,created_at) VALUES($1,$2,$3,'created',0,$4,'Хуучин ERP-ээс баталгаатай импортлов',$5::jsonb,COALESCE($6::timestamptz,now()))", [org, inserted.rows[0].id, actor, documentNo, JSON.stringify({ sourceSystem: source, sourceTable: table, sourceId: row.id, legacyStatus: clean(row.status) }), row.created_at || null]);
        if (settled > 0) await client.query("INSERT INTO finance_obligation_events(organization_id,obligation_id,actor_user_id,action,amount,reference,note,detail,created_at) VALUES($1,$2,$3,'settlement_recorded',$4,$5,'Хуучин ERP-ийн төлөлтийн үлдэгдэл',$6::jsonb,COALESCE($7::timestamptz,now()))", [org, inserted.rows[0].id, actor, settled, documentNo, JSON.stringify({ sourceSystem: source, sourceId: row.id }), row.updated_at || row.created_at || null]);
        await provenance(table, row, "finance_obligation", inserted.rows[0].id, warnings);
        counts[direction === "payable" ? "payables" : "receivables"]++;
        counts.warnings.push(...warnings.map((warning) => `${table} ${row.id}: ${warning}`));
      }
    };
    await importObligations("accounts_payable", data.payables, "payable");
    await importObligations("accounts_receivable", data.receivables, "receivable");

    for (const row of data.fixedAssets || []) {
      const linkedAsset = await sourceRecord("fixed_assets_ledger", row.id);
      if (linkedAsset) {
        await client.query("UPDATE accounting_fixed_assets SET initial_value=$3,accumulated_depreciation=$4,book_value=$5,updated_at=now() WHERE organization_id=$1 AND id=$2", [org, linkedAsset, number(row.initial_value), number(row.accumulated_depreciation), number(row.book_value)]);
        counts.skipped++;
        continue;
      }
      const assetCode = clean(row.asset_code_manual) || `LEGACY-FA-${row.id}`;
      const inserted = await client.query(
        "INSERT INTO accounting_fixed_assets(organization_id,asset_code,asset_name,account_code,acquisition_date,unit,quantity,initial_value,accumulated_depreciation,book_value,useful_life_months,depreciation_method,last_depreciation_date,note,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,COALESCE($15::timestamptz,now()),COALESCE($16::timestamptz,$15::timestamptz,now())) RETURNING id",
        [org, assetCode, clean(row.asset_name_manual) || assetCode, clean(row.account_code), date(row.acquisition_date), clean(row.unit) || "ш", number(row.final_qty) || number(row.initial_qty) || 1, number(row.initial_value), number(row.accumulated_depreciation), number(row.book_value), row.useful_life_months || null, clean(row.depreciation_method), clean(row.last_depreciation_date) ? date(row.last_depreciation_date) : null, clean(row.note), row.created_at || null, row.updated_at || null],
      );
      await provenance("fixed_assets_ledger", row, "accounting_fixed_asset", inserted.rows[0].id);
      counts.fixedAssets++;
    }

    const expected = { materials: (data.materials || []).length, movements: (data.movements || []).length, cash: (data.cash || []).length, payables: (data.payables || []).length, receivables: (data.receivables || []).length, fixedAssets: (data.fixedAssets || []).length };
    for (const [table, key] of [["wh_materials", "materials"], ["wh_transactions", "movements"], ["cash_journal", "cash"], ["accounts_payable", "payables"], ["accounts_receivable", "receivables"], ["fixed_assets_ledger", "fixedAssets"]]) {
      const actual = Number((await client.query("SELECT count(*) count FROM source_import_records WHERE organization_id=$1 AND source_system=$2 AND source_table=$3", [org, source, table])).rows[0].count);
      if (actual !== expected[key]) throw new Error(`Import reconciliation failed for ${table}: expected ${expected[key]}, got ${actual}`);
    }
    if (dryRun) await client.query("ROLLBACK"); else await client.query("COMMIT");
    console.log(JSON.stringify({ dryRun, organization: slug, expected, counts }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await closePool();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
