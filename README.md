# RAFO Calibration Center Time Display

RAFO Calibration Center Time Display is a web-based Oman reference time system for the Royal Air Force of Oman Calibration Center (CACE). It combines a browser frontend with an optional Node.js/Express backend that can read time from a Symmetricom / Microchip XLi receiver and automatically fall back through a controlled backend timing hierarchy.

## Pages and routes

- `/official-time` — presentation-style official time page.
- `/dashboard` — operator dashboard with monitoring and receiver controls.
- `/` — redirects to `/official-time` when served by Express, and to `/official-time.html` in Netlify via `netlify.toml`.

## Timing-source priority

The backend now resolves time in this exact order:

1. **GPS Receiver (XLi)**
2. **NTP - NIST**
3. **NTP - NPL India**
4. **HTTP Date**
5. **Local Clock**

### Operational meaning

- **GPS Receiver (XLi)** is the primary reference.
- **NTP (NIST)** is the first traceable fallback.
- **NTP (NPL India)** is the second traceable fallback.
- **INTERNET/HTTP DATE** is a non-traceable continuity fallback.
- **LOCAL CLOCK** is the emergency-only fallback.

### Important implementation note

- NTP is queried **by the backend only**.
- The frontend does **not** scrape HTML clock pages.
- The browser renders whatever normalized source metadata the backend returns.

## Source labels and statuses used by the app

### Source labels

- `GPS RECEIVER (XLi)`
- `NTP (NIST)`
- `NTP (NPL India)`
- `INTERNET/HTTP DATE`
- `LOCAL CLOCK`

### Status wording

- `Primary reference active`
- `Traceable fallback active`
- `Internet fallback active`
- `Emergency local fallback active`

## Backend API routes

- `GET /api/health` — backend health/config summary.
- `GET /api/status` — receiver status and monitoring snapshot.
- `GET /api/time` — active timing-source endpoint using the full priority chain.
- `GET /api/time/internet` — backend fallback-only resolver (NTP → HTTP Date → Local Clock).
- `POST /api/time/set` — set receiver time from the local PC clock or backend fallback hierarchy.

## Key files

- `gps-proxy.js` — Express server, API routes, timing-source selection, status shaping, and static serving.
- `time-source-service.js` — reusable backend NTP and HTTP Date fallback service.
- `receiver-protocol.js` — receiver TCP helpers, parsing, and config validation.
- `runtime-sync.js` — frontend runtime sync engine and backend API integration.
- `status-monitor.js` — frontend monitoring normalization and severity mapping.
- `dashboard-render.js` — dashboard source/status/fallback rendering.
- `fallback-card.js` — non-spam fallback notification behavior.
- `official-time.js` — official time page source/status rendering.
- `index.html` — dashboard markup.
- `official-time.html` — official time page markup.
- `.env.example` — backend configuration example.

## Requirements

- **Node.js 18 or newer**
- **npm** (included with Node.js)

## Installation

### Windows (Command Prompt)

```bat
npm install
copy .env.example .env
npm start
```

Then open:

- `http://localhost:3000/official-time`
- `http://localhost:3000/dashboard`

### PowerShell

```powershell
npm install
Copy-Item .env.example .env
npm start
```

### macOS / Linux

```bash
npm install
cp .env.example .env
npm start
```

## Runtime commands

- `npm start` — runs `node gps-proxy.js`
- `npm run dev` — runs `nodemon gps-proxy.js`
- `npm run start:api` — backend-only mode with `SERVE_STATIC=false`
- `npm run start:full` — backend with static serving enabled
- `npm run check` — syntax checks for backend/frontend scripts
- `npm test` — runs all local harness tests

## Environment variables

### Core settings

| Variable | Required | Purpose |
| --- | --- | --- |
| `PORT` | No | Backend HTTP port. Default: `3000` |
| `RECEIVER_ENABLED` | No | Enable or disable XLi receiver integration |
| `GPS_HOST` | Conditional | Receiver host/IP when receiver mode is enabled |
| `GPS_PORT` | No | Receiver TCP port. Default: `23` |
| `GPS_USERNAME` | Conditional | Receiver username |
| `GPS_PASSWORD` | Conditional | Receiver password |
| `ALLOWED_ORIGIN` | Recommended | Allowed frontend origin(s) for CORS |
| `SERVE_STATIC` | No | Serve frontend files from Express when `true` |
| `NODE_ENV` | No | Node environment |

### Timeout and protection settings

| Variable | Required | Purpose |
| --- | --- | --- |
| `MIN_CONNECTION_INTERVAL_MS` | No | Minimum gap between receiver TCP connections |
| `REQUEST_TIMEOUT_MS` | No | Receiver socket timeout |
| `RECEIVER_STATUS_CACHE_MS` | No | Status cache duration |
| `STATUS_STALE_MS` | No | Backend stale-status threshold |
| `NTP_TIMEOUT_MS` | No | Per-NTP-source timeout in milliseconds |
| `HTTP_DATE_TIMEOUT_MS` | No | Per-HTTP-Date-source timeout in milliseconds |
| `NTP_NIST_HOSTS` | No | Comma-separated NIST NTP hosts. Defaults to `time.nist.gov,time-a-g.nist.gov` |
| `NTP_NPL_HOSTS` | No | Comma-separated NPL India / public fallback NTP hosts. Defaults to `time.nplindia.org,samay1.nic.in` |
| `HTTP_DATE_URLS` | No | Comma-separated HTTP endpoints used for Date-header fallback |
| `API_AUTH_ENABLED` | No | Enable token auth |
| `API_AUTH_TOKEN` | Conditional | Token used when auth is enabled |
| `RATE_LIMIT_WINDOW_MS` | No | Rate-limit window |
| `RATE_LIMIT_TIME_MAX` | No | Max `/api/time` requests per window |
| `RATE_LIMIT_STATUS_MAX` | No | Max `/api/status` requests per window |
| `RATE_LIMIT_INTERNET_MAX` | No | Max `/api/time/internet` requests per window |
| `RATE_LIMIT_SET_MAX` | No | Max `/api/time/set` requests per window |

## Static frontend hosting notes

The frontend remains Netlify/static-host friendly.

- When a backend API is configured and reachable, the frontend uses backend timing data and monitoring metadata.
- When the backend is unavailable, the frontend remains stable and degrades to local continuity display behavior instead of attempting browser-side time scraping.
- The browser-side API timeout should stay longer than the backend's worst-case receiver/fallback path. By default the frontend now waits 35 seconds, and you can override that with `window.APP_CONFIG.API_REQUEST_TIMEOUT_MS` before `api-client.js` loads.

## Testing

Run all local checks:

```bash
npm run check
npm test
```

## Reference notes

The labels and intent for the traceable fallback chain align with:

- NIST official Internet time / computer time synchronization guidance.
- CSIR-NPL India time and frequency metrology / NTP public time dissemination guidance.

## Credits

- Project branding: **Royal Air Force of Oman Calibration Center (CACE)**
- Repository / author reference: **Coded by AlHuDaR** — <https://github.com/AlHuDaR/TIME-CACE/tree/main>
