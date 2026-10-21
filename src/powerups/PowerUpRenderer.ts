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
import { getEmissiveScale } from '../effects/EmissiveScale';
import { GpuVfxEffectId } from '../effects/gpu/GpuVfxEffects';
import type { GpuVfxSpawnSpec } from '../effects/gpu/GpuVfxSpawnSpec';
import { GPU_VFX_NO_SOURCE_HANDLE, type GpuVfxSystem } from '../effects/gpu/GpuVfxSystem';
import { ParticleFlowScheduler } from '../effects/gpu/ParticleFlowScheduler';
import type { LightingSystem } from '../effects/LightingSystem';
import {
  POWERUP_DEFS,
  POWERUP_IDLE_PARTICLES,
  POWERUP_ITEM_ART,
  POWERUP_PEDESTAL_CONFIG,
  POWERUP_RENDER_SIZE,
  powerUpHoverHeight,
  powerUpSymbolScale,
  powerUpWorldColor,
} from './PowerUpConfig';
import { POWERUP_TOKEN_KEY, powerUpSymbolArt, type PowerUpSymbolArt } from '../assets/PowerUpAssets';
import { DAWN_SCRAP_DISPLAY_SIZE, isDawnScrapTexture } from '../assets/DawnAssets';
import {
  PowerUpPedestalGpuSystem,
  resolvePowerUpPedestalGpuMode,
  type PowerUpPedestalGpuMode,
} from './PowerUpPedestalGpuSystem';
import { PowerUpItemGpuSystem } from './PowerUpItemGpuSystem';
import { POWERUP_ITEM_DEPTH } from './PowerUpItemDepth';
import { ensurePowerUpDisplayTexture } from './PowerUpItemArt';

const TEX_POWERUP_PEDESTAL_PARTICLE  = '__powerup_pedestal_particle';
const TEX_POWERUP_PEDESTAL_PIXEL     = '__powerup_pedestal_pixel';
const TEX_POWERUP_PEDESTAL_FLASH     = '__powerup_pedestal_flash';
const MISSION_REWARD_COLOR           = 0x22d7e8;
const MISSION_REWARD_PEDESTAL_SIZE   = 38;
const MISSION_REWARD_PICKUP_SIZE     = 14;
const PEDESTAL_SPAWN_POINT = { x: 0, y: 0 };

/** A power-up with authored token art: ground token plus hovering symbol. */
interface TokenVisual {
  readonly kind: 'token';
  x: number;
  y: number;
  readonly color: number;
  readonly token: Phaser.GameObjects.Image;
  readonly symbol: Phaser.GameObjects.Image;
  readonly symbolShadow: Phaser.GameObjects.Image;
  readonly tokenFit: number;
  readonly symbolFit: number;
  /** Authored symbol loop; frame 0 is the static symbol. */
  readonly art: PowerUpSymbolArt;
  frame: number;
  /** Presentation time when the reveal started; the reveal is a pure function of this clock. */
  readonly revealStartMs: number;
  readonly moteFlow: ParticleFlowScheduler;
}

/** Scrap and mission pickups keep their single-image presentation. */
interface LegacyVisual {
  readonly kind: 'legacy';
  readonly container: Phaser.GameObjects.Container;
  readonly graphic: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle | null;
  readonly color: number;
  readonly emitsLight: boolean;
}

type ItemVisual = TokenVisual | LegacyVisual;

/** The collected symbol rises toward the camera and fades; it owns no gameplay state. */
interface CollectGhost {
  readonly symbol: Phaser.GameObjects.Image;
  readonly x: number;
  readonly y: number;
  readonly fit: number;
  readonly startMs: number;
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
 * Jedes Power-Up teilt dieselbe Basis: ein Token am Boden mit leuchtendem Kanal, darum ein
 * langsam drehender Bodenring, darüber das schwebende Symbol mit eigenem Schatten. Ring, Glühen
 * und Glanz laufen als persistente GPU-Member (`PowerUpItemGpuSystem`); Schweben, Einblenden und
 * Einsammeln sind reine Funktionen der pausierbaren World-Präsentationsuhr.
 */
export class PowerUpRenderer {
  private sprites = new Map<number, ItemVisual>();
  private pedestals = new Map<number, PedestalVisual>();
  private readonly activePedestals: PedestalVisual[] = [];
  private readonly tokenItems = new Map<number, TokenVisual>();
  private readonly collectGhosts: CollectGhost[] = [];
  private readonly materializeCleanups = new Set<() => void>();
  private readonly pedestalGpu: PowerUpPedestalGpuSystem;
  private readonly itemGpu: PowerUpItemGpuSystem;
  private lighting: LightingSystem | null = null;
  private gpuVfx: GpuVfxSystem | null = null;
  private ambientSpec: GpuVfxSpawnSpec | null = null;
  private sparkSpec: GpuVfxSpawnSpec | null = null;
  private burstSpec: GpuVfxSpawnSpec | null = null;
  /** Renderer-owned source of item motes and bursts; released on World teardown. */
  private itemSource = GPU_VFX_NO_SOURCE_HANDLE;
  private presentationTimeMs = 0;

  constructor(private scene: Phaser.Scene) {
    this.ensureTextures();
    this.pedestalGpu = new PowerUpPedestalGpuSystem(scene);
    this.itemGpu = new PowerUpItemGpuSystem(scene);
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
    this.sparkSpec.scaleStart = 0.3;
    this.sparkSpec.scaleEnd = 0.06;
    this.sparkSpec.alphaStart = 0.75;
    this.sparkSpec.alphaEnd = 0;

    this.burstSpec = system.createSpec(GpuVfxEffectId.PowerUpPedestalBurst);
    this.burstSpec.alphaEnd = 0;

    system.registerEmission((deltaMs, nowMs) => {
      this.emitPedestalParticles(deltaMs, nowMs);
      this.emitItemMotes(deltaMs, nowMs);
    });
  }

  /**
   * Synchronisiert die sichtbaren PowerUp-Darstellungen mit dem aktuellen Netzwerk-Snapshot.
   */
  sync(powerups: SyncedPowerUp[]): void {
    const activeUids = new Set<number>();

    for (const pu of powerups) {
      activeUids.add(pu.uid);
      const known = this.sprites.get(pu.uid);
      if (known) {
        this.moveItem(pu.uid, known, pu.x, pu.y);
        continue;
      }

      const def = POWERUP_DEFS[pu.defId];
      const isMissionMarker = pu.pickupKind === 'objective-marker';
      const isMissionReward = pu.pickupKind === 'objective-placement';
      const isMissionVisual = isMissionMarker || isMissionReward;
      const isDawnScrap = !isMissionVisual && isDawnScrapTexture(def?.spriteKey);
      if (isDawnScrap && !this.scene.textures.exists(def.spriteKey!)) continue;
      const art = !isMissionVisual && !isDawnScrap && def?.spriteKey ? powerUpSymbolArt(def.spriteKey) : undefined;
      if (art && this.scene.textures.exists(art.key)) {
        this.createTokenItem(pu, art, powerUpWorldColor(def.id));
        continue;
      }
      this.createLegacyItem(pu, isMissionMarker, isMissionReward, isDawnScrap);
    }

    // Entfernte Items aufräumen
    for (const [uid, visual] of this.sprites) {
      if (!activeUids.has(uid)) this.removeItem(uid, visual, true);
    }
  }

  /** The World owner supplies its pausable clock; snapshot cadence cannot restart the pulse. */
  updatePresentation(presentationTimeMs: number): void {
    this.presentationTimeMs = presentationTimeMs;
    for (const [uid, visual] of this.tokenItems) this.presentToken(uid, visual, presentationTimeMs);
    this.presentCollectGhosts(presentationTimeMs);
    // Persistent glow keeps a floor by day: unlike a flash it must stay legible, not vanish.
    this.itemGpu.setEmissiveAlpha(0.62 + 0.38 * getEmissiveScale());
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
            powerUpWorldColor(pedestal.defId),
            existing.source,
          );
        }
        existing.state = pedestal;
        existing.lastHasPowerUp = pedestal.hasPowerUp;
        continue;
      }

      const mode: PowerUpPedestalGpuMode = pedestal.hasPowerUp ? 'ready' : 'idle';
      const cadence = POWERUP_IDLE_PARTICLES.pedestal[mode];
      const visual: PedestalVisual = {
        state: pedestal,
        lastHasPowerUp: pedestal.hasPowerUp,
        mode,
        ambientFrequency: cadence.ambientMs,
        sparkFrequency: cadence.sparkMs,
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
      const cadence = POWERUP_IDLE_PARTICLES.pedestal[mode];
      visual.ambientFrequency = cadence.ambientMs;
      visual.sparkFrequency = cadence.sparkMs;

      this.lighting?.setLight(
        pedestalLightKey(id),
        'pickupGlow',
        visual.state.x,
        visual.state.y,
        {
          radiusPx: POWERUP_PEDESTAL_CONFIG.renderBaseRadius * 3.4,
          color: mixColors(powerUpWorldColor(visual.state.defId), 0xffffff, 0.55),
          intensity: mode === 'ready' ? 0.54 : mode === 'announcing' ? 0.5 : 0.4,
        },
      );
    }
  }

  destroy(): void { this.clear(); this.pedestalGpu.destroy(); this.itemGpu.destroy(); }

  /** Alle Darstellungen aufräumen (Arena-Teardown). */
  clear(): void {
    for (const [uid, visual] of this.sprites) this.removeItem(uid, visual, false);
    this.sprites.clear();
    this.tokenItems.clear();
    for (const ghost of this.collectGhosts) ghost.symbol.destroy();
    this.collectGhosts.length = 0;
    for (const cleanup of this.materializeCleanups) cleanup();
    for (const [id, visual] of this.pedestals) {
      this.lighting?.releaseLight(pedestalLightKey(id));
      this.gpuVfx?.releaseSource(visual.source);
    }
    this.pedestals.clear();
    this.activePedestals.length = 0;
    this.pedestalGpu.clear();
    this.itemGpu.clear();
    if (this.itemSource !== GPU_VFX_NO_SOURCE_HANDLE) this.gpuVfx?.releaseSource(this.itemSource);
    this.itemSource = GPU_VFX_NO_SOURCE_HANDLE;
    this.gpuVfx?.quality.resetCarry(GpuVfxEffectId.PowerUpPedestalAmbient);
    this.gpuVfx?.quality.resetCarry(GpuVfxEffectId.PowerUpPedestalSpark);
    this.gpuVfx?.quality.resetCarry(GpuVfxEffectId.PowerUpPedestalBurst);
  }

  // ── Token items ──────────────────────────────────────────────────────────

  private createTokenItem(pu: SyncedPowerUp, art: PowerUpSymbolArt, color: number): void {
    const tokenKey = ensurePowerUpDisplayTexture(this.scene, POWERUP_TOKEN_KEY);
    // Loop sheets are published at display resolution; a static layer is prefiltered first.
    const symbolDisplayKey = art.frames > 1 ? art.key : ensurePowerUpDisplayTexture(this.scene, art.key);
    const token = this.scene.add.image(pu.x, pu.y, tokenKey)
      .setDisplaySize(POWERUP_RENDER_SIZE, POWERUP_RENDER_SIZE)
      .setDepth(POWERUP_ITEM_DEPTH.token);
    const symbolShadow = this.scene.add.image(pu.x, pu.y, symbolDisplayKey)
      .setDisplaySize(POWERUP_RENDER_SIZE, POWERUP_RENDER_SIZE)
      .setDepth(POWERUP_ITEM_DEPTH.symbolShadow)
      .setTint(0x000000);
    const symbol = this.scene.add.image(pu.x, pu.y, symbolDisplayKey)
      .setDisplaySize(POWERUP_RENDER_SIZE, POWERUP_RENDER_SIZE)
      .setDepth(POWERUP_ITEM_DEPTH.symbol);
    const visual: TokenVisual = {
      kind: 'token',
      x: pu.x,
      y: pu.y,
      color,
      token,
      symbol,
      symbolShadow,
      tokenFit: token.scaleX,
      symbolFit: symbol.scaleX * POWERUP_ITEM_ART.symbolScale,
      art,
      frame: 0,
      revealStartMs: this.presentationTimeMs,
      moteFlow: new ParticleFlowScheduler(POWERUP_IDLE_PARTICLES.itemMoteMs),
    };
    this.sprites.set(pu.uid, visual);
    this.tokenItems.set(pu.uid, visual);
    this.itemGpu.upsert(pu.uid, pu.x, pu.y, color);
    this.setItemLight(pu.uid, pu.x, pu.y, color);
    this.presentToken(pu.uid, visual, this.presentationTimeMs);
    this.playTokenBurst(pu.x, pu.y, color, 'reveal');
  }

  private presentToken(uid: number, visual: TokenVisual, timeMs: number): void {
    const art = POWERUP_ITEM_ART;
    const progress = Phaser.Math.Clamp((timeMs - visual.revealStartMs) / art.revealMs, 0, 1);
    const drop = 1 - easeOutCubic(progress);
    const appear = Math.min(1, progress * 1.8);
    const hover = powerUpHoverHeight(uid, timeMs) + art.revealDropPx * drop;
    const symbolScale = visual.symbolFit * powerUpSymbolScale(uid, timeMs) * (1 + 0.4 * drop);
    visual.symbol
      .setPosition(visual.x, visual.y - hover)
      .setScale(symbolScale)
      .setAlpha(appear);
    const shadow = art.symbolShadow;
    visual.symbolShadow
      .setPosition(visual.x + shadow.x + shadow.perHover * hover, visual.y + shadow.y + shadow.perHover * hover)
      .setScale(symbolScale)
      .setAlpha(shadow.alpha * appear * Phaser.Math.Clamp(1.15 - hover * 0.07, 0.3, 1));
    const tokenIn = Math.min(1, progress * 2.2);
    visual.token
      .setScale(visual.tokenFit * (0.72 + 0.28 * easeOutBack(tokenIn)))
      .setAlpha(tokenIn);
    const frame = powerUpSymbolFrame(visual.art, uid, timeMs);
    if (frame !== visual.frame) {
      visual.frame = frame;
      visual.symbol.setFrame(frame);
      visual.symbolShadow.setFrame(frame);
    }
  }

  private presentCollectGhosts(timeMs: number): void {
    for (let index = this.collectGhosts.length - 1; index >= 0; index -= 1) {
      const ghost = this.collectGhosts[index];
      const progress = (timeMs - ghost.startMs) / POWERUP_ITEM_ART.collectMs;
      if (progress >= 1 || progress < 0) {
        ghost.symbol.destroy();
        this.collectGhosts.splice(index, 1);
        continue;
      }
      const eased = easeOutCubic(progress);
      ghost.symbol
        .setPosition(ghost.x, ghost.y - POWERUP_ITEM_ART.hoverPx - 7 * eased)
        .setScale(ghost.fit * (1 + 0.55 * eased))
        .setAlpha(1 - progress * progress);
    }
  }

  private moveItem(uid: number, visual: ItemVisual, x: number, y: number): void {
    if (visual.kind === 'legacy') {
      visual.container.setPosition(x, y);
      if (visual.emitsLight) this.setItemLight(uid, x, y, visual.color);
      return;
    }
    if (visual.x === x && visual.y === y) {
      this.setItemLight(uid, x, y, visual.color);
      return;
    }
    visual.x = x; visual.y = y;
    visual.token.setPosition(x, y);
    this.itemGpu.upsert(uid, x, y, visual.color);
    this.setItemLight(uid, x, y, visual.color);
    this.presentToken(uid, visual, this.presentationTimeMs);
  }

  /** `collected` plays the pickup feedback; World teardown removes silently. */
  private removeItem(uid: number, visual: ItemVisual, collected: boolean): void {
    this.lighting?.releaseLight(itemLightKey(uid));
    this.sprites.delete(uid);
    if (visual.kind === 'legacy') {
      visual.container.destroy(true);
      return;
    }
    this.tokenItems.delete(uid);
    this.itemGpu.remove(uid);
    visual.token.destroy();
    visual.symbolShadow.destroy();
    if (!collected) {
      visual.symbol.destroy();
      return;
    }
    // The symbol itself becomes the pickup feedback instead of a second sprite.
    this.collectGhosts.push({
      symbol: visual.symbol,
      x: visual.x,
      y: visual.y,
      fit: visual.symbol.scaleX,
      startMs: this.presentationTimeMs,
    });
    this.playTokenBurst(visual.x, visual.y, visual.color, 'collect');
  }

  private emitItemMotes(deltaMs: number, nowMs: number): void {
    const system = this.gpuVfx;
    const spec = this.sparkSpec;
    if (!system || !spec || this.tokenItems.size === 0) return;
    const frequency = system.quality.scaleFrequency(POWERUP_IDLE_PARTICLES.itemMoteMs, GpuVfxEffectId.PowerUpPedestalSpark);
    if (frequency <= 0) return;
    const source = this.ensureItemSource();
    for (const visual of this.tokenItems.values()) {
      visual.moteFlow.setFrequency(frequency);
      const due = visual.moteFlow.tick(deltaMs);
      for (let spawn = 0; spawn < due; spawn += 1) {
        // Motes leave the ring and drift slightly outward while they fade toward the camera.
        const angle = Math.random() * Math.PI * 2;
        const radius = POWERUP_ITEM_ART.ringDiameter / 2 * Phaser.Math.FloatBetween(0.72, 1);
        spec.lifeMs = Phaser.Math.FloatBetween(520, 900);
        spec.x = visual.x + Math.cos(angle) * radius;
        spec.y = visual.y + Math.sin(angle) * radius;
        spec.vx = Math.cos(angle) * Phaser.Math.FloatBetween(3, 9);
        spec.vy = Math.sin(angle) * Phaser.Math.FloatBetween(3, 9) - Phaser.Math.FloatBetween(4, 10);
        // Resting pickups breathe quietly; spawn and pickup bursts stay the loud moments.
        spec.scaleStart = Phaser.Math.FloatBetween(0.16, 0.24);
        spec.scaleEnd = 0;
        spec.alphaStart = 0.5;
        spec.tint = Math.random() < 0.4 ? 0xffffff : mixColors(visual.color, 0xffffff, 0.25);
        system.spawn(spec, source, nowMs);
      }
    }
  }

  private playTokenBurst(x: number, y: number, color: number, kind: 'reveal' | 'collect'): void {
    const system = this.gpuVfx;
    const burst = this.burstSpec;
    if (!system || !burst) return;
    const source = this.ensureItemSource();
    const nowMs = system.now();
    const collect = kind === 'collect';
    burst.lifeMs = collect ? 240 : 300;
    burst.x = x;
    burst.y = y - POWERUP_ITEM_ART.hoverPx;
    burst.vx = 0;
    burst.vy = 0;
    burst.scaleStart = collect ? 0.9 : 0.4;
    burst.scaleEnd = collect ? 2.8 : 2.1;
    burst.alphaStart = collect ? 0.95 : 0.8;
    burst.tint = mixColors(color, 0xffffff, 0.35);
    system.spawn(burst, source, nowMs);

    const motes = system.quality.scaleBurst(GpuVfxEffectId.PowerUpPedestalBurst, collect ? 14 : 16);
    for (let index = 0; index < motes; index += 1) {
      const angle = index / Math.max(1, motes) * Math.PI * 2 + Math.random() * 0.4;
      const speed = Phaser.Math.FloatBetween(collect ? 60 : 30, collect ? 120 : 70);
      // A reveal gathers inward onto the token; a pickup scatters outward.
      const start = collect ? 4 : POWERUP_ITEM_ART.ringDiameter * 0.75;
      const direction = collect ? 1 : -1;
      burst.lifeMs = Phaser.Math.FloatBetween(collect ? 260 : 280, collect ? 440 : 420);
      burst.x = x + Math.cos(angle) * start;
      burst.y = y + Math.sin(angle) * start;
      burst.vx = Math.cos(angle) * speed * direction;
      burst.vy = Math.sin(angle) * speed * direction;
      burst.scaleStart = collect ? 0.36 : 0.28;
      burst.scaleEnd = 0;
      burst.alphaStart = 0.95;
      burst.tint = Math.random() < 0.45 ? 0xffffff : color;
      system.spawn(burst, source, nowMs);
    }
  }

  private ensureItemSource(): number {
    if (this.itemSource === GPU_VFX_NO_SOURCE_HANDLE && this.gpuVfx) {
      this.itemSource = this.gpuVfx.createSource(GpuVfxEffectId.PowerUpPedestalBurst);
    }
    return this.itemSource;
  }

  // ── Legacy items: scrap and mission visuals ─────────────────────────────

  private createLegacyItem(
    pu: SyncedPowerUp,
    isMissionMarker: boolean,
    isMissionReward: boolean,
    isDawnScrap: boolean,
  ): void {
    const def = POWERUP_DEFS[pu.defId];
    const renderSize = isDawnScrap ? DAWN_SCRAP_DISPLAY_SIZE : POWERUP_RENDER_SIZE;
    const glowColor = isMissionMarker || isMissionReward ? MISSION_REWARD_COLOR : (def?.color ?? 0xffffff);
    // Deterministischer Phasen-Offset: Items pulsieren leicht gegeneinander versetzt
    const phaseMs = (pu.uid * 137) % 1400;
    const container = this.scene.add.container(pu.x, pu.y);
    container.setDepth(DEPTH.PLAYERS - 1);
    const graphic: LegacyVisual['graphic'] =
      isMissionMarker
        ? null
        : isMissionReward
          ? this.scene.add.image(0, 0, 'mission_reward_pickup').setDisplaySize(MISSION_REWARD_PICKUP_SIZE, MISSION_REWARD_PICKUP_SIZE)
          : def?.spriteKey
            ? this.scene.add.image(0, 0, def.spriteKey).setDisplaySize(renderSize, renderSize)
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
    if (isMissionMarker || isMissionReward || !graphic) {
      this.sprites.set(pu.uid, { kind: 'legacy', container, graphic, color: glowColor, emitsLight: false });
      return;
    }

    const itemAura = configureAdditiveImage(
      this.scene.add.image(0, 0, TEX_POWERUP_PEDESTAL_FLASH),
      DEPTH.PLAYERS - 1.2,
      0.18,
      glowColor,
    ).setScale(0.52);
    container.addAt(itemAura, 0);

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

    this.sprites.set(pu.uid, { kind: 'legacy', container, graphic, color: glowColor, emitsLight: true });
    this.setItemLight(pu.uid, pu.x, pu.y, glowColor);
    this.playMaterializeEffect(pu.x, pu.y, glowColor, container, graphic);
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
      const ambientFrequency = visual.ambientFrequency > 0 ? system.quality.scaleFrequency(
        visual.ambientFrequency,
        GpuVfxEffectId.PowerUpPedestalAmbient,
      ) : 0;
      if (ambientFrequency > 0) {
        visual.ambientFlow.setFrequency(ambientFrequency);
        const due = visual.ambientFlow.tick(deltaMs);
        for (let spawn = 0; spawn < due; spawn += 1) this.spawnAmbient(visual, ambient, nowMs);
      }

      const sparkFrequency = visual.sparkFrequency > 0 ? system.quality.scaleFrequency(
        visual.sparkFrequency,
        GpuVfxEffectId.PowerUpPedestalSpark,
      ) : 0;
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
    spec.scaleStart = 0.34;
    spec.scaleEnd = 0;
    spec.alphaStart = 0.2;
    spec.tint = Math.random() < 0.5
      ? powerUpWorldColor(visual.state.defId)
      : 0xffffff;
    system.spawn(spec, visual.source, nowMs);
  }

  private spawnSpark(visual: PedestalVisual, spec: GpuVfxSpawnSpec, nowMs: number): void {
    const system = this.gpuVfx;
    if (!system) return;
    randomPointInCircle(POWERUP_PEDESTAL_CONFIG.renderInnerRadius + 3, PEDESTAL_SPAWN_POINT);
    const color = powerUpWorldColor(visual.state.defId);
    spec.lifeMs = Phaser.Math.FloatBetween(180, 320);
    spec.x = visual.state.x + PEDESTAL_SPAWN_POINT.x;
    spec.y = visual.state.y + PEDESTAL_SPAWN_POINT.y;
    spec.vx = Phaser.Math.FloatBetween(-20, 20);
    spec.vy = Phaser.Math.FloatBetween(-20, 20);
    spec.scaleStart = 0.3;
    spec.scaleEnd = 0.06;
    spec.alphaStart = 0.55;
    spec.tint = Math.random() < 0.5 ? 0xffffff : color;
    system.spawn(spec, visual.source, nowMs);
  }

  private playMaterializeEffect(
    x: number,
    y: number,
    color: number,
    container: Phaser.GameObjects.Container,
    graphic: NonNullable<LegacyVisual['graphic']>,
  ): void {
    const flash = configureAdditiveImage(
      this.scene.add.image(x, y, TEX_POWERUP_PEDESTAL_FLASH),
      DEPTH.PLAYERS - 0.9,
      0.72,
      color,
    ).setScale(0.28);

    const reveal = { value: 0 };
    const baseScaleX = graphic.scaleX;
    const baseScaleY = graphic.scaleY;
    graphic.setAlpha(0);
    graphic.setScale(baseScaleX * 0.35, baseScaleY * 0.35);
    container.setScale(0.88);

    const revealTween = this.scene.tweens.add({
      targets: reveal,
      value: 1,
      duration: 170,
      ease: 'Cubic.easeOut',
      onUpdate: () => {
        const stepped = Math.round(reveal.value * 7) / 7;
        graphic.setAlpha(stepped);
        const revealScale = 0.35 + stepped * 0.65;
        graphic.setScale(baseScaleX * revealScale, baseScaleY * revealScale);
        container.setScale(0.88 + stepped * 0.12);
      },
      onComplete: () => {
        graphic.setAlpha(1);
        graphic.setScale(baseScaleX, baseScaleY);
        container.setScale(1);
      },
    });
    container.once(Phaser.GameObjects.Events.DESTROY, () => revealTween.stop());

    const flashTween = this.scene.tweens.add({
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

    let cleanupTimer: Phaser.Time.TimerEvent | null = null;
    const cleanup = () => {
      if (!this.materializeCleanups.delete(cleanup)) return;
      cleanupTimer?.remove(false);
      revealTween.stop();
      flashTween.stop();
      flash.destroy();
      destroyEmitter(pixelBurst);
      destroyEmitter(embers);
    };
    this.materializeCleanups.add(cleanup);
    cleanupTimer = this.scene.time.delayedCall(420, cleanup);
  }
}

/** Loop frame on the pausable World clock, phase-shifted per pickup like the hover pulse. */
export function powerUpSymbolFrame(art: PowerUpSymbolArt, uid: number, timeMs: number): number {
  if (art.frames <= 1) return 0;
  return Math.floor(Math.max(0, timeMs + uid * 137) * art.fps / 1000) % art.frames;
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function easeOutBack(t: number): number {
  const overshoot = 1.70158;
  return 1 + (overshoot + 1) * (t - 1) ** 3 + overshoot * (t - 1) ** 2;
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
