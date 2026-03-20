(function (global) {
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
    localApiPort: 3000,
    localDevPorts: Object.freeze([3000]),
    localhostNames: Object.freeze(["localhost", "127.0.0.1"]),
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

  function resolveApiBaseUrl() {
    const configured = global.APP_CONFIG?.API_BASE_URL;
    if (typeof configured === "string" && configured.trim()) {
      return configured.trim().replace(/\/$/, "");
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

  function formatClockTime(value) {
    if (!value) {
      return "Never";
    }

    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "Never";
    }

    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
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
    resolveApiBaseUrl,
    formatClockTime,
    formatRelativeAge,
  });
})(window);
