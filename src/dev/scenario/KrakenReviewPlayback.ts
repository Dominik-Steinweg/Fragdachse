import type { ReviewClip } from './KrakenReviewAssets';

export interface ReviewPlayback { clip: string; position: number; playing: boolean; markers: string[]; rest?: boolean }
/** A review sequence runs each listed clip once, including authored loops such as hover. */
export function advanceReviewClip(state: ReviewPlayback, clips: ReviewClip[], seconds: number, sequence?: readonly string[]): void {
  state.markers = [];
  let remaining = seconds;
  while (state.playing && remaining > 0) {
    const clip = clips.find(c => c.name === state.clip)!;
    const before = state.position, duration = (clip.frames.length - before) / clip.frameRate;
    const step = Math.min(remaining, duration);
    state.position += step * clip.frameRate; remaining -= step;
    for (const [name, frame] of Object.entries(clip.markers ?? {})) {
      if (frame >= before && frame < state.position) state.markers.push(`${clip.name}:${name}`);
    }
    if (state.position < clip.frames.length - 1e-8) break;
    const sequenceIndex = sequence?.indexOf(clip.name) ?? -1;
    const next = sequenceIndex >= 0 ? sequence?.[sequenceIndex + 1] : clip.next;
    if (next) { state.clip = next; state.position = 0; }
    else if (clip.loop && sequenceIndex < 0) state.position = 0;
    else { state.position = clip.frames.length - 1; state.playing = false;
      state.rest = sequenceIndex < 0 && (clip.end ?? 'rest') === 'rest'; }
  }
}
