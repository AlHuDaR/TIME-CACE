(function (global) {
  const { formatClockTime, formatRelativeAge, getSourceLabel } = global.RAFOTimeApp;

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
    return getSourceLabel(source, "humanized") || String(source || "").replace(/-/g, " ");
  }

  function humanizeLockState(lockState) {
    return {
      locked: "Locked",
      unlocked: "Unlocked",
      holdover: "Holdover",
      unknown: "Unknown",
    }[lockState] || "Unknown";
  }

  function humanizeCommunicationState(state) {
    return {
      authenticated: "Authenticated",
      reachable: "Reachable",
      "receiver-responding": "Reachable",
      reconnecting: "Reconnecting",
      "auth-recovery": "Authentication recovery",
      disabled: "Receiver disabled",
      "login-failed": "Authentication failed",
      "auth-failed": "Authentication failed",
      unreachable: "Receiver unreachable",
      "receiver-unreachable": "Receiver unreachable",
      "backend-offline": "Backend offline",
      "not-started": "Waiting for poll",
    }[state] || String(state || "unknown").replace(/-/g, " ");
  }

  function valueToneClass(tone) {
    return `value-${tone || "neutral"}`;
  }

  const MONITORING = Object.freeze({
    severityOrder: Object.freeze(["normal", "advisory", "warning", "critical"]),
    severityMeta: Object.freeze({
      normal: { label: "Normal", className: "status-normal", tone: "normal", notificationType: "success" },
      advisory: { label: "Advisory", className: "status-advisory", tone: "advisory", notificationType: "info" },
      warning: { label: "Warning", className: "status-warning", tone: "warning", notificationType: "warning" },
      critical: { label: "Critical", className: "status-critical", tone: "critical", notificationType: "error" },
    }),
    integrityMeta: Object.freeze({
      high: { label: "High confidence", tone: "normal", className: "status-normal" },
      reduced: { label: "Reduced confidence", tone: "advisory", className: "status-advisory" },
      degraded: { label: "Degraded", tone: "warning", className: "status-warning" },
      low: { label: "Low confidence / uncertain", tone: "critical", className: "status-critical" },
    }),
  });

  function maxSeverity(...levels) {
    return levels.reduce((highest, level) => {
      const currentIndex = MONITORING.severityOrder.indexOf(level || "normal");
      const highestIndex = MONITORING.severityOrder.indexOf(highest || "normal");
      return currentIndex > highestIndex ? level : highest;
    }, "normal");
  }

  function formatTimestampWithAge(timestamp, emptyLabel = "Never") {
    if (!timestamp) {
      return emptyLabel;
    }

    return `${formatClockTime(timestamp)} (${formatRelativeAge(timestamp)})`;
  }

  function formatDurationFrom(timestamp, emptyLabel = "Unknown") {
    if (!timestamp) {
      return emptyLabel;
    }

    const value = timestamp instanceof Date ? timestamp.getTime() : new Date(timestamp).getTime();
    if (!Number.isFinite(value)) {
      return emptyLabel;
    }

    const diff = Math.max(0, Date.now() - value);
    const totalSeconds = Math.floor(diff / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }

  function mapSeverityToTone(level) {
    return MONITORING.severityMeta[level]?.tone || "neutral";
  }

  function describeTimingIntegrity(level) {
    return MONITORING.integrityMeta[level]?.label || "Confidence unknown";
  }

  function buildMonitoringModel(runtimeState, receiverStatus, sessionState) {
    const dataState = normalizeDataState(receiverStatus.dataState, receiverStatus.stale);
    const backendMonitoringState = receiverStatus.monitoringState || runtimeState.monitoringState || {};
    const receiverConfigured = receiverStatus.receiverConfigured !== false;
    const runtimeTimeSourceState = runtimeState.sourceTier === "primary-reference"
      ? "healthy"
      : runtimeState.sourceTier === "traceable-fallback"
        ? "degraded"
        : runtimeState.sourceTier === "internet-fallback"
          ? "warning"
          : runtimeState.sourceTier === "emergency-fallback"
            ? "unavailable"
            : runtimeState.sourceTier === "browser-emergency-fallback"
              ? "unavailable"
              : "unknown";
    const receiverHealthState = !receiverStatus.backendOnline
      ? "unavailable"
      : !receiverConfigured
        ? "standby"
        : !receiverStatus.receiverReachable
          ? "critical"
          : receiverStatus.loginOk
            ? "healthy"
            : "critical";
    const gpsLockQualityState = !receiverConfigured
      ? "standby"
      : receiverStatus.gpsLockState === "locked"
        ? "healthy"
        : receiverStatus.gpsLockState === "holdover"
          ? "warning"
          : receiverStatus.gpsLockState === "unlocked"
            ? "degraded"
            : "unknown";
    const statusDataFreshnessState = dataState === "live"
      ? "fresh"
      : dataState === "cached"
        ? "cached"
        : dataState === "stale"
          ? "stale"
          : dataState === "unavailable"
            ? "unavailable"
            : "unknown";
    const communicationAuthState = !receiverStatus.backendOnline
      ? "backend-offline"
      : !receiverConfigured
        ? "disabled"
        : !receiverStatus.receiverReachable
          ? "receiver-unreachable"
          : receiverStatus.loginOk
            ? "authenticated"
            : receiverStatus.receiverCommunicationState === "auth-recovery"
              ? "auth-recovery"
            : "auth-failed";

    const mismatchWhileFresh = Boolean(
      receiverStatus.checkedAt
        && !receiverStatus.stale
        && receiverConfigured
        && receiverStatus.currentSource
        && runtimeState.currentSource
        && receiverStatus.currentSource !== runtimeState.currentSource,
    );
    const correctedCalendarGpsMode = runtimeState.sourceKey === "gps-xli"
      && receiverStatus.gpsLockState === "locked"
      && (receiverStatus.calendarCorrected === true || receiverStatus.rolloverSuspected === true);

    const timingIntegrityState = backendMonitoringState.timingIntegrityState
      || ((!receiverStatus.backendOnline || ["emergency-fallback", "browser-emergency-fallback"].includes(runtimeState.sourceTier) || dataState === "unavailable")
        ? "low"
        : (runtimeState.sourceTier === "internet-fallback")
          ? "degraded"
          : (!receiverConfigured || runtimeState.sourceTier === "traceable-fallback")
            ? "reduced"
            : correctedCalendarGpsMode
              ? "reduced"
            : (!receiverStatus.receiverReachable || !receiverStatus.loginOk || receiverStatus.gpsLockState === "holdover" || dataState === "stale")
              ? "degraded"
              : (dataState === "cached" || receiverStatus.gpsLockState === "unlocked" || mismatchWhileFresh)
                ? "reduced"
                : "high");

    const alarmSeverityState = backendMonitoringState.alarmSeverityState
      || ((!receiverStatus.backendOnline || ["emergency-fallback", "browser-emergency-fallback"].includes(runtimeState.sourceTier))
        ? "critical"
        : runtimeState.sourceTier === "internet-fallback"
          ? "warning"
          : runtimeState.sourceTier === "traceable-fallback"
            ? receiverConfigured ? "warning" : "advisory"
            : correctedCalendarGpsMode
              ? "advisory"
            : (!receiverConfigured || (dataState === "cached" && runtimeState.sourceTier !== "primary-reference"))
              ? "advisory"
              : (!receiverStatus.receiverReachable || !receiverStatus.loginOk)
                ? "critical"
                : (dataState === "stale" || receiverStatus.gpsLockState === "holdover" || receiverStatus.gpsLockState === "unlocked" || sessionState.communicationIssueCount >= 2)
                  ? "warning"
                  : mismatchWhileFresh
                    ? "advisory"
                    : "normal");

    return {
      runtimeTimeSourceState,
      receiverHealthState: backendMonitoringState.receiverHealthState || receiverHealthState,
      gpsLockQualityState: backendMonitoringState.gpsLockQualityState || gpsLockQualityState,
      statusDataFreshnessState: backendMonitoringState.statusDataFreshnessState || statusDataFreshnessState,
      communicationAuthState: backendMonitoringState.communicationAuthState || communicationAuthState,
      timingIntegrityState,
      alarmSeverityState,
      correctedCalendarGpsMode,
      mismatchWhileFresh,
      dataState,
    };
  }

  Object.assign(global.RAFOTimeApp, {
    normalizeDataState,
    dataStateLabel,
    humanizeSource,
    humanizeLockState,
    humanizeCommunicationState,
    valueToneClass,
    MONITORING,
    maxSeverity,
    formatTimestampWithAge,
    formatDurationFrom,
    mapSeverityToTone,
    describeTimingIntegrity,
    buildMonitoringModel,
  });
})(window);
