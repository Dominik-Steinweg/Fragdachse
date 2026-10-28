import { WatchtowerVisual } from '../effects/watchtower/WatchtowerVisual';
import * as Phaser from 'phaser';
import { CELL_SIZE } from '../config';
import { AutoTiler, ROCK_AUTOTILE } from '../arena/AutoTiler';
import { createWorldTurretVisual, syncWorldTurretVisualPose } from '../entities/WorldTurretVisual';
import { TurretAnimationController } from '../effects/TurretAnimationController';
import { POWERUP_DEFS, POWERUP_RENDER_SIZE } from '../powerups/PowerUpConfig';
import { getPowerUpPedestalPreviewFrame } from '../powerups/PowerUpPedestalGpuSystem';
import { createPowerUpSymbolPreview } from '../powerups/PowerUpItemArt';
import type { BaseEditorAppearance } from '../persistentBase/PersistentBaseEditorAppearance';

/** A pointer-bound copy of the actual World artwork, visible across both menu panes. */
export function createPersistentBaseDragPreview(scene: Phaser.Scene, appearance: BaseEditorAppearance,
  color: number, options: { readonly aura?: boolean } = {}): Phaser.GameObjects.Container {
  const root = scene.add.container(0, 0).setAlpha(.85);
  if (appearance.watchtower) {
    const visual = new WatchtowerVisual(scene);
    visual.sync({ gridX: 0, gridY: 0, hp: 1, maxHp: 1 }, { offsetX: -CELL_SIZE / 2, offsetY: -CELL_SIZE / 2 });
    root.add(visual.image);
  }
  if (appearance.wall) {
    const occupied = new Set(appearance.footprint.map(cell => `${cell.dx},${cell.dy}`));
    for (const cell of appearance.footprint) {
      const frame = AutoTiler.getFrame(AutoTiler.computeMask(cell.dx, cell.dy,
        (x, y) => occupied.has(`${x},${y}`)), ROCK_AUTOTILE);
      root.add(scene.add.image(cell.dx * CELL_SIZE, cell.dy * CELL_SIZE, 'walls', frame).setDisplaySize(CELL_SIZE, CELL_SIZE));
    }
  }
  if (appearance.weapon) {
    const animation = new TurretAnimationController();
    const turret = createWorldTurretVisual(scene, appearance.weapon, 0, 0, color);
    syncWorldTurretVisualPose(turret, 'drag-preview', appearance.weapon, 0, 0, appearance.angle, color, animation);
    // An inventory card shows the turret alone; its wide aura would shrink it to a dot.
    if (options.aura === false) turret.aura.destroy(); else root.add(turret.aura);
    root.add(turret.image);
    root.once('destroy', () => animation.clear());
  }
  if (appearance.powerUpDefId) {
    const pedestal = getPowerUpPedestalPreviewFrame(scene, appearance.powerUpDefId);
    root.add(scene.add.image(0, 0, pedestal.key, pedestal.frame).setScale(pedestal.scale));
    const icon = POWERUP_DEFS[appearance.powerUpDefId]?.spriteKey;
    const symbol = icon ? createPowerUpSymbolPreview(scene, icon, POWERUP_RENDER_SIZE) : null;
    if (symbol) root.add(symbol);
  }
  return root;
}
