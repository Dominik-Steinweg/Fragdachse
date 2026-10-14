import { getDawnNightModifier, getDawnSchedule, getDawnWaveBlock, getDawnWaveComposition, type DawnArenaTemplate } from '../../config/dawn/dawnContent';
import type { CoopDefenseMapEncounterConfig, CoopDefenseMapEventConfig, CoopDefenseMapGroundHazardKeepClear } from '../../config/coopDefenseMapAuthoring';
import type { SpawnFront } from '../../types';
import { getSpawnFrontInwardVector } from '../../utils/spawnFront';
import type { DawnActivityPlan } from '../contracts/DawnPlans';
import { getDawnPhaseStartMs, resolveDawnPhase } from '../rules/DawnPhase';

/** Pure Activity environment projection; callers restore the World baseline outside the night. */
export function resolveDawnNightEnvironment(plan: DawnActivityPlan | undefined, elapsedMs: number) {
  if (!plan?.nightModifierId || elapsedMs < 0 || !Number.isFinite(elapsedMs)) return null;
  if (resolveDawnPhase(getDawnSchedule(plan.scheduleId), elapsedMs).phase !== 'night') return null;
  const modifier = getDawnNightModifier(plan.nightModifierId);
  return { modifierId: modifier.id, fogStrength: modifier.fogStrength, fogTint: modifier.fogTint, moonlight: modifier.moonlight };
}

/** Deterministic unit value per plan and run index: every peer resolves the same bomber line. */
function planNoise(plan: DawnActivityPlan, salt: string): number {
  let hash = 0x811c9dc5;
  const text = `${plan.contentHash}:${plan.dayNumber}:${plan.threat}:${plan.waves.map(wave => `${wave.blockId}@${wave.atMs}`).join()}:${salt}`;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return (hash >>> 0) / 0xffffffff;
}

/** Canopy reach beyond an authored grove: a fire under dense crowns would only glow at its rim. */
const FIRE_GROVE_MARGIN_CELLS = 2;

/** Edge point of a front on the axis through the base: the spawn lane a fire must never cover. */
function frontLaneStart(front: SpawnFront, anchor: { gridX: number; gridY: number }, width: number, height: number) {
  switch (front) {
    case 'west': return { gridX: 0, gridY: anchor.gridY };
    case 'east': return { gridX: width - 1, gridY: anchor.gridY };
    case 'north': return { gridX: anchor.gridX, gridY: 0 };
    case 'south': return { gridX: anchor.gridX, gridY: height - 1 };
  }
}

/**
 * Existing timed airstrikes, ground hazards and enemy blocks (D-47): no new damage, HP or snapshot
 * rules. Bombers fly straight runs in from the night's fronts; fires grow from patches off the lanes.
 */
export function resolveDawnNightModifierContent(template: DawnArenaTemplate, plan: DawnActivityPlan) {
  const encounters: CoopDefenseMapEncounterConfig[] = [];
  const mapEvents: CoopDefenseMapEventConfig[] = [];
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
  const width = template.world.arenaWidthCells!, height = template.world.arenaHeightCells!;
  const anchor = template.world.persistentBase.anchor;
  const air = modifier.airstrikes;
  if (air) {
    // Finite zone barrages, unlike Map 11's unbounded player-hunt loop, stop before dawn.
    const gridX = Math.max(0, anchor.gridX - air.radiusCells), gridY = Math.max(0, anchor.gridY - air.radiusCells);
    for (let atMs = start, index = 0; atMs + air.endClearanceMs < end; atMs += air.intervalMs, index++) {
      const inward = getSpawnFrontInwardVector(fronts[index % fronts.length]);
      const headingDeg = (Math.atan2(inward.y, inward.x) * 180 / Math.PI + (planNoise(plan, `heading-${index}`) - 0.5) * 50 + 360) % 360;
      mapEvents.push({ id: `night-bombers-${index}`, type: 'airstrike', start: { type: 'time', atMs },
        pattern: 'zone-barrage', strikeCount: air.strikeCount,
        area: { gridX, gridY,
          widthCells: Math.min(width, anchor.gridX + air.radiusCells + 1) - gridX,
          heightCells: Math.min(height, anchor.gridY + air.radiusCells + 1) - gridY },
        run: { headingDeg, offsetRatio: (planNoise(plan, `offset-${index}`) - 0.5) * 1.1, speedPxPerSec: air.runSpeedPxPerSec } });
    }
  }
  const fire = modifier.groundFire;
  if (fire) {
    const keepClear: CoopDefenseMapGroundHazardKeepClear[] = [
      { from: anchor, to: anchor, radiusCells: fire.coreClearanceCells },
      ...[...new Set(template.fronts)].map(front => ({
        from: frontLaneStart(front, anchor, width, height), to: anchor, radiusCells: fire.laneClearanceCells })),
      ...(template.world.treeGroves?.areas ?? []).map(grove => ({ from: { gridX: grove.gridX, gridY: grove.gridY },
        to: { gridX: grove.gridX, gridY: grove.gridY }, radiusCells: grove.radiusCells + FIRE_GROVE_MARGIN_CELLS })),
    ];
    for (const [index, ignition] of fire.ignitions.entries()) {
      const atMs = start + Math.floor(ignition.startRatio * (end - start));
      mapEvents.push({ id: `night-fire-${index}`, type: 'ground-hazard', announcement: 'none', start: { type: 'time', atMs },
        durationMs: end - atMs,
        area: { type: 'random-patches', randomPatchCount: ignition.patchCount, minPatchRadiusCells: fire.minPatchRadiusCells,
          maxPatchRadiusCells: fire.maxPatchRadiusCells, baseClearanceCells: fire.siteClearanceCells, keepClear },
        spread: { direction: 'radial', durationMs: fire.spreadMs, warningLeadMs: fire.warningLeadMs },
        effect: { visualStyle: 'normal', burnDurationMs: fire.burnDurationMs, burnDamagePerTick: fire.burnDamagePerTick,
          sourceId: 'ground_fire.dawn_night_fire' } });
    }
  }
  return { encounters, mapEvents };
}
