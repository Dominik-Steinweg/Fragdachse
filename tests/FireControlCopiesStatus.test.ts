import { describe, expect, it } from 'vitest';
import { getFireControlCopiesStatus } from '../src/systems/fireControl/FireControlCopiesStatus';
import type { FireControlCopiesDeploymentSnapshot, FireControlSnapshot } from '../src/systems/fireControl/FireControlSnapshot';
import { buildInitialLocalArenaHudData, buildLocalArenaHudData } from '../src/ui/LocalArenaHudData';
import { t } from '../src/i18n';

const deployment: FireControlCopiesDeploymentSnapshot = Object.freeze({
  id: 1, ownerId: 'local', ownerColor: 0, kind: 'copies',
  x: 0, y: 0, startedAt: 1_000, expiresAt: 5_000, parallel: false, copies: [],
});
const snapshot: FireControlSnapshot = Object.freeze({ deployments: Object.freeze([deployment]) });

describe('replicated fire-control copies status', () => {
  it('reads the own copies deployment and remaining host-time duration without changing it', () => {
    const status = getFireControlCopiesStatus(snapshot, 'local', 3_250);
    expect(status).toEqual({ deployment, remainingMs: 1_750 });
    expect(status?.deployment).toBe(deployment);
    expect(getFireControlCopiesStatus(snapshot, 'local', 4_999)?.remainingMs).toBe(1);
  });

  it('ignores foreign owners, portals, expired deployments and empty snapshots', () => {
    const mixed: FireControlSnapshot = { deployments: [
      { ...deployment, kind: 'portal', localFireRelease: false, entries: [] },
      { ...deployment, ownerId: 'remote' },
      { ...deployment, expiresAt: 2_000 },
      deployment,
    ] };
    expect(getFireControlCopiesStatus(mixed, 'local', 3_000)?.deployment).toBe(deployment);
    expect(getFireControlCopiesStatus(snapshot, 'other', 3_000)).toBeNull();
    expect(getFireControlCopiesStatus(snapshot, 'local', 5_000)).toBeNull();
    expect(getFireControlCopiesStatus(snapshot, 'local', 6_000)).toBeNull();
    expect(getFireControlCopiesStatus({ deployments: [] }, 'local', 3_000)).toBeNull();
    expect(getFireControlCopiesStatus({ deployments: mixed.deployments.slice(0, 3) }, 'local', 3_000)).toBeNull();
  });
});

describe('copies utility HUD projection', () => {
  const params = {
    ...buildInitialLocalArenaHudData({ ultimateRequiredRage: 100, ultimateThresholds: [100] }),
    utilityId: 'FIRE_CONTROL_RELAY', utilityCooldownFrac: 0.75,
  };
  const source = (now: number, state = snapshot, ownerId = 'local') => ({
    getFireControlSnapshot: () => state,
    getBomberSquadronSnapshot: () => ({ squadrons: [] }),
    getLocalPlayerId: () => ownerId,
    getSynchronizedNow: () => now,
  });

  it('shows active and remaining time on the selected utility, then restores published cooldown', () => {
    expect(buildLocalArenaHudData(params, source(3_250))).toMatchObject({
      utilityStatusLabel: `${t('ui.fireControl.copiesActive')} 1.8 s`,
      utilityBlocked: true, utilityCooldownFrac: 0,
    });
    expect(buildLocalArenaHudData(params, source(5_000))).toMatchObject({
      utilityStatusLabel: undefined, utilityBlocked: false, utilityCooldownFrac: 0.75,
    });
  });

  it('clears removed deployments and leaves other owners and selected actions unchanged', () => {
    for (const port of [source(3_000, { deployments: [] }), source(3_000, snapshot, 'remote')]) {
      expect(buildLocalArenaHudData(params, port)).toEqual(buildLocalArenaHudData(params));
    }
    for (const selection of [
      { utilityId: 'TIME_BUBBLE' },
      { utilityAction: 'dismantle' as const },
      { persistentBaseRewardId: 'base_health_pedestal' as const },
    ]) {
      const input = { ...params, ...selection };
      expect(buildLocalArenaHudData(input, source(3_000))).toEqual(buildLocalArenaHudData(input));
    }
  });
});
