"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { selectBlueprintCatalog } = require("../src/services/organization-blueprint");

const catalog = [
  {code:"core-governance",category:"Суурь",sectors:["all"],signals:[],min_employees:0},
  {code:"core-people",category:"Суурь",sectors:["all"],signals:["hr"],min_employees:5},
  {code:"retail-core",category:"Салбар",sectors:["retail"],signals:[],min_employees:0},
  {code:"healthcare-core",category:"Салбар",sectors:["healthcare"],signals:[],min_employees:0},
  {code:"inventory-procurement",category:"Бизнес",sectors:["all"],signals:["inventory","procurement"],min_employees:0},
  {code:"technology",category:"Дэмжлэг",sectors:["all"],signals:["it"],min_employees:20},
];

test("blueprint recommends only the selected sector and operational needs", () => {
  const selected=selectBlueprintCatalog(catalog,{sector:"retail",employeeCount:3,needs:["inventory"]}).map(x=>x.code);
  assert.deepEqual(selected,["core-governance","retail-core","inventory-procurement"]);
});

test("larger organizations receive people and technology foundations", () => {
  const selected=selectBlueprintCatalog(catalog,{sector:"healthcare",employeeCount:30,needs:[]}).map(x=>x.code);
  assert.deepEqual(selected,["core-governance","core-people","healthcare-core","technology"]);
});

