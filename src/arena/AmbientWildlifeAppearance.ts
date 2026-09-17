import { AMBIENT_WILDLIFE as TUNING } from './AmbientWildlifeConfig';

export type WildlifeKind = 'butterfly' | 'moth' | 'firefly' | 'snake' | 'fish';
export function isWingedInsect(kind: WildlifeKind): kind is 'butterfly' | 'moth' | 'firefly' {
  return kind === 'butterfly' || kind === 'moth' || kind === 'firefly';
}

/** Shared pulse for the visible halo and its illumination of the ground. */
export function fireflyGlowStrength(time: number, variation: number, phaseOffset: number,
  speed: number = TUNING.firefly.speed): number {
  const wave = .5 + .5 * Math.sin(time * (1.5 + variation) / 3 + phaseOffset);
  // Individual phases and periods, with a quiet interval between soft flashes.
  const pulse = .08 + .92 * wave * wave * wave;
  // The model already eases speed into and out of flight. Follow that continuous
  // state rather than switching brightness abruptly with the fleeing flag.
  const flight = Math.max(0, Math.min(1,
    (speed - TUNING.firefly.speed) / (TUNING.firefly.fleeSpeed - TUNING.firefly.speed)));
  const blend = flight * flight * (3 - 2 * flight);
  return pulse + (1 - pulse) * blend;
}

/** Immutable local appearance shared by drawing and habitat clearance. */
export interface WildlifeAppearance {
  readonly length: number;
  readonly widthScale: number;
  readonly colorIndex: number;
  readonly groupIndex: number;
  readonly count: number;
  readonly spread: number;
  readonly footprint: number;
}

export function createWildlifeAppearance(kind: WildlifeKind, sizeRoll: number, colorRoll: number,
  groupRoll: number): WildlifeAppearance {
  if (kind === 'snake') {
    const scale = TUNING.snakeSizes[Math.floor(sizeRoll * TUNING.snakeSizes.length)];
    const length = TUNING.snake.size * scale * TUNING.snakeVisual.scale;
    return { length, widthScale: (.8 + scale * .2) * TUNING.snakeVisual.scale, colorIndex: Math.floor(colorRoll * TUNING.snakeColors.length),
      groupIndex: 0, count: 1, spread: 0, footprint: length * TUNING.visualScale + 2 };
  }
  if (kind === 'fish') {
    const groupIndex = Math.floor(groupRoll * TUNING.fishGroups.length), group = TUNING.fishGroups[groupIndex];
    const length = TUNING.fish.size * group.sizeScale * (.9 + sizeRoll * .2);
    // The member pose stays within spread + 1.3; the tail is the longest
    // body extent (.62 * length), including individual size variation.
    const footprint = group.spread + 1.3 + length * 1.08 * .62 * TUNING.visualScale + 1;
    return { length, widthScale: group.widthScale, colorIndex: Math.floor(colorRoll * TUNING.fishColors.length),
      groupIndex, count: group.minCount + Math.floor(sizeRoll * (group.maxCount - group.minCount + 1)),
      spread: group.spread, footprint };
  }
  const colors = kind === 'moth' ? TUNING.mothColors : TUNING.butterflyColors;
  return { length: TUNING[kind].size, widthScale: 1, colorIndex: Math.floor(colorRoll * colors.length),
    groupIndex: 0, count: 1, spread: 0,
    footprint: kind === 'firefly' ? TUNING.fireflyGlowRadius * TUNING.visualScale + 2 : 6 };
}

export interface FishMemberPose { x: number; y: number; length: number }

export interface SnakeBodyPose { x: number; y: number; halfWidth: number }

/** Head-anchored travelling wave shared by the silhouette and dorsal markings. */
export function writeSnakeBodyPose(appearance: WildlifeAppearance, animation: number,
  t: number, out: SnakeBodyPose): void {
  out.x = -t * appearance.length;
  out.y = Math.sin(animation - t * TUNING.snakeVisual.waveLength)
    * Math.sin(t * Math.PI * .8) * TUNING.snakeVisual.waveAmplitude * appearance.widthScale;
  out.halfWidth = (.025 + .86 * Math.pow(1 - t, .7) * (.72 + .28 * Math.sin(Math.min(t * 5, 1) * Math.PI / 2)))
    * appearance.widthScale;
}

/** Stateless, individually offset pulses; time is independent of locomotion speed. */
export function snakeTongueExtension(time: number, variation: number): number {
  const tuning = TUNING.snakeVisual;
  const shifted = time + variation * tuning.tonguePeriod;
  const cycle = Math.floor(shifted / tuning.tonguePeriod);
  const roll = (salt: number): number => {
    const value = Math.sin(cycle * 127.1 + variation * 311.7 + salt) * 43758.5453;
    return value - Math.floor(value);
  };
  const start = .3 + roll(17) * tuning.tongueJitter;
  const duration = tuning.tongueMinDuration + roll(53) * (tuning.tongueMaxDuration - tuning.tongueMinDuration);
  const phase = (shifted - cycle * tuning.tonguePeriod - start) / duration;
  if (phase <= 0 || phase >= 1) return 0;
  // Quick extension, a small flicker at the tip, and complete retraction.
  return Math.pow(Math.sin(Math.PI * phase), .7) * (.94 + .06 * Math.cos(phase * Math.PI * 6));
}

/** A loose radial formation keeps pairs centred and single fish on their own pivot. */
export function writeFishMemberPose(appearance: WildlifeAppearance, animation: number, variation: number,
  index: number, out: FishMemberPose): void {
  const angle = index * 2.399963 + variation * Math.PI * 2;
  const radius = appearance.spread * Math.sqrt((index + .5) / appearance.count);
  out.x = Math.cos(angle) * radius + Math.sin(animation * .32 + index * 2) * .8;
  out.y = Math.sin(angle) * radius + Math.sin(animation * .42 + index) * .7;
  out.length = appearance.length * (.92 + ((index * .37 + variation) % 1) * .16);
}
