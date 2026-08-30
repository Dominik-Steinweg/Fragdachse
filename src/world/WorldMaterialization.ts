import type { RockRegistry } from '../arena/RockRegistry';
import type { ArenaBuilderResult } from '../arena/ArenaBuilder';
import type { BaseManager } from '../entities/BaseManager';
import type { LightOccluderIndex } from '../effects/LightOccluderIndex';
import type { PlacementSystem } from '../systems/PlacementSystem';

/**
 * Der mutable World-Gameplay-State genau einer World-Instanz.
 *
 * Bau-Runtime, Basen, authored Felsdaten und die daraus abgeleiteten Indizes. Sie leben und
 * sterben mit ihrer `WorldRuntime`: Ohne World-Instanz simuliert niemand mehr etwas davon,
 * deshalb bleibt davon auch nichts stehen.
 *
 * Die Darstellung gehoert ausdruecklich **nicht** hierher. Sie hat eine eigene Lifetime und kann
 * einen Uebergang ueberleben; siehe `WorldPresentationBinding`.
 *
 * Activity-Systeme – Gegner, Boss, Missionsziele, Encounter – gehoeren ebenfalls nicht hierher;
 * sie leben in der Activity Runtime.
 */
export class WorldMaterialization {
  private arenaValue: ArenaBuilderResult | null = null;
  private destroyArenaGameplay: ((arena: ArenaBuilderResult) => void) | null = null;
  private placementValue: PlacementSystem | null = null;
  private basesValue: BaseManager | null = null;
  private rocksValue: RockRegistry | null = null;
  private lightOccludersValue: LightOccluderIndex | null = null;
  private destroyed = false;

  /** Aktive Aufbau-Fassade; der Handoff erhaelt davon ausschliesslich die Presentation-Projektion. */
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

  /** Verdeckungs-Cache der Beleuchtung; entsteht nur mit lokaler Darstellung. */
  get lightOccluders(): LightOccluderIndex | null {
    return this.lightOccludersValue;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  setPlacement(placement: PlacementSystem): void {
    this.assertAlive('placement');
    this.placementValue = placement;
  }

  setArena(arena: ArenaBuilderResult, destroyGameplay: (arena: ArenaBuilderResult) => void): void {
    this.assertAlive('arena gameplay runtime');
    if (this.arenaValue) throw new Error('[WorldMaterialization] Arena gameplay runtime is already attached');
    this.arenaValue = arena;
    this.destroyArenaGameplay = destroyGameplay;
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
   * Raeumt den mutablen World-State ab – in umgekehrter Aufbaureihenfolge. Idempotent.
   *
   * Nur tatsaechlich Entstandenes faellt: eine World ohne Basen oder ohne lokale Beleuchtung
   * raeumt hier schlicht weniger ab.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.lightOccludersValue = null;
    this.rocksValue = null;
    // Runtime-Objekte geben ihre Rasterzellen frei, bevor die Bau-Runtime faellt; sonst
    // kollidierte der naechste Aufbau mit Zellen, die niemand mehr besitzt.
    this.placementValue?.clearRuntimeRocks();
    this.placementValue = null;
    this.basesValue?.destroy();
    this.basesValue = null;
    const arena = this.arenaValue;
    const destroyArenaGameplay = this.destroyArenaGameplay;
    this.arenaValue = null;
    this.destroyArenaGameplay = null;
    if (arena) destroyArenaGameplay?.(arena);
  }

  private assertAlive(part: string): void {
    if (!this.destroyed) return;
    throw new Error(`[WorldMaterialization] Cannot set ${part} on a destroyed world materialization`);
  }
}
