'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from 'recharts';

const CURRENCY_SYMBOLS = { USD: '$', EUR: '€', GBP: '£', PKR: 'Rs.', AED: 'د.إ', SAR: 'ر.س', INR: '₹' };

const METRIC_STYLES = {
  primary: {
    accent: 'linear-gradient(135deg, rgba(255,107,53,0.08) 0%, rgba(255,250,246,0.96) 38%, rgba(255,255,255,1) 100%)',
    iconBg: 'rgba(255,107,53,0.10)',
    iconColor: '#C2410C',
    border: 'rgba(255,107,53,0.14)',
  },
  success: {
    accent: 'linear-gradient(135deg, rgba(16,185,129,0.08) 0%, rgba(244,253,248,0.96) 38%, rgba(255,255,255,1) 100%)',
    iconBg: 'rgba(16,185,129,0.10)',
    iconColor: '#047857',
    border: 'rgba(16,185,129,0.14)',
  },
  warning: {
    accent: 'linear-gradient(135deg, rgba(245,158,11,0.08) 0%, rgba(255,252,245,0.96) 38%, rgba(255,255,255,1) 100%)',
    iconBg: 'rgba(245,158,11,0.10)',
    iconColor: '#B45309',
    border: 'rgba(245,158,11,0.15)',
  },
  info: {
    accent: 'linear-gradient(135deg, rgba(14,116,144,0.08) 0%, rgba(245,251,252,0.96) 38%, rgba(255,255,255,1) 100%)',
    iconBg: 'rgba(14,116,144,0.10)',
    iconColor: '#0F766E',
    border: 'rgba(14,116,144,0.14)',
  },
  neutral: {
    accent: 'linear-gradient(135deg, rgba(148,163,184,0.08) 0%, rgba(248,250,252,0.96) 38%, rgba(255,255,255,1) 100%)',
    iconBg: 'rgba(148,163,184,0.10)',
    iconColor: '#475569',
    border: 'rgba(148,163,184,0.14)',
  },
};

const DASHBOARD_SHELL = 'rounded-[26px] border border-slate-200/80 bg-white shadow-[0_16px_40px_-24px_rgba(15,23,42,0.28)]';
const DASHBOARD_SOFT_PANEL = 'rounded-[22px] border border-slate-200/80 bg-slate-50/85';

const ORDER_STATUS_CLASS = {
  CREATED: 'badge-pending',
  PENDING: 'badge-pending',
  CONFIRMED: 'badge-confirmed',
  PREPARING: 'badge-preparing',
  READY: 'badge-ready',
  COMPLETED: 'badge-completed',
  CANCELLED: 'badge-cancelled',
};

const LIST_RANGE_OPTIONS = [
  { value: 'TODAY', label: 'Today' },
  { value: 'WEEK', label: 'This Week' },
  { value: 'MONTH', label: '30 Days' },
  { value: 'ALL', label: 'All' },
];

function cx(...classes) {
  return classes.filter(Boolean).join(' ');
}

function getRangeStart(range) {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  if (range === 'TODAY') return start;

  if (range === 'WEEK') {
    const day = start.getDay();
    const diff = day === 0 ? 6 : day - 1;
    start.setDate(start.getDate() - diff);
    return start;
  }

  if (range === 'MONTH') {
    start.setDate(start.getDate() - 29);
    return start;
  }

  return null;
}

function filterItemsByDate(items, range, key = 'createdAt') {
  if (range === 'ALL') return items;
  const start = getRangeStart(range);
  if (!start) return items;

  return items.filter((item) => {
    const timestamp = item?.[key];
    if (!timestamp) return false;
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return false;
    return date >= start;
  });
}

function DashboardIcon({ name, className = 'h-5 w-5' }) {
  const baseProps = {
    className,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  };

  switch (name) {
    case 'revenue':
      return (
        <svg {...baseProps}>
          <path d="M4 7h16v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
          <path d="M4 9h16" />
          <path d="M8 14h3" />
          <path d="M14 14h2" />
        </svg>
      );
    case 'orders':
      return (
        <svg {...baseProps}>
          <path d="M7 4h10v16l-2-1.5L13 20l-2-1.5L9 20l-2-1.5L5 20V6a2 2 0 0 1 2-2Z" />
          <path d="M9 9h6" />
          <path d="M9 13h6" />
        </svg>
      );
    case 'clock':
      return (
        <svg {...baseProps}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 8v4l3 2" />
        </svg>
      );
    case 'spark':
      return (
        <svg {...baseProps}>
          <path d="m12 3 1.6 4.8L18 9.4l-4.4 1.6L12 16l-1.6-5L6 9.4l4.4-1.6Z" />
        </svg>
      );
    case 'menu':
      return (
        <svg {...baseProps}>
          <path d="M7 6h13" />
          <path d="M7 12h13" />
          <path d="M7 18h13" />
          <path d="M3 6h.01" />
          <path d="M3 12h.01" />
          <path d="M3 18h.01" />
        </svg>
      );
    case 'table':
      return (
        <svg {...baseProps}>
          <path d="M4 9h16" />
          <path d="M6 9v8" />
          <path d="M18 9v8" />
          <path d="M10 9V5h4v4" />
          <path d="M8 17h8" />
        </svg>
      );
    case 'staff':
      return (
        <svg {...baseProps}>
          <circle cx="9" cy="8" r="3" />
          <path d="M4 19a5 5 0 0 1 10 0" />
          <circle cx="17" cy="9" r="2.5" />
          <path d="M15 19a4 4 0 0 1 5 0" />
        </svg>
      );
    case 'category':
      return (
        <svg {...baseProps}>
          <path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
        </svg>
      );
    case 'store':
      return (
        <svg {...baseProps}>
          <path d="M4 10h16" />
          <path d="M6 10v8" />
          <path d="M18 10v8" />
          <path d="M3 10 5 5h14l2 5" />
          <path d="M9 18v-4h6v4" />
        </svg>
      );
    case 'live':
      return (
        <svg {...baseProps}>
          <path d="M5 12a7 7 0 0 1 14 0" />
          <path d="M8 12a4 4 0 0 1 8 0" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'external':
      return (
        <svg {...baseProps}>
          <path d="M14 5h5v5" />
          <path d="m10 14 9-9" />
          <path d="M19 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4" />
        </svg>
      );
    case 'arrowRight':
      return (
        <svg {...baseProps}>
          <path d="M5 12h14" />
          <path d="m13 6 6 6-6 6" />
        </svg>
      );
    case 'activityAdd':
      return (
        <svg {...baseProps}>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
      );
    case 'activityDelete':
      return (
        <svg {...baseProps}>
          <path d="M5 12h14" />
        </svg>
      );
    default:
      return (
        <svg {...baseProps}>
          <path d="M12 6v6l4 2" />
          <circle cx="12" cy="12" r="8.5" />
        </svg>
      );
  }
}

function MetricCard({ icon, label, value, hint, tone = 'neutral', eyebrow, delay = '0ms' }) {
  const style = METRIC_STYLES[tone] || METRIC_STYLES.neutral;

  return (
    <div
      className={cx(
        DASHBOARD_SHELL,
        'animate-in relative overflow-hidden p-4 transition duration-[220ms] hover:-translate-y-[1px] hover:shadow-[0_22px_42px_-28px_rgba(15,23,42,0.32)]'
      )}
      style={{ background: style.accent, borderColor: style.border, animationDelay: delay }}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-white/80" />
      <div className="flex items-start justify-between gap-3">
        <div
          className="flex h-11 w-11 items-center justify-center rounded-[18px] ring-1 ring-white/70"
          style={{ background: style.iconBg, color: style.iconColor }}
        >
          <DashboardIcon name={icon} className="h-5 w-5" />
        </div>
        {eyebrow ? (
          <span className="rounded-full border border-slate-200/80 bg-white/88 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-600 shadow-[var(--shadow-xs)]">
            {eyebrow}
          </span>
        ) : null}
      </div>
      <div className="mt-6 text-[30px] font-extrabold leading-none tracking-[-0.04em] text-slate-900">
        {value}
      </div>
      <div className="mt-2 text-sm font-semibold text-slate-700">{label}</div>
      <div className="mt-1 text-[12px] leading-5 text-slate-500">{hint}</div>
    </div>
  );
}

function MiniInsightCard({ label, value, note, icon, tone = 'neutral' }) {
  const style = METRIC_STYLES[tone] || METRIC_STYLES.neutral;

  return (
    <div className={cx(DASHBOARD_SOFT_PANEL, 'p-4 shadow-[var(--shadow-xs)]')}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">{label}</p>
          <div className="mt-2 text-lg font-extrabold tracking-[-0.03em] text-slate-900">{value}</div>
          <p className="mt-1 text-[12px] leading-5 text-slate-500">{note}</p>
        </div>
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[18px] ring-1 ring-white"
          style={{ background: style.iconBg, color: style.iconColor }}
        >
          <DashboardIcon name={icon} className="h-[18px] w-[18px]" />
        </div>
      </div>
    </div>
  );
}

/**
 * Capacity against a plan limit.
 *
 * A plan with no ceiling arrives here as Infinity, 0, null or undefined
 * depending on where it came from. All of those used to fall into the same
 * branch, which drew a hard-coded 14% bar and printed "3 / 0" — reading, to an
 * owner, as though they had already blown past an allowance of zero. An
 * unlimited plan now says so, and the bar shows the count rather than inventing
 * a proportion there is no denominator for.
 */
function UsageBar({ label, current, max, icon }) {
  const safeCurrent = Math.max(0, Number(current || 0));
  const numericMax = Number(max);
  const unlimited = max === Infinity || !Number.isFinite(numericMax) || numericMax <= 0;
  const percentage = unlimited ? 100 : Math.min(100, (safeCurrent / numericMax) * 100);
  const nearLimit = !unlimited && percentage >= 85;
  const atLimit = !unlimited && safeCurrent >= numericMax;

  return (
    <div className={cx(DASHBOARD_SOFT_PANEL, 'p-4')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">{label}</p>
          <p className="mt-1 text-[12px] text-slate-500">
            {unlimited ? 'No limit on your current plan.' : 'Allocated capacity in your current plan.'}
          </p>
        </div>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[16px] bg-white text-slate-600 ring-1 ring-slate-200/80">
          <DashboardIcon name={icon} className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 text-[12px] font-semibold">
        <span className={nearLimit ? 'text-rose-600' : 'text-slate-600'}>
          {unlimited
            ? `${safeCurrent.toLocaleString()} in use`
            : `${safeCurrent.toLocaleString()} / ${numericMax.toLocaleString()}`}
        </span>
        <span className={nearLimit ? 'text-rose-600' : 'text-slate-400'}>
          {unlimited ? 'Unlimited' : atLimit ? 'Limit reached' : `${Math.round(percentage)}% used`}
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white ring-1 ring-slate-200/80">
        <div
          className={cx(
            'h-full rounded-full transition-all duration-500',
            unlimited ? 'bg-slate-200' : nearLimit ? 'bg-rose-500' : 'bg-[var(--color-primary)]',
          )}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

function ChartCard({ eyebrow, title, badge, children, delay = '0ms' }) {
  return (
    <section className={cx(DASHBOARD_SHELL, 'animate-in overflow-hidden')} style={{ animationDelay: delay }}>
      <div className="flex items-center justify-between border-b border-slate-200/80 bg-[linear-gradient(180deg,#ffffff_0%,#fbfbfc_100%)] px-5 py-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">{eyebrow}</p>
          <h3 className="mt-1 text-lg font-bold tracking-[-0.02em] text-slate-900">{title}</h3>
        </div>
        {badge ? <span className="badge badge-neutral">{badge}</span> : null}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function RangeFilterChips({ value, onChange }) {
  return (
    <div className="inline-flex flex-wrap items-center gap-1 rounded-2xl border border-slate-200/80 bg-slate-50/90 p-1 shadow-[var(--shadow-xs)]">
      {LIST_RANGE_OPTIONS.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={cx(
            'rounded-xl px-2.5 py-1.5 text-[11px] font-semibold transition',
            value === option.value
              ? 'bg-white text-slate-900 shadow-[0_6px_16px_-12px_rgba(15,23,42,0.24)]'
              : 'text-slate-500 hover:text-slate-700'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function SectionEmptyState({ icon, title, message }) {
  return (
    <div className={cx(DASHBOARD_SOFT_PANEL, 'flex h-[320px] flex-col items-center justify-center border-dashed px-6 text-center')}>
      <div className="flex h-12 w-12 items-center justify-center rounded-[18px] bg-white text-slate-500 shadow-[var(--shadow-xs)] ring-1 ring-slate-200/80">
        <DashboardIcon name={icon} className="h-5 w-5" />
      </div>
      <h4 className="mt-4 text-base font-bold text-slate-900">{title}</h4>
      <p className="mt-1 max-w-sm text-sm text-slate-500">{message}</p>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [stats, setStats] = useState(null);
  const [recentOrders, setRecentOrders] = useState([]);
  const [activity, setActivity] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [salesReport, setSalesReport] = useState(null);
  const [inventoryReport, setInventoryReport] = useState(null);
  const [staffPerformance, setStaffPerformance] = useState([]);
  const [itemPerformance, setItemPerformance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [restaurantId, setRestaurantId] = useState(null);
  const [restaurant, setRestaurant] = useState(null);
  const [currency, setCurrency] = useState('PKR');
  const [ordersRange, setOrdersRange] = useState('WEEK');
  const [activityRange, setActivityRange] = useState('WEEK');

  const { on } = useSocket({ restaurantId });

  useEffect(() => {
    let cancelled = false;

    const bootstrapDashboard = async () => {
      try {
        const saved = localStorage.getItem('dine3d_restaurant');

        if (saved) {
          const parsedRestaurant = JSON.parse(saved);
          if (!cancelled) {
            setRestaurant(parsedRestaurant);
            setRestaurantId(parsedRestaurant.id);
            setCurrency(parsedRestaurant.currency || 'PKR');
          }
          await loadData();
          return;
        }

        const session = await api.getMe();
        if (!session?.restaurant) {
          router.push('/admin/login');
          return;
        }

        localStorage.setItem('dine3d_restaurant', JSON.stringify(session.restaurant));
        localStorage.setItem('dine3d_admin_active', 'true');

        if (!cancelled) {
          setRestaurant(session.restaurant);
          setRestaurantId(session.restaurant.id);
          setCurrency(session.restaurant.currency || 'PKR');
        }

        await loadData();
      } catch {
        localStorage.removeItem('dine3d_restaurant');
        localStorage.removeItem('dine3d_admin_active');
        router.push('/admin/login');
      }
    };

    bootstrapDashboard();

    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (!restaurantId) return;

    on('new-order', (order) => {
      setRecentOrders((previous) => [order, ...previous.slice(0, 9)]);
      setStats((previous) => previous ? {
        ...previous,
        todayOrders: parseInt(previous.todayOrders || 0, 10) + 1,
        pendingOrders: parseInt(previous.pendingOrders || 0, 10) + 1,
        todayRevenue: parseFloat(previous.todayRevenue || 0) + parseFloat(order.grandTotal || 0),
      } : previous);
    });

    on('order-updated', (updated) => {
      setRecentOrders((previous) => {
        const index = previous.findIndex((entry) => entry.id === updated.id);
        if (index === -1) return [updated, ...previous.slice(0, 9)];
        return previous.map((entry) => entry.id === updated.id ? updated : entry);
      });
      fetchStats();
    });
  }, [restaurantId, on]);

  const fetchStats = async () => {
    try {
      const statsRes = await api.getDashboardStats();
      setStats(statsRes.stats);
    } catch {}
  };

  const loadData = async () => {
    try {
      // Gate first paint only on operational data. Reports continue in
      // parallel and progressively enhance the usable dashboard.
      const [statsRes, ordersRes] = await Promise.all([
        api.getDashboardStats(),
        api.getRecentOrders(),
      ]);

      setStats(statsRes.stats);
      setRecentOrders(ordersRes.orders || []);
      setLoading(false);

      // Load optional features with graceful degradation
      const optionalPromises = [
        api.getAnalytics().catch(() => null),
        api.getActivityLog('limit=8').catch(() => ({ audits: [] })),
        api.getSalesReport({}).catch(() => null),
        api.getInventoryReport({}).catch(() => null),
        api.getStaffPerformanceReport({}).catch(() => ({ performance: [] })),
        api.getItemPerformanceReport({}).catch(() => null),
      ];

      void Promise.all(optionalPromises).then(([analyticsRes, activityRes, salesRes, inventoryRes, staffRes, itemRes]) => {
        if (analyticsRes) setAnalytics(analyticsRes);
        if (activityRes) setActivity(activityRes.audits || []);
        if (salesRes) setSalesReport(salesRes);
        if (inventoryRes) setInventoryReport(inventoryRes);
        if (staffRes) setStaffPerformance(staffRes.performance || []);
        if (itemRes) setItemPerformance(itemRes);
      });
    } catch (err) {
      console.error('Dashboard error:', err);
      if (err.message?.includes('Unauthorized') || err.message?.includes('401')) {
        localStorage.removeItem('dine3d_restaurant');
        localStorage.removeItem('dine3d_admin_active');
        router.push('/admin/login');
        return;
      }
    } finally {
      setLoading(false);
    }
  };

  const currencySymbol = CURRENCY_SYMBOLS[currency] || 'Rs.';
  const formatPrice = (value) => `${currencySymbol}${parseFloat(value || 0).toFixed(2)}`;
  const formatCompactNumber = (value) => new Intl.NumberFormat().format(parseInt(value || 0, 10));
  const formatTime = (value) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="skeleton skeleton-card" style={{ height: 228, borderRadius: 28 }} />
        <div className="stats-grid" style={{ marginBottom: 0 }}>
          {[1, 2, 3, 4].map((index) => (
            <div key={index} className="skeleton skeleton-card" style={{ height: 150 }} />
          ))}
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="skeleton skeleton-card" style={{ height: 260 }} />
          <div className="skeleton skeleton-card" style={{ height: 260 }} />
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="skeleton skeleton-card" style={{ height: 360 }} />
          <div className="skeleton skeleton-card" style={{ height: 360 }} />
        </div>
      </div>
    );
  }

  const todayOrders = parseInt(stats?.todayOrders || 0, 10);
  const todayRevenue = parseFloat(stats?.todayRevenue || 0);
  const pendingOrders = parseInt(stats?.pendingOrders || 0, 10);
  const averageTicket = todayOrders > 0 ? todayRevenue / todayOrders : 0;
  const topSeller = itemPerformance?.topSelling?.[0];
  const topStaff = staffPerformance?.[0];
  const totalOrders = parseInt(stats?.totalOrders || 0, 10);
  const lowStockCount = parseInt(inventoryReport?.summary?.lowStockCount || 0, 10);
  const visibleRecentOrders = filterItemsByDate(recentOrders, ordersRange);
  const visibleActivity = filterItemsByDate(activity, activityRange);
  const primaryMetrics = [
    {
      icon: 'revenue',
      label: 'Revenue Today',
      value: formatPrice(todayRevenue),
      hint: todayOrders > 0 ? `${todayOrders} orders contributed to today’s sales.` : 'No orders recorded yet for today.',
      tone: 'success',
      eyebrow: 'Today',
    },
    {
      icon: 'orders',
      label: 'Orders Today',
      value: formatCompactNumber(todayOrders),
      hint: pendingOrders > 0 ? `${pendingOrders} still need attention.` : 'The order queue is currently clear.',
      tone: 'primary',
      eyebrow: 'Volume',
    },
    {
      icon: 'clock',
      label: 'Pending Orders',
      value: formatCompactNumber(pendingOrders),
      hint: pendingOrders > 0 ? 'Kitchen or cashier follow-up is still pending.' : 'No pending orders in the live queue.',
      tone: pendingOrders > 0 ? 'warning' : 'neutral',
      eyebrow: 'Queue',
    },
    {
      icon: 'spark',
      label: 'Average Ticket',
      value: formatPrice(averageTicket),
      hint: `${formatCompactNumber(totalOrders)} lifetime orders processed so far.`,
      tone: 'info',
      eyebrow: 'Performance',
    },
  ];

  const secondaryMetrics = [
    {
      icon: 'menu',
      label: 'Menu Items',
      value: formatCompactNumber(stats?.totalMenuItems || 0),
      hint: 'Published items available for sale.',
      tone: 'primary',
    },
    {
      icon: 'table',
      label: 'Tables',
      value: formatCompactNumber(stats?.totalTables || 0),
      hint: 'Dining tables configured for service.',
      tone: 'info',
    },
    {
      icon: 'staff',
      label: 'Staff',
      value: formatCompactNumber(stats?.totalStaff || 0),
      hint: 'Team members active in this workspace.',
      tone: 'neutral',
    },
    {
      icon: 'category',
      label: 'Categories',
      value: formatCompactNumber(stats?.totalCategories || 0),
      hint: 'Catalog groups used across the menu.',
      tone: 'warning',
    },
  ];

  return (
    <div className="space-y-6">
      <section className={cx(
        DASHBOARD_SHELL,
        'relative overflow-hidden bg-[linear-gradient(135deg,#fffaf6_0%,#ffffff_52%,#f8fafc_100%)] px-5 py-6 text-slate-900 md:px-7 md:py-7'
      )}>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(255,107,53,0.10),_transparent_26%)]" />
        <div className="absolute -bottom-20 right-0 h-48 w-48 rounded-full bg-orange-100/60 blur-3xl" />
        <div className="absolute -top-16 left-1/3 h-40 w-40 rounded-full bg-slate-100/80 blur-3xl" />
        <div className="relative grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_340px]">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-orange-200 bg-white/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-700 shadow-[var(--shadow-xs)]">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                Live Dashboard
              </span>
              {stats?.plan ? (
                <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-700">
                  {typeof stats.plan === 'string' ? stats.plan : stats.plan.name} plan
                </span>
              ) : null}
            </div>

            <h1 className="mt-4 text-3xl font-extrabold tracking-[-0.04em] md:text-[2.35rem]">
              Dashboard
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600 md:text-[15px]">
              Monitor restaurant performance, sales movement, subscription usage, and the live order pulse from one operational view.
            </p>

            <div className="mt-5 flex flex-wrap gap-3">
              <div className="rounded-2xl border border-slate-200/80 bg-white/92 px-4 py-3 shadow-[var(--shadow-xs)]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Restaurant</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">{restaurant?.name || 'Restaurant Workspace'}</p>
              </div>
              <div className="rounded-2xl border border-slate-200/80 bg-white/92 px-4 py-3 shadow-[var(--shadow-xs)]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Currency</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">{currencySymbol}</p>
              </div>
              <div className="rounded-2xl border border-slate-200/80 bg-white/92 px-4 py-3 shadow-[var(--shadow-xs)]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">System Load</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">{pendingOrders > 0 ? `${pendingOrders} open tickets` : 'Queue is stable'}</p>
              </div>
            </div>
          </div>

          <div className="rounded-[24px] border border-slate-200/80 bg-white/94 p-5 shadow-[0_18px_36px_-24px_rgba(15,23,42,0.24)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Today at a glance</p>
                <h2 className="mt-1 text-lg font-bold tracking-[-0.03em] text-slate-900">Operations Snapshot</h2>
              </div>
              {restaurant ? (
                <button
                  type="button"
                  onClick={() => api.openLiveStore(restaurant)}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                >
                  <DashboardIcon name="external" className="h-4 w-4" />
                  View Live Store
                </button>
              ) : null}
            </div>

            <div className="mt-5 space-y-3">
              <div className="flex items-center justify-between rounded-2xl border border-slate-200/80 bg-slate-50/90 px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-[18px] bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
                    <DashboardIcon name="revenue" className="h-[18px] w-[18px]" />
                  </span>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Revenue</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">Today’s gross sales</p>
                  </div>
                </div>
                <div className="text-right text-lg font-extrabold tracking-[-0.03em] text-slate-900">{formatPrice(todayRevenue)}</div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-slate-200/80 bg-slate-50/90 px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Orders</p>
                  <p className="mt-2 text-2xl font-extrabold tracking-[-0.03em] text-slate-900">{formatCompactNumber(todayOrders)}</p>
                  <p className="mt-1 text-[12px] text-slate-500">Processed today</p>
                </div>
                <div className="rounded-2xl border border-slate-200/80 bg-slate-50/90 px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Pending</p>
                  <p className="mt-2 text-2xl font-extrabold tracking-[-0.03em] text-slate-900">{formatCompactNumber(pendingOrders)}</p>
                  <p className="mt-1 text-[12px] text-slate-500">Still active in queue</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="stats-grid" style={{ marginBottom: 0 }}>
        {primaryMetrics.map((metric, index) => (
          <MetricCard
            key={metric.label}
            icon={metric.icon}
            label={metric.label}
            value={metric.value}
            hint={metric.hint}
            tone={metric.tone}
            eyebrow={metric.eyebrow}
            delay={`${index * 70}ms`}
          />
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.95fr)]">
        <div className={cx(DASHBOARD_SHELL, 'animate-in overflow-hidden')} style={{ animationDelay: '220ms' }}>
          <div className="flex items-center justify-between border-b border-slate-200/80 bg-[linear-gradient(180deg,#ffffff_0%,#fbfbfc_100%)] px-5 py-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">Business Overview</p>
              <h3 className="mt-1 text-lg font-bold tracking-[-0.02em] text-slate-900">Operational Snapshot</h3>
            </div>
            <span className="badge badge-neutral">Live reports</span>
          </div>
          <div className="p-5 bg-[linear-gradient(180deg,#ffffff_0%,#fcfcfd_100%)]">
            {/* This panel is only about half the page at xl, so four columns
                inside it left roughly 85px per tile — not enough for a label,
                a figure and a sentence. Two columns keeps each tile readable
                at every width the dashboard is actually used at. */}
            <div className="grid gap-4 sm:grid-cols-2">
              <MiniInsightCard
                label="30 Day Revenue"
                value={formatPrice(salesReport?.summary?.grossRevenue || 0)}
                note={`${formatCompactNumber(salesReport?.summary?.orderCount || 0)} orders in the current report window.`}
                icon="revenue"
                tone="success"
              />
              <MiniInsightCard
                label="Waste Cost"
                value={formatPrice(inventoryReport?.summary?.totalWasteCost || 0)}
                note={`${formatCompactNumber(lowStockCount)} low stock items need restocking review.`}
                icon="clock"
                tone={lowStockCount > 0 ? 'warning' : 'neutral'}
              />
              <MiniInsightCard
                label="Top Seller"
                value={topSeller?.name || 'No sales yet'}
                note={`${formatCompactNumber(topSeller?.quantity || 0)} units sold in the current period.`}
                icon="menu"
                tone="primary"
              />
              <MiniInsightCard
                label="Top Staff"
                value={topStaff?.name || 'No activity yet'}
                note={`${formatCompactNumber(topStaff?.ordersHandled || 0)} orders handled so far.`}
                icon="staff"
                tone="info"
              />
            </div>

            {/* Same panel, same constraint: two columns, not four. */}
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {secondaryMetrics.map((metric) => (
                <MiniInsightCard
                  key={metric.label}
                  label={metric.label}
                  value={metric.value}
                  note={metric.hint}
                  icon={metric.icon}
                  tone={metric.tone}
                />
              ))}
            </div>
          </div>
        </div>

        {stats?.limits ? (
          <div className={cx(DASHBOARD_SHELL, 'animate-in overflow-hidden')} style={{ animationDelay: '260ms' }}>
            <div className="flex items-center justify-between border-b border-slate-200/80 bg-[linear-gradient(180deg,#ffffff_0%,#fbfbfc_100%)] px-5 py-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">Subscription</p>
                <h3 className="mt-1 text-lg font-bold tracking-[-0.02em] text-slate-900">Usage and Capacity</h3>
              </div>
              <span className="badge badge-neutral">{typeof stats.plan === 'string' ? stats.plan : (stats.plan?.name || 'Plan')}</span>
            </div>
            <div className="space-y-4 bg-[linear-gradient(180deg,#ffffff_0%,#fcfcfd_100%)] p-5">
              <UsageBar label="Staff" current={stats.totalStaff} max={stats.limits.maxStaff} icon="staff" />
              <UsageBar label="Menu Items" current={stats.totalMenuItems} max={stats.limits.maxMenuItems} icon="menu" />
              <UsageBar label="Tables" current={stats.totalTables} max={stats.limits.maxTables} icon="table" />
              <UsageBar label="Categories" current={stats.totalCategories} max={stats.limits.maxCategories} icon="category" />
            </div>
          </div>
        ) : null}
      </section>

      {analytics ? (
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.95fr)]">
          <ChartCard eyebrow="Sales trend" title="Revenue in the Last 30 Days" badge="Daily rollup" delay="320ms">
            <div style={{ height: 320 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={analytics.revenueData || []} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="dashboardRevenueFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#F97316" stopOpacity={0.22} />
                      <stop offset="95%" stopColor="#F97316" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 12, fill: '#6B7280' }}
                    tickMargin={10}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(value) => String(value).slice(5)}
                  />
                  <YAxis
                    tick={{ fontSize: 12, fill: '#6B7280' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(value) => `${currencySymbol}${value}`}
                  />
                  <RechartsTooltip
                    formatter={(value) => [formatPrice(value), 'Revenue']}
                    labelStyle={{ color: '#111827', fontWeight: 700 }}
                    contentStyle={{
                      borderRadius: 16,
                      border: '1px solid #E5E7EB',
                      boxShadow: '0 12px 24px -8px rgba(15, 23, 42, 0.16)',
                    }}
                  />
                  <Area type="monotone" dataKey="revenue" stroke="#F97316" strokeWidth={3} fillOpacity={1} fill="url(#dashboardRevenueFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>

          <ChartCard eyebrow="Menu performance" title="Popular Items" badge="Units sold" delay="380ms">
            <div style={{ height: 320 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics.popularItems || []} layout="vertical" margin={{ top: 0, right: 16, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E5E7EB" />
                  <XAxis type="number" hide />
                  <YAxis
                    dataKey="name"
                    type="category"
                    width={110}
                    tick={{ fontSize: 12, fill: '#6B7280' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <RechartsTooltip
                    cursor={{ fill: 'rgba(15,118,110,0.06)' }}
                    contentStyle={{
                      borderRadius: 16,
                      border: '1px solid #E5E7EB',
                      boxShadow: '0 12px 24px -8px rgba(15, 23, 42, 0.16)',
                    }}
                  />
                  <Bar dataKey="quantity" fill="#0F766E" radius={[0, 8, 8, 0]} barSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </section>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.95fr)]">
        <div className={cx(DASHBOARD_SHELL, 'animate-in overflow-hidden')} style={{ animationDelay: '440ms' }}>
          <div className="flex items-center justify-between border-b border-slate-200/80 bg-[linear-gradient(180deg,#ffffff_0%,#fbfbfc_100%)] px-5 py-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">Front of house</p>
              <h3 className="mt-1 text-lg font-bold tracking-[-0.02em] text-slate-900">Recent Orders</h3>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <RangeFilterChips value={ordersRange} onChange={setOrdersRange} />
              <a href="/admin/orders" className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--color-primary)] transition hover:opacity-80">
                View all
                <DashboardIcon name="arrowRight" className="h-4 w-4" />
              </a>
            </div>
          </div>
          <div className="p-5 bg-[linear-gradient(180deg,#ffffff_0%,#fcfcfd_100%)]">
            {visibleRecentOrders.length === 0 ? (
              <SectionEmptyState
                icon="orders"
                title="No orders in this range"
                message="Try switching to a wider range like This Week or All to review older ticket activity."
              />
            ) : (
              <div className="space-y-3">
                {visibleRecentOrders.slice(0, 6).map((order) => {
                  const status = String(order.status || 'PENDING').toUpperCase();
                  const statusClass = ORDER_STATUS_CLASS[status] || 'badge-neutral';
                  const orderTypeLabel = String(order.orderType || '').replaceAll('_', ' ') || 'Walk-in';

                  return (
                    <div key={order.id} className="rounded-[20px] border border-slate-200/80 bg-slate-50/72 px-4 py-3.5 transition hover:border-slate-300 hover:bg-white hover:shadow-[var(--shadow-sm)]">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-bold text-slate-900">
                              {order.orderNumber || `#${String(order.id).slice(-6)}`}
                            </p>
                            <span className={`badge badge-dot ${statusClass}`}>
                              {status}
                            </span>
                          </div>
                          <p className="mt-1 text-sm font-medium text-slate-700">
                            {order.customerName || 'Walk-in'}
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-slate-500">
                            <span>{order.table?.tableNumber ? `Table ${order.table.tableNumber}` : orderTypeLabel}</span>
                            <span>{formatTime(order.createdAt)}</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-base font-extrabold tracking-[-0.03em] text-slate-900">
                            {formatPrice(order.grandTotal)}
                          </div>
                          <div className="mt-1 text-[12px] text-slate-500">
                            {(order.items || []).length} item{(order.items || []).length === 1 ? '' : 's'}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className={cx(DASHBOARD_SHELL, 'animate-in overflow-hidden')} style={{ animationDelay: '500ms' }}>
          <div className="flex items-center justify-between border-b border-slate-200/80 bg-[linear-gradient(180deg,#ffffff_0%,#fbfbfc_100%)] px-5 py-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">Back office</p>
              <h3 className="mt-1 text-lg font-bold tracking-[-0.02em] text-slate-900">Live Activity</h3>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <RangeFilterChips value={activityRange} onChange={setActivityRange} />
              <span className="badge badge-success badge-dot">Realtime audit</span>
            </div>
          </div>
          <div className="p-5 bg-[linear-gradient(180deg,#ffffff_0%,#fcfcfd_100%)]">
            {visibleActivity.length === 0 ? (
              <SectionEmptyState
                icon="spark"
                title="No activity in this range"
                message="Try a wider filter to review older admin actions and system changes."
              />
            ) : (
              <div className="space-y-4">
                {visibleActivity.map((item, index) => {
                  const action = String(item.action || '');
                  const isCreate = action.includes('CREATE');
                  const isDelete = action.includes('DELETE');
                  const iconName = isCreate ? 'activityAdd' : isDelete ? 'activityDelete' : 'spark';
                  const toneClass = isDelete
                    ? 'bg-rose-50 text-rose-600 border-rose-200'
                    : isCreate
                      ? 'bg-emerald-50 text-emerald-600 border-emerald-200'
                      : 'bg-slate-100 text-slate-600 border-slate-200';

                  return (
                    <div key={item.id} className="relative flex gap-3">
                      {index !== visibleActivity.length - 1 ? (
                        <span className="absolute left-[18px] top-10 h-[calc(100%-12px)] w-px bg-slate-200" />
                      ) : null}
                      <div className={cx('relative z-[1] flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border', toneClass)}>
                        <DashboardIcon name={iconName} className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1 rounded-[20px] border border-slate-200/80 bg-slate-50/72 px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900">
                              {action.replaceAll('_', ' ') || 'ACTIVITY'}
                            </p>
                            <p className="mt-1 text-[12px] leading-5 text-slate-500">
                              {item.userRole} updated {item.entityType}.
                            </p>
                          </div>
                          <span className="shrink-0 text-[11px] font-medium text-slate-400">
                            {formatTime(item.createdAt)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
