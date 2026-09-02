# Controlled production Work Order safety release — 2026-09-02

Status: **SUCCESS**

Commit `a7297557d7633b34398320312d64c0566430bc95` was deployed through the
Cloudflare-overlay production Compose path. Schema `0094` adds the governed
Work Order HSE permit/inspection slice and the backward-compatible workflow
notification constraint. No rollback stop condition fired.

## Release identity and cutoffs

- Rollback artifact ID: `20260902T101349Z`
- Final migration cutoff: `2026-09-02T10:23:02.4712746Z`
- Production migration: `2026-09-02T10:23:38.6082938Z` to
  `2026-09-02T10:23:39.7239924Z`
- Candidate application cutoff: `2026-09-02T10:25:33.7572414Z`
- Previous API image:
  `sha256:8c24706b277e0ccbd63dbb511530d3a2401599ac914c7fce006d7053dfcc642b`
- Previous Web image:
  `sha256:1d885425517bc3ac5777ed9dfc43c50b675ac05e44debaa5a0690f4714df8da9`
- Candidate API image:
  `sha256:e818bd2f9b1c187a407678849fb72cb8ae31c71705102369276c6c93f71275d2`
- Candidate migration image:
  `sha256:65b6ef6d9b6a1eb82b8255f912c4502248f23299468fc050093fa7f19b3401de`
- Candidate Web image:
  `sha256:6e208866de7ef5905d9b3c5618c406a832fd910019515960b9ef06883a9ce5b3`

The prior images were pinned as rollback tags, exported, hashed and copied to
the access-controlled `D:\OVERVA\release-artifacts` mirror before candidate
build. The API archive SHA-256 is
`6585cb48e574752017890d598ed7e9bc8ba778472875892637e2892996fb123f`;
the Web archive SHA-256 is
`9ac1b67afdb33900d248f95fbde25b92e013f9ba452413b804def1214ef700d8`.

## Rehearsal and migration result

A fresh production-backup clone started at schema `0093` with the exact
production invariant. The candidate image applied `0094`, reran it as a no-op,
and the production migration entrypoint refreshed runtime grants. The clone
verified:

- migration SHA-256
  `d351ece6065a6628f097da74909c2bd4b1c6912166017f31e2ba8cb1a5fab45f`;
- all three new tables with tenant RLS and organization-scoped `USING` plus
  `WITH CHECK` policies;
- enabled append-only safety-review trigger;
- runtime `SELECT` and `INSERT`, with `UPDATE`, `DELETE` and `TRUNCATE` denied;
- two templates and seven exact routes for `choibalsan-hugjil`, and zero for
  every other tenant;
- zero fabricated safety reviews;
- candidate-runtime Work Order creation returned HTTP `201`, created three
  `work_order_workflow` notifications, and accepted `work_order_returned`.

The clone database and temporary dump/smoke artifacts were removed before the
production write drain.

Production migration then applied `0094` in one bounded transaction and
refreshed the runtime grants. The recorded checksum, validated notification
constraint, RLS policies, trigger, grants, tenant seed boundary and zero-history
gate all matched the rehearsal.

## Smoke and invariant result

- The repository suite passed `402/402` before release.
- The deployed release check passed 94 migrations, 25 active modules,
  canonical Employee links, frontend shell checks and zero orphan test events.
- Authenticated session, report and CSV smoke passed; an ordinary user remained
  denied with HTTP `403`.
- The explicit Choibalsan safety smoke passed with 93 risks, zero incidents and
  one briefing.
- API, Web, DB, Caddy, public site, monitor and backup scheduler were healthy.
  Home, App, API, Status, Auth, IoT and Map returned HTTP `200`; Admin returned
  the expected HTTP `302` redirect.
- Production remained at 4 organizations, 25 users, 25 employees, 63
  assignments, 1,715 attendance rows, 106 Work Orders, 662 Work Order events,
  31 documents and 32 document versions. Every corresponding pre/post full-row
  fingerprint matched. Existing notification count/fingerprint also matched.
  Safety reviews and new orphan counts were zero; long transactions and waiting
  locks were zero.

No production Work Order or safety history was created for smoke testing; the
consequential creation test ran only on the disposable backup clone.

## Backup and rollback result

- Final drained pre-deploy backup: `overva-20260902T102321Z`
  - database:
    `bb20e5d5f7725a7844d7c19d305b3c99e88d44afd3eb30cd7fab1ed078b705e2`
  - uploads:
    `6772796c7f1845bca700012d688ddfedf5ac9dda88b413358c48729df6e4e0ae`
  - metadata:
    `09cfdd37971ffc69fd97c0f747ee18634123b41fa563f1e21074fe2a8c15d407`
- Post-deploy backup: `overva-20260902T102759Z`
  - database:
    `38b4ac901ef0e4f2735f243b3b40a13ad356ce01e3db3b6d70c400652f74b1e1`
  - uploads:
    `6772796c7f1845bca700012d688ddfedf5ac9dda88b413358c48729df6e4e0ae`
  - metadata:
    `13d9764677f03f5b080ad511d4e163ea5431a8841858cacf8deee89fcf1bc7d9`

Both backups passed checksum, PostgreSQL custom-dump listing and uploads archive
verification, and both were copied to `D:\OVERVA\backups-production` with
independent hash verification. Rollback was not invoked; the preserved prior
images and final drained backup remain the recovery evidence for this release.
