// Edit decision list (seconds). Segment: master `shot`, master range [from, to), playback `speed`
// (masters of action shots are overcranked: speed 2 = real time, 1 = half-speed slow motion),
// optional digital push `zoom` [start, end] around (zx, zy), 9:16 window centre `cx`.
// Music hits (bed-37 from 3.0 s): 3.0 eruption · 11.0 out of the water · 19.0 meteor impact · 27.0 end card.
const SEGMENTS = [
  { shot: 'rise', from: .5, to: 6.5, speed: 1, cx: .5 },                                    // 0.0  cold open → eruption
  { shot: 'tentacles', from: .15, to: 1.15, speed: 2, cx: .5, zoom: [1.15, 1.3], zy: .45 },   // 6.0  arm bursts from the pond
  { shot: 'tentacles', from: 3.9, to: 5.6, speed: 1.4, cx: .5, zoom: [1.1, 1.4], zy: .55 },   // 6.5  telegraph → slam
  { shot: 'ink', from: 1.2, to: 4.2, speed: 2, cx: .52, zoom: [1, 1.15], zy: .5 },            // 7.71 ink cone
  { shot: 'spines', from: 1.2, to: 3.6, speed: 1.6, cx: .5 },                                 // 9.21 spine volley
  { shot: 'ashore', from: 8.7, to: 11.0, speed: 1.2, cx: .5, zoom: [1.05, 1.2], zy: .45 },    // 10.71 heaves out (hit 11.0)
  { shot: 'lunge', from: 0, to: 2.0, speed: 1.3636, cx: .55, zoom: [1.0, 1.12], zx: .5, zy: .55 }, // 12.63 claw lunge
  { shot: 'mortar', from: 2.4, to: 5.7, speed: 1.8, cx: .44, zoom: [1.25, 1.45], zy: .42 },   // 14.1 mortar ring → blast
  { shot: 'fire', from: 6.6, to: 9.6, speed: 1.6, cx: .36, zoom: [1.25, 1.4], zx: .45, zy: .42 }, // 15.93 lance ignites the orbs
  { shot: 'meteor', from: 6.21, to: 10.81, speed: 1.5, cx: .55, zoom: [1.35, 1.5], zx: .6, zy: .5 }, // 17.81 meteor (impact 19.0)
  { shot: 'tower', from: .2, to: 3.6, speed: 1.7, cx: .43, zoom: [1.35, 1.5], zx: .45, zy: .52 }, // 20.88 rockets from the tower
  { shot: 'tower', from: 6.0, to: 7.6, speed: 1.2, cx: .43, zoom: [1.4, 1.55], zx: .45, zy: .5 }, // 22.88 collapse
  { shot: 'ashore', from: 10.2, to: 12.156, speed: .7, cx: .5, zoom: [1.25, 1.45], zy: .4 },  // 24.21 hero: kraken on land
  { shot: 'rise', from: 6.5, to: 9.5, speed: 1, cx: .5, zoom: [1.1, 1.25] },                 // 27.0 end card background
];
let t = 0;
export const EDL = SEGMENTS.map(s => { const seg = { ...s, at: +t.toFixed(4) }; t += (s.to - s.from) / s.speed; return seg; });
export const DURATION = 30;
export const LETTERBOX = { open: 3.0, duration: .45 };
export const FLASHES = [
  { at: 3.0, d: .3, color: 'white' },
  { at: 11.0, d: .22, color: 'white' },
  { at: 14.08, d: .16, color: 'black', in: .06 },
  { at: 19.0, d: .3, color: 'white' },
  { at: 27.0, d: .35, color: 'white' },
];
export const TITLES = [
  { name: 'open', at: .9, d: 1.9 },
  { name: 'kraken', at: 4.1, d: 1.85, slam: true, in: .08 },
  { name: 'mortar', at: 14.25, d: 1.6, in: .15 },
  { name: 'fire', at: 16.05, d: 1.65, in: .15 },
  { name: 'meteor', at: 19.15, d: 1.65, in: .12 },
  { name: 'tower', at: 21.05, d: 2.2, in: .15 },
  { name: 'end', at: 27.0, d: 3.0, in: .15, out: .2 },
];
export const CUES = [
  { file: 'drone', at: 0, gain: .75, fadeIn: .8, dur: 3.6, fadeOut: .5 },
  { heartbeat: [.45, 1.25, 1.95, 2.55], gain: .6 },
  { file: 'riser', at: 3.0 - 4.75, gain: .8 },
  { file: 'braam', at: 3.0 - .15, gain: .95 },
  { file: 'eruption', at: 3.0, gain: .8 },
  { file: 'roar', at: 4.15 - .6, gain: .9 },
  // Music: the driving 8 s phrases of bed-37 (cut on downbeats), its natural ending under the end card.
  { file: 'bed-37', at: 3.0, offset: 8, dur: 8, gain: .62, fadeOut: .01 },
  { file: 'bed-37', at: 11.0, offset: 16, dur: 8, gain: .62, fadeIn: .01, fadeOut: .01 },
  { file: 'bed-37', at: 19.0, offset: 8, dur: 8, gain: .62, fadeIn: .01, fadeOut: .01 },
  { file: 'bed-37', at: 27.0, offset: 24, dur: 3, gain: .62, fadeIn: .01, fadeOut: .6 },
  { file: 'whoosh', at: 6.0 - .95, gain: .5 },
  { file: 'slam', at: 7.29 - .15, gain: .9 },
  { file: 'whoosh', at: 8.35 - .95, gain: .55 },
  { file: 'whoosh', at: 9.5 - .95, gain: .45 },
  { file: 'eruption', at: 10.95, gain: .85 },
  { file: 'roar', at: 11.3 - .6, gain: .85 },
  { file: 'slam', at: 13.5 - .15, gain: .8 },
  { file: 'impact', at: 13.55, gain: .5 },
  { file: 'whoosh', at: 14.1 - .95, gain: .6 },
  { file: 'impact', at: 15.5, gain: .55 },
  { file: 'impact', at: 16.8, gain: .55 },
  { file: 'braam', at: 19.0 - .15, gain: .85 },
  { file: 'impact', at: 19.0, gain: .75 },
  { file: 'impact', at: 23.4, gain: .6 },
  { file: 'roar', at: 24.6 - .6, gain: .8 },
  { file: 'braam', at: 27.0 - .15, gain: 1.0 },
  { file: 'impact', at: 27.0, gain: .8 },
];
