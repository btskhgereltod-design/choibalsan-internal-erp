"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const policy=require("../../web/workspace-policy.js");
const fs=require("node:fs"),path=require("node:path");
const webFile=name=>fs.readFileSync(path.join(__dirname,"../../web",name),"utf8");

const viewModules={assets:"assets","work-orders":"work-orders",engineering:"work-orders",lighting:"lighting-operations",camera:"camera-operations",map:"map",fleet:"fleet",structure:"structure"};

test("primary admin keeps setup access and also receives the job-role workspace",()=>{
  const views=policy.allowedViews({role:"director",systemRoles:["owner"],permissions:["audit.read"],enabledModules:["structure","assets","work-orders","map","fleet"],viewModules});
  assert.deepEqual(new Set(views),new Set(["dashboard","assets","work-orders","engineering","executive","reports","employees","users","settings","billing","audit","connectors"]));
});

test("primary admin sees all enabled standard organization workspaces",()=>{
  const modules={
    finance:"finance",inventory:"inventory",procurement:"procurement",
    assets:"assets",maintenance:"maintenance",safety:"safety",
    map:"map",iot:"iot"
  };
  const views=policy.allowedViews({
    role:"director",
    systemRoles:["owner"],
    enabledModules:["finance","inventory","procurement","assets","maintenance","safety","map","iot"],
    viewModules:modules
  });
  for(const view of ["finance","inventory","procurement","assets","maintenance","safety"]){
    assert.equal(views.includes(view),true,`${view} should be visible to the primary admin`);
  }
  assert.equal(views.includes("map"),false,"advanced map workspace stays hidden");
  assert.equal(views.includes("iot"),false,"advanced IoT workspace stays hidden");
});

test("primary admin does not see a standard workspace that the tenant has not enabled",()=>{
  const views=policy.allowedViews({
    role:"director",systemRoles:["owner"],enabledModules:["finance"],
    viewModules:{finance:"finance",inventory:"inventory",maintenance:"maintenance"}
  });
  assert.equal(views.includes("finance"),true);
  assert.equal(views.includes("inventory"),false);
  assert.equal(views.includes("maintenance"),false);
});

test("one-person organization owner is not locked out of their operational work",()=>{
  const views=policy.allowedViews({role:"storekeeper",systemRoles:["owner"],permissions:[],enabledModules:["inventory","procurement","assets"],viewModules:{inventory:"inventory",procurement:"procurement",assets:"assets"}});
  assert.equal(views.includes("settings"),true);
  assert.equal(views.includes("inventory"),true);
  assert.equal(views.includes("procurement"),true);
  assert.equal(views.includes("assets"),true);
});

test("organization administrator cannot open primary-admin settings",()=>{
  const views=policy.allowedViews({role:"director",systemRoles:["administrator"],permissions:["audit.read"],enabledModules:["structure"],viewModules});
  assert.equal(views.includes("settings"),false);
  assert.equal(views.includes("users"),false);
  assert.equal(views.includes("audit"),false);
  assert.equal(views.includes("employees"),true);
});

test("advanced product surfaces stay out of standard role workspaces",()=>{
  const views=policy.allowedViews({role:"chief_engineer",systemRoles:["manager"],permissions:[],enabledModules:["assets","work-orders","map","fleet","maintenance","safety","field"],viewModules:{...viewModules,maintenance:"maintenance",safety:"safety",mobile:"field"}});
  assert.equal(views.includes("map"),false);
  assert.equal(views.includes("fleet"),false);
  assert.equal(views.includes("builder"),false);
  assert.equal(views.includes("assets"),true);
  assert.equal(views.includes("work-orders"),true);
  assert.equal(views.includes("engineering"),true);
});

test("disabled modules do not appear even when the job role normally uses them",()=>{
  const views=policy.allowedViews({role:"storekeeper",enabledModules:["inventory"],viewModules:{inventory:"inventory",procurement:"procurement",assets:"assets"}});
  assert.equal(views.includes("inventory"),true);
  assert.equal(views.includes("procurement"),false);
  assert.equal(views.includes("assets"),false);
});

test("active assignment workspace mapping adds an enabled standard workspace",()=>{
  const views=policy.allowedViews({
    role:"worker",
    workspaceCodes:["finance"],
    enabledModules:["finance"],
    viewModules:{finance:"finance"}
  });
  assert.equal(views.includes("finance"),true);
});

test("assignment workspace mapping cannot bypass tenant module enablement",()=>{
  const views=policy.allowedViews({
    role:"worker",
    workspaceCodes:["finance"],
    enabledModules:[],
    viewModules:{finance:"finance"}
  });
  assert.equal(views.includes("finance"),false);
});

test("assignment mapping cannot expose an advanced workspace",()=>{
  const views=policy.allowedViews({
    role:"worker",
    workspaceCodes:["map"],
    enabledModules:["map"],
    viewModules:{map:"map"}
  });
  assert.equal(views.includes("map"),false);
});

test("safety officer receives the work-order approval workspace",()=>{
  const views=policy.allowedViews({role:"safety",enabledModules:["safety","work-orders"],viewModules:{safety:"safety","work-orders":"work-orders"}});
  assert.equal(views.includes("safety"),true);
  assert.equal(views.includes("work-orders"),true);
});

test("director can oversee organization work flows",()=>{
  const views=policy.allowedViews({role:"director",enabledModules:["work-orders"],viewModules});
  assert.equal(views.includes("work-orders"),true);
});

test("lighting specialization appears only when enabled for the tenant",()=>{
  const hidden=policy.allowedViews({role:"electric",enabledModules:["assets","work-orders"],viewModules});
  const visible=policy.allowedViews({role:"electric",enabledModules:["assets","work-orders","lighting-operations"],viewModules});
  assert.equal(hidden.includes("lighting"),false);
  assert.equal(visible.includes("lighting"),true);
});

test("camera workspace follows tenant enablement and camera role access",()=>{
  const hidden=policy.allowedViews({role:"camera_engineer",enabledModules:["assets","work-orders"],viewModules});
  const visible=policy.allowedViews({role:"camera_engineer",enabledModules:["assets","work-orders","camera-operations"],viewModules});
  assert.equal(hidden.includes("camera"),false);
  assert.equal(visible.includes("camera"),true);
});

test("tenant subscription workspace uses the unambiguous package and billing label",()=>{
  const shell=webFile("index.html"),modules=webFile("business-modules.js");
  assert.match(shell,/id="billingNav"[^>]*><span>[^<]*<\/span>Багц ба төлбөр<\/button>/);
  assert.match(modules,/billing:"Багц ба төлбөр"/);
  assert.doesNotMatch(shell,/id="billingNav"[^>]*><span>[^<]*<\/span>Үйлчилгээний эрх<\/button>/);
});

test("organization structure is nested under primary-admin settings",()=>{
  const shell=webFile("index.html"),modules=webFile("business-modules.js"),workspace=webFile("standard-workspace.js"),dashboard=fs.readFileSync(path.join(__dirname,"..","src","routes","dashboard.js"),"utf8");
  assert.match(shell,/id="structureNav"[^>]*display:none!important/);
  assert.match(modules,/data-settings-tab="structure"/);
  assert.match(modules,/structureSettingsContent\(\)/);
  assert.match(workspace,/data-settings-tab-target/);
  assert.match(dashboard,/tab: "structure"/);
});

test("organization setup visibly summarizes the approved structure",()=>{
  const blueprint=webFile("organization-blueprint.js");
  assert.match(blueprint,/function blueprintCurrentStructure\(\)/);
  assert.match(blueprint,/Одоогийн батлагдсан бүтэц/);
  assert.match(blueprint,/positionsByDepartment/);
  assert.match(blueprint,/staffedByPosition/);
  assert.match(blueprint,/blueprintCurrentStructure\(\)/);
});
