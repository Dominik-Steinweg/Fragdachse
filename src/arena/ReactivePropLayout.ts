import type { ReactivePropScatterSpec } from '../config/reactiveProps/reactivePropKinds';
import type { ReactivePropCell } from '../types';

/** Authored Anker eines reaktiven Map-Objekts. */
export interface ReactivePropAnchor {
  readonly id: string;
  readonly kind: string;
  readonly gridX: number;
  readonly gridY: number;
  readonly variant?: string;
}

export interface ReactivePropPlacementInput {
  readonly cols: number;
  readonly rows: number;
  /** Begehbarkeit dieses Generierungsversuchs; gesetzte Objekte werden hier eingetragen. */
  readonly blocked: boolean[][];
  /** Zellen, auf denen kein Objekt stehen darf (Basis, Gleis, Podest, Spawnkern …). */
  readonly isReserved: (gridX: number, gridY: number) => boolean;
  readonly isConnected: (blocked: boolean[][]) => boolean;
  readonly anchors: readonly ReactivePropAnchor[];
  readonly scatter: readonly ReactivePropScatterSpec[];
  /** Eigener Zufallsstrom: die Platzierung verschiebt keine Fels-, Baum- oder Decal-Folge. */
  readonly rng: () => number;
}

export type ReactivePropPlacementResult =
  | { readonly kind: 'placed'; readonly cells: ReactivePropCell[] }
  | { readonly kind: 'retry'; readonly reason: string };

const SCATTER_START_ATTEMPTS = 48;
const EDGE_MARGIN_CELLS = 2;

/**
 * Setzt reaktive Map-Objekte in ein bereits konnektives Layout.
 *
 * Authored Anker stehen auf ihrer Zelle (der Generator hält sie wie Lichtungen frei); verletzt
 * ein Anker eine Reservierung, ist das ein Authoring-Fehler. Gestreute Gruppen stehen auf freiem
 * Boden: ihr 3×3-Umfeld ist frei von Hindernissen, und jede Gruppe muss die Begehbarkeit erhalten
 * – sonst wird sie zurückgenommen und an anderer Stelle versucht.
 */
export function placeReactiveProps(input: ReactivePropPlacementInput): ReactivePropPlacementResult {
  const { blocked, rng } = input;
  const cells: ReactivePropCell[] = [];
  const taken = new Set<number>();
  const key = (gx: number, gy: number) => gy * input.cols + gx;

  for (const anchor of input.anchors) {
    if (anchor.gridX < 0 || anchor.gridY < 0 || anchor.gridX >= input.cols || anchor.gridY >= input.rows) {
      throw new Error(`[ReactivePropLayout] Anchor ${anchor.id} is outside the arena`);
    }
    // Podeste werden seeded gesetzt; ein Konflikt ist daher ein Fall für den nächsten Versuch.
    if (input.isReserved(anchor.gridX, anchor.gridY)) {
      return { kind: 'retry', reason: `Anker ${anchor.id} liegt auf reservierter Zelle (Basis, Gleis, Podest)` };
    }
    if (blocked[anchor.gridY][anchor.gridX] || taken.has(key(anchor.gridX, anchor.gridY))) {
      return { kind: 'retry', reason: `Anker ${anchor.id} durch Fels oder Baum belegt` };
    }
    taken.add(key(anchor.gridX, anchor.gridY));
    blocked[anchor.gridY][anchor.gridX] = true;
    cells.push({
      kind: anchor.kind, gridX: anchor.gridX, gridY: anchor.gridY, anchorId: anchor.id,
      ...(anchor.variant ? { variant: anchor.variant } : {}),
    });
  }
  if (input.anchors.length > 0 && !input.isConnected(blocked)) {
    return { kind: 'retry', reason: 'Authored Fässer schneiden begehbare Flächen ab' };
  }

  const clusterCenters: { gridX: number; gridY: number }[] = cells.map(cell => ({ gridX: cell.gridX, gridY: cell.gridY }));
  const free = (gx: number, gy: number): boolean => gx >= 0 && gy >= 0 && gx < input.cols && gy < input.rows
    && !blocked[gy][gx] && !input.isReserved(gx, gy);
  /** Die Zelle und ihr 3×3-Umfeld sind frei; Zellen der eigenen Gruppe zählen als frei. */
  const openGround = (gx: number, gy: number, own: ReadonlySet<number>): boolean => {
    if (gx < EDGE_MARGIN_CELLS || gy < EDGE_MARGIN_CELLS
      || gx >= input.cols - EDGE_MARGIN_CELLS || gy >= input.rows - EDGE_MARGIN_CELLS) return false;
    if (!free(gx, gy) || taken.has(key(gx, gy))) return false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = gx + dx, ny = gy + dy;
      if (own.has(key(nx, ny))) continue;
      if (!free(nx, ny) || taken.has(key(nx, ny))) return false;
    }
    return true;
  };

  for (const spec of input.scatter) {
    for (let cluster = 0; cluster < spec.clusters; cluster++) {
      const [minSize, maxSize] = spec.clusterSize;
      const size = minSize + Math.floor(rng() * (maxSize - minSize + 1));
      for (let attempt = 0; attempt < SCATTER_START_ATTEMPTS; attempt++) {
        const gx = Math.floor(rng() * input.cols);
        const gy = Math.floor(rng() * input.rows);
        if (clusterCenters.some(center => Math.max(Math.abs(center.gridX - gx), Math.abs(center.gridY - gy)) < spec.minSpacingCells)) continue;
        const own = new Set<number>();
        if (!openGround(gx, gy, own)) continue;
        own.add(key(gx, gy));
        const group = [{ gridX: gx, gridY: gy }];
        while (group.length < size) {
          const options: { gridX: number; gridY: number }[] = [];
          for (const cell of group) {
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
              const nx = cell.gridX + dx, ny = cell.gridY + dy;
              if (!own.has(key(nx, ny)) && openGround(nx, ny, own)) options.push({ gridX: nx, gridY: ny });
            }
          }
          if (options.length === 0) break;
          const next = options[Math.floor(rng() * options.length)];
          own.add(key(next.gridX, next.gridY));
          group.push(next);
        }
        for (const cell of group) blocked[cell.gridY][cell.gridX] = true;
        if (!input.isConnected(blocked)) {
          for (const cell of group) blocked[cell.gridY][cell.gridX] = false;
          continue;
        }
        for (const cell of group) {
          taken.add(key(cell.gridX, cell.gridY));
          cells.push({ kind: spec.kind, gridX: cell.gridX, gridY: cell.gridY, ...(spec.variant ? { variant: spec.variant } : {}) });
        }
        clusterCenters.push({ gridX: gx, gridY: gy });
        break;
      }
    }
  }
  return { kind: 'placed', cells };
}
