import type * as Phaser from 'phaser';
import { CELL_SIZE, DEPTH, DEPTH_LIGHTING } from '../config';
import { LOBBY_BUILDINGS, LOBBY_BUILDING_LANTERN, lobbyBuildingWorldRects, type LobbyMenu } from '../config/authoring/lobbyBuildings';
import { LOBBY_MERCHANT } from '../config/authoring/lobbyMerchant';
import { LOBBY_SPAWN_FOCUS_CELL } from './LobbyWorldLayout';
import { LOBBY_DEALER_ASSET, registerLobbyDealerIdle } from '../animations/LobbyMerchantAssets';
import { worldCellCenter, type WorldMetrics } from '../world/WorldMetrics';
import { t } from '../i18n';
import { WorldPlaque } from '../ui/WorldPlaque';
import { HUD_TONES } from '../ui/HudFrameAssets';
import type { LightingSystem } from '../effects/LightingSystem';
import { registerGraphicsObject } from '../effects/EffectUtils';
import { nearestStructurePoint, structureBounds, type StructureRect } from './StructureOutline';

type LobbyLighting = Pick<LightingSystem, 'setLight' | 'releaseLight' | 'getArtificialLightFactor'>;

/** Gap between an outline's lower edge and its name plaque. */
const NAMEPLATE_GAP_PX = 12;

/** Smooth spatial fade in cell units, with flat endpoints (no threshold pop). */
export function resolveLobbyMerchantNameplateAlpha(distanceCells: number): number {
  if (!Number.isFinite(distanceCells)) return 0;
  const { fullVisibilityCells, hiddenAtCells } = LOBBY_MERCHANT.nameplate;
  const fraction = Math.max(0, Math.min(1,
    (distanceCells - fullVisibilityCells) / (hiddenAtCells - fullVisibilityCells)));
  return 1 - fraction * fraction * (3 - 2 * fraction);
}

/**
 * World material of the four lobby structures and the dealer on the main camera. No interaction,
 * physics, progress or Activity dependency. The building images are provisional stand-ins scaled
 * over their outline bounds; collision, fog and focus follow the authored outline.
 */
export class LobbyMerchantRenderer {
  private readonly buildings: { menu: LobbyMenu; rects: readonly StructureRect[]; image: Phaser.GameObjects.Image; label: WorldPlaque }[] = [];
  private readonly lanterns: { key: string; x: number; y: number; housing: Phaser.GameObjects.Graphics }[] = [];
  private lighting: LobbyLighting | null = null;
  private dealer: Phaser.GameObjects.Sprite | null = null;

  constructor(private readonly scene: Phaser.Scene, metrics: WorldMetrics) {
    for (const building of LOBBY_BUILDINGS) {
      if (!scene.textures.exists(building.textureKey)) continue;
      const rects = lobbyBuildingWorldRects(metrics, building);
      const bounds = structureBounds(rects);
      const centerX = (bounds.left + bounds.right) / 2, centerY = (bounds.top + bounds.bottom) / 2;
      const width = bounds.right - bounds.left;
      // Building art sits in a square canvas with transparent rows above and below; the stall
      // art fills its canvas.
      const image = scene.add.image(centerX, centerY, building.textureKey)
        .setOrigin(0.5).setDisplaySize(width, building.menu === 'merchant' ? bounds.bottom - bounds.top : width)
        .setDepth(DEPTH.BASES);
      const label = new WorldPlaque(scene).setText(t(building.nameKey))
        .setPosition(centerX, bounds.bottom + NAMEPLATE_GAP_PX);
      this.buildings.push({ menu: building.menu, rects, image, label });
      this.addLantern(building.menu, centerX, centerY);
    }
    const { dealer } = LOBBY_MERCHANT;
    if (scene.textures.exists(LOBBY_DEALER_ASSET.sheetTextureKey)) {
      const position = worldCellCenter(metrics, dealer.gridX, dealer.gridY);
      const idle = registerLobbyDealerIdle(scene.anims);
      const focus = worldCellCenter(metrics, LOBBY_SPAWN_FOCUS_CELL.gridX, LOBBY_SPAWN_FOCUS_CELL.gridY);
      this.dealer = scene.add.sprite(position.x, position.y, LOBBY_DEALER_ASSET.sheetTextureKey)
        .setOrigin(0.5).setDisplaySize(dealer.displaySize, dealer.displaySize)
        .setRotation(Math.atan2(focus.y - position.y, focus.x - position.x) + Math.PI / 2)
        .setDepth(DEPTH.PLAYERS);
      if (idle) this.dealer.play(idle);
    }
  }

  update(localPlayer: { x: number; y: number } | null, activeMenu: LobbyMenu | null = null,
    lighting: LobbyLighting | null = null): void {
    // Names fade with the distance to the nearest wall, the same measure Shift uses.
    for (const { menu, rects, label } of this.buildings) label.setAlpha(localPlayer && activeMenu !== menu
      ? resolveLobbyMerchantNameplateAlpha(nearestStructurePoint(rects, localPlayer.x, localPlayer.y).distance / CELL_SIZE) : 0);
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
    this.dealer?.destroy(); this.dealer = null;
  }
}
