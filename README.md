# RAFO Calibration Center Time Display

TIME-CACE is the Royal Air Force of Oman Calibration Center (CACE) reference-time application. It combines a browser UI with a Node.js/Express backend that reads a Symmetricom / Microchip XLi receiver when available and then degrades through a controlled backend-managed timing hierarchy.

## Architecture summary

- The **backend is the authoritative timing engine**.
- The **frontend displays the backend-selected source, status, and monitoring metadata** whenever backend data is available.
- A **frontend emergency fallback hierarchy** is used **only** when the backend is unreachable, times out, or returns invalid/unusable JSON.
- The application **does not scrape HTML clock pages**.
- Receiver logic remains backend-only and uses the configured LAN / receiver connection.

## Pages and routes

- `/official-time` — presentation-focused official time page.
- `/dashboard` — operational dashboard with receiver status, source cards, and controls.
- `/` — redirects to `/official-time` when served by Express and to `/official-time.html` in Netlify.

## Time Source Priority and Fallback Logic

The backend resolves time in this exact order:

1. **GPS Receiver (XLi)**
   - Used by the backend through the configured receiver connection on the local network.
   - This is the primary reference source.
   - Internet is not required.

2. **NTP (NIST)**
   - Used by the backend over the internet.
   - This is the first traceable fallback when the receiver is unavailable.

3. **NTP (NPL India)**
   - Used by the backend over the internet.
   - This is the second traceable fallback if NIST is unavailable.

4. **HTTPS Time API (WorldTimeAPI)**
   - Used by the backend over standard HTTPS internet access.
   - This is a non-traceable internet fallback.

5. **HTTPS Time API (TimeAPI.io)**
   - Used by the backend over standard HTTPS internet access.
   - This is another non-traceable internet fallback.

6. **HTTP Date Header**
   - Used by the backend by reading server Date headers from reachable HTTPS/HTTP endpoints.
   - This is a lower-confidence internet fallback.

7. **Local Clock**
   - Used by the backend only as the final emergency fallback if all remote backend sources fail.
   - If the backend itself is unavailable or returns invalid data, the frontend uses its own emergency fallback chain described below.

## Frontend Emergency Fallback Mode

The frontend keeps the backend-first design intact:

- If `GET /api/time` returns usable JSON, the frontend uses the backend-selected `sourceKey`, `sourceLabel`, `status`, and timing data exactly as returned.
- If the backend is unavailable, times out, returns non-OK data that cannot be used, returns invalid JSON, or omits the required runtime timestamp, the frontend activates the emergency hierarchy below.
- Frontend emergency sources are **continuity fallbacks only**. They are **not equivalent to GPS or traceable NTP**.

When backend runtime data cannot be used, the frontend now tries:

1. **HTTPS TIME API (WorldTimeAPI)**
2. **HTTPS TIME API (TimeAPI.io)**
3. **INTERNET/HTTP DATE**
4. **BROWSER LOCAL CLOCK**

### Frontend emergency labels

- `HTTPS TIME API (WorldTimeAPI)` / `Internet fallback active`
- `HTTPS TIME API (TimeAPI.io)` / `Internet fallback active`
- `INTERNET/HTTP DATE` / `Internet fallback active`
- `BROWSER LOCAL CLOCK` / `Browser emergency fallback active`

### Interpretation notes

- `LOCAL CLOCK` means the **backend** is still online and explicitly selected its own workstation/local emergency fallback.
- `BROWSER LOCAL CLOCK` means the **frontend** could not get usable backend timing and also could not get usable browser-accessible internet time.
- Browser fallbacks are intentionally labeled differently so they are never confused with GPS, NTP, or backend-selected sources.

### Browser / CORS limitations

- Browser access to third-party time services depends on each provider allowing cross-origin requests.
- Browser access to HTTP `Date` headers depends on the endpoint exposing that header to JavaScript via CORS response headers such as `Access-Control-Expose-Headers: Date`.
- If a third-party API is blocked by CORS, times out, or returns an invalid payload, the frontend catches the failure quietly and moves to the next emergency source.
- The frontend keeps ticking locally between successful emergency refreshes to avoid excessive third-party polling.
- No new npm dependencies were required for the frontend emergency fallback implementation.

## Source labels and status language

### Source labels

- `GPS RECEIVER (XLi)`
- `NTP (NIST)`
- `NTP (NPL India)`
- `HTTPS TIME API (WorldTimeAPI)`
- `HTTPS TIME API (TimeAPI.io)`
- `INTERNET/HTTP DATE`
- `LOCAL CLOCK`
- `BROWSER LOCAL CLOCK`

### Status wording

- `Primary reference active`
- `Traceable fallback active`
- `Internet fallback active`
- `Emergency local fallback active`
- `Browser emergency fallback active`

## Backend API endpoints

- `GET /api/health` — backend health/configuration summary.
- `GET /api/status` — receiver reachability, GPS lock state, active backend source, and monitoring snapshot.
- `GET /api/time` — authoritative runtime time using the full source priority chain.
- `GET /api/time/internet` — backend fallback-only resolver that skips the receiver and uses the internet/local hierarchy.
- `POST /api/time/set` — writes time to the receiver using either the local workstation time or the backend fallback hierarchy.

## Key implementation files

- `gps-proxy.js` — Express API, receiver access, timing payload shaping, and static serving.
- `time-source-service.js` — backend NTP, HTTPS API, HTTP Date, and local fallback resolution.
- `receiver-protocol.js` — receiver TCP helpers, parsing, and configuration validation.
- `runtime-sync.js` — frontend synchronization runtime, backend-first validation, and frontend emergency fallback handling.
- `status-monitor.js` — frontend monitoring normalization and severity logic.
- `dashboard-render.js` — dashboard cards, badges, and monitoring presentation.
- `fallback-card.js` — controlled fallback notification card behavior.
- `official-time.js` — official time page source/status presentation.
- `.env.example` — backend configuration example.

## Requirements

- **Node.js 18 or newer**
- **npm**

## Installation and startup

### Windows Command Prompt

```bat
npm install
copy .env.example .env
npm start
```

### Windows PowerShell

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

Then open either:

- `http://localhost:3000/official-time`
- `http://localhost:3000/dashboard`

## Runtime commands

- `npm start` — run the backend with static assets.
- `npm run dev` — run the backend with `nodemon`.
- `npm run start:api` — run API-only mode.
- `npm run start:full` — run backend plus static frontend serving.
- `npm run check` — syntax-check backend and frontend scripts.
- `npm test` — run local protocol, time-source, and runtime harnesses.

## Environment variables

### Core settings

| Variable | Required | Purpose |
| --- | --- | --- |
| `PORT` | No | Backend HTTP port. Default: `3000` |
| `RECEIVER_ENABLED` | No | Enables or disables XLi receiver integration |
| `GPS_HOST` | Conditional | Receiver host/IP when receiver mode is enabled |
| `GPS_PORT` | No | Receiver TCP port. Default: `23` |
| `GPS_USERNAME` | Conditional | Receiver username |
| `GPS_PASSWORD` | Conditional | Receiver password |
| `ALLOWED_ORIGIN` | Recommended | Allowed frontend origin(s) for CORS |
| `SERVE_STATIC` | No | Serve frontend files from Express when `true` |
| `NODE_ENV` | No | Node environment |

### Timing and fallback settings

| Variable | Required | Purpose |
| --- | --- | --- |
| `MIN_CONNECTION_INTERVAL_MS` | No | Minimum gap between receiver TCP connections |
| `REQUEST_TIMEOUT_MS` | No | Receiver socket timeout |
| `RECEIVER_STATUS_CACHE_MS` | No | Status cache duration |
| `STATUS_STALE_MS` | No | Backend stale-status threshold |
| `NTP_TIMEOUT_MS` | No | Per-NTP-source timeout in milliseconds |
| `HTTPS_TIME_API_TIMEOUT_MS` | No | Per-HTTPS-time-API timeout in milliseconds |
| `HTTP_DATE_TIMEOUT_MS` | No | Per-HTTP-Date-source timeout in milliseconds |
| `NTP_NIST_HOSTS` | No | Comma-separated NIST NTP hosts |
| `NTP_NPL_HOSTS` | No | Comma-separated NPL India/public NTP hosts |
| `WORLD_TIME_API_URLS` | No | Comma-separated WorldTimeAPI endpoint list |
| `TIMEAPI_IO_URLS` | No | Comma-separated TimeAPI.io endpoint list |
| `HTTP_DATE_URLS` | No | Comma-separated endpoints used for Date-header fallback |

### Protection settings

| Variable | Required | Purpose |
| --- | --- | --- |
| `API_AUTH_ENABLED` | No | Enable token auth |
| `API_AUTH_TOKEN` | Conditional | Token used when auth is enabled |
| `RATE_LIMIT_WINDOW_MS` | No | Rate-limit window |
| `RATE_LIMIT_TIME_MAX` | No | Max `/api/time` requests per window |
| `RATE_LIMIT_STATUS_MAX` | No | Max `/api/status` requests per window |
| `RATE_LIMIT_INTERNET_MAX` | No | Max `/api/time/internet` requests per window |
| `RATE_LIMIT_SET_MAX` | No | Max `/api/time/set` requests per window |

## Frontend behavior notes

- When backend JSON is valid, the frontend trusts the backend-selected `sourceKey`, `sourceLabel`, `status`, and monitoring metadata.
- Receiver unreachability **does not** mean the backend is offline; the backend may still select a valid fallback source.
- `LOCAL CLOCK` appears only when the backend explicitly selects it.
- `BROWSER LOCAL CLOCK` appears only when `/api/time` cannot provide valid backend data and the browser-accessible emergency internet hierarchy also fails.
- Frontend emergency internet labels indicate a browser-side continuity mode, not a traceable or authoritative replacement for backend GPS/NTP selection.
- The UI keeps the dashboard/official-time layout intact while updating source cards, lock state messaging, and fallback wording to match the backend model.

## Testing

Run all checks locally:

```bash
npm run check
npm test
```

## Reference notes

The traceable fallback chain aligns with public institutional time-distribution services such as NIST and NPL India. The non-traceable layers are continuity fallbacks only and should be treated as lower-confidence operational backup sources.

## Credits

- Project branding: **Royal Air Force of Oman Calibration Center (CACE)**
- Repository / author reference: **Coded by AlHuDaR** — <https://github.com/AlHuDaR/TIME-CACE/tree/main>
