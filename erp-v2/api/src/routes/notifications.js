"use strict";

const express = require("express");
const { z } = require("zod");
const { getPool } = require("../db");
const { authenticate } = require("../middleware/auth");
const { asyncHandler } = require("../utils/async-handler");

const router = express.Router();
router.use(authenticate);

router.get("/", asyncHandler(async (req, res) => {
  const result = await getPool().query(
    `SELECT id,type,title,message,entity_type,entity_id,read_at,created_at
       FROM notifications
      WHERE organization_id=$1 AND user_id=$2
      ORDER BY created_at DESC LIMIT 50`,
    [req.user.organization_id, req.user.id]
  );
  const unread = result.rows.filter(item => !item.read_at).length;
  res.json({ items: result.rows, unread });
}));

router.patch("/read-all", asyncHandler(async (req, res) => {
  await getPool().query(
    "UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE organization_id=$1 AND user_id=$2",
    [req.user.organization_id, req.user.id]
  );
  res.json({ ok: true });
}));

router.patch("/:id/read", asyncHandler(async (req, res) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: "Invalid notification" });
  const result = await getPool().query(
    `UPDATE notifications SET read_at=COALESCE(read_at,now())
      WHERE organization_id=$1 AND user_id=$2 AND id=$3 RETURNING id`,
    [req.user.organization_id, req.user.id, id.data]
  );
  if (!result.rowCount) return res.status(404).json({ error: "Notification not found" });
  res.json({ ok: true });
}));

module.exports = router;
