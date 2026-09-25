const fs = require('fs');
const path = require('path');

/**
 * Two ways the control plane went invisible, and the rules that stop it.
 *
 * Both failures are silent: nothing errors, nothing logs, the build passes and
 * the page renders. The text is simply not readable, which is only discovered
 * by someone looking at it.
 */

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBALS = read('src', 'styles', 'globals.css');
const TAILWIND = read('tailwind.config.js');

const luminance = (hex) => {
  const channel = (c) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : (((c / 255) + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** Pull a colour out of the `sa` / `brand` scales in the Tailwind config. */
const token = (scale, step) => {
  const block = TAILWIND.match(new RegExp(`${scale}:\\s*\\{([^}]*)\\}`))[1];
  return block.match(new RegExp(`${step}:\\s*'(#[0-9A-Fa-f]{6})'`))[1];
};

test('headings take their colour from what they sit in', () => {
  // A bare `h1, h2, …` rule with a colour beats the colour a dark shell passes
  // down by inheritance — an element rule always does. When that colour was the
  // light theme's near-black, all 78 headings in the console that carry no
  // text- class of their own rendered at 1.10:1 on the canvas: invisible.
  // `body` already sets the themed colour, so headings inheriting it is both
  // correct on a light page and the only thing that works on a dark one.
  const rule = GLOBALS.match(/h1,\s*h2,\s*h3,\s*h4,\s*h5,\s*h6\s*\{([^}]*)\}/);
  expect(rule).not.toBeNull();
  expect(rule[1]).not.toMatch(/(?<!-)\bcolor\s*:/);
});

test('every text step of the console palette is readable on every surface', () => {
  const surfaces = [950, 900, 800].map((s) => token('sa', s));
  const text = [200, 300, 400, 500, 600].map((s) => token('sa', s));

  for (const ink of text) {
    for (const ground of surfaces) {
      expect(contrast(ink, ground)).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test('a label on the brand fill is dark, because white on it fails', () => {
  const fill = token('brand', 500);
  // 2.84:1 — this is what the console's primary button used to do.
  expect(contrast('#FFFFFF', fill)).toBeLessThan(4.5);
  expect(contrast(token('sa', 950), fill)).toBeGreaterThanOrEqual(4.5);
});

test('keyboard focus is visible in the console', () => {
  // These are screens where activating the wrong control suspends a restaurant
  // or revokes a session; tabbing through them used to move an invisible cursor.
  expect(GLOBALS).toMatch(/\.sa-shell[^{]*:focus-visible\s*\{[^}]*outline:/);
});
