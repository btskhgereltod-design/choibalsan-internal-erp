# Controlled production lighting workspace release — 2026-09-03

Status: **SUCCESS**

Implementation commit `d2f947c75315b6536aa2be6fe4bcf67fa735b889` is live
on production API and Web at unchanged schema `0098`. No migration ran and no
production business-data write was required.

The lighting workspace now combines the reviewed strengths of the legacy
lighting center with current OVERVA authority boundaries. Six internal views
cover home, objects/equipment, issues/inspections, execution, operating control,
and research/reporting. Five Choibalsan-owned lighting areas filter every view,
while canonical Work Orders, HSE reviews, chief-engineer acceptance,
operational-object dossiers, and fixed-asset ownership remain authoritative in
their existing services.

The old screen's mixed totals are not copied as one KPI. The new area cards show
record, open-issue, and active-work measures separately. Legacy on/off schedule,
meter-reading, and electricity-billing capabilities are shown only as the next
governed connection; the new workspace does not query the legacy application
live or fabricate those states.

## Release and rollback identity

- Release artifact ID: `20260902T165603Z`
- Final API image:
  `sha256:53c14f3fab97c25fbd38e328f86ac50f4989d1404e1df8bfda47b2150d6ed634`
- Final Web image:
  `sha256:2fad3edb192c7933762e31d9148d32736ea7daa5975c861fc971eeddc185765b`
- Rollback API image:
  `sha256:d9dbf6482e3fbabd5685fd6c99be48afa6f0d4ba2b11febda65ec74941d8c6e8`
- Rollback Web image:
  `sha256:292cd24f16652633a62f23aa996ed32b789c9bf727d4fb340682fa1b29f9b0c0`
- Rollback API archive SHA-256:
  `0F601FD76AF78B0EAA086ADFAFD6B182AE99D24762C1722C891F443CF8AA55A6`
- Rollback Web archive SHA-256:
  `663CB71A1C80B18DC1EDCD227D089070B9C8CA52C0E25113BEB5F6BA9FECB3D4`
- Off-device rollback directory:
  `D:\OVERVA\release-artifacts\20260902T165603Z`

Only API and Web were recreated with `--no-build --no-deps`. Database, Caddy,
public site, monitor, and backup scheduler were not restarted. The preserved
application images remain rollback-compatible with schema `0098`.

## Verification

- Full repository suite: `419/419` passed.
- Candidate API syntax and Web static/cache contracts passed before cutover.
- A non-public candidate API used the production runtime boundary for a
  read-only authenticated workspace smoke before cutover.
- The same authenticated smoke passed on the final production API and returned:
  - road: `117` records, `36` open issues, `12` active works;
  - ger-area: `191`, `108`, `4`;
  - tower: `143`, `60`, `0`;
  - panel/board: `295`, `0`, `0`;
  - traffic-signal: `12`, `0`, `1`;
  - unclassified: `0` records, `2` open issues, `10` active works.
- All returned classified records referenced one of the five live tenant-owned
  service-area codes. Ambiguous records remained unclassified instead of being
  inferred.
- Production release check passed `98` migrations, `25` active modules,
  canonical employee links, Web shell files, and zero orphan test events.
- Public Home, App, and API returned HTTP `200`. Public App serves
  `style.css?v=48` and `lighting.js?v=6`, and the latter contains the new area
  navigation.
- API, Web, DB, Caddy, public site, monitor, and backup scheduler were healthy;
  the monitor continued reporting healthy after cutover.

## Scope boundary

This release made no schema change and imported no additional legacy records.
The next optional phase is a separately reviewed canonical model/import for
lighting schedules, monthly meter readings, and electricity billing. It must
define source authority, approval, audit, reconciliation, and rollback before
any production write.
