import { describe, expect, it } from 'vitest';
import type { FireControlHoloDeploymentSnapshot, FireControlSnapshot } from '../src/systems/fireControl/FireControlSnapshot';
import type { BomberSquadronDeploymentSnapshot, BomberSquadronSnapshot } from '../src/systems/bomberSquadron/BomberSquadronSnapshot';
import { getUltimateDeploymentKind, getUltimateDeploymentRemainingMs } from '../src/ui/UltimateDeploymentStatus';
import { buildInitialLocalArenaHudData, buildLocalArenaHudData } from '../src/ui/LocalArenaHudData';

const holo: FireControlHoloDeploymentSnapshot = {
  id: 1, kind: 'holo', ownerId: 'local', ownerColor: 0, x: 0, y: 0,
  startedAt: 1000, expiresAt: 8000, spawnUntil: 4000, copyLifetimeMs: 4000,
  materializeMs: 100, copies: [],
};
const bomber: BomberSquadronDeploymentSnapshot = {
  id: 1, ownerId: 'local', ownerColor: 0, startedAt: 1000, angle: 0,
  params: {
    droneCount: 2, bombsPerPass: 3, passCount: 2, launchIntervalMs: 200,
    approachMs: 500, approachDistancePx: 200, runSpeedPxPerSec: 300,
    corridorLeadPx: 40, corridorLengthPx: 600, corridorWidthPx: 500,
    turnMs: 1000, departureMs: 600, bombFallMs: 200, explosionRadius: 50,
  },
  anchors: [{ x: 0, y: 0 }, null], stoppedAt: 1100, endsAt: 7000,
};
const fireControl: FireControlSnapshot = { deployments: [holo] };
const bomberSquadron: BomberSquadronSnapshot = { squadrons: [bomber] };

describe('ultimate deployment HUD projection', () => {
  it('uses the latest own holo expiry, ignoring other owners and utility deployments', () => {
    const latest = { ...holo, id: 2, expiresAt: holo.expiresAt + 2000 };
    const snapshot: FireControlSnapshot = { deployments: [
      latest, holo,
      { ...holo, id: 3, ownerId: 'remote', expiresAt: latest.expiresAt + 5000 },
      { ...holo, id: 4, kind: 'copies', parallel: false, copies: [], expiresAt: latest.expiresAt + 6000 },
      { ...holo, id: 5, kind: 'portal', localFireRelease: false, entries: [], expiresAt: latest.expiresAt + 7000 },
    ] };
    const before = JSON.stringify(snapshot);
    expect(getUltimateDeploymentRemainingMs(true, 'holo_offensive', 'local', 3000, snapshot))
      .toBe(latest.expiresAt - 3000);
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it('uses the published bomber end, including a shortened deployment after owner death', () => {
    const snapshot = { squadrons: [bomber, { ...bomber, id: 2, ownerId: 'remote', endsAt: bomber.endsAt + 5000 }] };
    expect(getUltimateDeploymentRemainingMs(true, 'bomber_squadron', 'local', 3000, fireControl, snapshot))
      .toBe(bomber.endsAt - 3000);
  });

  it.each(['HOLO_OFFENSIVE', 'BOMBER_SQUADRON'])(
    'keeps %s active with zero remaining time for missing, foreign or expired snapshots', id => {
      expect(getUltimateDeploymentRemainingMs(true, getUltimateDeploymentKind(id), 'local', 3000)).toBe(0);
      expect(getUltimateDeploymentRemainingMs(true, getUltimateDeploymentKind(id), 'local', 3000, { deployments: [] }, { squadrons: [] })).toBe(0);
      expect(getUltimateDeploymentRemainingMs(true, getUltimateDeploymentKind(id), 'other', 3000, fireControl, bomberSquadron)).toBe(0);
      for (const now of [Math.max(holo.expiresAt, bomber.endsAt), Math.max(holo.expiresAt, bomber.endsAt) + 1]) {
        expect(getUltimateDeploymentRemainingMs(true, getUltimateDeploymentKind(id), 'local', now, fireControl, bomberSquadron)).toBe(0);
      }
    },
  );

  it('never infers activation from snapshots and leaves other ultimates unchanged', () => {
    for (const id of ['HOLO_OFFENSIVE', 'BOMBER_SQUADRON']) {
      expect(getUltimateDeploymentRemainingMs(false, getUltimateDeploymentKind(id), 'local', 3000, fireControl, bomberSquadron)).toBeNull();
    }
    for (const id of ['HONEY_BADGER_RAGE', 'ARMAGEDDON', undefined, null]) {
      expect(getUltimateDeploymentRemainingMs(true, getUltimateDeploymentKind(id), 'local', 3000, fireControl, bomberSquadron)).toBeNull();
    }
  });

  it.each(['HOLO_OFFENSIVE', 'BOMBER_SQUADRON'])('preserves %s rage and active state across HUD refreshes', id => {
    const initial = buildInitialLocalArenaHudData({ ultimateId: id, ultimateRequiredRage: 100, ultimateThresholds: [100] });
    const source = {
      getFireControlSnapshot: () => fireControl,
      getBomberSquadronSnapshot: () => bomberSquadron,
      getLocalPlayerId: () => 'local',
      getSynchronizedNow: () => 3000,
    };
    const endsAt = id === 'HOLO_OFFENSIVE' ? holo.expiresAt : bomber.endsAt;
    for (const rage of [0, initial.ultimateRequiredRage / 2, initial.maxRage]) {
      const active = { ...initial, isUltimateActive: true, activeUltimateId: id, rage };
      expect(buildLocalArenaHudData(active, source)).toMatchObject({
        isUltimateActive: true, rage, ultimateRequiredRage: initial.ultimateRequiredRage,
        ultimateDeploymentRemainingMs: endsAt - source.getSynchronizedNow(),
      });
      expect(buildLocalArenaHudData(active, { ...source, getSynchronizedNow: () => endsAt + 1 }))
        .toMatchObject({ isUltimateActive: true, rage, ultimateDeploymentRemainingMs: 0 });
      expect(buildLocalArenaHudData({ ...active, isUltimateActive: false, activeUltimateId: null }, source))
        .toMatchObject({ isUltimateActive: false, rage, ultimateDeploymentRemainingMs: null });
    }
  });
});
