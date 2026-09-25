const { serverStateCache } = require('../src/lib/serverStateCache');

describe('tenant server-state cache', () => {
  beforeEach(() => {
    serverStateCache.invalidate();
    jest.useFakeTimers();
  });

  afterEach(() => jest.useRealTimers());

  test('deduplicates fresh reads and revalidates stale data in the background', async () => {
    const loader = jest.fn()
      .mockResolvedValueOnce({ version: 1 })
      .mockResolvedValueOnce({ version: 2 });

    await expect(serverStateCache.read('tenant:menu', loader, { staleMs: 100, maxAgeMs: 1000 }))
      .resolves.toEqual({ version: 1 });
    await expect(serverStateCache.read('tenant:menu', loader, { staleMs: 100, maxAgeMs: 1000 }))
      .resolves.toEqual({ version: 1 });
    expect(loader).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(150);
    await expect(serverStateCache.read('tenant:menu', loader, { staleMs: 100, maxAgeMs: 1000 }))
      .resolves.toEqual({ version: 1 });
    await Promise.resolve();
    await Promise.resolve();
    await expect(serverStateCache.read('tenant:menu', loader, { staleMs: 100, maxAgeMs: 1000 }))
      .resolves.toEqual({ version: 2 });
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
