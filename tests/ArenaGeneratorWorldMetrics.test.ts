import { afterEach, describe, expect, it } from 'vitest';
import { ArenaGenerator, resolveArenaGenerationInput } from '../src/arena/ArenaGenerator';
import { applyArenaMetricsForMode, getArenaMetricsProfile } from '../src/config';
import { getCoopDefenseMapConfig } from '../src/config/coopDefenseMaps';
import type { GameMode } from '../src/types';
import { resolveWorldMetrics } from '../src/world/WorldMetrics';

describe('ArenaGenerator world-scoped metrics', () => {
  afterEach(() => {
    applyArenaMetricsForMode('deathmatch', 'LOBBY');
  });

  it('generates the same layout independently of mutable active arena state', () => {
    const cases: ReadonlyArray<{
      mode: GameMode;
      seed: number;
      mapId?: string;
    }> = [
      { mode: 'deathmatch', seed: 0x1020_3040 },
      { mode: 'capture_the_beer', seed: 0x5060_7080 },
      { mode: 'coop_defense', seed: 0x1234_5678, mapId: '1' },
    ];

    for (const { mode, seed, mapId } of cases) {
      const map = mapId ? getCoopDefenseMapConfig(mapId) : undefined;
      const metrics = resolveWorldMetrics(getArenaMetricsProfile(
        mode,
        'ARENA',
        map?.arenaWidthCells,
        map?.arenaHeightCells,
      ));
      const input = resolveArenaGenerationInput(mode, metrics);

      // Compare current content under matching and unrelated globals, without freezing visual tuning.
      applyArenaMetricsForMode(mode, 'ARENA', map?.arenaWidthCells, map?.arenaHeightCells);
      const expectedFingerprint = ArenaGenerator.fingerprint(ArenaGenerator.generate(seed, input, map));

      applyArenaMetricsForMode('deathmatch', 'LOBBY');
      const underLobbyGlobals = ArenaGenerator.fingerprint(ArenaGenerator.generate(seed, input, map));
      applyArenaMetricsForMode('capture_the_beer', 'ARENA');
      const underForeignGlobals = ArenaGenerator.fingerprint(ArenaGenerator.generate(seed, input, map));

      expect(underLobbyGlobals, `${mode}/${mapId ?? 'procedural'}`).toBe(expectedFingerprint);
      expect(underForeignGlobals, `${mode}/${mapId ?? 'procedural'}`).toBe(expectedFingerprint);
    }
  });
});
