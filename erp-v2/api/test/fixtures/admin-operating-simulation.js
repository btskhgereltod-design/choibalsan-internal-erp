"use strict";

class AdminSimulationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const fail = (code, message) => { throw new AdminSimulationError(code, message); };
const deepFreeze = value => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
};
const safeData = value => deepFreeze(structuredClone(value || {}));
const role = (code, label, permissions) => Object.freeze({
  code,
  label,
  permissions:Object.freeze(permissions)
});

const ADMIN_ROLE_CATALOG = Object.freeze({
  group:Object.freeze([
    role("board-chair", "Board chair", ["group.aggregate.read", "group.attestation.accept"]),
    role("strategy-director", "Strategy director", ["group.aggregate.read", "group.strategy.manage"]),
    role("portfolio-analyst", "Portfolio analyst", ["group.aggregate.read", "group.portfolio.analyze"]),
    role("risk-officer", "Enterprise risk officer", ["group.aggregate.read", "group.risk.review"]),
    role("compliance-oversight", "Compliance oversight", ["group.aggregate.read", "group.compliance.review"]),
    role("security-oversight", "Security oversight", ["group.aggregate.read", "group.security.review"]),
    role("finance-consolidation", "Finance consolidation", ["group.aggregate.read", "group.finance.aggregate"]),
    role("internal-auditor", "Internal auditor", ["group.aggregate.read", "group.audit.review"]),
    role("legal-counsel", "Group legal counsel", ["group.aggregate.read", "group.legal.review"]),
    role("privacy-oversight", "Privacy oversight", ["group.aggregate.read", "group.privacy.review"]),
    role("conflict-officer", "Conflict-of-interest officer", ["group.aggregate.read", "group.conflict.review"]),
    role("investment-analyst", "Investment analyst", ["group.aggregate.read", "group.investment.analyze"]),
    role("continuity-lead", "Business continuity lead", ["group.aggregate.read", "group.continuity.review"]),
    role("brand-steward", "Brand steward", ["group.aggregate.read", "group.brand.review"]),
    role("people-governance", "People governance", ["group.aggregate.read", "group.people.review"]),
    role("vendor-independence", "Vendor independence reviewer", ["group.aggregate.read", "group.independence.review"]),
    role("policy-secretary", "Policy secretary", ["group.aggregate.read", "group.attestation.create"]),
    role("metrics-analyst", "Group metrics analyst", ["group.aggregate.read", "group.metrics.analyze"]),
    role("assurance-reviewer", "Independent assurance reviewer", ["group.aggregate.read", "group.assurance.review"]),
    role("readonly-observer", "Read-only observer", ["group.aggregate.read"])
  ]),
  platform:Object.freeze([
    role("operations-lead", "Platform operations lead", ["platform.case.read", "platform.change.create"]),
    role("tenant-operations", "Tenant operations", ["platform.case.read", "platform.tenant.operate"]),
    role("identity-admin", "Identity administrator", ["platform.case.read", "platform.identity.manage"]),
    role("access-reviewer", "Access reviewer", ["platform.case.read", "platform.access.review"]),
    role("security-approver", "Platform security approver", ["platform.case.read", "platform.security.approve"]),
    role("release-approver", "Platform release approver", ["platform.case.read", "platform.release.approve"]),
    role("runtime-operator", "Runtime operator", ["platform.case.read", "platform.change.deploy"]),
    role("sre", "Site reliability engineer", ["platform.case.read", "platform.reliability.operate"]),
    role("database-operator", "Database operator", ["platform.case.read", "platform.database.operate"]),
    role("backup-operator", "Backup and recovery operator", ["platform.case.read", "platform.backup.operate"]),
    role("integration-operator", "Integration operator", ["platform.case.read", "platform.integration.operate"]),
    role("iot-safety", "IoT safety controller", ["platform.case.read", "platform.iot.safety"]),
    role("audit-reviewer", "Platform audit reviewer", ["platform.case.read", "platform.audit.review"]),
    role("privacy-operator", "Platform privacy operator", ["platform.case.read", "platform.privacy.operate"]),
    role("billing-operator", "Platform billing operator", ["platform.case.read", "platform.billing.operate"]),
    role("support-lead", "Platform support lead", ["platform.case.read", "platform.support.manage"]),
    role("quality-analyst", "Platform quality analyst", ["platform.case.read", "platform.quality.review"]),
    role("capacity-planner", "Capacity planner", ["platform.case.read", "platform.capacity.plan"]),
    role("incident-commander", "Incident commander", ["platform.case.read", "platform.incident.command"]),
    role("readonly-observer", "Platform read-only observer", ["platform.case.read"])
  ]),
  apps:Object.freeze([
    role("portfolio-lead", "Product portfolio lead", ["apps.case.read", "apps.portfolio.manage"]),
    role("product-manager", "Product manager", ["apps.case.read", "apps.release.create"]),
    role("business-analyst", "Business analyst", ["apps.case.read", "apps.requirement.manage"]),
    role("solution-architect", "Solution architect", ["apps.case.read", "apps.architecture.design"]),
    role("ai-builder", "AI builder", ["apps.case.read", "apps.build.execute"]),
    role("low-code-builder", "Low-code builder", ["apps.case.read", "apps.build.execute"]),
    role("software-engineer", "Software engineer", ["apps.case.read", "apps.build.execute"]),
    role("data-engineer", "Data engineer", ["apps.case.read", "apps.data.build"]),
    role("integration-engineer", "Integration engineer", ["apps.case.read", "apps.integration.build"]),
    role("ux-designer", "Product designer", ["apps.case.read", "apps.design.create"]),
    role("qa-approver", "Quality approver", ["apps.case.read", "apps.qa.approve"]),
    role("security-reviewer", "Product security reviewer", ["apps.case.read", "apps.security.review"]),
    role("release-manager", "Vendor release manager", ["apps.case.read", "apps.release.package", "apps.handoff.publish"]),
    role("implementation-lead", "Implementation lead", ["apps.case.read", "apps.implementation.manage"]),
    role("support-lead", "Product support lead", ["apps.case.read", "apps.support.manage"]),
    role("sales-lead", "Vendor sales lead", ["apps.case.read", "apps.sales.manage"]),
    role("customer-success", "Customer success", ["apps.case.read", "apps.success.manage"]),
    role("vendor-finance", "Vendor finance", ["apps.case.read", "apps.finance.manage"]),
    role("license-operator", "Vendor license operator", ["apps.case.read", "apps.license.manage"]),
    role("readonly-observer", "Vendor read-only observer", ["apps.case.read"])
  ]),
  market:Object.freeze([
    role("operator-lead", "Market operator lead", ["market.case.read", "market.operations.manage"]),
    role("supplier-verifier", "Supplier verifier", ["market.case.read", "market.supplier.verify"]),
    role("listing-intake", "Listing intake", ["market.case.read", "market.handoff.accept", "market.listing.intake"]),
    role("technical-reviewer", "Listing technical reviewer", ["market.case.read", "market.listing.technical.approve"]),
    role("security-reviewer", "Listing security reviewer", ["market.case.read", "market.listing.security.approve"]),
    role("catalog-publisher", "Catalog publisher", ["market.case.read", "market.listing.publish"]),
    role("compatibility-reviewer", "Compatibility reviewer", ["market.case.read", "market.compatibility.review"]),
    role("license-reviewer", "License reviewer", ["market.case.read", "market.license.review"]),
    role("fee-operator", "Fee operator", ["market.case.read", "market.fee.operate"]),
    role("ranking-auditor", "Ranking neutrality auditor", ["market.case.read", "market.ranking.audit"]),
    role("custom-work-moderator", "Custom work moderator", ["market.case.read", "market.custom-work.moderate"]),
    role("proposal-integrity", "Proposal integrity reviewer", ["market.case.read", "market.proposal.audit"]),
    role("forum-moderator", "Forum moderator", ["market.case.read", "market.forum.moderate"]),
    role("knowledge-curator", "Knowledge curator", ["market.case.read", "market.knowledge.curate"]),
    role("complaint-intake", "Complaint intake", ["market.case.read", "market.complaint.intake"]),
    role("investigator", "Market investigator", ["market.case.read", "market.investigation.manage"]),
    role("dispute-reviewer", "Dispute reviewer", ["market.case.read", "market.dispute.review"]),
    role("appeal-reviewer", "Independent appeal reviewer", ["market.case.read", "market.appeal.review"]),
    role("market-auditor", "Market audit reviewer", ["market.case.read", "market.audit.review"]),
    role("readonly-observer", "Market read-only observer", ["market.case.read"])
  ])
});

const CASE_TYPES = Object.freeze({
  platform_change:Object.freeze({
    context:"platform",
    create:"platform.change.create",
    approvals:Object.freeze(["platform.security.approve", "platform.release.approve"]),
    complete:"platform.change.deploy"
  }),
  apps_release:Object.freeze({
    context:"apps",
    create:"apps.release.create",
    approvals:Object.freeze(["apps.qa.approve", "apps.security.review"]),
    complete:"apps.release.package"
  }),
  market_listing:Object.freeze({
    context:"market",
    create:"market.listing.intake",
    approvals:Object.freeze(["market.listing.technical.approve", "market.listing.security.approve"]),
    complete:"market.listing.publish"
  }),
  group_attestation:Object.freeze({
    context:"group",
    create:"group.attestation.create",
    approvals:Object.freeze(["group.risk.review", "group.independence.review"]),
    complete:"group.attestation.accept"
  })
});

const HANDOFFS = Object.freeze({
  "apps:market":Object.freeze({
    publish:"apps.handoff.publish",
    accept:"market.handoff.accept",
    fields:Object.freeze(["productCode", "name", "version", "supportPolicy", "releaseFingerprint", "ownershipBadge"])
  })
});

class AdminOperatingSimulation {
  constructor() {
    this.actors = new Map();
    this.cases = new Map();
    this.handoffs = new Map();
    this.events = [];
    this.nextIdentifier = 1;
  }

  seedVirtualActors() {
    for (const [context, roles] of Object.entries(ADMIN_ROLE_CATALOG)) {
      roles.forEach((definition, index) => {
        const actor = Object.freeze({
          id:`sim-${context}-${String(index + 1).padStart(2, "0")}`,
          context,
          role:definition.code,
          label:definition.label,
          permissions:definition.permissions,
          simulated:true
        });
        this.actors.set(actor.id, actor);
      });
    }
    this.record("simulation.actors.seeded", "simulation", { total:this.actors.size });
    return [...this.actors.values()];
  }

  actor(actorId) {
    const actor = this.actors.get(actorId);
    if (!actor) fail("ACTOR_NOT_FOUND", "Simulation actor not found");
    return actor;
  }

  require(actorId, permission) {
    const actor = this.actor(actorId);
    if (!actor.permissions.includes(permission)) fail("PERMISSION_DENIED", `${actor.id} lacks ${permission}`);
    return actor;
  }

  inspectWorkspace(actorId, context) {
    const actor = this.actor(actorId);
    if (actor.context !== context) fail("BOUNDARY_DENIED", `${actor.context} identity cannot enter ${context} administration`);
    return Object.freeze({ context, role:actor.role, permissions:actor.permissions });
  }

  openCase(actorId, type, data) {
    const definition = CASE_TYPES[type];
    if (!definition) fail("INVALID_CASE_TYPE", "Unknown administrative case type");
    const actor = this.require(actorId, definition.create);
    if (actor.context !== definition.context) fail("BOUNDARY_DENIED", "Case belongs to another operating boundary");
    const item = {
      id:this.identifier("admin-case"),
      type,
      context:definition.context,
      openedBy:actor.id,
      status:"open",
      data:safeData(data),
      approvals:new Map(),
      completedBy:null
    };
    this.cases.set(item.id, item);
    this.record("admin.case.opened", item.id, { actorId, type, context:item.context });
    return this.caseSnapshot(item);
  }

  readCase(actorId, caseId) {
    const actor = this.actor(actorId);
    const item = this.internalCase(caseId);
    if (actor.context !== item.context) fail("BOUNDARY_DENIED", "Raw case data cannot cross operating boundaries");
    this.require(actorId, `${item.context}.case.read`);
    return this.caseSnapshot(item);
  }

  approveCase(actorId, caseId, permission) {
    const actor = this.require(actorId, permission);
    const item = this.internalCase(caseId);
    const definition = CASE_TYPES[item.type];
    if (actor.context !== item.context) fail("BOUNDARY_DENIED", "Approval cannot cross operating boundaries");
    if (!definition.approvals.includes(permission)) fail("INVALID_APPROVAL", "Approval is not part of this case gate");
    if (actor.id === item.openedBy) fail("SELF_APPROVAL_DENIED", "The initiator cannot approve the same case");
    if (item.status !== "open") fail("CASE_NOT_OPEN", "Only open cases can be approved");
    if (item.approvals.has(permission)) fail("DUPLICATE_APPROVAL", "This approval gate is already satisfied");
    item.approvals.set(permission, actor.id);
    this.record("admin.case.approved", item.id, { actorId, permission });
    return this.caseSnapshot(item);
  }

  completeCase(actorId, caseId) {
    const item = this.internalCase(caseId);
    const definition = CASE_TYPES[item.type];
    const actor = this.require(actorId, definition.complete);
    if (actor.context !== item.context) fail("BOUNDARY_DENIED", "Completion cannot cross operating boundaries");
    if (actor.id === item.openedBy || [...item.approvals.values()].includes(actor.id)) fail("FOUR_EYES_REQUIRED", "Completion requires an independent actor");
    const missing = definition.approvals.filter(permission => !item.approvals.has(permission));
    if (missing.length) fail("APPROVALS_REQUIRED", `Missing approvals: ${missing.join(", ")}`);
    if (item.status !== "open") fail("CASE_NOT_OPEN", "Case is already completed");
    item.status = "completed";
    item.completedBy = actor.id;
    this.record("admin.case.completed", item.id, { actorId, type:item.type });
    return this.caseSnapshot(item);
  }

  publishHandoff(actorId, caseId, targetContext, projection) {
    const source = this.internalCase(caseId);
    const key = `${source.context}:${targetContext}`;
    const contract = HANDOFFS[key];
    if (!contract) fail("HANDOFF_NOT_ALLOWED", "No explicit handoff contract exists");
    const actor = this.require(actorId, contract.publish);
    if (actor.context !== source.context || source.status !== "completed" || actor.id !== source.completedBy) fail("HANDOFF_SOURCE_INVALID", "Only the completing source actor can publish a completed case");
    const suppliedFields = Object.keys(projection || {});
    const forbidden = suppliedFields.filter(field => !contract.fields.includes(field));
    if (forbidden.length) fail("PRIVATE_FIELD_DENIED", `Handoff contains private fields: ${forbidden.join(", ")}`);
    const handoff = {
      id:this.identifier("handoff"),
      sourceContext:source.context,
      targetContext,
      sourceCaseId:source.id,
      publishedBy:actor.id,
      acceptedBy:null,
      status:"published",
      snapshot:safeData(projection)
    };
    this.handoffs.set(handoff.id, handoff);
    this.record("admin.handoff.published", handoff.id, { actorId, sourceContext:source.context, targetContext });
    return this.handoffSnapshot(handoff);
  }

  acceptHandoff(actorId, handoffId) {
    const handoff = this.internalHandoff(handoffId);
    const contract = HANDOFFS[`${handoff.sourceContext}:${handoff.targetContext}`];
    const actor = this.require(actorId, contract.accept);
    if (actor.context !== handoff.targetContext) fail("BOUNDARY_DENIED", "Handoff can only be accepted by its target boundary");
    if (handoff.status !== "published") fail("HANDOFF_ALREADY_ACCEPTED", "Handoff is not awaiting acceptance");
    handoff.status = "accepted";
    handoff.acceptedBy = actor.id;
    this.record("admin.handoff.accepted", handoff.id, { actorId });
    return this.handoffSnapshot(handoff);
  }

  readHandoff(actorId, handoffId) {
    const actor = this.actor(actorId);
    const handoff = this.internalHandoff(handoffId);
    if (![handoff.sourceContext, handoff.targetContext].includes(actor.context)) fail("BOUNDARY_DENIED", "Handoff is not visible to this boundary");
    return Object.freeze({ ...this.handoffSnapshot(handoff), sourceCaseId:undefined });
  }

  groupSummary(actorId) {
    this.require(actorId, "group.aggregate.read");
    const contexts = {};
    for (const context of Object.keys(ADMIN_ROLE_CATALOG)) {
      contexts[context] = Object.freeze({
        virtualActors:[...this.actors.values()].filter(actor => actor.context === context).length,
        openCases:[...this.cases.values()].filter(item => item.context === context && item.status === "open").length,
        completedCases:[...this.cases.values()].filter(item => item.context === context && item.status === "completed").length
      });
    }
    return Object.freeze({ contexts:Object.freeze(contexts), auditEvents:this.events.length });
  }

  internalCase(caseId) {
    const item = this.cases.get(caseId);
    if (!item) fail("CASE_NOT_FOUND", "Administrative case not found");
    return item;
  }

  internalHandoff(handoffId) {
    const item = this.handoffs.get(handoffId);
    if (!item) fail("HANDOFF_NOT_FOUND", "Administrative handoff not found");
    return item;
  }

  caseSnapshot(item) {
    return Object.freeze({
      id:item.id,
      type:item.type,
      context:item.context,
      openedBy:item.openedBy,
      status:item.status,
      data:item.data,
      approvals:Object.freeze(Object.fromEntries(item.approvals)),
      completedBy:item.completedBy
    });
  }

  handoffSnapshot(item) {
    return Object.freeze({
      id:item.id,
      sourceContext:item.sourceContext,
      targetContext:item.targetContext,
      sourceCaseId:item.sourceCaseId,
      publishedBy:item.publishedBy,
      acceptedBy:item.acceptedBy,
      status:item.status,
      snapshot:item.snapshot
    });
  }

  identifier(prefix) {
    const value = `${prefix}-${String(this.nextIdentifier).padStart(4, "0")}`;
    this.nextIdentifier += 1;
    return value;
  }

  record(type, entityId, detail) {
    this.events.push(Object.freeze({
      sequence:this.events.length + 1,
      type,
      entityId,
      detail:Object.freeze({ ...detail })
    }));
  }
}

module.exports = {
  ADMIN_ROLE_CATALOG,
  AdminOperatingSimulation,
  AdminSimulationError
};
