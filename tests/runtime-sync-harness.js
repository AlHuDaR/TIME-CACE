const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createResponse(payload, { ok = true, status = 200, jsonError = null } = {}) {
  return {
    ok,
    status,
    async json() {
      if (jsonError) {
        throw jsonError;
      }
      return payload;
    },
  };
}

function createHarness(fetchImpl) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'runtime-sync.js'), 'utf8');
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  class MessageCenter {
    show() {}
    isFallbackSource(sourceKey) {
      return ['ntp-nist', 'ntp-npl-india', 'https-worldtimeapi', 'https-timeapiio', 'http-date', 'local-clock', 'browser-local-clock'].includes(sourceKey);
    }
    getSourceLabel(sourceKey) {
      return {
        'gps-xli': 'GPS RECEIVER (XLi)',
        'ntp-nist': 'NTP (NIST)',
        'ntp-npl-india': 'NTP (NPL India)',
        'https-worldtimeapi': 'HTTPS TIME API (WorldTimeAPI)',
        'https-timeapiio': 'HTTPS TIME API (TimeAPI.io)',
        'http-date': 'INTERNET/HTTP DATE',
        'local-clock': 'LOCAL CLOCK',
        'browser-local-clock': 'BROWSER LOCAL CLOCK',
      }[sourceKey] || String(sourceKey || 'UNKNOWN').toUpperCase();
    }
    updateFallbackInfo() {}
  }

  const RAFOTimeApp = {
    APP_CONFIG: {
      apiBackupUrl: '',
      apiAuthToken: '',
      statusPollingEnabled: true,
      requestTimeoutMs: 50,
      statusFreshnessWindowMs: 30_000,
      syncIntervalMs: 60_000,
      statusPollingIntervalMs: 60_000,
      liveStatusRefreshIntervalMs: 1000,
    },
    OMAN_DATE_TIME_FORMATTER: formatter,
    resolveApiBaseUrl: () => 'http://example.test/api',
    normalizeBaseUrl: (value) => value,
    normalizeDataState: (dataState, stale = false) => {
      if (stale && dataState !== 'unavailable') return 'stale';
      return ['live', 'cached', 'stale', 'unavailable'].includes(dataState) ? dataState : 'waiting';
    },
    buildMonitoringModel: (_runtime, receiver) => ({
      dataState: receiver.dataState || 'waiting',
    }),
    humanizeSource: (sourceKey) => ({
      'gps-xli': 'GPS RECEIVER (XLi)',
      'ntp-nist': 'NTP (NIST)',
      'ntp-npl-india': 'NTP (NPL India)',
      'https-worldtimeapi': 'HTTPS TIME API (WorldTimeAPI)',
      'https-timeapiio': 'HTTPS TIME API (TimeAPI.io)',
      'http-date': 'INTERNET/HTTP DATE',
      'local-clock': 'LOCAL CLOCK',
      'browser-local-clock': 'BROWSER LOCAL CLOCK',
    }[sourceKey] || String(sourceKey || '').replace(/-/g, ' ')),
    formatClockTime: () => '00:00:00',
    formatTimeParts: (hour, minute, second) => `${hour}:${minute}:${second}`,
    MessageCenter,
  };

  const sandbox = {
    window: {
      RAFOTimeApp,
      appMessageCenter: new MessageCenter(),
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      fetch: fetchImpl,
      dispatchEvent() {},
    },
    fetch: fetchImpl,
    EventTarget,
    CustomEvent,
    AbortController,
    Date,
    Intl,
    console,
  };
  sandbox.window.window = sandbox.window;

  vm.runInNewContext(source, sandbox, { filename: 'runtime-sync.js' });
  return sandbox.window.RAFOTimeApp;
}

async function testTraceableFallbackRemainsVisible() {
  const payload = {
    backendOnline: true,
    receiverConfigured: true,
    receiverReachable: false,
    loginOk: false,
    isLocked: false,
    gpsLockState: 'unknown',
    statusText: 'Traceable fallback active',
    status: 'Traceable fallback active',
    currentSource: 'ntp-nist',
    currentSourceLabel: 'NTP (NIST)',
    sourceKey: 'ntp-nist',
    sourceLabel: 'NTP (NIST)',
    sourceTier: 'traceable-fallback',
    fallback: true,
    traceable: true,
    authoritative: false,
    timestamp: Date.now(),
    isoTimestamp: new Date().toISOString(),
    date: '03/22/2026',
    time: '12:00:00',
  };

  const { GPSTimeSync } = createHarness(async () => createResponse(payload));
  const sync = new GPSTimeSync();
  const state = await sync.syncTime();

  assert.equal(state.backendOnline, true);
  assert.equal(state.currentSource, 'ntp-nist');
  assert.equal(state.sourceLabel, 'NTP (NIST)');
  assert.equal(sync.getSourceDisplayName(state), 'NTP (NIST)');
}

async function testInternetFallbackRemainsBackendAuthoritative() {
  const payload = {
    backendOnline: true,
    receiverConfigured: true,
    receiverReachable: false,
    loginOk: false,
    isLocked: false,
    gpsLockState: 'unknown',
    statusText: 'Internet fallback active',
    status: 'Internet fallback active',
    currentSource: 'https-worldtimeapi',
    currentSourceLabel: 'HTTPS TIME API (WorldTimeAPI)',
    sourceKey: 'https-worldtimeapi',
    sourceLabel: 'HTTPS TIME API (WorldTimeAPI)',
    sourceTier: 'internet-fallback',
    fallback: true,
    traceable: false,
    authoritative: false,
    timestamp: Date.now(),
    isoTimestamp: new Date().toISOString(),
    date: '03/22/2026',
    time: '12:00:00',
  };

  const { GPSTimeSync } = createHarness(async () => createResponse(payload));
  const sync = new GPSTimeSync();
  const state = await sync.syncTime();

  assert.equal(state.backendOnline, true);
  assert.equal(state.currentSource, 'https-worldtimeapi');
  assert.equal(sync.getSourceDisplayName(state), 'HTTPS TIME API (WorldTimeAPI)');
}

async function testStatusSuccessFalseDoesNotMeanBackendOffline() {
  const statusPayload = {
    success: false,
    backendOnline: true,
    receiverConfigured: true,
    receiverReachable: false,
    loginOk: false,
    isLocked: false,
    gpsLockState: 'unknown',
    statusText: 'Traceable fallback active',
    status: 'Traceable fallback active',
    currentSource: 'ntp-nist',
    currentSourceLabel: 'NTP (NIST)',
    sourceKey: 'ntp-nist',
    sourceLabel: 'NTP (NIST)',
    sourceTier: 'traceable-fallback',
    fallback: true,
    traceable: true,
    authoritative: false,
    checkedAt: new Date().toISOString(),
    dataState: 'unavailable',
    stale: false,
  };

  const { GPSTimeSync } = createHarness(async () => createResponse(statusPayload));
  const sync = new GPSTimeSync();
  const status = await sync.pollStatus();

  assert.equal(status.backendOnline, true);
  assert.equal(status.currentSource, 'ntp-nist');
  assert.equal(status.sourceLabel, 'NTP (NIST)');
  assert.equal(status.dataState, 'unavailable');
}

async function testInvalidStatusJsonMarksBackendUnavailable() {
  const { GPSTimeSync } = createHarness(async () => createResponse(null, { jsonError: new SyntaxError('Unexpected token <') }));
  const sync = new GPSTimeSync();
  const status = await sync.pollStatus();

  assert.equal(status.backendOnline, false);
  assert.match(status.statusText, /Status polling unavailable: Invalid JSON returned by \/status/);
}

async function testTimeFetchFailureFallsBackToBrowserLocalClock() {
  const { GPSTimeSync } = createHarness(async () => {
    throw new Error('connect ECONNREFUSED');
  });
  const sync = new GPSTimeSync();
  const state = await sync.syncTime();

  assert.equal(state.backendOnline, false);
  assert.equal(state.currentSource, 'browser-local-clock');
  assert.match(state.statusText, /Browser emergency fallback active:/);
}

(async () => {
  await testTraceableFallbackRemainsVisible();
  await testInternetFallbackRemainsBackendAuthoritative();
  await testStatusSuccessFalseDoesNotMeanBackendOffline();
  await testInvalidStatusJsonMarksBackendUnavailable();
  await testTimeFetchFailureFallsBackToBrowserLocalClock();
  console.log('runtime-sync harness passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
