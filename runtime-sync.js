(function (global) {
  const {
    APP_CONFIG,
    OMAN_DATE_TIME_FORMATTER,
    resolveApiBaseUrl,
    normalizeBaseUrl,
    normalizeDataState,
    buildMonitoringModel,
    getSourceLabel,
    normalizeRuntimeSourceStatus,
    getStandardStatusInfo,
    formatStandardStatusLines,
    formatClockTime,
    formatTimeParts,
  } = global.RAFOTimeApp;

  if (!OMAN_DATE_TIME_FORMATTER || typeof OMAN_DATE_TIME_FORMATTER.formatToParts !== "function") {
    throw new Error("OMAN_DATE_TIME_FORMATTER is unavailable. Ensure api-client.js loads before runtime-sync.js.");
  }

  function resolveSourceLabel(source, variant = "default") {
    if (typeof getSourceLabel === "function") {
      return getSourceLabel(source, variant);
    }

    const key = String(source || "").trim();
    const labels = {
      "gps-xli": "GPS Receiver",
      "ntp-nist": "Internet (NIST)",
      "ntp-npl-india": "Internet (NPL India)",
      "https-worldtimeapi": "Internet (WorldTimeAPI)",
      "https-timeapiio": "Internet (timeapi.io)",
      "http-date": "Internet (HTTP Date)",
      "frontend-worldtimeapi": "Internet (WorldTimeAPI)",
      "frontend-timeapiio": "Internet (timeapi.io)",
      "frontend-http-date": "Internet (HTTP Date)",
      "local-clock": "Internal Clock",
      "browser-local-clock": "Internal Clock",
    };

    if (labels[key]) {
      return labels[key];
    }

    return variant === "receiver"
      ? key.replace(/-/g, " ")
      : key.toUpperCase();
  }

  function normalizeSourceStatus(payload = {}) {
    if (typeof normalizeRuntimeSourceStatus === "function") {
      return normalizeRuntimeSourceStatus(payload);
    }

    const currentSource = payload.currentSource || payload.sourceKey || payload.source || "browser-local-clock";
    const sourceLabel = payload.currentSourceLabel || payload.sourceLabel || resolveSourceLabel(currentSource);
    const sourceTier = payload.sourceTier || "browser-emergency-fallback";
    const statusText = payload.statusText || payload.status || getStandardStatusInfo(payload).status;
    return {
      currentSource,
      currentSourceLabel: sourceLabel,
      sourceKey: currentSource,
      sourceLabel,
      sourceTier,
      status: statusText,
      statusText,
      fallback: typeof payload.fallback === "boolean" ? payload.fallback : true,
    };
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
      this.lastFrontendFallbackSyncAt = 0;
      this.lastDegradedSyncTriggerAt = 0;
      this.sessionState = this.createSessionState();
      this.receiverStatus = this.createReceiverStatus();
      this.currentState = this.createState({ currentSource: "browser-local-clock", sourceKey: "browser-local-clock", sourceLabel: "Internal Clock", sourceTier: "browser-emergency-fallback", status: "Holdover (using last valid sync)", statusText: "Holdover (using last valid sync)" });
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
      statusText: "Lost (no valid time source)",
      status: "Lost (no valid time source)",
      currentSource: "local-clock",
      currentSourceLabel: "Internal Clock",
      sourceKey: "local-clock",
      sourceLabel: "Internal Clock",
      sourceTier: "emergency-fallback",
      authoritative: false,
      traceable: false,
      fallback: true,
      receiverCommunicationState: "not-started",
      receiverConnectionState: "idle",
      fallbackReason: null,
      lastError: null,
      checkedAt: null,
      lastSuccessfulPollAt: null,
      lastPollAttemptAt: null,
      statusAgeMs: null,
      cacheAgeMs: null,
      fetchedFromCache: false,
      dataState: "waiting",
      telemetryState: "unavailable",
      stale: true,
      monitoringState: null,
      lastKnownGoodGpsLockAt: null,
      lastSuccessfulReceiverCommunicationAt: null,
      lastSuccessfulAuthoritativeTimeSyncAt: null,
      statusBecameStaleAt: null,
      consecutiveCommunicationFailures: 0,
      gpsReceiverDetails: {
        available: false,
        fetchedAt: null,
        error: null,
        metadata: {
          acquisitionState: null,
          antennaStatus: null,
          boardPartNumber: null,
          softwareVersion: null,
          fpgaVersion: null,
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
      },
      receiverConnection: {
        connected: false,
        connecting: false,
        reconnecting: false,
        state: "idle",
        lastConnectedAt: null,
        lastAuthenticatedAt: null,
        lastSuccessfulCommunicationAt: null,
        lastError: null,
        reconnectAttempt: 0,
      },
      ...overrides,
    };
  }

    createState(overrides = {}) {
      return {
        success: true,
        backendOnline: false,
        receiverConfigured: true,
        receiverReachable: false,
        loginOk: false,
        isLocked: false,
        gpsLockState: "unknown",
        statusText: "Holdover (using last valid sync)",
        status: "Holdover (using last valid sync)",
        currentSource: "browser-local-clock",
        currentSourceLabel: "Internal Clock",
        sourceKey: "browser-local-clock",
        sourceLabel: "Internal Clock",
        sourceTier: "browser-emergency-fallback",
        authoritative: false,
        traceable: false,
        fallback: true,
        stale: false,
        fallbackReason: null,
        lastError: null,
        date: null,
        time: null,
        timestamp: Date.now(),
        isoTimestamp: new Date().toISOString(),
        timezone: APP_CONFIG.timezoneLabel || "GST (UTC+04:00)",
        raw: null,
        roundTripMs: null,
        monitoringState: null,
        upstream: null,
        protocol: null,
        internetFallbackMode: null,
        resolutionErrors: [],
        ...overrides,
      };
    }

    resolveSourceSnapshot(payload = {}, fallback = {}) {
      return normalizeSourceStatus({
        ...fallback,
        ...payload,
      });
    }

    isObjectPayload(payload) {
      return Boolean(payload) && typeof payload === "object" && !Array.isArray(payload);
    }

    validateRuntimePayload(payload) {
      if (!this.isObjectPayload(payload)) {
        throw new Error("API returned an invalid /time payload");
      }

      if (!Number.isFinite(Number(payload.timestamp))) {
        throw new Error("API returned an invalid /time timestamp");
      }
    }

    validateStatusPayload(payload) {
      if (!this.isObjectPayload(payload)) {
        throw new Error("API returned an invalid /status payload");
      }
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
    const payload = error?.payload || {};
      const source = this.resolveSourceSnapshot(payload, fallback);
    return this.createState({
      success: false,
      ...fallback,
      backendOnline: Boolean(payload.backendOnline),
      receiverConfigured: payload.receiverConfigured !== false,
      receiverReachable: Boolean(payload.receiverReachable),
      loginOk: Boolean(payload.loginOk),
      isLocked: Boolean(payload.isLocked),
      gpsLockState: payload.gpsLockState || "unknown",
      ...source,
      authoritative: Boolean(payload.authoritative ?? fallback.authoritative),
      traceable: Boolean(payload.traceable ?? fallback.traceable),
      fallback: payload.fallback !== undefined ? Boolean(payload.fallback) : (fallback.fallback !== false),
      status: payload.status || fallback.status || getStandardStatusInfo({ ...payload, ...source, ...fallback }).status,
      roundTripMs: payload.roundTripMs || fallback.roundTripMs || null,
      isoTimestamp: payload.isoTimestamp || fallback.isoTimestamp || new Date().toISOString(),
      statusText: payload.statusText || fallback.statusText || getStandardStatusInfo({ ...payload, ...source, ...fallback }).status,
      lastError: payload.lastError || error.message,
      monitoringState: payload.monitoringState || fallback.monitoringState || null,
      fallbackReason: payload.fallbackReason || fallback.fallbackReason || null,
      timezone: payload.timezone || fallback.timezone || APP_CONFIG.timezoneLabel || "GST (UTC+04:00)",
      internetFallbackMode: payload.internetFallbackMode || fallback.internetFallbackMode || null,
    });
  }

  createFallbackStateFromTimestamp({
    timestamp,
    sourceKey,
    sourceLabel,
    sourceTier,
    status,
    statusText,
    upstream,
    protocol,
    fallbackReason,
    internetFallbackMode = null,
    resolutionErrors = [],
    roundTripMs = null,
    lastError = null,
  }) {
    const normalizedTimestamp = Number(timestamp);
    if (!Number.isFinite(normalizedTimestamp)) {
      throw new Error(`Invalid timestamp produced for ${sourceKey}`);
    }

    const displayParts = this.getOmanDisplayParts(normalizedTimestamp);
    return this.createState({
      success: true,
      backendOnline: false,
      receiverConfigured: this.receiverStatus.receiverConfigured !== false,
      receiverReachable: false,
      loginOk: false,
      isLocked: false,
      gpsLockState: "unknown",
      currentSource: sourceKey,
      currentSourceLabel: sourceLabel,
      sourceKey,
      sourceLabel,
      sourceTier,
      authoritative: false,
      traceable: false,
      fallback: true,
      stale: false,
      status,
      statusText,
      timestamp: normalizedTimestamp,
      isoTimestamp: new Date(normalizedTimestamp).toISOString(),
      date: displayParts.date,
      time: displayParts.time,
      timezone: APP_CONFIG.timezoneLabel || "GST (UTC+04:00)",
      roundTripMs,
      upstream,
      protocol,
      fallbackReason,
      lastError,
      internetFallbackMode,
      resolutionErrors,
    });
  }

  createBrowserLocalClockState(error, resolutionErrors = []) {
    return this.createFallbackStateFromTimestamp({
      timestamp: Date.now(),
      sourceKey: "browser-local-clock",
      sourceLabel: "Internal Clock",
      sourceTier: "browser-emergency-fallback",
      status: "Holdover (using last valid sync)",
      statusText: "Holdover (using last valid sync)",
      upstream: "browser-local-clock",
      protocol: "local",
      fallbackReason: "backend-unreachable-or-invalid",
      internetFallbackMode: "browser-emergency-fallback",
      resolutionErrors,
      lastError: error?.message || "Backend unavailable and internet fallback failed",
    });
  }

  refreshExistingFallbackState(error) {
    const currentSource = this.currentState.currentSource;
    const isFrontendInternetFallback = ["frontend-worldtimeapi", "frontend-timeapiio", "frontend-http-date"].includes(currentSource);
    const isBrowserFallback = currentSource === "browser-local-clock";
    if (!isFrontendInternetFallback && !isBrowserFallback) {
      return null;
    }

    const refreshThreshold = isBrowserFallback
      ? APP_CONFIG.browserEmergencyRetryMs
      : APP_CONFIG.frontendEmergencyRefreshMs;
    const elapsedMs = Date.now() - this.lastFrontendFallbackSyncAt;
    if (elapsedMs >= refreshThreshold) {
      return null;
    }

    return this.createFallbackStateFromTimestamp({
      timestamp: this.getNow().getTime(),
      sourceKey: this.currentState.sourceKey,
      sourceLabel: this.currentState.sourceLabel,
      sourceTier: this.currentState.sourceTier,
      status: this.currentState.status,
      statusText: isBrowserFallback
        ? "Holdover (using last valid sync)"
        : "Degraded (primary source unavailable)",
      upstream: this.currentState.upstream,
      protocol: this.currentState.protocol,
      fallbackReason: this.currentState.fallbackReason || "backend-unreachable-or-invalid",
      internetFallbackMode: this.currentState.internetFallbackMode || (isBrowserFallback ? "browser-emergency-fallback" : "frontend-internet-fallback"),
      resolutionErrors: this.currentState.resolutionErrors || [],
      roundTripMs: this.currentState.roundTripMs,
      lastError: error?.message || this.currentState.lastError || "Backend unavailable",
    });
  }

  parseWorldTimeApiPayload(payload) {
    const timestamp = this.resolveTimestampFromFields([
      payload?.datetime,
      payload?.utc_datetime,
      payload?.currentDateTime,
      payload?.dateTime,
      payload?.unixtime,
      payload?.timestamp,
    ], "WorldTimeAPI");

    return this.createFallbackStateFromTimestamp({
      timestamp,
      sourceKey: "frontend-worldtimeapi",
      sourceLabel: "Internet (WorldTimeAPI)",
      sourceTier: "internet-fallback",
      status: "Degraded (primary source unavailable)",
      statusText: "Degraded (primary source unavailable)",
      upstream: "worldtimeapi",
      protocol: "https",
      fallbackReason: "backend-unreachable-or-invalid",
      internetFallbackMode: "frontend-internet-fallback",
    });
  }

  parseTimeApiIoPayload(payload) {
    const assembledLocalDateTime = payload?.dateTime
      || payload?.currentLocalTime
      || (payload?.date && payload?.time ? `${payload.date}T${payload.time.includes(":") && payload.time.length === 5 ? `${payload.time}:00` : payload.time}+04:00` : null)
      || (Number.isFinite(Number(payload?.year))
        && Number.isFinite(Number(payload?.month))
        && Number.isFinite(Number(payload?.day))
        && Number.isFinite(Number(payload?.hour))
        && Number.isFinite(Number(payload?.minute))
          ? `${String(payload.year).padStart(4, "0")}-${String(payload.month).padStart(2, "0")}-${String(payload.day).padStart(2, "0")}T${String(payload.hour).padStart(2, "0")}:${String(payload.minute).padStart(2, "0")}:${String(payload.seconds || 0).padStart(2, "0")}+04:00`
          : null);

    const timestamp = this.resolveTimestampFromFields([
      assembledLocalDateTime,
      payload?.dateTime,
      payload?.currentLocalTime,
      payload?.timestamp,
      payload?.epochTime,
    ], "TimeAPI.io");

    return this.createFallbackStateFromTimestamp({
      timestamp,
      sourceKey: "frontend-timeapiio",
      sourceLabel: "Internet (timeapi.io)",
      sourceTier: "internet-fallback",
      status: "Degraded (primary source unavailable)",
      statusText: "Degraded (primary source unavailable)",
      upstream: "timeapi.io",
      protocol: "https",
      fallbackReason: "backend-unreachable-or-invalid",
      internetFallbackMode: "frontend-internet-fallback",
    });
  }

  resolveTimestampFromFields(fields = [], context = "remote source") {
    for (const value of fields) {
      if (value === null || value === undefined || value === "") {
        continue;
      }

      const numeric = Number(value);
      if (Number.isFinite(numeric) && numeric > 1000000000) {
        return numeric > 1000000000000 ? numeric : numeric * 1000;
      }

      const parsed = Date.parse(String(value));
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    throw new Error(`No valid timestamp field returned by ${context}`);
  }

  async fetchExternalJson(url) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), APP_CONFIG.remoteTimeRequestTimeoutMs);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} returned by ${url}`);
      }

      let payload;
      try {
        payload = await response.json();
      } catch (error) {
        throw new Error(`Invalid JSON returned by ${url}`);
      }

      if (!this.isObjectPayload(payload)) {
        throw new Error(`Invalid JSON payload returned by ${url}`);
      }

      return payload;
    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error(`Request timeout after ${APP_CONFIG.remoteTimeRequestTimeoutMs} ms`);
      }
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  async fetchWorldTimeApiFallback() {
    const endpoints = (APP_CONFIG.remoteInternetTimeSources || []).filter((source) => source?.parser === "worldtimeapi");
    if (endpoints.length === 0) {
      throw new Error("WorldTimeAPI endpoint not configured");
    }

    let lastError = null;
    for (const endpoint of endpoints) {
      try {
        const payload = await this.fetchExternalJson(endpoint.url);
        const state = this.parseWorldTimeApiPayload(payload);
        return {
          ...state,
          upstream: "worldtimeapi",
          protocol: "https",
        };
      } catch (error) {
        lastError = new Error(`WorldTimeAPI failed: ${error.message}`);
      }
    }

    throw lastError || new Error("WorldTimeAPI failed");
  }

  async fetchTimeApiIoFallback() {
    const endpoints = (APP_CONFIG.remoteInternetTimeSources || []).filter((source) => source?.parser === "timeapiio");
    if (endpoints.length === 0) {
      throw new Error("TimeAPI.io endpoint not configured");
    }

    let lastError = null;
    for (const endpoint of endpoints) {
      try {
        const payload = await this.fetchExternalJson(endpoint.url);
        const state = this.parseTimeApiIoPayload(payload);
        return {
          ...state,
          upstream: "timeapi.io",
          protocol: "https",
        };
      } catch (error) {
        lastError = new Error(`TimeAPI.io failed: ${error.message}`);
      }
    }

    throw lastError || new Error("TimeAPI.io failed");
  }

  async fetchHttpDateFallback() {
    const endpoints = APP_CONFIG.remoteHttpDateSources || [];
    if (!Array.isArray(endpoints) || endpoints.length === 0) {
      throw new Error("HTTP Date endpoint not configured");
    }

    let lastError = null;
    for (const endpoint of endpoints) {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), APP_CONFIG.remoteTimeRequestTimeoutMs);

      try {
        const startedAt = Date.now();
        const response = await fetch(endpoint.url, {
          method: "HEAD",
          headers: {
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} returned by ${endpoint.url}`);
        }

        const headerValue = response.headers.get("date");
        if (!headerValue) {
          throw new Error(`Date header not exposed by ${endpoint.url}`);
        }

        const parsedTimestamp = Date.parse(headerValue);
        if (!Number.isFinite(parsedTimestamp)) {
          throw new Error(`Date header invalid for ${endpoint.url}`);
        }

        const roundTripMs = Math.max(0, Date.now() - startedAt);
        return this.createFallbackStateFromTimestamp({
          timestamp: parsedTimestamp + Math.round(roundTripMs / 2),
          sourceKey: "frontend-http-date",
          sourceLabel: "Internet (HTTP Date)",
          sourceTier: "internet-fallback",
          status: "Degraded (primary source unavailable)",
          statusText: "Degraded (primary source unavailable)",
          upstream: "http-date",
          protocol: "https",
          fallbackReason: "backend-unreachable-or-invalid",
          internetFallbackMode: "frontend-internet-fallback",
          roundTripMs,
        });
      } catch (error) {
        lastError = error.name === "AbortError"
          ? new Error(`HTTP Date failed: request timeout after ${APP_CONFIG.remoteTimeRequestTimeoutMs} ms`)
          : new Error(`HTTP Date failed: ${error.message}`);
      } finally {
        window.clearTimeout(timeoutId);
      }
    }

    throw lastError || new Error("HTTP Date failed");
  }

  async resolveFrontendEmergencyFallback(backendError) {
    const cachedState = this.refreshExistingFallbackState(backendError);
    if (cachedState) {
      return cachedState;
    }

    const attempts = [
      { sourceKey: "frontend-worldtimeapi", run: () => this.fetchWorldTimeApiFallback() },
      { sourceKey: "frontend-timeapiio", run: () => this.fetchTimeApiIoFallback() },
      { sourceKey: "frontend-http-date", run: () => this.fetchHttpDateFallback() },
    ];
    const resolutionErrors = [];

    for (const attempt of attempts) {
      try {
        const state = await attempt.run();
        this.lastFrontendFallbackSyncAt = Date.now();
        return {
          ...state,
          resolutionErrors,
        };
      } catch (error) {
        resolutionErrors.push({
          sourceKey: attempt.sourceKey,
          message: error?.message || String(error),
        });
      }
    }

    this.lastFrontendFallbackSyncAt = Date.now();
    return this.createBrowserLocalClockState(backendError, resolutionErrors);
  }

  async performSync() {
    let nextState = null;

    try {
      const payload = await this.fetchJson("/time");
      this.validateRuntimePayload(payload);
      const source = this.resolveSourceSnapshot(payload);
      const normalizedTimestamp = Number(payload.timestamp);
      const displayParts = this.getOmanDisplayParts(normalizedTimestamp);
      nextState = this.createState({
        success: payload.success !== false,
        backendOnline: payload.backendOnline !== false,
        receiverConfigured: payload.receiverConfigured !== false,
        receiverReachable: Boolean(payload.receiverReachable),
        loginOk: Boolean(payload.loginOk),
        isLocked: Boolean(payload.isLocked),
        gpsLockState: payload.gpsLockState || (payload.isLocked ? "locked" : "unknown"),
        statusText: payload.statusText || payload.status || getStandardStatusInfo({ ...payload, ...source }).status,
        status: payload.status || payload.statusText || getStandardStatusInfo({ ...payload, ...source }).status,
        ...source,
        authoritative: Boolean(payload.authoritative),
        traceable: Boolean(payload.traceable),
        fallback: Boolean(payload.fallback),
        stale: Boolean(payload.stale),
        lastError: payload.lastError || null,
        date: payload.date || displayParts.date,
        time: payload.time || displayParts.time,
        timestamp: normalizedTimestamp,
        isoTimestamp: payload.isoTimestamp || new Date(normalizedTimestamp).toISOString(),
        timezone: payload.timezone || APP_CONFIG.timezoneLabel || "GST (UTC+04:00)",
        raw: payload.raw || null,
        roundTripMs: payload.roundTripMs || payload.rtt || null,
        monitoringState: payload.monitoringState || null,
        fallbackReason: payload.fallbackReason || null,
        upstream: payload.upstream || null,
        protocol: payload.protocol || null,
        internetFallbackMode: payload.internetFallbackMode || null,
        resolutionErrors: payload.resolutionErrors || [],
      });
    } catch (error) {
      nextState = await this.resolveFrontendEmergencyFallback(error);
    }

    if (!nextState) {
      nextState = this.createBrowserLocalClockState(new Error("No remote time source available"));
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
      this.validateStatusPayload(statusResult);
      this.lastSuccessfulStatusPollAt = new Date().toISOString();
      this.mergeReceiverStatus(statusResult, {
        backendOnline: statusResult.backendOnline !== false,
        lastSuccessfulPollAt: this.lastSuccessfulStatusPollAt,
        lastPollAttemptAt: this.lastStatusPollAttemptAt,
        stale: Boolean(statusResult.stale),
      });
      this.maybeTriggerImmediateDegradedSync(this.receiverStatus);
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
          statusText: "Lost (no valid time source)",
          currentSource: this.receiverStatus.currentSource || "local-clock",
          currentSourceLabel: this.receiverStatus.currentSourceLabel || "Internal Clock",
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
    const normalizedSource = normalizeSourceStatus(statusUpdate);
    const previousStatus = this.receiverStatus;
    const previousState = this.currentState;
    const nextStatus = this.createReceiverStatus({
      ...this.receiverStatus,
      ...statusUpdate,
      ...normalizedSource,
      ...overrides,
    });

    const checkedAtMs = nextStatus.checkedAt ? new Date(nextStatus.checkedAt).getTime() : 0;
    const statusAgeMs = checkedAtMs > 0 ? Math.max(0, Date.now() - checkedAtMs) : null;
    const stale = nextStatus.stale || (statusAgeMs !== null && statusAgeMs > APP_CONFIG.statusFreshnessWindowMs);
    nextStatus.statusAgeMs = statusAgeMs;
    nextStatus.dataState = normalizeDataState(nextStatus.dataState, stale);
    nextStatus.stale = stale;
    nextStatus.telemetryState = nextStatus.dataState === "unavailable"
      ? "unavailable"
      : stale
        ? "unavailable"
        : nextStatus.telemetryState || (nextStatus.dataState === "cached" ? "cached" : "normal");
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

  maybeTriggerImmediateDegradedSync(status) {
    const runtimeIsPrimaryGps = this.currentState.currentSource === "gps-xli" && this.currentState.sourceTier === "primary-reference";
    if (!runtimeIsPrimaryGps) {
      return;
    }

    const degradedReceiverState = status.receiverConfigured !== false
      && (!status.receiverReachable || !status.loginOk || ["unlocked", "holdover"].includes(status.gpsLockState));
    if (!degradedReceiverState) {
      return;
    }

    const now = Date.now();
    if ((now - this.lastDegradedSyncTriggerAt) < 2500) {
      return;
    }

    this.lastDegradedSyncTriggerAt = now;
    this.syncTime();
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
    if (state.currentSource === "gps-xli" && state.isLocked) {
      this.sessionState.lastKnownGoodGpsLockAt = new Date().toISOString();
    }

    if (state.authoritative) {
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
      const standardized = getStandardStatusInfo(nextState);
      const severity = standardized.severity === "healthy"
        ? "normal"
        : standardized.severity === "critical"
          ? "critical"
          : "warning";
      const message = formatStandardStatusLines(nextState).join(" | ");
      const key = `runtime-${nextState.currentSource || "unknown"}`;
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
          const invalidJsonError = new Error(`Invalid JSON returned by ${path}`);
          invalidJsonError.status = response.status;
          invalidJsonError.payload = null;
          throw invalidJsonError;
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

  getOmanDisplayParts(timestamp) {
    const parts = OMAN_DATE_TIME_FORMATTER.formatToParts(new Date(timestamp));
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return {
      date: `${map.month}/${map.day}/${map.year}`,
      time: formatTimeParts(map.hour, map.minute, map.second),
    };
  }

  getLocalTime() {
    const now = new Date();
    const parts = OMAN_DATE_TIME_FORMATTER.formatToParts(now);
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));

    return {
      success: true,
      timestamp: now.getTime(),
      isoTimestamp: now.toISOString(),
      date: `${map.month}/${map.day}/${map.year}`,
      time: formatTimeParts(map.hour, map.minute, map.second),
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

    const { currentSource, date, time } = this.currentState;
    const type = currentSource === "gps-xli"
      ? "success"
      : ["ntp-nist", "ntp-npl-india"].includes(currentSource)
        ? "info"
        : ["https-worldtimeapi", "https-timeapiio", "http-date", "frontend-worldtimeapi", "frontend-timeapiio", "frontend-http-date"].includes(currentSource)
          ? "warning"
          : "error";
    const backendOnline = Boolean(this.currentState.backendOnline ?? this.receiverStatus.backendOnline);
    const receiverConfigured = this.receiverStatus.receiverConfigured !== false && this.currentState.receiverConfigured !== false;
    const notificationMode = currentSource;

    this.notifications.show(
      [
        ...formatStandardStatusLines(this.currentState),
        date ? `Date: ${date}` : null,
        time ? `Time: ${time}` : null,
      ],
      type,
      6000,
      "",
      {
        category: "runtime-source",
        currentSource,
        backendOnline,
        receiverConfigured,
        internetFallbackMode: this.currentState.internetFallbackMode,
        notificationMode,
        silentMode: ["ntp-nist", "ntp-npl-india"].includes(currentSource),
      },
    );

    this.hasShownInitialSync = true;
  }

  dispatchUpdate() {
    const offsetMs = Number.isFinite(this.timeOffset) ? this.timeOffset : 0;
    const lastSyncTime = this.lastSyncTime || (this.lastSyncTimestamp ? new Date(this.lastSyncTimestamp) : null);
    const detail = {
      ...this.currentState,
      receiverStatus: this.getReceiverStatus(),
      sessionState: this.getSessionState(),
      offset: offsetMs,
      offsetMs,
      lastSyncTime,
      lastSyncTimestamp: this.lastSyncTimestamp,
    };

    const event = new CustomEvent("gpstimeupdate", { detail });
    this.eventTarget.dispatchEvent(event);
    window.dispatchEvent(event);
  }

  getSourceDisplayName(sourceOrState = this.currentState) {
    const state = typeof sourceOrState === "string"
      ? { currentSource: sourceOrState, backendOnline: this.currentState.backendOnline }
      : (sourceOrState || this.currentState);
    return resolveSourceLabel(state.currentSource || "browser-local-clock");
  }

  getReceiverSourceDisplayName(statusOrSource = this.receiverStatus) {
    const status = typeof statusOrSource === "string"
      ? { currentSource: statusOrSource, backendOnline: this.receiverStatus.backendOnline }
      : (statusOrSource || this.receiverStatus);
    return resolveSourceLabel(status.currentSource || "local-clock", "receiver");
  }

  getCommunicationStateDisplayName(state = this.receiverStatus.receiverCommunicationState) {
    return {
      authenticated: "Authenticated",
      reachable: "Reachable",
      "receiver-responding": "Reachable",
      reconnecting: "Reconnecting",
      disabled: "Receiver disabled",
      "login-failed": "Login failed",
      "auth-failed": "Authentication failed",
      unreachable: "Receiver unreachable",
      "receiver-unreachable": "Receiver unreachable",
      "backend-offline": "Unavailable",
      "not-started": "Not started",
    }[state] || state.replace(/-/g, " ");
  }

  getNow() {
    return new Date(Date.now() + this.timeOffset);
  }

  getCurrentState() {
    const offsetMs = Number.isFinite(this.timeOffset) ? this.timeOffset : 0;
    const lastSyncTime = this.lastSyncTime || (this.lastSyncTimestamp ? new Date(this.lastSyncTimestamp) : null);

    return {
      ...this.currentState,
      receiverStatus: this.getReceiverStatus(),
      sessionState: this.getSessionState(),
      offset: offsetMs,
      offsetMs,
      lastSyncTime,
      lastSyncTimestamp: this.lastSyncTimestamp,
    };
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
    return this.currentState.currentSource === "gps-xli" && this.currentState.isLocked;
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
    const source = this.gpsTimeSync.getSourceDisplayName(state);
    const [sourceLine, statusLine] = formatStandardStatusLines(state);
    return `${sourceLine} | ${statusLine} | Last sync: ${this.getRelativeLastSync()}`;
  }

  markSuccessfulSync() {
    this.hasSuccessfulSync = true;
  }

  cleanup() {}
}


  Object.assign(global.RAFOTimeApp, { GPSTimeSync, SyncManager });
})(window);
