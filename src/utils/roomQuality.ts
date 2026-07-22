/**
 * Raumcode im URL-Hash. Form: `#r=ABC123`.
 *
 * Der Code ist gleichzeitig die Broker-ID des Hosts (siehe `roomCodeToPeerId`). Wer die URL
 * mit Hash öffnet, tritt dem Raum bei; ohne Hash wird ein neuer Raum eröffnet.
 */
import { isValidRoomCode } from '../network/peer/PeerSignaling';

const ROOM_HASH_PREFIX = '#r=';

/** Liest den Raumcode aus der aktuellen URL. `null` = neuen Raum eröffnen. */
export function readRoomCodeFromUrl(): string | null {
  const hash = window.location.hash;
  if (!hash.startsWith(ROOM_HASH_PREFIX)) return null;
  const code = hash.slice(ROOM_HASH_PREFIX.length).trim().toUpperCase();
  return isValidRoomCode(code) ? code : null;
}

/**
 * Schreibt den Raumcode in die URL, ohne einen History-Eintrag zu erzeugen –
 * ein Reload soll denselben Raum treffen, der Zurück-Button aber nicht springen.
 */
export function writeRoomCodeToUrl(roomCode: string): void {
  const target = new URL(window.location.href);
  target.hash = `r=${roomCode}`;
  window.history.replaceState(null, '', target.toString());
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

/** Verlässt den aktuellen Raum und lädt die Seite ohne Code neu, damit ein neuer Raum entsteht. */
export function restartRoomForQualityRetry(): void {
  const target = new URL(window.location.href);
  target.hash = '';
  window.location.assign(target.toString());
  window.location.reload();
}
