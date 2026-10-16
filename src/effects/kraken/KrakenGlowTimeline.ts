import { KRAKEN_BOSS_DEFAULTS, type KrakenBossConfig } from '../../config/krakenBoss';
import { krakenExitRoarAt } from '../../systems/CoopDefenseKrakenMotion';
import type { EnemyAreaClawAttack } from '../../systems/EnemyClawAttack';
import type { KrakenEggState, KrakenState, KrakenTentacleState } from '../../systems/KrakenState';
import { KRAKEN_BROOD, krakenBroodGlow } from './submersionShader';

/**
 * How brightly the kraken's eyes, suckers and brood glow, as pure functions of the replicated host anchors
 * and the synchronized clock: host, clients and late joiners sample the same light at the same moment.
 * Values are drive multipliers (1 = authored rest glow); the renderers own colours and sizes.
 * A hidden kraken never glows: light must not reveal where it lurks under the water.
 */
export const KRAKEN_GLOW = {
  eye: {
    /** Ignition when the eyes open: overshoot, then settle to rest. */
    igniteRiseMs: 180, igniteSettleMs: 650, igniteOvershoot: 1.8,
    roarPeak: 2.4, roarWidthMs: 380,
    breathHz: .31, breathDepth: .12,
    inkPeak: 2, inkDipMs: 420,
    /** After the ashore roar the eyes keep burning hotter on land. */
    landRest: 1.3, ashorePeak: 2.6, ashoreWidthMs: 520,
    diveFadeMs: 420,
    /** Ember rising from the deep before a surfacing body opens its eyes. */
    deepLeadMs: 900,
  },
  sucker: {
    waterRest: .12, landRest: .25,
    riseLevel: .3, telegraphFrom: .35, telegraphTo: 1, hitFlash: 1.6, hitDecayMs: 500,
    restHz: .35, telegraphHz: 2.8,
    roarBurst: 1, roarWidthMs: 600,
  },
  egg: { hatchFlashMs: 450 },
} as const;

const clamp = (n: number): number => Math.max(0, Math.min(1, n));
const smooth = (n: number): number => { const t = clamp(n); return t * t * (3 - 2 * t); };
const gauss = (now: number, at: number, widthMs: number): number => Math.exp(-(((now - at) / widthMs) ** 2));

/** 0 before `at`, overshoots to `overshoot` after `riseMs`, settles to 1 by `settleMs`. */
export function krakenIgnite(now: number, at: number, overshoot: number = KRAKEN_GLOW.eye.igniteOvershoot,
  riseMs: number = KRAKEN_GLOW.eye.igniteRiseMs, settleMs: number = KRAKEN_GLOW.eye.igniteSettleMs): number {
  const t = now - at;
  if (t < 0) return 0;
  if (t < riseMs) return overshoot * smooth(t / riseMs);
  return 1 + (overshoot - 1) * (1 - smooth((t - riseMs) / Math.max(1, settleMs - riseMs)));
}
/** Slow uneasy breathing around 1. */
export function krakenBreath(now: number, hz: number = KRAKEN_GLOW.eye.breathHz, depth: number = KRAKEN_GLOW.eye.breathDepth): number {
  return 1 + depth * Math.sin(now / 1000 * hz * Math.PI * 2);
}

/** The intro view's eyes: dark until they open, ignite, flare with the roar and keep breathing. */
export function krakenIntroEyeDrive(timing: { readonly eyesAt: number; readonly roarAt: number }, now: number): number {
  const e = KRAKEN_GLOW.eye;
  const ignite = krakenIgnite(now, timing.eyesAt);
  if (ignite <= 0) return 0;
  return Math.max(ignite, e.roarPeak * gauss(now, timing.roarAt, e.roarWidthMs)) * (now >= timing.eyesAt + e.igniteSettleMs ? krakenBreath(now) : 1);
}

/** Eye drive of the fight body. The atlas still decides whether the eyes are open in the shown frame. */
export function krakenEyeDrive(state: KrakenState, now: number, config: KrakenBossConfig = KRAKEN_BOSS_DEFAULTS): number {
  const e = KRAKEN_GLOW.eye, p = state.phase;
  switch (p.kind) {
    case 'waiting': case 'submerged': case 'removed': return 0;
    case 'diving': return now >= p.submergedAt ? 0 : 1 - smooth((now - p.startedAt) / e.diveFadeMs);
    case 'surfacing': return krakenIgnite(now, p.vulnerableAt) * (now >= p.vulnerableAt + e.igniteSettleMs ? krakenBreath(now) : 1);
    case 'dying': {
      if (p.submerged) return 0;
      // The eyes stutter and go out over the first part of the death; the atlas closes them anyway.
      const u = clamp((now - p.startedAt) / Math.min(1400, p.endsAt - p.startedAt));
      const flicker = .55 + .45 * Math.sin(now * .047) * Math.sin(now * .013 + 1.7);
      return (1 - smooth(u)) * (u < .15 ? 1 : flicker);
    }
    case 'ashore': {
      const roar = krakenExitRoarAt(p, config.exit);
      const rest = 1 + (e.landRest - 1) * smooth((now - roar) / 800);
      return Math.max(rest * krakenBreath(now), e.ashorePeak * gauss(now, roar, e.ashoreWidthMs));
    }
    default: {
      const rest = (p.kind === 'land' ? e.landRest : 1) * krakenBreath(now);
      const action = state.bodyAction;
      if (action?.kind === 'ink') {
        // The eyes heat up through the charge, then dim for a moment after the spit.
        if (now < action.spitAt) return rest + Math.max(0, e.inkPeak - rest) * smooth((now - action.chargeAt) / Math.max(1, action.spitAt - action.chargeAt));
        return rest * (1 - .35 * Math.exp(-(now - action.spitAt) / e.inkDipMs));
      }
      return rest;
    }
  }
}

/** Ember glimpsed through the water just before a surfacing body opens its eyes (0..1). */
export function krakenDeepEmber(state: KrakenState, now: number): number {
  const p = state.phase;
  if (p.kind !== 'surfacing') return 0;
  const lead = KRAKEN_GLOW.eye.deepLeadMs, from = Math.max(p.startedAt, p.vulnerableAt - lead);
  return smooth((now - from) / Math.max(1, p.vulnerableAt - from)) * (1 - smooth((now - p.vulnerableAt) / 300));
}

export interface KrakenSuckerDrive {
  /** Overall brightness of the cups. */
  readonly level: number;
  /** Travelling wave along the arm: cycles per second and direction (1 root → tip, -1 tip → root). */
  readonly hz: number; readonly direction: 1 | -1;
}
const DARK: KrakenSuckerDrive = { level: 0, hz: 0, direction: 1 };

/** Strike tentacle cups: they wake as the arm rises, race towards the tip through the telegraph,
 * flash on impact and run back down as the arm sinks. `previous` is the last strike seen on this arm. */
export function krakenTentacleSuckers(t: KrakenTentacleState, now: number, previous: EnemyAreaClawAttack | null = null): KrakenSuckerDrive {
  const s = KRAKEN_GLOW.sucker;
  if (now < t.startedAt || now >= t.endsAt) return DARK;
  if (now >= t.retractAt) {
    const u = clamp((now - t.retractAt) / Math.max(1, t.endsAt - t.retractAt));
    return { level: s.riseLevel * (1 - smooth(u)), hz: s.restHz * 2, direction: -1 };
  }
  const attack = t.claw.attack ?? previous;
  if (attack && now >= attack.startedAt && now < attack.endsAt + s.hitDecayMs) {
    if (now >= attack.hitAt) {
      const decay = Math.exp(-(now - attack.hitAt) / (s.hitDecayMs * .45));
      return { level: s.riseLevel + (s.hitFlash - s.riseLevel) * decay, hz: s.telegraphHz, direction: 1 };
    }
    const u = smooth((now - attack.startedAt) / Math.max(1, attack.strikeAt - attack.startedAt));
    return { level: s.telegraphFrom + (s.telegraphTo - s.telegraphFrom) * u, hz: s.restHz + (s.telegraphHz - s.restHz) * u, direction: 1 };
  }
  return { level: s.riseLevel * smooth((now - t.startedAt) / Math.max(1, t.hoverAt - t.startedAt)), hz: s.restHz, direction: 1 };
}

/** The body's own cups (arm edges, curled tips): a faint rest shimmer, a burst on the ashore roar. */
export function krakenBodySuckers(state: KrakenState, now: number, config: KrakenBossConfig = KRAKEN_BOSS_DEFAULTS): KrakenSuckerDrive {
  const s = KRAKEN_GLOW.sucker, p = state.phase, eye = krakenEyeDrive(state, now, config);
  if (eye <= 0) return DARK;
  const land = p.kind === 'land' || p.kind === 'ashore' || (p.kind === 'dying' && p.asset === 'land');
  const roar = p.kind === 'ashore' ? s.roarBurst * gauss(now, krakenExitRoarAt(p, config.exit), s.roarWidthMs) : 0;
  return { level: Math.min(1, eye) * (land ? s.landRest : s.waterRest) + roar, hz: s.restHz, direction: 1 };
}

/** Brightness of one cup at position `along` (0 root .. 1 tip) under a drive. */
export function krakenSuckerWave(along: number, seconds: number, drive: KrakenSuckerDrive): number {
  if (drive.level <= 0) return 0;
  const phase = seconds * drive.hz - along * 1.6 * drive.direction;
  return drive.level * (.55 + .45 * (.5 + .5 * Math.sin(phase * Math.PI * 2)));
}

export interface KrakenEggGlow {
  /** Ember strength for the material and the companion (KRAKEN_BROOD units). */
  readonly glow: number;
  /** Shell swelling (scale offset) and the heartbeat in [-1, 1]. */
  readonly pulse: number; readonly beat: number;
  /** Bright flash while the shell splits (0..1). */
  readonly hatchFlash: number;
}
/** A landed egg throbs harder and faster as it incubates, flares while it splits and dies with the spawn. */
export function krakenEggGlowState(egg: KrakenEggState, now: number): KrakenEggGlow {
  const landingAge = (now - egg.landedAt) / 1000, hatchAge = (now - egg.hatchStartedAt) / 1000;
  const incubation = clamp((now - egg.landedAt) / (egg.hatchStartedAt - egg.landedAt));
  const beat = Math.sin(landingAge * (5 + incubation * 7));
  const pulse = hatchAge < 0 ? beat * KRAKEN_BROOD.pulse * incubation : 0;
  const glow = hatchAge < 0 ? krakenBroodGlow(beat, incubation) : now < egg.spawnAt
    ? KRAKEN_BROOD.incubatedGlow + (KRAKEN_BROOD.hatchGlow - KRAKEN_BROOD.incubatedGlow) * clamp((now - egg.hatchStartedAt) / Math.max(1, egg.spawnAt - egg.hatchStartedAt))
    : KRAKEN_BROOD.hatchGlow * (1 - clamp((now - egg.spawnAt) / 250));
  const hatchFlash = hatchAge < 0 ? 0 : Math.sin(Math.PI * clamp((now - egg.hatchStartedAt) / KRAKEN_GLOW.egg.hatchFlashMs));
  return { glow, pulse, beat, hatchFlash };
}
