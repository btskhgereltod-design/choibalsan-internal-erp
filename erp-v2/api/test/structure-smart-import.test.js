"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { structureMapping, validateStructureRows, structureSummary, cycleCodes } = require("../src/services/structure-import");
const { suggestStructureMapping } = require("../src/services/openai-structure-import");
const read = relative => fs.readFileSync(path.join(__dirname, relative), "utf8");

function rows(values) {
  return values.map((sourceData, index) => ({rowNumber:index + 2, sourceData}));
}

test("Structure Smart Import recognizes approved Mongolian columns", () => {
  const mapping = structureMapping(["Нэгжийн код", "Нэгжийн нэр", "Нэгжийн төрөл", "Дээд нэгж", "Албан тушаал", "Шатлал", "Орон тооны тоо"]);
  assert.deepEqual(mapping, {
    "Нэгжийн код":"unitCode", "Нэгжийн нэр":"unitName", "Нэгжийн төрөл":"unitType",
    "Дээд нэгж":"parentUnit", "Албан тушаал":"positionTitle", "Шатлал":"rankLevel", "Орон тооны тоо":"headcountLimit",
  });
});

test("Structure validation accepts one unit with multiple distinct positions", () => {
  const input = rows([
    {Нэгж:"Захиргаа", Төрөл:"department", Албан:"Нягтлан бодогч", Код:"FIN-ACC"},
    {Нэгж:"Захиргаа", Төрөл:"department", Албан:"Хүний нөөцийн ажилтан", Код:"HR-OFFICER"},
  ]);
  const mapping = {Нэгж:"unitName", Төрөл:"unitType", Албан:"positionTitle", Код:"positionCode"};
  const checked = validateStructureRows(input, mapping, {});
  assert.deepEqual(checked.map(item => item.status), ["ready", "ready"]);
  assert.equal(structureSummary(checked).units, 1);
  assert.equal(structureSummary(checked).positions, 2);
});

test("Structure validation blocks missing parents, cycles and unsafe values", () => {
  const mapping = {Нэгж:"unitName", Код:"unitCode", Дээд:"parentUnit", Төрөл:"unitType", Шатлал:"rankLevel", Орон:"headcountLimit"};
  const checked = validateStructureRows(rows([
    {Нэгж:"A", Код:"A", Дээд:"B", Төрөл:"department", Шатлал:"0", Орон:"-1"},
    {Нэгж:"B", Код:"B", Дээд:"A", Төрөл:"unknown", Шатлал:"3"},
    {Нэгж:"C", Код:"C", Дээд:"MISSING", Төрөл:"team", Шатлал:"3"},
  ]), mapping, {});
  assert.match(checked[0].validation.errors.join(" "), /тойрог/);
  assert.match(checked[0].validation.errors.join(" "), /Шатлал/);
  assert.match(checked[0].validation.errors.join(" "), /Орон тоо/);
  assert.match(checked[1].validation.errors.join(" "), /төрөл/);
  assert.match(checked[2].validation.errors.join(" "), /Дээд нэгж/);
  assert.deepEqual([...cycleCodes(new Map([["a", "b"], ["b", "a"], ["c", "a"]]))].sort(), ["a", "b"]);
});

test("Existing structure is skipped only when its canonical meaning matches", () => {
  const mapping = {Нэгж:"unitName", Код:"unitCode", Төрөл:"unitType", Албан:"positionTitle", АлбанКод:"positionCode"};
  const context = {
    units:[{id:"u1", code:"FIN", name:"Санхүү", unit_type_code:"department", parent_id:null}],
    positions:[{code:"ACC", title:"Нягтлан бодогч", department_code:"FIN", department_name:"Санхүү", rank_level:10, headcount_limit:null}],
    jobs:[{code:"ACC", name:"Нягтлан бодогч"}],
  };
  const exact = validateStructureRows(rows([{Нэгж:"Санхүү", Код:"FIN", Төрөл:"department", Албан:"Нягтлан бодогч", АлбанКод:"ACC"}]), mapping, context)[0];
  assert.equal(exact.status, "warning");
  assert.equal(exact.proposedAction, "skip");
  assert.equal(exact.validationState, "warning");
  assert.equal(exact.validation.errors.length, 0);
  const conflict = validateStructureRows(rows([{Нэгж:"Борлуулалт", Код:"FIN", Төрөл:"department"}]), mapping, context)[0];
  assert.equal(conflict.status, "error");
});

test("AI structure mapper sends masked samples, no-store and advisory-only rules", async () => {
  let request;
  const fetchImpl = async (_url, options) => {
    request = JSON.parse(options.body);
    return {ok:true, json:async()=>({id:"resp_1",model:"test-model",output_text:JSON.stringify({mappings:[{sourceColumn:"Нэгж",targetField:"unitName",confidence:0.9,reason:"Header meaning"}],warnings:[]})})};
  };
  const result = await suggestStructureMapping({
    config:{ai:{enabled:true,baseUrl:"https://example.invalid/v1",apiKey:"secret",model:"test-model",reasoningEffort:"low"}},
    headers:["Нэгж"], rows:rows([{Нэгж:"Санхүү"}]), fetchImpl,
  });
  assert.equal(request.store, false);
  assert.match(request.instructions, /advisory/);
  assert.match(request.instructions, /Never propose employees, user accounts/);
  assert.equal(JSON.parse(request.input[0].content).samples[0]["Нэгж"], "[text]");
  assert.equal(result.mappings[0].targetField, "unitName");
});

test("Existing unit with a genuinely new position remains a create proposal", () => {
  const mapping = structureMapping(["Unit name", "Unit code", "Unit type", "Position title", "Position code"]);
  const context = {
    units:[{id:"u1", code:"FIN", name:"Finance", unit_type_code:"department", parent_id:null}],
    positions:[{code:"ACC", title:"Accountant", department_code:"FIN", department_name:"Finance", rank_level:10, headcount_limit:null}],
    jobs:[{code:"ACC", name:"Accountant"}],
  };
  const checked = validateStructureRows(rows([{
    "Unit name":"Finance", "Unit code":"FIN", "Unit type":"department",
    "Position title":"Financial analyst", "Position code":"FIN-ANALYST",
  }]), mapping, context)[0];
  assert.equal(checked.proposedAction, "create");
  assert.equal(checked.validationState, "warning");
  assert.equal(checked.validation.errors.length, 0);
});

test("Structure import route is tenant-isolated, owner-approved and non-destructive", () => {
  const migration = read("../migrations/0041_structure_smart_import.sql");
  const reviewMigration = read("../migrations/0050_smart_import_review_contract.sql");
  const route = read("../src/routes/structure-smart-imports.js");
  assert.match(migration, /organization_structure/);
  assert.match(migration, /structure\.import\.manage/);
  assert.match(route, /requireSystemRoles\("owner"\)/);
  assert.match(route, /status !== "approved"/);
  assert.match(route, /rows\/:rowNumber/);
  assert.match(route, /review_decision='accepted'/);
  assert.match(route, /pending_warnings/);
  assert.match(route, /commit_outcome='rejected'/);
  assert.match(route, /BEGIN/);
  assert.match(route, /source_data='\{\}'::jsonb/);
  assert.doesNotMatch(route, /INSERT INTO employees/);
  assert.doesNotMatch(route, /INSERT INTO users/);
  assert.doesNotMatch(route, /UPDATE departments/);
  assert.doesNotMatch(route, /DELETE FROM departments/);
  assert.match(route, /rolesChanged:0/);
  assert.match(route, /modulesEnabled:0/);
  assert.match(reviewMigration, /proposed_action/);
  assert.match(reviewMigration, /validation_state/);
  assert.match(reviewMigration, /review_decision/);
  assert.match(reviewMigration, /commit_outcome/);
  assert.match(reviewMigration, /CHECK\(review_decision IN\('pending','accepted','corrected','excluded'\)\)/);
});

test("Structure Smart Import UI exposes staging, preview, approval and safety boundary", () => {
  const ui = read("../../web/structure-smart-import.js");
  assert.match(ui, /SMART IMPORT/);
  assert.match(ui, /staging/);
  assert.match(ui, /data-structure-import-approve/);
  assert.match(ui, /data-structure-import-commit/);
  assert.match(ui, /data-structure-import-row-form/);
  assert.match(ui, /decision:"corrected"/);
  assert.match(ui, /data-structure-import-accept/);
  assert.match(ui, /data-structure-import-exclude/);
  assert.match(ui, /row\.proposed_action/);
  assert.match(ui, /row\.validation_state/);
  assert.match(ui, /row\.review_decision/);
  assert.match(ui, /Ажилтан, нэвтрэх эрх, role\/permission, модуль/);
});
