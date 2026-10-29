import { EventEmitter } from 'node:events';
import { preloadAllAudio } from '../src/audio/AudioCatalog';

/**
 * Runs preloadAllAudio against a minimal loader and completes every requested file.
 * Returns key -> requested logical path for every key that becomes playable, including keys
 * that share the buffer of a byte-identical file loaded under another key.
 */
export function preloadedAudio(): Map<string, string> {
  const requested = new Map<string, string>(), available = new Map<string, string>(), events = new EventEmitter();
  const loader = {
    audio: (key: string, path: string) => { requested.set(key, path); },
    once: (event: string, listener: (...args: unknown[]) => void) => { events.once(event, listener); },
    cacheManager: { audio: { add: (key: string, path: string) => { available.set(key, path); } } },
  };
  preloadAllAudio(loader as never);
  for (const [key, path] of requested) {
    available.set(key, path);
    events.emit(`filecomplete-audio-${key}`, key, 'audio', path);
  }
  return available;
}
