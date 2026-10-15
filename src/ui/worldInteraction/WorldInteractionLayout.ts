import type { WorldInteractionFootprint } from '../../systems/WorldInteractionCandidate';

/** Authored geometry of the shared Shift focus; world pixels at design zoom. */
export const WORLD_INTERACTION_LAYOUT = {
  /** Brackets sit just outside the object's bounds. */
  bracketPadPx: 3,
  armRatio: 0.28,
  armMinPx: 7,
  armMaxPx: 18,
  secondaryArmPx: 5,
  maxAlternatives: 3,
  /** Gap between bracket edge and plaque pointer tip. */
  plaqueGapPx: 6,
  pointerHeightPx: 5,
  viewMarginPx: 12,
} as const;

export interface WorldRect { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }
export interface Point { readonly x: number; readonly y: number }

export interface InteractionPlaqueLayout {
  /** Plaque centre x and top edge y. */
  readonly x: number;
  readonly y: number;
  readonly side: 'above' | 'below';
  /** Pointer tip, always on the footprint's horizontal span so clusters stay unambiguous. */
  readonly pointerX: number;
  readonly pointerY: number;
}

export function bracketRect(footprint: WorldInteractionFootprint): WorldRect {
  const pad = WORLD_INTERACTION_LAYOUT.bracketPadPx;
  return { left: footprint.left - pad, top: footprint.top - pad, right: footprint.right + pad, bottom: footprint.bottom + pad };
}

export function bracketArm(rect: WorldRect): number {
  const { armRatio, armMinPx, armMaxPx } = WORLD_INTERACTION_LAYOUT;
  const shorter = Math.min(rect.right - rect.left, rect.bottom - rect.top);
  return Math.max(armMinPx, Math.min(armMaxPx, Math.round(shorter * armRatio), shorter / 2));
}

/** Corner polylines (three points each) in coordinates relative to the rect centre. */
export function bracketCorners(rect: WorldRect, arm: number): readonly (readonly Point[])[] {
  const hw = (rect.right - rect.left) / 2, hh = (rect.bottom - rect.top) / 2;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => [
    { x: sx * hw, y: sy * (hh - arm) },
    { x: sx * hw, y: sy * hh },
    { x: sx * (hw - arm), y: sy * hh },
  ]);
}

/**
 * The plaque sits on the side of the object facing away from the player, so it never covers the
 * actor, and flips when the view edge leaves no room. Horizontal clamping keeps it on screen; the
 * pointer stays over the object even when the plaque body has to slide.
 */
export function layoutInteractionPlaque(footprint: WorldInteractionFootprint, player: Point | null,
  plaque: { readonly width: number; readonly height: number }, view: WorldRect): InteractionPlaqueLayout {
  const { plaqueGapPx, pointerHeightPx, viewMarginPx } = WORLD_INTERACTION_LAYOUT;
  const rect = bracketRect(footprint);
  const centerX = (rect.left + rect.right) / 2, centerY = (rect.top + rect.bottom) / 2;
  const offset = plaqueGapPx + pointerHeightPx;
  const aboveY = rect.top - offset - plaque.height, belowY = rect.bottom + offset;
  const fitsAbove = aboveY >= view.top + viewMarginPx, fitsBelow = belowY + plaque.height <= view.bottom - viewMarginPx;
  let side: 'above' | 'below' = player && player.y < centerY ? 'below' : 'above';
  if (side === 'above' && !fitsAbove && fitsBelow) side = 'below';
  else if (side === 'below' && !fitsBelow && fitsAbove) side = 'above';
  const minX = view.left + viewMarginPx + plaque.width / 2, maxX = view.right - viewMarginPx - plaque.width / 2;
  const x = minX <= maxX ? Math.min(maxX, Math.max(minX, centerX)) : (view.left + view.right) / 2;
  const rawY = side === 'above' ? aboveY : belowY;
  const y = Math.min(view.bottom - viewMarginPx - plaque.height, Math.max(view.top + viewMarginPx, rawY));
  const reach = plaque.width / 2 - 10;
  const pointerX = Math.min(x + reach, Math.max(x - reach, Math.min(rect.right - 4, Math.max(rect.left + 4, centerX))));
  return { x, y, side, pointerX, pointerY: side === 'above' ? y + plaque.height + pointerHeightPx : y - pointerHeightPx };
}
