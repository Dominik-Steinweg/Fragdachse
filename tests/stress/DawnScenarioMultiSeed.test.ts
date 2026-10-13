import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { ARENA_GENERATOR_VERSION } from '../../src/arena/ArenaGenerator';
import {
  isCoopDefenseBaseObstacleClearanceCell,
  isPersistentBaseReservationCell,
  resolveCoopDefenseBases,
  type BaseSpec,
} from '../../src/arena/BaseRegistry';
import { DAWN_CONTENT_HASH, getDawnArenaTemplates } from '../../src/config/dawn/dawnContent';
import { composeDawnRoundPlans } from '../../src/dawn/composition/DawnRoundComposition';
import { buildOccupancyRaster } from '../../src/systems/flowfield/FlowFieldSources';
import type { SpawnFront } from '../../src/types';
import { generateRoundWorld } from '../../src/world/RoundWorldGeneration';

const SEED_COUNT = 500;
const SLOT_RADIUS = 2;
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

describe('Dawn S1 multi-seed generation', () => {
  it('generates all templates, preserves fingerprints and connects every offered front to the base', () => {
    const suiteStart = performance.now();
    const templates = [];
    const failures: string[] = [];
    for (const template of getDawnArenaTemplates()) {
      const started = performance.now();
      const composed = composeDawnRoundPlans({ threat: 1, dayNumber: 1 });
      const dawn = {
        world: { ...composed.world, templateId: template.id },
        activity: {
          ...composed.activity,
          waves: [
            ...composed.activity.waves.filter(wave => template.fronts.includes(wave.front)),
            ...template.fronts.map((front, index) => ({
              ...composed.activity.waves[0], id: `s1-front-${front}`, front, atMs: (index + 1) * 1000,
            })),
          ],
        },
      };
      const cols = template.world.arenaWidthCells!, rows = template.world.arenaHeightCells!;
      const slots = template.salvageSlots.map(slot => ({
        ...slot, reachableSeeds: 0, anchorBlockedSeeds: 0, unreachableSeeds: [] as number[],
        // Exploratory M1 evidence: minimum radius touching connected ground (up to 8 cells).
        maxNearestConnectedDistanceCells: 0, noConnectedCellWithin8Seeds: 0,
      }));
      const fronts = Object.fromEntries(template.fronts.map(front => [front, 0]));
      const generationMs: number[] = [];
      const determinismSeeds: number[] = [];
      const generate = (seed: number) => generateRoundWorld({
        roundRevision: 1, gameMode: 'coop_defense', seed, campaignMapConfig: null, dawn,
        worldParameters: { persistentBaseUnlocked: true, persistentBaseAreaStage: template.world.persistentBase.maxAreaStage },
      });

      for (let seed = 1; seed <= SEED_COUNT; seed++) {
        const generationStart = performance.now();
        let generated: ReturnType<typeof generate>;
        try { generated = generate(seed); }
        catch (error) { failures.push(`${template.id}/${seed}: ${String(error)}`); continue; }
        generationMs.push(performance.now() - generationStart);
        if (seed === 1 || seed % 100 === 0) {
          determinismSeeds.push(seed);
          expect(generate(seed).world.layoutFingerprint, `${template.id}/${seed} fingerprint`)
            .toBe(generated.world.layoutFingerprint);
        }
        const { layout, mapConfig } = generated;
        expect(layout.tracks, `${template.id} has no railway`).toHaveLength(0);
        const bases = resolveCoopDefenseBases(mapConfig!);
        // ArenaGenerator blocks rock cells, trunk cells and water cells. Base interiors also
        // block traversal, as in runtime pathing; canopy, dirt and decals do not block cells.
        // Use the pathing raster builder, without its dig-through-rock cost semantics.
        const blocked = buildOccupancyRaster([
          ...layout.rocks, ...layout.trees, ...(layout.water ?? []), ...bases.flatMap(base => base.cells),
        ], { cols, rows, cellSize: 1, arenaOffsetX: 0, arenaOffsetY: 0 });
        const goals = baseGoals(bases, blocked, cols, rows);
        expect(goals.length, `${template.id}/${seed} base goals`).toBeGreaterThan(0);
        const reached = flood(goals, blocked, cols, rows);
        for (const front of template.fronts) {
          const hasRoute = reached.some((value, index) => {
            if (!value) return false;
            const x = index % cols, y = Math.floor(index / cols);
            return inFrontBand(front, x, y, cols, rows)
              && !isPersistentBaseReservationCell(x, y, bases)
              && !isCoopDefenseBaseObstacleClearanceCell(x, y, bases);
          });
          if (hasRoute) fronts[front]++;
          else failures.push(`${template.id}/${seed}: no ${front} route`);
        }
        for (const slot of slots) {
          const { gridX, gridY } = slot.anchor;
          if (blocked[gridY * cols + gridX]) slot.anchorBlockedSeeds++;
          let nearest = Infinity;
          for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) {
            const x = gridX + dx, y = gridY + dy, distance = Math.hypot(dx, dy);
            if (x >= 0 && x < cols && y >= 0 && y < rows && distance <= 8 && reached[y * cols + x]) {
              nearest = Math.min(nearest, distance);
            }
          }
          if (nearest <= SLOT_RADIUS) slot.reachableSeeds++;
          else slot.unreachableSeeds.push(seed);
          if (Number.isFinite(nearest)) {
            slot.maxNearestConnectedDistanceCells = Math.max(slot.maxNearestConnectedDistanceCells, nearest);
          } else slot.noConnectedCellWithin8Seeds++;
        }
      }
      const sortedMs = [...generationMs].sort((a, b) => a - b);
      const stats = {
        templateId: template.id, widthCells: cols, heightCells: rows, seeds: SEED_COUNT,
        generatedSeeds: generationMs.length, determinismSeeds, frontRoutes: fronts,
        elapsedMs: performance.now() - started,
        generation: {
          totalMs: generationMs.reduce((sum, ms) => sum + ms, 0),
          meanMs: generationMs.reduce((sum, ms) => sum + ms, 0) / generationMs.length,
          p95Ms: sortedMs[Math.ceil(sortedMs.length * 0.95) - 1], maxMs: sortedMs.at(-1),
        },
        slots: slots.map(slot => ({ ...slot,
          reachablePercent: slot.reachableSeeds / SEED_COUNT * 100,
          anchorBlockedPercent: slot.anchorBlockedSeeds / SEED_COUNT * 100,
        })),
      };
      templates.push(stats);
      console.info(`Dawn S1 ${template.id}: ${stats.generatedSeeds}/${SEED_COUNT} seeds; `
        + `${stats.generation.meanMs.toFixed(1)} ms/seed; ${(stats.elapsedMs / 1000).toFixed(1)} s; `
        + `front routes ${JSON.stringify(fronts)}\nslot | reachable (radius ${SLOT_RADIUS}) | anchor blocked\n`
        + stats.slots.map(slot => `${slot.id} | ${slot.reachablePercent.toFixed(1)}% | ${slot.anchorBlockedPercent.toFixed(1)}%`).join('\n'));
      // Slots are measurements, not guaranteed clearings in S1. Do not turn the measured
      // result into a conditional assertion: M1 must introduce an explicit site contract.
    }
    mkdirSync('build/dawn', { recursive: true });
    writeFileSync('build/dawn/S1-stats.json', JSON.stringify({
      contentHash: DAWN_CONTENT_HASH, generatorVersion: ARENA_GENERATOR_VERSION,
      seedRange: [1, SEED_COUNT], slotRadiusCells: SLOT_RADIUS,
      elapsedMs: performance.now() - suiteStart, templates, failures,
    }, null, 2) + '\n');
    expect(failures, 'All generations and front routes must succeed; see build/dawn/S1-stats.json').toEqual([]);
  }, 120_000);
});
