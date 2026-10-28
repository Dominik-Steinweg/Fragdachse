import { GAME_HEIGHT, GAME_WIDTH } from '../../config';
import type { CoopDefenseEnemyConfig } from '../../config/coopDefenseEnemies';

/**
 * How much steering and target-search work an enemy receives in one host frame.
 *
 * `full` is the complete behaviour. `far` is only for hostile enemies outside every player's view:
 * they steer without crowd avoidance and search for a new target less often. Attacks, special
 * movement, physics and replication never read this value.
 */
export type EnemyAiDetail = 'full' | 'far';

/** Read side for navigation consumers. Unknown enemies and frames without views are `full`. */
export interface EnemyAiDetailSource {
  isFar(enemyId: string): boolean;
}

export interface EnemyAiDetailBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface EnemyAiDetailSubject {
  readonly id: string;
  /** Changes with every discontinuous move (portal, reset); a moved far enemy is re-evaluated in full. */
  readonly positionRevision: number;
  readonly sprite: { readonly x: number; readonly y: number };
}

export interface EnemyAiDetailOptions {
  /** Widest world view of one player. The player zoom only magnifies, never widens it. */
  readonly viewWidthPx: number;
  readonly viewHeightPx: number;
  /** Band beyond the view inside which a far enemy returns to full detail. */
  readonly nearMarginPx: number;
  /** Band beyond the view outside which a full-detail enemy may become far. */
  readonly farMarginPx: number;
}

/** Least band beyond a view in which enemies already move with full detail before they appear. */
const MIN_NEAR_MARGIN_PX = 400;
/** Distance between turning full and turning far again, so the border never flickers. */
const FAR_HYSTERESIS_PX = 200;

/**
 * The farthest distance from a player at which an authored special behaviour starts to act on
 * that player (ranged specials, rushes, throws, teleports). Weapons are not listed: an enemy that
 * has an attack target keeps full detail on its own.
 */
export function resolveEnemyEngagementReachPx(configs: Iterable<CoopDefenseEnemyConfig>): number {
  let reach = 0;
  for (const config of configs) {
    reach = Math.max(reach,
      config.mortar?.maxRangePx ?? 0,
      config.firestarter?.lance.rangePx ?? 0,
      config.kaboomtula?.activationRadiusPx ?? 0,
      config.pounce?.maxRangePx ?? 0,
      config.engage?.exitPx ?? 0,
      config.basePreference?.playerOverridePx ?? 0,
      config.shieldCharger?.triggerMaxDistancePx ?? 0,
      config.energyCone?.triggerMaxDistancePx ?? 0,
      config.translocator?.maxRange ?? 0,
      config.spawnThrow?.maxRange ?? 0,
      config.voidMolotov?.maxRange ?? 0);
  }
  return reach;
}

/**
 * Detail options for the design view: every engagement reach around a player stays inside the
 * near band, measured from the short half of the view.
 */
export function resolveEnemyAiDetailOptions(engagementReachPx: number,
  viewWidthPx = GAME_WIDTH, viewHeightPx = GAME_HEIGHT): EnemyAiDetailOptions {
  const nearMarginPx = Math.max(MIN_NEAR_MARGIN_PX, Math.ceil(engagementReachPx - Math.min(viewWidthPx, viewHeightPx) / 2));
  return { viewWidthPx, viewHeightPx, nearMarginPx, farMarginPx: nearMarginPx + FAR_HYSTERESIS_PX };
}

/**
 * Host-frame classification of hostile enemies by their distance to what players can see.
 *
 * An anchor (player, decoy, boss) contributes the view a follow camera would show around it:
 * centred on the anchor and clamped into the world, so an anchor at the world edge sees farther
 * into the world. An axis the world does not exceed is seen completely. Inside a view plus the
 * near band an enemy has full detail; it only becomes far beyond the far band. Without any anchor
 * every enemy keeps full detail.
 */
export class EnemyAiDetailTiers implements EnemyAiDetailSource {
  /** Far enemies with the frame of their last classification and their position revision then. */
  private readonly far = new Map<string, { frame: number; revision: number }>();
  /** Per anchor: left, right, top, bottom of its view. */
  private readonly views: number[] = [];
  private bounds: EnemyAiDetailBounds | null = null;
  private frame = 0;

  constructor(private readonly options: EnemyAiDetailOptions) {}

  /** Starts a host frame; the previous frame's anchors are dropped. */
  beginFrame(bounds: EnemyAiDetailBounds | null): void {
    this.frame++;
    this.views.length = 0;
    this.bounds = bounds;
  }

  addAnchor(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const { viewWidthPx, viewHeightPx } = this.options, bounds = this.bounds;
    const left = bounds ? viewStart(x, viewWidthPx, bounds.left, bounds.right) : x - viewWidthPx / 2;
    const top = bounds ? viewStart(y, viewHeightPx, bounds.top, bounds.bottom) : y - viewHeightPx / 2;
    this.views.push(left, left + viewWidthPx, top, top + viewHeightPx);
  }

  /** Classifies every subject of this frame; `keepFull` is asked only for enemies that would be far. */
  classify<T extends EnemyAiDetailSubject>(subjects: Iterable<T>, keepFull: (subject: T) => boolean): void {
    const frame = this.frame;
    if (this.views.length) {
      for (const subject of subjects) {
        const previous = this.far.get(subject.id);
        const gap = this.viewGap(subject.sprite.x, subject.sprite.y);
        const far = previous ? previous.revision === subject.positionRevision && gap > this.options.nearMarginPx
          : gap >= this.options.farMarginPx;
        if (!far || keepFull(subject)) { if (previous) this.far.delete(subject.id); continue; }
        if (previous) previous.frame = frame;
        else this.far.set(subject.id, { frame, revision: subject.positionRevision });
      }
    }
    for (const [id, state] of this.far) if (state.frame !== frame) this.far.delete(id);
  }

  isFar(enemyId: string): boolean {
    return this.far.get(enemyId)?.frame === this.frame;
  }

  getFarCount(): number { return this.far.size; }

  get nearMarginPx(): number { return this.options.nearMarginPx; }
  get farMarginPx(): number { return this.options.farMarginPx; }

  clear(): void {
    this.far.clear();
    this.views.length = 0;
    this.bounds = null;
  }

  /**
   * Chebyshev distance of a point to the nearest view of this frame; zero inside one and without
   * anchors. Behaviours that depend on being seen read this geometry, never the detail tier.
   */
  viewGap(x: number, y: number): number {
    const views = this.views;
    if (!views.length) return 0;
    let best = Infinity;
    for (let i = 0; i < views.length; i += 4) {
      const gap = Math.max(views[i] - x, x - views[i + 1], views[i + 2] - y, y - views[i + 3], 0);
      if (gap < best) { best = gap; if (gap === 0) break; }
    }
    return best;
  }
}

/** Start of a camera span centred on `center` and clamped into [min, max]; a short world is seen whole. */
function viewStart(center: number, size: number, min: number, max: number): number {
  if (max - min <= size) return (min + max - size) / 2;
  return Math.min(Math.max(center - size / 2, min), max - size);
}
