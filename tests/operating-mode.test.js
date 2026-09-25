import {
  OPERATING_MODE,
  OperatingModeController,
  deriveOperatingMode,
  operationPolicy,
} from '../src/lib/offline/operatingMode';

describe('restaurant operating-mode authority', () => {
  test.each([
    [{ cloudReachable: true, edgeReachable: true, edgeConfigured: true }, OPERATING_MODE.ONLINE],
    [{ cloudReachable: false, edgeReachable: true, edgeConfigured: true }, OPERATING_MODE.EDGE_MODE],
    [{ cloudReachable: true, edgeReachable: false, edgeConfigured: true }, OPERATING_MODE.CLOUD_FALLBACK],
    [{ cloudReachable: true, edgeReachable: false, edgeConfigured: false }, OPERATING_MODE.ONLINE],
    [{ cloudReachable: false, edgeReachable: false, edgeConfigured: true, isPrimaryPos: true }, OPERATING_MODE.EMERGENCY_PRIMARY],
    [{ cloudReachable: false, edgeReachable: false, edgeConfigured: true, isPrimaryPos: false }, OPERATING_MODE.ISOLATED_RESTRICTED],
  ])('derives the correct authority mode for %o', (signals, expected) => {
    expect(deriveOperatingMode(signals)).toBe(expected);
  });

  test('does not enter emergency mode after one failed probe', () => {
    const controller = new OperatingModeController({ failureThreshold: 2, recoveryThreshold: 2 });
    expect(controller.observe({ cloudReachable: false, edgeReachable: false, edgeConfigured: true, isPrimaryPos: true }).mode)
      .toBe(OPERATING_MODE.INITIALIZING);
    expect(controller.observe({ cloudReachable: false, edgeReachable: false, edgeConfigured: true, isPrimaryPos: true }).mode)
      .toBe(OPERATING_MODE.EMERGENCY_PRIMARY);
  });

  test('requires recovery after emergency authority returns', () => {
    const controller = new OperatingModeController({ failureThreshold: 1, recoveryThreshold: 1 });
    controller.observe({ cloudReachable: false, edgeReachable: false, edgeConfigured: true, isPrimaryPos: true });
    expect(controller.observe({ cloudReachable: false, edgeReachable: true, edgeConfigured: true, isPrimaryPos: true }).mode)
      .toBe(OPERATING_MODE.RECOVERY);
    expect(controller.observe({ cloudReachable: false, edgeReachable: true, edgeConfigured: true, isPrimaryPos: true, reconciliationComplete: true }).mode)
      .toBe(OPERATING_MODE.EDGE_MODE);
  });

  test('restricts isolated waiter devices to drafts', () => {
    expect(operationPolicy(OPERATING_MODE.ISOLATED_RESTRICTED, 'WAITER')).toMatchObject({ canCommit: false, canDraft: true });
    expect(operationPolicy(OPERATING_MODE.EMERGENCY_PRIMARY, 'PRIMARY_POS')).toMatchObject({ canCommit: true });
    expect(operationPolicy(OPERATING_MODE.EMERGENCY_PRIMARY, 'POS')).toMatchObject({ canCommit: false, canDraft: true });
  });
});
