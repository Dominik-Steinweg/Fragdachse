/**
 * Modulweiter Halter der aktiven Verbindung.
 *
 * NetworkBridge wird beim Modulladen erzeugt, die Verbindung entsteht erst später im Boot.
 * Dieser Halter überbrückt das – so wie zuvor die globalen Zustandsfunktionen der abgelösten
 * Bibliothek. Zugriff vor `setActiveSession()` ist ein Programmierfehler und wirft.
 */
import type { PeerJsTransport } from './PeerJsTransport';
import type { PeerRoom } from './PeerRoom';

export interface PeerSession {
  room: PeerRoom;
  transport: PeerJsTransport;
  roomCode: string;
}

let activeSession: PeerSession | null = null;

export function setActiveSession(session: PeerSession): void {
  activeSession = session;
}

export function getActiveSession(): PeerSession | null {
  return activeSession;
}

export function hasActiveSession(): boolean {
  return activeSession !== null;
}

export function requireRoom(): PeerRoom {
  if (!activeSession) throw new Error('Keine aktive Netzwerkverbindung – NetworkBridge.connect() fehlt.');
  return activeSession.room;
}

export function clearActiveSession(): void {
  activeSession?.room.destroy();
  activeSession = null;
}
