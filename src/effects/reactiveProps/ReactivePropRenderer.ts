import * as Phaser from 'phaser';
import { DEPTH, DEPTH_LIGHTING } from '../../config';
import { resolveReactivePropVariant } from '../../config/reactiveProps/reactivePropKinds';
import type { ReactivePropPresentationState, ReactivePropRuntime } from '../../world/reactiveProps/ReactivePropRuntime';
import { fillRadialGradientTexture } from '../EffectUtils';
import { emissiveAlpha } from '../EmissiveScale';
import type { EntityBurnGpuController } from '../EntityBurnGpuController';
import { EntityBurnRenderer } from '../EntityBurnRenderer';
import type { LightingSystem } from '../LightingSystem';
import { REACTIVE_PROP_VISUAL, resolveReactivePropVisual } from './ReactivePropVisualModel';
import { getReactivePropVariantOverride } from './ReactivePropVariantOverride';

const GLOW_TEXTURE = 'reactive_prop_glow';
const SHARD_TEXTURE = 'reactive_prop_shard';
const RING_TEXTURE = 'reactive_prop_warning_ring';
const SHARD_COUNT = 7;
const SHARD_LIFETIME_MS = 650;
/** Brand sitzt auf dem Deckel, nicht auf dem Boden daneben. */
const BURN_BODY_PX = 18;
/** Flammen züngeln aus dem Deckel nach oben, statt das Schild zu überdecken. */
const BURN_OFFSET_Y = -5;

interface PropVisual {
  sprite: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image | null;
  ring: Phaser.GameObjects.Image | null;
  burn: EntityBurnRenderer | null;
  textureKey: string;
  lastProgress: number;
  flashUntil: number;
  /** Zuletzt lebend gesehen: nur dann spielt der Abgang Splitter (kein Effekt beim Late Join). */
  seenAlive: boolean;
}

interface Shard {
  image: Phaser.GameObjects.Image;
  startX: number; startY: number; vx: number; vy: number; spin: number; bornAt: number;
}

/**
 * Darstellung reaktiver Map-Objekte. Liest ausschließlich die replizierte Projektion des
 * World-Owners; Explosion, Bodenfeuer und Chunks kommen über ihre eigenen Effektkanäle.
 */
export class ReactivePropRenderer {
  private readonly props = new Map<number, PropVisual>();
  private readonly shards: Shard[] = [];
  private readonly lightKeys = new Set<string>();
  private destroyed = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly lighting: LightingSystem | null,
    private readonly burnGpu: EntityBurnGpuController | null,
  ) {
    fillRadialGradientTexture(scene.textures, GLOW_TEXTURE, 64, [
      [0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,255,255,0.6)'], [0.65, 'rgba(255,255,255,0.16)'], [1, 'rgba(255,255,255,0)'],
    ]);
    ensureShardTexture(scene);
    ensureRingTexture(scene);
  }

  sync(runtime: ReactivePropRuntime, nowMs: number): void {
    if (this.destroyed) return;
    const artificial = this.lighting?.getArtificialLightFactor() ?? 0;
    runtime.forEachPresentationState(state => {
      const position = runtime.getPosition(state.obstacleId);
      if (position) this.syncProp(state, position.x, position.y, nowMs, artificial);
    });
    this.advanceShards(nowMs);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const key of this.lightKeys) this.lighting?.releaseLight(key, { immediate: true });
    this.lightKeys.clear();
    for (const visual of this.props.values()) this.disposeVisual(visual);
    this.props.clear();
    for (const shard of this.shards) shard.image.destroy();
    this.shards.length = 0;
  }

  private syncProp(state: ReactivePropPresentationState, x: number, y: number, nowMs: number, artificial: number): void {
    const visualState = resolveReactivePropVisual(state.phase, state.progress, nowMs);
    let visual = this.props.get(state.index);
    const lightKey = `reactive-prop:${state.index}`;
    if (!visualState.visible) {
      if (visual) {
        if (visual.seenAlive) this.playDestruction(visual, x, y, nowMs);
        this.disposeVisual(visual);
        this.props.delete(state.index);
      }
      this.releaseLight(lightKey);
      return;
    }
    const variantId = resolveReactivePropVariant(state.kind, getReactivePropVariantOverride() ?? state.cell.variant);
    const variant = state.kind.visual.variants[variantId];
    const textureKey = this.scene.textures.exists(variant.textureKey)
      ? variant.textureKey : ensurePlaceholderTexture(this.scene, variantId);
    if (!visual) {
      visual = {
        sprite: this.scene.add.image(x, y, textureKey).setOrigin(0.5).setDepth(DEPTH.ROCKS + 0.2),
        glow: null, ring: null, burn: null, textureKey, lastProgress: state.progress, flashUntil: 0, seenAlive: false,
      };
      this.props.set(state.index, visual);
    }
    visual.seenAlive = true;
    if (visual.textureKey !== textureKey) { visual.sprite.setTexture(textureKey); visual.textureKey = textureKey; }
    const size = state.kind.visual.displaySizePx;
    visual.sprite.setPosition(x, y).setDisplaySize(size, size);

    // Treffer heben das Blech kurz an; der rote Puls ist der Telegraph vor der Explosion.
    if ((state.phase === 'idle' || state.phase === 'primed') && state.progress < visual.lastProgress - 0.005) {
      visual.flashUntil = nowMs + REACTIVE_PROP_VISUAL.hitFlashMs;
    }
    visual.lastProgress = state.progress;
    if (nowMs < visual.flashUntil) visual.sprite.setTint(REACTIVE_PROP_VISUAL.hitFlashTint).setTintMode(Phaser.TintModes.ADD);
    else visual.sprite.clearTint();
    // Telegraph über der Lightmap: ein roter Ring, der sich mit sinkenden HP zusammenzieht.
    if (visualState.warning > 0) {
      visual.ring ??= this.scene.add.image(x, y, RING_TEXTURE).setDepth(DEPTH_LIGHTING + 0.1)
        .setTint(REACTIVE_PROP_VISUAL.warningColor);
      visual.ring.setVisible(true).setPosition(x, y).setDisplaySize(size * visualState.warningScale, size * visualState.warningScale)
        .setAlpha(visualState.warning);
    } else {
      visual.ring?.setVisible(false);
    }

    if (visualState.burnStacks > 0) {
      if (!visual.burn) {
        visual.burn = new EntityBurnRenderer(this.scene, this.burnGpu);
        visual.burn.setLightingSystem(this.lighting, `reactive-prop-burn:${state.index}`);
      }
      visual.burn.sync(x, y + BURN_OFFSET_Y, BURN_BODY_PX, visualState.burnStacks, true, 'normal');
    } else if (visual.burn) {
      visual.burn.destroy();
      visual.burn = null;
    }

    const glow = variant.glow;
    if (glow) {
      if (!visual.glow) {
        visual.glow = this.scene.add.image(x, y, GLOW_TEXTURE).setDepth(DEPTH_LIGHTING + 0.08)
          .setBlendMode(Phaser.BlendModes.ADD);
      }
      // Schwaches Eigenleuchten bei Tag, kräftig bei Nacht; langsam „atmend“ wie Strahlung.
      const breathe = 0.86 + 0.14 * Math.sin(nowMs / 1000 * Math.PI * 2 * 0.45 + state.index);
      // Kleiner als das Fass: der Rand bleibt bei Nacht sichtbar; brennend tritt das Gift zurück.
      const burning = visualState.burnStacks > 0 ? 0.45 : 1;
      visual.glow.setPosition(x, y).setTint(glow.color).setDisplaySize(size * 0.72, size * 0.72)
        .setAlpha(emissiveAlpha(glow.intensity * (0.3 + 0.55 * artificial) * breathe * burning));
      if (this.lighting) {
        this.lighting.setLight(lightKey, 'reactivePropGlow', x, y, {
          radiusPx: glow.radiusPx, intensity: glow.intensity * breathe, color: glow.color,
        });
        this.lightKeys.add(lightKey);
      }
    } else {
      visual.glow?.destroy();
      visual.glow = null;
      this.releaseLight(lightKey);
    }
  }

  private playDestruction(visual: PropVisual, x: number, y: number, nowMs: number): void {
    const view = this.scene.cameras.main.worldView;
    if (!Phaser.Geom.Rectangle.Contains(view, x, y)) return;
    const tint = visual.textureKey.includes('toxic') ? 0x5f6b48 : 0x8a3a24;
    for (let i = 0; i < SHARD_COUNT; i++) {
      const angle = (i / SHARD_COUNT) * Math.PI * 2 + Math.random() * 0.6;
      const speed = 70 + Math.random() * 110;
      const image = this.scene.add.image(x, y, SHARD_TEXTURE).setDepth(DEPTH.ROCKS + 0.3)
        .setTint(tint).setScale(0.6 + Math.random() * 0.6).setRotation(Math.random() * Math.PI);
      this.shards.push({ image, startX: x, startY: y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        spin: (Math.random() - 0.5) * 14, bornAt: nowMs });
    }
  }

  private advanceShards(nowMs: number): void {
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const shard = this.shards[i];
      const t = (nowMs - shard.bornAt) / SHARD_LIFETIME_MS;
      if (t >= 1) { shard.image.destroy(); this.shards.splice(i, 1); continue; }
      // Schnell hinaus, dann ausrollen: Ease-out ohne Physik.
      const travel = (1 - (1 - t) * (1 - t)) * SHARD_LIFETIME_MS / 1000;
      shard.image.setPosition(shard.startX + shard.vx * travel, shard.startY + shard.vy * travel)
        .setRotation(shard.spin * travel).setAlpha(1 - t * t);
    }
  }

  private disposeVisual(visual: PropVisual): void {
    visual.sprite.destroy();
    visual.glow?.destroy();
    visual.ring?.destroy();
    visual.burn?.destroy();
  }

  private releaseLight(key: string): void {
    if (!this.lightKeys.delete(key)) return;
    this.lighting?.releaseLight(key, { immediate: true });
  }
}

function ensureRingTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(RING_TEXTURE)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.lineStyle(7, 0xffffff, 0.35).strokeCircle(32, 32, 27);
  g.lineStyle(3, 0xffffff, 1).strokeCircle(32, 32, 27);
  g.generateTexture(RING_TEXTURE, 64, 64);
  g.destroy();
}

function ensureShardTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(SHARD_TEXTURE)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0xffffff, 1);
  g.fillTriangle(0, 1, 7, 0, 4, 5);
  g.fillStyle(0x000000, 0.35);
  g.fillTriangle(4, 5, 7, 0, 6, 4);
  g.generateTexture(SHARD_TEXTURE, 8, 6);
  g.destroy();
}

/** Platzhalter, solange das Pipeline-Sprite der Variante nicht geladen ist. */
function ensurePlaceholderTexture(scene: Phaser.Scene, variant: string): string {
  const key = `reactive_prop_placeholder_${variant}`;
  if (scene.textures.exists(key)) return key;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const toxic = variant === 'toxic';
  g.fillStyle(toxic ? 0x4a5530 : 0x9e3322, 1).fillCircle(32, 32, 27);
  g.lineStyle(4, toxic ? 0x6b6f58 : 0x8a5a3a, 1).strokeCircle(32, 32, 26);
  if (toxic) {
    g.fillStyle(0x58c22a, 1).fillCircle(32, 32, 15);
    g.fillStyle(0xb6ff6a, 1).fillCircle(33, 31, 7);
  } else {
    g.fillStyle(0xe8dcbe, 1).fillTriangle(32, 13, 51, 32, 13, 32).fillTriangle(13, 32, 51, 32, 32, 51);
    g.fillStyle(0x241a18, 1).fillTriangle(32, 21, 40, 38, 24, 38);
  }
  g.generateTexture(key, 64, 64);
  g.destroy();
  return key;
}
