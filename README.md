# RAFO Calibration Center Time Display

RAFO Calibration Center Time Display is a browser-based Oman time dashboard for a Symmetricom / Microsemi XLi receiver. The Express backend talks to the receiver and the frontend renders the operator dashboard, runtime clock, and fallback messaging.

## Project structure

- `gps-proxy.js` — Express API server, middleware, HTTP routing, static asset serving, rate limiting, and orchestration.
- `receiver-protocol.js` — receiver protocol validation/parsing helpers and TCP session handling.
- `index.html` — frontend markup.
- `styles.css` — dashboard and clock styling.
- `api-client.js` — frontend runtime configuration and shared API/date helpers.
- `runtime-sync.js` — authoritative `/api/time` sync flow, state machine, and polling orchestration.
- `status-monitor.js` — monitoring-state normalization and dashboard severity/integrity modeling.
- `dashboard-render.js` — GPS dashboard rendering and operator display updates.
- `fallback-card.js` — single message/fallback card renderer and dismiss logic.
- `ui-controls.js` — display mode controls, keyboard shortcuts, and operator actions.
- `main.js` — frontend bootstrapping, DOM wiring, analog clock construction, and render loop.
- `tests/protocol-harness.js` — protocol harness used by `npm test`.

## Runtime API roles

### `GET /api/time`
Authoritative runtime endpoint for the operator display.

Source priority remains:
1. GPS receiver / backend authoritative source when available
2. Backend Internet fallback time
3. Frontend local computer fallback time

### `GET /api/status`
Diagnostic and monitoring endpoint.

This route is used for receiver reachability, login/authentication state, lock quality, freshness, alarm severity, and monitoring metadata. It is intentionally informative and does not replace `/api/time` as the runtime source of truth.

### Other endpoints

- `GET /api/health`
- `GET /api/time/internet`
- `POST /api/time/set`

## Running locally

### 1. Install dependencies

```bash
npm install
```

### 2. Create local environment file

Copy `.env.example` to `.env` and fill in the receiver values.

```bash
cp .env.example .env
```

### 3. Start the app

```bash
npm start
```

Useful variants:

```bash
npm run dev
npm run start:api
npm run start:full
```

## Tests and checks

Run the receiver protocol harness from the repository root:

```bash
npm test
```

Run static syntax checks:

```bash
npm run check
```

## Environment configuration

Use `.env` for local development only. `.env` is gitignored and must not be exposed through static serving.

| Variable | Required | Description |
| --- | --- | --- |
| `PORT` | No | Backend HTTP port. Default: `3000` |
| `RECEIVER_ENABLED` | No | Set to `false` to run backend fallback mode without a direct receiver connection |
| `GPS_HOST` | Conditional | Receiver host or IP when receiver mode is enabled |
| `GPS_PORT` | No | Receiver port. Default: `23` |
| `GPS_USERNAME` | Conditional | Receiver username when receiver mode is enabled |
| `GPS_PASSWORD` | Conditional | Receiver password when receiver mode is enabled |
| `ALLOWED_ORIGIN` | Recommended | Exact frontend origin, or comma-separated origins |
| `SERVE_STATIC` | No | Serve frontend assets from Express when `true` |
| `NODE_ENV` | No | Use `production` for stricter serving/CORS defaults |
| `MIN_CONNECTION_INTERVAL_MS` | No | Minimum spacing between receiver TCP sessions |
| `REQUEST_TIMEOUT_MS` | No | Receiver socket timeout |
| `RECEIVER_STATUS_CACHE_MS` | No | Receiver status cache window |
| `STATUS_STALE_MS` | No | Backend stale-data threshold |
| `API_AUTH_ENABLED` | No | Require token auth when `true` |
| `API_AUTH_TOKEN` | Conditional | Required when auth is enabled |
| `RATE_LIMIT_WINDOW_MS` | No | Rate-limit window |
| `RATE_LIMIT_TIME_MAX` | No | `/api/time` max requests per window |
| `RATE_LIMIT_STATUS_MAX` | No | `/api/status` max requests per window |
| `RATE_LIMIT_INTERNET_MAX` | No | `/api/time/internet` max requests per window |
| `RATE_LIMIT_SET_MAX` | No | `/api/time/set` max requests per window |

## Security notes

- `.env` is ignored by Git and is not part of the static asset allowlist.
- Static serving remains restricted to the known frontend files and `/images`.
- Optional token auth and route-aware rate limiting remain enabled by configuration and were not weakened.


## Hosted frontend configuration

For Netlify or any other static frontend deployment, point the browser to a hosted backend by setting one of the following before the frontend scripts load:

- `window.APP_CONFIG.API_BASE_URL = "https://your-backend.example.com/api"`
- `<meta name="rafo-api-base-url" content="https://your-backend.example.com/api">`

Optional backup backend:

- `window.APP_CONFIG.API_BACKUP_URL = "https://backup-backend.example.com/api"`
- `<meta name="rafo-api-backup-url" content="https://backup-backend.example.com/api">`

If no backend is configured or reachable, the frontend will continue running with its browser emergency fallback.
