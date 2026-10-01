import { slateFormationGeometry } from './slate-formation-geometry.mjs';

/** Periodic rock relief authored from intersecting angular mineral plates.
 * All distances/heights are world pixels; material RGB and gameplay cells are
 * deliberately absent. Opposing planes create broad faces and chipped shoulders
 * without nested copies of the directional V5 sculpt or fine noise spikes. */
export function slateV7Geometry(size = 512, seed = 74931, variant = 'medium') {
  if (!Number.isInteger(size) || size < 32) throw new Error('V7 relief requires an integer period of at least 32');
  const variants = {
    broad: { spacing: 55, amplitude: 13, chips: 1, shoulder: .60 },
    medium: { spacing: 43, amplitude: 11, chips: 2, shoulder: .68 },
    broken: { spacing: 35, amplitude: 9.5, chips: 3, shoulder: .72 },
  };
  const spec = variants[variant];
  if (!spec) throw new Error(`Unknown V7 relief variant: ${variant}`);
  let rng = seed >>> 0;
  const random = () => ((rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0) / 4294967296);
  const wrap = value => (value % size + size) % size;
  const field = new Float32Array(size * size);
  const variation = new Float32Array(size * size).fill(.94);
  const layers = [
    { spacing: 107, amplitude: 5, chips: 0, shoulder: .2, weight: 1 },
    { ...spec, weight: 1 },
    { spacing: 21, amplitude: 2, chips: 1, shoulder: .16, weight: .85 },
  ];
  for (const layer of layers) {
    const cells = Math.max(2, Math.round(size / layer.spacing));
    const step = size / cells;
    const surface = new Float32Array(size * size).fill(-layer.amplitude);
    for (let gy = 0; gy < cells; gy++) for (let gx = 0; gx < cells; gx++) {
      const cx = (gx + .03 + random() * .94) * step;
      const cy = (gy + .03 + random() * .94) * step;
      const angle = random() * Math.PI * 2;
      const radius = step * (.55 + random() * .59);
      const peak = layer.amplitude * (.65 + random() * .45);
      const topSlope = (.07 + random() * .21) * (layer.amplitude / 13);
      const topX = Math.cos(angle) * topSlope, topY = Math.sin(angle) * topSlope;
      const sides = 5 + Math.floor(random() * 3);
      const planes = Array.from({ length: sides }, (_, side) => {
        const a = angle + (side + (random() - .5) * .42) * Math.PI * 2 / sides;
        return { x: Math.cos(a), y: Math.sin(a), inset: radius * (.64 + random() * .36),
          slope: layer.shoulder * (.65 + random() * .75), offset: 0 };
      });
      // Shallow corner truncations cut off parts of a large face, rather than
      // laying a bevel or dark crevice around every visible polygon.
      for (let chip = 0; chip < layer.chips; chip++) {
        const a = angle + random() * Math.PI * 2;
        planes.push({ x: Math.cos(a), y: Math.sin(a), inset: radius * (.10 + random() * .40),
          slope: .25 + random() * .42, offset: peak * (.50 + random() * .40) });
      }
      const reach = Math.ceil(radius * 1.9);
      for (let y = Math.floor(cy - reach); y <= cy + reach; y++) {
        for (let x = Math.floor(cx - reach); x <= cx + reach; x++) {
          const dx = x + .5 - cx, dy = y + .5 - cy;
          let z = peak + dx * topX + dy * topY;
          for (const p of planes) z = Math.min(z, p.offset + (p.inset - dx * p.x - dy * p.y) * p.slope);
          const i = wrap(y) * size + wrap(x);
          surface[i] = Math.max(surface[i], z);
        }
      }
    }
    for (let i = 0; i < field.length; i++) field[i] += (surface[i] - layer.amplitude * .45) * layer.weight;
  }
  return { field, variation };
}

/** Preserve the medium plate arrangement with shallower crevices and restrained
 * angular subfaces. Geometry remains independent of mineral colour and light. */
export function slateV7WeatheredGeometry(size = 256, seed = 74931, scale = .60, chips = .90) {
  const original = slateV7Geometry(size, seed, 'medium');
  const detail = slateFormationGeometry(size, seed ^ 87231, [[19, 3.5, .9], [10, 1.2, .4]]);
  return { field: Float32Array.from(original.field, (z, i) => z * scale + detail.field[i] * chips),
    variation: original.variation };
}
