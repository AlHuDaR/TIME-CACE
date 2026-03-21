(function (global) {
  const {
    APP_CONFIG,
    OMAN_DATE_TIME_FORMATTER,
    resolveApiBaseUrl,
    normalizeBaseUrl,
    normalizeDataState,
    buildMonitoringModel,
    humanizeSource,
    formatClockTime,
  } = global.RAFOTimeApp;

  if (!OMAN_DATE_TIME_FORMATTER || typeof OMAN_DATE_TIME_FORMATTER.formatToParts !== "function") {
    throw new Error("OMAN_DATE_TIME_FORMATTER is unavailable. Ensure api-client.js loads before runtime-sync.js.");
  }

class GPSTimeSync {
  constructor() {
    this.apiBaseUrl = resolveApiBaseUrl();
    this.apiBackupUrl = normalizeBaseUrl(APP_CONFIG.apiBackupUrl);
    this.notifications = global.appMessageCenter || new global.RAFOTimeApp.MessageCenter();
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
    this.sessionState = this.createSessionState();
    this.receiverStatus = this.createReceiverStatus();
    this.currentState = this.createState({ currentSource: "local" });
  }

  createSessionState(overrides = {}) {
    return {
      lastKnownGoodGpsLockAt: null,
      lastReceiverReachableAt: null,
      lastAuthoritativeTimeSyncAt: null,
      statusBecameStaleAt: null,
      communicationIssueCount: 0,
      recentEvents: [],
      ...overrides,
    };
  }

  createReceiverStatus(overrides = {}) {
    return {
      backendOnline: false,
      receiverConfigured: true,
      receiverReachable: false,
      loginOk: false,
      isLocked: false,
      gpsLockState: "unknown",
      statusText: "System status not checked yet",
      currentSource: "local",
      currentSourceLabel: "Local fallback",
      receiverCommunicationState: "not-started",
      fallbackReason: null,
      lastError: null,
      checkedAt: null,
      lastSuccessfulPollAt: null,
      lastPollAttemptAt: null,
      statusAgeMs: null,
      cacheAgeMs: null,
      fetchedFromCache: false,
      dataState: "waiting",
      stale: true,
      monitoringState: null,
      lastKnownGoodGpsLockAt: null,
      lastSuccessfulReceiverCommunicationAt: null,
      lastSuccessfulAuthoritativeTimeSyncAt: null,
      statusBecameStaleAt: null,
      consecutiveCommunicationFailures: 0,
      ...overrides,
    };
  }

  createState(overrides = {}) {
    return {
      backendOnline: false,
      receiverConfigured: true,
      receiverReachable: false,
      loginOk: false,
      isLocked: false,
      gpsLockState: "unknown",
      statusText: "Using local computer time",
      currentSource: "local",
      currentSourceLabel: "Local computer time",
      fallbackReason: null,
      lastError: null,
      date: null,
      time: null,
      timestamp: Date.now(),
      raw: null,
      sourceLabel: "Local computer time",
      monitoringState: null,
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
      receiverConfigured: error?.payload?.receiverConfigured !== false,
      receiverReachable: Boolean(error?.payload?.receiverReachable),
      loginOk: Boolean(error?.payload?.loginOk),
      isLocked: Boolean(error?.payload?.isLocked),
      gpsLockState: error?.payload?.gpsLockState || "unknown",
      currentSource: error?.payload?.currentSource || fallback.currentSource || "local",
      currentSourceLabel: error?.payload?.currentSourceLabel || fallback.currentSourceLabel || "Local fallback",
      statusText: error?.payload?.statusText || fallback.statusText || `Backend unavailable: ${error.message}`,
      lastError: error?.payload?.lastError || error.message,
      monitoringState: error?.payload?.monitoringState || fallback.monitoringState || null,
      fallbackReason: error?.payload?.fallbackReason || fallback.fallbackReason || null,
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
          receiverConfigured: gpsResult.receiverConfigured !== false,
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
          monitoringState: gpsResult.monitoringState || null,
          fallbackReason: gpsResult.fallbackReason || null,
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
            receiverConfigured: internetResult.receiverConfigured !== false && nextState?.receiverConfigured !== false,
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
            monitoringState: internetResult.monitoringState || null,
            fallbackReason: internetResult.fallbackReason || nextState?.fallbackReason || null,
          });
        }
      } catch (error) {
        if (nextState) {
          nextState.backendOnline = nextState.backendOnline || Boolean(error?.payload?.backendOnline);
          nextState.receiverConfigured = nextState.receiverConfigured && error?.payload?.receiverConfigured !== false;
          nextState.receiverReachable = nextState.receiverReachable || Boolean(error?.payload?.receiverReachable);
          nextState.loginOk = nextState.loginOk || Boolean(error?.payload?.loginOk);
          nextState.lastError = nextState.lastError || error?.payload?.lastError || error.message;
          nextState.fallbackReason = nextState.fallbackReason || error?.payload?.fallbackReason || null;
        }
      }
    }

    if (!nextState || nextState.currentSource === "local") {
      const localResult = this.getLocalTime();
      nextState = this.createState({
        ...nextState,
        backendOnline: Boolean(nextState?.backendOnline),
        receiverConfigured: nextState?.receiverConfigured !== false,
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
        monitoringState: nextState?.monitoringState || null,
        fallbackReason: nextState?.fallbackReason || (nextState?.backendOnline ? "backend-fallback-unavailable" : "backend-offline"),
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
          receiverConfigured: this.receiverStatus.receiverConfigured !== false,
          receiverReachable: false,
          loginOk: false,
          isLocked: false,
          gpsLockState: "unknown",
          statusText: `Status polling unavailable: ${error.message}`,
          currentSource: this.receiverStatus.currentSource || "local",
          currentSourceLabel: this.receiverStatus.currentSourceLabel || "Status unavailable",
          receiverCommunicationState: "backend-offline",
          fallbackReason: "backend-offline",
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
    const previousStatus = this.receiverStatus;
    const previousState = this.currentState;
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
    this.updateSessionMarkersFromStatus(nextStatus);
    nextStatus.monitoringState = buildMonitoringModel(this.currentState, nextStatus, this.sessionState);
    nextStatus.statusBecameStaleAt = nextStatus.statusBecameStaleAt || this.sessionState.statusBecameStaleAt;
    nextStatus.lastKnownGoodGpsLockAt = nextStatus.lastKnownGoodGpsLockAt || this.sessionState.lastKnownGoodGpsLockAt;
    nextStatus.lastSuccessfulReceiverCommunicationAt = nextStatus.lastSuccessfulReceiverCommunicationAt || this.sessionState.lastReceiverReachableAt;
    nextStatus.lastSuccessfulAuthoritativeTimeSyncAt = nextStatus.lastSuccessfulAuthoritativeTimeSyncAt || this.sessionState.lastAuthoritativeTimeSyncAt;
    nextStatus.consecutiveCommunicationFailures = Math.max(
      nextStatus.consecutiveCommunicationFailures || 0,
      this.sessionState.communicationIssueCount,
    );
    this.receiverStatus = nextStatus;
    this.evaluateEvents(previousState, this.currentState, previousStatus, nextStatus);
  }

  updateSessionMarkersFromStatus(status) {
    if (status.receiverReachable) {
      this.sessionState.lastReceiverReachableAt = new Date().toISOString();
      this.sessionState.communicationIssueCount = 0;
    } else if (status.lastPollAttemptAt && status.lastPollAttemptAt !== this.receiverStatus.lastPollAttemptAt) {
      this.sessionState.communicationIssueCount += 1;
    }

    if (status.gpsLockState === "locked") {
      this.sessionState.lastKnownGoodGpsLockAt = new Date().toISOString();
    }

    if (status.stale) {
      this.sessionState.statusBecameStaleAt = this.sessionState.statusBecameStaleAt || new Date().toISOString();
    } else {
      this.sessionState.statusBecameStaleAt = null;
    }
  }

  updateSessionMarkersFromState(state) {
    if (state.currentSource === "gps-locked" && state.isLocked) {
      this.sessionState.lastKnownGoodGpsLockAt = new Date().toISOString();
      this.sessionState.lastAuthoritativeTimeSyncAt = new Date().toISOString();
    } else if (["gps-unlocked", "holdover"].includes(state.currentSource)) {
      this.sessionState.lastAuthoritativeTimeSyncAt = new Date().toISOString();
    }
  }

  pushEvent(message, severity = "normal", key = message) {
    const previous = this.sessionState.recentEvents[0];
    if (previous && previous.key === key) {
      return;
    }

    this.sessionState.recentEvents.unshift({
      key,
      message,
      severity,
      timestamp: new Date().toISOString(),
    });
    this.sessionState.recentEvents = this.sessionState.recentEvents.slice(0, 8);
  }

  evaluateEvents(previousState, nextState, previousStatus, nextStatus) {
    if (previousStatus.gpsLockState !== nextStatus.gpsLockState) {
      if (nextStatus.gpsLockState === "locked") {
        this.pushEvent("GPS lock healthy.", "normal", "gps-lock-healthy");
      } else if (nextStatus.gpsLockState === "holdover") {
        this.pushEvent("Receiver entered holdover.", "warning", "gps-holdover");
      } else if (nextStatus.gpsLockState === "unlocked") {
        this.pushEvent("GPS lock lost.", "warning", "gps-unlocked");
      }
    }

    if (previousStatus.receiverReachable !== nextStatus.receiverReachable) {
      this.pushEvent(
        nextStatus.receiverReachable ? "Receiver communication restored." : "Receiver unreachable.",
        nextStatus.receiverReachable ? "normal" : "critical",
        nextStatus.receiverReachable ? "receiver-restored" : "receiver-unreachable",
      );
    }

    if (previousStatus.loginOk !== nextStatus.loginOk && nextStatus.receiverReachable) {
      this.pushEvent(
        nextStatus.loginOk ? "Receiver authentication restored." : "Receiver login/authentication failure.",
        nextStatus.loginOk ? "normal" : "critical",
        nextStatus.loginOk ? "receiver-auth-restored" : "receiver-auth-failed",
      );
    }

    if (previousState.currentSource !== nextState.currentSource) {
      const sourceEventMap = {
        "gps-locked": ["Runtime switched to GPS locked source.", "normal", "runtime-gps-locked"],
        "gps-unlocked": ["Runtime using unlocked receiver state.", "warning", "runtime-gps-unlocked"],
        holdover: ["Runtime using receiver holdover.", "warning", "runtime-holdover"],
        "internet-fallback": ["Runtime switched to Internet fallback.", "advisory", "runtime-internet"],
        local: ["Runtime degraded to local fallback.", "critical", "runtime-local"],
      };
      const [message, severity, key] = sourceEventMap[nextState.currentSource]
        || [`Runtime source changed to ${humanizeSource(nextState.currentSource)}.`, "advisory", `runtime-${nextState.currentSource}`];
      this.pushEvent(message, severity, key);
    }

    if (!previousStatus.stale && nextStatus.stale) {
      this.pushEvent("Status data became stale.", "warning", "status-stale");
    } else if (previousStatus.stale && !nextStatus.stale) {
      this.pushEvent("Status freshness restored.", "normal", "status-fresh");
    }

    const previousModel = previousStatus.monitoringState || buildMonitoringModel(previousState, previousStatus, this.sessionState);
    const nextModel = nextStatus.monitoringState || buildMonitoringModel(nextState, nextStatus, this.sessionState);
    if (previousModel.mismatchWhileFresh !== nextModel.mismatchWhileFresh) {
      this.pushEvent(
        nextModel.mismatchWhileFresh
          ? "Runtime/status source mismatch observed while status is fresh."
          : "Runtime/status alignment restored.",
        nextModel.mismatchWhileFresh ? "advisory" : "normal",
        nextModel.mismatchWhileFresh ? "runtime-status-mismatch" : "runtime-status-aligned",
      );
    }
  }

  async fetchJson(path, options = {}) {
    const baseUrls = [this.apiBaseUrl, this.apiBackupUrl].filter(Boolean);
    let lastFailure = null;

    for (const baseUrl of baseUrls) {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), APP_CONFIG.requestTimeoutMs);

      try {
        const response = await fetch(`${baseUrl}${path}`, {
          ...options,
          headers: this.getRequestHeaders(options.headers || {}),
          signal: controller.signal,
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

        if (baseUrl !== this.apiBaseUrl) {
          this.apiBaseUrl = baseUrl;
        }
        return payload;
      } catch (error) {
        const failure = error.name === "AbortError"
          ? new Error(`Request timeout after ${APP_CONFIG.requestTimeoutMs} ms`)
          : error;
        if (failure !== error) {
          failure.payload = error?.payload || null;
          failure.status = error?.status || 0;
        }
        lastFailure = failure;
      } finally {
        window.clearTimeout(timeoutId);
      }
    }

    throw lastFailure || new Error("Unable to reach configured API endpoint");
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
    this.updateSessionMarkersFromState(state);
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
    const backendOnline = Boolean(this.currentState.backendOnline ?? this.receiverStatus.backendOnline);
    const receiverConfigured = this.receiverStatus.receiverConfigured !== false && this.currentState.receiverConfigured !== false;
    const notificationMode = currentSource === "internet-fallback"
      ? receiverConfigured
        ? "backend-internet-fallback"
        : "hosted-internet-source"
      : currentSource === "local"
        ? backendOnline
          ? "browser-emergency-fallback"
          : "backend-offline-browser-fallback"
        : "standard-runtime-source";

    this.notifications.show(
      [
        `Source: ${this.getSourceDisplayName(currentSource)}`,
        date ? `Date: ${date}` : null,
        time ? `Time: ${time}` : null,
        `Status: ${statusText}`,
      ],
      type,
      6000,
      "",
      {
        category: "runtime-source",
        currentSource,
        backendOnline,
        receiverConfigured,
        notificationMode,
        silentMode: currentSource === "internet-fallback",
      },
    );

    this.hasShownInitialSync = true;
  }

  dispatchUpdate() {
    const detail = {
      ...this.currentState,
      receiverStatus: this.getReceiverStatus(),
      sessionState: this.getSessionState(),
      offset: this.timeOffset,
      lastSyncTimestamp: this.lastSyncTimestamp,
    };

    const event = new CustomEvent("gpstimeupdate", { detail });
    this.eventTarget.dispatchEvent(event);
    window.dispatchEvent(event);
  }

  getSourceDisplayName(source = this.currentState.currentSource) {
    return {
      "gps-locked": "GPS LOCKED",
      "gps-unlocked": "RECEIVER UNLOCKED",
      holdover: "RECEIVER HOLDOVER",
      "internet-fallback": "BACKEND INTERNET FALLBACK",
      local: "LOCAL EMERGENCY FALLBACK",
    }[source] || source.toUpperCase();
  }

  getReceiverSourceDisplayName(source = this.receiverStatus.currentSource) {
    return {
      "gps-locked": "Receiver locked",
      "gps-unlocked": "Receiver unlocked",
      holdover: "Receiver holdover",
      "internet-fallback": "Backend Internet fallback",
      local: this.receiverStatus.backendOnline ? "Local emergency fallback" : "Backend offline / local fallback",
    }[source] || source.replace(/-/g, " ");
  }

  getCommunicationStateDisplayName(state = this.receiverStatus.receiverCommunicationState) {
    return {
      authenticated: "Authenticated",
      reachable: "Reachable",
      "receiver-responding": "Reachable",
      disabled: "Receiver disabled",
      "login-failed": "Login failed",
      "auth-failed": "Authentication failed",
      unreachable: "Receiver unreachable",
      "receiver-unreachable": "Receiver unreachable",
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
      monitoringState: buildMonitoringModel(this.currentState, status, this.sessionState),
    };
  }

  getSessionState() {
    return {
      ...this.sessionState,
      recentEvents: [...this.sessionState.recentEvents],
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


  Object.assign(global.RAFOTimeApp, { GPSTimeSync, SyncManager });
})(window);
