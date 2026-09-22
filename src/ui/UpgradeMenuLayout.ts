import { COLORS, GAME_WIDTH, GAME_HEIGHT } from '../config';

/** Shared shell geometry for Upgrades and the personal base menu. */
export const UPGRADE_MENU = {
  width: GAME_WIDTH - 16, height: GAME_HEIGHT - 8,
  centerX: GAME_WIDTH / 2, centerY: GAME_HEIGHT / 2,
  forestInsetX: 104, forestInsetY: 112, forestTint: 0x9ca98d,
  dimColor: COLORS.GREY_10, dimAlpha: .58,
  headerY: 82, headerWidth: 600, headerHeight: 150,
  buttonWidth: 260, buttonHeight: 50, buttonGap: 40,
  buttonY: GAME_HEIGHT / 2 + (GAME_HEIGHT - 8) / 2 - 94,
} as const;
