import { CELL_SIZE } from '../config';
import type { ChunkWorldFrame, ChunkWorldRect } from './chunks/ArenaChunkGrid';
import { hashSeededCell01 } from './CellHash';
import { AMBIENT_WILDLIFE as TUNING } from './AmbientWildlifeConfig';
import { BIRD_KINDS, createWildlifeAppearance, isCorvid, type BirdKind } from './AmbientWildlifeAppearance';
import type { WildlifeAnimal, WildlifeAnimalInit } from './AmbientWildlifeModel';

/**
 * Bird phases. Grounded: forage, drink, mantle (an owl on its prey). Hidden: inside the roost crown.
 * Everything else is airborne and only bounded by the World frame.
 */
export type BirdPhase = 'hidden' | 'emerge' | 'forage' | 'drink' | 'flight' | 'landing' | 'roost'
  | 'patrol' | 'circle' | 'dive' | 'mantle' | 'climb';

/** One-frame events for presentation (sound); cleared at the start of each bird update. */
export const BIRD_CUE = { TAKEOFF: 1, ALARM: 2, LANDED: 4, DIVE: 8 } as const;

/** Per-bird state. Spots are seeded at construction as (x, y, facing, shore) quadruplets. */
export interface WildlifeBirdState {
  phase: BirdPhase;
  /** Height above ground in world pixels. */
  altitude: number;
  /** 0 = members in their ground formation, 1 = flight formation (staggered per member). */
  lift: number;
  /** 0 = wings folded, 1 = spread. */
  wings: number;
  /** Forced flapping (take-off, climb); cruise flapping is the species' own rhythm. */
  flap: number;
  /** Walking stride phase (corvids). */
  gait: number;
  walking: boolean;
  steps: number;
  stepTime: number;
  targetX: number;
  targetY: number;
  targetHeight: number;
  /** Distance at which the current landing or dive began. */
  landFrom: number;
  /** Index of the current or targeted spot; -1 = the roost or an owl waypoint. */
  spot: number;
  /** Seeded choice counter: every take-off advances the bird's own random sequence. */
  flights: number;
  /** Ground anchor of the formation: the take-off point, then the landing spot. */
  originX: number;
  originY: number;
  /** Spot of that anchor (-1 = none); a shore spot lines the flock up along the water. */
  originSpot: number;
  /** World facing of the ground formation (towards the water at a shore spot). */
  facing: number;
  orbitX: number;
  orbitY: number;
  orbitSign: number;
  orbitTime: number;
  veerTime: number;
  veerX: number;
  veerY: number;
  cues: number;
  readonly spots: Float32Array;
}

/** Habitat and steering primitives the model lends to bird behaviour. */
export interface BirdWorldPort {
  readonly seed: number;
  readonly frame: ChunkWorldFrame;
  /** Open ground: no water, rock, track or tree crown anywhere inside the radius. */
  isGround(x: number, y: number, radius: number): boolean;
  isWaterCell(gx: number, gy: number): boolean;
  isOpenLandCell(gx: number, gy: number): boolean;
  /** Nearest alarming body or remembered impulse around (x, y), written into `out`. */
  findThreat(animal: WildlifeAnimal, x: number, y: number, includeStationary: boolean, out: { x: number; y: number }): boolean;
  /** The shared bounded turn controller; never turns faster than the kind's turn rate. */
  turnToward(animal: WildlifeAnimal, desiredAngle: number, dt: number): void;
  /** The shared ground locomotion with habitat probes. */
  walk(animal: WildlifeAnimal, desiredAngle: number, dt: number): void;
}

type GroundBirdKind = Exclude<BirdKind, 'owl'>;
const TAU = Math.PI * 2;
const angleDelta = (from: number, to: number): number => Math.atan2(Math.sin(to - from), Math.cos(to - from));
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const smooth = (t: number): number => { const c = clamp(t, 0, 1); return c * c * (3 - 2 * c); };
const lerp = (range: readonly [number, number], t: number): number => range[0] + (range[1] - range[0]) * t;

/** Level flight stays clear of the crown band: under the crowns or over them, never half inside. */
function levelHeight(height: number): number {
  const [c0, , c2] = TUNING.birdFlight.crownBand;
  if (height <= c0 - 4 || height >= c2 + 4) return height;
  return height < (c0 + c2) / 2 ? c0 - 4 : c2 + 4;
}

export function isGroundedBird(bird: WildlifeBirdState): boolean {
  return bird.phase === 'forage' || bird.phase === 'drink' || bird.phase === 'mantle';
}

/** Behaviour of every bird kind; local presentation state only, seeded and allocation-free per frame. */
export class AmbientWildlifeBirds {
  private readonly threat = { x: 0, y: 0 };

  constructor(private readonly port: BirdWorldPort) {}

  private rand(x: number, y: number, salt: number): number { return hashSeededCell01(this.port.seed, x, y, salt); }

  /** Groups are homed in seeded trees, independent of authored order. Kinds with habitat appear at least once. */
  spawn(trees: readonly { x: number; y: number }[],
    add: (init: WildlifeAnimalInit, bird: WildlifeBirdState) => WildlifeAnimal): void {
    BIRD_KINDS.forEach((kind, k) => {
      const salt = 3000 + k * 200, tuning = TUNING[kind];
      const order = trees.slice().sort((a, b) => this.rand(a.x, a.y, salt) - this.rand(b.x, b.y, salt));
      let groups = 0;
      for (const tree of order) {
        if (groups >= tuning.maxCount) break;
        if (this.rand(tree.x, tree.y, salt + 1) >= tuning.occupancy) continue;
        if (this.spawnAt(kind, tree, salt, add)) groups++;
      }
      if (!groups) for (const tree of order.slice(0, 8)) if (this.spawnAt(kind, tree, salt, add)) break;
    });
  }

  private spawnAt(kind: BirdKind, tree: { x: number; y: number }, salt: number,
    add: (init: WildlifeAnimalInit, bird: WildlifeBirdState) => WildlifeAnimal): boolean {
    const appearance = createWildlifeAppearance(kind, this.rand(tree.x, tree.y, salt + 2), this.rand(tree.x, tree.y, salt + 3), 0);
    const spots = kind === 'owl' ? new Float32Array(0) : this.buildSpots(kind, tree, appearance.footprint, salt);
    if (kind !== 'owl' && spots.length < 8) return false;
    const bird: WildlifeBirdState = { phase: 'hidden', altitude: 0, lift: 0, wings: 0, flap: 0, gait: 0,
      walking: false, steps: 0, stepTime: 0, targetX: tree.x, targetY: tree.y, targetHeight: 0, landFrom: 1,
      spot: -1, flights: 0, originX: tree.x, originY: tree.y, originSpot: -1, facing: 0, orbitX: 0, orbitY: 0, orbitSign: 1,
      orbitTime: 0, veerTime: 0, veerX: 0, veerY: 0, cues: 0, spots };
    // Every bird starts inside its roost; the first update settles it for the current time of day.
    add({ kind, x: tree.x, y: tree.y, variation: this.rand(tree.x, tree.y, salt + 4),
      phaseOffset: this.rand(tree.x, tree.y, salt + 5) * TAU, appearance, resting: true, diurnalActive: false }, bird);
    return true;
  }

  private buildSpots(kind: GroundBirdKind, tree: { x: number; y: number }, footprint: number, salt: number): Float32Array {
    const tuning = TUNING[kind], out: number[] = [], radius = footprint + 4;
    for (let attempt = 0; out.length < tuning.spotCount * 4 && attempt < tuning.spotCount * 8; attempt++) {
      const angle = this.rand(tree.x, tree.y, salt + 20 + attempt * 2) * TAU;
      const distance = lerp(tuning.spotRange, this.rand(tree.x, tree.y, salt + 21 + attempt * 2)) * CELL_SIZE;
      const x = tree.x + Math.cos(angle) * distance, y = tree.y + Math.sin(angle) * distance;
      if (!this.port.isGround(x, y, radius) || this.nearSpot(out, x, y, 2 * CELL_SIZE)) continue;
      out.push(x, y, this.rand(tree.x, tree.y, salt + 120 + attempt) * TAU, 0);
    }
    if (kind === 'sparrow') this.addShoreSpots(tree, salt, out);
    return Float32Array.from(out);
  }

  /** Drinking spots stand on straight banks, just short of the drawn water edge and facing it. */
  private addShoreSpots(tree: { x: number; y: number }, salt: number, out: number[]): void {
    const shore = TUNING.sparrowShore, frame = this.port.frame;
    const cx = Math.floor((tree.x - frame.offsetX) / CELL_SIZE), cy = Math.floor((tree.y - frame.offsetY) / CELL_SIZE);
    const candidates: number[][] = [];
    for (let gy = cy - shore.range; gy <= cy + shore.range; gy++) for (let gx = cx - shore.range; gx <= cx + shore.range; gx++) {
      if (!this.port.isOpenLandCell(gx, gy)) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!this.port.isWaterCell(gx + dx, gy + dy)) continue;
        const px = -dy, py = dx;
        if (!this.port.isOpenLandCell(gx + px, gy + py) || !this.port.isOpenLandCell(gx - px, gy - py)
          || !this.port.isWaterCell(gx + px + dx, gy + py + dy) || !this.port.isWaterCell(gx - px + dx, gy - py + dy)) continue;
        candidates.push([gx, gy, dx, dy, this.rand(gx, gy, salt + 300 + dx * 3 + dy)]);
      }
    }
    candidates.sort((a, b) => a[4] - b[4]);
    let added = 0;
    for (const [gx, gy, dx, dy] of candidates) {
      if (added >= shore.spots) break;
      const reach = CELL_SIZE / 2 - shore.standOff;
      const x = frame.offsetX + (gx + .5 + dx * reach / CELL_SIZE) * CELL_SIZE;
      const y = frame.offsetY + (gy + .5 + dy * reach / CELL_SIZE) * CELL_SIZE;
      if (!this.port.isGround(x, y, 2) || this.nearSpot(out, x, y, 3 * CELL_SIZE)) continue;
      out.push(x, y, Math.atan2(dy, dx), 1);
      added++;
    }
  }

  private nearSpot(spots: readonly number[], x: number, y: number, gap: number): boolean {
    for (let i = 0; i < spots.length; i += 4) if (Math.hypot(spots[i] - x, spots[i + 1] - y) < gap) return true;
    return false;
  }

  /** Grounded birds keep their whole formation on open ground; airborne birds stay inside the frame. */
  contains(a: WildlifeAnimal, x: number, y: number): boolean {
    const bird = a.bird!;
    switch (bird.phase) {
      case 'forage': {
        if (!this.port.isGround(x, y, a.appearance.footprint)) return false;
        return !isCorvid(a.kind) || Math.hypot(x - bird.originX, y - bird.originY) <= TUNING[a.kind].roamRadius;
      }
      case 'drink': return this.port.isGround(x, y, 2);
      case 'mantle': return this.port.isGround(x, y, a.appearance.footprint);
      default: {
        const f = this.port.frame, inset = TUNING.birdFlight.frameInset;
        return x >= f.offsetX + inset && y >= f.offsetY + inset
          && x <= f.offsetX + f.width - inset && y <= f.offsetY + f.height - inset;
      }
    }
  }

  isActive(a: WildlifeAnimal, minutes: number): boolean {
    const s = TUNING.birdSchedule;
    const dawn = a.kind === 'owl' ? s.owlDawn : a.kind === 'sparrow' ? s.sparrowDawn : s.corvidDawn;
    const dusk = a.kind === 'owl' ? s.owlDusk : a.kind === 'sparrow' ? s.sparrowDusk : s.corvidDusk;
    const day = minutes >= lerp(dawn, a.variation) && minutes < lerp(dusk, a.phaseOffset / TAU);
    return a.kind === 'owl' ? !day : day;
  }

  /**
   * Inactive birds stay exactly still in their roost. Grounded birds outside the simulation window
   * freeze; airborne birds keep flying there (they are few and need no habitat probes).
   */
  update(a: WildlifeAnimal, minutes: number, dt: number, view: ChunkWorldRect | undefined, initialized: boolean): void {
    const bird = a.bird!;
    bird.cues = 0;
    const active = this.isActive(a, minutes);
    if (!initialized) {
      a.diurnalActive = active;
      if (active) this.settle(a);
    } else if (active !== a.diurnalActive) {
      a.diurnalActive = active;
      this.transition(a, active, view);
    }
    if (bird.phase === 'hidden') {
      a.opacity = 0; a.resting = true; a.speed = 0; a.turnSpeed = 0; a.fleeing = false;
      return;
    }
    a.resting = false;
    if (isGroundedBird(bird) && view && !this.inView(view, a.x, a.y, TUNING.disturbance.simulationMarginPx)) return;
    a.phaseTime += dt;
    switch (bird.phase) {
      case 'emerge': this.emerge(a, dt); break;
      case 'forage': case 'drink': this.ground(a, dt); break;
      case 'flight': this.flight(a, dt); break;
      case 'landing': this.landing(a, dt); break;
      case 'roost': this.roost(a, dt); break;
      case 'patrol': this.patrol(a, dt); break;
      case 'circle': this.circle(a, dt); break;
      case 'dive': this.dive(a, dt); break;
      case 'mantle': this.mantle(a, dt); break;
      case 'climb': this.climb(a, dt); break;
    }
    this.ease(a, dt);
  }

  private inView(view: ChunkWorldRect, x: number, y: number, margin: number): boolean {
    return x >= view.x - margin && y >= view.y - margin && x <= view.x + view.width + margin && y <= view.y + view.height + margin;
  }

  /** Steady state for the current time of day: on the first spot, or an owl already on patrol. */
  private settle(a: WildlifeAnimal): void {
    const bird = a.bird!;
    if (a.kind !== 'owl') { this.groundAt(a, 0); return; }
    const t = TUNING.owl;
    this.waypoint(a);
    a.x = bird.targetX; a.y = bird.targetY;
    bird.flights++;
    this.waypoint(a);
    bird.altitude = bird.targetHeight = t.cruiseHeight;
    bird.lift = bird.wings = 1;
    a.speed = t.cruiseSpeed; a.opacity = 1;
    this.startPatrol(a);
  }

  private transition(a: WildlifeAnimal, active: boolean, view: ChunkWorldRect | undefined): void {
    const bird = a.bird!, margin = TUNING.disturbance.simulationMarginPx;
    if (active) {
      if (bird.phase !== 'hidden') return;
      const spotVisible = a.kind !== 'owl' && view !== undefined && this.inView(view, bird.spots[0], bird.spots[1], margin);
      if (view && !this.inView(view, a.homeX, a.homeY, margin) && !spotVisible) { this.settle(a); return; }
      a.x = a.homeX; a.y = a.homeY; a.opacity = 0; a.phaseTime = 0;
      bird.phase = 'emerge'; bird.altitude = TUNING.birdFlight.emergeHeight; bird.lift = bird.wings = 1;
      return;
    }
    if (bird.phase === 'hidden') return;
    if (view && !this.inView(view, a.x, a.y, margin) && !this.inView(view, a.homeX, a.homeY, margin)) { this.hide(a); return; }
    if (bird.phase !== 'roost') this.flyTo(a, a.homeX, a.homeY, -1, false);
  }

  private hide(a: WildlifeAnimal): void {
    const bird = a.bird!;
    a.x = a.homeX; a.y = a.homeY; a.opacity = 0; a.speed = 0; a.turnSpeed = 0; a.fleeing = false; a.resting = true;
    bird.phase = 'hidden'; bird.altitude = bird.lift = bird.wings = bird.flap = 0; bird.spot = -1;
  }

  private groundAt(a: WildlifeAnimal, spot: number): void {
    const bird = a.bird!, s = bird.spots, i = spot * 4;
    a.x = s[i]; a.y = s[i + 1];
    bird.spot = spot; bird.facing = s[i + 2]; bird.originX = a.x; bird.originY = a.y; bird.originSpot = spot;
    bird.phase = s[i + 3] ? 'drink' : 'forage';
    bird.altitude = bird.lift = bird.wings = bird.flap = 0; bird.walking = false; bird.stepTime = 0;
    a.calmTime = this.calmSeconds(a);
    a.speed = 0; a.turnSpeed = 0; a.fleeing = false; a.opacity = 1; a.phaseTime = 0;
  }

  private calmSeconds(a: WildlifeAnimal): number {
    const bird = a.bird!, roll = this.rand(a.homeX, a.homeY, 3800 + bird.flights);
    if (bird.phase === 'drink') return lerp(TUNING.sparrowShore.drinkSeconds, roll);
    return lerp(TUNING[a.kind as GroundBirdKind].calmSeconds, roll);
  }

  /** Start a flight. From the ground this is a take-off: the formation anchor stays where the birds stood. */
  private flyTo(a: WildlifeAnimal, x: number, y: number, spot: number, alarmed: boolean): void {
    const bird = a.bird!, t = TUNING[a.kind as BirdKind];
    if (isGroundedBird(bird)) {
      bird.originX = a.x; bird.originY = a.y;
      bird.cues |= BIRD_CUE.TAKEOFF | (alarmed ? BIRD_CUE.ALARM : 0);
    }
    bird.targetX = x; bird.targetY = y; bird.spot = spot; bird.flights++;
    bird.phase = 'flight'; a.phaseTime = 0; a.fleeing = alarmed;
    bird.targetHeight = levelHeight(spot < 0 ? t.cruiseHeight : clamp(Math.hypot(x - a.x, y - a.y) * .25, 24, t.cruiseHeight));
  }

  private flyToSpot(a: WildlifeAnimal, alarmed: boolean): void {
    const spot = this.chooseSpot(a, alarmed), s = a.bird!.spots;
    this.flyTo(a, s[spot * 4], s[spot * 4 + 1], spot, alarmed);
  }

  /** A seeded different spot: within hop range, away from the threat when alarmed, sparrows now and then to the water. */
  private chooseSpot(a: WildlifeAnimal, alarmed: boolean): number {
    const bird = a.bird!, s = bird.spots, n = s.length / 4, kind = a.kind as GroundBirdKind;
    const hop = TUNING[kind].hopRange;
    let wantShore: boolean | undefined;
    if (kind === 'sparrow' && !alarmed) {
      const atShore = bird.spot >= 0 && s[bird.spot * 4 + 3] === 1;
      let hasShore = false;
      for (let i = 3; i < s.length; i += 4) hasShore ||= s[i] === 1;
      wantShore = !atShore && hasShore && this.rand(a.homeX, a.homeY, 3150 + bird.flights) < TUNING.sparrowShore.chance;
    }
    const away = Math.atan2(a.y - this.threat.y, a.x - this.threat.x);
    for (let k = 0; k < 16; k++) {
      const i = Math.min(n - 1, Math.floor(this.rand(a.homeX, a.homeY, 3100 + bird.flights * 16 + k) * n));
      if (i === bird.spot || (wantShore !== undefined && (s[i * 4 + 3] === 1) !== wantShore)) continue;
      const dx = s[i * 4] - a.x, dy = s[i * 4 + 1] - a.y, d = Math.hypot(dx, dy);
      if (d < hop[0] * CELL_SIZE || d > hop[1] * CELL_SIZE) continue;
      if (alarmed && Math.abs(angleDelta(Math.atan2(dy, dx), away)) > Math.PI * 110 / 180) continue;
      return i;
    }
    let best = -1, score = -Infinity;
    for (let i = 0; i < n; i++) {
      if (i === bird.spot) continue;
      const fromThreat = Math.hypot(s[i * 4] - this.threat.x, s[i * 4 + 1] - this.threat.y);
      const matches = wantShore === undefined || (s[i * 4 + 3] === 1) === wantShore;
      const value = (alarmed ? fromThreat : -i) + (matches ? 1e6 : 0);
      if (value > score) { score = value; best = i; }
    }
    return best;
  }

  private emerge(a: WildlifeAnimal, dt: number): void {
    const bird = a.bird!;
    a.speed = 0;
    a.opacity = Math.min(1, a.opacity + dt / TUNING.birdFlight.emergeSeconds);
    bird.altitude = TUNING.birdFlight.emergeHeight;
    if (a.opacity < 1) return;
    if (a.kind === 'owl') { bird.flights++; this.waypoint(a); this.startPatrol(a); }
    else this.flyToSpot(a, false);
  }

  private ground(a: WildlifeAnimal, dt: number): void {
    const bird = a.bird!;
    a.alertCooldown -= dt;
    if (a.alertCooldown <= 0 && this.port.findThreat(a, a.x, a.y, false, this.threat)) { this.flyToSpot(a, true); return; }
    a.calmTime -= dt;
    if (a.calmTime <= 0) { this.flyToSpot(a, false); return; }
    if (!isCorvid(a.kind)) { a.speed = 0; a.turnSpeed = 0; return; }
    const t = TUNING[a.kind];
    bird.stepTime -= dt;
    if (bird.stepTime <= 0) {
      bird.walking = !bird.walking; bird.steps++;
      bird.stepTime = lerp(bird.walking ? t.walkSeconds : t.pauseSeconds, this.rand(a.homeX, a.homeY, 3900 + bird.steps));
    }
    a.speed += ((bird.walking ? t.speed : 0) - a.speed) * Math.min(1, dt * 5);
    const wander = Math.sin(a.phaseTime * .7 + a.phaseOffset) * .8 + Math.sin(a.phaseTime * .29 + a.phaseOffset * 3) * .5;
    let desired = a.angle + wander * .3;
    const dx = bird.originX - a.x, dy = bird.originY - a.y;
    if (Math.hypot(dx, dy) > t.roamRadius * .6) desired = Math.atan2(dy, dx);
    this.port.walk(a, desired, dt);
    bird.gait += a.speed * dt / Math.max(1, a.appearance.length * .32);
  }

  private flight(a: WildlifeAnimal, dt: number): void {
    const bird = a.bird!, t = TUNING[a.kind as BirdKind], flight = TUNING.birdFlight;
    const dx = bird.targetX - a.x, dy = bird.targetY - a.y, dist = Math.hypot(dx, dy);
    if (bird.spot >= 0) {
      // A spot that has just been disturbed is given up for another one.
      if (dist < flight.landingRadius * 1.5 && this.port.findThreat(a, bird.targetX, bird.targetY, false, this.threat)) {
        this.flyToSpot(a, true); return;
      }
      if (dist < flight.landingRadius && bird.lift >= .999) {
        bird.phase = 'landing'; a.phaseTime = 0; bird.landFrom = Math.max(1, dist);
        bird.targetHeight = Math.max(bird.altitude, 1);
        bird.originX = bird.targetX; bird.originY = bird.targetY; bird.originSpot = bird.spot;
        bird.facing = bird.spots[bird.spot * 4 + 2];
        return;
      }
    } else if (dist < 12) {
      bird.phase = 'roost'; a.phaseTime = 0;
      return;
    }
    this.steer(a, Math.atan2(dy, dx), a.fleeing ? t.fleeSpeed : t.cruiseSpeed, bird.targetHeight, dt);
  }

  private landing(a: WildlifeAnimal, dt: number): void {
    const bird = a.bird!, t = TUNING[a.kind as BirdKind];
    if (this.port.findThreat(a, bird.targetX, bird.targetY, false, this.threat)) { this.flyToSpot(a, true); return; }
    const dx = bird.targetX - a.x, dy = bird.targetY - a.y, dist = Math.hypot(dx, dy);
    const k = clamp(dist / bird.landFrom, 0, 1);
    bird.lift = smooth(k * 1.5);
    // Approach speed shrinks with distance and the turn rate, so the turning circle always fits the spot.
    const approach = clamp(dist * Math.min(1.8, t.turnRate * .7), 6, t.cruiseSpeed);
    this.steer(a, Math.atan2(dy, dx), approach, bird.targetHeight * Math.pow(k, 1.2), dt, 3);
    const late = a.phaseTime > 6 && dist < 12;
    if ((dist < 2.5 && bird.altitude < 1.5) || late) {
      if (!this.port.isGround(bird.targetX, bird.targetY, bird.spots[bird.spot * 4 + 3] ? 2 : a.appearance.footprint)) {
        this.flyToSpot(a, false); return;
      }
      this.groundAt(a, bird.spot);
      a.alertCooldown = TUNING.birdFlight.alertCooldownSeconds;
      bird.cues |= BIRD_CUE.LANDED;
    }
  }

  private roost(a: WildlifeAnimal, dt: number): void {
    const bird = a.bird!;
    // Sink into the own crown while fading; the crown hides the bird from above.
    this.steer(a, Math.atan2(a.homeY - a.y, a.homeX - a.x), Math.min(30, Math.hypot(a.homeX - a.x, a.homeY - a.y) * 2),
      TUNING.birdFlight.emergeHeight - 12, dt, 1.6);
    a.opacity = Math.max(0, a.opacity - dt / TUNING.birdFlight.emergeSeconds);
    if (a.opacity > 0) return;
    if (!a.diurnalActive) { this.hide(a); return; }
    bird.phase = 'emerge'; a.phaseTime = 0;
  }

  /** Owl waypoints: seeded polar offsets inside the territory around the roost, clamped into the frame. */
  private waypoint(a: WildlifeAnimal): void {
    const bird = a.bird!, t = TUNING.owl, f = this.port.frame, n = bird.flights;
    const angle = this.rand(a.homeX, a.homeY, 3500 + n * 3) * TAU;
    // Waypoints lie far apart: an owl crosses the map instead of lingering over one place.
    const radius = t.territory * CELL_SIZE * (.5 + .5 * Math.sqrt(this.rand(a.homeX, a.homeY, 3501 + n * 3)));
    bird.targetX = clamp(a.homeX + Math.cos(angle) * radius, f.offsetX + 96, f.offsetX + f.width - 96);
    bird.targetY = clamp(a.homeY + Math.sin(angle) * radius, f.offsetY + 96, f.offsetY + f.height - 96);
  }

  private startPatrol(a: WildlifeAnimal): void {
    const bird = a.bird!;
    bird.phase = 'patrol'; a.phaseTime = 0; bird.spot = -1;
    bird.targetHeight = TUNING.owl.cruiseHeight;
  }

  /** Patrol and circling owls veer away from a threat below them for a moment. */
  private veer(a: WildlifeAnimal, dt: number): boolean {
    const bird = a.bird!;
    if (bird.veerTime > 0) {
      bird.veerTime -= dt;
      a.fleeing = bird.veerTime > 0;
      return a.fleeing;
    }
    if (!this.port.findThreat(a, a.x, a.y, false, this.threat)) { a.fleeing = false; return false; }
    bird.veerTime = TUNING.owl.veerSeconds; bird.veerX = this.threat.x; bird.veerY = this.threat.y;
    bird.cues |= BIRD_CUE.ALARM; a.fleeing = true;
    return true;
  }

  private patrol(a: WildlifeAnimal, dt: number): void {
    const bird = a.bird!, t = TUNING.owl;
    const veering = this.veer(a, dt);
    const dx = bird.targetX - a.x, dy = bird.targetY - a.y;
    const desired = veering ? Math.atan2(a.y - bird.veerY, a.x - bird.veerX) : Math.atan2(dy, dx);
    this.steer(a, desired, veering ? t.fleeSpeed : t.cruiseSpeed, t.cruiseHeight, dt);
    if (veering || Math.hypot(dx, dy) >= 48) return;
    const roll = this.rand(a.homeX, a.homeY, 3600 + bird.flights);
    bird.flights++;
    if (roll < t.circleChance) {
      const radius = this.orbitRadius();
      bird.phase = 'circle'; a.phaseTime = 0;
      bird.orbitX = bird.targetX; bird.orbitY = bird.targetY;
      bird.orbitSign = this.rand(a.homeX, a.homeY, 3601 + bird.flights) < .5 ? -1 : 1;
      bird.orbitTime = (.5 + .4 * this.rand(a.homeX, a.homeY, 3602 + bird.flights)) * TAU * radius / t.cruiseSpeed;
    } else if (roll < t.circleChance + t.diveChance && this.startDive(a)) {
      bird.cues |= BIRD_CUE.DIVE;
    } else this.waypoint(a);
  }

  private orbitRadius(): number { return Math.max(1.25 * TUNING.owl.cruiseSpeed / TUNING.owl.turnRate, 70); }

  private circle(a: WildlifeAnimal, dt: number): void {
    const bird = a.bird!, t = TUNING.owl;
    if (this.veer(a, dt)) { this.waypoint(a); this.startPatrol(a); return; }
    const dx = a.x - bird.orbitX, dy = a.y - bird.orbitY, rc = this.orbitRadius();
    const desired = Math.atan2(dy, dx) + bird.orbitSign * (Math.PI / 2 + .8 * clamp((Math.hypot(dx, dy) - rc) / rc, -1, 1));
    this.steer(a, desired, t.cruiseSpeed, t.cruiseHeight, dt);
    bird.orbitTime -= dt;
    if (bird.orbitTime <= 0) { this.waypoint(a); this.startPatrol(a); }
  }

  /** A hunting dive needs open ground ahead, well clear of crowns, water and rock; a few seeded points are tried. */
  private startDive(a: WildlifeAnimal): boolean {
    const bird = a.bird!, clearance = Math.max(40, a.appearance.footprint * 1.6);
    for (let k = 0; k < 6; k++) {
      const angle = a.angle + (this.rand(a.homeX, a.homeY, 3620 + bird.flights * 8 + k) - .5) * 1.6;
      const distance = 40 + this.rand(a.homeX, a.homeY, 3621 + bird.flights * 8 + k) * 50;
      const x = a.x + Math.cos(angle) * distance, y = a.y + Math.sin(angle) * distance;
      if (!this.port.isGround(x, y, clearance)) continue;
      bird.phase = 'dive'; a.phaseTime = 0;
      bird.targetX = x; bird.targetY = y; bird.targetHeight = 0; bird.landFrom = distance;
      return true;
    }
    return false;
  }

  private dive(a: WildlifeAnimal, dt: number): void {
    const bird = a.bird!, t = TUNING.owl;
    if (this.port.findThreat(a, a.x, a.y, false, this.threat)) { this.startClimb(a, true); return; }
    const dx = bird.targetX - a.x, dy = bird.targetY - a.y, dist = Math.hypot(dx, dy);
    const approach = clamp(dist * Math.min(1.8, t.turnRate * .7), 6, t.cruiseSpeed * .6);
    this.steer(a, Math.atan2(dy, dx), approach, 0, dt, 3);
    if (dist < 4 && bird.altitude < 1) {
      if (!this.port.isGround(a.x, a.y, a.appearance.footprint)) { this.startClimb(a, false); return; }
      bird.phase = 'mantle'; a.phaseTime = 0; bird.altitude = 0; a.speed = 0; a.turnSpeed = 0;
      a.calmTime = lerp(t.mantleSeconds, this.rand(a.homeX, a.homeY, 3700 + bird.flights));
    } else if (a.phaseTime > 4) this.startClimb(a, false);
  }

  private mantle(a: WildlifeAnimal, dt: number): void {
    a.speed = 0; a.turnSpeed = 0;
    if (this.port.findThreat(a, a.x, a.y, false, this.threat)) { this.startClimb(a, true); return; }
    a.calmTime -= dt;
    if (a.calmTime <= 0) this.startClimb(a, false);
  }

  private startClimb(a: WildlifeAnimal, alarmed: boolean): void {
    const bird = a.bird!;
    bird.phase = 'climb'; a.phaseTime = 0; a.fleeing = alarmed; bird.flights++;
    if (alarmed) bird.cues |= BIRD_CUE.ALARM;
    this.waypoint(a);
    bird.targetHeight = TUNING.owl.cruiseHeight;
  }

  private climb(a: WildlifeAnimal, dt: number): void {
    const bird = a.bird!, t = TUNING.owl;
    this.steer(a, Math.atan2(bird.targetY - a.y, bird.targetX - a.x), a.fleeing ? t.fleeSpeed : t.cruiseSpeed,
      t.cruiseHeight, dt);
    if (a.phaseTime >= t.climbSeconds && bird.altitude > t.cruiseHeight * .8) { a.fleeing = false; this.startPatrol(a); }
  }

  /** Shared flight: bounded turning, speed reduced while facing away from the course, frame clamp. */
  private steer(a: WildlifeAnimal, desired: number, speed: number, height: number, dt: number, descent = 1.4): void {
    const bird = a.bird!, t = TUNING[a.kind as BirdKind], inset = TUNING.birdFlight.frameInset;
    this.port.turnToward(a, desired, dt);
    // Right after take-off a bird springs up and turns on the spot instead of flying at its threat.
    const launch = bird.phase === 'flight' && a.phaseTime < .8 && bird.altitude < 30;
    const target = speed * Math.max(launch ? .04 : .3, Math.cos(angleDelta(a.angle, desired)));
    a.speed += (target - a.speed) * Math.min(1, dt * 2.5);
    const f = this.port.frame;
    a.x = clamp(a.x + Math.cos(a.angle) * a.speed * dt, f.offsetX + inset, f.offsetX + f.width - inset);
    a.y = clamp(a.y + Math.sin(a.angle) * a.speed * dt, f.offsetY + inset, f.offsetY + f.height - inset);
    bird.altitude = Math.max(0, bird.altitude + clamp(height - bird.altitude, -t.climbRate * descent * dt, t.climbRate * dt));
  }

  /** Wing fold/spread, forced flapping, formation lift and the wing-beat phase. */
  private ease(a: WildlifeAnimal, dt: number): void {
    const bird = a.bird!, t = TUNING[a.kind as BirdKind], grounded = isGroundedBird(bird);
    const spread = !grounded || bird.phase === 'mantle' ? 1 : 0;
    bird.wings += clamp(spread - bird.wings, -dt * 5, dt * 5);
    if (bird.phase !== 'landing') bird.lift += clamp((grounded ? 0 : 1) - bird.lift, -dt * 4, dt / TUNING.birdFlight.takeoffSeconds);
    // Small birds beat whenever they climb or flee; ravens and owls only beat their way off the
    // ground and up, then return to their gliding rhythm even on an alarmed flight.
    const soaring = a.kind === 'raven' || a.kind === 'owl';
    const forced = !grounded && (soaring
      ? (bird.phase === 'flight' && a.phaseTime < 1.2) || (bird.phase === 'climb' && a.phaseTime < 1.6)
        || (bird.targetHeight - bird.altitude > 30 && a.phaseTime < 3)
      : bird.targetHeight - bird.altitude > 4 || bird.phase === 'climb' || (bird.phase === 'flight' && a.phaseTime < .8) || a.fleeing);
    bird.flap += clamp((forced ? 1 : 0) - bird.flap, -dt * 2, dt * 6);
    if (!grounded) a.animation += dt * t.flapHz * TAU;
  }
}

/** Altitude above which a bird reads at its largest; draw scale grows up to 22 % on the way. */
const DRAW_SCALE_HEIGHT = 120;
export function birdDrawScale(altitude: number): number {
  return TUNING.visualScale * (1 + .22 * clamp(altitude / DRAW_SCALE_HEIGHT, 0, 1));
}

export interface BirdLayerWeights { ground: number; low: number; high: number }
const smoothRange = (from: number, to: number, x: number): number => smooth((x - from) / (to - from));
/**
 * Ground (under the fog), low (above the fog, lit like the ground, under crowns) and high (above
 * crowns). The upper copy reaches full strength before the lower one fades, so coverage never dips;
 * its slow rise is what lets a climbing bird leave the fog gradually. At most two copies are drawn.
 */
export function writeBirdLayerWeights(altitude: number, out: BirdLayerWeights): BirdLayerWeights {
  const [c0, c1, c2] = TUNING.birdFlight.crownBand, [f0, f1] = TUNING.birdFlight.fogLift;
  const h = Number.isFinite(altitude) ? Math.max(0, altitude) : 0;
  out.ground = 1 - smoothRange(f0, f1, h);
  out.low = smoothRange(0, f0, h) * (1 - smoothRange(c1, c2, h));
  out.high = smoothRange(c0, c1, h);
  return out;
}
