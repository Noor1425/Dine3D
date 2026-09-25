const fs = require('fs');
const path = require('path');

/**
 * A restaurant can replace the password it was given.
 *
 * Accounts are created with a temporary password that an operator reads out to
 * the customer. The API has always been able to change it — `POST
 * /api/auth/password/change`, with re-authentication, a policy check and full
 * session revocation — and `api.changePassword` has always existed. There was
 * simply no screen that called either, so the temporary password stayed the
 * real one for the life of the account.
 */

const SETTINGS = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'app', 'admin', 'settings', 'page.js'), 'utf8',
);
const API = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'api.js'), 'utf8');

test('the settings page offers a security tab', () => {
  expect(SETTINGS).toMatch(/id: 'security'/);
});

test('it is not hidden behind a permission the account may not have', () => {
  // This changes the signed-in person's own password. Gating it on a billing or
  // profile permission would lock out exactly the staff account that most needs
  // to replace a password it was handed.
  const tabs = SETTINGS.slice(SETTINGS.indexOf('availableTabs = ['), SETTINGS.indexOf('].filter(Boolean)'));
  const line = tabs.split('\n').find((row) => row.includes("id: 'security'"));
  expect(line).toBeTruthy();
  expect(line).not.toMatch(/can[A-Z]\w*\s*&&/);
});

test('it asks for the current password', () => {
  // Otherwise a screen someone walked away from is enough to take the account.
  expect(SETTINGS).toMatch(/currentPassword/);
  expect(SETTINGS).toMatch(/autoComplete="current-password"/);
});

test('it confirms the new password rather than trusting one entry', () => {
  expect(SETTINGS).toMatch(/confirmPassword/);
  expect(SETTINGS).toMatch(/do not match/i);
});

test('it states the real minimum length, not a guessed one', () => {
  // The server refuses anything under 15. A form that says 8 produces a
  // rejection the person cannot act on.
  expect(SETTINGS).toMatch(/at least 15 characters/i);
  expect(SETTINGS).toMatch(/length < 15|\.length\) < 15/);
});

test('it warns that every device will be signed out', () => {
  // The endpoint revokes all refresh tokens. Someone changing a password on the
  // office laptop should know the till will ask again.
  expect(SETTINGS).toMatch(/signs you out on every device/i);
});

test('it calls the endpoint that exists', () => {
  expect(SETTINGS).toMatch(/api\.changePassword\(/);
  expect(API).toMatch(/changePassword\([\s\S]{0,80}\/auth\/password\/change/);
});
