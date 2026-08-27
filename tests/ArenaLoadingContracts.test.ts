import { describe, expect, it } from 'vitest';
import { ARENA_GENERATOR_VERSION, ArenaGenerator, resolveArenaGenerationInput } from '../src/arena/ArenaGenerator';
import { getCoopDefenseMapConfig } from '../src/config/coopDefenseMaps';
import { COOP_DEFENSE_MODE } from '../src/gameModes';
import { resolveWorldLoadProgress } from '../src/world/WorldLoadReady';
import { resolveArenaStartTime } from '../src/scenes/arena/ArenaStartTiming';
import type { ActivityDescriptor } from '../src/world/ActivityDescriptor';
import type { WorldDescriptor } from '../src/world/WorldDescriptor';
import { toActivityDefinitionId, toWorldDefinitionId } from '../src/world/arenaDescriptorAdapter';
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
    const world: WorldDescriptor = {
      worldRevision: 42,
      definitionId: toWorldDefinitionId(map.mapId),
      seed,
      generatorVersion: ARENA_GENERATOR_VERSION,
      layoutFingerprint: ArenaGenerator.fingerprint(hostLayout),
    };
    const activity: ActivityDescriptor = {
      activityRevision: 42,
      worldRevision: 42,
      kind: 'coop-mission',
      definitionId: toActivityDefinitionId('coop-mission', map.mapId),
    };

    expect(ArenaGenerator.fingerprint(clientLayout)).toBe(world.layoutFingerprint);
    expect(ArenaGenerator.fingerprint(hostLayout)).toBe(legacyFingerprint(hostLayout));
    expect(JSON.stringify({ world, activity }).length).toBeLessThan(1024);
    expect(hostLayout.rocks.length).toBeGreaterThan(10_000);
  }, 120_000);

  it('maps chunk work to coarse stages and reaches ready without a lead delay', () => {
    expect(resolveWorldLoadProgress(100, 0, false)).toEqual({
      progress: 70,
      stage: 'rendering',
      ready: false,
    });
    expect(resolveWorldLoadProgress(30, 70, false)).toEqual({
      progress: 88,
      stage: 'rendering',
      ready: false,
    });
    // Die World meldet fertig, sobald sie lokal steht – unabhaengig davon, ob eine Runde
    // starten darf. Round Loading ist eine getrennte Bedingung.
    expect(resolveWorldLoadProgress(0, 10, true)).toEqual({
      progress: 100,
      stage: 'ready',
      ready: true,
    });
    expect(resolveArenaStartTime(10_000)).toBe(13_000);
  });
});
