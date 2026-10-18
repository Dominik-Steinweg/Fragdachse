import { CELL_SIZE } from '../config';
import { DEFAULT_WORLD_VOID_FLORA, type WorldVoidFloraConfig } from '../config/nightWorld';
import type { KrakenHabitatConfig } from '../config/krakenHabitat';
import { ecologyHash } from './ecologyHash';

/** A world-pixel area where the void has taken over more flora. */
export interface VoidFloraHotspot {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly strength: number;
}

/** Salt of the per-plant variation; independent of every placement roll, so positions never change. */
const TAKEOVER_SALT = 0x5f0d;
/** Per-plant variation of the infestation; small, so neighbours stay alike. */
const PLANT_JITTER = .05;
/** World pixels per patch-noise cell: infested spots span a few cells, not single plants. */
const PATCH_SCALE = 360;
/** Soft rim of an infested patch in patch-noise units. */
const PATCH_EDGE = .1;
const smooth = (edge0: number, edge1: number, value: number): number => {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * Deterministic share of void-taken flora (GDD Nachtsicht N-6/N-7), presentation only.
 *
 * A seeded patch noise thresholded by the authored level gives isolated spots at low levels and
 * near-complete takeover at high levels. Hotspots and foci add a Gaussian on top. Every peer
 * derives the same field from the replicated World identity and seed; it never consumes the
 * layout's randomness, so placements, ranks and fingerprints stay as they are.
 */
export class VoidFloraField {
  readonly level: number;
  /** Changes whenever the field would select differently; owners compare it before rebuilding. */
  readonly signature: string;
  /** Patch value above which flora is taken, calibrated so the share of area follows the level. */
  private readonly threshold: number;

  constructor(config: WorldVoidFloraConfig | null | undefined, private readonly seed: number,
    private readonly hotspots: readonly VoidFloraHotspot[] = []) {
    this.level = Math.max(0, Math.min(1, (config ?? DEFAULT_WORLD_VOID_FLORA).level));
    this.signature = `${this.level}|${seed}|${hotspots.map(h => `${h.x},${h.y},${h.radius},${h.strength}`).join(';')}`;
    // The patch noise clusters around its middle; its own quantile turns the level into an area share.
    const samples: number[] = [];
    for (let row = 0; row < 48; row++) for (let col = 0; col < 48; col++) samples.push(this.patch(col * .731 + .37, row * .677 + .21));
    samples.sort((a, b) => a - b);
    this.threshold = samples[Math.min(samples.length - 1, Math.floor((1 - this.level) * samples.length))];
  }

  /** Share of affected flora at a world point, 0..1. */
  intensityAt(x: number, y: number): number {
    const patch = this.patch(x / PATCH_SCALE, y / PATCH_SCALE);
    const base = this.level <= 0 ? 0 : this.level >= 1 ? 1 : smooth(this.threshold - PATCH_EDGE, this.threshold + PATCH_EDGE, patch);
    let spared = 1 - base;
    for (const spot of this.hotspots) {
      const sigma = spot.radius * .5, dx = x - spot.x, dy = y - spot.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > 9 * sigma * sigma) continue;
      spared *= 1 - spot.strength * Math.exp(-d2 / (2 * sigma * sigma));
    }
    return 1 - spared;
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

  private patch(px: number, py: number): number {
    // Mostly the broad octave: smooth, rounded infested regions rather than ragged spots.
    return .8 * this.noise(px, py, 1) + .2 * this.noise(px * 1.9 + 7.1, py * 1.9 - 3.7, 2);
  }

  private noise(x: number, y: number, salt: number): number {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const corner = (cx: number, cy: number): number => ecologyHash(cx, cy, this.seed * 31 + salt);
    const top = corner(ix, iy) + (corner(ix + 1, iy) - corner(ix, iy)) * u;
    const bottom = corner(ix, iy + 1) + (corner(ix + 1, iy + 1) - corner(ix, iy + 1)) * u;
    return top + (bottom - top) * v;
  }
}

/** World data that marks enemy territory: hostile bases, the kraken pond and authored foci. */
export interface VoidFloraWorldSources {
  readonly config: WorldVoidFloraConfig | null | undefined;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly bases: readonly { readonly faction: string; readonly role?: string; readonly cells: readonly { gridX: number; gridY: number }[] }[];
  readonly krakenHabitat?: KrakenHabitatConfig;
}

export function resolveVoidFloraHotspots(world: VoidFloraWorldSources): VoidFloraHotspot[] {
  const cellCentre = (gridX: number, gridY: number): [number, number] =>
    [world.offsetX + (gridX + .5) * CELL_SIZE, world.offsetY + (gridY + .5) * CELL_SIZE];
  const out: VoidFloraHotspot[] = [];
  if ((world.config ?? DEFAULT_WORLD_VOID_FLORA).hotspots !== false) {
    for (const base of world.bases) {
      if (base.faction !== 'hostile' || base.cells.length === 0) continue;
      let sx = 0, sy = 0;
      for (const cell of base.cells) { sx += cell.gridX; sy += cell.gridY; }
      const gx = sx / base.cells.length, gy = sy / base.cells.length;
      let spread = 0;
      for (const cell of base.cells) spread = Math.max(spread, Math.hypot(cell.gridX - gx, cell.gridY - gy));
      const [x, y] = cellCentre(gx, gy);
      // The enemy's heart is fully taken and fades out over a wide ring: players work their way in.
      // Spawn points and outposts are smaller seeds of the same takeover.
      const heart = base.role !== 'spawn-point' && base.role !== 'outpost';
      out.push({ x, y, radius: (spread + (heart ? 16 : 8)) * CELL_SIZE, strength: heart ? .95 : .75 });
    }
    // The kraken's pond is its home: the takeover reaches every shore of the habitat.
    const shores = world.krakenHabitat?.shores ?? [];
    for (const anchor of world.krakenHabitat?.waterAnchors ?? []) {
      let reach = 8;
      for (const shore of shores) reach = Math.max(reach, Math.hypot(shore.landCell.gridX - anchor.cell.gridX, shore.landCell.gridY - anchor.cell.gridY));
      const [x, y] = cellCentre(anchor.cell.gridX, anchor.cell.gridY);
      out.push({ x, y, radius: (reach + 6) * CELL_SIZE, strength: .95 });
    }
  }
  for (const focus of world.config?.foci ?? []) {
    const [x, y] = cellCentre(focus.gridX, focus.gridY);
    out.push({ x, y, radius: focus.radiusCells * CELL_SIZE, strength: focus.strength });
  }
  return out;
}
