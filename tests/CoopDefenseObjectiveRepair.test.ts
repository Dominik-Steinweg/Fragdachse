import { describe, expect, it } from 'vitest';
import { COOP_DEFENSE_OBJECTIVE_REPAIR_CONFIG } from '../src/config/coopDefenseObjectiveRepair';
import { CoopDefenseObjectiveRepairSystem } from '../src/systems/CoopDefenseObjectiveRepairSystem';

const { approachMs, repairMs } = COOP_DEFENSE_OBJECTIVE_REPAIR_CONFIG;

function makeSystem(startHp = 300, maxHp = 1_200) {
  const state = { hp: startHp, healCalls: 0 };
  const system = new CoopDefenseObjectiveRepairSystem({
    healBase: (_baseId, amount) => {
      state.healCalls += 1;
      state.hp = Math.min(maxHp, state.hp + amount);
    },
    getBaseHp: () => state.hp,
    getBaseMaxHp: () => maxHp,
  });
  return { system, state, maxHp };
}

describe('Coop defense objective repair', () => {
  it('heals only while the drones are on station and lands exactly on full hp', () => {
    const { system, state, maxHp } = makeSystem();
    system.start('outpost');

    system.hostUpdate(approachMs, false);
    expect(state.healCalls).toBe(0);
    expect(state.hp).toBe(300);

    system.hostUpdate(repairMs / 2, false);
    expect(state.hp).toBeGreaterThan(300);
    expect(state.hp).toBeLessThan(maxHp);

    system.hostUpdate(repairMs / 2, false);
    expect(state.hp).toBeCloseTo(maxHp, 6);
    expect(system.isRepairing('outpost')).toBe(false);

    // Nach dem Ende laeuft kein Heilstrom weiter.
    const callsAfterCompletion = state.healCalls;
    system.hostUpdate(1_000, false);
    expect(state.healCalls).toBe(callsAfterCompletion);
  });

  it('ignores a repeated start and never overshoots the maximum', () => {
    const { system, state, maxHp } = makeSystem();
    system.start('outpost');
    system.hostUpdate(approachMs, false);
    system.start('outpost');

    system.hostUpdate(repairMs, false);
    expect(state.hp).toBeCloseTo(maxHp, 6);
  });

  it('does not start on a full or missing base', () => {
    const { system } = makeSystem(1_200);
    system.start('outpost');
    expect(system.isRepairing('outpost')).toBe(false);

    const missing = new CoopDefenseObjectiveRepairSystem({
      healBase: () => undefined,
      getBaseHp: () => null,
      getBaseMaxHp: () => null,
    });
    missing.start('outpost');
    expect(missing.isRepairing('outpost')).toBe(false);
  });

  it('abandons a target that is lost during the repair', () => {
    const { system, state } = makeSystem();
    system.start('outpost');
    system.hostUpdate(approachMs + repairMs / 4, false);
    const callsBeforeLoss = state.healCalls;

    state.hp = 0;
    system.hostUpdate(repairMs / 4, false);
    expect(system.isRepairing('outpost')).toBe(false);
    expect(state.healCalls).toBe(callsBeforeLoss);
  });

  it('freezes during the countdown and drops running repairs on reset', () => {
    const { system, state } = makeSystem();
    system.start('outpost');
    system.hostUpdate(approachMs + repairMs, true);
    expect(state.healCalls).toBe(0);
    expect(system.isRepairing('outpost')).toBe(true);

    system.reset();
    system.hostUpdate(approachMs + repairMs, false);
    expect(state.healCalls).toBe(0);
    expect(state.hp).toBe(300);
  });
});
