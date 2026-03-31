import Phaser from 'phaser';
import { COLORS, DEPTH_TRACE, clipPointToArenaRay, isPointInsideArena } from '../config';
import type { HitscanImpactKind } from '../types';
import { createEmitter, destroyEmitter, ensureCanvasTexture, fillRadialGradientTexture, mixColors } from './EffectUtils';
import type { MuzzleFlashRenderer } from './MuzzleFlashRenderer';

const TEX_ASMD_BEAM_GLOW = '__asmd_beam_glow';
const TEX_ASMD_BEAM_CORE = '__asmd_beam_core';
const TEX_ASMD_SPARK = '__asmd_primary_spark';

const ASMD_PRIMARY_LINGER_MULT = 1.7;

export class AsmdPrimaryRenderer {
  private muzzleFlashRenderer: MuzzleFlashRenderer | null = null;

  constructor(private readonly scene: Phaser.Scene) {}

  setMuzzleFlashRenderer(renderer: MuzzleFlashRenderer | null): void {
    this.muzzleFlashRenderer = renderer;
  }

  generateTextures(): void {
    ensureCanvasTexture(this.scene.textures, TEX_ASMD_BEAM_GLOW, 96, 36, (ctx) => {
      ctx.clearRect(0, 0, 96, 36);
      const bodyGradient = ctx.createLinearGradient(0, 0, 96, 0);
      bodyGradient.addColorStop(0, 'rgba(255,255,255,0)');
      bodyGradient.addColorStop(0.18, 'rgba(255,255,255,0.72)');
      bodyGradient.addColorStop(0.82, 'rgba(255,255,255,0.72)');
      bodyGradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = bodyGradient;
      ctx.beginPath();
      ctx.roundRect(4, 6, 88, 24, 12);
      ctx.fill();

      ctx.globalCompositeOperation = 'destination-in';
      const verticalGradient = ctx.createLinearGradient(0, 0, 0, 36);
      verticalGradient.addColorStop(0, 'rgba(255,255,255,0)');
      verticalGradient.addColorStop(0.28, 'rgba(255,255,255,0.92)');
      verticalGradient.addColorStop(0.72, 'rgba(255,255,255,0.92)');
      verticalGradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = verticalGradient;
      ctx.fillRect(0, 0, 96, 36);
      ctx.globalCompositeOperation = 'source-over';
    });

    ensureCanvasTexture(this.scene.textures, TEX_ASMD_BEAM_CORE, 96, 14, (ctx) => {
      ctx.clearRect(0, 0, 96, 14);
      const bodyGradient = ctx.createLinearGradient(0, 0, 96, 0);
      bodyGradient.addColorStop(0, 'rgba(255,255,255,0)');
      bodyGradient.addColorStop(0.12, 'rgba(255,255,255,0.58)');
      bodyGradient.addColorStop(0.5, 'rgba(255,255,255,1)');
      bodyGradient.addColorStop(0.88, 'rgba(255,255,255,0.58)');
      bodyGradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = bodyGradient;
      ctx.beginPath();
      ctx.roundRect(4, 4, 88, 6, 3);
      ctx.fill();
    });

    fillRadialGradientTexture(this.scene.textures, TEX_ASMD_SPARK, 8, [
      [0, 'rgba(255,255,255,1.0)'],
      [0.38, 'rgba(215,251,255,0.82)'],
      [0.7, 'rgba(115,190,211,0.26)'],
      [1, 'rgba(115,190,211,0.0)'],
    ]);
  }

  playTracer(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    playerColor: number,
    thickness: number,
    impactKind: HitscanImpactKind = 'environment',
  ): void {
    const clippedEnd = clipPointToArenaRay(startX, startY, endX, endY);
    const renderEndX = clippedEnd.x;
    const renderEndY = clippedEnd.y;
    const clippedDx = renderEndX - endX;
    const clippedDy = renderEndY - endY;
    const clippedByArena = (clippedDx * clippedDx) + (clippedDy * clippedDy) > 0.25;
    const resolvedImpactKind: HitscanImpactKind = impactKind === 'none' && clippedByArena ? 'environment' : impactKind;

    this.muzzleFlashRenderer?.playHitscanFlash(startX, startY, renderEndX - startX, renderEndY - startY, 'asmd_primary', playerColor);

    const dx = renderEndX - startX;
    const dy = renderEndY - startY;
    const beamLength = Math.hypot(dx, dy);
    if (beamLength <= 1) {
      if (resolvedImpactKind !== 'none') this.playImpact(renderEndX, renderEndY, playerColor, thickness, resolvedImpactKind);
      return;
    }

    const angle = Math.atan2(dy, dx);
    const beamThickness = Math.max(thickness * 2.35, 8);
    const segmentCount = Phaser.Math.Clamp(Math.round(beamLength / 64), 4, 11);
    const segmentLength = beamLength / segmentCount;
    const glowColor = playerColor;
    const accentColor = mixColors(playerColor, 0xffffff, 0.28);
    const coreColor = mixColors(playerColor, 0xffffff, 0.6);

    this.playMuzzleBurst(startX, startY, angle, playerColor, beamThickness);

    for (let index = 0; index < segmentCount; index++) {
      const startT = index / segmentCount;
      const endT = (index + 1) / segmentCount;
      const centerT = (startT + endT) * 0.5;
      const segmentX = Phaser.Math.Linear(startX, renderEndX, centerT);
      const segmentY = Phaser.Math.Linear(startY, renderEndY, centerT);
      const segment = this.scene.add.container(segmentX, segmentY);
      segment.setDepth(DEPTH_TRACE + 0.02 + centerT * 0.05);
      segment.setRotation(angle);
      segment.setAlpha(Phaser.Math.Linear(0.78, 1, centerT));

      const outerGlow = this.scene.add.image(0, 0, TEX_ASMD_BEAM_GLOW)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(glowColor)
        .setAlpha(0.52)
        .setDisplaySize(segmentLength * 1.12, beamThickness * 2.25);
      const fringeGlow = this.scene.add.image(0, Phaser.Math.FloatBetween(-beamThickness * 0.12, beamThickness * 0.12), TEX_ASMD_BEAM_GLOW)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(accentColor)
        .setAlpha(0.3)
        .setDisplaySize(segmentLength * 1.18, beamThickness * 1.45);
      const core = this.scene.add.image(0, 0, TEX_ASMD_BEAM_CORE)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(accentColor)
        .setAlpha(0.94)
        .setDisplaySize(segmentLength * 1.04, Math.max(thickness * 1.25, 3.4));
      const hotCore = this.scene.add.image(0, 0, TEX_ASMD_BEAM_CORE)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(coreColor)
        .setAlpha(0.56)
        .setDisplaySize(segmentLength * 0.94, Math.max(thickness * 0.5, 1.7));
      const arcs = this.createArcOverlay(segmentLength, beamThickness, glowColor, accentColor, Phaser.Math.Linear(0.8, 1.25, centerT));
      segment.add([outerGlow, fringeGlow, core, hotCore, arcs]);

      this.scene.tweens.add({
        targets: segment,
        alpha: 0,
        scaleX: 1.04,
        scaleY: 0.72,
        delay: Math.round(startT * 92 * ASMD_PRIMARY_LINGER_MULT),
        duration: Math.round(Phaser.Math.Linear(96, 190, endT) * ASMD_PRIMARY_LINGER_MULT),
        ease: 'Cubic.easeOut',
        onComplete: () => {
          segment.removeAll(true);
          segment.destroy();
        },
      });
    }

    this.playBeamParticles(startX, startY, renderEndX, renderEndY, playerColor, beamThickness);
    if (resolvedImpactKind !== 'none') this.playImpact(renderEndX, renderEndY, playerColor, thickness, resolvedImpactKind);
  }

  private playImpact(
    x: number,
    y: number,
    playerColor: number,
    thickness: number,
    impactKind: HitscanImpactKind,
  ): void {
    if (impactKind === 'none' || !isPointInsideArena(x, y)) return;

    const baseColor = mixColors(playerColor, COLORS.BLUE_1, 0.48);
    const haloRadius = Math.max(thickness * (impactKind === 'player' ? 2.6 : 3.4), impactKind === 'player' ? 7 : 9);
    const halo = this.scene.add.circle(x, y, haloRadius, baseColor, 0.42);
    halo.setDepth(DEPTH_TRACE + 0.1);
    halo.setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({
      targets: halo,
      alpha: 0,
      scaleX: 1.8,
      scaleY: 1.8,
      duration: 170,
      ease: 'Quad.easeOut',
      onComplete: () => halo.destroy(),
    });

    const flashColor = mixColors(playerColor, 0xffffff, impactKind === 'player' ? 0.58 : 0.42);
    const flash = this.scene.add.circle(x, y, Math.max(thickness * (impactKind === 'player' ? 1.8 : 1.35), 3), flashColor, 0.72);
    flash.setDepth(DEPTH_TRACE + 0.13);
    flash.setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({
      targets: flash,
      alpha: 0,
      scaleX: impactKind === 'player' ? 1.7 : 1.45,
      scaleY: impactKind === 'player' ? 1.7 : 1.45,
      duration: impactKind === 'player' ? 120 : 100,
      ease: 'Quad.easeOut',
      onComplete: () => flash.destroy(),
    });

    const sparks = createEmitter(this.scene, x, y, TEX_ASMD_SPARK, {
      lifespan: impactKind === 'player'
        ? { min: Math.round(90 * ASMD_PRIMARY_LINGER_MULT), max: Math.round(180 * ASMD_PRIMARY_LINGER_MULT) }
        : { min: Math.round(120 * ASMD_PRIMARY_LINGER_MULT), max: Math.round(260 * ASMD_PRIMARY_LINGER_MULT) },
      quantity: impactKind === 'player' ? 9 : 15,
      frequency: -1,
      speed: impactKind === 'player' ? { min: 36, max: 110 } : { min: 55, max: 180 },
      angle: { min: 0, max: 360 },
      scale: { start: impactKind === 'player' ? 0.8 : 1.0, end: 0 },
      alpha: { start: 0.9, end: 0 },
      tint: [0xffffff, mixColors(playerColor, 0xffffff, 0.45), playerColor],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    }, DEPTH_TRACE + 0.12);
    sparks.explode(impactKind === 'player' ? 9 : 15);
    this.scene.time.delayedCall(Math.round(320 * ASMD_PRIMARY_LINGER_MULT), () => destroyEmitter(sparks));

    this.playImpactArcs(
      x,
      y,
      Math.max(thickness * (impactKind === 'player' ? 2.3 : 3), 8),
      playerColor,
      flashColor,
      impactKind === 'player' ? 3 : 5,
      Math.round((impactKind === 'player' ? 130 : 180) * ASMD_PRIMARY_LINGER_MULT),
    );
  }

  private playMuzzleBurst(
    x: number,
    y: number,
    angle: number,
    playerColor: number,
    beamThickness: number,
  ): void {
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    const glowColor = playerColor;
    const accentColor = mixColors(playerColor, 0xffffff, 0.42);
    const hotColor = mixColors(playerColor, 0xffffff, 0.68);
    const flashX = x + dirX * beamThickness * 0.55;
    const flashY = y + dirY * beamThickness * 0.55;

    const bloom = this.scene.add.circle(x, y, Math.max(beamThickness * 1.18, 7), glowColor, 0.28);
    bloom.setDepth(DEPTH_TRACE + 0.1);
    bloom.setBlendMode(Phaser.BlendModes.ADD);

    const flare = this.scene.add.image(flashX, flashY, TEX_ASMD_BEAM_GLOW)
      .setDepth(DEPTH_TRACE + 0.11)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(accentColor)
      .setAlpha(0.62)
      .setRotation(angle)
      .setDisplaySize(Math.max(beamThickness * 5.8, 34), Math.max(beamThickness * 2.4, 14));
    const core = this.scene.add.image(flashX, flashY, TEX_ASMD_BEAM_CORE)
      .setDepth(DEPTH_TRACE + 0.12)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(hotColor)
      .setAlpha(0.78)
      .setRotation(angle)
      .setDisplaySize(Math.max(beamThickness * 4.1, 22), Math.max(beamThickness * 0.7, 3));

    this.scene.tweens.add({
      targets: [bloom, flare, core],
      alpha: 0,
      scaleX: 1.22,
      scaleY: 1.22,
      duration: Math.round(120 * 1.25),
      ease: 'Quad.easeOut',
      onComplete: () => {
        bloom.destroy();
        flare.destroy();
        core.destroy();
      },
    });

    const angleDeg = Phaser.Math.RadToDeg(angle);
    const sparks = createEmitter(this.scene, x, y, TEX_ASMD_SPARK, {
      lifespan: { min: Math.round(80 * ASMD_PRIMARY_LINGER_MULT), max: Math.round(150 * ASMD_PRIMARY_LINGER_MULT) },
      quantity: 12,
      frequency: -1,
      angle: { min: angleDeg - 24, max: angleDeg + 24 },
      speed: { min: 80, max: 240 },
      scale: { start: 0.92, end: 0 },
      alpha: { start: 0.84, end: 0 },
      tint: [hotColor, accentColor, glowColor],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    }, DEPTH_TRACE + 0.13);
    sparks.explode(12);
    this.scene.time.delayedCall(Math.round(220 * ASMD_PRIMARY_LINGER_MULT), () => destroyEmitter(sparks));
  }

  private playBeamParticles(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    playerColor: number,
    beamThickness: number,
  ): void {
    const dx = endX - startX;
    const dy = endY - startY;
    const beamLength = Math.hypot(dx, dy);
    if (beamLength <= 8) return;

    const angleDeg = Phaser.Math.RadToDeg(Math.atan2(dy, dx));
    const accentColor = mixColors(playerColor, 0xffffff, 0.35);
    const hotColor = mixColors(playerColor, 0xffffff, 0.62);
    const quantity = Phaser.Math.Clamp(Math.round(beamLength / 28), 12, 30);
    const frontQuantity = Phaser.Math.Clamp(Math.round(beamLength / 44), 8, 18);
    const beamZone = {
      type: 'random',
      source: new Phaser.Geom.Line(startX, startY, endX, endY),
    } as Phaser.Types.GameObjects.Particles.EmitZoneData;
    const frontZone = {
      type: 'random',
      source: new Phaser.Geom.Line(
        Phaser.Math.Linear(startX, endX, 0.58),
        Phaser.Math.Linear(startY, endY, 0.58),
        endX,
        endY,
      ),
    } as Phaser.Types.GameObjects.Particles.EmitZoneData;

    const flow = createEmitter(this.scene, 0, 0, TEX_ASMD_SPARK, {
      lifespan: { min: Math.round(70 * ASMD_PRIMARY_LINGER_MULT), max: Math.round(135 * ASMD_PRIMARY_LINGER_MULT) },
      quantity,
      frequency: -1,
      emitZone: beamZone,
      angle: { min: angleDeg - 10, max: angleDeg + 10 },
      speed: { min: 120, max: 320 },
      scale: { start: Math.max(beamThickness * 0.11, 0.75), end: 0 },
      alpha: { start: 0.66, end: 0 },
      tint: [playerColor, accentColor, hotColor],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    }, DEPTH_TRACE + 0.08);
    flow.explode(quantity);

    const front = createEmitter(this.scene, 0, 0, TEX_ASMD_SPARK, {
      lifespan: { min: Math.round(140 * ASMD_PRIMARY_LINGER_MULT), max: Math.round(220 * ASMD_PRIMARY_LINGER_MULT) },
      quantity: frontQuantity,
      frequency: -1,
      emitZone: frontZone,
      angle: { min: angleDeg - 24, max: angleDeg + 24 },
      speed: { min: 40, max: 160 },
      scale: { start: Math.max(beamThickness * 0.14, 1.05), end: 0 },
      alpha: { start: 0.84, end: 0 },
      tint: [hotColor, accentColor, playerColor],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    }, DEPTH_TRACE + 0.1);
    front.explode(frontQuantity);

    this.scene.time.delayedCall(Math.round(320 * ASMD_PRIMARY_LINGER_MULT), () => {
      destroyEmitter(flow);
      destroyEmitter(front);
    });
  }

  private createArcOverlay(
    segmentLength: number,
    beamThickness: number,
    playerColor: number,
    accentColor: number,
    turbulence: number,
  ): Phaser.GameObjects.Graphics {
    const gfx = this.scene.add.graphics();
    gfx.setBlendMode(Phaser.BlendModes.ADD);
    const halfLength = segmentLength * 0.52;
    const lineCount = turbulence > 1 ? 3 : 2;

    for (let index = 0; index < lineCount; index++) {
      const side = index % 2 === 0 ? -1 : 1;
      const baseOffset = side * beamThickness * Phaser.Math.FloatBetween(0.16, 0.34);
      const amplitude = beamThickness * Phaser.Math.FloatBetween(0.22, 0.46) * turbulence;
      const points: Array<{ x: number; y: number }> = [];

      for (let step = 0; step <= 4; step++) {
        const progress = step / 4;
        const x = Phaser.Math.Linear(-halfLength, halfLength, progress);
        const zigzag = step === 0 || step === 4 ? 0 : ((step % 2 === 0 ? 1 : -1) * amplitude * Phaser.Math.FloatBetween(0.45, 1));
        const y = baseOffset + zigzag + Phaser.Math.FloatBetween(-beamThickness * 0.06, beamThickness * 0.06);
        points.push({ x, y });
      }

      gfx.lineStyle(Math.max(beamThickness * 0.08, 1.6), playerColor, 0.22);
      gfx.beginPath();
      gfx.moveTo(points[0].x, points[0].y);
      for (let step = 1; step < points.length; step++) gfx.lineTo(points[step].x, points[step].y);
      gfx.strokePath();

      gfx.lineStyle(Math.max(beamThickness * 0.04, 0.9), accentColor, 0.42);
      gfx.beginPath();
      gfx.moveTo(points[0].x, points[0].y);
      for (let step = 1; step < points.length; step++) gfx.lineTo(points[step].x, points[step].y);
      gfx.strokePath();
    }

    return gfx;
  }

  private playImpactArcs(
    x: number,
    y: number,
    radius: number,
    playerColor: number,
    accentColor: number,
    boltCount: number,
    duration: number,
  ): void {
    const gfx = this.scene.add.graphics();
    gfx.setPosition(x, y);
    gfx.setDepth(DEPTH_TRACE + 0.14);
    gfx.setBlendMode(Phaser.BlendModes.ADD);

    for (let bolt = 0; bolt < boltCount; bolt++) {
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const length = Phaser.Math.FloatBetween(radius * 0.9, radius * 1.8);
      const jitter = radius * Phaser.Math.FloatBetween(0.16, 0.32);
      const points = [
        { x: 0, y: 0 },
        { x: Math.cos(angle) * length * 0.35 + Phaser.Math.FloatBetween(-jitter, jitter), y: Math.sin(angle) * length * 0.35 + Phaser.Math.FloatBetween(-jitter, jitter) },
        { x: Math.cos(angle) * length * 0.72 + Phaser.Math.FloatBetween(-jitter, jitter), y: Math.sin(angle) * length * 0.72 + Phaser.Math.FloatBetween(-jitter, jitter) },
        { x: Math.cos(angle) * length, y: Math.sin(angle) * length },
      ];

      gfx.lineStyle(Math.max(radius * 0.08, 1.8), playerColor, 0.24);
      gfx.beginPath();
      gfx.moveTo(points[0].x, points[0].y);
      for (let index = 1; index < points.length; index++) gfx.lineTo(points[index].x, points[index].y);
      gfx.strokePath();

      gfx.lineStyle(Math.max(radius * 0.04, 1), accentColor, 0.44);
      gfx.beginPath();
      gfx.moveTo(points[0].x, points[0].y);
      for (let index = 1; index < points.length; index++) gfx.lineTo(points[index].x, points[index].y);
      gfx.strokePath();
    }

    this.scene.tweens.add({
      targets: gfx,
      alpha: 0,
      scaleX: 1.12,
      scaleY: 1.12,
      duration,
      ease: 'Quad.easeOut',
      onComplete: () => gfx.destroy(),
    });
  }
}