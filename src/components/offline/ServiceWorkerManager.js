'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';

export default function ServiceWorkerManager() {
  const [waiting, setWaiting] = useState(null);

  useEffect(() => {
    if (!('serviceWorker' in navigator) || process.env.NODE_ENV !== 'production') return undefined;
    let registration;
    const showWaiting = (worker) => { if (worker) setWaiting(worker); };
    const warm = () => {
      if (localStorage.getItem('dine3d_admin_active') !== 'true') return;
      const dispatch = () => {
        const worker = registration?.active || navigator.serviceWorker.controller;
        worker?.postMessage({ type: 'WARM_OPERATIONAL_SHELL' });
      };
      if ('requestIdleCallback' in window) window.requestIdleCallback(dispatch, { timeout: 5000 });
      else window.setTimeout(dispatch, 1500);
    };
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).then((value) => {
      registration = value;
      showWaiting(registration.waiting);
      navigator.serviceWorker.ready.then(warm).catch(() => {});
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) showWaiting(worker);
        });
      });
    }).catch(() => {});
    const reload = () => window.location.reload();
    window.addEventListener('dine3d:authenticated-bootstrap', warm);
    navigator.serviceWorker.addEventListener('controllerchange', reload);
    return () => {
      window.removeEventListener('dine3d:authenticated-bootstrap', warm);
      navigator.serviceWorker.removeEventListener('controllerchange', reload);
    };
  }, []);

  const activate = async () => {
    if (!waiting) return;
    const diagnostics = await window.dine3dOffline?.getDiagnostics?.().catch(() => null);
    const outstanding = (diagnostics?.outbox || []).filter((entry) => entry.status !== 'acknowledged');
    if (outstanding.length > 0) {
      await window.dine3dOffline?.syncNow?.().catch(() => {});
      const after = await window.dine3dOffline?.getDiagnostics?.().catch(() => diagnostics);
      const remaining = (after?.outbox || []).filter((entry) => entry.status !== 'acknowledged');
      if (remaining.length > 0) {
        toast.error(`${remaining.length} saved operation${remaining.length === 1 ? '' : 's'} must synchronize or be exported before this update is activated.`);
        return;
      }
    }
    waiting.postMessage({ type: 'SKIP_WAITING_AFTER_OUTBOX_CHECK' });
  };

  if (!waiting) return null;
  return (
    <div role="status" className="fixed bottom-4 left-1/2 z-[200] flex w-[min(94vw,560px)] -translate-x-1/2 items-center justify-between gap-4 rounded-2xl border border-blue-200 bg-white p-4 shadow-2xl">
      <div>
        <p className="text-sm font-bold text-slate-900">Application update ready</p>
        <p className="text-xs text-slate-600">Saved operations are checked before activation.</p>
      </div>
      <button type="button" onClick={activate} className="shrink-0 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2">Update safely</button>
    </div>
  );
}
