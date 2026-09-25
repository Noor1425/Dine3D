'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { MailCheck, Loader2 } from 'lucide-react';
import api from '@/lib/api';

function VerifyEmailContent() {
  const params = useSearchParams();
  const token = params.get('token') || '';
  const [state, setState] = useState('working');
  const [message, setMessage] = useState('Verifying your email address…');
  const [email, setEmail] = useState('');

  useEffect(() => {
    if (!token) {
      setState('error');
      setMessage('This verification link is missing its security token.');
      return;
    }
    api.verifyEmail(token)
      .then((result) => { setState('success'); setMessage(result.message || 'Email verified. You can now sign in.'); })
      .catch((error) => { setState('error'); setMessage(error.message || 'This verification link is invalid or expired.'); });
  }, [token]);

  const resend = async (event) => {
    event.preventDefault();
    setState('working');
    try {
      const result = await api.resendVerification(email.trim());
      setState('resent');
      setMessage(result.message);
    } catch (error) {
      setState('error');
      setMessage(error.message || 'Unable to resend verification right now.');
    }
  };

  return (
    <section className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center shadow-2xl">
      <div className="mx-auto w-14 h-14 rounded-2xl bg-[#FF6B35]/15 flex items-center justify-center mb-6">{state === 'working' ? <Loader2 className="w-7 h-7 animate-spin text-[#FF6B35]" /> : <MailCheck className="w-7 h-7 text-[#FF6B35]" />}</div>
      <h1 className="text-3xl font-black">Email verification</h1>
      <p className={`mt-3 text-sm ${state === 'error' ? 'text-red-300' : 'text-white/70'}`}>{message}</p>
      {state === 'success' && <Link href="/admin/login" className="mt-7 block rounded-xl bg-[#FF6B35] py-3.5 font-black">Continue to sign in</Link>}
      {state === 'error' && (
        <form onSubmit={resend} className="mt-7 space-y-3">
          <input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@restaurant.com" className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3.5 text-left outline-none focus:ring-2 focus:ring-[#FF6B35]" />
          <button className="w-full rounded-xl bg-[#FF6B35] py-3.5 font-black">Send a new verification link</button>
        </form>
      )}
      {state === 'resent' && <Link href="/admin/login" className="mt-7 block font-bold text-[#FF6B35]">Return to sign in</Link>}
    </section>
  );
}

export default function VerifyEmailPage() {
  return <main className="min-h-screen bg-[#050505] text-white flex items-center justify-center p-6"><Suspense fallback={<div>Loading verification…</div>}><VerifyEmailContent /></Suspense></main>;
}
