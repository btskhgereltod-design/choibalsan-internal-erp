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

test("unified dashboard is tenant scoped, truthful, and limits private HR detail to the signed-in employee",()=>{
  const route=read("api/src/routes/dashboard.js");
  assert.match(route,/organization_id=\$1/);
  assert.match(route,/enabled_modules/);
  assert.doesNotMatch(route,/id_card_no|personal_email/);
  assert.match(route,/c\.employee_id=e\.id AND c\.approved_by IS NOT NULL/);
  assert.match(route,/WHERE e\.organization_id=\$1 AND e\.id=\$2/);
  assert.match(route,/netPay: null/);
  assert.match(route,/dataQuality: management \?/);
  assert.doesNotMatch(route,/health:\s*\{ score:/);
  assert.match(route,/minimum_stock>0 AND total_quantity<minimum_stock/);
  assert.match(route,/historical_open/);
  assert.match(route,/finance_obligations/);
  assert.match(route,/domain='camera'/);
  assert.match(route,/domain='lighting'/);
  assert.match(route,/safety_risks/);
  assert.match(route,/operations, metrics: operations, resources, alerts/);
});

test("report schedule attention is permission scoped, tenant dated, and opens the schedule",()=>{
  const route=read("api/src/routes/dashboard.js");
  const workspace=read("web/standard-workspace.js");
  const app=read("web/app.js");
  assert.match(route,/permissions\.has\("report-schedules\.read"\)/);
  assert.match(route,/schedule\.organization_id=\$1 AND schedule\.active=true/);
  assert.match(route,/\$3::boolean OR schedule\.responsible_user_id=\$2/);
  assert.match(route,/AT TIME ZONE COALESCE\(NULLIF\(organization\.timezone,''\),'Asia\/Ulaanbaatar'\)/);
  assert.match(route,/schedule\.next_due<=tenant_day\.today\+schedule\.warn_days/);
  assert.match(route,/reportTab: "schedule"/);
  assert.match(workspace,/data-report-tab-target/);
  assert.match(app,/go\.dataset\.reportTabTarget/);
});

test("information flow is a tenant and permission scoped read model over domain evidence",()=>{
  const route=read("api/src/routes/dashboard.js");
  const workspace=read("web/standard-workspace.js");
  const workspaceCss=read("web/standard-workspace.css");
  const html=read("web/index.html");
  assert.match(route,/withTenantTransaction\(organizationId/);
  assert.match(route,/work_order_events/);
  assert.match(route,/correspondence_events/);
  assert.match(route,/employee_events/);
  assert.match(route,/stock_movements/);
  assert.match(route,/finance_obligation_events/);
  assert.match(route,/accounting_material_review_events/);
  assert.match(route,/finance_transactions/);
  assert.match(route,/for \(const task of tasks\) results\.push\(await task\(\)\)/);
  assert.doesNotMatch(route,/Promise\.all\(tasks\)/);
  assert.match(route,/permissions\.has\("work-orders\.read"\)/);
  assert.match(route,/recordsReadPermissions\.some/);
  assert.match(route,/hrReadPermissions\.some/);
  assert.match(route,/permissions\.has\("inventory\.read"\)/);
  assert.match(route,/permissions\.has\("finance\.read"\)/);
  assert.match(route,/confidentiality IN\('confidential','restricted'\)/);
  assert.doesNotMatch(route,/e\.note [a-z_]+/);
  assert.match(route,/enabledModules: \[\.\.\.enabled\].*activity/s);
  assert.match(workspace,/function informationFlowBoard/);
  assert.match(workspace,/Мэдээллийн урсгал/);
  assert.match(workspaceCss,/\.information-flow-item/);
  assert.match(html,/standard-workspace\.css\?v=36/);
  assert.match(html,/standard-workspace\.js\?v=45/);
});

test("organization home includes truthful legacy-familiar workforce attendance and work signals",()=>{
  const route=read("api/src/routes/dashboard.js");
  const workspace=read("web/standard-workspace.js");
  const workspaceCss=read("web/standard-workspace.css");
  assert.match(route,/count\(\*\) FILTER\(WHERE status='remote'\)/);
  assert.match(route,/COALESCE\(sum\(overtime_hours\),0\)/);
  assert.match(route,/total_year/);
  assert.match(route,/completed_year/);
  assert.match(route,/attendance\.attendance_date=\(now\(\) AT TIME ZONE COALESCE/);
  assert.match(route,/date_trunc\('year',\(now\(\) AT TIME ZONE COALESCE/);
  assert.match(route,/label: "Нийт ажилтан"/);
  assert.match(route,/label: "Өнөөдөр ирсэн"/);
  assert.match(route,/label: "Нийт ажил"/);
  assert.match(route,/label: "Ажлын дундаж явц"/);
  assert.match(route,/Дууссан ажлын хувь/);
  assert.match(route,/attendanceOverview: enabled\.has\("attendance"\) && hrAccess/);
  assert.match(workspace,/function attendanceOverview/);
  assert.match(workspace,/\["absent","[^\"]+",data\.absent\]/);
  assert.match(workspace,/Чөлөөтэй/);
  assert.match(workspace,/Өвчтэй/);
  assert.match(workspace,/Амралт/);
  assert.match(workspace,/Илүү цаг/);
  assert.match(workspace,/data-go="attendance"/);
  assert.match(workspace,/hero-brand-edit/);
  assert.match(workspace,/const updatedAt=new Intl\.DateTimeFormat\("mn-MN",\{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"/);
  assert.doesNotMatch(workspace,/\$\{esc\(updatedAt\)\} шинэчлэгдсэн/);
  assert.doesNotMatch(workspace,/const today=new Intl\.DateTimeFormat/);
  assert.match(workspaceCss,/\.organization-meta\{display:flex/);
  assert.match(workspace,/data-settings-tab-target="organization"/);
  assert.doesNotMatch(workspace,/class="hero-refresh"/);
  assert.match(workspaceCss,/\.attendance-overview/);
  assert.match(workspaceCss,/grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
});

test("organization home projects live lighting and camera operational summaries",()=>{
  const route=read("api/src/routes/dashboard.js");
  const workspace=read("web/standard-workspace.js");
  const workspaceCss=read("web/standard-workspace.css");
  assert.match(route,/lightingOverview, cameraOverview/);
  assert.match(route,/operational_object_specifications/);
  assert.match(route,/operational_object_lamp_groups/);
  assert.match(route,/operational_object_camera_devices/);
  assert.match(route,/GREATEST\(affected_quantity-resolved_quantity,0\)/);
  assert.match(route,/source_import_records/);
  assert.match(route,/category='Гэрлэн дохио'/);
  assert.match(route,/infrastructure: data\.lightingOverview\.length \|\| data\.cameraOverview/);
  assert.match(workspace,/function infrastructureOverview/);
  assert.match(workspace,/Гэрэлтүүлгийн тойм/);
  assert.match(workspace,/Камерын тойм/);
  assert.match(workspace,/ангилал хүлээж буй/);
  assert.match(workspace,/duplicateViews=new Set/);
  assert.match(workspace,/dashboard-lower/);
  assert.match(workspace,/section class="panel resource-cluster"/);
  assert.match(workspace,/resources=\(d\.resources\|\|\[\]\)\.slice\(0,5\)/);
  assert.match(workspace,/groups\.size/);
  assert.doesNotMatch(workspace,/home-view-switch/);
  assert.match(route,/resources\.push\(\{ code: "assets", label: "Үндсэн хөрөнгө"/);
  assert.doesNotMatch(route,/operations\.push\(\{ code: "assets"/);
  assert.match(workspaceCss,/\.infrastructure-overview/);
  assert.match(workspaceCss,/\.camera-overview-facts/);
  assert.match(workspaceCss,/\.resource-cluster \.unified-metric:last-child:nth-child\(odd\)/);
});

test("organization home is tenant brandable and keeps onboarding under settings",()=>{
  const workspace=read("web/standard-workspace.js");
  const workspaceCss=read("web/standard-workspace.css");
  const html=read("web/index.html");
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
  assert.match(workspaceCss,/#pageContent:has\(> \.organization-home\):has\(> \.dashboard-lower\)/);
  assert.match(workspaceCss,/\.dashboard-lower\{display:grid;grid-template-columns/);
  assert.match(html,/standard-workspace\.css\?v=36/);
  assert.match(migration,/WHERE o\.id=s\.organization_id AND o\.slug='choibalsan-hugjil'/);
  assert.match(dockerfile,/COPY organization-assets/);
  assert.equal(fs.existsSync(path.join(root,"web","organization-assets","choibalsan-hugjil-banner.png")),true);
  assert.equal(fs.existsSync(path.join(root,"web","organization-assets","choibalsan-hugjil-logo.jpg")),true);
});

test("executive analysis compares periods and returns only role-scoped live sections",()=>{
  const executive=read("web/executive.js"),route=read("api/src/routes/executive.js");
  assert.match(executive,/\[14,30,90\]/);
  assert.match(executive,/previous/);
  assert.doesNotMatch(executive,/enabled\.has\("fleet"\)|enabled\.has\("iot"\)/);
  assert.match(route,/operationsAccess/);
  assert.match(route,/peopleAccess/);
  assert.match(route,/financeAccess/);
  assert.match(route,/minimum_stock>0 AND total_quantity<minimum_stock/);
  assert.doesNotMatch(route,/healthScore/);
});
