import sharp from 'sharp';

/**
 * Rails of the railway column (TRACK_RAIL_TEXTURE): two steel rails on transparent ground at
 * twice the world resolution, repeating along the line. Sleepers, tie plates and ballast are
 * baked into the ground by TrackGravelField; the rails stay a separate sprite so they keep a
 * crisp running surface when the camera zooms in. Seen from straight above: a polished running
 * band on the rail head, darker weathered head flanks, the rusty foot flange on both sides and a
 * soft contact shade where the rail sits on the bed.
 */
const scale = 2, width = 64 * scale, height = 32 * scale;
const railCenters = [13.5, 50.5];
const output = 'public/assets/sprites/track_rails.png';

let seed = 0x7a11ba5e;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const smooth = v => { const t = Math.max(0, Math.min(1, v)); return t * t * (3 - 2 * t); };

/** Periodic 1-D value noise along the line, so the tile repeats seamlessly. */
function noise1(cells) {
  const lattice = Float32Array.from({ length: cells }, random);
  return y => {
    const u = y / height * cells, i = Math.floor(u), t = smooth(u - i);
    const a = lattice[((i % cells) + cells) % cells], b = lattice[(((i + 1) % cells) + cells) % cells];
    return a + (b - a) * t;
  };
}

// World-pixel half widths of the rail parts, measured from the rail centre line.
const RUNNING = 0.75, HEAD = 1.45, FOOT = 2.6, SHADE = 4.4;
const pixels = Buffer.alloc(width * height * 4);
const coverage = (distance, half) => smooth(half - distance + 0.5 / scale);

for (const [index, center] of railCenters.entries()) {
  const polish = noise1(4), rust = noise1(6), stain = noise1(16);
  for (let ty = 0; ty < height; ty++) {
    const y = ty + 0.5;
    // The wheel band drifts a little across the head and varies in brightness.
    const bandOffset = (polish(y) - 0.5) * 0.35 * (index ? -1 : 1);
    const bandGain = 0.88 + 0.2 * polish(y + height / 3);
    for (let tx = 0; tx < width; tx++) {
      const x = (tx + 0.5) / scale, distance = Math.abs(x - center);
      if (distance > SHADE + 1) continue;
      const i = (ty * width + tx) * 4;
      const head = coverage(distance, HEAD), foot = coverage(distance, FOOT);
      const band = coverage(Math.abs(x - center - bandOffset), RUNNING);
      // Contact shade around the foot: a dark, soft fringe on the bed.
      const shade = (1 - smooth((distance - FOOT) / (SHADE - FOOT))) * 0.42;
      let r = 18, g = 16, b = 15, a = shade;
      if (foot > 0) {
        const brown = 0.85 + 0.3 * rust(y) + 0.25 * (stain(y) - 0.5);
        const fr = 76 * brown, fg = 55 * brown, fb = 41 * brown;
        // The foot flange slopes down to its outer edge: darker towards it.
        const slope = 0.78 + 0.22 * smooth((FOOT - distance) / (FOOT - HEAD));
        r += (fr * slope - r) * foot; g += (fg * slope - g) * foot; b += (fb * slope - b) * foot;
        a = foot + a * (1 - foot);
      }
      if (head > 0) {
        // Weathered flank of the head, lit evenly from above, with a slight rounded falloff.
        const round = 0.78 + 0.22 * smooth((HEAD - distance) / HEAD);
        const hr = 104 * round, hg = 98 * round, hb = 94 * round;
        r += (hr - r) * head; g += (hg - g) * head; b += (hb - b) * head;
        a = head + a * (1 - head);
      }
      if (band > 0) {
        r += (190 * bandGain - r) * band; g += (194 * bandGain - g) * band; b += (198 * bandGain - b) * band;
      }
      pixels[i] = Math.round(Math.min(255, r));
      pixels[i + 1] = Math.round(Math.min(255, g));
      pixels[i + 2] = Math.round(Math.min(255, b));
      pixels[i + 3] = Math.round(Math.min(1, a) * 255);
    }
  }
}

await sharp(pixels, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 9 }).toFile(output);
console.log(`wrote ${output} (${width}x${height})`);
