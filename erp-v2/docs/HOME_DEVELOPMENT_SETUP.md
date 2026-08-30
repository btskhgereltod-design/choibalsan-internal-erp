# OVERVA Home Development Setup

This guide prepares a new Windows computer for local OVERVA development without
copying production credentials, production data, or private customer data.

## What moves through GitHub

GitHub carries source code, migrations, tests, documentation, and safe example
configuration. It intentionally does not carry `.env`, Docker secret values,
Cloudflare configuration, production backups, uploads, or databases.

Every development computer gets its own local database and its own generated
JWT and bootstrap passwords. Google OIDC, outbound email, SMS, and OpenAI remain
disabled for the basic local stack. Those integrations are not required to run
the tenant UI and API.

## First setup on the home computer

Open the cloned repository in VS Code, open a PowerShell terminal, and run:

```powershell
cd erp-v2
powershell -ExecutionPolicy Bypass -File .\ops\initialize-development-env.ps1
docker compose up -d --build --wait
docker compose ps
```

Then open:

- tenant UI: `http://localhost:4100`
- direct API health check: `http://localhost:4101/health`

The generated local tenant login uses organization `local-overva` and email
`admin@local.overva`. The local Platform login uses `platform@local.overva`.
Their unique passwords are stored only in `erp-v2/.env`. Copy a password
directly from that local file when signing in; never paste it into Codex chat,
GitHub, email, documentation, or a screenshot.

The initializer refuses to overwrite an existing `.env`. If `.env` already
exists, inspect its variable names locally and preserve it. Do not delete or
rotate it merely to rerun setup, because an existing Docker database may have
been bootstrapped with its current passwords.

## Prompt for Codex on the home computer

Paste this into the home computer's Codex chat after opening the repository:

```text
OVERVA-ийн гэрийн local development орчныг үргэлжлүүлэн бэлд.

Эхлээд root AGENTS.md, erp-v2/AGENTS.md, erp-v2/docs/CURRENT_STATE.md,
erp-v2/docs/DECISIONS.md, erp-v2/docs/ARCHITECTURE.md болон
erp-v2/docs/HOME_DEVELOPMENT_SETUP.md-ийг бүрэн унш.

Дараа нь:
1. git status, current branch, origin/main-тай синк эсэхийг шалга.
2. Working tree цэвэр бөгөөд main нь origin/main-аас хоцорсон бол
   git pull --ff-only origin main ажиллуул. Local өөрчлөлт байвал бүү дарж
   бич; зогсоод надад тайлагна.
3. Git, Docker Desktop болон Docker Compose ажиллаж байгааг шалга.
4. erp-v2/.env байхгүй бол зөвхөн
   powershell -ExecutionPolicy Bypass -File .\erp-v2\ops\initialize-development-env.ps1
   командыг ажиллуул.
5. Production secret бүү асуу, бүү хуул, бүү хэвлэ.
6. Google OIDC, SMS, email болон AI-г local орчинд disabled хэвээр үлдээ.
7. erp-v2 дотроос docker compose up -d --build --wait ажиллуул.
8. docker compose ps, API health болон http://localhost:4100 UI-г шалга.
9. Production deploy, production DB, Cloudflare болон production secret-д бүү хүр.
10. Хамааралгүй working-tree өөрчлөлтүүдийг хадгал.

Эцэст нь юу ажилласан, local URL-ууд, хэрэв блоклогдсон бол яг ямар
non-secret prerequisite дутуу байгааг тайлагна.
```

## Normal two-computer rhythm

Before starting work on either computer:

```powershell
git status
git pull --ff-only origin main
```

Before leaving that computer, review the exact files, commit only intended
changes, and push. Never use Git as a secret or database synchronization tool.

## Boundaries

- Never point the home `DATABASE_URL` at production or the legacy Choibalsan DB.
- Never copy production `.env.production`, Docker secret files, backups, or
  customer uploads to an ordinary development computer.
- Never commit `.env`; the repository ignore rules already exclude it.
- Do not run production Compose overlays from the home computer.
- A local database is disposable development state, not a production replica.
