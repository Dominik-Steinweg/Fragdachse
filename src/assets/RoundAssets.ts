import type * as Phaser from 'phaser';
import { COOP_DEFENSE_ENEMY_CONFIGS } from '../config/coopDefenseEnemies';
import { getPipelineAssetForTexture } from '../config/pipelineAssets';
import { preloadPipelineSheetAssets, registerTurretAnimations } from '../config/turretVisuals';
import { preloadRoundWalkingSheets, registerBadgerAnimations } from '../animations/BadgerAnimations';
import { SHOOTING_RANGE } from '../shootingRange/ShootingRangeLayout';
import { DAWN_PIPELINE_ASSETS, preloadDawnDecalAssets, preloadDawnNightAssets } from './DawnAssets';
import { preloadDawnResultArt } from './DawnUiAssets';
import { REACTIVE_PROP_PIPELINE_ASSETS } from './ReactivePropAssets';
import { preloadSpawnStructureAssets } from '../effects/spawnStructure/SpawnStructureAssets';
import { preloadBridgeAssets } from '../effects/bridge/BridgeTextures';
import { preloadTrainMaterialAssets } from '../train/TrainAssets';
import { TRACK_RAIL_TEXTURE } from '../arena/TrackGravelConfig';
import { recordDeferredFiles, type DeferredAsset } from './DeferredAssets';

/**
 * Content a round shows but the lobby never does. It loads in the second phase behind the
 * revealed lobby; a round waits for it through the replicated deferred-asset barrier, and the
 * Bauhof's stage (the next round's map) waits for it as well.
 */

/** Enemy textures the lobby places itself: the shooting range's target. */
export const LOBBY_ENEMY_TEXTURE_KEYS: ReadonlySet<string> = new Set([COOP_DEFENSE_ENEMY_CONFIGS[SHOOTING_RANGE.enemyKind].imageKey]);

const SPRITE_SHEET = { frameWidth: 32, frameHeight: 32 };

function preloadEnemyImages(loader: Pick<Phaser.Loader.LoaderPlugin, 'image'>, include: (imageKey: string) => boolean): void {
  // Several enemy kinds share one sprite (variants differ only by tint): each key is queued once.
  // Phaser's built-in textures (the kraken's `__WHITE`) are never loaded.
  for (const imageKey of new Set(Object.values(COOP_DEFENSE_ENEMY_CONFIGS).map(config => config.imageKey))) {
    if (imageKey.startsWith('__') || !include(imageKey)) continue;
    loader.image(imageKey, getPipelineAssetForTexture(imageKey)?.idlePath ?? `./assets/sprites/enemies/${imageKey}.png`);
  }
}

/** The lobby's enemy rest images, before the reveal. */
export function preloadLobbyEnemyImages(loader: Pick<Phaser.Loader.LoaderPlugin, 'image'>): void {
  preloadEnemyImages(loader, imageKey => LOBBY_ENEMY_TEXTURE_KEYS.has(imageKey));
}

function preloadRoundContent(loader: Phaser.Loader.LoaderPlugin): void {
  preloadRoundWalkingSheets(loader, LOBBY_ENEMY_TEXTURE_KEYS);
  preloadEnemyImages(loader, imageKey => !LOBBY_ENEMY_TEXTURE_KEYS.has(imageKey));
  preloadPipelineSheetAssets(loader, [...DAWN_PIPELINE_ASSETS, ...REACTIVE_PROP_PIPELINE_ASSETS]);
  preloadSpawnStructureAssets(loader);
  preloadDawnDecalAssets(loader);
  preloadDawnNightAssets(loader);
  preloadDawnResultArt(loader);
  preloadBridgeAssets(loader);
  preloadTrainMaterialAssets(loader);
  loader.image(TRACK_RAIL_TEXTURE.key, TRACK_RAIL_TEXTURE.path);
  loader.spritesheet('mission_barrier', './assets/sprites/missionbarrier47blob.png', SPRITE_SHEET);
  // Authored void armour of hostile bases (scripts/generate-hostile-base-sheet.mjs).
  loader.spritesheet('base_hostile', './assets/sprites/base47blob_hostile.png', SPRITE_SHEET);
  loader.image('mission_reward_pedestal', './assets/sprites/mission_reward_pedestal.png');
  loader.image('mission_reward_pickup', './assets/sprites/mission_reward_pickup.png');
  loader.image('mission_carry_spawn_zone', './assets/sprites/objectives/mission_carry_spawn_zone.png');
  loader.image('mission_carry_delivery_zone', './assets/sprites/objectives/mission_carry_delivery_zone.png');
}

/** Required: a failed round file keeps the round from starting instead of showing gaps. */
export function roundDeferredAssets(): DeferredAsset[] {
  return recordDeferredFiles(preloadRoundContent, false);
}

/** Global animations of every figure sheet loaded so far; repeated once the round content arrives. */
export function registerLoadedFigureAnimations(scene: Phaser.Scene): void {
  const loaded = (key: string): boolean => scene.textures.exists(key);
  registerBadgerAnimations(scene.anims, loaded);
  registerTurretAnimations(scene.anims, DAWN_PIPELINE_ASSETS, loaded);
}
