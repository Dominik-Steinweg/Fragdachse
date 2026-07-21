import { describe, expect, it } from 'vitest';
import { AUDIO_ASSETS, SOUND_VOLUMES } from '../src/audio/AudioCatalog';
import { UTILITY_CONFIGS } from '../src/loadout/LoadoutConfig';

/**
 * Die Brutbombe explodiert nicht, sie lässt einen Dachs schlüpfen – deshalb spielt sie das
 * Wurfgeräusch der Granaten statt eines Explosionsknalls ab. Die Zuordnung selbst sitzt in
 * RpcCoordinator.resolveExplosionAudio ('brood_hatch' -> 'shot_throw'); dieses Modul zieht Phaser
 * zur Laufzeit und ist im aktuellen Test-Setup nicht ladbar. Hier werden deshalb die beiden
 * Annahmen abgesichert, auf denen die Zuordnung steht.
 */
describe('Brutbomben-Schlüpfgeräusch', () => {
  const HATCH_SOUND_KEY = 'shot_throw';

  it('reuses exactly the sound key the thrown grenades use', () => {
    expect(UTILITY_CONFIGS.HE_GRENADE.shotAudio?.successKey).toBe(HATCH_SOUND_KEY);
  });

  it('resolves that key in the audio catalog', () => {
    expect(AUDIO_ASSETS).toHaveProperty(HATCH_SOUND_KEY);
    expect(SOUND_VOLUMES[HATCH_SOUND_KEY]).toBeGreaterThan(0);
  });
});
