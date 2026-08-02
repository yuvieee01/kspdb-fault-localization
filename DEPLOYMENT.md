# Deployment

Written for someone who has this repo and nothing else.

## Prerequisites
<!-- Docker version, Docker Compose version, anything else, with actual
version numbers tested against. -->

## Environment variables
<!-- Table: name, what it does, required?, safe default. Every var must
also appear in .env.example. -->

| Variable | Purpose | Required | Default |
|---|---|---|---|
| | | | |

## Commands
<!-- Exact, copy-pasteable, in order. -->
```bash
git clone <repo-url>
cd fault_localization
docker compose up
```

## How to verify it worked
<!-- What URL to open, what you should see (seeded network, working
console, etc). -->

## Troubleshooting
<!-- Not optional. List failure modes actually hit while building/deploying:
port conflicts, migrations racing the database, ARM vs x86 image issues,
free-tier memory limits, CORS, WebSocket/proxy issues (if applicable), cold
starts. For each: symptom -> fix. Fill this in as you actually hit these,
don't invent generic ones at the end. -->

## Reset to a clean state
<!-- e.g. docker compose down -v && docker compose up -->