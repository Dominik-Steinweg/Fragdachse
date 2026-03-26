import Phaser from 'phaser';
import type { SyncedPowerUp, SyncedPowerUpPedestal } from '../types';
import { DEPTH } from '../config';
import {
  configureAdditiveImage,
  createEmitter,
  destroyEmitter,
  ensureCanvasTexture,
  fillRadialGradientTexture,
  setCircleEmitZone,
} from '../effects/EffectUtils';
import { POWERUP_DEFS, POWERUP_PEDESTAL_CONFIG, POWERUP_RENDER_SIZE } from './PowerUpConfig';

const TEX_POWERUP_PEDESTAL_OUTER_GLOW = '__powerup_pedestal_outer_glow';
const TEX_POWERUP_PEDESTAL_GLOW      = '__powerup_pedestal_glow';
const TEX_POWERUP_PEDESTAL_PARTICLE  = '__powerup_pedestal_particle';
const TEX_POWERUP_PEDESTAL_PIXEL     = '__powerup_pedestal_pixel';
const TEX_POWERUP_PEDESTAL_FLASH     = '__powerup_pedestal_flash';

interface ItemVisual {
  container: Phaser.GameObjects.Container;
  graphic: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle;
}

interface PedestalVisual {
  container: Phaser.GameObjects.Container;
  outerGlow: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image;
  aura: Phaser.GameObjects.Image;
  ringOuter: Phaser.GameObjects.Arc;
  ringInner: Phaser.GameObjects.Arc;
  core: Phaser.GameObjects.Arc;
  ambientEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  sparkEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  state: SyncedPowerUpPedestal;
  lastHasPowerUp: boolean;
}

/**
 * Rendert Power-Up-Items auf dem Spielfeld (Host + Client).
 *
 * Aufbau je Container (Schicht-Reihenfolge = Render-Reihenfolge):
 *   [0] Image | Rectangle – die eigentliche Grafik (feste Größe)
 *       └─ preFX.addGlow()  – Pixel-Lichtaura direkt an der Grafikkante,
 *                             outerStrength pulsiert via Tween
 *
 * Der preFX-Glow rendert die Aura hinter dem Sprite-Pixel, die Grafik bleibt
 * immer sichtbar vorne. Der Glow-Tween-Cleanup erfolgt über das destroy-Event
 * der Grafik – keine separate Tween-Map nötig.
 * Container.destroy(true) räumt Grafik + deren Tweens automatisch auf.
 */
export class PowerUpRenderer {
  private sprites = new Map<number, ItemVisual>();
  private pedestals = new Map<number, PedestalVisual>();

  constructor(private scene: Phaser.Scene) {
    this.ensureTextures();
  }

  /**
   * Synchronisiert die sichtbaren PowerUp-Container mit dem aktuellen Netzwerk-Snapshot.
   */
  sync(powerups: SyncedPowerUp[]): void {
    const activeUids = new Set<number>();

    for (const pu of powerups) {
      activeUids.add(pu.uid);
      if (this.sprites.has(pu.uid)) {
        this.sprites.get(pu.uid)!.container.setPosition(pu.x, pu.y);
        continue;
      }

      const def       = POWERUP_DEFS[pu.defId];
      const glowColor = def?.color ?? 0xffffff;
      // Deterministischer Phasen-Offset: Items pulsieren leicht gegeneinander versetzt
      const phaseMs   = (pu.uid * 137) % 1400;

      // ── Container ─────────────────────────────────────────────────────────
      const container = this.scene.add.container(pu.x, pu.y);
      container.setDepth(DEPTH.PLAYERS - 1);

      // ── Grafik: feste Größe, kein Scale-Tween ─────────────────────────────
      const graphic: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle =
        def?.spriteKey
          ? this.scene.add.image(0, 0, def.spriteKey).setDisplaySize(POWERUP_RENDER_SIZE, POWERUP_RENDER_SIZE)
          : this.scene.add.rectangle(0, 0, POWERUP_RENDER_SIZE, POWERUP_RENDER_SIZE, glowColor);
      container.add(graphic);

      const itemAura = configureAdditiveImage(
        this.scene.add.image(0, 0, TEX_POWERUP_PEDESTAL_FLASH),
        DEPTH.PLAYERS - 1.2,
        0.18,
        glowColor,
      ).setScale(0.52);
      container.addAt(itemAura, 0);

      // ── preFX-Glow: Pixel-Aura, outerStrength pulsiert ───────────────────
      const glow = graphic.preFX?.addGlow(glowColor, 2, 0, false, 0.1, 14);
      if (glow) {
        const glowTween = this.scene.tweens.add({
          targets:       glow,
          outerStrength: { from: 2, to: 8 },
          duration:      900,
          yoyo:          true,
          repeat:        -1,
          ease:          'Sine.easeInOut',
          delay:         phaseMs,
        });
        // Tween-Cleanup ohne separate Map: destroy-Event der Grafik abfangen
        graphic.once(Phaser.GameObjects.Events.DESTROY, () => glowTween.stop());
      }

      this.sprites.set(pu.uid, { container, graphic });
      this.playMaterializeEffect(pu.x, pu.y, glowColor, container, graphic);
    }

    // Entfernte Items aufräumen
    for (const [uid, visual] of this.sprites) {
      if (!activeUids.has(uid)) {
        visual.container.destroy(true); // Kinder (Arc, Grafik) + deren Tweens werden mitgelöscht
        this.sprites.delete(uid);
      }
    }
  }

  syncPedestals(pedestals: SyncedPowerUpPedestal[]): void {
    const activeIds = new Set<number>();

    for (const pedestal of pedestals) {
      activeIds.add(pedestal.id);
      const existing = this.pedestals.get(pedestal.id);
      if (existing) {
        if (!existing.lastHasPowerUp && pedestal.hasPowerUp) {
          this.playPedestalSpawnBurst(pedestal.x, pedestal.y, POWERUP_DEFS[pedestal.defId]?.color ?? 0xffffff);
        }
        existing.state = pedestal;
        existing.container.setPosition(pedestal.x, pedestal.y);
        existing.ambientEmitter.setPosition(pedestal.x, pedestal.y);
        existing.sparkEmitter.setPosition(pedestal.x, pedestal.y);
        existing.lastHasPowerUp = pedestal.hasPowerUp;
        continue;
      }

      const def = POWERUP_DEFS[pedestal.defId];
      const glowColor = def?.color ?? 0xffffff;
      const container = this.scene.add.container(pedestal.x, pedestal.y);
      container.setDepth(DEPTH.PLAYERS - 2);

      const outerGlow = configureAdditiveImage(
        this.scene.add.image(0, 0, TEX_POWERUP_PEDESTAL_OUTER_GLOW),
        DEPTH.PLAYERS - 2.35,
        0.0,
        glowColor,
      );

      const shadow = this.scene.add.circle(0, 0, POWERUP_PEDESTAL_CONFIG.renderBaseRadius + 6, 0x04070c, 0.42);
      const base = this.scene.add.circle(0, 0, POWERUP_PEDESTAL_CONFIG.renderBaseRadius, 0x0c121c, 0.96)
        .setStrokeStyle(2, 0x25313c, 0.95);
      const plate = this.scene.add.circle(0, 0, POWERUP_PEDESTAL_CONFIG.renderInnerRadius, 0x121b27, 0.94)
        .setStrokeStyle(2, glowColor, 0.42);
      const core = this.scene.add.circle(0, 0, POWERUP_PEDESTAL_CONFIG.renderCoreRadius, glowColor, 0.2)
        .setStrokeStyle(1.5, 0xffffff, 0.14);
      const ringOuter = this.scene.add.circle(0, 0, POWERUP_PEDESTAL_CONFIG.renderBaseRadius + 1)
        .setStrokeStyle(2, glowColor, 0.75);
      const ringInner = this.scene.add.circle(0, 0, POWERUP_PEDESTAL_CONFIG.renderInnerRadius - 2)
        .setStrokeStyle(2, 0xffffff, 0.18);
      const glow = configureAdditiveImage(
        this.scene.add.image(0, 0, TEX_POWERUP_PEDESTAL_GLOW),
        DEPTH.PLAYERS - 2.2,
        0.38,
        glowColor,
      ).setScale(0.84);
      const aura = configureAdditiveImage(
        this.scene.add.image(0, 0, TEX_POWERUP_PEDESTAL_FLASH),
        DEPTH.PLAYERS - 2.1,
        0.22,
        glowColor,
      ).setScale(0.56);

      const ambientEmitter = createEmitter(this.scene, pedestal.x, pedestal.y, TEX_POWERUP_PEDESTAL_PARTICLE, {
        lifespan: { min: 500, max: 1100 },
        frequency: 120,
        quantity: 1,
        speedX: { min: -10, max: 10 },
        speedY: { min: -10, max: 10 },
        scale: { start: 0.46, end: 0 },
        alpha: { start: 0.28, end: 0 },
        tint: [glowColor, 0xffffff],
        blendMode: Phaser.BlendModes.ADD,
        emitting: true,
      }, DEPTH.PLAYERS - 2.15);
      setCircleEmitZone(ambientEmitter, POWERUP_PEDESTAL_CONFIG.renderBaseRadius + 8, 2, true);

      const sparkEmitter = createEmitter(this.scene, pedestal.x, pedestal.y, TEX_POWERUP_PEDESTAL_PIXEL, {
        lifespan: { min: 180, max: 320 },
        frequency: 200,
        quantity: 1,
        speedX: { min: -20, max: 20 },
        speedY: { min: -20, max: 20 },
        scale: { start: 1.0, end: 0.2 },
        alpha: { start: 0.75, end: 0 },
        tint: [0xffffff, glowColor],
        blendMode: Phaser.BlendModes.ADD,
        emitting: true,
      }, DEPTH.PLAYERS - 2.05);
      setCircleEmitZone(sparkEmitter, POWERUP_PEDESTAL_CONFIG.renderInnerRadius + 3, 1, true);

      container.add([outerGlow, glow, aura, shadow, base, plate, core, ringOuter, ringInner]);
      this.pedestals.set(pedestal.id, {
        container,
        outerGlow,
        glow,
        aura,
        ringOuter,
        ringInner,
        core,
        ambientEmitter,
        sparkEmitter,
        state: pedestal,
        lastHasPowerUp: pedestal.hasPowerUp,
      });
    }

    for (const [id, visual] of this.pedestals) {
      if (!activeIds.has(id)) {
        destroyEmitter(visual.ambientEmitter);
        destroyEmitter(visual.sparkEmitter);
        visual.container.destroy(true);
        this.pedestals.delete(id);
      }
    }
  }

  updatePedestals(now: number): void {
    for (const [id, visual] of this.pedestals) {
      const phase   = now / 1000 + id * 0.37;
      const breath  = 0.5 + 0.5 * Math.sin(phase * 2.2);
      // Zweite schnellere Welle – Schwebung mit breath erzeugt das Wabern
      const shimmer = 0.5 + 0.5 * Math.sin(phase * 5.8 + id * 1.3);
      const hasPowerUp = visual.state.hasPowerUp;
      const timeUntilRespawn = visual.state.nextRespawnAt > 0 ? visual.state.nextRespawnAt - now : Number.POSITIVE_INFINITY;
      const isAnnouncing = !hasPowerUp && Number.isFinite(timeUntilRespawn) && timeUntilRespawn > 0 && timeUntilRespawn <= POWERUP_PEDESTAL_CONFIG.announceLeadMs;

      let outerGlowAlpha = 0.26 + breath * 0.14;
      let outerGlowScale = 0.86 + breath * 0.17;
      let glowAlpha = 0.18 + breath * 0.08;
      let glowScale = 0.82 + breath * 0.06;
      let auraAlpha = 0.14 + breath * 0.06;
      let auraScale = 0.56 + breath * 0.04;
      let ringOuterAlpha = 0.52 + breath * 0.1;
      let ringInnerAlpha = 0.12 + breath * 0.06;
      let coreAlpha = 0.12 + breath * 0.08;
      let ringPulse = 1 + breath * 0.03;
      let sparkFrequency = 220;
      let ambientFrequency = 135;

      if (hasPowerUp) {
        // Schwebungseffekt: breath (2.2 Hz) + shimmer (5.8 Hz) → Beat ~0.57 Hz
        outerGlowAlpha = 0.28 + breath * 0.20 + shimmer * 0.12;
        outerGlowScale = 0.90 + breath * 0.18 + shimmer * 0.08;
        glowAlpha = 0.34 + breath * 0.14;
        glowScale = 0.92 + breath * 0.11;
        auraAlpha = 0.22 + breath * 0.1;
        auraScale = 0.64 + breath * 0.08;
        ringOuterAlpha = 0.76 + breath * 0.14;
        ringInnerAlpha = 0.2 + breath * 0.08;
        coreAlpha = 0.24 + breath * 0.15;
        ringPulse = 1.02 + breath * 0.045;
        sparkFrequency = 150;
        ambientFrequency = 95;
      } else if (isAnnouncing) {
        const blink = 0.5 + 0.5 * Math.sin(now / 90 + id * 1.7);
        const progress = 1 - (timeUntilRespawn / POWERUP_PEDESTAL_CONFIG.announceLeadMs);
        outerGlowAlpha = 0.12 + blink * (0.26 + progress * 0.16);
        outerGlowScale = 0.88 + blink * 0.20 + progress * 0.10;
        glowAlpha = 0.24 + blink * (0.28 + progress * 0.14);
        glowScale = 0.88 + blink * 0.16 + progress * 0.12;
        auraAlpha = 0.18 + blink * 0.2;
        auraScale = 0.58 + blink * 0.11 + progress * 0.06;
        ringOuterAlpha = 0.54 + blink * 0.36;
        ringInnerAlpha = 0.16 + blink * 0.2;
        coreAlpha = 0.12 + blink * 0.18;
        ringPulse = 1.04 + blink * 0.08;
        sparkFrequency = 95;
        ambientFrequency = 80;
      }

      visual.container.setScale(ringPulse);
      visual.outerGlow.setAlpha(outerGlowAlpha).setScale(outerGlowScale);
      visual.glow.setAlpha(glowAlpha).setScale(glowScale);
      visual.aura.setAlpha(auraAlpha).setScale(auraScale);
      visual.ringOuter.setAlpha(ringOuterAlpha).setScale(ringPulse);
      visual.ringInner.setAlpha(ringInnerAlpha).setScale(1 + breath * 0.02);
      visual.core.setAlpha(coreAlpha).setScale(1 + breath * 0.05);
      visual.ambientEmitter.frequency = ambientFrequency;
      visual.sparkEmitter.frequency = sparkFrequency;
    }
  }

  /** Alle Container aufräumen (Arena-Teardown). */
  clear(): void {
    for (const visual of this.sprites.values()) visual.container.destroy(true);
    this.sprites.clear();
    for (const visual of this.pedestals.values()) {
      destroyEmitter(visual.ambientEmitter);
      destroyEmitter(visual.sparkEmitter);
      visual.container.destroy(true);
    }
    this.pedestals.clear();
  }

  private ensureTextures(): void {
    // Großes weiches Außenleuchten – wird per Tint in die Power-Up-Farbe eingefärbt
    fillRadialGradientTexture(this.scene.textures, TEX_POWERUP_PEDESTAL_OUTER_GLOW, 160, [
      [0,    'rgba(255,255,255,0.92)'],
      [0.14, 'rgba(255,255,255,0.60)'],
      [0.35, 'rgba(255,255,255,0.22)'],
      [0.62, 'rgba(255,255,255,0.06)'],
      [0.85, 'rgba(255,255,255,0.01)'],
      [1,    'rgba(255,255,255,0.00)'],
    ]);

    fillRadialGradientTexture(this.scene.textures, TEX_POWERUP_PEDESTAL_GLOW, POWERUP_PEDESTAL_CONFIG.renderGlowSize, [
      [0, 'rgba(255,255,255,0.92)'],
      [0.22, 'rgba(255,255,255,0.34)'],
      [0.55, 'rgba(170,220,255,0.12)'],
      [1, 'rgba(0,0,0,0.0)'],
    ]);

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

  private playPedestalSpawnBurst(x: number, y: number, color: number): void {
    const flash = configureAdditiveImage(
      this.scene.add.image(x, y, TEX_POWERUP_PEDESTAL_FLASH),
      DEPTH.PLAYERS - 1.05,
      0.78,
      color,
    ).setScale(0.38);

    this.scene.tweens.add({
      targets: flash,
      alpha: 0,
      scaleX: 1.45,
      scaleY: 1.45,
      duration: 180,
      ease: 'Quad.easeOut',
      onComplete: () => flash.destroy(),
    });

    const burst = createEmitter(this.scene, x, y, TEX_POWERUP_PEDESTAL_PARTICLE, {
      lifespan: { min: 220, max: 420 },
      frequency: -1,
      quantity: 1,
      speedX: { min: -95, max: 95 },
      speedY: { min: -95, max: 95 },
      scale: { start: 0.75, end: 0 },
      alpha: { start: 0.9, end: 0 },
      tint: [0xffffff, color],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    }, DEPTH.PLAYERS - 0.95);
    burst.explode(18);
    this.scene.time.delayedCall(450, () => destroyEmitter(burst));
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
    }, DEPTH.PLAYERS - 0.85);
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
    }, DEPTH.PLAYERS - 0.83);
    embers.explode(10);

    this.scene.time.delayedCall(420, () => {
      destroyEmitter(pixelBurst);
      destroyEmitter(embers);
    });
  }
}
