import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { ARENA_GENERATOR_VERSION } from '../../../src/arena/ArenaGenerator';
import {
  isCoopDefenseBaseObstacleClearanceCell,
  isPersistentBaseReservationCell,
  resolveCoopDefenseBases,
  type BaseSpec,
} from '../../../src/arena/BaseRegistry';
import { DAWN_CONTENT_HASH, getDawnArenaTemplate, getDawnArenaTemplates } from '../../../src/config/dawn/dawnContent';
import { composeDawnRoundPlans } from '../../../src/dawn/composition/DawnRoundComposition';
import { DAWN_MAX_THREAT, haveSameDawnPlan } from '../../../src/dawn/contracts/DawnPlans';
import { resolveDawnSites } from '../../../src/dawn/resolution/DawnScenarioResolution';
import { buildOccupancyRaster } from '../../../src/systems/flowfield/FlowFieldSources';
import type { SpawnFront } from '../../../src/types';
import { generateRoundWorld } from '../../../src/world/RoundWorldGeneration';

/**
 * Seeds je Template. Routinelaeufe pruefen eine feste Stichprobe; `npm run test:stress:dawn-sweep`
 * setzt DAWN_STRESS_SEEDS=500 fuer den vollen Abnahme-Sweep.
 */
const SEED_COUNT = Math.max(1, Math.floor(Number(process.env.DAWN_STRESS_SEEDS) || 50));
/** Kern der Site-Lichtung, der mit der Basis verbunden sein muss. */
const SITE_CORE_RADIUS = 2;
const NEIGHBORS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** Four-neighbor goals match ArenaGenerator.getFriendlyBaseGoalCells, excluding base interiors. */
function baseGoals(bases: readonly BaseSpec[], blocked: Uint8Array, cols: number, rows: number): number[] {
  const goals = new Set<number>();
  for (const base of bases) {
    if (base.faction === 'hostile' || base.role === 'spawn-point'
      || (base.role === 'outpost' && base.dormantObjectiveId === undefined)) continue;
    for (const cell of base.cells) for (const [dx, dy] of NEIGHBORS) {
      const x = cell.gridX + dx, y = cell.gridY + dy;
      if (x >= 0 && x < cols && y >= 0 && y < rows && !blocked[y * cols + x]) goals.add(y * cols + x);
    }
  }
  return [...goals];
}

function flood(goals: readonly number[], blocked: Uint8Array, cols: number, rows: number): Uint8Array {
  const reached = new Uint8Array(blocked.length);
  const queue = new Int32Array(blocked.length);
  let end = 0;
  for (const goal of goals) { reached[goal] = 1; queue[end++] = goal; }
  for (let cursor = 0; cursor < end; cursor++) {
    const index = queue[cursor], x = index % cols, y = Math.floor(index / cols);
    for (const [dx, dy] of NEIGHBORS) {
      const nx = x + dx, ny = y + dy, next = ny * cols + nx;
      if (nx < 0 || nx >= cols || ny < 0 || ny >= rows || blocked[next] || reached[next]) continue;
      reached[next] = 1;
      queue[end++] = next;
    }
  }
  return reached;
}

/** Keep independent of the authored salvage ratio: this checks the actual runtime spawn band. */
function inFrontBand(front: SpawnFront, x: number, y: number, cols: number, rows: number): boolean {
  // CoopDefenseSpawnExecutor.getEdgeBand and ArenaGenerator.getSpawnFrontCells (inclusive).
  const depthX = Math.min(Math.max(2, Math.floor(cols * 0.15)), cols - 1);
  const depthY = Math.min(Math.max(2, Math.floor(rows * 0.15)), rows - 1);
  switch (front) {
    case 'west': return x <= depthX;
    case 'east': return x >= cols - 1 - depthX;
    case 'north': return y <= depthY;
    case 'south': return y >= rows - 1 - depthY;
  }
}

interface TemplateStats {
  readonly templateId: string;
  readonly widthCells: number;
  readonly heightCells: number;
  readonly generationMs: number[];
  readonly determinismSeeds: number[];
  readonly seeds: number[];
  readonly threats: Record<number, number>;
  /** Routen je angebotener Front (gemessen); garantiert werden nur die Fronten des Plans. */
  readonly offeredFrontRoutes: Record<string, number>;
  readonly plannedFronts: Record<string, number>;
  readonly slots: Record<string, { occupied: number; coreConnected: number; coreBlockedCells: number }>;
}

/** Shard-Dateien verteilen die Templates auf parallele Worker; neue Templates landen automatisch in einem Shard. */
export const DAWN_MULTI_SEED_SHARDS = 4;

export function describeDawnMultiSeedShard(shard: number): void {
  const templates = getDawnArenaTemplates().filter((_, index) => index % DAWN_MULTI_SEED_SHARDS === shard);
  describe(`Dawn arena multi-seed generation (shard ${shard + 1}/${DAWN_MULTI_SEED_SHARDS})`, () => {
    if (templates.length === 0) it('has no template in this shard', () => expect(templates).toEqual([]));
    else it.each(templates)('$id: generates every threat and connects fronts and sites', async (targetTemplate) => {
      const suiteStart = performance.now();
      const failures: string[] = [];
      const stats = new Map<string, TemplateStats>();

      const templateSeeds = new Map([[targetTemplate.id, [] as number[]]]);
      // Select real production seeds instead of replacing a composed template after site selection.
      for (let seed = 1; [...templateSeeds.values()].some(seeds => seeds.length < SEED_COUNT); seed++) {
        if (seed > SEED_COUNT * templateSeeds.size * 100) throw new Error('Template seed search exhausted');
        const id = composeDawnRoundPlans({ seed, threat: 1, dayNumber: 1 }).world.templateId;
        const seeds = templateSeeds.get(id);
        if (seeds && seeds.length < SEED_COUNT) seeds.push(seed);
      }
      for (let seedIndex = 0; seedIndex < SEED_COUNT; seedIndex++) for (const seeds of templateSeeds.values()) {
        const seed = seeds[seedIndex];
        for (let threat = 1; threat <= DAWN_MAX_THREAT; threat++) {
          if (threat === 1 && seedIndex % 10 === 0) {
            console.info('Dawn progress', composeDawnRoundPlans({ seed, threat, dayNumber: 1 }).world.templateId, seedIndex, '/', SEED_COUNT, 'failures:', failures.length);
            mkdirSync('build/dawn/M3-arenas', { recursive: true });
            writeFileSync(`build/dawn/M3-arenas/${targetTemplate.id}-stress-progress.json`, JSON.stringify({
              elapsedMs: performance.now() - suiteStart, failures,
              templates: [...stats.values()].map(entry => ({ templateId: entry.templateId, rounds: entry.generationMs.length,
                meanMs: entry.generationMs.reduce((a, b) => a + b, 0) / entry.generationMs.length })),
            }, null, 2));
          }
          // Minutes of synchronous generation would starve the worker RPC; yield periodically.
          if (threat === 1) await new Promise<void>((resolve) => setImmediate(resolve));

          const dawn = composeDawnRoundPlans({ seed, threat, dayNumber: 1 });
          const template = getDawnArenaTemplate(dawn.world.templateId);
          const cols = template.world.arenaWidthCells!, rows = template.world.arenaHeightCells!;
          const entry = stats.get(template.id) ?? {
            templateId: template.id, widthCells: cols, heightCells: rows, generationMs: [], determinismSeeds: [], seeds,
            threats: {}, offeredFrontRoutes: Object.fromEntries(template.fronts.map(front => [front, 0])), plannedFronts: {},
            slots: Object.fromEntries(template.salvageSlots.map(slot => [slot.id, { occupied: 0, coreConnected: 0, coreBlockedCells: 0 }])),
          };
          stats.set(template.id, entry);
          entry.threats[threat] = (entry.threats[threat] ?? 0) + 1;
          const generate = () => generateRoundWorld({
            roundRevision: 1, gameMode: 'coop_defense', seed, campaignMapConfig: null, dawn,
            worldParameters: { persistentBaseUnlocked: true, persistentBaseAreaStage: template.world.persistentBase.maxAreaStage },
          });

          const generationStart = performance.now();
          let generated: ReturnType<typeof generate>;
          try { generated = generate(); }
          catch (error) { failures.push(`${template.id}/${seed}/threat-${threat}: ${String(error)}`); continue; }
          entry.generationMs.push(performance.now() - generationStart);
          if (threat === 1 && (seedIndex === 0 || seedIndex % 100 === 0)) {
            entry.determinismSeeds.push(seed);
            const recomposed = composeDawnRoundPlans({ seed, threat, dayNumber: 1 });
            expect(haveSameDawnPlan(recomposed.world, dawn.world), `${seed} world plan`).toBe(true);
            expect(haveSameDawnPlan(recomposed.activity, dawn.activity), `${seed} activity plan`).toBe(true);
            expect(generate().world.layoutFingerprint, `${template.id}/${seed} fingerprint`)
              .toBe(generated.world.layoutFingerprint);
          }

          const { layout, mapConfig } = generated;
          expect(layout.tracks, `${template.id} has no railway`).toHaveLength(0);
          const bases = resolveCoopDefenseBases(mapConfig!);
          // ArenaGenerator blocks rock cells, trunk cells and water cells. Base interiors also
          // block traversal, as in runtime pathing; canopy, dirt and decals do not block cells.
          // Use the pathing raster builder, without its dig-through-rock cost semantics.
          // Night fires count as walls: fronts and sites must stay reachable without walking through them.
          const blocked = buildOccupancyRaster([
            ...layout.rocks, ...layout.trees, ...(layout.water ?? []), ...bases.flatMap(base => base.cells),
            ...(layout.groundHazardZones ?? []).flatMap(zone => zone.cells),
          ], { cols, rows, cellSize: 1, arenaOffsetX: 0, arenaOffsetY: 0 });
          const core = bases.filter(base => base.persistentReservationRadiusCells !== undefined);
          const goals = baseGoals(core, blocked, cols, rows);
          expect(goals.length, `${template.id}/${seed} base goals`).toBeGreaterThan(0);
          const reached = flood(goals, blocked, cols, rows);
          const plannedFronts = new Set(dawn.activity.waves.flatMap(wave => 'front' in wave ? [wave.front] : []));
          for (const front of template.fronts) {
            const hasRoute = reached.some((value, index) => {
              if (!value) return false;
              const x = index % cols, y = Math.floor(index / cols);
              return inFrontBand(front, x, y, cols, rows)
                && !isPersistentBaseReservationCell(x, y, bases)
                && !isCoopDefenseBaseObstacleClearanceCell(x, y, bases);
            });
            if (hasRoute) entry.offeredFrontRoutes[front]++;
            if (!hasRoute) failures.push(`${template.id}/${seed}/threat-${threat}: no ${front} route`);
            if (!plannedFronts.has(front)) continue;
            entry.plannedFronts[front] = (entry.plannedFronts[front] ?? 0) + 1;

          }

          // Flood starts at the persistent core itself, never at a friendly site structure.
          // A brood nest's pit opens toward the base, so its free cells must be reached like any core cell.
          const structureCells = new Set(bases.flatMap(base => base.cells.map(cell => cell.gridY * cols + cell.gridX)));
          for (const site of resolveDawnSites(dawn.world)) {
            const slotStats = entry.slots[site.slotId];
            slotStats.occupied++;
            const { gridX, gridY } = site.slot.anchor;
            let freeCore = 0, blockedCore = 0, disconnected = 0;
            for (let dy = -SITE_CORE_RADIUS; dy <= SITE_CORE_RADIUS; dy++) for (let dx = -SITE_CORE_RADIUS; dx <= SITE_CORE_RADIUS; dx++) {
              if (Math.hypot(dx, dy) > SITE_CORE_RADIUS) continue;
              const index = (gridY + dy) * cols + gridX + dx;
              if (structureCells.has(index)) continue;
              if (blocked[index]) { blockedCore++; continue; }
              freeCore++;
              if (!reached[index]) disconnected++;
            }
            slotStats.coreBlockedCells += blockedCore;
            if (freeCore > 0 && blockedCore === 0 && disconnected === 0) slotStats.coreConnected++;
            else failures.push(`${template.id}/${seed}/threat-${threat}: site ${site.slotId} core blocked ${blockedCore}, disconnected ${disconnected}`);
          }
        }
      }

      const templates = [...stats.values()].map((entry) => {
        const sortedMs = [...entry.generationMs].sort((a, b) => a - b);
        const totalMs = entry.generationMs.reduce((sum, ms) => sum + ms, 0);
        const summary = {
          templateId: entry.templateId, widthCells: entry.widthCells, heightCells: entry.heightCells,
          generatedSeeds: entry.seeds.length, generatedRounds: entry.generationMs.length, seeds: entry.seeds, determinismSeeds: entry.determinismSeeds, threats: entry.threats,
          offeredFrontRoutes: entry.offeredFrontRoutes, plannedFronts: entry.plannedFronts,
          generation: {
            totalMs, meanMs: totalMs / entry.generationMs.length,
            p95Ms: sortedMs[Math.ceil(sortedMs.length * 0.95) - 1], maxMs: sortedMs[sortedMs.length - 1],
          },
          slots: Object.entries(entry.slots).map(([slotId, slot]) => ({ slotId, ...slot })),
        };
        console.info(`Dawn M3 ${entry.templateId}: ${summary.generatedSeeds} seeds x 10 threats; `
          + `${summary.generation.meanMs.toFixed(1)} ms mean, ${summary.generation.p95Ms?.toFixed(1)} ms p95, `
          + `${summary.generation.maxMs?.toFixed(1)} ms max; offered front routes ${JSON.stringify(entry.offeredFrontRoutes)}\n`
          + 'slot | occupied | core connected\n'
          + summary.slots.map(slot => `${slot.slotId} | ${slot.occupied} | ${slot.coreConnected}`).join('\n'));
        return summary;
      });
      mkdirSync('build/dawn/M3-arenas', { recursive: true });
      writeFileSync(`build/dawn/M3-arenas/${targetTemplate.id}-stress-stats.json`, JSON.stringify({
        contentHash: DAWN_CONTENT_HASH, generatorVersion: ARENA_GENERATOR_VERSION,
        seedsPerTemplate: SEED_COUNT, threatsPerSeed: [1, DAWN_MAX_THREAT], siteCoreRadiusCells: SITE_CORE_RADIUS,
        elapsedMs: performance.now() - suiteStart, templates, failures,
      }, null, 2) + '\n');
      for (const entry of stats.values()) {
        expect(entry.generationMs, `${entry.templateId} complete seed/threat matrix`).toHaveLength(SEED_COUNT * DAWN_MAX_THREAT);
        for (const slot of Object.values(entry.slots)) expect(slot.occupied).toBeGreaterThan(0);
      }
      expect(failures, `All generations, offered front routes and site cores must succeed; see build/dawn/M3-arenas/${targetTemplate.id}-stress-stats.json`)
        .toEqual([]);
    }, 7_200_000);
  });
}
