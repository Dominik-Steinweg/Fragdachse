/**
 * Gebackene Texturen des Utility-Rads.
 *
 * Alle Formen entstehen einmalig in Canvas-Texturen (doppelte Auflösung, `RADIAL_TEXTURE_SS`)
 * und werden zur Laufzeit nur noch positioniert, gedreht, getönt und überblendet. Ring, Nabenring
 * und Verwaltungs-Icons sind gemalte Artwork (`RadialWheelAssets`); hier entstehen nur die
 * Formen, die von Segmentzahl und Radius abhängen, sowie kleine Hilfsgrafiken.
 *
 * Weiße Ebenen (Saum, Glanz, Füllung, Lichtsaum, Ausrüstungsleiste, Zeiger) werden zur Laufzeit in der
 * Farbfamilie des Eintrags getönt; nur die Glasfläche trägt eine feste Farbe.
 */
import * as Phaser from 'phaser';
import { rgbStr } from './LivingBarEffect';

/** Überabtastung aller Rad-Texturen; Bilder werden mit `1 / RADIAL_TEXTURE_SS` skaliert. */
export const RADIAL_TEXTURE_SS = 2;
const SS = RADIAL_TEXTURE_SS;
const TAU = Math.PI * 2;

/** Konstante Fugenbreite zwischen zwei Segmenten in Designpixeln. */
const SEGMENT_GAP = 4;
/** Rand um die Segmentform; nimmt den weichen Lichtsaum auf. */
const SEGMENT_PAD = 14;
const HALO_BLUR = 9;

export const RADIAL_COOLDOWN_TEXTURE = '_radial_cooldown_v1';
export const RADIAL_COOLDOWN_FRAMES = 48;
/** Radius des Cooldown-Wischers innerhalb seiner Zelle (Designpixel). */
export const RADIAL_COOLDOWN_RADIUS = 22;
const COOLDOWN_CELL = 48;

export const RADIAL_POINTER_TEXTURE = '_radial_pointer_v1';
export const RADIAL_SOFT_TEXTURE = '_radial_soft_v1';
export const RADIAL_VIGNETTE_TEXTURE = '_radial_vignette_v1';

export interface RadialSegmentTextures {
  /** Dunkle Glasfläche des Segments. */
  readonly base: string;
  /** Weiße Vollfläche; getönt ergibt sie die farbige Glasfüllung des fokussierten Segments. */
  readonly fill: string;
  /** Weißer Glanzverlauf nach außen, additiv und getönt für Hover und Auswahl. */
  readonly glow: string;
  /** Weißer Farbsaum (außen kräftig, Seiten dezent), wird in der Farbfamilie getönt. */
  readonly rim: string;
  /** Weicher Lichtsaum außerhalb der Segmentkante, additiv für den Fokus. */
  readonly halo: string;
  /** Leiste an der Innenkante mit weichem Ausläufer: Kennzeichen der ausgerüsteten Aktion. */
  readonly equip: string;
  /** Radmittelpunkt innerhalb der Textur (Origin 0..1). */
  readonly originX: number;
  readonly originY: number;
}

function createCanvas(scene: Phaser.Scene, key: string, width: number, height: number): Phaser.Textures.CanvasTexture | null {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  return scene.textures.createCanvas(key, Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height)));
}

/** Segment in Richtung +x mit gleich breiter Fuge zu beiden Nachbarn. */
function segmentAngles(inner: number, outer: number, half: number): { inner: number; outer: number; full: boolean } {
  if (half >= Math.PI - 1e-6) return { inner: Math.PI, outer: Math.PI, full: true };
  return {
    inner: Math.max(0.01, half - Math.asin(Math.min(1, SEGMENT_GAP / 2 / inner))),
    outer: Math.max(0.01, half - Math.asin(Math.min(1, SEGMENT_GAP / 2 / outer))),
    full: false,
  };
}

function traceSegment(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  inner: number,
  outer: number,
  angles: { inner: number; outer: number; full: boolean },
): void {
  ctx.beginPath();
  if (angles.full) {
    ctx.arc(cx, cy, outer, 0, TAU);
    ctx.moveTo(cx + inner, cy);
    ctx.arc(cx, cy, inner, 0, TAU, true);
  } else {
    ctx.arc(cx, cy, outer, -angles.outer, angles.outer, false);
    ctx.arc(cx, cy, inner, angles.inner, -angles.inner, true);
  }
  ctx.closePath();
}

/**
 * Deckungsgleiche Ebenen eines Segments für die gegebene Segmentzahl. Das Segment zeigt in
 * Richtung +x; die Laufzeit dreht die Bilder um den Radmittelpunkt.
 */
export function ensureRadialSegmentTextures(
  scene: Phaser.Scene,
  count: number,
  innerRadius: number,
  outerRadius: number,
): RadialSegmentTextures {
  const id = `${count}_${innerRadius}_${outerRadius}`;
  const keys = {
    base: `_radial_seg_base_v2_${id}`,
    fill: `_radial_seg_fill_v2_${id}`,
    glow: `_radial_seg_glow_v2_${id}`,
    rim: `_radial_seg_rim_v2_${id}`,
    halo: `_radial_seg_halo_v2_${id}`,
    equip: `_radial_seg_equip_v1_${id}`,
  };
  const half = Math.PI / Math.max(1, count);
  const angles = segmentAngles(innerRadius, outerRadius, half);

  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  const sample = (radius: number, limit: number): void => {
    for (let step = 0; step <= 48; step += 1) {
      const angle = -limit + (2 * limit * step) / 48;
      const x = radius * Math.cos(angle);
      const y = radius * Math.sin(angle);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  };
  sample(outerRadius, angles.outer);
  sample(innerRadius, angles.inner);
  const width = (maxX - minX + SEGMENT_PAD * 2) * SS;
  const height = (maxY - minY + SEGMENT_PAD * 2) * SS;
  const cx = (-minX + SEGMENT_PAD) * SS;
  const cy = (-minY + SEGMENT_PAD) * SS;
  const result: RadialSegmentTextures = {
    ...keys,
    originX: cx / Math.ceil(width),
    originY: cy / Math.ceil(height),
  };
  if (Object.values(keys).every((key) => scene.textures.exists(key))) return result;

  const ri = innerRadius * SS;
  const ro = outerRadius * SS;
  const trace = (ctx: CanvasRenderingContext2D): void => traceSegment(ctx, cx, cy, ri, ro, angles);

  const base = createCanvas(scene, keys.base, width, height);
  if (base) {
    const ctx = base.context;
    trace(ctx);
    const glass = ctx.createRadialGradient(cx, cy, ri, cx, cy, ro);
    glass.addColorStop(0, rgbStr(0x070b09, 0.94));
    glass.addColorStop(0.55, rgbStr(0x0f1713, 0.9));
    glass.addColorStop(1, rgbStr(0x1b261f, 0.88));
    ctx.fillStyle = glass;
    ctx.fill('evenodd');
    // Innenschatten an allen Kanten: die Glasfläche wirkt eingelassen statt aufgeklebt.
    ctx.save();
    trace(ctx);
    ctx.clip('evenodd');
    trace(ctx);
    ctx.lineWidth = 4 * SS;
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.stroke();
    ctx.restore();
    base.refresh();
  }

  const fill = createCanvas(scene, keys.fill, width, height);
  if (fill) {
    const ctx = fill.context;
    trace(ctx);
    // Außen etwas kräftiger: das Licht scheint unter dem Holzring hervor.
    const tint = ctx.createRadialGradient(cx, cy, ri, cx, cy, ro);
    tint.addColorStop(0, 'rgba(255,255,255,0.22)');
    tint.addColorStop(0.55, 'rgba(255,255,255,0.55)');
    tint.addColorStop(1, 'rgba(255,255,255,1)');
    ctx.fillStyle = tint;
    ctx.fill('evenodd');
    fill.refresh();
  }

  const glow = createCanvas(scene, keys.glow, width, height);
  if (glow) {
    const ctx = glow.context;
    trace(ctx);
    const light = ctx.createRadialGradient(cx, cy, ri, cx, cy, ro);
    light.addColorStop(0, 'rgba(255,255,255,0.05)');
    light.addColorStop(0.5, 'rgba(255,255,255,0.16)');
    light.addColorStop(0.85, 'rgba(255,255,255,0.42)');
    light.addColorStop(1, 'rgba(255,255,255,0.7)');
    ctx.fillStyle = light;
    ctx.fill('evenodd');
    glow.refresh();
  }

  const rim = createCanvas(scene, keys.rim, width, height);
  if (rim) {
    const ctx = rim.context;
    ctx.save();
    trace(ctx);
    ctx.clip('evenodd');
    trace(ctx);
    // Nur die innere Hälfte des Strichs bleibt nach dem Clip sichtbar.
    ctx.lineWidth = 3 * SS;
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.stroke();
    ctx.restore();
    rim.refresh();
  }

  const halo = createCanvas(scene, keys.halo, width, height);
  if (halo) {
    const ctx = halo.context;
    ctx.save();
    ctx.shadowColor = 'rgba(255,255,255,1)';
    ctx.shadowBlur = HALO_BLUR * SS;
    trace(ctx);
    ctx.fillStyle = '#ffffff';
    ctx.fill('evenodd');
    ctx.fill('evenodd');
    ctx.restore();
    // Nur der Saum außerhalb der Form bleibt; die Fläche selbst trägt `fill` und `glow`.
    ctx.globalCompositeOperation = 'destination-out';
    trace(ctx);
    ctx.fill('evenodd');
    ctx.globalCompositeOperation = 'source-over';
    halo.refresh();
  }

  const equip = createCanvas(scene, keys.equip, width, height);
  if (equip) {
    const ctx = equip.context;
    ctx.save();
    trace(ctx);
    ctx.clip('evenodd');
    // Kräftige Leiste direkt an der Nabe, danach ein kurzer Lichtausläufer ins Segment.
    const band = ctx.createRadialGradient(cx, cy, ri, cx, cy, ri + 26 * SS);
    band.addColorStop(0, 'rgba(255,255,255,1)');
    band.addColorStop(6 / 26, 'rgba(255,255,255,1)');
    band.addColorStop(7.5 / 26, 'rgba(255,255,255,0.45)');
    band.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = band;
    ctx.fillRect(0, 0, equip.width, equip.height);
    ctx.restore();
    equip.refresh();
  }
  return result;
}

/** Runde Glasfläche der Nabe; der gemalte Nabenring liegt als eigenes Bild darüber. */
export function ensureRadialHubTexture(scene: Phaser.Scene, radius: number): string {
  const key = `_radial_hub_v2_${radius}`;
  if (scene.textures.exists(key)) return key;
  const size = (radius + 2) * 2 * SS;
  const canvas = createCanvas(scene, key, size, size);
  if (!canvas) return key;
  const ctx = canvas.context;
  const c = Math.ceil(size) / 2;
  const r = radius * SS;
  const glass = ctx.createRadialGradient(c, c - r * 0.35, r * 0.1, c, c, r);
  glass.addColorStop(0, rgbStr(0x223029, 0.97));
  glass.addColorStop(0.7, rgbStr(0x0d1411, 0.97));
  glass.addColorStop(1, rgbStr(0x050807, 0.98));
  ctx.beginPath();
  ctx.arc(c, c, r, 0, TAU);
  ctx.fillStyle = glass;
  ctx.fill();
  canvas.refresh();
  return key;
}

/**
 * Uhrzeiger-Wischer: Frame `i` deckt den verbleibenden Anteil `(i + 1) / FRAMES` ab. Die
 * freigegebene Fläche wächst ab zwölf Uhr im Uhrzeigersinn, die Vorderkante trägt eine
 * helle Linie.
 */
export function ensureRadialCooldownTexture(scene: Phaser.Scene): string {
  const key = RADIAL_COOLDOWN_TEXTURE;
  if (scene.textures.exists(key)) return key;
  const cell = COOLDOWN_CELL * SS;
  const columns = 8;
  const rows = Math.ceil(RADIAL_COOLDOWN_FRAMES / columns);
  const canvas = createCanvas(scene, key, cell * columns, cell * rows);
  if (!canvas) return key;
  const ctx = canvas.context;
  const r = RADIAL_COOLDOWN_RADIUS * SS;
  for (let index = 0; index < RADIAL_COOLDOWN_FRAMES; index += 1) {
    const x = (index % columns) * cell;
    const y = Math.floor(index / columns) * cell;
    const cx = x + cell / 2;
    const cy = y + cell / 2;
    const remaining = (index + 1) / RADIAL_COOLDOWN_FRAMES;
    const start = -Math.PI / 2 + (1 - remaining) * TAU;
    const end = -Math.PI / 2 + TAU;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, end, false);
    ctx.closePath();
    ctx.fillStyle = rgbStr(0x030605, 0.74);
    ctx.fill();
    if (remaining < 0.999) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + r * Math.cos(start), cy + r * Math.sin(start));
      ctx.lineWidth = 1.6 * SS;
      ctx.lineCap = 'round';
      ctx.strokeStyle = rgbStr(0xe6dcc4, 0.85);
      ctx.stroke();
    }
    canvas.add(`f${index}`, 0, x, y, cell, cell);
  }
  canvas.refresh();
  return key;
}

export function radialCooldownFrame(remainingFraction: number): string {
  const index = Phaser.Math.Clamp(Math.ceil(remainingFraction * RADIAL_COOLDOWN_FRAMES) - 1, 0, RADIAL_COOLDOWN_FRAMES - 1);
  return `f${index}`;
}

/** Kleiner weißer Richtungszeiger (Spitze nach oben) für die Nabe. */
export function ensureRadialPointerTexture(scene: Phaser.Scene): string {
  const key = RADIAL_POINTER_TEXTURE;
  if (scene.textures.exists(key)) return key;
  const w = 14 * SS;
  const h = 9 * SS;
  const canvas = createCanvas(scene, key, w, h);
  if (!canvas) return key;
  const ctx = canvas.context;
  ctx.beginPath();
  ctx.moveTo(w / 2, 0.5 * SS);
  ctx.quadraticCurveTo(w * 0.62, h * 0.5, w - 0.5 * SS, h - 0.5 * SS);
  ctx.quadraticCurveTo(w / 2, h * 0.72, 0.5 * SS, h - 0.5 * SS);
  ctx.quadraticCurveTo(w * 0.38, h * 0.5, w / 2, 0.5 * SS);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  canvas.refresh();
  return key;
}

/** Weicher, weißer Lichtfleck für additive Akzente. */
export function ensureRadialSoftTexture(scene: Phaser.Scene): string {
  const key = RADIAL_SOFT_TEXTURE;
  if (scene.textures.exists(key)) return key;
  const size = 64;
  const canvas = createCanvas(scene, key, size, size);
  if (!canvas) return key;
  const ctx = canvas.context;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
  gradient.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  canvas.refresh();
  return key;
}

/** Dunkle Vignette hinter dem Rad: hebt es von hellen Weltflächen ab, ohne sie zu verdecken. */
export function ensureRadialVignetteTexture(scene: Phaser.Scene): string {
  const key = RADIAL_VIGNETTE_TEXTURE;
  if (scene.textures.exists(key)) return key;
  const size = 256;
  const canvas = createCanvas(scene, key, size, size);
  if (!canvas) return key;
  const ctx = canvas.context;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, rgbStr(0x040706, 0.5));
  gradient.addColorStop(0.62, rgbStr(0x040706, 0.4));
  gradient.addColorStop(1, rgbStr(0x040706, 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  canvas.refresh();
  return key;
}
