'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Activity, AlertTriangle, BarChart3, Bell, Building2, ChevronDown, ChevronRight,
  CircleCheck, CirclePlus, CreditCard, HeartPulse, KeyRound, Layers3,
  LayoutDashboard, LogOut, Menu, PackageSearch, Images, UtensilsCrossed, ReceiptText, RefreshCw, ScanLine,
  Search, ShieldCheck, ShoppingBag, UserRound, UsersRound, Wallet, X, MapPin, DatabaseBackup, ServerCog
} from 'lucide-react';
import saApi from '@/lib/saApi';
import api from '@/lib/api';
import CommandPalette from '@/components/superadmin/CommandPalette';
import { SuperAdminAccessProvider } from '@/components/superadmin/SuperAdminAccessContext';
import useProtectedHistoryGuard from '@/hooks/useProtectedHistoryGuard';

const NAV = [
  { label: 'Overview', items: [
    { href: '/superadmin/dashboard', label: 'Command center', icon: LayoutDashboard, permission: 'restaurants.view' },
    { href: '/superadmin/audit-logs', label: 'Activity feed', icon: Activity, permission: 'audit_logs.view' }
  ] },
  { label: 'Customers', items: [
    { href: '/superadmin/restaurants', label: 'Restaurants', icon: Building2, permission: 'restaurants.view' },
    { href: '/superadmin/branch-requests', label: 'Location requests', icon: MapPin, permission: 'restaurants.view' },
    { href: '/superadmin/restaurants?create=1', label: 'Add restaurant', icon: CirclePlus, permission: 'restaurants.create' }
  ] },
  { label: 'Revenue', items: [
    { href: '/superadmin/plans', label: 'Plans & entitlements', icon: Layers3, permission: 'plans.manage' },
    { href: '/superadmin/subscriptions', label: 'Subscriptions', icon: CreditCard, permission: 'subscriptions.view' },
    { href: '/superadmin/payments', label: 'Manual payments', icon: Wallet, permission: 'billing.view' },
    { href: '/superadmin/billing-events', label: 'Billing events', icon: ReceiptText, permission: 'billing.view' }
  ] },
  { label: 'Operations', items: [
    { href: '/superadmin/orders', label: 'Orders', icon: ShoppingBag, permission: 'operations.view' },
    { href: '/superadmin/operations', label: 'QR & inventory', icon: ScanLine, permission: 'operations.view' },
    { href: '/superadmin/edge-installations', label: 'Managed installations', icon: ServerCog, permission: 'restaurants.view' },
    { href: '/superadmin/model-requests', label: '3D requests', icon: PackageSearch, permission: 'operations.view' },
    { href: '/superadmin/stock-images', label: 'Food pictures', icon: Images, permission: 'operations.view' },
    { href: '/superadmin/menu-catalogue', label: 'Dish catalogue', icon: UtensilsCrossed, permission: 'operations.view' },
    { href: '/superadmin/analytics', label: 'Analytics', icon: BarChart3, permission: 'operations.view' }
  ] },
  { label: 'Trust & platform', items: [
    { href: '/superadmin/admins', label: 'Platform team', icon: UsersRound, permission: 'admins.manage' },
    { href: '/superadmin/account-security', label: 'My security', icon: KeyRound },
    { href: '/superadmin/security-logs', label: 'Security events', icon: ShieldCheck, permission: 'security_logs.view' },
    { href: '/superadmin/system-health', label: 'System health', icon: HeartPulse, permission: 'system_health.view' },
    { href: '/superadmin/backups', label: 'Backup & recovery', icon: DatabaseBackup, permission: 'backups.view' },
    { href: '/superadmin/sync-health', label: 'Sync health', icon: RefreshCw, permission: 'system_health.view' }
  ] }
];

/**
 * Where each page sits, derived from the navigation rather than repeated.
 *
 * This used to be a hand-kept second list of page names, and it had drifted:
 * Location requests, Orders, QR & inventory and Analytics were missing from it,
 * so all four rendered as "Control plane › Control plane" in the header while
 * the page below them said something else entirely. Reading the nav means a
 * page added to the sidebar cannot arrive without a name again.
 *
 * The section comes with it, so the trail says something a duplicated title
 * never did: Revenue › Manual payments.
 */
const PAGE_LOCATIONS = new Map(
  NAV.flatMap(({ label: section, items }) => items
    // "Add restaurant" is an action that lands on Restaurants, not a page of
    // its own; indexing its query string would mislabel the page it opens.
    .filter((item) => !item.href.includes('?'))
    .map((item) => [item.href.split('/').filter(Boolean)[1], { section, title: item.label }])),
);

const SUPERADMIN_ROUTE_PERMISSIONS = [
  { prefix: '/superadmin/dashboard', permission: 'restaurants.view' },
  { prefix: '/superadmin/restaurants', permission: 'restaurants.view' },
  { prefix: '/superadmin/branch-requests', permission: 'restaurants.view' },
  { prefix: '/superadmin/plans', permission: 'plans.manage' },
  { prefix: '/superadmin/subscriptions', permission: 'subscriptions.view' },
  { prefix: '/superadmin/payments', permission: 'billing.view' },
  { prefix: '/superadmin/billing-events', permission: 'billing.view' },
  { prefix: '/superadmin/orders', permission: 'operations.view' },
  { prefix: '/superadmin/operations', permission: 'operations.view' },
  { prefix: '/superadmin/edge-installations', permission: 'restaurants.view' },
  { prefix: '/superadmin/model-requests', permission: 'operations.view' },
  { prefix: '/superadmin/stock-images', permission: 'operations.view' },
  { prefix: '/superadmin/menu-catalogue', permission: 'operations.view' },
  { prefix: '/superadmin/analytics', permission: 'operations.view' },
  { prefix: '/superadmin/admins', permission: 'admins.manage' },
  { prefix: '/superadmin/security-logs', permission: 'security_logs.view' },
  { prefix: '/superadmin/system-health', permission: 'system_health.view' },
  { prefix: '/superadmin/backups', permission: 'backups.view' },
  { prefix: '/superadmin/sync-health', permission: 'system_health.view' },
  { prefix: '/superadmin/audit-logs', permission: 'audit_logs.view' },
  { prefix: '/superadmin/account-security', permission: null },
];

const requiredPermissionForRoute = (pathname) => SUPERADMIN_ROUTE_PERMISSIONS
  .find(({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`));

const roleLabel = (role) => String(role || 'platform_admin').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const initials = (operator) => {
  const source = operator?.name || operator?.email || 'SA';
  return source.split(/[\s@]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
};

export default function SuperAdminLayout({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const isLoginPage = pathname === '/superadmin/login';
  const [menuOpen, setMenuOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [healthOpen, setHealthOpen] = useState(false);
  const [sessionType, setSessionType] = useState('normal');
  const [permissions, setPermissions] = useState([]);
  const [operator, setOperator] = useState(null);
  const [contextRestaurant, setContextRestaurant] = useState(null);
  const [health, setHealth] = useState(null);
  const [sessionChecking, setSessionChecking] = useState(true);

  useProtectedHistoryGuard({ scope: 'superadmin', enabled: !isLoginPage });

  const can = (permission) => permissions.includes(permission);
  const navigation = useMemo(() => NAV.flatMap((section) => section.items
    .filter((item) => !item.permission || permissions.includes(item.permission))
    .map((item) => ({ ...item, section: section.label }))), [permissions]);

  useEffect(() => {
    if (isLoginPage) return;
    if (pathname === '/superadmin') {
      router.replace('/superadmin/dashboard');
      return;
    }

    let active = true;
    const verifySuperadminSession = async () => {
      try {
        const data = await api.getMe();
        if (data?.user?.role !== 'superadmin') throw new Error('Forbidden');
        if (!active) return;
        saApi.setToken(true);
        setSessionType(data.user.sessionType || 'normal');
        setPermissions(data.user.adminPermissions || []);
        setOperator(data.user);
        setContextRestaurant(data.restaurant || null);
        const routePolicy = requiredPermissionForRoute(pathname);
        if (!routePolicy || (routePolicy.permission && !data.user.adminPermissions?.includes(routePolicy.permission))) {
          const destination = SUPERADMIN_ROUTE_PERMISSIONS.find((item) => !item.permission || data.user.adminPermissions?.includes(item.permission));
          router.replace(destination?.prefix || '/superadmin/account-security');
          return;
        }
        setSessionChecking(false);
      } catch {
        if (!active) return;
        saApi.clearToken();
        setSessionType('normal');
        router.replace('/superadmin/login');
      }
    };

    verifySuperadminSession();
    return () => { active = false; };
  }, [isLoginPage, pathname, router]);

  useEffect(() => {
    const handleShortcut = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen((value) => !value);
      }
      if (event.key === 'Escape') {
        setCommandOpen(false);
        setProfileOpen(false);
        setHealthOpen(false);
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  useEffect(() => {
    if (sessionChecking || !permissions.includes('system_health.view')) return undefined;
    let active = true;
    const loadHealth = async () => {
      try {
        const result = await saApi.getSystemHealth();
        if (active) setHealth(result);
      } catch {
        if (active) setHealth({ unavailable: true, checkedAt: new Date().toISOString() });
      }
    };
    loadHealth();
    const interval = window.setInterval(loadHealth, 60_000);
    return () => { active = false; window.clearInterval(interval); };
  }, [permissions, sessionChecking]);

  if (isLoginPage) return children;
  const currentRoutePolicy = requiredPermissionForRoute(pathname);
  const currentRouteAllowed = currentRoutePolicy
    && (!currentRoutePolicy.permission || permissions.includes(currentRoutePolicy.permission));
  if (sessionChecking || !currentRouteAllowed) return <div className="flex min-h-screen items-center justify-center bg-sa-950 text-sm font-bold text-white" role="status"><RefreshCw className="mr-3 h-4 w-4 animate-spin text-orange-400" />Verifying control-plane session…</div>;

  const handleExitContext = async () => {
    try {
      await api.exitContext();
      setSessionType('normal');
      setContextRestaurant(null);
      router.refresh();
    } catch {
      // Keep showing the active context if the server cannot end it.
    }
  };

  const segments = pathname.split('/').filter(Boolean).slice(1);
  const location = PAGE_LOCATIONS.get(segments[0]);
  // A restaurant's own page is a detail view under Customers, not a page in
  // the sidebar, so it is named here rather than in the nav.
  const currentTitle = segments[1] && segments[0] === 'restaurants'
    ? 'Restaurant details'
    : location?.title || 'Control plane';
  const currentSection = segments[1] && segments[0] === 'restaurants'
    ? 'Customers'
    : location?.section || 'Control plane';
  const incidentCount = health?.signals ? Object.values(health.signals).reduce((sum, count) => sum + Number(count || 0), 0) : 0;
  const platformHealthy = !health?.unavailable && health?.database?.status === 'available' && health?.apiProcess?.status === 'available' && incidentCount === 0;
  const environment = process.env.NEXT_PUBLIC_APP_ENV || (process.env.NODE_ENV === 'production' ? 'Production' : 'Development');

  return (
    <SuperAdminAccessProvider permissions={permissions} sessionType={sessionType}>
      <div className="sa-shell flex min-h-screen min-w-0 max-w-full bg-sa-950 text-white">
        {menuOpen && <button className="fixed inset-0 z-[19] bg-black/60 md:hidden" onClick={() => setMenuOpen(false)} aria-label="Close navigation" />}

        <aside className={`fixed inset-y-0 left-0 z-20 flex w-64 flex-col border-r border-sa-800 bg-sa-900 transition-transform duration-200 ${menuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
          <div className="flex h-16 items-center gap-3 border-b border-sa-800 px-5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 shadow-lg shadow-orange-950/30"><Layers3 className="h-5 w-5" /></div>
            <div className="min-w-0 flex-1"><div className="text-sm font-black tracking-tight">Dine3d</div><div className="text-[10px] font-bold uppercase tracking-[0.18em] text-sa-500">Control plane</div></div>
            <button onClick={() => setMenuOpen(false)} className="rounded-lg p-1 text-sa-500 hover:text-white md:hidden" aria-label="Close navigation"><X className="h-4 w-4" /></button>
          </div>

          <div className="px-3 pt-3">
            <button onClick={() => setCommandOpen(true)} className="flex w-full items-center gap-2 rounded-xl border border-sa-700 bg-sa-950 px-3 py-2.5 text-left text-xs text-sa-500 transition hover:border-sa-600 hover:text-sa-300"><Search className="h-4 w-4" /><span className="flex-1">Search anything</span><kbd className="rounded border border-sa-700 bg-sa-900 px-1.5 py-0.5 text-[9px]">⌘ K</kbd></button>
          </div>

          <nav className="flex-1 overflow-y-auto p-3" aria-label="Control-plane navigation">
            {NAV.map((section) => {
              const items = section.items.filter((item) => !item.permission || can(item.permission));
              if (!items.length) return null;
              return <div key={section.label} className="mb-4"><div className="px-3 py-2 text-[10px] font-black uppercase tracking-[0.17em] text-sa-600">{section.label}</div>{items.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href.split('?')[0];
                return <Link key={item.href} href={item.href} onClick={() => setMenuOpen(false)} aria-current={active ? 'page' : undefined} className={`mb-0.5 flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition ${active ? 'bg-orange-500/10 text-orange-300 ring-1 ring-inset ring-orange-500/10' : 'text-sa-400 hover:bg-sa-800 hover:text-white'}`}><Icon className="h-[17px] w-[17px]" aria-hidden="true" />{item.label}</Link>;
              })}</div>;
            })}
          </nav>

          <div className="border-t border-sa-800 p-3">
            <div className="mb-2 flex items-center justify-between rounded-lg px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-sa-500"><span>{environment}</span><span className="flex items-center gap-1 text-emerald-500"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Secure session</span></div>
            <button onClick={() => saApi.logout()} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold text-sa-400 transition hover:bg-red-500/10 hover:text-red-400"><LogOut className="h-4 w-4" />Sign out</button>
          </div>
        </aside>

        <main className="flex min-h-screen min-w-0 max-w-full flex-1 flex-col md:ml-64">
          {sessionType !== 'normal' && (
            <div className={`sticky top-0 z-30 flex min-h-11 flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b px-4 py-2 text-xs ${sessionType === 'preview' ? 'border-amber-700/50 bg-amber-950 text-amber-200' : 'border-orange-700/50 bg-orange-950 text-orange-200'}`}>
              <ShieldCheck className="h-4 w-4" /><strong>{sessionType === 'preview' ? 'Read-only tenant preview' : 'Audited tenant support session'}</strong><span className="text-white">{contextRestaurant?.name || 'Restaurant context'}</span><span className="hidden text-sa-400 sm:inline">All access is scoped and recorded.</span><button onClick={handleExitContext} className="ml-2 rounded-lg border border-current px-2 py-1 font-black hover:bg-white/10">Exit context</button>
            </div>
          )}

          <header className="sticky top-0 z-10 flex h-16 items-center gap-3 border-b border-sa-800 bg-sa-950/90 px-4 backdrop-blur-xl sm:px-6">
            <button className="rounded-lg p-2 text-sa-400 hover:bg-sa-900 hover:text-white md:hidden" onClick={() => setMenuOpen(true)} aria-label="Open navigation"><Menu className="h-5 w-5" /></button>
            <div className="min-w-0 flex-1"><div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-sa-600"><span>{currentSection}</span><ChevronRight className="h-3 w-3" /><span className="truncate text-sa-400">{currentTitle}</span></div><div className="truncate text-sm font-black text-sa-200">{currentTitle}</div></div>

            {can('system_health.view') && <HealthMenu health={health} open={healthOpen} setOpen={(value) => { setHealthOpen(value); setProfileOpen(false); }} incidentCount={incidentCount} healthy={platformHealthy} />}
            <ProfileMenu operator={operator} open={profileOpen} setOpen={(value) => { setProfileOpen(value); setHealthOpen(false); }} />
          </header>

          {!operator?.twoFactorEnabled && sessionType === 'normal' && <div className="mx-4 mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-800/60 bg-amber-500/10 px-4 py-3 text-xs text-amber-200 sm:mx-6"><AlertTriangle className="h-4 w-4" /><strong>Protect this privileged account with MFA.</strong><span className="text-amber-200/70">Platform administrators should not operate with password-only access.</span><Link href="/superadmin/account-security" className="ml-auto font-black underline">Set up MFA</Link></div>}

          <div className="min-w-0 max-w-full flex-1 overflow-x-hidden p-4 sm:p-6">{children}</div>
        </main>

        <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} navigation={navigation} canSearchRestaurants={can('restaurants.view')} />
      </div>
    </SuperAdminAccessProvider>
  );
}

function HealthMenu({ health, open, setOpen, incidentCount, healthy }) {
  return <div className="relative"><button onClick={() => setOpen(!open)} aria-label={`${incidentCount} platform alerts`} className={`relative flex h-9 items-center gap-2 rounded-xl border px-2.5 text-xs font-bold ${healthy ? 'border-sa-800 text-emerald-400 hover:bg-sa-900' : 'border-amber-900 bg-amber-500/5 text-amber-300'}`}>{healthy ? <CircleCheck className="h-4 w-4" /> : <Bell className="h-4 w-4" />}<span className="hidden lg:inline">{healthy ? 'All systems normal' : `${incidentCount || '—'} signals`}</span>{incidentCount > 0 && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-sa-950" />}</button>{open && <div className="fixed left-3 right-3 top-[4.5rem] overflow-hidden rounded-2xl border border-sa-700 bg-sa-900 shadow-2xl sm:absolute sm:left-auto sm:right-0 sm:top-11 sm:w-80"><div className="border-b border-sa-800 p-4"><div className="font-black">Platform status</div><div className="mt-1 text-xs text-sa-500">Live checks refresh every minute.</div></div>{health?.unavailable ? <div className="p-4 text-sm text-red-300">Status service could not be reached.</div> : health ? <div className="space-y-2 p-4 text-xs"><StatusRow label="Database" ok={health.database.status === 'available'} value={`${health.database.latencyMs} ms`} /><StatusRow label="API process" ok={health.apiProcess.status === 'available'} value="Available" /><StatusRow label="Background jobs" ok={!health.signals.failedJobs24h} value={`${health.signals.failedJobs24h} failed`} /><StatusRow label="Billing events" ok={!health.signals.failedBilling24h} value={`${health.signals.failedBilling24h} failed`} /><StatusRow label="Critical security" ok={!health.signals.criticalSecurity24h} value={`${health.signals.criticalSecurity24h} events`} /></div> : <div className="p-4 text-sm text-sa-500">Checking platform status…</div>}<Link href="/superadmin/system-health" onClick={() => setOpen(false)} className="flex items-center justify-between border-t border-sa-800 px-4 py-3 text-xs font-black text-orange-400 hover:bg-sa-800">Open system health <ChevronRight className="h-4 w-4" /></Link></div>}</div>;
}

function ProfileMenu({ operator, open, setOpen }) {
  return <div className="relative"><button onClick={() => setOpen(!open)} className="flex items-center gap-2 rounded-xl p-1.5 hover:bg-sa-900" aria-label="Open operator menu"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 text-xs font-black">{initials(operator)}</span><span className="hidden min-w-0 text-left lg:block"><span className="block max-w-36 truncate text-xs font-bold">{operator?.name || operator?.email || 'Super Admin'}</span><span className="block text-[10px] text-sa-500">{roleLabel(operator?.adminRole)}</span></span><ChevronDown className="hidden h-3.5 w-3.5 text-sa-500 lg:block" /></button>{open && <div className="fixed left-3 right-3 top-[4.5rem] overflow-hidden rounded-2xl border border-sa-700 bg-sa-900 shadow-2xl sm:absolute sm:left-auto sm:right-0 sm:top-12 sm:w-72"><div className="border-b border-sa-800 p-4"><div className="truncate font-black">{operator?.name || 'Super Admin'}</div><div className="mt-1 truncate text-xs text-sa-500">{operator?.email || 'Authenticated operator'}</div><div className="mt-3 flex flex-wrap items-center gap-2"><span className="rounded-full bg-sa-800 px-2 py-1 text-[10px] font-bold text-sa-300">{roleLabel(operator?.adminRole)}</span><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${operator?.twoFactorEnabled ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-300'}`}>{operator?.twoFactorEnabled ? 'MFA protected' : 'MFA needs setup'}</span></div></div><div className="p-2"><Link href="/superadmin/account-security" onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-sa-300 hover:bg-sa-800"><UserRound className="h-4 w-4" />Account & security</Link><button onClick={() => saApi.logout()} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-red-400 hover:bg-red-500/10"><LogOut className="h-4 w-4" />Sign out</button></div></div>}</div>;
}

function StatusRow({ label, ok, value }) {
  return <div className="flex items-center gap-2 rounded-lg bg-sa-950 px-3 py-2"><span className={`h-2 w-2 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-500'}`} /><span className="flex-1 text-sa-400">{label}</span><strong className={ok ? 'text-sa-200' : 'text-red-300'}>{value}</strong></div>;
}
