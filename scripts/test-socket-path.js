/* Minimal sanity tests for socket-path helper. Run after `npm run build`. */
const assert = require('assert');
const path = require('path');

const socketPathModule = require('../dist/macos/socket-path.js');

function testDefaultTmp() {
  delete process.env.EWWORKDIR;
  const p = socketPathModule.getSocketPath('/tmp');
  assert(p.startsWith('/tmp/'), 'Socket path should start with /tmp');
  assert(/ewmd-.*\.sock$/.test(p), 'Socket path should end with ewmd-<uid>.sock');
  assert(p.length < 104, 'Socket path should be shorter than typical UNIX socket limits');
}

function testOverrideEnv() {
  process.env.EWWORKDIR = '/var/tmp';
  const p = socketPathModule.getSocketPath();
  assert(p.startsWith('/var/tmp/'), 'Socket path should respect EWWORKDIR');
}

function run() {
  testDefaultTmp();
  testOverrideEnv();
  console.log('socket-path tests passed');
}

run();
