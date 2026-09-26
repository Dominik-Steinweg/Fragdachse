import type { PlasmaBurnerPulseEvent } from '../combat/plasmaBurner/PlasmaBurnerContracts';
import * as Phaser from 'phaser';
import {
  DEPTH_TRACE,
  clipPointToArenaRay,
  getTopDownMuzzleOriginFromVector,
  isPointInsideArena,
} from '../config';
import { getGraphicsQualityProfile } from '../graphics/GraphicsQuality';
import type { HitscanImpactKind } from '../types';
import {
  ensureCanvasTexture,
  fillRadialGradientTexture,
  mixColors,
  registerGraphicsObject,
} from './EffectUtils';
import { getEmissiveScale } from './EmissiveScale';
import type { LightingSystem } from './LightingSystem';
import {
  PLASMA_BURNER_BEAM_BACK_PAD,
  PLASMA_BURNER_BEAM_FRAGMENT_SOURCE,
  PLASMA_BURNER_BEAM_FRONT_PAD,
  PLASMA_BURNER_BEAM_HEIGHT,
  PLASMA_BURNER_BEAM_SHADER_NAME,
} from './plasmaBurnerBeamShader';

type BeamOwnerVisualState = { x: number; y: number; color: number };

/** Farbrampe des Strahls: Tiefgrün, Plasmagrün, Limettenglut, fast weißer Kern. */
interface PlasmaPalette {
  readonly deep: number;
  readonly body: number;
  readonly hot: number;
  readonly core: number;
}

// Grüne Plasmaenergie ist die Identität der Waffe und bleibt unabhängig von der Spielerfarbe.
const PLASMA_PALETTE: PlasmaPalette = { deep: 0x0b7a1c, body: 0x2fe03c, hot: 0x9dff4a, core: 0xf4ffd9 };
// Heilende Kettensegmente kippen ins Minzgrün und bleiben so vom Schadensstrahl unterscheidbar.
const HEALING_PALETTE: PlasmaPalette = { deep: 0x0a7a5e, body: 0x2fe0aa, hot: 0x9dffd8, core: 0xf0fff8 };

const TEX_PLASMA_HAZE = '__plasma_burner_haze';
const TEX_PLASMA_STREAK = '__plasma_burner_streak';
const TEX_PLASMA_SPARK = '__plasma_burner_spark';

const BEAM_HOLD_MS = 190;
const BEAM_FADE_MS = 140;
const BEAM_LIGHT_SPACING_PX = 220;
const BEAM_MAX_PATH_LIGHTS = 2;
// Periodisch begrenzt: die Advektion wächst mit der Zeit und verliert sonst Präzision.
const BEAM_TIME_WRAP_S = 240;
const BEAM_DETAIL = { high: 2, medium: 1, low: 0 } as const;
const MAX_MOTION_BEND_PX = 9;

interface BeamUniforms {
  width: number;
  length: number;
  time: number;
  thickness: number;
  boost: number;
  alpha: number;
  bend: number;
  impact: number;
  lock: number;
  heal: number;
  pixelSize: number;
  detail: number;
  emission: number;
  palette: PlasmaPalette;
}

interface PlasmaBeamVisual {
  /** `null` ohne WebGL-Renderer; Endpunkt- und Lichtlogik laufen trotzdem weiter. */
  readonly quad: Phaser.GameObjects.Shader | null;
  readonly uniforms: BeamUniforms;
  readonly seed: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  authoritativeEndX: number;
  authoritativeEndY: number;
  authoritativeLength: number;
  thickness: number;
  impactKind: HitscanImpactKind;
  activeUntil: number;
  fadeEndsAt: number;
  lightsReleased: boolean;
  lastOwnerX: number | null;
  lastOwnerY: number | null;
  motionTrailX: number;
  motionTrailY: number;
}

interface PulseSegmentState {
  owner: string;
  index: number;
  locked: boolean;
  portal: boolean;
  lockEnd: boolean;
  healing: boolean;
  secondary: boolean;
  boost: number;
}

/**
 * GPU-Renderer des kontinuierlichen Plasmabrenner-Strahls.
 *
 * Hitscan-Impulse aktualisieren ausschließlich Endpunkte und Lebensdauer des Visuals. Jedes
 * Strahlsegment ist ein gepooltes, entlang Start→Ende gedrehtes Shader-Quad; Kern, Plasma-
 * stränge, Turbulenz, Funken sowie Mündungs- und Einschlagblüte berechnet der Fragment-Shader
 * (`plasmaBurnerBeamShader.ts`). Pro Frame setzt die CPU nur Transform und Uniforms.
 */
export class PlasmaBurnerRenderer {
  private readonly beams = new Map<string, PlasmaBeamVisual>();
  private readonly pulseSegments = new Map<string, PulseSegmentState>();
  private readonly beamPool: PlasmaBeamVisual[] = [];
  private lighting: LightingSystem | null = null;
  private ownerVisualStateProvider: ((ownerId: string) => BeamOwnerVisualState | null) | null = null;
  private localAimAngleProvider: ((ownerId: string) => number | null) | null = null;
  private nextSeed = 0;

  constructor(private readonly scene: Phaser.Scene) {
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
  }

  /** Die Texturen teilt sich der `PlasmaBurnerChargeRenderer` für seine Plasmatropfen. */
  generateTextures(): void {
    fillRadialGradientTexture(this.scene.textures, TEX_PLASMA_HAZE, 96, [
      [0, 'rgba(255,255,255,0.9)'],
      [0.16, 'rgba(255,255,255,0.72)'],
      [0.42, 'rgba(255,255,255,0.3)'],
      [0.72, 'rgba(255,255,255,0.1)'],
      [1, 'rgba(255,255,255,0.0)'],
    ]);

    ensureCanvasTexture(this.scene.textures, TEX_PLASMA_STREAK, 128, 32, (ctx) => {
      ctx.clearRect(0, 0, 128, 32);
      const horizontal = ctx.createLinearGradient(0, 0, 128, 0);
      horizontal.addColorStop(0, 'rgba(255,255,255,0)');
      horizontal.addColorStop(0.12, 'rgba(255,255,255,0.2)');
      horizontal.addColorStop(0.34, 'rgba(255,255,255,0.78)');
      horizontal.addColorStop(0.58, 'rgba(255,255,255,1)');
      horizontal.addColorStop(0.84, 'rgba(255,255,255,0.34)');
      horizontal.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = horizontal;
      ctx.beginPath();
      ctx.roundRect(4, 6, 120, 20, 10);
      ctx.fill();

      ctx.globalCompositeOperation = 'destination-in';
      const vertical = ctx.createLinearGradient(0, 0, 0, 32);
      vertical.addColorStop(0, 'rgba(255,255,255,0)');
      vertical.addColorStop(0.28, 'rgba(255,255,255,0.58)');
      vertical.addColorStop(0.5, 'rgba(255,255,255,1)');
      vertical.addColorStop(0.72, 'rgba(255,255,255,0.58)');
      vertical.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = vertical;
      ctx.fillRect(0, 0, 128, 32);
      ctx.globalCompositeOperation = 'source-over';
    });

    fillRadialGradientTexture(this.scene.textures, TEX_PLASMA_SPARK, 12, [
      [0, 'rgba(255,255,255,1.0)'],
      [0.24, 'rgba(255,255,255,0.96)'],
      [0.62, 'rgba(255,255,255,0.48)'],
      [1, 'rgba(255,255,255,0.0)'],
    ]);
  }

  setLightingSystem(lighting: LightingSystem | null): void {
    this.lighting = lighting;
  }

  setOwnerVisualStateProvider(provider: ((ownerId: string) => BeamOwnerVisualState | null) | null): void {
    this.ownerVisualStateProvider = provider;
  }

  setLocalAimAngleProvider(provider: ((ownerId: string) => number | null) | null): void {
    this.localAimAngleProvider = provider;
  }

  playPulse(event: PlasmaBurnerPulseEvent, predicted = false): void {
    const prefix = event.id + '#';
    if (!predicted) for (const [key, visual] of this.beams) {
      if (key.startsWith(prefix) && Number(key.slice(prefix.length)) >= event.s.length) this.recycleBeam(key, visual);
    }
    event.s.forEach(([sx, sy, ex, ey, fx], index) => {
      if (predicted && index !== 0) return;
      const key = prefix + index;
      const previous = this.pulseSegments.get(key);
      if (predicted && previous && (previous.locked || previous.portal)) return;
      const secondary = index >= event.p;
      const healing = fx === 2;
      this.pulseSegments.set(key, { owner: event.id, index, locked: event.lk, portal: event.p > 1,
        lockEnd: event.lk && index === event.p - 1, healing, secondary,
        boost: 1 + Math.min(0.45, Math.max(0, event.m - 1) * 0.22) });
      this.playTracer(sx, sy, ex, ey, healing ? HEALING_PALETTE.body : PLASMA_PALETTE.body,
        (secondary ? 2 : 3) * (1 + (event.m - 1) * 0.22), fx ? 'player' : 'none', key);
    });
  }

  /**
   * `color` gehört zum gemeinsamen Hitscan-Tracer-Vertrag; der Plasmastrahl nutzt bewusst
   * seine eigene grüne Palette statt der Spielerfarbe.
   */
  playTracer(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    _color: number,
    thickness: number,
    impactKind: HitscanImpactKind = 'environment',
    beamId = 'anonymous',
  ): void {
    const clippedEnd = clipPointToArenaRay(startX, startY, endX, endY);
    const clippedDx = clippedEnd.x - endX;
    const clippedDy = clippedEnd.y - endY;
    const clippedByArena = (clippedDx * clippedDx) + (clippedDy * clippedDy) > 0.25;
    const now = this.scene.time.now;
    const existing = this.beams.get(beamId);
    const visual = existing ?? this.acquireBeam(beamId);

    visual.startX = startX;
    visual.startY = startY;
    visual.authoritativeEndX = clippedEnd.x;
    visual.authoritativeEndY = clippedEnd.y;
    visual.authoritativeLength = Math.hypot(clippedEnd.x - startX, clippedEnd.y - startY);
    if (!existing) {
      visual.endX = clippedEnd.x;
      visual.endY = clippedEnd.y;
    }
    visual.thickness = Math.max(1, thickness);
    visual.impactKind = impactKind === 'none' && clippedByArena ? 'environment' : impactKind;
    visual.activeUntil = now + BEAM_HOLD_MS;
    visual.fadeEndsAt = visual.activeUntil + BEAM_FADE_MS;
    visual.lightsReleased = false;
  }

  update(delta = 16.667): void {
    if (this.beams.size === 0) return;
    const now = this.scene.time.now;
    const qualityLevel = getGraphicsQualityProfile(this.scene).level;
    const camera = this.scene.cameras?.main;
    const pixelSize = camera ? 1 / Math.max(0.001, Math.min(camera.zoomX, camera.zoomY)) : 1;
    const emission = getEmissiveScale();

    for (const [beamId, visual] of this.beams) {
      if (now >= visual.fadeEndsAt) {
        this.recycleBeam(beamId, visual);
        continue;
      }

      const active = now <= visual.activeUntil;
      this.syncOwnerVisualState(beamId, visual, delta);
      this.syncVisualEndpoint(beamId, visual, delta, active);
      const fade = active
        ? 1
        : Phaser.Math.Clamp(1 - ((now - visual.activeUntil) / BEAM_FADE_MS), 0, 1);
      const segment = this.pulseSegments.get(beamId);

      const uniforms = visual.uniforms;
      uniforms.time = (now / 1000) % BEAM_TIME_WRAP_S;
      uniforms.thickness = visual.thickness;
      uniforms.boost = segment?.boost ?? 1;
      uniforms.alpha = fade * (segment?.secondary ? 0.72 : 1);
      uniforms.impact = this.hasImpact(visual) ? (visual.impactKind === 'player' ? 2 : 1) : 0;
      uniforms.lock = segment?.lockEnd ? 1 : 0;
      uniforms.heal = segment?.healing ? 1 : 0;
      uniforms.palette = segment?.healing ? HEALING_PALETTE : PLASMA_PALETTE;
      uniforms.pixelSize = pixelSize;
      uniforms.detail = BEAM_DETAIL[qualityLevel];
      uniforms.emission = emission;
      this.layoutQuad(visual);

      if (active) {
        this.syncBeamLights(beamId, visual);
      } else if (!visual.lightsReleased) {
        this.releaseBeamLights(beamId);
        visual.lightsReleased = true;
      }
    }
  }

  clear(): void {
    for (const [beamId, visual] of this.beams) {
      this.releaseBeamLights(beamId);
      visual.quad?.destroy();
    }
    this.beams.clear();
    this.pulseSegments.clear();

    for (const visual of this.beamPool) visual.quad?.destroy();
    this.beamPool.length = 0;
  }

  shutdown(): void {
    this.clear();
  }

  private acquireBeam(beamId: string): PlasmaBeamVisual {
    const visual = this.beamPool.pop() ?? this.createBeamVisual();
    const now = this.scene.time.now;
    visual.activeUntil = now;
    visual.fadeEndsAt = now + BEAM_FADE_MS;
    visual.lightsReleased = false;
    visual.lastOwnerX = null;
    visual.lastOwnerY = null;
    visual.motionTrailX = 0;
    visual.motionTrailY = 0;
    // Sichtbar erst nach dem ersten Layout, sonst blitzt das Quad mit alter Geometrie auf.
    visual.quad?.setVisible(false);
    this.beams.set(beamId, visual);
    return visual;
  }

  private createBeamVisual(): PlasmaBeamVisual {
    const uniforms: BeamUniforms = {
      width: PLASMA_BURNER_BEAM_BACK_PAD + PLASMA_BURNER_BEAM_FRONT_PAD + 1,
      length: 1,
      time: 0,
      thickness: 3,
      boost: 1,
      alpha: 0,
      bend: 0,
      impact: 0,
      lock: 0,
      heal: 0,
      pixelSize: 1,
      detail: 2,
      emission: 1,
      palette: PLASMA_PALETTE,
    };
    // Goldener-Schnitt-Folge: benachbarte Segmente erhalten sichtbar verschiedene Muster.
    const seed = ((this.nextSeed++ * 0.61803398875) % 1) * 997;
    return {
      quad: this.createBeamQuad(uniforms, seed),
      uniforms,
      seed,
      startX: 0,
      startY: 0,
      endX: 0,
      endY: 0,
      authoritativeEndX: 0,
      authoritativeEndY: 0,
      authoritativeLength: 0,
      thickness: 3,
      impactKind: 'none',
      activeUntil: 0,
      fadeEndsAt: 0,
      lightsReleased: true,
      lastOwnerX: null,
      lastOwnerY: null,
      motionTrailX: 0,
      motionTrailY: 0,
    };
  }

  private createBeamQuad(uniforms: BeamUniforms, seed: number): Phaser.GameObjects.Shader | null {
    // Headless-Präsentation darf keine GPU-Ressourcen anlegen.
    if (!(this.scene.sys?.renderer as { gl?: unknown } | undefined)?.gl) return null;
    const deep = this.colorToVec3(PLASMA_PALETTE.deep);
    const body = this.colorToVec3(PLASMA_PALETTE.body);
    const hot = this.colorToVec3(PLASMA_PALETTE.hot);
    const core = this.colorToVec3(PLASMA_PALETTE.core);
    const quad = new Phaser.GameObjects.Shader(this.scene, {
      name: PLASMA_BURNER_BEAM_SHADER_NAME,
      shaderName: PLASMA_BURNER_BEAM_SHADER_NAME,
      fragmentSource: PLASMA_BURNER_BEAM_FRAGMENT_SOURCE,
      setupUniforms: (setUniform: (name: string, value: unknown) => void) => {
        const palette = uniforms.palette;
        setUniform('uSize', [uniforms.width, PLASMA_BURNER_BEAM_HEIGHT]);
        setUniform('uBack', PLASMA_BURNER_BEAM_BACK_PAD);
        setUniform('uLength', uniforms.length);
        setUniform('uTime', uniforms.time);
        setUniform('uSeed', seed);
        setUniform('uThickness', uniforms.thickness);
        setUniform('uBoost', uniforms.boost);
        setUniform('uAlpha', uniforms.alpha);
        setUniform('uBend', uniforms.bend);
        setUniform('uImpact', uniforms.impact);
        setUniform('uLock', uniforms.lock);
        setUniform('uHeal', uniforms.heal);
        setUniform('uPixelSize', uniforms.pixelSize);
        setUniform('uDetail', uniforms.detail);
        setUniform('uEmission', uniforms.emission);
        setUniform('uDeep', this.writeColor(deep, palette.deep));
        setUniform('uBody', this.writeColor(body, palette.body));
        setUniform('uHot', this.writeColor(hot, palette.hot));
        setUniform('uCore', this.writeColor(core, palette.core));
      },
    }, 0, 0, uniforms.width, PLASMA_BURNER_BEAM_HEIGHT);
    quad.setOrigin(0.5).setDepth(DEPTH_TRACE + 0.16).setBlendMode(Phaser.BlendModes.NORMAL).setVisible(false);
    // Direktes Display-List-Kind: normales Kamera-Culling und World-Kamera-Zuordnung.
    this.scene.add.existing(quad);
    registerGraphicsObject(this.scene, 'plasmaBurnerEffects', quad);
    return quad;
  }

  /** Richtet das Quad entlang Start→Ende aus; Reserve hinter Mündung und Endpunkt für die Blüten. */
  private layoutQuad(visual: PlasmaBeamVisual): void {
    const dx = visual.endX - visual.startX;
    const dy = visual.endY - visual.startY;
    const length = Math.max(1, Math.hypot(dx, dy));
    const angle = Math.atan2(dy, dx);
    const uniforms = visual.uniforms;
    uniforms.length = length;
    // Trägheitsbiegung quer zum Strahl, projiziert auf dessen Normale.
    uniforms.bend = (visual.motionTrailY * Math.cos(angle)) - (visual.motionTrailX * Math.sin(angle));

    const quad = visual.quad;
    if (!quad) return;
    const width = Math.ceil(length + PLASMA_BURNER_BEAM_BACK_PAD + PLASMA_BURNER_BEAM_FRONT_PAD);
    if (width !== uniforms.width) {
      uniforms.width = width;
      // Shader-Size aktualisiert displayOrigin nicht selbst.
      quad.setSize(width, PLASMA_BURNER_BEAM_HEIGHT).setOrigin(0.5);
    }
    const centerOffset = (width / 2) - PLASMA_BURNER_BEAM_BACK_PAD;
    quad
      .setPosition(visual.startX + Math.cos(angle) * centerOffset, visual.startY + Math.sin(angle) * centerOffset)
      .setRotation(angle)
      .setVisible(uniforms.alpha > 0.001);
  }

  private syncOwnerVisualState(beamId: string, visual: PlasmaBeamVisual, delta: number): void {
    const segment = this.pulseSegments.get(beamId);
    if (segment && segment.index !== 0) return;
    const owner = this.ownerVisualStateProvider?.(segment?.owner ?? beamId) ?? null;
    if (!owner) {
      visual.motionTrailX = Phaser.Math.Linear(visual.motionTrailX, 0, 0.2);
      visual.motionTrailY = Phaser.Math.Linear(visual.motionTrailY, 0, 0.2);
      return;
    }

    const frameScale = 16.667 / Math.max(1, delta);
    const moveX = visual.lastOwnerX === null ? 0 : (owner.x - visual.lastOwnerX) * frameScale;
    const moveY = visual.lastOwnerY === null ? 0 : (owner.y - visual.lastOwnerY) * frameScale;
    visual.lastOwnerX = owner.x;
    visual.lastOwnerY = owner.y;

    const desiredTrailX = Phaser.Math.Clamp(-moveX * 0.72, -MAX_MOTION_BEND_PX, MAX_MOTION_BEND_PX);
    const desiredTrailY = Phaser.Math.Clamp(-moveY * 0.72, -MAX_MOTION_BEND_PX, MAX_MOTION_BEND_PX);
    const follow = 1 - Math.exp(-Math.max(1, delta) / 48);
    visual.motionTrailX = Phaser.Math.Linear(visual.motionTrailX, desiredTrailX, follow);
    visual.motionTrailY = Phaser.Math.Linear(visual.motionTrailY, desiredTrailY, follow);

    const localAimAngle = this.getLocalAimAngle(beamId);
    const directionX = localAimAngle === null ? visual.endX - owner.x : Math.cos(localAimAngle);
    const directionY = localAimAngle === null ? visual.endY - owner.y : Math.sin(localAimAngle);
    const muzzle = getTopDownMuzzleOriginFromVector(owner.x, owner.y, directionX, directionY);
    visual.startX = muzzle.x;
    visual.startY = muzzle.y;
  }

  private syncVisualEndpoint(beamId: string, visual: PlasmaBeamVisual, delta: number, active: boolean): void {
    let targetX = visual.authoritativeEndX;
    let targetY = visual.authoritativeEndY;
    const localAimAngle = active ? this.getLocalAimAngle(beamId) : null;

    if (localAimAngle !== null && visual.authoritativeLength > 0.001) {
      const predictedEndX = visual.startX + Math.cos(localAimAngle) * visual.authoritativeLength;
      const predictedEndY = visual.startY + Math.sin(localAimAngle) * visual.authoritativeLength;
      const clipped = clipPointToArenaRay(visual.startX, visual.startY, predictedEndX, predictedEndY);
      targetX = clipped.x;
      targetY = clipped.y;
    }

    const responseMs = localAimAngle === null ? 48 : 26;
    const follow = 1 - Math.exp(-Math.max(1, delta) / responseMs);
    visual.endX += (targetX - visual.endX) * follow;
    visual.endY += (targetY - visual.endY) * follow;
  }

  private getLocalAimAngle(beamId: string): number | null {
    const segment = this.pulseSegments.get(beamId);
    if (segment && (segment.index !== 0 || segment.locked || segment.portal)) return null;
    const angle = this.localAimAngleProvider?.(segment?.owner ?? beamId) ?? null;
    return angle !== null && Number.isFinite(angle) ? angle : null;
  }

  private hasImpact(visual: PlasmaBeamVisual): boolean {
    return visual.impactKind !== 'none' && isPointInsideArena(visual.endX, visual.endY);
  }

  private recycleBeam(beamId: string, visual: PlasmaBeamVisual): void {
    this.releaseBeamLights(beamId);
    visual.quad?.setVisible(false);
    visual.uniforms.alpha = 0;
    visual.lightsReleased = true;
    this.beams.delete(beamId);
    this.pulseSegments.delete(beamId);
    this.beamPool.push(visual);
  }

  private colorToVec3(color: number): number[] {
    return this.writeColor([0, 0, 0], color);
  }

  /** Schreibt in ein wiederverwendetes Array, damit das Uniform-Setup pro Frame nichts allokiert. */
  private writeColor(target: number[], color: number): number[] {
    target[0] = ((color >> 16) & 0xff) / 255;
    target[1] = ((color >> 8) & 0xff) / 255;
    target[2] = (color & 0xff) / 255;
    return target;
  }

  private syncBeamLights(beamId: string, visual: PlasmaBeamVisual): void {
    if (!this.lighting) return;
    const dx = visual.endX - visual.startX;
    const dy = visual.endY - visual.startY;
    const length = Math.hypot(dx, dy);
    if (length < 1) {
      this.releaseBeamLights(beamId);
      visual.lightsReleased = true;
      return;
    }

    const palette = visual.uniforms.palette;
    const count = Phaser.Math.Clamp(Math.ceil(length / BEAM_LIGHT_SPACING_PX), 1, BEAM_MAX_PATH_LIGHTS);
    const lightColor = mixColors(palette.hot, 0xffffff, 0.25);
    const radiusPx = Phaser.Math.Clamp((length / count) * 0.9, 145, 205);
    for (let slot = 0; slot < count; slot += 1) {
      const t = (slot + 0.5) / count;
      this.lighting.setLight(
        this.pathLightKey(beamId, slot),
        'electricArc',
        visual.startX + dx * t,
        visual.startY + dy * t,
        {
          color: lightColor,
          radiusPx,
          intensity: 0.78,
        },
      );
    }
    for (let slot = count; slot < BEAM_MAX_PATH_LIGHTS; slot += 1) {
      this.lighting.releaseLight(this.pathLightKey(beamId, slot));
    }

    if (this.hasImpact(visual)) {
      const pulse = 0.94 + Math.sin(this.scene.time.now * 0.035 + visual.endX * 0.012 + visual.endY * 0.009) * 0.06;
      this.lighting.setLight(
        this.impactLightKey(beamId),
        'electricArc',
        visual.endX,
        visual.endY,
        {
          color: mixColors(palette.hot, 0xffffff, 0.45),
          radiusPx: visual.impactKind === 'player' ? 185 : 215,
          intensity: pulse,
        },
      );
    } else {
      this.lighting.releaseLight(this.impactLightKey(beamId));
    }
    visual.lightsReleased = false;
  }

  private releaseBeamLights(beamId: string): void {
    if (!this.lighting) return;
    for (let slot = 0; slot < BEAM_MAX_PATH_LIGHTS; slot += 1) {
      this.lighting.releaseLight(this.pathLightKey(beamId, slot));
    }
    this.lighting.releaseLight(this.impactLightKey(beamId));
  }

  private pathLightKey(beamId: string, slot: number): string {
    return `plasmabeam:${beamId}:${slot}`;
  }

  private impactLightKey(beamId: string): string {
    return `plasmabeam:${beamId}:impact`;
  }
}
