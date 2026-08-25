"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { nextInterviewQuestion, requirementQuality, priorityScore } = require("../src/services/requirements-method");

test("interview asks only the next unanswered question", () => {
  const questions=[{code:"B",sequence_no:2,active:true},{code:"A",sequence_no:1,active:true},{code:"C",sequence_no:3,active:true}];
  const answers=[{question_code:"A",confirmation_status:"confirmed"},{question_code:"B",confirmation_status:"pending"}];
  assert.equal(nextInterviewQuestion(questions,answers).code,"B");
});

test("requirement cannot pass quality gate without confirmed evidence and acceptance criteria", () => {
  const result=requirementQuality({requirementText:"System must keep a complete employee history.",businessNeed:"Compliant HR records",owner:"HR",conflictCount:0,feasibilityReviewed:true,traceability:{answerId:"1"}});
  assert.equal(result.passed,false);
  assert.deepEqual(result.missing,["correct","testable"]);
});

test("requirement passes all seven quality dimensions", () => {
  const result=requirementQuality({requirementText:"Authorized HR users shall retrieve the employee history by employee ID.",businessNeed:"Reliable employee records",owner:"HR",evidenceConfirmed:true,conflictCount:0,feasibilityReviewed:true,acceptanceCriteria:["Given an active employee, history is returned"],traceability:{answerId:"1"}});
  assert.equal(result.passed,true);
});

test("priority score rewards value and risk while accounting for effort", () => {
  const high=priorityScore({businessValue:5,customerImpact:5,risk:5,compliance:5,dependency:3,urgency:5,effort:2});
  const low=priorityScore({businessValue:2,customerImpact:1,risk:1,compliance:0,dependency:1,urgency:1,effort:5});
  assert.ok(high.score>low.score);
});
