import { describe, expect, it } from 'vitest';
import { RoomQualityMonitor } from '../src/network/RoomQualityMonitor';
import { ROOM_QUALITY_MAX_ACCEPTABLE_PING_MS, ROOM_QUALITY_REQUIRED_SAMPLES } from '../src/config';
import type { PlayerProfile, RoomQualitySnapshot } from '../src/types';

function player(id: string): PlayerProfile {
  return { id } as PlayerProfile;
}

function createMonitor(getPlayerPing: (playerId: string) => number) {
  let published: RoomQualitySnapshot | null = null;
  const monitor = new RoomQualityMonitor({
    isHost: () => true,
    getLocalPlayerId: () => 'host',
    getPlayerPing,
    getRoomQuality: () => published,
    publishRoomQuality: snapshot => { published = snapshot; },
  });
  return monitor;
}

describe('RoomQualityMonitor', () => {
  it('does not invent a ping while the host is alone', () => {
    const monitor = createMonitor(() => 0);

    monitor.initialize(0);
    const snapshot = monitor.update(500, [player('host')]);

    expect(snapshot?.status).toBe('waiting');
    expect(snapshot?.worstPingMs).toBeNull();
    expect(snapshot?.summary).toContain('Mitspieler');
  });

  it('samples until it has enough data, then rates the room', () => {
    const monitor = createMonitor(() => 50);
    const players = [player('host'), player('client')];

    monitor.initialize(0);
    const first = monitor.update(0, players);
    expect(first?.status).toBe('sampling');
    expect(first?.minSamplesCollected).toBe(1);

    for (let sample = 1; sample < ROOM_QUALITY_REQUIRED_SAMPLES; sample++) {
      monitor.update(sample * 500, players);
    }

    const rated = monitor.update(ROOM_QUALITY_REQUIRED_SAMPLES * 500, players);
    expect(rated?.status).toBe('good');
    expect(rated?.source).toBe('webrtc');
    expect(rated?.worstPingMs).toBe(50);
  });

  it('rates the room by its slowest player', () => {
    const pings: Record<string, number> = { fast: 20, slow: ROOM_QUALITY_MAX_ACCEPTABLE_PING_MS + 40 };
    const monitor = createMonitor(playerId => pings[playerId] ?? 0);
    const players = [player('host'), player('fast'), player('slow')];

    monitor.initialize(0);
    for (let sample = 0; sample <= ROOM_QUALITY_REQUIRED_SAMPLES; sample++) {
      monitor.update(sample * 500, players);
    }

    const snapshot = monitor.update((ROOM_QUALITY_REQUIRED_SAMPLES + 1) * 500, players);
    expect(snapshot?.status).toBe('bad');
    expect(snapshot?.worstPingMs).toBe(pings.slow);
  });

  it('forgets samples of players that left', () => {
    const monitor = createMonitor(() => 30);
    const players = [player('host'), player('client')];

    monitor.initialize(0);
    for (let sample = 0; sample <= ROOM_QUALITY_REQUIRED_SAMPLES; sample++) {
      monitor.update(sample * 500, players);
    }
    expect(monitor.update(2000, players)?.status).toBe('good');

    const rejoined = monitor.update(2500, [player('host')]);
    expect(rejoined?.status).toBe('waiting');
  });
});
