import { GAME_WIDTH } from '../config';
import { FOREST_ASSETS } from './LobbyForestAssets';

/** Screen-fixed lobby geometry in design pixels; independent of authored world cells. */
export const LOBBY_CARD = {
  width: 596,
  height: 832,
  top: 240,
  bottom: 1072,
  left: 12,
  right: GAME_WIDTH - 12 - 596,
  padding: 56,
  glassInset: 36,
  contentWidth: 484,
  readyY: 992,
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
export const LOBBY_WORLD_BUTTON = { x: GAME_WIDTH / 2, y: LOBBY_CARD.systemY, w: 280, h: 80 } as const;
export const LOBBY_ROSTER_ROW_STEP = 56;
export const LOBBY_CARD_MOTION = { exitDuration: 350, enterDuration: 500, enterDelay: 100 } as const;
/** The monochrome art stays behind the roster, independent of occupied slots and scrolling. */
export function getLobbyReliefBounds() {
  const width = LOBBY_CARD.contentWidth - 24;
  const height = width * FOREST_ASSETS.relief.crop.height / FOREST_ASSETS.relief.crop.width;
  return { x: LOBBY_CARD.left + LOBBY_CARD.width / 2,
    y: LOBBY_CARD.rosterBottom - 16 - height / 2, width, height };
}
export const LOBBY_POPUP_SAFE_AREA = {
  left: 12, top: 12, right: GAME_WIDTH - 12, bottom: 1068,
} as const;
