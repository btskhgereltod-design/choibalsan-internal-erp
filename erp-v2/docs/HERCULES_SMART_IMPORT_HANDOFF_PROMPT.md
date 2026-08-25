# Hercules-д өгөх дараагийн prompt

Доорх prompt-ийг **Review/Debug mode**-д ажиллуулна. Build mode ашиглахгүй.

```text
Do not add features and do not rebuild the app.

Prepare a handoff report for the current "Import Review Prototype v4" so it can be
reviewed and selectively integrated into an existing production OVERVA repository.
This Hercules app remains a UX reference only.

Inspect the current code and return:
1. Exact changed-file list for the import review feature.
2. Route list and route entry points.
3. Component dependency tree.
4. External package dependencies introduced by this feature.
5. Mock/local-state files and every hard-coded fixture.
6. All types/interfaces used for rows, buckets, edits and filters.
7. Test/typecheck/build commands run and their exact results.
8. Known bugs, incomplete states and accessibility issues.
9. A compact mapping of each acceptance criterion to the file/function that implements it.
10. Export instructions that preserve source files without publishing or deploying.

Important semantic warning:
- Create/Update/Skip are proposed actions.
- Needs Review is a human review state.
- Reject is a validation failure.
- These are not one production database status field.

Do not create a production backend, database, authentication, tenant management,
Convex schema, deployment configuration or real API integration. Do not publish.
Do not use real organization or employee data. Stop after the handoff report.
```

Handoff report гарсны дараа source export-ийг OVERVA repository-ийн production
contract-той Codex талд тулгаж, хэрэгтэй component-уудыг сонгон авна.
