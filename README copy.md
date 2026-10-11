# VayuMarg (वायुमार्ग)

Serverless routing that minimises **PM2.5 inhalation** for commuters and school buses. Candidate route
polylines are mapped onto **H3 resolution-8** hexagons, each hexagon's live PM2.5 is read from DynamoDB, and
every route gets a **Cumulative Inhaled Dosage**:

```
Dosage = Σ ( PM2.5 × Δt_hours × VentilationMultiplier )      walking 1.6 · two_wheeler 1.2 · school_bus 0.8
```

Δt for each ~150 m slice of a route is its share of the trip duration. The result is a relative index
(µg·h/m³, ventilation-weighted) for comparing routes, not a medical dose.

## Architecture

```
EventBridge (rate 3h) ─► IngestFunction ─► DynamoDB  (PK: H3 cell, TTL attr: ttl)
                          OpenAQ v3 / CPCB stations       ▲
                          or simulated demo data          │ BatchGet
React (Vite) ─► HTTP API ─► POST /score  (ScoreFunction) ─┤
                         └► GET  /air    (AirFunction)  ──┘
```

| Path | Purpose |
|---|---|
| `template.yaml` | SAM: DynamoDB (on-demand, TTL), HTTP API (throttled), 3 Lambdas (Node 20, arm64, esbuild ESM), EventBridge schedule, 7-day log retention |
| `backend/src/lib/scoring.js` | Validation → H3 mapping → dosage → recommendation + school alert |
| `backend/src/lib/airfield.js` | Tile lookup; gaps filled by 1/ring² neighbour interpolation, then request-mean imputation (flagged in `coverage`); 503 if there is no data at all |
| `backend/src/lib/ingest.js` | Station readings → H3 cells (inverse-distance spread over 4 rings), TTL 8 h |
| `backend/src/repo/` | `DynamoRepo` (batch get/write with backoff, filters TTL-expired items) and `MemoryRepo` |
| `backend/src/local/server.js` | Local API on :3001 using the same handlers + in-memory tiles (no Docker/AWS) |
| `frontend/` | React dashboard: map with H3 hexes, duration-vs-dose chart, route cards, live recommendation, threshold banner |

### API

`POST /score`
```json
{ "mode": "school_bus", "alertThreshold": 60, "maxDetourMinutes": 15,
  "routes": [ { "id": "a", "name": "Main road", "coordinates": [[28.52,77.20],[28.52,77.15]] },
              { "id": "b", "polyline": "<encoded polyline5>", "durationSeconds": 1500 } ] }
```
Returns per-route `durationMin`, `dosage`, `avgPm25`, `peakPm25`, `coverage` (direct / neighbor / imputed share), H3 `cells`,
`vsFastest`, plus `recommendedId`, `fastestId`, `cleanestId`, and `alert`. `durationSeconds` is optional; otherwise
distance ÷ mode speed (5 / 28 / 22 km/h) is used.

`GET /air?lat=28.52&lng=77.20&threshold=60` returns PM2.5 for the hexagon at a point (e.g. a school gate).

## Prerequisites

Node 20+, AWS CLI configured (`aws configure`), [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html).

## 1. Test locally (no AWS needed)

```bash
cd backend
npm install
npm test                      # unit tests (dosage maths, ranking, alerts, fallbacks, ingest)
npm run dev                   # API on http://localhost:3001, seeded with SIMULATED tiles

# in a second terminal
cd frontend
npm install
cp .env.example .env          # VITE_API_URL=http://localhost:3001
npm run dev                   # http://localhost:5173
```

Quick API check:
```bash
curl -s -X POST localhost:3001/score -H 'content-type: application/json' \
  -d '{"mode":"school_bus","routes":[{"id":"a","coordinates":[[28.5245,77.2066],[28.52,77.1576]]}]}'
```

To use real data locally: `OPENAQ_API_KEY=<key> npm run dev` (free key at <https://explore.openaq.org>).

## 2. Deploy to AWS

```bash
cd backend && npm install && cd ..          # esbuild is a devDependency used by `sam build`
sam validate --lint
sam build
sam deploy --guided
```
Suggested answers: stack name `vayumarg`, region `ap-south-1`, `OpenAqApiKey` = your key (or empty for simulated
data), `Cities` = `delhi,mumbai,bengaluru`, `AllowedOrigin` = `*` for the demo (restrict later), allow SAM to create IAM
roles, "Save arguments to samconfig.toml" = yes.

Seed tiles immediately instead of waiting for the first cron tick:
```bash
FN=$(aws cloudformation describe-stacks --stack-name vayumarg --query "Stacks[0].Outputs[?OutputKey=='IngestFunctionName'].OutputValue" --output text)
aws lambda invoke --function-name "$FN" --cli-binary-format raw-in-base64-out /dev/stdout
```

Smoke-test the deployed API:
```bash
API=$(aws cloudformation describe-stacks --stack-name vayumarg --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text)
curl "$API/air?lat=28.6139&lng=77.2090"
```

## 3. Point the frontend at AWS

```bash
cd frontend
echo "VITE_API_URL=$API" > .env
npm run dev          # or: npm run build  → static files in dist/ (host on S3 / Amplify / any static host)
```
Once hosted, redeploy with `AllowedOrigin` set to your site's origin.

Tear down: `sam delete --stack-name vayumarg`.

## Notes and caveats

- **Free-tier reality check.** Lambda, HTTP API, EventBridge and CloudWatch usage here is tiny. DynamoDB
  `PAY_PER_REQUEST` is *not* covered by the always-free 25 WCU/RCU (that applies to provisioned capacity), but it is
  billed per request. At defaults (3 cities, every 3 h, ~4k tiles per run) that is about 1M writes a month, so
  roughly **a dollar a month**. Use `Cities=delhi` or `IngestSchedule='rate(6 hours)'` to cut it further.
  Check current pricing for your region and your account's free plan or credits.
- **Simulated data.** With no `OpenAqApiKey`, ingest writes deterministic *simulated* PM2.5 (tagged
  `source: synthetic`; the UI shows a notice). Never use it for real decisions.
- **OpenAQ ingest** targets the v3 API (`/locations` + `/locations/{id}/latest`, `X-API-Key` header, PM2.5 parameter id 2).
  It was written from the docs and **not yet run against the live API**; check one invocation's CloudWatch log after deploy.
- **Routing** in the demo UI uses public OSRM servers (rate-limited, light use only). For production use your own OSRM or
  Amazon Location Service. If routing is unreachable the UI falls back to labelled *illustrative* paths.
- Interpolated or imputed tiles are reported in each route's `coverage` and flagged in the UI.
