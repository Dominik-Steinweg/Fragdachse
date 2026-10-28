import { ALLIED_PALETTE, VOID_PALETTE } from '../config';
import type { EnemyHeatBurstPhase } from '../systems/EnemyHeatBurstState';

/**
 * Pure colour and intensity model of a heat-burst body's glow (emission overlay, halo, light).
 * Charging ember red brightens and tips into void violet shortly before full heat; a full body
 * shimmers violet, its warning throbs fast, the burst flashes and cools down to dormant embers.
 * Red belongs to the heat and the sparks, void violet to the coming burst; no yellow, no white core.
 */

/** Red sparks of the burst: the telegraph red family, never orange or yellow. */
export const DEMON_HEAT_SPARK_COLOR = 0xff3a22;

const DORMANT_EMBER = 0x5a0c06;
const EMBER_RED = 0xc4200e;
const HOT_RED = 0xff3a22;
/** Heat at which the glow starts to tip from red into void violet. */
const VIOLET_TIP_HEAT = 0.8;
const HOLD_SHIMMER_MS = 600;
const WARNING_THROB_MS = 125;
const VENT_FLASH_MS = 260;
const BREATH_MS = 1400;

export interface EnemyHeatGlow {
  /** 0xRRGGBB tint of the emission overlay and light. */
  color: number;
  /** Overlay strength in [0, 1] before the emissive day/night damping. */
  alpha: number;
  /** Strength of the ground light in [0, 1]; 0 = no light. */
  light: number;
}

/**
 * Glow at `now` for a body in `phase` with charge `heat` in [0, 1]. `ventFromAt` is the last burst,
 * `phaseOffset` desynchronises the pulse of neighbours (ms, from the body id).
 */
export function enemyHeatGlowAt(out: EnemyHeatGlow, phase: EnemyHeatBurstPhase, heat: number, now: number,
  ventFromAt: number, allied: boolean, phaseOffset = 0): EnemyHeatGlow {
  const palette = allied ? ALLIED_PALETTE : VOID_PALETTE;
  const dormant = allied ? ALLIED_PALETTE.shadow : DORMANT_EMBER;
  const t = now + phaseOffset;
  switch (phase) {
    case 'vent': {
      // The burst flashes in violet and fades to dormant embers.
      const since = now - ventFromAt, flash = ventFromAt > 0 && since >= 0 ? Math.max(0, 1 - since / VENT_FLASH_MS) : 0;
      out.color = mixColor(dormant, palette.bright, flash);
      out.alpha = 0.18 + 0.7 * flash;
      out.light = flash * 0.8;
      return out;
    }
    case 'charge': {
      const breath = 0.5 - 0.5 * Math.cos(2 * Math.PI * t / BREATH_MS);
      const red = allied ? mixColor(ALLIED_PALETTE.deep, ALLIED_PALETTE.primary, heat)
        : heat < 0.5 ? mixColor(DORMANT_EMBER, EMBER_RED, heat * 2) : mixColor(EMBER_RED, HOT_RED, (heat - 0.5) * 2);
      const tip = Math.max(0, (heat - VIOLET_TIP_HEAT) / (1 - VIOLET_TIP_HEAT));
      out.color = mixColor(red, palette.bright, smooth(tip));
      out.alpha = Math.min(1, 0.18 + 0.72 * heat + 0.08 * breath * heat);
      out.light = heat < 0.45 ? 0 : (heat - 0.45) / 0.55 * 0.7;
      return out;
    }
    case 'hold': {
      const shimmer = 0.5 - 0.5 * Math.cos(2 * Math.PI * t / HOLD_SHIMMER_MS);
      out.color = mixColor(palette.primary, palette.bright, shimmer);
      out.alpha = 0.86 + 0.14 * shimmer;
      out.light = 0.7 + 0.15 * shimmer;
      return out;
    }
    case 'telegraph': {
      const throb = 0.5 - 0.5 * Math.cos(2 * Math.PI * t / WARNING_THROB_MS);
      out.color = mixColor(palette.bright, allied ? ALLIED_PALETTE.core : 0xeec4ff, throb);
      out.alpha = 0.8 + 0.2 * throb;
      out.light = 0.75 + 0.25 * throb;
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
