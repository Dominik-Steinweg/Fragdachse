import * as Phaser from 'phaser';
import { DEPTH, DEPTH_LIGHTING } from '../../config';
import { isExplosiveReactivePropKind, resolveReactivePropVariant } from '../../config/reactiveProps/reactivePropKinds';
import type { ReactivePropPresentationState, ReactivePropRuntime } from '../../world/reactiveProps/ReactivePropRuntime';
import { fillRadialGradientTexture } from '../EffectUtils';
import { emissiveAlpha } from '../EmissiveScale';
import type { EntityBurnGpuController } from '../EntityBurnGpuController';
import { EntityBurnRenderer } from '../EntityBurnRenderer';
import type { LightingSystem } from '../LightingSystem';
import type { EnemyZoneAttack } from '../EnemyClawRenderer';
import { REACTIVE_PROP_VISUAL, isObservedReactivePropRelease, resolveReactivePropFrame, resolveReactivePropPose,
  resolveReactivePropVisual, resolveReactivePropWarning, type ReactivePropPose } from './ReactivePropVisualModel';
import { getPipelineAssetForTexture } from '../../config/pipelineAssets';
import type { ReactivePropPhase } from '../../world/reactiveProps/ReactivePropRuntime';
import { getReactivePropVariantOverride } from './ReactivePropVariantOverride';

const GLOW_TEXTURE = 'reactive_prop_glow';
const SHARD_TEXTURE = 'reactive_prop_shard';
const SHARD_COUNT = 7;
const SHARD_LIFETIME_MS = 650;
/** Brand sitzt auf dem Deckel, nicht auf dem Boden daneben. */
const BURN_BODY_PX = 18;
/** Flammen züngeln aus dem Deckel nach oben, statt das Schild zu überdecken. */
const BURN_OFFSET_Y = -5;

/** Gefahrenzone im gemeinsamen Gegner-Angriffsmuster (rote, sich füllende Fläche bis zum Treffer). */
export type ReactivePropZoneSink = (id: string, attack: EnemyZoneAttack | null, now: number, visible: boolean) => void;

interface PropVisual {
  sprite: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image | null;
  burn: EntityBurnRenderer | null;
  pose: ReactivePropPose;
  zone: EnemyZoneAttack | null;
  zoneRevision: number;
  /** Seit wann der replizierte Zustand (Phase + Anteil) unverändert gilt, synchronisierte Uhr. */
  observedKey: string;
  observedSince: number;
  textureKey: string;
  /** Sheet frame of rechargeable props; -1 for a single image. */
  frame: number;
  lastPhase: ReactivePropPhase | null;
  /** Local time of an observed release (burst/swarm), drives the one-shot clip. */
  releasedAt: number | null;
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
    private readonly zoneSink: ReactivePropZoneSink | null = null,
    private readonly audio: Pick<import('../../audio/GameAudioSystem').GameAudioSystem, 'playSound'> | null = null,
  ) {
    fillRadialGradientTexture(scene.textures, GLOW_TEXTURE, 64, [
      [0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,255,255,0.6)'], [0.65, 'rgba(255,255,255,0.16)'], [1, 'rgba(255,255,255,0)'],
    ]);
    ensureShardTexture(scene);
  }

  /** `nowMs` ist die lokale Darstellungsuhr, `syncNow` die synchronisierte Uhr der Angriffs-Telegraphen. */
  sync(runtime: ReactivePropRuntime, cells: readonly import('../../types').ReactivePropCell[], nowMs: number, syncNow: number): void {
    if (this.destroyed) return;
    const artificial = this.lighting?.getArtificialLightFactor() ?? 0;
    runtime.forEachPresentationState(state => {
      const position = runtime.getPosition(state.obstacleId);
      if (position) this.syncProp(state, cells, position.x, position.y, nowMs, syncNow, artificial);
    });
    this.advanceShards(nowMs);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const key of this.lightKeys) this.lighting?.releaseLight(key, { immediate: true });
    this.lightKeys.clear();
    for (const [index, visual] of this.props) { this.disposeVisual(visual); this.releaseZone(index, visual); }
    this.props.clear();
    for (const shard of this.shards) shard.image.destroy();
    this.shards.length = 0;
  }

  private syncProp(state: ReactivePropPresentationState, cells: readonly import('../../types').ReactivePropCell[],
    cellX: number, cellY: number, nowMs: number, syncNow: number, artificial: number): void {
    const visualState = resolveReactivePropVisual(state.phase, state.progress, state.kind.visual.presentation);
    let visual = this.props.get(state.index);
    const lightKey = `reactive-prop:${state.index}`;
    if (!visualState.visible) {
      if (visual) {
        if (visual.seenAlive) this.playDestruction(visual, cellX + visual.pose.offsetX, cellY + visual.pose.offsetY, nowMs);
        this.disposeVisual(visual);
        this.releaseZone(state.index, visual);
        this.props.delete(state.index);
      }
      this.releaseLight(lightKey);
      return;
    }
    const variantId = resolveReactivePropVariant(state.kind, getReactivePropVariantOverride() ?? state.cell.variant);
    const variant = state.kind.visual.variants[variantId];
    const presentation = state.kind.visual.presentation;
    // Rechargeable props play their Blender clips from the sheet; the barrel is a single image.
    const sheet = presentation === 'barrel' ? undefined : getPipelineAssetForTexture(variant.textureKey);
    const sheetReady = !!sheet && this.scene.textures.exists(sheet.sheetTextureKey);
    const textureKey = sheetReady ? sheet!.sheetTextureKey
      : this.scene.textures.exists(variant.textureKey) ? variant.textureKey
        : ensurePlaceholderTexture(this.scene, presentation, variantId);
    if (!visual) {
      const pose = resolveReactivePropPose(state.index, cells);
      visual = {
        sprite: this.scene.add.image(cellX, cellY, textureKey).setOrigin(0.5).setDepth(DEPTH.ROCKS + 0.2).setRotation(pose.rotation),
        glow: null, burn: null, pose, zone: null, zoneRevision: 0, observedKey: '', observedSince: syncNow, textureKey,
        frame: -1, lastPhase: null, releasedAt: null, lastProgress: state.progress, flashUntil: 0, seenAlive: false,
      };
      this.props.set(state.index, visual);
    }
    const x = cellX + visual.pose.offsetX, y = cellY + visual.pose.offsetY;
    visual.seenAlive = true;
    if (isObservedReactivePropRelease(visual.lastPhase, state.phase, state.progress)) {
      visual.releasedAt = nowMs;
      // The bee release has its own cue in the swarm renderer; the puffball bursts here.
      if (presentation === 'puffball') this.audio?.playSound('sfx_spore_puffball_burst', x, y);
    }
    const frame = sheetReady
      ? resolveReactivePropFrame(presentation, state.phase, state.progress, sheet!.clips, sheet!.idleFrame, nowMs, visual.releasedAt)
      : -1;
    if (visual.textureKey !== textureKey || visual.frame !== frame) {
      if (frame >= 0) visual.sprite.setTexture(textureKey, frame); else visual.sprite.setTexture(textureKey);
      visual.textureKey = textureKey;
      visual.frame = frame;
    }
    const size = state.kind.visual.displaySizePx;
    visual.sprite.setPosition(x, y).setDisplaySize(size, size);

    // Echte Treffer heben das Blech kurz an; Brand-Ticks nicht. Lade-Objekte blitzen beim Auslösen.
    if ((state.phase === 'idle' || state.phase === 'primed') && state.progress < visual.lastProgress - REACTIVE_PROP_VISUAL.hitFlashMinDrop) {
      visual.flashUntil = nowMs + REACTIVE_PROP_VISUAL.hitFlashMs;
    }
    if (presentation !== 'barrel' && visual.lastPhase === 'idle' && state.phase === 'triggered') {
      visual.flashUntil = nowMs + REACTIVE_PROP_VISUAL.hitFlashMs;
    }
    visual.lastPhase = state.phase;
    visual.lastProgress = state.progress;
    if (nowMs < visual.flashUntil) visual.sprite.setTint(REACTIVE_PROP_VISUAL.hitFlashTint).setTintMode(Phaser.TintModes.ADD);
    else visual.sprite.clearTint();
    this.syncZone(state, visual, cellX, cellY, syncNow);

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

  /**
   * Die bekannte rote Gefahrenzone der Gegner-Angriffe über dem Explosionsradius: Sie füllt sich bis
   * zum geschätzten Knall. Verschiebt ein neuer Treffer den Knall, wird sie neu angesetzt.
   */
  private syncZone(state: ReactivePropPresentationState, visual: PropVisual, x: number, y: number, syncNow: number): void {
    const kind = state.kind;
    if (!this.zoneSink || !isExplosiveReactivePropKind(kind)) return;
    const observedKey = `${state.phase}:${state.progress}`;
    if (visual.observedKey !== observedKey) { visual.observedKey = observedKey; visual.observedSince = syncNow; }
    const warning = resolveReactivePropWarning(kind, state.phase, state.progress, visual.observedSince);
    if (!warning) {
      if (visual.zone && syncNow >= visual.zone.endsAt) this.releaseZone(state.index, visual);
      else if (visual.zone) this.zoneSink(`reactive-prop:${state.index}`, visual.zone, syncNow, true);
      return;
    }
    const c = REACTIVE_PROP_VISUAL;
    if (!visual.zone || Math.abs(visual.zone.hitAt - warning.hitAt) > c.retimeToleranceMs) {
      visual.zone = {
        attackId: `reactive-prop:${state.index}:${++visual.zoneRevision}`, x, y, radius: kind.effect.explosion.radius,
        startedAt: warning.hitAt - warning.durationMs, strikeAt: warning.hitAt - c.strikeLeadMs,
        hitAt: warning.hitAt, endsAt: warning.hitAt + c.lingerMs,
      };
    }
    this.zoneSink(`reactive-prop:${state.index}`, visual.zone, syncNow, true);
  }

  private releaseZone(index: number, visual: PropVisual): void {
    if (!visual.zone) return;
    visual.zone = null;
    this.zoneSink?.(`reactive-prop:${index}`, null, 0, false);
  }

  private disposeVisual(visual: PropVisual): void {
    visual.sprite.destroy();
    visual.glow?.destroy();
    visual.burn?.destroy();
  }

  private releaseLight(key: string): void {
    if (!this.lightKeys.delete(key)) return;
    this.lighting?.releaseLight(key, { immediate: true });
  }
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

/** Platzhalter, solange das Pipeline-Sprite der Variante nicht geladen ist; je Darstellung und Variante. */
function ensurePlaceholderTexture(scene: Phaser.Scene, presentation: string, variant: string): string {
  const key = `reactive_prop_placeholder_${presentation}_${variant}`;
  if (scene.textures.exists(key)) return key;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  if (presentation !== 'barrel') {
    const hive = presentation === 'hive';
    g.fillStyle(hive ? 0x6e5a44 : 0x5e4a26, 1).fillCircle(32, 32, 28);
    g.fillStyle(hive ? 0xd4a856 : variant === 'void' ? 0xcec4da : 0xece4d0, 1).fillCircle(32, 32, 22);
    if (hive) for (const r of [17, 12, 7]) g.lineStyle(2, 0x7a5a2a, 1).strokeCircle(32, 32, r);
    g.generateTexture(key, 64, 64);
    g.destroy();
    return key;
  }
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
