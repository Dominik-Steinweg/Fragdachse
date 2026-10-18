/**
 * Authored night look of a World (GDD Nachtsicht und Void-Botanik): moon islands and how far the
 * void spreads around danger (GDD Void-Gefahrenzonen V1). Both are presentation only. Every peer derives them from the
 * replicated World identity; the layout generator never reads them.
 */

/** Moon islands: `strength` scales their light (0 disables), `cover` biases the night cloud deck. */
export interface WorldMoonlightConfig {
  readonly strength?: number;
  readonly cover?: number;
}

/** An authored place of extra void danger, in arena cells. */
export interface WorldVoidDangerFocus {
  readonly gridX: number;
  readonly gridY: number;
  readonly radiusCells: number;
  /** Takeover and haze at the centre, (0, 1]. */
  readonly strength: number;
}

/**
 * Void as a danger marker (GDD Void-Gefahrenzonen V1): hostile bases, spawn zones, the kraken
 * pond and permanent void hazards carry it on their own. `intensity` (0.5..1.5) scales how far it
 * spreads around them; `foci` add authored places of danger.
 */
export interface WorldVoidDangerConfig {
  readonly intensity?: number;
  readonly foci?: readonly WorldVoidDangerFocus[];
}

export const WORLD_MOONLIGHT_LIMITS = { strength: [0, 1.5], cover: [-.3, .3] } as const;
export const WORLD_VOID_DANGER_INTENSITY = [.5, 1.5] as const;
export const MAX_VOID_DANGER_FOCI = 32;
export const MAX_VOID_DANGER_FOCUS_RADIUS_CELLS = 64;

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

export function normalizeWorldVoidDanger(owner: string, value: unknown, widthCells: number, heightCells: number):
  WorldVoidDangerConfig | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`[${owner}] voidDanger: object expected`);
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(raw)) if (!['intensity', 'foci'].includes(key)) throw new Error(`[${owner}] voidDanger: unknown field ${key}`);
  if (raw.intensity !== undefined && !finiteIn(raw.intensity, ...WORLD_VOID_DANGER_INTENSITY))
    throw new Error(`[${owner}] voidDanger.intensity must be within 0.5..1.5`);
  let foci: WorldVoidDangerFocus[] | undefined;
  if (raw.foci !== undefined) {
    if (!Array.isArray(raw.foci) || raw.foci.length > MAX_VOID_DANGER_FOCI) throw new Error(`[${owner}] voidDanger.foci: at most ${MAX_VOID_DANGER_FOCI} entries`);
    foci = raw.foci.map((entry, index) => {
      const focus = entry as Record<string, unknown>;
      const where = `[${owner}] voidDanger.foci[${index}]`;
      if (!focus || typeof focus !== 'object') throw new Error(`${where}: object expected`);
      for (const key of Object.keys(focus)) if (!['gridX', 'gridY', 'radiusCells', 'strength'].includes(key)) throw new Error(`${where}: unknown field ${key}`);
      if (!Number.isInteger(focus.gridX) || !finiteIn(focus.gridX, 0, widthCells - 1)
        || !Number.isInteger(focus.gridY) || !finiteIn(focus.gridY, 0, heightCells - 1)) throw new Error(`${where}: cell outside the arena`);
      if (!finiteIn(focus.radiusCells, 1, MAX_VOID_DANGER_FOCUS_RADIUS_CELLS)) throw new Error(`${where}.radiusCells must be within 1..${MAX_VOID_DANGER_FOCUS_RADIUS_CELLS}`);
      if (!finiteIn(focus.strength, 0, 1) || focus.strength === 0) throw new Error(`${where}.strength must be within (0, 1]`);
      return { gridX: focus.gridX as number, gridY: focus.gridY as number, radiusCells: focus.radiusCells as number, strength: focus.strength as number };
    });
  }
  return {
    ...(raw.intensity === undefined ? {} : { intensity: raw.intensity as number }),
    ...(foci === undefined ? {} : { foci }),
  };
}
