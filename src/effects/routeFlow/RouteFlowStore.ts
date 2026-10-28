/**
 * Instance data of the situation map's enemy routes ("Void-Strömung"). Pure data: no Phaser, no GL.
 *
 * Flow-field routes of one field form a tree: where two routes meet they continue on the same
 * nodes. The geometry keeps that tree. Shared edges become one stream whose width grows with the
 * number of routes on it, and every vertex carries the arc distance to its route's goal. The
 * shader moves its pattern along that distance, so merged streams flow on seamlessly.
 *
 * The tree's chains are drawn as strokes: at a junction the best aligned arm runs on into the
 * trunk around a rounded bend, the other arms flow into the trunk and fade out there (or fade in
 * from it where routes part). A stroke widens and narrows smoothly, gathers out of its spawn
 * zone's void haze (wide and faint at the source, a stream where it leaves the zone). At its goal it
 * parts into arms that lie along the target, as enemies spread around a base to attack it, and fade.
 * Quality over cell accuracy: the stream follows the routes, not their grid.
 *
 * A portal jump is no walk: the stream ends in the entry and rises again out of the exit, and the
 * jump between them is drawn as its own arc.
 *
 * One instance is one quad (six non-indexed vertices): a stream segment, a portal jump or a breach.
 * The CPU writes only when the plan changes.
 */

export const ROUTE_FLOW_FLOATS_PER_VERTEX = 20;
export const ROUTE_FLOW_VERTICES = 6;
export const ROUTE_FLOW_INSTANCE_FLOATS = ROUTE_FLOW_FLOATS_PER_VERTEX * ROUTE_FLOW_VERTICES;
export const ROUTE_FLOW_CAPACITY = 2048;

export const RouteFlowKind = { Segment: 0, Jump: 1, Breach: 3 } as const;
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
  breachRadius: 52,
  /** A portal jump arcs `jumpLift` of its length (at most `jumpLiftMax`) off the straight line. */
  jumpHalfWidth: 2.5, jumpLift: .14, jumpLiftMax: 180,
} as const;

/** How strokes begin, join, part and end (World px unless noted). */
const STREAM_EASE = {
  /**
   * Out of its source the current gathers: wide and faint where the zone's haze is thickest, a stream
   * `gatherPast` beyond the zone's rim (at least `gatherMin` from the source).
   */
  gatherMin: 96, gatherPast: 64, gatherWidth: .9,
  /** Where routes join or part, width and brightness change over this length. */
  widthRamp: 72,
  /** A tributary runs on inside the trunk for this many trunk half widths and fades; a branch fades in. */
  confluence: 3.4, confluenceMin: 28, confluenceMax: 84,
  /** The current flows this far past its goal (about to the wall) and dissolves over `goalFade`, fanning out a little. */
  goalReach: 30, goalFade: 70, goalFan: .35,
  /** Joints that turn more than this (cosine) get a rounded bend of up to `cornerRadius` half widths. */
  cornerCos: .97, cornerRadius: 3,
  /** Sample spacing where width or presence change. */
  rampStep: 12,
} as const;

export interface RouteFlowPoint {
  readonly x: number; readonly y: number;
  /** Reached from the previous point through a portal: a jump, not a walk. */
  readonly portal?: boolean;
}

export interface RouteFlowRoute {
  /** From the source to the goal or the breach, World pixels. */
  readonly points: readonly RouteFlowPoint[];
  /** The last point is where enemies break through a sealed base. */
  readonly breach: boolean;
  /** 0..1; dim routes pass the view without mattering for the base. */
  readonly strength: number;
  /** Arc length (World px) from the source to where the route leaves its spawn zone. */
  readonly sourceReach?: number;
  /** From the route's end along its target: where enemies spread to attack it. */
  readonly arms?: readonly (readonly RouteFlowPoint[])[];
}

export interface RouteFlowSegment {
  readonly key: string;
  readonly ax: number; readonly ay: number;
  readonly bx: number; readonly by: number;
  /** Arc distance to the goal at both ends (World px); it falls along the stream. */
  readonly distA: number; readonly distB: number;
  /** Routes sharing this section of the stream. */
  readonly usage: number;
  /** Stream half width at both ends (World px). */
  readonly halfWidthA: number; readonly halfWidthB: number;
  /** Route strength times how much of the current is there (0..1) at both ends. */
  readonly presenceA: number; readonly presenceB: number;
  /** The route strength this section belongs to; `presence` below it means the current fades. */
  readonly strength: number;
  /** 0..1 towards a breach. */
  readonly heatA: number; readonly heatB: number;
  /** Bisector plane normals at both joints, oriented along travel; null = open (round) end. */
  readonly joinA: readonly [number, number] | null;
  readonly joinB: readonly [number, number] | null;
}

export interface RouteFlowMark {
  readonly key: string;
  readonly kind: typeof RouteFlowKind.Breach;
  readonly x: number; readonly y: number;
  readonly radius: number;
  readonly strength: number;
}

/** A portal jump from its entry to its exit, World pixels. */
export interface RouteFlowJump {
  readonly key: string;
  readonly ax: number; readonly ay: number;
  readonly bx: number; readonly by: number;
  readonly strength: number;
}

export interface RouteFlowGeometry {
  readonly segments: readonly RouteFlowSegment[];
  readonly jumps: readonly RouteFlowJump[];
  readonly marks: readonly RouteFlowMark[];
}

export interface RouteFlowGeometryOptions {
  /** Max distance (World px) a simplified stream may leave the smoothed route. */
  readonly tolerance: number;
  /** Segments and marks entirely outside this rectangle are dropped. */
  readonly clip?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
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

interface FlowEdge { usage: number; strength: number }

const SMOOTHING_PASSES = 4;
/** Arms carry a little less than the stream they part from. */
const ARM_STRENGTH = .85;

/**
 * Smoothed, simplified stream tree of a set of routes. Deterministic for the same input; shared
 * route sections become one segment with their route count.
 */
export function buildRouteFlowGeometry(input: readonly RouteFlowRoute[], options: RouteFlowGeometryOptions): RouteFlowGeometry {
  const jumpsByKey = new Map<string, RouteFlowJump>();
  const routes = input.flatMap((route) => splitAtPortals(route, jumpsByKey));
  const jumps = [...jumpsByKey.values()];
  const nodes = new Map<string, FlowNode>();
  const edges = new Map<string, FlowEdge>();
  const routeNodes: FlowNode[][] = [];
  const armNodes: FlowNode[][] = [];
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
    // Routes on an edge widen it; arms only lie along the target, however many reach it.
    const link = (a: FlowNode, b: FlowNode, strength: number, widen = true) => {
      a.succs.add(b); b.preds.add(a);
      const key = edgeKey(a, b);
      const edge = edges.get(key) ?? { usage: 0, strength: 0 };
      edge.usage = widen ? edge.usage + 1 : Math.max(edge.usage, 1); edge.strength = Math.max(edge.strength, strength);
      edges.set(key, edge);
    };
    for (let i = 1; i < path.length; i++) link(path[i - 1]!, path[i]!, route.strength);
    // At the goal the stream parts and lies along the target.
    const end = path[path.length - 1];
    if (end) for (const arm of route.arms ?? []) {
      const nodes = [end];
      for (const point of arm) {
        const node = nodeAt(point);
        if (nodes.includes(node) || path.includes(node)) continue;
        link(nodes[nodes.length - 1]!, node, route.strength * ARM_STRENGTH, false);
        nodes.push(node);
      }
      if (nodes.length > 1) armNodes.push(nodes);
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
  // Arms run on past the goal: their distance keeps falling, so the pattern flows into them.
  for (const nodes of armNodes) {
    let acc = 0;
    for (let i = 1; i < nodes.length; i++) {
      const a = nodes[i - 1]!, b = nodes[i]!;
      acc += Math.hypot(b.sx - a.sx, b.sy - a.sy);
      if (Number.isNaN(b.dist)) b.dist = nodes[0]!.dist - acc;
    }
  }

  // A source gathers its current over the longest way out of its zone.
  const gather = new Map<FlowNode, number>();
  routes.forEach((route, index) => {
    const start = routeNodes[index]![0];
    if (start) gather.set(start, Math.max(gather.get(start) ?? 0, route.sourceReach ?? 0));
  });
  const segments = buildStrokeSegments(chains.map((chain) => {
    const edge = edges.get(edgeKey(chain[0]!, chain[1]!))!;
    return { nodes: chain.filter((node, i) => i === 0 || i === chain.length - 1 || node.kept), usage: edge.usage, strength: edge.strength };
  }), gather);

  const marks: RouteFlowMark[] = [];
  routes.forEach((route, index) => {
    const path = routeNodes[index]!;
    const end = path[path.length - 1];
    if (route.breach && end) marks.push({ key: `breach:${end.key}`, kind: RouteFlowKind.Breach, x: end.x, y: end.y,
      radius: ROUTE_FLOW_SHAPE.breachRadius, strength: route.strength });
  });

  const clip = options.clip;
  if (!clip) return { segments, jumps, marks };
  const margin = 64;
  const inClip = (x: number, y: number) => x >= clip.x - margin && y >= clip.y - margin
    && x <= clip.x + clip.width + margin && y <= clip.y + clip.height + margin;
  // A jump arcs over the view even when both its portals lie outside it.
  const crosses = (jump: RouteFlowJump) => {
    const lift = Math.min(ROUTE_FLOW_SHAPE.jumpLift * Math.hypot(jump.bx - jump.ax, jump.by - jump.ay), ROUTE_FLOW_SHAPE.jumpLiftMax);
    return Math.max(jump.ax, jump.bx) + lift >= clip.x - margin && Math.min(jump.ax, jump.bx) - lift <= clip.x + clip.width + margin
      && Math.max(jump.ay, jump.by) + lift >= clip.y - margin && Math.min(jump.ay, jump.by) - lift <= clip.y + clip.height + margin;
  };
  return {
    segments: segments.filter((segment) => inClip(segment.ax, segment.ay) || inClip(segment.bx, segment.by)),
    jumps: jumps.filter(crosses),
    marks: marks.filter((mark) => inClip(mark.x, mark.y)),
  };
}

/**
 * The walked parts of a route between its portal jumps; each jump is recorded once, with the
 * strongest route through it. The source gathers into the first part, breach and arms belong to the last.
 */
function splitAtPortals(route: RouteFlowRoute, jumps: Map<string, RouteFlowJump>): RouteFlowRoute[] {
  const cuts = route.points.flatMap((point, i) => i > 0 && point.portal ? [i] : []);
  if (!cuts.length) return [route];
  const parts: RouteFlowRoute[] = [];
  let start = 0;
  for (const cut of [...cuts, route.points.length]) {
    const last = cut === route.points.length;
    parts.push({ points: route.points.slice(start, cut), strength: route.strength, breach: last && route.breach,
      ...(start === 0 && route.sourceReach !== undefined ? { sourceReach: route.sourceReach } : {}),
      ...(last && route.arms ? { arms: route.arms } : {}) });
    if (!last) {
      const a = route.points[cut - 1]!, b = route.points[cut]!;
      const key = `jump:${Math.round(a.x * 2)}:${Math.round(a.y * 2)}>${Math.round(b.x * 2)}:${Math.round(b.y * 2)}`;
      if ((jumps.get(key)?.strength ?? -1) < route.strength) jumps.set(key, { key, ax: a.x, ay: a.y, bx: b.x, by: b.y, strength: route.strength });
    }
    start = cut;
  }
  return parts;
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
    for (const jump of geometry.jumps) {
      if (this.count >= ROUTE_FLOW_CAPACITY) break;
      if (Math.hypot(jump.bx - jump.ax, jump.by - jump.ay) >= 1) this.writeJump(this.count++, jump, bornAt(jump.key));
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
    const { unit, originX, originY, minHalfWidth } = this.placement;
    const dx = segment.bx - segment.ax, dy = segment.by - segment.ay;
    const length = Math.hypot(dx, dy);
    const cos = dx / length, sin = dy / length;
    const halfWidthA = Math.max(minHalfWidth, segment.halfWidthA * unit);
    const halfWidthB = Math.max(minHalfWidth, segment.halfWidthB * unit);
    const local = (n: readonly [number, number] | null): [number, number] => n
      ? [n[0] * cos + n[1] * sin, -n[0] * sin + n[1] * cos] : [0, 0];
    const [nax, nay] = local(segment.joinA);
    const [nbx, nby] = local(segment.joinB);
    const pad = Math.max(halfWidthA, halfWidthB) * ROUTE_FLOW_SHAPE.stainReach + 2;
    this.writeQuad(slot, originX + segment.ax * unit, originY + segment.ay * unit, cos, sin,
      -pad, length * unit + pad, -pad, pad,
      [length * unit, halfWidthA, halfWidthB, segment.presenceA], [nax, nay, nbx, nby],
      [segment.distA, segment.distB, segment.presenceB, RouteFlowKind.Segment],
      [bornAt, segment.strength, segment.heatA, segment.heatB]);
  }

  /** The jump's quad spans the straight line and the side it arcs to; the shader draws the arc. */
  private writeJump(slot: number, jump: RouteFlowJump, bornAt: number): void {
    const { unit, originX, originY, minHalfWidth } = this.placement;
    const dx = jump.bx - jump.ax, dy = jump.by - jump.ay;
    const length = Math.hypot(dx, dy);
    const cos = dx / length, sin = dy / length;
    const lift = Math.min(ROUTE_FLOW_SHAPE.jumpLift * length, ROUTE_FLOW_SHAPE.jumpLiftMax) * unit;
    const halfWidth = Math.max(minHalfWidth, ROUTE_FLOW_SHAPE.jumpHalfWidth * unit);
    const pad = halfWidth * 4 + 2;
    this.writeQuad(slot, originX + jump.ax * unit, originY + jump.ay * unit, cos, sin,
      -pad, length * unit + pad, -lift - pad, pad,
      [length * unit, halfWidth, lift, 1], [0, 0, 0, 0], [0, 0, 1, RouteFlowKind.Jump], [bornAt, jump.strength, 0, 0]);
  }

  private writeMark(slot: number, mark: RouteFlowMark, bornAt: number): void {
    const { unit, originX, originY } = this.placement;
    const radius = Math.max(this.placement.minHalfWidth * 3, mark.radius * unit);
    const pad = radius * 1.25 + 2;
    this.writeQuad(slot, originX + mark.x * unit, originY + mark.y * unit, 1, 0, -pad, pad, -pad, pad,
      [radius, radius, radius, 1], [0, 0, 0, 0], [0, 0, 1, mark.kind], [bornAt, mark.strength, 0, 0]);
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

/** A simplified chain of the tree: its kept nodes and the routes on it. */
interface FlowChain { readonly nodes: readonly FlowNode[]; readonly usage: number; readonly strength: number }

/** What a section of a stroke carries: the chain it came from. */
interface StrokeBase { readonly usage: number; readonly halfWidth: number; readonly strength: number }

interface StrokePoint {
  readonly x: number; readonly y: number;
  readonly dist: number; readonly heat: number;
  readonly key: string;
  /** Base of the section that starts at this point. */
  readonly base: StrokeBase;
}

interface Stroke {
  points: StrokePoint[];
  /** Arc length of a head (a branch fading in from a trunk) at the start, of a tail (fading into one) at the end. */
  head: number;
  tail: number;
  /** Arc length over which the current gathers out of its source; 0 when the stroke starts elsewhere. */
  gather: number;
  toGoal: boolean;
}

/**
 * Strokes from the chains: arms paired across junctions, tails into and heads out of trunks,
 * rounded bends, then sampled densely wherever width or presence change.
 */
function buildStrokeSegments(chains: readonly FlowChain[], gather: ReadonlyMap<FlowNode, number>): RouteFlowSegment[] {
  const usable = chains.filter((chain) => chain.nodes.length >= 2);
  const baseOf = new Map<FlowChain, StrokeBase>(usable.map((chain) => [chain,
    { usage: chain.usage, halfWidth: routeFlowHalfWidth(chain.usage), strength: chain.strength }]));
  const ins = new Map<FlowNode, FlowChain[]>(), outs = new Map<FlowNode, FlowChain[]>();
  for (const chain of usable) {
    const first = chain.nodes[0]!, last = chain.nodes[chain.nodes.length - 1]!;
    if (first === last) continue;
    push(outs, first, chain);
    push(ins, last, chain);
  }
  const inDir = (chain: FlowChain) => direction(chain.nodes[chain.nodes.length - 2]!, chain.nodes[chain.nodes.length - 1]!);
  const outDir = (chain: FlowChain) => direction(chain.nodes[0]!, chain.nodes[1]!);
  const turn = (a: readonly [number, number], b: readonly [number, number]) => a[0] * b[0] + a[1] * b[1];

  // Each junction lets its best aligned arms run on; the rest fade into or out of the trunk.
  const next = new Map<FlowChain, FlowChain>(), previous = new Map<FlowChain, FlowChain>();
  for (const [node, incoming] of ins) {
    const outgoing = outs.get(node);
    if (!outgoing) continue;
    const pairs = incoming.flatMap((a) => outgoing.map((b) => ({ a, b, cos: turn(inDir(a), outDir(b)) })))
      .filter((pair) => pair.cos > -.2).sort((p, q) => q.cos - p.cos || q.b.usage - p.b.usage);
    for (const { a, b } of pairs) if (!next.has(a) && !previous.has(b)) { next.set(a, b); previous.set(b, a); }
  }

  const strokes: Stroke[] = [];
  const used = new Set<FlowChain>();
  const follow = (start: FlowChain) => {
    const points: StrokePoint[] = [];
    let chain: FlowChain | undefined = start;
    let last: FlowChain = start;
    while (chain && !used.has(chain)) {
      used.add(chain);
      const base = baseOf.get(chain)!;
      chain.nodes.forEach((node, i) => {
        // The joint starts the next chain's section.
        if (i === 0 && points.length) points[points.length - 1] = { ...points[points.length - 1]!, base };
        else points.push({ x: node.sx, y: node.sy, dist: node.dist, heat: node.heat, key: node.key, base });
      });
      last = chain;
      chain = next.get(chain);
    }
    const first = start.nodes[0]!, end = last.nodes[last.nodes.length - 1]!;
    const stroke: Stroke = { points, head: 0, tail: 0, toGoal: end.succs.size === 0,
      gather: first.preds.size === 0 ? Math.max(STREAM_EASE.gatherMin, (gather.get(first) ?? 0) + STREAM_EASE.gatherPast) : 0 };
    // A branch that parts from a trunk starts inside it; a tributary runs on inside it.
    const from = ins.get(first)?.filter((chain) => chain !== start);
    if (!previous.has(start) && from?.length) {
      const trunk = from.reduce((best, chain) => turn(inDir(chain), outDir(start)) > turn(inDir(best), outDir(start)) ? chain : best);
      const head = alongChain([...trunk.nodes].reverse(), confluenceLength(baseOf.get(trunk)!));
      stroke.head = head.length;
      points.unshift(...head.points.reverse().map((point) => ({ ...point, dist: first.dist + point.arc, heat: first.heat,
        key: `${first.key}<${point.key}`, base: points[0]!.base })));
    }
    const into = outs.get(end)?.filter((chain) => chain !== last);
    if (!next.has(last) && into?.length) {
      const trunk = into.reduce((best, chain) => turn(inDir(last), outDir(chain)) > turn(inDir(last), outDir(best)) ? chain : best);
      const tail = alongChain(trunk.nodes, confluenceLength(baseOf.get(trunk)!));
      stroke.tail = tail.length;
      const base = points[points.length - 1]!.base;
      points.push(...tail.points.map((point) => ({ ...point, dist: end.dist - point.arc, heat: end.heat, key: `${end.key}>${point.key}`, base })));
    } else if (stroke.toGoal && end.heat < .5 && points.length >= 2) {
      // Past the goal the current runs on a little and dissolves against the base.
      const [dx, dy] = direction(points[points.length - 2]!, end);
      points.push({ x: end.x + dx * STREAM_EASE.goalReach, y: end.y + dy * STREAM_EASE.goalReach,
        dist: end.dist - STREAM_EASE.goalReach, heat: end.heat, key: `${end.key}>goal`, base: points[points.length - 1]!.base });
    }
    strokes.push({ ...stroke, points: roundCorners(points) });
  };
  for (const chain of usable) if (!previous.has(chain)) follow(chain);
  for (const chain of usable) if (!used.has(chain)) follow(chain);

  return strokes.flatMap(strokeSegments);
}

/** Up to `length` along a chain's nodes from its first, with the arc of every point. */
function alongChain(nodes: readonly FlowNode[], length: number): { points: (StrokePoint & { arc: number })[]; length: number } {
  const points: (StrokePoint & { arc: number })[] = [];
  let arc = 0;
  for (let i = 1; i < nodes.length && arc < length; i++) {
    const a = nodes[i - 1]!, b = nodes[i]!;
    const step = Math.hypot(b.sx - a.sx, b.sy - a.sy);
    if (step < .01) continue;
    const t = Math.min(1, (length - arc) / step);
    arc += step * t;
    points.push({ x: a.sx + (b.sx - a.sx) * t, y: a.sy + (b.sy - a.sy) * t, dist: 0, heat: 0, arc,
      key: t < 1 ? `${b.key}@${Math.round(t * 100)}` : b.key, base: { usage: 0, halfWidth: 0, strength: 0 } });
  }
  return { points, length: arc };
}

function confluenceLength(trunk: StrokeBase): number {
  return Math.max(STREAM_EASE.confluenceMin, Math.min(STREAM_EASE.confluenceMax, trunk.halfWidth * STREAM_EASE.confluence));
}

/** Rounded bends: every sharp joint becomes a quadratic curve between its two neighbouring segments. */
function roundCorners(points: readonly StrokePoint[]): StrokePoint[] {
  if (points.length < 3) return [...points];
  const result: StrokePoint[] = [points[0]!];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1]!, b = points[i]!, c = points[i + 1]!;
    const l1 = Math.hypot(b.x - a.x, b.y - a.y), l2 = Math.hypot(c.x - b.x, c.y - b.y);
    const cos = l1 < .01 || l2 < .01 ? 1 : ((b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y)) / (l1 * l2);
    if (cos > STREAM_EASE.cornerCos) { result.push(b); continue; }
    const radius = Math.min(.45 * l1, .45 * l2, STREAM_EASE.cornerRadius * Math.max(a.base.halfWidth, b.base.halfWidth));
    const t0 = radius / l1, t2 = radius / l2;
    const p0 = { x: b.x + (a.x - b.x) * t0, y: b.y + (a.y - b.y) * t0, dist: b.dist + (a.dist - b.dist) * t0, heat: b.heat + (a.heat - b.heat) * t0 };
    const p2 = { x: b.x + (c.x - b.x) * t2, y: b.y + (c.y - b.y) * t2, dist: b.dist + (c.dist - b.dist) * t2, heat: b.heat + (c.heat - b.heat) * t2 };
    const steps = Math.max(2, Math.min(8, Math.ceil(Math.acos(Math.max(-1, cos)) / .2)));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps, u = 1 - t;
      result.push({ x: u * u * p0.x + 2 * u * t * b.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * b.y + t * t * p2.y,
        dist: p0.dist + (p2.dist - p0.dist) * t, heat: p0.heat + (p2.heat - p0.heat) * t,
        key: `${b.key}~${k}`, base: k * 2 < steps ? a.base : b.base });
    }
  }
  result.push(points[points.length - 1]!);
  return result;
}

/** One stroke as segments: width, presence and their ramps sampled along its arc. */
function strokeSegments(stroke: Stroke): RouteFlowSegment[] {
  const points = stroke.points.filter((point, i) => i === 0
    || Math.hypot(point.x - stroke.points[i - 1]!.x, point.y - stroke.points[i - 1]!.y) >= .01);
  if (points.length < 2) return [];
  const arcs = [0];
  for (let i = 1; i < points.length; i++) arcs.push(arcs[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y));
  const total = arcs[arcs.length - 1]!;

  // Where routes join or part, width and strength move to the next chain's over a short ramp:
  // after the joint where the stream grows, before it where it shrinks.
  const ramps: { at: number; from: number; to: number; width: number; strength: number }[] = [];
  const first = points[0]!.base;
  for (let i = 1; i < points.length - 1; i++) {
    const before = points[i - 1]!.base, after = points[i]!.base;
    if (before === after) continue;
    const grows = after.halfWidth >= before.halfWidth;
    ramps.push({ at: arcs[i]!, from: arcs[i]! - (grows ? 6 : STREAM_EASE.widthRamp), to: arcs[i]! + (grows ? STREAM_EASE.widthRamp : 6),
      width: after.halfWidth - before.halfWidth, strength: after.strength - before.strength });
  }
  const goalFrom = total - STREAM_EASE.goalFade - STREAM_EASE.goalReach;
  // The goal's dissolve is measured from where the stroke ends: past a goal, or at an arm's tip.
  const endDist = points[points.length - 1]!.dist;
  const busy: [number, number][] = [...ramps.map((ramp) => [ramp.from, ramp.to] as [number, number])];
  if (stroke.gather) busy.push([0, stroke.gather]);
  if (stroke.head) busy.push([0, stroke.head * 1.25]);
  if (stroke.tail) busy.push([total - stroke.tail * 1.25, total]);
  if (stroke.toGoal) busy.push([goalFrom, total]);

  const sample = (s: number, dist: number, heat: number) => {
    let halfWidth = first.halfWidth, strength = first.strength;
    for (const ramp of ramps) {
      const t = smoothstep(ramp.from, ramp.to, s);
      halfWidth += ramp.width * t; strength += ramp.strength * t;
    }
    let width = 1, presence = 1;
    if (stroke.gather) {
      // Inside the zone the haze is the current; the stream draws itself together towards the rim.
      const gathered = smoothstep(0, stroke.gather, s);
      width *= 1 + STREAM_EASE.gatherWidth * (1 - gathered);
      presence *= gathered;
    }
    if (stroke.head) {
      presence *= smoothstep(0, stroke.head * 1.25, s);
      width *= .6 + .4 * smoothstep(0, stroke.head, s);
    }
    if (stroke.tail) {
      presence *= 1 - smoothstep(total - stroke.tail * 1.25, total, s);
      width *= 1 - .4 * smoothstep(total - stroke.tail, total, s);
    }
    if (stroke.toGoal) {
      const fade = smoothstep(endDist, endDist + STREAM_EASE.goalReach + STREAM_EASE.goalFade, dist);
      // A breach keeps boiling against the wall.
      presence *= Math.max(fade, heat * .85);
      width *= 1 + STREAM_EASE.goalFan * (1 - fade) * (1 - heat);
    }
    return { halfWidth: halfWidth * width, presence: strength * presence, strength };
  };

  const samples: { point: StrokePoint; s: number }[] = [{ point: points[0]!, s: 0 }];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!, s0 = arcs[i - 1]!, s1 = arcs[i]!;
    const dense = busy.some(([from, to]) => s1 > from && s0 < to);
    const pieces = dense ? Math.ceil((s1 - s0) / STREAM_EASE.rampStep) : 1;
    for (let k = 1; k < pieces; k++) {
      const t = k / pieces;
      samples.push({ s: s0 + (s1 - s0) * t, point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
        dist: a.dist + (b.dist - a.dist) * t, heat: a.heat + (b.heat - a.heat) * t, key: `${a.key}>${b.key}/${k}`, base: a.base } });
    }
    samples.push({ point: b, s: s1 });
  }

  const values = samples.map(({ point, s }) => sample(s, point.dist, point.heat));
  const segments: RouteFlowSegment[] = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!.point, b = samples[i]!.point, va = values[i - 1]!, vb = values[i]!;
    segments.push({
      key: `${a.key}>${b.key}`, ax: a.x, ay: a.y, bx: b.x, by: b.y, distA: a.dist, distB: b.dist, usage: a.base.usage,
      halfWidthA: va.halfWidth, halfWidthB: vb.halfWidth, presenceA: va.presence, presenceB: vb.presence,
      strength: Math.max(va.strength, vb.strength), heatA: a.heat, heatB: b.heat,
      joinA: i > 1 ? bisector(samples[i - 2]!.point, a, b) : null,
      joinB: i < samples.length - 1 ? bisector(a, b, samples[i + 1]!.point) : null,
    });
  }
  return segments;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value); else map.set(key, [value]);
}

function direction(a: { readonly sx?: number; readonly sy?: number; readonly x: number; readonly y: number },
  b: { readonly sx?: number; readonly sy?: number; readonly x: number; readonly y: number }): [number, number] {
  const dx = (b.sx ?? b.x) - (a.sx ?? a.x), dy = (b.sy ?? b.y) - (a.sy ?? a.y);
  const length = Math.hypot(dx, dy);
  return length < 1e-6 ? [0, 0] : [dx / length, dy / length];
}

function edgeKey(a: FlowNode, b: FlowNode): string {
  return `${a.key}>${b.key}`;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / Math.max(1e-6, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Plane normal through the joint `b`, along travel: the normalised sum of both directions. */
function bisector(a: RouteFlowPoint, b: RouteFlowPoint, c: RouteFlowPoint): [number, number] | null {
  const l1 = Math.hypot(b.x - a.x, b.y - a.y), l2 = Math.hypot(c.x - b.x, c.y - b.y);
  if (l1 < .01 || l2 < .01) return null;
  const x = (b.x - a.x) / l1 + (c.x - b.x) / l2, y = (b.y - a.y) / l1 + (c.y - b.y) / l2;
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
