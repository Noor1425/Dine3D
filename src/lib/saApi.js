// Super Admin API Client
import api from './api';

const SA_API_BASE = process.env.NEXT_PUBLIC_API_URL ? `${process.env.NEXT_PUBLIC_API_URL}/superadmin` : '/api/superadmin';

class SuperAdminClient {
  getToken() {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('dine3d_sa_active') === 'true';
    }
    return null;
  }

  setToken(active) {
    if (typeof window !== 'undefined') {
      localStorage.setItem('dine3d_sa_active', active ? 'true' : 'false');
    }
  }

  clearToken() {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('dine3d_sa_active');
      localStorage.removeItem('dine3d_is_impersonating');
      localStorage.removeItem('dine3d_admin_active');
    }
  }

  async request(endpoint, options = {}) {
    const url = `${SA_API_BASE}${endpoint}`;
    const headers = {};
    if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(options.method || 'GET').toUpperCase())) {
      headers['X-CSRF-Token'] = await api.ensureCsrfToken();
    }

    const fetchOptions = { ...options };
    delete fetchOptions.authRetry;

    const response = await fetch(url, { 
      ...fetchOptions,
      headers: { ...headers, ...options.headers },
      credentials: 'include', // Crucial for cookies
      cache: 'no-store'
    });

    if (response.status === 401) {
      if (!options.authRetry && endpoint !== '/login') {
        try {
          await api.refreshSession();
          return this.request(endpoint, { ...options, authRetry: true });
        } catch {}
      }
      this.clearToken();
      if (typeof window !== 'undefined') window.location.replace('/superadmin/login');
      throw new Error('Unauthorized');
    }

    const contentType = response.headers.get('content-type');
    let data = {};
    
    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      const text = await response.text();
      data = { error: text || 'An unexpected error occurred' };
    }

    if (!response.ok) {
      const error = new Error(data.error || `Request failed with status ${response.status}`);
      error.code = data.code;
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  get(endpoint) { return this.request(endpoint); }
  post(endpoint, body) { return this.request(endpoint, { method: 'POST', body: JSON.stringify(body) }); }
  put(endpoint, body) { return this.request(endpoint, { method: 'PUT', body: JSON.stringify(body) }); }
  patch(endpoint, body) { return this.request(endpoint, { method: 'PATCH', body: JSON.stringify(body) }); }
  delete(endpoint) { return this.request(endpoint, { method: 'DELETE' }); }

  // Auth
  async login(email, password) {
    const data = await this.post('/login', { email, password });
    if (!data.mfaRequired) this.setToken(true);
    return data;
  }

  async mfaLoginVerify(mfaToken, code) {
    const response = await fetch('/api/auth/mfa/login-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': await api.ensureCsrfToken() },
      body: JSON.stringify({ mfaToken, token: code, code }),
      credentials: 'include'
    });
    const data = await response.json();
    if (!response.ok) throw data;
    this.setToken(true);
    return data;
  }

  async getBypassTicket(mfaCode = null, targetRestaurantId = null) {
    // Note: bypass-ticket is an auth route, but we proxy it or use the shared auth endpoint
    // In server.js we have app.use('/api/auth/mfa', mfaRoutes);
    // So we can use the main auth routes for bypass
    const response = await fetch('/api/auth/bypass-ticket', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': await api.ensureCsrfToken()
      },
      body: JSON.stringify({ mfaCode, targetRestaurantId }),
      credentials: 'include'
    });
    const data = await response.json();
    if (!response.ok) throw data;
    return data;
  }

  async mfaSetup() {
    const response = await fetch('/api/auth/mfa/setup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': await api.ensureCsrfToken()
      },
      body: '{}',
      credentials: 'include'
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'MFA setup failed');
    return data;
  }
  async mfaEnable(token) {
    const response = await fetch('/api/auth/mfa/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': await api.ensureCsrfToken()
      },
      body: JSON.stringify({ token }),
      credentials: 'include'
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'MFA verification failed');
    return data;
  }

  async logout() {
    const response = await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'X-CSRF-Token': await api.ensureCsrfToken() },
      credentials: 'include',
      cache: 'no-store',
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Secure logout could not be completed');
    }

    this.clearToken();
    if (typeof window !== 'undefined') {
      localStorage.removeItem('dine3d_is_impersonating');
      window.location.replace('/superadmin/login?loggedOut=1');
    }
    return true;
  }

  // Data
  getOverview(params = '') { return this.get(`/overview${params ? `?${params}` : ''}`); }
  getRestaurants(params = '') { return this.get(`/restaurants${params ? '?' + params : ''}`); }
  getRestaurant(id) { return this.get(`/restaurants/${id}`); }
  createRestaurant(data) { return this.post('/restaurants', data); }
  updateRestaurant(id, data) { return this.patch(`/restaurants/${id}`, data); }
  addRestaurantNote(id, data) { return this.post(`/restaurants/${id}/notes`, data); }
  changeRestaurantOwner(id, data) { return this.post(`/restaurants/${id}/owner`, data); }
  revokeRestaurantSessions(id, data) { return this.post(`/restaurants/${id}/revoke-sessions`, data); }
  resetRestaurantOnboarding(id, data) { return this.post(`/restaurants/${id}/reset-onboarding`, data); }
  getBranchRequests(status = 'PENDING') { return this.get(`/branch-requests?status=${encodeURIComponent(status)}`); }
  approveBranchRequest(id, data) { return this.post(`/branch-requests/${id}/approve`, data); }
  rejectBranchRequest(id, data) { return this.post(`/branch-requests/${id}/reject`, data); }
  resendBranchManagerInvitation(id, data = {}) { return this.post(`/branch-requests/${id}/resend-manager-invite`, data); }
  // Manual payment verification and metered invoices
  getPaymentSubmissions(status = 'PENDING') { return this.get(`/subscription-management/payments?status=${encodeURIComponent(status)}`); }
  verifyPaymentSubmission(id, data = {}) { return this.post(`/subscription-management/payments/${id}/verify`, data); }
  rejectPaymentSubmission(id, data) { return this.post(`/subscription-management/payments/${id}/reject`, data); }
  /**
   * Where to load a payment receipt from.
   *
   * Returned as a URL rather than fetched, so an <img> can render it directly
   * and the browser sends the session cookie the way it would for any other
   * same-origin asset. The file is never public; this route authorises it.
   */
  paymentProofUrl(id) { return `${SA_API_BASE}/subscription-management/payments/${id}/proof`; }
  getPlatformInvoices(params = '') { return this.get(`/subscription-management/invoices${params ? `?${params}` : ''}`); }
  getOverdueInvoices() { return this.get('/subscription-management/invoices/overdue'); }
  closeBillingPeriod(restaurantId, data = {}) { return this.post(`/subscription-management/restaurants/${restaurantId}/invoices/close`, data); }
  getRestaurantUsage(restaurantId) { return this.get(`/subscription-management/restaurants/${restaurantId}/usage`); }
  backfillRestaurantUsage(restaurantId, data = {}) { return this.post(`/subscription-management/restaurants/${restaurantId}/usage/backfill`, data); }

  getEdgeInstallations(status = 'OPEN') { return this.get(`/edge-installations?status=${encodeURIComponent(status)}`); }
  scheduleEdgeInstallation(id, data) { return this.post(`/edge-installations/${id}/schedule`, data); }
  prepareEdgeInstallation(id, data) { return this.post(`/edge-installations/${id}/prepare`, data); }
  configureEdgePrinters(id, data) { return this.put(`/edge-installations/${id}/printers`, data); }
  replaceEdgeInstallation(id, data) { return this.post(`/edge-installations/${id}/replace`, data); }
  acceptEdgeInstallation(id, data) { return this.post(`/edge-installations/${id}/acceptance`, data); }
  cancelEdgeInstallation(id, data) { return this.post(`/edge-installations/${id}/cancel`, data); }
  async impersonateRestaurant(id, reason, mode = 'impersonation') {
    const result = await this.post(`/restaurants/${id}/impersonate`, { reason, mode, confirmed: true });
    if (typeof window !== 'undefined') {
      localStorage.setItem('dine3d_is_impersonating', mode === 'preview' ? 'preview' : 'true');
    }
    return result;
  }

  // Stock food pictures — the shared library every restaurant can pick from.
  getStockImages() { return this.get('/stock-images'); }
  addStockImage(formData) { return this.request('/stock-images', { method: 'POST', body: formData }); }
  deleteStockImage(id) { return this.delete(`/stock-images/${id}`); }

  /**
   * Download a file the control plane generates.
   *
   * Not this.get(): the response is a spreadsheet or a CSV, not JSON, and the
   * filename the server chose is the one the operator should end up with.
   */
  async downloadFile(endpoint, fallbackFilename) {
    const response = await fetch(`${SA_API_BASE}${endpoint}`, { credentials: 'include', cache: 'no-store' });
    if (response.status === 401) {
      this.clearToken();
      if (typeof window !== 'undefined') window.location.replace('/superadmin/login');
      throw new Error('Unauthorized');
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'That export could not be generated');
    }
    const disposition = response.headers.get('content-disposition') || '';
    const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || fallbackFilename;
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return filename;
  }

  downloadAuditLogs(format, params = '') {
    return this.downloadFile(
      `/subscription-management/audit-logs.${format}${params ? `?${params}` : ''}`,
      `dine3d-activity.${format}`,
    );
  }

  // The shared dish catalogue every restaurant builds its menu from.
  getMenuTemplates() { return this.get('/menu-templates'); }
  createMenuTemplate(data) { return this.post('/menu-templates', data); }
  updateMenuTemplate(id, data) { return this.patch(`/menu-templates/${id}`, data); }
  deleteMenuTemplate(id) { return this.delete(`/menu-templates/${id}`); }

  // Model Requests
  getModelRequests(status) { return this.get(`/model-requests${status ? '?status=' + status : ''}`); }
  
  async updateModelRequest(id, data) {
    // Handle FormData (for file uploads)
    if (data instanceof FormData) {
      const url = `${SA_API_BASE}/model-requests/${id}`;
      const response = await fetch(url, {
        method: 'PATCH',
        headers: { 'X-CSRF-Token': await api.ensureCsrfToken() },
        body: data,
        credentials: 'include'
      });

      if (response.status === 401) {
        this.clearToken();
        if (typeof window !== 'undefined') window.location.replace('/superadmin/login');
        throw new Error('Unauthorized');
      }

      const contentType = response.headers.get('content-type');
      let result = {};
      
      if (contentType && contentType.includes('application/json')) {
        result = await response.json();
      } else {
        const text = await response.text();
        result = { error: text || 'An unexpected error occurred' };
      }

      if (!response.ok) throw new Error(result.error || `Request failed with status ${response.status}`);
      return result;
    }
    
    // Regular JSON request
    return this.patch(`/model-requests/${id}`, data);
  }

  getOrders(params = '') { return this.get(`/orders${params ? '?' + params : ''}`); }
  getAnalytics(days = 30) { return this.get(`/analytics?days=${days}`); }
  getOperations(params = '') { return this.get(`/operations${params ? `?${params}` : ''}`); }
  getSecurityLogs(params = '') { return this.get(`/security-logs${params ? `?${params}` : ''}`); }
  getSystemHealth() { return this.get('/system-health'); }
  getBackupConfig() { return this.get('/backups/config'); }
  getBackupSnapshots() { return this.get('/backups/snapshots'); }
  createBackup(data) { return this.post('/backups/snapshots', data); }
  verifyBackup(id, data = {}) { return this.post(`/backups/snapshots/${id}/verify`, data); }
  getRestoreRequests() { return this.get('/backups/restore-requests'); }
  createRestoreRequest(data) { return this.post('/backups/restore-requests', data); }
  reviewRestoreRequest(id, data) { return this.patch(`/backups/restore-requests/${id}/review`, data); }
  getSyncHealth(days = 7) { return this.get(`/sync-health?days=${encodeURIComponent(days)}`); }
  getAdmins() { return this.get('/admins'); }
  createAdmin(data) { return this.post('/admins', data); }
  updateAdmin(id, data) { return this.patch(`/admins/${id}`, data); }
  revokeAdminSessions(id, data) { return this.post(`/admins/${id}/revoke-sessions`, data); }

  // Plans, entitlements, subscriptions, and immutable audit history
  getPlans(includeArchived = false) {
    return this.get(`/subscription-management/plans${includeArchived ? '?archived=true' : ''}`);
  }
  createPlan(data) { return this.post('/subscription-management/plans', data); }
  updatePlan(id, data) { return this.patch(`/subscription-management/plans/${id}`, data); }
  updatePlanConfiguration(id, data) { return this.put(`/subscription-management/plans/${id}/configuration`, data); }
  duplicatePlan(id, data) { return this.post(`/subscription-management/plans/${id}/duplicate`, data); }
  archivePlan(id, data) { return this.post(`/subscription-management/plans/${id}/archive`, data); }
  setPlanEntitlements(id, data) {
    return this.put(`/subscription-management/plans/${id}/entitlements`, data);
  }
  getFeatures() { return this.get('/subscription-management/features'); }
  createFeature(data) { return this.post('/subscription-management/features', data); }
  getSubscriptions(params = '') {
    return this.get(`/subscription-management/subscriptions${params ? `?${params}` : ''}`);
  }
  getSubscription(restaurantId) {
    return this.get(`/subscription-management/subscriptions/${restaurantId}`);
  }
  assignSubscription(restaurantId, data) {
    return this.put(`/subscription-management/subscriptions/${restaurantId}/assignment`, data);
  }
  changeSubscriptionStatus(restaurantId, data) {
    return this.post(`/subscription-management/subscriptions/${restaurantId}/status`, data);
  }
  schedulePlanChange(restaurantId, data) {
    return this.post(`/subscription-management/subscriptions/${restaurantId}/schedule`, data);
  }
  createFeatureOverride(restaurantId, data) {
    return this.post(`/subscription-management/subscriptions/${restaurantId}/feature-overrides`, data);
  }
  createLimitOverride(restaurantId, data) {
    return this.post(`/subscription-management/subscriptions/${restaurantId}/limit-overrides`, data);
  }
  revokeOverride(type, id, data) {
    return this.post(`/subscription-management/overrides/${type}/${id}/revoke`, data);
  }
  getAdminAuditLogs(params = '') {
    return this.get(`/subscription-management/audit-logs${params ? `?${params}` : ''}`);
  }
  getBillingEvents(params = '') {
    return this.get(`/subscription-management/billing-events${params ? `?${params}` : ''}`);
  }

  getFullStoreUrl(restaurant, path = '') {
    if (!restaurant?.slug) return '';

    const host = typeof window !== 'undefined' ? window.location.hostname.toLowerCase() : '';
    const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost');
    const isPublicHost = host.endsWith('.dine3d.ai') || host === 'dine3d.ai' || host === 'www.dine3d.ai';

    const baseUrl = isPublicHost
      ? `https://${restaurant.slug}.dine3d.ai`
      : isLocalHost
        ? `http://${restaurant.slug}.localhost:3000`
        : (process.env.NODE_ENV === 'production'
          ? `https://${restaurant.slug}.dine3d.ai`
          : `http://${restaurant.slug}.localhost:3000`);

    const normalizedPath = String(path || '').trim().replace(/^\/+/, '');
    return normalizedPath ? `${baseUrl}/${normalizedPath}` : baseUrl;
  }
  // Google Login
  async getGoogleUrl() {
    const response = await fetch('/api/auth/google/url', {
      credentials: 'include'
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to fetch Google login URL');
    return data;
  }
}

const saApi = new SuperAdminClient();
export default saApi;
