"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {normalizeInterviewAnswer,deterministicNormalization,safetyIdentifier}=require("../src/services/openai-requirements");

const config={ai:{enabled:true,apiKey:"server-side-test-key",model:"gpt-5.6-terra",reasoningEffort:"medium",baseUrl:"https://api.openai.com/v1"}};
const valid={message:"Ойлгосноо батална уу.",understood:["20 ажилтантай"],normalized:{facts:["20 ажилтантай"],signals:["hr","unknown"],classification:"finding",values:[{key:"employeeCount",value:"20"}]},confidence:0.92,clarificationQuestions:[],requiresConfirmation:true};

test("requirements AI uses no-store structured output and pseudonymous safety id",async()=>{
  let request;
  const result=await normalizeInterviewAnswer({config,method:{flow:["elicit","validate"]},question:{code:"ORG-SCALE",stage:"scale",prompt_mn:"Хэмжээ?"},answerText:"20",
    confirmedContext:[],approvedSignals:["hr"],knowledgeUnits:[{code:"scale-evidence",topic:"needs_assessment",title:"Хэмжээ",principle_mn:"Хэмжээг нотолгоотой тогтоо.",decision_rules:["Таамаг бүү нэм"],recommended_artifacts:["evidence_register"]}],organizationId:"org-1",userId:"user-1",fetchImpl:async(_url,options)=>{request=JSON.parse(options.body);return{ok:true,json:async()=>({id:"resp_1",model:"gpt-5.6-terra",output_text:JSON.stringify(valid)})};}});
  assert.equal(request.store,false);
  assert.equal(request.text.format.strict,true);
  assert.equal(request.safety_identifier,safetyIdentifier("org-1","user-1"));
  assert.ok(!JSON.stringify(request).includes("user-1"));
  assert.match(request.instructions,/KNOWLEDGE_UNITS=/);
  assert.match(request.instructions,/not facts about this tenant/);
  assert.match(request.instructions,/untrusted business evidence/);
  assert.match(request.instructions,/scale-evidence/);
  assert.deepEqual(result.normalized.signals,["hr"]);
  assert.equal(result.mode,"ai");
});

test("requirements AI bounds stage knowledge supplied to the model",async()=>{
  let request;
  const units=Array.from({length:12},(_,index)=>({code:`unit-${index}`,topic:"cross_cutting",title:`Unit ${index}`,principle_mn:"Method only"}));
  await normalizeInterviewAnswer({config,method:{},question:{code:"Q",stage:"context",prompt_mn:"?"},answerText:"answer",knowledgeUnits:units,
    approvedSignals:[],organizationId:"org",userId:"user",fetchImpl:async(_url,options)=>{request=JSON.parse(options.body);return{ok:true,json:async()=>({output_text:JSON.stringify({...valid,normalized:{...valid.normalized,signals:[]}})})};}});
  assert.match(request.instructions,/unit-7/);
  assert.doesNotMatch(request.instructions,/unit-8/);
});

test("deterministic fallback is honest and still requires confirmation",()=>{
  const result=deterministicNormalization("Жижиг дэлгүүр");
  assert.equal(result.mode,"deterministic");
  assert.equal(result.requiresConfirmation,true);
  assert.equal(result.confidence,0.5);
});

test("requirements AI never calls provider when disabled",async()=>{
  let called=false;
  const result=await normalizeInterviewAnswer({config:{ai:{enabled:false}},method:{},question:{},answerText:"test",organizationId:"o",userId:"u",fetchImpl:async()=>{called=true;}});
  assert.equal(called,false);
  assert.equal(result.mode,"deterministic");
});
