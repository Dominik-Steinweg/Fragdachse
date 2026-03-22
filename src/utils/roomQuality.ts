const ROOM_QUALITY_RETRY_COUNT_KEY = 'fragdachse_room_quality_retry_count';
const ROOM_QUALITY_AUTO_SEARCH_KEY = 'fragdachse_room_quality_auto_search';

export interface AutomaticRoomSearchState {
  active: boolean;
  exhausted: boolean;
  currentAttempt: number;
  maxAttempts: number;
}

function getSessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function getCurrentRoomShareUrl(): string {
  return window.location.href;
}

export async function copyCurrentRoomShareUrl(): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(getCurrentRoomShareUrl());
    return true;
  } catch {
    return false;
  }
}

export function getRoomQualityRetryCount(): number {
  const storage = getSessionStorage();
  if (!storage) return 0;
  const raw = storage.getItem(ROOM_QUALITY_RETRY_COUNT_KEY);
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function clearRoomQualityRetryCount(): void {
  getSessionStorage()?.removeItem(ROOM_QUALITY_RETRY_COUNT_KEY);
}

export function incrementRoomQualityRetryCount(): number {
  const next = getRoomQualityRetryCount() + 1;
  getSessionStorage()?.setItem(ROOM_QUALITY_RETRY_COUNT_KEY, String(next));
  return next;
}

function reloadCurrentRoomWithoutHash(): void {
  const target = new URL(window.location.href);
  target.hash = '';
  window.location.assign(target.toString());
}

export function restartRoomForQualityRetry(): void {
  incrementRoomQualityRetryCount();
  reloadCurrentRoomWithoutHash();
}

export function restartRoomForAutomaticRoomSearch(): void {
  reloadCurrentRoomWithoutHash();
}

function writeAutomaticRoomSearchState(state: AutomaticRoomSearchState): void {
  getSessionStorage()?.setItem(ROOM_QUALITY_AUTO_SEARCH_KEY, JSON.stringify(state));
}

export function getAutomaticRoomSearchState(): AutomaticRoomSearchState {
  const raw = getSessionStorage()?.getItem(ROOM_QUALITY_AUTO_SEARCH_KEY);
  if (!raw) {
    return { active: false, exhausted: false, currentAttempt: 0, maxAttempts: 0 };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<AutomaticRoomSearchState>;
    return {
      active: parsed.active === true,
      exhausted: parsed.exhausted === true,
      currentAttempt: typeof parsed.currentAttempt === 'number' ? parsed.currentAttempt : 0,
      maxAttempts: typeof parsed.maxAttempts === 'number' ? parsed.maxAttempts : 0,
    };
  } catch {
    return { active: false, exhausted: false, currentAttempt: 0, maxAttempts: 0 };
  }
}

export function beginAutomaticRoomSearch(maxAttempts: number): void {
  writeAutomaticRoomSearchState({
    active: true,
    exhausted: false,
    currentAttempt: 0,
    maxAttempts: Math.max(1, maxAttempts),
  });
}

export function consumeAutomaticRoomSearchAttempt(): AutomaticRoomSearchState {
  const state = getAutomaticRoomSearchState();
  if (!state.active || state.exhausted) return state;
  const next = { ...state, currentAttempt: state.currentAttempt + 1 };
  writeAutomaticRoomSearchState(next);
  return next;
}

export function clearAutomaticRoomSearchState(): void {
  getSessionStorage()?.removeItem(ROOM_QUALITY_AUTO_SEARCH_KEY);
}

export function markAutomaticRoomSearchExhausted(): AutomaticRoomSearchState {
  const state = getAutomaticRoomSearchState();
  const next = { ...state, active: false, exhausted: true };
  writeAutomaticRoomSearchState(next);
  return next;
}