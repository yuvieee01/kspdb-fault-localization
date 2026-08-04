# Deployment

## Local prerequisites

- Docker Engine 24+ (or Docker Desktop) with Docker Compose v2.
- Git.

## Local setup

```bash
git clone https://github.com/yuvieee01/kspdb-fault-localization.git
cd kspdb-fault-localization
cp .env.example .env  # optional; defaults work without it
docker compose up --build
```

Open <http://localhost:5173>. The API is at <http://localhost:4000> and the
database at `localhost:5432`. To stop, press `Ctrl+C`; use `docker compose
down` to retain data or `docker compose down -v` to remove the local database.

## Environment variables

| Variable | Required | Local default | Purpose |
|---|---:|---|---|
| `POSTGRES_USER` | No | `kspdb` | PostgreSQL user for compose. |
| `POSTGRES_PASSWORD` | No | `kspdb_dev` | Local-only PostgreSQL password; replace for hosted DBs. |
| `POSTGRES_DB` | No | `kspdb` | Compose database name. |
| `POSTGRES_PORT` | No | `5432` | Host port published for PostgreSQL. |
| `BACKEND_PORT` | No | `4000` | Host port published for Express. |
| `FRONTEND_PORT` | No | `5173` | Host port published for Vite. |
| `PORT` | No | `4000` | Internal Express listen port. Compose fixes this to 4000. |
| `SEED_IF_EMPTY` | No | `true` | Internal first-boot guard: seed only when the database has no poles. `start:docker` sets it. |
| `DATABASE_URL` | Yes outside compose | — | Prisma PostgreSQL connection string. Render supplies it from its database. |
| `ANTHROPIC_API_KEY` | No | empty | Enables AI briefings. Empty/missing uses deterministic fallback. Never commit it. |
| `ANTHROPIC_MODEL` | No | `claude-3-5-haiku-latest` | Anthropic model used for on-demand briefings. |
| `VITE_API_BASE_URL` | Required for split hosting | empty | Public HTTPS API origin for a separately hosted static frontend. Empty keeps same-origin compose proxying. |

`.env` is gitignored; `.env.example` contains placeholders only.

## Render free-tier blueprint

`render.yaml` defines a Docker API service, static React site, and Render
Postgres database. In Render, create a new Blueprint from this repository:

```bash
# Optional, from a workstation with the Render CLI installed
render blueprints validate ./render.yaml
```

During creation, Render prompts for `ANTHROPIC_API_KEY` and
`VITE_API_BASE_URL` because they are `sync: false`. Leave the key blank to use
the deterministic briefing fallback. After the API service is live, set
`VITE_API_BASE_URL` on the static site to its public URL, for example
`https://kspdb-fault-localization-api.onrender.com`, and redeploy the static
site. Render gives both web services public `onrender.com` URLs; copy the
static-site URL into README’s Public URL placeholder.

The backend runs `prisma migrate deploy` and seeds only when the database has
no poles. It therefore satisfies first-deploy usability without erasing
persistent telemetry on later restarts.

## Verification

```bash
curl -fsS http://localhost:4000/api/health
curl -fsS http://localhost:4000/api/network
```

The health request returns `{"status":"ok",...}`. The network response
contains seeded poles and transformers. In the console, send a heartbeat
baseline, inject a simulator span fault, and observe a ticket within the
12-second localization interval; repair it and observe verification.

## Troubleshooting

| Symptom | Cause observed during development | Fix |
|---|---|---|
| `bind: address already in use` on 5432/4000/5173 | Another local Postgres or dev server owns the published port. | Stop that process or override `POSTGRES_PORT`, `BACKEND_PORT`, or `FRONTEND_PORT` in `.env`. |
| Backend resets/refuses connections shortly after `compose up` | Express starts only after `prisma migrate deploy` and seed finish, while Postgres healthcheck is still settling. | Wait for `[backend] listening on port 4000`; do not call the API during migration. `depends_on` waits for DB health. |
| Migration/seed race or empty UI | The frontend can load before the backend has seeded its first database. | Wait a few seconds, then refresh; startup now seeds only an empty database and logs the count. |
| API works locally but deployed static UI has failed requests | A split static site cannot use the compose-only `backend` hostname. | Set `VITE_API_BASE_URL` to the deployed API HTTPS origin and redeploy the static site. |
| Briefing shows deterministic fallback | `ANTHROPIC_API_KEY` is missing, invalid, timed out, or provider returned an error. | This is expected-safe behavior; configure the key in the host dashboard only if AI text is desired. |
| A simulated scheduled outage shows expected records | Expected/suppressed records are intentionally visible, not silently dropped. | Confirm the ticket list reports zero **active** tickets; after `end + 40 min`, persistent darkness re-escalates. |

## Security check

Before any push or deployment, run:

```bash
git log --all -p | rg -n -i 'sk-ant-[A-Za-z0-9_-]{20,}'
```

Expected result: no API-key value. `ANTHROPIC_API_KEY` variable names and
empty placeholders are safe; a value is not. If a value was ever committed,
rotate it and rewrite the exposed history before deployment.
