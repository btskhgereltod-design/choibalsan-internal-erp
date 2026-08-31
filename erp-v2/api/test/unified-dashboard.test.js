"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {organizationScale}=require("../src/routes/dashboard");

const root=path.join(__dirname,"..","..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("organization scale only controls response density",()=>{
  assert.equal(organizationScale(1).code,"micro");
  assert.equal(organizationScale(9).mode,"essential");
  assert.equal(organizationScale(10).code,"small");
  assert.equal(organizationScale(50).code,"medium");
  assert.equal(organizationScale(250).mode,"enterprise");
  assert.equal(organizationScale(10).label,undefined);
});

test("unified dashboard is tenant scoped, truthful, and excludes private HR detail",()=>{
  const route=read("api/src/routes/dashboard.js");
  assert.match(route,/organization_id=\$1/);
  assert.match(route,/enabled_modules/);
  assert.doesNotMatch(route,/base_salary|id_card_no|personal_email/);
  assert.doesNotMatch(route,/health:\s*\{ score:/);
  assert.match(route,/minimum_stock>0 AND total_quantity<minimum_stock/);
  assert.match(route,/historical_open/);
  assert.match(route,/finance_obligations/);
  assert.match(route,/domain='camera'/);
  assert.match(route,/domain='lighting'/);
  assert.match(route,/safety_risks/);
  assert.match(route,/operations, metrics: operations, resources, alerts/);
});

test("organization home is tenant brandable and keeps onboarding under settings",()=>{
  const workspace=read("web/standard-workspace.js");
  const modules=read("web/business-modules.js");
  const organization=read("api/src/routes/organization.js");
  const migration=read("api/migrations/0077_organization_home_branding.sql");
  const dockerfile=read("web/Dockerfile");
  assert.match(workspace,/\/api\/dashboard\/overview/);
  assert.match(workspace,/settings\.home_banner_url/);
  assert.match(workspace,/settings\.home_welcome_text/);
  assert.doesNotMatch(workspace,/unified-score|dashboardStatus|dashboardScaleNote/);
  assert.match(modules,/name="homeBannerUrl"/);
  assert.match(modules,/name="homeWelcomeText"/);
  assert.match(organization,/home_banner_url,home_welcome_text/);
  assert.match(migration,/WHERE o\.id=s\.organization_id AND o\.slug='choibalsan-hugjil'/);
  assert.match(dockerfile,/COPY organization-assets/);
  assert.equal(fs.existsSync(path.join(root,"web","organization-assets","choibalsan-hugjil-banner.png")),true);
  assert.equal(fs.existsSync(path.join(root,"web","organization-assets","choibalsan-hugjil-logo.jpg")),true);
});

test("executive analysis hides inactive product areas",()=>{
  const executive=read("web/executive.js");
  assert.match(executive,/enabled\.has\("fleet"\)/);
  assert.match(executive,/enabled\.has\("iot"\)/);
  assert.match(executive,/enabled\.has\("inventory"\)/);
});
