import { ActivityRuntimeHost } from './ActivityRuntimeHost';
import type { PersistentBaseWorldBinding } from './PersistentBaseWorldBinding';
import type { PlayerWorldRuntime } from './PlayerWorldRuntime';
import type { WorldDescriptor } from './WorldDescriptor';
import type { WorldMaterialization } from './WorldMaterialization';
import type { WorldPresentationBinding } from './WorldPresentationBinding';
import type { WorldPresentationFrameBinding } from './WorldPresentationFrameBinding';
import type { WorldRuntimeContext } from './WorldRuntimeContext';

/**
 * Lokale Realisierung genau einer World-Instanz.
 *
 * `WorldLifecycle` besitzt die Identitaet der replizierten World; dieser Owner besitzt den
 * lokalen, mutablen Aufbau dazu. Beides ist getrennt, weil ein lokaler Teardown die replizierte
 * Instanz ausdruecklich nicht beendet: dieselbe World kann ihre Runtime verlieren und eine neue
 * bekommen, ohne dass ihre Identitaet wechselt.
 *
 * Der Owner ist kein Dependency-Container. Er wird nicht an Systeme weitergereicht; er erzeugt,
 * taktet und zerstoert ausschliesslich seine eigenen direkten Child-Owner.
 *
 * Mutabler World-Gameplay-State ueberlebt diese Runtime nicht. Die einzige Ausnahme ist die
 * Darstellung, und sie geht dafuer ausdruecklich ueber {@link releasePresentation} in den
 * `WorldPresentationHandoff` – nicht dadurch, dass beim Teardown ein Feld stehenbleibt.
 */

/** Gemeinsamer Lebenszyklus aller Child-Owner, die genau mit dieser World leben und sterben. */
export interface WorldScopedBinding {
  /** Taktet den world-scoped Zustand dieses Bindings. */
  readonly update?: (deltaMs: number) => void;
  /** Raeumt den materialisierten Zustand ab. Wird vom Owner genau einmal gerufen. */
  readonly destroy: () => void;
}

export class WorldRuntime {
  /** Der Activity-Slot dieser World. Eine World ohne Activity laesst ihn schlicht leer. */
  readonly activity: ActivityRuntimeHost;

  private materializedWorld: WorldMaterialization | null = null;
  private presentationBinding: WorldPresentationBinding | null = null;
  private presentationFrameBinding: WorldPresentationFrameBinding | null = null;
  private persistentBaseBinding: PersistentBaseWorldBinding | null = null;
  private playerRuntime: PlayerWorldRuntime | null = null;
  private worldScopedBindings: WorldScopedBinding[] = [];
  private destroyed = false;

  constructor(readonly context: WorldRuntimeContext) {
    this.activity = new ActivityRuntimeHost(context.descriptor.worldRevision);
  }

  /** Identitaet der World, die diese Runtime realisiert. */
  get descriptor(): WorldDescriptor {
    return this.context.descriptor;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  /** Der mutable World-Gameplay-State dieser Instanz; `null`, solange nichts gebaut ist. */
  get materialization(): WorldMaterialization | null {
    return this.materializedWorld;
  }

  /** Die lokale Darstellung dieser World; `null` ohne eigene Presentation. */
  get presentation(): WorldPresentationBinding | null {
    return this.presentationBinding;
  }

  /** Die aktive Presentation-Verdrahtung dieser World; `null` ohne gebundenen Frame-Binding. */
  get presentationFrame(): WorldPresentationFrameBinding | null {
    return this.presentationFrameBinding;
  }

  /** Die world-lokale Materialisierung der persistenten Basis; `null`, wenn diese World keine fuehrt. */
  get persistentBase(): PersistentBaseWorldBinding | null {
    return this.persistentBaseBinding;
  }

  /**
   * Wer in dieser World steht.
   *
   * Die Player-Runtime gehoert der World und ueberlebt deshalb einen Activity-Wechsel in ihr;
   * mit dem Ende der World steht dagegen niemand mehr in ihr.
   */
  get players(): PlayerWorldRuntime | null {
    return this.playerRuntime;
  }

  /** Setzt die Player-Runtime dieser World; eine vorhandene loest zuvor alle ihre Spieler. */
  setPlayers(runtime: PlayerWorldRuntime | null): void {
    this.assertAlive('player runtime');
    if (runtime === this.playerRuntime) return;
    const previous = this.playerRuntime;
    this.playerRuntime = runtime;
    previous?.detachAll();
  }

  /**
   * Uebernimmt den gebauten World-Zustand. Eine Runtime materialisiert genau einmal; ein zweiter
   * Aufbau gehoert zu einer neuen Runtime.
   */
  materialize(materialization: WorldMaterialization): void {
    this.assertAlive('materialization');
    if (this.materializedWorld) {
      throw new Error(
        `[WorldRuntime] World ${this.descriptor.definitionId} is already materialized`,
      );
    }
    this.materializedWorld = materialization;
  }

  /**
   * Setzt die Darstellung dieser World. Eine bereits vorhandene wird zuvor zerstoert – der Slot
   * fuehrt genau eine Darstellung.
   */
  setPresentation(binding: WorldPresentationBinding | null): void {
    this.assertAlive('presentation');
    if (binding === this.presentationBinding) return;
    const previous = this.presentationBinding;
    this.presentationBinding = binding;
    previous?.destroy();
  }

  /**
   * Gibt die Darstellung aus dem Besitz dieser Runtime frei und liefert sie zurueck.
   *
   * Das ist der einzige Weg, auf dem etwas diese Runtime ueberlebt. Wer sie uebernimmt, besitzt
   * sie danach; {@link destroy} raeumt sie nicht mehr ab.
   */
  releasePresentation(): WorldPresentationBinding | null {
    const released = this.presentationBinding;
    this.presentationBinding = null;
    return released;
  }

  /**
   * Bindet die aktive World-Presentation-Verdrahtung. Der Slot fuehrt genau einen Frame-Binding;
   * ein bereits belegter Slot wird nicht still ueberschrieben, sonst leakt der vorherige.
   */
  bindPresentationFrame(binding: WorldPresentationFrameBinding): void {
    this.assertAlive('presentation frame binding');
    if (this.presentationFrameBinding) {
      throw new Error(
        `[WorldRuntime] Presentation frame binding of world ${this.descriptor.definitionId} `
        + 'is already bound',
      );
    }
    this.presentationFrameBinding = binding;
  }

  /**
   * Loest die aktive World-Presentation-Verdrahtung. Idempotent und auch nach {@link destroy}
   * gefahrlos aufrufbar – so kann sie vor der handoffbaren Darstellung fallen, ohne dass ein
   * zweiter Aufruf (etwa das Sicherheitsnetz in `destroy()`) je etwas doppelt loest.
   */
  detachPresentationFrame(): void {
    const binding = this.presentationFrameBinding;
    this.presentationFrameBinding = null;
    binding?.destroy();
  }

  /** Setzt das Persistent-Base-Binding dieser World; ein vorhandenes wird zuvor zerstoert. */
  setPersistentBase(binding: PersistentBaseWorldBinding | null): void {
    this.assertAlive('persistent base binding');
    if (binding === this.persistentBaseBinding) return;
    const previous = this.persistentBaseBinding;
    this.persistentBaseBinding = binding;
    previous?.destroy();
  }

  /**
   * Bindet ein scene-langlebiges Shared System an diese World. Das Binding faellt mit ihr; das
   * gebundene System bleibt bestehen.
   */
  bind(binding: WorldScopedBinding): void {
    this.assertAlive('world-scoped binding');
    this.worldScopedBindings.push(binding);
  }

  /**
   * Taktet die direkten Child-Owner in Aufbaureihenfolge. Die Activity taktet zuletzt: sie setzt
   * die materialisierte World voraus, nie umgekehrt.
   *
   * Nach dem Teardown ist der Tick wirkungslos – ein spaeter Frame darf keine tote World beleben.
   */
  update(deltaMs: number): void {
    if (this.destroyed) return;
    for (const binding of this.worldScopedBindings) binding.update?.(deltaMs);
    this.activity.update(deltaMs);
  }

  /**
   * Raeumt den vollstaendigen lokalen World-State ab. Idempotent: Rundenende, Lobby-Rueckkehr und
   * technischer Abbruch nehmen denselben Weg.
   *
   * Die Darstellung verlaesst die World zuerst. Danach raeumt die Gameplay-Seite in umgekehrter
   * Aufbaureihenfolge ab – und kann dabei per Konstruktion keine Darstellung mehr erreichen, die
   * ein Uebergang weiterzeigt oder weiterverwendet. Der Abschluss des persistenten Basisbestands
   * laeuft deshalb vor dem Abbau der Bau-Runtime, aber nach dem Abgang der Darstellung.
   *
   * Die Spieler verlassen die World vor ihrer Activity: Ihr Abbau gibt noch gehaltene
   * Missionsziele frei und braucht die Activity dafuer.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    // Sicherheitsnetz zuerst: eine ohne expliziten `detachPresentationFrame()` zerstoerte Runtime
    // (z. B. ein technischer Abbruch) darf die aktive Presentation-Verdrahtung nicht leaken. Der
    // regulaere Pfad hat den Slot an dieser Stelle bereits geleert; hier ist der Aufruf dann ein
    // no-op. Die restliche Teardown-Reihenfolge bleibt unveraendert.
    this.detachPresentationFrame();
    const presentation = this.presentationBinding;
    const persistentBase = this.persistentBaseBinding;
    const materialization = this.materializedWorld;
    const players = this.playerRuntime;
    const bindings = this.worldScopedBindings;
    this.presentationBinding = null;
    this.persistentBaseBinding = null;
    this.materializedWorld = null;
    this.playerRuntime = null;
    this.worldScopedBindings = [];
    // Nur was diese Runtime noch besitzt: eine zuvor freigegebene Darstellung gehoert bereits
    // jemand anderem und wird hier nicht abgeraeumt.
    presentation?.destroy();
    players?.detachAll();
    this.activity.close();
    persistentBase?.destroy();
    for (const binding of [...bindings].reverse()) binding.destroy();
    materialization?.destroy();
  }

  private assertAlive(slot: string): void {
    if (!this.destroyed) return;
    throw new Error(
      `[WorldRuntime] Cannot set ${slot} on the destroyed runtime of world `
      + `${this.descriptor.definitionId}`,
    );
  }
}
