import type * as Phaser from 'phaser';
import { buildPersistentBaseAreaBoundary, getPersistentBaseExpansionLabelPosition, projectPersistentBaseBoundary,
  type ExpansionBoundaryEdge, type getPersistentBaseEditorFraming } from '../persistentBase/PersistentBaseExpansionPreview';
import type { PersistentBaseBuildArea } from '../persistentBase/PersistentBaseCore';
import { textStyle } from './ForestModal';

type EditorFrame = ReturnType<typeof getPersistentBaseEditorFraming>;

/** Editor annotations belong to the UI container, above grading and at a stable screen size. */
export function createPersistentBaseEditorBoundary(scene: Phaser.Scene, area: PersistentBaseBuildArea,
  frame: EditorFrame): Phaser.GameObjects.Graphics {
  const outline = scene.add.graphics();
  const edges = projectPersistentBaseBoundary(buildPersistentBaseAreaBoundary(area), frame);
  for (const [width, color, alpha] of [[5, 0x101c19, .9], [2, 0xbbe2d6, 1]] as const) {
    outline.lineStyle(width, color, alpha);
    for (const e of edges) outline.lineBetween(e.x1, e.y1, e.x2, e.y2);
  }
  return outline;
}

export function createDawnMerchantExpansionPreview(scene: Phaser.Scene, frame: EditorFrame,
  boundary: readonly ExpansionBoundaryEdge[], labelText: string): Phaser.GameObjects.Container {
  const root = scene.add.container(0, 0);
  const outline = scene.add.graphics();
  root.add(outline);
  const edges = projectPersistentBaseBoundary(boundary, frame);
  // Dark under-strokes keep warm gold readable on green, earth and pale gravel.
  for (const [width, color, alpha] of [[6, 0x20170b, .9], [3, 0xffd479, 1]] as const) {
    outline.lineStyle(width, color, alpha);
    for (const edge of edges) {
      // One dash per cell remains distinct even at the largest supported radius.
      const start = .16, end = .84;
      outline.lineBetween(edge.x1 + (edge.x2 - edge.x1) * start,
        edge.y1 + (edge.y2 - edge.y1) * start,
        edge.x1 + (edge.x2 - edge.x1) * end,
        edge.y1 + (edge.y2 - edge.y1) * end);
    }
  }
  const label = scene.add.text(0, 0, labelText, { ...textStyle('body'),
    fontSize: 18, color: '#ffe4a3', backgroundColor: '#201a10',
    stroke: '#100d08', strokeThickness: 2, padding: { x: 9, y: 6 },
    wordWrap: { width: frame.view.width - 40 },
  });
  const position = getPersistentBaseExpansionLabelPosition(edges, frame.view, label);
  if (position) {
    label.setPosition(position.x, position.y);
    outline.lineStyle(2, 0xffd479, 1).lineBetween(position.anchorX, position.anchorY,
      Math.max(position.x, Math.min(position.anchorX, position.x + label.width)), position.y + label.height);
    root.add(label);
  } else label.destroy();
  return root;
}
