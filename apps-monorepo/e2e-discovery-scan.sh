#!/usr/bin/env bash
set -euo pipefail

echo "== Prerequisites =="
if [ -z "${REDIS_URL:-}" ]; then
  echo "ERROR: REDIS_URL is not set. Paste your Upstash RESP URL into the repo .env first."
  exit 1
fi
if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_ANON_KEY:-}" ]; then
  echo "ERROR: Supabase config missing. Set SUPABASE_URL + SUPABASE_ANON_KEY (or SERVICE_ROLE_KEY) in .env."
  exit 1
fi

echo "== Starting API on :5100 =="
pnpm --filter @jobsearch/api dev &
API_PID=$!

echo "== Starting discovery workers =="
pnpm --filter @jobsearch/workers start:discovery &
WORKER_PID=$!

cleanup() {
  echo "== Shutting down =="
  kill "$API_PID" "$WORKER_PID" 2>/dev/null || true
  wait "$API_PID" "$WORKER_PID" 2>/dev/null || true
}
trap cleanup EXIT

echo "== Waiting for API to boot =="
for i in $(seq 1 20); do
  if curl -fsS http://localhost:5100/health >/dev/null 2>&1; then
    echo "API is up."
    break
  fi
  sleep 1
done

echo "== Triggering discovery scan =="
RES=$(curl -sS -X POST http://localhost:5100/api/discovery/scan \
  -H 'Content-Type: application/json' \
  -d '{"boards":["vercel"],"keywords":"engineer"}')
echo "$RES"

QUEUE_JOB_ID=$(echo "$RES" | node -pe 'JSON.parse(require("fs").readFileSync("/dev/stdin","utf8")).queueJobId')
echo "queueJobId=$QUEUE_JOB_ID"

echo "== Waiting for processing (up to 90s) =="
for i in $(seq 1 90); do
  COUNT=$(curl -sS http://localhost:5100/api/jobs?status=discovered | node -pe 'JSON.parse(require("fs").readFileSync("/dev/stdin","utf8")).jobs.length')
  echo "discovered count=$COUNT"
  if [ "$COUNT" -gt 0 ]; then
    echo "Rows discovered in job_listings."
    break
  fi
  sleep 1
done

echo "== Last 5 discovered listings (API) =="
curl -sS "http://localhost:5100/api/jobs?status=discovered&limit=5" | node -pe 'JSON.stringify(JSON.parse(require("fs").readFileSync("/dev/stdin","utf8")).jobs.slice(0,5), null, 2)'

echo "== Queue health =="
curl -sS http://localhost:5100/api/queue/health | node -pe 'JSON.stringify(JSON.parse(require("fs").readFileSync("/dev/stdin","utf8")), null, 2)'

echo "== Agent runs (last 5) =="
curl -sS "http://localhost:5100/api/agent/runs?limit=5" | node -pe 'JSON.stringify(JSON.parse(require("fs").readFileSync("/dev/stdin","utf8")).runs.slice(0,5), null, 2)'

echo "== Done =="
