import { describe, expect, it } from 'vitest';
import * as enemyConfig from '../src/config/coopDefenseEnemies';
import { decodeEnemyUpserts, encodeEnemyUpsert } from '../src/network/enemySnapshotCodec';
import {
  ENERGY_CONE_CLIP_RAYS, energyConeReachAt, energyConeRayAngle, isEnergyConeState, quantizeEnergyConeReach,
  type EnergyConeAttack, type EnergyConeState,
} from '../src/systems/EnergyConeState';

const config = enemyConfig.getCoopDefenseEnemyConfig('alien-badger').energyCone!;

function attack(clip: number[] = Array(ENERGY_CONE_CLIP_RAYS).fill(1)): EnergyConeAttack {
  return { originX: 100.5, originY: -40, angle: 2.3456, range: 340, arcDegrees: 80,
    startedAt: 1000, hitAt: 2000, recoverUntil: 2400, clip };
}

describe('energy cone contracts', () => {
  it('belongs to the alien badger with an authored band inside the impulse reach', () => {
    expect(config.triggerMinDistancePx).toBeLessThan(config.triggerMaxDistancePx);
    expect(config.triggerMaxDistancePx).toBeLessThanOrEqual(config.rangePx);
    expect(enemyConfig.getCoopDefenseEnemyConfig('zombie-badger').energyCone).toBeUndefined();
  });

  it('rejects inconsistent authored relationships', () => {
    for (const bad of [
      { ...config, triggerMinDistancePx: config.triggerMaxDistancePx },
      { ...config, triggerMaxDistancePx: config.rangePx + 1 },
      { ...config, arcDegrees: 180 },
      { ...config, coverRefreshMs: config.windupMs + 1 },
      { ...config, windupMs: 0 },
    ]) expect(() => enemyConfig.normalizeEnergyConeConfig(bad)).toThrow(/energy cone/);
  });

  it('round-trips the host-fixed cone and its quantized cover profile on an appended snapshot field', () => {
    const clip = Array.from({ length: ENERGY_CONE_CLIP_RAYS }, (_, i) => quantizeEnergyConeReach(i / (ENERGY_CONE_CLIP_RAYS - 1)));
    const state: EnergyConeState = { revision: 4, phase: 'windup', attack: attack(clip) };
    const wire: (number | string)[] = [];
    encodeEnemyUpsert(wire, { id: 'e1', energyCone: state });
    const decoded = decodeEnemyUpserts(wire)[0].energyCone!;
    expect(decoded).toMatchObject({ revision: 4, phase: 'windup', attack: { originX: 100.5, range: 340, arcDegrees: 80, hitAt: 2000 } });
    expect(decoded.attack!.angle).toBeCloseTo(2.3456, 4);
    expect(decoded.attack!.clip).toEqual(clip);
    // A cancelled windup travels as phase none without an attack.
    const cancelled: (number | string)[] = [];
    encodeEnemyUpsert(cancelled, { id: 'e1', energyCone: { revision: 5, phase: 'none', attack: null } });
    expect(decodeEnemyUpserts(cancelled)[0].energyCone).toEqual({ revision: 5, phase: 'none', attack: null });
    // Older fields keep their wire bits.
    const legacy: (number | string)[] = [];
    encodeEnemyUpsert(legacy, { id: 'e1', shieldCharge: { revision: 1, phase: 'none', lane: null } });
    expect(decodeEnemyUpserts(legacy)[0].energyCone).toBeUndefined();
  });

  it('validates the state structurally and interpolates the cover profile between rays', () => {
    expect(isEnergyConeState({ revision: 1, phase: 'windup', attack: attack() })).toBe(true);
    expect(isEnergyConeState({ revision: 1, phase: 'windup', attack: attack([1, 1]) })).toBe(false);
    expect(isEnergyConeState({ revision: 1, phase: 'windup', attack: { ...attack(), hitAt: 500 } })).toBe(false);
    const clip = Array(ENERGY_CONE_CLIP_RAYS).fill(1);
    clip[7] = 0.5; clip[8] = 0.5;
    const blocked = attack(clip);
    const half = blocked.arcDegrees * Math.PI / 360;
    expect(energyConeRayAngle(blocked, 0)).toBeCloseTo(blocked.angle - half);
    expect(energyConeRayAngle(blocked, ENERGY_CONE_CLIP_RAYS - 1)).toBeCloseTo(blocked.angle + half);
    expect(energyConeReachAt(blocked, 0)).toBeCloseTo(170); // between rays 7 and 8 (both 0.5)
    expect(energyConeReachAt(blocked, -half)).toBeCloseTo(340);
    expect(energyConeReachAt(blocked, half + 0.01)).toBe(0);
  });
});
