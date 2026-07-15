import { spawn } from 'node:child_process';

const processes = [
  spawn(process.execPath, ['server/index.js'], {
    stdio: 'inherit',
    shell: false,
  }),
  spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', '--host', '127.0.0.1'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  }),
];

function stopAll(signal) {
  for (const child of processes) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
}

for (const child of processes) {
  child.on('exit', (code) => {
    if (code && code !== 0) {
      stopAll('SIGTERM');
      process.exit(code);
    }
  });
}

process.on('SIGINT', () => {
  stopAll('SIGINT');
  process.exit(0);
});

process.on('SIGTERM', () => {
  stopAll('SIGTERM');
  process.exit(0);
});
