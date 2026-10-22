import type { SpawnStructureOutlet } from '../../config/spawnStructure';

/**
 * Replicated read model of one spawn structure (GDD Spawnbauwerk V1). The renderer never decides
 * state; it projects World geometry, base HP/dormancy and the Activity's spawn announcements.
 */
export interface SpawnStructureView {
  readonly id: string;
  /** Brood nest centre: the shared pivot of the carcass and the nest asset. */
  readonly x: number;
  readonly y: number;
  readonly outlet: SpawnStructureOutlet;
  readonly hp: number;
  readonly maxHp: number;
  readonly dormant: boolean;
  readonly destroyed: boolean;
  /** Bound to a running Activity; without one the structure is World scenery. */
  readonly live: boolean;
  /** Changes when HP is re-baselined (Activity bound or reset), so feedback never replays. */
  readonly hpRevision: number;
  /** World centres of the body cells (the hitbox); stable per structure. */
  readonly wallCells: readonly { readonly x: number; readonly y: number }[];
}

export type SpawnPitState = 'sealed' | 'active';

/** The nest only lives while the structure can release enemies. A destroyed structure bursts and fades out. */
export function resolveSpawnPitState(view: SpawnStructureView): SpawnPitState {
  return view.live && !view.dormant && !view.destroyed ? 'active' : 'sealed';
}

export interface SpawnStructureGlow {
  /** The dark baked embers in the eye sockets. */
  readonly core: number;
  readonly pit: number;
  readonly lightRadiusPx: number;
  readonly lightIntensity: number;
}

/** The brood's resting heartbeat and the racing one of an announced release (ms per double beat). */
const HEART_REST_MS = 1700;
const HEART_RACE_MS = 620;

/** One double beat (lub-dub) 0..1 per period, at fixed rate so it never jumps in phase. */
function heartbeat(nowMs: number, periodMs: number, phase: number): number {
  const u = (((nowMs / periodMs + phase) % 1) + 1) % 1;
  const beat = (at: number, width: number) => Math.exp(-(((u - at) / width) ** 2));
  return Math.max(beat(0.08, 0.05), 0.62 * beat(0.27, 0.05));
}

/**
 * The brood's heartbeat 0..1: a slow double beat at rest that gives way to a racing one while a
 * release charges (`charge` 0..1). Both run at fixed rates and are blended, so the pulse never jumps.
 */
export function resolveSpawnStructureHeartbeat(view: SpawnStructureView, nowMs: number, charge: number): number {
  if (resolveSpawnPitState(view) === 'sealed') return 0;
  const c = Math.max(0, Math.min(1, charge)), phase = phaseOf(view.id) / (Math.PI * 2);
  return (1 - c) * heartbeat(nowMs, HEART_REST_MS, phase) + c * heartbeat(nowMs, HEART_RACE_MS, phase);
}

/**
 * Emissive strengths 0..1 before the day/night factor, for a standing structure. The pool glow and
 * the menacing nest light pulse with the brood's heartbeat; `charge` is the announced release (0..1):
 * the pool glows up and the light swells toward the moment enemies rise.
 */
export function resolveSpawnStructureGlow(view: SpawnStructureView, nowMs: number, charge: number): SpawnStructureGlow {
  if (resolveSpawnPitState(view) === 'sealed') {
    return { core: 0.25, pit: 0.12, lightRadiusPx: 150, lightIntensity: 0.16 };
  }
  const c = Math.max(0, Math.min(1, charge));
  const heart = resolveSpawnStructureHeartbeat(view, nowMs, c);
  return {
    core: Math.min(1, 0.55 + 0.15 * heart + 0.25 * c),
    pit: Math.min(1, 0.28 + 0.3 * heart + 0.45 * c),
    lightRadiusPx: 230 + 25 * heart + 80 * c,
    lightIntensity: 0.4 + 0.14 * heart + 0.46 * c,
  };
}

/** Each eye blinks shut for this long, once per blink period (offset per structure). */
const EYE_BLINK_MS = 190;
const EYE_BLINK_PERIOD_MS = 7300;

/**
 * Brightness 0..1 of the GPU-lit eyes over the dark baked sockets: a slow menacing breath, a restless
 * flicker, an occasional blink, and a flare toward an announced release. Sealed eyes only smoulder.
 */
export function resolveSpawnStructureEyes(view: SpawnStructureView, nowMs: number, charge: number): number {
  const phase = phaseOf(view.id);
  if (resolveSpawnPitState(view) === 'sealed') return 0.18 + 0.05 * Math.sin(nowMs * 0.0009 + phase);
  const c = Math.max(0, Math.min(1, charge));
  const breathe = 0.5 + 0.5 * Math.sin(nowMs * 0.0011 + phase);
  const flicker = 0.035 * Math.sin(nowMs * 0.031 + phase * 3) + 0.025 * Math.sin(nowMs * 0.047 + phase * 7);
  const sinceBlink = (nowMs + phase * 1000) % EYE_BLINK_PERIOD_MS;
  const blink = sinceBlink < EYE_BLINK_MS ? Math.sin(Math.PI * sinceBlink / EYE_BLINK_MS) : 0;
  const flare = c * (0.75 + 0.25 * Math.sin(nowMs * 0.02));
  return Math.max(0, Math.min(1, (0.5 + 0.14 * breathe + flicker + 0.5 * flare) * (1 - 0.85 * blink)));
}

/** The skeleton bursts at once; the eyes go out, then the nest and its creep stain fade away. */
export const SPAWN_STRUCTURE_EYES_OUT_MS = 450;
export const SPAWN_STRUCTURE_STAIN_FADE_DELAY_MS = 350;
export const SPAWN_STRUCTURE_STAIN_FADE_MS = 2400;

export interface SpawnStructureFade {
  /** The skeleton is drawn (it is replaced by the burst at the moment of destruction). */
  readonly body: boolean;
  /** Opacity of the nest, its creep stain and the pool glow. */
  readonly stain: number;
  /** Opacity of the eyes and the nest light. */
  readonly glow: number;
  /** Nothing is left to draw. */
  readonly done: boolean;
}

/** Fade of a destroyed structure, `burstAt` = moment of destruction; null = standing. */
export function resolveSpawnStructureFade(burstAt: number | null, nowMs: number): SpawnStructureFade {
  if (burstAt === null) return { body: true, stain: 1, glow: 1, done: false };
  const age = Math.max(0, nowMs - burstAt);
  const t = Math.min(1, Math.max(0, (age - SPAWN_STRUCTURE_STAIN_FADE_DELAY_MS) / SPAWN_STRUCTURE_STAIN_FADE_MS));
  const stain = 1 - t * t * (3 - 2 * t);
  const glow = Math.max(0, 1 - age / SPAWN_STRUCTURE_EYES_OUT_MS);
  return { body: false, stain, glow, done: stain <= 0 && glow <= 0 };
}

/** Stable per-structure phase, so neighbouring structures never breathe in lockstep. */
export function phaseOf(id: string): number {
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return ((hash >>> 0) % 6283) / 1000;
}

/** A body rising from the pit: claimed when it is created underground, released when it surfaces. */
export interface SpawnEmergence {
  readonly enemyId: string;
  /** Pit-local offset, world px. */
  readonly x: number;
  readonly y: number;
  readonly claimedAt: number;
  surfacedAt: number | null;
}

/** The ooze heaves over the hidden body for this long, then holds until it surfaces. */
export const SPAWN_EMERGENCE_SWELL_MS = 1100;
/** After surfacing the ooze parts, throws its droplets and closes again. */
export const SPAWN_EMERGENCE_PART_MS = 900;

/**
 * Shader phase of one emergence (BroodPitShader): 0..0.74 while the body is still underground,
 * 0.75..1 once it has surfaced; null when the opening has closed again.
 */
export function resolveSpawnEmergencePhase(emergence: SpawnEmergence, nowMs: number): number | null {
  if (emergence.surfacedAt === null) {
    return Math.min(0.74, Math.max(0, nowMs - emergence.claimedAt) / SPAWN_EMERGENCE_SWELL_MS * 0.74);
  }
  const parting = (nowMs - emergence.surfacedAt) / SPAWN_EMERGENCE_PART_MS;
  return parting >= 1 ? null : 0.75 + Math.max(0, parting) * 0.25;
}
