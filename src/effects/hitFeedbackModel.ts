/**
 * Deterministische Logik der Trefferreaktion. Ohne Phaser-Import, damit Bandauflösung,
 * Profilabstufung und das Verhalten bei Schaden über Zeit unit-testbar bleiben.
 *
 * Die Schwellen kommen aus {@link BLOOD_HIT_VFX}: Blutspritzer und Silhouettenblitz sollen
 * denselben Treffer gleich einordnen, und Balancing-Zahlen sollen nur an einer Stelle stehen.
 */

import { BLOOD_HIT_VFX, HIT_FEEDBACK_VFX } from '../config';

export type HitBand = 'light' | 'medium' | 'heavy' | 'lethal';
export type FlashAction = 'spawn' | 'rearm' | 'skip';

export interface HitFlashProfile {
  readonly band: HitBand;
  readonly alpha: number;
  readonly durationMs: number;
  readonly scaleBoost: number;
  /** 0 = reine Materialfarbe, 1 = weiß. */
  readonly whiteMix: number;
  /** Grundbetrag des visuellen Impulses, vor `knockbackFactor`. */
  readonly joltPx: number;
  readonly joltMs: number;
  /** Nur schwere und tödliche Treffer schlagen auf die Kamera durch. */
  readonly cameraKickPx: number;
}

export interface ActiveFlashState {
  readonly band: HitBand;
  /** Zeit seit dem letzten (Neu-)Start. */
  readonly ageMs: number;
  /** Zeit seit dem allerersten Start dieser Silhouette. */
  readonly totalLifeMs: number;
}

const BAND_RANK: Readonly<Record<HitBand, number>> = {
  light: 0,
  medium: 1,
  heavy: 2,
  lethal: 3,
};

const ORDERED_BANDS: readonly HitBand[] = ['light', 'medium', 'heavy', 'lethal'];

function promote(band: HitBand): HitBand {
  return ORDERED_BANDS[Math.min(ORDERED_BANDS.length - 1, BAND_RANK[band] + 1)];
}

function cap(band: HitBand, ceiling: HitBand): HitBand {
  return BAND_RANK[band] > BAND_RANK[ceiling] ? ceiling : band;
}

/**
 * Ordnet einen Treffer einem Band zu.
 *
 * - Ein tödlicher Treffer ist immer `lethal`.
 * - Ein kritischer Treffer wird um ein Band hochgestuft, damit er klar erkennbar bleibt.
 * - Ein Treffer, den die Rüstung vollständig geschluckt hat, wird auf `medium` gedeckelt: er
 *   hat den Körper nicht erreicht und darf sich nicht wie ein schwerer Körpertreffer lesen.
 */
export function resolveHitBand(
  totalDamage: number,
  hpLost: number,
  armorLost: number,
  isKill: boolean,
  isCritical: boolean,
): HitBand {
  if (isKill) return 'lethal';

  const damage = Number.isFinite(totalDamage) ? totalDamage : 0;
  let band: HitBand =
    damage <= BLOOD_HIT_VFX.bands.light.maxDamage ? 'light'
    : damage <= BLOOD_HIT_VFX.bands.medium.maxDamage ? 'medium'
    : 'heavy';

  if (isCritical) band = promote(band);
  if (hpLost <= 0 && armorLost > 0) band = cap(band, 'medium');
  return band;
}

export function resolveHitFlashProfile(band: HitBand): HitFlashProfile {
  const preset = HIT_FEEDBACK_VFX.bands[band];
  return {
    band,
    alpha: preset.alpha,
    durationMs: preset.durationMs,
    scaleBoost: preset.scaleBoost,
    whiteMix: preset.whiteMix,
    joltPx: preset.joltPx,
    joltMs: preset.joltMs,
    cameraKickPx: preset.cameraKickPx,
  };
}

/** Mischt die Materialfarbe kanalweise Richtung Weiß. */
export function mixFlashColor(materialColor: number, whiteMix: number): number {
  const t = whiteMix < 0 ? 0 : whiteMix > 1 ? 1 : whiteMix;
  const r = (materialColor >> 16) & 0xff;
  const g = (materialColor >> 8) & 0xff;
  const b = materialColor & 0xff;
  const mix = (channel: number) => Math.round(channel + (0xff - channel) * t);
  return (mix(r) << 16) | (mix(g) << 8) | mix(b);
}

/**
 * Antwort auf Schnellfeuerwaffen und Schaden über Zeit.
 *
 * Ein schwererer Treffer bekommt immer einen frischen Blitz mit voller Stärke. Innerhalb des
 * Refraktärfensters wird ein bestehender Blitz nur aufgefrischt, statt einen zweiten Pool-Slot
 * zu belegen – ein Flammenwerfer mit 20 Ticks pro Sekunde erzeugt so eine durchgehende
 * Silhouette statt 20 gestapelter additiver Kopien. Der Lebenszeitdeckel sorgt dafür, dass
 * daraus ein Pulsieren wird und keine dauerhaft weiße Figur.
 */
export function resolveFlashAction(existing: ActiveFlashState | null, incoming: HitBand): FlashAction {
  if (!existing) return 'spawn';
  if (BAND_RANK[incoming] > BAND_RANK[existing.band]) return 'spawn';
  if (existing.ageMs >= HIT_FEEDBACK_VFX.refractoryMs) return 'spawn';
  if (existing.totalLifeMs >= HIT_FEEDBACK_VFX.maxRearmLifetimeMs) return 'skip';
  return 'rearm';
}

/** Stärkeres Band gewinnt beim Auffrischen. */
export function strongerBand(a: HitBand, b: HitBand): HitBand {
  return BAND_RANK[a] >= BAND_RANK[b] ? a : b;
}

export function hitBandRank(band: HitBand): number {
  return BAND_RANK[band];
}
