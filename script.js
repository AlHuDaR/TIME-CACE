const OMAN_TIMEZONE = "Asia/Muscat";
const MODE_TRANSITION_MS = 260;
const SYNC_SUCCESS_DELAY_MS = 5 * 60 * 1000;
const SYNC_INITIAL_RETRY_MS = 15 * 1000;
const SYNC_MAX_RETRY_MS = 5 * 60 * 1000;

class SyncManager {
  constructor(statusElement) {
    this.statusElement = statusElement;
    this.syncedEpochAtSample = Date.now();
    this.perfAtSample = performance.now();
    this.hasSuccessfulSync = false;
    this.lastSyncTimestamp = null;
    this.lastRttMs = null;
    this.errorType = null;
    this.retryDelayMs = SYNC_INITIAL_RETRY_MS;
    this.timeoutId = null;
  }

  calculateBackoff() {
    this.retryDelayMs = Math.min(this.retryDelayMs * 2, SYNC_MAX_RETRY_MS);
    return this.retryDelayMs;
  }

  getNowFromSyncedClock() {
    return new Date(this.syncedEpochAtSample + (performance.now() - this.perfAtSample));
  }

  getDrift(now = Date.now()) {
    return now - this.getNowFromSyncedClock().getTime();
  }

  getRelativeLastSync() {
    if (!this.lastSyncTimestamp) {
      return "never";
    }
    const diff = Math.max(0, Date.now() - this.lastSyncTimestamp);
    const minutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    return `${minutes}m ${seconds}s ago`;
  }

  formatStatus() {
    const rttLabel = this.lastRttMs == null ? "--" : `${Math.round(this.lastRttMs)}ms`;
    const confidence = this.lastRttMs == null ? "--" : `±${Math.round(this.lastRttMs / 2)}ms`;
    return `Last sync: ${this.getRelativeLastSync()} | RTT: ${rttLabel} | Confidence: ${confidence}`;
  }

  async sync() {
    const url = `https://time.gov/actualtime.cgi?lzbc=siqm9b&cacheBust=${Date.now()}`;
    const startedAt = performance.now();

    try {
      const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
      this.lastRttMs = performance.now() - startedAt;
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      if (!data?.time) {
        throw new Error("No time field in response");
      }

      const epochMs = Number(data.time) / 1000;
      if (!Number.isFinite(epochMs)) {
        throw new Error("Invalid time value");
      }

      this.syncedEpochAtSample = epochMs;
      this.perfAtSample = performance.now();
      this.hasSuccessfulSync = true;
      this.lastSyncTimestamp = Date.now();
      this.errorType = null;
      this.retryDelayMs = SYNC_INITIAL_RETRY_MS;
      this.statusElement.classList.remove("warn");
      this.statusElement.textContent = this.formatStatus();
      this.scheduleNext(SYNC_SUCCESS_DELAY_MS);
    } catch (error) {
      const message = String(error?.message || "Unknown sync error");
      const corsIssue = message.includes("Failed to fetch") || message.includes("CORS");
      this.errorType = corsIssue ? "cors" : "network";
      this.statusElement.classList.add("warn");
      this.statusElement.textContent = corsIssue
        ? "Local clock fallback active (network/CORS restriction)."
        : `Local clock fallback active (${message}).`;
      this.scheduleNext(this.calculateBackoff());
    }
  }

  scheduleNext(delay) {
    if (this.timeoutId) {
      window.clearTimeout(this.timeoutId);
    }
    this.timeoutId = window.setTimeout(() => this.sync(), delay);
  }

  cleanup() {
    if (this.timeoutId) {
      window.clearTimeout(this.timeoutId);
    }
  }
}

class DisplayManager {
  constructor(elements, syncManager) {
    this.elements = elements;
    this.syncManager = syncManager;
    this.mode = "digital";
    this.showMilliseconds = localStorage.getItem("precisionMode") === "1";
    this.darkMode = this.resolveInitialDarkMode();
    this.paused = false;
    this.lastDriftSecond = -1;
  }

  resolveInitialDarkMode() {
    const stored = localStorage.getItem("darkMode");
    if (stored !== null) {
      return stored === "1";
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
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

  applyPrecisionMode(enabled) {
    this.showMilliseconds = enabled;
    this.elements.millisecondsTile.classList.toggle("hidden", !enabled);
    this.elements.precisionToggleBtn.textContent = `Precision: ${enabled ? "ON" : "OFF"}`;
    this.elements.precisionToggleBtn.setAttribute("aria-pressed", String(enabled));
    localStorage.setItem("precisionMode", enabled ? "1" : "0");
  }

  toggleDarkMode() { this.applyDarkMode(!this.darkMode); }
  togglePrecisionMode() { this.applyPrecisionMode(!this.showMilliseconds); }
  togglePause() { this.paused = !this.paused; }

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
    }, MODE_TRANSITION_MS);
  }

  setMode(mode) {
    this.mode = mode;
    document.body.classList.remove("analog-only");
    const isDigital = mode === "digital";
    if (isDigital) {
      this.showSection(this.elements.digitalClock);
      this.hideSection(this.elements.analogClock);
    } else {
      this.showSection(this.elements.analogClock);
      this.hideSection(this.elements.digitalClock);
    }

    this.elements.digitalModeBtn.classList.toggle("active", isDigital);
    this.elements.analogModeBtn.classList.toggle("active", !isDigital);
    this.elements.analogOnlyBtn.classList.remove("active");
    this.elements.digitalModeBtn.setAttribute("aria-pressed", String(isDigital));
    this.elements.analogModeBtn.setAttribute("aria-pressed", String(!isDigital));
    this.elements.analogOnlyBtn.setAttribute("aria-pressed", "false");
  }

  setAnalogOnlyMode() {
    this.mode = "analog-only";
    document.body.classList.add("analog-only");
    this.elements.digitalClock.classList.add("hidden");
    this.elements.analogClock.classList.remove("hidden");
    this.elements.digitalModeBtn.classList.remove("active");
    this.elements.analogModeBtn.classList.remove("active");
    this.elements.analogOnlyBtn.classList.add("active");
  }

  updateDigital(oman, now) {
    this.elements.hours.textContent = String(oman.hour).padStart(2, "0");
    this.elements.minutes.textContent = String(oman.minute).padStart(2, "0");
    this.elements.seconds.textContent = String(oman.second).padStart(2, "0");
    this.elements.milliseconds.textContent = String(now.getUTCMilliseconds()).padStart(3, "0");
    this.elements.dateLine.textContent = new Intl.DateTimeFormat("en-GB", {
      timeZone: OMAN_TIMEZONE,
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
    }).format(now);
  }

  updateAnalog(oman, now) {
    const ms = now.getUTCMilliseconds();
    const secondProgress = oman.second + ms / 1000;
    const minuteProgress = oman.minute + secondProgress / 60;
    const hourProgress = (oman.hour % 12) + minuteProgress / 60;

    this.elements.secondHand.style.transform = `translateX(-50%) rotate(${secondProgress * 6}deg)`;
    this.elements.minuteHand.style.transform = `translateX(-50%) rotate(${minuteProgress * 6}deg)`;
    this.elements.hourHand.style.transform = `translateX(-50%) rotate(${hourProgress * 30}deg)`;

    const timeText = this.showMilliseconds
      ? `${String(oman.hour).padStart(2, "0")}:${String(oman.minute).padStart(2, "0")}:${String(oman.second).padStart(2, "0")}.${String(ms).padStart(3, "0")}`
      : `${String(oman.hour).padStart(2, "0")}:${String(oman.minute).padStart(2, "0")}:${String(oman.second).padStart(2, "0")}`;
    this.elements.analogReadout.innerHTML = `<span style="display:block;">${timeText}</span><span style="display:block;">${oman.date}</span>`;
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
  constructor(elements, displayManager) {
    this.elements = elements;
    this.displayManager = displayManager;
    this.listeners = [];
  }

  add(target, event, handler) {
    target.addEventListener(event, handler);
    this.listeners.push(() => target.removeEventListener(event, handler));
  }

  init() {
    this.add(this.elements.digitalModeBtn, "click", () => this.displayManager.setMode("digital"));
    this.add(this.elements.analogModeBtn, "click", () => this.displayManager.setMode("analog"));
    this.add(this.elements.analogOnlyBtn, "click", () => this.displayManager.setAnalogOnlyMode());
    this.add(this.elements.exitFullscreenBtn, "click", () => this.displayManager.setMode("digital"));
    this.add(this.elements.darkModeBtn, "click", () => this.displayManager.toggleDarkMode());
    this.add(this.elements.precisionToggleBtn, "click", () => this.displayManager.togglePrecisionMode());
    this.add(document, "keydown", (e) => this.handleKeys(e));
  }

  handleKeys(e) {
    if (e.code === "Space") {
      e.preventDefault();
      this.displayManager.togglePause();
      return;
    }

    const key = e.key.toLowerCase();
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
    if (e.key === "Escape" && document.body.classList.contains("analog-only")) {
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
      hourHand: document.getElementById("hourHand"),
      minuteHand: document.getElementById("minuteHand"),
      secondHand: document.getElementById("secondHand"),
      analogReadout: document.getElementById("analogReadout"),
      driftMonitor: document.getElementById("driftMonitor"),
      digitalClock: document.getElementById("digitalClock"),
      analogClock: document.getElementById("analogClock"),
      digitalModeBtn: document.getElementById("digitalModeBtn"),
      analogModeBtn: document.getElementById("analogModeBtn"),
      analogOnlyBtn: document.getElementById("analogOnlyBtn"),
      exitFullscreenBtn: document.getElementById("exitFullscreenBtn"),
      darkModeBtn: document.getElementById("darkModeBtn"),
      precisionToggleBtn: document.getElementById("precisionToggleBtn"),
    };
    this.analogDial = this.elements.analogClock.querySelector(".analog-clock");
    this.syncManager = new SyncManager(this.elements.syncStatus);
    this.displayManager = new DisplayManager(this.elements, this.syncManager);
    this.inputHandler = new InputHandler(this.elements, this.displayManager);
    this.rafId = null;
    this.boundVisibility = () => this.handleVisibilityChange();
    this.boundUnload = () => this.cleanup();
  }

  init() {
    this.applyFavicon();
    this.handleLogoFallback();
    this.buildAnalogDial();
    this.displayManager.initVisualPreferences();
    this.displayManager.setMode(this.getModeFromUrl() === "analog-only" ? "digital" : "digital");
    if (this.getModeFromUrl() === "analog-only") {
      this.displayManager.setAnalogOnlyMode();
    }
    this.inputHandler.init();
    document.addEventListener("visibilitychange", this.boundVisibility);
    window.addEventListener("beforeunload", this.boundUnload);
    this.syncManager.sync();
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
    for (const mark of this.analogDial.querySelectorAll(".analog-mark, .tick")) {
      mark.remove();
    }
    for (let i = 0; i < 60; i += 1) {
      const tick = document.createElement("span");
      tick.className = i % 5 === 0 ? "tick major" : "tick";
      tick.style.transform = `translate(-50%, -50%) rotate(${i * 6}deg)`;
      this.analogDial.append(tick);
    }
    for (let i = 1; i <= 12; i += 1) {
      const number = document.createElement("span");
      const angle = ((i % 12) * Math.PI) / 6;
      number.className = "analog-mark";
      number.textContent = String(i);
      number.style.left = `${50 + 41 * Math.sin(angle)}%`;
      number.style.top = `${50 - 41 * Math.cos(angle)}%`;
      this.analogDial.append(number);
    }
    if (this.elements.analogReadout.parentElement !== this.analogDial) {
      this.analogDial.append(this.elements.analogReadout);
    }
  }

  getModeFromUrl() {
    return new URLSearchParams(window.location.search).get("mode");
  }

  getOmanParts(now) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: OMAN_TIMEZONE,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour12: false,
    }).formatToParts(now);

    const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
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
        const now = this.syncManager.getNowFromSyncedClock();
        const oman = this.getOmanParts(now);
        this.displayManager.updateDigital(oman, now);
        this.displayManager.updateAnalog(oman, now);
        this.displayManager.updateDrift(now);
      }
      if (this.syncManager.hasSuccessfulSync) {
        this.elements.syncStatus.textContent = this.syncManager.formatStatus();
      }
      this.rafId = requestAnimationFrame(renderFrame);
    };
    this.rafId = requestAnimationFrame(renderFrame);
  }

  handleVisibilityChange() {
    if (document.hidden) {
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      return;
    }
    this.startRenderLoop();
  }

  cleanup() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    document.removeEventListener("visibilitychange", this.boundVisibility);
    window.removeEventListener("beforeunload", this.boundUnload);
    this.inputHandler.cleanup();
    this.syncManager.cleanup();
  }
}

new PrecisionClock().init();
