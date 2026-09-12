import { CANOPY_RADIUS, CELL_SIZE, TRUNK_RADIUS } from '../config';
import type { ArenaLayout } from '../types';
import type { ChunkWorldFrame, ChunkWorldRect } from './chunks/ArenaChunkGrid';
import { hashSeededCell01 } from './CellHash';
import { AMBIENT_WILDLIFE as TUNING } from './AmbientWildlifeConfig';
import { createWildlifeAppearance, type WildlifeAppearance, type WildlifeKind } from './AmbientWildlifeAppearance';

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
  speed: number;
  animation: number;
  opacity: number;
  fishPhase: FishPhase;
  phaseTime: number;
  calmTime: number;
  alertCooldown: number;
  fleeing: boolean;
}
interface PlayerMotion { x: number; y: number; movingUntil: number; seen: number }
const TAU = Math.PI * 2;
const key = (x: number, y: number): string => `${x},${y}`;

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
      const variation = random(x, y, 803), phaseOffset = random(x, y, 809) * TAU;
      const animal: WildlifeAnimal = { kind, x, y, homeX, homeY, variation, phaseOffset, appearance,
        angle: phaseOffset, speed: TUNING[kind].speed, animation: phaseOffset, opacity: 1,
        fishPhase: 'swimming', phaseTime: 0, calmTime: 3 + variation * 9, alertCooldown: 0, fleeing: false };
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
    const treeStride = Math.max(1, Math.ceil(this.trees.length / TUNING.snake.maxCount));
    for (let i = 0; i < this.trees.length; i += treeStride) {
      const tree = this.trees[i];
      const appearance = appearanceAt('snake', tree.x, tree.y);
      for (let attempt = 0; attempt < 16; attempt++) {
        const angle = random(i, attempt, 861) * TAU;
        const radius = CANOPY_RADIUS * (.76 + random(i, attempt, 862) * .27);
        const x = tree.x + Math.cos(angle) * radius, y = tree.y + Math.sin(angle) * radius;
        if (!this.isLand(x, y, appearance.footprint)) continue;
        add('snake', x, y, tree.x, tree.y, appearance); break;
      }
    }
    const schoolHomes: { x: number; y: number }[] = [];
    const deepCells = [...this.deepWater].map(cell => cell.split(',').map(Number));
    deepCells.sort((a, b) => random(a[0], a[1], 880) - random(b[0], b[1], 880));
    for (const [gx, gy] of deepCells) {
      if (schoolHomes.length >= TUNING.fish.maxCount) break;
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
    if (animal.kind === 'butterfly') return this.isGrass(x, y);
    const roamingRadius = Math.min(CANOPY_RADIUS + 8, CANOPY_RADIUS * 1.5 - animal.appearance.footprint);
    return Math.hypot(x - animal.homeX, y - animal.homeY) <= roamingRadius
      && this.isLand(x, y, animal.appearance.footprint);
  }

  update(deltaMs: number, players: readonly WildlifePlayer[], view?: ChunkWorldRect): void {
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
    for (const animal of this.animals) {
      // Offscreen state is retained without per-animal animation or habitat queries.
      if (view && (animal.x < view.x - 192 || animal.y < view.y - 192
        || animal.x > view.x + view.width + 192 || animal.y > view.y + view.height + 192)) continue;
      const tuning = TUNING[animal.kind];
      let threat: PlayerMotion | undefined, distance = tuning.alertRadius as number;
      for (const p of this.players.values()) {
        if (p.movingUntil <= this.time) continue;
        const d = Math.hypot(animal.x - p.x, animal.y - p.y);
        if (d < distance) { distance = d; threat = p; }
      }
      if (animal.kind === 'fish') this.updateFish(animal, dt, !!threat);
      animal.fleeing = animal.kind === 'fish'
        ? animal.fishPhase === 'fleeing' || (animal.fishPhase === 'diving' && animal.fleeing) : !!threat;
      const desiredSpeed = animal.fleeing ? tuning.fleeSpeed : tuning.speed;
      animal.speed += (desiredSpeed - animal.speed) * Math.min(1, dt * 6);
      const wander = Math.sin(this.time * .63 + animal.phaseOffset) * .8
        + Math.sin(this.time * .27 + animal.phaseOffset * 3) * .45;
      let desiredAngle = animal.angle + wander * dt;
      if (threat && animal.fleeing) desiredAngle = Math.atan2(animal.y - threat.y, animal.x - threat.x);
      const turn = Math.atan2(Math.sin(desiredAngle - animal.angle), Math.cos(desiredAngle - animal.angle));
      animal.angle += Math.max(-tuning.turnRate * dt, Math.min(tuning.turnRate * dt, turn));
      const step = animal.speed * dt;
      // Constrained steering checks the complete visual footprint. No collider or
      // pathfinding request is registered with the authoritative world.
      for (const offset of [0, .5, -.5, 1, -1, 1.8, -1.8, Math.PI]) {
        const angle = animal.angle + offset;
        const x = animal.x + Math.cos(angle) * step, y = animal.y + Math.sin(angle) * step;
        if (!this.contains(animal, x, y)) continue;
        animal.x = x; animal.y = y; animal.angle = angle; break;
      }
      animal.animation += dt * (animal.kind === 'butterfly' ? TUNING.butterfly.animationRate : 5 + animal.speed * .25);
    }
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
