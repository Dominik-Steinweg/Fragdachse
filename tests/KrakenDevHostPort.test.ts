import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CoopDefenseKrakenSystem } from '../src/systems/CoopDefenseKrakenSystem';
import { bindKrakenDevHost, krakenDevAuthorized, readKrakenDevAction, requireKrakenDevHost } from '../src/dev/scenario/krakenHostPort';

const session = vi.hoisted(() => ({ dev: true, host: true, players: ['local'] }));
vi.mock('../src/utils/devScenarioMode', () => ({ isDevScenarioMode: () => session.dev }));
vi.mock('../src/network/bridge', () => ({ bridge: {
  isHost: () => session.host, getLocalPlayerId: () => 'local',
  getConnectedPlayers: () => session.players.map(id => ({ id })),
} }));
vi.mock('../src/network/peer/LocalScenarioSession', () => ({ isLocalScenarioBotPeer: (id: string) => id === 'local-bot' }));
afterEach(() => { session.dev = true; session.host = true; session.players = ['local']; });

describe('Kraken isolated dev binding', () => {
  it('rejects production, clients and external peers on every access', () => {
    const owner = { getDevAction: () => null } as unknown as CoopDefenseKrakenSystem;
    const release = bindKrakenDevHost(owner);
    try {
      expect(requireKrakenDevHost()).toBe(owner);
      session.dev = false; expect(() => requireKrakenDevHost()).toThrow('Isolated');
      session.dev = true; session.host = false; expect(() => requireKrakenDevHost()).toThrow('Isolated');
      session.host = true; session.players.push('remote'); expect(krakenDevAuthorized()).toBe(false);
      expect(() => requireKrakenDevHost()).toThrow('Isolated');
      session.players = ['local', 'local-bot']; expect(krakenDevAuthorized()).toBe(true);
    } finally { release(); }
  });
  it('revokes the Activity binding without letting stale teardown detach a replacement', () => {
    const first = { getDevAction: () => null } as unknown as CoopDefenseKrakenSystem;
    const second = { getDevAction: () => ({ act: 'dive', status: 'pending', requestedAt: 12 }) } as unknown as CoopDefenseKrakenSystem;
    const releaseFirst = bindKrakenDevHost(first), releaseSecond = bindKrakenDevHost(second);
    releaseFirst(); expect(requireKrakenDevHost()).toBe(second);
    expect(readKrakenDevAction()).toMatchObject({ act: 'dive' });
    releaseSecond(); expect(readKrakenDevAction()).toBeNull();
    expect(() => requireKrakenDevHost()).toThrow('Active Kraken');
  });
});
