"use strict";

const { z } = require("zod");
const { TARGET_FIELDS } = require("./smart-import");

const mappingItem = z.object({
  sourceColumn:z.string().min(1).max(250),
  targetField:z.enum(TARGET_FIELDS),
  confidence:z.number().min(0).max(1),
  reason:z.string().max(500),
});
const replySchema = z.object({ mappings:z.array(mappingItem).max(100), warnings:z.array(z.string().max(500)).max(20) });
const strictSchema = {
  type:"object", additionalProperties:false, required:["mappings","warnings"],
  properties:{
    mappings:{ type:"array", items:{ type:"object", additionalProperties:false, required:["sourceColumn","targetField","confidence","reason"], properties:{
      sourceColumn:{type:"string"}, targetField:{type:"string",enum:TARGET_FIELDS}, confidence:{type:"number",minimum:0,maximum:1}, reason:{type:"string"},
    }}},
    warnings:{type:"array",items:{type:"string"}},
  },
};

function extractOutputText(body) {
  if (typeof body.output_text === "string" && body.output_text) return body.output_text;
  for (const item of body.output || []) for (const content of item.content || []) if (content.type === "output_text" && content.text) return content.text;
  throw new Error("OpenAI response did not contain structured output");
}

function maskSample(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (text.includes("@")) return "[email]";
  if (/^[A-Za-zА-Яа-яӨөҮүЁё]{2}\d{8}$/.test(text)) return "[identifier]";
  if (/^\+?\d[\d\s-]{6,}$/.test(text)) return "[phone-or-number]";
  if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(text) || /^\d{1,2}[-/.]\d{1,2}[-/.]\d{4}$/.test(text)) return "[date]";
  if (/^-?\d+(?:[.,]\d+)?$/.test(text)) return "[number]";
  return "[text]";
}

function safeSamples(rows, headers) {
  return rows.slice(0,5).map(row => Object.fromEntries(headers.map(header => [header,maskSample(row.sourceData[header])])));
}

async function suggestImportMapping({ config, headers, rows, fetchImpl=fetch }) {
  if (!config.ai.enabled) { const error=new Error("OVERVA AI is not configured");error.code="AI_NOT_CONFIGURED";throw error; }
  const response = await fetchImpl(`${config.ai.baseUrl}/responses`, {
    method:"POST",
    headers:{ authorization:`Bearer ${config.ai.apiKey}`, "content-type":"application/json" },
    body:JSON.stringify({
      model:config.ai.model, store:false, reasoning:{effort:config.ai.reasoningEffort},
      instructions:`You are OVERVA Smart Import mapping assistant. Map employee spreadsheet columns only to the approved target fields. Do not invent columns, values, employees, departments or positions. Each target field may appear at most once. AI output is advisory and must be human-approved. Approved target fields: ${TARGET_FIELDS.join(", ")}.`,
      input:[{role:"user",content:JSON.stringify({headers,samples:safeSamples(rows,headers)})}],
      text:{format:{type:"json_schema",name:"overva_employee_import_mapping",strict:true,schema:strictSchema}},
    }),
    signal:AbortSignal.timeout(90000),
  });
  const body=await response.json().catch(()=>({}));
  if(!response.ok){const error=new Error(body.error?.message||`OpenAI request failed (${response.status})`);error.code="AI_PROVIDER_ERROR";throw error;}
  const parsed=replySchema.safeParse(JSON.parse(extractOutputText(body)));
  if(!parsed.success){const error=new Error("AI mapping failed OVERVA schema validation");error.code="AI_INVALID_OUTPUT";throw error;}
  const known=new Set(headers),used=new Set();
  const mappings=parsed.data.mappings.filter(item=>known.has(item.sourceColumn)&&!used.has(item.targetField)&&(used.add(item.targetField),true));
  return {mappings,warnings:parsed.data.warnings,providerResponseId:body.id||null,model:body.model||config.ai.model};
}

module.exports={suggestImportMapping,safeSamples,maskSample,replySchema};
