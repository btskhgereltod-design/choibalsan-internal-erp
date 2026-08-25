"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { requireModule, requirePermissions, requireSystemRoles } = require("../src/middleware/auth");

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
