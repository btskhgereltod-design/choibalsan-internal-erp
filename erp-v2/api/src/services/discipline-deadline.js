"use strict";

const DAY_MS=24*60*60*1000;
const RULE_VERSION="mn-labour-law-123-2024";
const DEADLINE_CLASSES=new Set(["ordinary","full_property_liability"]);
const SUSPENSION_KINDS=new Set([
  "medical_leave","annual_leave","personal_leave","law_enforcement_investigation",
  "audit_investigation","authorized_body_investigation",
]);

function fail(code){const error=new Error(code);error.code=code;error.status=400;throw error}
function parseDate(value,code="INVALID_DISCIPLINE_DATE"){
  const text=String(value||"");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(text))fail(code);
  const date=new Date(`${text}T00:00:00.000Z`);
  if(Number.isNaN(date.getTime())||date.toISOString().slice(0,10)!==text)fail(code);
  return date;
}
function iso(date){return date.toISOString().slice(0,10)}
function addDays(date,days){return new Date(date.getTime()+days*DAY_MS)}
function addMonths(date,months){
  const year=date.getUTCFullYear(),month=date.getUTCMonth()+months,day=date.getUTCDate();
  const first=new Date(Date.UTC(year,month,1));
  const lastDay=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth(),Math.min(day,lastDay)));
}
function normalizeSuspensions(periods=[]){
  const sorted=periods.map(period=>{
    if(!SUSPENSION_KINDS.has(period.kind))fail("INVALID_DISCIPLINE_SUSPENSION_KIND");
    const start=parseDate(period.startsOn,"INVALID_DISCIPLINE_SUSPENSION_DATE");
    const end=parseDate(period.endsOn,"INVALID_DISCIPLINE_SUSPENSION_DATE");
    if(end<start)fail("INVALID_DISCIPLINE_SUSPENSION_RANGE");
    return {start,end,kind:period.kind,evidenceDocumentId:period.evidenceDocumentId};
  }).sort((a,b)=>a.start-b.start||a.end-b.end);
  const merged=[];
  for(const period of sorted){
    const previous=merged.at(-1);
    if(previous&&period.start<=addDays(previous.end,1)){
      if(period.end>previous.end)previous.end=period.end;
      previous.sources.push({kind:period.kind,startsOn:iso(period.start),endsOn:iso(period.end),evidenceDocumentId:period.evidenceDocumentId});
    }else merged.push({start:period.start,end:period.end,sources:[{kind:period.kind,startsOn:iso(period.start),endsOn:iso(period.end),evidenceDocumentId:period.evidenceDocumentId}]});
  }
  return merged;
}
function suspendedDaysWithin(start,due,periods){
  return periods.reduce((total,period)=>{
    const from=period.start>start?period.start:start,to=period.end<due?period.end:due;
    return from<=to?total+Math.floor((to-from)/DAY_MS)+1:total;
  },0);
}
function extendForSuspensions(start,baseDue,periods){
  let due=baseDue;
  for(let iteration=0;iteration<10000;iteration+=1){
    const next=addDays(baseDue,suspendedDaysWithin(start,due,periods));
    if(next.getTime()===due.getTime())return due;
    due=next;
  }
  fail("DISCIPLINE_SUSPENSION_CALCULATION_DID_NOT_CONVERGE");
}
function computeDisciplineDeadline({occurredOn,discoveredOn,deadlineClass="ordinary",suspensionPeriods=[]}){
  if(!DEADLINE_CLASSES.has(deadlineClass))fail("INVALID_DISCIPLINE_DEADLINE_CLASS");
  const occurred=parseDate(occurredOn),discovered=parseDate(discoveredOn);
  if(discovered<occurred)fail("INVALID_DISCIPLINE_DATES");
  const suspensions=normalizeSuspensions(suspensionPeriods);
  const occurrenceBase=addMonths(occurred,deadlineClass==="full_property_liability"?12:6);
  const discoveryBase=addMonths(discovered,1);
  const occurrenceDue=extendForSuspensions(occurred,occurrenceBase,suspensions);
  const discoveryDue=extendForSuspensions(discovered,discoveryBase,suspensions);
  const decisionDue=occurrenceDue<discoveryDue?occurrenceDue:discoveryDue;
  return {
    decisionDueOn:iso(decisionDue),
    evidence:{ruleVersion:RULE_VERSION,deadlineClass,occurredOn:iso(occurred),discoveredOn:iso(discovered),
      occurrenceBaseDueOn:iso(occurrenceBase),discoveryBaseDueOn:iso(discoveryBase),
      occurrenceDueOn:iso(occurrenceDue),discoveryDueOn:iso(discoveryDue),decisionDueOn:iso(decisionDue),
      suspensionPeriods:suspensions.flatMap(period=>period.sources)},
  };
}
function computeSanctionExpiry(effectiveFrom){return iso(addMonths(parseDate(effectiveFrom,"INVALID_DISCIPLINE_EFFECTIVE_DATE"),12))}

module.exports={RULE_VERSION,computeDisciplineDeadline,computeSanctionExpiry};
