# OVERVA — Current Implementation State

**Status date:** 2026-08-26  
**Primary implementation:** `erp-v2/`  
**Pilot tenant:** Choibalsan Hugjil

This document records the implementation state visible in the repository today. It separates production-proven behavior, locally implemented but undeployed work, and planned capabilities. The legacy Choibalsan ERP is a separate live system and an import/reference source; it is not the OVERVA platform codebase.

## 1. Completed work

### Production and deployment foundation

- A Docker-based single-host production stack exists for Caddy, the public website, tenant web application, API, PostgreSQL, migrations, backup scheduler, and monitoring.
- Public routing supports the OVERVA website/application/administration domain structure through Caddy and the existing Cloudflare setup.
- The production `overva.com` homepage is now a full-screen Mongolian studio
  with a minimal sidebar, persistent conversation stream, and live product
  preview. The desktop document itself does not scroll; chat and preview scroll
  independently. Enter submits an intent, the browser-local deterministic
  advisor streams an interpretation and requests human confirmation, while the
  preview renders a concrete import, structure, work-flow, or discovery view.
  Confirmed paths preselect relevant trial modules without storing visitor free
  text or bypassing the existing trial approval/provisioning path. In v5, all
  explanations, questions, and confirmations stay in chat; the preview is only
  an interactive product surface with tabs, selectable cards/steps, file input,
  and test buttons. Preview actions update preview state without adding chat
  narration or mutating canonical data. In v6 visitors start by describing the
  organization, providing a file/Excel workbook, showing an image/diagram, or
  explaining current systems. The material chooser accepts spreadsheet,
  document, PDF, Visio, text, and image files up to 10 MB; CSV structure and
  image preview remain browser-local. A UTF-8-BOM organization-intake CSV
  template is publicly downloadable for Excel. Preview tabs expose Structure,
  Work Flow, Systems, and Product views. The public UI does not upload selected
  files or claim provider-backed content analysis. In v7 the save step follows
  a progressive-disclosure rule: previously established context is summarized
  instead of asked again. The visible form contains only workspace name, email,
  and password, while organization code, owner identity, and the inferred
  module set are generated internally for the existing provisioning contract.
  A guest path lets students and exploratory visitors keep testing the
  browser-local preview without creating an organization. In v8 a dedicated
  browser-local conversation-memory core separates evidence, discussion,
  hypotheses, confirmed understanding, plans, execution/verification, and the
  current checkpoint. Preview interactions never become confirmation or real
  execution. Returning visitors choose whether to resume before an old preview
  is restored, and Mongolian or Latin-Mongol questions can request the last
  checkpoint, evidence, confirmations, plan, or real execution state. The
  accepted `CONVERSATION_MEMORY_CONTRACT_V1.md` and decision D-013 define the
  promotion boundary and future server-backed context package. In v9 the public
  workspace adds a separate seven-stage delivery lifecycle: understand, build,
  team preview, scope, commercial agreement, deployment, and live operation.
  The preview shows the current stage, next gate, and missing human decisions.
  Saving now updates only the browser-local named checkpoint; the public studio
  no longer calls the trial-provisioning API, requests email/password, creates a
  tenant/user, or links directly into `app.overva.com`. Commercial, hosting,
  security, migration, acceptance, operations-owner, and backup gates must be
  explicitly completed before production can be considered ready. The accepted
  `PRODUCT_DELIVERY_COMMERCIAL_CONTRACT_V1.md` and decision D-014 define this
  boundary. Public HTML, cache-busted assets v9, container/domain health, the
  external lifecycle/save boundary, and the full 176-test suite were production-
  verified on 2026-08-26. In v10 the sidebar became the compact user journey:
  it shows the named workspace, current `x/7` stage, completed/current/locked
  delivery steps, working conversation/material/preview/decision/test-history
  tools, and the next unmet gate. Selecting a locked stage leaves preview state
  untouched and explains the missing requirements in the conversation panel.
  Cache-busted v10 assets, container/domain health, sidebar markup/handlers, and
  the continued absence of public trial provisioning were production-verified
  on 2026-08-26.
- Production containers use health checks, `restart: unless-stopped`, log rotation, isolated networks, and `no-new-privileges` where applicable.
- PostgreSQL is on the internal backend network and is not published directly by the production override.
- PostgreSQL data, uploaded files, and Caddy state use persistent volumes.
- Production migrations run as a one-shot service before the API starts.
- Scheduled backups, backup verification markers, restore guidance, and service monitoring are present.
- Development, staging, and production Compose/environment configurations are separated. Secrets are supplied through files/environment and must not be committed.

### Platform and tenancy

- Multi-tenant organizations, subscriptions, users, roles/permissions, module enablement, platform administration, and tenant lifecycle foundations exist.
- Tenant identity is derived server-side for protected operations rather than trusted from arbitrary client input.
- Tenant-scoped organization, department, position, employee, work, asset, and related records are established.
- The platform distinguishes platform administration from organization ownership/administration and ordinary employee access.
- Append-only audit coverage exists for important authentication, access, configuration, HR, workflow, API, and administrative events.

### Organization, people, and access

- The canonical people model separates organization structure, departments, positions, employees, optional login accounts, roles, and permissions.
- Employee master data is separate from login identity; an employee does not automatically require a user account.
- Job definitions can grant role-relevant workspaces. Navigation is derived from enabled modules, permissions, and job/workspace assignment.
- Organization blueprint/update mode supports organization type, sector, real work patterns, structure suggestions, and later additions.
- HR capabilities include employee profiles, contracts, attendance, leave, skills/training, performance, recruitment, onboarding, and offboarding foundations.
- Choibalsan Hugjil employee/structure migration and pilot mappings exist without making the pilot structure a universal OVERVA template.

### Smart Import and AI-assisted discovery

- OVERVA Requirements Method and guided organization discovery foundations exist.
- The existing Organization Blueprint workspace now has a locally implemented
  evidence intake and capability-review slice: tenant-private source text is
  hashed, AS-IS findings retain an evidence excerpt and confidence, and
  capability proposals are classified as `Native`, `Integrate`, or `Later`.
- Source, finding, proposal, and human accept/correct/reject records are
  append-only and tenant-scoped. They never apply structure, modules, or master
  data automatically.
- Migration `0054` adds generic workbook Dataset Discovery. It classifies
  source/master/derived/report/instruction sheets, stores privacy-safe column
  profiles and quality findings, and blocks canonical commit when a target
  contract is missing. The supplied 7-sheet sales/delivery workbook produced 43
  findings and correctly identified five missing contracts. Migrations
  `0053`-`0054`, runtime grants, service health, and the public application path
  were production-verified on 2026-08-26; human pilot validation remains.
- Smart Import separates proposed actions, validation failures, human review, approval, and commit stages.
- Import correction, exclusion, reconciliation, tenant isolation, and audit concepts are implemented.
- A 15-sheet company workbook now selects `Employee_Master` instead of assuming
  the first worksheet. The compatibility loader accepts its third-party
  SpreadsheetML namespace/table/merge metadata; a privacy-safe local dry run
  found 58 employee rows, marked 56 ready, and blocked 2 duplicate identifiers.
  Production parser hashes and an equivalent synthetic compatibility workbook
  were verified without copying employee data into the production container.
- The complete local API suite passes 173 automated tests.
- The Hercules import-review and organization-structure work was used as a UX/prototype reference; its mock data, authentication, database, and framework-specific backend were not treated as production OVERVA code.
- A six-stage structure workflow exists conceptually and in the current implementation: units, job definitions, positions, reporting relationships, employee assignments, and review/approval.

### Operational modules

- Implemented foundations include assets, work orders, inventory, procurement, finance import, records/archive, reporting, attendance, HR, safety, maintenance, field operations, map/GPS/IoT foundations, integrations, API keys/webhooks, and executive views.
- Lighting operations has a tenant-specific pilot workspace built on the common asset/incident/work-order workflow rather than a separate ERP.

### Camera operations — deployed and production-verified

- A `Камерын тасаг` navigation entry and camera workspace are deployed in production.
- The workspace reads authenticated, tenant-scoped API data and provides overview, device/asset, incident, and work-flow views.
- Camera work types now include inspection, repair, preventive maintenance, and network repair.
- Migration `0052_camera_operations.sql` enables the `camera-operations` module and its work types for the Choibalsan Hugjil pilot tenant.
- Job-workspace mappings include camera oversight for director, chief engineer, network engineer, and safety roles.
- Migration `0052_camera_operations.sql` is applied in production, runtime grants were refreshed, and 34 pilot job-workspace mappings are active.
- The production web image explicitly includes `camera.js`; the public asset returns JavaScript rather than the SPA fallback document.
- Camera API access is enforced server-side by tenant module and job workspace, with organization-owner oversight preserved.
- Production verification passed service health, backup checksum, migration/database contract, public endpoint, 21-account authorization matrix, and headless browser navigation/render checks.

## 2. Architectural decisions

- **General-purpose platform:** OVERVA must fit many organization types. Choibalsan Hugjil is a pilot and evidence source, not the universal product model.
- **One platform, configurable workspaces:** tenant modules and workspaces are enabled by organizational need and access rules; sidebar entries must not be hard-coded for every user.
- **Single source of truth:** employees, assets, work orders, and other master/transaction records are created once and reused across modules.
- **Tenant isolation:** every tenant-owned record and query must remain tenant-scoped. Cross-tenant access is a release blocker.
- **People/access separation:** organization title, system role, workspace permission, and login account are different concepts.
- **Human-reviewed AI:** AI may propose mappings, structures, requirements, and imports, but consequential writes require validation and explicit approval.
- **Evidence-driven growth:** new reusable behavior should come from verified customer evidence and be generalized before entering the shared platform.
- **Immutable audit:** critical actions must be appended to audit history rather than silently overwritten.
- **IoT safety invariant:** command priority is `Emergency > Manual > Weather > Schedule > Default`; edge/device behavior must remain safe when cloud connectivity is lost. This remains a non-negotiable target even where end-to-end enforcement still needs verification.
- **Production boundary:** only Caddy publishes public ports. API, PostgreSQL, migration, backup, monitoring, and worker services remain internal.
- **Compatibility:** extend existing API and domain models; do not rebuild working parts without evidence that replacement is required.

## 3. Unfinished work

- Validate the production Organization Evidence/Dataset Discovery output with
  real anonymized organization material and record pilot review decisions.
- Complete human pilot UAT for camera terminology, operational usefulness, and real-world workflow fit; automated production deployment, authorization, empty-state, and render checks are complete.
- Continue normalizing imported pilot organization/position/employee data and remove ambiguous legacy assumptions.
- Validate Smart Import with additional real, anonymized files and record accuracy, rejection, correction, and time-to-first-value metrics.
- Complete the customer journey/adoption funnel in platform administration: discovery started, blueprint completed, pilot started, first value, go-live, paid usage, champion, and referral.
- Mature module workflows that currently have backend foundations but incomplete end-user journeys.
- Verify IoT priority enforcement at UI/API/server/edge/device levels and offline-safe last-valid configuration behavior.
- Plan high availability before the single-host deployment is treated as enterprise-grade production infrastructure.

## 4. Known issues and risks

- Existing signed-in users may need to refresh or sign in again before updated camera workspace assignments appear in their session.
- The camera UI currently reuses lighting workspace CSS classes. This keeps the visual language consistent but creates coupling that should later be replaced by shared operations-workspace styles.
- Camera asset/device classification and camera-related work selection currently rely partly on names, tags, categories, and work-type codes. Canonical typed relationships should replace heuristic matching as master data matures.
- Imported legacy data can contain duplicated, incomplete, or semantically inconsistent department, position, asset, and work records. Import must remain reviewable and must never silently become master data.
- Some capabilities shown in architecture/vision documents are foundations or planned capabilities, not finished production workflows. In particular, AI decision support, DW/BI, advanced IoT, and high availability must not be presented as complete.
- A Compose start without the production environment file fails required-variable validation (for example ACME and database application credentials). Always use the production env/secrets workflow; never place secret values in commands, documentation, or Git.
- Smart Import must continue to block commit for duplicate identifiers and any
  unresolved validation error; parser success alone is not approval to write
  employee master data.

## 5. Relevant files

### Product memory and architecture

- `AGENTS.md` — repository boundaries and legacy/OVERVA separation.
- `erp-v2/AGENTS.md` — OVERVA product direction and non-negotiable engineering rules.
- `erp-v2/docs/CURRENT_STATE.md` — detailed project memory and capability inventory.
- `erp-v2/docs/DECISIONS.md` — architectural/product decisions.
- `erp-v2/docs/ARCHITECTURE.md` — architecture description.
- `erp-v2/docs/OVERVA_VISION.md` — product vision.

### Production deployment

- `erp-v2/docker-compose.yml` — base development/service composition.
- `erp-v2/docker-compose.production.yml` — production hardening, migrations, health checks, secrets, backups, and internal networking.
- `erp-v2/Caddyfile` — domain and reverse-proxy routing.
- `erp-v2/.env.production` — local production configuration reference; values are sensitive and must not be committed or copied into documentation.
- `erp-v2/secrets/` — runtime secret files; contents must never be committed or reported.
- `erp-v2/ops/` — PostgreSQL initialization, backup, restore, and monitoring scripts.

### Application and camera slice

- `erp-v2/api/src/app.js` — API route mounting.
- `erp-v2/api/src/routes/camera.js` — authenticated camera workspace API.
- `erp-v2/api/migrations/0052_camera_operations.sql` — camera module/work-type pilot migration.
- `erp-v2/api/scripts/configure-job-workspaces.js` — role/job workspace mapping script.
- `erp-v2/web/index.html` — application shell and sidebar navigation.
- `erp-v2/web/app.js` — view routing, module visibility, and application state.
- `erp-v2/web/workspace-policy.js` — client workspace visibility policy/fallback behavior.
- `erp-v2/web/camera.js` — camera workspace UI.
- `erp-v2/api/test/workspace-policy.test.js` — workspace policy tests, including camera access cases.

## 6. Commands and tests

Run commands from `erp-v2/` unless noted otherwise. Do not print or commit secret values.

### Checks already completed for the local camera change

```powershell
node --check web\camera.js
node --check api\src\routes\camera.js
node --check api\scripts\configure-job-workspaces.js
```

All three syntax checks passed.

### Repository checks available

```powershell
cd api
npm run check
npm test
```

`npm run check` validates the API entry files. `npm test` runs the Node test suite. The complete local suite currently passes 178 tests, including public guided-start/lifecycle gates, multi-workspace separation, Latin-Mongol intake, multi-sheet employee selection, and SpreadsheetML compatibility coverage. Production currently runs the previously verified v10 public site; v11 remains local.

### Production build/restart command

```powershell
docker compose --env-file .env.production -p overva-production -f docker-compose.production.yml -f docker-compose.cloudflare.yml up -d --build --wait
```

The camera release and migrations `0053`-`0054` were deployed on 2026-08-26 with the production and Cloudflare Compose overlays. The migration service completed before the API became healthy. The Smart Import compatibility fix was then rebuilt and verified through the same production path.

### Post-deploy verification

```powershell
docker compose --env-file .env.production -p overva-production -f docker-compose.production.yml -f docker-compose.cloudflare.yml ps
docker compose --env-file .env.production -p overva-production -f docker-compose.production.yml -f docker-compose.cloudflare.yml logs migrate api web --tail 200
```

Then verify through the public application with at least: organization owner/admin, director, chief engineer, network engineer, safety employee, and an unauthorized employee.

## 7. Next recommended step

Review the locally implemented v11 multi-workspace behavior with the original
Excel demo and the separate Latin-Mongol organization description, then deploy
only with explicit approval. Define an App Definition Contract connecting
evidence, business/data models, UI/workflow/roles, preview/tests, versioned
build, and runtime. Use the production camera workspace as the first bounded
reference-app proof while testing the Creator Studio / Client Review / Runtime
hypothesis with real users. Add attributable commercial and operations records
before reconnecting tenant provisioning. Continue camera UAT and review the two
duplicate employee identifiers before Smart Import commit. Keep authorization,
tenant isolation, validation blocking, and production smoke checks as gates.
