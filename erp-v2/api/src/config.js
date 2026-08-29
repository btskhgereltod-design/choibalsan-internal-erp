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
  MARKET_EMAIL_ENABLED: z.enum(["true", "false"]).default("false"),
  MARKET_EMAIL_ENDPOINT: z.string().url().optional(),
  MARKET_EMAIL_TOKEN: z.string().min(8).optional(),
  MARKET_EMAIL_FROM: z.string().email().optional(),
  MARKET_APP_URL: z.string().url().default("https://overva.com"),
  MARKET_GOOGLE_OIDC_ENABLED: z.enum(["true", "false"]).default("false"),
  MARKET_GOOGLE_OIDC_CLIENT_ID: z.string().min(5).optional(),
  MARKET_GOOGLE_OIDC_CLIENT_SECRET: z.string().min(8).optional(),
  MARKET_GOOGLE_OIDC_CALLBACK_URL: z.string().url().optional(),
  MARKET_SMS_ENABLED: z.enum(["true", "false"]).default("false"),
  MARKET_SMS_ENDPOINT: z.string().url().optional(),
  MARKET_SMS_TOKEN: z.string().min(8).optional(),
  MARKET_SMS_SENDER: z.string().min(2).max(40).optional(),
  MARKET_PHONE_FINGERPRINT_KEY: z.string().min(32).optional(),
  MARKET_AUTH_TEST_DELIVERY: z.enum(["true", "false"]).default("false"),
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
    MARKET_EMAIL_TOKEN: secretValue(env, "MARKET_EMAIL_TOKEN"),
    MARKET_GOOGLE_OIDC_CLIENT_SECRET: secretValue(env, "MARKET_GOOGLE_OIDC_CLIENT_SECRET"),
    MARKET_SMS_TOKEN: secretValue(env, "MARKET_SMS_TOKEN"),
    MARKET_PHONE_FINGERPRINT_KEY: secretValue(env, "MARKET_PHONE_FINGERPRINT_KEY"),
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
  if (parsed.data.MARKET_EMAIL_ENABLED === "true"
    && (!parsed.data.MARKET_EMAIL_ENDPOINT || !parsed.data.MARKET_EMAIL_TOKEN || !parsed.data.MARKET_EMAIL_FROM)) {
    throw new Error("Invalid OVERVA configuration: enabled Market email requires endpoint, token, and sender");
  }
  if (parsed.data.MARKET_GOOGLE_OIDC_ENABLED === "true"
    && (!parsed.data.MARKET_GOOGLE_OIDC_CLIENT_ID || !parsed.data.MARKET_GOOGLE_OIDC_CLIENT_SECRET
      || !parsed.data.MARKET_GOOGLE_OIDC_CALLBACK_URL)) {
    throw new Error("Invalid OVERVA configuration: enabled Market Google OIDC requires client and callback configuration");
  }
  const marketSmsPlaceholder = [parsed.data.MARKET_SMS_TOKEN, parsed.data.MARKET_PHONE_FINGERPRINT_KEY]
    .some(value => String(value || "").startsWith("__MARKET_"));
  if (parsed.data.MARKET_SMS_ENABLED === "true"
    && (!parsed.data.MARKET_SMS_ENDPOINT || !parsed.data.MARKET_SMS_TOKEN
      || !parsed.data.MARKET_SMS_SENDER || !parsed.data.MARKET_PHONE_FINGERPRINT_KEY
      || marketSmsPlaceholder)) {
    throw new Error("Invalid OVERVA configuration: enabled Market SMS requires endpoint, token, sender, and phone fingerprint key");
  }
  if (parsed.data.NODE_ENV === "production" && [parsed.data.MARKET_APP_URL, parsed.data.MARKET_GOOGLE_OIDC_CALLBACK_URL]
    .filter(Boolean).some(url => !url.startsWith("https://"))) {
    throw new Error("Invalid OVERVA configuration: production Market auth URLs must use HTTPS");
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
    marketAuth: {
      appUrl: parsed.data.MARKET_APP_URL.replace(/\/$/, ""),
      testDelivery: parsed.data.NODE_ENV === "test" && parsed.data.MARKET_AUTH_TEST_DELIVERY === "true",
      email: {
        enabled: parsed.data.MARKET_EMAIL_ENABLED === "true",
        endpoint: parsed.data.MARKET_EMAIL_ENDPOINT || null,
        token: parsed.data.MARKET_EMAIL_TOKEN || null,
        from: parsed.data.MARKET_EMAIL_FROM || null,
      },
      google: {
        enabled: parsed.data.MARKET_GOOGLE_OIDC_ENABLED === "true",
        clientId: parsed.data.MARKET_GOOGLE_OIDC_CLIENT_ID || null,
        clientSecret: parsed.data.MARKET_GOOGLE_OIDC_CLIENT_SECRET || null,
        callbackUrl: parsed.data.MARKET_GOOGLE_OIDC_CALLBACK_URL || null,
      },
      sms: {
        enabled: parsed.data.MARKET_SMS_ENABLED === "true",
        endpoint: parsed.data.MARKET_SMS_ENDPOINT || null,
        token: parsed.data.MARKET_SMS_TOKEN || null,
        sender: parsed.data.MARKET_SMS_SENDER || null,
        fingerprintKey: parsed.data.MARKET_PHONE_FINGERPRINT_KEY || null,
      },
    },
  };
}

module.exports = { loadConfig };
