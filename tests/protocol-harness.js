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

  console.log('Protocol harness passed.');
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
