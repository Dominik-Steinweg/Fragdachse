import { AMBIENT_WILDLIFE as TUNING } from './AmbientWildlifeConfig';
import type { BirdKind } from './AmbientWildlifeAppearance';
import { birdDrawScale, isGroundedBird } from './AmbientWildlifeBirds';
import { WildlifeMesh, type WildlifePose, type WildlifeVisual } from './AmbientWildlifeGeometry';
import type { WildlifeAnimal } from './AmbientWildlifeModel';

/**
 * Bird channels per individual (a sparrow flock repeats them per member). Geometry faces +x;
 * +y is the right wing, the inner wing of a turn with increasing angle.
 */
const SHADOW = 0, BODY = 1, TAIL = 2, HEAD = 3, WING_L = 4, WING_R = 5, PARTS = 6;
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
  /** Right wing (+y) from the shoulder over the tip back to the trailing root. */
  readonly wing: readonly number[];
  /** Right half of the tail from its root to the tip on the axis. */
  readonly tail: readonly number[];
}

const SHAPES: Record<BirdKind, BirdShape> = {
  sparrow: { beak: .55, head: [.3, .16], neck: .2, root: [-.03, .1],
    wing: [.14, .09, .12, .4, .02, .74, -.1, .8, -.2, .62, -.22, .3, -.2, .09], tail: [-.26, .08, -.5, .11, -.47, 0] },
  magpie: { beak: .44, head: [.27, .085], neck: .2, root: [.01, .07],
    wing: [.16, .07, .15, .3, .07, .56, -.06, .63, -.17, .56, -.19, .3, -.13, .07], tail: [-.1, .05, -.35, .07, -.55, .05, -.63, 0] },
  raven: { beak: .5, head: [.28, .1], neck: .18, root: [-.01, .08],
    wing: [.14, .08, .12, .5, .04, .86, -.06, 1.04, -.16, .9, -.22, .5, -.16, .08], tail: [-.15, .07, -.36, .1, -.44, 0] },
  owl: { beak: .5, head: [.27, .21], neck: .12, root: [-.02, .12],
    wing: [.16, .12, .22, .35, .22, .6, .16, .85, .06, 1.04, -.06, 1.13, -.18, 1.1, -.27, .98, -.31, .75, -.29, .45, -.22, .12],
    tail: [-.25, .12, -.42, .1, -.45, 0] },
};

const OWL_COLORS = [
  { back: 0x6a4f36, dark: 0x3f2e20, pale: 0xc6b08c },
  { back: 0x6b675e, dark: 0x3e3b35, pale: 0xbdb6a6 },
] as const;

/** Convex-or-star polygon in units of `length`, fanned from its first point; `side` mirrors y. */
function fan(mesh: WildlifeMesh, points: readonly number[], length: number, channel: number, side = 1): void {
  const base = mesh.channels.length;
  for (let i = 0; i < points.length; i += 2) mesh.vertex(points[i] * length, points[i + 1] * length * side, channel);
  for (let i = 1; i < points.length / 2 - 1; i++) mesh.indices.push(base, base + i, base + i + 1);
}

function oval(mesh: WildlifeMesh, channel: number, length: number, x: number, y: number, w: number, h: number, count = 10): void {
  mesh.use(channel);
  mesh.ellipse(x * length, y * length, w * length, h * length, count);
}

function stroke(mesh: WildlifeMesh, channel: number, length: number, x0: number, y0: number, x1: number, y1: number, width: number): void {
  mesh.line(x0 * length, y0 * length, x1 * length, y1 * length, width * length, channel, channel);
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
    const wing = cb + (side < 0 ? WING_L : WING_R);
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
    mesh.fill(0x6f7273, 1, 1); oval(mesh, cb + HEAD, length, .33, 0, .2, .16);
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
    const wing = cb + (side < 0 ? WING_L : WING_R);
    mesh.fill(0x17191c, 1, 1); fan(mesh, shape.wing, length, wing, side);
    mesh.fill(0x23404a, .5, 1); fan(mesh, [.14, .08, .12, .3, -.08, .32, -.12, .08], length, wing, side);
    // White inner primaries: a bright flash in flight, a narrow edge when folded.
    mesh.fill(0xe4e4dc, .95, 1); fan(mesh, [.06, .42, .05, .54, -.03, .59, -.1, .55, -.07, .44], length, wing, side);
    mesh.fill(0x111214, 1, 1); fan(mesh, [.05, .55, .06, .58, -.06, .64, -.1, .57], length, wing, side);
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
  const shape = SHAPES.raven;
  contactShadow(mesh, cb, length, .52, .3);
  mesh.fill(0x111216, 1, 1); fan(mesh, mirroredTail(shape), length, cb + TAIL);
  mesh.fill(0x2b2e4a, .35, 1); stroke(mesh, cb + TAIL, length, -.18, 0, -.4, 0, .05);
  mesh.fill(0x111216, 1, 1); oval(mesh, cb + BODY, length, .04, 0, .48, .23);
  for (const side of [-1, 1]) {
    const wing = cb + (side < 0 ? WING_L : WING_R);
    mesh.fill(0x121318, 1, 1); fan(mesh, shape.wing, length, wing, side);
    // Separated primaries: the fingered hand that identifies a raven from above.
    for (let f = 0; f < 5; f++) {
      const x = .03 - f * .05;
      fan(mesh, [x + .02, .84, x - .025, 1.1 - f * .02, x - .045, 1.06 - f * .02, x - .03, .84], length, wing, side);
    }
    mesh.fill(0x2b2e4a, .22, 1); fan(mesh, [.12, .1, .1, .42, -.1, .44, -.14, .1], length, wing, side);
  }
  mesh.fill(0x2b2e4a, .2, 1); oval(mesh, cb + BODY, length, .06, 0, .3, .08);
  mesh.fill(0x111216, 1, 1); oval(mesh, cb + HEAD, length, .28, 0, .2, .18);
  mesh.fill(0x18191d, 1, 1);
  mesh.use(cb + HEAD); mesh.triangle(.35 * length, .05 * length, shape.beak * length, 0, .35 * length, -.05 * length);
  mesh.fill(0x3a3d55, .4, 1); stroke(mesh, cb + HEAD, length, .37, 0, .47, 0, .015);
}

function drawOwl(mesh: WildlifeMesh, cb: number, length: number, colorIndex: number): void {
  const shape = SHAPES.owl, c = OWL_COLORS[colorIndex] ?? OWL_COLORS[0];
  contactShadow(mesh, cb, length, .62, .5);
  mesh.fill(c.back, 1, 1); fan(mesh, mirroredTail(shape), length, cb + TAIL);
  mesh.fill(c.dark, .4, 1);
  for (const x of [-.3, -.36, -.42]) stroke(mesh, cb + TAIL, length, x, .09, x, -.09, .02);
  mesh.fill(c.back, 1, 1); oval(mesh, cb + BODY, length, 0, 0, .62, .48);
  for (const side of [-1, 1]) {
    const wing = cb + (side < 0 ? WING_L : WING_R);
    mesh.fill(c.back, 1, 1); fan(mesh, shape.wing, length, wing, side);
    // Darker hand with fine bars across the flight feathers; pale spots on the coverts.
    mesh.fill(c.dark, .35, 1);
    fan(mesh, [.14, .78, .16, .85, .06, 1.04, -.06, 1.13, -.18, 1.1, -.27, .98, -.3, .8], length, wing, side);
    mesh.fill(c.dark, .32, 1);
    for (const y of [.5, .62, .74, .86, .98]) stroke(mesh, wing, length, .18 - (y - .5) * .25, y * side, -.27 + (y - .5) * .12, (y + .03) * side, .022);
    mesh.fill(c.pale, .2, 1);
    for (const y of [.56, .68, .8, .92]) stroke(mesh, wing, length, .1 - (y - .5) * .2, (y + .05) * side, -.05 - (y - .5) * .2, (y + .06) * side, .016);
    mesh.fill(c.pale, .8, 1);
    oval(mesh, wing, length, .08, .2 * side, .07, .04, 8); oval(mesh, wing, length, -.06, .26 * side, .06, .035, 8);
    oval(mesh, wing, length, .1, .36 * side, .06, .035, 8); oval(mesh, wing, length, -.02, .42 * side, .05, .03, 8);
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
  mesh.fill(c.pale, .5, 1); stroke(mesh, cb + HEAD, length, .44, 0, .16, 0, .03);
  mesh.fill(0xb9ad86, .85, 1);
  mesh.use(cb + HEAD); mesh.triangle(.46 * length, .025 * length, shape.beak * length, 0, .46 * length, -.025 * length);
}

/** Flat fan with a transparent rim; outline points ride their body part's channel. */
function drawFlightShadow(mesh: WildlifeMesh, cb: number, length: number, shape: BirdShape): void {
  const points: number[] = [], channels: number[] = [];
  const add = (x: number, y: number, channel: number): void => { points.push(x, y); channels.push(cb + channel); };
  add(shape.beak, 0, HEAD);
  add(shape.head[0], shape.head[1], HEAD);
  for (let i = 0; i < shape.wing.length; i += 2) add(shape.wing[i], shape.wing[i + 1], WING_R);
  for (let i = 0; i < shape.tail.length - 2; i += 2) add(shape.tail[i], shape.tail[i + 1], TAIL);
  add(shape.tail[shape.tail.length - 2], 0, TAIL);
  for (let i = shape.tail.length - 4; i >= 0; i -= 2) add(shape.tail[i], -shape.tail[i + 1], TAIL);
  for (let i = shape.wing.length - 2; i >= 0; i -= 2) add(shape.wing[i], -shape.wing[i + 1], WING_L);
  add(shape.head[0], -shape.head[1], HEAD);
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
    case 'magpie': return smooth((Math.sin(time * 1.3 + phase) + .2) * 2);
    case 'raven': return smooth((Math.sin(time * .7 + phase) + .5) * 2);
    case 'owl': return smooth((Math.sin(time * TAU / 3.7 + phase) - .25) * 3);
  }
}

/**
 * One wing's channel: spread, it beats (shorter projected span at the stroke ends) and banks
 * (inner wing foreshortened); folding swings it back around the shoulder and narrows it, so a
 * resting bird shows its folded wings along the back. Composed with a flock member's transform.
 */
function writeWing(pose: WildlifePose, kind: BirdKind, shape: BirdShape, length: number, side: 1 | -1,
  wings: number, forced: number, animation: number, time: number, phase: number, bank: number,
  k = 1, cm = 1, sm = 0, tx = 0, ty = 0): void {
  const rhythm = cruiseFlap(kind, time, phase), drive = Math.max(forced, rhythm);
  // A sparrow's bounding flight half-folds the wings between bursts of beats.
  const open = wings * (kind === 'sparrow' ? .3 + .7 * drive : 1);
  const flap = open * drive, beat = Math.sin(animation), b = clamp(bank, -1, 1) * open;
  const inner = side * b > 0;
  const span = (.45 + .55 * open) * (1 - flap * .3 * beat * beat) * (1 - Math.abs(b) * (inner ? .3 : .08));
  const chord = .35 + .65 * open, fold = smooth(1 - open), angle = side * Math.PI / 2 * fold;
  const cw = Math.cos(angle), sw = Math.sin(angle);
  // Keep the shoulder in place: t = P' - R(S P), with the folded shoulder slightly back and inward.
  const px = shape.root[0] * length, py = side * shape.root[1] * length;
  const wx = px - .03 * length * fold + .05 * length * flap * Math.sin(animation + .6) - (cw * chord * px - sw * span * py);
  const wy = py * (1 - .15 * fold) - (sw * chord * px + cw * span * py);
  pose.c = cm * cw - sm * sw; pose.s = sm * cw + cm * sw;
  pose.sx = k * chord; pose.sy = k * span;
  pose.x = tx + (cm * wx - sm * wy) * k; pose.y = ty + (sm * wx + cm * wy) * k;
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
      writeWing(p[WING_R], kind, shape, length, 1, bird.wings, bird.flap, animal.animation, time, animal.phaseOffset, bank);
      writeWing(p[WING_L], kind, shape, length, -1, bird.wings, bird.flap, animal.animation, time, animal.phaseOffset, bank);
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
  const v = animal.variation;
  const order = new Float64Array(count), size = new Float64Array(count), base = new Float64Array(count);
  const radius = new Float64Array(count), phase = new Float64Array(count), peckRate = new Float64Array(count);
  const hopRate = new Float64Array(count), drinkRate = new Float64Array(count), jitter = new Float64Array(count);
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
  }
  for (let i = 0; i < count * PARTS; i++) mesh.pose();
  for (let i = 0; i < count; i++) drawSparrow(mesh, i * PARTS, length, frac(i * .53 + v * 2.3) < .5);
  const shape = SHAPES.sparrow;
  const turnRate = TUNING.sparrow.turnRate, vs = TUNING.visualScale, shore = TUNING.sparrowShore;
  return {
    animal, mesh,
    sample: (time: number) => {
      const bird = animal.bird!, p = mesh.poses, ds = birdDrawScale(bird.altitude);
      const cosA = Math.cos(animal.angle), sinA = Math.sin(animal.angle);
      const cf = Math.cos(bird.facing), sf = Math.sin(bird.facing);
      const drinking = bird.originSpot >= 0 && bird.spots[bird.originSpot * 4 + 3] === 1;
      for (let i = 0; i < count; i++) {
        const lift = smooth(bird.lift * 1.6 - .6 * order[i]);
        // Ground slot relative to the formation anchor, in mesh units, world-aligned.
        let gx: number, gy: number, heading: number, peck = 0, hop = 0;
        if (drinking) {
          const lateral = (i - (count - 1) / 2) * shore.lateralSpacing + jitter[i] * .6, depth = -Math.abs(jitter[i]) * 2;
          gx = cf * depth - sf * lateral; gy = sf * depth + cf * lateral;
          heading = bird.facing + jitter[i] * .5;
          const u = frac(time * drinkRate[i] + phase[i]);
          peck = u < .34 ? Math.min(1, Math.sin(Math.PI * u / .34) * 1.6) : 0;
        } else {
          const sx = Math.cos(base[i]) * radius[i], sy = Math.sin(base[i]) * radius[i];
          const cycle = time * hopRate[i] + phase[i] * 7, step = Math.floor(cycle), u = cycle - step;
          const s = step + smooth((u - .82) / .18);
          hop = u > .82 ? Math.sin(Math.PI * (u - .82) / .18) : 0;
          gx = cf * sx - sf * sy + Math.cos(.9 * s + i) * 1.6;
          gy = sf * sx + cf * sy + Math.sin(1.3 * s + 2 * i) * 1.2;
          heading = Math.atan2(1.3 * Math.cos(1.3 * s + 2 * i) * 1.2, -.9 * Math.sin(.9 * s + i) * 1.6);
          if (!hop) peck = pulse(frac(time * peckRate[i] + phase[i]), .18);
        }
        const groundX = bird.originX + gx * vs, groundY = bird.originY + gy * vs;
        // Loose flight slot behind the leader's heading, with a slight wobble.
        const fx = Math.cos(base[i]) * radius[i] * 1.26 + Math.sin(time * 1.7 + i) * 1.0;
        const fy = Math.sin(base[i]) * radius[i] * 1.8 + Math.cos(time * 1.3 + 2 * i) * 1.0;
        const flightX = animal.x + (cosA * fx - sinA * fy) * ds, flightY = animal.y + (sinA * fx + cosA * fy) * ds;
        const wx = groundX + (flightX - groundX) * lift, wy = groundY + (flightY - groundY) * lift;
        const memberHeading = heading + angleDelta(heading, animal.angle + Math.sin(time * 1.1 + i * 1.7) * .12) * lift;
        const dx = (wx - animal.x) / ds, dy = (wy - animal.y) / ds;
        const lx = cosA * dx + sinA * dy, ly = -sinA * dx + cosA * dy;
        const theta = memberHeading - animal.angle, c = Math.cos(theta), s = Math.sin(theta), k = size[i];
        const cb = i * PARTS;
        const bank = animal.turnSpeed / turnRate, beat = animal.animation + i * .9, rhythm = time + i * .31;
        const hopScale = 1 + .08 * hop;
        setPart(p[cb + SHADOW], k, c, s, lx, ly, 0, 0, 1 - lift, 1 - lift);
        setPart(p[cb + BODY], k, c, s, lx, ly, 0, 0, hopScale, hopScale);
        setPart(p[cb + TAIL], k, c, s, lx, ly, 0, 0, 1, 1 + .3 * lift);
        setPart(p[cb + HEAD], k, c, s, lx, ly, (drinking ? .12 : .1) * length * peck, 0, 1 - .15 * peck, 1);
        writeWing(p[cb + WING_R], 'sparrow', shape, length, 1, lift, bird.flap * lift, beat, rhythm, animal.phaseOffset, bank, k, c, s, lx, ly);
        writeWing(p[cb + WING_L], 'sparrow', shape, length, -1, lift, bird.flap * lift, beat, rhythm, animal.phaseOffset, bank, k, c, s, lx, ly);
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
  for (let i = 1; i < shape.wing.length; i += 2) span = Math.max(span, shape.wing[i]);
  // Raven fingers reach a little beyond the outline's tip; a flock spreads out in flight.
  const reach = flock ? animal.appearance.spread * 2 + 3 + length : (span + .1) * length;
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
