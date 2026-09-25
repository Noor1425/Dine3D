export const OPERATING_MODE = Object.freeze({
  INITIALIZING: 'INITIALIZING',
  ONLINE: 'ONLINE',
  EDGE_MODE: 'EDGE_MODE',
  CLOUD_FALLBACK: 'CLOUD_FALLBACK',
  EMERGENCY_PRIMARY: 'EMERGENCY_PRIMARY',
  RECOVERY: 'RECOVERY',
  ISOLATED_RESTRICTED: 'ISOLATED_RESTRICTED',
  UPDATE_REQUIRED: 'UPDATE_REQUIRED',
});

export const OPERATING_MODE_PRESENTATION = Object.freeze({
  [OPERATING_MODE.INITIALIZING]: {
    label: 'Checking restaurant connections', tone: 'slate', allowsCommit: false,
  },
  [OPERATING_MODE.ONLINE]: {
    label: 'Online', tone: 'green', allowsCommit: true,
  },
  [OPERATING_MODE.EDGE_MODE]: {
    label: 'Operating locally', tone: 'yellow', allowsCommit: true,
  },
  [OPERATING_MODE.CLOUD_FALLBACK]: {
    label: 'Using cloud fallback', tone: 'blue', allowsCommit: true,
  },
  [OPERATING_MODE.EMERGENCY_PRIMARY]: {
    label: 'Emergency Primary POS', tone: 'red', allowsCommit: true,
  },
  [OPERATING_MODE.RECOVERY]: {
    label: 'Recovering restaurant state', tone: 'purple', allowsCommit: false,
  },
  [OPERATING_MODE.ISOLATED_RESTRICTED]: {
    label: 'Local network unavailable', tone: 'red', allowsCommit: false,
  },
  [OPERATING_MODE.UPDATE_REQUIRED]: {
    label: 'Update required', tone: 'red', allowsCommit: false,
  },
});

export function deriveOperatingMode({
  cloudReachable,
  edgeReachable,
  edgeConfigured,
  isPrimaryPos,
  recoveryRequired = false,
  reconciliationComplete = false,
  compatible = true,
}) {
  if (!compatible) return OPERATING_MODE.UPDATE_REQUIRED;
  if (cloudReachable === null || (edgeConfigured && edgeReachable === null)) {
    return OPERATING_MODE.INITIALIZING;
  }
  if (recoveryRequired && (edgeReachable || cloudReachable) && !reconciliationComplete) {
    return OPERATING_MODE.RECOVERY;
  }
  if (edgeReachable) return cloudReachable ? OPERATING_MODE.ONLINE : OPERATING_MODE.EDGE_MODE;
  if (cloudReachable) return edgeConfigured ? OPERATING_MODE.CLOUD_FALLBACK : OPERATING_MODE.ONLINE;
  return isPrimaryPos ? OPERATING_MODE.EMERGENCY_PRIMARY : OPERATING_MODE.ISOLATED_RESTRICTED;
}

function stabilize(previous, observed, counter, threshold) {
  if (previous === null) {
    if (observed) return { value: true, counter: 0 };
    const nextCounter = counter + 1;
    return { value: nextCounter >= threshold ? false : null, counter: nextCounter };
  }
  if (previous === observed) return { value: previous, counter: 0 };
  const nextCounter = counter + 1;
  return { value: nextCounter >= threshold ? observed : previous, counter: nextCounter };
}

/**
 * Converts independent Cloud and Edge health probes into one authoritative
 * operating mode. Failure hysteresis prevents a single slow request from
 * switching restaurant authority; recovery also requires consecutive health.
 */
export class OperatingModeController {
  constructor({ failureThreshold = 2, recoveryThreshold = 2 } = {}) {
    this.failureThreshold = Math.max(1, Number(failureThreshold) || 2);
    this.recoveryThreshold = Math.max(1, Number(recoveryThreshold) || 2);
    this.reset();
  }

  reset() {
    this.mode = OPERATING_MODE.INITIALIZING;
    this.modeSince = new Date().toISOString();
    this.cloudReachable = null;
    this.edgeReachable = null;
    this.cloudCounter = 0;
    this.edgeCounter = 0;
    this.recoveryRequired = false;
  }

  observe({
    cloudReachable,
    edgeReachable,
    edgeConfigured = false,
    isPrimaryPos = false,
    reconciliationComplete = false,
    compatible = true,
  }) {
    const cloud = stabilize(
      this.cloudReachable,
      Boolean(cloudReachable),
      this.cloudCounter,
      cloudReachable ? this.recoveryThreshold : this.failureThreshold,
    );
    this.cloudReachable = cloud.value;
    this.cloudCounter = cloud.counter;

    if (!edgeConfigured) {
      this.edgeReachable = false;
      this.edgeCounter = 0;
    } else {
      const edge = stabilize(
        this.edgeReachable,
        Boolean(edgeReachable),
        this.edgeCounter,
        edgeReachable ? this.recoveryThreshold : this.failureThreshold,
      );
      this.edgeReachable = edge.value;
      this.edgeCounter = edge.counter;
    }

    const authorityRestored = this.edgeReachable === true || this.cloudReachable === true;
    if (this.mode === OPERATING_MODE.EMERGENCY_PRIMARY && authorityRestored) {
      this.recoveryRequired = true;
    }
    if (this.recoveryRequired && reconciliationComplete) this.recoveryRequired = false;

    const nextMode = deriveOperatingMode({
      cloudReachable: this.cloudReachable,
      edgeReachable: this.edgeReachable,
      edgeConfigured,
      isPrimaryPos,
      recoveryRequired: this.recoveryRequired,
      reconciliationComplete,
      compatible,
    });
    const changed = nextMode !== this.mode;
    if (changed) {
      this.mode = nextMode;
      this.modeSince = new Date().toISOString();
    }
    return {
      mode: this.mode,
      modeSince: this.modeSince,
      changed,
      recoveryRequired: this.recoveryRequired,
      health: {
        browserToCloud: this.cloudReachable,
        browserToEdge: edgeConfigured ? this.edgeReachable : null,
      },
    };
  }
}

export function operationPolicy(mode, deviceType = 'POS') {
  if ([OPERATING_MODE.ONLINE, OPERATING_MODE.EDGE_MODE, OPERATING_MODE.CLOUD_FALLBACK].includes(mode)) {
    return { canCommit: true, canDraft: true, reason: null };
  }
  if (mode === OPERATING_MODE.EMERGENCY_PRIMARY) {
    return deviceType === 'PRIMARY_POS'
      ? { canCommit: true, canDraft: true, reason: 'Emergency operations are restricted to this designated Primary POS.' }
      : { canCommit: false, canDraft: true, reason: 'Only the designated branch Primary POS may commit during full isolation.' };
  }
  if (deviceType === 'WAITER') {
    return { canCommit: false, canDraft: true, reason: 'Offline draft mode. Reconnect or send this order through the Main POS.' };
  }
  return { canCommit: false, canDraft: true, reason: 'Ordering is temporarily restricted. Use the branch Primary POS.' };
}
