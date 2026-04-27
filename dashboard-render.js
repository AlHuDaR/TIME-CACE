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
      this.lastGpsDetailsSignature = "";
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

    hasGpsReceiverDetailsPanel() {
      return Boolean(
        this.elements.gpsReceiverDetailsPanel
        && this.elements.gpsDetailAcquisitionState
        && this.elements.gpsDetailAntennaStatus
        && this.elements.gpsDetailBoardPartNumber
        && this.elements.gpsDetailSoftwareVersion
        && this.elements.gpsDetailFpgaVersion
        && this.elements.gpsDetailLatitude
        && this.elements.gpsDetailLongitude
        && this.elements.gpsDetailAltitude
        && this.elements.gpsDetailX
        && this.elements.gpsDetailY
        && this.elements.gpsDetailZ
        && this.elements.gpsSatelliteCount
        && this.elements.gpsSatelliteTableBody
      );
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
      const telemetryLabel = this.getTelemetryStateLabel(receiverStatus);

      if (this.hasStatusBar()) {
        const sourceClass = this.sourceClasses[data.currentSource] || "source-local";
        this.elements.sourceIndicator.className = `source-badge ${sourceClass}`;
        this.elements.sourceIndicator.textContent = formatStandardStatusLines(data)[0];
        this.elements.lockStatus.textContent = `${formatStandardStatusLines(data)[1]} · ${telemetryLabel}`;
        this.elements.lockPulse.classList.toggle("locked", receiverStatus.backendOnline && receiverStatus.gpsLockState === "locked");
        this.elements.lockPulse.classList.toggle("warning", receiverStatus.backendOnline && ["unlocked", "holdover"].includes(receiverStatus.gpsLockState));

        this.elements.lastSyncTime.textContent = data.lastSyncTimestamp
          ? `Last sync: ${formatClockTime(data.lastSyncTimestamp)}`
          : "Last sync: Never";

        const uncertainty = Number.isFinite(Number(data.uncertaintyEstimateMs))
          ? ` ±${Math.round(Number(data.uncertaintyEstimateMs))} ms`
          : "";
        const confidence = data.confidenceLevel ? ` · ${String(data.confidenceLevel).toUpperCase()}` : "";
        this.elements.offsetDisplay.textContent = `Offset: ${Math.round(data.offset)} ms${uncertainty}${confidence}`;
        this.elements.statusFreshness.textContent = this.getStatusFreshnessText(receiverStatus);
      }

      this.updateReceiverActionButtons(receiverStatus);

      if (this.hasPrimarySourceDetails()) {
        this.elements.primarySourceDescription.textContent = formatStandardStatusLines(data)[0];
        this.elements.primarySourceNote.textContent = this.getPrimarySourceNote(data, receiverStatus, sessionState);
        this.elements.syncStatus.textContent = `${formatStandardStatusLines(data)[1]} · ${telemetryLabel}`;
        this.elements.syncStatus.classList.toggle("warn", data.currentSource !== "gps-xli");
        this.elements.statusConsistencyHint.textContent = this.getConsistencyHint(data, receiverStatus);
      }

      this.updateFallbackInfoCard(data, receiverStatus);
      this.updateMonitoringDashboard({ data, receiverStatus, sessionState });
      this.updateGpsReceiverDetails(receiverStatus);
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
      const telemetryLabel = this.getTelemetryStateLabel(receiverStatus);

      if (this.hasPrimarySourceDetails()) {
        this.elements.syncStatus.textContent = `${formatStandardStatusLines(data)[1]} · ${telemetryLabel}`;
        this.elements.syncStatus.classList.toggle("warn", data.currentSource !== "gps-xli");
        this.elements.statusConsistencyHint.textContent = this.getConsistencyHint(data, receiverStatus);
      }

      if (this.hasStatusBar()) {
        const sourceClass = this.sourceClasses[data.currentSource] || "source-local";
        this.elements.sourceIndicator.className = `source-badge ${sourceClass}`;
        this.elements.sourceIndicator.textContent = formatStandardStatusLines(data)[0];
        this.elements.lockStatus.textContent = `${formatStandardStatusLines(data)[1]} · ${telemetryLabel}`;
        this.elements.lockPulse.classList.toggle("locked", receiverStatus.backendOnline && receiverStatus.gpsLockState === "locked");
        this.elements.lockPulse.classList.toggle("warning", receiverStatus.backendOnline && ["unlocked", "holdover"].includes(receiverStatus.gpsLockState));
        this.elements.lastSyncTime.textContent = data.lastSyncTimestamp
          ? `Last sync: ${formatClockTime(data.lastSyncTimestamp)}`
          : "Last sync: Never";
        const uncertainty = Number.isFinite(Number(data.uncertaintyEstimateMs))
          ? ` ±${Math.round(Number(data.uncertaintyEstimateMs))} ms`
          : "";
        const confidence = data.confidenceLevel ? ` · ${String(data.confidenceLevel).toUpperCase()}` : "";
        this.elements.offsetDisplay.textContent = `Offset: ${Math.round(data.offset)} ms${uncertainty}${confidence}`;
        this.elements.statusFreshness.textContent = this.getStatusFreshnessText(receiverStatus);
      }

      this.updateMonitoringDashboard({ data, receiverStatus, sessionState });
      this.updateGpsReceiverDetails(receiverStatus);
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
      if (!this.hasMonitoringDashboard()) {
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
          value: this.getTelemetryStateLabel(receiverStatus),
          note: this.getTelemetryStateNote(receiverStatus),
          badge: receiverStatus.telemetryState === "normal" ? "OK" : receiverStatus.telemetryState === "unavailable" ? "WARNING" : "INFO",
          badgeTone: receiverStatus.telemetryState === "normal" ? "ok" : receiverStatus.telemetryState === "unavailable" ? "warning" : "info",
          chipClass: receiverStatus.telemetryState === "normal" ? "status-normal" : receiverStatus.telemetryState === "unavailable" ? "status-warning" : "status-advisory",
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
        authenticated: ["Normal", "Receiver communication is healthy.", "OK", "ok", "status-normal"],
        reachable: ["Normal", "Receiver communication is healthy.", "OK", "ok", "status-normal"],
        "receiver-responding": ["Normal", "Receiver communication is healthy.", "OK", "ok", "status-normal"],
        reconnecting: ["Reconnecting", "Receiver communication is reconnecting; recent telemetry is retained.", "INFO", "info", "status-advisory"],
        "auth-recovery": ["Auth recovery", "Receiver link is up but login/session recovery is in progress.", "INFO", "info", "status-advisory"],
        disabled: ["Unavailable", "Receiver communication is disabled.", "INFO", "info", "status-advisory"],
        "login-failed": ["Unavailable", "Receiver authentication failed.", "WARNING", "warning", "status-warning"],
        "auth-failed": ["Unavailable", "Receiver authentication failed.", "WARNING", "warning", "status-warning"],
        unreachable: ["Unavailable", "Receiver communication is unavailable.", "WARNING", "warning", "status-warning"],
        "receiver-unreachable": ["Unavailable", "Receiver communication is unavailable.", "WARNING", "warning", "status-warning"],
        "backend-offline": ["Unavailable", "Receiver communication is unavailable.", "WARNING", "warning", "status-warning"],
        "not-started": ["Unavailable", "Receiver communication has not started yet.", "INFO", "info", "status-advisory"],
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

    updateGpsReceiverDetails(receiverStatus) {
      if (!this.hasGpsReceiverDetailsPanel()) {
        return;
      }

      const details = receiverStatus?.gpsReceiverDetails || {};
      const signature = JSON.stringify({
        telemetryState: receiverStatus?.telemetryState || "unavailable",
        details,
      });
      if (signature === this.lastGpsDetailsSignature) {
        return;
      }

      this.lastGpsDetailsSignature = signature;
      const metadata = details.metadata || {};
      const position = details.position || {};
      const satellites = Array.isArray(receiverStatus?.satelliteTracking) && receiverStatus.satelliteTracking.length > 0
        ? receiverStatus.satelliteTracking
        : (Array.isArray(details.satelliteTracking) ? details.satelliteTracking : []);

      const telemetryState = receiverStatus?.telemetryState || "unavailable";

      this.setText(this.elements.gpsDetailAcquisitionState, this.formatDetailValue(metadata.acquisitionState, telemetryState));
      this.setText(this.elements.gpsDetailAntennaStatus, this.formatDetailValue(metadata.antennaStatus, telemetryState));
      this.setText(this.elements.gpsDetailBoardPartNumber, this.formatDetailValue(metadata.boardPartNumber, telemetryState));
      this.setText(this.elements.gpsDetailSoftwareVersion, this.formatDetailValue(metadata.softwareVersion, telemetryState));
      this.setText(this.elements.gpsDetailFpgaVersion, this.formatDetailValue(metadata.fpgaVersion, telemetryState));
      this.setText(this.elements.gpsDetailLatitude, this.formatCoordinateDetail(position.latitude, telemetryState));
      this.setText(this.elements.gpsDetailLongitude, this.formatCoordinateDetail(position.longitude, telemetryState));
      this.setText(this.elements.gpsDetailAltitude, this.formatMeterValue(position.altitudeMeters, telemetryState));
      this.setText(this.elements.gpsDetailX, this.formatMeterValue(position.xMeters, telemetryState));
      this.setText(this.elements.gpsDetailY, this.formatMeterValue(position.yMeters, telemetryState));
      this.setText(this.elements.gpsDetailZ, this.formatMeterValue(position.zMeters, telemetryState));
      this.setBadge(
        this.elements.gpsSatelliteCount,
        satellites.length > 0 ? "ok" : telemetryState === "unavailable" ? "warning" : "info",
        satellites.length > 0 ? `${satellites.length} SAT` : telemetryState === "unavailable" ? "UNAVAILABLE" : this.getTelemetryStateLabel(receiverStatus).toUpperCase(),
      );
      this.renderSatelliteTable(satellites, telemetryState);
    }

    formatDetailValue(value, telemetryState = "unavailable") {
      return value ? String(value) : this.getUnavailableDetailLabel(telemetryState);
    }

    formatCoordinateDetail(value, telemetryState = "unavailable") {
      if (!value) {
        return this.getUnavailableDetailLabel(telemetryState);
      }

      if (typeof value === "object" && value.text) {
        return value.text;
      }

      return String(value);
    }

    formatMeterValue(value, telemetryState = "unavailable") {
      if (!Number.isFinite(Number(value))) {
        return this.getUnavailableDetailLabel(telemetryState);
      }

      return `${Number(value).toFixed(1)} m`;
    }

    formatLevelDbw(value, telemetryState = "unavailable") {
      if (!value || !String(value).trim()) {
        return this.getUnavailableDetailLabel(telemetryState);
      }

      return String(value).replace(/\s+/g, " ").trim();
    }

    renderSatelliteTable(satellites, telemetryState = "unavailable") {
      if (!this.elements.gpsSatelliteTableBody) {
        return;
      }

      if (!satellites || satellites.length === 0) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = 4;
        cell.className = "gps-satellite-empty";
        cell.textContent = "Satellite tracking data is unavailable from the receiver.";
        row.append(cell);
        this.elements.gpsSatelliteTableBody.replaceChildren(row);
        return;
      }

      this.elements.gpsSatelliteTableBody.replaceChildren(
        ...satellites.map((satellite) => {
          const row = document.createElement("tr");
          [
            satellite.prn,
            this.formatDetailValue(satellite.status, telemetryState),
            this.formatDetailValue(satellite.utilization, telemetryState),
            this.formatLevelDbw(satellite.level, telemetryState),
          ].forEach((value) => {
            const cell = document.createElement("td");
            cell.textContent = String(value);
            row.append(cell);
          });
          return row;
        }),
      );
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

      return `Checked: ${formatClockTime(receiverStatus.checkedAt)} · ${this.getTelemetryStateLabel(receiverStatus)}`;
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

    getTelemetryStateLabel(receiverStatus = {}) {
      return {
        normal: "Normal",
        cached: "Cached",
        reconnecting: "Reconnecting",
        "auth-recovery": "Auth recovery",
        unavailable: "Unavailable",
      }[receiverStatus.telemetryState] || "Unavailable";
    }

    getTelemetryStateNote(receiverStatus = {}) {
      return {
        normal: "Receiver telemetry is current.",
        cached: "Showing recent receiver telemetry from cache.",
        reconnecting: "Receiver reconnect is in progress; recent telemetry is retained.",
        "auth-recovery": "Receiver is reachable, but authentication/session recovery is in progress.",
        unavailable: "Receiver telemetry is unavailable.",
      }[receiverStatus.telemetryState] || "Receiver telemetry is unavailable.";
    }

    getUnavailableDetailLabel(telemetryState = "unavailable") {
      return telemetryState === "cached"
        ? "Cached"
        : telemetryState === "reconnecting"
          ? "Reconnecting"
          : "Unavailable";
    }
  }

  global.RAFOTimeApp.GPSDisplayManager = GPSDisplayManager;
})(window);
