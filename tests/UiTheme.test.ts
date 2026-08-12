import { describe, expect, it } from 'vitest';
import { COLORS } from '../src/config';
import {
  BUTTON_SCALE,
  FONT_DISPLAY,
  FONT_MONO,
  FONT_WEIGHT,
  INTENT,
  MOTION,
  RADIUS,
  SPACE,
  TYPE,
  buttonMidTone,
  contrastRatio,
  relativeLuminance,
  textStyle,
  type ButtonIntent,
  type TypeRole,
} from '../src/ui/uiTheme';

const INTENT_NAMES = Object.keys(INTENT) as ButtonIntent[];
const TYPE_ROLES = Object.keys(TYPE) as TypeRole[];

/** WCAG 2.1 AA fuer normalen Text. Gilt hier auch fuer die kleinen Buttonbeschriftungen. */
const MIN_CONTRAST = 4.5;

describe('contrast helpers', () => {
  it('matches the WCAG reference points', () => {
    expect(relativeLuminance(0xffffff)).toBeCloseTo(1, 5);
    expect(relativeLuminance(0x000000)).toBeCloseTo(0, 5);
    expect(contrastRatio(0xffffff, 0x000000)).toBeCloseTo(21, 2);
    expect(contrastRatio(0x777777, 0x777777)).toBeCloseTo(1, 5);
  });

  it('is symmetric', () => {
    expect(contrastRatio(COLORS.GREY_1, COLORS.GREY_9))
      .toBeCloseTo(contrastRatio(COLORS.GREY_9, COLORS.GREY_1), 10);
  });

  it('reports the gradient mid tone, not the raw fill', () => {
    // ensureGlossyButtonTexture verlaeuft von lerp(fill, weiss, .16) nach lerp(fill, schwarz, .30);
    // die Mitte liegt deshalb unter der Grundfarbe.
    expect(buttonMidTone(0x808080)).not.toBe(0x808080);
    expect(relativeLuminance(buttonMidTone(0x808080))).toBeLessThan(relativeLuminance(0x808080));
  });
});

describe('button intents', () => {
  it('keeps every interactive label legible on its own gradient', () => {
    for (const name of INTENT_NAMES) {
      const spec = INTENT[name];
      if (!spec.interactive) continue;
      const ratio = contrastRatio(spec.label, buttonMidTone(spec.fill));
      expect(ratio, `intent "${name}" label contrast`).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
  });

  it('keeps hover labels at least as legible as the resting ones', () => {
    for (const name of INTENT_NAMES) {
      const spec = INTENT[name];
      if (spec.labelHover === undefined) continue;
      const mid = buttonMidTone(spec.fill);
      expect(contrastRatio(spec.labelHover, mid), `intent "${name}" hover contrast`)
        .toBeGreaterThanOrEqual(contrastRatio(spec.label, mid));
    }
  });

  it('separates the border from the fill so the edge stays visible', () => {
    for (const name of INTENT_NAMES) {
      const spec = INTENT[name];
      expect(spec.stroke, `intent "${name}" stroke equals fill`).not.toBe(spec.fill);
    }
  });

  it('marks only the disabled intent as non-interactive', () => {
    const nonInteractive = INTENT_NAMES.filter((name) => !INTENT[name].interactive);
    expect(nonInteractive).toEqual(['disabled']);
    expect(INTENT.disabled.restAlpha).toBeLessThan(1);
    expect(INTENT.disabled.gloss).toBe(0);
  });

  it('reserves the saturated intents for their documented meaning', () => {
    // Gold = Progression, Rot = Fehlschlag, Gruen = positiver Abschluss/Einstieg.
    // Siehe docs/ai/visual-guidelines.md, "Zielankuendigungen".
    expect(INTENT.accent.fill).toBe(COLORS.GOLD_2);
    expect(INTENT.danger.fill).toBe(COLORS.RED_4);
    expect(INTENT.primary.fill).toBe(COLORS.GREEN_2);
    // Blau bleibt den Nebenmissionen im Spiel vorbehalten und taucht in keinem Intent auf.
    const blues = new Set<number>([
      COLORS.BLUE_1, COLORS.BLUE_2, COLORS.BLUE_3, COLORS.BLUE_4, COLORS.BLUE_5, COLORS.BLUE_6,
    ]);
    for (const name of INTENT_NAMES) {
      const spec = INTENT[name];
      expect(blues.has(spec.fill), `intent "${name}" uses a reserved blue`).toBe(false);
    }
  });

  it('keeps ghost quiet and neutral solid', () => {
    expect(INTENT.ghost.fillAlpha).toBeLessThan(INTENT.neutral.fillAlpha);
    expect(INTENT.ghost.gloss).toBeLessThan(INTENT.neutral.gloss);
  });
});

describe('type scale', () => {
  it('only asks for weights that are actually loaded', () => {
    const loaded = new Set<string>(Object.values(FONT_WEIGHT));
    for (const role of TYPE_ROLES) {
      expect(loaded.has(TYPE[role].weight), `role "${role}" weight ${TYPE[role].weight}`).toBe(true);
    }
  });

  it('uses one of the two families and keeps a fallback', () => {
    for (const role of TYPE_ROLES) {
      expect([FONT_DISPLAY, FONT_MONO]).toContain(TYPE[role].family);
    }
    expect(FONT_DISPLAY).toContain('monospace');
    expect(FONT_MONO).toContain('monospace');
  });

  it('routes every numeric role through the monospace family', () => {
    // Tabellenziffern verhindern, dass Ping- und Punktespalten bei jedem Update springen.
    for (const role of ['numL', 'numM', 'numS', 'code'] as const) {
      expect(TYPE[role].family, `role "${role}"`).toBe(FONT_MONO);
    }
  });

  it('gives caps roles positive tracking', () => {
    for (const role of TYPE_ROLES) {
      if (!TYPE[role].caps) continue;
      expect(TYPE[role].tracking, `role "${role}" tracking`).toBeGreaterThan(0);
    }
  });

  it('orders the scale from micro up to display', () => {
    const ladder: TypeRole[] = ['micro', 'caption', 'body', 'subtitle', 'title', 'display'];
    const sizes = ladder.map((role) => TYPE[role].size);
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
    expect(new Set(sizes).size).toBe(sizes.length);
  });
});

describe('textStyle', () => {
  it('builds a complete Phaser style from a role', () => {
    const style = textStyle('label');
    expect(style.fontFamily).toBe(FONT_DISPLAY);
    expect(style.fontSize).toBe(`${TYPE.label.size}px`);
    expect(style.fontStyle).toBe(FONT_WEIGHT.bold);
    expect(style.letterSpacing).toBe(TYPE.label.tracking);
    expect(style.color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('applies overrides without touching the role defaults', () => {
    const overridden = textStyle('body', { color: COLORS.GOLD_1, tracking: 0, align: 'center' });
    expect(overridden.color).toBe('#e8c170');
    expect(overridden.letterSpacing).toBe(0);
    expect(overridden.align).toBe('center');
    // Die Rolle selbst bleibt unveraendert.
    expect(textStyle('body').letterSpacing).toBe(TYPE.body.tracking);
  });

  it('only emits wordWrap when a width is given', () => {
    expect(textStyle('body').wordWrap).toBeUndefined();
    expect(textStyle('body', { wordWrapWidth: 240 }).wordWrap).toEqual({
      width: 240,
      useAdvancedWrap: true,
    });
  });

  it('produces a valid style for every role', () => {
    for (const role of TYPE_ROLES) {
      const style = textStyle(role);
      expect(style.color, `role "${role}"`).toMatch(/^#[0-9a-f]{6}$/);
      expect(style.fontSize, `role "${role}"`).toMatch(/^\d+px$/);
    }
  });
});

describe('layout scales', () => {
  it('keeps spacing on a 4px grid and strictly ascending', () => {
    const steps = Object.values(SPACE);
    for (const step of steps) expect(step % 4).toBe(0);
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
  });

  it('keeps radii ascending', () => {
    const radii = Object.values(RADIUS);
    expect(radii).toEqual([...radii].sort((a, b) => a - b));
  });

  it('orders the motion durations from press to panel entrance', () => {
    expect(MOTION.instant).toBeLessThan(MOTION.fast);
    expect(MOTION.fast).toBeLessThan(MOTION.base);
    expect(MOTION.base).toBeLessThan(MOTION.slow);
  });

  it('keeps the button feedback subtle', () => {
    expect(BUTTON_SCALE.hover).toBeGreaterThan(1);
    expect(BUTTON_SCALE.hover).toBeLessThan(1.06);
    expect(BUTTON_SCALE.press).toBeLessThan(1);
  });
});
