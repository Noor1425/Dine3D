'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Building2, Mail, ShieldCheck, Loader2 } from 'lucide-react';
import api from '@/lib/api';

export default function ForgotPasswordPage() {
  const [restaurantCode, setRestaurantCode] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.forgotPassword(email.trim(), restaurantCode.trim().toUpperCase());
      setSent(true);
    } catch (requestError) {
      setError(requestError.message || 'Unable to request a reset link. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#050505] text-white flex items-center justify-center p-6">
      <section className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.04] p-8 shadow-2xl">
        <div className="w-12 h-12 rounded-2xl bg-[#FF6B35]/15 flex items-center justify-center mb-6">
          <ShieldCheck className="w-6 h-6 text-[#FF6B35]" />
        </div>
        <h1 className="text-3xl font-black">Reset your password</h1>
        <p className="mt-2 text-sm text-white/60">Enter the restaurant code and email you use to sign in. We never reveal whether an account exists.</p>

        {sent ? (
          <div className="mt-7">
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
              If the account exists, a single-use reset link has been sent. It expires in 20 minutes.
            </div>
            <Link href="/admin/login" className="mt-6 block text-center font-bold text-[#FF6B35]">Return to sign in</Link>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-7 space-y-5">
            {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
            <label className="block">
              <span className="text-sm font-bold">Restaurant code</span>
              <div className="relative mt-2">
                <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                <input required value={restaurantCode} onChange={(e) => setRestaurantCode(e.target.value.toUpperCase())} maxLength={13} autoComplete="organization" placeholder="DINE-7K9M2P4Q" className="w-full rounded-xl border border-white/10 bg-white/5 py-3.5 pl-12 pr-4 uppercase font-mono outline-none focus:ring-2 focus:ring-[#FF6B35]" />
              </div>
            </label>
            <label className="block">
              <span className="text-sm font-bold">Email address</span>
              <div className="relative mt-2">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                <input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@restaurant.com" className="w-full rounded-xl border border-white/10 bg-white/5 py-3.5 pl-12 pr-4 outline-none focus:ring-2 focus:ring-[#FF6B35]" />
              </div>
            </label>
            <button disabled={loading} className="w-full rounded-xl bg-[#FF6B35] py-3.5 font-black disabled:opacity-50 flex justify-center gap-2">
              {loading && <Loader2 className="w-5 h-5 animate-spin" />}
              Send reset instructions
            </button>
            <Link href="/admin/login" className="block text-center text-sm font-bold text-white/60 hover:text-white">Back to sign in</Link>
          </form>
        )}
      </section>
    </main>
  );
}
