"use strict";

const QUALITY_DIMENSIONS = ["clear","complete","correct","consistent","feasible","testable","traceable"];
const PRIORITY_DIMENSIONS = ["businessValue","customerImpact","risk","compliance","dependency","urgency"];

function answeredCodes(answers) {
  return new Set(answers.filter(item => item.confirmation_status === "confirmed" || item.confirmation_status === "corrected").map(item => item.question_code));
}

function nextInterviewQuestion(questions, answers) {
  const answered = answeredCodes(answers);
  return [...questions]
    .filter(question => question.active !== false && !answered.has(question.code))
    .sort((a,b) => a.sequence_no - b.sequence_no)[0] || null;
}

function requirementQuality(input) {
  const text = String(input.requirementText || "").trim();
  const acceptance = Array.isArray(input.acceptanceCriteria) ? input.acceptanceCriteria.filter(Boolean) : [];
  const traceability = input.traceability && Object.keys(input.traceability).length > 0;
  const checks = {
    clear: text.length >= 20 && !/\b(etc|something|somehow)\b/i.test(text),
    complete: Boolean(input.businessNeed && text && input.owner),
    correct: input.evidenceConfirmed === true,
    consistent: input.conflictCount === 0,
    feasible: input.feasibilityReviewed === true,
    testable: acceptance.length > 0,
    traceable: Boolean(traceability),
  };
  return { checks, passed: QUALITY_DIMENSIONS.every(code => checks[code]), missing: QUALITY_DIMENSIONS.filter(code => !checks[code]) };
}

function priorityScore(dimensions) {
  const values = Object.fromEntries(PRIORITY_DIMENSIONS.map(code => [code, Math.max(0,Math.min(5,Number(dimensions?.[code] || 0)))]));
  const effort = Math.max(1,Math.min(5,Number(dimensions?.effort || 3)));
  const weighted = values.businessValue*3 + values.customerImpact*2 + values.risk*2 + values.compliance*3 + values.dependency + values.urgency*2;
  return { values:{...values,effort}, score:Math.round((weighted/effort)*100)/100 };
}

module.exports = { QUALITY_DIMENSIONS, PRIORITY_DIMENSIONS, nextInterviewQuestion, requirementQuality, priorityScore };
