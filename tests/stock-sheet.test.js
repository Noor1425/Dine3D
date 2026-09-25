/**
 * The closing count sheet.
 *
 * The rule the whole screen rests on: a blank box means "I did not count this
 * line", never "there are none". `Number('')` is 0, so getting this wrong is a
 * single character away — and the damage is not cosmetic. A sheet that treats
 * blanks as zeros opens by accusing the kitchen of losing every item on it,
 * and submits a count that zeroes the shelves nobody reached.
 */
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const StockSheet = require('@/components/inventory/StockSheet');

const { parseEntry, filledEntries, summarise, buildPayload } = StockSheet;

const ingredients = [
  { id: 'flour', name: 'Flour', unit: 'KG', currentStock: 50, costPerUnit: 120 },
  { id: 'oil', name: 'Cooking oil', unit: 'L', currentStock: 20, costPerUnit: 500 },
  { id: 'rice', name: 'Rice', unit: 'KG', currentStock: 60, costPerUnit: 320 },
];

const render = (props = {}) =>
  renderToStaticMarkup(React.createElement(StockSheet.default, {
    mode: 'count', ingredients, currency: 'Rs.', onSubmit: () => {}, onClose: () => {}, ...props,
  }));

describe('a blank line is not a zero', () => {
  test('an empty box reads as "not counted"', () => {
    expect(parseEntry('')).toBeNull();
    expect(parseEntry('   ')).toBeNull();
    expect(parseEntry(null)).toBeNull();
    expect(parseEntry(undefined)).toBeNull();
  });

  test('a typed zero is a real answer — shelves do run empty', () => {
    expect(parseEntry('0')).toBe(0);
    expect(parseEntry(0)).toBe(0);
  });

  test('nonsense is refused rather than coerced', () => {
    expect(parseEntry('abc')).toBeNull();
  });

  test('only the lines someone typed into are submitted', () => {
    expect(filledEntries({ flour: '48', oil: '', rice: '   ' }).map(([id]) => id)).toEqual(['flour']);
  });

  test('a freshly opened sheet claims no shortfall at all', () => {
    // The visible symptom of the bug: every untouched row showing -50, -20, -60.
    const html = render();
    expect(html).not.toContain('-50');
    expect(html).not.toContain('-20');
    expect(html).toContain('Nothing entered yet');
    expect(summarise({ mode: 'count', entries: { flour: '', oil: '' }, ingredients }))
      .toMatchObject({ lines: 0, shortfall: 0, surplus: 0 });
  });

  test('an untouched sheet submits nothing, so nobody can zero the store by accident', () => {
    expect(buildPayload({ mode: 'count', entries: { flour: '', oil: '', rice: '' } }).counts).toEqual([]);
  });
});

describe('what the sheet says it will do', () => {
  test('a shortfall is valued at what the missing stock cost', () => {
    // 5 kg of flour short at 120 = 600; 2 L of oil over at 500 = 1000.
    expect(summarise({ mode: 'count', entries: { flour: '45', oil: '22' }, ingredients }))
      .toMatchObject({ lines: 2, shortfall: 600, surplus: 1000 });
  });

  test('a count that matches is a line with no variance', () => {
    expect(summarise({ mode: 'count', entries: { flour: '50' }, ingredients }))
      .toMatchObject({ lines: 1, shortfall: 0, surplus: 0 });
  });

  test('a delivery with no price typed is valued at the current cost', () => {
    // Not zero: a blank price means "same as before".
    expect(summarise({ mode: 'receive', entries: { flour: '10' }, costs: { flour: '' }, ingredients }))
      .toMatchObject({ deliveryValue: 1200 });
  });

  test('a delivery with a new price is valued at that price', () => {
    expect(summarise({ mode: 'receive', entries: { oil: '10' }, costs: { oil: '560' }, ingredients }))
      .toMatchObject({ deliveryValue: 5600 });
  });
});

describe('what reaches the server', () => {
  test('a count states what is there, and never a delta', () => {
    // The correction belongs to the server, worked out inside the row lock:
    // stock moves while the sheet is open.
    const payload = buildPayload({ mode: 'count', entries: { flour: '44' }, reference: '  Tuesday closing  ' });
    expect(payload).toEqual({ reference: 'Tuesday closing', counts: [{ ingredientId: 'flour', countedStock: 44 }] });
    expect(JSON.stringify(payload)).not.toContain('quantityChange');
  });

  test('a delivery states what arrived, and is added to what is there', () => {
    const payload = buildPayload({
      mode: 'receive',
      entries: { flour: '25', oil: '10' },
      costs: { oil: '560' },
      supplier: 'Metro',
      reference: 'INV-4471',
    });
    expect(payload).toEqual({
      reference: 'INV-4471',
      supplier: 'Metro',
      items: [
        { ingredientId: 'flour', quantity: 25 },       // no price typed: left alone
        { ingredientId: 'oil', quantity: 10, costPerUnit: 560 },
      ],
    });
    expect(payload.items[0]).not.toHaveProperty('costPerUnit');
  });

  test('an empty reference is null rather than an empty string', () => {
    expect(buildPayload({ mode: 'count', entries: { flour: '1' }, reference: '   ' }).reference).toBeNull();
  });

  test('a typed zero survives all the way into the payload', () => {
    expect(buildPayload({ mode: 'count', entries: { oil: '0' } }).counts)
      .toEqual([{ ingredientId: 'oil', countedStock: 0 }]);
  });
});

describe('the two routines are told apart on screen', () => {
  test('the closing sheet asks what was counted', () => {
    const html = render({ mode: 'count' });
    expect(html).toContain('Closing stock count');
    expect(html).toContain('Counted');
    expect(html).toContain('Difference');
    expect(html).not.toContain('Supplier');
  });

  test('the delivery sheet asks what arrived, from whom, at what price', () => {
    const html = render({ mode: 'receive' });
    expect(html).toContain('Record a delivery');
    expect(html).toContain('Arrived');
    expect(html).toContain('Supplier');
    expect(html).toContain('Unit cost');
  });

  test('every item on file gets a line, with the figure to check against', () => {
    const html = render();
    for (const item of ingredients) expect(html).toContain(item.name);
    expect(html).toContain('50');
  });
});
