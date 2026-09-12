import { GAME_WIDTH } from '../config';

/** Screen-fixed lobby geometry in design pixels; independent of authored world cells. */
export const LOBBY_CARD = {
  width: 540,
  height: 800,
  top: 240,
  bottom: 1040,
  left: 24,
  right: GAME_WIDTH - 24 - 540,
  padding: 28,
  contentWidth: 484,
  readyY: 984,
  historyY: 908,
  systemY: 992,
  rosterTop: 516,
  rosterBottom: 864,
} as const;

export const LOBBY_PLAYER_CONTENT_LEFT = LOBBY_CARD.right + LOBBY_CARD.padding;
export const LOBBY_PLAYER_CENTER = LOBBY_CARD.right + LOBBY_CARD.width / 2;
export const LOBBY_POPUP_SAFE_AREA = {
  left: 12, top: 12, right: GAME_WIDTH - 12, bottom: 1068,
} as const;
