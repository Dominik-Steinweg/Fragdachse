import { describe, expect, it } from 'vitest';
import { clampPlayerNameInput, PLAYER_NAME_MAX_LENGTH, sanitizePlayerName } from '../src/utils/playerName';

describe('player name', () => {
  it('limits names to twelve characters', () => {
    expect(PLAYER_NAME_MAX_LENGTH).toBe(12);
    expect(clampPlayerNameInput('ABCDEFGHIJKLM')).toBe('ABCDEFGHIJKL');
    expect(sanitizePlayerName('  ABCDEFGHIJKLM  ')).toBe('ABCDEFGHIJKL');
  });
});
