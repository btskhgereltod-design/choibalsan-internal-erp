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
    from: "awaiting_safety_start", to: "awaiting_management_start", roleKey: "startSafetyRole",
    decision: "approved", status: null,
  },
  management_approve_start: {
    from: "awaiting_management_start", to: "execution", roleKey: "startApprovalRole",
    decision: "approved", status: "in_progress",
  },
  submit_completion: {
    from: "execution", to: "awaiting_safety_completion", assignee: true,
    decision: "approved", status: "pending_review",
  },
  safety_accept_completion: {
    from: "awaiting_safety_completion", to: "awaiting_management_completion", roleKey: "completionSafetyRole",
    decision: "approved", status: null,
  },
  safety_return_to_execution: {
    from: "awaiting_safety_completion", to: "execution", roleKey: "completionSafetyRole",
    decision: "returned", status: "in_progress",
  },
  management_close: {
    from: "awaiting_management_completion", to: "completed", roleKey: "completionApprovalRole",
    decision: "approved", status: "completed",
  },
  management_return_to_execution: {
    from: "awaiting_management_completion", to: "execution", roleKey: "completionApprovalRole",
    decision: "returned", status: "in_progress",
  },
});

function canTransition(from, to) {
  return Boolean(TRANSITIONS[from]?.has(to));
}

function canPerformWorkflowAction({ action, stage, role, userId, assignedTo, config = {} }) {
  const rule = WORKFLOW_ACTIONS[action];
  if (!rule || rule.from !== stage) return false;
  if (rule.assignee) return Boolean(userId && userId === assignedTo);
  return Boolean(rule.roleKey && config[rule.roleKey] === role);
}

function availableWorkflowActions(context) {
  return Object.keys(WORKFLOW_ACTIONS).filter(action => canPerformWorkflowAction({ ...context, action }));
}

module.exports = { TRANSITIONS, WORKFLOW_ACTIONS, canTransition, canPerformWorkflowAction, availableWorkflowActions };
