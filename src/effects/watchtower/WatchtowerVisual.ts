import * as Phaser from 'phaser';
import { getPipelineAsset } from '../../config/pipelineAssets';
import { DEPTH, ROCK_TINT_STEPS } from '../../config';
import { WATCHTOWER_TEXTURE_KEY, WATCHTOWER_REWARD_ICON_KEY, WATCHTOWER_DISPLAY_SIZE } from '../../config/watchtower';
import { getConstructionBounds } from '../../systems/ConstructionGeometry';
import type { SyncedPlaceableRock } from '../../types';
import type { WorldMetrics } from '../../world/WorldMetrics';

export function preloadWatchtowerAssets(loader: Phaser.Loader.LoaderPlugin): void {
  const asset = getPipelineAsset('watchtower');
  loader.image(asset.textureKey, asset.idlePath);
  loader.image(WATCHTOWER_REWARD_ICON_KEY, './assets/sprites/rewards/watchtower.png');
}

/** One cached fallback; the authored texture takes precedence when loaded. */
export function ensureWatchtowerTexture(scene: Phaser.Scene): string {
  if (scene.textures.exists(WATCHTOWER_TEXTURE_KEY)) return WATCHTOWER_TEXTURE_KEY;
  const g = scene.make.graphics({}, false);
  g.fillStyle(0x534334).fillRect(0, 0, 64, 64);
  for (let y = 5; y < 59; y += 9) {
    g.fillStyle(y % 2 ? 0xb58a52 : 0xa67c46).fillRect(5, y, 54, 8);
    g.lineStyle(1, 0xd0a36a, .55).lineBetween(8, y + 2, 56, y + 2);
  }
  g.lineStyle(4, 0x765737).strokeRect(3, 3, 58, 58);
  for (const x of [2, 54]) for (const y of [2, 54]) {
    g.fillStyle(0xc09b68).fillRect(x, y, 8, 8);
    g.fillStyle(0x647079).fillRect(x + 2, y + 2, 4, 4);
  }
  g.generateTexture(WATCHTOWER_TEXTURE_KEY, 64, 64);
  g.destroy();
  return WATCHTOWER_TEXTURE_KEY;
}

/** Owns the platform image only; occupancy and damage remain gameplay state. */
export class WatchtowerVisual {
  readonly image: Phaser.GameObjects.Image;
  constructor(private readonly scene: Phaser.Scene) {
    this.image = scene.add.image(0, 0, ensureWatchtowerTexture(scene)).setDepth(DEPTH.ROCKS + .15);
  }
  sync(rock: Pick<SyncedPlaceableRock, 'gridX' | 'gridY' | 'hp' | 'maxHp'>, metrics: Pick<WorldMetrics, 'offsetX' | 'offsetY'>): void {
    const bounds = getConstructionBounds({ ...rock, constructionId: 'watchtower' }, metrics);
    const ratio = Math.round(Math.max(0, Math.min(1, rock.hp / Math.max(1, rock.maxHp))) * ROCK_TINT_STEPS) / ROCK_TINT_STEPS;
    const gray = Math.round(0x66 + (0xff - 0x66) * ratio);
    // The authored canvas includes small height cues outside the collision footprint.
    this.image.setTexture(ensureWatchtowerTexture(this.scene)).setPosition(bounds.x, bounds.y)
      .setDisplaySize(WATCHTOWER_DISPLAY_SIZE, WATCHTOWER_DISPLAY_SIZE).setRotation(0).setTint((gray << 16) | (gray << 8) | gray);
  }
  destroy(): void { this.image.destroy(); }
}
