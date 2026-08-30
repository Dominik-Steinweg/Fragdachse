import type { ArenaBuilderResult } from '../arena/ArenaBuilder';
import type { RockRegistry } from '../arena/RockRegistry';
import type { BaseManager } from '../entities/BaseManager';
import type { LightOccluderIndex } from '../effects/LightOccluderIndex';
import type { PlacementSystem } from '../systems/PlacementSystem';
import type { ArenaLayout } from '../types';

/**
 * Der physisch materialisierte Zustand genau einer World-Instanz.
 *
 * Bisher lag er als sechs unabhaengige nullable Felder im `ArenaContext`, und "was gehoert
 * eigentlich zur gebauten World" war nur aus dem Abbaupfad zu rekonstruieren. Dieser Owner haelt
 * die Teile zusammen und kennt als einziger ihre Abbaureihenfolge.
 *
 * Er traegt ausschliesslich World-Lifetime: Geometrie, Presentation, Fels- und Bau-Runtime,
 * Basen und die daraus abgeleiteten Indizes. Activity-Systeme – Gegner, Boss, Missionsziele,
 * Encounter – gehoeren nicht hierher; sie leben in der Activity Runtime.
 */

/** Infrastrukturgrenze der Materialisierung: die gebaute Presentation ist Phaser-gebunden. */
export interface WorldMaterializationSink {
  /**
   * Zerstoert die gebaute World-Presentation.
   *
   * Sie wird ausgelassen, wenn der naechste Aufbau dieselbe authored Presentation weiterverwendet
   * (Lobby-Fast-Reinstance); dann uebernimmt der naechste Aufbau die Referenz.
   */
  readonly destroyPresentation: (arena: ArenaBuilderResult) => void;
}

export interface WorldMaterializationDestroyOptions {
  /**
   * True, wenn der naechste Aufbau die gebaute Presentation uebernimmt. Nur dann bleibt sie
   * stehen – alles andere faellt auch dann.
   */
  readonly preservePresentation: boolean;
  /**
   * Laeuft genau zwischen zwei Schritten: Geometrie und Presentation sind bereits abgemeldet,
   * die Bau-Runtime haelt ihre Objekte aber noch.
   *
   * Das ist das einzige Fenster, in dem "hat dieses Runtime-Objekt die Runde ueberlebt?" noch
   * beantwortbar ist – danach ist jede Antwort "zerstoert". Zugleich sehen Aufraeumschritte
   * hier keine Weltgeometrie mehr und veraendern deshalb keine Darstellung, die der naechste
   * Aufbau womoeglich weiterverwendet.
   */
  readonly beforePlacementRelease?: (placement: PlacementSystem | null) => void;
}

export class WorldMaterialization {
  private layoutValue: ArenaLayout | null;
  private arenaValue: ArenaBuilderResult | null = null;
  private placementValue: PlacementSystem | null = null;
  private basesValue: BaseManager | null = null;
  private rocksValue: RockRegistry | null = null;
  private lightOccludersValue: LightOccluderIndex | null = null;
  private destroyed = false;

  /**
   * Das Layout steht als erstes; alles Weitere entsteht im selben Aufbaupass und wird hier
   * nachgereicht. Ein Teil, der nie entstanden ist, wird beim Abbau auch nicht rekonstruiert.
   */
  constructor(layout: ArenaLayout, private readonly sink: WorldMaterializationSink) {
    this.layoutValue = layout;
  }

  /** Geometrie dieser World-Instanz. */
  get layout(): ArenaLayout | null {
    return this.layoutValue;
  }

  /** Gebaute World-Presentation: Boden, Felsen, Staemme, Kronen, Overlays. */
  get arena(): ArenaBuilderResult | null {
    return this.arenaValue;
  }

  /** Bau- und Runtime-Objekt-Raster dieser World. */
  get placement(): PlacementSystem | null {
    return this.placementValue;
  }

  /** Materialisierte Basen dieser World; `null`, wenn die World keine fuehrt. */
  get bases(): BaseManager | null {
    return this.basesValue;
  }

  /** Authored Felsdaten dieser World. */
  get rocks(): RockRegistry | null {
    return this.rocksValue;
  }

  /** Verdeckungs-Cache der Beleuchtung; entsteht nur mit lokaler Presentation. */
  get lightOccluders(): LightOccluderIndex | null {
    return this.lightOccludersValue;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  setArena(arena: ArenaBuilderResult): void {
    this.assertAlive('arena');
    this.arenaValue = arena;
  }

  setPlacement(placement: PlacementSystem): void {
    this.assertAlive('placement');
    this.placementValue = placement;
  }

  setBases(bases: BaseManager | null): void {
    this.assertAlive('bases');
    this.basesValue = bases;
  }

  setRocks(rocks: RockRegistry): void {
    this.assertAlive('rocks');
    this.rocksValue = rocks;
  }

  setLightOccluders(index: LightOccluderIndex | null): void {
    this.assertAlive('light occluders');
    this.lightOccludersValue = index;
  }

  /**
   * Raeumt die gebaute World ab – in umgekehrter Aufbaureihenfolge. Idempotent, damit
   * Rundenende, Lobby-Rueckkehr und technischer Abbruch denselben Weg nehmen koennen.
   *
   * Nur tatsaechlich Entstandenes faellt: eine World ohne Basen, ohne Presentation oder ohne
   * lokale Beleuchtung raeumt hier schlicht weniger ab.
   */
  destroy(options: WorldMaterializationDestroyOptions): void {
    if (this.destroyed) return;
    this.destroyed = true;
    // Zuerst faellt alles, was nur auf die World zeigt. Ab hier liest kein Aufraeumschritt mehr
    // Geometrie – auch keiner, der eine fuer den naechsten Aufbau erhaltene Presentation
    // andernfalls noch veraendern wuerde.
    this.lightOccludersValue = null;
    this.rocksValue = null;
    const arena = this.arenaValue;
    const placement = this.placementValue;
    this.arenaValue = null;
    this.layoutValue = null;
    options.beforePlacementRelease?.(placement);
    // Runtime-Objekte geben ihre Rasterzellen frei, bevor die Bau-Runtime faellt; sonst
    // kollidierte der naechste Aufbau mit Zellen, die niemand mehr besitzt.
    placement?.clearRuntimeRocks();
    this.placementValue = null;
    this.basesValue?.destroy();
    this.basesValue = null;
    if (arena && !options.preservePresentation) this.sink.destroyPresentation(arena);
  }

  private assertAlive(part: string): void {
    if (!this.destroyed) return;
    throw new Error(`[WorldMaterialization] Cannot set ${part} on a destroyed world materialization`);
  }
}
