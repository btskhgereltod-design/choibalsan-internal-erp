"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ADMIN_ROLE_CATALOG,
  AdminOperatingSimulation
} = require("./fixtures/admin-operating-simulation");

const expectedFailure = (code, action) => assert.throws(action, error => error?.code === code);
const actor = (simulation, context, role) => [...simulation.actors.values()].find(item => item.context === context && item.role === role);

test("four admin boundaries seed twenty isolated virtual identities each", () => {
  const simulation = new AdminOperatingSimulation();
  const actors = simulation.seedVirtualActors();

  assert.equal(actors.length, 80);
  for (const context of ["group", "platform", "apps", "market"]) {
    assert.equal(ADMIN_ROLE_CATALOG[context].length, 20);
    assert.equal(actors.filter(item => item.context === context).length, 20);
  }

  for (const identity of actors) {
    assert.equal(simulation.inspectWorkspace(identity.id, identity.context).context, identity.context);
    for (const other of ["group", "platform", "apps", "market"].filter(context => context !== identity.context)) {
      expectedFailure("BOUNDARY_DENIED", () => simulation.inspectWorkspace(identity.id, other));
    }
  }
});

test("all eighty role definitions have unique scoped permissions with no cross-boundary grant", () => {
  for (const [context, roles] of Object.entries(ADMIN_ROLE_CATALOG)) {
    assert.equal(new Set(roles.map(item => item.code)).size, 20);
    assert.equal(roles.filter(item => item.code === "readonly-observer").length, 1);
    for (const definition of roles) {
      assert.ok(definition.permissions.length > 0);
      assert.ok(definition.permissions.every(permission => permission.startsWith(`${context}.`)));
      assert.equal(new Set(definition.permissions).size, definition.permissions.length);
      assert.equal(Object.isFrozen(definition.permissions), true);
    }
  }
});

test("platform change requires separate initiator, security, release, and runtime actors", () => {
  const simulation = new AdminOperatingSimulation();
  simulation.seedVirtualActors();
  const initiator = actor(simulation, "platform", "operations-lead");
  const security = actor(simulation, "platform", "security-approver");
  const release = actor(simulation, "platform", "release-approver");
  const runtime = actor(simulation, "platform", "runtime-operator");
  const change = simulation.openCase(initiator.id, "platform_change", { change:"runtime-v29", rollback:"runtime-v28" });

  expectedFailure("PERMISSION_DENIED", () => simulation.approveCase(initiator.id, change.id, "platform.security.approve"));
  expectedFailure("APPROVALS_REQUIRED", () => simulation.completeCase(runtime.id, change.id));
  simulation.approveCase(security.id, change.id, "platform.security.approve");
  simulation.approveCase(release.id, change.id, "platform.release.approve");
  const completed = simulation.completeCase(runtime.id, change.id);

  assert.equal(completed.status, "completed");
  assert.equal(completed.completedBy, runtime.id);
});

test("OVERVA Apps release crosses into Market only through a redacted release handoff", () => {
  const simulation = new AdminOperatingSimulation();
  simulation.seedVirtualActors();
  const manager = actor(simulation, "apps", "product-manager");
  const qa = actor(simulation, "apps", "qa-approver");
  const productSecurity = actor(simulation, "apps", "security-reviewer");
  const release = actor(simulation, "apps", "release-manager");
  const intake = actor(simulation, "market", "listing-intake");
  const marketTechnical = actor(simulation, "market", "technical-reviewer");
  const marketSecurity = actor(simulation, "market", "security-reviewer");
  const publisher = actor(simulation, "market", "catalog-publisher");

  const product = simulation.openCase(manager.id, "apps_release", {
    productCode:"overva-inventory",
    sourceRepository:"private://apps/inventory",
    signingSecret:"must-never-cross"
  });
  simulation.approveCase(qa.id, product.id, "apps.qa.approve");
  simulation.approveCase(productSecurity.id, product.id, "apps.security.review");
  simulation.completeCase(release.id, product.id);

  expectedFailure("BOUNDARY_DENIED", () => simulation.readCase(intake.id, product.id));
  expectedFailure("PRIVATE_FIELD_DENIED", () => simulation.publishHandoff(release.id, product.id, "market", {
    productCode:"overva-inventory",
    name:"OVERVA Inventory",
    version:"1.0.0",
    signingSecret:"must-never-cross"
  }));

  const handoff = simulation.publishHandoff(release.id, product.id, "market", {
    productCode:"overva-inventory",
    name:"OVERVA Inventory",
    version:"1.0.0",
    supportPolicy:"Standard",
    releaseFingerprint:"sha256:demo",
    ownershipBadge:"OVERVA Apps"
  });
  simulation.acceptHandoff(intake.id, handoff.id);
  const listing = simulation.openCase(intake.id, "market_listing", { handoffId:handoff.id, supplier:"OVERVA Apps" });

  expectedFailure("PERMISSION_DENIED", () => simulation.approveCase(release.id, listing.id, "market.listing.technical.approve"));
  expectedFailure("BOUNDARY_DENIED", () => simulation.readCase(release.id, listing.id));
  simulation.approveCase(marketTechnical.id, listing.id, "market.listing.technical.approve");
  simulation.approveCase(marketSecurity.id, listing.id, "market.listing.security.approve");
  const published = simulation.completeCase(publisher.id, listing.id);

  assert.equal(published.status, "completed");
  assert.equal(JSON.stringify(simulation.readHandoff(intake.id, handoff.id)).includes("must-never-cross"), false);
});

test("Group oversight receives aggregates but no raw Platform, Apps, or Market case data", () => {
  const simulation = new AdminOperatingSimulation();
  simulation.seedVirtualActors();
  const platformLead = actor(simulation, "platform", "operations-lead");
  const groupObserver = actor(simulation, "group", "readonly-observer");
  const change = simulation.openCase(platformLead.id, "platform_change", { privateTenantReference:"tenant-secret" });

  expectedFailure("BOUNDARY_DENIED", () => simulation.readCase(groupObserver.id, change.id));
  const summary = simulation.groupSummary(groupObserver.id);
  assert.equal(summary.contexts.platform.openCases, 1);
  assert.equal(JSON.stringify(summary).includes("tenant-secret"), false);
  assert.ok(simulation.events.every((event, index) => Object.isFrozen(event) && event.sequence === index + 1));
});

test("same-boundary four-eyes rule blocks creators and approvers from completing their own case", () => {
  const simulation = new AdminOperatingSimulation();
  simulation.seedVirtualActors();
  const secretary = actor(simulation, "group", "policy-secretary");
  const risk = actor(simulation, "group", "risk-officer");
  const independence = actor(simulation, "group", "vendor-independence");
  const chair = actor(simulation, "group", "board-chair");
  const attestation = simulation.openCase(secretary.id, "group_attestation", { boundary:"apps-market", result:"pass" });

  simulation.approveCase(risk.id, attestation.id, "group.risk.review");
  simulation.approveCase(independence.id, attestation.id, "group.independence.review");
  expectedFailure("PERMISSION_DENIED", () => simulation.completeCase(secretary.id, attestation.id));
  const completed = simulation.completeCase(chair.id, attestation.id);
  assert.equal(completed.status, "completed");
});

test("returned snapshots cannot mutate internal status, approvals, handoffs, or private payloads", () => {
  const simulation = new AdminOperatingSimulation();
  simulation.seedVirtualActors();
  const manager = actor(simulation, "apps", "product-manager");
  const release = simulation.openCase(manager.id, "apps_release", { nested:{ secret:"sealed" } });

  assert.equal(Object.isFrozen(release), true);
  assert.equal(Object.isFrozen(release.data.nested), true);
  assert.throws(() => { release.status = "completed"; }, TypeError);
  assert.throws(() => { release.data.nested.secret = "changed"; }, TypeError);

  const reread = simulation.readCase(manager.id, release.id);
  assert.equal(reread.status, "open");
  assert.equal(reread.data.nested.secret, "sealed");
  assert.deepEqual(reread.approvals, {});
});
