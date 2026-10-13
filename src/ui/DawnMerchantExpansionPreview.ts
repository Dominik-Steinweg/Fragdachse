import type * as Phaser from 'phaser';
import { CELL_SIZE } from '../config';
import type { ExpansionBoundaryEdge } from '../persistentBase/PersistentBaseExpansionPreview';

/** Editor-only World annotation; its owner destroys it with the editor presentation. */
export function createDawnMerchantExpansionPreview(scene: Phaser.Scene, anchor: number, edges: readonly ExpansionBoundaryEdge[]): Phaser.GameObjects.Graphics {
  const outline = scene.add.graphics().setDepth(9999);
  const origin = (anchor + .5) * CELL_SIZE;
  outline.lineStyle(2, 0xd5c58c, .6);
  for (const edge of edges) {
    // Two short strokes per cell keep the contour dashed at corners as well as on long edges.
    for (const start of [.08, .58]) {
      const end = start + .3;
      outline.lineBetween(origin + (edge.x1 + (edge.x2 - edge.x1) * start) * CELL_SIZE,
        origin + (edge.y1 + (edge.y2 - edge.y1) * start) * CELL_SIZE,
        origin + (edge.x1 + (edge.x2 - edge.x1) * end) * CELL_SIZE,
        origin + (edge.y1 + (edge.y2 - edge.y1) * end) * CELL_SIZE);
    }
  }
  return outline;
}
