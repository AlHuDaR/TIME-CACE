(function (global) {
  const { APP_CONFIG, OMAN_DATE_LINE_FORMATTER, buildAppUrl, formatTimeParts } = global.RAFOTimeApp;

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
    const url = buildAppUrl(window.location.pathname, new URLSearchParams(window.location.search));
    url.searchParams.set("mode", mode);
    if (url.origin === window.location.origin) {
      window.history.replaceState({}, "", url);
      return;
    }

    window.location.assign(url.toString());
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

  setSectionVisibility(section, isVisible) {
    if (!section) {
      return;
    }

    section.classList.toggle("hidden", !isVisible);
    section.setAttribute("aria-hidden", String(!isVisible));
    if ("inert" in section) {
      section.inert = !isVisible;
    }
  }

  setModeScopedSectionsHidden(isOldStyleMode) {
    this.setSectionVisibility(this.elements.gpsStatusBar, !isOldStyleMode);
    this.setSectionVisibility(this.elements.monitoringDashboard, !isOldStyleMode);
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
    this.setModeScopedSectionsHidden(!isDigital);
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
    this.setModeScopedSectionsHidden(true);
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
      ? `${formatTimeParts(oman.hour, oman.minute, oman.second)}.${String(ms).padStart(3, "0")}`
      : formatTimeParts(oman.hour, oman.minute, oman.second);

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
      ? "Set GPS receiver time from Internet?\n\nThis uses the available internet time source."
      : "Set GPS receiver time from this computer?\n\nThis uses the current Oman time derived from this computer clock.";

    if (!window.confirm(confirmationText)) {
      return;
    }

    const button = useInternet ? this.elements.setTimeInternetBtn : this.elements.setTimeComputerBtn;
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "Updating…";

    try {
      const result = await this.gpsTimeSync.fetchJson("/time/set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ useInternet }),
      });

      if (!result.success) {
        throw new Error(result.error || `Failed to set GPS time from ${sourceLabel}`);
      }

      window.showNotification(
        [
          "GPS time updated",
          "Source: GPS Receiver",
          `Date: ${result.date}`,
          `Time: ${result.time}`,
          "Status: Nominal (synchronized)",
        ],
        "success",
        4200,
      );

      await this.gpsTimeSync.syncTime();
      await this.gpsTimeSync.pollStatus();
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


  Object.assign(global.RAFOTimeApp, { DisplayManager, InputHandler });
})(window);
