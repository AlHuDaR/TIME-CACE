(function (global) {
  const { APP_CONFIG, OMAN_DATE_LINE_FORMATTER } = global.RAFOTimeApp;

  const OMAN_TIME_PARTS_FORMATTER = new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_CONFIG.timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  class DisplayManager {
    constructor(elements, syncManager) {
      this.elements = elements;
      this.syncManager = syncManager;
      this.showMilliseconds = this.resolveInitialPrecisionMode();
      this.darkMode = this.resolveInitialDarkMode();
      this.paused = false;
      this.lastRenderedDigital = {};
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

    normalizeLegacyModeQuery() {
      const url = new URL(window.location.href);
      if (!url.searchParams.has("mode")) {
        return;
      }

      url.searchParams.delete("mode");
      window.history.replaceState({}, "", url);
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

    applyPrecisionMode(enabled) {
      this.showMilliseconds = enabled;
      this.elements.millisecondsTile.classList.toggle("hidden", !enabled);
      this.elements.precisionToggleBtn.textContent = `Precision: ${enabled ? "ON" : "OFF"}`;
      this.elements.precisionToggleBtn.setAttribute("aria-pressed", String(enabled));
      localStorage.setItem("precisionMode", enabled ? "1" : "0");
    }

    updateDigital(now) {
      const omanParts = Object.fromEntries(
        OMAN_TIME_PARTS_FORMATTER.formatToParts(now).map((part) => [part.type, part.value]),
      );

      const nextState = {
        hours: omanParts.hour || "--",
        minutes: omanParts.minute || "--",
        seconds: omanParts.second || "--",
        milliseconds: String(now.getUTCMilliseconds()).padStart(3, "0"),
        dateLine: OMAN_DATE_LINE_FORMATTER.format(now),
      };

      Object.entries(nextState).forEach(([key, value]) => {
        if (value === this.lastRenderedDigital[key]) {
          return;
        }
        if (this.elements[key]) {
          this.elements[key].textContent = value;
        }
      });

      this.lastRenderedDigital = nextState;
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
      if (key === "d") this.displayManager.toggleDarkMode();
      if (key === "f") {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen?.();
        } else {
          document.exitFullscreen?.();
        }
      }
    }

    cleanup() {
      this.listeners.forEach((dispose) => dispose());
      this.listeners = [];
    }
  }

  Object.assign(global.RAFOTimeApp, { DisplayManager, InputHandler });
})(window);
