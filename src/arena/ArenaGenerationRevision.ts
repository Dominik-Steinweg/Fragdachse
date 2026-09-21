import type { ArenaGenerationMapConfig } from './ArenaGenerator';

/** Geometry cache input: group quantities/timing do not participate in generation. */
export function projectArenaGenerationRevision(map: ArenaGenerationMapConfig): unknown {
  return {
    mapId: map.mapId, arenaWidthCells: map.arenaWidthCells, arenaHeightCells: map.arenaHeightCells,
    bases: map.bases, persistentBase: map.persistentBase, rockField: map.rockField,
    rockFillRatio: map.rockFillRatio, rockWalls: map.rockWalls, treeCount: map.treeCount, water: map.water,
    trackMode: map.trackMode, trackPosition: map.trackPosition,
    tutorialAnchor: map.tutorialAnchor, tutorialShowControls: map.tutorialShowControls,
    tutorialSteps: map.tutorialSteps?.map(s => ({ anchor: s.anchor })),
    missionProgress: map.missionProgress,
    encounters: map.encounters?.map(e => e.groups.map(g => ({ front: g.front, spawnArea: g.spawnArea }))),
    persistentSpawns: map.persistentSpawns?.map(s => ({ source: s.source, front: s.front })),
    boss: Boolean(map.boss), powerUps: map.powerUps,
    mapEvents: map.mapEvents?.filter(e => e.type === 'ground-hazard'),
  };
}
