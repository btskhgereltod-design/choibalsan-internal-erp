"use strict";

const jwt = require("jsonwebtoken");
const { loadConfig } = require("../config");

function signAccessToken(userId) {
  const config = loadConfig();
  return jwt.sign({}, config.JWT_SECRET, {
    subject: userId,
    issuer: config.JWT_ISSUER,
    audience: config.JWT_AUDIENCE,
    expiresIn: "8h",
    algorithm: "HS256",
  });
}

function signPlatformToken(adminId) {
  const config = loadConfig();
  return jwt.sign({ kind: "platform" }, config.JWT_SECRET, {
    subject: adminId,
    issuer: config.JWT_ISSUER,
    audience: config.JWT_AUDIENCE,
    expiresIn: "4h",
    algorithm: "HS256",
  });
}

function signMarketToken(identityId, sessionId = undefined) {
  const config = loadConfig();
  return jwt.sign({ kind: "market", ...(sessionId ? { sid: sessionId } : {}) }, config.JWT_SECRET, {
    subject: identityId,
    issuer: config.JWT_ISSUER,
    audience: config.JWT_AUDIENCE,
    expiresIn: "8h",
    algorithm: "HS256",
  });
}

function verifyAccessToken(token) {
  const config = loadConfig();
  return jwt.verify(token, config.JWT_SECRET, {
    issuer: config.JWT_ISSUER,
    audience: config.JWT_AUDIENCE,
    algorithms: ["HS256"],
  });
}

module.exports = { signAccessToken, signPlatformToken, signMarketToken, verifyAccessToken };
