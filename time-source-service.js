const dgram = require('dgram');
const fetch = require('node-fetch');

const SOURCE_DEFINITIONS = Object.freeze({
  'gps-xli': Object.freeze({
    sourceKey: 'gps-xli',
    sourceLabel: 'GPS RECEIVER (XLi)',
    sourceTier: 'primary-reference',
    status: 'Primary reference active',
    authoritative: true,
    traceable: true,
    fallback: false,
  }),
  'ntp-nist': Object.freeze({
    sourceKey: 'ntp-nist',
    sourceLabel: 'NTP (NIST)',
    sourceTier: 'traceable-fallback',
    status: 'Traceable fallback active',
    authoritative: true,
    traceable: true,
    fallback: true,
  }),
  'ntp-npl-india': Object.freeze({
    sourceKey: 'ntp-npl-india',
    sourceLabel: 'NTP (NPL India)',
    sourceTier: 'traceable-fallback',
    status: 'Traceable fallback active',
    authoritative: true,
    traceable: true,
    fallback: true,
  }),
  'http-date': Object.freeze({
    sourceKey: 'http-date',
    sourceLabel: 'INTERNET/HTTP DATE',
    sourceTier: 'non-traceable-fallback',
    status: 'Internet fallback active',
    authoritative: false,
    traceable: false,
    fallback: true,
  }),
  'local-clock': Object.freeze({
    sourceKey: 'local-clock',
    sourceLabel: 'LOCAL CLOCK',
    sourceTier: 'emergency-fallback',
    status: 'Emergency local fallback active',
    authoritative: false,
    traceable: false,
    fallback: true,
  }),
});

const NTP_UNIX_EPOCH_OFFSET_SECONDS = 2208988800;

function getSourceDefinition(sourceKey) {
  return SOURCE_DEFINITIONS[sourceKey] || SOURCE_DEFINITIONS['local-clock'];
}

function createNtpPacket() {
  const packet = Buffer.alloc(48);
  packet[0] = 0x1b;
  return packet;
}

function parseNtpTimestamp(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 48) {
    throw new Error('Invalid NTP response payload');
  }

  const seconds = buffer.readUInt32BE(40);
  const fraction = buffer.readUInt32BE(44);
  const unixSeconds = seconds - NTP_UNIX_EPOCH_OFFSET_SECONDS;
  const milliseconds = Math.round((fraction * 1000) / 0x100000000);
  const timestamp = (unixSeconds * 1000) + milliseconds;

  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    throw new Error('Invalid NTP transmit timestamp');
  }

  return timestamp;
}

function parseHostAndPort(host) {
  const text = String(host || '').trim();
  const match = text.match(/^(.+):(\d+)$/);
  if (match && !match[1].includes(']')) {
    return { host: match[1], port: Number(match[2]) };
  }
  return { host: text, port: 123 };
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

async function queryHttpDateSource({ urls, timeoutMs }) {
  let lastError = null;

  for (const url of urls) {
    const startedAt = Date.now();
    try {
      const response = await fetch(url, {
        method: 'HEAD',
        timeout: timeoutMs,
        headers: {
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
        },
      });
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
      const timestamp = serverTimestamp + Math.round(roundTripMs / 2);

      return {
        ...getSourceDefinition('http-date'),
        timestamp,
        isoTimestamp: new Date(timestamp).toISOString(),
        roundTripMs,
        upstream: url,
        protocol: 'http-date',
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('No HTTP Date source reachable');
}

function createTimingSourceService(options = {}) {
  const config = {
    ntpTimeoutMs: options.ntpTimeoutMs || 1500,
    httpTimeoutMs: options.httpTimeoutMs || 2000,
    nistHosts: Array.isArray(options.nistHosts) && options.nistHosts.length > 0
      ? options.nistHosts
      : ['time.nist.gov', 'time-a-g.nist.gov'],
    nplHosts: Array.isArray(options.nplHosts) && options.nplHosts.length > 0
      ? options.nplHosts
      : ['time.nplindia.org', 'samay1.nic.in'],
    httpDateUrls: Array.isArray(options.httpDateUrls) && options.httpDateUrls.length > 0
      ? options.httpDateUrls
      : ['https://www.google.com', 'https://www.microsoft.com'],
  };

  async function queryNtpGroup(sourceKey, hosts = []) {
    let lastError = null;

    for (const host of hosts) {
      try {
        return await queryNtpSource({
          host,
          timeoutMs: config.ntpTimeoutMs,
          sourceKey,
          sourceHost: host,
        });
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error(`No ${sourceKey} server reachable`);
  }

  async function resolveTraceableFallback() {
    const errors = [];

    try {
      return await queryNtpGroup('ntp-nist', config.nistHosts);
    } catch (error) {
      errors.push({ sourceKey: 'ntp-nist', error });
    }

    try {
      return await queryNtpGroup('ntp-npl-india', config.nplHosts);
    } catch (error) {
      errors.push({ sourceKey: 'ntp-npl-india', error });
    }

    try {
      return await queryHttpDateSource({
        urls: config.httpDateUrls,
        timeoutMs: config.httpTimeoutMs,
      });
    } catch (error) {
      errors.push({ sourceKey: 'http-date', error });
    }

    return {
      ...getSourceDefinition('local-clock'),
      timestamp: Date.now(),
      isoTimestamp: new Date().toISOString(),
      roundTripMs: null,
      upstream: 'local-system-clock',
      protocol: 'local',
      resolutionErrors: errors.map((entry) => ({
        sourceKey: entry.sourceKey,
        message: entry.error?.message || String(entry.error),
      })),
    };
  }

  return {
    getSourceDefinition,
    resolveTraceableFallback,
  };
}

module.exports = {
  SOURCE_DEFINITIONS,
  getSourceDefinition,
  createTimingSourceService,
};
