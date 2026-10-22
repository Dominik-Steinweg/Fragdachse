import * as Phaser from 'phaser';
import { DEPTH, DEPTH_LIGHTING, VOID_PALETTE } from '../../config';
import { getSpawnStructureRotation } from '../../config/spawnStructure';
import { resolveDawnSitePropHitFlash, type DawnSitePropHitFlash } from '../../arena/DawnSitePropModel';
import type { LightingSystem } from '../LightingSystem';
import {
  SPAWN_STRUCTURE_BUILDING, SPAWN_STRUCTURE_PIT, SPAWN_STRUCTURE_TEXTURES, spawnPitFrame, spawnStructureBuildingFrame,
  spawnStructureCoreOffset,
} from './SpawnStructureAssets';
import {
  phaseOf, resolveSpawnEmergencePhase, resolveSpawnPitState, resolveSpawnStructureBuildingState, resolveSpawnStructureGlow,
  type SpawnEmergence, type SpawnStructureView,
} from './SpawnStructureModel';
import { BROOD_PIT_SWELLS, BroodPitGpuLayer, type BroodPitSwell } from '../gpu/BroodPitGpuLayer';

export type SpawnStructureLightingPort = Pick<LightingSystem, 'setLight' | 'releaseLight' | 'getArtificialLightFactor'>;

/** One wall cell as a shadow caster; stable identity, so the shadow cache only invalidates on change. */
export interface SpawnStructureShadowCell {
  readonly x: number;
  readonly y: number;
  active: boolean;
  readonly visible: boolean;
}

const HIT_FLASH_TINT = 0x5a3a6a;
/** Emissive passes keep a visible floor by day; the night carries their full strength. */
const EMISSIVE_DAY_FLOOR = 0.4;
/** The nest's light on the inner flank stays faint by day. */
const RIM_DAY_FLOOR = 0.3;
/** The animated pool surface: quad half size (room for the droplets) and pool radius, px. */
const POOL_QUAD_HALF_PX = 52;
const POOL_RADIUS_PX = 21;
const PIT_STATE_CODE = { sealed: 0, active: 1, dry: 2 } as const;

interface StructureVisual {
  readonly pit: Phaser.GameObjects.Image;
  readonly shimmer: Phaser.GameObjects.Image;
  readonly body: Phaser.GameObjects.Image;
  readonly rim: Phaser.GameObjects.Image;
  readonly veins: Phaser.GameObjects.Image;
  readonly core: Phaser.GameObjects.Image;
  readonly shadows: readonly SpawnStructureShadowCell[];
  flash?: DawnSitePropHitFlash;
  hpRevision: number;
}

/**
 * Presentation owner of every hostile spawn structure (GDD Spawnbauwerk V1), in every mode: the
 * Brutkadaver over the hitbox cells and the brood nest with its creep stain inside the curl, both
 * from one painted asset family turned toward the outlet. Nothing here borrows the portal look.
 * World-owned through BaseManager; Activity inputs (announced releases) are pushed in.
 */
export class SpawnStructureRenderer {
  private readonly visuals = new Map<string, StructureVisual>();
  private readonly lightKeys = new Set<string>();
  private lighting: SpawnStructureLightingPort | null = null;
  private charge: ((id: string, nowMs: number) => number) | null = null;
  private readonly emergences = new Map<string, SpawnEmergence[]>();
  private readonly pool: BroodPitGpuLayer;
  private readonly swells: BroodPitSwell[] = [];
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene) {
    this.pool = new BroodPitGpuLayer(scene);
  }

  /** A body created underground in this structure's pit starts to rise (pit-local px offset). */
  addEmergence(structureId: string, enemyId: string, x: number, y: number, nowMs: number): void {
    const list = this.emergences.get(structureId) ?? [];
    list.push({ enemyId, x, y, claimedAt: nowMs, surfacedAt: null });
    this.emergences.set(structureId, list);
  }

  /** The body broke the surface: the ooze parts and closes behind it. */
  surfaceEmergence(enemyId: string, nowMs: number): void {
    for (const list of this.emergences.values()) {
      const emergence = list.find((entry) => entry.enemyId === enemyId && entry.surfacedAt === null);
      if (emergence) { emergence.surfacedAt = nowMs; return; }
    }
  }

  /** The body vanished underground (died, despawned): its swell sinks without a splash. */
  releaseEmergence(enemyId: string): void {
    for (const [id, list] of this.emergences) {
      const next = list.filter((entry) => entry.enemyId !== enemyId || entry.surfacedAt !== null);
      if (next.length !== list.length) this.emergences.set(id, next);
    }
  }

  clearEmergences(): void { this.emergences.clear(); }

  setLighting(lighting: SpawnStructureLightingPort | null): void {
    if (this.lighting && this.lighting !== lighting) this.releaseLights();
    this.lighting = lighting;
  }

  /** Activity input: announced release of a structure, 0 (none) to 1 (enemies rise now). */
  setChargeProvider(charge: ((id: string, nowMs: number) => number) | null): void {
    this.charge = charge;
  }

  sync(views: readonly SpawnStructureView[], nowMs: number): void {
    if (this.destroyed) return;
    if (!this.texturesReady()) return;
    const night = this.lighting?.getArtificialLightFactor() ?? 1;
    const emissive = Math.max(EMISSIVE_DAY_FLOOR, night);
    const seenLights = new Set<string>();
    this.pool.begin(nowMs);
    for (const view of views) {
      const visual = this.visuals.get(view.id) ?? this.create(view);
      const frame = spawnStructureBuildingFrame(resolveSpawnStructureBuildingState(view));
      const turn = getSpawnStructureRotation(view.outlet);
      for (const part of [visual.body, visual.rim, visual.veins, visual.core]) part.setFrame(frame).setPosition(view.x, view.y).setRotation(turn);
      const pitFrame = spawnPitFrame(resolveSpawnPitState(view));
      visual.pit.setFrame(pitFrame).setPosition(view.x, view.y).setRotation(turn);
      visual.shimmer.setFrame(pitFrame).setPosition(view.x, view.y).setRotation(turn);
      for (const cell of visual.shadows) cell.active = !view.destroyed;

      if (visual.hpRevision !== view.hpRevision) { visual.flash = undefined; visual.hpRevision = view.hpRevision; }
      visual.flash = resolveDawnSitePropHitFlash(visual.flash, view.destroyed ? null : view.hp, nowMs);
      if (visual.flash.active) visual.body.setTint(HIT_FLASH_TINT).setTintMode(Phaser.TintModes.ADD);
      else visual.body.clearTint();

      const charge = this.charge?.(view.id, nowMs) ?? 0;
      const glow = resolveSpawnStructureGlow(view, nowMs, charge);
      this.pool.add({ x: view.x, y: view.y, halfSize: POOL_QUAD_HALF_PX, radius: POOL_RADIUS_PX, charge,
        state: PIT_STATE_CODE[resolveSpawnPitState(view)], seed: phaseOf(view.id) / 6.283, swells: this.resolveSwells(view.id, nowMs) });
      visual.rim.setTint(VOID_PALETTE.primary).setAlpha(glow.rim * Math.max(RIM_DAY_FLOOR, night));
      visual.veins.setTint(VOID_PALETTE.primary).setAlpha(glow.veins * emissive);
      visual.core.setTint(VOID_PALETTE.bright).setAlpha(glow.core * emissive);
      visual.shimmer.setTint(VOID_PALETTE.primary).setAlpha(glow.pit * emissive);
      if (this.lighting && glow.lightIntensity > 0) {
        const key = `spawn-structure:${view.id}`;
        const heart = spawnStructureCoreOffset(view.outlet);
        // Between heart and pit: the light reads as coming from the structure's open centre.
        this.lighting.setLight(key, 'broodPit', view.x + heart.x * 0.5, view.y + heart.y * 0.5,
          { radiusPx: glow.lightRadiusPx, intensity: glow.lightIntensity });
        this.lightKeys.add(key);
        seenLights.add(key);
      }
    }
    this.pool.flush();
    for (const key of this.lightKeys) {
      if (seenLights.has(key)) continue;
      this.lighting?.releaseLight(key);
      this.lightKeys.delete(key);
    }
  }

  /** Current swells of one pit, newest last; finished ones are dropped. */
  private resolveSwells(structureId: string, nowMs: number): readonly BroodPitSwell[] {
    const list = this.emergences.get(structureId);
    this.swells.length = 0;
    if (!list?.length) return this.swells;
    const alive = list.filter((entry) => resolveSpawnEmergencePhase(entry, nowMs) !== null);
    if (alive.length !== list.length) this.emergences.set(structureId, alive);
    for (const entry of alive.slice(-BROOD_PIT_SWELLS)) {
      this.swells.push({ x: entry.x, y: entry.y, t: resolveSpawnEmergencePhase(entry, nowMs)! });
    }
    return this.swells;
  }

  getShadowCells(): Iterable<SpawnStructureShadowCell> {
    const visuals = this.visuals;
    return (function* () { for (const visual of visuals.values()) yield* visual.shadows; })();
  }

  /** The building silhouette parts the ground fog like the other structures. */
  getFogSurfaces(): Iterable<Phaser.GameObjects.Image> {
    const visuals = this.visuals;
    return (function* () { for (const visual of visuals.values()) if (visual.body.visible) yield visual.body; })();
  }

  releaseLights(): void {
    for (const key of this.lightKeys) this.lighting?.releaseLight(key, { immediate: true });
    this.lightKeys.clear();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.releaseLights();
    this.pool.destroy();
    this.emergences.clear();
    for (const visual of this.visuals.values()) {
      for (const part of [visual.pit, visual.shimmer, visual.body, visual.rim, visual.veins, visual.core]) part.destroy();
    }
    this.visuals.clear();
  }

  private texturesReady(): boolean {
    return Object.values(SPAWN_STRUCTURE_TEXTURES).every((key) => this.scene.textures.exists(key));
  }

  private create(view: SpawnStructureView): StructureVisual {
    const image = (key: string, size: number) => this.scene.add.image(view.x, view.y, key, 0).setOrigin(0.5).setDisplaySize(size, size);
    const buildingSize = SPAWN_STRUCTURE_BUILDING.displaySize;
    const pitSize = SPAWN_STRUCTURE_PIT.displaySize;
    // The nest and its creep stain lie on the foundation layer, under the carcass.
    const basin = this.scene.add.image(view.x, view.y, SPAWN_STRUCTURE_TEXTURES.pit, 0).setDisplaySize(pitSize, pitSize)
      .setDepth(DEPTH.BASE_GROUNDING + 0.1);
    const body = this.scene.add.image(view.x, view.y, SPAWN_STRUCTURE_TEXTURES.building, 0).setDisplaySize(buildingSize, buildingSize)
      .setDepth(DEPTH.BASES);
    // Emissive passes above the light map, like the other structure emissions.
    const shimmer = image(SPAWN_STRUCTURE_TEXTURES.pitGlow, pitSize).setDepth(DEPTH_LIGHTING + 0.08).setBlendMode(Phaser.BlendModes.ADD);
    const rim = image(SPAWN_STRUCTURE_TEXTURES.rim, buildingSize).setDepth(DEPTH_LIGHTING + 0.08).setBlendMode(Phaser.BlendModes.ADD);
    const veins = image(SPAWN_STRUCTURE_TEXTURES.veins, buildingSize).setDepth(DEPTH_LIGHTING + 0.08).setBlendMode(Phaser.BlendModes.ADD);
    const core = image(SPAWN_STRUCTURE_TEXTURES.core, buildingSize).setDepth(DEPTH_LIGHTING + 0.08).setBlendMode(Phaser.BlendModes.ADD);
    const visual: StructureVisual = {
      pit: basin, shimmer, body, rim, veins, core,
      shadows: view.wallCells.map(({ x, y }) => ({ x, y, active: true, visible: true })),
      hpRevision: view.hpRevision,
    };
    this.visuals.set(view.id, visual);
    return visual;
  }
}
