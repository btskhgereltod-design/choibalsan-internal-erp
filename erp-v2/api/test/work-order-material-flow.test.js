"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {canTransitionMaterial,validateMaterialQuantities}=require("../src/services/work-order-material-flow");

test("material request separates approval, issue, and consumption",()=>{
  assert.equal(canTransitionMaterial("requested","approved"),true);
  assert.equal(canTransitionMaterial("requested","issued"),false);
  assert.equal(canTransitionMaterial("approved","issued"),true);
  assert.equal(canTransitionMaterial("approved","consumed"),false);
  assert.equal(canTransitionMaterial("issued","consumed"),true);
  assert.equal(canTransitionMaterial("issued","partially_consumed"),true);
  assert.equal(canTransitionMaterial("partially_consumed","reconciled"),true);
});

test("terminal material decisions cannot be reopened",()=>{
  for(const state of ["rejected","consumed","reconciled","cancelled"]){
    assert.equal(canTransitionMaterial(state,"approved"),false);
    assert.equal(canTransitionMaterial(state,"issued"),false);
  }
});

test("material quantities cannot grow between stages",()=>{
  assert.equal(validateMaterialQuantities({requested:10,approved:8,issued:8,consumed:8}),true);
  assert.equal(validateMaterialQuantities({requested:10,approved:11,issued:0,consumed:0}),false);
  assert.equal(validateMaterialQuantities({requested:10,approved:8,issued:9,consumed:0}),false);
  assert.equal(validateMaterialQuantities({requested:10,approved:8,issued:8,consumed:9}),false);
  assert.equal(validateMaterialQuantities({requested:10,approved:8,issued:8,consumed:6,returned:2}),true);
  assert.equal(validateMaterialQuantities({requested:10,approved:8,issued:8,consumed:7,returned:2}),false);
});
