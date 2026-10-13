import type * as Phaser from 'phaser';
import { CELL_SIZE, DEPTH } from '../config';
import { LOBBY_MERCHANT } from '../config/authoring/lobbyMerchant';
import { LOBBY_SPAWN_FOCUS_CELL } from './LobbyWorldLayout';
import { LOBBY_DEALER_ASSET, registerLobbyDealerIdle } from '../animations/LobbyMerchantAssets';
import { worldCellCenter, type WorldMetrics } from '../world/WorldMetrics';

/** World material on the main camera. No interaction, physics, progress or Activity dependency. */
export class LobbyMerchantRenderer {
  private stall: Phaser.GameObjects.Image | null = null;
  private dealer: Phaser.GameObjects.Sprite | null = null;

  constructor(scene: Phaser.Scene, metrics: WorldMetrics) {
    const { stall, dealer } = LOBBY_MERCHANT;
    const standPosition = worldCellCenter(metrics, stall.gridX, stall.gridY);
    if (scene.textures.exists(stall.textureKey)) {
      this.stall = scene.add.image(standPosition.x, standPosition.y, stall.textureKey)
        .setOrigin(0.5).setDisplaySize(stall.sizeCells * CELL_SIZE, stall.sizeCells * CELL_SIZE)
        .setDepth(DEPTH.BASES);
    }
    if (scene.textures.exists(LOBBY_DEALER_ASSET.sheetTextureKey)) {
      const idle = registerLobbyDealerIdle(scene.anims);
      if (!idle) return;
      const position = worldCellCenter(metrics, dealer.gridX, dealer.gridY);
      const focus = worldCellCenter(metrics, LOBBY_SPAWN_FOCUS_CELL.gridX, LOBBY_SPAWN_FOCUS_CELL.gridY);
      this.dealer = scene.add.sprite(position.x, position.y, LOBBY_DEALER_ASSET.sheetTextureKey)
        .setOrigin(0.5).setDisplaySize(dealer.displaySize, dealer.displaySize)
        .setRotation(Math.atan2(focus.y - position.y, focus.x - position.x) + Math.PI / 2)
        .setDepth(DEPTH.PLAYERS);
      this.dealer.play(idle);
    }
  }

  destroy(): void {
    this.stall?.destroy(); this.stall = null;
    this.dealer?.destroy(); this.dealer = null;
  }
}
