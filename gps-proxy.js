require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const net = require("net");

const app = express();
app.set("trust proxy", 1);

const CONFIG = Object.freeze({
  port: Number(process.env.PORT || 3000),
  gpsHost: process.env.GPS_HOST || "127.0.0.1",
  gpsPort: Number(process.env.GPS_PORT || 23),
  gpsUsername: process.env.GPS_USERNAME || "",
  gpsPassword: process.env.GPS_PASSWORD || "",
  allowedOrigins: Object.freeze(
    (process.env.ALLOWED_ORIGIN || "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  ),
  serveStatic: process.env.SERVE_STATIC
    ? process.env.SERVE_STATIC === "true"
    : process.env.NODE_ENV !== "production",
  nodeEnv: process.env.NODE_ENV || "development",
  omanOffsetMs: 4 * 60 * 60 * 1000,
  minConnectionIntervalMs: Number(process.env.MIN_CONNECTION_INTERVAL_MS || 5000),
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 15000),
  receiverStatusCacheMs: Number(process.env.RECEIVER_STATUS_CACHE_MS || 4000),
  authEnabled: process.env.API_AUTH_ENABLED === "true",
  authToken: process.env.API_AUTH_TOKEN || "",
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000),
  rateLimitTimeMax: Number(process.env.RATE_LIMIT_TIME_MAX || 90),
  rateLimitStatusMax: Number(process.env.RATE_LIMIT_STATUS_MAX || 30),
  rateLimitInternetMax: Number(process.env.RATE_LIMIT_INTERNET_MAX || 60),
  rateLimitSetMax: Number(process.env.RATE_LIMIT_SET_MAX || 8),
});

const publicPath = path.resolve(__dirname);
const isProduction = CONFIG.nodeEnv === "production";
const devOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
];
const allowedOrigins = new Set([
  ...CONFIG.allowedOrigins,
  ...(!isProduction ? devOrigins : []),
]);

let lastConnectionAttempt = 0;
let lastReceiverSnapshot = {
  backendOnline: true,
  receiverReachable: false,
  loginOk: false,
  isLocked: false,
  statusText: "Receiver status not checked yet",
  currentSource: "local",
  lastError: null,
  checkedAt: null,
};
let receiverStatusCache = {
  expiresAt: 0,
  promise: null,
  data: null,
};

const rateLimitStore = new Map();

function isOriginAllowed(origin) {
  if (!origin) {
    return true;
  }

  if (allowedOrigins.size > 0) {
    return allowedOrigins.has(origin);
  }

  return !isProduction;
}

app.use(cors({
  origin(origin, callback) {
    if (isOriginAllowed(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error("Origin not allowed by CORS"));
  },
}));
app.use(express.json());

if (CONFIG.serveStatic) {
  app.use(express.static(publicPath));
}

function createOmanDateFormatter(options = {}) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Muscat",
    ...options,
  });
}

const OMAN_DATE_FORMATTER = createOmanDateFormatter({
  month: "2-digit",
  day: "2-digit",
  year: "numeric",
});

const OMAN_TIME_FORMATTER = createOmanDateFormatter({
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function formatOmanDate(date) {
  return OMAN_DATE_FORMATTER.format(date);
}

function formatOmanTime(date) {
  return OMAN_TIME_FORMATTER.format(date);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseBoolean(value) {
  return value === true || value === "true" || value === "1";
}

function getAuthTokenFromRequest(req) {
  const authorization = req.get("authorization") || "";
  if (/^Bearer\s+/i.test(authorization)) {
    return authorization.replace(/^Bearer\s+/i, "").trim();
  }

  const apiKey = req.get("x-api-key");
  if (typeof apiKey === "string" && apiKey.trim()) {
    return apiKey.trim();
  }

  return "";
}

function jsonError(res, statusCode, error, extras = {}) {
  res.status(statusCode).json({
    success: false,
    error,
    backendOnline: true,
    ...extras,
  });
}

function requireApiAuth(req, res, next) {
  if (!CONFIG.authEnabled) {
    next();
    return;
  }

  if (!CONFIG.authToken) {
    jsonError(res, 500, "API auth is enabled but API_AUTH_TOKEN is not configured");
    return;
  }

  const providedToken = getAuthTokenFromRequest(req);
  if (providedToken && providedToken === CONFIG.authToken) {
    next();
    return;
  }

  res.set("WWW-Authenticate", 'Bearer realm="RAFO Calibration Center API"');
  jsonError(res, 401, "Authentication required");
}

function getClientIdentifier(req) {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function createRateLimiter({ key, windowMs, maxRequests }) {
  return (req, res, next) => {
    const now = Date.now();
    const clientKey = `${key}:${getClientIdentifier(req)}`;
    const entry = rateLimitStore.get(clientKey);

    if (!entry || entry.resetAt <= now) {
      rateLimitStore.set(clientKey, {
        count: 1,
        resetAt: now + windowMs,
      });
      next();
      return;
    }

    entry.count += 1;
    if (entry.count <= maxRequests) {
      next();
      return;
    }

    const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    res.set("Retry-After", String(retryAfterSeconds));
    jsonError(res, 429, "Rate limit exceeded", {
      route: key,
      retryAfterSeconds,
    });
  };
}

async function throttleReceiverAccess() {
  const now = Date.now();
  const elapsed = now - lastConnectionAttempt;
  if (elapsed < CONFIG.minConnectionIntervalMs) {
    await wait(CONFIG.minConnectionIntervalMs - elapsed);
  }
  lastConnectionAttempt = Date.now();
}

function createLocalFallback(extra = {}) {
  const now = new Date();
  return {
    success: false,
    source: "local",
    currentSource: "local",
    currentSourceLabel: "Local computer time",
    date: formatOmanDate(now),
    time: formatOmanTime(now),
    timezone: "GST (UTC+04:00)",
    timestamp: now.getTime(),
    backendOnline: true,
    receiverReachable: false,
    loginOk: false,
    isLocked: false,
    statusText: "Using local fallback",
    lastError: null,
    ...extra,
  };
}

async function getPreciseInternetTime() {
  const timeSources = [
    "https://time.google.com",
    "https://www.time.gov",
    "https://www.microsoft.com",
  ];

  const measurements = await Promise.allSettled(
    timeSources.map(async (url) => {
      const start = Date.now();
      const response = await fetch(url, { method: "HEAD", timeout: 5000 });
      const end = Date.now();
      return {
        url,
        rtt: end - start,
        date: response.headers.get("date"),
      };
    }),
  );

  const successful = measurements
    .filter((entry) => entry.status === "fulfilled" && entry.value.date)
    .map((entry) => entry.value);

  if (successful.length === 0) {
    throw new Error("No Internet time sources reachable");
  }

  const best = successful.reduce((previous, current) => (previous.rtt < current.rtt ? previous : current));
  const serverTime = new Date(best.date);
  const adjustedTime = new Date(serverTime.getTime() + Math.round(best.rtt / 2));

  return {
    timestamp: adjustedTime.getTime(),
    rtt: best.rtt,
    sourcesReached: successful.length,
  };
}

function parseGpsTimeResponse(raw) {
  const normalized = raw.replace(/\0/g, " ").replace(/\s+/g, " ").trim();
  const match = normalized.match(/F3\s+\w+\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/i)
    || normalized.match(/(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/);

  if (!match) {
    throw new Error("Could not parse receiver time response");
  }

  const [, dateStr, timeStr] = match;
  const [month, day, year] = dateStr.split("/").map(Number);
  const [hours, minutes, seconds] = timeStr.split(":").map(Number);
  const utcTimestamp = Date.UTC(year, month - 1, day, hours, minutes, seconds) - CONFIG.omanOffsetMs;

  const explicitUnlocked = /(UNLOCK|HOLDOVER|NO\s+GPS|ANTENNA\s+FAULT|SEARCHING)/i.test(normalized);
  const explicitLocked = /(LOCKED|TRACKING|GPS\s+LOCK)/i.test(normalized);
  const defaultDatePattern = /01\/01\/(1999|2000|2026)/.test(dateStr);
  const isLocked = explicitLocked ? true : explicitUnlocked ? false : !defaultDatePattern;
  const statusText = isLocked
    ? "GPS receiver reachable and locked"
    : "GPS receiver reachable but not locked";

  return {
    raw: normalized,
    date: dateStr,
    time: timeStr,
    timestamp: utcTimestamp,
    isLocked,
    statusText,
    currentSource: isLocked ? "gps-locked" : "gps-unlocked",
    currentSourceLabel: isLocked ? "GPS receiver locked" : "GPS receiver reachable but unlocked",
  };
}

function connectToGPS(command, { expectOk = false } = {}) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let buffer = "";
    let loginOk = false;
    let receiverReachable = false;
    let state = "connecting";
    let settled = false;

    const finish = (handler, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      handler(value);
    };

    const timeout = setTimeout(() => {
      finish(reject, new Error("Connection timeout"));
    }, CONFIG.requestTimeoutMs);

    socket.connect(CONFIG.gpsPort, CONFIG.gpsHost, () => {
      receiverReachable = true;
    });

    socket.on("data", (chunk) => {
      buffer += chunk.toString();

      if (state === "connecting" && buffer.includes("USER NAME:")) {
        state = "username";
        buffer = "";
        socket.write(`${CONFIG.gpsUsername}\r\n`);
        return;
      }

      if (state === "username" && buffer.includes("PASSWORD:")) {
        state = "password";
        buffer = "";
        socket.write(`${CONFIG.gpsPassword}\r\n`);
        return;
      }

      if (state === "password" && /LOGIN SUCCESSFUL!/i.test(buffer)) {
        loginOk = true;
        state = "command";
        buffer = "";
        setTimeout(() => {
          socket.write(command);
        }, 250);
        return;
      }

      if (state === "command") {
        const complete = expectOk ? /\bOK\b/i.test(buffer) : /F3|\d{2}\/\d{2}\/\d{4}/.test(buffer);
        if (complete) {
          finish(resolve, {
            receiverReachable,
            loginOk,
            raw: buffer,
          });
        }
      }
    });

    socket.on("error", (error) => {
      finish(reject, error);
    });

    socket.on("close", () => {
      if (settled) {
        return;
      }
      if (buffer && (expectOk ? /\bOK\b/i.test(buffer) : /F3|\d{2}\/\d{2}\/\d{4}/.test(buffer))) {
        finish(resolve, {
          receiverReachable,
          loginOk,
          raw: buffer,
        });
        return;
      }
      finish(reject, new Error(loginOk ? "Socket closed unexpectedly" : "Receiver login failed or socket closed unexpectedly"));
    });
  });
}

function updateReceiverSnapshot(snapshot) {
  lastReceiverSnapshot = {
    backendOnline: true,
    checkedAt: new Date().toISOString(),
    ...snapshot,
  };
  return lastReceiverSnapshot;
}

function sanitizeReceiverStatus(snapshot = lastReceiverSnapshot) {
  return {
    backendOnline: true,
    receiverReachable: Boolean(snapshot.receiverReachable),
    loginOk: Boolean(snapshot.loginOk),
    isLocked: Boolean(snapshot.isLocked),
    statusText: snapshot.statusText || "Receiver status unavailable",
    currentSource: snapshot.currentSource || "local",
    lastError: snapshot.lastError || null,
    checkedAt: snapshot.checkedAt || null,
  };
}

async function readReceiverTime() {
  await throttleReceiverAccess();

  const connection = await connectToGPS("F3\r\n");
  const parsed = parseGpsTimeResponse(connection.raw);

  const snapshot = updateReceiverSnapshot({
    receiverReachable: connection.receiverReachable,
    loginOk: connection.loginOk,
    isLocked: parsed.isLocked,
    statusText: parsed.statusText,
    currentSource: parsed.currentSource,
    lastError: null,
  });

  return {
    success: true,
    source: "gps-receiver",
    timezone: "GST (UTC+04:00)",
    backendOnline: true,
    receiverReachable: snapshot.receiverReachable,
    loginOk: snapshot.loginOk,
    isLocked: snapshot.isLocked,
    statusText: snapshot.statusText,
    currentSource: snapshot.currentSource,
    currentSourceLabel: parsed.currentSourceLabel,
    lastError: null,
    date: parsed.date,
    time: parsed.time,
    timestamp: parsed.timestamp,
    raw: parsed.raw,
  };
}

async function readReceiverStatusCached({ force = false } = {}) {
  const now = Date.now();
  if (!force && receiverStatusCache.data && receiverStatusCache.expiresAt > now) {
    return receiverStatusCache.data;
  }

  if (!force && receiverStatusCache.promise) {
    return receiverStatusCache.promise;
  }

  receiverStatusCache.promise = readReceiverTime()
    .then((receiverTime) => {
      const status = sanitizeReceiverStatus({
        ...lastReceiverSnapshot,
        receiverReachable: receiverTime.receiverReachable,
        loginOk: receiverTime.loginOk,
        isLocked: receiverTime.isLocked,
        statusText: receiverTime.statusText,
        currentSource: receiverTime.currentSource,
        lastError: null,
      });
      receiverStatusCache = {
        promise: null,
        data: status,
        expiresAt: Date.now() + CONFIG.receiverStatusCacheMs,
      };
      return status;
    })
    .catch((error) => {
      receiverStatusCache = {
        promise: null,
        data: null,
        expiresAt: 0,
      };
      throw error;
    });

  return receiverStatusCache.promise;
}

const timeRateLimiter = createRateLimiter({
  key: "api-time",
  windowMs: CONFIG.rateLimitWindowMs,
  maxRequests: CONFIG.rateLimitTimeMax,
});
const statusRateLimiter = createRateLimiter({
  key: "api-status",
  windowMs: CONFIG.rateLimitWindowMs,
  maxRequests: CONFIG.rateLimitStatusMax,
});
const internetRateLimiter = createRateLimiter({
  key: "api-time-internet",
  windowMs: CONFIG.rateLimitWindowMs,
  maxRequests: CONFIG.rateLimitInternetMax,
});
const setTimeRateLimiter = createRateLimiter({
  key: "api-time-set",
  windowMs: CONFIG.rateLimitWindowMs,
  maxRequests: CONFIG.rateLimitSetMax,
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    backendOnline: true,
    serveStatic: CONFIG.serveStatic,
    authEnabled: CONFIG.authEnabled,
  });
});

app.get("/api/status", requireApiAuth, statusRateLimiter, async (req, res) => {
  try {
    const forceRefresh = parseBoolean(req.query.refresh);
    const status = await readReceiverStatusCached({ force: forceRefresh });
    res.json(status);
  } catch (error) {
    const snapshot = updateReceiverSnapshot({
      receiverReachable: false,
      loginOk: false,
      isLocked: false,
      statusText: "Receiver unreachable",
      currentSource: "local",
      lastError: error.message,
    });

    res.status(503).json(sanitizeReceiverStatus(snapshot));
  }
});

app.get("/api/time", requireApiAuth, timeRateLimiter, async (req, res) => {
  try {
    const receiverTime = await readReceiverTime();
    receiverStatusCache = {
      promise: null,
      data: sanitizeReceiverStatus(lastReceiverSnapshot),
      expiresAt: Date.now() + CONFIG.receiverStatusCacheMs,
    };
    res.json(receiverTime);
  } catch (error) {
    const fallback = createLocalFallback({
      error: error.message,
      statusText: "GPS receiver unavailable",
      lastError: error.message,
    });

    updateReceiverSnapshot({
      receiverReachable: false,
      loginOk: false,
      isLocked: false,
      statusText: fallback.statusText,
      currentSource: "local",
      lastError: error.message,
    });

    receiverStatusCache = {
      promise: null,
      data: sanitizeReceiverStatus(lastReceiverSnapshot),
      expiresAt: Date.now() + CONFIG.receiverStatusCacheMs,
    };

    res.status(503).json(fallback);
  }
});

app.post("/api/time/set", requireApiAuth, setTimeRateLimiter, async (req, res) => {
  try {
    const useInternet = Boolean(req.body?.useInternet);
    let omanTimestamp;
    let source;

    if (useInternet) {
      const internetTime = await getPreciseInternetTime();
      omanTimestamp = internetTime.timestamp + CONFIG.omanOffsetMs;
      source = "Internet";
    } else {
      omanTimestamp = Date.now() + CONFIG.omanOffsetMs;
      source = "Computer";
    }

    const omanDate = new Date(omanTimestamp);
    const mm = String(omanDate.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(omanDate.getUTCDate()).padStart(2, "0");
    const yyyy = omanDate.getUTCFullYear();
    const hh = String(omanDate.getUTCHours()).padStart(2, "0");
    const min = String(omanDate.getUTCMinutes()).padStart(2, "0");
    const ss = String(omanDate.getUTCSeconds()).padStart(2, "0");

    await throttleReceiverAccess();
    const command = `F3 UTC ${mm}/${dd}/${yyyy} ${hh}:${min}:${ss}\r\n`;
    const result = await connectToGPS(command, { expectOk: true });

    updateReceiverSnapshot({
      receiverReachable: result.receiverReachable,
      loginOk: result.loginOk,
      isLocked: lastReceiverSnapshot.isLocked,
      statusText: "Receiver time updated successfully",
      currentSource: lastReceiverSnapshot.currentSource,
      lastError: null,
    });

    receiverStatusCache = {
      promise: null,
      data: sanitizeReceiverStatus(lastReceiverSnapshot),
      expiresAt: Date.now() + CONFIG.receiverStatusCacheMs,
    };

    res.json({
      success: true,
      message: "GPS time set successfully",
      date: `${mm}/${dd}/${yyyy}`,
      time: `${hh}:${min}:${ss}`,
      timezone: "GST (UTC+04:00)",
      source,
      backendOnline: true,
    });
  } catch (error) {
    updateReceiverSnapshot({
      receiverReachable: false,
      loginOk: false,
      isLocked: false,
      statusText: "Failed to set receiver time",
      currentSource: "local",
      lastError: error.message,
    });

    receiverStatusCache = {
      promise: null,
      data: sanitizeReceiverStatus(lastReceiverSnapshot),
      expiresAt: Date.now() + CONFIG.receiverStatusCacheMs,
    };

    res.status(500).json({
      success: false,
      error: error.message,
      backendOnline: true,
    });
  }
});

app.get("/api/time/internet", requireApiAuth, internetRateLimiter, async (req, res) => {
  try {
    const internetTime = await getPreciseInternetTime();
    const omanDisplayTime = new Date(internetTime.timestamp + CONFIG.omanOffsetMs);

    res.json({
      success: true,
      source: "internet-http-date",
      currentSource: "internet-fallback",
      currentSourceLabel: "Internet fallback",
      date: formatOmanDate(omanDisplayTime),
      time: formatOmanTime(omanDisplayTime),
      timezone: "GST (UTC+04:00)",
      timestamp: internetTime.timestamp,
      backendOnline: true,
      receiverReachable: lastReceiverSnapshot.receiverReachable,
      loginOk: lastReceiverSnapshot.loginOk,
      isLocked: false,
      statusText: "Using Internet time fallback via backend",
      lastError: null,
      rtt: internetTime.rtt,
      sourcesReached: internetTime.sourcesReached,
    });
  } catch (error) {
    const fallback = createLocalFallback({
      error: error.message,
      statusText: "Internet time fallback unavailable",
      lastError: error.message,
    });

    res.status(503).json(fallback);
  }
});

if (CONFIG.serveStatic) {
  app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
  });
}

app.listen(CONFIG.port, () => {
  console.log(`GPS backend listening on http://localhost:${CONFIG.port}`);
  console.log(`Receiver target: ${CONFIG.gpsHost}:${CONFIG.gpsPort}`);
  console.log(`Static frontend serving: ${CONFIG.serveStatic ? "enabled" : "disabled"}`);
  console.log(`API auth: ${CONFIG.authEnabled ? "enabled" : "disabled"}`);
  console.log(
    `CORS policy: ${allowedOrigins.size > 0 ? Array.from(allowedOrigins).join(", ") : isProduction ? "same-origin / non-browser only until ALLOWED_ORIGIN is set" : "development-open"}`,
  );
});
