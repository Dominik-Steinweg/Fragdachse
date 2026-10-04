import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => { vi.resetModules(); vi.stubGlobal('window', new EventTarget()); });
afterEach(() => vi.unstubAllGlobals());

describe('voice preferences', () => {
  it.each([null, '{}', 'null', '{broken', '{"volume":"loud"}'])('defaults to no voice and mute for missing or invalid settings (%s)', async stored => {
    vi.stubGlobal('localStorage', { getItem: () => stored });
    const { readVoicePreferences } = await import('../src/voice/VoiceLibrary');
    expect(readVoicePreferences()).toEqual({ checksum: null, enabled: false, volume: 0 });
  });
  it('normalizes zero and legacy mute while preserving audible preferences', async () => {
    let stored = '{"enabled":true,"volume":0}';
    vi.stubGlobal('localStorage', { getItem: () => stored });
    const { readVoicePreferences } = await import('../src/voice/VoiceLibrary');
    expect(readVoicePreferences()).toMatchObject({ enabled: false, volume: 0 });
    stored = '{"enabled":false,"volume":0.8}';
    expect(readVoicePreferences()).toMatchObject({ enabled: false, volume: 0 });
    stored = '{"enabled":true,"volume":0.6}';
    expect(readVoicePreferences()).toMatchObject({ enabled: true, volume: 0.6 });
  });
  it('persists zero as off even when browser storage is unavailable', async () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('blocked'); } });
    const { readVoicePreferences, saveVoicePreferences } = await import('../src/voice/VoiceLibrary');
    const changed = vi.fn(); window.addEventListener('voice-preferences', changed);
    expect(readVoicePreferences().enabled).toBe(false);
    saveVoicePreferences({ checksum: null, enabled: true, volume: 0 });
    expect(readVoicePreferences()).toEqual({ checksum: null, enabled: false, volume: 0 });
    saveVoicePreferences({ checksum: null, enabled: true, volume: 0.5 });
    expect(readVoicePreferences()).toMatchObject({ enabled: true, volume: 0.5 });
    expect(changed).toHaveBeenCalledTimes(2);
  });
});
