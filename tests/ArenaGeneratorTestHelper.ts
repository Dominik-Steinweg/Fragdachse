import { ArenaGenerator, resolveArenaGenerationInput } from '../src/arena/ArenaGenerator';
import type { CoopDefenseMapConfig } from '../src/config/coopDefenseMaps';
import type { GameMode } from '../src/types';
import { resolveActiveArenaWorldMetrics } from '../src/world/WorldMetrics';

/** Compatibility helper for tests whose setup intentionally drives the mutable active arena. */
export function generateArenaWithActiveMetrics(
  seed: number,
  map?: CoopDefenseMapConfig,
  mode: GameMode = map ? 'coop_defense' : 'deathmatch',
) {
  return ArenaGenerator.generate(
    seed,
    resolveArenaGenerationInput(mode, resolveActiveArenaWorldMetrics()),
    map,
  );
}
