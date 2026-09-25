const fs = require('fs');
const path = require('path');

/**
 * Browser dialogs that the desktop till cannot show.
 *
 * Restaurants run Dine3D as an Electron desktop app, and Electron does not
 * implement window.prompt() — it throws "prompt() is not supported.". A prompt
 * in an admin screen therefore works perfectly in every browser a developer
 * tests in, and is a dead button on the one device the restaurant actually
 * uses. It failed silently: the throw happened before the handler's try/catch,
 * so it surfaced only as an unhandled rejection in a console nobody has open
 * during service.
 *
 * Cash In, Cash Out, Close Shift, hold a tab, void an order, cancel a
 * delivery and revoke a device were all dead this way. Use the InputDialog
 * hook instead, which renders in the page.
 */

const ADMIN = path.join(__dirname, '..', 'src', 'app', 'admin');

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return walk(full);
  return entry.isFile() && full.endsWith('.js') ? [full] : [];
});

// `installPrompt.prompt()` is the PWA install API, which is unrelated and fine.
const CALLS_PROMPT = /(?<![.\w])(?:window\.)?prompt\s*\(/;

test('no admin screen asks with window.prompt', () => {
  const offenders = walk(ADMIN)
    .flatMap((file) => fs.readFileSync(file, 'utf8').split('\n').map((line, index) => ({
      file: path.relative(ADMIN, file),
      line: index + 1,
      text: line.trim(),
    })))
    .filter(({ text }) => !text.startsWith('//') && !text.startsWith('*') && CALLS_PROMPT.test(text))
    .map(({ file, line, text }) => `${file}:${line}  ${text.slice(0, 80)}`);

  expect(offenders).toEqual([]);
});
