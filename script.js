const OMAN_TIMEZONE = "Asia/Muscat";
const SYNC_INTERVAL_MS = 5 * 60 * 1000;

const elements = {
  hours: document.getElementById("hours"),
  minutes: document.getElementById("minutes"),
  seconds: document.getElementById("seconds"),
  milliseconds: document.getElementById("milliseconds"),
  dateLine: document.getElementById("dateLine"),
  syncStatus: document.getElementById("syncStatus"),
};

let syncedEpochAtSample = Date.now();
let perfAtSample = performance.now();
let hasSuccessfulSync = false;

function pad(value, length = 2) {
  return String(value).padStart(length, "0");
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

    // `time` is microseconds since Unix epoch.
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

function render() {
  const now = getNowFromSyncedClock();

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: OMAN_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const partMap = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  elements.hours.textContent = partMap.hour;
  elements.minutes.textContent = partMap.minute;
  elements.seconds.textContent = partMap.second;

  const omanMs = now.getUTCMilliseconds();
  elements.milliseconds.textContent = pad(omanMs, 3);

  elements.dateLine.textContent = new Intl.DateTimeFormat("en-GB", {
    timeZone: OMAN_TIMEZONE,
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(now);

  requestAnimationFrame(render);
}

syncWithTimeGov();
setInterval(syncWithTimeGov, SYNC_INTERVAL_MS);
requestAnimationFrame(render);
