import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import { circleZone, ensureCanvasTexture, fillRadialGradientTexture } from './EffectUtils';

const TEX_TIMEBOMB_FUSE_RING = '__timebomb_fuse_ring';
const TEX_TIMEBOMB_FUSE_SPARK = '__timebomb_fuse_spark';
const RING_TEXTURE_SIZE = 96;
const FUSE_COLOR = 0xc85cff;
const FUSE_HOT_COLOR = 0xf4d4ff;

/**
 * Rein lokale Darstellung eines replizierten Zeitbomben-Countdownzustands.
 * Zeit und Explosion bleiben im Host-System; dieser Renderer liest nur den synchronisierten
 * Fortschritt und erzeugt daraus Ring, Ziffern und einen begrenzten Partikelkanal.
 */
export class TimebombFuseRenderer {
  private readonly ring: Phaser.GameObjects.Image;
  private readonly sparks: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly countdownLabels = new Set<Phaser.GameObjects.Text>();
  private lastDisplayedSecond = -1;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly enemySize: number,
  ) {
    this.generateTextures();

    this.ring = scene.add.image(0, 0, TEX_TIMEBOMB_FUSE_RING)
      .setDepth(DEPTH.PLAYERS - 0.04)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(FUSE_COLOR);
    this.sparks = scene.add.particles(0, 0, TEX_TIMEBOMB_FUSE_SPARK, {
      lifespan: { min: 240, max: 520 },
      // Negatives Radialtempo: Energie zieht aus dem Ring sichtbar in den Dachs hinein.
      speed: { min: -58, max: -20 },
      scale: { start: 0.38, end: 0 },
      alpha: { start: 0.9, end: 0 },
      quantity: 1,
      frequency: 125,
      maxAliveParticles: 20,
      blendMode: Phaser.BlendModes.ADD,
      tint: [FUSE_HOT_COLOR, 0xdc8cff, FUSE_COLOR],
      emitZone: circleZone(enemySize * 0.95),
    }).setDepth(DEPTH.PLAYERS + 0.08);
  }

  sync(x: number, y: number, progress: number, fuseDurationMs: number): void {
    const clampedProgress = Phaser.Math.Clamp(progress, 0, 1);
    const now = this.scene.time.now;
    const pulsePeriodMs = Phaser.Math.Linear(330, 78, clampedProgress);
    const pulse = 0.5 + 0.5 * Math.sin(now * Math.PI * 2 / pulsePeriodMs);
    const diameter = this.enemySize * (2.35 + clampedProgress * 0.5 + pulse * 0.14);

    this.ring
      .setPosition(x, y)
      .setDisplaySize(diameter, diameter)
      .setRotation(now * (0.0017 + clampedProgress * 0.0045))
      .setAlpha(0.52 + clampedProgress * 0.28 + pulse * 0.18);

    const remainingMs = Math.max(0, fuseDurationMs * (1 - clampedProgress));
    const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
    if (remainingSeconds > 0 && remainingSeconds !== this.lastDisplayedSecond) {
      this.lastDisplayedSecond = remainingSeconds;
      this.emitCountdownText(x, y, remainingSeconds);
    }

    this.sparks
      .setPosition(x, y)
      .setFrequency(Math.round(Phaser.Math.Linear(125, 28, clampedProgress)))
      .setQuantity(clampedProgress >= 0.78 ? 2 : 1)
      .setAlpha(0.62 + clampedProgress * 0.38);
  }

  destroy(): void {
    for (const label of this.countdownLabels) {
      this.scene.tweens.killTweensOf(label);
      label.destroy();
    }
    this.countdownLabels.clear();
    this.ring.destroy();
    this.sparks.stop();
    this.sparks.destroy();
  }

  private emitCountdownText(x: number, y: number, value: number): void {
    // Gleiche visuelle Sprache wie der Nuke-Countdown, aber auf Gegnergroesse reduziert.
    const label = this.scene.add.text(x, y - this.enemySize * 0.72, String(value), {
      fontFamily: 'monospace',
      fontSize: '16px',
      fontStyle: 'bold',
      color: '#ebede9',
      stroke: '#241527',
      strokeThickness: 3,
    }).setOrigin(0.5).setDepth(DEPTH.PLAYERS + 2);
    this.countdownLabels.add(label);

    this.scene.tweens.add({
      targets: label,
      y: label.y - 18,
      alpha: 0,
      scaleX: { from: 1.12, to: 0.92 },
      scaleY: { from: 1.12, to: 0.92 },
      duration: 800,
      ease: 'Quad.easeOut',
      onComplete: () => {
        this.countdownLabels.delete(label);
        label.destroy();
      },
    });
  }

  private generateTextures(): void {
    ensureCanvasTexture(this.scene.textures, TEX_TIMEBOMB_FUSE_RING, RING_TEXTURE_SIZE, RING_TEXTURE_SIZE, (ctx) => {
      const center = RING_TEXTURE_SIZE * 0.5;
      const radius = center - 7;
      ctx.clearRect(0, 0, RING_TEXTURE_SIZE, RING_TEXTURE_SIZE);
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.lineWidth = 3;
      for (let index = 0; index < 6; index += 1) {
        const start = index * Math.PI / 3;
        ctx.beginPath();
        ctx.arc(center, center, radius, start, start + Math.PI * 0.2);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.34)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(center, center, radius - 8, 0, Math.PI * 2);
      ctx.stroke();
    });
    fillRadialGradientTexture(this.scene.textures, TEX_TIMEBOMB_FUSE_SPARK, 10, [
      [0, 'rgba(255,255,255,1)'],
      [0.42, 'rgba(255,255,255,0.62)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
  }
}
