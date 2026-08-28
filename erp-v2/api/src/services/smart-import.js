"use strict";

const crypto = require("node:crypto");
const {loadExcelWorkbook}=require("./excel-workbook");

const MAX_ROWS = 5000;
const MAX_COLUMNS = 100;
const TARGET_FIELDS = Object.freeze([
  "fullName","employeeNo","departmentName","positionTitle","phone","personalEmail",
  "hireDate","gender","workCondition","education","contractType","contractNo","contractEnd",
]);

const aliases = {
  fullName:["овог нэр","овог нэрс","нэр","ажилтан","ажилтны нэр","fullname","full name","employee","employee name"],
  employeeNo:["ажилтны дугаар","ажилтны код","табель","employee no","employee number","employee id","staff id"],
  departmentName:["хэлтэс","алба","нэгж","тасаг","department","unit","division"],
  positionTitle:["албан тушаал","ажлын байр","мэргэжил","position","job title","title"],
  phone:["утас","утасны дугаар","phone","mobile","telephone"],
  personalEmail:["и-мэйл","и мэйл","имэйл","email","e-mail","e mail","хувийн имэйл"],
  hireDate:["ажилд орсон","ажилд орсон огноо","томилогдсон огноо","hire date","start date","joined date"],
  gender:["хүйс","gender","sex"],
  workCondition:["ажлын нөхцөл","хөдөлмөрийн нөхцөл","work condition"],
  education:["боловсрол","education","qualification"],
  contractType:["гэрээний төрөл","contract type","employment type"],
  contractNo:["гэрээний дугаар","гэрээ №","contract no","contract number"],
  contractEnd:["гэрээ дуусах","гэрээний дуусах огноо","contract end","contract expiry"],
};

function clean(value) {
  return String(value ?? "").replace(/^\uFEFF/, "").replace(/\s+/g, " ").trim();
}

function headerKey(value) {
  return clean(value).toLocaleLowerCase("mn-MN").replace(/[._/\\-]+/g, " ").replace(/\s+/g, " ");
}

function deterministicMapping(headers) {
  const mapping = {};
  const used = new Set();
  for (const header of headers) {
    const key = headerKey(header);
    for (const target of TARGET_FIELDS) {
      if (!used.has(target) && aliases[target].includes(key)) {
        mapping[header] = target;
        used.add(target);
        break;
      }
    }
  }
  return mapping;
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  const input = String(text).replace(/^\uFEFF/, "");
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === '"') {
      if (quoted && input[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && input[index + 1] === "\n") index += 1;
      row.push(cell); cell = "";
      if (row.some(value => clean(value))) rows.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell);
  if (row.some(value => clean(value))) rows.push(row);
  return rows;
}

function cellValue(value) {
  if (value && typeof value === "object" && !(value instanceof Date)) {
    if (value.text !== undefined) return value.text;
    if (value.result !== undefined) return value.result;
    if (Array.isArray(value.richText)) return value.richText.map(item => item.text).join("");
  }
  return value ?? "";
}

async function parseImportFile(buffer, filename) {
  const lower = String(filename).toLowerCase();
  let matrix,sheetName=null,compatibilityNormalized=false;
  if (lower.endsWith(".csv")) matrix = parseCsv(buffer.toString("utf8"));
  else if (lower.endsWith(".xlsx")) {
    const loaded=await loadExcelWorkbook(buffer),workbook=loaded.workbook;compatibilityNormalized=loaded.compatibilityNormalized;
    const candidates=workbook.worksheets.map((sheet,index)=>{const values=[];sheet.eachRow({includeEmpty:false},row=>values.push(row.values.slice(1).map(cellValue)));const headers=(values[0]||[]).map(clean),mapping=deterministicMapping(headers),targets=new Set(Object.values(mapping));const score=targets.size+(targets.has("fullName")?20:0)+(targets.has("employeeNo")?5:0)+(/employee|staff|ажилтан|хүний нөөц|hr/i.test(sheet.name)?4:0);return {sheet,index,values,score};}).filter(item=>item.values.length>=2);
    if(!candidates.length)throw Object.assign(new Error("Excel файл өгөгдөлтэй worksheet агуулаагүй байна"),{code:"IMPORT_FILE_INVALID"});
    candidates.sort((a,b)=>b.score-a.score||a.index-b.index);matrix=candidates[0].values;sheetName=candidates[0].sheet.name;
  } else throw Object.assign(new Error("Зөвхөн .xlsx эсвэл .csv файл оруулна уу"), { code:"IMPORT_FILE_TYPE" });
  if (matrix.length < 2) throw Object.assign(new Error("Файл толгой мөр болон дор хаяж нэг өгөгдлийн мөртэй байна"), { code:"IMPORT_FILE_EMPTY" });
  const rawHeaders = matrix[0].slice(0, MAX_COLUMNS).map(clean);
  const headers = rawHeaders.map((value,index) => value || `Багана ${index + 1}`);
  if (new Set(headers.map(headerKey)).size !== headers.length) throw Object.assign(new Error("Баганын нэр давхардсан байна"), { code:"IMPORT_HEADER_DUPLICATE" });
  const rows = matrix.slice(1, MAX_ROWS + 1).map((values,index) => ({
    rowNumber:index + 2,
    sourceData:Object.fromEntries(headers.map((header,column) => [header, cellValue(values[column])])),
  })).filter(item => Object.values(item.sourceData).some(value => clean(value)));
  if (!rows.length) throw Object.assign(new Error("Импортлох өгөгдөл олдсонгүй"), { code:"IMPORT_FILE_EMPTY" });
  return { headers, rows, truncated:matrix.length - 1 > MAX_ROWS, sheetName, compatibilityNormalized };
}

function isoDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0,10);
  const text = clean(value);
  if (!text) return null;
  const validDate = (year,month,day) => {
    const y=Number(year),m=Number(month),d=Number(day);
    if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d) || y < 1900 || y > 2200) return null;
    const date=new Date(Date.UTC(y,m-1,d));
    if (date.getUTCFullYear()!==y || date.getUTCMonth()!==m-1 || date.getUTCDate()!==d) return null;
    return `${String(y).padStart(4,"0")}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
  };
  let match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (match) return validDate(match[1],match[2],match[3]);
  match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (match) {
    const first=Number(match[1]),second=Number(match[2]);
    // Infer only when the value itself proves the order. 01/02/2024 is
    // intentionally left for human review instead of silently swapping day/month.
    if (first > 12 && second <= 12) return validDate(match[3],second,first);
    if (second > 12 && first <= 12) return validDate(match[3],first,second);
    return null;
  }
  const months={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
  match=text.match(/^(\d{1,2})[- ]([A-Za-z]{3,9})[- ](\d{2}|\d{4})$/);
  if (match) {
    const month=months[match[2].slice(0,3).toLowerCase()];
    const year=match[3].length===2 ? (Number(match[3])<=69?2000:1900)+Number(match[3]) : Number(match[3]);
    return month ? validDate(year,month,match[1]) : null;
  }
  match=text.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})$/);
  if (match) {
    const month=months[match[1].slice(0,3).toLowerCase()];
    return month ? validDate(match[3],month,match[2]) : null;
  }
  return null;
}

function normalizedRow(sourceData, mapping) {
  const value = {};
  for (const [source,target] of Object.entries(mapping || {})) {
    if (!TARGET_FIELDS.includes(target) || !(source in sourceData)) continue;
    // ExcelJS returns date cells as Date objects. Preserve them until isoDate()
    // normalizes the value; converting them to text here loses valid Excel dates.
    value[target] = target === "hireDate" || target === "contractEnd"
      ? sourceData[source]
      : clean(sourceData[source]);
  }
  value.fullName = clean(value.fullName);
  value.employeeNo = clean(value.employeeNo) || null;
  value.departmentName = clean(value.departmentName) || null;
  value.positionTitle = clean(value.positionTitle) || null;
  value.phone = clean(value.phone) || null;
  value.personalEmail = clean(value.personalEmail).toLowerCase() || null;
  value.hireDate = isoDate(value.hireDate);
  value.contractEnd = isoDate(value.contractEnd);
  return value;
}

function validateRows(rows, mapping, existing = {}) {
  const employeeNos = new Set((existing.employeeNos || []).map(headerKey));
  const emails = new Set((existing.emails || []).map(headerKey));
  const batchNos = new Set(), batchEmails = new Set();
  return rows.map(row => {
    const data = normalizedRow(row.sourceData, mapping);
    const errors = [], warnings = [];
    if (!data.fullName || data.fullName.length < 2) errors.push("Ажилтны овог нэр байхгүй");
    if (data.personalEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.personalEmail)) errors.push("И-мэйл буруу форматтай");
    if (data.employeeNo) {
      const key = headerKey(data.employeeNo);
      if (employeeNos.has(key)) errors.push("Ажилтны дугаар системд бүртгэлтэй");
      if (batchNos.has(key)) errors.push("Ажилтны дугаар файл дотор давхардсан");
      batchNos.add(key);
    } else warnings.push("Ажилтны дугаар байхгүй");
    if (data.personalEmail) {
      const key = headerKey(data.personalEmail);
      if (emails.has(key)) warnings.push("И-мэйл системд бүртгэлтэй");
      if (batchEmails.has(key)) warnings.push("И-мэйл файл дотор давхардсан");
      batchEmails.add(key);
    }
    if (!data.departmentName) warnings.push("Хэлтэс оноогоогүй");
    if (!data.positionTitle) warnings.push("Албан тушаал оноогоогүй");
    if ((mapping.hireDate || Object.values(mapping).includes("hireDate")) && !data.hireDate) warnings.push("Ажилд орсон огноо танигдсангүй");
    return { ...row, normalizedData:data, validation:{ errors,warnings }, status:errors.length?"error":warnings.length?"warning":"ready" };
  });
}

function summarize(rows, existing = {}) {
  const existingDepartments = new Set((existing.departments || []).map(headerKey));
  const existingPositions = new Set((existing.positions || []).map(headerKey));
  const departments = new Set(), positions = new Set();
  rows.forEach(row => {
    if (row.normalizedData.departmentName && !existingDepartments.has(headerKey(row.normalizedData.departmentName))) departments.add(row.normalizedData.departmentName);
    if (row.normalizedData.positionTitle && !existingPositions.has(headerKey(row.normalizedData.positionTitle))) positions.add(row.normalizedData.positionTitle);
  });
  return {
    total:rows.length,
    ready:rows.filter(row => row.status === "ready").length,
    warnings:rows.filter(row => row.status === "warning").length,
    errors:rows.filter(row => row.status === "error").length,
    newDepartments:[...departments], newPositions:[...positions],
  };
}

function fileHash(buffer) { return crypto.createHash("sha256").update(buffer).digest("hex"); }
function stableCode(prefix, value) { return `${prefix}-${crypto.createHash("sha1").update(clean(value).toLowerCase()).digest("hex").slice(0,10).toUpperCase()}`; }

module.exports = { MAX_ROWS, MAX_COLUMNS, TARGET_FIELDS, deterministicMapping, parseCsv, parseImportFile, normalizedRow, validateRows, summarize, fileHash, stableCode, headerKey };
