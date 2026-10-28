import * as Phaser from 'phaser';
import { CELL_SIZE } from '../config';
import { buildPersistentBaseAreaBoundary } from '../persistentBase/PersistentBaseExpansionPreview';
import type { PersistentBaseBuildArea } from '../persistentBase/PersistentBaseCore';
import { getPersistentBaseBuildAreaExtentCells } from '../persistentBase/PersistentBaseCore';

/** Texels per cell of the halo texture; it is drawn at World scale, a little soft. */
const TEXELS = 16;
const PAD_CELLS = 2;
/** Warm light of the base's boundary. */
const LIGHT = '244, 220, 168';
const CORE = '255, 240, 208';

/**
 * The build area's edge on the ground, in the base's warm light instead of a hard line: a faint
 * tint inside, a soft glow along the edge with rounded corners. One texture per area shape,
 * shown in World space so it zooms with the view.
 */
export function createPersistentBaseAreaHalo(scene: Phaser.Scene, area: PersistentBaseBuildArea,
  anchor: { readonly gridX: number; readonly gridY: number }): Phaser.GameObjects.Image {
  const extent = getPersistentBaseBuildAreaExtentCells(area), cells = extent * 2 + 1 + PAD_CELLS * 2;
  const key = `persistent-base-halo-${JSON.stringify(area)}`;
  if (!scene.textures.exists(key)) {
    const size = cells * TEXELS, canvas = scene.textures.createCanvas(key, size, size)!, context = canvas.getContext();
    const origin = (extent + PAD_CELLS + .5) * TEXELS;
    const loops = boundaryLoops(buildPersistentBaseAreaBoundary(area));
    const trace = (radius: number) => {
      context.beginPath();
      for (const loop of loops) roundedLoop(context, loop.map((p) => ({ x: origin + p.x * TEXELS, y: origin + p.y * TEXELS })), radius);
    };
    context.lineJoin = 'round'; context.lineCap = 'round';
    trace(TEXELS * .45);
    context.fillStyle = `rgba(${LIGHT}, .025)`; context.fill('evenodd');
    // A dark under-stroke keeps the light readable on pale gravel; then glow layers and a clear core.
    context.strokeStyle = 'rgba(24, 16, 8, .26)'; context.lineWidth = 5; context.stroke();
    for (const [width, alpha] of [[14, .035], [9, .06], [5, .11], [3, .18]] as const) {
      context.strokeStyle = `rgba(${LIGHT}, ${alpha})`; context.lineWidth = width; context.stroke();
    }
    context.strokeStyle = `rgba(${CORE}, .72)`; context.lineWidth = 1.4; context.stroke();
    canvas.refresh();
    canvas.setFilter(Phaser.Textures.FilterMode.LINEAR);
  }
  const worldSize = cells * CELL_SIZE;
  return scene.add.image((anchor.gridX + .5) * CELL_SIZE, (anchor.gridY + .5) * CELL_SIZE, key).setDisplaySize(worldSize, worldSize);
}

interface Point { readonly x: number; readonly y: number }

/** Closed loops of the boundary's cell edges, without collinear points. */
function boundaryLoops(edges: readonly { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number }[]): Point[][] {
  const key = (x: number, y: number) => `${Math.round(x * 2)}:${Math.round(y * 2)}`;
  const from = new Map<string, (typeof edges)[number][]>();
  for (const edge of edges) {
    const k = key(edge.x1, edge.y1);
    from.set(k, [...(from.get(k) ?? []), edge]);
  }
  const used = new Set<(typeof edges)[number]>();
  const loops: Point[][] = [];
  for (const start of edges) {
    if (used.has(start)) continue;
    const loop: Point[] = [];
    let edge: (typeof edges)[number] | undefined = start;
    while (edge && !used.has(edge)) {
      used.add(edge);
      loop.push({ x: edge.x1, y: edge.y1 });
      edge = from.get(key(edge.x2, edge.y2))?.find((next) => !used.has(next));
    }
    const corners = loop.filter((p, i) => {
      const a = loop[(i + loop.length - 1) % loop.length]!, b = loop[(i + 1) % loop.length]!;
      return (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x) !== 0;
    });
    if (corners.length >= 3) loops.push(corners);
  }
  return loops;
}

/** A closed polygon with every corner rounded by up to `radius`. */
function roundedLoop(context: CanvasRenderingContext2D, points: readonly Point[], radius: number): void {
  const n = points.length;
  const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const start = mid(points[n - 1]!, points[0]!);
  context.moveTo(start.x, start.y);
  for (let i = 0; i < n; i++) {
    const corner = points[i]!, next = points[(i + 1) % n]!;
    const reach = Math.min(radius, Math.hypot(next.x - corner.x, next.y - corner.y) / 2);
    context.arcTo(corner.x, corner.y, next.x, next.y, reach);
  }
  context.closePath();
}
