import * as Phaser from 'phaser';
import { COLORS, DEPTH_TRACE, getBeamPaletteForPlayerColor, isPointInsideArena } from '../config';
import { createEmitter, destroyEmitter, ensureCanvasTexture, fillRadialGradientTexture, mixColors } from './EffectUtils';

const TEX_ZEUS_HAZE = '__zeus_taser_haze';
const TEX_ZEUS_STREAK = '__zeus_taser_streak';
const TEX_ZEUS_SPARK = '__zeus_taser_spark';

const ZEUS_LINGER_MULT = 1.35;

export class ZeusTaserRenderer {
  constructor(private readonly scene: Phaser.Scene) {}

  generateTextures(): void {
    fillRadialGradientTexture(this.scene.textures, TEX_ZEUS_HAZE, 96, [
      [0, 'rgba(255,255,255,1.0)'],
      [0.34, 'rgba(214,247,255,0.9)'],
      [0.68, 'rgba(103,196,255,0.28)'],
      [1, 'rgba(103,196,255,0.0)'],
    ]);

    ensureCanvasTexture(this.scene.textures, TEX_ZEUS_STREAK, 128, 28, (ctx) => {
      ctx.clearRect(0, 0, 128, 28);
      const gradient = ctx.createLinearGradient(0, 0, 128, 0);
      gradient.addColorStop(0, 'rgba(255,255,255,0)');
      gradient.addColorStop(0.16, 'rgba(255,255,255,0.68)');
      gradient.addColorStop(0.5, 'rgba(255,255,255,1.0)');
      gradient.addColorStop(0.84, 'rgba(255,255,255,0.68)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.roundRect(6, 10, 116, 8, 4);
      ctx.fill();

      ctx.globalCompositeOperation = 'destination-in';
      const vertical = ctx.createLinearGradient(0, 0, 0, 28);
      vertical.addColorStop(0, 'rgba(255,255,255,0)');
      vertical.addColorStop(0.26, 'rgba(255,255,255,0.9)');
      vertical.addColorStop(0.74, 'rgba(255,255,255,0.9)');
      vertical.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = vertical;
      ctx.fillRect(0, 0, 128, 28);
      ctx.globalCompositeOperation = 'source-over';
    });

    fillRadialGradientTexture(this.scene.textures, TEX_ZEUS_SPARK, 10, [
      [0, 'rgba(255,255,255,1.0)'],
      [0.32, 'rgba(255,255,255,0.92)'],
      [0.72, 'rgba(123,215,255,0.24)'],
      [1, 'rgba(123,215,255,0.0)'],
    ]);
  }

  playSwing(
    x: number,
    y: number,
    angle: number,
    arcDegrees: number,
    range: number,
    playerColor: number,
    hitPlayer = false,
    impactX?: number,
    impactY?: number,
  ): void {
    const resolvedRange = Math.max(range, 18);
    const halfArcRad = Phaser.Math.DegToRad(Math.max(arcDegrees, 8) * 0.5);
    const palette = getBeamPaletteForPlayerColor(playerColor);
    const glowColor = mixColors(playerColor, palette.glow, 0.32);
    const accentColor = mixColors(playerColor, 0xffffff, 0.42);
    const hotColor = mixColors(playerColor, 0xffffff, 0.72);

    const sector = this.scene.add.container(x, y);
    sector.setDepth(DEPTH_TRACE + 0.04);
    sector.setRotation(angle);

    const haze = this.createSectorGlow(resolvedRange, halfArcRad, glowColor, accentColor, hotColor);
    const filaments = this.createFilamentGraphics(resolvedRange, halfArcRad, glowColor, accentColor, hotColor);
    sector.add([haze, filaments]);
    this.addVolumeSprites(sector, resolvedRange, halfArcRad, glowColor, accentColor, hotColor);

    this.scene.tweens.add({
      targets: sector,
      alpha: 0,
      scaleX: 1.05,
      scaleY: 1.09,
      duration: Math.round(240 * ZEUS_LINGER_MULT),
      ease: 'Cubic.easeOut',
      onComplete: () => {
        sector.removeAll(true);
        sector.destroy();
      },
    });

    this.playOriginBurst(x, y, angle, playerColor, accentColor, hotColor, resolvedRange);
    this.playVolumeParticles(x, y, angle, halfArcRad, resolvedRange, playerColor, accentColor, hotColor);

    if (hitPlayer && impactX !== undefined && impactY !== undefined) {
      this.playImpactBurst(x, y, impactX, impactY, playerColor, accentColor, hotColor);
      return;
    }

    const tipX = x + Math.cos(angle) * (resolvedRange * 0.86);
    const tipY = y + Math.sin(angle) * (resolvedRange * 0.86);
    this.playTerminusPulse(tipX, tipY, playerColor, accentColor);
  }

  private createSectorGlow(
    range: number,
    halfArcRad: number,
    glowColor: number,
    accentColor: number,
    hotColor: number,
  ): Phaser.GameObjects.Graphics {
    const gfx = this.scene.add.graphics();
    gfx.setBlendMode(Phaser.BlendModes.ADD);

    gfx.fillStyle(glowColor, 0.12);
    gfx.beginPath();
    gfx.moveTo(0, 0);
    gfx.arc(0, 0, range, -halfArcRad, halfArcRad, false);
    gfx.closePath();
    gfx.fillPath();

    gfx.fillStyle(accentColor, 0.07);
    gfx.beginPath();
    gfx.moveTo(0, 0);
    gfx.arc(0, 0, range * 0.74, -halfArcRad * 0.88, halfArcRad * 0.88, false);
    gfx.closePath();
    gfx.fillPath();

    gfx.lineStyle(4, hotColor, 0.16);
    gfx.beginPath();
    gfx.arc(0, 0, range, -halfArcRad, halfArcRad, false);
    gfx.strokePath();

    gfx.lineStyle(2.2, accentColor, 0.2);
    gfx.beginPath();
    gfx.arc(0, 0, range * 0.82, -halfArcRad * 0.94, halfArcRad * 0.94, false);
    gfx.strokePath();

    gfx.lineStyle(2.6, accentColor, 0.18);
    gfx.lineBetween(0, 0, Math.cos(-halfArcRad) * range, Math.sin(-halfArcRad) * range);
    gfx.lineBetween(0, 0, Math.cos(halfArcRad) * range, Math.sin(halfArcRad) * range);
    return gfx;
  }

  private createFilamentGraphics(
    range: number,
    halfArcRad: number,
    glowColor: number,
    accentColor: number,
    hotColor: number,
  ): Phaser.GameObjects.Graphics {
    const gfx = this.scene.add.graphics();
    gfx.setBlendMode(Phaser.BlendModes.ADD);

    const boltCount = Phaser.Math.Clamp(Math.round(range / 18), 7, 12);
    for (let bolt = 0; bolt < boltCount; bolt++) {
      const endAngle = Phaser.Math.FloatBetween(-halfArcRad, halfArcRad);
      const endRadius = range * Phaser.Math.FloatBetween(0.58, 1);
      const steps = Phaser.Math.Between(4, 6);
      const points: Array<{ x: number; y: number }> = [{ x: 0, y: 0 }];

      for (let step = 1; step < steps; step++) {
        const progress = step / steps;
        const radius = Phaser.Math.Linear(range * 0.08, endRadius, progress);
        const angle = endAngle + Phaser.Math.FloatBetween(-halfArcRad * 0.16, halfArcRad * 0.16) * (1 - progress);
        const jitter = range * 0.02 * (1 - progress);
        points.push({
          x: Math.cos(angle) * radius + Phaser.Math.FloatBetween(-jitter, jitter),
          y: Math.sin(angle) * radius + Phaser.Math.FloatBetween(-jitter, jitter),
        });
      }

      points.push({ x: Math.cos(endAngle) * endRadius, y: Math.sin(endAngle) * endRadius });

      gfx.lineStyle(2.8, glowColor, 0.2);
      gfx.beginPath();
      gfx.moveTo(points[0].x, points[0].y);
      for (let index = 1; index < points.length; index++) gfx.lineTo(points[index].x, points[index].y);
      gfx.strokePath();

      gfx.lineStyle(1.4, bolt % 3 === 0 ? hotColor : accentColor, 0.56);
      gfx.beginPath();
      gfx.moveTo(points[0].x, points[0].y);
      for (let index = 1; index < points.length; index++) gfx.lineTo(points[index].x, points[index].y);
      gfx.strokePath();
    }

    return gfx;
  }

  private addVolumeSprites(
    sector: Phaser.GameObjects.Container,
    range: number,
    halfArcRad: number,
    glowColor: number,
    accentColor: number,
    hotColor: number,
  ): void {
    const rows = 5;

    for (let row = 0; row < rows; row++) {
      const radialT = row / (rows - 1);
      const radius = Phaser.Math.Linear(range * 0.18, range * 0.98, radialT);
      const spread = Phaser.Math.Linear(halfArcRad * 0.22, halfArcRad * 0.98, radialT);
      const nodeCount = row === 0 ? 1 : row + 2;

      for (let node = 0; node < nodeCount; node++) {
        const angleT = nodeCount === 1 ? 0.5 : node / (nodeCount - 1);
        const localAngle = Phaser.Math.Linear(-spread, spread, angleT) + Phaser.Math.FloatBetween(-0.035, 0.035);
        const px = Math.cos(localAngle) * radius;
        const py = Math.sin(localAngle) * radius;

        const haze = this.scene.add.image(px, py, TEX_ZEUS_HAZE)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setTint(node % 2 === 0 ? glowColor : accentColor)
          .setAlpha(Phaser.Math.Linear(0.18, 0.36, radialT))
          .setDisplaySize(
            Phaser.Math.Linear(range * 0.22, range * 0.3, radialT),
            Phaser.Math.Linear(range * 0.18, range * 0.25, radialT),
          );

        const streak = this.scene.add.image(px * 0.88, py * 0.88, TEX_ZEUS_STREAK)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setTint(node % 3 === 0 ? hotColor : accentColor)
          .setAlpha(Phaser.Math.Linear(0.15, 0.32, radialT))
          .setRotation(localAngle)
          .setDisplaySize(
            Phaser.Math.Linear(range * 0.12, range * 0.24, radialT),
            Phaser.Math.Linear(8, 14, radialT),
          );

        sector.add([haze, streak]);
      }
    }
  }

  private playOriginBurst(
    x: number,
    y: number,
    angle: number,
    playerColor: number,
    accentColor: number,
    hotColor: number,
    range: number,
  ): void {
    const halo = this.scene.add.image(x, y, TEX_ZEUS_HAZE)
      .setDepth(DEPTH_TRACE + 0.08)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(mixColors(playerColor, 0xffffff, 0.28))
      .setAlpha(0.82)
      .setDisplaySize(Math.max(range * 0.32, 36), Math.max(range * 0.32, 36));

    const streak = this.scene.add.image(x + Math.cos(angle) * 10, y + Math.sin(angle) * 10, TEX_ZEUS_STREAK)
      .setDepth(DEPTH_TRACE + 0.09)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(hotColor)
      .setAlpha(0.88)
      .setRotation(angle)
      .setDisplaySize(Math.max(range * 0.26, 34), 14);

    this.scene.tweens.add({
      targets: [halo, streak],
      alpha: 0,
      scaleX: 1.18,
      scaleY: 1.18,
      duration: Math.round(150 * ZEUS_LINGER_MULT),
      ease: 'Quad.easeOut',
      onComplete: () => {
        halo.destroy();
        streak.destroy();
      },
    });

    const angleDeg = Phaser.Math.RadToDeg(angle);
    const sparks = createEmitter(this.scene, x, y, TEX_ZEUS_SPARK, {
      lifespan: { min: Math.round(70 * ZEUS_LINGER_MULT), max: Math.round(160 * ZEUS_LINGER_MULT) },
      quantity: 16,
      frequency: -1,
      angle: { min: angleDeg - 24, max: angleDeg + 24 },
      speed: { min: 80, max: 260 },
      scale: { start: 1.1, end: 0 },
      alpha: { start: 0.92, end: 0 },
      tint: [hotColor, accentColor, playerColor],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    }, DEPTH_TRACE + 0.1);
    sparks.explode(16);
    this.scene.time.delayedCall(Math.round(240 * ZEUS_LINGER_MULT), () => destroyEmitter(sparks));
  }

  private playVolumeParticles(
    x: number,
    y: number,
    angle: number,
    halfArcRad: number,
    range: number,
    playerColor: number,
    accentColor: number,
    hotColor: number,
  ): void {
    const volume = createEmitter(this.scene, 0, 0, TEX_ZEUS_SPARK, {
      lifespan: { min: Math.round(80 * ZEUS_LINGER_MULT), max: Math.round(170 * ZEUS_LINGER_MULT) },
      quantity: 1,
      frequency: -1,
      speed: { min: 20, max: 140 },
      scale: { start: 0.95, end: 0 },
      alpha: { start: 0.78, end: 0 },
      tint: [playerColor, accentColor, hotColor],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    }, DEPTH_TRACE + 0.07);

    const rim = createEmitter(this.scene, 0, 0, TEX_ZEUS_SPARK, {
      lifespan: { min: Math.round(110 * ZEUS_LINGER_MULT), max: Math.round(220 * ZEUS_LINGER_MULT) },
      quantity: 2,
      frequency: -1,
      speed: { min: 70, max: 230 },
      scale: { start: 1.15, end: 0 },
      alpha: { start: 0.88, end: 0 },
      tint: [hotColor, accentColor, playerColor],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    }, DEPTH_TRACE + 0.11);

    const volumeBursts = Phaser.Math.Clamp(Math.round(range / 10), 12, 24);
    for (let burst = 0; burst < volumeBursts; burst++) {
      const localAngle = angle + Phaser.Math.FloatBetween(-halfArcRad, halfArcRad);
      const localRange = range * Math.sqrt(Phaser.Math.FloatBetween(0.08, 1));
      const px = x + Math.cos(localAngle) * localRange;
      const py = y + Math.sin(localAngle) * localRange;
      volume.explode(1, px, py);
    }

    const rimBursts = Phaser.Math.Clamp(Math.round(range / 16), 8, 14);
    for (let burst = 0; burst < rimBursts; burst++) {
      const localAngle = angle + Phaser.Math.Linear(-halfArcRad, halfArcRad, burst / Math.max(1, rimBursts - 1));
      const px = x + Math.cos(localAngle) * range;
      const py = y + Math.sin(localAngle) * range;
      rim.explode(2, px, py);
    }

    this.scene.time.delayedCall(Math.round(280 * ZEUS_LINGER_MULT), () => {
      destroyEmitter(volume);
      destroyEmitter(rim);
    });
  }

  private playImpactBurst(
    startX: number,
    startY: number,
    impactX: number,
    impactY: number,
    playerColor: number,
    accentColor: number,
    hotColor: number,
  ): void {
    if (!isPointInsideArena(impactX, impactY)) return;

    const chain = this.scene.add.graphics();
    chain.setDepth(DEPTH_TRACE + 0.13);
    chain.setBlendMode(Phaser.BlendModes.ADD);
    const points = this.createLightningPath(startX, startY, impactX, impactY, 5, 10);

    chain.lineStyle(4.2, mixColors(playerColor, COLORS.BLUE_1, 0.48), 0.18);
    chain.beginPath();
    chain.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index++) chain.lineTo(points[index].x, points[index].y);
    chain.strokePath();

    chain.lineStyle(2.1, hotColor, 0.78);
    chain.beginPath();
    chain.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index++) chain.lineTo(points[index].x, points[index].y);
    chain.strokePath();

    this.scene.tweens.add({
      targets: chain,
      alpha: 0,
      duration: Math.round(180 * ZEUS_LINGER_MULT),
      ease: 'Quad.easeOut',
      onComplete: () => chain.destroy(),
    });

    const halo = this.scene.add.image(impactX, impactY, TEX_ZEUS_HAZE)
      .setDepth(DEPTH_TRACE + 0.14)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(accentColor)
      .setAlpha(0.88)
      .setDisplaySize(52, 52);

    const flash = this.scene.add.image(impactX, impactY, TEX_ZEUS_HAZE)
      .setDepth(DEPTH_TRACE + 0.15)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(hotColor)
      .setAlpha(0.96)
      .setDisplaySize(24, 24);

    this.scene.tweens.add({
      targets: [halo, flash],
      alpha: 0,
      scaleX: 1.45,
      scaleY: 1.45,
      duration: Math.round(220 * ZEUS_LINGER_MULT),
      ease: 'Cubic.easeOut',
      onComplete: () => {
        halo.destroy();
        flash.destroy();
      },
    });

    const sparks = createEmitter(this.scene, impactX, impactY, TEX_ZEUS_SPARK, {
      lifespan: { min: Math.round(110 * ZEUS_LINGER_MULT), max: Math.round(260 * ZEUS_LINGER_MULT) },
      quantity: 18,
      frequency: -1,
      angle: { min: 0, max: 360 },
      speed: { min: 80, max: 260 },
      scale: { start: 1.25, end: 0 },
      alpha: { start: 0.94, end: 0 },
      tint: [0xffffff, hotColor, accentColor, playerColor],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    }, DEPTH_TRACE + 0.16);
    sparks.explode(18);

    const branches = this.scene.add.graphics();
    branches.setDepth(DEPTH_TRACE + 0.15);
    branches.setBlendMode(Phaser.BlendModes.ADD);
    for (let bolt = 0; bolt < 5; bolt++) {
      const branchAngle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const branchLength = Phaser.Math.FloatBetween(12, 28);
      const branchPath = this.createLightningPath(
        impactX,
        impactY,
        impactX + Math.cos(branchAngle) * branchLength,
        impactY + Math.sin(branchAngle) * branchLength,
        3,
        6,
      );
      branches.lineStyle(2.4, accentColor, 0.22);
      branches.beginPath();
      branches.moveTo(branchPath[0].x, branchPath[0].y);
      for (let index = 1; index < branchPath.length; index++) branches.lineTo(branchPath[index].x, branchPath[index].y);
      branches.strokePath();
      branches.lineStyle(1.2, hotColor, 0.7);
      branches.beginPath();
      branches.moveTo(branchPath[0].x, branchPath[0].y);
      for (let index = 1; index < branchPath.length; index++) branches.lineTo(branchPath[index].x, branchPath[index].y);
      branches.strokePath();
    }

    this.scene.tweens.add({
      targets: branches,
      alpha: 0,
      duration: Math.round(220 * ZEUS_LINGER_MULT),
      ease: 'Quad.easeOut',
      onComplete: () => branches.destroy(),
    });

    this.scene.time.delayedCall(Math.round(300 * ZEUS_LINGER_MULT), () => destroyEmitter(sparks));
  }

  private playTerminusPulse(
    x: number,
    y: number,
    playerColor: number,
    accentColor: number,
  ): void {
    if (!isPointInsideArena(x, y)) return;

    const pulse = this.scene.add.image(x, y, TEX_ZEUS_HAZE)
      .setDepth(DEPTH_TRACE + 0.12)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(accentColor)
      .setAlpha(0.38)
      .setDisplaySize(22, 22);
    const core = this.scene.add.image(x, y, TEX_ZEUS_HAZE)
      .setDepth(DEPTH_TRACE + 0.13)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(mixColors(playerColor, 0xffffff, 0.5))
      .setAlpha(0.42)
      .setDisplaySize(10, 10);

    this.scene.tweens.add({
      targets: [pulse, core],
      alpha: 0,
      scaleX: 1.6,
      scaleY: 1.6,
      duration: Math.round(140 * ZEUS_LINGER_MULT),
      ease: 'Quad.easeOut',
      onComplete: () => {
        pulse.destroy();
        core.destroy();
      },
    });
  }

  private createLightningPath(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    steps: number,
    maxJitter: number,
  ): Array<{ x: number; y: number }> {
    const points = [{ x: startX, y: startY }];
    const dx = endX - startX;
    const dy = endY - startY;
    const length = Math.hypot(dx, dy) || 1;
    const normalX = -dy / length;
    const normalY = dx / length;

    for (let step = 1; step < steps; step++) {
      const progress = step / steps;
      const jitter = Phaser.Math.FloatBetween(-maxJitter, maxJitter) * (1 - Math.abs(progress - 0.5) * 1.2);
      points.push({
        x: Phaser.Math.Linear(startX, endX, progress) + normalX * jitter,
        y: Phaser.Math.Linear(startY, endY, progress) + normalY * jitter,
      });
    }

    points.push({ x: endX, y: endY });
    return points;
  }
}