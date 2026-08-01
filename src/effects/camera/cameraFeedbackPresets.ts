/**
 * Benannte Kamera-Ereignisse. Sie ersetzen die früheren direkten `cameras.main.shake()`-Aufrufe
 * und halten Amplituden, Dauern und Prioritäten an einer Stelle vergleichbar.
 *
 * Die Amplituden entsprechen den bisherigen Shake-Intensitäten: Phaser skalierte
 * `intensity` mit der Viewportbreite, ein Wert von 0.018 entsprach also rund 35 Designpixeln.
 * Für konfigurationsgetriebene Werte (Waffenrückstoß, Felsplatzierung) übernimmt
 * {@link legacyShakeAmplitudePx} genau diese Umrechnung, damit keine Balancing-Zahl neu
 * getunt werden muss.
 */

import { GAME_WIDTH } from '../../config';
import type { CameraFeedbackRequest } from './CameraFeedbackModel';

/** Rechnet eine alte Phaser-Shake-Intensität in Designpixel um. */
export function legacyShakeAmplitudePx(intensity: number): number {
  if (!Number.isFinite(intensity) || intensity <= 0) return 0;
  return intensity * GAME_WIDTH;
}

export const CAMERA_FEEDBACK_PRIORITY = {
  charge: 10,
  weaponRecoil: 20,
  projectile: 30,
  lightImpact: 40,
  mediumImpact: 55,
  heavyImpact: 70,
  telegraph: 85,
  exceptional: 100,
} as const;

interface ImpactOptions {
  readonly sourceX?: number;
  readonly sourceY?: number;
  readonly dirX?: number;
  readonly dirY?: number;
}

function impact(
  amplitudePx: number,
  durationMs: number,
  priority: number,
  options: ImpactOptions = {},
): CameraFeedbackRequest {
  return {
    channel: 'impact',
    amplitudePx,
    durationMs,
    priority,
    decay: 'impulse',
    dirX: options.dirX,
    dirY: options.dirY,
    sourceX: options.sourceX,
    sourceY: options.sourceY,
  };
}

/** Nuke-Detonation und vergleichbare Einzelereignisse. */
export function impactExceptional(options?: ImpactOptions): CameraFeedbackRequest {
  return impact(38, 550, CAMERA_FEEDBACK_PRIORITY.exceptional, options);
}

/** Große Explosionen, Holy Explosion, Meteoreinschlag. */
export function impactHeavy(options?: ImpactOptions): CameraFeedbackRequest {
  return impact(32, 520, CAMERA_FEEDBACK_PRIORITY.heavyImpact, options);
}

export function impactMedium(options?: ImpactOptions): CameraFeedbackRequest {
  return impact(27, 460, CAMERA_FEEDBACK_PRIORITY.mediumImpact, options);
}

/** Energie-Explosion, Felsplatzierung, kleine Einschläge. */
export function impactLight(options?: ImpactOptions): CameraFeedbackRequest {
  return impact(10, 180, CAMERA_FEEDBACK_PRIORITY.lightImpact, options);
}

/** Kurzer gerichteter Stoß, etwa Waffenrückstoß entgegen der Schussrichtung. */
export function directionalKick(
  dirX: number,
  dirY: number,
  amplitudePx: number,
  durationMs: number,
  priority: number = CAMERA_FEEDBACK_PRIORITY.weaponRecoil,
): CameraFeedbackRequest {
  return { channel: 'kick', amplitudePx, durationMs, priority, dirX, dirY, decay: 'impulse' };
}

/**
 * Dauerhaftes Rumpeln. Die `id` ist Pflicht: Aufrufer feuern das pro Frame, und nur über eine
 * stabile Kennung wird die Quelle aktualisiert statt gestapelt oder neu gestartet.
 *
 * `durationMs` wirkt als Selbstheilung, falls ein Aufrufer das Freigeben vergisst – die Quelle
 * verschwindet dann von allein, sobald sie nicht mehr aufgefrischt wird.
 */
export function sustainedRumble(
  id: string,
  amplitudePx: number,
  priority: number,
  options: { sourceX?: number; sourceY?: number; frequencyHz?: number; durationMs?: number } = {},
): CameraFeedbackRequest {
  return {
    id,
    channel: 'rumble',
    amplitudePx,
    durationMs: options.durationMs ?? 400,
    priority,
    decay: 'linear',
    frequencyHz: options.frequencyHz,
    sourceX: options.sourceX,
    sourceY: options.sourceY,
  };
}

/**
 * BFG im Flug. Läuft pro Frame, solange ein Orb unterwegs ist – früher genau der Fall, der über
 * Phasers `isRunning`-Prüfung jede stärkere Erschütterung blockierte. Als niedrig priorisierte
 * Dauerquelle trägt es jetzt nur noch einen kleinen Anteil bei und verdrängt nichts mehr.
 */
export function bfgFlightRumble(): CameraFeedbackRequest {
  return sustainedRumble(
    'bfg:flight',
    legacyShakeAmplitudePx(0.003),
    CAMERA_FEEDBACK_PRIORITY.projectile,
    { durationMs: 260 },
  );
}

/** Ladephase einer Waffe. Niedrigste Priorität: reines Haptik-Feedback für den Schützen. */
export function chargeRumble(slot: string, intensity: number): CameraFeedbackRequest {
  return sustainedRumble(
    `charge:${slot}`,
    legacyShakeAmplitudePx(intensity),
    CAMERA_FEEDBACK_PRIORITY.charge,
    { durationMs: 200 },
  );
}
