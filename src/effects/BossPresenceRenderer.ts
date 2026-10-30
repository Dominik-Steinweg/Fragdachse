import type * as Phaser from 'phaser';
import type { CoopDefenseEnemyBossPresenceConfig } from '../config/coopDefenseEnemies';
import type { ProjectileCustomVisual, ProjectileCustomVisualFactory } from '../projectile/ProjectileVisualOverrides';
import type { EnemyVolleyState } from '../systems/EnemyVolleyState';
import { GraveFireflySwarm, type GraveFireflyPose } from './GraveFireflySwarm';
import { graveLightPose, type GraveLightPose } from './graveTitan/graveLightModel';
import { GraveWispGpuLayer, GraveWispKind } from './gpu/GraveWispGpuLayer';
import type { LightingSystem } from './LightingSystem';

/**
 * Lesbarkeit eines Bosses ohne HUD-Rahmen: normale Ambient-Glühwürmchen umschwärmen ihn.
 * Seine leuchtenden Fußspuren kommen aus der normalen Bewegungs-Pipeline
 * (`MovementEffectsRenderer`, `footprintGlow`). Ein Boss mit angekündigter Salve trägt zusätzlich
 * seine Munition als Grablichter (`graveLightModel`): Jeder Schuss seiner Salve fliegt sichtbar aus
 * einem dieser Lichter. Reine Präsentation replizierter Positionen und Zustände.
 */

export interface BossVolleyPresence {
  readonly state: EnemyVolleyState;
  /** Shots per salvo = grave lights. */
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
  readonly lights: GraveLightPose[];
  /** First sight: the grave lights rise out of the boss as it appears. */
  readonly bornAt: number;
}

/** A flying salvo shot drawn as a grave light; it starts where its light was and glides into its path. */
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
const FLIGHT_SIZE = 6.2;
/** Haze trail length: seconds of travel, capped in world px. */
const FLIGHT_TRAIL_S = 0.07;
const FLIGHT_TRAIL_MAX = 34;
const PUFF_MS = 380;
/** Ground light of one grave light: green, and weak enough that ten in a crown never wash out the boss. */
const GRAVE_LIGHT_GROUND = 0.4;
const GRAVE_LIGHT_COLOR = 0x7dff8a;
/** A newly seen boss's grave lights rise out of it over this time. */
const GRAVE_LIGHTS_APPEAR_MS = 900;
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
      const light = track.lights[track.seenLaunches];
      if (light && light.alpha > 0) { startX = light.x; startY = light.y; }
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
        centerX: source.x,
        centerY: source.y,
        lastNowMs: nowMs,
        seenAt: nowMs,
        x: source.x, y: source.y, volley: null, cycle: Number.NaN, seenLaunches: 0, lights: [], bornAt: nowMs,
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

    this.poses.length = 0;
    const seconds = nowMs / 1000;
    for (const orbit of track.orbits) {
      const angle = orbit.phase + seconds * orbit.omega;
      const bob = Math.sin(seconds * orbit.bobFrequency + orbit.bobPhase) * orbit.bobAmplitude;
      const radius = orbit.radius + bob;
      const vx = -Math.sin(angle) * orbit.omega * radius;
      const vy = Math.cos(angle) * orbit.omega * radius * 0.85;
      this.poses.push({
        x: track.centerX + Math.cos(angle) * radius,
        y: track.centerY + Math.sin(angle) * radius * 0.85,
        heading: Math.atan2(vy, vx),
        alpha: source.visible ? 1 : 0,
      });
    }
    track.swarm.sync(this.poses, nowMs);
    this.syncGraveLights(track, source, nowMs);
  }

  /** The salvo's ammunition over the boss's back (none while it is hidden). */
  private syncGraveLights(track: BossTrack, source: BossPresenceSource, nowMs: number): void {
    const volley = source.volley ?? null;
    track.volley = volley;
    if (!volley) { track.lights.length = 0; return; }
    this.salvoWeapons.add(volley.weaponId);
    if (volley.state.chargeStartAt !== track.cycle) { track.cycle = volley.state.chargeStartAt; track.seenLaunches = 0; }
    const site = { x: source.x, y: source.y, size: source.size, crownX: volley.crownX, crownY: volley.crownY };
    while (track.lights.length < volley.count) track.lights.push({ x: 0, y: 0, alpha: 0, size: 0, intensity: 0 });
    track.lights.length = volley.count;
    const salt = (hashId(source.id) % 997) / 997;
    const appear = Math.min(1, Math.max(0, (nowMs - track.bornAt) / GRAVE_LIGHTS_APPEAR_MS));
    for (let index = 0; index < volley.count; index++) {
      const light = graveLightPose(index, volley.count, site, volley.state, track.seenLaunches, nowMs, track.lights[index]);
      const alpha = light.alpha * appear;
      if (!source.visible || alpha <= 0.01) continue;
      this.wisps.add({ tailX: light.x, tailY: light.y, headX: light.x, headY: light.y, halfWidth: light.size * 2.6,
        kind: GraveWispKind.Light, t: 0, seed: (index * 0.37 + salt) % 1, size: light.size, intensity: light.intensity * alpha });
      this.light(`graveLight:${source.id}:${index}`, light.x, light.y, alpha * Math.min(1.6, light.intensity));
    }
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
      this.wisps.add({ tailX, tailY, headX: x, headY: y, halfWidth: FLIGHT_SIZE * 2.6, kind: GraveWispKind.Light, t: 0,
        seed: flight.seed, size: FLIGHT_SIZE, intensity: 1.9 });
      this.light(flight.key, x, y, 1.4);
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

function hashId(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) hash = Math.imul(hash ^ id.charCodeAt(index), 16777619);
  return hash >>> 0;
}
