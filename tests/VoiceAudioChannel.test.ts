import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoiceAudioChannel } from '../src/voice/VoiceAudioChannel';
import { saveVoicePreferences } from '../src/voice/VoiceLibrary';
import type { VoicePackage } from '../src/voice/VoicePackage';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('optional voice playback', () => {
  it('drops duplicates, old scopes, hidden-tab and locked-audio events without replay, and keeps an independent gain', async () => {
    const document = Object.assign(new EventTarget(), { hidden: false }); const window = new EventTarget();
    vi.stubGlobal('document', document); vi.stubGlobal('window', window); vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
    saveVoicePreferences({ checksum: null, enabled: true, volume: 0.8 });
    const sources: any[] = []; const gain = { gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() };
    const context = { state: 'running', destination: {}, createGain: () => gain,
      decodeAudioData: async () => ({ duration: 1, length: 24000, numberOfChannels: 1 }),
      createBufferSource: () => { const s = { connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() }; sources.push(s); return s; } };
    const audio = new VoiceAudioChannel(context as unknown as AudioContext, () => 0.5);
    const pack = { checksum: 'hash', files: { 'clip.ogg': 'AA==' }, manifest: { clips: [{ id: 'clip', file: 'clip.ogg', duration: 1 }] } } as unknown as VoicePackage;
    audio.setScope({ worldRevision: 1, roundRevision: 2 }); await audio.prepare([pack]);
    const event = { worldRevision: 1, roundRevision: 2, sequence: 1, speakerId: 'p', event: 'kill' as const, checksum: 'hash', clipId: 'clip', sentAt: 1000, expiresAt: 3000 };
    audio.play(event, 1100); expect(sources).toHaveLength(1); expect(gain.gain.value).toBeCloseTo(0.4);
    audio.stop(); audio.play(event, 1200); expect(sources).toHaveLength(1);
    document.hidden = true; audio.play({ ...event, sequence: 2 }, 1200); document.hidden = false; audio.play({ ...event, sequence: 2 }, 1300); expect(sources).toHaveLength(1);
    context.state = 'suspended'; audio.play({ ...event, sequence: 3 }, 1300); context.state = 'running'; audio.play({ ...event, sequence: 3 }, 1400); expect(sources).toHaveLength(1);
    audio.play({ ...event, sequence: 4, roundRevision: 1 }, 1500); audio.play({ ...event, sequence: 5 }, 4000); expect(sources).toHaveLength(1);
    audio.play({ ...event, sequence: 6 }, 1600); expect(sources).toHaveLength(2);
    vi.useFakeTimers();
    audio.play({ ...event, event: 'victory', sequence: 7, sentAt: 2000, playAt: 2500, expiresAt: 4500 }, 2000);
    audio.setScope({ worldRevision: 2, roundRevision: 0 });
    vi.advanceTimersByTime(500); expect(sources).toHaveLength(3);
    saveVoicePreferences({ checksum: null, enabled: false, volume: 0.8 }); expect(sources[2].stop).toHaveBeenCalledOnce(); expect(gain.gain.value).toBe(0); expect(audio.metrics.decodedBytes).toBe(0);
    audio.destroy(); expect(gain.disconnect).toHaveBeenCalledOnce();
  });
});
