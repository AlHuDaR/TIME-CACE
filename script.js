const OMAN_TIMEZONE = "Asia/Muscat";
const SYNC_INTERVAL_MS = 5 * 60 * 1000;
const MODE_TRANSITION_MS = 260;

const elements = {
  hours: document.getElementById("hours"),
  minutes: document.getElementById("minutes"),
  seconds: document.getElementById("seconds"),
  milliseconds: document.getElementById("milliseconds"),
  dateLine: document.getElementById("dateLine"),
  syncStatus: document.getElementById("syncStatus"),
  hourHand: document.getElementById("hourHand"),
  minuteHand: document.getElementById("minuteHand"),
  secondHand: document.getElementById("secondHand"),
  analogReadout: document.getElementById("analogReadout"),
  digitalClock: document.getElementById("digitalClock"),
  analogClock: document.getElementById("analogClock"),
  digitalModeBtn: document.getElementById("digitalModeBtn"),
  analogModeBtn: document.getElementById("analogModeBtn"),
  analogOnlyBtn: document.getElementById("analogOnlyBtn"),
  exitFullscreenBtn: document.getElementById("exitFullscreenBtn"), // ADDED: Exit button
};

const analogDial = elements.analogClock.querySelector(".analog-clock");

let syncedEpochAtSample = Date.now();
let perfAtSample = performance.now();
let hasSuccessfulSync = false;

function pad(value, length = 2) {
  return String(value).padStart(length, "0");
}

function applyFavicon() {
  let favicon = document.querySelector("link[rel='icon']");
  if (!favicon) {
    favicon = document.createElement("link");
    favicon.rel = "icon";
    document.head.append(favicon);
  }
  favicon.href = "images/cal logo.png";
}

function buildAnalogDial() {
  for (const mark of analogDial.querySelectorAll(".analog-mark, .tick")) {
    mark.remove();
  }

  for (let i = 0; i < 60; i += 1) {
    const tick = document.createElement("span");
    tick.className = i % 5 === 0 ? "tick major" : "tick";
    tick.style.transform = `translate(-50%, -50%) rotate(${i * 6}deg)`;
    analogDial.append(tick);
  }

  const numberRadius = 41;

  for (let i = 1; i <= 12; i += 1) {
    const number = document.createElement("span");
    const angle = ((i % 12) * Math.PI) / 6;
    const x = 50 + numberRadius * Math.sin(angle);
    const y = 50 - numberRadius * Math.cos(angle);

    number.className = "analog-mark";
    number.textContent = String(i);
    number.style.left = `${x}%`;
    number.style.top = `${y}%`;

    analogDial.append(number);
  }

  if (elements.analogReadout.parentElement !== analogDial) {
    analogDial.append(elements.analogReadout);
  }
}

function showSection(section) {
  section.classList.remove("hidden");
  section.classList.remove("is-fading");
  section.classList.add("is-visible");
}

function hideSection(section) {
  section.classList.add("is-fading");
  section.classList.remove("is-visible");
  window.setTimeout(() => {
    section.classList.add("hidden");
    section.classList.remove("is-fading");
  }, MODE_TRANSITION_MS);
}

function updateUrl(mode) {
  const url = new URL(window.location);
  if (mode === 'analog-only') {
    url.searchParams.set('mode', 'analog-only');
  } else {
    url.searchParams.delete('mode');
  }
  window.history.replaceState({}, '', url);
}

function setMode(mode) {
  document.body.classList.remove("analog-only");
  
  const isDigital = mode === "digital";

  if (isDigital) {
    showSection(elements.digitalClock);
    hideSection(elements.analogClock);
  } else {
    showSection(elements.analogClock);
    hideSection(elements.digitalClock);
  }

  elements.digitalModeBtn.classList.toggle("active", isDigital);
  elements.analogModeBtn.classList.toggle("active", !isDigital);
  elements.analogOnlyBtn.classList.remove("active");
  elements.digitalModeBtn.setAttribute("aria-pressed", String(isDigital));
  elements.analogModeBtn.setAttribute("aria-pressed", String(!isDigital));
  elements.analogOnlyBtn.setAttribute("aria-pressed", "false");
  
  updateUrl(mode);
}

function setAnalogOnlyMode() {
  document.body.classList.add("analog-only");
  
  elements.digitalClock.classList.add("hidden");
  elements.digitalClock.classList.remove("is-visible");
  elements.analogClock.classList.remove("hidden");
  elements.analogClock.classList.add("is-visible");
  
  elements.digitalModeBtn.classList.remove("active");
  elements.analogModeBtn.classList.remove("active");
  elements.analogOnlyBtn.classList.add("active");
  
  elements.digitalModeBtn.setAttribute("aria-pressed", "false");
  elements.analogModeBtn.setAttribute("aria-pressed", "false");
  elements.analogOnlyBtn.setAttribute("aria-pressed", "true");
  
  updateUrl('analog-only');
}

// ADDED: Function to exit fullscreen and return to main menu
function exitFullscreenMode() {
  document.body.classList.remove("analog-only");
  
  // Return to normal digital mode (Old style watch)
  setMode("digital");
  
  // Clear URL parameter
  const url = new URL(window.location);
  url.searchParams.delete('mode');
  window.history.replaceState({}, '', url);
}

// ADDED: Keyboard support - Press ESC to exit fullscreen
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' && document.body.classList.contains('analog-only')) {
    exitFullscreenMode();
  }
});

function checkUrlParams() {
  const params = new URLSearchParams(window.location.search);
  return params.get('mode');
}

async function syncWithTimeGov() {
  const url = `https://time.gov/actualtime.cgi?lzbc=siqm9b&cacheBust=${Date.now()}`;

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    });

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

    syncedEpochAtSample = epochMs;
    perfAtSample = performance.now();
    hasSuccessfulSync = true;
    elements.syncStatus.textContent = `Sync status: locked to time.gov (${new Date().toLocaleTimeString()})`;
  } catch (error) {
    const prefix = hasSuccessfulSync ? "re-using previous lock" : "using local clock until first lock";
    elements.syncStatus.textContent = `Sync status: ${prefix} (${error.message})`;
  }
}

function getNowFromSyncedClock() {
  const elapsedMs = performance.now() - perfAtSample;
  return new Date(syncedEpochAtSample + elapsedMs);
}

function getOmanParts(now) {
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

  const partMap = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    hour: Number(partMap.hour),
    minute: Number(partMap.minute),
    second: Number(partMap.second),
    date: `${partMap.day}.${partMap.month}.${partMap.year}`,
  };
}

function render() {
  const now = getNowFromSyncedClock();
  const oman = getOmanParts(now);

  elements.hours.textContent = pad(oman.hour);
  elements.minutes.textContent = pad(oman.minute);
  elements.seconds.textContent = pad(oman.second);

  const omanMs = now.getUTCMilliseconds();
  elements.milliseconds.textContent = pad(omanMs, 3);

  elements.dateLine.textContent = new Intl.DateTimeFormat("en-GB", {
    timeZone: OMAN_TIMEZONE,
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(now);

  const secondProgress = oman.second + omanMs / 1000;
  const minuteProgress = oman.minute + secondProgress / 60;
  const hourProgress = (oman.hour % 12) + minuteProgress / 60;

  elements.secondHand.style.transform = `translateX(-50%) rotate(${secondProgress * 6}deg)`;
  elements.minuteHand.style.transform = `translateX(-50%) rotate(${minuteProgress * 6}deg)`;
  elements.hourHand.style.transform = `translateX(-50%) rotate(${hourProgress * 30}deg)`;
  
  // EXPLICIT BLOCK DISPLAY - Time on TOP, Date on BOTTOM
  elements.analogReadout.innerHTML = 
    `<span style="display:block;">${pad(oman.hour)}:${pad(oman.minute)}:${pad(oman.second)}</span>` +
    `<span style="display:block;">${oman.date}</span>`;

  requestAnimationFrame(render);
}

// Event listeners
elements.digitalModeBtn.addEventListener("click", () => setMode("digital"));
elements.analogModeBtn.addEventListener("click", () => setMode("analog"));
elements.analogOnlyBtn.addEventListener("click", setAnalogOnlyMode);

// ADDED: Exit button event listener
if (elements.exitFullscreenBtn) {
  elements.exitFullscreenBtn.addEventListener("click", exitFullscreenMode);
}

// Initialize
applyFavicon();
buildAnalogDial();

// Check URL on load - if ?mode=analog-only, show fullscreen analog immediately
const initialMode = checkUrlParams();
if (initialMode === 'analog-only') {
  setAnalogOnlyMode();
} else {
  setMode("digital");
}

syncWithTimeGov();
setInterval(syncWithTimeGov, SYNC_INTERVAL_MS);
requestAnimationFrame(render);
