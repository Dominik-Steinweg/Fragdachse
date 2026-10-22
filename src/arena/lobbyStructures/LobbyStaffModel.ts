/**
 * Behaviour of a lobby staff member, local to every client and never replicated: work at the
 * station, turn toward the nearby local player within a bounded arc, greet once when the Shift
 * focus lands on the own structure, and return to work after the player leaves.
 */
export const LOBBY_STAFF_BEHAVIOUR = {
  /** Player distance (px) within which the staff look up from their work. */
  attendRangePx: 5 * 32,
  /** Largest turn away from the work heading, so nobody turns their back on the station. */
  maxAttendOffsetRad: 100 * Math.PI / 180,
  turnRateRadPerSec: 240 * Math.PI / 180,
  /** Below this offset from the work heading the work clip runs; otherwise they stand attentive. */
  workToleranceRad: 25 * Math.PI / 180,
  greetCooldownMs: 8000,
  releaseMs: 1500,
} as const;

export type LobbyStaffClip = 'work' | 'idle' | 'greet';

export interface LobbyStaffState {
  heading: number;
  clip: LobbyStaffClip;
  greetUntil: number;
  greetCooldownUntil: number;
  attendUntil: number;
  focused: boolean;
}

export interface LobbyStaffInput {
  readonly now: number;
  readonly deltaMs: number;
  readonly x: number;
  readonly y: number;
  readonly workHeading: number;
  readonly player: { readonly x: number; readonly y: number } | null;
  readonly focused: boolean;
  readonly greetDurationMs: number;
}

export function createLobbyStaffState(workHeading: number): LobbyStaffState {
  return { heading: workHeading, clip: 'work', greetUntil: 0, greetCooldownUntil: 0, attendUntil: 0, focused: false };
}

/** Signed shortest angle from `from` to `to`, in (-PI, PI]. */
export function angleDelta(from: number, to: number): number {
  const delta = (to - from) % (Math.PI * 2);
  return delta > Math.PI ? delta - Math.PI * 2 : delta <= -Math.PI ? delta + Math.PI * 2 : delta;
}

export function stepLobbyStaff(state: LobbyStaffState, input: LobbyStaffInput): LobbyStaffState {
  const rules = LOBBY_STAFF_BEHAVIOUR;
  if (input.focused && !state.focused && input.now >= state.greetCooldownUntil) {
    state.greetUntil = input.now + input.greetDurationMs;
    state.greetCooldownUntil = input.now + rules.greetCooldownMs;
  }
  state.focused = input.focused;
  const player = input.player;
  const near = !!player && Math.hypot(player.x - input.x, player.y - input.y) <= rules.attendRangePx;
  if (near || input.focused) state.attendUntil = input.now + rules.releaseMs;
  let target = input.workHeading;
  if (player && input.now < state.attendUntil) {
    const toward = angleDelta(input.workHeading, Math.atan2(player.y - input.y, player.x - input.x));
    target = input.workHeading + Math.max(-rules.maxAttendOffsetRad, Math.min(rules.maxAttendOffsetRad, toward));
  }
  const delta = angleDelta(state.heading, target);
  const step = rules.turnRateRadPerSec * Math.max(0, input.deltaMs) / 1000;
  state.heading += Math.abs(delta) <= step ? delta : Math.sign(delta) * step;
  state.clip = input.now < state.greetUntil ? 'greet'
    : Math.abs(angleDelta(input.workHeading, state.heading)) <= rules.workToleranceRad ? 'work' : 'idle';
  return state;
}
