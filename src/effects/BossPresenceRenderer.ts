import type * as Phaser from 'phaser';
import type { CoopDefenseEnemyBossPresenceConfig } from '../config/coopDefenseEnemies';
import type { ProjectileCustomVisual, ProjectileCustomVisualFactory } from '../projectile/ProjectileVisualOverrides';
import type { EnemyVolleyState } from '../systems/EnemyVolleyState';
import { GraveFireflySwarm, type GraveFireflyPose } from './GraveFireflySwarm';
import { fireflyShot, graveFireflyHole, graveFireflyPose, type GraveFireflyAmmoPose } from './graveTitan/graveLightModel';
import { GraveWispGpuLayer, GraveWispKind } from './gpu/GraveWispGpuLayer';
import type { LightingSystem } from './LightingSystem';

/**
 * Lesbarkeit eines Bosses ohne HUD-Rahmen: normale Ambient-Glühwürmchen umschwärmen ihn.
 * Seine leuchtenden Fußspuren kommen aus der normalen Bewegungs-Pipeline
 * (`MovementEffectsRenderer`, `footprintGlow`). Bei einem Boss mit angekündigter Salve sind genau
 * diese Glühwürmchen seine Munition (`graveLightModel`): Beim Sammeln ziehen sie sich über dem Grab
 * zusammen und beginnen zu glühen, und jeder Schuss fliegt sichtbar aus seiner Gruppe. Reine
 * Präsentation replizierter Positionen und Zustände.
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

interface BossTrack {
  readonly swarm: GraveFireflySwarm;
  readonly orbits: readonly FireflyOrbit[];
  /** Weich nachgeführter Schwarmmittelpunkt: die Glühwürmchen folgen dem Boss träge. */
  centerX: number;
  centerY: number;
  lastNowMs: number;
  seenAt: number;
  x: number;
  y: number;
  volley: BossVolleyPresence | null;
  /** Gather whose launches `seenLaunches` counts (its start time). */
  cycle: number;
  seenLaunches: number;
  /** Drawn firefly positions of the latest frame (a launch starts from its group's place). */
  readonly ammo: GraveFireflyAmmoPose[];
  readonly headings: number[];
  /** First sight: the fireflies rise out of the boss as it appears. */
  readonly bornAt: number;
}

/** A flying salvo shot drawn as a grave light; it starts where its light was and glides into its path. */
interface GraveLightFlight {
  x: number; y: number; vx: number; vy: number;
  readonly offsetX: number; readonly offsetY: number;
  /** Where it left the crown, over the boss's back. */
  readonly startX: number; readonly startY: number;
  readonly bornAt: number;
  readonly seed: number;
  readonly key: string;
  live: boolean;
}

interface GraveLightPuff { readonly x: number; readonly y: number; readonly bornAt: number; readonly seed: number }

const FLIGHT_GLIDE_MS = 140;
const FLIGHT_SIZE = 6.2;
/**
 * A shot leaves the crown at a charged firefly's glow and burns up to full strength (and lights the
 * ground) once it is under way: ten full-strength shots stacked over the pale grave lid bloom white.
 */
const FLIGHT_LAUNCH_INTENSITY = 0.8;
const FLIGHT_INTENSITY = 1.9;
const FLIGHT_CLEAR_PX = 40;
const FLIGHT_BURN_PX = 80;
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
const CHARGE_GLOW_SIZE = 3.8;
const CHARGE_GLOW_INTENSITY = 0.75;
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
      // The shot leaves from the middle of the glowing group that feeds it.
      const shots = track.volley?.count ?? 1, launch = track.seenLaunches, fireflies = track.ammo.length;
      let sumX = 0, sumY = 0, members = 0;
      track.ammo.forEach((pose, index) => {
        if (pose.alpha <= 0 || fireflyShot(index, fireflies, shots) !== launch) return;
        sumX += pose.x; sumY += pose.y; members++;
      });
      if (members > 0) { startX = sumX / members; startY = sumY / members; }
      track.seenLaunches++;
    }
    const flight: GraveLightFlight = { x: request.x, y: request.y, vx: 0, vy: 0, offsetX: startX - request.x, offsetY: startY - request.y, startX, startY,
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
        centerX: source.x,
        centerY: source.y,
        lastNowMs: nowMs,
        seenAt: nowMs,
        x: source.x, y: source.y, volley: null, cycle: Number.NaN, seenLaunches: 0, ammo: [], headings: [], bornAt: nowMs,
      };
      this.tracks.set(source.id, track);
    }
    const dt = Math.max(0, Math.min(0.1, (nowMs - track.lastNowMs) / 1000));
    track.lastNowMs = nowMs;
    track.seenAt = nowMs;
    track.x = source.x; track.y = source.y;
    const follow = 1 - Math.exp(-dt * 2.2);
    track.centerX += (source.x - track.centerX) * follow;
    track.centerY += (source.y - track.centerY) * follow;

    const volley = source.volley ?? null;
    track.volley = volley;
    if (volley) {
      this.salvoWeapons.add(volley.weaponId);
      if (volley.state.chargeStartAt !== track.cycle) { track.cycle = volley.state.chargeStartAt; track.seenLaunches = 0; }
    }
    const site = { x: source.x, y: source.y, size: source.size, crownX: volley?.crownX ?? source.x, crownY: volley?.crownY ?? source.y };
    const salt = (hashId(source.id) % 997) / 997;
    const count = track.orbits.length;
    while (track.ammo.length < count) { track.ammo.push({ x: 0, y: 0, alpha: 0, glow: 0, gathered: 0 }); track.headings.push(0); }
    this.poses.length = 0;
    const seconds = nowMs / 1000;
    for (let index = 0; index < count; index++) {
      const orbit = track.orbits[index];
      const angle = orbit.phase + seconds * orbit.omega;
      const bob = Math.sin(seconds * orbit.bobFrequency + orbit.bobPhase) * orbit.bobAmplitude;
      const radius = orbit.radius + bob;
      const orbitX = track.centerX + Math.cos(angle) * radius;
      const orbitY = track.centerY + Math.sin(angle) * radius * 0.85;
      const pose = track.ammo[index], lastX = pose.x, lastY = pose.y, seen = pose.alpha > 0;
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
      const vx = pose.x - lastX, vy = pose.y - lastY;
      track.headings[index] = seen && vx * vx + vy * vy > 0.04 ? Math.atan2(vy, vx)
        : Math.atan2(Math.cos(angle) * orbit.omega * 0.85, -Math.sin(angle) * orbit.omega);
      const glow = pose.glow * pose.alpha;
      // A firefly flying in to the crown hands its ground light over to its own glow: thirty ground
      // lights stacked over the pale grave lid would light it up like a lamp.
      const light = volley ? AMMO_SWARM_GROUND_SHARE * (1 - pose.gathered) : 1;
      this.poses.push({ x: pose.x, y: pose.y, heading: track.headings[index], alpha: pose.alpha, light });
      if (glow > 0.01) {
        this.wisps.add({ tailX: pose.x, tailY: pose.y, headX: pose.x, headY: pose.y, halfWidth: CHARGE_GLOW_SIZE * 2.4,
          kind: GraveWispKind.Glow, t: 0, seed: (index * 0.37 + salt) % 1, size: CHARGE_GLOW_SIZE * (0.7 + 0.3 * pose.glow),
          intensity: CHARGE_GLOW_INTENSITY * glow });
      }
    }
    track.swarm.sync(this.poses, nowMs);
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
      const travelled = Math.hypot(x - flight.startX, y - flight.startY);
      const away = Math.max(0, Math.min(1, (travelled - FLIGHT_CLEAR_PX) / FLIGHT_BURN_PX));
      this.wisps.add({ tailX, tailY, headX: x, headY: y, halfWidth: FLIGHT_SIZE * 2.6, kind: GraveWispKind.Light, t: 0,
        seed: flight.seed, size: FLIGHT_SIZE, intensity: FLIGHT_LAUNCH_INTENSITY + (FLIGHT_INTENSITY - FLIGHT_LAUNCH_INTENSITY) * away });
      this.light(flight.key, x, y, FLIGHT_GROUND * away);
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
    radius: size * (0.8 + random() * 1.1),
    omega: (0.25 + random() * 0.35) * (index % 2 === 0 ? 1 : -1),
    phase: random() * Math.PI * 2,
    bobAmplitude: size * (0.08 + random() * 0.2),
    bobFrequency: 0.5 + random() * 0.9,
    bobPhase: random() * Math.PI * 2,
  }));
}

const hole = { x: 0, y: 0 };

function ease(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

function hashId(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) hash = Math.imul(hash ^ id.charCodeAt(index), 16777619);
  return hash >>> 0;
}
