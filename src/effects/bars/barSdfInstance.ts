/**
 * Pure CPU side of the shared bar SDF program (see `barSdfShader.ts`). Owners describe each bar
 * as one or more instances in their own local units; the GPU submitter only transforms the quad
 * corners and copies these words. Nothing here touches Phaser, so tests can assert the exact
 * presentation contract headlessly.
 */
export const BAR_SDF_KIND = { trough: 0, fill: 1, world: 2, living: 3 } as const;
export type BarSdfKind = typeof BAR_SDF_KIND[keyof typeof BAR_SDF_KIND];

/** Floats per vertex: position 2, local 2, size 4, A 4, B 4, meta 2, four packed RGBA colours. */
export const BAR_SDF_VERTEX_WORDS = 22;
export const BAR_SDF_VERTICES = 4;
export const BAR_SDF_INDICES = 6;
export const BAR_SDF_INSTANCE_WORDS = BAR_SDF_VERTEX_WORDS * BAR_SDF_VERTICES;

/**
 * One rounded rectangle in its owner's local units. `x`/`y` place the rectangle in that space;
 * `margin` grows the quad for outer outlines. `a*`/`b*` and `c*` carry kind-specific values (see
 * the shader). Colours are 0xRRGGBB plus a separate alpha packed by {@link packBarColor}.
 */
export interface BarSdfInstance {
  kind: BarSdfKind;
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  alpha: number;
  margin: number;
  a0: number; a1: number; a2: number; a3: number;
  b0: number; b1: number; b2: number; b3: number;
  c0: number; c1: number; c2: number; c3: number;
}

export function createBarSdfInstance(kind: BarSdfKind): BarSdfInstance {
  return { kind, x: 0, y: 0, width: 1, height: 1, radius: 0, alpha: 1, margin: 0,
    a0: 0, a1: 0, a2: 0, a3: 0, b0: 0, b1: 0, b2: 0, b3: 0, c0: 0, c1: 0, c2: 0, c3: 0 };
}

const clamp01 = (value: number): number => (value > 0 ? (value < 1 ? value : 1) : 0);

/** Little-endian RGBA bytes, read back as a normalized `vec4(r, g, b, a)`. */
export function packBarColor(rgb: number, alpha = 1): number {
  const r = (rgb >> 16) & 255, g = (rgb >> 8) & 255, b = rgb & 255;
  return ((Math.round(clamp01(alpha) * 255) << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

export function unpackBarColor(packed: number): { rgb: number; alpha: number } {
  return { rgb: ((packed & 255) << 16) | (packed & 0xff00) | ((packed >>> 16) & 255), alpha: (packed >>> 24) / 255 };
}

/** Mixes two 0xRRGGBB colours. */
export function mixBarRgb(a: number, b: number, t: number): number {
  const k = clamp01(t);
  const mix = (shift: number): number => {
    const x = (a >> shift) & 255, y = (b >> shift) & 255;
    return Math.round(x + (y - x) * k);
  };
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

export interface BarSdfMatrix { a: number; b: number; c: number; d: number; tx: number; ty: number }

/**
 * Writes one instance as four vertices at `offset` (in 32-bit words). `pxPerUnit` is the
 * framebuffer pixels per local unit; it sets the analytic antialiasing width and the extra quad
 * border that keeps the outermost coverage ramp inside the drawn geometry.
 */
export function writeBarSdfInstance(
  f32: Float32Array, u32: Uint32Array, offset: number,
  m: BarSdfMatrix, ox: number, oy: number, pxPerUnit: number, inst: BarSdfInstance,
): void {
  const aa = 1 / Math.max(1e-4, pxPerUnit);
  const pad = inst.margin + aa * 1.5;
  const x0 = -pad, y0 = -pad, x1 = inst.width + pad, y1 = inst.height + pad;
  const bx = ox + inst.x, by = oy + inst.y;
  // Axis-aligned bars start on a whole framebuffer pixel. Thin bars (2–6 px) otherwise straddle
  // pixel rows at half coverage and read dim and soft; the analytic AA then only shapes corners.
  let sx = 0, sy = 0;
  if (Math.abs(m.b) < 1e-6 && Math.abs(m.c) < 1e-6) {
    const X = m.a * bx + m.tx, Y = m.d * by + m.ty;
    sx = Math.round(X) - X; sy = Math.round(Y) - Y;
  }
  for (let corner = 0; corner < 4; corner++) {
    const lx = corner < 2 ? x0 : x1;
    const ly = (corner & 1) === 0 ? y0 : y1;
    const px = bx + lx, py = by + ly;
    let o = offset + corner * BAR_SDF_VERTEX_WORDS;
    f32[o++] = m.a * px + m.c * py + m.tx + sx;
    f32[o++] = m.b * px + m.d * py + m.ty + sy;
    f32[o++] = lx; f32[o++] = ly;
    f32[o++] = inst.width; f32[o++] = inst.height; f32[o++] = inst.radius; f32[o++] = aa;
    f32[o++] = inst.a0; f32[o++] = inst.a1; f32[o++] = inst.a2; f32[o++] = inst.a3;
    f32[o++] = inst.b0; f32[o++] = inst.b1; f32[o++] = inst.b2; f32[o++] = inst.b3;
    f32[o++] = inst.alpha; f32[o++] = inst.kind;
    u32[o++] = inst.c0; u32[o++] = inst.c1; u32[o++] = inst.c2; u32[o++] = inst.c3;
  }
}

/** Framebuffer pixels per local unit of an affine transform (the smaller axis, for safe AA). */
export function barSdfPixelScale(m: BarSdfMatrix): number {
  return Math.max(1e-4, Math.min(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d)));
}

// ── Presentation recipes ────────────────────────────────────────────────────────────────────

export interface BarSdfPalette { readonly dark: number; readonly mid: number; readonly light: number }

/** Recessed HUD channel: warm-dark vertical gradient, top inner shadow, thin border ring. */
export function setTroughInstance(inst: BarSdfInstance, width: number, height: number, radius: number,
  style: { top: number; bottom: number; alpha?: number; border: number; borderAlpha?: number; borderWidth?: number;
    outline?: number; outlineAlpha?: number; outlineWidth?: number; shadow?: number }): BarSdfInstance {
  inst.kind = BAR_SDF_KIND.trough;
  inst.width = width; inst.height = height; inst.radius = radius;
  inst.margin = style.outlineWidth ?? 0;
  inst.a0 = style.borderWidth ?? 1; inst.a1 = style.outlineWidth ?? 0; inst.a2 = style.shadow ?? 2; inst.a3 = 0;
  inst.c0 = packBarColor(style.top, style.alpha ?? 1);
  inst.c1 = packBarColor(style.bottom, 1);
  inst.c2 = packBarColor(style.border, style.borderAlpha ?? 1);
  inst.c3 = packBarColor(style.outline ?? 0, style.outlineAlpha ?? 0);
  return inst;
}

/** Gradient fill (full-width dark→mid→light), trail behind it, soft gloss and a lifted leading edge. */
export function setFillInstance(inst: BarSdfInstance, width: number, height: number, radius: number,
  palette: BarSdfPalette, style: { trail?: number; trailAlpha?: number; inset?: number; gloss?: number;
    edge?: number; shade?: number } = {}): BarSdfInstance {
  inst.kind = BAR_SDF_KIND.fill;
  inst.width = width; inst.height = height; inst.radius = radius; inst.margin = 0;
  inst.a3 = style.inset ?? 0;
  inst.b0 = style.gloss ?? 0.16; inst.b1 = style.edge ?? 0.55; inst.b3 = style.shade ?? 0.22;
  inst.c0 = packBarColor(palette.dark); inst.c1 = packBarColor(palette.mid); inst.c2 = packBarColor(palette.light);
  inst.c3 = packBarColor(style.trail ?? palette.light, style.trailAlpha ?? 1);
  return inst;
}

/** Fill span in local units; a trail at or behind the fill end is hidden. */
export function setFillSpan(inst: BarSdfInstance, start: number, end: number, trailEnd = end): void {
  inst.a0 = start; inst.a1 = Math.max(start, end); inst.a2 = Math.max(inst.a1, trailEnd);
}

export function setFillFlash(inst: BarSdfInstance, flash: number): void { inst.b2 = clamp01(flash); }

/** Field window of the living bar: clip shape in `width`/`height`/`radius`, sampled from a fill rect. */
export function setLivingInstance(inst: BarSdfInstance, clip: { x: number; y: number; width: number; height: number; radius: number },
  fill: { x: number; y: number; width: number; height: number }, source: { u: number; v: number; texelsPerUnit: number },
  tintStart: number, tintEnd: number, alpha: number): BarSdfInstance {
  inst.kind = BAR_SDF_KIND.living;
  inst.x = clip.x; inst.y = clip.y; inst.width = clip.width; inst.height = clip.height; inst.radius = clip.radius;
  inst.margin = 0; inst.alpha = alpha;
  inst.a0 = fill.x - clip.x; inst.a1 = fill.x - clip.x + fill.width;
  inst.a2 = fill.y - clip.y; inst.a3 = fill.y - clip.y + fill.height;
  inst.b0 = source.u; inst.b1 = source.v; inst.b2 = source.texelsPerUnit; inst.b3 = 0;
  inst.c0 = packBarColor(tintStart); inst.c1 = packBarColor(tintEnd); inst.c2 = 0; inst.c3 = 0;
  return inst;
}
