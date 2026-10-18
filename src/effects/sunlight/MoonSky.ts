import { MOON_KEYFRAMES, MOON_TUNING } from '../../config/sunlight';
import { WORLD_MOONLIGHT_LIMITS, type WorldMoonlightConfig } from '../../config/nightWorld';
import { normalizeTimeOfDay } from '../TimeOfDay';
import { cloudShadowAt } from './SunFieldModel';
import type { SunCloudState } from './cloudShadow';

/** Authored per World: scales the island light and biases the night cloud cover. */
export type WorldMoonlight = WorldMoonlightConfig;
/** Activity override (Dawn blood moon). Only its openings reach the islands. */
export interface MoonOverride {
  readonly openings?: { readonly cover: number; readonly light: readonly number[] };
}
export interface MoonSkyState {
  /** False when no island adds light this frame. */
  active: boolean;
  cover: number;
  /** Light added in a full island, already faded and scaled by the World strength. */
  readonly light: [number, number, number];
  /** Directional moon relief on rocks, 0..1. */
  relief: number;
  /** Share of the light that belongs to the night itself; an Activity override keeps its own glow. */
  nightShare: number;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const smooth = (t: number): number => t * t * (3 - 2 * t);

export function createMoonSky(): MoonSkyState {
  return { active: false, cover: MOON_KEYFRAMES[0].cover, light: [0, 0, 0], relief: 0, nightShare: 1 };
}

/** Production moon without World or Activity input; continuous over midnight. */
export function resolveMoonBase(minutes: number, out: { weight: number; cover: number } = { weight: 0, cover: 0 }):
  { weight: number; cover: number } {
  const m = normalizeTimeOfDay(minutes), frames = MOON_KEYFRAMES;
  let a: typeof frames[number] = frames[frames.length - 1], b: typeof frames[number] = frames[0];
  for (let i = 0; i < frames.length - 1; i++) if (m >= frames[i].minute && m < frames[i + 1].minute) { a = frames[i]; b = frames[i + 1]; break; }
  const span = (b.minute - a.minute + 1440) % 1440 || 1440;
  const t = smooth(((m - a.minute + 1440) % 1440) / span);
  out.weight = a.weight + (b.weight - a.weight) * t;
  out.cover = a.cover + (b.cover - a.cover) * t;
  return out;
}

const base = { weight: 0, cover: 0 };
/**
 * The one moon of a displayed World: the production moon scaled by the World, then blended
 * towards an Activity override by its fade weight. Writes caller-owned storage.
 */
export function resolveMoonSky(minutes: number, world: WorldMoonlight | null | undefined,
  override: MoonOverride | null | undefined, overrideWeight: number, out: MoonSkyState): MoonSkyState {
  resolveMoonBase(minutes, base);
  const strength = clamp(world?.strength ?? 1, WORLD_MOONLIGHT_LIMITS.strength[0], WORLD_MOONLIGHT_LIMITS.strength[1]);
  const bias = clamp(world?.cover ?? 0, WORLD_MOONLIGHT_LIMITS.cover[0], WORLD_MOONLIGHT_LIMITS.cover[1]);
  const weight = base.weight * strength;
  const blend = override?.openings ? clamp(Number.isFinite(overrideWeight) ? overrideWeight : 0, 0, 1) : 0;
  const cover = clamp(base.cover + bias, .05, .95);
  out.cover = blend > 0 ? cover + (override!.openings!.cover - cover) * blend : cover;
  let lit = 0;
  for (let channel = 0; channel < 3; channel++) {
    const own = MOON_TUNING.light[channel] * weight;
    const value = blend > 0 ? own + (clamp(override!.openings!.light[channel], 0, 1) - own) * blend : own;
    out.light[channel] = value;
    lit = Math.max(lit, value);
  }
  out.active = lit > 1e-4;
  out.nightShare = 1 - blend;
  out.relief = MOON_TUNING.relief * Math.min(1, Math.max(base.weight * Math.min(1, strength), blend));
  return out;
}

/** Same opening-to-island transfer as the GPU layer, for canopies and verification. */
export function moonIslandAt(x: number, y: number, clouds: SunCloudState): number {
  const [low, high] = MOON_TUNING.islandEdge;
  const t = clamp((cloudShadowAt(x, y, clouds) - low) / (high - low), 0, 1);
  return smooth(t);
}

/** Moon direction from the continuous night shadow bearing, never jumping at midnight. */
export function writeMoonDirection(castAzimuthDegrees: number, out: number[]): number[] {
  const azimuth = (Number.isFinite(castAzimuthDegrees) ? castAzimuthDegrees : 270) * Math.PI / 180;
  const elevation = MOON_TUNING.elevationDegrees * Math.PI / 180;
  out[0] = Math.cos(azimuth) * Math.cos(elevation);
  out[1] = -Math.sin(azimuth) * Math.cos(elevation);
  out[2] = Math.sin(elevation);
  return out;
}
