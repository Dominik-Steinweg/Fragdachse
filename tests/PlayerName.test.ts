import { describe, expect, it } from 'vitest';
import { clampPlayerNameInput, PLAYER_NAME_MAX_LENGTH, sanitizePlayerName } from '../src/utils/playerName';
import { NetworkBridge } from '../src/network/NetworkBridge';
import { clearActiveSession, setActiveSession } from '../src/network/peer/session';
import { FakeNetwork, addClientRoom, createHostRoom } from './fakePeerNetwork';

describe('player name', () => {
  it('limits names to twelve characters', () => {
    expect(PLAYER_NAME_MAX_LENGTH).toBe(12);
    expect(clampPlayerNameInput('ABCDEFGHIJKLM')).toBe('ABCDEFGHIJKL');
    expect(sanitizePlayerName('  ABCDEFGHIJKLM  ')).toBe('ABCDEFGHIJKL');
  });

  it('uses the default profile name when a joining client supplies a non-string name', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const client = await addClientRoom(network);
    try {
      const playerId = client.room.getLocalPlayerId();
      client.room.getPlayerHandle(playerId)!.setState('pnm', { trim: 'invalid' }, true);
      setActiveSession({ room: host.room, transport: host.transport, roomCode: 'ABC123' });
      const bridge = new NetworkBridge();
      expect(() => bridge.activate()).not.toThrow();
      expect(bridge.getPlayerProfile(playerId)?.name).toEqual(expect.any(String));
      expect(bridge.getPlayerProfile(playerId)?.name.length).toBeGreaterThan(0);
    } finally {
      client.room.destroy();
      clearActiveSession();
    }
  });

  it('preserves the previous valid name when a connected client sends malformed profile data', async () => {
    const network = new FakeNetwork();
    const host = await createHostRoom(network);
    const client = await addClientRoom(network);
    try {
      setActiveSession({ room: host.room, transport: host.transport, roomCode: 'ABC123' });
      const bridge = new NetworkBridge();
      bridge.activate();
      const playerId = client.room.getLocalPlayerId();
      const player = client.room.getPlayerHandle(playerId)!;
      player.setState('pnm', '  Valid Name  ', true);
      expect(bridge.getPlayerProfile(playerId)?.name).toBe('Valid Name');
      for (const malformedName of [42, true, {}, [], { trim: 'invalid' }, null]) {
        player.setState('pnm', malformedName, true);
        expect(() => bridge.getPlayerProfile(playerId)).not.toThrow();
        expect(bridge.getPlayerProfile(playerId)?.name).toBe('Valid Name');
      }
      player.setState('pnm', '  ABCDEFGHIJKLM  ', true);
      expect(bridge.getPlayerProfile(playerId)?.name).toBe('ABCDEFGHIJKL');
    } finally {
      client.room.destroy();
      clearActiveSession();
    }
  });
});
