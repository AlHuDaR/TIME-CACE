const fs = require("fs");
const path = require("path");

function loadDotEnv(filePath = path.join(__dirname, ".env")) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^(["'])(.*)\1$/, "$2");

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const net = require("net");

const app = express();

const CONFIG = Object.freeze({
  port: Number(process.env.PORT || 3000),
  gpsHost: process.env.GPS_HOST || "127.0.0.1",
  gpsPort: Number(process.env.GPS_PORT || 23),
  gpsUsername: process.env.GPS_USERNAME || "",
  gpsPassword: process.env.GPS_PASSWORD || "",
  allowedOrigin: process.env.ALLOWED_ORIGIN || "",
  omanOffsetMs: 4 * 60 * 60 * 1000,
  minConnectionIntervalMs: 5000,
  requestTimeoutMs: 15000,
});

const publicPath = path.resolve(__dirname);
let lastConnectionAttempt = 0;
let lastReceiverSnapshot = {
  backendOnline: true,
  receiverReachable: false,
  loginOk: false,
  isLocked: false,
  statusText: "Receiver status not checked yet",
  currentSource: "local",
  lastError: null,
  checkedAt: null,
};

app.use(cors({
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }

    if (!CONFIG.allowedOrigin) {
      callback(null, true);
      return;
    }

    callback(origin === CONFIG.allowedOrigin ? null : new Error("Origin not allowed by CORS"), origin === CONFIG.allowedOrigin);
  },
}));
app.use(express.json());
app.use(express.static(publicPath));

function createOmanDateFormatter(options = {}) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Muscat",
    ...options,
  });
}

const OMAN_DATE_FORMATTER = createOmanDateFormatter({
  month: "2-digit",
  day: "2-digit",
  year: "numeric",
});

const OMAN_TIME_FORMATTER = createOmanDateFormatter({
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function formatOmanDate(date) {
  return OMAN_DATE_FORMATTER.format(date);
}

function formatOmanTime(date) {
  return OMAN_TIME_FORMATTER.format(date);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function throttleReceiverAccess() {
  const now = Date.now();
  const elapsed = now - lastConnectionAttempt;
  if (elapsed < CONFIG.minConnectionIntervalMs) {
    await wait(CONFIG.minConnectionIntervalMs - elapsed);
  }
  lastConnectionAttempt = Date.now();
}

function createLocalFallback(extra = {}) {
  const now = new Date();
  return {
    success: false,
    source: "local",
    currentSource: "local",
    currentSourceLabel: "Local computer time",
    date: formatOmanDate(now),
    time: formatOmanTime(now),
    timezone: "GST (UTC+04:00)",
    timestamp: now.getTime(),
    backendOnline: true,
    receiverReachable: false,
    loginOk: false,
    isLocked: false,
    statusText: "Using local fallback",
    lastError: null,
    ...extra,
  };
}

async function getPreciseInternetTime() {
  const timeSources = [
    "https://time.google.com",
    "https://www.time.gov",
    "https://www.microsoft.com",
  ];

  const measurements = await Promise.allSettled(
    timeSources.map(async (url) => {
      const start = Date.now();
      const response = await fetch(url, { method: "HEAD", timeout: 5000 });
      const end = Date.now();
      return {
        url,
        rtt: end - start,
        date: response.headers.get("date"),
      };
    }),
  );

  const successful = measurements
    .filter((entry) => entry.status === "fulfilled" && entry.value.date)
    .map((entry) => entry.value);

  if (successful.length === 0) {
    throw new Error("No Internet time sources reachable");
  }

  const best = successful.reduce((previous, current) => (previous.rtt < current.rtt ? previous : current));
  const serverTime = new Date(best.date);
  const adjustedTime = new Date(serverTime.getTime() + Math.round(best.rtt / 2));

  return {
    timestamp: adjustedTime.getTime(),
    rtt: best.rtt,
    sourcesReached: successful.length,
  };
}

function parseGpsTimeResponse(raw) {
  const normalized = raw.replace(/\0/g, " ").replace(/\s+/g, " ").trim();
  const match = normalized.match(/F3\s+\w+\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/i)
    || normalized.match(/(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/);

  if (!match) {
    throw new Error("Could not parse receiver time response");
  }

  const [, dateStr, timeStr] = match;
  const [month, day, year] = dateStr.split("/").map(Number);
  const [hours, minutes, seconds] = timeStr.split(":").map(Number);
  const utcTimestamp = Date.UTC(year, month - 1, day, hours, minutes, seconds) - CONFIG.omanOffsetMs;

  const explicitUnlocked = /(UNLOCK|HOLDOVER|NO\s+GPS|ANTENNA\s+FAULT|SEARCHING)/i.test(normalized);
  const explicitLocked = /(LOCKED|TRACKING|GPS\s+LOCK)/i.test(normalized);
  const defaultDatePattern = /01\/01\/(1999|2000|2026)/.test(dateStr);
  const isLocked = explicitLocked ? true : explicitUnlocked ? false : !defaultDatePattern;
  const statusText = isLocked
    ? "GPS receiver reachable and locked"
    : "GPS receiver reachable but not locked";

  return {
    raw: normalized,
    date: dateStr,
    time: timeStr,
    timestamp: utcTimestamp,
    isLocked,
    statusText,
    currentSource: isLocked ? "gps-locked" : "gps-unlocked",
    currentSourceLabel: isLocked ? "GPS receiver locked" : "GPS receiver reachable but unlocked",
  };
}

function connectToGPS(command, { expectOk = false } = {}) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let buffer = "";
    let loginOk = false;
    let receiverReachable = false;
    let state = "connecting";
    let settled = false;

    const finish = (handler, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      handler(value);
    };

    const timeout = setTimeout(() => {
      finish(reject, new Error("Connection timeout"));
    }, CONFIG.requestTimeoutMs);

    socket.connect(CONFIG.gpsPort, CONFIG.gpsHost, () => {
      receiverReachable = true;
    });

    socket.on("data", (chunk) => {
      buffer += chunk.toString();

      if (state === "connecting" && buffer.includes("USER NAME:")) {
        state = "username";
        buffer = "";
        socket.write(`${CONFIG.gpsUsername}\r\n`);
        return;
      }

      if (state === "username" && buffer.includes("PASSWORD:")) {
        state = "password";
        buffer = "";
        socket.write(`${CONFIG.gpsPassword}\r\n`);
        return;
      }

      if (state === "password" && /LOGIN SUCCESSFUL!/i.test(buffer)) {
        loginOk = true;
        state = "command";
        buffer = "";
        setTimeout(() => {
          socket.write(command);
        }, 250);
        return;
      }

      if (state === "command") {
        const complete = expectOk ? /\bOK\b/i.test(buffer) : /F3|\d{2}\/\d{2}\/\d{4}/.test(buffer);
        if (complete) {
          finish(resolve, {
            receiverReachable,
            loginOk,
            raw: buffer,
          });
        }
      }
    });

    socket.on("error", (error) => {
      finish(reject, error);
    });

    socket.on("close", () => {
      if (settled) {
        return;
      }
      if (buffer && (expectOk ? /\bOK\b/i.test(buffer) : /F3|\d{2}\/\d{2}\/\d{4}/.test(buffer))) {
        finish(resolve, {
          receiverReachable,
          loginOk,
          raw: buffer,
        });
        return;
      }
      finish(reject, new Error(loginOk ? "Socket closed unexpectedly" : "Receiver login failed or socket closed unexpectedly"));
    });
  });
}

function updateReceiverSnapshot(snapshot) {
  lastReceiverSnapshot = {
    backendOnline: true,
    checkedAt: new Date().toISOString(),
    ...snapshot,
  };
  return lastReceiverSnapshot;
}

async function readReceiverTime() {
  await throttleReceiverAccess();

  const connection = await connectToGPS("F3\r\n");
  const parsed = parseGpsTimeResponse(connection.raw);

  const snapshot = updateReceiverSnapshot({
    receiverReachable: connection.receiverReachable,
    loginOk: connection.loginOk,
    isLocked: parsed.isLocked,
    statusText: parsed.statusText,
    currentSource: parsed.currentSource,
    lastError: null,
  });

  return {
    success: true,
    source: "gps-receiver",
    timezone: "GST (UTC+04:00)",
    backendOnline: true,
    receiverReachable: snapshot.receiverReachable,
    loginOk: snapshot.loginOk,
    isLocked: snapshot.isLocked,
    statusText: snapshot.statusText,
    currentSource: snapshot.currentSource,
    currentSourceLabel: parsed.currentSourceLabel,
    lastError: null,
    date: parsed.date,
    time: parsed.time,
    timestamp: parsed.timestamp,
    raw: parsed.raw,
  };
}

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    backendOnline: true,
  });
});

app.get("/api/status", async (req, res) => {
  try {
    const receiverTime = await readReceiverTime();
    res.json({
      backendOnline: true,
      receiverReachable: receiverTime.receiverReachable,
      loginOk: receiverTime.loginOk,
      isLocked: receiverTime.isLocked,
      statusText: receiverTime.statusText,
      currentSource: receiverTime.currentSource,
      lastError: null,
      checkedAt: lastReceiverSnapshot.checkedAt,
    });
  } catch (error) {
    const snapshot = updateReceiverSnapshot({
      receiverReachable: false,
      loginOk: false,
      isLocked: false,
      statusText: "Receiver unreachable",
      currentSource: "local",
      lastError: error.message,
    });

    res.status(503).json({
      ...snapshot,
      backendOnline: true,
    });
  }
});

app.get("/api/time", async (req, res) => {
  try {
    const receiverTime = await readReceiverTime();
    res.json(receiverTime);
  } catch (error) {
    const fallback = createLocalFallback({
      error: error.message,
      statusText: "GPS receiver unavailable",
      lastError: error.message,
    });

    updateReceiverSnapshot({
      receiverReachable: false,
      loginOk: false,
      isLocked: false,
      statusText: fallback.statusText,
      currentSource: "local",
      lastError: error.message,
    });

    res.status(503).json(fallback);
  }
});

app.post("/api/time/set", async (req, res) => {
  try {
    const useInternet = Boolean(req.body?.useInternet);
    let omanTimestamp;
    let source;

    if (useInternet) {
      const internetTime = await getPreciseInternetTime();
      omanTimestamp = internetTime.timestamp + CONFIG.omanOffsetMs;
      source = "Internet";
    } else {
      omanTimestamp = Date.now() + CONFIG.omanOffsetMs;
      source = "Computer";
    }

    const omanDate = new Date(omanTimestamp);
    const mm = String(omanDate.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(omanDate.getUTCDate()).padStart(2, "0");
    const yyyy = omanDate.getUTCFullYear();
    const hh = String(omanDate.getUTCHours()).padStart(2, "0");
    const min = String(omanDate.getUTCMinutes()).padStart(2, "0");
    const ss = String(omanDate.getUTCSeconds()).padStart(2, "0");

    await throttleReceiverAccess();
    const command = `F3 UTC ${mm}/${dd}/${yyyy} ${hh}:${min}:${ss}\r\n`;
    const result = await connectToGPS(command, { expectOk: true });

    updateReceiverSnapshot({
      receiverReachable: result.receiverReachable,
      loginOk: result.loginOk,
      isLocked: lastReceiverSnapshot.isLocked,
      statusText: "Receiver time updated successfully",
      currentSource: lastReceiverSnapshot.currentSource,
      lastError: null,
    });

    res.json({
      success: true,
      message: "GPS time set successfully",
      date: `${mm}/${dd}/${yyyy}`,
      time: `${hh}:${min}:${ss}`,
      timezone: "GST (UTC+04:00)",
      source,
      backendOnline: true,
    });
  } catch (error) {
    updateReceiverSnapshot({
      receiverReachable: false,
      loginOk: false,
      isLocked: false,
      statusText: "Failed to set receiver time",
      currentSource: "local",
      lastError: error.message,
    });

    res.status(500).json({
      success: false,
      error: error.message,
      backendOnline: true,
    });
  }
});

app.get("/api/time/ntp", async (req, res) => {
  try {
    const internetTime = await getPreciseInternetTime();
    const omanDisplayTime = new Date(internetTime.timestamp + CONFIG.omanOffsetMs);

    res.json({
      success: true,
      source: "internet-ntp",
      currentSource: "internet-fallback",
      currentSourceLabel: "Internet fallback",
      date: formatOmanDate(omanDisplayTime),
      time: formatOmanTime(omanDisplayTime),
      timezone: "GST (UTC+04:00)",
      timestamp: internetTime.timestamp,
      backendOnline: true,
      receiverReachable: lastReceiverSnapshot.receiverReachable,
      loginOk: lastReceiverSnapshot.loginOk,
      isLocked: false,
      statusText: "Using Internet time fallback via backend",
      lastError: null,
      rtt: internetTime.rtt,
      sourcesReached: internetTime.sourcesReached,
    });
  } catch (error) {
    const fallback = createLocalFallback({
      error: error.message,
      statusText: "Internet time fallback unavailable",
      lastError: error.message,
    });

    res.status(503).json(fallback);
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(CONFIG.port, () => {
  console.log(`GPS backend listening on http://localhost:${CONFIG.port}`);
  console.log(`Receiver target: ${CONFIG.gpsHost}:${CONFIG.gpsPort}`);
  console.log(`CORS origin: ${CONFIG.allowedOrigin || "* (unset)"}`);
});
