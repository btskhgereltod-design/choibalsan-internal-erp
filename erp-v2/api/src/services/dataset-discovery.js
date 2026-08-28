"use strict";

const {loadExcelWorkbook}=require("./excel-workbook");

const MAX_SHEETS=50,MAX_ROWS=5000,MAX_COLUMNS=200;
const ROLES=["source","master","derived","report","instruction","unknown"];

function cellValue(value){
  if(value instanceof Date)return value;
  if(value&&typeof value==="object"){
    if(value.result!==undefined)return value.result;
    if(value.text!==undefined)return value.text;
    if(Array.isArray(value.richText))return value.richText.map(item=>item.text).join("");
  }
  return value??"";
}
function clean(value){return String(value??"").replace(/\s+/g," ").trim();}
function key(value){return clean(value).toLocaleLowerCase("mn-MN").replace(/[._/\\-]+/g," ").replace(/\s+/g," ");}
function valueType(value){if(value instanceof Date)return "date";if(typeof value==="number")return "number";if(typeof value==="boolean")return "boolean";return clean(value)?"text":"blank";}
function sheetRole(name){
  const value=key(name);
  if(/(^| )(raw|source|export|input)( |$)/.test(value))return "source";
  if(/(^| )(master|reference|lookup|catalog)( |$)/.test(value))return "master";
  if(/(^| )(clean|normalized|transformed|staging)( |$)/.test(value))return "derived";
  if(/(^| )(summary|kpi|dashboard|report|pivot)( |$)/.test(value))return "report";
  if(/(^| )(brief|readme|instruction|lesson|guide)( |$)/.test(value))return "instruction";
  return "unknown";
}
function headerRow(sheet,role){
  if(["instruction"].includes(role))return null;
  let best=null;
  for(let number=1;number<=Math.min(sheet.rowCount,20);number+=1){
    const values=sheet.getRow(number).values.slice(1,MAX_COLUMNS+1).map(cellValue).map(clean).filter(Boolean);
    if(values.length<2)continue;
    const unique=new Set(values.map(key)).size,strings=values.filter(value=>Number.isNaN(Number(value))).length;
    const score=unique*4+strings-values.length+(unique===values.length?5:0);
    if(!best||score>best.score)best={number,score};
  }
  return best?.number||null;
}
function profileSheet(sheet,index){
  const role=sheetRole(sheet.name),header=headerRow(sheet,role);
  if(!header)return {sheetIndex:index,sheetName:sheet.name,proposedRole:role,headerRow:null,rowCount:Math.max(0,sheet.rowCount-1),columnCount:sheet.columnCount,truncated:false,columns:[],findings:[]};
  const headers=sheet.getRow(header).values.slice(1,MAX_COLUMNS+1).map(cellValue).map((value,i)=>clean(value)||`Column ${i+1}`);
  const last=Math.min(sheet.rowCount,header+MAX_ROWS),rows=[];
  for(let number=header+1;number<=last;number+=1){const values=sheet.getRow(number).values.slice(1,headers.length+1).map(cellValue);if(values.some(value=>valueType(value)!=="blank"))rows.push(values);}
  const findings=[];
  const duplicateHeaders=headers.length-new Set(headers.map(key)).size;
  if(duplicateHeaders)findings.push({code:"duplicate_headers",severity:"error",count:duplicateHeaders,message:"Баганын нэр давхардсан"});
  const columns=headers.map((name,column)=>{
    const values=rows.map(row=>row[column]),types={date:0,number:0,boolean:0,text:0,blank:0};values.forEach(value=>types[valueType(value)]+=1);
    const nonBlank=values.filter(value=>valueType(value)!=="blank"),normalized=nonBlank.map(value=>key(value)),unique=new Set(normalized).size;
    const activeTypes=Object.entries(types).filter(([type,count])=>type!=="blank"&&count>0).map(([type])=>type);
    if(activeTypes.length>1)findings.push({code:"mixed_types",severity:"warning",column:name,count:nonBlank.length,message:"Нэг баганад олон өгөгдлийн төрөл байна"});
    if(types.blank)findings.push({code:"missing_values",severity:types.blank===rows.length?"warning":"info",column:name,count:types.blank,message:"Хоосон утга байна"});
    return {index:column+1,name,types,nonEmpty:nonBlank.length,empty:types.blank,unique,duplicates:Math.max(0,nonBlank.length-unique)};
  });
  const idColumn=columns.find(column=>/(^| )(order|transaction|invoice|record) id$/.test(key(column.name)));
  if(idColumn?.duplicates)findings.push({code:"duplicate_record_key",severity:"error",column:idColumn.name,count:idColumn.duplicates,message:"Мөрийн гол түлхүүр давхардсан"});
  return {sheetIndex:index,sheetName:sheet.name,proposedRole:role,headerRow:header,rowCount:rows.length,columnCount:headers.length,truncated:sheet.rowCount>last,columns,findings};
}
function targetProposals(sheets){
  const relevant=sheets.filter(sheet=>["source","master","unknown"].includes(sheet.proposedRole));
  const all=relevant.flatMap(sheet=>sheet.columns.map(column=>key(column.name))),has=(...patterns)=>patterns.every(pattern=>all.some(name=>pattern.test(name)));
  const result=[];
  const add=(domainCode,domainName,readiness,rationale,patterns)=>{if(!has(...patterns))return;const sourceSheets=relevant.filter(sheet=>patterns.some(pattern=>sheet.columns.some(column=>pattern.test(key(column.name))))).map(sheet=>sheet.sheetName);result.push({domainCode,domainName,readiness,rationale,sourceSheets:[...new Set(sourceSheets)]});};
  add("inventory-product","Бүтээгдэхүүний мастер","partial_native","Inventory item суурь байгаа ч brand болон list price-ийн governed contract дутуу.",[/product code/,/product name/]);
  add("customer-crm","Харилцагчийн мастер","contract_missing","Customer identity ба CRM canonical contract хэрэгтэй.",[/customer id/,/customer name/]);
  add("sales-order","Борлуулалтын захиалга","contract_missing","Sales order/header-line canonical contract одоогоор байхгүй.",[/order id/,/sales amount/]);
  add("payment","Төлбөр","contract_missing","Sales payment нь finance import-аас тусдаа source/status contract шаарддаг.",[/payment method/,/payment status/]);
  add("delivery","Хүргэлт","contract_missing","Delivery promise, actual date, zone, status-ийн lifecycle contract хэрэгтэй.",[/delivery status/,/delivery zone/]);
  add("complaint","Гомдол, үйлчилгээ","contract_missing","Complaint нь customer/order-той холбогдох canonical lifecycle шаарддаг.",[/complaint/,/complaint type/]);
  return result;
}
async function discoverWorkbook(buffer){
  const loaded=await loadExcelWorkbook(buffer),workbook=loaded.workbook;
  if(!workbook.worksheets.length)throw Object.assign(new Error("Excel файл worksheet агуулаагүй байна"),{code:"DATASET_EMPTY"});
  if(workbook.worksheets.length>MAX_SHEETS)throw Object.assign(new Error(`Workbook ${MAX_SHEETS}-аас олон sheet-тэй байна`),{code:"DATASET_TOO_LARGE"});
  const sheets=workbook.worksheets.map((sheet,index)=>profileSheet(sheet,index+1));
  return {sheets,targets:targetProposals(sheets),summary:{sheetCount:sheets.length,sourceSheets:sheets.filter(x=>x.proposedRole==="source").length,masterSheets:sheets.filter(x=>x.proposedRole==="master").length,derivedSheets:sheets.filter(x=>x.proposedRole==="derived").length,reportSheets:sheets.filter(x=>x.proposedRole==="report").length,instructionSheets:sheets.filter(x=>x.proposedRole==="instruction").length,findings:sheets.reduce((sum,x)=>sum+x.findings.length,0),blockingTargets:targetProposals(sheets).filter(x=>x.readiness==="contract_missing").length,canonicalCommitAllowed:false,compatibilityNormalized:loaded.compatibilityNormalized}};
}

module.exports={MAX_SHEETS,MAX_ROWS,MAX_COLUMNS,ROLES,sheetRole,discoverWorkbook};
