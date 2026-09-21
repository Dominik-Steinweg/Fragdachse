import { ArenaGenerator, ARENA_GENERATOR_VERSION, resolveArenaGenerationInput } from '../../../../src/arena/ArenaGenerator';
import { resolveCoopDefenseBases } from '../../../../src/arena/BaseRegistry';
import { resolveCoopDefenseWorldMetrics } from '../../../../src/world/WorldMetrics';
import { COOP_DEFENSE_MODE } from '../../../../src/gameModes';
import { validateDocument } from '../../shared/validation';
import type { JsonObject } from '../../shared/json';

export function generatePreview(draft: JsonObject, seed: number) {
  const result = validateDocument(draft);
  if (!result.normalized) throw Error(result.issues.map(i => `${i.path}: ${i.message}`).join('\n'));
  const map = result.normalized;
  const metrics = resolveCoopDefenseWorldMetrics(map.arenaWidthCells, map.arenaHeightCells);
  const started = performance.now();
  const layout = ArenaGenerator.generate(seed, resolveArenaGenerationInput(COOP_DEFENSE_MODE, metrics), map);
  return { layout, metrics, bases: resolveCoopDefenseBases(map, metrics),
    requestedSeed: seed, fingerprint: ArenaGenerator.fingerprint(layout), version: ARENA_GENERATOR_VERSION,
    elapsedMs: performance.now() - started };
}
export type PreviewResult = ReturnType<typeof generatePreview>;
