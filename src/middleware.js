import { NextResponse } from 'next/server';

const PRIVATE_NO_STORE = 'private, no-store, no-cache, max-age=0, must-revalidate';

function preventPrivatePageCaching(response) {
  response.headers.set('Cache-Control', PRIVATE_NO_STORE);
  response.headers.set('Pragma', 'no-cache');
  response.headers.set('Expires', '0');
  response.headers.set('Vary', 'Cookie');
  return response;
}


/**
 * The role inside the identity cookie, read without verifying the signature.
 *
 * This is used for *routing*, never for authorization. A forged cookie claiming
 * to be an owner would get the admin HTML and then be refused by every single
 * API call it made, exactly as it is today — so reading the claim here cannot
 * grant anything. What it buys is that a rider never receives a page they have
 * no business seeing, instead of being handed the dashboard and bounced off it
 * a moment later by the client.
 */
function roleFromIdentityCookie(req) {
  const token = req.cookies.get('dine3d_identity')?.value;
  if (!token) return null;
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    return String(JSON.parse(atob(padded))?.role || '').toLowerCase() || null;
  } catch {
    // An unreadable cookie is not a routing signal; the API will reject it.
    return null;
  }
}

export const config = {
  matcher: [
    /*
     * Match all paths except for:
     * 1. /api routes
     * 2. /_next (Next.js internals)
     * 3. /_static (inside /public)
     * 4. all root files inside /public (e.g. /favicon.ico)
     */
    '/((?!api/|_next/|_static/|uploads/|[\\w-]+\\.\\w+).*)',
  ],
};

/**
 * Three kinds of host, and exactly one address for each.
 *
 *   dine3d.ai              the public site — pricing, register, sign in
 *   admin.dine3d.ai        the backoffice and the control plane
 *   <restaurant>.dine3d.ai one restaurant's menu, which is what a QR code opens
 *
 * In development all of these collapse onto localhost, so the canonical
 * backoffice host is localhost itself and every alias of it — admin.localhost,
 * www.localhost, 127.0.0.1 — redirects there rather than quietly working too.
 * Two addresses that both work is how a link ends up in an email pointing at
 * one of them while every button on the site points at the other.
 */
function resolveHostInfo(hostname, isProd) {
  if (isProd) {
    const siteHosts = new Set(['dine3d.ai', 'www.dine3d.ai']);
    const isAdminHost = hostname === 'admin.dine3d.ai';
    const isSiteHost = siteHosts.has(hostname);
    const isTenantHost = hostname.endsWith('.dine3d.ai') && !isAdminHost && !isSiteHost;
    const tenantSlug = isTenantHost ? hostname.replace('.dine3d.ai', '') : null;
    return { isAdminHost, isSiteHost, isTenantHost, tenantSlug, isCanonical: isAdminHost || isSiteHost };
  }

  const aliases = new Set(['127.0.0.1', 'admin.localhost', 'www.localhost']);
  const isCanonical = hostname === 'localhost';
  const isAlias = aliases.has(hostname);
  const isAdminHost = isCanonical || isAlias;
  const isTenantHost = hostname.endsWith('.localhost') && !isAdminHost;
  const tenantSlug = isTenantHost ? hostname.replace('.localhost', '') : null;
  return { isAdminHost, isSiteHost: isAdminHost, isTenantHost, tenantSlug, isCanonical };
}

function getAdminOrigin(isProd, port) {
  if (isProd) {
    return 'https://admin.dine3d.ai';
  }
  return `http://localhost:${port || '3000'}`;
}

/**
 * Redirect to another HOST, with an absolute Location.
 *
 * NextResponse.redirect() normalises a URL it considers same-origin down to a
 * path, and in development every host is the same origin — so a redirect from
 * admin.localhost to localhost came back as `Location: /admin/login`, which the
 * browser resolves against the host it is already on. That is not a redirect,
 * it is a loop, and it is silent: the status is a correct 307 every time.
 *
 * Setting the header directly is the only way to say which host is meant.
 */
function redirectToHost(origin, pathname, search) {
  const response = new NextResponse(null, { status: 307 });
  response.headers.set('Location', `${origin}${pathname}${search || ''}`);
  return response;
}

export default function middleware(req) {
  const url = req.nextUrl;
  const hostHeader = (req.headers.get('host') || '').toLowerCase();
  const hostname = hostHeader.split(':')[0] || (url.hostname || '').toLowerCase();
  const port = url.port || (process.env.NODE_ENV === 'production' ? '' : '3000');
  const isProd = hostname === 'dine3d.ai'
    || hostname === 'www.dine3d.ai'
    || hostname === 'admin.dine3d.ai'
    || hostname.endsWith('.dine3d.ai');

  const reservedRoots = new Set([
    '',
    'admin',
    'superadmin',
    'api',
    '_next',
    '_static',
    'uploads',
    'model3d',
    'images',
    'public',
    'favicon.ico',
    'robots.txt',
    'sitemap.xml',
    'register',      // ✅ Prevent subdomain redirect for registration
    'login',         // ✅ Prevent subdomain redirect for login
    'accept-invitation', // ✅ Prevent subdomain redirect for invitations
    'verify-email',  // ✅ Prevent subdomain redirect for email verification
    'forgot-password',
    'reset-password',
  ]);

  const pathname = url.pathname || '/';
  const segments = pathname.split('/').filter(Boolean);
  const firstSegment = (segments[0] || '').toLowerCase();

  const { isAdminHost, isTenantHost, tenantSlug, isCanonical } = resolveHostInfo(hostname, isProd);
  const adminOrigin = getAdminOrigin(isProd, port);
  const isSuperadminPath = pathname === '/superadmin' || pathname.startsWith('/superadmin/');
  const isAdminPath = pathname === '/admin' || pathname.startsWith('/admin/');
  const isPublicAdminPath = pathname === '/admin/login' || pathname === '/admin/register';
  const isPublicSuperadminPath = pathname === '/superadmin/login';
  // The rider portal is a signed-in page like any other backoffice page: it is
  // gated here and again by the API, which scopes every query to the rider.
  const isRiderPath = pathname === '/rider' || pathname.startsWith('/rider/');
  const isProtectedAdminPath = (isAdminPath && !isPublicAdminPath) || isRiderPath;
  const isProtectedSuperadminPath = isSuperadminPath && !isPublicSuperadminPath;

  // An alias of the backoffice host is not a second address for it: dine3d.ai
  // and www.dine3d.ai send /admin and /superadmin traffic to admin.dine3d.ai,
  // keeping the path.
  //
  // Deliberately production-only. In development every hostname resolves to the
  // same server, so Next treats the target as same-origin and rewrites the
  // Location header down to a path — which the browser then resolves against
  // the host it is already on. The redirect becomes an infinite loop that
  // reports a correct 307 at every hop. There is nothing to redirect to in
  // development anyway: localhost:3000 is the only host, and nothing generates
  // admin.localhost now that FRONTEND_URL names the canonical one.
  if (isProd && isAdminHost && !isCanonical && (isAdminPath || isSuperadminPath)) {
    return redirectToHost(adminOrigin, pathname, url.search);
  }

  // Superadmin portal must stay on admin root domain.
  if (isSuperadminPath && !isAdminHost) {
    return redirectToHost(adminOrigin, pathname, url.search);
  }

  // Backoffice pages live only on the control-plane host. Public tenant
  // subdomains therefore never receive privileged identity cookies through a
  // CORS-enabled admin application.
  if ((isAdminPath || isRiderPath) && !isAdminHost) {
    return redirectToHost(adminOrigin, pathname, url.search);
  }

  // This is a fast, server-side gate that prevents a protected document from
  // rendering after logout. Cookie presence is not treated as authorization;
  // the layouts and API still validate the signed token and role. Accept the
  // refresh cookie here so a normally refreshed session is not sent to login
  // just because its short-lived identity cookie has expired.
  // A rider has no page under /admin at all — their whole permission set is
  // their own deliveries. Send them home before any backoffice HTML is built.
  if (isAdminPath && !isPublicAdminPath && roleFromIdentityCookie(req) === 'rider') {
    return preventPrivatePageCaching(NextResponse.redirect(new URL('/rider', req.url), 307));
  }

  if (isProtectedAdminPath || isProtectedSuperadminPath) {
    const hasSessionCookie = Boolean(
      req.cookies.get('dine3d_identity')?.value || req.cookies.get('dine3d_refresh')?.value
    );

    if (!hasSessionCookie) {
      const loginPath = isProtectedSuperadminPath ? '/superadmin/login' : '/admin/login';
      const loginUrl = new URL(loginPath, req.url);
      loginUrl.searchParams.set('reason', 'session_expired');
      return preventPrivatePageCaching(NextResponse.redirect(loginUrl, 307));
    }

    const posTerminalLocked = Boolean(req.cookies.get('dine3d_pos_terminal_lock')?.value);
    if (
      isProtectedAdminPath
      && posTerminalLocked
      && (pathname !== '/admin/pos' || url.searchParams.get('locked') !== '1')
    ) {
      const lockUrl = new URL('/admin/pos', req.url);
      lockUrl.searchParams.set('locked', '1');
      return preventPrivatePageCaching(NextResponse.redirect(lockUrl, 307));
    }

    return preventPrivatePageCaching(NextResponse.next());
  }

  // Reserved account paths are never interpreted as restaurant slugs.
  //
  // `firstSegment` is empty for "/", and the empty string is in the set — so
  // this used to return early for the root of a tenant subdomain, and
  // <restaurant>.dine3d.ai served the marketing site instead of that
  // restaurant's menu. A QR code was unaffected because its URL carries a table
  // token, which is why it went unnoticed: the case that broke was someone
  // opening the restaurant's address directly.
  if (firstSegment && reservedRoots.has(firstSegment)) {
    return NextResponse.next();
  }

  // There is deliberately no rule here turning localhost:3000/<slug> into
  // <slug>.localhost:3000.
  //
  // It existed as a development convenience and was the cause of the worst
  // routing bug in this app: it treated the first path segment as a restaurant
  // slug, so /register was redirected to register.localhost:3000 — a host that
  // serves the home page — and because the redirect was issued as a 308, which
  // is permanent, browsers cached it and kept doing it long after the server
  // had stopped. It also gave every menu two addresses.
  //
  // Nothing needed it. A QR code encodes the restaurant's subdomain in full, so
  // the menu is reached directly and never through a redirect.

  // A menu has one address: its own subdomain, which is what the QR code
  // encodes. The same page used to answer at dine3d.ai/<slug> as well, so every
  // restaurant had two URLs and neither was canonical. On the site host a path
  // that is not one of the reserved roots above is simply not a page.
  if (!isTenantHost || !tenantSlug) {
    if (segments.length > 0) {
      return new NextResponse(null, { status: 404 });
    }
    return NextResponse.next();
  }

  // Keep tenant admin pages mounted at /admin/*; only rewrite public storefront paths.
  if (isAdminPath || isSuperadminPath) {
    return NextResponse.next();
  }

  // Route tenant subdomain traffic into app/[slug] without exposing /slug in browser URL.
  return NextResponse.rewrite(new URL(`/${tenantSlug}${pathname}${url.search}`, req.url));
}
