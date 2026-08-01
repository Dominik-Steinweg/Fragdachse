/**
 * Abschließende Liste der Ereignisse, die eine globale Post-FX-Reaktion auslösen dürfen.
 *
 * Normale Schüsse, normale Treffer an beliebigen Zielen und kleine Explosionen stehen bewusst
 * **nicht** darin: sie werden über den Silhouettenblitz am Ziel und das Kamera-Feedback
 * beantwortet. Ein globaler Bildeffekt pro Treffer wäre bei zwanzig Treffern pro Sekunde weder
 * lesbar noch bezahlbar, und er nähme den außergewöhnlichen Ereignissen ihre Wirkung.
 *
 * Die Liste steht an einer Stelle, damit im Review nachvollziehbar bleibt, was global wirkt.
 */

import { VOID_FIRE_COLOR } from '../../config';
import type { PostFxPulse } from './PostFxComposer';

export const POST_FX_EVENTS = [
  'heavyLocalHit',
  'bossPhaseChange',
  'nukeDetonation',
  'voidNukeDetonation',
  'blackHoleSpawn',
  'blackHoleCollapse',
  'teleport',
  'localDeath',
] as const;

export type PostFxEvent = (typeof POST_FX_EVENTS)[number];

export const POST_FX_PRIORITY = {
  hit: 30,
  teleport: 45,
  bossPhase: 60,
  blackHole: 80,
  death: 85,
  nuke: 100,
} as const;

/** Ab dieser Priorität darf ein Ereignis die Bildgeometrie verzerren. */
export const BARREL_MIN_PRIORITY = 90;

const NUKE_WARM_TINT = 0xffb066;

const PRESETS: Readonly<Record<PostFxEvent, PostFxPulse>> = {
  /**
   * Schwerer Treffer am **lokalen** Spieler. Kurz, entsättigt und dunkelt den Rand ab – die
   * Rand-Vignette des Schadens bleibt daneben bestehen und wird hier nur unterstützt.
   */
  heavyLocalHit: {
    priority: POST_FX_PRIORITY.hit,
    durationMs: 260,
    ease: 'impulse',
    grade: { saturation: -0.08, contrast: 0.04, vignetteStrength: 0.14 },
  },

  bossPhaseChange: {
    priority: POST_FX_PRIORITY.bossPhase,
    durationMs: 900,
    ease: 'expo',
    grade: { saturation: -0.06, contrast: 0.05, tintStrength: 0.1, vignetteStrength: 0.08 },
  },

  /** Normale Nuke: warmer Belichtungsstoß mit kurzer Bloom-Spitze. */
  nukeDetonation: {
    priority: POST_FX_PRIORITY.nuke,
    durationMs: 1400,
    ease: 'impulse',
    grade: {
      brightness: 0.06,
      contrast: 0.06,
      saturation: -0.05,
      tint: NUKE_WARM_TINT,
      tintStrength: 0.22,
      bloomAmount: 0.34,
      vignetteStrength: 0.1,
    },
  },

  /** Void-Nuke: gleiche Grammatik, anderes Farbprofil. */
  voidNukeDetonation: {
    priority: POST_FX_PRIORITY.nuke,
    durationMs: 1400,
    ease: 'impulse',
    grade: {
      brightness: 0.05,
      contrast: 0.07,
      saturation: -0.07,
      tint: VOID_FIRE_COLOR,
      tintStrength: 0.26,
      bloomAmount: 0.34,
      vignetteStrength: 0.12,
    },
  },

  blackHoleSpawn: {
    priority: POST_FX_PRIORITY.blackHole,
    durationMs: 1100,
    ease: 'expo',
    grade: { saturation: -0.1, contrast: 0.05, tint: VOID_FIRE_COLOR, tintStrength: 0.16, vignetteStrength: 0.18 },
  },

  blackHoleCollapse: {
    priority: POST_FX_PRIORITY.blackHole,
    durationMs: 520,
    ease: 'impulse',
    grade: { brightness: 0.04, contrast: 0.06, vignetteStrength: -0.06 },
  },

  teleport: {
    priority: POST_FX_PRIORITY.teleport,
    durationMs: 300,
    ease: 'impulse',
    grade: { saturation: -0.12, brightness: 0.03 },
  },

  /** Eigener Tod: die Welt tritt zurück, damit die Auswertung im Vordergrund steht. */
  localDeath: {
    priority: POST_FX_PRIORITY.death,
    durationMs: 1200,
    ease: 'expo',
    grade: { saturation: -0.15, contrast: -0.04, vignetteStrength: 0.3 },
  },
};

export function getPostFxPreset(event: PostFxEvent): PostFxPulse {
  return PRESETS[event];
}

export function isPostFxEvent(value: string): value is PostFxEvent {
  return (POST_FX_EVENTS as readonly string[]).includes(value);
}
