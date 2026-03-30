export const PLAYER_NAME_MAX_LENGTH = 15;

export function clampPlayerNameInput(value: string): string {
  return value.slice(0, PLAYER_NAME_MAX_LENGTH);
}

export function sanitizePlayerName(value: string): string {
  return value.trim().slice(0, PLAYER_NAME_MAX_LENGTH);
}