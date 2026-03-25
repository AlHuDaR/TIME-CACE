const net = require("net");

function validateFiniteNumber(name, value, { min = -Infinity, max = Infinity, integer = false } = {}) {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid ${name}: expected a finite number`);
  }

  if (integer && !Number.isInteger(value)) {
    throw new Error(`Invalid ${name}: expected an integer`);
  }

  if (value < min || value > max) {
    throw new Error(`Invalid ${name}: expected a value between ${min} and ${max}`);
  }

  return value;
}

function validateConfig(config) {
  const validated = {
    ...config,
    port: validateFiniteNumber("PORT", config.port, { min: 1, max: 65535, integer: true }),
    gpsPort: validateFiniteNumber("GPS_PORT", config.gpsPort, { min: 1, max: 65535, integer: true }),
    minConnectionIntervalMs: validateFiniteNumber("MIN_CONNECTION_INTERVAL_MS", config.minConnectionIntervalMs, { min: 0, max: 300000, integer: true }),
    requestTimeoutMs: validateFiniteNumber("REQUEST_TIMEOUT_MS", config.requestTimeoutMs, { min: 100, max: 300000, integer: true }),
    receiverStatusCacheMs: validateFiniteNumber("RECEIVER_STATUS_CACHE_MS", config.receiverStatusCacheMs, { min: 0, max: 300000, integer: true }),
    statusStaleMs: validateFiniteNumber("STATUS_STALE_MS", config.statusStaleMs, { min: 1000, max: 86400000, integer: true }),
    receiverReconnectInitialMs: validateFiniteNumber("RECEIVER_RECONNECT_INITIAL_MS", config.receiverReconnectInitialMs ?? 1000, { min: 0, max: 300000, integer: true }),
    receiverReconnectMaxMs: validateFiniteNumber("RECEIVER_RECONNECT_MAX_MS", config.receiverReconnectMaxMs ?? 15000, { min: 100, max: 300000, integer: true }),
    receiverConnectStabilizationMs: validateFiniteNumber("RECEIVER_CONNECT_STABILIZATION_MS", config.receiverConnectStabilizationMs ?? 220, { min: 0, max: 5000, integer: true }),
    receiverDetailCacheMs: validateFiniteNumber("GPS_DETAIL_CACHE_MS", config.receiverDetailCacheMs ?? 30000, { min: 0, max: 300000, integer: true }),
    rateLimitWindowMs: validateFiniteNumber("RATE_LIMIT_WINDOW_MS", config.rateLimitWindowMs, { min: 1000, max: 86400000, integer: true }),
    rateLimitTimeMax: validateFiniteNumber("RATE_LIMIT_TIME_MAX", config.rateLimitTimeMax, { min: 1, max: 100000, integer: true }),
    rateLimitStatusMax: validateFiniteNumber("RATE_LIMIT_STATUS_MAX", config.rateLimitStatusMax, { min: 1, max: 100000, integer: true }),
    rateLimitInternetMax: validateFiniteNumber("RATE_LIMIT_INTERNET_MAX", config.rateLimitInternetMax, { min: 1, max: 100000, integer: true }),
    rateLimitSetMax: validateFiniteNumber("RATE_LIMIT_SET_MAX", config.rateLimitSetMax, { min: 1, max: 100000, integer: true }),
    ntpTimeoutMs: validateFiniteNumber("NTP_TIMEOUT_MS", config.ntpTimeoutMs, { min: 100, max: 300000, integer: true }),
    httpsApiTimeoutMs: validateFiniteNumber("HTTPS_TIME_API_TIMEOUT_MS", config.httpsApiTimeoutMs, { min: 100, max: 300000, integer: true }),
    httpDateTimeoutMs: validateFiniteNumber("HTTP_DATE_TIMEOUT_MS", config.httpDateTimeoutMs, { min: 100, max: 300000, integer: true }),
    receiverEnabled: Boolean(config.receiverEnabled),
  };

  validated.gpsHost = String(validated.gpsHost || "").trim();
  validated.gpsUsername = String(validated.gpsUsername || "").trim();
  validated.gpsPassword = String(validated.gpsPassword || "").trim();

  if (validated.receiverEnabled) {
    if (!validated.gpsHost) {
      throw new Error("Invalid GPS_HOST: receiver mode requires a host value");
    }

    if (!validated.gpsUsername) {
      throw new Error("Invalid GPS_USERNAME: receiver mode requires a username");
    }

    if (!validated.gpsPassword) {
      throw new Error("Invalid GPS_PASSWORD: receiver mode requires a password");
    }
  }

  if (validated.authEnabled && !String(validated.authToken || "").trim()) {
    throw new Error("Invalid API_AUTH_TOKEN: API auth is enabled but no token is configured");
  }

  if (validated.receiverStatusCacheMs > validated.statusStaleMs) {
    throw new Error("Invalid config: RECEIVER_STATUS_CACHE_MS must be less than or equal to STATUS_STALE_MS");
  }

  if (validated.receiverReconnectInitialMs > validated.receiverReconnectMaxMs) {
    throw new Error("Invalid config: RECEIVER_RECONNECT_INITIAL_MS must be less than or equal to RECEIVER_RECONNECT_MAX_MS");
  }

  return Object.freeze(validated);
}

function normalizeReceiverRaw(raw) {
  return String(raw || "").replace(/\0/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeReceiverLine(raw) {
  return String(raw || "").replace(/\0/g, " ").trim();
}

function parseReceiverAcknowledgement(raw) {
  const normalized = normalizeReceiverRaw(raw);
  return {
    raw: normalized,
    acknowledged: /\bOK\b/i.test(normalized),
  };
}

function parseGpsTimeResponse(raw) {
  const normalized = normalizeReceiverRaw(raw);
  const explicitMatch = normalized.match(/F3\s+(\w+)\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/i);
  const fallbackMatch = explicitMatch
    ? null
    : normalized.match(/(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/);

  if (!explicitMatch && !fallbackMatch) {
    throw new Error("Could not parse receiver time response");
  }

  const timeMode = explicitMatch ? explicitMatch[1] : "UTC";
  const dateStr = explicitMatch ? explicitMatch[2] : fallbackMatch[1];
  const timeStr = explicitMatch ? explicitMatch[3] : fallbackMatch[2];
  const [month, day, year] = dateStr.split("/").map(Number);
  const [hours, minutes, seconds] = timeStr.split(":").map(Number);
  const utcTimestamp = Date.UTC(year, month - 1, day, hours, minutes, seconds);

  const hasHoldover = /HOLDOVER/i.test(normalized);
  const explicitUnlocked = /(UNLOCK|NO\s+GPS|ANTENNA\s+FAULT|SEARCHING)/i.test(normalized);
  const explicitLocked = /(LOCKED|TRACKING|GPS\s+LOCK)/i.test(normalized);
  const defaultDatePattern = /01\/01\/(1999|2000|2026)/.test(dateStr);
  const gpsLockState = explicitLocked
    ? "locked"
    : hasHoldover
      ? "holdover"
      : explicitUnlocked
        ? "unlocked"
        : defaultDatePattern
          ? "unknown"
          : "locked";
  const isLocked = gpsLockState === "locked";
  const statusText = gpsLockState === "locked"
    ? "GPS receiver reachable and locked"
    : gpsLockState === "holdover"
      ? "Receiver reachable and operating in holdover"
      : gpsLockState === "unlocked"
        ? "GPS receiver reachable but not locked"
        : "GPS receiver reachable but lock state is unknown";

  return {
    raw: normalized,
    receiverDate: dateStr,
    receiverTime: timeStr,
    receiverTimeMode: timeMode.toUpperCase(),
    timestamp: utcTimestamp,
    isLocked,
    gpsLockState,
    statusText,
    currentSource: gpsLockState === "locked" ? "gps-locked" : gpsLockState === "holdover" ? "holdover" : "gps-unlocked",
    currentSourceLabel: gpsLockState === "locked"
      ? "GPS receiver locked"
      : gpsLockState === "holdover"
        ? "Receiver holdover"
        : gpsLockState === "unlocked"
          ? "GPS receiver unlocked"
          : "Receiver source unknown",
  };
}

function parseVersionToken(raw, pattern) {
  const match = normalizeReceiverRaw(raw).match(pattern);
  return match ? match[1].trim() : null;
}

function parseGpsReceiverInfo(raw) {
  const normalized = normalizeReceiverRaw(raw);
  if (!normalized) {
    return {
      raw: normalized,
      boardPartNumber: null,
      softwareVersion: null,
      fpgaVersion: null,
      gpsStatus: null,
      antennaStatus: null,
      acquisitionState: null,
    };
  }

  const captureField = (fieldName, nextFields = []) => {
    const lookahead = nextFields.length > 0
      ? `(?=\\s+(?:${nextFields.join("|")})\\b|$)`
      : "$";
    const expression = new RegExp(`\\b${fieldName}\\b[:#\\s]+(.+?)${lookahead}`, "i");
    const match = normalized.match(expression);
    return match ? match[1].trim() : null;
  };

  return {
    raw: normalized,
    boardPartNumber: captureField("GPS\\s+PART\\s+NUMBER", ["SOFTWARE", "FPGA", "GPS\\s+STATUS", "GPS\\s+ANTENNA", "GPS\\s+ACQUISITION"]) || null,
    softwareVersion: parseVersionToken(normalized, /\bSOFTWARE\s+([^\s]+)(?=\s+(?:FPGA|GPS\s+STATUS|GPS\s+ANTENNA|GPS\s+ACQUISITION)|$)/i),
    fpgaVersion: parseVersionToken(normalized, /\bFPGA\s*#?\s+([^\s]+)(?=\s+(?:GPS\s+STATUS|GPS\s+ANTENNA|GPS\s+ACQUISITION)|$)/i),
    gpsStatus: captureField("GPS\\s+STATUS", ["GPS\\s+ANTENNA", "GPS\\s+ACQUISITION"]) || null,
    antennaStatus: captureField("GPS\\s+ANTENNA", ["GPS\\s+ACQUISITION"]) || null,
    acquisitionState: captureField("GPS\\s+ACQUISITION\\s+STATE", []) || null,
  };
}

function parseCoordinateDms(raw) {
  const match = String(raw || "").match(/^([NSEW])\s*(\d+(?:\.\d+)?)d\s*(\d+(?:\.\d+)?)'?\s*(\d+(?:\.\d+)?)?"?$/i);
  if (!match) {
    return null;
  }

  const hemisphere = match[1].toUpperCase();
  const degrees = Number(match[2]);
  const minutes = Number(match[3]);
  const seconds = Number(match[4] || 0);
  const sign = ["S", "W"].includes(hemisphere) ? -1 : 1;
  return sign * (degrees + (minutes / 60) + (seconds / 3600));
}

function parseGpsPosition(raw) {
  const normalized = normalizeReceiverRaw(raw);
  if (!normalized) {
    return {
      raw: normalized,
      mode: null,
      latitude: null,
      longitude: null,
      altitudeMeters: null,
      xMeters: null,
      yMeters: null,
      zMeters: null,
    };
  }

  const llaMatch = normalized.match(/\b(?:F50(?:\s+\w+)?)?\s*(?:LLA\s+)?([NS][^EW+-]+?)\s+([EW][^+-]+?)\s+([+-]?\d+(?:\.\d+)?)\s*m\b/i);
  if (llaMatch) {
    const latitudeText = llaMatch[1].trim();
    const longitudeText = llaMatch[2].trim();
    return {
      raw: normalized,
      mode: "lla",
      latitude: {
        text: latitudeText,
        decimalDegrees: parseCoordinateDms(latitudeText),
      },
      longitude: {
        text: longitudeText,
        decimalDegrees: parseCoordinateDms(longitudeText),
      },
      altitudeMeters: Number(llaMatch[3]),
      xMeters: null,
      yMeters: null,
      zMeters: null,
    };
  }

  const xyzMatch = normalized.match(/\b(?:F50(?:\s+\w+)?)?\s*(?:XYZ\s+)?([+-]?\d+(?:\.\d+)?)\s*m?\s+([+-]?\d+(?:\.\d+)?)\s*m?\s+([+-]?\d+(?:\.\d+)?)\s*m?\b/i);
  if (xyzMatch) {
    return {
      raw: normalized,
      mode: "xyz",
      latitude: null,
      longitude: null,
      altitudeMeters: null,
      xMeters: Number(xyzMatch[1]),
      yMeters: Number(xyzMatch[2]),
      zMeters: Number(xyzMatch[3]),
    };
  }

  throw new Error("Could not parse GPS position response");
}

function titleCaseWords(tokens = []) {
  return tokens
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
    .join(" ");
}

function parseGpsSatelliteList(raw) {
  const lines = String(raw || "")
    .replace(/\0/g, " ")
    .split(/\r?\n/)
    .map((line) => normalizeReceiverLine(line))
    .filter(Boolean);

  const satellites = [];
  const utilizationWords = new Set(["CURRENT", "TRACKED", "TRACKING", "USED", "UTILIZED"]);

  for (const line of lines) {
    const match = line.match(/(?:PRN\s*)?(\d{1,2})\b\s+(.+?)\s+(-?\d+(?:\.\d+)?)\s*dBW\b/i);
    if (!match) {
      continue;
    }

    const prn = Number(match[1]);
    const middleTokens = match[2]
      .trim()
      .split(/\s+/)
      .map((token) => token.toUpperCase())
      .filter(Boolean);
    const statusTokens = middleTokens.filter((token) => !utilizationWords.has(token));
    const utilization = [];

    if (middleTokens.includes("CURRENT")) {
      utilization.push("Current");
    }
    if (middleTokens.includes("TRACKED") || middleTokens.includes("TRACKING")) {
      utilization.push("Tracked");
    }
    if (middleTokens.includes("USED") || middleTokens.includes("UTILIZED")) {
      utilization.push("Used");
    }

    satellites.push({
      prn,
      status: titleCaseWords(statusTokens) || "Unknown",
      utilization: utilization.join(" + ") || "Available",
      levelDbw: Number(match[3]),
      raw: normalizeReceiverRaw(line),
    });
  }

  return {
    raw: normalizeReceiverRaw(raw),
    satellites: satellites.sort((left, right) => left.prn - right.prn),
  };
}

function classifyReceiverError(error) {
  const message = error?.message || "Receiver error";

  if (/receiver (is )?not configured|receiver disabled/i.test(message)) {
    return {
      receiverConfigured: false,
      receiverReachable: false,
      loginOk: false,
      receiverCommunicationState: "disabled",
      statusText: "Receiver not configured",
      lastError: message,
    };
  }

  if (/GPS receiver reachable but not locked|holdover|GPS_UNLOCKED/i.test(message)) {
    return {
      receiverConfigured: true,
      receiverReachable: true,
      loginOk: true,
      receiverCommunicationState: "authenticated",
      statusText: message,
      lastError: message,
    };
  }

  if (/login failed|authentication failed|access denied|invalid password/i.test(message)) {
    return {
      receiverConfigured: true,
      receiverReachable: true,
      loginOk: false,
      receiverCommunicationState: "login-failed",
      statusText: "Receiver reachable but login failed",
      lastError: message,
    };
  }

  if (/auth[_-\s]?recovery|authentication not ready|socket closed unexpectedly/i.test(message) || error?.code === "RECEIVER_AUTH_RECOVERY") {
    return {
      receiverConfigured: true,
      receiverReachable: true,
      loginOk: false,
      receiverCommunicationState: "auth-recovery",
      statusText: "Receiver reachable; authentication recovery in progress",
      lastError: message,
    };
  }

  if (/timeout|ECONNREFUSED|EHOSTUNREACH|ENOTFOUND|socket closed unexpectedly|receiver disconnected|receiver not connected/i.test(message)) {
    return {
      receiverConfigured: true,
      receiverReachable: false,
      loginOk: false,
      receiverCommunicationState: "unreachable",
      statusText: "Receiver unreachable",
      lastError: message,
    };
  }

  return {
    receiverConfigured: true,
    receiverReachable: false,
    loginOk: false,
    receiverCommunicationState: "unreachable",
    statusText: "Receiver communication failed",
    lastError: message,
  };
}

function createCommandError(message, code, extras = {}) {
  const error = new Error(message);
  error.code = code;
  return Object.assign(error, extras);
}

class ReceiverConnectionManager {
  constructor({
    host,
    port,
    username,
    password,
    commandTimeoutMs = 3000,
    idleGraceMs = 140,
    reconnectInitialMs = 1000,
    reconnectMaxMs = 15000,
    connectStabilizationMs = 220,
    logger = console,
  }) {
    this.host = host;
    this.port = port;
    this.username = username;
    this.password = password;
    this.commandTimeoutMs = commandTimeoutMs;
    this.idleGraceMs = idleGraceMs;
    this.reconnectInitialMs = reconnectInitialMs;
    this.reconnectMaxMs = reconnectMaxMs;
    this.connectStabilizationMs = connectStabilizationMs;
    this.logger = logger;

    this.socket = null;
    this.connectPromise = null;
    this.commandQueue = Promise.resolve();
    this.reconnectTimer = null;
    this.commandTimer = null;
    this.commandIdleTimer = null;
    this.commandFinalized = false;
    this.expectedClose = false;
    this.isClosing = false;
    this.state = "idle";
    this.connectionGeneration = 0;
    this.lastSuccessfulCommunicationAt = null;
    this.lastConnectedAt = null;
    this.lastAuthenticatedAt = null;
    this.lastError = null;
    this.reconnectAttempt = 0;
    this.currentCommand = null;
    this.buffer = "";
    this.handshakeBuffer = "";
    this.authAttemptInProgress = false;
  }

  getStateSnapshot() {
    const connected = this.state === "authenticated";
    return {
      connected,
      connecting: this.state === "connecting" || this.state === "authenticating",
      reconnecting: this.state === "reconnecting",
      state: this.state,
      lastConnectedAt: this.lastConnectedAt,
      lastAuthenticatedAt: this.lastAuthenticatedAt,
      lastSuccessfulCommunicationAt: this.lastSuccessfulCommunicationAt,
      lastError: this.lastError?.message || null,
      reconnectAttempt: this.reconnectAttempt,
    };
  }

  async sendCommand(command, options = {}) {
    const task = async () => {
      const connection = await this.ensureConnected();
      return this.executeCommand(connection.generation, command, options);
    };

    const queued = this.commandQueue.then(task, task);
    this.commandQueue = queued.catch(() => undefined);
    return queued;
  }

  async ensureConnected({ triggerReconnect = true } = {}) {
    if (this.socket && this.state === "authenticated" && !this.socket.destroyed) {
      return { generation: this.connectionGeneration };
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.clearReconnectTimer();
    this.connectPromise = this.openConnection()
      .finally(() => {
        this.connectPromise = null;
      });

    try {
      return await this.connectPromise;
    } catch (error) {
      if (triggerReconnect) {
        this.scheduleReconnect(error, { immediate: true });
      }
      throw error;
    }
  }

  async openConnection() {
    this.resetSessionState();
    this.destroySocket({ preserveReconnect: true });
    this.state = "connecting";
    this.authAttemptInProgress = true;

    const socket = new net.Socket();
    const generation = this.connectionGeneration + 1;

    return new Promise((resolve, reject) => {
      let stage = "await-banner";
      let settled = false;
      let stabilizeTimer = null;
      let connected = false;
      const timeoutId = setTimeout(() => {
        rejectConnection(createCommandError("Receiver connection timeout", "RECEIVER_CONNECT_TIMEOUT"));
      }, this.commandTimeoutMs);

      const finish = (handler, value) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutId);
        handler(value);
      };

      const rejectConnection = (error) => {
        this.lastError = error;
        this.log("warn", `Receiver connection/authentication failed: ${error.message}`);
        clearTimeout(stabilizeTimer);
        this.authAttemptInProgress = false;
        try {
          socket.destroy();
        } catch (destroyError) {
          void destroyError;
        }
        finish(reject, error);
      };

      socket.setNoDelay(true);
      socket.setKeepAlive(true, 1000);

      socket.once("connect", () => {
        connected = true;
        this.state = "authenticating";
        this.lastConnectedAt = new Date().toISOString();
        this.log("info", `Receiver connection established to ${this.host}:${this.port}.`);
        stabilizeTimer = setTimeout(() => {
          if (!settled && stage === "await-banner") {
            stage = "await-username";
          }
        }, this.connectStabilizationMs);
      });

      socket.on("data", (chunk) => {
        const text = chunk.toString();
        this.handshakeBuffer += text;

        if ((stage === "await-banner" || stage === "await-username") && /(USER NAME:|LOGIN:|USERNAME:)/i.test(this.handshakeBuffer)) {
          stage = "await-password";
          this.handshakeBuffer = "";
          socket.write(`${this.username}\r\n`);
          return;
        }

        if (stage === "await-password" && /PASSWORD:/i.test(this.handshakeBuffer)) {
          stage = "await-login";
          this.handshakeBuffer = "";
          socket.write(`${this.password}\r\n`);
          return;
        }

        if (stage === "await-login" && /LOGIN SUCCESSFUL!/i.test(this.handshakeBuffer)) {
          clearTimeout(stabilizeTimer);
          this.socket = socket;
          this.connectionGeneration = generation;
          this.state = "authenticated";
          this.authAttemptInProgress = false;
          this.lastAuthenticatedAt = new Date().toISOString();
          this.lastError = null;
          this.reconnectAttempt = 0;
          this.buffer = "";
          this.attachPersistentSocketListeners(socket, generation);
          this.log("info", "Receiver authentication succeeded.");
          finish(resolve, { generation });
          return;
        }

        if (stage === "await-login" && /(LOGIN FAILED|AUTHENTICATION FAILED|ACCESS DENIED|INVALID PASSWORD)/i.test(this.handshakeBuffer)) {
          this.state = "login-failed";
          rejectConnection(createCommandError("Receiver login failed", "RECEIVER_LOGIN_FAILED"));
        }
      });

      socket.once("error", (error) => {
        rejectConnection(error);
      });

      socket.once("close", () => {
        if (!settled) {
          const code = connected ? "RECEIVER_AUTH_RECOVERY" : "RECEIVER_SOCKET_CLOSED";
          rejectConnection(createCommandError("Receiver login failed or socket closed unexpectedly", code));
        }
      });

      socket.connect(this.port, this.host);
    });
  }

  resetSessionState() {
    this.clearCommandTimers();
    this.currentCommand = null;
    this.commandFinalized = false;
    this.buffer = "";
    this.handshakeBuffer = "";
  }

  attachPersistentSocketListeners(socket, generation) {
    socket.removeAllListeners("data");
    socket.removeAllListeners("error");
    socket.removeAllListeners("close");

    socket.on("data", (chunk) => {
      this.handleCommandData(chunk.toString(), generation);
    });

    socket.on("error", (error) => {
      this.handleDisconnect(error, generation);
    });

    socket.on("close", () => {
      this.handleDisconnect(createCommandError("Receiver disconnected", "RECEIVER_SOCKET_CLOSED"), generation);
    });
  }

  async executeCommand(generation, command, options = {}) {
    if (!this.socket || this.socket.destroyed || this.state !== "authenticated" || generation !== this.connectionGeneration) {
      throw createCommandError("Receiver not connected", "RECEIVER_NOT_CONNECTED");
    }

    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : this.commandTimeoutMs;
    const idleGraceMs = Number.isFinite(options.idleGraceMs) ? options.idleGraceMs : this.idleGraceMs;
    const expectOk = Boolean(options.expectOk);
    const responseMode = options.responseMode || "idle";
    const completionPattern = options.completionPattern instanceof RegExp
      ? options.completionPattern
      : /F3|\d{2}\/\d{2}\/\d{4}/;

    this.clearCommandTimers();
    this.commandFinalized = false;
    this.buffer = "";

    return new Promise((resolve, reject) => {
      this.currentCommand = {
        generation,
        command,
        expectOk,
        responseMode,
        completionPattern,
        idleGraceMs,
        resolve,
        reject,
      };

      this.commandTimer = setTimeout(() => {
        const timeoutError = createCommandError(`Receiver command timeout for ${command.trim() || "command"}`, "RECEIVER_COMMAND_TIMEOUT");
        this.log("warn", timeoutError.message);
        this.failCurrentCommand(timeoutError, { reconnect: true, destroyConnection: true });
      }, timeoutMs);

      try {
        this.socket.write(command);
      } catch (error) {
        this.failCurrentCommand(error, { reconnect: true, destroyConnection: true });
      }
    });
  }

  handleCommandData(text, generation) {
    if (!this.currentCommand || generation !== this.currentCommand.generation) {
      return;
    }

    this.buffer += text;
    const current = this.currentCommand;

    if (current.responseMode === "pattern") {
      const complete = current.expectOk
        ? parseReceiverAcknowledgement(this.buffer).acknowledged
        : current.completionPattern.test(this.buffer);
      if (complete) {
        this.finalizeCurrentCommand();
        return;
      }
    }

    if (normalizeReceiverRaw(this.buffer).length > 0) {
      clearTimeout(this.commandIdleTimer);
      this.commandIdleTimer = setTimeout(() => {
        this.finalizeCurrentCommand();
      }, current.idleGraceMs);
    }
  }

  finalizeCurrentCommand() {
    if (!this.currentCommand || this.commandFinalized) {
      return;
    }

    this.commandFinalized = true;
    const current = this.currentCommand;
    const raw = this.buffer;
    this.currentCommand = null;
    this.buffer = "";
    this.clearCommandTimers();
    this.lastSuccessfulCommunicationAt = new Date().toISOString();
    this.lastError = null;
    current.resolve({
      receiverReachable: true,
      loginOk: true,
      raw,
    });
  }

  failCurrentCommand(error, { reconnect = false, destroyConnection = false } = {}) {
    if (!this.currentCommand || this.commandFinalized) {
      if (destroyConnection) {
        this.destroySocket({ preserveReconnect: true });
      }
      if (reconnect) {
        this.scheduleReconnect(error, { immediate: true });
      }
      return;
    }

    this.commandFinalized = true;
    const current = this.currentCommand;
    this.currentCommand = null;
    this.resetSessionState();
    this.lastError = error;

    if (destroyConnection) {
      this.destroySocket({ preserveReconnect: true });
    }

    if (reconnect) {
      this.scheduleReconnect(error, { immediate: true });
    }

    current.reject(error);
  }

  handleDisconnect(error, generation) {
    if (generation !== this.connectionGeneration) {
      return;
    }

    if (this.expectedClose || this.isClosing || this.state === "closed") {
      return;
    }

    this.lastError = error;
    this.state = this.state === "login-failed" ? "login-failed" : "degraded";
    this.destroySocket({ preserveReconnect: true });
    this.failCurrentCommand(error, { reconnect: false, destroyConnection: false });
    this.scheduleReconnect(error, { immediate: true });
  }

  scheduleReconnect(error, { immediate = false } = {}) {
    if (this.reconnectTimer) {
      return;
    }

    const attempt = this.reconnectAttempt;
    const delay = immediate && attempt === 0
      ? 0
      : Math.min(this.reconnectMaxMs, this.reconnectInitialMs * Math.max(1, 2 ** Math.max(0, attempt - 1)));

    this.reconnectAttempt += 1;
    this.state = "reconnecting";
    this.log("warn", `Receiver reconnect scheduled in ${delay} ms${error?.message ? ` (${error.message})` : ""}.`);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.ensureConnected({ triggerReconnect: false });
        this.log("info", "Receiver reconnect succeeded.");
      } catch (reconnectError) {
        this.scheduleReconnect(reconnectError, { immediate: false });
      }
    }, delay);
  }

  clearCommandTimers() {
    clearTimeout(this.commandTimer);
    clearTimeout(this.commandIdleTimer);
    this.commandTimer = null;
    this.commandIdleTimer = null;
  }

  clearReconnectTimer() {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  destroySocket({ preserveReconnect = false } = {}) {
    this.expectedClose = true;
    this.resetSessionState();
    if (this.socket) {
      try {
        this.socket.destroy();
      } catch (error) {
        void error;
      }
    }
    this.socket = null;
    this.expectedClose = false;
    this.authAttemptInProgress = false;
    if (!preserveReconnect) {
      this.clearReconnectTimer();
    }
    if (!this.isClosing && this.state !== "reconnecting" && this.state !== "login-failed") {
      this.state = "idle";
    }
  }

  close() {
    this.isClosing = true;
    this.clearReconnectTimer();
    this.clearCommandTimers();
    this.destroySocket({ preserveReconnect: false });
    this.currentCommand = null;
    this.state = "closed";
  }

  log(level, message) {
    const writer = typeof this.logger?.[level] === "function"
      ? this.logger[level].bind(this.logger)
      : typeof this.logger?.log === "function"
        ? this.logger.log.bind(this.logger)
        : console.log.bind(console);
    writer(`[receiver] ${message}`);
  }
}

async function connectToGPS({
  host,
  port,
  username,
  password,
  command,
  expectOk = false,
  timeoutMs = 3000,
  completionPattern = /F3|\d{2}\/\d{2}\/\d{4}/,
  responseMode = "pattern",
  idleGraceMs = 120,
}) {
  const manager = new ReceiverConnectionManager({
    host,
    port,
    username,
    password,
    commandTimeoutMs: timeoutMs,
    idleGraceMs,
    reconnectInitialMs: timeoutMs,
    reconnectMaxMs: timeoutMs,
    logger: { info() {}, warn() {}, log() {} },
  });

  try {
    return await manager.sendCommand(command, {
      expectOk,
      timeoutMs,
      completionPattern,
      responseMode,
      idleGraceMs,
    });
  } finally {
    manager.close();
  }
}

function createReceiverConnectionManager(config) {
  return new ReceiverConnectionManager(config);
}

module.exports = {
  validateConfig,
  normalizeReceiverRaw,
  parseReceiverAcknowledgement,
  parseGpsTimeResponse,
  parseGpsReceiverInfo,
  parseGpsPosition,
  parseGpsSatelliteList,
  classifyReceiverError,
  ReceiverConnectionManager,
  createReceiverConnectionManager,
  connectToGPS,
};
