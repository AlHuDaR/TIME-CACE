# RAFO Calibration Center Time Display

RAFO Calibration Center Time Display is a web-based Oman reference time system for the Royal Air Force of Oman Calibration Center (CACE). It combines a browser frontend with an optional Node.js/Express backend that can read time from a Symmetricom / Microsemi XLi receiver, serve backend Internet fallback time, and now continue with a browser-reachable remote Internet reference when the local backend is unavailable before finally degrading to local device time.

## Overview

The project exposes two primary user-facing pages:

- **Official Time** — a presentation-style Oman reference time display.
- **Dashboard** — an operator-focused monitoring and control page.

The application keeps Oman time displayed in **Gulf Standard Time (GST, UTC+04:00)** and preserves multiple operating modes, receiver status monitoring, fallback notifications, and source/status summaries.

## Current pages and routes

### Frontend routes

When served by Express or Netlify, the current public routes are:

- `/official-time` → official reference time page
- `/dashboard` → dashboard page
- `/` → redirects to `/official-time` in the Express app, and to `/official-time.html` in Netlify via `netlify.toml`

### Dashboard modes

The dashboard supports these display modes and URL variants:

- **Digital mode** → `/dashboard?mode=digital`
- **Old-style mode** (watch-style analog panel) → `/dashboard?mode=analog`
- **Analog-only mode** → `/dashboard?mode=analog-only`

### Source files behind the pages

- `official-time.html` — Official Time page
- `index.html` — Dashboard page

## Features

- Oman time display using **Asia/Muscat / GST (UTC+04:00)**
- **Dashboard page** for operators and monitoring
- **Official Time page** for clean reference display
- Preserved dashboard modes:
  - **Digital mode**
  - **Analog mode** / **old-style mode**
  - **Analog-only mode**
- PTB-style analog clock rendering
- Millisecond precision toggle
- Dark mode with saved preference
- Keyboard shortcuts for mode switching, dark mode, fullscreen, and pause/resume
- Live source/status rendering for:
  - receiver/backend source
  - Internet fallback source
  - local browser/device fallback
- Monitoring dashboard for:
  - receiver reachability
  - GPS lock state
  - active source
  - timing integrity
  - sync freshness
  - communication status
  - fallback state
  - recent events
- Fallback information card / notification behavior
- Receiver write-back actions for setting receiver time from:
  - the local computer clock
  - Internet time
- Netlify-friendly static frontend deployment
- Express option to serve frontend and backend together

## How time sourcing works now

The runtime now follows a safer multi-level fallback chain:

1. **Primary: backend / receiver path**
   - The frontend first tries the backend `/api/time` endpoint.
   - If the receiver is reachable and locked, the app uses receiver-backed time.
   - If the backend is running and already supplying backend Internet fallback, the frontend continues to use that backend response normally.

2. **Secondary: Internet reference fallback**
   - If backend receiver time is unavailable, the frontend still tries the backend Internet endpoint at `/api/time/internet`.
   - If the backend itself is unavailable, the frontend now tries a **browser-reachable remote Internet time source directly**.
   - The default browser-side remote sources are:
     - `https://worldtimeapi.org/api/timezone/Asia/Muscat`
     - `https://timeapi.io/api/Time/current/zone?timeZone=Asia/Muscat`

3. **Last fallback: local browser/device time**
   - The app only falls back to local device time when both backend time and remote Internet fallback are unavailable.

### What this means in practice

- If the local backend on port `3000` is running, the app behaves as before.
- If the backend is down but the browser still has Internet access, the app can continue on **remote Internet fallback** instead of dropping straight to device time.
- If both the backend and remote Internet sources are unavailable, the app uses **local browser/device time** as the last resort.

## Source and status behavior

The UI still preserves the existing professional source/status presentation, but it now distinguishes more clearly between:

- **Receiver locked / receiver-backed source**
- **Backend Internet fallback**
- **Remote Internet fallback** (browser-side, used when backend is offline)
- **Local device fallback**

This affects:

- dashboard source badge and status text
- official-time source card
- fallback information card wording
- monitoring cards describing active source, fallback state, and integrity

## Backend API routes

The backend currently exposes these routes:

- `GET /api/health` — backend health/config summary
- `GET /api/status` — receiver and monitoring snapshot
- `GET /api/time` — primary synchronized runtime time endpoint
- `GET /api/time/internet` — backend Internet fallback time endpoint
- `POST /api/time/set` — set receiver time from computer or Internet time

## Project structure

### Key files

- `gps-proxy.js` — Express server, API routes, fallback logic, static serving, auth, and rate limiting
- `receiver-protocol.js` — receiver TCP helpers, parsing, and config validation
- `api-client.js` — shared frontend configuration and API/base URL resolution
- `runtime-sync.js` — runtime sync engine and multi-level fallback selection
- `status-monitor.js` — monitoring-state normalization and severity logic
- `dashboard-render.js` — dashboard status/source/fallback rendering
- `fallback-card.js` — fallback notification and source-change messaging
- `official-time.js` — official-time page runtime and status rendering
- `ui-controls.js` — dashboard mode switching, preferences, and receiver actions
- `main.js` — dashboard bootstrap
- `analog-clock.js` — analog clock generation
- `index.html` — dashboard markup
- `official-time.html` — official-time markup
- `styles.css` and `styles/` — visual styling
- `.env.example` — sample backend configuration
- `netlify.toml` — Netlify routing and cache-control configuration
- `tests/protocol-harness.js` — protocol/configuration test harness

## Requirements and environment

### Is Node.js required?

- **Yes, for the full local backend/receiver workflow.**
- The Node.js backend is required if you want:
  - the receiver integration
  - `/api/time`, `/api/status`, `/api/time/internet`, and `/api/time/set`
  - local Express serving of the frontend
- If you only host the static frontend somewhere else, Node.js is not required on the client machine, but backend-backed features will not be available unless you point the frontend at a running API.

### Is npm required?

- **Yes, if you run the backend locally.**
- **npm is included with Node.js**, so install Node.js first.

### Is `npm install` required?

- **Yes**, before running any of the backend scripts in `package.json`.

### Node version

- The project currently requires **Node.js 18 or newer**.

## Installation

1. Install **Node.js 18+**.
2. Open a terminal in the repository root.
3. Install dependencies:

```bash
npm install
```

4. Create a local environment file from `.env.example`.

**Windows (Command Prompt):**

```bat
copy .env.example .env
```

**macOS/Linux:**

```bash
cp .env.example .env
```

5. Edit `.env` for your environment.

## Environment configuration

The backend reads configuration from `.env`.

### Core variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `PORT` | No | Backend HTTP port. Default: `3000` |
| `RECEIVER_ENABLED` | No | Enables/disables receiver integration |
| `GPS_HOST` | Conditional | Receiver host/IP when receiver mode is enabled |
| `GPS_PORT` | No | Receiver TCP port. Default: `23` |
| `GPS_USERNAME` | Conditional | Receiver username when receiver mode is enabled |
| `GPS_PASSWORD` | Conditional | Receiver password when receiver mode is enabled |
| `ALLOWED_ORIGIN` | Recommended | Allowed frontend origin(s) for CORS |
| `SERVE_STATIC` | No | Serve frontend files from Express when `true` |
| `NODE_ENV` | No | Node environment |

### Optional tuning and protection

| Variable | Required | Purpose |
| --- | --- | --- |
| `MIN_CONNECTION_INTERVAL_MS` | No | Minimum gap between receiver TCP connections |
| `REQUEST_TIMEOUT_MS` | No | Receiver socket timeout |
| `RECEIVER_STATUS_CACHE_MS` | No | Backend status cache duration |
| `STATUS_STALE_MS` | No | Backend stale-status threshold |
| `API_AUTH_ENABLED` | No | Enable token auth |
| `API_AUTH_TOKEN` | Conditional | Token used when auth is enabled |
| `RATE_LIMIT_WINDOW_MS` | No | Rate-limit window |
| `RATE_LIMIT_TIME_MAX` | No | Max `/api/time` requests per window |
| `RATE_LIMIT_STATUS_MAX` | No | Max `/api/status` requests per window |
| `RATE_LIMIT_INTERNET_MAX` | No | Max `/api/time/internet` requests per window |
| `RATE_LIMIT_SET_MAX` | No | Max `/api/time/set` requests per window |

## How to run locally

### Windows

After `npm install` and `.env` setup:

```bat
npm start
```

Then open:

- `http://localhost:3000/official-time`
- `http://localhost:3000/dashboard`

### macOS / Linux

After `npm install` and `.env` setup:

```bash
npm start
```

Then open:

- `http://localhost:3000/official-time`
- `http://localhost:3000/dashboard`

## Available npm scripts

These are the scripts currently defined in `package.json`:

- `npm start` — run `node gps-proxy.js`
- `npm run dev` — run `nodemon gps-proxy.js`
- `npm run start:api` — run backend-only mode with `SERVE_STATIC=false`
- `npm run start:full` — run backend with static serving enabled
- `npm run check` — syntax-check the main backend/frontend scripts
- `npm run test:protocol` — run the protocol harness
- `npm test` — alias for `npm run test:protocol`

## Frontend/API configuration when hosted separately

The frontend supports these pre-load configuration options:

### Primary API base URL

```html
<meta name="rafo-api-base-url" content="https://your-backend.example.com/api" />
```

or:

```html
<script>
  window.APP_CONFIG = {
    API_BASE_URL: "https://your-backend.example.com/api"
  };
</script>
```

### Backup API base URL

```html
<meta name="rafo-api-backup-url" content="https://backup-backend.example.com/api" />
```

or:

```html
<script>
  window.APP_CONFIG = {
    API_BACKUP_URL: "https://backup-backend.example.com/api"
  };
</script>
```

### Optional browser-side remote Internet sources

The browser-side remote fallback sources can also be overridden before scripts load:

```html
<script>
  window.APP_CONFIG = {
    REMOTE_TIME_SOURCES: [
      {
        name: "Example Remote Time",
        url: "https://example.com/time",
        parser: "worldtimeapi"
      }
    ]
  };
</script>
```

Current built-in parser values used by the code are:

- `worldtimeapi`
- `timeapiio`

## Deployment notes

### Netlify

`netlify.toml` currently:

- publishes the repository root
- redirects `/` to `/official-time.html`
- routes `/official-time` to `official-time.html`
- routes `/dashboard` to `index.html`
- sends no-store cache headers

This preserves static Netlify behavior for the frontend.

### Express/local serving

When `SERVE_STATIC=true` or when `NODE_ENV` is not `production`, `gps-proxy.js` serves the frontend directly and exposes the API from the same process.

## Troubleshooting

- If backend startup fails, make sure you ran `npm install` first.
- If receiver integration is not needed, set `RECEIVER_ENABLED=false`.
- If the backend is unavailable but the browser still has Internet access, the app should now continue on **remote Internet fallback** before using local device time.
- If both backend and remote Internet sources fail, the app will use **local device/browser time**.
- If the frontend is hosted on a different origin than the backend, make sure `ALLOWED_ORIGIN` is set correctly.
- If API auth is enabled, the frontend must send the correct token.
- `.env` is for local/private deployment settings and should not be committed.

## Testing and checks

Run the protocol harness:

```bash
npm test
```

Run syntax checks:

```bash
npm run check
```

## Credits

- Project branding: **Royal Air Force of Oman Calibration Center (CACE)**
- Repository / author reference: **Coded by AlHuDaR** — <https://github.com/AlHuDaR/TIME-CACE/tree/main>
