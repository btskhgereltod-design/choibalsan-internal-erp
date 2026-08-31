"use strict";

require("dotenv").config();
const { getPool, closePool } = require("../src/db");

async function main() {
  const result = await getPool().query(`
    WITH o AS (SELECT id FROM organizations WHERE slug='choibalsan-hugjil')
    SELECT
      (SELECT count(*)::int FROM source_import_records s,o WHERE s.organization_id=o.id AND source_system='choibalsan-legacy-erp' AND source_table='wh_materials') materials_source,
      (SELECT count(*)::int FROM source_import_records s,o WHERE s.organization_id=o.id AND source_system='choibalsan-legacy-erp' AND source_table='wh_transactions') movements_source,
      (SELECT round(sum(b.quantity),3) FROM inventory_balances b JOIN source_import_records s ON s.organization_id=b.organization_id AND s.target_type='inventory_item' AND s.target_id=b.item_id::text,o WHERE b.organization_id=o.id AND s.source_system='choibalsan-legacy-erp') imported_quantity,
      (SELECT round(sum(b.quantity*i.unit_cost),2) FROM inventory_balances b JOIN inventory_items i ON i.organization_id=b.organization_id AND i.id=b.item_id JOIN source_import_records s ON s.organization_id=i.organization_id AND s.target_type='inventory_item' AND s.target_id=i.id::text,o WHERE b.organization_id=o.id AND s.source_system='choibalsan-legacy-erp') inventory_value,
      (SELECT round(sum(b.quantity*COALESCE((s.source_snapshot->>'unit_price')::numeric,0)),2) FROM inventory_balances b JOIN source_import_records s ON s.organization_id=b.organization_id AND s.target_type='inventory_item' AND s.target_id=b.item_id::text,o WHERE b.organization_id=o.id AND s.source_system='choibalsan-legacy-erp') source_inventory_value,
      (SELECT round(sum((COALESCE((m.source_snapshot->>'opening_qty')::numeric,0)+COALESCE((SELECT sum(CASE WHEN t.source_snapshot->>'txn_type' IN('INCOME','INTERNAL_IN') THEN (t.source_snapshot->>'qty')::numeric ELSE -(t.source_snapshot->>'qty')::numeric END) FROM source_import_records t WHERE t.organization_id=m.organization_id AND t.source_system=m.source_system AND t.source_table='wh_transactions' AND t.source_snapshot->>'material_id'=m.source_id),0))*COALESCE((m.source_snapshot->>'unit_price')::numeric,0)),2) FROM source_import_records m,o WHERE m.organization_id=o.id AND m.source_system='choibalsan-legacy-erp' AND m.source_table='wh_materials') source_recalculated_value,
      (SELECT count(*)::int FROM source_import_records s,o WHERE s.organization_id=o.id AND source_system='choibalsan-legacy-erp' AND source_table='wh_materials' AND COALESCE((source_snapshot->>'unit_price')::numeric,0)<0) negative_unit_cost_rows,
      (SELECT count(*)::int FROM finance_transactions f,o WHERE f.organization_id=o.id AND f.connector_id=(SELECT id FROM finance_connectors c WHERE c.organization_id=o.id AND code='LEGACY-ERP')) cash_rows,
      (SELECT round(sum(amount) FILTER(WHERE transaction_type='income'),2) FROM finance_transactions f,o WHERE f.organization_id=o.id AND f.connector_id=(SELECT id FROM finance_connectors c WHERE c.organization_id=o.id AND code='LEGACY-ERP')) income,
      (SELECT round(sum(amount) FILTER(WHERE transaction_type='expense'),2) FROM finance_transactions f,o WHERE f.organization_id=o.id AND f.connector_id=(SELECT id FROM finance_connectors c WHERE c.organization_id=o.id AND code='LEGACY-ERP')) expense,
      (SELECT count(*)::int FROM source_import_records s,o WHERE s.organization_id=o.id AND source_system='choibalsan-legacy-erp' AND source_table='accounts_payable') payable_source,
      (SELECT count(*)::int FROM finance_obligations f,o WHERE f.organization_id=o.id AND document_no LIKE 'LEGACY-AP-%') payable_rows,
      (SELECT count(*)::int FROM finance_obligations f,o WHERE f.organization_id=o.id AND document_no LIKE 'LEGACY-AR-%') receivable_rows,
      (SELECT count(*)::int FROM accounting_fixed_assets f,o WHERE f.organization_id=o.id) fixed_rows,
      (SELECT round(sum(initial_value),2) FROM accounting_fixed_assets f,o WHERE f.organization_id=o.id) fixed_initial,
      (SELECT round(sum(book_value),2) FROM accounting_fixed_assets f,o WHERE f.organization_id=o.id) fixed_book
  `);
  console.log(JSON.stringify(result.rows[0], null, 2));
}

main().finally(closePool).catch((error) => { console.error(error); process.exitCode = 1; });
