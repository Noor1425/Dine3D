/**
 * The browser print path.
 *
 * This is the fallback that lets a restaurant print a correct receipt on
 * whatever printer the computer already has — a USB thermal printer, an office
 * laser, or a PDF — when there is no network thermal printer on the Edge queue.
 *
 * It must render the same document the Edge agent renders to ESC/POS, so these
 * assertions mirror edge-agent/tests/receiptPrinting.test.js.
 */
const fs = require('fs');
const path = require('path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const ReceiptPrint = require('@/components/ReceiptPrint').default;

const render = (document, props = {}) =>
  renderToStaticMarkup(React.createElement(ReceiptPrint, { document, ...props }));

const baseDocument = {
  jobType: 'CUSTOMER_RECEIPT',
  restaurant: {
    name: 'Dine3D Kitchen',
    branch: 'Gulberg III',
    address: '24-C Main Boulevard, Lahore',
    phone: '042-111-33-66-99',
    taxId: '3520212345678',
  },
  order: {
    number: 'ORD-20260919-MAIN-0042',
    type: 'DINE_IN',
    table: '12',
    cashier: 'Asjad',
    createdAt: '2026-09-19T09:32:00Z',
    customerName: 'Walk-in guest',
    notes: 'Serve drinks first',
  },
  items: [{
    quantity: 2,
    name: 'Chicken Karahi',
    variant: 'Half',
    total: 2900,
    modifiers: [{ name: 'Extra spicy' }, { name: 'Naan', quantity: 4, price: 240 }],
    notes: 'No green chillies - allergy',
  }],
  totals: {
    subtotal: 2900,
    discount: 500,
    discountLabel: 'Discount (EIDSALE)',
    serviceCharge: 145,
    serviceChargeLabel: 'Service charge (5%)',
    tax: 464,
    taxLabel: 'GST (16%)',
    tip: 100,
    grandTotal: 3109,
  },
  payment: {
    method: 'CASH',
    status: 'completed',
    tendered: 3500,
    change: 391,
    payments: [{ method: 'CASH', amount: 3500 }],
  },
  currency: 'Rs',
  footer: 'Thank you for dining with us!',
};

describe('Printable receipt', () => {
  test('nothing is rendered without a document, so printing cannot emit a stray page', () => {
    expect(render(null)).toBe('');
  });

  test('the receipt carries the header, order, items, totals and payment', () => {
    const markup = render(baseDocument);
    for (const expected of [
      'Dine3D Kitchen', 'Gulberg III', '24-C Main Boulevard, Lahore',
      'Tel: 042-111-33-66-99', 'NTN: 3520212345678',
      'ORD-20260919-MAIN-0042', 'DINE IN', 'Asjad',
      'Chicken Karahi', '(Half)', 'Extra spicy', '4 x Naan',
      'No green chillies - allergy',
      'Subtotal', 'Discount (EIDSALE)', 'GST (16%)', 'TOTAL',
      'Cash received', 'Change', 'Thank you for dining with us!',
    ]) {
      expect(markup).toContain(expected);
    }
  });

  test('money is formatted to two decimals with thousands separators', () => {
    const markup = render(baseDocument);
    expect(markup).toContain('2,900.00');
    expect(markup).toContain('Rs 3,109.00');
    expect(markup).toContain('-500.00');
  });

  test('the print root carries the id the print stylesheet reveals', () => {
    expect(render(baseDocument)).toContain('id="receipt-print-root"');
  });

  test('paper width is selectable for 58mm rolls', () => {
    expect(render(baseDocument, { paper: '58mm' })).toContain('receipt-paper-58');
    expect(render(baseDocument)).toContain('receipt-paper-80');
  });

  test('a kitchen ticket shows no prices, matching the thermal template', () => {
    const markup = render({ ...baseDocument, jobType: 'KITCHEN_TICKET' });
    expect(markup).toContain('KITCHEN');
    expect(markup).toContain('TABLE 12');
    expect(markup).toContain('Chicken Karahi');
    for (const money of ['2,900.00', '3,109.00', 'Subtotal', 'TOTAL', 'GST', 'Change']) {
      expect(markup).not.toContain(money);
    }
  });

  test('a bar ticket is routed and labelled separately', () => {
    const markup = render({ ...baseDocument, jobType: 'BAR_TICKET' });
    expect(markup).toContain('BAR');
    expect(markup).not.toContain('TOTAL');
  });

  test('zero-valued lines are omitted', () => {
    const markup = render({
      ...baseDocument,
      totals: { subtotal: 2900, discount: 0, serviceCharge: 0, tax: 0, tip: 0, grandTotal: 2900 },
    });
    expect(markup).not.toContain('Discount');
    expect(markup).not.toContain('Tip');
    expect(markup).toContain('Subtotal');
  });

  test('an unsettled order is stamped rather than looking paid', () => {
    const markup = render({ ...baseDocument, payment: { method: 'CARD', status: 'pending' } });
    expect(markup).toContain('** PENDING **');
  });

  test('a reprint is marked', () => {
    expect(render({ ...baseDocument, reprint: true })).toContain('*** REPRINT ***');
  });

  test('a receipt with no items still renders its header and total', () => {
    const markup = render({ ...baseDocument, items: [] });
    expect(markup).toContain('Dine3D Kitchen');
    expect(markup).toContain('TOTAL');
  });
});

describe('Print stylesheet', () => {
  const css = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'styles', 'receipt-print.css'),
    'utf8',
  );

  test('the application is hidden and only the receipt is revealed when printing', () => {
    // Without these two rules window.print() produces a screenshot of the
    // point-of-sale screen instead of a receipt.
    expect(css).toMatch(/@media print/);
    expect(css).toMatch(/body \*\s*\{\s*visibility:\s*hidden/);
    expect(css).toMatch(/#receipt-print-root,\s*\n?\s*#receipt-print-root \*\s*\{\s*visibility:\s*visible/);
  });

  test('the page box is the paper roll, with no margins for the browser to add', () => {
    expect(css).toMatch(/@page\s*\{[^}]*size:\s*80mm auto/);
    expect(css).toMatch(/@page\s*\{[^}]*margin:\s*0/);
  });

  test('the receipt is hidden on screen', () => {
    expect(css).toMatch(/#receipt-print-root\s*\{[^}]*visibility:\s*hidden/);
  });

  test('a monospace face keeps the columns aligned like a thermal grid', () => {
    expect(css).toMatch(/font-family:[^;]*monospace/);
  });

  test('totals and items are not allowed to split across pages', () => {
    expect(css).toMatch(/break-inside:\s*avoid/);
    expect(css).toMatch(/page-break-inside:\s*avoid/);
  });
});

describe('Printer route editor', () => {
  const PrinterRouteEditor = require('@/components/superadmin/PrinterRouteEditor');
  const { blankPrinter, normalizePrinterForSave, PRINTER_TYPES } = PrinterRouteEditor;
  const Editor = PrinterRouteEditor.default;

  const renderEditor = (printers) =>
    renderToStaticMarkup(React.createElement(Editor, { printers, onChange: () => {} }));

  test('all three transports a restaurant might own are offered', () => {
    expect(PRINTER_TYPES.map((entry) => entry.value))
      .toEqual(['TCP_ESC_POS', 'WINDOWS_RAW', 'LOCAL_RAW']);
  });

  test('a network printer asks for a host and port', () => {
    const markup = renderEditor([{ ...blankPrinter(), type: 'TCP_ESC_POS' }]);
    expect(markup).toContain('Network hostname');
    expect(markup).toContain('Port');
    expect(markup).not.toContain('Windows printer name');
    expect(markup).not.toContain('Device path');
  });

  test('a Windows printer asks only for the installed printer name', () => {
    const markup = renderEditor([{ ...blankPrinter(), type: 'WINDOWS_RAW' }]);
    expect(markup).toContain('Windows printer name');
    expect(markup).not.toContain('Network hostname');
  });

  test('a local printer accepts a device path or a CUPS queue', () => {
    const markup = renderEditor([{ ...blankPrinter(), type: 'LOCAL_RAW' }]);
    expect(markup).toContain('Device path');
    expect(markup).toContain('CUPS queue');
    expect(markup).not.toContain('Network hostname');
  });

  test('paper width, character set and finishing are configurable', () => {
    const markup = renderEditor([blankPrinter()]);
    expect(markup).toContain('58mm (32 characters)');
    expect(markup).toContain('80mm (42 characters)');
    expect(markup).toContain('CP437');
    expect(markup).toContain('Cut paper');
    expect(markup).toContain('Cash drawer attached');
  });

  test('the empty state explains that printing still works without a printer', () => {
    expect(renderEditor([])).toContain('fall back to the browser print dialog');
  });

  test('only the address fields of the chosen transport are sent to the API', () => {
    // The API rejects unknown keys, so a leftover host on a Windows printer
    // would fail the save with a confusing validation error.
    const network = normalizePrinterForSave({ ...blankPrinter(), type: 'TCP_ESC_POS', host: '192.168.1.80', queue: 'stale', device: '/dev/stale' });
    expect(network).toHaveProperty('host', '192.168.1.80');
    expect(network).not.toHaveProperty('queue');
    expect(network).not.toHaveProperty('device');

    const windows = normalizePrinterForSave({ ...blankPrinter(), type: 'WINDOWS_RAW', queue: 'EPSON TM-T88', host: 'stale' });
    expect(windows).toHaveProperty('queue', 'EPSON TM-T88');
    expect(windows).not.toHaveProperty('host');

    const device = normalizePrinterForSave({ ...blankPrinter(), type: 'LOCAL_RAW', device: '/dev/usb/lp0' });
    expect(device).toHaveProperty('device', '/dev/usb/lp0');
    expect(device).not.toHaveProperty('host');

    // A local printer with no device falls back to the CUPS queue.
    const cups = normalizePrinterForSave({ ...blankPrinter(), type: 'LOCAL_RAW', device: '', queue: 'thermal' });
    expect(cups).toHaveProperty('queue', 'thermal');
    expect(cups).not.toHaveProperty('device');
  });

  test('numeric fields are coerced, so a form string never reaches the API', () => {
    const saved = normalizePrinterForSave({ ...blankPrinter(), port: '9100', charactersPerLine: '48' });
    expect(saved.port).toBe(9100);
    expect(saved.charactersPerLine).toBe(48);
  });
});
