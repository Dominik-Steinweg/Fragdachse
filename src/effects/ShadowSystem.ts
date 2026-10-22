import * as Phaser from 'phaser';
import { isReactivePropObstacleId } from '../world/reactiveProps/ReactivePropObstacleIds';
import { getCharacterMeshes, CHARACTER_MESH_MANIFEST } from '../assets/CharacterMeshAssets';
import { quantizeSunAzimuth, type SunPathState } from './sunlight/SunPath';
import type { SunCloudState } from './sunlight/cloudShadow';
import { CharacterMeshShadowRenderer } from './CharacterMeshShadowRenderer';
import { EnemyMeshShadowRenderer } from './EnemyMeshShadowRenderer';
import { CharacterShadowReceiver, STRUCTURE_RECEIVER_TEXEL_PX, type CharacterShadowReceiverRect } from './CharacterShadowReceiver';
import { writeShadowCellHull } from './sunlight/ShadowProjection';
import {
  ARENA_OFFSET_X,
  ARENA_OFFSET_Y,
  CELL_SIZE,
  DEPTH,
} from '../config';
import type { ArenaBuilderResult } from '../arena/ArenaBuilder';
import type { PlayerEntity } from '../entities/PlayerEntity';
import type { EnemyEntity } from '../entities/EnemyEntity';
import { TRAIN } from '../train/TrainConfig';
import type { ArenaLayout, SyncedPlaceableRock, SyncedTrainState } from '../types';
import {
  CHARACTER_SHADOW_MODE, CHARACTER_MESH_TARGET_SIZE,
  getProjectileShadowConfig,
  SHADOW_CASTERS,
  WATCHTOWER_SHADOW_FOOTPRINT,
  SHADOW_PROFILES,
  type ShadowCasterConfig,
  type ShadowProfile,
  type ShadowProjectileSample,
  WORLD_SHADOW_CONFIG,
} from './ShadowConfig';
import type { ArenaVisualAttributionCollector } from '../scenes/arena/ArenaVisualAttribution';
import {
  getGraphicsQualityController,
  getGraphicsQualityProfile,
  type GraphicsQualityProfile,
} from '../graphics/GraphicsQuality';
import { resolveSkyState } from './TimeOfDay';
import { registerGraphicsObject } from './EffectUtils';
import { ShadowTrunkStamp, type TrunkShadowLayer } from './ShadowTrunkStamp';
import { ChunkScratchPool, ChunkedRenderSurface } from '../arena/chunks/ChunkedRenderSurface';
import { createColorRenderTexture } from '../graphics/createColorRenderTexture';
import type { ChunkedRenderSurfaceStats, ChunkedRenderWorkingSet } from '../arena/chunks/ChunkedRenderSurface';
import type { ChunkSamplingMode } from '../arena/chunks/ChunkedRenderSurface';
import type { ChunkBakeRegion, ChunkBakeSink, ChunkedSurfaceLayerSpec } from '../arena/chunks/ChunkedRenderSurface';
import type { ChunkWorldRect } from '../arena/chunks/ArenaChunkGrid';
import { ArenaCellBucketIndex } from '../arena/chunks/ArenaCellBucketIndex';

interface ShadowWorldBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

interface StaticShadowLayoutBuildOptions {
  readonly offsetX?: number;
  readonly offsetY?: number;
  readonly runtimeRocks?: readonly SyncedPlaceableRock[];
  readonly rockVisibilityPredicate?: (index: number) => boolean;
}

/** Welche Quelle die statischen Footprints einer Ebene liefert – bestimmt, wann neu gebacken wird. */
type StaticShadowGroup = 'rocks' | 'trees' | 'bases';

interface ShadowLayerBucket {
  /**
   * Zeichenpuffer der statischen Footprints **einer gerade gebackenen Region**.
   *
   * Er bleibt dauerhaft unsichtbar; sichtbar ist das gebackene Renderziel des Chunks. Ohne das
   * Backen rastert die GPU pro Frame alle gestapelten Alpha-Fuellungen neu – bei Fels 8 und
   * Krone 32 Lagen je Schattenwerfer ist das der groesste gemessene Einzelposten im Frame.
   */
  readonly staticGraphics: Phaser.GameObjects.Graphics;
  readonly dynamicGraphics: Phaser.GameObjects.Graphics;
  /** Static casters redrawn every frame along the continuous sun (see {@link ShadowSystem.syncContinuousStaticShadows}). */
  readonly continuousGraphics: Phaser.GameObjects.Graphics;
  group: StaticShadowGroup | null;
}

interface ShadowDirtyChunk {
  readonly x: number;
  readonly y: number;
}

const SHADOW_DIRTY_CHUNK_SIZE = 128;

/**
 * Die Caster, deren Schatten gebacken werden – und damit genau die Ebenen der Chunk-Flaeche.
 *
 * Die Menge ist fest, weil die Tiefen Konstanten sind: Fels und Turret aendern sich mit dem
 * Hindernisbestand, Basen folgen ihren sichtbaren Zellen, Stamm und Krone dem Layout. Alles andere
 * (Spieler, Projektile, Zug) ist dynamisch und wird pro Frame gezeichnet.
 */
const STATIC_SHADOW_CASTERS: ReadonlyArray<{
  readonly config: ShadowCasterConfig;
  readonly group: StaticShadowGroup;
}> = [
  { config: SHADOW_CASTERS.base, group: 'bases' },
  { config: SHADOW_CASTERS.rock, group: 'rocks' },
  { config: SHADOW_CASTERS.watchtower, group: 'rocks' },
  { config: SHADOW_CASTERS.turret, group: 'rocks' },
  { config: SHADOW_CASTERS.reactiveProp, group: 'bases' },
  { config: SHADOW_CASTERS.trunk, group: 'trees' },
  { config: SHADOW_CASTERS.canopy, group: 'trees' },
];
/** Leere Kandidatenliste ohne Layout – spart eine Allokation je Region. */
const EMPTY_INDEX_LIST: readonly number[] = [];
const EMPTY_RUNTIME_ROCKS: readonly SyncedPlaceableRock[] = [];
// Dev-only crown silhouette profile. Ratios track the existing day curve rather
// than baking a second time-of-day model into the shadow renderer.
const SUN_FOREST_SHADOW = { offsetDiameter: .30, scale: 1.10, opacity: .52,
  softnessDiameter: .055, color: 0x182c48, reference: resolveSkyState(17 * 60) };

// Antipodal disk samples have no directional drift. Gaussian weights are
// normalized in optical depth, so a solid silhouette keeps the profile opacity
// regardless of the number of taps. This is paid only during existing bakes.
const CANOPY_SHADOW_KERNEL = (() => {
  const samples = Array.from({ length: 6 }, (_, i) => {
    const radius = Math.sqrt((i + .5) / 6), angle = i * Math.PI * (3 - Math.sqrt(5));
    const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
    return [{ x, y, weight: Math.exp(-2 * radius * radius) },
      { x: -x, y: -y, weight: Math.exp(-2 * radius * radius) }];
  }).flat();
  const total = samples.reduce((sum, sample) => sum + sample.weight, 0);
  return samples.map(sample => ({ ...sample, weight: sample.weight / total }));
})();

/**
 * Wie weit die Schattenhuelle eines Casters ueber seinen Mittelpunkt hinausreicht.
 *
 * Das ist die Reichweite, mit der ein raeumlicher Index nach Kandidaten fuer eine Region sucht:
 * Ein Fels ausserhalb der Region kann seinen Schatten noch hineinwerfen.
 */
function getStaticShadowReachPx(preset: ShadowCasterConfig, profile: ShadowProfile, direction = WORLD_SHADOW_CONFIG.lightDirection): number {
  const castLength = preset.castHeightPx * preset.stretch * profile.lengthMult;
  const inflate = preset.inflatePx + preset.softnessPx * profile.softnessMult;
  const radius = Math.max(
    preset.footprintWidthPx + inflate * 2,
    preset.footprintHeightPx + inflate * 2,
  ) * 0.5;
  const offset = (preset.airborneHeightPx ?? 0) + castLength;
  return Math.max(
    Math.abs(direction.x * offset),
    Math.abs(direction.y * offset),
  ) + radius;
}

function getMaxStaticShadowReachPx(profile: ShadowProfile, direction = WORLD_SHADOW_CONFIG.lightDirection): number {
  let reach = 0;
  for (const { config } of STATIC_SHADOW_CASTERS) {
    const anchorOffset = config === SHADOW_CASTERS.watchtower
      ? Math.max(Math.abs(WATCHTOWER_SHADOW_FOOTPRINT.centerOffsetX), Math.abs(WATCHTOWER_SHADOW_FOOTPRINT.centerOffsetY)) : 0;
    reach = Math.max(reach, getStaticShadowReachPx(config, profile, direction) + anchorOffset);
  }
  return reach;
}

/**
 * Crown shadows as pre-blurred masks: the twelve-tap kernel is baked once per crown at half
 * resolution (the penumbra spans >= ~12 px) and the finished mask is moved every frame. Only a
 * softness drift or an opacity outside the baked headroom re-bakes it; within the headroom the
 * mask alpha follows the opacity, which is linear in MULTIPLY darkness. Allocated per layout.
 */
const CANOPY_MASK = { resolution: .5, softnessDrift: .04, opacityHeadroom: 1.12, opacityFloor: .8,
  bakesPerFrame: 6, prefetchPx: 256, softnessCeiling: 2 } as const;
type CanopySource = ArenaBuilderResult['canopyObjects'][number];
interface CanopyShadowShape { distance: number; softness: number; scale: number; opacity: number }
/** Below these changes a frame alters nothing visible (0.05° moves a 140 px shadow tip by
 * ~0.1 px), so the continuous casters keep last frame's drawing. Culling keeps a margin
 * larger than the view tolerance, so camera motion never uncovers an undrawn caster. */
const CONTINUOUS_REDRAW = { directionSin: Math.sin(.05 * Math.PI / 180), profile: .002, viewPx: 32, marginPx: 64 } as const;
interface CanopyShadowMask { readonly target: Phaser.GameObjects.RenderTexture; readonly side: number; softness: number; opacity: number }

const STATIC_PROFILE_REBAKE_MIN_INTERVAL_MS = 600;
const STATIC_PROFILE_OPACITY_DELTA = 0.06;
const STATIC_PROFILE_LENGTH_DELTA = 0.08;
const STATIC_PROFILE_SOFTNESS_DELTA = 0.08;

// ---------------------------------------------------------------------------
// Pre-computed stadium arc tables.
// Base lightDirection is constant; the sun path rotates these tables at submission.
// Computing cos/sin once at module load avoids repeated trig calls per frame.
// ---------------------------------------------------------------------------
const STADIUM_ARC_N = 8; // arc subdivisions per semicircle
const _stadiumDirAngle = Math.atan2(
  WORLD_SHADOW_CONFIG.lightDirection.y,
  WORLD_SHADOW_CONFIG.lightDirection.x,
);
const STADIUM_DIRECTION_COS=Math.cos(_stadiumDirAngle),STADIUM_DIRECTION_SIN=Math.sin(_stadiumDirAngle);
// Back cap: source semicircle faces away from shadow direction
const STADIUM_BACK_ARC: ReadonlyArray<{ readonly cos: number; readonly sin: number }> =
  Array.from({ length: STADIUM_ARC_N + 1 }, (_, i) => {
    const a = _stadiumDirAngle + Math.PI / 2 + (Math.PI * i) / STADIUM_ARC_N;
    return { cos: Math.cos(a), sin: Math.sin(a) };
  });
// Front cap: shadow semicircle faces toward shadow direction
const STADIUM_FRONT_ARC: ReadonlyArray<{ readonly cos: number; readonly sin: number }> =
  Array.from({ length: STADIUM_ARC_N + 1 }, (_, i) => {
    const a = _stadiumDirAngle - Math.PI / 2 + (Math.PI * i) / STADIUM_ARC_N;
    return { cos: Math.cos(a), sin: Math.sin(a) };
  });

export class ShadowSystem {
  private characterClouds: SunCloudState | null = null;
  private characterShadows: CharacterMeshShadowRenderer | null = null;
  private enemyShadows: EnemyMeshShadowRenderer | null = null;
  private figureReceiver: CharacterShadowReceiver | null = null;
  private readonly figureBorrowers = new Set<() => void>();
  /** The World shadow owner owns the receiver, including Low and player-free worlds. */
  borrowFigureEnvironment(onRelease: () => void): { receiver: CharacterShadowReceiver; clouds: SunCloudState; release: () => void } | null {
    const receiver = this.syncFigureReceiver();
    if (!receiver || !this.characterClouds) return null;
    this.figureBorrowers.add(onRelease);
    return { receiver, clouds: this.characterClouds, release: () => this.figureBorrowers.delete(onRelease) };
  }
  private syncFigureReceiver(): CharacterShadowReceiver | null {
    if (!this.characterClouds || !this.lastStaticLayout) return null;
    if (!this.figureReceiver) {
      this.figureReceiver = new CharacterShadowReceiver(this.scene, this.getStaticWorldBounds(),
        this.structureReceiverRects.length > 0 ? STRUCTURE_RECEIVER_TEXEL_PX : CELL_SIZE);
      this.characterReceiverDirty = true;
    }
    if (this.characterReceiverDirty) {
      const options = this.lastStaticOptions;
      this.figureReceiver.update(this.lastStaticLayout, options.offsetX ?? ARENA_OFFSET_X,
        options.offsetY ?? ARENA_OFFSET_Y, options.rockVisibilityPredicate, options.runtimeRocks ?? EMPTY_RUNTIME_ROCKS,
        this.baseCells.values(), this.collapsedBridges, this.structureReceiverRects);
      this.characterReceiverDirty = false;
    }
    return this.figureReceiver;
  }
  private readonly enemyShadowSources: EnemyEntity[] = [];
  private enemyMeshesSuppressed = false;
  private readonly collectShadowEnemy = (enemy: EnemyEntity): void => { this.enemyShadowSources.push(enemy); };
  setEnemyMeshShadowsSuppressed(value: boolean): void {
    this.enemyMeshesSuppressed = value;
    if (value) { this.enemyShadows?.destroy(); this.enemyShadows = null; }
  }
  getEnemyShadowsStatus() { return { suppressed: this.enemyMeshesSuppressed, ...(this.enemyShadows?.inspect() ?? { activeInstances: 0 }) }; }
  private destroyFigureShadows(): void {
    // Borrowers detach their display textures before the World receiver is destroyed.
    for (const release of this.figureBorrowers) release();
    this.figureBorrowers.clear();
    this.enemyShadows?.destroy(); this.enemyShadows = null;
    this.characterShadows?.destroy(); this.characterShadows = null;
    this.figureReceiver?.destroy(); this.figureReceiver = null;
    this.enemyShadowSources.length = 0;
  }
  private characterReceiverDirty = true;
  private collapsedBridges: ReadonlySet<string> = new Set();
  private structureReceiverRects: readonly CharacterShadowReceiverRect[] = [];
  /**
   * Structure roofs receive no figure shadows. Their outlines sit on an 8-px grid, so the receiver
   * switches to finer texels while structures exist; that swap rebuilds the figure shadows.
   */
  syncStructureReceiverRects(rects: readonly CharacterShadowReceiverRect[]): void {
    if (rects === this.structureReceiverRects) return;
    const finer = rects.length > 0, wasFiner = this.structureReceiverRects.length > 0;
    this.structureReceiverRects = rects;
    if (finer !== wasFiner && this.figureReceiver) this.destroyFigureShadows();
    this.characterReceiverDirty = true;
  }
  /** Bridge decks receive figure shadows while they stand; the World bridge owner reports collapses. */
  setCollapsedBridges(ids: ReadonlySet<string>): void {
    if (ids.size === this.collapsedBridges.size && [...ids].every((id) => this.collapsedBridges.has(id))) return;
    this.collapsedBridges = new Set(ids);
    this.characterReceiverDirty = true;
  }
  private characterSuppressed = false;
  private characterSolid = false;
  private dynamicVisible = true;

  setCharacterSunlight(clouds: SunCloudState | null): void {
    if (clouds === this.characterClouds) return;
    this.destroyFigureShadows();
    this.characterClouds = clouds; this.characterReceiverDirty = true;
  }
  setCharacterShadowsSuppressed(value: boolean): void {
    this.characterSuppressed = value;
    this.characterShadows?.setVisible(this.dynamicVisible && !value);
  }
  setCharacterShadowSolid(value: boolean): void {
    this.characterSolid = value; this.characterShadows?.setDebugSolid(value);
    this.enemyShadows?.setDebugSolid(value);
  }
  getCharacterShadowsStatus() {
    const meshes = getCharacterMeshes(this.scene);
    return { bound: !!this.characterClouds, enabled: this.quality.level !== 'low' && CHARACTER_SHADOW_MODE === 'mesh',
      suppressed: this.characterSuppressed, dynamicVisible: this.dynamicVisible, solid: this.characterSolid,
      loadedMeshes: meshes?.size ?? 0, totalMeshes: CHARACTER_MESH_MANIFEST.meshes.length,
      ...(this.characterShadows?.inspect() ?? { activeInstances: 0, instances: [] }) };
  }
  private syncCharacterShadows(players: readonly PlayerEntity[]): boolean {
    const receiver = this.syncFigureReceiver();
    if (CHARACTER_SHADOW_MODE !== 'mesh' || !this.characterClouds || !this.lastStaticLayout || this.quality.level === 'low') return false;
    if (!this.characterShadows) {
      const meshes = getCharacterMeshes(this.scene);
      if (!meshes) return false;
      this.characterShadows = new CharacterMeshShadowRenderer(this.scene, this.characterClouds,
        receiver!, meshes, CHARACTER_MESH_TARGET_SIZE[this.quality.level]);
      this.characterReceiverDirty = true;
      this.characterShadows.setDebugSolid(this.characterSolid);
    }
    this.syncFigureReceiver();
    this.characterShadows.sync(players, this.dynamicVisible && !this.characterSuppressed);
    return true;
  }
  private formationShadows: ((id: number) => boolean) | null = null;
  setFormationShadows(landscape: ((id: number) => boolean) | null): void {
    if (this.formationShadows === landscape) return;
    this.formationShadows = landscape;
    this.rebuildStaticShadowsForProfileChange();
  }
  private canopySources: ArenaBuilderResult['canopyObjects'] | null = null;
  private canopyWoodland = false;
  private sunDirection: {x:number;y:number} | null = null;
  private staticSunDirection: {x:number;y:number} | null = null;
  private sunAzimuth: number | null = null;
  private bakedAzimuth: number | null = null;
  private sunEnemies: { forEachEnemy(visitor: (enemy: EnemyEntity) => void): void } | null = null;
  private enemyPrimitives = 0;
  private enemyCasters = 0;
  private readonly drawSunEnemy = (enemy: EnemyEntity): void => {
    const sprite = enemy.sprite;
    if (!this.dynamicVisible || !sprite.active || !sprite.visible || sprite.alpha <= 0 || enemy.getHp() <= 0 || enemy.isBurrowed()
      || !this.enemyMeshesSuppressed && this.enemyShadows?.handles(enemy)) return;
    const size = enemy.getSize();
    this.enemyPrimitives += this.drawFootprint(
      this.getLayer(SHADOW_CASTERS.player.layerDepth).dynamicGraphics,
      sprite.x, sprite.y, SHADOW_CASTERS.player, size * 0.72, size * 0.62,
    );
    this.enemyCasters++;
  };

  /** Dynamic and long static casters follow the continuous cast bearing every frame;
   * short contact casters keep the throttled baked steps. The cast arc continues
   * through the night, so neither jumps from west to east at dawn.
   * No authority, free clock or production config mutation. */
  setSunPath(path: SunPathState | null, enemies: ShadowSystem['sunEnemies'] = null): void {
    this.sunEnemies = path ? enemies : null;
    if(!path) {
      if(!this.sunDirection)return;
      this.sunDirection=null;this.sunAzimuth=null;
      this.rebuildStaticShadowsForProfileChange();return;
    }
    const cast=path.castAzimuth*Math.PI/180;
    this.sunDirection??={x:0,y:0};
    this.sunDirection.x=-Math.cos(cast);this.sunDirection.y=Math.sin(cast);
    this.sunAzimuth=quantizeSunAzimuth(path.castAzimuth);
  }

  /**
   * Long static casters – woodland crowns, trunks and watchtowers – while a sun path is
   * bound. They are drawn every frame with the current bearing and profile, so their
   * shadows move geometrically continuously instead of in baked steps and 128-px region
   * swaps. Only the short contact footprints (bases, walls, turrets: at most a few px per
   * bake step) remain in the chunk bake. Decided per static rebuild, together with the
   * layer set of the baked surface, so no caster is ever drawn twice.
   */
  private staticContinuous = false;
  private readonly canopyMasks = new Map<CanopySource, CanopyShadowMask>();
  private continuousCanopyShown = 0;
  private continuousPrimitives = 0;
  /** Layer ids present in the current baked surface. */
  private readonly staticLayerIds = new Set<string>();
  /** Inputs of the last continuous drawing; `continuousDirty` forces the next one. */
  private readonly continuousDrawn = { x: 0, y: 0, length: 0, softness: 0, opacity: 0, viewX: 0, viewY: 0, viewW: 0, viewH: 0 };
  private continuousDirty = true;
  private trunkStamp: ShadowTrunkStamp | null = null;
  private canopyBakesPending = false;
  private readonly canopyShapeScratch: CanopyShadowShape = { distance: 0, softness: 0, scale: 1, opacity: 0 };

  getContinuousShadowStats(): { enabled: boolean; primitives: number; canopyMasks: number; canopyMasksShown: number } {
    return { enabled: this.staticContinuous, primitives: this.continuousPrimitives,
      canopyMasks: this.canopyMasks.size, canopyMasksShown: this.continuousCanopyShown };
  }

  /** Redraws the continuous static casters for the current view; called once per frame,
   * but only rebuilt when the sun, the profile, the view or the casters visibly changed. */
  syncContinuousStaticShadows(): void {
    const layout = this.lastStaticLayout, direction = this.sunDirection;
    if (!(this.staticContinuous && this.staticHasLayout && this.shadowsVisible && layout && direction)) {
      if (this.continuousDirty && this.continuousCanopyShown === 0 && this.continuousPrimitives === 0) return;
      this.hideContinuousStaticShadows();
      this.continuousPrimitives = 0;
      return;
    }
    const view = this.staticResidencyView ?? this.getStaticFrameRect(), profile = this.profile, drawn = this.continuousDrawn;
    if (!this.continuousDirty && direction.x * drawn.x + direction.y * drawn.y > 0
      && Math.abs(direction.x * drawn.y - direction.y * drawn.x) < CONTINUOUS_REDRAW.directionSin
      && Math.abs(profile.lengthMult - drawn.length) < CONTINUOUS_REDRAW.profile
      && Math.abs(profile.softnessMult - drawn.softness) < CONTINUOUS_REDRAW.profile
      && Math.abs(profile.opacityMult - drawn.opacity) < CONTINUOUS_REDRAW.profile
      && Math.abs(view.x - drawn.viewX) < CONTINUOUS_REDRAW.viewPx && Math.abs(view.y - drawn.viewY) < CONTINUOUS_REDRAW.viewPx
      && view.width === drawn.viewW && view.height === drawn.viewH) return;
    for (const bucket of this.layers.values()) bucket.continuousGraphics.clear();
    let used = 0, primitives = 0;
    {
      const options = this.lastStaticOptions, margin = CONTINUOUS_REDRAW.marginPx;
      const offsetX = options.offsetX ?? ARENA_OFFSET_X, offsetY = options.offsetY ?? ARENA_OFFSET_Y;
      const inView = (x: number, y: number, reach: number): boolean => x + reach + margin >= view.x
        && x - reach - margin <= view.x + view.width
        && y + reach + margin >= view.y && y - reach - margin <= view.y + view.height;
      const trunk = SHADOW_CASTERS.trunk, trunkReach = getStaticShadowReachPx(trunk, profile, direction);
      const trunks = this.getLayer(trunk.layerDepth, 'trees').continuousGraphics;
      // All trunks share one shape: a baked stamp replaces their per-frame tessellated polygons.
      // SpriteGPULayer is WebGL-only; Canvas and over-long evening shadows keep the polygons.
      const shape = this.trunkStampShape(trunk, profile, direction);
      const stamp = (this.scene.sys?.renderer as { gl?: unknown } | undefined)?.gl
        ? this.trunkStamp ??= new ShadowTrunkStamp(this.scene, trunk.layerDepth) : null;
      const stamped = !!stamp?.prepare(shape.layers, shape.dx, shape.dy, WORLD_SHADOW_CONFIG.color);
      if (stamped) stamp!.begin(layout.trees.length); else stamp?.hide();
      for (const tree of layout.trees) {
        const x = offsetX + tree.gridX * CELL_SIZE + CELL_SIZE / 2, y = offsetY + tree.gridY * CELL_SIZE + CELL_SIZE / 2;
        if (!inView(x, y, trunkReach)) continue;
        if (!stamped) { primitives += this.drawFootprint(trunks, x, y, trunk, undefined, undefined, profile, direction); continue; }
        if (!this.isVisibleInArena(x, y, shape.maxExtent)) continue;
        stamp!.write(x, y); primitives += shape.layers.length;
      }
      if (stamped) stamp!.end();
      const tower = SHADOW_CASTERS.watchtower, towerReach = getStaticShadowReachPx(tower, profile, direction);
      const towers = this.getLayer(tower.layerDepth, 'rocks').continuousGraphics;
      const rockVisible = options.rockVisibilityPredicate ?? (() => true);
      for (const rock of options.runtimeRocks ?? EMPTY_RUNTIME_ROCKS) {
        const cell = layout.rocks[rock.id];
        if (rock.kind !== 'watchtower' || rock.hp <= 0 || !cell || !rockVisible(rock.id)) continue;
        const x = offsetX + cell.gridX * CELL_SIZE + CELL_SIZE / 2 + WATCHTOWER_SHADOW_FOOTPRINT.centerOffsetX;
        const y = offsetY + cell.gridY * CELL_SIZE + CELL_SIZE / 2 + WATCHTOWER_SHADOW_FOOTPRINT.centerOffsetY;
        if (inView(x, y, towerReach)) primitives += this.drawFootprint(towers, x, y, tower, undefined, undefined, profile, direction);
      }
      used = this.drawContinuousCanopies(inView, profile, direction);
    }
    this.continuousCanopyShown = used;
    this.continuousPrimitives = primitives + used;
    Object.assign(drawn, { x: direction.x, y: direction.y, length: profile.lengthMult, softness: profile.softnessMult,
      opacity: profile.opacityMult, viewX: view.x, viewY: view.y, viewW: view.width, viewH: view.height });
    // Crowns beyond this frame's bake budget still owe a bake.
    this.continuousDirty = this.canopyBakesPending;
  }

  /** Crown shape of {@link drawCanopyShadows} for the given profile; shared by both paths. */
  private canopyShadowShape(source: CanopySource, profile: ShadowProfile, out: CanopyShadowShape = this.canopyShapeScratch): CanopyShadowShape {
    const woodland = this.canopyWoodland, tuning = SUN_FOREST_SHADOW;
    const diameter = Math.max(source.gfx.displayWidth, source.gfx.displayHeight);
    out.distance = woodland ? diameter * tuning.offsetDiameter * profile.lengthMult / tuning.reference.shadowLengthMult : 64 * profile.lengthMult;
    out.softness = woodland ? diameter * tuning.softnessDiameter * profile.softnessMult / tuning.reference.shadowSoftnessMult : 9 * profile.softnessMult;
    out.scale = woodland ? tuning.scale : 1;
    out.opacity = woodland ? Math.min(.55, tuning.opacity * profile.opacityMult / tuning.reference.shadowOpacityMult)
      : Math.min(.45, .7 * profile.opacityMult);
    return out;
  }

  /** Moves each visible crown's baked mask along the continuous sun; see {@link CANOPY_MASK}. */
  private drawContinuousCanopies(inView: (x: number, y: number, reach: number) => boolean,
    profile: ShadowProfile, direction: { x: number; y: number }): number {
    let shown = 0, bakes = 0;
    this.canopyBakesPending = false;
    for (const [source, mask] of this.canopyMasks) {
      const shape = this.canopyShadowShape(source, profile);
      const x = source.worldX + shape.distance * direction.x, y = source.worldY + shape.distance * direction.y;
      const radius = Math.hypot(source.gfx.displayWidth, source.gfx.displayHeight) * .5 * shape.scale + shape.softness;
      if (shape.opacity <= 0 || !inView(x, y, radius + CANOPY_MASK.prefetchPx)) { mask.target.setVisible(false); continue; }
      const drift = mask.opacity <= 0 || Math.abs(shape.softness / mask.softness - 1) > CANOPY_MASK.softnessDrift
        || shape.opacity > mask.opacity || shape.opacity < mask.opacity * CANOPY_MASK.opacityFloor;
      if (drift && bakes < CANOPY_MASK.bakesPerFrame) {
        this.bakeCanopyMask(source, mask, shape.softness, shape.scale,
          Math.min(this.canopyWoodland ? .55 : .45, shape.opacity * CANOPY_MASK.opacityHeadroom));
        bakes++;
      } else if (drift) this.canopyBakesPending = true;
      if (mask.opacity <= 0 || !inView(x, y, radius)) { mask.target.setVisible(false); continue; }
      mask.target.setPosition(x, y).setAlpha(Math.min(1, shape.opacity / mask.opacity)).setVisible(true);
      shown++;
    }
    return shown;
  }

  private bakeCanopyMask(source: CanopySource, mask: CanopyShadowMask, softness: number, scale: number, opacity: number): void {
    const r = CANOPY_MASK.resolution, target = mask.target, centre = mask.side / 2;
    const tint = this.canopyWoodland ? SUN_FOREST_SHADOW.color : WORLD_SHADOW_CONFIG.color;
    target.clear();
    target.fill(0xffffff, 1);
    for (const tap of CANOPY_SHADOW_KERNEL) {
      target.stamp(source.gfx.texture.key, source.gfx.frame.name, centre + tap.x * softness * r, centre + tap.y * softness * r, {
        scaleX: source.gfx.scaleX * scale * r, scaleY: source.gfx.scaleY * scale * r, rotation: source.gfx.rotation,
        tint, alpha: 1 - Math.pow(1 - opacity, tap.weight), blendMode: Phaser.BlendModes.MULTIPLY,
      });
    }
    target.render();
    mask.softness = softness; mask.opacity = opacity;
  }

  /** One mask per crown while continuous, allocated with the layout rather than during play. */
  private syncCanopyMasks(): void {
    const sources = this.staticContinuous ? this.canopySources : null;
    for (const [source, mask] of this.canopyMasks) {
      if (sources?.includes(source)) continue;
      mask.target.destroy(); this.canopyMasks.delete(source);
    }
    for (const source of sources ?? []) {
      if (this.canopyMasks.has(source)) continue;
      const shape = this.canopyShadowShape(source, { opacityMult: 1, lengthMult: 1, softnessMult: CANOPY_MASK.softnessCeiling });
      const side = Math.ceil((Math.hypot(source.gfx.displayWidth, source.gfx.displayHeight) * shape.scale
        + 2 * shape.softness + 8) * CANOPY_MASK.resolution);
      const target = createColorRenderTexture(this.scene, side, side);
      target.setOrigin(.5).setScale(1 / CANOPY_MASK.resolution).setDepth(DEPTH.GROUND_FOG - .02)
        .setBlendMode(Phaser.BlendModes.MULTIPLY).setVisible(false);
      registerGraphicsObject(this.scene, 'dynamicShadows', target);
      this.canopyMasks.set(source, { target, side, softness: 0, opacity: 0 });
    }
  }

  /** Dev A/B: use the authored canopy's alpha/rotation instead of a broad circular footprint. */
  setCanopyShadows(sources: ArenaBuilderResult['canopyObjects'] | null, woodland = false): void {
    woodland = sources !== null && woodland;
    if (sources === this.canopySources && woodland === this.canopyWoodland) return;
    this.canopySources = sources;
    this.canopyWoodland = woodland;
    this.rebuildStaticShadowsForProfileChange();
  }
  private readonly baseCells = new Map<
    { readonly x: number; readonly y: number },
    { x: number; y: number }
  >();
  private readonly seenBaseCells = new Set<{ readonly x: number; readonly y: number }>();
  /** Lebende reaktive Map-Objekte, deren Kontaktschatten gebacken ist (Schlüssel: Layout-Index). */
  private readonly reactivePropCells = new Map<number, { x: number; y: number }>();
  private readonly seenReactivePropCells = new Set<number>();
  private readonly layers = new Map<string, ShadowLayerBucket>();
  private worldBoundsOverride: ShadowWorldBounds | null = null;
  private profile: ShadowProfile = SHADOW_PROFILES.day;
  /** Profil, das tatsaechlich in den sichtbaren statischen RenderTextures steckt. */
  private lastBakedProfile: ShadowProfile | null = null;
  private lastStaticProfileBakeAtMs = Number.NEGATIVE_INFINITY;
  private quality: GraphicsQualityProfile;
  private unsubscribeQuality: (() => void) | null = null;
  private lastStaticLayout: ArenaLayout | null = null;
  private lastStaticOptions: StaticShadowLayoutBuildOptions = {};
  /** Von aussen gesetzte Sichtbarkeit; kombiniert sich mit dem Inhalt der gebackenen Layer. */
  private shadowsVisible = true;
  private staticSamplingMode: ChunkSamplingMode = 'default';
  /**
   * Die gebackenen statischen Schatten liegen in Render-Chunks statt in je einer arenagrossen
   * RenderTexture je Ebene. Auf einer 400 x 80-Karte waeren das vier Ziele zu 12 800 x 2 560 px;
   * jetzt folgt der Speicher dem sichtbaren Ausschnitt (siehe `arena/chunks`).
   */
  private staticSurface: ChunkedRenderSurface | null = null;
  private readonly staticScratch = new ChunkScratchPool(this.scene);
  /** Rahmen, fuer den `staticSurface` gebaut wurde – aendern sich die Bounds, wird er ersetzt. */
  private staticSurfaceFrameKey = '';
  /** Profil, mit dem die Chunks gebacken werden. Ein Dirty-Rebake darf nicht vorauseilen. */
  private staticBakeProfile: ShadowProfile = SHADOW_PROFILES.day;
  /**
   * Zuletzt gemeldeter Kameraausschnitt. `null` heisst "kein Streaming" und macht den gesamten
   * Rahmen resident – passend etwa fuer eine kleine oder vollstaendig sichtbare World.
   */
  private staticResidencyView: ChunkWorldRect | null = null;
  private staticHasLayout = false;
  /** Raeumlicher Index ueber `layout.rocks`; Positionen im Array sind die Fels-IDs. */
  private staticRockIndex = new ArenaCellBucketIndex(1);
  /** Wiederverwendete Puffer – eine Allokation je Region weniger. */
  private readonly staticRockCandidates: number[] = [];
  private readonly staticRuntimeById = new Map<number, SyncedPlaceableRock>();
  // Copies survive mutable layout/snapshot relocation and removal until invalidation.
  private readonly watchtowerShadowAnchors = new Map<number, { gridX: number; gridY: number }>();

  private rememberWatchtowerShadowAnchors(runtime: readonly SyncedPlaceableRock[]): void {
    this.watchtowerShadowAnchors.clear();
    for (const tower of runtime) if (tower.kind === 'watchtower' && tower.hp > 0) {
      this.watchtowerShadowAnchors.set(tower.id, { gridX: tower.gridX, gridY: tower.gridY });
    }
  }
  private attributionCollector: ArenaVisualAttributionCollector | null = null;

  // Reusable point buffers — mutated in-place each draw call to avoid
  // allocating hundreds of Vector2 objects per frame.
  private readonly stadiumPts: Phaser.Math.Vector2[] =
    Array.from({ length: (STADIUM_ARC_N + 1) * 2 }, () => new Phaser.Math.Vector2());
  private readonly cellPts: Phaser.Math.Vector2[] =
    Array.from({ length: 6 }, () => new Phaser.Math.Vector2());

  constructor(
    private readonly scene: Phaser.Scene,
  ) {
    this.quality = getGraphicsQualityProfile(scene);
    this.unsubscribeQuality = getGraphicsQualityController(scene)?.subscribe((profile) => {
      this.quality = profile;
      this.destroyFigureShadows();
      if (this.lastStaticLayout) {
        this.rebuildStaticLayoutShadows(this.lastStaticLayout, this.lastStaticOptions);
      }
    }) ?? null;
  }

  setWorldBoundsOverride(bounds: ShadowWorldBounds | null): void {
    this.destroyFigureShadows();
    this.worldBoundsOverride = bounds;
  }

  /** Cache visible surface cells, including previews and cells still awaiting destruction. */
  syncBaseShadows(cells: Iterable<{
    readonly x: number;
    readonly y: number;
    readonly active: boolean;
    readonly visible: boolean;
  }>): void {
    this.seenBaseCells.clear();
    for (const cell of cells) {
      if (!cell.active || !cell.visible) continue;
      this.seenBaseCells.add(cell);
      const previous = this.baseCells.get(cell);
      if (previous?.x === cell.x && previous.y === cell.y) continue;
      if (previous) this.invalidateBaseShadow(previous.x, previous.y);
      this.baseCells.set(cell, { x: cell.x, y: cell.y });
      this.invalidateBaseShadow(cell.x, cell.y);
    }
    for (const [cell, position] of this.baseCells) {
      if (this.seenBaseCells.has(cell)) continue;
      this.baseCells.delete(cell);
      this.invalidateBaseShadow(position.x, position.y);
    }
    this.seenBaseCells.clear();
  }

  /**
   * Reaktive Map-Objekte folgen ihren lebenden Zellen wie Basen: Erscheinen, Verschwinden und
   * Verschieben invalidieren nur die betroffenen Schatten-Chunks.
   */
  syncReactivePropShadows(cells: Iterable<{ readonly index: number; readonly x: number; readonly y: number; readonly alive: boolean }>): void {
    this.seenReactivePropCells.clear();
    for (const cell of cells) {
      if (!cell.alive) continue;
      this.seenReactivePropCells.add(cell.index);
      const previous = this.reactivePropCells.get(cell.index);
      if (previous?.x === cell.x && previous.y === cell.y) continue;
      if (previous) this.invalidateBaseShadow(previous.x, previous.y, SHADOW_CASTERS.reactiveProp);
      this.reactivePropCells.set(cell.index, { x: cell.x, y: cell.y });
      this.invalidateBaseShadow(cell.x, cell.y, SHADOW_CASTERS.reactiveProp);
    }
    for (const [index, position] of this.reactivePropCells) {
      if (this.seenReactivePropCells.has(index)) continue;
      this.reactivePropCells.delete(index);
      this.invalidateBaseShadow(position.x, position.y, SHADOW_CASTERS.reactiveProp);
    }
    this.seenReactivePropCells.clear();
  }

  private invalidateBaseShadow(x: number, y: number, caster: ShadowCasterConfig = SHADOW_CASTERS.base): void {
    this.characterReceiverDirty = true;
    const shadow = this.getShadowBounds(x, y, caster, this.staticBakeProfile);
    const world = this.getStaticWorldBounds();
    const size = SHADOW_DIRTY_CHUNK_SIZE;
    const minX = Math.floor((Math.max(world.minX, shadow.minX) - world.minX) / size);
    const minY = Math.floor((Math.max(world.minY, shadow.minY) - world.minY) / size);
    const maxX = Math.floor((Math.min(world.maxX - 1, shadow.maxX) - world.minX) / size);
    const maxY = Math.floor((Math.min(world.maxY - 1, shadow.maxY) - world.minY) / size);
    // refreshRegion addresses one chunk; invalidate each intersected work unit explicitly.
    for (let cy = minY; cy <= maxY; cy += 1) {
      for (let cx = minX; cx <= maxX; cx += 1) {
        this.staticSurface?.refreshRegion(cx * size, cy * size, size);
      }
    }
  }

  /**
   * Meldet den sichtbaren Weltausschnitt fuer das Chunk-Streaming der gebackenen Schatten.
   *
   * Gehoert in denselben Frame-Abschnitt wie {@link ArenaBuilder.updateSurfaceResidency}. Wird der
   * Aufruf nie gemacht, bleibt der gesamte Rahmen resident.
   */
  updateStaticResidency(view: ChunkWorldRect | null): void {
    this.staticResidencyView = view;
    if (!this.staticSurface) return;
    this.staticSurface.updateResidency(view ?? this.getStaticFrameRect());
  }

  setAttributionCollector(collector: ArenaVisualAttributionCollector | null): void {
    this.attributionCollector = collector;
  }

  /** Startup barrier for the static-shadow working set. */
  isStaticReadyForView(view: ChunkWorldRect, includePrefetch = true): boolean {
    if (!this.staticHasLayout || !this.staticSurface) return false;
    return this.staticSurface.isReadyForView(view, includePrefetch);
  }

  /** Startup diagnostics for the replicated arena-loading progress. */
  getStaticSurfaceStats(): ChunkedRenderSurfaceStats | null {
    return this.staticSurface?.getStats() ?? null;
  }

  /**
   * Setzt die Uhrzeit der aktuellen World-Darstellung. Zur Nacht hin bleiben die Sonnenschatten erhalten,
   * werden aber zu kurzen, weichen und blassen Mondschatten. Vor einem Rebuild der
   * statischen Layer setzen – dynamische Schatten übernehmen es ab dem nächsten Frame.
   */
  setTimeOfDay(minutes: number): void {
    const sky = resolveSkyState(minutes);
    this.profile = {
      opacityMult: sky.shadowOpacityMult,
      lengthMult: sky.shadowLengthMult,
      softnessMult: sky.shadowSoftnessMult,
    };
  }

  /**
   * Backt alle statischen Layer mit dem aktuellen Profil neu.
   *
   * Nicht ueber `rebuildArenaStaticShadows()` erreichbar: das ist der
   * Hindernis-Invalidierungspfad und laesst bei unveraendertem Layout die Baum-Schatten
   * bewusst stehen (siehe dort). Ein Profilwechsel aendert aber Laenge, Deckkraft und
   * Weichheit *aller* Caster, Stamm und Krone eingeschlossen – und die Krone ist mit
   * `softnessPx: 98` und 32 Lagen der auffaelligste Schatten im Bild.
   */
  rebuildStaticShadowsForProfileChange(): void {
    if (!this.lastStaticLayout) return;
    this.rebuildStaticLayoutShadowsWithProfile(
      this.lastStaticLayout,
      this.lastStaticOptions,
      this.profile,
    );
  }

  /** Gleicht nur die teuren statischen Bakes gedrosselt an das laufende Profil an. */
  syncStaticProfile(synchronizedNowMs: number, force = false): boolean {
    if (!this.lastStaticLayout) return false;
    const nowMs = Number.isFinite(synchronizedNowMs) ? synchronizedNowMs : 0;
    const baked = this.lastBakedProfile;
    if (!force) {
      if (baked && this.bakedAzimuth===this.sunAzimuth && !hasRelevantStaticProfileChange(baked, this.profile)) return false;
      if (nowMs - this.lastStaticProfileBakeAtMs < STATIC_PROFILE_REBAKE_MIN_INTERVAL_MS) return false;
    }
    this.rebuildStaticLayoutShadowsWithProfile(
      this.lastStaticLayout,
      this.lastStaticOptions,
      this.profile,
      nowMs,
      true,
    );
    return true;
  }

  setVisible(visible: boolean): void {
    this.setStaticVisible(visible);
    this.setDynamicVisible(visible);
  }

  /**
   * Nur die gebackenen statischen Layer. Getrennt schaltbar, damit der Ablationsmodus den
   * Composite der gebackenen Texturen von den pro Frame gezeichneten dynamischen Schatten
   * unterscheiden kann – ohne die Trennung ist der Restbetrag nicht zuzuordnen.
   */
  setStaticVisible(visible: boolean): void {
    this.shadowsVisible = visible;
    // `staticGraphics` bleibt dauerhaft unsichtbar – sichtbar sind die gebackenen Chunks.
    this.syncStaticSurfaceVisibility();
  }

  isStaticVisible(): boolean {
    return this.shadowsVisible;
  }

  /** Affects only the render textures used by the baked static shadow chunks. */
  setSamplingMode(mode: ChunkSamplingMode): void {
    this.staticSamplingMode = mode;
    this.staticSurface?.setSamplingMode(mode);
  }

  getSamplingMode(): ChunkSamplingMode {
    return this.staticSamplingMode;
  }

  setDynamicVisible(visible: boolean): void {
    this.dynamicVisible = visible;
    this.characterShadows?.setVisible(visible && !this.characterSuppressed);
    this.enemyShadows?.setVisible(visible && !this.enemyMeshesSuppressed);
    for (const bucket of this.layers.values()) bucket.dynamicGraphics.setVisible(visible);
  }

  /**
   * Leert nur die pro Frame erzeugten Schatten. Gebackene statische Chunks bleiben dabei
   * erhalten, damit ein World-Rebind unveraenderte Presentation weiterverwenden kann.
   */
  clearDynamicShadows(): void {
    this.clearDynamic();
  }

  private syncStaticSurfaceVisibility(): void {
    this.staticSurface?.setVisible(this.shadowsVisible && this.staticHasLayout);
    // Hidden continuous casters are redrawn on the next frame sync.
    if (!this.shadowsVisible || !this.staticHasLayout) this.hideContinuousStaticShadows();
  }

  private hideContinuousStaticShadows(): void {
    this.continuousDirty = true;
    for (const bucket of this.layers.values()) bucket.continuousGraphics.clear();
    this.trunkStamp?.hide();
    for (const mask of this.canopyMasks.values()) mask.target.setVisible(false);
    this.continuousCanopyShown = 0;
  }

  rebuildStaticLayoutShadows(
    layout: ArenaLayout | null,
    options: StaticShadowLayoutBuildOptions = {},
    preserveVisible = false,
  ): void {
    if (!layout) {
      this.lastStaticLayout = null;
      this.lastStaticOptions = options;
      this.clearStatic();
      this.lastBakedProfile = null;
      return;
    }
    this.rebuildStaticLayoutShadowsWithProfile(layout, options, this.profile, Number.NEGATIVE_INFINITY, preserveVisible);
  }

  /**
   * Setzt Zustand und Backprofil und laesst alle residenten Chunks neu backen.
   *
   * Es gibt seit dem Chunk-Streaming keinen arenaweiten Bake mehr: Fels-, Turret-, Stamm- und
   * Kronenschatten entstehen gemeinsam je Region, gefiltert auf die Caster, deren Schattenhuelle
   * die Region ueberhaupt beruehrt. Die frueher noetige Trennung in eine veraenderliche
   * Fels-Gruppe und eine unveraenderliche Baum-Gruppe entfaellt damit: Ein Chunk enthaelt in der
   * Regel gar keinen Baum, und wo doch, ist es genau einer.
   */
  private rebuildStaticLayoutShadowsWithProfile(
    layout: ArenaLayout,
    options: StaticShadowLayoutBuildOptions,
    profile: ShadowProfile,
    bakedAtMs = Number.NEGATIVE_INFINITY,
    preserveVisible = false,
  ): void {
    this.characterReceiverDirty = true;
    if (this.lastStaticLayout !== layout) {
      // Neues Layout heisst neuer Felsbestand: Der raeumliche Index muss von vorn beginnen,
      // sonst zeigte er auf Positionen der Vorrunde.
      const bounds = this.getStaticWorldBounds();
      this.staticRockIndex = new ArenaCellBucketIndex(Math.max(1, bounds.maxX - bounds.minX));
    }
    this.lastStaticLayout = layout;
    this.lastStaticOptions = options;
    this.rememberWatchtowerShadowAnchors(options.runtimeRocks ?? EMPTY_RUNTIME_ROCKS);
    this.staticBakeProfile = profile;
    this.staticContinuous = this.sunDirection !== null && this.canopySources !== null;
    this.continuousDirty = true;
    this.syncCanopyMasks();
    this.bakedAzimuth=this.sunAzimuth;
    if(this.bakedAzimuth===null)this.staticSunDirection=null;
    else {
      this.staticSunDirection??={x:0,y:0};
      const angle=this.bakedAzimuth*Math.PI/180;
      this.staticSunDirection.x=-Math.cos(angle);this.staticSunDirection.y=Math.sin(angle);
    }
    this.staticHasLayout = true;
    const { surface, created } = this.ensureStaticSurface();
    // Ein frisch erzeugter Chunk hat seine 128-px-Regionen bereits im gemeinsamen Scheduler;
    // ein zweiter Voll-Plan waere beim Rundenstart doppelte Arbeit.
    if (!created) surface.refreshAll({ preserveVisible });
    this.syncStaticSurfaceVisibility();
    this.lastBakedProfile = { ...profile };
    this.lastStaticProfileBakeAtMs = bakedAtMs;
  }

  rebuildArenaStaticShadows(
    layout: ArenaLayout | null,
    arenaResult: ArenaBuilderResult | null,
    runtimeRocks: readonly SyncedPlaceableRock[] = [],
    preserveVisible = false,
  ): void {
    if (!layout || !arenaResult) {
      this.clearStatic();
      return;
    }

    const options: StaticShadowLayoutBuildOptions = {
      offsetX: ARENA_OFFSET_X,
      offsetY: ARENA_OFFSET_Y,
      runtimeRocks,
      // Reaktive Map-Objekte teilen den Hindernisraum, werfen aber ihren eigenen Schatten.
      rockVisibilityPredicate: (index) => Boolean(arenaResult.rockPhysicsProxies[index]?.active)
        && !(arenaResult.obstacleIds && isReactivePropObstacleId(arenaResult.obstacleIds, index)),
    };

    // Dies ist der Invalidierungspfad: Er laeuft, wenn sich die Hindernisse geaendert haben.
    // Solange dasselbe Layout gilt, darf das bereits gebackene Profil weitergelten – sonst
    // eilte ein Neubau einem noch ausstehenden Profilwechsel voraus und liesse alte Felsraender
    // als Geisterschatten stehen.
    const sameLayout = this.lastStaticLayout === layout;
    const staticProfile = sameLayout ? (this.lastBakedProfile ?? this.profile) : this.profile;
    this.rebuildStaticLayoutShadowsWithProfile(
      layout,
      options,
      staticProfile,
      Number.NEGATIVE_INFINITY,
      preserveVisible,
    );
  }

  /**
   * Rekonstruiert nach bekannten Fels-Aenderungen nur die betroffenen Schatten-Chunks.
   *
   * Die Update-Granularitaet bleibt {@link SHADOW_DIRTY_CHUNK_SIZE} = 128 px. Ein weisser
   * Scratch-Chunk ersetzt den entsprechenden Bereich des residenten Renderziels; dadurch bleiben
   * ueberlappende Nachbarschatten korrekt, ohne alle Felsen neu zu zeichnen.
   */
  rebuildArenaStaticShadowRegions(
    layout: ArenaLayout | null,
    arenaResult: ArenaBuilderResult | null,
    dirtyRockIds: ReadonlySet<number>,
    runtimeRocks: readonly SyncedPlaceableRock[] = [],
  ): void {
    this.characterReceiverDirty = true;
    this.continuousDirty = true;
    if (!layout || !arenaResult || dirtyRockIds.size === 0) return;
    if (this.lastStaticLayout !== layout || !this.staticSurface) {
      this.rebuildArenaStaticShadows(layout, arenaResult, runtimeRocks);
      return;
    }

    this.lastStaticOptions = {
      offsetX: ARENA_OFFSET_X,
      offsetY: ARENA_OFFSET_Y,
      runtimeRocks,
      // Reaktive Map-Objekte teilen den Hindernisraum, werfen aber ihren eigenen Schatten.
      rockVisibilityPredicate: (index) => Boolean(arenaResult.rockPhysicsProxies[index]?.active)
        && !(arenaResult.obstacleIds && isReactivePropObstacleId(arenaResult.obstacleIds, index)),
    };
    const staticProfile = this.lastBakedProfile ?? this.profile;
    this.staticBakeProfile = staticProfile;
    const bounds = this.getStaticWorldBounds();
    for (const chunk of this.collectDirtyShadowChunks(layout, dirtyRockIds, staticProfile)) {
      this.staticSurface.refreshRegion(
        chunk.x - bounds.minX,
        chunk.y - bounds.minY,
        SHADOW_DIRTY_CHUNK_SIZE,
      );
    }
    this.rememberWatchtowerShadowAnchors(runtimeRocks);
  }

  // ── Chunk-Streaming der statischen Bakes ───────────────────────────────────

  private getStaticWorldBounds(): ShadowWorldBounds {
    return this.worldBoundsOverride ?? WORLD_SHADOW_CONFIG.arenaBounds;
  }

  private getStaticFrameRect(): ChunkWorldRect {
    const bounds = this.getStaticWorldBounds();
    return {
      x: bounds.minX,
      y: bounds.minY,
      width: Math.max(1, bounds.maxX - bounds.minX),
      height: Math.max(1, bounds.maxY - bounds.minY),
    };
  }

  /**
   * Erzeugt die Chunk-Flaeche der statischen Schatten, sobald sie gebraucht wird.
   *
   * Die Ebenenmenge und Bucket-IDs folgen den statischen Castern aus `SHADOW_CASTERS`.
   * Der optionale Kronenversuch verschiebt nur seine Ausgabetiefe unter den Bodennebel.
   * Aendern sich Weltgrenzen oder dieser Modus, wird die Flaeche neu aufgebaut.
   */
  private ensureStaticSurface(): { surface: ChunkedRenderSurface; created: boolean } {
    const bounds = this.getStaticWorldBounds();
    const frameKey = `${bounds.minX}:${bounds.minY}:${bounds.maxX}:${bounds.maxY}:${Number(this.canopySources !== null)}:${Number(this.staticContinuous)}`;
    if (this.staticSurface && this.staticSurfaceFrameKey === frameKey) {
      return { surface: this.staticSurface, created: false };
    }

    this.disposeStaticSurface();
    this.staticSurfaceFrameKey = frameKey;

    const layers: ChunkedSurfaceLayerSpec[] = [];
    const seen = this.staticLayerIds;
    seen.clear();
    for (const preset of STATIC_SHADOW_CASTERS) {
      const id = preset.config.layerDepth.toFixed(3);
      // Zwei Caster koennen dieselbe Tiefe teilen; sie landen dann in derselben Ebene.
      if (seen.has(id)) continue;
      // Trees are drawn continuously and need no baked layer; their bucket still exists.
      if (this.staticContinuous && preset.group === 'trees') { this.getLayer(preset.config.layerDepth, preset.group); continue; }
      seen.add(id);
      layers.push({
        id,
        depth: this.canopySources && preset.config === SHADOW_CASTERS.canopy
          ? DEPTH.GROUND_FOG - .02 : preset.config.layerDepth,
        // Die Textur startet deckend weiss, die Footprints tragen ihren eigenen MULTIPLY-Blend
        // hinein. Weiss ist das neutrale Element: ausserhalb der Schatten aendert der Chunk
        // nichts. Normales Alpha-Blending waere hier *nicht* gleichwertig, weil die
        // Schattenfarbe (0x05070b) nicht exakt schwarz ist.
        blend: Phaser.BlendModes.MULTIPLY,
      });
      this.getLayer(preset.config.layerDepth, preset.group);
    }

    const frame = this.getStaticFrameRect();
    this.staticSurface = new ChunkedRenderSurface(this.scene, {
      frame: { offsetX: frame.x, offsetY: frame.y, width: frame.width, height: frame.height },
      layers,
      bake: (region, sink) => this.bakeStaticShadowRegion(region, sink),
    });
    this.staticSurface.setSamplingMode(this.staticSamplingMode);
    this.staticSurface.updateResidency(this.staticResidencyView ?? frame);
    this.staticScratch.preallocate(
      'staticShadow',
      SHADOW_DIRTY_CHUNK_SIZE + this.staticSurface.gutterPx * 2,
    );
    return { surface: this.staticSurface, created: true };
  }

  private disposeStaticSurface(): void {
    this.staticSurface?.destroy();
    this.staticSurface = null;
    this.staticSurfaceFrameKey = '';
  }

  /**
   * Backt die statischen Footprints einer Region.
   *
   * Der Zeichenpuffer wird je Ebene und Region geleert und nur mit den Castern gefuellt, deren
   * Schattenhuelle die Region tatsaechlich beruehrt – genau das haelt die Kosten am sichtbaren
   * Inhalt statt an der Gesamtzahl der Felsen. Der Puffer traegt Weltkoordinaten und wird ueber
   * die Kamera des chunklokalen Scratch-Ziels eingelesen; in das Renderziel des Chunks selbst
   * gelangt danach ausschliesslich die fertige Textur.
   */
  private bakeStaticShadowRegion(region: ChunkBakeRegion, sink: ChunkBakeSink): void {
    const layout = this.lastStaticLayout;
    const profile = this.staticBakeProfile;
    const options = this.lastStaticOptions;
    const offsetX = options.offsetX ?? ARENA_OFFSET_X;
    const offsetY = options.offsetY ?? ARENA_OFFSET_Y;
    const rockVisible = options.rockVisibilityPredicate ?? (() => true);

    const regionBounds: ShadowWorldBounds = {
      minX: region.worldX,
      minY: region.worldY,
      maxX: region.worldX + region.size,
      maxY: region.worldY + region.size,
    };

    // Die Kandidaten werden **einmal je Region** bestimmt, nicht einmal je Ebene: Ein Durchlauf
    // ueber den gesamten Felsbestand mal vier Ebenen mal dutzender Dirty-Chunks war im Trace der
    // groesste Posten des `POST_UPDATE` nach einer Flaechenzerstoerung.
    this.staticRockIndex.sync(layout?.rocks ?? []);
    const reachPx = getMaxStaticShadowReachPx(profile,this.staticSunDirection??WORLD_SHADOW_CONFIG.lightDirection);
    const localX = region.worldX - offsetX;
    const localY = region.worldY - offsetY;
    const rockCandidates = layout && this.staticHasLayout
      ? this.staticRockIndex.collect(localX, localY, region.size, reachPx, this.staticRockCandidates)
      : EMPTY_INDEX_LIST;

    const runtimeById = this.staticRuntimeById;
    runtimeById.clear();
    for (const rock of options.runtimeRocks ?? []) runtimeById.set(rock.id, rock);

    for (const [key, bucket] of this.layers) {
      if (!bucket.group || !this.staticLayerIds.has(key)) continue;
      const depth = Number(key);
      bucket.staticGraphics.clear();

      if (layout && this.staticHasLayout) {
        if (SHADOW_CASTERS.base.layerDepth === depth) {
          for (const cell of this.baseCells.values()) {
            this.drawStaticFootprintInRegion(bucket, cell.x, cell.y, SHADOW_CASTERS.base, regionBounds, profile);
          }
        }
        if (SHADOW_CASTERS.reactiveProp.layerDepth === depth) {
          for (const cell of this.reactivePropCells.values()) {
            this.drawStaticFootprintInRegion(bucket, cell.x, cell.y, SHADOW_CASTERS.reactiveProp, regionBounds, profile);
          }
        }
        const drawsRock = SHADOW_CASTERS.rock.layerDepth === depth;
        const drawsTurret = SHADOW_CASTERS.turret.layerDepth === depth;
        if (drawsRock || drawsTurret) {
          for (const id of rockCandidates) {
            const cell = layout.rocks[id];
            if (!cell || !rockVisible(id)) continue;
            const worldX = offsetX + cell.gridX * CELL_SIZE + CELL_SIZE / 2;
            const worldY = offsetY + cell.gridY * CELL_SIZE + CELL_SIZE / 2;
            const runtime = runtimeById.get(id);
            if (runtime?.kind === 'watchtower') {
              if (drawsRock && runtime.hp > 0 && !this.staticContinuous) {
                this.drawStaticFootprintInRegion(bucket,
                  worldX + WATCHTOWER_SHADOW_FOOTPRINT.centerOffsetX,
                  worldY + WATCHTOWER_SHADOW_FOOTPRINT.centerOffsetY,
                  SHADOW_CASTERS.watchtower, regionBounds, profile);
              }
              continue;
            }
            if (drawsRock && !this.formationShadows?.(id)) {
              this.drawStaticFootprintInRegion(bucket, worldX, worldY, SHADOW_CASTERS.rock, regionBounds, profile);
            }
            if (drawsTurret && runtimeById.get(id)?.kind === 'turret') {
              this.drawStaticFootprintInRegion(bucket, worldX, worldY, SHADOW_CASTERS.turret, regionBounds, profile);
            }
          }
        }
        // Baeume bleiben ungefiltert: Es sind eine Handvoll je World, ein Index waere teurer
        // als der Durchlauf.
        const drawsTrunk = SHADOW_CASTERS.trunk.layerDepth === depth;
        const drawsCanopy = SHADOW_CASTERS.canopy.layerDepth === depth;
        if (drawsTrunk || drawsCanopy) {
          for (const tree of layout.trees) {
            const worldX = offsetX + tree.gridX * CELL_SIZE + CELL_SIZE / 2;
            const worldY = offsetY + tree.gridY * CELL_SIZE + CELL_SIZE / 2;
            if (drawsTrunk) {
              this.drawStaticFootprintInRegion(bucket, worldX, worldY, SHADOW_CASTERS.trunk, regionBounds, profile);
            }
            if (drawsCanopy && !this.canopySources) {
              this.drawStaticFootprintInRegion(bucket, worldX, worldY, SHADOW_CASTERS.canopy, regionBounds, profile);
            }
          }
        }
      }

      const scratch = this.staticScratch.get('staticShadow', region.size);
      scratch.camera.setScroll(region.worldX, region.worldY);
      scratch.clear();
      scratch.fill(0xffffff, 1);
      // draw() rendert das Objekt mit seinem eigenen Blendmode; sichtbar muss es dafuer sein.
      bucket.staticGraphics.setVisible(true);
      scratch.draw(bucket.staticGraphics);
      if (depth === SHADOW_CASTERS.canopy.layerDepth && this.canopySources) {
        this.drawCanopyShadows(scratch, regionBounds, profile);
      }
      scratch.render();
      bucket.staticGraphics.setVisible(false);
      bucket.staticGraphics.clear();

      sink.blit(key, scratch);
    }
  }

  private drawStaticFootprintInRegion(
    bucket: ShadowLayerBucket,
    worldX: number,
    worldY: number,
    preset: ShadowCasterConfig,
    region: ShadowWorldBounds,
    profile: ShadowProfile,
  ): void {
    const bounds = this.getShadowBounds(worldX, worldY, preset, profile);
    if (bounds.maxX <= region.minX || bounds.minX >= region.maxX
      || bounds.maxY <= region.minY || bounds.minY >= region.maxY) {
      return;
    }
    this.drawFootprint(bucket.staticGraphics, worldX, worldY, preset, undefined, undefined, profile,this.staticSunDirection??WORLD_SHADOW_CONFIG.lightDirection);
  }

  private drawCanopyShadows(scratch: Phaser.GameObjects.RenderTexture, region: ShadowWorldBounds, profile: ShadowProfile): void {
    const sources = this.canopySources;
    if (!sources?.length) return;
    // Height is an artistic tree-height estimate. This approximation receives on
    // ground only: the baked layer is below ground fog and opaque rock surfaces.
    // It does not cast height-correct canopy shadows onto raised rock receivers.
    const woodland = this.canopyWoodland;
    const tuning = SUN_FOREST_SHADOW;
    const direction = woodland ? Math.SQRT1_2 : .75;
    for (const source of sources) {
      const { distance, softness, scale, opacity } = this.canopyShadowShape(source, profile);
      const x = source.worldX + distance * (this.staticSunDirection?.x??direction), y = source.worldY + distance * (this.staticSunDirection?.y??direction);
      const radius = Math.hypot(source.gfx.displayWidth, source.gfx.displayHeight) * .5 * scale + softness;
      if (x + radius < region.minX || y + radius < region.minY || x - radius > region.maxX || y - radius > region.maxY) continue;
      for (const tap of CANOPY_SHADOW_KERNEL) {
        // Phaser 4's DynamicTextureHandler renders STAMP through the drawing camera.
        // Keep world coordinates, like the Graphics draw above. Commands snapshot poses.
        scratch.stamp(source.gfx.texture.key, source.gfx.frame.name, x + tap.x * softness, y + tap.y * softness, {
          scaleX: source.gfx.scaleX * scale, scaleY: source.gfx.scaleY * scale, rotation: source.gfx.rotation,
          tint: woodland ? tuning.color : WORLD_SHADOW_CONFIG.color, alpha: 1 - Math.pow(1 - opacity, tap.weight),
          blendMode: Phaser.BlendModes.MULTIPLY,
        });
      }
    }
  }

  private collectDirtyShadowChunks(
    layout: ArenaLayout,
    dirtyRockIds: ReadonlySet<number>,
    profile: ShadowProfile,
  ): ShadowDirtyChunk[] {
    const bounds = this.worldBoundsOverride ?? WORLD_SHADOW_CONFIG.arenaBounds;
    const chunks = new Map<string, ShadowDirtyChunk>();
    for (const id of dirtyRockIds) {
      const current = layout.rocks[id];
      const previousTower = this.watchtowerShadowAnchors.get(id);
      const isTower = previousTower || this.lastStaticOptions.runtimeRocks?.some(rock => rock.id === id && rock.kind === 'watchtower');
      for (const cell of [current, previousTower]) {
        if (!cell) continue;
        const x = ARENA_OFFSET_X + cell.gridX * CELL_SIZE + CELL_SIZE / 2;
        const y = ARENA_OFFSET_Y + cell.gridY * CELL_SIZE + CELL_SIZE / 2;
        const presets = isTower ? [SHADOW_CASTERS.rock, SHADOW_CASTERS.watchtower] : [SHADOW_CASTERS.rock, SHADOW_CASTERS.turret];
        for (const preset of presets) {
          const tower = preset === SHADOW_CASTERS.watchtower;
          const casterBounds = this.getShadowBounds(
            x + (tower ? WATCHTOWER_SHADOW_FOOTPRINT.centerOffsetX : 0),
            y + (tower ? WATCHTOWER_SHADOW_FOOTPRINT.centerOffsetY : 0), preset, profile);
          const minChunkX = Math.floor((Math.max(bounds.minX, casterBounds.minX) - bounds.minX) / SHADOW_DIRTY_CHUNK_SIZE);
          const minChunkY = Math.floor((Math.max(bounds.minY, casterBounds.minY) - bounds.minY) / SHADOW_DIRTY_CHUNK_SIZE);
          const maxChunkX = Math.floor((Math.min(bounds.maxX - 1, casterBounds.maxX) - bounds.minX) / SHADOW_DIRTY_CHUNK_SIZE);
          const maxChunkY = Math.floor((Math.min(bounds.maxY - 1, casterBounds.maxY) - bounds.minY) / SHADOW_DIRTY_CHUNK_SIZE);
          for (let cy = minChunkY; cy <= maxChunkY; cy += 1) {
            for (let cx = minChunkX; cx <= maxChunkX; cx += 1) {
              const chunkX = bounds.minX + cx * SHADOW_DIRTY_CHUNK_SIZE;
              const chunkY = bounds.minY + cy * SHADOW_DIRTY_CHUNK_SIZE;
              chunks.set(`${chunkX}:${chunkY}`, { x: chunkX, y: chunkY });
            }
          }
        }
      }
    }
    return [...chunks.values()];
  }

  private getShadowBounds(
    x: number,
    y: number,
    preset: ShadowCasterConfig,
    profile: ShadowProfile,
  ): ShadowWorldBounds {
    const castLength = preset.castHeightPx * preset.stretch * profile.lengthMult;
    const softness = preset.softnessPx * profile.softnessMult;
    const inflate = preset.inflatePx + softness;
    const radius = Math.max(
      preset.footprintWidthPx + inflate * 2,
      preset.footprintHeightPx + inflate * 2,
    ) * 0.5;
    const offset = (preset.airborneHeightPx ?? 0) + castLength;
    const direction=this.staticSunDirection??WORLD_SHADOW_CONFIG.lightDirection;
    const dx = direction.x * offset;
    const dy = direction.y * offset;
    return {
      minX: Math.min(x, x + dx) - radius,
      minY: Math.min(y, y + dy) - radius,
      maxX: Math.max(x, x + dx) + radius,
      maxY: Math.max(y, y + dy) + radius,
    };
  }

  syncDynamicShadows(
    players: readonly PlayerEntity[],
    projectiles: readonly ShadowProjectileSample[],
    train: SyncedTrainState | null,
  ): void {
    this.syncContinuousStaticShadows();
    this.clearDynamic();
    const characterShadows = this.syncCharacterShadows(players);
    let primitivesBuilt = this.characterShadows?.activeCount ?? 0;

    for (const player of players) {
      if (characterShadows || this.characterSuppressed || !this.dynamicVisible) break;
      const sprite = player.displayObject;
      if (!sprite || !sprite.active || !sprite.visible || sprite.alpha <= 0 || !sprite.scaleX || !sprite.scaleY) continue;
      if (player.isDecoyStealthedVisual()) continue;
      const burrowPhase = player.getBurrowPhase();
      if (burrowPhase === 'underground' || burrowPhase === 'trapped') continue;

      primitivesBuilt += this.drawFootprint(
        this.getLayer(SHADOW_CASTERS.player.layerDepth).dynamicGraphics,
        sprite.x,
        sprite.y,
        SHADOW_CASTERS.player,
        SHADOW_CASTERS.player.footprintWidthPx * Math.abs(sprite.scaleX || 1),
        SHADOW_CASTERS.player.footprintHeightPx * Math.abs(sprite.scaleY || 1),
      );
    }

    this.enemyShadowSources.length = 0;
    this.sunEnemies?.forEachEnemy(this.collectShadowEnemy);
    // Create the World-owned renderer even without live enemies. Its shader probes must join
    // the existing loading barrier before Ready, not wake it on the first gameplay spawn.
    if (this.characterShadows && this.characterClouds && this.quality.level !== 'low' && !this.enemyMeshesSuppressed) {
      this.enemyShadows ??= new EnemyMeshShadowRenderer(this.scene, this.characterClouds,
        this.characterShadows.receiver, this.quality.level === 'high' ? 64 : 48);
      this.enemyShadows.setDebugSolid(this.characterSolid);
      this.enemyShadows.sync(this.enemyShadowSources, this.dynamicVisible);
    } else this.enemyShadows?.setVisible(false);
    this.enemyPrimitives = 0; this.enemyCasters = 0;
    if (this.sunDirection) for (const enemy of this.enemyShadowSources) this.drawSunEnemy(enemy);
    const meshEnemies = this.enemyShadows?.activeCount ?? 0;
    primitivesBuilt += this.enemyPrimitives + meshEnemies;

    // Low retains figure ellipses; other moving casters remain disabled.
    if (!this.quality.dynamicShadows) {
      const collector = this.attributionCollector;
      if (collector?.isActive()) collector.setGraphicsGauge('dynamicShadows', {
        objectCount: this.layers.size, activeObjects: primitivesBuilt > 0 ? players.length : 0,
        dynamicCasterCount: primitivesBuilt > 0 ? players.length : 0, primitiveCount: primitivesBuilt,
      });
      return;
    }

    for (const projectile of projectiles) {
      if (!this.quality.projectileShadows) break;
      const preset = getProjectileShadowConfig(projectile.style);
      if (!preset?.enabled) continue;

      const sizeScale = Phaser.Math.Clamp(projectile.size / 18, 0.75, 1.45);
      primitivesBuilt += this.drawFootprint(
        this.getLayer(preset.layerDepth).dynamicGraphics,
        projectile.x,
        projectile.y,
        preset,
        preset.footprintWidthPx * sizeScale,
        preset.footprintHeightPx * sizeScale,
      );
    }

    if (train?.alive) {
      primitivesBuilt += this.drawTrainShadow(train);
    }
    const collector = this.attributionCollector;
    if (collector?.isActive()) {
      const dynamicCasterCount = players.length + projectiles.length + (train?.alive ? 1 : 0) + this.enemyCasters + meshEnemies;
      collector.setGraphicsGauge('dynamicShadows', {
        objectCount: this.layers.size + (this.characterShadows?.count ?? 0) + (this.enemyShadows ? 1 : 0),
        activeObjects: dynamicCasterCount,
        dynamicCasterCount,
        primitiveCount: primitivesBuilt,
      });
      collector.recordGraphicsWork('dynamicShadows', {
        redraws: dynamicCasterCount > 0 ? 1 : 0,
        primitivesBuilt,
        maxDynamicPrimitivesPerFrame: primitivesBuilt,
      });
    }
  }

  clear(): void {
    this.setCharacterSunlight(null); this.characterSuppressed = false; this.characterSolid = false;
    this.sunEnemies = null; this.enemyShadowSources.length = 0; this.enemyMeshesSuppressed = false;
    this.sunDirection=null;this.staticSunDirection=null;this.sunAzimuth=null;this.bakedAzimuth=null;
    this.formationShadows = null;
    this.canopySources = null;
    this.canopyWoodland = false;
    this.clearStatic();
    this.clearDynamic();
    this.shadowsVisible = true;
    this.staticSamplingMode = 'default';
    this.setDynamicVisible(true);
    this.lastStaticLayout = null;
    this.lastStaticOptions = {};
    this.lastBakedProfile = null;
    this.lastStaticProfileBakeAtMs = Number.NEGATIVE_INFINITY;
  }

  destroy(): void {
    this.setCharacterSunlight(null);
    this.sunEnemies = null;
    this.sunDirection=null;this.staticSunDirection=null;this.sunAzimuth=null;this.bakedAzimuth=null;
    this.formationShadows = null;
    this.canopySources = null;
    this.canopyWoodland = false;
    this.baseCells.clear();
    this.seenBaseCells.clear();
    this.reactivePropCells.clear();
    for (const bucket of this.layers.values()) {
      bucket.staticGraphics.destroy();
      bucket.dynamicGraphics.destroy();
      bucket.continuousGraphics.destroy();
    }
    this.layers.clear();
    this.trunkStamp?.destroy();
    this.trunkStamp = null;
    this.staticContinuous = false;
    this.syncCanopyMasks();
    this.continuousCanopyShown = 0;
    this.disposeStaticSurface();
    this.staticScratch.destroy();
    this.unsubscribeQuality?.();
    this.unsubscribeQuality = null;
    this.lastStaticLayout = null;
    this.lastStaticOptions = {};
    this.lastBakedProfile = null;
    this.lastStaticProfileBakeAtMs = Number.NEGATIVE_INFINITY;
  }

  /**
   * Leert Zeichenpuffer **und** gebackene Chunks. Beides muss zusammen passieren: Den Puffer
   * allein zu leeren liesse die gebackenen Schatten stehen – sie ueberlebten dann den
   * Arena-Teardown und blieben als Raster in der Lobby sichtbar.
   */
  private clearStatic(): void {
    this.watchtowerShadowAnchors.clear();
    this.baseCells.clear();
    this.seenBaseCells.clear();
    this.reactivePropCells.clear();
    for (const bucket of this.layers.values()) bucket.staticGraphics.clear();
    this.staticHasLayout = false;
    this.hideContinuousStaticShadows();
    // Verwerfen statt Weisszeichnen: Ohne Layout gibt es nichts zu backen, und die Renderziele
    // waeren nur ein neutraler Vollflaechen-Blendpass pro Frame.
    this.disposeStaticSurface();
  }

  private clearDynamic(): void {
    this.characterShadows?.setVisible(false);
    this.enemyShadows?.setVisible(false);
    for (const bucket of this.layers.values()) {
      bucket.dynamicGraphics.clear();
    }
  }

  private drawTrainShadow(train: SyncedTrainState): number {
    const locoPreset = SHADOW_CASTERS.trainLoco;
    const wagonPreset = SHADOW_CASTERS.trainWagon;
    const yPositions = this.computeTrainSegmentYs(train.y, train.dir);

    let primitivesBuilt = this.drawFootprint(
      this.getLayer(locoPreset.layerDepth).dynamicGraphics,
      train.x,
      yPositions[0],
      locoPreset,
      locoPreset.footprintWidthPx,
      locoPreset.footprintHeightPx,
    );

    for (let index = 1; index < yPositions.length; index += 1) {
      primitivesBuilt += this.drawFootprint(
        this.getLayer(wagonPreset.layerDepth).dynamicGraphics,
        train.x,
        yPositions[index],
        wagonPreset,
        wagonPreset.footprintWidthPx,
        wagonPreset.footprintHeightPx,
      );
    }
    return primitivesBuilt;
  }

  private computeTrainSegmentYs(locoY: number, direction: 1 | -1): number[] {
    // Avoid new Array().fill() — all wagon heights are identical (WAGON_HEIGHT).
    const ys: number[] = [locoY];
    let previousY = locoY;

    // Loco → first wagon
    const firstGap = TRAIN.LOCO_HEIGHT / 2 + TRAIN.SEGMENT_GAP + TRAIN.WAGON_HEIGHT / 2;
    previousY -= direction * firstGap;
    ys.push(previousY);

    // Remaining wagons (wagon → wagon gap is constant)
    const wagonGap = TRAIN.WAGON_HEIGHT + TRAIN.SEGMENT_GAP;
    for (let index = 1; index < TRAIN.WAGON_COUNT; index += 1) {
      previousY -= direction * wagonGap;
      ys.push(previousY);
    }

    return ys;
  }

  private drawFootprint(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    preset: ShadowCasterConfig,
    width = preset.footprintWidthPx,
    height = preset.footprintHeightPx,
    profile = this.profile,
    direction = this.sunDirection??WORLD_SHADOW_CONFIG.lightDirection,
  ): number {
    // Profil-Multiplikatoren (Tag/Nacht) skalieren Länge, Deckkraft und Weichheit;
    // The sun path supplies the direction without mutating WORLD_SHADOW_CONFIG.
    const castLength = preset.castHeightPx * preset.stretch * profile.lengthMult;
    const softnessPx = preset.softnessPx * profile.softnessMult;

    const maxExtent = Math.max(width, height) * 0.5
      + (preset.airborneHeightPx ?? 0)
      + castLength
      + softnessPx
      + 16;
    if (!this.isVisibleInArena(x, y, maxExtent)) return 0;

    const steps = Math.max(1, Math.round(preset.blurLayers * this.quality.shadowLayerFactor));
    const denominator = Math.max(1, steps - 1);
    const dir = direction;
    const airborneHeight = preset.airborneHeightPx ?? 0;

    // Fixed directional offset for all layers.
    const offsetScale = airborneHeight + castLength;
    const dx = dir.x * offsetScale;
    const dy = dir.y * offsetScale;
    const drawX = x + dx;
    const drawY = y + dy;

    for (let step = steps - 1; step >= 0; step -= 1) {
      const t = step / denominator;
      const inflate = preset.inflatePx + softnessPx * t;
      const alpha = preset.opacity * profile.opacityMult * (1 - t * 0.88) / steps;
      const drawWidth = Math.max(1, width + inflate * 2);
      const drawHeight = Math.max(1, height + inflate * 2);

      // Grounded casters use projection shapes (convex hull of source + shadow)
      // so the shadow reads as a single directional form rather than a detached copy.
      // Airborne casters keep the simple offset shape since the gap is intentional.
      if (airborneHeight === 0 && preset.shape === 'cell') {
        this.fillCellProjection(graphics, x, y, drawWidth, drawHeight, dx, dy, alpha);
      } else if (airborneHeight === 0 && (preset.shape === 'circle' || preset.shape === 'ellipse')) {
        const radius = Math.max(drawWidth, drawHeight) * 0.5;
        this.fillStadiumShadow(graphics, x, y, radius, dx, dy, alpha);
      } else {
        this.fillShape(graphics, preset.shape, drawX, drawY, drawWidth, drawHeight, alpha);
      }
    }
    return steps;
  }

  /** The layers {@link drawFootprint} would draw for a grounded circular caster, outermost first. */
  private trunkStampShape(preset: ShadowCasterConfig, profile: ShadowProfile, direction: { x: number; y: number }):
    { layers: TrunkShadowLayer[]; dx: number; dy: number; maxExtent: number } {
    const castLength = preset.castHeightPx * preset.stretch * profile.lengthMult;
    const softnessPx = preset.softnessPx * profile.softnessMult;
    const width = preset.footprintWidthPx, height = preset.footprintHeightPx, airborne = preset.airborneHeightPx ?? 0;
    const steps = Math.max(1, Math.round(preset.blurLayers * this.quality.shadowLayerFactor));
    const denominator = Math.max(1, steps - 1), layers: TrunkShadowLayer[] = [];
    for (let step = steps - 1; step >= 0; step -= 1) {
      const t = step / denominator, inflate = preset.inflatePx + softnessPx * t;
      layers.push({ radius: Math.max(Math.max(1, width + inflate * 2), Math.max(1, height + inflate * 2)) * 0.5,
        alpha: preset.opacity * profile.opacityMult * (1 - t * 0.88) / steps });
    }
    return { layers, dx: direction.x * (airborne + castLength), dy: direction.y * (airborne + castLength),
      maxExtent: Math.max(width, height) * 0.5 + airborne + castLength + softnessPx + 16 };
  }

  // Draws the convex hull of two circles as a single closed polygon (stadium).
  // Uses pre-computed arc tables (no trig per call) and a reusable point buffer
  // (no allocations per call) for zero GC pressure on the hot dynamic path.
  private fillStadiumShadow(
    graphics: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    radius: number,
    dx: number,
    dy: number,
    alpha: number,
  ): void {
    graphics.fillStyle(WORLD_SHADOW_CONFIG.color, alpha);
    if (dx * dx + dy * dy < 0.25) {
      graphics.fillCircle(cx, cy, radius);
      return;
    }

    const pts = this.stadiumPts;
    const N = STADIUM_ARC_N;
    // Rotate the already computed arcs for the sun path. Normalizing the actual offset
    // also handles the quantized static direction without per-frame trig tables.
    let turnC=1,turnS=0;
    const rotating=!!(this.sunDirection || this.staticSunDirection);
    if(rotating) {
      const length=Math.hypot(dx,dy),c=STADIUM_DIRECTION_COS,s=STADIUM_DIRECTION_SIN;
      turnC=(dx*c+dy*s)/length;turnS=(dy*c-dx*s)/length;
    }
    // Back cap — source semicircle (pre-computed angles, no trig here)
    for (let i = 0; i <= N; i++) {
      const arc = STADIUM_BACK_ARC[i];
      pts[i].x = cx + (rotating?arc.cos*turnC-arc.sin*turnS:arc.cos) * radius;
      pts[i].y = cy + (rotating?arc.sin*turnC+arc.cos*turnS:arc.sin) * radius;
    }
    // Front cap — shadow semicircle
    for (let i = 0; i <= N; i++) {
      const arc = STADIUM_FRONT_ARC[i];
      pts[N + 1 + i].x = cx + dx + (rotating?arc.cos*turnC-arc.sin*turnS:arc.cos) * radius;
      pts[N + 1 + i].y = cy + dy + (rotating?arc.sin*turnC+arc.cos*turnS:arc.sin) * radius;
    }

    graphics.fillPoints(pts, true);
  }

  // Draws the convex hull of the source rect (at cx,cy) and the shadow rect
  // (at cx+dx, cy+dy), both with the given width/height. For a diagonal offset
  // this produces a hexagon that looks like a natural directional shadow rather
  // than two perpendicular 90° strips sticking out from under the caster.
  private fillCellProjection(
    graphics: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    width: number,
    height: number,
    dx: number,
    dy: number,
    alpha: number,
  ): void {
    const hw = width / 2;
    const hh = height / 2;

    // Convex hull of source rect (at cx,cy) and shadow rect (at cx+dx, cy+dy).
    // lightDirection is always {x>0, y>0}, so the shadow goes bottom-right and
    // the hull is always this clockwise hexagon:
    //   source-TL → source-TR → shadow-TR → shadow-BR → shadow-BL → source-BL
    const p = this.cellPts;
    if(this.sunDirection || this.staticSunDirection) {
      writeShadowCellHull(p,cx,cy,width,height,dx,dy);
      graphics.fillStyle(WORLD_SHADOW_CONFIG.color,alpha);graphics.fillPoints(p,true);return;
    }
    p[0].x = cx - hw;      p[0].y = cy - hh;        // source TL
    p[1].x = cx + hw;      p[1].y = cy - hh;        // source TR
    p[2].x = cx + hw + dx; p[2].y = cy - hh + dy;   // shadow TR
    p[3].x = cx + hw + dx; p[3].y = cy + hh + dy;   // shadow BR
    p[4].x = cx - hw + dx; p[4].y = cy + hh + dy;   // shadow BL
    p[5].x = cx - hw;      p[5].y = cy + hh;        // source BL

    graphics.fillStyle(WORLD_SHADOW_CONFIG.color, alpha);
    graphics.fillPoints(p, true);
  }

  private fillShape(
    graphics: Phaser.GameObjects.Graphics,
    shape: ShadowCasterConfig['shape'],
    x: number,
    y: number,
    width: number,
    height: number,
    alpha: number,
  ): void {
    graphics.fillStyle(WORLD_SHADOW_CONFIG.color, alpha);

    switch (shape) {
      case 'cell':
        graphics.fillRect(x - width / 2, y - height / 2, width, height);
        return;
      case 'circle':
        graphics.fillCircle(x, y, Math.max(width, height) * 0.5);
        return;
      case 'capsule': {
        const radius = Math.min(width, height) * 0.46;
        graphics.fillRoundedRect(x - width / 2, y - height / 2, width, height, radius);
        return;
      }
      case 'ellipse':
      default:
        graphics.fillEllipse(x, y, width, height);
    }
  }

  private getLayer(depth: number, group: StaticShadowGroup | null = null): ShadowLayerBucket {
    const key = depth.toFixed(3);
    const existing = this.layers.get(key);
    if (existing) {
      if (group) existing.group = group;
      return existing;
    }

    // Der statische Puffer wird gebacken und nie selbst gerendert: keine Maske noetig, die
    // traegt stattdessen die RenderTexture.
    const staticGraphics = this.scene.add.graphics();
    registerGraphicsObject(this.scene, 'dynamicShadows', staticGraphics);
    staticGraphics.setDepth(depth);
    staticGraphics.setBlendMode(Phaser.BlendModes.MULTIPLY);
    staticGraphics.setVisible(false);

    const dynamicGraphics = this.scene.add.graphics();
    registerGraphicsObject(this.scene, 'dynamicShadows', dynamicGraphics);
    dynamicGraphics.setDepth(depth + 0.001);
    dynamicGraphics.setBlendMode(Phaser.BlendModes.MULTIPLY);

    // Takes the place of the baked chunk image for continuous casters, at the same depth.
    const continuousGraphics = this.scene.add.graphics();
    registerGraphicsObject(this.scene, 'dynamicShadows', continuousGraphics);
    continuousGraphics.setDepth(depth);
    continuousGraphics.setBlendMode(Phaser.BlendModes.MULTIPLY);

    const bucket: ShadowLayerBucket = { staticGraphics, dynamicGraphics, continuousGraphics, group };
    this.layers.set(key, bucket);
    return bucket;
  }

  /** Startup work for the static-shadow working set. */
  getStaticSurfaceWorkingSet(
    view: ChunkWorldRect,
    includePrefetch = true,
  ): ChunkedRenderWorkingSet | null {
    if (!this.staticHasLayout || !this.staticSurface) return null;
    return this.staticSurface.getWorkingSet(view, includePrefetch);
  }

  private isVisibleInArena(x: number, y: number, margin: number): boolean {
    const bounds = this.worldBoundsOverride ?? WORLD_SHADOW_CONFIG.arenaBounds;
    return x + margin >= bounds.minX
      && x - margin <= bounds.maxX
      && y + margin >= bounds.minY
      && y - margin <= bounds.maxY;
  }
}

function hasRelevantStaticProfileChange(from: ShadowProfile, to: ShadowProfile): boolean {
  return Math.abs(from.opacityMult - to.opacityMult) >= STATIC_PROFILE_OPACITY_DELTA
    || Math.abs(from.lengthMult - to.lengthMult) >= STATIC_PROFILE_LENGTH_DELTA
    || Math.abs(from.softnessMult - to.softnessMult) >= STATIC_PROFILE_SOFTNESS_DELTA;
}
