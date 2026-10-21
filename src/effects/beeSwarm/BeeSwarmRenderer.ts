import type * as Phaser from 'phaser';
import type { GameAudioSystem } from '../../audio/GameAudioSystem';
import type { SyncedBeeSwarm } from '../../types';
import { BeeSwarmGpuLayer, type BeeGpuInstance } from '../gpu/BeeSwarmGpuLayer';
import { BEE_KIND } from '../gpu/BeeSwarmShader';
import { BeeFlockModel, type BeeHivePresentation, type BeeInstance } from './BeeFlockModel';

/** Bees per swarm by graphics quality; the host simulation does not depend on it. */
export const BEES_PER_SWARM = { high: 90, medium: 64, low: 40 } as const;
const MAX_BUZZ_LOOPS = 2;
const BUZZ_MARGIN_PX = 220;
const STING_SOUND_GAP_MS = 140;

export type BeeSwarmAudio = Pick<GameAudioSystem, 'startLoop' | 'updateLoopPosition' | 'stopLoop' | 'playSound'>;

export interface BeeSwarmRenderFrame {
  readonly swarms: readonly SyncedBeeSwarm[];
  readonly hives: ReadonlyMap<number, BeeHivePresentation>;
  readonly syncNow: number;
  readonly timeMs: number;
  readonly quality: keyof typeof BEES_PER_SWARM;
  /** 0 at night (no sun shadows) to 1 in daylight. */
  readonly shadowStrength: number;
  readonly targetPosition: (kind: 'player' | 'enemy', id: string) => { x: number; y: number } | null;
}

/**
 * The single owner of bee presentation: swarms of hives and the bees around idle hives. Reads the
 * replicated swarm slice and hive states; draws through one GPU layer and plays the buzz.
 */
export class BeeSwarmRenderer {
  private readonly layer: BeeSwarmGpuLayer;
  private readonly flock = new BeeFlockModel();
  private readonly bees: BeeInstance[] = [];
  private readonly gpu: BeeGpuInstance = { x: 0, y: 0, heading: 0, wing: 0, size: 0, alpha: 0, r: 0, g: 0, b: 0,
    hostile: 0, kind: 0, blur: 0, altitude: 0, seed: 0 };
  private readonly loops = new Map<number, string>();
  private readonly releases = new Set<number>();
  private readonly stings = new Map<number, number>();
  private readonly phases = new Map<number, SyncedBeeSwarm['phase']>();
  private lastTimeMs: number | null = null;
  private lastStingSoundAt = -Infinity;

  constructor(private readonly scene: Phaser.Scene, private readonly audio: BeeSwarmAudio | null) {
    this.layer = new BeeSwarmGpuLayer(scene);
  }

  sync(frame: BeeSwarmRenderFrame): void {
    const dt = this.lastTimeMs === null ? 0 : Math.min(.05, Math.max(0, (frame.timeMs - this.lastTimeMs) / 1000));
    this.lastTimeMs = frame.timeMs;
    const count = this.flock.update({
      swarms: frame.swarms, hives: frame.hives, syncNow: frame.syncNow, time: frame.timeMs / 1000, dt,
      beesPerSwarm: BEES_PER_SWARM[frame.quality], targetPosition: frame.targetPosition,
    }, this.bees);
    const camera = this.scene.cameras.main;
    this.layer.setFrame(frame.timeMs / 1000, 1 / Math.max(.1, camera.zoom), frame.shadowStrength);
    this.layer.begin();
    const g = this.gpu;
    for (let i = 0; i < count; i++) {
      const bee = this.bees[i];
      g.x = bee.x; g.y = bee.y; g.heading = bee.heading; g.wing = bee.wing; g.size = bee.size; g.alpha = bee.alpha;
      // Honey gold with a little variation per bee; veils carry their own tint in the shader.
      g.r = .99 - .06 * bee.tone; g.g = .78 - .1 * bee.tone; g.b = .22 + .04 * bee.tone;
      g.hostile = bee.hostile ? 1 : 0; g.kind = bee.veil ? BEE_KIND.veil : BEE_KIND.bee;
      g.blur = bee.blur; g.altitude = bee.altitude; g.seed = bee.seed;
      if (!this.layer.add(g)) break;
    }
    this.layer.end();
    this.syncAudio(frame);
  }

  destroy(): void {
    for (const handle of this.loops.values()) this.audio?.stopLoop(handle);
    this.loops.clear();
    this.flock.clear();
    this.layer.destroy();
  }

  /** Buzz loops for the nearest visible swarms, release and scatter cues, rate-limited stings. */
  private syncAudio(frame: BeeSwarmRenderFrame): void {
    if (!this.audio) return;
    const view = this.scene.cameras.main.worldView;
    const visible = frame.swarms.filter(s => s.x > view.x - BUZZ_MARGIN_PX && s.x < view.right + BUZZ_MARGIN_PX
      && s.y > view.y - BUZZ_MARGIN_PX && s.y < view.bottom + BUZZ_MARGIN_PX)
      .sort((a, b) => Math.hypot(a.x - view.centerX, a.y - view.centerY) - Math.hypot(b.x - view.centerX, b.y - view.centerY))
      .slice(0, MAX_BUZZ_LOOPS);
    const keep = new Set(visible.map(s => s.id));
    for (const [id, handle] of this.loops) if (!keep.has(id)) { this.audio.stopLoop(handle); this.loops.delete(id); }
    for (const swarm of visible) {
      const handle = this.loops.get(swarm.id);
      if (handle) this.audio.updateLoopPosition(handle, swarm.x, swarm.y);
      else {
        const started = this.audio.startLoop('sfx_bee_swarm_loop', swarm.x, swarm.y, undefined, swarm.phase === 'returning' ? .5 : 1);
        if (started) this.loops.set(swarm.id, started);
      }
    }
    const present = new Set<number>();
    for (const swarm of frame.swarms) {
      present.add(swarm.id);
      // One-shots only for changes this client saw, never for a swarm met in flight on late join.
      if (!this.releases.has(swarm.id)) {
        this.releases.add(swarm.id);
        if (frame.syncNow - swarm.releasedAt < 600) this.audio.playSound('sfx_bee_hive_release', swarm.x, swarm.y);
      }
      if (this.phases.get(swarm.id) === 'hunting' && swarm.phase === 'dispersed') {
        this.audio.playSound('sfx_bee_swarm_scatter', swarm.x, swarm.y);
      }
      this.phases.set(swarm.id, swarm.phase);
      const previous = this.stings.get(swarm.id);
      if (previous !== undefined && swarm.stingSequence > previous && frame.timeMs - this.lastStingSoundAt >= STING_SOUND_GAP_MS) {
        this.lastStingSoundAt = frame.timeMs;
        const target = swarm.target ? frame.targetPosition(swarm.target.kind, swarm.target.id) : null;
        this.audio.playSound('sfx_bee_sting', target?.x ?? swarm.x, target?.y ?? swarm.y, swarm.target?.kind === 'player' ? swarm.target.id : undefined);
      }
      this.stings.set(swarm.id, swarm.stingSequence);
    }
    for (const id of this.releases) if (!present.has(id)) this.releases.delete(id);
    for (const id of this.stings.keys()) if (!present.has(id)) this.stings.delete(id);
    for (const id of this.phases.keys()) if (!present.has(id)) this.phases.delete(id);
  }
}
