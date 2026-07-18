import { describe, expect, it } from 'vitest';
import type { BaseManager } from '../src/entities/BaseManager';
import { CoopDefenseRoundStateSystem } from '../src/systems/CoopDefenseRoundStateSystem';

function createBaseManager(hpValues: number[]): BaseManager {
  return {
    getBases: () => hpValues.map((hp) => ({ getHp: () => hp })),
  } as unknown as BaseManager;
}

describe('CoopDefenseRoundStateSystem', () => {
  it('loses only after all bases are destroyed', () => {
    expect(new CoopDefenseRoundStateSystem(createBaseManager([0, 500]), () => 10).update()).toBeNull();
    expect(new CoopDefenseRoundStateSystem(createBaseManager([0, 0]), () => 10).update()).toBe('defeat');
  });

  it('requires both elapsed time and a defeated boss for boss-map victory', () => {
    expect(new CoopDefenseRoundStateSystem(createBaseManager([500]), () => 0, true, () => false).update()).toBeNull();
    expect(new CoopDefenseRoundStateSystem(createBaseManager([500]), () => 1, true, () => true).update()).toBeNull();
    expect(new CoopDefenseRoundStateSystem(createBaseManager([500]), () => 0, true, () => true).update()).toBe('victory');
  });
});
