# RAFO Calibration Center Time Display

RAFO Calibration Center Time Display is a browser-based Oman time dashboard for the **Royal Air Force of Oman (RAFO) Calibration Center**. The frontend preserves the current digital and analog clock experience, while the backend connects to a **Symmetricom XLi GPS time/frequency receiver** over TCP/Telnet and exposes structured API endpoints for the UI.

## Architecture

### Frontend

- Static frontend built from `index.html`, `styles.css`, and `script.js`.
- Intended to be deployed on **Netlify**.
- Can consume:
  - same-origin `/api` routes if a reverse proxy exists, or
  - a separately hosted backend via `window.APP_CONFIG.API_BASE_URL`.
- Keeps the existing time-sync flow on `GET /api/time`, and now also supports a separate lightweight `GET /api/status` polling loop for backend/receiver health updates.

### Backend

`gps-proxy.js` is an **Express backend** that:

- logs into the Symmetricom XLi receiver,
- reads and sets receiver time,
- provides Internet fallback time derived from HTTP `Date` headers,
- returns structured runtime source and lock state for the frontend,
- optionally enforces token auth and route-aware rate limits for deployments outside a trusted internal network.

The backend should be deployed separately from Netlify, for example on a private VM, Docker host, or internal Node.js service.

## Features

- Oman time display in digital mode.
- Old-style analog watch mode.
- Analog-only fullscreen mode.
- GPS status bar with receiver/runtime source messaging.
- Full GPS System Status dashboard with operator-focused health, diagnostics, freshness, and source alignment views.
- Separate system-status polling for backend and receiver health.
- Dark mode toggle.
- Precision toggle for milliseconds.
- Set GPS time from computer or Internet fallback source.
- Structured backend status endpoint for lock and reachability reporting.
- Optional API auth and rate limiting for hardened deployments.

## API Endpoints

The backend exposes the following endpoints:

- `GET /api/health`
- `GET /api/time`
- `POST /api/time/set`
- `GET /api/time/internet`
- `GET /api/status`

### `GET /api/status`

Returns receiver state such as:

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
- `dataState` (`live`, `cached`, `unavailable`)
- `fetchedFromCache`
- `cacheAgeMs`

The frontend dashboard derives operator-facing severity from those fields:

- **Critical**: backend offline, receiver unreachable, or receiver login failure.
- **Warning**: GPS unlocked, holdover, Internet fallback, or stale status data.
- **Normal**: fresh status data with a reachable authenticated receiver and GPS lock.

This endpoint is intended for optional frontend health polling separate from the main time-sync cycle. The clock still uses `GET /api/time` for authoritative time updates; status polling only refreshes operational state.

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

Additional optional frontend runtime settings are now supported:

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

- `STATUS_POLLING_ENABLED` defaults to `true`. Set it to `false` if you want the UI to rely only on `/api/time` updates.
- `STATUS_POLLING_INTERVAL_MS` defaults to `15000`.
- The dashboard treats status older than `45s` as stale in the frontend so operators can distinguish live versus delayed `/api/status` data without affecting the authoritative `/api/time` clock path.
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

In this mode, the frontend uses same-origin `/api` requests automatically.

#### Option B: Serve the frontend separately

You can open `index.html` directly or use a lightweight local static server. In that case, define the backend explicitly before loading `script.js`:

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

If you enable backend auth locally, also inject the same token on the frontend:

```html
<script>
  window.APP_CONFIG = {
    API_BASE_URL: "http://localhost:3000/api",
    API_AUTH_TOKEN: "replace-with-a-long-random-token"
  };
</script>
```

## Netlify Frontend Deployment

This project is **not purely static anymore** because the frontend depends on a separate backend for GPS/Internet time and receiver control.

### Netlify settings

- Build command: leave empty
- Publish directory: `.`

### Frontend runtime configuration

If the backend is not mounted behind the same origin under `/api`, inject the backend base URL before `script.js`, for example:

```html
<script>
  window.APP_CONFIG = {
    API_BASE_URL: "https://your-backend.example.com/api"
  };
</script>
```

If the backend requires auth, inject `API_AUTH_TOKEN` the same way.

### CORS

Set `ALLOWED_ORIGIN` on the backend to your Netlify site origin, for example:

```env
ALLOWED_ORIGIN=https://your-site.netlify.app
```

For preview deployments or multiple approved origins, you can provide a comma-separated list:

```env
ALLOWED_ORIGIN=https://your-site.netlify.app,https://deploy-preview-12--your-site.netlify.app
```

## Deployment Notes

- **Netlify frontend + separate backend** is the correct production architecture for this app.
- The backend must have network access to the internal Symmetricom XLi receiver.
- In production, prefer API-only backend hosting with `SERVE_STATIC=false` unless you intentionally want local-style static serving.
- Do not commit real receiver credentials to Git.
- The frontend can accurately distinguish between:
  - GPS receiver locked,
  - GPS receiver reachable but unlocked,
  - receiver holdover,
  - Internet fallback,
  - local fallback.
- The GPS System Status dashboard keeps `/api/status` operational data separate from `/api/time` runtime sync, and explicitly flags when those two views differ or when status data may be stale.
- The frontend now polls `/api/status` independently, so operator-facing health indicators can update between full time synchronizations without changing the clock source or displayed time.
- The dashboard code is intentionally structured so future alarm/event-history/drift-integrity features can be added without replacing the current clock or API model.

## Security Notes

- Store receiver credentials only in environment variables.
- Restrict backend CORS with `ALLOWED_ORIGIN` in production.
- Enable `API_AUTH_ENABLED=true` and set a strong `API_AUTH_TOKEN` if the backend is exposed outside a fully trusted internal network.
- Rate limits are per-client and route-specific; tune them carefully if you expect wall displays, monitoring, or control traffic from many clients.
- Keep the backend on a trusted network if it can reach the receiver over Telnet/TCP.
- The Internet fallback endpoint uses HTTP response headers as a pragmatic fallback source; it is not a true NTP implementation.
