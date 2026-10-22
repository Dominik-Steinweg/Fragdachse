import * as Phaser from 'phaser';
import { DEPTH, DEPTH_LIGHTING, VOID_PALETTE } from '../../config';
import { resolveDawnSitePropHitFlash, type DawnSitePropHitFlash } from '../../arena/DawnSitePropModel';
import { fillRadialGradientTexture } from '../EffectUtils';
import type { LightingSystem } from '../LightingSystem';
import {
  SPAWN_STRUCTURE_BUILDING, SPAWN_STRUCTURE_PIT, SPAWN_STRUCTURE_TEXTURES, spawnPitFrame, spawnStructureBuildingFrame,
  spawnStructureCoreOffset, spawnStructureEyeOffsets,
} from './SpawnStructureAssets';
import {
  phaseOf, resolveSpawnEmergencePhase, resolveSpawnPitState, resolveSpawnStructureEyes, resolveSpawnStructureFade,
  resolveSpawnStructureGlow, resolveSpawnStructureHeartbeat, type SpawnEmergence, type SpawnStructureView,
} from './SpawnStructureModel';
import { SpawnStructureBoneBurst } from './SpawnStructureBoneBurst';
import { SpawnStructureSpores } from './SpawnStructureSpores';
import { BROOD_PIT_SWELLS, BroodPitGpuLayer, type BroodPitSwell } from '../gpu/BroodPitGpuLayer';

export type SpawnStructureLightingPort = Pick<LightingSystem, 'setLight' | 'releaseLight' | 'getArtificialLightFactor' | 'setGroundGlowLights'>;

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
/** The animated pool surface: quad half size (room for the droplets) and pool radius, px. */
const POOL_QUAD_HALF_PX = 52;
const POOL_RADIUS_PX = 21;
const PIT_STATE_CODE = { sealed: 0, active: 1 } as const;
/** GPU-lit eyes over the dark baked sockets: a deep violet glow and an ember slit per eye. */
const EYE_GLOW_TEXTURE = '__spawn_structure_eye_glow';
const EYE_CORE_TEXTURE = '__spawn_structure_eye_core';
const EYE_GLOW_PX = 28;
const EYE_SLIT_LENGTH_PX = 8;
const EYE_SLIT_WIDTH_PX = 3.5;

interface StructureVisual {
  readonly pit: Phaser.GameObjects.Image;
  readonly shimmer: Phaser.GameObjects.Image;
  readonly body: Phaser.GameObjects.Image;
  readonly core: Phaser.GameObjects.Image;
  readonly eyeGlows: readonly Phaser.GameObjects.Image[];
  readonly eyeCores: readonly Phaser.GameObjects.Image[];
  readonly shadows: readonly SpawnStructureShadowCell[];
  flash?: DawnSitePropHitFlash;
  hpRevision: number;
  /** Seen standing since the last HP baseline: only then does its destruction burst. */
  seenStanding: boolean;
  /** Moment of destruction; null while standing. */
  burstAt: number | null;
}

/**
 * Presentation owner of every hostile spawn structure (GDD Spawnbauwerk V1), in every mode: the
 * Brutkadaver skeleton over the hitbox cells and the brood nest with its organic creep stain, both
 * rendered per opening; GPU-lit eyes, a menacing nest light, and a bone burst with a soft fade of
 * the stain on destruction. Nothing here borrows the portal look. World-owned through BaseManager;
 * Activity inputs (announced releases) are pushed in.
 */
export class SpawnStructureRenderer {
  private readonly visuals = new Map<string, StructureVisual>();
  private readonly lightKeys = new Set<string>();
  private lighting: SpawnStructureLightingPort | null = null;
  private charge: ((id: string, nowMs: number) => number) | null = null;
  private readonly emergences = new Map<string, SpawnEmergence[]>();
  private readonly pool: BroodPitGpuLayer;
  private readonly burst: SpawnStructureBoneBurst;
  private readonly spores: SpawnStructureSpores;
  private readonly swells: BroodPitSwell[] = [];
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene) {
    this.pool = new BroodPitGpuLayer(scene);
    this.burst = new SpawnStructureBoneBurst(scene);
    this.spores = new SpawnStructureSpores(scene);
    fillRadialGradientTexture(scene.textures, EYE_GLOW_TEXTURE, 64, [[0, 'rgba(255,255,255,1)'], [0.18, 'rgba(255,255,255,.7)'],
      [0.45, 'rgba(255,255,255,.22)'], [0.75, 'rgba(255,255,255,.05)'], [1, 'rgba(255,255,255,0)']]);
    fillRadialGradientTexture(scene.textures, EYE_CORE_TEXTURE, 32, [[0, '#ffffff'], [0.4, 'rgba(255,255,255,.75)'], [1, 'rgba(255,255,255,0)']]);
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
    this.spores.setLighting(lighting);
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
    this.spores.begin(nowMs);
    for (const view of views) {
      const visual = this.visuals.get(view.id) ?? this.create(view);
      if (visual.hpRevision !== view.hpRevision) {
        // A new HP baseline (Activity bound or reset): never replay a burst or a hit flash.
        visual.flash = undefined;
        visual.hpRevision = view.hpRevision;
        visual.seenStanding = !view.destroyed;
        visual.burstAt = null;
      }
      if (!view.destroyed) {
        visual.seenStanding = true;
        visual.burstAt = null;
      } else if (visual.burstAt === null && visual.seenStanding) {
        visual.burstAt = nowMs;
        this.burst.play(view.x, view.y, SPAWN_STRUCTURE_TEXTURES.building, spawnStructureBuildingFrame(view.outlet),
          SPAWN_STRUCTURE_BUILDING.displaySize, view.id);
      }
      // Destroyed without having been seen standing (late join, new baseline): already gone.
      const fade = view.destroyed && visual.burstAt === null
        ? { body: false, stain: 0, glow: 0, done: true }
        : resolveSpawnStructureFade(visual.burstAt, nowMs);
      const standing = view.destroyed ? { ...view, destroyed: false } : view;
      const frame = spawnStructureBuildingFrame(view.outlet);
      for (const part of [visual.body, visual.core]) part.setFrame(frame).setPosition(view.x, view.y);
      visual.body.setVisible(fade.body);
      const pitFrame = spawnPitFrame(resolveSpawnPitState(standing), view.outlet);
      visual.pit.setFrame(pitFrame).setPosition(view.x, view.y).setVisible(fade.stain > 0).setAlpha(fade.stain);
      visual.shimmer.setFrame(pitFrame).setPosition(view.x, view.y);
      for (const cell of visual.shadows) cell.active = !view.destroyed;

      visual.flash = resolveDawnSitePropHitFlash(visual.flash, view.destroyed ? null : view.hp, nowMs);
      if (visual.flash.active) visual.body.setTint(HIT_FLASH_TINT).setTintMode(Phaser.TintModes.ADD);
      else visual.body.clearTint();

      const charge = view.destroyed ? 0 : this.charge?.(view.id, nowMs) ?? 0;
      const glow = resolveSpawnStructureGlow(standing, nowMs, charge);
      if (!view.destroyed) {
        this.pool.add({ x: view.x, y: view.y, halfSize: POOL_QUAD_HALF_PX, radius: POOL_RADIUS_PX, charge,
          state: PIT_STATE_CODE[resolveSpawnPitState(view)], seed: phaseOf(view.id) / 6.283, swells: this.resolveSwells(view.id, nowMs) });
        if (resolveSpawnPitState(view) === 'active') {
          this.spores.emit(view.id, view.x, view.y, charge, resolveSpawnStructureHeartbeat(view, nowMs, charge), nowMs);
        }
      }

      // The baked embers stay dark; the eyes are lit here, the pool glow fades with the stain.
      visual.core.setTint(VOID_PALETTE.deep).setAlpha(glow.core * emissive * 0.5 * fade.glow).setVisible(fade.body);
      visual.shimmer.setTint(VOID_PALETTE.deep).setAlpha(glow.pit * emissive * 0.7 * fade.stain).setVisible(fade.stain > 0);
      const eyes = resolveSpawnStructureEyes(standing, nowMs, charge) * fade.glow;
      const sockets = spawnStructureEyeOffsets(view.outlet);
      // Reptile sockets: the slit runs along the skull, across the line between the two eyes.
      const slit = Math.atan2(sockets[1].y - sockets[0].y, sockets[1].x - sockets[0].x) + Math.PI / 2;
      // Deep violet while the nest breathes; only the flare of an announced release makes the slits burn.
      const heat = eyes * eyes * eyes;
      sockets.forEach((offset, i) => {
        const x = view.x + offset.x, y = view.y + offset.y, scale = 0.8 + 0.4 * eyes;
        visual.eyeGlows[i].setPosition(x, y).setDisplaySize(EYE_GLOW_PX * scale, EYE_GLOW_PX * scale)
          .setAlpha(Math.min(1, eyes * (0.45 + 0.45 * emissive))).setVisible(eyes > 0.01);
        visual.eyeCores[i].setPosition(x, y).setRotation(slit)
          .setDisplaySize(EYE_SLIT_LENGTH_PX * scale, EYE_SLIT_WIDTH_PX * scale)
          .setAlpha(Math.min(1, heat * 1.1)).setVisible(eyes > 0.01);
      });
      if (this.lighting && glow.lightIntensity * fade.glow > 0.01) {
        const key = `spawn-structure:${view.id}`;
        // The nest light floods the whole stain and beyond: a menacing violet pool of light.
        this.lighting.setLight(key, 'broodPit', view.x, view.y,
          { radiusPx: glow.lightRadiusPx, intensity: glow.lightIntensity * fade.glow });
        this.lightKeys.add(key);
        seenLights.add(key);
        const eyeKey = `spawn-structure-eyes:${view.id}`;
        const skull = spawnStructureCoreOffset(view.outlet);
        this.lighting.setLight(eyeKey, 'broodPit', view.x + skull.x, view.y + skull.y,
          { radiusPx: 60 + 30 * eyes, intensity: 0.35 * eyes });
        this.lightKeys.add(eyeKey);
        seenLights.add(eyeKey);
      }
    }
    this.pool.flush();
    this.spores.update(nowMs, 0.6 + 0.4 * emissive);
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
    this.spores.releaseLights();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.releaseLights();
    this.pool.destroy();
    this.burst.destroy();
    this.spores.destroy();
    this.emergences.clear();
    for (const visual of this.visuals.values()) {
      for (const part of [visual.pit, visual.shimmer, visual.body, visual.core, ...visual.eyeGlows, ...visual.eyeCores]) part.destroy();
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
    const core = image(SPAWN_STRUCTURE_TEXTURES.core, buildingSize).setDepth(DEPTH_LIGHTING + 0.08).setBlendMode(Phaser.BlendModes.ADD);
    // The eyes sit above the light map like the enemies' eyes: a deep violet glow under an ember slit.
    const eyeGlows = [0, 1].map(() => this.scene.add.image(view.x, view.y, EYE_GLOW_TEXTURE).setDepth(DEPTH_LIGHTING + 0.1)
      .setBlendMode(Phaser.BlendModes.ADD).setTint(VOID_PALETTE.deep));
    const eyeCores = [0, 1].map(() => this.scene.add.image(view.x, view.y, EYE_CORE_TEXTURE).setDepth(DEPTH_LIGHTING + 0.12)
      .setBlendMode(Phaser.BlendModes.ADD).setTint(VOID_PALETTE.primary));
    const visual: StructureVisual = {
      pit: basin, shimmer, body, core, eyeGlows, eyeCores,
      shadows: view.wallCells.map(({ x, y }) => ({ x, y, active: true, visible: true })),
      hpRevision: view.hpRevision, seenStanding: !view.destroyed, burstAt: null,
    };
    this.visuals.set(view.id, visual);
    return visual;
  }
}
