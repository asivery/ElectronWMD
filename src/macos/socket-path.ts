import path from 'path';

// Max UNIX domain socket path length on macOS is ~104 bytes. Keep paths short.
const DEFAULT_BASE_DIR = '/tmp';

export function getSocketDir(baseDir?: string): string {
  const envBase = baseDir
    || process.env.EWWORKDIR
    || process.env.TMPDIR
    || DEFAULT_BASE_DIR;
  // Normalize and strip trailing slashes
  const normalized = envBase.replace(/\/+$/, '') || DEFAULT_BASE_DIR;
  return normalized;
}

export function getUidSuffix(): string {
  // Prefer the real user id (original invoker). When running under sudo, SUDO_UID is present.
  const sudoUid = process.env.SUDO_UID;
  const realUid = typeof process.getuid === 'function' ? String(process.getuid()) : undefined;
  return (sudoUid || realUid || 'nouid');
}

export function getSocketPath(baseDir?: string): string {
  const dir = getSocketDir(baseDir);
  const uid = getUidSuffix();
  return path.join(dir, `ewmd-${uid}.sock`);
}

export function getPidPath(baseDir?: string): string {
  const dir = getSocketDir(baseDir);
  const uid = getUidSuffix();
  return path.join(dir, `ewmd-${uid}.pid`);
}
