#!/usr/bin/env node
/**
 * Serve the production build.
 *
 * `next start` does not work with `output: 'standalone'` — Next says so on
 * every boot. What it does instead is worse than failing: it serves pages but
 * not the hashed assets that go with them, so a browser quietly keeps using
 * whatever it cached from an earlier build. You change code, rebuild, restart,
 * reload, and watch the old behaviour. There is nothing on screen to tell you
 * the new code never loaded.
 *
 * A standalone build is a complete server except for two directories Next
 * deliberately leaves out, because in a container they are usually mounted or
 * copied in (see frontend/Dockerfile, which does exactly that). This copies
 * them next to the standalone server and runs it — the same thing production
 * does, on a laptop, on Windows as well as macOS.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const distDir = '.next-prod';
const standalone = path.join(root, distDir, 'standalone');
const server = path.join(standalone, 'server.js');

if (!fs.existsSync(server)) {
  console.error(`No production build found at ${path.relative(root, server)}.\n\nRun "npm run build" first.`);
  process.exit(1);
}

/** Assets the standalone output expects to find beside it but does not contain. */
const required = [
  { from: path.join(root, distDir, 'static'), to: path.join(standalone, distDir, 'static'), label: 'static assets' },
  { from: path.join(root, 'public'), to: path.join(standalone, 'public'), label: 'public files' },
];

for (const { from, to, label } of required) {
  if (!fs.existsSync(from)) {
    console.error(`Missing ${label} at ${path.relative(root, from)}. Run "npm run build".`);
    process.exit(1);
  }
  // Replaced rather than merged: a stale file left from a previous build is
  // exactly the failure this script exists to prevent.
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
}

const port = process.env.PORT || process.argv[2] || '3000';
console.log(`Dine3D production build on http://localhost:${port}`);

const child = spawn(process.execPath, [server], {
  cwd: standalone,
  stdio: 'inherit',
  env: { ...process.env, PORT: String(port), HOSTNAME: process.env.HOSTNAME || '0.0.0.0' },
});

const forward = (signal) => child.kill(signal);
process.on('SIGINT', () => forward('SIGINT'));
process.on('SIGTERM', () => forward('SIGTERM'));
child.on('exit', (code) => process.exit(code ?? 0));
