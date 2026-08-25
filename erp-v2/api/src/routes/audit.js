"use strict";

const express = require("express");
const { z } = require("zod");
const { getPool } = require("../db");
const { authenticate, requireSystemRoles } = require("../middleware/auth");
const { asyncHandler } = require("../utils/async-handler");

const router = express.Router();
const querySchema = z.object({
  action: z.string().trim().max(120).optional(),
  entityType: z.string().trim().max(80).optional(),
  userId: z.string().uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
}).refine(value => !value.from || !value.to || value.from <= value.to, "Invalid date range");

router.use(authenticate, requireSystemRoles("owner"));

router.get("/", asyncHandler(async (req,res)=>{
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error:"Аудитын шүүлтүүр буруу байна" });
  const value = parsed.data, conditions=["l.organization_id=$1"], params=[req.user.organization_id];
  function add(sql,param){params.push(param);conditions.push(sql.replace("?",`$${params.length}`));}
  if(value.action)add("l.action=?",value.action);
  if(value.entityType)add("l.entity_type=?",value.entityType);
  if(value.userId)add("l.user_id=?",value.userId);
  if(value.from)add("l.created_at>=?::date",value.from);
  if(value.to)add("l.created_at<(?::date+1)",value.to);
  const where=conditions.join(" AND "), dataParams=[...params,value.limit,value.offset];
  const [logs,actions,entityTypes] = await Promise.all([
    getPool().query(
      `SELECT l.id,l.action,l.entity_type,l.entity_id,l.detail,l.ip_address,l.created_at,l.user_id,
              u.full_name AS user_name,u.role AS user_role,count(*) OVER()::int AS total_count
         FROM audit_logs l LEFT JOIN users u ON u.organization_id=l.organization_id AND u.id=l.user_id
        WHERE ${where} ORDER BY l.created_at DESC,l.id DESC
        LIMIT $${params.length+1} OFFSET $${params.length+2}`, dataParams),
    getPool().query("SELECT DISTINCT action FROM audit_logs WHERE organization_id=$1 ORDER BY action",[req.user.organization_id]),
    getPool().query("SELECT DISTINCT entity_type FROM audit_logs WHERE organization_id=$1 ORDER BY entity_type",[req.user.organization_id]),
  ]);
  const items=logs.rows.map(({total_count,...item})=>item);
  res.json({ items,total:logs.rows[0]?.total_count||0,limit:value.limit,offset:value.offset,
    actions:actions.rows.map(item=>item.action),entityTypes:entityTypes.rows.map(item=>item.entity_type) });
}));

router.get("/security", asyncHandler(async (req,res)=>{
  const limit=Math.min(Math.max(Number(req.query.limit)||100,1),200);
  const result=await getPool().query(
    `SELECT id,actor_type,actor_id,action,outcome,detail,ip_address,created_at
       FROM security_audit_events
      WHERE organization_id=$1
      ORDER BY created_at DESC,id DESC LIMIT $2`,
    [req.user.organization_id,limit]
  );
  res.json({items:result.rows});
}));

module.exports = router;
