"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeRoutePrefix, routesOverlap, validateModuleManifest } = require("../src/services/module-contract");

const manifest = {
  moduleCode:"hr",
  version:1,
  routePrefix:"/api/modules/hr",
  permissions:["hr.view","hr.employee.manage"],
  entities:["employee","employment-contract"],
  auditEvents:["hr.employee.created","hr.contract.changed"],
  navigation:[{code:"employees",label:"Ажилтны бүртгэл",path:"/api/modules/hr/employees",permission:"hr.view"}],
  dependencies:[],
};

test("module contract accepts governed OVERVA routes and dotted permissions", () => {
  const result=validateModuleManifest(manifest,[{route_prefix:"/api/platform",owner_code:"platform-admin",active:true}]);
  assert.equal(result.valid,true);
  assert.equal(result.manifest.routePrefix,"/api/modules/hr");
});

test("module contract rejects reserved route collisions", () => {
  const result=validateModuleManifest({...manifest,routePrefix:"/api/platform/hr"},[{route_prefix:"/api/platform",owner_code:"platform-admin",active:true}]);
  assert.equal(result.valid,false);
  assert.match(result.errors.map(item=>item.message).join(" "),/inside \/api\/modules\/hr|overlaps/);
});

test("route matching uses path segments rather than string fragments", () => {
  assert.equal(routesOverlap("/api/modules/hr","/api/modules/hr/employees"),true);
  assert.equal(routesOverlap("/api/modules/hr","/api/modules/hr-tools"),false);
  assert.equal(normalizeRoutePrefix("/API//MODULES/HR/"),"/api/modules/hr");
});
