'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart3, Bike, Boxes, ChefHat, Grid2X2, MonitorSmartphone, Palette,
  QrCode, ScanLine, ShieldCheck, WifiOff, Check, ArrowRight, Star, Sparkles, Wallet, FileDown,
  MessageCircle,
} from 'lucide-react';
import apiClient from '@/lib/api';
import { DineMark } from '@/components/marketing/Brand';
import { PRODUCT_VIEWS, PosView } from '@/components/marketing/ProductViews';

/* ────────────────────────────────────────────────────────────────────────────
 * The 3D dishes that gave the product its name. Kept small and ambient — they
 * are the differentiator, not the whole hero.
 * ──────────────────────────────────────────────────────────────────────────── */
const MODELS_3D = [
  { id: 'burger', label: 'Burger', file: '/model3d/burger.glb' },
  { id: 'pizza', label: 'Pizza', file: '/model3d/pizza_free.glb' },
  { id: 'chicken', label: 'Fried chicken', file: '/model3d/krispy_fried_chicken.glb' },
];

/* The six words under the logo, and the six screens they correspond to. */
const PILLARS = ['POS', 'Kitchen', 'QR Ordering', '3D Menu', 'Inventory', 'Analytics'];

const FEATURES = [
  { icon: MonitorSmartphone, title: 'Serve the queue faster', desc: 'One till for dine-in, takeaway and delivery. Tax, discounts and split bills are handled where the customer is standing, not afterwards.' },
  { icon: ChefHat, title: 'Nothing gets lost on the way to the kitchen', desc: 'Orders appear on the kitchen screen as they are taken, with a timer on every ticket. No chits, no shouting, no forgotten table.' },
  { icon: QrCode, title: 'Turn tables without more staff', desc: 'Guests scan the code and order from their own phone. Fewer trips to the table, faster covers, no app to download.' },
  { icon: ScanLine, title: 'Sell the dish before they taste it', desc: 'Customers turn the dish in 3D and put it on their own table before ordering. Bigger tickets, fewer “what does it look like?” questions.' },
  { icon: Boxes, title: 'Stop running out mid-service', desc: 'Recipes take stock down as dishes sell, so you see what is low while there is still time to order it — and where the wastage went.' },
  { icon: BarChart3, title: 'Know your numbers before you go home', desc: 'Revenue, busiest hours, best sellers and food cost, from the same data the till writes. No spreadsheet, no guessing.' },
  { icon: Bike, title: 'Account for every delivery rupee', desc: 'Name a rider at checkout, confirm the drop with a customer code, and the cash they carry is reconciled without a notebook.' },
  { icon: Grid2X2, title: 'Open the second branch without starting over', desc: 'One account, many kitchens. Staff, stock and reporting stay scoped to the branch they belong to, and you see the group in one view.' },
  { icon: Palette, title: 'It looks like your restaurant', desc: 'The menu your guests see carries your name, your colours and your photography. Ours is nowhere on it.' },
];

const STEPS = [
  { n: '01', title: 'Sign up and pick your country', body: 'Two minutes. Your currency and rate follow from where you trade — a restaurant in Lahore is not quoted dollars.' },
  { n: '02', title: 'We set up your menu with you', body: 'Menu entry, staff accounts, printers and table QR codes. That is what the one-time setup fee pays for.' },
  { n: '03', title: 'Start taking orders', body: 'Your team trains on the till in an afternoon. Your first monthly invoice comes a month later.' },
];

const FAQS = [
  { q: 'What happens if the internet goes down?',
    a: 'Your staff keep taking orders exactly as normal, and everything goes through once the connection is back. Built in, not a paid extra.' },
  { q: 'Do I need to buy new hardware?',
    a: 'No. Dine3D runs on the Windows machines and tablets most kitchens already have, plus a standard thermal printer. There is a desktop installer for the till and a browser for everything else.' },
  { q: 'What does it cost?',
    a: 'One price a month for your plan, with no limit on how many orders you take, plus a one-time setup fee at the start. The monthly is invoiced after each month, with three days to pay.' },
  { q: 'Can I change plan later?',
    a: 'Yes, yourself, from the billing screen. Moving up applies immediately. Moving down starts at the end of your billing period, so a month you have already part-used stays on the plan you used it on.' },
  { q: 'How do I pay?',
    a: 'In Pakistan, by JazzCash — you send the transfer and submit the transaction ID, and we verify it by hand. No card required, and no international payment setup needed.' },
  { q: 'Is my data mine?',
    a: 'Yes. Every order, payment and stock movement exports to CSV whenever you want it, and your menu and branding belong to you. There is no lock-in clause.' },
];

/**
 * REAL REVIEWS ONLY.
 *
 * This renders nothing while the array is empty, and that is deliberate.
 * Invented testimonials from restaurants that do not exist are the fastest way
 * to lose the trust of the one that does — and in a market this small, an owner
 * asking around will find out. Add entries here the moment a real customer says
 * something quotable, with their permission:
 *
 *   { quote: '…', name: 'Owner name', role: 'Owner', place: 'Restaurant, City' }
 */
const REVIEWS = [];

/**
 * The four things a wary owner is actually weighing up.
 *
 * This strip used to carry engineering numbers — milliseconds per order, orders
 * per second, kilobytes synced. A restaurant owner cannot act on any of them:
 * nobody knows whether 47 ms is fast, and "on a single small server" reads as a
 * warning rather than a boast. These are the real objections instead, answered
 * in the order they get asked.
 */
const REASSURANCES = [
  { icon: WifiOff, title: 'Sells through an outage', note: 'Orders are kept on the till and go through when the line comes back.' },
  { icon: Sparkles, title: 'We set it up with you', note: 'Your menu, your staff accounts and your table codes — done together, not left as homework.' },
  { icon: Wallet, title: 'Pay by JazzCash', note: 'No card, no international payment setup. You send the transfer, a person checks it.' },
  { icon: FileDown, title: 'Your data stays yours', note: 'Every order, payment and stock movement exports to a spreadsheet whenever you want it.' },
];

const USE_CASES = [
  'FINE DINING', 'QUICK SERVICE', 'CAFÉS', 'FOOD COURTS',
  'HOTELS', 'CLOUD KITCHENS', 'RESTAURANT GROUPS', 'BAKERIES',
];

/** Only the free trial can be self-served; everything else starts with a chat. */
const isTrial = (plan) => Number(plan?.price || 0) === 0;

/**
 * A WhatsApp chat that opens already knowing which plan they tapped.
 *
 * An owner who has to explain from scratch what they were looking at usually
 * does not start the message at all.
 */
const SUPPORT_WHATSAPP = '923144704840';
const whatsappFor = (plan) => {
  const text = `Assalam o Alaikum, I would like to set up Dine3D on the ${plan?.name || ''} plan for my restaurant.`;
  return `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(text.replace('  ', ' '))}`;
};

const money = (value, currency) => {
  const n = Number(value || 0);
  return `${currency} ${n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 3 : 0 })}`;
};

function FloatingModel({ file, index }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: [0.18, 0.4, 0.18], y: [0, -22, 0], rotate: [0, 8, 0] }}
      transition={{ duration: 12, repeat: Infinity, delay: index * 3.5, ease: 'easeInOut' }}
      className="absolute hidden pointer-events-none lg:block"
      style={{
        width: 170, height: 170,
        left: index === 0 ? '3%' : index === 1 ? '84%' : '8%',
        top: index === 0 ? '18%' : index === 1 ? '26%' : '68%',
        filter: 'drop-shadow(0 25px 50px rgba(0,0,0,0.6))',
        zIndex: 0,
      }}
    >
      <model-viewer
        src={file}
        auto-rotate
        rotation-per-second="22deg"
        style={{ width: '100%', height: '100%', background: 'transparent' }}
        camera-orbit="0deg 75deg 105%"
        disable-zoom
        disable-pan
        interaction-prompt="none"
        aria-hidden="true"
      />
    </motion.div>
  );
}

export default function LandingPage() {
  const [scrolled, setScrolled] = useState(false);
  const [activeScreen, setActiveScreen] = useState('pos');
  const [openFaq, setOpenFaq] = useState(0);

  // Pricing is fetched, never hardcoded. This page used to quote $29, $79 and
  // $199 a month — numbers in no catalogue and a currency Dine3D does not bill
  // in — while the real price list said something else entirely.
  const [countries, setCountries] = useState([]);
  const [country, setCountry] = useState('PK');
  const [plans, setPlans] = useState([]);
  const [plansLoading, setPlansLoading] = useState(true);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    if (typeof window !== 'undefined' && !customElements.get('model-viewer')) {
      const script = document.createElement('script');
      script.type = 'module';
      script.src = 'https://ajax.googleapis.com/ajax/libs/model-viewer/3.5.0/model-viewer.min.js';
      document.head.appendChild(script);
    }
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiClient.get('/billing/countries')
      .then((data) => { if (!cancelled && data?.countries?.length) setCountries(data.countries); })
      .catch(() => { if (!cancelled) setCountries([{ code: 'PK', name: 'Pakistan', currency: 'PKR' }]); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPlansLoading(true);
    apiClient.get(`/billing/plans?country=${encodeURIComponent(country)}`)
      .then((data) => { if (!cancelled) setPlans(data?.plans || []); })
      .catch(() => { if (!cancelled) setPlans([]); })
      .finally(() => { if (!cancelled) setPlansLoading(false); });
    return () => { cancelled = true; };
  }, [country]);

  const view = useMemo(
    () => PRODUCT_VIEWS.find((item) => item.id === activeScreen) || PRODUCT_VIEWS[0],
    [activeScreen],
  );

  /** What a tier adds over the one below — the only part of a feature list worth the space. */
  const highlights = useCallback((plan) => {
    const paid = plans.filter((item) => item.billingModel === 'METERED');
    const index = paid.findIndex((item) => item.key === plan.key);
    const below = index > 0 ? paid[index - 1] : null;
    const own = plan.features || [];
    if (!below) return { inherits: null, items: own };
    const had = new Set((below.features || []).map((f) => f.key));
    const added = own.filter((f) => !had.has(f.key));
    return { inherits: below.name, items: added.length ? added : own };
  }, [plans]);

  return (
    <div className="min-h-screen bg-[#050505] text-white selection:bg-orange-500/30 selection:text-orange-200 overflow-x-hidden">
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@200;400;500;600;800&display=swap');
        body { font-family: 'Plus Jakarta Sans', sans-serif; background: #050505; }
        .glass { background: rgba(255,255,255,0.04); backdrop-filter: blur(16px); border: 1px solid rgba(255,255,255,0.1); }
        .text-gradient { background: linear-gradient(to right, #fff, #b9b9b9); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .orange-gradient { background: linear-gradient(135deg, #FF6B35, #F7C948); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .marquee { animation: marquee 38s linear infinite; }
        @keyframes marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        ::-webkit-scrollbar { width: 0px; }
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after { scroll-behavior: auto !important; animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
          .marquee { animation: none !important; }
        }
      `}</style>

      {/* ── NAV ───────────────────────────────────────────────────────── */}
      <nav className={`fixed top-0 left-0 right-0 z-[100] transition-all duration-500 ${scrolled ? 'py-2' : 'py-5'}`}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className={`flex items-center justify-between px-4 sm:px-5 py-2 rounded-xl transition-all duration-500 ${scrolled ? 'glass shadow-2xl saturate-150' : ''}`}>
            <div className="flex items-center gap-4 sm:gap-8">
              <Link href="/" className="text-xl md:text-2xl font-extrabold tracking-tighter flex items-center gap-2 group">
                <DineMark className="h-8 w-8 md:h-9 md:w-9 transition-transform group-hover:rotate-6" title="Dine3D" />
                <span className="text-white">Dine3D</span>
              </Link>
              <div className="hidden md:flex items-center gap-7 text-[10px] font-bold tracking-[0.16em] text-white/60">
                <a href="#product" className="hover:text-white transition-colors">PRODUCT</a>
                <a href="#features" className="hover:text-white transition-colors">FEATURES</a>
                <a href="#offline" className="hover:text-white transition-colors">OFFLINE</a>
                <a href="#pricing" className="hover:text-white transition-colors">PRICING</a>
                <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
              </div>
            </div>
            <div className="flex items-center gap-4 md:gap-6">
              <Link href="/admin/login" className="text-[11px] font-black tracking-widest text-white/70 hover:text-white transition-colors uppercase">SIGN IN</Link>
              <Link href="/register" className="bg-white text-black text-[11px] font-black px-4 py-2.5 rounded-lg hover:bg-orange-500 hover:text-white transition-all shadow-lg active:scale-95 leading-none">
                START FREE
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* ── HERO ──────────────────────────────────────────────────────── */}
      <section className="relative flex flex-col items-center justify-center px-5 pt-32 pb-16 overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(255,107,53,0.16),transparent_70%)]" />
        {MODELS_3D.map((model, index) => (
          <FloatingModel key={model.id} file={model.file} index={index} />
        ))}

        <div className="relative z-10 max-w-4xl mx-auto text-center">
          {/* The name block. This is the first thing anyone should read. */}
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="flex flex-col items-center gap-4"
          >
            <h1 className="text-[clamp(3.2rem,11vw,7rem)] font-extrabold tracking-tighter leading-[0.9] text-gradient">
              Dine3D
            </h1>
            <p className="text-[clamp(1.05rem,3.2vw,1.9rem)] font-semibold tracking-tight text-white/85">
              Restaurant Operating System
            </p>
            <div className="mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
              {PILLARS.map((pillar, index) => (
                <span key={pillar} className="flex items-center gap-3">
                  <span className="text-[11px] sm:text-[13px] font-bold uppercase tracking-[0.18em] text-white/55">
                    {pillar}
                  </span>
                  {/* The separators wrap onto a new line on a narrow screen and
                      leave a dangling dot. The words read fine spaced apart, so
                      the dots only appear once they all fit on one line. */}
                  {index < PILLARS.length - 1 ? (
                    <span aria-hidden className="hidden sm:inline text-orange-500/70 text-[13px]">·</span>
                  ) : null}
                </span>
              ))}
            </div>
          </motion.div>

          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.12 }}
            className="mt-8 mx-auto max-w-2xl text-base sm:text-lg leading-relaxed text-white/60"
          >
            Take orders faster, stop losing them to the kitchen, and know what you made
            before you lock up. It keeps selling when the internet goes down.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3"
          >
            <Link
              href="/register"
              className="group inline-flex items-center gap-2 rounded-xl bg-[#FF6B35] px-7 py-4 text-sm font-black text-white shadow-[0_20px_40px_-12px_rgba(255,107,53,0.6)] transition hover:bg-[#ff7d4d] active:scale-95"
            >
              Start free trial
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <a
              href="#product"
              className="inline-flex items-center gap-2 rounded-xl glass px-7 py-4 text-sm font-bold text-white/80 transition hover:text-white"
            >
              See it working
            </a>
          </motion.div>

          <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/35">
            3-day free trial · No card required · Set up with you
          </p>
        </div>
      </section>

      {/* ── PRODUCT ───────────────────────────────────────────────────── */}
      <section id="product" className="relative z-10 px-4 sm:px-6 py-14 md:py-20">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 max-w-2xl">
            <p className="mb-3 text-[10px] font-black uppercase tracking-[0.28em] text-orange-400">See it working</p>
            <h2 className="text-3xl font-black tracking-tight text-white sm:text-4xl">
              One system, from the front door to the books.
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-white/60 sm:text-base">
              The till, the kitchen, the stockroom and the delivery bikes all writing to the
              same place — so the numbers agree at the end of the night.
            </p>
          </div>

          <div className="mb-5 flex flex-wrap gap-2">
            {PRODUCT_VIEWS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveScreen(item.id)}
                aria-pressed={activeScreen === item.id}
                className={`rounded-lg px-3.5 py-2 text-[11px] font-black uppercase tracking-[0.12em] transition ${
                  activeScreen === item.id
                    ? 'bg-[#FF6B35] text-white shadow-[0_10px_25px_-10px_rgba(255,107,53,0.9)]'
                    : 'glass text-white/60 hover:text-white'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="grid items-start gap-8 lg:grid-cols-[1fr_minmax(0,1.25fr)]">
            <AnimatePresence mode="wait">
              <motion.div
                key={`${view.id}-copy`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.22 }}
              >
                <h3 className="text-2xl font-black leading-tight tracking-tight text-white sm:text-3xl">
                  {view.headline}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-white/60 sm:text-base">{view.caption}</p>
              </motion.div>
            </AnimatePresence>

            <AnimatePresence mode="wait">
              <motion.div
                key={view.id}
                initial={{ opacity: 0, scale: 0.985 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.985 }}
                transition={{ duration: 0.25 }}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-2 sm:p-3"
              >
                <view.Component />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </section>

      {/* ── REASSURANCES ──────────────────────────────────────────────── */}
      <section className="relative z-10 border-y border-white/5 bg-black/30 px-4 sm:px-6 py-12">
        <div className="mx-auto grid max-w-6xl gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {REASSURANCES.map((item) => (
            <div key={item.title} className="flex flex-col gap-2">
              <item.icon className="h-5 w-5 text-orange-400" strokeWidth={1.8} />
              <p className="text-sm font-extrabold tracking-tight text-white">{item.title}</p>
              <p className="text-xs leading-relaxed text-white/50">{item.note}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── FEATURES ──────────────────────────────────────────────────── */}
      <section id="features" className="relative z-10 px-4 sm:px-6 py-14 md:py-20">
        <div className="mx-auto max-w-6xl">
          <div className="mb-9 max-w-2xl">
            <p className="mb-3 text-[10px] font-black uppercase tracking-[0.28em] text-orange-400">One connected workspace</p>
            <h2 className="text-3xl font-black tracking-tight text-white sm:text-4xl">
              What changes on your floor.
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-white/60 sm:text-base">
              Not a list of features — the things your staff and your accountant will notice in the first week.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="group rounded-2xl glass p-6 transition hover:border-orange-500/30">
                <feature.icon className="mb-4 h-6 w-6 text-orange-400" strokeWidth={1.8} />
                <h3 className="mb-2 text-lg font-extrabold tracking-tight text-white">{feature.title}</h3>
                <p className="text-sm leading-relaxed text-white/55">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── OFFLINE ───────────────────────────────────────────────────── */}
      <section id="offline" className="relative z-10 px-4 sm:px-6 py-14 md:py-20 bg-[#080808]">
        <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2">
          <div>
            <p className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.28em] text-orange-400">
              <WifiOff className="h-3.5 w-3.5" /> Built for a real connection
            </p>
            <h2 className="text-3xl font-black tracking-tight text-white sm:text-4xl lg:text-[2.75rem] lg:leading-[1.05]">
              The till does not stop when the internet does.
            </h2>
            <p className="mt-5 text-sm leading-relaxed text-white/60 sm:text-base">
              Every order is saved inside your own restaurant the moment it is taken, and
              goes through in the order it happened once the line is back.
            </p>
            <ul className="mt-6 space-y-3">
              {[
                'Keep taking orders through an outage, on every till at once',
                'Tills and kitchen screens stay in step with each other, internet or not',
                'Nothing lost, nothing rung up twice',
              ].map((line) => (
                <li key={line} className="flex items-start gap-3 text-sm text-white/70">
                  <ShieldCheck className="mt-0.5 h-4 w-4 flex-none text-orange-400" strokeWidth={2} />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-2 sm:p-3">
            <PosView />
            <p className="px-2 pb-1 pt-3 text-xs text-white/40">
              The till during an outage. It looks and behaves exactly as it does online —
              that is the point.
            </p>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ──────────────────────────────────────────────── */}
      <section className="relative z-10 px-4 sm:px-6 py-14 md:py-20">
        <div className="mx-auto max-w-6xl">
          <div className="mb-9 max-w-2xl">
            <p className="mb-3 text-[10px] font-black uppercase tracking-[0.28em] text-orange-400">Getting started</p>
            <h2 className="text-3xl font-black tracking-tight text-white sm:text-4xl">
              Taking orders this week.
            </h2>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {STEPS.map((step) => (
              <div key={step.n} className="rounded-2xl glass p-6">
                <span className="text-[11px] font-black tracking-[0.2em] text-orange-400">{step.n}</span>
                <h3 className="mt-3 text-lg font-extrabold tracking-tight text-white">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/55">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRICING ───────────────────────────────────────────────────── */}
      <section id="pricing" className="relative z-10 px-4 sm:px-6 py-14 md:py-20 bg-[#0a0a0a]">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-xl">
              <p className="mb-3 text-[10px] font-black uppercase tracking-[0.28em] text-orange-400">Pricing</p>
              <h2 className="text-3xl font-black tracking-tight text-white sm:text-4xl">
                One price a month. Unlimited orders.
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-white/60 sm:text-base">
                Plus a one-time setup fee that covers getting you running.
              </p>
            </div>
            <div className="lg:min-w-[260px]">
              <label htmlFor="pricing-country" className="mb-2 block text-[10px] font-black uppercase tracking-[0.2em] text-white/40">
                Prices for
              </label>
              <select
                id="pricing-country"
                value={country}
                onChange={(event) => setCountry(event.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-white focus:border-transparent focus:ring-2 focus:ring-orange-500"
              >
                {countries.map((item) => (
                  <option key={item.code} value={item.code} className="bg-[#0a0a0a]">
                    {item.name} ({item.currency})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {plansLoading ? (
            <p className="py-12 text-center text-sm text-white/40">Loading prices…</p>
          ) : plans.length === 0 ? (
            <p className="py-12 text-center text-sm text-white/40">
              Prices are not loading just now — <a className="text-orange-400 underline" href="#contact">get in touch</a> and we will quote you directly.
            </p>
          ) : (
            <div className={`grid gap-4 md:grid-cols-2 ${plans.length >= 4 ? 'xl:grid-cols-4' : 'lg:grid-cols-3'}`}>
              {plans.map((plan) => {
                const metered = plan.billingModel === 'METERED';
                const { inherits, items } = highlights(plan);
                return (
                  <div
                    key={plan.key}
                    className={`relative flex flex-col rounded-2xl p-6 transition ${
                      plan.isRecommended
                        ? 'border-2 border-[#FF6B35] bg-white/[0.045] shadow-[0_0_60px_-25px_rgba(255,107,53,0.8)]'
                        : 'glass'
                    }`}
                  >
                    {plan.isRecommended ? (
                      <span className="absolute -top-3 left-6 rounded-full bg-[#FF6B35] px-3 py-1 text-[10px] font-black uppercase tracking-wider text-white">
                        Most popular
                      </span>
                    ) : null}

                    <h3 className="text-lg font-extrabold tracking-tight text-white">{plan.name}</h3>
                    <p className="mt-1 min-h-[2.75rem] text-xs leading-relaxed text-white/45">{plan.description}</p>

                    <div className="mt-4">
                      {/* Three cases, not two. This branched on metered-or-not
                          back when the trial was the only plan that was not
                          metered — so once the monthly ladder went on sale,
                          Starter, Professional and Enterprise all fell into the
                          else and advertised themselves as free. */}
                      {metered ? (
                        <>
                          <span className="text-3xl font-black tracking-tight text-white">
                            {money(plan.meteredRate, plan.currency)}
                          </span>
                          <span className="ml-1 text-sm text-white/50">per order</span>
                        </>
                      ) : Number(plan.price) > 0 ? (
                        <>
                          <span className="text-3xl font-black tracking-tight text-white">
                            {money(plan.price, plan.currency)}
                          </span>
                          <span className="ml-1 text-sm text-white/50">a month</span>
                        </>
                      ) : (
                        <>
                          <span className="text-3xl font-black tracking-tight text-white">Free</span>
                          {plan.trialDurationDays ? (
                            <span className="ml-1 text-sm text-white/50">{plan.trialDurationDays} days</span>
                          ) : null}
                        </>
                      )}
                    </div>

                    {Number(plan.setupFee) > 0 ? (
                      <p className="mt-2 text-xs text-white/45">
                        plus {money(plan.setupFee, plan.currency)} one-time setup
                      </p>
                    ) : null}

                    {/* What a chain's next kitchen costs, before it has to ask. */}
                    {plan.includedBranches && Number(plan.additionalBranchFee) > 0 ? (
                      <p className="mt-1 text-xs text-white/45">
                        {plan.includedBranches} branches included · {money(plan.additionalBranchFee, plan.currency)} per extra branch
                      </p>
                    ) : null}

                    {metered && Number(plan.maximumCharge) > 0 ? (
                      <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2.5">
                        <p className="text-xs font-bold text-white/85">
                          Never more than {money(plan.maximumCharge, plan.currency)} a month
                        </p>
                        <p className="mt-0.5 text-[11px] text-white/40">
                          Minimum {money(plan.minimumCharge, plan.currency)} · setup {money(plan.setupFee, plan.currency)}
                        </p>
                      </div>
                    ) : null}

                    <div className="mt-5 flex-1">
                      {inherits ? (
                        <p className="mb-2 text-[11px] font-bold text-white/40">Everything in {inherits}, plus</p>
                      ) : null}
                      <ul className="space-y-2">
                        {items.slice(0, 5).map((feature) => (
                          <li key={feature.key} className="flex items-start gap-2 text-sm text-white/65">
                            <Check className="mt-0.5 h-3.5 w-3.5 flex-none text-orange-400" strokeWidth={3} />
                            <span>{feature.name}</span>
                          </li>
                        ))}
                        {items.length > 5 ? (
                          <li className="pl-[1.375rem] text-xs text-white/35">+ {items.length - 5} more</li>
                        ) : null}
                      </ul>
                    </div>

                    {/* The trial is the only thing anyone signs themselves up for.
                        A paid plan depends on how busy they are and how many tills
                        they run, the setup fee is agreed in that conversation, and
                        the money arrives by JazzCash rather than a checkout — so the
                        button opens one instead of pretending otherwise. */}
                    {isTrial(plan) ? (
                      <Link
                        href="/register"
                        className="mt-6 block rounded-lg bg-white/10 px-4 py-3 text-center text-sm font-black text-white transition hover:bg-white/20 active:scale-95"
                      >
                        Start free
                      </Link>
                    ) : (
                      <a
                        href={whatsappFor(plan)}
                        target="_blank"
                        rel="noreferrer"
                        className={`mt-6 flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-center text-sm font-black transition active:scale-95 ${
                          plan.isRecommended
                            ? 'bg-[#FF6B35] text-white hover:bg-[#ff7d4d]'
                            : 'bg-white/10 text-white hover:bg-white/20'
                        }`}
                      >
                        <MessageCircle className="h-4 w-4" />
                        Talk to us
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <p className="mt-6 text-xs leading-relaxed text-white/40">
            Start the trial yourself. For a paid plan we talk first, agree the right size for
            your restaurant, and set it up with you. In Pakistan you pay by JazzCash — no card needed.
          </p>
        </div>
      </section>

      {/* ── REVIEWS ───────────────────────────────────────────────────── */}
      {REVIEWS.length > 0 ? (
        <section className="relative z-10 px-4 sm:px-6 py-14 md:py-20">
          <div className="mx-auto max-w-6xl">
            <div className="mb-9 max-w-2xl">
              <p className="mb-3 text-[10px] font-black uppercase tracking-[0.28em] text-orange-400">From the floor</p>
              <h2 className="text-3xl font-black tracking-tight text-white sm:text-4xl">
                What restaurants say.
              </h2>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {REVIEWS.map((review) => (
                <figure key={review.name} className="flex flex-col rounded-2xl glass p-6">
                  <div className="mb-3 flex gap-0.5" aria-label="Five out of five">
                    {[0, 1, 2, 3, 4].map((star) => (
                      <Star key={star} className="h-3.5 w-3.5 fill-orange-400 text-orange-400" />
                    ))}
                  </div>
                  <blockquote className="flex-1 text-sm leading-relaxed text-white/75">“{review.quote}”</blockquote>
                  <figcaption className="mt-4 border-t border-white/10 pt-4">
                    <p className="text-sm font-bold text-white">{review.name}</p>
                    <p className="text-xs text-white/45">{review.role} · {review.place}</p>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* ── USE CASES ─────────────────────────────────────────────────── */}
      <section aria-label="Restaurant types" className="relative z-10 overflow-hidden border-y border-white/5 bg-black/20 py-9">
        <div className="flex w-max marquee gap-10 px-6">
          {[...USE_CASES, ...USE_CASES].map((item, index) => (
            <span key={`${item}-${index}`} className="whitespace-nowrap text-[11px] font-black tracking-[0.3em] text-white/25">
              {item}
            </span>
          ))}
        </div>
      </section>

      {/* ── FAQ ───────────────────────────────────────────────────────── */}
      <section id="faq" className="relative z-10 px-4 sm:px-6 py-14 md:py-20">
        <div className="mx-auto max-w-3xl">
          <div className="mb-9">
            <p className="mb-3 text-[10px] font-black uppercase tracking-[0.28em] text-orange-400">Before you ask</p>
            <h2 className="text-3xl font-black tracking-tight text-white sm:text-4xl">Questions restaurants actually ask.</h2>
          </div>
          <div className="divide-y divide-white/10 border-y border-white/10">
            {FAQS.map((faq, index) => {
              const open = openFaq === index;
              return (
                <div key={faq.q}>
                  <button
                    type="button"
                    onClick={() => setOpenFaq(open ? -1 : index)}
                    aria-expanded={open}
                    className="flex w-full items-center justify-between gap-4 py-5 text-left"
                  >
                    <span className="text-sm font-bold text-white sm:text-base">{faq.q}</span>
                    <span className={`flex-none text-lg text-orange-400 transition-transform ${open ? 'rotate-45' : ''}`} aria-hidden>+</span>
                  </button>
                  <AnimatePresence initial={false}>
                    {open ? (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.22 }}
                        className="overflow-hidden"
                      >
                        <p className="pb-5 pr-8 text-sm leading-relaxed text-white/60">{faq.a}</p>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ─────────────────────────────────────────────────── */}
      <section id="contact" className="relative z-10 px-4 sm:px-6 py-16 md:py-24">
        <div className="mx-auto max-w-4xl rounded-3xl border border-white/10 bg-[radial-gradient(70%_100%_at_50%_0%,rgba(255,107,53,0.18),transparent_70%)] px-6 py-14 text-center sm:px-12">
          <h2 className="text-3xl font-black leading-[1.05] tracking-tight text-white sm:text-4xl md:text-5xl">
            Run the whole restaurant from one screen.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-white/60 sm:text-base">
            Start on a 3-day trial with a demo menu already loaded. When you go live we set
            up your menu, staff and table codes with you.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/register"
              className="group inline-flex items-center gap-2 rounded-xl bg-[#FF6B35] px-8 py-4 text-sm font-black text-white shadow-[0_20px_40px_-12px_rgba(255,107,53,0.6)] transition hover:bg-[#ff7d4d] active:scale-95"
            >
              Start free trial
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <a
              href="https://wa.me/923144704840"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-xl glass px-8 py-4 text-sm font-bold text-white/80 transition hover:text-white"
            >
              Talk to us on WhatsApp
            </a>
          </div>
        </div>
      </section>

      {/* ── FOOTER ────────────────────────────────────────────────────── */}
      <footer className="relative z-10 border-t border-white/5 px-4 sm:px-6 py-12">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
            <div>
              <div className="flex items-center gap-2 text-xl font-extrabold tracking-tighter">
                <DineMark className="h-8 w-8" title="Dine3D" />
                <span className="text-white">Dine3D</span>
              </div>
              <p className="mt-3 max-w-xs text-sm leading-relaxed text-white/45">
                The restaurant operating system — POS, kitchen, QR ordering, 3D menu,
                inventory and analytics in one place.
              </p>
            </div>

            <div>
              <p className="mb-3 text-[10px] font-black uppercase tracking-[0.2em] text-white/35">Product</p>
              <ul className="space-y-2 text-sm">
                <li><a href="#product" className="text-white/55 transition hover:text-white">Screens</a></li>
                <li><a href="#features" className="text-white/55 transition hover:text-white">Features</a></li>
                <li><a href="#offline" className="text-white/55 transition hover:text-white">Offline</a></li>
                <li><a href="#pricing" className="text-white/55 transition hover:text-white">Pricing</a></li>
              </ul>
            </div>

            <div>
              <p className="mb-3 text-[10px] font-black uppercase tracking-[0.2em] text-white/35">Account</p>
              <ul className="space-y-2 text-sm">
                <li><Link href="/register" className="text-white/55 transition hover:text-white">Start free</Link></li>
                <li><Link href="/admin/login" className="text-white/55 transition hover:text-white">Sign in</Link></li>
                <li><a href="#faq" className="text-white/55 transition hover:text-white">FAQ</a></li>
              </ul>
            </div>

            <div>
              <p className="mb-3 text-[10px] font-black uppercase tracking-[0.2em] text-white/35">Talk to us</p>
              <ul className="space-y-2 text-sm">
                <li><a href="https://wa.me/923144704840" target="_blank" rel="noreferrer" className="text-white/55 transition hover:text-white">WhatsApp 0314 4704840</a></li>
                <li><a href="mailto:support@dine3d.pk" className="text-white/55 transition hover:text-white">support@dine3d.pk</a></li>
              </ul>
            </div>
          </div>

          <div className="mt-10 flex flex-col gap-2 border-t border-white/5 pt-6 text-xs text-white/35 sm:flex-row sm:items-center sm:justify-between">
            <p>© {new Date().getFullYear()} Dine3D. All rights reserved.</p>
            <p>POS · Kitchen · QR Ordering · 3D Menu · Inventory · Analytics</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
