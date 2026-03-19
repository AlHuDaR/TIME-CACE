# RAFO Calibration Center Time Display

RAFO Calibration Center Time Display is a browser-based Oman time dashboard for the **Royal Air Force of Oman (RAFO) Calibration Center**. The frontend preserves the current digital and analog clock experience, while the backend connects to a **Symmetricom XLi GPS time/frequency receiver** over TCP/Telnet and exposes structured API endpoints for the UI.

## Architecture

### Frontend

- Static frontend built from `index.html`, `styles.css`, and `script.js`.
- Intended to be deployed on **Netlify**.
- Can consume:
  - same-origin `/api` routes if a reverse proxy exists, or
  - a separately hosted backend via `window.APP_CONFIG.API_BASE_URL`.

### Backend

`gps-proxy.js` is an **Express backend** that:

- logs into the Symmetricom XLi receiver,
- reads and sets receiver time,
- provides Internet fallback time derived from HTTP `Date` headers,
- returns structured runtime source and lock state for the frontend.

The backend should be deployed separately from Netlify, for example on a private VM, Docker host, or internal Node.js service.

## Features

- Oman time display in digital mode.
- Old-style analog watch mode.
- Analog-only fullscreen mode.
- GPS status bar with receiver/runtime source messaging.
- Dark mode toggle.
- Precision toggle for milliseconds.
- Set GPS time from computer or Internet fallback source.
- Structured backend status endpoint for lock and reachability reporting.

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
- `statusText`
- `currentSource`
- `lastError`

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

See `.env.example` for a template.

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
  - Internet fallback,
  - local fallback.

## Security Notes

- Store receiver credentials only in environment variables.
- Restrict backend CORS with `ALLOWED_ORIGIN` in production.
- Keep the backend on a trusted network if it can reach the receiver over Telnet/TCP.
- The Internet fallback endpoint uses HTTP response headers as a pragmatic fallback source; it is not a true NTP implementation.
