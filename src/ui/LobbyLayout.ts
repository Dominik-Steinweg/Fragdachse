import { GAME_WIDTH } from '../config';

/** Screen-fixed lobby geometry in design pixels; independent of authored world cells. */
export const LOBBY_CARD = {
  width: 666,
  height: 832,
  top: 240,
  bottom: 1072,
  left: 24,
  right: GAME_WIDTH - 24 - 666,
  padding: 91,
  glassInset: 24,
  titleY: 274,
  contentWidth: 484,
  readyY: 984,
  historyY: 908,
  systemY: 992,
  rosterTop: 516,
  rosterBottom: 864,
} as const;

export const LOBBY_PLAYER_CONTENT_LEFT = LOBBY_CARD.right + LOBBY_CARD.padding;
export const LOBBY_PLAYER_CENTER = LOBBY_CARD.right + LOBBY_CARD.width / 2;
/** Inset content shared by progression and the three system actions. */
export const LOBBY_PLAYER_FOOTER = {
  left: LOBBY_PLAYER_CONTENT_LEFT + 16,
  width: LOBBY_CARD.contentWidth - 32,
} as const;
export const LOBBY_WORLD_BUTTON = { x: GAME_WIDTH / 2, y: LOBBY_CARD.systemY, w: 240, h: 48 } as const;
export const LOBBY_ROSTER_ROW_STEP = 56;
/** The relief occupies only unused roster space; overflow always hides it. */
export function getLobbyReliefBounds(contentHeight: number) {
  const freeHeight = LOBBY_CARD.rosterBottom - 16 - (LOBBY_CARD.rosterTop + contentHeight + 20);
  if (freeHeight < 100) return null;
  const width = Math.min(LOBBY_CARD.contentWidth - 24, Math.min(208, freeHeight) * 2);
  return { x: LOBBY_CARD.left + LOBBY_CARD.width / 2,
    y: LOBBY_CARD.rosterBottom - 16 - width / 4, width, height: width / 2 };
}
export const LOBBY_POPUP_SAFE_AREA = {
  left: 12, top: 12, right: GAME_WIDTH - 12, bottom: 1068,
} as const;
