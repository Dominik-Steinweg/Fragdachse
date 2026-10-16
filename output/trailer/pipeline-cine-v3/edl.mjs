// Edit decision list V3.2 – beat-locked to the punch-347 bed (120 BPM, its phrase downbeat at file 0.605 s sits on the
// drop). Every segment lasts a whole number of beats; `hit: [masterTime, beat]` puts a master event (impact, launch,
// leap) exactly on that beat of the segment. Master ranges are in master seconds; action masters are overcranked
// (speed 2 = real time). `tag` anchors titles, cues and impact FX. Other fields: digital push `zoom` [start, end]
// around (zx, zy), roll in post `roll` [deg, deg], exposure `ev`, motion blur `blur` (frames).
export const BEAT = .5;
export const DROP = 2.0;
const BED = { file: 'punch-347', downbeat: .605 };
const DARK = { gamma: 1.3, brightness: .015, saturation: 1.06 };   // kraken pond at its fixed dusk
const DUSK = { ...DARK, gamma: 1.4 };
const DAY = { gamma: 1.04 };
const seg = (shot, beats, speed, o = {}) => {
  const from = o.hit ? o.hit[0] - o.hit[1] * BEAT * speed : o.from;
  return { shot, beats, speed, ...o, from: +from.toFixed(4), to: +(from + beats * BEAT * speed).toFixed(4) };
};
const SEGMENTS = [
  // Cold open before the drop (not beat-counted): still void pond, heartbeat.
  { tag: 'open', shot: 'rise', from: .8, to: 3.05, speed: 1.125, ev: DARK },
  // Kraken: rises, strikes, rears and fires spines, hurls its brood; it sinks, the brood swims and attacks; it comes ashore.
  seg('rise', 4, 1.25, { tag: 'drop', hit: [3.05, 0], zoom: [1.0, 1.14], ev: DARK, roll: [0, -1.4] }),
  seg('tentacles', 2, 2, { tag: 'tentacle', hit: [5.0, 1], zoom: [1.15, 1.32], zy: .45, ev: DARK }),
  seg('spinesClose', 3, 1.2, { tag: 'spines', hit: [2.55, 1], zoom: [1.1, 1.25], ev: DUSK }),
  seg('spinesClose', 3, 1.1, { tag: 'volley', hit: [4.3, 1], zoom: [1.15, 1.3], ev: DUSK, blur: 2 }),
  seg('eggsThrow', 4, 2.2, { tag: 'throw', hit: [5.7, 3], zoom: [1.05, 1.2], zy: .45, ev: DUSK }),
  seg('eggsThrow', 2, 1.8, { tag: 'hatch', hit: [7.8, .5], zoom: [1.2, 1.4], ev: DUSK }),
  seg('minisSwim', 2, 2, { tag: 'sink', from: .5, zoom: [1.05, 1.15], ev: DUSK }),
  seg('minisSwim', 4, 2, { tag: 'swim', from: 3.4, zoom: [1.2, 1.38], ev: { ...DUSK, gamma: 1.48 }, roll: [-1.2, .8] }),
  seg('minisSwim', 4, 1.6, { tag: 'leap', hit: [8.85, 1], zoom: [1.15, 1.3], ev: DUSK }),
  seg('ashore', 5, 1.2, { tag: 'ashore', hit: [9.3, 1], zoom: [1.05, 1.28], ev: DARK, roll: [1.4, -.8] }),
  seg('landInk', 3, 1.6, { tag: 'ink', hit: [2.5, 1], zoom: [1.1, 1.25], ev: DUSK }),
  // New enemies: the toad hops, lashes, heals; charger; firestarter; mortar; alien fan.
  seg('toadHop', 3, 2, { tag: 'toad', from: 1.0, zoom: [1.15, 1.3], ev: DAY }),
  seg('toadHop', 2, 1.2, { tag: 'tongue', hit: [5.0, .5], zoom: [1.25, 1.35], ev: DAY }),
  seg('toad', 3, 1.6, { tag: 'heal', from: 1.2, zoom: [1.15, 1.3], ev: DAY }),
  seg('v2:charger', 2, 1.6, { tag: 'charger', from: 4.1, zoom: [1.4, 1.55], zx: .62, zy: .48 }),
  seg('v2:charger', 2, 1.1, { tag: 'charge', hit: [6.95, .5], zoom: [1.45, 1.55], zx: .38, blur: 3 }),
  seg('fire', 3, 1.6, { tag: 'fire', hit: [3.5, 1], zoom: [1.0, 1.15], ev: DAY }),
  seg('mortar', 2, 1.6, { tag: 'mortar', from: 7.6, ev: DAY }),
  seg('mortar', 3, 1.9, { tag: 'shell', hit: [10.5, 1.5], ev: DAY, blur: 2 }),
  seg('alien', 4, 2, { tag: 'alien', hit: [3.05, 1], zoom: [1.1, 1.25], ev: { gamma: 1.12 } }),
  // Inspector Gadachs: copies → holo escalation → portals → bomber climax.
  seg('copies', 4, 2, { tag: 'copies', from: 1.0, zoom: [1.05, 1.2], ev: DAY }),
  seg('holo', 4, 2.4, { tag: 'holo', from: 10.0, zoom: [1.05, 1.15], ev: DAY, roll: [1, -1] }),
  seg('portal', 2, 2.4, { tag: 'portal', from: 5.4, zoom: [1.12, 1.32], ev: DAY }),
  seg('portal', 3, 1.6, { tag: 'exit', hit: [9.7, 1], zoom: [1.18, 1.32], ev: DAY }),
  seg('bomber', 2, 1.33, { tag: 'bomber', from: 4.2, zoom: [1.0, 1.1], ev: DAY }),
  seg('bomber', 3, 2, { tag: 'carpet', hit: [6.5, 0], zoom: [1.05, 1.18], ev: DAY, roll: [0, 1.6] }),
  // The music pulls out; the void meteor tears down; its impact whites out into the Dawn teaser.
  seg('v2:meteor', 3, 1.5, { tag: 'meteor', hit: [7.78, 2], zoom: [1.3, 1.5], zx: .36, roll: [-1, 1.4] }),
  seg('dawnLapse', 4, 2, { tag: 'dawn', from: .4, zoom: [1.0, 1.15] }),
  seg('dawnNight', 8, 2, { tag: 'night', from: 4.0, zoom: [1.05, 1.25] }),
];
let t = 0;
export const EDL = SEGMENTS.map(s => { const r = { ...s, at: +t.toFixed(4) }; t += s.beats ? s.beats * BEAT : (s.to - s.from) / s.speed; return r; });
const END = +t.toFixed(4);
/** Trailer time of a tagged segment start, or of a master time inside it. */
export const T = (tag, master) => { const s = EDL.find(e => e.tag === tag); if (!s) throw Error('tag ' + tag); return +(master === undefined ? s.at : s.at + (master - s.from) / s.speed).toFixed(3); };
/** Trailer time of a segment's hit (on the beat by construction). */
export const H = tag => { const s = EDL.find(e => e.tag === tag); return +(s.at + s.hit[1] * BEAT).toFixed(3); };
export const END_CARD = END;
export const DURATION = +(END + 3.6).toFixed(2);
export const TAIL = { shot: 'ashore', from: 11.0, to: 12.8, speed: .5, zoom: [1.1, 1.2], ev: DARK };
export const LETTERBOX = { open: DROP, duration: .45 };
const impact = H('meteor');
export const IMPACTS = [
  { at: DROP, d: .5, shake: 1.2 }, { at: H('tentacle'), d: .3 }, { at: H('spines'), d: .25, shake: .7 },
  { at: H('volley'), d: .2, shake: .6 }, { at: H('throw'), d: .2, shake: .5 }, { at: H('leap'), d: .25, shake: .7 }, { at: H('ashore'), d: .5, shake: 1.1 },
  { at: H('ink'), d: .3, shake: .8 }, { at: H('tongue'), d: .2, shake: .5 }, { at: H('charge'), d: .3 },
  { at: H('fire'), d: .25, shake: .6 }, { at: H('shell'), d: .3 }, { at: H('alien'), d: .3, shake: .8 },
  { at: H('exit'), d: .25, shake: .7 }, { at: H('carpet'), d: .5, shake: .9 }, { at: H('carpet') + 1.0, d: .3, shake: .7 },
  { at: impact, d: .7, shake: 1.5 }, { at: T('night'), d: .35, shake: .7 }, { at: END_CARD, d: .4, shake: .8 },
];
export const FLASHES = [
  { at: DROP, d: .3, color: 'white' },
  { at: H('tentacle'), d: .16, color: 'white' },
  { at: H('spines'), d: .12, color: '0xd8b8ff' },
  { at: H('ashore'), d: .22, color: '0xc9a6ff' },
  { at: H('charge'), d: .12, color: 'white' },
  { at: T('portal'), d: .14, color: 'white' },
  { at: H('carpet'), d: .16, color: '0xffd59a' },
  { at: impact, d: 1.1, color: 'white', in: .03 },     // white-out across the cut into Dawn
  { at: T('night'), d: .35, color: '0x8a0f0f' },
  { at: END_CARD, d: .3, color: 'white' },
];
export const TITLES = [
  { name: 'open', at: .15, d: 1.75 },
  { name: 'kraken', at: DROP + .3, d: 1.6 },
  { name: 'minis', at: T('hatch') + .1, d: 2.0 },
  { name: 'ashore', at: T('ashore') + .25, d: 1.9 },
  { name: 'toad', at: T('toad') + .1, d: 2.6 },
  { name: 'charger', at: T('charger') + .05, d: 1.6 },
  { name: 'fire', at: T('fire') + .05, d: 1.4 },
  { name: 'mortar', at: T('mortar') + .05, d: 2.4 },
  { name: 'alien', at: T('alien') + .05, d: 1.8 },
  { name: 'copies', at: T('copies') + .05, d: 1.9 },
  { name: 'holo', at: T('holo') + .05, d: 1.9 },
  { name: 'portal', at: T('portal') + .05, d: 2.4 },
  { name: 'bomber', at: T('bomber') + .05, d: 2.4 },
  { name: 'meteor', at: T('meteor') + .05, d: 1.0 },
  { name: 'dawnKicker', at: T('dawn') + .35, d: 1.6 },
  { name: 'dawn', at: T('night') + .9, d: +((END - T('night')) - 1.0).toFixed(2) },
  { name: 'end', at: END_CARD, d: 3.6 },
];
// Music: the bed runs from its phrase downbeat on the drop; two beats before the meteor impact it pulls out under a
// riser and reverse swell; the impact hits with braam + boom and a long tail into the Dawn bed and clock; the end
// card plays the bed's own final phrase.
const pull = impact - 2 * BEAT;
export const CUES = [
  { file: 'drone', at: 0, gain: .55, fadeIn: .3, dur: 2.1, fadeOut: .3 },
  { heartbeat: [.5, 1.0, 1.5], gain: .5 },
  { file: 'riser', at: DROP - 4.75, gain: .65 },
  { file: 'braam', at: DROP - .15, gain: .95 }, { file: 'eruption', at: DROP, gain: .75 }, { file: 'roar', at: DROP, gain: .8 },
  { file: BED.file, at: DROP, offset: BED.downbeat, dur: +(pull + .9 - DROP).toFixed(3), gain: .85, fadeOut: .9 },
  { file: 'slam', at: H('tentacle') - .12, gain: .75 },
  { file: 'whoosh', at: T('volley') - .2, gain: .4 },
  { file: 'whoosh', at: T('throw') - .3, gain: .35 },
  { file: 'stinger', at: T('swim') - .1, gain: .3 },
  { file: 'roar', at: H('ashore') - .6, gain: .95 }, { file: 'subdrop', at: H('ashore'), gain: .7 },
  { file: 'impact', at: H('ink'), gain: .45 },
  { file: 'stinger', at: T('toad') - .1, gain: .35 },
  { file: 'shield', at: T('charger'), gain: .45, dur: .9, fadeOut: .2 },
  { file: 'charge', at: H('charge') - .08, gain: .7 },
  { file: 'impact', at: H('shell'), gain: .45 },
  { file: 'stinger', at: T('copies') - .1, gain: .35 },
  { file: 'portal', at: T('portal'), gain: .5, dur: 1.4, fadeOut: .3 }, { file: 'impact', at: H('exit'), gain: .45 },
  { file: 'flyby', at: T('bomber'), gain: .7 }, { file: 'impact', at: H('carpet'), gain: .6 },
  { file: 'reverse', at: impact - 2.0, gain: .6, dur: 2.0, fadeOut: .01 },
  { file: 'riser', at: impact - 4.75, gain: .45 },
  { file: 'braam', at: impact - .12, gain: 1.0 }, { file: 'hit-low', at: impact - .02, gain: 1.0, dur: 3.0, fadeOut: 1.4 },
  { file: 'impact', at: impact, gain: .8 },
  { file: 'tick', at: T('dawn') + .1, gain: .7, dur: 1.9, fadeIn: .2, fadeOut: .2 },
  { file: 'dawn-201', at: T('dawn'), offset: 3.0, dur: +(END - T('dawn')).toFixed(3), gain: .9, fadeIn: .5, fadeOut: .4 },
  { file: 'impact', at: T('night'), gain: .6 },
  { file: 'hit-low', at: T('night') + .1, gain: .8, dur: 2.5, fadeOut: .8 },
  { file: 'riser', at: END_CARD - 4.75, gain: .4 },
  { file: 'braam', at: END_CARD - .1, gain: 1.0 }, { file: 'impact', at: END_CARD, gain: .85 },
  { file: BED.file, at: END_CARD, offset: 40.605, dur: 3.6, gain: .85, fadeIn: .01, fadeOut: 1.0 },
];
