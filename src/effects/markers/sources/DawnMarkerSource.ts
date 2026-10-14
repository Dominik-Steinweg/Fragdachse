import { CELL_SIZE } from '../../../config';
import type { CoopDefenseSecondaryObjectivePresentationState } from '../../../types';
import type { WorldMetrics } from '../../../world/WorldMetrics';
import { MARKER_GLYPH_IDS, type MarkerDescriptor, type MarkerGlyphId } from '../MarkerTypes';

/** One salvage site as resolved from the replicated Dawn world plan; geometry only, no authority. */
export interface DawnSiteMarkerTarget {
  readonly objectiveId: string;
  readonly archetypeId: string;
  readonly tier: number;
  readonly gridX: number;
  readonly gridY: number;
  /** Clearing radius, which is also the site's activation radius. */
  readonly radiusCells: number;
  /** Half height of the site prop (Weltpixel); the badge floats above it. */
  readonly targetHalfHeight: number;
  /** Hold archetypes: the arc follows the hold window from the replicated activation time. */
  readonly holdDurationMs?: number;
  /** Hidden site (no scrap scanner): no navigation marker until a player finds and activates it. */
  readonly hidden?: boolean;
}

export interface DawnMarkerInput {
  readonly phase: string;
  readonly returnToBase: boolean;
  readonly sites: readonly DawnSiteMarkerTarget[];
  readonly objectives: CoopDefenseSecondaryObjectivePresentationState | null;
  readonly origin: Pick<WorldMetrics, 'offsetX' | 'offsetY'>;
  readonly base?: { readonly gridX: number; readonly gridY: number } | null;
  /** Local scene time and the synchronized round time of the same frame; stamps observed state changes. */
  readonly clock: { readonly nowMs: number; readonly elapsedMs: number };
}

const SITE_GLYPHS = new Set<string>(MARKER_GLYPH_IDS);
const siteGlyph = (archetypeId: string): MarkerGlyphId => {
  const glyph = `site-${archetypeId}`;
  return SITE_GLYPHS.has(glyph) ? glyph as MarkerGlyphId : archetypeId === 'scavenger' ? 'scavenger' : 'site-wreck';
};
const tierOf = (tier: number): 1 | 2 | 3 | undefined => tier === 1 || tier === 2 || tier === 3 ? tier : undefined;

/**
 * Pure projection of the Dawn sites and the dusk return onto the shared marker system.
 * One key per site for its whole life (dormant → active → completed/failed), so the
 * activation transition never doubles a marker; the archetype glyph and tier stay visible.
 * Dormant sites are only offered by day; activated ones follow their replicated objective.
 */
export function dawnMarkers(input: DawnMarkerInput): MarkerDescriptor[] {
  const out: MarkerDescriptor[] = [];
  const entries = new Map((input.objectives ?? []).map(entry => [entry.objectiveId, entry]));
  for (const site of input.sites) {
    const entry = entries.get(site.objectiveId);
    const activated = entry && entry.state !== 'dormant';
    if (!activated && (input.phase !== 'day' || site.hidden)) continue;
    const common = {
      key: `dawn-site:${site.objectiveId}`, kind: 'site' as const, glyph: siteGlyph(site.archetypeId),
      x: input.origin.offsetX + (site.gridX + .5) * CELL_SIZE, y: input.origin.offsetY + (site.gridY + .5) * CELL_SIZE,
      targetHalfHeight: site.targetHalfHeight, tier: tierOf(site.tier), visibility: 'world-and-edge' as const,
    };
    if (!activated) {
      out.push({ ...common, state: 'dormant', bundleKey: 'dawn-site:dormant' });
      continue;
    }
    const held = site.holdDurationMs && entry.state === 'active'
      ? (input.clock.elapsedMs - entry.stateChangedAtMs) / site.holdDurationMs : undefined;
    const resolved = entry.progressTotal > 0 ? entry.progressCurrent / entry.progressTotal : undefined;
    const progress = held ?? resolved;
    out.push({
      ...common, state: entry.state,
      progress: progress === undefined ? undefined : Math.max(0, Math.min(1, progress)),
      groundRing: entry.state === 'active' ? { radiusPx: site.radiusCells * CELL_SIZE } : undefined,
      bundleKey: 'dawn-site:active',
      // Late join: a long-resolved site arrives already faded instead of replaying its pop.
      stateChangedAtMs: entry.state === 'active' ? undefined
        : input.clock.nowMs - Math.max(0, input.clock.elapsedMs - entry.stateChangedAtMs),
    });
  }
  if (input.returnToBase && input.base) {
    out.push({
      key: 'dawn-return', kind: 'return', glyph: 'base', state: 'active', urgent: true, visibility: 'world-and-edge',
      x: input.origin.offsetX + (input.base.gridX + .5) * CELL_SIZE, y: input.origin.offsetY + (input.base.gridY + .5) * CELL_SIZE,
      targetHalfHeight: CELL_SIZE,
    });
  }
  return out;
}
