'use client';

import { useEffect, useState } from 'react';

export default function ConfirmActionDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  confirmationText,
  requireReason = true,
  tone = 'danger',
  onClose,
  onConfirm
}) {
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setReason('');
    setConfirmation('');
    setSubmitting(false);
    setError('');
    const listener = (event) => { if (event.key === 'Escape' && !submitting) onClose?.(); };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
    // Opening the dialog is the reset boundary. Parent re-renders must not erase input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;
  const valid = (!requireReason || reason.trim().length >= 5)
    && (!confirmationText || confirmation === confirmationText);

  const submit = async (event) => {
    event.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await onConfirm({ reason: reason.trim(), confirmation });
      onClose?.();
    } catch (actionError) {
      setError(actionError.message || 'The action could not be completed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="confirm-action-title">
      <button type="button" aria-label="Close confirmation" className="absolute inset-0 bg-black/80" onClick={() => !submitting && onClose?.()} />
      <form onSubmit={submit} className="relative w-full max-w-md rounded-2xl border border-sa-700 bg-sa-900 p-6 shadow-2xl">
        <h2 id="confirm-action-title" className="text-lg font-black text-white">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-sa-400">{description}</p>
        {requireReason && <label className="mt-5 block text-xs font-bold text-sa-400">Reason (required)<textarea autoFocus required minLength={5} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 block min-h-24 w-full rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-sm text-white outline-none focus:border-orange-500" /></label>}
        {confirmationText && <label className="mt-4 block text-xs font-bold text-sa-400">Type <strong className="text-white">{confirmationText}</strong> to confirm<input required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" className="mt-1 block w-full rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-sm text-white outline-none focus:border-red-500" /></label>}
        {error && <div role="alert" className="mt-4 rounded-xl border border-red-800 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" disabled={submitting} onClick={onClose} className="rounded-xl border border-sa-700 px-4 py-2 text-sm font-bold text-sa-300 disabled:opacity-50">Cancel</button>
          <button disabled={!valid || submitting} className={`rounded-xl px-4 py-2 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40 ${tone === 'danger' ? 'bg-red-600 hover:bg-red-500' : 'bg-orange-500 hover:bg-orange-400'}`}>
            {submitting ? 'Working…' : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
