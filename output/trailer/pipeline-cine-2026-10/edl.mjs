// Edit decision list V2 (seconds). Segment: master `shot`, master range [from, to), playback `speed`
// (masters of action shots are overcranked: speed 2 = real time, 1 = half-speed slow motion),
// optional digital push `zoom` [start, end] around (zx, zy), 9:16 window centre `cx`.
// 120 BPM grid (bar = 2 s). Hook 0–1 · calm 1–3 · drop 3.0 · charger 11.0 · meteor impact 19.0 ·
// climax cuts 22.6–26.6 · silence 26.6 · end card 27.0.
const SEGMENTS = [
  { shot: 'tentacles', from: 4.4, to: 5.4, speed: 1, cx: .5, zoom: [1.25, 1.45], zy: .55 },        // 0.0  hook: an arm hammers down
  { shot: 'rise', from: 1.5, to: 5.5, speed: 1, cx: .5 },                                          // 1.0  calm water → eruption at 3.0
  { shot: 'tentacles', from: .15, to: 1.15, speed: 2, cx: .5, zoom: [1.15, 1.3], zy: .45 },        // 5.0  arm bursts from the pond
  { shot: 'ink', from: 1.4, to: 3.8, speed: 2, cx: .55, zoom: [1.05, 1.2], zy: .45 },              // 5.5  ink cone engulfs the bank
  { shot: 'spines', from: 1.6, to: 3.6, speed: 2, cx: .5, zoom: [1.0, 1.12] },                     // 6.7  spine volley
  { shot: 'ashore', from: 1.0, to: 3.0, speed: 2, cx: .5, zoom: [1.1, 1.2], zy: .45 },             // 7.7  badger pours fire into it
  { shot: 'ashore', from: 7.4, to: 9.7, speed: 1.0, cx: .5, zoom: [1.05, 1.2], zy: .5 },           // 8.7  it heaves out (hit ≈10.6)
  { shot: 'charger', from: 3.9, to: 5.1, speed: 1.5, cx: .62, zoom: [1.4, 1.6], zx: .62, zy: .48 }, // 11.0 shield eats the fire
  { shot: 'charger', from: 5.6, to: 6.95, speed: 1.5, cx: .45, zoom: [1.3, 1.4], zx: .45, zy: .5 },        // 11.8 corridor
  { shot: 'charger', from: 6.95, to: 7.9, speed: 1.0, cx: .38, zoom: [1.45, 1.55], zx: .38, zy: .5 },          // 12.7 charge streak
  { shot: 'mortar', from: 3.0, to: 5.6, speed: 1.6, cx: .45, zoom: [1.35, 1.6], zy: .45 },         // 13.65 ring → blast (≈14.9)
  { shot: 'fire', from: 7.2, to: 9.9, speed: 1.6, cx: .36, zoom: [1.3, 1.45], zx: .42, zy: .42 },  // 15.27 lance ignites the orbs
  { shot: 'meteor', from: 4.72, to: 9.22, speed: 1.5, cx: .34, zoom: [1.3, 1.45], zx: .36, zy: .5 },// 16.96 meteor (impact 19.0)
  { shot: 'tower', from: .2, to: 2.6, speed: 1.7, cx: .52, zoom: [1.35, 1.5], zx: .45, zy: .52 }, // 19.96 rockets from the tower
  { shot: 'tower', from: 6.0, to: 7.4, speed: 1.2, cx: .52, zoom: [1.4, 1.55], zx: .45, zy: .5 }, // 21.37 collapse (≈21.97)
  { shot: 'ashore', from: 11.0, to: 13.0, speed: 2, cx: .5, zoom: [1.15, 1.3], zy: .45 },          // 22.54 on land, under fire
  { shot: 'fire', from: 12.0, to: 13.0, speed: 2, cx: .36, zoom: [1.35, 1.45], zx: .42, zy: .42 }, // 23.54 firestorm
  { shot: 'mortar', from: 12.6, to: 13.4, speed: 1.6, cx: .45, zoom: [1.5, 1.6], zy: .45 },        // 24.04 blast (≈24.3)
  { shot: 'ashore', from: 9.3, to: 10.95, speed: .8, cx: .5, zoom: [1.3, 1.6], zy: .45 },           // 24.54 hero: the kraken towers
];
let t = 0;
export const EDL = SEGMENTS.map(s => { const seg = { ...s, at: +t.toFixed(4) }; t += (s.to - s.from) / s.speed; return seg; });
export const DURATION = 30;
// The end card plays over the rise master after a held black beat.
export const TAIL = { shot: 'rise', from: 6.1, to: 9.5, speed: 1, cx: .5, zoom: [1.1, 1.25] };
export const LETTERBOX = { open: 3.0, duration: .45 };
export const FLASHES = [
  { at: .62, d: .3, color: 'white' },
  { at: 1.0, d: .25, color: 'black', in: .01 },
  { at: 3.0, d: .3, color: 'white' },
  { at: 10.6, d: .2, color: 'white' },
  { at: 12.7, d: .14, color: 'white' },
  { at: 19.0, d: .3, color: 'white' },
  { at: 26.6, d: .4, color: 'black', in: .02, hold: true },
  { at: 27.0, d: .35, color: 'white' },
];
export const TITLES = [
  { name: 'open', at: 1.15, d: 1.75 },
  { name: 'kraken', at: 3.35, d: 1.6, slam: true, in: .08 },
  { name: 'charger', at: 11.1, d: 2.2, in: .12 },
  { name: 'mortar', at: 13.75, d: 1.4, in: .12 },
  { name: 'fire', at: 15.35, d: 1.5, in: .12 },
  { name: 'meteor', at: 19.15, d: 1.2, in: .12 },
  { name: 'tower', at: 20.45, d: 1.9, in: .12 },
  { name: 'end', at: 27.0, d: 3.0, in: .15, out: .2 },
];
// Music: one continuous run of beat-77 from the drop, cut dead at the black beat; accents on the cuts.
export const CUES = [
  { file: 'slam', at: .45, gain: .9 },
  { file: 'subdrop', at: .6, gain: 1.0 },
  { file: 'impact', at: .62, gain: .7 },
  { file: 'drone', at: 1.0, gain: .45, fadeIn: .3, dur: 2.2, fadeOut: .3 },
  { heartbeat: [1.25, 1.95, 2.55], gain: .5 },
  { file: 'riser', at: 3.0 - 4.75, gain: .7 },
  { file: 'braam', at: 3.0 - .15, gain: .95 },
  { file: 'eruption', at: 3.0, gain: .8 },
  { file: 'roar', at: 3.5 - .6, gain: .85 },
  { file: 'beat-77', at: 3.0, offset: 0, dur: 23.6, gain: .8, fadeOut: .01 },
  { file: 'whoosh', at: 5.0 - .95, gain: .45 },
  { file: 'slam', at: 5.3 - .15, gain: .7 },
  { file: 'whoosh', at: 6.7 - .95, gain: .4 },
  { file: 'eruption', at: 10.55, gain: .75 },
  { file: 'roar', at: 10.7 - .6, gain: .8 },
  { file: 'shield', at: 11.0, gain: .65, dur: 1.0, fadeOut: .2 },
  { file: 'charge', at: 12.62, gain: .85 },
  { file: 'impact', at: 13.55, gain: .55 },
  { file: 'whoosh', at: 13.65 - .95, gain: .5 },
  { file: 'impact', at: 14.9, gain: .5 },
  { file: 'braam', at: 19.0 - .15, gain: .85 },
  { file: 'impact', at: 19.0, gain: .75 },
  { file: 'impact', at: 20.24, gain: .45 },
  { file: 'impact', at: 21.15, gain: .45 },
  { file: 'impact', at: 21.97, gain: .6 },
  { file: 'impact', at: 22.54, gain: .5 },
  { file: 'impact', at: 23.54, gain: .45 },
  { file: 'impact', at: 24.3, gain: .5 },
  { file: 'subdrop', at: 24.54, gain: .8 },
  { file: 'roar', at: 24.9 - .6, gain: .9 },
  { file: 'reverse', at: 27.0 - 2.6, gain: .7, dur: 2.6, fadeOut: .01 },
  { file: 'braam', at: 27.0 - .1, gain: 1.0 },
  { file: 'impact', at: 27.0, gain: .85 },
  { file: 'beat-77', at: 27.0, offset: 24, dur: 3, gain: .7, fadeIn: .01, fadeOut: 1.2 },
];
