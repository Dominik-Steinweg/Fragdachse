import type { GroundFireVisualStyle } from '../types';

/**
 * Stabile Wire-Codes der Feuerstile. Die Position ist der Code: neue Stile nur anhängen,
 * bestehende Codes (0 = normal, 1 = void) bleiben unverändert.
 */
const GROUND_FIRE_VISUAL_STYLES = ['normal', 'void', 'allied'] as const satisfies readonly GroundFireVisualStyle[];

type Covered<TUnion, TList extends readonly unknown[]> =
  Exclude<TUnion, TList[number]> extends never ? true : never;
const stylesCovered: Covered<GroundFireVisualStyle, typeof GROUND_FIRE_VISUAL_STYLES> = true;
void stylesCovered;

export function encodeGroundFireVisualStyle(style: GroundFireVisualStyle | undefined): number {
  const code = style === undefined ? 0 : GROUND_FIRE_VISUAL_STYLES.indexOf(style);
  return code < 0 ? 0 : code;
}

/** Unbekannte oder fehlende Codes fallen auf `normal` zurück. */
export function decodeGroundFireVisualStyle(code: unknown): GroundFireVisualStyle {
  return typeof code === 'number' && Number.isInteger(code)
    ? GROUND_FIRE_VISUAL_STYLES[code] ?? 'normal'
    : 'normal';
}
