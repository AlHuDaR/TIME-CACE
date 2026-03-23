const net = require('net');

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
    port: validateFiniteNumber('PORT', config.port, { min: 1, max: 65535, integer: true }),
    gpsPort: validateFiniteNumber('GPS_PORT', config.gpsPort, { min: 1, max: 65535, integer: true }),
    minConnectionIntervalMs: validateFiniteNumber('MIN_CONNECTION_INTERVAL_MS', config.minConnectionIntervalMs, { min: 0, max: 300000, integer: true }),
    requestTimeoutMs: validateFiniteNumber('REQUEST_TIMEOUT_MS', config.requestTimeoutMs, { min: 100, max: 300000, integer: true }),
    receiverStatusCacheMs: validateFiniteNumber('RECEIVER_STATUS_CACHE_MS', config.receiverStatusCacheMs, { min: 0, max: 300000, integer: true }),
    statusStaleMs: validateFiniteNumber('STATUS_STALE_MS', config.statusStaleMs, { min: 1000, max: 86400000, integer: true }),
    rateLimitWindowMs: validateFiniteNumber('RATE_LIMIT_WINDOW_MS', config.rateLimitWindowMs, { min: 1000, max: 86400000, integer: true }),
    rateLimitTimeMax: validateFiniteNumber('RATE_LIMIT_TIME_MAX', config.rateLimitTimeMax, { min: 1, max: 100000, integer: true }),
    rateLimitStatusMax: validateFiniteNumber('RATE_LIMIT_STATUS_MAX', config.rateLimitStatusMax, { min: 1, max: 100000, integer: true }),
    rateLimitInternetMax: validateFiniteNumber('RATE_LIMIT_INTERNET_MAX', config.rateLimitInternetMax, { min: 1, max: 100000, integer: true }),
    rateLimitSetMax: validateFiniteNumber('RATE_LIMIT_SET_MAX', config.rateLimitSetMax, { min: 1, max: 100000, integer: true }),
    ntpTimeoutMs: validateFiniteNumber('NTP_TIMEOUT_MS', config.ntpTimeoutMs, { min: 100, max: 300000, integer: true }),
    httpsApiTimeoutMs: validateFiniteNumber('HTTPS_TIME_API_TIMEOUT_MS', config.httpsApiTimeoutMs, { min: 100, max: 300000, integer: true }),
    httpDateTimeoutMs: validateFiniteNumber('HTTP_DATE_TIMEOUT_MS', config.httpDateTimeoutMs, { min: 100, max: 300000, integer: true }),
    receiverEnabled: Boolean(config.receiverEnabled),
  };

  validated.gpsHost = String(validated.gpsHost || '').trim();
  validated.gpsUsername = String(validated.gpsUsername || '').trim();
  validated.gpsPassword = String(validated.gpsPassword || '').trim();

  if (validated.receiverEnabled) {
    if (!validated.gpsHost) {
      throw new Error('Invalid GPS_HOST: receiver mode requires a host value');
    }

    if (!validated.gpsUsername) {
      throw new Error('Invalid GPS_USERNAME: receiver mode requires a username');
    }

    if (!validated.gpsPassword) {
      throw new Error('Invalid GPS_PASSWORD: receiver mode requires a password');
    }
  }

  if (validated.authEnabled && !String(validated.authToken || '').trim()) {
    throw new Error('Invalid API_AUTH_TOKEN: API auth is enabled but no token is configured');
  }

  if (validated.receiverStatusCacheMs > validated.statusStaleMs) {
    throw new Error('Invalid config: RECEIVER_STATUS_CACHE_MS must be less than or equal to STATUS_STALE_MS');
  }

  return Object.freeze(validated);
}

function normalizeReceiverRaw(raw) {
  return String(raw || '').replace(/\0/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeReceiverLine(raw) {
  return String(raw || '').replace(/\0/g, ' ').trim();
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
    throw new Error('Could not parse receiver time response');
  }

  const timeMode = explicitMatch ? explicitMatch[1] : 'UTC';
  const dateStr = explicitMatch ? explicitMatch[2] : fallbackMatch[1];
  const timeStr = explicitMatch ? explicitMatch[3] : fallbackMatch[2];
  const [month, day, year] = dateStr.split('/').map(Number);
  const [hours, minutes, seconds] = timeStr.split(':').map(Number);
  const utcTimestamp = Date.UTC(year, month - 1, day, hours, minutes, seconds);

  const hasHoldover = /HOLDOVER/i.test(normalized);
  const explicitUnlocked = /(UNLOCK|NO\s+GPS|ANTENNA\s+FAULT|SEARCHING)/i.test(normalized);
  const explicitLocked = /(LOCKED|TRACKING|GPS\s+LOCK)/i.test(normalized);
  const defaultDatePattern = /01\/01\/(1999|2000|2026)/.test(dateStr);
  const gpsLockState = explicitLocked
    ? 'locked'
    : hasHoldover
      ? 'holdover'
      : explicitUnlocked
        ? 'unlocked'
        : defaultDatePattern
          ? 'unknown'
          : 'locked';
  const isLocked = gpsLockState === 'locked';
  const statusText = gpsLockState === 'locked'
    ? 'GPS receiver reachable and locked'
    : gpsLockState === 'holdover'
      ? 'Receiver reachable and operating in holdover'
      : gpsLockState === 'unlocked'
        ? 'GPS receiver reachable but not locked'
        : 'GPS receiver reachable but lock state is unknown';

  return {
    raw: normalized,
    receiverDate: dateStr,
    receiverTime: timeStr,
    receiverTimeMode: timeMode.toUpperCase(),
    timestamp: utcTimestamp,
    isLocked,
    gpsLockState,
    statusText,
    currentSource: gpsLockState === 'locked' ? 'gps-locked' : gpsLockState === 'holdover' ? 'holdover' : 'gps-unlocked',
    currentSourceLabel: gpsLockState === 'locked'
      ? 'GPS receiver locked'
      : gpsLockState === 'holdover'
        ? 'Receiver holdover'
        : gpsLockState === 'unlocked'
          ? 'GPS receiver unlocked'
          : 'Receiver source unknown',
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
      ? `(?=\\s+(?:${nextFields.join('|')})\\b|$)`
      : '$';
    const expression = new RegExp(`\\b${fieldName}\\b[:#\\s]+(.+?)${lookahead}`, 'i');
    const match = normalized.match(expression);
    return match ? match[1].trim() : null;
  };

  return {
    raw: normalized,
    boardPartNumber: captureField('GPS\\s+PART\\s+NUMBER', ['SOFTWARE', 'FPGA', 'GPS\\s+STATUS', 'GPS\\s+ANTENNA', 'GPS\\s+ACQUISITION']) || null,
    softwareVersion: parseVersionToken(normalized, /\bSOFTWARE\s+([^\s]+)(?=\s+(?:FPGA|GPS\s+STATUS|GPS\s+ANTENNA|GPS\s+ACQUISITION)|$)/i),
    fpgaVersion: parseVersionToken(normalized, /\bFPGA\s*#?\s+([^\s]+)(?=\s+(?:GPS\s+STATUS|GPS\s+ANTENNA|GPS\s+ACQUISITION)|$)/i),
    gpsStatus: captureField('GPS\\s+STATUS', ['GPS\\s+ANTENNA', 'GPS\\s+ACQUISITION']) || null,
    antennaStatus: captureField('GPS\\s+ANTENNA', ['GPS\\s+ACQUISITION']) || null,
    acquisitionState: captureField('GPS\\s+ACQUISITION\\s+STATE', []) || null,
  };
}

function parseCoordinateDms(raw) {
  const match = String(raw || '').match(/^([NSEW])\s*(\d+(?:\.\d+)?)d\s*(\d+(?:\.\d+)?)'?\s*(\d+(?:\.\d+)?)?"?$/i);
  if (!match) {
    return null;
  }

  const hemisphere = match[1].toUpperCase();
  const degrees = Number(match[2]);
  const minutes = Number(match[3]);
  const seconds = Number(match[4] || 0);
  const sign = ['S', 'W'].includes(hemisphere) ? -1 : 1;
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
      mode: 'lla',
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
      mode: 'xyz',
      latitude: null,
      longitude: null,
      altitudeMeters: null,
      xMeters: Number(xyzMatch[1]),
      yMeters: Number(xyzMatch[2]),
      zMeters: Number(xyzMatch[3]),
    };
  }

  throw new Error('Could not parse GPS position response');
}

function titleCaseWords(tokens = []) {
  return tokens
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
    .join(' ');
}

function parseGpsSatelliteList(raw) {
  const lines = String(raw || '')
    .replace(/\0/g, ' ')
    .split(/\r?\n/)
    .map((line) => normalizeReceiverLine(line))
    .filter(Boolean);

  const satellites = [];
  const utilizationWords = new Set(['CURRENT', 'TRACKED', 'TRACKING', 'USED', 'UTILIZED']);

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

    if (middleTokens.includes('CURRENT')) {
      utilization.push('Current');
    }
    if (middleTokens.includes('TRACKED') || middleTokens.includes('TRACKING')) {
      utilization.push('Tracked');
    }
    if (middleTokens.includes('USED') || middleTokens.includes('UTILIZED')) {
      utilization.push('Used');
    }

    satellites.push({
      prn,
      status: titleCaseWords(statusTokens) || 'Unknown',
      utilization: utilization.join(' + ') || 'Available',
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
  const message = error?.message || 'Receiver error';

  if (/receiver (is )?not configured|receiver disabled/i.test(message)) {
    return {
      receiverConfigured: false,
      receiverReachable: false,
      loginOk: false,
      receiverCommunicationState: 'disabled',
      statusText: 'Receiver not configured',
      lastError: message,
    };
  }

  if (/GPS receiver reachable but not locked|holdover|GPS_UNLOCKED/i.test(message)) {
    return {
      receiverConfigured: true,
      receiverReachable: true,
      loginOk: true,
      receiverCommunicationState: 'authenticated',
      statusText: message,
      lastError: message,
    };
  }

  if (/login failed|authentication failed|access denied|invalid password/i.test(message)) {
    return {
      receiverConfigured: true,
      receiverReachable: true,
      loginOk: false,
      receiverCommunicationState: 'login-failed',
      statusText: 'Receiver reachable but login failed',
      lastError: message,
    };
  }

  if (/timeout|ECONNREFUSED|EHOSTUNREACH|ENOTFOUND|socket closed unexpectedly/i.test(message)) {
    return {
      receiverConfigured: true,
      receiverReachable: false,
      loginOk: false,
      receiverCommunicationState: 'unreachable',
      statusText: 'Receiver unreachable',
      lastError: message,
    };
  }

  return {
    receiverConfigured: true,
    receiverReachable: false,
    loginOk: false,
    receiverCommunicationState: 'unreachable',
    statusText: 'Receiver communication failed',
    lastError: message,
  };
}

function connectToGPS({
  host,
  port,
  username,
  password,
  command,
  expectOk = false,
  timeoutMs = 3000,
  completionPattern = /F3|\d{2}\/\d{2}\/\d{4}/,
  responseMode = 'pattern',
  idleGraceMs = 120,
}) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let buffer = '';
    let loginOk = false;
    let receiverReachable = false;
    let state = 'connecting';
    let settled = false;
    let idleTimer = null;

    const clearIdleTimer = () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
    };

    const buildResult = () => ({
      receiverReachable,
      loginOk,
      raw: buffer,
    });

    const finish = (handler, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      clearIdleTimer();
      socket.destroy();
      handler(value);
    };

    const completeIfReady = () => {
      if (responseMode === 'idle') {
        const hasAnyResponse = normalizeReceiverRaw(buffer).length > 0;
        if (hasAnyResponse) {
          clearIdleTimer();
          idleTimer = setTimeout(() => {
            finish(resolve, buildResult());
          }, idleGraceMs);
        }
        return;
      }

      const complete = expectOk
        ? parseReceiverAcknowledgement(buffer).acknowledged
        : completionPattern.test(buffer);
      if (complete) {
        finish(resolve, buildResult());
      }
    };

    const timeout = setTimeout(() => {
      finish(reject, new Error('Connection timeout'));
    }, timeoutMs);

    socket.connect(port, host, () => {
      receiverReachable = true;
    });

    socket.on('data', (chunk) => {
      buffer += chunk.toString();

      if (state === 'connecting' && buffer.includes('USER NAME:')) {
        state = 'username';
        buffer = '';
        socket.write(`${username}\r\n`);
        return;
      }

      if (state === 'username' && buffer.includes('PASSWORD:')) {
        state = 'password';
        buffer = '';
        socket.write(`${password}\r\n`);
        return;
      }

      if (state === 'password' && /LOGIN SUCCESSFUL!/i.test(buffer)) {
        loginOk = true;
        state = 'command';
        buffer = '';
        setTimeout(() => {
          socket.write(command);
        }, 250);
        return;
      }

      if (state === 'password' && /(LOGIN FAILED|AUTHENTICATION FAILED|ACCESS DENIED|INVALID PASSWORD)/i.test(buffer)) {
        finish(reject, new Error('Receiver login failed'));
        return;
      }

      if (state === 'command') {
        completeIfReady();
      }
    });

    socket.on('error', (error) => {
      finish(reject, error);
    });

    socket.on('close', () => {
      if (settled) {
        return;
      }

      const hasAck = expectOk && parseReceiverAcknowledgement(buffer).acknowledged;
      const hasPattern = !expectOk && completionPattern.test(buffer);
      const hasIdleResponse = responseMode === 'idle' && normalizeReceiverRaw(buffer).length > 0;
      if (hasAck || hasPattern || hasIdleResponse) {
        finish(resolve, buildResult());
        return;
      }

      finish(reject, new Error(loginOk ? 'Socket closed unexpectedly' : 'Receiver login failed or socket closed unexpectedly'));
    });
  });
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
  connectToGPS,
};
