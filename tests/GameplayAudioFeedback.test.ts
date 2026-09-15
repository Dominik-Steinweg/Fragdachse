import { describe, expect, it } from 'vitest';
import { GameplayAudioCursor, isGameplayAudioEvent, PICKUP_AUDIO, UltimateReadyFeedback,
  type GameplayAudioEvent } from '../src/audio/GameplayAudioFeedback';
import { POWERUP_DEFS } from '../src/powerups/PowerUpConfig';

const event = (overrides: Partial<GameplayAudioEvent> = {}): GameplayAudioEvent => ({
  wr: 1, sequence: 1, key: 'sfx_player_death', eventId: 'life-1', ...overrides,
});

describe('confirmed audio event admission', () => {
  it('consumes duplicate, nonlocal and retired Activity events without replay', () => {
    const cursor = new GameplayAudioCursor();
    expect(cursor.accept(event(), 1, 2, 'p1')).toBe(true);
    expect(cursor.accept(event(), 1, 2, 'p1')).toBe(false);
    expect(cursor.accept(event({ sequence: 2 }), 1, 2, 'p1')).toBe(false);
    expect(cursor.accept(event({ sequence: 3, eventId: 'life-2' }), 1, 2, 'p1')).toBe(true);
    const pickup = event({ sequence: 4, key: 'sfx_pickup_hp', eventId: 'pickup-1', recipientId: 'p2' });
    expect(cursor.accept(pickup, 1, 2, 'p1')).toBe(false);
    expect(cursor.accept(pickup, 1, 2, 'p2')).toBe(false);
    const oldMission = event({ sequence: 5, eventId: 'wave', activityRevision: 1 });
    expect(cursor.accept(oldMission, 1, 2, 'p1')).toBe(false);
    expect(cursor.accept(oldMission, 1, 1, 'p1')).toBe(false);
    expect(cursor.accept(event({ sequence: 6, wr: 1 }), 2, null, 'p1')).toBe(false);
    expect(cursor.accept(event({ wr: 2 }), 2, null, 'p1')).toBe(true);
  });

  it('rejects malformed wire data and keeps one distinct sound per actual pickup', () => {
    expect(isGameplayAudioEvent(event())).toBe(true);
    for (const invalid of [null, {}, event({ sequence: NaN }), event({ position: { x: Infinity, y: 0 } }),
      { ...event(), key: 'music_lobby' }, { ...event(), eventId: '' }]) {
      expect(isGameplayAudioEvent(invalid)).toBe(false);
    }
    expect(new Set(Object.values(PICKUP_AUDIO)).size).toBe(Object.keys(PICKUP_AUDIO).length);
    for (const id of Object.keys(PICKUP_AUDIO)) expect(POWERUP_DEFS[id]?.id).toBe(id);
  });

  it('only announces confirmed readiness crossings, never bootstrap, loadout changes or repeated values', () => {
    const ready = new UltimateReadyFeedback();
    expect(ready.update('world1:ultimate1', 100, 100)).toBe(false);
    expect(ready.update('world1:ultimate1', 100, 100)).toBe(false);
    expect(ready.update('world1:ultimate1', 50, 100)).toBe(false);
    expect(ready.update('world1:ultimate1', 100, 100)).toBe(true);
    expect(ready.update('world1:ultimate1', 101, 100)).toBe(false);
    expect(ready.update('world1:ultimate2', 101, 100)).toBe(false);
    expect(ready.update('world1:ultimate2', 90, 100)).toBe(false);
    expect(ready.update('world1:ultimate2', 90, 80)).toBe(false);
    ready.reset();
    expect(ready.update('world1:ultimate2', 100, 80)).toBe(false);
  });
});
