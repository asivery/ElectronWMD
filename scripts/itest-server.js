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
  const child = bootstrap.startOutsideElectron(
    path.resolve(__dirname, '..', 'node_modules', '.bin', 'electron'),
    path.resolve(__dirname, '..'),
    '/tmp/',
    workDir,
  );

  // Wait for socket to appear
  await waitForSocket(expectedSocket, 10000);

  // Try connecting to it
  const serverPid = parseInt(fs.readFileSync(expectedPid));
  await tryConnect(expectedSocket);

  await new Promise(res => setTimeout(res, 5000));
  try {
    process.kill(serverPid, 0);
    // The process is alive
    throw new Error('server did not exit in time');
  } catch(_ex) {
    assert(!fs.existsSync(expectedSocket));
    assert(!fs.existsSync(expectedPid));
    fs.rmdirSync(workDir);
  }

  console.log('integration test passed');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
