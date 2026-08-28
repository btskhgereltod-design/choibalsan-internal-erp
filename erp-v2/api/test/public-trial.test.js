"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { trialSchema, trialModuleCodes, reservedSlugs } = require("../src/routes/public");

const validTrial = {
  organizationName: "Example Service LLC",
  organizationCode: "example-service",
  fullName: "Trial Owner",
  email: "owner@example.invalid",
  username: "owner",
  password: "A-long-password-2026",
  modules: ["assets", "work-orders", "inventory"],
  acceptedTerms: true,
  website: "",
};

test("public trial accepts only the approved module catalog", () => {
  assert.equal(trialSchema.safeParse(validTrial).success, true);
  assert.equal(trialSchema.safeParse({ ...validTrial, modules: ["iot"] }).success, false);
  assert.equal(trialModuleCodes.includes("iot"), false);
});

test("public trial requires a strong password and explicit terms", () => {
  assert.equal(trialSchema.safeParse({ ...validTrial, password: "short" }).success, false);
  assert.equal(trialSchema.safeParse({ ...validTrial, acceptedTerms: false }).success, false);
});

test("public trial honeypot rejects automated form fills", () => {
  assert.equal(trialSchema.safeParse({ ...validTrial, website: "https://spam.invalid" }).success, false);
});

test("infrastructure and generic test slugs stay reserved", () => {
  for (const slug of ["admin", "api", "app", "demo", "test"]) assert.equal(reservedSlugs.has(slug), true);
});

test("public site starts with a portfolio Home and opens the governed workspace Studio", () => {
  const publicRoot = path.join(__dirname, "..", "..", "public-site");
  const html = fs.readFileSync(path.join(publicRoot, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(publicRoot, "site.css"), "utf8");
  const js = fs.readFileSync(path.join(publicRoot, "site.js"), "utf8");
  const memoryJs = fs.readFileSync(path.join(publicRoot, "conversation-memory.js"), "utf8");
  const lifecycleJs = fs.readFileSync(path.join(publicRoot, "workspace-lifecycle.js"), "utf8");
  const registryJs = fs.readFileSync(path.join(publicRoot, "workspace-registry.js"), "utf8");
  const intakeJs = fs.readFileSync(path.join(publicRoot, "workspace-intake.js"), "utf8");
  const requestDraftRegistryJs = fs.readFileSync(path.join(publicRoot, "request-draft-registry.js"), "utf8");
  assert.match(html, /Таны байгууллагын хэрэгцээг хамтдаа тодорхойлъё/);
  assert.match(html, /class="studio-sidebar"/);
  assert.match(html, /class="chat-panel"/);
  assert.match(html, /class="preview-panel"/);
  assert.match(html, /id="portfolioHome"/);
  assert.match(html, /id="workspaceStudio"/);
  assert.match(html, /Хэрэгтэй ажлаа ойлгомжтой хүсэлт болгох/);
  assert.match(html, /Жишиг хүсэлтээс санаа авч/);
  assert.match(html, /Хүсэлт гаргах/);
  assert.match(html, /id="homeIntentHelp"/);
  assert.match(html, /class="home-submit" type="submit" disabled/);
  assert.match(html, /id="requestMarket"/);
  assert.match(html, /data-market-view="all"/);
  assert.match(html, /data-market-view="mine"/);
  assert.match(html, /data-market-view="projects"/);
  assert.match(html, /data-market-view="labs"/);
  assert.match(html, /data-market-panel="request-detail"/);
  assert.match(html, /data-market-view="rules"/);
  assert.match(html, /data-market-role="customer"/);
  assert.match(html, /data-market-role="provider"/);
  assert.match(html, /data-market-view="proposals"/);
  assert.match(html, /data-market-view="deliveries"/);
  assert.match(html, /data-market-view="provider-rules"/);
  const customerNav = html.match(/<nav class="market-side-nav" data-market-role-nav="customer"[\s\S]*?<\/nav>/)?.[0] || "";
  const providerNav = html.match(/<nav class="market-side-nav hidden" data-market-role-nav="provider"[\s\S]*?<\/nav>/)?.[0] || "";
  assert.doesNotMatch(customerNav, /data-market-view="labs"/);
  assert.doesNotMatch(customerNav, /data-market-view="rules"/);
  assert.doesNotMatch(providerNav, /data-market-view="provider-rules"/);
  assert.match(html, /data-market-role-guide="customer"/);
  assert.match(html, /data-market-role-guide="provider"/);
  assert.match(html, /Хамтын тодруулга бол сонголт/);
  assert.match(html, /Хоёр тал хүсвэл алгасана/);
  assert.match(html, /Код бичих өрөө биш/);
  assert.match(html, /Одоогоор нээлттэй бодит ажил алга/);
  assert.match(html, /id="myRequestList"/);
  assert.match(html, /class="market-panel market-rules hidden"/);
  assert.match(html, /data-request-source="file"/);
  assert.match(html, /data-request-source="image"/);
  assert.match(html, /Жишиг хүсэлт/);
  assert.match(html, /бодит нийтлэгдсэн захиалга биш/);
  assert.match(html, /data-request-template="inventory"/);
  assert.match(html, /data-request-template="approval"/);
  assert.match(html, /data-request-template="service"/);
  assert.match(html, /data-request-template="crm"/);
  assert.match(html, /id="requestDialog"/);
  assert.match(html, /id="homeRequestFileInput"/);
  assert.match(html, /id="homeRequestImageInput"/);
  assert.match(html, /id="requestMaterialSummary"/);
  assert.match(html, /Файлын агуулгыг сервер эсвэл AI руу илгээхгүй/);
  assert.match(html, /name="requestType"/);
  assert.match(html, /name="businessArea"/);
  assert.match(html, /name="capabilities"/);
  assert.match(html, /name="budgetModel"/);
  assert.match(html, /name="period"/);
  assert.match(html, /name="visibility"/);
  assert.match(html, /name="aiReview"/);
  assert.match(html, /name="acceptanceCriteria"/);
  assert.match(html, /AI-тай заавал ярилцахгүй/);
  assert.match(html, /Одоохондоо нийтлэхгүй/);
  assert.match(html, /Гүйцэтгэгчийн бодит санал, төлбөр эсвэл гэрээ автоматаар үүсэхгүй/);
  assert.match(html, /Энд батлах шаардлага, эхний preview гарна/);
  assert.match(html, /1 · Асуудлаа ярь/);
  assert.match(html, /id="homeValueTitle"/);
  assert.match(html, /Хүсэлтээ бүтэцтэй гаргах/);
  assert.match(html, /Шаардлагаа шалгаж батлах/);
  assert.match(html, /Саналуудыг нэг хэлээр харьцуулах/);
  assert.match(html, /Хүсэлтээс ажлын үр дүн хүртэлх үндсэн зарчим/);
  assert.match(html, /Ажил хэрэгжүүлэх бүрэн дараалал/);
  assert.match(html, /Ашиглалтад оруулах/);
  assert.match(html, /Concierge pilot · Удахгүй/);
  assert.match(html, /Гадаад мэдээллийн эх үүсвэр/);
  assert.match(html, /id="homeWorkspaceGrid"/);
  assert.match(html, /data-market-category="all"/);
  assert.match(html, /id="workspaceHomeButton"/);
  assert.match(html, /Миний ажлууд/);
  assert.doesNotMatch(html, /data-home-view=/);
  assert.doesNotMatch(html, />Холболтын ажил</);
  assert.match(html, /site\.css\?v=24/);
  assert.match(html, /site\.js\?v=24/);
  assert.match(html, /request-draft-registry\.js\?v=2/);
  assert.match(html, /conversation-memory\.js\?v=15/);
  assert.match(html, /workspace-lifecycle\.js\?v=14/);
  assert.match(html, /workspace-registry\.js\?v=14/);
  assert.match(html, /workspace-intake\.js\?v=14\.1/);
  assert.match(html, /Байгууллагаа үгээр тайлбарлах/);
  assert.match(html, /OVERVA-д материал өгөх/);
  assert.match(html, /overva-organization-template\.csv/);
  assert.match(html, /data-preview-tab="structure"/);
  assert.match(html, /data-preview-tab="systems"/);
  assert.match(html, /Товчнуудыг дарж туршина уу/);
  assert.doesNotMatch(html, /class="approval-bar"/);
  assert.match(html, /Туршилтын орчин · зөвхөн энэ төхөөрөмжид хадгална/);
  assert.match(html, /Enter — илгээх/);
  assert.match(html, /АЖЛЫН ӨРӨӨГӨӨ ХАДГАЛАХ/);
  assert.match(html, /Ажлын өрөөний нэр/);
  assert.match(html, /Энэ төхөөрөмжид хадгалах/);
  assert.match(html, /id="deliveryStagebar"/);
  assert.match(html, /id="sidebarLifecycle"/);
  assert.match(html, /id="sidebarStageCount"/);
  assert.match(html, /id="workspaceSelector"/);
  assert.match(html, /data-sidebar-action="material"/);
  assert.match(html, /data-sidebar-action="decisions"/);
  assert.match(html, /data-sidebar-action="tests"/);
  assert.match(html, /Production-д гаргах түгжээтэй/);
  assert.match(html, /id="trialSummaryName"/);
  assert.match(html, /id="trialSummaryCapabilities"/);
  assert.doesNotMatch(html, /<label>Байгууллагын код/);
  assert.doesNotMatch(html, /<label>Хэрэглэгчийн нэр/);
  assert.doesNotMatch(html, /<legend>Турших модулиуд/);
  assert.doesNotMatch(html, /name="email"/);
  assert.doesNotMatch(html, /name="password"/);
  assert.doesNotMatch(html, /id="successLogin"/);
  assert.match(css, /html, body \{ width:100%; height:100%; overflow:hidden;/);
  assert.match(css, /grid-template-columns:220px/);
  assert.match(css, /\.portfolio-home/);
  assert.match(css, /\.workspace-card-grid/);
  assert.match(css, /\.back-to-home/);
  assert.match(css, /\.journey-step\.current/);
  assert.match(js, /guidePaths/);
  assert.match(js, /addAssistantReply/);
  assert.match(js, /renderPreview/);
  assert.match(js, /data-preview-action/);
  assert.match(js, /handleSourceFile/);
  assert.match(js, /suggestWorkspaceName/);
  assert.doesNotMatch(js, /makeOrganizationCode/);
  assert.doesNotMatch(js, /\/api\/public\/trials/);
  assert.match(js, /renderDeliveryLifecycle/);
  assert.match(js, /renderPortfolioHome/);
  assert.match(js, /workspace-local-badge/);
  assert.match(js, /Өмнөх туршилтын ажил · бодит төсөл биш/);
  assert.match(js, /includeCreate:false/);
  assert.match(js, /Тохирох ажлаа олох/);
  assert.match(js, /Нээлттэй бодит ажил биш/);
  assert.match(js, /showRequestDetail/);
  assert.match(js, /reviewWorkspaceId/);
  assert.match(js, /renderMyRequests/);
  assert.match(js, /filterMarketRequests/);
  assert.match(js, /showMarketView/);
  assert.match(js, /beginWorkspaceFromHome/);
  assert.match(js, /dataset\.homeText/);
  assert.match(js, /openRequestDialog/);
  assert.match(js, /compileRequestPackage/);
  assert.match(js, /requestMaterialFromFile/);
  assert.match(js, /materials:material \? \[material\] : \[\]/);
  assert.match(js, /materialSource:material/);
  assert.match(js, /input\.click\(\)/);
  assert.doesNotMatch(js, /data-home-source[^\n]+beginWorkspaceFromHome/);
  assert.match(js, /overva\.public\.request\.drafts\.v2/);
  assert.match(js, /overva\.public\.request\.draft\.v1/);
  assert.match(js, /requestDraftId:id/);
  assert.match(js, /published:false/);
  assert.match(js, /if \(!value && !sourceKind\) \{ focusHomeNeedInput\(\); return false; \}/);
  assert.match(js, /homeIntentSubmit\.disabled = !hasText/);
  assert.match(js, /showWorkspace/);
  assert.match(js, /workspaceHomeButton/);
  assert.doesNotMatch(js, /dataset\.homeView/);
  assert.match(js, /handleLifecycleStage/);
  assert.match(js, /handleSidebarAction/);
  assert.match(js, /Preview туршилтын түүх/);
  assert.match(js, /shouldChooseWorkspace/);
  assert.match(js, /Шинэ ажлын өрөө болгох/);
  assert.match(js, /extractOrganizationProfile/);
  assert.match(intakeJs, /zasvar\|camera\|camer\|gerel/);
  assert.match(js, /overva\.public\.workspace\.v2/);
  assert.match(js, /handleContextIntent/);
  assert.match(js, /confirmationStatus/);
  assert.match(js, /executionVerification/);
  assert.match(js, /memoryAnswer/);
  assert.match(memoryJs, /svvld\|suuld/);
  assert.match(memoryJs, /previewActivity/);
  assert.match(lifecycleJs, /scopeFrozen/);
  assert.match(lifecycleJs, /canPublish/);
  assert.match(registryJs, /startNewWorkspace/);
  assert.match(memoryJs, /бодит ажил эхэлсэн, үндсэн мэдээлэл өөрчлөгдсөн гэж тооцоогүй/);
  assert.match(js, /Сайн байна уу\. Өмнөх ажил тань хадгалагдсан байна/);
  assert.match(js, /Тэндээс үргэлжлүүлэх/);
  assert.match(js, /Энэ материал browser-оос гараагүй/);
  assert.match(js, /баталсны дараа л ажилтны үндсэн бүртгэл үүснэ/);
  assert.match(js, /modules:\["hr","records"\]/);
  const template = fs.readFileSync(path.join(publicRoot, "overva-organization-template.csv"), "utf8");
  const dockerfile = fs.readFileSync(path.join(publicRoot, "Dockerfile"), "utf8");
  assert.match(template, /Одоо ашигладаг систем/);
  assert.match(dockerfile, /COPY overva-organization-template\.csv/);
  assert.match(dockerfile, /COPY conversation-memory\.js/);
  assert.match(dockerfile, /COPY workspace-lifecycle\.js/);
  assert.match(dockerfile, /COPY workspace-registry\.js/);
  assert.match(dockerfile, /COPY workspace-intake\.js/);
  assert.match(dockerfile, /COPY request-draft-registry\.js/);
  assert.match(requestDraftRegistryJs, /Draft revision must increase/);
});

test("request drafts migrate safely, remain separate and link to stable workspaces", () => {
  const drafts = require("../../public-site/request-draft-registry");
  let sequence = 0;
  const options = {
    createId:() => `draft-${++sequence}`,
    createWorkspaceId:() => "workspace-created",
    resolveLegacyWorkspaceId:() => "workspace-current",
    now:"2026-08-27T10:00:00.000Z"
  };
  let registry = drafts.normalizeRegistry(null, {
    version:1,
    createdAt:"2026-08-27T09:00:00.000Z",
    title:"Legacy request",
    packageText:"Legacy package",
    published:false
  }, options);
  assert.equal(registry.items.length, 1);
  assert.equal(registry.items[0].reviewWorkspaceId, "workspace-current");
  assert.equal(registry.items[0].migratedFrom, "overva.public.request.draft.v1");

  registry = drafts.upsertDraft(registry, {
    id:"draft-new",
    revision:1,
    reviewWorkspaceId:"workspace-new",
    title:"New request",
    packageText:"New package",
    published:false
  });
  assert.equal(registry.items.length, 2);
  assert.equal(drafts.findDraftByWorkspace(registry, "workspace-current").title, "Legacy request");
  assert.equal(drafts.findDraftByWorkspace(registry, "workspace-new").title, "New request");
  assert.throws(() => drafts.upsertDraft(registry, { ...registry.items[1] }), /revision must increase/);

  registry = drafts.upsertDraft(registry, { ...registry.items[1], revision:2, title:"Updated request" });
  assert.equal(registry.items.length, 2);
  assert.equal(drafts.findDraftByWorkspace(registry, "workspace-new").revision, 2);

  const memory = require("../../public-site/conversation-memory");
  const checkpoint = memory.createCheckpoint(null, { guide:"discover", product:"Request", source:null }, {
    requestDraftId:"draft-new",
    newHypothesis:true,
    now:"2026-08-27T10:05:00.000Z"
  });
  assert.equal(checkpoint.requestDraftId, "draft-new");
  const updated = memory.createCheckpoint(checkpoint, { guide:"discover", product:"Request", source:null }, {
    lastAction:"reviewed",
    now:"2026-08-27T10:06:00.000Z"
  });
  assert.equal(updated.requestDraftId, "draft-new");
});

test("Latin-Mongol organization intake stays preliminary and drives a relevant preview guide", () => {
  const intake = require("../../public-site/workspace-intake");
  assert.equal(intake.inferGuide("Манай агуулахын үлдэгдэл Excel дээр зөрдөг."), "discover");
  assert.equal(intake.inferGuide("Ажилтны мэдээллийг Excel файлаас импортолно."), "import");
  assert.equal(intake.inferGuide("Манай засварын хүсэлтийн урсгалыг цахимжуулна."), "workflow");
  const text = "manai baiguulga gerel setgemj gedeg 21 ajiltantai gereltuulegiin zasvar camer hyanalt zasvar zahirgaa aj ah";
  const profile = intake.extractOrganizationProfile(text);
  assert.equal(intake.inferGuide(text), "workflow");
  assert.equal(intake.looksLikeOrganizationDescription(text), true);
  assert.equal(intake.shouldChooseWorkspace(text, { source:{ name:"Employee_Master.xlsx" } }), true);
  assert.equal(profile.name, "Gerel Setgemj");
  assert.equal(profile.employeeCount, 21);
  assert.deepEqual(profile.activities, ["Гэрэлтүүлгийн ажил", "Камер хяналтын ажил", "Засвар үйлчилгээ", "Захиргаа", "Аж ахуй"]);
  assert.equal(profile.status, "hypothesis");
});

test("workspace registry migrates one legacy checkpoint and keeps later workspaces separate", () => {
  const registryApi = require("../../public-site/workspace-registry");
  const legacy = { version:2, guide:"import", workspaceName:"Excel demo", updatedAt:"2026-08-26T08:00:00.000Z" };
  let idIndex = 0;
  const createId = () => `workspace-${++idIndex}`;
  let registry = registryApi.normalizeRegistry(null, legacy, {
    createId, now:"2026-08-26T08:00:00.000Z",
    isValidCheckpoint:value => value?.version === 2,
    fallbackName:() => "Legacy workspace"
  });
  assert.equal(registry.items.length, 1);
  assert.equal(registryApi.currentCheckpoint(registry).workspaceName, "Excel demo");

  registry = registryApi.startNewWorkspace(registry, { createId, now:"2026-08-26T09:00:00.000Z" });
  assert.equal(registry.items.length, 2);
  assert.equal(registryApi.currentCheckpoint(registry), null);
  registry = registryApi.upsertCheckpoint(registry, {
    version:2, guide:"workflow", workspaceName:"Gerel Setgemj", updatedAt:"2026-08-26T09:05:00.000Z"
  }, "Ажлын урсгал");
  assert.equal(registryApi.currentCheckpoint(registry).workspaceName, "Gerel Setgemj");
  assert.equal(registry.items[0].checkpoint.workspaceName, "Excel demo");

  registry = registryApi.selectWorkspace(registry, "workspace-1");
  assert.equal(registryApi.currentCheckpoint(registry).workspaceName, "Excel demo");
});

test("public workspace lifecycle keeps commercial and production gates explicit", () => {
  const lifecycle = require("../../public-site/workspace-lifecycle");
  const empty = lifecycle.deriveLifecycle(null);
  assert.equal(empty.current.code, "discovery");
  assert.equal(empty.canPublish, false);

  const builder = lifecycle.deriveLifecycle({ memory:{ hypotheses:[{ id:"h1" }] }, confirmationStatus:"pending", previewActivity:[] });
  assert.equal(builder.current.code, "builder");
  assert.equal(builder.canPublish, false);

  const teamPreview = lifecycle.deriveLifecycle({
    memory:{ hypotheses:[{ id:"h1" }], confirmed:[{ id:"h1" }] },
    confirmationStatus:"confirmed",
    previewActivity:[{ action:"tab" }]
  });
  assert.equal(teamPreview.current.code, "team_preview");
  assert.equal(teamPreview.gates.scope, false);
  assert.equal(teamPreview.gates.commercial, false);
  assert.equal(teamPreview.gates.deployment, false);
  assert.equal(teamPreview.canPublish, false);

  const live = lifecycle.deriveLifecycle({
    memory:{ hypotheses:[{ id:"h1" }], confirmed:[{ id:"h1" }] },
    confirmationStatus:"confirmed",
    previewActivity:[{ action:"tab" }],
    delivery:{
      objectiveConfirmed:true, workflowConfirmed:true, dataScopeConfirmed:true, rolesConfirmed:true, acceptanceCriteriaConfirmed:true,
      scopeFrozen:true, offerAccepted:true, agreementAccepted:true,
      deploymentChoice:"overva_cloud", securityReady:true, dataReady:true,
      deploymentVerified:true, acceptanceApproved:true, operationsOwner:"owner-1", backupReady:true
    }
  });
  assert.equal(live.current.code, "live");
  assert.equal(live.canPublish, true);
});

test("conversation memory keeps evidence, hypotheses, approval and execution distinct", () => {
  const erpRoot = path.join(__dirname, "..", "..");
  const contract = fs.readFileSync(path.join(erpRoot, "docs", "CONVERSATION_MEMORY_CONTRACT_V1.md"), "utf8");
  const deliveryContract = fs.readFileSync(path.join(erpRoot, "docs", "PRODUCT_DELIVERY_COMMERCIAL_CONTRACT_V1.md"), "utf8");
  const workspaceContract = fs.readFileSync(path.join(erpRoot, "docs", "PUBLIC_WORKSPACE_IDENTITY_CONTRACT_V1.md"), "utf8");
  const portfolioContract = fs.readFileSync(path.join(erpRoot, "docs", "PUBLIC_PORTFOLIO_HOME_CONTRACT_V1.md"), "utf8");
  const decisions = fs.readFileSync(path.join(erpRoot, "docs", "DECISIONS.md"), "utf8");
  assert.match(contract, /## Seven memory layers/);
  assert.match(contract, /Evidence can create a hypothesis, never a confirmed fact/);
  assert.match(contract, /A preview is a test artifact/);
  assert.match(contract, /Only an explicit accept or correction decision/);
  assert.match(contract, /bounded structured package instead of the entire raw\s+conversation/);
  assert.match(decisions, /D-013 — Conversation history is evidence, not implicit approval/);
  assert.match(deliveryContract, /Conversation memory records evidence/);
  assert.match(deliveryContract, /The public workshop saves browser-local checkpoints/);
  assert.match(decisions, /D-014 — Preview, commercial agreement, deployment, and live operation are separate gates/);
  assert.match(workspaceContract, /Every browser-local checkpoint belongs to one stable workspace ID/);
  assert.match(workspaceContract, /add it to the current workspace or create a separate workspace/);
  assert.match(decisions, /D-015 — Evidence belongs to an explicit workspace identity/);
  assert.match(portfolioContract, /OVERVA Home/);
  assert.match(portfolioContract, /Workspace Studio/);
  assert.match(portfolioContract, /Starting from a Home prompt or reference pattern first opens the structured/);
  assert.match(portfolioContract, /unpublished browser-local draft/);
  assert.match(decisions, /D-017 — Public Home and Workspace Studio are separate navigation levels/);
});

test("conversation memory transitions never promote preview activity to confirmed execution", () => {
  const memory = require("../../public-site/conversation-memory");
  const context = { guide:"import", product:"Ажилтны Smart Import", source:{ name:"Raw data.xlsx", type:"XLSX", size:"24 KB", kind:"file", details:"metadata" } };
  const pending = memory.createCheckpoint(null, context, {
    now:"2026-08-26T08:00:00.000Z", idSuffix:"test-1", newHypothesis:true,
    confirmationStatus:"pending", evidenceEntry:{ kind:"file", name:"Raw data.xlsx" }
  });
  assert.equal(pending.memory.evidence.length, 1);
  assert.equal(pending.memory.hypotheses[0].status, "pending");
  assert.equal(pending.memory.confirmed.length, 0);
  assert.equal(pending.memory.executionVerification.length, 0);

  const previewed = memory.createCheckpoint(pending, context, {
    now:"2026-08-26T08:05:00.000Z", activityStatus:"previewing",
    previewEntry:{ label:"Бүтэц харагдацыг нээж", action:"tab" }
  });
  assert.equal(previewed.confirmationStatus, "pending");
  assert.equal(previewed.previewActivity.length, 1);
  assert.equal(previewed.memory.confirmed.length, 0);
  assert.equal(previewed.memory.executionVerification.length, 0);
  assert.match(memory.answerMemory(previewed, context.product, "executed"), /Бодитоор гүйцэтгэж үндсэн мэдээлэл өөрчилсөн ажил алга/);

  const confirmed = memory.createCheckpoint(previewed, context, {
    now:"2026-08-26T08:10:00.000Z", confirmationStatus:"confirmed",
    planEntry:{ statement:"Багануудын mapping-ийг шалгах", status:"planned" }
  });
  assert.equal(confirmed.memory.confirmed.length, 1);
  assert.equal(confirmed.memory.plans.length, 1);
  assert.equal(confirmed.memory.executionVerification.length, 0);
  assert.deepEqual(memory.classifyContextIntent("svvld hiisen ajil yuu bna haana zogsoo"), { greeting:false, focus:"overview" });
  assert.deepEqual(memory.classifyContextIntent("sain uu"), { greeting:true, focus:"overview" });
});
