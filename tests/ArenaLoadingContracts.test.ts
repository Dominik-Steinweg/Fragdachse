import { describe, expect, it } from 'vitest';
import { ARENA_GENERATOR_VERSION, ArenaGenerator, resolveArenaGenerationInput } from '../src/arena/ArenaGenerator';
import { getCoopDefenseMapConfig } from '../src/config/coopDefenseMaps';
import { COOP_DEFENSE_MODE } from '../src/gameModes';
import { resolveArenaLoadProgress } from '../src/scenes/arena/ArenaLoadProgress';
import { resolveArenaStartTime } from '../src/scenes/arena/ArenaStartTiming';
import type { ArenaDescriptor } from '../src/types';
import { resolveCoopDefenseWorldMetrics } from '../src/world/WorldMetrics';

function legacyFingerprint(layout: unknown): string {
  const serialized = JSON.stringify(layout);
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

describe('arena loading contracts', () => {
  it('reproduces the large Map 0 locally and keeps the descriptor compact', () => {
    const map = getCoopDefenseMapConfig('0');
    const seed = 0x1234_5678;
    const input = resolveArenaGenerationInput(
      COOP_DEFENSE_MODE,
      resolveCoopDefenseWorldMetrics(map.arenaWidthCells, map.arenaHeightCells),
    );
    const hostLayout = ArenaGenerator.generate(seed, input, map);
    const clientLayout = ArenaGenerator.generate(seed, input, map);
    const descriptor: ArenaDescriptor = {
      roundRevision: 42,
      gameMode: COOP_DEFENSE_MODE,
      mapId: map.mapId,
      seed,
      arenaGeneratorVersion: ARENA_GENERATOR_VERSION,
      layoutFingerprint: ArenaGenerator.fingerprint(hostLayout),
    };

    expect(ArenaGenerator.fingerprint(clientLayout)).toBe(descriptor.layoutFingerprint);
    expect(ArenaGenerator.fingerprint(hostLayout)).toBe(legacyFingerprint(hostLayout));
    expect(JSON.stringify(descriptor).length).toBeLessThan(1024);
    expect(hostLayout.rocks.length).toBeGreaterThan(10_000);
  }, 120_000);

  it('maps chunk work to coarse stages and reaches ready without a lead delay', () => {
    expect(resolveArenaLoadProgress(100, 0, false, false)).toEqual({
      progress: 70,
      stage: 'rendering',
      ready: false,
    });
    expect(resolveArenaLoadProgress(0, 10, true, false)).toEqual({
      progress: 95,
      stage: 'building',
      ready: false,
    });
    expect(resolveArenaLoadProgress(0, 10, true, true)).toEqual({
      progress: 100,
      stage: 'ready',
      ready: true,
    });
    expect(resolveArenaStartTime(10_000)).toBe(13_000);
  });
});
