"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const ExcelJS=require("exceljs");
const JSZip=require("jszip");
const {deterministicMapping,parseCsv,parseImportFile,validateRows,summarize,TARGET_FIELDS}=require("../src/services/smart-import");
const {safeSamples}=require("../src/services/openai-smart-import");
const read=relative=>fs.readFileSync(path.join(__dirname,relative),"utf8");

test("employee Smart Import recognizes Mongolian canonical columns",()=>{
  const mapping=deterministicMapping(["Овог нэр","Ажилтны дугаар","Хэлтэс","Албан тушаал","Утас","И-мэйл"]);
  assert.deepEqual(mapping,{"Овог нэр":"fullName","Ажилтны дугаар":"employeeNo","Хэлтэс":"departmentName","Албан тушаал":"positionTitle","Утас":"phone","И-мэйл":"personalEmail"});
});

test("employee Smart Import preserves and normalizes native Excel date cells",()=>{
  const sourceDate=new Date("2024-03-15T00:00:00.000Z");
  const rows=[{rowNumber:2,sourceData:{Name:"Test Employee",Start:sourceDate}}];
  const checked=validateRows(rows,{Name:"fullName",Start:"hireDate"},{});
  assert.equal(checked[0].normalizedData.hireDate,"2024-03-15");
  assert.doesNotMatch(checked[0].validation.warnings.join(" "),/огноо танигдсангүй/);
});

test("employee Smart Import selects the employee sheet from a multi-domain workbook",async()=>{
  const workbook=new ExcelJS.Workbook(),sales=workbook.addWorksheet("Raw_Sales_Delivery"),employees=workbook.addWorksheet("Employee_Master");
  sales.addRow(["Order ID","Sales Amount"]);sales.addRow(["O-1",100]);
  employees.addRow(["Employee ID","Employee Name","Department","Position","Hire Date"]);
  employees.addRow(["E-1","Test Employee","HR","Officer",new Date("2024-03-15T00:00:00.000Z")]);
  const parsed=await parseImportFile(await workbook.xlsx.writeBuffer(),"company.xlsx");
  assert.equal(parsed.sheetName,"Employee_Master");
  assert.equal(parsed.rows.length,1);
  assert.equal(deterministicMapping(parsed.headers)["Employee Name"],"fullName");
});

test("employee Smart Import normalizes x-prefixed SpreadsheetML exports",async()=>{
  const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet("Employee_Master");
  sheet.addRow(["Employee ID","Employee Name"]);sheet.addRow(["E-1","Test Employee"]);
  const zip=await JSZip.loadAsync(await workbook.xlsx.writeBuffer());
  for(const entry of Object.values(zip.files).filter(item=>!item.dir&&/^xl\/.+\.xml$/i.test(item.name))){
    let xml=await entry.async("string");
    xml=xml.replace(/xmlns="http:\/\/schemas\.openxmlformats\.org\/spreadsheetml\/2006\/main"/gu,'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"')
      .replace(/<(\/?)((?![A-Za-z0-9_]+:)[A-Za-z][\w-]*)\b/gu,"<$1x:$2");
    zip.file(entry.name,xml);
  }
  const parsed=await parseImportFile(await zip.generateAsync({type:"nodebuffer"}),"prefixed.xlsx");
  assert.equal(parsed.compatibilityNormalized,true);
  assert.equal(parsed.sheetName,"Employee_Master");
  assert.equal(parsed.rows[0].sourceData["Employee Name"],"Test Employee");
});

test("employee Smart Import validates calendar dates and does not guess ambiguous dates",()=>{
  const rows=[
    {rowNumber:2,sourceData:{Name:"One",Start:"2024-02-29"}},
    {rowNumber:3,sourceData:{Name:"Two",Start:"March 15, 2021"}},
    {rowNumber:4,sourceData:{Name:"Three",Start:"15-Mar-21"}},
    {rowNumber:5,sourceData:{Name:"Four",Start:"03/15/2021"}},
    {rowNumber:6,sourceData:{Name:"Five",Start:"01/02/2024"}},
    {rowNumber:7,sourceData:{Name:"Six",Start:"2024-02-31"}},
  ];
  const checked=validateRows(rows,{Name:"fullName",Start:"hireDate"},{});
  assert.deepEqual(checked.map(row=>row.normalizedData.hireDate),[
    "2024-02-29","2021-03-15","2021-03-15","2021-03-15",null,null,
  ]);
  assert.equal(checked.filter(row=>row.validation.warnings.some(item=>item.includes("огноо"))).length,2);
});

test("CSV parser preserves quoted commas and validation blocks duplicate employee numbers",()=>{
  const matrix=parseCsv('Овог нэр,Ажилтны дугаар,Хэлтэс\r\n"Бат, Болд",A-01,Санхүү\r\nДорж Дулмаа,A-01,Хүний нөөц');
  assert.equal(matrix[1][0],"Бат, Болд");
  const headers=matrix[0],rows=matrix.slice(1).map((values,index)=>({rowNumber:index+2,sourceData:Object.fromEntries(headers.map((h,i)=>[h,values[i]]))}));
  const checked=validateRows(rows,deterministicMapping(headers),{});
  assert.equal(checked[0].status,"warning");
  assert.equal(checked[1].status,"error");
  assert.match(checked[1].validation.errors.join(" "),/давхардсан/);
  assert.equal(summarize(checked,{}).errors,1);
});

test("AI receives masked representative samples and only approved targets",()=>{
  const samples=safeSamples([{sourceData:{Нэр:"Бат Болд",Утас:"99112233",Имэйл:"person@example.com"}}],["Нэр","Утас","Имэйл"]);
  assert.equal(samples[0].Утас,"[phone-or-number]");
  assert.equal(samples[0].Имэйл,"[email]");
  assert.equal(samples[0].Нэр,"[text]");
  assert.ok(TARGET_FIELDS.includes("fullName"));
  assert.ok(!TARGET_FIELDS.includes("password"));
});

test("Smart Import foundation is tenant-scoped, immutable and human-approved",()=>{
  const migration=read("../migrations/0040_smart_import_foundation.sql");
  const route=read("../src/routes/smart-imports.js");
  assert.match(migration,/organization_id UUID NOT NULL/);
  assert.match(migration,/smart_import_events_immutable/);
  assert.match(migration,/hr\.import\.manage/);
  assert.match(read("../scripts/production-migrate.js"),/data_quality_measurements,smart_import_events/);
  assert.match(route,/status!=="approved"/);
  assert.match(route,/loginAccountsCreated:0/);
  assert.match(route,/BEGIN/);
  assert.doesNotMatch(route,/INSERT INTO users/);
  assert.match(route,/source_data='\{\}'::jsonb/);
  assert.doesNotMatch(route,/SELECT row_number,source_data,normalized_data/);
});

test("Smart Import UI exposes temporary storage, review, approval and commit in Mongolian",()=>{
  const ui=read("../../web/administration.js");
  assert.match(ui,/Ухаалаг импорт/);
  assert.match(ui,/түр хадгалалтад/);
  assert.match(ui,/data-import-approve/);
  assert.match(ui,/data-import-commit/);
  assert.match(ui,/хэрэглэгчийн эрх автоматаар үүсэхгүй/);
  assert.match(ui,/Employee ID":"Ажилтны дугаар/);
  assert.match(ui,/fetch failed/i);
});
