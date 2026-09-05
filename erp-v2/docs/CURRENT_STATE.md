# OVERVA Current State

Last updated: 2026-09-05

This document answers one question: **what exists in the repository now?** It
does not claim that every implemented foundation is complete or production-
validated at enterprise scale.

## 2026-09-05 host-retirement migration preparation

- Local `main` and GitHub `origin/main` now both point to `47d9c47`; 42
  previously local-only commits were pushed after a secret-pattern and large
  blob preflight. Real production secrets remain ignored and were not uploaded.
- Production backup `overva-20260905T032053Z` passed checksums, archive listing,
  and an isolated restore through schema `0110` with four organizations and 106
  Work Orders. The disposable restore database was removed after verification.
- Exact current API/Web images, a recovered capture of the running public-site
  image, the verified database/uploads backup, and a complete verified Git
  bundle are staged with SHA-256 evidence under
  `D:\OVERVA-Server-Migration`. This remains the same physical SSD and is not an
  off-site backup.
- Retirement is NO-GO until a Linux destination server, approved encrypted
  off-device secret/data transfer, independent backup/restore proof, and
  Cloudflare cutover pass while this workstation is powered off. See
  `HOST_RETIREMENT_MIGRATION_READINESS_20260905.md`.

## 2026-09-05 governed human-workflow demo rehearsal

- The isolated `localhost:4200` demo now runs schema `0111`; production remains
  read-only and unchanged at schema `0110`. A full synthetic, multi-person
  lighting and camera rehearsal passed from Incident intake through routed Work,
  named participants, HSE return/authorization/suspension/completion review,
  measured partial outcome, management disposition, exact follow-up, material
  reconciliation, final acceptance, dossier projection, dashboard and audit.
- Incident-origin Work now receives a measurable scope row in the same
  transaction. A follow-up copies only the Incident represented by its source
  scope row, so unrelated Incidents from a multi-fault Work are not kept open.
- Employee access provisioning now grants the current lighting/camera Incident
  roles, Work roles and separated storekeeper/accountant roles consistently from
  both account-creation paths. The canonical `choibalsan-pilot` job-workspace
  profile was applied to the local demo after a dry run; no production access
  mapping changed.
- Migration `0111` implements exact unused-material reconciliation. An assignee
  can record partial consumption; an authorized material custodian can return
  only the entire issued remainder to a tenant-owned warehouse. The return is
  quantity-checked, idempotent, audit-attributable and represented by an
  append-only stock movement and material events. The storekeeper UI exposes
  the return queue and resulting status.
- Final run `E2E-20260905-ROLE10` completed all three generated Work Orders and
  reconciled stock `10 → 8 → 9` for two issued, one consumed and one returned.
  All earlier incomplete synthetic Works were finished through normal APIs;
  three orphan retry Incidents were cancelled rather than deleted. Final demo
  checks show zero open `E2E-20260905-` Incidents and zero unfinished synthetic
  Work. All 110 temporary login accounts were deactivated through the user API;
  their named Employee, operational and audit evidence remains distinguishable.
- Five category reads passed for road lighting, ger-area lighting, tower
  lighting, traffic signals and camera. The complete repository suite passes
  **492/492**. A disposable database applied all 111 migrations through `0111`
  successfully and was removed after verification. Final verified demo backup is
  `overva-20260904T125340Z`; source-final and runtime-final local API/Web images
  were retained. `DEMO_HUMAN_WORKFLOW_E2E_20260905.md` contains the report and
  exact record identifiers.

## 2026-09-04 local demo parity refresh

- The storekeeper dashboard now reports the count of materials with stock
  instead of adding quantities with incompatible units, treats an item as a
  replenishment risk only when a positive minimum level is configured, and
  formats movement quantities and timestamps for compact reading. Two damaged
  `LEGACY-WH-*` demo material labels plus their legacy warehouse and movement
  notes were corrected from the read-only legacy SQLite source. The correction
  is local-demo-only and produced five attributable audit rows; production data
  was not changed.
- A verified local backup `overva-20260904T113313Z` was created before changing
  the demo environment. The `localhost:4200` Web and its isolated
  `overva-local-demo-api` were rebuilt from commit `8cade7e`; recursive content
  hashes now show zero Web or API source-file differences from production.
- The demo `choibalsan-hugjil` tenant previously exposed 14 of the 25 modules
  enabled in production. The 11 missing modules (`ai-director`, `archive`,
  `automation`, `developer`, `fleet`, `integration-lab`, `iot`, `maintenance`,
  `map`, `procurement`, and `records`) were enabled through the authenticated
  tenant module API, producing 11 attributable `developer.module_toggle` audit
  rows. Session/report/CSV smoke passes with 25 modules and 102 permissions.
- Authenticated read smokes for the newly enabled records, archive, maintenance,
  procurement, map, fleet/GPS, IoT, automation, AI Director, developer, and
  integration-lab overviews all return HTTP 200 in the local demo.
- Production data was not copied into the demo. The local database remains a
  separate one-tenant test boundary at schema `0110`. Its one pre-existing
  unlinked bootstrap login still prevents a production-grade release check and
  requires a separate identity decision; it was not silently linked or removed.

## 2026-09-04 connected-operations production release

- Production Web hotfix `8cade7e` corrects the fault-intake empty state found
  during user acceptance. If the selected lighting or camera scope has zero
  open-fault objects, **All** becomes the effective view, every eligible object
  remains available for a new report, and the impossible **Faulty only 0**
  filter is disabled. Web image
  `sha256:83bf0037c1d69c3cb08f5116746d760255018978b2fa1135e2b49b6618d8a8aa`
  is healthy in production; the API, schema and business data were unchanged.
- The dashboard, report-schedule, Work follow-up/team, and lighting/camera fault
  changes are committed as feature commit `7d31ef9` plus tenant-query safety fix
  `912d1b1`, and successfully promoted through a controlled release. LAN
  remains untouched.
  `PRODUCTION_CONNECTED_OPERATIONS_RELEASE_20260904T104631Z.md` records the
  promoted images, schema transition, verification evidence, rollback identity,
  backups and external-route checks.
- Production began the release healthy at schema `0105` and was advanced through
  ordered migrations `0106` to `0110`. Migration `0110` is an additive
  correction allowing `scope_follow_up` as the assignment-evidence source found
  during live follow-up rehearsal. Clean migration and release rehearsal pass
  at 110 migration rows and 25 active modules.
- API syntax and all **487/487** repository tests pass. Separate live rehearsals
  pass for Work measured follow-up and participant inheritance, lighting and
  camera incident creation/cancellation, material issue/consumption, and the
  authenticated report/dashboard projection.
- Production contains zero unlinked Employee login identities and zero tenantless
  automation events. The local demo has one pre-existing unlinked bootstrap
  Employee login, so its release check correctly fails until governed identity
  reconciliation; this row was not hidden or mutated.
- The scheduler's first 2026-09-04 attempt failed while PostgreSQL was starting.
  After database readiness was confirmed, fresh production backup
  `overva-20260904T103838Z` was created and passed scheduler-container plus
  separate read-only-container verification of checksums, PostgreSQL archive
  and uploads archive. Exact images from `912d1b1` also pass the release and
  live domain rehearsals. Explicit Go was received and production now runs API
  `sha256:23dbce4e…cd2ed` and Web `sha256:aea90cc7…cd775` at schema `0110`.
  Release, authenticated tenant/RBAC, lighting, camera, Work, dashboard and
  external-route smokes pass; all seven long-running services are healthy.
  Pre/post backups `overva-20260904T103838Z` and
  `overva-20260904T105136Z` passed stored plus independent verification and
  have hash-matched D: copies. Full evidence is in
  `PRODUCTION_CONNECTED_OPERATIONS_RELEASE_20260904T104631Z.md`.
- Exact-image live rehearsal also exposed pg's deprecated concurrent query use
  on one transaction client in lighting/camera dossier reads. Commit `912d1b1`
  now executes those reads sequentially and adds a regression check, avoiding a
  future pg@9 runtime failure without weakening the tenant transaction.

## Lighting and camera home overview (production)

- The management organization home now includes compact **Гэрэлтүүлгийн тойм**
  and **Камерын тойм** panels. They retain the useful visual grouping of the
  legacy dashboard while deriving every displayed value from current OVERVA
  tenant data rather than copying a legacy dashboard snapshot.
- Lighting location and installed-quantity figures are projected from governed
  Operational Objects, their current specifications/lamp groups, reviewed
  source-import evidence and canonical traffic-signal Assets. Fault quantities
  come from currently open or in-progress Operational Incidents. The four
  visible groups are road lighting, ger-district lighting, towers/projectors
  and traffic signals. Unresolved lighting classification is shown explicitly
  instead of being silently assigned to a convenient group.
- Camera location/device totals are projected from current Operational Objects
  and camera specifications; active and faulty quantities are derived from open
  Incident quantities. Both panels route to their owning operational workspace
  for governed detail and action. The home remains a read model and owns no
  duplicate infrastructure ledger.
- The local `choibalsan-hugjil` demo currently verifies road lighting at 36
  locations / 1,747 poles / 2,582 heads / 338 open faults, ger-district lighting
  at 191 / 2,237 / 212, towers at 143 / 786 / 182, traffic signals at 12 / 12 /
  0, and 69 unclassified lighting objects. Camera verifies at 110 locations,
  302 devices, 236 active and 66 faulty (78.1%). The desktop arrangement keeps
  these panels, decision alerts and recent information flow in the working
  viewport; narrow screens retain responsive scrolling.
- This capability was promoted to production in release
  `20260904T104631Z`; the authenticated dashboard and domain smokes passed.
  The local demo remains available for isolated follow-on testing.
- The compact home now gives each infrastructure fact one visual home: when the
  detailed lighting/camera panels are present, their duplicate top metrics and
  duplicate dashboard alert rows are omitted. Their underlying incidents are
  unchanged and remain available in the owning workspace. Repeated equivalent
  information-flow events are summarized with an exact record count instead of
  occupying one row each. Resources, remaining decision alerts and information
  flow share one three-column desktop row so the working view does not require
  vertical scrolling at the supported desktop layout; narrower screens remain
  responsively scrollable for readability.
- The redundant **Өнөөдөр / Чиг хандлага** switch below the organization banner
  has been removed. Trend analysis remains available through its authorised
  workspace navigation. **Үндсэн хөрөнгө** is now grouped under **Нөөц ба
  санхүү** instead of occupying the operational-signal row.
- The home also restores the useful legacy-familiar workforce and work signals
  without restoring legacy truth: total Employees comes from the canonical
  Employee master; present today and the compact leave/sick/vacation/overtime
  strip come from today's Attendance records; annual Work total comes from
  current Work Orders. Until measured scope quantities exist, the displayed
  work-progress percentage is explicitly the completed-Work share and shows
  its completed/total evidence instead of inventing intermediate progress.
- Attendance was enabled for the local `choibalsan-hugjil` demo through the
  governed module-configuration endpoint, which preserves an attributable
  tenant audit entry. The demo currently has no Attendance row for today, so
  its arrival and absence breakdowns remain truthful zeroes until users record
  attendance. The resource panel now keeps all five authorised resource and
  finance indicators in a two-column desktop grid, with the final odd card
  spanning the row so currency values are not clipped.
- The attendance strip includes absence as its own red signal alongside leave,
  sickness, vacation and overtime. The banner's redundant manual refresh
  control is removed; authorised Settings users instead receive a **Change
  banner image** shortcut to the existing governed organization-brand form.
  The home banner avoids repeating the full date: the identity side carries no
  date and the status side shows the year, month, day and time once, without an
  extra refresh-status label.
  The brand shortcut
  is an unobtrusive icon beside that time, with an accessible label and tooltip.

## Organization information flow (production)

- The organization home now includes a compact **Мэдээллийн урсгал** board.
  It reads recent Work Order, correspondence, Employee, stock-movement and
  accountant-workspace events from their existing authoritative tables; it
  does not create a second activity source of truth.
- Every feed query runs inside an explicit tenant transaction and is enabled
  only when the authenticated User has the corresponding module and read
  permission. Organization-wide Work visibility is limited to management or
  `work-orders.read-all`; other Users see only work they created, received or
  acted on. Each row routes to the owning workspace where its full governed
  history can be reviewed.
- The home projection omits event notes and JSON detail. Confidential and
  restricted correspondence uses a redacted title, and restricted rows are
  absent unless the User already has restricted-document permission. HR and
  finance entries appear only to their domain-authorised Users. Inventory
  receipts, issues, transfers and adjustments include item/quantity/unit, so
  fuel and lubricant movements appear when they are recorded through the
  governed Inventory workflow; the dashboard does not invent a parallel fuel
  ledger.
- The desktop command layout places five newest authorised update groups below the
  resource cards while the complete priority alert list remains alongside it.
  This keeps both decision signals and recent information flow in the working
  viewport; responsive layouts remain vertical on narrower screens.
- This capability was promoted to production in release
  `20260904T104631Z`. Authenticated production smoke returned 12 safe
  information-flow rows plus the reconciled lighting/camera overview.

## Work responsible employee and executing crew (production)

- Migration `0109` adds tenant-scoped current Work participation and append-only
  assignment evidence. A Work may name one responsible Employee and multiple
  executing Employees from the canonical HR Employee master without granting
  any login, RBAC, workflow or approval authority.
- The new Work dialog filters both roles to active Employees in the department
  routed by the selected Work Type. Work created from a lighting or camera
  Incident shows only the matching domain's Work Types and service areas; the
  API rejects a cross-domain Work Type even if a client bypasses the screen.
  The source Incident's exact operational object/Asset is inherited, so the
  dialog hides the unrelated global Asset selector during conversion.
- Work Board cards and Work history expose responsible and executing people.
  The existing `assigned_to` User remains a distinct system/workflow owner and
  continues to be governed by its existing authorization and audit path.
- Migration, authenticated options/list/history smoke, image builds, JavaScript
  syntax checks, and the final `487/487` repository tests pass. This capability
  was promoted to production in release `20260904T104631Z`; LAN was not changed.
- Migration `0110` extends only the allowed assignment-event source vocabulary
  with `scope_follow_up`, matching the already accepted participant inheritance
  path. It was added rather than rewriting migration `0109`; the disposable
  production-go integration exposed and verifies the correction.

## Understandable multi-fault lighting intake (production)

- The lighting fault sheet now shows registered equipment and current open
  faults by type beside each object. A user prepares a fault type and quantity
  explicitly instead of editing an ambiguous single value.
- Multiple different fault types may be prepared for the same street/object.
  Prepared rows remain visible in one **changes to save** review, can be removed
  individually or cleared together, and are committed in one existing
  tenant-scoped idempotent batch. Repeating the same object/type in the draft
  merges its quantity rather than producing a duplicate batch row.
- The fault sheet keeps every object available for new reporting but sorts
  objects with current open Incidents first, marks those rows, and provides
  **All / Faulty only** controls with distinct object counts. This prevents a
  category's healthy alphabetical rows from hiding its real open faults.
- Legacy open Incidents whose imported type label is not a current reference
  code remain visible as **Previous recorded fault**, including their retained
  label and quantity. Their fallback unit matches the server's head-based
  legacy capacity calculation instead of falsely presenting the object as
  fault-free.
- A supervisor with `operational-incidents.cancel` may mark an incorrectly
  saved, still-unlinked open Incident as cancelled after entering a reason.
  Each current aggregate can be expanded beside its object to identify the
  exact Incident by fault type, reported time and remaining quantity before
  cancelling it. Users without that permission receive a read-only view.
  The command is version checked and idempotent and appends Incident and audit
  evidence; it never deletes history. A Work-linked Incident fails closed and
  must be handled through its connected Work scope.
- The pilot HSE/safety-reviewer role does not implicitly receive lighting
  Incident report or cancellation authority; those remain separately granted
  operational permissions.
- JavaScript syntax, focused tests, the final `487/487` repository tests, image
  builds and authenticated workspace smoke pass. This capability was promoted
  to production in release `20260904T104631Z`; LAN was not changed.

## Report schedule (production foundation; no production schedule rows yet)

- Migration `0106` and `/api/report-schedules` implement the first governed
  report-obligation schedule. It retains the useful legacy interaction—name,
  recurrence, next due date, responsible person/unit, recipient, warning days,
  note and **Илгээсэн**—without reusing the legacy global table or trusting a
  client-supplied organization.
- Every row is tenant-owned, RLS protected and version checked. Responsibility
  may reference an active same-tenant User while an unmatched legacy name is
  preserved only as a label. Create, update, submission and retirement write
  attributable tenant audit evidence; lifecycle/submission events and command
  receipts are append-only. Submission is exact-payload idempotent and advances
  only one scheduled occurrence. A one-time schedule closes after submission.
  Deletion is not exposed: retirement keeps history.
- The existing **Нэгдсэн тайлан** surface now has separate **Нэгдсэн тайлан**
  and **Тайлангийн хуваарь** tabs. The schedule tab includes due-state cards,
  the legacy-style wide table, add/edit form and permission-derived actions.
  Its copy explicitly says that a human **Илгээсэн** mark is evidence of that
  action, not proof of delivery by an external system.
- The guarded local importer opens the legacy SQLite database read-only,
  refuses production, non-loopback and non-demo targets, requires an empty
  target, and preserves legacy source IDs plus responsibility-match status in
  creation evidence. The current local `choibalsan-hugjil` demo contains the 20
  reviewed active legacy schedules. A pre-change local backup
  `overva-20260904T024849Z` was created first.
- The governed schema, API and UI were promoted to production in release
  `20260904T104631Z`. Production intentionally contains zero schedule rows;
  the guarded legacy importer remains local/demo-only and was not run against
  production.
- The unified organization home now derives overdue, due-today and warning-window
  report signals from the governed schedule source. The server applies tenant,
  permission, responsibility and organization-timezone scope; management sees
  the organization aggregate while another authorised User sees only directly
  assigned schedules. Selecting the signal opens the schedule tab directly.
- On desktop viewports the organization home uses a compact command layout:
  the identity banner and operating metrics consume less vertical space, while
  resources and the complete prioritised alert list sit side by side. No signal
  is hidden to achieve the fit; narrower screens retain the readable responsive
  vertical layout.
- The API dependency lock overrides `qs` to `6.16.0`; `npm audit --omit=dev`
  and the rebuilt demo image report zero known vulnerabilities. The complete
  local production release check is still blocked because the existing
  `choibalsan-hugjil` admin login is marked as an employee without a canonical
  employee link. That pre-existing data issue was not changed or hidden by this
  slice and must be resolved through an explicit identity-data review before a
  production promotion.

## Lighting, camera and fiber workspaces (production)

- Implementation commit `b29365d` introduced migrations `0099`-`0105` and the
  reviewed lighting, camera and fiber workspace slice. Its first controlled
  production attempt stopped and restored the prior application images when
  authenticated verification found all 117 imported production
  `sl_points.code` values had already been reduced to literal `??-*`; schema
  `0105` remained because it was additive and rollback-compatible.
- Remediation commit `aee0306` is now live in production. Its closed-world,
  fingerprinted reconciliation recovered the reviewed legacy identity into
  current Operational Object metadata without rewriting immutable source
  snapshots. It changed exactly 117 target objects into 36 road-lighting, 12
  traffic-signal compatibility-copy and 69 unresolved rows, advanced their
  version sum from 117 to 234, and appended 117 object events plus one
  attributable tenant audit. The source hash and every non-target Operational
  Object hash remained unchanged; exact replay produced zero writes. Frozen
  API image `2abafdd8…dacc0` and Web image `2e066846…6932` are healthy in
  production at schema `0105`. Release, session/report/CSV, authenticated
  lighting/camera, Work Board, fiber-network and external endpoint smokes all
  passed. Fresh rollback backup `overva-20260903T131519Z` was verified and
  independently copied before the write.
- The lighting-specific tab is named **Гэрэлтүүлгийн объектын бүртгэл**. Its
  projection restores the legacy engineer-facing pole, head and replacement-
  pole quantities without equating the functional object with an accounting
  Asset. Known `ГТ-*` source rows map to the road-lighting candidate view;
  69 genuinely unresolved mixed `sl_points` rows fail closed into
  **Ангилал тодорхойгүй** instead of being presented as road-lighting truth.
  The remaining 12 `ГД-*` rows are preserved compatibility evidence for the
  same 12 canonical traffic-signal Assets, so the registry excludes those
  copies and presents each traffic signal only once.
- A user review exposed and corrected a demo transport/granularity defect: the
  local seed provenance omitted the legacy `code`, so all 117 `sl_points` rows
  initially appeared unclassified while the 36 road fault rows were labelled
  only as generic "issues". The demo-only evidence reconciler is hard-gated to
  `overva_rehearsal_lighting_demo`, requires the reviewed legacy baseline
  `117 points / 36 ГТ objects / 1,747 poles / 2,582 total heads / 43 replacement
  poles`, preserves `source_import_records`, and appends object events plus one
  tenant audit record. Runtime projection accepts the preserved source code or
  reconciled `metadata.legacyCode`; a rebuilt local demo that has not replayed
  that reconciliation may recover the same 36 road rows only from the retained
  exact semantic note or their linked source Incident. These bounded evidence
  paths match the dashboard classifier, while every other `sl_points` row still
  fails closed. Traffic-signal compatibility copies are likewise excluded by
  retained code or exact semantic note, preventing duplicate display.
- Area cards are now tab-aware. **Гэрэлтүүлгийн объектын бүртгэл** is a
  master-data-only surface: its heading asks for an object classification and
  its cards show only object/equipment counts. Fault and active-work measures
  appear only on their relevant operational tabs. The object dossier likewise
  contains base information, fixed-asset/component allocation, lifecycle
  actions and append-only change history; it no longer returns or renders fault
  and Work Order lists. Eleven road rows labelled open by the legacy snapshot
  have zero remaining damage and are not presented as active faults. Legacy
  `lamp_count`, `head_count` and `total_heads` are represented as
  distinct `poleCount`, `headCountPerPole` and `totalHeadCount` facts instead of
  collapsing different grains into one count. The separate legacy
  `sl_ger_inventory.total_count` field is now interpreted by category: a tower
  row is one mast with `total_count` lamp heads, while a ger-area row has
  `total_count` poles and heads under the source system's one-head-per-pole
  convention. A reviewed canonical technical snapshot always overrides this
  compatibility projection; immutable source snapshots were not rewritten.
  When a selected class contains only fixed equipment, the UI suppresses the
  irrelevant empty operational-object section. Selecting **Гэрлэн дохио** now
  opens one **Гэрлэн дохионы бүртгэл** section with the 12 canonical records
  instead of claiming that the selected class has no registration.
- **Гэмтэл бүртгэл** keeps the legacy screen's useful one-row number-entry
  simplicity while retaining governed OVERVA writes. Each row shows total poles,
  total lamp heads and lamp type; the engineer chooses a bounded incident type,
  changes the new quantity with visible minus/plus controls, and sees projected
  availability immediately. Head faults use total heads as their denominator,
  pole faults use total poles, and occurrence-based faults show no false
  availability percentage. Optional notes stay hidden until requested. Only
  visible filtered drafts enter the explicit atomic batch submission. The API
  derives tenant and actor from authentication, validates same-tenant objects
  and tenant-owned types, and rejects a head/pole quantity above the known
  master total after including unresolved faults. It retains exact-payload
  idempotency, append-only incident events and tenant audit evidence. Zero is
  deliberately not a resolve/cancel command; accepted Work Order completion
  remains ordinary repair authority.
- The local demo keeps the explicit **Гэмтэл хадгалах** action and live selected-row
  count in the fault sheet header, outside the long object-list scroll area. The
  bottom duplicate action is removed, so saving remains visible without weakening
  the existing server validation, idempotency or audit boundary. This is the
  capture entry remains separate from triage. In the Work board, an authorized
  triage User can explicitly add a repeat Incident to the matching open Work
  Order or deliberately create a separate Work Order. The attach command locks
  the Incident, verifies tenant, object/asset, service area, open states and
  scope authority, appends an immutable relationship, creates a measurable
  scope row for the unresolved quantity, advances the Incident and writes Work,
  Incident and audit evidence. It never attaches from display-name similarity.
  Opening the Work board now reloads its Intake and Work projections, and
  returning to Lighting or Camera reloads that domain workspace. Therefore a
  just-reported Incident, a triage/link decision and later Work state changes do
  not remain hidden behind an earlier client-side cache.
- Each domain keeps its dossier entry beside its own master registry row. The
  lighting Operational Object registry, canonical fixed-equipment/traffic-signal
  registry and camera Operational Object registry now label that action
  **Хувийн хэрэг**. This is navigation to the existing owning record, not a new
  cross-domain dossier table. The dossier now projects the object's incident
  history and append-only Incident events, including the reported note, quantity,
  actor and occurrence time. The same projection is present in fixed-Asset detail
  for traffic signals and other fixed equipment. It also returns only the Work
  Orders visible under the signed-in User's existing Work
  authority, measured scope and attributable work events. Detailed HSE review is
  returned only to owner, all-work, safety-review or workflow-approval authority.
  Users can print/save the visible dossier as PDF and download the same
  permission-scoped snapshot as JSON; neither action creates a second source of
  truth or claims that the snapshot is a signed completion certificate.
- Migration `0099` introduces incident versions, tenant-owned operational
  incident type reference data, separate report/correct/cancel permissions and
  append-only command receipts with tenant RLS. Only `report_batch` is wired in
  this first slice; correction and cancellation commands remain planned.
- Migration `0100` adds optimistic object versions and separate tenant-scoped
  `operational-objects.update` / `operational-objects.retire` permissions.
  Name, location and linear length edits append object events and tenant audit
  evidence. The apparent delete action is deliberately a retirement: it never
  hard-deletes master data, requires a reason and current version, and refuses
  objects that still have active children, component allocations, unresolved
  incidents or unfinished Work Orders. Retired objects disappear from the
  active registry while their history and relationships remain intact.
- Migration `0101` adds the editable technical master beneath each operational
  object as immutable full snapshots protected by tenant RLS. A snapshot keeps
  pole count, line length, normalized lamp groups (`lamp type + wattage + head
  count`), and ordered supply points with panel reference, meter number, paired
  latitude/longitude and location notes. Total head count is derived from the
  groups instead of being entered as a conflicting second fact. Panel and meter
  Asset references are accepted only when that same-tenant Asset is already an
  active component of the object. Saving requires the current object version,
  advances both the specification and object versions, and appends object-event
  plus tenant-audit evidence; prior technical snapshots cannot be rewritten.
- Location schemes and general photos are object master evidence, not anonymous
  attachment rows. The object API accepts only JPEG, PNG or WebP up to 15 MB and
  records the file as a canonical Document, immutable Document Version with
  SHA-256 checksum, typed `location_scheme` / `site_photo` Document Link,
  lifecycle event, object event and tenant audit. Authorized object readers may
  preview or download the current version; a separate domain permission governs
  upload. No legacy object values were silently promoted into this new master.
- Migration `0102` extends the same immutable technical-master authority to
  camera objects without copying lighting terminology. A camera specification
  contains ordered pole/point records with paired GPS coordinates and normalized
  device groups containing camera type, manufacturer, model, quantity,
  resolution, lens, PTZ/night-vision capability, connectivity and power facts.
  Object-level camera totals are derived from device quantities. The existing
  110 camera objects and their aggregate 302-camera legacy baseline remain
  source evidence only. The preserved import evidence contains four paired raw
  coordinate rows and 35 partial-coordinate rows, but no reviewer has created a
  canonical point, device or GPS fact from them; the restricted read-only
  re-export continues to exclude private coordinates.
  The camera registry keeps separate object/point/camera/GPS totals and one
  bordered master table with an explicit open/edit action. Unlike lighting, it
  no longer shows a second object-category card section: the current pilot work
  is more naturally navigated by one compact **Байршил ба ажиллагаа** section.
  Operational KPI cards remain on the overview tab instead of being mixed into
  the object registry.
- Migration `0103` extends the existing governed operational-incident ledger to
  the camera workspace instead of creating a camera-only fault store. The
  tenant owns six bounded camera incident types. Device-unavailable, image-
  quality and physical-damage quantities use `камер`; power, network and
  inspection findings use `тохиолдол` and therefore do not invent a camera
  denominator. The **Гэмтэл** tab now mirrors the reviewed lighting interaction:
  each filtered object row shows pole/point, total camera and GPS counts, the
  unresolved quantity for the selected type's unit, a minus/number/plus local
  draft, projected availability for camera-counted types, optional notes and
  one explicit batch save. The API rechecks permission, tenant-owned object and
  type, retired state, duplicate target, future time and known camera capacity;
  accepted rows append the canonical incident, incident event, exact-payload
  receipt and tenant audit. Camera reporter/supervisor roles are separate from
  lighting roles while the permission vocabulary is shared and domain-neutral.
  New tenant provisioning, Builder application and later camera-module
  activation all install the same camera reference/role configuration.
- The camera fault sheet now uses the same reviewed multi-fault interaction as
  lighting: objects with open faults sort first; **All / Faulty only** shows
  distinct object counts; current faults are visible by type and remaining
  quantity; multiple types can be prepared for one object and reviewed in one
  batch before saving. An authorized supervisor can cancel a specific mistaken,
  unlinked camera Incident with a reason, version check, idempotent receipt,
  append-only Incident evidence and tenant audit. Work-linked faults fail closed.
  The change was promoted to production in release `20260904T104631Z` after
  exact-image lighting and camera live rehearsals; LAN was not changed.
- A read-only comparison with the legacy camera registry confirmed that its
  useful nested navigation is a second dimension, not another object category:
  110 source points split into groups `3=1`, `5=1`, `7=15`, `8=9`, `9=21`,
  `98/Авто зам=43`, and `99/Аж ахуйн нэгж=20`. The camera workspace now projects
  those preserved source groups in the primary camera navigator, adds
  code/name/location search, and then filters the same object, incident and Work
  Order views by operating state. The six rows whose legacy `sub_category` was
  empty all have explicit `bag_no=9`, and their names and locations independently
  identify the ninth bag, so they are included in that source group without a
  category guess. A future row without a supported group remains visibly
  **Ангилал тодорхойгүй** inside this same navigator. Open canonical incidents produce **Засвар
  шаардлагатай**; no open incident produces **Хэвийн**; legacy **Татан буулгах /
  Нүүлгэх** values are isolated as **Шийдвэр хүлээж буй** instead of being
  written into master lifecycle state. The demo distribution is 20 attention,
  10 decision-pending and 80 normal objects. This projection adds no schema,
  migration or business-data write; a future canonical geographic/service-zone
  reference requires reviewed tenant configuration rather than inferred bag
  text.
- The unified Work Board now reuses that same immutable camera source-group
  projection. Selecting **Камер** opens a second **Камерын байршлын бүлэг** row
  with `3`, `5`, `7`, `8`, `9`, `Авто зам` and `Аж ахуйн нэгж` filters; counts
  describe open intake incidents rather than object inventory. The selected
  group filters both incident intake and existing camera Work Orders, and each
  card carries the location-group badge. Authenticated demo verification found
  30 open camera incident rows (`7=5`, `98/Авто зам=21`, `99/Аж ахуйн нэгж=4`)
  and six active camera Work Orders. Five work rows retain a source group;
  one citizen-request Work Order has no linked operational object and therefore
  remains explicitly **Байршил тодорхойгүй** instead of being guessed from its
  title. No new work authority, table or business-data write was introduced.
- Choibalsan's `panel-board` service-area row is retained for history but made
  inactive in the demo. It is no longer shown as a peer lighting-object card or
  duplicated as fixed-asset rows in that registry; panels and meters remain
  valid Asset components and supply-point references inside their parent
  lighting objects. This demo configuration has not changed the production
  five-area projection.
- Fiber-optic cable remains intentionally outside the lighting and camera-device
  technical profiles. Demo migration `0104` implements it as a separate
  tenant-scoped network-route authority: a stable route points to an immutable
  GeoJSON `LineString` revision containing reviewed core count, display color,
  server-derived length and note; typed network nodes represent splice, closure,
  ODF, cross, splitter or other GPS points and may link to two reviewed routes.
  Route/node lifecycle is version-guarded and archives instead of hard-deleting;
  immutable revisions, links and events are protected by database triggers and
  every accepted command writes tenant audit evidence. Separate read/manage
  permissions and camera-network viewer/editor roles prevent the GIS surface
  from inheriting authority from a label alone.
- The camera workspace now contains a separate **Шилэн кабель** demo tab. It
  retains the useful legacy interactions—GIS/full-screen mode, satellite/street
  base maps, route draw/save/cancel, `4/6/8/12/24/48/96 core` color layers,
  route search, splice/ODF/box point placement, camera-layer toggle and GPS
  assignment—without copying the legacy implementation's GET-time table
  creation or direct DELETE behavior. The reviewed map-first revision gives the
  canvas at least 680 pixels of working height, expands it to the full viewport,
  docks layer and selected-object palettes at the sides, and keeps select,
  route, node, camera-GPS, undo, search, fit and maximize tools in a compact
  CAD-style toolbar. The redundant title/action header has been removed; refresh
  is also on the map toolbar, while add-cable and GIS actions use the existing
  route and maximize tools. A coordinate/zoom status bar remains visible while drawing.
  Full-view toggling preserves unfinished form values, route vertices and a
  selected point. Read-only tile sampling at the current Choibalsan center found
  real Esri imagery through zoom 17, while zoom 18 and 19 both returned the same
  small **Map data not yet available** placeholder. The satellite layer therefore
  overzooms zoom 17 instead of requesting those unsupported deeper tiles, while a resize observer invalidates the Leaflet
  canvas after layout/full-view changes to prevent blank or offset tiles. The
  map overlays camera points but does
  not reclassify cable as a camera device or fixed Asset. The current 110 legacy
  camera objects have no canonical point specifications, so they appear as
  explicit **profile хянаагүй** GPS targets. Selecting one and saving reviewed
  coordinates creates that object's first immutable camera specification with
  one point and the preserved aggregate camera count marked as technically
  unreviewed; later GPS changes create a new complete specification version
  rather than updating history. No canonical route, node or camera GPS row was
  seeded by this implementation.
- No PTZ/PTS, CAD, KML/KMZ or tabular file containing the stated approximately
  1,000 camera points was found in the available workspace or legacy
  `asset_files` registry. Read-only SQLite inspection did find `23` legacy fiber
  routes with `184` LineString vertices. Every stored longitude contains the
  same `5,726,520` offset. Subtracting that offset puts all vertices within the
  Choibalsan review bounds (`114.513596..114.573627`,
  `48.064613..48.110261`), and the recomputed distance of every route matches
  its stored metre length exactly.
- Demo migration `0105` therefore adds a separate tenant-scoped, append-only
  recovery staging authority for import batches, candidates and human review
  decisions. The demo contains one idempotently fingerprinted batch with the 23
  routes and 184 normalized preview vertices. These appear as a dashed
  **Legacy сэргээх preview** map layer and a table that compares source versus
  recomputed length; all start as **Хяналт хүлээж буй**. Confirm/needs-correction
  decisions append review and tenant audit evidence. There is deliberately no
  staging-to-canonical promotion command yet, and the malformed source geometry
  remains intact beside the normalized preview.
- `LIGHTING_OPERATIONS_DISCOVERY_AND_DEMO_CONTRACT_V1.md` records the read-only
  legacy/canonical reconciliation and the later schedule -> meter reading ->
  electricity invoice plan. JavaScript syntax checks and the full repository
  suite pass `457/457`. Clean `0001` through `0103` migration passed on a
  disposable database with RLS active on all three technical-profile tables. A
  separate disposable API smoke round-tripped 200 poles, two wattage groups with
  400 derived heads, 5 supply points with meter/panel/GPS data and one canonical
  scheme image; it rejected a stale write and verified two object events, two
  audit entries and the document link before removing the test container and
  database. A separate disposable camera API smoke saved two points, three
  normalized device groups and four derived cameras, rejected a stale write,
  and verified object-event and audit evidence before cleanup. The earlier
  lifecycle smoke also proved versioned edit, retirement
  and removal from the active registry. Authenticated rehearsal proved
  eight tenant reference types, exact-payload replay, changed-payload conflict,
  cross-tenant object rejection, and exactly one incident/event/receipt/audit
  for one accepted row. A second disposable camera-incident rehearsal proved
  six tenant types, exact replay and changed-payload conflict, camera-capacity
  rejection, occurrence-based capture without a false capacity, cross-tenant
  rejection, and matching incident/event/receipt/audit evidence.
  The fiber workspace static contract adds seven focused tests, and authenticated
  demo smoke confirms `110` selectable camera-point review targets, `0` silently
  created GPS points, `23` staged recovery routes, `184` normalized preview
  vertices, both scoped capabilities, and healthy API/Web. The port
  `4200` demo is now at schema `0105` on
  `overva_rehearsal_lighting_demo`; authenticated regression smoke confirms
  36 road objects, 1,747 poles, 2,582 heads, 69 unclassified objects, 12
  canonical traffic signals and zero visible `ГД-*` copies. Production stayed
  at `0098`.
  A clean migration rehearsal, production-snapshot `0098` to `0105` rehearsal,
  exact candidate-image release check, full `457/457` suite and old-image
  rollback health check have now passed. The frozen rollout and rollback gate
  is recorded in
  `PRODUCTION_LIGHTING_CAMERA_FIBER_RELEASE_CANDIDATE_20260903T121824Z.md`.
  The first production GO completed backup, migration and cutover, but the
  authenticated lighting smoke triggered the stop condition above. Prior
  API/Web images were restored healthy; the attempt and verified backup are
  recorded in
  `PRODUCTION_LIGHTING_CAMERA_FIBER_ROLLOUT_20260903T123901Z.md`. Status remains
  **HOLD** until a separately approved, audited production provenance
  reconciliation is implemented and rehearsed; the demo-only reconciler must
  not be run on production.

## Lighting operations workspace

- The Choibalsan lighting workspace is now a role-focused projection of the
  same canonical operational objects, incidents, fixed assets, service areas,
  and Work Orders used elsewhere in OVERVA. It does not create a second work
  engine. The internal views are **Нүүр**, **Объект ба тоноглол**, **Гэмтэл,
  үзлэг**, **Ажлын гүйцэтгэл**, **Ашиглалтын хяналт**, and **Судалгаа,
  тайлан**. Selecting one of the tenant-configured five lighting areas filters
  every view consistently.
- The workspace no longer presents the old mixed **Нийт объект** total as one
  comparable measure. Each area separately exposes operational/fixed-asset
  record count, open issue count, and active canonical Work Order count. The
  current production projection is road `117/36/12`, ger-area `191/108/4`,
  tower `143/60/0`, panel `295/0/0`, and traffic-signal `12/0/1` for
  record/open-issue/active-work respectively. Two open issues and ten active
  lighting works remain explicitly unclassified because retained evidence is
  insufficient; the UI does not guess their area.
- Operational objects remain separate from accounting fixed assets. Road,
  ger-area and tower operating records open the existing object dossier;
  panel/board and traffic-signal equipment remain linked to the fixed-asset
  master. **Ажлын гүйцэтгэл** links back to the organization-wide Work Board
  and preserves its HSE and chief-engineer workflow.
- The current canonical records expose object, light/head, meter-number and GPS
  completeness. Legacy on/off schedules, monthly meter readings and electricity
  billing are identified as the next governed integration, not represented as
  live OVERVA authority yet. The legacy application is not queried live by the
  new workspace.
- Implementation commit `d2f947c` is live on production API/Web at unchanged
  schema `0098`; the controlled no-migration release is recorded in
  `PRODUCTION_LIGHTING_WORKSPACE_RELEASE_20260902T165603Z.md`. The full
  repository suite passes `419/419` tests.

## Purpose-aware work routing and team backlog

- Repository migration `0097` adds tenant-owned work service areas as a
  presentation/reporting dimension independent from department, Work Type and
  workflow stage. Choibalsan alone is configured with the five reviewed legacy
  lighting areas: **Авто замын гэрэл**, **Гэр хорооллын гэрэл**, **Цамхагийн
  гэрэл**, **Шит/Самбар**, and **Гэрлэн дохио**. The Work Board exposes them as
  a second filter row only while **Гэрэлтүүлэг** is selected, keeps the selected
  area through every canonical lane, and lets direct urgent work record an
  area. Intake conversion inherits the source area's tenant-scoped identifier
  and rejects a conflicting client override. Counts explicitly represent live
  queue items rather than the legacy screen's mixed asset, location and fault
  totals. The full repository suite passes `418/418`; a production-clone
  rehearsal preserved business invariants, seeded five Choibalsan areas and
  zero other-tenant areas, and left two source-ambiguous open lighting records
  visibly unclassified. The controlled rollout of implementation commit
  `804659b` plus tenant-RLS read follow-up `e7cc947` is live at production
  schema `0097` and recorded in
  `PRODUCTION_WORK_SERVICE_AREAS_RELEASE_20260902T155416Z.md`. User-review
  follow-up `48f90b1` enlarges the broad source controls above the smaller
  lighting-area row and removes the redundant **Миний хариуцсан** and direct
  create controls from the Work Board header. Configured-title follow-up
  `05ec981` is live at schema `0098`: each service area may own its intake and
  team-lane wording, while broad department and canonical downstream workflow
  titles remain stable.
- The controlled API/Web rollout of commit `57f6c4f` is live at schema `0096`
  and recorded in
  `PRODUCTION_WORK_BOARD_SOURCE_VIEWS_RELEASE_20260902T150131Z.md`. Production
  role smoke proves the chief engineer sees all `236` current intake items,
  while the electric and camera engineers see only their own routed department
  queues (`206` lighting and `30` camera); an ordinary worker receives zero.
  User-review follow-up `af40d14` is also live: the post-intake lane is named
  **Ажил болгосон**, and fresh Web cache identities serve the segmented source
  filters instead of the browser's stale unstyled buttons.
  Follow-up `09ab08c` then aligns that wording with department ownership: the
  focused lighting flow is **Гэрэлтүүлгийн тасагт ирсэн → Гэрэлтүүлгийн
  тасгийн ажил**, intake acceptance is **Тасгийн ажилд авах**, and each intake
  badge exposes its road, ger-area, tower, traffic-signal, or other source area.
- The repository and production migration paths reach `0096`. The controlled
  rollout of commit `1a49a1f` is recorded in
  `PRODUCTION_WORK_ROUTING_RELEASE_20260902T143412Z.md`. Migration `0096` keeps one canonical
  Work Order engine while separating `operational_stream` (core service or
  internal operation), `assignment_kind` (normal, special or emergency), and
  the existing safety/approval workflow. These dimensions must not be inferred
  from one another.
- Tenant-owned `organization_work_intake_routes` provide deterministic intake
  suggestions. A suggestion selects an active Work Type and thereby its
  configured department and workflow, but never creates or assigns work by
  itself. Choibalsan receives exactly two reviewed pilot mappings: lighting and
  camera repair. Other organizations receive none.
- Organization-wide readers with create authority may triage the full intake.
  A department specialist with create authority sees only incidents whose
  active tenant-owned intake route resolves to that specialist's own
  department. Conversion is checked again server-side against the exact
  incident-domain/Work-Type route; a UI filter cannot expand this authority.
- The Work Board keeps source categories as presentation, not workflow state.
  Lighting, camera and other intake tabs filter the same end-to-end lanes, and
  source badges keep mixed backlog cards recognizable. Lighting and camera
  specialists start in their own category; management's exception decision is
  a separate permission-gated view instead of a permanent lane in everyone's
  normal board.
- A normal, classified and routed unassigned Work Order appears in the
  responsible team's backlog. An active user in that department with both
  assignment and progress authority may claim it for themselves. Claiming is a
  row-locked, idempotent canonical assignment with an append-only
  `self_claim` event and audit evidence. If the Work Type has a governed safety
  route, the claim then opens HSE start review; it never bypasses HSE.
- Unclassified, special and emergency work remains in the chief engineer's
  exception queue. The chief engineer retains oversight and final acceptance,
  but does not become the mandatory manual dispatcher for every routine item.
  The normal Work Board therefore presents seven stages: issue/need intake,
  team backlog, HSE start, execution, HSE completion, chief-engineer acceptance
  and completed history. Exception decision is a separate management view.
- The production-clone rehearsal preserved the `4/25/25/63/1715/106/768/103/
  0/31/32` organization, user, employee, assignment, attendance, Work Order,
  event, approval, safety-review, document and version invariants. It classified
  91 Choibalsan works as core service and the 15 previously reviewed unrelated
  legacy works as internal operations, yielding 9 claimable team-backlog items
  and 9 exception items without changing status, workflow stage or history.
  Runtime grants, RLS (`2` Choibalsan routes, `0` other-tenant routes), all four
  checks and an idempotent `0096` rerun passed. The full repository suite passes
  `417/417` tests. Production authenticated smoke returned the same `26`
  assigned, `9` team-backlog, `9` exception and `62` closed projection.

## Unified operational intake and Work Order coordination

- The repository and production migration paths reach `0095`. The controlled
  rollout and legacy Work Order reconciliation are recorded in
  `PRODUCTION_UNIFIED_WORK_INTAKE_RELEASE_20260902T135313Z.md`. Migration `0095`
  adds the tenant-scoped, append-only
  `operational_incident_work_orders` coordination link. Existing operational
  incidents remain the source truth for defects, inspection findings and other
  needs, while the canonical Work Order remains execution and approval truth.
- The Work Board foundation introduced seven understandable stages. Migration
  `0096` extends it with the team-backlog stage described above; the separate
  closed view retains the full completed/cancelled history.
- Intake combines generic incident domains rather than hard-coding lighting or
  camera as universal product rules. Organization-wide readers with create
  authority see the full queue; department specialists with create authority
  see only their exact configured route. It shows possible same-object active
  work as a duplicate warning and prevents one incident from creating a second
  active linked Work Order.
- A routed Work Order without an assignee stays in the chief-engineer decision
  stage. Assignment moves it to HSE start review and notifies the configured
  safety authority; this removes the false HSE backlog caused by treating every
  imported unassigned item as already submitted for safety authorization.
  Final accepted completion resolves the linked source incident in the same
  tenant transaction and appends incident evidence; no historical approval or
  safety review is fabricated.
- The Choibalsan legacy projection was reconciled from the live read-only source
  without fabricating approvals or safety reviews. Its 106 Work Orders now show
  17 chief-engineer decisions, 4 HSE start reviews, 2 executions, 4 HSE
  completion reviews, 17 chief-engineer acceptances and 62 completed works.
  Fifteen fleet/facilities/other works were removed from the incorrect lighting
  route while retaining their original category and Work Order identity. The
  correction appended exactly one source-checksum-bearing event per Work Order;
  Work Order approvals stayed at 103 and safety reviews at zero.
- The chief-engineer operations center treats standard `pending_review` Work
  Orders without a configured workflow as management decisions too, so its
  acceptance count agrees with the canonical Work Board instead of omitting a
  general organizational task.
- Verification passes the full `411/411` repository suite and JavaScript syntax
  checks. Clean `0001` through `0095` migration and an idempotent rerun passed on
  a disposable local PostgreSQL database. The production migration entrypoint
  also refreshed runtime grants there, and the disposable database was removed.

## Work-order HSE permits and governed field-work closeout

- The repository and production migration paths now reach `0095`; the primary
  local business database remains at `0090`. Production deployment completed
  through the controlled release recorded in
  `PRODUCTION_WORK_ORDER_SAFETY_RELEASE_20260902T102759Z.md`.
- Migration `0094` adds tenant-scoped, versioned safety templates and work-type
  routing plus append-only `work_order_safety_reviews`. Start and completion
  reviews preserve the selected checklist version, decisions, risk inputs,
  hazards, controls, PPE, validity, actor and a work-order scope snapshot. The
  new authorities have server-side tenant RLS, and production runtime grants
  deny review update, delete and truncate. Workflow actions use tenant-scoped
  immutable idempotency receipts with exact-payload conflict detection.
- The canonical Work Order remains the single work authority. Its configurable
  flow now supports assignment -> HSE start review -> execution -> engineer
  completion submission -> HSE completion inspection -> chief-engineer final
  approval -> closed. An HSE return or execution suspension retains review
  evidence instead of silently rewinding history. Completion submission fails
  closed when the current start permit is expired or its assignee, object or
  work scope no longer matches the approved snapshot.
- The engine and state model contain no universal camera, lighting or
  Choibalsan rule. Migration `0094` seeds two checklists and seven exact
  work-type routes only for the existing `choibalsan-hugjil` organization, and
  configures that tenant so HSE start approval directly authorizes execution.
  Other organizations receive no copied checklist, route, policy or business
  data. The schema supports their own versioned templates when onboarding
  evidence supports them; self-service template administration is not yet an
  implemented tenant UI and remains governed setup work.
- The work board represents six conceptual lanes (new/assignment, HSE start,
  execution, HSE completion, chief approval and closed). The HSE workspace has
  dedicated start, monitored-execution and completion queues, including
  structured review and suspension actions.
- The repository web client now presents those queues as a role-focused
  **Миний ХАБЭА ажлын талбар** instead of rendering three long lanes at once.
  It defaults to the start/completion decisions requiring HSE action, gives
  completion inspection explicit priority, and provides real count-bearing
  tabs, work/type/assignee search, due-date filters and bounded progressive
  disclosure. Existing Work Order history and structured safety-review dialogs
  remain the only decision path; risk, incident, briefing, training evidence
  and route records are grouped under a separate internal records tab. This
  browser refinement is production-deployed through the web-only controlled
  release recorded in
  `PRODUCTION_HSE_ROLE_WORKSPACE_RELEASE_20260902T112355Z.md`; API image, schema
  `0094` and production business data were not changed by that release.
- Migration `0094` also extends the existing notification type constraint
  without removing any previously accepted value. It admits the
  `work_order_workflow` and `work_order_returned` notifications emitted by the
  governed Work Order flow, so creation and return actions remain transactional
  instead of failing with PostgreSQL `23514`.
- Verification passes the full `404/404` repository suite and JavaScript syntax
  checks. Clean `0001` to `0094` migration passed on a disposable database. A
  second disposable rehearsal inserted both Choibalsan and an unrelated future
  organization before applying the pilot migrations: the resulting template
  and route counts were `2/7` for Choibalsan and `0/0` for the other tenant;
  all three new authorities exposed tenant RLS policies. Both rehearsal
  databases were removed afterward. A further disposable clean-schema API
  regression created a workflow-routed Work Order with HTTP `201`, verified its
  `work_order_workflow` notification, and verified the return notification type;
  that database was also removed afterward.

## Confidential disciplinary cases

- Repository migrations and production now reach `0095`; the existing local
  development business database remains at `0090`. Production was migrated
  from `0090` through `0093` on 2026-09-02 by the controlled Employee Relations
  release recorded in
  `PRODUCTION_EMPLOYEE_RELATIONS_RELEASE_20260902T063615Z.md`. Clean `0001` to
  `0093` was also verified on a disposable database and removed afterward;
  the later `0094` Work Order release did not alter this domain's records.
- Migration `0093` adds a separately authoritative, always-`restricted`
  `hr_discipline_case` aggregate. It preserves reviewed policy/legal basis,
  notice, explanation or refusal, investigation, finding, recommendation,
  independent decision, acknowledgement, effective period, expiry/early
  removal and dispute evidence without inventing history for existing people.
- Complaints handoff acceptance and discipline creation are atomic: acceptance
  records the new case identity and an append-only handoff event in the same
  transaction. Decline is reason-required, versioned, exact-payload idempotent
  and audited. A handoff remains a request, never a finding.
- Confidential list/detail access, intake, investigation, recommendation,
  decision and post-decision administration are separate backend permissions.
  Sensitive command reasons remain in restricted discipline events; shared
  workflow and general audit coordination receive only a redacted command
  label and case identity.
  A snapshotted four-eyes rule blocks the creator, investigator or recommender
  from deciding when required. The Article 123 deadline is calculated
  server-side from the violation/last-continuing date, discovery date, ordinary
  six-month or full-property-liability one-year occurrence limit, one-month
  discovery limit and evidenced suspension periods. The calculation and rule
  version are preserved with the case. Sanction expiry is calculated one year
  from the server decision date; early removal requires canonical evidence.
  One `(Employee, violation identity)` guard fails closed and no Visio-specific
  tenant deadline or approver is hard-coded.
- Users without confidential discipline read authority receive no real case
  count or list. Canonical documents linked to discipline are also filtered
  from document list, version, upload, lifecycle and download paths unless the
  same confidential permission is present. Restricted document classification
  separately requires its document permission.
- Human Resources exposes the restricted queue under its internal employment-
  relations tabs. The full repository suite passes 394/394; clean migration
  and disposable PostgreSQL integration pass atomic handoff intake, tenant
  denial, RLS, restricted lifecycle, independent decision, canonical evidence,
  immutable events, audit and outbox intent.

## Employee transfer and rotation

- Migration `0092` is included in the clean `0001` to `0093` verified path. The
  local and production boundaries stated above remain unchanged.
- Migration `0092` adds a separate tenant-scoped `hr_transfer_case` authority
  for temporary transfer and rotation. It records the source Assignment,
  reviewed target, legal/policy snapshot, effective dates, consent, workload,
  proposal and management-decision evidence. Existing employees and
  Assignments receive no fabricated transfer history.
- Named commands enforce draft, eligibility, consent, HR review, management
  review, decision, effective implementation, monitoring and completion. RBAC,
  expected version, exact-payload idempotency, shared-workflow coordination,
  audit/outbox intent, canonical document links, RLS and append-only case events
  are applied server-side.
- Only the approved `implement` command can change the canonical primary
  Assignment. It ends the prior effective-dated row, creates one new active row
  and synchronizes Employee/User projections in the same transaction. A due
  temporary transfer restores the prior placement by creating another new
  Assignment rather than reopening or deleting history.
- Human Resources exposes this under the internal `Хөдөлмөрийн харилцаа` tab;
  the sidebar remains flat. Focused tests pass, the full repository suite
  passes 394/394, and the disposable PostgreSQL integration verifies the
  Assignment change, tenant denial, RLS, immutable events, canonical evidence,
  audit and outbox intent.

## Complaint resolution and HR assessment handoff

- Complaint migration `0091` is included in the current repository migration
  path and was reverified through clean `0001` to `0093` migration and the
  disposable Phase 2 integration. The local and production boundaries stated
  above remain unchanged.
- Complaints remains the authoritative case domain. Migration `0091` extends
  its allowed lifecycle with optional `implementation_monitoring`; named,
  reason-required commands now cover additional-information requests,
  implementation monitoring and completion without fabricating history for
  existing cases.
- `complaint_hr_handoffs` records an explicit request for HR to assess whether
  a separate disciplinary case is warranted. It does not create a discipline
  case. Requests are tenant/RLS scoped, backend permission checked, expected-
  version guarded, exact-payload idempotent, audited and coordinated through
  the existing workflow/outbox transaction. Evidence uses canonical
  `document_links`; lifecycle evidence is append-only in
  `complaint_hr_handoff_events` and protected by production runtime grants.
- The tenant UI exposes additional-information, implementation-monitoring and
  HR-assessment actions inside the Complaints workspace. Handoff detail remains
  visible in the case dossier; the sidebar remains flat.
- `EMPLOYEE_RELATIONS_PROCESS_IMPLEMENTATION_PLAN_V1.md` is the staged delivery
  contract. All three approved local slices are now implemented and verified;
  production deployment remains outside its approval.
- Focused employee-relations, statutory-clock and Phase 2 contract tests pass
  27/27. Clean migration and the
  disposable Phase 2 PostgreSQL integration pass tenant denial, RLS,
  idempotency replay/conflict, concurrency, append-only evidence, canonical
  links, audit and outbox intent, including complaint-to-HR handoff. No
  production deployment or data write was performed.

## Legacy migration provenance and review foundation

- The legacy-import foundation remains implemented through migration `0090`;
  the repository now also contains unrelated employee-relations migrations
  `0091`-`0093`.
  Documented production remains `0080` and was not connected to, migrated,
  written or deployed. Migrations `0087`-`0090` are additive, change no prior migration
  checksum and import no domain record. `0088` binds provenance projection
  updates to exact decision evidence. `0089` adds deterministic review cases,
  append-only membership/decisions and immutable batch-command receipts.
- `legacy_provenance_records` gives every staged source row a unique
  `(organization_id, legacy_source, legacy_table, legacy_id)` identity,
  source/payload checksums, classification, optional validated target,
  duplicate signals and current review projection. Source identity and evidence
  cannot be updated or deleted. `imported_at` can move from null exactly once
  only when a matching append-only `IMPORT_COMMITTED` event exists; it cannot
  be silently edited.
- `legacy_provenance_decisions` is the append-only registration/review journal.
  Review writes require a backend permission, expected version, UUID
  idempotency identity and exact payload hash. Reuse with another payload,
  stale/concurrent writes, cross-tenant targets, silent projection changes,
  decision mutation and audit mutation are rejected. Runtime grants also revoke
  decision update/delete/truncate and registry delete/truncate.
- The legacy extractor opens SQLite read-only with `PRAGMA query_only`; its
  staging script writes only provenance, decisions and one batch audit. It
  resolves Employees by existing `legacy_user_id`. Departments, Jobs and
  Positions are corroborated through those Employees and their one active
  primary assignment, never by a name-only merge. No employee, master,
  attendance, document, correspondence, archive or workflow writer exists in
  this slice.
- Local review staging contains 2,318 identities: 73 `MATCH_EXISTING`, 48
  `IMPORT_NEW`, 2,196 `REVIEW_REQUIRED`, and one `LEGACY_ONLY`. All 21 active
  Employees, three Departments, fourteen Jobs, fourteen Positions and twenty-
  one active Assignments have validated existing targets. Exact rerun produced
  zero creates and 2,318 replays.
- The 2,196 unresolved source rows are now represented by 1,901 deterministic
  review cases, reducing raw human-review units by 295. Attendance becomes
  1,806 employee/date cases: 145 duplicate groups contain 431 rows, with a
  latest-row candidate and explicitly non-final superseded candidates. Orders
  become 55 cases from 57 rows; correspondence remains 13 cases; seventeen
  risky document/attachment rows become ten cases. Duplicate evidence includes
  two document-number groups, four content-hash groups affecting eleven files,
  and two orphan attachments.
- Recommendations contain 31 high-confidence `IMPORT_NEW` review cases (25
  orders/decisions and six correspondence), 64 true manual-review cases
  covering 73 rows, and 1,806 reconciliation-blocked attendance cases covering
  2,092 rows. All seventeen inactive users remain manual: every one has an
  active-employee name-overlap signal and ten also have HR evidence. Names and
  hashes remain signals only; they are not merge keys. Correspondence is not
  auto-classified as a complaint.
- Authorized reviewers can select up to 200 cases and approve an eligible
  recommendation, retain non-attendance evidence as legacy-only, send cases to
  manual review and add a note. Every command is tenant-scoped, exact-payload
  idempotent, expected-version guarded and atomic. Attendance approval and
  legacy-only disposition fail closed while production reconciliation evidence
  is missing. A review decision changes only migration projections; no actual
  import or canonical target creation occurs.
- Safe `IMPORT_NEW` approval is now fail-closed to high-confidence,
  no-external-evidence `ORDER_DECISION` and `CORRESPONDENCE` groups. The UI can
  select the visible safe set, but approval remains a separate review command
  and never invokes the importer. The Web image now includes the review JS/CSS;
  missing script or stylesheet paths return `404` instead of the SPA shell.
  Local verification approved exactly 25 order and six correspondence groups
  with the authorized reviewer note, advancing each to version one. The batch,
  group and provenance decisions and audit are append-only; the exact command
  replayed idempotently and did not invoke the importer.
- Migration `0090` adds tenant/RLS-scoped, append-only canonical import run,
  source-to-target mapping and import-event evidence. Only owner/administrator
  roles receive the separate `legacy_migration.import` permission. Production
  runtime grants cannot mutate those journals.
- The canonical adapter reads legacy SQLite in query-only mode, verifies the
  database, parent-row and attachment checksums, requires an approved safe
  group and stable Employee/User linkage, and fails on number or identity
  collisions. It creates only canonical Documents/Versions/Links and the 0086
  correspondence aggregate baseline. Legacy status remains mapping metadata;
  no correspondence event, shared workflow case or historical transition is
  synthesized. Exact source reruns reuse mappings, changed idempotency payloads
  conflict, and a partial failure rolls back the tenant transaction and removes
  newly written files.
- The CLI is dry-run by default. Commit requires both `--commit` and
  `ALLOW_LEGACY_CANONICAL_IMPORT=true`; no HTTP import action exists. The local
  importer now uses an explicit raw-byte SHA-256 helper for file content while
  retaining the existing canonical JSON hash for structured source and command
  payloads. Existing staged evidence was not rewritten. The local post-approval
  dry-run verified 31 parent rows and 32 attachment files, planned 31 Documents,
  32 Versions and six Correspondence records with 69 source-to-target mappings,
  and found zero skips, checksum failures or conflicts. After separate explicit
  approval, the same immutable snapshot and approved set were committed only to
  the local environment. The commit created the planned 31 Documents, 32
  Versions, six Correspondence records, 53 Document links, 69 mappings, 63
  import events and 63 imported provenance markers. A same-key replay returned
  the original run and produced no additional write.
- The rebuilt local API image contains the raw-byte checksum fix but no
  `sqlite3`, `node-gyp`, `tar` or related importer build chain. Canonical legacy
  import now runs only in a non-root, no-port, one-shot container behind the
  opt-in `legacy-import` Compose profile. Its separate locked runtime uses
  `sqlite3@6.0.1` with patched `tar@7.5.22`; both API and importer production
  audits report zero vulnerabilities, and compiler, optional `node-gyp` and
  package cache are absent from the final importer image. The immutable
  SQLite/attachment snapshot at
  `backups/legacy-canonical-precommit/20260901T101143Z` has database SHA-256
  `5df2aa170d5ef865e46ed09bab5d576d3c229454a78557df06abb676e4bf1a47`;
  its mount is read-only and its manifest plus 60 attachment checksums remain
  unchanged. `OPEN_READONLY`, `PRAGMA query_only=ON` and an expected rejected
  write were verified against the snapshot. The isolated container reproduces
  the approved 31 source/32 file/31 Document/32 Version/six Correspondence/69
  mapping dry-run with zero reuse, skips, conflicts, checksum failures, database
  writes or canonical-upload changes. The later controlled local commit used
  the gate only for its one-shot execution; production was not connected to,
  deployed or written and remains a separate approval boundary.
- Forty-seven other attachments plus one employee file remain eligible only for
  a later importer. The grouped stager created 1,901 cases/2,196 memberships;
  exact rerun created zero and replayed all 1,901.
- Local post-import invariants remain: 21 Employees, all 21 null `employee_no`,
  zero attendance and workflow cases/transitions, and no fabricated historical
  workflow evidence. The approved import added 31 canonical Documents, 32
  Versions, six Correspondence records and 63 non-null `imported_at` values;
  other review groups remain untouched. Approval evidence still consists of 31
  version-one group decisions, 31 version-one provenance decisions, one
  immutable batch receipt and one batch audit; no attendance, inactive-user or
  manual document/attachment review group was decided.
  Clean `0001` to `0090` disposable migration, grouped-review, provenance and
  canonical-import PostgreSQL integrations, 372/372 repository tests and
  JavaScript syntax checks pass. The importer integration verifies dry-run,
  permission/tenant scope, checksum conflict, canonical mapping, replay,
  rollback/file cleanup, immutable evidence and absence of fabricated workflow
  history. Disposable databases were removed afterward.

## Choibalsan HR, records, complaints and archive Phase 2

- Phase 2 domain migration `0086` remains the original domain baseline;
  Complaints is extended by repository migration `0091` and employee transfer
  by `0092`; confidential discipline is added by `0093`, while the local
  business database remains at `0090`. Production is at `0093`; the controlled
  rollout preserved all measured HR, attendance, Assignment, Work Order,
  complaint and document counts/fingerprints and created no inferred Employee
  Relations case or event.
  Migration `0086` is additive except for explicit widening of existing leave,
  correspondence and archive state checks. It creates no historical cases or
  events and does not infer any employee number.
- The tenant shell now keeps Human Resources, Records, Complaints and Archive
  as flat permission-filtered sidebar workspaces. Their refresh-stable internal
  tabs own domain navigation; status-oriented views such as overdue or waiting
  remain filters rather than sidebar destinations. Human Resources groups its
  registry, structure, employment transitions, time/leave, development,
  reporting and Smart Import surfaces without duplicating the canonical
  Employee master. Overdue Records and Complaints filters are enforced by the
  tenant-scoped overview queries. Visibility remains only a client convenience;
  every command is independently authorized by the server.
- Authoritative domain aggregates now cover appointment, leave, employment
  exit, transfer/rotation, confidential discipline, correspondence, complaint
  and archive records/access/destruction. Their
  state remains in the domain table. Shared workflow stores coordination,
  assignment, decision, comment, immutable transition and notification intent
  evidence in the same transaction.
- Consequential commands require an idempotency UUID and expected aggregate
  version, validate allowed state and evidence, write append-only domain and
  workflow history, audit the actor/reason/state/version/request identity, and
  enqueue notification intent. Exact retries replay; changed payloads and stale
  versions conflict. Critical browser actions remain pending until server ACK.
- Appointment finalization requires completed required-document checks,
  management approval, effective date and canonical order evidence. It links or
  creates the canonical Employee and primary assignment without inventing an
  `employee_no`. Leave uses request-supplied/configurable routing, overlap
  checks and explicit return/reject/cancel. Employment exit requires order and
  handover completion before the canonical employee lifecycle is changed.
- Correspondence uses collision-guarded registration, assignment/reassignment,
  response approval, official delivery evidence, close and archive transfer.
  Complaints have a separate authoritative case lifecycle and derived overdue
  signal. Archive supports intake, retention review, access/issue/return,
  destruction proposal, commission decision, immutable act, legal-hold checks,
  item-set hash and separate executor/verifier.
- Formal evidence uses the `0083` canonical `documents` and append-only
  `document_links` model. Legacy attachment and entity-reference reads remain;
  no existing reference is deleted or rewritten. Restricted document commands
  require `documents.restricted.read`; restricted discipline detail uses its
  narrower `hr.discipline.confidential.read` capability.
- Empty Phase 2 datasets are intentional. Local migration retained 21
  Employees, all 21 null `employee_no` values, and 106 Work Orders, while
  creating zero complaint cases and zero fabricated command receipts.
- Clean `0001` to `0093`, rerun/no-op and known-`0079` drift checks pass. The
  full unit/source regression is 394/394, and the disposable PostgreSQL Phase 2
  integration passes tenant denial, RLS activation, duplicate replay/conflict,
  concurrency, atomic complaint-to-discipline intake, confidential discipline,
  Assignment transfer, leave, appointment, archive, canonical documents,
  audit/event immutability and pending outbox intent.

## Shared workflow, tenant context and canonical document foundation

- Repository migrations now reach `0093`; the local development database has
  been reconciled from its known pre-release `0079` variant through `0090`.
  Production reached `0093` on 2026-09-02 through the verified additive
  `0091`-`0093` release; API and Web run the reviewed `68a7b59` artifact.
- Migration history remains evidentiary: the known local `0079` checksum is not
  rewritten. A narrowly matched compatibility rule permits the forward repair,
  and `0081` restores the canonical assignment identity guard and parent-delete
  restriction without creating or changing business history.
- A tenant-scoped shared workflow service provides case identity, coordination
  state/version, assignment/reassignment, transition decisions,
  approval/reject/return evidence, reasons/comments, exact-payload idempotency,
  optimistic concurrency, append-only evidence, backend authorization, audit
  integration and an immutable notification intent. It is a coordination
  primitive only: HR, correspondence, complaint and archive domain tables
  remain their respective sources of truth.
- Database tenant context is now transaction-local. Missing context fails
  closed, a second tenant on the same transaction is rejected, and pooled
  connection reuse was verified to retain no prior tenant. Background delivery
  enumerates the non-tenant organization registry and performs every business
  claim/update inside an explicit tenant transaction. System bypass is disabled
  by default, requires an explicit environment gate and reason, and has no
  application caller.
- Migration `0085` activated ten audited workflow, delivery and canonical-link
  tables; later Phase 2, provenance and grouped-review tables also activate
  their own audited policies. Local schema `0089` has active RLS on 38 of 75
  policy-bearing public tables. Remaining staged policies still require route,
  report, worker and admin compatibility audits. Application authorization and
  explicit tenant predicates remain mandatory.
- Migration `0084` keeps immutable notification intent separate from mutable
  delivery coordination and append-only attempt evidence. The worker supports
  pending, processing leases, retry scheduling, delivered and dead-letter
  states, bounded backoff, expired-lease recovery, stable provider idempotency,
  correlation/request identity and provider metadata. No email/SMS/push adapter
  is fabricated: the shipped provider is safely disabled and does not claim or
  consume pending intent.
- Canonical document relationships use append-only `document_links` while
  retaining `documents.linked_entity_type/linked_entity_id` and existing domain
  references. General and employee document creation dual-write atomically.
  The security-invoker compatibility view filters both canonical and legacy
  branches by transaction tenant. Concurrent duplicates converge on one link;
  cross-tenant attachment/document references and orphaning deletes are
  rejected. Unknown historical relationships remain null rather than inferred.
- The offline/retry foundation classifies drafts separately from actions that
  require server confirmation. Approval, rejection, termination, archive
  destruction, final close and permission/security changes can never appear
  final offline; retry envelopes require matching request and idempotency UUIDs
  and never accept a client-selected tenant.
- The broad legacy HTTP harness now uses canonical tenant provisioning and the
  current report contract. The Platform organization-create response preserves
  its flat subscription fields, and direct Work Order completion again notifies
  its assignee. The full harness passes on a disposable `0085` database.
- Clean `0001` to `0089` and local rerun/no-op migration gates pass; the prior
  known-`0079` drift reconciliation through `0088` remains covered and `0089`
  is the next additive step. The full unit/source suite passes 372/372. Workflow, delivery,
  RLS/pool-leak, canonical document, grouped legacy review, broad HTTP, Work Order assignment and
  material integrations pass on disposable databases. A production-migration
  rehearsal also verified that runtime may insert immutable intent/evidence and
  update delivery state, but cannot mutate/delete journals or delete the state
  projection. Local migration preserved
  21 Employees, all 21 null `employee_no` values, one organization and 106 Work
  Orders; no historical workflow/document attempt was invented.

## Work Order assignment history foundation

- Migrations `0078`–`0080` additively extend `work_order_events` with versioned, typed
  initial-assignment, assignment, reassignment, and unassignment evidence.
  Tenant-composite User and Employee references, optional idempotency, timeline
  indexes, a database append-only trigger, User-to-Employee pair integrity,
  parent-delete restriction, and stable automation delivery identity are
  included. The compatible
  `work_orders.assigned_to` field remains the current snapshot.
- Existing events are deliberately not backfilled. A null
  `assignment_history_version` remains legacy/non-canonical evidence, and
  reports return the missing historical attribution as `unknown` rather than
  projecting the current assignee backward in time.
- Migration `0079` is deliberately the schema-first transition phase: it
  accepts old-image unversioned assignment inserts as non-canonical evidence so
  application rollback does not break writes. Strict version-1 rejection is a
  separate future activation migration, permitted only after new writers have
  soaked and every old image has been retired. Runtime update/delete/truncate
  rights on the event journal are explicitly revoked in addition to the
  append-only trigger.
- One assignment service now owns assignee validation/reference resolution,
  initial history, snapshot changes, typed from/to evidence, idempotent replay,
  and same-assignee no-op handling. The Work Order create/assign API, legacy
  lighting import, and automation-created Work Orders use that contract.
- The management report people section now attributes period assignments and
  completions through version-1 assignment events linked to canonical
  Employees. Current open and overdue workload remains an explicitly current
  snapshot. CSV output distinguishes known versus unknown period-end assignee
  history, and the UI exposes legacy unknown counts as data-quality warnings.
- Creation-time assignment quality uses only an `initial` event recorded no
  later than the Work Order creation timestamp and inside the tenant-timezone
  period boundary. A later event cannot retroactively turn an earlier unknown
  state into known or change the creation-time unassigned count.
- A disposable staging-equivalent rehearsal upgraded a synthetic production-
  volume baseline from `0077` through `0080`: 106 Work Orders, 85 assigned
  snapshots, and 656 legacy events remained unchanged, with zero fabricated
  typed events. Rerun was a no-op. Database integrations verify timezone/as-of
  boundaries, initial/reassigned/unassigned order, exact-payload idempotency,
  old-writer transition compatibility, tenant and User/Employee-pair isolation,
  restricted parent deletion, immutable events, and automation delivery replay.
  The complete repository suite passes 310/310 tests. This foundation is now
  deployed to production as Phase A at schema `0080`. Production assignment
  history before the recorded migration cutoff remains unknown, and no
  historical rows were fabricated.
- Production release readiness now includes a successful full restore of
  backup `overva-20260831T083827Z` into an isolated database and uploads
  directory. Restored schema `0077`, 106 Work Orders, 85 assigned snapshots,
  656 events, validated critical foreign keys, API health, and authenticated
  session all reconciled before the isolated database, API container, and files
  were removed. Timestamped evidence is in
  `PRODUCTION_RESTORE_REHEARSAL_20260831T110319Z.md`.
- `PRODUCTION_RELEASE_READINESS_RUNBOOK.md` pins the currently deployed API and
  Web image digests, defines mandatory pre-build immutable tags and exported
  image archives, supplies a no-build rollback Compose override, and gives
  exact schema/event/trigger/FK/privilege/idempotency/report/CSV/tenant/health
  reconciliation commands. The pre-build gate has now pinned both running
  images with immutable local rollback tags, exported and SHA-256 hashed both
  Docker archives, and copied the archives plus checksum manifest into a
  private owner-only Google Drive vault. `D:` was rejected as independent
  storage because it is on the same physical disk as `C:`. Exact artifact IDs
  and evidence are in `PRODUCTION_RELEASE_IMAGE_RECORD_20260831T083827Z.md`
  and `PRODUCTION_PRE_BUILD_GATE_20260831T115011Z.md`.
- The same gate created and explicitly verified fresh production backup
  `overva-20260831T114722Z`, including database dump, uploads archive, checksum
  manifest, and archive readability, then copied all four files to the private
  off-host vault. Read-only checks before and after preservation remained at
  schema `0077`, 106 Work Orders, 85 assigned snapshots, 656 events, and zero
  long/open transactions or relevant locks. No candidate build, migration,
  deploy, Phase B activation, or production database data write occurred.
- The current backup scheduler verifies each generated backup after creation,
  but its container healthcheck does not prove freshness or checksum state and
  `LATEST` is advanced before the separate verification finishes. The accepted
  readiness design uses a post-verification `LAST_VERIFIED` marker, 26-hour
  warning, 30-hour unhealthy threshold, independent verification, and a
  31-day restore-proof gate. Scheduler behavior is not changed in this sprint.
- A second disposable candidate rehearsal rebuilt schema `0077`, seeded the
  106/85/656 baseline, migrated to `0080`, and ran the exact deployed
  release-contract plus session/report/CSV smokes. Cross-tenant lookup denial,
  exact idempotency replay, conflicting-payload rejection, 106 CSV detail rows,
  all six CSV/report reconciliation flags, and ordinary-user HTTP 403 passed.
  Its API container, database, and candidate-only image were removed afterward.
- The controlled Phase A production release applied reviewed migrations
  `0078`–`0080` with bounded timeouts and exact checksum verification, then
  deployed API image `sha256:036bfe0f7d9f223c0136328b53c74deec4755928ca78f40bc0e8a2e96bdebbc5`
  followed by Web image
  `sha256:b3936e47bec669d05b7797b9c38bbab9ca9d7caac922b90b758002c6955067be`.
  Reconciliation preserved 106 Work Orders, 85 assigned snapshots, and 656
  legacy events with zero typed backfill, zero mismatches, all critical
  constraints/triggers/privileges correct, no automation duplicates, and no
  Phase B trigger. Contract, tenant isolation, idempotency, session,
  report/CSV, authorization, service, and public-edge smokes passed. Verified
  pre/post backups are `overva-20260831T114722Z` and
  `overva-20260831T121439Z`; full evidence is in
  `PRODUCTION_PHASE_A_RELEASE_20260831T121534Z.md`.

## Integrated management report foundation

- The tenant application now has an evidence-backed **Нэгдсэн тайлан** draft
  for directors, chief engineers, accountants, and the tenant owner. It reports
  opening Work Order backlog, work created during the selected period, actual
  transitions to `completed`, closing backlog, and period-end overdue work.
  Each value is compared with the immediately preceding equal-length period.
- Calendar controls support the current month, previous month, current quarter,
  current year, and a bounded custom range of at most 366 days. PostgreSQL
  boundaries and daily/monthly trend buckets use the tenant's configured
  timezone rather than the database session timezone.
- Historic opening and closing states are reconstructed from append-only Work
  Order events. Unknown boundary states, unassigned new work, and assignees not
  linked to the canonical Employee master are exposed as data-quality warnings
  instead of being silently treated as valid values. The original production
  report attributes people activity to the current assignee; the repository's
  new `0078` foundation replaces that approximation with typed assignment
  events after its recorded production deployment cutoff.
- Asset counts are labelled and returned as a current snapshot, not a historic
  flow. Printable A4 landscape/PDF styling and a UTF-8 CSV reconciliation export
  are implemented. The CSV includes the opening, created, completed, cancelled,
  closing, and period-end-overdue flags plus the reconstructed boundary states,
  so exported rows reconcile with the headline Work Order measures.
- All 295 repository tests pass. A pre-deployment read-only run of the new API
  against production and an independent SQL reconciliation matched for August
  2026: opening 87, created 19, completed 0, closing 106, and overdue 102. The
  equal July comparison is 62, 25, 0, 87, and 81. Production currently has 466
  reportable Asset master records (434 active, 16 repair, 10 retired, and 6
  inactive), four August Work Orders created without an assignee, zero unknown
  boundary states, and zero assignees missing their Employee-master link.
- The foundation is production-deployed through the required Production,
  Cloudflare, and AI Compose files. Authenticated post-deployment reads returned
  HTTP 200 for director, chief engineer, accountant, and owner authority even
  when the owner's legacy job role was not a management title; an ordinary
  worker received the expected HTTP 403. The reconciliation CSV returned 106
  detail rows with 22 columns and a UTF-8 BOM. External Home, App, API, Status,
  `app.js?v=39`, and `reports.css?v=2` returned HTTP 200, and all seven services
  were healthy. Verified initial pre-deployment, corrective pre-deployment, and
  final post-deployment backups are `overva-20260831T083034Z`,
  `overva-20260831T083251Z`, and `overva-20260831T083827Z`.

## Role-personalized home and decision trends

- Non-management users now receive a server-scoped **Миний өдөр** home instead
  of the organization-wide management dashboard. It combines only the signed-in
  employee's current attendance, assigned Work Orders, monthly completions,
  pending review/request counts, and a name-free aggregate of that employee's
  department. Field-enabled roles can continue directly to their mobile work
  surface.
- Compensation remains private and truthful. The personal home may show the
  signed-in employee's approved effective base salary, falling back to the
  imported profile reference when no approved compensation version exists. It
  explicitly returns no net-pay value and does not present a payroll estimate
  as an amount that will be paid; governed payroll and payslips remain
  unimplemented.
- Non-management Work Order warnings are now calculated only from work assigned
  to that user. Organization-wide HR, inventory-quality, emergency, overdue,
  and historical-backlog signals are not returned as personal alerts.
- **Чиг хандлага** now compares 14, 30, or 90 days with the immediately preceding
  equal period. It reports evidence-backed work inflow/completion, attendance,
  camera and lighting incidents, safety risks, inventory thresholds, and cash
  movement without the earlier artificial health score or empty Fleet/IoT
  placeholders. Historic imported Work Orders remain explicitly separated from
  recent overdue work.
- Trend sections are role-scoped: directors/owners receive the broad decision
  view, chief engineers receive operations, and accountants receive finance and
  inventory. The API enforces the same boundary as the workspace policy. One
  refresh control and a period selector replace the duplicate refresh actions.
- The implementation passes all 287 repository tests. Local authenticated reads
  returned HTTP 200 for all three supported periods, with 14/30/90 daily points.
  Production authenticated reads returned HTTP 200 for director, chief engineer,
  accountant, and worker homes. Trend scope was verified as full authorized
  organization sections for the director, operations only for the chief
  engineer, and inventory/finance only for the accountant; worker and accountant
  homes returned personal scope without organization data-quality detail. Public
  app assets and API health returned HTTP 200, and all production services were
  healthy. Verified pre- and post-deployment backups are
  `overva-20260831T074735Z` and `overva-20260831T075242Z`.

## Tenant-branded organization home

- The organization home now uses tenant-owned name, short name, logo, primary
  and accent colors, welcome text, and optional banner image. A tenant without
  custom media receives a neutral gradient and initials; Choibalsan Hugjil is
  configured with its reviewed legacy logo and city panorama only in that
  tenant's settings. The pilot imagery is not a universal OVERVA theme.
- The earlier artificial daily score, organization-size badge, long product
  guidance, and duplicate quick-action panel have been removed. The main view
  is organized as role/module-filtered operations, management resource and
  finance balances, and decision signals backed by live tenant records.
- Current operational cards distinguish recent Work Orders from the imported
  historical backlog, show effective attendance, camera availability,
  lighting objects/incidents, safety risks, and the asset master. Management
  cards add inventory value, outstanding payables/receivables, and current
  month cash activity. A month with no transaction is stated explicitly rather
  than presented as an unexplained zero.
- Inventory alerts now require a configured positive minimum and an actual
  balance below that minimum. Imported items whose minimum remains zero are no
  longer falsely classified as low-stock alerts; missing threshold setup stays
  data-quality context rather than an operational emergency.
- Migration `0077` adds the two bounded presentation settings and configures
  the Choibalsan pilot assets. Settings changes remain owner-only and audited;
  organization data, authorization, and assets remain tenant-scoped.
- Production deployment was verified with a live authenticated dashboard read:
  18/21 attendance, 19 recent and 87 historical open Work Orders, 236/302
  available cameras, 451 lighting objects with 206 open incidents, 24 open
  safety risks, and 466 master assets. Public app, API health, banner, and
  logo endpoints returned HTTP 200. All 285 repository tests pass. The verified
  pre-deployment and post-deployment backups are `overva-20260831T071122Z` and
  `overva-20260831T071354Z`.

## Choibalsan legacy ERP production reconciliation

- The reviewed legacy SQLite source has now been reconciled into the production
  `choibalsan-hugjil` tenant. The import matched all 21 legacy employees without
  replacing their existing password hashes, enriched all 21 employee profiles,
  and reconciled 1,715 effective attendance rows. Twenty-one newer/manual
  attendance rows were intentionally preserved instead of being overwritten.
- The operational import now retains 465 legacy master assets, 451 lighting
  objects, 110 camera objects, and 106 canonical Work Orders: 78 lighting and
  28 camera. Camera work reuses the same Work Orders and carries 103 legacy
  approval decisions/events into append-only evidence. The camera history also
  contains 76 daily snapshots; the safety workspace received 92 source risks,
  19 route plans, two documents, and 42 acknowledgements.
- Two legacy acknowledgement rows reference an employee that is not present in
  the active 21-person source set. They remain reported import warnings rather
  than being attributed to the wrong person. The production tenant also retains
  one pre-existing master asset and one pre-existing safety risk; imported and
  pre-existing records were not collapsed merely to make headline counts match.
- Finance and inventory reconciliation imported 665 material masters, 124 stock
  movements, 157 cash-journal rows, 61 payable source rows, 36 receivables, and
  3,932 accounting fixed assets. Inventory quantity is 163,142.558 and inventory
  value is MNT 607,277,288.28, matching both source and recalculated values.
  Forty-three positive payable rows became obligations; 18 non-positive or
  sub-cent rows remain immutable warning evidence. Fixed-asset initial value is
  MNT 91,106,333,640.19 and book value is MNT 25,899,708,219.61.
- Importers were rerun in dry-run mode after apply: all 465 assets, 327
  lighting/work source rows, and 4,975 finance/inventory source rows were
  skipped as already reconciled; camera and safety created no duplicate domain
  records or approval evidence.
- The first production camera/safety and complete-work transport used a
  PowerShell text pipe and replaced Cyrillic display text with question marks;
  the source SQLite remained valid. Exporters now support base64-wrapped UTF-8.
  A scoped production repair restored 451 legacy lighting helper assets, 72
  Work Order titles/descriptions, 157 visible execution notes, 110 camera
  objects, 30 camera incidents, 103 visible approval-history events, 92 safety
  risks, 19 routes, and two safety documents without changing their canonical
  IDs or relationships. Append-only damaged events were superseded by corrected
  events, not mutated or deleted. A post-repair scan reports zero question-mark
  corruption across all user-visible asset, object, incident, Work Order,
  history-note, safety, employee, inventory, and accounting fields. Repeated
  repair dry-runs report zero changes. All 285 repository tests pass.
- The verified production restore point immediately before this data import is
  `overva-20260831T063329Z`; the verified post-import backup is
  `overva-20260831T063544Z`. The verified pre-repair and post-repair backups are
  `overva-20260831T064621Z` and `overva-20260831T064729Z`. All production
  services and public endpoints were healthy after the repair.
- `ops/export-legacy-assets.js` is the reviewed read-only asset exporter.
  `ops/export-legacy-lighting.js --all-work` provides the complete legacy work
  set, while the camera/safety importer can reconcile those canonical Work
  Orders even when their earlier provenance used the legacy ERP source label.

## Choibalsan accounting workspace

- The local Choibalsan pilot now has a permission-backed **Санхүү, бүртгэл**
  workspace with overview, cash journal, payables, receivables, Work Order
  material reconciliation, budget/performance, fixed-asset reference, and
  reporting tabs. These reuse current OVERVA finance, asset, inventory, and
  Work Order truth instead of duplicating the legacy ERP screens.
- Migration `0070` adds tenant-scoped obligations, settlement history, and
  material accounting reviews. Their decision evidence is append-only and all
  writes also create audit records. Migration `0071` enables this module only
  for the reviewed `choibalsan-hugjil` pilot tenant.
- Storekeeper and accountant authority are separate: the storekeeper owns
  stock creation and movement plus approved Work Order issue; the accountant
  receives `finance.read`, `finance.manage`, and `finance.reconcile`, but no
  stock-movement authority. Issued Work Order material appears in the
  accounting queue without changing warehouse quantity.
- The separate legacy SQLite source is exported read-only and the reviewed
  finance/inventory importer is restricted to `choibalsan-hugjil`, guarded for
  explicit apply, transactional, repeatable, and reconciles every source row.
  Immutable provenance links 665 materials, 124 movements, 157 cash-journal
  rows, 61 payable source rows, 36 receivables, and 3,932 fixed-asset rows.
  Eighteen sub-cent or non-positive payable anomalies remain import evidence
  instead of being falsely presented as open liabilities; 43 valid payables
  are operational records. Hard-coded legacy budget constants remain excluded.
- Migrations `0073`–`0076` add a separate accounting fixed-asset ledger and
  source-precision inventory cost. The storekeeper sees quantity, unit cost,
  and inventory value; the accountant sees cash, obligations, and asset cost,
  depreciation, and book value. Accounting assets remain separate from
  operational objects and their dossiers.
- The earlier local rehearsal backup remains at
  `backups/overva-20260831T050355Z`; the equivalent reviewed dataset is now also
  reconciled into production as recorded above.

## Storekeeper workspace

- The role-facing navigation and page are now named **Няравын ажлын талбар**,
  while the underlying reusable domain remains warehouse and inventory. The
  familiar legacy sequence is preserved as Самбар, Орлого, Зарлага/олголт,
  Үлдэгдэл, Захиалга, and Тайлан tabs without copying the legacy screen or its
  separate data model.
- Approved Work Order material is the primary issue path and remains linked to
  engineering work and accounting reconciliation. Ad-hoc stock movement is an
  explicit exception requiring a document reference and note. Low stock links
  to the governed procurement workflow rather than creating another private
  storekeeper-order truth.
- Migration `0072` adds live `inventory.read` authorization, a bounded
  `inventory-custodian` role for storekeepers, and read-only
  `inventory-observer` access for chief engineers and accountants. Inventory
  read and mutation routes now use server-derived permissions instead of the
  legacy job-role string. All 272 repository tests pass.

## Role-focused navigation and work Kanban

- The primary operational work surface is now **Ажлын самбар**, rendered as
  bounded Kanban lanes for intake/assignment, start approval, execution, and
  review/closure. It replaces the long work table presentation; OVERVA does
  not reintroduce the legacy Gantt. Cards retain the canonical Work Order,
  assignee, asset, due date, history, material, and workflow actions.
- Kanban is a view over existing governed state, not a second workflow model.
  Approval stages cannot be bypassed by dragging cards; only server-authorized
  action controls perform transitions and retain the existing audit evidence.
- Lighting, camera, chief-engineer, and safety workspaces do not own parallel
  workflows. They now identify themselves as domain records or role-specific
  oversight over the same canonical Work Orders and link back to **Ажлын
  самбар** for the complete flow.
- `Холболтууд` no longer occupies the primary sidebar. Authorized owners reach
  the same read-only connector capability through **Тохиргоо → Холболт,
  интеграц**; OAuth return routing also lands there.
- `Талбарын апп` is role-only for enabled field roles (engineer, electrician,
  camera engineer, and worker). Tenant ownership or chief-engineer oversight
  does not add it automatically, and its client view shows only work assigned
  to the signed-in person. Approval remains in the governed work board.
- Saved-token startup waits for every deferred workspace policy to install
  before loading the session. A returning user therefore lands directly on the
  authorized organization home instead of briefly rendering Builder until the
  first navigation click.

## Unreleased local work — Market guest catalog interaction

- The public Market sample catalog now has a separate responsive interaction
  layer for product detail and comparison. A guest can open a sample product,
  review capabilities, intended fit, vendor, price state, and support state,
  select up to three samples, and compare them side by side.
- Every detail and comparison surface explicitly states that the records are
  UX samples, not live listings, sale offers, orders, or vendor commitments.
  No listing, purchase, payment, supplier-contact, or transaction authority was
  added.
- The implementation is isolated in `public-site/market-catalog.js` and
  `public-site/market-catalog.css`. Desktop and 390px mobile browser checks pass
  without console errors. The public-site image definition copies both assets,
  and all 233 repository tests pass, including asset-wiring regression checks.
  A guarded local-only launcher builds the Market with an API proxy at
  `http://localhost:4174`; it creates no volume and refuses to replace an
  existing container. This work is local and not production-deployed.
- The same local interaction layer now exposes three immediate guest intents:
  search for a ready product, start a four-field product-listing draft, or move
  directly to custom work when no ready product fits. Listing drafts stay only
  in the current browser and are explicitly not published, sent to customers,
  priced by OVERVA, or treated as a Seller/Provider grant.
- A sample product detail now has a low-friction interest action. It carries the
  selected product into the existing Market customer/request flow instead of
  asking the visitor to rewrite the context. This remains a local UX slice: no
  server-backed listing, supplier inquiry, purchase, payment, or publication
  authority was added. Desktop interaction and a 390px responsive layout pass
  without console errors or horizontal overflow.

## Canonical Market business-process diagram

- The canonical Guest Market Journey is stored under
  `docs/diagrams/market/guest-market-journey/`. Its editable source is
  `guest-market-journey.mmd`; `guest-market-journey.svg` is the single scalable
  review image. Small revisions overwrite those files in place. Do not create
  `v2`, `final`, `copy`, dated, or duplicate images for the same journey; Git
  history preserves earlier revisions.
- Every business-process diagram uses one implementation-status standard:
  gray = not planned, gold = planned, blue = in progress, green = implemented,
  purple = verified, red = blocked, and orange = decision required. Arrows are
  neutral flow only. Each diagram carries a compact vertical legend. Approved
  business logic without code remains gold. Revenue is identified by
  `ОРЛОГО / REVENUE` text, not by a separate status color.
- `guest-market-journey.bpmn` is the BPMN 2.0 source. A real `.vsdx` has not
  been fabricated because Microsoft Visio is not installed on this computer;
  it must be created later through Visio import and Save As.

## Accepted Connected Organization model

- D-032 accepts Master Data -> Organization -> Responsibility and Authority ->
  Process and Transactions -> Measurement and Optimization as OVERVA's
  conceptual domain reasoning order. It is not a universal schema, shared
  identity, workflow rewrite, or permission bridge.
- `CONNECTED_ORGANIZATION_DOMAIN_MODEL_V1.md` defines the model and current
  implementation mapping. `SURFACE_AUTHORITY_MATRIX_V1.md` maps public Market,
  Market participants/operators, tenant application/administration, Platform
  administration, OVERVA Apps, Group oversight, and infrastructure operation
  to their separate identity, data, authorization, and audit owners.
- `LEGACY_AUTHORIZATION_USAGE_AUDIT_V1.md` records that tenant RBAC,
  permissions, optional employee login, and job-workspace access are implemented
  while fixed `users.role` / `employees.job_role` checks remain compatibility
  debt in several operational routes.
- `ASSET_MAINTENANCE_VERTICAL_SLICE_CONTRACT_V1.md` is the approved first
  end-to-end proof contract. Work Order authority and the material trace now
  reuse the existing employee, structure, work-order, inventory, and audit
  foundations. Attachment authority, resource history, deterministic measures,
  and the shortage-to-procurement branch remain incomplete, so the full slice
  is still partial.

## Work Order explicit-authority cutover

- Migration `0108` implements accountable residual-work disposition. A fully
  measured unresolved/deferred scope cannot support final Work closure until a
  manager either records an accepted end or atomically creates one follow-up
  Work Order for the exact remaining quantity. Follow-ups preserve object,
  service area, work type, workflow and incident links, return to the ordinary
  Work Board and keep bidirectional source history. The disposition journal is
  tenant-scoped, append-only, idempotent and unique per source scope item.
- Verification on 2026-09-04 applied migration `0108`, passed the final
  `487/487` repository tests and authenticated the Work list/history read model.
  The migration and related UI/API were promoted in production release
  `20260904T104631Z`; LAN was not changed.

- Migration `0064` adds eight tenant-scoped Work Order permissions and three
  domain roles: `work-order-manager`, `work-order-safety-reviewer`, and
  `work-order-coordinator`. Existing active users are seeded from legacy roles
  once for compatibility; subsequent Work Order authorization reads live RBAC
  permissions, not the legacy job-role label.
- Work-order create, assignment, ordinary progress, scoped-outcome updates,
  safety/management workflow approval, exception decisions, history, and notes
  now enforce explicit permission plus the existing department, creator, or
  assignee context. Workflow policies carry permission keys while retaining
  their old role keys only as inert compatibility metadata; authorization and
  workflow notification routing fail closed without a permission key.
- The tenant UI now renders assignment and status controls from server-derived
  `can_assign`, `available_statuses`, and `available_actions`; hiding a control
  is not the authorization boundary. Account creation and legacy-role changes
  synchronize the equivalent domain role without granting tenant ownership.
- The Asset Maintenance vertical slice is therefore **partial**: its Work Order
  authorization milestone is implemented, while attachment authority
  unification, full resource history, and deterministic end-to-end measures
  remain planned.
- All 251 repository tests pass. The local Docker stack applied schema `0065`;
  API and tenant web are healthy, and the served UI uses server authority
  fields. This is local verification only and is not a production deployment.

## Work Order material trace

- Migration `0065` adds separate tenant permissions for material request,
  approval, warehouse issue, and consumption confirmation, plus the bounded
  `work-order-material-custodian` role. Fresh bootstrap tenants now use the
  canonical tenant-provisioning service so their first administrator receives
  the same roles and permissions as every other newly provisioned tenant.
- A Work Order can request an existing inventory item, approve or reject the
  request, issue an approved quantity from a selected warehouse, and confirm
  consumption. Request and approval do not change inventory. Only an atomic
  issue locks and decrements the balance, creates the linked stock movement,
  and appends material and audit evidence.
- Issue retries use a tenant-scoped idempotency key. Insufficient stock returns
  a conflict without changing the approved request or balance. Approval is not
  treated as issue, issue is not treated as consumption, and no purchase
  request or successful issue is fabricated when stock is unavailable.
- Work Order history exposes the material flow using server-derived
  capabilities. Inventory exposes an approved issue queue only to an actor with
  live issue permission. Both routes retain tenant and relevant-work scope on
  the server; UI visibility is not the security boundary.
- Unit/contract tests and a disposable PostgreSQL integration run verify clean
  migration/bootstrap, request replay, approval, insufficient-stock fail-safe,
  one-time issue, consumption, balance, stock-movement linkage, and append-only
  evidence. The disposable database was removed after verification. This is
  local verification only and is not a production deployment.

## Local Choibalsan legacy demo copy

- The local `choibalsan-hugjil` tenant contains a bounded, sanitized copy from
  the separate legacy SQLite application. The source was opened read-only; the
  legacy application and database were not mutated. A restorable PostgreSQL
  dump was taken before import.
- The copy contains 21 active employee names with department, position, and
  legacy role classification; 465 asset-master records; 451 lighting
  operational objects; 212 incidents; 9 repair events; 106 historical Work
  Orders; and 159 execution notes. Imported
  employee accounts use synthetic `demo.invalid` identifiers, unusable random
  password hashes, and `can_login=false`. Register numbers, phones, addresses,
  salary, legacy credentials, tokens, and files were not copied.
- A PowerShell text-pipeline defect in the first local copy had replaced
  Cyrillic characters with question marks. The source SQLite remained correct
  and read-only. Employees, departments, positions, jobs, 465 Assets, 451
  Operational Objects, 212 incidents, 106 Work Orders, and visible execution
  notes were repaired through base64-wrapped UTF-8 input while preserving their
  target UUIDs. Asset and object correction evidence is appended; damaged Work
  Order notes are superseded by append-only corrected events rather than
  mutated or deleted.
- `HR`, `assets`, `work-orders`, `inventory`, and `lighting-operations` are
  enabled only for this local demo tenant. One demo warehouse contains the two legacy
  lighting-material names and their source balances (320 units total); prices
  were deliberately omitted. Import source/provenance and legacy warnings are
  retained instead of presenting copied data as newly executed OVERVA work.
- The legacy employee importer now creates/reuses canonical jobs, positions,
  employees, profiles, and primary assignments instead of writing only the old
  user-linked structure. Dry-run and committed counts matched. This local data
  copy is not a production deployment or a live synchronization.
- The separate asset importer is tenant-scoped, dry-run capable, idempotent,
  and provenance preserving. It omits purchase price, current/book value, the
  3,932-row fixed-asset ledger, legacy files, and credentials. Two unreadable
  legacy codes initially received deterministic `LEGACY-ASSET-*` replacements;
  the UTF-8 repair restored the readable source codes without changing Asset
  IDs or their relationships.
- The lighting Operational Object list now opens an object dossier. An
  authorized user can allocate an Asset (including a fractional quantity and
  unit) to an object, end the active allocation without deletion, and add
  dossier notes. The dossier shows active/historical components, incidents,
  Work Orders, and attributable append-only history. Asset master quantity and
  unit now bound all active object allocations; over-allocation, unit mismatch,
  and reducing a master total below the allocated amount fail closed. No legacy object-to-Asset
  links were fabricated: the reviewed source has zero explicit `asset_id`
  references, so the local demo begins with zero component allocations.
- Migration `0068` reconciles pilot modules, governed work types, workflow
  policy routes, and imported-user RBAC assignments that earlier seed
  migrations could not create before the pilot tenant existed. Camera,
  safety, and field workspaces are enabled only for `choibalsan-hugjil`;
  imported employee login remains disabled until explicitly provisioned.
- The local pilot now has 110 camera-location Operational Objects representing
  the source's 302 cameras (236 working and 66 unavailable), 110 exact
  Asset-to-object component allocations, 30 current fault records, 76 daily
  camera snapshots, and 28 correctly reclassified camera Work Orders. Camera
  uses the same Object -> incident -> Work Order -> evidence -> HSE -> chief
  engineer history model as lighting, and its object list opens a read-only
  dossier over the shared operational records.
- The 28 camera Work Orders retain 103 attributable legacy workflow approvals:
  HSE start checks, employee completion submissions, HSE completion checks,
  and chief-engineer closure evidence. Signature codes were deliberately not
  copied. Approval evidence and source provenance are append-only.
- The safety workspace now contains 92 source risks, 19 safe-route plans, one
  instruction, one training record, and 42 employee acknowledgements. Two
  source acknowledgement rows could not be linked because their legacy users
  are not present in the reviewed employee import; they remain explicit import
  warnings rather than being assigned to a fabricated person. Precise employee
  GPS, legacy signature codes, upload paths, credentials, and private HR fields
  were not copied.
- Migration `0069` and the tenant UI add an implemented Chief Engineer
  Operations Center over the existing Work Order truth. It does not create a
  second lighting/camera work registry. An authorized work-order manager can
  see lighting and camera together, then separate them by domain; identify
  unassigned, overdue, material-waiting, safety-waiting, and management-waiting
  work; inspect scope/evidence/resource signals; open the attributable history;
  and execute only the workflow actions returned by the server. Current pilot
  classification resolves the 106 imported Work Orders as 77 lighting and 29
  camera records (the 29 include the complete current camera-classified set,
  not a claim that every one originated in the last camera import).
- The same center stores only the chief engineer's monthly summary, blockers,
  resource needs, next-period direction, and conclusion in a tenant-scoped
  review record. Numeric operations data remains derived from Work Orders.
  Saving commentary requires explicit workflow-approval permission and appends
  an audit record. The two reviewed legacy monthly-report rows contained blank
  commentary, so no empty legacy notes were copied or presented as evidence.
- All 264 repository tests pass. Re-running the connected-operations importer
  creates no duplicate objects, incidents, snapshots, risks, documents,
  acknowledgements, approvals, or visible approval events. The local API, web,
  and database containers are healthy. Migration `0069`, the authenticated
  engineering overview (106 items), and served engineering JavaScript were
  smoke-tested locally; this is a local pilot deployment, not a production
  release.

## Next chat start

1. Run `git status`. If clean, continue from the current `main`; on another
   computer, use `git pull --ff-only origin main` first.
2. Read this file, `docs/HOME_DEVELOPMENT_SETUP.md`, and
   `docs/diagrams/market/guest-market-journey/README.md` before changing the
   Market or its process diagrams.
3. Treat `guest-market-journey.mmd` and `guest-market-journey.svg` as the one
   canonical Guest Market Journey. Update them in place and keep the compact
   seven-status legend.
4. Local Market preview uses `http://localhost:4174`. Do not infer permission
   to deploy, touch production, copy secrets, reset databases, or delete Docker
   volumes.

## Operating Baseline

- OVERVA v2 is isolated under `erp-v2`; the legacy Choibalsan ERP remains a
  separate live system and learning/import source.
- The current deployment is a Docker-based, single-host pilot served through
  Cloudflare Tunnel and Caddy, with separate public site, tenant application,
  platform administration, API, and PostgreSQL services.
- Development, staging examples, and production configuration are separated.
- PostgreSQL and uploads use persistent volumes. Scheduled verified backups,
  restore guidance, health monitoring, and restart policies exist.
- Database and internal service ports are not intended to be public.

### Production release V38 — Connected operations pilot

- Application commit `6c5890d` is production-deployed. The tenant application
  now includes explicit Work Order authority, material traceability,
  operational-object dossiers, connected lighting/camera/safety operations,
  the chief-engineer control center, accountant reconciliation, the
  storekeeper workspace, and the role-focused **Ажлын самбар** Kanban.
- Production migrations `0064–0076` applied successfully and runtime grants
  were refreshed for the application role. These migrations add governed
  structures and pilot enablement; the reviewed legacy rows imported into the
  separate local pilot database were not copied into production by deployment.
- Returning saved-token users now wait for all deferred workspace policies
  before session loading, so the authorized organization home renders first
  instead of briefly showing Builder until a navigation click.
- Pre-deployment backup `overva-20260831T060019Z` and post-deployment scheduled
  backup `overva-20260831T060119Z` both passed checksum, PostgreSQL archive, and
  uploads-archive verification. All seven production Compose services are
  healthy.
- The production Cloudflare scheduled tunnel was found stopped during external
  verification and was restarted. External Home, App, API, Admin, and Status
  checks all return HTTP 200; App serves `app.js?v=37`, the saved-token startup
  fix, Kanban assets, and specialist-view source notices. The full repository
  suite passes 283 tests.

### Production release V37 — Provider onboarding assurance

- Migration `0063` adds a recent-authentication timestamp to revocable Market
  sessions, encrypted phone contacts, keyed phone fingerprints, bcrypt-protected
  single-use OTP challenges, bounded attempts, collision risk signals, and
  attributable audit links. A verified phone is assurance evidence only; it
  grants no Customer, Provider, Market operator, Platform, or tenant authority.
- A new Provider application requires both a step-up performed within ten
  minutes and a live verified phone fact. Password identities re-enter their
  current password; Google-linked identities may reauthenticate with the exact
  linked Google issuer and subject. Existing policy-0 applications and active
  Provider memberships remain compatible.
- Phone ownership decisions are serialized by a database advisory lock over the
  blinded fingerprint. The same verified phone cannot silently create or merge
  identities; a collision creates an operator-review risk signal. Approval
  rechecks the live phone contact and verification fact before issuing Provider
  membership.
- Public V34 implements a four-step Provider onboarding dialog: account
  confirmation, phone verification, professional profile, and review state.
  The same onboarding and Provider sidebar open one OVERVA-authored
  ten-principle contractor guide covering capability honesty, scope, plain
  language, confidentiality, evidence, communication, acceptance, and
  completed-engagement-only reviews. It is static editorial guidance and adds
  no article publishing, likes, forum persistence, or reputation authority.
  SMS remains fail-closed and disabled until a real provider endpoint, token,
  sender, and fingerprint key are provisioned. Test delivery exposes OTPs only
  under `NODE_ENV=test`.
- Production preparation now mounts the SMS token and phone-fingerprint key as
  ignored Docker secrets across API, migration, and optional worker services.
  A one-time 64-character fingerprint key has been generated without disclosure,
  the SMS token remains a fail-closed placeholder, and `.env.production`
  explicitly keeps `MARKET_SMS_ENABLED=false`. All three production overlays
  pass `docker compose config --quiet` together.
- All 233 repository tests pass. A clean disposable PostgreSQL 16 run applied
  migrations `0001–0063` and passed the full Market integration flow, including
  stale-session denial, password step-up, phone OTP, duplicate application
  prevention, operator-only review/approval, audit evidence, and unchanged
  Customer/Provider authority boundaries. The disposable container was removed.
- V37 was production-deployed after verified backup
  `overva-20260829T132335Z`. Production is API V37, Public V34, Web/Admin V31,
  and schema `0063`. All seven services are healthy; local Caddy and Cloudflare
  Home/API/App/Admin/Status checks return 200, guest Provider readiness returns
  401, and external V34 assets plus the contractor guide are visible. Google
  remains enabled; phone verification truthfully reports unavailable while SMS
  remains disabled. Production has two Market identities and zero memberships,
  operator assignments, Provider applications, risk signals, or phone contacts.
  Seller/Publisher registration is a separate future capability; listings,
  proposals, payments, disputes, forum, ranking, and KYC-document backends
  remain out of scope.

### Production release V36 — Market identity assurance

- Migration `0062` keeps one canonical Market identity while separating its
  external login credentials, revocable sessions, one-time authentication challenges,
  verification facts, and operator-reviewed risk signals. Existing password
  identities and Customer/Provider memberships are preserved; credentials and
  verification facts grant no membership, Market operator, Platform founder,
  or tenant authority.
- Market tokens now name a live database session. Logout, password reset, and
  “all devices” revocation take effect server-side without waiting for JWT
  expiry. Password recovery and email verification use short-lived, hashed,
  single-use challenges and generic account-enumeration-safe responses.
- Optional Google OIDC uses authorization code flow, PKCE, state, nonce, signed
  ID-token validation, and the stable Google issuer plus subject as the account
  key. Matching email alone never merges identities: an existing password
  identity must authenticate first and explicitly link Google. Removing the
  last login credential is rejected.
- Public V33 adds Google entry/link controls, recovery, verification, and an
  active-session view. Returning Google users now see Google as the single
  primary path; email/password stays behind an explicit alternative-action
  disclosure. Email delivery remains feature-flagged off. Google OIDC
  is enabled in production with its Client Secret mounted from an ignored
  Docker secret file; production capabilities report Google available while
  email recovery and Facebook remain unavailable.
- Possible email/external-identity collisions become privacy-safe risk signals.
  Only a live Market operator can list or review them, and an operator cannot
  review a signal involving their own identity. Review creates append-only
  evidence and changes no participant authority by itself.
- All 231 repository tests pass. A clean disposable PostgreSQL/API run applied
  migrations `0001–0062` and passed password-user regression, session-bound
  tokens, single-use recovery, old-session revocation, Customer/Provider
  lifecycle regression, operator-only risk access, and audit immutability.
  Google signature/issuer/audience/expiry/nonce/verified-email validation is
  covered with a locally signed OIDC test token. Session creation now also
  rejects an inactive identity before issuing any token.
- V36 Google activation was production-deployed after verified backup
  `overva-20260829T095542Z`. Production is API V36, Public V33, Web/Admin V31,
  and schema `0062`. Live smoke now has two active identities with different
  normalized emails: one older unused password identity and one current identity
  holding both password and Google credentials. The current identity has one
  verified Google fact and one active Google session; memberships, operator
  assignments, and risk signals remain zero. All seven services are healthy;
  Cloudflare
  Home/API/App/Admin/Status checks passed, and auth capabilities report Google
  enabled with email recovery and Facebook disabled. Google authorization
  preflight verified the Client ID, callback, state, nonce, and PKCE-S256 without
  exposing the authorization URL or secret. The first live callback exposed a
  missing outbound overlay (`EAI_AGAIN`); production API was reattached to the
  existing `ai-egress` network after explicit approval, and Google DNS/TLS probes
  then passed. Deployed API image is
  `sha256:28077c52aaa0917726a3edc66df0b00719ce255db536243f5fdea3ff5f382edf`;
  Public image is
  `sha256:52853b71e7f77be948c9e35b49a4fb59e943e7c5c75ef35faa3b089ad674ece7`.

### Production release V35 — Digital Storefront foundation

- Migration `0061` adds versioned storefront plans, one Provider-owned digital
  storefront per Market identity, service subscriptions, entitlement snapshots,
  lifecycle guards, no-delete protection, and append-only audit links. These
  records represent access to OVERVA's storefront service only; they do not
  represent customer/provider work payments, commission, escrow, settlement,
  payout, refund, or dispute authority.
- Only an active reviewed Provider can create or edit their storefront. Creating
  the same storefront and requesting the same open subscription are idempotent.
  Only a live Market operator can publish a plan, activate a subscription, or
  suspend/reactivate a storefront. Suspending Provider membership also hides its
  storefront; membership reactivation alone does not republish it.
- Public V31 renders only active storefronts backed by an active Provider
  membership and an unexpired active subscription. The private Provider view
  supports profile editing and plan requests without exposing it to guests.
- All 225 repository tests pass, and a clean disposable PostgreSQL run applied
  `0001–0061` and passed the complete Market identity/storefront smoke.
- V35 was production-deployed after verified backup
  `overva-20260829T080218Z`. Production is API V35, Public V31, Web/Admin V31,
  and schema `0061`; the four new storefront tables remain at zero rows. All
  seven services are healthy, external Home/API/App/Admin/Status checks pass,
  public storefront browse returns an empty collection, and the private
  storefront endpoint rejects a guest with `401`. Deployed API image is
  `sha256:923752a931ea076db93cb33cddd7fd6489184a4a7ab0d7202c90c5f6b0fadfa8`;
  Public image is
  `sha256:93aaa1e0267133545fb2f5c34b9024cff20317fbad16237aa12f8b8b80e08e29`.

### Production release V34 — complete reviewed Provider lifecycle

- Migration `0060` enforces `submitted -> under_review -> approved/rejected`
  for Provider applications at the database boundary. Active/suspended remain
  separate membership states. A live Market operator must explicitly start
  review with a reason before deciding an application, and self-review remains
  forbidden.
- Customer capacity creation is idempotent: concurrent order intents produce
  one Customer membership and return `201` plus an idempotent `200` replay.
  Concurrent Provider submissions produce one open application and reject the
  duplicate with `MARKET_PROVIDER_APPLICATION_OPEN`.
- Submitted, review-started, approved, rejected, membership activation, and
  suspension transitions create attributable append-only Market evidence.
  Participant, tenant, and Platform tokens cannot call operator transitions.
  Guest private-role URLs remain in the neutral guest presentation.
- All 223 repository tests pass. A clean PostgreSQL/API integration run applied
  `0001–0060` and passed concurrent Customer/Provider requests, operator-only
  lifecycle transitions, both decisions, suspension/reactivation, state guards,
  boundary denial, and audit immutability. Headless Edge confirmed a guest
  cannot expose Provider private navigation through a hand-written URL.
- V34 was production-deployed after verified backup
  `overva-20260829T061635Z`. Production is API V34, Public V30, Web/Admin V31,
  and schema `0060`; it remains at zero Market identities, memberships,
  applications, operators, and events. All seven services, local Caddy, external
  Home/API, Market `401`, and Public V30 assets passed. Deployed API image is
  `sha256:50165a48b14af0be442f7186f18c76820959ded82eb4a6fcb5009e4771067188`;
  Public image is
  `sha256:0f8f65450bd9ebc43d087d463ab3585ef47c81d0626969f1b36b427c1f092719`.

### Production release V33 — action-driven Market participation

- Migration `0059` adds isolated Provider applications and links their
  attributable lifecycle to the append-only Market audit journal. API V33,
  Public V29, and schema `0059` are production-deployed; Web/Admin remain V31.
- Public V29 starts every unauthenticated visitor in one neutral guest browse
  context. Customer/Provider role switching, private navigation, and work queues
  are not shown to guests. Ordering prompts Market authentication and then
  creates Customer capacity from the order intent.
- Provider self-issuance is blocked. A registered identity submits a profile,
  skills, optional portfolio URL, and rules acceptance. Only a separately
  assigned live Market operator can approve or reject it with a reason; an
  operator cannot review their own application. Approval creates the active
  Provider membership, rejection does not.
- One identity can still hold both active capacities and switch views without
  gaining authority. Platform founder, tenant, Market operator, and participant
  boundaries remain separate. Listing, proposal, payment, dispute, forum,
  ranking, and transaction backends remain absent.
- All 222 repository tests pass. A clean disposable PostgreSQL run applied
  `0001–0059` and passed Customer order intent, Provider submission,
  approve/reject, self-review denial, view authorization,
  suspension/reactivation, cross-token denial, and immutable Market evidence.
  A 1440×1000 headless Edge render confirmed the neutral guest UI.
- V33 was production-deployed after verified backup
  `overva-20260829T060223Z`. Production remains at zero Market identities,
  memberships, Provider applications, active operators, and audit events. API
  image `sha256:a750213878a4380bcfb7267258526669299f6a135a2e07240b4b033cf308004d`
  and Public image
  `sha256:54f2546b9a472b6b871a2a57eaef5b805148e5e70149a51057d5142bf71a16e9`
  are deployed. All seven services are healthy; local Caddy and external Public
  V29, API, Market-auth boundary, tenant app, admin redirect, and status checks
  passed.

### Production release V30 — Platform admin RBAC

- V30 is production-deployed. Migration `0056` adds 13 Platform-only
  permissions, six bounded roles, 36 role-permission mappings, and attributable
  role assignments. Every previously active Platform administrator was
  backfilled with `platform-owner`; production verified one active admin and
  one active owner assignment.
- Platform authentication derives live roles and permissions on every request.
  All organization, adoption, operations, system, AI knowledge/usage, module
  validation, and billing routes enforce scoped Platform permissions
  server-side. Platform RBAC grants no Group, OVERVA Apps, or Market authority.
- The production admin shell presents Group, Platform, OVERVA Apps, and Market
  as separate contexts. Only Platform has a real backend. Group, Apps, and
  Market are truthful responsibility blueprints; they do not claim shared
  identity, storage, accounts, listings, proposals, forum, payments, or
  operator APIs.
- Pre-deployment backup `overva-20260829T023027Z` passed SHA-256, PostgreSQL
  archive-list, and uploads-archive verification. The full 207-test suite,
  migration counts `13|6|36`, existing-admin owner/permission smoke, all seven
  service health checks, Caddy loopback, and public admin/API/status/home/app
  checks passed on 2026-08-29. Public V27 was not recreated by this release.

### Production release V31 — Founder Control

- Migration `0057` adds two Platform-only permissions, one
  `founder-operator` role, short-lived tenant support grants, and append-only
  support-access events. A fresh database contains 15 Platform permissions,
  seven roles, and 53 role-permission mappings; bootstrap gives the first
  founder two role assignments and 15 effective permissions.
- Founder Control truthfully labels live Platform authority, preview Market
  customer/provider memberships, planned Apps and Market operator boundaries,
  external system operation, and offline break-glass recovery.
- Support access requires a 12+ character reason, one to three allowed scopes,
  and a 5–60 minute lifetime. Only the issuer can read or revoke it. The
  snapshot is aggregate/read-only and cannot create a tenant identity, bypass
  tenant APIs, mutate tenant data, or suppress audit evidence.
- `recover-platform-owner.js` requires production-only migration authority,
  explicit confirmation, a target email, and a 20+ character reason. It
  restores only Platform owner/founder assignments and writes Platform plus
  security audit evidence.
- The 213-test suite and a disposable PostgreSQL/API integration flow pass:
  migrations `0001–0057`, founder bootstrap, grant issue, scoped snapshot,
  revoke, subsequent denial, and immutable event evidence. A separate forced
  founder-lockout test also passed recovery plus dual-audit verification.
- V31 was production-deployed after verified backup
  `overva-20260829T031638Z`. Production reports schema `0057`, catalog counts
  `15|7|53`, two active founder role assignments, and 15 effective permissions.
  Founder Control boundary smoke, all seven service health checks, local Caddy,
  and external V12 admin/API/status/home/app checks passed. Public V27 was not
  recreated.

### Production release V32 — Market identity and membership

- Migration `0058` and `/api/market/*` implement the first bounded Market
  identity slice in production. At that release API was V32, Public Home was
  V28, and production schema was `0058`; V33 above supersedes its participant
  activation and guest-presentation behavior.
- Market login identity, participant memberships, operator assignments, token
  context, routes, and append-only audit evidence use isolated `market_*`
  records with no tenant-user, organization, employee, Platform-admin, or
  Platform-role links. Person-level federation is not implemented.
- One identity may hold zero, one, or both active `customer` and `provider`
  memberships. The selected view is allowed only by a live active membership
  and changes presentation context without adding membership, operator role, or
  any other authority.
- Participant membership is self-service and does not claim supplier
  verification. Suspension/reactivation is guarded by a separately attributable
  live Market operator assignment and reason; no founder, Platform, tenant, or
  participant role silently creates that assignment.
- The public Market shell retains unauthenticated Customer/Provider preview.
  A real Market session can register/login, add either or both memberships,
  switch only among its active memberships, and log out. Listings, proposals,
  payments, disputes, forum persistence, ranking, and supplier verification are
  still absent. The cache-busted V28 public assets and the bounded Market route
  are production-deployed through the existing Cloudflare/Caddy edge.
- D-027 records the accepted identity/storage/federation contract. All 221
  repository tests pass. A disposable PostgreSQL/API flow applied migrations
  `0001`–`0058`, exercised zero/one/both memberships, both view switches,
  tenant/Platform token denial, participant/operator denial, operator
  suspension/reactivation, and append-only audit protection. A 1440x1000 local
  headless Edge render also passed.
- V32 was production-deployed after verified backup
  `overva-20260829T034814Z`. Production reports schema `0058`; the initial
  Market state remains zero identities, zero memberships, zero active operator
  assignments, and zero Market audit events. No test identity or operator was
  left in production. The runtime role can insert Market evidence but cannot
  update, delete, or truncate it.
- API image
  `sha256:dadac6b8c740509851343d80e145505eb0fd81ca49f6c6dd8555ecfa81eb592e`
  and Public image
  `sha256:6dd118b9ba3bce827820993f3e547505846d860072131971319ca0c06096a6c0`
  are deployed. All seven services are healthy; local Caddy and external
  Market auth routing, Public V28 CSS/JS, API health, and tenant-app health
  passed. The external unauthenticated Market identity check returns the
  expected HTTP 401 boundary response.

## Implemented Foundations

### Platform and tenancy

- Ordered PostgreSQL migrations with transaction/advisory-lock protection.
- Organization/tenant, subscription, user, role/permission, and platform-admin
  foundations.
- Server-derived tenant identity and tenant-scoped data access patterns.
- Immutable audit foundation for critical actions.
- Public trial provisioning and platform administration portal.
- `overva.com` now opens as a production-deployed, full-screen Mongolian studio
  with three primary regions: a deliberately minimal sidebar, a persistent
  conversation stream, and a live product preview. The desktop document does
  not scroll; chat and preview own their overflow independently. Enter submits
  an intent, the browser-local deterministic advisor streams back its
  interpretation and asks for confirmation, and the preview builds a concrete
  import, structure, work-flow, or discovery view. Confirmed paths preselect
  relevant trial modules. The v5 boundary keeps every explanation, question,
  and confirmation in the conversation region; the preview contains only an
  interactive product surface with its own tabs, selectable cards/steps, file
  input, and test actions. Preview actions update only preview state and never
  add chat narration or mutate canonical organization data. In v6 the entry
  choices are input-oriented rather than module-oriented: describe the
  organization, provide a file/Excel workbook, show an image/diagram, or
  explain current systems. A material chooser accepts spreadsheet, document,
  PDF, Visio, text, and image formats up to 10 MB; CSV structure and image
  preview stay browser-local. An UTF-8-BOM CSV organization-intake template is
  publicly downloadable and opens in Excel. The preview exposes Structure,
  Work Flow, Systems, and Product views. This public interaction does not claim
  to perform provider-backed content analysis and does not upload selected
  files or store free text. In v7 the save dialog summarizes already established
  context and asks only for workspace name, email, and password. Organization
  code, owner identity, and the inferred module set are generated internally
  for the unchanged provisioning API contract. A guest path allows students
  and exploratory visitors to continue testing the browser-local preview
  without creating a tenant. In v8 a dedicated browser-local conversation-
  memory core keeps evidence, discussion, hypotheses, confirmed understanding,
  plans, execution/verification, and checkpoint state distinct. Preview actions
  remain test activity and cannot promote a hypothesis or represent canonical
  execution. A returning visitor explicitly chooses whether to resume, while
  Mongolian and Latin-Mongol memory questions can retrieve the relevant layer.
  `CONVERSATION_MEMORY_CONTRACT_V1.md` and decision D-013 define the accepted
  promotion rules and future tenant-scoped context-package boundary. In v9 a
  separate seven-stage delivery lifecycle covers Understand → Build → Team
  Preview → Scope → Commercial Agreement → Deployment → Live Operation. The
  preview shows its current stage, next gate, and missing requirements. Saving
  updates only a browser-local named checkpoint: the public studio no longer
  calls `/api/public/trials`, asks for email/password, creates a tenant/user, or
  links directly into `app.overva.com`. Scope, offer/contract, hosting, security,
  data migration, acceptance, operational ownership, and backup readiness remain
  explicit gates. `PRODUCT_DELIVERY_COMMERCIAL_CONTRACT_V1.md` and decision
  D-014 define the accepted boundary; this lifecycle remains separate from
  post-tenant organization growth events. Public HTML, cache-busted v9 assets,
  container/domain health, lifecycle/save boundaries, and the full 176-test
  suite were production-verified on 2026-08-26. In v10 the sidebar renders the
  named workspace, current `x/7` stage, completed/current/locked journey steps,
  the next unmet gate, and only working contextual tools for conversation,
  materials, preview, confirmed decisions, and preview-test history. A locked
  stage explains its requirements in conversation without changing preview.
  Cache-busted v10 assets, container/domain health, sidebar markup/handlers, and
  the continued absence of public trial provisioning were production-verified
  on 2026-08-26.
- Organization settings, enabled modules, plans, billing records, and tenant
  lifecycle foundations.

### Organization, people, and governance

- Canonical organization, department, position, employee, and optional employee
  login-account separation.
- Tenant-scoped job-definition-to-workspace access is implemented. An active
  employee assignment resolves through position and job definition to the
  relevant workspace codes; employee master data, login identity, and workspace
  access remain separate concerns.
- Tenant navigation combines enabled-module, permission, and job-workspace
  policy. The dashboard remains the common entry point, while operational
  workspaces appear only when the tenant has enabled them and the signed-in
  person's assigned job allows them.
- A source-owned, repeatable pilot configuration profile maps the current
  Choibalsan jobs to relevant workspaces without hard-coding that organization's
  structure as the OVERVA default. Camera access is included for the evidenced
  director, chief engineer, network engineer, and safety responsibilities.
- The current Choibalsan pilot profile applies 34 workspace mappings across
  eight job definitions. It includes HR/attendance/report access for the human
  resources job and safety/work-flow/lighting access for the HSE job; these are
  ready for real-role user acceptance testing without granting blanket platform
  or tenant-admin access.
- Employee master data, extended HR profile, contracts, attendance, leave,
  skills/training/performance, recruitment/onboarding/offboarding foundations.
- Organization blueprint interview and approval flow.
- Existing organizations use a non-destructive structure update/addition mode;
  their current departments, positions, employee count, and evidenced work
  needs are summarized before any new blueprint proposal is generated.
- Industry/work-pattern configuration without making one pilot universal.
- Data lifecycle, data ownership, metadata, quality-rule, integration-contract,
  and issue-learning foundations.

### AI-assisted onboarding

- Governed BA knowledge library and versioned OVERVA Requirements Method.
- Guided organization discovery and AI-assisted blueprint foundation.
- An evidence-backed Organization Discovery slice is implemented locally in
  the existing Organization Blueprint workspace. Tenant-private pasted text,
  interview notes, document excerpts, and system inventories are stored with a
  SHA-256 provenance hash; deterministic analysis creates separate AS-IS
  findings and `Native` / `Integrate` / `Later` capability proposals.
- Evidence sources, findings, proposals, and human review decisions are
  append-only and tenant-scoped. Accept/correct/reject decisions are audited;
  neither analysis nor review applies modules, structure, or master data.
- Migration `0053` and the related API/UI are deployed. Generic workbook
  Dataset Discovery extends the same safe onboarding path in migration
  `0054`: it classifies sheets as source/master/derived/report/instruction,
  profiles columns and quality findings without retaining raw cell values, and
  proposes target-domain readiness without exposing a canonical commit path.
- A real 7-sheet sales/delivery workbook was processed locally: 1 source, 1
  master, 1 derived, 3 report, and 1 instruction sheet were identified; 43
  profile findings and 5 missing target contracts correctly blocked commit.
  Migrations `0053`-`0054`, runtime grants, service health, and the public web/API
  path were production-verified on 2026-08-26. The combined slices pass the full
  173-test local suite.
- Smart Import foundations for structured data and organization structure.
- Organization Structure Smart Import now separates proposed action, validation,
  human review decision, and commit outcome in the PostgreSQL/API contract.
- Row correction, acceptance, reasoned exclusion, approval blocking, commit
  reconciliation, tenant isolation, and immutable audit are implemented.
- A privacy-safe dry run against a real 15-sheet company workbook validated the
  employee parser, mapping, and validation flow without database writes. Smart
  Import selects `Employee_Master` instead of assuming the first worksheet and
  normalizes compatible third-party SpreadsheetML namespace/table/merge
  metadata. Of 58 employee rows, 56 were ready and 2 duplicate identifiers
  correctly blocked commit. The production API/parser hash, compatibility path,
  worksheet selection, public health endpoint, and cache-busted web asset were
  verified on 2026-08-26.
- Customer-journey evidence and Smart Import review migrations `0049` and `0050`
  are applied to the current production database; the API and web containers
  were rebuilt and verified after deployment.
- The Hercules Import Review v4 export was audited as a UX reference. Its mock
  rows, local state, Convex schema, routes, auth assumptions, and backend were not
  imported into OVERVA.
- The production organization-structure workspace now presents the existing
  tenant-scoped PostgreSQL structure through a six-stage hub: units, job
  definitions, positions, reporting relationships, employee assignments, and
  validation/approval readiness. The hub derives duplicate, incomplete,
  unassigned, over-capacity, and reporting-cycle warnings without duplicating
  the existing structure editor or Smart Import workflow. Hercules supplied UX
  reference only; OVERVA remains the system of record.
- Proposed mapping/configuration is separated from approved application.
- AI usage governance and audit foundations.

### Operational capabilities

- Assets, work orders, attachments, work history, and approval workflow.
- Inventory, procurement, finance import, documents/records/archive, reports,
  attendance, HR operations, and safety foundations.
- Map, GPS/fleet, IoT telemetry/commands, maintenance, field PWA, automation,
  integrations, API keys/webhooks, executive view, and AI director foundations.
- OVERVA Connect V1 now has a read-only canonical business-event envelope
  validator on the existing tenant-scoped integration-contract boundary. It
  checks event and schema versions, provenance, subject, correlation, time, and
  domain payload; returns a deterministic SHA-256 fingerprint; rejects client-
  supplied tenant selection and unknown envelope fields; and neither retains
  the payload nor mutates canonical data. `OVERVA_CONNECT_CONTRACT_V1.md` and
  decision D-016 define the boundary. The full local suite passes 181 tests.
  No real multi-system delivery, connector
  certification, marketplace, or national standard is claimed by this slice.
- Public workspace v12 is production-deployed. It
  adds a distinct OVERVA Home above the existing Workspace Studio. Home searches
  and renders browser-local workspace cards with current/next lifecycle context,
  starts separate work from text, file/data, image/diagram, or system context,
  and opens the seven-stage Studio only after a workspace is selected. Existing
  stable workspace IDs, governed memory, preview, lifecycle, and no-provisioning
  boundaries are preserved. `PUBLIC_PORTFOLIO_HOME_CONTRACT_V1.md` and decision
  D-017 define this two-level navigation boundary. Before deployment, backup
  `overva-20260827T023907Z` passed checksum, PostgreSQL archive-list, and uploads
  archive verification. The 181-test local suite, production Docker build,
  container health, Caddy loopback, external v12 HTML/CSS/JS assets,
  `status.overva.com` health, no-provisioning boundary, and 1440x1000 production
  headless Edge render were verified on 2026-08-27.
- Public workspace v13 is production-deployed. The Workspace Studio sidebar now
  exposes an explicit `Миний ажлууд` return control instead of relying on users
  to infer that the OVERVA logo returns Home. It preserves the selected
  workspace and its checkpoint, while the workspace selector and `Шинэ ажил`
  retain their separate switch/create responsibilities. Desktop shows the full
  label; narrow and mobile layouts retain a compact return icon. Backup
  `overva-20260827T024651Z`, 181 tests, Docker builds, production v13 HTML/CSS/JS
  markers, external health, and all service health checks passed on 2026-08-27.
- Public workspace v14 is production-deployed. The portfolio Home no longer
  repeats the same screen as `Нүүр` and `Бүх ажлын өрөө`, and it no longer
  presents `Холболтын ажил` as global navigation that silently creates a new
  workspace. The Home sidebar now has one action, `Шинэ ажил`; systems work
  starts deliberately from the central `Одоогийн системээ холбох` prompt.
  Existing browser-local checkpoints are preserved. Backup
  `overva-20260827T025646Z`, 181 tests, Docker builds, production v14 markers,
  public health, and all service health checks passed on 2026-08-27.
- OVERVA Connect OAuth accounts V1 are production-deployed. A public catalog
  and authenticated tenant Connect view
  expose Google Drive, Google Sheets, and GitHub as explicit read-only
  providers. OAuth state is one-time and tenant/user-bound; provider tokens are
  AES-256-GCM encrypted; owner/administrator permission, connect/reconnect,
  live read-only resource checks, disconnect token clearing, and append-only
  audit evidence are implemented. Missing OAuth registrations appear as
  unavailable instead of simulated success. Migration `0055`, v15 public Home,
  authenticated Connect assets, external catalog/API health, and a 1440x1000
  headless production render are verified. Google/GitHub OAuth registrations,
  deployment secrets, and live provider consent remain to be configured and
  verified before any provider can report `available=true`.
- Choibalsan employee and lighting migration tooling with provenance controls.
- The camera operations workspace is deployed and production-verified for the
  Choibalsan pilot. Migration `0052` enables the module and four camera work
  types; authenticated API data is tenant-scoped, camera workspace access is
  enforced server-side, and organization-owner oversight is preserved.
- The camera release passed a verified pre-deployment database/uploads backup,
  164 automated tests, production migration and health checks, a 21-account
  allow/deny authorization matrix, public static/API checks, and headless browser
  checks for authorized navigation/render plus unauthorized hiding.
- Public workspace v16 exposes `Холболтууд` directly inside Workspace Studio.
  It opens the same public Google Drive, Google Sheets, and GitHub catalog
  without creating or replacing a workspace. The former Home prompt is now
  labelled `Системийн зураглал гаргах`, making its discovery-work purpose
  distinct from real OAuth account authorization.
- Public workspace v17 is production-deployed with the organization-first entry
  question `Байгууллагынхаа ямар ажлыг цахимжуулах хэрэгтэй байна?`. Home now
  explains four reviewable outcomes—problem definition, confirmed requirement,
  first preview, and next step—before showing implementation options. External
  connectors are presented as optional information sources, and the developer
  network is labelled as a forming concierge pilot rather than an operating
  automated marketplace. Empty Home submission is blocked instead of creating
  a blank workspace. Generic Excel or warehouse language now starts governed
  problem discovery rather than being misclassified as employee Smart Import.
  The internal seven delivery gates remain unchanged.
- Public workspace V18 request-intake slice is production-deployed. Home now
  combines the accepted organization-first question with an educational board
  of four clearly labelled `Жишиг хүсэлт` patterns and a structured request
  form for work type, business area, required capabilities, problem, desired
  outcome, budget context, period, and intended visibility. AI completeness
  review is optional rather than a mandatory entry conversation. Submission
  stores an unpublished browser-local draft and hands a standardized package to
  a separate governed workspace for human review. It does not publish demand,
  expose it to developers, collect proposals, rank vendors, accept payment, or
  form a contract. JavaScript syntax, all 187 tests, production health, live V18
  assets, and a headless Edge reference-request -> prefilled form -> unpublished
  draft -> Workspace handoff were verified on 2026-08-27.
- Public workspace V20 material-aware request intake is production-deployed.
  The Home `Файл, өгөгдөл` and `Зураг, схем` actions no longer create a blank
  workspace and send the person into the legacy Studio material flow. They keep
  the person on Home, open the structured request form after selection, and
  show the selected material's name, type, size, and browser-local privacy
  boundary. Only confirmed form submission creates the unpublished request
  draft and linked workspace. The draft and checkpoint retain metadata only;
  file content is not uploaded or written to local storage. JavaScript syntax,
  all 191 tests, a production image build, local file/image E2E, verified backup
  `overva-20260827T071944Z`, external health/assets, and live production
  file/image E2E passed on 2026-08-27.
- Public workspace V21 market-board Home is production-deployed.
  Home now leads with a compact, readable request list instead of a large
  chat-first prompt. Its primary navigation is `Бүх хүсэлт`, `Миний хүсэлт`,
  `Миний ажил`, and `Дүрэм`, with one explicit `Хүсэлт гаргах` action, search,
  bounded categories, and four row-based reference requests. The reference
  rows are visibly labelled `ЖИШИГ` and `Бодит захиалга биш`; they do not claim
  live demand, proposals, payments, contracts, ratings, or arbitration.
  `Миний хүсэлт` renders the existing separate browser-local draft registry,
  `Миний ажил` renders existing workspace checkpoints, and the Rules view
  explains both the intended request-to-production sequence and current
  capability boundary. Structured request intake, optional AI review, material
  metadata handling, unpublished draft creation, and the governed Workspace
  Studio remain unchanged. JavaScript syntax, all 191 tests, production-image
  build, and desktop Edge navigation/category/dialog E2E passed. Verified
  pre-deployment backup `overva-20260827T074109Z`, production service health,
  external V21 HTML/JS/CSS, status health, and loopback origin checks passed on
  2026-08-27.

- Public workspace V22 role-separated Market shell is production-deployed.
  A visible `Захиалагч` / `Гүйцэтгэгч` switch now separates customer requests
  and projects from provider opportunities, proposals, delivery jobs, and
  execution rules. `Миний ажил` is renamed `Миний төслүүд` and explicitly means
  customer workspaces. Provider views truthfully show empty concierge-pilot
  states rather than fabricated proposals or jobs. The test-only Market model
  now requires provider delivery evidence before customer acceptance and allows
  one verified review per party only after closed production outcome. At that
  release D-020 and `MARKETPLACE_OPERATING_MODEL_V1.md` defined the delivery
  control boundary; D-023 now supersedes its mandatory-control interpretation.
  This does not add production Market identity, publication,
  proposal, payment, escrow, or review persistence. JavaScript syntax, all 191
  tests, the production image build, verified backup
  `overva-20260827T081501Z`, production service health, and external V22
  HTML/JS/CSS checks passed on 2026-08-27.

- Public workspace V22.2 customer-language refinement is production-deployed. Existing
  public workspace cards remain non-destructively preserved but now identify
  themselves as test projects stored only on the current device. Customer
  request, project, privacy, attachment, and Rules copy no longer depends on
  unexplained browser-local, workspace, specification, proposal, escrow, or
  production-capability jargon. The customer Rules path now visibly covers
  request, confirmed requirement, proposal, selection, agreement, execution,
  acceptance, operational launch, and review while continuing to state that
  real proposals, payments, automatic contracts, and dispute resolution are
  not yet live. JavaScript syntax and all 191 automated tests passed. Verified
  backup `overva-20260827T084207Z`, production service health, external V22.2
  assets, the full customer flow marker, and status health passed on 2026-08-27.

- Public workspace V23 is production-deployed. It separates pre-award requests
  from post-agreement projects: saving creates only an unpublished request draft,
  optional OVERVA review creates a separately labelled refinement room, and
  `My Projects` remains reserved for work after provider selection and bilateral
  agreement. Existing device-local checkpoints remain recoverable without being
  presented as real projects.
- Public workspace V24 is production-deployed. Joint Clarification is an optional
  provider-proposed collaboration path after selection, never a mandatory AI,
  preview, or fixed lifecycle gate. Customer and provider primary navigation no
  longer promotes legacy trial rooms or rules, while existing local records remain
  recoverable. No provider, proposal, agreement, payment, or review backend is
  claimed by this release.
- Public workspace V25 requirement artifact is production-deployed. A customer
  can explicitly confirm the current
  request revision and download a UTF-8, versioned requirement artifact. The
  confirmation remains browser-local and records its time and source revision;
  it does not publish the request, send it to a provider, or create a project.
  JavaScript syntax, the focused 12-test public flow, the full 192-test suite,
  production image build, verified backup `overva-20260828T092432Z`, all service
  health checks, Cloudflare loopback, and external V25 assets passed on
  2026-08-28.
- D-023 and `MARKET_PLATFORM_SEPARATION_CONTRACT_V1.md` now establish the
  accepted target boundary between the governed Platform/App Factory,
  supplier-neutral Market operator, and equal-participating `OVERVA Apps` vendor
  arm. This is product and architecture direction, not a claim that a separate
  Market backend, real product commerce, freelance proposals, forum, payments,
  or neutral ranking is already implemented.

## In Progress

- Design V26 public information architecture around peer `Products`,
  `Freelance`, and `Community` paths while truthfully distinguishing examples
  from real inventory and commerce.
- Define separate Market identity, data, administration, ranking, commercial,
  and audit boundaries before implementing real multi-supplier records. Do not
  reuse Platform tenant tables as Market aggregates.
- Pilot-test V25 requirement artifacts and a bounded set of real third-party and
  `OVERVA Apps` products/orders under equal supplier rules. Measure customer
  choice, requirement accuracy, proposal confidentiality, and operator
  neutrality before automating ranking or payment.
- Validate the first `inventory.goods-received` event contract with at least
  two real source/target systems, including authorization, idempotency, retry,
  reconciliation, rollback, and operational ownership evidence.
- Persist attributable scope, commercial agreement, deployment choice, and
  operations-readiness records behind the production-deployed v10 public
  lifecycle before tenant provisioning is reconnected.
- Pilot-test public workspace v12 with real returning and first-time visitors.
  It includes the v11 browser-local
  multi-workspace registry, non-destructive legacy checkpoint migration,
  same-workspace/new-workspace decisions, and preliminary Latin-Mongol profile,
  now routed through the separate Home and Workspace Studio surfaces.
- Pilot UAT for the production-deployed evidence-backed capability-map, Dataset
  Discovery, and employee Smart Import slices; real-file profiling and automated
  regression/deployment checks are complete.
- Extend the public guided-start pattern into an authenticated, role-aware
  tenant setup guide with progress, impact preview, and explicit approval; do
  not turn routine employee work into a permanent chat-first interface.
- Customer journey evidence model for Discovery → Blueprint → Pilot → First
  Value → Go-live → Paid → Champion → Referral.
- Platform-admin adoption/funnel presentation and manual milestone controls.
- User-acceptance validation of job-relevant navigation with pilot users,
  including checks for both missing and excessive workspace visibility.
- Human pilot validation of camera terminology and day-to-day workflow value;
  automated camera deployment and authorization verification are complete.
- Continued normalization of imported Choibalsan operational data into general
  OVERVA domain concepts.
- Validate the Organization Structure Smart Import with additional real,
  anonymized customer files and refine mapping/quality rules from the evidence.

## Current Product Focus

1. Make the separate Products, Freelance, and Community Market paths clear to a
   first-time visitor without forcing Platform discovery.
2. Prove supplier-neutral Market operation with bounded real inventory and
   assisted orders before automating ranking, payment, or mass onboarding.
3. Make organization discovery and Smart Import easier and safer.
4. Measure setup effort, abandonment, assistance, first value, and adoption.
5. Turn real pilot problems into reusable patterns without hard-coding the
   pilot's terminology into the platform.
6. Keep tenant-facing navigation role- and workspace-relevant.
7. Improve the platform-admin view of system health, adoption, AI cost, data
   quality, and operational risk.
8. Test the Creator Studio / Client Review / Runtime hypothesis with real
   self-builders, professional implementers, and business reviewers.

## Known Boundaries

- An implemented foundation is not automatically mature, complete, or proven at
  large scale.
- Some module code exists before its tenant-facing workflow is fully polished.
- The current single-host deployment is a pilot architecture, not evidence of
  high-availability deployment.
- AI must not silently apply consequential configuration or operational changes.
- The ecosystem North Star and market-entry strategy are accepted, but a mature
  marketplace, automated matching, contracting, escrow, pricing intelligence,
  vendor certification, and cross-organization commerce are not implemented or
  proven current capabilities.
- A test-only in-memory marketplace boundary simulator now covers five isolated
  customer organizations, ten isolated developer organizations, five request
  journeys, proposals, scoped conversations, bilateral agreement, pilot,
  acceptance, production, and closure. This is architecture evidence only; it
  creates no production identities or orders and does not make the marketplace
  an implemented capability. The boundary audit is recorded in
  `docs/MARKETPLACE_BOUNDARY_AND_DEMO_AUDIT_V1.md`.
- Public Home V26 is production-deployed.
  Its default area is `Маркет`, followed by `Форум` and `Захиалгат ажил`.
  Market places clearly labelled OVERVA Apps
  samples beside other supplier samples without operator privilege. Forum and
  product commerce remain honest preview surfaces: there are no live posts,
  accounts, prices, purchases, supplier onboarding, or server-backed catalog
  records. The existing request/provider shell now lives only under the custom
  work area. Deployment used verified pre-deployment backup
  `overva-20260828T101326Z` and recreated only `public-site` with the Cloudflare
  overlay. All seven production services remained healthy; external Home, V26
  JavaScript/CSS, status health, Caddy loopback, three-area navigation, equal
  supplier labels, and the sample-truth marker were verified successfully.
- Public Home V27 is production-deployed. It applies D-024
  terminology: the custom-work area is `Захиалгат ажил ба үйлчилгээ`; Product
  Market uses Apps, Modules, Connectors, Templates, and AI Agents; and a
  non-operational Market Governance note explains equal supplier rules. The
  added cards, rules, and controls remain samples or disabled previews.
  Deployment used verified pre-deployment backup
  `overva-20260828T122110Z` and recreated only `public-site` with the Cloudflare
  overlay. All seven services remained healthy. External V27 HTML/JS/CSS,
  custom-work/service label, five product categories, governance note,
  sample-truth boundary, status health, and Caddy loopback were verified.
- D-024 and `OVERVA_GROUP_OPERATING_MODEL_V1.md` now define OVERVA Group as an
  ownership umbrella with three peer operating roles: Platform, OVERVA Apps,
  and Market. Group membership is not a tenant, database, authorization, or
  permission boundary. Legal-entity separation is not claimed as implemented.
- Admin shell V30, Founder Control V31, and the bounded Market participant
  identity slice V32 are production-deployed. The existing
  authenticated Platform admin remains the only operational control plane. One
  web application now provides a context switcher for Group overview, Platform,
  OVERVA Apps, and Market Operator. Group and Apps remain boundary blueprints;
  the admin Market context still grants no operator access. V32 adds only the
  separately typed public Market identity/membership API and isolated
  `market_*` storage. The Platform token grants no Apps or Market access, no
  Platform/founder role creates a Market operator assignment, and no universal
  super-admin role was introduced. V29
  adds business-responsibility workspace blueprints for Group, Apps, and Market,
  labels the twenty-role simulations truthfully, uses cache-busted responsive
  assets. V30 adds migration `0056` with 13 Platform-only permissions and six
  bounded roles. Current assignments are resolved server-side on every request;
  every Platform control and billing route has an explicit permission guard;
  existing administrators are backfilled as `platform-owner`; and the browser
  fetches, displays, and mutates only granted Platform areas. The complete
  207-test suite, a clean `0001–0056` disposable PostgreSQL rehearsal, and
  production-equivalent `overva-api:v30-admin-rbac-local` and
  `overva-web:v30-admin-rbac-local` builds passed. V31 then adds the bounded
  founder role, short-lived read-only support access, immutable lifecycle
  evidence, and offline audited owner recovery described above.
- D-025 and `ADMIN_OPERATING_MODEL_V1.md` define bounded workspaces for Group
  oversight, Platform operations, OVERVA Apps vendor operations, and Market
  operation. A test-only admin control simulation now creates twenty isolated
  virtual roles per context (eighty total), verifies cross-context denial,
  four-eyes Platform/App/Market/Group gates, aggregate-only Group visibility,
  append-only event evidence, and a redacted Apps-to-Market release handoff.
  This simulation creates no production identities and does not make the Apps
  or Market transaction/operator workspaces operational.
- Public workspace V25 is production-deployed.
- `My Requests` stores request drafts, their review state, and (in V25)
  an explicit human-confirmed requirement revision. `My Projects` remains empty
  until provider selection and bilateral agreement. A saved or confirmed
  request never creates a project or opens Studio automatically.
- Legacy browser-local request/workspace links migrate non-destructively into
  optional review-room links. Existing local checkpoints remain recoverable as
  earlier experiments rather than customer projects.
- Workspace/request preview data remains browser-local. Server-side Market
  identity and Customer membership exist; production also has the reviewed
  Provider-application path. Publication, proposals, provider selection,
  agreements, payment, production delivery control, and verified reviews are
  still absent.
- Market and Platform are accepted as separate future data and authorization
  boundaries. `OVERVA Apps` is a normal supplier; operator-only and
  competitor-private data must be inaccessible to it.
- Public workspace V24 is production-deployed. It removes `Trial Rooms` and the
  provider rules page from primary navigation, while preserving legacy
  checkpoints behind secondary help. Customer and provider Home copy is now
  role-specific; provider sample
  rows are explicitly separated from the truthful no-live-work state. Provider
  proposals and delivery empty states use plain Mongolian and lead back to the
  next relevant action instead of exposing backend terminology.
- V24 introduces the accepted D-022 interaction boundary: after provider
  selection, the provider may propose an optional `Joint Clarification`; the
  customer may accept it or proceed directly to agreement. The clarification
  surface is intended for inviting relevant customer participants and mapping
  real workflow, actors, information, decisions, and acceptance outcomes. It is
  not a coding room, project, or required gate. No server-side invitation,
  proposal, selection, agreement, or clarification persistence is claimed by
  this public-shell correction.
- V24 passed JavaScript syntax, the focused 11-test public flow, all 191
  repository tests, a production-equivalent image build, and local visual
  review. Verified pre-deployment backup `overva-20260827T114821Z` contains the
  database dump, uploads archive, metadata, and valid checksums/archive lists.
  Only production `public-site` was recreated with the Cloudflare overlay; all
  services remained healthy. Caddy loopback, external Home, V24 JavaScript/CSS,
  and status health returned HTTP 200. Production HTML exposed the V24 assets,
  optional clarification, provider delivery flow, and corrected three-item
  primary navigation for each role.

## Do Not Rediscover as New Work

Search the repository before proposing another Smart Import, blueprint,
requirements interview, approval gate, tenant model, employee master, immutable
audit, customer journey, or AI usage-governance system. Improve the existing
capability when it serves the same purpose.

## Updating This File

Update after a material capability is implemented, removed, or changes status.
Use the labels **implemented**, **in progress**, **planned**, and **hypothesis**
carefully. Do not mark a feature complete merely because a table or screen exists.
