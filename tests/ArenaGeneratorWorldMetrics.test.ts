import { describe, expect, it } from 'vitest';
import { ArenaGenerator, resolveArenaGenerationInput } from '../src/arena/ArenaGenerator';
import { applyArenaMetricsForMode, getArenaMetricsProfile } from '../src/config';
import { getCoopDefenseMapConfig } from '../src/config/coopDefenseMaps';
import type { GameMode } from '../src/types';
import { resolveWorldMetrics } from '../src/world/WorldMetrics';

describe('ArenaGenerator world-scoped metrics', () => {
  it('preserves the legacy fingerprints independently of mutable active arena state', () => {
    const cases: ReadonlyArray<{
      mode: GameMode;
      seed: number;
      mapId?: string;
      legacyFingerprint: string;
    }> = [
      { mode: 'deathmatch', seed: 0x1020_3040, legacyFingerprint: '3c917cc9' },
      { mode: 'capture_the_beer', seed: 0x5060_7080, legacyFingerprint: 'f95a334a' },
      { mode: 'coop_defense', seed: 0x1234_5678, mapId: '1', legacyFingerprint: '8ab7db1a' },
    ];

    for (const { mode, seed, mapId, legacyFingerprint } of cases) {
      const map = mapId ? getCoopDefenseMapConfig(mapId) : undefined;
      const metrics = resolveWorldMetrics(getArenaMetricsProfile(
        mode,
        'ARENA',
        map?.arenaWidthCells,
        map?.arenaHeightCells,
      ));
      const input = resolveArenaGenerationInput(mode, metrics);

      applyArenaMetricsForMode('deathmatch', 'LOBBY');
      const underLobbyGlobals = ArenaGenerator.fingerprint(ArenaGenerator.generate(seed, input, map));
      applyArenaMetricsForMode('capture_the_beer', 'ARENA');
      const underForeignGlobals = ArenaGenerator.fingerprint(ArenaGenerator.generate(seed, input, map));

      expect(underLobbyGlobals, `${mode}/${mapId ?? 'procedural'}`).toBe(legacyFingerprint);
      expect(underForeignGlobals, `${mode}/${mapId ?? 'procedural'}`).toBe(legacyFingerprint);
    }
    applyArenaMetricsForMode('deathmatch', 'LOBBY');
  });
});
