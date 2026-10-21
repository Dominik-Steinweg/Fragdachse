import { CANOPY_RADIUS, CELL_SIZE, TRUNK_RADIUS } from '../config';
import type { ArenaLayout } from '../types';
import type { ChunkWorldFrame, ChunkWorldRect } from './chunks/ArenaChunkGrid';
import { hashSeededCell01 } from './CellHash';
import { AMBIENT_WILDLIFE as TUNING } from './AmbientWildlifeConfig';
import { createWildlifeAppearance, isWingedInsect, WILDLIFE_KINDS, type WildlifeAppearance, type WildlifeKind } from './AmbientWildlifeAppearance';
import { DEFAULT_TIME_OF_DAY_MINUTES, normalizeTimeOfDay } from '../effects/TimeOfDay';
import { AmbientWildlifeBirds, type WildlifeBirdState } from './AmbientWildlifeBirds';

export type { WildlifeKind } from './AmbientWildlifeAppearance';
export type FishPhase = 'swimming' | 'fleeing' | 'diving' | 'hidden' | 'emerging';
/** A displayed body (player or enemy); local presentation only, never wire state. */
export interface WildlifeMover {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  /** Half-size beyond a player-sized body: distances are measured to the body's edge. */
  readonly radius?: number;
}
export type WildlifeImpulseKind = 'shot' | 'explosion';
/** The nearest live impulse that alarmed an animal; its reach is fixed when it is noticed. */
export interface WildlifeAlarm { x: number; y: number; until: number; reach: number }
export interface WildlifeAnimal {
  readonly kind: WildlifeKind;
  readonly homeX: number;
  readonly homeY: number;
  readonly variation: number;
  readonly phaseOffset: number;
  readonly appearance: WildlifeAppearance;
  x: number;
  y: number;
  angle: number;
  turnSpeed: number;
  avoidanceAngle: number | null;
  speed: number;
  animation: number;
  opacity: number;
  fishPhase: FishPhase;
  phaseTime: number;
  calmTime: number;
  alertCooldown: number;
  fleeing: boolean;
  resting: boolean;
  diurnalActive: boolean;
  retireTime: number;
  readonly alarm: WildlifeAlarm;
  /** Birds only: phase, altitude and seeded spots. */
  readonly bird?: WildlifeBirdState;
}

export interface WildlifeAnimalInit {
  readonly kind: WildlifeKind;
  readonly x: number;
  readonly y: number;
  readonly homeX?: number;
  readonly homeY?: number;
  readonly variation: number;
  readonly phaseOffset: number;
  readonly appearance: WildlifeAppearance;
  readonly speed?: number;
  readonly calmTime?: number;
  readonly resting?: boolean;
  readonly diurnalActive?: boolean;
  readonly opacity?: number;
}

/** The only constructor of animal state, shared with scripted reuses of the wildlife meshes. */
export function createWildlifeAnimal(init: WildlifeAnimalInit, bird?: WildlifeBirdState): WildlifeAnimal {
  const diurnalActive = init.diurnalActive ?? true;
  return { ...(bird ? { bird } : {}), kind: init.kind, x: init.x, y: init.y, homeX: init.homeX ?? init.x, homeY: init.homeY ?? init.y,
    variation: init.variation, phaseOffset: init.phaseOffset, appearance: init.appearance,
    angle: init.phaseOffset, turnSpeed: 0, avoidanceAngle: null, speed: init.speed ?? 0,
    animation: init.phaseOffset, opacity: init.opacity ?? (diurnalActive ? 1 : 0),
    fishPhase: 'swimming', phaseTime: 0, calmTime: init.calmTime ?? 0, alertCooldown: 0, fleeing: false,
    resting: init.resting ?? false, diurnalActive, retireTime: 0, alarm: { x: 0, y: 0, until: 0, reach: 0 } };
}

interface MoverMotion { x: number; y: number; movingUntil: number; seen: number }
const TAU = Math.PI * 2;
/** Upper bound of the coarse mover grid per axis; wider spreads use coarser cells. */
const MOVER_GRID_AXIS = 64;
/** Animals further outside the view keep their state without simulation. */
const SIMULATION_MARGIN_PX = TUNING.disturbance.simulationMarginPx;
/**
 * Bodies beyond this distance from the view cannot alarm a simulated animal: the simulation margin,
 * the widest alert radius and headroom for the edge of a large body. Callers may cull movers with it.
 */
export const WILDLIFE_DISTURBANCE_MARGIN_PX = SIMULATION_MARGIN_PX
  + Math.max(...WILDLIFE_KINDS.map(kind => TUNING[kind].alertRadius)) + 128;
// Static cell flags. Probes run per animal and frame; string keys allocated thousands of times.
const WATER = 1, DEEP_WATER = 2, ROCK = 4, DIRT = 8, CROWN = 16;
/** Trunk lookups may step one cell outside the frame; offset keeps the key non-negative. */
const trunkKey = (x: number, y: number): number => (x + 32768) * 65536 + (y + 32768);
const angleDelta = (from: number, to: number): number => Math.atan2(Math.sin(to - from), Math.cos(to - from));

/** Local presentation state only. Owns no entities, physics, timers, global RNG or wire state. */
export class AmbientWildlifeModel {
  readonly animals: WildlifeAnimal[] = [];
  private readonly cols: number;
  private readonly rows: number;
  private readonly cells: Uint8Array;
  private readonly tracks = new Set<number>();
  private readonly trees: { x: number; y: number }[];
  private readonly trunks = new Map<number, { x: number; y: number }>();
  private readonly motions = new Map<string, MoverMotion>();
  // Movers compacted once per frame; threat lookups visit only nearby grid buckets.
  private readonly moverX = new Float64Array(TUNING.disturbance.moverCapacity);
  private readonly moverY = new Float64Array(TUNING.disturbance.moverCapacity);
  private readonly moverRadius = new Float64Array(TUNING.disturbance.moverCapacity);
  private readonly moverMoving = new Uint8Array(TUNING.disturbance.moverCapacity);
  private readonly bucketNext = new Int32Array(TUNING.disturbance.moverCapacity);
  private readonly bucketHead = new Int32Array(MOVER_GRID_AXIS * MOVER_GRID_AXIS);
  private moverMaxRadius = 0;
  private gridX = 0;
  private gridY = 0;
  private gridCell = 1;
  private gridCols = 0;
  private gridRows = 0;
  private threatX = 0;
  private threatY = 0;
  private threatDistance = 0;
  private readonly birds: AmbientWildlifeBirds;
  private time = 0;
  private frameId = 0;
  private daylightInitialized = false;

  constructor(layout: ArenaLayout, private readonly frame: ChunkWorldFrame) {
    this.cols = Math.max(0, Math.ceil(frame.width / CELL_SIZE));
    this.rows = Math.max(0, Math.ceil(frame.height / CELL_SIZE));
    this.cells = new Uint8Array(this.cols * this.rows);
    const mark = (gx: number, gy: number, flag: number): void => {
      if (gx >= 0 && gy >= 0 && gx < this.cols && gy < this.rows) this.cells[gy * this.cols + gx] |= flag;
    };
    for (const c of layout.water ?? []) mark(c.gridX, c.gridY, WATER);
    for (const c of layout.rocks) mark(c.gridX, c.gridY, ROCK);
    for (const c of layout.dirt) mark(c.gridX, c.gridY, DIRT);
    for (const c of layout.tracks) this.tracks.add(c.gridX);
    this.trees = layout.trees.map(c => ({
      x: frame.offsetX + (c.gridX + .5) * CELL_SIZE, y: frame.offsetY + (c.gridY + .5) * CELL_SIZE,
    }));
    layout.trees.forEach((c, i) => this.trunks.set(trunkKey(c.gridX, c.gridY), this.trees[i]));
    // Cells whose centre lies under a crown: birds neither land there nor change height band above them.
    const crownReach = CANOPY_RADIUS + 8, crownCells = Math.ceil(crownReach / CELL_SIZE);
    for (const c of layout.trees) for (let dy = -crownCells; dy <= crownCells; dy++) for (let dx = -crownCells; dx <= crownCells; dx++)
      if (Math.hypot(dx, dy) * CELL_SIZE <= crownReach) mark(c.gridX + dx, c.gridY + dy, CROWN);
    // Erode the water topology by a full cell. A school's complete footprint must
    // fit this interior, so individual fish cannot reach the shallow bank or land.
    const deepCells: number[][] = [];
    for (const c of layout.water ?? []) {
      let interior = true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
        if (!(this.flagsAt(c.gridX + dx, c.gridY + dy) & WATER)) interior = false;
      if (interior && !(this.flagsAt(c.gridX, c.gridY) & DEEP_WATER)) {
        mark(c.gridX, c.gridY, DEEP_WATER); deepCells.push([c.gridX, c.gridY]);
      }
    }
    const random = (x: number, y: number, salt: number): number => hashSeededCell01(layout.seed, x, y, salt);
    const appearanceAt = (kind: WildlifeKind, x: number, y: number, groupRoll = random(x, y, 813)): WildlifeAppearance =>
      createWildlifeAppearance(kind, random(x, y, 811), random(x, y, 812), groupRoll);
    const add = (kind: WildlifeKind, x: number, y: number, homeX = x, homeY = y,
      appearance = appearanceAt(kind, x, y)): WildlifeAnimal => {
      const salt = kind === 'moth' ? 1000 : kind === 'firefly' ? 2000 : 0;
      const variation = random(x, y, 803 + salt), phaseOffset = random(x, y, 809 + salt) * TAU;
      const resting = kind === 'butterfly' && random(x, y, 804)
        < TUNING.butterflyRestSeconds / (TUNING.butterflyRestSeconds + TUNING.butterflyFlightSeconds);
      const calmTime = kind === 'butterfly'
        ? random(x, y, 805) * (resting ? TUNING.butterflyRestSeconds : TUNING.butterflyFlightSeconds) * (.7 + variation * .6)
        : 3 + variation * 9;
      const animal = createWildlifeAnimal({ kind, x, y, homeX, homeY, variation, phaseOffset, appearance,
        speed: resting ? 0 : TUNING[kind].speed, calmTime, resting, diurnalActive: kind !== 'moth' && kind !== 'firefly' });
      this.animals.push(animal);
      return animal;
    };
    const butterflyCandidates = Math.round(TUNING.butterfly.maxCount / TUNING.butterfly.density);
    const spacing = Math.max(192, Math.sqrt(frame.width * frame.height / butterflyCandidates));
    const columns = Math.max(1, Math.min(butterflyCandidates, Math.floor(frame.width / spacing)));
    const rows = Math.max(1, Math.min(Math.floor(butterflyCandidates / columns), Math.floor(frame.height / spacing)));
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < columns; x++) {
        for (let attempt = 0; attempt < 8; attempt++) {
          const wx = frame.offsetX + (x + .12 + random(x, y, 820 + attempt) * .76) * frame.width / columns;
          const wy = frame.offsetY + (y + .12 + random(x, y, 840 + attempt) * .76) * frame.height / rows;
          if (!this.isGrass(wx, wy)) continue;
          add('butterfly', wx, wy); break;
        }
      }
    }
    // Thin the same habitat-valid candidate field, so density halves on sparse
    // maps too. A tiny patch that supports only one butterfly keeps that one.
    this.animals.sort((a, b) => random(a.homeX, a.homeY, 850) - random(b.homeX, b.homeY, 850));
    this.animals.length = Math.min(this.animals.length, Math.max(1, Math.floor(this.animals.length * TUNING.butterfly.density)));
    const insectHomes = this.animals.slice();
    for (const kind of ['moth', 'firefly'] as const) {
      // Density also thins small habitats that never reach the population cap.
      const count = Math.min(TUNING[kind].maxCount, Math.ceil(insectHomes.length * TUNING[kind].density));
      for (const home of insectHomes.slice(0, count)) {
        const salt = kind === 'moth' ? 1500 : 2500;
        const x = home.x + (random(home.x, home.y, salt) - .5) * 96;
        const y = home.y + (random(home.x, home.y, salt + 1) - .5) * 96;
        if (this.isGrass(x, y)) add(kind, x, y);
        else add(kind, home.x, home.y);
      }
    }
    // Seeded occupancy keeps most trees empty; rare shared homes remain possible.
    // Seeded priority also spreads the population cap without depending on authored order.
    const snakeTrees = this.trees.filter(tree => random(tree.x, tree.y, 863) < TUNING.snake.treeOccupancy)
      .sort((a, b) => random(a.x, a.y, 864) - random(b.x, b.y, 864));
    let snakeCount = 0;
    for (const tree of snakeTrees) {
      if (snakeCount >= TUNING.snake.maxCount) break;
      const count = random(tree.x, tree.y, 865) < TUNING.snake.groupChance
        ? 2 + Number(random(tree.x, tree.y, 866) < TUNING.snake.thirdSnakeChance) : 1;
      const members: WildlifeAnimal[] = [];
      for (let member = 0; member < count && snakeCount < TUNING.snake.maxCount; member++) {
        const appearance = createWildlifeAppearance('snake', random(tree.x, tree.y, 811 + member * 100),
          random(tree.x, tree.y, 812 + member * 100), 0);
        for (let attempt = 0; attempt < 16; attempt++) {
          const salt = member * 100 + attempt * 2;
          const angle = random(tree.x, tree.y, 900 + salt) * TAU;
          const radius = Math.min(CANOPY_RADIUS * (.76 + random(tree.x, tree.y, 901 + salt) * .27),
            CANOPY_RADIUS * 1.5 - appearance.footprint - 1);
          const x = tree.x + Math.cos(angle) * radius, y = tree.y + Math.sin(angle) * radius;
          if (!this.isLand(x, y, appearance.footprint)
            || members.some(other => Math.hypot(x - other.x, y - other.y) < 12)) continue;
          members.push(add('snake', x, y, tree.x, tree.y, appearance)); snakeCount++; break;
        }
      }
    }
    const schoolHomes: { x: number; y: number }[] = [];
    const fishStart = this.animals.length;
    deepCells.sort((a, b) => random(a[0], a[1], 880) - random(b[0], b[1], 880));
    for (const [gx, gy] of deepCells) {
      if (schoolHomes.length >= Math.round(TUNING.fish.maxCount / TUNING.fish.density)) break;
      const x = frame.offsetX + (gx + .5) * CELL_SIZE, y = frame.offsetY + (gy + .5) * CELL_SIZE;
      // Rotate through the forms from a seeded starting point, ensuring variety
      // even in small lakes without adding extra schools to the population.
      const groupIndex = (schoolHomes.length + Math.floor(random(0, 0, 881) * TUNING.fishGroups.length)) % TUNING.fishGroups.length;
      const appearance = appearanceAt('fish', x, y, (groupIndex + .5) / TUNING.fishGroups.length);
      if (!this.isDeepWater(x, y, appearance.footprint) || schoolHomes.some(p => Math.hypot(x - p.x, y - p.y) < 100)) continue;
      schoolHomes.push({ x, y });
      const animal = add('fish', x, y, x, y, appearance);
      // Stagger visibility so the water is already alive before anyone joins.
      if (schoolHomes.length > 1 && random(gx, gy, 882) < .25) { animal.fishPhase = 'hidden'; animal.opacity = 0; }
    }
    // Keep complete schools and single fish, evenly thinning the seeded sequence
    // of forms. This reduces small lakes too, while retaining their size variants.
    const candidates = this.animals.splice(fishStart);
    const fishCount = Math.min(candidates.length, Math.max(1, Math.floor(candidates.length * TUNING.fish.density)));
    for (let i = 0; i < fishCount; i++) this.animals.push(candidates[Math.floor(i * candidates.length / fishCount)]);
    const firstFish = this.animals[fishStart];
    if (firstFish) { firstFish.fishPhase = 'swimming'; firstFish.opacity = 1; }
    this.birds = new AmbientWildlifeBirds({
      seed: layout.seed, frame,
      isGround: (x, y, radius) => this.footprint(x, y, radius, 0, WATER | ROCK | CROWN, true),
      underCrown: (x, y) => (this.flagsAt(Math.floor((x - frame.offsetX) / CELL_SIZE),
        Math.floor((y - frame.offsetY) / CELL_SIZE)) & CROWN) !== 0,
      isWaterCell: (gx, gy) => (this.flagsAt(gx, gy) & WATER) !== 0,
      isOpenLandCell: (gx, gy) => gx >= 0 && gy >= 0 && gx < this.cols && gy < this.rows
        && (this.flagsAt(gx, gy) & (WATER | ROCK | CROWN)) === 0 && !this.tracks.has(gx),
      findThreat: (animal, x, y, includeStationary, out) => {
        if (!this.resolveThreatAt(animal, x, y, includeStationary)) return false;
        out.x = this.threatX; out.y = this.threatY;
        return true;
      },
      turnToward: (animal, desiredAngle, dt) => this.turnToward(animal, desiredAngle, dt),
      walk: (animal, desiredAngle, dt) => this.move(animal, desiredAngle, dt),
    });
    // Birds follow every other kind, so their seeded rolls never shift existing animals.
    this.birds.spawn(this.trees, (init, bird) => {
      const animal = createWildlifeAnimal(init, bird);
      this.animals.push(animal);
      return animal;
    });
  }

  private flagsAt(gx: number, gy: number): number {
    return gx >= 0 && gy >= 0 && gx < this.cols && gy < this.rows ? this.cells[gy * this.cols + gx] : 0;
  }

  /** Every covered cell inside the frame must hold all `required` and none of the `forbidden` flags. */
  private footprint(x: number, y: number, radius: number, required: number, forbidden: number, trackFree = false): boolean {
    if (x - radius < this.frame.offsetX || y - radius < this.frame.offsetY
      || x + radius >= this.frame.offsetX + this.frame.width || y + radius >= this.frame.offsetY + this.frame.height) return false;
    const left = Math.floor((x - radius - this.frame.offsetX) / CELL_SIZE);
    const right = Math.floor((x + radius - this.frame.offsetX) / CELL_SIZE);
    const top = Math.floor((y - radius - this.frame.offsetY) / CELL_SIZE);
    const bottom = Math.floor((y + radius - this.frame.offsetY) / CELL_SIZE);
    for (let gy = top; gy <= bottom; gy++) for (let gx = left; gx <= right; gx++) {
      const flags = this.flagsAt(gx, gy);
      if ((flags & required) !== required || (flags & forbidden) !== 0) return false;
      if (trackFree && this.tracks.has(gx)) return false;
    }
    return true;
  }

  private isLand(x: number, y: number, radius: number): boolean {
    if (!this.footprint(x, y, radius, 0, WATER | ROCK)) return false;
    const gx = Math.floor((x - this.frame.offsetX) / CELL_SIZE), gy = Math.floor((y - this.frame.offsetY) / CELL_SIZE);
    const reach = Math.ceil((TRUNK_RADIUS + radius) / CELL_SIZE);
    for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
      const t = this.trunks.get(trunkKey(gx + dx, gy + dy));
      if (t && Math.hypot(x - t.x, y - t.y) < TRUNK_RADIUS + radius) return false;
    }
    return true;
  }

  private isGrass(x: number, y: number): boolean {
    return this.isLand(x, y, 6) && this.footprint(x, y, 6, 0, DIRT, true);
  }

  isDeepWater(x: number, y: number, radius: number): boolean {
    return this.footprint(x, y, radius, DEEP_WATER, 0);
  }

  contains(animal: WildlifeAnimal, x: number, y: number): boolean {
    if (animal.kind === 'fish') return this.isDeepWater(x, y, animal.appearance.footprint);
    if (isWingedInsect(animal.kind)) return this.isGrass(x, y);
    if (animal.bird) return this.birds.contains(animal, x, y);
    const roamingRadius = Math.min(CANOPY_RADIUS + 8, CANOPY_RADIUS * 1.5 - animal.appearance.footprint);
    return Math.hypot(x - animal.homeX, y - animal.homeY) <= roamingRadius
      && this.isLand(x, y, animal.appearance.footprint);
  }

  /**
   * A brief local disturbance (a displayed shot, an explosion) without a gameplay event queue.
   * The nearest live impulse is remembered per animal, so it also reaches animals outside the view.
   */
  notifyImpulse(kind: WildlifeImpulseKind, x: number, y: number, radius = 0): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const impulse = TUNING.disturbance[kind];
    const blast = (Number.isFinite(radius) ? Math.max(0, radius) : 0) * impulse.blastScale;
    for (const a of this.animals) {
      const reach = TUNING[a.kind].alertRadius * impulse.alertScale + blast;
      const distance = Math.hypot(a.x - x, a.y - y);
      if (distance >= reach) continue;
      const alarm = a.alarm;
      if (alarm.until <= this.time || distance <= Math.hypot(a.x - alarm.x, a.y - alarm.y)) {
        alarm.x = x; alarm.y = y; alarm.reach = reach;
      }
      alarm.until = Math.max(alarm.until, this.time + impulse.seconds);
    }
  }

  update(deltaMs: number, movers: readonly WildlifeMover[], view?: ChunkWorldRect,
    timeOfDayMinutes = DEFAULT_TIME_OF_DAY_MINUTES): void {
    const dt = Math.max(0, Math.min(deltaMs / 1000, .05));
    this.time += dt; this.frameId++;
    this.ingestMovers(movers);
    const minutes = normalizeTimeOfDay(timeOfDayMinutes);
    for (const animal of this.animals) {
      if (animal.bird) { this.birds.update(animal, minutes, dt, view, this.daylightInitialized); continue; }
      // Daylight transitions must also complete outside the camera's simulation window.
      if (isWingedInsect(animal.kind) && !this.updateInsectDaylight(animal, minutes, dt)) continue;
      // Offscreen state is retained without per-animal animation or habitat queries.
      const margin = SIMULATION_MARGIN_PX;
      if (view && (animal.x < view.x - margin || animal.y < view.y - margin
        || animal.x > view.x + view.width + margin || animal.y > view.y + view.height + margin)) continue;
      const tuning = TUNING[animal.kind];
      // Active insects also react to stationary bodies and cannot settle beside them.
      // Ground/water animals retain movement sensitivity.
      const threat = this.resolveThreat(animal, isWingedInsect(animal.kind));
      if (animal.kind === 'fish') this.updateFish(animal, dt, !!threat);
      animal.fleeing = animal.kind === 'fish'
        ? animal.fishPhase === 'fleeing' || (animal.fishPhase === 'diving' && animal.fleeing) : !!threat;
      if (animal.kind === 'butterfly' || animal.kind === 'moth') {
        this.updateWingedRest(animal, dt, !!threat);
        if (animal.resting) { animal.speed = 0; animal.turnSpeed = 0; continue; }
      }
      const desiredSpeed = animal.fleeing ? tuning.fleeSpeed : tuning.speed;
      animal.speed += (desiredSpeed - animal.speed) * Math.min(1, dt * 6);
      const wander = Math.sin(this.time * .63 + animal.phaseOffset) * .8
        + Math.sin(this.time * .27 + animal.phaseOffset * 3) * .45;
      // Aim a short, fixed time ahead; the turn controller integrates dt once.
      let desiredAngle = animal.angle + wander * .25;
      if (threat && animal.fleeing) desiredAngle = Math.atan2(animal.y - this.threatY, animal.x - this.threatX);
      this.move(animal, desiredAngle, dt);
      animal.animation += dt * (isWingedInsect(animal.kind) ? TUNING[animal.kind].animationRate : 5 + animal.speed * .25);
    }
    this.daylightInitialized = true;
  }

  /** Track per-id motion and compact this frame's bodies into the bucket grid; no per-frame allocation. */
  private ingestMovers(movers: readonly WildlifeMover[]): void {
    const tuning = TUNING.disturbance, capacity = tuning.moverCapacity;
    let count = 0, maxRadius = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const m of movers) {
      if (count >= capacity) break;
      if (!Number.isFinite(m.x) || !Number.isFinite(m.y)) continue;
      let motion = this.motions.get(m.id);
      if (motion) {
        if (Math.hypot(m.x - motion.x, m.y - motion.y) > tuning.movingPx) motion.movingUntil = this.time + tuning.movingHoldSeconds;
        motion.x = m.x; motion.y = m.y; motion.seen = this.frameId;
      } else {
        motion = { x: m.x, y: m.y, movingUntil: 0, seen: this.frameId };
        this.motions.set(m.id, motion);
      }
      const radius = m.radius !== undefined && Number.isFinite(m.radius) ? Math.max(0, m.radius) : 0;
      this.moverX[count] = m.x; this.moverY[count] = m.y; this.moverRadius[count] = radius;
      this.moverMoving[count] = motion.movingUntil > this.time ? 1 : 0;
      maxRadius = Math.max(maxRadius, radius);
      minX = Math.min(minX, m.x); minY = Math.min(minY, m.y); maxX = Math.max(maxX, m.x); maxY = Math.max(maxY, m.y);
      count++;
    }
    for (const [id, motion] of this.motions) if (motion.seen !== this.frameId) this.motions.delete(id);
    this.moverMaxRadius = maxRadius;
    if (!count) { this.gridCols = this.gridRows = 0; return; }
    // Cells never fall below the configured size; wide spreads coarsen to stay within the fixed grid.
    const cell = Math.max(tuning.gridCellPx, Math.max(maxX - minX, maxY - minY) / (MOVER_GRID_AXIS - 1));
    this.gridX = minX; this.gridY = minY; this.gridCell = cell;
    this.gridCols = Math.min(MOVER_GRID_AXIS, Math.floor((maxX - minX) / cell) + 1);
    this.gridRows = Math.min(MOVER_GRID_AXIS, Math.floor((maxY - minY) / cell) + 1);
    this.bucketHead.fill(-1, 0, this.gridCols * this.gridRows);
    for (let i = 0; i < count; i++) {
      const col = Math.min(this.gridCols - 1, Math.floor((this.moverX[i] - minX) / cell));
      const row = Math.min(this.gridRows - 1, Math.floor((this.moverY[i] - minY) / cell));
      const bucket = row * this.gridCols + col;
      this.bucketNext[i] = this.bucketHead[bucket]; this.bucketHead[bucket] = i;
    }
  }

  /** Nearest body within `reach` of its edge; writes the threat position into scratch fields. */
  private findMoverThreat(x: number, y: number, reach: number, includeStationary: boolean): boolean {
    if (!this.gridCols) return false;
    const r = reach + this.moverMaxRadius, cell = this.gridCell;
    const left = Math.max(0, Math.floor((x - r - this.gridX) / cell));
    const right = Math.min(this.gridCols - 1, Math.floor((x + r - this.gridX) / cell));
    const top = Math.max(0, Math.floor((y - r - this.gridY) / cell));
    const bottom = Math.min(this.gridRows - 1, Math.floor((y + r - this.gridY) / cell));
    let best = reach, found = false;
    for (let row = top; row <= bottom; row++) for (let col = left; col <= right; col++) {
      for (let i = this.bucketHead[row * this.gridCols + col]; i >= 0; i = this.bucketNext[i]) {
        if (!includeStationary && !this.moverMoving[i]) continue;
        const dx = this.moverX[i] - x, dy = this.moverY[i] - y, limit = best + this.moverRadius[i];
        if (dx > limit || dx < -limit || dy > limit || dy < -limit) continue;
        const d = Math.hypot(dx, dy) - this.moverRadius[i];
        if (d < best) { best = d; found = true; this.threatX = this.moverX[i]; this.threatY = this.moverY[i]; }
      }
    }
    this.threatDistance = best;
    return found;
  }

  /** One rule for every kind: the nearest alarming body or remembered impulse, if any. */
  private resolveThreat(animal: WildlifeAnimal, includeStationary: boolean): boolean {
    return this.resolveThreatAt(animal, animal.x, animal.y, includeStationary);
  }

  /** The same rule evaluated at another point, e.g. a bird's landing spot. */
  private resolveThreatAt(animal: WildlifeAnimal, x: number, y: number, includeStationary: boolean): boolean {
    let threat = this.findMoverThreat(x, y, TUNING[animal.kind].alertRadius, includeStationary);
    const alarm = animal.alarm;
    if (alarm.until > this.time) {
      const d = Math.hypot(x - alarm.x, y - alarm.y);
      if (d < alarm.reach && (!threat || d < this.threatDistance)) {
        threat = true; this.threatX = alarm.x; this.threatY = alarm.y; this.threatDistance = d;
      }
    }
    return threat;
  }

  private updateInsectDaylight(a: WildlifeAnimal, minutes: number, dt: number): boolean {
    const firefly = a.kind === 'firefly';
    const morning = firefly ? TUNING.fireflyDawn : TUNING.insectMorning;
    const evening = firefly ? TUNING.fireflyNight : TUNING.insectEvening;
    const rise = morning[0] + (morning[1] - morning[0]) * a.variation;
    const set = evening[0] + (evening[1] - evening[0]) * a.phaseOffset / TAU;
    const daytime = minutes >= rise && minutes < set;
    const active = a.kind === 'butterfly' ? daytime : !daytime;
    if (!this.daylightInitialized) {
      a.opacity = active ? 1 : 0;
      a.diurnalActive = active;
    }
    if (active !== a.diurnalActive) {
      a.diurnalActive = active;
      a.retireTime = active || firefly ? 0 : TUNING.insectSettleSeconds * (.7 + a.variation * .6);
      a.resting = !active;
      a.fleeing = false;
      if (active) a.calmTime = TUNING.butterflyFlightSeconds * (.7 + a.variation * .6);
    }
    if (!active) {
      a.resting = true; a.speed = 0; a.turnSpeed = 0; a.fleeing = false;
      if (a.retireTime > 0) a.retireTime = Math.max(0, a.retireTime - dt);
      else a.opacity = Math.max(0, a.opacity - dt / TUNING.insectFadeSeconds);
      return false;
    }
    a.opacity = Math.min(1, a.opacity + dt / TUNING.insectFadeSeconds);
    return true;
  }

  private updateWingedRest(a: WildlifeAnimal, dt: number, disturbed: boolean): void {
    if (disturbed) {
      a.resting = false;
      a.calmTime = TUNING.butterflyFlightSeconds * (.7 + a.variation * .6);
      return;
    }
    a.calmTime -= dt;
    if (a.calmTime > 0) return;
    a.resting = !a.resting;
    a.calmTime = (a.resting ? TUNING.butterflyRestSeconds : TUNING.butterflyFlightSeconds) * (.7 + a.variation * .6);
  }

  /** Short probes include the full silhouette, never authoritatively registered colliders. */
  private clearance(a: WildlifeAnimal, angle: number, distance: number): number {
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const steps = Math.max(1, Math.ceil(distance / 4));
    for (let i = 1; i <= steps; i++) {
      const d = distance * i / steps;
      if (!this.contains(a, a.x + dx * d, a.y + dy * d)) return distance * (i - 1) / steps;
    }
    return distance;
  }

  /** Bounded angular velocity and acceleration; never exceeds the kind's turn rate. */
  private turnToward(a: WildlifeAnimal, desiredAngle: number, dt: number): void {
    const turnRate = TUNING[a.kind].turnRate;
    const desiredTurnSpeed = Math.max(-turnRate, Math.min(turnRate, angleDelta(a.angle, desiredAngle) * 4));
    const acceleration = turnRate * 3 * dt;
    a.turnSpeed += Math.max(-acceleration, Math.min(acceleration, desiredTurnSpeed - a.turnSpeed));
    a.angle += a.turnSpeed * dt;
  }

  private move(a: WildlifeAnimal, desiredAngle: number, dt: number): void {
    const turnRate = TUNING[a.kind].turnRate;
    const lookAhead = 8 + a.speed / turnRate * 1.3;
    const forward = this.clearance(a, a.angle, lookAhead);
    if (a.avoidanceAngle !== null && Math.abs(angleDelta(a.angle, a.avoidanceAngle)) < .15 && forward === lookAhead)
      a.avoidanceAngle = null;
    if ((a.avoidanceAngle === null && forward < lookAhead)
      || (a.avoidanceAngle !== null && this.clearance(a, a.avoidanceAngle, lookAhead) < lookAhead * .25)) {
      // Commit to a clear heading while turning; a new random side each frame
      // would cause boundary jitter even with a bounded angular velocity.
      let bestAngle = a.angle, bestScore = -Infinity;
      const preferred = a.avoidanceAngle ?? desiredAngle;
      for (let i = 0; i < 12; i++) {
        const candidate = a.angle + (i - 6) * TAU / 12;
        const score = this.clearance(a, candidate, lookAhead) / lookAhead
          - Math.abs(angleDelta(preferred, candidate)) * .12;
        if (score > bestScore) { bestScore = score; bestAngle = candidate; }
      }
      a.avoidanceAngle = bestAngle;
    }
    this.turnToward(a, a.avoidanceAngle ?? desiredAngle, dt);
    // Brake while turning near a bank/trunk instead of snapping to a free angle.
    const step = a.speed * dt * Math.min(1, .15 + forward / lookAhead);
    const x = a.x + Math.cos(a.angle) * step, y = a.y + Math.sin(a.angle) * step;
    if (this.contains(a, x, y)) { a.x = x; a.y = y; }
  }

  private updateFish(a: WildlifeAnimal, dt: number, disturbed: boolean): void {
    a.phaseTime += dt;
    a.calmTime -= dt;
    a.alertCooldown -= dt;
    const next = (phase: FishPhase): void => { a.fishPhase = phase; a.phaseTime = 0; };
    switch (a.fishPhase) {
      case 'swimming':
        a.opacity = 1;
        if (disturbed && a.alertCooldown <= 0) next('fleeing');
        else if (a.calmTime <= 0) next('diving');
        break;
      case 'fleeing':
        if (a.phaseTime >= TUNING.fishFleeSeconds) next('diving');
        break;
      case 'diving':
        a.opacity = 1 - this.fadeProgress(a.phaseTime, TUNING.fishDiveSeconds);
        if (a.opacity === 0) next('hidden');
        break;
      case 'hidden':
        a.opacity = 0;
        if (a.phaseTime >= TUNING.fishHiddenSeconds + a.variation) next('emerging');
        break;
      case 'emerging':
        a.opacity = this.fadeProgress(a.phaseTime, TUNING.fishEmergeSeconds);
        if (a.opacity === 1) { next('swimming'); a.calmTime = 9 + a.variation * 3; a.alertCooldown = 1.5; }
        break;
    }
  }

  private fadeProgress(elapsed: number, duration: number): number {
    const t = Math.min(1, elapsed / duration);
    return t * t * (3 - 2 * t);
  }

  destroy(): void { this.animals.length = 0; this.motions.clear(); this.gridCols = this.gridRows = 0; }
}
