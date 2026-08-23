/**
 * Deterministische Bewegungs- und Abtastlogik fuer GroundFire.
 *
 * Das Modul bleibt Phaser-frei, damit die raeumliche Verteilung und das langsam morphende
 * Temperaturfeld ohne Renderer oder WebGL getestet werden koennen. Alle Sampling-Funktionen
 * schreiben in ein vom Aufrufer wiederverwendetes Ergebnisobjekt; im Emissions-Hotpath entsteht
 * dadurch kein Garbage.
 */

const COARSE_SCALE_PX = 72;
const FINE_SCALE_PX = 34;
const COARSE_PERIOD_MS = 4_800;
const FINE_PERIOD_MS = 2_900;
const GRADIENT_STEP_PX = 8;

export interface GroundFireMotionSample {
  /** Normierte lokale Stroemungsrichtung. */
  x: number;
  y: number;
  /** Langsam morphende lokale Temperaturvariation in [0, 1]. */
  heat: number;
}

/**
 * Baut eine vollstaendige, seed-deterministische Permutation der Zellindizes.
 *
 * Jede visuelle Schicht benutzt einen eigenen Salt. Damit deckt jede Schicht weiterhin jede
 * Zelle genau einmal pro Umlauf ab, aber weder rasterweise noch synchron zu ihren Nachbarn.
 */
export function buildGroundFireTraversal(count: number, seed: number, salt: number): Int32Array {
  const length = Math.max(0, count | 0);
  const order = new Int32Array(length);
  for (let index = 0; index < length; index += 1) order[index] = index;

  let state = mix32(seed ^ Math.imul(salt | 0, 0x9e3779b1));
  for (let index = length - 1; index > 0; index -= 1) {
    state = xorshift32(state);
    const target = (state >>> 0) % (index + 1);
    const value = order[index];
    order[index] = order[target];
    order[target] = value;
  }
  return order;
}

/**
 * Samplet Temperatur und ein lokales Curl-Feld.
 *
 * Statt eine Textur durch die Welt zu schieben, morpht jede Oktave zwischen zwei raeumlichen
 * Noise-Zustaenden. Heisse Stellen entstehen und vergehen deshalb lokal; es gibt keine globale
 * Bewegungsrichtung, die als Welle ueber eine Brandflaeche laufen koennte.
 */
export function sampleGroundFireMotion(
  x: number,
  y: number,
  nowMs: number,
  seed: number,
  out: GroundFireMotionSample,
): void {
  const center = sampleGroundFireHeat(x, y, nowMs, seed);
  const left = sampleGroundFireHeat(x - GRADIENT_STEP_PX, y, nowMs, seed);
  const right = sampleGroundFireHeat(x + GRADIENT_STEP_PX, y, nowMs, seed);
  const top = sampleGroundFireHeat(x, y - GRADIENT_STEP_PX, nowMs, seed);
  const bottom = sampleGroundFireHeat(x, y + GRADIENT_STEP_PX, nowMs, seed);

  // Senkrecht zum Gradienten entsteht ein Curl-Feld: lokale Wirbel statt Stroemung von A nach B.
  const dx = right - left;
  const dy = bottom - top;
  const curlX = -dy;
  const curlY = dx;
  const length = Math.hypot(curlX, curlY);
  if (length > 0.0001) {
    out.x = curlX / length;
    out.y = curlY / length;
  } else {
    // An einem flachen Plateau bleibt die Richtung stabil, aber cluster- und ortsabhaengig.
    const angle = hashUnit(Math.round(x), Math.round(y), seed ^ 0x51f15e5d) * Math.PI * 2;
    out.x = Math.cos(angle);
    out.y = Math.sin(angle);
  }
  out.heat = center;
}

/** Nur fuer Tests und die kombinierte Motion-Abtastung exportiert. */
export function sampleGroundFireHeat(x: number, y: number, nowMs: number, seed: number): number {
  const coarse = morphingValueNoise(
    x / COARSE_SCALE_PX,
    y / COARSE_SCALE_PX,
    nowMs / COARSE_PERIOD_MS,
    seed ^ 0x2c1b3c6d,
  );
  const fine = morphingValueNoise(
    x / FINE_SCALE_PX,
    y / FINE_SCALE_PX,
    nowMs / FINE_PERIOD_MS + 0.37,
    seed ^ 0x297a2d39,
  );
  return coarse * 0.68 + fine * 0.32;
}

function morphingValueNoise(x: number, y: number, time: number, seed: number): number {
  const slice = Math.floor(time);
  const blend = smootherStep(time - slice);
  const from = valueNoise2d(x, y, seed ^ Math.imul(slice, 0x45d9f3b));
  const to = valueNoise2d(x, y, seed ^ Math.imul(slice + 1, 0x45d9f3b));
  return from + (to - from) * blend;
}

function valueNoise2d(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smootherStep(x - ix);
  const fy = smootherStep(y - iy);
  const topLeft = hashUnit(ix, iy, seed);
  const topRight = hashUnit(ix + 1, iy, seed);
  const bottomLeft = hashUnit(ix, iy + 1, seed);
  const bottomRight = hashUnit(ix + 1, iy + 1, seed);
  const top = topLeft + (topRight - topLeft) * fx;
  const bottom = bottomLeft + (bottomRight - bottomLeft) * fx;
  return top + (bottom - top) * fy;
}

function smootherStep(value: number): number {
  return value * value * value * (value * (value * 6 - 15) + 10);
}

function hashUnit(x: number, y: number, seed: number): number {
  let hash = Math.imul(x | 0, 0x1f123bb5) ^ Math.imul(y | 0, 0x5f356495) ^ seed;
  hash = mix32(hash);
  return (hash >>> 0) / 4294967296;
}

function mix32(value: number): number {
  let mixed = value | 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846ca68b);
  mixed ^= mixed >>> 16;
  // Xorshift darf nicht mit 0 starten.
  return mixed === 0 ? 0x6d2b79f5 : mixed;
}

function xorshift32(value: number): number {
  let next = value | 0;
  next ^= next << 13;
  next ^= next >>> 17;
  next ^= next << 5;
  return next | 0;
}
