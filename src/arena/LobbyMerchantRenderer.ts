import type * as Phaser from 'phaser';
import { CELL_SIZE, DEPTH } from '../config';
import { LOBBY_MERCHANT } from '../config/authoring/lobbyMerchant';
import { LOBBY_SPAWN_FOCUS_CELL } from './LobbyWorldLayout';
import { LOBBY_DEALER_ASSET, registerLobbyDealerIdle } from '../animations/LobbyMerchantAssets';
import { worldCellCenter, type WorldMetrics } from '../world/WorldMetrics';
import { t } from '../i18n';
import { textStyle } from '../ui/ForestModal';

/** Smooth spatial fade in cell units, with flat endpoints (no threshold pop). */
export function resolveLobbyMerchantNameplateAlpha(distanceCells: number): number {
  if (!Number.isFinite(distanceCells)) return 0;
  const { fullVisibilityCells, hiddenAtCells } = LOBBY_MERCHANT.nameplate;
  const fraction = Math.max(0, Math.min(1,
    (distanceCells - fullVisibilityCells) / (hiddenAtCells - fullVisibilityCells)));
  return 1 - fraction * fraction * (3 - 2 * fraction);
}

/** World material on the main camera. No interaction, physics, progress or Activity dependency. */
export class LobbyMerchantRenderer {
  private stall: Phaser.GameObjects.Image | null = null;
  private dealer: Phaser.GameObjects.Sprite | null = null;
  private nameplate: Phaser.GameObjects.Text | null = null;
  private readonly standPosition: { x: number; y: number };

  constructor(scene: Phaser.Scene, metrics: WorldMetrics) {
    const { stall, dealer } = LOBBY_MERCHANT;
    const standPosition = worldCellCenter(metrics, stall.gridX, stall.gridY);
    this.standPosition = standPosition;
    if (scene.textures.exists(stall.textureKey)) {
      this.stall = scene.add.image(standPosition.x, standPosition.y, stall.textureKey)
        .setOrigin(0.5).setDisplaySize(stall.sizeCells * CELL_SIZE, stall.sizeCells * CELL_SIZE)
        .setDepth(DEPTH.BASES);
    }
    if (scene.textures.exists(LOBBY_DEALER_ASSET.sheetTextureKey)) {
      const idle = registerLobbyDealerIdle(scene.anims);
      const position = worldCellCenter(metrics, dealer.gridX, dealer.gridY);
      const focus = worldCellCenter(metrics, LOBBY_SPAWN_FOCUS_CELL.gridX, LOBBY_SPAWN_FOCUS_CELL.gridY);
      this.dealer = scene.add.sprite(position.x, position.y, LOBBY_DEALER_ASSET.sheetTextureKey)
        .setOrigin(0.5).setDisplaySize(dealer.displaySize, dealer.displaySize)
        .setRotation(Math.atan2(focus.y - position.y, focus.x - position.x) + Math.PI / 2)
        .setDepth(DEPTH.PLAYERS);
      if (idle) this.dealer.play(idle);
    }
    if (this.stall || this.dealer) {
      this.nameplate = scene.add.text(standPosition.x,
        standPosition.y + LOBBY_MERCHANT.nameplate.offsetYCells * CELL_SIZE, t('ui.dawn.dealerName'), {
          ...textStyle('body'), fontSize: 14, backgroundColor: '#141c18',
          padding: { x: 7, y: 4 }, resolution: 2,
        }).setOrigin(0.5).setDepth(DEPTH.LOCAL_UI).setAlpha(0);
    }
  }

  update(localPlayer: { x: number; y: number } | null): void {
    this.nameplate?.setAlpha(localPlayer ? resolveLobbyMerchantNameplateAlpha(
      Math.hypot(localPlayer.x - this.standPosition.x, localPlayer.y - this.standPosition.y) / CELL_SIZE,
    ) : 0);
  }

  destroy(): void {
    this.stall?.destroy(); this.stall = null;
    this.dealer?.destroy(); this.dealer = null;
    this.nameplate?.destroy(); this.nameplate = null;
  }
}
