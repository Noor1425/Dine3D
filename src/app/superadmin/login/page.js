'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import saApi from '@/lib/saApi';

export default function SuperAdminLogin() {
  const router = useRouter();
  const [form, setForm] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [mfaData, setMfaData] = useState(null);
  const [mfaCode, setMfaCode] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mfaData) {
        // Verify MFA Code
        await saApi.mfaLoginVerify(mfaData.mfaToken, mfaCode);
        router.replace('/superadmin/dashboard');
      } else {
        // Initial Login
        const data = await saApi.login(form.email, form.password);
        if (data.mfaRequired) {
          setMfaData(data);
        } else {
          router.replace('/superadmin/dashboard');
        }
      }
    } catch (err) {
      setError(err.error || err.message || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-sa-950 flex items-center justify-center px-4">
      {/* Grid bg */}
      <div
        className="fixed inset-0 opacity-[0.04]"
        style={{
          backgroundImage: 'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />
      <div className="fixed top-0 right-0 w-96 h-96 bg-orange-500/10 rounded-full blur-3xl" />
      <div className="fixed bottom-0 left-0 w-72 h-72 bg-red-500/10 rounded-full blur-3xl" />

      <div className="w-full max-w-sm relative z-10">
        {/* Card */}
        <div className="bg-sa-900 border border-sa-800 rounded-2xl overflow-hidden shadow-2xl">
          {/* Header */}
          <div className="px-8 pt-8 pb-6 border-b border-sa-800">
            <div className="flex items-center gap-2.5 mb-6">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 flex-shrink-0"/>
              <div>
                <div className="font-black text-sm text-white">Dine3d</div>
                <div className="text-[10px] text-orange-400 font-bold uppercase tracking-wider">Super Admin</div>
              </div>
            </div>
            <h1 className="text-xl font-black text-white mb-1">
              {mfaData ? 'MFA Verification' : 'Admin Portal'}
            </h1>
            <p className="text-sa-500 text-sm">
              {mfaData ? 'Enter the code from your authenticator' : 'Full platform control & management'}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="px-8 py-6 space-y-4">
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-4 py-3">
                ⚠ {error}
              </div>
            )}
            
            {mfaData ? (
              <div>
                <label className="block text-xs font-bold text-sa-500 uppercase tracking-wider mb-1.5">2FA Code</label>
                <input
                  type="text"
                  required
                  autoFocus
                  maxLength={6}
                  value={mfaCode}
                  onChange={e => setMfaCode(e.target.value)}
                  placeholder="000000"
                  className="w-full bg-sa-800 border border-sa-700 rounded-xl px-4 py-3 text-center text-2xl font-mono text-white placeholder:text-sa-600 outline-none focus:border-orange-500 transition-all"
                />
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-bold text-sa-500 uppercase tracking-wider mb-1.5">Email</label>
                  <input
                    type="email"
                    required
                    value={form.email}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="admin@dine3d.ai"
                    className="w-full bg-sa-800 border border-sa-700 rounded-xl px-4 py-3 text-sm text-white placeholder:text-sa-600 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-sa-500 uppercase tracking-wider mb-1.5">Password</label>
                  <input
                    type="password"
                    required
                    value={form.password}
                    onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                    placeholder="••••••••"
                    className="w-full bg-sa-800 border border-sa-700 rounded-xl px-4 py-3 text-sm text-white placeholder:text-sa-600 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 transition-all"
                  />
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-brand-500 text-sa-950 font-bold text-sm rounded-xl py-3.5 hover:from-orange-400 hover:to-red-400 disabled:opacity-50 transition-all shadow-lg mt-2"
            >
              {loading ? (
                <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> {mfaData ? 'Verifying…' : 'Signing in…'}</>
              ) : mfaData ? 'Verify Code' : 'Access Portal →'}
            </button>
            
            {mfaData && (
              <button 
                type="button"
                onClick={() => setMfaData(null)}
                className="w-full text-xs text-sa-500 hover:text-sa-300 transition-all pt-2"
              >
                ← Back to Login
              </button>
            )}
          </form>

          <div className="px-8 pb-6 text-center">
            <p className="text-xs text-sa-600">
              Protected control-plane access. Administrative actions are audited.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
