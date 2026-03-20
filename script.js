const APP_CONFIG = Object.freeze({
  timezone: "Asia/Muscat",
  timezoneLabel: "Gulf Standard Time (GST, UTC+04:00)",
  modeTransitionMs: 260,
  syncIntervalMs: 30000,
  statusPollingEnabled: window.APP_CONFIG?.STATUS_POLLING_ENABLED !== false,
  statusPollingIntervalMs: Number(window.APP_CONFIG?.STATUS_POLLING_INTERVAL_MS) > 0
    ? Number(window.APP_CONFIG.STATUS_POLLING_INTERVAL_MS)
    : 15000,
  statusFreshnessWindowMs: 45000,
  localApiPort: 3000,
  localDevPorts: Object.freeze([3000]),
  localhostNames: Object.freeze(["localhost", "127.0.0.1"]),
  apiAuthToken: typeof window.APP_CONFIG?.API_AUTH_TOKEN === "string"
    ? window.APP_CONFIG.API_AUTH_TOKEN.trim()
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
  const configured = window.APP_CONFIG?.API_BASE_URL;
  if (typeof configured === "string" && configured.trim()) {
    return configured.trim().replace(/\/$/, "");
  }

  const { protocol, hostname, origin, port } = window.location;
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

function normalizeDataState(dataState, stale = false) {
  if (stale && dataState !== "unavailable") {
    return "stale";
  }

  if (["live", "cached", "stale", "unavailable"].includes(dataState)) {
    return dataState;
  }

  return "waiting";
}

function dataStateLabel(dataState) {
  return {
    live: "Live data",
    cached: "Cached snapshot",
    stale: "Stale snapshot",
    unavailable: "Unavailable",
    waiting: "Waiting for data",
  }[dataState] || "Waiting for data";
}

function humanizeSource(source) {
  return {
    "gps-locked": "GPS locked",
    "gps-unlocked": "GPS unlocked",
    holdover: "Holdover",
    "internet-fallback": "Internet fallback",
    local: "Local fallback",
  }[source] || source.replace(/-/g, " ");
}

function humanizeLockState(lockState) {
  return {
    locked: "Locked",
    unlocked: "Unlocked",
    holdover: "Holdover",
    unknown: "Unknown",
  }[lockState] || "Unknown";
}

function valueToneClass(tone) {
  return `value-${tone || "neutral"}`;
}

class NotificationManager {
  constructor() {
    this.container = this.createContainer();
    this.activeNotifications = new Map();
  }

  createContainer() {
    let container = document.getElementById("notification-container");
    if (container) {
      return container;
    }

    container = document.createElement("div");
    container.id = "notification-container";
    document.body.appendChild(container);
    return container;
  }

  appendMessage(content, message) {
    if (Array.isArray(message)) {
      message.filter(Boolean).forEach((line, index) => {
        if (index > 0) {
          content.append(document.createElement("br"));
        }
        content.append(document.createTextNode(String(line)));
      });
      return;
    }

    content.textContent = String(message ?? "");
  }

  show(message, type = "info", duration = 5000) {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const notification = document.createElement("article");
    notification.className = `notification notification-${type}`;

    const icon = document.createElement("div");
    icon.className = "notification-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = {
      success: "✓",
      error: "✕",
      warning: "⚠",
      info: "ℹ",
    }[type] || "ℹ";

    const content = document.createElement("div");
    content.className = "notification-content";

    const title = document.createElement("div");
    title.className = "notification-title";
    title.textContent = APP_CONFIG.statusLabels[type] || APP_CONFIG.statusLabels.info;

    const body = document.createElement("div");
    body.className = "notification-message";
    this.appendMessage(body, message);

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "notification-close";
    closeButton.setAttribute("aria-label", "Close notification");
    closeButton.textContent = "×";
    closeButton.addEventListener("click", () => this.close(id));

    content.append(title, body);
    notification.append(icon, content, closeButton);

    if (duration > 0) {
      const progress = document.createElement("div");
      progress.className = "notification-progress";
      progress.style.animationDuration = `${duration}ms`;
      notification.append(progress);
    }

    this.container.appendChild(notification);
    this.activeNotifications.set(id, notification);

    if (duration > 0) {
      window.setTimeout(() => this.close(id), duration);
    }

    return id;
  }

  close(id) {
    const notification = this.activeNotifications.get(id);
    if (!notification) {
      return;
    }

    notification.classList.add("notification-exit");
    window.setTimeout(() => {
      notification.remove();
      this.activeNotifications.delete(id);
    }, 220);
  }
}

class GPSTimeSync {
  constructor() {
    this.apiBaseUrl = resolveApiBaseUrl();
    this.notifications = window.notificationManager || new NotificationManager();
    this.eventTarget = new EventTarget();
    this.syncInterval = null;
    this.syncInFlight = null;
    this.statusPollInterval = null;
    this.statusPollInFlight = null;
    this.hasShownInitialSync = false;
    this.timeOffset = 0;
    this.lastSyncTime = null;
    this.lastSyncTimestamp = null;
    this.lastSuccessfulStatusPollAt = null;
    this.lastStatusPollAttemptAt = null;
    this.receiverStatus = this.createReceiverStatus();
    this.currentState = this.createState({ currentSource: "local" });
  }

  createReceiverStatus(overrides = {}) {
    return {
      backendOnline: false,
      receiverReachable: false,
      loginOk: false,
      isLocked: false,
      gpsLockState: "unknown",
      statusText: "System status not checked yet",
      currentSource: "local",
      currentSourceLabel: "Local fallback",
      receiverCommunicationState: "not-started",
      lastError: null,
      checkedAt: null,
      lastSuccessfulPollAt: null,
      lastPollAttemptAt: null,
      statusAgeMs: null,
      cacheAgeMs: null,
      fetchedFromCache: false,
      dataState: "waiting",
      stale: true,
      ...overrides,
    };
  }

  createState(overrides = {}) {
    return {
      backendOnline: false,
      receiverReachable: false,
      loginOk: false,
      isLocked: false,
      gpsLockState: "unknown",
      statusText: "Using local computer time",
      currentSource: "local",
      currentSourceLabel: "Local computer time",
      lastError: null,
      date: null,
      time: null,
      timestamp: Date.now(),
      raw: null,
      sourceLabel: "Local computer time",
      ...overrides,
    };
  }

  async init() {
    await this.syncTime();
    if (APP_CONFIG.statusPollingEnabled) {
      await this.pollStatus();
      this.startStatusPolling();
    }
    this.startAutoSync();
    return this;
  }

  getRequestHeaders(extraHeaders = {}) {
    const headers = {
      Accept: "application/json",
      ...extraHeaders,
    };

    if (APP_CONFIG.apiAuthToken) {
      headers.Authorization = `Bearer ${APP_CONFIG.apiAuthToken}`;
      headers["X-API-Key"] = APP_CONFIG.apiAuthToken;
    }

    return headers;
  }

  async syncTime() {
    if (this.syncInFlight) {
      return this.syncInFlight;
    }

    this.syncInFlight = this.performSync().finally(() => {
      this.syncInFlight = null;
    });

    return this.syncInFlight;
  }

  buildErrorState(error, fallback = {}) {
    return this.createState({
      backendOnline: Boolean(error?.payload?.backendOnline),
      receiverReachable: Boolean(error?.payload?.receiverReachable),
      loginOk: Boolean(error?.payload?.loginOk),
      isLocked: Boolean(error?.payload?.isLocked),
      gpsLockState: error?.payload?.gpsLockState || "unknown",
      currentSource: error?.payload?.currentSource || fallback.currentSource || "local",
      currentSourceLabel: error?.payload?.currentSourceLabel || fallback.currentSourceLabel || "Local fallback",
      statusText: error?.payload?.statusText || fallback.statusText || `Backend unavailable: ${error.message}`,
      lastError: error?.payload?.lastError || error.message,
      ...fallback,
    });
  }

  async performSync() {
    let nextState = null;

    try {
      const gpsResult = await this.fetchJson("/time");
      if (gpsResult.success && gpsResult.timestamp) {
        nextState = this.createState({
          backendOnline: true,
          receiverReachable: Boolean(gpsResult.receiverReachable ?? true),
          loginOk: Boolean(gpsResult.loginOk ?? true),
          isLocked: Boolean(gpsResult.isLocked),
          gpsLockState: gpsResult.gpsLockState || (gpsResult.isLocked ? "locked" : "unknown"),
          statusText: gpsResult.statusText || (gpsResult.isLocked ? "GPS receiver locked" : "GPS receiver reachable but not locked"),
          currentSource: gpsResult.currentSource || (gpsResult.isLocked ? "gps-locked" : "gps-unlocked"),
          currentSourceLabel: gpsResult.currentSourceLabel || humanizeSource(gpsResult.currentSource || "local"),
          lastError: gpsResult.lastError || null,
          date: gpsResult.date,
          time: gpsResult.time,
          timestamp: gpsResult.timestamp,
          raw: gpsResult.raw || null,
          sourceLabel: gpsResult.currentSourceLabel || (gpsResult.isLocked ? "GPS receiver locked" : "GPS receiver reachable, unlock state"),
        });
      }
    } catch (error) {
      nextState = this.buildErrorState(error, {
        currentSource: "local",
        statusText: `Primary receiver time unavailable: ${error.message}`,
      });
    }

    if (!nextState || nextState.currentSource === "local") {
      try {
        const internetResult = await this.fetchJson("/time/internet");
        if (internetResult.success && internetResult.timestamp) {
          nextState = this.createState({
            backendOnline: true,
            receiverReachable: Boolean(nextState?.receiverReachable || internetResult.receiverReachable),
            loginOk: Boolean(nextState?.loginOk || internetResult.loginOk),
            isLocked: false,
            gpsLockState: nextState?.gpsLockState || "unknown",
            statusText: internetResult.statusText || "Using Internet time fallback via backend",
            currentSource: internetResult.currentSource || "internet-fallback",
            currentSourceLabel: internetResult.currentSourceLabel || "Internet fallback",
            lastError: nextState?.lastError || internetResult.lastError || null,
            date: internetResult.date,
            time: internetResult.time,
            timestamp: internetResult.timestamp,
            raw: null,
            sourceLabel: internetResult.currentSourceLabel || "Internet fallback",
          });
        }
      } catch (error) {
        if (nextState) {
          nextState.backendOnline = nextState.backendOnline || Boolean(error?.payload?.backendOnline);
          nextState.receiverReachable = nextState.receiverReachable || Boolean(error?.payload?.receiverReachable);
          nextState.loginOk = nextState.loginOk || Boolean(error?.payload?.loginOk);
          nextState.lastError = nextState.lastError || error?.payload?.lastError || error.message;
        }
      }
    }

    if (!nextState || nextState.currentSource === "local") {
      const localResult = this.getLocalTime();
      nextState = this.createState({
        ...nextState,
        backendOnline: Boolean(nextState?.backendOnline),
        receiverReachable: Boolean(nextState?.receiverReachable),
        loginOk: Boolean(nextState?.loginOk),
        isLocked: false,
        gpsLockState: nextState?.gpsLockState || "unknown",
        statusText: nextState?.backendOnline
          ? "Using local computer time because backend fallbacks are unavailable"
          : "Using local computer time because backend is unavailable",
        currentSource: "local",
        currentSourceLabel: "Local computer time",
        lastError: nextState?.lastError || "No remote time source available",
        ...localResult,
        sourceLabel: "Local computer time",
      });
    }

    this.applyState(nextState);
    this.mergeReceiverStatus(nextState, {
      checkedAt: this.receiverStatus.checkedAt,
      dataState: this.receiverStatus.dataState,
      fetchedFromCache: this.receiverStatus.fetchedFromCache,
      stale: this.receiverStatus.stale,
      statusAgeMs: this.receiverStatus.statusAgeMs,
      cacheAgeMs: this.receiverStatus.cacheAgeMs,
    });
    this.dispatchUpdate();
    this.maybeShowInitialNotification();
    return this.currentState;
  }

  async pollStatus() {
    if (!APP_CONFIG.statusPollingEnabled) {
      return this.receiverStatus;
    }

    if (this.statusPollInFlight) {
      return this.statusPollInFlight;
    }

    this.statusPollInFlight = this.performStatusPoll().finally(() => {
      this.statusPollInFlight = null;
    });

    return this.statusPollInFlight;
  }

  async performStatusPoll() {
    this.lastStatusPollAttemptAt = new Date().toISOString();

    try {
      const statusResult = await this.fetchJson("/status");
      if (statusResult.success === false) {
        this.mergeReceiverStatus(statusResult, {
          lastSuccessfulPollAt: this.receiverStatus.lastSuccessfulPollAt || this.lastSuccessfulStatusPollAt,
          lastPollAttemptAt: this.lastStatusPollAttemptAt,
          stale: true,
        });
      } else {
        this.lastSuccessfulStatusPollAt = new Date().toISOString();
        this.mergeReceiverStatus(statusResult, {
          lastSuccessfulPollAt: this.lastSuccessfulStatusPollAt,
          lastPollAttemptAt: this.lastStatusPollAttemptAt,
          stale: false,
        });
      }
    } catch (error) {
      if (error?.payload) {
        const lastSuccessfulPollAt = this.receiverStatus.lastSuccessfulPollAt || this.lastSuccessfulStatusPollAt;
        this.mergeReceiverStatus(error.payload, {
          backendOnline: true,
          lastSuccessfulPollAt,
          lastPollAttemptAt: this.lastStatusPollAttemptAt,
          stale: true,
        });
      } else {
        this.mergeReceiverStatus({
          backendOnline: false,
          receiverReachable: false,
          loginOk: false,
          isLocked: false,
          gpsLockState: "unknown",
          statusText: `Status polling unavailable: ${error.message}`,
          currentSource: this.receiverStatus.currentSource || "local",
          currentSourceLabel: this.receiverStatus.currentSourceLabel || "Status unavailable",
          receiverCommunicationState: "backend-offline",
          lastError: error.message,
          dataState: "unavailable",
        }, {
          lastSuccessfulPollAt: this.receiverStatus.lastSuccessfulPollAt || this.lastSuccessfulStatusPollAt,
          lastPollAttemptAt: this.lastStatusPollAttemptAt,
          stale: true,
        });
      }
    }

    this.dispatchUpdate();
    return this.receiverStatus;
  }

  mergeReceiverStatus(statusUpdate, overrides = {}) {
    const nextStatus = this.createReceiverStatus({
      ...this.receiverStatus,
      ...statusUpdate,
      ...overrides,
    });

    const checkedAtMs = nextStatus.checkedAt ? new Date(nextStatus.checkedAt).getTime() : 0;
    const statusAgeMs = checkedAtMs > 0 ? Math.max(0, Date.now() - checkedAtMs) : null;
    const stale = nextStatus.stale || (statusAgeMs !== null && statusAgeMs > APP_CONFIG.statusFreshnessWindowMs);
    nextStatus.statusAgeMs = statusAgeMs;
    nextStatus.dataState = normalizeDataState(nextStatus.dataState, stale);
    nextStatus.stale = stale;
    nextStatus.lastSuccessfulPollAt = nextStatus.lastSuccessfulPollAt || this.lastSuccessfulStatusPollAt;
    nextStatus.lastPollAttemptAt = nextStatus.lastPollAttemptAt || this.lastStatusPollAttemptAt;
    this.receiverStatus = nextStatus;
  }

  async fetchJson(path, options = {}) {
    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      ...options,
      headers: this.getRequestHeaders(options.headers || {}),
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }

    if (!response.ok) {
      const errorMessage = payload?.error || payload?.statusText || `Request failed with ${response.status}`;
      const failure = new Error(errorMessage);
      failure.status = response.status;
      failure.payload = payload;
      throw failure;
    }

    return payload;
  }

  getLocalTime() {
    const now = new Date();
    const parts = OMAN_DATE_TIME_FORMATTER.formatToParts(now);
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));

    return {
      success: true,
      timestamp: now.getTime(),
      date: `${map.month}/${map.day}/${map.year}`,
      time: `${map.hour}:${map.minute}:${map.second}`,
    };
  }

  applyState(state) {
    const localNow = Date.now();
    this.currentState = state;
    this.timeOffset = state.timestamp - localNow;
    this.lastSyncTime = new Date();
    this.lastSyncTimestamp = Date.now();
  }

  maybeShowInitialNotification() {
    if (this.hasShownInitialSync) {
      return;
    }

    const { currentSource, date, time, statusText } = this.currentState;
    const type = currentSource === "gps-locked"
      ? "success"
      : currentSource === "gps-unlocked" || currentSource === "holdover"
        ? "warning"
        : currentSource === "internet-fallback"
          ? "info"
          : "warning";

    this.notifications.show(
      [
        `Source: ${this.getSourceDisplayName(currentSource)}`,
        date ? `Date: ${date}` : null,
        time ? `Time: ${time}` : null,
        `Status: ${statusText}`,
      ],
      type,
      6000,
    );

    this.hasShownInitialSync = true;
  }

  dispatchUpdate() {
    const detail = {
      ...this.currentState,
      receiverStatus: this.getReceiverStatus(),
      offset: this.timeOffset,
      lastSyncTimestamp: this.lastSyncTimestamp,
    };

    const event = new CustomEvent("gpstimeupdate", { detail });
    this.eventTarget.dispatchEvent(event);
    window.dispatchEvent(event);
  }

  getSourceDisplayName(source = this.currentState.currentSource) {
    return {
      "gps-locked": "GPS RECEIVER",
      "gps-unlocked": "GPS RECEIVER",
      holdover: "HOLDOVER",
      "internet-fallback": "INTERNET/HTTP DATE",
      local: "LOCAL TIME",
    }[source] || source.toUpperCase();
  }

  getReceiverSourceDisplayName(source = this.receiverStatus.currentSource) {
    return {
      "gps-locked": "GPS receiver locked",
      "gps-unlocked": "GPS receiver unlocked",
      holdover: "Receiver holdover",
      "internet-fallback": "Internet fallback",
      local: this.receiverStatus.backendOnline ? "Local fallback" : "Backend offline",
    }[source] || source.replace(/-/g, " ");
  }

  getCommunicationStateDisplayName(state = this.receiverStatus.receiverCommunicationState) {
    return {
      authenticated: "Authenticated",
      reachable: "Reachable",
      "login-failed": "Login failed",
      unreachable: "Receiver unreachable",
      "backend-offline": "Backend offline",
      "not-started": "Not started",
    }[state] || state.replace(/-/g, " ");
  }

  getNow() {
    return new Date(Date.now() + this.timeOffset);
  }

  getCurrentState() {
    return this.currentState;
  }

  getReceiverStatus() {
    const status = this.receiverStatus;
    const checkedAtMs = status.checkedAt ? new Date(status.checkedAt).getTime() : 0;
    const statusAgeMs = checkedAtMs > 0 ? Math.max(0, Date.now() - checkedAtMs) : null;
    const stale = status.stale || (statusAgeMs !== null && statusAgeMs > APP_CONFIG.statusFreshnessWindowMs);
    return {
      ...status,
      statusAgeMs,
      stale,
      dataState: normalizeDataState(status.dataState, stale),
    };
  }

  getCurrentSource() {
    return this.currentState.currentSource;
  }

  isGPSLocked() {
    return this.currentState.currentSource === "gps-locked" && this.currentState.isLocked;
  }

  startAutoSync() {
    if (this.syncInterval) {
      return;
    }

    this.syncInterval = window.setInterval(() => {
      this.syncTime();
    }, APP_CONFIG.syncIntervalMs);
  }

  startStatusPolling() {
    if (this.statusPollInterval || !APP_CONFIG.statusPollingEnabled) {
      return;
    }

    this.statusPollInterval = window.setInterval(() => {
      this.pollStatus();
    }, APP_CONFIG.statusPollingIntervalMs);
  }

  stopAutoSync() {
    if (this.syncInterval) {
      window.clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  stopStatusPolling() {
    if (this.statusPollInterval) {
      window.clearInterval(this.statusPollInterval);
      this.statusPollInterval = null;
    }
  }

  addEventListener(type, callback) {
    this.eventTarget.addEventListener(type, callback);
  }

  removeEventListener(type, callback) {
    this.eventTarget.removeEventListener(type, callback);
  }
}

class SyncManager {
  constructor(gpsTimeSync) {
    this.gpsTimeSync = gpsTimeSync;
    this.hasSuccessfulSync = false;
  }

  getNowFromSyncedClock() {
    return this.gpsTimeSync.getNow();
  }

  getDrift(now = Date.now()) {
    return now - this.getNowFromSyncedClock().getTime();
  }

  getRelativeLastSync() {
    const { lastSyncTimestamp } = this.gpsTimeSync;
    if (!lastSyncTimestamp) {
      return "never";
    }

    const diff = Math.max(0, Date.now() - lastSyncTimestamp);
    const minutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    return `${minutes}m ${seconds}s ago`;
  }

  formatStatus() {
    const state = this.gpsTimeSync.getCurrentState();
    const source = this.gpsTimeSync.getSourceDisplayName(state.currentSource);
    return `Status: ${state.statusText} | Source: ${source} | Last sync: ${this.getRelativeLastSync()}`;
  }

  markSuccessfulSync() {
    this.hasSuccessfulSync = true;
  }

  cleanup() {}
}

class GPSDisplayManager {
  constructor(elements, gpsTimeSync, syncManager) {
    this.elements = elements;
    this.gpsTimeSync = gpsTimeSync;
    this.syncManager = syncManager;
    this.sourceClasses = {
      "gps-locked": "source-gps",
      "gps-unlocked": "source-gps-warn",
      holdover: "source-gps-warn",
      "internet-fallback": "source-internet",
      local: "source-local",
    };
    this.lastDashboardSignature = "";
    this.timeline = [];
  }

  init() {
    this.gpsTimeSync.addEventListener("gpstimeupdate", (event) => {
      this.updateDisplay(event.detail);
    });

    this.updateDisplay({
      ...this.gpsTimeSync.getCurrentState(),
      receiverStatus: this.gpsTimeSync.getReceiverStatus(),
      offset: this.gpsTimeSync.timeOffset,
      lastSyncTimestamp: this.gpsTimeSync.lastSyncTimestamp,
    });
  }

  updateDisplay(data) {
    const sourceClass = this.sourceClasses[data.currentSource] || "source-local";
    this.elements.sourceIndicator.className = `source-badge ${sourceClass}`;
    this.elements.sourceIndicator.textContent = this.gpsTimeSync.getSourceDisplayName(data.currentSource);

    const receiverStatus = data.receiverStatus || this.gpsTimeSync.getReceiverStatus();
    this.elements.lockStatus.textContent = this.getLockText(data, receiverStatus);
    this.elements.lockPulse.classList.toggle("locked", receiverStatus.backendOnline && receiverStatus.gpsLockState === "locked");
    this.elements.lockPulse.classList.toggle("warning", receiverStatus.backendOnline && ["unlocked", "holdover"].includes(receiverStatus.gpsLockState));

    if (data.lastSyncTimestamp) {
      this.elements.lastSyncTime.textContent = `Last sync: ${formatClockTime(data.lastSyncTimestamp)}`;
    }

    this.elements.offsetDisplay.textContent = `Offset: ${Math.round(data.offset)} ms`;
    this.elements.statusFreshness.textContent = this.getStatusFreshnessText(receiverStatus);

    this.elements.primarySourceDescription.textContent = this.getPrimarySourceDescription(data, receiverStatus);
    this.elements.primarySourceNote.textContent = this.getPrimarySourceNote(data, receiverStatus);
    this.elements.syncStatus.textContent = this.syncManager.formatStatus();
    this.elements.syncStatus.classList.toggle("warn", data.currentSource !== "gps-locked");
    this.elements.statusConsistencyHint.textContent = this.getConsistencyHint(data, receiverStatus);

    this.updateDashboard(data, receiverStatus);
  }

  refreshLiveStatus() {
    const data = this.gpsTimeSync.getCurrentState();
    const receiverStatus = this.gpsTimeSync.getReceiverStatus();
    this.elements.syncStatus.textContent = this.syncManager.formatStatus();
    this.elements.syncStatus.classList.toggle("warn", data.currentSource !== "gps-locked");
    this.elements.statusFreshness.textContent = this.getStatusFreshnessText(receiverStatus);
    this.elements.statusConsistencyHint.textContent = this.getConsistencyHint(data, receiverStatus);
    this.updateDashboard(data, receiverStatus);
  }

  updateDashboard(data, receiverStatus) {
    const snapshot = this.buildDashboardSnapshot(data, receiverStatus);
    const signature = JSON.stringify(snapshot);
    if (signature === this.lastDashboardSignature) {
      return;
    }

    this.lastDashboardSignature = signature;
    this.recordTimeline(snapshot);

    this.elements.dashboardSeverityBadge.textContent = snapshot.severityLabel;
    this.elements.dashboardSeverityBadge.className = `dashboard-severity ${snapshot.severityClass}`;
    this.elements.dashboardDataStateBadge.textContent = snapshot.dataStateLabel;
    this.elements.dashboardDataStateBadge.className = `dashboard-data-state data-${snapshot.dataState}`;
    this.elements.dashboardSummaryText.textContent = snapshot.summaryText;

    this.setValue(this.elements.dashboardBackendSummary, snapshot.backendSummary, snapshot.backendTone);
    this.setValue(this.elements.dashboardReceiverSummary, snapshot.receiverSummary, snapshot.receiverTone);
    this.setValue(this.elements.dashboardLockSummary, snapshot.lockSummary, snapshot.lockTone);
    this.setValue(this.elements.dashboardSourceSummary, snapshot.activeSource, snapshot.sourceTone);

    this.setValue(this.elements.dashboardBackendStatus, snapshot.backendStatus, snapshot.backendTone);
    this.setValue(this.elements.dashboardReceiverStatus, snapshot.receiverStatus, snapshot.receiverTone);
    this.setValue(this.elements.dashboardLoginStatus, snapshot.loginStatus, snapshot.loginTone);
    this.setValue(this.elements.dashboardHealthStatus, snapshot.healthStatus, snapshot.severityTone);
    this.setValue(this.elements.dashboardCommunicationState, snapshot.communicationState, snapshot.communicationTone);
    this.setValue(this.elements.dashboardStatusDataState, snapshot.statusDataState, snapshot.dataTone);
    this.setValue(this.elements.dashboardLastStatusPoll, snapshot.lastStatusPoll, snapshot.dataTone);
    this.setValue(this.elements.dashboardStatusFreshness, snapshot.statusFreshness, snapshot.dataTone);
    this.setValue(this.elements.dashboardActiveSource, snapshot.activeSource, snapshot.sourceTone);
    this.setValue(this.elements.dashboardReceiverSource, snapshot.receiverSource, snapshot.receiverSourceTone);
    this.setValue(this.elements.dashboardLastTimeSync, snapshot.lastTimeSync, snapshot.sourceTone);
    this.setValue(this.elements.dashboardAlignmentStatus, snapshot.alignmentStatus, snapshot.alignmentTone);

    this.elements.dashboardStatusText.textContent = snapshot.statusText;
    this.elements.dashboardErrorText.textContent = snapshot.errorText;

    this.renderTimeline();
  }

  buildDashboardSnapshot(data, receiverStatus) {
    const severity = this.getSeverity(data, receiverStatus);
    const dataState = normalizeDataState(receiverStatus.dataState, receiverStatus.stale);
    const activeSource = this.gpsTimeSync.getSourceDisplayName(data.currentSource);
    const receiverSource = receiverStatus.currentSourceLabel || this.gpsTimeSync.getReceiverSourceDisplayName(receiverStatus.currentSource);
    const alignment = this.getConsistencyHint(data, receiverStatus);

    return {
      backendSummary: receiverStatus.backendOnline ? "Online" : "Offline",
      receiverSummary: receiverStatus.receiverReachable ? "Reachable" : "Unreachable",
      lockSummary: humanizeLockState(receiverStatus.gpsLockState),
      activeSource,
      backendStatus: receiverStatus.backendOnline ? "Online and responding" : "Offline or unreachable",
      receiverStatus: receiverStatus.receiverReachable ? "Receiver reachable" : "Receiver unreachable",
      loginStatus: receiverStatus.receiverReachable ? (receiverStatus.loginOk ? "Authenticated" : "Login failed") : "Unavailable",
      healthStatus: severity.label,
      communicationState: this.gpsTimeSync.getCommunicationStateDisplayName(receiverStatus.receiverCommunicationState),
      statusDataState: dataStateLabel(dataState),
      lastStatusPoll: receiverStatus.lastSuccessfulPollAt
        ? `${formatClockTime(receiverStatus.lastSuccessfulPollAt)} (${formatRelativeAge(receiverStatus.lastSuccessfulPollAt)})`
        : "Never",
      statusFreshness: this.getStatusFreshnessText(receiverStatus),
      receiverSource,
      lastTimeSync: data.lastSyncTimestamp
        ? `${formatClockTime(data.lastSyncTimestamp)} (${formatRelativeAge(data.lastSyncTimestamp)})`
        : "Never",
      alignmentStatus: alignment,
      statusText: receiverStatus.statusText || data.statusText || "Status unavailable.",
      errorText: receiverStatus.lastError ? `Last error: ${receiverStatus.lastError}` : "No errors reported.",
      severityLabel: severity.badge,
      severityClass: severity.className,
      severityTone: severity.tone,
      summaryText: this.buildSummaryText(data, receiverStatus, severity, dataState),
      dataState,
      dataStateLabel: dataStateLabel(dataState),
      backendTone: receiverStatus.backendOnline ? "normal" : "critical",
      receiverTone: receiverStatus.receiverReachable ? "normal" : "critical",
      loginTone: receiverStatus.receiverReachable ? (receiverStatus.loginOk ? "normal" : "critical") : "neutral",
      lockTone: receiverStatus.gpsLockState === "locked" ? "normal" : ["holdover", "unlocked"].includes(receiverStatus.gpsLockState) ? "warning" : "neutral",
      sourceTone: data.currentSource === "gps-locked" ? "normal" : ["gps-unlocked", "holdover", "internet-fallback"].includes(data.currentSource) ? "warning" : "critical",
      receiverSourceTone: receiverStatus.currentSource === "gps-locked" ? "normal" : ["gps-unlocked", "holdover"].includes(receiverStatus.currentSource) ? "warning" : receiverStatus.currentSource === "local" ? "critical" : "neutral",
      communicationTone: receiverStatus.receiverCommunicationState === "authenticated"
        ? "normal"
        : ["reachable", "not-started"].includes(receiverStatus.receiverCommunicationState)
          ? "neutral"
          : receiverStatus.receiverCommunicationState === "backend-offline"
            ? "critical"
            : ["login-failed", "unreachable"].includes(receiverStatus.receiverCommunicationState)
              ? "critical"
              : "warning",
      dataTone: dataState === "live" ? "normal" : dataState === "cached" ? "neutral" : dataState === "stale" ? "warning" : dataState === "unavailable" ? "critical" : "neutral",
      alignmentTone: /aligned|agree/i.test(alignment) ? "normal" : /stale|differs|waiting/i.test(alignment) ? "warning" : "neutral",
      timelineLabel: `${severity.badge}: ${activeSource} / ${humanizeLockState(receiverStatus.gpsLockState)} / ${dataStateLabel(dataState)}`,
    };
  }

  setValue(element, value, tone = "neutral") {
    if (!element) {
      return;
    }

    element.textContent = value;
    element.className = element.className
      .split(" ")
      .filter((className) => !/^value-/.test(className))
      .concat(valueToneClass(tone))
      .join(" ")
      .trim();
  }

  getSeverity(data, receiverStatus) {
    if (!receiverStatus.backendOnline) {
      return { label: "Critical — backend offline", badge: "Critical", className: "status-critical", tone: "critical" };
    }
    if (!receiverStatus.receiverReachable) {
      return { label: "Critical — receiver unreachable", badge: "Critical", className: "status-critical", tone: "critical" };
    }
    if (receiverStatus.receiverReachable && !receiverStatus.loginOk) {
      return { label: "Critical — receiver login failed", badge: "Critical", className: "status-critical", tone: "critical" };
    }
    if (receiverStatus.stale || receiverStatus.dataState === "stale") {
      return { label: "Warning — stale status", badge: "Warning", className: "status-warning", tone: "warning" };
    }
    if (["unlocked", "holdover"].includes(receiverStatus.gpsLockState) || ["gps-unlocked", "holdover", "internet-fallback"].includes(data.currentSource)) {
      return { label: "Warning — degraded timing source", badge: "Warning", className: "status-warning", tone: "warning" };
    }
    return { label: "Normal — GPS locked and healthy", badge: "Normal", className: "status-normal", tone: "normal" };
  }

  buildSummaryText(data, receiverStatus, severity, dataState) {
    const parts = [severity.label];
    parts.push(`Active source: ${this.gpsTimeSync.getSourceDisplayName(data.currentSource)}.`);
    parts.push(`Receiver status: ${receiverStatus.statusText}.`);
    if (dataState === "cached") {
      parts.push("Dashboard is currently showing a cached receiver snapshot.");
    } else if (dataState === "stale") {
      parts.push("Status may be stale; compare with the live time source before acting.");
    } else if (dataState === "unavailable") {
      parts.push("No fresh receiver snapshot is available right now.");
    }
    return parts.join(" ");
  }

  recordTimeline(snapshot) {
    const latest = this.timeline[0];
    if (latest && latest.label === snapshot.timelineLabel) {
      return;
    }

    this.timeline.unshift({
      label: snapshot.timelineLabel,
      tone: snapshot.severityTone,
    });
    this.timeline = this.timeline.slice(0, 6);
  }

  renderTimeline() {
    if (!this.elements.dashboardTimeline) {
      return;
    }

    this.elements.dashboardTimeline.replaceChildren(
      ...this.timeline.map((entry) => {
        const chip = document.createElement("span");
        chip.className = `timeline-chip status-${entry.tone === "normal" ? "normal" : entry.tone === "critical" ? "critical" : entry.tone === "warning" ? "warning" : "neutral"}`;
        chip.textContent = entry.label;
        return chip;
      }),
    );
  }

  getStatusFreshnessText(receiverStatus) {
    if (!APP_CONFIG.statusPollingEnabled) {
      return "Polling disabled";
    }

    if (!receiverStatus.checkedAt) {
      return receiverStatus.backendOnline ? "Waiting for first poll" : "Backend unavailable";
    }

    const timeText = formatClockTime(receiverStatus.checkedAt);
    const ageText = receiverStatus.statusAgeMs !== null
      ? `${Math.round(receiverStatus.statusAgeMs / 1000)}s old`
      : "Unknown age";
    return receiverStatus.stale ? `${timeText} (${ageText}, stale)` : `${timeText} (${ageText})`;
  }

  getLockText(data, receiverStatus) {
    if (!receiverStatus.backendOnline) {
      return "Backend offline — local fallback active";
    }
    if (receiverStatus.gpsLockState === "locked") {
      return "GPS receiver locked";
    }
    if (receiverStatus.gpsLockState === "holdover") {
      return "Receiver holdover — timing should be monitored";
    }
    if (data.currentSource === "gps-unlocked") {
      return "GPS receiver reachable but unlocked";
    }
    if (data.currentSource === "internet-fallback") {
      return receiverStatus.receiverReachable
        ? "Receiver degraded — Internet fallback active"
        : "Receiver unavailable — Internet fallback active";
    }
    return receiverStatus.receiverReachable
      ? "Receiver reachable — local fallback active"
      : "Receiver unavailable — local fallback active";
  }

  getPrimarySourceDescription(data, receiverStatus) {
    if (data.currentSource === "gps-locked") {
      return "Primary source: Symmetricom XLi receiver is reachable, authenticated, and locked.";
    }
    if (data.currentSource === "holdover") {
      return "Primary source is currently the receiver holdover state; time is still from the receiver but GPS lock is no longer confirmed.";
    }
    if (data.currentSource === "gps-unlocked") {
      return "Primary source preferred, but the Symmetricom XLi receiver is reachable without current GPS lock.";
    }
    if (data.currentSource === "internet-fallback") {
      return "Primary GPS receiver is not providing locked time, so Internet time fallback is active via the backend.";
    }
    if (!receiverStatus.backendOnline) {
      return "The backend is currently unavailable, so the display is using local computer time until remote sync resumes.";
    }
    return "Remote time sources are unavailable, so the display is currently using local computer time.";
  }

  getPrimarySourceNote(data, receiverStatus) {
    const parts = [];
    parts.push(`Runtime source: ${this.gpsTimeSync.getSourceDisplayName(data.currentSource)}.`);
    parts.push(`Receiver source: ${receiverStatus.currentSourceLabel || this.gpsTimeSync.getReceiverSourceDisplayName(receiverStatus.currentSource)}.`);
    parts.push(`System status: ${receiverStatus.statusText}.`);
    if (receiverStatus.receiverReachable) {
      parts.push(receiverStatus.loginOk ? "Receiver login succeeded." : "Receiver reachable but login failed.");
    } else if (receiverStatus.backendOnline) {
      parts.push("Receiver is not currently reachable.");
    } else {
      parts.push("Backend status polling is unavailable.");
    }
    if (receiverStatus.lastError) {
      parts.push(`Last error: ${receiverStatus.lastError}`);
    }
    return parts.join(" ");
  }

  getConsistencyHint(data, receiverStatus) {
    const runtimeSource = humanizeSource(data.currentSource);
    const statusSource = receiverStatus.currentSourceLabel || humanizeSource(receiverStatus.currentSource);

    if (!receiverStatus.checkedAt) {
      return "Waiting for status data to compare with the active time source.";
    }

    if (receiverStatus.stale) {
      return `Status may be stale — runtime source is ${runtimeSource}, latest status snapshot says ${statusSource}.`;
    }

    if (data.currentSource === receiverStatus.currentSource || statusSource.toLowerCase().includes(runtimeSource.toLowerCase())) {
      return `Runtime time source and status snapshot agree on ${runtimeSource}.`;
    }

    return `Runtime source is ${runtimeSource} while the latest status snapshot reports ${statusSource}.`;
  }
}

class DisplayManager {
  constructor(elements, syncManager, gpsTimeSync) {
    this.elements = elements;
    this.syncManager = syncManager;
    this.gpsTimeSync = gpsTimeSync;
    this.mode = "digital";
    this.showMilliseconds = this.resolveInitialPrecisionMode();
    this.darkMode = this.resolveInitialDarkMode();
    this.paused = false;
    this.lastDriftSecond = -1;
    this.lastRenderedDigital = {};
    this.lastRenderedAnalog = {};
  }

  resolveInitialDarkMode() {
    const stored = localStorage.getItem("darkMode");
    if (stored !== null) {
      return stored === "1";
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  resolveInitialPrecisionMode() {
    const stored = localStorage.getItem("precisionMode");
    if (stored !== null) {
      return stored === "1";
    }
    return true;
  }

  initVisualPreferences() {
    this.applyDarkMode(this.darkMode);
    this.applyPrecisionMode(this.showMilliseconds);
  }

  applyDarkMode(enabled) {
    this.darkMode = enabled;
    document.body.classList.toggle("dark-mode", enabled);
    this.elements.darkModeBtn.textContent = enabled ? "Light mode" : "Dark mode";
    this.elements.darkModeBtn.setAttribute("aria-pressed", String(enabled));
    localStorage.setItem("darkMode", enabled ? "1" : "0");
  }

  toggleDarkMode() {
    this.applyDarkMode(!this.darkMode);
  }

  togglePrecisionMode() {
    this.applyPrecisionMode(!this.showMilliseconds);
  }

  togglePause() {
    this.paused = !this.paused;
  }

  updateUrl(mode) {
    const url = new URL(window.location.href);
    url.searchParams.set("mode", mode);
    window.history.replaceState({}, "", url);
  }

  applyPrecisionMode(enabled) {
    this.showMilliseconds = enabled;
    this.elements.millisecondsTile.classList.toggle("hidden", !enabled);
    this.elements.precisionToggleBtn.textContent = `Precision: ${enabled ? "ON" : "OFF"}`;
    this.elements.precisionToggleBtn.setAttribute("aria-pressed", String(enabled));
    localStorage.setItem("precisionMode", enabled ? "1" : "0");
  }

  setPrecisionVisibility(isVisible) {
    this.elements.precisionToggleBtn.classList.toggle("hidden", !isVisible);
  }

  setDigitalControlsVisibility(isVisible) {
    this.elements.digitalOnlyControls.classList.toggle("hidden", !isVisible);
  }

  showSection(section) {
    section.classList.remove("hidden", "is-fading");
    section.classList.add("is-visible");
  }

  hideSection(section) {
    section.classList.add("is-fading");
    section.classList.remove("is-visible");
    window.setTimeout(() => {
      section.classList.add("hidden");
      section.classList.remove("is-fading");
    }, APP_CONFIG.modeTransitionMs);
  }

  setMode(mode) {
    this.mode = mode;
    document.body.classList.remove("analog-only", "old-style");
    this.updateUrl(mode);

    const isDigital = mode === "digital";
    if (isDigital) {
      this.showSection(this.elements.digitalClock);
      this.hideSection(this.elements.analogClock);
      this.setPrecisionVisibility(true);
      this.setDigitalControlsVisibility(true);
    } else {
      document.body.classList.add("old-style");
      this.showSection(this.elements.analogClock);
      this.hideSection(this.elements.digitalClock);
      this.setPrecisionVisibility(true);
      this.setDigitalControlsVisibility(false);
    }

    this.elements.digitalModeBtn.classList.toggle("active", isDigital);
    this.elements.analogModeBtn.classList.toggle("active", mode === "analog");
    this.elements.analogOnlyBtn.classList.toggle("active", false);
    this.elements.digitalModeBtn.setAttribute("aria-pressed", String(isDigital));
    this.elements.analogModeBtn.setAttribute("aria-pressed", String(mode === "analog"));
    this.elements.analogOnlyBtn.setAttribute("aria-pressed", "false");
  }

  setAnalogOnlyMode() {
    this.mode = "analog-only";
    this.updateUrl("analog-only");
    document.body.classList.remove("old-style");
    document.body.classList.add("analog-only");
    this.elements.digitalClock.classList.add("hidden");
    this.elements.analogClock.classList.remove("hidden");
    this.elements.digitalModeBtn.classList.remove("active");
    this.elements.analogModeBtn.classList.remove("active");
    this.elements.analogOnlyBtn.classList.add("active");
    this.elements.digitalModeBtn.setAttribute("aria-pressed", "false");
    this.elements.analogModeBtn.setAttribute("aria-pressed", "false");
    this.elements.analogOnlyBtn.setAttribute("aria-pressed", "true");
    this.setPrecisionVisibility(true);
    this.setDigitalControlsVisibility(false);
  }

  updateDigital(oman, now) {
    const digitalState = {
      hours: String(oman.hour).padStart(2, "0"),
      minutes: String(oman.minute).padStart(2, "0"),
      seconds: String(oman.second).padStart(2, "0"),
      milliseconds: String(now.getUTCMilliseconds()).padStart(3, "0"),
      dateLine: OMAN_DATE_LINE_FORMATTER.format(now),
    };

    Object.entries(digitalState).forEach(([key, value]) => {
      if (value === this.lastRenderedDigital[key]) {
        return;
      }
      if (this.elements[key]) {
        this.elements[key].textContent = value;
      }
    });

    this.lastRenderedDigital = digitalState;
  }

  updateAnalog(oman, now) {
    const ms = now.getUTCMilliseconds();
    const secondProgress = oman.second + ms / 1000;
    const minuteProgress = oman.minute + secondProgress / 60;
    const hourProgress = (oman.hour % 12) + minuteProgress / 60;

    this.elements.secondHandGroup?.setAttribute("transform", `rotate(${secondProgress * 6} 400 400)`);
    this.elements.minuteHand?.setAttribute("transform", `rotate(${minuteProgress * 6} 400 400)`);
    this.elements.hourHand?.setAttribute("transform", `rotate(${hourProgress * 30} 400 400)`);

    const timeText = this.showMilliseconds
      ? `${String(oman.hour).padStart(2, "0")}:${String(oman.minute).padStart(2, "0")}:${String(oman.second).padStart(2, "0")}.${String(ms).padStart(3, "0")}`
      : `${String(oman.hour).padStart(2, "0")}:${String(oman.minute).padStart(2, "0")}:${String(oman.second).padStart(2, "0")}`;

    if (timeText !== this.lastRenderedAnalog.timeText && this.elements.analogTimeText) {
      this.elements.analogTimeText.textContent = timeText;
    }
    if (oman.date !== this.lastRenderedAnalog.dateText && this.elements.analogDateText) {
      this.elements.analogDateText.textContent = oman.date;
    }

    this.lastRenderedAnalog = { timeText, dateText: oman.date };
  }

  updateDrift(now) {
    if (!this.syncManager.hasSuccessfulSync) {
      this.elements.driftMonitor.classList.add("hidden");
      return;
    }

    const currentSecond = Math.floor(now.getTime() / 1000);
    if (currentSecond === this.lastDriftSecond) {
      return;
    }
    this.lastDriftSecond = currentSecond;

    const driftMs = this.syncManager.getDrift(now.getTime());
    const driftSec = driftMs / 1000;
    const abs = Math.abs(driftMs);
    const cls = abs < 100 ? "good" : abs < 1000 ? "warn" : "bad";

    this.elements.driftMonitor.classList.remove("hidden", "good", "warn", "bad");
    this.elements.driftMonitor.classList.add(cls);
    this.elements.driftMonitor.textContent = `Δ ${driftSec >= 0 ? "+" : ""}${driftSec.toFixed(3)}s`;
  }
}

class InputHandler {
  constructor(elements, displayManager, gpsTimeSync) {
    this.elements = elements;
    this.displayManager = displayManager;
    this.gpsTimeSync = gpsTimeSync;
    this.listeners = [];
  }

  add(target, event, handler) {
    if (!target) {
      return;
    }
    target.addEventListener(event, handler);
    this.listeners.push(() => target.removeEventListener(event, handler));
  }

  init() {
    this.add(this.elements.digitalModeBtn, "click", () => this.displayManager.setMode("digital"));
    this.add(this.elements.analogModeBtn, "click", () => this.displayManager.setMode("analog"));
    this.add(this.elements.analogOnlyBtn, "click", () => this.displayManager.setAnalogOnlyMode());
    this.add(this.elements.backToDigitalBtn, "click", () => this.displayManager.setMode("digital"));
    this.add(this.elements.darkModeBtn, "click", () => this.displayManager.toggleDarkMode());
    this.add(this.elements.precisionToggleBtn, "click", () => this.displayManager.togglePrecisionMode());
    this.add(this.elements.setTimeComputerBtn, "click", () => this.handleSetGpsTime(false));
    this.add(this.elements.setTimeInternetBtn, "click", () => this.handleSetGpsTime(true));
    this.add(document, "keydown", (event) => this.handleKeys(event));
  }

  async handleSetGpsTime(useInternet) {
    const sourceLabel = useInternet ? "Internet" : "this computer";
    const confirmationText = useInternet
      ? "Set GPS receiver time from Internet?\n\nThis uses the backend Internet fallback source."
      : "Set GPS receiver time from this computer?\n\nThis uses the current Oman time derived from this computer clock.";

    if (!window.confirm(confirmationText)) {
      return;
    }

    const button = useInternet ? this.elements.setTimeInternetBtn : this.elements.setTimeComputerBtn;
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "Updating…";

    try {
      const result = await this.gpsTimeSync.fetchJson("/time/set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ useInternet }),
      });

      if (!result.success) {
        throw new Error(result.error || `Failed to set GPS time from ${sourceLabel}`);
      }

      window.showNotification(
        [
          "GPS time updated",
          `Source: ${result.source}`,
          `Date: ${result.date}`,
          `Time: ${result.time}`,
          "Status: Refreshing display…",
        ],
        "success",
        4200,
      );

      await this.gpsTimeSync.syncTime();
      await this.gpsTimeSync.pollStatus();
    } catch (error) {
      window.showNotification(error.message, "error", 5000);
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  handleKeys(event) {
    if (event.code === "Space") {
      event.preventDefault();
      this.displayManager.togglePause();
      return;
    }

    const key = event.key.toLowerCase();
    if (key === "1") this.displayManager.setMode("digital");
    if (key === "2") this.displayManager.setMode("analog");
    if (key === "3") this.displayManager.setAnalogOnlyMode();
    if (key === "d") this.displayManager.toggleDarkMode();
    if (key === "f") {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.();
      } else {
        document.exitFullscreen?.();
      }
    }
    if (event.key === "Escape" && document.body.classList.contains("analog-only")) {
      this.displayManager.setMode("digital");
    }
  }

  cleanup() {
    this.listeners.forEach((dispose) => dispose());
    this.listeners = [];
  }
}

class PrecisionClock {
  constructor() {
    this.elements = {
      hours: document.getElementById("hours"),
      minutes: document.getElementById("minutes"),
      seconds: document.getElementById("seconds"),
      milliseconds: document.getElementById("milliseconds"),
      millisecondsTile: document.getElementById("millisecondsTile"),
      dateLine: document.getElementById("dateLine"),
      syncStatus: document.getElementById("syncStatus"),
      primarySourceDescription: document.getElementById("primarySourceDescription"),
      primarySourceNote: document.getElementById("primarySourceNote"),
      statusConsistencyHint: document.getElementById("statusConsistencyHint"),
      ptbClockSvg: document.getElementById("ptbClockSvg"),
      hourHand: null,
      minuteHand: null,
      secondHand: null,
      secondHandGroup: null,
      analogDateText: null,
      analogTimeText: null,
      driftMonitor: document.getElementById("driftMonitor"),
      digitalClock: document.getElementById("digitalClock"),
      analogClock: document.getElementById("analogClock"),
      digitalModeBtn: document.getElementById("digitalModeBtn"),
      analogModeBtn: document.getElementById("analogModeBtn"),
      analogOnlyBtn: document.getElementById("analogOnlyBtn"),
      backToDigitalBtn: document.getElementById("backToDigitalBtn"),
      darkModeBtn: document.getElementById("darkModeBtn"),
      precisionToggleBtn: document.getElementById("precisionToggleBtn"),
      sourceIndicator: document.getElementById("sourceIndicator"),
      lockStatus: document.getElementById("lockStatus"),
      lockPulse: document.getElementById("lockPulse"),
      lastSyncTime: document.getElementById("lastSyncTime"),
      offsetDisplay: document.getElementById("offsetDisplay"),
      statusFreshness: document.getElementById("statusFreshness"),
      digitalOnlyControls: document.getElementById("digitalOnlyControls"),
      setTimeComputerBtn: document.getElementById("setTimeComputerBtn"),
      setTimeInternetBtn: document.getElementById("setTimeInternetBtn"),
      dashboardSummaryText: document.getElementById("dashboardSummaryText"),
      dashboardSeverityBadge: document.getElementById("dashboardSeverityBadge"),
      dashboardDataStateBadge: document.getElementById("dashboardDataStateBadge"),
      dashboardBackendSummary: document.getElementById("dashboardBackendSummary"),
      dashboardReceiverSummary: document.getElementById("dashboardReceiverSummary"),
      dashboardLockSummary: document.getElementById("dashboardLockSummary"),
      dashboardSourceSummary: document.getElementById("dashboardSourceSummary"),
      dashboardBackendStatus: document.getElementById("dashboardBackendStatus"),
      dashboardReceiverStatus: document.getElementById("dashboardReceiverStatus"),
      dashboardLoginStatus: document.getElementById("dashboardLoginStatus"),
      dashboardHealthStatus: document.getElementById("dashboardHealthStatus"),
      dashboardCommunicationState: document.getElementById("dashboardCommunicationState"),
      dashboardStatusDataState: document.getElementById("dashboardStatusDataState"),
      dashboardLastStatusPoll: document.getElementById("dashboardLastStatusPoll"),
      dashboardStatusFreshness: document.getElementById("dashboardStatusFreshness"),
      dashboardActiveSource: document.getElementById("dashboardActiveSource"),
      dashboardReceiverSource: document.getElementById("dashboardReceiverSource"),
      dashboardLastTimeSync: document.getElementById("dashboardLastTimeSync"),
      dashboardAlignmentStatus: document.getElementById("dashboardAlignmentStatus"),
      dashboardStatusText: document.getElementById("dashboardStatusText"),
      dashboardErrorText: document.getElementById("dashboardErrorText"),
      dashboardTimeline: document.getElementById("dashboardTimeline"),
    };

    this.analogDial = this.elements.ptbClockSvg;
    this.gpsTimeSync = new GPSTimeSync();
    this.syncManager = new SyncManager(this.gpsTimeSync);
    this.gpsDisplay = new GPSDisplayManager(this.elements, this.gpsTimeSync, this.syncManager);
    this.displayManager = new DisplayManager(this.elements, this.syncManager, this.gpsTimeSync);
    this.inputHandler = new InputHandler(this.elements, this.displayManager, this.gpsTimeSync);
    this.rafId = null;
    this.boundVisibility = () => this.handleVisibilityChange();
    this.boundUnload = () => this.cleanup();
  }

  async init() {
    this.applyFavicon();
    this.handleLogoFallback();
    this.buildAnalogDial();
    this.displayManager.initVisualPreferences();
    this.displayManager.setPrecisionVisibility(false);

    await this.gpsTimeSync.init();
    this.gpsDisplay.init();
    this.syncManager.markSuccessfulSync();

    const urlMode = new URLSearchParams(window.location.search).get("mode");
    if (urlMode === "analog-only") {
      this.displayManager.setAnalogOnlyMode();
    } else if (urlMode === "analog") {
      this.displayManager.setMode("analog");
    } else {
      this.displayManager.setMode("digital");
    }

    this.gpsTimeSync.addEventListener("gpstimeupdate", () => {
      this.syncManager.markSuccessfulSync();
      this.gpsDisplay.refreshLiveStatus();
    });

    this.inputHandler.init();
    document.addEventListener("visibilitychange", this.boundVisibility);
    window.addEventListener("beforeunload", this.boundUnload);
    this.startRenderLoop();
  }

  applyFavicon() {
    let favicon = document.querySelector("link[rel='icon']");
    if (!favicon) {
      favicon = document.createElement("link");
      favicon.rel = "icon";
      document.head.append(favicon);
    }
    favicon.href = "images/cal logo.png";
  }

  handleLogoFallback() {
    const logos = Array.from(document.querySelectorAll("[data-logo]"));
    const probe = new Image();
    probe.onerror = () => {
      document.body.classList.add("no-logo");
      const placeholder = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80'%3E%3Crect width='80' height='80' rx='10' fill='%231f7ea1'/%3E%3Ctext x='40' y='46' fill='white' font-size='13' text-anchor='middle' font-family='Arial'%3ERAFO%3C/text%3E%3C/svg%3E";
      logos.forEach((img) => {
        img.src = placeholder;
        img.alt = "Logo placeholder";
      });
    };
    probe.src = "images/cal logo.png";
  }

  buildAnalogDial() {
    const svg = this.analogDial;
    const ns = "http://www.w3.org/2000/svg";
    const make = (tag, attrs = {}) => {
      const el = document.createElementNS(ns, tag);
      Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, String(value)));
      return el;
    };

    svg.replaceChildren();

    const defs = make("defs");
    const logoShadow = make("filter", { id: "logoShadow", x: "-40%", y: "-40%", width: "180%", height: "180%" });
    logoShadow.append(make("feDropShadow", { dx: "1.4", dy: "1.6", stdDeviation: "2", "flood-color": "#0f4358", "flood-opacity": "0.55" }));
    defs.append(logoShadow);
    svg.append(defs);

    svg.append(make("rect", { x: 0, y: 0, width: 800, height: 800, fill: "#e8e8e8" }));
    svg.append(make("circle", { cx: 400, cy: 400, r: 380, fill: "none", stroke: "#1a6b8c", "stroke-width": 6 }));

    const tickGroup = make("g", { id: "ticks" });
    for (let i = 0; i < 60; i += 1) {
      const angle = ((i * 6 - 90) * Math.PI) / 180;
      const isHour = i % 5 === 0;
      const outerRadius = 370;
      const length = isHour ? 25 : 15;
      const innerRadius = outerRadius - length;
      const x1 = 400 + innerRadius * Math.cos(angle);
      const y1 = 400 + innerRadius * Math.sin(angle);
      const x2 = 400 + outerRadius * Math.cos(angle);
      const y2 = 400 + outerRadius * Math.sin(angle);
      tickGroup.append(make("line", {
        x1: x1.toFixed(3),
        y1: y1.toFixed(3),
        x2: x2.toFixed(3),
        y2: y2.toFixed(3),
        stroke: isHour ? "#1a6b8c" : "#2a7a98",
        "stroke-width": isHour ? 8 : 4,
        "stroke-linecap": "round",
      }));
    }
    svg.append(tickGroup);

    const numbers = make("g", { id: "numbers", fill: "#1a6b8c", "font-family": "Arial, Helvetica, sans-serif", "font-size": 60, "text-anchor": "middle", "dominant-baseline": "middle" });
    for (let i = 1; i <= 12; i += 1) {
      const angle = ((i * 30 - 90) * Math.PI) / 180;
      const x = 400 + 300 * Math.cos(angle);
      const y = 400 + 300 * Math.sin(angle);
      const text = make("text", { x: x.toFixed(3), y: y.toFixed(3) });
      text.textContent = String(i);
      numbers.append(text);
    }
    svg.append(numbers);

    const dateText = make("text", { x: 400, y: 160, fill: "#1a6b8c", "font-size": 26, "font-family": "Arial, Helvetica, sans-serif", "text-anchor": "middle", "font-weight": "bold" });
    dateText.textContent = "06.03.2026";
    svg.append(dateText);

    const timeText = make("text", { x: 400, y: 655, fill: "#1a6b8c", "font-size": 25, "font-weight": 700, "font-family": "Arial, Helvetica, sans-serif", "text-anchor": "middle" });
    timeText.textContent = "01:36:21";
    svg.append(timeText);

    const tzText = make("text", { x: 400, y: 560, fill: "#1a6b8c", "font-size": 17, "font-family": "Arial, Helvetica, sans-serif", "text-anchor": "middle", "font-weight": "bold" });
    tzText.textContent = "MCT (UTC+04:00)";
    svg.append(tzText);

    const handsGroup = make("g", { id: "hands" });
    const hourHand = make("line", { x1: 400, y1: 400, x2: 400, y2: 230, stroke: "#1a6b8c", "stroke-width": 14, "stroke-linecap": "round", opacity: 0.86 });
    const minuteHand = make("line", { x1: 400, y1: 400, x2: 400, y2: 170, stroke: "#1f7699", "stroke-width": 10, "stroke-linecap": "round", opacity: 0.84 });
    const secondHandGroup = make("g");
    const secondHand = make("line", { x1: 400, y1: 435, x2: 400, y2: 140, stroke: "#d32f2f", "stroke-width": 3, "stroke-linecap": "round", opacity: 0.94 });
    const counterWeight = make("circle", { cx: 400, cy: 420, r: 10, fill: "#d32f2f" });
    secondHandGroup.append(secondHand, counterWeight);
    handsGroup.append(hourHand, minuteHand, secondHandGroup);
    svg.append(handsGroup);

    svg.append(make("circle", { cx: 400, cy: 400, r: 15, fill: "#d32f2f" }));
    svg.append(make("circle", { cx: 400, cy: 400, r: 5, fill: "#ffffff" }));

    this.elements.hourHand = hourHand;
    this.elements.minuteHand = minuteHand;
    this.elements.secondHand = secondHand;
    this.elements.secondHandGroup = secondHandGroup;
    this.elements.analogDateText = dateText;
    this.elements.analogTimeText = timeText;
  }

  getOmanParts(now) {
    const parts = OMAN_ANALOG_PARTS_FORMATTER.formatToParts(now);
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return {
      hour: Number(map.hour),
      minute: Number(map.minute),
      second: Number(map.second),
      date: `${map.day}.${map.month}.${map.year}`,
    };
  }

  startRenderLoop() {
    if (this.rafId) {
      return;
    }

    const renderFrame = () => {
      if (!this.displayManager.paused) {
        const now = this.gpsTimeSync.getNow();
        const oman = this.getOmanParts(now);
        this.displayManager.updateDigital(oman, now);
        this.displayManager.updateAnalog(oman, now);
        this.displayManager.updateDrift(now);
      }

      this.gpsDisplay.refreshLiveStatus();
      this.rafId = window.requestAnimationFrame(renderFrame);
    };

    this.rafId = window.requestAnimationFrame(renderFrame);
  }

  handleVisibilityChange() {
    if (document.hidden) {
      if (this.rafId) {
        window.cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      return;
    }
    this.startRenderLoop();
  }

  cleanup() {
    if (this.rafId) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    document.removeEventListener("visibilitychange", this.boundVisibility);
    window.removeEventListener("beforeunload", this.boundUnload);
    this.inputHandler.cleanup();
    this.syncManager.cleanup();
    this.gpsTimeSync.stopAutoSync();
    this.gpsTimeSync.stopStatusPolling();
  }
}

window.notificationManager = new NotificationManager();
window.showNotification = (message, type, duration) => {
  window.notificationManager.show(message, type, duration);
};

const bootClock = () => {
  new PrecisionClock().init().catch((error) => {
    console.error("Clock initialization failed:", error);
    window.showNotification(`Initialization failed: ${error.message}`, "error", 6000);
  });
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootClock, { once: true });
} else {
  bootClock();
}
