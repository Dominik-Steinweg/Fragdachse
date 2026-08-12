/**
 * uiTheme – gemeinsame Design-Tokens der gesamten Spieloberflaeche.
 *
 * `COLORS` in `config.ts` bleibt die Quelle der Rohfarben; dieses Modul gibt ihnen Rollen.
 * Damit steht an einer Stelle, *wofuer* eine Farbe da ist, statt in jeder UI-Datei erneut
 * als lokale Konstante (`ACCENT`, `PANEL_COLOR`, `BTN_*_COLOR`) zu erscheinen.
 *
 * Leitregel der Farbhierarchie: pro Bildschirm gibt es genau **eine** gesaettigte Flaeche –
 * den primaeren Handlungsaufruf. Alles andere ist neutral oder ghost; Gold bleibt der
 * Progression vorbehalten, Rot echten Fehlern. Wer einen zweiten `primary`-Button setzt,
 * nimmt dem ersten seine Wirkung.
 */
// Bewusst ein reiner Typ-Import: dieses Modul enthaelt keine Phaser-Aufrufe und bleibt dadurch
// unter vitest ladbar, wo `phaser` nicht importiert werden kann.
import type * as Phaser from 'phaser';
import { COLORS, toCssColor } from '../config';

// ── Schriftfamilien ──────────────────────────────────────────────────────────
// Der monospace-Fallback bleibt in jedem String: laedt eine Webfont nicht oder zu spaet,
// rastert Phaser mit dem Fallback statt mit einer Ersatzschrift unbekannter Metrik.
export const FONT_DISPLAY = '"Chakra Petch", "Segoe UI", system-ui, monospace';
export const FONT_MONO = '"JetBrains Mono", ui-monospace, monospace';

/** Nur diese Schnitte werden geladen – andere Gewichte wuerde der Browser synthetisieren. */
export const FONT_WEIGHT = {
  regular: '400',
  medium: '500',
  bold: '700',
} as const;

// ── Flaechen ─────────────────────────────────────────────────────────────────
export const SURFACE = {
  /** Modale Hauptflaeche (Lobby-Panel, Overlays). */
  modal: COLORS.GREY_8,
  /** Erhoehte Flaeche darin (Listenzeilen, Buttons im Ruhezustand). */
  raised: COLORS.GREY_7,
  /** Vertiefte Flaeche (Balken-Hintergruende, Eingabefelder). */
  sunken: COLORS.GREY_9,
  /** Glasflaeche der Seitenspalten ueber dem Arena-Hintergrund. */
  glass: COLORS.GREY_9,
} as const;

export const BORDER = {
  subtle: COLORS.GREY_6,
  default: COLORS.GREY_5,
  accent: COLORS.GOLD_1,
} as const;

export const TEXT = {
  primary: COLORS.GREY_1,
  secondary: COLORS.GREY_2,
  muted: COLORS.GREY_4,
  disabled: COLORS.GREY_5,
  accent: COLORS.GOLD_1,
  /** Beschriftung auf hellen Akzentflaechen. */
  onAccent: COLORS.GOLD_6,
  success: COLORS.GREEN_2,
  danger: COLORS.RED_2,
} as const;

// ── Button-Intents ───────────────────────────────────────────────────────────

export type ButtonIntent = 'primary' | 'accent' | 'neutral' | 'ghost' | 'danger' | 'disabled';

export interface ButtonIntentSpec {
  /** Grundfarbe; `ensureGlossyButtonTexture` leitet Verlauf und Glanz daraus ab. */
  readonly fill: number;
  readonly stroke: number;
  readonly label: number;
  readonly fillAlpha: number;
  readonly strokeAlpha: number;
  /** Staerke des Glanz-Highlights. 0 = wirkt nicht drueckbar. */
  readonly gloss: number;
  /** Deckkraft des Buttons im Ruhezustand. */
  readonly restAlpha: number;
  /** Beschriftungsfarbe im Hover-Zustand, falls sie sich vom Ruhezustand unterscheidet. */
  readonly labelHover?: number;
  /** `false` unterdrueckt Hover-, Press- und Cursor-Reaktion. */
  readonly interactive: boolean;
}

export const INTENT: Readonly<Record<ButtonIntent, ButtonIntentSpec>> = {
  /**
   * Der eine Handlungsaufruf pro Bildschirm. Helle Flaeche mit dunkler Beschriftung –
   * dasselbe Prinzip wie `accent`, damit beide als "aktiv" statt als "Flaeche" lesen.
   */
  primary: {
    fill: COLORS.GREEN_2,
    stroke: COLORS.GREEN_1,
    label: COLORS.GREEN_6,
    fillAlpha: 0.97,
    strokeAlpha: 0.9,
    gloss: 0.24,
    restAlpha: 1,
    interactive: true,
  },
  /** Progression und Belohnung. Konsistent mit "Hauptziel Gold" aus den Visual-Guidelines. */
  accent: {
    fill: COLORS.GOLD_2,
    stroke: COLORS.GOLD_1,
    label: COLORS.GOLD_6,
    fillAlpha: 0.97,
    strokeAlpha: 0.9,
    gloss: 0.26,
    restAlpha: 1,
    interactive: true,
  },
  /** Standard fuer alles, was weder Einstieg noch Nebensache ist. */
  neutral: {
    fill: COLORS.GREY_7,
    stroke: COLORS.GREY_5,
    label: COLORS.GREY_2,
    fillAlpha: 0.95,
    strokeAlpha: 0.8,
    gloss: 0.16,
    restAlpha: 1,
    labelHover: COLORS.GREY_1,
    interactive: true,
  },
  /**
   * Werkzeuge und Nebenwege (Host-Funktionen, Diagnose, Vollbild, Pfeile). Fast transparent,
   * damit sie erreichbar bleiben, ohne um Aufmerksamkeit zu konkurrieren.
   */
  ghost: {
    fill: COLORS.GREY_9,
    stroke: COLORS.GREY_6,
    label: COLORS.GREY_3,
    fillAlpha: 0.34,
    strokeAlpha: 0.7,
    gloss: 0.06,
    restAlpha: 1,
    labelHover: COLORS.GREY_1,
    interactive: true,
  },
  /** Nur Zerstoerendes und echte Fehlerzustaende – nie ein normaler Handlungsaufruf. */
  danger: {
    fill: COLORS.RED_4,
    stroke: COLORS.RED_2,
    label: COLORS.GREY_1,
    fillAlpha: 0.97,
    strokeAlpha: 0.9,
    gloss: 0.22,
    restAlpha: 1,
    interactive: true,
  },
  disabled: {
    fill: COLORS.GREY_8,
    stroke: COLORS.GREY_6,
    label: COLORS.GREY_5,
    fillAlpha: 0.9,
    strokeAlpha: 0.5,
    gloss: 0,
    restAlpha: 0.5,
    interactive: false,
  },
} as const;

// ── Typografie ───────────────────────────────────────────────────────────────

export type TypeRole =
  | 'display'
  | 'title'
  | 'subtitle'
  | 'section'
  | 'label'
  | 'labelSm'
  | 'body'
  | 'caption'
  | 'micro'
  | 'numL'
  | 'numM'
  | 'numS'
  | 'code';

export interface TypeSpec {
  readonly size: number;
  readonly weight: string;
  readonly family: string;
  /** Zusatzabstand je Zeichen in Pixeln (Phaser rechnet nicht in em). */
  readonly tracking: number;
  /** Vorgabefarbe der Rolle; `textStyle` kann sie ueberschreiben. */
  readonly color: number;
  /** Nur dokumentierend: die Rolle ist fuer Grossbuchstaben entworfen. */
  readonly caps?: boolean;
}

export const TYPE: Readonly<Record<TypeRole, TypeSpec>> = {
  /** Grosse Ueberschrift eines Overlays. */
  display: { size: 34, weight: FONT_WEIGHT.bold, family: FONT_DISPLAY, tracking: 1, color: TEXT.primary },
  /** Panel-Kopfzeile, "Level 90". */
  title: { size: 24, weight: FONT_WEIGHT.bold, family: FONT_DISPLAY, tracking: 0.5, color: TEXT.primary },
  /** Sektionsueberschrift, Beschriftung des primaeren Buttons. */
  subtitle: { size: 19, weight: FONT_WEIGHT.bold, family: FONT_DISPLAY, tracking: 0.5, color: TEXT.primary },
  /** Kleiner Sektionskopf ueber einer Gruppe ("SPIELER", "AUSRÜSTUNG"). */
  section: { size: 13, weight: FONT_WEIGHT.bold, family: FONT_DISPLAY, tracking: 1.6, color: TEXT.muted, caps: true },
  /** Standard-Buttonbeschriftung. */
  label: { size: 15, weight: FONT_WEIGHT.bold, family: FONT_DISPLAY, tracking: 1.2, color: TEXT.secondary, caps: true },
  /** Beschriftung kompakter Buttons. */
  labelSm: { size: 13, weight: FONT_WEIGHT.bold, family: FONT_DISPLAY, tracking: 1, color: TEXT.secondary, caps: true },
  /** Fliesstext, Spielernamen. */
  body: { size: 15, weight: FONT_WEIGHT.medium, family: FONT_DISPLAY, tracking: 0, color: TEXT.secondary },
  /** Unterzeile, Slot-Beschriftung ("Waffe 1"). */
  caption: { size: 13, weight: FONT_WEIGHT.medium, family: FONT_DISPLAY, tracking: 0.3, color: TEXT.muted },
  /** Version, transiente Hinweise. */
  micro: { size: 11, weight: FONT_WEIGHT.medium, family: FONT_DISPLAY, tracking: 0.8, color: TEXT.muted, caps: true },
  /** Grosse Zahl (Level). Mono liefert Tabellenziffern, damit nichts springt. */
  numL: { size: 22, weight: FONT_WEIGHT.bold, family: FONT_MONO, tracking: 0, color: TEXT.primary },
  /** Zahlenwert in einer Zeile (Ping, Punkte). */
  numM: { size: 15, weight: FONT_WEIGHT.regular, family: FONT_MONO, tracking: 0.5, color: TEXT.secondary },
  numS: { size: 13, weight: FONT_WEIGHT.regular, family: FONT_MONO, tracking: 0.5, color: TEXT.muted },
  /** Raumcode – weit gesperrt, damit er abgelesen und diktiert werden kann. */
  code: { size: 17, weight: FONT_WEIGHT.bold, family: FONT_MONO, tracking: 2.4, color: TEXT.accent },
} as const;

export interface TextStyleOverrides {
  color?: number;
  align?: 'left' | 'center' | 'right';
  wordWrapWidth?: number;
  /** Ueberschreibt die Laufweite der Rolle (z. B. 0 fuer sehr enge Spalten). */
  tracking?: number;
}

/**
 * Baut die Phaser-Textstil-Struktur einer Typo-Rolle.
 *
 * Ersetzt die verstreuten Inline-Literale (`{ fontSize: '15px', fontFamily: 'monospace', … }`).
 * Immer ueber `scene.add.text` verwenden – nur dort haengt `installTextResolution` die
 * Aufloesungsbehandlung ein.
 */
export function textStyle(
  role: TypeRole,
  overrides?: TextStyleOverrides,
): Phaser.Types.GameObjects.Text.TextStyle {
  const spec = TYPE[role];
  const style: Phaser.Types.GameObjects.Text.TextStyle = {
    fontFamily: spec.family,
    fontSize: `${spec.size}px`,
    fontStyle: spec.weight,
    color: toCssColor(overrides?.color ?? spec.color),
    letterSpacing: overrides?.tracking ?? spec.tracking,
  };
  if (overrides?.align) style.align = overrides.align;
  if (overrides?.wordWrapWidth !== undefined) {
    style.wordWrap = { width: overrides.wordWrapWidth, useAdvancedWrap: true };
  }
  return style;
}

// ── Raster ───────────────────────────────────────────────────────────────────

/** 4er-Basis. Abstaende in Layouts kommen aus dieser Leiter, nicht aus freien Zahlen. */
export const SPACE = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  huge: 64,
} as const;

export const RADIUS = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
} as const;

// ── Bewegung ─────────────────────────────────────────────────────────────────

export const MOTION = {
  /** Press-Reaktion – muss vor dem naechsten Frame sitzen. */
  instant: 70,
  /** Hover. */
  fast: 110,
  /** Zustandswechsel, Listenzeilen. */
  base: 160,
  /** Auftritt eines Panels. */
  slow: 260,
  ease: {
    out: 'Quad.easeOut',
    inOut: 'Quad.easeInOut',
    hover: 'Sine.easeOut',
    /** Nur fuer zentrierte Sub-Container – nie fuer Container mit absoluten Kindern. */
    pop: 'Back.easeOut',
  },
  /** Versatz gestaffelter Auftritte. */
  stagger: 40,
} as const;

/** Skalierungsfaktoren der Button-Zustaende. Bewusst dezent: 1.06 wirkt auf breiten Buttons ruckartig. */
export const BUTTON_SCALE = {
  hover: 1.035,
  press: 0.97,
} as const;

// ── Kontrast ─────────────────────────────────────────────────────────────────

/** Relative Leuchtdichte nach WCAG 2.1. */
export function relativeLuminance(color: number): number {
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = channel((color >> 16) & 0xff);
  const g = channel((color >> 8) & 0xff);
  const b = channel(color & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Kontrastverhaeltnis zweier Farben, 1 (identisch) bis 21 (Schwarz auf Weiss). */
export function contrastRatio(a: number, b: number): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Der Farbton, auf dem eine mittig sitzende Beschriftung tatsaechlich liegt.
 *
 * `ensureGlossyButtonTexture` fuellt mit einem senkrechten Verlauf von
 * `lerp(fill, weiss, 0.16)` nach `lerp(fill, schwarz, 0.30)`. Ein Kontrastvergleich gegen die
 * reine Grundfarbe waere deshalb zu optimistisch.
 */
export function buttonMidTone(fill: number): number {
  const mix = (shift: number): number => {
    const top = (c: number): number => c + (255 - c) * 0.16;
    const bottom = (c: number): number => c * 0.7;
    const channel = (fill >> shift) & 0xff;
    return Math.round((top(channel) + bottom(channel)) / 2);
  };
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}
