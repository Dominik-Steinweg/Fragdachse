import type * as Phaser from 'phaser';
import type { ArenaRuntime } from '../../scenes/arena/ArenaRuntime';
import type { SyncedHitEffect } from '../../types';
import type { DevScenarioController } from './controller';
import type { GridPoint } from './config';

const fixtures = new WeakMap<DevScenarioController, { runtime: ArenaRuntime; review: BloodReview | null }>();

export const BLOOD_REVIEW_SCENES = ['rockWall', 'rockCorner', 'pond', 'shore', 'poolGrowth', 'killPool', 'trail', 'bridge',
  'bands', 'massFight'] as const;
export type BloodReviewScene = typeof BLOOD_REVIEW_SCENES[number];

interface ScheduledHit { readonly at: number; readonly effect: SyncedHitEffect }
interface Spot { readonly cell: GridPoint; readonly x: number; readonly y: number; readonly dirX: number; readonly dirY: number;
  readonly path?: { dx: number; dy: number } }

/** Mulberry32; the review stays free of Phaser imports (headless scenario tests load it). */
function seededRandom(seed: number): () => number {
  let state = (seed >>> 0) || 0x6d2b79f5;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIRS = [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }] as const;

type Targets = ReturnType<ArenaRuntime['getScenarioBloodTargets']>;

/**
 * Blood lab: replays fixed hit sequences at spots it finds on the live World (a rock wall, a
 * rock corner, open water, a shore, a bridge, open ground), so the persistent blood can be judged
 * on real terrain, light and fog. Hits are local presentation only; gameplay never sees them.
 */
class BloodReview {
  private readonly queue: ScheduledHit[] = [];
  private seed: number;
  readonly spot: Spot;

  constructor(private readonly scene: Phaser.Scene, private readonly targets: Targets, readonly name: BloodReviewScene,
    private readonly damage: number, seed: number, count: number, color: number | null) {
    this.seed = seed;
    // The review's own hits may bleed an authored colour; every other target keeps the game's resolver.
    if (color !== null) targets.effects.setBloodColorResolver(id => id === 'blood-review' ? color : targets.resolveBloodColor(id));
    const spot = findSpot(targets, name);
    if (!spot) throw new Error(`Keine passende Stelle für ${name} auf dieser Karte.`);
    this.spot = spot;
    this.plan(count);
    scene.events.on('postupdate', this.update, this);
  }

  get pending(): number { return this.queue.length; }

  destroy(): void {
    this.scene.events.off('postupdate', this.update, this);
    this.queue.length = 0;
    this.targets.effects.setBloodColorResolver(this.targets.resolveBloodColor);
  }

  private plan(count: number): void {
    const now = this.scene.time.now, s = this.spot, damage = this.damage;
    const hit = (delay: number, x: number, y: number, dirX: number, dirY: number, total = damage, kill = false, critical = false) =>
      this.queue.push({ at: now + delay, effect: this.effect(x, y, dirX, dirY, total, kill, critical) });
    // Seeded: the same seed replays the same scene, so before/after captures compare like for like.
    const random = seededRandom(this.seed ^ 0x5eed);
    const jitter = (amount: number) => (random() - 0.5) * amount;
    switch (this.name) {
      case 'rockWall': case 'rockCorner': case 'shore':
        for (let i = 0; i < count; i++) {
          const a = Math.atan2(s.dirY, s.dirX) + jitter(0.5);
          hit(i * 320, s.x + jitter(10), s.y + jitter(10), Math.cos(a), Math.sin(a), damage, false, i % 4 === 3);
        }
        hit(count * 320 + 400, s.x, s.y, s.dirX, s.dirY, Math.max(damage, 60), true);
        break;
      case 'pond': case 'bridge':
        for (let i = 0; i < count; i++) {
          const a = random() * Math.PI * 2;
          hit(i * 380, s.x + jitter(24), s.y + jitter(24), Math.cos(a), Math.sin(a));
        }
        hit(count * 380 + 300, s.x, s.y, s.dirX, s.dirY, Math.max(damage, 60), true);
        break;
      case 'poolGrowth':
        for (let i = 0; i < count; i++) {
          const a = Math.atan2(s.dirY, s.dirX) + jitter(1.4);
          hit(i * 260, s.x + jitter(6), s.y + jitter(6), Math.cos(a), Math.sin(a));
        }
        break;
      case 'killPool':
        hit(0, s.x, s.y, s.dirX, s.dirY, Math.max(damage, 60), true);
        break;
      case 'trail': {
        const step = 32, path = s.path ?? { dx: 1, dy: 0 };
        for (let i = 0; i < Math.max(count, 6); i++) {
          const a = Math.atan2(path.dy, path.dx) + Math.PI / 2 * (i % 2 ? 1 : -1) + jitter(0.8);
          hit(i * 200, s.x + path.dx * step * i * 0.7, s.y + path.dy * step * i * 0.7, Math.cos(a), Math.sin(a));
        }
        break;
      }
      case 'bands': {
        // Tiny, light, medium, heavy and a kill side by side, same direction.
        const totals = [2, 10, 26, 50, 70];
        totals.forEach((total, i) => hit(i * 150, s.x + (i - 2) * 64, s.y, s.dirX, s.dirY, total, i === 4));
        break;
      }
      case 'massFight': {
        // Around the spot (the camera only moves there after planning), about one screen wide.
        const hits = Math.max(1, count) * 25;
        for (let i = 0; i < hits; i++) {
          const x = s.x + (random() - 0.5) * 900, y = s.y + (random() - 0.5) * 500;
          const a = random() * Math.PI * 2;
          hit(i * 25, x, y, Math.cos(a), Math.sin(a), 6 + random() * 40, random() < 0.12);
        }
        break;
      }
    }
  }

  private effect(x: number, y: number, dirX: number, dirY: number, total: number, kill: boolean, critical: boolean): SyncedHitEffect {
    this.seed = (Math.imul(this.seed ^ (this.seed >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    return { type: 'hit', x, y, targetId: 'blood-review', totalDamage: total, hpLost: total, armorLost: 0, isKill: kill,
      isCritical: critical, dirX, dirY, seed: this.seed };
  }

  private update(): void {
    const now = this.scene.time.now;
    while (this.queue.length && this.queue[0].at <= now) {
      const next = this.queue.shift()!;
      this.targets.effects.playLocalHitEffect(next.effect);
    }
  }
}

function findSpot(targets: Targets, name: BloodReviewScene): Spot | null {
  const { layout, metrics, geometry } = targets;
  if (!layout || !metrics || !geometry) return null;
  const queries = geometry.getQueries();
  const water = new Set((layout.water ?? []).map(cell => `${cell.gridX},${cell.gridY}`));
  const rocks = new Set(layout.rocks.map(cell => `${cell.gridX},${cell.gridY}`));
  const inside = (gx: number, gy: number) => gx >= 1 && gy >= 1 && gx < metrics.gridCols - 1 && gy < metrics.gridRows - 1;
  const centre = (gx: number, gy: number) => ({ x: metrics.offsetX + gx * 32 + 16, y: metrics.offsetY + gy * 32 + 16 });
  const isWater = (gx: number, gy: number) => water.has(`${gx},${gy}`);
  const isRock = (gx: number, gy: number) => rocks.has(`${gx},${gy}`) && queries.isCircleBlocked(centre(gx, gy).x, centre(gx, gy).y, 2);
  const open = (gx: number, gy: number) => inside(gx, gy) && !isWater(gx, gy) && !rocks.has(`${gx},${gy}`)
    && !queries.isCircleBlocked(centre(gx, gy).x, centre(gx, gy).y, 14);
  const openArea = (gx: number, gy: number, r: number) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (!open(gx + dx, gy + dy)) return false;
    return true;
  };
  // Scan from the map centre outwards so spots stay near the action and stable across reloads.
  const cells: GridPoint[] = [];
  for (let gy = 1; gy < metrics.gridRows - 1; gy++) for (let gx = 1; gx < metrics.gridCols - 1; gx++) cells.push({ gridX: gx, gridY: gy });
  const cx = metrics.gridCols / 2, cy = metrics.gridRows / 2;
  cells.sort((a, b) => Math.hypot(a.gridX - cx, a.gridY - cy) - Math.hypot(b.gridX - cx, b.gridY - cy));
  const spot = (cell: GridPoint, dx: number, dy: number, offset = { x: 0, y: 0 }, path?: { dx: number; dy: number }): Spot => {
    const c = centre(cell.gridX, cell.gridY), length = Math.hypot(dx, dy) || 1;
    return { cell, x: c.x + offset.x, y: c.y + offset.y, dirX: dx / length, dirY: dy / length, path };
  };
  for (const cell of cells) {
    const { gridX: gx, gridY: gy } = cell;
    switch (name) {
      case 'rockWall':
        // A wall: the rock and both its neighbours along the face, two open cells in front.
        if (!isRock(gx, gy)) break;
        for (const d of DIRS) {
          const side = { dx: d.dy, dy: d.dx };
          if (!isRock(gx + side.dx, gy + side.dy) || !isRock(gx - side.dx, gy - side.dy)) continue;
          if (!open(gx + d.dx, gy + d.dy) || !openArea(gx + d.dx * 2, gy + d.dy * 2, 1)) continue;
          return spot({ gridX: gx + d.dx * 2, gridY: gy + d.dy * 2 }, -d.dx, -d.dy, { x: d.dx * 6, y: d.dy * 6 });
        }
        break;
      case 'rockCorner':
        if (!isRock(gx, gy)) break;
        for (const dx of [-1, 1]) for (const dy of [-1, 1]) {
          if (isRock(gx + dx, gy) || isRock(gx, gy + dy) || !openArea(gx + dx * 2, gy + dy * 2, 1)) continue;
          return spot({ gridX: gx + dx * 2, gridY: gy + dy * 2 }, -dx, -dy);
        }
        break;
      case 'pond': {
        let deep = isWater(gx, gy);
        for (let dy = -1; dy <= 1 && deep; dy++) for (let dx = -1; dx <= 1 && deep; dx++) deep = isWater(gx + dx, gy + dy);
        if (deep) return spot(cell, 1, 0);
        break;
      }
      case 'shore':
        if (!openArea(gx, gy, 0)) break;
        for (const d of DIRS) {
          if (!isWater(gx + d.dx, gy + d.dy) || !isWater(gx + d.dx * 2, gy + d.dy * 2) || !open(gx - d.dx, gy - d.dy)) continue;
          return spot(cell, d.dx, d.dy, { x: -d.dx * 6, y: -d.dy * 6 });
        }
        break;
      case 'bridge': {
        const deck = layout.bridges?.find(b => !geometry.getCollapsedBridgeIds().has(b.id));
        if (!deck) return null;
        const across = deck.deckWidthCells / 2;
        const x = metrics.offsetX + (deck.axis === 'horizontal' ? deck.gridX + deck.spanCells / 2 : deck.gridX + across) * 32;
        const y = metrics.offsetY + (deck.axis === 'horizontal' ? deck.gridY + across : deck.gridY + deck.spanCells / 2) * 32;
        return { cell, x, y, dirX: deck.axis === 'horizontal' ? 0 : 1, dirY: deck.axis === 'horizontal' ? 1 : 0 };
      }
      case 'poolGrowth': case 'killPool': case 'bands': case 'massFight':
        if (openArea(gx, gy, name === 'bands' ? 3 : 2)) return spot(cell, 1, 0.35);
        break;
      case 'trail':
        for (const d of DIRS) {
          let ok = true;
          for (let i = -1; i <= 6 && ok; i++) ok = openArea(gx + d.dx * i, gy + d.dy * i, 1);
          if (ok) return spot(cell, d.dx, d.dy, undefined, d);
        }
        break;
    }
  }
  return null;
}

export function bindBloodReview(controller: DevScenarioController, runtime: ArenaRuntime): void {
  fixtures.set(controller, { runtime, review: null });
}

export function releaseBloodReview(controller: DevScenarioController): void {
  fixtures.get(controller)?.review?.destroy();
  fixtures.delete(controller);
}

/**
 * window.devScenario.run({action:'bloodReview', scene:'rockWall'|'rockCorner'|'pond'|'shore'|'poolGrowth'|
 *   'killPool'|'trail'|'bridge'|'bands'|'massFight'|'clear'|'status'|'pump', damage?, count?, seed?, zoom?, keep?, frames?,
 *   color? (0xRRGGBB blood colour of the review hits)}).
 * Each scene centres the camera on its spot; `keep:true` leaves earlier blood in place.
 */
export function runBloodReview(controller: DevScenarioController, command: Record<string, unknown>): void {
  const fixture = fixtures.get(controller);
  if (!fixture) throw new Error('Blood review is not bound');
  const targets = fixture.runtime.getScenarioBloodTargets();
  const scene = command.scene ?? 'status';
  if (scene === 'status') { controller.lastAction = { bloodReview: status(fixture.review, targets) }; return; }
  if (scene === 'pump') {
    // A hidden browser pane gets no animation frames: advance the game loop by hand (60 Hz steps).
    const frames = typeof command.frames === 'number' ? Math.max(1, Math.min(900, Math.round(command.frames))) : 60;
    const loop = targets.scene.game.loop;
    let time = loop.lastTime || performance.now();
    for (let frame = 0; frame < frames; frame++) { time += 1000 / 60; loop.step(time); }
    controller.lastAction = { bloodReview: status(fixture.review, targets) };
    return;
  }
  if (scene === 'clear') {
    fixture.review?.destroy(); fixture.review = null;
    targets.blood.clear();
    controller.lastAction = { bloodReview: status(null, targets) };
    return;
  }
  if (!BLOOD_REVIEW_SCENES.includes(scene as BloodReviewScene)) throw new Error(`scene: ${BLOOD_REVIEW_SCENES.join(', ')}, clear oder status erwartet.`);
  controller.requireReadyForBots();
  fixture.review?.destroy();
  if (command.keep !== true) targets.blood.clear();
  const damage = typeof command.damage === 'number' ? Math.max(1, Math.min(200, command.damage)) : 24;
  const count = typeof command.count === 'number' ? Math.max(1, Math.min(40, Math.round(command.count))) : 8;
  const seed = typeof command.seed === 'number' ? command.seed >>> 0 : 0xb100d;
  const color = typeof command.color === 'number' && Number.isInteger(command.color) && command.color >= 0 && command.color <= 0xffffff
    ? command.color : null;
  const review = new BloodReview(targets.scene, targets, scene as BloodReviewScene, damage, seed, count, color);
  fixture.review = review;
  controller.aim = controller.grid({ x: review.spot.x, y: review.spot.y });
  controller.cameraAtTarget = true;
  controller.zoom = typeof command.zoom === 'number' ? Math.max(0.5, Math.min(4, command.zoom)) : 2;
  controller.lastAction = { bloodReview: status(review, targets) };
}

function status(review: BloodReview | null, targets: Targets) {
  return { scene: review?.name ?? null, pendingHits: review?.pending ?? 0,
    spot: review ? { x: Math.round(review.spot.x), y: Math.round(review.spot.y) } : null, ...targets.blood.getStats(),
    receivers: targets.blood.debugState() };
}
