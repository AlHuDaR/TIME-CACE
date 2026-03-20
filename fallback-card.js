(function (global) {
  const { APP_CONFIG } = global.RAFOTimeApp;

  class MessageCenter {
    constructor(elements = null) {
      this.elements = elements || this.resolveElements();
      this.lastFallbackSignature = "";
      this.dismissedFallbackSignature = "";
      this.transientTimer = null;
      this.activeTransient = null;
      this.bindEvents();
    }

    resolveElements() {
      return {
        fallbackInfoCard: document.getElementById("fallbackInfoCard"),
        fallbackInfoCloseBtn: document.getElementById("fallbackInfoCloseBtn"),
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
      return !["gps-locked", "gps-unlocked", "holdover"].includes(source);
    }

    getSourceLabel(source) {
      return {
        "internet-fallback": "INTERNET/HTTP DATE",
        local: "LOCAL COMPUTER TIME",
      }[source] || String(source || "UNKNOWN").toUpperCase();
    }

    buildFallbackSnapshot(data, receiverStatus) {
      const statusText = data.statusText || receiverStatus.statusText || "Fallback active";
      return {
        source: data.currentSource,
        sourceLabel: this.getSourceLabel(data.currentSource),
        date: data.date || "Unknown",
        time: data.time || "Unknown",
        statusText,
        severity: data.currentSource === "internet-fallback" ? "info" : "warning",
      };
    }

    render(payload) {
      const { fallbackInfoCard, fallbackInfoSource, fallbackInfoDate, fallbackInfoTime, fallbackInfoStatus } = this.elements;
      if (!fallbackInfoCard) {
        return;
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

    hide() {
      const { fallbackInfoCard } = this.elements;
      if (!fallbackInfoCard) {
        return;
      }

      fallbackInfoCard.classList.add("hidden");
      fallbackInfoCard.classList.remove("is-advisory", "is-critical");
      fallbackInfoCard.setAttribute("aria-hidden", "true");
    }

    dismiss() {
      if (this.activeTransient) {
        this.clearTransient();
        this.restoreFallback();
        return;
      }

      if (this.lastFallbackSignature) {
        this.dismissedFallbackSignature = this.lastFallbackSignature;
      }
      this.hide();
    }

    clearTransient() {
      if (this.transientTimer) {
        clearTimeout(this.transientTimer);
        this.transientTimer = null;
      }
      this.activeTransient = null;
    }

    restoreFallback() {
      if (!this.activeTransient && this.lastFallbackPayload && this.dismissedFallbackSignature !== this.lastFallbackSignature) {
        this.render(this.lastFallbackPayload);
        return;
      }
      if (!this.activeTransient) {
        this.hide();
      }
    }

    show(message, type = "info", duration = 5000) {
      const lines = Array.isArray(message) ? message.filter(Boolean) : [String(message ?? "")];
      const payload = {
        sourceLabel: lines.find((line) => line.startsWith("Source:"))?.replace(/^Source:\s*/, "") || APP_CONFIG.statusLabels[type] || "Information",
        date: lines.find((line) => line.startsWith("Date:"))?.replace(/^Date:\s*/, "") || "--/--/----",
        time: lines.find((line) => line.startsWith("Time:"))?.replace(/^Time:\s*/, "") || new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        statusText: lines.find((line) => line.startsWith("Status:"))?.replace(/^Status:\s*/, "") || lines.join(" • "),
        severity: type,
      };

      this.clearTransient();
      this.activeTransient = payload;
      this.render(payload);

      if (duration > 0) {
        this.transientTimer = global.setTimeout(() => {
          this.clearTransient();
          this.restoreFallback();
        }, duration);
      }
    }

    updateFallbackInfo(data, receiverStatus) {
      if (!this.elements.fallbackInfoCard || this.activeTransient) {
        this.lastFallbackPayload = this.buildFallbackSnapshot(data, receiverStatus);
        this.lastFallbackSignature = JSON.stringify(this.lastFallbackPayload);
        return;
      }

      if (!this.isFallbackSource(data.currentSource)) {
        this.lastFallbackSignature = "";
        this.dismissedFallbackSignature = "";
        this.lastFallbackPayload = null;
        this.hide();
        return;
      }

      const payload = this.buildFallbackSnapshot(data, receiverStatus);
      const signature = JSON.stringify(payload);
      const hasChanged = signature !== this.lastFallbackSignature;
      this.lastFallbackPayload = payload;
      this.lastFallbackSignature = signature;

      if (hasChanged) {
        this.dismissedFallbackSignature = "";
      }

      if (this.dismissedFallbackSignature === signature) {
        this.hide();
        return;
      }

      this.render(payload);
    }
  }

  global.RAFOTimeApp = global.RAFOTimeApp || {};
  global.RAFOTimeApp.MessageCenter = MessageCenter;
  global.appMessageCenter = global.appMessageCenter || new MessageCenter();
  global.showNotification = (message, type, duration) => global.appMessageCenter.show(message, type, duration);
})(window);
