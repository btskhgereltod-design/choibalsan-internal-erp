# Controlled production Work Board service-area release — 2026-09-03

Status: **SUCCESS**

Implementation commit `804659bda2cd7254b02e7d1b64b0b35894f0688b` and
tenant-RLS read follow-up `e7cc947932cf57314b715aaff8d959b73fa349ad`
are live at production schema `0097`.

The broad **Гэрэлтүүлэг** Work Board view now exposes five Choibalsan-owned
service-area filters: **Авто замын гэрэл**, **Гэр хорооллын гэрэл**,
**Цамхагийн гэрэл**, **Шит/Самбар**, and **Гэрлэн дохио**. The same filter follows
an item from intake through the canonical Work Order lanes. It is not a
department, Work Type, workflow stage, or permission boundary.

Counts are current queue counts. They intentionally do not repeat the legacy
screen's mixed totals for open faults, inventory locations, and assets.

## Release and rollback identity

- Primary release artifact ID: `20260902T155416Z`
- Final API image:
  `sha256:cdea349a38b66763cc1ff30aa642b8f90eeff499b8ad0fbe60b35c13f0ca2e09`
- Web image:
  `sha256:37e19caeaeb7cc4b458d16a351604ed038bacbfc3a4a0d818b3696bc18c15777`
- Migration image:
  `sha256:7e1a73757d055ca05eed7d3b2b59417f94f2cd3b9d0a1bb41c2442940672ce92`
- Migration SHA-256:
  `1FF337C990E11C54E956CA8C3C5EA32D161C36D5FBD17038337856C08600177E`
- Pre-release rollback API archive SHA-256:
  `4A34B63AB6A5D4E6A359E00A19AA0706B84F7E39A1B3B153B2EC22CD6EE2659C`
- Pre-release rollback Web archive SHA-256:
  `AA8FABD4ECD4BA627FF9C9080DDFBB74B56A42BD7BAC97C4A4C878830A91E91E`
- Pre-release off-device rollback directory:
  `D:\OVERVA\release-artifacts\20260902T155416Z`

The authenticated post-deploy smoke exposed that the new RLS-protected service
area table was being read outside a transaction-local tenant context by two GET
routes. No incorrect business write occurred. Follow-up `e7cc947` moved both
reads into the existing tenant transaction boundary and redeployed API only.

- Follow-up artifact ID: `20260902T160334Z`
- Follow-up rollback API image:
  `sha256:3fdafd30f7f9fdfc7639d5c5a5fd1a1c0d36a97f1212cba11b9c66b827c1ed19`
- Follow-up rollback API archive SHA-256:
  `412C181F940D8D4D3FE5F6EB440BC5CA431DC3BCD09ACD22AE5B448A36727944`
- Follow-up off-device rollback directory:
  `D:\OVERVA\release-artifacts\20260902T160334Z`

Only API and Web were recreated for the primary release. The follow-up
recreated API only. Database, Caddy, public site, monitor, and backup scheduler
were not restarted. Migration `0097` is additive, and the preserved application
images remain schema-compatible rollback targets.

## Verification

- Full repository suite: `418/418` passed.
- Production-clone rehearsal passed `0096` to `0097`, checksum, constraints,
  runtime grants, RLS, backfill, idempotent migration behavior, and business
  invariants. The disposable rehearsal database was removed after rollout.
- Authenticated production service-area smoke returned the five names in the
  reviewed order.
- Current intake queue counts are road `36`, ger-area `108`, tower `60`, panel
  `0`, and traffic-signal `0`.
- Current open classified Work Order counts are road `12`, ger-area `4`, tower
  `0`, panel `0`, and traffic-signal `1`.
- Two open lighting intake rows have insufficient source evidence and remain
  explicitly unclassified in **Бүгд** instead of being guessed.
- Runtime RLS returned five service areas in the Choibalsan context and zero in
  another tenant context. Runtime may select, insert, update, and delete tenant
  configuration through RLS; truncate remains denied.
- Production Home, App, API, Status, Auth, IoT, and Map returned HTTP `200`;
  Admin returned its expected HTTP `302`.
- The public Web serves `app.js?v=46` and `workflow.css?v=7`, and both contain
  the new service-area controls.
- API, Web, DB, Caddy, public site, monitor, and backup scheduler were healthy.
- Long transactions and waiting locks were zero.

Production invariants closed at 4 organizations, 25 users, 25 employees, 63
assignments, 1,715 attendance rows, 106 Work Orders, 772 Work Order events, 103
approvals, zero structured safety reviews, 31 documents, and 32 document
versions. These equal the immediate pre-migration values.

## Backup evidence

- Pre-deploy backup: `overva-20260902T155500Z`
- Database SHA-256:
  `74A4D59F27B57B65404B9C2B46498216CA9397BB3D2AD32694372D45F799CA72`
- Uploads SHA-256:
  `6772796C7F1845BCA700012D688DDFEDF5AC9DDA88B413358C48729DF6E4E0AE`
- Metadata SHA-256:
  `4A21ED31054CB07F66EDDD63D5534AC87F291429836A32C5121E6E9DBC77ACAE`
- Off-device backup directory:
  `D:\OVERVA\backups-production\overva-20260902T155500Z`

The backup passed SHA-256 verification, PostgreSQL custom-dump listing, and
uploads archive listing. Every mirrored file was independently hash-verified.

## Work Board navigation hierarchy follow-up

User-review commit `48f90b1923fa5725ced3fc51a168c4c0333baf69` is also
live. The broad source controls **Бүгд**, **Гэрэлтүүлэг**, **Камер**, and
**Бусад** now have a larger click target, label and count badge so they remain
visually above the smaller service-area row. The redundant **Миний хариуцсан**
and **+ Шууд шинэ ажил** controls were removed from the Work Board header. The
underlying governed direct-create capability remains available for a future
reviewed placement and for intake conversion; no API authority was weakened.

- Follow-up artifact ID: `20260902T161650Z`
- Final Web image:
  `sha256:d06d76ca38f04b4e720c37c0ac1fef1b962b8406f46c3e62282d7fe61a4a08f1`
- Rollback Web image:
  `sha256:37e19caeaeb7cc4b458d16a351604ed038bacbfc3a4a0d818b3696bc18c15777`
- Rollback archive SHA-256:
  `28AF04562D641E0FFE251FDFBFC8D10EA532C321825A59C140039D8350DAFC79`
- Off-device rollback directory:
  `D:\OVERVA\release-artifacts\20260902T161650Z`

The full `418/418` suite and candidate static contracts passed. Production now
serves `app.js?v=47` and `workflow.css?v=8`; external App and API returned HTTP
`200`, and every production service remained healthy. This was a Web-only
release with no migration or production business-data write.

## Configured lane-title follow-up

Commit `05ec981` is live at production schema `0098`. Service-area records now
own optional intake and team-lane titles, so selecting a specific area can
explain that area's **асуудал, хэрэгцээ → хэсгийн ажил** flow without hard-coding
Choibalsan terminology as a universal product rule. **Бүгд** retains the broad
department titles; HSE, execution, acceptance, and completed remain canonical
workflow stages.

- Release artifact ID: `20260902T162749Z`
- API image:
  `sha256:d9dbf6482e3fbabd5685fd6c99be48afa6f0d4ba2b11febda65ec74941d8c6e8`
- Web image:
  `sha256:292cd24f16652633a62f23aa996ed32b789c9bf727d4fb340682fa1b29f9b0c0`
- Migration image:
  `sha256:6939ad24a3fa4049a6a8122764791dcd75b7daa9bc431c92153a3b3ff8c4bd7e`
- Migration SHA-256:
  `61DF7F38E4415E27267BEAD5C6103B74F44D47A139C4F4FC95B10BF119F72A87`
- Rollback API image:
  `sha256:cdea349a38b66763cc1ff30aa642b8f90eeff499b8ad0fbe60b35c13f0ca2e09`
- Rollback Web image:
  `sha256:d06d76ca38f04b4e720c37c0ac1fef1b962b8406f46c3e62282d7fe61a4a08f1`
- API rollback archive SHA-256:
  `5AB2AAAD00E85658AA1C887C185BC553226684C3070054894D14C09C015F59BA`
- Web rollback archive SHA-256:
  `777DA1FA013185EE2E9E5E9F3D5A3832A110D1A7F88A5E615DC79AF1DBD73C6F`
- Off-device rollback directory:
  `D:\OVERVA\release-artifacts\20260902T162749Z`

The production-clone rehearsal applied both title checks, updated exactly five
Choibalsan records, updated zero other-tenant records, and preserved every
business invariant. Production authenticated smoke returned all five reviewed
title pairs exactly. The full `418/418` suite, session/report/CSV smoke, intake
authority smoke, public App/API checks, cache contracts `app.js?v=48` and
`workflow.css?v=9`, long-transaction check, and lock-wait check passed. Every
production service remained healthy, and the disposable rehearsal database was
removed.

- Pre-deploy backup: `overva-20260902T162822Z`
- Database SHA-256:
  `F77F7139D207AF60FBC205A0D6EE0CE372BE60D201E44D6DB73BC06E2118E634`
- Uploads SHA-256:
  `6772796C7F1845BCA700012D688DDFEDF5AC9DDA88B413358C48729DF6E4E0AE`
- Metadata SHA-256:
  `77B11F368C3C18121DE0D81DFB258214C31F0096D5A69E6531DF1CA10E15FAB5`
- Off-device backup directory:
  `D:\OVERVA\backups-production\overva-20260902T162822Z`

The backup passed checksum, PostgreSQL custom-dump, uploads archive, and
independent off-device mirror verification.
