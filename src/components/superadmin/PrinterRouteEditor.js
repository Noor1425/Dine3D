'use client';

import { Plus, Trash2 } from 'lucide-react';

/**
 * PRINTER ROUTES
 *
 * Restaurants own whatever printer they already had, so a branch can mix three
 * kinds of hardware on one appliance:
 *
 *  - Network      a LAN thermal printer on port 9100 (Epson TM-T88, Xprinter)
 *  - Windows      any printer installed in Windows, driven through the
 *                 spooler's RAW mode — USB thermal, a shared printer, a laser
 *  - Local device a USB/serial device node on Linux, or a CUPS queue
 *
 * Each transport needs a different address, so the form shows only the fields
 * that transport actually uses. The paper and finishing options below them
 * apply to all three.
 */

export const PRINTER_TYPES = [
  {
    value: 'TCP_ESC_POS',
    label: 'Network printer',
    hint: 'Thermal printer with its own IP address on the restaurant network.',
  },
  {
    value: 'WINDOWS_RAW',
    label: 'Windows printer',
    hint: 'Any printer installed in Windows on the appliance, including USB.',
  },
  {
    value: 'LOCAL_RAW',
    label: 'Local device / CUPS',
    hint: 'A USB device node such as /dev/usb/lp0, or a CUPS queue name.',
  },
];

export const JOB_TYPE_OPTIONS = [
  ['CUSTOMER_RECEIPT', 'Customer receipts'],
  ['KITCHEN_TICKET', 'Kitchen tickets'],
  ['BAR_TICKET', 'Bar tickets'],
  ['SHIFT_REPORT', 'Shift reports'],
  ['REFUND_RECEIPT', 'Refund receipts'],
];

export const blankPrinter = () => ({
  id: crypto.randomUUID(),
  name: '',
  type: 'TCP_ESC_POS',
  host: '',
  port: 9100,
  queue: '',
  device: '',
  enabled: true,
  autoPrint: false,
  jobTypes: ['CUSTOMER_RECEIPT'],
  charactersPerLine: 42,
  codePage: 'CP437',
  cutPaper: true,
  partialCut: true,
  openDrawer: false,
  drawerPin: 0,
});

/**
 * Strip the address fields that do not belong to the chosen transport.
 * The API rejects unknown keys, and a leftover host on a Windows printer would
 * otherwise fail the save with a confusing validation error.
 */
export const normalizePrinterForSave = (printer) => {
  const base = {
    id: printer.id,
    name: printer.name,
    type: printer.type,
    enabled: printer.enabled,
    autoPrint: printer.autoPrint,
    jobTypes: printer.jobTypes,
    charactersPerLine: Number(printer.charactersPerLine) || 42,
    codePage: printer.codePage || 'CP437',
    cutPaper: printer.cutPaper !== false,
    partialCut: printer.partialCut !== false,
    openDrawer: Boolean(printer.openDrawer),
    drawerPin: printer.drawerPin === 1 ? 1 : 0,
  };
  if (printer.type === 'TCP_ESC_POS') {
    return { ...base, host: String(printer.host || '').trim(), port: Number(printer.port) || 9100 };
  }
  if (printer.type === 'WINDOWS_RAW') {
    return { ...base, queue: String(printer.queue || '').trim() };
  }
  const device = String(printer.device || '').trim();
  return device
    ? { ...base, device }
    : { ...base, queue: String(printer.queue || '').trim() };
};

const labelClass = 'text-[10px] font-black uppercase tracking-wide text-sa-500';
const inputClass = 'mt-1 block w-full rounded-lg border border-sa-700 bg-sa-900 px-3 py-2 text-sm normal-case tracking-normal text-white';

export default function PrinterRouteEditor({ printers, onChange, disabled = false }) {
  const update = (index, patch) => {
    onChange(printers.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black">Printer routes</h2>
          <p className="mt-1 text-sm text-sa-500">
            Network, Windows and USB printers are all supported. The appliance accepts only private
            restaurant-network targets and verifies physical reachability independently.
          </p>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange([...printers, blankPrinter()])}
          className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
        >
          <Plus size={14} /> Add printer
        </button>
      </div>

      {printers.map((printer, index) => {
        const type = PRINTER_TYPES.find((entry) => entry.value === printer.type) || PRINTER_TYPES[0];
        return (
          <div key={printer.id} className="rounded-xl border border-sa-800 bg-sa-950 p-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className={labelClass}>
                Friendly name
                <input
                  required
                  minLength={2}
                  maxLength={80}
                  value={printer.name}
                  onChange={(event) => update(index, { name: event.target.value })}
                  className={inputClass}
                  placeholder="Kitchen Main"
                />
              </label>

              <label className={labelClass}>
                Connection
                <select
                  value={printer.type}
                  onChange={(event) => update(index, { type: event.target.value })}
                  className={inputClass}
                >
                  {PRINTER_TYPES.map((entry) => (
                    <option key={entry.value} value={entry.value}>{entry.label}</option>
                  ))}
                </select>
              </label>

              {/* Only the address fields this transport actually uses. */}
              {printer.type === 'TCP_ESC_POS' ? (
                <>
                  <label className={labelClass}>
                    Network hostname
                    <input
                      required
                      maxLength={253}
                      pattern="[A-Za-z0-9.:-]+"
                      value={printer.host || ''}
                      onChange={(event) => update(index, { host: event.target.value })}
                      className={inputClass}
                      placeholder="kitchen-printer.local"
                    />
                  </label>
                  <label className={labelClass}>
                    Port
                    <input
                      required
                      type="number"
                      min="1"
                      max="65535"
                      value={printer.port}
                      onChange={(event) => update(index, { port: event.target.value })}
                      className={inputClass}
                    />
                  </label>
                </>
              ) : null}

              {printer.type === 'WINDOWS_RAW' ? (
                <label className={`${labelClass} lg:col-span-2`}>
                  Windows printer name
                  <input
                    required
                    maxLength={120}
                    value={printer.queue || ''}
                    onChange={(event) => update(index, { queue: event.target.value })}
                    className={inputClass}
                    placeholder="EPSON TM-T88VI Receipt"
                  />
                </label>
              ) : null}

              {printer.type === 'LOCAL_RAW' ? (
                <>
                  <label className={labelClass}>
                    Device path
                    <input
                      maxLength={200}
                      pattern="/[A-Za-z0-9._/-]+"
                      value={printer.device || ''}
                      onChange={(event) => update(index, { device: event.target.value })}
                      className={inputClass}
                      placeholder="/dev/usb/lp0"
                    />
                  </label>
                  <label className={labelClass}>
                    or CUPS queue
                    <input
                      maxLength={120}
                      value={printer.queue || ''}
                      onChange={(event) => update(index, { queue: event.target.value })}
                      className={inputClass}
                      placeholder="thermal"
                    />
                  </label>
                </>
              ) : null}

              <label className={labelClass}>
                Route
                <select
                  value={printer.jobTypes[0]}
                  onChange={(event) => update(index, {
                    jobTypes: [event.target.value],
                    // Kitchen and bar tickets are useless unless they print the
                    // moment the order lands.
                    autoPrint: event.target.value !== 'CUSTOMER_RECEIPT',
                  })}
                  className={inputClass}
                >
                  {JOB_TYPE_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>

              <label className={labelClass}>
                Paper width
                <select
                  value={printer.charactersPerLine}
                  onChange={(event) => update(index, { charactersPerLine: Number(event.target.value) })}
                  className={inputClass}
                >
                  <option value={32}>58mm (32 characters)</option>
                  <option value={42}>80mm (42 characters)</option>
                  <option value={48}>80mm small font (48 characters)</option>
                </select>
              </label>

              <label className={labelClass}>
                Character set
                <select
                  value={printer.codePage || 'CP437'}
                  onChange={(event) => update(index, { codePage: event.target.value })}
                  className={inputClass}
                >
                  <option value="CP437">CP437 (default)</option>
                  <option value="CP850">CP850 (western European)</option>
                  <option value="CP1252">CP1252 (Windows Latin-1)</option>
                </select>
              </label>
            </div>

            <p className="mt-2 text-xs text-sa-500">{type.hint}</p>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-4 text-xs text-sa-400">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={printer.enabled}
                    onChange={(event) => update(index, { enabled: event.target.checked })}
                  /> Enabled
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={printer.autoPrint}
                    onChange={(event) => update(index, { autoPrint: event.target.checked })}
                  /> Automatic
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={printer.cutPaper !== false}
                    onChange={(event) => update(index, { cutPaper: event.target.checked })}
                  /> Cut paper
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={Boolean(printer.openDrawer)}
                    onChange={(event) => update(index, { openDrawer: event.target.checked })}
                  /> Cash drawer attached
                </label>
              </div>
              <button
                type="button"
                onClick={() => onChange(printers.filter((_, itemIndex) => itemIndex !== index))}
                className="inline-flex items-center gap-1 text-xs font-black text-red-400"
              >
                <Trash2 size={13} /> Remove
              </button>
            </div>
          </div>
        );
      })}

      {!printers.length ? (
        <div className="rounded-xl border border-dashed border-sa-700 p-8 text-center text-sm text-sa-500">
          No printer routes configured. Receipts fall back to the browser print dialog on the POS terminal.
        </div>
      ) : null}
    </div>
  );
}
