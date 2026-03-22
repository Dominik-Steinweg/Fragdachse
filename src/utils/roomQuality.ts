const ROOM_QUALITY_RETRY_COUNT_KEY = 'fragdachse_room_quality_retry_count';

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

export function restartRoomForQualityRetry(): void {
  incrementRoomQualityRetryCount();
  const target = new URL(window.location.href);
  target.hash = '';
  window.location.assign(target.toString());
}