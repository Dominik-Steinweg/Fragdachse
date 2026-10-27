/**
 * Instance data of the situation map's enemy routes ("Void-Strömung"). Pure data: no Phaser, no GL.
 *
 * Flow-field routes of one field form a tree: where two routes meet they continue on the same
 * nodes. The geometry keeps that tree. Shared edges become one stream whose width grows with the
 * number of routes on it, and every vertex carries the arc distance to its route's goal. The
 * shader moves its pattern along that distance, so merged streams flow on seamlessly.
 *
 * One instance is one quad (six non-indexed vertices): a stream segment, a source swirl, an entry
 * glow at the build area or a breach. The CPU writes only when the plan changes.
 */

export const ROUTE_FLOW_FLOATS_PER_VERTEX = 20;
export const ROUTE_FLOW_VERTICES = 6;
export const ROUTE_FLOW_INSTANCE_FLOATS = ROUTE_FLOW_FLOATS_PER_VERTEX * ROUTE_FLOW_VERTICES;
export const ROUTE_FLOW_CAPACITY = 2048;

export const RouteFlowKind = { Segment: 0, Source: 1, Entry: 2, Breach: 3 } as const;
export type RouteFlowKind = (typeof RouteFlowKind)[keyof typeof RouteFlowKind];

/** Shared with the shader: the stream's look in World pixels. */
export const ROUTE_FLOW_SHAPE = {
  /** Stream half width of one route; `widthPerRoute` × √routes is added on top. */
  baseHalfWidth: 6,
  widthPerRoute: 4,
  /** The ground stain reaches this far beyond the stream. */
  stainReach: 2.3,
  /** Breach routes heat up over this arc length before the wall. */
  heatRange: 192,
  sourceRadius: 34,
  entryRadius: 30,
  breachRadius: 52,
} as const;

export interface RouteFlowPoint { readonly x: number; readonly y: number }

export interface RouteFlowRoute {
  /** From the source to the goal or the breach, World pixels. */
  readonly points: readonly RouteFlowPoint[];
  /** The last point is where enemies break through a sealed base. */
  readonly breach: boolean;
  /** 0..1; dim routes pass the view without mattering for the base. */
  readonly strength: number;
}

export interface RouteFlowSegment {
  readonly key: string;
  readonly ax: number; readonly ay: number;
  readonly bx: number; readonly by: number;
  /** Arc distance to the goal at both ends (World px); it falls along the stream. */
  readonly distA: number; readonly distB: number;
  /** Routes sharing this segment. */
  readonly usage: number;
  readonly strength: number;
  /** 0..1 towards a breach. */
  readonly heatA: number; readonly heatB: number;
  /** Bisector plane normals at both joints, oriented along travel; null = open (round) end. */
  readonly joinA: readonly [number, number] | null;
  readonly joinB: readonly [number, number] | null;
}

export interface RouteFlowMark {
  readonly key: string;
  readonly kind: typeof RouteFlowKind.Source | typeof RouteFlowKind.Entry | typeof RouteFlowKind.Breach;
  readonly x: number; readonly y: number;
  readonly radius: number;
  readonly strength: number;
}

export interface RouteFlowGeometry {
  readonly segments: readonly RouteFlowSegment[];
  readonly marks: readonly RouteFlowMark[];
}

export interface RouteFlowGeometryOptions {
  /** Max distance (World px) a simplified stream may leave the smoothed route. */
  readonly tolerance: number;
  /** Segments and marks entirely outside this rectangle are dropped. */
  readonly clip?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  /** True inside the build area: the first such point of a route glows as its entry. */
  readonly isInsideBuildArea?: (x: number, y: number) => boolean;
}

interface FlowNode {
  readonly key: string;
  readonly x: number; readonly y: number;
  sx: number; sy: number;
  readonly preds: Set<FlowNode>;
  readonly succs: Set<FlowNode>;
  dist: number;
  heat: number;
  kept: boolean;
}

const SMOOTHING_PASSES = 4;
const MERGE_ENTRY_PX = 40;

/**
 * Smoothed, simplified stream tree of a set of routes. Deterministic for the same input; shared
 * route sections become one segment with their route count.
 */
export function buildRouteFlowGeometry(routes: readonly RouteFlowRoute[], options: RouteFlowGeometryOptions): RouteFlowGeometry {
  const nodes = new Map<string, FlowNode>();
  const edges = new Map<string, { usage: number; strength: number }>();
  const routeNodes: FlowNode[][] = [];
  const nodeAt = (point: RouteFlowPoint): FlowNode => {
    const key = `${Math.round(point.x * 2)}:${Math.round(point.y * 2)}`;
    let node = nodes.get(key);
    if (!node) {
      node = { key, x: point.x, y: point.y, sx: point.x, sy: point.y, preds: new Set(), succs: new Set(), dist: NaN, heat: 0, kept: false };
      nodes.set(key, node);
    }
    return node;
  };
  for (const route of routes) {
    const path: FlowNode[] = [];
    for (const point of route.points) {
      const node = nodeAt(point);
      if (path[path.length - 1] !== node && !path.includes(node)) path.push(node);
    }
    routeNodes.push(path);
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!, b = path[i]!;
      a.succs.add(b); b.preds.add(a);
      const key = edgeKey(a, b);
      const edge = edges.get(key) ?? { usage: 0, strength: 0 };
      edge.usage++; edge.strength = Math.max(edge.strength, route.strength);
      edges.set(key, edge);
    }
  }
  const passThrough = (node: FlowNode) => node.preds.size === 1 && node.succs.size === 1;

  // Laplacian smoothing rounds the field's 45° steps; sources, goals and junctions stay put.
  const smooth = [...nodes.values()].filter(passThrough);
  for (let pass = 0; pass < SMOOTHING_PASSES; pass++) {
    const next = smooth.map((node) => {
      const [a] = node.preds, [b] = node.succs;
      return [node.sx * .5 + (a!.sx + b!.sx) * .25, node.sy * .5 + (a!.sy + b!.sy) * .25] as const;
    });
    smooth.forEach((node, i) => { node.sx = next[i]![0]; node.sy = next[i]![1]; });
  }

  // Chains between junctions, simplified to the tolerance.
  const chains: FlowNode[][] = [];
  const walked = new Set<string>();
  const walk = (start: FlowNode, first: FlowNode) => {
    const chain = [start, first];
    walked.add(edgeKey(start, first));
    let node = first;
    while (passThrough(node)) {
      const [next] = node.succs;
      if (walked.has(edgeKey(node, next!))) break;
      walked.add(edgeKey(node, next!));
      chain.push(next!);
      node = next!;
    }
    chains.push(chain);
  };
  for (const node of nodes.values()) if (!passThrough(node)) for (const succ of node.succs) walk(node, succ);
  // Opposing routes can close a ring of pass-through nodes; it still becomes a chain.
  for (const node of nodes.values()) for (const succ of node.succs) if (!walked.has(edgeKey(node, succ))) walk(node, succ);
  for (const chain of chains) simplify(chain, options.tolerance);

  // Arc distance to the goal along each route. A route that joins a known stream continues its
  // values, so the pattern flows on across the junction.
  routes.forEach((route, index) => {
    const path = routeNodes[index]!;
    let acc = 0, offset = 0, fromEnd = 0;
    for (let i = path.length - 1; i >= 0; i--) {
      const node = path[i]!;
      if (i < path.length - 1) {
        const step = Math.hypot(node.sx - path[i + 1]!.sx, node.sy - path[i + 1]!.sy);
        acc += step; fromEnd += step;
      }
      if (Number.isNaN(node.dist)) node.dist = acc + offset;
      else offset = node.dist - acc;
      if (route.breach) node.heat = Math.max(node.heat, clamp01(1 - fromEnd / ROUTE_FLOW_SHAPE.heatRange));
    }
  });

  const segments: RouteFlowSegment[] = [];
  for (const chain of chains) {
    const kept = chain.filter((node, i) => i === 0 || i === chain.length - 1 || node.kept);
    const edge = edges.get(edgeKey(chain[0]!, chain[1]!))!;
    for (let i = 1; i < kept.length; i++) {
      const a = kept[i - 1]!, b = kept[i]!;
      if (Math.hypot(b.sx - a.sx, b.sy - a.sy) < .01) continue;
      segments.push({
        key: `${a.key}>${b.key}`, ax: a.sx, ay: a.sy, bx: b.sx, by: b.sy, distA: a.dist, distB: b.dist,
        usage: edge.usage, strength: edge.strength, heatA: a.heat, heatB: b.heat,
        joinA: i > 1 ? bisector(kept[i - 2]!, a, b) : null,
        joinB: i < kept.length - 1 ? bisector(a, b, kept[i + 1]!) : null,
      });
    }
  }

  const marks: RouteFlowMark[] = [];
  const sources = new Set<string>();
  const entries: { x: number; y: number; strength: number; routes: number }[] = [];
  routes.forEach((route, index) => {
    const path = routeNodes[index]!;
    const start = path[0];
    if (start && !sources.has(start.key)) {
      sources.add(start.key);
      marks.push({ key: `source:${start.key}`, kind: RouteFlowKind.Source, x: start.x, y: start.y,
        radius: ROUTE_FLOW_SHAPE.sourceRadius, strength: route.strength });
    }
    const inside = options.isInsideBuildArea;
    const entry = inside && !inside(path[0]?.x ?? NaN, path[0]?.y ?? NaN) ? path.find((node) => inside(node.x, node.y)) : undefined;
    if (entry) {
      const near = entries.find((other) => Math.hypot(other.x - entry.x, other.y - entry.y) < MERGE_ENTRY_PX);
      if (near) { near.routes++; near.strength = Math.max(near.strength, route.strength); }
      else entries.push({ x: entry.x, y: entry.y, strength: route.strength, routes: 1 });
    }
    const end = path[path.length - 1];
    if (route.breach && end) marks.push({ key: `breach:${end.key}`, kind: RouteFlowKind.Breach, x: end.x, y: end.y,
      radius: ROUTE_FLOW_SHAPE.breachRadius, strength: route.strength });
  });
  for (const entry of entries) marks.push({ key: `entry:${Math.round(entry.x)}:${Math.round(entry.y)}`, kind: RouteFlowKind.Entry,
    x: entry.x, y: entry.y, radius: ROUTE_FLOW_SHAPE.entryRadius * Math.min(1.6, Math.sqrt(entry.routes)), strength: entry.strength });

  const clip = options.clip;
  if (!clip) return { segments, marks };
  const margin = 64;
  const inClip = (x: number, y: number) => x >= clip.x - margin && y >= clip.y - margin
    && x <= clip.x + clip.width + margin && y <= clip.y + clip.height + margin;
  return {
    segments: segments.filter((segment) => inClip(segment.ax, segment.ay) || inClip(segment.bx, segment.by)),
    marks: marks.filter((mark) => inClip(mark.x, mark.y)),
  };
}

/** Stream half width (World px) of a segment shared by `usage` routes. */
export function routeFlowHalfWidth(usage: number): number {
  return ROUTE_FLOW_SHAPE.baseHalfWidth + ROUTE_FLOW_SHAPE.widthPerRoute * Math.sqrt(Math.max(1, usage));
}

/**
 * GPU instance buffer of one view of the routes. `unit` and `origin` place World pixels in the
 * layer's space (1 and 0 in the World; the panel transform on the minimap), `minHalfWidth` keeps
 * thin streams readable when they are scaled down.
 */
export class RouteFlowStore {
  readonly data = new Float32Array(ROUTE_FLOW_CAPACITY * ROUTE_FLOW_INSTANCE_FLOATS);
  count = 0;
  version = 0;
  /** Every plan rewrites the live range; the layer uploads it as one range. */
  readonly dirtyStart = 0;
  get dirtyEnd(): number { return this.count; }
  private bornAt = new Map<string, number>();

  constructor(private readonly placement: { readonly unit: number; readonly originX: number; readonly originY: number;
    readonly minHalfWidth: number } = { unit: 1, originX: 0, originY: 0, minHalfWidth: 0 }) {}

  /** Replaces the plan. Streams that were already flowing keep their age; new ones fade in. */
  setGeometry(geometry: RouteFlowGeometry, clockMs: number): void {
    const born = new Map<string, number>();
    const bornAt = (key: string) => {
      const at = this.bornAt.get(key) ?? clockMs;
      born.set(key, at);
      return at;
    };
    this.count = 0;
    for (const segment of geometry.segments) {
      if (this.count >= ROUTE_FLOW_CAPACITY) break;
      this.writeSegment(this.count++, segment, bornAt(segment.key));
    }
    for (const mark of geometry.marks) {
      if (this.count >= ROUTE_FLOW_CAPACITY) break;
      this.writeMark(this.count++, mark, bornAt(mark.key));
    }
    this.bornAt = born;
    this.version++;
  }

  clear(): void {
    if (this.count === 0) return;
    this.count = 0;
    this.bornAt.clear();
    this.version++;
  }

  private writeSegment(slot: number, segment: RouteFlowSegment, bornAt: number): void {
    const { unit, originX, originY } = this.placement;
    const dx = segment.bx - segment.ax, dy = segment.by - segment.ay;
    const length = Math.hypot(dx, dy);
    const cos = dx / length, sin = dy / length;
    const halfWidth = Math.max(this.placement.minHalfWidth, routeFlowHalfWidth(segment.usage) * unit);
    const local = (n: readonly [number, number] | null): [number, number] => n
      ? [n[0] * cos + n[1] * sin, -n[0] * sin + n[1] * cos] : [0, 0];
    const [nax, nay] = local(segment.joinA);
    const [nbx, nby] = local(segment.joinB);
    const pad = halfWidth * ROUTE_FLOW_SHAPE.stainReach + 2;
    this.writeQuad(slot, originX + segment.ax * unit, originY + segment.ay * unit, cos, sin,
      -pad, length * unit + pad, -pad, pad,
      [length * unit, halfWidth, cos, sin], [nax, nay, nbx, nby],
      [segment.distA, segment.distB, segment.usage, RouteFlowKind.Segment],
      [bornAt, segment.strength, segment.heatA, segment.heatB]);
  }

  private writeMark(slot: number, mark: RouteFlowMark, bornAt: number): void {
    const { unit, originX, originY } = this.placement;
    const radius = Math.max(this.placement.minHalfWidth * 3, mark.radius * unit);
    const pad = radius * 1.25 + 2;
    this.writeQuad(slot, originX + mark.x * unit, originY + mark.y * unit, 1, 0, -pad, pad, -pad, pad,
      [radius, radius, 1, 0], [0, 0, 0, 0], [0, 0, 1, mark.kind], [bornAt, mark.strength, 0, 0]);
  }

  private writeQuad(slot: number, x: number, y: number, cos: number, sin: number,
    left: number, right: number, top: number, bottom: number,
    shape: readonly number[], join: readonly number[], flow: readonly number[], misc: readonly number[]): void {
    const corners = [left, top, right, top, right, bottom, left, top, right, bottom, left, bottom];
    let o = slot * ROUTE_FLOW_INSTANCE_FLOATS;
    const d = this.data;
    for (let v = 0; v < ROUTE_FLOW_VERTICES; v++) {
      const lx = corners[v * 2]!, ly = corners[v * 2 + 1]!;
      d[o++] = x + lx * cos - ly * sin; d[o++] = y + lx * sin + ly * cos;
      d[o++] = lx; d[o++] = ly;
      for (let i = 0; i < 4; i++) d[o++] = shape[i]!;
      for (let i = 0; i < 4; i++) d[o++] = join[i]!;
      for (let i = 0; i < 4; i++) d[o++] = flow[i]!;
      for (let i = 0; i < 4; i++) d[o++] = misc[i]!;
    }
  }
}

function edgeKey(a: FlowNode, b: FlowNode): string {
  return `${a.key}>${b.key}`;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Plane normal through the joint `b`, along travel: the normalised sum of both directions. */
function bisector(a: FlowNode, b: FlowNode, c: FlowNode): [number, number] | null {
  const l1 = Math.hypot(b.sx - a.sx, b.sy - a.sy), l2 = Math.hypot(c.sx - b.sx, c.sy - b.sy);
  if (l1 < .01 || l2 < .01) return null;
  const x = (b.sx - a.sx) / l1 + (c.sx - b.sx) / l2, y = (b.sy - a.sy) / l1 + (c.sy - b.sy) / l2;
  const length = Math.hypot(x, y);
  return length < .05 ? null : [x / length, y / length];
}

/** Ramer–Douglas–Peucker on the smoothed positions; marks the nodes that stay. */
function simplify(chain: readonly FlowNode[], tolerance: number): void {
  chain[0]!.kept = true;
  chain[chain.length - 1]!.kept = true;
  const stack: [number, number][] = [[0, chain.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    const a = chain[first]!, b = chain[last]!;
    const dx = b.sx - a.sx, dy = b.sy - a.sy, length = Math.hypot(dx, dy);
    let worst = -1, worstDistance = tolerance;
    for (let i = first + 1; i < last; i++) {
      const node = chain[i]!;
      const distance = length < .01 ? Math.hypot(node.sx - a.sx, node.sy - a.sy)
        : Math.abs((node.sx - a.sx) * dy - (node.sy - a.sy) * dx) / length;
      if (distance > worstDistance) { worst = i; worstDistance = distance; }
    }
    // Long straight runs still get a joint now and then, so the stream's meander has room to bend.
    if (worst < 0 && last - first > 24) worst = (first + last) >> 1;
    if (worst < 0) continue;
    chain[worst]!.kept = true;
    stack.push([first, worst], [worst, last]);
  }
}
