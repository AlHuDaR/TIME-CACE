(function (global) {
  const { GPSTimeSync, APP_CONFIG, OMAN_DATE_TIME_FORMATTER } = global.RAFOTimeApp || {};

  if (!GPSTimeSync || !APP_CONFIG || !OMAN_DATE_TIME_FORMATTER) {
    throw new Error("Official time page dependencies are unavailable. Ensure shared runtime modules load first.");
  }

  const OMAN_DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_CONFIG.timezone,
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  class OfficialTimePage {
    constructor() {
      this.elements = {
        digitalTime: document.getElementById("officialDigitalTime"),
        dateLine: document.getElementById("officialDateLine"),
        utcTime: document.getElementById("officialUtcTime"),
        omanTime: document.getElementById("officialOmanTime"),
        deviceTime: document.getElementById("officialDeviceTime"),
        differenceCard: document.getElementById("officialDifferenceCard"),
        differenceValue: document.getElementById("officialDifferenceValue"),
        differenceNote: document.getElementById("officialDifferenceNote"),
        sourceCard: document.getElementById("officialSourceCard"),
        sourceValue: document.getElementById("officialSourceValue"),
        sourceNote: document.getElementById("officialSourceNote"),
        hourHand: document.getElementById("officialHourHand"),
        minuteHand: document.getElementById("officialMinuteHand"),
        secondHand: document.getElementById("officialSecondHand"),
        ticks: document.getElementById("officialClockTicks"),
      };

      this.gpsTimeSync = new GPSTimeSync();
      this.rafId = null;
      this.boundVisibility = () => this.handleVisibilityChange();
      this.boundUpdate = (event) => this.applyStatus(event.detail);
    }

    async init() {
      this.buildTicks();
      this.applyFavicon();
      await this.gpsTimeSync.init();
      this.gpsTimeSync.addEventListener("gpstimeupdate", this.boundUpdate);
      this.applyStatus({
        ...this.gpsTimeSync.getCurrentState(),
        receiverStatus: this.gpsTimeSync.getReceiverStatus(),
        lastSyncTimestamp: this.gpsTimeSync.lastSyncTimestamp,
      });
      document.addEventListener("visibilitychange", this.boundVisibility);
      this.boundUnload = () => this.cleanup();
      window.addEventListener("beforeunload", this.boundUnload, { once: true });
      this.startRenderLoop();
    }

    applyFavicon() {
      let favicon = document.querySelector("link[rel='icon']");
      if (!favicon) {
        favicon = document.createElement("link");
        favicon.rel = "icon";
        document.head.append(favicon);
      }
      favicon.href = "images/cal logo.png";
    }

    buildTicks() {
      if (!this.elements.ticks) {
        return;
      }
      const fragment = document.createDocumentFragment();
      for (let i = 0; i < 60; i += 1) {
        const tick = document.createElement("span");
        tick.className = i % 5 === 0
          ? "official-analog-clock__tick official-analog-clock__tick--major"
          : "official-analog-clock__tick";
        tick.style.setProperty("--tick-index", String(i));
        fragment.append(tick);
      }
      this.elements.ticks.replaceChildren(fragment);
    }

    startRenderLoop() {
      if (this.rafId) {
        return;
      }

      const renderFrame = () => {
        this.renderTime();
        this.rafId = global.requestAnimationFrame(renderFrame);
      };

      this.rafId = global.requestAnimationFrame(renderFrame);
    }

    renderTime() {
      const syncedNow = this.gpsTimeSync.getNow();
      const deviceNow = new Date();
      const omanParts = this.getOmanParts(syncedNow);
      const utcTime = this.formatTime(syncedNow, "UTC");
      const deviceTime = this.formatTime(deviceNow);
      const omanTime = `${omanParts.hour}:${omanParts.minute}:${omanParts.second}`;

      this.elements.digitalTime.textContent = omanTime;
      this.elements.dateLine.textContent = `(UTC +04:00), ${OMAN_DATE_FORMATTER.format(syncedNow)}`;
      this.elements.utcTime.textContent = utcTime;
      this.elements.omanTime.textContent = omanTime;
      this.elements.deviceTime.textContent = deviceTime;
      this.updateDifference(syncedNow, deviceNow);
      this.updateAnalogClock(omanParts, syncedNow.getUTCMilliseconds());
    }

    getOmanParts(date) {
      const parts = OMAN_DATE_TIME_FORMATTER.formatToParts(date);
      const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
      return {
        hour: map.hour,
        minute: map.minute,
        second: map.second,
      };
    }

    formatTime(date, timeZone) {
      return new Intl.DateTimeFormat("en-GB", {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(date);
    }

    updateDifference(syncedNow, deviceNow) {
      const diffMs = syncedNow.getTime() - deviceNow.getTime();
      const absDiffMs = Math.abs(diffMs);
      const polarity = diffMs >= 0 ? "+" : "−";
      const displayValue = `${polarity}${Math.round(absDiffMs)} ms`;
      const severity = absDiffMs > 1000 ? "critical" : absDiffMs > 100 ? "warning" : "healthy";

      this.elements.differenceValue.textContent = displayValue;
      this.elements.differenceNote.textContent = severity === "healthy"
        ? "Device and synchronized reference are closely aligned."
        : severity === "warning"
          ? "Difference exceeds the advisory threshold (100 ms)."
          : "Difference exceeds the critical threshold (1000 ms).";
      this.elements.differenceCard.dataset.severity = severity;
    }

    updateAnalogClock(omanParts, milliseconds) {
      const secondProgress = Number(omanParts.second) + milliseconds / 1000;
      const minuteProgress = Number(omanParts.minute) + secondProgress / 60;
      const hourProgress = (Number(omanParts.hour) % 12) + minuteProgress / 60;

      this.elements.secondHand.style.transform = `translateX(-50%) rotate(${secondProgress * 6}deg)`;
      this.elements.minuteHand.style.transform = `translateX(-50%) rotate(${minuteProgress * 6}deg)`;
      this.elements.hourHand.style.transform = `translateX(-50%) rotate(${hourProgress * 30}deg)`;
    }

    applyStatus(detail) {
      if (!detail) {
        return;
      }

      const receiverStatus = detail.receiverStatus || this.gpsTimeSync.getReceiverStatus();
      const sourceLabel = this.gpsTimeSync.getSourceDisplayName(detail.currentSource);
      const freshness = receiverStatus.checkedAt
        ? `Status snapshot at ${new Date(receiverStatus.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
        : "Status snapshot pending";
      const syncText = detail.lastSyncTimestamp
        ? `Last runtime sync at ${new Date(detail.lastSyncTimestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
        : "Runtime sync pending";
      const sourceTone = !receiverStatus.backendOnline || detail.currentSource === "local"
        ? "critical"
        : detail.currentSource === "internet-fallback" || ["holdover", "unlocked"].includes(receiverStatus.gpsLockState)
          ? "warning"
          : "healthy";

      this.elements.sourceValue.textContent = sourceLabel;
      this.elements.sourceNote.textContent = `${detail.statusText}. ${freshness}. ${syncText}.`;
      this.elements.sourceCard.dataset.severity = sourceTone;
    }

    handleVisibilityChange() {
      if (document.hidden) {
        if (this.rafId) {
          global.cancelAnimationFrame(this.rafId);
          this.rafId = null;
        }
        return;
      }
      this.startRenderLoop();
    }

    cleanup() {
      if (this.rafId) {
        global.cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      document.removeEventListener("visibilitychange", this.boundVisibility);
      if (this.boundUnload) {
        window.removeEventListener("beforeunload", this.boundUnload);
      }
      this.gpsTimeSync.removeEventListener("gpstimeupdate", this.boundUpdate);
      this.gpsTimeSync.stopAutoSync();
      this.gpsTimeSync.stopStatusPolling();
    }
  }

  const boot = () => {
    new OfficialTimePage().init().catch((error) => {
      console.error("Official time page failed to initialize:", error);
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})(window);
