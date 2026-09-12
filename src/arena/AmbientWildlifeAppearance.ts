import { AMBIENT_WILDLIFE as TUNING } from './AmbientWildlifeConfig';

export type WildlifeKind = 'butterfly' | 'snake' | 'fish';
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
    const length = TUNING.snake.size * scale;
    return { length, widthScale: .8 + scale * .2, colorIndex: Math.floor(colorRoll * TUNING.snakeColors.length),
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
  return { length: TUNING.butterfly.size, widthScale: 1, colorIndex: Math.floor(colorRoll * TUNING.butterflyColors.length),
    groupIndex: 0, count: 1, spread: 0, footprint: 6 };
}

export interface FishMemberPose { x: number; y: number; length: number }

/** A loose radial formation keeps pairs centred and single fish on their own pivot. */
export function writeFishMemberPose(appearance: WildlifeAppearance, animation: number, variation: number,
  index: number, out: FishMemberPose): void {
  const angle = index * 2.399963 + variation * Math.PI * 2;
  const radius = appearance.spread * Math.sqrt((index + .5) / appearance.count);
  out.x = Math.cos(angle) * radius + Math.sin(animation * .32 + index * 2) * .8;
  out.y = Math.sin(angle) * radius + Math.sin(animation * .42 + index) * .7;
  out.length = appearance.length * (.92 + ((index * .37 + variation) % 1) * .16);
}
