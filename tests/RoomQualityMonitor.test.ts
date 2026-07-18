import { describe, expect, it } from 'vitest';
import { RoomQualityMonitor } from '../src/network/RoomQualityMonitor';
import type { GameplayTransportMode, PlayerProfile, RoomQualitySnapshot } from '../src/types';

function player(id: string): PlayerProfile {
  return { id } as PlayerProfile;
}

describe('RoomQualityMonitor', () => {
  it('does not invent a ping while the host is alone', () => {
    let published: RoomQualitySnapshot | null = null;
    const monitor = new RoomQualityMonitor({
      isHost: () => true,
      getLocalPlayerId: () => 'host',
      getGameplayTransportMode: () => 'fast',
      getPlayerPing: () => 0,
      getRoomQuality: () => published,
      publishRoomQuality: snapshot => { published = snapshot; },
    });

    monitor.initialize(0);
    const snapshot = monitor.update(500, [player('host')]);

    expect(snapshot?.status).toBe('waiting');
    expect(snapshot?.worstPingMs).toBeNull();
    expect(snapshot?.summary).toContain('Mitspieler');
  });

  it('measures the selected transport and discards samples after a mode switch', () => {
    let mode: GameplayTransportMode = 'fast';
    let published: RoomQualitySnapshot | null = null;
    const monitor = new RoomQualityMonitor({
      isHost: () => true,
      getLocalPlayerId: () => 'host',
      getGameplayTransportMode: () => mode,
      getPlayerPing: () => 50,
      getRoomQuality: () => published,
      publishRoomQuality: snapshot => { published = snapshot; },
    });
    const players = [player('host'), player('client')];

    monitor.initialize(0);
    monitor.update(0, players);
    monitor.update(500, players);
    const fastSnapshot = monitor.update(1000, players);
    expect(fastSnapshot?.status).toBe('good');
    expect(fastSnapshot?.source).toBe('fast-ping');
    expect(fastSnapshot?.worstPingMs).toBe(50);

    mode = 'rpc';
    const switchedSnapshot = monitor.update(1500, players);
    expect(switchedSnapshot?.status).toBe('sampling');
    expect(switchedSnapshot?.source).toBe('rpc-ping');
    expect(switchedSnapshot?.minSamplesCollected).toBe(1);
  });
});
