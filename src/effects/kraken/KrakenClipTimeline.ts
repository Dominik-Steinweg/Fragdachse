export interface KrakenClipSample { readonly clip: string; readonly frame: number }
type Anchor = readonly [time: number, frame: number];
/** Retiming consumes semantic export markers and absolute host anchors, never clip.next. */
export function sampleKrakenClip(clip: { name: string; frames: readonly unknown[] }, now: number, anchors: readonly Anchor[]): KrakenClipSample {
  let frame = anchors[0][1];
  for (let i = 1; i < anchors.length; i++) {
    const [end, last] = anchors[i], [start, first] = anchors[i - 1];
    if (now >= end) { frame = last; continue; }
    frame = first + (last - first) * Math.max(0, Math.min(1, (now - start) / Math.max(1, end - start)));
    break;
  }
  return { clip: clip.name, frame: Math.max(0, Math.min(clip.frames.length - 1, Math.floor(frame))) };
}
