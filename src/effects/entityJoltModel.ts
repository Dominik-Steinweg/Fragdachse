/**
 * Rein visueller Trefferimpuls. Ohne Phaser-Import, damit Betrag, Abklingen und die Deckelung
 * bei Schaden über Zeit unit-testbar bleiben.
 *
 * Wichtig: dieses Modell rechnet nur Offsets aus. Es schreibt sie **nicht** in `sprite.x/y`.
 * Diese Position ist beim Host maßgeblich für Nahkampfkegel, Explosionsradien und
 * Projektil-Treffertests; ein dauerhafter Versatz dort wäre eine Gameplay-Änderung. Das
 * Auftragen übernimmt {@link EntityJoltRegistry} ausschließlich im Renderfenster.
 */

import { HIT_FEEDBACK_VFX } from '../config';

export interface JoltState {
  dirX: number;
  dirY: number;
  peakPx: number;
  elapsedMs: number;
  durationMs: number;
}

export interface JoltOffset {
  readonly x: number;
  readonly y: number;
  readonly finished: boolean;
}

const ATTACK_FRACTION = 0.3;

/**
 * Schneller Ausschlag, weiches Zurücklaufen, bei `t = 1` exakt 0. Bewusst kein Überschwingen:
 * ein zurückfederndes Ziel liest sich cartoonhaft und im Mehrspielerbetrieb wie ein
 * Interpolationsfehler.
 */
export function joltEnvelope(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 0;
  if (t < ATTACK_FRACTION) return t / ATTACK_FRACTION;
  const u = (t - ATTACK_FRACTION) / (1 - ATTACK_FRACTION);
  return 1 - u * u * (3 - 2 * u);
}

/**
 * Betrag des Impulses. `knockbackFactor` stammt aus der Gegnerkonfiguration und ist dort die
 * inverse Gewichtsangabe (leichte Gegner ~1.9, Bossgegner bis 0.1) – schwere Ziele reagieren
 * damit automatisch träger. Der Deckel verhindert, dass eine sehr leichte Einheit bei einem
 * tödlichen Treffer sichtbar von ihrer echten Position wegspringt.
 */
export function resolveJoltPx(basePx: number, knockbackFactor: number, scale = 1): number {
  if (!Number.isFinite(basePx) || basePx <= 0) return 0;
  const factor = Number.isFinite(knockbackFactor) && knockbackFactor > 0 ? knockbackFactor : 0;
  const px = basePx * factor * scale;
  return Math.min(px, HIT_FEEDBACK_VFX.maxJoltPx);
}

/**
 * Überlagert einen neuen Impuls mit einem laufenden. Ein einzelner Schadenstick soll den
 * Ausschlag verstärken können, viele kleine Ticks dürfen ihn aber nicht aufaddieren –
 * deshalb wird der Summenvektor hart auf `maxJoltPx` begrenzt.
 */
export function superposeJolt(
  current: JoltState | null,
  dirX: number,
  dirY: number,
  px: number,
  durationMs: number,
): JoltState | null {
  if (px <= 0 || durationMs <= 0) return current;

  const length = Math.hypot(dirX, dirY);
  const nx = length > 1e-6 ? dirX / length : 1;
  const ny = length > 1e-6 ? dirY / length : 0;

  if (!current) {
    return { dirX: nx, dirY: ny, peakPx: px, elapsedMs: 0, durationMs };
  }

  const remaining = joltEnvelope(current.elapsedMs / current.durationMs) * current.peakPx;
  const sumX = current.dirX * remaining + nx * px;
  const sumY = current.dirY * remaining + ny * px;
  const sumLength = Math.hypot(sumX, sumY);
  if (sumLength <= 1e-6) return null;

  const peakPx = Math.min(sumLength, HIT_FEEDBACK_VFX.maxJoltPx);
  return {
    dirX: sumX / sumLength,
    dirY: sumY / sumLength,
    peakPx,
    elapsedMs: 0,
    durationMs: Math.max(current.durationMs - current.elapsedMs, durationMs),
  };
}

/** Schreibt `elapsedMs` fort und liefert den aktuellen Offset. */
export function stepJolt(state: JoltState, deltaMs: number): JoltOffset {
  state.elapsedMs += deltaMs;
  const t = state.durationMs > 0 ? state.elapsedMs / state.durationMs : 1;
  if (t >= 1) return { x: 0, y: 0, finished: true };
  const magnitude = joltEnvelope(t) * state.peakPx;
  return { x: state.dirX * magnitude, y: state.dirY * magnitude, finished: false };
}
