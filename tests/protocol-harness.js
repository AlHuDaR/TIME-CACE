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
  parseXliWebSatelliteTable,
  classifyReceiverError,
  createReceiverConnectionManager,
  connectToGPS,
  validateConfig,
} = require('../receiver-protocol');
const { createGpsDetailEligibilitySnapshot, parseGpsModeResponse } = require('../gps-proxy');

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

  await withTcpServer((socket) => {
    socket.write('USER NAME:');
    let stage = 'username';
    let commandsSeen = 0;
    let buffer = '';

    socket.on('data', (chunk) => {
      const text = chunk.toString();
      if (stage === 'username') {
        stage = 'password';
        socket.write('PASSWORD:');
        return;
      }

      if (stage === 'password') {
        stage = 'command';
        socket.write('LOGIN SUCCESSFUL!');
        return;
      }

      buffer += text;
      if (buffer.includes('\r\n')) {
        const command = buffer;
        buffer = '';
        commandsSeen += 1;
        socket.write(commandsSeen === 1
          ? 'F3 UTC 03/20/2026 06:28:56 LOCKED\r\n'
          : 'F50 B1 XYZ -2401231.0m 5388121.5m 2579210.2m\r\n');
      }
    });
  }, async (port) => {
    const logs = [];
    const manager = createReceiverConnectionManager({
      host: '127.0.0.1',
      port,
      username: 'admin',
      password: 'password',
      commandTimeoutMs: 600,
      reconnectInitialMs: 10,
      reconnectMaxMs: 20,
      logger: {
        info(message) { logs.push(message); },
        warn(message) { logs.push(message); },
        log(message) { logs.push(message); },
      },
    });

    try {
      const first = await manager.sendCommand('F3\r\n', { responseMode: 'pattern', completionPattern: /LOCKED/ });
      const second = await manager.sendCommand('F50\r\n', { responseMode: 'idle', idleGraceMs: 40 });
      assert.match(first.raw, /LOCKED/);
      assert.match(second.raw, /XYZ/);
      assert.equal(manager.getStateSnapshot().connected, true);
      assert.ok(logs.some((entry) => /authentication succeeded/i.test(entry)));
    } finally {
      manager.close();
    }
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

  const xliReceiverInfo = parseGpsReceiverInfo(`
    F119 B1:
    GPS PART NUMBER 87-8028-02
    SOFTWARE 230-01510-04v1.20
    FPGA 184-8024v1
    GPS STATUS LOCKED
    GPS ANTENNA OK
    GPS ACQUISITION STATE: TRAIM ACTIVE
  `);
  assert.equal(xliReceiverInfo.boardPartNumber, '87-8028-02');
  assert.equal(xliReceiverInfo.softwareVersion, '230-01510-04v1.20');
  assert.equal(xliReceiverInfo.fpgaVersion, '184-8024v1');
  assert.equal(xliReceiverInfo.gpsStatus, 'LOCKED');
  assert.equal(xliReceiverInfo.antennaStatus, 'OK');
  assert.equal(xliReceiverInfo.acquisitionState, 'TRAIM ACTIVE');

  const xliReceiverInfoHeaderOnly = parseGpsReceiverInfo('F119 B1:\r\n');
  assert.equal(xliReceiverInfoHeaderOnly.acquisitionState, null);

  const gpsModeHeaderOnly = parseGpsModeResponse('F53 B1');
  assert.equal(gpsModeHeaderOnly.mode, null);

  const gpsModeTimeMode = parseGpsModeResponse('F53 B1 TIME MODE');
  assert.equal(gpsModeTimeMode.mode, 'TIME MODE');

  const detailEligibilitySnapshot = createGpsDetailEligibilitySnapshot({
    receiverConfigured: true,
    receiverReachable: false,
    loginOk: false,
    gpsLockState: 'unknown',
    receiverCommunicationState: 'unreachable',
  }, {
    receiverReachable: true,
    loginOk: true,
    gpsLockState: 'locked',
  });
  assert.equal(detailEligibilitySnapshot.receiverConfigured, true);
  assert.equal(detailEligibilitySnapshot.receiverReachable, true);
  assert.equal(detailEligibilitySnapshot.loginOk, true);
  assert.equal(detailEligibilitySnapshot.gpsLockState, 'locked');
  assert.equal(detailEligibilitySnapshot.receiverCommunicationState, 'authenticated');

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

  const satellitesCurrent = parseGpsSatelliteList(`
    F60 B1 CURRENT
    F60 B1 prn5 good current -159dBW
    F60 B1 prn6 good current -162dBW
    F60 B1 prn11 good current -152dBW
    F60 B1 prn12 good current -151dBW
    F60 B1 prn19 good current -157dBW
    F60 B1 prn21 good current -159dBW
    F60 B1 prn24 good current -159dBW
    F60 B1 prn25 good current -158dBW
    F60 B1 prn29 good current -154dBW
  `);
  assert.equal(satellitesCurrent.satellites.length, 9);
  assert.deepEqual(satellitesCurrent.satellites[0], {
    prn: 5,
    health: 'good',
    usage: 'current',
    signalDbw: -159,
    status: 'good',
    utilization: 'current',
    levelDbw: -159,
    level: -159,
    raw: 'F60 B1 prn5 good current -159dBW',
  });

  const satellitesTracked = parseGpsSatelliteList(`
    junk noise
    F60 B1 TRACKED
    F60 B1 prn5 good tracked -159dBW
    F60 B1 prn6 good tracked -162dBW
    F60 B1 prn11 good tracked -152dBW
    F60 B1 prn12 good tracked -151dBW
    F60 B1 prn19 good tracked -158dBW
    F60 B1 prn21 good tracked -158dBW
    F60 B1 prn24 good tracked -160dBW
    F60 B1 prn25 good tracked -158dBW
    F60 B1 prn29 good tracked -154dBW
    incomplete fragment F60
  `);
  assert.equal(satellitesTracked.satellites.length, 9);
  assert.equal(satellitesTracked.satellites[8].prn, 29);
  assert.equal(satellitesTracked.satellites[8].usage, 'tracked');
  assert.equal(satellitesTracked.satellites[8].signalDbw, -154);

  const xliSatelliteHtml = `
    <html><body>
      <table>
        <tr><th>Tracked Satellite List</th></tr>
        <tr><th>PRN</th><th>Status</th><th>Utilization</th><th>Level</th></tr>
        <tr><td><span>PRN 5</span></td><td><b>Good</b></td><td>Current</td><td>-160dBW</td></tr>
        <tr><td>11</td><td>Good</td><td>Current</td><td>-154 dBW</td></tr>
      </table>
    </body></html>
  `;
  const webTable = parseXliWebSatelliteTable(xliSatelliteHtml, { slot: 1 });
  assert.equal(webTable.satelliteTracking.length, 2);
  assert.equal(webTable.satelliteTracking[0].prn, '5');
  assert.equal(webTable.satelliteTracking[0].status, 'Good');
  assert.equal(webTable.satelliteTracking[0].utilization, 'Current');
  assert.equal(webTable.satelliteTracking[0].level, '-160 dBW');
  assert.equal(webTable.satelliteTrackingPage, '/XLIGPSSatList.html?slot=1');

  const xliSatelliteHtmlWithNestedTags = `
    <html><body>
      <table>
        <tr><th>Tracked <span>Satellite</span> List</th></tr>
        <tr><th><strong>PRN</strong></th><th>status</th><th>UTILIZATION</th><th>Level</th></tr>
        <tr><td><div>PRN <span>8</span></div></td><td><span>Good</span></td><td><em>Tracked</em></td><td><strong>-149.7 dBW</strong></td></tr>
      </table>
    </body></html>
  `;
  const nestedWebTable = parseXliWebSatelliteTable(xliSatelliteHtmlWithNestedTags, { slot: 2 });
  assert.equal(nestedWebTable.satelliteTracking.length, 1);
  assert.deepEqual(nestedWebTable.satelliteTracking[0], {
    prn: '8',
    status: 'Good',
    utilization: 'Tracked',
    level: '-150 dBW',
  });
  assert.equal(nestedWebTable.satelliteTrackingPage, '/XLIGPSSatList.html?slot=2');

  const xliSatelliteHtmlWithWhitespace = `
    <HTML><BODY>
      <TABLE>
        <TR><TH>   Tracked   Satellite   List   </TH></TR>
        <TR><TH> PRN </TH><TH> STATUS </TH><TH> UTILIZATION </TH><TH> LEVEL </TH></TR>
        <TR><TD>   PRN   21   </TD><TD>  Good  </TD><TD> Current </TD><TD>   -153    dBW   </TD></TR>
      </TABLE>
    </BODY></HTML>
  `;
  const whitespaceTable = parseXliWebSatelliteTable(xliSatelliteHtmlWithWhitespace, { slot: 3 });
  assert.equal(whitespaceTable.satelliteTracking.length, 1);
  assert.equal(whitespaceTable.satelliteTracking[0].prn, '21');
  assert.equal(whitespaceTable.satelliteTracking[0].level, '-153 dBW');

  const missingTable = parseXliWebSatelliteTable('<html><body><h1>Login</h1><form></form></body></html>', { slot: 4 });
  assert.deepEqual(missingTable, {
    satelliteTracking: [],
    satelliteTrackingSource: 'xli-web',
    satelliteTrackingPage: '/XLIGPSSatList.html?slot=4',
  });

  const malformedLevelHtml = `
    <html><body>
      <table>
        <tr><th>Tracked Satellite List</th></tr>
        <tr><th>PRN</th><th>Status</th><th>Utilization</th><th>Level</th></tr>
        <tr><td>6</td><td>Good</td><td>Tracked</td><td>N/A</td></tr>
      </table>
    </body></html>
  `;
  const malformedLevelTable = parseXliWebSatelliteTable(malformedLevelHtml, { slot: 5 });
  assert.equal(malformedLevelTable.satelliteTracking.length, 1);
  assert.equal(malformedLevelTable.satelliteTracking[0].level, null);

  const emptyHtmlTable = parseXliWebSatelliteTable('', { slot: 6 });
  assert.deepEqual(emptyHtmlTable, {
    satelliteTracking: [],
    satelliteTrackingSource: 'xli-web',
    satelliteTrackingPage: '/XLIGPSSatList.html?slot=6',
  });

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
  assert.throws(() => validateConfig({ ...validConfig, xliWebEnabled: true, xliWebBaseUrl: '' }), /XLI_WEB_BASE_URL/);
  assert.throws(() => validateConfig({ ...validConfig, xliWebEnabled: true, xliWebBaseUrl: 'javascript:alert(1)' }), /XLI_WEB_BASE_URL/);
  assert.throws(() => validateConfig({ ...validConfig, xliWebEnabled: true, xliWebBaseUrl: 'http://user:pass@192.168.1.10' }), /embedded credentials/);
  assert.throws(() => validateConfig({ ...validConfig, xliWebEnabled: true, xliWebBaseUrl: 'http://192.168.1.10?foo=1' }), /query strings/);
  assert.throws(() => validateConfig({ ...validConfig, xliGpsSlot: 0 }), /XLI_GPS_SLOT/);
  assert.throws(() => validateConfig({ ...validConfig, xliGpsSlot: 33 }), /XLI_GPS_SLOT/);
  const disabledWebConfig = validateConfig({ ...validConfig, xliWebEnabled: false, xliWebBaseUrl: '' });
  assert.equal(disabledWebConfig.xliWebEnabled, false);
  assert.equal(validateConfig({ ...validConfig, receiverEnabled: false, gpsUsername: '', gpsPassword: '', gpsHost: '' }).receiverEnabled, false);

  console.log('Protocol harness passed.');
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
