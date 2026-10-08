import type * as Phaser from 'phaser';
import type { CoopDefenseEnemyBossPresenceConfig } from '../config/coopDefenseEnemies';
import { GraveFireflySwarm, type GraveFireflyPose } from './GraveFireflySwarm';
import type { LightingSystem } from './LightingSystem';

/**
 * Lesbarkeit eines Bosses ohne HUD-Rahmen: normale Ambient-Glühwürmchen umschwärmen ihn.
 * Seine leuchtenden Fußspuren kommen aus der normalen Bewegungs-Pipeline
 * (`MovementEffectsRenderer`, `footprintGlow`). Reine Präsentation replizierter Positionen.
 */

export interface BossPresenceSource {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly visible: boolean;
  readonly presence: CoopDefenseEnemyBossPresenceConfig;
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
}

export class BossPresenceRenderer {
  private readonly tracks = new Map<string, BossTrack>();
  private readonly poses: GraveFireflyPose[] = [];
  private destroyed = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly lighting: LightingSystem,
  ) {}

  sync(sources: readonly BossPresenceSource[], nowMs: number): void {
    if (this.destroyed) return;
    for (const source of sources) this.syncSource(source, nowMs);
    for (const [id, track] of this.tracks) {
      if (track.seenAt === nowMs) continue;
      track.swarm.destroy();
      this.tracks.delete(id);
    }
  }

  clear(): void {
    for (const track of this.tracks.values()) track.swarm.destroy();
    this.tracks.clear();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.clear();
    this.destroyed = true;
  }

  private syncSource(source: BossPresenceSource, nowMs: number): void {
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
      };
      this.tracks.set(source.id, track);
    }
    const dt = Math.max(0, Math.min(0.1, (nowMs - track.lastNowMs) / 1000));
    track.lastNowMs = nowMs;
    track.seenAt = nowMs;
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
