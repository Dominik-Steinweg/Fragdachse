import { UTILITY_CONFIGS } from '../src/loadout/LoadoutConfig';
import type { DecoyUtilityConfig } from '../src/loadout/LoadoutTypes';
import { applyCoopDefenseModifiersToUtilityConfig } from '../src/loadout/CoopDefenseLoadoutModifiers';
import { getCoopDefenseResolvedEffectTotals } from '../src/utils/coopDefenseUpgrades';
import { DecoyRuntime } from '../src/systems/DecoyRuntime';
import { CoopDefenseDecoyTargetSystem, type DecoyEnemyTargetSubject } from '../src/systems/CoopDefenseDecoyTargetSystem';
import { FlowFieldCoordinator } from '../src/systems/flowfield/FlowFieldCoordinator';
import { InlineFlowFieldRunner } from '../src/systems/flowfield/FlowFieldRunner';
import { buildStaticKindRaster, createFlowFieldTuning } from '../src/systems/flowfield/FlowFieldSources';
import { EnemyFlowFieldService } from '../src/systems/EnemyFlowFieldService';
import { EnemyStrategicTargetService } from '../src/systems/EnemyStrategicTargetService';
import type { ArenaLayout } from '../src/types';
import type { EnemyAiTargetRef } from '../src/systems/EnemyAiTargetCatalog';

export const fullDecoyLevels = {
  unlock_decoy: 1, decoy_mass_distraction: 3, decoy_irresistible_lure: 3,
  decoy_shadow_runner: 3, decoy_shadow_regeneration: 3, decoy_explosive_dummy: 1,
  decoy_fire_chunks: 3, decoy_fire_trail: 3,
};
export function resolvedDecoy(levels: Record<string, number> = fullDecoyLevels): DecoyUtilityConfig {
  const profile = { upgrades: Object.fromEntries(Object.entries(levels).map(([id, level]) => [id, { unlocked: level > 0, level }])) };
  const config = applyCoopDefenseModifiersToUtilityConfig(UTILITY_CONFIGS.DECOY, getCoopDefenseResolvedEffectTotals(profile, 'dachs_nukem'));
  if (config.type !== 'decoy') throw Error('Expected decoy');
  return config;
}
export function decoyInput(overrides: Partial<Parameters<DecoyRuntime['activate']>[0]> = {}) {
  return { ownerId: 'owner', position: { x: 240, y: 176 }, config: resolvedDecoy({}),
    hp: 17, maxHp: 120, armor: 9, maxArmor: 100, color: 0xffffff, rotation: 0.3, speed: 80, now: 1000, ...overrides };
}
export function decoyTargetHarness() {
  const metrics = { cols: 24, rows: 16, cellSize: 32, arenaOffsetX: 0, arenaOffsetY: 0 };
  const layout = { seed: 1, rocks: [], trees: [], tracks: [], dirt: [], powerUpPedestals: [] } as unknown as ArenaLayout;
  const runner = new InlineFlowFieldRunner(true);
  const coordinator = new FlowFieldCoordinator({ metrics, tuning: createFlowFieldTuning(),
    staticKind: buildStaticKindRaster(layout, metrics), bases: [], activeBaseIds: new Set(),
    obstacleCellProvider: () => [], runner, navTickIntervalMs: 50 });
  coordinator.registerField('player', { goalMode: 'dynamic' });
  coordinator.registerField('boss', { goalMode: 'dynamic', clearanceCells: 1 });
  const strategic = new EnemyStrategicTargetService(EnemyFlowFieldService.fromView(
    coordinator.registerField('strategic', { goalMode: 'dynamic' })));
  const enemies: Array<DecoyEnemyTargetSubject> = [];
  const attackTargets = new Map<string, EnemyAiTargetRef>();
  let visible = true;
  const targets = new CoopDefenseDecoyTargetSystem({ coordinator, strategicTargets: strategic,
    getEnemies: () => enemies, getAttackTarget: id => attackTargets.get(id) ?? null,
    isEnemyOfOwner: () => true, canSee: () => visible });
  const runtime = new DecoyRuntime();
  const spawn = (overrides: Partial<Parameters<DecoyRuntime['activate']>[0]> = {}) => {
    const input = decoyInput(overrides);
    targets.beforeActivate(input.ownerId);
    const decoy = runtime.activate(input)!;
    targets.activated(decoy);
    return decoy;
  };
  const enemy = (id: string, overrides: Partial<DecoyEnemyTargetSubject> = {}) => {
    const result = { id, x: 144, y: 176, alive: true, hostile: true, clearanceCells: 0, movementFieldId: 'base', ...overrides };
    enemies.push(result);
    return result;
  };
  const step = () => { targets.prepareNavigation(); coordinator.prepareNow(); targets.updateLocks(); };
  const end = (id: number, reason: 'killed' | 'expired' | 'cleanup' = 'expired') => targets.ended(runtime.end(id, reason)!);
  const close = () => { targets.destroy(); coordinator.destroy(); };
  return { runtime, targets, coordinator, runner, enemies, attackTargets, spawn, enemy, step, end, close,
    setVisible: (value: boolean) => { visible = value; } };
}
