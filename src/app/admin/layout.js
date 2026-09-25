'use client';
import BillingNotice from '@/components/billing/BillingNotice';
import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import api from '@/lib/api';
import { OfflineProvider, OperatingModeBanner, SyncStatusIndicator } from '@/components/offline/OfflineProvider';
import RestaurantSwitcher from '@/components/auth/RestaurantSwitcher';
import BranchSelector from '@/components/auth/BranchSelector';
import { AdminAccessProvider } from '@/components/auth/AdminAccessContext';
import useProtectedHistoryGuard from '@/hooks/useProtectedHistoryGuard';
import { canAccessAdminRoute, firstAllowedAdminRoute, homeRouteForSession, hasTenantPermission } from '@/lib/tenantAccess';
import '@/styles/admin.css';
import RestaurantMark from '@/components/RestaurantMark';

const NAV_ITEMS = [
  { href: '/admin/dashboard', label: 'Dashboard', icon: '⬡', feature: 'basic_reports', any: ['dashboard.read'] },
  { href: '/admin/pos', label: 'POS Terminal', icon: '◆', feature: 'pos_orders', any: ['pos.read'] },
  { href: '/admin/kds', label: 'Kitchen (KDS)', icon: '⊞', feature: 'pos_orders', any: ['kitchen.read'] },
  { href: '/admin/orders', label: 'Order History', icon: '≡', feature: 'pos_orders', any: ['orders.read'] },
  { href: '/admin/data-history', label: 'Data & History', icon: '▤', feature: 'data_export', any: ['exports.read'] },
  { href: '/admin/menu', label: 'Menu Items', icon: '◈', feature: 'menu_management', any: ['menu.read'] },
  { href: '/admin/categories', label: 'Categories', icon: '◫', feature: 'menu_management', any: ['categories.write', 'categories.delete'] },
  { href: '/admin/inventory', label: 'Inventory', icon: '⊡', feature: 'inventory_management', any: ['inventory.read'] },
  { href: '/admin/delivery', label: 'Delivery', icon: '⇢', any: ['delivery.read'] },
  { href: '/admin/activity', label: 'Activity', icon: '📝', feature: 'audit_logs', any: ['dashboard.read'], corporateOnly: true },
  { href: '/admin/branches-v2', label: 'Locations', icon: '⌖', any: ['locations.read'] },
  { href: '/admin/staff', label: 'Team', icon: '👥', any: ['staff.read'] },
  { href: '/admin/tables', label: 'Tables & QR', icon: '⬘', any: ['tables.read'] },
  { href: '/admin/settings', label: 'Settings', icon: '◎', any: ['settings.read', 'theme.read'] },
  { href: '/admin/subscription', label: 'Plan & Usage', icon: '◉', any: ['subscription.read', 'billing.read'] },
  { href: '/admin/billing', label: 'Billing & Invoices', icon: '₨', any: ['billing.read'] },
  { href: '/admin/sync', label: 'Sync & Device', icon: '↻', any: ['sync.read'] },
  { href: '/admin/setup', label: 'Setup Center', icon: '✓', any: ['sync.read'] },
];

export default function AdminLayout({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const authPages = ['/admin/login', '/admin/register'];
  const isAuthPage = authPages.includes(pathname);
  const isPOSPage = pathname === '/admin/pos';
  const [restaurant, setRestaurant] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sessionType, setSessionType] = useState('normal');
  const [sessionRole, setSessionRole] = useState(null);
  const [sessionUser, setSessionUser] = useState(null);
  const [sessionMember, setSessionMember] = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [userRestaurants, setUserRestaurants] = useState([]);
  const [userBranches, setUserBranches] = useState([]);
  const [currentBranch, setCurrentBranch] = useState(null);
  const [accessLevel, setAccessLevel] = useState('branch');
  const [sessionChecking, setSessionChecking] = useState(true);

  useProtectedHistoryGuard({ scope: 'admin', enabled: !isAuthPage });

  useEffect(() => {
    const openSidebar = () => setSidebarOpen(true);
    window.addEventListener('dine3d:open-admin-sidebar', openSidebar);
    return () => window.removeEventListener('dine3d:open-admin-sidebar', openSidebar);
  }, []);

  useEffect(() => {
    // Exclude all authentication pages from layout checks
    if (isAuthPage) return;

    const verifyAdminSession = async () => {
      try {
        // Cloud identity remains authoritative when reachable. A short,
        // explicit deadline lets an already provisioned terminal enter its
        // signed offline window promptly during a WAN outage.
        const session = await api.getMe({ timeoutMs: 4000 });

        if (
          session?.user?.role === 'superadmin' &&
          (session?.user?.sessionType || 'normal') === 'normal'
        ) {
          router.replace('/superadmin/dashboard');
          return;
        }

        if (!session?.restaurant) {
          throw new Error('Missing restaurant context');
        }

        setSessionType(session?.user?.sessionType || 'normal');
        setSessionRole(session?.user?.role || null);
        setSessionUser(session?.user || null);
        setSessionMember(session?.member || null);
        setRestaurant(session.restaurant);
        setUserRestaurants(Array.isArray(session.restaurants) && session.restaurants.length > 0
          ? session.restaurants
          : [session.restaurant]);

        const policy = {
          permissions: session?.user?.permissions || [],
          deniedPermissions: session?.user?.deniedPermissions || [],
          sessionType: session?.user?.sessionType || 'normal',
        };
        const canAny = (required) => required.some((permission) => hasTenantPermission(policy, permission));
        const currentAccessLevel = session?.member?.accessLevel || 'branch';
        const allowedHere = canAccessAdminRoute(pathname, canAny)
          && !(pathname.startsWith('/admin/activity') && currentAccessLevel !== 'corporate');
        if (!allowedHere) {
          // Send them to their own home — and then carry on setting the session
          // up rather than returning.
          //
          // This effect keys on isAuthPage, not pathname, so it does not run
          // again at the destination. Returning here left sessionChecking true
          // with no second chance to clear it, and the screen sat on
          // "Verifying your secure session…" for good. It stranded exactly the
          // people whose landing page is not the first one in the route list:
          // sign-in sends everyone to the dashboard, and a cashier cannot open
          // a dashboard. Branches, entitlements and stored context below are
          // needed wherever they end up, too.
          router.replace(homeRouteForSession(session?.user?.role, canAny) || '/admin/login?reason=no_access');
        }
        setSessionChecking(false);

        // Load user's branch access from the new auth system
        if (session.member) {
          setAccessLevel(session.member.accessLevel || 'branch');
          const permittedBranches = session.branches || [];
          setUserBranches(permittedBranches);
          const storedBranch = (() => {
            try { return JSON.parse(localStorage.getItem('selected_branch') || 'null'); } catch { return null; }
          })();
          const selected = storedBranch?.id === 'all' && session.member.accessLevel === 'corporate'
            ? { id: 'all', name: 'All Branches' }
            : permittedBranches.find((branch) => branch.id === storedBranch?.id)
              || (session.member.accessLevel === 'corporate' ? { id: 'all', name: 'All Branches' } : null)
              || permittedBranches.find((branch) => branch.isPrimary)
              || permittedBranches[0]
              || null;
          setCurrentBranch(selected);
          if (selected) localStorage.setItem('selected_branch', JSON.stringify(selected));
        }

        localStorage.setItem('dine3d_restaurant', JSON.stringify(session.restaurant));
        localStorage.setItem('dine3d_admin_active', 'true');
        window.dispatchEvent(new CustomEvent('dine3d:authenticated-bootstrap'));
        api.getEntitlements()
          .then(setSubscription)
          .catch((error) => console.warn('[SUBSCRIPTION_UI]', error?.message));

        if ((session?.user?.sessionType || 'normal') === 'impersonation') {
          localStorage.setItem('dine3d_is_impersonating', 'true');
        } else {
          localStorage.removeItem('dine3d_is_impersonating');
        }

      } catch (err) {
        console.warn('[ADMIN_SESSION_FAIL]', {
          path: pathname,
          reason: err?.message || 'Unknown error',
        });
        if (err?.code === 'NETWORK_UNAVAILABLE') {
          try {
            const stored = JSON.parse(localStorage.getItem('dine3d_restaurant') || 'null');
            if (stored?.id) {
              const { getValidOfflineAccess } = await import('@/lib/offline/database');
              const offline = await getValidOfflineAccess(stored.id);
              if (offline) {
                const offlinePolicy = {
                  permissions: offline.claims.permissions || [],
                  deniedPermissions: offline.claims.deniedPermissions || [],
                  sessionType: 'normal',
                };
                const canAnyOffline = (required) => required.some((permission) => hasTenantPermission(offlinePolicy, permission));
                if (!canAccessAdminRoute(pathname, canAnyOffline)) {
                  const destination = homeRouteForSession(offline.claims.role, canAnyOffline);
                  if (destination) router.replace(destination);
                  return;
                }
                setRestaurant(offline.restaurant);
                setSessionRole(offline.claims.role);
                setSessionUser({
                  id: offline.claims.userId,
                  role: offline.claims.role,
                  permissions: offline.claims.permissions || [],
                  deniedPermissions: offline.claims.deniedPermissions || [],
                  restaurantId: offline.claims.restaurantId,
                  offlineSession: true,
                });
                setSubscription(offline.restaurant.entitlementSnapshot || null);
                const permittedBranches = Array.isArray(offline.locations) ? offline.locations : [];
                const offlineLocationId = offline.claims.locationId || null;
                const selected = permittedBranches.find((branch) => branch.id === offlineLocationId)
                  || permittedBranches[0]
                  || null;
                setAccessLevel('branch');
                setUserBranches(permittedBranches);
                setCurrentBranch(selected);
                if (selected) localStorage.setItem('selected_branch', JSON.stringify(selected));
                setSessionChecking(false);
                return;
              }
            }
          } catch (offlineError) {
            console.warn('[OFFLINE_SESSION_UNAVAILABLE]', offlineError?.message);
          }
        }
        localStorage.removeItem('dine3d_admin_active');
        localStorage.removeItem('dine3d_restaurant');
        localStorage.removeItem('dine3d_is_impersonating');
        router.replace('/admin/login');
      }
    };

    verifyAdminSession();

    // Listen for storage changes
    const handleStorageChange = (e) => {
      if (e.key === 'dine3d_admin_active' || e.key === 'dine3d_restaurant') {
        window.location.reload();
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  // The layout persists across client-side admin navigation. Identity is
  // loaded once; pathname authorization below is evaluated locally.
  }, [isAuthPage, router]);

  useEffect(() => {
    if (isAuthPage || !sessionUser) return undefined;
    let inFlight = null;
    const currentSignature = JSON.stringify({
      userId: sessionUser.id,
      role: sessionUser.role,
      permissions: sessionUser.permissions || [],
      deniedPermissions: sessionUser.deniedPermissions || [],
      restaurantId: restaurant?.id || null,
      accessLevel,
    });
    const revalidate = () => {
      if (inFlight) return inFlight;
      inFlight = api.getMe({ timeoutMs: 4000 }).then((session) => {
        const nextSignature = JSON.stringify({
          userId: session?.user?.id,
          role: session?.user?.role,
          permissions: session?.user?.permissions || [],
          deniedPermissions: session?.user?.deniedPermissions || [],
          restaurantId: session?.restaurant?.id || null,
          accessLevel: session?.member?.accessLevel || 'branch',
        });
        if (nextSignature !== currentSignature) window.location.reload();
      }).catch(() => {}).finally(() => { inFlight = null; });
      return inFlight;
    };
    const handleVisibility = () => { if (document.visibilityState === 'visible') revalidate(); };
    const interval = window.setInterval(revalidate, 5 * 60_000);
    window.addEventListener('dine3d:session-refresh', revalidate);
    window.addEventListener('dine3d:permissions-changed', revalidate);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('dine3d:session-refresh', revalidate);
      window.removeEventListener('dine3d:permissions-changed', revalidate);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [accessLevel, isAuthPage, restaurant?.id, sessionUser]);

  const accessPolicy = {
    permissions: sessionUser?.permissions || [],
    deniedPermissions: sessionUser?.deniedPermissions || [],
    sessionType,
  };
  const canAny = (permissions) => permissions.some((permission) => hasTenantPermission(accessPolicy, permission));
  const homeHref = homeRouteForSession(sessionUser?.role, canAny) || '/admin/login?reason=no_access';

  useEffect(() => {
    if (isAuthPage || !sessionUser) return;
    if (!canAccessAdminRoute(pathname, canAny) || (pathname.startsWith('/admin/activity') && accessLevel !== 'corporate')) {
      router.replace(homeHref);
    }
  }, [accessLevel, homeHref, isAuthPage, pathname, router, sessionUser]);

  // Exclude all authentication pages from admin layout wrapper
  if (isAuthPage) return children;
  if (sessionChecking || (sessionUser && (!canAccessAdminRoute(pathname, canAny) || (pathname.startsWith('/admin/activity') && accessLevel !== 'corporate')))) {
    return (
      <div className="min-h-screen bg-[#F9FAFB] flex items-center justify-center" role="status" aria-live="polite">
        <div className="text-sm font-bold text-neutral-600">Verifying your secure session…</div>
      </div>
    );
  }

  const handleViewStore = async () => {
    if (!restaurant) return;
    await api.openLiveStore(restaurant);
  };

  const handleExitContext = async () => {
    try {
      await api.post('/auth/exit-context');
      localStorage.removeItem('dine3d_is_impersonating');

      if (sessionRole === 'superadmin') {
        const host = window.location.hostname.toLowerCase();
        const portal = host.endsWith('.dine3d.ai')
          ? 'https://admin.dine3d.ai/superadmin/restaurants'
          : 'http://localhost:3000/superadmin/restaurants';
        window.location.replace(portal);
        return;
      }

      setSessionType('normal');
      router.replace('/admin/dashboard');
      router.refresh();
    } catch (e) {
      console.error('Failed to exit context:', e);
    }
  };

  const shell = (
    <div className="admin-layout flex flex-col min-h-screen h-screen overflow-hidden bg-[#F9FAFB]">
      {/* ── PROFESSIONAL IMPERSONATION BANNER ── */}
      {(sessionType === 'impersonation' || sessionType === 'preview') && (
        <div className={`w-full px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-2 z-[100] relative shadow-lg ${sessionType === 'preview' ? 'bg-amber-600 border-b border-amber-500/30' : 'bg-orange-600 border-b border-orange-500/30'}`}>
          <div className="flex min-w-0 items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
            <span className="text-white font-black text-[10px] uppercase tracking-[0.2em]">
              {sessionType === 'preview' ? 'Preview Mode' : 'Superadmin Mode'} · <span className="opacity-70">{sessionType === 'preview' ? 'Read-only session' : 'Authenticated access'}</span>
            </span>
          </div>
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 sm:gap-4">
            <span className="text-white/60 text-[10px] font-medium hidden md:block tracking-wide">
              {sessionType === 'preview'
                ? 'You are in read-only preview. Editing and order mutations are blocked.'
                : 'You are currently viewing this restaurant as an impersonated administrator.'}
            </span>
            <button
              onClick={handleExitContext}
              className={`bg-white px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest transition-all shadow-sm hover:scale-105 active:scale-95 ${sessionType === 'preview' ? 'text-amber-600 hover:bg-amber-50' : 'text-orange-600 hover:bg-orange-50'}`}
            >
              {sessionRole === 'superadmin' ? 'Exit & Return to Portal' : 'Exit Preview'}
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden relative">
        {/* Mobile backdrop */}
        {sidebarOpen && (
          <div
            className={`fixed inset-0 bg-black/40 backdrop-blur-sm z-[45] ${isPOSPage ? '' : 'md:hidden'}`}
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* ── SIDEBAR ── */}
        <aside
          className={`admin-sidebar ${sidebarOpen ? 'open' : ''} ${
            isPOSPage
              ? `${sidebarOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'} !fixed`
              : '!absolute md:!fixed'
          } !z-[50]`}
        >
          <div className="sidebar-header">
            <Link href={homeHref} className="sidebar-logo">
              Dine3d
            </Link>
            <button className="sidebar-toggle" onClick={() => setSidebarOpen(false)}>✕</button>
          </div>

          {restaurant && (
            <div className="sidebar-restaurant">
              {/* The owner's own mark, beside their own name. */}
              <RestaurantMark restaurant={restaurant} size={34} className="sidebar-restaurant-mark" />
              <div className="sidebar-restaurant-text">
              <div className="sidebar-restaurant-name">{restaurant.name} <span className="text-[9px] bg-neutral-200 px-1.5 py-0.5 rounded">{subscription?.subscription?.plan?.name || restaurant.plan || 'Standard'}</span></div>
              <div className="sidebar-restaurant-slug">/{restaurant.slug}</div>
              </div>
            </div>
          )}

          <nav className="sidebar-nav">
            <div className="sidebar-section-label">Management</div>
            {NAV_ITEMS.filter((item) => canAny(item.any) && (!item.corporateOnly || accessLevel === 'corporate')).map(item => (
              (() => {
                const locked = Boolean(
                  item.feature &&
                  subscription &&
                  subscription.features?.[item.feature]?.allowed !== true
                );
                return (
                  <Link
                    key={item.href}
                    href={locked ? '/admin/subscription' : item.href}
                    className={`sidebar-link ${pathname === item.href ? 'active' : ''} ${locked ? 'opacity-50' : ''}`}
                    onClick={() => setSidebarOpen(false)}
                    title={locked ? 'Upgrade or ask an administrator to unlock this feature' : undefined}
                  >
                    <span className="sidebar-icon">{item.icon}</span>
                    <span>{item.href === '/admin/branches-v2' && accessLevel !== 'corporate' ? 'Branch Settings' : item.label}</span>
                    {locked && <span className="ml-auto text-[10px]">🔒</span>}
                  </Link>
                );
              })()
            ))}
          </nav>

          <div className="sidebar-footer">
            <button className="btn btn-ghost" onClick={() => api.logout()}>
              <span>⎋</span> Sign Out
            </button>
          </div>
        </aside>

        {/* ── MAIN ── */}
        <main className={`flex-1 flex flex-col min-w-0 bg-[#F9FAFB] relative overflow-hidden ${isPOSPage ? 'ml-0' : 'ml-0 md:ml-[256px]'}`}>
          <OperatingModeBanner />
          {/* Topbar */}
          {!isPOSPage ? <header className="admin-topbar sticky top-0 z-[40] flex items-center px-4 md:px-8 py-4 bg-white border-b border-neutral-200">
            <button
              className={`btn btn-ghost btn-icon-sm ${isPOSPage ? '' : 'md:hidden'}`}
              onClick={() => setSidebarOpen(true)}
            >☰</button>

            <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">
              {restaurant && sessionUser && <SyncStatusIndicator compact={isPOSPage} />}

              {/* Branch Selector - for multi-branch/corporate users */}
              {restaurant && userBranches.length > 0 && (
                <BranchSelector
                  currentBranch={currentBranch}
                  branches={userBranches}
                  accessLevel={accessLevel}
                  onChange={(branch) => {
                    setCurrentBranch(branch);
                    if (branch) localStorage.setItem('selected_branch', JSON.stringify(branch));
                    window.dispatchEvent(new CustomEvent('dine3d:branch-changed', { detail: branch }));
                    window.location.reload();
                  }}
                />
              )}

              {/* Restaurant Switcher - for multi-restaurant users */}
              {restaurant && (
                <RestaurantSwitcher
                  currentRestaurant={restaurant}
                  restaurants={userRestaurants}
                  onSwitch={(newRestaurant) => setRestaurant(newRestaurant)}
                />
              )}

              {restaurant && (
                <button
                  onClick={handleViewStore}
                  className="btn btn-outline btn-sm min-w-0 font-bold text-[11px] uppercase tracking-wider gap-2 min-h-9"
                >
                  <span>↗</span> View Live Store
                </button>
              )}
            </div>
          </header> : null}

          {/* What is owed and what stops if it is not paid — shown while there
              is still time to act. The strip this replaced only appeared once
              the subscription had already flipped, and said "Subscription
              status: PAST DUE", which tells a cashier nothing they can use. */}
          <BillingNotice canSeeBilling={canAny(['billing.read'])} />

          {/* A trial still needs its own line: nothing is owed, so there is no
              invoice for the notice above to count down. */}
          {subscription?.subscription?.status === 'TRIALING' && (
            <Link
              href="/admin/subscription"
              className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs font-bold text-amber-800 md:px-8"
            >
              You are on a free trial. View plan and access details →
            </Link>
          )}

          {/* Page Content */}
          <div className={`admin-content flex-1 ${isPOSPage ? 'min-h-0 !overflow-hidden !p-0' : 'overflow-y-auto p-4 md:p-8'}`}>
            {children}
          </div>
        </main>
      </div>
    </div>
  );

  // Keep the context mounted during the initial session check as well. Pages
  // can render skeletons during prerender without falling outside the provider.
  return (
    <AdminAccessProvider session={sessionUser} member={sessionMember} branches={userBranches} currentBranch={currentBranch}>
      <OfflineProvider restaurant={restaurant} user={sessionUser}>{shell}</OfflineProvider>
    </AdminAccessProvider>
  );
}
