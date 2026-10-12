import * as Phaser from 'phaser';
import { ALLIED_COLOR, ALLIED_PALETTE, VOID_PALETTE } from '../config';
import { getCoopDefenseEnemyConfig } from '../config/coopDefenseEnemies';
import type { EnemyVisualSource } from '../entities/EnemyVisualSource';
import { getGraphicsQualityProfile } from '../graphics/GraphicsQuality';
import { getVisibleWorldView } from '../ui/HostileBaseIndicator';
import type { CameraFeedbackController } from './camera/CameraFeedbackController';
import { CAMERA_FEEDBACK_PRIORITY } from './camera/cameraFeedbackPresets';
import type { LightingSystem } from './LightingSystem';
import type { GpuVfxSystem } from './gpu/GpuVfxSystem';
import { FirestarterGpuLayer, type FirestarterGpuItem } from './gpu/FirestarterGpuLayer';
import {
  FIRESTARTER_COMBO_LIFE_S, FIRESTARTER_KIND, FIRESTARTER_LANCE_FLASH_S, FIRESTARTER_LANCE_LIFE_S,
} from './gpu/FirestarterShader';

/** Until the asset's lance socket exists, telegraph and shot leave the body edge, not its centre. */
export const FIRESTARTER_LANCE_MUZZLE_PX = 16;
const TELEGRAPH_HALF_WIDTH = 30;
const LANCE_HALF_WIDTH = 48;

interface OrbVisual { x: number; y: number; vx: number; vy: number; size: number; allied: boolean; seed: number }
interface LanceVisual { sx: number; sy: number; ex: number; ey: number; allied: boolean; born: number; seed: number }
interface ComboVisual { x: number; y: number; radius: number; allied: boolean; born: number; seed: number }
interface ChargeSample { progress: number; at: number }

let nextRendererId = 0;
const seedOf = (key: string | number): number => {
  let h = 2166136261;
  for (const ch of String(key)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 997) / 997;
};

/**
 * Scene lifetime. Draws everything the firestarter owns visually (charging lance, shot, void
 * orbs and the combo signature) as three GPU draws. Gameplay state stays with its owners:
 * telegraphs come from replicated enemy snapshots, orbs from projectile presentation, shots and
 * combos from the reliable hitscan/explosion presentation events.
 */
export class FirestarterRenderer {
  private readonly layer: FirestarterGpuLayer;
  private readonly orbs = new Map<number, OrbVisual>();
  private readonly lances: LanceVisual[] = [];
  private readonly combos: ComboVisual[] = [];
  private readonly charges = new Map<string, ChargeSample>();
  private readonly lightKeys = new Set<string>();
  private readonly lightPrefix = `firestarter-${nextRendererId++}-`;
  private sequence = 0;
  private enemies: () => readonly EnemyVisualSource[] = () => [];
  private lighting: LightingSystem | null = null;
  private gpuVfx: GpuVfxSystem | null = null;
  private cameraFeedback: CameraFeedbackController | null = null;

  constructor(private readonly scene: Phaser.Scene) {
    this.layer = new FirestarterGpuLayer(scene);
    scene.events.on(Phaser.Scenes.Events.PRE_RENDER, this.render, this);
  }

  setEnemySource(source: () => readonly EnemyVisualSource[]): void { this.enemies = source; }
  setLightingSystem(lighting: LightingSystem | null): void { this.lighting = lighting; }
  registerGpuVfx(system: GpuVfxSystem): void { this.gpuVfx = system; }
  setCameraFeedback(controller: CameraFeedbackController | null): void { this.cameraFeedback = controller; }

  // Projectile presentation contract (same shape as the other pooled projectile renderers).
  createVisual(id: number, x: number, y: number, size: number, color: number): void {
    if (this.orbs.has(id)) return;
    this.orbs.set(id, { x, y, vx: 0, vy: 0, size, allied: color === ALLIED_COLOR, seed: seedOf(id) });
  }
  updateVisual(id: number, x: number, y: number, size: number, vx: number, vy: number): void {
    const orb = this.orbs.get(id);
    if (!orb) return;
    orb.x = x; orb.y = y; orb.size = size;
    if (vx * vx + vy * vy > 1) { orb.vx = vx; orb.vy = vy; }
  }
  has(id: number): boolean { return this.orbs.has(id); }
  getActiveIds(): number[] { return [...this.orbs.keys()]; }
  destroyVisual(id: number): void { this.orbs.delete(id); }
  destroyAll(): void { this.orbs.clear(); }

  /** Reliable hitscan event; the trace already ends at the first blocker or fireball. */
  playLance(startX: number, startY: number, endX: number, endY: number, color: number): void {
    if (this.gpuVfx?.isSuppressed()) return;
    const angle = Math.atan2(endY - startY, endX - startX);
    const offset = Math.min(FIRESTARTER_LANCE_MUZZLE_PX, Math.hypot(endX - startX, endY - startY) * 0.5);
    if (this.lances.length === 24) this.lances.shift();
    this.lances.push({ sx: startX + Math.cos(angle) * offset, sy: startY + Math.sin(angle) * offset, ex: endX, ey: endY,
      allied: color === ALLIED_COLOR, born: this.scene.time.now, seed: seedOf(++this.sequence) });
  }

  /** Explosion style `firestarter_combo`; the shared faction burst is drawn by EffectSystem. */
  playCombo(x: number, y: number, radius: number, color?: number): void {
    if (this.gpuVfx?.isSuppressed() || radius <= 0) return;
    if (this.combos.length === 32) this.combos.shift();
    this.combos.push({ x, y, radius, allied: color === ALLIED_COLOR, born: this.scene.time.now, seed: seedOf(++this.sequence) });
    if (radius >= 80) this.cameraFeedback?.request({ channel: 'impact', amplitudePx: 2.6, durationMs: 180,
      priority: CAMERA_FEEDBACK_PRIORITY.mediumImpact, decay: 'impulse', sourceX: x, sourceY: y, falloffPx: 600 });
  }

  clear(): void {
    this.orbs.clear(); this.lances.length = 0; this.combos.length = 0; this.charges.clear();
    this.layer.clear(); this.releaseLights(new Set());
  }

  destroy(): void {
    this.scene.events.off(Phaser.Scenes.Events.PRE_RENDER, this.render, this);
    this.clear(); this.layer.destroy();
  }

  private render(): void {
    const now = this.scene.time.now;
    const view = getVisibleWorldView(this.scene.cameras.main);
    const margin = 60;
    const segmentVisible = (ax: number, ay: number, bx: number, by: number) =>
      Math.max(ax, bx) + margin >= view.x && Math.min(ax, bx) - margin <= view.x + view.width
      && Math.max(ay, by) + margin >= view.y && Math.min(ay, by) - margin <= view.y + view.height;
    const suppressed = this.gpuVfx?.isSuppressed() ?? false;
    const lightLimit = getGraphicsQualityProfile(this.scene).level === 'low' ? 3 : 8;
    const lights = new Set<string>();
    const light = (key: string, x: number, y: number, radiusPx: number, allied: boolean, intensity: number) => {
      if (lights.size >= lightLimit || intensity <= 0.01) return;
      lights.add(key);
      this.lighting?.setLight(this.lightPrefix + key, 'explosion', x, y,
        { radiusPx, color: (allied ? ALLIED_PALETTE : VOID_PALETTE).primary, intensity, occludes: false });
    };
    const add = (item: FirestarterGpuItem) => { if (!suppressed) this.layer.add(item); };
    this.layer.begin(now);

    // Results first: shots and combos keep their batch space ahead of anticipation.
    for (let i = this.lances.length - 1; i >= 0; i--) {
      const lance = this.lances[i], age = (now - lance.born) / 1000;
      if (age >= FIRESTARTER_LANCE_LIFE_S) { this.lances.splice(i, 1); continue; }
      if (!segmentVisible(lance.sx, lance.sy, lance.ex, lance.ey)) continue;
      add({ ax: lance.sx, ay: lance.sy, bx: lance.ex, by: lance.ey, halfWidth: LANCE_HALF_WIDTH,
        kind: FIRESTARTER_KIND.lance, t: age, seed: lance.seed, allied: lance.allied });
      if (age < FIRESTARTER_LANCE_FLASH_S) {
        const k = 1 - age / FIRESTARTER_LANCE_FLASH_S;
        light(`lance-${lance.seed}-a`, lance.ex, lance.ey, 120, lance.allied, 0.55 * k * k);
        light(`lance-${lance.seed}-b`, (lance.sx + lance.ex) / 2, (lance.sy + lance.ey) / 2, 150, lance.allied, 0.3 * k);
      }
    }
    for (let i = this.combos.length - 1; i >= 0; i--) {
      const combo = this.combos[i], age = (now - combo.born) / 1000;
      if (age >= FIRESTARTER_COMBO_LIFE_S) { this.combos.splice(i, 1); continue; }
      if (!segmentVisible(combo.x, combo.y, combo.x, combo.y)) continue;
      add({ ax: combo.x, ay: combo.y, bx: combo.x, by: combo.y, halfWidth: combo.radius * 1.3,
        kind: FIRESTARTER_KIND.combo, t: age, seed: combo.seed, allied: combo.allied, a1: combo.radius });
      if (age < 0.6) light(`combo-${combo.seed}`, combo.x, combo.y, combo.radius * 1.4, combo.allied, 0.6 * (1 - age / 0.6));
    }
    for (const orb of this.orbs.values()) {
      const speed = Math.hypot(orb.vx, orb.vy);
      const tail = Phaser.Math.Clamp(speed * 0.28, 16, 60);
      const dx = speed > 1 ? orb.vx / speed : 1, dy = speed > 1 ? orb.vy / speed : 0;
      const radius = orb.size / 2;
      if (!segmentVisible(orb.x, orb.y, orb.x - dx * tail, orb.y - dy * tail)) continue;
      add({ ax: orb.x, ay: orb.y, bx: orb.x - dx * tail, by: orb.y - dy * tail, halfWidth: radius * 1.9,
        kind: FIRESTARTER_KIND.orb, t: 0, seed: orb.seed, allied: orb.allied, a1: radius });
    }

    const live = new Set<string>();
    for (const enemy of this.enemies()) {
      if (!enemy.sprite.active) continue;
      const snapshot = enemy.getNetSnapshot();
      if (snapshot.specialAction !== 'fire-lance-charge') continue;
      const config = getCoopDefenseEnemyConfig(snapshot.kind).firestarter;
      if (!config) continue;
      live.add(enemy.id);
      // Snapshots arrive at network rate; advance between them at the authored charge speed.
      const reported = Phaser.Math.Clamp(snapshot.gaussChargeProgress, 0, 1);
      let sample = this.charges.get(enemy.id);
      if (!sample || sample.progress !== reported) { sample = { progress: reported, at: now }; this.charges.set(enemy.id, sample); }
      const progress = Math.min(1, sample.progress + (now - sample.at) / config.lance.telegraphMs);
      const angle = snapshot.gaussAimAngle;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const ax = enemy.sprite.x + cos * FIRESTARTER_LANCE_MUZZLE_PX, ay = enemy.sprite.y + sin * FIRESTARTER_LANCE_MUZZLE_PX;
      const bx = ax + cos * config.lance.rangePx, by = ay + sin * config.lance.rangePx;
      const allied = snapshot.faction === 'allied';
      const commitAt = 1 - config.lance.commitMs / config.lance.telegraphMs;
      if (segmentVisible(ax, ay, bx, by)) {
        add({ ax, ay, bx, by, halfWidth: TELEGRAPH_HALF_WIDTH, kind: FIRESTARTER_KIND.telegraph, t: progress,
          seed: seedOf(enemy.id), allied, a1: commitAt });
      }
      light(`charge-${enemy.id}`, ax, ay, 70 + 50 * progress, allied, (progress >= commitAt ? 0.42 : 0.12 + 0.2 * progress));
    }
    for (const id of this.charges.keys()) if (!live.has(id)) this.charges.delete(id);

    this.layer.flush();
    this.releaseLights(lights);
  }

  private releaseLights(next: Set<string>): void {
    for (const key of this.lightKeys) if (!next.has(key)) this.lighting?.releaseLight(this.lightPrefix + key, { immediate: true });
    this.lightKeys.clear();
    for (const key of next) this.lightKeys.add(key);
  }
}
