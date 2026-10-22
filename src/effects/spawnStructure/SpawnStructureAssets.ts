import type * as Phaser from 'phaser';
import manifest from '../../assets/manifests/spawn-structure.json';
import { getPipelineAsset } from '../../config/pipelineAssets';
import { getSpawnStructureRotation, type SpawnStructureOutlet } from '../../config/spawnStructure';
import type { SpawnPitState, SpawnStructureBuildingState } from './SpawnStructureModel';

/**
 * Sheets of the Brutkadaver (scripts/asset-pipeline/export-spawn-structure.mjs painted): the carcass
 * and the brood nest with its creep stain, one frame per state, each with congruent emissive sheets.
 * Both canvases are centred on the nest centre at 32 px per cell and open south; the renderer turns
 * them toward the structure's outlet.
 */
export const SPAWN_STRUCTURE_BUILDING = manifest.building;
export const SPAWN_STRUCTURE_PIT = manifest.pit;
const BUILDING_ASSET = getPipelineAsset(manifest.building.id);
const PIT_ASSET = getPipelineAsset(manifest.pit.id);

export const SPAWN_STRUCTURE_TEXTURES = {
  building: BUILDING_ASSET.sheetTextureKey,
  rim: manifest.building.emissive.rim.key,
  veins: manifest.building.emissive.veins.key,
  core: manifest.building.emissive.core.key,
  pit: PIT_ASSET.sheetTextureKey,
  pitGlow: manifest.pit.emissive.glow.key,
} as const;

/** Preloaded with the scene: an unloaded building would be an invisible solid wall. */
export function preloadSpawnStructureAssets(loader: Pick<Phaser.Loader.LoaderPlugin, 'spritesheet'>): void {
  const sheet = (layout: typeof BUILDING_ASSET.layout) => ({
    frameWidth: layout.frameWidth, frameHeight: layout.frameHeight, margin: layout.margin, spacing: layout.spacing,
    endFrame: layout.frameCount - 1,
  });
  loader.spritesheet(SPAWN_STRUCTURE_TEXTURES.building, BUILDING_ASSET.sheetPath, sheet(BUILDING_ASSET.layout));
  loader.spritesheet(SPAWN_STRUCTURE_TEXTURES.rim, manifest.building.emissive.rim.path, sheet(BUILDING_ASSET.layout));
  loader.spritesheet(SPAWN_STRUCTURE_TEXTURES.veins, manifest.building.emissive.veins.path, sheet(BUILDING_ASSET.layout));
  loader.spritesheet(SPAWN_STRUCTURE_TEXTURES.core, manifest.building.emissive.core.path, sheet(BUILDING_ASSET.layout));
  loader.spritesheet(SPAWN_STRUCTURE_TEXTURES.pit, PIT_ASSET.sheetPath, sheet(PIT_ASSET.layout));
  loader.spritesheet(SPAWN_STRUCTURE_TEXTURES.pitGlow, manifest.pit.emissive.glow.path, sheet(PIT_ASSET.layout));
}

export function spawnStructureBuildingFrame(state: SpawnStructureBuildingState): number {
  return manifest.building.states.indexOf(state);
}

export function spawnPitFrame(state: SpawnPitState): number {
  return manifest.pit.states.indexOf(state);
}

/** Brood heart in world pixels from the nest centre (manifest sockets are frame-normalized, opening south). */
export function spawnStructureCoreOffset(outlet: SpawnStructureOutlet): { readonly x: number; readonly y: number } {
  const socket = manifest.building.frames[spawnStructureBuildingFrame('intact')].sockets.core;
  const x = (socket.x - 0.5) * manifest.building.displaySize;
  const y = (socket.y - 0.5) * manifest.building.displaySize;
  const turn = getSpawnStructureRotation(outlet);
  return { x: x * Math.cos(turn) - y * Math.sin(turn), y: x * Math.sin(turn) + y * Math.cos(turn) };
}
