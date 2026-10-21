import type { AudioAssetKey } from '../audio/AudioCatalog';
import type { ChunkWorldRect } from './chunks/ArenaChunkGrid';
import { hashCell01 } from './CellHash';
import type { BirdKind } from './AmbientWildlifeAppearance';
import { BIRD_CUE, type BirdPhase } from './AmbientWildlifeBirds';
import type { WildlifeAnimal } from './AmbientWildlifeModel';

/** Positional one-shots, borrowed from the World presentation for each update; nothing is retained. */
export interface WildlifeAudioPort {
  playSound(key: AudioAssetKey, x: number, y: number, volumeScale: number): void;
}

interface IdleCall {
  readonly key: AudioAssetKey;
  readonly seconds: readonly [number, number];
  readonly phases: readonly BirdPhase[];
}

/** Idle calls per species; owls hoot only on their night patrol, sparrows chirp on the ground. */
const IDLE_CALLS: Record<BirdKind, IdleCall> = {
  sparrow: { key: 'sfx_wildlife_sparrow_chirp', seconds: [6, 16], phases: ['forage', 'drink'] },
  magpie: { key: 'sfx_wildlife_magpie_chatter', seconds: [25, 60], phases: ['forage'] },
  raven: { key: 'sfx_wildlife_raven_croak', seconds: [18, 45], phases: ['forage', 'flight', 'landing'] },
  owl: { key: 'sfx_wildlife_owl_hoot', seconds: [14, 40], phases: ['patrol', 'circle'] },
};

/** The same sound never restarts sooner than this, however many birds ask for it. */
const MIN_GAP_SECONDS: Partial<Record<AudioAssetKey, number>> = {
  sfx_wildlife_sparrow_flush: .3, sfx_wildlife_sparrow_chirp: .5, sfx_wildlife_magpie_chatter: .8,
  sfx_wildlife_raven_croak: 1.5, sfx_wildlife_owl_hoot: 3, sfx_wildlife_wing_flap: .25,
};

/** Birds only sound near what the local camera shows. */
const AUDIBLE_MARGIN_PX = 96;

/**
 * Turns the model's one-frame bird cues into sound: a flock's flutter scaled by its size, a corvid's
 * flap or alarm call, plus seeded idle calls. Owls fly silently. At most one bird sound starts per
 * frame; local presentation only, so peers may hear slightly different birds.
 */
export class AmbientWildlifeAudio {
  private readonly birds: readonly WildlifeAnimal[];
  private readonly timers: Float64Array;
  private readonly calls: Uint32Array;
  private readonly lastPlayed = new Map<AudioAssetKey, number>();
  private time = 0;

  constructor(animals: readonly WildlifeAnimal[]) {
    this.birds = animals.filter(a => a.bird);
    this.calls = new Uint32Array(this.birds.length);
    this.timers = new Float64Array(this.birds.length).map((_, i) => this.interval(i));
  }

  private interval(index: number): number {
    const seconds = IDLE_CALLS[this.birds[index].kind as BirdKind].seconds;
    return seconds[0] + (seconds[1] - seconds[0]) * hashCell01(index, this.calls[index], 4100);
  }

  update(deltaMs: number, view: ChunkWorldRect, port: WildlifeAudioPort | undefined): void {
    const dt = Math.max(0, Math.min(deltaMs / 1000, .05));
    this.time += dt;
    if (!port) return;
    let started = false;
    for (let i = 0; i < this.birds.length; i++) {
      const a = this.birds[i], bird = a.bird!, kind = a.kind as BirdKind;
      if (bird.phase === 'hidden' || a.opacity < .05) continue;
      if (a.x < view.x - AUDIBLE_MARGIN_PX || a.y < view.y - AUDIBLE_MARGIN_PX
        || a.x > view.x + view.width + AUDIBLE_MARGIN_PX || a.y > view.y + view.height + AUDIBLE_MARGIN_PX) continue;
      if (!started && bird.cues & BIRD_CUE.TAKEOFF) started = this.takeoff(port, a, kind, (bird.cues & BIRD_CUE.ALARM) !== 0);
      const call = IDLE_CALLS[kind];
      if (!call.phases.includes(bird.phase)) continue;
      this.timers[i] -= dt;
      if (this.timers[i] > 0 || started) continue;
      started = this.play(port, call.key, a, 1);
      this.calls[i]++;
      this.timers[i] = this.interval(i);
    }
  }

  private takeoff(port: WildlifeAudioPort, a: WildlifeAnimal, kind: BirdKind, alarmed: boolean): boolean {
    if (kind === 'sparrow') return this.play(port, 'sfx_wildlife_sparrow_flush', a, .55 + .45 * Math.min(1, a.appearance.count / 9));
    if (kind === 'owl') return false;
    if (alarmed && kind === 'magpie') return this.play(port, 'sfx_wildlife_magpie_chatter', a, 1);
    if (alarmed && kind === 'raven' && hashCell01(a.bird!.flights, 0, 4200) < .3) return this.play(port, 'sfx_wildlife_raven_croak', a, 1);
    return this.play(port, 'sfx_wildlife_wing_flap', a, kind === 'raven' ? 1 : .8);
  }

  private play(port: WildlifeAudioPort, key: AudioAssetKey, a: WildlifeAnimal, volume: number): boolean {
    const last = this.lastPlayed.get(key);
    if (last !== undefined && this.time - last < (MIN_GAP_SECONDS[key] ?? 0)) return false;
    this.lastPlayed.set(key, this.time);
    port.playSound(key, a.x, a.y, volume);
    return true;
  }
}
