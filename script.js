const OMAN_TIMEZONE = "Asia/Muscat";
const SYNC_INTERVAL_MS = 5 * 60 * 1000;

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
};

let syncedEpochAtSample = Date.now();
let perfAtSample = performance.now();
let hasSuccessfulSync = false;

function pad(value, length = 2) {
  return String(value).padStart(length, "0");
}

function setMode(mode) {
  const isDigital = mode === "digital";
  elements.digitalClock.classList.toggle("hidden", !isDigital);
  elements.analogClock.classList.toggle("hidden", isDigital);
  elements.digitalModeBtn.classList.toggle("active", isDigital);
  elements.analogModeBtn.classList.toggle("active", !isDigital);
  elements.digitalModeBtn.setAttribute("aria-pressed", String(isDigital));
  elements.analogModeBtn.setAttribute("aria-pressed", String(!isDigital));
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
    hour12: false,
  }).formatToParts(now);

  const partMap = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    hour: Number(partMap.hour),
    minute: Number(partMap.minute),
    second: Number(partMap.second),
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
  elements.analogReadout.textContent = `${pad(oman.hour)}:${pad(oman.minute)}:${pad(oman.second)} GST`;

  requestAnimationFrame(render);
}

elements.digitalModeBtn.addEventListener("click", () => setMode("digital"));
elements.analogModeBtn.addEventListener("click", () => setMode("analog"));

setMode("digital");
syncWithTimeGov();
setInterval(syncWithTimeGov, SYNC_INTERVAL_MS);
requestAnimationFrame(render);
