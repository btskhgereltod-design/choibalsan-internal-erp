# Controlled production unified work intake release — 2026-09-02

Status: **SUCCESS**

The generic operational intake and seven-stage Work Board from commit
`f4c2500ae20bc1eb639eef466e88f5474bbbfb74` are live at schema `0095`.
The evidence-bound legacy projection correction from commit
`d701ddc` and the chief-engineer standard-review display fix from commit
`3137bc0` also completed. No rollback stop condition fired.

## Release and rollback identity

- Product release artifact ID: `20260902T132602Z`
- Product API image:
  `sha256:2c2b267716f3074dcef180e36df42e752166edae692dbd070a2a40aeb47aafb2`
- Product migration image:
  `sha256:f1373059f5b38535b72f6442d70ed361ecbdd587ae9c9c071f778ee8115e08ea`
- Initial product Web image:
  `sha256:312b60fef068fed9c07f2b2defc249318c904e0d6eb28451d18f23563208f61a`
- Migration `0095` SHA-256:
  `e9f33bdde7a537b3eca4e002c7e5ca35739cd2599e4b0f7a6380a0a9402a27e4`
- Chief-engineer Web fix artifact ID: `20260902T135130Z`
- Final Web image:
  `sha256:9266df73fc2e1344717cf0378cb4a2eb482cf4734f8f51de69580e097d1c35d1`
- Final Web rollback archive:
  `D:\OVERVA\release-artifacts\20260902T135130Z\web-rollback-20260902T135130Z.tar`
- Final Web rollback archive SHA-256:
  `FF3E899AED9B0295434B5BBC114C5B59EEF882D8F9E85FFBF4F48E914D9658EE`

The product release also preserved the prior API and Web rollback images and
off-device archives under `D:\OVERVA\release-artifacts\20260902T132602Z`.

## Migration and intake result

Migration `0095` applied in one bounded production transaction and refreshed
runtime grants. The tenant-scoped coordination table has active RLS, one active
policy and its append-only trigger. Runtime can select and insert but cannot
update, delete or truncate it. No incident-to-Work-Order link was fabricated.

Authenticated read-only smoke returned 236 unresolved intake records to the
Choibalsan triage authority and returned zero records to an ordinary user. These
are source issues and needs, not 236 active Work Orders. Same-object active-work
warnings and direct-link duplicate prevention remain enabled.

## Legacy Work Order reconciliation

The production correction read all 106 rows directly from the legacy SQLite
source through the read-only exporter. A default rollback dry-run and the
explicit apply used the exact same payload with SHA-256
`c0cac6f6f8cee36cebe090b8f776797cd09f4f11b593b601cfa8bf03d57ff049`.
The apply required both `--apply` and the environment gate, locked the tenant
and every target Work Order, and committed one transaction.

The resulting board is:

| Stage | Work Orders |
| --- | ---: |
| Chief-engineer decision | 17 |
| HSE start review | 4 |
| Execution | 2 |
| HSE completion review | 4 |
| Chief-engineer acceptance | 17 |
| Completed | 62 |

Work type routing is camera repair 28, lighting repair 59, traffic-signal
repair 4 and general/unrouted 15. The fifteen unrelated fleet, facilities,
fence, cleaning and other organization-wide tasks retain their legacy category
but no longer carry the incorrect lighting department or HSE policy.

Exactly 106 checksum-bearing append-only reconciliation events were added, one
per Work Order, and one aggregate audit row was added. There are no duplicate
reconciliation events. Existing source mappings remained 106 with fingerprint
`a14028b391bd8e3aec0d0e9999512039`. Work Order approvals remained 103 and
structured safety reviews remained zero, so no historical human decision was
invented.

## Verification and invariants

- Full repository suite: `411/411` passed.
- Authenticated production Work Board smoke returned the exact six counts above.
- Chief-engineer operations center returned all 17 management decisions.
- Session/report/CSV smoke passed with 25 modules and 91 permissions; ordinary
  user report access remained HTTP `403`.
- API, Web, DB, Caddy, public site, monitor and backup scheduler were healthy.
- Public site, App, API and Status returned HTTP `200`.
- The public App shell served `engineering.js?v=3`.
- The old assignment Phase-A release-contract smoke is intentionally pinned to
  schema `0080` and is not a valid `0095` release smoke; its invocation was
  rejected on that explicit schema guard without a write.

Production closed with 4 organizations, 25 users, 25 employees, 63 assignments,
1,715 attendance rows, 106 Work Orders, 768 Work Order events, 31 documents and
32 document versions. The increase from 662 to 768 Work Order events is exactly
the 106 intentional append-only reconciliation records. Long transactions and
waiting locks were zero.

## Backup evidence

- Product pre-deploy backup: `overva-20260902T132730Z`
- Product post-deploy backup: `overva-20260902T133244Z`
- Pre-reconciliation backup: `overva-20260902T134425Z`
  - database SHA-256:
    `9794307D1E54A3BE1E2A5A9DC367495DE5133BC9DCD700D05BB9B446954AB832`
- Final post-reconciliation backup: `overva-20260902T135313Z`
  - database SHA-256:
    `B1D401A60AA567F53CCC74011B8F13C494995C8B089070847C979119C9BF012C`
  - uploads SHA-256:
    `6772796C7F1845BCA700012D688DDFEDF5AC9DDA88B413358C48729DF6E4E0AE`

Every named backup passed checksum validation, PostgreSQL custom-dump listing
and uploads archive verification. The pre- and post-reconciliation backups were
copied to `D:\OVERVA\backups-production` and independently hash-verified.
