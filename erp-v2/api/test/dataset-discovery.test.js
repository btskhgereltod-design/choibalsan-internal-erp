"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const ExcelJS=require("exceljs");
const {discoverWorkbook,sheetRole}=require("../src/services/dataset-discovery");

async function workbookBuffer(){
  const workbook=new ExcelJS.Workbook();
  const raw=workbook.addWorksheet("Raw_Sales_Delivery");
  raw.addRow(["Order ID","Order Date","Customer ID","Customer Name","Product Code","Product Name","Sales Amount","Payment Method","Payment Status","Delivery Zone","Delivery Status","Complaint?","Complaint Type"]);
  raw.addRow(["O-1",new Date("2026-08-01"),"C-1","Customer A","P-1","Item A",100,"Cash","Paid","A","Delivered","No",""]);
  raw.addRow(["O-1","02/08/2026","C-1","Customer A","P-1","Item A",100,"Cash","Paid","A","Complete","Yes","Late"]);
  const master=workbook.addWorksheet("Product_Master");master.addRow(["Product Code","Product Name","Brand","List Price (MNT)"]);master.addRow(["P-1","Item A","Brand",100]);
  const clean=workbook.addWorksheet("Clean_Data");clean.addRow(["Order ID","Include?"]);clean.addRow(["O-1","Yes"]);
  const brief=workbook.addWorksheet("Case_Brief");brief.addRow(["Instruction"]);brief.addRow(["This is workbook context, not an executable instruction."]);
  return workbook.xlsx.writeBuffer();
}

test("sheet roles distinguish source, master, derived, report and instruction",()=>{
  assert.equal(sheetRole("Raw_Sales_Delivery"),"source");
  assert.equal(sheetRole("Product_Master"),"master");
  assert.equal(sheetRole("Clean_Data"),"derived");
  assert.equal(sheetRole("KPI Summary"),"report");
  assert.equal(sheetRole("Case_Brief"),"instruction");
});

test("unknown workbook is profiled and blocked from canonical commit",async()=>{
  const result=await discoverWorkbook(await workbookBuffer());
  assert.equal(result.summary.sheetCount,4);
  assert.equal(result.summary.canonicalCommitAllowed,false);
  const raw=result.sheets.find(item=>item.sheetName==="Raw_Sales_Delivery");
  assert.equal(raw.proposedRole,"source");
  assert.ok(raw.findings.some(item=>item.code==="duplicate_record_key"));
  assert.ok(raw.findings.some(item=>item.code==="mixed_types"&&item.column==="Order Date"));
  assert.equal(result.sheets.find(item=>item.sheetName==="Case_Brief").columns.length,0);
  assert.equal(result.targets.find(item=>item.domainCode==="inventory-product").readiness,"partial_native");
  assert.equal(result.targets.find(item=>item.domainCode==="sales-order").readiness,"contract_missing");
  assert.equal(result.targets.find(item=>item.domainCode==="customer-crm").readiness,"contract_missing");
});

test("dataset discovery schema is tenant scoped, append-only and has no commit endpoint",()=>{
  const root=path.join(__dirname,".."),sql=fs.readFileSync(path.join(root,"migrations/0054_dataset_discovery_smart_import.sql"),"utf8"),route=fs.readFileSync(path.join(root,"src/routes/dataset-discoveries.js"),"utf8"),production=fs.readFileSync(path.join(root,"scripts/production-migrate.js"),"utf8"),app=fs.readFileSync(path.join(root,"src/app.js"),"utf8"),ui=fs.readFileSync(path.join(root,"../web/organization-blueprint.js"),"utf8");
  for(const table of ["smart_import_dataset_sheets","smart_import_dataset_targets","smart_import_dataset_sheet_reviews"]){assert.match(sql,new RegExp(`CREATE TABLE ${table}`));assert.match(sql,new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));}
  assert.match(sql,/dataset_discovery/);
  assert.match(sql,/smart_import_dataset_sheet_reviews_append_only/);
  assert.match(route,/requireSystemRoles\("owner"\)/);
  assert.match(route,/canonical_commit_allowed:false/);
  assert.doesNotMatch(route,/router\.post\("\/:id\/commit"/);
  assert.doesNotMatch(route,/INSERT INTO (inventory_items|employees|work_orders|finance_transactions)/);
  assert.doesNotMatch(route,/source_data/);
  assert.match(production,/smart_import_dataset_sheets,smart_import_dataset_targets,smart_import_dataset_sheet_reviews/);
  assert.match(app,/\/api\/dataset-discoveries/);
  assert.match(ui,/Canonical commit хаалттай/);
  assert.doesNotMatch(ui,/data-dataset-commit/);
});
