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
    durationMs: 380,
    // `expo` statt `impulse`: ein Treffer soll sofort auf voller Stärke stehen. Die
    // Anstiegsflanke von `impulse` verschluckt bei kurzen Pulsen den Ausschlag.
    ease: 'expo',
    grade: { saturation: -0.22, contrast: 0.1, vignetteStrength: 0.32 },
  },

  bossPhaseChange: {
    priority: POST_FX_PRIORITY.bossPhase,
    durationMs: 1200,
    ease: 'expo',
    grade: { saturation: -0.16, contrast: 0.12, tintStrength: 0.26, vignetteStrength: 0.18 },
  },

  /** Normale Nuke: warmer Belichtungsstoß mit kurzer Bloom-Spitze. */
  nukeDetonation: {
    priority: POST_FX_PRIORITY.nuke,
    durationMs: 1500,
    ease: 'impulse',
    grade: {
      brightness: 0.16,
      contrast: 0.16,
      saturation: -0.14,
      tint: NUKE_WARM_TINT,
      tintStrength: 0.45,
      bloomAmount: 0.75,
      vignetteStrength: 0.22,
    },
  },

  /** Void-Nuke: gleiche Grammatik, anderes Farbprofil. */
  voidNukeDetonation: {
    priority: POST_FX_PRIORITY.nuke,
    durationMs: 1500,
    ease: 'impulse',
    grade: {
      brightness: 0.14,
      contrast: 0.18,
      saturation: -0.18,
      tint: VOID_FIRE_COLOR,
      tintStrength: 0.5,
      bloomAmount: 0.75,
      vignetteStrength: 0.26,
    },
  },

  blackHoleSpawn: {
    priority: POST_FX_PRIORITY.blackHole,
    durationMs: 1300,
    ease: 'expo',
    grade: { saturation: -0.28, contrast: 0.12, tint: VOID_FIRE_COLOR, tintStrength: 0.34, vignetteStrength: 0.36 },
  },

  blackHoleCollapse: {
    priority: POST_FX_PRIORITY.blackHole,
    durationMs: 600,
    ease: 'impulse',
    grade: { brightness: 0.12, contrast: 0.16, bloomAmount: 0.3, vignetteStrength: -0.12 },
  },

  teleport: {
    priority: POST_FX_PRIORITY.teleport,
    durationMs: 420,
    ease: 'expo',
    grade: { saturation: -0.34, brightness: 0.09, contrast: 0.08 },
  },

  /** Eigener Tod: die Welt tritt zurück, damit die Auswertung im Vordergrund steht. */
  localDeath: {
    priority: POST_FX_PRIORITY.death,
    durationMs: 1500,
    ease: 'expo',
    grade: { saturation: -0.45, contrast: -0.1, vignetteStrength: 0.5 },
  },
};

export function getPostFxPreset(event: PostFxEvent): PostFxPulse {
  return PRESETS[event];
}

export function isPostFxEvent(value: string): value is PostFxEvent {
  return (POST_FX_EVENTS as readonly string[]).includes(value);
}
