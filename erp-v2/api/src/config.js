"use strict";

const fs = require("node:fs");
const { z } = require("zod");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4100),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().min(1).default("overva-platform"),
  JWT_AUDIENCE: z.string().min(1).default("overva-web"),
  CORS_ORIGINS: z.string().default("http://localhost:4100"),
  AI_ENABLED: z.enum(["true", "false"]).default("false"),
  OPENAI_API_KEY: z.string().min(20).optional(),
  OPENAI_MODEL: z.string().min(1).default("gpt-5.6-terra"),
  OPENAI_REASONING_EFFORT: z.enum(["none","low","medium","high","xhigh","max"]).default("medium"),
  OPENAI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  CONNECTOR_CALLBACK_BASE_URL: z.string().url().optional(),
  CONNECTOR_APP_URL: z.string().url().optional(),
  CONNECTOR_ENCRYPTION_KEY: z.string().min(32).optional(),
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(5).optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(8).optional(),
  GITHUB_OAUTH_CLIENT_ID: z.string().min(5).optional(),
  GITHUB_OAUTH_CLIENT_SECRET: z.string().min(8).optional(),
});

function secretValue(env, name) {
  if (env[name]) return env[name];
  const file = env[`${name}_FILE`];
  if (!file) return undefined;
  return fs.readFileSync(file, "utf8").trim();
}

function loadConfig(env = process.env) {
  const resolved = {
    ...env,
    DATABASE_URL: secretValue(env, "DATABASE_URL"),
    JWT_SECRET: secretValue(env, "JWT_SECRET"),
    OPENAI_API_KEY: secretValue(env, "OPENAI_API_KEY"),
    CONNECTOR_ENCRYPTION_KEY: secretValue(env, "CONNECTOR_ENCRYPTION_KEY"),
    GOOGLE_OAUTH_CLIENT_SECRET: secretValue(env, "GOOGLE_OAUTH_CLIENT_SECRET"),
    GITHUB_OAUTH_CLIENT_SECRET: secretValue(env, "GITHUB_OAUTH_CLIENT_SECRET"),
  };
  const parsed = schema.safeParse(resolved);
  if (!parsed.success) {
    const details = parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid OVERVA configuration: ${details}`);
  }
  const corsOrigins = parsed.data.CORS_ORIGINS.split(",").map(value => value.trim()).filter(Boolean);
  if (parsed.data.NODE_ENV === "production" && corsOrigins.some(origin => /^http:\/\/(localhost|127\.0\.0\.1)(:|$)/i.test(origin))) {
    throw new Error("Invalid OVERVA configuration: production CORS_ORIGINS cannot contain localhost HTTP origins");
  }
  if (parsed.data.NODE_ENV === "production" && [parsed.data.CONNECTOR_CALLBACK_BASE_URL, parsed.data.CONNECTOR_APP_URL]
    .filter(Boolean).some(url => !url.startsWith("https://"))) {
    throw new Error("Invalid OVERVA configuration: production connector URLs must use HTTPS");
  }
  return {
    ...parsed.data,
    corsOrigins,
    ai: {
      enabled: parsed.data.AI_ENABLED === "true" && Boolean(parsed.data.OPENAI_API_KEY),
      apiKey: parsed.data.OPENAI_API_KEY || null,
      model: parsed.data.OPENAI_MODEL,
      reasoningEffort: parsed.data.OPENAI_REASONING_EFFORT,
      baseUrl: parsed.data.OPENAI_BASE_URL.replace(/\/$/, ""),
    },
    connectors: {
      callbackBaseUrl: parsed.data.CONNECTOR_CALLBACK_BASE_URL?.replace(/\/$/, "") || null,
      appUrl: parsed.data.CONNECTOR_APP_URL?.replace(/\/$/, "") || null,
      encryptionKey: parsed.data.CONNECTOR_ENCRYPTION_KEY || null,
      providers: {
        google: {
          clientId: parsed.data.GOOGLE_OAUTH_CLIENT_ID || null,
          clientSecret: parsed.data.GOOGLE_OAUTH_CLIENT_SECRET || null,
        },
        github: {
          clientId: parsed.data.GITHUB_OAUTH_CLIENT_ID || null,
          clientSecret: parsed.data.GITHUB_OAUTH_CLIENT_SECRET || null,
        },
      },
    },
  };
}

module.exports = { loadConfig };
