import * as Phaser from 'phaser';
import type { SyncedPowerUp, SyncedPowerUpPedestal } from '../types';
import { DEPTH } from '../config';
import {
  configureAdditiveImage,
  createEmitter,
  destroyEmitter,
  ensureCanvasTexture,
  fillRadialGradientTexture,
  registerGraphicsObject,
  setCircleEmitZone,
} from '../effects/EffectUtils';
import { mixColors } from '../effects/EffectUtils';
import { GpuVfxEffectId } from '../effects/gpu/GpuVfxEffects';
import type { GpuVfxSpawnSpec } from '../effects/gpu/GpuVfxSpawnSpec';
import { GPU_VFX_NO_SOURCE_HANDLE, type GpuVfxSystem } from '../effects/gpu/GpuVfxSystem';
import { ParticleFlowScheduler } from '../effects/gpu/ParticleFlowScheduler';
import type { LightingSystem } from '../effects/LightingSystem';
import { POWERUP_DEFS, POWERUP_PEDESTAL_CONFIG, POWERUP_RENDER_SIZE } from './PowerUpConfig';
import {
  PowerUpPedestalGpuSystem,
  resolvePowerUpPedestalGpuMode,
  type PowerUpPedestalGpuMode,
} from './PowerUpPedestalGpuSystem';

const TEX_POWERUP_PEDESTAL_PARTICLE  = '__powerup_pedestal_particle';
const TEX_POWERUP_PEDESTAL_PIXEL     = '__powerup_pedestal_pixel';
const TEX_POWERUP_PEDESTAL_FLASH     = '__powerup_pedestal_flash';
const MISSION_REWARD_COLOR           = 0x22d7e8;
const MISSION_REWARD_PEDESTAL_SIZE   = 38;
const MISSION_REWARD_PICKUP_SIZE     = 14;
const PEDESTAL_SPAWN_POINT = { x: 0, y: 0 };

interface ItemVisual {
  container: Phaser.GameObjects.Container;
  graphic: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle | null;
  /** Für das Dauerlicht: die Farbe wird pro Frame gebraucht, der Def-Lookup nicht. */
  color: number;
  emitsLight: boolean;
}

interface PedestalVisual {
  state: SyncedPowerUpPedestal;
  lastHasPowerUp: boolean;
  mode: PowerUpPedestalGpuMode;
  ambientFrequency: number;
  sparkFrequency: number;
  readonly ambientFlow: ParticleFlowScheduler;
  readonly sparkFlow: ParticleFlowScheduler;
  readonly source: number;
}

/**
 * Rendert Power-Up-Items auf dem Spielfeld (Host + Client).
 *
 * Eine vorgebackene additive Aura pulsiert hinter der eigentlichen Grafik. Damit bleibt das
 * Item klar lesbar, ohne fuer jedes liegende Power-up einen eigenen Filter-Pass zu erzeugen.
 * Container.destroy(true) räumt Grafik + deren Tweens automatisch auf.
 */
export class PowerUpRenderer {
  private sprites = new Map<number, ItemVisual>();
  private pedestals = new Map<number, PedestalVisual>();
  private readonly activePedestals: PedestalVisual[] = [];
  private readonly pedestalGpu: PowerUpPedestalGpuSystem;
  private lighting: LightingSystem | null = null;
  private gpuVfx: GpuVfxSystem | null = null;
  private ambientSpec: GpuVfxSpawnSpec | null = null;
  private sparkSpec: GpuVfxSpawnSpec | null = null;
  private burstSpec: GpuVfxSpawnSpec | null = null;

  constructor(private scene: Phaser.Scene) {
    this.ensureTextures();
    this.pedestalGpu = new PowerUpPedestalGpuSystem(scene);
  }

  setLightingSystem(lighting: LightingSystem | null): void {
    this.lighting = lighting;
  }

  registerGpuVfx(system: GpuVfxSystem): void {
    if (this.gpuVfx) return;
    this.gpuVfx = system;

    this.ambientSpec = system.createSpec(GpuVfxEffectId.PowerUpPedestalAmbient);
    this.ambientSpec.scaleStart = 0.38;
    this.ambientSpec.scaleEnd = 0;
    this.ambientSpec.alphaStart = 0.28;
    this.ambientSpec.alphaEnd = 0;

    this.sparkSpec = system.createSpec(GpuVfxEffectId.PowerUpPedestalSpark);
    this.sparkSpec.scaleStart = 1.5;
    this.sparkSpec.scaleEnd = 0.3;
    this.sparkSpec.alphaStart = 0.75;
    this.sparkSpec.alphaEnd = 0;

    this.burstSpec = system.createSpec(GpuVfxEffectId.PowerUpPedestalBurst);
    this.burstSpec.alphaEnd = 0;

    system.registerEmission((deltaMs, nowMs) => this.emitPedestalParticles(deltaMs, nowMs));
  }

  /**
   * Synchronisiert die sichtbaren PowerUp-Container mit dem aktuellen Netzwerk-Snapshot.
   */
  sync(powerups: SyncedPowerUp[]): void {
    const activeUids = new Set<number>();

    for (const pu of powerups) {
      activeUids.add(pu.uid);
      const known = this.sprites.get(pu.uid);
      if (known) {
        known.container.setPosition(pu.x, pu.y);
        if (known.emitsLight) this.setItemLight(pu.uid, pu.x, pu.y, known.color);
        continue;
      }

      const def = POWERUP_DEFS[pu.defId];
      const isMissionMarker = pu.pickupKind === 'objective-marker';
      const isMissionReward = pu.pickupKind === 'objective-placement';
      const isMissionVisual = isMissionMarker || isMissionReward;
      const glowColor = isMissionVisual ? MISSION_REWARD_COLOR : (def?.color ?? 0xffffff);
      // Deterministischer Phasen-Offset: Items pulsieren leicht gegeneinander versetzt
      const phaseMs   = (pu.uid * 137) % 1400;

      // ── Container ─────────────────────────────────────────────────────────
      const container = this.scene.add.container(pu.x, pu.y);
      container.setDepth(DEPTH.PLAYERS - 1);

      // ── Grafik: feste Größe, kein Scale-Tween ─────────────────────────────
      const graphic: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle | null =
        isMissionMarker
          ? null
          :
        isMissionReward
          ? this.scene.add.image(0, 0, 'mission_reward_pickup').setDisplaySize(MISSION_REWARD_PICKUP_SIZE, MISSION_REWARD_PICKUP_SIZE)
          : def?.spriteKey
          ? this.scene.add.image(0, 0, def.spriteKey).setDisplaySize(POWERUP_RENDER_SIZE, POWERUP_RENDER_SIZE)
          : this.scene.add.rectangle(0, 0, POWERUP_RENDER_SIZE, POWERUP_RENDER_SIZE, glowColor);
      // Nur der seltene Shape-Fallback gehoert zur Vector-Attribution; Bilder bleiben normale
      // Sprite-Last und werden nicht in eine Graphics-Familie eingemischt.
      if (graphic && !isMissionReward && !def?.spriteKey) {
        registerGraphicsObject(this.scene, 'powerUpEffects', graphic);
      }
      if (isMissionMarker) {
        container.add(this.scene.add.image(0, 0, 'mission_reward_pedestal').setDisplaySize(
          MISSION_REWARD_PEDESTAL_SIZE,
          MISSION_REWARD_PEDESTAL_SIZE,
        ));
      }
      if (graphic) container.add(graphic);

      if (isMissionMarker) {
        this.sprites.set(pu.uid, { container, graphic, color: glowColor, emitsLight: false });
        continue;
      }
      if (!graphic) continue;
      if (isMissionReward) {
        this.sprites.set(pu.uid, { container, graphic, color: glowColor, emitsLight: false });
        continue;
      }

      const itemAura = configureAdditiveImage(
        this.scene.add.image(0, 0, TEX_POWERUP_PEDESTAL_FLASH),
        DEPTH.PLAYERS - 1.2,
        0.18,
        glowColor,
      ).setScale(0.52);
      container.addAt(itemAura, 0);

      // ── preFX-Glow: Pixel-Aura, outerStrength pulsiert ───────────────────
      // Vorgebackene Aura statt eigenem Filter-Framebuffer pro Item.
      const auraTween = this.scene.tweens.add({
        targets: itemAura,
        alpha: { from: 0.12, to: 0.24 },
        scaleX: { from: 0.48, to: 0.62 },
        scaleY: { from: 0.48, to: 0.62 },
        duration: 900,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
        delay: phaseMs,
      });
      itemAura.once(Phaser.GameObjects.Events.DESTROY, () => auraTween.stop());

      this.sprites.set(pu.uid, { container, graphic, color: glowColor, emitsLight: true });
      this.setItemLight(pu.uid, pu.x, pu.y, glowColor);
      this.playMaterializeEffect(pu.x, pu.y, glowColor, container, graphic);
    }

    // Entfernte Items aufräumen
    for (const [uid, visual] of this.sprites) {
      if (!activeUids.has(uid)) {
        this.lighting?.releaseLight(itemLightKey(uid));
        visual.container.destroy(true); // Kinder (Arc, Grafik) + deren Tweens werden mitgelöscht
        this.sprites.delete(uid);
      }
    }
  }

  /**
   * Ein liegendes Power-Up leuchtet aus sich heraus – nachts ist das der Unterschied
   * zwischen "sichtbar" und "im Dunkeln übersehen". Die Item-Farbe wird stark Richtung
   * Weiß gemischt, sonst trägt sie als Licht kaum.
   */
  private setItemLight(uid: number, x: number, y: number, color: number): void {
    this.lighting?.setLight(itemLightKey(uid), 'pickupGlow', x, y, {
      color: mixColors(color, 0xffffff, 0.6),
    });
  }

  syncPedestals(pedestals: SyncedPowerUpPedestal[]): void {
    const activeIds = new Set<number>();

    for (const pedestal of pedestals) {
      activeIds.add(pedestal.id);
      const existing = this.pedestals.get(pedestal.id);
      if (existing) {
        if (!existing.lastHasPowerUp && pedestal.hasPowerUp) {
          this.playPedestalSpawnBurst(
            pedestal.x,
            pedestal.y,
            POWERUP_DEFS[pedestal.defId]?.color ?? 0xffffff,
            existing.source,
          );
        }
        existing.state = pedestal;
        existing.lastHasPowerUp = pedestal.hasPowerUp;
        continue;
      }

      const mode: PowerUpPedestalGpuMode = pedestal.hasPowerUp ? 'ready' : 'idle';
      const visual: PedestalVisual = {
        state: pedestal,
        lastHasPowerUp: pedestal.hasPowerUp,
        mode,
        ambientFrequency: pedestal.hasPowerUp ? 95 : 135,
        sparkFrequency: pedestal.hasPowerUp ? 150 : 220,
        ambientFlow: new ParticleFlowScheduler(120),
        sparkFlow: new ParticleFlowScheduler(200),
        source: this.gpuVfx?.createSource(GpuVfxEffectId.PowerUpPedestalAmbient)
          ?? GPU_VFX_NO_SOURCE_HANDLE,
      };
      this.pedestals.set(pedestal.id, visual);
      this.activePedestals.push(visual);
      this.pedestalGpu.upsert(pedestal, mode);
    }

    for (const [id, visual] of this.pedestals) {
      if (!activeIds.has(id)) {
        this.lighting?.releaseLight(pedestalLightKey(id));
        this.pedestalGpu.remove(id);
        this.gpuVfx?.releaseSource(visual.source);
        const index = this.activePedestals.indexOf(visual);
        if (index >= 0) this.activePedestals.splice(index, 1);
        this.pedestals.delete(id);
      }
    }
  }

  updatePedestals(now: number): void {
    for (const [id, visual] of this.pedestals) {
      const mode = resolvePowerUpPedestalGpuMode(visual.state, now);
      if (mode !== visual.mode) visual.mode = mode;
      this.pedestalGpu.upsert(visual.state, mode);
      visual.ambientFrequency = mode === 'ready' ? 95 : mode === 'announcing' ? 80 : 135;
      visual.sparkFrequency = mode === 'ready' ? 150 : mode === 'announcing' ? 95 : 220;

      this.lighting?.setLight(
        pedestalLightKey(id),
        'pickupGlow',
        visual.state.x,
        visual.state.y,
        {
          radiusPx: POWERUP_PEDESTAL_CONFIG.renderBaseRadius * 3.4,
          color: mixColors(POWERUP_DEFS[visual.state.defId]?.color ?? 0xffffff, 0xffffff, 0.55),
          intensity: mode === 'ready' ? 0.54 : mode === 'announcing' ? 0.5 : 0.4,
        },
      );
    }
  }

  /** Alle Container aufräumen (Arena-Teardown). */
  clear(): void {
    for (const [uid, visual] of this.sprites) {
      this.lighting?.releaseLight(itemLightKey(uid));
      visual.container.destroy(true);
    }
    this.sprites.clear();
    for (const [id, visual] of this.pedestals) {
      this.lighting?.releaseLight(pedestalLightKey(id));
      this.gpuVfx?.releaseSource(visual.source);
    }
    this.pedestals.clear();
    this.activePedestals.length = 0;
    this.pedestalGpu.clear();
    this.gpuVfx?.quality.resetCarry(GpuVfxEffectId.PowerUpPedestalAmbient);
    this.gpuVfx?.quality.resetCarry(GpuVfxEffectId.PowerUpPedestalSpark);
    this.gpuVfx?.quality.resetCarry(GpuVfxEffectId.PowerUpPedestalBurst);
  }

  private ensureTextures(): void {
    fillRadialGradientTexture(this.scene.textures, TEX_POWERUP_PEDESTAL_PARTICLE, 20, [
      [0, 'rgba(255,255,255,0.95)'],
      [0.36, 'rgba(255,255,255,0.4)'],
      [1, 'rgba(255,255,255,0.0)'],
    ]);

    fillRadialGradientTexture(this.scene.textures, TEX_POWERUP_PEDESTAL_FLASH, 40, [
      [0, 'rgba(255,255,255,0.9)'],
      [0.32, 'rgba(255,255,255,0.35)'],
      [0.7, 'rgba(255,255,255,0.08)'],
      [1, 'rgba(255,255,255,0.0)'],
    ]);

    ensureCanvasTexture(this.scene.textures, TEX_POWERUP_PEDESTAL_PIXEL, 6, 6, (ctx) => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(1, 1, 4, 4);
    });
  }

  private playPedestalSpawnBurst(x: number, y: number, color: number, source: number): void {
    const system = this.gpuVfx;
    const burst = this.burstSpec;
    if (!system || !burst) return;
    const nowMs = system.now();

    burst.lifeMs = 180;
    burst.x = x;
    burst.y = y;
    burst.vx = 0;
    burst.vy = 0;
    burst.scaleStart = 0.64;
    burst.scaleEnd = 2.4;
    burst.alphaStart = 0.78;
    burst.tint = color;
    system.spawn(burst, source, nowMs);

    const motes = system.quality.scaleBurst(GpuVfxEffectId.PowerUpPedestalBurst, 18);
    for (let index = 0; index < motes; index += 1) {
      burst.lifeMs = Phaser.Math.FloatBetween(220, 420);
      burst.x = x;
      burst.y = y;
      burst.vx = Phaser.Math.FloatBetween(-95, 95);
      burst.vy = Phaser.Math.FloatBetween(-95, 95);
      burst.scaleStart = 0.62;
      burst.scaleEnd = 0;
      burst.alphaStart = 0.9;
      burst.tint = Math.random() < 0.5 ? 0xffffff : color;
      system.spawn(burst, source, nowMs);
    }
  }

  private emitPedestalParticles(deltaMs: number, nowMs: number): void {
    const system = this.gpuVfx;
    const ambient = this.ambientSpec;
    const spark = this.sparkSpec;
    if (!system || !ambient || !spark) return;

    for (let index = 0; index < this.activePedestals.length; index += 1) {
      const visual = this.activePedestals[index];
      const ambientFrequency = system.quality.scaleFrequency(
        visual.ambientFrequency,
        GpuVfxEffectId.PowerUpPedestalAmbient,
      );
      if (ambientFrequency > 0) {
        visual.ambientFlow.setFrequency(ambientFrequency);
        const due = visual.ambientFlow.tick(deltaMs);
        for (let spawn = 0; spawn < due; spawn += 1) this.spawnAmbient(visual, ambient, nowMs);
      }

      const sparkFrequency = system.quality.scaleFrequency(
        visual.sparkFrequency,
        GpuVfxEffectId.PowerUpPedestalSpark,
      );
      if (sparkFrequency > 0) {
        visual.sparkFlow.setFrequency(sparkFrequency);
        const due = visual.sparkFlow.tick(deltaMs);
        for (let spawn = 0; spawn < due; spawn += 1) this.spawnSpark(visual, spark, nowMs);
      }
    }
  }

  private spawnAmbient(visual: PedestalVisual, spec: GpuVfxSpawnSpec, nowMs: number): void {
    const system = this.gpuVfx;
    if (!system) return;
    randomPointInCircle(POWERUP_PEDESTAL_CONFIG.renderBaseRadius + 8, PEDESTAL_SPAWN_POINT);
    spec.lifeMs = Phaser.Math.FloatBetween(500, 1100);
    spec.x = visual.state.x + PEDESTAL_SPAWN_POINT.x;
    spec.y = visual.state.y + PEDESTAL_SPAWN_POINT.y;
    spec.vx = Phaser.Math.FloatBetween(-10, 10);
    spec.vy = Phaser.Math.FloatBetween(-10, 10);
    spec.scaleStart = 0.38;
    spec.scaleEnd = 0;
    spec.alphaStart = 0.28;
    spec.tint = Math.random() < 0.5
      ? (POWERUP_DEFS[visual.state.defId]?.color ?? 0xffffff)
      : 0xffffff;
    system.spawn(spec, visual.source, nowMs);
  }

  private spawnSpark(visual: PedestalVisual, spec: GpuVfxSpawnSpec, nowMs: number): void {
    const system = this.gpuVfx;
    if (!system) return;
    randomPointInCircle(POWERUP_PEDESTAL_CONFIG.renderInnerRadius + 3, PEDESTAL_SPAWN_POINT);
    const color = POWERUP_DEFS[visual.state.defId]?.color ?? 0xffffff;
    spec.lifeMs = Phaser.Math.FloatBetween(180, 320);
    spec.x = visual.state.x + PEDESTAL_SPAWN_POINT.x;
    spec.y = visual.state.y + PEDESTAL_SPAWN_POINT.y;
    spec.vx = Phaser.Math.FloatBetween(-20, 20);
    spec.vy = Phaser.Math.FloatBetween(-20, 20);
    spec.scaleStart = 1.5;
    spec.scaleEnd = 0.3;
    spec.alphaStart = 0.75;
    spec.tint = Math.random() < 0.5 ? 0xffffff : color;
    system.spawn(spec, visual.source, nowMs);
  }

  private playMaterializeEffect(
    x: number,
    y: number,
    color: number,
    container: Phaser.GameObjects.Container,
    graphic: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle,
  ): void {
    const flash = configureAdditiveImage(
      this.scene.add.image(x, y, TEX_POWERUP_PEDESTAL_FLASH),
      DEPTH.PLAYERS - 0.9,
      0.72,
      color,
    ).setScale(0.28);

    const reveal = { value: 0 };
    graphic.setAlpha(0);
    graphic.setScale(0.35);
    container.setScale(0.88);

    this.scene.tweens.add({
      targets: reveal,
      value: 1,
      duration: 170,
      ease: 'Cubic.easeOut',
      onUpdate: () => {
        const stepped = Math.round(reveal.value * 7) / 7;
        graphic.setAlpha(stepped);
        graphic.setScale(0.35 + stepped * 0.65);
        container.setScale(0.88 + stepped * 0.12);
      },
      onComplete: () => container.setScale(1),
    });

    this.scene.tweens.add({
      targets: flash,
      alpha: 0,
      scaleX: 1.1,
      scaleY: 1.1,
      duration: 220,
      ease: 'Quad.easeOut',
      onComplete: () => flash.destroy(),
    });

    const pixelBurst = createEmitter(this.scene, x, y, TEX_POWERUP_PEDESTAL_PIXEL, {
      lifespan: { min: 120, max: 240 },
      frequency: -1,
      quantity: 1,
      speedX: { min: -60, max: 60 },
      speedY: { min: -60, max: 60 },
      scale: { start: 1.2, end: 0 },
      alpha: { start: 1, end: 0 },
      tint: [0xffffff, color],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    }, DEPTH.PLAYERS - 0.85, 'standard', 'powerUp');
    setCircleEmitZone(pixelBurst, 12, 14, true);
    pixelBurst.explode(14);

    const embers = createEmitter(this.scene, x, y, TEX_POWERUP_PEDESTAL_PARTICLE, {
      lifespan: { min: 160, max: 280 },
      frequency: -1,
      quantity: 1,
      speedX: { min: -34, max: 34 },
      speedY: { min: -34, max: 34 },
      scale: { start: 0.55, end: 0 },
      alpha: { start: 0.8, end: 0 },
      tint: [color, 0xffffff],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    }, DEPTH.PLAYERS - 0.83, 'standard', 'powerUp');
    embers.explode(10);

    this.scene.time.delayedCall(420, () => {
      destroyEmitter(pixelBurst);
      destroyEmitter(embers);
    });
  }
}

function itemLightKey(uid: number): string {
  return `powerup:${uid}`;
}

function pedestalLightKey(id: number): string {
  return `pedestal:${id}`;
}

function randomPointInCircle(radius: number, out: { x: number; y: number }): void {
  const angle = Math.random() * Math.PI * 2;
  const distance = Math.sqrt(Math.random()) * radius;
  out.x = Math.cos(angle) * distance;
  out.y = Math.sin(angle) * distance;
}
