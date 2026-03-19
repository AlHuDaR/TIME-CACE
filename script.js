const APP_CONFIG = Object.freeze({
  timezone: "Asia/Muscat",
  timezoneLabel: "Gulf Standard Time (GST, UTC+04:00)",
  modeTransitionMs: 260,
  syncIntervalMs: 30000,
  localDevPorts: Object.freeze([3000]),
  localhostNames: Object.freeze(["localhost", "127.0.0.1"]),
  statusLabels: Object.freeze({
    success: "Success",
    error: "Error",
    warning: "Warning",
    info: "Information",
  }),
});

const OMAN_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_CONFIG.timezone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const OMAN_DATE_LINE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_CONFIG.timezone,
  weekday: "long",
  day: "2-digit",
  month: "long",
  year: "numeric",
});

const OMAN_ANALOG_PARTS_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_CONFIG.timezone,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour12: false,
});

function resolveApiBaseUrl() {
  const configured = window.APP_CONFIG?.API_BASE_URL;
  if (typeof configured === "string" && configured.trim()) {
    return configured.replace(/\/$/, "");
  }

  const { origin, hostname } = window.location;
  if (APP_CONFIG.localhostNames.includes(hostname)) {
    return `${origin}/api`;
  }

  return "/api";
}

class NotificationManager {
  constructor() {
    this.container = this.createContainer();
    this.activeNotifications = new Map();
  }

  createContainer() {
    let container = document.getElementById("notification-container");
    if (container) {
      return container;
    }

    container = document.createElement("div");
    container.id = "notification-container";
    document.body.appendChild(container);
    return container;
  }

  show(message, type = "info", duration = 5000) {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const notification = document.createElement("article");
    notification.className = `notification notification-${type}`;

    const icon = document.createElement("div");
    icon.className = "notification-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = {
      success: "✓",
      error: "✕",
      warning: "⚠",
      info: "ℹ",
    }[type] || "ℹ";

    const content = document.createElement("div");
    content.className = "notification-content";

    const title = document.createElement("div");
    title.className = "notification-title";
    title.textContent = APP_CONFIG.statusLabels[type] || APP_CONFIG.statusLabels.info;

    const body = document.createElement("div");
    body.className = "notification-message";
    body.innerHTML = message;

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "notification-close";
    closeButton.setAttribute("aria-label", "Close notification");
    closeButton.textContent = "×";
    closeButton.addEventListener("click", () => this.close(id));

    content.append(title, body);
    notification.append(icon, content, closeButton);

    if (duration > 0) {
      const progress = document.createElement("div");
      progress.className = "notification-progress";
      progress.style.animationDuration = `${duration}ms`;
      notification.append(progress);
    }

    this.container.appendChild(notification);
    this.activeNotifications.set(id, notification);

    if (duration > 0) {
      window.setTimeout(() => this.close(id), duration);
    }

    return id;
  }

  close(id) {
    const notification = this.activeNotifications.get(id);
    if (!notification) {
      return;
    }

    notification.classList.add("notification-exit");
    window.setTimeout(() => {
      notification.remove();
      this.activeNotifications.delete(id);
    }, 220);
  }
}

class GPSTimeSync {
  constructor() {
    this.apiBaseUrl = resolveApiBaseUrl();
    this.notifications = window.notificationManager || new NotificationManager();
    this.eventTarget = new EventTarget();
    this.syncInterval = null;
    this.syncInFlight = null;
    this.hasShownInitialSync = false;
    this.timeOffset = 0;
    this.lastSyncTime = null;
    this.lastSyncTimestamp = null;
    this.currentState = this.createState({ currentSource: "local" });
  }

  createState(overrides = {}) {
    return {
      backendOnline: false,
      receiverReachable: false,
      loginOk: false,
      isLocked: false,
      statusText: "Using local computer time",
      currentSource: "local",
      lastError: null,
      date: null,
      time: null,
      timestamp: Date.now(),
      raw: null,
      sourceLabel: "Local computer time",
      ...overrides,
    };
  }

  async init() {
    await this.syncTime();
    this.startAutoSync();
    return this;
  }

  async syncTime() {
    if (this.syncInFlight) {
      return this.syncInFlight;
    }

    this.syncInFlight = this.performSync().finally(() => {
      this.syncInFlight = null;
    });

    return this.syncInFlight;
  }

  async performSync() {
    let nextState = null;

    try {
      const gpsResult = await this.fetchJson("/time");
      if (gpsResult.success && gpsResult.timestamp) {
        nextState = this.createState({
          backendOnline: true,
          receiverReachable: Boolean(gpsResult.receiverReachable ?? true),
          loginOk: Boolean(gpsResult.loginOk ?? true),
          isLocked: Boolean(gpsResult.isLocked),
          statusText: gpsResult.statusText || (gpsResult.isLocked ? "GPS receiver locked" : "GPS receiver reachable but not locked"),
          currentSource: gpsResult.currentSource || (gpsResult.isLocked ? "gps-locked" : "gps-unlocked"),
          lastError: gpsResult.lastError || null,
          date: gpsResult.date,
          time: gpsResult.time,
          timestamp: gpsResult.timestamp,
          raw: gpsResult.raw || null,
          sourceLabel: gpsResult.currentSourceLabel || (gpsResult.isLocked ? "GPS receiver locked" : "GPS receiver reachable, unlock state"),
        });
      }
    } catch (error) {
      nextState = this.createState({
        backendOnline: false,
        currentSource: "local",
        statusText: `Backend unavailable: ${error.message}`,
        lastError: error.message,
      });
    }

    if (!nextState || nextState.currentSource === "local") {
      try {
        const ntpResult = await this.fetchJson("/time/ntp");
        if (ntpResult.success && ntpResult.timestamp) {
          nextState = this.createState({
            backendOnline: true,
            receiverReachable: Boolean(nextState?.receiverReachable),
            loginOk: Boolean(nextState?.loginOk),
            isLocked: false,
            statusText: "Using Internet time fallback via backend",
            currentSource: "internet-fallback",
            lastError: nextState?.lastError || null,
            date: ntpResult.date,
            time: ntpResult.time,
            timestamp: ntpResult.timestamp,
            raw: null,
            sourceLabel: "Internet fallback",
          });
        }
      } catch (error) {
        if (nextState) {
          nextState.lastError = nextState.lastError || error.message;
        }
      }
    }

    if (!nextState || nextState.currentSource === "local") {
      const localResult = this.getLocalTime();
      nextState = this.createState({
        ...nextState,
        backendOnline: Boolean(nextState?.backendOnline),
        receiverReachable: Boolean(nextState?.receiverReachable),
        loginOk: Boolean(nextState?.loginOk),
        isLocked: false,
        statusText: nextState?.backendOnline
          ? "Using local computer time because backend fallbacks are unavailable"
          : "Using local computer time because backend is unavailable",
        currentSource: "local",
        lastError: nextState?.lastError || "No remote time source available",
        ...localResult,
        sourceLabel: "Local computer time",
      });
    }

    this.applyState(nextState);
    this.dispatchUpdate();
    this.maybeShowInitialNotification();
    return this.currentState;
  }

  async fetchJson(path) {
    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      headers: { Accept: "application/json" },
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }

    if (!response.ok) {
      const errorMessage = payload?.error || payload?.statusText || `Request failed with ${response.status}`;
      throw new Error(errorMessage);
    }

    return payload;
  }

  getLocalTime() {
    const now = new Date();
    const parts = OMAN_DATE_TIME_FORMATTER.formatToParts(now);
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));

    return {
      success: true,
      timestamp: now.getTime(),
      date: `${map.month}/${map.day}/${map.year}`,
      time: `${map.hour}:${map.minute}:${map.second}`,
    };
  }

  applyState(state) {
    const localNow = Date.now();
    this.currentState = state;
    this.timeOffset = state.timestamp - localNow;
    this.lastSyncTime = new Date();
    this.lastSyncTimestamp = Date.now();
  }

  maybeShowInitialNotification() {
    if (this.hasShownInitialSync) {
      return;
    }

    const { currentSource, date, time, statusText } = this.currentState;
    const type = currentSource === "gps-locked"
      ? "success"
      : currentSource === "gps-unlocked"
        ? "warning"
        : currentSource === "internet-fallback"
          ? "info"
          : "warning";

    this.notifications.show(
      [
        `<strong>Source:</strong> ${this.getSourceDisplayName(currentSource)}`,
        date ? `<strong>Date:</strong> ${date}` : null,
        time ? `<strong>Time:</strong> ${time}` : null,
        `<strong>Status:</strong> ${statusText}`,
      ].filter(Boolean).join("<br>"),
      type,
      6000,
    );

    this.hasShownInitialSync = true;
  }

  dispatchUpdate() {
    const detail = {
      ...this.currentState,
      offset: this.timeOffset,
      lastSyncTimestamp: this.lastSyncTimestamp,
    };

    const event = new CustomEvent("gpstimeupdate", { detail });
    this.eventTarget.dispatchEvent(event);
    window.dispatchEvent(event);
  }

  getSourceDisplayName(source = this.currentState.currentSource) {
    return {
      "gps-locked": "GPS RECEIVER",
      "gps-unlocked": "GPS RECEIVER",
      "internet-fallback": "INTERNET/NTP",
      local: "LOCAL TIME",
    }[source] || source.toUpperCase();
  }

  getNow() {
    return new Date(Date.now() + this.timeOffset);
  }

  getCurrentState() {
    return this.currentState;
  }

  getCurrentSource() {
    return this.currentState.currentSource;
  }

  isGPSLocked() {
    return this.currentState.currentSource === "gps-locked" && this.currentState.isLocked;
  }

  startAutoSync() {
    if (this.syncInterval) {
      return;
    }

    this.syncInterval = window.setInterval(() => {
      this.syncTime();
    }, APP_CONFIG.syncIntervalMs);
  }

  stopAutoSync() {
    if (this.syncInterval) {
      window.clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  addEventListener(type, callback) {
    this.eventTarget.addEventListener(type, callback);
  }

  removeEventListener(type, callback) {
    this.eventTarget.removeEventListener(type, callback);
  }
}

class SyncManager {
  constructor(statusElement, gpsTimeSync) {
    this.statusElement = statusElement;
    this.gpsTimeSync = gpsTimeSync;
    this.hasSuccessfulSync = false;
  }

  getNowFromSyncedClock() {
    return this.gpsTimeSync.getNow();
  }

  getDrift(now = Date.now()) {
    return now - this.getNowFromSyncedClock().getTime();
  }

  getRelativeLastSync() {
    const { lastSyncTimestamp } = this.gpsTimeSync;
    if (!lastSyncTimestamp) {
      return "never";
    }

    const diff = Math.max(0, Date.now() - lastSyncTimestamp);
    const minutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    return `${minutes}m ${seconds}s ago`;
  }

  formatStatus() {
    const state = this.gpsTimeSync.getCurrentState();
    const source = this.gpsTimeSync.getSourceDisplayName(state.currentSource);
    return `Status: ${state.statusText} | Source: ${source} | Last sync: ${this.getRelativeLastSync()}`;
  }

  markSuccessfulSync() {
    this.hasSuccessfulSync = true;
    const currentSource = this.gpsTimeSync.getCurrentSource();
    this.statusElement.classList.toggle("warn", currentSource !== "gps-locked");
    this.statusElement.textContent = this.formatStatus();
  }

  markWarning(message) {
    this.statusElement.classList.add("warn");
    this.statusElement.textContent = `Status: ${message}`;
  }

  cleanup() {}
}

class GPSDisplayManager {
  constructor(elements, gpsTimeSync) {
    this.elements = elements;
    this.gpsTimeSync = gpsTimeSync;
    this.sourceClasses = {
      "gps-locked": "source-gps",
      "gps-unlocked": "source-gps-warn",
      "internet-fallback": "source-internet",
      local: "source-local",
    };
  }

  init() {
    this.gpsTimeSync.addEventListener("gpstimeupdate", (event) => {
      this.updateDisplay(event.detail);
    });

    this.updateDisplay({
      ...this.gpsTimeSync.getCurrentState(),
      offset: this.gpsTimeSync.timeOffset,
      lastSyncTimestamp: this.gpsTimeSync.lastSyncTimestamp,
    });
  }

  updateDisplay(data) {
    const sourceClass = this.sourceClasses[data.currentSource] || "source-local";
    this.elements.sourceIndicator.className = `source-badge ${sourceClass}`;
    this.elements.sourceIndicator.textContent = this.gpsTimeSync.getSourceDisplayName(data.currentSource);

    const lockText = this.getLockText(data);
    this.elements.lockStatus.textContent = lockText;
    this.elements.lockPulse.classList.toggle("locked", data.currentSource === "gps-locked");
    this.elements.lockPulse.classList.toggle("warning", data.currentSource === "gps-unlocked");

    if (data.lastSyncTimestamp) {
      this.elements.lastSyncTime.textContent = `Last sync: ${new Date(data.lastSyncTimestamp).toLocaleTimeString()}`;
    }

    this.elements.offsetDisplay.textContent = `Offset: ${Math.round(data.offset)} ms`;

    const sourceDescription = this.getPrimarySourceDescription(data);
    const sourceNote = this.getPrimarySourceNote(data);
    this.elements.primarySourceDescription.textContent = sourceDescription;
    this.elements.primarySourceNote.textContent = sourceNote;
    this.elements.syncStatus.textContent = `Status: ${data.statusText}`;
    this.elements.syncStatus.classList.toggle("warn", data.currentSource !== "gps-locked");
  }

  getLockText(data) {
    if (data.currentSource === "gps-locked") {
      return "GPS receiver locked";
    }
    if (data.currentSource === "gps-unlocked") {
      return "GPS receiver reachable but unlocked";
    }
    if (data.currentSource === "internet-fallback") {
      return "Receiver unavailable — Internet fallback active";
    }
    return "Receiver unavailable — local fallback active";
  }

  getPrimarySourceDescription(data) {
    if (data.currentSource === "gps-locked") {
      return "Primary source: Symmetricom XLi receiver is reachable, authenticated, and locked.";
    }
    if (data.currentSource === "gps-unlocked") {
      return "Primary source preferred, but the Symmetricom XLi receiver is reachable without current GPS lock.";
    }
    if (data.currentSource === "internet-fallback") {
      return "Primary GPS receiver is not providing locked time, so Internet time fallback is active via the backend.";
    }
    return "Remote time sources are unavailable, so the display is currently using local computer time.";
  }

  getPrimarySourceNote(data) {
    const parts = [];
    parts.push(`Runtime source: ${this.gpsTimeSync.getSourceDisplayName(data.currentSource)}.`);
    if (data.receiverReachable) {
      parts.push(data.loginOk ? "Receiver login succeeded." : "Receiver reachable but login failed.");
    } else {
      parts.push("Receiver is not currently reachable.");
    }
    if (data.lastError) {
      parts.push(`Last error: ${data.lastError}`);
    }
    return parts.join(" ");
  }
}

class DisplayManager {
  constructor(elements, syncManager, gpsTimeSync) {
    this.elements = elements;
    this.syncManager = syncManager;
    this.gpsTimeSync = gpsTimeSync;
    this.mode = "digital";
    this.showMilliseconds = this.resolveInitialPrecisionMode();
    this.darkMode = this.resolveInitialDarkMode();
    this.paused = false;
    this.lastDriftSecond = -1;
    this.lastRenderedDigital = {};
    this.lastRenderedAnalog = {};
  }

  resolveInitialDarkMode() {
    const stored = localStorage.getItem("darkMode");
    if (stored !== null) {
      return stored === "1";
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  resolveInitialPrecisionMode() {
    const stored = localStorage.getItem("precisionMode");
    if (stored !== null) {
      return stored === "1";
    }
    return true;
  }

  initVisualPreferences() {
    this.applyDarkMode(this.darkMode);
    this.applyPrecisionMode(this.showMilliseconds);
  }

  applyDarkMode(enabled) {
    this.darkMode = enabled;
    document.body.classList.toggle("dark-mode", enabled);
    this.elements.darkModeBtn.textContent = enabled ? "Light mode" : "Dark mode";
    this.elements.darkModeBtn.setAttribute("aria-pressed", String(enabled));
    localStorage.setItem("darkMode", enabled ? "1" : "0");
  }

  toggleDarkMode() {
    this.applyDarkMode(!this.darkMode);
  }

  togglePrecisionMode() {
    this.applyPrecisionMode(!this.showMilliseconds);
  }

  togglePause() {
    this.paused = !this.paused;
  }

  updateUrl(mode) {
    const url = new URL(window.location.href);
    url.searchParams.set("mode", mode);
    window.history.replaceState({}, "", url);
  }

  applyPrecisionMode(enabled) {
    this.showMilliseconds = enabled;
    this.elements.millisecondsTile.classList.toggle("hidden", !enabled);
    this.elements.precisionToggleBtn.textContent = `Precision: ${enabled ? "ON" : "OFF"}`;
    this.elements.precisionToggleBtn.setAttribute("aria-pressed", String(enabled));
    localStorage.setItem("precisionMode", enabled ? "1" : "0");
  }

  setPrecisionVisibility(isVisible) {
    this.elements.precisionToggleBtn.classList.toggle("hidden", !isVisible);
  }

  setDigitalControlsVisibility(isVisible) {
    this.elements.digitalOnlyControls.classList.toggle("hidden", !isVisible);
  }

  showSection(section) {
    section.classList.remove("hidden", "is-fading");
    section.classList.add("is-visible");
  }

  hideSection(section) {
    section.classList.add("is-fading");
    section.classList.remove("is-visible");
    window.setTimeout(() => {
      section.classList.add("hidden");
      section.classList.remove("is-fading");
    }, APP_CONFIG.modeTransitionMs);
  }

  setMode(mode) {
    this.mode = mode;
    document.body.classList.remove("analog-only", "old-style");
    this.updateUrl(mode);

    const isDigital = mode === "digital";
    if (isDigital) {
      this.showSection(this.elements.digitalClock);
      this.hideSection(this.elements.analogClock);
      this.setPrecisionVisibility(true);
      this.setDigitalControlsVisibility(true);
    } else {
      document.body.classList.add("old-style");
      this.showSection(this.elements.analogClock);
      this.hideSection(this.elements.digitalClock);
      this.setPrecisionVisibility(true);
      this.setDigitalControlsVisibility(false);
    }

    this.elements.digitalModeBtn.classList.toggle("active", isDigital);
    this.elements.analogModeBtn.classList.toggle("active", mode === "analog");
    this.elements.analogOnlyBtn.classList.toggle("active", false);
    this.elements.digitalModeBtn.setAttribute("aria-pressed", String(isDigital));
    this.elements.analogModeBtn.setAttribute("aria-pressed", String(mode === "analog"));
    this.elements.analogOnlyBtn.setAttribute("aria-pressed", "false");
  }

  setAnalogOnlyMode() {
    this.mode = "analog-only";
    this.updateUrl("analog-only");
    document.body.classList.remove("old-style");
    document.body.classList.add("analog-only");
    this.elements.digitalClock.classList.add("hidden");
    this.elements.analogClock.classList.remove("hidden");
    this.elements.digitalModeBtn.classList.remove("active");
    this.elements.analogModeBtn.classList.remove("active");
    this.elements.analogOnlyBtn.classList.add("active");
    this.elements.digitalModeBtn.setAttribute("aria-pressed", "false");
    this.elements.analogModeBtn.setAttribute("aria-pressed", "false");
    this.elements.analogOnlyBtn.setAttribute("aria-pressed", "true");
    this.setPrecisionVisibility(true);
    this.setDigitalControlsVisibility(false);
  }

  updateDigital(oman, now) {
    const digitalState = {
      hours: String(oman.hour).padStart(2, "0"),
      minutes: String(oman.minute).padStart(2, "0"),
      seconds: String(oman.second).padStart(2, "0"),
      milliseconds: String(now.getUTCMilliseconds()).padStart(3, "0"),
      dateLine: OMAN_DATE_LINE_FORMATTER.format(now),
    };

    Object.entries(digitalState).forEach(([key, value]) => {
      if (value === this.lastRenderedDigital[key]) {
        return;
      }
      if (this.elements[key]) {
        this.elements[key].textContent = value;
      }
    });

    this.lastRenderedDigital = digitalState;
  }

  updateAnalog(oman, now) {
    const ms = now.getUTCMilliseconds();
    const secondProgress = oman.second + ms / 1000;
    const minuteProgress = oman.minute + secondProgress / 60;
    const hourProgress = (oman.hour % 12) + minuteProgress / 60;

    this.elements.secondHandGroup?.setAttribute("transform", `rotate(${secondProgress * 6} 400 400)`);
    this.elements.minuteHand?.setAttribute("transform", `rotate(${minuteProgress * 6} 400 400)`);
    this.elements.hourHand?.setAttribute("transform", `rotate(${hourProgress * 30} 400 400)`);

    const timeText = this.showMilliseconds
      ? `${String(oman.hour).padStart(2, "0")}:${String(oman.minute).padStart(2, "0")}:${String(oman.second).padStart(2, "0")}.${String(ms).padStart(3, "0")}`
      : `${String(oman.hour).padStart(2, "0")}:${String(oman.minute).padStart(2, "0")}:${String(oman.second).padStart(2, "0")}`;

    if (timeText !== this.lastRenderedAnalog.timeText && this.elements.analogTimeText) {
      this.elements.analogTimeText.textContent = timeText;
    }
    if (oman.date !== this.lastRenderedAnalog.dateText && this.elements.analogDateText) {
      this.elements.analogDateText.textContent = oman.date;
    }

    this.lastRenderedAnalog = { timeText, dateText: oman.date };
  }

  updateDrift(now) {
    if (!this.syncManager.hasSuccessfulSync) {
      this.elements.driftMonitor.classList.add("hidden");
      return;
    }

    const currentSecond = Math.floor(now.getTime() / 1000);
    if (currentSecond === this.lastDriftSecond) {
      return;
    }
    this.lastDriftSecond = currentSecond;

    const driftMs = this.syncManager.getDrift(now.getTime());
    const driftSec = driftMs / 1000;
    const abs = Math.abs(driftMs);
    const cls = abs < 100 ? "good" : abs < 1000 ? "warn" : "bad";

    this.elements.driftMonitor.classList.remove("hidden", "good", "warn", "bad");
    this.elements.driftMonitor.classList.add(cls);
    this.elements.driftMonitor.textContent = `Δ ${driftSec >= 0 ? "+" : ""}${driftSec.toFixed(3)}s`;
  }
}

class InputHandler {
  constructor(elements, displayManager, gpsTimeSync) {
    this.elements = elements;
    this.displayManager = displayManager;
    this.gpsTimeSync = gpsTimeSync;
    this.listeners = [];
  }

  add(target, event, handler) {
    if (!target) {
      return;
    }
    target.addEventListener(event, handler);
    this.listeners.push(() => target.removeEventListener(event, handler));
  }

  init() {
    this.add(this.elements.digitalModeBtn, "click", () => this.displayManager.setMode("digital"));
    this.add(this.elements.analogModeBtn, "click", () => this.displayManager.setMode("analog"));
    this.add(this.elements.analogOnlyBtn, "click", () => this.displayManager.setAnalogOnlyMode());
    this.add(this.elements.backToDigitalBtn, "click", () => this.displayManager.setMode("digital"));
    this.add(this.elements.darkModeBtn, "click", () => this.displayManager.toggleDarkMode());
    this.add(this.elements.precisionToggleBtn, "click", () => this.displayManager.togglePrecisionMode());
    this.add(this.elements.setTimeComputerBtn, "click", () => this.handleSetGpsTime(false));
    this.add(this.elements.setTimeInternetBtn, "click", () => this.handleSetGpsTime(true));
    this.add(document, "keydown", (event) => this.handleKeys(event));
  }

  async handleSetGpsTime(useInternet) {
    const sourceLabel = useInternet ? "Internet" : "this computer";
    const confirmationText = useInternet
      ? "Set GPS receiver time from Internet?\n\nThis uses the backend Internet fallback source."
      : "Set GPS receiver time from this computer?\n\nThis uses the current Oman time derived from this computer clock.";

    if (!window.confirm(confirmationText)) {
      return;
    }

    const button = useInternet ? this.elements.setTimeInternetBtn : this.elements.setTimeComputerBtn;
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "Updating…";

    try {
      const response = await fetch(`${this.gpsTimeSync.apiBaseUrl}/time/set`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ useInternet }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || `Failed to set GPS time from ${sourceLabel}`);
      }

      window.showNotification(
        [
          `<strong>GPS time updated</strong>`,
          `<strong>Source:</strong> ${result.source}`,
          `<strong>Date:</strong> ${result.date}`,
          `<strong>Time:</strong> ${result.time}`,
          `<strong>Status:</strong> Refreshing display…`,
        ].join("<br>"),
        "success",
        4200,
      );

      await this.gpsTimeSync.syncTime();
    } catch (error) {
      window.showNotification(error.message, "error", 5000);
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  handleKeys(event) {
    if (event.code === "Space") {
      event.preventDefault();
      this.displayManager.togglePause();
      return;
    }

    const key = event.key.toLowerCase();
    if (key === "1") this.displayManager.setMode("digital");
    if (key === "2") this.displayManager.setMode("analog");
    if (key === "3") this.displayManager.setAnalogOnlyMode();
    if (key === "d") this.displayManager.toggleDarkMode();
    if (key === "f") {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.();
      } else {
        document.exitFullscreen?.();
      }
    }
    if (event.key === "Escape" && document.body.classList.contains("analog-only")) {
      this.displayManager.setMode("digital");
    }
  }

  cleanup() {
    this.listeners.forEach((dispose) => dispose());
    this.listeners = [];
  }
}

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
      digitalOnlyControls: document.getElementById("digitalOnlyControls"),
      setTimeComputerBtn: document.getElementById("setTimeComputerBtn"),
      setTimeInternetBtn: document.getElementById("setTimeInternetBtn"),
    };

    this.analogDial = this.elements.ptbClockSvg;
    this.gpsTimeSync = new GPSTimeSync();
    this.syncManager = new SyncManager(this.elements.syncStatus, this.gpsTimeSync);
    this.gpsDisplay = new GPSDisplayManager(this.elements, this.gpsTimeSync);
    this.displayManager = new DisplayManager(this.elements, this.syncManager, this.gpsTimeSync);
    this.inputHandler = new InputHandler(this.elements, this.displayManager, this.gpsTimeSync);
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

    svg.innerHTML = "";

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

      this.elements.syncStatus.textContent = this.syncManager.formatStatus();
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
  }
}

window.notificationManager = new NotificationManager();
window.showNotification = (message, type, duration) => {
  window.notificationManager.show(message, type, duration);
};

const bootClock = () => {
  new PrecisionClock().init().catch((error) => {
    console.error("Clock initialization failed:", error);
    window.showNotification(`Initialization failed: ${error.message}`, "error", 6000);
  });
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootClock, { once: true });
} else {
  bootClock();
}
