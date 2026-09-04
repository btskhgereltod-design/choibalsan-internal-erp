"use strict";

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const { loadConfig } = require("./config");
const { getPool } = require("./db");
const { asyncHandler } = require("./utils/async-handler");

function createApp() {
  const config = loadConfig();
  const app = express();
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(cors({
    credentials: false,
    origin(origin, callback) {
      if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
      callback(new Error("Origin is not allowed"));
    },
  }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", asyncHandler(async (_req, res) => {
    await getPool().query("SELECT 1");
    res.json({ ok: true, service: "overva-api" });
  }));

  app.use("/api/auth", require("./routes/auth"));
  app.use("/api/public", require("./routes/public"));
  app.use("/api/platform", require("./routes/platform"));
  app.use("/api/market", require("./routes/market"));
  app.use("/api/organizations", require("./routes/organization"));
  app.use("/api/organization-blueprints", require("./routes/organization-blueprints"));
  app.use("/api/users", require("./routes/users"));
  app.use("/api/employees", require("./routes/employees"));
  app.use("/api/notifications", require("./routes/notifications"));
  app.use("/api/reports", require("./routes/reports"));
  app.use("/api/report-schedules", require("./routes/report-schedules"));
  app.use("/api/attachments", require("./routes/attachments"));
  app.use("/api/audit", require("./routes/audit"));
  app.use("/api/assets", require("./routes/assets"));
  app.use("/api/work-orders", require("./routes/work-orders"));
  app.use("/api/engineering", require("./routes/engineering"));
  app.use("/api/lighting", require("./routes/lighting"));
  app.use("/api/camera", require("./routes/camera"));
  app.use("/api/camera/network", require("./routes/camera-network"));
  app.use("/api/map", require("./routes/map"));
  app.use("/api/gps", require("./routes/gps"));
  app.use("/api/iot", require("./routes/iot"));
  app.use("/api/finance", require("./routes/finance"));
  app.use("/api/dashboard", require("./routes/dashboard"));
  app.use("/api/executive", require("./routes/executive"));
  app.use("/api/integration-lab", require("./routes/integration-lab"));
  app.use("/api/automation", require("./routes/automation"));
  app.use("/api/ai-director", require("./routes/ai-director"));
  app.use("/api/attendance", require("./routes/attendance"));
  app.use("/api/safety", require("./routes/safety"));
  app.use("/api/structure-smart-imports", require("./routes/structure-smart-imports"));
  app.use("/api/dataset-discoveries", require("./routes/dataset-discoveries"));
  app.use("/api/hr/smart-imports", require("./routes/smart-imports"));
  app.use("/api/hr", require("./routes/hr"));
  app.use("/api/hr", require("./routes/hr-workflows"));
  app.use("/api/hr", require("./routes/hr-discipline"));
  app.use("/api/hr", require("./routes/hr-operations"));
  app.use("/api/legacy-migration", require("./routes/legacy-migration"));
  app.use("/api/records", require("./routes/records"));
  app.use("/api/complaints", require("./routes/complaints"));
  app.use("/api/archive", require("./routes/archive"));
  app.use("/api/data-governance", require("./routes/data-governance"));
  app.use("/api/documents", require("./routes/documents"));
  app.use("/api/integrations", require("./routes/integrations"));
  app.use("/api/connectors", require("./routes/connectors"));
  app.use("/api/industry", require("./routes/industry"));
  app.use("/api/builder", require("./routes/builder"));
  const developerPlatform = require("./routes/developer-platform");
  app.use("/api/developer", developerPlatform.managementRouter);
  app.use("/api/open/v1", developerPlatform.openRouter);
  const businessModules = require("./routes/business-modules");
  app.use("/api/modules", businessModules.tenantRouter);
  app.use("/api/platform/billing", businessModules.platformRouter);

  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  app.use((error, _req, res, _next) => {
    if (config.NODE_ENV === "production") {
      console.error("[request error]", { name: error.name, code: error.code, message: error.message });
    } else {
      console.error("[request error]", error);
    }
    const assignmentError = String(error.code || "").startsWith("ASSIGNMENT_");
    const assignmentConflict = error.code === "ASSIGNMENT_IDEMPOTENCY_CONFLICT";
    const automationConflict = error.code === "AUTOMATION_IDEMPOTENCY_CONFLICT";
    const governanceError = String(error.code || "").startsWith("GOVERNANCE_") || error.message === "GOVERNANCE_ACTIVE_HOLD";
    const importError = String(error.code || "").startsWith("IMPORT_") || error.code === "LIMIT_FILE_SIZE";
    const marketIdentityInactive = error.code === "MARKET_IDENTITY_INACTIVE";
    const boundedDomainError = error.name === "WorkflowError" || String(error.code || "").startsWith("DOMAIN_") || Number.isInteger(error.status);
    const status = boundedDomainError ? (Number.isInteger(error.status) ? error.status : 400) : marketIdentityInactive ? 401 : (error.code === "23505" || governanceError || assignmentConflict || automationConflict) ? 409 : (error.code === "23503" || assignmentError || importError) ? 400 : 500;
    const message = error.message === "GOVERNANCE_ACTIVE_HOLD" ? "Идэвхтэй хадгалалтын хоригтой өгөгдлийн хүсэлтийг батлах боломжгүй"
      : (assignmentError || automationConflict || governanceError || importError) ? error.message
      : marketIdentityInactive ? "Market identity is inactive"
      : boundedDomainError ? (error.code || error.message)
      : status === 409 ? "Duplicate record" : status === 400 ? "Invalid reference" : "Internal server error";
    res.status(status).json({ error: message, ...(boundedDomainError || assignmentConflict || automationConflict ? {code:error.code} : {}) });
  });
  return app;
}

module.exports = { createApp };
