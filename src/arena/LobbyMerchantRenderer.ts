import type * as Phaser from 'phaser';
import { CELL_SIZE, DEPTH, DEPTH_LIGHTING } from '../config';
import { LOBBY_BUILDINGS, LOBBY_BUILDING_LANTERN, type LobbyMenu } from '../config/authoring/lobbyBuildings';
import { LOBBY_MERCHANT } from '../config/authoring/lobbyMerchant';
import { LOBBY_SPAWN_FOCUS_CELL } from './LobbyWorldLayout';
import { LOBBY_DEALER_ASSET, registerLobbyDealerIdle } from '../animations/LobbyMerchantAssets';
import { worldCellCenter, type WorldMetrics } from '../world/WorldMetrics';
import { t } from '../i18n';
import { LobbyWorldPlaque } from '../ui/LobbyWorldPlaque';
import { HUD_TONES } from '../ui/HudFrameAssets';
import type { LightingSystem } from '../effects/LightingSystem';
import { registerGraphicsObject } from '../effects/EffectUtils';

type LobbyLighting = Pick<LightingSystem, 'setLight' | 'releaseLight' | 'getArtificialLightFactor'>;

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
  private readonly buildings: { menu: LobbyMenu; image: Phaser.GameObjects.Image; label: LobbyWorldPlaque }[] = [];
  private readonly lanterns: { key: string; x: number; y: number; housing: Phaser.GameObjects.Graphics }[] = [];
  private lighting: LobbyLighting | null = null;
  private stall: Phaser.GameObjects.Image | null = null;
  private dealer: Phaser.GameObjects.Sprite | null = null;
  private nameplate: LobbyWorldPlaque | null = null;
  private readonly dealerPosition: { x: number; y: number };

  constructor(private readonly scene: Phaser.Scene, metrics: WorldMetrics) {
    for (const building of LOBBY_BUILDINGS) {
      if (!scene.textures.exists(building.textureKey)) continue;
      const center = worldCellCenter(metrics, building.gridX + 1.5, building.gridY + 1);
      const image = scene.add.image(center.x, center.y, building.textureKey)
        .setOrigin(0.5).setDisplaySize(128, 128).setDepth(DEPTH.BASES);
      // The 4x4 canvas has a transparent half-cell below the occupied 4x3 building.
      const label = new LobbyWorldPlaque(scene).setText(t(building.nameKey))
        .setPosition(center.x, center.y + 1.5 * CELL_SIZE + 8);
      this.buildings.push({ menu: building.menu, image, label });
      this.addLantern(building.menu, center.x, center.y);
    }
    const { stall, dealer } = LOBBY_MERCHANT;
    const standPosition = worldCellCenter(metrics, stall.gridX, stall.gridY);
    const position = this.dealerPosition = worldCellCenter(metrics, dealer.gridX, dealer.gridY);
    if (scene.textures.exists(stall.textureKey)) {
      this.stall = scene.add.image(standPosition.x, standPosition.y, stall.textureKey)
        .setOrigin(0.5).setDisplaySize(stall.sizeCells * CELL_SIZE, stall.sizeCells * CELL_SIZE)
        .setDepth(DEPTH.BASES);
      this.addLantern('merchant', standPosition.x, standPosition.y);
    }
    if (scene.textures.exists(LOBBY_DEALER_ASSET.sheetTextureKey)) {
      const idle = registerLobbyDealerIdle(scene.anims);
      const focus = worldCellCenter(metrics, LOBBY_SPAWN_FOCUS_CELL.gridX, LOBBY_SPAWN_FOCUS_CELL.gridY);
      this.dealer = scene.add.sprite(position.x, position.y, LOBBY_DEALER_ASSET.sheetTextureKey)
        .setOrigin(0.5).setDisplaySize(dealer.displaySize, dealer.displaySize)
        .setRotation(Math.atan2(focus.y - position.y, focus.x - position.x) + Math.PI / 2)
        .setDepth(DEPTH.PLAYERS);
      if (idle) this.dealer.play(idle);
    }
    if (this.stall || this.dealer) {
      this.nameplate = new LobbyWorldPlaque(scene).setText(t('ui.dawn.dealerName'))
        .setPosition(standPosition.x, standPosition.y + stall.sizeCells * CELL_SIZE / 2 + 8);
    }
  }

  update(localPlayer: { x: number; y: number } | null, activeMenu: LobbyMenu | null = null,
    lighting: LobbyLighting | null = null): void {
    for (const { menu, image, label } of this.buildings) label.setAlpha(localPlayer && activeMenu !== menu
      ? resolveLobbyMerchantNameplateAlpha(Math.hypot(localPlayer.x - image.x, localPlayer.y - image.y) / CELL_SIZE) : 0);
    this.nameplate?.setAlpha(localPlayer && activeMenu !== 'merchant' ? resolveLobbyMerchantNameplateAlpha(
      Math.hypot(localPlayer.x - this.dealerPosition.x, localPlayer.y - this.dealerPosition.y) / CELL_SIZE,
    ) : 0);
    if (this.lighting !== lighting) this.releaseLights();
    this.lighting = lighting;
    const factor = lighting?.getArtificialLightFactor() ?? 0;
    for (const lantern of this.lanterns) {
      lantern.housing.setAlpha(factor);
      if (factor > 0) lighting?.setLight(lantern.key, 'dawnSiteGlow', lantern.x, lantern.y,
        { ...LOBBY_BUILDING_LANTERN, intensity: LOBBY_BUILDING_LANTERN.intensity * factor });
      else lighting?.releaseLight(lantern.key, { immediate: true });
    }
  }

  private addLantern(menu: LobbyMenu, x: number, y: number): void {
    x += LOBBY_BUILDING_LANTERN.offsetX; y += LOBBY_BUILDING_LANTERN.offsetY;
    // Top-down brass housing and warm glass core, like the existing emissive world-light sources.
    const housing = this.scene.add.graphics().setPosition(x, y).setDepth(DEPTH_LIGHTING + 0.08)
      .fillStyle(0x17130e).fillCircle(0, 0, 5)
      .lineStyle(1.5, HUD_TONES.gold.muted).strokeCircle(0, 0, 4)
      .fillStyle(LOBBY_BUILDING_LANTERN.color).fillCircle(0, 0, 2.5)
      .lineStyle(1, HUD_TONES.bronze.muted).lineBetween(-4, 0, 4, 0).lineBetween(0, -4, 0, 4)
      .setAlpha(0);
    registerGraphicsObject(this.scene, 'lobbyBuildings', housing);
    this.lanterns.push({ key: `lobby-lantern:${menu}`, x, y, housing });
  }

  private releaseLights(): void {
    for (const { key } of this.lanterns) this.lighting?.releaseLight(key, { immediate: true });
    this.lighting = null;
  }

  destroy(): void {
    this.releaseLights();
    for (const { housing } of this.lanterns) housing.destroy();
    this.lanterns.length = 0;
    for (const { image, label } of this.buildings) { image.destroy(); label.destroy(); }
    this.buildings.length = 0;
    this.stall?.destroy(); this.stall = null;
    this.dealer?.destroy(); this.dealer = null;
    this.nameplate?.destroy(); this.nameplate = null;
  }
}
