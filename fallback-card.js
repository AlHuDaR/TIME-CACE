(function (global) {
  const { APP_CONFIG, formatClockTime, normalizeRenderedTime } = global.RAFOTimeApp;
  const DEFAULT_TRANSIENT_DURATION_MS = 5000;
  const DEFAULT_FALLBACK_DURATION_MS = 8000;

  class MessageCenter {
    constructor(elements = null) {
      this.elements = elements || this.resolveElements();
      this.notificationTimer = null;
      this.currentNotification = null;
      this.lastFallbackStateKey = "";
      this.dismissedFallbackStateKey = "";
      this.lastTransientKey = "";
      this.bindEvents();
    }

    resolveElements() {
      return {
        fallbackInfoCard: document.getElementById("fallbackInfoCard"),
        fallbackInfoCloseBtn: document.getElementById("fallbackInfoCloseBtn"),
        fallbackInfoHeading: document.getElementById("fallbackInfoHeading"),
        fallbackInfoSubheading: document.getElementById("fallbackInfoSubheading"),
        fallbackInfoSource: document.getElementById("fallbackInfoSource"),
        fallbackInfoDate: document.getElementById("fallbackInfoDate"),
        fallbackInfoTime: document.getElementById("fallbackInfoTime"),
        fallbackInfoStatus: document.getElementById("fallbackInfoStatus"),
      };
    }

    bindEvents() {
      this.elements.fallbackInfoCloseBtn?.addEventListener("click", () => this.dismiss());
    }

    isFallbackSource(source) {
      return ["ntp-nist", "ntp-npl-india", "http-date", "local-clock"].includes(source);
    }

    getSourceLabel(source, metadata = {}) {
      return {
        "ntp-nist": "NTP (NIST)",
        "ntp-npl-india": "NTP (NPL India)",
        "http-date": "INTERNET/HTTP DATE",
        "local-clock": "LOCAL CLOCK",
      }[source] || String(source || "UNKNOWN").toUpperCase();
    }

    buildFallbackSnapshot(data, receiverStatus) {
      const currentSource = data.currentSource || "local-clock";
      const sourceLabel = data.sourceLabel || this.getSourceLabel(currentSource);
      const sourceTier = data.sourceTier || receiverStatus.sourceTier || "emergency-fallback";
      const fallbackReason = data.fallbackReason || receiverStatus.fallbackReason || "reason-unknown";
      const statusText = data.statusText || receiverStatus.statusText || data.status || "Fallback active";
      const receiverCommunicationState = receiverStatus.receiverCommunicationState || "comm-unknown";
      const heading = sourceTier === "traceable-fallback"
        ? "Traceable fallback active"
        : sourceTier === "non-traceable-fallback"
          ? "Internet fallback active"
          : "Emergency local fallback active";
      const subheading = sourceTier === "traceable-fallback"
        ? `${sourceLabel} is maintaining continuity while the GPS Receiver (XLi) is unavailable or not locked.`
        : sourceTier === "non-traceable-fallback"
          ? "NTP sources are unavailable, so the backend is maintaining continuity from HTTP Date headers."
          : "All remote sources are unavailable, so the display is running on the local workstation clock.";
      const severity = sourceTier === "emergency-fallback" ? "warning" : sourceTier === "non-traceable-fallback" ? "warning" : "info";

      return {
        kind: "fallback",
        source: currentSource,
        sourceLabel,
        date: data.date || "Unknown",
        time: data.time || "Unknown",
        statusText,
        heading,
        subheading,
        severity,
        key: this.buildFallbackStateKey({
          currentSource,
          sourceTier,
          fallbackReason,
          receiverCommunicationState,
          sourceLabel,
        }),
        metadata: {
          category: "fallback-state",
          currentSource,
          sourceTier,
          fallbackReason,
          receiverCommunicationState,
          silentMode: sourceTier === "traceable-fallback",
        },
      };
    }

    buildFallbackStateKey({
      currentSource = "unknown-source",
      sourceTier = "unknown-tier",
      fallbackReason = "reason-unknown",
      receiverCommunicationState = "comm-unknown",
      sourceLabel = "UNKNOWN",
    } = {}) {
      return [
        currentSource,
        sourceTier,
        fallbackReason,
        receiverCommunicationState,
        sourceLabel,
      ].join("|");
    }

    buildTransientPayload(message, type = "info", key = "", metadata = {}) {
      const lines = Array.isArray(message)
        ? message.map((line) => String(line ?? "").trim()).filter(Boolean)
        : [String(message ?? "").trim()].filter(Boolean);
      const summary = lines.find((line) => !/^(Source|Date|Time|Status):/i.test(line)) || APP_CONFIG.statusLabels[type] || "Information";

      return {
        kind: "transient",
        heading: APP_CONFIG.statusLabels[type] || "Information",
        subheading: summary,
        sourceLabel: lines.find((line) => line.startsWith("Source:"))?.replace(/^Source:\s*/, "") || APP_CONFIG.statusLabels[type] || "Information",
        date: lines.find((line) => line.startsWith("Date:"))?.replace(/^Date:\s*/, "") || "--/--/----",
        time: normalizeRenderedTime(lines.find((line) => line.startsWith("Time:"))?.replace(/^Time:\s*/, "")) || formatClockTime(new Date()),
        statusText: lines.find((line) => line.startsWith("Status:"))?.replace(/^Status:\s*/, "") || lines.join(" • "),
        severity: type,
        key: key || `transient:${type}:${lines.join("|")}`,
        metadata,
      };
    }

    shouldSuppressPayload(payload) {
      const metadata = payload?.metadata || {};
      const currentSource = metadata.currentSource || payload?.source;
      return metadata.silentMode === true && ["ntp-nist", "ntp-npl-india"].includes(currentSource);
    }

    render(payload) {
      const {
        fallbackInfoCard,
        fallbackInfoHeading,
        fallbackInfoSubheading,
        fallbackInfoSource,
        fallbackInfoDate,
        fallbackInfoTime,
        fallbackInfoStatus,
      } = this.elements;
      if (!fallbackInfoCard) {
        return;
      }

      if (fallbackInfoHeading) {
        fallbackInfoHeading.textContent = payload.heading || "Source update";
      }
      if (fallbackInfoSubheading) {
        fallbackInfoSubheading.textContent = payload.subheading || "Timing source information is available below.";
      }
      fallbackInfoSource.textContent = payload.sourceLabel;
      fallbackInfoDate.textContent = payload.date;
      fallbackInfoTime.textContent = normalizeRenderedTime(payload.time) || payload.time;
      fallbackInfoStatus.textContent = payload.statusText;
      fallbackInfoCard.classList.toggle("is-advisory", payload.severity === "info" || payload.severity === "success");
      fallbackInfoCard.classList.toggle("is-critical", payload.severity === "warning" || payload.severity === "error");
      fallbackInfoCard.classList.remove("hidden");
      fallbackInfoCard.setAttribute("aria-hidden", "false");
    }

    startAutoDismiss(duration) {
      this.stopAutoDismiss();
      if (!(duration > 0)) {
        return;
      }

      this.notificationTimer = global.setTimeout(() => {
        this.notificationTimer = null;
        this.clearNotification({ preserveFallbackTracking: true });
      }, duration);
    }

    stopAutoDismiss() {
      if (!this.notificationTimer) {
        return;
      }

      global.clearTimeout(this.notificationTimer);
      this.notificationTimer = null;
    }

    hide() {
      const { fallbackInfoCard } = this.elements;
      if (!fallbackInfoCard) {
        return;
      }

      fallbackInfoCard.classList.add("hidden");
      fallbackInfoCard.classList.remove("is-advisory", "is-critical");
      fallbackInfoCard.setAttribute("aria-hidden", "true");
    }

    clearNotification(options = {}) {
      const { preserveFallbackTracking = false } = options;
      const current = this.currentNotification;

      this.stopAutoDismiss();
      this.currentNotification = null;
      this.hide();

      if (!preserveFallbackTracking && current?.kind === "fallback") {
        this.lastFallbackStateKey = "";
      }
    }

    dismiss() {
      if (this.currentNotification?.kind === "fallback") {
        this.dismissedFallbackStateKey = this.currentNotification.key;
      }
      this.clearNotification({ preserveFallbackTracking: true });
    }

    show(message, type = "info", duration = DEFAULT_TRANSIENT_DURATION_MS, key = "", metadata = {}) {
      const payload = this.buildTransientPayload(message, type, key, metadata);
      if (this.shouldSuppressPayload(payload)) {
        return;
      }

      if (payload.key === this.lastTransientKey || (this.currentNotification?.kind === payload.kind && this.currentNotification.key === payload.key)) {
        return;
      }

      this.lastTransientKey = payload.key;
      this.currentNotification = payload;
      this.render(payload);
      this.startAutoDismiss(duration);
    }

    updateFallbackInfo(data, receiverStatus = {}) {
      if (!this.elements.fallbackInfoCard) {
        return;
      }

      if (!this.isFallbackSource(data.currentSource)) {
        this.dismissedFallbackStateKey = "";
        this.lastFallbackStateKey = "";
        if (this.currentNotification?.kind === "fallback") {
          this.clearNotification();
        }
        return;
      }

      const payload = this.buildFallbackSnapshot(data, receiverStatus);
      const sameVisibleFallback = this.currentNotification?.kind === "fallback" && this.currentNotification.key === payload.key;
      const sameKnownState = payload.key === this.lastFallbackStateKey;

      if (this.shouldSuppressPayload(payload)) {
        this.lastFallbackStateKey = payload.key;
        if (sameVisibleFallback) {
          this.clearNotification({ preserveFallbackTracking: true });
        }
        return;
      }

      if (sameVisibleFallback) {
        this.currentNotification = payload;
        this.render(payload);
        return;
      }

      if (payload.key === this.dismissedFallbackStateKey || sameKnownState) {
        return;
      }

      this.dismissedFallbackStateKey = "";
      this.lastFallbackStateKey = payload.key;
      this.currentNotification = payload;
      this.render(payload);
      this.startAutoDismiss(DEFAULT_FALLBACK_DURATION_MS);
    }
  }

  global.RAFOTimeApp = global.RAFOTimeApp || {};
  global.RAFOTimeApp.MessageCenter = MessageCenter;
  global.appMessageCenter = global.appMessageCenter || new MessageCenter();
  global.showNotification = (message, type, duration, key, metadata) => global.appMessageCenter.show(message, type, duration, key, metadata);
})(window);
