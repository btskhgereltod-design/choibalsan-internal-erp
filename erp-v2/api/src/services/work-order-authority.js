"use strict";

const { TRANSITIONS } = require("./work-order-flow");

const WORK_ORDER_PERMISSIONS = Object.freeze({
  READ_ALL: "work-orders.read-all",
  CREATE: "work-orders.create",
  ASSIGN: "work-orders.assign",
  PROGRESS: "work-orders.progress",
  SCOPE_MANAGE: "work-orders.scope.manage",
  WORKFLOW_SAFETY: "work-orders.workflow.safety",
  WORKFLOW_APPROVE: "work-orders.workflow.approve",
  EXCEPTION_DECIDE: "work-orders.exception.decide",
  MATERIAL_REQUEST: "work-orders.material.request",
  MATERIAL_APPROVE: "work-orders.material.approve",
  MATERIAL_ISSUE: "work-orders.material.issue",
  MATERIAL_CONSUME: "work-orders.material.consume",
});

function hasPermission(user, permission) {
  return Boolean(user && (user.permissions || []).includes(permission));
}

function canReadOrder(user, order) {
  if (!user || !order) return false;
  return hasPermission(user, WORK_ORDER_PERMISSIONS.READ_ALL)
    || order.department_id == null
    || order.department_id === user.department_id
    || order.assigned_to === user.id
    || order.created_by === user.id;
}

function canAssignOrder(user, order) {
  if (!hasPermission(user, WORK_ORDER_PERMISSIONS.ASSIGN)) return false;
  return hasPermission(user, WORK_ORDER_PERMISSIONS.READ_ALL)
    || order?.department_id == null
    || order.department_id === user.department_id;
}

function canProgressOrder(user, order) {
  if (!hasPermission(user, WORK_ORDER_PERMISSIONS.PROGRESS)) return false;
  return hasPermission(user, WORK_ORDER_PERMISSIONS.WORKFLOW_APPROVE)
    || order?.assigned_to === user.id;
}

function canManageScope(user, order) {
  if (!hasPermission(user, WORK_ORDER_PERMISSIONS.SCOPE_MANAGE)) return false;
  return hasPermission(user, WORK_ORDER_PERMISSIONS.READ_ALL)
    || order?.assigned_to === user.id
    || (order?.department_id != null && order.department_id === user.department_id);
}

function availableStatusTransitions(user, order) {
  if (!order || order.workflow_policy_id || !canProgressOrder(user, order)) return [];
  const candidates = [...(TRANSITIONS[order.status] || [])];
  return candidates.filter(status => status !== "completed"
    || hasPermission(user, WORK_ORDER_PERMISSIONS.WORKFLOW_APPROVE));
}

module.exports = {
  WORK_ORDER_PERMISSIONS,
  hasPermission,
  canReadOrder,
  canAssignOrder,
  canProgressOrder,
  canManageScope,
  availableStatusTransitions,
};
