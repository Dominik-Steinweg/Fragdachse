/**
 * Shared geometry for the centered lower HUD stack.
 *
 * Armor, utility, ultimate and persistent power-up entries all occupy this
 * same design-space row. Keeping the contract here prevents the two HUD
 * renderers from drifting apart again.
 */
import { COLORS, toCssColor } from '../config';

export const BOTTOM_STACK_BAR_W = 212;
export const BOTTOM_STACK_BAR_H = 14;
export const BOTTOM_STACK_LABEL_H = 20;
export const BOTTOM_STACK_TOTAL_H = BOTTOM_STACK_LABEL_H + BOTTOM_STACK_BAR_H;
export const BOTTOM_STACK_GAP = 8;
export const BOTTOM_STACK_PANEL_W = BOTTOM_STACK_BAR_W + 20;
export const BOTTOM_STACK_PANEL_H = BOTTOM_STACK_TOTAL_H + 4;
export const BOTTOM_STACK_BAR_LEFT = -BOTTOM_STACK_BAR_W / 2;

/** Label style shared by every centered lower-stack row. */
export const BOTTOM_STACK_LABEL_FONT = {
  fontSize: '15px',
  fontFamily: 'monospace',
  color: toCssColor(COLORS.GREY_3),
  align: 'center' as const,
};

/** Return the occupied height for a stack with the given number of rows. */
export function getBottomStackHeight(rowCount: number): number {
  const count = Math.max(0, Math.floor(rowCount));
  return count === 0
    ? 0
    : count * BOTTOM_STACK_TOTAL_H + (count - 1) * BOTTOM_STACK_GAP;
}
