'use client';
import { homeRouteForSession } from '@/lib/tenantAccess';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Mail, Lock, Eye, EyeOff, AlertCircle, Shield, ArrowRight, Loader2 } from 'lucide-react';
import api from '@/lib/api';

/**
 * Where to send someone the moment they are signed in.
 *
 * A rider's account can reach nothing under /admin, so it has to be named here.
 *
 * Everyone else goes to the backoffice's first page. Sign-in does not know what
 * they are allowed to open — the login response carries no permissions, which
 * is why the check below is `() => true` — so this is a starting point, not a
 * verdict. The admin layout loads the real permissions and moves them on to
 * their own home, which for a cashier is the POS rather than a dashboard they
 * cannot read.
 */
function destinationFor(response) {
  return homeRouteForSession(response?.user?.role, () => true) || '/admin/dashboard';
}

/**
 * Frontend-only demo build: this folder is a standalone copy of the app used
 * to showcase the UI against the existing backend without asking anyone to
 * remember or type real credentials. It still authenticates for real against
 * the API below — it just skips the manual form entry. Swap or remove this
 * once real, per-viewer login is wired up.
 */
const DEMO_CREDENTIALS = {
  restaurantCode: 'DINE-1000',
  email: 'asjad@gmail.com',
  password: 'Velvet-Lantern-Sky-731!',
  rememberMe: true
};


/**
 * Unified Professional Login Page
 * Handles all authentication scenarios automatically:
 * - Single-restaurant users (Staff table)
 * - Multi-restaurant users (User table)
 * - Platform administrators
 * - Restaurant selection for multi-location users
 */
export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState('credentials'); // 'credentials' | 'mfa'
  const [formData, setFormData] = useState({
    restaurantCode: '',
    email: '',
    password: '',
    rememberMe: false,
    mfaCode: ''
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [verificationRequired, setVerificationRequired] = useState(false);

  // Check if already logged in
  useEffect(() => {
    const checkSession = async () => {
      try {
        const session = await api.getMe();
        if (session?.user?.role === 'superadmin') {
          router.replace('/superadmin/dashboard');
        } else if (session?.restaurant) {
          router.replace('/admin/dashboard');
        }
      } catch (e) {
        // Not logged in, stay on page
      }
    };
    checkSession();
  }, [router]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setVerificationRequired(false);
    setLoading(true);

    // Validate restaurant code
    if (!formData.restaurantCode.trim()) {
      setError('Please enter your restaurant code');
      setLoading(false);
      return;
    }

    try {
      const response = await api.post('/auth/login', {
        restaurantCode: formData.restaurantCode.trim().toUpperCase(),
        email: formData.email.trim(),
        password: formData.password,
        rememberMe: formData.rememberMe
      });

      if (response.state === 'MFA_REQUIRED' || response.mfaRequired) {
        setStep('mfa');
        setLoading(false);
        return;
      }

      if (response.restaurant) {
        localStorage.setItem('dine3d_restaurant', JSON.stringify(response.restaurant));
      }
      api.setToken(true);
      router.replace(destinationFor(response));
    } catch (loginError) {
      if (loginError.status === 429) {
        setError('Too many login attempts. Please wait 15 minutes and try again.');
      } else if (loginError.code === 'EMAIL_VERIFICATION_REQUIRED') {
        setError('Verify your email before signing in. You can request a new link below.');
        setVerificationRequired(true);
      } else if (loginError.status === 423) {
        setError('Account temporarily locked due to failed login attempts. Please wait 15 minutes.');
      } else {
        setError(loginError.message || 'Unable to sign in. Please check your details and try again.');
      }
      setLoading(false);
    }
  };

  const handleDemoLogin = async () => {
    setError('');
    setVerificationRequired(false);
    setLoading(true);
    setFormData(prev => ({ ...prev, ...DEMO_CREDENTIALS }));

    try {
      const response = await api.post('/auth/login', {
        restaurantCode: DEMO_CREDENTIALS.restaurantCode,
        email: DEMO_CREDENTIALS.email,
        password: DEMO_CREDENTIALS.password,
        rememberMe: DEMO_CREDENTIALS.rememberMe
      });

      if (response.restaurant) {
        localStorage.setItem('dine3d_restaurant', JSON.stringify(response.restaurant));
      }
      api.setToken(true);
      router.replace(destinationFor(response));
    } catch (loginError) {
      setError(loginError.message || 'Demo login is unavailable right now. Is the backend running on port 4000?');
      setLoading(false);
    }
  };

  const resendVerification = async () => {
    setLoading(true);
    try {
      await api.resendVerification(formData.email.trim());
      setError('If this account is awaiting verification, a new link has been sent.');
      setVerificationRequired(false);
    } catch (requestError) {
      setError(requestError.message || 'Unable to resend verification right now.');
    } finally {
      setLoading(false);
    }
  };

  const handleMfaSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await api.post('/auth/mfa/login-verify', {
        code: formData.mfaCode,
        rememberMe: formData.rememberMe
      });
      api.setToken(true);
      if (response.restaurant) {
        localStorage.setItem('dine3d_restaurant', JSON.stringify(response.restaurant));
      }
      router.replace(destinationFor(response));
    } catch (err) {
      setError(err.message || 'That verification code is invalid or expired.');
      setLoading(false);
    }
  };

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (error) setError(''); // Clear error when user types
  };

  return (
    <div className="min-h-screen flex bg-[#050505]">
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@200;400;600;800&display=swap');
        body { font-family: 'Plus Jakarta Sans', sans-serif; background: #050505; }
        .glass { background: rgba(255, 255, 255, 0.04); backdrop-filter: blur(16px); border: 1px solid rgba(255, 255, 255, 0.1); }
      `}</style>

      {/* Left Side - Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-[#0a0a0a] p-12 flex-col justify-between relative overflow-hidden">
        {/* Animated background elements */}
        <div className="absolute inset-0 overflow-hidden">
          {/* Gradient orbs */}
          <div className="absolute top-0 left-0 w-[500px] h-[500px] bg-[#FF6B35] rounded-full blur-[120px] opacity-20 animate-pulse" />
          <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-[#F7C948] rounded-full blur-[100px] opacity-15"
               style={{ animation: 'pulse 4s ease-in-out infinite' }} />

          {/* Grid pattern */}
          <div className="absolute inset-0 opacity-[0.02]" style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
            backgroundSize: '50px 50px'
          }} />
        </div>

        <div className="relative z-10">
          {/* Logo */}
          <div className="flex items-center space-x-3 mb-16">
            <div className="w-11 h-11 bg-gradient-to-br from-[#FF6B35] to-[#F7C948] rounded-xl flex items-center justify-center shadow-[0_10px_30px_-5px_rgba(255,107,53,0.5)]">
              <div className="w-2.5 h-2.5 bg-white rounded-sm" />
            </div>
            <span className="text-2xl font-extrabold tracking-tighter text-white">Dine3D</span>
          </div>

          {/* Hero Content */}
          <div className="max-w-md space-y-8">
            <div>
              <div className="inline-flex items-center space-x-2 px-3 py-1.5 rounded-full bg-[#FF6B35]/10 border border-[#FF6B35]/20 mb-6">
                <div className="w-1.5 h-1.5 bg-[#FF6B35] rounded-full animate-pulse" />
                <span className="text-[#FF6B35] text-xs font-black tracking-wider uppercase">Restaurant OS</span>
              </div>

              <h1 className="text-5xl font-black text-white mb-5 leading-[1.1] tracking-tight">
                Welcome Back to <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#FF6B35] to-[#F7C948]">Dine3D</span>
              </h1>

              <p className="text-white/60 text-lg leading-relaxed">
                Your command center for managing every aspect of your restaurant business with precision and ease.
              </p>
            </div>

            {/* Feature Grid */}
            <div className="grid grid-cols-1 gap-3">
              <div className="group p-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-[#FF6B35]/30 transition-all duration-300">
                <div className="flex items-center space-x-4">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#FF6B35]/20 to-[#FF6B35]/5 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Shield className="w-6 h-6 text-[#FF6B35]" />
                  </div>
                  <div>
                    <h3 className="text-white font-bold text-sm mb-0.5">Strong Account Protection</h3>
                    <p className="text-white/50 text-xs">Rotating sessions, scoped access, and optional MFA</p>
                  </div>
                </div>
              </div>

              <div className="group p-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-[#FF6B35]/30 transition-all duration-300">
                <div className="flex items-center space-x-4">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#F7C948]/20 to-[#F7C948]/5 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Building2 className="w-6 h-6 text-[#F7C948]" />
                  </div>
                  <div>
                    <h3 className="text-white font-bold text-sm mb-0.5">Multi-Location Ready</h3>
                    <p className="text-white/50 text-xs">Manage all branches from one dashboard</p>
                  </div>
                </div>
              </div>

              <div className="group p-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-[#FF6B35]/30 transition-all duration-300">
                <div className="flex items-center space-x-4">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#FF6B35]/20 to-[#F7C948]/10 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <svg className="w-6 h-6 text-[#FF6B35]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-white font-bold text-sm mb-0.5">Lightning Fast Sync</h3>
                    <p className="text-white/50 text-xs">Real-time updates across all devices</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Stats */}
        <div className="relative z-10 pt-8 border-t border-white/10">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-lg font-black text-white mb-1">Tenant-aware</div>
              <div className="text-white/50 text-sm font-medium">Restaurant isolation</div>
            </div>
            <div>
              <div className="text-lg font-black text-white mb-1">Role-based</div>
              <div className="text-white/50 text-sm font-medium">Least-privilege access</div>
            </div>
            <div>
              <div className="text-lg font-black text-white mb-1">Auditable</div>
              <div className="text-white/50 text-sm font-medium">Security events</div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Side - Login Form */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12 bg-[#050505]">
        <div className="w-full max-w-md">
          {/* Mobile Logo */}
          <div className="lg:hidden flex items-center justify-center space-x-3 mb-8">
            <div className="w-10 h-10 bg-gradient-to-br from-[#FF6B35] to-[#F7C948] rounded-xl flex items-center justify-center">
              <div className="w-2.5 h-2.5 bg-white rounded-sm" />
            </div>
            <span className="text-2xl font-extrabold tracking-tighter text-white">Dine3D</span>
          </div>

          {step === 'credentials' ? (
            <>
              {/* Header */}
              <div className="mb-8">
                <h2 className="text-3xl font-black text-white mb-2 tracking-tight">
                  Welcome back
                </h2>
                <p className="text-white/70 font-medium">
                  Sign in to your restaurant dashboard
                </p>
              </div>

              {/* Error Message */}
              {error && (
                <div className="mb-6 p-4 glass border-red-500/50 rounded-xl flex items-start space-x-3">
                  <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-bold text-red-400 mb-1">Login Failed</p>
                    <p className="text-sm text-red-400/80">{error}</p>
                    {verificationRequired && (
                      <button type="button" onClick={resendVerification} disabled={loading} className="mt-2 text-xs font-black text-white underline underline-offset-2 disabled:opacity-50">
                        Resend verification email
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Demo Login */}
              <button
                type="button"
                onClick={handleDemoLogin}
                disabled={loading}
                className="w-full mb-6 bg-white/5 border border-[#F7C948]/40 text-[#F7C948] font-black py-3.5 rounded-xl hover:bg-[#F7C948]/10 focus:outline-none focus:ring-2 focus:ring-[#F7C948] disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center space-x-2"
              >
                {loading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    <Shield className="w-5 h-5" />
                    <span>Try Demo (Restaurant Owner)</span>
                  </>
                )}
              </button>

              <div className="relative mb-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-white/10" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="px-3 bg-[#050505] text-white/40 font-bold uppercase tracking-wider">or sign in manually</span>
                </div>
              </div>

              {/* Login Form */}
              <form onSubmit={handleSubmit} className="space-y-5">
                {/* Restaurant Code Field */}
                <div>
                  <label htmlFor="restaurantCode" className="block text-sm font-bold text-white mb-2">
                    Restaurant Code
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <Building2 className="w-5 h-5 text-white/40" />
                    </div>
                    <input
                      id="restaurantCode"
                      type="text"
                      required
                      autoFocus
                      value={formData.restaurantCode}
                      onChange={(e) => handleInputChange('restaurantCode', e.target.value.toUpperCase())}
                      className="w-full pl-12 pr-4 py-3.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-[#FF6B35] focus:border-transparent transition-all uppercase tracking-wider font-mono"
                      placeholder="DINE-7K9M2P4Q"
                      maxLength={13}
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-white/50">
                    Enter your unique restaurant login code (e.g., DINE-7K9M2P4Q)
                  </p>
                </div>

                {/* Email Field */}
                <div>
                  <label htmlFor="email" className="block text-sm font-bold text-white mb-2">
                    Email Address
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <Mail className="w-5 h-5 text-white/40" />
                    </div>
                    <input
                      id="email"
                      type="email"
                      required
                      autoComplete="email"
                      value={formData.email}
                      onChange={(e) => handleInputChange('email', e.target.value)}
                      className="w-full pl-12 pr-4 py-3.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-[#FF6B35] focus:border-transparent transition-all"
                      placeholder="you@restaurant.com"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <label className="flex items-center gap-2 text-sm text-white/70 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.rememberMe}
                      onChange={(e) => handleInputChange('rememberMe', e.target.checked)}
                      className="h-4 w-4 rounded border-white/20 bg-white/5 text-[#FF6B35] focus:ring-[#FF6B35]"
                    />
                    Keep me signed in on this device
                  </label>
                  <a href="/forgot-password" className="text-sm font-bold text-[#FF6B35] hover:text-[#FF6B35]/80">
                    Forgot password?
                  </a>
                </div>

                {/* Password Field */}
                <div>
                  <label htmlFor="password" className="block text-sm font-bold text-white mb-2">
                    Password
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <Lock className="w-5 h-5 text-white/40" />
                    </div>
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      value={formData.password}
                      onChange={(e) => handleInputChange('password', e.target.value)}
                      className="w-full pl-12 pr-12 py-3.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-[#FF6B35] focus:border-transparent transition-all"
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 pr-4 flex items-center text-white/40 hover:text-white/70 transition-colors"
                    >
                      {showPassword ? (
                        <EyeOff className="w-5 h-5" />
                      ) : (
                        <Eye className="w-5 h-5" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={loading || !formData.restaurantCode || !formData.email || !formData.password}
                  className="w-full bg-[#FF6B35] text-white font-black py-3.5 rounded-xl hover:bg-[#FF6B35]/90 focus:outline-none focus:ring-2 focus:ring-[#FF6B35] focus:ring-offset-2 focus:ring-offset-[#050505] disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center space-x-2 shadow-[0_20px_40px_-5px_rgba(255,107,53,0.5)]"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>Signing in...</span>
                    </>
                  ) : (
                    <>
                      <span>Sign In</span>
                      <ArrowRight className="w-5 h-5" />
                    </>
                  )}
                </button>
              </form>

              {/* Create Account Link */}
              <div className="mt-6 text-center">
                <p className="text-white/70 text-sm font-medium">
                  Don't have an account?{' '}
                  <a
                    href="/register"
                    className="font-bold text-[#FF6B35] hover:text-[#FF6B35]/80 transition-colors"
                  >
                    Create Account
                  </a>
                </p>
              </div>

              {/* Security Badge */}
              <div className="mt-6 pt-6 border-t border-white/10">
                <div className="flex items-center justify-center space-x-2 text-white/50 text-sm font-medium">
                  <Shield className="w-4 h-4" />
                  <span>Protected by enterprise-grade security</span>
                </div>
              </div>
            </>
          ) : (
            <>
              {/* MFA Challenge Step */}
              <div className="mb-8">
                <button
                  onClick={() => setStep('credentials')}
                  className="text-sm text-white/70 hover:text-white mb-4 flex items-center space-x-1 transition-colors font-bold"
                >
                  <span>←</span>
                  <span>Start over</span>
                </button>
                <h2 className="text-3xl font-black text-white mb-2 tracking-tight">
                  Verify it’s you
                </h2>
                <p className="text-white/70 font-medium">
                  Enter the six-digit code from your authenticator, or use a recovery code.
                </p>
              </div>

              {/* Error Message */}
              {error && (
                <div className="mb-6 p-4 glass border-red-500/50 rounded-xl flex items-start space-x-3">
                  <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-bold text-red-400">{error}</p>
                  </div>
                </div>
              )}

              <form onSubmit={handleMfaSubmit} className="space-y-5">
                <div>
                  <label htmlFor="mfaCode" className="block text-sm font-bold text-white mb-2">Verification code</label>
                  <input
                    id="mfaCode"
                    type="text"
                    required
                    autoFocus
                    autoComplete="one-time-code"
                    inputMode="text"
                    value={formData.mfaCode}
                    onChange={(e) => handleInputChange('mfaCode', e.target.value.replace(/\s/g, '').toUpperCase())}
                    className="w-full px-4 py-3.5 bg-white/5 border border-white/10 rounded-xl text-white text-center tracking-[0.35em] font-mono focus:outline-none focus:ring-2 focus:ring-[#FF6B35]"
                    placeholder="000000"
                    maxLength={32}
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading || formData.mfaCode.length < 6}
                  className="w-full bg-[#FF6B35] text-white font-black py-3.5 rounded-xl disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Shield className="w-5 h-5" />}
                  <span>{loading ? 'Verifying…' : 'Verify and sign in'}</span>
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
