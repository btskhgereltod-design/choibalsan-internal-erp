"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { requireModule, requireWorkspace, requirePermissions, requireSystemRoles, requirePlatformPermissions } = require("../src/middleware/auth");

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("enabled tenant module continues to the route", () => {
  let continued = false;
  requireModule("inventory")({ user:{ enabled_modules:["core-work","inventory"] } }, response(), () => { continued = true; });
  assert.equal(continued, true);
});

test("disabled tenant module is rejected with a stable code", () => {
  const res = response();
  requireModule("iot")({ user:{ enabled_modules:["core-work"] } }, res, () => assert.fail("must not continue"));
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "MODULE_DISABLED");
  assert.equal(res.body.module, "iot");
});

test("workspace middleware requires assignment access but preserves owner oversight", () => {
  let continued = false;
  requireWorkspace("camera")(
    { user:{ workspace_codes:["camera"], system_roles:[] } }, response(), () => { continued = true; }
  );
  assert.equal(continued, true);

  let ownerContinued = false;
  requireWorkspace("camera")(
    { user:{ workspace_codes:[], system_roles:["owner"] } }, response(), () => { ownerContinued = true; }
  );
  assert.equal(ownerContinued, true);

  const denied = response();
  requireWorkspace("camera")(
    { user:{ workspace_codes:["work-orders"], system_roles:[] } }, denied, () => assert.fail("must not continue")
  );
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.body.code, "WORKSPACE_ACCESS_REQUIRED");
  assert.equal(denied.body.workspace, "camera");
});

test("permission middleware requires every requested permission", () => {
  let continued = false;
  requirePermissions("users.manage","audit.read")(
    { user:{ permissions:["users.manage","audit.read"] } }, response(), () => { continued = true; }
  );
  assert.equal(continued, true);
  const denied = response();
  requirePermissions("finance.manage")({ user:{ permissions:["audit.read"] } }, denied, () => assert.fail("must not continue"));
  assert.equal(denied.statusCode, 403);
});

test("primary-admin middleware requires the owner system role", () => {
  let continued = false;
  requireSystemRoles("owner")({ user:{ system_roles:["owner"] } }, response(), () => { continued = true; });
  assert.equal(continued, true);
  const denied = response();
  requireSystemRoles("owner")({ user:{ system_roles:["administrator"] } }, denied, () => assert.fail("must not continue"));
  assert.equal(denied.statusCode, 403);
});

test("Platform permission middleware requires every live server-derived grant", () => {
  let continued = false;
  requirePlatformPermissions("platform.organizations.read", "platform.adoption.read")(
    { platformAdmin:{ permissions:["platform.organizations.read", "platform.adoption.read"] } },
    response(),
    () => { continued = true; }
  );
  assert.equal(continued, true);

  const denied = response();
  requirePlatformPermissions("platform.billing.manage")(
    { platformAdmin:{ permissions:["platform.billing.read"] } },
    denied,
    () => assert.fail("must not continue")
  );
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.body.code, "PLATFORM_PERMISSION_REQUIRED");
  assert.deepEqual(denied.body.permissions, ["platform.billing.manage"]);
});
