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

/** Verlässt den aktuellen Raum und lässt Playroom einen neuen Raum erzeugen. */
export function restartRoomForQualityRetry(): void {
  const target = new URL(window.location.href);
  target.hash = '';
  window.location.assign(target.toString());
}
