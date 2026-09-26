/**
 * Waldrelief-Rahmen des Arena-HUDs.
 *
 * Ein kleiner Atlas (`scripts/export-hud-frames.mjs`) liefert eine Kartenform in acht
 * Farbfamilien, eine neutrale Statusleiste und deren Trenner. Die Farbfamilie trägt die
 * Bedeutung – Gold Hauptziel/Rüstung, Violett Angriffswellen, Blau Nebenziele, Grün Erfolg,
 * Rot Ultimate/Fehlschlag, Orange Utility, Bronze Baukapazität, Neutral Status – und ist damit
 * dieselbe Farbsprache wie bei Balken und Texten.
 */
import type * as Phaser from 'phaser';
import { COLORS } from '../config';
import type { LivingBarPalette } from './LivingBarEffect';
import exports from './hudFrameExports.json';

export const HUD_FRAME_TEXTURE = 'hud_frames';

/** Geometrie in Quellpixeln relativ zum jeweiligen Frame (siehe Export-Skript). */
export const HUD_CARD_SOURCE = exports.card;
export const HUD_STRIP_SOURCE = exports.strip;
export const HUD_DIVIDER_SOURCE = exports.divider;

export type HudTone = 'neutral' | 'gold' | 'bronze' | 'blue' | 'purple' | 'green' | 'orange' | 'red';

export interface HudToneStyle {
  /** Leitfarbe für Titel, Werte und Marken. */
  readonly accent: number;
  /** Gedämpfte Zweitfarbe für Kicker und ruhende Marken. */
  readonly muted: number;
  /** Verlauf der Fortschrittsfüllung. */
  readonly fill: LivingBarPalette;
}

export const HUD_TONES: Readonly<Record<HudTone, HudToneStyle>> = {
  neutral: { accent: COLORS.GREY_2, muted: COLORS.GREY_4,
    fill: { dark: COLORS.GREY_6, mid: COLORS.GREY_4, light: COLORS.GREY_2 } },
  gold: { accent: COLORS.GOLD_1, muted: COLORS.GOLD_3,
    fill: { dark: COLORS.GOLD_4, mid: COLORS.GOLD_2, light: COLORS.GOLD_1 } },
  bronze: { accent: COLORS.BROWN_2, muted: COLORS.BROWN_4,
    fill: { dark: COLORS.BROWN_5, mid: COLORS.GOLD_3, light: COLORS.GOLD_1 } },
  blue: { accent: COLORS.BLUE_2, muted: COLORS.BLUE_3,
    fill: { dark: COLORS.BLUE_4, mid: COLORS.BLUE_3, light: COLORS.BLUE_1 } },
  purple: { accent: COLORS.PURPLE_1, muted: COLORS.PURPLE_3,
    fill: { dark: COLORS.PURPLE_5, mid: COLORS.PURPLE_3, light: COLORS.PURPLE_1 } },
  green: { accent: COLORS.GREEN_2, muted: COLORS.GREEN_4,
    fill: { dark: COLORS.GREEN_5, mid: COLORS.GREEN_3, light: COLORS.GREEN_1 } },
  orange: { accent: 0xf0a048, muted: 0xb85c26,
    fill: { dark: 0x8a4018, mid: 0xd97030, light: 0xf0a048 } },
  red: { accent: COLORS.RED_1, muted: COLORS.RED_3,
    fill: { dark: COLORS.RED_4, mid: COLORS.RED_3, light: COLORS.RED_2 } },
};

export function preloadHudFrameAssets(loader: Phaser.Loader.LoaderPlugin): void {
  loader.atlas(HUD_FRAME_TEXTURE, './assets/ui/hud-frames/' + exports.file, exports.atlas);
}

export function hudCardFrame(tone: HudTone): string {
  return `card-${tone}`;
}

/**
 * Nächstliegende Farbfamilie zu einer freien Inhaltsfarbe (z. B. Power-Up-Farben). Entsättigte
 * Farben bleiben neutral; sonst entscheidet der Farbton, bei Gelb-Orange zusätzlich die Helligkeit.
 */
export function hudToneForColor(color: number): HudTone {
  const r = ((color >> 16) & 0xff) / 255;
  const g = ((color >> 8) & 0xff) / 255;
  const b = (color & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  if (chroma < 0.18) return 'neutral';
  let hue: number;
  if (max === r) hue = ((g - b) / chroma) % 6;
  else if (max === g) hue = (b - r) / chroma + 2;
  else hue = (r - g) / chroma + 4;
  hue = (hue * 60 + 360) % 360;
  if (hue < 18 || hue >= 330) return 'red';
  if (hue < 34) return 'orange';
  if (hue < 55) return max > 0.8 ? 'gold' : 'bronze';
  if (hue < 165) return 'green';
  if (hue < 250) return 'blue';
  return 'purple';
}
