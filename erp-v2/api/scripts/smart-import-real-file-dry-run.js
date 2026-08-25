"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  deterministicMapping,
  fileHash,
  parseImportFile,
  summarize,
  validateRows,
} = require("../src/services/smart-import");
const {
  structureMapping,
  structureSummary,
  validateStructureRows,
} = require("../src/services/structure-import");

const inputPath = process.argv[2];
if (!inputPath) {
  throw new Error("Usage: node scripts/smart-import-real-file-dry-run.js <xlsx-or-csv>");
}

const key = value => String(value ?? "").trim().toLocaleLowerCase("mn-MN");
const cloneRows = rows => rows.map(row => ({
  rowNumber:row.rowNumber,
  sourceData:{...row.sourceData},
}));

function countDistinct(rows, column) {
  return new Set(rows.map(row => key(row.sourceData[column])).filter(Boolean)).size;
}

function compactSummary(summary) {
  return {
    total:summary.total,
    ready:summary.ready,
    warnings:summary.warnings,
    errors:summary.errors,
    newDepartmentCount:(summary.newDepartments || []).length,
    newPositionLabelCount:(summary.newPositions || []).length,
  };
}

function fieldDiagnostics(rows) {
  const employeeNos = new Set(), emails = new Set();
  const result = {
    missingFullName:0,
    missingEmployeeNo:0,
    duplicateEmployeeNo:0,
    invalidEmail:0,
    duplicateEmail:0,
    missingDepartment:0,
    missingPosition:0,
    invalidHireDate:0,
  };
  for (const row of rows) {
    const data = row.normalizedData;
    if (!data.fullName || data.fullName.length < 2) result.missingFullName += 1;
    if (!data.employeeNo) result.missingEmployeeNo += 1;
    else {
      const employeeNo = key(data.employeeNo);
      if (employeeNos.has(employeeNo)) result.duplicateEmployeeNo += 1;
      employeeNos.add(employeeNo);
    }
    if (data.personalEmail) {
      const email = key(data.personalEmail);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.personalEmail)) result.invalidEmail += 1;
      if (emails.has(email)) result.duplicateEmail += 1;
      emails.add(email);
    }
    if (!data.departmentName) result.missingDepartment += 1;
    if (!data.positionTitle) result.missingPosition += 1;
    if (row.sourceData.hire_date && !data.hireDate) result.invalidHireDate += 1;
  }
  return result;
}

function manualEmployeeMapping(headers) {
  const preferred = {
    employee_id:"employeeNo",
    full_name:"fullName",
    store_name:"departmentName",
    role:"positionTitle",
    phone:"phone",
    hire_date:"hireDate",
    email:"personalEmail",
  };
  return Object.fromEntries(headers.filter(header => preferred[key(header)]).map(header => [header, preferred[key(header)]]));
}

function structureProjection(rows) {
  const groups = new Map();
  for (const row of rows) {
    const unit = String(row.sourceData.store_name ?? "").trim();
    const position = String(row.sourceData.role ?? "").trim();
    if (!unit || !position) continue;
    const groupKey = `${key(unit)}\u0000${key(position)}`;
    const current = groups.get(groupKey) || {unit, position, count:0};
    current.count += 1;
    groups.set(groupKey, current);
  }
  return [...groups.values()].map((group, index) => ({
    rowNumber:index + 2,
    sourceData:{
      "Unit name":group.unit,
      "Unit type":"store",
      "Position title":group.position,
      "Headcount limit":group.count,
    },
  }));
}

async function main() {
  const before = fs.readFileSync(inputPath);
  const beforeHash = fileHash(before);
  const parsed = await parseImportFile(before, path.basename(inputPath));

  const autoEmployeeMapping = deterministicMapping(parsed.headers);
  const employeeMapping = {...autoEmployeeMapping, ...manualEmployeeMapping(parsed.headers)};
  const checkedEmployees = validateRows(parsed.rows, employeeMapping, {});
  const employeeSummary = summarize(checkedEmployees, {});

  const rawStructureMapping = structureMapping(parsed.headers);
  const rawStructureRows = validateStructureRows(parsed.rows, rawStructureMapping, {});
  const rawStructureSummary = structureSummary(rawStructureRows, {});

  const projected = structureProjection(parsed.rows);
  const projectedHeaders = ["Unit name", "Unit type", "Position title", "Headcount limit"];
  const projectedMapping = structureMapping(projectedHeaders);
  const checkedStructure = validateStructureRows(projected, projectedMapping, {});
  const projectedSummary = structureSummary(checkedStructure, {});

  const broken = cloneRows(parsed.rows);
  if (broken[0]) broken[0].sourceData.full_name = "";
  if (broken[0] && broken[1]) broken[1].sourceData.employee_id = broken[0].sourceData.employee_id;
  if (broken[2]) broken[2].sourceData.email = "not-an-email";
  if (broken[3]) broken[3].sourceData.hire_date = "not-a-date";
  const checkedBroken = validateRows(broken, employeeMapping, {});
  const brokenSummary = summarize(checkedBroken, {});

  const afterHash = fileHash(fs.readFileSync(inputPath));

  assert.equal(beforeHash, afterHash, "Source file changed during dry-run");
  assert.equal(rawStructureSummary.errors, parsed.rows.length, "Wrong import type must not pass as organization structure");
  assert.equal(projectedSummary.errors, 0, "Safe structure projection should validate");
  assert.ok(brokenSummary.errors >= employeeSummary.errors + 3, "Injected hard errors were not blocked");
  assert.ok(brokenSummary.warnings >= employeeSummary.warnings, "Injected date warning was not detected");

  const report = {
    mode:"dry-run-only",
    source:{
      file:path.basename(inputPath),
      sourceUnchanged:beforeHash === afterHash,
      rows:parsed.rows.length,
      columns:parsed.headers.length,
      truncated:parsed.truncated,
    },
    privacy:{rawValuesPrinted:false,productionWrites:0,loginAccountsCreated:0},
    detectedShape:{
      uniqueStores:countDistinct(parsed.rows, "store_name"),
      uniqueRoles:countDistinct(parsed.rows, "role"),
      uniqueCities:countDistinct(parsed.rows, "city"),
    },
    employeeImport:{
      automaticMappedFields:Object.values(autoEmployeeMapping).sort(),
      reviewedMappedFields:Object.values(employeeMapping).sort(),
      summary:compactSummary(employeeSummary),
      fieldDiagnostics:fieldDiagnostics(checkedEmployees),
      ignoredSourceColumns:parsed.headers.filter(header => !employeeMapping[header]),
    },
    wrongImportTypeGuard:{
      automaticMappedFields:Object.values(rawStructureMapping).sort(),
      summary:rawStructureSummary,
      blocked:rawStructureSummary.errors === parsed.rows.length,
    },
    safeStructureProjection:{
      sourceRows:parsed.rows.length,
      projectedRows:projected.length,
      summary:projectedSummary,
    },
    injectedFaults:{
      cases:["missing_full_name", "duplicate_employee_id", "invalid_email", "invalid_hire_date"],
      baseline:compactSummary(employeeSummary),
      afterInjection:compactSummary(brokenSummary),
      fieldDiagnosticsAfterInjection:fieldDiagnostics(checkedBroken),
      blocked:brokenSummary.errors >= employeeSummary.errors + 3,
    },
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
