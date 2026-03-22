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
    formatStandardStatusLines,
    getStandardStatusInfo,
  } = global.RAFOTimeApp;

  class GPSDisplayManager {
    constructor(elements, gpsTimeSync, syncManager, messageCenter) {
      this.elements = elements;
      this.gpsTimeSync = gpsTimeSync;
      this.syncManager = syncManager;
      this.messageCenter = messageCenter;
      this.sourceClasses = {
        "gps-xli": "source-gps",
        "ntp-nist": "source-internet",
        "ntp-npl-india": "source-internet",
        "https-worldtimeapi": "source-gps-warn",
        "https-timeapiio": "source-gps-warn",
        "http-date": "source-gps-warn",
        "frontend-worldtimeapi": "source-gps-warn",
        "frontend-timeapiio": "source-gps-warn",
        "frontend-http-date": "source-gps-warn",
        "local-clock": "source-local",
        "browser-local-clock": "source-local",
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

    isFrontendInternetFallback(data) {
      return data?.sourceTier === "internet-fallback" && String(data?.currentSource || "").startsWith("frontend-");
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
        this.elements.sourceIndicator.textContent = formatStandardStatusLines(data)[0];
        this.elements.lockStatus.textContent = formatStandardStatusLines(data)[1];
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
        this.elements.primarySourceDescription.textContent = formatStandardStatusLines(data)[0];
        this.elements.primarySourceNote.textContent = this.getPrimarySourceNote(data, receiverStatus, sessionState);
        this.elements.syncStatus.textContent = formatStandardStatusLines(data)[1];
        this.elements.syncStatus.classList.toggle("warn", data.currentSource !== "gps-xli");
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
        this.elements.syncStatus.textContent = formatStandardStatusLines(data)[1];
        this.elements.syncStatus.classList.toggle("warn", data.currentSource !== "gps-xli");
        this.elements.statusConsistencyHint.textContent = this.getConsistencyHint(data, receiverStatus);
      }

      if (this.hasStatusBar() && !this.isOldStylePage()) {
        const sourceClass = this.sourceClasses[data.currentSource] || "source-local";
        this.elements.sourceIndicator.className = `source-badge ${sourceClass}`;
        this.elements.sourceIndicator.textContent = formatStandardStatusLines(data)[0];
        this.elements.lockStatus.textContent = formatStandardStatusLines(data)[1];
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
          : "Receiver control is unavailable.";
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
      const standard = getStandardStatusInfo(data);
      const sourceLine = formatStandardStatusLines(data)[0];
      const statusLine = formatStandardStatusLines(data)[1];
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

      return {
        dataState,
        dataStateLabel,
        summaryText: `${sourceLine} | ${statusLine}`,
        diagnosticsText: receiverStatus.checkedAt ? `Checked: ${formatClockTime(receiverStatus.checkedAt)}` : "Checked: Never",
        errorLine: receiverStatus.lastError ? "Issue recorded for time-source monitoring." : "No active issue recorded.",
        receiverReachability: {
          value: receiverStatus.receiverConfigured === false ? "Unavailable" : receiverStatus.receiverReachable ? "Reachable" : "Unavailable",
          note: receiverStatus.receiverConfigured === false ? "Receiver status is not available." : receiverStatus.receiverReachable ? "Receiver communication is available." : "Receiver communication is not available.",
          badge: receiverStatus.receiverReachable ? "OK" : "INFO",
          badgeTone: receiverStatus.receiverReachable ? "ok" : "info",
          chipClass: receiverStatus.receiverReachable ? "status-normal" : "status-advisory",
        },
        gpsLock: {
          value: receiverStatus.gpsLockState === "locked" ? "LOCKED" : receiverStatus.gpsLockState === "holdover" ? "HOLDOVER" : receiverStatus.gpsLockState === "unlocked" ? "UNLOCKED" : "UNKNOWN",
          note: receiverStatus.gpsLockState === "locked" ? "Receiver lock is confirmed." : receiverStatus.gpsLockState === "holdover" ? "Receiver is using holdover timing." : receiverStatus.gpsLockState === "unlocked" ? "Receiver lock is not confirmed." : "Receiver lock state is not available.",
          badge: receiverStatus.gpsLockState === "locked" ? "OK" : "INFO",
          badgeTone: receiverStatus.gpsLockState === "locked" ? "ok" : "info",
          chipClass: receiverStatus.gpsLockState === "locked" ? "status-normal" : "status-advisory",
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
      const standard = getStandardStatusInfo(data);
      return {
        value: standard.status.split(" ")[0].toUpperCase(),
        note: formatStandardStatusLines(data).join(" | "),
        badge: standard.severity === "healthy" ? "OK" : standard.severity === "critical" ? "ERROR" : "WARNING",
        badgeTone: standard.severity === "healthy" ? "ok" : standard.severity === "critical" ? "error" : "warning",
        chipClass: standard.severity === "healthy" ? "status-normal" : standard.severity === "critical" ? "status-critical" : "status-warning",
      };
    }

    getSystemStatusCard(data, receiverStatus) {
      const standard = getStandardStatusInfo(data);
      return {
        value: standard.status.split(" ")[0].toUpperCase(),
        note: formatStandardStatusLines(data).join(" | "),
        badge: standard.severity === "healthy" ? "OK" : standard.severity === "critical" ? "ERROR" : "WARNING",
        badgeTone: standard.severity === "healthy" ? "ok" : standard.severity === "critical" ? "error" : "warning",
        chipClass: standard.severity === "healthy" ? "status-normal" : standard.severity === "critical" ? "status-critical" : "status-warning",
      };
    }

    getLastSyncCard(data, receiverStatus) {
      if (!data.lastSyncTimestamp) {
        return {
          value: "Unavailable",
          note: "Last sync is not available.",
          badge: "INFO",
          badgeTone: "info",
          chipClass: "status-advisory",
        };
      }

      const syncAgeMs = Math.max(0, Date.now() - new Date(data.lastSyncTimestamp).getTime());
      const isStale = syncAgeMs > APP_CONFIG.statusFreshnessWindowMs || receiverStatus.stale;
      return {
        value: `${formatDurationFrom(data.lastSyncTimestamp)} ago`,
        note: `Checked: ${formatClockTime(data.lastSyncTimestamp)}`,
        badge: isStale ? "WARNING" : "OK",
        badgeTone: isStale ? "warning" : "ok",
        chipClass: isStale ? "status-warning" : "status-normal",
      };
    }

    getCommunicationCard(receiverStatus) {
      const communicationMap = {
        authenticated: ["Available", "Receiver communication is available.", "OK", "ok", "status-normal"],
        reachable: ["Available", "Receiver communication is available.", "OK", "ok", "status-normal"],
        "receiver-responding": ["Available", "Receiver communication is available.", "OK", "ok", "status-normal"],
        disabled: ["Unavailable", "Receiver communication is not available.", "INFO", "info", "status-advisory"],
        "login-failed": ["Unavailable", "Receiver communication is not available.", "WARNING", "warning", "status-warning"],
        "auth-failed": ["Unavailable", "Receiver communication is not available.", "WARNING", "warning", "status-warning"],
        unreachable: ["Unavailable", "Receiver communication is not available.", "WARNING", "warning", "status-warning"],
        "receiver-unreachable": ["Unavailable", "Receiver communication is not available.", "WARNING", "warning", "status-warning"],
        "backend-offline": ["Unavailable", "Receiver communication is not available.", "WARNING", "warning", "status-warning"],
        "not-started": ["Unavailable", "Receiver communication is not available.", "INFO", "info", "status-advisory"],
      };
      const [value, note, badge, badgeTone, chipClass] = communicationMap[receiverStatus.receiverCommunicationState]
        || ["Unavailable", "Receiver communication is not available.", "INFO", "info", "status-advisory"];
      return { value, note, badge, badgeTone, chipClass };
    }

    getFallbackCard(data, receiverStatus) {
      const standard = getStandardStatusInfo(data);
      return {
        value: standard.source,
        note: formatStandardStatusLines(data).join(" | "),
        badge: standard.severity === "healthy" ? "OK" : standard.severity === "critical" ? "ERROR" : "WARNING",
        badgeTone: standard.severity === "healthy" ? "ok" : standard.severity === "critical" ? "error" : "warning",
        chipClass: standard.severity === "healthy" ? "status-normal" : standard.severity === "critical" ? "status-critical" : "status-warning",
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
          note: "Last valid sync is not available.",
          badge: "INFO",
          badgeTone: "info",
          chipClass: "status-advisory",
        };
      }

      return {
        value: formatClockTime(lastKnownGoodAt),
        note: `${formatDurationFrom(lastKnownGoodAt)} ago`,
        badge: "INFO",
        badgeTone: "info",
        chipClass: "status-advisory",
      };
    }

    getErrorCard(receiverStatus) {
      if (!receiverStatus.lastError) {
        return {
          value: "None",
          note: "No active issue recorded.",
          badge: "INFO",
          badgeTone: "info",
          chipClass: "status-advisory",
        };
      }

      return {
        value: "Recorded",
        note: "An issue is recorded for time-source monitoring.",
        badge: "WARNING",
        badgeTone: "warning",
        chipClass: "status-warning",
      };
    }

    getActiveSourceCard(data, receiverStatus) {
      const standard = getStandardStatusInfo(data);
      return {
        value: standard.source,
        note: formatStandardStatusLines(data).join(" | "),
        badge: standard.severity === "healthy" ? "OK" : standard.severity === "critical" ? "ERROR" : "WARNING",
        badgeTone: standard.severity === "healthy" ? "ok" : standard.severity === "critical" ? "error" : "warning",
        chipClass: standard.severity === "healthy" ? "status-normal" : standard.severity === "critical" ? "status-critical" : "status-warning",
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
      if (!receiverStatus.checkedAt) {
        return "Checked: Never";
      }

      return `Checked: ${formatClockTime(receiverStatus.checkedAt)}`;
    }

    getLockText(data, receiverStatus) {
      return formatStandardStatusLines(data)[1];
    }

    getPrimarySourceDescription(data, receiverStatus) {
      return formatStandardStatusLines(data)[0];
    }

    getPrimarySourceNote(data, receiverStatus, sessionState) {
      if (sessionState.lastKnownGoodGpsLockAt) {
        return `Last valid sync: ${formatRelativeAge(sessionState.lastKnownGoodGpsLockAt)}.`;
      }

      if (data.lastSyncTimestamp) {
        return `Last sync: ${formatRelativeAge(data.lastSyncTimestamp)}.`;
      }

      return "Last sync: Not available.";
    }

    getConsistencyHint(data, receiverStatus) {
      const status = getStandardStatusInfo(data);
      return `${formatStandardStatusLines(data)[0]} | ${formatStandardStatusLines(data)[1]}`;
    }
  }

  global.RAFOTimeApp.GPSDisplayManager = GPSDisplayManager;
})(window);
