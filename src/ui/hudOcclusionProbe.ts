/**
 * Prüft, ob unter einem HUD-Rechteck gerade etwas Wichtiges liegt.
 *
 * Die Umrechnung läuft bewusst in die andere Richtung als erwartet: Statt jede Figur in
 * Bildschirmkoordinaten zu überführen, wandert das feste HUD-Rechteck einmal pro Frame in die
 * Welt. Beides unterscheidet sich nur um eine Verschiebung (siehe `getVisibleWorldView`), und
 * bei zwei Dutzend Gegnern ist eine Umrechnung deutlich billiger als zwei Dutzend.
 */
import type * as Phaser from 'phaser';
import { getUnshakenPointerWorldPoint } from '../graphics/cameraBaseScroll';
import type { EnemyManager } from '../entities/EnemyManager';
import type { PlayerManager } from '../entities/PlayerManager';
import { getVisibleWorldView } from './HostileBaseIndicator';
import {
  HUD_OCCLUSION_ENTITY_MARGIN_PX,
  HUD_OCCLUSION_POINTER_MARGIN_PX,
  isPointNearRect,
  type HudOcclusionRect,
} from './hudOcclusionFade';

export function isHudRectOccluded(
  scene: Phaser.Scene,
  rect: HudOcclusionRect,
  playerManager: PlayerManager | null,
  enemyManager: EnemyManager | null,
): boolean {
  const camera = scene.cameras?.main;
  if (!camera) return false;

  // `getVisibleWorldView` korrigiert Phasers auf `origin = 0.5` gestützten `worldView`; die
  // Verschiebung zwischen scrollfester HUD-Ebene und Welt darf nicht nachgebaut werden.
  const view = getVisibleWorldView(camera);
  const zoom = Math.max(0.001, camera.zoom);
  const offsetX = view.x - camera.x / zoom;
  const offsetY = view.y - camera.y / zoom;
  const worldRect: HudOcclusionRect = {
    left: rect.left + offsetX,
    right: rect.right + offsetX,
    top: rect.top + offsetY,
    bottom: rect.bottom + offsetY,
  };

  const pointer = scene.input?.activePointer;
  if (pointer) {
    const pointerWorld = getUnshakenPointerWorldPoint(scene, pointer);
    if (isPointNearRect(pointerWorld.x, pointerWorld.y, worldRect, HUD_OCCLUSION_POINTER_MARGIN_PX)) {
      return true;
    }
  }

  // `visible` statt nur `active`: Tote und eingegrabene Figuren behalten ihren aktiven Sprite,
  // sind aber ausgeblendet – die Spalte soll nicht über einer Leiche durchsichtig bleiben.
  for (const player of playerManager?.getAllPlayers() ?? []) {
    if (!player.sprite.active || !player.sprite.visible) continue;
    if (isPointNearRect(player.sprite.x, player.sprite.y, worldRect, HUD_OCCLUSION_ENTITY_MARGIN_PX)) {
      return true;
    }
  }

  for (const enemy of enemyManager?.getAllEnemies() ?? []) {
    if (!enemy.sprite.active || !enemy.sprite.visible || enemy.getHp() <= 0) continue;
    if (isPointNearRect(enemy.sprite.x, enemy.sprite.y, worldRect, HUD_OCCLUSION_ENTITY_MARGIN_PX)) {
      return true;
    }
  }

  return false;
}
