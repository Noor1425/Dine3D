'use client';

export default function OfflineFallbackPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
      <section className="w-full max-w-lg rounded-3xl border border-white/10 bg-white/5 p-8 text-center shadow-2xl">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/15 text-2xl" aria-hidden="true">◷</div>
        <h1 className="mt-5 text-2xl font-black">Connection unavailable</h1>
        <p className="mt-3 leading-7 text-slate-300">
          Previously opened staff POS, kitchen, and inventory screens can continue from their cached application shell. First-time QR menu access and online-only administration require internet access.
        </p>
        <button type="button" onClick={() => window.location.reload()} className="mt-6 rounded-xl bg-white px-5 py-3 text-sm font-black text-slate-950 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-slate-950">
          Reconnect, then reload
        </button>
      </section>
    </main>
  );
}
