const fs = require('fs');
const path = require('path');

/**
 * A row of dish cards has to look like a row.
 *
 * The till shows four to six cards across. Anything that makes one card's
 * picture a different height from its neighbour's is visible immediately and
 * looks broken, and the thing that caused it was invisible in the code: the
 * picture was sized as a percentage of a card height that was itself decided by
 * an aspect ratio, a grid stretch and the length of the dish name at the same
 * time. A name long enough to wrap took its second line out of the photograph,
 * because shrinking is what a flex child does by default.
 *
 * Measured before the fix, in a row of four: pictures 62px tall where the name
 * wrapped and 79px where it did not.
 */

const POS = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'admin', 'pos', 'page.js'), 'utf8');

const card = (() => {
  const start = POS.indexOf('const MenuProductCard');
  return POS.slice(start, POS.indexOf('\n});', start));
})();

test('the picture is a fixed ratio that cannot be shrunk', () => {
  expect(card).toMatch(/aspect-\[5\/3\][^"]*shrink-0|shrink-0[^"]*aspect-\[5\/3\]/);
  // The percentage height is what made it depend on everything else. Matched
  // inside a className only — the comment above it in the source explains the
  // h-[56%] that caused this, and should keep doing so.
  expect(card).not.toMatch(/className="[^"]*h-\[\d+%\]/);
});

test('the card does not fight its own contents for height', () => {
  // An aspect ratio on the card plus a grid stretch plus content that needs
  // more room than either allows is three rules deciding one number.
  expect(card).not.toMatch(/aspect-\[1\.08\/1\]/);
  expect(card).toMatch(/h-full/);
});

test('the title reserves two lines, so prices line up across the row', () => {
  expect(card).toMatch(/line-clamp-2[^"]*min-h-\[34px\]|min-h-\[34px\][^"]*line-clamp-2/);
  // Reserved space only works if it matches the line height it is reserving.
  expect(card).toMatch(/leading-\[17px\]/);
});

describe('money on a till in Pakistan', () => {
  const formatMoneyValue = (() => {
    const source = POS.match(/function formatMoneyValue[\s\S]*?\n}/)[0];
    const parseAmount = (value) => Number(value) || 0;
    // eslint-disable-next-line no-eval
    return eval(`(${source.replace('function formatMoneyValue', 'function')})`);
  })();

  test('a whole number of rupees shows no paisa', () => {
    // "Rs. 1250.00" is three characters of noise on every card, and no
    // restaurant here prices in paisa.
    expect(formatMoneyValue(1250, 'Rs. ')).toBe('Rs. 1,250');
    expect(formatMoneyValue(950, 'Rs. ')).toBe('Rs. 950');
  });

  test('an amount that has paisa keeps them', () => {
    // Cash variance at the end of a shift is not a whole number.
    expect(formatMoneyValue(12.5, 'Rs. ')).toBe('Rs. 12.50');
    expect(formatMoneyValue(950.75, 'Rs. ')).toBe('Rs. 950.75');
  });

  test('thousands are separated, because a cashier reads these at a glance', () => {
    expect(formatMoneyValue(125000, 'Rs. ')).toBe('Rs. 125,000');
  });
});
