import { describe, expect, it } from 'vitest';
import {
  COOP_DEFENSE_TEAM_BUFF_DEFAULTS,
  getCoopDefenseMapConfig,
  type ResolvedCoopDefenseMapSecondaryObjectiveConfig,
} from '../src/config/coopDefenseMaps';
import { CoopDefenseSecondaryObjectiveSystem } from '../src/systems/CoopDefenseSecondaryObjectiveSystem';
import { CoopDefenseTeamBuffSystem } from '../src/systems/CoopDefenseTeamBuffSystem';
import {
  canRoundPlayerReceiveRewards,
  createRoundParticipationState,
  enterRoundSpectator,
} from '../src/scenes/arena/RoundParticipationPolicy';

const TEAM_BUFF = {
  defId: COOP_DEFENSE_TEAM_BUFF_DEFAULTS.defId,
  durationMs: COOP_DEFENSE_TEAM_BUFF_DEFAULTS.durationMs,
  hpRegenPerSecond: COOP_DEFENSE_TEAM_BUFF_DEFAULTS.hpRegenPerSecond,
  adrenalineRegenMultiplier: COOP_DEFENSE_TEAM_BUFF_DEFAULTS.adrenalineRegenMultiplier,
} as const;

function carryObjective(targetGoal = 3): ResolvedCoopDefenseMapSecondaryObjectiveConfig {
  return {
    id: 'carry-beer',
    type: 'carry',
    start: { type: 'time', atMs: 0 },
    targets: [],
    targetGoal,
    rewards: { teamBuffOnComplete: TEAM_BUFF },
    carry: {
      spawnZone: { gridX: 1, gridY: 1, widthCells: 1, heightCells: 1 },
      deliveryZone: { gridX: 10, gridY: 1, widthCells: 1, heightCells: 1 },
      itemCount: targetGoal,
    },
  };
}

describe('Coop Defense B9 team buff state', () => {
  it('activates exactly once and keeps one shared end timestamp', () => {
    const system = new CoopDefenseTeamBuffSystem();

    expect(system.activate(TEAM_BUFF, 1_000)).toBe(true);
    expect(system.getBuffEndsAt()).toBe(1_000 + TEAM_BUFF.durationMs);
    expect(system.activate(TEAM_BUFF, 10_000)).toBe(false);
    expect(system.getBuffEndsAt()).toBe(1_000 + TEAM_BUFF.durationMs);
  });

  it('expires at the shared end and is fully reset between rounds', () => {
    const system = new CoopDefenseTeamBuffSystem();
    system.activate(TEAM_BUFF, 1_000);

    const expiresAt = 1_000 + TEAM_BUFF.durationMs;
    expect(system.isActive(expiresAt - 1)).toBe(true);
    expect(system.isActive(expiresAt)).toBe(false);
    expect(system.getHudBuff(expiresAt, true, true)).toBeNull();

    system.reset();
    expect(system.getBuffEndsAt()).toBeNull();
    expect(system.activate(TEAM_BUFF, 5_000)).toBe(true);
    expect(system.getBuffEndsAt()).toBe(5_000 + TEAM_BUFF.durationMs);
  });

  it('adds HP regeneration and multiplies the effective adrenaline rate without replacing modifiers', () => {
    const system = new CoopDefenseTeamBuffSystem();
    system.activate(TEAM_BUFF, 1_000);

    const existingHpRegen = 7;
    expect(existingHpRegen + system.getHpRegenBonus(2_000, true, true))
      .toBe(existingHpRegen + TEAM_BUFF.hpRegenPerSecond);

    const classAndUpgradeRate = 12;
    const itemRuntimeMultiplier = 1.2;
    const effectiveRate = classAndUpgradeRate
      * itemRuntimeMultiplier
      * system.getAdrenalineRegenMultiplier(2_000, true, true);
    expect(effectiveRate).toBeCloseTo(
      classAndUpgradeRate * itemRuntimeMultiplier * TEAM_BUFF.adrenalineRegenMultiplier,
      10,
    );
    expect(system.getAdrenalineRegenMultiplier(2_000, true, false)).toBe(1);
  });

  it('uses reward eligibility and alive state, while respawn receives only remaining duration', () => {
    const participation = createRoundParticipationState(0, ['p1', 'p2']);
    const spectator = enterRoundSpectator(participation, 'p2');
    const system = new CoopDefenseTeamBuffSystem();
    system.activate(TEAM_BUFF, 1_000);

    const eligible = canRoundPlayerReceiveRewards(participation, 'p1');
    const spectatorEligible = canRoundPlayerReceiveRewards(spectator, 'p2');
    expect(system.getHudBuff(1_000, eligible, true)?.remainingFrac).toBe(1);
    expect(system.getHudBuff(1_000, spectatorEligible, true)).toBeNull();
    expect(system.getHudBuff(10_000, eligible, false)).toBeNull();

    // Respawn at 10 s has no player-owned timer: it sees the shared 21 s remainder.
    expect(system.getHudBuff(10_000, eligible, true)?.remainingFrac).toBeCloseTo(
      (TEAM_BUFF.durationMs - 9_000) / TEAM_BUFF.durationMs,
      10,
    );
  });
});

describe('Coop Defense B9 objective completion reward', () => {
  it('does not start at 1/3 or 2/3 and activates once on the completed transition at 3/3', () => {
    const buff = new CoopDefenseTeamBuffSystem();
    const objective = carryObjective();
    const objectiveSystem = new CoopDefenseSecondaryObjectiveSystem([objective], {
      onObjectiveCompleted: (objectiveId) => {
        expect(objectiveId).toBe('carry-beer');
        buff.activate(objective.rewards!.teamBuffOnComplete!, 1_000);
      },
    });

    objectiveSystem.hostUpdate(0, false);
    expect(objectiveSystem.getObjectiveState('carry-beer')).toBe('active');
    expect(objectiveSystem.reportCarryDelivered('carry-beer', 'carry-beer:1')).toBe(true);
    expect(objectiveSystem.reportCarryDelivered('carry-beer', 'carry-beer:2')).toBe(true);
    expect(buff.getBuffEndsAt()).toBeNull();
    expect(objectiveSystem.getObjectiveState('carry-beer')).toBe('active');

    expect(objectiveSystem.reportCarryDelivered('carry-beer', 'carry-beer:3')).toBe(true);
    expect(objectiveSystem.getObjectiveState('carry-beer')).toBe('completed');
    expect(buff.getBuffEndsAt()).toBe(1_000 + TEAM_BUFF.durationMs);
    expect(objectiveSystem.reportCarryDelivered('carry-beer', 'carry-beer:3')).toBe(false);
    expect(buff.getBuffEndsAt()).toBe(1_000 + TEAM_BUFF.durationMs);
  });

  it('configures the B9 reward on the authored Carry mission', () => {
    // Bewusst die Kampagnen-Map 17 und nicht die Testarena: Map 0 ist eine loeschbare
    // Stressarena und darf keine Regression tragen.
    const carry = getCoopDefenseMapConfig('17').secondaryObjectives?.find((entry) => entry.type === 'carry');
    expect(carry?.rewards?.itemMetaRewardOnComplete).toBe(true);
    expect(carry?.rewards?.teamBuffOnComplete).toEqual(TEAM_BUFF);
  });
});
