(function (global) {
  const { OMAN_ANALOG_PARTS_FORMATTER } = global.RAFOTimeApp;

class PrecisionClock {
  constructor() {
    this.elements = {
      hours: document.getElementById("hours"),
      minutes: document.getElementById("minutes"),
      seconds: document.getElementById("seconds"),
      milliseconds: document.getElementById("milliseconds"),
      millisecondsTile: document.getElementById("millisecondsTile"),
      dateLine: document.getElementById("dateLine"),
      syncStatus: document.getElementById("syncStatus"),
      primarySourceDescription: document.getElementById("primarySourceDescription"),
      primarySourceNote: document.getElementById("primarySourceNote"),
      statusConsistencyHint: document.getElementById("statusConsistencyHint"),
      ptbClockSvg: document.getElementById("ptbClockSvg"),
      hourHand: null,
      minuteHand: null,
      secondHand: null,
      secondHandGroup: null,
      analogDateText: null,
      analogTimeText: null,
      driftMonitor: document.getElementById("driftMonitor"),
      digitalClock: document.getElementById("digitalClock"),
      analogClock: document.getElementById("analogClock"),
      digitalModeBtn: document.getElementById("digitalModeBtn"),
      analogModeBtn: document.getElementById("analogModeBtn"),
      analogOnlyBtn: document.getElementById("analogOnlyBtn"),
      backToDigitalBtn: document.getElementById("backToDigitalBtn"),
      darkModeBtn: document.getElementById("darkModeBtn"),
      precisionToggleBtn: document.getElementById("precisionToggleBtn"),
      sourceIndicator: document.getElementById("sourceIndicator"),
      lockStatus: document.getElementById("lockStatus"),
      lockPulse: document.getElementById("lockPulse"),
      lastSyncTime: document.getElementById("lastSyncTime"),
      offsetDisplay: document.getElementById("offsetDisplay"),
      statusFreshness: document.getElementById("statusFreshness"),
      digitalOnlyControls: document.getElementById("digitalOnlyControls"),
      setTimeComputerBtn: document.getElementById("setTimeComputerBtn"),
      setTimeInternetBtn: document.getElementById("setTimeInternetBtn"),
      fallbackInfoCard: document.getElementById("fallbackInfoCard"),
      fallbackInfoCloseBtn: document.getElementById("fallbackInfoCloseBtn"),
      fallbackInfoHeading: document.getElementById("fallbackInfoHeading"),
      fallbackInfoSubheading: document.getElementById("fallbackInfoSubheading"),
      fallbackInfoSource: document.getElementById("fallbackInfoSource"),
      fallbackInfoDate: document.getElementById("fallbackInfoDate"),
      fallbackInfoTime: document.getElementById("fallbackInfoTime"),
      fallbackInfoStatus: document.getElementById("fallbackInfoStatus"),
      dashboardSummaryText: document.getElementById("dashboardSummaryText"),
      dashboardSeverityBadge: document.getElementById("dashboardSeverityBadge"),
      dashboardIntegrityBadge: document.getElementById("dashboardIntegrityBadge"),
      dashboardDataStateBadge: document.getElementById("dashboardDataStateBadge"),
      dashboardSummaryBadge: document.getElementById("dashboardSummaryBadge"),
      monitorReceiverReachabilityValue: document.getElementById("monitorReceiverReachabilityValue"),
      monitorReceiverReachabilityBadge: document.getElementById("monitorReceiverReachabilityBadge"),
      monitorReceiverReachabilityNote: document.getElementById("monitorReceiverReachabilityNote"),
      monitorGpsLockValue: document.getElementById("monitorGpsLockValue"),
      monitorGpsLockBadge: document.getElementById("monitorGpsLockBadge"),
      monitorGpsLockNote: document.getElementById("monitorGpsLockNote"),
      monitorActiveSourceValue: document.getElementById("monitorActiveSourceValue"),
      monitorActiveSourceBadge: document.getElementById("monitorActiveSourceBadge"),
      monitorActiveSourceNote: document.getElementById("monitorActiveSourceNote"),
      monitorTimingIntegrityValue: document.getElementById("monitorTimingIntegrityValue"),
      monitorTimingIntegrityBadge: document.getElementById("monitorTimingIntegrityBadge"),
      monitorTimingIntegrityNote: document.getElementById("monitorTimingIntegrityNote"),
      monitorSystemStatusValue: document.getElementById("monitorSystemStatusValue"),
      monitorSystemStatusBadge: document.getElementById("monitorSystemStatusBadge"),
      monitorSystemStatusNote: document.getElementById("monitorSystemStatusNote"),
      monitorLastSyncValue: document.getElementById("monitorLastSyncValue"),
      monitorLastSyncBadge: document.getElementById("monitorLastSyncBadge"),
      monitorLastSyncNote: document.getElementById("monitorLastSyncNote"),
      monitorCommunicationValue: document.getElementById("monitorCommunicationValue"),
      monitorCommunicationBadge: document.getElementById("monitorCommunicationBadge"),
      monitorCommunicationNote: document.getElementById("monitorCommunicationNote"),
      monitorFallbackValue: document.getElementById("monitorFallbackValue"),
      monitorFallbackBadge: document.getElementById("monitorFallbackBadge"),
      monitorFallbackNote: document.getElementById("monitorFallbackNote"),
      monitorLastKnownGoodValue: document.getElementById("monitorLastKnownGoodValue"),
      monitorLastKnownGoodBadge: document.getElementById("monitorLastKnownGoodBadge"),
      monitorLastKnownGoodNote: document.getElementById("monitorLastKnownGoodNote"),
      monitorErrorValue: document.getElementById("monitorErrorValue"),
      monitorErrorBadge: document.getElementById("monitorErrorBadge"),
      monitorErrorNote: document.getElementById("monitorErrorNote"),
      dashboardStatusText: document.getElementById("dashboardStatusText"),
      dashboardErrorText: document.getElementById("dashboardErrorText"),
      dashboardEventList: document.getElementById("dashboardEventList"),
    };

    this.analogDial = this.elements.ptbClockSvg;
    this.gpsTimeSync = new global.RAFOTimeApp.GPSTimeSync();
    this.syncManager = new global.RAFOTimeApp.SyncManager(this.gpsTimeSync);
    this.messageCenter = global.appMessageCenter || new global.RAFOTimeApp.MessageCenter(this.elements);
    global.appMessageCenter = this.messageCenter;
    this.gpsDisplay = new global.RAFOTimeApp.GPSDisplayManager(this.elements, this.gpsTimeSync, this.syncManager, this.messageCenter);
    this.displayManager = new global.RAFOTimeApp.DisplayManager(this.elements, this.syncManager, this.gpsTimeSync);
    this.inputHandler = new global.RAFOTimeApp.InputHandler(this.elements, this.displayManager, this.gpsTimeSync);
    this.rafId = null;
    this.boundVisibility = () => this.handleVisibilityChange();
    this.boundUnload = () => this.cleanup();
  }

  async init() {
    this.applyFavicon();
    this.handleLogoFallback();
    this.buildAnalogDial();
    this.displayManager.initVisualPreferences();
    this.displayManager.setPrecisionVisibility(false);

    await this.gpsTimeSync.init();
    this.gpsDisplay.init();
    this.syncManager.markSuccessfulSync();

    const urlMode = new URLSearchParams(window.location.search).get("mode");
    if (urlMode === "analog-only") {
      this.displayManager.setAnalogOnlyMode();
    } else if (urlMode === "analog") {
      this.displayManager.setMode("analog");
    } else {
      this.displayManager.setMode("digital");
    }

    this.gpsTimeSync.addEventListener("gpstimeupdate", () => {
      this.syncManager.markSuccessfulSync();
      this.gpsDisplay.refreshLiveStatus(true);
    });

    this.inputHandler.init();
    document.addEventListener("visibilitychange", this.boundVisibility);
    window.addEventListener("beforeunload", this.boundUnload);
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

  handleLogoFallback() {
    const logos = Array.from(document.querySelectorAll("[data-logo]"));
    const probe = new Image();
    probe.onerror = () => {
      document.body.classList.add("no-logo");
      const placeholder = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80'%3E%3Crect width='80' height='80' rx='10' fill='%231f7ea1'/%3E%3Ctext x='40' y='46' fill='white' font-size='13' text-anchor='middle' font-family='Arial'%3ERAFO%3C/text%3E%3C/svg%3E";
      logos.forEach((img) => {
        img.src = placeholder;
        img.alt = "Logo placeholder";
      });
    };
    probe.src = "images/cal logo.png";
  }

  buildAnalogDial() {
    const svg = this.analogDial;
    const ns = "http://www.w3.org/2000/svg";
    const make = (tag, attrs = {}) => {
      const el = document.createElementNS(ns, tag);
      Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, String(value)));
      return el;
    };

    svg.replaceChildren();

    const defs = make("defs");
    const logoShadow = make("filter", { id: "logoShadow", x: "-40%", y: "-40%", width: "180%", height: "180%" });
    logoShadow.append(make("feDropShadow", { dx: "1.4", dy: "1.6", stdDeviation: "2", "flood-color": "#0f4358", "flood-opacity": "0.55" }));
    defs.append(logoShadow);
    svg.append(defs);

    svg.append(make("rect", { x: 0, y: 0, width: 800, height: 800, fill: "#e8e8e8" }));
    svg.append(make("circle", { cx: 400, cy: 400, r: 380, fill: "none", stroke: "#1a6b8c", "stroke-width": 6 }));

    const tickGroup = make("g", { id: "ticks" });
    for (let i = 0; i < 60; i += 1) {
      const angle = ((i * 6 - 90) * Math.PI) / 180;
      const isHour = i % 5 === 0;
      const outerRadius = 370;
      const length = isHour ? 25 : 15;
      const innerRadius = outerRadius - length;
      const x1 = 400 + innerRadius * Math.cos(angle);
      const y1 = 400 + innerRadius * Math.sin(angle);
      const x2 = 400 + outerRadius * Math.cos(angle);
      const y2 = 400 + outerRadius * Math.sin(angle);
      tickGroup.append(make("line", {
        x1: x1.toFixed(3),
        y1: y1.toFixed(3),
        x2: x2.toFixed(3),
        y2: y2.toFixed(3),
        stroke: isHour ? "#1a6b8c" : "#2a7a98",
        "stroke-width": isHour ? 8 : 4,
        "stroke-linecap": "round",
      }));
    }
    svg.append(tickGroup);

    const numbers = make("g", { id: "numbers", fill: "#1a6b8c", "font-family": "Arial, Helvetica, sans-serif", "font-size": 60, "text-anchor": "middle", "dominant-baseline": "middle" });
    for (let i = 1; i <= 12; i += 1) {
      const angle = ((i * 30 - 90) * Math.PI) / 180;
      const x = 400 + 300 * Math.cos(angle);
      const y = 400 + 300 * Math.sin(angle);
      const text = make("text", { x: x.toFixed(3), y: y.toFixed(3) });
      text.textContent = String(i);
      numbers.append(text);
    }
    svg.append(numbers);

    const dateText = make("text", { x: 400, y: 160, fill: "#1a6b8c", "font-size": 26, "font-family": "Arial, Helvetica, sans-serif", "text-anchor": "middle", "font-weight": "bold" });
    dateText.textContent = "06.03.2026";
    svg.append(dateText);

    const timeText = make("text", { x: 400, y: 655, fill: "#1a6b8c", "font-size": 25, "font-weight": 700, "font-family": "Arial, Helvetica, sans-serif", "text-anchor": "middle" });
    timeText.textContent = "01:36:21";
    svg.append(timeText);

    const tzText = make("text", { x: 400, y: 560, fill: "#1a6b8c", "font-size": 17, "font-family": "Arial, Helvetica, sans-serif", "text-anchor": "middle", "font-weight": "bold" });
    tzText.textContent = "MCT (UTC+04:00)";
    svg.append(tzText);

    const handsGroup = make("g", { id: "hands" });
    const hourHand = make("line", { x1: 400, y1: 400, x2: 400, y2: 230, stroke: "#1a6b8c", "stroke-width": 14, "stroke-linecap": "round", opacity: 0.86 });
    const minuteHand = make("line", { x1: 400, y1: 400, x2: 400, y2: 170, stroke: "#1f7699", "stroke-width": 10, "stroke-linecap": "round", opacity: 0.84 });
    const secondHandGroup = make("g");
    const secondHand = make("line", { x1: 400, y1: 435, x2: 400, y2: 140, stroke: "#d32f2f", "stroke-width": 3, "stroke-linecap": "round", opacity: 0.94 });
    const counterWeight = make("circle", { cx: 400, cy: 420, r: 10, fill: "#d32f2f" });
    secondHandGroup.append(secondHand, counterWeight);
    handsGroup.append(hourHand, minuteHand, secondHandGroup);
    svg.append(handsGroup);

    svg.append(make("circle", { cx: 400, cy: 400, r: 15, fill: "#d32f2f" }));
    svg.append(make("circle", { cx: 400, cy: 400, r: 5, fill: "#ffffff" }));

    this.elements.hourHand = hourHand;
    this.elements.minuteHand = minuteHand;
    this.elements.secondHand = secondHand;
    this.elements.secondHandGroup = secondHandGroup;
    this.elements.analogDateText = dateText;
    this.elements.analogTimeText = timeText;
  }

  getOmanParts(now) {
    const parts = OMAN_ANALOG_PARTS_FORMATTER.formatToParts(now);
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return {
      hour: Number(map.hour),
      minute: Number(map.minute),
      second: Number(map.second),
      date: `${map.day}.${map.month}.${map.year}`,
    };
  }

  startRenderLoop() {
    if (this.rafId) {
      return;
    }

    const renderFrame = () => {
      if (!this.displayManager.paused) {
        const now = this.gpsTimeSync.getNow();
        const oman = this.getOmanParts(now);
        this.displayManager.updateDigital(oman, now);
        this.displayManager.updateAnalog(oman, now);
        this.displayManager.updateDrift(now);
      }

      this.gpsDisplay.refreshLiveStatus();
      this.rafId = window.requestAnimationFrame(renderFrame);
    };

    this.rafId = window.requestAnimationFrame(renderFrame);
  }

  handleVisibilityChange() {
    if (document.hidden) {
      if (this.rafId) {
        window.cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      return;
    }
    this.startRenderLoop();
  }

  cleanup() {
    if (this.rafId) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    document.removeEventListener("visibilitychange", this.boundVisibility);
    window.removeEventListener("beforeunload", this.boundUnload);
    this.inputHandler.cleanup();
    this.syncManager.cleanup();
    this.gpsTimeSync.stopAutoSync();
    this.gpsTimeSync.stopStatusPolling();
  }
}



  const bootClock = () => {
    new PrecisionClock().init().catch((error) => {
      console.error("Clock initialization failed:", error);
      global.showNotification(`Initialization failed: ${error.message}`, "error", 6000);
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootClock, { once: true });
  } else {
    bootClock();
  }

  global.RAFOTimeApp.PrecisionClock = PrecisionClock;
})(window);
