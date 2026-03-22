(function (global) {
  const { buildPtbAnalogClock, getOmanAnalogParts, syncAppLinks, applyFavicon, bootWhenDocumentReady } = global.RAFOTimeApp;

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
      gpsStatusBar: document.getElementById("gpsStatusBar"),
      monitoringDashboard: document.getElementById("monitoringDashboard"),
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
    syncAppLinks();
    applyFavicon();
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
    Object.assign(this.elements, buildPtbAnalogClock(this.analogDial));
  }

  getOmanParts(now) {
    return getOmanAnalogParts(now);
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

  bootWhenDocumentReady(bootClock);

  global.RAFOTimeApp.PrecisionClock = PrecisionClock;
})(window);
