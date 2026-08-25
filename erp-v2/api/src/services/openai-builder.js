"use strict";

const { z } = require("zod");

const replySchema = z.object({
  message: z.string().min(1).max(5000),
  stage: z.enum(["goal_scope","as_is","to_be","roles_approvals","data_controls","kpi_reports","integration_nonfunctional","mvp_plan"]),
  understood: z.array(z.string().max(500)).max(20),
  questions: z.array(z.string().max(500)).max(5),
  readyForPlan: z.boolean(),
  proposal: z.object({
    profileCode: z.string().regex(/^[a-z0-9-]{2,80}$/),
    moduleCodes: z.array(z.string().regex(/^[a-z0-9-]{2,80}$/)).max(50),
    reasons: z.array(z.string().max(700)).max(30),
    assumptions: z.array(z.string().max(700)).max(30),
  }).nullable(),
});

const strictSchema = {
  type: "object", additionalProperties: false,
  required: ["message","stage","understood","questions","readyForPlan","proposal"],
  properties: {
    message: { type: "string" },
    stage: { type: "string", enum: ["goal_scope","as_is","to_be","roles_approvals","data_controls","kpi_reports","integration_nonfunctional","mvp_plan"] },
    understood: { type: "array", items: { type: "string" } },
    questions: { type: "array", items: { type: "string" } },
    readyForPlan: { type: "boolean" },
    proposal: {
      anyOf: [
        { type: "null" },
        { type: "object", additionalProperties: false, required: ["profileCode","moduleCodes","reasons","assumptions"], properties: {
          profileCode: { type: "string" }, moduleCodes: { type: "array", items: { type: "string" } },
          reasons: { type: "array", items: { type: "string" } }, assumptions: { type: "array", items: { type: "string" } },
        } },
      ],
    },
  },
};

function systemInstructions(catalog) {
  const safeCatalog = {
    templates: catalog.templates.map(x => ({ code:x.code,name:x.name,description:x.description,maturity:x.maturity,version:x.version })),
    templateModules: catalog.templateModules,
    templateAssets: catalog.templateAssets,
    templateWorkTypes: catalog.templateWorkTypes,
    modules: catalog.modules.map(x => ({ code:x.code,name:x.name,description:x.description,category:x.category,core:x.core })),
  };
  return `You are OVERVA BA AI, a Mongolian-speaking business analyst for configuring an ERP/COP platform.
Follow this discovery sequence: (1) goal, stakeholders and scope; (2) AS-IS workflow and pain; (3) TO-BE workflow;
(4) roles, RACI, approvals and segregation of duties; (5) master data, documents and audit controls;
(6) KPI and reports; (7) integrations, security, offline/mobile and non-functional needs; (8) phased MVP plan.
Ask at most 3 short questions per turn. Reflect what you understood. Do not invent facts.
You may propose ONLY template and module codes in the approved catalog below. Never claim that code, database,
device control, permissions or a production build was applied. A proposal is advisory and must pass OVERVA's
deterministic validator and human approval. Choibalsan Hugjil is only a municipal-infrastructure pilot example,
not the universal core. When evidence is insufficient, keep proposal null and continue discovery.
Approved catalog JSON: ${JSON.stringify(safeCatalog)}`;
}

function extractOutputText(body) {
  if (typeof body.output_text === "string" && body.output_text) return body.output_text;
  for (const item of body.output || []) for (const content of item.content || []) if (content.type === "output_text" && content.text) return content.text;
  throw new Error("OpenAI response did not contain structured output");
}

function extractUsage(body) {
  const usage = body.usage || {};
  const inputTokens = Number(usage.input_tokens || 0);
  const outputTokens = Number(usage.output_tokens || 0);
  return {
    inputTokens,
    cachedInputTokens: Number(usage.input_tokens_details?.cached_tokens || 0),
    outputTokens,
    reasoningTokens: Number(usage.output_tokens_details?.reasoning_tokens || 0),
    totalTokens: Number(usage.total_tokens ?? inputTokens + outputTokens),
  };
}

async function askBuilderAi({ config, catalog, messages, fetchImpl = fetch }) {
  if (!config.ai.enabled) {
    const error = new Error("OVERVA AI is not configured"); error.code = "AI_NOT_CONFIGURED"; throw error;
  }
  const response = await fetchImpl(`${config.ai.baseUrl}/responses`, {
    method: "POST",
    headers: { authorization: `Bearer ${config.ai.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: config.ai.model,
      store: false,
      reasoning: { effort: config.ai.reasoningEffort },
      instructions: systemInstructions(catalog),
      input: messages.map(item => ({ role: item.role, content: item.content })),
      text: { format: { type: "json_schema", name: "overva_builder_reply", strict: true, schema: strictSchema } },
    }),
    signal: AbortSignal.timeout(90000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error?.message || `OpenAI request failed (${response.status})`);
    error.code = "AI_PROVIDER_ERROR"; throw error;
  }
  const parsed = replySchema.safeParse(JSON.parse(extractOutputText(body)));
  if (!parsed.success) { const error = new Error("AI response failed OVERVA schema validation"); error.code = "AI_INVALID_OUTPUT"; throw error; }
  return { ...parsed.data, providerResponseId: body.id || null, model: body.model || config.ai.model, usage:extractUsage(body) };
}

module.exports = { askBuilderAi, replySchema, systemInstructions, extractOutputText, extractUsage };
