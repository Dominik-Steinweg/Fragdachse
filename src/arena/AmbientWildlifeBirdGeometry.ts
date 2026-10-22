import { MOON_TUNING } from '../config/sunlight';
import { characterShadowOpacity } from '../effects/CharacterShadowModel';
import type { SunCloudState } from '../effects/sunlight/cloudShadow';
import { resolveMoonBase } from '../effects/sunlight/MoonSky';
import { cloudShadowAt } from '../effects/sunlight/SunFieldModel';
import { AMBIENT_WILDLIFE as TUNING } from './AmbientWildlifeConfig';
import type { BirdKind } from './AmbientWildlifeAppearance';
import { birdDrawScale, isGroundedBird } from './AmbientWildlifeBirds';
import { WildlifeMesh, type WildlifePose, type WildlifeVisual } from './AmbientWildlifeGeometry';
import type { WildlifeAnimal } from './AmbientWildlifeModel';

/**
 * Bird channels per individual (a sparrow flock repeats them per member). Geometry faces +x;
 * +y is the right wing, the inner wing of a turn with increasing angle. Each wing has an arm
 * channel and a hand channel beyond the wrist, so the hand can flex on the upstroke.
 */
const SHADOW = 0, BODY = 1, TAIL = 2, HEAD = 3, WING_L = 4, WING_R = 5, HAND_L = 6, HAND_R = 7, PARTS = 8;
const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const smooth = (t: number): number => { const c = clamp(t, 0, 1); return c * c * (3 - 2 * c); };
const frac = (v: number): number => v - Math.floor(v);
const pulse = (u: number, width: number): number => u < width ? Math.sin(Math.PI * u / width) : 0;
const angleDelta = (from: number, to: number): number => Math.atan2(Math.sin(to - from), Math.cos(to - from));

/** Per-frame presentation of one bird, written by its renderer; never stored on the animal. */
export interface BirdPresence {
  ground: number;
  low: number;
  high: number;
  tint: number;
  scale: number;
  radius: number;
  shadowX: number;
  shadowY: number;
  shadowAlpha: number;
}

export interface BirdShadowVisual extends WildlifeVisual { readonly owner: BirdVisual }
export interface BirdVisual extends WildlifeVisual {
  readonly presence: BirdPresence;
  readonly shadow: BirdShadowVisual;
  /** Drawn extent around the bird's position in mesh units, before draw scaling. */
  readonly reach: number;
}

/** Outline in units of the bird's length: the flight shadow follows exactly these points. */
interface BirdShape {
  readonly beak: number;
  readonly head: readonly [x: number, halfWidth: number];
  readonly neck: number;
  /** Right wing root (shoulder pivot); folding swings the wing back around it along the body. */
  readonly root: readonly [x: number, y: number];
  /** Right wrist line: vertices beyond its span belong to the hand, which flexes about its middle. */
  readonly wrist: readonly [x: number, y: number];
  /** Right wing (+y) from the shoulder over the tip back to the trailing root. */
  readonly wing: readonly number[];
  /** Smoothed wing outline for the flight shadow when the drawn edge is scalloped or fingered. */
  readonly shadowWing?: readonly number[];
  /** Right half of the tail from its root to the tip on the axis. */
  readonly tail: readonly number[];
}

const SHAPES: Record<BirdKind, BirdShape> = {
  sparrow: { beak: .55, head: [.3, .16], neck: .2, root: [-.03, .1], wrist: [-.05, .45],
    wing: [.14, .09, .12, .4, .02, .74, -.1, .8, -.2, .62, -.22, .3, -.2, .09], tail: [-.26, .08, -.5, .11, -.47, 0] },
  magpie: { beak: .44, head: [.27, .085], neck: .2, root: [.01, .07], wrist: [-.03, .44],
    wing: [.16, .07, .18, .2, .17, .33, .12, .46, .05, .57, -.04, .63, -.12, .62, -.18, .55, -.21, .42, -.21, .28, -.18, .15, -.13, .07],
    tail: [-.1, .05, -.35, .07, -.55, .05, -.63, 0] },
  raven: { beak: .54, head: [.3, .12], neck: .2, root: [-.02, .11], wrist: [-.05, .54],
    wing: [.12, .1, .17, .24, .2, .42, .17, .56, .11, .7, .05, .84, -.03, .88, -.12, .88, -.2, .84, -.26, .7,
      -.29, .52, -.28, .36, -.25, .22, -.19, .12],
    shadowWing: [.12, .1, .2, .42, .05, .84, .04, 1.06, -.08, 1.12, -.19, 1.03, -.29, .52, -.25, .22, -.19, .12],
    tail: [-.2, .09, -.42, .13, -.5, 0] },
  owl: { beak: .5, head: [.27, .21], neck: .12, root: [-.02, .12], wrist: [-.06, .75],
    wing: [.16, .12, .24, .3, .28, .48, .25, .62, .17, .8, .07, .96,
      .01, 1.06, -.04, 1.03, -.08, 1.12, -.12, 1.08, -.16, 1.12, -.2, 1.07, -.24, 1.07, -.27, 1,
      -.31, .92, -.29, .86, -.33, .78, -.31, .72, -.34, .64, -.32, .58, -.34, .5, -.32, .44, -.33, .36,
      -.3, .3, -.3, .22, -.26, .16, -.22, .12],
    shadowWing: [.16, .12, .26, .45, .17, .8, .02, 1.05, -.12, 1.12, -.26, 1.04, -.32, .75, -.32, .4, -.22, .12],
    tail: [-.25, .12, -.42, .1, -.45, 0] },
};

const OWL_COLORS = [
  { back: 0x6a4f36, coverts: 0x7b5b3d, flight: 0x58463a, dark: 0x34261a, pale: 0xd4c09a },
  { back: 0x6b675e, coverts: 0x78736a, flight: 0x5a5752, dark: 0x35332e, pale: 0xc8c1b0 },
] as const;

/** A wing drawn on two channels: vertices beyond the wrist ride the hand. */
interface WingChannels { readonly arm: number; readonly hand: number; readonly wrist: number }
type Channel = number | WingChannels;

function wingChannels(cb: number, side: number, shape: BirdShape): WingChannels {
  return side < 0 ? { arm: cb + WING_L, hand: cb + HAND_L, wrist: shape.wrist[1] }
    : { arm: cb + WING_R, hand: cb + HAND_R, wrist: shape.wrist[1] };
}

/** `y` in units of the bird's length, mirrored or not. */
function pick(channel: Channel, y: number): number {
  return typeof channel === 'number' ? channel : Math.abs(y) > channel.wrist ? channel.hand : channel.arm;
}

/** Convex-or-star polygon in units of `length`, fanned from its first point; `side` mirrors y. */
function fan(mesh: WildlifeMesh, points: readonly number[], length: number, channel: Channel, side = 1): void {
  const base = mesh.channels.length;
  for (let i = 0; i < points.length; i += 2) mesh.vertex(points[i] * length, points[i + 1] * length * side, pick(channel, points[i + 1]));
  for (let i = 1; i < points.length / 2 - 1; i++) mesh.indices.push(base, base + i, base + i + 1);
}

function oval(mesh: WildlifeMesh, channel: Channel, length: number, x: number, y: number, w: number, h: number, count = 10): void {
  mesh.use(pick(channel, y));
  mesh.ellipse(x * length, y * length, w * length, h * length, count);
}

function stroke(mesh: WildlifeMesh, channel: Channel, length: number, x0: number, y0: number, x1: number, y1: number, width: number): void {
  mesh.line(x0 * length, y0 * length, x1 * length, y1 * length, width * length, pick(channel, y0), pick(channel, y1));
}

function mirroredTail(shape: BirdShape): number[] {
  const out = shape.tail.slice();
  for (let i = shape.tail.length - 4; i >= 0; i -= 2) out.push(shape.tail[i], -shape.tail[i + 1]);
  return out;
}

function contactShadow(mesh: WildlifeMesh, cb: number, length: number, w: number, h: number): void {
  mesh.fill(0x1b2217, .24, 1);
  oval(mesh, cb + SHADOW, length, .03, .06, w, h, 12);
}

function drawSparrow(mesh: WildlifeMesh, cb: number, length: number, female: boolean): void {
  const shape = SHAPES.sparrow, back = female ? 0x857055 : 0x7b5a3a, covert = female ? 0x917a5c : 0x8a6a45;
  contactShadow(mesh, cb, length, .62, .42);
  mesh.fill(0x4a3a2a, 1, 1); fan(mesh, mirroredTail(shape), length, cb + TAIL);
  mesh.fill(back, 1, 1); oval(mesh, cb + BODY, length, -.02, 0, .62, .42);
  for (const side of [-1, 1]) {
    const wing = wingChannels(cb, side, shape);
    mesh.fill(covert, 1, 1); fan(mesh, shape.wing, length, wing, side);
    mesh.fill(0x3e3125, .95, 1); fan(mesh, [.04, .55, .02, .74, -.1, .8, -.2, .62, -.15, .5], length, wing, side);
    mesh.fill(0xd9d2bf, .9, 1); stroke(mesh, wing, length, .09, .28 * side, -.13, .34 * side, .05);
    mesh.fill(0x3a2a1c, .5, 1); stroke(mesh, wing, length, .11, .17 * side, -.12, .2 * side, .04);
  }
  mesh.fill(back, 1, 1); oval(mesh, cb + BODY, length, -.04, 0, .44, .17);
  mesh.fill(0x3a2a1c, .5, 1);
  for (const side of [-1, 1]) stroke(mesh, cb + BODY, length, .12, .035 * side, -.18, .045 * side, .03);
  if (female) {
    mesh.fill(0x8d7b62, 1, 1); oval(mesh, cb + HEAD, length, .3, 0, .32, .3);
    mesh.fill(0xcbbd9c, .8, 1);
    for (const side of [-1, 1]) stroke(mesh, cb + HEAD, length, .37, .085 * side, .2, .11 * side, .03);
  } else {
    mesh.fill(0x7c4a2a, 1, 1); oval(mesh, cb + HEAD, length, .27, 0, .3, .32);
    mesh.fill(0x6c6a64, 1, 1); oval(mesh, cb + HEAD, length, .33, 0, .2, .16);
  }
  mesh.fill(female ? 0x9b8a6a : 0x35302b, 1, 1);
  mesh.use(cb + HEAD); mesh.triangle(.44 * length, .05 * length, shape.beak * length, 0, .44 * length, -.05 * length);
}

function drawMagpie(mesh: WildlifeMesh, cb: number, length: number): void {
  const shape = SHAPES.magpie;
  contactShadow(mesh, cb, length, .52, .28);
  mesh.fill(0x173331, 1, 1); fan(mesh, mirroredTail(shape), length, cb + TAIL);
  mesh.fill(0x2f6b63, .45, 1); stroke(mesh, cb + TAIL, length, -.14, 0, -.56, 0, .05);
  mesh.fill(0x3b3560, .3, 1); stroke(mesh, cb + TAIL, length, -.3, .02, -.5, .015, .025);
  mesh.fill(0x15171a, 1, 1); oval(mesh, cb + BODY, length, .05, 0, .42, .22);
  for (const side of [-1, 1]) {
    const wing = wingChannels(cb, side, shape);
    mesh.fill(0x17191c, 1, 1); fan(mesh, shape.wing, length, wing, side);
    mesh.fill(0x23404a, .5, 1); fan(mesh, [.15, .08, .16, .3, -.08, .34, -.13, .08], length, wing, side);
    // White inner primaries: a bright flash in flight, a narrow edge when folded.
    mesh.fill(0xe4e4dc, .95, 1); fan(mesh, [.09, .43, .05, .54, -.03, .6, -.11, .58, -.12, .46], length, wing, side);
    mesh.fill(0x111214, 1, 1); fan(mesh, [.04, .56, -.04, .63, -.12, .62, -.09, .58], length, wing, side);
  }
  // White scapulars: two tapered shoulder patches forming the magpie's pale V.
  mesh.fill(0xe8e8e2, 1, 1);
  for (const side of [-1, 1]) fan(mesh, [.15, .045, .1, .09, .0, .115, -.09, .1, -.03, .07, .08, .05], length, cb + BODY, side);
  mesh.fill(0x15171a, 1, 1); oval(mesh, cb + BODY, length, .05, 0, .3, .08);
  oval(mesh, cb + HEAD, length, .27, 0, .17, .16);
  mesh.fill(0x0f1012, 1, 1);
  mesh.use(cb + HEAD); mesh.triangle(.34 * length, .035 * length, shape.beak * length, 0, .34 * length, -.035 * length);
}

function drawRaven(mesh: WildlifeMesh, cb: number, length: number): void {
  const shape = SHAPES.raven, black = 0x0f1014, gloss = 0x272b42, sheen = 0x353a58;
  contactShadow(mesh, cb, length, .6, .4);
  // Wedge tail with a faint central gloss.
  mesh.fill(black, 1, 1); fan(mesh, mirroredTail(shape), length, cb + TAIL);
  mesh.fill(gloss, .3, 1); fan(mesh, [-.22, .04, -.44, .06, -.48, 0, -.44, -.06, -.22, -.04], length, cb + TAIL);
  // Deep chest and broad shoulders narrowing to the rump: a bird's mass, never a plain stroke.
  mesh.fill(black, 1, 1); oval(mesh, cb + BODY, length, .06, 0, .5, .36, 16); oval(mesh, cb + BODY, length, -.14, 0, .36, .26, 14);
  for (const side of [-1, 1]) {
    const wing = wingChannels(cb, side, shape);
    mesh.fill(0x111216, 1, 1); fan(mesh, shape.wing, length, wing, side);
    // Fingered hand: six separated primaries, splayed slightly outwards.
    for (let f = 0; f < 6; f++) {
      const x = .04 - f * .043, tip = 1.02 + Math.sin(f / 5 * Math.PI) * .08, lean = (x + .06) * .12;
      fan(mesh, [x + .018, .84, x + .006 + lean, tip, x - .02 + lean, tip - .02, x - .024, .84], length, wing, side);
    }
    // Glossy coverts and feather edges give the black wing its form.
    mesh.fill(gloss, .24, 1); fan(mesh, [.12, .12, .17, .26, .19, .44, .06, .56, -.1, .52, -.15, .3, -.12, .13], length, wing, side);
    mesh.fill(sheen, .16, 1);
    for (const y of [.3, .5]) stroke(mesh, wing, length, .12, y * side, -.16, (y + .02) * side, .016);
    mesh.fill(0x24262f, .3, 1);
    for (const y of [.64, .76]) stroke(mesh, wing, length, .08, y * side, -.2, (y + .03) * side, .012);
  }
  // Mantle gloss and the shoulder highlight that catch the light from above.
  mesh.fill(gloss, .3, 1); oval(mesh, cb + BODY, length, .04, 0, .36, .16, 12);
  mesh.fill(sheen, .22, 1); oval(mesh, cb + BODY, length, .12, 0, .2, .07, 10);
  // Large head and a heavy, slightly hooked bill.
  mesh.fill(black, 1, 1); oval(mesh, cb + HEAD, length, .3, 0, .26, .24, 16);
  mesh.fill(gloss, .3, 1); oval(mesh, cb + HEAD, length, .31, -.02, .14, .09, 10);
  mesh.fill(0x16171c, 1, 1); fan(mesh, [.38, .055, .47, .035, shape.beak, 0, .47, -.035, .38, -.055], length, cb + HEAD);
  mesh.fill(0x464a63, .45, 1); stroke(mesh, cb + HEAD, length, .4, 0, .5, 0, .014);
}

function drawOwl(mesh: WildlifeMesh, cb: number, length: number, colorIndex: number): void {
  const shape = SHAPES.owl, c = OWL_COLORS[colorIndex] ?? OWL_COLORS[0];
  contactShadow(mesh, cb, length, .62, .5);
  mesh.fill(c.flight, 1, 1); fan(mesh, mirroredTail(shape), length, cb + TAIL);
  mesh.fill(c.dark, .4, 1);
  for (const x of [-.3, -.36, -.42]) stroke(mesh, cb + TAIL, length, x, .09, x, -.09, .02);
  mesh.fill(c.back, 1, 1); oval(mesh, cb + BODY, length, 0, 0, .62, .48);
  for (const side of [-1, 1]) {
    const wing = wingChannels(cb, side, shape);
    // Flight feathers: scalloped secondaries, rounded separated primaries.
    mesh.fill(c.flight, 1, 1); fan(mesh, shape.wing, length, wing, side);
    // Secondaries point backwards: shafts run chordwise, their bars run along the span.
    mesh.fill(c.dark, .22, 1);
    for (const y of [.2, .28, .36, .44, .52, .6]) stroke(mesh, wing, length, -.12, y * side, -.31, (y + .01) * side, .012);
    mesh.fill(c.dark, .42, 1);
    for (const x of [-.19, -.25]) stroke(mesh, wing, length, x, .16 * side, x - .02, .66 * side, .024);
    // Primaries fan out from the wrist; bars cross them.
    mesh.fill(c.dark, .25, 1);
    for (const [tx, ty] of [[.04, 1.02], [-.04, 1.05], [-.12, 1.06], [-.2, 1.04], [-.26, .98]])
      stroke(mesh, wing, length, .06, .74 * side, tx, ty * side, .012);
    mesh.fill(c.dark, .4, 1);
    for (const y of [.82, .92, 1]) stroke(mesh, wing, length, .14 - (y - .8) * .6, y * side, -.27 + (y - .8) * .2, (y + .02) * side, .022);
    mesh.fill(c.pale, .25, 1); stroke(mesh, wing, length, -.3, .2 * side, -.32, .9 * side, .014);
    // Coverts: the warmer, lighter arm with dark primary coverts at the wrist and rows of pale spots.
    mesh.fill(c.coverts, 1, 1);
    fan(mesh, [.16, .12, .24, .3, .28, .48, .25, .62, .18, .74, .04, .7, -.06, .6, -.12, .44, -.14, .28, -.12, .16], length, wing, side);
    mesh.fill(c.dark, .5, 1); fan(mesh, [.25, .6, .18, .76, .08, .8, .1, .66, .19, .56], length, wing, side);
    mesh.fill(c.dark, .3, 1);
    stroke(mesh, wing, length, -.12, .16 * side, -.14, .44 * side, .02); stroke(mesh, wing, length, -.14, .44 * side, .04, .7 * side, .02);
    // Scattered pale spots of different sizes, not a regular grid.
    mesh.fill(c.pale, .6, 1);
    for (const [x, y, w] of [[.12, .21, .05], [-.01, .26, .035], [.15, .35, .04], [.04, .4, .03], [.17, .5, .035], [.06, .55, .025], [-.07, .44, .025]])
      oval(mesh, wing, length, x, y * side, w, w * .6, 8);
  }
  mesh.fill(c.dark, .25, 1); oval(mesh, cb + BODY, length, -.04, 0, .34, .16);
  mesh.fill(c.pale, .85, 1);
  for (const side of [-1, 1]) {
    oval(mesh, cb + BODY, length, .1, .15 * side, .07, .04, 8); oval(mesh, cb + BODY, length, -.04, .17 * side, .07, .04, 8);
  }
  mesh.fill(c.back, 1, 1); oval(mesh, cb + HEAD, length, .27, 0, .42, .42, 16);
  mesh.fill(c.dark, .4, 1);
  oval(mesh, cb + HEAD, length, .28, .09, .07, .04, 8); oval(mesh, cb + HEAD, length, .28, -.09, .07, .04, 8);
  oval(mesh, cb + HEAD, length, .37, 0, .05, .035, 8); oval(mesh, cb + HEAD, length, .2, 0, .06, .04, 8);
  mesh.fill(c.pale, .18, 1); stroke(mesh, cb + HEAD, length, .42, 0, .2, 0, .02);
  mesh.fill(0xb9ad86, .85, 1);
  mesh.use(cb + HEAD); mesh.triangle(.46 * length, .025 * length, shape.beak * length, 0, .46 * length, -.025 * length);
}

/** Flat fan with a transparent rim; outline points ride their body part's channel. */
function drawFlightShadow(mesh: WildlifeMesh, cb: number, length: number, shape: BirdShape): void {
  const points: number[] = [], channels: number[] = [];
  const add = (x: number, y: number, channel: number): void => { points.push(x, y); channels.push(cb + channel); };
  // Star-shaped around the body centre in every pose: beak, wing, tail beyond its fanning root, tip.
  // The head's sides (an owl's look-around) and the tail root (it fans in flight) would fold the fan.
  const wing = shape.shadowWing ?? shape.wing;
  add(shape.beak, 0, HEAD);
  const wrist = shape.wrist[1];
  for (let i = 0; i < wing.length; i += 2) add(wing[i], wing[i + 1], wing[i + 1] > wrist ? HAND_R : WING_R);
  for (let i = 2; i < shape.tail.length - 2; i += 2) add(shape.tail[i], shape.tail[i + 1], TAIL);
  add(shape.tail[shape.tail.length - 2], 0, TAIL);
  for (let i = shape.tail.length - 4; i >= 2; i -= 2) add(shape.tail[i], -shape.tail[i + 1], TAIL);
  for (let i = wing.length - 2; i >= 0; i -= 2) add(wing[i], -wing[i + 1], wing[i + 1] > wrist ? HAND_L : WING_L);
  mesh.fill(0x05090c, .55, 1);
  const center = mesh.vertex(0, 0, cb + BODY), count = channels.length;
  const inner = channels.map((channel, i) => mesh.vertex(points[i * 2] * length, points[i * 2 + 1] * length, channel));
  mesh.fill(0x05090c, 0, 1);
  const rim = channels.map((channel, i) => mesh.vertex(points[i * 2] * length * 1.2, points[i * 2 + 1] * length * 1.2, channel));
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    mesh.indices.push(center, inner[i], inner[j], inner[i], rim[i], rim[j], inner[i], rim[j], inner[j]);
  }
}

function setPart(pose: WildlifePose, k: number, c: number, s: number, tx: number, ty: number,
  dx: number, dy: number, sx: number, sy: number): void {
  pose.sx = k * sx; pose.sy = k * sy; pose.c = c; pose.s = s;
  pose.x = tx + (c * dx - s * dy) * k; pose.y = ty + (s * dx + c * dy) * k;
}

/** Species flight rhythm between forced beats: 1 = flapping, 0 = gliding (sparrows: closed bound). */
function cruiseFlap(kind: BirdKind, time: number, phase: number): number {
  switch (kind) {
    case 'sparrow': return smooth((Math.sin(time * 2.1 + phase) + .35) * 3);
    // Magpies alternate short bouts of beats with glides; ravens mostly glide with slow, deep bouts.
    case 'magpie': return smooth((Math.sin(time * 1 + phase) + .1) * 2);
    case 'raven': return smooth((Math.sin(time * .45 + phase) - .15) * 2.5);
    case 'owl': return smooth((Math.sin(time * TAU / 3.7 + phase) - .25) * 3);
  }
}

/** Writes a pose in a member's frame: local rotation `angle`, scale and translation, then the member transform. */
function compose(pose: WildlifePose, k: number, cm: number, sm: number, tx: number, ty: number,
  angle: number, sx: number, sy: number, lx: number, ly: number): void {
  const c = Math.cos(angle), s = Math.sin(angle);
  pose.c = cm * c - sm * s; pose.s = sm * c + cm * s;
  pose.sx = k * sx; pose.sy = k * sy;
  pose.x = tx + (cm * lx - sm * ly) * k; pose.y = ty + (sm * lx + cm * ly) * k;
}

/**
 * One wing's arm and hand. Spread, the stroke barely shortens the span; the hand flexes back
 * about the wrist on the upstroke and reaches slightly forward on the downstroke, the way a real
 * wing beats seen from above. Banking foreshortens the inner wing; gliding leaves only a slow tip
 * flex. Folding swings the whole wing back around the shoulder and narrows it along the back.
 */
function writeWing(arm: WildlifePose, hand: WildlifePose, kind: BirdKind, shape: BirdShape, length: number, side: 1 | -1,
  wings: number, forced: number, animation: number, time: number, phase: number, bank: number,
  k = 1, cm = 1, sm = 0, tx = 0, ty = 0): void {
  const tuning = TUNING[kind], rhythm = cruiseFlap(kind, time, phase), drive = Math.max(forced, rhythm);
  const open = wings, flap = open * drive, b = clamp(bank, -1, 1) * open, inner = side * b > 0;
  // Stroke position: +1 at the top, -1 at the bottom.
  const lift = Math.cos(animation), rising = Math.max(0, -Math.sin(animation)), falling = Math.max(0, Math.sin(animation));
  // A sparrow's bounding flight pulls the wings in between bursts of beats.
  const bound = kind === 'sparrow' ? 1 - .6 * open * (1 - drive) : 1;
  const span = (.45 + .55 * open) * bound * (1 - flap * tuning.beat * lift * lift) * (1 - Math.abs(b) * (inner ? .3 : .08));
  const chord = .35 + .65 * open, fold = smooth(1 - open), angle = side * Math.PI / 2 * fold;
  const cw = Math.cos(angle), sw = Math.sin(angle);
  // Keep the shoulder in place: t = P' - R(S P), with the folded shoulder slightly back and inward.
  const px = shape.root[0] * length, py = side * shape.root[1] * length;
  const wx = px - .03 * length * fold + .03 * length * flap * falling - (cw * chord * px - sw * span * py);
  const wy = py * (1 - .15 * fold) - (sw * chord * px + cw * span * py);
  compose(arm, k, cm, sm, tx, ty, angle, chord, span, wx, wy);
  // The hand rotates about the scaled wrist inside the wing frame: back on the way up, a little
  // forward on the way down, and a slow soaring flex of the tip while gliding.
  const glide = .05 * Math.sin(time * .8 + phase * 3) * open * (1 - drive);
  const sweep = side * (open * flap * (tuning.handFlex * rising - .15 * falling) + glide);
  const qx = chord * shape.wrist[0] * length, qy = span * side * shape.wrist[1] * length;
  const cq = Math.cos(sweep), sq = Math.sin(sweep);
  const hx = qx - (cq * qx - sq * qy), hy = qy - (sq * qx + cq * qy);
  compose(hand, k, cm, sm, tx, ty, angle + sweep, chord, span, cw * hx - sw * hy + wx, sw * hx + cw * hy + wy);
}

function singleVisual(animal: WildlifeAnimal): WildlifeVisual {
  const kind = animal.kind as BirdKind, length = animal.appearance.length, shape = SHAPES[kind];
  const mesh = new WildlifeMesh();
  mesh.rotated = true;
  for (let i = 0; i < PARTS; i++) mesh.pose();
  if (kind === 'magpie') drawMagpie(mesh, 0, length);
  else if (kind === 'raven') drawRaven(mesh, 0, length);
  else drawOwl(mesh, 0, length, animal.appearance.colorIndex);
  const turnRate = TUNING[kind].turnRate;
  return {
    animal, mesh,
    sample: (time: number) => {
      const bird = animal.bird!, p = mesh.poses;
      const contact = 1 - smooth(bird.altitude / 3);
      p[SHADOW].sx = p[SHADOW].sy = contact;
      const bank = clamp(animal.turnSpeed / turnRate, -1, 1);
      setPart(p[BODY], 1, 1, 0, 0, .03 * length * bank * bird.wings, 0, 0, 1, 1);
      writeWing(p[WING_R], p[HAND_R], kind, shape, length, 1, bird.wings, bird.flap, animal.animation, time, animal.phaseOffset, bank);
      writeWing(p[WING_L], p[HAND_L], kind, shape, length, -1, bird.wings, bird.flap, animal.animation, time, animal.phaseOffset, bank);
      const grounded = isGroundedBird(bird);
      const walking = grounded && bird.walking && animal.speed > 1;
      const peck = grounded && !walking && kind !== 'owl' ? pulse(frac(time * .8 + animal.variation * 3), .22) : 0;
      let flick = 0;
      if (kind === 'magpie' && grounded) flick = pulse(frac(time * .45 + animal.variation), .12);
      setPart(p[TAIL], 1, 1, 0, 0, 0, 0, 0, 1 - .08 * flick, 1 + .3 * bird.wings);
      // Head: a stride nod, a peck, or the owl's slow look-around about the neck.
      const look = kind === 'owl' ? .45 * Math.sin(time * .37 + animal.phaseOffset) : 0;
      const nod = walking ? .035 * length * Math.sin(bird.gait * TAU) : 0;
      const bump = nod + .1 * length * peck - (bird.phase === 'mantle' ? .04 * length : 0);
      const c = Math.cos(look), s = Math.sin(look), neck = shape.neck * length;
      p[HEAD].c = c; p[HEAD].s = s; p[HEAD].sx = 1 - .12 * peck; p[HEAD].sy = 1;
      p[HEAD].x = neck - c * neck + bump; p[HEAD].y = -s * neck;
    },
  };
}

function flockVisual(animal: WildlifeAnimal): WildlifeVisual {
  const appearance = animal.appearance, length = appearance.length, count = appearance.count, spread = appearance.spread;
  const mesh = new WildlifeMesh();
  mesh.rotated = true;
  const v = animal.variation, m = TUNING.sparrowMembers;
  const order = new Float64Array(count), size = new Float64Array(count), base = new Float64Array(count);
  const radius = new Float64Array(count), phase = new Float64Array(count), peckRate = new Float64Array(count);
  const hopRate = new Float64Array(count), drinkRate = new Float64Array(count), jitter = new Float64Array(count);
  const pace = new Float64Array(count), response = new Float64Array(count), beatRate = new Float64Array(count);
  const drift = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    order[i] = frac(i * .618 + v);
    size[i] = .92 + frac(i * .37 + v * 1.7) * .16;
    base[i] = i * 2.399963 + v * TAU;
    radius[i] = spread * Math.sqrt((i + .5) / count);
    phase[i] = frac(i * .29 + v * 3.1);
    peckRate[i] = 1 / (.8 + frac(i * .71 + v) * .9);
    hopRate[i] = .35 + frac(i * .47 + v * 2.3) * .4;
    drinkRate[i] = 1 / (2.6 + frac(i * .53 + v) * .8);
    jitter[i] = frac(i * .43 + v * 5.7) - .5;
    pace[i] = 1 + (frac(i * .61 + v * 1.3) - .5) * 2 * m.speedVariation;
    response[i] = m.response * (.75 + frac(i * .83 + v) * .5);
    beatRate[i] = .85 + frac(i * .29 + v * 4.1) * .35;
    drift[i] = .6 + frac(i * .77 + v * 2.9) * .7;
  }
  // Each member's own flight (presentation only): world position, velocity, heading and wing-beat phase.
  const px = new Float64Array(count), py = new Float64Array(count), vx = new Float64Array(count), vy = new Float64Array(count);
  const heading = new Float64Array(count), beats = new Float64Array(count);
  let lastTime = Number.NaN;
  for (let i = 0; i < count * PARTS; i++) mesh.pose();
  for (let i = 0; i < count; i++) drawSparrow(mesh, i * PARTS, length, frac(i * .53 + v * 2.3) < .5);
  const shape = SHAPES.sparrow, t = TUNING.sparrow, vs = TUNING.visualScale, shore = TUNING.sparrowShore;
  const separation = length * vs * 1.1;
  return {
    animal, mesh,
    sample: (time: number) => {
      const bird = animal.bird!, p = mesh.poses, ds = birdDrawScale(bird.altitude);
      // After a gap (first frame, back in view) members start on their slots instead of chasing them.
      const elapsed = time - lastTime, reset = !(elapsed >= 0 && elapsed <= .25), dt = reset ? 0 : Math.min(elapsed, .05);
      lastTime = time;
      const cosA = Math.cos(animal.angle), sinA = Math.sin(animal.angle);
      const cf = Math.cos(bird.facing), sf = Math.sin(bird.facing);
      const flockVx = cosA * animal.speed, flockVy = sinA * animal.speed;
      const drinking = bird.originSpot >= 0 && bird.spots[bird.originSpot * 4 + 3] === 1;
      for (let i = 0; i < count; i++) {
        const lift = smooth(bird.lift * 1.6 - .6 * order[i]);
        // Ground slot relative to the formation anchor, in mesh units, world-aligned.
        let gx: number, gy: number, groundHeading: number, peck = 0, hop = 0;
        if (drinking) {
          const lateral = (i - (count - 1) / 2) * shore.lateralSpacing + jitter[i] * .6, depth = -Math.abs(jitter[i]) * 2;
          gx = cf * depth - sf * lateral; gy = sf * depth + cf * lateral;
          groundHeading = bird.facing + jitter[i] * .5;
          const u = frac(time * drinkRate[i] + phase[i]);
          peck = u < .34 ? Math.min(1, Math.sin(Math.PI * u / .34) * 1.6) : 0;
        } else {
          const sx = Math.cos(base[i]) * radius[i], sy = Math.sin(base[i]) * radius[i];
          const cycle = time * hopRate[i] + phase[i] * 7, step = Math.floor(cycle), u = cycle - step;
          const s = step + smooth((u - .82) / .18);
          hop = u > .82 ? Math.sin(Math.PI * (u - .82) / .18) : 0;
          gx = cf * sx - sf * sy + Math.cos(.9 * s + i) * 1.6;
          gy = sf * sx + cf * sy + Math.sin(1.3 * s + 2 * i) * 1.2;
          groundHeading = Math.atan2(1.3 * Math.cos(1.3 * s + 2 * i) * 1.2, -.9 * Math.sin(.9 * s + i) * 1.6);
          if (!hop) peck = pulse(frac(time * peckRate[i] + phase[i]), .18);
        }
        const groundX = bird.originX + gx * vs, groundY = bird.originY + gy * vs;
        // A loose formation: every member keeps its own slot and drifts inside it at its own pace.
        const fx = Math.cos(base[i]) * radius[i] * m.formationSpread * .7 + Math.sin(time * drift[i] + i * 1.3) * m.wander;
        const fy = Math.sin(base[i]) * radius[i] * m.formationSpread + Math.cos(time * drift[i] * 1.3 + i * 2.1) * m.wander;
        const slotX = animal.x + (cosA * fx - sinA * fy) * ds, slotY = animal.y + (sinA * fx + cosA * fy) * ds;
        const targetX = groundX + (slotX - groundX) * lift, targetY = groundY + (slotY - groundY) * lift;
        const toGround = Math.hypot(px[i] - groundX, py[i] - groundY);
        // A member stays airborne until it has reached its own spot, then folds its wings there.
        const airborne = !reset && (lift > 0 || toGround > 1.5);
        if (!airborne) {
          px[i] = reset ? targetX : groundX; py[i] = reset ? targetY : groundY;
          vx[i] = reset ? flockVx * lift : 0; vy[i] = reset ? flockVy * lift : 0;
        } else {
          // Chase the slot: the flock's own motion plus a spring, capped by this member's speed and acceleration.
          let wantX = flockVx * lift + (targetX - px[i]) * response[i], wantY = flockVy * lift + (targetY - py[i]) * response[i];
          // Airborne members keep a little personal space instead of sliding through each other.
          for (let j = 0; j < count; j++) {
            if (j === i) continue;
            const ox = px[i] - px[j], oy = py[i] - py[j], d = Math.hypot(ox, oy);
            if (d > 0 && d < separation) { wantX += ox / d * (separation - d) * 8 * lift; wantY += oy / d * (separation - d) * 8 * lift; }
          }
          const limit = t.fleeSpeed * 1.25 * pace[i], want = Math.hypot(wantX, wantY);
          if (want > limit) { wantX *= limit / want; wantY *= limit / want; }
          const blend = Math.min(1, dt * m.accel);
          vx[i] += (wantX - vx[i]) * blend; vy[i] += (wantY - vy[i]) * blend;
          px[i] += vx[i] * dt; py[i] += vy[i] * dt;
        }
        const speed = Math.hypot(vx[i], vy[i]);
        const open = airborne ? Math.max(lift, clamp(toGround / 14, 0, 1)) : reset ? lift : 0;
        const wanted = open > 0 && speed > 6 ? Math.atan2(vy[i], vx[i]) : open > .5 ? animal.angle : groundHeading;
        const delta = angleDelta(heading[i], wanted);
        const turn = reset ? delta : clamp(delta, -m.turnRate * dt, m.turnRate * dt);
        heading[i] += turn;
        if (open > 0) beats[i] += dt * t.flapHz * TAU * beatRate[i];
        const bank = dt > 0 ? turn / dt / m.turnRate : 0;
        // Members brake with beats while settling onto their spot.
        const forced = Math.max(bird.flap, airborne && lift < 1 && toGround < 30 ? 1 : 0);
        const dx = (px[i] - animal.x) / ds, dy = (py[i] - animal.y) / ds;
        const lx = cosA * dx + sinA * dy, ly = -sinA * dx + cosA * dy;
        const theta = heading[i] - animal.angle, c = Math.cos(theta), s = Math.sin(theta), k = size[i];
        const cb = i * PARTS, hopScale = 1 + .08 * hop, rhythm = time + i * 1.7;
        setPart(p[cb + SHADOW], k, c, s, lx, ly, 0, 0, 1 - open, 1 - open);
        setPart(p[cb + BODY], k, c, s, lx, ly, 0, 0, hopScale, hopScale);
        setPart(p[cb + TAIL], k, c, s, lx, ly, 0, 0, 1, 1 + .3 * open);
        setPart(p[cb + HEAD], k, c, s, lx, ly, (drinking ? .12 : .1) * length * peck * (1 - open), 0, 1 - .15 * peck * (1 - open), 1);
        writeWing(p[cb + WING_R], p[cb + HAND_R], 'sparrow', shape, length, 1, open, forced * open, beats[i], rhythm, animal.phaseOffset, bank, k, c, s, lx, ly);
        writeWing(p[cb + WING_L], p[cb + HAND_L], 'sparrow', shape, length, -1, open, forced * open, beats[i], rhythm, animal.phaseOffset, bank, k, c, s, lx, ly);
      }
    },
  };
}

/** The flight shadow shares the bird's animated poses, so it follows every beat, bank and member. */
function withPresence(visual: WildlifeVisual): BirdVisual {
  const animal = visual.animal, kind = animal.kind as BirdKind, shape = SHAPES[kind];
  const length = animal.appearance.length, flock = kind === 'sparrow';
  const shadowMesh = new WildlifeMesh();
  shadowMesh.rotated = true;
  shadowMesh.poses = visual.mesh.poses;
  for (let i = 0; i < animal.appearance.count; i++) drawFlightShadow(shadowMesh, i * PARTS, length, shape);
  let span = 0;
  for (const wing of [shape.wing, shape.shadowWing ?? shape.wing]) for (let i = 1; i < wing.length; i += 2) span = Math.max(span, wing[i]);
  // A flock spreads out in flight and members lag behind their slots for a moment.
  const m = TUNING.sparrowMembers;
  const reach = flock ? animal.appearance.spread * m.formationSpread * 1.3 + m.wander + length + 12 : (span + .1) * length;
  const presence: BirdPresence = { ground: 0, low: 0, high: 0, tint: 0xffffff, scale: TUNING.visualScale,
    radius: reach * TUNING.visualScale, shadowX: 0, shadowY: 0, shadowAlpha: 0 };
  const bird = { ...visual, presence, reach } as BirdVisual & { shadow: BirdShadowVisual };
  bird.shadow = { animal, mesh: shadowMesh, owner: bird, sample: () => {} };
  return bird;
}

/** Built under the loading veil with the World; flocks own their member geometry, nothing is shared. */
export function prepareBirdVisuals(animals: readonly WildlifeAnimal[]): BirdVisual[] {
  return animals.filter(a => a.bird).map(a => withPresence(a.kind === 'sparrow' ? flockVisual(a) : singleVisual(a)));
}

/** Flight shadows stretch with low sun, but never further than this from their bird. */
export const MAX_BIRD_SHADOW_REACH = 220;
const MAX_SHADOW_REACH = MAX_BIRD_SHADOW_REACH;

/**
 * Offset and opacity of an airborne bird's ground shadow: by day along the sun like a held weapon's
 * shadow, fading under clouds and with height; at night a faint moon shadow; none on the ground.
 */
export function projectBirdShadow(height: number, x: number, y: number, sunlight: SunCloudState | undefined, minutes: number,
  out: { x: number; y: number; alpha: number }, moonScratch = { weight: 0, cover: 0 }): typeof out {
  out.x = out.y = out.alpha = 0;
  const sun = sunlight?.sunPath;
  if (!(height >= 1) || !sun || !sunlight) return out;
  const fade = clamp((height - 1) / 3, 0, 1) * (1 - .45 * clamp(height / 130, 0, 1));
  const day = sun.strength > 0 && sun.elevation > 0 ? characterShadowOpacity(sun.strength, sun.elevation) : 0;
  if (day > 0) {
    const reach = Math.min(MAX_SHADOW_REACH, height / Math.tan(Math.max(sun.elevation, .26)));
    out.x = -sun.direction[0] * reach; out.y = -sun.direction[1] * reach;
    out.alpha = day * cloudShadowAt(x + out.x, y + out.y, sunlight) * fade;
    return out;
  }
  const moon = resolveMoonBase(minutes, moonScratch).weight;
  if (moon <= 0) return out;
  const cast = sun.castAzimuth * Math.PI / 180;
  const reach = Math.min(MAX_SHADOW_REACH, height / Math.tan(MOON_TUNING.elevationDegrees * Math.PI / 180));
  out.x = -Math.cos(cast) * reach; out.y = Math.sin(cast) * reach;
  out.alpha = .12 * moon * fade;
  return out;
}
