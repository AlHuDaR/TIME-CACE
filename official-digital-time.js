(function (global) {
  const {
    APP_CONFIG,
    GPSTimeSync,
    syncAppLinks,
    applyFavicon,
    bootWhenDocumentReady,
    formatStandardStatusLines,
  } = global.RAFOTimeApp || {};

  if (!APP_CONFIG || !GPSTimeSync || !syncAppLinks || !applyFavicon || !bootWhenDocumentReady || !formatStandardStatusLines) {
    throw new Error("Official digital time page dependencies are unavailable. Ensure shared runtime modules load first.");
  }

  const HERO_LOCATION = Object.freeze({
    fallbackLabel: "Oman",
    timeZone: APP_CONFIG.timezone,
    fallbackLine: "Time in Oman now:",
    genericLine: "Time at your current location now:",
  });

  const REVERSE_GEOCODE_ENDPOINT = "https://nominatim.openstreetmap.org/reverse";
  const REVERSE_GEOCODE_TIMEOUT_MS = 3200;
  const BROWSER_GEOLOCATION_TIMEOUT_MS = 4200;

  const KEY_WORLD_CLOCKS = Object.freeze([
    { label: "New York", timeZone: "America/New_York" },
    { label: "London", timeZone: "Europe/London" },
    { label: "Paris", timeZone: "Europe/Paris" },
    { label: "Istanbul", timeZone: "Europe/Istanbul" },
    { label: "Mecca", timeZone: "Asia/Riyadh" },
    { label: "Beijing", timeZone: "Asia/Shanghai" },
    { label: "Tokyo", timeZone: "Asia/Tokyo" },
  ]);

  const HIGHLIGHTED_CITIES = Object.freeze([
    { label: "Seeb", timeZone: "Asia/Muscat", emphasis: "anchor", note: "Oman reference" },
    { label: "Abu Dhabi", timeZone: "Asia/Dubai", emphasis: "feature", note: "Gulf reference" },
    { label: "Riyadh", timeZone: "Asia/Riyadh", emphasis: "feature", note: "Arabian Peninsula" },
    { label: "Mecca", timeZone: "Asia/Riyadh", emphasis: "feature", note: "Regional reference" },
    { label: "London", timeZone: "Europe/London", emphasis: "feature", note: "Europe / GMT" },
    { label: "UTC", timeZone: "UTC", emphasis: "feature", note: "Universal reference" },
    { label: "New York", timeZone: "America/New_York", emphasis: "feature", note: "US Eastern" },
    { label: "Tokyo", timeZone: "Asia/Tokyo", emphasis: "feature", note: "Japan Standard Time" },
    { label: "Beijing", timeZone: "Asia/Shanghai", emphasis: "feature", note: "China Standard Time" },
    { label: "Istanbul", timeZone: "Europe/Istanbul", emphasis: "feature", note: "Türkiye" },
    { label: "Paris", timeZone: "Europe/Paris", emphasis: "feature", note: "Central Europe" },
  ]);

  const SECONDARY_CITIES = Object.freeze([
    { label: "Amman", timeZone: "Asia/Amman" },
    { label: "Athens", timeZone: "Europe/Athens" },
    { label: "Baghdad", timeZone: "Asia/Baghdad" },
    { label: "Bangkok", timeZone: "Asia/Bangkok" },
    { label: "Beirut", timeZone: "Asia/Beirut" },
    { label: "Berlin", timeZone: "Europe/Berlin" },
    { label: "Cairo", timeZone: "Africa/Cairo" },
    { label: "Cape Town", timeZone: "Africa/Johannesburg" },
    { label: "Damascus", timeZone: "Asia/Damascus" },
    { label: "Delhi", timeZone: "Asia/Kolkata" },
    { label: "Dhaka", timeZone: "Asia/Dhaka" },
    { label: "Dubai", timeZone: "Asia/Dubai" },
    { label: "Hong Kong", timeZone: "Asia/Hong_Kong" },
    { label: "Jakarta", timeZone: "Asia/Jakarta" },
    { label: "Karachi", timeZone: "Asia/Karachi" },
    { label: "Kuala Lumpur", timeZone: "Asia/Kuala_Lumpur" },
    { label: "Lagos", timeZone: "Africa/Lagos" },
    { label: "Madrid", timeZone: "Europe/Madrid" },
    { label: "Manila", timeZone: "Asia/Manila" },
    { label: "Moscow", timeZone: "Europe/Moscow" },
    { label: "Mumbai", timeZone: "Asia/Kolkata" },
    { label: "Seoul", timeZone: "Asia/Seoul" },
    { label: "Shanghai", timeZone: "Asia/Shanghai" },
    { label: "Singapore", timeZone: "Asia/Singapore" },
    { label: "Sydney", timeZone: "Australia/Sydney" },
    { label: "Taipei", timeZone: "Asia/Taipei" },
    { label: "Tehran", timeZone: "Asia/Tehran" },
    { label: "Toronto", timeZone: "America/Toronto" },
    { label: "Vancouver", timeZone: "America/Vancouver" },
    { label: "Vienna", timeZone: "Europe/Vienna" },
    { label: "Washington, D.C.", timeZone: "America/New_York" },
  ]);

  const TIMEZONE_LABELS = Object.freeze([
    { label: "UTC", description: "Universal Coordinated Time" },
    { label: "GMT", description: "Greenwich Mean Time" },
    { label: "CET", description: "Central European Time" },
    { label: "Eastern Time", description: "North America eastern reference" },
    { label: "Central Time", description: "North America central reference" },
    { label: "Mountain Time", description: "North America mountain reference" },
    { label: "Pacific Time", description: "North America pacific reference" },
    { label: "India Standard Time", description: "IST · UTC+05:30" },
    { label: "China Standard Time", description: "CST · UTC+08:00" },
  ]);

  const OBSERVANCE_CONFIG = Object.freeze({
    recurring: Object.freeze({
      "01-01": ["New Year’s Day"],
      "03-23": ["World Meteorological Day"],
      "05-20": ["World Metrology Day"],
      "10-01": ["Oman National Day season"],
      "11-18": ["Oman National Day"],
      "12-31": ["Year-end operations review"],
    }),
    defaultLine: "Operational observances: none scheduled",
    cacheKeyPrefix: "rafo-oman-observances-v1-",
    cacheTtlMs: 24 * 60 * 60 * 1000,
    requestTimeoutMs: 3500,
    countryCode: "OM",
  });

  const OMAN_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_CONFIG.timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const OMAN_YEAR_FORMATTER = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_CONFIG.timezone,
    year: "numeric",
  });

  const HERO_CLOCK_FORMATTER = new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_CONFIG.timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const SHORT_TIME_FORMATTER_CACHE = new Map();

  function getTimeFormatter(timeZone, options = {}) {
    const key = JSON.stringify({ timeZone, ...options });
    if (!SHORT_TIME_FORMATTER_CACHE.has(key)) {
      SHORT_TIME_FORMATTER_CACHE.set(key, new Intl.DateTimeFormat("en-GB", {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        ...options,
      }));
    }
    return SHORT_TIME_FORMATTER_CACHE.get(key);
  }

  function formatTimeForZone(date, timeZone, options) {
    return getTimeFormatter(timeZone, options).format(date);
  }

  function buildObservanceLine(date, dynamicObservances) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: APP_CONFIG.timezone,
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const key = `${map.month}-${map.day}`;
    const recurringEntries = OBSERVANCE_CONFIG.recurring[key] || [];
    const dynamicEntries = dynamicObservances?.get(key) || [];
    const entries = Array.from(new Set([...dynamicEntries, ...recurringEntries]));

    if (!entries.length) {
      return OBSERVANCE_CONFIG.defaultLine;
    }

    return `Operational observances: ${entries.join(" / ")}`;
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = 3000) {
    const controller = new AbortController();
    const timeout = global.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      return response;
    } finally {
      global.clearTimeout(timeout);
    }
  }

  function isWithinOmanBounds({ latitude, longitude }) {
    return Number.isFinite(latitude)
      && Number.isFinite(longitude)
      && latitude >= 16.5
      && latitude <= 26.5
      && longitude >= 51.7
      && longitude <= 59.9;
  }

  class OfficialDigitalTimePage {
    constructor() {
      this.elements = {
        offsetLine: document.getElementById("digitalOffsetLine"),
        accuracyLine: document.getElementById("digitalAccuracyLine"),
        locationLine: document.getElementById("digitalLocationLine"),
        clock: document.getElementById("digitalHeroClock"),
        source: document.getElementById("digitalHeroSource"),
        date: document.getElementById("digitalHeroDate"),
        observance: document.getElementById("digitalHeroObservance"),
        keyWorldClocks: document.getElementById("keyWorldClocks"),
        highlightedCities: document.getElementById("highlightedCities"),
        secondaryCities: document.getElementById("secondaryCities"),
        timezoneLabels: document.getElementById("timezoneLabels"),
      };

      this.gpsTimeSync = new GPSTimeSync();
      this.latestState = null;
      this.rafId = null;
      this.boundVisibility = () => this.handleVisibilityChange();
      this.boundUpdate = (event) => this.applyRuntimeState(event.detail);
      this.boundUnload = () => this.cleanup();
      this.keyClockNodes = [];
      this.highlightedCityNodes = [];
      this.secondaryCityNodes = [];
      this.observanceMap = new Map();
    }

    async init() {
      syncAppLinks();
      applyFavicon();
      this.elements.locationLine.textContent = HERO_LOCATION.fallbackLine;
      this.renderStaticCollections();
      this.resolveLocationLine().catch(() => {
        this.elements.locationLine.textContent = HERO_LOCATION.fallbackLine;
      });
      this.refreshObservanceCalendar().catch(() => {
        this.observanceMap = new Map();
      });
      await this.gpsTimeSync.init();
      this.gpsTimeSync.addEventListener("gpstimeupdate", this.boundUpdate);
      this.applyRuntimeState(this.gpsTimeSync.getCurrentState());
      document.addEventListener("visibilitychange", this.boundVisibility);
      window.addEventListener("beforeunload", this.boundUnload, { once: true });
      this.startRenderLoop();
    }

    renderStaticCollections() {
      this.renderKeyWorldClocks();
      this.renderHighlightedCities();
      this.renderSecondaryCities();
      this.renderTimezoneLabels();
    }

    renderKeyWorldClocks() {
      this.keyClockNodes = KEY_WORLD_CLOCKS.map((city) => {
        const card = document.createElement("article");
        card.className = "world-clock-card";
        card.innerHTML = `
          <p class="world-clock-card__city">${city.label}</p>
          <p class="world-clock-card__time">--:--</p>
        `;
        this.elements.keyWorldClocks.append(card);
        return {
          timeZone: city.timeZone,
          timeNode: card.querySelector(".world-clock-card__time"),
        };
      });
    }

    renderHighlightedCities() {
      this.highlightedCityNodes = HIGHLIGHTED_CITIES.map((city) => {
        const article = document.createElement("article");
        article.className = `city-card city-card--major city-card--${city.emphasis || "feature"}`;
        article.innerHTML = `
          <span class="city-card__label">${city.label}</span>
          <span class="city-card__meta">${city.note || "Live reference"}</span>
          <span class="city-card__time">--:--</span>
        `;
        this.elements.highlightedCities.append(article);
        return {
          label: city.label,
          timeZone: city.timeZone,
          node: article,
          timeNode: article.querySelector(".city-card__time"),
        };
      });
    }

    renderSecondaryCities() {
      this.secondaryCityNodes = SECONDARY_CITIES.map((city) => {
        const article = document.createElement("article");
        article.className = "city-card city-card--secondary";
        article.innerHTML = `
          <span class="city-card__label">${city.label}</span>
          <span class="city-card__meta">${this.describeOffsetFromUtc(city.timeZone)}</span>
        `;
        this.elements.secondaryCities.append(article);
        return {
          label: city.label,
          timeZone: city.timeZone,
          node: article,
        };
      });
    }

    renderTimezoneLabels() {
      TIMEZONE_LABELS.forEach((zone) => {
        const article = document.createElement("article");
        article.className = "timezone-chip";
        article.innerHTML = `
          <span class="timezone-chip__label">${zone.label}</span>
          <span class="timezone-chip__description">${zone.description}</span>
        `;
        this.elements.timezoneLabels.append(article);
      });
    }

    startRenderLoop() {
      if (this.rafId) {
        return;
      }

      const renderFrame = () => {
        this.render();
        this.rafId = global.requestAnimationFrame(renderFrame);
      };

      this.rafId = global.requestAnimationFrame(renderFrame);
    }

    render() {
      const syncedNow = this.gpsTimeSync.getNow();
      const deviceNow = new Date();
      const state = this.latestState || this.gpsTimeSync.getCurrentState();

      this.elements.clock.textContent = HERO_CLOCK_FORMATTER.format(syncedNow);
      this.elements.date.textContent = OMAN_DATE_FORMATTER.format(syncedNow);
      this.elements.observance.textContent = buildObservanceLine(syncedNow, this.observanceMap);
      this.renderOffset(state, syncedNow, deviceNow);
      this.renderSources(state);
      this.renderWorldTimes(syncedNow);
    }

    renderOffset(state, syncedNow, deviceNow) {
      const deltaMs = syncedNow.getTime() - deviceNow.getTime();
      const roundedTenths = Math.round(Math.abs(deltaMs) / 100) / 10;
      const displaySeconds = roundedTenths.toFixed(1);
      const synchronizedThresholdMs = 50;

      if (Math.abs(deltaMs) < synchronizedThresholdMs || displaySeconds === "0.0") {
        this.elements.offsetLine.textContent = "Your clock is synchronized";
      } else if (deltaMs > 0) {
        this.elements.offsetLine.textContent = `Your clock is ${displaySeconds} seconds behind`;
      } else {
        this.elements.offsetLine.textContent = `Your clock is ${displaySeconds} seconds ahead`;
      }

      const accuracySeconds = this.estimateAccuracySeconds(state);
      const confidence = this.resolveConfidenceLabel(state);
      this.elements.accuracyLine.textContent = `Accuracy estimate: ±${accuracySeconds.toFixed(3)} seconds · Confidence: ${confidence}`;
    }

    estimateAccuracySeconds(state) {
      const uncertaintyEstimateMs = Number(state?.uncertaintyEstimateMs);
      if (Number.isFinite(uncertaintyEstimateMs) && uncertaintyEstimateMs >= 0) {
        return uncertaintyEstimateMs / 1000;
      }
      const roundTripMs = Number(state?.roundTripMs);
      if (Number.isFinite(roundTripMs) && roundTripMs >= 0) {
        return Math.max(0.05, roundTripMs / 2000);
      }

      const sourceTier = String(state?.sourceTier || "");
      if (sourceTier === "primary-reference") return 0.08;
      if (sourceTier === "traceable-fallback") return 0.16;
      if (sourceTier === "internet-fallback") return 0.35;
      return 0.75;
    }

    resolveConfidenceLabel(state) {
      const level = String(state?.confidenceLevel || "").toLowerCase();
      if (level === "high") return "High";
      if (level === "reduced") return "Reduced";
      if (level === "degraded") return "Degraded";
      return "Low";
    }

    renderSources(state) {
      const [sourceLine, statusLine] = formatStandardStatusLines(state || {});
      this.elements.source.textContent = `${sourceLine} · ${statusLine}`;
    }

    renderWorldTimes(referenceDate) {
      this.keyClockNodes.forEach((entry) => {
        entry.timeNode.textContent = formatTimeForZone(referenceDate, entry.timeZone);
      });

      this.highlightedCityNodes.forEach((entry) => {
        const localTime = formatTimeForZone(referenceDate, entry.timeZone);
        entry.timeNode.textContent = localTime;
        entry.node.title = `${entry.label}: ${localTime}`;
      });

      this.secondaryCityNodes.forEach((entry) => {
        entry.node.title = `${entry.label}: ${formatTimeForZone(referenceDate, entry.timeZone)}`;
      });
    }

    describeOffsetFromUtc(timeZone) {
      const sample = new Date();
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        timeZoneName: "shortOffset",
        hour: "2-digit",
      }).formatToParts(sample);
      const zonePart = parts.find((part) => part.type === "timeZoneName");
      return zonePart?.value?.replace("GMT", "UTC") || timeZone;
    }

    applyRuntimeState(detail) {
      if (!detail) {
        return;
      }

      this.latestState = detail;
    }

    async resolveLocationLine() {
      const locationLabel = await this.resolveLocationLabelFromBrowser();
      this.elements.locationLine.textContent = locationLabel;
    }

    resolveBrowserPosition() {
      if (!global.navigator?.geolocation?.getCurrentPosition) {
        return Promise.reject(new Error("Browser geolocation unavailable."));
      }

      return new Promise((resolve, reject) => {
        global.navigator.geolocation.getCurrentPosition(
          (position) => resolve(position.coords),
          (error) => reject(error),
          {
            enableHighAccuracy: false,
            timeout: BROWSER_GEOLOCATION_TIMEOUT_MS,
            maximumAge: 5 * 60 * 1000,
          },
        );
      });
    }

    async resolveLocationLabelFromBrowser() {
      try {
        const coords = await this.resolveBrowserPosition();
        const reverseLabel = await this.reverseGeocode(coords);
        if (reverseLabel) {
          return `Time in ${reverseLabel} now:`;
        }
        return isWithinOmanBounds(coords) ? HERO_LOCATION.fallbackLine : HERO_LOCATION.genericLine;
      } catch (_error) {
        return HERO_LOCATION.fallbackLine;
      }
    }

    async reverseGeocode(coords) {
      if (!Number.isFinite(coords?.latitude) || !Number.isFinite(coords?.longitude)) {
        return null;
      }

      try {
        const url = new URL(REVERSE_GEOCODE_ENDPOINT);
        url.searchParams.set("format", "jsonv2");
        url.searchParams.set("lat", String(coords.latitude));
        url.searchParams.set("lon", String(coords.longitude));
        url.searchParams.set("zoom", "10");
        url.searchParams.set("accept-language", "en");

        const response = await fetchWithTimeout(
          url.toString(),
          {
            headers: {
              Accept: "application/json",
            },
          },
          REVERSE_GEOCODE_TIMEOUT_MS,
        );
        if (!response.ok) {
          return null;
        }

        const payload = await response.json();
        const address = payload?.address || {};
        const countryCode = String(address.country_code || "").toUpperCase();
        if (countryCode !== "OM") {
          return null;
        }
        const city = address.city || address.town || address.village || address.municipality || address.county;
        return city ? `${city}, Oman` : HERO_LOCATION.fallbackLabel;
      } catch (_error) {
        return null;
      }
    }

    getObservanceCacheKey(year) {
      return `${OBSERVANCE_CONFIG.cacheKeyPrefix}${year}`;
    }

    loadCachedObservances(year) {
      try {
        const raw = global.localStorage?.getItem(this.getObservanceCacheKey(year));
        if (!raw) {
          return null;
        }
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.entries)) {
          return null;
        }
        if (!Number.isFinite(parsed.cachedAt) || (Date.now() - parsed.cachedAt) > OBSERVANCE_CONFIG.cacheTtlMs) {
          return null;
        }
        return parsed.entries;
      } catch (_error) {
        return null;
      }
    }

    cacheObservances(year, entries) {
      try {
        global.localStorage?.setItem(this.getObservanceCacheKey(year), JSON.stringify({
          cachedAt: Date.now(),
          entries,
        }));
      } catch (_error) {
        // Ignore cache write failures (private mode / quota / disabled storage).
      }
    }

    async refreshObservanceCalendar() {
      const now = this.gpsTimeSync.getNow();
      const year = Number(OMAN_YEAR_FORMATTER.format(now));
      const cachedEntries = this.loadCachedObservances(year);
      if (cachedEntries) {
        this.observanceMap = this.createObservanceMap(cachedEntries);
        return;
      }

      try {
        const url = `https://date.nager.at/api/v3/PublicHolidays/${year}/${OBSERVANCE_CONFIG.countryCode}`;
        const response = await fetchWithTimeout(url, { headers: { Accept: "application/json" } }, OBSERVANCE_CONFIG.requestTimeoutMs);
        if (!response.ok) {
          return;
        }
        const payload = await response.json();
        if (!Array.isArray(payload)) {
          return;
        }
        const entries = payload
          .map((item) => ({
            date: typeof item?.date === "string" ? item.date : "",
            name: typeof item?.localName === "string" && item.localName.trim()
              ? item.localName.trim()
              : (typeof item?.name === "string" ? item.name.trim() : ""),
          }))
          .filter((item) => item.date && item.name);
        if (!entries.length) {
          return;
        }

        this.cacheObservances(year, entries);
        this.observanceMap = this.createObservanceMap(entries);
      } catch (_error) {
        this.observanceMap = new Map();
      }
    }

    createObservanceMap(entries) {
      const map = new Map();
      entries.forEach((entry) => {
        const [, month, day] = entry.date.split("-");
        if (!month || !day) {
          return;
        }
        const key = `${month}-${day}`;
        const current = map.get(key) || [];
        map.set(key, Array.from(new Set([...current, entry.name])));
      });
      return map;
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
      window.removeEventListener("beforeunload", this.boundUnload);
      this.gpsTimeSync.removeEventListener("gpstimeupdate", this.boundUpdate);
      this.gpsTimeSync.stopAutoSync();
      this.gpsTimeSync.stopStatusPolling();
    }
  }

  const boot = () => {
    new OfficialDigitalTimePage().init().catch((error) => {
      console.error("Official digital time page failed to initialize:", error);
    });
  };

  bootWhenDocumentReady(boot);
})(window);
