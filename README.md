# RAFO Calibration Center Time Display

RAFO Calibration Center Time Display is a browser-based Oman time dashboard for the **Royal Air Force of Oman (RAFO) Calibration Center**. The frontend preserves the existing digital and analog clock experience, while the backend connects to a **Symmetricom XLi GPS time/frequency receiver** over TCP/Telnet and exposes structured API endpoints for runtime synchronization and operator-facing timing diagnostics.

## Architecture

### Frontend

- Static frontend built from `index.html`, `styles.css`, and `script.js`.
- Intended to be deployed on **Netlify**.
- Can consume:
  - same-origin `/api` routes if a reverse proxy exists, or
  - a separately hosted backend via `window.APP_CONFIG.API_BASE_URL`.
- Keeps the existing authoritative time-sync flow on `GET /api/time`.
- Uses a separate `GET /api/status` polling loop for operator diagnostics, receiver health, freshness, and monitoring-state presentation.

### Backend

`gps-proxy.js` is an **Express backend** that:

- logs into the Symmetricom XLi receiver,
- reads and sets receiver time,
- provides Internet fallback time derived from HTTP `Date` headers,
- keeps short-lived receiver status caching to avoid duplicate receiver reads,
- normalizes receiver/communication state into additive monitoring metadata,
- optionally enforces token auth and route-aware rate limits for deployments outside a trusted internal network.

The backend should be deployed separately from Netlify, for example on a private VM, Docker host, or internal Node.js service.

### Receiver time semantics

- The backend currently uses the XLi `F3` command path for reading and setting time.
- The XLi manual documents `F3 UTC mm/dd/yyyy hh:mm:ss` as a UTC-oriented command-line set operation, so the backend now treats receiver command timestamps as **UTC on the wire** and converts them to Oman time only for operator-facing display fields.
- Because the exact deployed receiver configuration can still affect adjacent behavior such as `F69` display/output mode and operator expectations, any further protocol changes should be validated against the real unit before altering command selection or parsing assumptions.

## Features

- Oman time display in digital mode.
- Old-style analog watch mode.
- Analog-only fullscreen mode.
- Dark mode toggle.
- Precision toggle for milliseconds.
- Notifications.
- Set GPS time from the computer or Internet fallback source.
- Separate frontend polling for backend/receiver operational status.
- Optional backend token auth and route-specific rate limiting.
- GPS System Status dashboard upgraded toward a professional timing-monitoring model.
- Lightweight recent event/history awareness without adding database persistence.
- Session-based “last known good” timing indicators for operator awareness.

## Timing Monitoring Model

The application now separates **authoritative runtime time** from **diagnostic monitoring state**.

### Authoritative path

- `GET /api/time` remains the **authoritative runtime time path**.
- The display clock and offset calculations still follow the runtime source selected from this endpoint.
- Runtime source priority remains:
  1. GPS receiver locked time
  2. Internet fallback time
  3. Local computer fallback time

### Diagnostic path

- `GET /api/status` remains the **system/receiver/operator health path**.
- It is used for receiver health, lock quality, communication state, freshness, trust/integrity presentation, and advisory alarms.
- `/api/status` is informative and additive; it does **not** replace the authoritative runtime clock path.

### Formalized state model

The frontend now centralizes monitoring logic around explicit state categories:

- `runtimeTimeSourceState`
- `receiverHealthState`
- `gpsLockQualityState`
- `statusDataFreshnessState`
- `timingIntegrityState`
- `alarmSeverityState`
- `communicationAuthState`

These are derived in one place instead of being scattered across the dashboard rendering code.

Representative values include:

- `healthy`
- `fresh`
- `cached`
- `degraded`
- `warning`
- `critical`
- `unknown`
- `unavailable`
- `stale`

## Alarm Severity Model

The dashboard now uses a reusable four-level severity model:

- **Normal**
  - GPS locked
  - backend online
  - receiver reachable and authenticated
  - fresh status data
- **Advisory**
  - cached receiver snapshot
  - Internet fallback in use
  - temporary runtime/status mismatch while status is still fresh
- **Warning**
  - GPS unlocked
  - holdover
  - stale status data
  - repeated receiver communication trouble inside the current session
- **Critical**
  - backend offline
  - receiver unreachable
  - login/authentication failure to receiver
  - local-only degraded fallback
  - diagnostic data unavailable while runtime confidence is low

This severity model is used consistently in the dashboard badges, summary text, metric tones, and event signaling.

## Timing Integrity / Trust Indicator

The dashboard now includes an operator-facing timing confidence indicator.

Possible values:

- **High confidence**
- **Reduced confidence**
- **Degraded**
- **Low confidence / uncertain**

This is **not** a formal metrology traceability statement. It is an operator-facing integrity/trust presentation derived from conditions such as:

- GPS lock health
- holdover or unlocked receiver state
- Internet fallback usage
- local fallback usage
- fresh vs cached vs stale vs unavailable status data
- backend/receiver communication and authentication condition

## Last Known Good Concepts

The monitoring layer now tracks session-aware “last known good” indicators where possible.

Exposed/displayed concepts include:

- last known good GPS lock time
- last successful receiver communication time
- last successful authoritative time sync time
- time since GPS lock was last healthy
- time since receiver was last reachable
- time since status data became stale

These values are **session-scoped** unless the backend already knows them. The app does not invent false historical precision beyond the current backend/frontend process lifetime.

## Recent Event / History Awareness

The dashboard now maintains a lightweight recent in-memory event list to improve operator awareness without introducing a database or persistent audit log.

Examples include:

- GPS lock healthy
- GPS lock lost
- entered holdover
- receiver unreachable
- receiver communication restored
- runtime switched to Internet fallback
- runtime degraded to local fallback
- status became stale
- runtime/status alignment restored

The implementation intentionally suppresses obvious duplicates so the operator view stays readable.

## Stale / Cached / Unavailable Status Interpretation

Status data is now interpreted more carefully:

- **Fresh** = current receiver snapshot inside the freshness window.
- **Cached** = recent cached snapshot reused intentionally to avoid duplicate receiver reads.
- **Stale** = status exists, but it is too old to treat as live operational telemetry.
- **Unavailable** = no usable status snapshot is available.

Important operator rule:

- `/api/time` remains authoritative for the displayed runtime clock.
- `/api/status` remains diagnostic.
- If runtime source and status source differ, the dashboard treats that as a **contextual advisory**, not an automatic fault.
- When status is stale or cached, the dashboard explicitly says so rather than presenting it as live receiver telemetry.

## API Endpoints

The backend exposes the following endpoints:

- `GET /api/health`
- `GET /api/time`
- `POST /api/time/set`
- `GET /api/time/internet`
- `GET /api/status`

### `GET /api/status`

Returns receiver state plus additive monitoring metadata. Core fields include:

- `backendOnline`
- `receiverReachable`
- `loginOk`
- `isLocked`
- `gpsLockState` (`locked`, `unlocked`, `holdover`, `unknown`)
- `statusText`
- `currentSource`
- `currentSourceLabel`
- `receiverCommunicationState`
- `lastError`
- `checkedAt`
- `statusAgeMs`
- `receiverSnapshotAgeMs`
- `dataState` (`live`, `cached`, `unavailable`)
- `stale`
- `fetchedFromCache`
- `cacheAgeMs`
- `monitoringState`
  - `runtimeTimeSourceState`
  - `receiverHealthState`
  - `gpsLockQualityState`
  - `statusDataFreshnessState`
  - `timingIntegrityState`
  - `alarmSeverityState`
  - `communicationAuthState`
- `lastKnownGoodGpsLockAt`
- `lastSuccessfulReceiverCommunicationAt`
- `lastSuccessfulAuthoritativeTimeSyncAt`
- `statusBecameStaleAt`
- `consecutiveCommunicationFailures`

These fields are additive and preserve compatibility with existing consumers.

## Environment Variables

Create a `.env` file for local backend development.

| Variable | Required | Description |
| --- | --- | --- |
| `PORT` | No | Backend HTTP port. Default: `3000` |
| `GPS_HOST` | Yes | Hostname or IP address of the Symmetricom XLi receiver |
| `GPS_PORT` | No | Receiver TCP/Telnet port. Default: `23` |
| `GPS_USERNAME` | Yes | Receiver username |
| `GPS_PASSWORD` | Yes | Receiver password |
| `ALLOWED_ORIGIN` | Recommended | Exact frontend origin allowed by CORS. You can provide multiple comma-separated origins if needed. |
| `SERVE_STATIC` | No | When `true`, the backend also serves `index.html`, `script.js`, and other static assets for local convenience. Default: `true` outside production, `false` in production. |
| `NODE_ENV` | No | Set to `production` to make default CORS behavior stricter and disable static serving unless `SERVE_STATIC=true`. |
| `MIN_CONNECTION_INTERVAL_MS` | No | Minimum spacing between receiver TCP sessions. Default: `5000`. |
| `REQUEST_TIMEOUT_MS` | No | Receiver socket timeout in milliseconds. Default: `15000`. |
| `RECEIVER_STATUS_CACHE_MS` | No | Short cache window used to avoid duplicate receiver reads when `/api/time` and `/api/status` are called near each other. Default: `4000`. |
| `STATUS_STALE_MS` | No | Backend stale-data classification threshold for additive monitoring metadata. Default: `45000`. |
| `API_AUTH_ENABLED` | No | Set to `true` to require an API token on `/api/time`, `/api/time/internet`, `/api/time/set`, and `/api/status`. Default: `false`. |
| `API_AUTH_TOKEN` | Required if `API_AUTH_ENABLED=true` | Shared bearer/API-key token accepted via `Authorization: Bearer ...` or `X-API-Key`. |
| `RATE_LIMIT_WINDOW_MS` | No | Shared rate-limit window for API routes. Default: `60000`. |
| `RATE_LIMIT_TIME_MAX` | No | Max `GET /api/time` requests per client per window. Default: `90`. |
| `RATE_LIMIT_STATUS_MAX` | No | Max `GET /api/status` requests per client per window. Default: `30`. |
| `RATE_LIMIT_INTERNET_MAX` | No | Max `GET /api/time/internet` requests per client per window. Default: `60`. |
| `RATE_LIMIT_SET_MAX` | No | Max `POST /api/time/set` requests per client per window. Default: `8`. |

See `.env.example` for a template.

## Frontend Runtime Configuration

The frontend still resolves its API base in this order:

1. `window.APP_CONFIG.API_BASE_URL`
2. same-origin `/api`
3. localhost fallback for non-HTTP local usage

Additional optional frontend runtime settings are supported:

```html
<script>
  window.APP_CONFIG = {
    API_BASE_URL: "https://your-backend.example.com/api",
    STATUS_POLLING_ENABLED: true,
    STATUS_POLLING_INTERVAL_MS: 15000,
    API_AUTH_TOKEN: "same-token-configured-on-backend-if-auth-is-enabled"
  };
</script>
```

- `STATUS_POLLING_ENABLED` defaults to `true`.
- `STATUS_POLLING_INTERVAL_MS` defaults to `15000`.
- The frontend treats status older than `45s` as stale by default for operator presentation.
- `API_AUTH_TOKEN` is only needed when backend auth is enabled.

## Local Development

### 1. Install dependencies

```bash
npm install
```

### 2. Configure backend environment

```bash
cp .env.example .env
```

Fill in the real receiver credentials and host values in `.env`.

### 3. Start the backend

```bash
npm run dev
```

The backend runs by default at `http://localhost:3000`.

### 4. Run the frontend

You have two supported local options.

#### Option A: Use the backend to serve the frontend

Set `SERVE_STATIC=true` in `.env`, then open:

```text
http://localhost:3000
```

#### Option B: Serve the frontend separately

Open `index.html` directly or use a lightweight static server, then define the backend explicitly before loading `script.js`:

```html
<script>
  window.APP_CONFIG = {
    API_BASE_URL: "http://localhost:3000/api"
  };
</script>
```

If you serve the frontend from another local origin, also allow that origin in the backend `.env` file, for example:

```env
ALLOWED_ORIGIN=http://localhost:5500
```

If you enable backend auth locally, also inject the same token on the frontend.

## Deployment Notes

- **Netlify frontend + separate backend** remains the correct production architecture.
- The backend must have network access to the internal Symmetricom XLi receiver.
- In production, prefer API-only backend hosting with `SERVE_STATIC=false` unless you intentionally want local-style static serving.
- When `SERVE_STATIC=true`, the backend serves only the intended frontend assets (`index.html`, `script.js`, `styles.css`, and `images/`) instead of exposing the whole repository root.
- Do not commit real receiver credentials to Git.
- Existing user-visible clock features remain intact:
  - digital mode
  - old-style analog mode
  - analog-only mode
  - dark mode
  - precision toggle
  - notifications
  - Set GPS controls
- Existing operational features also remain intact:
  - optional backend auth
  - backend rate limiting
  - receiver status caching
  - frontend status polling
  - current deployment model
- The current code structure is prepared for future trend-oriented additions such as:
  - offset trend
  - drift trend
  - holdover duration trend
  - lock stability trend

## Security Notes

- Store receiver credentials only in environment variables.
- Restrict backend CORS with `ALLOWED_ORIGIN` in production.
- Enable `API_AUTH_ENABLED=true` and set a strong `API_AUTH_TOKEN` if the backend is exposed outside a fully trusted internal network.
- Rate limits are per-client and route-specific; tune them carefully if you expect wall displays, monitoring, or control traffic from many clients.
- Keep the backend on a trusted network if it can reach the receiver over Telnet/TCP.
- The Internet fallback endpoint uses HTTP response headers as a pragmatic fallback source; it is not a true NTP implementation.
