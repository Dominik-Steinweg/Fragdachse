import type { WeaponSlot } from '../../types';
import type { PerformanceCase } from './contracts';
import { buildPerformanceLoadout as build, presets, type PresetItem } from './loadouts';
import { PERFORMANCE_MAP_ID } from './referenceMap';
export { PERFORMANCE_MAP_ID, REFERENCE_SEED, registerReferenceMap } from './referenceMap';
export const SCENARIO_VERSION = 'reference-1-candidate.3';

export function allPerformanceCases(): PerformanceCase[] {
  const glock = build('GLOCK');
  const base = (id: string, durationMs: number, kind: PerformanceCase['kind'], options: Partial<PerformanceCase> = {}): PerformanceCase => ({
    id, version: 1, durationMs, tailMs: 1000, kind, actionIntervalMs: 350, minimumActions: 0,
    maximumActions: 0, slot: 'weapon1', commit: glock.commit, buildSignature: glock.buildSignature, ...options,
  });
  const weapons: [string, PresetItem, number][] = [
    ['glock', 'GLOCK', 7000], ['p90', 'P90', 7000], ['plasma', 'PLASMA', 7000],
    ['mini-rockets', 'MINI_ROCKET_LAUNCHER', 7000], ['shotgun', 'SHOTGUN', 7000], ['asmd', 'ASMD_PRIM', 7000],
    ['bite', 'BITE', 7000], ['rocket', 'ROCKET_LAUNCHER', 7000], ['tesla', 'TESLA_DOME', 7000], ['flame', 'FLAMETHROWER', 7000],
  ];
  const combat = build('GLOCK', true);
  return [
    base('environment.route', 55_000, 'environment', { mapId: `${PERFORMANCE_MAP_ID}-train` }),
    base('destruction.single', 8000, 'weapon', { itemId: 'GLOCK', maximumActions: undefined, minimumActions: 1, targetDistance: 80, requireHits: false }),
    base('destruction.nuke', 16_000, 'pickup', { itemId: 'NUKE', maximumActions: 1, minimumActions: 1, tailMs: 5000 }),
    base('destruction.bfg', 18_000, 'pickup', { itemId: 'BFG', maximumActions: 1, minimumActions: 1, tailMs: 5000 }),
    base('enemies.low', 6000, 'enemies', { enemyCount: 40 }),
    base('enemies.medium', 8000, 'enemies', { enemyCount: 120 }),
    base('enemies.high', 10_000, 'enemies', { enemyCount: 240 }),
    ...weapons.map(([id, item, duration]) => {
      const loadout = build(item), slot = presets[item].slot as WeaponSlot;
      const cfg = loadout.effective[slot];
      const continuous = item === 'FLAMETHROWER' || item === 'TESLA_DOME';
      const requiredDamageKinds: PerformanceCase['requiredDamageKinds'] = item === 'FLAMETHROWER' ? ['burn']
        : item === 'TESLA_DOME' ? ['chain']
        : ['PLASMA', 'MINI_ROCKET_LAUNCHER', 'ROCKET_LAUNCHER'].includes(item) ? ['explosion'] : ['direct'];
      return base(`weapon.${id}`, duration, 'weapon', { commit: loadout.commit, buildSignature: loadout.buildSignature, itemId: item, slot,
        actionIntervalMs: continuous ? 0 : Math.max(1, cfg.cooldown), minimumActions: 1, maximumActions: undefined,
        requireHits: true, requiredDamageKinds, continuous, tailMs: 1000, targetDistance: item === 'BITE' ? 38 : item === 'FLAMETHROWER' ? 140 : 220 });
    }),
    ...(['HE_GRENADE', 'MOLOTOV_GRENADE', 'SMOKE_GRENADE'] as const).map((item, i) => {
      const loadout = build(item), cfg = loadout.effective.utility;
      return base(`utility.${['he', 'molotov', 'smoke'][i]}`, 6000, 'utility', { commit: loadout.commit, buildSignature: loadout.buildSignature, itemId: item,
        actionIntervalMs: cfg.cooldown + ('fullChargeDuration' in cfg.activation ? cfg.activation.fullChargeDuration : 0),
        minimumActions: 1, maximumActions: undefined, requireHits: item !== 'SMOKE_GRENADE', tailMs: 6000 });
    }),
    base('construction.defense', 12_000, 'construction', { commit: combat.commit, buildSignature: combat.buildSignature, enemyCount: 24, minimumActions: 4, maximumActions: 4, actionIntervalMs: 2000 }),
    base('ultimate.armageddon', 10_000, 'utility', { ...build('ARMAGEDDON'), itemId: 'ARMAGEDDON', minimumActions: 1, maximumActions: 1, requireHits: true, tailMs: 5000 }),
    base('combat.day', 30_000, 'combat', { commit: combat.commit, buildSignature: combat.buildSignature, enemyCount: 40, timeOfDay: 720, requireHits: true }),
    base('combat.night', 30_000, 'combat', { commit: combat.commit, buildSignature: combat.buildSignature, enemyCount: 40, timeOfDay: 0, requireHits: true }),
    base('recovery.idle', 10_000, 'recovery', { ...build('ARMAGEDDON'), itemId: 'ARMAGEDDON', tailMs: 0 }),
  ];
}

export function resolvePerformanceCases(caseId: string): PerformanceCase[] {
  const all = allPerformanceCases();
  if (caseId === 'standard') return all;
  const selected = caseId === 'combat.day-night' ? all.filter(c => c.kind === 'combat' || c.kind === 'recovery') : all.filter(c => c.id === caseId);
  if (!selected.length) throw new Error(`Unknown performance case: ${caseId}`);
  return selected;
}
