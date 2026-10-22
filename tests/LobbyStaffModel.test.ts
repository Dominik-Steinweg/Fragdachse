import { describe, expect, it } from 'vitest';
import { LOBBY_STAFF_BEHAVIOUR, angleDelta, createLobbyStaffState, stepLobbyStaff, type LobbyStaffInput } from '../src/arena/lobbyStructures/LobbyStaffModel';

const WORK = Math.PI / 2; // facing south
const base: LobbyStaffInput = { now: 0, deltaMs: 16, x: 0, y: 0, workHeading: WORK, player: null, focused: false, greetDurationMs: 1000 };

function run(state = createLobbyStaffState(WORK), steps: number, input: Partial<LobbyStaffInput>, start = 0) {
  for (let i = 0; i < steps; i++) stepLobbyStaff(state, { ...base, ...input, now: start + i * 16 });
  return state;
}

describe('lobby staff behaviour', () => {
  it('keeps working at its station while nobody is near', () => {
    const state = run(undefined, 120, { player: { x: 600, y: 0 } });
    expect(state.clip).toBe('work');
    expect(state.heading).toBeCloseTo(WORK);
  });

  it('looks up toward a nearby player within the bounded arc and never turns its back on the station', () => {
    const behind = run(undefined, 200, { player: { x: 0, y: -100 } });
    expect(Math.abs(angleDelta(WORK, behind.heading))).toBeCloseTo(LOBBY_STAFF_BEHAVIOUR.maxAttendOffsetRad, 3);
    expect(behind.clip).toBe('idle');
    const aside = run(undefined, 200, { player: { x: 100, y: 10 } });
    expect(aside.heading).toBeCloseTo(Math.atan2(10, 100), 3);
  });

  it('turns no faster than its turn rate', () => {
    const state = createLobbyStaffState(WORK);
    stepLobbyStaff(state, { ...base, player: { x: 100, y: 0 }, deltaMs: 100 });
    expect(Math.abs(angleDelta(WORK, state.heading))).toBeCloseTo(LOBBY_STAFF_BEHAVIOUR.turnRateRadPerSec * .1, 5);
  });

  it('greets once on the focus edge, not while focus is held, and again only after the cooldown', () => {
    const state = createLobbyStaffState(WORK);
    stepLobbyStaff(state, { ...base, now: 0, focused: true, player: { x: 0, y: 60 } });
    expect(state.clip).toBe('greet');
    stepLobbyStaff(state, { ...base, now: 1200, focused: true, player: { x: 0, y: 60 } });
    expect(state.clip).toBe('work');
    stepLobbyStaff(state, { ...base, now: 1300, focused: false, player: { x: 0, y: 60 } });
    stepLobbyStaff(state, { ...base, now: 1400, focused: true, player: { x: 0, y: 60 } });
    expect(state.clip).not.toBe('greet');
    stepLobbyStaff(state, { ...base, now: LOBBY_STAFF_BEHAVIOUR.greetCooldownMs + 10, focused: false, player: { x: 0, y: 60 } });
    stepLobbyStaff(state, { ...base, now: LOBBY_STAFF_BEHAVIOUR.greetCooldownMs + 20, focused: true, player: { x: 0, y: 60 } });
    expect(state.clip).toBe('greet');
  });

  it('returns to work after the player has left for the release time', () => {
    const state = run(undefined, 120, { player: { x: 100, y: 0 } });
    expect(state.clip).toBe('idle');
    run(state, 200, { player: null }, 120 * 16 + LOBBY_STAFF_BEHAVIOUR.releaseMs);
    expect(state.clip).toBe('work');
    expect(state.heading).toBeCloseTo(WORK);
  });
});
