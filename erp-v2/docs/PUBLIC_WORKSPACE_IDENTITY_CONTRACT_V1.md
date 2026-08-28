# OVERVA Public Workspace Identity Contract V1

Status: Accepted foundation  
Date: 2026-08-26

## Purpose

A public OVERVA workspace is the smallest boundary within which conversation,
files, hypotheses, confirmations, preview activity, plans, and delivery stage
may be combined. Evidence from separate organizations or separate requested
products must not be silently merged.

## Rules

1. Every browser-local checkpoint belongs to one stable workspace ID.
2. `Шинэ ажил` creates or selects an empty workspace; it does not delete the
   previous workspace.
3. The workspace selector changes the active context explicitly.
4. A materially different organization description or file triggers a human
   choice: add it to the current workspace or create a separate workspace.
5. A legacy single-checkpoint browser state is migrated into one registry item
   without changing its evidence, confirmation, preview, or execution meaning.
6. Extracted names, employee counts, activities, and other details remain
   hypotheses until a human confirms or corrects them.
7. Preview templates must label extracted understanding as preliminary. A
   generic preview is not evidence that the customer's actual product has been
   generated or executed.
8. Workspace separation does not provision a tenant, create a login, accept a
   commercial agreement, or authorize production deployment.

## Current persistence boundary

The v1 public registry is browser-local. It is suitable for guided exploration,
not multi-device durability or organizational system-of-record data. A future
server-backed registry must preserve the same workspace IDs, tenant isolation,
authorization, audit, consent, and promotion rules.
