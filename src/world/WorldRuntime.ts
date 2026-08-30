import { ActivityRuntimeHost } from './ActivityRuntimeHost';
import type { WorldDescriptor } from './WorldDescriptor';
import type { WorldMaterialization } from './WorldMaterialization';
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
 */

/** Gemeinsamer Lebenszyklus aller Child-Owner, die genau mit dieser World leben und sterben. */
export interface WorldScopedBinding {
  /** Taktet den world-scoped Zustand dieses Bindings. */
  readonly update?: (deltaMs: number) => void;
  /** Raeumt den materialisierten Zustand ab. Wird vom Owner genau einmal gerufen. */
  readonly destroy: () => void;
}

/**
 * Lokale Darstellung dieser World.
 *
 * Presentation besitzt keine Gameplay-Authority und ist keine Voraussetzung der Simulation: ein
 * Host kann dieselbe World autoritativ simulieren, ohne dieses Binding zu materialisieren.
 */
export type WorldPresentationBinding = WorldScopedBinding;

/**
 * World-lokale Materialisierung der persistenten Basis: Site, Build Area, Runtime IDs und
 * World-Konflikte.
 *
 * Sie stirbt vollstaendig mit dieser Runtime. Der raumlanglebige Session-State der persistenten
 * Basis lebt ausdruecklich ausserhalb und ueberlebt einen World-Wechsel.
 */
export type PersistentBaseWorldBinding = WorldScopedBinding;

export class WorldRuntime {
  /** Der Activity-Slot dieser World. Eine World ohne Activity laesst ihn schlicht leer. */
  readonly activity: ActivityRuntimeHost;

  private materializedWorld: WorldMaterialization | null = null;
  private presentationBinding: WorldPresentationBinding | null = null;
  private persistentBaseBinding: PersistentBaseWorldBinding | null = null;
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

  /** Der physisch materialisierte Zustand dieser World; `null`, solange nichts gebaut ist. */
  get materialization(): WorldMaterialization | null {
    return this.materializedWorld;
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
   * Gibt den gebauten World-Zustand aus dem Besitz dieser Runtime frei und liefert ihn zurueck.
   *
   * Der Abbau der Arena haengt heute nicht am Ende der World-Instanz: Exit-Fade,
   * Lobby-Fast-Reinstance und Rundenstart lassen die gebaute World bewusst stehen, nachdem ihre
   * Instanz beendet wurde. Wer sie weiterfuehrt, uebernimmt sie hierueber ausdruecklich – danach
   * raeumt {@link destroy} sie nicht mehr ab.
   */
  releaseMaterialization(): WorldMaterialization | null {
    const released = this.materializedWorld;
    this.materializedWorld = null;
    return released;
  }

  /**
   * Setzt das Presentation-Binding dieser World. Ein bereits vorhandenes wird zuvor zerstoert –
   * der Slot fuehrt genau eine Darstellung.
   */
  setPresentationBinding(binding: WorldPresentationBinding | null): void {
    this.assertAlive('presentation binding');
    if (binding === this.presentationBinding) return;
    const previous = this.presentationBinding;
    this.presentationBinding = binding;
    previous?.destroy();
  }

  /** Setzt das Persistent-Base-Binding dieser World; ein vorhandenes wird zuvor zerstoert. */
  setPersistentBaseBinding(binding: PersistentBaseWorldBinding | null): void {
    this.assertAlive('persistent base binding');
    if (binding === this.persistentBaseBinding) return;
    const previous = this.persistentBaseBinding;
    this.persistentBaseBinding = binding;
    previous?.destroy();
  }

  /**
   * Taktet die direkten Child-Owner in Aufbaureihenfolge. Die Activity taktet zuletzt: sie setzt
   * die materialisierte World voraus, nie umgekehrt.
   *
   * Nach dem Teardown ist der Tick wirkungslos – ein spaeter Frame darf keine tote World beleben.
   */
  update(deltaMs: number): void {
    if (this.destroyed) return;
    this.persistentBaseBinding?.update?.(deltaMs);
    this.presentationBinding?.update?.(deltaMs);
    this.activity.update(deltaMs);
  }

  /**
   * Raeumt den vollstaendigen lokalen World-State ab – in umgekehrter Aufbaureihenfolge, weil
   * Activity und Presentation auf der World-Materialisierung stehen.
   *
   * Idempotent: Rundenende, Lobby-Rueckkehr und technischer Abbruch nehmen denselben Weg.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.activity.close();
    const presentation = this.presentationBinding;
    const persistentBase = this.persistentBaseBinding;
    const materialization = this.materializedWorld;
    this.presentationBinding = null;
    this.persistentBaseBinding = null;
    this.materializedWorld = null;
    presentation?.destroy();
    persistentBase?.destroy();
    // Nur was diese Runtime noch besitzt: ein zuvor freigegebener Aufbau gehoert bereits jemand
    // anderem und wird hier nicht abgeraeumt.
    materialization?.destroy({ preservePresentation: false });
  }

  private assertAlive(slot: string): void {
    if (!this.destroyed) return;
    throw new Error(
      `[WorldRuntime] Cannot set ${slot} on the destroyed runtime of world `
      + `${this.descriptor.definitionId}`,
    );
  }
}
