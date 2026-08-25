"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { askBuilderAi, systemInstructions } = require("../src/services/openai-builder");

const catalog = {
  templates: [{ code:"general",name:"Ерөнхий",description:"",maturity:"verified",version:1 }],
  templateModules: [{ template_code:"general",module_code:"hr",recommended:true,enabled_by_default:false }],
  templateAssets: [], templateWorkTypes: [],
  modules: [{ code:"hr",name:"Хүний нөөц",description:"",category:"business",core:false }],
};
const config = { ai:{ enabled:true,apiKey:"test-secret-not-real",model:"gpt-5.6-terra",reasoningEffort:"medium",baseUrl:"https://api.openai.com/v1" } };
const validReply = { message:"Ойлголоо.",stage:"goal_scope",understood:["25 ажилтан"],questions:["Гол зорилго юу вэ?"],readyForPlan:false,proposal:null };

test("BA AI sends no-store strict structured request using only the approved catalog", async () => {
  let captured;
  const result=await askBuilderAi({config,catalog,messages:[{role:"user",content:"25 ажилтантай"}],fetchImpl:async(url,options)=>{
    captured={url,options,body:JSON.parse(options.body)};
    return {ok:true,json:async()=>({id:"resp_test",model:"gpt-5.6-terra",usage:{input_tokens:120,output_tokens:40,total_tokens:160,input_tokens_details:{cached_tokens:80},output_tokens_details:{reasoning_tokens:10}},output_text:JSON.stringify(validReply)})};
  }});
  assert.equal(captured.url,"https://api.openai.com/v1/responses");
  assert.equal(captured.options.headers.authorization,"Bearer test-secret-not-real");
  assert.equal(captured.body.store,false);
  assert.equal(captured.body.text.format.strict,true);
  assert.equal(captured.body.text.format.schema.additionalProperties,false);
  assert.match(captured.body.instructions,/general/);
  assert.match(captured.body.instructions,/ONLY template and module codes/);
  assert.equal(result.providerResponseId,"resp_test");
  assert.deepEqual(result.usage,{inputTokens:120,cachedInputTokens:80,outputTokens:40,reasoningTokens:10,totalTokens:160});
  assert.equal(result.stage,"goal_scope");
});

test("BA AI refuses to run without a server-side key", async () => {
  await assert.rejects(()=>askBuilderAi({config:{ai:{enabled:false}},catalog,messages:[]}),error=>error.code==="AI_NOT_CONFIGURED");
});

test("BA AI rejects provider output outside OVERVA schema", async () => {
  await assert.rejects(()=>askBuilderAi({config,catalog,messages:[],fetchImpl:async()=>({ok:true,json:async()=>({output_text:JSON.stringify({...validReply,stage:"unknown"})})})}),error=>error.code==="AI_INVALID_OUTPUT");
});

test("system prompt makes Choibalsan a pilot, not the universal product", () => {
  const prompt=systemInstructions(catalog);
  assert.match(prompt,/pilot example/);
  assert.match(prompt,/not the universal core/);
  assert.match(prompt,/human approval/);
});
