'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { 
  Building2, 
  Mail, 
  Lock, 
  User, 
  Phone, 
  Eye, 
  EyeOff, 
  AlertCircle, 
  CheckCircle,
  ArrowRight,
  ArrowLeft,
  Check,
  Sparkles
} from 'lucide-react';
import apiClient from '@/lib/api';

/**
 * Plans are fetched, never hardcoded.
 *
 * This file used to carry its own list quoting $29, $79 and $199 a month —
 * figures that existed in no catalogue, in a currency Dine3D does not bill in.
 * A restaurant chose a plan on this screen and was then billed something else
 * entirely. The catalogue is the only place pricing lives now, and it answers
 * per country, because the rate genuinely differs by market.
 */

/** What a tier costs, said the way a restaurant would say it. */
const priceLine = (plan) => {
  if (plan.billingModel !== 'METERED') {
    return { big: 'Free', small: plan.trialDurationDays ? `${plan.trialDurationDays} days` : '' };
  }
  return { big: `${plan.currency} ${plan.meteredRate}`, small: `per ${plan.meteredUnit?.toLowerCase() || 'order'}` };
};

const money = (value, currency) =>
  `${currency} ${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

/**
 * What this tier adds over the one below it.
 *
 * The full list arrives in catalogue order, which means the five features a
 * card has room for are whichever five happen to be first — and on the upper
 * tiers those are mostly the same five the tier below already had. A buyer
 * comparing Professional against Basic learns nothing from that. Showing the
 * difference is the whole job of a pricing card.
 *
 * Only the paid ladder is compared. The free trial has no tier below it, and
 * Basic is the floor of the paid range, so both show what they include outright.
 */
const tierHighlights = (plan, plans) => {
  const paid = plans.filter((item) => item.billingModel === 'METERED');
  const index = paid.findIndex((item) => item.key === plan.key);
  const below = index > 0 ? paid[index - 1] : null;
  const own = plan.features || [];

  if (!below) return { inherits: null, features: own };

  const alreadyThere = new Set((below.features || []).map((feature) => feature.key));
  const added = own.filter((feature) => !alreadyThere.has(feature.key));
  // A tier that adds nothing would show an empty list, which reads as broken
  // rather than as "same features, higher ceiling".
  return added.length ? { inherits: below.name, features: added } : { inherits: below.name, features: own };
};

function RegisterPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preSelectedPlan = searchParams.get('plan');

  const [step, setStep] = useState(1);
  // Sign-up is the trial and nothing else.
  //
  // A paid plan needs a conversation before it needs a form: the tier depends
  // on how busy they are and how many tills they run, the setup fee is agreed
  // in that call, and the money arrives by JazzCash rather than a checkout. A
  // plan picker here let someone choose Professional off a pricing page before
  // we had asked a single question, and pointed at a Stripe flow that does not
  // exist.
  const selectedPlan = 'free_trial';
  const [formData, setFormData] = useState({
    city: '',
    dailyOrders: '',
    branches: '1',
    internetQuality: '',
    email: '',
    password: '',
    confirmPassword: '',
    name: '',
    phone: '',
    restaurantName: '',
    countryCode: 'PK',
  });
  // The country decides the rate, and the currency follows from it. Fetched so
  // the list and the currency mapping stay with the catalogue rather than being
  // duplicated here and drifting from it.
  const [countries, setCountries] = useState([]);
  const [plans, setPlans] = useState([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const quote = plans.find((plan) => plan.key === selectedPlan) || null;
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [restaurantCode, setRestaurantCode] = useState(null); // Store generated code

  // The country list and the quote both come from the catalogue, so the price
  // shown at sign-up is the price the first invoice will use. A failure here
  // leaves the field usable with the home market rather than an empty selector.
  useEffect(() => {
    let cancelled = false;
    apiClient.get('/billing/countries')
      .then((data) => { if (!cancelled && data?.countries?.length) setCountries(data.countries); })
      .catch(() => { if (!cancelled) setCountries([{ code: 'PK', name: 'Pakistan', currency: 'PKR' }]); });
    return () => { cancelled = true; };
  }, []);

  // Re-quoted whenever the country changes, so the card a restaurant is looking
  // at is the price it will actually be billed.
  useEffect(() => {
    if (!formData.countryCode) return undefined;
    let cancelled = false;
    setPlansLoading(true);
    apiClient.get(`/billing/plans?country=${encodeURIComponent(formData.countryCode)}`)
      .then((data) => { if (!cancelled) setPlans(data?.plans || []); })
      .catch(() => { if (!cancelled) setPlans([]); })
      .finally(() => { if (!cancelled) setPlansLoading(false); });
    return () => { cancelled = true; };
  }, [formData.countryCode]);

  // If the catalogue does not offer whatever was pre-selected from a link, fall
  // back to the recommended tier rather than submitting a plan that is gone.
  useEffect(() => {
    if (plansLoading || plans.length === 0) return;
    if (plans.some((plan) => plan.key === selectedPlan)) return;
    setSelectedPlan((plans.find((plan) => plan.isRecommended) || plans[0]).key);
  }, [plans, plansLoading, selectedPlan]);

  const handleInputChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
    setError(null);
  };

  const validateStep2 = () => {
    if (!formData.email.includes('@')) {
      setError('Please enter a valid email');
      return false;
    }
    if (formData.password.length < 15) {
      setError('Use at least 15 characters. A memorable passphrase works well.');
      return false;
    }
    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return false;
    }
    return true;
  };

  const validateStep3 = () => {
    if (!formData.name || !formData.restaurantName) {
      setError('Please fill in all required fields');
      return false;
    }
    return true;
  };

  const handleNextStep = () => {
    if (step === 1) {
      setStep(2);
    } else if (step === 2) {
      if (validateStep2()) {
        setStep(3);
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateStep3()) return;

    setError(null);
    setLoading(true);

    try {
      const response = await apiClient.post('/v2/auth/register/restaurant', {
        email: formData.email,
        password: formData.password,
        name: formData.name,
        phone: formData.phone,
        restaurantName: formData.restaurantName,
        countryCode: formData.countryCode,
        plan: selectedPlan,
        city: formData.city,
        dailyOrders: formData.dailyOrders,
        branches: Number(formData.branches) || 1,
        internetQuality: formData.internetQuality,
      });

      if (response.success) {
        // Store restaurant code for display
        if (response.restaurantCode) {
          setRestaurantCode(response.restaurantCode);
        }

        // Email ownership is verified before sign-in. Going live is a
        // conversation, not a checkout — see the success screen.
        setSuccess(true);
      }
    } catch (err) {
      setError(err.message || 'Registration failed. Please try again.');
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center p-4">
        <style jsx global>{`
          @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@200;400;600;800&display=swap');
          body { font-family: 'Plus Jakarta Sans', sans-serif; }
        `}</style>
        
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-2xl w-full"
        >
          {/* Success Icon */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-[#FF6B35]/20 rounded-full mb-6">
              <CheckCircle className="w-12 h-12 text-[#FF6B35]" />
            </div>
            <h1 className="text-4xl font-black text-white mb-3 tracking-tight">Check your email</h1>
            <p className="text-white/70 text-lg">Your restaurant is ready. Verify your email before signing in.</p>
          </div>

          {/* Restaurant Code Display - Most Important */}
          {restaurantCode && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="glass rounded-2xl p-8 mb-6 border-2 border-[#FF6B35]/30 shadow-[0_0_50px_-10px_rgba(255,107,53,0.5)]"
            >
              <div className="text-center">
                <div className="inline-flex items-center space-x-2 mb-3">
                  <Building2 className="w-5 h-5 text-[#FF6B35]" />
                  <span className="text-sm font-black tracking-wider text-[#FF6B35] uppercase">Your Restaurant Code</span>
                </div>
                
                <div className="mb-4">
                  <div className="inline-block bg-white/10 px-8 py-4 rounded-xl border border-white/20">
                    <code className="text-5xl font-black text-white tracking-wider font-mono">
                      {restaurantCode}
                    </code>
                  </div>
                </div>

                <div className="bg-[#FF6B35]/10 border border-[#FF6B35]/20 rounded-xl p-4 mb-4">
                  <p className="text-white/90 font-bold mb-2">
                    Save this restaurant code
                  </p>
                  <p className="text-white/70 text-sm">
                    You and your staff will need this code to login. Write it down or take a screenshot.
                  </p>
                </div>

                <button
                  onClick={() => {
                    navigator.clipboard.writeText(restaurantCode);
                    alert('Restaurant code copied to clipboard!');
                  }}
                  className="inline-flex items-center space-x-2 bg-white/10 hover:bg-white/20 text-white px-6 py-3 rounded-lg transition-all font-bold"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  <span>Copy Code</span>
                </button>
              </div>
            </motion.div>
          )}

          {/* What's Next */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="glass rounded-2xl p-6 mb-6"
          >
            <h3 className="text-xl font-black text-white mb-4">What's Next?</h3>
            <div className="space-y-3">
              <div className="flex items-start space-x-3">
                <div className="w-6 h-6 rounded-full bg-[#FF6B35] flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-white text-xs font-bold">1</span>
                </div>
                <div>
                  <p className="text-white font-bold">Verify Your Email</p>
                  <p className="text-white/60 text-sm">Open the single-use verification link sent to {formData.email}</p>
                </div>
              </div>
              
              <div className="flex items-start space-x-3">
                <div className="w-6 h-6 rounded-full bg-[#FF6B35] flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-white text-xs font-bold">2</span>
                </div>
                <div>
                  <p className="text-white font-bold">Sign In Securely</p>
                  <p className="text-white/60 text-sm">Use your restaurant code, email, password, and MFA when enabled</p>
                </div>
              </div>
              
              <div className="flex items-start space-x-3">
                <div className="w-6 h-6 rounded-full bg-[#FF6B35] flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-white text-xs font-bold">3</span>
                </div>
                <div>
                  <p className="text-white font-bold">Activate Your Plan</p>
                  <p className="text-white/60 text-sm">Three days free. To go live, we agree your plan on WhatsApp and set it up for you.</p>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Action Button */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="text-center"
          >
            <button
              onClick={() => router.push('/admin/login')}
              className="bg-[#FF6B35] text-white px-8 py-4 rounded-xl hover:bg-[#FF6B35]/90 transition-all font-black text-lg flex items-center justify-center space-x-2 mx-auto shadow-[0_20px_40px_-5px_rgba(255,107,53,0.5)]"
            >
              <span>Go to Login</span>
              <ArrowRight className="w-5 h-5" />
            </button>
            <p className="text-white/50 text-sm mt-4">
              Your restaurant code: <span className="text-[#FF6B35] font-mono font-bold">{restaurantCode}</span>
            </p>
          </motion.div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-white">
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@200;400;600;800&display=swap');
        body { font-family: 'Plus Jakarta Sans', sans-serif; background: #050505; }
        .glass { background: rgba(255, 255, 255, 0.04); backdrop-filter: blur(16px); border: 1px solid rgba(255, 255, 255, 0.1); }
      `}</style>

      {/* Header */}
      <nav className="border-b border-white/10 bg-[#050505]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link href="/" className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-gradient-to-br from-[#FF6B35] to-[#F7C948] rounded-lg flex items-center justify-center">
                <div className="w-2.5 h-2.5 bg-white rounded-sm" />
              </div>
              <span className="text-xl font-extrabold tracking-tighter text-white">Dine3D</span>
            </Link>
            <Link href="/admin/login" className="text-[11px] font-black tracking-widest text-white/70 hover:text-white transition-colors uppercase">
              Already have an account? <span className="text-[#FF6B35]">Sign in</span>
            </Link>
          </div>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-4 py-12">
        {/* Progress Steps */}
        <div className="mb-12">
          <div className="flex items-center justify-center space-x-4">
            {[
              { num: 1, label: 'Choose Plan' },
              { num: 2, label: 'Account' },
              { num: 3, label: 'Restaurant' }
            ].map((s, idx) => (
              <div key={s.num} className="flex items-center">
                <div className={`flex items-center space-x-3`}>
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-sm transition-all ${
                    step > s.num 
                      ? 'bg-[#FF6B35] text-white' 
                      : step === s.num 
                      ? 'bg-[#FF6B35] text-white' 
                      : 'bg-white/10 text-white/40'
                  }`}>
                    {step > s.num ? <Check className="w-5 h-5" /> : s.num}
                  </div>
                  <span className="hidden sm:block text-sm font-bold text-white/70">{s.label}</span>
                </div>
                {idx < 2 && (
                  <div className={`w-12 sm:w-24 h-0.5 mx-2 transition-all ${step > s.num ? 'bg-[#FF6B35]' : 'bg-white/10'}`} />
                )}
              </div>
            ))}
          </div>
        </div>

        {error && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-2xl mx-auto mb-6 p-4 glass rounded-2xl flex items-start space-x-3 border-red-500/50"
          >
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-400">{error}</p>
          </motion.div>
        )}

        {/* Step 1: Plan Selection */}
        {step === 1 && (
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="space-y-8"
          >
            <div className="text-center mb-8">
              <h1 className="text-4xl font-black text-white mb-3 tracking-tight">Try it for three days</h1>
              <p className="text-lg text-white/70">
                A full restaurant, already set up with a menu, tables and QR codes. Take an order and
                watch it reach the kitchen. No payment, no card.
              </p>
            </div>

            {/* The country comes first, because the rate genuinely differs by
                market — it is priced for each one, not converted. */}
            <div className="max-w-md mx-auto">
              <label htmlFor="countryCode" className="block text-sm font-bold text-white mb-2">
                Where is your restaurant?
              </label>
              <select
                id="countryCode"
                name="countryCode"
                value={formData.countryCode}
                onChange={handleInputChange}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg focus:ring-2 focus:ring-[#FF6B35] focus:border-transparent text-white"
              >
                {countries.map((country) => (
                  <option key={country.code} value={country.code} className="bg-[#0a0a0a]">
                    {country.name} ({country.currency})
                  </option>
                ))}
              </select>
              {quote && !quote.pricedFor && quote.billingModel === 'METERED' ? (
                <p className="mt-2 text-xs text-white/40">
                  We have not set local pricing for this country yet — these are our standard
                  rates, and we will confirm before you go live.
                </p>
              ) : null}
            </div>

            {/* What they tell us here is the only thing we know before the
                sales call, so it asks what decides that call: how busy they
                are, how many branches, and whether the internet is good enough
                to skip an Edge node. Every field is optional — a required
                question is one more reason to close the tab. */}
            <div className="max-w-md mx-auto space-y-5">
              <div>
                <label htmlFor="city" className="block text-sm font-bold text-white mb-2">
                  Which city? <span className="font-normal text-white/40">(optional)</span>
                </label>
                <input
                  id="city"
                  type="text"
                  value={formData.city}
                  onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                  placeholder="Lahore"
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:border-[#FF6B35] focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="dailyOrders" className="block text-sm font-bold text-white mb-2">
                  Roughly how many orders a day? <span className="font-normal text-white/40">(optional)</span>
                </label>
                <select
                  id="dailyOrders"
                  value={formData.dailyOrders}
                  onChange={(e) => setFormData({ ...formData, dailyOrders: e.target.value })}
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:border-[#FF6B35] focus:outline-none"
                >
                  <option value="" className="bg-[#0A0A0A]">Not sure yet</option>
                  <option value="under-50" className="bg-[#0A0A0A]">Under 50</option>
                  <option value="50-150" className="bg-[#0A0A0A]">50 to 150</option>
                  <option value="150-300" className="bg-[#0A0A0A]">150 to 300</option>
                  <option value="over-300" className="bg-[#0A0A0A]">More than 300</option>
                </select>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="branches" className="block text-sm font-bold text-white mb-2">
                    Branches
                  </label>
                  <select
                    id="branches"
                    value={formData.branches}
                    onChange={(e) => setFormData({ ...formData, branches: e.target.value })}
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:border-[#FF6B35] focus:outline-none"
                  >
                    <option value="1" className="bg-[#0A0A0A]">Just one</option>
                    <option value="2" className="bg-[#0A0A0A]">Two</option>
                    <option value="3" className="bg-[#0A0A0A]">Three</option>
                    <option value="5" className="bg-[#0A0A0A]">More than three</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="internetQuality" className="block text-sm font-bold text-white mb-2">
                    Internet there
                  </label>
                  <select
                    id="internetQuality"
                    value={formData.internetQuality}
                    onChange={(e) => setFormData({ ...formData, internetQuality: e.target.value })}
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:border-[#FF6B35] focus:outline-none"
                  >
                    <option value="" className="bg-[#0A0A0A]">Not sure</option>
                    <option value="reliable" className="bg-[#0A0A0A]">Usually reliable</option>
                    <option value="patchy" className="bg-[#0A0A0A]">Drops sometimes</option>
                    <option value="poor" className="bg-[#0A0A0A]">Often down</option>
                  </select>
                </div>
              </div>

              <p className="text-xs leading-5 text-white/40">
                Your trial runs for three days on a demo menu. When you are ready to go live we will
                talk on WhatsApp, agree the right plan for your size, and set the system up for you.
              </p>
            </div>

          </motion.div>
        )}

        {/* Step 2: Account Details */}
        {step === 2 && (
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="max-w-2xl mx-auto"
          >
            <div className="text-center mb-8">
              <h1 className="text-3xl font-black text-white mb-3 tracking-tight">Create Your Account</h1>
              <p className="text-white/70">We'll use this to keep your account secure</p>
            </div>

            <div className="glass rounded-2xl shadow-xl p-8">
              <form className="space-y-6">
                <div>
                  <label htmlFor="email" className="block text-sm font-bold text-white mb-2">
                    Email Address *
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                    <input
                      id="email"
                      name="email"
                      type="email"
                      required
                      value={formData.email}
                      onChange={handleInputChange}
                      className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-lg focus:ring-2 focus:ring-[#FF6B35] focus:border-transparent text-white placeholder-white/40"
                      placeholder="you@example.com"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="password" className="block text-sm font-bold text-white mb-2">
                    Password *
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                    <input
                      id="password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={formData.password}
                      onChange={handleInputChange}
                      className="w-full pl-10 pr-12 py-3 bg-white/5 border border-white/10 rounded-lg focus:ring-2 focus:ring-[#FF6B35] focus:border-transparent text-white placeholder-white/40"
                      minLength={15}
                      maxLength={128}
                      autoComplete="new-password"
                      placeholder="At least 15 characters"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/60"
                    >
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label htmlFor="confirmPassword" className="block text-sm font-bold text-white mb-2">
                    Confirm Password *
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                    <input
                      id="confirmPassword"
                      name="confirmPassword"
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={15}
                      maxLength={128}
                      autoComplete="new-password"
                      value={formData.confirmPassword}
                      onChange={handleInputChange}
                      className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-lg focus:ring-2 focus:ring-[#FF6B35] focus:border-transparent text-white placeholder-white/40"
                      placeholder="Repeat password"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-4">
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="text-white/70 hover:text-white font-bold flex items-center space-x-2"
                  >
                    <ArrowLeft className="w-5 h-5" />
                    <span>Back</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleNextStep}
                    className="bg-[#FF6B35] text-white px-8 py-3 rounded-lg hover:bg-[#FF6B35]/90 transition-all font-black flex items-center space-x-2"
                  >
                    <span>Continue</span>
                    <ArrowRight className="w-5 h-5" />
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        )}

        {/* Step 3: Restaurant Details */}
        {step === 3 && (
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="max-w-2xl mx-auto"
          >
            <div className="text-center mb-8">
              <h1 className="text-3xl font-black text-white mb-3 tracking-tight">Tell Us About Your Restaurant</h1>
              <p className="text-white/70">Just a few more details to get you started</p>
            </div>

            <div className="glass rounded-2xl shadow-xl p-8">
              <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <label htmlFor="name" className="block text-sm font-bold text-white mb-2">
                    Your Name *
                  </label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                    <input
                      id="name"
                      name="name"
                      type="text"
                      required
                      value={formData.name}
                      onChange={handleInputChange}
                      className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-lg focus:ring-2 focus:ring-[#FF6B35] focus:border-transparent text-white placeholder-white/40"
                      placeholder="John Doe"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="phone" className="block text-sm font-bold text-white mb-2">
                    Phone Number
                  </label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                    <input
                      id="phone"
                      name="phone"
                      type="tel"
                      value={formData.phone}
                      onChange={handleInputChange}
                      className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-lg focus:ring-2 focus:ring-[#FF6B35] focus:border-transparent text-white placeholder-white/40"
                      placeholder="+1 (555) 000-0000"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="restaurantName" className="block text-sm font-bold text-white mb-2">
                    Restaurant Name *
                  </label>
                  <div className="relative">
                    <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                    <input
                      id="restaurantName"
                      name="restaurantName"
                      type="text"
                      required
                      value={formData.restaurantName}
                      onChange={handleInputChange}
                      className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-lg focus:ring-2 focus:ring-[#FF6B35] focus:border-transparent text-white placeholder-white/40"
                      placeholder="My Restaurant"
                    />
                  </div>
                </div>


                {/* Selected Plan Summary */}
                <div className="glass border border-[#FF6B35]/30 rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-bold text-white/70">Selected Plan</p>
                      <p className="text-lg font-black text-[#FF6B35]">
                        {quote?.name || selectedPlan}
                      </p>
                      {quote?.billingModel === 'METERED' ? (
                        <p className="text-xs text-white/60 mt-1">
                          {money(quote.meteredRate, quote.currency)} per {quote.meteredUnit?.toLowerCase() || 'order'}
                          {Number(quote.maximumCharge) > 0
                            ? `, never more than ${money(quote.maximumCharge, quote.currency)} a month`
                            : ''}
                          {Number(quote.setupFee) > 0
                            ? ` · one-time setup ${money(quote.setupFee, quote.currency)}`
                            : ''}
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      className="text-sm text-[#FF6B35] hover:text-[#FF6B35]/80 font-bold"
                    >
                      Change
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-4">
                  <button
                    type="button"
                    onClick={() => setStep(2)}
                    className="text-white/70 hover:text-white font-bold flex items-center space-x-2"
                  >
                    <ArrowLeft className="w-5 h-5" />
                    <span>Back</span>
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="bg-[#FF6B35] text-white px-8 py-3 rounded-lg hover:bg-[#FF6B35]/90 transition-all font-black flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>Creating...</span>
                      </>
                    ) : (
                      <>
                        <span>Create Restaurant</span>
                        <CheckCircle className="w-5 h-5" />
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>

            <div className="mt-6 text-center text-xs text-white/50">
              By creating an account, you agree to our{' '}
              <span className="text-[#FF6B35]">Terms of Service</span>
              {' '}and{' '}
              <span className="text-[#FF6B35]">Privacy Policy</span>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#050505] text-white flex items-center justify-center">Loading registration…</div>}>
      <RegisterPageContent />
    </Suspense>
  );
}
