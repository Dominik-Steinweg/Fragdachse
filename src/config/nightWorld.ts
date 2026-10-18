/**
 * Authored night look of a World (GDD Nachtsicht und Void-Botanik): moon islands and the share of
 * flora the void has taken over. Both are presentation only. Every peer derives them from the
 * replicated World identity; the layout generator never reads them.
 */

/** Moon islands: `strength` scales their light (0 disables), `cover` biases the night cloud deck. */
export interface WorldMoonlightConfig {
  readonly strength?: number;
  readonly cover?: number;
}

/** A focus where the void has taken over more flora, in arena cells. */
export interface WorldVoidFloraFocus {
  readonly gridX: number;
  readonly gridY: number;
  readonly radiusCells: number;
  /** Added intensity at the centre, (0, 1]. */
  readonly strength: number;
}

/**
 * Void botany: `level` is the base share of affected flora (0..1). Hotspots around hostile
 * bases, void-fire corridors and the kraken pond are added unless `hotspots` is false.
 */
export interface WorldVoidFloraConfig {
  readonly level: number;
  readonly hotspots?: boolean;
  readonly foci?: readonly WorldVoidFloraFocus[];
}

export const WORLD_MOONLIGHT_LIMITS = { strength: [0, 1.5], cover: [-.3, .3] } as const;
export const MAX_VOID_FLORA_FOCI = 32;
export const MAX_VOID_FLORA_FOCUS_RADIUS_CELLS = 64;
/** Worlds without an authored value (PvP, editors): a medium share, like the campaign's middle. */
export const DEFAULT_WORLD_VOID_FLORA: WorldVoidFloraConfig = { level: .3 };

const finiteIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

export function normalizeWorldMoonlight(owner: string, value: unknown): WorldMoonlightConfig | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`[${owner}] moonlight: object expected`);
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(raw)) if (key !== 'strength' && key !== 'cover') throw new Error(`[${owner}] moonlight: unknown field ${key}`);
  if (raw.strength !== undefined && !finiteIn(raw.strength, ...WORLD_MOONLIGHT_LIMITS.strength))
    throw new Error(`[${owner}] moonlight.strength must be within 0..1.5`);
  if (raw.cover !== undefined && !finiteIn(raw.cover, ...WORLD_MOONLIGHT_LIMITS.cover))
    throw new Error(`[${owner}] moonlight.cover must be within -0.3..0.3`);
  return {
    ...(raw.strength === undefined ? {} : { strength: raw.strength as number }),
    ...(raw.cover === undefined ? {} : { cover: raw.cover as number }),
  };
}

export function normalizeWorldVoidFlora(owner: string, value: unknown, widthCells: number, heightCells: number):
  WorldVoidFloraConfig | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`[${owner}] voidFlora: object expected`);
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(raw)) if (!['level', 'hotspots', 'foci'].includes(key)) throw new Error(`[${owner}] voidFlora: unknown field ${key}`);
  if (!finiteIn(raw.level, 0, 1)) throw new Error(`[${owner}] voidFlora.level must be within 0..1`);
  if (raw.hotspots !== undefined && typeof raw.hotspots !== 'boolean') throw new Error(`[${owner}] voidFlora.hotspots must be boolean`);
  let foci: WorldVoidFloraFocus[] | undefined;
  if (raw.foci !== undefined) {
    if (!Array.isArray(raw.foci) || raw.foci.length > MAX_VOID_FLORA_FOCI) throw new Error(`[${owner}] voidFlora.foci: at most ${MAX_VOID_FLORA_FOCI} entries`);
    foci = raw.foci.map((entry, index) => {
      const focus = entry as Record<string, unknown>;
      const where = `[${owner}] voidFlora.foci[${index}]`;
      if (!focus || typeof focus !== 'object') throw new Error(`${where}: object expected`);
      for (const key of Object.keys(focus)) if (!['gridX', 'gridY', 'radiusCells', 'strength'].includes(key)) throw new Error(`${where}: unknown field ${key}`);
      if (!Number.isInteger(focus.gridX) || !finiteIn(focus.gridX, 0, widthCells - 1)
        || !Number.isInteger(focus.gridY) || !finiteIn(focus.gridY, 0, heightCells - 1)) throw new Error(`${where}: cell outside the arena`);
      if (!finiteIn(focus.radiusCells, 1, MAX_VOID_FLORA_FOCUS_RADIUS_CELLS)) throw new Error(`${where}.radiusCells must be within 1..${MAX_VOID_FLORA_FOCUS_RADIUS_CELLS}`);
      if (!finiteIn(focus.strength, 0, 1) || focus.strength === 0) throw new Error(`${where}.strength must be within (0, 1]`);
      return { gridX: focus.gridX as number, gridY: focus.gridY as number, radiusCells: focus.radiusCells as number, strength: focus.strength as number };
    });
  }
  return {
    level: raw.level as number,
    ...(raw.hotspots === undefined ? {} : { hotspots: raw.hotspots as boolean }),
    ...(foci === undefined ? {} : { foci }),
  };
}
