import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import {
  createEmitter,
  destroyEmitter,
  edgeZone,
  ensureCanvasTexture,
  fillRadialGradientTexture,
  mixColors,
} from './EffectUtils';
import type { LightingSystem } from './LightingSystem';

const TEX_NOVA_RING = '__tesla_nova_ring';
const TEX_NOVA_GLOW = '__tesla_nova_glow';
const TEX_NOVA_SHARD = '__tesla_nova_shard';

/** Eine laufende Welle. Sie lebt unabhängig von der Kuppel und räumt sich selbst ab. */
interface NovaWave {
  x: number;
  y: number;
  maxRadius: number;
  startedAt: number;
  durationMs: number;
  color: number;
  hotColor: number;
  seed: number;
  ring: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image;
  filaments: Phaser.GameObjects.Graphics;
  lightKey: string;
}

const WAVE_DURATION_MS = 420;
const FILAMENT_COUNT = 14;

/**
 * Blitznova der Tesla-Kuppel.
 *
 * Die Welle liest sich wie eine Frostnova in ihrer Kontur – ein klar begrenzter, schnell nach
 * außen laufender Ring bis zum aktuellen Kuppelrand – trägt aber durchgehend elektrische
 * Sprache: gezackte Radialfilamente statt Kristallsplittern, additive Blaus mit weißglühender
 * Front und ein kurzer Lichtstoß statt eines kalten Nachleuchtens.
 */
export class TeslaNovaRenderer {
  private readonly waves: NovaWave[] = [];
  private shardEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private lighting: LightingSystem | null = null;
  private nextWaveId = 0;

  constructor(private readonly scene: Phaser.Scene) {}

  setLightingSystem(lighting: LightingSystem | null): void {
    this.lighting = lighting;
  }

  generateTextures(): void {
    const textures = this.scene.textures;

    ensureCanvasTexture(textures, TEX_NOVA_RING, 512, 512, (ctx) => {
      const center = 256;
      ctx.clearRect(0, 0, 512, 512);

      // Die Front ist ein schmaler, harter Grat mit weichem Innen- und Aussenverlauf.
      const front = ctx.createRadialGradient(center, center, 196, center, center, 250);
      front.addColorStop(0, 'rgba(96,170,255,0.0)');
      front.addColorStop(0.44, 'rgba(120,206,255,0.22)');
      front.addColorStop(0.78, 'rgba(206,244,255,0.82)');
      front.addColorStop(0.9, 'rgba(255,255,255,0.96)');
      front.addColorStop(1, 'rgba(150,214,255,0.0)');
      ctx.fillStyle = front;
      ctx.beginPath();
      ctx.arc(center, center, 250, 0, Math.PI * 2);
      ctx.fill();

      // Eine zweite, dünnere Innenkante gibt der Front Tiefe, ohne sie zu verbreitern.
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(center, center, 236, 0, Math.PI * 2);
      ctx.stroke();
    });

    fillRadialGradientTexture(textures, TEX_NOVA_GLOW, 384, [
      [0, 'rgba(255,255,255,0.0)'],
      [0.5, 'rgba(122,208,255,0.1)'],
      [0.86, 'rgba(96,168,255,0.24)'],
      [1, 'rgba(24,48,110,0.0)'],
    ]);

    ensureCanvasTexture(textures, TEX_NOVA_SHARD, 24, 8, (ctx) => {
      ctx.clearRect(0, 0, 24, 8);
      const gradient = ctx.createLinearGradient(0, 4, 24, 4);
      gradient.addColorStop(0, 'rgba(255,255,255,0.0)');
      gradient.addColorStop(0.4, 'rgba(255,255,255,0.9)');
      gradient.addColorStop(0.72, 'rgba(168,226,255,0.6)');
      gradient.addColorStop(1, 'rgba(96,170,255,0.0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(0, 4);
      ctx.lineTo(10, 1.2);
      ctx.lineTo(24, 4);
      ctx.lineTo(10, 6.8);
      ctx.closePath();
      ctx.fill();
    });
  }

  /** Startet eine Welle, die in einem Zug bis `maxRadius` läuft. */
  play(x: number, y: number, maxRadius: number, color: number): void {
    const radius = Math.max(24, maxRadius);
    const hotColor = mixColors(color, 0xffffff, 0.5);
    const accentColor = mixColors(color, 0x6fd8ff, 0.34);

    const ring = this.scene.add.image(x, y, TEX_NOVA_RING);
    ring.setDepth(DEPTH.FIRE + 0.26);
    ring.setBlendMode(Phaser.BlendModes.ADD);
    ring.setTint(mixColors(accentColor, 0xffffff, 0.3));

    const glow = this.scene.add.image(x, y, TEX_NOVA_GLOW);
    glow.setDepth(DEPTH.FIRE + 0.24);
    glow.setBlendMode(Phaser.BlendModes.ADD);
    glow.setTint(accentColor);

    const filaments = this.scene.add.graphics()
      .setDepth(DEPTH.FIRE + 0.27)
      .setBlendMode(Phaser.BlendModes.ADD);

    const wave: NovaWave = {
      x,
      y,
      maxRadius: radius,
      startedAt: this.scene.time.now,
      durationMs: WAVE_DURATION_MS,
      color,
      hotColor,
      seed: (this.nextWaveId += 1) * 97,
      ring,
      glow,
      filaments,
      lightKey: `teslanova:${this.nextWaveId}`,
    };
    this.waves.push(wave);

    // Startimpuls: ein kompakter Splitterkranz, der mit der Front nach außen zieht.
    const emitter = this.ensureShardEmitter();
    emitter.setPosition(x, y);
    emitter.setParticleTint([0xffffff, hotColor, accentColor]);
    emitter.setParticleSpeed(radius * 1.9, radius * 2.6);
    emitter.clearEmitZones();
    emitter.addEmitZone(edgeZone(Math.max(radius * 0.12, 6), 24));
    emitter.explode(Phaser.Math.Clamp(Math.round(radius / 7), 12, 34));
  }

  update(): void {
    const time = this.scene.time.now;

    for (let index = this.waves.length - 1; index >= 0; index--) {
      const wave = this.waves[index];
      const progress = (time - wave.startedAt) / wave.durationMs;
      if (progress >= 1) {
        this.lighting?.releaseLight(wave.lightKey);
        wave.ring.destroy();
        wave.glow.destroy();
        wave.filaments.destroy();
        this.waves.splice(index, 1);
        continue;
      }

      // Schnell heraus, dann auslaufen: die Front ist im ersten Drittel am deutlichsten.
      const eased = 1 - (1 - progress) ** 2.4;
      const radius = wave.maxRadius * eased;
      const fade = progress < 0.14
        ? progress / 0.14
        : 1 - (progress - 0.14) / 0.86;

      wave.ring.setPosition(wave.x, wave.y);
      wave.ring.setScale(radius / 250);
      wave.ring.setAlpha(Phaser.Math.Clamp(fade, 0, 1) * 0.92);

      wave.glow.setPosition(wave.x, wave.y);
      wave.glow.setScale((radius * 1.04) / 192);
      wave.glow.setAlpha(Phaser.Math.Clamp(fade, 0, 1) * 0.42);

      this.drawFilaments(wave, radius, Phaser.Math.Clamp(fade, 0, 1), time);

      this.lighting?.setLight(
        wave.lightKey,
        'electricField',
        wave.x,
        wave.y,
        {
          radiusPx: Math.max(radius * 1.1, 60),
          color: mixColors(wave.hotColor, 0xffffff, 0.35),
          intensity: 0.75 * Phaser.Math.Clamp(fade, 0, 1),
        },
      );
    }
  }

  destroyAll(): void {
    for (const wave of this.waves) {
      this.lighting?.releaseLight(wave.lightKey);
      wave.ring.destroy();
      wave.glow.destroy();
      wave.filaments.destroy();
    }
    this.waves.length = 0;
    if (this.shardEmitter) {
      destroyEmitter(this.shardEmitter);
      this.shardEmitter = null;
    }
  }

  /**
   * Radiale Blitzfilamente auf der Front.
   *
   * Sie sitzen leicht innerhalb der Ringkante und zeigen nach außen. Dadurch bleibt der Ring die
   * klare Gefahrengrenze, während die Filamente die elektrische Herkunft der Welle tragen.
   */
  private drawFilaments(wave: NovaWave, radius: number, fade: number, time: number): void {
    const filaments = wave.filaments;
    filaments.clear();
    if (radius < 8) return;

    const inner = radius * 0.82;
    const spikeLength = radius * 0.13;

    for (let index = 0; index < FILAMENT_COUNT; index++) {
      const baseAngle = (Math.PI * 2 * index) / FILAMENT_COUNT + wave.seed * 0.013;
      const wobble = Math.sin(time * 0.02 + index * 1.7 + wave.seed) * 0.09;
      const angle = baseAngle + wobble;
      const midAngle = angle + Math.cos(time * 0.017 + index * 2.3) * 0.22;

      const startX = wave.x + Math.cos(angle) * inner;
      const startY = wave.y + Math.sin(angle) * inner;
      const midX = wave.x + Math.cos(midAngle) * (inner + spikeLength * 0.6);
      const midY = wave.y + Math.sin(midAngle) * (inner + spikeLength * 0.6);
      const endX = wave.x + Math.cos(angle) * (radius + spikeLength * 0.35);
      const endY = wave.y + Math.sin(angle) * (radius + spikeLength * 0.35);

      filaments.lineStyle(3.2, mixColors(wave.color, 0x6fd8ff, 0.4), fade * 0.16);
      filaments.beginPath();
      filaments.moveTo(startX, startY);
      filaments.lineTo(midX, midY);
      filaments.lineTo(endX, endY);
      filaments.strokePath();

      filaments.lineStyle(1.2, wave.hotColor, fade * 0.58);
      filaments.beginPath();
      filaments.moveTo(startX, startY);
      filaments.lineTo(midX, midY);
      filaments.lineTo(endX, endY);
      filaments.strokePath();
    }
  }

  private ensureShardEmitter(): Phaser.GameObjects.Particles.ParticleEmitter {
    if (this.shardEmitter) return this.shardEmitter;
    this.shardEmitter = createEmitter(this.scene, 0, 0, TEX_NOVA_SHARD, {
      lifespan: { min: 180, max: 330 },
      frequency: -1,
      quantity: 1,
      scaleX: { start: 1.5, end: 0.35 },
      scaleY: { start: 1, end: 0.2 },
      alpha: { start: 0.9, end: 0 },
      rotate: { onEmit: (particle) => Phaser.Math.RadToDeg(Math.atan2(particle!.velocityY, particle!.velocityX)) },
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    }, DEPTH.FIRE + 0.28);
    return this.shardEmitter;
  }
}
