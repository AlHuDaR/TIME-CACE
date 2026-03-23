(function (global) {
  const {
    GPSTimeSync,
    APP_CONFIG,
    OMAN_DATE_TIME_FORMATTER,
    buildPtbAnalogClock,
    getOmanAnalogParts,
    syncAppLinks,
    applyFavicon,
    bootWhenDocumentReady,
    formatTimeParts,
    formatClockTime,
    formatStandardStatusLines,
  } = global.RAFOTimeApp || {};

  if (!GPSTimeSync || !APP_CONFIG || !OMAN_DATE_TIME_FORMATTER || !buildPtbAnalogClock || !getOmanAnalogParts || !syncAppLinks || !applyFavicon || !bootWhenDocumentReady || !formatTimeParts || !formatClockTime || !formatStandardStatusLines) {
    throw new Error("Official time page dependencies are unavailable. Ensure shared runtime modules load first.");
  }

  const OMAN_DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_CONFIG.timezone,
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const TIME_DIFF_THRESHOLDS = Object.freeze({
    second: 1000,
    minute: 60 * 1000,
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    year: 365 * 24 * 60 * 60 * 1000,
  });

  const TIME_DIFF_UNITS = Object.freeze([
    { limit: TIME_DIFF_THRESHOLDS.second, divisor: 1, suffix: "ms" },
    { limit: TIME_DIFF_THRESHOLDS.minute, divisor: TIME_DIFF_THRESHOLDS.second, suffix: "s" },
    { limit: TIME_DIFF_THRESHOLDS.hour, divisor: TIME_DIFF_THRESHOLDS.minute, suffix: "min" },
    { limit: TIME_DIFF_THRESHOLDS.day, divisor: TIME_DIFF_THRESHOLDS.hour, suffix: "h" },
    { limit: TIME_DIFF_THRESHOLDS.year, divisor: TIME_DIFF_THRESHOLDS.day, suffix: "d" },
    { limit: Number.POSITIVE_INFINITY, divisor: TIME_DIFF_THRESHOLDS.year, suffix: "y" },
  ]);

  function getTimeDiffSeverity(diffMs) {
    const absDiffMs = Math.abs(diffMs);

    if (absDiffMs < 1) {
      return "green";
    }

    if (absDiffMs < TIME_DIFF_THRESHOLDS.second) {
      return "yellow";
    }

    if (absDiffMs < TIME_DIFF_THRESHOLDS.day) {
      return "red";
    }

    return "critical";
  }

  function formatCompactTimeDiff(diffMs) {
    const absDiffMs = Math.abs(diffMs);
    const polarity = diffMs >= 0 ? "+" : "-";
    const unitConfig = TIME_DIFF_UNITS.find(({ limit }) => absDiffMs < limit) || TIME_DIFF_UNITS[TIME_DIFF_UNITS.length - 1];
    const rawValue = absDiffMs / unitConfig.divisor;
    const shouldUseDecimal = unitConfig.suffix !== "ms" && (rawValue < 10 || unitConfig.suffix === "d" || unitConfig.suffix === "y");
    const value = unitConfig.suffix === "ms"
      ? Math.round(rawValue).toString()
      : shouldUseDecimal
        ? rawValue.toFixed(1)
        : Math.round(rawValue).toString();

    return `${polarity}${value} ${unitConfig.suffix}`;
  }

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
        ptbClockSvg: document.getElementById("officialPtbClockSvg"),
        hourHand: null,
        minuteHand: null,
        secondHand: null,
        secondHandGroup: null,
        analogDateText: null,
        analogTimeText: null,
        analogTimeZoneText: null,
      };

      this.gpsTimeSync = new GPSTimeSync();
      this.rafId = null;
      this.boundVisibility = () => this.handleVisibilityChange();
      this.boundUpdate = (event) => this.applyStatus(event.detail);
    }

    async init() {
      const url = new URL(window.location.href);
      if (url.searchParams.has("mode")) {
        url.searchParams.delete("mode");
        window.location.replace(url.toString());
        return;
      }

      syncAppLinks();
      this.buildAnalogDial();
      applyFavicon();
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


    buildAnalogDial() {
      Object.assign(this.elements, buildPtbAnalogClock(this.elements.ptbClockSvg));
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
      const omanTime = formatTimeParts(omanParts.hour, omanParts.minute, omanParts.second);

      this.elements.digitalTime.textContent = omanTime;
      this.elements.dateLine.textContent = `(UTC +04:00), ${OMAN_DATE_FORMATTER.format(syncedNow)}`;
      this.elements.utcTime.textContent = utcTime;
      this.elements.omanTime.textContent = omanTime;
      this.elements.deviceTime.textContent = deviceTime;
      this.updateDifference(syncedNow, deviceNow);
      this.updateAnalogClock(omanParts, syncedNow.getUTCMilliseconds());
    }

    getOmanParts(date) {
      return getOmanAnalogParts(date);
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
      const severity = getTimeDiffSeverity(diffMs);
      const displayValue = formatCompactTimeDiff(diffMs);

      this.elements.differenceValue.textContent = displayValue;
      this.elements.differenceNote.textContent = severity === "green"
        ? "Healthy: the device and synchronized reference are effectively aligned."
        : severity === "yellow"
          ? "Caution: the offset is measurable but still below one second."
          : severity === "red"
            ? "Serious: the offset is at least one second and needs attention."
            : "Major fault: the offset is at least one day and should be treated as critical.";
      this.elements.differenceCard.dataset.severity = severity;
    }

    updateAnalogClock(omanParts, milliseconds) {
      const secondProgress = omanParts.second + milliseconds / 1000;
      const minuteProgress = omanParts.minute + secondProgress / 60;
      const hourProgress = (omanParts.hour % 12) + minuteProgress / 60;

      this.elements.secondHandGroup?.setAttribute("transform", `rotate(${secondProgress * 6} 400 400)`);
      this.elements.minuteHand?.setAttribute("transform", `rotate(${minuteProgress * 6} 400 400)`);
      this.elements.hourHand?.setAttribute("transform", `rotate(${hourProgress * 30} 400 400)`);

      if (this.elements.analogTimeText) {
        this.elements.analogTimeText.textContent = formatTimeParts(omanParts.hour, omanParts.minute, omanParts.second);
      }

      if (this.elements.analogDateText) {
        this.elements.analogDateText.textContent = omanParts.date;
      }
    }

    applyStatus(detail) {
      if (!detail) {
        return;
      }

      const receiverStatus = detail.receiverStatus || this.gpsTimeSync.getReceiverStatus();
      const [sourceLine, statusLine] = formatStandardStatusLines(detail);
      const sourceTone = detail.currentSource === "gps-xli"
        ? "healthy"
        : ["local-clock", "browser-local-clock", ""].includes(String(detail.currentSource || ""))
          ? "critical"
          : "warning";

      this.elements.sourceValue.textContent = sourceLine;
      this.elements.sourceNote.textContent = statusLine;
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

  bootWhenDocumentReady(boot);
})(window);
