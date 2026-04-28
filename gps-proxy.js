require("dotenv").config();

const path = require("path");
const { performance } = require("perf_hooks");
const express = require("express");
const cors = require("cors");
const {
  validateConfig,
  parseReceiverAcknowledgement,
  parseGpsTimeResponse,
  parseGpsReceiverInfo,
  parseGpsPosition,
  parseGpsSatelliteList,
  parseXliWebSatelliteTable,
  classifyReceiverError,
  createReceiverConnectionManager,
} = require("./receiver-protocol");
const { createTimingSourceService, getSourceDefinition } = require("./time-source-service");
const nodeFetch = require("node-fetch");

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
  "official-time.html",
  "official-digital-time.html",
  "api-client.js",
  "status-monitor.js",
  "fallback-card.js",
  "runtime-sync.js",
  "dashboard-render.js",
  "ui-controls.js",
  "main.js",
  "official-time.js",
  "official-digital-time.js",
  "analog-clock.js",
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
  minConnectionIntervalMs: readEnvNumber("MIN_CONNECTION_INTERVAL_MS", 250),
  requestTimeoutMs: readEnvNumber("REQUEST_TIMEOUT_MS", 3000),
  receiverStatusCacheMs: readEnvNumber("RECEIVER_STATUS_CACHE_MS", 4000),
  statusStaleMs: readEnvNumber("STATUS_STALE_MS", 45000),
  receiverReconnectInitialMs: readEnvNumber("RECEIVER_RECONNECT_INITIAL_MS", 1000),
  receiverReconnectMaxMs: readEnvNumber("RECEIVER_RECONNECT_MAX_MS", 15000),
  receiverConnectStabilizationMs: readEnvNumber("RECEIVER_CONNECT_STABILIZATION_MS", 120),
  receiverDetailCacheMs: readEnvNumber("GPS_DETAIL_CACHE_MS", 30000),
  xliWebEnabled: parseBoolean(process.env.XLI_WEB_ENABLED),
  xliWebBaseUrl: process.env.XLI_WEB_BASE_URL || "",
  xliGpsSlot: readEnvNumber("XLI_GPS_SLOT", 1),
  authEnabled: process.env.API_AUTH_ENABLED === "true",
  authToken: process.env.API_AUTH_TOKEN || "",
  rateLimitWindowMs: readEnvNumber("RATE_LIMIT_WINDOW_MS", 60000),
  rateLimitTimeMax: readEnvNumber("RATE_LIMIT_TIME_MAX", 90),
  rateLimitStatusMax: readEnvNumber("RATE_LIMIT_STATUS_MAX", 30),
  rateLimitInternetMax: readEnvNumber("RATE_LIMIT_INTERNET_MAX", 60),
  rateLimitSetMax: readEnvNumber("RATE_LIMIT_SET_MAX", 8),
  ntpTimeoutMs: readEnvNumber("NTP_TIMEOUT_MS", 1500),
  httpsApiTimeoutMs: readEnvNumber("HTTPS_TIME_API_TIMEOUT_MS", 2000),
  httpDateTimeoutMs: readEnvNumber("HTTP_DATE_TIMEOUT_MS", 2000),
  nistHosts: Object.freeze((process.env.NTP_NIST_HOSTS || "time.nist.gov,time-a-g.nist.gov").split(",").map((value) => value.trim()).filter(Boolean)),
  nplHosts: Object.freeze((process.env.NTP_NPL_HOSTS || "time.nplindia.org,samay1.nic.in").split(",").map((value) => value.trim()).filter(Boolean)),
  worldTimeApiUrls: Object.freeze((process.env.WORLD_TIME_API_URLS || "https://worldtimeapi.org/api/timezone/Asia/Muscat").split(",").map((value) => value.trim()).filter(Boolean)),
  timeApiIoUrls: Object.freeze((process.env.TIMEAPI_IO_URLS || "https://timeapi.io/api/Time/current/zone?timeZone=Asia/Muscat").split(",").map((value) => value.trim()).filter(Boolean)),
  httpDateUrls: Object.freeze((process.env.HTTP_DATE_URLS || "https://www.google.com,https://www.microsoft.com").split(",").map((value) => value.trim()).filter(Boolean)),
  receiverEnabled,
});

const HTTP_FETCH = typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : nodeFetch;

const GPS_DETAIL_CACHE_MS = CONFIG.receiverDetailCacheMs;
const gpsSlotCommandToken = `B${CONFIG.xliGpsSlot}`;
const GPS_DETAIL_COMMANDS = Object.freeze({
  receiverInfo: Object.freeze([`F119 ${gpsSlotCommandToken} S\r\n`, "F119 B1 S\r\n"]),
  gpsMode: Object.freeze([`F53 ${gpsSlotCommandToken}\r\n`, "F53 B1\r\n", "F53\r\n"]),
  positionLla: Object.freeze([`F50 ${gpsSlotCommandToken} LLA\r\n`, "F50 B1 LLA\r\n", "F50 LLA\r\n", `F50 ${gpsSlotCommandToken}\r\n`, "F50 B1\r\n", "F50\r\n"]),
  positionXyz: Object.freeze([`F50 ${gpsSlotCommandToken} XYZ\r\n`, "F50 B1 XYZ\r\n", "F50 XYZ\r\n", `F50 ${gpsSlotCommandToken}\r\n`, "F50 B1\r\n", "F50\r\n"]),
  satellitesCurrent: Object.freeze([`F60 ${gpsSlotCommandToken} CURRENT\r\n`, "F60 B1 CURRENT\r\n"]),
  satellitesTracked: Object.freeze([`F60 ${gpsSlotCommandToken} TRACKED\r\n`, "F60 B1 TRACKED\r\n"]),
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
    statusText: getSourceDefinition('local-clock').status,
  currentSource: 'local-clock',
  currentSourceLabel: getSourceDefinition('local-clock').sourceLabel,
  sourceKey: 'local-clock',
  sourceLabel: getSourceDefinition('local-clock').sourceLabel,
  sourceTier: getSourceDefinition('local-clock').sourceTier,
  authoritative: false,
  traceable: false,
  fallback: true,
  receiverCommunicationState: CONFIG.receiverEnabled ? "not-started" : "disabled",
  fallbackReason: CONFIG.receiverEnabled ? null : "receiver-not-configured",
  lastError: null,
  checkedAt: null,
  gpsReceiverDetails: null,
};
let receiverStatusCache = {
  expiresAt: 0,
  promise: null,
  data: null,
};
let gpsDetailCache = {
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
let receiverFailureLogMemory = {
  key: null,
  lastAt: 0,
};
let lastKnownGoodReceiverSnapshot = null;
let inFlightHighPriorityTimeRead = null;
let lastFastRxTimePayload = null;

const receiverManager = CONFIG.receiverEnabled
  ? createReceiverConnectionManager({
    host: CONFIG.gpsHost,
    port: CONFIG.gpsPort,
    username: CONFIG.gpsUsername,
    password: CONFIG.gpsPassword,
    commandTimeoutMs: CONFIG.requestTimeoutMs,
    reconnectInitialMs: CONFIG.receiverReconnectInitialMs,
    reconnectMaxMs: CONFIG.receiverReconnectMaxMs,
    connectStabilizationMs: CONFIG.receiverConnectStabilizationMs,
    logger: console,
  })
  : null;

const timingSourceService = createTimingSourceService({
  ntpTimeoutMs: CONFIG.ntpTimeoutMs,
  httpsApiTimeoutMs: CONFIG.httpsApiTimeoutMs,
  httpTimeoutMs: CONFIG.httpDateTimeoutMs,
  nistHosts: CONFIG.nistHosts,
  nplHosts: CONFIG.nplHosts,
  worldTimeApiUrls: CONFIG.worldTimeApiUrls,
  timeApiIoUrls: CONFIG.timeApiIoUrls,
  httpDateUrls: CONFIG.httpDateUrls,
});

let lastResolvedTimeSource = {
  sourceKey: "local-clock",
  sourceLabel: getSourceDefinition("local-clock").sourceLabel,
  sourceTier: getSourceDefinition("local-clock").sourceTier,
  status: getSourceDefinition("local-clock").status,
  authoritative: false,
  traceable: false,
  fallback: true,
  stale: true,
  timestamp: Date.now(),
  isoTimestamp: new Date().toISOString(),
  upstream: "local-system-clock",
  resolutionErrors: [],
};


function createEmptyGpsReceiverDetails(overrides = {}) {
  return {
    available: false,
    fetchedAt: null,
    error: null,
    metadata: {
      acquisitionState: null,
      antennaStatus: null,
      boardPartNumber: null,
      softwareVersion: null,
      fpgaVersion: null,
      gpsStatus: null,
    },
    position: {
      latitude: null,
      longitude: null,
      altitudeMeters: null,
      xMeters: null,
      yMeters: null,
      zMeters: null,
    },
    satellites: [],
    satelliteTracking: [],
    satelliteTrackingUpdatedAt: null,
    satelliteTrackingSource: null,
    satelliteTrackingPage: null,
    ...overrides,
  };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeGpsReceiverDetails(details) {
  const safeDetails = isRecord(details) ? details : {};
  const safeMetadata = isRecord(safeDetails.metadata) ? safeDetails.metadata : {};
  const safePosition = isRecord(safeDetails.position) ? safeDetails.position : {};
  const safeSatellites = Array.isArray(safeDetails.satellites) ? safeDetails.satellites : [];
  const safeSatelliteTracking = Array.isArray(safeDetails.satelliteTracking) ? safeDetails.satelliteTracking : [];

  const metadata = {
    acquisitionState: safeMetadata.acquisitionState ?? null,
    antennaStatus: safeMetadata.antennaStatus ?? null,
    boardPartNumber: safeMetadata.boardPartNumber ?? null,
    softwareVersion: safeMetadata.softwareVersion ?? null,
    fpgaVersion: safeMetadata.fpgaVersion ?? null,
    gpsStatus: safeMetadata.gpsStatus ?? null,
  };
  const position = {
    latitude: safePosition.latitude ?? null,
    longitude: safePosition.longitude ?? null,
    altitudeMeters: Number.isFinite(safePosition.altitudeMeters) ? safePosition.altitudeMeters : null,
    xMeters: Number.isFinite(safePosition.xMeters) ? safePosition.xMeters : null,
    yMeters: Number.isFinite(safePosition.yMeters) ? safePosition.yMeters : null,
    zMeters: Number.isFinite(safePosition.zMeters) ? safePosition.zMeters : null,
  };
  const satellites = safeSatellites
    .map((satellite) => ({
      prn: Number.isFinite(Number(satellite?.prn)) ? Number(satellite.prn) : null,
      health: satellite?.health ? String(satellite.health).trim().toLowerCase() : null,
      usage: satellite?.usage ? String(satellite.usage).trim().toLowerCase() : null,
      signalDbw: Number.isFinite(Number(satellite?.signalDbw)) ? Number(satellite.signalDbw) : null,
      status: satellite?.status ? String(satellite.status) : null,
      utilization: satellite?.utilization ? String(satellite.utilization) : null,
      levelDbw: Number.isFinite(Number(satellite?.levelDbw)) ? Number(satellite.levelDbw) : null,
      level: Number.isFinite(Number(satellite?.level)) ? Number(satellite.level) : null,
    }))
    .filter((satellite) => satellite.prn !== null);
  const satelliteTracking = safeSatelliteTracking
    .map((satellite) => ({
      prn: Number.isFinite(Number(satellite?.prn)) ? Number(satellite.prn) : null,
      health: satellite?.health ? String(satellite.health).trim().toLowerCase() : null,
      usage: satellite?.usage ? String(satellite.usage).trim().toLowerCase() : null,
      signalDbw: Number.isFinite(Number(satellite?.signalDbw)) ? Number(satellite.signalDbw) : null,
      status: satellite?.status ? String(satellite.status).trim() : null,
      utilization: satellite?.utilization ? String(satellite.utilization).trim() : null,
      level: satellite?.level ? String(satellite.level).replace(/\s+/g, " ").trim() : null,
    }))
    .filter((satellite) => satellite.prn !== null);
  const hasMetadata = Object.values(metadata).some(Boolean);
  const hasPosition = Object.values(position).some((value) => value !== null);
  const available = Boolean(safeDetails.available) || hasMetadata || hasPosition || satellites.length > 0 || satelliteTracking.length > 0;

  return createEmptyGpsReceiverDetails({
    available,
    fetchedAt: typeof safeDetails.fetchedAt === 'string' && safeDetails.fetchedAt ? safeDetails.fetchedAt : null,
    error: typeof safeDetails.error === 'string' && safeDetails.error ? safeDetails.error : null,
    metadata,
    position,
    satellites,
    satelliteTracking,
    satelliteTrackingUpdatedAt: typeof safeDetails.satelliteTrackingUpdatedAt === "string" && safeDetails.satelliteTrackingUpdatedAt ? safeDetails.satelliteTrackingUpdatedAt : null,
    satelliteTrackingSource: typeof safeDetails.satelliteTrackingSource === "string" && safeDetails.satelliteTrackingSource ? safeDetails.satelliteTrackingSource : null,
    satelliteTrackingPage: typeof safeDetails.satelliteTrackingPage === "string" && safeDetails.satelliteTrackingPage ? safeDetails.satelliteTrackingPage : null,
  });
}

function mergeGpsReceiverDetails(primary, fallback) {
  const base = sanitizeGpsReceiverDetails(fallback);
  const next = sanitizeGpsReceiverDetails(primary);

  return sanitizeGpsReceiverDetails({
    available: next.available || base.available,
    fetchedAt: next.fetchedAt || base.fetchedAt,
    error: next.error || null,
    metadata: {
      acquisitionState: next.metadata.acquisitionState ?? base.metadata.acquisitionState,
      antennaStatus: next.metadata.antennaStatus ?? base.metadata.antennaStatus,
      boardPartNumber: next.metadata.boardPartNumber ?? base.metadata.boardPartNumber,
      softwareVersion: next.metadata.softwareVersion ?? base.metadata.softwareVersion,
      fpgaVersion: next.metadata.fpgaVersion ?? base.metadata.fpgaVersion,
      gpsStatus: next.metadata.gpsStatus ?? base.metadata.gpsStatus,
    },
    position: {
      latitude: next.position.latitude ?? base.position.latitude,
      longitude: next.position.longitude ?? base.position.longitude,
      altitudeMeters: next.position.altitudeMeters ?? base.position.altitudeMeters,
      xMeters: next.position.xMeters ?? base.position.xMeters,
      yMeters: next.position.yMeters ?? base.position.yMeters,
      zMeters: next.position.zMeters ?? base.position.zMeters,
    },
    satellites: next.satellites.length > 0 ? next.satellites : base.satellites,
    satelliteTracking: next.satelliteTracking.length > 0 ? next.satelliteTracking : base.satelliteTracking,
    satelliteTrackingUpdatedAt: next.satelliteTrackingUpdatedAt || base.satelliteTrackingUpdatedAt,
    satelliteTrackingSource: next.satelliteTrackingSource || base.satelliteTrackingSource,
    satelliteTrackingPage: next.satelliteTrackingPage || base.satelliteTrackingPage,
  });
}

async function fetchXliWebSatelliteTelemetry() {
  if (!CONFIG.xliWebEnabled) {
    return createEmptyGpsReceiverDetails();
  }

  const pagePath = `/XLIGPSSatList.html?slot=${CONFIG.xliGpsSlot}`;
  const url = `${CONFIG.xliWebBaseUrl}${pagePath}`;
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), CONFIG.httpDateTimeoutMs);

  try {
    const response = await HTTP_FETCH(url, {
      method: "GET",
      signal: abortController.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!response.ok) {
      throw new Error(`XLi web telemetry request failed (${response.status})`);
    }

    const html = await response.text();
    const parsed = parseXliWebSatelliteTable(html, { slot: CONFIG.xliGpsSlot });
    const hasTrackingRows = Array.isArray(parsed.satelliteTracking) && parsed.satelliteTracking.length > 0;
    return sanitizeGpsReceiverDetails({
      available: hasTrackingRows,
      satelliteTracking: parsed.satelliteTracking,
      satelliteTrackingUpdatedAt: hasTrackingRows ? new Date().toISOString() : null,
      satelliteTrackingSource: hasTrackingRows ? parsed.satelliteTrackingSource : null,
      satelliteTrackingPage: hasTrackingRows ? parsed.satelliteTrackingPage : null,
    });
  } catch (error) {
    return sanitizeGpsReceiverDetails({
      available: false,
      error: error?.name === "AbortError" ? "XLi web telemetry request timed out" : (error?.message || "XLi web telemetry unavailable"),
      satelliteTracking: [],
      satelliteTrackingUpdatedAt: null,
      satelliteTrackingSource: null,
      satelliteTrackingPage: null,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function getReceiverManagerSnapshot() {
  if (!receiverManager) {
    return {
      connected: false,
      connecting: false,
      reconnecting: false,
      state: "disabled",
      lastConnectedAt: null,
      lastAuthenticatedAt: null,
      lastSuccessfulCommunicationAt: null,
      lastError: null,
      reconnectAttempt: 0,
    };
  }

  return receiverManager.getStateSnapshot();
}

function hasTrustedReceiverSnapshot(snapshot = lastKnownGoodReceiverSnapshot) {
  if (!snapshot?.checkedAt) {
    return false;
  }

  const checkedAtMs = new Date(snapshot.checkedAt).getTime();
  if (!Number.isFinite(checkedAtMs)) {
    return false;
  }

  return (Date.now() - checkedAtMs) <= CONFIG.statusStaleMs;
}

const rateLimitStore = new Map();

function setNoStore(res) {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.set("Surrogate-Control", "no-store");
}

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
const OMAN_PARTS_FORMATTER = createOmanDateFormatter({
  weekday: "long",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
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

async function throttleReceiverAccess({ commandPriority = "normal" } = {}) {
  if (!receiverManager) {
    return;
  }
  const managerSnapshot = receiverManager.getStateSnapshot();
  if (managerSnapshot.connected && commandPriority === "high") {
    return;
  }
  const now = Date.now();
  const elapsed = now - lastConnectionAttempt;
  if (elapsed < CONFIG.minConnectionIntervalMs) {
    await wait(CONFIG.minConnectionIntervalMs - elapsed);
  }
  lastConnectionAttempt = Date.now();
}

function getOmanDisplayParts(timestamp) {
  const date = new Date(timestamp);

  return {
    date: formatOmanDate(date),
    time: formatOmanTime(date),
  };
}

function getOmanDateTimeParts(timestamp) {
  const date = new Date(Number(timestamp));
  const parts = OMAN_PARTS_FORMATTER.formatToParts(date);
  const map = Object.fromEntries(parts.map((entry) => [entry.type, entry.value]));
  return {
    weekday: map.weekday || null,
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function updateLastResolvedTimeSource(selection = {}) {
  lastResolvedTimeSource = {
    ...lastResolvedTimeSource,
    ...selection,
    stale: Boolean(selection.stale),
    timestamp: selection.timestamp || lastResolvedTimeSource.timestamp,
    isoTimestamp: selection.isoTimestamp || lastResolvedTimeSource.isoTimestamp,
    resolutionErrors: Array.isArray(selection.resolutionErrors) ? selection.resolutionErrors : (lastResolvedTimeSource.resolutionErrors || []),
  };

  if (lastResolvedTimeSource.authoritative) {
    monitoringMemory.lastSuccessfulAuthoritativeTimeSyncAt = lastResolvedTimeSource.isoTimestamp;
  }

  return lastResolvedTimeSource;
}

function buildTimingPayload(selection, extra = {}) {
  const payloadBuiltAtMs = Date.now();
  const payloadBuiltMonoMs = performance.now();
  const effectiveTimestamp = Number(selection.timestamp || Date.now());
  const sourceDefinition = getSourceDefinition(selection.sourceKey || extra.sourceKey || 'local-clock');
  const display = getOmanDisplayParts(effectiveTimestamp);
  const fallback = sourceDefinition.fallback;
  const managerSnapshot = getReceiverManagerSnapshot();
  const backendCapturedAtMs = Number.isFinite(extra.backendCapturedAtMs)
    ? extra.backendCapturedAtMs
    : Number.isFinite(extra.sourceCapturedAtMs)
      ? extra.sourceCapturedAtMs
      : Number.isFinite(selection.sourceCapturedAtMs)
        ? selection.sourceCapturedAtMs
      : payloadBuiltAtMs;
  const backendMonotonicCapturedAtMs = Number.isFinite(extra.backendMonotonicCapturedAtMs)
    ? extra.backendMonotonicCapturedAtMs
    : Number.isFinite(extra.sourceMonotonicCapturedAtMs)
      ? extra.sourceMonotonicCapturedAtMs
      : Number.isFinite(selection.sourceMonotonicCapturedAtMs)
        ? selection.sourceMonotonicCapturedAtMs
      : payloadBuiltMonoMs;
  const sourceTimestampMs = Number.isFinite(extra.sourceTimestampMs)
    ? extra.sourceTimestampMs
    : effectiveTimestamp;
  const authoritativeTimestampMs = Number.isFinite(extra.authoritativeTimestampMs)
    ? extra.authoritativeTimestampMs
    : effectiveTimestamp;
  const displayTimestampMs = Number.isFinite(extra.displayTimestampMs)
    ? extra.displayTimestampMs
    : effectiveTimestamp;
  const freshnessMs = Number.isFinite(extra.freshnessMs)
    ? extra.freshnessMs
    : Math.max(0, payloadBuiltAtMs - backendCapturedAtMs);
  const payload = {
    success: true,
    source: sourceDefinition.sourceKey,
    sourceKey: sourceDefinition.sourceKey,
    sourceLabel: sourceDefinition.sourceLabel,
    sourceTier: sourceDefinition.sourceTier,
    status: sourceDefinition.status,
    authoritative: sourceDefinition.authoritative,
    traceable: sourceDefinition.traceable,
    fallback,
    stale: Boolean(extra.stale),
    isoTimestamp: selection.isoTimestamp || new Date(effectiveTimestamp).toISOString(),
    currentSource: sourceDefinition.sourceKey,
    currentSourceLabel: sourceDefinition.sourceLabel,
    date: display.date,
    time: display.time,
    timezone: 'GST (UTC+04:00)',
    timestamp: displayTimestampMs,
    sourceTimestampMs,
    authoritativeTimestampMs,
    displayTimestampMs,
    displayIso: selection.isoTimestamp || new Date(effectiveTimestamp).toISOString(),
    sourceTime: extra.sourceTime || (sourceDefinition.sourceKey === "gps-xli" ? "gps" : sourceDefinition.sourceKey),
    sourceCalendar: extra.sourceCalendar || (sourceDefinition.sourceKey === "gps-xli" ? "gps-receiver" : "local"),
    omanFormattedParts: extra.omanFormattedParts || getOmanDateTimeParts(effectiveTimestamp),
    backendOnline: true,
    receiverConfigured: extra.receiverConfigured !== false,
    receiverReachable: Boolean(extra.receiverReachable),
    loginOk: Boolean(extra.loginOk),
    isLocked: sourceDefinition.sourceKey === 'gps-xli',
    gpsLockState: extra.gpsLockState || (sourceDefinition.sourceKey === 'gps-xli' ? 'locked' : 'unknown'),
    receiverCommunicationState: extra.receiverCommunicationState || (extra.receiverConfigured === false ? 'disabled' : 'not-started'),
    receiverConnectionState: managerSnapshot.state,
    statusText: extra.statusText || sourceDefinition.status,
    fallbackReason: extra.fallbackReason || null,
    lastError: extra.lastError || null,
    upstream: selection.upstream || null,
    protocol: selection.protocol || null,
    roundTripMs: selection.roundTripMs ?? null,
    backendCapturedAtMs,
    backendMonotonicCapturedAtMs,
    backendPayloadBuiltAtMs: Number.isFinite(extra.backendPayloadBuiltAtMs) ? extra.backendPayloadBuiltAtMs : payloadBuiltAtMs,
    backendResponseSentAtMs: Number.isFinite(extra.backendResponseSentAtMs) ? extra.backendResponseSentAtMs : null,
    freshnessMs,
    freshnessMsAtResponse: Number.isFinite(extra.freshnessMsAtResponse) ? extra.freshnessMsAtResponse : null,
    hotPathLatencyMs: Number.isFinite(extra.hotPathLatencyMs) ? extra.hotPathLatencyMs : null,
    timingDiagnostics: extra.timingDiagnostics || null,
    resolutionErrors: Array.isArray(selection.resolutionErrors) ? selection.resolutionErrors : [],
    receiverTimestampRaw: extra.receiverTimestampRaw ?? null,
    receiverDateRaw: extra.receiverDateRaw ?? null,
    receiverTimeRaw: extra.receiverTimeRaw ?? null,
    receiverDoyRaw: extra.receiverDoyRaw ?? null,
    receiverYearRaw: extra.receiverYearRaw ?? null,
    receiverOperationalState: extra.receiverOperationalState ?? null,
    monitoringState: null,
    lastKnownGoodGpsLockAt: monitoringMemory.lastKnownGoodGpsLockAt,
    lastSuccessfulReceiverCommunicationAt: monitoringMemory.lastSuccessfulReceiverCommunicationAt,
    lastSuccessfulAuthoritativeTimeSyncAt: monitoringMemory.lastSuccessfulAuthoritativeTimeSyncAt,
    statusBecameStaleAt: monitoringMemory.statusBecameStaleAt,
    consecutiveCommunicationFailures: monitoringMemory.communicationIssueCount,
    gpsReceiverDetails: sanitizeGpsReceiverDetails(extra.gpsReceiverDetails ?? lastReceiverSnapshot.gpsReceiverDetails),
    receiverConnection: managerSnapshot,
    ...extra,
  };

  payload.gpsReceiverDetails = sanitizeGpsReceiverDetails(payload.gpsReceiverDetails);

  payload.monitoringState = deriveMonitoringState(payload, { dataState: fallback ? 'cached' : 'live', stale: payload.stale });
  payload.integritySnapshot = {
    sourceTime: payload.sourceTime,
    sourceCalendar: payload.sourceCalendar,
    timingIntegrityState: payload.monitoringState.timingIntegrityState,
    freshnessMs: payload.freshnessMsAtResponse ?? payload.freshnessMs ?? null,
  };
  updateLastResolvedTimeSource({
    ...selection,
    ...sourceDefinition,
    timestamp: displayTimestampMs,
    isoTimestamp: payload.isoTimestamp,
    stale: payload.stale,
    fallback: payload.fallback,
    authoritative: payload.authoritative,
    traceable: payload.traceable,
  });
  return payload;
}

function createLocalFallback(extra = {}) {
  return buildTimingPayload({
    ...getSourceDefinition('local-clock'),
    timestamp: Date.now(),
    isoTimestamp: new Date().toISOString(),
    upstream: 'local-system-clock',
    protocol: 'local',
    roundTripMs: null,
    resolutionErrors: extra.resolutionErrors || [],
  }, {
    statusText: extra.statusText || 'Local Emergency Mode',
    fallbackReason: extra.fallbackReason || 'all-remote-sources-unavailable',
    lastError: extra.lastError || null,
    stale: true,
    ...extra,
  });
}

async function resolveNetworkFallback(baseContext = {}) {
  const selection = await timingSourceService.resolveFallbackHierarchy();
  const fallbackReason = selection.sourceKey === 'ntp-nist'
    ? 'receiver-unavailable-nist-active'
    : selection.sourceKey === 'ntp-npl-india'
      ? 'receiver-unavailable-npl-active'
      : selection.sourceKey === 'https-worldtimeapi'
        ? 'receiver-and-ntp-unavailable-worldtimeapi-active'
        : selection.sourceKey === 'https-timeapiio'
          ? 'receiver-and-primary-https-api-unavailable-timeapiio-active'
          : selection.sourceKey === 'http-date'
            ? 'receiver-ntp-and-https-api-unavailable-http-active'
            : 'all-remote-sources-unavailable';
  const statusText = selection.status;

  return selection.sourceKey === 'local-clock'
    ? createLocalFallback({
      ...baseContext,
      statusText,
      fallbackReason,
      resolutionErrors: selection.resolutionErrors,
      lastError: baseContext.lastError || selection.resolutionErrors?.map((entry) => entry.message).join('; ') || null,
    })
    : buildTimingPayload(selection, {
      ...baseContext,
      statusText,
      fallbackReason,
      lastError: baseContext.lastError || null,
    });
}

function connectToReceiver(command, overrides = {}) {
  if (!CONFIG.receiverEnabled) {
    throw new Error("Receiver not configured");
  }

  return receiverManager.sendCommand(command, {
    timeoutMs: overrides.timeoutMs ?? CONFIG.requestTimeoutMs,
    expectOk: Boolean(overrides.expectOk),
    completionPattern: overrides.completionPattern,
    responseMode: overrides.responseMode,
    idleGraceMs: overrides.idleGraceMs,
    priority: overrides.priority,
    priorityWeight: overrides.priorityWeight,
  });
}

function buildStatusPayload(snapshot, overrides = {}) {
  const managerSnapshot = getReceiverManagerSnapshot();
  const checkedAtMs = snapshot.checkedAt ? new Date(snapshot.checkedAt).getTime() : null;
  const statusAgeMs = checkedAtMs === null ? null : Math.max(0, Date.now() - checkedAtMs);
  const dataState = overrides.dataState || "live";
  const stale = dataState !== "unavailable" && statusAgeMs !== null && statusAgeMs > CONFIG.statusStaleMs;
  const activeSourceKey = snapshot.currentSource || lastResolvedTimeSource.sourceKey || "local-clock";
  const activeSource = getSourceDefinition(activeSourceKey);
  const monitoringSnapshot = {
    ...snapshot,
    currentSource: activeSource.sourceKey,
    currentSourceLabel: activeSource.sourceLabel,
    sourceKey: activeSource.sourceKey,
    sourceLabel: activeSource.sourceLabel,
    sourceTier: activeSource.sourceTier,
    status: activeSource.status,
    authoritative: activeSource.authoritative,
    traceable: activeSource.traceable,
    fallback: activeSource.fallback,
  };
  const monitoringState = deriveMonitoringState(monitoringSnapshot, { dataState, stale });
  return {
    success: true,
    backendOnline: true,
    receiverConfigured: snapshot.receiverConfigured !== false,
    receiverReachable: Boolean(snapshot.receiverReachable),
    loginOk: Boolean(snapshot.loginOk),
    isLocked: Boolean(snapshot.isLocked),
    gpsLockState: snapshot.gpsLockState || (snapshot.isLocked ? "locked" : "unknown"),
    statusText: snapshot.statusText || activeSource.status,
    currentSource: activeSource.sourceKey,
    currentSourceLabel: activeSource.sourceLabel,
    sourceKey: activeSource.sourceKey,
    sourceLabel: activeSource.sourceLabel,
    sourceTier: activeSource.sourceTier,
    status: snapshot.statusText || activeSource.status,
    authoritative: activeSource.authoritative,
    traceable: activeSource.traceable,
    fallback: activeSource.fallback,
    receiverCommunicationState: snapshot.receiverCommunicationState || "not-started",
    receiverConnectionState: managerSnapshot.state,
    fallbackReason: snapshot.fallbackReason || null,
    lastError: snapshot.lastError || null,
    checkedAt: snapshot.checkedAt || null,
    statusAgeMs,
    receiverSnapshotAgeMs: statusAgeMs,
    dataState,
    stale,
    fetchedFromCache: false,
    cacheAgeMs: null,
    upstream: snapshot.upstream || lastResolvedTimeSource.upstream || null,
    protocol: snapshot.protocol || lastResolvedTimeSource.protocol || null,
    sourceTime: snapshot.sourceTime || null,
    sourceCalendar: snapshot.sourceCalendar || null,
    receiverTimestampRaw: snapshot.receiverTimestampRaw ?? null,
    receiverDateRaw: snapshot.receiverDateRaw ?? null,
    receiverTimeRaw: snapshot.receiverTimeRaw ?? null,
    receiverDoyRaw: snapshot.receiverDoyRaw ?? null,
    receiverYearRaw: snapshot.receiverYearRaw ?? null,
    receiverOperationalState: snapshot.receiverOperationalState ?? null,
    monitoringState,
    lastKnownGoodGpsLockAt: monitoringMemory.lastKnownGoodGpsLockAt,
    lastSuccessfulReceiverCommunicationAt: monitoringMemory.lastSuccessfulReceiverCommunicationAt,
    lastSuccessfulAuthoritativeTimeSyncAt: monitoringMemory.lastSuccessfulAuthoritativeTimeSyncAt,
    statusBecameStaleAt: stale ? (monitoringMemory.statusBecameStaleAt || snapshot.checkedAt) : null,
    consecutiveCommunicationFailures: monitoringMemory.communicationIssueCount,
    gpsReceiverDetails: sanitizeGpsReceiverDetails(snapshot.gpsReceiverDetails ?? lastReceiverSnapshot.gpsReceiverDetails),
    receiverConnection: managerSnapshot,
    ...overrides,
  };
}

function deriveMonitoringState(snapshot, { dataState = "live", stale = false } = {}) {
  const runtimeTimeSourceState = snapshot.sourceTier === "primary-reference"
    ? "healthy"
    : snapshot.sourceTier === "traceable-fallback"
      ? "degraded"
      : snapshot.sourceTier === "internet-fallback"
        ? "warning"
        : snapshot.sourceTier === "emergency-fallback"
          ? "unavailable"
          : snapshot.sourceTier === "browser-emergency-fallback"
            ? "unavailable"
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
  if (snapshot.sourceTier === "emergency-fallback" || dataState === "unavailable") {
    timingIntegrityState = "low";
  } else if (snapshot.sourceTier === "internet-fallback") {
    timingIntegrityState = "degraded";
  } else if (snapshot.sourceTier === "traceable-fallback") {
    timingIntegrityState = "reduced";
  } else if (!snapshot.receiverReachable || !snapshot.loginOk || snapshot.gpsLockState === "holdover" || stale) {
    timingIntegrityState = "degraded";
  } else if (dataState === "cached" || snapshot.gpsLockState === "unlocked") {
    timingIntegrityState = "reduced";
  }

  let alarmSeverityState = "normal";
  if (snapshot.sourceTier === "emergency-fallback") {
    alarmSeverityState = "critical";
  } else if (snapshot.sourceTier === "internet-fallback") {
    alarmSeverityState = "warning";
  } else if (snapshot.sourceTier === "traceable-fallback") {
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
  const managerSnapshot = getReceiverManagerSnapshot();
  const nextSnapshot = {
    backendOnline: true,
    checkedAt: new Date().toISOString(),
    receiverCommunicationState: CONFIG.receiverEnabled
      ? (managerSnapshot.reconnecting
        ? "reconnecting"
        : managerSnapshot.connected
          ? "authenticated"
          : managerSnapshot.state === "login-failed"
            ? "login-failed"
            : snapshot.receiverCommunicationState)
      : "disabled",
    ...snapshot,
  };

  nextSnapshot.gpsReceiverDetails = mergeGpsReceiverDetails(
    nextSnapshot.gpsReceiverDetails,
    lastReceiverSnapshot.gpsReceiverDetails,
  );

  lastReceiverSnapshot = nextSnapshot;

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

  if (lastReceiverSnapshot.receiverReachable && lastReceiverSnapshot.loginOk) {
    lastKnownGoodReceiverSnapshot = {
      ...lastReceiverSnapshot,
      gpsReceiverDetails: sanitizeGpsReceiverDetails(lastReceiverSnapshot.gpsReceiverDetails),
    };
  }

  return lastReceiverSnapshot;
}


async function executeReceiverCommandVariants(
  commands,
  parser,
  {
    timeoutMs = CONFIG.requestTimeoutMs + 1500,
    validateParsed = null,
    commandOptions = {},
  } = {},
) {
  let lastError = null;

  for (const command of commands) {
    try {
      await throttleReceiverAccess({ commandPriority: "low" });
      const response = await connectToReceiver(command, {
        timeoutMs,
        responseMode: commandOptions.responseMode || "idle",
        completionPattern: commandOptions.completionPattern,
        idleGraceMs: commandOptions.idleGraceMs ?? 160,
        priority: "low",
      });
      const parsed = parser(response.raw);
      if (validateParsed && !validateParsed(parsed, response.raw, command)) {
        if (CONFIG.nodeEnv !== "production") {
          console.warn("[GPS details] F119 metadata parse incomplete:", String(response.raw || "").slice(0, 500));
        }
        throw new Error(`Parsed response failed validation for command ${command.trim()}`);
      }
      return parsed;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Unable to read GPS receiver details');
}

function hasReceiverInfoMetadata(parsed) {
  return Boolean(
    parsed?.boardPartNumber
    || parsed?.softwareVersion
    || parsed?.fpgaVersion
    || parsed?.gpsStatus
    || parsed?.antennaStatus
    || parsed?.acquisitionState,
  );
}

function parseGpsModeResponse(raw) {
  const normalized = String(raw || "")
    .replace(/\0/g, " ")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
  const validModes = ["TIME MODE", "DYNAMIC MODE", "AUTO MODE"];

  let detectedMode = null;
  for (const mode of validModes) {
    if (new RegExp(`\\b${mode}\\b`, "i").test(normalized)) {
      detectedMode = mode;
      break;
    }
  }

  return {
    raw: normalized,
    mode: detectedMode,
  };
}

function createGpsDetailEligibilitySnapshot(previousSnapshot = lastReceiverSnapshot, liveReceiverState = {}) {
  const receiverReachable = liveReceiverState.receiverReachable ?? previousSnapshot.receiverReachable;
  const loginOk = liveReceiverState.loginOk ?? previousSnapshot.loginOk;

  return {
    ...previousSnapshot,
    receiverConfigured: CONFIG.receiverEnabled,
    receiverReachable: Boolean(receiverReachable),
    loginOk: Boolean(loginOk),
    gpsLockState: liveReceiverState.gpsLockState ?? previousSnapshot.gpsLockState ?? "unknown",
    receiverCommunicationState: loginOk ? "authenticated" : receiverReachable ? "reachable" : (previousSnapshot.receiverCommunicationState || "unreachable"),
  };
}

async function readGpsReceiverDetails() {
  const details = createEmptyGpsReceiverDetails({
    fetchedAt: new Date().toISOString(),
  });
  const errors = [];

  const readTask = async (key, runner) => {
    try {
      return await runner();
    } catch (error) {
      errors.push(error?.message || String(error));
      return null;
    }
  };

  const receiverInfo = await readTask(
    'receiverInfo',
    () => executeReceiverCommandVariants(
      GPS_DETAIL_COMMANDS.receiverInfo,
      parseGpsReceiverInfo,
      {
        timeoutMs: CONFIG.requestTimeoutMs + 2500,
        validateParsed: hasReceiverInfoMetadata,
        commandOptions: {
          responseMode: "pattern",
          completionPattern: /GPS\s+ACQUISITION\s+STATE/i,
          idleGraceMs: 300,
        },
      },
    ),
  );
  if (receiverInfo) {
    details.metadata = {
      acquisitionState: receiverInfo.acquisitionState || null,
      antennaStatus: receiverInfo.antennaStatus || null,
      boardPartNumber: receiverInfo.boardPartNumber || null,
      softwareVersion: receiverInfo.softwareVersion || null,
      fpgaVersion: receiverInfo.fpgaVersion || null,
      gpsStatus: receiverInfo.gpsStatus || null,
    };
  } else {
    const receiverInfoError = "F119 receiver metadata unavailable or incomplete";
    errors.push(receiverInfoError);
    details.error = receiverInfoError;
  }

  const llaPosition = await readTask('positionLla', () => executeReceiverCommandVariants(GPS_DETAIL_COMMANDS.positionLla, parseGpsPosition));
  if (llaPosition?.mode === 'lla') {
    details.position.latitude = llaPosition.latitude || null;
    details.position.longitude = llaPosition.longitude || null;
    details.position.altitudeMeters = Number.isFinite(llaPosition.altitudeMeters) ? llaPosition.altitudeMeters : null;
  }

  const xyzPosition = await readTask('positionXyz', () => executeReceiverCommandVariants(GPS_DETAIL_COMMANDS.positionXyz, parseGpsPosition));
  if (xyzPosition?.mode === 'xyz') {
    details.position.xMeters = Number.isFinite(xyzPosition.xMeters) ? xyzPosition.xMeters : null;
    details.position.yMeters = Number.isFinite(xyzPosition.yMeters) ? xyzPosition.yMeters : null;
    details.position.zMeters = Number.isFinite(xyzPosition.zMeters) ? xyzPosition.zMeters : null;
  }

  const satelliteCurrentList = await readTask('satellitesCurrent', () => executeReceiverCommandVariants(GPS_DETAIL_COMMANDS.satellitesCurrent, parseGpsSatelliteList, { timeoutMs: CONFIG.requestTimeoutMs + 2500 }));
  if (satelliteCurrentList) {
    details.satellites = satelliteCurrentList.satellites || [];
  }

  const satelliteTrackedList = await readTask('satellitesTracked', () => executeReceiverCommandVariants(GPS_DETAIL_COMMANDS.satellitesTracked, parseGpsSatelliteList, { timeoutMs: CONFIG.requestTimeoutMs + 2500 }));
  if (satelliteTrackedList?.satellites?.length) {
    details.satelliteTracking = satelliteTrackedList.satellites;
    details.satelliteTrackingUpdatedAt = new Date().toISOString();
    details.satelliteTrackingSource = "receiver-command";
    details.satelliteTrackingPage = `F60 ${gpsSlotCommandToken} TRACKED`;
  }

  const webTelemetry = await fetchXliWebSatelliteTelemetry();
  if (webTelemetry.satelliteTracking.length > 0) {
    details.satelliteTracking = webTelemetry.satelliteTracking;
    details.satelliteTrackingUpdatedAt = webTelemetry.satelliteTrackingUpdatedAt;
    details.satelliteTrackingSource = webTelemetry.satelliteTrackingSource;
    details.satelliteTrackingPage = webTelemetry.satelliteTrackingPage;
  } else if (CONFIG.xliWebEnabled) {
    details.satelliteTracking = [];
    details.satelliteTrackingUpdatedAt = null;
    details.satelliteTrackingSource = null;
    details.satelliteTrackingPage = null;
  }

  if (errors.length > 0 && !details.satellites.length && !details.satelliteTracking.length && !Object.values(details.metadata).some(Boolean) && !Object.values(details.position).some((value) => value !== null)) {
    details.error = webTelemetry.error || errors[0];
  }

  return sanitizeGpsReceiverDetails(details);
}

async function readGpsReceiverDetailsCached(snapshot = lastReceiverSnapshot, { force = false } = {}) {
  if (force) {
    gpsDetailCache = {
      expiresAt: 0,
      promise: null,
      data: null,
    };
  }

  if (snapshot.receiverConfigured === false || !snapshot.receiverReachable || !snapshot.loginOk) {
    return sanitizeGpsReceiverDetails(
      gpsDetailCache.data
        || lastKnownGoodReceiverSnapshot?.gpsReceiverDetails
        || lastReceiverSnapshot.gpsReceiverDetails,
    );
  }

  const now = Date.now();
  if (!force && gpsDetailCache.data && gpsDetailCache.expiresAt > now) {
    return sanitizeGpsReceiverDetails(gpsDetailCache.data);
  }

  if (!force && gpsDetailCache.promise) {
    return gpsDetailCache.promise;
  }

  gpsDetailCache.promise = readGpsReceiverDetails()
    .catch((error) => mergeGpsReceiverDetails({
      fetchedAt: new Date().toISOString(),
      error: error?.message || 'GPS receiver details unavailable',
    }, gpsDetailCache.data || lastKnownGoodReceiverSnapshot?.gpsReceiverDetails || lastReceiverSnapshot.gpsReceiverDetails))
    .then((details) => {
      const sanitized = sanitizeGpsReceiverDetails(details);
      gpsDetailCache = {
        expiresAt: Date.now() + GPS_DETAIL_CACHE_MS,
        promise: null,
        data: sanitized,
      };
      return sanitized;
    })
    .catch((error) => {
      gpsDetailCache = { expiresAt: 0, promise: null, data: null };
      throw error;
    });

  return gpsDetailCache.promise;
}

function sanitizeReceiverStatus(snapshot = lastReceiverSnapshot, overrides = {}) {
  const status = buildStatusPayload(snapshot, overrides);
  status.telemetryState = status.dataState === "unavailable"
    ? "unavailable"
    : status.stale
      ? "unavailable"
      : (status.receiverCommunicationState === "reconnecting" || status.receiverCommunicationState === "auth-recovery")
        ? "reconnecting"
        : status.dataState === "cached"
          ? "cached"
          : "normal";
  status.gpsReceiverDetails = {
    ...sanitizeGpsReceiverDetails(status.gpsReceiverDetails),
    cacheState: status.telemetryState === "normal" ? "live" : status.telemetryState === "cached" ? "cached" : "retained",
  };
  status.satelliteTracking = Array.isArray(status.gpsReceiverDetails?.satelliteTracking)
    ? status.gpsReceiverDetails.satelliteTracking
    : [];
  status.satelliteTrackingUpdatedAt = status.gpsReceiverDetails?.satelliteTrackingUpdatedAt || null;
  status.satelliteTrackingSource = status.gpsReceiverDetails?.satelliteTrackingSource || null;
  status.satelliteTrackingPage = status.gpsReceiverDetails?.satelliteTrackingPage || null;
  if (status.stale) {
    monitoringMemory.statusBecameStaleAt = monitoringMemory.statusBecameStaleAt || status.checkedAt || new Date().toISOString();
    status.statusBecameStaleAt = monitoringMemory.statusBecameStaleAt;
  } else {
    monitoringMemory.statusBecameStaleAt = null;
  }
  return status;
}

function buildReceiverFailureContext(error, { fallbackReason = "receiver-unavailable" } = {}) {
  const classified = classifyReceiverError(error);
  const managerSnapshot = getReceiverManagerSnapshot();
  const effectiveReceiverReachable = managerSnapshot.connected || classified.receiverReachable;
  const effectiveLoginOk = managerSnapshot.connected ? true : classified.loginOk;
  const receiverCommunicationState = classified.receiverConfigured === false
    ? "disabled"
    : managerSnapshot.reconnecting || managerSnapshot.connecting
      ? "reconnecting"
      : classified.receiverCommunicationState === "auth-recovery"
        ? "auth-recovery"
      : managerSnapshot.state === "login-failed"
        ? "login-failed"
        : classified.receiverCommunicationState;

  const logMessage = receiverCommunicationState === "reconnecting"
    ? "[GPS] receiver auth/session recovery pending (reconnecting)"
    : receiverCommunicationState === "auth-recovery"
      ? "[GPS] receiver auth/session recovery pending (auth-recovery)"
      : !effectiveReceiverReachable
        ? "[GPS] receiver unreachable"
        : !effectiveLoginOk
          ? "[GPS] receiver reachable but login/authentication not ready"
          : null;
  const logKey = `${receiverCommunicationState}:${effectiveReceiverReachable ? "reachable" : "unreachable"}:${effectiveLoginOk ? "login-ok" : "login-fail"}`;
  if (logMessage) {
    const now = Date.now();
    const shouldLog = receiverFailureLogMemory.key !== logKey || (now - receiverFailureLogMemory.lastAt) >= 15000;
    if (shouldLog) {
      receiverFailureLogMemory = {
        key: logKey,
        lastAt: now,
      };
      if (receiverCommunicationState === "reconnecting" || receiverCommunicationState === "auth-recovery") {
        console.warn(logMessage);
      } else if (!effectiveReceiverReachable) {
        console.error(logMessage);
      } else {
        console.warn(logMessage);
      }
    }
  }

  return {
    receiverConfigured: classified.receiverConfigured !== false,
    receiverReachable: effectiveReceiverReachable,
    loginOk: effectiveLoginOk,
    isLocked: false,
    gpsLockState: error?.parsed?.gpsLockState || lastReceiverSnapshot.gpsLockState || "unknown",
    receiverCommunicationState,
    receiverConnectionState: managerSnapshot.state,
    fallbackReason: classified.receiverConfigured === false ? "receiver-not-configured" : fallbackReason,
    lastError: classified.lastError,
    statusText: receiverCommunicationState === "reconnecting"
      ? "Receiver reconnecting"
      : receiverCommunicationState === "auth-recovery"
        ? "Receiver reachable; authentication recovery in progress"
        : "Primary GPS receiver is temporarily unavailable. Backup time source is active.",
  };
}

function buildCachedReceiverStatus(error, { fallbackReason = "receiver-unavailable" } = {}) {
  const failureContext = buildReceiverFailureContext(error, { fallbackReason });
  const trustedSnapshot = hasTrustedReceiverSnapshot()
    ? lastKnownGoodReceiverSnapshot
    : null;

  if (!trustedSnapshot) {
    return null;
  }

  const cachedSnapshot = updateReceiverSnapshot({
    ...trustedSnapshot,
    ...failureContext,
    gpsReceiverDetails: mergeGpsReceiverDetails(
      trustedSnapshot.gpsReceiverDetails,
      lastReceiverSnapshot.gpsReceiverDetails,
    ),
  });

  return sanitizeReceiverStatus(cachedSnapshot, {
    success: false,
    dataState: "cached",
    fetchedFromCache: true,
    cacheAgeMs: cachedSnapshot.checkedAt ? Math.max(0, Date.now() - new Date(cachedSnapshot.checkedAt).getTime()) : null,
  });
}

async function readReceiverTime() {
  const startedMonotonicMs = performance.now();
  const startedAtMs = Date.now();
  await throttleReceiverAccess({ commandPriority: "high" });
  const connection = await connectToReceiver("F3\r\n", {
    responseMode: "pattern",
    completionPattern: /F3\s+\w+\s+\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}/i,
    idleGraceMs: 35,
    priority: "high",
    priorityWeight: 1000,
  });
  const receiverCapturedAtMs = Number.isFinite(connection?.timings?.receiverResponseFirstByteAtMs)
    ? connection.timings.receiverResponseFirstByteAtMs
    : Date.now();
  const receiverResponseCompleteAtMs = Number.isFinite(connection?.timings?.receiverResponseCompleteAtMs)
    ? connection.timings.receiverResponseCompleteAtMs
    : receiverCapturedAtMs;
  const receiverParsedAtMs = Date.now();
  const parsed = parseGpsTimeResponse(connection.raw);

  if (!parsed.isLocked) {
    console.warn("[GPS] receiver reachable but unlocked");
    const lockError = new Error(parsed.statusText);
    lockError.code = "GPS_UNLOCKED";
    lockError.parsed = parsed;
    throw lockError;
  }

  const receiverTimestampMs = Number(parsed.timestamp);
  if (!Number.isFinite(receiverTimestampMs)) {
    throw new Error("Unable to construct a valid GPS timestamp");
  }

  const payload = buildTimingPayload({
    ...getSourceDefinition("gps-xli"),
    timestamp: receiverTimestampMs,
    isoTimestamp: new Date(receiverTimestampMs).toISOString(),
    upstream: CONFIG.gpsHost,
    protocol: "receiver",
  }, {
    backendOnline: true,
    receiverConfigured: true,
    receiverReachable: connection.receiverReachable,
    loginOk: connection.loginOk,
    isLocked: true,
    gpsLockState: parsed.gpsLockState,
    receiverCommunicationState: connection.loginOk ? "authenticated" : "reachable",
    statusText: parsed.statusText,
    sourceTime: "rx-receiver",
    sourceCalendar: "gps-receiver",
    sourceTimestampMs: receiverTimestampMs,
    authoritativeTimestampMs: receiverTimestampMs,
    displayTimestampMs: receiverTimestampMs,
    receiverTimestampRaw: parsed.timestamp,
    receiverDateRaw: parsed.receiverDate,
    receiverTimeRaw: parsed.receiverTime,
    receiverDoyRaw: Number.isFinite(parsed.receiverDoy) ? parsed.receiverDoy : null,
    receiverYearRaw: parsed.receiverYear ?? null,
    receiverTimeMode: parsed.receiverTimeMode,
    displayIso: new Date(receiverTimestampMs).toISOString(),
    omanFormattedParts: getOmanDateTimeParts(receiverTimestampMs),
    calendarReferenceTimestampMs: receiverTimestampMs,
    calendarSourceKey: "gps-receiver",
    calendarSourceLabel: "GPS Receiver",
    fallbackReason: null,
    freshnessMs: Math.max(0, Date.now() - receiverCapturedAtMs),
    backendCapturedAtMs: receiverCapturedAtMs,
    backendMonotonicCapturedAtMs: startedMonotonicMs,
    sourceCapturedAtMs: receiverCapturedAtMs,
    sourceMonotonicCapturedAtMs: startedMonotonicMs,
    commandQueuedAtMs: connection?.timings?.commandQueuedAtMs ?? startedAtMs,
    commandSentAtMs: connection?.timings?.commandSentAtMs ?? null,
    receiverResponseFirstByteAt: receiverCapturedAtMs,
    receiverResponseCompleteAt: receiverResponseCompleteAtMs,
    receiverParsedAt: receiverParsedAtMs,
    hotPathLatencyMs: Math.round(performance.now() - startedMonotonicMs),
    timingDiagnostics: {
      receiverPathMs: Math.round(performance.now() - startedMonotonicMs),
      queueWaitMs: connection?.timings?.queueWaitMs ?? null,
      receiverResponseWindowMs: connection?.timings?.receiverResponseWindowMs ?? null,
    },
  });

  updateReceiverSnapshot({
    receiverConfigured: true,
    receiverReachable: connection.receiverReachable,
    loginOk: connection.loginOk,
    isLocked: true,
    gpsLockState: parsed.gpsLockState,
    statusText: payload.statusText,
    currentSource: payload.currentSource,
    currentSourceLabel: payload.currentSourceLabel,
    sourceKey: payload.sourceKey,
    sourceLabel: payload.sourceLabel,
    sourceTier: payload.sourceTier,
    authoritative: payload.authoritative,
    traceable: payload.traceable,
    fallback: payload.fallback,
    receiverCommunicationState: payload.receiverCommunicationState,
    lastError: null,
    receiverTimestampRaw: payload.receiverTimestampRaw,
    receiverDateRaw: payload.receiverDateRaw,
    receiverTimeRaw: payload.receiverTimeRaw,
    receiverDoyRaw: payload.receiverDoyRaw,
    receiverYearRaw: payload.receiverYearRaw,
    sourceTime: payload.sourceTime,
    sourceCalendar: payload.sourceCalendar,
  });

  return payload;
}

async function readReceiverTimeFastPath() {
  const now = Date.now();
  if (lastFastRxTimePayload && Number.isFinite(lastFastRxTimePayload.backendCapturedAtMs) && (now - lastFastRxTimePayload.backendCapturedAtMs) <= 150) {
    return {
      ...lastFastRxTimePayload,
      servedFromHotCache: true,
    };
  }

  if (!inFlightHighPriorityTimeRead) {
    inFlightHighPriorityTimeRead = readReceiverTime()
      .then((payload) => {
        lastFastRxTimePayload = payload;
        return payload;
      })
      .finally(() => {
        inFlightHighPriorityTimeRead = null;
      });
  }

  return inFlightHighPriorityTimeRead;
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
      statusText: getSourceDefinition(lastResolvedTimeSource.sourceKey || "local-clock").status,
      currentSource: lastResolvedTimeSource.sourceKey || "local-clock",
      currentSourceLabel: lastResolvedTimeSource.sourceLabel || getSourceDefinition("local-clock").sourceLabel,
      sourceKey: lastResolvedTimeSource.sourceKey || "local-clock",
      sourceLabel: lastResolvedTimeSource.sourceLabel || getSourceDefinition("local-clock").sourceLabel,
      sourceTier: lastResolvedTimeSource.sourceTier || getSourceDefinition("local-clock").sourceTier,
      authoritative: Boolean(lastResolvedTimeSource.authoritative),
      traceable: Boolean(lastResolvedTimeSource.traceable),
      fallback: lastResolvedTimeSource.fallback !== false,
      receiverCommunicationState: "disabled",
      fallbackReason: "receiver-not-configured",
      lastError: null,
    });
    return sanitizeReceiverStatus(snapshot, { dataState: "cached" });
  }

  if (!force && receiverStatusCache.data && receiverStatusCache.expiresAt > now) {
    const managerSnapshot = getReceiverManagerSnapshot();
    return sanitizeReceiverStatus({
      ...receiverStatusCache.data,
      receiverCommunicationState: managerSnapshot.reconnecting
        ? "reconnecting"
        : receiverStatusCache.data.receiverCommunicationState,
    }, {
      dataState: "live",
      fetchedFromCache: true,
      cacheAgeMs: Math.max(0, now - new Date(receiverStatusCache.data.checkedAt).getTime()),
      statusAgeMs: Math.max(0, now - new Date(receiverStatusCache.data.checkedAt).getTime()),
      cacheState: "warm",
    });
  }

  if (!force && receiverStatusCache.promise) {
    return receiverStatusCache.promise;
  }

  if (
    !force
    && lastFastRxTimePayload
    && Number.isFinite(lastFastRxTimePayload.backendCapturedAtMs)
    && (Date.now() - lastFastRxTimePayload.backendCapturedAtMs) <= Math.max(2000, CONFIG.receiverStatusCacheMs)
  ) {
    const detailSnapshot = createGpsDetailEligibilitySnapshot(lastReceiverSnapshot, {
      receiverReachable: lastFastRxTimePayload.receiverReachable,
      loginOk: lastFastRxTimePayload.loginOk,
      gpsLockState: lastFastRxTimePayload.gpsLockState,
    });
    const gpsReceiverDetails = await readGpsReceiverDetailsCached(detailSnapshot, { force: false });
    const status = sanitizeReceiverStatus({
      ...lastReceiverSnapshot,
      receiverReachable: lastFastRxTimePayload.receiverReachable,
      loginOk: lastFastRxTimePayload.loginOk,
      isLocked: lastFastRxTimePayload.isLocked,
      gpsLockState: lastFastRxTimePayload.gpsLockState,
      statusText: lastFastRxTimePayload.statusText,
      currentSource: lastFastRxTimePayload.currentSource,
      currentSourceLabel: lastFastRxTimePayload.currentSourceLabel,
      sourceKey: lastFastRxTimePayload.sourceKey,
      sourceLabel: lastFastRxTimePayload.sourceLabel,
      sourceTier: lastFastRxTimePayload.sourceTier,
      authoritative: lastFastRxTimePayload.authoritative,
      traceable: lastFastRxTimePayload.traceable,
      fallback: lastFastRxTimePayload.fallback,
      receiverCommunicationState: lastFastRxTimePayload.loginOk ? "authenticated" : "reachable",
      lastError: null,
      gpsReceiverDetails,
    }, { dataState: "live", fetchedFromCache: true });

    receiverStatusCache = {
      promise: null,
      data: status,
      expiresAt: Date.now() + CONFIG.receiverStatusCacheMs,
    };
    return status;
  }

  receiverStatusCache.promise = readReceiverTime()
    .then(async (receiverTime) => {
      const detailSnapshot = createGpsDetailEligibilitySnapshot(lastReceiverSnapshot, {
        receiverReachable: receiverTime.receiverReachable,
        loginOk: receiverTime.loginOk,
        gpsLockState: receiverTime.gpsLockState,
      });
      const gpsReceiverDetails = await readGpsReceiverDetailsCached(detailSnapshot, { force });
      const status = sanitizeReceiverStatus({
        ...lastReceiverSnapshot,
        receiverReachable: receiverTime.receiverReachable,
        loginOk: receiverTime.loginOk,
        isLocked: receiverTime.isLocked,
        gpsLockState: receiverTime.gpsLockState,
        statusText: receiverTime.statusText,
        currentSource: receiverTime.currentSource,
        currentSourceLabel: receiverTime.currentSourceLabel,
        sourceKey: receiverTime.sourceKey,
        sourceLabel: receiverTime.sourceLabel,
        sourceTier: receiverTime.sourceTier,
        authoritative: receiverTime.authoritative,
        traceable: receiverTime.traceable,
        fallback: receiverTime.fallback,
        receiverCommunicationState: receiverTime.loginOk ? "authenticated" : "reachable",
        lastError: null,
        gpsReceiverDetails,
      }, { dataState: "live" });
      updateReceiverSnapshot({
        ...lastReceiverSnapshot,
        gpsReceiverDetails,
      });
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
      const cachedStatus = buildCachedReceiverStatus(error);
      receiverStatusCache = {
        promise: null,
        data: cachedStatus,
        expiresAt: cachedStatus ? Date.now() + CONFIG.receiverStatusCacheMs : 0,
      };

      if (cachedStatus) {
        return cachedStatus;
      }

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
  const forceRefresh = parseBoolean(req.query.refresh) || parseBoolean(req.query.force);
  try {
    const status = await readReceiverStatusCached({ force: forceRefresh });
    res.json(status);
  } catch (error) {
    const cachedStatus = buildCachedReceiverStatus(error);
    if (cachedStatus) {
      res.json(cachedStatus);
      return;
    }

    const failureContext = buildReceiverFailureContext(error);
    const activeSource = getSourceDefinition(lastResolvedTimeSource.sourceKey || 'local-clock');
    const baseSnapshot = {
      ...failureContext,
      statusText: activeSource.status,
      currentSource: activeSource.sourceKey,
      currentSourceLabel: activeSource.sourceLabel,
      sourceKey: activeSource.sourceKey,
      sourceLabel: activeSource.sourceLabel,
      sourceTier: activeSource.sourceTier,
      authoritative: activeSource.authoritative,
      traceable: activeSource.traceable,
      fallback: activeSource.fallback,
      upstream: lastResolvedTimeSource.upstream || null,
      protocol: lastResolvedTimeSource.protocol || null,
    };
    const gpsReceiverDetails = mergeGpsReceiverDetails(
      lastKnownGoodReceiverSnapshot?.gpsReceiverDetails,
      lastReceiverSnapshot.gpsReceiverDetails,
    );
    const snapshot = updateReceiverSnapshot({
      ...baseSnapshot,
      gpsReceiverDetails,
    });

    res.json(sanitizeReceiverStatus(snapshot, {
      success: false,
      dataState: 'unavailable',
    }));
  }
});

app.get("/api/time", requireApiAuth, timeRateLimiter, async (req, res) => {
  try {
    const receiverTime = await readReceiverTimeFastPath();
    const responseSentAtMs = Date.now();
    receiverTime.backendResponseSentAtMs = responseSentAtMs;
    const freshnessReferenceMs = Number.isFinite(receiverTime.backendCapturedAtMs)
      ? receiverTime.backendCapturedAtMs
      : Number.isFinite(receiverTime.backendPayloadBuiltAtMs)
        ? receiverTime.backendPayloadBuiltAtMs
        : responseSentAtMs;
    receiverTime.backendPayloadBuiltAtMs = receiverTime.backendPayloadBuiltAtMs || Date.now();
    receiverTime.freshnessMs = Math.max(0, (receiverTime.backendPayloadBuiltAtMs || responseSentAtMs) - freshnessReferenceMs);
    receiverTime.freshnessMsAtResponse = Math.max(0, responseSentAtMs - freshnessReferenceMs);
    receiverStatusCache = {
      promise: null,
      data: sanitizeReceiverStatus(lastReceiverSnapshot),
      expiresAt: Date.now() + CONFIG.receiverStatusCacheMs,
    };
    res.json(receiverTime);
  } catch (error) {
    const receiverContext = {
      backendOnline: true,
      ...buildReceiverFailureContext(error),
    };

    const resolvedPayload = await resolveNetworkFallback({
      ...receiverContext,
      statusText: receiverContext.statusText,
      gpsReceiverDetails: mergeGpsReceiverDetails(
        lastKnownGoodReceiverSnapshot?.gpsReceiverDetails,
        lastReceiverSnapshot.gpsReceiverDetails,
      ),
    });

    updateReceiverSnapshot({
      ...receiverContext,
      statusText: resolvedPayload.statusText,
      currentSource: resolvedPayload.currentSource,
      currentSourceLabel: resolvedPayload.currentSourceLabel,
      sourceKey: resolvedPayload.sourceKey,
      sourceLabel: resolvedPayload.sourceLabel,
      sourceTier: resolvedPayload.sourceTier,
      authoritative: resolvedPayload.authoritative,
      traceable: resolvedPayload.traceable,
      fallback: resolvedPayload.fallback,
      upstream: resolvedPayload.upstream,
      protocol: resolvedPayload.protocol,
    });

    receiverStatusCache = {
      promise: null,
      data: sanitizeReceiverStatus(lastReceiverSnapshot, { dataState: resolvedPayload.fallback ? 'cached' : 'live' }),
      expiresAt: Date.now() + CONFIG.receiverStatusCacheMs,
    };

    const responseSentAtMs = Date.now();
    resolvedPayload.backendResponseSentAtMs = responseSentAtMs;
    const freshnessReferenceMs = Number.isFinite(resolvedPayload.backendCapturedAtMs)
      ? resolvedPayload.backendCapturedAtMs
      : Number.isFinite(resolvedPayload.backendPayloadBuiltAtMs)
        ? resolvedPayload.backendPayloadBuiltAtMs
        : responseSentAtMs;
    resolvedPayload.freshnessMs = Math.max(0, (resolvedPayload.backendPayloadBuiltAtMs || responseSentAtMs) - freshnessReferenceMs);
    resolvedPayload.freshnessMsAtResponse = Math.max(0, responseSentAtMs - freshnessReferenceMs);
    res.json(resolvedPayload);
  }
});

app.post("/api/time/set", requireApiAuth, setTimeRateLimiter, async (req, res) => {
  try {
    const useInternet = Boolean(req.body?.useInternet);
    let omanTimestamp;
    let source;

    if (useInternet) {
      const networkTime = await resolveNetworkFallback({
        backendOnline: true,
        receiverConfigured: CONFIG.receiverEnabled,
        receiverReachable: Boolean(lastReceiverSnapshot.receiverReachable),
        loginOk: Boolean(lastReceiverSnapshot.loginOk),
        gpsLockState: lastReceiverSnapshot.gpsLockState || 'unknown',
        receiverCommunicationState: lastReceiverSnapshot.receiverCommunicationState || 'not-started',
      });
      if (networkTime.sourceKey === 'local-clock') {
        throw new Error('Traceable/network fallback unavailable for receiver set operation');
      }
      omanTimestamp = networkTime.timestamp;
      source = networkTime.sourceLabel;
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
      statusText: "Nominal (synchronized)",
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
    const failureContext = buildReceiverFailureContext(error, { fallbackReason: "set-time-failed" });
    updateReceiverSnapshot({
      ...failureContext,
      isLocked: false,
      gpsLockState: "unknown",
      statusText: "Lost (no valid time source)",
      currentSource: lastResolvedTimeSource.sourceKey || 'local-clock',
      currentSourceLabel: lastResolvedTimeSource.sourceLabel || getSourceDefinition('local-clock').sourceLabel,
      sourceKey: lastResolvedTimeSource.sourceKey || 'local-clock',
      sourceLabel: lastResolvedTimeSource.sourceLabel || getSourceDefinition('local-clock').sourceLabel,
      sourceTier: lastResolvedTimeSource.sourceTier || getSourceDefinition('local-clock').sourceTier,
      authoritative: Boolean(lastResolvedTimeSource.authoritative),
      traceable: Boolean(lastResolvedTimeSource.traceable),
      fallback: lastResolvedTimeSource.fallback !== false,
      lastError: error.message,
      gpsReceiverDetails: mergeGpsReceiverDetails(
        lastKnownGoodReceiverSnapshot?.gpsReceiverDetails,
        lastReceiverSnapshot.gpsReceiverDetails,
      ),
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
      receiverConfigured: failureContext.receiverConfigured !== false,
    });
  }
});

app.get("/api/time/internet", requireApiAuth, internetRateLimiter, async (req, res) => {
  const payload = await resolveNetworkFallback({
    backendOnline: true,
    receiverConfigured: CONFIG.receiverEnabled,
    receiverReachable: Boolean(lastReceiverSnapshot.receiverReachable),
    loginOk: Boolean(lastReceiverSnapshot.loginOk),
    gpsLockState: lastReceiverSnapshot.gpsLockState || 'unknown',
    receiverCommunicationState: CONFIG.receiverEnabled ? (lastReceiverSnapshot.receiverCommunicationState || 'not-started') : 'disabled',
    fallbackReason: CONFIG.receiverEnabled ? 'receiver-unavailable' : 'receiver-not-configured',
    lastError: lastReceiverSnapshot.lastError || null,
    gpsReceiverDetails: mergeGpsReceiverDetails(
      lastKnownGoodReceiverSnapshot?.gpsReceiverDetails,
      lastReceiverSnapshot.gpsReceiverDetails,
    ),
  });

  updateReceiverSnapshot({
    ...lastReceiverSnapshot,
    currentSource: payload.currentSource,
    currentSourceLabel: payload.currentSourceLabel,
    sourceKey: payload.sourceKey,
    sourceLabel: payload.sourceLabel,
    sourceTier: payload.sourceTier,
    authoritative: payload.authoritative,
    traceable: payload.traceable,
    fallback: payload.fallback,
    statusText: payload.statusText,
    fallbackReason: payload.fallbackReason,
    upstream: payload.upstream,
    protocol: payload.protocol,
  });

  receiverStatusCache = {
    promise: null,
    data: sanitizeReceiverStatus(lastReceiverSnapshot, { dataState: payload.fallback ? 'cached' : 'live' }),
    expiresAt: Date.now() + CONFIG.receiverStatusCacheMs,
  };

  res.json(payload);
});

if (CONFIG.serveStatic) {
  ["images", "styles"].forEach((assetDir) => {
    app.use(`/${assetDir}`, express.static(path.join(publicPath, assetDir), {
      fallthrough: false,
      index: false,
      setHeaders(res) {
        setNoStore(res);
      },
    }));
  });

  FRONTEND_ASSET_FILES.forEach((fileName) => {
    app.get(`/${fileName}`, (req, res) => {
      setNoStore(res);
      res.sendFile(path.join(publicPath, fileName));
    });
  });

  app.get("/official-time", (req, res) => {
    setNoStore(res);
    res.sendFile(path.join(publicPath, "official-time.html"));
  });

  app.get("/official-digital-time", (req, res) => {
    setNoStore(res);
    res.sendFile(path.join(publicPath, "official-digital-time.html"));
  });

  app.get("/dashboard", (req, res) => {
    setNoStore(res);
    res.sendFile(path.join(publicPath, "index.html"));
  });

  app.get("/", (req, res) => {
    res.redirect("/official-time");
  });
}

function startServer() {
  const server = app.listen(CONFIG.port, () => {
    console.log(`GPS backend listening on http://localhost:${CONFIG.port}`);
    console.log(`Receiver target: ${CONFIG.gpsHost}:${CONFIG.gpsPort}`);
    console.log(`Static frontend serving: ${CONFIG.serveStatic ? "enabled" : "disabled"}`);
    console.log(`API auth: ${CONFIG.authEnabled ? "enabled" : "disabled"}`);
    console.log(
      `CORS policy: ${allowedOrigins.size > 0 ? Array.from(allowedOrigins).join(", ") : isProduction ? "same-origin / non-browser only until ALLOWED_ORIGIN is set" : "development-open"}`,
    );
  });

  server.on("close", () => {
    receiverManager?.close();
  });

  return server;
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
  parseGpsModeResponse,
  classifyReceiverError,
  deriveMonitoringState,
  createGpsDetailEligibilitySnapshot,
};
