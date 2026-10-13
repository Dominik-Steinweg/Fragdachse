import * as Phaser from 'phaser';
import { VOID_PALETTE } from '../config';
import type { EnemyVisualSource } from '../entities/EnemyVisualSource';
import { getGraphicsQualityProfile } from '../graphics/GraphicsQuality';
import { getVisibleWorldView } from '../ui/HostileBaseIndicator';
import type { CameraFeedbackController } from './camera/CameraFeedbackController';
import type { LightingSystem } from './LightingSystem';
import type { GpuVfxSystem } from './gpu/GpuVfxSystem';
import { AlienConeGpuLayer } from './gpu/AlienConeGpuLayer';
import { ALIEN_CONE_KIND, ALIEN_CONE_WAVE_LIFE_S } from './gpu/AlienConeShader';
import type { EnemySectorAttack } from './EnemyClawRenderer';
import type { EnergyConeAttack } from '../systems/EnergyConeState';

/** Shared enemy-attack danger zone (the same red family as claws and the shield charge lane). */
export type EnergyConeSectorSink = (id: string, attack: EnemySectorAttack | null, now: number, visible: boolean) => void;

/** Muzzle socket in front of the alien body where the charge gathers. */
const MUZZLE_PX = 18;
/** The danger zone hardens shortly before the impulse, like a claw strike. */
const STRIKE_LEAD_MS = 160;
const ALLIED_LIGHT = 0x8affcf;

interface Wave { readonly attack: EnergyConeAttack; readonly allied: boolean; readonly seed: number; readonly key: string }

let nextRendererId = 0;
const seedOf = (key: string): number => {
  let h = 2166136261;
  for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 997) / 997;
};
const attackIdOf = (enemyId: string, attack: EnergyConeAttack): string => `energy-cone:${enemyId}:${attack.startedAt}`;

/**
 * Scene lifetime. Presents the alien energy cone from the replicated host state only: the hostile
 * windup goes to the shared red danger zone (clipped by the cover profile), the charge gathers at
 * the muzzle, and from `hitAt` a void wavefront races to the clipped reach and dissolves. Late
 * observers see the remaining phase; a cancelled windup never produces a wave.
 */
export class AlienConeRenderer {
  private readonly layer: AlienConeGpuLayer;
  private readonly waves = new Map<string, Wave>();
  private readonly sunk = new Set<string>();
  private readonly lightKeys = new Set<string>();
  private readonly lightPrefix = `alien-cone-${nextRendererId++}-`;
  private enemies: () => readonly EnemyVisualSource[] = () => [];
  private clock: () => number = () => this.scene.time.now;
  private lighting: LightingSystem | null = null;
  private gpuVfx: GpuVfxSystem | null = null;
  private cameraFeedback: CameraFeedbackController | null = null;
  private sectorSink: EnergyConeSectorSink | null = null;

  constructor(private readonly scene: Phaser.Scene) {
    this.layer = new AlienConeGpuLayer(scene);
    scene.events.on(Phaser.Scenes.Events.PRE_RENDER, this.render, this);
  }

  setEnemySource(source: () => readonly EnemyVisualSource[]): void { this.enemies = source; }
  /** Host-synchronised time: cone timestamps are host timestamps. */
  setClock(clock: () => number): void { this.clock = clock; }
  setLightingSystem(lighting: LightingSystem | null): void { this.lighting = lighting; }
  registerGpuVfx(system: GpuVfxSystem): void { this.gpuVfx = system; }
  setCameraFeedback(controller: CameraFeedbackController | null): void { this.cameraFeedback = controller; }
  /** Hostile windups are drawn by the shared enemy danger-zone renderer. */
  setSectorSink(sink: EnergyConeSectorSink | null): void { this.sectorSink = sink; }

  clear(): void {
    for (const id of this.sunk) this.sectorSink?.(id, null, this.clock(), false);
    this.sunk.clear(); this.waves.clear();
    this.layer.clear(); this.releaseLights(new Set());
  }

  destroy(): void {
    this.scene.events.off(Phaser.Scenes.Events.PRE_RENDER, this.render, this);
    this.clear(); this.layer.destroy();
  }

  private render(): void {
    const now = this.clock();
    const view = getVisibleWorldView(this.scene.cameras.main);
    const visible = (attack: EnergyConeAttack): boolean => {
      const m = attack.range + 60;
      return attack.originX + m >= view.x && attack.originX - m <= view.x + view.width
        && attack.originY + m >= view.y && attack.originY - m <= view.y + view.height;
    };
    const suppressed = this.gpuVfx?.isSuppressed() ?? false;
    const lightLimit = getGraphicsQualityProfile(this.scene).level === 'low' ? 3 : 8;
    const lights = new Set<string>();
    const light = (key: string, x: number, y: number, radiusPx: number, color: number, intensity: number): void => {
      if (lights.size >= lightLimit || intensity <= 0.01) return;
      lights.add(key);
      this.lighting?.setLight(this.lightPrefix + key, 'explosion', x, y, { radiusPx, color, intensity, occludes: false });
    };
    this.layer.begin(this.scene.time.now);

    const live = new Set<string>();
    const sunkNow = new Set<string>();
    for (const enemy of this.enemies()) {
      const state = enemy.getNetSnapshot().energyCone;
      if (!state || !enemy.sprite.active) continue;
      live.add(enemy.id);
      const allied = enemy.faction === 'allied';
      const attack = state.attack;
      if (!attack) continue;
      const key = attackIdOf(enemy.id, attack);
      const impulsed = state.phase === 'recover' || (state.phase === 'windup' && now >= attack.hitAt);
      if (impulsed && now < attack.hitAt + ALIEN_CONE_WAVE_LIFE_S * 1000 && !this.waves.has(key)) {
        this.waves.set(key, { attack, allied, seed: seedOf(key), key });
        // A small, local nudge only: regular cone attacks must not disturb aiming.
        if (!allied && visible(attack)) this.cameraFeedback?.request({ channel: 'impact', amplitudePx: 1.2, durationMs: 110,
          priority: 25, decay: 'impulse', sourceX: attack.originX, sourceY: attack.originY, falloffPx: 520 });
      }
      if (state.phase !== 'windup' || now >= attack.hitAt) continue;
      const shown = visible(attack) && !suppressed;
      const progress = Phaser.Math.Clamp((now - attack.startedAt) / Math.max(1, attack.hitAt - attack.startedAt), 0, 1);
      if (!allied && this.sectorSink) {
        this.sectorSink(enemy.id, { attackId: key, x: attack.originX, y: attack.originY, angle: attack.angle,
          range: attack.range, arcDegrees: attack.arcDegrees, clip: attack.clip, startedAt: attack.startedAt,
          strikeAt: Math.max(attack.startedAt, attack.hitAt - STRIKE_LEAD_MS), hitAt: attack.hitAt,
          endsAt: attack.recoverUntil }, now, shown);
        sunkNow.add(enemy.id);
      }
      if (!shown) continue;
      const base = { originX: attack.originX, originY: attack.originY, angle: attack.angle, range: attack.range,
        halfArc: attack.arcDegrees * Math.PI / 360, seed: seedOf(key), allied, muzzlePx: MUZZLE_PX, clip: attack.clip };
      if (allied) this.layer.add({ ...base, kind: ALIEN_CONE_KIND.quiet, t: progress, intensity: 0.6 });
      this.layer.add({ ...base, kind: ALIEN_CONE_KIND.charge, t: progress, intensity: allied ? 0.55 : 1 });
      const mx = attack.originX + Math.cos(attack.angle) * MUZZLE_PX, my = attack.originY + Math.sin(attack.angle) * MUZZLE_PX;
      light(`charge-${enemy.id}`, mx, my, 40 + 50 * progress, allied ? ALLIED_LIGHT : VOID_PALETTE.primary,
        (allied ? 0.12 : 0.2) + 0.35 * progress * progress);
    }
    // Windups that ended (impulse, cancel, death, removal) release their danger zone.
    for (const id of this.sunk) if (!sunkNow.has(id)) this.sectorSink?.(id, null, now, false);
    this.sunk.clear(); for (const id of sunkNow) this.sunk.add(id);

    for (const [key, wave] of this.waves) {
      const t = (now - wave.attack.hitAt) / 1000;
      if (t >= ALIEN_CONE_WAVE_LIFE_S || t < 0) { if (t >= ALIEN_CONE_WAVE_LIFE_S) this.waves.delete(key); continue; }
      if (suppressed || !visible(wave.attack)) continue;
      const a = wave.attack;
      this.layer.add({ originX: a.originX, originY: a.originY, angle: a.angle, range: a.range,
        halfArc: a.arcDegrees * Math.PI / 360, kind: ALIEN_CONE_KIND.wave, t, seed: wave.seed, allied: wave.allied,
        intensity: wave.allied ? 0.7 : 1, muzzlePx: MUZZLE_PX, clip: a.clip });
      const decay = 1 - t / ALIEN_CONE_WAVE_LIFE_S;
      light(`wave-${key}`, a.originX + Math.cos(a.angle) * a.range * 0.45, a.originY + Math.sin(a.angle) * a.range * 0.45,
        a.range * 0.75, wave.allied ? ALLIED_LIGHT : VOID_PALETTE.bright, 0.7 * decay * decay);
    }
    this.layer.flush();
    this.releaseLights(lights);
  }

  private releaseLights(keep: Set<string>): void {
    for (const key of this.lightKeys) if (!keep.has(key)) this.lighting?.releaseLight(this.lightPrefix + key);
    this.lightKeys.clear(); for (const key of keep) this.lightKeys.add(key);
  }
}
