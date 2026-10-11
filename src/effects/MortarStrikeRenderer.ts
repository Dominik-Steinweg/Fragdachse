import * as Phaser from 'phaser';
import { ALLIED_PALETTE, DEPTH, VOID_PALETTE } from '../config';
import type { SyncedMortarStrike } from '../types';
import { getClarityCameraRegistry, promoteToClarityCamera } from '../scenes/arena/ClarityCameraRegistry';
import { getVisibleWorldView, getArrowPointOnScreenViewEdge } from '../ui/HostileBaseIndicator';
import { clusterEdgeMarkers, type EdgeMarkerCandidate } from './coopDefenseSecondaryObjectiveEdgeMarkers';
import type { CameraFeedbackController } from './camera/CameraFeedbackController';
import type { GpuVfxSystem } from './gpu/GpuVfxSystem';
import { MortarMuzzleVfx } from './MortarMuzzleVfx';
import { MortarStrikePresentationTimeline, isMortarSourceOffscreen, mortarEdgePointForClarity } from './mortarStrikeVisualModel';
import { ensureMortarStrikeTextures, MORTAR_TEXTURE, MORTAR_FRAME, MORTAR_PROGRESS_STEPS, MORTAR_RING_RADIUS } from './mortarStrikeTextures';

interface MortarVisual {
  marker: Phaser.GameObjects.Image; shade: Phaser.GameObjects.Image; shadow: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image; core: Phaser.GameObjects.Image; shell: Phaser.GameObjects.Image;
  wave: Phaser.GameObjects.Image; contraction: Phaser.GameObjects.Image; shadowRim: Phaser.GameObjects.Image; chargeSource: number; nextSparkAt: number;
}
export interface MortarStrikeAudioPort { thump(x: number, y: number, faction: SyncedMortarStrike['faction']): void }

/** Scene lifetime. Snapshots own anticipation; only the explosion RPC owns impact.
 * Baked images batch by depth/texture; transient particles use shared GPU lanes. */
export class MortarStrikeRenderer {
  private readonly timeline = new MortarStrikePresentationTimeline();
  private readonly visuals = new Map<number, MortarVisual>();
  private readonly arrows: Phaser.GameObjects.Image[] = [];
  private muzzle: MortarMuzzleVfx | null = null;
  private cameraFeedback: CameraFeedbackController | null = null;
  private audio: MortarStrikeAudioPort | null = null;

  constructor(private readonly scene: Phaser.Scene) {
    ensureMortarStrikeTextures(scene);
    for (let i = 0; i < 8; i++) {
      const arrow = scene.add.image(0, 0, MORTAR_TEXTURE, MORTAR_FRAME.arrow)
        .setDepth(DEPTH.OVERLAY).setScrollFactor(0).setTint(VOID_PALETTE.bright).setVisible(false);
      promoteToClarityCamera(scene, arrow); this.arrows.push(arrow);
    }
  }
  registerGpuVfx(system: GpuVfxSystem): void { this.clear(); this.muzzle = new MortarMuzzleVfx(system); }
  setCameraFeedback(controller: CameraFeedbackController | null): void { this.cameraFeedback = controller; }
  setAudioPort(port: MortarStrikeAudioPort | null): void { this.audio = port; }

  private createVisual(): MortarVisual {
    const marker = this.scene.add.image(0, 0, MORTAR_TEXTURE, 0).setDepth(19.8);
    const shade = this.scene.add.image(0, 0, MORTAR_TEXTURE, MORTAR_FRAME.shade).setDepth(5.1).setTint(0x08090e);
    const shadow = this.scene.add.image(0, 0, MORTAR_TEXTURE, MORTAR_FRAME.shadow).setDepth(5.1).setTint(0x010104);
    const glow = this.scene.add.image(0, 0, MORTAR_TEXTURE, MORTAR_FRAME.glow).setDepth(19.7).setBlendMode(Phaser.BlendModes.ADD);
    const core = this.scene.add.image(0, 0, MORTAR_TEXTURE, MORTAR_FRAME.glow).setDepth(19.7).setBlendMode(Phaser.BlendModes.ADD);
    const wave = this.scene.add.image(0, 0, MORTAR_TEXTURE, MORTAR_FRAME.wave).setDepth(19.7).setBlendMode(Phaser.BlendModes.ADD);
    const contraction = this.scene.add.image(0, 0, MORTAR_TEXTURE, MORTAR_FRAME.contraction).setDepth(19.8);
    const shadowRim = this.scene.add.image(0, 0, MORTAR_TEXTURE, MORTAR_FRAME.shadowRim).setDepth(19.8);
    const shell = this.scene.add.image(0, 0, MORTAR_TEXTURE, MORTAR_FRAME.shell).setDepth(13.39);
    return { marker, shade, shadow, glow, core, wave, shell, contraction, shadowRim, chargeSource: this.muzzle?.createCharge() ?? -1, nextSparkAt: 0 };
  }

  sync(strikes: readonly SyncedMortarStrike[], nowMs: number): void {
    this.muzzle?.update();
    const camera = this.scene.cameras.main, view = getVisibleWorldView(camera);
    const clarity = getClarityCameraRegistry(this.scene)?.getClarityCamera() ?? camera;
    const active = new Set<number>(), edges: EdgeMarkerCandidate[] = [];
    const edgePulses: number[] = [];
    // The snapshot/host has no visual budget. Admission limits only this local presentation.
    for (const sample of this.timeline.sample(strikes, nowMs).slice(0, 64)) {
      const { strike, windup, flight, pulse, launchAgeMs, thump, showLaunch } = sample;
      const loading = sample.phase === 'windup';
      const palette = strike.faction === 'allied' ? ALLIED_PALETTE : VOID_PALETTE;
      active.add(strike.id);
      let visual = this.visuals.get(strike.id);
      if (!visual) { visual = this.createVisual(); this.visuals.set(strike.id, visual); }
      // The host has already resolved the asset socket into this captured world point.
      const sx = strike.sourceX, sy = strike.sourceY;
      const fastPulse = 0.5 + 0.5 * Math.sin(flight * Math.PI * 10);
      visual.marker.setFrame(loading ? Math.floor(windup * MORTAR_PROGRESS_STEPS) : MORTAR_FRAME.committed)
        .setPosition(strike.targetX, strike.targetY).setScale(strike.radius / MORTAR_RING_RADIUS)
        .setTint(loading ? palette.bright : palette.core).setAlpha(loading ? 0.9 + pulse * 0.1 : 0.88 + fastPulse * 0.12);
      visual.shade.setPosition(strike.targetX, strike.targetY).setScale(strike.radius / MORTAR_RING_RADIUS)
        .setAlpha(loading ? 0.14 + windup * 0.12 : 0.3);
      visual.contraction.setPosition(strike.targetX, strike.targetY).setVisible(!loading)
        .setTint(palette.bright).setScale(strike.radius * (0.94 - 0.84 * flight) / MORTAR_RING_RADIUS)
        .setAlpha(0.3 + fastPulse * 0.18);
      const shadowRadius = strike.radius * (0.08 + 0.36 * flight);
      visual.shadowRim.setPosition(strike.targetX, strike.targetY).setVisible(!loading)
        .setTint(palette.bright).setScale(shadowRadius / MORTAR_RING_RADIUS).setAlpha(0.2 + flight * 0.3);
      visual.shadow.setPosition(strike.targetX, strike.targetY).setVisible(!loading)
        .setScale(shadowRadius / MORTAR_RING_RADIUS).setAlpha(0.8 + flight * 0.18);
      const flash = showLaunch && !loading && launchAgeMs < 180 ? (1 - launchAgeMs / 180) ** 2 : 0;
      visual.glow.setPosition(sx, sy).setTint(palette.primary)
        .setScale(loading ? (24 + 20 * windup) / 80 : (58 + launchAgeMs * 0.06) / 80)
        .setAlpha(loading ? 0.15 + windup ** 2 * (0.45 + pulse * 0.3) : flash * 0.95);
      visual.core.setPosition(sx, sy).setTint(palette.core).setScale(loading ? (4 + windup * 8) / 80 : 0.32)
        .setAlpha(loading ? windup * (0.2 + pulse * 0.45) : flash);
      visual.wave.setPosition(sx, sy).setTint(palette.bright).setVisible(showLaunch && !loading && launchAgeMs < 300)
        .setScale((12 + Math.max(0, launchAgeMs) * 0.18) / 80).setAlpha(0.8 * Math.max(0, 1 - launchAgeMs / 300));
      const rising = showLaunch && !loading && launchAgeMs < 170;
      const falling = !loading && flight >= 0.75;
      visual.shell.setVisible(rising || falling).setTint(palette.bright).setRotation(-0.35)
        .setPosition(rising ? sx : strike.targetX, rising ? sy : strike.targetY)
        // Overhead altitude cue only. Never interpolate source-to-target across the world.
        .setScale(rising ? 1 - launchAgeMs / 190 : 3.1 - Math.max(0, (flight - 0.75) / 0.25) * 1.55)
        .setAlpha(rising ? 1 - launchAgeMs / 170 : Math.min(1, (flight - 0.75) * 16));
      if (loading && nowMs >= visual.nextSparkAt) {
        this.muzzle?.chargeAt(visual.chargeSource, sx, sy, windup, palette.bright);
        visual.nextSparkAt = nowMs + 130 - windup * 95;
      } else if (!loading && visual.chargeSource >= 0) {
        this.muzzle?.release(visual.chargeSource); visual.chargeSource = -1;
      }
      if (thump) {
        this.muzzle?.thump(sx, sy, palette.bright, palette.deep, Math.max(0, launchAgeMs));
        this.audio?.thump(sx, sy, strike.faction);
        if (sx >= view.x && sx <= view.x + view.width && sy >= view.y && sy <= view.y + view.height)
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

  private remove(visual: MortarVisual): void {
    this.muzzle?.release(visual.chargeSource);
    for (const object of [visual.marker, visual.shade, visual.shadow, visual.glow, visual.core, visual.shell, visual.wave, visual.contraction, visual.shadowRim]) object.destroy();
  }
  clear(): void {
    for (const visual of this.visuals.values()) this.remove(visual);
    this.visuals.clear(); this.timeline.clear(); this.muzzle?.clear();
    for (const arrow of this.arrows) arrow.setVisible(false);
  }
  destroy(): void { this.clear(); for (const arrow of this.arrows) arrow.destroy(); this.scene.textures.remove(MORTAR_TEXTURE); }
}
