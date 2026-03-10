const { execSync, spawn } = require('child_process');
const path = require('path');

function findPidsByPortWindows(port) {
  try {
    const output = execSync(`netstat -ano -p tcp`, { encoding: 'utf8' });
    const lines = output.split(/\r?\n/);
    const pids = new Set();

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (!line.includes('LISTENING')) continue;
      if (!line.includes(`:${port}`)) continue;

      const parts = line.split(/\s+/);
      if (parts.length < 5) continue;
      const localAddr = parts[1] || '';
      const state = parts[3] || '';
      const pid = parts[4] || '';

      if (!localAddr.endsWith(`:${port}`)) continue;
      if (state !== 'LISTENING') continue;
      if (/^\d+$/.test(pid)) pids.add(pid);
    }

    return [...pids];
  } catch (_e) {
    return [];
  }
}

function findPidsByPortUnix(port) {
  try {
    const output = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { encoding: 'utf8' });
    return output
      .split(/\r?\n/)
      .map(v => v.trim())
      .filter(v => /^\d+$/.test(v));
  } catch (_e) {
    return [];
  }
}

function killPidWindows(pid) {
  try {
    execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
  } catch (_e) {
    // ignore
  }
}

function killPidUnix(pid) {
  try {
    process.kill(Number(pid), 'SIGTERM');
  } catch (_e) {
    // ignore
  }
}

function killPortIfUsed(port) {
  const isWin = process.platform === 'win32';
  const pids = isWin ? findPidsByPortWindows(port) : findPidsByPortUnix(port);
  if (!pids.length) return;

  console.log(`[dev-runner] Killing process on port ${port}: ${pids.join(', ')}`);
  pids.forEach(pid => {
    if (isWin) killPidWindows(pid);
    else killPidUnix(pid);
  });
}

function runNodemon() {
  const nodemonEntrypoint = path.join(
    process.cwd(),
    'node_modules',
    'nodemon',
    'bin',
    'nodemon.js'
  );

  const child = spawn(process.execPath, [nodemonEntrypoint, 'server/server.js'], {
    stdio: 'inherit',
    env: process.env
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code || 0);
  });
}

function main() {
  const port = String(process.env.PORT || 3000);
  killPortIfUsed(port);
  runNodemon();
}

main();
