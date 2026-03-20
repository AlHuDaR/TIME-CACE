require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const {
  validateConfig,
  parseReceiverAcknowledgement,
  parseGpsTimeResponse,
  classifyReceiverError,
  connectToGPS,
} = require("./receiver-protocol");

const app = express();
app.set("trust proxy", 1);

const receiverEnabled = process.env.RECEIVER_ENABLED
  ? parseBoolean(process.env.RECEIVER_ENABLED)
  : Boolean((process.env.GPS_HOST || "").trim() && (process.env.GPS_USERNAME || "").trim() && (process.env.GPS_PASSWORD || "").trim());

function readEnvNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return fallback;
  }

  return Number(raw);
}

const FRONTEND_ASSET_FILES = Object.freeze([
  "index.html",
  "api-client.js",
  "status-monitor.js",
  "fallback-card.js",
  "runtime-sync.js",
  "dashboard-render.js",
  "ui-controls.js",
  "main.js",
  "styles.css",
]);

const CONFIG = validateConfig({
  port: readEnvNumber("PORT", 3000),
  gpsHost: process.env.GPS_HOST || "",
  gpsPort: readEnvNumber("GPS_PORT", 23),
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
  minConnectionIntervalMs: readEnvNumber("MIN_CONNECTION_INTERVAL_MS", 5000),
  requestTimeoutMs: readEnvNumber("REQUEST_TIMEOUT_MS", 15000),
  receiverStatusCacheMs: readEnvNumber("RECEIVER_STATUS_CACHE_MS", 4000),
  statusStaleMs: readEnvNumber("STATUS_STALE_MS", 45000),
  authEnabled: process.env.API_AUTH_ENABLED === "true",
  authToken: process.env.API_AUTH_TOKEN || "",
  rateLimitWindowMs: readEnvNumber("RATE_LIMIT_WINDOW_MS", 60000),
  rateLimitTimeMax: readEnvNumber("RATE_LIMIT_TIME_MAX", 90),
  rateLimitStatusMax: readEnvNumber("RATE_LIMIT_STATUS_MAX", 30),
  rateLimitInternetMax: readEnvNumber("RATE_LIMIT_INTERNET_MAX", 60),
  rateLimitSetMax: readEnvNumber("RATE_LIMIT_SET_MAX", 8),
  receiverEnabled,
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
let lastRateLimitPruneAt = 0;
let lastReceiverSnapshot = {
  backendOnline: true,
  receiverConfigured: CONFIG.receiverEnabled,
  receiverReachable: false,
  loginOk: false,
  isLocked: false,
  gpsLockState: "unknown",
  statusText: "Receiver status not checked yet",
  currentSource: "local",
  currentSourceLabel: CONFIG.receiverEnabled ? "Local fallback" : "Backend Internet fallback",
  receiverCommunicationState: CONFIG.receiverEnabled ? "not-started" : "disabled",
  fallbackReason: CONFIG.receiverEnabled ? null : "receiver-not-configured",
  lastError: null,
  checkedAt: null,
};
let receiverStatusCache = {
  expiresAt: 0,
  promise: null,
  data: null,
};
let monitoringMemory = {
  lastKnownGoodGpsLockAt: null,
  lastSuccessfulReceiverCommunicationAt: null,
  lastSuccessfulAuthoritativeTimeSyncAt: null,
  statusBecameStaleAt: null,
  communicationIssueCount: 0,
};

const rateLimitStore = new Map();

function pruneExpiredRateLimitEntries(now = Date.now()) {
  if (now - lastRateLimitPruneAt < Math.min(CONFIG.rateLimitWindowMs, 10000)) {
    return;
  }

  lastRateLimitPruneAt = now;
  for (const [clientKey, entry] of rateLimitStore.entries()) {
    if (!entry || entry.resetAt <= now) {
      rateLimitStore.delete(clientKey);
    }
  }
}

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
    pruneExpiredRateLimitEntries(now);
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
  const payload = {
    success: false,
    source: "local",
    currentSource: "local",
    currentSourceLabel: "Local computer time",
    date: formatOmanDate(now),
    time: formatOmanTime(now),
    timezone: "GST (UTC+04:00)",
    timestamp: now.getTime(),
    backendOnline: true,
    receiverConfigured: CONFIG.receiverEnabled,
    receiverReachable: false,
    loginOk: false,
    isLocked: false,
    gpsLockState: "unknown",
    statusText: "Using local fallback",
    fallbackReason: "backend-fallback-unavailable",
    lastError: null,
    ...extra,
  };
  payload.monitoringState = deriveMonitoringState(payload, { dataState: "unavailable", stale: true });
  payload.lastKnownGoodGpsLockAt = monitoringMemory.lastKnownGoodGpsLockAt;
  payload.lastSuccessfulReceiverCommunicationAt = monitoringMemory.lastSuccessfulReceiverCommunicationAt;
  payload.lastSuccessfulAuthoritativeTimeSyncAt = monitoringMemory.lastSuccessfulAuthoritativeTimeSyncAt;
  payload.statusBecameStaleAt = monitoringMemory.statusBecameStaleAt;
  payload.consecutiveCommunicationFailures = monitoringMemory.communicationIssueCount;
  return payload;
}

function getOmanDisplayParts(timestamp) {
  const date = new Date(timestamp);

  return {
    date: formatOmanDate(date),
    time: formatOmanTime(date),
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

function createInternetFallbackPayload(extra = {}) {
  return getPreciseInternetTime().then((internetTime) => {
    const omanDisplay = getOmanDisplayParts(internetTime.timestamp);
    const snapshot = {
      ...lastReceiverSnapshot,
      receiverConfigured: lastReceiverSnapshot.receiverConfigured,
      currentSource: "internet-fallback",
      currentSourceLabel: "Internet fallback",
      statusText: extra.statusText || (lastReceiverSnapshot.receiverConfigured === false
        ? "Receiver not configured; using backend Internet time"
        : "Using Internet time fallback via backend"),
      fallbackReason: extra.fallbackReason || (lastReceiverSnapshot.receiverConfigured === false ? "receiver-not-configured" : "receiver-unavailable"),
      lastError: extra.lastError || lastReceiverSnapshot.lastError || null,
    };

    return {
      success: true,
      source: "internet-http-date",
      currentSource: "internet-fallback",
      currentSourceLabel: "Internet fallback",
      date: omanDisplay.date,
      time: omanDisplay.time,
      timezone: "GST (UTC+04:00)",
      timestamp: internetTime.timestamp,
      backendOnline: true,
      receiverConfigured: snapshot.receiverConfigured !== false,
      receiverReachable: Boolean(snapshot.receiverReachable),
      loginOk: Boolean(snapshot.loginOk),
      isLocked: false,
      gpsLockState: snapshot.gpsLockState || "unknown",
      receiverCommunicationState: snapshot.receiverConfigured === false ? "disabled" : snapshot.receiverCommunicationState,
      statusText: snapshot.statusText,
      fallbackReason: snapshot.fallbackReason,
      lastError: snapshot.lastError,
      monitoringState: deriveMonitoringState(snapshot, { dataState: "cached", stale: false }),
      lastKnownGoodGpsLockAt: monitoringMemory.lastKnownGoodGpsLockAt,
      lastSuccessfulReceiverCommunicationAt: monitoringMemory.lastSuccessfulReceiverCommunicationAt,
      lastSuccessfulAuthoritativeTimeSyncAt: monitoringMemory.lastSuccessfulAuthoritativeTimeSyncAt,
      consecutiveCommunicationFailures: monitoringMemory.communicationIssueCount,
      rtt: internetTime.rtt,
      sourcesReached: internetTime.sourcesReached,
      ...extra,
    };
  });
}

function connectToReceiver(command, overrides = {}) {
  if (!CONFIG.receiverEnabled) {
    throw new Error("Receiver not configured");
  }

  return connectToGPS({
    host: CONFIG.gpsHost,
    port: CONFIG.gpsPort,
    username: CONFIG.gpsUsername,
    password: CONFIG.gpsPassword,
    command,
    timeoutMs: overrides.timeoutMs ?? CONFIG.requestTimeoutMs,
    expectOk: Boolean(overrides.expectOk),
  });
}

function buildStatusPayload(snapshot, overrides = {}) {
  const checkedAtMs = snapshot.checkedAt ? new Date(snapshot.checkedAt).getTime() : null;
  const statusAgeMs = checkedAtMs === null ? null : Math.max(0, Date.now() - checkedAtMs);
  const dataState = overrides.dataState || "live";
  const stale = dataState !== "unavailable" && statusAgeMs !== null && statusAgeMs > CONFIG.statusStaleMs;
  const monitoringState = deriveMonitoringState(snapshot, { dataState, stale });
  return {
    success: true,
    backendOnline: true,
    receiverConfigured: snapshot.receiverConfigured !== false,
    receiverReachable: Boolean(snapshot.receiverReachable),
    loginOk: Boolean(snapshot.loginOk),
    isLocked: Boolean(snapshot.isLocked),
    gpsLockState: snapshot.gpsLockState || (snapshot.isLocked ? "locked" : "unknown"),
    statusText: snapshot.statusText || "Receiver status unavailable",
    currentSource: snapshot.currentSource || "local",
    currentSourceLabel: snapshot.currentSourceLabel || "Local fallback",
    receiverCommunicationState: snapshot.receiverCommunicationState || "not-started",
    fallbackReason: snapshot.fallbackReason || null,
    lastError: snapshot.lastError || null,
    checkedAt: snapshot.checkedAt || null,
    statusAgeMs,
    receiverSnapshotAgeMs: statusAgeMs,
    dataState,
    stale,
    fetchedFromCache: false,
    cacheAgeMs: null,
    monitoringState,
    lastKnownGoodGpsLockAt: monitoringMemory.lastKnownGoodGpsLockAt,
    lastSuccessfulReceiverCommunicationAt: monitoringMemory.lastSuccessfulReceiverCommunicationAt,
    lastSuccessfulAuthoritativeTimeSyncAt: monitoringMemory.lastSuccessfulAuthoritativeTimeSyncAt,
    statusBecameStaleAt: stale ? (monitoringMemory.statusBecameStaleAt || snapshot.checkedAt) : null,
    consecutiveCommunicationFailures: monitoringMemory.communicationIssueCount,
    ...overrides,
  };
}

function deriveMonitoringState(snapshot, { dataState = "live", stale = false } = {}) {
  const runtimeTimeSourceState = snapshot.currentSource === "gps-locked"
    ? "healthy"
    : snapshot.currentSource === "internet-fallback"
      ? "degraded"
      : snapshot.currentSource === "local"
        ? "unavailable"
        : ["gps-unlocked", "holdover"].includes(snapshot.currentSource)
          ? "warning"
          : "unknown";
  const receiverHealthState = snapshot.receiverConfigured === false
    ? "standby"
    : !snapshot.receiverReachable
      ? "unavailable"
      : snapshot.loginOk
        ? "healthy"
        : "critical";
  const gpsLockQualityState = snapshot.receiverConfigured === false
    ? "standby"
    : snapshot.gpsLockState === "locked"
      ? "healthy"
      : snapshot.gpsLockState === "holdover"
        ? "warning"
        : snapshot.gpsLockState === "unlocked"
          ? "degraded"
          : "unknown";
  const statusDataFreshnessState = dataState === "live"
    ? "fresh"
    : dataState === "cached"
      ? "cached"
      : stale
        ? "stale"
        : dataState === "unavailable"
          ? "unavailable"
          : "unknown";

  let timingIntegrityState = "high";
  if (snapshot.currentSource === "local" || dataState === "unavailable") {
    timingIntegrityState = "low";
  } else if (snapshot.receiverConfigured === false || snapshot.currentSource === "internet-fallback") {
    timingIntegrityState = "reduced";
  } else if (!snapshot.receiverReachable || !snapshot.loginOk || snapshot.gpsLockState === "holdover" || stale) {
    timingIntegrityState = "degraded";
  } else if (dataState === "cached" || snapshot.gpsLockState === "unlocked") {
    timingIntegrityState = "reduced";
  }

  let alarmSeverityState = "normal";
  if (snapshot.currentSource === "local") {
    alarmSeverityState = "critical";
  } else if (snapshot.currentSource === "internet-fallback") {
    alarmSeverityState = snapshot.receiverConfigured === false ? "advisory" : "warning";
  } else if (snapshot.receiverConfigured !== false && (!snapshot.receiverReachable || !snapshot.loginOk)) {
    alarmSeverityState = "critical";
  } else if (stale || ["holdover", "unlocked"].includes(snapshot.gpsLockState) || monitoringMemory.communicationIssueCount >= 2) {
    alarmSeverityState = "warning";
  } else if (dataState === "cached") {
    alarmSeverityState = "advisory";
  }

  return {
    runtimeTimeSourceState,
    receiverHealthState,
    gpsLockQualityState,
    statusDataFreshnessState,
    timingIntegrityState,
    alarmSeverityState,
    communicationAuthState: snapshot.receiverConfigured === false ? "disabled" : snapshot.loginOk ? "authenticated" : snapshot.receiverReachable ? "auth-failed" : "receiver-unreachable",
  };
}

function updateReceiverSnapshot(snapshot) {
  lastReceiverSnapshot = {
    backendOnline: true,
    checkedAt: new Date().toISOString(),
    ...snapshot,
  };

  if (lastReceiverSnapshot.receiverConfigured === false) {
    monitoringMemory.communicationIssueCount = 0;
  } else if (lastReceiverSnapshot.receiverReachable) {
    monitoringMemory.lastSuccessfulReceiverCommunicationAt = lastReceiverSnapshot.checkedAt;
    monitoringMemory.communicationIssueCount = 0;
  } else {
    monitoringMemory.communicationIssueCount += 1;
  }

  if (lastReceiverSnapshot.gpsLockState === "locked") {
    monitoringMemory.lastKnownGoodGpsLockAt = lastReceiverSnapshot.checkedAt;
  }

  return lastReceiverSnapshot;
}

function sanitizeReceiverStatus(snapshot = lastReceiverSnapshot, overrides = {}) {
  const status = buildStatusPayload(snapshot, overrides);
  if (status.stale) {
    monitoringMemory.statusBecameStaleAt = monitoringMemory.statusBecameStaleAt || status.checkedAt || new Date().toISOString();
    status.statusBecameStaleAt = monitoringMemory.statusBecameStaleAt;
  } else {
    monitoringMemory.statusBecameStaleAt = null;
  }
  return status;
}

async function readReceiverTime() {
  await throttleReceiverAccess();

  const connection = await connectToReceiver("F3\r\n");
  const parsed = parseGpsTimeResponse(connection.raw);
  const omanDisplay = getOmanDisplayParts(parsed.timestamp);

  const snapshot = updateReceiverSnapshot({
    receiverConfigured: true,
    receiverReachable: connection.receiverReachable,
    loginOk: connection.loginOk,
    isLocked: parsed.isLocked,
    gpsLockState: parsed.gpsLockState,
    statusText: parsed.statusText,
    currentSource: parsed.currentSource,
    currentSourceLabel: parsed.currentSourceLabel,
    receiverCommunicationState: connection.loginOk ? "authenticated" : "reachable",
    lastError: null,
  });
  monitoringMemory.lastSuccessfulAuthoritativeTimeSyncAt = snapshot.checkedAt;

  return {
    success: true,
    source: "gps-receiver",
    timezone: "GST (UTC+04:00)",
    backendOnline: true,
    receiverConfigured: true,
    receiverReachable: snapshot.receiverReachable,
    loginOk: snapshot.loginOk,
    isLocked: snapshot.isLocked,
    statusText: snapshot.statusText,
    currentSource: snapshot.currentSource,
    currentSourceLabel: snapshot.currentSourceLabel,
    gpsLockState: snapshot.gpsLockState,
    receiverCommunicationState: snapshot.receiverCommunicationState,
    lastError: null,
    monitoringState: deriveMonitoringState(snapshot, { dataState: "live", stale: false }),
    lastKnownGoodGpsLockAt: monitoringMemory.lastKnownGoodGpsLockAt,
    lastSuccessfulReceiverCommunicationAt: monitoringMemory.lastSuccessfulReceiverCommunicationAt,
    lastSuccessfulAuthoritativeTimeSyncAt: monitoringMemory.lastSuccessfulAuthoritativeTimeSyncAt,
    consecutiveCommunicationFailures: monitoringMemory.communicationIssueCount,
    date: omanDisplay.date,
    time: omanDisplay.time,
    timestamp: parsed.timestamp,
    receiverDate: parsed.receiverDate,
    receiverTime: parsed.receiverTime,
    receiverTimeMode: parsed.receiverTimeMode,
    raw: parsed.raw,
  };
}

async function readReceiverStatusCached({ force = false } = {}) {
  const now = Date.now();
  if (CONFIG.receiverEnabled === false) {
    const snapshot = updateReceiverSnapshot({
      receiverConfigured: false,
      receiverReachable: false,
      loginOk: false,
      isLocked: false,
      gpsLockState: "unknown",
      statusText: "Receiver not configured; backend Internet fallback ready",
      currentSource: "internet-fallback",
      currentSourceLabel: "Internet fallback",
      receiverCommunicationState: "disabled",
      fallbackReason: "receiver-not-configured",
      lastError: null,
    });
    return sanitizeReceiverStatus(snapshot, { dataState: "cached" });
  }

  if (!force && receiverStatusCache.data && receiverStatusCache.expiresAt > now) {
    return {
      ...receiverStatusCache.data,
      dataState: "cached",
      fetchedFromCache: true,
      cacheAgeMs: Math.max(0, now - new Date(receiverStatusCache.data.checkedAt).getTime()),
      statusAgeMs: Math.max(0, now - new Date(receiverStatusCache.data.checkedAt).getTime()),
    };
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
        gpsLockState: receiverTime.gpsLockState,
        statusText: receiverTime.statusText,
        currentSource: receiverTime.currentSource,
        currentSourceLabel: receiverTime.currentSourceLabel,
        receiverCommunicationState: receiverTime.loginOk ? "authenticated" : "reachable",
        lastError: null,
      }, { dataState: "live" });
      receiverStatusCache = {
        promise: null,
        data: status,
        expiresAt: Date.now() + CONFIG.receiverStatusCacheMs,
      };
      return {
        ...status,
        dataState: "live",
        fetchedFromCache: false,
        cacheAgeMs: 0,
      };
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
    receiverEnabled: CONFIG.receiverEnabled,
  });
});

app.get("/api/status", requireApiAuth, statusRateLimiter, async (req, res) => {
  try {
    const forceRefresh = parseBoolean(req.query.refresh);
    const status = await readReceiverStatusCached({ force: forceRefresh });
    res.json(status);
  } catch (error) {
    const classified = classifyReceiverError(error);
    const snapshot = updateReceiverSnapshot({
      receiverConfigured: classified.receiverConfigured !== false,
      receiverReachable: classified.receiverReachable,
      loginOk: classified.loginOk,
      isLocked: false,
      gpsLockState: "unknown",
      statusText: classified.statusText,
      currentSource: classified.receiverConfigured === false ? "internet-fallback" : "local",
      currentSourceLabel: classified.receiverConfigured === false ? "Internet fallback" : "Local fallback",
      receiverCommunicationState: classified.receiverCommunicationState,
      fallbackReason: classified.receiverConfigured === false ? "receiver-not-configured" : "receiver-unavailable",
      lastError: classified.lastError,
    });

    res.json(sanitizeReceiverStatus(snapshot, {
      success: false,
      dataState: "unavailable",
    }));
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
    const classified = classifyReceiverError(error);

    updateReceiverSnapshot({
      receiverConfigured: classified.receiverConfigured !== false,
      receiverReachable: classified.receiverReachable,
      loginOk: classified.loginOk,
      isLocked: false,
      gpsLockState: "unknown",
      statusText: classified.statusText,
      currentSource: classified.receiverConfigured === false ? "internet-fallback" : "local",
      currentSourceLabel: classified.receiverConfigured === false ? "Internet fallback" : "Local fallback",
      receiverCommunicationState: classified.receiverCommunicationState,
      fallbackReason: classified.receiverConfigured === false ? "receiver-not-configured" : "receiver-unavailable",
      lastError: classified.lastError,
    });

    try {
      const internetFallback = await createInternetFallbackPayload({
        statusText: classified.receiverConfigured === false
          ? "Receiver not configured; using backend Internet time"
          : "Receiver unavailable; using backend Internet time",
        fallbackReason: classified.receiverConfigured === false ? "receiver-not-configured" : "receiver-unavailable",
        lastError: classified.lastError,
      });
      receiverStatusCache = {
        promise: null,
        data: sanitizeReceiverStatus({
          ...lastReceiverSnapshot,
          currentSource: "internet-fallback",
          currentSourceLabel: "Internet fallback",
          statusText: internetFallback.statusText,
          fallbackReason: internetFallback.fallbackReason,
        }, { dataState: "cached" }),
        expiresAt: Date.now() + CONFIG.receiverStatusCacheMs,
      };
      res.json(internetFallback);
      return;
    } catch (internetError) {
      const fallback = createLocalFallback({
        error: internetError.message,
        statusText: CONFIG.receiverEnabled
          ? "Using local computer time because receiver and backend Internet fallback are unavailable"
          : "Using local computer time because backend Internet fallback is unavailable",
        lastError: internetError.message,
        receiverConfigured: classified.receiverConfigured !== false,
        receiverReachable: classified.receiverReachable,
        loginOk: classified.loginOk,
        gpsLockState: "unknown",
        receiverCommunicationState: classified.receiverCommunicationState,
        fallbackReason: classified.receiverConfigured === false ? "internet-fallback-unavailable" : "receiver-and-internet-unavailable",
      });

      updateReceiverSnapshot({
        receiverConfigured: classified.receiverConfigured !== false,
        receiverReachable: classified.receiverReachable,
        loginOk: classified.loginOk,
        isLocked: false,
        gpsLockState: "unknown",
        statusText: fallback.statusText,
        currentSource: "local",
        currentSourceLabel: "Local fallback",
        receiverCommunicationState: classified.receiverCommunicationState,
        fallbackReason: fallback.fallbackReason,
        lastError: internetError.message,
      });

      receiverStatusCache = {
        promise: null,
        data: sanitizeReceiverStatus(lastReceiverSnapshot, { dataState: "unavailable" }),
        expiresAt: Date.now() + CONFIG.receiverStatusCacheMs,
      };

      res.status(503).json(fallback);
    }
  }
});

app.post("/api/time/set", requireApiAuth, setTimeRateLimiter, async (req, res) => {
  try {
    const useInternet = Boolean(req.body?.useInternet);
    let omanTimestamp;
    let source;

    if (useInternet) {
      const internetTime = await getPreciseInternetTime();
      omanTimestamp = internetTime.timestamp;
      source = "Internet";
    } else {
      omanTimestamp = Date.now();
      source = "Computer";
    }

    const receiverUtcDate = new Date(omanTimestamp);
    const receiverDisplay = getOmanDisplayParts(omanTimestamp);
    const mm = String(receiverUtcDate.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(receiverUtcDate.getUTCDate()).padStart(2, "0");
    const yyyy = receiverUtcDate.getUTCFullYear();
    const hh = String(receiverUtcDate.getUTCHours()).padStart(2, "0");
    const min = String(receiverUtcDate.getUTCMinutes()).padStart(2, "0");
    const ss = String(receiverUtcDate.getUTCSeconds()).padStart(2, "0");

    await throttleReceiverAccess();
    const command = `F3 UTC ${mm}/${dd}/${yyyy} ${hh}:${min}:${ss}\r\n`;
    const result = await connectToReceiver(command, { expectOk: true });
    const acknowledgement = parseReceiverAcknowledgement(result.raw);

    updateReceiverSnapshot({
      receiverReachable: result.receiverReachable,
      loginOk: result.loginOk,
      isLocked: lastReceiverSnapshot.isLocked,
      gpsLockState: lastReceiverSnapshot.gpsLockState,
      statusText: "Receiver time updated successfully",
      currentSource: lastReceiverSnapshot.currentSource,
      currentSourceLabel: lastReceiverSnapshot.currentSourceLabel,
      receiverCommunicationState: result.loginOk ? "authenticated" : "reachable",
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
      date: receiverDisplay.date,
      time: receiverDisplay.time,
      timezone: "GST (UTC+04:00)",
      source,
      backendOnline: true,
      receiverConfigured: true,
      receiverUtcDate: `${mm}/${dd}/${yyyy}`,
      receiverUtcTime: `${hh}:${min}:${ss}`,
      receiverTimeMode: "UTC",
      receiverAcknowledgement: acknowledgement.raw,
    });
  } catch (error) {
    const classified = classifyReceiverError(error);
    updateReceiverSnapshot({
      receiverConfigured: classified.receiverConfigured !== false,
      receiverReachable: classified.receiverReachable,
      loginOk: classified.loginOk,
      isLocked: false,
      gpsLockState: "unknown",
      statusText: "Failed to set receiver time",
      currentSource: "local",
      currentSourceLabel: "Local fallback",
      receiverCommunicationState: classified.receiverCommunicationState,
      fallbackReason: "set-time-failed",
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
      receiverConfigured: classified.receiverConfigured !== false,
    });
  }
});

app.get("/api/time/internet", requireApiAuth, internetRateLimiter, async (req, res) => {
  try {
    const payload = await createInternetFallbackPayload({
      statusText: CONFIG.receiverEnabled
        ? "Using Internet time fallback via backend"
        : "Receiver not configured; using backend Internet time",
      fallbackReason: CONFIG.receiverEnabled ? "receiver-unavailable" : "receiver-not-configured",
    });
    res.json(payload);
  } catch (error) {
    const fallback = createLocalFallback({
      error: error.message,
      statusText: "Internet time fallback unavailable",
      lastError: error.message,
      fallbackReason: "internet-fallback-unavailable",
    });

    res.status(503).json(fallback);
  }
});

if (CONFIG.serveStatic) {
  app.use("/images", express.static(path.join(publicPath, "images"), {
    fallthrough: false,
    index: false,
  }));

  FRONTEND_ASSET_FILES.filter((fileName) => fileName !== "index.html").forEach((fileName) => {
    app.get(`/${fileName}`, (req, res) => {
      res.sendFile(path.join(publicPath, fileName));
    });
  });

  app.get("/", (req, res) => {
    res.sendFile(path.join(publicPath, "index.html"));
  });
}

function startServer() {
  return app.listen(CONFIG.port, () => {
    console.log(`GPS backend listening on http://localhost:${CONFIG.port}`);
    console.log(`Receiver target: ${CONFIG.gpsHost}:${CONFIG.gpsPort}`);
    console.log(`Static frontend serving: ${CONFIG.serveStatic ? "enabled" : "disabled"}`);
    console.log(`API auth: ${CONFIG.authEnabled ? "enabled" : "disabled"}`);
    console.log(
      `CORS policy: ${allowedOrigins.size > 0 ? Array.from(allowedOrigins).join(", ") : isProduction ? "same-origin / non-browser only until ALLOWED_ORIGIN is set" : "development-open"}`,
    );
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  CONFIG,
  app,
  startServer,
  validateConfig,
  parseReceiverAcknowledgement,
  parseGpsTimeResponse,
  classifyReceiverError,
  deriveMonitoringState,
};
