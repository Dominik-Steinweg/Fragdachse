import { deflateRawSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import type * as Phaser from 'phaser';

vi.mock('phaser', () => ({
  Geom: { Rectangle: class {
    constructor(public x: number, public y: number, public width: number, public height: number) {}
    get left() { return this.x; }
    get right() { return this.x + this.width; }
    get top() { return this.y; }
    get bottom() { return this.y + this.height; }
    get centerX() { return this.x + this.width / 2; }
    get centerY() { return this.y + this.height / 2; }
  } },
  Math: { Clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)) },
}));

import { ArenaGenerator, resolveArenaGenerationInput } from '../../src/arena/ArenaGenerator';
import { NET_TICK_RATE_HZ, applyArenaMetricsForMode } from '../../src/config';
import { normalizeCoopDefenseMapConfig } from '../../src/config/coopDefenseMaps';
import { MAP16_MAP_ID, REFERENCE_SEED, referenceMap } from '../../src/debug/performanceLab/referenceMap';
import { FireSystem } from '../../src/effects/FireSystem';
import { GroundFireChangeJournal } from '../../src/effects/GroundFireChanges';
import { BurningGroundPublisher, BurningGroundReceiver } from '../../src/network/BurningGroundReplication';
import { encodeGroundFireVisualStyle } from '../../src/network/groundFireVisualStyleCodec';
import { CoopDefenseGroundHazardEventHandler } from '../../src/systems/CoopDefenseGroundHazardEventHandler';
import { CoopDefenseMapEventDirector } from '../../src/systems/CoopDefenseMapEventDirector';
import type { SyncedBurningGroundCell, SyncedBurningGroundSnapshot } from '../../src/types';
import { resolveCoopDefenseWorldMetrics } from '../../src/world/WorldMetrics';

/**
 * Wire load of the burning-ground slice `fg` in the Map 16 burn clearing (both authored void
 * sweeps with their warning bands), then a flamethrower painting short-lived cells. Drives the
 * real FireSystem and hazard handler. The binary slice is compared with the previous wire form
 * (JSON tuples with host ids, the whole warning band every tick), reproduced here as `legacy` for
 * its bytes only; its timings are not those of the former bridge code. Sizes are the slice's JSON
 * text plus a raw-deflate estimate per tick; host time includes JSON.stringify and client time
 * JSON.parse, as on the peer envelope. Run: npm run test:stress.
 */
type Slice = Record<string, unknown>;
type Tuple = [number, number, number, number, number, number];

function legacyPublisher() {
  let ticks = 0, lastCells: readonly SyncedBurningGroundCell[] | null = null, hadWarnings = false;
  let published = new Map<number, Tuple>();
  const tuple = (cell: SyncedBurningGroundCell): Tuple => [cell.id, cell.gridX, cell.gridY, cell.expiresAt, cell.intensity,
    encodeGroundFireVisualStyle(cell.visualStyle)];
  return (snapshot: SyncedBurningGroundSnapshot, forceFull = false): Slice | null => {
    ticks++;
    const full = forceFull || ticks === 1 || ticks % NET_TICK_RATE_HZ === 0;
    const warnings = snapshot.warnings ?? [];
    if (!full && snapshot.cells === lastCells) {
      const had = hadWarnings;
      hadWarnings = warnings.length > 0;
      return had || hadWarnings ? { w: warnings } : null;
    }
    lastCells = snapshot.cells;
    const current = new Map(snapshot.cells.map(cell => [cell.id, tuple(cell)]));
    if (full) { published = current; hadWarnings = warnings.length > 0; return { f: [...current.values()], w: warnings }; }
    const upserts = [...current].filter(([id, value]) => published.get(id)?.some((entry, i) => entry !== value[i]) ?? true)
      .map(([, value]) => value);
    const removals = [...published.keys()].filter(id => !current.has(id));
    published = current;
    if (!upserts.length && !removals.length && !warnings.length && !hadWarnings) return null;
    hadWarnings = warnings.length > 0;
    return { w: warnings, ...(upserts.length ? { u: upserts } : {}), ...(removals.length ? { r: removals } : {}) };
  };
}

const epoch = 1_800_000_000_000;
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const cellKeys = (ground: SyncedBurningGroundSnapshot, now: number) => ground.cells
  .filter(cell => cell.expiresAt > now)
  .map(cell => `${cell.visualStyle}:${cell.gridX}:${cell.gridY}:${Math.ceil(cell.expiresAt)}:${cell.intensity}`).sort();
const warningKeys = (ground: SyncedBurningGroundSnapshot, now: number) => (ground.warnings ?? [])
  .filter(cell => cell.activatesAt > now)
  .map(cell => `${cell.visualStyle ?? 'void'}:${cell.gridX}:${cell.gridY}`).sort();
function warningTimes(ground: SyncedBurningGroundSnapshot, now: number): Map<string, number[]> {
  const times = new Map<string, number[]>();
  for (const cell of ground.warnings ?? []) {
    if (cell.activatesAt <= now) continue;
    const key = `${cell.visualStyle ?? 'void'}:${cell.gridX}:${cell.gridY}`;
    times.set(key, [...times.get(key) ?? [], cell.activatesAt].sort((a, b) => a - b));
  }
  return new Map([...times].sort(([left], [right]) => left.localeCompare(right)));
}

interface Totals { ticks: number; cells: number; warnings: number; raw: number; deflate: number; peak: number; hostMs: number; clientMs: number }
const emptyTotals = (): Totals => ({ ticks: 0, cells: 0, warnings: 0, raw: 0, deflate: 0, peak: 0, hostMs: 0, clientMs: 0 });

function account(total: Totals, json: string, slice: Slice): void {
  for (const [key, value] of Object.entries(slice)) {
    const size = JSON.stringify(value).length;
    if (key.startsWith('w')) total.warnings += size; else total.cells += size;
  }
  total.raw += json.length;
  total.peak = Math.max(total.peak, json.length);
  total.deflate += deflateRawSync(Buffer.from(json)).length;
}

function summarize(total: Totals, timed: boolean) {
  const seconds = total.ticks / NET_TICK_RATE_HZ;
  return { cellsBytesPerSec: Math.round(total.cells / seconds), warningBytesPerSec: Math.round(total.warnings / seconds),
    rawBytesPerSec: Math.round(total.raw / seconds), deflateBytesPerSec: Math.round(total.deflate / seconds),
    peakTickBytes: total.peak,
    ...(timed ? { hostMsPerTick: +(total.hostMs / total.ticks).toFixed(4), clientMsPerTick: +(total.clientMs / total.ticks).toFixed(4) } : {}) };
}

describe('burning ground replication load', () => {
  it('measures the Map 16 burn clearing and a flamethrower trail against the JSON tuple wire', () => {
    const map = normalizeCoopDefenseMapConfig(referenceMap(MAP16_MAP_ID));
    const metrics = resolveCoopDefenseWorldMetrics(map.arenaWidthCells, map.arenaHeightCells);
    const layout = ArenaGenerator.generate(REFERENCE_SEED, resolveArenaGenerationInput('coop_defense', metrics), map);
    applyArenaMetricsForMode('coop_defense', 'ARENA', map.arenaWidthCells, map.arenaHeightCells);
    const fire = new FireSystem({} as Phaser.Scene);
    let frameTime = 0;
    // Host clock in whole milliseconds; the event director advances by frame deltas, as in the game.
    const now = () => epoch + Math.floor(frameTime);
    const handler = new CoopDefenseGroundHazardEventHandler({ fireSystem: fire, prebuiltZones: layout.groundHazardZones!,
      worldMetrics: metrics, worldSeed: REFERENCE_SEED, getNowMs: now });
    const director = new CoopDefenseMapEventDirector(map.mapEvents!, [handler],
      { isTriggerSatisfied: start => start.type === 'after-checkpoint' });
    const publisher = new BurningGroundPublisher(now), receiver = new BurningGroundReceiver(), legacy = legacyPublisher();
    const frameMs = 1000 / 60, tickMs = 1000 / NET_TICK_RATE_HZ, sweepUntil = 48_000, flameUntil = 58_000;
    const totals = new Map<string, Totals>();
    let client: SyncedBurningGroundSnapshot = { cells: [] }, ground: SyncedBurningGroundSnapshot = { cells: [] };
    let nextTick = 0, peakWarnings = 0, checkedTicks = 0;
    try {
      while (frameTime < flameUntil) {
        frameTime += frameMs;
        director.hostUpdate(frameMs, false);
        if (frameTime > sweepUntil) {
          // A flamethrower stream: four fresh cells per frame along a slow circle, 3 s burn time.
          const angle = frameTime / 900;
          for (let i = 0; i < 4; i++) {
            fire.hostRefreshGroundCell(3_600 + Math.cos(angle) * (300 + i * 16), 1_400 + Math.sin(angle) * (300 + i * 16),
              { sourceKey: 'flamethrower:p1', ownerId: 'p1', durationMs: 3_000, sourceId: 'ground_fire.flamethrower' }, now());
          }
        }
        ground = fire.hostUpdate(now()).ground;
        if (frameTime < nextTick) continue;
        nextTick += tickMs;
        peakWarnings = Math.max(peakWarnings, ground.warnings?.length ?? 0);
        const phase = frameTime <= sweepUntil ? 'sweep' : 'flame';
        for (const kind of ['legacy', 'binary'] as const) {
          const key = `${phase}.${kind}`;
          const total = totals.get(key) ?? emptyTotals();
          totals.set(key, total);
          total.ticks++;
          let started = performance.now();
          const slice = kind === 'legacy' ? legacy(ground) : publisher.publish(ground);
          const json = slice ? JSON.stringify(slice) : null;
          total.hostMs += performance.now() - started;
          if (!slice || !json) continue;
          account(total, json, slice);
          started = performance.now();
          const wire = JSON.parse(json) as Slice;
          if (kind === 'binary') client = receiver.merge(wire, client, now());
          total.clientMs += performance.now() - started;
        }
        if (++checkedTicks % 10 === 0) {
          // The client holds the host's live cells exactly and every pending warning within one frame.
          const at = now();
          expect(cellKeys(client, at)).toEqual(cellKeys(ground, at));
          const hostWarnings = warningTimes(ground, at), clientWarnings = warningTimes(client, at);
          expect([...clientWarnings.keys()]).toEqual([...hostWarnings.keys()]);
          for (const [key, times] of hostWarnings) {
            expect(clientWarnings.get(key)!.every((time, index) => Math.abs(time - times[index]) <= 16)).toBe(true);
          }
        }
      }
      const at = now();
      expect(cellKeys(client, at)).toEqual(cellKeys(ground, at));
      expect(warningKeys(client, at)).toEqual(warningKeys(ground, at));

      // Complete slice of the permanent burn clearing once the flamethrower cells have expired.
      frameTime += 5_000;
      ground = fire.hostUpdate(now()).ground;
      const legacyJson = JSON.stringify(legacyPublisher()(ground, true));
      const timings = { encode: [] as number[], reencode: [] as number[], decode: [] as number[], unchanged: [] as number[] };
      let json = '';
      const journal = new GroundFireChangeJournal();
      for (let run = 0; run < 25; run++) {
        // Cold: a fresh publisher converts every cell; then one journaled change with cached wire forms.
        let started = performance.now();
        const publisher = new BurningGroundPublisher(now);
        json = JSON.stringify(publisher.publishComplete(ground));
        timings.encode.push(performance.now() - started);
        const changed = [...ground.cells], refreshed = { ...changed[run], intensity: changed[run].intensity + 1 };
        changed[run] = refreshed;
        journal.record(changed, { base: ground.cells, removed: [], upserts: [refreshed] });
        started = performance.now();
        JSON.stringify(publisher.publishComplete({ cells: changed }));
        timings.reencode.push(performance.now() - started);
        const fresh = new BurningGroundReceiver();
        started = performance.now();
        const decoded = fresh.merge(JSON.parse(json), { cells: [] }, now());
        timings.decode.push(performance.now() - started);
        started = performance.now();
        const repeated = fresh.merge(JSON.parse(json), decoded, now());
        timings.unchanged.push(performance.now() - started);
        expect(repeated.cells).toBe(decoded.cells);
        expect(cellKeys(decoded, now())).toEqual(cellKeys(ground, now()));
      }
      const sizes = (text: string) => ({ rawBytes: text.length, deflateBytes: deflateRawSync(Buffer.from(text)).length });
      const report = {
        peakWarnings,
        phases: Object.fromEntries([...totals].map(([key, total]) => [key, summarize(total, key.endsWith('binary'))])),
        full: { permanentCells: ground.cells.length, legacy: sizes(legacyJson),
          binary: { ...sizes(json), hostColdEncodeMs: +median(timings.encode).toFixed(3),
            hostReencodeMs: +median(timings.reencode).toFixed(3), clientDecodeMs: +median(timings.decode).toFixed(3),
            clientUnchangedMs: +median(timings.unchanged).toFixed(3) } },
      };
      console.log(JSON.stringify(report, null, 1));
      expect(ground.cells.length).toBeGreaterThan(1_000);
      expect(json.length * 10).toBeLessThan(legacyJson.length);
    } finally {
      director.reset(); fire.destroyAll(); vi.restoreAllMocks();
      applyArenaMetricsForMode('deathmatch', 'LOBBY');
    }
  });
});
