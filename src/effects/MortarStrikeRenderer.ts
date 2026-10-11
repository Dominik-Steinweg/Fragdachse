import * as Phaser from 'phaser';
import { ALLIED_COLOR, ALLIED_PALETTE, DEPTH, VOID_PALETTE } from '../config';
import type { SyncedMortarStrike } from '../types';
import { getClarityCameraRegistry, promoteToClarityCamera } from '../scenes/arena/ClarityCameraRegistry';
import { getVisibleWorldView, getArrowPointOnScreenViewEdge } from '../ui/HostileBaseIndicator';
import { getGraphicsQualityProfile } from '../graphics/GraphicsQuality';
import { clusterEdgeMarkers, type EdgeMarkerCandidate } from './coopDefenseSecondaryObjectiveEdgeMarkers';
import type { CameraFeedbackController } from './camera/CameraFeedbackController';
import { CAMERA_FEEDBACK_PRIORITY } from './camera/cameraFeedbackPresets';
import type { ExplosionGpuRenderer } from './ExplosionGpuRenderer';
import type { LightingSystem } from './LightingSystem';
import type { GpuVfxSystem } from './gpu/GpuVfxSystem';
import { MortarGpuLayer } from './gpu/MortarGpuLayer';
import { MortarMuzzleVfx } from './MortarMuzzleVfx';
import { MortarStrikePresentationTimeline, isMortarSourceOffscreen, mortarEdgePointForClarity } from './mortarStrikeVisualModel';
import { ensureMortarStrikeTextures, MORTAR_TEXTURE, MORTAR_FRAME } from './mortarStrikeTextures';

/** Source-side accents only; the whole target area is drawn by the batched GPU layer. */
interface MortarSourceVisual {
  glow: Phaser.GameObjects.Image; core: Phaser.GameObjects.Image; wave: Phaser.GameObjects.Image;
  chargeSource: number; nextSparkAt: number;
}
interface MortarImpactVisual { x: number; y: number; radius: number; allied: boolean; born: number; seed: number }
export interface MortarStrikeAudioPort { thump(x: number, y: number, faction: SyncedMortarStrike['faction']): void }

const IMPACT_LIFETIME_S = 6;
let nextRendererId = 0;
const strikeSeed = (id: number) => (Math.imul(id + 1, 2654435761) >>> 0) % 997;

/** Scene lifetime. Snapshots own anticipation; only the explosion RPC owns impact.
 * Target telegraph, drop shadow, shell, crater and smoke are four GPU draws for all strikes. */
export class MortarStrikeRenderer {
  private readonly timeline = new MortarStrikePresentationTimeline();
  private readonly layer: MortarGpuLayer;
  private readonly visuals = new Map<number, MortarSourceVisual>();
  private readonly impacts: MortarImpactVisual[] = [];
  private readonly arrows: Phaser.GameObjects.Image[] = [];
  private readonly lightKeys = new Set<string>();
  private readonly lightPrefix = `mortar-${nextRendererId++}-`;
  private impactSequence = 0;
  private muzzle: MortarMuzzleVfx | null = null;
  private gpuVfx: GpuVfxSystem | null = null;
  private explosion: ExplosionGpuRenderer | null = null;
  private lighting: LightingSystem | null = null;
  private cameraFeedback: CameraFeedbackController | null = null;
  private audio: MortarStrikeAudioPort | null = null;

  constructor(private readonly scene: Phaser.Scene) {
    ensureMortarStrikeTextures(scene);
    this.layer = new MortarGpuLayer(scene);
    for (let i = 0; i < 8; i++) {
      const arrow = scene.add.image(0, 0, MORTAR_TEXTURE, MORTAR_FRAME.arrow)
        .setDepth(DEPTH.OVERLAY).setScrollFactor(0).setTint(VOID_PALETTE.bright).setVisible(false);
      promoteToClarityCamera(scene, arrow); this.arrows.push(arrow);
    }
  }
  registerGpuVfx(system: GpuVfxSystem): void { this.clear(); this.gpuVfx = system; this.muzzle = new MortarMuzzleVfx(system); }
  setImpactSystems(explosion: ExplosionGpuRenderer, lighting: LightingSystem): void {
    this.explosion = explosion; this.lighting = lighting;
  }
  setCameraFeedback(controller: CameraFeedbackController | null): void { this.cameraFeedback = controller; }
  setAudioPort(port: MortarStrikeAudioPort | null): void { this.audio = port; }

  /** Called once by the reliable explosion presentation event (host and clients alike).
   * The shared combat burst comes from EffectSystem; this adds crater, dust, embers and ejecta. */
  playImpact(x: number, y: number, radius: number, color?: number): void {
    if (this.gpuVfx?.isSuppressed() || radius <= 0) return;
    const allied = color === ALLIED_COLOR;
    if (this.impacts.length === 32) this.impacts.shift();
    this.impacts.push({ x, y, radius, allied, born: this.scene.time.now, seed: (++this.impactSequence * 37) % 997 });
    this.explosion?.spawnMeteorDebris(x, y, radius * 0.8, 'void', allied ? ALLIED_PALETTE.bright : VOID_PALETTE.bright);
    this.cameraFeedback?.request({ channel: 'impact', amplitudePx: 3.2, durationMs: 220,
      priority: CAMERA_FEEDBACK_PRIORITY.mediumImpact, decay: 'impulse', sourceX: x, sourceY: y, falloffPx: 650 });
  }

  private createVisual(): MortarSourceVisual {
    const glow = this.scene.add.image(0, 0, MORTAR_TEXTURE, MORTAR_FRAME.glow).setDepth(19.7).setBlendMode(Phaser.BlendModes.ADD);
    const core = this.scene.add.image(0, 0, MORTAR_TEXTURE, MORTAR_FRAME.glow).setDepth(19.7).setBlendMode(Phaser.BlendModes.ADD);
    const wave = this.scene.add.image(0, 0, MORTAR_TEXTURE, MORTAR_FRAME.wave).setDepth(19.7).setBlendMode(Phaser.BlendModes.ADD);
    return { glow, core, wave, chargeSource: this.muzzle?.createCharge() ?? -1, nextSparkAt: 0 };
  }

  /** `nowMs` must be host-synchronized time: strike timestamps are host timestamps. */
  sync(strikes: readonly SyncedMortarStrike[], nowMs: number): void {
    this.muzzle?.update();
    const camera = this.scene.cameras.main, view = getVisibleWorldView(camera);
    const clarity = getClarityCameraRegistry(this.scene)?.getClarityCamera() ?? camera;
    const visible = (x: number, y: number, reach: number) => x + reach >= view.x && x - reach <= view.x + view.width
      && y + reach >= view.y && y - reach <= view.y + view.height;
    const suppressed = this.gpuVfx?.isSuppressed() ?? false;
    const lightLimit = getGraphicsQualityProfile(this.scene).level === 'low' ? 3 : 8;
    const nextLights = new Set<string>();
    const active = new Set<number>(), edges: EdgeMarkerCandidate[] = [];
    const edgePulses: number[] = [];
    this.layer.begin(this.scene.time.now);
    // Impacts first: the real result keeps its batch space ahead of decorative anticipation.
    for (let i = this.impacts.length - 1; i >= 0; i--) {
      const impact = this.impacts[i], age = (this.scene.time.now - impact.born) / 1000;
      if (age >= IMPACT_LIFETIME_S) { this.impacts.splice(i, 1); continue; }
      if (suppressed || !visible(impact.x, impact.y, impact.radius * 2.1)) continue;
      this.layer.add({ x: impact.x, y: impact.y, radius: impact.radius, timeline: 2, seed: impact.seed, allied: impact.allied, age });
      if (age < 2.4 && nextLights.size < lightLimit) {
        const key = `${this.lightPrefix}impact-${impact.seed}`;
        nextLights.add(key);
        this.lighting?.setLight(key, 'explosion', impact.x, impact.y, { radiusPx: impact.radius * 1.2,
          color: impact.allied ? ALLIED_PALETTE.primary : VOID_PALETTE.primary, intensity: 0.34 * (1 - age / 2.4), occludes: false });
      }
    }
    // The snapshot/host has no visual budget. Admission limits only this local presentation.
    for (const sample of this.timeline.sample(strikes, nowMs).slice(0, 64)) {
      const { strike, windup, flight, pulse, launchAgeMs, thump, showLaunch } = sample;
      const loading = sample.phase === 'windup';
      const allied = strike.faction === 'allied';
      const palette = allied ? ALLIED_PALETTE : VOID_PALETTE;
      active.add(strike.id);
      if (!suppressed && visible(strike.targetX, strike.targetY, strike.radius * 1.8)) {
        this.layer.add({ x: strike.targetX, y: strike.targetY, radius: strike.radius,
          timeline: loading ? windup : 1 + flight, seed: strikeSeed(strike.id), allied, age: -1 });
        if (!loading && nextLights.size < lightLimit) {
          const key = `${this.lightPrefix}strike-${strike.id}`;
          nextLights.add(key);
          this.lighting?.setLight(key, 'explosion', strike.targetX, strike.targetY, { radiusPx: strike.radius * (1.15 - 0.5 * flight),
            color: palette.primary, intensity: 0.06 + 0.24 * flight * flight, occludes: false });
        }
      }
      let visual = this.visuals.get(strike.id);
      if (!visual) { visual = this.createVisual(); this.visuals.set(strike.id, visual); }
      // The host has already resolved the asset socket into this captured world point.
      const sx = strike.sourceX, sy = strike.sourceY;
      const flash = showLaunch && !loading && launchAgeMs < 180 ? (1 - launchAgeMs / 180) ** 2 : 0;
      visual.glow.setPosition(sx, sy).setTint(palette.primary)
        .setScale(loading ? (24 + 20 * windup) / 80 : (58 + launchAgeMs * 0.06) / 80)
        .setAlpha(loading ? 0.15 + windup ** 2 * (0.45 + pulse * 0.3) : flash * 0.95);
      visual.core.setPosition(sx, sy).setTint(palette.core).setScale(loading ? (4 + windup * 8) / 80 : 0.32)
        .setAlpha(loading ? windup * (0.2 + pulse * 0.45) : flash);
      visual.wave.setPosition(sx, sy).setTint(palette.bright).setVisible(showLaunch && !loading && launchAgeMs < 300)
        .setScale((12 + Math.max(0, launchAgeMs) * 0.18) / 80).setAlpha(0.8 * Math.max(0, 1 - launchAgeMs / 300));
      if (loading && nowMs >= visual.nextSparkAt) {
        this.muzzle?.chargeAt(visual.chargeSource, sx, sy, windup, palette.bright);
        visual.nextSparkAt = nowMs + 130 - windup * 95;
      } else if (!loading && visual.chargeSource >= 0) {
        this.muzzle?.release(visual.chargeSource); visual.chargeSource = -1;
      }
      if (thump) {
        this.muzzle?.thump(sx, sy, palette.bright, palette.deep, Math.max(0, launchAgeMs));
        this.audio?.thump(sx, sy, strike.faction);
        if (visible(sx, sy, 0))
          this.cameraFeedback?.request({ channel: 'impact', amplitudePx: 2.2, durationMs: 140, priority: 40,
            sourceX: sx, sourceY: sy, falloffPx: 550, decay: 'impulse' });
      }
      if (isMortarSourceOffscreen(strike, nowMs, view)) {
        const projected = getArrowPointOnScreenViewEdge(sx, sy, view, camera, 48);
        const point = mortarEdgePointForClarity(projected, { x: camera.zoomX, y: camera.zoomY },
          { x: clarity.zoomX, y: clarity.zoomY });
        const distancePx = Math.hypot(sx - view.centerX, sy - view.centerY);
        edges.push({ screenX: point.x, screenY: point.y, angle: Math.atan2(sy - view.centerY, sx - view.centerX),
          distancePx, category: 'mortar-windup' });
        edgePulses.push(0.65 + pulse * 0.35);
      }
    }
    this.layer.flush();
    for (const key of this.lightKeys) if (!nextLights.has(key)) this.lighting?.releaseLight(key, { immediate: true });
    this.lightKeys.clear(); for (const key of nextLights) this.lightKeys.add(key);
    for (const [id, visual] of this.visuals) if (!active.has(id)) { this.remove(visual); this.visuals.delete(id); }
    const clusters = clusterEdgeMarkers(edges, 48, this.arrows.length);
    this.arrows.forEach((arrow, i) => {
      const edge = clusters[i]; arrow.setVisible(!!edge);
      if (edge) {
        // The cluster represents its first nearest source. Equal distances on different
        // edges must not borrow each other's charge pulse.
        const source = edges.findIndex(candidate => candidate.screenX === edge.screenX
          && candidate.screenY === edge.screenY && candidate.distancePx === edge.distancePx);
        arrow.setPosition(edge.screenX, edge.screenY).setRotation(edge.angle)
          .setAlpha(edgePulses[source] ?? 1).setScale(1.5 + (edgePulses[source] ?? 1) * 0.12);
      }
    });
  }

  private remove(visual: MortarSourceVisual): void {
    this.muzzle?.release(visual.chargeSource);
    for (const object of [visual.glow, visual.core, visual.wave]) object.destroy();
  }
  clear(): void {
    for (const visual of this.visuals.values()) this.remove(visual);
    this.visuals.clear(); this.timeline.clear(); this.muzzle?.clear();
    this.impacts.length = 0; this.layer.clear();
    for (const key of this.lightKeys) this.lighting?.releaseLight(key, { immediate: true });
    this.lightKeys.clear();
    for (const arrow of this.arrows) arrow.setVisible(false);
  }
  destroy(): void {
    this.clear(); this.layer.destroy();
    for (const arrow of this.arrows) arrow.destroy();
    this.scene.textures.remove(MORTAR_TEXTURE);
  }
}
