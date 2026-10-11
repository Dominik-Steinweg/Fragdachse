import type { SyncedMortarStrike } from '../types';

export const MORTAR_THUMP_JOIN_WINDOW_MS = 150;
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

export function isMortarSourceOffscreen(strike: SyncedMortarStrike, nowMs: number,
  view: { x: number; y: number; width: number; height: number }): boolean {
  return strike.faction === 'hostile' && mortarStrikePhase(strike, nowMs).phase === 'windup'
    && (strike.sourceX < view.x || strike.sourceX > view.x + view.width
      || strike.sourceY < view.y || strike.sourceY > view.y + view.height);
}

/** The shared edge helper returns unzoomed, scroll-fixed world-camera coordinates.
 * HUD/clarity has its own zoom (notably in dev scenarios and scoped views). */
export function mortarEdgePointForClarity(point: { x: number; y: number },
  worldZoom: { x: number; y: number }, clarityZoom: { x: number; y: number }) {
  return { x: point.x * worldZoom.x / Math.max(0.001, clarityZoom.x),
    y: point.y * worldZoom.y / Math.max(0.001, clarityZoom.y) };
}

interface Observation { windup: boolean; handled: boolean; cancelled: boolean; launched: boolean; impactAt: number }

/** Tombstones survive a missing snapshot until impact, so repeats cannot replay a launch.
 * World clear resets the ID domain; expired snapshots never emit. */
export class MortarStrikePresentationTimeline {
  private readonly observations = new Map<number, Observation>();

  sample(strikes: readonly SyncedMortarStrike[], nowMs: number) {
    const present = new Set(strikes.map(strike => strike.id));
    for (const [id, previous] of this.observations) {
      if (nowMs >= previous.impactAt) this.observations.delete(id);
      else if (!present.has(id) && previous.windup && !previous.handled) previous.cancelled = true;
    }
    return strikes.flatMap(strike => {
      const state = mortarStrikePhase(strike, nowMs);
      if (state.phase === 'finished' || state.phase === 'pending') return [];
      const previous = this.observations.get(strike.id)
        ?? { windup: false, handled: false, cancelled: false, launched: false, impactAt: strike.impactAt };
      this.observations.set(strike.id, previous);
      if (previous.cancelled) return [];
      const thump = state.phase === 'flight' && !previous.handled
        && (previous.windup || state.launchAgeMs <= MORTAR_THUMP_JOIN_WINDOW_MS);
      if (thump) previous.launched = true;
      if (state.phase === 'flight') previous.handled = true;
      if (state.phase === 'windup') previous.windup = true;
      return [{ strike, ...state, thump, showLaunch: previous.launched }];
    });
  }

  clear(): void { this.observations.clear(); }
}
