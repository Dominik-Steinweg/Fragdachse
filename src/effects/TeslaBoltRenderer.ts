import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import { getGraphicsQualityProfile } from '../graphics/GraphicsQuality';
import { getEmissiveScale } from './EmissiveScale';
import {
  configureAdditiveImage,
  createEmitter,
  destroyEmitter,
  ensureCanvasTexture,
  mixColors,
  registerGraphicsObject,
  setEmitterTintArray,
} from './EffectUtils';
import { createTeslaStormBoltGpuLayer, type TeslaStormBoltGpuLayer } from './teslaStorm/TeslaStormBoltGpuLayer';
import { TeslaStormBoltStore } from './teslaStorm/TeslaStormBoltStore';

const TEX_BOLT_SPARK = '__tesla_bolt_spark';
/** Shader time wraps far apart; the forms only jump once per wrap. */
const SHADER_TIME_WRAP_MS = 600_000;

interface BoltState {
  angle: number;
  seed: number;
}

/**
 * Gewitterentladung der Tesla-Kuppel im Stil eines Diablo-Charged-Bolt.
 *
 * Bewusst kein Geschoss mit Schweif: die Entladung *ist* der Blitz – ein kompaktes Büschel aus
 * Querfilamenten mit Ästen, weichem Halo und Funken. Alle Entladungen teilen sich einen
 * instanzierten GPU-Layer (ein Draw Call); Form, Flackern und Funken entstehen im Shader aus
 * Zeit und Seed. Die CPU schreibt pro Frame nur Lage und Ausrichtung jeder Entladung.
 */
export class TeslaBoltRenderer {
  private readonly store = new TeslaStormBoltStore();
  private readonly states = new Map<number, BoltState>();
  private layer: TeslaStormBoltGpuLayer | null = null;
  private impactEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private readonly impactFlashes = new Set<Phaser.GameObjects.Image>();

  constructor(private readonly scene: Phaser.Scene) {}

  generateTextures(): void {
    ensureCanvasTexture(this.scene.textures, TEX_BOLT_SPARK, 10, 10, (ctx) => {
      ctx.clearRect(0, 0, 10, 10);
      const gradient = ctx.createRadialGradient(5, 5, 0, 5, 5, 5);
      gradient.addColorStop(0, 'rgba(255,255,255,1.0)');
      gradient.addColorStop(0.5, 'rgba(190,238,255,0.6)');
      gradient.addColorStop(1, 'rgba(90,170,255,0.0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 10, 10);
    });
    this.ensureLayer();
  }

  createVisual(id: number, x: number, y: number, size: number, color: number): void {
    if (this.states.has(id)) return;
    // Der Seed hängt an der Projektil-ID: Host und Clients sehen dieselbe Entladung.
    this.states.set(id, { angle: 0, seed: ((Math.imul(id + 1, 0x9e3779b9) >>> 0) / 0x100000000) * 997 });
    this.updateVisual(id, x, y, size, 0, 0, color);
  }

  updateVisual(id: number, x: number, y: number, size: number, vx: number, vy: number, color: number): void {
    const state = this.states.get(id);
    if (!state) return;
    if (Math.abs(vx) > 0.001 || Math.abs(vy) > 0.001) state.angle = Math.atan2(vy, vx);
    this.ensureLayer();
    this.store.write(id, x, y, state.angle, size, color, state.seed);
  }

  /** Kurzer Entladungsblitz am Einschlagpunkt. */
  playImpact(x: number, y: number, size: number, color: number): void {
    const emitter = this.ensureImpactEmitter();
    const hotColor = mixColors(color, 0xffffff, 0.72);

    // Der Halo allein ist für einen Treffer zu schwach: ein dichter, weicher Kern
    // hält den Kontakt kurz sichtbar, ohne die frühere große Scheibe zurückzubringen.
    const flash = configureAdditiveImage(this.scene.add.image(x, y, TEX_BOLT_SPARK),
      DEPTH.PROJECTILES + 0.3, 1, hotColor);
    const flashScale = Math.max(12, Math.min(28, size * 0.75)) / 10;
    flash.setScale(flashScale);
    registerGraphicsObject(this.scene, 'teslaBoltEffects', flash);
    this.impactFlashes.add(flash);
    this.scene.tweens.add({
      targets: flash,
      alpha: 0,
      scaleX: flashScale * 1.5,
      scaleY: flashScale * 1.5,
      delay: 40,
      duration: 160,
      ease: 'Quad.easeOut',
      onComplete: () => {
        this.impactFlashes.delete(flash);
        flash.destroy();
      },
    });

    emitter.setPosition(x, y);
    setEmitterTintArray(emitter, [0xffffff, hotColor, mixColors(color, 0x66c8ff, 0.4)]);
    emitter.explode(10);
  }

  destroyVisual(id: number): void {
    if (!this.states.delete(id)) return;
    this.store.remove(id);
  }

  has(id: number): boolean {
    return this.states.has(id);
  }

  getActiveIds(): number[] {
    return [...this.states.keys()];
  }

  destroyAll(): void {
    this.states.clear();
    this.store.clear();
    this.layer?.image.destroy();
    this.layer = null;
    for (const flash of this.impactFlashes) {
      this.scene.tweens.killTweensOf(flash);
      flash.destroy();
    }
    this.impactFlashes.clear();
    if (this.impactEmitter) {
      destroyEmitter(this.impactEmitter);
      this.impactEmitter = null;
    }
  }

  private ensureLayer(): TeslaStormBoltGpuLayer | null {
    if (this.layer) return this.layer;
    this.layer = createTeslaStormBoltGpuLayer(this.scene, this.store, DEPTH.PROJECTILES + 0.2, {
      time: () => (this.scene.time.now % SHADER_TIME_WRAP_MS) / 1000,
      emission: getEmissiveScale,
      detail: () => getGraphicsQualityProfile(this.scene).level === 'low' ? 0 : 1,
    });
    if (this.layer) registerGraphicsObject(this.scene, 'teslaBoltEffects', this.layer.image);
    return this.layer;
  }

  private ensureImpactEmitter(): Phaser.GameObjects.Particles.ParticleEmitter {
    if (this.impactEmitter) return this.impactEmitter;
    this.impactEmitter = createEmitter(this.scene, 0, 0, TEX_BOLT_SPARK, {
      lifespan: { min: 110, max: 190 },
      frequency: -1,
      quantity: 1,
      speed: { min: 40, max: 105 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.9, end: 0 },
      alpha: { start: 0.95, end: 0 },
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    }, DEPTH.PROJECTILES + 0.31, undefined, 'teslaBolt');
    return this.impactEmitter;
  }
}
