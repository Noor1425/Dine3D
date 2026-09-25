import { currentServerStateScope, serverStateCache } from './serverStateCache';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';
let csrfTokenCache = null;
let refreshPromise = null;

/**
 * Endpoints whose answer is restaurant-wide by contract, not branch-scoped.
 * The server rejects these outright when a branch context is attached, so
 * sending one turns a working feature into a 403 the moment a user picks a
 * branch in the header.
 */
const RESTAURANT_WIDE_ENDPOINTS = new Set(['/dashboard/activity']);

export const shouldAttachBranchContext = (endpoint) => {
  const path = String(endpoint || '').split('?')[0];
  if (RESTAURANT_WIDE_ENDPOINTS.has(path)) return false;
  return path !== '/auth'
    && !path.startsWith('/auth/')
    && path !== '/v2/auth'
    && !path.startsWith('/v2/auth/')
    && path !== '/superadmin'
    && !path.startsWith('/superadmin/');
};

export const getCsrfToken = () => {
  if (csrfTokenCache) return csrfTokenCache;
  if (typeof document === 'undefined') return null;
  const cookie = document.cookie
    .split('; ')
    .find((item) => item.startsWith('dine3d_csrf='));
  return cookie ? decodeURIComponent(cookie.slice('dine3d_csrf='.length)) : null;
};

const getCurrentTenantSlug = () => {
  if (typeof window === 'undefined') return null;
  const host = window.location.hostname.toLowerCase();

  if (host.endsWith('.localhost') && host !== 'localhost') {
    return host.replace('.localhost', '');
  }

  if (host.endsWith('.dine3d.ai')) {
    return host.replace('.dine3d.ai', '');
  }

  const pathMatch = window.location.pathname.match(/^\/([^/]+)(?:\/|$)/);
  const candidate = pathMatch?.[1] || '';
  const reserved = new Set(['admin', 'superadmin', 'api', '_next', 'uploads']);
  if (candidate && !reserved.has(candidate.toLowerCase())) {
    return candidate;
  }

  return null;
};

class ApiClient {
  constructor() {
    this.baseUrl = API_BASE;
  }

  getToken() {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('dine3d_admin_active') === 'true';
    }
    return null;
  }

  setToken(active) {
    if (typeof window !== 'undefined') {
      localStorage.setItem('dine3d_admin_active', active ? 'true' : 'false');
    }
  }

  clearTokens() {
    if (typeof window === 'undefined') return;
    localStorage.removeItem('dine3d_admin_active');
    localStorage.removeItem('dine3d_restaurant');
    localStorage.removeItem('dine3d_cart');
    localStorage.removeItem('dine3d_is_impersonating');
    localStorage.removeItem('dine3d_sa_active');
    localStorage.removeItem('selected_branch');
    // Remove any legacy reusable token written by older builds. Current auth
    // uses HttpOnly cookies and never persists credentials in browser storage.
    localStorage.removeItem('dine3d_refresh_token');
    serverStateCache.invalidate();
  }

  async exitContext() {
    return this.post('/auth/exit-context');
  }

  async ensureCsrfToken() {
    const existing = getCsrfToken();
    if (existing) return existing;
    const response = await fetch(`${this.baseUrl}/auth/csrf`, { credentials: 'include' });
    const headerToken = response.headers.get('x-csrf-token');
    const body = response.ok ? await response.json().catch(() => ({})) : {};
    csrfTokenCache = headerToken || body.csrfToken || getCsrfToken();
    if (!response.ok || !csrfTokenCache) throw new Error('Unable to initialize request protection. Refresh the page and try again.');
    return csrfTokenCache;
  }

  async refreshSession() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      const csrfToken = await this.ensureCsrfToken();
      const response = await fetch(`${this.baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        credentials: 'include',
        body: '{}'
      });
      csrfTokenCache = response.headers.get('x-csrf-token') || csrfTokenCache;
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const error = new Error(data.error || 'Session expired');
        error.status = response.status;
        error.code = data.code;
        throw error;
      }
      this.setToken(true);
      const payload = await response.json().catch(() => ({}));
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('dine3d:session-refresh'));
      }
      return payload;
    })().finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  handleExpiredSession() {
    this.clearTokens();
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('dine3d:session-expired'));
    const isLogin = window.location.pathname.includes('/login');
    if (!isLogin) {
      window.location.replace(window.location.pathname.startsWith('/superadmin')
        ? '/superadmin/login'
        : '/admin/login');
    }
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {};
    const method = String(options.method || 'GET').toUpperCase();
    const stateful = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    const skipAuthRefresh = options.skipAuthRefresh === true;
    const authRetry = options.authRetry === true;
    const branchRetry = options.branchRetry === true;
    const requestedTimeout = Number(options.timeoutMs);
    const timeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout > 0
      ? requestedTimeout
      : null;
    const fetchOptions = { ...options };
    delete fetchOptions.skipAuthRefresh;
    delete fetchOptions.authRetry;
    delete fetchOptions.branchRetry;
    delete fetchOptions.timeoutMs;

    // Authentication is handled via HttpOnly cookies (credentials: 'include')
    // No Bearer token needed — the backend reads dine3d_identity cookie

    if (!(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    if (stateful) {
      const csrfToken = await this.ensureCsrfToken();
      headers['X-CSRF-Token'] = csrfToken;
    }

    // A selected location is an explicit security context, not just a UI
    // filter. The server validates this header against the signed-in user's
    // branch assignments before applying branch-specific RBAC.
    let attachedBranchId = null;
    if (typeof window !== 'undefined' && shouldAttachBranchContext(endpoint)) {
      try {
        const selectedBranch = JSON.parse(localStorage.getItem('selected_branch') || 'null');
        if (selectedBranch?.id && selectedBranch.id !== 'all') {
          headers['X-Branch-ID'] = selectedBranch.id;
          attachedBranchId = selectedBranch.id;
        }
      } catch {
        localStorage.removeItem('selected_branch');
      }
    }

    const callerSignal = fetchOptions.signal;
    const timeoutController = timeoutMs ? new AbortController() : null;
    let timeoutId = null;
    let timedOut = false;
    let forwardAbort = null;
    if (timeoutController) {
      if (callerSignal?.aborted) {
        timeoutController.abort(callerSignal.reason);
      } else if (callerSignal) {
        forwardAbort = () => timeoutController.abort(callerSignal.reason);
        callerSignal.addEventListener('abort', forwardAbort, { once: true });
      }
      fetchOptions.signal = timeoutController.signal;
      timeoutId = setTimeout(() => {
        timedOut = true;
        timeoutController.abort();
      }, timeoutMs);
    }

    let response;
    try {
      response = await fetch(url, {
        ...fetchOptions,
        headers: { ...headers, ...options.headers },
        credentials: 'include', // Crucial for cookies
        cache: 'no-store'
      });
    } catch (err) {
      // Session checks use a short deadline so an unavailable cloud cannot
      // leave a locally authorized terminal stuck on its loading screen.
      const browserNetworkFailure = err?.name === 'TypeError'
        && (err?.message?.includes('Failed to fetch') || err?.message?.includes('fetch failed'));
      if (timedOut || browserNetworkFailure) {
        const networkError = new Error(timedOut
          ? 'The server did not respond in time. Continuing with verified offline access when available.'
          : 'The server is unreachable. Saved offline operations remain on this device.');
        networkError.code = 'NETWORK_UNAVAILABLE';
        networkError.cause = err;
        throw networkError;
      }
      throw err;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (callerSignal && forwardAbort) callerSignal.removeEventListener('abort', forwardAbort);
    }

    const contentType = response.headers.get('content-type');
    let data = {};
    csrfTokenCache = response.headers.get('x-csrf-token') || csrfTokenCache;

    try {
      if (contentType && contentType.includes('application/json')) {
        data = await response.json();
      } else {
        const text = await response.text();
        data = { error: text || 'An unexpected error occurred' };
      }
    } catch (err) {
      console.error('Failed to parse response:', err);
      data = { error: 'Failed to parse server response' };
    }

    // A location can be deactivated while another browser tab still has it
    // selected. Remove only that stale UI context and retry once; the server
    // then resolves the user's current authorized branch scope.
    if (response.status === 404 && data.code === 'BRANCH_NOT_FOUND' && attachedBranchId && !branchRetry && typeof window !== 'undefined') {
      localStorage.removeItem('selected_branch');
      window.dispatchEvent(new CustomEvent('dine3d:branch-context-invalidated', { detail: { branchId: attachedBranchId } }));
      return this.request(endpoint, { ...options, branchRetry: true });
    }

    if (response.status === 401 && !skipAuthRefresh && !authRetry) {
      const credentialEndpoint = [
        '/auth/login', '/v2/auth/login', '/auth/refresh', '/auth/mfa/login-verify',
        '/superadmin/login', '/auth/password/forgot', '/auth/password/reset'
      ].some((path) => endpoint.startsWith(path));
      if (!credentialEndpoint) {
        try {
          await this.refreshSession();
          return this.request(endpoint, { ...options, authRetry: true });
        } catch {
          const lockVault = typeof window !== 'undefined' && window.dine3dOffline?.lockVault;
          if (lockVault) await lockVault().catch(() => {});
          this.handleExpiredSession();
        }
      }
    }

    if (!response.ok) {
      // ✅ ENHANCED: Handle multiple error response formats
      let errorMessage = null;

      // Try to extract from details array (field-level errors)
      if (data.details && Array.isArray(data.details) && data.details.length > 0) {
        errorMessage = data.details
          .filter(d => d && typeof d === 'string')
          .join('\n');
      }

      // Fall back to main error field
      if (!errorMessage && data.error && typeof data.error === 'string') {
        errorMessage = data.error;
      }

      // Fall back to status code message
      if (!errorMessage) {
        errorMessage = `Request failed with status ${response.status}`;
      }

      // Only log unexpected errors that indicate real problems
      // Skip: 401 (auth), 404 (not found), 403 with code (known entitlement errors)
      // Skip: Empty responses (already handled)
      // Log: 500+ (server errors), 400 without code (malformed/unexpected)
      const hasErrorData = data.error || data.details || data.message;
      const isServerError = response.status >= 500;
      const isUnexpectedClientError = response.status >= 400 && response.status < 500 && !data.code && hasErrorData;

      if (isServerError || isUnexpectedClientError) {
        console.error('API Error:', {
          status: response.status,
          error: data.error,
          details: data.details,
          message: errorMessage,
          url: response.url
        });
      }

      const requestError = new Error(errorMessage);
      requestError.status = response.status;
      requestError.code = data.code;
      requestError.details = data.details;
      requestError.retryAt = data.retryAt;
      throw requestError;
    }

    if (method !== 'GET' && [
      '/menu', '/categories', '/tables', '/settings', '/theme', '/subscription',
      '/billing', '/v2/auth/switch-restaurant',
    ].some((prefix) => endpoint.startsWith(prefix))) {
      serverStateCache.invalidate(`${currentServerStateScope()}:`);
    }

    return data;
  }

  get(endpoint, options = {}) {
    return this.request(endpoint, options);
  }

  cachedGet(endpoint, cacheOptions = {}, requestOptions = {}) {
    const key = `${currentServerStateScope()}:${endpoint}`;
    return serverStateCache.read(key, () => this.get(endpoint, requestOptions), cacheOptions);
  }

  post(endpoint, body) {
    return this.request(endpoint, {
      method: 'POST',
      body: body instanceof FormData ? body : JSON.stringify(body),
    });
  }

  put(endpoint, body) {
    return this.request(endpoint, {
      method: 'PUT',
      body: body instanceof FormData ? body : JSON.stringify(body),
    });
  }

  patch(endpoint, body) {
    return this.request(endpoint, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  delete(endpoint) {
    return this.request(endpoint, { method: 'DELETE' });
  }

  async download(endpoint, fallbackFilename = 'export.csv') {
    const headers = {};
    if (typeof window !== 'undefined' && shouldAttachBranchContext(endpoint)) {
      try {
        const selected = JSON.parse(localStorage.getItem('selected_branch') || 'null');
        if (selected?.id && selected.id !== 'all') headers['X-Branch-ID'] = selected.id;
      } catch {}
    }
    let response = await fetch(`${this.baseUrl}${endpoint}`, { headers, credentials: 'include', cache: 'no-store' });
    if (response.status === 401) {
      await this.refreshSession();
      response = await fetch(`${this.baseUrl}${endpoint}`, { headers, credentials: 'include', cache: 'no-store' });
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Export could not be generated');
    }
    const disposition = response.headers.get('content-disposition') || '';
    const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || fallbackFilename;
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove();
    URL.revokeObjectURL(url);
    return filename;
  }

  // Auth
  async register(data) {
    const result = await this.post('/auth/register', data);
    this.setToken(true);
    if (typeof window !== 'undefined') {
      localStorage.setItem('dine3d_restaurant', JSON.stringify(result.restaurant));
    }
    return result;
  }

  async login(restaurantCode, email, password, rememberMe = false) {
    const result = await this.post('/auth/login', { restaurantCode, email, password, rememberMe });
    if (!result.mfaRequired) this.setToken(true);
    if (typeof window !== 'undefined' && result.restaurant) {
      localStorage.setItem('dine3d_restaurant', JSON.stringify(result.restaurant));
    }
    return result;
  }

  async logout() {
    if (typeof window !== 'undefined' && window.dine3dOffline?.prepareLogout) {
      const mayContinue = await window.dine3dOffline.prepareLogout();
      if (!mayContinue) return false;
    }
    await this.post('/auth/logout', {});

    this.clearTokens();
    if (typeof window !== 'undefined') {
      window.location.replace('/admin/login?loggedOut=1');
    }
    return true;
  }

  getMe(options = {}) { return this.get('/auth/me', options); }
  verifyEmail(token) { return this.post('/auth/email/verify', { token }); }
  resendVerification(email) { return this.post('/auth/email/resend', { email }); }
  forgotPassword(email, restaurantCode) { return this.post('/auth/password/forgot', { email, restaurantCode }); }
  resetPassword(token, password) { return this.post('/auth/password/reset', { token, password }); }
  changePassword(currentPassword, newPassword) { return this.post('/auth/password/change', { currentPassword, newPassword }); }
  getSessions() { return this.get('/auth/sessions'); }
  revokeSession(familyId) { return this.delete(`/auth/sessions/${familyId}`); }
  logoutAll() { return this.post('/auth/logout-all', {}); }
  async switchRestaurant(restaurantId) {
    const result = await this.post('/v2/auth/switch-restaurant', { restaurantId });
    if (typeof window !== 'undefined') localStorage.removeItem('selected_branch');
    return result;
  }

  // Menu
  getMenuItems(params = '') { return this.cachedGet(`/menu${params ? '?' + params : ''}`, { staleMs: 30_000 }); }
  createMenuItem(formData) { return this.post('/menu', formData); }
  updateMenuItem(id, formData) { return this.put(`/menu/${id}`, formData); }
  deleteMenuItem(id) { return this.delete(`/menu/${id}`); }
  toggleMenuItem(id) { return this.patch(`/menu/${id}/toggle`); }

  // The shared food-picture library. Read once and held for a long while: it is
  // identical for every restaurant and only changes when the platform publishes
  // a picture, so re-fetching it per menu edit would be pure waste.
  getStockImages() { return this.cachedGet('/stock-images', { staleMs: 600_000 }); }

  // The shared dish catalogue. Same reasoning as the pictures: identical for
  // every restaurant, changes only when the platform publishes a dish.
  getMenuTemplates() { return this.cachedGet('/menu-templates', { staleMs: 600_000 }); }
  applyMenuTemplates(templateIds) { return this.post('/menu-templates/apply', { templateIds }); }

  // Categories
  getCategories() { return this.cachedGet('/categories', { staleMs: 60_000 }); }
  createCategory(data) { return this.post('/categories', data); }
  updateCategory(id, data) { return this.put(`/categories/${id}`, data); }
  deleteCategory(id) { return this.delete(`/categories/${id}`); }

  // 3D Model Request
  request3DModel(itemId, formData) {
    return this.post(`/menu/${itemId}/request-3d`, formData);
  }

  // Settings
  getSettings() { return this.cachedGet('/settings', { staleMs: 60_000 }); }

  // Tables
  getTables() { return this.cachedGet('/tables', { staleMs: 30_000 }); }
  createTable(data) { return this.post('/tables', data); }
  deleteTable(id) { return this.delete(`/tables/${id}`); }
  regenerateQR(id) { return this.post(`/tables/${id}/regenerate-qr`); }

  // Orders
  getOrders(params = {}) {
    const queryString = typeof params === 'string' ? params : new URLSearchParams(params).toString();
    return this.get(`/orders${queryString ? '?' + queryString : ''}`);
  }
  getLiveOrders(channel = 'ALL') {
    const query = new URLSearchParams();
    if (channel && channel !== 'ALL') query.set('channel', channel);
    const queryString = query.toString();
    return this.get(`/orders/live${queryString ? `?${queryString}` : ''}`);
  }
  createUnifiedOrder(data) { return this.post('/orders', data); }
  updateOrderStatus(id, status, estimatedMinutes) { return this.patch(`/orders/${id}/status`, { status, estimatedMinutes }); }
  trackOrder(id, trackingToken) {
    const query = trackingToken ? `?token=${encodeURIComponent(trackingToken)}` : '';
    return this.get(`/orders/track/${id}${query}`);
  }

  // Theme
  getTheme() { return this.get('/theme'); }
  updateTheme(data) { return this.put('/theme', data); }
  resetTheme() { return this.post('/theme/reset'); }

  // Dashboard
  getDashboardStats() { return this.get('/dashboard/stats'); }
  getRecentOrders() { return this.get('/dashboard/recent-orders'); }
  getAnalytics() { return this.get('/dashboard/analytics'); }
  getActivityLog(params = '') { return this.get(`/dashboard/activity${params ? '?' + params : ''}`); }
  getSalesReport(params = {}) {
    const queryString = typeof params === 'string' ? params : new URLSearchParams(params).toString();
    return this.get(`/dashboard/reports/sales${queryString ? '?' + queryString : ''}`);
  }
  getInventoryReport(params = {}) {
    const queryString = typeof params === 'string' ? params : new URLSearchParams(params).toString();
    return this.get(`/dashboard/reports/inventory${queryString ? '?' + queryString : ''}`);
  }
  getStaffPerformanceReport(params = {}) {
    const queryString = typeof params === 'string' ? params : new URLSearchParams(params).toString();
    return this.get(`/dashboard/reports/staff-performance${queryString ? '?' + queryString : ''}`);
  }
  getItemPerformanceReport(params = {}) {
    const queryString = typeof params === 'string' ? params : new URLSearchParams(params).toString();
    return this.get(`/dashboard/reports/item-performance${queryString ? '?' + queryString : ''}`);
  }

  // Billing Settings
  getBillingSettings() { return this.get('/dashboard/settings/billing'); }
  updateBillingSettings(data) { return this.patch('/dashboard/settings/billing', data); }
  // FBR digital invoicing. The security token is write-only — it is sent here
  // and never comes back, because it can file tax documents in the
  // restaurant's name.
  getFbrSettings() { return this.get('/dashboard/settings/fbr'); }
  updateFbrSettings(data) { return this.patch('/dashboard/settings/fbr', data); }
  testFbrConnection() { return this.post('/dashboard/settings/fbr/test', {}); }
  getSubscription() { return this.get('/subscription/current'); }
  getEntitlements() { return this.cachedGet('/subscription/entitlements', { staleMs: 30_000, maxAgeMs: 60_000 }); }
  getPublicPlans() { return this.get('/billing/plans'); }
  getBillingStatus() { return this.get('/billing/status'); }
  createBillingCheckout(planKey, billingInterval = 'MONTHLY') {
    const key = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}-checkout`;
    return this.request('/billing/checkout', {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify({ planKey, billingInterval })
    });
  }
  createBillingPortal() {
    const key = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}-portal`;
    return this.request('/billing/portal', { method: 'POST', headers: { 'Idempotency-Key': key }, body: '{}' });
  }
  getCheckoutStatus(sessionId) { return this.get(`/billing/checkout/${encodeURIComponent(sessionId)}`); }

  // Metered billing (pay-per-order / pay-per-receipt)
  getBillingSummary() { return this.get('/billing/summary'); }
  getBillingUsage() { return this.get('/billing/usage'); }
  getInvoices() { return this.get('/billing/invoices'); }
  getInvoice(id) { return this.get(`/billing/invoices/${encodeURIComponent(id)}`); }
  getPaymentInstructions(invoiceId) {
    return this.get(`/billing/payment-instructions${invoiceId ? `?invoiceId=${encodeURIComponent(invoiceId)}` : ''}`);
  }
  getPaymentSubmissions() { return this.get('/billing/payments'); }
  // The tenant's plan and the ladder it can move along, quoted in its own market.
  getPlanLadder() { return this.get('/billing/plan'); }
  changePlan(planKey) { return this.post('/billing/plan', { planKey }); }
  submitPayment(data) { return this.post('/billing/payments', data); }
  /** Where the restaurant stands with its bill — for the warning banner. */
  getBillingStanding() { return this.get('/billing/standing'); }
  getLocations() { return this.get('/locations'); }
  createLocation(data) { return this.post('/locations', data); }
  updateLocation(id, data) { return this.patch(`/locations/${id}`, data); }
  getStockTransfers(params = '') { return this.get(`/stock-transfers${params ? `?${params}` : ''}`); }
  createStockTransfer(data) { return this.post('/stock-transfers', data); }
  dispatchStockTransfer(id) { return this.post(`/stock-transfers/${id}/dispatch`); }
  completeStockTransfer(id, data = {}) { return this.post(`/stock-transfers/${id}/complete`, data); }
  getCustomRoles() { return this.get('/custom-roles'); }
  getCustomRolePermissionCatalog() { return this.get('/custom-roles/catalog'); }
  createCustomRole(data) { return this.post('/custom-roles', data); }
  updateCustomRole(id, data) { return this.patch(`/custom-roles/${id}`, data); }
  setMenuPublication(published) { return this.patch('/menu/publication', { published }); }

  // Public
  getRestaurant(slug) {
    const resolvedSlug = slug || getCurrentTenantSlug();
    return this.get(`/r/${resolvedSlug}`);
  }
  getPublicMenu(slug, qrToken) {
    const resolvedSlug = slug || getCurrentTenantSlug();
    const query = qrToken ? `?qrToken=${encodeURIComponent(qrToken)}` : '';
    return this.get(`/r/${resolvedSlug}/menu${query}`);
  }
  validateTable(slug, token) {
    const resolvedSlug = slug || getCurrentTenantSlug();
    return this.get(`/r/${resolvedSlug}/table/${token}`);
  }
  placeOrder(data) { return this.post('/orders', data); }

  // Promos
  getPromos() { return this.get('/promos'); }
  createPromo(data) { return this.post('/promos', data); }
  deletePromo(id) { return this.delete(`/promos/${id}`); }
  validatePromo(restaurantId, code, subtotal, tableId, qrToken) {
    return this.post('/promos/validate', { restaurantId, code, subtotal, tableId, qrToken });
  }

  getBypassTicket(mfaCode = null, targetRestaurantId = null) {
    return this.post('/auth/bypass-ticket', { mfaCode, targetRestaurantId });
  }

  exchangePreviewTicket(ticket) {
    return this.post('/auth/preview/exchange', { ticket });
  }

  getFullStoreUrl(restaurant, path = '') {
    if (!restaurant?.slug) return '';

    const host = typeof window !== 'undefined' ? window.location.hostname.toLowerCase() : '';
    const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost');
    const isPublicHost = host.endsWith('.dine3d.ai') || host === 'dine3d.ai' || host === 'www.dine3d.ai';
    // This standalone demo copy can run on any port (whatever wasn't already
    // taken locally), not necessarily 3000 — so this reads it from the
    // current page instead of assuming it.
    const localPort = typeof window !== 'undefined' && window.location.port ? `:${window.location.port}` : '';

    const baseUrl = isPublicHost
      ? `https://${restaurant.slug}.dine3d.ai`
      : isLocalHost
        ? `http://${restaurant.slug}.localhost${localPort}`
        : (process.env.NODE_ENV === 'production'
          ? `https://${restaurant.slug}.dine3d.ai`
          : `http://${restaurant.slug}.localhost${localPort}`);

    const normalizedPath = String(path || '').trim().replace(/^\/+/, '');
    return normalizedPath ? `${baseUrl}/${normalizedPath}` : baseUrl;
  }

  async getFirstStoreTable() {
    const response = await this.getTables();
    const tables = Array.isArray(response?.tables) ? response.tables : [];

    return tables.find((table) =>
      table?.qrToken &&
      table.isActive !== false &&
      table.isQrActive === true &&
      !table.qrRevokedAt
    ) || null;
  }

  async getFirstLiveStoreUrl(restaurant) {
    if (!restaurant?.slug) return null;

    const table = await this.getFirstStoreTable();
    if (!table?.qrToken) return null;

    return this.getFullStoreUrl(restaurant, table.qrToken);
  }

  async openLiveStore(restaurant) {
    if (!restaurant?.slug) {
      if (typeof window !== 'undefined') {
        window.alert('Restaurant context is missing.');
      }
      return false;
    }

    try {
      const liveUrl = await this.getFirstLiveStoreUrl(restaurant);

      if (!liveUrl) {
        if (typeof window !== 'undefined') {
          window.alert('There is no table in this store. Please create a table first.');
        }
        return false;
      }

      if (typeof window !== 'undefined') {
        window.open(liveUrl, '_blank', 'noopener,noreferrer');
      }

      return true;
    } catch (error) {
      console.error('Failed to open live store:', error);
      if (typeof window !== 'undefined') {
        window.alert(error?.message || 'Failed to open the live store.');
      }
      return false;
    }
  }

  // MFA
  mfaSetup() { return this.post('/auth/mfa/setup', {}); }
  mfaVerify(token) { return this.post('/auth/mfa/verify', { token }); }
  mfaLoginVerify(mfaToken, token) { return this.post('/auth/mfa/login-verify', { mfaToken, token }); }
  // Google Login
  getGoogleUrl() { return this.get('/auth/google/url'); }

  // ── POS ──
  createPOSOrder(data) { return this.post('/pos/orders', { ...data, source: data?.source || 'POS' }); }
  getActivePOSOrders(channel = 'ALL') {
    const effectiveChannel = typeof channel === 'string' ? channel : (channel?.channel || 'ALL');
    return this.getLiveOrders(effectiveChannel);
  }
  processPayment(orderId, data) { return this.post(`/pos/orders/${orderId}/pay`, data); }
  processSplitPayment(orderId, splits) { return this.post(`/pos/orders/${orderId}/split`, { splits }); }
  getPOSSplitPlan(orderId, mode, payload = {}) { return this.post(`/pos/orders/${orderId}/split-plan`, { mode, ...payload }); }
  transitionPOSOrder(orderId, data) { return this.post(`/pos/orders/${orderId}/transition`, data); }
  processRefund(orderId, data) { return this.post(`/pos/orders/${orderId}/refund`, data); }
  voidPOSOrder(orderId, data) { return this.post(`/pos/orders/${orderId}/void`, data); }
  mergePOSOrders(data) { return this.post('/pos/orders/merge', data); }
  transferPOSTable(orderId, toTableId) { return this.post(`/pos/orders/${orderId}/transfer-table`, { toTableId }); }
  repeatPOSOrder(orderId) { return this.post(`/pos/orders/${orderId}/repeat`); }
  holdPOSTab(data) { return this.post('/pos/tabs/hold', data); }
  getHeldPOSTabs() { return this.get('/pos/tabs/held'); }
  resumePOSTab(tabId) { return this.post(`/pos/tabs/${tabId}/resume`); }
  posQuickLogin(pin) { return this.post('/pos/quick-login', { pin }); }
  getPOSOperator() { return this.get('/pos/operator'); }
  posQuickLogout() { return this.post('/pos/quick-logout'); }
  openPOSShift(data) { return this.post('/pos/shifts/open', data); }
  getActivePOSShift(staffId) { return this.get(`/pos/shifts/active/${staffId}`); }
  addPOSDrawerMovement(shiftId, data) { return this.post(`/pos/shifts/${shiftId}/drawer`, data); }
  closePOSShift(shiftId, data) { return this.post(`/pos/shifts/${shiftId}/close`, data); }
  getPOSShiftReconciliation(shiftId) { return this.get(`/pos/shifts/${shiftId}/reconciliation`); }
  getReceipt(orderId) { return this.get(`/pos/receipt/${orderId}`); }

  // ── Inventory ──
  getIngredients(params = '') { return this.get(`/inventory${params ? '?' + params : ''}`); }
  createIngredient(data) { return this.post('/inventory', data); }
  updateIngredient(id, data) { return this.put(`/inventory/${id}`, data); }
  deleteIngredient(id) { return this.delete(`/inventory/${id}`); }
  adjustStock(id, data) { return this.post(`/inventory/${id}/adjust`, data); }
  getStockLogs(params = '') { return this.get(`/inventory/logs${params ? '?' + params : ''}`); }

  /** Closing routine: record what is actually on the shelves. */
  recordStockCount(payload) { return this.post('/inventory/count', payload); }

  // ── Delivery ───────────────────────────────────────────────────────────
  /** Riders an operator can assign. `available` narrows to those on shift. */
  getRiders(params = '') { return this.get(`/delivery/riders${params}`); }
  createRider(payload) { return this.post('/delivery/riders', payload); }
  updateRider(id, payload) { return this.patch(`/delivery/riders/${id}`, payload); }
  getDeliveryAssignments(params = '') { return this.get(`/delivery/assignments${params}`); }
  assignRider(payload) { return this.post('/delivery/assignments', payload); }
  cancelDelivery(id, reason) { return this.post(`/delivery/assignments/${id}/cancel`, { reason }); }
  failDelivery(id, reason) { return this.post(`/delivery/assignments/${id}/fail`, { reason }); }

  /** The rider portal's own endpoints: scoped to the signed-in rider. */
  getMyDeliveries() { return this.get('/delivery/mine'); }
  getMyDelivery(id) { return this.get(`/delivery/mine/${id}`); }
  acceptDelivery(id) { return this.post(`/delivery/mine/${id}/accept`); }
  pickUpDelivery(id) { return this.post(`/delivery/mine/${id}/pickup`); }
  completeDelivery(id, payload) { return this.post(`/delivery/mine/${id}/deliver`, payload); }
  failMyDelivery(id, reason) { return this.post(`/delivery/mine/${id}/fail`, { reason }); }
  setRiderAvailability(isAvailable) { return this.post('/delivery/mine/availability', { isAvailable }); }
  /** Opening routine: record a delivery that arrived. */
  receiveStock(payload) { return this.post('/inventory/receive', payload); }
  getLowStockAlerts() { return this.get('/inventory/alerts'); }
  acknowledgeAlert(id) { return this.post(`/inventory/alerts/${id}/acknowledge`); }
  runStockCheck() { return this.post('/inventory/check'); }
  linkIngredient(data) { return this.post('/inventory/link', data); }
  unlinkIngredient(data) { return this.request('/inventory/link', { method: 'DELETE', body: JSON.stringify(data) }); }
  getSuppliers() { return this.get('/inventory/suppliers'); }
  createSupplier(data) { return this.post('/inventory/suppliers', data); }
  getPurchaseOrders() { return this.get('/inventory/purchase-orders'); }
  createPurchaseOrder(data) { return this.post('/inventory/purchase-orders', data); }
  approvePurchaseOrder(id) { return this.post(`/inventory/purchase-orders/${id}/approve`, {}); }
  receivePurchaseOrder(id, data) { return this.post(`/inventory/purchase-orders/${id}/receive`, data); }
  getGoodsReceivingNotes(purchaseOrderId) { return this.get(`/inventory/purchase-orders/${purchaseOrderId}/grn`); }
  getExpenses(params = {}) {
    const queryString = typeof params === 'string' ? params : new URLSearchParams(params).toString();
    return this.get(`/inventory/expenses${queryString ? '?' + queryString : ''}`);
  }
  createExpense(data) { return this.post('/inventory/expenses', data); }
  getReorderSuggestions(params = {}) {
    const queryString = typeof params === 'string' ? params : new URLSearchParams(params).toString();
    return this.get(`/inventory/intelligence/reorder-suggestions${queryString ? '?' + queryString : ''}`);
  }
  getWasteAnalytics(params = {}) {
    const queryString = typeof params === 'string' ? params : new URLSearchParams(params).toString();
    return this.get(`/inventory/intelligence/waste${queryString ? '?' + queryString : ''}`);
  }
  getFoodCostAnalytics() { return this.get('/inventory/intelligence/food-cost'); }
  getMarginAnalytics() { return this.get('/inventory/intelligence/margins'); }
  getCostTrends(params = {}) {
    const queryString = typeof params === 'string' ? params : new URLSearchParams(params).toString();
    return this.get(`/inventory/intelligence/cost-trends${queryString ? '?' + queryString : ''}`);
  }

  // ── Staff ──
  getStaff() { return this.get('/staff'); }
  createStaff(data) { return this.post('/staff', data); }
  updateStaff(id, data) { return this.put(`/staff/${id}`, data); }
  deleteStaff(id) { return this.delete(`/staff/${id}`); }
}

const api = new ApiClient();
export default api;
