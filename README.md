# RAFO Calibration Center Time Display

RAFO Calibration Center Time Display is a web-based Oman reference time system for the Royal Air Force of Oman Calibration Center (CACE). The project combines a browser frontend with a Node.js/Express backend that can read time from a Symmetricom / Microsemi XLi receiver, fall back to backend Internet time when needed, and finally degrade to local browser time if no remote source is available.

The current project ships with two main user-facing pages:
- an **Official Time** page intended for clean reference display
- a **Dashboard** page intended for operator monitoring, diagnostics, and control actions

## What the app does

The application keeps an Oman time display running with a clear source priority:

1. **GPS receiver time** from the Symmetricom / Microsemi XLi receiver when reachable
2. **Backend Internet fallback time** when the receiver path is unavailable or disabled
3. **Local computer/browser fallback time** when remote sources cannot be reached

The frontend continuously synchronizes with the backend, tracks source changes, and shows operator-friendly monitoring details such as receiver reachability, lock status, timing integrity, freshness, fallback state, and recent events.

## Current features

- Oman time display using **Gulf Standard Time (GST, UTC+04:00)**
- Dual page experience:
  - **Official Time page** for a presentation-style reference clock
  - **Dashboard page** for operator monitoring and controls
- Multiple display modes on the dashboard:
  - **Digital**
  - **Old style watch**
  - **Analog-only fullscreen-style mode**
- PTB-style analog clock rendering
- Millisecond precision toggle
- Dark mode with saved preference in `localStorage`
- Keyboard shortcuts for mode switching, pause, fullscreen, and dark mode
- Monitoring dashboard with receiver health, active source, timing integrity, sync age, communication status, fallback state, and event history
- Fallback information card when runtime source changes
- Optional receiver time write-back from:
  - the local computer clock
  - backend Internet time
- Backend API with:
  - health endpoint
  - status endpoint
  - authoritative time endpoint
  - Internet fallback endpoint
  - receiver time set endpoint
- Optional API token protection and route-specific rate limiting
- Netlify-friendly static hosting configuration for the frontend
- Local Express static serving option for running frontend and backend together

## Pages and routes

### Frontend pages

When static assets are served by Express or Netlify, the project currently exposes these routes:

- `/official-time` → official Oman reference time page
- `/dashboard` → operator dashboard page
- `/` → redirects to `/official-time`

The underlying files are:
- `official-time.html`
- `index.html`

### Dashboard display modes

The dashboard supports URL-driven mode switching via the `mode` query parameter:

- `/dashboard?mode=digital`
- `/dashboard?mode=analog`
- `/dashboard?mode=analog-only`

The UI also lets users switch modes interactively.

### Backend API routes

- `GET /api/health` — backend health and configuration summary
- `GET /api/status` — receiver/monitoring status snapshot
- `GET /api/time` — primary synchronized time endpoint used by the runtime
- `GET /api/time/internet` — backend Internet fallback time
- `POST /api/time/set` — writes time to the receiver using either the computer or Internet source

## Project structure

### Key files

- `gps-proxy.js` — Express server, API routes, static serving, CORS, auth, and rate limiting
- `receiver-protocol.js` — receiver connection helpers, protocol parsing, and config validation
- `index.html` — dashboard page markup
- `official-time.html` — official reference time page markup
- `api-client.js` — shared frontend configuration and URL helpers
- `runtime-sync.js` — runtime sync engine, fallback logic, API access, and polling
- `status-monitor.js` — monitoring model and status normalization helpers
- `dashboard-render.js` — dashboard rendering and live monitoring presentation
- `fallback-card.js` — transient notifications and fallback information card logic
- `ui-controls.js` — mode controls, preferences, keyboard shortcuts, and receiver actions
- `main.js` — dashboard bootstrap and render loop
- `official-time.js` — official time page bootstrap and live updates
- `analog-clock.js` — PTB-style SVG analog clock generation
- `styles.css` — root stylesheet that imports modular stylesheets
- `styles/base.css` — shared design tokens and global styles
- `styles/dashboard.css` — dashboard layout and monitoring styles
- `styles/modes.css` — digital/analog/analog-only mode styling
- `styles/official-time.css` — official page styling
- `styles/responsive.css` — responsive adjustments
- `netlify.toml` — Netlify redirects and cache-control headers
- `.env.example` — sample backend configuration
- `tests/protocol-harness.js` — protocol and receiver behavior test harness

### Top-level layout summary

```text
TIME-CACE/
├── index.html
├── official-time.html
├── gps-proxy.js
├── receiver-protocol.js
├── api-client.js
├── runtime-sync.js
├── status-monitor.js
├── dashboard-render.js
├── fallback-card.js
├── ui-controls.js
├── main.js
├── official-time.js
├── analog-clock.js
├── styles.css
├── styles/
├── images/
├── tests/
├── .env.example
├── package.json
└── netlify.toml
```

## Requirements and prerequisites

If you want to run the project locally with its current backend, **Node.js is required**.

- **Node.js 18 or newer** is required by the project (`"node": ">=18"`)
- **npm** is also required, and **npm is installed automatically with Node.js**
- A receiver connection is optional if you want live Symmetricom / Microsemi XLi integration
- If you do not have receiver access, you can still run the project in fallback mode by disabling receiver mode in `.env`

### Required software

- **Node.js 18+**
- **npm** (comes with Node.js)

## Installation and setup

> Important: if you use the backend or run the combined local app, you must install Node.js first, then run `npm install` before starting the project.

### 1. Install Node.js

Download and install Node.js from the official Node.js website for your operating system. npm is included with the Node.js installer.

### 2. Install project dependencies

From the repository root:

```bash
npm install
```

### 3. Create a local environment file

Create a `.env` file from `.env.example`.

**Windows (Command Prompt):**

```bat
copy .env.example .env
```

**macOS/Linux:**

```bash
cp .env.example .env
```

Then edit `.env` with the correct values for your environment.

### 4. Configure whether the receiver is used

- Use real receiver credentials if you want live receiver integration
- Set `RECEIVER_ENABLED=false` if you want to run without a receiver and use backend fallback behavior instead

## Environment configuration

The backend reads configuration from `.env`. The frontend does not require a separate `.env` file for basic local use when served by the backend.

### Core backend variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `PORT` | No | Backend HTTP port. Default: `3000` |
| `RECEIVER_ENABLED` | No | Enables/disables receiver mode |
| `GPS_HOST` | Conditional | Receiver host/IP when receiver mode is enabled |
| `GPS_PORT` | No | Receiver TCP port. Default: `23` |
| `GPS_USERNAME` | Conditional | Receiver username when receiver mode is enabled |
| `GPS_PASSWORD` | Conditional | Receiver password when receiver mode is enabled |
| `ALLOWED_ORIGIN` | Recommended | Allowed frontend origin(s) for CORS |
| `SERVE_STATIC` | No | Serve the frontend from Express when `true` |
| `NODE_ENV` | No | Environment mode |

### Optional backend tuning and protection

| Variable | Required | Purpose |
| --- | --- | --- |
| `MIN_CONNECTION_INTERVAL_MS` | No | Minimum spacing between receiver TCP sessions |
| `REQUEST_TIMEOUT_MS` | No | Receiver socket timeout |
| `RECEIVER_STATUS_CACHE_MS` | No | Status cache duration |
| `STATUS_STALE_MS` | No | Backend stale-data threshold |
| `API_AUTH_ENABLED` | No | Enables API token auth when `true` |
| `API_AUTH_TOKEN` | Conditional | Token used when API auth is enabled |
| `RATE_LIMIT_WINDOW_MS` | No | Rate-limit window |
| `RATE_LIMIT_TIME_MAX` | No | Max `/api/time` requests per window |
| `RATE_LIMIT_STATUS_MAX` | No | Max `/api/status` requests per window |
| `RATE_LIMIT_INTERNET_MAX` | No | Max `/api/time/internet` requests per window |
| `RATE_LIMIT_SET_MAX` | No | Max `/api/time/set` requests per window |

## How to run locally

### Option A — Run frontend and backend together

This is the simplest local setup.

```bash
npm start
```

This starts the Express server, serves the frontend, and exposes the API. By default, the app listens on `http://localhost:3000` unless you change `PORT`.

Local routes when using this mode:
- `http://localhost:3000/official-time`
- `http://localhost:3000/dashboard`

### Option B — Run in development with auto-restart

```bash
npm run dev
```

This uses `nodemon` to restart the backend automatically when backend files change.

### Option C — Run backend API without static frontend serving

```bash
npm run start:api
```

Use this when the frontend is hosted separately and should call a standalone backend.

### Option D — Force full local serving mode

```bash
npm run start:full
```

This explicitly enables Express static serving for the frontend.

## Available npm scripts

The following scripts currently exist in `package.json`:

- `npm start` — start the Express backend (`node gps-proxy.js`)
- `npm run dev` — start with `nodemon`
- `npm run start:api` — run backend-only mode with `SERVE_STATIC=false`
- `npm run start:full` — run backend with static asset serving enabled
- `npm run check` — run Node syntax checks across the main backend/frontend scripts
- `npm run test:protocol` — run the protocol harness
- `npm test` — alias for `npm run test:protocol`

## Frontend behavior and UI notes

### Official Time page

The official page is designed as a presentation-style reference display and currently includes:

- large digital Oman time
- analog reference clock
- UTC time
- Oman time
- local device time
- synchronized-vs-device time difference
- current sync/source status summary

### Dashboard page

The dashboard is the operator-focused page and currently includes:

- GPS/source status bar
- digital time tiles with optional milliseconds
- analog watch view
- receiver action buttons for setting receiver time
- Oman date and timezone metadata
- primary source description and sync summary
- monitoring dashboard with severity/integrity badges
- diagnostics and recent event feed

### Responsiveness and visual behavior

The styles are split into modular CSS files and include responsive behavior for smaller screens, old-style analog mode, and analog-only mode. The UI also supports:

- saved dark mode preference
- saved precision preference
- fullscreen toggle through keyboard shortcut
- adaptive routing links that work with configured site base URLs

### Keyboard shortcuts on the dashboard

- `1` — digital mode
- `2` — old style watch mode
- `3` — analog-only mode
- `D` — toggle dark mode
- `F` — toggle fullscreen
- `Space` — pause/resume rendering
- `Esc` — leave analog-only mode

## Deployment notes

### Netlify/static frontend deployment

The repository includes a `netlify.toml` file that:

- publishes the repository root
- redirects `/` to `/official-time.html`
- maps `/official-time` to `official-time.html`
- maps `/dashboard` to `index.html`
- applies no-store cache headers

This means the frontend can be deployed as a static site on Netlify.

### Backend deployment

The backend is a local/hosted Node.js Express service defined in `gps-proxy.js`. If you deploy the frontend separately from the backend, you can point the frontend to a hosted API.

The frontend supports these configuration methods before scripts load:

- `window.APP_CONFIG.API_BASE_URL = "https://your-backend.example.com/api"`
- `<meta name="rafo-api-base-url" content="https://your-backend.example.com/api">`

Optional backup API:

- `window.APP_CONFIG.API_BACKUP_URL = "https://backup-backend.example.com/api"`
- `<meta name="rafo-api-backup-url" content="https://backup-backend.example.com/api">`

The frontend also supports a site base URL override for generated internal links.

## Troubleshooting and important notes

- If `npm start` fails immediately, make sure you already ran `npm install`.
- If you are using receiver mode, invalid `GPS_HOST`, `GPS_USERNAME`, or `GPS_PASSWORD` values will prevent receiver-backed operation.
- If the receiver is intentionally unavailable, set `RECEIVER_ENABLED=false` to run in fallback-oriented mode.
- If the frontend is hosted on a different origin than the backend, make sure `ALLOWED_ORIGIN` is configured correctly.
- If API auth is enabled, the frontend must be given the matching token.
- If the backend is unavailable, the frontend can still display local fallback time, but authoritative backend features will be unavailable.
- `.env` is intended for local/private deployment settings and should not be committed.

## Testing and checks

Run the protocol harness:

```bash
npm test
```

Run the syntax checks:

```bash
npm run check
```

## Credits

- Project branding: **Royal Air Force of Oman Calibration Center (CACE)**
- Repository / author reference: **Coded by AlHuDaR** — <https://github.com/AlHuDaR/TIME-CACE/tree/main>
