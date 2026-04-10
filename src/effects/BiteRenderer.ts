import * as Phaser from 'phaser';
import { DEPTH_TRACE, isPointInsideArena } from '../config';
import { createEmitter, destroyEmitter, ensureCanvasTexture, fillRadialGradientTexture } from './EffectUtils';

const TEX_BITE_HAZE = '__bite_haze';
const TEX_BITE_DROPLET = '__bite_droplet';
const TEX_BITE_FLECK = '__bite_fleck';
const TEX_BITE_MIST = '__bite_mist';

const BITE_LINGER_MS = 285;

const BITE_PALETTE = {
  shadow:  0x140608,
  deepRed: 0x4c0f13,
  gore:    0x851419,
  hot:     0xbf1f26,
  ivory:   0xf1eee6,
  mist:    0xd8d1c7,
} as const;

interface ClawPath {
  startX: number;
  startY: number;
  controlX: number;
  controlY: number;
  endX: number;
  endY: number;
  widthStart: number;
  widthMid: number;
  widthEnd: number;
  jaggedness: number;
  seed: number;
}

export class BiteRenderer {
  constructor(private readonly scene: Phaser.Scene) {}

  generateTextures(): void {
    fillRadialGradientTexture(this.scene.textures, TEX_BITE_HAZE, 112, [
      [0, 'rgba(255,255,255,1)'],
      [0.34, 'rgba(255,255,255,0.52)'],
      [0.72, 'rgba(255,255,255,0.12)'],
      [1, 'rgba(255,255,255,0)'],
    ]);

    fillRadialGradientTexture(this.scene.textures, TEX_BITE_DROPLET, 16, [
      [0, 'rgba(255,255,255,1)'],
      [0.58, 'rgba(255,255,255,0.92)'],
      [1, 'rgba(255,255,255,0)'],
    ]);

    ensureCanvasTexture(this.scene.textures, TEX_BITE_FLECK, 14, 14, (ctx) => {
      ctx.clearRect(0, 0, 14, 14);
      ctx.fillStyle = 'rgba(255,255,255,1)';
      ctx.beginPath();
      ctx.moveTo(2, 7);
      ctx.lineTo(5, 1);
      ctx.lineTo(11, 2);
      ctx.lineTo(12, 7);
      ctx.lineTo(7, 13);
      ctx.lineTo(2, 11);
      ctx.closePath();
      ctx.fill();
    });

    fillRadialGradientTexture(this.scene.textures, TEX_BITE_MIST, 96, [
      [0, 'rgba(255,255,255,0.72)'],
      [0.42, 'rgba(255,255,255,0.22)'],
      [1, 'rgba(255,255,255,0)'],
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
    void playerColor;

    const resolvedRange = Math.max(range, 24);
    const halfArcRad = Phaser.Math.DegToRad(Math.max(arcDegrees, 10) * 0.5);
    const rotationJitter = Phaser.Math.FloatBetween(-halfArcRad * 0.08, halfArcRad * 0.08);
    const clawPaths = this.buildClawPaths(resolvedRange, halfArcRad);
    const slash = this.scene.add.container(x, y);
    slash.setDepth(DEPTH_TRACE + 0.04);
    slash.setRotation(angle + rotationJitter);

    slash.add([
      this.createClawFillLayer(clawPaths, BITE_PALETTE.shadow, 0.96, 1.08, 1.08),
      this.createClawFillLayer(clawPaths, BITE_PALETTE.deepRed, 0.86, 0.76, 0.92),
      this.createClawFillLayer(clawPaths, BITE_PALETTE.gore, 0.54, 0.5, 0.62),
      this.createClawStrokeLayer(clawPaths, BITE_PALETTE.hot, 0.34, 0.08, 0.18),
      this.createOriginMist(clawPaths),
    ]);

    this.scene.tweens.add({
      targets: slash,
      alpha: 0,
      scaleX: 1.03,
      scaleY: 1.08,
      duration: BITE_LINGER_MS,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        slash.removeAll(true);
        slash.destroy();
      },
    });

    this.playClawWake(x, y, angle + rotationJitter, clawPaths);
    this.playVolumeParticles(x, y, angle + rotationJitter, clawPaths, hitPlayer);

    if (hitPlayer && impactX !== undefined && impactY !== undefined) {
      this.playImpactBurst(angle + rotationJitter, impactX, impactY, resolvedRange, halfArcRad);
      return;
    }

    const centerClaw = clawPaths[1];
    const tip = this.toWorldPoint(centerClaw.endX, centerClaw.endY, x, y, angle + rotationJitter);
    this.playAirSnap(tip.x, tip.y, angle + rotationJitter, centerClaw.widthMid);
  }

  private buildClawPaths(range: number, halfArcRad: number): ClawPath[] {
    const spacing = Phaser.Math.Clamp(range * 0.18, 8, 14);
    const offsets = [-1, 0, 1] as const;

    return offsets.map((offset, index) => {
      const sideAngle = (offset * halfArcRad * 0.72) + Phaser.Math.FloatBetween(-halfArcRad * 0.05, halfArcRad * 0.05);
      const length = range * Phaser.Math.FloatBetween(index === 1 ? 0.94 : 0.88, index === 1 ? 0.99 : 0.95);
      const startX = range * Phaser.Math.FloatBetween(0.04, 0.08);
      const startY = offset * spacing * Phaser.Math.FloatBetween(0.74, 1.04);
      const controlX = length * Phaser.Math.FloatBetween(0.46, 0.58);
      const controlY = (offset * spacing * Phaser.Math.FloatBetween(0.92, 1.3)) - (range * Phaser.Math.FloatBetween(0.08, 0.18));
      const endX = Math.cos(sideAngle) * length;
      const endY = (Math.sin(sideAngle) * length) + (offset * spacing * Phaser.Math.FloatBetween(0.08, 0.24));
      const widthMid = Phaser.Math.Linear(range * 0.18, range * 0.26, index === 1 ? 1 : 0.62) * Phaser.Math.FloatBetween(0.96, 1.06);

      return {
        startX,
        startY,
        controlX,
        controlY,
        endX,
        endY,
        widthStart: widthMid * Phaser.Math.FloatBetween(0.34, 0.46),
        widthMid,
        widthEnd: Math.max(0.8, widthMid * Phaser.Math.FloatBetween(0.03, 0.08)),
        jaggedness: widthMid * Phaser.Math.FloatBetween(0.18, 0.28),
        seed: Math.random() * 10000,
      };
    });
  }

  private buildImpactClawPaths(size: number): ClawPath[] {
    const spacing = Phaser.Math.Clamp(size * 0.18, 5, 10);
    const offsets = [-1, 0, 1] as const;

    return offsets.map((offset, index) => {
      const widthMid = Phaser.Math.Linear(size * 0.18, size * 0.26, index === 1 ? 1 : 0.62);
      return {
        startX: -size * 0.28,
        startY: offset * spacing * 0.8,
        controlX: size * Phaser.Math.FloatBetween(-0.02, 0.06),
        controlY: (offset * spacing * Phaser.Math.FloatBetween(0.9, 1.2)) - (size * Phaser.Math.FloatBetween(0.12, 0.22)),
        endX: size * Phaser.Math.FloatBetween(0.38, 0.48),
        endY: (offset * spacing * Phaser.Math.FloatBetween(0.2, 0.42)) - (size * 0.08),
        widthStart: widthMid * 0.42,
        widthMid,
        widthEnd: Math.max(0.8, widthMid * 0.06),
        jaggedness: widthMid * 0.22,
        seed: Math.random() * 10000,
      };
    });
  }

  private createClawFillLayer(
    clawPaths: readonly ClawPath[],
    color: number,
    alpha: number,
    widthScale: number,
    roughnessScale: number,
    xOffset = 0,
    yOffset = 0,
  ): Phaser.GameObjects.Graphics {
    const gfx = this.scene.add.graphics();
    gfx.setBlendMode(Phaser.BlendModes.NORMAL);

    for (const claw of clawPaths) {
      this.fillClawShape(gfx, claw, color, alpha, widthScale, roughnessScale, xOffset, yOffset);
    }

    return gfx;
  }

  private createClawStrokeLayer(
    clawPaths: readonly ClawPath[],
    color: number,
    alpha: number,
    widthScale: number,
    offsetFactor: number,
  ): Phaser.GameObjects.Graphics {
    const gfx = this.scene.add.graphics();
    gfx.setBlendMode(Phaser.BlendModes.ADD);

    for (const claw of clawPaths) {
      gfx.lineStyle(Math.max(0.8, claw.widthMid * widthScale), color, alpha);
      this.strokeQuadratic(
        gfx,
        claw.startX + (claw.widthMid * offsetFactor * 0.18),
        claw.startY - (claw.widthMid * offsetFactor * 0.1),
        claw.controlX + (claw.widthMid * offsetFactor * 0.08),
        claw.controlY - (claw.widthMid * offsetFactor * 0.16),
        claw.endX,
        claw.endY,
        12,
      );
    }

    return gfx;
  }

  private createOriginMist(clawPaths: readonly ClawPath[]): Phaser.GameObjects.Container {
    const container = this.scene.add.container(0, 0);
    for (const claw of clawPaths) {
      const mist = this.scene.add.image(claw.startX, claw.startY, TEX_BITE_MIST)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(BITE_PALETTE.gore)
        .setAlpha(0.16)
        .setDisplaySize(claw.widthMid * 2.1, claw.widthMid * 1.5);
      container.add(mist);
    }
    return container;
  }

  private playClawWake(
    x: number,
    y: number,
    angle: number,
    clawPaths: readonly ClawPath[],
  ): void {
    const wake = this.scene.add.container(x, y);
    wake.setDepth(DEPTH_TRACE + 0.08);
    wake.setRotation(angle);
    wake.add([
      this.createClawFillLayer(clawPaths, BITE_PALETTE.shadow, 0.18, 1.02, 0.78, -3.2, 2.2),
      this.createClawFillLayer(clawPaths, BITE_PALETTE.deepRed, 0.2, 0.66, 0.56, -1.8, 1.1),
    ]);

    this.scene.tweens.add({
      targets: wake,
      alpha: 0,
      scaleX: 1.05,
      scaleY: 1.08,
      duration: 190,
      ease: 'Quad.easeOut',
      onComplete: () => {
        wake.removeAll(true);
        wake.destroy();
      },
    });
  }

  private playVolumeParticles(
    x: number,
    y: number,
    angle: number,
    clawPaths: readonly ClawPath[],
    hitPlayer: boolean,
  ): void {
    const blood = createEmitter(this.scene, 0, 0, TEX_BITE_DROPLET, {
      lifespan: { min: 95, max: 210 },
      quantity: 1,
      frequency: -1,
      speed: { min: 70, max: 220 },
      scale: { start: 0.84, end: 0 },
      alpha: { start: 0.86, end: 0 },
      tint: [BITE_PALETTE.gore, BITE_PALETTE.deepRed, BITE_PALETTE.hot],
      blendMode: Phaser.BlendModes.NORMAL,
      emitting: false,
    }, DEPTH_TRACE + 0.1);

    const flecks = createEmitter(this.scene, 0, 0, TEX_BITE_FLECK, {
      lifespan: { min: 80, max: 170 },
      quantity: 1,
      frequency: -1,
      speed: { min: 90, max: 260 },
      rotate: { min: 0, max: 360 },
      scale: { start: 0.76, end: 0 },
      alpha: { start: 0.72, end: 0 },
      tint: [BITE_PALETTE.ivory, BITE_PALETTE.shadow, BITE_PALETTE.deepRed],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    }, DEPTH_TRACE + 0.11);

    for (const claw of clawPaths) {
      const burstCount = hitPlayer ? 5 : 4;
      for (let index = 0; index < burstCount; index++) {
        const t = Phaser.Math.Linear(0.18, 0.98, index / Math.max(1, burstCount - 1));
        const point = this.sampleQuadratic(claw, t);
        const world = this.toWorldPoint(point.x, point.y, x, y, angle);
        blood.explode(hitPlayer ? 2 : 1, world.x, world.y);
        flecks.explode(1, world.x, world.y);
      }
    }

    this.scene.time.delayedCall(300, () => {
      destroyEmitter(blood);
      destroyEmitter(flecks);
    });
  }

  private playImpactBurst(
    angle: number,
    impactX: number,
    impactY: number,
    range: number,
    halfArcRad: number,
  ): void {
    if (!isPointInsideArena(impactX, impactY)) return;

    const impactSize = Math.max(24, range * 0.52);
    const clawPaths = this.buildImpactClawPaths(impactSize);
    const mark = this.scene.add.container(impactX, impactY);
    mark.setDepth(DEPTH_TRACE + 0.14);
    mark.setRotation(angle + (halfArcRad * 0.04) + Phaser.Math.FloatBetween(-0.05, 0.05));
    mark.add([
      this.createClawFillLayer(clawPaths, BITE_PALETTE.shadow, 0.92, 1.02, 1),
      this.createClawFillLayer(clawPaths, BITE_PALETTE.deepRed, 0.8, 0.72, 0.86),
      this.createClawFillLayer(clawPaths, BITE_PALETTE.gore, 0.52, 0.46, 0.52),
      this.createClawStrokeLayer(clawPaths, BITE_PALETTE.hot, 0.28, 0.08, 0.16),
    ]);

    const gore = this.scene.add.image(impactX, impactY, TEX_BITE_HAZE)
      .setDepth(DEPTH_TRACE + 0.145)
      .setTint(BITE_PALETTE.gore)
      .setAlpha(0.52)
      .setDisplaySize(42, 42);

    const mist = this.scene.add.image(impactX, impactY, TEX_BITE_MIST)
      .setDepth(DEPTH_TRACE + 0.146)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(BITE_PALETTE.ivory)
      .setAlpha(0.18)
      .setDisplaySize(52, 52);

    this.scene.tweens.add({
      targets: [mark, gore, mist],
      alpha: 0,
      scaleX: 1.08,
      scaleY: 1.08,
      duration: 210,
      ease: 'Quad.easeOut',
      onComplete: () => {
        mark.removeAll(true);
        mark.destroy();
        gore.destroy();
        mist.destroy();
      },
    });

    const blood = createEmitter(this.scene, impactX, impactY, TEX_BITE_DROPLET, {
      lifespan: { min: 110, max: 260 },
      quantity: 24,
      frequency: -1,
      angle: { min: Phaser.Math.RadToDeg(angle) - 42, max: Phaser.Math.RadToDeg(angle) + 42 },
      speed: { min: 100, max: 310 },
      scale: { start: 1, end: 0 },
      alpha: { start: 0.9, end: 0 },
      tint: [BITE_PALETTE.gore, BITE_PALETTE.deepRed, BITE_PALETTE.hot],
      blendMode: Phaser.BlendModes.NORMAL,
      emitting: false,
    }, DEPTH_TRACE + 0.16);
    blood.explode(24);

    const chips = createEmitter(this.scene, impactX, impactY, TEX_BITE_FLECK, {
      lifespan: { min: 80, max: 180 },
      quantity: 16,
      frequency: -1,
      angle: { min: 0, max: 360 },
      speed: { min: 80, max: 220 },
      rotate: { min: 0, max: 360 },
      scale: { start: 0.88, end: 0 },
      alpha: { start: 0.72, end: 0 },
      tint: [BITE_PALETTE.ivory, BITE_PALETTE.shadow, BITE_PALETTE.deepRed],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    }, DEPTH_TRACE + 0.17);
    chips.explode(16);

    this.scene.time.delayedCall(320, () => {
      destroyEmitter(blood);
      destroyEmitter(chips);
    });
  }

  private playAirSnap(
    x: number,
    y: number,
    angle: number,
    clawWidth: number,
  ): void {
    if (!isPointInsideArena(x, y)) return;

    const snap = this.scene.add.graphics();
    snap.setDepth(DEPTH_TRACE + 0.12);
    snap.setBlendMode(Phaser.BlendModes.NORMAL);
    snap.x = x;
    snap.y = y;
    snap.rotation = angle;
    snap.lineStyle(Math.max(1, clawWidth * 0.12), BITE_PALETTE.deepRed, 0.22);
    snap.lineBetween(-8, -4, 6, -10);
    snap.lineBetween(-8, 0, 8, -2);
    snap.lineBetween(-8, 4, 6, 10);

    this.scene.tweens.add({
      targets: snap,
      alpha: 0,
      scaleX: 1.12,
      scaleY: 1.08,
      duration: 120,
      ease: 'Quad.easeOut',
      onComplete: () => snap.destroy(),
    });
  }

  private fillClawShape(
    gfx: Phaser.GameObjects.Graphics,
    claw: ClawPath,
    color: number,
    alpha: number,
    widthScale: number,
    roughnessScale: number,
    xOffset: number,
    yOffset: number,
  ): void {
    const left: Array<{ x: number; y: number }> = [];
    const right: Array<{ x: number; y: number }> = [];
    const segments = 14;

    for (let index = 0; index <= segments; index++) {
      const t = index / segments;
      const point = this.sampleQuadratic(claw, t);
      const tangent = this.sampleQuadraticTangent(claw, t);
      const normalX = -tangent.y;
      const normalY = tangent.x;
      const halfWidth = this.getClawWidthAt(claw, t) * widthScale * 0.5;
      const leftOffset = Math.max(0.25, halfWidth + this.getJaggedOffset(claw, index, 1, t, roughnessScale));
      const rightOffset = Math.max(0.25, halfWidth + this.getJaggedOffset(claw, index, -1, t, roughnessScale));

      left.push({
        x: point.x + xOffset + (normalX * leftOffset),
        y: point.y + yOffset + (normalY * leftOffset),
      });
      right.unshift({
        x: point.x + xOffset - (normalX * rightOffset),
        y: point.y + yOffset - (normalY * rightOffset),
      });
    }

    const endTangent = this.sampleQuadraticTangent(claw, 1);
    const tipExtension = Math.max(1.5, claw.widthEnd * widthScale * 2.2);
    const tip = {
      x: claw.endX + xOffset + (endTangent.x * tipExtension),
      y: claw.endY + yOffset + (endTangent.y * tipExtension),
    };

    const points = [...left, tip, ...right];
    gfx.fillStyle(color, alpha);
    gfx.beginPath();
    gfx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index++) {
      gfx.lineTo(points[index].x, points[index].y);
    }
    gfx.closePath();
    gfx.fillPath();
  }

  private getClawWidthAt(claw: ClawPath, t: number): number {
    if (t < 0.45) {
      return Phaser.Math.Linear(claw.widthStart, claw.widthMid, t / 0.45);
    }

    const fadeT = (t - 0.45) / 0.55;
    return Phaser.Math.Linear(claw.widthMid, claw.widthEnd, fadeT);
  }

  private getJaggedOffset(
    claw: ClawPath,
    sampleIndex: number,
    side: 1 | -1,
    t: number,
    roughnessScale: number,
  ): number {
    const profile = Math.pow(Math.sin(Math.PI * t), 0.8);
    const taper = t > 0.82 ? Phaser.Math.Linear(1, 0.18, (t - 0.82) / 0.18) : 1;
    const amplitude = claw.jaggedness * roughnessScale * profile * taper;
    const noiseA = this.hashNoise(claw.seed + (sampleIndex * 13.17) + (side * 7.1));
    const noiseB = this.hashNoise((claw.seed * 0.37) + (sampleIndex * 5.71) + (side * 19.3));
    const signedNoise = ((noiseA - 0.5) * 2) + ((noiseB - 0.5) * 0.8);
    const tooth = sampleIndex % 2 === 0 ? 1 : -0.42;
    return signedNoise * amplitude * tooth;
  }

  private hashNoise(value: number): number {
    const raw = Math.sin((value * 12.9898) + 78.233) * 43758.5453123;
    return raw - Math.floor(raw);
  }

  private sampleQuadratic(claw: ClawPath, t: number): { x: number; y: number } {
    const invT = 1 - t;
    return {
      x: (invT * invT * claw.startX) + (2 * invT * t * claw.controlX) + (t * t * claw.endX),
      y: (invT * invT * claw.startY) + (2 * invT * t * claw.controlY) + (t * t * claw.endY),
    };
  }

  private sampleQuadraticTangent(claw: ClawPath, t: number): { x: number; y: number } {
    const dx = (2 * (1 - t) * (claw.controlX - claw.startX)) + (2 * t * (claw.endX - claw.controlX));
    const dy = (2 * (1 - t) * (claw.controlY - claw.startY)) + (2 * t * (claw.endY - claw.controlY));
    const length = Math.max(1e-6, Math.hypot(dx, dy));
    return { x: dx / length, y: dy / length };
  }

  private toWorldPoint(
    localX: number,
    localY: number,
    originX: number,
    originY: number,
    rotation: number,
  ): { x: number; y: number } {
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    return {
      x: originX + (localX * cos) - (localY * sin),
      y: originY + (localX * sin) + (localY * cos),
    };
  }

  private strokeQuadratic(
    gfx: Phaser.GameObjects.Graphics,
    startX: number,
    startY: number,
    controlX: number,
    controlY: number,
    endX: number,
    endY: number,
    segments: number,
  ): void {
    gfx.beginPath();
    gfx.moveTo(startX, startY);
    for (let index = 1; index <= segments; index++) {
      const t = index / segments;
      const invT = 1 - t;
      const px = (invT * invT * startX) + (2 * invT * t * controlX) + (t * t * endX);
      const py = (invT * invT * startY) + (2 * invT * t * controlY) + (t * t * endY);
      gfx.lineTo(px, py);
    }
    gfx.strokePath();
  }
}
