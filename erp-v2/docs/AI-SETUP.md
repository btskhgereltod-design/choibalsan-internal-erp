# OVERVA AI production setup

The BA AI code is safe to deploy while disabled. It becomes active only when the API container receives an OpenAI project API key through a Docker secret.

## Security boundary

- Never paste the key into frontend code, a browser, chat, Git, `.env.production`, screenshots, or logs.
- Create a separate OpenAI project for OVERVA and set a reasonable project budget/rate limit.
- Save the key only in `secrets/openai_api_key`. The `secrets/` directory is ignored by Git.
- OVERVA calls the Responses API with `store: false`.
- The BA AI can only return a catalog proposal. It cannot execute code, query arbitrary tenant data, apply a build, or issue device commands.
- Every session, message, response and accepted/rejected proposal is tenant-scoped and audited.

## Enable

1. In the OpenAI dashboard, create an API key for the OVERVA production project.
2. On the server, create `secrets/openai_api_key` containing only that key and restrict the file to the server administrator.
3. Keep `OPENAI_MODEL=gpt-5.6-terra` and `OPENAI_REASONING_EFFORT=medium` in `.env.production`, or select another approved model deliberately.
4. Deploy using both Compose files:

   `docker compose -f docker-compose.production.yml -f docker-compose.ai.yml up -d --build migrate api web`

5. Confirm `GET /api/builder/ai/status` returns `enabled: true` for an authenticated user with `builder.manage`.

To disable AI without changing application code, deploy with `docker-compose.production.yml` only.

## Future agents

Developer AI, Design AI/Canva and Data Analyst AI are separate security zones. They must not reuse BA AI privileges. Developer changes require a sandbox, branch, tests and human approval; analytics is read-only and tenant-scoped; design output must use the OVERVA component and design-token catalog.
