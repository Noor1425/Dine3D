import api, { shouldAttachBranchContext } from '../src/lib/api';

describe('API branch context routing', () => {
  let storage;

  beforeEach(() => {
    storage = new Map();
    global.localStorage = {
      getItem: jest.fn((key) => storage.get(key) ?? null),
      setItem: jest.fn((key, value) => storage.set(key, String(value))),
      removeItem: jest.fn((key) => storage.delete(key)),
    };
    global.window = { dispatchEvent: jest.fn() };
    global.CustomEvent = class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
  });

  afterEach(() => {
    delete global.fetch;
    delete global.localStorage;
    delete global.window;
    delete global.CustomEvent;
  });

  test.each([
    '/auth/me',
    '/auth/logout',
    '/auth/refresh',
    '/v2/auth/switch-restaurant',
    '/v2/auth/invitations/accept?token=example',
    '/superadmin/login',
  ])('does not attach a saved branch to identity endpoint %s', (endpoint) => {
    expect(shouldAttachBranchContext(endpoint)).toBe(false);
  });

  test.each([
    '/orders',
    '/inventory',
    '/dashboard/stats',
    '/v2/branches',
  ])('attaches branch context to operational endpoint %s', (endpoint) => {
    expect(shouldAttachBranchContext(endpoint)).toBe(true);
  });

  test('session state can be saved without referencing an endpoint variable', () => {
    expect(() => api.setToken(true)).not.toThrow();
    expect(localStorage.setItem).toHaveBeenCalledWith('dine3d_admin_active', 'true');
  });

  test('removes a stale branch and retries an operational request once', async () => {
    storage.set('selected_branch', JSON.stringify({ id: 'removed-branch', name: 'Old branch' }));
    global.fetch = jest.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Branch not found', code: 'BRANCH_NOT_FOUND' }), { status: 404, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));

    await expect(api.get('/inventory')).resolves.toEqual({ items: [] });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][1].headers['X-Branch-ID']).toBe('removed-branch');
    expect(fetch.mock.calls[1][1].headers['X-Branch-ID']).toBeUndefined();
    expect(localStorage.removeItem).toHaveBeenCalledWith('selected_branch');
  });

  test('maps an explicit request deadline to offline-capable network state', async () => {
    global.fetch = jest.fn((url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }));

    await expect(api.getMe({ timeoutMs: 5 })).rejects.toMatchObject({
      code: 'NETWORK_UNAVAILABLE',
    });
    expect(fetch.mock.calls[0][1].signal).toBeDefined();
  });

  test('preserves a caller cancellation instead of treating it as a WAN outage', async () => {
    const controller = new AbortController();
    global.fetch = jest.fn((url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }));

    const pending = api.get('/orders', { timeoutMs: 1000, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('Restaurant-wide endpoints', () => {
  test('the activity feed is never sent a branch context', () => {
    // The server answers this feed restaurant-wide and rejects it outright when
    // a branch context is attached. Sending one turned the Activity page into a
    // 403 for any owner who had picked a branch in the header.
    expect(shouldAttachBranchContext('/dashboard/activity')).toBe(false);
    expect(shouldAttachBranchContext('/dashboard/activity?limit=8')).toBe(false);
  });

  test('other dashboard endpoints stay branch-scoped', () => {
    expect(shouldAttachBranchContext('/dashboard/stats')).toBe(true);
    expect(shouldAttachBranchContext('/dashboard/recent-orders')).toBe(true);
    expect(shouldAttachBranchContext('/dashboard/analytics')).toBe(true);
  });
});
