"use strict";

const express = require("express");
const { authenticate } = require("../middleware/auth");

const { getPool } = require("../db");
const { asyncHandler } = require("../utils/async-handler");
const router = express.Router();
router.get("/current", authenticate, asyncHandler(async (req, res) => {
  const result=await getPool().query(`SELECT short_name,logo_url,primary_color,accent_color FROM organization_settings WHERE organization_id=$1`,[req.user.organization_id]);
  const builder=await getPool().query(`SELECT EXISTS(SELECT 1 FROM builder_builds WHERE organization_id=$1 AND status='applied') AS configured`,[req.user.organization_id]);
  res.json({
    organization: {
      id:req.user.organization_id,
      slug:req.user.organization_slug,
      name:req.user.organization_name,
      settings:result.rows[0]||null,
      enabledModules:req.user.enabled_modules||[],
      builderConfigured:builder.rows[0].configured,
    },
    permissions:req.user.permissions||[],
  });
}));

module.exports = router;
