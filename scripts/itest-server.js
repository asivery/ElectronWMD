/* macOS-only integration test: spawn the server with EWWORKDIR under /tmp, wait for socket, connect, then exit */
const fs = require('fs');
const path = require('path');
const net = require('net');

const socketPathModule = require('../dist/macos/socket-path.js');
const bootstrap = require('../dist/macos/server-bootstrap.js');
const assert = require('assert');

async function waitForSocket(sockPath, timeoutMs = 100000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const st = fs.statSync(sockPath);
      if (typeof st.mode === 'number') {
        if (typeof st.isSocket === 'function' && st.isSocket()) return;
      }
    } catch (_) {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Socket did not appear in time: ' + sockPath);
}

function tryConnect(sockPath, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const s = net.createConnection(sockPath, () => {
      // Connected; immediately destroy to trigger server close
      s.destroy();
    });
    const to = setTimeout(() => {
      s.destroy();
      reject(new Error('connect timeout'));
    }, timeoutMs);
    s.on('close', () => {
      clearTimeout(to);
      resolve();
    });
    s.on('error', (e) => {
      clearTimeout(to);
      reject(e);
    });
  });
}

async function run() {
  if (process.platform !== 'darwin') {
    console.log('Skipping: not macOS');
    return;
  }

  const workDir = fs.mkdtempSync(path.join('/tmp', 'ewmd-itest-'));
  const expectedSocket = socketPathModule.getSocketPath(workDir);
  const expectedPid = socketPathModule.getPidPath(workDir);

  // Clean any stale files
  try { fs.unlinkSync(expectedSocket); } catch (_) {}
  try { fs.unlinkSync(expectedPid); } catch (_) {}

  // Launch server
  const logPath = await bootstrap.startOutsideElectron(
    process.env.EWMD_TEST_ELECTRON || path.resolve(__dirname, '..', 'node_modules', '.bin', 'electron'),
    process.env.EWMD_TEST_APP_ROOT || path.resolve(__dirname, '..'),
    '/tmp/',
    workDir,
  );
  console.log('Helper log:', logPath);

  // Wait for socket to appear
  await waitForSocket(expectedSocket, 10000);
  assert.strictEqual(fs.statSync(expectedPid).uid, 0, 'helper must really run as root');
  assert.strictEqual(fs.statSync(expectedSocket).uid, process.getuid(), 'WMD must own its socket');
  assert.strictEqual(fs.statSync(logPath).uid, process.getuid(), 'WMD must be able to read its startup log');
  assert.strictEqual(fs.statSync(logPath).mode & 0o777, 0o600);
  assert(fs.readFileSync(logPath, 'utf8').includes('Server listening on socket:'), 'helper must reach readiness');

  // Try connecting to it
  await tryConnect(expectedSocket);

  // Private root-owned PID files must not be read or removed by the client.
  // The helper removes its socket and PID only after successful device cleanup.
  for (let i = 0; i < 100 && (fs.existsSync(expectedSocket) || fs.existsSync(expectedPid)); i++) {
    await new Promise(res => setTimeout(res, 100));
  }
  assert(!fs.existsSync(expectedSocket), 'server did not remove its socket');
  assert(!fs.existsSync(expectedPid), 'server did not remove its PID file');

  console.log('integration test passed; shutdown diagnostics retained in', workDir);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
