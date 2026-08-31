"use strict";

async function activeAssignee(client, organizationId, userId) {
  if (!userId) return null;
  const result = await client.query(
    `SELECT u.id,u.full_name,u.role,u.department_id,u.employee_id
       FROM users u
      WHERE u.organization_id=$1 AND u.id=$2 AND u.active=true AND u.can_login=true`,
    [organizationId,userId]
  );
  return result.rows[0] || null;
}

async function assigneeReference(client, organizationId, userId) {
  if (!userId) return null;
  const result = await client.query(
    `SELECT u.id,u.full_name,u.role,u.department_id,u.employee_id
       FROM users u WHERE u.organization_id=$1 AND u.id=$2`,
    [organizationId,userId]
  );
  return result.rows[0] || null;
}

async function assignmentState(client, organizationId, workOrderId) {
  const result = await client.query(
    `SELECT w.*,u.employee_id AS assigned_employee_id
       FROM work_orders w
       LEFT JOIN users u ON u.organization_id=w.organization_id AND u.id=w.assigned_to
      WHERE w.organization_id=$1 AND w.id=$2
      FOR UPDATE OF w`,
    [organizationId,workOrderId]
  );
  return result.rows[0] || null;
}

async function appendAssignmentEvent(client, {
  organizationId, workOrderId, actorUserId = null,
  operation, source, fromAssignee = null, toAssignee = null,
  fromStatus = null, toStatus = null, reason = "", idempotencyKey = null,
  createdAt = null, initialAtWorkOrderCreation = false,
}) {
  const detail = {
    fromAssignee:fromAssignee?.id || null,
    toAssignee:toAssignee?.id || null,
    assignedName:toAssignee?.full_name || null,
    assignmentOperation:operation,
    assignmentHistoryVersion:1,
  };
  const result = await client.query(
    `INSERT INTO work_order_events(
       organization_id,work_order_id,actor_user_id,event_type,from_status,to_status,detail,
       assignment_history_version,assignment_operation,assignment_source,
       from_assignee_user_id,to_assignee_user_id,
       from_assignee_employee_id,to_assignee_employee_id,
       assignment_reason,idempotency_key,created_at
     ) VALUES($1,$2,$3,'assigned',$4,$5,$6::jsonb,1,$7,$8,$9,$10,$11,$12,$13,$14,
       COALESCE($15::timestamptz,
         CASE WHEN $16::boolean THEN (
           SELECT created_at FROM work_orders WHERE organization_id=$1 AND id=$2
         ) END,now()))
     ON CONFLICT(organization_id,work_order_id,idempotency_key)
       WHERE event_type='assigned' AND assignment_history_version=1 AND idempotency_key IS NOT NULL
       DO NOTHING
     RETURNING *`,
    [organizationId,workOrderId,actorUserId,fromStatus,toStatus,JSON.stringify(detail),operation,source,
      fromAssignee?.id || null,toAssignee?.id || null,fromAssignee?.employee_id || null,
      toAssignee?.employee_id || null,reason,idempotencyKey,createdAt,initialAtWorkOrderCreation]
  );
  return result.rows[0] || null;
}

async function recordInitialAssignment(client, {
  organizationId, workOrderId, actorUserId = null, assignee = null,
  status, source = "api", reason = "", idempotencyKey = null, createdAt = null,
}) {
  return appendAssignmentEvent(client, {
    organizationId,workOrderId,actorUserId,operation:"initial",source,
    fromAssignee:null,toAssignee:assignee,fromStatus:null,toStatus:status,
    reason,idempotencyKey,createdAt,initialAtWorkOrderCreation:true,
  });
}

function assignmentIdempotencyConflict(){
  const error = new Error("Idempotency key was already used for another assignment request");
  error.code = "ASSIGNMENT_IDEMPOTENCY_CONFLICT";
  return error;
}

async function replayAssignment(client, {
  organizationId,workOrderId,assigneeUserId,actorUserId,
  source="api",reason="",idempotencyKey=null,
}) {
  if (!idempotencyKey) return null;
  const replay = await client.query(
    `SELECT * FROM work_order_events
      WHERE organization_id=$1 AND work_order_id=$2 AND event_type='assigned'
        AND assignment_history_version=1 AND idempotency_key=$3`,
    [organizationId,workOrderId,idempotencyKey]
  );
  if (!replay.rowCount) return null;
  const event = replay.rows[0];
  const sameRequest = (event.to_assignee_user_id || null) === (assigneeUserId || null)
    && (event.assignment_reason || "") === (reason || "")
    && event.assignment_source === source
    && (event.actor_user_id || null) === (actorUserId || null);
  if (!sameRequest) throw assignmentIdempotencyConflict();
  return event;
}

async function changeAssignment(client, {
  organizationId, current, assignee, actorUserId,
  source = "api", reason = "", idempotencyKey = null,
}) {
  const replay = await replayAssignment(client,{
    organizationId,workOrderId:current.id,assigneeUserId:assignee?.id||null,
    actorUserId,source,reason,idempotencyKey,
  });
  if (replay) return { item:current, changed:false, replayed:true, event:replay };
  const fromAssignee = current.assigned_to ? {
    id:current.assigned_to,employee_id:current.assigned_employee_id || null,
  } : null;
  const toAssignee = assignee || null;
  if ((fromAssignee?.id || null) === (toAssignee?.id || null)) {
    return { item:current, changed:false, event:null };
  }
  const nextStatus = current.status === "new" && toAssignee
    ? "assigned"
    : current.status === "assigned" && !toAssignee ? "new" : current.status;
  const updated = await client.query(
    `UPDATE work_orders SET assigned_to=$1,status=$2,updated_at=now()
      WHERE organization_id=$3 AND id=$4 RETURNING *`,
    [toAssignee?.id || null,nextStatus,organizationId,current.id]
  );
  const operation = fromAssignee ? (toAssignee ? "reassigned" : "unassigned") : "assigned";
  const event = await appendAssignmentEvent(client, {
    organizationId,workOrderId:current.id,actorUserId,operation,source,
    fromAssignee,toAssignee,fromStatus:current.status,toStatus:nextStatus,
    reason,idempotencyKey,
  });
  return { item:updated.rows[0], changed:true, event };
}

module.exports = {
  activeAssignee,
  assigneeReference,
  assignmentState,
  appendAssignmentEvent,
  recordInitialAssignment,
  replayAssignment,
  changeAssignment,
};
