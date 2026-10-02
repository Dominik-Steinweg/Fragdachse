import manifest from '../assets/manifests/character-badger-player-shadow-21c-production.json';
import { CHARACTER_SHADOW_CONFIG as config } from './ShadowConfig';

const azimuths = manifest.grid.azimuthDegrees;
const elevations = manifest.grid.elevationDegrees;
const cot = (degrees: number): number => 1 / Math.tan(degrees * Math.PI / 180);
const lowSunCot = cot(elevations[Math.floor((elevations.length - 1) / 2)]), highSunCot = cot(elevations[elevations.length - 1]);
const shadowLuminance = .2126 * config.colour[0] + .7152 * config.colour[1] + .0722 * config.colour[2];
const canvasIndices = elevations.map((_, e) => azimuths.map((_, a) =>
  manifest.canvases.findIndex(c => c.azimuthIndex === a && c.elevationIndex === e)));
const shadowSamples = manifest.samples.filter(sample => sample.pass === 'shadow');
const samplesByPose = manifest.poses.map(pose => manifest.canvases.map((_, canvasIndex) => {
  const sample = shadowSamples.find(s => s.pose === pose.index && s.canvasIndex === canvasIndex);
  if (!sample) throw new Error(`Missing character shadow ${pose.index}/${canvasIndex}`);
  return sample;
}));

export function displayedShadowPose(frame: string | number): number {
  const pose = Number(frame);
  return Number.isInteger(pose) && pose >= 0 && pose < manifest.poses.length ? pose : 0;
}

/** World and asset X point right, Y south. Inverse *displayed* clockwise rotation;
 * SunPath.azimuth itself uses the opposite angular convention and is not used. */
export function characterLightAzimuth(x: number, y: number, rotation: number): number {
  const c = Math.cos(rotation), s = Math.sin(rotation);
  return (Math.atan2(-s * x + c * y, c * x + s * y) * 180 / Math.PI + 360) % 360;
}

export interface CharacterShadowSelection {
  canvases: number[];
  weights: number[];
}
export function createCharacterShadowSelection(): CharacterShadowSelection {
  return { canvases: [0, 0, 0, 0], weights: [0, 0, 0, 0] };
}

/** Caller-owned storage. One normalized mask sum, not four source-over draws. */
export function selectCharacterShadows(azimuth: number, elevationRadians: number,
  out: CharacterShadowSelection): void {
  const a = ((Number.isFinite(azimuth) ? azimuth % 360 : 0) + 360) % 360 / (360 / azimuths.length);
  const a0 = Math.floor(a), a1 = (a0 + 1) % azimuths.length, aw = a - a0;
  const e = Math.max(elevations[0], Math.min(elevations[elevations.length - 1],
    Number.isFinite(elevationRadians) ? elevationRadians * 180 / Math.PI : elevations[0]));
  let e0 = 0;
  while (e0 < elevations.length - 2 && e > elevations[e0 + 1]) e0++;
  const ew = (cot(elevations[e0]) - cot(e)) / (cot(elevations[e0]) - cot(elevations[e0 + 1]));
  for (let i = 0; i < 4; i++) {
    out.canvases[i] = canvasIndices[e0 + (i >= 2 ? 1 : 0)][i % 2 ? a1 : a0];
    out.weights[i] = (i % 2 ? aw : 1 - aw) * (i >= 2 ? ew : 1 - ew);
  }
}

export function characterShadowSample(pose: number, canvas: number) {
  return samplesByPose[pose][canvas];
}

export function characterDirectShadow(strength: number, elevation: number): number {
  return Number.isFinite(strength) && Number.isFinite(elevation) && elevation > 0 && strength > 0 ? Math.min(1, strength) : 0;
}

/** Match contrast to the same projected-length coordinate used by the atlas.
 * Long, low-sun silhouettes remain softer; clouds still attenuate per fragment. */
export function characterShadowOpacity(strength: number, elevation: number): number {
  const direct = characterDirectShadow(strength, elevation);
  if (!direct) return 0;
  const height = Math.max(0, Math.min(1, (lowSunCot - 1 / Math.tan(elevation)) / (lowSunCot - highSunCot)));
  // Ease into the short noon shadow; intermediate/long silhouettes keep lower contrast.
  return direct * (config.lowSunOpacity + (config.directOpacity - config.lowSunOpacity) * height * height * height);
}

/** MULTIPLY luminance loss on a neutral receiver for mask=1, outside foot contact.
 * An estimate before camera grading, not a framebuffer measurement. */
export function characterShadowCoreDarkening(opacity: number, cloud: number, receiver: number, spriteAlpha: number): number {
  return opacity * cloud * receiver * spriteAlpha * (1 - shadowLuminance);
}
