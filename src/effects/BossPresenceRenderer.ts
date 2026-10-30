import type * as Phaser from 'phaser';
import type { CoopDefenseEnemyBossPresenceConfig } from '../config/coopDefenseEnemies';
import type { ProjectileCustomVisual, ProjectileCustomVisualFactory } from '../projectile/ProjectileVisualOverrides';
import { enemyVolleyChargeAt, enemyVolleyPhaseAt, type EnemyVolleyState } from '../systems/EnemyVolleyState';
import { GraveFireflySwarm, type GraveFireflyPose } from './GraveFireflySwarm';
import { GRAVE_FIREFLIES, graveFireflyHole, graveFireflyPose, graveOrbPose, type GraveFireflyAmmoPose, type GraveOrbPose } from './graveTitan/graveLightModel';
import { GraveWispGpuLayer, GraveWispKind } from './gpu/GraveWispGpuLayer';
import type { LightingSystem } from './LightingSystem';

/**
 * Lesbarkeit eines Bosses ohne HUD-Rahmen: normale Ambient-Glühwürmchen umschwärmen ihn.
 * Seine leuchtenden Fußspuren kommen aus der normalen Bewegungs-Pipeline
 * (`MovementEffectsRenderer`, `footprintGlow`). Bei einem Boss mit angekündigter Salve sind genau
 * diese Glühwürmchen seine Munition (`graveLightModel`): Beim Sammeln ziehen sie sich über dem Grab
 * zusammen, glühen auf und verschmelzen je Schuss zu einer Kugel, die zur Größe des Schusses
 * anschwillt und dann abgefeuert wird. Jedes Glühwürmchen folgt seinem Ziel mit eigener Trägheit,
 * statt starr mit dem Boss mitgezogen zu werden. Reine Präsentation replizierter Positionen und
 * Zustände.
 */

export interface BossVolleyPresence {
  readonly state: EnemyVolleyState;
  /** Shots per salvo; the swarm's fireflies feed them in equal groups. */
  readonly count: number;
  /** Weapon source of the salvo's projectiles; they are drawn as flying grave lights. */
  readonly weaponId: string;
  readonly crownX: number;
  readonly crownY: number;
}

export interface BossPresenceSource {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly visible: boolean;
  readonly presence?: CoopDefenseEnemyBossPresenceConfig;
  readonly voidPhase?: number;
  readonly volley?: BossVolleyPresence;
}

interface FireflyOrbit {
  readonly radius: number;
  readonly omega: number;
  readonly phase: number;
  readonly bobAmplitude: number;
  readonly bobFrequency: number;
  readonly bobPhase: number;
}

/** Where one firefly is drawn: it chases its target pose with its own inertia. */
interface FireflyFlight { x: number; y: number; vx: number; vy: number; heading: number; drawn: boolean }

interface BossTrack {
  readonly swarm: GraveFireflySwarm;
  readonly orbits: readonly FireflyOrbit[];
  readonly flights: FireflyFlight[];
  lastNowMs: number;
  seenAt: number;
  x: number;
  y: number;
  volley: BossVolleyPresence | null;
  /** Gather whose launches `seenLaunches` counts (its start time). */
  cycle: number;
  seenLaunches: number;
  /** Target poses of the fireflies and the orbs of the current gather (a shot launches from its orb). */
  readonly ammo: GraveFireflyAmmoPose[];
  readonly orbs: GraveOrbPose[];
  /** First sight: the fireflies rise out of the boss as it appears. */
  readonly bornAt: number;
}

/** A flying salvo shot drawn as a grave light; it starts where its orb was and glides into its path. */
interface GraveLightFlight {
  x: number; y: number; vx: number; vy: number;
  readonly offsetX: number; readonly offsetY: number;
  readonly bornAt: number;
  readonly seed: number;
  readonly key: string;
  live: boolean;
}

interface GraveLightPuff { readonly x: number; readonly y: number; readonly bornAt: number; readonly seed: number }

const FLIGHT_GLIDE_MS = 140;
/** Ground light of a flying shot, as a share of one grave light. */
const FLIGHT_GROUND = 0.6;
/** Haze trail length: seconds of travel, capped in world px. */
const FLIGHT_TRAIL_S = 0.07;
const FLIGHT_TRAIL_MAX = 34;
const PUFF_MS = 380;
/** Ground light of one flying grave light: green and weak. */
const GRAVE_LIGHT_GROUND = 0.4;
const GRAVE_LIGHT_COLOR = 0x7dff8a;
/** Each firefly of a big ammunition swarm lights the ground less: thirty light it like an ordinary twelve. */
const AMMO_SWARM_GROUND_SHARE = 0.4;
/** Charge glow over one firefly: core scale (world px) and peak intensity. */
const CHARGE_GLOW_SIZE = 4.6;
const CHARGE_GLOW_INTENSITY = 1.05;
/** The gathering crown: a soft aura over the orbs and a ground light, both growing with the gather. */
const CROWN_AURA_SIZE = 24;
const CROWN_AURA_INTENSITY = 0.5;
const CROWN_GROUND = 1.8;
/**
 * A firefly chases its target like a spring: free ones lazily (rad/s, varied per firefly), gathered
 * ones much tighter, so they still fuse exactly into their orb.
 */
const FIREFLY_FOLLOW_MIN = 2.6;
const FIREFLY_FOLLOW_SPREAD = 2.2;
const FIREFLY_GATHERED_FOLLOW = 3.5;
/** A newly seen boss's fireflies rise out of it over this time (staggered per firefly). */
const FIREFLIES_APPEAR_MS = 900;
const FIREFLIES_APPEAR_STAGGER_MS = 600;
const PUFF_SIZE = 7;
const MAX_PUFFS = 24;

export class BossPresenceRenderer {
  private readonly tracks = new Map<string, BossTrack>();
  private readonly poses: GraveFireflyPose[] = [];
  private readonly wisps: GraveWispGpuLayer;
  private readonly flights = new Set<GraveLightFlight>();
  private readonly puffs: GraveLightPuff[] = [];
  private readonly salvoWeapons = new Set<string>();
  private readonly litKeys = new Set<string>();
  private readonly frameKeys = new Set<string>();
  private nowMs = 0;
  private flightSerial = 0;
  private destroyed = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly lighting: LightingSystem,
    /** Grave haze drawn in to the crown while a salvo gathers. */
    private readonly haze: { inhale(x: number, y: number, strength: number): void } | null = null,
  ) {
    this.wisps = new GraveWispGpuLayer(scene);
  }

  /** A grave light launches itself and carries its own ground light: no generic muzzle flash or projectile light. */
  readonly ownsSalvoSpawnFx = (weaponSourceId: string): boolean => this.salvoWeapons.has(weaponSourceId);

  /** Registered with the projectile visual overrides: salvo shots of a tracked boss fly as grave lights. */
  readonly plasmaFactory: ProjectileCustomVisualFactory = request => {
    if (this.destroyed || !request.weaponSourceId || !this.salvoWeapons.has(request.weaponSourceId)) return null;
    let track: BossTrack | null = null, best = Infinity;
    for (const candidate of this.tracks.values()) {
      if (candidate.volley?.weaponId !== request.weaponSourceId) continue;
      const distance = Math.hypot(candidate.x - request.x, candidate.y - request.y);
      if (distance < best) { best = distance; track = candidate; }
    }
    let startX = request.x, startY = request.y;
    if (track) {
      // The shot is its orb leaving the crown.
      const orb = track.orbs[track.seenLaunches];
      if (orb && orb.size > 0) { startX = orb.x; startY = orb.y; }
      track.seenLaunches++;
    }
    const flight: GraveLightFlight = { x: request.x, y: request.y, vx: 0, vy: 0, offsetX: startX - request.x, offsetY: startY - request.y,
      bornAt: this.nowMs, seed: (request.id * 0.6180339887) % 1, key: `graveLightFlight:${++this.flightSerial}`, live: true };
    this.flights.add(flight);
    const view: ProjectileCustomVisual = {
      update: (x, y, _size, vx, vy) => { flight.x = x; flight.y = y; flight.vx = vx; flight.vy = vy; },
      destroy: () => {
        if (!flight.live) return;
        flight.live = false;
        this.flights.delete(flight);
        this.releaseLight(flight.key);
        const glide = this.glide(flight);
        if (this.puffs.length < MAX_PUFFS) {
          this.puffs.push({ x: flight.x + flight.offsetX * glide, y: flight.y + flight.offsetY * glide, bornAt: this.nowMs, seed: flight.seed });
        }
      },
    };
    return view;
  };

  sync(sources: readonly BossPresenceSource[], nowMs: number): void {
    if (this.destroyed) return;
    this.nowMs = nowMs;
    this.frameKeys.clear();
    this.wisps.begin(nowMs);
    for (const source of sources) this.syncSource(source, nowMs);
    for (const [id, track] of this.tracks) {
      if (track.seenAt === nowMs) continue;
      track.swarm.destroy();
      this.tracks.delete(id);
    }
    this.drawFlights();
    this.drawPuffs(nowMs);
    this.wisps.flush();
    for (const key of [...this.litKeys]) if (!this.frameKeys.has(key)) this.releaseLight(key);
  }

  clear(): void {
    for (const track of this.tracks.values()) track.swarm.destroy();
    this.tracks.clear();
    for (const flight of this.flights) flight.live = false;
    this.flights.clear();
    this.puffs.length = 0;
    for (const key of [...this.litKeys]) this.releaseLight(key);
    this.wisps.clear();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.clear();
    this.wisps.destroy();
    this.destroyed = true;
  }

  private syncSource(source: BossPresenceSource, nowMs: number): void {
    if (!source.presence) return;
    let track = this.tracks.get(source.id);
    if (!track) {
      const seed = hashId(source.id);
      track = {
        swarm: new GraveFireflySwarm(this.scene, this.lighting, `bossPresence:${source.id}`, source.presence.fireflyCount, seed),
        orbits: createOrbits(source.presence.fireflyCount, source.size, seed),
        flights: [],
        lastNowMs: nowMs,
        seenAt: nowMs,
        x: source.x, y: source.y, volley: null, cycle: Number.NaN, seenLaunches: 0, ammo: [], orbs: [], bornAt: nowMs,
      };
      this.tracks.set(source.id, track);
    }
    const dt = Math.max(0, Math.min(0.1, (nowMs - track.lastNowMs) / 1000));
    track.lastNowMs = nowMs;
    track.seenAt = nowMs;
    track.x = source.x; track.y = source.y;

    const volley = source.volley ?? null;
    track.volley = volley;
    if (volley) {
      this.salvoWeapons.add(volley.weaponId);
      if (volley.state.chargeStartAt !== track.cycle) { track.cycle = volley.state.chargeStartAt; track.seenLaunches = 0; }
    }
    const site = { x: source.x, y: source.y, size: source.size, crownX: volley?.crownX ?? source.x, crownY: volley?.crownY ?? source.y };
    const salt = (hashId(source.id) % 997) / 997;
    const count = track.orbits.length;
    while (track.ammo.length < count) {
      track.ammo.push({ x: 0, y: 0, alpha: 0, glow: 0, gathered: 0 });
      track.flights.push({ x: 0, y: 0, vx: 0, vy: 0, heading: 0, drawn: false });
    }
    this.poses.length = 0;
    const seconds = nowMs / 1000;
    for (let index = 0; index < count; index++) {
      const orbit = track.orbits[index];
      const angle = orbit.phase + seconds * orbit.omega;
      const bob = Math.sin(seconds * orbit.bobFrequency + orbit.bobPhase) * orbit.bobAmplitude;
      const radius = orbit.radius + bob;
      const orbitX = source.x + Math.cos(angle) * radius;
      const orbitY = source.y + Math.sin(angle) * radius * 0.85;
      const pose = track.ammo[index];
      if (volley) graveFireflyPose(index, count, volley.count, site, volley.state, track.seenLaunches, orbitX, orbitY, nowMs, pose);
      else { pose.x = orbitX; pose.y = orbitY; pose.alpha = 1; pose.glow = 0; pose.gathered = 0; }
      // First sight: each firefly rises out of a lantern hole into the swarm.
      const appear = ease((nowMs - track.bornAt - index / count * FIREFLIES_APPEAR_STAGGER_MS) / FIREFLIES_APPEAR_MS);
      if (appear < 1) {
        graveFireflyHole(index, site, hole);
        pose.x = hole.x + (pose.x - hole.x) * appear;
        pose.y = hole.y + (pose.y - hole.y) * appear;
        pose.alpha *= appear;
      }
      if (!source.visible) pose.alpha = 0;
      const flight = this.fly(track.flights[index], pose, dt, index, angle, orbit.omega);
      const glow = pose.glow * pose.alpha;
      // A firefly flying in to the crown hands its ground light over to the crown: thirty ground
      // lights stacked over the pale grave lid would light it up like a lamp.
      const light = volley ? AMMO_SWARM_GROUND_SHARE * (1 - pose.gathered) : 1;
      this.poses.push({ x: flight.x, y: flight.y, heading: flight.heading, alpha: pose.alpha, light });
      if (glow > 0.01) {
        this.wisps.add({ tailX: flight.x, tailY: flight.y, headX: flight.x, headY: flight.y, halfWidth: CHARGE_GLOW_SIZE * 2.4,
          kind: GraveWispKind.Glow, t: 0, seed: (index * 0.37 + salt) % 1, size: CHARGE_GLOW_SIZE * (0.7 + 0.3 * pose.glow),
          intensity: CHARGE_GLOW_INTENSITY * glow });
      }
    }
    this.syncOrbs(track, source, site, salt, nowMs);
    track.swarm.sync(this.poses, nowMs);
  }

  /**
   * One firefly's flight toward its target pose: a critically damped spring, lazy while it roams
   * with the swarm and tight once gathered. Hidden ones wait at their target.
   */
  private fly(flight: FireflyFlight, pose: GraveFireflyAmmoPose, dt: number, index: number, orbitAngle: number,
    omega: number): FireflyFlight {
    if (!flight.drawn || pose.alpha <= 0.001) {
      flight.x = pose.x; flight.y = pose.y; flight.vx = 0; flight.vy = 0;
      flight.drawn = pose.alpha > 0.001;
      flight.heading = Math.atan2(Math.cos(orbitAngle) * omega * 0.85, -Math.sin(orbitAngle) * omega);
      return flight;
    }
    if (dt <= 0) return flight;
    const w = (FIREFLY_FOLLOW_MIN + FIREFLY_FOLLOW_SPREAD * fireflyHash(index)) * (1 + FIREFLY_GATHERED_FOLLOW * pose.gathered);
    // Sub-steps keep the stiff, gathered spring stable on a long frame.
    const steps = Math.max(1, Math.ceil(dt * w / 0.35)), h = dt / steps;
    for (let step = 0; step < steps; step++) {
      flight.vx += (w * w * (pose.x - flight.x) - 2 * w * flight.vx) * h;
      flight.vy += (w * w * (pose.y - flight.y) - 2 * w * flight.vy) * h;
      flight.x += flight.vx * h;
      flight.y += flight.vy * h;
    }
    if (flight.vx * flight.vx + flight.vy * flight.vy > 4) flight.heading = Math.atan2(flight.vy, flight.vx);
    return flight;
  }

  /** The gather's orbs, the aura over them and their shared ground light. */
  private syncOrbs(track: BossTrack, source: BossPresenceSource, site: { x: number; y: number; size: number; crownX: number; crownY: number },
    salt: number, nowMs: number): void {
    const volley = track.volley;
    if (!volley) { track.orbs.length = 0; return; }
    if (source.visible && enemyVolleyPhaseAt(volley.state, nowMs) === 'charge') {
      this.haze?.inhale(volley.crownX, volley.crownY, enemyVolleyChargeAt(volley.state, nowMs));
    }
    while (track.orbs.length < volley.count) track.orbs.push({ x: 0, y: 0, size: 0, intensity: 0 });
    track.orbs.length = volley.count;
    let grown = 0;
    for (let shot = 0; shot < volley.count; shot++) {
      const orb = graveOrbPose(shot, volley.count, site, volley.state, track.seenLaunches, nowMs, track.orbs[shot]);
      if (orb.size <= 0 || !source.visible) continue;
      grown = Math.max(grown, orb.intensity / GRAVE_FIREFLIES.orbIntensity);
      this.wisps.add({ tailX: orb.x, tailY: orb.y, headX: orb.x, headY: orb.y, halfWidth: orb.size * 2.6, kind: GraveWispKind.Light,
        t: 0, seed: (shot * 0.61 + salt) % 1, size: orb.size, intensity: orb.intensity });
    }
    if (grown <= 0.01) return;
    this.wisps.add({ tailX: volley.crownX, tailY: volley.crownY, headX: volley.crownX, headY: volley.crownY,
      halfWidth: CROWN_AURA_SIZE * 2.6, kind: GraveWispKind.Glow, t: 0, seed: salt, size: CROWN_AURA_SIZE * (0.6 + 0.4 * Math.min(1, grown)),
      intensity: CROWN_AURA_INTENSITY * grown });
    this.light(`graveCrown:${source.id}`, volley.crownX, volley.crownY, CROWN_GROUND * Math.min(1.3, grown));
  }

  private glide(flight: GraveLightFlight): number {
    const t = Math.max(0, Math.min(1, (this.nowMs - flight.bornAt) / FLIGHT_GLIDE_MS));
    return 1 - t * t * (3 - 2 * t);
  }

  private drawFlights(): void {
    for (const flight of this.flights) {
      const glide = this.glide(flight);
      const x = flight.x + flight.offsetX * glide, y = flight.y + flight.offsetY * glide;
      const speed = Math.hypot(flight.vx, flight.vy);
      const trail = Math.min(FLIGHT_TRAIL_MAX, speed * FLIGHT_TRAIL_S);
      const tailX = speed > 1 ? x - flight.vx / speed * trail : x, tailY = speed > 1 ? y - flight.vy / speed * trail : y;
      const size = GRAVE_FIREFLIES.orbSize;
      this.wisps.add({ tailX, tailY, headX: x, headY: y, halfWidth: size * 2.6, kind: GraveWispKind.Light, t: 0,
        seed: flight.seed, size, intensity: GRAVE_FIREFLIES.orbIntensity });
      this.light(flight.key, x, y, FLIGHT_GROUND);
    }
  }

  private drawPuffs(nowMs: number): void {
    let kept = 0;
    for (const puff of this.puffs) {
      const t = (nowMs - puff.bornAt) / PUFF_MS;
      if (t >= 1) continue;
      this.puffs[kept++] = puff;
      this.wisps.add({ tailX: puff.x, tailY: puff.y, headX: puff.x, headY: puff.y, halfWidth: PUFF_SIZE * 4.6,
        kind: GraveWispKind.Puff, t: Math.max(0, t), seed: puff.seed, size: PUFF_SIZE, intensity: 1.6 });
    }
    this.puffs.length = kept;
  }

  private light(key: string, x: number, y: number, strength: number): void {
    this.frameKeys.add(key);
    this.litKeys.add(key);
    this.lighting.setLight(key, 'stagedFirefly', x, y, { intensity: GRAVE_LIGHT_GROUND * strength, color: GRAVE_LIGHT_COLOR });
  }

  private releaseLight(key: string): void {
    if (!this.litKeys.delete(key)) return;
    this.lighting.releaseLight(key, { immediate: true });
  }
}

/** Locker gestreute, langsame Bahnen in beide Richtungen um den Boss. */
function createOrbits(count: number, size: number, seed: number): FireflyOrbit[] {
  let state = seed >>> 0;
  const random = (): number => {
    state = (Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
    return state / 4294967296;
  };
  return Array.from({ length: count }, (_, index) => ({
    // `size` is the physical body, which for a big boss covers its limbs: the swarm hugs it closely.
    radius: size * (0.45 + random() * 0.6),
    omega: (0.25 + random() * 0.35) * (index % 2 === 0 ? 1 : -1),
    phase: random() * Math.PI * 2,
    bobAmplitude: size * (0.08 + random() * 0.2),
    bobFrequency: 0.5 + random() * 0.9,
    bobPhase: random() * Math.PI * 2,
  }));
}

const hole = { x: 0, y: 0 };

function fireflyHash(index: number): number {
  const s = Math.sin(index * 91.7 + 13.1) * 43758.5453;
  return s - Math.floor(s);
}

function ease(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

function hashId(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) hash = Math.imul(hash ^ id.charCodeAt(index), 16777619);
  return hash >>> 0;
}
