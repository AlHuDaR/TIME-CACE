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
    this.showMilliseconds = this.resolveInitialPrecisionMode();
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

  setPrecisionVisibility(isVisible) {
    this.elements.precisionToggleBtn.classList.toggle("hidden", !isVisible);
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
    }, MODE_TRANSITION_MS);
  }

  setMode(mode) {
    this.mode = mode;
    document.body.classList.remove("analog-only", "old-style");
    const isDigital = mode === "digital";
    if (isDigital) {
      this.showSection(this.elements.digitalClock);
      this.hideSection(this.elements.analogClock);
      this.setPrecisionVisibility(false);
    } else {
      this.setPrecisionVisibility(true);
      document.body.classList.add("old-style");
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
    document.body.classList.remove("old-style");
    document.body.classList.add("analog-only");
    this.elements.digitalClock.classList.add("hidden");
    this.elements.analogClock.classList.remove("hidden");
    this.elements.digitalModeBtn.classList.remove("active");
    this.elements.analogModeBtn.classList.remove("active");
    this.elements.analogOnlyBtn.classList.add("active");
    this.setPrecisionVisibility(true);
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

    this.elements.secondHandGroup?.setAttribute("transform", `rotate(${secondProgress * 6} 400 400)`);
    this.elements.minuteHand?.setAttribute("transform", `rotate(${minuteProgress * 6} 400 400)`);
    this.elements.hourHand?.setAttribute("transform", `rotate(${hourProgress * 30} 400 400)`);

    const timeText = this.showMilliseconds
      ? `${String(oman.hour).padStart(2, "0")}:${String(oman.minute).padStart(2, "0")}:${String(oman.second).padStart(2, "0")}.${String(ms).padStart(3, "0")}`
      : `${String(oman.hour).padStart(2, "0")}:${String(oman.minute).padStart(2, "0")}:${String(oman.second).padStart(2, "0")}`;
    this.elements.analogTimeText && (this.elements.analogTimeText.textContent = timeText);
    this.elements.analogDateText && (this.elements.analogDateText.textContent = oman.date);
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
    this.add(this.elements.backToDigitalBtn, "click", () => this.displayManager.setMode("digital"));
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
    };
    this.analogDial = this.elements.ptbClockSvg;
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
    this.displayManager.setPrecisionVisibility(false);
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
    const svg = this.analogDial;
    const ns = "http://www.w3.org/2000/svg";
    const make = (tag, attrs = {}) => {
      const el = document.createElementNS(ns, tag);
      Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
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
      const t = make("text", { x: x.toFixed(3), y: y.toFixed(3) });
      t.textContent = String(i);
      numbers.append(t);
    }
    svg.append(numbers);

    const logo = make("g", { transform: "translate(250 400)", opacity: 0.88, filter: "url(#logoShadow)" });
    logo.append(make("circle", { cx: -24, cy: -4, r: 30, fill: "#1a6b8c" }));
    logo.append(make("circle", { cx: -24, cy: -4, r: 20, fill: "none", stroke: "#e8e8e8", "stroke-width": 3 }));
    logo.append(make("line", { x1: -24, y1: -24, x2: -24, y2: 16, stroke: "#e8e8e8", "stroke-width": 3 }));
    logo.append(make("line", { x1: -44, y1: -4, x2: -4, y2: -4, stroke: "#e8e8e8", "stroke-width": 3 }));


    const dateText = make("text", { x: 400, y: 180, fill: "#1a6b8c", "font-size": 36, "font-family": "Arial, Helvetica, sans-serif", "text-anchor": "middle" });
    dateText.textContent = "06.03.2026";
    svg.append(dateText);

    const timeText = make("text", { x: 400, y: 240, fill: "#1a6b8c", "font-size": 48, "font-weight": 700, "font-family": "Arial, Helvetica, sans-serif", "text-anchor": "middle" });
    timeText.textContent = "01:36:21";
    svg.append(timeText);

    const tzText = make("text", { x: 400, y: 280, fill: "#1a6b8c", "font-size": 24, "font-family": "Arial, Helvetica, sans-serif", "text-anchor": "middle" });
    tzText.textContent = "MCT (UTC+04:00)";
    svg.append(tzText);

    const handsGroup = make("g", { id: "hands" });
    const hourHand = make("line", { x1: 400, y1: 400, x2: 400, y2: 275, stroke: "#1a6b8c", "stroke-width": 14, "stroke-linecap": "round", opacity: 0.86 });
    const minuteHand = make("line", { x1: 400, y1: 400, x2: 400, y2: 215, stroke: "#1f7699", "stroke-width": 10, "stroke-linecap": "round", opacity: 0.84 });
    const secondHandGroup = make("g");
    const secondHand = make("line", { x1: 400, y1: 435, x2: 400, y2: 170, stroke: "#d32f2f", "stroke-width": 3, "stroke-linecap": "round", opacity: 0.94 });
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
