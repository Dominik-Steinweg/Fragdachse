import { DAWN_M3_ASSET_KEYS, type DawnEliteAffixId } from '../../dawn/contracts/DawnContentIds';

export const ELITE_VISUAL_SCALE = 1.1;
export const ELITE_MARKERS = {
  swift: { color: '#9de6ee', glyph: 'chevrons', segments: 2 },
  armored: { color: '#eed59a', glyph: 'plate', segments: 4 },
  volatile: { color: '#ffab80', glyph: 'burst', segments: 8 },
  regenerating: { color: '#b9e6a0', glyph: 'cross', segments: 3 },
  shielding: { color: '#b8bcff', glyph: 'shield', segments: 6 },
} as const;

/** Screen-upright glyph; body size excludes the sprite's transparent animation margin. */
export function eliteMarkerGeometry(affix: DawnEliteAffixId, x: number, y: number, bodySize: number) {
  return { iconKey: DAWN_M3_ASSET_KEYS.eliteAffixIcon(affix), x, y,
    ringDiameter: Math.max(28, bodySize * 1.35), glyphX: x,
    glyphY: y - bodySize * 0.5 - 14, glyphSize: 22 };
}
