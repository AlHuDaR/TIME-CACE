(function (global) {
  const { formatClockTime, normalizeDataState, dataStateLabel, humanizeSource, humanizeLockState, valueToneClass, MONITORING, maxSeverity, formatTimestampWithAge, formatDurationFrom, mapSeverityToTone, describeTimingIntegrity, buildMonitoringModel } = global.RAFOTimeApp;

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
    this.timeline = [];
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
    const sourceClass = this.sourceClasses[data.currentSource] || "source-local";
    this.elements.sourceIndicator.className = `source-badge ${sourceClass}`;
    this.elements.sourceIndicator.textContent = this.gpsTimeSync.getSourceDisplayName(data.currentSource);

    const receiverStatus = data.receiverStatus || this.gpsTimeSync.getReceiverStatus();
    const sessionState = data.sessionState || this.gpsTimeSync.getSessionState();
    this.elements.lockStatus.textContent = this.getLockText(data, receiverStatus);
    this.elements.lockPulse.classList.toggle("locked", receiverStatus.backendOnline && receiverStatus.gpsLockState === "locked");
    this.elements.lockPulse.classList.toggle("warning", receiverStatus.backendOnline && ["unlocked", "holdover"].includes(receiverStatus.gpsLockState));

    if (data.lastSyncTimestamp) {
      this.elements.lastSyncTime.textContent = `Last sync: ${formatClockTime(data.lastSyncTimestamp)}`;
    }

    this.elements.offsetDisplay.textContent = `Offset: ${Math.round(data.offset)} ms`;
    this.elements.statusFreshness.textContent = this.getStatusFreshnessText(receiverStatus);

    this.elements.primarySourceDescription.textContent = this.getPrimarySourceDescription(data, receiverStatus);
    this.elements.primarySourceNote.textContent = this.getPrimarySourceNote(data, receiverStatus, sessionState);
    this.elements.syncStatus.textContent = this.syncManager.formatStatus();
    this.elements.syncStatus.classList.toggle("warn", data.currentSource !== "gps-locked");
    this.elements.statusConsistencyHint.textContent = this.getConsistencyHint(data, receiverStatus);
    this.updateFallbackInfoCard(data, receiverStatus);

    this.updateDashboard(data, receiverStatus, sessionState);
  }

  refreshLiveStatus(force = false) {
    const currentSecond = Math.floor(Date.now() / 1000);
    if (!force && currentSecond === this.lastLiveRefreshSecond) {
      return;
    }

    this.lastLiveRefreshSecond = currentSecond;
    const data = this.gpsTimeSync.getCurrentState();
    const receiverStatus = this.gpsTimeSync.getReceiverStatus();
    const sessionState = this.gpsTimeSync.getSessionState();
    this.elements.syncStatus.textContent = this.syncManager.formatStatus();
    this.elements.syncStatus.classList.toggle("warn", data.currentSource !== "gps-locked");
    this.elements.statusFreshness.textContent = this.getStatusFreshnessText(receiverStatus);
    this.elements.statusConsistencyHint.textContent = this.getConsistencyHint(data, receiverStatus);
    this.updateDashboard(data, receiverStatus, sessionState);
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

  updateDashboard(data, receiverStatus, sessionState) {
    const snapshot = this.buildDashboardSnapshot(data, receiverStatus, sessionState);
    const signature = JSON.stringify(snapshot);
    if (signature === this.lastDashboardSignature) {
      return;
    }

    this.lastDashboardSignature = signature;
    this.recordTimeline(snapshot);

    this.elements.dashboardSeverityBadge.textContent = snapshot.severityLabel;
    this.elements.dashboardSeverityBadge.className = `dashboard-severity ${snapshot.severityClass}`;
    this.elements.dashboardIntegrityBadge.textContent = snapshot.integrityLabel;
    this.elements.dashboardIntegrityBadge.className = `dashboard-severity ${snapshot.integrityClass}`;
    this.elements.dashboardDataStateBadge.textContent = snapshot.dataStateLabel;
    this.elements.dashboardDataStateBadge.className = `dashboard-data-state data-${snapshot.dataState}`;
    this.elements.dashboardSummaryText.textContent = snapshot.summaryText;

    this.setValue(this.elements.dashboardBackendSummary, snapshot.backendSummary, snapshot.backendTone);
    this.setValue(this.elements.dashboardReceiverSummary, snapshot.receiverSummary, snapshot.receiverTone);
    this.setValue(this.elements.dashboardLockSummary, snapshot.lockSummary, snapshot.lockTone);
    this.setValue(this.elements.dashboardSourceSummary, snapshot.activeSource, snapshot.sourceTone);
    this.setValue(this.elements.dashboardIntegritySummary, snapshot.integrityLabel, snapshot.integrityTone);

    this.setValue(this.elements.dashboardBackendStatus, snapshot.backendStatus, snapshot.backendTone);
    this.setValue(this.elements.dashboardReceiverStatus, snapshot.receiverStatus, snapshot.receiverTone);
    this.setValue(this.elements.dashboardLoginStatus, snapshot.loginStatus, snapshot.loginTone);
    this.setValue(this.elements.dashboardHealthStatus, snapshot.healthStatus, snapshot.severityTone);
    this.setValue(this.elements.dashboardIntegrityStatus, snapshot.integrityLabel, snapshot.integrityTone);
    this.setValue(this.elements.dashboardAlarmStatus, snapshot.alarmStatus, snapshot.severityTone);
    this.setValue(this.elements.dashboardCommunicationState, snapshot.communicationState, snapshot.communicationTone);
    this.setValue(this.elements.dashboardStatusDataState, snapshot.statusDataState, snapshot.dataTone);
    this.setValue(this.elements.dashboardLastStatusPoll, snapshot.lastStatusPoll, snapshot.dataTone);
    this.setValue(this.elements.dashboardStatusFreshness, snapshot.statusFreshness, snapshot.dataTone);
    this.setValue(this.elements.dashboardLastGoodComm, snapshot.lastGoodCommunication, snapshot.communicationTone);
    this.setValue(this.elements.dashboardStaleSince, snapshot.staleSince, snapshot.dataTone);
    this.setValue(this.elements.dashboardActiveSource, snapshot.activeSource, snapshot.sourceTone);
    this.setValue(this.elements.dashboardReceiverSource, snapshot.receiverSource, snapshot.receiverSourceTone);
    this.setValue(this.elements.dashboardLastTimeSync, snapshot.lastTimeSync, snapshot.sourceTone);
    this.setValue(this.elements.dashboardAlignmentStatus, snapshot.alignmentStatus, snapshot.alignmentTone);
    this.setValue(this.elements.dashboardLastGoodLock, snapshot.lastGoodGpsLock, snapshot.lockTone);
    this.setValue(this.elements.dashboardAuthoritativeSync, snapshot.authoritativeSyncHealth, snapshot.authoritativeTone);
    this.setValue(this.elements.dashboardRuntimeSourceState, snapshot.runtimeSourceState, snapshot.sourceTone);
    this.setValue(this.elements.dashboardReceiverHealthState, snapshot.receiverHealthState, snapshot.receiverTone);
    this.setValue(this.elements.dashboardLockQualityState, snapshot.lockQualityState, snapshot.lockTone);
    this.setValue(this.elements.dashboardLastAuthoritativeSync, snapshot.lastAuthoritativeSync, snapshot.authoritativeTone);

    this.elements.dashboardStatusText.textContent = snapshot.statusText;
    this.elements.dashboardErrorText.textContent = snapshot.errorText;

    this.renderTimeline();
    this.renderEventList(sessionState.recentEvents || []);
  }

  buildDashboardSnapshot(data, receiverStatus, sessionState) {
    const monitoringState = receiverStatus.monitoringState || buildMonitoringModel(data, receiverStatus, sessionState);
    const severityKey = monitoringState.alarmSeverityState;
    const severity = MONITORING.severityMeta[severityKey] || MONITORING.severityMeta.normal;
    const integrity = MONITORING.integrityMeta[monitoringState.timingIntegrityState] || MONITORING.integrityMeta.low;
    const dataState = monitoringState.dataState;
    const activeSource = this.gpsTimeSync.getSourceDisplayName(data.currentSource);
    const receiverSource = receiverStatus.currentSourceLabel || this.gpsTimeSync.getReceiverSourceDisplayName(receiverStatus.currentSource);
    const alignment = this.getConsistencyHint(data, receiverStatus);
    const authoritativeSyncAt = receiverStatus.lastSuccessfulAuthoritativeTimeSyncAt || sessionState.lastAuthoritativeTimeSyncAt;
    const lastGoodLockAt = receiverStatus.lastKnownGoodGpsLockAt || sessionState.lastKnownGoodGpsLockAt;
    const lastGoodCommunicationAt = receiverStatus.lastSuccessfulReceiverCommunicationAt || sessionState.lastReceiverReachableAt;

    return {
      backendSummary: receiverStatus.backendOnline ? "Online" : "Offline",
      receiverSummary: receiverStatus.receiverReachable ? "Reachable" : "Unreachable",
      lockSummary: humanizeLockState(receiverStatus.gpsLockState),
      activeSource,
      backendStatus: receiverStatus.backendOnline ? "Online and responding" : "Offline or unreachable",
      receiverStatus: receiverStatus.receiverReachable
        ? receiverStatus.loginOk ? "Receiver reachable and authenticated" : "Receiver reachable but authentication failed"
        : "Receiver unreachable",
      loginStatus: receiverStatus.receiverReachable ? (receiverStatus.loginOk ? "Authenticated" : "Login failed") : "Unavailable",
      healthStatus: `${severity.label} timing monitor state`,
      alarmStatus: `${severity.label} alarm`,
      integrityLabel: integrity.label,
      communicationState: this.gpsTimeSync.getCommunicationStateDisplayName(receiverStatus.receiverCommunicationState),
      statusDataState: dataStateLabel(dataState),
      lastStatusPoll: formatTimestampWithAge(receiverStatus.lastSuccessfulPollAt, "Never"),
      statusFreshness: this.getStatusFreshnessText(receiverStatus),
      lastGoodCommunication: lastGoodCommunicationAt
        ? `${formatTimestampWithAge(lastGoodCommunicationAt)} • healthy ${formatDurationFrom(lastGoodCommunicationAt)} ago`
        : "No successful communication recorded in this session",
      staleSince: receiverStatus.statusBecameStaleAt
        ? `${formatTimestampWithAge(receiverStatus.statusBecameStaleAt)}`
        : "Not currently stale",
      receiverSource,
      lastTimeSync: formatTimestampWithAge(data.lastSyncTimestamp, "Never"),
      alignmentStatus: alignment,
      lastGoodGpsLock: lastGoodLockAt
        ? `${formatTimestampWithAge(lastGoodLockAt)} • healthy ${formatDurationFrom(lastGoodLockAt)} ago`
        : "No healthy lock seen in this session",
      authoritativeSyncHealth: authoritativeSyncAt
        ? `Last authoritative sync ${formatDurationFrom(authoritativeSyncAt)} ago`
        : "No authoritative sync recorded in this session",
      runtimeSourceState: this.humanizeStateLabel(monitoringState.runtimeTimeSourceState),
      receiverHealthState: this.humanizeStateLabel(monitoringState.receiverHealthState),
      lockQualityState: this.humanizeStateLabel(monitoringState.gpsLockQualityState),
      lastAuthoritativeSync: formatTimestampWithAge(authoritativeSyncAt, "Never"),
      statusText: receiverStatus.statusText || data.statusText || "Status unavailable.",
      errorText: receiverStatus.lastError ? `Last error: ${receiverStatus.lastError}` : "No errors reported.",
      severityLabel: severity.label,
      severityClass: severity.className,
      severityTone: severity.tone,
      integrityClass: integrity.className,
      integrityTone: integrity.tone,
      summaryText: this.buildSummaryText(data, receiverStatus, monitoringState, integrity.label, severity.label),
      dataState,
      dataStateLabel: dataStateLabel(dataState),
      backendTone: receiverStatus.backendOnline ? "normal" : "critical",
      receiverTone: receiverStatus.receiverReachable ? (receiverStatus.loginOk ? "normal" : "critical") : "critical",
      loginTone: receiverStatus.receiverReachable ? (receiverStatus.loginOk ? "normal" : "critical") : "neutral",
      lockTone: receiverStatus.gpsLockState === "locked" ? "normal" : receiverStatus.gpsLockState === "unknown" ? "neutral" : "warning",
      sourceTone: data.currentSource === "gps-locked" ? "normal" : data.currentSource === "internet-fallback" ? "advisory" : ["gps-unlocked", "holdover"].includes(data.currentSource) ? "warning" : "critical",
      receiverSourceTone: receiverStatus.currentSource === "gps-locked" ? "normal" : receiverStatus.currentSource === "internet-fallback" ? "advisory" : ["gps-unlocked", "holdover"].includes(receiverStatus.currentSource) ? "warning" : receiverStatus.currentSource === "local" ? "critical" : "neutral",
      communicationTone: receiverStatus.receiverCommunicationState === "authenticated"
        ? "normal"
        : receiverStatus.receiverCommunicationState === "reachable"
          ? "advisory"
          : receiverStatus.receiverCommunicationState === "not-started"
            ? "neutral"
          : receiverStatus.receiverCommunicationState === "backend-offline"
            ? "critical"
            : ["login-failed", "unreachable"].includes(receiverStatus.receiverCommunicationState)
              ? "critical"
              : "warning",
      dataTone: dataState === "live" ? "normal" : dataState === "cached" ? "advisory" : dataState === "stale" ? "warning" : dataState === "unavailable" ? "critical" : "neutral",
      alignmentTone: monitoringState.mismatchWhileFresh ? "advisory" : receiverStatus.stale ? "warning" : /agree|aligned/i.test(alignment) ? "normal" : "neutral",
      authoritativeTone: authoritativeSyncAt ? (data.currentSource === "gps-locked" ? "normal" : data.currentSource === "internet-fallback" ? "advisory" : ["gps-unlocked", "holdover"].includes(data.currentSource) ? "warning" : "critical") : "neutral",
      timelineLabel: `${severity.label}: ${activeSource} / ${integrity.label} / ${dataStateLabel(dataState)}`,
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

  humanizeStateLabel(state) {
    return {
      healthy: "Healthy",
      fresh: "Fresh",
      cached: "Cached",
      stale: "Stale",
      degraded: "Degraded",
      warning: "Warning",
      critical: "Critical",
      unknown: "Unknown",
      unavailable: "Unavailable",
      authenticated: "Authenticated",
      "auth-failed": "Auth failed",
      "backend-offline": "Backend offline",
      "receiver-unreachable": "Receiver unreachable",
    }[state] || String(state || "unknown").replace(/-/g, " ");
  }

  buildSummaryText(data, receiverStatus, monitoringState, integrityLabel, severityLabel) {
    const parts = [`${severityLabel} monitor state.`];
    parts.push(`Timing integrity: ${integrityLabel}.`);
    parts.push(`Runtime source: ${this.gpsTimeSync.getSourceDisplayName(data.currentSource)}.`);
    parts.push(`Receiver status: ${receiverStatus.statusText}.`);

    if (monitoringState.dataState === "cached") {
      parts.push("Dashboard is showing a cached status snapshot; treat it as advisory context, not live telemetry.");
    } else if (monitoringState.dataState === "stale") {
      parts.push("Status is stale, so runtime time remains authoritative while dashboard health should be treated cautiously.");
    } else if (monitoringState.dataState === "unavailable") {
      parts.push("Diagnostic status is unavailable; do not interpret historical receiver state as live.");
    }

    if (monitoringState.mismatchWhileFresh) {
      parts.push("Runtime/status mismatch is currently advisory and may indicate a short transition or polling lag.");
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
        chip.className = `timeline-chip status-${entry.tone === "normal" ? "normal" : entry.tone === "critical" ? "critical" : entry.tone === "warning" ? "warning" : entry.tone === "advisory" ? "advisory" : "neutral"}`;
        chip.textContent = entry.label;
        return chip;
      }),
    );
  }

  renderEventList(events) {
    if (!this.elements.dashboardEventList) {
      return;
    }

    const items = (events || []).slice(0, 5);
    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "event-item";
      empty.innerHTML = '<span class="event-item-time">—</span><span class="event-item-text">No session events recorded yet.</span>';
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
        const text = document.createElement("span");
        text.className = "event-item-text";
        text.textContent = entry.message;
        item.append(time, text);
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
      return `${timeText} (${ageText}, cached)`;
    }
    return receiverStatus.stale ? `${timeText} (${ageText}, stale)` : `${timeText} (${ageText}, fresh)`;
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
