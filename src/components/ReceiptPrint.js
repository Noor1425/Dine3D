'use client';

/**
 * PRINTABLE RECEIPT
 *
 * Renders the same print document the Edge agent sends to a thermal printer,
 * but as HTML — so a restaurant with no network printer can still produce a
 * correct receipt on whatever Windows already has: a USB thermal printer, an
 * office laser, or a PDF.
 *
 * It is always mounted and always hidden on screen. `@media print` in
 * globals.css hides the whole application and reveals only this element, so
 * window.print() produces a receipt rather than a screenshot of the POS.
 *
 * The layout is a fixed character-grid in a monospace face, which is what makes
 * it come out identical to the thermal version: same column positions, same
 * wrapping, same totals block.
 */

const CURRENCY_FALLBACK = 'Rs';

const amount = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '0.00';
  return parsed.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const hasAmount = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && Math.abs(parsed) > 0.0049;
};

const ORDER_TYPE_LABELS = {
  DINE_IN: 'DINE IN',
  TAKEAWAY: 'TAKEAWAY',
  DELIVERY: 'DELIVERY',
  COUNTER: 'COUNTER',
  ONLINE_QR: 'QR ORDER',
  PHONE: 'PHONE ORDER',
  PREORDER: 'PRE-ORDER',
};

/** Matches the Edge renderer: fixed and unambiguous, never locale-dependent. */
const timestamp = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (number) => String(number).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const Row = ({ label, value, strong = false }) => (
  <div className={`receipt-row${strong ? ' receipt-row-strong' : ''}`}>
    <span className="receipt-row-label">{label}</span>
    <span className="receipt-row-value">{value}</span>
  </div>
);

export default function ReceiptPrint({ document: printDocument, paper = '80mm' }) {
  if (!printDocument) return null;

  const restaurant = printDocument.restaurant || {};
  const order = printDocument.order || {};
  const totals = printDocument.totals || {};
  const payment = printDocument.payment || {};
  const currency = printDocument.currency || CURRENCY_FALLBACK;
  const items = Array.isArray(printDocument.items) ? printDocument.items : [];
  const isPreparation = printDocument.jobType === 'KITCHEN_TICKET' || printDocument.jobType === 'BAR_TICKET';

  return (
    <div id="receipt-print-root" className={`receipt-paper receipt-paper-${paper === '58mm' ? '58' : '80'}`}>
      {/* ── Header ───────────────────────────────────────────── */}
      <header className="receipt-header">
        {isPreparation ? (
          <>
            <div className="receipt-title-xl">
              {printDocument.jobType === 'BAR_TICKET' ? 'BAR' : 'KITCHEN'}
            </div>
            {order.type ? (
              <div className="receipt-title">{ORDER_TYPE_LABELS[order.type] || order.type}</div>
            ) : null}
          </>
        ) : (
          <>
            <div className="receipt-title-xl">{restaurant.name || 'RECEIPT'}</div>
            {restaurant.branch ? <div>{restaurant.branch}</div> : null}
            {restaurant.address ? <div>{restaurant.address}</div> : null}
            {restaurant.phone ? <div>Tel: {restaurant.phone}</div> : null}
            {restaurant.taxId ? <div>NTN: {restaurant.taxId}</div> : null}
          </>
        )}
      </header>

      <div className="receipt-rule" />

      {/* ── Order details ────────────────────────────────────── */}
      <section>
        {isPreparation && order.table ? (
          <div className="receipt-title-xl receipt-left">TABLE {order.table}</div>
        ) : null}
        {order.number ? <Row label="Order" value={order.number} /> : null}
        {!isPreparation && order.type ? (
          <Row label="Type" value={ORDER_TYPE_LABELS[order.type] || order.type} />
        ) : null}
        {!isPreparation && order.table ? <Row label="Table" value={order.table} /> : null}
        {order.cashier ? <Row label={isPreparation ? 'By' : 'Served by'} value={order.cashier} /> : null}
        {order.createdAt ? <Row label={isPreparation ? 'Time' : 'Date'} value={timestamp(order.createdAt)} /> : null}
        {order.customerName ? <Row label="Customer" value={order.customerName} /> : null}
        {!isPreparation && order.customerPhone ? <Row label="Phone" value={order.customerPhone} /> : null}
        {!isPreparation && order.customerAddress ? (
          <div className="receipt-wrap">Address: {order.customerAddress}</div>
        ) : null}
      </section>

      <div className="receipt-rule" />

      {/* ── Items ────────────────────────────────────────────── */}
      <section className="receipt-items">
        {items.map((item, index) => (
          <div key={`${item.name}-${index}`} className="receipt-item">
            <div className={`receipt-row${isPreparation ? ' receipt-row-large' : ''}`}>
              <span className="receipt-row-label">
                <span className="receipt-qty">{item.quantity}</span>
                {isPreparation ? ' ' : ' x '}
                {item.name}
                {item.variant ? ` (${item.variant})` : ''}
              </span>
              {isPreparation ? null : (
                <span className="receipt-row-value">{amount(item.total)}</span>
              )}
            </div>

            {(item.modifiers || []).map((modifier, modifierIndex) => (
              <div key={`${modifier.name}-${modifierIndex}`} className="receipt-row receipt-modifier">
                <span className="receipt-row-label">
                  {isPreparation ? '>> ' : '+ '}
                  {Number(modifier.quantity) > 1 ? `${modifier.quantity} x ` : ''}
                  {modifier.name}
                </span>
                {!isPreparation && hasAmount(modifier.price) ? (
                  <span className="receipt-row-value">{amount(modifier.price)}</span>
                ) : null}
              </div>
            ))}

            {item.notes ? (
              <div className={`receipt-note${isPreparation ? ' receipt-note-loud' : ''}`}>
                {isPreparation ? '!! ' : '* '}{item.notes}
              </div>
            ) : null}
          </div>
        ))}
      </section>

      {/* ── Totals and payment (never on a preparation ticket) ── */}
      {isPreparation ? null : (
        <>
          <div className="receipt-rule" />
          <section>
            {hasAmount(totals.subtotal) ? <Row label="Subtotal" value={amount(totals.subtotal)} /> : null}
            {hasAmount(totals.discount) ? (
              <Row label={totals.discountLabel || 'Discount'} value={`-${amount(totals.discount)}`} />
            ) : null}
            {hasAmount(totals.serviceCharge) ? (
              <Row label={totals.serviceChargeLabel || 'Service charge'} value={amount(totals.serviceCharge)} />
            ) : null}
            {hasAmount(totals.tax) ? <Row label={totals.taxLabel || 'Tax'} value={amount(totals.tax)} /> : null}
            {hasAmount(totals.deliveryFee) ? <Row label="Delivery" value={amount(totals.deliveryFee)} /> : null}
            {hasAmount(totals.tip) ? <Row label="Tip" value={amount(totals.tip)} /> : null}
          </section>

          <div className="receipt-rule receipt-rule-double" />
          <div className="receipt-row receipt-total">
            <span className="receipt-row-label">TOTAL</span>
            <span className="receipt-row-value">{currency} {amount(totals.grandTotal)}</span>
          </div>
          <div className="receipt-rule receipt-rule-double" />

          <section>
            {(payment.payments || []).map((entry, index) => (
              <Row
                key={`${entry.method}-${index}`}
                label={String(entry.method || 'Payment').replaceAll('_', ' ')}
                value={amount(entry.amount)}
              />
            ))}
            {!payment.payments?.length && payment.method ? (
              <Row label="Paid by" value={String(payment.method).replaceAll('_', ' ')} />
            ) : null}
            {hasAmount(payment.tendered) ? <Row label="Cash received" value={amount(payment.tendered)} /> : null}
            {hasAmount(payment.change) ? <Row label="Change" value={amount(payment.change)} /> : null}
            {payment.status && String(payment.status).toLowerCase() !== 'completed' ? (
              <div className="receipt-stamp">** {String(payment.status).toUpperCase().replaceAll('_', ' ')} **</div>
            ) : null}
          </section>
        </>
      )}

      {order.notes ? (
        <div className={`receipt-wrap${isPreparation ? ' receipt-note-loud' : ''}`}>
          {isPreparation ? 'ORDER NOTE: ' : 'Note: '}{order.notes}
        </div>
      ) : null}

      {/* ── FBR digital invoice ──────────────────────────────────
          What makes this slip a tax invoice rather than a note of what was
          eaten. The thermal printer draws its own QR from the payload; here in
          the browser we can only show the image if FBR sent one, so the number
          is always printed in full beside it — that is the datum a verifier
          looks up. */}
      {!isPreparation && printDocument.fbr?.invoiceNumber ? (
        <section className="receipt-fbr">
          <div className="receipt-fbr-label">FBR DIGITAL INVOICE</div>
          <div className="receipt-fbr-number">{printDocument.fbr.invoiceNumber}</div>
          {/^data:image\//i.test(printDocument.fbr.qrCode || '') ? (
            <img
              className="receipt-fbr-qr"
              src={printDocument.fbr.qrCode}
              alt={`FBR invoice ${printDocument.fbr.invoiceNumber}`}
            />
          ) : null}
          <div className="receipt-fbr-verify">Verify with FBR Tax Asaan</div>
        </section>
      ) : null}

      {/* ── Footer ───────────────────────────────────────────── */}
      {isPreparation ? null : (
        <footer className="receipt-footer">
          {printDocument.footer ? <div className="receipt-wrap">{printDocument.footer}</div> : null}
          {order.number ? <div className="receipt-reference">{order.number}</div> : null}
        </footer>
      )}

      {printDocument.reprint ? <div className="receipt-stamp">*** REPRINT ***</div> : null}
    </div>
  );
}
