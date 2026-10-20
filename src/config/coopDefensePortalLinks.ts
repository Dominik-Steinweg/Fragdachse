import type { WaterCell } from '../types';

/**
 * Portal links of a coop mission: a hostile generator holds two portal endpoints open.
 *
 * The endpoints are World geometry (`portalAnchors`): the generator carves their clearings even
 * without a running mission. What a mission does with them - which generator feeds them, when the
 * connection charges and who may pass - is Activity content (`portalLinks`). All tuning defaults
 * of the link live here and nowhere else.
 */

export interface CoopDefenseMapPortalAnchorConfig {
  readonly id: string;
  readonly gridX: number;
  readonly gridY: number;
  /** Guaranteed free clearing around the endpoint. */
  readonly radiusCells: number;
}

export interface CoopDefensePortalCollapseConfig {
  readonly radiusPx: number;
  readonly slowFraction: number;
  readonly slowDurationMs: number;
  readonly pullSpeedPx: number;
  readonly pullDurationMs: number;
}

export interface CoopDefenseMapPortalLinkConfig {
  readonly id: string;
  /** Hostile dormant outpost whose destroy objective closes the link for good. */
  readonly generatorBaseId: string;
  readonly entryAnchorId: string;
  readonly exitAnchorId: string;
  /** Mission time at which the generator starts to build the connection; default 0. */
  readonly chargeStartMs?: number;
  readonly chargeDurationMs: number;
  readonly radiusPx?: number;
  readonly reentryDistancePx?: number;
  /** Time after which a traveler may re-enter the endpoint it just left. */
  readonly gateReleaseMs?: number;
  /** Larger bodies (and every boss) never use the link. */
  readonly maxBodyRadiusPx?: number;
  /** Ground-equivalent navigation cost of the jump; hysteresis against a near-equal land route. */
  readonly linkCostPx?: number;
  readonly collapse?: Partial<CoopDefensePortalCollapseConfig>;
}

export interface ResolvedCoopDefensePortalLinkConfig {
  readonly id: string;
  readonly generatorBaseId: string;
  readonly entryAnchorId: string;
  readonly exitAnchorId: string;
  readonly chargeStartMs: number;
  readonly chargeDurationMs: number;
  readonly radiusPx: number;
  readonly reentryDistancePx: number;
  readonly gateReleaseMs: number;
  readonly maxBodyRadiusPx: number;
  readonly linkCostPx: number;
  readonly collapse: CoopDefensePortalCollapseConfig;
}

export const COOP_DEFENSE_PORTAL_LINK_DEFAULTS = {
  radiusPx: 28,
  reentryDistancePx: 88,
  gateReleaseMs: 900,
  maxBodyRadiusPx: 20,
  linkCostPx: 192,
  collapse: { radiusPx: 128, slowFraction: 0.5, slowDurationMs: 3000, pullSpeedPx: 900, pullDurationMs: 300 },
} as const;

export const MAX_COOP_DEFENSE_PORTAL_LINKS = 2;
export const MIN_COOP_DEFENSE_PORTAL_ANCHOR_SEPARATION_CELLS = 24;
const MIN_PORTAL_RADIUS_PX = 16;
const MAX_PORTAL_RADIUS_PX = 48;
const MIN_ANCHOR_RADIUS_CELLS = 2;
const MAX_ANCHOR_RADIUS_CELLS = 6;

export function normalizeCoopDefensePortalAnchors(
  mapId: string,
  anchors: readonly CoopDefenseMapPortalAnchorConfig[] | undefined,
  arenaWidthCells: number,
  arenaHeightCells: number,
  water: readonly WaterCell[] | undefined,
): readonly CoopDefenseMapPortalAnchorConfig[] | undefined {
  if (anchors === undefined) return undefined;
  if (!Array.isArray(anchors)) throw new Error(`[coopDefenseMaps] Map ${mapId} portalAnchors must be an array`);
  const ids = new Set<string>();
  const wet = new Set((water ?? []).map((cell) => `${cell.gridX}:${cell.gridY}`));
  return anchors.map((anchor) => {
    const id = typeof anchor?.id === 'string' ? anchor.id.trim() : '';
    if (!id) throw new Error(`[coopDefenseMaps] Map ${mapId} has a portal anchor without id`);
    if (ids.has(id)) throw new Error(`[coopDefenseMaps] Map ${mapId} has duplicate portal anchor ${id}`);
    ids.add(id);
    const { gridX, gridY, radiusCells } = anchor;
    if (!Number.isSafeInteger(radiusCells) || radiusCells < MIN_ANCHOR_RADIUS_CELLS || radiusCells > MAX_ANCHOR_RADIUS_CELLS) {
      throw new Error(`[coopDefenseMaps] Portal anchor ${mapId}:${id} needs a radius between `
        + `${MIN_ANCHOR_RADIUS_CELLS} and ${MAX_ANCHOR_RADIUS_CELLS} cells`);
    }
    if (!Number.isSafeInteger(gridX) || !Number.isSafeInteger(gridY) || gridX - radiusCells < 0 || gridY - radiusCells < 0
      || gridX + radiusCells >= arenaWidthCells || gridY + radiusCells >= arenaHeightCells) {
      throw new Error(`[coopDefenseMaps] Portal anchor ${mapId}:${id} and its clearing must lie inside the arena`);
    }
    for (let dy = -radiusCells; dy <= radiusCells; dy++) for (let dx = -radiusCells; dx <= radiusCells; dx++) {
      if (dx * dx + dy * dy <= radiusCells * radiusCells && wet.has(`${gridX + dx}:${gridY + dy}`)) {
        throw new Error(`[coopDefenseMaps] Portal anchor ${mapId}:${id} clearing must stay on land`);
      }
    }
    return { id, gridX, gridY, radiusCells };
  });
}

export interface PortalLinkNormalizationContext {
  readonly anchors: readonly CoopDefenseMapPortalAnchorConfig[] | undefined;
  readonly bases: readonly { readonly id: string; readonly faction?: string; readonly role?: string;
    readonly dormant?: boolean }[];
  readonly destroyObjectiveTargets: ReadonlyMap<string, { readonly objectiveId: string; readonly expires: boolean }>;
  /** Grid anchor and reservation radius of the persistent base, when the map has one. */
  readonly persistentBase?: { readonly gridX: number; readonly gridY: number; readonly reservationRadiusCells: number };
}

export function normalizeCoopDefensePortalLinks(
  mapId: string,
  links: readonly CoopDefenseMapPortalLinkConfig[] | undefined,
  context: PortalLinkNormalizationContext,
): readonly ResolvedCoopDefensePortalLinkConfig[] | undefined {
  if (links === undefined) return undefined;
  if (!Array.isArray(links)) throw new Error(`[coopDefenseMaps] Map ${mapId} portalLinks must be an array`);
  if (links.length > MAX_COOP_DEFENSE_PORTAL_LINKS) {
    throw new Error(`[coopDefenseMaps] Map ${mapId} allows at most ${MAX_COOP_DEFENSE_PORTAL_LINKS} portal links`);
  }
  const anchors = new Map((context.anchors ?? []).map((anchor) => [anchor.id, anchor]));
  const ids = new Set<string>();
  const generators = new Set<string>();
  const usedAnchors = new Set<string>();
  return links.map((link) => {
    const id = typeof link?.id === 'string' ? link.id.trim() : '';
    if (!id) throw new Error(`[coopDefenseMaps] Map ${mapId} has a portal link without id`);
    if (ids.has(id)) throw new Error(`[coopDefenseMaps] Map ${mapId} has duplicate portal link ${id}`);
    ids.add(id);
    const label = `[coopDefenseMaps] Portal link ${mapId}:${id}`;

    const generator = context.bases.find((base) => base.id === link.generatorBaseId);
    if (!generator) throw new Error(`${label} references unknown generator base ${String(link.generatorBaseId)}`);
    if (generator.faction !== 'hostile' || generator.role !== 'outpost' || generator.dormant !== true) {
      throw new Error(`${label} generator must be a hostile dormant outpost`);
    }
    if (generators.has(generator.id)) throw new Error(`${label} shares its generator with another link`);
    generators.add(generator.id);
    const objective = context.destroyObjectiveTargets.get(generator.id);
    if (!objective) throw new Error(`${label} generator needs a destroy objective`);
    if (objective.expires) throw new Error(`${label} destroy objective ${objective.objectiveId} must not expire`);

    const entry = anchors.get(link.entryAnchorId), exit = anchors.get(link.exitAnchorId);
    if (!entry || !exit) throw new Error(`${label} references unknown portal anchors`);
    if (entry.id === exit.id || usedAnchors.has(entry.id) || usedAnchors.has(exit.id)) {
      throw new Error(`${label} needs two anchors of its own`);
    }
    usedAnchors.add(entry.id); usedAnchors.add(exit.id);
    if (Math.hypot(entry.gridX - exit.gridX, entry.gridY - exit.gridY) < MIN_COOP_DEFENSE_PORTAL_ANCHOR_SEPARATION_CELLS) {
      throw new Error(`${label} anchors must be at least ${MIN_COOP_DEFENSE_PORTAL_ANCHOR_SEPARATION_CELLS} cells apart`);
    }
    const base = context.persistentBase;
    for (const anchor of [entry, exit]) {
      if (base && Math.hypot(anchor.gridX - base.gridX, anchor.gridY - base.gridY)
        <= base.reservationRadiusCells + anchor.radiusCells) {
        throw new Error(`${label} anchor ${anchor.id} lies inside the persistent base reservation`);
      }
    }

    const defaults = COOP_DEFENSE_PORTAL_LINK_DEFAULTS;
    const radiusPx = optionalNumber(label, 'radiusPx', link.radiusPx, defaults.radiusPx, MIN_PORTAL_RADIUS_PX, MAX_PORTAL_RADIUS_PX);
    const maxBodyRadiusPx = optionalNumber(label, 'maxBodyRadiusPx', link.maxBodyRadiusPx, defaults.maxBodyRadiusPx, 1, radiusPx - 1);
    const reentryDistancePx = optionalNumber(label, 'reentryDistancePx', link.reentryDistancePx,
      defaults.reentryDistancePx, radiusPx + maxBodyRadiusPx + 1, 400);
    const collapse = link.collapse ?? {};
    return {
      id,
      generatorBaseId: generator.id,
      entryAnchorId: entry.id,
      exitAnchorId: exit.id,
      chargeStartMs: optionalNumber(label, 'chargeStartMs', link.chargeStartMs, 0, 0, Number.MAX_SAFE_INTEGER),
      chargeDurationMs: optionalNumber(label, 'chargeDurationMs', link.chargeDurationMs, Number.NaN, 1000, 600_000),
      radiusPx,
      reentryDistancePx,
      gateReleaseMs: optionalNumber(label, 'gateReleaseMs', link.gateReleaseMs, defaults.gateReleaseMs, 100, 10_000),
      maxBodyRadiusPx,
      linkCostPx: optionalNumber(label, 'linkCostPx', link.linkCostPx, defaults.linkCostPx, 0, 4096),
      collapse: {
        radiusPx: optionalNumber(label, 'collapse.radiusPx', collapse.radiusPx, defaults.collapse.radiusPx, 0, 512),
        slowFraction: optionalNumber(label, 'collapse.slowFraction', collapse.slowFraction, defaults.collapse.slowFraction, 0, 0.9),
        slowDurationMs: optionalNumber(label, 'collapse.slowDurationMs', collapse.slowDurationMs,
          defaults.collapse.slowDurationMs, 0, 10_000),
        pullSpeedPx: optionalNumber(label, 'collapse.pullSpeedPx', collapse.pullSpeedPx, defaults.collapse.pullSpeedPx, 0, 3000),
        pullDurationMs: optionalNumber(label, 'collapse.pullDurationMs', collapse.pullDurationMs,
          defaults.collapse.pullDurationMs, 0, 2000),
      },
    };
  });
}

/**
 * Runtime view of an already normalized link. Normalization stores every value explicitly, so this
 * only restores the resolved type; it never decides a value of its own.
 */
export function resolveCoopDefensePortalLink(link: CoopDefenseMapPortalLinkConfig): ResolvedCoopDefensePortalLinkConfig {
  const { radiusPx, reentryDistancePx, gateReleaseMs, maxBodyRadiusPx, linkCostPx, chargeStartMs, collapse } = link;
  const c = collapse ?? {};
  if (radiusPx === undefined || reentryDistancePx === undefined || gateReleaseMs === undefined
    || maxBodyRadiusPx === undefined || linkCostPx === undefined || chargeStartMs === undefined
    || c.radiusPx === undefined || c.slowFraction === undefined || c.slowDurationMs === undefined
    || c.pullSpeedPx === undefined || c.pullDurationMs === undefined) {
    throw new Error(`[coopDefensePortalLinks] Portal link ${link.id} must pass normalizeCoopDefenseMapConfig() first`);
  }
  return { id: link.id, generatorBaseId: link.generatorBaseId, entryAnchorId: link.entryAnchorId,
    exitAnchorId: link.exitAnchorId, chargeStartMs, chargeDurationMs: link.chargeDurationMs, radiusPx,
    reentryDistancePx, gateReleaseMs, maxBodyRadiusPx, linkCostPx,
    collapse: { radiusPx: c.radiusPx, slowFraction: c.slowFraction, slowDurationMs: c.slowDurationMs,
      pullSpeedPx: c.pullSpeedPx, pullDurationMs: c.pullDurationMs } };
}

/** A missing required value passes `NaN` as its fallback and is rejected like an invalid one. */
function optionalNumber(label: string, field: string, value: unknown, fallback: number, min: number, max: number): number {
  const resolved = value === undefined ? fallback : value;
  if (typeof resolved !== 'number' || !Number.isFinite(resolved) || resolved < min || resolved > max) {
    throw new Error(`${label} needs ${field} between ${min} and ${max}`);
  }
  return resolved;
}
