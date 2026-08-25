"use strict";

const { stableCode } = require("./smart-import");

const STRUCTURE_FIELDS = Object.freeze([
  "unitCode", "unitName", "unitType", "parentUnit",
  "positionCode", "positionTitle", "rankLevel", "headcountLimit",
]);
const UNIT_TYPES = new Set([
  "organization", "branch", "division", "department", "section",
  "team", "site", "store", "project", "facility",
]);
const aliases = {
  unitCode:["нэгжийн код", "хэлтсийн код", "unit code", "department code", "код"],
  unitName:["нэгжийн нэр", "хэлтсийн нэр", "алба нэгж", "unit name", "department name", "хэлтэс", "нэгж"],
  unitType:["нэгжийн төрөл", "төрөл", "unit type", "department type"],
  parentUnit:["дээд нэгж", "харьяа нэгж", "эцэг нэгж", "parent unit", "parent department", "parent"],
  positionCode:["албан тушаалын код", "орон тооны код", "position code", "job code"],
  positionTitle:["албан тушаал", "орон тоо", "position title", "position", "job title"],
  rankLevel:["шатлал", "түвшин", "зэрэглэл", "rank level", "rank"],
  headcountLimit:["орон тооны тоо", "батлагдсан орон тоо", "headcount", "headcount limit"],
};

const clean = value => String(value ?? "").replace(/^\uFEFF/, "").replace(/\s+/g, " ").trim();
const key = value => clean(value).toLocaleLowerCase("mn-MN");
const headerKey = value => key(value).replace(/[._/\\()-]+/g, " ").replace(/\s+/g, " ");

function structureMapping(headers) {
  const result = {}, used = new Set();
  for (const header of headers) {
    const normalized = headerKey(header);
    for (const field of STRUCTURE_FIELDS) {
      if (!used.has(field) && aliases[field].includes(normalized)) {
        result[header] = field;
        used.add(field);
        break;
      }
    }
  }
  return result;
}

function numberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeStructureRows(rows, mapping) {
  return rows.map(row => {
    const value = {};
    for (const [source, target] of Object.entries(mapping || {})) {
      if (STRUCTURE_FIELDS.includes(target) && source in row.sourceData) value[target] = clean(row.sourceData[source]);
    }
    value.unitName = clean(value.unitName);
    value.unitCode = value.unitName ? clean(value.unitCode || stableCode("UNIT", value.unitName)).toUpperCase() : "";
    value.unitType = key(value.unitType || "department");
    value.parentUnit = clean(value.parentUnit);
    value.positionTitle = clean(value.positionTitle);
    value.positionCode = value.positionTitle
      ? clean(value.positionCode || stableCode("POS", `${value.unitCode}:${value.positionTitle}`)).toUpperCase()
      : "";
    value.rankLevel = numberOrNull(value.rankLevel) ?? 10;
    value.headcountLimit = numberOrNull(value.headcountLimit);
    return { ...row, normalizedData:value };
  });
}

function cycleCodes(parentByCode) {
  const result = new Set(), done = new Set();
  function visit(code, path=[], pathIndex=new Map()) {
    if (done.has(code)) return;
    if (pathIndex.has(code)) {
      for (let index=pathIndex.get(code); index<path.length; index+=1) result.add(path[index]);
      result.add(code);
      return;
    }
    const nextPath = [...path, code], nextIndex = new Map(pathIndex).set(code, path.length);
    const parent = parentByCode.get(code);
    if (parent && parentByCode.has(parent)) visit(parent, nextPath, nextIndex);
    done.add(code);
  }
  for (const code of parentByCode.keys()) visit(code);
  return result;
}

function sameRequestedParent(value, existingUnit, unitLookup) {
  if (!value.parentUnit) return !existingUnit.parent_id;
  const requested = unitLookup.get(key(value.parentUnit));
  const requestedCode = key(requested?.code || value.parentUnit);
  return requestedCode === key(existingUnit.parent_code || existingUnit.parent_name || "");
}

function validateStructureRows(rows, mapping, context={}) {
  const normalized = normalizeStructureRows(rows, mapping);
  const existingUnits = new Map();
  for (const unit of context.units || []) {
    existingUnits.set(key(unit.code), unit);
    existingUnits.set(key(unit.name), unit);
  }
  const existingPositions = new Map((context.positions || []).map(item => [key(item.code), item]));
  const existingJobs = new Map((context.jobs || []).map(item => [key(item.code), item]));
  const proposedUnits = new Map(), proposedNames = new Map(), unitLookup = new Map(), duplicateUnitCodes = new Set(), duplicateUnitNames = new Set();
  for (const row of normalized) {
    const value = row.normalizedData;
    if (!value.unitName) continue;
    const code = key(value.unitCode), prior = proposedUnits.get(code);
    if (!prior) proposedUnits.set(code, value);
    else if (key(prior.unitName) !== key(value.unitName) || prior.unitType !== value.unitType || key(prior.parentUnit) !== key(value.parentUnit)) duplicateUnitCodes.add(code);
    const nameKey = key(value.unitName), priorName = proposedNames.get(nameKey);
    if (!priorName) proposedNames.set(nameKey, value);
    else if (key(priorName.unitCode) !== code) duplicateUnitNames.add(nameKey);
  }
  for (const value of proposedUnits.values()) {
    unitLookup.set(key(value.unitCode), value);
    unitLookup.set(key(value.unitName), value);
  }
  for (const unit of context.units || []) {
    if (!unitLookup.has(key(unit.code))) unitLookup.set(key(unit.code), unit);
    if (!unitLookup.has(key(unit.name))) unitLookup.set(key(unit.name), unit);
  }
  const parentByCode = new Map();
  for (const value of proposedUnits.values()) {
    if (!value.parentUnit) continue;
    const parent = unitLookup.get(key(value.parentUnit));
    parentByCode.set(key(value.unitCode), key(parent?.code || value.parentUnit));
  }
  const cycles = cycleCodes(parentByCode), seenPositions = new Set();

  return normalized.map(row => {
    const value = row.normalizedData, errors = [], warnings = [];
    if (!value.unitName) errors.push("Нэгжийн нэр заавал шаардлагатай");
    if (value.unitName && !UNIT_TYPES.has(value.unitType)) errors.push("Нэгжийн төрөл зөвшөөрөгдсөн ангилал биш");
    if (duplicateUnitCodes.has(key(value.unitCode))) errors.push("Нэгжийн код файл дотор зөрүүтэй давхардсан");
    if (duplicateUnitNames.has(key(value.unitName))) errors.push("Нэгжийн нэр файл дотор өөр кодоор давхардсан");
    if (value.parentUnit && [key(value.unitCode), key(value.unitName)].includes(key(value.parentUnit))) errors.push("Нэгж өөрөө өөрийнхөө дээд нэгж байж болохгүй");
    if (cycles.has(key(value.unitCode))) errors.push("Бүтцэд тойрог хамаарал илэрсэн");
    if (value.parentUnit && !unitLookup.has(key(value.parentUnit))) errors.push("Дээд нэгж файл эсвэл одоогийн бүтцээс олдсонгүй");
    if (!Number.isInteger(value.rankLevel) || value.rankLevel < 1 || value.rankLevel > 20) errors.push("Шатлал 1-20 бүхэл тоо байна");
    if (value.headcountLimit !== null && (!Number.isInteger(value.headcountLimit) || value.headcountLimit < 1)) errors.push("Орон тооны хязгаар эерэг бүхэл тоо байна");

    const existingByCode = existingUnits.get(key(value.unitCode)), existingByName = existingUnits.get(key(value.unitName));
    if (existingByName && key(existingByName.code) !== key(value.unitCode)) errors.push("Одоогийн нэгжийн нэр өөр кодтой бүртгэлтэй байна");
    const existingUnit = existingByCode;
    if (existingUnit) {
      if (key(existingUnit.name) !== key(value.unitName)) errors.push("Одоогийн нэгжийн код өөр нэртэй байна");
      if (existingUnit.unit_type_code && existingUnit.unit_type_code !== value.unitType) errors.push("Одоогийн нэгжийн төрөл импортын утгатай зөрж байна");
      if (!sameRequestedParent(value, existingUnit, unitLookup)) errors.push("Одоогийн нэгжийн дээд нэгж импортын утгатай зөрж байна");
      if (!errors.length) warnings.push("Одоогийн нэгжийг дахин үүсгэхгүй");
    }

    let existingPosition = null;
    if (value.positionTitle) {
      const positionKey = key(value.positionCode);
      if (seenPositions.has(positionKey)) errors.push("Албан тушаалын код файл дотор давхардсан");
      seenPositions.add(positionKey);
      existingPosition = existingPositions.get(positionKey);
      const existingJob = existingJobs.get(positionKey);
      if (existingPosition && key(existingPosition.title) !== key(value.positionTitle)) errors.push("Одоогийн орон тооны код өөр нэртэй байна");
      if (existingPosition && key(existingPosition.department_code) !== key(value.unitCode) && key(existingPosition.department_name) !== key(value.unitName)) errors.push("Одоогийн орон тоо өөр нэгжид харьяалагдаж байна");
      if (existingPosition && (Number(existingPosition.rank_level) !== value.rankLevel || Number(existingPosition.headcount_limit || 0) !== Number(value.headcountLimit || 0))) errors.push("Одоогийн орон тооны шатлал эсвэл хязгаар импортын утгатай зөрж байна");
      if (existingJob && key(existingJob.name) !== key(value.positionTitle)) errors.push("Одоогийн ажлын байрны код өөр нэртэй байна");
      if (existingPosition && !errors.length) warnings.push("Одоогийн орон тоог дахин үүсгэхгүй");
    }
    const proposedAction = !errors.length && existingUnit && (!value.positionTitle || existingPosition) ? "skip" : "create";
    return {
      ...row,
      validation:{ errors, warnings },
      status:errors.length ? "error" : warnings.length ? "warning" : "ready",
      proposedAction,
      validationState:errors.length ? "error" : warnings.length ? "warning" : "valid",
    };
  });
}

function structureSummary(rows, context={}) {
  const units = new Set(), positions = new Set();
  for (const row of rows) {
    const value = row.normalizedData;
    if (value.unitName) units.add(key(value.unitCode));
    if (value.positionTitle) positions.add(key(value.positionCode));
  }
  return {
    total:rows.length,
    ready:rows.filter(row => row.status === "ready").length,
    warnings:rows.filter(row => row.status === "warning").length,
    errors:rows.filter(row => row.status === "error").length,
    units:units.size,
    positions:positions.size,
    existingUnits:(context.units || []).length,
    existingPositions:(context.positions || []).length,
  };
}

module.exports = { STRUCTURE_FIELDS, UNIT_TYPES, structureMapping, normalizeStructureRows, validateStructureRows, structureSummary, cycleCodes };
