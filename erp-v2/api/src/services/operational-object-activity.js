"use strict";

const {
  WORK_ORDER_PERMISSIONS,
  hasPermission,
  canReadOrder,
} = require("./work-order-authority");

function isOwner(user) {
  return new Set(user?.system_roles || []).has("owner");
}

function canReadWork(user) {
  if (isOwner(user)) return true;
  const enabled = new Set(user?.enabled_modules || []);
  return enabled.has("work-orders") && (user?.permissions || []).some((permission) =>
    permission.startsWith("work-orders."));
}

async function loadOperationalObjectActivity(client, { organizationId, objectId = null, assetId = null, user }) {
  if (Boolean(objectId) === Boolean(assetId)) {
    throw new Error("Exactly one operational object or asset is required");
  }
  const safetyDetailVisible = isOwner(user)
    || hasPermission(user, WORK_ORDER_PERMISSIONS.READ_ALL)
    || hasPermission(user, WORK_ORDER_PERMISSIONS.WORKFLOW_SAFETY)
    || hasPermission(user, WORK_ORDER_PERMISSIONS.WORKFLOW_APPROVE);
  const incidents = await client.query(`SELECT incident.id,incident.domain,incident.incident_type,
      COALESCE(type.name,incident.incident_type) incident_type_name,
      COALESCE(NULLIF(incident.detail->>'quantityUnit',''),type.quantity_unit,'тохиолдол') quantity_unit,
      incident.title,incident.location,incident.affected_quantity,
      incident.resolved_quantity,incident.status,incident.reported_at,incident.updated_at,
      NULLIF(incident.detail->>'reportedNote','') reported_note,
      reporter.full_name reported_by_name
    FROM operational_incidents incident
    LEFT JOIN organization_operational_incident_types type
      ON type.organization_id=incident.organization_id AND type.domain=incident.domain AND type.code=incident.incident_type
    LEFT JOIN users reporter ON reporter.organization_id=incident.organization_id AND reporter.id=incident.reported_by
    WHERE incident.organization_id=$1
      AND (($2::uuid IS NOT NULL AND incident.operational_object_id=$2)
        OR ($3::uuid IS NOT NULL AND incident.asset_id=$3))
    ORDER BY incident.reported_at DESC,incident.id DESC LIMIT 500`, [organizationId, objectId, assetId]);

  const incidentIds = incidents.rows.map((incident) => incident.id);
  const incidentEvents = incidentIds.length
    ? (await client.query(`SELECT event.id,event.incident_id,event.event_type,event.quantity,event.note,
        event.detail,event.incident_version,event.request_id,event.occurred_at,event.created_at,
        actor.full_name actor_name
      FROM operational_incident_events event
      LEFT JOIN users actor ON actor.organization_id=event.organization_id AND actor.id=event.actor_user_id
      WHERE event.organization_id=$1 AND event.incident_id=ANY($2::uuid[])
      ORDER BY event.occurred_at DESC,event.id DESC LIMIT 1500`, [organizationId, incidentIds])).rows
    : [];

  if (!canReadWork(user)) {
    return { incidents: incidents.rows, incidentEvents, workOrders: [], workEvents: [], scopeItems: [], safetyReviews: [], safetyDetailVisible: false };
  }

  const workResult = await client.query(`SELECT DISTINCT work.id,work.title,work.description,work.priority,
      work.status,work.workflow_stage,work.due_at,work.created_at,work.updated_at,work.assigned_to,
      work.department_id,work.created_by,assignee.full_name assigned_name,creator.full_name created_by_name,
      department.name department_name
    FROM work_orders work
    LEFT JOIN operational_incident_work_orders link
      ON link.organization_id=work.organization_id AND link.work_order_id=work.id
    LEFT JOIN operational_incidents source
      ON source.organization_id=link.organization_id AND source.id=link.incident_id
    LEFT JOIN users assignee ON assignee.organization_id=work.organization_id AND assignee.id=work.assigned_to
    LEFT JOIN users creator ON creator.organization_id=work.organization_id AND creator.id=work.created_by
    LEFT JOIN departments department ON department.organization_id=work.organization_id AND department.id=work.department_id
    WHERE work.organization_id=$1
      AND (($2::uuid IS NOT NULL AND (work.operational_object_id=$2 OR source.operational_object_id=$2))
        OR ($3::uuid IS NOT NULL AND (work.asset_id=$3 OR source.asset_id=$3)))
    ORDER BY work.created_at DESC,work.id DESC LIMIT 500`, [organizationId, objectId, assetId]);
  const workOrders = workResult.rows.filter((work) => canReadOrder(user, work));
  if (!workOrders.length) {
    return { incidents: incidents.rows, incidentEvents, workOrders, workEvents: [], scopeItems: [], safetyReviews: [], safetyDetailVisible };
  }

  const workIds = workOrders.map((work) => work.id);
  const [eventResult, scopeResult] = await Promise.all([
    client.query(`SELECT event.id,event.work_order_id,event.event_type,event.from_status,event.to_status,
        event.note,event.created_at,actor.full_name actor_name
      FROM work_order_events event
      LEFT JOIN users actor ON actor.organization_id=event.organization_id AND actor.id=event.actor_user_id
      WHERE event.organization_id=$1 AND event.work_order_id=ANY($2::uuid[])
      ORDER BY event.created_at DESC,event.id DESC LIMIT 1000`, [organizationId, workIds]),
    client.query(`SELECT id,work_order_id,item_code,description,unit,planned_quantity,completed_quantity,
        unresolved_quantity,deferred_quantity,outcome_status,exception_status,updated_at
      FROM work_order_scope_items
      WHERE organization_id=$1 AND work_order_id=ANY($2::uuid[])
      ORDER BY created_at,item_code`, [organizationId, workIds]),
  ]);

  const safetyReviews = safetyDetailVisible
    ? (await client.query(`SELECT review.id,review.work_order_id,review.review_type,review.decision,
        review.risk_score,review.controls,review.ppe,review.note,review.valid_until,review.created_at,
        actor.full_name actor_name
      FROM work_order_safety_reviews review
      LEFT JOIN users actor ON actor.organization_id=review.organization_id AND actor.id=review.actor_user_id
      WHERE review.organization_id=$1 AND review.work_order_id=ANY($2::uuid[])
      ORDER BY review.created_at DESC,review.id DESC LIMIT 500`, [organizationId, workIds])).rows
    : [];

  return {
    incidents: incidents.rows,
    incidentEvents,
    workOrders,
    workEvents: eventResult.rows,
    scopeItems: scopeResult.rows,
    safetyReviews,
    safetyDetailVisible,
  };
}

module.exports = { loadOperationalObjectActivity };
