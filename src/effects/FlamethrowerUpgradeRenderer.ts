import * as Phaser from 'phaser';
import { GroundHazardWarningRenderer } from './GroundHazardWarningRenderer';
import { DEPTH } from '../config';
import { getGraphicsQualityProfile } from '../graphics/GraphicsQuality';
import type { OwnerVisualSource } from '../entities/OwnerVisualSource';
import type { FireChunkFlight, GroundFireVisualStyle, PlayerNetState, SyncedBurningGroundSnapshot } from '../types';
import { registerGraphicsObject } from './EffectUtils';
import { getEmissiveScale } from './EmissiveScale';
import {
  ensureFlameTextures,
  ensureVoidFlameTextures,
  FLAME_COLORS_OUTER,
  TEX_FLAME_EMBER,
  TEX_VOID_FLAME_EMBER,
  VOID_FLAME_COLORS_OUTER,
} from './FlameShared';
import { FLAME_RING_FRAGMENT_SOURCE, FLAME_RING_OUTER_REACH, FLAME_RING_SHADER_NAME } from './flameRingShader';
import { GroundFireClusterRenderer } from './GroundFireClusterRenderer';
import type { GpuVfxSystem } from './gpu/GpuVfxSystem';
import type { LightingSystem } from './LightingSystem';

const RING_DEPTH = DEPTH.FIRE + 0.12;
/** Halbe Trefferbreite des Rings (`player.fire.ring.thickness` = 16 je Stufe). */
const RING_BAND_HALF_THICKNESS = 8;
const RING_IGNITE_MS = 420;
const RING_FADE_OUT_MS = 320;
const RING_TIME_WRAP_S = 240;
/** Bogenlänge je Glutfunken-Zelle; hält die Funkendichte bei wachsendem Radius konstant. */
const RING_EMBER_SPACING = 15;
const RING_DETAIL = { high: 2, medium: 1, low: 0 } as const;
/**
 * Der Flammenring leuchtet dort, wo das Feuer brennt – am Ring, nicht im Zentrum. Statt
 * eines großen Lichts am Spieler verteilen sich mehrere kleine Lichter auf der
 * Ringlinie; ihr Radius überlappt gerade so, dass die Linie durchgehend glüht.
 */
const RING_LIGHT_COUNT = 12;
const TWO_PI = Math.PI * 2;

interface RingUniforms {
  time: number;
  ignite: number;
  fade: number;
  pixelSize: number;
  detail: number;
  emission: number;
  radius: number;
  size: number;
}

interface RingVisual {
  phase: number;
  quad: Phaser.GameObjects.Shader;
  bornAt: number;
  /** Szenenzeit, ab der der Ring erlischt; `null`, solange er repliziert wird. */
  fadingSince: number | null;
  uniforms: RingUniforms;
}

/**
 * Gemeinsamer Renderer fuer das 16-Pixel-Brandraster und Flammenringe.
 * GroundFire wird als zusammenhaengende Clusterflaeche aus gepoolten GPUFX-Flows
 * visualisiert; jeder Flammenring ist ein einzelnes prozedurales Shader-Quad.
 */
export class FlamethrowerUpgradeRenderer {
  private readonly groundWarning: GroundHazardWarningRenderer;
  private readonly groundFire: GroundFireClusterRenderer;
  private readonly flyingChunks = new Set<Phaser.GameObjects.Image>();
  private readonly chunkTweens = new Map<Phaser.GameObjects.Image, Phaser.Tweens.Tween>();
  private readonly ringRadii = new Map<string, number>();
  private readonly ringVisuals = new Map<string, RingVisual>();
  private lastUpdateMs = 0;
  private performanceMetricsEnabled = false;
  private lighting: LightingSystem | null = null;
  private nextChunkLightId = 0;
  private readonly activeChunkLightKeys = new Set<string>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly owners: OwnerVisualSource,
  ) {
    ensureFlameTextures(scene);
    ensureVoidFlameTextures(scene);
    this.groundFire = new GroundFireClusterRenderer();
    this.groundWarning = new GroundHazardWarningRenderer(scene);
  }

  /** Meldet den GroundFire-Clusterrenderer beim szenenweiten GPUFX-Backend an. */
  registerGpuVfx(system: GpuVfxSystem): void {
    this.groundFire.registerGpuVfx(system);
  }

  syncGround(snapshot: SyncedBurningGroundSnapshot, now = Date.now()): void {
    this.groundWarning.sync(snapshot.warnings, now);
    this.groundFire.syncGround(snapshot, now);
  }

  playFireChunkBurst(
    x: number,
    y: number,
    targets: readonly FireChunkFlight[],
    startedAt: number,
    now = Date.now(),
    visualStyle: GroundFireVisualStyle = 'normal',
  ): void {
    for (const target of targets) {
      if (target.landsAt <= now) continue;
      const duration = target.landsAt - now;
      const startProgress = Math.max(0, Math.min(1, (now - startedAt) / Math.max(1, target.landsAt - startedAt)));
      // Ein Follow-Light je fliegendem Brocken; freigegeben beim Aufschlag.
      const lightKey = `firechunk:${this.nextChunkLightId++}`;
      this.activeChunkLightKeys.add(lightKey);
      const isVoid = visualStyle === 'void';
      const chunk = this.scene.add.image(x, y, isVoid ? TEX_VOID_FLAME_EMBER : TEX_FLAME_EMBER)
        .setDepth(DEPTH.PROJECTILES + 0.4)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(Phaser.Utils.Array.GetRandom([
          ...(isVoid ? VOID_FLAME_COLORS_OUTER : FLAME_COLORS_OUTER),
        ]))
        .setScale(0.72);
      this.flyingChunks.add(chunk);
      const arc = Phaser.Math.Between(22, 46);
      chunk.setPosition(Phaser.Math.Linear(x, target.x, startProgress),
        Phaser.Math.Linear(y, target.y, startProgress) - Math.sin(startProgress * Math.PI) * arc);
      const flightTween = this.scene.tweens.addCounter({
        from: startProgress,
        to: 1,
        duration,
        ease: 'Linear',
        onUpdate: tween => {
          if (!chunk.active) return;
          const t = tween.getValue() ?? 0;
          chunk.setPosition(
            Phaser.Math.Linear(x, target.x, t),
            Phaser.Math.Linear(y, target.y, t) - Math.sin(t * Math.PI) * arc,
          );
          chunk.setRotation(t * Math.PI * 4);
          chunk.setScale(0.72 + Math.sin(t * Math.PI) * 0.28);
          this.lighting?.setLight(lightKey, isVoid ? 'voidFireChunk' : 'fireChunk', chunk.x, chunk.y);
        },
        onComplete: () => {
          const shouldLand = chunk.active;
          this.flyingChunks.delete(chunk);
          this.chunkTweens.delete(chunk);
          this.activeChunkLightKeys.delete(lightKey);
          this.lighting?.releaseLight(lightKey);
          chunk.destroy();
          if (!shouldLand) return;
          this.lighting?.pulse(isVoid ? 'voidFireChunkImpact' : 'fireChunkImpact', target.x, target.y);
          // Der Einschlag benutzt dieselben Bodenfeuer-Effekte, entsteht aber ausserhalb des
          // Emissions-Ticks: die Partikeluhr steht noch auf dem Stand des Vorframes.
          this.groundFire.spawnImpact(target.x, target.y, visualStyle);
        },
      });
      this.chunkTweens.set(chunk, flightTween);
    }
  }

  syncRings(players: Readonly<Record<string, PlayerNetState>>): void {
    this.ringRadii.clear();
    for (const [playerId, state] of Object.entries(players)) {
      if ((state.flameRingRadius ?? 0) > 0 && state.alive && !state.isBurrowed) {
        this.ringRadii.set(playerId, state.flameRingRadius ?? 0);
      }
    }

    const sceneNow = this.getSceneNow();
    for (const [playerId, visual] of this.ringVisuals) {
      if (this.ringRadii.has(playerId)) {
        visual.fadingSince = null;
      } else if (visual.fadingSince === null) {
        // Das Erlöschen ist reine Nachwirkung: Treffer und Licht enden sofort.
        visual.fadingSince = sceneNow;
        this.releaseRingLights(playerId);
      }
    }
  }

  update(now: number): void {
    const updateStartedAt = this.performanceMetricsEnabled ? performance.now() : 0;
    this.groundFire.update(now);
    this.updateRingVisuals();
    if (this.performanceMetricsEnabled) this.lastUpdateMs = performance.now() - updateStartedAt;
  }

  getLastUpdateCostMs(): number { return this.lastUpdateMs; }

  setPerformanceMetricsEnabled(enabled: boolean): void {
    if (this.performanceMetricsEnabled === enabled) return;
    this.performanceMetricsEnabled = enabled;
    if (!enabled) this.lastUpdateMs = 0;
  }

  setLightingSystem(lighting: LightingSystem | null): void {
    this.lighting = lighting;
    this.groundFire.setLightingSystem(lighting);
  }

  clear(): void {
    this.groundWarning.clear();
    this.groundFire.clear();
    this.ringRadii.clear();
    for (const [playerId, visual] of this.ringVisuals) this.destroyRingVisual(playerId, visual);
    this.lastUpdateMs = 0;
    for (const chunk of this.flyingChunks) {
      this.chunkTweens.get(chunk)?.remove();
      this.scene.tweens.killTweensOf(chunk);
      chunk.destroy();
    }
    this.flyingChunks.clear();
    this.chunkTweens.clear();
    // Die Tweens wurden abgebrochen, ihre onComplete-Freigabe läuft also nicht mehr.
    for (const key of this.activeChunkLightKeys) this.lighting?.releaseLight(key);
    this.activeChunkLightKeys.clear();
  }

  destroyAll(): void {
    this.clear();
    this.groundFire.destroyAll();
  }

  private updateRingVisuals(): void {
    const sceneNow = this.getSceneNow();
    for (const [playerId, radius] of this.ringRadii) {
      if (this.ringVisuals.has(playerId)) continue;
      const visual = this.createRingVisual(playerId, radius, sceneNow);
      if (visual) this.ringVisuals.set(playerId, visual);
    }

    const qualityLevel = getGraphicsQualityProfile(this.scene).level;
    const camera = this.scene.cameras?.main;
    const pixelSize = camera ? 1 / Math.max(0.001, Math.min(camera.zoomX, camera.zoomY)) : 1;
    const emission = getEmissiveScale();

    for (const [playerId, visual] of this.ringVisuals) {
      const fade = visual.fadingSince === null
        ? 1
        : 1 - (sceneNow - visual.fadingSince) / RING_FADE_OUT_MS;
      if (fade <= 0) {
        this.destroyRingVisual(playerId, visual);
        continue;
      }

      const owner = this.owners.getOwnerVisualState(playerId);
      const radius = this.ringRadii.get(playerId) ?? visual.uniforms.radius;
      if (Math.abs(visual.uniforms.radius - radius) > 0.01) this.resizeRingVisual(visual, radius);

      const uniforms = visual.uniforms;
      // Periodisch begrenzt: die Advektion wächst mit der Zeit, ohne Grenze verliert das
      // Rauschen auf mediump-GPUs Präzision. Der Sprung geht im Flackern unter.
      uniforms.time = ((sceneNow - visual.bornAt) / 1000) % RING_TIME_WRAP_S;
      uniforms.ignite = Phaser.Math.Clamp((sceneNow - visual.bornAt) / RING_IGNITE_MS, 0, 1);
      uniforms.fade = Phaser.Math.Easing.Quadratic.Out(Phaser.Math.Clamp(fade, 0, 1));
      uniforms.pixelSize = pixelSize;
      uniforms.detail = RING_DETAIL[qualityLevel];
      uniforms.emission = emission;

      // Ohne Owner bleibt ein erlöschender Ring an seiner letzten Position stehen.
      if (owner) visual.quad.setPosition(owner.x, owner.y);
      const visible = owner?.visible ?? visual.fadingSince !== null;
      visual.quad.setVisible(visible);

      if (!visible || visual.fadingSince !== null || !owner) {
        if (visual.fadingSince === null) this.releaseRingLights(playerId);
        continue;
      }
      this.syncRingLights(playerId, owner.x, owner.y, radius, visual.phase);
    }
  }

  private createRingVisual(playerId: string, radius: number, sceneNow: number): RingVisual | null {
    // Headless-Präsentation darf keine GPU-Ressourcen anlegen.
    if (!(this.scene.sys?.renderer as { gl?: unknown } | undefined)?.gl) return null;
    const hash = this.hashString(playerId);
    const phase = this.seededUnit(hash, 83) * TWO_PI;
    const seed = this.seededUnit(hash, 17) * 997;
    const uniforms: RingUniforms = {
      time: 0, ignite: 0, fade: 1, pixelSize: 1, detail: 2, emission: 1, radius, size: this.getRingQuadSize(radius),
    };
    const quad = new Phaser.GameObjects.Shader(this.scene, {
      name: FLAME_RING_SHADER_NAME,
      shaderName: FLAME_RING_SHADER_NAME,
      fragmentSource: FLAME_RING_FRAGMENT_SOURCE,
      setupUniforms: (setUniform: (name: string, value: unknown) => void) => {
        setUniform('uSize', uniforms.size);
        setUniform('uRadius', uniforms.radius);
        setUniform('uBand', RING_BAND_HALF_THICKNESS);
        setUniform('uTime', uniforms.time);
        setUniform('uSeed', seed);
        setUniform('uPixelSize', uniforms.pixelSize);
        setUniform('uDetail', uniforms.detail);
        setUniform('uEmission', uniforms.emission);
        setUniform('uIgnite', uniforms.ignite);
        setUniform('uFade', uniforms.fade);
        setUniform('uIgniteAngle', phase - Math.PI);
        setUniform('uEmberCells', Math.max(6, Math.round(TWO_PI * uniforms.radius / RING_EMBER_SPACING)));
      },
    }, 0, 0, uniforms.size, uniforms.size);
    quad.setOrigin(0.5).setDepth(RING_DEPTH).setBlendMode(Phaser.BlendModes.NORMAL).setVisible(false);
    // Direktes Display-List-Kind: normales Kamera-Culling und World-Kamera-Zuordnung.
    this.scene.add.existing(quad);
    registerGraphicsObject(this.scene, 'flameRingEffects', quad);
    return { phase, quad, bornAt: sceneNow, fadingSince: null, uniforms };
  }

  private resizeRingVisual(visual: RingVisual, radius: number): void {
    visual.uniforms.radius = radius;
    visual.uniforms.size = this.getRingQuadSize(radius);
    // Shader-Size aktualisiert displayOrigin nicht selbst.
    visual.quad.setSize(visual.uniforms.size, visual.uniforms.size).setOrigin(0.5);
  }

  private getRingQuadSize(radius: number): number {
    return Math.ceil((radius + FLAME_RING_OUTER_REACH + 2) * 2);
  }

  private getSceneNow(): number {
    return this.scene.time?.now ?? 0;
  }

  /**
   * Verteilt die Ringbeleuchtung auf `RING_LIGHT_COUNT` Punkte entlang der Ringlinie.
   * Jedes Licht ist klein und deckt nur seinen Bogenabschnitt ab; zusammen glüht die
   * Linie durchgehend, während die Spielermitte weitgehend dunkel bleibt.
   */
  private syncRingLights(playerId: string, cx: number, cy: number, radius: number, phase: number): void {
    const lighting = this.lighting;
    if (!lighting) return;

    // Überlappung: der Abstand zweier Nachbarpunkte ist 2πr/N, der Lichtradius klar
    // darüber, damit die Bögen breit ineinanderlaufen und der Ring durchgehend hell glüht.
    const perLightRadius = Math.max(100, (TWO_PI * radius) / RING_LIGHT_COUNT * 1.15);
    for (let index = 0; index < RING_LIGHT_COUNT; index += 1) {
      const angle = phase + (index / RING_LIGHT_COUNT) * TWO_PI;
      // Intensität knapp unter 1: lässt dem Flackern des `flameRing`-Presets Spielraum
      // nach oben, statt es am Deckel abzuschneiden.
      lighting.setLight(
        `flamering:${playerId}:${index}`,
        'flameRing',
        cx + Math.cos(angle) * radius,
        cy + Math.sin(angle) * radius,
        { radiusPx: perLightRadius, intensity: 0.9 },
      );
    }
  }

  private releaseRingLights(playerId: string): void {
    for (let index = 0; index < RING_LIGHT_COUNT; index += 1) {
      this.lighting?.releaseLight(`flamering:${playerId}:${index}`);
    }
  }

  private destroyRingVisual(playerId: string, visual: RingVisual): void {
    this.releaseRingLights(playerId);
    this.ringVisuals.delete(playerId);
    visual.quad.destroy();
  }

  private seededUnit(id: number, salt: number): number {
    const value = Math.sin(id * 12.9898 + salt * 78.233) * 43758.5453;
    return value - Math.floor(value);
  }

  private hashString(value: string): number {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }
}
