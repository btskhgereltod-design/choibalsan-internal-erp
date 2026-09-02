"use strict";

const TRANSITIONS = Object.freeze({
  new: new Set(["assigned", "in_progress", "cancelled"]),
  assigned: new Set(["in_progress", "cancelled"]),
  in_progress: new Set(["pending_review", "cancelled"]),
  pending_review: new Set(["completed", "in_progress"]),
  completed: new Set(),
  cancelled: new Set(),
});

const WORKFLOW_ACTIONS = Object.freeze({
  safety_authorize_start: {
    from: "awaiting_safety_start", to: "awaiting_management_start", roleKey: "startSafetyRole", permissionKey: "startSafetyPermission",
    decision: "approved", status: null,
  },
  safety_return_start: {
    from: "awaiting_safety_start", to: "awaiting_safety_start", roleKey: "startSafetyRole", permissionKey: "startSafetyPermission",
    decision: "returned", status: "assigned",
  },
  management_approve_start: {
    from: "awaiting_management_start", to: "execution", roleKey: "startApprovalRole", permissionKey: "startApprovalPermission",
    decision: "approved", status: "in_progress",
  },
  submit_completion: {
    from: "execution", to: "awaiting_safety_completion", assignee: true,
    decision: "approved", status: "pending_review",
  },
  safety_accept_completion: {
    from: "awaiting_safety_completion", to: "awaiting_management_completion", roleKey: "completionSafetyRole", permissionKey: "completionSafetyPermission",
    decision: "approved", status: null,
  },
  safety_return_to_execution: {
    from: "awaiting_safety_completion", to: "execution", roleKey: "completionSafetyRole", permissionKey: "completionSafetyPermission",
    decision: "returned", status: "in_progress",
  },
  management_close: {
    from: "awaiting_management_completion", to: "completed", roleKey: "completionApprovalRole", permissionKey: "completionApprovalPermission",
    decision: "approved", status: "completed",
  },
  management_return_to_execution: {
    from: "awaiting_management_completion", to: "execution", roleKey: "completionApprovalRole", permissionKey: "completionApprovalPermission",
    decision: "returned", status: "in_progress",
  },
  safety_suspend_execution: {
    from: "execution", to: "awaiting_safety_start", roleKey: "completionSafetyRole", permissionKey: "completionSafetyPermission",
    decision: "returned", status: "assigned",
  },
});

function resolveWorkflowAction(action, config = {}) {
  const rule = WORKFLOW_ACTIONS[action];
  if (!rule) return null;
  if (action === "safety_authorize_start" && config.startManagementRequired === false) {
    return { ...rule, to: "execution", status: "in_progress" };
  }
  return rule;
}

function canTransition(from, to) {
  return Boolean(TRANSITIONS[from]?.has(to));
}

function canPerformWorkflowAction({ action, stage, permissions = [], userId, assignedTo, config = {} }) {
  const rule = WORKFLOW_ACTIONS[action];
  if (!rule || rule.from !== stage) return false;
  if (rule.assignee) return Boolean(userId && userId === assignedTo && permissions.includes("work-orders.progress"));
  if (rule.permissionKey && config[rule.permissionKey]) {
    return permissions.includes(config[rule.permissionKey]);
  }
  return false;
}

function availableWorkflowActions(context) {
  return Object.keys(WORKFLOW_ACTIONS).filter(action => canPerformWorkflowAction({ ...context, action }));
}

module.exports = { TRANSITIONS, WORKFLOW_ACTIONS, canTransition, canPerformWorkflowAction, availableWorkflowActions, resolveWorkflowAction };
