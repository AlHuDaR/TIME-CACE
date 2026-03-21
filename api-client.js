(function (global) {
  function readMetaConfig(name) {
    return global.document?.querySelector(`meta[name="${name}"]`)?.content?.trim() || "";
  }

  const APP_CONFIG = Object.freeze({
    timezone: "Asia/Muscat",
    timezoneLabel: "Gulf Standard Time (GST, UTC+04:00)",
    modeTransitionMs: 260,
    syncIntervalMs: 30000,
    statusPollingEnabled: global.APP_CONFIG?.STATUS_POLLING_ENABLED !== false,
    statusPollingIntervalMs: Number(global.APP_CONFIG?.STATUS_POLLING_INTERVAL_MS) > 0
      ? Number(global.APP_CONFIG.STATUS_POLLING_INTERVAL_MS)
      : 15000,
    statusFreshnessWindowMs: 45000,
    liveStatusRefreshIntervalMs: Number(global.APP_CONFIG?.LIVE_STATUS_REFRESH_INTERVAL_MS) > 0
      ? Number(global.APP_CONFIG.LIVE_STATUS_REFRESH_INTERVAL_MS)
      : 5000,
    requestTimeoutMs: Number(global.APP_CONFIG?.API_REQUEST_TIMEOUT_MS) > 0
      ? Number(global.APP_CONFIG.API_REQUEST_TIMEOUT_MS)
      : 5000,
    localApiPort: 3000,
    localDevPorts: Object.freeze([3000]),
    localhostNames: Object.freeze(["localhost", "127.0.0.1"]),
    apiBaseUrl: typeof global.APP_CONFIG?.API_BASE_URL === "string" && global.APP_CONFIG.API_BASE_URL.trim()
      ? global.APP_CONFIG.API_BASE_URL.trim()
      : readMetaConfig("rafo-api-base-url"),
    apiBackupUrl: typeof global.APP_CONFIG?.API_BACKUP_URL === "string" && global.APP_CONFIG.API_BACKUP_URL.trim()
      ? global.APP_CONFIG.API_BACKUP_URL.trim()
      : readMetaConfig("rafo-api-backup-url"),
    siteBaseUrl: typeof global.APP_CONFIG?.SITE_BASE_URL === "string" && global.APP_CONFIG.SITE_BASE_URL.trim()
      ? global.APP_CONFIG.SITE_BASE_URL.trim()
      : readMetaConfig("rafo-site-base-url"),
    apiAuthToken: typeof global.APP_CONFIG?.API_AUTH_TOKEN === "string"
      ? global.APP_CONFIG.API_AUTH_TOKEN.trim()
      : "",
    statusLabels: Object.freeze({
      success: "Success",
      error: "Error",
      warning: "Warning",
      info: "Information",
    }),
  });

  const OMAN_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_CONFIG.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const OMAN_DATE_LINE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_CONFIG.timezone,
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const OMAN_ANALOG_PARTS_FORMATTER = new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_CONFIG.timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour12: false,
  });

  function normalizeBaseUrl(value) {
    return typeof value === "string" && value.trim()
      ? value.trim().replace(/\/$/, "")
      : "";
  }

  function resolveApiBaseUrl() {
    const configured = normalizeBaseUrl(APP_CONFIG.apiBaseUrl);
    if (configured) {
      return configured;
    }

    const { protocol, hostname, origin, port } = global.location;
    const isHttp = protocol === "http:" || protocol === "https:";
    const isLocalhost = APP_CONFIG.localhostNames.includes(hostname);

    if (isLocalhost && isHttp) {
      if (!port || APP_CONFIG.localDevPorts.includes(Number(port))) {
        return `${origin}/api`;
      }

      return `${protocol}//${hostname}:${APP_CONFIG.localApiPort}/api`;
    }

    if (!isHttp) {
      return `http://localhost:${APP_CONFIG.localApiPort}/api`;
    }

    return "/api";
  }

  function resolveSiteBaseUrl() {
    const configured = normalizeBaseUrl(APP_CONFIG.siteBaseUrl);
    const { protocol, origin, hostname } = global.location;
    const isHttp = protocol === "http:" || protocol === "https:";
    const isLocalhost = APP_CONFIG.localhostNames.includes(hostname);

    if (!isHttp || isLocalhost) {
      return origin;
    }

    return configured || origin;
  }

  function buildAppUrl(pathname = "/", searchParams) {
    const target = new URL(pathname, resolveSiteBaseUrl());

    if (searchParams instanceof URLSearchParams) {
      target.search = searchParams.toString();
    } else if (searchParams && typeof searchParams === "object") {
      const params = new URLSearchParams();
      Object.entries(searchParams).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
          params.set(key, String(value));
        }
      });
      target.search = params.toString();
    }

    return target;
  }

  function syncAppLinks(root = global.document) {
    if (!root?.querySelectorAll) {
      return;
    }

    root.querySelectorAll("[data-app-link]").forEach((link) => {
      const targetPath = link.getAttribute("data-app-link");
      if (!targetPath) {
        return;
      }

      const url = buildAppUrl(targetPath);
      link.href = url.toString();
    });
  }

  function formatTimeSegment(value) {
    return String(value).padStart(2, "0");
  }

  function formatTimeParts(hour, minute, second) {
    return [hour, minute, second].map(formatTimeSegment).join(":");
  }

  function formatClockTime(value) {
    if (!value) {
      return "Never";
    }

    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "Never";
    }

    return formatTimeParts(date.getHours(), date.getMinutes(), date.getSeconds());
  }

  function normalizeRenderedTime(value) {
    if (value instanceof Date) {
      return formatClockTime(value);
    }

    if (typeof value !== "string") {
      return value;
    }

    const match = value.trim().match(/^(\d{1,2}):(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/);
    if (!match) {
      return value;
    }

    const [, hour, minute, second, milliseconds] = match;
    const normalized = formatTimeParts(hour, minute, second);
    return milliseconds ? `${normalized}.${String(milliseconds).padStart(3, "0")}` : normalized;
  }

  function formatRelativeAge(timestamp, fallback = "Unknown") {
    if (!timestamp) {
      return fallback;
    }

    const value = timestamp instanceof Date ? timestamp.getTime() : new Date(timestamp).getTime();
    if (!Number.isFinite(value)) {
      return fallback;
    }

    const diff = Math.max(0, Date.now() - value);
    const totalSeconds = Math.round(diff / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    if (minutes <= 0) {
      return `${seconds}s ago`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (hours <= 0) {
      return `${minutes}m ${seconds}s ago`;
    }

    return `${hours}h ${remainingMinutes}m ago`;
  }

  global.RAFOTimeApp = global.RAFOTimeApp || {};
  Object.assign(global.RAFOTimeApp, {
    APP_CONFIG,
    OMAN_DATE_TIME_FORMATTER,
    OMAN_DATE_LINE_FORMATTER,
    OMAN_ANALOG_PARTS_FORMATTER,
    normalizeBaseUrl,
    resolveApiBaseUrl,
    resolveSiteBaseUrl,
    buildAppUrl,
    syncAppLinks,
    formatTimeSegment,
    formatTimeParts,
    formatClockTime,
    normalizeRenderedTime,
    formatRelativeAge,
  });
})(window);
