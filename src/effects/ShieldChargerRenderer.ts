import * as Phaser from 'phaser';
import type { EnemyVisualSource } from '../entities/EnemyVisualSource';
import { getGraphicsQualityProfile } from '../graphics/GraphicsQuality';
import { getVisibleWorldView } from '../ui/HostileBaseIndicator';
import type { CameraFeedbackController } from './camera/CameraFeedbackController';
import type { LightingSystem } from './LightingSystem';
import type { GpuVfxSystem } from './gpu/GpuVfxSystem';
import { ShieldChargerGpuLayer, type ShieldChargerGpuItem } from './gpu/ShieldChargerGpuLayer';
import {
  SHIELD_CHARGER_DUST_LIFE_S, SHIELD_CHARGER_KIND, SHIELD_CHARGER_LANE_MARGIN_PX, SHIELD_CHARGER_SKID_LIFE_S,
} from './gpu/ShieldChargerShader';
import type { ShieldChargeLane } from '../systems/ShieldChargeState';

interface Skid { ax: number; ay: number; bx: number; by: number; halfWidth: number; endedAt: number; seed: number }
interface Dust { x: number; y: number; radius: number; born: number; seed: number }
interface Tracked { revision: number; phase: string; nextDustAt: number; lane: ShieldChargeLane | null }

const STREAK_PX = 150;
const DUST_INTERVAL_MS = 55;
let nextRendererId = 0;
const seedOf = (key: string | number): number => {
  let h = 2166136261;
  for (const ch of String(key)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 997) / 997;
};

/**
 * Scene lifetime. Draws the host-fixed charge lane, the run streak, dust and ground scuffs as three
 * GPU draws. It only reads the replicated charge state of each enemy and the synchronised clock;
 * dust and scuffs are local presentation memory of transitions it has seen.
 */
export class ShieldChargerRenderer {
  private readonly layer: ShieldChargerGpuLayer;
  private readonly tracked = new Map<string, Tracked>();
  private readonly skids: Skid[] = [];
  private readonly dust: Dust[] = [];
  private readonly lightKeys = new Set<string>();
  private readonly lightPrefix = `shield-charger-${nextRendererId++}-`;
  private sequence = 0;
  private enemies: () => readonly EnemyVisualSource[] = () => [];
  private clock: () => number = () => this.scene.time.now;
  private lighting: LightingSystem | null = null;
  private gpuVfx: GpuVfxSystem | null = null;
  private cameraFeedback: CameraFeedbackController | null = null;

  constructor(private readonly scene: Phaser.Scene) {
    this.layer = new ShieldChargerGpuLayer(scene);
    scene.events.on(Phaser.Scenes.Events.PRE_RENDER, this.render, this);
  }

  setEnemySource(source: () => readonly EnemyVisualSource[]): void { this.enemies = source; }
  /** Host-synchronised time: lane timestamps are host timestamps. */
  setClock(clock: () => number): void { this.clock = clock; }
  setLightingSystem(lighting: LightingSystem | null): void { this.lighting = lighting; }
  registerGpuVfx(system: GpuVfxSystem): void { this.gpuVfx = system; }
  setCameraFeedback(controller: CameraFeedbackController | null): void { this.cameraFeedback = controller; }

  clear(): void {
    this.tracked.clear(); this.skids.length = 0; this.dust.length = 0;
    this.layer.clear(); this.releaseLights(new Set());
  }

  destroy(): void {
    this.scene.events.off(Phaser.Scenes.Events.PRE_RENDER, this.render, this);
    this.clear(); this.layer.destroy();
  }

  private render(): void {
    const local = this.scene.time.now, now = this.clock();
    const view = getVisibleWorldView(this.scene.cameras.main);
    const margin = 80;
    const visible = (ax: number, ay: number, bx: number, by: number) =>
      Math.max(ax, bx) + margin >= view.x && Math.min(ax, bx) - margin <= view.x + view.width
      && Math.max(ay, by) + margin >= view.y && Math.min(ay, by) - margin <= view.y + view.height;
    const suppressed = this.gpuVfx?.isSuppressed() ?? false;
    const lightLimit = getGraphicsQualityProfile(this.scene).level === 'low' ? 2 : 6;
    const lights = new Set<string>();
    const add = (item: ShieldChargerGpuItem) => { if (!suppressed) this.layer.add(item); };
    this.layer.begin(local);

    const live = new Set<string>();
    const lanes: { lane: ShieldChargeLane; allied: boolean; seed: number; id: string }[] = [];
    const streaks: ShieldChargerGpuItem[] = [];
    for (const enemy of this.enemies()) {
      const state = enemy.getNetSnapshot().shieldCharge;
      if (!state || !enemy.sprite.active) continue;
      live.add(enemy.id);
      const allied = enemy.faction === 'allied';
      let track = this.tracked.get(enemy.id);
      if (!track) { track = { revision: 0, phase: 'none', nextDustAt: 0, lane: null }; this.tracked.set(enemy.id, track); }
      if (state.revision !== track.revision) this.transition(track, state.phase, state.lane, local, enemy);
      const lane = state.lane;
      if (state.phase === 'windup' && lane) lanes.push({ lane, allied, seed: seedOf(enemy.id), id: enemy.id });
      if (state.phase === 'run' && lane) {
        const bx = enemy.sprite.x, by = enemy.sprite.y;
        const along = (bx - lane.originX) * Math.cos(lane.angle) + (by - lane.originY) * Math.sin(lane.angle);
        const tail = Math.max(0, Math.min(STREAK_PX, along));
        streaks.push({ ax: bx - Math.cos(lane.angle) * tail, ay: by - Math.sin(lane.angle) * tail, bx, by,
          halfWidth: lane.halfWidth + 6, kind: SHIELD_CHARGER_KIND.streak, t: Math.max(0, now - lane.runAt) / 1000,
          seed: seedOf(enemy.id), allied });
        if (local >= track.nextDustAt) {
          track.nextDustAt = local + DUST_INTERVAL_MS;
          this.pushDust(bx - Math.cos(lane.angle) * lane.halfWidth, by - Math.sin(lane.angle) * lane.halfWidth, lane.halfWidth * 0.9, local);
        }
      }
    }
    for (const id of this.tracked.keys()) if (!live.has(id)) this.tracked.delete(id);

    // Warnings first: an active lane telegraph is never the item a full batch drops.
    for (const { lane, allied, seed, id } of lanes) {
      const ex = lane.originX + Math.cos(lane.angle) * lane.length, ey = lane.originY + Math.sin(lane.angle) * lane.length;
      if (!visible(lane.originX, lane.originY, ex, ey)) continue;
      const progress = Phaser.Math.Clamp((now - lane.startedAt) / Math.max(1, lane.runAt - lane.startedAt), 0, 1);
      add({ ax: lane.originX, ay: lane.originY, bx: ex, by: ey, halfWidth: lane.halfWidth + SHIELD_CHARGER_LANE_MARGIN_PX,
        kind: SHIELD_CHARGER_KIND.lane, t: progress, seed, allied });
      if (!allied && lights.size < lightLimit) {
        lights.add(`lane-${id}`);
        this.lighting?.setLight(this.lightPrefix + `lane-${id}`, 'explosion', lane.originX, lane.originY,
          { radiusPx: 70 + 50 * progress, color: 0xff5a2c, intensity: 0.1 + 0.25 * progress * progress, occludes: false });
      }
    }
    for (const streak of streaks) if (visible(streak.ax, streak.ay, streak.bx, streak.by)) add(streak);
    for (let i = this.skids.length - 1; i >= 0; i--) {
      const skid = this.skids[i], age = (local - skid.endedAt) / 1000;
      if (age >= SHIELD_CHARGER_SKID_LIFE_S) { this.skids.splice(i, 1); continue; }
      if (visible(skid.ax, skid.ay, skid.bx, skid.by)) add({ ...skid, kind: SHIELD_CHARGER_KIND.skid, t: age, allied: false });
    }
    for (let i = this.dust.length - 1; i >= 0; i--) {
      const puff = this.dust[i], age = (local - puff.born) / 1000;
      if (age >= SHIELD_CHARGER_DUST_LIFE_S) { this.dust.splice(i, 1); continue; }
      if (visible(puff.x, puff.y, puff.x, puff.y)) add({ ax: puff.x, ay: puff.y, bx: puff.x, by: puff.y,
        halfWidth: puff.radius * 1.8, kind: SHIELD_CHARGER_KIND.dust, t: age, seed: puff.seed, allied: false, a1: puff.radius });
    }
    this.layer.flush();
    this.releaseLights(lights);
  }

  /** Presentation memory of phase changes: kick-off dust, the stop puff and the scuff trail. */
  private transition(track: Tracked, phase: string, lane: ShieldChargeLane | null, local: number, enemy: EnemyVisualSource): void {
    if (phase === 'run' && track.phase !== 'run' && lane) {
      this.pushDust(lane.originX, lane.originY, lane.halfWidth * 1.4, local);
      const view = getVisibleWorldView(this.scene.cameras.main);
      if (lane.originX >= view.x && lane.originX <= view.x + view.width && lane.originY >= view.y && lane.originY <= view.y + view.height) {
        this.cameraFeedback?.request({ channel: 'impact', amplitudePx: 1.6, durationMs: 120, priority: 30,
          decay: 'impulse', sourceX: lane.originX, sourceY: lane.originY, falloffPx: 500 });
      }
    }
    if (phase === 'recover' && track.phase === 'run' && lane) {
      const ex = lane.originX + Math.cos(lane.angle) * lane.length, ey = lane.originY + Math.sin(lane.angle) * lane.length;
      if (this.skids.length >= 32) this.skids.shift();
      this.skids.push({ ax: lane.originX, ay: lane.originY, bx: ex, by: ey, halfWidth: lane.halfWidth + 4, endedAt: local,
        seed: seedOf(++this.sequence) });
      this.pushDust(enemy.sprite.x, enemy.sprite.y, lane.halfWidth * 1.7, local);
    }
    track.revision = enemy.getNetSnapshot().shieldCharge?.revision ?? track.revision;
    track.phase = phase;
    track.lane = lane;
  }

  private pushDust(x: number, y: number, radius: number, local: number): void {
    if (this.dust.length >= 96) this.dust.shift();
    this.dust.push({ x, y, radius, born: local, seed: seedOf(++this.sequence) });
  }

  private releaseLights(next: Set<string>): void {
    for (const key of this.lightKeys) if (!next.has(key)) this.lighting?.releaseLight(this.lightPrefix + key, { immediate: true });
    this.lightKeys.clear();
    for (const key of next) this.lightKeys.add(key);
  }
}
