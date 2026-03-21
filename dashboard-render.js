(function (global) {
  const {
    APP_CONFIG,
    formatClockTime,
    formatRelativeAge,
    humanizeSource,
    humanizeLockState,
    humanizeCommunicationState,
    formatTimestampWithAge,
    formatDurationFrom,
    buildMonitoringModel,
  } = global.RAFOTimeApp;

  class GPSDisplayManager {
    constructor(elements, gpsTimeSync, syncManager, messageCenter) {
      this.elements = elements;
      this.gpsTimeSync = gpsTimeSync;
      this.syncManager = syncManager;
      this.messageCenter = messageCenter;
      this.sourceClasses = {
        "gps-locked": "source-gps",
        "gps-unlocked": "source-gps-warn",
        holdover: "source-gps-warn",
        "internet-fallback": "source-internet",
        local: "source-local",
      };
      this.lastDashboardSignature = "";
      this.lastLiveRefreshSecond = -1;
    }

    hasStatusBar() {
      return Boolean(
        this.elements.sourceIndicator
        && this.elements.lockStatus
        && this.elements.lockPulse
        && this.elements.lastSyncTime
        && this.elements.offsetDisplay
        && this.elements.statusFreshness,
      );
    }

    hasPrimarySourceDetails() {
      return Boolean(
        this.elements.primarySourceDescription
        && this.elements.primarySourceNote
        && this.elements.syncStatus
        && this.elements.statusConsistencyHint,
      );
    }

    hasMonitoringDashboard() {
      return Boolean(
        this.elements.monitoringDashboard
        && this.elements.dashboardSummaryText
        && this.elements.dashboardSeverityBadge
        && this.elements.dashboardIntegrityBadge
        && this.elements.dashboardDataStateBadge
        && this.elements.dashboardSummaryBadge
        && this.elements.dashboardStatusText
        && this.elements.dashboardErrorText
        && this.elements.dashboardEventList,
      );
    }

    isOldStylePage() {
      return document.body.classList.contains("old-style") || document.body.classList.contains("analog-only");
    }

    init() {
      this.gpsTimeSync.addEventListener("gpstimeupdate", (event) => {
        this.updateDisplay(event.detail);
      });

      this.updateDisplay({
        ...this.gpsTimeSync.getCurrentState(),
        receiverStatus: this.gpsTimeSync.getReceiverStatus(),
        sessionState: this.gpsTimeSync.getSessionState(),
        offset: this.gpsTimeSync.timeOffset,
        lastSyncTimestamp: this.gpsTimeSync.lastSyncTimestamp,
      });
    }

    updateDisplay(data) {
      const receiverStatus = data.receiverStatus || this.gpsTimeSync.getReceiverStatus();
      const sessionState = data.sessionState || this.gpsTimeSync.getSessionState();

      if (this.hasStatusBar() && !this.isOldStylePage()) {
        const sourceClass = this.sourceClasses[data.currentSource] || "source-local";
        this.elements.sourceIndicator.className = `source-badge ${sourceClass}`;
        this.elements.sourceIndicator.textContent = this.gpsTimeSync.getSourceDisplayName(data.currentSource);
        this.elements.lockStatus.textContent = this.getLockText(data, receiverStatus);
        this.elements.lockPulse.classList.toggle("locked", receiverStatus.backendOnline && receiverStatus.gpsLockState === "locked");
        this.elements.lockPulse.classList.toggle("warning", receiverStatus.backendOnline && ["unlocked", "holdover"].includes(receiverStatus.gpsLockState));

        this.elements.lastSyncTime.textContent = data.lastSyncTimestamp
          ? `Last sync: ${formatClockTime(data.lastSyncTimestamp)}`
          : "Last sync: Never";

        this.elements.offsetDisplay.textContent = `Offset: ${Math.round(data.offset)} ms`;
        this.elements.statusFreshness.textContent = this.getStatusFreshnessText(receiverStatus);
      }

      this.updateReceiverActionButtons(receiverStatus);

      if (this.hasPrimarySourceDetails()) {
        this.elements.primarySourceDescription.textContent = this.getPrimarySourceDescription(data, receiverStatus);
        this.elements.primarySourceNote.textContent = this.getPrimarySourceNote(data, receiverStatus, sessionState);
        this.elements.syncStatus.textContent = this.syncManager.formatStatus();
        this.elements.syncStatus.classList.toggle("warn", data.currentSource !== "gps-locked");
        this.elements.statusConsistencyHint.textContent = this.getConsistencyHint(data, receiverStatus);
      }

      this.updateFallbackInfoCard(data, receiverStatus);
      this.updateMonitoringDashboard({ data, receiverStatus, sessionState });
    }

    refreshLiveStatus(force = false) {
      const refreshBucket = Math.floor(Date.now() / APP_CONFIG.liveStatusRefreshIntervalMs);
      if (!force && refreshBucket === this.lastLiveRefreshSecond) {
        return;
      }

      this.lastLiveRefreshSecond = refreshBucket;
      const data = this.gpsTimeSync.getCurrentState();
      const receiverStatus = this.gpsTimeSync.getReceiverStatus();
      const sessionState = this.gpsTimeSync.getSessionState();

      if (this.hasPrimarySourceDetails()) {
        this.elements.syncStatus.textContent = this.syncManager.formatStatus();
        this.elements.syncStatus.classList.toggle("warn", data.currentSource !== "gps-locked");
        this.elements.statusConsistencyHint.textContent = this.getConsistencyHint(data, receiverStatus);
      }

      if (this.hasStatusBar() && !this.isOldStylePage()) {
        const sourceClass = this.sourceClasses[data.currentSource] || "source-local";
        this.elements.sourceIndicator.className = `source-badge ${sourceClass}`;
        this.elements.sourceIndicator.textContent = this.gpsTimeSync.getSourceDisplayName(data.currentSource);
        this.elements.lockStatus.textContent = this.getLockText(data, receiverStatus);
        this.elements.lockPulse.classList.toggle("locked", receiverStatus.backendOnline && receiverStatus.gpsLockState === "locked");
        this.elements.lockPulse.classList.toggle("warning", receiverStatus.backendOnline && ["unlocked", "holdover"].includes(receiverStatus.gpsLockState));
        this.elements.lastSyncTime.textContent = data.lastSyncTimestamp
          ? `Last sync: ${formatClockTime(data.lastSyncTimestamp)}`
          : "Last sync: Never";
        this.elements.offsetDisplay.textContent = `Offset: ${Math.round(data.offset)} ms`;
        this.elements.statusFreshness.textContent = this.getStatusFreshnessText(receiverStatus);
      }

      this.updateMonitoringDashboard({ data, receiverStatus, sessionState });
    }


    updateReceiverActionButtons(receiverStatus) {
      const receiverEditable = receiverStatus.backendOnline && receiverStatus.receiverConfigured !== false;
      [this.elements.setTimeComputerBtn, this.elements.setTimeInternetBtn].forEach((button) => {
        if (!button) {
          return;
        }
        button.disabled = !receiverEditable;
        button.title = receiverEditable
          ? button.title.replace(/\s*\(Unavailable\)$/u, "")
          : "Receiver control unavailable because the receiver/backend path is not writable.";
      });
    }

    isFallbackSource(source) {
      return this.messageCenter.isFallbackSource(source);
    }

    getFallbackCardSourceLabel(data) {
      return this.messageCenter.getSourceLabel(data.currentSource);
    }

    dismissFallbackInfoCard() {
      this.messageCenter.dismiss();
    }

    hideFallbackInfoCard() {
      this.messageCenter.hide();
    }

    updateFallbackInfoCard(data, receiverStatus) {
      this.messageCenter.updateFallbackInfo(data, receiverStatus);
    }

    updateMonitoringDashboard(statusData) {
      if (!this.hasMonitoringDashboard() || this.isOldStylePage()) {
        return;
      }

      const snapshot = this.buildMonitoringDashboardSnapshot(statusData);
      const signature = JSON.stringify(snapshot);
      if (signature === this.lastDashboardSignature) {
        return;
      }

      this.lastDashboardSignature = signature;
      this.elements.dashboardSummaryText.textContent = snapshot.summaryText;
      this.elements.dashboardSeverityBadge.textContent = snapshot.systemStatus.badge;
      this.elements.dashboardSeverityBadge.className = `dashboard-severity ${snapshot.systemStatus.chipClass}`;
      this.elements.dashboardIntegrityBadge.textContent = snapshot.timingIntegrity.value;
      this.elements.dashboardIntegrityBadge.className = `dashboard-severity ${snapshot.timingIntegrity.chipClass}`;
      this.elements.dashboardDataStateBadge.textContent = snapshot.dataStateLabel;
      this.elements.dashboardDataStateBadge.className = `dashboard-data-state data-${snapshot.dataState}`;
      this.setBadge(this.elements.dashboardSummaryBadge, snapshot.systemStatus.badgeTone, snapshot.systemStatus.badge);

      this.setMetricCard("ReceiverReachability", snapshot.receiverReachability);
      this.setMetricCard("GpsLock", snapshot.gpsLock);
      this.setMetricCard("ActiveSource", snapshot.activeSource);
      this.setMetricCard("TimingIntegrity", snapshot.timingIntegrity);
      this.setMetricCard("SystemStatus", snapshot.systemStatus);
      this.setMetricCard("LastSync", snapshot.lastSyncAge);
      this.setMetricCard("Communication", snapshot.communicationStatus);
      this.setMetricCard("Fallback", snapshot.fallbackState);
      this.setMetricCard("LastKnownGood", snapshot.lastKnownGoodTime);
      this.setMetricCard("Error", snapshot.errorMessage);

      this.elements.dashboardStatusText.textContent = snapshot.diagnosticsText;
      this.elements.dashboardErrorText.textContent = snapshot.errorLine;
      this.renderEventList(snapshot.events);
    }

    buildMonitoringDashboardSnapshot({ data, receiverStatus, sessionState }) {
      const monitoringState = receiverStatus.monitoringState || buildMonitoringModel(data, receiverStatus, sessionState);
      const activeSource = this.getActiveSourceCard(data, receiverStatus);
      const timingIntegrity = this.getTimingIntegrityCard(data, receiverStatus, monitoringState);
      const systemStatus = this.getSystemStatusCard(data, receiverStatus);
      const lastSyncAge = this.getLastSyncCard(data, receiverStatus);
      const fallbackState = this.getFallbackCard(data, receiverStatus);
      const communicationStatus = this.getCommunicationCard(receiverStatus);
      const lastKnownGoodTime = this.getLastKnownGoodCard(receiverStatus, sessionState);
      const errorMessage = this.getErrorCard(receiverStatus);
      const dataState = receiverStatus.dataState || monitoringState.dataState || "waiting";
      const dataStateLabel = {
        live: "LIVE",
        cached: "CACHED",
        stale: "STALE",
        unavailable: "UNAVAILABLE",
        waiting: "WAITING",
      }[dataState] || "WAITING";
      const receiverSourceLabel = receiverStatus.currentSourceLabel
        || this.gpsTimeSync.getReceiverSourceDisplayName(receiverStatus.currentSource);

      return {
        dataState,
        dataStateLabel,
        summaryText: [
          `${systemStatus.value}: ${activeSource.value}.`,
          receiverStatus.receiverConfigured === false
            ? "Receiver connection is intentionally disabled for this deployment."
            : receiverStatus.backendOnline
              ? `Receiver path ${receiverStatus.receiverReachable ? "reachable" : "unreachable"}.`
              : "Backend API offline.",
          receiverStatus.receiverConfigured === false
            ? "Backend Internet source remains the continuity path."
            : `Lock state ${humanizeLockState(receiverStatus.gpsLockState).toLowerCase()}.`,
          receiverStatus.stale ? "Status telemetry is stale; monitor continuity mode closely." : "Status telemetry is within the freshness window.",
        ].join(" "),
        diagnosticsText: [
          receiverStatus.statusText || "Status unavailable.",
          `Receiver source reports ${receiverSourceLabel}.`,
          `Status snapshot: ${this.getStatusFreshnessText(receiverStatus)}.`,
          this.getConsistencyHint(data, receiverStatus),
        ].join(" "),
        errorLine: receiverStatus.lastError ? `Active error: ${receiverStatus.lastError}` : "No active errors reported by the backend or receiver.",
        receiverReachability: {
          value: receiverStatus.receiverConfigured === false ? "Not configured" : receiverStatus.receiverReachable ? "Reachable" : "Unreachable",
          note: receiverStatus.receiverConfigured === false
            ? "This deployment is running without a direct receiver connection and will rely on backend fallbacks when needed."
            : receiverStatus.receiverReachable
              ? receiverStatus.loginOk ? "Receiver responded and authentication succeeded." : "Receiver responded, but authentication failed."
              : receiverStatus.backendOnline ? "No active receiver response during the latest poll." : "Backend is unavailable, so the receiver cannot be checked.",
          badge: receiverStatus.receiverConfigured === false ? "INFO" : receiverStatus.receiverReachable ? "OK" : "ERROR",
          badgeTone: receiverStatus.receiverConfigured === false ? "info" : receiverStatus.receiverReachable ? "ok" : "error",
          chipClass: receiverStatus.receiverConfigured === false ? "status-advisory" : receiverStatus.receiverReachable ? "status-normal" : "status-critical",
        },
        gpsLock: {
          value: receiverStatus.receiverConfigured === false ? "NOT CONFIGURED" : humanizeLockState(receiverStatus.gpsLockState).toUpperCase(),
          note: receiverStatus.receiverConfigured === false
            ? "GPS lock telemetry is unavailable because the receiver connection is disabled for this deployment."
            : receiverStatus.gpsLockState === "locked"
              ? "Receiver timing is disciplined to GPS."
              : receiverStatus.gpsLockState === "holdover"
                ? "Receiver is in holdover; timing quality is reduced."
                : receiverStatus.gpsLockState === "unlocked"
                  ? "Receiver is reachable without confirmed GPS lock."
                  : "GPS lock state has not been confirmed yet.",
          badge: receiverStatus.receiverConfigured === false ? "INFO" : receiverStatus.gpsLockState === "locked" ? "OK" : receiverStatus.gpsLockState === "unknown" ? "INFO" : "WARNING",
          badgeTone: receiverStatus.receiverConfigured === false ? "info" : receiverStatus.gpsLockState === "locked" ? "ok" : receiverStatus.gpsLockState === "unknown" ? "info" : "warning",
          chipClass: receiverStatus.receiverConfigured === false ? "status-advisory" : receiverStatus.gpsLockState === "locked" ? "status-normal" : receiverStatus.gpsLockState === "unknown" ? "status-advisory" : "status-warning",
        },
        activeSource,
        timingIntegrity,
        systemStatus,
        lastSyncAge,
        communicationStatus,
        fallbackState,
        lastKnownGoodTime,
        errorMessage,
        events: (sessionState.recentEvents || []).slice(0, 5),
      };
    }

    getTimingIntegrityCard(data, receiverStatus) {
      if (!receiverStatus.backendOnline || data.currentSource === "local" || !data.lastSyncTimestamp) {
        return {
          value: "LOCAL ONLY",
          note: "No authoritative remote time is available; the display is relying on local workstation clock continuity.",
          badge: "ERROR",
          badgeTone: "error",
          chipClass: "status-critical",
        };
      }

      if (data.currentSource === "gps-locked" && receiverStatus.gpsLockState === "locked" && receiverStatus.receiverReachable) {
        return {
          value: "LOCKED (GPS)",
          note: "Best integrity: receiver is reachable, authenticated, and locked to GPS.",
          badge: "OK",
          badgeTone: "ok",
          chipClass: "status-normal",
        };
      }

      if (data.currentSource === "internet-fallback") {
        return {
          value: "BACKEND FALLBACK",
          note: receiverStatus.receiverConfigured === false
            ? "Reduced integrity: this deployment is intentionally using backend Internet time."
            : "Reduced integrity: backend Internet fallback is active because the receiver is not providing locked time.",
          badge: "WARNING",
          badgeTone: "warning",
          chipClass: "status-warning",
        };
      }

      return {
        value: "HOLDOVER",
        note: receiverStatus.gpsLockState === "holdover"
          ? "Medium integrity: receiver is in holdover and should be monitored for drift or source recovery."
          : "Medium integrity: receiver is reachable but GPS lock is not confirmed.",
        badge: "WARNING",
        badgeTone: "warning",
        chipClass: "status-warning",
      };
    }

    getSystemStatusCard(data, receiverStatus) {
      if (!receiverStatus.backendOnline || data.currentSource === "local" || !data.lastSyncTimestamp || (receiverStatus.receiverConfigured !== false && !receiverStatus.receiverReachable)) {
        return {
          value: !receiverStatus.backendOnline
            ? "BACKEND OFFLINE"
            : (receiverStatus.receiverConfigured !== false && !receiverStatus.receiverReachable)
              ? "RECEIVER UNREACHABLE"
              : "LOCAL EMERGENCY",
          note: !receiverStatus.backendOnline
            ? "Backend is unavailable, so mission-time trust is lost."
            : (receiverStatus.receiverConfigured !== false && !receiverStatus.receiverReachable)
              ? "Receiver is unreachable while the backend remains online."
              : "No valid remote time is currently available.",
          badge: "ERROR",
          badgeTone: "error",
          chipClass: "status-critical",
        };
      }

      if (receiverStatus.stale || data.currentSource === "internet-fallback" || ["holdover", "gps-unlocked"].includes(data.currentSource) || ["holdover", "unlocked"].includes(receiverStatus.gpsLockState)) {
        return {
          value: receiverStatus.stale
            ? "STALE TELEMETRY"
            : data.currentSource === "internet-fallback"
              ? "BACKEND FALLBACK"
              : "DEGRADED RECEIVER",
          note: receiverStatus.stale
            ? `Latest receiver status is stale (${this.getStatusFreshnessText(receiverStatus)}).`
            : data.currentSource === "internet-fallback"
              ? "Fallback timing is active and should be treated as degraded service."
              : "Receiver timing is degraded and should be monitored closely.",
          badge: "WARNING",
          badgeTone: "warning",
          chipClass: "status-warning",
        };
      }

      return {
        value: "NORMAL",
        note: "Receiver is reachable, GPS is locked, and live telemetry is fresh.",
        badge: "OK",
        badgeTone: "ok",
        chipClass: "status-normal",
      };
    }

    getLastSyncCard(data, receiverStatus) {
      if (!data.lastSyncTimestamp) {
        return {
          value: "No sync yet",
          note: "The runtime has not recorded a successful synchronization in this session.",
          badge: "ERROR",
          badgeTone: "error",
          chipClass: "status-critical",
        };
      }

      const syncAgeMs = Math.max(0, Date.now() - new Date(data.lastSyncTimestamp).getTime());
      const isStale = syncAgeMs > APP_CONFIG.statusFreshnessWindowMs || receiverStatus.stale;
      return {
        value: isStale ? `STALE • ${formatDurationFrom(data.lastSyncTimestamp)} ago` : `${formatDurationFrom(data.lastSyncTimestamp)} ago`,
        note: `Last successful runtime sync at ${formatTimestampWithAge(data.lastSyncTimestamp)}.`,
        badge: isStale ? "STALE" : "OK",
        badgeTone: isStale ? "warning" : "ok",
        chipClass: isStale ? "status-warning" : "status-normal",
      };
    }

    getCommunicationCard(receiverStatus) {
      const communicationMap = {
        authenticated: ["Authenticated", "Receiver communication and authentication are healthy.", "OK", "ok", "status-normal"],
        reachable: ["Reachable", "Receiver is responding, but authentication state should be confirmed.", "INFO", "info", "status-advisory"],
        "receiver-responding": ["Reachable", "Receiver is responding, but authentication state should be confirmed.", "INFO", "info", "status-advisory"],
        disabled: ["Receiver disabled", "This deployment is using backend-hosted fallback time without a direct receiver connection.", "INFO", "info", "status-advisory"],
        "login-failed": ["Authentication failed", "Receiver responded but login/authentication failed.", "ERROR", "error", "status-critical"],
        "auth-failed": ["Authentication failed", "Receiver responded but login/authentication failed.", "ERROR", "error", "status-critical"],
        unreachable: ["Receiver unreachable", "Receiver communication failed during the latest poll.", "ERROR", "error", "status-critical"],
        "receiver-unreachable": ["Receiver unreachable", "Receiver communication failed during the latest poll.", "ERROR", "error", "status-critical"],
        "backend-offline": ["Backend offline", "The backend cannot reach the receiver because the API service is unavailable.", "ERROR", "error", "status-critical"],
        "not-started": ["Waiting", "No communication attempt has completed yet.", "INFO", "info", "status-advisory"],
      };
      const [value, note, badge, badgeTone, chipClass] = communicationMap[receiverStatus.receiverCommunicationState]
        || [humanizeCommunicationState(receiverStatus.receiverCommunicationState), "Communication state is being evaluated.", "INFO", "info", "status-advisory"];
      return { value, note, badge, badgeTone, chipClass };
    }

    getFallbackCard(data, receiverStatus) {
      if (data.currentSource === "gps-locked") {
        return {
          value: "Standby",
          note: "Fallback paths are armed but not in use while GPS-locked timing is healthy.",
          badge: "OK",
          badgeTone: "ok",
          chipClass: "status-normal",
        };
      }

      if (data.currentSource === "internet-fallback") {
        return {
          value: receiverStatus.receiverConfigured === false ? "Backend Internet source" : "Backend fallback active",
          note: receiverStatus.receiverConfigured === false
            ? "This deployment is intentionally using backend Internet time as its primary hosted source."
            : "Backend fallback is supplying time until authoritative receiver lock returns.",
          badge: "WARNING",
          badgeTone: "warning",
          chipClass: "status-warning",
        };
      }

      if (data.currentSource === "local") {
        return {
          value: "Local emergency fallback",
          note: "Display is relying on browser/local workstation time because remote timing is unavailable.",
          badge: "ERROR",
          badgeTone: "error",
          chipClass: "status-critical",
        };
      }

      return {
        value: receiverStatus.gpsLockState === "holdover" ? "Holdover active" : "Receiver degraded",
        note: receiverStatus.gpsLockState === "holdover"
          ? "Receiver timing continuity is active, but GPS lock has been lost."
          : "Receiver is preferred, but current timing trust is degraded.",
        badge: "WARNING",
        badgeTone: "warning",
        chipClass: "status-warning",
      };
    }

    getLastKnownGoodCard(receiverStatus, sessionState) {
      const lastKnownGoodAt = receiverStatus.lastSuccessfulAuthoritativeTimeSyncAt
        || sessionState.lastAuthoritativeTimeSyncAt
        || receiverStatus.lastKnownGoodGpsLockAt
        || sessionState.lastKnownGoodGpsLockAt
        || receiverStatus.lastSuccessfulReceiverCommunicationAt
        || sessionState.lastReceiverReachableAt;

      if (!lastKnownGoodAt) {
        return {
          value: "Unavailable",
          note: "No healthy receiver or authoritative timing sample has been recorded in this session.",
          badge: "INFO",
          badgeTone: "info",
          chipClass: "status-advisory",
        };
      }

      return {
        value: formatClockTime(lastKnownGoodAt),
        note: `${formatTimestampWithAge(lastKnownGoodAt)} • ${formatDurationFrom(lastKnownGoodAt)} ago.`,
        badge: "INFO",
        badgeTone: "info",
        chipClass: "status-advisory",
      };
    }

    getErrorCard(receiverStatus) {
      if (!receiverStatus.lastError) {
        return {
          value: "No active error",
          note: "Backend polling and receiver status are not reporting an active error string.",
          badge: "INFO",
          badgeTone: "info",
          chipClass: "status-advisory",
        };
      }

      return {
        value: receiverStatus.lastError,
        note: "Most recent backend/receiver error message retained for operator awareness.",
        badge: "ERROR",
        badgeTone: "error",
        chipClass: "status-critical",
      };
    }

    getActiveSourceCard(data, receiverStatus) {
      if (data.currentSource === "gps-locked") {
        return {
          value: "Receiver locked",
          note: "Runtime is using receiver time disciplined to GPS.",
          badge: "OK",
          badgeTone: "ok",
          chipClass: "status-normal",
        };
      }

      if (data.currentSource === "internet-fallback") {
        return {
          value: receiverStatus.receiverConfigured === false ? "Backend Internet source" : "Backend Internet fallback",
          note: receiverStatus.receiverConfigured === false
            ? "This environment is hosted without a direct receiver and is operating on backend Internet time."
            : "Runtime is operating on backend Internet time until the receiver path recovers.",
          badge: "WARNING",
          badgeTone: "warning",
          chipClass: "status-warning",
        };
      }

      if (data.currentSource === "local") {
        return {
          value: receiverStatus.backendOnline ? "Local emergency fallback" : "Backend offline / local fallback",
          note: receiverStatus.backendOnline
            ? "Backend is alive, but no remote time source is currently usable."
            : "Backend is offline, so only local workstation time remains available.",
          badge: "ERROR",
          badgeTone: "error",
          chipClass: "status-critical",
        };
      }

      return {
        value: data.currentSource === "holdover" ? "Receiver holdover" : "Receiver unlocked",
        note: `Runtime is using ${humanizeSource(data.currentSource).toLowerCase()} while the receiver remains degraded.`,
        badge: "WARNING",
        badgeTone: "warning",
        chipClass: "status-warning",
      };
    }

    setMetricCard(name, metric) {
      this.setText(this.elements[`monitor${name}Value`], metric.value);
      this.setText(this.elements[`monitor${name}Note`], metric.note);
      this.setBadge(this.elements[`monitor${name}Badge`], metric.badgeTone, metric.badge);
    }

    setBadge(element, tone, text) {
      if (!element) {
        return;
      }

      const toneClass = {
        ok: "badge-ok",
        warning: "badge-warning",
        error: "badge-error",
        info: "badge-info",
      }[tone] || "badge-info";
      element.textContent = text;
      element.className = `monitoring-card-badge ${toneClass}`;
    }

    setText(element, value) {
      if (!element || element.textContent === value) {
        return;
      }
      element.textContent = value;
    }

    renderEventList(events) {
      if (!this.elements.dashboardEventList) {
        return;
      }

      const items = (events || []).slice(0, 5);
      if (items.length === 0) {
        const empty = document.createElement("div");
        empty.className = "event-item";
        empty.innerHTML = '<span class="event-item-time">—</span><span class="event-item-text">No recent receiver or fallback events recorded.</span>';
        this.elements.dashboardEventList.replaceChildren(empty);
        return;
      }

      this.elements.dashboardEventList.replaceChildren(
        ...items.map((entry) => {
          const item = document.createElement("div");
          item.className = "event-item";

          const time = document.createElement("span");
          time.className = "event-item-time";
          time.textContent = formatClockTime(entry.timestamp);

          const content = document.createElement("div");
          content.className = "event-item-content";

          const badge = document.createElement("span");
          badge.className = `event-severity event-severity-${entry.severity || "info"}`;
          badge.textContent = String(entry.severity || "info").toUpperCase();

          const text = document.createElement("span");
          text.className = "event-item-text";
          text.textContent = entry.message;

          content.append(badge, text);
          item.append(time, content);
          return item;
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
      if (receiverStatus.dataState === "cached") {
        return `${timeText} (${ageText}, cached snapshot)`;
      }
      return receiverStatus.stale ? `${timeText} (${ageText}, stale telemetry)` : `${timeText} (${ageText}, fresh telemetry)`;
    }

    getLockText(data, receiverStatus) {
      if (!receiverStatus.backendOnline) {
        return "Backend offline — local emergency fallback active";
      }
      if (receiverStatus.gpsLockState === "locked") {
        return "Receiver locked to GPS";
      }
      if (receiverStatus.gpsLockState === "holdover") {
        return "Receiver in holdover — monitor continuity";
      }
      if (data.currentSource === "gps-unlocked") {
        return "Receiver reachable but GPS unlocked";
      }
      if (data.currentSource === "internet-fallback") {
        return receiverStatus.receiverReachable
          ? "Receiver degraded — backend fallback active"
          : receiverStatus.receiverConfigured === false
            ? "Receiver disabled — backend Internet source active"
            : "Receiver unreachable — backend fallback active";
      }
      return receiverStatus.receiverReachable
        ? "Receiver reachable — local emergency fallback active"
        : receiverStatus.receiverConfigured === false
          ? "Backend unavailable — local emergency fallback active"
          : "Receiver unreachable — local emergency fallback active";
    }

    getPrimarySourceDescription(data, receiverStatus) {
      if (data.currentSource === "gps-locked") {
        return "Primary source: Symmetricom XLi receiver is reachable, authenticated, and locked.";
      }
      if (data.currentSource === "holdover") {
        return "Primary source is receiver holdover; timing continuity remains on the receiver, but GPS lock is no longer confirmed.";
      }
      if (data.currentSource === "gps-unlocked") {
        return "Primary source preferred, but the Symmetricom XLi receiver is reachable without current GPS lock.";
      }
      if (data.currentSource === "internet-fallback") {
        return receiverStatus.receiverConfigured === false
          ? "This deployment is running from a hosted backend Internet time source without a direct receiver connection."
          : "Primary receiver is not providing locked time, so backend Internet fallback is active.";
      }
      if (!receiverStatus.backendOnline) {
        return "The backend is currently unavailable, so the display is using local workstation time until remote sync resumes.";
      }
      return "Remote time sources are unavailable, so the display is currently using local workstation time.";
    }

    getPrimarySourceNote(data, receiverStatus, sessionState) {
      const parts = [];
      parts.push(`Runtime source: ${this.gpsTimeSync.getSourceDisplayName(data.currentSource)}.`);
      parts.push(`Receiver source: ${receiverStatus.currentSourceLabel || this.gpsTimeSync.getReceiverSourceDisplayName(receiverStatus.currentSource)}.`);
      parts.push(`System status: ${receiverStatus.statusText}.`);
      if (sessionState.lastKnownGoodGpsLockAt) {
        parts.push(`Last known good GPS lock: ${formatRelativeAge(sessionState.lastKnownGoodGpsLockAt)}.`);
      }
      if (sessionState.lastReceiverReachableAt) {
        parts.push(`Last successful receiver communication: ${formatRelativeAge(sessionState.lastReceiverReachableAt)}.`);
      }
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

  global.RAFOTimeApp.GPSDisplayManager = GPSDisplayManager;
})(window);
