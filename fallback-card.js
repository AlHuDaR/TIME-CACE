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
      return ["internet-fallback", "local"].includes(source);
    }

    getSourceLabel(source, metadata = {}) {
      return {
        "internet-fallback": metadata.internetFallbackMode === "remote-browser" || metadata.backendOnline === false
          ? "REMOTE INTERNET FALLBACK"
          : "BACKEND INTERNET FALLBACK",
        local: metadata.backendOnline === false ? "LOCAL DEVICE FALLBACK" : "LOCAL EMERGENCY FALLBACK",
      }[source] || String(source || "UNKNOWN").toUpperCase();
    }

    buildFallbackSnapshot(data, receiverStatus) {
      const currentSource = data.currentSource || "local";
      const backendOnline = Boolean(receiverStatus.backendOnline ?? data.backendOnline);
      const receiverConfigured = receiverStatus.receiverConfigured !== false;
      const receiverReachable = Boolean(receiverStatus.receiverReachable);
      const loginOk = Boolean(receiverStatus.loginOk);
      const gpsLockState = receiverStatus.gpsLockState || data.gpsLockState || "unknown";
      const receiverCommunicationState = receiverStatus.receiverCommunicationState || "comm-unknown";
      const fallbackReason = data.fallbackReason || receiverStatus.fallbackReason || "reason-unknown";
      const internetFallbackMode = data.internetFallbackMode || receiverStatus.internetFallbackMode || null;
      const fallbackMode = currentSource === "internet-fallback"
        ? internetFallbackMode === "remote-browser"
          ? "remote-browser-internet-fallback"
          : receiverConfigured
          ? "backend-internet-fallback"
          : "hosted-internet-source"
        : backendOnline
          ? "browser-emergency-fallback"
          : "backend-offline-browser-fallback";
      const statusText = data.statusText || receiverStatus.statusText || "Fallback active";
      const heading = currentSource === "internet-fallback"
        ? internetFallbackMode === "remote-browser"
          ? "Remote Internet fallback active"
          : "Backend fallback active"
        : backendOnline
          ? "Local emergency fallback active"
          : "Local device fallback active";
      const subheading = currentSource === "internet-fallback"
        ? internetFallbackMode === "remote-browser"
          ? "The backend is offline, so the browser is maintaining continuity from a direct Internet reference source."
          : receiverConfigured
            ? "The backend is keeping the display live while the receiver path is degraded or unavailable."
            : "This deployment is intentionally running on backend Internet time because no direct receiver is configured."
        : backendOnline
          ? "Backend fallback sources are unavailable, so the browser is maintaining continuity locally."
          : "The backend is offline, so the browser is maintaining continuity on the local workstation clock.";
      const severity = currentSource === "internet-fallback" ? "info" : "warning";

      return {
        kind: "fallback",
        source: currentSource,
        sourceLabel: this.getSourceLabel(currentSource, { backendOnline, internetFallbackMode }),
        date: data.date || "Unknown",
        time: data.time || "Unknown",
        statusText,
        heading,
        subheading,
        severity,
        key: this.buildFallbackStateKey({
          currentSource,
          backendOnline,
          receiverConfigured,
          receiverReachable,
          loginOk,
          gpsLockState,
          receiverCommunicationState,
          fallbackReason,
          fallbackMode,
          internetFallbackMode,
        }),
        metadata: {
          category: "fallback-state",
          currentSource,
          backendOnline,
          receiverConfigured,
          receiverReachable,
          loginOk,
          gpsLockState,
          receiverCommunicationState,
          fallbackReason,
          fallbackMode,
          internetFallbackMode,
          silentMode: currentSource === "internet-fallback",
        },
      };
    }

    buildFallbackStateKey({
      currentSource = "unknown-source",
      backendOnline = false,
      receiverConfigured = true,
      receiverReachable = false,
      loginOk = false,
      gpsLockState = "unknown",
      receiverCommunicationState = "comm-unknown",
      fallbackReason = "reason-unknown",
      internetFallbackMode = null,
      fallbackMode = currentSource === "internet-fallback" ? "backend-internet-fallback" : "browser-emergency-fallback",
    } = {}) {
      const receiverWriteState = backendOnline && receiverConfigured ? "receiver-writable" : "receiver-readonly";

      return [
        currentSource,
        fallbackMode,
        backendOnline ? "backend-online" : "backend-offline",
        receiverConfigured ? "receiver-enabled" : "receiver-disabled",
        receiverReachable ? "receiver-reachable" : "receiver-unreachable",
        loginOk ? "login-ok" : "login-failed",
        `lock-${gpsLockState}`,
        receiverCommunicationState,
        fallbackReason,
        internetFallbackMode || "no-remote-mode",
        receiverWriteState,
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
      return metadata.silentMode === true && currentSource === "internet-fallback";
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
