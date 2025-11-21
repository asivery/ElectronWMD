/* macOS-only integration test: spawn the server with EWWORKDIR under /tmp, wait for socket, connect, then exit */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const { spawn } = require('child_process');

const socketPathModule = require('../dist/macos/socket-path.js');

function mkTmpUnderTmp(prefix) {
  const base = '/tmp';
  const full = fs.mkdtempSync(path.join(base, prefix));
  return full;
}

async function waitForSocket(sockPath, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const st = fs.statSync(sockPath);
      if (typeof st.mode === 'number') {
        // On macOS, isSocket() exists
        if (typeof st.isSocket === 'function' && st.isSocket()) return;
        // Fallback: assume exists and try connecting instead
      }
    } catch (_) {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Socket did not appear in time: ' + sockPath);
}

async function tryConnect(sockPath, timeoutMs = 3000) {
  await new Promise((resolve, reject) => {
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

  // Ensure build artifacts exist
  const electronBin = path.resolve(__dirname, '..', 'node_modules', '.bin', 'electron');
  const serverJs = path.resolve(__dirname, '..', 'dist', 'macos', 'server.js');
  assert(fs.existsSync(electronBin), 'electron binary not found at ' + electronBin);
  assert(fs.existsSync(serverJs), 'server.js not found at ' + serverJs);

  const workDir = mkTmpUnderTmp('ewmd-itest-');
  const expectedSocket = socketPathModule.getSocketPath(workDir);

  // Clean any stale files
  try { fs.unlinkSync(expectedSocket); } catch (_) {}
  const expectedPid = socketPathModule.getPidPath(workDir);
  try { fs.unlinkSync(expectedPid); } catch (_) {}

  // Launch server under ELECTRON_RUN_AS_NODE
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', EWWORKDIR: workDir };
  const child = spawn(electronBin, [serverJs, workDir], {
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', d => { stdout += d.toString(); });
  child.stderr.on('data', d => { stderr += d.toString(); });

  // Wait for socket to appear
  await waitForSocket(expectedSocket, 10000);

  // Try connecting to it
  await tryConnect(expectedSocket);

  // Ask server to terminate cleanly now that we validated the socket
  child.kill('SIGTERM');
  await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('server did not exit in time')), 5000);
    child.on('exit', (_code, _signal) => {
      clearTimeout(to);
      resolve();
    });
  });

  console.log('integration test passed');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
