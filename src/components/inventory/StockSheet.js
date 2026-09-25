'use client';

import { useMemo, useState } from 'react';

/**
 * THE DAILY STOCK SHEET
 *
 * Two routines, one screen:
 *
 *   Closing  — walk the store, type what is actually on each shelf, submit once.
 *   Opening  — a delivery arrives, type what came in, submit once.
 *
 * Adjusting stock one item at a time through a modal is fine for a correction
 * and unusable for a closing count: forty ingredients means forty modals while
 * someone waits to lock up. This is a single list with one number box per line.
 *
 * The distinction between the two modes is not cosmetic. A count says "there
 * are N" and the server works out the correction under a row lock; a delivery
 * says "N more arrived" and is added. Recording a delivery as a count would
 * silently erase everything sold since the sheet was opened.
 */

export const MODES = {
  count: {
    key: 'count',
    title: 'Closing stock count',
    blurb: 'Type what is actually on the shelf. Leave a line blank to skip it.',
    inputLabel: 'Counted',
    action: 'Save stock count',
    referencePlaceholder: 'e.g. Tuesday closing',
  },
  receive: {
    key: 'receive',
    title: 'Record a delivery',
    blurb: 'Type how much arrived. Leave a line blank to skip it.',
    inputLabel: 'Arrived',
    action: 'Save delivery',
    referencePlaceholder: 'e.g. invoice INV-4471',
  },
};

/**
 * A blank box is not a zero.
 *
 * `Number('')` is 0, so without the emptiness check an untouched line reads as
 * "I counted none of these": the sheet opens accusing the kitchen of losing
 * every item on it, and a delivery line with no price typed prices itself at
 * zero instead of falling back to the item's own cost.
 */
export const parseEntry = (value) => {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Only the lines someone actually typed into. A half-finished sheet must never
 * touch the items nobody reached — leaving a line blank means "I did not count
 * this", not "there are none".
 */
export const filledEntries = (entries) =>
  Object.entries(entries || {}).filter(([, value]) => parseEntry(value) !== null);

/** What this sheet will do, shown before anything is saved. */
export function summarise({ mode, entries, costs = {}, ingredients = [] }) {
  const filled = filledEntries(entries);
  let shortfall = 0;
  let surplus = 0;
  let deliveryValue = 0;

  for (const [id, value] of filled) {
    const item = ingredients.find((candidate) => candidate.id === id);
    if (!item) continue;
    const entered = parseEntry(value);
    const unitCost = Number(item.costPerUnit || 0);

    if (mode === 'count') {
      const variance = entered - Number(item.currentStock || 0);
      if (variance < 0) shortfall += Math.abs(variance) * unitCost;
      if (variance > 0) surplus += variance * unitCost;
    } else {
      deliveryValue += entered * (parseEntry(costs[id]) ?? unitCost);
    }
  }

  return { lines: filled.length, shortfall, surplus, deliveryValue };
}

/** The request body for whichever routine this is. */
export function buildPayload({ mode, entries, costs = {}, reference = '', supplier = '' }) {
  const filled = filledEntries(entries);
  const trimmedReference = String(reference || '').trim() || null;

  if (mode === 'count') {
    return {
      reference: trimmedReference,
      counts: filled.map(([ingredientId, value]) => ({ ingredientId, countedStock: parseEntry(value) })),
    };
  }

  return {
    reference: trimmedReference,
    supplier: String(supplier || '').trim() || null,
    items: filled.map(([ingredientId, value]) => {
      const cost = parseEntry(costs[ingredientId]);
      return {
        ingredientId,
        quantity: parseEntry(value),
        // A blank price means "same as before", so the field is left off
        // entirely rather than sent as a zero the server would store.
        ...(cost === null ? {} : { costPerUnit: cost }),
      };
    }),
  };
}

const money = (value, currency = 'PKR') =>
  `${currency} ${Math.abs(Number(value || 0)).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export default function StockSheet({ mode = 'count', ingredients = [], currency = 'PKR', onSubmit, onClose }) {
  const config = MODES[mode] || MODES.count;
  const [entries, setEntries] = useState({});
  const [costs, setCosts] = useState({});
  const [reference, setReference] = useState('');
  const [supplier, setSupplier] = useState('');
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term
      ? ingredients.filter((item) => String(item.name || '').toLowerCase().includes(term))
      : ingredients;
  }, [ingredients, search]);

  const preview = useMemo(
    () => summarise({ mode: config.key, entries, costs, ingredients }),
    [config.key, entries, costs, ingredients],
  );

  const submit = async () => {
    setError('');
    if (!preview.lines) {
      setError('Type at least one quantity before saving.');
      return;
    }

    setSaving(true);
    try {
      const payload = buildPayload({ mode: config.key, entries, costs, reference, supplier });
      setResult(await onSubmit(config.key, payload));
      setEntries({});
      setCosts({});
    } catch (submitError) {
      setError(submitError.message || 'The sheet could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  // ── Saved ────────────────────────────────────────────────────────────────
  if (result) {
    const failed = (result.lines || []).filter((line) => !line.ok);
    return (
      <div className="stock-sheet-backdrop">
        <div className="stock-sheet stock-sheet-result">
          <h2>{config.key === 'count' ? 'Stock count saved' : 'Delivery saved'}</h2>

          {config.key === 'count' ? (
            <div className="stock-sheet-summary">
              <div><span>{result.linesAdjusted}</span> corrected</div>
              <div><span>{result.linesUnchanged}</span> already matched</div>
              <div className="bad"><span>{money(result.shortfallValue, currency)}</span> short</div>
              <div className="good"><span>{money(result.surplusValue, currency)}</span> over</div>
            </div>
          ) : (
            <div className="stock-sheet-summary">
              <div><span>{result.linesReceived}</span> items received</div>
              <div><span>{money(result.totalValue, currency)}</span> delivery value</div>
            </div>
          )}

          {result.shortfallValue > 0 && config.key === 'count' ? (
            <p className="stock-sheet-note">
              {money(result.shortfallValue, currency)} less stock than expected. Worth checking wastage,
              portion sizes, or unrecorded usage.
            </p>
          ) : null}

          {failed.length ? (
            <div className="stock-sheet-failed">
              <strong>{failed.length} line(s) were not saved</strong>
              <ul>
                {failed.map((line) => (
                  <li key={line.ingredientId}>{line.name || line.ingredientId}: {line.error}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="stock-sheet-actions">
            <button type="button" className="ghost" onClick={() => setResult(null)}>Record another</button>
            <button type="button" className="primary" onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Sheet ────────────────────────────────────────────────────────────────
  return (
    <div className="stock-sheet-backdrop">
      <div className="stock-sheet">
        <header className="stock-sheet-head">
          <div>
            <h2>{config.title}</h2>
            <p>{config.blurb}</p>
          </div>
          <button type="button" className="stock-sheet-close" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="stock-sheet-controls">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search items"
            aria-label="Search items"
          />
          <input
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            placeholder={config.referencePlaceholder}
            aria-label="Reference"
          />
          {config.key === 'receive' ? (
            <input
              value={supplier}
              onChange={(event) => setSupplier(event.target.value)}
              placeholder="Supplier (optional)"
              aria-label="Supplier"
            />
          ) : null}
        </div>

        <div className="stock-sheet-rows">
          <div className="stock-sheet-row stock-sheet-header-row">
            <span>Item</span>
            <span className="num">In system</span>
            <span className="num">{config.inputLabel}</span>
            <span className="num">{config.key === 'count' ? 'Difference' : 'Unit cost'}</span>
          </div>

          {visible.map((item) => {
            const entered = entries[item.id] ?? '';
            const parsed = parseEntry(entered);
            const systemStock = Number(item.currentStock || 0);
            const variance = parsed === null ? null : parsed - systemStock;

            return (
              <div key={item.id} className="stock-sheet-row">
                <span className="stock-sheet-name">
                  {item.name}
                  <small>{item.unit}</small>
                </span>
                <span className="num muted">{systemStock.toLocaleString()}</span>
                <span className="num">
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    inputMode="decimal"
                    value={entered}
                    onChange={(event) => setEntries((current) => ({ ...current, [item.id]: event.target.value }))}
                    aria-label={`${config.inputLabel} ${item.name}`}
                  />
                </span>
                <span className="num">
                  {config.key === 'count' ? (
                    variance === null ? (
                      <span className="muted">—</span>
                    ) : (
                      <span className={variance < 0 ? 'bad' : variance > 0 ? 'good' : 'muted'}>
                        {variance > 0 ? '+' : ''}{Number(variance.toFixed(3))}
                      </span>
                    )
                  ) : (
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      placeholder={String(Number(item.costPerUnit || 0))}
                      value={costs[item.id] ?? ''}
                      onChange={(event) => setCosts((current) => ({ ...current, [item.id]: event.target.value }))}
                      aria-label={`Unit cost ${item.name}`}
                    />
                  )}
                </span>
              </div>
            );
          })}

          {!visible.length ? <p className="stock-sheet-empty">No items match that search.</p> : null}
        </div>

        {error ? <div className="stock-sheet-error">{error}</div> : null}

        <footer className="stock-sheet-foot">
          <div className="stock-sheet-preview">
            {preview.lines === 0 ? (
              <span className="muted">Nothing entered yet</span>
            ) : config.key === 'count' ? (
              <>
                <strong>{preview.lines}</strong> line(s)
                {preview.shortfall > 0 ? <span className="bad"> · {money(preview.shortfall, currency)} short</span> : null}
                {preview.surplus > 0 ? <span className="good"> · {money(preview.surplus, currency)} over</span> : null}
              </>
            ) : (
              <>
                <strong>{preview.lines}</strong> line(s) · {money(preview.deliveryValue, currency)}
              </>
            )}
          </div>
          <div className="stock-sheet-actions">
            <button type="button" className="ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="button" className="primary" onClick={submit} disabled={saving || !preview.lines}>
              {saving ? 'Saving…' : config.action}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
