/**
 * Laubbläser-Strom: aufgewirbeltes Laub und Dreck entlang der Flugbahn.
 *
 * Alle Raten sind Weglängen statt Zeitintervallen. Ein Projektil verteilt seine Partikel über
 * die seit dem letzten Tick geflogene Strecke; die Spuren aufeinanderfolgender Projektile
 * überlappen dadurch zu einem zusammenhängenden Strom, statt als Büschel um jedes Projektil
 * zu erscheinen. Laubgröße ist absichtlich unabhängig von der wachsenden Trefferfläche; der
 * Wirkungsbereich zeigt sich über seitliche Streuung, Staubschleier und Bodenstriche.
 */
export const LEAF_BLOWER_FX = {
  /** Sichtbare Stromhalbbreite relativ zur aktuellen Trefferflächengröße des Projektils. */
  spreadFactor: 0.62,
  spreadMin: 6,
  /** Blätter und Halme vom Boden: Weg je Partikel in px und Lebensdauer. */
  leaf: {
    spacingPx: 5, lifeMinMs: 480, lifeMaxMs: 950,
    carryMin: 0.18, carryMax: 0.62, lateral: 0.14,
    scaleMin: 0.46, scaleMax: 0.66, spinMax: 13,
    alpha: 0.97,
  },
  clipping: { spacingPx: 15, lifeMinMs: 380, lifeMaxMs: 760, scaleMin: 0.5, scaleMax: 0.7 },
  /** Schwere Erdkrümel: kurze Wege, fallen früh wieder aus dem Strom. */
  grit: {
    grassSpacingPx: 24, dirtSpacingPx: 7, neutralSpacingPx: 14,
    lifeMinMs: 240, lifeMaxMs: 560, carryMin: 0.12, carryMax: 0.5,
    scaleMin: 0.7, scaleMax: 1.15, alpha: 0.92, darken: 0.62,
  },
  /** Bodengefärbter Staubschleier; wächst mit dem Wirkungsbereich. */
  dust: {
    spacingPx: 8, lifeMinMs: 480, lifeMaxMs: 900,
    carryMin: 0.25, carryMax: 0.55,
    alphaMin: 0.14, alphaMax: 0.26, neutralAlphaBoost: 1.35,
    sizeStart: 0.5, sizeEnd: 1, stretchStart: 2.2, stretchEnd: 1.4,
    lighten: 0.55,
  },
  /** Vom Luftstrom niedergedrückter Bewuchs: helle Striche direkt am Boden. */
  streak: {
    spacingPx: 9, lifeMinMs: 320, lifeMaxMs: 620, carry: 0.1,
    alphaMin: 0.16, alphaMax: 0.3, lengthScale: 0.8, width: 0.9, lighten: 0.38,
  },
  /** Über Wasser: Gischt in der Luft plus Kräuselung auf der Oberfläche, aber kein neues Laub. */
  spray: {
    spacingPx: 6, lifeMinMs: 240, lifeMaxMs: 520, carryMin: 0.3, carryMax: 0.85,
    scaleMin: 0.55, scaleMax: 0.95, alphaMin: 0.35, alphaMax: 0.62, tint: 0xe4f6f4,
  },
  mist: {
    spacingPx: 14, lifeMinMs: 420, lifeMaxMs: 760, carryMin: 0.25, carryMax: 0.5,
    alphaMin: 0.12, alphaMax: 0.2, tint: 0xd6ecec,
  },
  ripple: {
    streakSpacingPx: 9, ringSpacingPx: 58, lifeMinMs: 420, lifeMaxMs: 820,
    streakAlphaMin: 0.16, streakAlphaMax: 0.3, ringAlpha: 0.15,
    tint: 0x9fd8d2, ringScaleStart: 0.12, ringScaleEnd: 0.42,
  },
  /** Wasserkontur: ab diesem Abstand innerhalb der sichtbaren Uferlinie gilt der Boden als Wasser. */
  waterDepthPx: -4,
  leafCapacity: 4096,
  groundCapacity: 1536,
  waterCapacity: 1536,
} as const;
