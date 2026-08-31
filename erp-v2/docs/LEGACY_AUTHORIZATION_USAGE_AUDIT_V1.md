# Legacy Authorization Usage Audit V1

Status: accepted baseline audit; Work Orders cut over at migration `0064`

Audited: 2026-08-31 at commit `16aae69`

## Objective

Identify where OVERVA already separates employment, identity, role, permission,
workspace relevance, and process authority, and where legacy job-role checks
still participate in authorization. This baseline supports incremental migration
without weakening tenant isolation, compatibility, audit, or IoT safety.

## Already separated

- `employees` is tenant-owned workforce master data; `users.employee_id` is an
  optional one-to-one login link.
- Organization structure separates departments/units, jobs, positions,
  employee assignments, and reporting relationships.
- Tenant RBAC uses `organization_roles`, `organization_role_permissions`, and
  `user_roles`; authentication derives current permissions and system-role
  codes from PostgreSQL.
- `job_workspace_access` maps job definitions to relevant workspaces and
  explicitly does not replace RBAC.
- Platform administrators have a separate live-derived Platform RBAC model.
- Market identities, memberships, operator assignments, tokens, and audit are
  isolated from tenant and Platform authorization.

## Compatibility fields that remain active

| Field/context | Current purpose | Risk |
| --- | --- | --- |
| `users.role` | Original fixed tenant role code; still used by routes and UI compatibility | Employment-style labels can act as hidden authorization policy |
| `employees.job_role` | Workforce classification mirrored as `role` in several responses | Can be mistaken for system role or permission |
| `employees.department_id`, `position_id`, `manager_employee_id` | Compatibility mirror of the current primary assignment | Dual representation requires transactional synchronization |
| `state.user.role` in tenant UI | Legacy navigation labels and fallback visibility policy | UI visibility can appear to be authority even when server guards differ |

Compatibility fields must not be removed in one destructive migration. They
remain explicit debt until each consumer is migrated and verified.

## Route and policy findings

### Live permission/RBAC-aware paths

- `api/src/middleware/auth.js` derives tenant permissions and organization
  system roles from live assignments.
- `requirePermissions`, `requireSystemRoles`, and Platform permission guards are
  available for route enforcement.
- HR-sensitive attachments, compensation, connectors, safety, organization
  structure/import, and several administration actions already use explicit
  permissions.
- `web/workspace-policy.js` combines enabled modules, permissions, system roles,
  job workspace codes, and legacy role fallback.

### Mixed or legacy authorization paths

- `api/src/routes/attendance.js` uses fixed job-role sets for broad read and
  edit behavior.
- `api/src/routes/dashboard.js` combines system roles/permissions with fixed
  director, chief engineer, accountant, and HR codes.
- `api/src/routes/work-orders.js` no longer authorizes through fixed legacy
  role sets. Migration `0064` and `work-order-authority.js` enforce explicit
  permissions plus department/assignee/creator context. Workflow role keys
  remain stored only as inert compatibility metadata and are not consulted for
  authorization or notification routing.
- `api/src/routes/business-modules.js` includes fixed role checks in maintenance
  behavior.
- `api/src/routes/attachments.js` mixes explicit sensitive permissions with
  fixed-role exceptions for some business objects.
- `api/src/routes/iot.js` passes the legacy role code into priority authorization.
- Employee/user provisioning and Smart Import still populate compatible
  `job_role`/`role` codes.
- Tenant UI policy and labels continue to use `state.user.role` as a fallback.

## Risk order

1. **Safety-critical:** IoT priority authorization. Do not migrate until the
   replacement permission/process-authority matrix is enforced and tested at
   UI, API, server, gateway/edge, and device levels.
2. **Consequential operational:** work-order assignment, approval, completion,
   exception acceptance, and sensitive attachments.
3. **Sensitive people data:** attendance, HR-wide read/edit, compensation, and
   employee documents.
4. **Presentation/aggregation:** dashboard metrics, labels, and navigation.
5. **Compatibility creation:** employee and account bootstrap/import defaults.

## Incremental migration plan

### Stage A — Contract and tests

- Define explicit permissions and any process-specific authority for one domain.
- Build allow/deny matrices covering owner/admin, relevant job, unrelated job,
  inactive assignment, no-login employee, cross-tenant identity, and revoked
  role.
- Keep UI visibility tests separate from server authorization tests.

### Stage B — Dual evaluation without authority expansion

- Add the new policy path behind a controlled compatibility mode.
- Compare new-policy and legacy-policy outcomes in tests or redacted diagnostic
  evidence.
- A mismatch fails closed for sensitive/consequential actions; it does not grant
  the union of both policies.

### Stage C — Domain cutover

- Make explicit permission/process authority canonical for the selected domain.
- Retain compatible response labels and stored fields where older clients need
  them, but stop consulting them for the migrated authorization decision.
- Record the cutover and rollback procedure.

### Stage D — Compatibility retirement

- Remove a legacy consumer only after repository search and runtime tests show
  no authorization dependency.
- Retire stored fields only through a separate reviewed migration with data and
  rollback evidence.

## Recommended first domain

Use Asset Maintenance / Work Orders as the first vertical cutover. It already
connects employee, assignment, department, asset/operational object, work-order
states, approval, measured outcomes, attachments, and audit. It provides a real
business outcome without requiring a universal workflow rewrite.

IoT is deliberately not the first migration. Its command precedence remains
Emergency > Manual > Weather > Schedule > Default throughout all stages.

### Work Order cutover result — 2026-08-31

- Stages A–C are implemented for Work Order routes and workflow actions.
- Existing active legacy users were mapped once to explicit domain roles;
  changing a compatible account role now synchronizes those assignments.
- The API and tenant UI consult live permissions. Legacy labels remain in
  responses for display and in policy JSON for rollback compatibility, but a
  configured permission key takes precedence and a matching legacy role alone
  is denied.
- Attachment authorization and other routes listed above remain migration debt.
  IoT authorization was not changed.

## Exit criteria for each migrated domain

- No server authorization decision in the domain depends on a job-title-style
  legacy role code.
- Tenant context is server-derived and cross-tenant tests deny access.
- Revoking a live role/permission takes effect without waiting for token expiry
  where the current auth model supports live derivation.
- Workspace visibility neither grants nor hides server authority.
- Consequential state transitions produce attributable append-only evidence.
- Compatibility, migration, rollback, and production verification paths are
  documented and tested.
