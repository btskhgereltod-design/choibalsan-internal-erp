"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const target = path.resolve(__dirname, "..", "secrets", "market_phone_fingerprint_key");
const productionEnv = path.resolve(__dirname, "..", ".env.production");
const placeholder = "__MARKET_PHONE_FINGERPRINT_KEY_NOT_CONFIGURED__";

function ensureDisabledDefault() {
  if (!fs.existsSync(productionEnv)) return;
  const content = fs.readFileSync(productionEnv, "utf8");
  if (/^MARKET_SMS_ENABLED=/m.test(content)) return;
  fs.appendFileSync(productionEnv, `${content.endsWith("\n") ? "" : "\n"}MARKET_SMS_ENABLED=false\n`, "utf8");
  console.log("[market SMS] production feature flag added as disabled");
}

ensureDisabledDefault();

fs.mkdirSync(path.dirname(target), { recursive: true });
const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8").trim() : "";
if (current && current !== placeholder) {
  console.log("[market phone key] already configured; unchanged");
  process.exit(0);
}

fs.writeFileSync(target, `${crypto.randomBytes(48).toString("base64url")}\n`, {
  encoding: "utf8",
  mode: 0o600,
});
console.log("[market phone key] generated without printing the secret");
