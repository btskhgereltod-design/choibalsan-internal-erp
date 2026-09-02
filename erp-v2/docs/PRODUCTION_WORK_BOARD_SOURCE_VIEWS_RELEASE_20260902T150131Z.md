# Controlled production Work Board source views release — 2026-09-02

Status: **SUCCESS**

Commit `57f6c4fd3a5de2c58748177340139aacd474458a` is live on the production
API and Web at schema `0096`. This release adds source-category tabs and badges,
department-scoped intake for specialists, role-aware default views, and a
separate permission-gated management exception view. No migration ran and no
production business row was written by the rollout or its smoke checks.

## Release and rollback identity

- Release artifact ID: `20260902T145717Z`
- API image: `sha256:2aad8298369acf8676666de4de73b1705da35dff5260ae710309ba43385462bf`
- Web image: `sha256:25f1478da517da128b51d4e75f4c5482e295da2ecf344938796b71ea10fd4eb8`
- Rollback API image: `sha256:76fe2a0c24a52c0be9b58a3ba431891ea3a3439c624ab6d4c1cc0b980be5fbe3`
- Rollback Web image: `sha256:7694769dcb6ee762ce7ea347dafa1f5b401065b88b88b391a179408b9cb8f96b`
- API rollback archive SHA-256:
  `2E23CF3F03E821E1AD05CDB3C503E1C99C89F2DCCDFE0579D00E99769457F747`
- Web rollback archive SHA-256:
  `7AE0B6847B5601BC17D982CDD0011961AAFFA97178840C1DBEABECF9CB302850`
- Off-device rollback directory:
  `D:\OVERVA\release-artifacts\20260902T145717Z`

The user-review follow-up commit `af40d14e4e4e10e2402b4951becb998a9312b37a`
is also live. It renames the ambiguous team lane to **Ажил болгосон**, explains
that the next action is assignment or self-claim, and serves the segmented
filter styling under fresh cache identities `app.js?v=44` and
`workflow.css?v=6`.

- Follow-up artifact ID: `20260902T150906Z`
- Final Web image:
  `sha256:68c4faa439c8c55075f709b9fad481cbce1d897208882195d230b548a6ad87d3`
- Follow-up rollback Web image:
  `sha256:25f1478da517da128b51d4e75f4c5482e295da2ecf344938796b71ea10fd4eb8`
- Follow-up Web rollback archive SHA-256:
  `60DDEFB3B6EAEE6F0D8909A5019AD6EADA789511B31CB68C7A45C6702AEE8280`
- Follow-up off-device rollback directory:
  `D:\OVERVA\release-artifacts\20260902T150906Z`

The department-ownership wording follow-up commit
`09ab08c242818ddfb59b577edddcf85c1b2b693c` is live. In a focused lighting
view the first two lanes now read **Гэрэлтүүлгийн тасагт ирсэн** and
**Гэрэлтүүлгийн тасгийн ажил**; accepting an intake item says
**Тасгийн ажилд авах**. Intake badges expose the source's actual service area,
including road, ger-area, tower, and traffic-signal lighting, instead of only
the broad lighting domain.

- Department-view artifact ID: `20260902T152310Z`
- Final Web image:
  `sha256:96b49a66dc56c7ca424b6dc27bdc452a8ab6e2a7b85213d99739d532ea68f34b`
- Department-view rollback Web image:
  `sha256:68c4faa439c8c55075f709b9fad481cbce1d897208882195d230b548a6ad87d3`
- Department-view rollback archive SHA-256:
  `E3AB77F778BA587A0928E0397F3B3DB465F62EC1709F0BE9EB5935681A2828CC`
- Department-view off-device rollback directory:
  `D:\OVERVA\release-artifacts\20260902T152310Z`

Only API and Web were recreated with `--no-build --no-deps`. DB, Caddy, public
site, backup scheduler, and monitor were not restarted. The schema remained
`0096`, so the preserved application images are rollback-compatible.

## Verification

- Full repository suite: `417/417` passed.
- Candidate API JavaScript syntax and Web image contracts passed before
  cutover; the final Web contains `app.js?v=45` and `workflow.css?v=6`.
- Production session/report/CSV smoke passed with 25 modules and 91
  permissions; ordinary-user report access remained HTTP `403`.
- Authenticated role-scoped intake smoke returned:
  - chief engineer: organization scope, `236` items;
  - electric engineer: department scope, `206` lighting items only;
  - camera engineer: department scope, `30` camera items only;
  - ordinary worker: no triage authority and `0` intake items.
- Every specialist item resolved to the signed-in user's own department through
  the active tenant route. The create command separately revalidates the exact
  incident-domain, Work-Type, and department route server-side.
- External Home, App, API, Status, Auth, IoT, and Map returned HTTP `200`;
  Admin returned its expected HTTP `302`.
- API, Web, DB, Caddy, public site, monitor, and backup scheduler were healthy.
- Long transactions and waiting relevant locks remained zero.

Production invariants closed unchanged at 4 organizations, 25 users, 25
employees, 63 assignments, 1,715 attendance rows, 106 Work Orders, 768 Work
Order events, 103 approvals, zero structured safety reviews, 31 documents, and
32 document versions.

## Backup evidence

- Pre-deploy backup: `overva-20260902T145722Z`
- Database SHA-256:
  `68D314349E2B442C7F6561609783C134F117CCDE0BE0921E287471AF1BF3D368`
- Uploads SHA-256:
  `6772796C7F1845BCA700012D688DDFEDF5AC9DDA88B413358C48729DF6E4E0AE`
- Off-device backup directory:
  `D:\OVERVA\backups-production\overva-20260902T145722Z`

The backup passed SHA-256 verification, PostgreSQL custom-dump listing, and
uploads archive listing. Every mirrored file was independently hash-verified.
