/**
 * Raumcode im URL-Hash. Form: `#r=ABC123`.
 *
 * Der Code ist gleichzeitig die Broker-ID des Hosts (siehe `roomCodeToPeerId`). Wer die URL
 * mit Hash öffnet, tritt dem Raum bei; ohne Hash wird ein neuer Raum eröffnet.
 *
 * **Der Host trägt den Code bewusst NICHT in seine eigene URL ein.** Sonst würde er nach
 * einem Reload versuchen, seinem eigenen – gerade beendeten – Raum beizutreten, und landete
 * auf „Host nicht gefunden". Der Einladungslink wird stattdessen aus dem Raumcode gebaut.
 */
import { createPeerNetworkError, isValidRoomCode } from '../network/peer/PeerSignaling';

const ROOM_HASH_PREFIX = '#r=';

/** Liest den Raumcode aus der aktuellen URL. `null` = neuen Raum eröffnen. */
export function readRoomCodeFromUrl(): string | null {
  const hash = window.location.hash;
  if (!hash.startsWith(ROOM_HASH_PREFIX)) return null;
  const code = hash.slice(ROOM_HASH_PREFIX.length).trim().toUpperCase();
  if (!isValidRoomCode(code)) throw createPeerNetworkError('invalid-room-code');
  return code;
}

/** Stabiles Client-Token fuer Reload und kurze Link-Wiederaufnahme innerhalb eines Raums. */
export function getOrCreateRoomResumeToken(roomCode: string): string {
  const storageKey = `fragdachse:resume:${roomCode}`;
  let existing: string | null = null;
  try {
    existing = window.sessionStorage.getItem(storageKey);
  } catch {
    // Some privacy modes deny storage. Runtime resume still works with the in-memory token.
  }
  if (existing && existing.length >= 16) return existing;
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const token = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  try {
    window.sessionStorage.setItem(storageKey, token);
  } catch {
    // A reload cannot resume without storage, but joining must remain usable.
  }
  return token;
}

/** Einladungslink zum angegebenen Raum – unabhängig davon, was gerade in der Adresszeile steht. */
export function buildRoomShareUrl(roomCode: string): string {
  const target = new URL(window.location.href);
  target.hash = `r=${roomCode}`;
  return target.toString();
}

export async function copyRoomShareUrl(roomCode: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(buildRoomShareUrl(roomCode));
    return true;
  } catch {
    return false;
  }
}

/**
 * Lädt die Seite ohne Raumcode neu, sodass ein frischer Raum entsteht.
 *
 * `location.assign`/`replace` auf eine URL, die sich nur im Fragment unterscheidet, ist eine
 * **Same-Document-Navigation** – die Seite würde nicht neu laden und der Bildschirm bliebe
 * stehen. Deshalb erst die Adresszeile über die History bereinigen und dann neu laden.
 */
export function restartWithNewRoom(): void {
  const target = new URL(window.location.href);
  target.hash = '';
  window.history.replaceState(null, '', target.toString());
  window.location.reload();
}

/** Laedt denselben Einladungslink neu; der Host kann den gespeicherten Slot wieder zuordnen. */
export function rejoinCurrentRoom(): void {
  window.location.reload();
}
