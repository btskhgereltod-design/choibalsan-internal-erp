"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {RULE_VERSION,computeDisciplineDeadline,computeSanctionExpiry}=require("../src/services/discipline-deadline");

test("article 123 ordinary deadline is the earlier of six months from violation and one month from discovery",()=>{
  const result=computeDisciplineDeadline({occurredOn:"2026-01-01",discoveredOn:"2026-03-10",deadlineClass:"ordinary"});
  assert.equal(result.decisionDueOn,"2026-04-10");
  assert.equal(result.evidence.occurrenceDueOn,"2026-07-01");
  assert.equal(result.evidence.ruleVersion,RULE_VERSION);
});

test("article 123 full property liability changes only the occurrence limit to one year",()=>{
  const result=computeDisciplineDeadline({occurredOn:"2026-01-01",discoveredOn:"2026-12-20",deadlineClass:"full_property_liability"});
  assert.equal(result.evidence.occurrenceDueOn,"2027-01-01");
  assert.equal(result.evidence.discoveryDueOn,"2027-01-20");
  assert.equal(result.decisionDueOn,"2027-01-01");
});

test("article 123 suspensions merge overlaps and stop both statutory clocks",()=>{
  const result=computeDisciplineDeadline({occurredOn:"2026-01-01",discoveredOn:"2026-03-10",deadlineClass:"ordinary",suspensionPeriods:[
    {kind:"annual_leave",startsOn:"2026-03-20",endsOn:"2026-03-24",evidenceDocumentId:"11111111-1111-4111-8111-111111111111"},
    {kind:"audit_investigation",startsOn:"2026-03-23",endsOn:"2026-03-26",evidenceDocumentId:"22222222-2222-4222-8222-222222222222"},
  ]});
  assert.equal(result.decisionDueOn,"2026-04-17");
  assert.equal(result.evidence.suspensionPeriods.length,2);
});

test("article 123 expiry is one calendar year from imposition",()=>{
  assert.equal(computeSanctionExpiry("2024-02-29"),"2025-02-28");
});

test("invalid suspension evidence fails closed",()=>{
  assert.throws(()=>computeDisciplineDeadline({occurredOn:"2026-01-01",discoveredOn:"2026-01-02",suspensionPeriods:[
    {kind:"annual_leave",startsOn:"2026-02-02",endsOn:"2026-02-01"},
  ]}),/INVALID_DISCIPLINE_SUSPENSION_RANGE/);
});
