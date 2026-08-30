import type { WorldPresentationBinding } from './WorldPresentationBinding';

/**
 * Traegt die Darstellung einer endenden World-Runtime ueber einen Uebergang.
 *
 * Ein Uebergang zwischen zwei World-Instanzen ist fuer den Spieler ein Bild und kein Schnitt:
 * Ein Match-Exit blendet die zuletzt gesehene World aus, nachdem ihre Instanz beendet ist, und
 * ein Wechsel innerhalb derselben authored World verwendet dieselbe gebaute Darstellung weiter,
 * statt sie identisch neu zu bauen.
 *
 * Der Handoff liegt deshalb **ueber** der `WorldRuntime` und haelt hoechstens eine freigegebene
 * Darstellung. Solange sie hier liegt, gehoert sie keiner Runtime: World-scoped Consumer sehen
 * keine Darstellung mehr, und kein Aufraeumschritt der Gameplay-Seite kann sie noch veraendern.
 * Getaktet oder simuliert wird sie nicht – sie steht nur noch da.
 *
 * Jede freigegebene Darstellung erreicht genau einen terminalen Ausgang: {@link adopt} oder
 * {@link discard}.
 */
export class WorldPresentationHandoff {
  private held: WorldPresentationBinding | null = null;

  /** Die gehaltene Darstellung, ohne sie zu uebernehmen; `null`, wenn keine uebergeben wurde. */
  get pending(): WorldPresentationBinding | null {
    return this.held;
  }

  /**
   * Nimmt die Darstellung einer endenden Runtime auf.
   *
   * Eine bereits gehaltene Darstellung hat damit ihren Ausgang gefunden – sie wird verworfen.
   * Zwei uebergebene Darstellungen gleichzeitig gibt es nicht: Es gibt immer nur einen laufenden
   * Uebergang.
   */
  release(binding: WorldPresentationBinding | null): void {
    if (binding === this.held) return;
    const previous = this.held;
    this.held = binding;
    previous?.destroy();
  }

  /**
   * Uebergibt die gehaltene Darstellung an den naechsten Aufbau. Danach ist der Handoff leer –
   * wer sie uebernimmt, besitzt sie auch.
   */
  adopt(): WorldPresentationBinding | null {
    const adopted = this.held;
    this.held = null;
    return adopted;
  }

  /** Niemand uebernimmt die Darstellung; sie wird zerstoert. Idempotent. */
  discard(): void {
    const discarded = this.held;
    this.held = null;
    discarded?.destroy();
  }
}
