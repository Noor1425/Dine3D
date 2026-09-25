'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { LockKeyhole, Loader2 } from 'lucide-react';
import api from '@/lib/api';

function ResetPasswordForm() {
  const params = useSearchParams();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (!token) return setError('This reset link is missing its security token.');
    if (password.length < 15) return setError('Use at least 15 characters. A memorable passphrase works well.');
    if (password !== confirmation) return setError('Passwords do not match.');
    setLoading(true);
    try {
      await api.resetPassword(token, password);
      setComplete(true);
    } catch (requestError) {
      setError(requestError.message || 'This reset link is invalid or expired.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.04] p-8 shadow-2xl">
      <div className="w-12 h-12 rounded-2xl bg-[#FF6B35]/15 flex items-center justify-center mb-6"><LockKeyhole className="w-6 h-6 text-[#FF6B35]" /></div>
      <h1 className="text-3xl font-black">Choose a new password</h1>
      <p className="mt-2 text-sm text-white/60">Use a unique passphrase of at least 15 characters. All other sessions will be signed out.</p>
      {complete ? (
        <div className="mt-7">
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">Your password has been reset and existing sessions were revoked.</div>
          <Link href="/admin/login" className="mt-6 block text-center font-bold text-[#FF6B35]">Sign in securely</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-7 space-y-5">
          {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
          <label className="block"><span className="text-sm font-bold">New password</span><input required type="password" autoComplete="new-password" minLength={15} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3.5 outline-none focus:ring-2 focus:ring-[#FF6B35]" /></label>
          <label className="block"><span className="text-sm font-bold">Confirm new password</span><input required type="password" autoComplete="new-password" minLength={15} maxLength={128} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3.5 outline-none focus:ring-2 focus:ring-[#FF6B35]" /></label>
          <button disabled={loading || !token} className="w-full rounded-xl bg-[#FF6B35] py-3.5 font-black disabled:opacity-50 flex justify-center gap-2">{loading && <Loader2 className="w-5 h-5 animate-spin" />}Reset password</button>
        </form>
      )}
    </section>
  );
}

export default function ResetPasswordPage() {
  return <main className="min-h-screen bg-[#050505] text-white flex items-center justify-center p-6"><Suspense fallback={<div>Loading secure reset…</div>}><ResetPasswordForm /></Suspense></main>;
}
