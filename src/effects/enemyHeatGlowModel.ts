import { ALLIED_PALETTE, VOID_PALETTE } from '../config';
import type { EnemyHeatBurstPhase } from '../systems/EnemyHeatBurstState';

/**
 * Pure colour and intensity model of a heat-burst body's glow (emission overlay, halo, light).
 * The glow climbs in discrete stages, one per spat salvo: dormant embers, ember red, red, hot red,
 * red with void-violet edges, and violet at the last stage. Every step flares the glow up for a
 * moment, so the jump reads as an event. The meltdown warning throbs bright and ever faster up to the
 * burst (a countdown). Red belongs to the heat and the sparks, void violet to the coming burst; no
 * yellow, no white core.
 */

/** Red sparks of the burst: the telegraph red family, never orange or yellow. */
export const DEMON_HEAT_SPARK_COLOR = 0xf01f2c;

const DORMANT_EMBER = 0x5a0c06;
const EMBER_RED = 0xc4200e;
const RED = 0xe62a16;
const HOT_RED = 0xff3a22;
/** A step flares up for this long after its salvo. */
export const HEAT_STEP_FLARE_MS = 320;
/** Throb period without a known warning length. */
const WARNING_THROB_MS = 125;
/** The warning throb speeds up from this period at its start to this one at the burst. */
const WARNING_THROB_START_MS = 300;
const WARNING_THROB_END_MS = 80;
const BREATH_MS = 1400;

export interface EnemyHeatGlow {
  /** 0xRRGGBB tint of the emission overlay and light. */
  color: number;
  /** Overlay strength in [0, 1] before the emissive day/night damping. */
  alpha: number;
  /** Strength of the ground light in [0, 1]; 0 = no light. */
  light: number;
  /** Flare of the last step in [0, 1] (1 at the salvo, 0 after the flare). */
  flare: number;
}

/** Colour, overlay strength and light of one heat share (stage / stages). */
const STEP_LEVELS: readonly { share: number; color: number; violet: number; alpha: number; light: number }[] = [
  { share: 0, color: DORMANT_EMBER, violet: 0, alpha: 0.16, light: 0 },
  { share: 0.2, color: EMBER_RED, violet: 0, alpha: 0.5, light: 0.12 },
  { share: 0.4, color: RED, violet: 0, alpha: 0.64, light: 0.3 },
  { share: 0.6, color: HOT_RED, violet: 0, alpha: 0.78, light: 0.45 },
  { share: 0.8, color: HOT_RED, violet: 0.35, alpha: 0.9, light: 0.58 },
  { share: 1, color: HOT_RED, violet: 1, alpha: 1, light: 0.75 },
];

/** Discrete level of a heat share: the highest authored step at or below it. */
function stepLevel(share: number): (typeof STEP_LEVELS)[number] {
  let level = STEP_LEVELS[0]!;
  for (const candidate of STEP_LEVELS) if (share + 1e-6 >= candidate.share) level = candidate;
  return level;
}

/** Flare of a step `sinceStepMs` ago: a quick rise and an eased fall. */
export function heatStepFlare(sinceStepMs: number): number {
  if (!(sinceStepMs >= 0) || sinceStepMs >= HEAT_STEP_FLARE_MS) return 0;
  const t = sinceStepMs / HEAT_STEP_FLARE_MS;
  return t < 0.12 ? t / 0.12 : (1 - t) * (1 - t) / (0.88 * 0.88);
}

/**
 * Glow at `now` for a body in `phase` with `stage` of `stages`. `stageAt` is the last step (its
 * flare), `phaseOffset` desynchronises the breath of neighbours (ms, from the body id).
 * `warningElapsedMs` of `warningMs` time the countdown throb of the warning.
 */
export function enemyHeatGlowAt(out: EnemyHeatGlow, phase: EnemyHeatBurstPhase, stage: number, stages: number, now: number,
  stageAt: number, allied: boolean, phaseOffset = 0, warningElapsedMs = 0, warningMs = 0): EnemyHeatGlow {
  const palette = allied ? ALLIED_PALETTE : VOID_PALETTE;
  const t = now + phaseOffset;
  switch (phase) {
    case 'heat': {
      const share = stages > 0 ? Math.max(0, Math.min(1, stage / stages)) : 0;
      const level = stepLevel(share);
      const base = allied ? mixColor(ALLIED_PALETTE.shadow, ALLIED_PALETTE.primary, share) : level.color;
      const flare = stage > 0 ? heatStepFlare(now - stageAt) : 0;
      const breath = 0.5 - 0.5 * Math.cos(2 * Math.PI * t / BREATH_MS);
      const color = mixColor(base, allied ? palette.bright : palette.primary, smooth(level.violet));
      out.color = mixColor(color, palette.bright, 0.55 * flare);
      out.alpha = Math.min(1, level.alpha + 0.06 * breath * share + 0.4 * flare);
      out.light = Math.min(1, level.light + 0.55 * flare);
      out.flare = flare;
      return out;
    }
    case 'telegraph': {
      // A countdown: the body throbs bright and ever faster (a linear chirp) until it bursts.
      const progress = warningMs > 0 ? Math.max(0, Math.min(1, warningElapsedMs / warningMs)) : 0;
      const cycles = warningMs > 0
        ? warningElapsedMs / WARNING_THROB_START_MS
          + (1 / WARNING_THROB_END_MS - 1 / WARNING_THROB_START_MS) * warningElapsedMs * warningElapsedMs / (2 * warningMs)
        : t / WARNING_THROB_MS;
      const throb = 0.5 - 0.5 * Math.cos(2 * Math.PI * cycles);
      out.color = mixColor(palette.primary, palette.bright, throb);
      out.alpha = 0.7 + 0.3 * throb;
      out.light = (0.25 + 0.45 * throb) * (0.6 + 0.4 * progress);
      out.flare = 0;
      return out;
    }
    case 'burst': {
      // The body is gone with the burst; until its removal arrives it shows nothing of its own.
      out.color = palette.bright;
      out.alpha = 0;
      out.light = 0;
      out.flare = 0;
      return out;
    }
  }
}

function smooth(value: number): number {
  const v = Math.max(0, Math.min(1, value));
  return v * v * (3 - 2 * v);
}

/** Phaser-free twin of `mixColors` (EffectUtils), so the model stays a pure module. */
function mixColor(from: number, to: number, amount: number): number {
  const a = Math.max(0, Math.min(1, amount));
  const r = Math.round(((from >> 16) & 0xff) + ((((to >> 16) & 0xff) - ((from >> 16) & 0xff)) * a));
  const g = Math.round(((from >> 8) & 0xff) + ((((to >> 8) & 0xff) - ((from >> 8) & 0xff)) * a));
  const b = Math.round((from & 0xff) + (((to & 0xff) - (from & 0xff)) * a));
  return (r << 16) | (g << 8) | b;
}
