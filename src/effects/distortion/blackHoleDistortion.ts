/**
 * Verlauf der Gravitationslinse eines Schwarzen Lochs. Ohne Phaser-Import, damit Aufbau,
 * Halten und der Gegenimpuls beim Kollaps prüfbar sind statt von Tweens abzuhängen.
 *
 * Bewusst **ohne** globale Kamera- oder Post-FX-Reaktion: die Waffe hat einen niedrigen
 * Cooldown, und ein bildweiter Effekt bei jedem Einsatz wäre Rauschen statt Regie. Die Wirkung
 * bleibt lokal auf das Feld begrenzt.
 */

import type { DistortionProfileKey } from './distortionProfileBake';

export interface BlackHoleDistortionFrame {
  readonly profile: DistortionProfileKey;
  /** 0..1 */
  readonly strength: number;
  /** Faktor auf den Feldradius – der Gegenimpuls läuft nach außen. */
  readonly radiusScale: number;
  readonly finished: boolean;
}

/** Anteil der Lebensdauer, über den sich die Linse aufbaut. */
const SPAWN_FRACTION = 0.18;
/** Ab hier kippt der Sog in den auswärts laufenden Gegenimpuls. */
const COLLAPSE_START = 0.85;

const FINISHED: BlackHoleDistortionFrame = {
  profile: 'pullSwirl',
  strength: 0,
  radiusScale: 1,
  finished: true,
};

function smoothstep(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

export function resolveBlackHoleDistortion(
  elapsedMs: number,
  durationMs: number,
): BlackHoleDistortionFrame {
  if (durationMs <= 0) return FINISHED;
  const t = elapsedMs / durationMs;
  if (t < 0 || t >= 1) return FINISHED;

  if (t >= COLLAPSE_START) {
    // Gegenimpuls: der Sog kehrt sich für einen Moment um und läuft als Ring nach außen.
    // Ohne ihn endete die Linse mit einem harten Sprung zurück auf Neutral.
    const u = (t - COLLAPSE_START) / (1 - COLLAPSE_START);
    return {
      profile: 'ring',
      strength: Math.sin(Math.PI * u),
      radiusScale: 0.65 + u * 0.95,
      finished: false,
    };
  }

  const strength = t < SPAWN_FRACTION ? smoothstep(t / SPAWN_FRACTION) : 1;
  return { profile: 'pullSwirl', strength, radiusScale: 1, finished: false };
}
