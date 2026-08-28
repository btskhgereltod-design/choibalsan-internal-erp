"use strict";

const ExcelJS=require("exceljs");
const JSZip=require("jszip");

async function normalizeSpreadsheetMlNamespaces(buffer){
  let zip;try{zip=await JSZip.loadAsync(buffer);}catch{return null;}
  let changed=false;
  const entries=Object.values(zip.files).filter(entry=>!entry.dir&&/^xl\/.+\.xml$/i.test(entry.name));
  for(const entry of entries){
    const xml=await entry.async("string");
    if(!/<\/?x:/u.test(xml))continue;
    // Some third-party exporters prefix every SpreadsheetML element with x:.
    // Excel accepts that package, while ExcelJS 4.x does not. Imported values
    // do not need Excel table decorations, so remove tableParts as well; a few
    // exporters emit incomplete table metadata that otherwise breaks loading.
    const normalized=xml
      .replace(/<x:tableParts\b[\s\S]*?<\/x:tableParts>/gu,"")
      .replace(/<x:mergeCells\b[\s\S]*?<\/x:mergeCells>/gu,"")
      .replace(/<(\/?)x:/gu,"<$1")
      .replace(/xmlns:x=/gu,"xmlns=");
    if(normalized!==xml){zip.file(entry.name,normalized);changed=true;}
  }
  return changed?zip.generateAsync({type:"nodebuffer",compression:"DEFLATE"}):null;
}

async function loadExcelWorkbook(buffer){
  const workbook=new ExcelJS.Workbook();
  try{await workbook.xlsx.load(buffer);return {workbook,compatibilityNormalized:false};}
  catch(firstError){
    const normalized=await normalizeSpreadsheetMlNamespaces(buffer);
    if(normalized){
      try{const compatible=new ExcelJS.Workbook();await compatible.xlsx.load(normalized);return {workbook:compatible,compatibilityNormalized:true};}
      catch{/* Return the stable validation error below. */}
    }
    const error=new Error("Excel файлын бүтцийг уншиж чадсангүй. Файлаа Microsoft Excel-ээс .xlsx хэлбэрээр дахин Save As хийгээд оролдоно уу.");
    error.code="IMPORT_FILE_INVALID";error.cause=firstError;throw error;
  }
}

module.exports={loadExcelWorkbook,normalizeSpreadsheetMlNamespaces};
