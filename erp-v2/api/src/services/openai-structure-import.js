"use strict";

const { z } = require("zod");
const { STRUCTURE_FIELDS } = require("./structure-import");
const { safeSamples } = require("./openai-smart-import");

const mappingItem = z.object({
  sourceColumn:z.string().min(1).max(250),
  targetField:z.enum(STRUCTURE_FIELDS),
  confidence:z.number().min(0).max(1),
  reason:z.string().max(500),
});
const replySchema = z.object({ mappings:z.array(mappingItem).max(100), warnings:z.array(z.string().max(500)).max(20) });
const strictSchema = {
  type:"object", additionalProperties:false, required:["mappings", "warnings"],
  properties:{
    mappings:{ type:"array", items:{ type:"object", additionalProperties:false, required:["sourceColumn", "targetField", "confidence", "reason"], properties:{
      sourceColumn:{type:"string"}, targetField:{type:"string", enum:STRUCTURE_FIELDS}, confidence:{type:"number", minimum:0, maximum:1}, reason:{type:"string"},
    }}},
    warnings:{type:"array", items:{type:"string"}},
  },
};

function extractOutputText(body) {
  if (typeof body.output_text === "string" && body.output_text) return body.output_text;
  for (const item of body.output || []) for (const content of item.content || []) if (content.type === "output_text" && content.text) return content.text;
  throw new Error("OpenAI response did not contain structured output");
}

async function suggestStructureMapping({ config, headers, rows, fetchImpl=fetch }) {
  if (!config.ai.enabled) {
    const error = new Error("OVERVA AI is not configured");
    error.code = "AI_NOT_CONFIGURED";
    throw error;
  }
  const response = await fetchImpl(`${config.ai.baseUrl}/responses`, {
    method:"POST",
    headers:{ authorization:`Bearer ${config.ai.apiKey}`, "content-type":"application/json" },
    body:JSON.stringify({
      model:config.ai.model,
      store:false,
      reasoning:{effort:config.ai.reasoningEffort},
      instructions:`You are OVERVA organization-structure Smart Import mapping assistant. Map spreadsheet columns only to approved structure fields. Do not invent units, parent relationships, positions, values or people. Never propose employees, user accounts, login identities, roles, permissions, modules, deletion, deactivation or employee movement. Each target field may appear at most once. AI output is advisory; deterministic validation and primary-admin approval are mandatory. Approved fields: ${STRUCTURE_FIELDS.join(", ")}.`,
      input:[{role:"user", content:JSON.stringify({headers, samples:safeSamples(rows, headers)})}],
      text:{format:{type:"json_schema", name:"overva_structure_import_mapping", strict:true, schema:strictSchema}},
    }),
    signal:AbortSignal.timeout(90000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error?.message || `OpenAI request failed (${response.status})`);
    error.code = "AI_PROVIDER_ERROR";
    throw error;
  }
  const parsed = replySchema.safeParse(JSON.parse(extractOutputText(body)));
  if (!parsed.success) {
    const error = new Error("AI mapping failed OVERVA structure schema validation");
    error.code = "AI_INVALID_OUTPUT";
    throw error;
  }
  const known = new Set(headers), used = new Set();
  const mappings = parsed.data.mappings.filter(item => known.has(item.sourceColumn) && !used.has(item.targetField) && (used.add(item.targetField), true));
  return { mappings, warnings:parsed.data.warnings, providerResponseId:body.id || null, model:body.model || config.ai.model };
}

module.exports = { suggestStructureMapping, replySchema };
