const assert = require('assert');
const net = require('net');

process.env.GPS_HOST = process.env.GPS_HOST || '127.0.0.1';
process.env.GPS_PORT = process.env.GPS_PORT || '23';
process.env.GPS_USERNAME = process.env.GPS_USERNAME || 'admin';
process.env.GPS_PASSWORD = process.env.GPS_PASSWORD || 'password';
process.env.API_AUTH_ENABLED = process.env.API_AUTH_ENABLED || 'false';

const {
  parseGpsTimeResponse,
  parseReceiverAcknowledgement,
  parseGpsReceiverInfo,
  parseGpsPosition,
  parseGpsSatelliteList,
  classifyReceiverError,
  connectToGPS,
  validateConfig,
} = require('../receiver-protocol');

async function withTcpServer(handler, run) {
  const server = net.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  try {
    return await run(address.port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function expectReject(label, promiseFactory, matcher) {
  let failed = false;
  try {
    await promiseFactory();
  } catch (error) {
    failed = true;
    if (matcher) {
      assert.match(error.message, matcher, `${label} failed with unexpected error: ${error.message}`);
    }
  }

  assert.ok(failed, `${label} should reject`);
}

async function runTests() {
  await withTcpServer((socket) => {
    socket.write('USER NAME:');
    let stage = 'username';
    let commandBuffer = '';

    socket.on('data', (chunk) => {
      const text = chunk.toString();
      if (stage === 'username') {
        assert.match(text, /admin/i);
        stage = 'password';
        socket.write('PASSWORD:');
        return;
      }

      if (stage === 'password') {
        assert.match(text, /password/i);
        stage = 'command';
        socket.write('LOGIN SUCCESSFUL!');
        return;
      }

      commandBuffer += text;
      if (/F3\r\n/.test(commandBuffer)) {
        socket.write('F3 UTC 03/20/2026 06:28:56 LOCKED\r\n');
        socket.end();
      }
    });
  }, async (port) => {
    const result = await connectToGPS({ host: '127.0.0.1', port, username: 'admin', password: 'password', command: 'F3\r\n', timeoutMs: 500 });
    assert.equal(result.receiverReachable, true);
    assert.equal(result.loginOk, true);
    assert.match(result.raw, /LOCKED/i);
  });

  await withTcpServer((socket) => {
    socket.write('USER NAME:');
    let stage = 'username';

    socket.on('data', (chunk) => {
      const text = chunk.toString();
      if (stage === 'username') {
        assert.match(text, /admin/i);
        stage = 'password';
        socket.write('PASSWORD:');
        return;
      }

      socket.write('LOGIN FAILED');
      socket.end();
    });
  }, async (port) => {
    await expectReject('receiver login failure transcript', () => connectToGPS({ host: '127.0.0.1', port, username: 'admin', password: 'password', command: 'F3\r\n', timeoutMs: 500 }), /login failed/i);
  });

  await withTcpServer((socket) => {
    socket.write('USER NAME:');
  }, async (port) => {
    await expectReject('receiver timeout behavior', () => connectToGPS({ host: '127.0.0.1', port, username: 'admin', password: 'password', command: 'F3\r\n', timeoutMs: 120 }), /timeout/i);
  });

  await withTcpServer((socket) => {
    socket.write('USER NAME:');
    let stage = 'username';

    socket.on('data', (chunk) => {
      const text = chunk.toString();
      if (stage === 'username') {
        assert.match(text, /admin/i);
        stage = 'password';
        socket.write('PASSWORD:');
        return;
      }

      if (stage === 'password') {
        assert.match(text, /password/i);
        stage = 'command';
        socket.write('LOGIN SUCCESSFUL!');
        return;
      }

      if (/F60\r\n/.test(text)) {
        socket.write('PRN 01 GOOD CURRENT -152.5 dBW\r\n');
        setTimeout(() => socket.write('PRN 12 GOOD TRACKED -148.0 dBW\r\n'), 40);
        setTimeout(() => socket.end(), 80);
      }
    });
  }, async (port) => {
    const result = await connectToGPS({
      host: '127.0.0.1',
      port,
      username: 'admin',
      password: 'password',
      command: 'F60\r\n',
      timeoutMs: 800,
      responseMode: 'idle',
      idleGraceMs: 70,
    });
    assert.match(result.raw, /PRN 01/i);
    assert.match(result.raw, /PRN 12/i);
  });

  await expectReject('receiver unreachable behavior', () => connectToGPS({ host: '127.0.0.1', port: 9, username: 'admin', password: 'password', command: 'F3\r\n', timeoutMs: 200 }), /(ECONNREFUSED|timeout|socket)/i);

  const locked = parseGpsTimeResponse('F3 UTC 03/20/2026 06:28:56 LOCKED');
  assert.equal(locked.receiverTimeMode, 'UTC');
  assert.equal(locked.gpsLockState, 'locked');
  assert.equal(locked.currentSource, 'gps-locked');
  assert.equal(locked.timestamp, Date.UTC(2026, 2, 20, 6, 28, 56));

  const unlocked = parseGpsTimeResponse('F3 UTC 03/20/2026 06:28:56 UNLOCKED SEARCHING');
  assert.equal(unlocked.gpsLockState, 'unlocked');
  assert.equal(unlocked.currentSource, 'gps-unlocked');

  const holdover = parseGpsTimeResponse('F3 UTC 03/20/2026 06:28:56 HOLDOVER');
  assert.equal(holdover.gpsLockState, 'holdover');
  assert.equal(holdover.currentSource, 'holdover');

  const receiverInfo = parseGpsReceiverInfo('F119 B1 GPS PART NUMBER 87-1234 SOFTWARE 1.20 FPGA 2.30 GPS STATUS LOCKED GPS ANTENNA OK GPS ACQUISITION STATE DYNAMIC MODE');
  assert.equal(receiverInfo.boardPartNumber, '87-1234');
  assert.equal(receiverInfo.softwareVersion, '1.20');
  assert.equal(receiverInfo.fpgaVersion, '2.30');
  assert.equal(receiverInfo.antennaStatus, 'OK');
  assert.equal(receiverInfo.acquisitionState, 'DYNAMIC MODE');

  const llaPosition = parseGpsPosition('F50 B1 LLA N23d35\'44.1" E058d24\'12.3" 42.5m');
  assert.equal(llaPosition.mode, 'lla');
  assert.equal(llaPosition.latitude.text, 'N23d35\'44.1"');
  assert.equal(llaPosition.longitude.text, 'E058d24\'12.3"');
  assert.equal(llaPosition.altitudeMeters, 42.5);

  const xyzPosition = parseGpsPosition('F50 B1 XYZ -2401231.0m 5388121.5m 2579210.2m');
  assert.equal(xyzPosition.mode, 'xyz');
  assert.equal(xyzPosition.xMeters, -2401231.0);
  assert.equal(xyzPosition.yMeters, 5388121.5);
  assert.equal(xyzPosition.zMeters, 2579210.2);

  const satellites = parseGpsSatelliteList('PRN 01 GOOD CURRENT -152.5 dBW\r\nPRN 12 GOOD TRACKED -148.0 dBW\r\n');
  assert.equal(satellites.satellites.length, 2);
  assert.equal(satellites.satellites[0].prn, 1);
  assert.equal(satellites.satellites[0].utilization, 'Current');
  assert.equal(satellites.satellites[1].utilization, 'Tracked');

  const ack = parseReceiverAcknowledgement('\0\0OK\r\n');
  assert.equal(ack.acknowledged, true);
  assert.equal(ack.raw, 'OK');

  const classified = classifyReceiverError(new Error('ECONNREFUSED while opening socket'));
  assert.equal(classified.receiverCommunicationState, 'unreachable');

  const validConfig = validateConfig({
    port: 3000,
    gpsHost: '127.0.0.1',
    gpsPort: 23,
    gpsUsername: 'admin',
    gpsPassword: 'password',
    receiverEnabled: true,
    allowedOrigins: Object.freeze([]),
    serveStatic: true,
    nodeEnv: 'development',
    minConnectionIntervalMs: 5000,
    requestTimeoutMs: 15000,
    receiverStatusCacheMs: 4000,
    statusStaleMs: 45000,
    authEnabled: false,
    authToken: '',
    rateLimitWindowMs: 60000,
    rateLimitTimeMax: 90,
    rateLimitStatusMax: 30,
    rateLimitInternetMax: 60,
    rateLimitSetMax: 8,
  });
  assert.equal(validConfig.port, 3000);

  assert.throws(() => validateConfig({ ...validConfig, requestTimeoutMs: Number.NaN }), /REQUEST_TIMEOUT_MS/);
  assert.throws(() => validateConfig({ ...validConfig, gpsUsername: '' }), /GPS_USERNAME/);
  assert.throws(() => validateConfig({ ...validConfig, authEnabled: true, authToken: '' }), /API_AUTH_TOKEN/);
  assert.equal(validateConfig({ ...validConfig, receiverEnabled: false, gpsUsername: '', gpsPassword: '', gpsHost: '' }).receiverEnabled, false);

  console.log('Protocol harness passed.');
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
