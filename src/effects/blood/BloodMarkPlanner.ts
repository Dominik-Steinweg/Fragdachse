import { BLOOD_HIT_VFX } from '../../config';
import { BloodChannel, BloodFieldModel, BloodMarkKind } from './BloodFieldModel';
import { classifyBloodPoint, createBloodLanding, landBloodFlight, type BloodLanding, type BloodTerrain } from './BloodTerrain';

export type BloodFieldConfig = typeof BLOOD_HIT_VFX.field;
export type BloodBandKey = 'tiny' | 'light' | 'medium' | 'heavy';
export type BloodFlightKind = 'streak' | 'droplet' | 'micro';

/** Mulberry32 like `createSeededRandom`, kept local so the planner stays free of Phaser. */
function seededRandom(seed: number): () => number {
  let state = (seed >>> 0) || 0x6d2b79f5;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function bloodBandKey(totalDamage: number): BloodBandKey {
  const bands = BLOOD_HIT_VFX.bands;
  if (totalDamage <= bands.tiny.maxDamage) return 'tiny';
  if (totalDamage <= bands.light.maxDamage) return 'light';
  if (totalDamage <= bands.medium.maxDamage) return 'medium';
  return 'heavy';
}

export interface BloodHitInput {
  readonly x: number;
  readonly y: number;
  /** Shot direction (need not be normalized); zero picks a seeded direction. */
  readonly dirX: number;
  readonly dirY: number;
  readonly totalDamage: number;
  readonly isKill: boolean;
  readonly isCritical?: boolean;
  readonly seed: number;
  readonly nowMs: number;
  /** Blood colour of the hit body (0xRRGGBB); absent for the default red. */
  readonly color?: number;
}

/** A surface ripple the owner submits to the water each frame until it has run out. */
export interface BloodRipple { x: number; y: number; bornAtMs: number; radius: number; strength: number }

/**
 * Turns one hit into persistent marks: the pool under the body, connective blobs, directional
 * spatter where the spray lands, sticking splats, rivulets and foot pools at rock faces, and
 * clouds plus ripples in water. Deterministic for a seed and the current field state. Pure: the
 * owner provides the terrain and renders the model.
 */
export class BloodMarkPlanner {
  private terrain: BloodTerrain | null = null;
  private readonly scratch = createBloodLanding();
  private readonly ripplesList: BloodRipple[] = [];
  private admitted = 0;
  /** Share of new spatter kept; drops as the field fills, so older blood is not pushed out. */
  private thinning = 1;
  // Per-hit state between begin/end.
  private rng: () => number = Math.random;
  private hitNowMs = 0;
  private band: BloodBandKey = 'light';
  private kill = false;
  private lifeMs = 0;
  private drips = 0;
  private rippleCandidate: BloodRipple | null = null;
  private hitOpen = false;
  private color: number | undefined = undefined;

  constructor(private readonly model: BloodFieldModel, private readonly config: BloodFieldConfig = BLOOD_HIT_VFX.field) {}

  setTerrain(terrain: BloodTerrain | null): void { this.terrain = terrain; }
  getTerrain(): BloodTerrain | null { return this.terrain; }
  get ripples(): readonly BloodRipple[] { return this.ripplesList; }

  /** Clips a flight before its particle spawns; `over` is a seeded 0..1 for the rock-top share. */
  land(startX: number, startY: number, endX: number, endY: number, over: number, out: BloodLanding): BloodLanding {
    return landBloodFlight(this.terrain, startX, startY, endX, endY, over, {
      landingDepthPx: this.config.water.landingDepthPx,
      overShare: this.config.rock.overShare,
      overDepthPx: this.config.rock.overDepthPx,
    }, out);
  }

  /**
   * Once per frame: the spatter admission budget restarts and spent ripples drop out. `load` is the
   * field's fill (marks / budget): past half full, new spatter thins out so older blood can stay.
   */
  beginFrame(nowMs: number, load = 0): void {
    this.admitted = 0;
    this.thinning = Math.max(0.3, 1 - Math.max(0, load - 0.5) / 0.4 * 0.7);
    const life = this.config.water.rippleLifeMs;
    for (let index = this.ripplesList.length - 1; index >= 0; index--) {
      if (nowMs - this.ripplesList[index].bornAtMs > life) this.ripplesList.splice(index, 1);
    }
  }

  clear(): void { this.ripplesList.length = 0; this.hitOpen = false; }

  /** Starts a hit: pours the pool under the body and the blobs that tie it to the spray. */
  beginHit(hit: BloodHitInput): void {
    const config = this.config;
    this.rng = seededRandom((hit.seed ^ 0x51b10d) >>> 0);
    this.hitNowMs = hit.nowMs;
    this.band = bloodBandKey(hit.totalDamage);
    this.kill = hit.isKill;
    this.lifeMs = hit.isKill ? config.lifeMs.kill : config.lifeMs[this.band];
    this.drips = 0;
    this.rippleCandidate = null;
    this.hitOpen = true;
    this.color = hit.color;

    const length = Math.hypot(hit.dirX, hit.dirY);
    const angle = length > 1e-4 ? Math.atan2(hit.dirY, hit.dirX) : this.rng() * Math.PI * 2;
    const dirX = Math.cos(angle), dirY = Math.sin(angle);
    const pool = config.pool;
    // The pool sits under and just behind the body; never inside the rock the body leans on.
    const landing = this.land(hit.x, hit.y, hit.x + dirX * pool.offsetPx, hit.y + dirY * pool.offsetPx, 1, this.scratch);
    const px = landing.surface === 'rockFace' || landing.surface === 'solid' ? landing.x + landing.nx * 2 : landing.x;
    const py = landing.surface === 'rockFace' || landing.surface === 'solid' ? landing.y + landing.ny * 2 : landing.y;
    const area = hit.isKill ? pool.area.kill : pool.area[this.band];
    const atMs = hit.nowMs + pool.delayMs;
    const spreadMs = hit.isKill ? pool.killSpreadMs : pool.spreadMs;
    if (classifyBloodPoint(this.terrain, px, py, config.water.landingDepthPx) === 'water') {
      const end = hit.isKill ? config.water.killCloudEndPx : this.between(config.water.cloudEndPx);
      this.cloud(px, py, config.water.cloudStartPx * 1.4, end, atMs, config.water.spreadMs, 1);
      this.offerRipple(px, py, atMs, config.water.rippleRadiusPx * (hit.isKill ? 2 : 1.4), config.water.rippleStrength * (hit.isKill ? 1.3 : 1));
    } else {
      this.pour(px, py, area, atMs, spreadMs);
    }

    if (hit.isKill) this.fingers(px, py, angle, Math.sqrt(area), atMs, spreadMs);

    const bridges = hit.isKill ? pool.bridges.kill : pool.bridges[this.band];
    const reach = Math.sqrt(area);
    for (let index = 0; index < bridges && this.admit(); index++) {
      const distance = reach * (0.55 + 0.45 * (index + 1) / bridges) + this.between([3, 9]);
      const lateral = (this.rng() - 0.5) * 6;
      const bx = px + dirX * distance - dirY * lateral, by = py + dirY * distance + dirX * lateral;
      const land = this.land(px, py, bx, by, 1, this.scratch);
      if (land.surface !== 'ground' && land.surface !== 'deck') continue;
      const radius = this.between([2.2, 4.2]) * (hit.isKill ? 1.5 : 1);
      this.model.add({
        kind: BloodMarkKind.Pool, channel: BloodChannel.Ground, x: land.x, y: land.y, angle: 0,
        r0: radius * 0.4, r1: radius, seed: this.rng(), bornAtMs: atMs + index * 25, spreadMs: spreadMs * 0.6,
        endAtMs: atMs + this.lifeMs, shrinkMs: config.shrinkMs, color: this.color,
      });
    }
  }

  /**
   * Leaves the mark of one landed flight. `travelRatio` is the flight distance against the band's
   * longest flight (near stains are bigger and rounder, far ones smaller and longer).
   */
  flight(kind: BloodFlightKind, landing: Readonly<BloodLanding>, startX: number, startY: number,
    travelRatio: number, sizeScale: number, delayMs: number): void {
    if (!this.hitOpen) return;
    const config = this.config, spatter = config.spatter;
    const atMs = this.hitNowMs + Math.max(0, delayMs);
    const heading = Math.atan2(landing.y - startY, landing.x - startX);
    const ratio = Math.max(0, Math.min(1, travelRatio));
    const distanceScale = spatter.nearScale + (spatter.farScale - spatter.nearScale) * ratio;
    const killScale = this.kill ? spatter.killScale : 1;
    // Only some flights leave a stain; rock faces keep the streaks that struck them (thinned under load).
    const marks = this.rng() < spatter.markShare[kind] * this.thinning;
    if (!marks && !(landing.surface === 'rockFace' && kind === 'streak' && this.rng() < this.thinning)) return;

    switch (landing.surface) {
      case 'water': {
        const size = kind === 'streak' ? 0.75 : kind === 'droplet' ? 0.5 : 0.3;
        if (!this.admit()) return;
        this.cloud(landing.x, landing.y, config.water.cloudStartPx * size, this.between(config.water.cloudEndPx) * size * killScale,
          atMs, config.water.spreadMs, kind === 'micro' ? 0.6 : 0.85);
        this.offerRipple(landing.x, landing.y, atMs, config.water.rippleRadiusPx * size, config.water.rippleStrength * size);
        return;
      }
      case 'rockFace':
        this.rockFace(kind, landing, atMs, sizeScale * killScale);
        return;
      case 'rockTop': {
        if (!this.admit()) return;
        const width = this.between(config.rock.splatWidthPx) * 0.6 * sizeScale;
        this.splat(BloodChannel.Rock, landing.x, landing.y, heading, width, width * 1.8, atMs, 0);
        return;
      }
      case 'solid':
        // Stopped by a post, base or barrier: it runs down and collects at the foot.
        this.pour(landing.x + landing.nx * 3, landing.y + landing.ny * 3, 14 * sizeScale * killScale, atMs + 160, 520);
        return;
      default: {
        if (!this.admit()) return;
        const widthRange = kind === 'streak' ? spatter.streakWidthPx : kind === 'droplet' ? spatter.dropletWidthPx : spatter.microWidthPx;
        // Many small stains, few large ones.
        const size = this.rng();
        const width = (widthRange[0] + (widthRange[1] - widthRange[0]) * size * size) * sizeScale * distanceScale * killScale;
        const elongation = kind === 'micro' ? 1 + this.rng() * 0.6 : 1 + (spatter.maxElongation - 1) * ratio * (0.7 + 0.3 * this.rng());
        this.splat(BloodChannel.Ground, landing.x, landing.y, heading, width, width * elongation, atMs, 0);
        if (kind !== 'micro' && this.rng() < spatter.satelliteChance && this.admit()) {
          // A detached droplet flung ahead of the stain's tail.
          const ahead = width * elongation + width * (1.2 + this.rng() * 1.6);
          const sx = landing.x + Math.cos(heading) * ahead + (this.rng() - 0.5) * width;
          const sy = landing.y + Math.sin(heading) * ahead + (this.rng() - 0.5) * width;
          if (classifyBloodPoint(this.terrain, sx, sy, config.water.landingDepthPx) !== 'water') {
            const small = width * (0.35 + this.rng() * 0.2);
            this.splat(BloodChannel.Ground, sx, sy, heading, small, small * 1.4, atMs + 20, 1);
          }
        }
      }
    }
  }

  /** Ends a hit: the strongest water impact of the hit becomes a ripple. */
  endHit(): void {
    if (this.rippleCandidate) this.ripplesList.push(this.rippleCandidate);
    if (this.ripplesList.length > 24) this.ripplesList.splice(0, this.ripplesList.length - 24);
    this.rippleCandidate = null;
    this.hitOpen = false;
  }

  /** Blood poured at a point outside the hit path (rage bursts, bleeding); merges like hit pools. */
  pourAt(x: number, y: number, area: number, nowMs: number, lifeMs: number, seed: number,
    spreadMs = this.config.pool.spreadMs, color?: number): void {
    this.rng = seededRandom((seed ^ 0x2f00d) >>> 0);
    this.hitNowMs = nowMs;
    this.lifeMs = lifeMs;
    this.color = color;
    if (classifyBloodPoint(this.terrain, x, y, this.config.water.landingDepthPx) === 'water') {
      this.cloud(x, y, this.config.water.cloudStartPx, Math.sqrt(area) * 1.4, nowMs, this.config.water.spreadMs, 0.9);
      return;
    }
    this.pour(x, y, area, nowMs, spreadMs);
  }

  /** A kill's pool runs out in lobes along the shot while it spreads: chains of merging blobs. */
  private fingers(x: number, y: number, angle: number, radius: number, atMs: number, spreadMs: number): void {
    const count = 3 + Math.floor(this.rng() * 3);
    for (let index = 0; index < count; index++) {
      const heading = angle + (this.rng() - 0.5) * 2.2;
      const reach = 0.75 + this.rng() * 0.35;
      for (let link = 0; link < 3 && this.admit(); link++) {
        const distance = radius * (reach + link * 0.24), blob = radius * (0.3 - link * 0.07) * (0.8 + this.rng() * 0.4);
        const land = this.land(x, y, x + Math.cos(heading) * distance, y + Math.sin(heading) * distance, 1, this.scratch);
        if (land.surface !== 'ground' && land.surface !== 'deck') break;
        this.model.add({
          kind: BloodMarkKind.Pool, channel: BloodChannel.Ground, x: land.x, y: land.y, angle: 0, r0: blob * 0.3, r1: blob,
          seed: this.rng(), bornAtMs: atMs + spreadMs * (0.2 + link * 0.18), spreadMs: spreadMs * 0.5,
          endAtMs: atMs + this.lifeMs, shrinkMs: this.config.shrinkMs, color: this.color,
        });
      }
    }
  }

  private rockFace(kind: BloodFlightKind, landing: Readonly<BloodLanding>, atMs: number, scale: number): void {
    const rock = this.config.rock, nx = landing.nx, ny = landing.ny, tx = -ny, ty = nx;
    if (!this.admit()) {
      this.pour(landing.x + nx * rock.footOffsetPx, landing.y + ny * rock.footOffsetPx, rock.footArea * 0.35 * scale, atMs + 260, 600);
      return;
    }
    // The splash spreads sideways along the face where it struck, a little way up the face.
    const width = this.between(rock.splatWidthPx) * scale * (kind === 'streak' ? 1 : 0.55);
    const up = 3 + this.rng() * 7;
    const sideways = this.rng() < 0.5 ? 0 : Math.PI;
    this.splat(BloodChannel.Rock, landing.x - nx * up, landing.y - ny * up, Math.atan2(ty, tx) + sideways + (this.rng() - 0.5) * 0.6,
      width, width * (2 + this.rng() * 1.5), atMs, 0);
    if (kind !== 'streak') return;
    // Flecks flung further up the face.
    const flecks = this.thinning > 0.7 ? (this.rng() < 0.5 ? 2 : 1) : (this.rng() < this.thinning ? 1 : 0);
    for (let index = 0; index < flecks && this.admit(); index++) {
      const fleck = width * (0.3 + this.rng() * 0.3), depth = 6 + this.rng() * 12, offset = (this.rng() - 0.5) * 18;
      this.splat(BloodChannel.Rock, landing.x - nx * depth + tx * offset, landing.y - ny * depth + ty * offset,
        Math.atan2(-ny, -nx) + (this.rng() - 0.5) * 1.2, fleck, fleck * (1.2 + this.rng()), atMs + 10, 1);
    }
    const [minDrips, maxDrips] = rock.dripsPerHit;
    const allowed = this.kill ? maxDrips + 1 : minDrips + Math.floor(this.rng() * (maxDrips - minDrips + 1));
    if (this.drips >= allowed) {
      this.pour(landing.x + nx * rock.footOffsetPx, landing.y + ny * rock.footOffsetPx, rock.footArea * 0.35 * scale, atMs + 260, 600);
      return;
    }
    this.drips++;
    // A rivulet runs down the face from higher up and collects at the foot.
    const start = this.between(rock.dripStartPx);
    const along = (this.rng() - 0.5) * 16;
    const runMs = this.between(rock.dripRunMs);
    const dripWidth = this.between(rock.dripWidthPx) * Math.min(1.4, scale);
    this.model.add({
      kind: BloodMarkKind.Drip, channel: BloodChannel.Rock,
      x: landing.x - nx * start + tx * along, y: landing.y - ny * start + ty * along, angle: Math.atan2(ny, nx),
      r0: dripWidth, r1: Math.max(1, start - 1.5), aux: runMs, seed: this.rng(), bornAtMs: atMs + 40, spreadMs: runMs,
      endAtMs: atMs + this.lifeMs, shrinkMs: this.config.shrinkMs, color: this.color,
    });
    this.pour(landing.x + nx * rock.footOffsetPx + tx * along, landing.y + ny * rock.footOffsetPx + ty * along,
      rock.footArea * scale, atMs + runMs * 0.85, 700);
  }

  private pour(x: number, y: number, area: number, atMs: number, spreadMs: number): void {
    const config = this.config, pool = config.pool;
    const result = this.model.feedPool({
      x, y, area, channel: BloodChannel.Ground, atMs, spreadMs, lifeMs: this.lifeMs, maxLifeMs: config.maxLifeMs,
      shrinkMs: config.shrinkMs, maxRadiusPx: pool.maxRadiusPx, growCore: pool.growCore, mergeMarginPx: pool.mergeMarginPx,
      seed: this.rng(), color: this.color,
    });
    this.seep(result.slot, x, y, result.radius, atMs, spreadMs);
  }

  /** A pool touching the waterline bleeds into the water as a slowly spreading cloud. */
  private seep(slot: number, x: number, y: number, radius: number, atMs: number, spreadMs: number): void {
    const terrain = this.terrain, water = this.config.water;
    if (!terrain || slot < 0 || terrain.waterDepth(x, y) < -(radius + 8)) return;
    let bestX = 0, bestY = 0, bestDepth: number = water.landingDepthPx;
    for (let step = 0; step < 8; step++) {
      const angle = step * Math.PI / 4, sx = x + Math.cos(angle) * (radius + 3), sy = y + Math.sin(angle) * (radius + 3);
      const depth = terrain.waterDepth(sx, sy);
      if (depth > bestDepth && !terrain.onDeck(sx, sy)) { bestDepth = depth; bestX = sx; bestY = sy; }
    }
    if (bestDepth <= water.landingDepthPx || !this.model.claimSeep(slot, atMs, water.seepIntervalMs)) return;
    this.cloud(bestX, bestY, radius * 0.3, radius * 1.1 + 6, atMs + spreadMs * 0.5, water.seepMs, 0.65);
  }

  private splat(channel: BloodChannel, x: number, y: number, heading: number, width: number, length: number,
    atMs: number, satellite: number): void {
    this.model.add({
      kind: BloodMarkKind.Splat, channel, x, y, angle: heading, r0: width, r1: Math.max(width, length), aux: satellite,
      seed: this.rng(), bornAtMs: atMs, spreadMs: 90, endAtMs: atMs + this.lifeMs * (satellite ? 0.85 : 1),
      shrinkMs: this.config.shrinkMs, color: this.color,
    });
  }

  private cloud(x: number, y: number, r0: number, r1: number, atMs: number, spreadMs: number, amount: number): void {
    const water = this.config.water;
    this.model.add({
      kind: BloodMarkKind.Cloud, channel: BloodChannel.Water, x, y, angle: this.rng() * Math.PI * 2,
      r0: Math.max(1, r0), r1: Math.max(r0 + 2, r1), seed: this.rng(), bornAtMs: atMs, spreadMs,
      endAtMs: atMs + water.lifeMs, shrinkMs: water.lifeMs * 0.45, amount, color: this.color,
    });
  }

  private offerRipple(x: number, y: number, atMs: number, radius: number, strength: number): void {
    if (!this.rippleCandidate || strength > this.rippleCandidate.strength) {
      this.rippleCandidate = { x, y, bornAtMs: atMs, radius, strength: Math.min(1, strength) };
    }
  }

  private admit(): boolean {
    if (this.admitted >= this.config.admissionPerFrame) return false;
    this.admitted++;
    return true;
  }

  private between(range: readonly [number, number]): number {
    return range[0] + (range[1] - range[0]) * this.rng();
  }
}
