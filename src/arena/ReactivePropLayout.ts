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
  readonly anchors: readonly ReactivePropAnchor[];
  readonly scatter: readonly ReactivePropScatterSpec[];
  /** Gegnerrouten für `chokepoints`: Spawnquellen und Zielzellen (Basis bzw. Missionsziele). */
  readonly routes?: ReactivePropRoutes;
  /** Eigener Zufallsstrom: die Platzierung verschiebt keine Fels-, Baum- oder Decal-Folge. */
  readonly rng: () => number;
}

export interface GridCell { readonly gridX: number; readonly gridY: number }

export interface ReactivePropRoutes {
  readonly sourceGroups: readonly (readonly GridCell[])[];
  readonly goals: readonly GridCell[];
}

export type ReactivePropPlacementResult =
  | { readonly kind: 'placed'; readonly cells: ReactivePropCell[] }
  | { readonly kind: 'retry'; readonly reason: string };

const SCATTER_START_ATTEMPTS = 48;
const EDGE_MARGIN_CELLS = 2;

/**
 * Setzt reaktive Map-Objekte in ein bereits konnektives Layout.
 *
 * Authored Anker stehen auf ihrer Zelle (der Generator hält sie wie Lichtungen frei); sie dürfen
 * die begehbare Fläche nicht in mehr Teile zerlegen, als sie schon hatte (geschlossene Missionstore
 * und Wasser können sie bereits teilen). Gestreute Gruppen stehen auf freiem Boden: Um jede Gruppe
 * liegt ein vollständig freier Ring, über den jeder Weg sie umgehen kann – sie trennen nie etwas ab.
 */
export function placeReactiveProps(input: ReactivePropPlacementInput): ReactivePropPlacementResult {
  const { blocked, rng } = input;
  const componentsBefore = input.anchors.length > 0 ? countWalkableComponents(blocked) : 0;
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
  if (input.anchors.length > 0 && countWalkableComponents(blocked) > componentsBefore) {
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
    if (spec.placement === 'chokepoints') {
      for (const group of placeAtChokepoints(input, spec, taken, clusterCenters)) {
        for (const cell of group) {
          blocked[cell.gridY][cell.gridX] = true;
          taken.add(key(cell.gridX, cell.gridY));
          cells.push({ kind: spec.kind, gridX: cell.gridX, gridY: cell.gridY, ...(spec.variant ? { variant: spec.variant } : {}) });
        }
      }
      continue;
    }
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
        for (const cell of group) {
          blocked[cell.gridY][cell.gridX] = true;
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

/** Zusammenhängende begehbare Flächen (4er-Nachbarschaft). */
function countWalkableComponents(blocked: readonly boolean[][]): number {
  const rows = blocked.length, cols = rows ? blocked[0].length : 0;
  const seen = new Uint8Array(rows * cols);
  const stack: number[] = [];
  let components = 0;
  for (let start = 0; start < rows * cols; start++) {
    if (seen[start] || blocked[Math.floor(start / cols)][start % cols]) continue;
    components++;
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const cell = stack.pop()!;
      const x = cell % cols, y = Math.floor(cell / cols);
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const next = ny * cols + nx;
        if (seen[next] || blocked[ny][nx]) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
  }
  return components;
}

/** Engstellen: Routenzellen mit höchstens so viel Abstand zum nächsten Hindernis. */
const CHOKEPOINT_MAX_CLEARANCE = 3;
/** Nicht direkt an Basis oder Spawn: dort entscheidet der Kampf anders. */
const CHOKEPOINT_MIN_GOAL_DISTANCE = 10;
const CHOKEPOINT_MIN_SOURCE_STEPS = 6;
const CHOKEPOINT_SEARCH_RADIUS = 3;
const ROUTE_SAMPLES_PER_SOURCE = 8;
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

/**
 * Strategische Gruppen neben Engstellen auf den Gegnerrouten. Die Route wird als Abstiegspfad
 * im Distanzfeld zu den Zielen verfolgt. Fässer stehen an der Wand neben der Engstelle, nie auf
 * der Route und nie direkt daneben – so bleibt jede Route mindestens drei Zellen breit – und eine
 * Gruppe darf die begehbare Fläche nicht in mehr Teile zerlegen.
 */
function placeAtChokepoints(input: ReactivePropPlacementInput, spec: ReactivePropScatterSpec,
  taken: Set<number>, centers: { gridX: number; gridY: number }[]): GridCell[][] {
  const { cols, rows, blocked, rng } = input;
  const routes = input.routes;
  if (!routes || routes.goals.length === 0) return [];
  const index = (x: number, y: number) => y * cols + x;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < cols && y < rows;

  // Distanzfeld zu den Zielen.
  const dist = new Int32Array(cols * rows).fill(-1);
  const queue: number[] = [];
  for (const goal of routes.goals) {
    if (!inside(goal.gridX, goal.gridY) || blocked[goal.gridY][goal.gridX]) continue;
    const i = index(goal.gridX, goal.gridY);
    if (dist[i] < 0) { dist[i] = 0; queue.push(i); }
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head], x = i % cols, y = (i - x) / cols;
    for (const [dx, dy] of N4) {
      const nx = x + dx, ny = y + dy;
      if (!inside(nx, ny) || blocked[ny][nx]) continue;
      const n = index(nx, ny);
      if (dist[n] < 0) { dist[n] = dist[i] + 1; queue.push(n); }
    }
  }

  // Abstand jeder Zelle zum nächsten Hindernis (Chebyshev; der Arenarand zählt als Hindernis).
  const clearance = new Int32Array(cols * rows).fill(-1);
  const wall: number[] = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (blocked[y][x]) { clearance[index(x, y)] = 0; wall.push(index(x, y)); }
    else if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) { clearance[index(x, y)] = 1; wall.push(index(x, y)); }
  }
  for (let head = 0; head < wall.length; head++) {
    const i = wall[head], x = i % cols, y = (i - x) / cols;
    for (const [dx, dy] of N8) {
      const nx = x + dx, ny = y + dy;
      if (!inside(nx, ny)) continue;
      const n = index(nx, ny);
      if (clearance[n] < 0) { clearance[n] = clearance[i] + 1; wall.push(n); }
    }
  }

  // Routen: von Stichproben jeder Quelle bergab bis zum Ziel.
  const route = new Map<number, { traffic: number; steps: number }>();
  for (const group of routes.sourceGroups) {
    const reachable = group.filter(cell => inside(cell.gridX, cell.gridY) && dist[index(cell.gridX, cell.gridY)] > 0);
    const stride = Math.max(1, Math.floor(reachable.length / ROUTE_SAMPLES_PER_SOURCE));
    for (let sample = 0; sample < reachable.length; sample += stride) {
      let i = index(reachable[sample].gridX, reachable[sample].gridY), steps = 0;
      while (dist[i] > 0) {
        const entry = route.get(i);
        if (entry) { entry.traffic++; entry.steps = Math.min(entry.steps, steps); }
        else route.set(i, { traffic: 1, steps });
        const x = i % cols, y = (i - x) / cols;
        let next = -1;
        for (const [dx, dy] of N4) {
          const nx = x + dx, ny = y + dy;
          if (inside(nx, ny) && dist[index(nx, ny)] === dist[i] - 1) { next = index(nx, ny); break; }
        }
        if (next < 0) break;
        i = next; steps++;
      }
    }
  }
  const onRoute = (x: number, y: number) => route.has(index(x, y));
  const besideRoute = (x: number, y: number) => onRoute(x, y) || N4.some(([dx, dy]) => onRoute(x + dx, y + dy));

  const chokepoints = [...route.entries()]
    .filter(([i, info]) => clearance[i] > 0 && clearance[i] <= CHOKEPOINT_MAX_CLEARANCE
      && dist[i] >= CHOKEPOINT_MIN_GOAL_DISTANCE && info.steps >= CHOKEPOINT_MIN_SOURCE_STEPS)
    .sort((a, b) => clearance[a[0]] - clearance[b[0]] || b[1].traffic - a[1].traffic || a[0] - b[0]);

  const placed: GridCell[][] = [];
  const candidateCell = (x: number, y: number, own: ReadonlySet<number>): boolean => {
    if (!inside(x, y) || blocked[y][x] || taken.has(index(x, y)) || own.has(index(x, y))) return false;
    if (input.isReserved(x, y) || besideRoute(x, y)) return false;
    // An der Wand: wenigstens ein Hindernis in der 8er-Nachbarschaft.
    return N8.some(([dx, dy]) => !inside(x + dx, y + dy) || blocked[y + dy][x + dx]);
  };
  for (const [i] of chokepoints) {
    if (placed.length >= spec.clusters) break;
    const px = i % cols, py = (i - px) / cols;
    if (centers.some(c => Math.max(Math.abs(c.gridX - px), Math.abs(c.gridY - py)) < spec.minSpacingCells)) continue;
    const own = new Set<number>();
    const options: GridCell[] = [];
    for (let dy = -CHOKEPOINT_SEARCH_RADIUS; dy <= CHOKEPOINT_SEARCH_RADIUS; dy++) {
      for (let dx = -CHOKEPOINT_SEARCH_RADIUS; dx <= CHOKEPOINT_SEARCH_RADIUS; dx++) {
        if (candidateCell(px + dx, py + dy, own)) options.push({ gridX: px + dx, gridY: py + dy });
      }
    }
    if (options.length === 0) continue;
    options.sort((a, b) => Math.hypot(a.gridX - px, a.gridY - py) - Math.hypot(b.gridX - px, b.gridY - py)
      || index(a.gridX, a.gridY) - index(b.gridX, b.gridY));
    const [minSize, maxSize] = spec.clusterSize;
    const size = minSize + Math.floor(rng() * (maxSize - minSize + 1));
    const group: GridCell[] = [options[0]];
    own.add(index(options[0].gridX, options[0].gridY));
    while (group.length < size) {
      const next: GridCell[] = [];
      for (const cell of group) for (const [dx, dy] of N8) {
        if (candidateCell(cell.gridX + dx, cell.gridY + dy, own)) next.push({ gridX: cell.gridX + dx, gridY: cell.gridY + dy });
      }
      if (next.length === 0) break;
      const pick = next[Math.floor(rng() * next.length)];
      own.add(index(pick.gridX, pick.gridY));
      group.push(pick);
    }
    const before = countWalkableComponents(blocked);
    for (const cell of group) blocked[cell.gridY][cell.gridX] = true;
    const sealed = countWalkableComponents(blocked) > before;
    for (const cell of group) blocked[cell.gridY][cell.gridX] = false;
    if (sealed) continue;
    for (const cell of group) taken.add(index(cell.gridX, cell.gridY));
    centers.push({ gridX: px, gridY: py });
    placed.push(group);
  }
  return placed;
}
