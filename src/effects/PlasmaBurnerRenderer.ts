import * as Phaser from 'phaser';
import {
  DEPTH_TRACE,
  clipPointToArenaRay,
  getBeamPaletteForPlayerColor,
  getTopDownMuzzleOriginFromVector,
  isPointInsideArena,
} from '../config';
import type { HitscanImpactKind } from '../types';
import {
  createEmitter,
  destroyEmitter,
  ensureCanvasTexture,
  fillRadialGradientTexture,
  killAllAndResetParticlePositions,
  makeAdditive,
  mixColors,
  registerGraphicsObject,
  setEmitterTintArray,
} from './EffectUtils';
import { emissiveAlpha } from './EmissiveScale';
import {
  blendBeamPaths,
  createJitteredBeamPath,
  reanchorBeamPathEnd,
  reanchorBeamPathStart,
  resampleBeamSpline,
  sampleBeamPath,
  sampleBeamTangent,
  strokeBeamPolyline,
  type BeamPoint,
} from './BeamPathShared';
import type { LightingSystem } from './LightingSystem';

type BeamOwnerVisualState = { x: number; y: number; color: number };

const TEX_PLASMA_HAZE = '__plasma_burner_haze';
const TEX_PLASMA_STREAK = '__plasma_burner_streak';
const TEX_PLASMA_SPARK = '__plasma_burner_spark';

const BEAM_HOLD_MS = 190;
const BEAM_FADE_MS = 140;
const GEOMETRY_REFRESH_MIN_MS = 25;
const GEOMETRY_REFRESH_MAX_MS = 40;
const IMPACT_SPARK_INTERVAL_MS = 62;
const CONTROL_POINT_SPACING_PX = 62;
const RESAMPLE_SPACING_PX = 6;
const MIN_CONTROL_POINTS = 6;
const MAX_CONTROL_POINTS = 11;
const MIN_RESAMPLED_POINTS = 24;
const MAX_RESAMPLED_POINTS = 92;
const MAX_HAZE_SAMPLES = 7;
const MAX_STREAK_SAMPLES = 6;
const MAX_SPARK_SAMPLES = 5;
const BEAM_LIGHT_SPACING_PX = 220;
const BEAM_MAX_PATH_LIGHTS = 2;

interface PlasmaBeamVisual {
  readonly root: Phaser.GameObjects.Container;
  readonly glow: Phaser.GameObjects.Graphics;
  readonly discharge: Phaser.GameObjects.Graphics;
  readonly filaments: Phaser.GameObjects.Graphics;
  readonly endpoints: Phaser.GameObjects.Graphics;
  readonly hazeSamples: Phaser.GameObjects.Image[];
  readonly streakSamples: Phaser.GameObjects.Image[];
  readonly sparkSamples: Phaser.GameObjects.Image[];
  readonly muzzleHalo: Phaser.GameObjects.Image;
  readonly muzzleStreak: Phaser.GameObjects.Image;
  readonly impactHalo: Phaser.GameObjects.Image;
  readonly impactFlare: Phaser.GameObjects.Image;
  mainPath: BeamPoint[];
  outerPath: BeamPoint[];
  corePath: BeamPoint[];
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  authoritativeEndX: number;
  authoritativeEndY: number;
  authoritativeLength: number;
  color: number;
  thickness: number;
  impactKind: HitscanImpactKind;
  activeUntil: number;
  fadeEndsAt: number;
  nextGeometryAt: number;
  lastImpactSparkAt: number;
  lightsReleased: boolean;
  lastOwnerX: number | null;
  lastOwnerY: number | null;
  motionTrailX: number;
  motionTrailY: number;
}

/**
 * Kontinuierlicher Lightning-Gun-Renderer fuer den Plasmabrenner.
 *
 * Hitscan-Impulse aktualisieren ausschliesslich Endpunkte und Lebensdauer des Visuals.
 * `update()` erzeugt lokal unruhige Kontrollpunkte, glaettet sie als Catmull-Rom-Spline
 * und mischt sie zeitlich mit dem vorherigen Pfad. Vier Graphics, gebuendelte Images und
 * ein geteilter Partikelemitter werden pro Schuetze beziehungsweise Renderer gepoolt.
 */
export class PlasmaBurnerRenderer {
  private readonly beams = new Map<string, PlasmaBeamVisual>();
  private readonly beamPool: PlasmaBeamVisual[] = [];
  private impactSparkEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private lighting: LightingSystem | null = null;
  private ownerVisualStateProvider: ((ownerId: string) => BeamOwnerVisualState | null) | null = null;
  private localAimAngleProvider: ((ownerId: string) => number | null) | null = null;

  constructor(private readonly scene: Phaser.Scene) {
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
  }

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

  playTracer(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    color: number,
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
    if (!existing || visual.mainPath.length === 0) {
      visual.endX = clippedEnd.x;
      visual.endY = clippedEnd.y;
    }
    visual.color = color;
    visual.thickness = Math.max(1, thickness);
    visual.impactKind = impactKind === 'none' && clippedByArena ? 'environment' : impactKind;
    visual.activeUntil = now + BEAM_HOLD_MS;
    visual.fadeEndsAt = visual.activeUntil + BEAM_FADE_MS;
    visual.nextGeometryAt = Math.min(visual.nextGeometryAt, now);
    visual.lightsReleased = false;
    visual.root.setVisible(true).setAlpha(1);
  }

  update(delta = 16.667): void {
    const now = this.scene.time.now;

    for (const [beamId, visual] of this.beams) {
      if (now >= visual.fadeEndsAt) {
        this.recycleBeam(beamId, visual);
        continue;
      }

      const active = now <= visual.activeUntil;
      this.syncOwnerVisualState(beamId, visual, delta);
      this.syncVisualEndpoint(beamId, visual, delta, active);
      const alpha = active
        ? 1
        : Phaser.Math.Clamp(1 - ((now - visual.activeUntil) / BEAM_FADE_MS), 0, 1);
      visual.root.setAlpha(alpha);

      if (now >= visual.nextGeometryAt) {
        this.drawBeam(visual);
        visual.nextGeometryAt = now + Phaser.Math.Between(GEOMETRY_REFRESH_MIN_MS, GEOMETRY_REFRESH_MAX_MS);
        if (active) this.emitImpactSparks(visual, now);
      }
      this.updateTextureLayers(visual, now);

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
      this.destroyBeamVisual(visual);
    }
    this.beams.clear();

    for (const visual of this.beamPool) this.destroyBeamVisual(visual);
    this.beamPool.length = 0;

    if (this.impactSparkEmitter) killAllAndResetParticlePositions(this.impactSparkEmitter);
  }

  shutdown(): void {
    this.clear();
    if (this.impactSparkEmitter) {
      destroyEmitter(this.impactSparkEmitter);
      this.impactSparkEmitter = null;
    }
  }

  private acquireBeam(beamId: string): PlasmaBeamVisual {
    const visual = this.beamPool.pop() ?? this.createBeamVisual();
    const now = this.scene.time.now;
    visual.mainPath = [];
    visual.outerPath = [];
    visual.corePath = [];
    visual.activeUntil = now;
    visual.fadeEndsAt = now + BEAM_FADE_MS;
    visual.nextGeometryAt = now;
    visual.lastImpactSparkAt = 0;
    visual.lightsReleased = false;
    visual.lastOwnerX = null;
    visual.lastOwnerY = null;
    visual.motionTrailX = 0;
    visual.motionTrailY = 0;
    visual.root.setVisible(true).setAlpha(1);
    this.beams.set(beamId, visual);
    return visual;
  }

  private createBeamVisual(): PlasmaBeamVisual {
    const root = this.scene.add.container(0, 0).setDepth(DEPTH_TRACE + 0.16);
    const glow = makeAdditive(this.scene.add.graphics());
    const discharge = makeAdditive(this.scene.add.graphics());
    const filaments = makeAdditive(this.scene.add.graphics());
    const endpoints = makeAdditive(this.scene.add.graphics());
    registerGraphicsObject(this.scene, 'plasmaBurnerEffects', glow);
    registerGraphicsObject(this.scene, 'plasmaBurnerEffects', discharge);
    registerGraphicsObject(this.scene, 'plasmaBurnerEffects', filaments);
    registerGraphicsObject(this.scene, 'plasmaBurnerEffects', endpoints);
    const hazeSamples = Array.from({ length: MAX_HAZE_SAMPLES }, () => this.createAdditiveImage(TEX_PLASMA_HAZE));
    const streakSamples = Array.from({ length: MAX_STREAK_SAMPLES }, () => this.createAdditiveImage(TEX_PLASMA_STREAK));
    const sparkSamples = Array.from({ length: MAX_SPARK_SAMPLES }, () => this.createAdditiveImage(TEX_PLASMA_SPARK));
    const muzzleHalo = this.createAdditiveImage(TEX_PLASMA_HAZE);
    const muzzleStreak = this.createAdditiveImage(TEX_PLASMA_STREAK);
    const impactHalo = this.createAdditiveImage(TEX_PLASMA_HAZE);
    const impactFlare = this.createAdditiveImage(TEX_PLASMA_HAZE);
    root.add([
      glow,
      ...hazeSamples,
      discharge,
      filaments,
      ...streakSamples,
      ...sparkSamples,
      endpoints,
      muzzleHalo,
      muzzleStreak,
      impactHalo,
      impactFlare,
    ]);

    return {
      root,
      glow,
      discharge,
      filaments,
      endpoints,
      hazeSamples,
      streakSamples,
      sparkSamples,
      muzzleHalo,
      muzzleStreak,
      impactHalo,
      impactFlare,
      mainPath: [],
      outerPath: [],
      corePath: [],
      startX: 0,
      startY: 0,
      endX: 0,
      endY: 0,
      authoritativeEndX: 0,
      authoritativeEndY: 0,
      authoritativeLength: 0,
      color: 0x62ffd2,
      thickness: 5,
      impactKind: 'none',
      activeUntil: 0,
      fadeEndsAt: 0,
      nextGeometryAt: 0,
      lastImpactSparkAt: 0,
      lightsReleased: true,
      lastOwnerX: null,
      lastOwnerY: null,
      motionTrailX: 0,
      motionTrailY: 0,
    };
  }

  private createAdditiveImage(texture: string): Phaser.GameObjects.Image {
    const image = this.scene.add.image(0, 0, texture).setVisible(false).setAlpha(0);
    makeAdditive(image);
    return image;
  }

  private syncOwnerVisualState(beamId: string, visual: PlasmaBeamVisual, delta: number): void {
    const owner = this.ownerVisualStateProvider?.(beamId) ?? null;
    if (!owner) {
      visual.motionTrailX = Phaser.Math.Linear(visual.motionTrailX, 0, 0.2);
      visual.motionTrailY = Phaser.Math.Linear(visual.motionTrailY, 0, 0.2);
      return;
    }

    visual.color = owner.color;
    const frameScale = 16.667 / Math.max(1, delta);
    const moveX = visual.lastOwnerX === null ? 0 : (owner.x - visual.lastOwnerX) * frameScale;
    const moveY = visual.lastOwnerY === null ? 0 : (owner.y - visual.lastOwnerY) * frameScale;
    visual.lastOwnerX = owner.x;
    visual.lastOwnerY = owner.y;

    const maxTrail = 9;
    const desiredTrailX = Phaser.Math.Clamp(-moveX * 0.72, -maxTrail, maxTrail);
    const desiredTrailY = Phaser.Math.Clamp(-moveY * 0.72, -maxTrail, maxTrail);
    const follow = 1 - Math.exp(-Math.max(1, delta) / 48);
    visual.motionTrailX = Phaser.Math.Linear(visual.motionTrailX, desiredTrailX, follow);
    visual.motionTrailY = Phaser.Math.Linear(visual.motionTrailY, desiredTrailY, follow);

    const localAimAngle = this.getLocalAimAngle(beamId);
    const directionX = localAimAngle === null ? visual.endX - owner.x : Math.cos(localAimAngle);
    const directionY = localAimAngle === null ? visual.endY - owner.y : Math.sin(localAimAngle);
    const muzzle = getTopDownMuzzleOriginFromVector(owner.x, owner.y, directionX, directionY);
    const shiftX = muzzle.x - visual.startX;
    const shiftY = muzzle.y - visual.startY;
    if ((shiftX * shiftX) + (shiftY * shiftY) <= 0.0001) return;

    reanchorBeamPathStart(visual.mainPath, shiftX, shiftY);
    reanchorBeamPathStart(visual.outerPath, shiftX, shiftY);
    reanchorBeamPathStart(visual.corePath, shiftX, shiftY);
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
    const shiftX = (targetX - visual.endX) * follow;
    const shiftY = (targetY - visual.endY) * follow;
    if ((shiftX * shiftX) + (shiftY * shiftY) <= 0.0001) return;

    reanchorBeamPathEnd(visual.mainPath, shiftX, shiftY);
    reanchorBeamPathEnd(visual.outerPath, shiftX, shiftY);
    reanchorBeamPathEnd(visual.corePath, shiftX, shiftY);
    visual.endX += shiftX;
    visual.endY += shiftY;
  }

  private getLocalAimAngle(beamId: string): number | null {
    const angle = this.localAimAngleProvider?.(beamId) ?? null;
    return angle !== null && Number.isFinite(angle) ? angle : null;
  }

  private recycleBeam(beamId: string, visual: PlasmaBeamVisual): void {
    this.releaseBeamLights(beamId);
    visual.glow.clear();
    visual.discharge.clear();
    visual.filaments.clear();
    visual.endpoints.clear();
    visual.mainPath = [];
    visual.outerPath = [];
    visual.corePath = [];
    this.hideTextureLayers(visual);
    visual.root.setVisible(false).setAlpha(0);
    visual.lightsReleased = true;
    this.beams.delete(beamId);
    this.beamPool.push(visual);
  }

  private destroyBeamVisual(visual: PlasmaBeamVisual): void {
    visual.root.removeAll(true);
    visual.root.destroy();
  }

  private drawBeam(visual: PlasmaBeamVisual): void {
    const dx = visual.endX - visual.startX;
    const dy = visual.endY - visual.startY;
    const length = Math.hypot(dx, dy);
    const controlCount = Phaser.Math.Clamp(
      Math.ceil(length / CONTROL_POINT_SPACING_PX) + 1,
      MIN_CONTROL_POINTS,
      MAX_CONTROL_POINTS,
    );
    const divisions = Phaser.Math.Clamp(
      Math.ceil(length / RESAMPLE_SPACING_PX),
      MIN_RESAMPLED_POINTS,
      MAX_RESAMPLED_POINTS,
    );
    const jitter = Phaser.Math.Clamp(length * 0.014 + visual.thickness * 0.34, 4.2, 10);
    const phase = this.scene.time.now * 0.015;

    const start = { x: visual.startX, y: visual.startY };
    const end = { x: visual.endX, y: visual.endY };
    const nextMain = createJitteredBeamPath(
      start,
      end,
      controlCount,
      divisions,
      jitter,
      phase,
      visual.motionTrailX,
      visual.motionTrailY,
    );
    const nextOuter = createJitteredBeamPath(start, end, controlCount, divisions, jitter * 0.62, phase + 2.7);
    const nextCore = createJitteredBeamPath(start, end, controlCount, divisions, jitter * 0.38, phase + 5.3);
    visual.mainPath = blendBeamPaths(visual.mainPath, nextMain, 0.62, start, end);
    visual.outerPath = blendBeamPaths(visual.outerPath, nextOuter, 0.5, start, end);
    visual.corePath = blendBeamPaths(visual.corePath, nextCore, 0.72, start, end);

    const palette = getBeamPaletteForPlayerColor(visual.color);
    const mainColor = visual.color;
    const glowColor = mixColors(visual.color, palette.glow, 0.28);
    const coreColor = mixColors(visual.color, 0xffffff, 0.84);

    visual.glow.clear();
    strokeBeamPolyline(visual.glow, visual.outerPath, Math.max(visual.thickness * 5.2, 24), glowColor, 0.055);
    strokeBeamPolyline(visual.glow, visual.outerPath, Math.max(visual.thickness * 3.1, 15), mainColor, 0.14);

    visual.discharge.clear();
    strokeBeamPolyline(visual.discharge, visual.mainPath, Math.max(visual.thickness * 1.08, 4.8), mainColor, 0.86);
    strokeBeamPolyline(visual.discharge, visual.corePath, Math.max(visual.thickness * 0.28, 1.35), coreColor, 0.98);

    visual.filaments.clear();
    this.drawFilaments(visual.filaments, visual.mainPath, jitter, mainColor, glowColor, coreColor);
    this.drawSideBranches(visual.filaments, visual.mainPath, length, jitter, mainColor, glowColor, coreColor);
    this.drawEndpointDischarges(visual, dx, dy, length, mainColor, glowColor, coreColor);
  }

  private drawFilaments(
    graphics: Phaser.GameObjects.Graphics,
    mainPath: readonly BeamPoint[],
    jitter: number,
    mainColor: number,
    glowColor: number,
    coreColor: number,
  ): void {
    if (mainPath.length < 4) return;
    const filamentCount = Phaser.Math.Between(3, 5);

    for (let filament = 0; filament < filamentCount; filament += 1) {
      const startT = Phaser.Math.FloatBetween(0.04, 0.66);
      const endT = Math.min(0.96, startT + Phaser.Math.FloatBetween(0.18, 0.46));
      const controlCount = Phaser.Math.Between(4, 6);
      const side = Math.random() < 0.5 ? -1 : 1;
      const controls: BeamPoint[] = [];

      for (let index = 0; index < controlCount; index += 1) {
        const localT = index / (controlCount - 1);
        const pathT = Phaser.Math.Linear(startT, endT, localT);
        const base = sampleBeamPath(mainPath, pathT);
        const tangent = sampleBeamTangent(mainPath, pathT);
        const envelope = Math.sin(Math.PI * localT);
        const separation = side * jitter * Phaser.Math.FloatBetween(0.18, 0.5) * (0.3 + envelope * 0.7);
        const noise = Phaser.Math.FloatBetween(-jitter * 0.12, jitter * 0.12);
        controls.push({
          x: base.x - tangent.y * (separation + noise),
          y: base.y + tangent.x * (separation + noise),
        });
      }

      const filamentPath = resampleBeamSpline(controls, Phaser.Math.Between(12, 24));
      strokeBeamPolyline(graphics, filamentPath, Phaser.Math.FloatBetween(2.1, 3.2), glowColor, 0.07);
      strokeBeamPolyline(
        graphics,
        filamentPath,
        Phaser.Math.FloatBetween(0.62, 1.08),
        filament % 3 === 0 ? coreColor : filament % 2 === 0 ? glowColor : mainColor,
        Phaser.Math.FloatBetween(0.34, 0.62),
      );
    }
  }

  private drawSideBranches(
    graphics: Phaser.GameObjects.Graphics,
    mainPath: readonly BeamPoint[],
    length: number,
    jitter: number,
    mainColor: number,
    glowColor: number,
    coreColor: number,
  ): void {
    if (mainPath.length < 4) return;
    const roll = Math.random();
    const branchCount = roll < 0.12 ? 2 : roll < 0.48 ? 1 : 0;

    for (let branch = 0; branch < branchCount; branch += 1) {
      const pivotT = Phaser.Math.FloatBetween(0.22, 0.84);
      const pivot = sampleBeamPath(mainPath, pivotT);
      const tangent = sampleBeamTangent(mainPath, pivotT);
      const side = Math.random() < 0.5 ? -1 : 1;
      const baseAngle = Math.atan2(tangent.y, tangent.x);
      const branchAngle = baseAngle + side * Phaser.Math.FloatBetween(0.62, 1.05);
      const branchLength = Phaser.Math.Clamp(length * Phaser.Math.FloatBetween(0.045, 0.085), 10, 29);
      const endX = pivot.x + Math.cos(branchAngle) * branchLength;
      const endY = pivot.y + Math.sin(branchAngle) * branchLength;
      const branchPath = this.createSmoothBranch(pivot.x, pivot.y, endX, endY, jitter * 0.28);

      strokeBeamPolyline(graphics, branchPath, 2.8, glowColor, 0.08);
      strokeBeamPolyline(graphics, branchPath, 0.78, branch === 0 ? coreColor : mainColor, 0.62);
    }
  }

  private createSmoothBranch(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    jitter: number,
  ): BeamPoint[] {
    const dx = endX - startX;
    const dy = endY - startY;
    const length = Math.hypot(dx, dy) || 1;
    const normalX = -dy / length;
    const normalY = dx / length;
    const controls: BeamPoint[] = [{ x: startX, y: startY }];
    for (let index = 1; index < 4; index += 1) {
      const t = index / 4;
      const offset = Phaser.Math.FloatBetween(-jitter, jitter) * Math.sin(Math.PI * t);
      controls.push({
        x: Phaser.Math.Linear(startX, endX, t) + normalX * offset,
        y: Phaser.Math.Linear(startY, endY, t) + normalY * offset,
      });
    }
    controls.push({ x: endX, y: endY });
    return resampleBeamSpline(controls, 10);
  }

  private drawEndpointDischarges(
    visual: PlasmaBeamVisual,
    dx: number,
    dy: number,
    length: number,
    mainColor: number,
    glowColor: number,
    coreColor: number,
  ): void {
    const graphics = visual.endpoints;
    const incomingAngle = length > 0.001 ? Math.atan2(dy, dx) : 0;
    graphics.clear();

    // A free-running beam must not end as a flat line cap. The tapered plasma tip
    // keeps the cursor endpoint readable even when there is no collision impact.
    const tangentX = length > 0.001 ? dx / length : 1;
    const tangentY = length > 0.001 ? dy / length : 0;
    const normalX = -tangentY;
    const normalY = tangentX;
    const tipDepth = Math.min(length * 0.42, Phaser.Math.Clamp(length * 0.08, 8, 18));
    const tipBaseX = visual.endX - tangentX * tipDepth;
    const tipBaseY = visual.endY - tangentY * tipDepth;
    const tipHalfWidth = Math.max(visual.thickness * 1.25, 4.5);

    graphics.fillStyle(glowColor, 0.12);
    graphics.fillTriangle(
      tipBaseX + normalX * tipHalfWidth,
      tipBaseY + normalY * tipHalfWidth,
      tipBaseX - normalX * tipHalfWidth,
      tipBaseY - normalY * tipHalfWidth,
      visual.endX,
      visual.endY,
    );
    graphics.fillStyle(coreColor, 0.62);
    graphics.fillTriangle(
      tipBaseX + normalX * (tipHalfWidth * 0.42),
      tipBaseY + normalY * (tipHalfWidth * 0.42),
      tipBaseX - normalX * (tipHalfWidth * 0.42),
      tipBaseY - normalY * (tipHalfWidth * 0.42),
      visual.endX,
      visual.endY,
    );
    graphics.fillStyle(coreColor, 0.92);
    graphics.fillCircle(visual.endX, visual.endY, Math.max(visual.thickness * 0.72, 2.4));

    for (let filament = 0; filament < 2; filament += 1) {
      const side = filament === 0 ? -1 : 1;
      const branchStartX = tipBaseX + normalX * side * tipHalfWidth * 0.58;
      const branchStartY = tipBaseY + normalY * side * tipHalfWidth * 0.58;
      const branchPath = this.createSmoothBranch(
        branchStartX,
        branchStartY,
        branchStartX - tangentX * Phaser.Math.FloatBetween(1, 5) + normalX * side * Phaser.Math.FloatBetween(2, 6),
        branchStartY - tangentY * Phaser.Math.FloatBetween(1, 5) + normalY * side * Phaser.Math.FloatBetween(2, 6),
        1.2,
      );
      strokeBeamPolyline(graphics, branchPath, 1.8, glowColor, 0.12);
      strokeBeamPolyline(graphics, branchPath, 0.62, coreColor, 0.5);
    }

    for (let ray = 0; ray < 3; ray += 1) {
      const angle = incomingAngle + Phaser.Math.FloatBetween(-0.55, 0.55);
      const inner = Phaser.Math.FloatBetween(2, 5);
      const outer = Phaser.Math.FloatBetween(9, 18);
      graphics.lineStyle(Phaser.Math.FloatBetween(0.65, 1.15), ray === 0 ? coreColor : mainColor, Phaser.Math.FloatBetween(0.34, 0.7));
      graphics.lineBetween(
        visual.startX + Math.cos(angle) * inner,
        visual.startY + Math.sin(angle) * inner,
        visual.startX + Math.cos(angle) * outer,
        visual.startY + Math.sin(angle) * outer,
      );
    }

    if (visual.impactKind === 'none' || !isPointInsideArena(visual.endX, visual.endY)) return;
    const sparkCount = Phaser.Math.Between(4, 7);
    for (let spark = 0; spark < sparkCount; spark += 1) {
      const angle = incomingAngle + Math.PI + Phaser.Math.FloatBetween(-1.4, 1.4);
      const inner = Phaser.Math.FloatBetween(3, 7);
      const outer = Phaser.Math.FloatBetween(12, 28);
      graphics.lineStyle(Phaser.Math.FloatBetween(0.65, 1.2), spark % 3 === 0 ? coreColor : mainColor, Phaser.Math.FloatBetween(0.36, 0.76));
      graphics.lineBetween(
        visual.endX + Math.cos(angle) * inner,
        visual.endY + Math.sin(angle) * inner,
        visual.endX + Math.cos(angle) * outer,
        visual.endY + Math.sin(angle) * outer,
      );
    }

    const dischargeCount = Math.random() < 0.58 ? Phaser.Math.Between(1, 2) : 0;
    for (let discharge = 0; discharge < dischargeCount; discharge += 1) {
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const dischargeLength = Phaser.Math.FloatBetween(10, 24);
      const branchPath = this.createSmoothBranch(
        visual.endX,
        visual.endY,
        visual.endX + Math.cos(angle) * dischargeLength,
        visual.endY + Math.sin(angle) * dischargeLength,
        2.8,
      );
      strokeBeamPolyline(graphics, branchPath, 2.5, glowColor, 0.08);
      strokeBeamPolyline(graphics, branchPath, 0.72, coreColor, 0.72);
    }
  }

  private updateTextureLayers(visual: PlasmaBeamVisual, now: number): void {
    const dx = visual.endX - visual.startX;
    const dy = visual.endY - visual.startY;
    const length = Math.hypot(dx, dy);
    const palette = getBeamPaletteForPlayerColor(visual.color);
    const mainColor = visual.color;
    const glowColor = mixColors(visual.color, palette.glow, 0.28);
    const coreColor = mixColors(visual.color, 0xffffff, 0.84);
    this.updateHazeSamples(visual, now, length, mainColor, glowColor);
    this.updateStreakSamples(visual, now, length, mainColor, coreColor);
    this.updateSparkSamples(visual, now, length, mainColor, coreColor);
    this.updateEndpointImages(visual, now, length, mainColor, glowColor, coreColor);
  }

  private updateHazeSamples(
    visual: PlasmaBeamVisual,
    now: number,
    length: number,
    mainColor: number,
    glowColor: number,
  ): void {
    if (visual.outerPath.length < 2 || length < 1) {
      for (const image of visual.hazeSamples) image.setVisible(false);
      return;
    }
    const count = Phaser.Math.Clamp(Math.round(length / 68), 3, MAX_HAZE_SAMPLES);
    const sampleWidth = Phaser.Math.Clamp((length / count) * 1.55, 56, 108);

    for (let index = 0; index < visual.hazeSamples.length; index += 1) {
      const image = visual.hazeSamples[index];
      if (index >= count) {
        image.setVisible(false);
        continue;
      }
      const baseT = (index + 0.5) / count;
      const t = Phaser.Math.Clamp(baseT + Math.sin(now * 0.0024 + index * 1.9) * 0.012, 0.02, 0.98);
      const point = sampleBeamPath(visual.outerPath, t);
      const tangent = sampleBeamTangent(visual.outerPath, t);
      const drift = Math.sin(now * 0.0053 + index * 2.2) * 2.2;
      const pulse = 0.5 + Math.sin(now * 0.009 + index * 1.43) * 0.5;
      image
        .setVisible(true)
        .setPosition(point.x - tangent.y * drift, point.y + tangent.x * drift)
        .setRotation(Math.atan2(tangent.y, tangent.x))
        .setTint(index % 2 === 0 ? glowColor : mainColor)
        .setDisplaySize(sampleWidth, Phaser.Math.Linear(27, 38, pulse))
        .setAlpha(emissiveAlpha(Phaser.Math.Linear(0.085, 0.15, pulse)));
    }
  }

  private updateStreakSamples(
    visual: PlasmaBeamVisual,
    now: number,
    length: number,
    mainColor: number,
    coreColor: number,
  ): void {
    if (visual.mainPath.length < 2 || length < 1) {
      for (const image of visual.streakSamples) image.setVisible(false);
      return;
    }
    const count = Phaser.Math.Clamp(Math.round(length / 82), 3, MAX_STREAK_SAMPLES);

    for (let index = 0; index < visual.streakSamples.length; index += 1) {
      const image = visual.streakSamples[index];
      if (index >= count) {
        image.setVisible(false);
        continue;
      }
      const movingT = this.wrap01(now * (0.00048 + index * 0.000025) + index / count);
      const t = 0.045 + movingT * 0.91;
      const point = sampleBeamPath(visual.mainPath, t);
      const tangent = sampleBeamTangent(visual.mainPath, t);
      const pulse = 0.5 + Math.sin(now * 0.017 + index * 2.71) * 0.5;
      const lateral = Math.sin(now * 0.011 + index * 1.77) * 1.5;
      image
        .setVisible(true)
        .setPosition(point.x - tangent.y * lateral, point.y + tangent.x * lateral)
        .setRotation(Math.atan2(tangent.y, tangent.x))
        .setTint(index % 3 === 0 ? coreColor : mainColor)
        .setDisplaySize(Phaser.Math.Linear(34, 62, pulse), Phaser.Math.Linear(4.2, 7.2, pulse))
        .setAlpha(emissiveAlpha(Phaser.Math.Linear(0.1, 0.27, pulse)));
    }
  }

  private updateSparkSamples(
    visual: PlasmaBeamVisual,
    now: number,
    length: number,
    mainColor: number,
    coreColor: number,
  ): void {
    if (visual.corePath.length < 2 || length < 1) {
      for (const image of visual.sparkSamples) image.setVisible(false);
      return;
    }
    const count = Phaser.Math.Clamp(Math.round(length / 96), 2, MAX_SPARK_SAMPLES);

    for (let index = 0; index < visual.sparkSamples.length; index += 1) {
      const image = visual.sparkSamples[index];
      if (index >= count) {
        image.setVisible(false);
        continue;
      }
      const movingT = this.wrap01(1 - now * (0.00062 + index * 0.00004) + index / count);
      const t = 0.035 + movingT * 0.93;
      const point = sampleBeamPath(visual.corePath, t);
      const pulse = 0.5 + Math.sin(now * 0.026 + index * 3.17) * 0.5;
      const size = Phaser.Math.Linear(4.5, 9.5, pulse);
      image
        .setVisible(true)
        .setPosition(point.x, point.y)
        .setTint(index % 2 === 0 ? coreColor : mainColor)
        .setDisplaySize(size, size)
        .setAlpha(emissiveAlpha(Phaser.Math.Linear(0.2, 0.7, pulse)));
    }
  }

  private updateEndpointImages(
    visual: PlasmaBeamVisual,
    now: number,
    length: number,
    mainColor: number,
    glowColor: number,
    coreColor: number,
  ): void {
    const tangent = visual.mainPath.length >= 2
      ? sampleBeamTangent(visual.mainPath, 0.02)
      : { x: length > 0.001 ? (visual.endX - visual.startX) / length : 1, y: length > 0.001 ? (visual.endY - visual.startY) / length : 0 };
    const angle = Math.atan2(tangent.y, tangent.x);
    const muzzlePulse = 0.5 + Math.sin(now * 0.024) * 0.5;
    const muzzleSize = Phaser.Math.Linear(30, 43, muzzlePulse);
    visual.muzzleHalo
      .setVisible(true)
      .setPosition(visual.startX, visual.startY)
      .setTint(glowColor)
      .setDisplaySize(muzzleSize, muzzleSize)
      .setAlpha(emissiveAlpha(Phaser.Math.Linear(0.28, 0.46, muzzlePulse)));
    visual.muzzleStreak
      .setVisible(true)
      .setPosition(visual.startX + tangent.x * 7, visual.startY + tangent.y * 7)
      .setRotation(angle)
      .setTint(coreColor)
      .setDisplaySize(Phaser.Math.Linear(28, 42, muzzlePulse), Phaser.Math.Linear(7, 11, muzzlePulse))
      .setAlpha(emissiveAlpha(Phaser.Math.Linear(0.46, 0.76, muzzlePulse)));

    const hasImpact = visual.impactKind !== 'none' && isPointInsideArena(visual.endX, visual.endY);
    if (!hasImpact) {
      visual.impactHalo.setVisible(false);
      visual.impactFlare.setVisible(false);
      return;
    }
    const impactPulse = 0.5 + Math.sin(now * 0.031 + 1.7) * 0.5;
    const impactScale = visual.impactKind === 'player' ? 0.9 : 1.08;
    visual.impactHalo
      .setVisible(true)
      .setPosition(visual.endX, visual.endY)
      .setTint(glowColor)
      .setDisplaySize(
        Phaser.Math.Linear(43, 62, impactPulse) * impactScale,
        Phaser.Math.Linear(43, 62, impactPulse) * impactScale,
      )
      .setAlpha(emissiveAlpha(Phaser.Math.Linear(0.28, 0.5, impactPulse)));
    visual.impactFlare
      .setVisible(true)
      .setPosition(visual.endX, visual.endY)
      .setTint(coreColor)
      .setDisplaySize(
        Phaser.Math.Linear(15, 24, impactPulse) * impactScale,
        Phaser.Math.Linear(15, 24, impactPulse) * impactScale,
      )
      .setAlpha(emissiveAlpha(Phaser.Math.Linear(0.62, 0.92, impactPulse)));
  }

  private hideTextureLayers(visual: PlasmaBeamVisual): void {
    for (const image of visual.hazeSamples) image.setVisible(false);
    for (const image of visual.streakSamples) image.setVisible(false);
    for (const image of visual.sparkSamples) image.setVisible(false);
    visual.muzzleHalo.setVisible(false);
    visual.muzzleStreak.setVisible(false);
    visual.impactHalo.setVisible(false);
    visual.impactFlare.setVisible(false);
  }

  private wrap01(value: number): number {
    return value - Math.floor(value);
  }

  private emitImpactSparks(visual: PlasmaBeamVisual, now: number): void {
    if (visual.impactKind === 'none' || !isPointInsideArena(visual.endX, visual.endY)) return;
    if (now - visual.lastImpactSparkAt < IMPACT_SPARK_INTERVAL_MS) return;

    const emitter = this.ensureImpactSparkEmitter();
    setEmitterTintArray(emitter, [
      0xffffff,
      mixColors(visual.color, 0xffffff, 0.78),
      visual.color,
      mixColors(visual.color, 0xffffff, 0.34),
    ]);
    emitter.emitParticleAt(visual.endX, visual.endY, Phaser.Math.Between(2, 4));
    visual.lastImpactSparkAt = now;
  }

  private ensureImpactSparkEmitter(): Phaser.GameObjects.Particles.ParticleEmitter {
    if (this.impactSparkEmitter) return this.impactSparkEmitter;
    this.generateTextures();
    this.impactSparkEmitter = createEmitter(this.scene, 0, 0, TEX_PLASMA_SPARK, {
      lifespan: { min: 90, max: 190 },
      frequency: -1,
      angle: { min: 0, max: 360 },
      speed: { min: 55, max: 185 },
      scale: { start: 0.9, end: 0 },
      alpha: { start: 0.94, end: 0 },
      tint: [0xffffff],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
      reserve: 64,
      maxParticles: 64,
      maxAliveParticles: 36,
    }, DEPTH_TRACE + 0.2, undefined, 'plasmaBurner');
    return this.impactSparkEmitter;
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

    const count = Phaser.Math.Clamp(Math.ceil(length / BEAM_LIGHT_SPACING_PX), 1, BEAM_MAX_PATH_LIGHTS);
    const lightColor = mixColors(visual.color, 0xffffff, 0.62);
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

    if (visual.impactKind !== 'none' && isPointInsideArena(visual.endX, visual.endY)) {
      const pulse = 0.94 + Math.sin(this.scene.time.now * 0.035 + visual.endX * 0.012 + visual.endY * 0.009) * 0.06;
      this.lighting.setLight(
        this.impactLightKey(beamId),
        'electricArc',
        visual.endX,
        visual.endY,
        {
          color: mixColors(visual.color, 0xffffff, 0.74),
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
