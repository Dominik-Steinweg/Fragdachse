import sharp from 'sharp';

/**
 * Rails of the railway column (TRACK_RAIL_TEXTURE): two steel rails on transparent ground at
 * twice the world resolution, repeating along the line every 256 world pixels. Sleepers, tie
 * plates and ballast are baked into the ground by TrackGravelField; the rails stay a separate
 * sprite so they keep a crisp running surface when the camera zooms in.
 *
 * Seen from straight above: the rounded head of blue-grey rolled steel with a polished running
 * band and a dark defining edge, the flat foot flange on both sides and a soft contact shade on
 * the bed. The rails themselves run dead straight; what makes them real is their surface: a
 * running band that is brighter and duller in places, rust creeping over flanks and foot, fine
 * grain, and one bolted rail joint per rail and repeat, staggered between the two rails.
 */
const scale = 2, width = 64 * scale, length = 256, height = length * scale;
const railCenters = [13.5, 50.5];
const output = 'public/assets/sprites/track_rails.png';

let seed = 0x7a11ba5e;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const smooth = v => { const t = Math.max(0, Math.min(1, v)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a.map((value, i) => value + (b[i] - value) * t);

/** Periodic 1-D value noise along the line, so the tile repeats seamlessly. */
function noise1(cells) {
  const lattice = Float32Array.from({ length: cells }, random);
  return y => {
    const u = (y / length) * cells, i = Math.floor(u), t = smooth(u - i);
    const a = lattice[((i % cells) + cells) % cells], b = lattice[(((i + 1) % cells) + cells) % cells];
    return a + (b - a) * t;
  };
}
/** Per-texel grain, fixed by position. */
const grain = (x, y, salt) => {
  let h = Math.imul(x + 0x9e37, 0x85ebca6b) ^ Math.imul(y + 0x7f4a, 0xc2b2ae35) ^ Math.imul(salt, 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 16), 0x2545f491);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
};

// World-pixel half widths of the rail parts, measured from the rail centre line.
const RUNNING = 0.62, HEAD = 1.45, FOOT = 2.6, SHADE = 4.4;
// Blue-grey rolled steel, in the palette of the original rail art: dark flange, blue-grey head
// flanks and a polished wheel band that stays a muted steel tone, never white.
const FOOT_STEEL = [56, 69, 75], FOOT_EDGE = [36, 45, 50];
const HEAD_FLANK = [80, 101, 107], HEAD_CROWN = [112, 134, 138], POLISH = [156, 171, 171];
const EDGE_LINE = [38, 49, 54];
const RUST = [92, 70, 56], FISHPLATE = [62, 70, 74], BOLT = [104, 112, 114];
/** Rail joint: fishplate length, bolt spacing and the gap between the rail ends (world px). */
const FISHPLATE_HALF = 7.5, BOLT_SPACING = 4, JOINT_GAP = 0.35;
// Anti-aliasing width of one texture pixel, in world pixels.
const aa = 0.5 / scale;
const inside = (distance, half) => smooth((half - distance) / (2 * aa) + 0.5);

const pixels = Buffer.alloc(width * height * 4);
for (const [index, center] of railCenters.entries()) {
  const shine = noise1(23), shineFine = noise1(97), bandWidth = noise1(41);
  const flankRust = noise1(31), footRust = noise1(17), stain = noise1(131);
  const joint = length * (index ? 0.71 : 0.23);
  for (let ty = 0; ty < height; ty++) {
    const y = (ty + 0.5) / scale;
    const fromJoint = Math.abs(y - joint);
    const running = RUNNING * (0.9 + 0.22 * bandWidth(y));
    const polish = 0.82 + 0.16 * shine(y) + 0.08 * (shineFine(y) - 0.5);
    for (let tx = 0; tx < width; tx++) {
      const x = (tx + 0.5) / scale, offset = x - center, distance = Math.abs(offset);
      if (distance > SHADE + 1) continue;
      const i = (ty * width + tx) * 4;
      const fine = 0.94 + 0.12 * grain(tx, ty, index + 1);
      const foot = inside(distance, FOOT), head = inside(distance, HEAD), band = inside(distance, running);
      // Contact shade around the foot: a dark, soft fringe on the bed.
      let colour = [16, 16, 17];
      let alpha = (1 - smooth((distance - FOOT) / (SHADE - FOOT))) * 0.42;
      if (foot > 0) {
        // Flat flange, darkening into a crisp outer rim; rust gathers on it in patches.
        let flange = mix(FOOT_EDGE, FOOT_STEEL, smooth((FOOT - distance) / 0.45));
        const rust = smooth((footRust(y + offset * 3) - 0.35) / 0.4) * 0.55 * (0.7 + 0.6 * grain(tx, ty, 7));
        flange = mix(flange, RUST, rust).map(c => c * fine);
        colour = mix(colour, flange, foot);
        alpha = foot + alpha * (1 - foot);
      }
      // Rail joint: a fishplate bolted to the web on both sides. From above it covers the foot
      // beside the head and stands slightly proud of it; round bolt heads sit on it.
      if (fromJoint < FISHPLATE_HALF + 1 && distance > HEAD - 0.2 && distance < FOOT + 0.6) {
        const middle = (HEAD + FOOT + 0.3) / 2, halfWidth = (FOOT + 0.3 - HEAD) / 2;
        const across = halfWidth - Math.abs(distance - middle), along = FISHPLATE_HALF - fromJoint;
        const plate = inside(Math.abs(distance - middle), halfWidth) * inside(fromJoint, FISHPLATE_HALF);
        let steel = mix(FOOT_EDGE, FISHPLATE, smooth(Math.min(across, along) / 0.4));
        const bolt = Math.min(...[-1.5, -0.5, 0.5, 1.5].map(k => Math.hypot(y - joint - k * BOLT_SPACING, distance - middle)));
        if (bolt < 0.6) steel = mix(steel, BOLT, smooth((0.6 - bolt) / 0.25) * (bolt < 0.25 ? 0.75 : 1));
        colour = mix(colour, steel.map(c => c * fine), plate);
        alpha = plate + alpha * (1 - plate);
      }
      if (head > 0) {
        // Rounded head lit from above: brighter towards the crown, a dark line at its edge,
        // rust creeping up the flanks in places.
        let crown = mix(HEAD_FLANK, HEAD_CROWN, smooth(1 - distance / HEAD));
        crown = mix(crown, RUST, smooth((flankRust(y) - 0.5) / 0.35) * 0.32 * smooth(distance / HEAD));
        const edged = mix(EDGE_LINE, crown, smooth((HEAD - distance) / 0.35)).map(c => c * fine);
        colour = mix(colour, edged, head);
        alpha = head + alpha * (1 - head);
      }
      if (band > 0) {
        // Polished wheel band: brighter and duller stretches, a few dark specks of wear.
        const speck = grain(tx, ty, 11) > 0.985 || stain(y) > 0.82 ? 0.82 : 1;
        colour = mix(colour, POLISH.map(c => c * polish * speck * (0.97 + 0.06 * grain(tx, ty, 3))), band);
      }
      // The joint gap: the two rail ends stand a hair apart.
      if (fromJoint < JOINT_GAP + aa && distance < HEAD) colour = mix(colour, [24, 28, 30], inside(fromJoint, JOINT_GAP / 2));
      pixels[i] = Math.round(Math.min(255, colour[0]));
      pixels[i + 1] = Math.round(Math.min(255, colour[1]));
      pixels[i + 2] = Math.round(Math.min(255, colour[2]));
      pixels[i + 3] = Math.round(Math.min(1, alpha) * 255);
    }
  }
}

await sharp(pixels, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 9 }).toFile(output);
console.log(`wrote ${output} (${width}x${height})`);
