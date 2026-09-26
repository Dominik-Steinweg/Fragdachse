import * as Phaser from 'phaser';
import { LEAF_BLOWER_FX } from '../config/leafBlowerEffects';
import type { ArenaLayout } from '../types';
import { mixColors } from './EffectUtils';
import { createLeafBlowerMaterialSampler, type LeafBlowerMaterial, type LeafBlowerMaterialSampler } from './LeafBlowerMaterial';
import { ensureLeafBlowerDustTexture, ensureLeafBlowerSheetTexture } from './gpu/GpuVfxSourceTextures';
import { GpuVfxFrameId } from './gpu/GpuVfxAtlas';
import { GpuVfxEffectId } from './gpu/GpuVfxEffects';
import { GpuVfxEase } from './gpu/GpuVfxEase';
import { GPU_VFX_NO_SOURCE_HANDLE, GpuVfxSystem } from './gpu/GpuVfxSystem';
import { pickGpuVfxTint } from './gpu/GpuVfxMember';
import type { GpuVfxSpawnSpec } from './gpu/GpuVfxSpawnSpec';
import type { TerrainColorSnapshot } from '../arena/TerrainColorSnapshot';

/** Sichtbare Blattfarben; die Motive sind hellgrau, der Tint ist direkt die Zielfarbe. */
export const LEAF_GREEN_COLORS: readonly number[] = [
  0x62803d,
  0x708c45,
  0x587338,
  0x7d9249,
  0x69843f,
];
export const LEAF_BROWN_COLORS: readonly number[] = [
  0x8f6a3a,
  0x7a5831,
  0xa27f46,
  0x6c4c2b,
  0xab8e50,
];
const GRASS_CLIPPING_COLORS: readonly number[] = [0x86a352, 0x7a974a, 0x93ab5c];
const STRAW_COLORS: readonly number[] = [0xc2ac72, 0xb09a62, 0xa88f5c];
const TWIG_COLORS: readonly number[] = [0x735a3c, 0x654e34];
const SOIL_TINT = 0x3b2b1c;
const DUST_TINT = 0xe8dcc0;
const TERRAIN_FALLBACK: Readonly<Record<Exclude<LeafBlowerMaterial, 'water'>, number>> = {
  grass: 0x5f7040,
  dirt: 0x7a6446,
  neutral: 0x77736a,
};
/** Anteil brauner Blätter je Untergrund; auf Erde liegt vor allem trockenes Herbstlaub. */
const BROWN_LEAF_CHANCE: Readonly<Record<Exclude<LeafBlowerMaterial, 'water'>, number>> = {
  grass: 0.26,
  dirt: 0.86,
  neutral: 0.5,
};
/** Befestigte Flächen tragen weniger loses Laub als Rasen oder Erde. */
const NEUTRAL_LEAF_KEEP = 0.35;
const LEAF_FRAMES: readonly GpuVfxFrameId[] = [
  GpuVfxFrameId.LeafBlowerLeafOval,
  GpuVfxFrameId.LeafBlowerLeafOval,
  GpuVfxFrameId.LeafBlowerLeafNarrow,
  GpuVfxFrameId.LeafBlowerLeafRound,
  GpuVfxFrameId.LeafBlowerLeafCurl,
];
/** Ein Positionssprung darüber ist ein Snapshot- oder Replikatsprung, keine Flugstrecke. */
const MAX_SEGMENT_PX = 160;

interface LeafBlowerVisual {
  x: number;
  y: number;
  size: number;
  vx: number;
  vy: number;
  /** Position des letzten Emissionsticks; der Weg dazwischen wird gleichmäßig belegt. */
  lastX: number;
  lastY: number;
  source: number;
  readonly carry: Float32Array;
}

/** Indizes in `LeafBlowerVisual.carry`: Bruchteil noch nicht emittierter Partikel je Schicht. */
const Layer = {
  Leaf: 0, Clipping: 1, Grit: 2, Dust: 3, Streak: 4, Spray: 5, Mist: 6, Ripple: 7, Ring: 8,
} as const;
const LAYER_COUNT = 9;

interface SegmentFrame {
  fromX: number;
  fromY: number;
  dx: number;
  dy: number;
  dirX: number;
  dirY: number;
  heading: number;
  speed: number;
  spread: number;
  size: number;
}

const SEGMENT: SegmentFrame = {
  fromX: 0, fromY: 0, dx: 0, dy: 0, dirX: 1, dirY: 0, heading: 0, speed: 0, spread: 0, size: 0,
};
const SPAWN = { x: 0, y: 0, side: 0, offset: 0 };

function ensureLeafBlowerTextures(scene: Phaser.Scene): void {
  ensureLeafBlowerSheetTexture(scene);
  ensureLeafBlowerDustTexture(scene);
}

/**
 * Laubbläser als zusammenhängender Strom aus aufgewirbeltem Laub und Dreck.
 *
 * Jedes Projektil belegt die seit dem letzten Tick geflogene Strecke gleichmäßig mit Partikeln,
 * die vom Boden aufgenommen und mit einem Teil der Strömungsgeschwindigkeit mitgerissen werden.
 * Die Spuren aufeinanderfolgender Projektile überlappen deshalb zu einem Strom, in dem kein
 * einzelnes Projektil als Büschel erkennbar ist. Bewegung, Drehung, Flattern und Ausblenden
 * rechnet die GPU; die CPU schreibt nur Spawns.
 *
 * Der Untergrund wird pro Spawnpunkt abgetastet: Rasen liefert grünes Laub und Halme, Erde
 * braunes Laub und viele Krümel, Wege mehr Staub. Wasser erzeugt kein neues Laub, sondern
 * Gischt und Kräuselung; bereits aufgewirbeltes Laub darf über das Wasser weiterfliegen.
 */
export class LeafBlowerRenderer {
  private readonly scene: Phaser.Scene;
  private readonly visuals = new Map<number, LeafBlowerVisual>();
  private gpuVfx: GpuVfxSystem | null = null;
  private leafSpec: GpuVfxSpawnSpec | null = null;
  private gritSpec: GpuVfxSpawnSpec | null = null;
  private dustSpec: GpuVfxSpawnSpec | null = null;
  private streakSpec: GpuVfxSpawnSpec | null = null;
  private spraySpec: GpuVfxSpawnSpec | null = null;
  private rippleSpec: GpuVfxSpawnSpec | null = null;
  private terrainSnapshot: TerrainColorSnapshot | null = null;
  private materialSampler: LeafBlowerMaterialSampler | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  generateTextures(): void {
    ensureLeafBlowerTextures(this.scene);
  }

  registerGpuVfx(system: GpuVfxSystem): void {
    if (this.gpuVfx) return;
    this.gpuVfx = system;
    this.leafSpec = system.createSpec(GpuVfxEffectId.LeafDebris);
    this.gritSpec = system.createSpec(GpuVfxEffectId.LeafBlowerGrit);
    this.dustSpec = system.createSpec(GpuVfxEffectId.LeafBlowerDust);
    this.streakSpec = system.createSpec(GpuVfxEffectId.LeafBlowerStreak);
    this.spraySpec = system.createSpec(GpuVfxEffectId.LeafBlowerSpray);
    this.rippleSpec = system.createSpec(GpuVfxEffectId.LeafBlowerRipple);
    system.registerEmission((_deltaMs, nowMs) => this.emitParticles(nowMs));
  }

  setTerrainColorSnapshot(snapshot: TerrainColorSnapshot | null): void {
    this.terrainSnapshot = snapshot;
  }

  setTerrainMaterialLayout(
    layout: Pick<ArenaLayout, 'dirt' | 'tracks' | 'water'> | null,
    baseCells: readonly { gridX: number; gridY: number }[] = [],
  ): void {
    this.materialSampler = layout
      ? createLeafBlowerMaterialSampler(layout, baseCells)
      : null;
  }

  createVisual(id: number, x: number, y: number, size: number): void {
    if (this.visuals.has(id)) return;
    this.visuals.set(id, {
      x,
      y,
      size,
      vx: 0,
      vy: 0,
      lastX: x,
      lastY: y,
      // Eine Quelle je Projektil; der Linger-Modus lässt alle Schichten normal ausleben.
      source: this.gpuVfx?.createSource(GpuVfxEffectId.LeafDebris) ?? GPU_VFX_NO_SOURCE_HANDLE,
      carry: new Float32Array(LAYER_COUNT),
    });
  }

  updateVisual(id: number, x: number, y: number, size: number, vx: number, vy: number): void {
    const visual = this.visuals.get(id);
    if (!visual) return;
    visual.x = x;
    visual.y = y;
    visual.size = size;
    visual.vx = vx;
    visual.vy = vy;
  }

  destroyVisual(id: number, immediate = false): void {
    const visual = this.visuals.get(id);
    if (!visual) return;
    this.visuals.delete(id);
    // Der Reststrom bis zur letzten bekannten Position gehört noch zum Strahl.
    if (!immediate) this.emitVisual(visual, this.scene.time?.now ?? 0);

    if (this.gpuVfx && visual.source !== GPU_VFX_NO_SOURCE_HANDLE) {
      if (immediate) this.gpuVfx.clearSource(visual.source);
      this.gpuVfx.releaseSource(visual.source);
    }
  }

  has(id: number): boolean {
    return this.visuals.has(id);
  }

  getActiveIds(): number[] {
    return [...this.visuals.keys()];
  }

  destroyAll(): void {
    for (const [id] of this.visuals) this.destroyVisual(id, true);
  }

  private emitParticles(nowMs: number): void {
    for (const visual of this.visuals.values()) this.emitVisual(visual, nowMs);
  }

  private emitVisual(visual: LeafBlowerVisual, nowMs: number): void {
    const system = this.gpuVfx;
    if (!system) return;
    const dx = visual.x - visual.lastX;
    const dy = visual.y - visual.lastY;
    const distance = Math.hypot(dx, dy);
    if (distance < 0.01) return;
    visual.lastX = visual.x;
    visual.lastY = visual.y;
    if (distance > MAX_SEGMENT_PX) return;

    const speed = Math.hypot(visual.vx, visual.vy);
    const frame = SEGMENT;
    frame.fromX = visual.x - dx;
    frame.fromY = visual.y - dy;
    frame.dx = dx;
    frame.dy = dy;
    frame.dirX = speed > 1 ? visual.vx / speed : dx / distance;
    frame.dirY = speed > 1 ? visual.vy / speed : dy / distance;
    frame.heading = Math.atan2(frame.dirY, frame.dirX);
    frame.speed = Math.max(speed, distance * 30);
    frame.size = visual.size;
    frame.spread = Math.max(LEAF_BLOWER_FX.spreadMin, visual.size * LEAF_BLOWER_FX.spreadFactor);

    const fx = LEAF_BLOWER_FX;
    const leaves = this.dueCount(visual, Layer.Leaf, distance, fx.leaf.spacingPx, GpuVfxEffectId.LeafDebris);
    for (let n = 0; n < leaves; n += 1) this.spawnLeaf(visual, nowMs);
    const clippings = this.dueCount(visual, Layer.Clipping, distance, fx.clipping.spacingPx, GpuVfxEffectId.LeafDebris);
    for (let n = 0; n < clippings; n += 1) this.spawnClipping(visual, nowMs);
    // Die dichteste Krümelrate; auf Rasen wird ein Teil der Spawns am Material verworfen.
    const grit = this.dueCount(visual, Layer.Grit, distance, fx.grit.dirtSpacingPx, GpuVfxEffectId.LeafBlowerGrit);
    for (let n = 0; n < grit; n += 1) this.spawnGrit(visual, nowMs);
    const dust = this.dueCount(visual, Layer.Dust, distance, fx.dust.spacingPx, GpuVfxEffectId.LeafBlowerDust);
    for (let n = 0; n < dust; n += 1) this.spawnDust(visual, nowMs);
    const streaks = this.dueCount(visual, Layer.Streak, distance, fx.streak.spacingPx, GpuVfxEffectId.LeafBlowerStreak);
    for (let n = 0; n < streaks; n += 1) this.spawnStreak(visual, nowMs);
    const spray = this.dueCount(visual, Layer.Spray, distance, fx.spray.spacingPx, GpuVfxEffectId.LeafBlowerSpray);
    for (let n = 0; n < spray; n += 1) this.spawnSpray(visual, nowMs);
    const mist = this.dueCount(visual, Layer.Mist, distance, fx.mist.spacingPx, GpuVfxEffectId.LeafBlowerSpray);
    for (let n = 0; n < mist; n += 1) this.spawnMist(visual, nowMs);
    const ripples = this.dueCount(visual, Layer.Ripple, distance, fx.ripple.streakSpacingPx, GpuVfxEffectId.LeafBlowerRipple);
    for (let n = 0; n < ripples; n += 1) this.spawnRipple(visual, nowMs, false);
    const rings = this.dueCount(visual, Layer.Ring, distance, fx.ripple.ringSpacingPx, GpuVfxEffectId.LeafBlowerRipple);
    for (let n = 0; n < rings; n += 1) this.spawnRipple(visual, nowMs, true);
  }

  /** Streckenbasierte Emission mit Qualitätsfaktor; der Bruchteil wandert in den nächsten Tick. */
  private dueCount(visual: LeafBlowerVisual, layer: number, distance: number, spacingPx: number, effect: GpuVfxEffectId): number {
    const system = this.gpuVfx!;
    const factor = system.quality.getEmissionFactor(effect);
    if (factor <= 0) {
      system.recordQualityDrop(effect);
      return 0;
    }
    const total = visual.carry[layer] + (distance / spacingPx) * factor;
    const count = Math.floor(total);
    visual.carry[layer] = total - count;
    return count;
  }

  /**
   * Zufälliger Punkt auf dem geflogenen Wegstück, quer dazu dreieckverteilt über die aktuelle
   * Stromhalbbreite: dicht in der Mitte, ausgefranst am Rand.
   */
  private pickSpawnPoint(widthScale = 1): typeof SPAWN {
    const frame = SEGMENT;
    const t = Math.random();
    const offset = (Math.random() + Math.random() - 1) * frame.spread * widthScale;
    SPAWN.offset = offset;
    SPAWN.side = offset < 0 ? -1 : 1;
    SPAWN.x = frame.fromX + frame.dx * t - frame.dirY * offset;
    SPAWN.y = frame.fromY + frame.dy * t + frame.dirX * offset;
    return SPAWN;
  }

  private materialAt(x: number, y: number): LeafBlowerMaterial {
    return this.materialSampler?.sample(x, y) ?? 'grass';
  }

  private terrainAt(x: number, y: number, material: Exclude<LeafBlowerMaterial, 'water'>): number {
    return this.terrainSnapshot?.sample(x, y) ?? TERRAIN_FALLBACK[material];
  }

  /**
   * Mitgerissene Bewegung: Vorwärtsanteil der Strömung plus seitliches Ausweichen nach außen,
   * damit der Strom wie ein Fächer aufgeht. `QuadOut` bremst das Partikel bis zum Liegenbleiben;
   * seine Anfangsgeschwindigkeit ist das Doppelte der übergebenen mittleren Geschwindigkeit.
   */
  private applyCarry(spec: GpuVfxSpawnSpec, carryMin: number, carryMax: number, lateral: number): void {
    const frame = SEGMENT;
    const forward = frame.speed * Phaser.Math.FloatBetween(carryMin, carryMax) * 0.5;
    const outward = frame.speed * lateral * 0.5
      * (Math.abs(SPAWN.offset) / frame.spread + 0.15) * Math.random() * SPAWN.side;
    const swirl = frame.speed * 0.06 * (Math.random() * 2 - 1);
    spec.vx = frame.dirX * forward - frame.dirY * (outward + swirl);
    spec.vy = frame.dirY * forward + frame.dirX * (outward + swirl);
    spec.positionEase = GpuVfxEase.QuadOut;
    spec.yMode = GpuVfxEase.Linear;
  }

  private spawnLeaf(visual: LeafBlowerVisual, nowMs: number): void {
    const spec = this.leafSpec!;
    const point = this.pickSpawnPoint();
    const material = this.materialAt(point.x, point.y);
    if (material === 'water') return;
    if (material === 'neutral' && Math.random() > NEUTRAL_LEAF_KEEP) return;
    const fx = LEAF_BLOWER_FX.leaf;
    spec.frame = LEAF_FRAMES[Math.floor(Math.random() * LEAF_FRAMES.length)];
    spec.lifeMs = Phaser.Math.FloatBetween(fx.lifeMinMs, fx.lifeMaxMs);
    spec.x = point.x;
    spec.y = point.y;
    this.applyCarry(spec, fx.carryMin, fx.carryMax, fx.lateral);
    spec.rotation = Math.random() * Math.PI * 2;
    spec.angularVelocity = (Math.random() < 0.5 ? -1 : 1) * Phaser.Math.FloatBetween(2.5, fx.spinMax);
    spec.rotationEase = GpuVfxEase.Linear;
    // Laub bleibt klein, egal wie weit der Luftstrom schon aufgefächert ist.
    const scale = Phaser.Math.FloatBetween(fx.scaleMin, fx.scaleMax);
    spec.scaleStart = scale;
    spec.scaleEnd = scale * 0.9;
    spec.scaleEase = GpuVfxEase.Linear;
    // Flattern: das Blatt kippt beim Taumeln auf die Kante.
    spec.stretchStart = 1;
    spec.stretchEnd = Phaser.Math.FloatBetween(0.45, 1);
    spec.alphaStart = fx.alpha;
    spec.alphaEnd = 0;
    spec.alphaEase = GpuVfxEase.CubicIn;
    spec.tint = pickGpuVfxTint(Math.random() < BROWN_LEAF_CHANCE[material] ? LEAF_BROWN_COLORS : LEAF_GREEN_COLORS);
    this.gpuVfx!.spawn(spec, visual.source, nowMs);
  }

  private spawnClipping(visual: LeafBlowerVisual, nowMs: number): void {
    const spec = this.leafSpec!;
    const point = this.pickSpawnPoint();
    const material = this.materialAt(point.x, point.y);
    if (material === 'water' || material === 'neutral') return;
    const fx = LEAF_BLOWER_FX.clipping;
    const twig = material === 'dirt' && Math.random() < 0.35;
    spec.frame = twig ? GpuVfxFrameId.LeafBlowerTwig : GpuVfxFrameId.LeafBlowerGrassBlade;
    spec.lifeMs = Phaser.Math.FloatBetween(fx.lifeMinMs, fx.lifeMaxMs);
    spec.x = point.x;
    spec.y = point.y;
    this.applyCarry(spec, twig ? 0.15 : 0.3, twig ? 0.5 : 0.9, 0.3);
    spec.rotation = SEGMENT.heading + Phaser.Math.FloatBetween(-0.9, 0.9);
    spec.angularVelocity = (Math.random() < 0.5 ? -1 : 1) * Phaser.Math.FloatBetween(4, 16);
    spec.rotationEase = GpuVfxEase.Linear;
    const scale = Phaser.Math.FloatBetween(fx.scaleMin, fx.scaleMax);
    spec.scaleStart = scale;
    spec.scaleEnd = scale;
    spec.scaleEase = GpuVfxEase.Linear;
    spec.stretchStart = 1;
    spec.stretchEnd = Phaser.Math.FloatBetween(0.6, 1);
    spec.alphaStart = 0.95;
    spec.alphaEnd = 0;
    spec.alphaEase = GpuVfxEase.CubicIn;
    spec.tint = pickGpuVfxTint(twig ? TWIG_COLORS : material === 'dirt' ? STRAW_COLORS : GRASS_CLIPPING_COLORS);
    this.gpuVfx!.spawn(spec, visual.source, nowMs);
  }

  private spawnGrit(visual: LeafBlowerVisual, nowMs: number): void {
    const spec = this.gritSpec!;
    const point = this.pickSpawnPoint(0.85);
    const material = this.materialAt(point.x, point.y);
    if (material === 'water') return;
    const fx = LEAF_BLOWER_FX.grit;
    const spacing = material === 'dirt' ? fx.dirtSpacingPx : material === 'grass' ? fx.grassSpacingPx : fx.neutralSpacingPx;
    if (Math.random() > fx.dirtSpacingPx / spacing) return;
    const clod = Math.random() < 0.3;
    spec.frame = clod ? GpuVfxFrameId.LeafBlowerClod : GpuVfxFrameId.LeafBlowerGrain;
    spec.lifeMs = Phaser.Math.FloatBetween(fx.lifeMinMs, fx.lifeMaxMs);
    spec.x = point.x;
    spec.y = point.y;
    this.applyCarry(spec, fx.carryMin, fx.carryMax, 0.22);
    spec.rotation = Math.random() * Math.PI * 2;
    spec.angularVelocity = 0;
    const scale = Phaser.Math.FloatBetween(fx.scaleMin, fx.scaleMax) * (clod ? 0.75 : 1);
    spec.scaleStart = scale;
    spec.scaleEnd = scale;
    spec.scaleEase = GpuVfxEase.Linear;
    spec.stretchStart = 1;
    spec.stretchEnd = 1;
    spec.alphaStart = fx.alpha;
    spec.alphaEnd = 0;
    spec.alphaEase = GpuVfxEase.CubicIn;
    spec.tint = mixColors(this.terrainAt(point.x, point.y, material), SOIL_TINT, fx.darken);
    this.gpuVfx!.spawn(spec, visual.source, nowMs);
  }

  private spawnDust(visual: LeafBlowerVisual, nowMs: number): void {
    const spec = this.dustSpec!;
    const point = this.pickSpawnPoint(0.7);
    const material = this.materialAt(point.x, point.y);
    if (material === 'water') return;
    const fx = LEAF_BLOWER_FX.dust;
    spec.frame = GpuVfxFrameId.LeafBlowerDust;
    spec.lifeMs = Phaser.Math.FloatBetween(fx.lifeMinMs, fx.lifeMaxMs);
    spec.x = point.x;
    spec.y = point.y;
    this.applyCarry(spec, fx.carryMin, fx.carryMax, 0.35);
    spec.rotation = SEGMENT.heading + Phaser.Math.FloatBetween(-0.2, 0.2);
    spec.angularVelocity = 0;
    // Der Schleier zeigt den wachsenden Wirkungsbereich; nur er skaliert mit der Trefferfläche.
    const diameter = Math.max(14, SEGMENT.spread * 2);
    spec.scaleStart = (diameter * fx.sizeStart) / 18;
    spec.scaleEnd = (diameter * fx.sizeEnd) / 18;
    spec.scaleEase = GpuVfxEase.QuadOut;
    spec.stretchStart = fx.stretchStart;
    spec.stretchEnd = fx.stretchEnd;
    spec.alphaStart = Phaser.Math.FloatBetween(fx.alphaMin, fx.alphaMax) * (material === 'neutral' ? fx.neutralAlphaBoost : 1);
    spec.alphaEnd = 0;
    spec.alphaEase = GpuVfxEase.Linear;
    spec.tint = mixColors(this.terrainAt(point.x, point.y, material), DUST_TINT, fx.lighten);
    this.gpuVfx!.spawn(spec, visual.source, nowMs);
  }

  private spawnStreak(visual: LeafBlowerVisual, nowMs: number): void {
    const spec = this.streakSpec!;
    const point = this.pickSpawnPoint(0.9);
    const material = this.materialAt(point.x, point.y);
    if (material === 'water') return;
    const fx = LEAF_BLOWER_FX.streak;
    spec.frame = GpuVfxFrameId.LeafBlowerWindStreak;
    spec.lifeMs = Phaser.Math.FloatBetween(fx.lifeMinMs, fx.lifeMaxMs);
    spec.x = point.x;
    spec.y = point.y;
    const drift = SEGMENT.speed * fx.carry * 0.5;
    spec.vx = SEGMENT.dirX * drift;
    spec.vy = SEGMENT.dirY * drift;
    spec.positionEase = GpuVfxEase.QuadOut;
    spec.yMode = GpuVfxEase.Linear;
    // Der Bewuchs legt sich radial vom Strommittelpunkt weg.
    spec.rotation = SEGMENT.heading + (SPAWN.offset / SEGMENT.spread) * 0.35 + Phaser.Math.FloatBetween(-0.12, 0.12);
    spec.angularVelocity = 0;
    const scale = fx.width * Phaser.Math.FloatBetween(0.7, 1.1);
    spec.scaleStart = scale;
    spec.scaleEnd = scale;
    spec.scaleEase = GpuVfxEase.Linear;
    spec.stretchStart = fx.lengthScale * Phaser.Math.FloatBetween(0.7, 1.2);
    spec.stretchEnd = spec.stretchStart * 1.3;
    spec.alphaStart = Phaser.Math.FloatBetween(fx.alphaMin, fx.alphaMax);
    spec.alphaEnd = 0;
    spec.alphaEase = GpuVfxEase.Linear;
    spec.tint = mixColors(this.terrainAt(point.x, point.y, material), 0xffffff, fx.lighten);
    this.gpuVfx!.spawn(spec, visual.source, nowMs);
  }

  private spawnSpray(visual: LeafBlowerVisual, nowMs: number): void {
    const spec = this.spraySpec!;
    const point = this.pickSpawnPoint();
    if (this.materialAt(point.x, point.y) !== 'water') return;
    const fx = LEAF_BLOWER_FX.spray;
    spec.frame = GpuVfxFrameId.LeafBlowerDroplet;
    spec.lifeMs = Phaser.Math.FloatBetween(fx.lifeMinMs, fx.lifeMaxMs);
    spec.x = point.x;
    spec.y = point.y;
    this.applyCarry(spec, fx.carryMin, fx.carryMax, 0.4);
    spec.rotation = SEGMENT.heading;
    spec.angularVelocity = 0;
    const scale = Phaser.Math.FloatBetween(fx.scaleMin, fx.scaleMax);
    spec.scaleStart = scale;
    spec.scaleEnd = scale * 0.6;
    spec.scaleEase = GpuVfxEase.Linear;
    // Bewegungsunschärfe: frische Tropfen sind in Flugrichtung gezogen.
    spec.stretchStart = 1.8;
    spec.stretchEnd = 1;
    spec.alphaStart = Phaser.Math.FloatBetween(fx.alphaMin, fx.alphaMax);
    spec.alphaEnd = 0;
    spec.alphaEase = GpuVfxEase.Linear;
    spec.tint = fx.tint;
    this.gpuVfx!.spawn(spec, visual.source, nowMs);
  }

  private spawnMist(visual: LeafBlowerVisual, nowMs: number): void {
    const spec = this.spraySpec!;
    const point = this.pickSpawnPoint(0.7);
    if (this.materialAt(point.x, point.y) !== 'water') return;
    const fx = LEAF_BLOWER_FX.mist;
    spec.frame = GpuVfxFrameId.LeafBlowerDust;
    spec.lifeMs = Phaser.Math.FloatBetween(fx.lifeMinMs, fx.lifeMaxMs);
    spec.x = point.x;
    spec.y = point.y;
    this.applyCarry(spec, fx.carryMin, fx.carryMax, 0.3);
    spec.rotation = SEGMENT.heading;
    spec.angularVelocity = 0;
    const diameter = Math.max(14, SEGMENT.spread * 2);
    spec.scaleStart = (diameter * 0.3) / 18;
    spec.scaleEnd = (diameter * 0.62) / 18;
    spec.scaleEase = GpuVfxEase.QuadOut;
    spec.stretchStart = 1.7;
    spec.stretchEnd = 1.2;
    spec.alphaStart = Phaser.Math.FloatBetween(fx.alphaMin, fx.alphaMax);
    spec.alphaEnd = 0;
    spec.alphaEase = GpuVfxEase.Linear;
    spec.tint = fx.tint;
    this.gpuVfx!.spawn(spec, visual.source, nowMs);
  }

  private spawnRipple(visual: LeafBlowerVisual, nowMs: number, ring: boolean): void {
    const spec = this.rippleSpec!;
    const point = this.pickSpawnPoint(ring ? 0.8 : 1);
    if (this.materialAt(point.x, point.y) !== 'water') return;
    const fx = LEAF_BLOWER_FX.ripple;
    spec.lifeMs = Phaser.Math.FloatBetween(fx.lifeMinMs, fx.lifeMaxMs);
    spec.x = point.x;
    spec.y = point.y;
    const drift = SEGMENT.speed * (ring ? 0.04 : 0.1) * 0.5;
    spec.vx = SEGMENT.dirX * drift;
    spec.vy = SEGMENT.dirY * drift;
    spec.positionEase = GpuVfxEase.QuadOut;
    spec.yMode = GpuVfxEase.Linear;
    spec.angularVelocity = 0;
    spec.tint = fx.tint;
    spec.alphaEnd = 0;
    spec.alphaEase = GpuVfxEase.Linear;
    if (ring) {
      spec.frame = GpuVfxFrameId.ExplosionRing;
      spec.scaleStart = fx.ringScaleStart;
      spec.scaleEnd = fx.ringScaleEnd;
      spec.scaleEase = GpuVfxEase.QuadOut;
      // Vom Wind in Strömungsrichtung gedehnte Ringe.
      spec.stretchStart = 1.15;
      spec.stretchEnd = 1.35;
      spec.rotation = SEGMENT.heading;
      spec.alphaStart = fx.ringAlpha;
    } else {
      spec.frame = GpuVfxFrameId.LeafBlowerWindStreak;
      spec.rotation = SEGMENT.heading + Phaser.Math.FloatBetween(-0.22, 0.22);
      const scale = Phaser.Math.FloatBetween(0.6, 1);
      spec.scaleStart = scale;
      spec.scaleEnd = scale * 0.8;
      spec.scaleEase = GpuVfxEase.Linear;
      spec.stretchStart = Phaser.Math.FloatBetween(0.6, 1.1);
      spec.stretchEnd = spec.stretchStart * 1.6;
      spec.alphaStart = Phaser.Math.FloatBetween(fx.streakAlphaMin, fx.streakAlphaMax);
    }
    this.gpuVfx!.spawn(spec, visual.source, nowMs);
  }
}
