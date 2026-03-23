const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createResponse(payload, { ok = true, status = 200, jsonError = null, headers = {} } = {}) {
  return {
    ok,
    status,
    headers: {
      get(name) {
        return headers[String(name).toLowerCase()] || null;
      },
    },
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
      return ['ntp-nist', 'ntp-npl-india', 'https-worldtimeapi', 'https-timeapiio', 'http-date', 'frontend-worldtimeapi', 'frontend-timeapiio', 'frontend-http-date', 'local-clock', 'browser-local-clock'].includes(sourceKey);
    }
    getSourceLabel(sourceKey) {
      return {
        'gps-xli': 'GPS RECEIVER (XLi)',
        'ntp-nist': 'Internet (NIST)',
        'ntp-npl-india': 'Internet (NPL India)',
        'https-worldtimeapi': 'Internet (WorldTimeAPI)',
        'https-timeapiio': 'Internet (timeapi.io)',
        'http-date': 'Internet (HTTP Date)',
        'frontend-worldtimeapi': 'Internet (WorldTimeAPI)',
        'frontend-timeapiio': 'Internet (timeapi.io)',
        'frontend-http-date': 'Internet (HTTP Date)',
        'local-clock': 'Internal Clock',
        'browser-local-clock': 'Internal Clock',
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
      remoteTimeRequestTimeoutMs: 50,
      frontendEmergencyRefreshMs: 300000,
      browserEmergencyRetryMs: 60000,
      statusFreshnessWindowMs: 30000,
      syncIntervalMs: 60000,
      statusPollingIntervalMs: 60000,
      liveStatusRefreshIntervalMs: 1000,
      timezoneLabel: 'GST (UTC+04:00)',
      remoteInternetTimeSources: [
        { name: 'WorldTimeAPI', url: 'https://worldtimeapi.example/api/timezone/Asia/Muscat', parser: 'worldtimeapi' },
        { name: 'TimeAPI.io', url: 'https://timeapi.example/api/Time/current/zone?timeZone=Asia/Muscat', parser: 'timeapiio' },
      ],
      remoteHttpDateSources: [
        { name: 'HTTP Date', url: 'https://http-date.example/headers' },
      ],
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
      'ntp-nist': 'Internet (NIST)',
      'ntp-npl-india': 'Internet (NPL India)',
      'https-worldtimeapi': 'Internet (WorldTimeAPI)',
      'https-timeapiio': 'Internet (timeapi.io)',
      'http-date': 'Internet (HTTP Date)',
      'frontend-worldtimeapi': 'Internet (WorldTimeAPI)',
      'frontend-timeapiio': 'Internet (timeapi.io)',
      'frontend-http-date': 'Internet (HTTP Date)',
      'local-clock': 'Internal Clock',
      'browser-local-clock': 'Internal Clock',
    }[sourceKey] || String(sourceKey || '').replace(/-/g, ' ')),
    getStandardStatusInfo: (state = {}) => ({
      source: state.sourceLabel || state.currentSourceLabel || state.currentSource || 'Unknown',
      status: state.status || state.statusText || 'Status unavailable',
      severity: state.currentSource === 'gps-xli' ? 'healthy' : ['browser-local-clock', 'local-clock'].includes(state.currentSource) ? 'critical' : 'warning',
    }),
    formatStandardStatusLines: (state = {}) => [
      state.sourceLabel || state.currentSourceLabel || state.currentSource || 'Unknown',
      state.status || state.statusText || 'Status unavailable',
    ],
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

async function testBackendHealthyDoesNotUseFrontendFallbackApis() {
  const calls = [];
  const payload = {
    backendOnline: true,
    receiverConfigured: true,
    receiverReachable: true,
    loginOk: true,
    isLocked: true,
    gpsLockState: 'locked',
    statusText: 'Primary reference active',
    status: 'Primary reference active',
    currentSource: 'gps-xli',
    currentSourceLabel: 'GPS RECEIVER (XLi)',
    sourceKey: 'gps-xli',
    sourceLabel: 'GPS RECEIVER (XLi)',
    sourceTier: 'primary-reference',
    fallback: false,
    traceable: true,
    authoritative: true,
    timestamp: Date.now(),
    isoTimestamp: new Date().toISOString(),
    date: '03/22/2026',
    time: '12:00:00',
  };

  const { GPSTimeSync } = createHarness(async (url) => {
    calls.push(String(url));
    return createResponse(payload);
  });
  const sync = new GPSTimeSync();
  const state = await sync.syncTime();

  assert.equal(state.currentSource, 'gps-xli');
  assert.deepEqual(calls, ['http://example.test/api/time']);
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
    currentSourceLabel: 'Internet (NIST)',
    sourceKey: 'ntp-nist',
    sourceLabel: 'Internet (NIST)',
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
  assert.equal(state.sourceLabel, 'Internet (NIST)');
  assert.equal(sync.getSourceDisplayName(state), 'Internet (NIST)');
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
    currentSourceLabel: 'Internet (WorldTimeAPI)',
    sourceKey: 'https-worldtimeapi',
    sourceLabel: 'Internet (WorldTimeAPI)',
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
  assert.equal(sync.getSourceDisplayName(state), 'Internet (WorldTimeAPI)');
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
    currentSourceLabel: 'Internet (NIST)',
    sourceKey: 'ntp-nist',
    sourceLabel: 'Internet (NIST)',
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
  assert.equal(status.sourceLabel, 'Internet (NIST)');
  assert.equal(status.dataState, 'unavailable');
}

async function testInvalidStatusJsonMarksBackendUnavailable() {
  const { GPSTimeSync } = createHarness(async () => createResponse(null, { jsonError: new SyntaxError('Unexpected token <') }));
  const sync = new GPSTimeSync();
  const status = await sync.pollStatus();

  assert.equal(status.backendOnline, false);
  assert.equal(status.statusText, 'Lost (no valid time source)');
}

async function testBackendFailureFallsBackToFrontendWorldTimeApi() {
  const { GPSTimeSync } = createHarness(async (url) => {
    if (String(url).endsWith('/time')) {
      throw new Error('connect ECONNREFUSED');
    }
    if (String(url).includes('worldtimeapi.example')) {
      return createResponse({ datetime: '2026-03-22T14:00:00+04:00' });
    }
    throw new Error(`unexpected url ${url}`);
  });
  const sync = new GPSTimeSync();
  const state = await sync.syncTime();

  assert.equal(state.backendOnline, false);
  assert.equal(state.currentSource, 'frontend-worldtimeapi');
  assert.equal(state.sourceLabel, 'Internet (WorldTimeAPI)');
  assert.equal(state.status, 'Degraded (primary source unavailable)');
  assert.equal(state.statusText, 'Degraded (primary source unavailable)');
}

async function testBackendFailureFallsBackToFrontendTimeApiIo() {
  const { GPSTimeSync } = createHarness(async (url) => {
    if (String(url).endsWith('/time')) {
      throw new Error('connect ECONNREFUSED');
    }
    if (String(url).includes('worldtimeapi.example')) {
      throw new Error('CORS blocked');
    }
    if (String(url).includes('timeapi.example')) {
      return createResponse({ dateTime: '2026-03-22T14:00:00+04:00' });
    }
    throw new Error(`unexpected url ${url}`);
  });
  const sync = new GPSTimeSync();
  const state = await sync.syncTime();

  assert.equal(state.currentSource, 'frontend-timeapiio');
  assert.equal(state.sourceLabel, 'Internet (timeapi.io)');
  assert.equal(state.status, 'Degraded (primary source unavailable)');
}

async function testBackendFailureFallsBackToHttpDate() {
  const { GPSTimeSync } = createHarness(async (url, options = {}) => {
    if (String(url).endsWith('/time')) {
      throw new Error('connect ECONNREFUSED');
    }
    if (String(url).includes('worldtimeapi.example') || String(url).includes('timeapi.example')) {
      throw new Error('network unavailable');
    }
    if (String(url).includes('http-date.example') && options.method === 'HEAD') {
      return createResponse(null, {
        headers: {
          date: 'Sun, 22 Mar 2026 10:00:00 GMT',
        },
      });
    }
    throw new Error(`unexpected url ${url}`);
  });
  const sync = new GPSTimeSync();
  const state = await sync.syncTime();

  assert.equal(state.currentSource, 'frontend-http-date');
  assert.equal(state.sourceLabel, 'Internet (HTTP Date)');
  assert.equal(state.protocol, 'https');
}

async function testTimeFetchFailureFallsBackToBrowserLocalClock() {
  const { GPSTimeSync } = createHarness(async (url) => {
    if (String(url).endsWith('/time')) {
      throw new Error('connect ECONNREFUSED');
    }
    throw new Error('network unavailable');
  });
  const sync = new GPSTimeSync();
  const state = await sync.syncTime();

  assert.equal(state.backendOnline, false);
  assert.equal(state.currentSource, 'browser-local-clock');
  assert.equal(state.statusText, 'Holdover (using last valid sync)');
}

(async () => {
  await testBackendHealthyDoesNotUseFrontendFallbackApis();
  await testTraceableFallbackRemainsVisible();
  await testInternetFallbackRemainsBackendAuthoritative();
  await testStatusSuccessFalseDoesNotMeanBackendOffline();
  await testInvalidStatusJsonMarksBackendUnavailable();
  await testBackendFailureFallsBackToFrontendWorldTimeApi();
  await testBackendFailureFallsBackToFrontendTimeApiIo();
  await testBackendFailureFallsBackToHttpDate();
  await testTimeFetchFailureFallsBackToBrowserLocalClock();
  console.log('runtime-sync harness passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
