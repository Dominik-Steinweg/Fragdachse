import { getDawnNightModifier, getDawnSchedule, getDawnWaveBlock, getDawnWaveComposition, type DawnArenaTemplate } from '../../config/dawn/dawnContent';
import type { CoopDefenseMapAirstrikeEventConfig, CoopDefenseMapEncounterConfig } from '../../config/coopDefenseMapAuthoring';
import type { DawnActivityPlan } from '../contracts/DawnPlans';
import { getDawnPhaseStartMs, resolveDawnPhase } from '../rules/DawnPhase';

/** Pure Activity environment projection; callers restore the World baseline outside the night. */
export function resolveDawnNightEnvironment(plan: DawnActivityPlan | undefined, elapsedMs: number) {
  if (!plan?.nightModifierId || elapsedMs < 0 || !Number.isFinite(elapsedMs)) return null;
  if (resolveDawnPhase(getDawnSchedule(plan.scheduleId), elapsedMs).phase !== 'night') return null;
  const modifier = getDawnNightModifier(plan.nightModifierId);
  return { modifierId: modifier.id, fogStrength: modifier.fogStrength, fogTint: modifier.fogTint };
}

/** Existing timed airstrikes and enemy blocks: no new damage, HP or snapshot rules. */
export function resolveDawnNightModifierContent(template: DawnArenaTemplate, plan: DawnActivityPlan) {
  const encounters: CoopDefenseMapEncounterConfig[] = [];
  const mapEvents: CoopDefenseMapAirstrikeEventConfig[] = [];
  if (!plan.nightModifierId) return { encounters, mapEvents };
  const modifier = getDawnNightModifier(plan.nightModifierId);
  const schedule = getDawnSchedule(plan.scheduleId);
  const start = getDawnPhaseStartMs(schedule, 'night');
  const end = getDawnPhaseStartMs(schedule, 'dawn');
  const fronts = [...new Set(plan.waves.flatMap(wave => 'front' in wave && wave.atMs >= start && wave.atMs < end ? [wave.front] : []))];
  if (!fronts.length) return { encounters, mapEvents };
  for (const [index, slot] of getDawnWaveComposition().night.waves.entries()) {
    const atMs = start + Math.floor(slot.startRatio * (end - start));
    const blockId = modifier.additionalBlocks?.[index % modifier.additionalBlocks.length];
    if (blockId) encounters.push({ id: `${slot.id}-modifier-${modifier.id}`, start: { type: 'time', atMs },
      announce: { group: slot.id, ...(slot.id === 'finale' ? { finale: true } : {}) },
      groups: getDawnWaveBlock(blockId).groups.map(group => ({ ...group, front: fronts[index % fronts.length] })) });
  }
  const air = modifier.airstrikes;
  if (air) {
    // Finite zone barrages, unlike Map 11's unbounded player-hunt loop, stop before dawn.
    const width = template.world.arenaWidthCells!, height = template.world.arenaHeightCells!;
    const anchor = template.world.persistentBase.anchor;
    const gridX = Math.max(0, anchor.gridX - air.radiusCells), gridY = Math.max(0, anchor.gridY - air.radiusCells);
    for (let atMs = start, index = 0; atMs + air.endClearanceMs < end; atMs += air.intervalMs, index++) {
      mapEvents.push({ id: `night-bombers-${index}`, type: 'airstrike', start: { type: 'time', atMs },
        pattern: 'zone-barrage', strikeCount: air.strikeCount,
        area: { gridX, gridY,
          widthCells: Math.min(width, anchor.gridX + air.radiusCells + 1) - gridX,
          heightCells: Math.min(height, anchor.gridY + air.radiusCells + 1) - gridY } });
    }
  }
  return { encounters, mapEvents };
}
