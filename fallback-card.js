(function (global) {
  const { APP_CONFIG } = global.RAFOTimeApp;
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

    getSourceLabel(source) {
      return {
        "internet-fallback": "INTERNET/HTTP DATE",
        local: "LOCAL COMPUTER TIME",
      }[source] || String(source || "UNKNOWN").toUpperCase();
    }

    buildFallbackSnapshot(data, receiverStatus) {
      const currentSource = data.currentSource || "local";
      const backendOnline = Boolean(receiverStatus.backendOnline ?? data.backendOnline);
      const statusText = data.statusText || receiverStatus.statusText || "Fallback active";
      const heading = currentSource === "internet-fallback" ? "Backend fallback active" : "Emergency fallback active";
      const subheading = currentSource === "internet-fallback"
        ? "The backend is keeping the display live while the primary receiver source is unavailable."
        : backendOnline
          ? "Backend fallback sources are unavailable, so the browser clock is maintaining continuity."
          : "The backend is offline, so the browser clock is maintaining continuity locally.";
      const severity = currentSource === "internet-fallback" ? "info" : "warning";

      return {
        kind: "fallback",
        source: currentSource,
        sourceLabel: this.getSourceLabel(currentSource),
        date: data.date || "Unknown",
        time: data.time || "Unknown",
        statusText,
        heading,
        subheading,
        severity,
        key: this.buildFallbackStateKey(data, receiverStatus, statusText),
      };
    }

    buildFallbackStateKey(data, receiverStatus, statusText) {
      return [
        data.currentSource || "unknown-source",
        receiverStatus.backendOnline ? "backend-online" : "backend-offline",
        receiverStatus.receiverConfigured === false ? "receiver-disabled" : "receiver-enabled",
        receiverStatus.receiverReachable ? "receiver-reachable" : "receiver-unreachable",
        receiverStatus.loginOk ? "login-ok" : "login-failed",
        receiverStatus.gpsLockState || "lock-unknown",
        receiverStatus.receiverCommunicationState || "comm-unknown",
        statusText || "",
      ].join("|");
    }

    buildTransientPayload(message, type = "info", key = "") {
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
        time: lines.find((line) => line.startsWith("Time:"))?.replace(/^Time:\s*/, "") || new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        statusText: lines.find((line) => line.startsWith("Status:"))?.replace(/^Status:\s*/, "") || lines.join(" • "),
        severity: type,
        key: key || `transient:${type}:${lines.join("|")}`,
      };
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
      fallbackInfoTime.textContent = payload.time;
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

    show(message, type = "info", duration = DEFAULT_TRANSIENT_DURATION_MS, key = "") {
      const payload = this.buildTransientPayload(message, type, key);
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

      if (sameVisibleFallback || payload.key === this.dismissedFallbackStateKey || sameKnownState) {
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
  global.showNotification = (message, type, duration, key) => global.appMessageCenter.show(message, type, duration, key);
})(window);
