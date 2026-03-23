const assert = require('assert');
const dgram = require('dgram');
const http = require('http');
const { createTimingSourceService, getSourceDefinition } = require('../time-source-service');

const NTP_UNIX_EPOCH_OFFSET_SECONDS = 2208988800;

function createNtpResponse(date = new Date('2026-03-22T10:00:00.250Z')) {
  const buffer = Buffer.alloc(48);
  buffer[0] = 0x24;
  const seconds = Math.floor(date.getTime() / 1000) + NTP_UNIX_EPOCH_OFFSET_SECONDS;
  const fraction = Math.round((date.getUTCMilliseconds() / 1000) * 0x100000000) >>> 0;
  buffer.writeUInt32BE(seconds >>> 0, 40);
  buffer.writeUInt32BE(fraction >>> 0, 44);
  return buffer;
}

async function withUdpServer(handler, run) {
  const server = dgram.createSocket('udp4');
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.bind(0, '127.0.0.1', resolve);
  });
  server.on('message', handler(server));
  try {
    const { port } = server.address();
    return await run(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function withHttpServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const { port } = server.address();
    return await run(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function runTests() {
  assert.equal(getSourceDefinition('gps-xli').sourceLabel, 'GPS Receiver');
  assert.equal(getSourceDefinition('ntp-nist').status, 'Degraded (primary source unavailable)');
  assert.equal(getSourceDefinition('https-worldtimeapi').sourceLabel, 'Internet (WorldTimeAPI)');
  assert.equal(getSourceDefinition('https-timeapiio').sourceLabel, 'Internet (timeapi.io)');
  assert.equal(getSourceDefinition('http-date').traceable, false);
  assert.equal(getSourceDefinition('local-clock').sourceTier, 'emergency-fallback');

  await withUdpServer((server) => (message, rinfo) => {
    assert.ok(Buffer.isBuffer(message));
    server.send(createNtpResponse(), rinfo.port, rinfo.address);
  }, async (port) => {
    const service = createTimingSourceService({
      ntpTimeoutMs: 250,
      httpsApiTimeoutMs: 250,
      httpTimeoutMs: 250,
      nistHosts: [`127.0.0.1:${port}`],
      nplHosts: [],
      worldTimeApiUrls: [],
      timeApiIoUrls: [],
      httpDateUrls: [],
    });

    const result = await service.resolveFallbackHierarchy();
    assert.equal(result.sourceKey, 'ntp-nist');
    assert.equal(result.sourceLabel, 'Internet (NIST)');
    assert.equal(result.traceable, true);
    assert.equal(result.fallback, true);
    assert.ok(Number.isFinite(result.timestamp));
  });

  await withUdpServer((server) => (message, rinfo) => {
    server.send(createNtpResponse(), rinfo.port, rinfo.address);
  }, async (port) => {
    const service = createTimingSourceService({
      ntpTimeoutMs: 150,
      httpsApiTimeoutMs: 250,
      httpTimeoutMs: 250,
      nistHosts: ['203.0.113.10:123'],
      nplHosts: [`127.0.0.1:${port}`],
      worldTimeApiUrls: [],
      timeApiIoUrls: [],
      httpDateUrls: [],
    });

    const result = await service.resolveFallbackHierarchy();
    assert.equal(result.sourceKey, 'ntp-npl-india');
    assert.equal(result.sourceLabel, 'Internet (NPL India)');
    assert.equal(result.traceable, true);
    assert.equal(result.resolutionErrors.length, 1);
    assert.equal(result.resolutionErrors[0].sourceKey, 'ntp-nist');
  });

  await withHttpServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ datetime: '2026-03-22T14:00:00+04:00' }));
  }, async (worldPort) => {
    const service = createTimingSourceService({
      ntpTimeoutMs: 80,
      httpsApiTimeoutMs: 250,
      httpTimeoutMs: 250,
      nistHosts: ['203.0.113.20:123'],
      nplHosts: ['203.0.113.21:123'],
      worldTimeApiUrls: [`http://127.0.0.1:${worldPort}`],
      timeApiIoUrls: [],
      httpDateUrls: [],
    });

    const result = await service.resolveFallbackHierarchy();
    assert.equal(result.sourceKey, 'https-worldtimeapi');
    assert.equal(result.sourceLabel, 'Internet (WorldTimeAPI)');
    assert.equal(result.traceable, false);
    assert.equal(result.resolutionErrors.length, 2);
  });

  await withHttpServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ dateTime: '2026-03-22T14:00:00+04:00' }));
  }, async (timeApiPort) => {
    const service = createTimingSourceService({
      ntpTimeoutMs: 80,
      httpsApiTimeoutMs: 250,
      httpTimeoutMs: 250,
      nistHosts: ['203.0.113.30:123'],
      nplHosts: ['203.0.113.31:123'],
      worldTimeApiUrls: ['http://127.0.0.1:9'],
      timeApiIoUrls: [`http://127.0.0.1:${timeApiPort}`],
      httpDateUrls: [],
    });

    const result = await service.resolveFallbackHierarchy();
    assert.equal(result.sourceKey, 'https-timeapiio');
    assert.equal(result.sourceLabel, 'Internet (timeapi.io)');
    assert.equal(result.resolutionErrors.length, 3);
  });

  await withHttpServer((req, res) => {
    res.statusCode = 200;
    res.setHeader('Date', 'Sun, 22 Mar 2026 10:00:00 GMT');
    res.end();
  }, async (httpPort) => {
    const service = createTimingSourceService({
      ntpTimeoutMs: 80,
      httpsApiTimeoutMs: 100,
      httpTimeoutMs: 250,
      nistHosts: ['203.0.113.40:123'],
      nplHosts: ['203.0.113.41:123'],
      worldTimeApiUrls: ['http://127.0.0.1:9'],
      timeApiIoUrls: ['http://127.0.0.1:9'],
      httpDateUrls: [`http://127.0.0.1:${httpPort}`],
    });

    const result = await service.resolveFallbackHierarchy();
    assert.equal(result.sourceKey, 'http-date');
    assert.equal(result.sourceLabel, 'Internet (HTTP Date)');
    assert.equal(result.traceable, false);
    assert.equal(result.resolutionErrors.length, 4);
  });

  await withUdpServer((server) => (message, rinfo) => {
    setTimeout(() => {
      server.send(createNtpResponse(), rinfo.port, rinfo.address);
    }, 120);
  }, async (port) => {
    const service = createTimingSourceService({
      ntpTimeoutMs: 250,
      httpsApiTimeoutMs: 250,
      httpTimeoutMs: 250,
      nistHosts: [`127.0.0.1:${port}`, '203.0.113.60:123'],
      nplHosts: ['203.0.113.61:123'],
      worldTimeApiUrls: ['http://127.0.0.1:9'],
      timeApiIoUrls: ['http://127.0.0.1:9'],
      httpDateUrls: ['http://127.0.0.1:9'],
    });

    const startedAt = Date.now();
    const result = await service.resolveFallbackHierarchy();
    const elapsed = Date.now() - startedAt;

    assert.equal(result.sourceKey, 'ntp-nist');
    assert.ok(elapsed < 350, `Expected NTP group resolution to finish quickly, but took ${elapsed} ms`);
  });

  const localOnly = createTimingSourceService({
    ntpTimeoutMs: 50,
    httpsApiTimeoutMs: 50,
    httpTimeoutMs: 50,
    nistHosts: ['203.0.113.70:123'],
    nplHosts: ['203.0.113.71:123'],
    worldTimeApiUrls: ['http://127.0.0.1:9'],
    timeApiIoUrls: ['http://127.0.0.1:9'],
    httpDateUrls: ['http://127.0.0.1:9'],
  });
  const localResult = await localOnly.resolveFallbackHierarchy();
  assert.equal(localResult.sourceKey, 'local-clock');
  assert.equal(localResult.sourceLabel, 'Internal Clock');
  assert.ok(Array.isArray(localResult.resolutionErrors));
  assert.equal(localResult.resolutionErrors.length, 5);

  console.log('Time source harness passed.');
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
