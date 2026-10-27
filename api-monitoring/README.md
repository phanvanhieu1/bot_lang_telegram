# Shared API Monitoring (V1)

This module is a **multi-project** monitoring receiver and admin dashboard.
Translator requests are an initial producer, not the database's only project.

## Start

1. Run the application's normal `npm install` and `npm start`.
2. Log in with an existing **admin** account.
3. Open `/admin/monitoring` (also linked in the translator's admin menu).
4. The first charts are empty until real API calls or external events arrive.
5. Provider quota polling starts after MongoDB connects; no extra cron is required.

No live balances or request results are fabricated.

## Connect a second project

Choose a unique project id: lowercase `a-z`, digits, `_`, `-`, starting with a letter (max 48 characters).
Generate at least 24 bytes of secret entropy **for each project**, e.g.
`openssl rand -hex 32`. Put it in the monitoring **server's** `.env`:

```dotenv
MONITOR_INGEST_KEYS='{"shop":"PUT_A_RANDOM_64_HEX_CHARACTER_SECRET_HERE"}'
```

The sender POSTs JSON to `https://YOUR-MONITOR-SERVER/api/monitoring/ingest`
with these headers:

```
Authorization: Bearer <secret-for-shop>
X-Monitor-Project: shop
Content-Type: application/json
```

Example **event**:

```json
{"type":"event","provider":"stripe","operation":"charge","status":200,"latencyMs":304,"tokens":0,"costUsd":0}
```

Example **quota** (values reported by your provider, not guessed):

```json
{"type":"quota","provider":"stripe","metric":"monthly_requests","unit":"requests","source":"reported","remaining":2500,"limit":3000,"used":500}
```

Supported metrics and fields:
- event: provider, operation, HTTP status (100-599), latencyMs, tokens, costUsd
- quota: provider, metric, unit (requests/tokens/characters/usd), source (provider/response_header/reported), limit/remaining/used
- all attributes are whitelisted; **raw prompts, response bodies and API keys are never stored**
- project identity comes from the authenticated header, never from an untrusted JSON field

## Endpoint access

- `POST /api/monitoring/ingest` — per-project Bearer token, optional until configured
- `GET /api/monitoring/admin/summary?hours=24&project=shop` — logged-in admin only
- `POST /api/monitoring/admin/refresh-quotas` — logged-in admin only
- `GET /admin/monitoring` — logged-in admin only

Time windows: 1, 6, 24, 168, 720 hours. Events expire after 30 days; current quota snapshots are retained.

## Translator integrations

- Groq, OpenRouter, DeepL requests are instrumented via a best-effort wrapper.
- OpenAI SDK transport requests are recorded without logging prompts or API keys.
- Quotas are polled every 15 minutes from the provider's usage endpoints (if credentials are configured).
- `DEEPL_API_KEY`: live character quota from DeepL /v2/usage.
- `OPENROUTER_API_KEY`: **per-key** cap, not necessarily total credit balance.
- Optional `OPENROUTER_MANAGEMENT_KEY`: **account credits remaining** through /api/v1/credits; use a server-side management credential only.
- Optional `OPENAI_ADMIN_KEY`: official organization **costs**, not prepaid balance; no real OpenAI remaining credit can be inferred from this.
- Groq response rate-limit headers are recorded when supplied.
- `usage.js` retains its existing per-user cost accounting; this initial monitoring module does **not** automatically import historical user charges. The dashboard cost total is the sum of monitoring events with a recorded costUsd, not all actual provider invoices.

All keys remain server-side; never place them in browser code.
A no-data provider is **unknown**, not healthy or exhausted. Use the quota timestamp to detect stale readings.

## Operations

- Deploy behind HTTPS and configure reverse-proxy request throttling / IP restrictions on ingestion if exposed publicly.
- Use separate, revocable secrets per project, never re-use a provider's own API key as the monitoring secret.
- Monitoring DB operations and quota probes must not block application translations.
- Node.js 20+ is required for native fetch, AbortSignal.timeout and test runner.
- Tests: `node --test tests/api-monitoring.test.js`
- Release workflow: develop and validate this branch locally before merging to `main`.

### Deferred to V2/V3

Historical percentile latency (P95), automated Telegram alerts, provider-specific budgets for other projects, retention configuration and delivery queue/retries are not implemented in this V1.
