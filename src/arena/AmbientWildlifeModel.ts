import { CANOPY_RADIUS, CELL_SIZE, TRUNK_RADIUS } from '../config';
import type { ArenaLayout } from '../types';
import type { ChunkWorldFrame, ChunkWorldRect } from './chunks/ArenaChunkGrid';
import { hashSeededCell01 } from './CellHash';
import { AMBIENT_WILDLIFE as TUNING } from './AmbientWildlifeConfig';
import { createWildlifeAppearance, isWingedInsect, type WildlifeAppearance, type WildlifeKind } from './AmbientWildlifeAppearance';
import { DEFAULT_TIME_OF_DAY_MINUTES, normalizeTimeOfDay } from '../effects/TimeOfDay';

export type { WildlifeKind } from './AmbientWildlifeAppearance';
export type FishPhase = 'swimming' | 'fleeing' | 'diving' | 'hidden' | 'emerging';
export interface WildlifePlayer { readonly id: string; readonly x: number; readonly y: number }
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
  readonly shot: { x: number; y: number; until: number };
}
interface PlayerMotion { x: number; y: number; movingUntil: number; seen: number }
const TAU = Math.PI * 2;
const key = (x: number, y: number): string => `${x},${y}`;
const angleDelta = (from: number, to: number): number => Math.atan2(Math.sin(to - from), Math.cos(to - from));

/** Local presentation state only. Owns no entities, physics, timers, global RNG or wire state. */
export class AmbientWildlifeModel {
  readonly animals: WildlifeAnimal[] = [];
  private readonly water = new Set<string>();
  private readonly deepWater = new Set<string>();
  private readonly rocks = new Set<string>();
  private readonly dirt = new Set<string>();
  private readonly tracks = new Set<number>();
  private readonly trees: { x: number; y: number }[];
  private readonly trunks = new Map<string, { x: number; y: number }>();
  private readonly players = new Map<string, PlayerMotion>();
  private time = 0;
  private frameId = 0;
  private daylightInitialized = false;

  constructor(layout: ArenaLayout, private readonly frame: ChunkWorldFrame) {
    for (const c of layout.water ?? []) this.water.add(key(c.gridX, c.gridY));
    for (const c of layout.rocks) this.rocks.add(key(c.gridX, c.gridY));
    for (const c of layout.dirt) this.dirt.add(key(c.gridX, c.gridY));
    for (const c of layout.tracks) this.tracks.add(c.gridX);
    this.trees = layout.trees.map(c => ({
      x: frame.offsetX + (c.gridX + .5) * CELL_SIZE, y: frame.offsetY + (c.gridY + .5) * CELL_SIZE,
    }));
    layout.trees.forEach((c, i) => this.trunks.set(key(c.gridX, c.gridY), this.trees[i]));
    // Erode the water topology by a full cell. A school's complete footprint must
    // fit this interior, so individual fish cannot reach the shallow bank or land.
    for (const c of layout.water ?? []) {
      let interior = true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
        if (!this.water.has(key(c.gridX + dx, c.gridY + dy))) interior = false;
      if (interior) this.deepWater.add(key(c.gridX, c.gridY));
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
      const animal: WildlifeAnimal = { kind, x, y, homeX, homeY, variation, phaseOffset, appearance,
        angle: phaseOffset, turnSpeed: 0, avoidanceAngle: null, speed: resting ? 0 : TUNING[kind].speed, animation: phaseOffset, opacity: 1,
        fishPhase: 'swimming', phaseTime: 0, calmTime, alertCooldown: 0, fleeing: false,
        resting, diurnalActive: kind !== 'moth' && kind !== 'firefly', retireTime: 0,
        shot: { x: 0, y: 0, until: 0 } };
      if (!animal.diurnalActive) animal.opacity = 0;
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
    const deepCells = [...this.deepWater].map(cell => cell.split(',').map(Number));
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
  }

  private footprint(x: number, y: number, radius: number, test: (cell: string, gx: number) => boolean): boolean {
    if (x - radius < this.frame.offsetX || y - radius < this.frame.offsetY
      || x + radius >= this.frame.offsetX + this.frame.width || y + radius >= this.frame.offsetY + this.frame.height) return false;
    const left = Math.floor((x - radius - this.frame.offsetX) / CELL_SIZE);
    const right = Math.floor((x + radius - this.frame.offsetX) / CELL_SIZE);
    const top = Math.floor((y - radius - this.frame.offsetY) / CELL_SIZE);
    const bottom = Math.floor((y + radius - this.frame.offsetY) / CELL_SIZE);
    for (let gy = top; gy <= bottom; gy++) for (let gx = left; gx <= right; gx++)
      if (!test(key(gx, gy), gx)) return false;
    return true;
  }

  private isLand(x: number, y: number, radius: number): boolean {
    if (!this.footprint(x, y, radius, cell => !this.water.has(cell) && !this.rocks.has(cell))) return false;
    const gx = Math.floor((x - this.frame.offsetX) / CELL_SIZE), gy = Math.floor((y - this.frame.offsetY) / CELL_SIZE);
    const reach = Math.ceil((TRUNK_RADIUS + radius) / CELL_SIZE);
    for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
      const t = this.trunks.get(key(gx + dx, gy + dy));
      if (t && Math.hypot(x - t.x, y - t.y) < TRUNK_RADIUS + radius) return false;
    }
    return true;
  }

  private isGrass(x: number, y: number): boolean {
    return this.isLand(x, y, 6) && this.footprint(x, y, 6, (cell, gx) => !this.dirt.has(cell) && !this.tracks.has(gx));
  }

  isDeepWater(x: number, y: number, radius: number): boolean {
    return this.footprint(x, y, radius, cell => this.deepWater.has(cell));
  }

  contains(animal: WildlifeAnimal, x: number, y: number): boolean {
    if (animal.kind === 'fish') return this.isDeepWater(x, y, animal.appearance.footprint);
    if (isWingedInsect(animal.kind)) return this.isGrass(x, y);
    const roamingRadius = Math.min(CANOPY_RADIUS + 8, CANOPY_RADIUS * 1.5 - animal.appearance.footprint);
    return Math.hypot(x - animal.homeX, y - animal.homeY) <= roamingRadius
      && this.isLand(x, y, animal.appearance.footprint);
  }

  /** A brief local disturbance at the displayed shooter's position, without a gameplay event queue. */
  notifyShot(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    for (const a of this.animals) {
      const distance = Math.hypot(a.x - x, a.y - y);
      if (distance >= TUNING[a.kind].alertRadius * TUNING.shotRadiusScale) continue;
      if (a.shot.until <= this.time || distance <= Math.hypot(a.x - a.shot.x, a.y - a.shot.y)) {
        a.shot.x = x; a.shot.y = y;
      }
      a.shot.until = this.time + TUNING.shotAlertSeconds;
    }
  }

  update(deltaMs: number, players: readonly WildlifePlayer[], view?: ChunkWorldRect,
    timeOfDayMinutes = DEFAULT_TIME_OF_DAY_MINUTES): void {
    const dt = Math.max(0, Math.min(deltaMs / 1000, .05));
    this.time += dt; this.frameId++;
    for (const p of players) {
      const previous = this.players.get(p.id);
      if (previous) {
        if (Math.hypot(p.x - previous.x, p.y - previous.y) > .08) previous.movingUntil = this.time + .2;
        previous.x = p.x; previous.y = p.y; previous.seen = this.frameId;
      } else this.players.set(p.id, { x: p.x, y: p.y, movingUntil: 0, seen: this.frameId });
    }
    for (const [id, p] of this.players) if (p.seen !== this.frameId) this.players.delete(id);
    const minutes = normalizeTimeOfDay(timeOfDayMinutes);
    for (const animal of this.animals) {
      // Daylight transitions must also complete outside the camera's simulation window.
      if (isWingedInsect(animal.kind) && !this.updateInsectDaylight(animal, minutes, dt)) continue;
      // Offscreen state is retained without per-animal animation or habitat queries.
      if (view && (animal.x < view.x - 192 || animal.y < view.y - 192
        || animal.x > view.x + view.width + 192 || animal.y > view.y + view.height + 192)) continue;
      const tuning = TUNING[animal.kind];
      let threat: { x: number; y: number } | undefined, distance = tuning.alertRadius as number;
      for (const p of this.players.values()) {
        // Active insects also react to stationary players and cannot settle
        // beside them. Ground/water animals retain movement sensitivity.
        if (!isWingedInsect(animal.kind) && p.movingUntil <= this.time) continue;
        const d = Math.hypot(animal.x - p.x, animal.y - p.y);
        if (d < distance) { distance = d; threat = p; }
      }
      if (animal.shot.until > this.time) {
        const d = Math.hypot(animal.x - animal.shot.x, animal.y - animal.shot.y);
        if (d < tuning.alertRadius * TUNING.shotRadiusScale && (!threat || d < distance)) threat = animal.shot;
      }
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
      if (threat && animal.fleeing) desiredAngle = Math.atan2(animal.y - threat.y, animal.x - threat.x);
      this.move(animal, desiredAngle, dt);
      animal.animation += dt * (isWingedInsect(animal.kind) ? TUNING[animal.kind].animationRate : 5 + animal.speed * .25);
    }
    this.daylightInitialized = true;
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
    const turn = angleDelta(a.angle, a.avoidanceAngle ?? desiredAngle);
    const desiredTurnSpeed = Math.max(-turnRate, Math.min(turnRate, turn * 4));
    const acceleration = turnRate * 3 * dt;
    a.turnSpeed += Math.max(-acceleration, Math.min(acceleration, desiredTurnSpeed - a.turnSpeed));
    a.angle += a.turnSpeed * dt;
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

  destroy(): void { this.animals.length = 0; this.players.clear(); }
}
