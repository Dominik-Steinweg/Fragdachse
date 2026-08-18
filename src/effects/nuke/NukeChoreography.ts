/**
 * Mehrphasige Bildregie der Nuke. Ohne Phaser-Import, damit Phasengrenzen, Abklingen und die
 * Rückkehr auf Normalwerte prüfbar sind.
 *
 * Der Auftrag lautete ausdrücklich: **keine weitere Ring- oder Partikelschicht**, sondern eine
 * komponierte Ereignissequenz. Die vorhandenen Effekte – Telegraphringe, Bildschirmblitz,
 * Explosionskern, Schockwellen, Plume, Fallout – laufen weiter; diese Klasse steuert sie und
 * ergänzt Kamera, Bildkomposition und lokale Verzerrung.
 *
 * Beide Varianten teilen Timing und Grammatik und unterscheiden sich nur im Farbprofil.
 */

import type { DistortionSourceState } from '../distortion/distortionFramePlanner';
import { DISTORTION_PRIORITY } from '../distortion/distortionFramePlanner';
import type { PostFxPulse } from '../postfx/PostFxComposer';
import { getPostFxPreset } from '../postfx/postFxPresets';
import type { CameraFeedbackRequest } from '../camera/CameraFeedbackModel';
import { getExplosionLightDurationMs } from '../LightingConfig';

export type NukePhase = 'idle' | 'countdown' | 'detonation' | 'pressureWave' | 'afterglow';
export type NukeVariant = 'normal' | 'void';

export interface NukeVariantProfile {
  readonly variant: NukeVariant;
  readonly tint: number;
  /** Farbe der Nachglühphase. */
  readonly afterglowTint: number;
}

export interface NukeChoreographyFrame {
  readonly phase: NukePhase;
  /** 0..1 innerhalb der aktuellen Phase. */
  readonly phaseProgress: number;
  readonly cameraRequests: readonly CameraFeedbackRequest[];
  readonly cameraReleases: readonly string[];
  readonly postFxPulses: readonly PostFxPulse[];
  readonly distortion: DistortionSourceState | null;
  /** Treibt das **vorhandene** Vollbild-Blitzrechteck statt eines zweiten Effekts. */
  readonly skyFlashAlpha: number;
  /**
   * Hebt Alpha und Emission der Telegraphringe an.
   *
   * Zwingend, kein Beiwerk: ein kameraweiter `ColorMatrix` entsättigt die Warnringe **mit**.
   * Eine Entsättigung allein verschlechterte den Kontrast zwischen Warnzone und sicherem
   * Bereich also, statt ihn zu erhöhen. Der Boost muss den Grading-Effekt überwiegen.
   */
  readonly telegraphBoost: number;
}

/** Dauer der Detonations- und Druckwellenphase. Der Countdown kommt von außen. */
export const NUKE_DETONATION_MS = 320;
export const NUKE_PRESSURE_WAVE_MS = 420;
/** Referenzwert für bestehende Aufrufer; konkrete Sequenzen skalieren mit ihrem Radius. */
export const NUKE_AFTERGLOW_MS = getExplosionLightDurationMs(300) - NUKE_DETONATION_MS - NUKE_PRESSURE_WAVE_MS;

/** Ab hier läuft die letzte Countdownphase mit Rumpeln, Entsättigung und Telegraph-Boost. */
export const NUKE_COUNTDOWN_TENSION_START = 0.72;

const NUKE_WARM_TINT = 0xffb066;
const NUKE_AFTERGLOW_WARM = 0xff8a4a;
const VOID_TINT = 0xb347ff;
const VOID_AFTERGLOW = 0x8a3cd6;

export const NUKE_VARIANT_PROFILES: Readonly<Record<NukeVariant, NukeVariantProfile>> = {
  normal: { variant: 'normal', tint: NUKE_WARM_TINT, afterglowTint: NUKE_AFTERGLOW_WARM },
  void: { variant: 'void', tint: VOID_TINT, afterglowTint: VOID_AFTERGLOW },
};

const EMPTY_FRAME: NukeChoreographyFrame = {
  phase: 'idle',
  phaseProgress: 0,
  cameraRequests: [],
  cameraReleases: [],
  postFxPulses: [],
  distortion: null,
  skyFlashAlpha: 0,
  telegraphBoost: 0,
};

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Phase A – letzte Countdownphase.
 *
 * Liefert das anschwellende Rumpeln und den Telegraph-Boost. Wird vom `NukeRenderer` pro Frame
 * aus dem laufenden Countdown gespeist; die Kameraquelle trägt eine stabile `id` und wird
 * dadurch aktualisiert statt neu gestartet.
 */
export function resolveNukeCountdownFrame(
  nukeId: number,
  countdownProgress: number,
  x: number,
  y: number,
): NukeChoreographyFrame {
  if (countdownProgress < NUKE_COUNTDOWN_TENSION_START) return EMPTY_FRAME;
  const t = clamp01(
    (countdownProgress - NUKE_COUNTDOWN_TENSION_START) / (1 - NUKE_COUNTDOWN_TENSION_START),
  );

  return {
    phase: 'countdown',
    phaseProgress: t,
    cameraRequests: [{
      id: `nuke:${nukeId}`,
      channel: 'rumble',
      amplitudePx: 2.3 + t * 5.6,
      durationMs: 400,
      priority: 85,
      decay: 'linear',
      sourceX: x,
      sourceY: y,
    }],
    cameraReleases: [],
    postFxPulses: [{
      id: `nukeTension:${nukeId}`,
      priority: 95,
      durationMs: 400,
      ease: 'linear',
      grade: {
        saturation: -0.1 * t,
        contrast: 0.08 * t,
        vignetteStrength: 0.1 * t,
      },
    }],
    distortion: null,
    skyFlashAlpha: 0,
    // Wächst schneller als die Entsättigung, damit die Warnzone im Verlauf **deutlicher** wird.
    telegraphBoost: t,
  };
}

/**
 * Phasen B–D. Wird bei der Detonation erzeugt und pro Frame fortgeschrieben.
 */
export class NukeChoreography {
  private elapsedMs = 0;
  private readonly afterglowMs: number;
  private readonly totalMs: number;

  constructor(
    private readonly profile: NukeVariantProfile,
    private readonly nukeId: number,
    private readonly x: number,
    private readonly y: number,
    private readonly radiusPx: number,
  ) {
    // Die Farbphase endet gemeinsam mit dem radiusabhängigen Explosionslicht. Detonation und
    // Druckwelle behalten ihr authored Timing; nur das atmosphärische Nachglühen streckt sich.
    this.afterglowMs = Math.max(
      0,
      getExplosionLightDurationMs(radiusPx) - NUKE_DETONATION_MS - NUKE_PRESSURE_WAVE_MS,
    );
    this.totalMs = NUKE_DETONATION_MS + NUKE_PRESSURE_WAVE_MS + this.afterglowMs;
  }

  isFinished(): boolean {
    return this.elapsedMs >= this.totalMs;
  }

  /** Erster Frame der Detonation: hier entstehen die einmaligen Anforderungen. */
  start(): NukeChoreographyFrame {
    return this.buildFrame(0, true);
  }

  step(deltaMs: number): NukeChoreographyFrame {
    this.elapsedMs += deltaMs;
    return this.buildFrame(this.elapsedMs, false);
  }

  private buildFrame(elapsedMs: number, isStart: boolean): NukeChoreographyFrame {
    if (elapsedMs >= this.totalMs) {
      return { ...EMPTY_FRAME, cameraReleases: [`nuke:${this.nukeId}`] };
    }

    // Phase B – Detonation: Belichtungsstoß, Bloom-Spitze, harter Kameraeinschlag.
    if (elapsedMs < NUKE_DETONATION_MS) {
      const t = elapsedMs / NUKE_DETONATION_MS;
      return {
        phase: 'detonation',
        phaseProgress: t,
        // Der Einschlag wird genau einmal angefordert – er ist ein Ereignis, kein Zustand.
        cameraRequests: isStart ? [{
          channel: 'impact',
          amplitudePx: 38,
          durationMs: 550,
          priority: 100,
          decay: 'impulse',
          sourceX: this.x,
          sourceY: this.y,
        }, {
          channel: 'zoom',
          amplitudePx: 0,
          zoomDelta: 0.008,
          durationMs: 420,
          priority: 100,
          decay: 'impulse',
        }] : [],
        cameraReleases: isStart ? [`nuke:${this.nukeId}`] : [],
        // Einzige Quelle für das Farbprofil der Detonation bleibt die Preset-Liste – sonst
        // stünden zwei Wahrheiten nebeneinander und drifteten auseinander.
        postFxPulses: isStart ? [{
          ...getPostFxPreset(this.profile.variant === 'void' ? 'voidNukeDetonation' : 'nukeDetonation'),
          id: `nukeBlast:${this.nukeId}`,
        }] : [],
        distortion: null,
        // Steiler Anstieg, dann Abfall: der Blitz ist das hellste Bild der Sequenz.
        skyFlashAlpha: t < 0.12 ? t / 0.12 : 1 - (t - 0.12) / 0.88,
        telegraphBoost: 0,
      };
    }

    // Phase C – Druckwelle: ein nach außen laufender Verzerrungsring plus kurze Barrel-Stauchung.
    const pressureElapsed = elapsedMs - NUKE_DETONATION_MS;
    if (pressureElapsed < NUKE_PRESSURE_WAVE_MS) {
      const t = pressureElapsed / NUKE_PRESSURE_WAVE_MS;
      return {
        phase: 'pressureWave',
        phaseProgress: t,
        cameraRequests: [],
        cameraReleases: [],
        postFxPulses: t < 0.05 ? [{
          id: `nukeWave:${this.nukeId}`,
          priority: 100,
          durationMs: 220,
          ease: 'impulse',
          barrel: 1.06,
        }] : [],
        distortion: {
          id: `nuke:${this.nukeId}`,
          profile: 'ring',
          worldX: this.x,
          worldY: this.y,
          // Der Ring läuft über den Feldradius hinaus nach außen aus.
          radiusPx: this.radiusPx * (0.5 + t * 1.7),
          strength: Math.sin(Math.PI * t),
          priority: DISTORTION_PRIORITY.nuke,
        },
        skyFlashAlpha: 0,
        telegraphBoost: 0,
      };
    }

    // Phase D – Nachglühen: Farbphase klingt ab, Rauch und Fallout übernehmen.
    const afterglowElapsed = pressureElapsed - NUKE_PRESSURE_WAVE_MS;
    const t = afterglowElapsed / this.afterglowMs;
    return {
      phase: 'afterglow',
      phaseProgress: t,
      cameraRequests: [],
      cameraReleases: [],
      postFxPulses: t < 0.02 ? [{
        id: `nukeAfterglow:${this.nukeId}`,
        priority: 92,
        durationMs: this.afterglowMs,
        ease: 'atmospheric',
        grade: {
          tint: this.profile.afterglowTint,
          tintStrength: 0.3,
          saturation: -0.08,
          contrast: 0.06,
        },
      }] : [],
      distortion: null,
      skyFlashAlpha: 0,
      telegraphBoost: 0,
    };
  }
}

export function resolveNukeVariantProfile(visualStyle: string): NukeVariantProfile {
  return visualStyle === 'void_nuke' ? NUKE_VARIANT_PROFILES.void : NUKE_VARIANT_PROFILES.normal;
}
