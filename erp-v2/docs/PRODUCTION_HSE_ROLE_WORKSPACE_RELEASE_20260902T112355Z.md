# Controlled production HSE role-workspace release — 2026-09-02

Status: **SUCCESS**

Commit `fb7fcb7349f128931b848835a4d9276bf8385470` was deployed as a
web-only release through the Cloudflare-overlay production Compose path. The
release restores a task-focused **Миний ХАБЭА ажлын талбар** over the existing
canonical Work Order and immutable safety-review authorities. No API image,
migration, schema, database, upload or public-site deployment was performed.

## Release identity

- Release and rollback artifact ID: `20260902T112355Z`
- Previous Web image:
  `sha256:6e208866de7ef5905d9b3c5618c406a832fd910019515960b9ef06883a9ce5b3`
- Candidate and deployed Web image:
  `sha256:a3c056ccaea30fcef5674927d8d72cada9135b856be8ea75660e128106bed370`
- Unchanged API image:
  `sha256:e818bd2f9b1c187a407678849fb72cb8ae31c71705102369276c6c93f71275d2`
- Rollback tag:
  `overva-production-web:rollback-20260902T112355Z`
- Candidate tag:
  `overva-production-web:candidate-fb7fcb7-20260902T112355Z`

The prior Web image was pinned before candidate build and exported to
`release-artifacts/20260902T112355Z/web-rollback-20260902T112355Z.tar`.
The archive size is `29,658,112` bytes and its SHA-256 is
`57E31CE672342BE98EF723572FF0FC32C6B78020F259DD960A2069F7863FFBE9`.
It was mirrored to the access-controlled
`D:\OVERVA\release-artifacts\20260902T112355Z` directory and the independent
mirror hash matched.

## Candidate and deployment gates

- The repository suite passed `404/404`; API and all browser JavaScript syntax
  checks passed before release.
- The candidate Web image built from the reviewed commit. Its index referenced
  both versioned HSE workspace assets; the JavaScript contained the real tabs,
  governed Work Order action/history hooks and filters; the CSS asset and nginx
  configuration passed inspection.
- Production preflight confirmed the accepted prior API/Web image identities,
  schema `0094`, healthy services and HTTP `200` for Site, App, API and Status.
- The latest scheduler backup `overva-20260902T102759Z` passed database dump,
  uploads archive and metadata checksum verification before and after rollout.
- Compose recreated only `overva-production-web-1` with `--no-build --no-deps`.
  The API, database, migration, Caddy, public site, monitor and backup scheduler
  were not recreated.

## Post-deploy result

- The deployed Web container became healthy on the exact candidate image.
- Public App index and the two new versioned assets returned HTTP `200`; their
  content matched the HSE workspace contract. Site, App, API and Status each
  returned HTTP `200`.
- The deployed release check passed 94 migrations, 25 active modules,
  canonical employee links, frontend shell checks and zero orphan test events.
- Authenticated session, management report and CSV smoke passed; an ordinary
  user remained denied with HTTP `403`.
- Explicit Choibalsan safety overview smoke passed with 93 risks, zero incidents
  and one briefing. The first invocation omitted the required smoke tenant slug
  and stopped before querying the tenant; rerunning with the reviewed
  `choibalsan-hugjil` slug passed. Neither invocation wrote business data.
- Production remained at 4 organizations, 25 users, 25 employees, 63
  assignments, 1,715 attendance rows, 106 Work Orders, 662 Work Order events,
  31 documents and 32 document versions. Schema remained `0094`.
- Web, API, monitor, backup scheduler, public site, Caddy and database were all
  healthy. Rollback was not invoked.

This release changes presentation and interaction only. Existing tenant
authorization, HSE permissions, canonical Work Order workflow, structured
safety-review evidence, audit behavior and server-side data boundaries remain
authoritative.
