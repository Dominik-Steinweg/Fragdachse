import { VOID_PALETTE } from '../../config';

/**
 * One portal look, coloured per use. Every portal in the game (translocator pairs, fire-control
 * muzzle and exit portals, generator portals on the map) shares shape, motion, particles and the
 * transfer effect; a style only chooses the colour family and how strongly the destination ground
 * shows through the aperture.
 */
export type PortalStyleId = 'translocator-a' | 'translocator-b' | 'fire-control' | 'void';

export interface PortalStyle {
  /** Saturated body colour of rim, glow, wake and particles. */
  readonly rim: number;
  /** Near-white hot core of the rim line and of particle cores. */
  readonly hot: number;
  /** Colour of the steady light the aperture casts at night. */
  readonly light: number;
}

export const PORTAL_STYLES: Readonly<Record<PortalStyleId, PortalStyle>> = {
  // The two translocator ends keep their established blue/orange identity.
  'translocator-a': { rim: 0x4fb4ff, hot: 0xe6f6ff, light: 0x9fd8ff },
  'translocator-b': { rim: 0xff9440, hot: 0xfff0dc, light: 0xffc48a },
  // Fire control keeps its mint hologram family.
  'fire-control': { rim: 0x3dffd0, hot: 0xe8fff9, light: 0x7dffd2 },
  // Generator portals are hostile: violet is this game's danger colour.
  void: { rim: VOID_PALETTE.bright, hot: VOID_PALETTE.core, light: VOID_PALETTE.bright },
};

/** The two ends of a translocator pair keep their own colour so players can tell them apart. */
export function translocatorPortalStyle(end: 'a' | 'b'): PortalStyleId {
  return end === 'a' ? 'translocator-a' : 'translocator-b';
}
