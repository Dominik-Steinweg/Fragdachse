import type * as Phaser from 'phaser';
import type { CombatTargetRef } from '../combat/CombatScope';
import type { BaseEntity } from '../entities/BaseEntity';

export interface MgTargetVisual { x: number; y: number; width: number; height: number }
export function mgTargetVisual(
  target: CombatTargetRef,
  enemy: (id: string) => { sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image; bodySize: number; visible: boolean; entityGeneration?: number } | null,
  base: (id: string) => BaseEntity | null | undefined,
): MgTargetVisual | null {
  if (target.kind === 'enemy') {
    const e = enemy(String(target.id));
    return e?.visible && e.sprite.active && e.sprite.visible && e.entityGeneration === target.instance.entityGeneration
      ? { x: e.sprite.x, y: e.sprite.y, width: e.bodySize, height: e.bodySize } : null;
  }
  if (target.kind !== 'base') return null;
  const b = base(String(target.id));
  if (!b || b.isInert() || b.getHp() <= 0) return null;
  const cells = b.getCellBodies().map(cell => cell.getBounds());
  if (!cells.length) return null;
  const left = Math.min(...cells.map(c => c.left)), right = Math.max(...cells.map(c => c.right));
  const top = Math.min(...cells.map(c => c.top)), bottom = Math.max(...cells.map(c => c.bottom));
  return { x: (left + right) / 2, y: (top + bottom) / 2, width: right - left, height: bottom - top };
}

