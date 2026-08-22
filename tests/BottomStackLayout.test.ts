import { describe, expect, it } from 'vitest';
import {
  BOTTOM_STACK_BAR_H,
  BOTTOM_STACK_BAR_W,
  BOTTOM_STACK_GAP,
  BOTTOM_STACK_LABEL_H,
  BOTTOM_STACK_PANEL_H,
  BOTTOM_STACK_PANEL_W,
  BOTTOM_STACK_TOTAL_H,
  getBottomStackHeight,
} from '../src/ui/BottomStackLayout';

describe('bottom HUD stack layout', () => {
  it('keeps the canonical Armor-sized row geometry', () => {
    expect(BOTTOM_STACK_BAR_W).toBe(212);
    expect(BOTTOM_STACK_BAR_H).toBe(14);
    expect(BOTTOM_STACK_LABEL_H).toBe(20);
    expect(BOTTOM_STACK_TOTAL_H).toBe(34);
    expect(BOTTOM_STACK_PANEL_W).toBe(232);
    expect(BOTTOM_STACK_PANEL_H).toBe(38);
  });

  it('calculates compact, gap-aware stack heights', () => {
    expect(getBottomStackHeight(-1)).toBe(0);
    expect(getBottomStackHeight(0)).toBe(0);
    expect(getBottomStackHeight(1)).toBe(34);
    expect(getBottomStackHeight(2)).toBe(34 + BOTTOM_STACK_GAP + 34);
    expect(getBottomStackHeight(3)).toBe(34 + BOTTOM_STACK_GAP + 34 + BOTTOM_STACK_GAP + 34);
  });
});
