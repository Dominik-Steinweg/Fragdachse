import { CELL_SIZE } from '../config';
import type { WorldVoidDangerConfig } from '../config/nightWorld';
import type { KrakenHabitatConfig } from '../config/krakenHabitat';
import type { WorldSpawnZone } from '../config/spawnZones';
import { ecologyHash } from './ecologyHash';

/** Outline of a danger area in world px; its rim fades outside it. */
export type VoidDangerShape =
  | { readonly kind: 'disc'; readonly x: number; readonly y: number; readonly radius: number }
  | { readonly kind: 'rect'; readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  | { readonly kind: 'capsule'; readonly ax: number; readonly ay: number; readonly bx: number; readonly by: number; readonly radius: number }
  /** Arena cells (top-left `offsetX`/`offsetY`), e.g. the cells of a permanent ground hazard. */
  | { readonly kind: 'cells'; readonly offsetX: number; readonly offsetY: number; readonly cells: readonly { readonly gridX: number; readonly gridY: number }[] };

/**
 * One dangerous place (GDD Void-Gefahrenzonen V1, E2/E3). `plants` is how strongly the void has
 * taken the flora and soaked the ground there, `haze` how thick its spore haze hangs. Plants are
 * static scars; the haze follows the place's presence (a destroyed base, a closed site).
 */
export interface VoidDangerSource {
  /** Stable key, e.g. `base:<id>`, `zone:<id>`, `habitat`, `hazard:<eventId>`; presence is looked up by it. */
  readonly id: string;
  readonly shapes: readonly VoidDangerShape[];
  /** World px over which the takeover fades out around the shapes. */
  readonly rim: number;
  readonly plants: number;
  readonly haze: number;
}

/** Axis-aligned world rectangle. */
export interface VoidDangerBounds { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

/** Salt of the per-plant variation; independent of every placement roll, so positions never change. */
const TAKEOVER_SALT = 0x5f0d;
/** Per-plant variation of the infestation; small, so neighbours stay alike. */
const PLANT_JITTER = .05;
/** The rim is broken by noise of this many rim widths per cell, by up to this share of the rim. */
const RIM_NOISE_SCALE = 1.4, RIM_NOISE = .55;
/** The takeover is complete a little inside the outline, so the outline itself never shows. */
const RIM_INNER = .2;

const smooth = (edge0: number, edge1: number, value: number): number => {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** Signed distance to a shape (negative inside), world px; cells use a precomputed distance grid. */
interface ResolvedShape {
  readonly bounds: VoidDangerBounds;
  distance(x: number, y: number): number;
}

interface ResolvedSource {
  readonly source: VoidDangerSource;
  readonly shapes: readonly ResolvedShape[];
  /** Shapes plus rim and rim noise: nothing of this source reaches outside. */
  readonly reach: VoidDangerBounds;
  readonly salt: number;
}

/**
 * Deterministic void danger of one World plus its Activity (GDD Void-Gefahrenzonen V1),
 * presentation only. Without sources it is zero everywhere: PvP, the lobby and safe ground carry
 * no void. Every peer derives it from the replicated World identity, its seed and the Activity's
 * authored hazards; it never consumes the layout's randomness, so placements and fingerprints stay.
 */
export class VoidDangerField {
  /** Changes whenever the flora or haze would differ; owners compare it before rebuilding. */
  readonly signature: string;
  private readonly resolved: readonly ResolvedSource[];

  constructor(readonly sources: readonly VoidDangerSource[], private readonly seed: number) {
    this.resolved = sources.map((source, index) => {
      const shapes = source.shapes.map(resolveShape);
      const grow = source.rim * (1 + RIM_NOISE);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const { bounds } of shapes) {
        x0 = Math.min(x0, bounds.x); y0 = Math.min(y0, bounds.y);
        x1 = Math.max(x1, bounds.x + bounds.width); y1 = Math.max(y1, bounds.y + bounds.height);
      }
      const reach = shapes.length ? { x: x0 - grow, y: y0 - grow, width: x1 - x0 + grow * 2, height: y1 - y0 + grow * 2 }
        : { x: 0, y: 0, width: 0, height: 0 };
      return { source, shapes, reach, salt: seed * 31 + index * 977 + hashId(source.id) };
    });
    this.signature = `${seed}|${sources.map(s => `${s.id}:${s.plants}:${s.haze}:${s.rim}:${JSON.stringify(s.shapes)}`).join(';')}`;
  }

  /** True when no source would take or haze anything: owners then keep no void resources. */
  get empty(): boolean { return this.resolved.every(r => r.shapes.length === 0 || (r.source.plants <= 0 && r.source.haze <= 0)); }

  /** Share of taken flora at a world point, 0..1. */
  intensityAt(x: number, y: number): number {
    let spared = 1;
    for (const entry of this.resolved) {
      if (entry.source.plants <= 0 || !inside(entry.reach, x, y)) continue;
      spared *= 1 - entry.source.plants * this.coverage(entry, x, y);
    }
    return 1 - spared;
  }

  /** Thickness of the spore haze at a world point, 0..1; `presence` dims sources by id. */
  hazeAt(x: number, y: number, presence?: (id: string) => number): number {
    let clear = 1;
    for (const entry of this.resolved) {
      if (entry.source.haze <= 0 || !inside(entry.reach, x, y)) continue;
      const present = presence ? Math.max(0, Math.min(1, presence(entry.source.id))) : 1;
      if (present <= 0) continue;
      clear *= 1 - entry.source.haze * present * this.coverage(entry, x, y);
    }
    return 1 - clear;
  }

  /** Area a source's takeover can reach, or null for an unknown id. */
  reachOf(id: string): VoidDangerBounds | null {
    return this.resolved.find(entry => entry.source.id === id)?.reach ?? null;
  }

  /**
   * Infestation of one plant, 0..1, from an already resolved `intensity`. Neighbours with similar
   * intensity stay alike; only the rim of an infested area passes through partial takeover.
   */
  amountOf(intensity: number, x: number, y: number, weight = 1): number {
    const jitter = (ecologyHash(x, y, this.seed + TAKEOVER_SALT) - .5) * PLANT_JITTER;
    return smooth(.2, .8, intensity * weight + jitter);
  }

  /** Infestation of a plant at this point; `weight` favours some kinds. */
  amountAt(x: number, y: number, weight = 1): number {
    return this.amountOf(this.intensityAt(x, y), x, y, weight);
  }

  /** 1 inside the shapes, fading over a noisy rim, 0 beyond it. */
  private coverage(entry: ResolvedSource, x: number, y: number): number {
    let distance = Infinity;
    for (const shape of entry.shapes) {
      if (x < shape.bounds.x - entry.source.rim * 2 || y < shape.bounds.y - entry.source.rim * 2
        || x > shape.bounds.x + shape.bounds.width + entry.source.rim * 2 || y > shape.bounds.y + shape.bounds.height + entry.source.rim * 2) {
        // Far outside this shape; the box distance is a lower bound, enough to skip it.
        const dx = Math.max(shape.bounds.x - x, 0, x - shape.bounds.x - shape.bounds.width);
        const dy = Math.max(shape.bounds.y - y, 0, y - shape.bounds.y - shape.bounds.height);
        distance = Math.min(distance, Math.hypot(dx, dy));
        continue;
      }
      distance = Math.min(distance, shape.distance(x, y));
    }
    const rim = Math.max(1, entry.source.rim);
    const scale = rim * RIM_NOISE_SCALE;
    const noise = .7 * this.noise(x / scale, y / scale, entry.salt) + .3 * this.noise(x / scale * 2.3 + 5.1, y / scale * 2.3 - 2.9, entry.salt + 1);
    return 1 - smooth(-rim * RIM_INNER, rim, distance + (noise - .5) * 2 * RIM_NOISE * rim);
  }

  private noise(x: number, y: number, salt: number): number {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const corner = (cx: number, cy: number): number => ecologyHash(cx, cy, salt);
    const top = corner(ix, iy) + (corner(ix + 1, iy) - corner(ix, iy)) * u;
    const bottom = corner(ix, iy + 1) + (corner(ix + 1, iy + 1) - corner(ix, iy + 1)) * u;
    return top + (bottom - top) * v;
  }
}

const inside = (b: VoidDangerBounds, x: number, y: number): boolean =>
  x >= b.x && y >= b.y && x <= b.x + b.width && y <= b.y + b.height;

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) % 1_000_003;
}

function resolveShape(shape: VoidDangerShape): ResolvedShape {
  switch (shape.kind) {
    case 'disc':
      return { bounds: { x: shape.x - shape.radius, y: shape.y - shape.radius, width: shape.radius * 2, height: shape.radius * 2 },
        distance: (x, y) => Math.hypot(x - shape.x, y - shape.y) - shape.radius };
    case 'rect': {
      const cx = shape.x + shape.width / 2, cy = shape.y + shape.height / 2, hx = shape.width / 2, hy = shape.height / 2;
      return { bounds: { x: shape.x, y: shape.y, width: shape.width, height: shape.height }, distance: (x, y) => {
        const qx = Math.abs(x - cx) - hx, qy = Math.abs(y - cy) - hy;
        return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
      } };
    }
    case 'capsule': {
      const { ax, ay, bx, by, radius } = shape, ex = bx - ax, ey = by - ay, length2 = Math.max(1e-6, ex * ex + ey * ey);
      return { bounds: { x: Math.min(ax, bx) - radius, y: Math.min(ay, by) - radius, width: Math.abs(ex) + radius * 2, height: Math.abs(ey) + radius * 2 },
        distance: (x, y) => {
          const t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / length2));
          return Math.hypot(x - ax - ex * t, y - ay - ey * t) - radius;
        } };
    }
    case 'cells': return resolveCells(shape);
  }
}

/** Cell sets: a chamfer distance grid at cell resolution, sampled bilinearly. */
function resolveCells(shape: Extract<VoidDangerShape, { kind: 'cells' }>): ResolvedShape {
  if (shape.cells.length === 0) return { bounds: { x: 0, y: 0, width: 0, height: 0 }, distance: () => Infinity };
  let gx0 = Infinity, gy0 = Infinity, gx1 = -Infinity, gy1 = -Infinity;
  for (const c of shape.cells) { gx0 = Math.min(gx0, c.gridX); gy0 = Math.min(gy0, c.gridY); gx1 = Math.max(gx1, c.gridX); gy1 = Math.max(gy1, c.gridY); }
  // A margin of cells around the set keeps the distance exact over any rim the sources use.
  const margin = 12, x0 = gx0 - margin, y0 = gy0 - margin, w = gx1 - gx0 + 1 + margin * 2, h = gy1 - gy0 + 1 + margin * 2;
  const solid = new Uint8Array(w * h);
  for (const c of shape.cells) solid[(c.gridY - y0) * w + c.gridX - x0] = 1;
  const outside = chamfer(solid, w, h, 1), within = chamfer(solid, w, h, 0);
  // Cell centres: outside the set the distance to the nearest set cell's edge, inside negative.
  const value = (cx: number, cy: number): number => {
    const i = Math.max(0, Math.min(h - 1, cy)) * w + Math.max(0, Math.min(w - 1, cx));
    return solid[i] ? -(within[i] - .5) * CELL_SIZE : (outside[i] - .5) * CELL_SIZE;
  };
  const bounds = { x: shape.offsetX + gx0 * CELL_SIZE, y: shape.offsetY + gy0 * CELL_SIZE, width: (gx1 - gx0 + 1) * CELL_SIZE, height: (gy1 - gy0 + 1) * CELL_SIZE };
  return { bounds, distance: (x, y) => {
    const fx = (x - shape.offsetX) / CELL_SIZE - .5 - x0, fy = (y - shape.offsetY) / CELL_SIZE - .5 - y0;
    if (fx < 0 || fy < 0 || fx > w - 1 || fy > h - 1) {
      const dx = Math.max(bounds.x - x, 0, x - bounds.x - bounds.width), dy = Math.max(bounds.y - y, 0, y - bounds.y - bounds.height);
      return Math.hypot(dx, dy);
    }
    const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const top = value(ix, iy) + (value(ix + 1, iy) - value(ix, iy)) * tx;
    const bottom = value(ix, iy + 1) + (value(ix + 1, iy + 1) - value(ix, iy + 1)) * tx;
    return top + (bottom - top) * ty;
  } };
}

/** Two-pass chamfer distance (cells) from every cell to the nearest cell whose `solid` equals `target`. */
function chamfer(solid: Uint8Array, w: number, h: number, target: number): Float32Array {
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = solid[i] === target ? 0 : 1e9;
  const diagonal = Math.SQRT2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (x > 0) d[i] = Math.min(d[i], d[i - 1] + 1);
    if (y > 0) {
      d[i] = Math.min(d[i], d[i - w] + 1);
      if (x > 0) d[i] = Math.min(d[i], d[i - w - 1] + diagonal);
      if (x < w - 1) d[i] = Math.min(d[i], d[i - w + 1] + diagonal);
    }
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x;
    if (x < w - 1) d[i] = Math.min(d[i], d[i + 1] + 1);
    if (y < h - 1) {
      d[i] = Math.min(d[i], d[i + w] + 1);
      if (x < w - 1) d[i] = Math.min(d[i], d[i + w + 1] + diagonal);
      if (x > 0) d[i] = Math.min(d[i], d[i + w - 1] + diagonal);
    }
  }
  return d;
}

/** Strength of each kind of danger: how much flora it takes, how thick its haze is at rest. */
const DANGER = {
  /** A hostile main base: the enemy's heart, fully taken, fading out over a wide ring. */
  heart: { plants: .95, haze: 1, padCells: 3, rimCells: 10 },
  /** Outposts and spawn points: smaller seeds of the same takeover. */
  outpost: { plants: .8, haze: .9, padCells: 2, rimCells: 6 },
  /** A spawn zone: always a light haze, the plants of a place enemies keep coming from (E4). */
  zone: { plants: .85, haze: .45, rimCells: 3 },
  /** The kraken's pond to every shore, and the channels it leaves by. */
  habitat: { plants: .95, haze: .9, rimCells: 5 },
  /** Permanent void ground hazards (fire patches, corridors). */
  hazard: { plants: .9, haze: .8, rimCells: 3 },
} as const;

/** World data that marks danger: hostile bases, spawn zones, the kraken pond and authored foci. */
export interface VoidDangerWorldSources {
  readonly config: WorldVoidDangerConfig | null | undefined;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly bases: readonly { readonly id: string; readonly faction: string; readonly role?: string; readonly cells: readonly { gridX: number; gridY: number }[] }[];
  readonly spawnZones?: readonly WorldSpawnZone[];
  readonly krakenHabitat?: KrakenHabitatConfig;
}

/** Danger sources of a World, in a stable order; an empty list for PvP, the lobby and editors. */
export function resolveVoidDangerSources(world: VoidDangerWorldSources): VoidDangerSource[] {
  const reach = Math.max(.5, Math.min(1.5, world.config?.intensity ?? 1));
  const centre = (gridX: number, gridY: number): [number, number] =>
    [world.offsetX + (gridX + .5) * CELL_SIZE, world.offsetY + (gridY + .5) * CELL_SIZE];
  const out: VoidDangerSource[] = [];
  for (const base of world.bases) {
    if (base.faction !== 'hostile' || base.cells.length === 0) continue;
    let sx = 0, sy = 0;
    for (const cell of base.cells) { sx += cell.gridX; sy += cell.gridY; }
    const gx = sx / base.cells.length, gy = sy / base.cells.length;
    let spread = 0;
    for (const cell of base.cells) spread = Math.max(spread, Math.hypot(cell.gridX - gx, cell.gridY - gy));
    const kind = base.role === 'spawn-point' || base.role === 'outpost' ? DANGER.outpost : DANGER.heart;
    const [x, y] = centre(gx, gy);
    out.push({ id: `base:${base.id}`, shapes: [{ kind: 'disc', x, y, radius: (spread + kind.padCells) * CELL_SIZE }],
      rim: kind.rimCells * CELL_SIZE * reach, plants: kind.plants, haze: kind.haze });
  }
  for (const zone of world.spawnZones ?? []) {
    out.push({ id: `zone:${zone.id}`, shapes: [{ kind: 'rect', x: world.offsetX + zone.gridX * CELL_SIZE, y: world.offsetY + zone.gridY * CELL_SIZE,
      width: zone.widthCells * CELL_SIZE, height: zone.heightCells * CELL_SIZE }],
    rim: DANGER.zone.rimCells * CELL_SIZE * reach, plants: DANGER.zone.plants, haze: DANGER.zone.haze });
  }
  const habitat = world.krakenHabitat;
  if (habitat) {
    const shapes: VoidDangerShape[] = [];
    for (const anchor of habitat.waterAnchors) {
      let radius = 4;
      for (const shore of habitat.shores) radius = Math.max(radius, Math.hypot(shore.landCell.gridX - anchor.cell.gridX, shore.landCell.gridY - anchor.cell.gridY));
      const [x, y] = centre(anchor.cell.gridX, anchor.cell.gridY);
      shapes.push({ kind: 'disc', x, y, radius: radius * CELL_SIZE });
    }
    for (const exit of habitat.exits) for (let i = 0; i + 1 < exit.path.length; i++) {
      const [ax, ay] = centre(exit.path[i].gridX, exit.path[i].gridY), [bx, by] = centre(exit.path[i + 1].gridX, exit.path[i + 1].gridY);
      shapes.push({ kind: 'capsule', ax, ay, bx, by, radius: Math.max(1, exit.widthCells / 2) * CELL_SIZE });
    }
    out.push({ id: 'habitat', shapes, rim: DANGER.habitat.rimCells * CELL_SIZE * reach, plants: DANGER.habitat.plants, haze: DANGER.habitat.haze });
  }
  world.config?.foci?.forEach((focus, index) => {
    const [x, y] = centre(focus.gridX, focus.gridY);
    out.push({ id: `focus:${index}`, shapes: [{ kind: 'disc', x, y, radius: focus.radiusCells * CELL_SIZE * .5 }],
      rim: focus.radiusCells * CELL_SIZE * .5 * reach, plants: focus.strength, haze: focus.strength });
  });
  return out;
}

/** A permanent void ground hazard of the running Activity, as a danger source over its cells. */
export function voidHazardSource(eventId: string, offsetX: number, offsetY: number,
  cells: readonly { readonly gridX: number; readonly gridY: number }[], intensity = 1): VoidDangerSource {
  return { id: `hazard:${eventId}`, shapes: [{ kind: 'cells', offsetX, offsetY, cells }],
    rim: DANGER.hazard.rimCells * CELL_SIZE * Math.max(.5, Math.min(1.5, intensity)), plants: DANGER.hazard.plants, haze: DANGER.hazard.haze };
}

/**
 * What the running Activity adds to the World's danger, pulled once per frame: its static sources
 * (permanent void hazards) and the presence of every source. A destroyed base or a closed site
 * has presence 0: its haze lifts while its plants stay as a scar (E7).
 */
export interface ActivityVoidDanger {
  /** Same array while unchanged; a new array rebuilds the flora once. */
  readonly sources: readonly VoidDangerSource[];
  /** Presence 0..1 of a source id; unknown ids are present. */
  presenceOf(id: string): number;
}
