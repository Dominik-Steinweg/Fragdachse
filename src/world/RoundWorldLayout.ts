import { ArenaGenerator, resolveArenaGenerationInput } from '../arena/ArenaGenerator';
import { getArenaMetricsProfile } from '../config';
import type { CoopDefenseMapConfig } from '../config/coopDefenseMaps';
import type { ArenaLayout, GameMode } from '../types';
import { resolveWorldMetrics } from './WorldMetrics';

/**
 * Layout of a round World from its mode, full map config and seed.
 *
 * Shared by the host's round start and the deployment preview (Lagekarte), so both generate from
 * exactly the same inputs. The full activity map config matters: encounters, spawns and objectives
 * feed the generator's random sequence, so a World-only config would yield a different layout.
 */
export function generateRoundWorldLayout(
  gameMode: GameMode,
  mapConfig: CoopDefenseMapConfig | null,
  seed: number,
): ArenaLayout {
  const worldMetrics = resolveWorldMetrics(getArenaMetricsProfile(
    gameMode,
    'ARENA',
    mapConfig?.arenaWidthCells,
    mapConfig?.arenaHeightCells,
  ));
  return ArenaGenerator.generate(seed, resolveArenaGenerationInput(gameMode, worldMetrics), mapConfig ?? undefined);
}
