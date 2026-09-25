'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import saApi from '@/lib/saApi';

export default function AccountSecurityPage() {
  const [setup, setSetup] = useState(null); const [code, setCode] = useState(''); const [loading, setLoading] = useState(false); const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Account security status could not be loaded')))
      .then((data) => setEnabled(data.user?.twoFactorEnabled === true))
      .catch((error) => toast.error(error.message));
  }, []);
  const begin = async () => { setLoading(true); try { setSetup(await saApi.mfaSetup()); } catch (error) { toast.error(error.message); } finally { setLoading(false); } };
  const verify = async (event) => { event.preventDefault(); setLoading(true); try { await saApi.mfaEnable(code); setEnabled(true); setSetup(null); toast.success('Multi-factor authentication enabled'); } catch (error) { toast.error(error.message); } finally { setLoading(false); } };
  return <div className="mx-auto max-w-3xl space-y-6"><div><h1 className="text-2xl font-black">My security</h1><p className="mt-1 text-sm text-sa-500">Protect this Super Admin identity with a time-based authenticator code.</p></div><section className="rounded-2xl border border-sa-800 bg-sa-900 p-6"><h2 className="font-black">Authenticator app</h2>{enabled ? <div className="mt-4 rounded-xl border border-emerald-800 bg-emerald-500/10 p-4 text-emerald-300">MFA is enabled. Future password logins require an authenticator code.</div> : !setup ? <><p className="mt-2 text-sm text-sa-400">Setup generates a new secret. Complete verification before leaving this page.</p><button onClick={begin} disabled={loading} className="mt-5 rounded-xl bg-brand-500 px-4 py-2 text-sm font-black disabled:opacity-50 text-sa-950">{loading ? 'Preparing…' : 'Set up MFA'}</button></> : <form onSubmit={verify} className="mt-5 grid gap-5 md:grid-cols-[220px_1fr]"><img src={setup.qrCodeUrl} alt="Authenticator setup QR code" className="h-[220px] w-[220px] rounded-xl bg-white p-2" /><div><p className="text-sm text-sa-400">Scan the QR code in an authenticator app, then enter the current six-digit code.</p><details className="mt-3 text-xs text-sa-500"><summary>Cannot scan the code?</summary><code className="mt-2 block break-all rounded bg-sa-950 p-2 text-sa-300">{setup.secret}</code></details><label className="mt-5 block text-xs font-bold text-sa-400">Verification code<input autoFocus required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} className="mt-1 block w-full max-w-48 rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-center text-xl tracking-[0.3em]" /></label><button disabled={loading || code.length !== 6} className="mt-4 rounded-xl bg-brand-500 px-4 py-2 text-sm font-black disabled:opacity-50 text-sa-950">{loading ? 'Verifying…' : 'Verify and enable'}</button></div></form>}</section></div>;
}
