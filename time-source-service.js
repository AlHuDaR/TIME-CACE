const dgram = require('dgram');
const fetch = require('node-fetch');

const SOURCE_DEFINITIONS = Object.freeze({
  'gps-xli': Object.freeze({
    sourceKey: 'gps-xli',
    sourceLabel: 'GPS Receiver',
    sourceTier: 'primary-reference',
    status: 'Nominal (synchronized)',
    authoritative: true,
    traceable: true,
    fallback: false,
  }),
  'ntp-nist': Object.freeze({
    sourceKey: 'ntp-nist',
    sourceLabel: 'Internet (NIST)',
    sourceTier: 'traceable-fallback',
    status: 'Degraded (primary source unavailable)',
    authoritative: true,
    traceable: true,
    fallback: true,
  }),
  'ntp-npl-india': Object.freeze({
    sourceKey: 'ntp-npl-india',
    sourceLabel: 'Internet (NPL India)',
    sourceTier: 'traceable-fallback',
    status: 'Degraded (primary source unavailable)',
    authoritative: true,
    traceable: true,
    fallback: true,
  }),
  'https-worldtimeapi': Object.freeze({
    sourceKey: 'https-worldtimeapi',
    sourceLabel: 'Internet (WorldTimeAPI)',
    sourceTier: 'internet-fallback',
    status: 'Degraded (primary source unavailable)',
    authoritative: false,
    traceable: false,
    fallback: true,
  }),
  'https-timeapiio': Object.freeze({
    sourceKey: 'https-timeapiio',
    sourceLabel: 'Internet (timeapi.io)',
    sourceTier: 'internet-fallback',
    status: 'Degraded (primary source unavailable)',
    authoritative: false,
    traceable: false,
    fallback: true,
  }),
  'http-date': Object.freeze({
    sourceKey: 'http-date',
    sourceLabel: 'Internet (HTTP Date)',
    sourceTier: 'internet-fallback',
    status: 'Degraded (primary source unavailable)',
    authoritative: false,
    traceable: false,
    fallback: true,
  }),
  'local-clock': Object.freeze({
    sourceKey: 'local-clock',
    sourceLabel: 'Internal Clock',
    sourceTier: 'emergency-fallback',
    status: 'Holdover (using last valid sync)',
    authoritative: false,
    traceable: false,
    fallback: true,
  }),
  'browser-local-clock': Object.freeze({
    sourceKey: 'browser-local-clock',
    sourceLabel: 'Internal Clock',
    sourceTier: 'browser-emergency-fallback',
    status: 'Holdover (using last valid sync)',
    authoritative: false,
    traceable: false,
    fallback: true,
  }),
});

const NTP_UNIX_EPOCH_OFFSET_SECONDS = 2208988800;
const OMAN_UTC_OFFSET_SUFFIX = '+04:00';

function getSourceDefinition(sourceKey) {
  return SOURCE_DEFINITIONS[sourceKey] || SOURCE_DEFINITIONS['local-clock'];
}

function createNtpPacket() {
  const packet = Buffer.alloc(48);
  packet[0] = 0x1b;
  return packet;
}

function validateTimestamp(timestamp, context) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    throw new Error(`Invalid timestamp returned by ${context}`);
  }

  return timestamp;
}

function parseNtpTimestamp(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 48) {
    throw new Error('Invalid NTP response payload');
  }

  const seconds = buffer.readUInt32BE(40);
  const fraction = buffer.readUInt32BE(44);
  const unixSeconds = seconds - NTP_UNIX_EPOCH_OFFSET_SECONDS;
  const milliseconds = Math.round((fraction * 1000) / 0x100000000);
  return validateTimestamp((unixSeconds * 1000) + milliseconds, 'NTP response');
}

function parseHostAndPort(host) {
  const text = String(host || '').trim();
  const match = text.match(/^(.+):(\d+)$/);
  if (match && !match[1].includes(']')) {
    return { host: match[1], port: Number(match[2]) };
  }
  return { host: text, port: 123 };
}

function flattenAggregateError(error) {
  if (error?.errors && Array.isArray(error.errors)) {
    return error.errors.map((entry) => entry?.message || String(entry)).join('; ');
  }

  return error?.message || String(error);
}

function createNoopLogger() {
  const noop = () => {};
  return Object.freeze({
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
  });
}

function queryNtpSource({ host, timeoutMs, sourceKey, sourceHost }) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const packet = createNtpPacket();
    const startedAt = Date.now();
    const target = parseHostAndPort(host);
    let settled = false;

    const finish = (handler, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      try {
        socket.close();
      } catch (error) {
        // Ignore close races.
      }
      handler(value);
    };

    const timeoutId = setTimeout(() => {
      finish(reject, new Error(`NTP timeout after ${timeoutMs} ms for ${target.host}`));
    }, timeoutMs);

    socket.once('error', (error) => {
      finish(reject, error);
    });

    socket.once('message', (message) => {
      try {
        const timestamp = parseNtpTimestamp(message);
        finish(resolve, {
          ...getSourceDefinition(sourceKey),
          timestamp,
          isoTimestamp: new Date(timestamp).toISOString(),
          roundTripMs: Math.max(0, Date.now() - startedAt),
          upstream: sourceHost || target.host,
          protocol: 'ntp',
        });
      } catch (error) {
        finish(reject, error);
      }
    });

    socket.send(packet, target.port, target.host, (error) => {
      if (error) {
        finish(reject, error);
      }
    });
  });
}

async function fetchJsonWithTimeout(url, timeoutMs) {
  const response = await fetch(url, {
    method: 'GET',
    timeout: timeoutMs,
    headers: {
      Accept: 'application/json',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} returned by ${url}`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error(`Malformed JSON returned by ${url}`);
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`Invalid JSON payload returned by ${url}`);
  }

  return payload;
}

function resolveTimestampFromFields(fields = [], context) {
  for (const value of fields) {
    if (value === null || value === undefined || value === '') {
      continue;
    }

    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 1000000000) {
      return validateTimestamp(numeric > 1000000000000 ? numeric : numeric * 1000, context);
    }

    const parsed = Date.parse(String(value));
    if (Number.isFinite(parsed)) {
      return validateTimestamp(parsed, context);
    }
  }

  throw new Error(`No valid timestamp field returned by ${context}`);
}

function parseWorldTimeApiPayload(payload, url) {
  return resolveTimestampFromFields([
    payload.datetime,
    payload.utc_datetime,
    payload.currentDateTime,
    payload.dateTime,
    payload.unixtime,
    payload.timestamp,
  ], `WorldTimeAPI (${url})`);
}

function parseTimeApiIoPayload(payload, url) {
  const assembledLocalDateTime = payload.dateTime
    || payload.currentLocalTime
    || (payload.date && payload.time ? `${payload.date}T${payload.time}${OMAN_UTC_OFFSET_SUFFIX}` : null)
    || (Number.isFinite(Number(payload.year))
      && Number.isFinite(Number(payload.month))
      && Number.isFinite(Number(payload.day))
      && Number.isFinite(Number(payload.hour))
      && Number.isFinite(Number(payload.minute))
        ? `${String(payload.year).padStart(4, '0')}-${String(payload.month).padStart(2, '0')}-${String(payload.day).padStart(2, '0')}T${String(payload.hour).padStart(2, '0')}:${String(payload.minute).padStart(2, '0')}:${String(payload.seconds || 0).padStart(2, '0')}${OMAN_UTC_OFFSET_SUFFIX}`
        : null);

  return resolveTimestampFromFields([
    assembledLocalDateTime,
    payload.dateTime,
    payload.currentLocalTime,
    payload.timestamp,
    payload.epochTime,
  ], `TimeAPI.io (${url})`);
}

async function queryHttpsTimeApiSource({ sourceKey, urls, timeoutMs, parser, protocol }) {
  if (!Array.isArray(urls) || urls.length === 0) {
    throw new Error(`No ${sourceKey} endpoint configured`);
  }

  const attempts = urls.map(async (url) => {
    const startedAt = Date.now();
    const payload = await fetchJsonWithTimeout(url, timeoutMs);
    const timestamp = parser(payload, url);
    return {
      ...getSourceDefinition(sourceKey),
      timestamp,
      isoTimestamp: new Date(timestamp).toISOString(),
      roundTripMs: Math.max(0, Date.now() - startedAt),
      upstream: url,
      protocol,
    };
  });

  try {
    return await Promise.any(attempts);
  } catch (error) {
    throw new Error(flattenAggregateError(error));
  }
}

async function queryHttpDateSource({ urls, timeoutMs }) {
  if (!Array.isArray(urls) || urls.length === 0) {
    throw new Error('No HTTP Date source configured');
  }

  const attempts = urls.map(async (url) => {
    const startedAt = Date.now();
    const response = await fetch(url, {
      method: 'HEAD',
      timeout: timeoutMs,
      headers: {
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} returned by ${url}`);
    }

    const finishedAt = Date.now();
    const headerValue = response.headers.get('date');
    if (!headerValue) {
      throw new Error(`HTTP Date header missing from ${url}`);
    }

    const serverTimestamp = Date.parse(headerValue);
    if (!Number.isFinite(serverTimestamp)) {
      throw new Error(`HTTP Date header invalid from ${url}`);
    }

    const roundTripMs = Math.max(0, finishedAt - startedAt);
    const timestamp = validateTimestamp(serverTimestamp + Math.round(roundTripMs / 2), `HTTP Date (${url})`);

    return {
      ...getSourceDefinition('http-date'),
      timestamp,
      isoTimestamp: new Date(timestamp).toISOString(),
      roundTripMs,
      upstream: url,
      protocol: 'http-date',
    };
  });

  try {
    return await Promise.any(attempts);
  } catch (error) {
    throw new Error(flattenAggregateError(error));
  }
}

function createTimingSourceService(options = {}) {
  const logger = options.logger && typeof options.logger === 'object'
    ? {
      debug: typeof options.logger.debug === 'function' ? options.logger.debug.bind(options.logger) : () => {},
      info: typeof options.logger.info === 'function' ? options.logger.info.bind(options.logger) : () => {},
      warn: typeof options.logger.warn === 'function' ? options.logger.warn.bind(options.logger) : () => {},
      error: typeof options.logger.error === 'function' ? options.logger.error.bind(options.logger) : () => {},
    }
    : createNoopLogger();

  const config = {
    ntpTimeoutMs: options.ntpTimeoutMs || 1500,
    httpsApiTimeoutMs: options.httpsApiTimeoutMs || 2000,
    httpTimeoutMs: options.httpTimeoutMs || 2000,
    nistHosts: Array.isArray(options.nistHosts) && options.nistHosts.length > 0
      ? options.nistHosts
      : ['time.nist.gov', 'time-a-g.nist.gov'],
    nplHosts: Array.isArray(options.nplHosts) && options.nplHosts.length > 0
      ? options.nplHosts
      : ['time.nplindia.org', 'samay1.nic.in'],
    worldTimeApiUrls: Array.isArray(options.worldTimeApiUrls) && options.worldTimeApiUrls.length > 0
      ? options.worldTimeApiUrls
      : ['https://worldtimeapi.org/api/timezone/Asia/Muscat'],
    timeApiIoUrls: Array.isArray(options.timeApiIoUrls) && options.timeApiIoUrls.length > 0
      ? options.timeApiIoUrls
      : ['https://timeapi.io/api/Time/current/zone?timeZone=Asia/Muscat'],
    httpDateUrls: Array.isArray(options.httpDateUrls) && options.httpDateUrls.length > 0
      ? options.httpDateUrls
      : ['https://www.google.com', 'https://www.microsoft.com'],
  };

  async function queryNtpGroup(sourceKey, hosts = []) {
    if (!Array.isArray(hosts) || hosts.length === 0) {
      throw new Error(`No ${sourceKey} server configured`);
    }

    try {
      return await Promise.any(hosts.map((host) => queryNtpSource({
        host,
        timeoutMs: config.ntpTimeoutMs,
        sourceKey,
        sourceHost: host,
      })));
    } catch (error) {
      throw new Error(flattenAggregateError(error));
    }
  }

  async function resolveFallbackHierarchy() {
    const attempts = [
      {
        sourceKey: 'ntp-nist',
        run: () => queryNtpGroup('ntp-nist', config.nistHosts),
      },
      {
        sourceKey: 'ntp-npl-india',
        run: () => queryNtpGroup('ntp-npl-india', config.nplHosts),
      },
      {
        sourceKey: 'https-worldtimeapi',
        run: () => queryHttpsTimeApiSource({
          sourceKey: 'https-worldtimeapi',
          urls: config.worldTimeApiUrls,
          timeoutMs: config.httpsApiTimeoutMs,
          parser: parseWorldTimeApiPayload,
          protocol: 'https-json',
        }),
      },
      {
        sourceKey: 'https-timeapiio',
        run: () => queryHttpsTimeApiSource({
          sourceKey: 'https-timeapiio',
          urls: config.timeApiIoUrls,
          timeoutMs: config.httpsApiTimeoutMs,
          parser: parseTimeApiIoPayload,
          protocol: 'https-json',
        }),
      },
      {
        sourceKey: 'http-date',
        run: () => queryHttpDateSource({
          urls: config.httpDateUrls,
          timeoutMs: config.httpTimeoutMs,
        }),
      },
    ];

    const resolutionErrors = [];
    const resolutionTrace = [];

    for (const attempt of attempts) {
      const startedAt = Date.now();
      logger.info('time-source-fallback-attempt', {
        sourceKey: attempt.sourceKey,
        attemptedAt: new Date(startedAt).toISOString(),
      });
      try {
        const result = await attempt.run();
        const completedAt = Date.now();
        resolutionTrace.push({
          sourceKey: attempt.sourceKey,
          outcome: 'success',
          durationMs: Math.max(0, completedAt - startedAt),
          completedAt: new Date(completedAt).toISOString(),
          upstream: result.upstream || null,
          protocol: result.protocol || null,
        });
        logger.info('time-source-fallback-success', {
          sourceKey: attempt.sourceKey,
          durationMs: Math.max(0, completedAt - startedAt),
          upstream: result.upstream || null,
          protocol: result.protocol || null,
        });
        return {
          ...result,
          resolutionErrors,
          resolutionTrace,
          preferredFallbackAttempted: attempts[0].sourceKey,
          failedFallbackTier: null,
          selectedSource: result.sourceKey,
        };
      } catch (error) {
        const completedAt = Date.now();
        const message = error?.message || String(error);
        resolutionErrors.push({
          sourceKey: attempt.sourceKey,
          message,
        });
        resolutionTrace.push({
          sourceKey: attempt.sourceKey,
          outcome: 'failure',
          durationMs: Math.max(0, completedAt - startedAt),
          completedAt: new Date(completedAt).toISOString(),
          reason: message,
        });
        logger.warn('time-source-fallback-failure', {
          sourceKey: attempt.sourceKey,
          durationMs: Math.max(0, completedAt - startedAt),
          reason: message,
        });
      }
    }

    const failedFallbackTier = resolutionErrors.length > 0 ? resolutionErrors[0].sourceKey : null;
    logger.error('time-source-fallback-exhausted', {
      failedFallbackTier,
      totalAttempts: attempts.length,
      resolutionErrors,
    });

    return {
      ...getSourceDefinition('local-clock'),
      timestamp: Date.now(),
      isoTimestamp: new Date().toISOString(),
      roundTripMs: null,
      upstream: 'local-system-clock',
      protocol: 'local',
      resolutionErrors,
      resolutionTrace,
      preferredFallbackAttempted: attempts[0].sourceKey,
      failedFallbackTier,
      selectedSource: 'local-clock',
    };
  }

  return {
    getSourceDefinition,
    resolveFallbackHierarchy,
    resolveTraceableFallback: resolveFallbackHierarchy,
  };
}

module.exports = {
  SOURCE_DEFINITIONS,
  getSourceDefinition,
  createTimingSourceService,
};
