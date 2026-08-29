"use strict";

const crypto = require("node:crypto");
const { loadConfig } = require("../config");

function normalizePhone(value) {
  const compact = String(value || "").trim().replace(/[\s().-]/g, "");
  const normalized = /^\d{8}$/.test(compact) ? `+976${compact}` : compact;
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
    throw Object.assign(new Error("Valid international phone number is required"), {
      code: "MARKET_PHONE_INVALID",
      status: 400,
    });
  }
  return normalized;
}

function phoneParts(phone) {
  const match = phone.match(/^(\+[1-9]\d{0,2})(\d{4,12})$/);
  if (!match) throw new Error("Invalid normalized phone number");
  return { countryCode: match[1], lastFour: phone.slice(-4) };
}

function phoneFingerprint(phone) {
  const key = loadConfig().marketAuth.sms.fingerprintKey;
  if (!key) throw Object.assign(new Error("Market phone verification is unavailable"), { status: 503 });
  return crypto.createHmac("sha256", key).update(phone).digest("hex");
}

function maskedPhone(countryCode, lastFour) {
  return `${countryCode} •••• ${lastFour}`;
}

function generateOtp() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

async function deliverMarketSms({ to, code }) {
  const config = loadConfig().marketAuth;
  if (config.testDelivery) return true;
  if (!config.sms.enabled) return false;
  const response = await fetch(config.sms.endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.sms.token}` },
    body: JSON.stringify({
      from: config.sms.sender,
      to,
      template: "market-phone-verification",
      variables: { code, expiresInMinutes: 5 },
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("MARKET_SMS_DELIVERY_FAILED");
  return true;
}

module.exports = {
  deliverMarketSms,
  generateOtp,
  maskedPhone,
  normalizePhone,
  phoneFingerprint,
  phoneParts,
};
