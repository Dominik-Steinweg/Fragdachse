import { COLORS } from '../config';
import { INTENT, type ButtonIntent, type ButtonIntentSpec } from './uiTheme';
import { lerpColor } from './uiColor';

export type UiSkin = 'default' | 'forest';

export const FOREST = {
  glass: lerpColor(COLORS.GREEN_6, COLORS.GOLD_4, 0.24),
  sunken: lerpColor(COLORS.GREEN_6, COLORS.GREY_10, 0.65),
  raised: lerpColor(COLORS.BROWN_6, COLORS.GOLD_4, 0.38),
  field: lerpColor(COLORS.BROWN_6, COLORS.GREY_9, 0.45),
  border: COLORS.BROWN_3,
  wood: lerpColor(COLORS.BROWN_6, COLORS.GOLD_4, 0.38),
  woodEdge: COLORS.BROWN_3,
  text: lerpColor(COLORS.BROWN_1, COLORS.GREY_1, 0.55),
  muted: lerpColor(COLORS.GREEN_1, COLORS.GREY_3, 0.5),
} as const;

export function skinTextColor(skin: UiSkin, color: number): number {
  if (skin === 'default') return color;
  if (color === COLORS.GREY_1 || color === COLORS.GREY_2) return FOREST.text;
  if (color === COLORS.GREY_3 || color === COLORS.GREY_4) return FOREST.muted;
  return color;
}

export function buttonSkinSpec(skin: UiSkin, intent: ButtonIntent): ButtonIntentSpec {
  const base = INTENT[intent];
  if (skin === 'default') return base;
  if (intent === 'disabled') return { ...base, fill: FOREST.sunken, stroke: FOREST.woodEdge, label: FOREST.muted };
  if (intent === 'primary') return { ...base, label: FOREST.sunken };
  if (intent === 'danger') return base;
  const attention = intent === 'attention' || intent === 'accent';
  return { ...base, fill: FOREST.wood, stroke: attention ? COLORS.GOLD_1 : FOREST.woodEdge,
    label: attention ? COLORS.GOLD_1 : FOREST.text, labelHover: attention ? COLORS.GOLD_1 : COLORS.GREY_1,
    fillAlpha: 0.94, strokeAlpha: attention ? 0.95 : 0.8, gloss: 0.07 };
}
