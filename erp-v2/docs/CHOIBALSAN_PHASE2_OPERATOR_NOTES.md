# Choibalsan Phase 2 operator notes and acceptance

Date: 2026-09-01
Repository/local schema: `0086`
Last documented production schema: `0080`

## Operating boundaries

The four expandable workspaces are permission-filtered convenience views.
Backend permission and tenant checks remain authoritative. Users must not share
accounts to satisfy an approval or archive four-eyes step.

All consequential buttons wait for a successful server response. If the client
is offline or the response is unknown, retry the same command with the same
idempotency identity; do not create a second business action. The disabled
notification provider intentionally leaves outbox intent pending and never
claims external delivery.

Formal orders, responses, supporting evidence and destruction acts must first
exist in the canonical Documents registry. Legacy attachments remain readable,
but new formal evidence should be linked through the canonical picker.

No operator should fill the 21 missing employee numbers without verified source
evidence and a separately reviewed data-correction process. Empty complaint,
correspondence or archive timelines mean history is unknown—not that a synthetic
history should be entered.

## Workflow operation

- Appointment: open case → submit documents → verify each required document →
  HR review → management review → approve/return/reject → finalize with effective
  date and canonical order. Finalization may create an Employee with a null
  employee number and creates the effective primary assignment.
- Leave: submit request and routing policy → configured manager/HR review →
  approve, reject or return → resubmit/cancel as allowed. Overlapping open or
  approved periods are rejected by the server.
- Employment exit: open case with type and basis → HR review → management
  decision → complete required asset/document/access/work handover → finalize
  with canonical order. Only finalization changes the Employee lifecycle.
- Correspondence: register → assign/reassign → process → submit response →
  approve/return → send with delivery reference → close → archive transfer.
- Complaint: receive → validate/register → assign/reassign → process → response
  review → approve/return/reject → send with delivery evidence → close. Overdue
  is derived from due date and open state.
- Archive: intake → accept → retention review. Access follows request → approve
  or reject → issue → return. Disposal follows proposal → commission review →
  approve/reject → execute with immutable act → verify by another user.

## Production rollout prerequisites

Do not run these steps until a production change is explicitly authorized.

1. Export and independently verify a restorable production backup.
2. Read the live `schema_migrations` history and checksums; compare it with the
   documented `0080` authority. Stop on unrecognized drift.
3. Rehearse `0081` through `0086` against a restored production copy, including
   runtime-role grants and RLS behavior. Do not skip versions.
4. Record pre/post counts for organizations, users, employees, employee
   profiles, Work Orders, documents, correspondence and archive records. Confirm
   no employee number or historical event was backfilled.
5. Confirm the Choibalsan role/capability matrix, leave routing policy,
   retention classes, legal-hold ownership and commission membership with the
   accountable business owners.
6. Deploy the API and web assets before enabling pilot users. Run tenant,
   restricted-record, duplicate-command, concurrency and four-eyes smoke tests.
7. Keep the external notification provider disabled until a real adapter,
   credentials, retry ownership and monitoring are approved.
8. Monitor API conflict/error rates and pending/dead-letter outbox state. Use a
   forward corrective migration; never edit an applied migration checksum.

## Acceptance checklist

- [x] Expandable, accessible HR/Records/Complaints/Archive navigation
- [x] Four domain dashboards use authoritative backend counts
- [x] Six accepted source processes represented as explicit TO-BE workflows
- [x] Domain state remains authoritative; shared workflow is coordination only
- [x] Expected-version and idempotency guards on consequential commands
- [x] Server-side tenant and capability checks
- [x] Canonical document links with legacy compatibility reads
- [x] Append-only transition, delivery, disposal and audit evidence
- [x] Notification outbox intent without fabricated provider delivery
- [x] Archive legal-hold, commission, act and four-eyes gates
- [x] No destructive migration, guessed employee numbers or fabricated history
- [x] Clean migration, rerun/no-op, drift, integration and regression gates
- [x] Local data reconciliation: 21 Employees, 21 null employee numbers, 106 Work Orders
- [ ] Production backup/restore rehearsal and live schema comparison (before production)
- [ ] Business sign-off on configurable leave/retention/legal policy (before production)
- [ ] Real notification provider operational approval (optional until external delivery is required)
