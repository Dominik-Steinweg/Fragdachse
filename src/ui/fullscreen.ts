/**
 * Vollbild als *ein* Zustand, unabhaengig davon, wie er entstanden ist.
 *
 * Der Browser kennt zwei getrennte Vollbildmodi, die sich fuer die Seite voellig verschieden
 * verhalten:
 *
 * - **API-Vollbild** (`Element.requestFullscreen`, hier ueber den ScaleManager). Nur dieser
 *   Modus setzt `document.fullscreenElement`, feuert `fullscreenchange`, laesst sich per Skript
 *   wieder verlassen – und Chrome beendet ihn mit einem *kurzen* ESC.
 * - **Browser-Vollbild** (F11 oder Browsermenue). Fuer die Seite praktisch unsichtbar:
 *   `document.fullscreenElement` bleibt `null`, es gibt kein Ereignis, `exitFullscreen()` ist
 *   wirkungslos – und Chrome verlangt zum Verlassen ein *langes* ESC.
 *
 * Damit das Spiel nur einen Zustand kennt, faengt dieses Modul F11 ab und uebersetzt es in
 * API-Vollbild. Dadurch verhalten sich Taste und Button identisch, inklusive ESC-Dauer.
 * Bleibt trotzdem Browser-Vollbild uebrig (Browsermenue, F11 vor dem Spielstart, Browser ohne
 * abfangbares F11), erkennt `(display-mode: fullscreen)` das wenigstens fuer die Anzeige;
 * *verlassen* laesst es sich von hier aus nicht – das kann nur der Browser selbst.
 *
 * ## Warum `#game-container` das Vollbildziel ist
 *
 * Ohne `fullscreenTarget` legt Phaser einen eigenen `<div>` an und verschiebt **nur die Canvas**
 * hinein (`ScaleManager.getFullscreenTarget`). Der Browser zeigt im Vollbild ausschliesslich
 * diesen Teilbaum – alles andere im Dokument ist unsichtbar, obwohl es weiter im DOM haengt.
 * Genau daran scheitern DOM-Overlays wie die Netz-Info: sie oeffnen sich, sind aber nicht zu
 * sehen. Deshalb geht der gemeinsame Container ins Vollbild, und deshalb haengen DOM-Overlays
 * ueber {@link getOverlayRoot} ebenfalls dort statt am `<body>`.
 */
import * as Phaser from 'phaser';

/**
 * Zugleich `parent` und `fullscreenTarget` der Spielkonfiguration. Beides muss dasselbe Element
 * sein: Phaser verlangt, dass die Canvas im Vollbildziel liegt.
 */
export const FULLSCREEN_TARGET_ID = 'game-container';

const BROWSER_FULLSCREEN_QUERY = '(display-mode: fullscreen)';

export type FullscreenToggleResult =
  /** API-Vollbild angefordert. */
  | 'entered'
  /** API-Vollbild beendet. */
  | 'exited'
  /** Browser-Vollbild aktiv – nur der Browser selbst kann es beenden. */
  | 'browser-locked'
  /** Der Browser bietet kein Vollbild an. */
  | 'unsupported';

let installedGame: Phaser.Game | null = null;
const listeners = new Set<() => void>();

function isApiFullscreen(): boolean {
  return typeof document !== 'undefined' && document.fullscreenElement !== null;
}

function isBrowserFullscreen(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(BROWSER_FULLSCREEN_QUERY).matches;
}

/** Sieht der Spieler gerade ein Vollbild? Beide Modi zaehlen. */
export function isFullscreen(): boolean {
  return isApiFullscreen() || isBrowserFullscreen();
}

/**
 * Elternknoten fuer DOM-Overlays. Immer das Vollbildziel, auch ausserhalb des Vollbilds – die
 * Overlays positionieren sich per `position: fixed` am Viewport und sind vom Wechsel des
 * Elternknotens unabhaengig, muessen aber im Vollbild-Teilbaum liegen, um sichtbar zu sein.
 */
export function getOverlayRoot(): HTMLElement {
  return document.getElementById(FULLSCREEN_TARGET_ID) ?? document.body;
}

/**
 * Wechselt den Vollbildzustand. Das Ergebnis sagt, was tatsaechlich passiert ist – im
 * Browser-Vollbild kann der Aufrufer nichts tun ausser den Spieler darauf hinzuweisen.
 */
export function toggleFullscreen(): FullscreenToggleResult {
  const scale = installedGame?.scale;
  if (!scale || !scale.fullscreen.available) return 'unsupported';

  if (scale.isFullscreen) {
    scale.stopFullscreen();
    return 'exited';
  }
  if (isBrowserFullscreen()) return 'browser-locked';

  scale.startFullscreen();
  return 'entered';
}

/** Meldet jeden Wechsel des Vollbildzustands, aus welcher Quelle auch immer. Gibt das Abmelden zurueck. */
export function onFullscreenChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function notify(): void {
  for (const listener of [...listeners]) listener();
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'F11' || event.repeat) return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

  // Im Browser-Vollbild ist F11 der einzige Ausweg – dann darf es nicht abgefangen werden.
  if (isBrowserFullscreen() && !isApiFullscreen()) return;

  const result = toggleFullscreen();
  if (result === 'entered' || result === 'exited') event.preventDefault();
}

/**
 * Einmalig nach dem Spielstart aufrufen. Ab dann fuehrt F11 zum selben Zustand wie der
 * Vollbild-Button, und beide melden ihre Aenderung an {@link onFullscreenChange}.
 */
export function installFullscreenSupport(game: Phaser.Game): void {
  installedGame = game;
  if (typeof window === 'undefined') return;

  document.addEventListener('fullscreenchange', notify);
  // Erkennt Browser-Vollbild, das die Fullscreen-API nicht meldet (F11, Browsermenue).
  window.matchMedia(BROWSER_FULLSCREEN_QUERY).addEventListener('change', notify);
  // Capture-Phase: vor Phasers Tastatur-Plugin und vor jedem Overlay-Handler.
  window.addEventListener('keydown', onKeyDown, true);
}
