# OVERVA demo human-workflow E2E report — 2026-09-05

## 1. Objective

Verify one human, multi-role operational chain in the isolated OVERVA demo from
canonical object history and fault intake through Work execution, HSE,
materials, acceptance, dashboards, tenant/RBAC denial and append-only audit.
Every synthetic name used the `E2E-20260905-` prefix.

## 2. Environment and data boundary

- Demo UI/API: `localhost:4200`, database `erp_v2`, final schema `0111`.
- Production: read-only verification only; database `overva`, schema `0110`.
- Production prefix check after the rehearsal: Work `0`, Incident `0`.
- Production health: loopback and `https://app.overva.com/health` both HTTP 200.
- Pre-work backup: `overva-20260904T115153Z`, verified.
- Final demo backup: `overva-20260904T125340Z`, dump/uploads/metadata verified.

## 3. Participants and authority

Each run used 11 separate Employee/User pairs: lighting reporter, lighting
coordinator, electrical engineer/Work owner, electrical executor, HSE reviewer,
chief engineer, storekeeper, accountant, director/management, camera engineer
and camera executor. Reporter/coordinator/engineer, HSE, management,
storekeeper, accountant and worker permissions were asserted separately.

The demo had no job-workspace mappings. The repository's canonical
`choibalsan-pilot` profile was dry-run and then applied only to the demo,
creating 34 audited mappings. Account creation through both supported routes now
grants consistent current operational roles. Workers remain named participants,
not authorization owners. All 99 temporary login accounts created across retry
runs were deactivated after reconciliation; no passwords or tokens are retained
  in this report. Across the final and diagnostic retry runs, 110 temporary
  accounts were created and all were deactivated.

## 4. Steps executed

1. Loaded dossiers for road, ger-area and tower lighting, a traffic-signal
   Asset and a camera object.
2. Reported a two-row lighting fault batch; replayed the same command; rejected
   a changed payload under the same idempotency key; added a repeat fault; and
   cancelled a mistaken saved fault with reason/version/idempotency evidence.
3. Proved cross-domain Work routing fails, then created one lighting Work with
   distinct system owner, responsible Employee and executor. Duplicate Work
   creation failed; two further Incidents attached as exact scope rows.
4. Proved a chief engineer cannot perform HSE review. HSE returned the start,
   then authorized it with hazards, controls, PPE, checklist and expiry.
5. Requested three lamps, approved two, issued two, recorded one consumed and
   returned one unused lamp. Issue and return retries were replay-safe.
6. Recorded a `2 = 1 completed + 1 unresolved` outcome, accepted a reasoned
   follow-up, suspended and re-authorized HSE after scope changed, then completed
   HSE and management acceptance.
7. Confirmed unrelated Incidents resolved with the source Work while the partial
   Incident stayed in progress. The one-unit follow-up inherited participants
   and only its represented Incident; completing it resolved the exact remainder.
8. Repeated the governed flow for camera and loaded the management dashboard.
9. Reconciled all retry artifacts, cancelled orphan Incidents rather than
   deleting them, deactivated test accounts and created a final verified backup.

## 5. Expected result

No consequential stage is skippable; quantities reconcile exactly; retries do
not duplicate writes; distinct people retain distinct authority; follow-up work
keeps only unresolved truth; every write is tenant-scoped and attributable; and
the final operational/dashboard state agrees with source records.

## 6. Actual result

Final canonical run `E2E-20260905-ROLE10` passed all A–J assertions, including
the negative proof that management closure is blocked until material return is
reconciled:

- Lighting Work: `cf0538fc-98a9-44d8-84a1-352aa66e3108` — completed.
- Exact follow-up: `ca17cccd-bcc2-47c7-a13e-0dbd0c960066` — completed.
- Camera Work: `e3afe3eb-ae2b-4c92-bae7-06deead69035` — completed.
- Material request: `d86703b8-bfc5-465f-bb8b-48a341c5bce4` — reconciled.
- Stock: `10` before issue, `8` after issue, `9` after one-unit return.
- Five final Incident IDs are recorded in `artifacts-e2e-role09.json` during the
  local run; four operational faults resolved and the intentional mistake is
  cancelled.
- Final prefix state: 37 resolved, 14 cancelled, 0 open/in-progress Incidents;
  0 unfinished synthetic Work Orders. Retried runs remain identifiable evidence.
- Repository tests: 492 passed, 0 failed, 0 skipped.
- Clean migration rehearsal: 111/111 migrations through `0111`; disposable
  `overva_rehearsal_e2e0111` database removed afterward.

## 7. Inconsistencies found

- P1: newly provisioned specialist roles lacked the current operational Incident
  grants, and the two access-creation paths did not agree.
- P1: the demo tenant had zero job-workspace mappings, making camera specialists
  receive 403 despite their API permission.
- P1: Incident-to-Work conversion did not create measurable scope.
- P1: a follow-up copied every Incident linked to a multi-fault source Work,
  rather than only the Incident represented by the unresolved scope row.
- P1: issued material had no partial-consumption/unused-return state or command.
- Test-harness findings: HSE correctly invalidated a permit after scope changed;
  the rehearsal was reordered to re-authorize against the final scope snapshot.
- Infrastructure finding: C: exhausted physical space and Docker's ext4 volume
  remounted read-only during an image build. Docker was restarted, its build
  cache was pruned, services recovered, and all three health paths were checked.

## 8. Severity

No P0 remained. The five P1 product/configuration gaps above were corrected in
the demo/source. The host C: free-space condition remains a P1 operational risk
for future builds even though Docker is healthy now.

## 9. Corrections applied

- Unified managed role assignment in `users.js` and `employees.js`.
- Applied the existing audited pilot job-workspace profile to the demo only.
- Added atomic Incident-origin scope and exact follow-up Incident filtering.
- Added migration `0111`, material partial-consumption and exact-return APIs,
  stock/audit events, finance projection and storekeeper/Work UI controls.
- Added regression tests plus reusable full-run, read-audit and recovery scripts.
- Preserved and reconciled every saved test record; no business evidence was
  physically deleted.

## 10. Remaining risks

- Migration `0111` and these source changes are not deployed to production.
- The rehearsal used API-level browser-equivalent commands and static UI
  contract/syntax tests; it did not perform pixel-level browser automation or
  printer/PDF visual comparison.
- Traffic-signal history uses the canonical Asset dossier while the other four
  categories use Operational Object dossiers; this separation is intentional.
- C: has critically low free space. A 14.012 GB old Codex session was copied to
  `D:\codex-session-archive\2026\08\19`, but the locked source was not deleted,
  so no host-space recovery is claimed.

## 11. Readiness conclusion

**GO for continued isolated demo/pilot use. NO-GO for production deployment
without a normal migration/release review.** The intended end-to-end business
flow is complete in demo, all generated work is reconciled, tests pass and the
final backup is verified. Production remains healthy and unchanged.

## 12. Test artifacts and cleanup

- Final run evidence: `artifacts-e2e-role10.json` (`ROLE09` is retained as the
  immediately preceding passing run before the close-before-return assertion).
- Category/count audit: `artifacts-e2e-read-audit.json`.
- Full test log: `artifacts-e2e-tests.log` (ignored local artifact).
- Reusable scripts:
  `api/scripts/demo-human-workflow-e2e.js`,
  `api/scripts/demo-e2e-read-audit.js`, and
  `api/scripts/demo-e2e-recover-incomplete.js`.
- Immutable local images:
  `overva-local-demo-api:e2e-20260905-source-final`,
  `overva-local-demo-web:e2e-20260905-source-final`,
  `overva-local-demo-api:e2e-20260905-runtime-final`, and
  `overva-local-demo-web:e2e-20260905-runtime-final`.
- Cleanup state: no deletes; all incomplete Works completed, orphan saved
  Incidents cancelled with reasons, and all synthetic login accounts inactive.
