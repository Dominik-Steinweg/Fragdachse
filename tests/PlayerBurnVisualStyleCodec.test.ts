import { describe, expect, it } from 'vitest';
import { decodePlayerStates, encodePlayerStates } from '../src/network/playerStateCodec';
import type { PlayerNetState } from '../src/types';

function makePlayerState(burnVisualStyle: PlayerNetState['burnVisualStyle']): PlayerNetState {
  return {
    x: 120,
    y: 340,
    rot: 20,
    hp: 80,
    maxHp: 100,
    armor: 5,
    alive: true,
    adrenaline: 10,
    adrenalineRevision: 7,
    weapon2PredictionAck: 3,
    rage: 15,
    isBurrowed: false,
    isStunned: false,
    burrowPhase: 'idle',
    isRaging: false,
    burnStacks: 3,
    burnVisualStyle,
    dashPhase: 0,
    aim: {
      revision: 2,
      isMoving: false,
      weapon1DynamicSpread: 1,
      weapon2DynamicSpread: 2,
    },
  };
}

describe('player burn visual style codec', () => {
  it('preserves the active dash origin and normalizes older snapshots to ordinary dash', () => {
    const special = { ...makePlayerState('normal'), dashPhase: 1 as const, isBurrowDash: true };
    const decoded = decodePlayerStates(encodePlayerStates({ special, old: makePlayerState(undefined) }));
    expect(decoded.special).toMatchObject({ dashPhase: 1, isBurrowDash: true, alive: true });
    expect(decoded.old.isBurrowDash).toBe(false);
    expect(decodePlayerStates(encodePlayerStates({ normal: { ...special, isBurrowDash: false } })).normal.isBurrowDash).toBe(false);
  });
  it('preserves fractional authoritative adrenaline through the compact wire format', () => {
    const source = { ...makePlayerState('normal'), adrenaline: 0.375 };
    expect(decodePlayerStates(encodePlayerStates({ p0: source })).p0.adrenaline).toBe(0.375);
  });
  it('round-trips void entity fire and defaults older payloads to normal fire', () => {
    const encodedVoid = encodePlayerStates({ p0: makePlayerState('void') });
    expect(decodePlayerStates(encodedVoid).p0.burnVisualStyle).toBe('void');
    expect(decodePlayerStates(encodedVoid).p0.adrenalineRevision).toBe(7);
    expect(decodePlayerStates(encodedVoid).p0.weapon2PredictionAck).toBe(3);

    const encodedNormal = encodePlayerStates({ p0: makePlayerState(undefined) });
    expect(decodePlayerStates(encodedNormal).p0.burnVisualStyle).toBe('normal');
  });
});
