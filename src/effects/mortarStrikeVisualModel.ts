import type { SyncedMortarStrike } from '../types';

export const MORTAR_THUMP_JOIN_WINDOW_MS = 150;
/** A windup that vanished before launch (shooter killed or stopped) breaks up for this long. */
export const MORTAR_CANCEL_PRESENTATION_MS = 700;
const clamp = (v: number) => Math.max(0, Math.min(1, v));

/** Host timestamps only. No accumulated animation clock, prediction or gameplay authority. */
export function mortarStrikePhase(strike: SyncedMortarStrike, nowMs: number) {
  const windup = clamp((nowMs - strike.armedAt) / Math.max(1, strike.launchAt - strike.armedAt));
  const flight = clamp((nowMs - strike.launchAt) / Math.max(1, strike.impactAt - strike.launchAt));
  const phase = nowMs < strike.armedAt ? 'pending' : nowMs < strike.launchAt ? 'windup'
    : nowMs < strike.impactAt ? 'flight' : 'finished';
  // Integrating the frequency ramp keeps the pulse continuous as charging accelerates.
  const pulse = 0.5 + 0.5 * Math.sin(Math.PI * 2 * (windup * 2 + windup ** 3 * 2));
  return { phase, windup, flight, pulse, launchAgeMs: nowMs - strike.launchAt } as const;
}

/** World angle from the announced aim point toward the shooter; the telegraph shows where fire comes from. */
export function mortarFireDirection(strike: SyncedMortarStrike): number {
  return Math.atan2(strike.sourceY - strike.targetY, strike.sourceX - strike.targetX);
}

interface Observation {
  windup: boolean; handled: boolean; cancelled: boolean; launched: boolean; impactAt: number;
  /** Last replicated state, kept so a cancelled windup can break up where it was. */
  strike: SyncedMortarStrike; reached: number; cancelledAt: number;
}
export interface MortarCancelSample {
  readonly strike: SyncedMortarStrike;
  /** 0..1 over MORTAR_CANCEL_PRESENTATION_MS. */
  readonly cancel: number;
  /** Windup progress the strike had reached when it vanished. */
  readonly reached: number;
  /** True only for the first sample after the cancel, for one-shot feedback. */
  readonly started: boolean;
}

/** Tombstones survive a missing snapshot until impact, so repeats cannot replay a launch.
 * World clear resets the ID domain; expired snapshots never emit. */
export class MortarStrikePresentationTimeline {
  private readonly observations = new Map<number, Observation>();
  private cancels: MortarCancelSample[] = [];

  /** Cancelled windups of the last sample(), still breaking up. */
  get cancelled(): readonly MortarCancelSample[] { return this.cancels; }

  sample(strikes: readonly SyncedMortarStrike[], nowMs: number) {
    const present = new Set(strikes.map(strike => strike.id));
    this.cancels = [];
    for (const [id, previous] of this.observations) {
      if (!present.has(id) && previous.windup && !previous.handled && !previous.cancelled) {
        previous.cancelled = true; previous.cancelledAt = nowMs;
      }
      if (previous.cancelled) {
        const age = nowMs - previous.cancelledAt;
        if (age < MORTAR_CANCEL_PRESENTATION_MS) {
          this.cancels.push({ strike: previous.strike, reached: previous.reached,
            cancel: Math.max(0, age) / MORTAR_CANCEL_PRESENTATION_MS, started: age === 0 });
        }
      }
      if (nowMs >= previous.impactAt && (!previous.cancelled || nowMs - previous.cancelledAt >= MORTAR_CANCEL_PRESENTATION_MS)) {
        this.observations.delete(id);
      }
    }
    return strikes.flatMap(strike => {
      const state = mortarStrikePhase(strike, nowMs);
      if (state.phase === 'finished' || state.phase === 'pending') return [];
      const previous = this.observations.get(strike.id)
        ?? { windup: false, handled: false, cancelled: false, launched: false, impactAt: strike.impactAt,
          strike, reached: 0, cancelledAt: 0 };
      this.observations.set(strike.id, previous);
      if (previous.cancelled) return [];
      previous.strike = strike; previous.reached = state.windup;
      const thump = state.phase === 'flight' && !previous.handled
        && (previous.windup || state.launchAgeMs <= MORTAR_THUMP_JOIN_WINDOW_MS);
      if (thump) previous.launched = true;
      if (state.phase === 'flight') previous.handled = true;
      if (state.phase === 'windup') previous.windup = true;
      return [{ strike, ...state, thump, showLaunch: previous.launched }];
    });
  }

  clear(): void { this.observations.clear(); this.cancels = []; }
}
